use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tempfile::TempDir;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::error::{AppError, Result};
use crate::types::simc::SimcOutput;

mod patterns {
    use super::*;
    pub static PROGRESS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d+)/(\d+)").unwrap());
    pub static HEADER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^###\s+(Combo \d+)").unwrap());
}

// ---- Process Registry (for cancellation) ----

static RUNNING_PROCESSES: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static CANCELLED_JOBS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static JOB_CONTROLS: Lazy<Mutex<HashMap<String, Arc<SimulationControl>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static SYSINFO: Lazy<Mutex<System>> = Lazy::new(|| Mutex::new(System::new_all()));

struct AdmissionState {
    limit: usize,
    active: usize,
    waiting: HashMap<String, AdmissionWaiter>,
    next_sequence: u64,
}

struct AdmissionWaiter {
    queue_order: u64,
    sequence: u64,
}

struct SimulationAdmission {
    state: Mutex<AdmissionState>,
    notify: tokio::sync::Notify,
}

impl SimulationAdmission {
    fn new(limit: usize) -> Self {
        Self {
            state: Mutex::new(AdmissionState {
                limit: limit.max(1),
                active: 0,
                waiting: HashMap::new(),
                next_sequence: 0,
            }),
            notify: tokio::sync::Notify::new(),
        }
    }

    fn limit(&self) -> usize {
        self.state.lock().unwrap().limit
    }

    fn set_limit(&self, limit: usize) {
        self.state.lock().unwrap().limit = limit.max(1);
        self.notify.notify_waiters();
    }

    async fn acquire_job(
        self: &Arc<Self>,
        job_id: &str,
        queue_order: u64,
    ) -> SimulationAdmissionGuard {
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();

            let granted = {
                let mut state = self.state.lock().unwrap();
                let sequence = state.next_sequence;
                state.next_sequence = state.next_sequence.saturating_add(1);
                state
                    .waiting
                    .entry(job_id.to_string())
                    .and_modify(|waiter| waiter.queue_order = queue_order)
                    .or_insert(AdmissionWaiter {
                        queue_order,
                        sequence,
                    });

                let next_job = state
                    .waiting
                    .iter()
                    .min_by_key(|(_, waiter)| (waiter.queue_order, waiter.sequence))
                    .map(|(id, _)| id.as_str());
                if state.active < state.limit && next_job == Some(job_id) {
                    state.waiting.remove(job_id);
                    state.active += 1;
                    true
                } else {
                    false
                }
            };
            if granted {
                return SimulationAdmissionGuard {
                    admission: self.clone(),
                };
            }
            notified.await;
        }
    }

    async fn acquire_job_cancellable(
        self: &Arc<Self>,
        job_id: &str,
        queue_order: u64,
        control: Arc<SimulationControl>,
    ) -> std::result::Result<SimulationAdmissionGuard, String> {
        let admission = self.acquire_job(job_id, queue_order);
        tokio::pin!(admission);
        tokio::select! {
            guard = &mut admission => Ok(guard),
            _ = control.wait_until_cancelled() => {
                self.remove_waiter(job_id);
                Err("Job cancelled".to_string())
            }
        }
    }

    fn remove_waiter(&self, job_id: &str) {
        let removed = self.state.lock().unwrap().waiting.remove(job_id).is_some();
        if removed {
            self.notify.notify_waiters();
        }
    }

    fn update_waiter_order(&self, job_id: &str, queue_order: u64) {
        let updated = self
            .state
            .lock()
            .unwrap()
            .waiting
            .get_mut(job_id)
            .map(|waiter| {
                waiter.queue_order = queue_order;
            })
            .is_some();
        if updated {
            self.notify.notify_waiters();
        }
    }

    fn release(&self) {
        let mut state = self.state.lock().unwrap();
        state.active = state.active.saturating_sub(1);
        drop(state);
        self.notify.notify_waiters();
    }
}

pub struct SimulationAdmissionGuard {
    admission: Arc<SimulationAdmission>,
}

impl Drop for SimulationAdmissionGuard {
    fn drop(&mut self) {
        self.admission.release();
    }
}

static SIMC_ADMISSION: Lazy<Arc<SimulationAdmission>> =
    Lazy::new(|| Arc::new(SimulationAdmission::new(*crate::storage::MAX_PARALLEL_JOBS)));

pub fn simulation_concurrency_limit() -> usize {
    SIMC_ADMISSION.limit()
}

pub fn set_simulation_concurrency_limit(limit: usize) {
    SIMC_ADMISSION.set_limit(limit);
}

pub fn update_simulation_queue_order(job_id: &str, queue_order: u64) {
    SIMC_ADMISSION.update_waiter_order(job_id, queue_order);
}

pub fn remove_simulation_queue_waiter(job_id: &str) {
    SIMC_ADMISSION.remove_waiter(job_id);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobControlState {
    Pending,
    Running,
    Paused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InternalControlState {
    Pending,
    Running,
    Paused,
    Finished,
    Cancelled,
}

struct ControlInner {
    state: InternalControlState,
    execution_started: bool,
    paused_from: JobControlState,
    pid: Option<u32>,
    paused_at: Option<Instant>,
    paused_duration: Duration,
}

struct SimulationControl {
    inner: Mutex<ControlInner>,
    notify: tokio::sync::Notify,
}

impl SimulationControl {
    fn new(job_id: &str) -> Self {
        let cancelled = CANCELLED_JOBS.lock().unwrap().contains(job_id);
        Self {
            inner: Mutex::new(ControlInner {
                state: if cancelled {
                    InternalControlState::Cancelled
                } else {
                    InternalControlState::Pending
                },
                execution_started: false,
                paused_from: JobControlState::Pending,
                pid: None,
                paused_at: None,
                paused_duration: Duration::ZERO,
            }),
            notify: tokio::sync::Notify::new(),
        }
    }

    fn public_state(&self) -> Option<JobControlState> {
        let inner = self.inner.lock().unwrap();
        match inner.state {
            InternalControlState::Pending => Some(JobControlState::Pending),
            InternalControlState::Running => Some(JobControlState::Running),
            InternalControlState::Paused => Some(JobControlState::Paused),
            InternalControlState::Finished | InternalControlState::Cancelled => None,
        }
    }

    fn is_paused(&self) -> bool {
        self.inner.lock().unwrap().state == InternalControlState::Paused
    }

    fn is_cancelled(&self) -> bool {
        self.inner.lock().unwrap().state == InternalControlState::Cancelled
    }

    fn paused_duration(&self) -> Duration {
        let inner = self.inner.lock().unwrap();
        inner.paused_duration
            + inner
                .paused_at
                .map(|started| started.elapsed())
                .unwrap_or(Duration::ZERO)
    }

    fn start_execution(&self) -> bool {
        let mut inner = self.inner.lock().unwrap();
        match inner.state {
            InternalControlState::Pending => {
                inner.execution_started = true;
                inner.state = InternalControlState::Running;
                true
            }
            InternalControlState::Running => true,
            InternalControlState::Paused
            | InternalControlState::Finished
            | InternalControlState::Cancelled => false,
        }
    }

    fn pause(&self) -> std::result::Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        let previous = match inner.state {
            InternalControlState::Pending | InternalControlState::Running => {
                let previous = if inner.execution_started {
                    JobControlState::Running
                } else {
                    JobControlState::Pending
                };
                inner.paused_from = previous;
                inner.state = InternalControlState::Paused;
                inner.paused_at = Some(Instant::now());
                previous
            }
            InternalControlState::Paused => return Err("Job is already paused".to_string()),
            InternalControlState::Finished => return Err("Job is no longer running".to_string()),
            InternalControlState::Cancelled => return Err("Job has been cancelled".to_string()),
        };

        if let Some(pid) = inner.pid {
            if let Err(error) = suspend_process(pid) {
                inner.state = match previous {
                    JobControlState::Pending => InternalControlState::Pending,
                    JobControlState::Running => InternalControlState::Running,
                    JobControlState::Paused => InternalControlState::Paused,
                };
                inner.paused_at = None;
                return Err(error);
            }
        }
        drop(inner);
        self.notify.notify_waiters();
        Ok(())
    }

    fn resume(&self) -> std::result::Result<JobControlState, String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.state != InternalControlState::Paused {
            return Err("Job is not paused".to_string());
        }
        let target = inner.paused_from;

        if let Some(pid) = inner.pid {
            if let Err(error) = resume_process(pid) {
                return Err(error);
            }
        }

        if let Some(started) = inner.paused_at.take() {
            inner.paused_duration += started.elapsed();
        }
        inner.state = match target {
            JobControlState::Pending => InternalControlState::Pending,
            JobControlState::Running => InternalControlState::Running,
            JobControlState::Paused => InternalControlState::Paused,
        };
        drop(inner);
        self.notify.notify_waiters();
        Ok(target)
    }

    fn attach_process(&self, pid: u32) -> ProcessAttachAction {
        let mut inner = self.inner.lock().unwrap();
        inner.pid = Some(pid);
        match inner.state {
            InternalControlState::Paused => ProcessAttachAction::Suspend,
            InternalControlState::Cancelled => ProcessAttachAction::Cancel,
            InternalControlState::Pending | InternalControlState::Running => {
                inner.state = InternalControlState::Running;
                ProcessAttachAction::Continue
            }
            InternalControlState::Finished => ProcessAttachAction::Cancel,
        }
    }

    fn detach_process(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.pid = None;
        if inner.state == InternalControlState::Running {
            inner.state = InternalControlState::Pending;
        }
    }

    fn cancel(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.state = InternalControlState::Cancelled;
        self.notify.notify_waiters();
    }

    fn finish(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.state = InternalControlState::Finished;
        inner.pid = None;
        self.notify.notify_waiters();
    }

    async fn wait_until_runnable(&self) -> std::result::Result<(), String> {
        loop {
            let notified = self.notify.notified();
            let state = self.inner.lock().unwrap().state;
            match state {
                InternalControlState::Pending | InternalControlState::Running => return Ok(()),
                InternalControlState::Paused => notified.await,
                InternalControlState::Cancelled => return Err("Job cancelled".to_string()),
                InternalControlState::Finished => {
                    return Err("Job is no longer running".to_string())
                }
            }
        }
    }

    async fn wait_until_cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

enum ProcessAttachAction {
    Continue,
    Suspend,
    Cancel,
}

struct JobControlGuard {
    job_id: String,
}

impl Drop for JobControlGuard {
    fn drop(&mut self) {
        cleanup_job_control(&self.job_id);
    }
}

fn get_or_register_job_control(job_id: &str) -> Arc<SimulationControl> {
    let mut controls = JOB_CONTROLS.lock().unwrap();
    controls
        .entry(job_id.to_string())
        .or_insert_with(|| Arc::new(SimulationControl::new(job_id)))
        .clone()
}

pub fn register_job_control(job_id: &str) {
    let _ = get_or_register_job_control(job_id);
}

pub fn control_status(job_id: &str) -> Option<JobControlState> {
    JOB_CONTROLS
        .lock()
        .unwrap()
        .get(job_id)
        .and_then(|control| control.public_state())
}

pub fn start_job_control(job_id: &str) -> bool {
    get_or_register_job_control(job_id).start_execution()
}

pub async fn wait_until_resumed(job_id: &str) -> std::result::Result<(), String> {
    let control = JOB_CONTROLS
        .lock()
        .unwrap()
        .get(job_id)
        .cloned()
        .ok_or_else(|| "Job control is unavailable".to_string())?;
    control.wait_until_runnable().await
}

pub fn pause_job(job_id: &str) -> std::result::Result<(), String> {
    JOB_CONTROLS
        .lock()
        .unwrap()
        .get(job_id)
        .cloned()
        .ok_or_else(|| "Job control is unavailable".to_string())?
        .pause()
}

pub fn resume_job(job_id: &str) -> std::result::Result<JobControlState, String> {
    JOB_CONTROLS
        .lock()
        .unwrap()
        .get(job_id)
        .cloned()
        .ok_or_else(|| "Job control is unavailable".to_string())?
        .resume()
}

pub fn cleanup_job_control(job_id: &str) {
    if let Some(control) = JOB_CONTROLS.lock().unwrap().remove(job_id) {
        control.finish();
    }
}

struct CancellationGuard<'a> {
    job_id: &'a str,
}

impl<'a> CancellationGuard<'a> {
    fn new(job_id: &'a str) -> Self {
        Self { job_id }
    }
}

impl Drop for CancellationGuard<'_> {
    fn drop(&mut self) {
        cleanup_cancelled_job(self.job_id);
    }
}

pub fn get_process_stats(job_id: &str) -> Option<(f32, u64)> {
    let pid_u32 = RUNNING_PROCESSES.lock().unwrap().get(job_id).copied()?;
    let mut sys = SYSINFO.lock().unwrap();
    let pid = Pid::from_u32(pid_u32);
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::everything(),
    );
    sys.process(pid).map(|p| (p.cpu_usage(), p.memory()))
}

pub fn cleanup_cancelled_job(job_id: &str) {
    CANCELLED_JOBS.lock().unwrap().remove(job_id);
}

pub fn kill_job(job_id: &str) -> bool {
    CANCELLED_JOBS.lock().unwrap().insert(job_id.to_string());
    SIMC_ADMISSION.remove_waiter(job_id);
    if let Some(control) = JOB_CONTROLS.lock().unwrap().get(job_id).cloned() {
        control.cancel();
    }
    if let Some(pid_u32) = RUNNING_PROCESSES.lock().unwrap().remove(job_id) {
        let mut sys = SYSINFO.lock().unwrap();
        let pid = Pid::from_u32(pid_u32);
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::everything(),
        );
        if let Some(process) = sys.process(pid) {
            process.kill()
        } else {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid_u32.to_string()])
                    .creation_flags(0x08000000)
                    .output();
            }
            #[cfg(unix)]
            {
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid_u32.to_string()])
                    .output();
            }
            true
        }
    } else {
        false
    }
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
    fn SetProcessAffinityMask(h: *mut std::ffi::c_void, mask: usize) -> i32;
    fn CloseHandle(h: *mut std::ffi::c_void) -> i32;
}

#[cfg(windows)]
#[link(name = "ntdll")]
extern "system" {
    fn NtSuspendProcess(h: *mut std::ffi::c_void) -> i32;
    fn NtResumeProcess(h: *mut std::ffi::c_void) -> i32;
}

#[cfg(windows)]
fn suspend_process(pid: u32) -> std::result::Result<(), String> {
    const PROCESS_SUSPEND_RESUME: u32 = 0x0800;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    unsafe {
        let handle = OpenProcess(
            PROCESS_SUSPEND_RESUME | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        );
        if handle.is_null() {
            return Err(format!("Unable to open SimC process {pid} for pause"));
        }
        let status = NtSuspendProcess(handle);
        CloseHandle(handle);
        if status < 0 {
            Err(format!(
                "Unable to pause SimC process {pid} (status {status})"
            ))
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
fn resume_process(pid: u32) -> std::result::Result<(), String> {
    const PROCESS_SUSPEND_RESUME: u32 = 0x0800;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    unsafe {
        let handle = OpenProcess(
            PROCESS_SUSPEND_RESUME | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        );
        if handle.is_null() {
            return Err(format!("Unable to open SimC process {pid} for resume"));
        }
        let status = NtResumeProcess(handle);
        CloseHandle(handle);
        if status < 0 {
            Err(format!(
                "Unable to resume SimC process {pid} (status {status})"
            ))
        } else {
            Ok(())
        }
    }
}

#[cfg(unix)]
fn signal_process(pid: u32, signal: &str, action: &str) -> std::result::Result<(), String> {
    let status = std::process::Command::new("kill")
        .args([signal, &pid.to_string()])
        .status()
        .map_err(|error| format!("Unable to {action} SimC process {pid}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Unable to {action} SimC process {pid}"))
    }
}

#[cfg(unix)]
fn suspend_process(pid: u32) -> std::result::Result<(), String> {
    signal_process(pid, "-STOP", "pause")
}

#[cfg(unix)]
fn resume_process(pid: u32) -> std::result::Result<(), String> {
    signal_process(pid, "-CONT", "resume")
}

#[cfg(windows)]
fn set_process_affinity(pid: u32, threads: u32) {
    const PROCESS_SET_INFORMATION: u32 = 0x0200;
    const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
    unsafe {
        let h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION, 0, pid);
        if !h.is_null() {
            let mask: usize = if threads as usize >= usize::BITS as usize {
                usize::MAX
            } else {
                (1usize << threads as usize) - 1
            };
            SetProcessAffinityMask(h, mask);
            CloseHandle(h);
        }
    }
}

pub const DEFAULT_SIMC_IDLE_TIMEOUT_SECS: u64 = 600;
pub const DEFAULT_SIMC_TOTAL_TIMEOUT_SECS: u64 = 7200;
pub const MIN_SIMC_IDLE_TIMEOUT_SECS: u64 = 60;
pub const MAX_SIMC_IDLE_TIMEOUT_SECS: u64 = 3600;
pub const MIN_SIMC_TOTAL_TIMEOUT_SECS: u64 = 15 * 60;
pub const MAX_SIMC_TOTAL_TIMEOUT_SECS: u64 = 24 * 60 * 60;

#[derive(Clone, Copy)]
struct SimTimeouts {
    idle: Duration,
    total: Duration,
}

impl Default for SimTimeouts {
    fn default() -> Self {
        Self {
            idle: Duration::from_secs(DEFAULT_SIMC_IDLE_TIMEOUT_SECS),
            total: Duration::from_secs(DEFAULT_SIMC_TOTAL_TIMEOUT_SECS),
        }
    }
}

fn resolve_timeout_seconds(
    options: &Value,
    key: &str,
    default: u64,
    minimum: u64,
    maximum: u64,
) -> u64 {
    options
        .get(key)
        .and_then(|value| value.as_u64())
        .unwrap_or(default)
        .clamp(minimum, maximum)
}

fn resolve_sim_timeouts(options: &Value) -> SimTimeouts {
    SimTimeouts {
        idle: Duration::from_secs(resolve_timeout_seconds(
            options,
            "sim_idle_timeout_seconds",
            DEFAULT_SIMC_IDLE_TIMEOUT_SECS,
            MIN_SIMC_IDLE_TIMEOUT_SECS,
            MAX_SIMC_IDLE_TIMEOUT_SECS,
        )),
        total: Duration::from_secs(resolve_timeout_seconds(
            options,
            "sim_timeout_seconds",
            DEFAULT_SIMC_TOTAL_TIMEOUT_SECS,
            MIN_SIMC_TOTAL_TIMEOUT_SECS,
            MAX_SIMC_TOTAL_TIMEOUT_SECS,
        )),
    }
}

fn timeout_for_next_output_with_idle(
    now: Instant,
    total_deadline: Instant,
    idle_timeout: Duration,
) -> Duration {
    idle_timeout.min(total_deadline.saturating_duration_since(now))
}

pub async fn acquire_simulation_slot(
    job_id: &str,
    queue_order: u64,
) -> std::result::Result<SimulationAdmissionGuard, String> {
    let control = get_or_register_job_control(job_id);
    loop {
        control.wait_until_runnable().await?;

        let guard = tokio::time::timeout(
            Duration::from_millis(250),
            SIMC_ADMISSION.acquire_job_cancellable(job_id, queue_order, control.clone()),
        )
        .await;
        let guard = match guard {
            Ok(Ok(guard)) => guard,
            Ok(Err(error)) => return Err(error),
            Err(_) => {
                SIMC_ADMISSION.remove_waiter(job_id);
                continue;
            }
        };

        if control.is_paused() {
            drop(guard);
            continue;
        }
        if control.is_cancelled() {
            drop(guard);
            return Err("Job cancelled".to_string());
        }
        return Ok(guard);
    }
}

fn resolve_threads(options: &Value) -> u32 {
    let max = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);
    let requested = options.get("threads").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    if requested == 0 {
        max
    } else {
        requested.min(max).max(1)
    }
}

const OVERRIDES: &[&str] = &[
    "override.bloodlust=1",
    "override.arcane_intellect=1",
    "override.power_word_fortitude=1",
    "override.battle_shout=1",
    "override.mystic_touch=1",
    "override.chaos_brand=1",
    "override.skyfury=1",
    "override.mark_of_the_wild=1",
    "override.hunters_mark=1",
    "override.bleeding=1",
];

const SIM_OPTIONS: &[&str] = &[
    "report_details=1",
    "single_actor_batch=1",
    "optimize_expressions=1",
    "temporary_enchant=",
    "scale_only=strength,intellect,agility,crit,mastery,vers,haste,weapon_dps,weapon_offhand_dps",
];

const STAGES: &[Stage] = &[
    Stage {
        name: "Low",
        target_error: 1.0,
        keep_top: 0.5,
        min_keep: 10,
    },
    Stage {
        name: "Medium",
        target_error: 0.2,
        keep_top: 0.3,
        min_keep: 5,
    },
    Stage {
        name: "High",
        target_error: 0.05,
        keep_top: 1.0,
        min_keep: 1,
    },
];

struct Stage {
    name: &'static str,
    target_error: f64,
    keep_top: f64,
    min_keep: usize,
}

fn should_apply_default_overrides(sim_type: &str, raid_buff_customized: bool) -> bool {
    sim_type != "external_buff_matrix" && sim_type != "consumable_matrix" && !raid_buff_customized
}

fn is_dungeon_route_input(simc_input: &str) -> bool {
    simc_input.lines().any(|line| {
        line.trim() == "fight_style=DungeonRoute" || line.trim() == "fight_style=\"DungeonRoute\""
    })
}

#[allow(clippy::too_many_arguments)]
fn build_simc_cli_args(
    input_file: &Path,
    output_file: &Path,
    html_file: Option<&Path>,
    fight_style: &str,
    target_error: f64,
    iterations: u32,
    threads: u32,
    desired_targets: u32,
    max_time: u32,
    calculate_scale_factors: bool,
    dps_plot: Option<(String, u32, u32, u32)>,
    single_actor_batch: bool,
    apply_default_overrides: bool,
    is_dungeon_route: bool,
) -> Vec<String> {
    let mut args = Vec::new();
    args.push(input_file.to_string_lossy().to_string());
    args.push(format!("json2={}", output_file.display()));
    if let Some(html) = html_file {
        args.push(format!("html={}", html.display()));
    }

    args.push(format!("iterations={}", iterations));
    args.push(format!("target_error={}", target_error));
    args.push(format!("threads={}", threads));
    args.push(format!(
        "calculate_scale_factors={}",
        if calculate_scale_factors { "1" } else { "0" }
    ));

    if let Some((stat, points, step, plot_iterations)) = dps_plot {
        args.push(format!("dps_plot_stat={}", stat));
        args.push(format!("dps_plot_points={}", points));
        args.push(format!("dps_plot_step={}", step));
        args.push(format!("dps_plot_iterations={}", plot_iterations));
    }

    if is_dungeon_route {
        args.push(format!("desired_targets={}", desired_targets));
    } else {
        args.push(format!("fight_style={}", fight_style));
        args.push(format!("desired_targets={}", desired_targets));
        args.push(format!("max_time={}", max_time));
        if apply_default_overrides {
            for opt in OVERRIDES {
                args.push((*opt).to_string());
            }
        }
    }

    for opt in SIM_OPTIONS {
        if opt.starts_with("single_actor_batch=") && !single_actor_batch {
            continue;
        }
        args.push((*opt).to_string());
    }

    args
}

fn stage_keep_count(total: usize, keep_top: f64, min_keep: usize) -> usize {
    std::cmp::max(min_keep, (total as f64 * keep_top) as usize)
}

fn sort_profilesets_descending(results: &[Value]) -> Vec<Value> {
    let mut sorted = results.to_vec();
    sorted.sort_by(|a, b| {
        let mean_cmp = b
            .get("mean")
            .and_then(|v| v.as_f64())
            .partial_cmp(&a.get("mean").and_then(|v| v.as_f64()))
            .unwrap_or(std::cmp::Ordering::Equal);
        if mean_cmp != std::cmp::Ordering::Equal {
            return mean_cmp;
        }
        let left = a.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let right = b.get("name").and_then(|n| n.as_str()).unwrap_or("");
        left.cmp(right)
    });
    sorted
}

fn compute_stage_keep_and_eliminated(
    profilesets: &[Value],
    keep_count: usize,
) -> (HashSet<String>, HashMap<String, Value>) {
    let sorted = sort_profilesets_descending(profilesets);
    let keep_set: HashSet<String> = sorted
        .iter()
        .take(keep_count)
        .filter_map(|ps| {
            ps.get("name")
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        })
        .collect();

    let mut eliminated = HashMap::new();
    for ps in &sorted {
        let name = ps.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if !name.is_empty() && !keep_set.contains(name) {
            eliminated.insert(name.to_string(), ps.clone());
        }
    }

    (keep_set, eliminated)
}

fn merge_eliminated_profilesets(final_json: &mut Value, eliminated: HashMap<String, Value>) {
    if eliminated.is_empty() {
        return;
    }
    if let Some(results) = final_json
        .get_mut("sim")
        .and_then(|s| s.get_mut("profilesets"))
        .and_then(|p| p.get_mut("results"))
        .and_then(|r| r.as_array_mut())
    {
        for (_, val) in eliminated {
            results.push(val);
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_simc_subprocess(
    simc_path: &Path,
    job_id: &str,
    simc_input: &str,
    fight_style: &str,
    target_error: f64,
    iterations: u32,
    threads: u32,
    desired_targets: u32,
    max_time: u32,
    calculate_scale_factors: bool,
    dps_plot: Option<(String, u32, u32, u32)>,
    single_actor_batch: bool,
    apply_default_overrides: bool,
    stage_name: &str,
    generate_html: bool,
    timeouts: SimTimeouts,
    on_p: impl Fn(usize, usize),
    on_l: impl Fn(&str),
) -> Result<SimcOutput> {
    let control = get_or_register_job_control(job_id);
    loop {
        control
            .wait_until_runnable()
            .await
            .map_err(AppError::SimcError)?;
        if control.start_execution() {
            break;
        }
    }

    let suffix = if stage_name.is_empty() {
        String::new()
    } else {
        format!("_{}", stage_name)
    };
    let tmp_dir =
        TempDir::with_prefix(format!("simc_{}{}_", job_id, suffix)).map_err(AppError::IoError)?;
    let input_file = tmp_dir.path().join("input.simc");
    let output_file = tmp_dir.path().join("output.json");
    let html_file = tmp_dir.path().join("report.html");

    std::fs::write(&input_file, simc_input).map_err(AppError::IoError)?;
    if !simc_path.exists() {
        return Err(AppError::SimcError(format!(
            "simc binary not found at: {}",
            simc_path.display()
        )));
    }

    #[cfg(windows)]
    let _ = std::fs::remove_file(format!("{}:Zone.Identifier", simc_path.display()));

    let mut cmd = Command::new(simc_path);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000 | 0x00004000);

    let args = build_simc_cli_args(
        &input_file,
        &output_file,
        if generate_html {
            Some(&html_file)
        } else {
            None
        },
        fight_style,
        target_error,
        iterations,
        threads,
        desired_targets,
        max_time,
        calculate_scale_factors,
        dps_plot,
        single_actor_batch,
        apply_default_overrides,
        is_dungeon_route_input(simc_input),
    );
    cmd.args(args);

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::SimcError(format!("Failed to spawn simc: {}", e)))?;
    if let Some(pid) = child.id() {
        RUNNING_PROCESSES
            .lock()
            .unwrap()
            .insert(job_id.to_string(), pid);
        match control.attach_process(pid) {
            ProcessAttachAction::Continue => {}
            ProcessAttachAction::Suspend => {
                if let Err(error) = suspend_process(pid) {
                    let _ = child.kill().await;
                    RUNNING_PROCESSES.lock().unwrap().remove(job_id);
                    control.detach_process();
                    return Err(AppError::SimcError(error));
                }
            }
            ProcessAttachAction::Cancel => {
                let _ = child.kill().await;
                RUNNING_PROCESSES.lock().unwrap().remove(job_id);
                control.detach_process();
                return Err(AppError::SimcError("Job cancelled".into()));
            }
        }
        #[cfg(windows)]
        set_process_affinity(pid, threads);
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<(bool, String)>(256);
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    spawn_reader(stdout, false, tx.clone());
    spawn_reader(stderr, true, tx);

    let mut out_collected = Vec::new();
    let mut err_collected = Vec::new();
    let pause_baseline = control.paused_duration();
    let active_started = Instant::now();

    loop {
        if control.is_paused() {
            if let Err(error) = control.wait_until_runnable().await {
                let _ = child.kill().await;
                RUNNING_PROCESSES.lock().unwrap().remove(job_id);
                control.detach_process();
                return Err(AppError::SimcError(error));
            }
        }
        if control.is_cancelled() {
            let _ = child.kill().await;
            RUNNING_PROCESSES.lock().unwrap().remove(job_id);
            control.detach_process();
            return Err(AppError::SimcError("Job cancelled".into()));
        }

        let paused_since_start = control.paused_duration().saturating_sub(pause_baseline);
        let active_elapsed = active_started.elapsed().saturating_sub(paused_since_start);
        let total_remaining = timeouts.total.saturating_sub(active_elapsed);
        let now = Instant::now();
        let timeout = timeout_for_next_output_with_idle(now, now + total_remaining, timeouts.idle);
        let notified = control.notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if control.is_paused() || control.is_cancelled() {
            continue;
        }
        let sleep = tokio::time::sleep(timeout);
        tokio::pin!(sleep);

        tokio::select! {
            maybe_line = rx.recv() => match maybe_line {
            Some((is_err, line)) => {
                on_l(&line);
                if let Some(caps) = patterns::PROGRESS_RE.captures(&line) {
                    if let (Ok(curr), Ok(total)) =
                        (caps[1].parse::<usize>(), caps[2].parse::<usize>())
                    {
                        if total > 1 && curr <= total {
                            on_p(curr, total);
                        }
                    }
                }
                if is_err {
                    err_collected.push(line);
                } else {
                    out_collected.push(line);
                }
            }
            None => break,
            },
            _ = &mut notified => {
                if control.is_cancelled() {
                    let _ = child.kill().await;
                    RUNNING_PROCESSES.lock().unwrap().remove(job_id);
                    control.detach_process();
                    return Err(AppError::SimcError("Job cancelled".into()));
                }
                continue;
            }
            _ = &mut sleep => {
                let _ = child.kill().await;
                RUNNING_PROCESSES.lock().unwrap().remove(job_id);
                control.detach_process();
                let timeout_kind = if total_remaining <= timeouts.idle {
                    "total"
                } else {
                    "idle-output"
                };
                return Err(AppError::SimcError(format!(
                    "simc {} timeout (idle={}s total={}s)",
                    timeout_kind,
                    timeouts.idle.as_secs(),
                    timeouts.total.as_secs()
                )));
            }
        }
    }

    let status = match child.wait().await {
        Ok(status) => status,
        Err(error) => {
            RUNNING_PROCESSES.lock().unwrap().remove(job_id);
            control.detach_process();
            return Err(AppError::IoError(error));
        }
    };
    RUNNING_PROCESSES.lock().unwrap().remove(job_id);
    control.detach_process();

    if !status.success() {
        let msg = if !err_collected.is_empty() {
            err_collected.join("\n")
        } else {
            out_collected.join("\n")
        };
        let msg = format_simc_failure_message(msg);
        return Err(AppError::SimcError(format!(
            "simc failed (exit {:?}): {}",
            status.code(),
            msg
        )));
    }

    if !output_file.exists() {
        return Err(AppError::SimcError("simc produced no JSON output".into()));
    }
    let json_text = std::fs::read_to_string(&output_file).map_err(AppError::IoError)?;
    let json: Value =
        serde_json::from_str(&json_text).map_err(|e| AppError::SimcError(e.to_string()))?;

    Ok(SimcOutput {
        json,
        html_report: if generate_html {
            std::fs::read_to_string(&html_file).ok()
        } else {
            None
        },
        text_output: if out_collected.is_empty() {
            None
        } else {
            Some(out_collected.join("\n"))
        },
    })
}

fn spawn_reader<R: AsyncReadExt + Unpin + Send + 'static>(
    mut reader: R,
    is_err: bool,
    tx: tokio::sync::mpsc::Sender<(bool, String)>,
) {
    tokio::spawn(async move {
        let mut buf = [0u8; 1024];
        let mut line = String::new();
        while let Ok(n) = reader.read(&mut buf).await {
            if n == 0 {
                break;
            }
            let chunk = String::from_utf8_lossy(&buf[..n]);
            for c in chunk.chars() {
                if c == '\n' || c == '\r' {
                    let trim = line.trim().to_string();
                    if !trim.is_empty() {
                        let _ = tx.send((is_err, trim)).await;
                    }
                    line.clear();
                } else {
                    line.push(c);
                }
            }
        }
        let trim = line.trim().to_string();
        if !trim.is_empty() {
            let _ = tx.send((is_err, trim)).await;
        }
    });
}

fn format_simc_failure_message(message: String) -> String {
    if message.contains("Implementation Not Yet Verified:") {
        return format!(
            "SimulationCraft cannot model one of the selected item effects yet. Remove the affected item or install a newer SimC runtime. Details: {message}"
        );
    }

    message
}

fn get_profileset_results(raw: &Value) -> Vec<Value> {
    raw.get("sim")
        .and_then(|s| s.get("profilesets"))
        .and_then(|p| p.get("results"))
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default()
}

pub fn filter_simc_input(input: &str, keep: &HashSet<String>) -> String {
    let mut out = Vec::new();
    let mut current = None;
    let mut in_kept = true;
    for line in input.lines() {
        if let Some(caps) = patterns::HEADER_RE.captures(line) {
            let name = caps[1].to_string();
            in_kept = keep.contains(&name);
            current = Some(name);
            if in_kept {
                out.push(line);
            }
            continue;
        }
        if line.trim().starts_with("profileset.")
            || (current.is_some() && line.trim().starts_with('#'))
        {
            if in_kept {
                out.push(line);
            }
            continue;
        }
        out.push(line);
        current = None;
        in_kept = true;
    }
    out.join("\n")
}

pub async fn run_simc(
    simc_path: &Path,
    job_id: &str,
    simc_input: &str,
    options: &Value,
    on_p: impl Fn(usize, usize),
    on_l: impl Fn(&str),
) -> Result<SimcOutput> {
    let _control_guard = JobControlGuard {
        job_id: job_id.to_string(),
    };
    let _cancellation = CancellationGuard::new(job_id);
    let f = options
        .get("fight_style")
        .and_then(|v| v.as_str())
        .unwrap_or("Patchwerk");
    let e = options
        .get("target_error")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.2);
    let i = options
        .get("iterations")
        .and_then(|v| v.as_u64())
        .unwrap_or(1000) as u32;
    let sim_type = options
        .get("sim_type")
        .and_then(|v| v.as_str())
        .unwrap_or("quick");
    let is_stat_weights = sim_type == "stat_weights";
    let is_stat_plot = sim_type == "stat_plot";
    let raid_buff_customized = options
        .get("raid_buff_customized")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let apply_default_overrides = should_apply_default_overrides(sim_type, raid_buff_customized);
    let t = resolve_threads(options);
    let timeouts = resolve_sim_timeouts(options);
    let d = options
        .get("desired_targets")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;
    let m = options
        .get("max_time")
        .and_then(|v| v.as_u64())
        .unwrap_or(300) as u32;
    let b = options
        .get("single_actor_batch")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let dps_plot = if is_stat_plot {
        let stat = options
            .get("dps_plot_stat")
            .and_then(|v| v.as_str())
            .unwrap_or("haste_rating")
            .trim()
            .to_string();
        let points = options
            .get("dps_plot_points")
            .and_then(|v| v.as_u64())
            .unwrap_or(10) as u32;
        let step = options
            .get("dps_plot_step")
            .and_then(|v| v.as_u64())
            .unwrap_or(100) as u32;
        let plot_iterations = options
            .get("dps_plot_iterations")
            .and_then(|v| v.as_u64())
            .unwrap_or(i as u64) as u32;

        if stat.is_empty() {
            None
        } else {
            Some((stat, points.max(1), step.max(1), plot_iterations.max(1)))
        }
    } else {
        None
    };

    run_simc_subprocess(
        simc_path,
        job_id,
        simc_input,
        f,
        e,
        i,
        t,
        d,
        m,
        is_stat_weights,
        dps_plot,
        b,
        apply_default_overrides,
        "",
        true,
        timeouts,
        on_p,
        on_l,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn run_simc_staged(
    simc_path: &Path,
    job_id: &str,
    simc_input: &str,
    options: &Value,
    combo_count: usize,
    on_p: impl Fn(u8, &str, &str),
    on_sc: impl Fn(&str),
    on_l: impl Fn(&str) + Clone,
) -> Result<SimcOutput> {
    let _control_guard = JobControlGuard {
        job_id: job_id.to_string(),
    };
    let _cancellation = CancellationGuard::new(job_id);
    let f = options
        .get("fight_style")
        .and_then(|v| v.as_str())
        .unwrap_or("Patchwerk");
    let user_iter = options
        .get("iterations")
        .and_then(|v| v.as_u64())
        .unwrap_or(1000) as u32;
    let threads = resolve_threads(options);
    let timeouts = resolve_sim_timeouts(options);
    let desired = options
        .get("desired_targets")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;
    let max_t = options
        .get("max_time")
        .and_then(|v| v.as_u64())
        .unwrap_or(300) as u32;
    let batch = options
        .get("single_actor_batch")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let sim_type = options
        .get("sim_type")
        .and_then(|v| v.as_str())
        .unwrap_or("top_gear");
    let raid_buff_customized = options
        .get("raid_buff_customized")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let apply_default_overrides = should_apply_default_overrides(sim_type, raid_buff_customized);

    if combo_count < 10 {
        on_p(5, "Simulating", &format!("{} combos", combo_count));
        let error = options
            .get("target_error")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.2);
        return run_simc_subprocess(
            simc_path,
            job_id,
            simc_input,
            f,
            error,
            user_iter,
            threads,
            desired,
            max_t,
            false,
            None,
            batch,
            apply_default_overrides,
            "direct",
            false,
            timeouts,
            |c, t| {
                on_p(
                    5 + ((c as f64 / t as f64) * 90.0) as u8,
                    "Simulating",
                    &format!("{}/{} profilesets", c, t),
                );
            },
            on_l,
        )
        .await;
    }

    let mut current_input = simc_input.to_string();
    let mut remaining = combo_count;
    let mut result = None;
    let mut eliminated = HashMap::new();

    let stage_iters = [
        std::cmp::max(100, user_iter / 10),
        std::cmp::max(500, user_iter / 2),
        user_iter,
    ];
    let stage_ranges = [(10, 40), (40, 70), (70, 95)];

    for (idx, stage) in STAGES.iter().enumerate() {
        let (start, end) = stage_ranges[idx];
        on_p(
            start,
            &format!("Stage {} of {}", idx + 1, STAGES.len()),
            &format!("{} combos · {}", remaining, stage.name),
        );

        let res = run_simc_subprocess(
            simc_path,
            job_id,
            &current_input,
            f,
            stage.target_error,
            stage_iters[idx],
            threads,
            desired,
            max_t,
            false,
            None,
            batch,
            apply_default_overrides,
            &stage.name.to_lowercase(),
            false,
            timeouts,
            |c, t| {
                on_p(
                    start + ((c as f64 / t as f64) * (end - start) as f64) as u8,
                    &format!("Stage {} of {}", idx + 1, STAGES.len()),
                    &format!("{}/{} profilesets · {}", c, t, stage.name),
                );
            },
            on_l.clone(),
        )
        .await?;

        result = Some(res);
        if idx == STAGES.len() - 1 {
            on_sc(&format!("{} · done", stage.name));
            break;
        }

        let profilesets = get_profileset_results(&result.as_ref().unwrap().json);
        if profilesets.is_empty() {
            break;
        }

        let keep = stage_keep_count(profilesets.len(), stage.keep_top, stage.min_keep);
        if keep >= profilesets.len() {
            continue;
        }

        let (keep_set, stage_eliminated) = compute_stage_keep_and_eliminated(&profilesets, keep);
        eliminated.extend(stage_eliminated);
        current_input = filter_simc_input(&current_input, &keep_set);
        remaining = keep_set.len();
        on_sc(&format!("{} · kept {}", stage.name, remaining));
    }

    let mut final_res = result.unwrap();
    merge_eliminated_profilesets(&mut final_res.json, eliminated);
    Ok(final_res)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    #[test]
    fn job_control_pauses_and_resumes_pending_and_running_jobs() {
        let pending_id = "control-pending-test";
        cleanup_job_control(pending_id);
        cleanup_cancelled_job(pending_id);
        register_job_control(pending_id);
        assert_eq!(control_status(pending_id), Some(JobControlState::Pending));

        pause_job(pending_id).expect("pending job should pause");
        assert_eq!(control_status(pending_id), Some(JobControlState::Paused));
        assert_eq!(
            resume_job(pending_id).expect("pending job should resume"),
            JobControlState::Pending
        );
        cleanup_job_control(pending_id);

        let running_id = "control-running-test";
        cleanup_job_control(running_id);
        cleanup_cancelled_job(running_id);
        register_job_control(running_id);
        assert!(start_job_control(running_id));
        pause_job(running_id).expect("running job should pause");
        assert_eq!(
            resume_job(running_id).expect("running job should resume"),
            JobControlState::Running
        );
        cleanup_job_control(running_id);
    }

    #[tokio::test]
    async fn simulation_admission_limit_can_be_increased_while_a_job_is_running() {
        let admission = Arc::new(SimulationAdmission::new(1));
        let first = admission.acquire_job("limit-first", 1).await;
        let (acquired_tx, acquired_rx) = tokio::sync::oneshot::channel();
        let waiting_admission = admission.clone();

        let waiting = tokio::spawn(async move {
            let _second = waiting_admission.acquire_job("limit-second", 2).await;
            acquired_tx
                .send(())
                .expect("acquisition receiver should exist");
        });

        tokio::task::yield_now().await;
        admission.set_limit(2);
        tokio::time::timeout(Duration::from_secs(1), acquired_rx)
            .await
            .expect("increasing the limit should wake queued jobs")
            .expect("queued job should acquire a slot");

        drop(first);
        waiting.await.expect("waiting job should finish");
    }

    #[tokio::test]
    async fn simulation_admission_uses_persisted_queue_order() {
        let admission = Arc::new(SimulationAdmission::new(1));
        let first = admission.acquire_job("queue-first", 100).await;
        let (low_started_tx, low_started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let low_admission = admission.clone();
        let low = tokio::spawn(async move {
            let _guard = low_admission.acquire_job("queue-low", 1).await;
            low_started_tx.send(()).expect("low-priority test receiver");
            release_rx.await.expect("low-priority release signal");
        });

        let (high_started_tx, high_started_rx) = tokio::sync::oneshot::channel();
        let high_admission = admission.clone();
        let high = tokio::spawn(async move {
            let _guard = high_admission.acquire_job("queue-high", 50).await;
            let _ = high_started_tx.send(());
        });

        tokio::time::sleep(Duration::from_millis(20)).await;
        drop(first);
        tokio::time::timeout(Duration::from_secs(1), low_started_rx)
            .await
            .expect("the lowest queue order should acquire first")
            .expect("low-order job should start");
        assert!(
            tokio::time::timeout(Duration::from_millis(50), high_started_rx)
                .await
                .is_err()
        );
        release_tx.send(()).expect("release signal receiver");
        high.await.expect("high-order job should finish");
        low.await.expect("low-order job should finish");
    }

    #[tokio::test]
    async fn cancelling_a_waiting_job_does_not_block_following_jobs() {
        let admission = Arc::new(SimulationAdmission::new(1));
        let first = admission.acquire_job("cancel-first", 1).await;
        let cancelled_control = Arc::new(SimulationControl::new("cancel-waiting"));
        let waiting_admission = admission.clone();
        let waiting_control = cancelled_control.clone();
        let waiting = tokio::spawn(async move {
            waiting_admission
                .acquire_job_cancellable("cancel-waiting", 2, waiting_control)
                .await
        });

        tokio::time::sleep(Duration::from_millis(20)).await;
        cancelled_control.cancel();
        assert!(waiting.await.expect("cancelled waiter should finish").is_err());

        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let next_admission = admission.clone();
        let next = tokio::spawn(async move {
            let _guard = next_admission.acquire_job("cancel-next", 3).await;
            started_tx.send(()).expect("next job receiver");
        });
        drop(first);
        tokio::time::timeout(Duration::from_secs(1), started_rx)
            .await
            .expect("a cancelled waiter must not block the next job")
            .expect("next job should start");
        next.await.expect("next job should finish");
    }

    #[tokio::test]
    async fn paused_subprocess_keeps_the_same_process_until_resumed() {
        let job_id = "control-subprocess-test";
        cleanup_job_control(job_id);
        cleanup_cancelled_job(job_id);
        register_job_control(job_id);
        assert!(start_job_control(job_id));

        let script = fake_simc_script("control-subprocess", "pause");
        let task = tokio::spawn(async move {
            run_simc_subprocess(
                &script,
                job_id,
                "warrior=\"Tester\"\n",
                "Patchwerk",
                0.2,
                100,
                1,
                1,
                300,
                false,
                None,
                true,
                true,
                "",
                false,
                SimTimeouts::default(),
                |_, _| {},
                |_| {},
            )
            .await
        });

        let pid = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Some(pid) = RUNNING_PROCESSES.lock().unwrap().get(job_id).copied() {
                    break pid;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("fake SimC process should start");

        pause_job(job_id).expect("running subprocess should pause");
        assert_eq!(control_status(job_id), Some(JobControlState::Paused));
        tokio::time::sleep(Duration::from_millis(250)).await;
        assert_eq!(
            RUNNING_PROCESSES.lock().unwrap().get(job_id).copied(),
            Some(pid)
        );

        assert_eq!(
            resume_job(job_id).expect("paused subprocess should resume"),
            JobControlState::Running
        );
        task.await
            .expect("subprocess task should join")
            .expect("fake SimC should finish after resume");
        assert!(!RUNNING_PROCESSES.lock().unwrap().contains_key(job_id));
        cleanup_job_control(job_id);
    }

    #[test]
    fn should_apply_default_overrides_follows_sim_type_and_customization() {
        assert!(should_apply_default_overrides("quick", false));
        assert!(!should_apply_default_overrides("quick", true));
        assert!(!should_apply_default_overrides("consumable_matrix", false));
        assert!(!should_apply_default_overrides(
            "external_buff_matrix",
            false
        ));
        assert!(should_apply_default_overrides("top_gear", false));
    }

    #[test]
    fn resolve_threads_defaults_and_clamps() {
        let max_threads = std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4);

        assert_eq!(resolve_threads(&json!({})), max_threads);
        assert_eq!(resolve_threads(&json!({"threads": 0})), max_threads);
        assert_eq!(resolve_threads(&json!({"threads": 1})), 1);
        assert_eq!(resolve_threads(&json!({"threads": 999999})), max_threads);
        assert_eq!(resolve_threads(&json!({"threads": "bad"})), max_threads);
    }

    #[test]
    fn dungeon_route_detection_supports_exact_trimmed_forms_only() {
        assert!(is_dungeon_route_input("fight_style=DungeonRoute\n"));
        assert!(is_dungeon_route_input("  fight_style=DungeonRoute  \n"));
        assert!(is_dungeon_route_input("fight_style=\"DungeonRoute\"\n"));
        assert!(!is_dungeon_route_input("fight_style=Patchwerk\n"));
        assert!(!is_dungeon_route_input("fight_style = DungeonRoute\n"));
    }

    #[test]
    fn unsupported_item_effect_failure_explains_the_recovery_action() {
        let message = format_simc_failure_message(
            "Implementation Not Yet Verified: Emberwing Feather".to_string(),
        );

        assert!(message.contains("Remove the affected item"));
        assert!(message.contains("newer SimC runtime"));
        assert!(message.contains("Emberwing Feather"));
    }

    #[test]
    fn build_simc_cli_args_non_dungeon_includes_expected_options() {
        let args = build_simc_cli_args(
            Path::new("input.simc"),
            Path::new("output.json"),
            Some(Path::new("report.html")),
            "Patchwerk",
            0.2,
            1000,
            8,
            1,
            300,
            true,
            Some(("haste_rating".to_string(), 10, 100, 500)),
            true,
            true,
            false,
        );

        assert!(args.contains(&"input.simc".to_string()));
        assert!(args.iter().any(|arg| arg == "json2=output.json"));
        assert!(args.iter().any(|arg| arg == "html=report.html"));
        assert!(args.iter().any(|arg| arg == "iterations=1000"));
        assert!(args.iter().any(|arg| arg == "target_error=0.2"));
        assert!(args.iter().any(|arg| arg == "threads=8"));
        assert!(args.iter().any(|arg| arg == "calculate_scale_factors=1"));
        assert!(args.iter().any(|arg| arg == "dps_plot_stat=haste_rating"));
        assert!(args.iter().any(|arg| arg == "dps_plot_points=10"));
        assert!(args.iter().any(|arg| arg == "dps_plot_step=100"));
        assert!(args.iter().any(|arg| arg == "dps_plot_iterations=500"));
        assert!(args.iter().any(|arg| arg == "fight_style=Patchwerk"));
        assert!(args.iter().any(|arg| arg == "desired_targets=1"));
        assert!(args.iter().any(|arg| arg == "max_time=300"));
        assert!(args.iter().any(|arg| arg == "override.bloodlust=1"));
        assert!(args.iter().any(|arg| arg == "single_actor_batch=1"));
        assert!(args.iter().any(|arg| arg == "report_details=1"));
    }

    #[test]
    fn build_simc_cli_args_non_dungeon_can_skip_default_overrides_and_batch_flag() {
        let args = build_simc_cli_args(
            Path::new("input.simc"),
            Path::new("output.json"),
            None,
            "Patchwerk",
            0.2,
            1000,
            8,
            1,
            300,
            false,
            None,
            false,
            false,
            false,
        );

        assert!(!args.iter().any(|arg| arg.starts_with("html=")));
        assert!(args.iter().any(|arg| arg == "calculate_scale_factors=0"));
        assert!(!args.iter().any(|arg| arg.starts_with("override.")));
        assert!(!args.iter().any(|arg| arg == "single_actor_batch=1"));
    }

    #[test]
    fn build_simc_cli_args_dungeon_route_omits_fight_style_max_time_and_overrides() {
        let args = build_simc_cli_args(
            Path::new("input.simc"),
            Path::new("output.json"),
            None,
            "Patchwerk",
            0.2,
            1000,
            8,
            3,
            400,
            false,
            None,
            false,
            true,
            true,
        );

        assert!(args.iter().any(|arg| arg == "desired_targets=3"));
        assert!(!args.iter().any(|arg| arg.starts_with("fight_style=")));
        assert!(!args.iter().any(|arg| arg.starts_with("max_time=")));
        assert!(!args.iter().any(|arg| arg.starts_with("override.")));
        assert!(!args.iter().any(|arg| arg == "single_actor_batch=1"));
    }

    #[test]
    fn stage_keep_count_respects_minimum_and_fraction() {
        assert_eq!(stage_keep_count(100, 0.3, 5), 30);
        assert_eq!(stage_keep_count(6, 0.3, 5), 5);
        assert_eq!(stage_keep_count(1, 1.0, 1), 1);
        assert_eq!(stage_keep_count(0, 0.5, 10), 10);
    }

    #[test]
    fn sort_profilesets_descending_orders_by_mean_then_name() {
        let sorted = sort_profilesets_descending(&[
            json!({"name": "Combo B", "mean": 100.0}),
            json!({"name": "Combo A", "mean": 100.0}),
            json!({"name": "Combo C", "mean": 95.0}),
            json!({"name": "Combo D"}),
        ]);

        let names = sorted
            .iter()
            .map(|v| v["name"].as_str().unwrap_or(""))
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["Combo A", "Combo B", "Combo C", "Combo D"]);
    }

    #[test]
    fn compute_stage_keep_and_eliminated_is_deterministic_for_ties() {
        let profilesets = vec![
            json!({"name": "Combo B", "mean": 100.0}),
            json!({"name": "Combo A", "mean": 100.0}),
            json!({"name": "Combo C", "mean": 95.0}),
        ];

        let (keep_set, eliminated) = compute_stage_keep_and_eliminated(&profilesets, 2);

        assert_eq!(
            keep_set,
            HashSet::from(["Combo A".to_string(), "Combo B".to_string()])
        );
        assert_eq!(eliminated.len(), 1);
        assert!(eliminated.contains_key("Combo C"));
    }

    #[test]
    fn compute_stage_keep_and_eliminated_ignores_entries_without_names_for_sets() {
        let profilesets = vec![
            json!({"name": "Combo A", "mean": 100.0}),
            json!({"mean": 90.0}),
            json!({"name": "", "mean": 80.0}),
        ];

        let (keep_set, eliminated) = compute_stage_keep_and_eliminated(&profilesets, 1);

        assert_eq!(keep_set, HashSet::from(["Combo A".to_string()]));
        assert!(eliminated.is_empty());
    }

    #[test]
    fn merge_eliminated_profilesets_appends_to_existing_results() {
        let mut raw = json!({
            "sim": {
                "profilesets": {
                    "results": [
                        {"name": "Combo 1", "mean": 100.0}
                    ]
                }
            }
        });

        merge_eliminated_profilesets(
            &mut raw,
            HashMap::from([(
                "Combo 2".to_string(),
                json!({"name": "Combo 2", "mean": 90.0}),
            )]),
        );

        let results = raw["sim"]["profilesets"]["results"].as_array().unwrap();

        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .any(|entry| entry["name"] == json!("Combo 2")));
    }

    #[test]
    fn merge_eliminated_profilesets_noops_when_map_or_result_path_is_empty() {
        let mut raw = json!({});
        merge_eliminated_profilesets(&mut raw, HashMap::new());
        assert_eq!(raw, json!({}));

        merge_eliminated_profilesets(
            &mut raw,
            HashMap::from([("Combo 1".to_string(), json!({"name": "Combo 1"}))]),
        );
        assert_eq!(raw, json!({}));
    }

    #[test]
    fn get_profileset_results_returns_results_or_empty_vec() {
        let raw = json!({
            "sim": {
                "profilesets": {
                    "results": [
                        {"name": "Combo 1"},
                        {"name": "Combo 2"}
                    ]
                }
            }
        });

        assert_eq!(get_profileset_results(&raw).len(), 2);
        assert!(get_profileset_results(&json!({})).is_empty());
        assert!(
            get_profileset_results(&json!({"sim": {"profilesets": {"results": "bad"}}})).is_empty()
        );
    }

    #[test]
    fn filter_simc_input_keeps_only_selected_profilesets() {
        let input = r#"
mage="Tester"
### Combo 1
profileset."Combo 1"+=head=id=1
# keep comment
### Combo 2
profileset."Combo 2"+=head=id=2
# drop comment
fight_style=Patchwerk
"#;

        let keep = HashSet::from(["Combo 1".to_string()]);
        let filtered = filter_simc_input(input, &keep);

        assert!(filtered.contains("profileset.\"Combo 1\""));
        assert!(filtered.contains("# keep comment"));
        assert!(!filtered.contains("profileset.\"Combo 2\""));
        assert!(!filtered.contains("# drop comment"));
        assert!(filtered.contains("fight_style=Patchwerk"));
    }

    #[test]
    fn filter_simc_input_keeps_base_lines_and_resets_after_dropped_profileset() {
        let input = r#"
warrior="Tester"
### Combo 1
profileset."Combo 1"+=head=id=1
### Combo 2
profileset."Combo 2"+=head=id=2
iterations=1000
profileset."not attached to combo"+=bad=1
"#;

        let keep = HashSet::from(["Combo 1".to_string()]);
        let filtered = filter_simc_input(input, &keep);

        assert!(filtered.contains("warrior=\"Tester\""));
        assert!(filtered.contains("profileset.\"Combo 1\""));
        assert!(!filtered.contains("profileset.\"Combo 2\""));
        assert!(filtered.contains("iterations=1000"));
        assert!(filtered.contains("profileset.\"not attached to combo\"+=bad=1"));
    }

    #[test]
    fn filter_simc_input_with_empty_keep_removes_all_combo_blocks() {
        let input = r#"
mage="Tester"
### Combo 1
profileset."Combo 1"+=head=id=1
# comment
### Combo 2
profileset."Combo 2"+=head=id=2
fight_style=Patchwerk
"#;

        let filtered = filter_simc_input(input, &HashSet::new());

        assert!(filtered.contains("mage=\"Tester\""));
        assert!(!filtered.contains("### Combo 1"));
        assert!(!filtered.contains("profileset.\"Combo 1\""));
        assert!(!filtered.contains("### Combo 2"));
        assert!(!filtered.contains("profileset.\"Combo 2\""));
        assert!(filtered.contains("fight_style=Patchwerk"));
    }

    #[tokio::test]
    async fn spawn_reader_emits_trimmed_non_empty_stdout_lines() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(8);

        spawn_reader(
            tokio::io::BufReader::new(" one \n\n two\rthree".as_bytes()),
            false,
            tx,
        );

        let first = rx.recv().await.expect("first line");
        let second = rx.recv().await.expect("second line");
        let third = rx.recv().await.expect("third line");

        assert_eq!(first, (false, "one".to_string()));
        assert_eq!(second, (false, "two".to_string()));
        assert_eq!(third, (false, "three".to_string()));
        assert!(rx.recv().await.is_none());
    }

    #[tokio::test]
    async fn spawn_reader_marks_stderr_lines() {
        let (tx, mut rx) = tokio::sync::mpsc::channel(8);

        spawn_reader(tokio::io::BufReader::new("err line\n".as_bytes()), true, tx);

        assert_eq!(
            rx.recv().await.expect("stderr line"),
            (true, "err line".to_string())
        );
        assert!(rx.recv().await.is_none());
    }

    #[test]
    fn kill_job_without_registered_process_marks_job_cancelled_and_returns_false() {
        let job_id = "test-kill-missing";
        cleanup_cancelled_job(job_id);

        assert!(!kill_job(job_id));

        assert!(CANCELLED_JOBS.lock().unwrap().contains(job_id));
        cleanup_cancelled_job(job_id);
        assert!(!CANCELLED_JOBS.lock().unwrap().contains(job_id));
    }

    #[test]
    fn cancellation_guard_clears_marker_when_scope_ends() {
        let job_id = "guard-cleanup-job";
        cleanup_cancelled_job(job_id);
        kill_job(job_id);
        assert!(CANCELLED_JOBS.lock().unwrap().contains(job_id));

        {
            let _guard = CancellationGuard::new(job_id);
            assert!(CANCELLED_JOBS.lock().unwrap().contains(job_id));
        }

        assert!(!CANCELLED_JOBS.lock().unwrap().contains(job_id));
    }

    #[test]
    fn subprocess_timeout_uses_the_earlier_idle_or_total_deadline() {
        let now = std::time::Instant::now();
        let idle_timeout = Duration::from_secs(DEFAULT_SIMC_IDLE_TIMEOUT_SECS);
        let total_deadline = now + idle_timeout + Duration::from_secs(5);

        assert_eq!(
            timeout_for_next_output_with_idle(now, total_deadline, idle_timeout),
            idle_timeout
        );

        let near_deadline = total_deadline - Duration::from_secs(1);
        assert!(
            timeout_for_next_output_with_idle(near_deadline, total_deadline, idle_timeout)
                <= Duration::from_secs(1)
        );
    }

    #[test]
    fn simulation_timeouts_default_and_clamp() {
        let defaults = resolve_sim_timeouts(&json!({}));
        assert_eq!(
            defaults.total,
            Duration::from_secs(DEFAULT_SIMC_TOTAL_TIMEOUT_SECS)
        );
        assert_eq!(
            defaults.idle,
            Duration::from_secs(DEFAULT_SIMC_IDLE_TIMEOUT_SECS)
        );

        let bounded = resolve_sim_timeouts(&json!({
            "sim_timeout_seconds": 1,
            "sim_idle_timeout_seconds": 999999
        }));
        assert_eq!(
            bounded.total,
            Duration::from_secs(MIN_SIMC_TOTAL_TIMEOUT_SECS)
        );
        assert_eq!(
            bounded.idle,
            Duration::from_secs(MAX_SIMC_IDLE_TIMEOUT_SECS)
        );
    }

    #[test]
    fn get_process_stats_returns_none_for_unknown_job() {
        assert_eq!(get_process_stats("missing-job"), None);
    }

    #[tokio::test]
    async fn run_simc_returns_error_when_binary_is_missing() {
        let dir = tempfile::tempdir().expect("temp dir");
        let missing = dir.path().join("missing-simc");

        let err = run_simc(
            &missing,
            "missing-binary-job",
            "warrior=\"Tester\"\n",
            &json!({}),
            |_, _| {},
            |_| {},
        )
        .await
        .expect_err("missing binary should fail");

        assert!(err.to_string().contains("simc binary not found"));
    }

    #[tokio::test]
    async fn run_simc_subprocess_errors_when_json_output_is_missing_or_invalid() {
        let script = fake_simc_script("bad-json", "bad-json");

        let err = run_simc_subprocess(
            &script,
            "no-json-job",
            "warrior=\"Tester\"\n",
            "Patchwerk",
            0.2,
            100,
            1,
            1,
            300,
            false,
            None,
            true,
            true,
            "",
            false,
            SimTimeouts::default(),
            |_, _| {},
            |_| {},
        )
        .await
        .expect_err("missing json should fail");

        let msg = err.to_string();
        assert!(
            msg.contains("simc produced no JSON output")
                || msg.contains("expected ident")
                || msg.contains("EOF while parsing")
                || msg.contains("JSON"),
            "unexpected error: {msg}"
        );
    }

    #[tokio::test]
    async fn run_simc_subprocess_returns_error_for_invalid_json_output() {
        let script = fake_simc_script("bad-json", "bad-json");

        let err = run_simc_subprocess(
            &script,
            "bad-json-job",
            "warrior=\"Tester\"\n",
            "Patchwerk",
            0.2,
            100,
            1,
            1,
            300,
            false,
            None,
            true,
            true,
            "",
            false,
            SimTimeouts::default(),
            |_, _| {},
            |_| {},
        )
        .await
        .expect_err("bad json should fail");

        assert!(err.to_string().contains("expected ident") || err.to_string().contains("JSON"));
    }

    #[tokio::test]
    async fn run_simc_subprocess_returns_error_for_nonzero_exit_and_prefers_stderr() {
        let script = fake_simc_script("nonzero", "nonzero");

        let err = run_simc_subprocess(
            &script,
            "nonzero-job",
            "warrior=\"Tester\"\n",
            "Patchwerk",
            0.2,
            100,
            1,
            1,
            300,
            false,
            None,
            true,
            true,
            "",
            false,
            SimTimeouts::default(),
            |_, _| {},
            |_| {},
        )
        .await
        .expect_err("nonzero should fail");

        let msg = err.to_string();
        assert!(msg.contains("simc failed"));
        assert!(msg.contains("stderr failure"));
    }

    #[tokio::test]
    async fn run_simc_subprocess_success_reads_json_html_text_and_progress() {
        let script = fake_simc_script("success", "success");

        let progress = Arc::new(Mutex::new(Vec::<(usize, usize)>::new()));
        let logs = Arc::new(Mutex::new(Vec::<String>::new()));

        let p = progress.clone();
        let l = logs.clone();

        let output = run_simc_subprocess(
            &script,
            "success-job",
            "warrior=\"Tester\"\n",
            "Patchwerk",
            0.2,
            100,
            1,
            1,
            300,
            false,
            None,
            true,
            true,
            "",
            true,
            SimTimeouts::default(),
            move |current, total| {
                p.lock().unwrap().push((current, total));
            },
            move |line| {
                l.lock().unwrap().push(line.to_string());
            },
        )
        .await
        .expect("successful fake simc");

        assert_eq!(
            output.json["sim"]["profilesets"]["results"][0]["name"],
            json!("Combo 1")
        );
        assert_eq!(
            output
                .html_report
                .as_deref()
                .map(|s| s.replace("\r\n", "\n")),
            Some("<html>report</html>\n".to_string())
        );
        assert!(output.text_output.as_deref().unwrap_or("").contains("done"));
        assert_eq!(*progress.lock().unwrap(), vec![(1, 4), (2, 4)]);
        assert!(logs.lock().unwrap().iter().any(|line| line == "done"));
    }

    #[tokio::test]
    async fn run_simc_wrapper_builds_stat_plot_options_and_succeeds() {
        let script = fake_simc_script("wrapper-stat-plot", "wrapper-stat-plot");

        let output = run_simc(
            &script,
            "wrapper-stat-plot-job",
            "warrior=\"Tester\"\n",
            &json!({
                "sim_type": "stat_plot",
                "dps_plot_stat": " haste_rating ",
                "dps_plot_points": 0,
                "dps_plot_step": 0,
                "dps_plot_iterations": 0,
                "iterations": 100,
                "threads": 1
            }),
            |_, _| {},
            |_| {},
        )
        .await
        .expect("stat plot wrapper should succeed");

        assert_eq!(output.json["ok"], json!(true));
    }

    #[tokio::test]
    async fn run_simc_staged_direct_path_is_used_for_small_combo_counts() {
        let script = fake_simc_script("staged-direct", "staged-direct");

        let progress = Arc::new(Mutex::new(Vec::<String>::new()));
        let p = progress.clone();

        let output = run_simc_staged(
            &script,
            "staged-direct-job",
            "warrior=\"Tester\"\n### Combo 1\nprofileset.\"Combo 1\"+=head=id=1\n",
            &json!({
                "iterations": 100,
                "threads": 1
            }),
            2,
            move |_, phase, detail| {
                p.lock().unwrap().push(format!("{phase}:{detail}"));
            },
            |_| {},
            |_| {},
        )
        .await
        .expect("direct staged run");

        assert_eq!(
            output.json["sim"]["profilesets"]["results"][0]["name"],
            json!("Combo 1")
        );
        assert!(progress
            .lock()
            .unwrap()
            .iter()
            .any(|line| line.contains("2 combos")));
    }

    fn fake_simc_script(name: &str, mode: &str) -> PathBuf {
        let dir = tempfile::tempdir().expect("fake simc dir").keep();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let path = dir.join(name);

            let body = match mode {
                "no-json" => {
                    r#"#!/usr/bin/env bash
                echo "1/2"
                exit 0
                "#
                }
                "bad-json" => {
                    r#"#!/usr/bin/env bash
                for arg in "$@"; do
                  case "$arg" in
                    json2=*) out="${arg#json2=}" ;;
                  esac
                done
                echo "not-json" > "$out"
                exit 0
                "#
                }
                "nonzero" => {
                    r#"#!/usr/bin/env bash
                echo "stdout failure"
                echo "stderr failure" >&2
                exit 42
                "#
                }
                "success" => {
                    r#"#!/usr/bin/env bash
                for arg in "$@"; do
                  case "$arg" in
                    json2=*) out="${arg#json2=}" ;;
                    html=*) html="${arg#html=}" ;;
                  esac
                done
                echo "1/4"
                echo "2/4"
                echo '{"sim":{"profilesets":{"results":[{"name":"Combo 1","mean":100.0}]}}}' > "$out"
                if [ -n "$html" ]; then
                  echo "<html>report</html>" > "$html"
                fi
                echo "done"
                exit 0
                "#
                }
                "wrapper-stat-plot" => {
                    r#"#!/usr/bin/env bash
                for arg in "$@"; do
                  case "$arg" in
                    json2=*) out="${arg#json2=}" ;;
                    dps_plot_stat=*) saw_stat=1 ;;
                    dps_plot_points=1) saw_points=1 ;;
                    dps_plot_step=1) saw_step=1 ;;
                    dps_plot_iterations=1) saw_iterations=1 ;;
                  esac
                done
                if [ -z "$saw_stat" ] || [ -z "$saw_points" ] || [ -z "$saw_step" ] || [ -z "$saw_iterations" ]; then
                  echo "missing stat plot args" >&2
                  exit 9
                fi
                echo '{"ok":true}' > "$out"
                exit 0
                "#
                }
                "staged-direct" => {
                    r#"#!/usr/bin/env bash
                for arg in "$@"; do
                  case "$arg" in
                    json2=*) out="${arg#json2=}" ;;
                  esac
                done
                echo '{"sim":{"profilesets":{"results":[{"name":"Combo 1","mean":100.0}]}}}' > "$out"
                exit 0
                "#
                }
                "pause" => {
                    r#"#!/usr/bin/env bash
                for arg in "$@"; do
                  case "$arg" in
                    json2=*) out="${arg#json2=}" ;;
                  esac
                done
                echo "1/2"
                sleep 2
                echo '{"ok":true}' > "$out"
                exit 0
                "#
                }
                other => panic!("unknown fake simc mode: {other}"),
            };

            std::fs::write(&path, body).expect("write fake simc");
            let mut permissions = std::fs::metadata(&path)
                .expect("fake simc metadata")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&path, permissions).expect("chmod fake simc");

            path
        }

        #[cfg(windows)]
        {
            let path = dir.join(format!("{name}.cmd"));

            let body = match mode {
                "no-json" => {
                    r#"@echo off
                echo 1/2
                exit /b 0
                "#
                }
                "bad-json" => {
                    r#"@echo off
                set "out="
                :loop
                if "%~1"=="" goto done
                set "arg=%~1"
                if "%arg:~0,6%"=="json2=" set "out=%arg:~6%"
                shift
                goto loop
                :done
                echo not-json>"%out%"
                exit /b 0
                "#
                }
                "nonzero" => {
                    r#"@echo off
                echo stdout failure
                echo stderr failure 1>&2
                exit /b 42
                "#
                }
                "success" => {
                    r#"@echo off
                set "out="
                set "html="
                :loop
                if "%~1"=="" goto done
                set "arg=%~1"
                if "%arg:~0,6%"=="json2=" set "out=%arg:~6%"
                if "%arg:~0,5%"=="html=" set "html=%arg:~5%"
                shift
                goto loop
                :done
                echo 1/4
                echo 2/4
                echo {"sim":{"profilesets":{"results":[{"name":"Combo 1","mean":100.0}]}}}>"%out%"
                if not "%html%"=="" echo ^<html^>report^</html^>>"%html%"
                echo done
                exit /b 0
                "#
                }
                "wrapper-stat-plot" => {
                    r#"@echo off
                set "out="
                set "saw_stat="
                set "saw_points="
                set "saw_step="
                set "saw_iterations="
                :loop
                if "%~1"=="" goto done
                set "arg=%~1"
                if "%arg:~0,6%"=="json2=" set "out=%arg:~6%"
                if "%arg:~0,14%"=="dps_plot_stat=" set "saw_stat=1"
                if "%arg%"=="dps_plot_points=1" set "saw_points=1"
                if "%arg%"=="dps_plot_step=1" set "saw_step=1"
                if "%arg%"=="dps_plot_iterations=1" set "saw_iterations=1"
                shift
                goto loop
                :done
                if "%saw_stat%"=="" exit /b 9
                if "%saw_points%"=="" exit /b 9
                if "%saw_step%"=="" exit /b 9
                if "%saw_iterations%"=="" exit /b 9
                echo {"ok":true}>"%out%"
                exit /b 0
                "#
                }
                "staged-direct" => {
                    r#"@echo off
                set "out="
                :loop
                if "%~1"=="" goto done
                set "arg=%~1"
                if "%arg:~0,6%"=="json2=" set "out=%arg:~6%"
                shift
                goto loop
                :done
                echo {"sim":{"profilesets":{"results":[{"name":"Combo 1","mean":100.0}]}}}>"%out%"
                exit /b 0
                "#
                }
                "pause" => {
                    r#"@echo off
                set "out="
                :loop
                if "%~1"=="" goto wait
                set "arg=%~1"
                if "%arg:~0,6%"=="json2=" set "out=%arg:~6%"
                shift
                goto loop
                :wait
                echo 1/2
                timeout /t 2 /nobreak >nul
                echo {"ok":true}>"%out%"
                exit /b 0
                "#
                }
                other => panic!("unknown fake simc mode: {other}"),
            };

            std::fs::write(&path, body).expect("write fake simc");
            path
        }
    }
}
