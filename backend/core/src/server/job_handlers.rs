use actix_web::{web, HttpRequest, HttpResponse};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

use super::types::*;
use crate::log_buffer::LogBuffer;
use crate::models::{Job, JobStatus};
use crate::simc_runner;
use crate::storage::JobStorage;

fn is_staged_sim_type(sim_type: &str) -> bool {
    matches!(
        sim_type,
        "top_gear"
            | "droptimizer"
            | "external_buff_matrix"
            | "consumable_matrix"
            | "trinket_tier_heatmap"
    )
}

fn stored_combo_count(job: &Job) -> Option<usize> {
    let metadata_count = job
        .combo_metadata_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|metadata| metadata.get("_combo_count").and_then(Value::as_u64))
        .and_then(|count| usize::try_from(count).ok())
        .filter(|count| *count > 0);
    if metadata_count.is_some() {
        return metadata_count;
    }

    let input_count = job
        .simc_input
        .lines()
        .filter(|line| line.trim_start().starts_with("### "))
        .count();
    (input_count > 0).then_some(input_count)
}

fn rerun_options(job: &Job) -> Value {
    let mut options = job
        .options
        .clone()
        .filter(|value| value.is_object())
        .unwrap_or_else(|| json!({}));
    if let Some(object) = options.as_object_mut() {
        object.insert("sim_type".to_string(), json!(job.sim_type));
        object.insert("iterations".to_string(), json!(job.iterations));
        object.insert("fight_style".to_string(), json!(job.fight_style));
        object.insert("target_error".to_string(), json!(job.target_error));
    }
    options
}

pub(super) async fn rerun_sim(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
    simc_path: web::Data<PathBuf>,
    log_buffer: web::Data<Arc<LogBuffer>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let source_id = path.into_inner();
    let Some(source) = store.get_owned(&owner_id, &source_id) else {
        return HttpResponse::NotFound().json(json!({ "detail": "Job not found" }));
    };

    let options = rerun_options(&source);
    let simc = match super::helpers::resolve_simc_binary_for_request(simc_path.get_ref()) {
        Ok(path) => path,
        Err(detail) => return HttpResponse::BadRequest().json(json!({ "detail": detail })),
    };

    let staged_combo_count = if is_staged_sim_type(&source.sim_type) {
        stored_combo_count(&source)
    } else {
        None
    };

    let mut rerun = Job::new(
        source.simc_input.clone(),
        source.sim_type.clone(),
        source.iterations,
        source.fight_style.clone(),
        source.target_error,
    );
    rerun.owner_id = owner_id;
    rerun.options = Some(options.clone());
    rerun.combo_metadata_json = source.combo_metadata_json.clone();
    let job_id = rerun.id.clone();
    let created_at = rerun.created_at.clone();
    store.insert(rerun);

    if let Some(combo_count) = staged_combo_count {
        super::helpers::spawn_staged_sim(
            store.get_ref().clone(),
            auth.get_ref().clone(),
            simc,
            options,
            job_id.clone(),
            source.simc_input,
            combo_count,
            log_buffer.get_ref().clone(),
        );
    } else {
        super::helpers::spawn_direct_sim(
            store.get_ref().clone(),
            auth.get_ref().clone(),
            simc,
            options,
            job_id.clone(),
            source.simc_input,
            log_buffer.get_ref().clone(),
        );
    }

    HttpResponse::Ok().json(SimResponse {
        id: job_id,
        status: "pending".to_string(),
        created_at,
    })
}

fn owner_id(
    req: &HttpRequest,
    auth: &web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
) -> String {
    req.app_data::<web::Data<Arc<dyn JobStorage>>>()
        .map(|store| {
            crate::server::auth_handlers::request_owner_id(
                req,
                auth.get_ref(),
                store.get_ref().as_ref(),
            )
        })
        .unwrap_or_else(|| crate::server::auth_handlers::LOCAL_GUEST_USER_ID.to_string())
}

pub(super) async fn list_sims(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    query: web::Query<ListSimsQuery>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let max_jobs = store.get_max_jobs();

    let player = if query.player.is_empty() {
        None
    } else {
        Some(query.player.as_str())
    };
    let realm = if query.realm.is_empty() {
        None
    } else {
        Some(query.realm.as_str())
    };

    let summaries = store.list_recent_owned(
        &owner_id,
        std::cmp::max(max_jobs, 10000),
        player,
        realm,
        query.linked_only,
        query.unlinked_only,
        query.pinned_only,
    );
    HttpResponse::Ok().json(summaries)
}

#[derive(Debug, Deserialize, Default)]
pub struct QueueScopeQuery {
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReorderQueueRequest {
    pub job_ids: Vec<String>,
    #[serde(default)]
    pub scope: Option<String>,
}

fn request_is_admin(
    req: &HttpRequest,
    auth: &crate::server::auth_handlers::BlizzardAuthState,
    store: &dyn JobStorage,
) -> bool {
    crate::server::auth_handlers::verify_active_session(req, auth, store)
        .is_some_and(|claims| claims.role == "admin")
}

fn queue_item_status(status: &JobStatus) -> &'static str {
    match status {
        JobStatus::Pending => "pending",
        JobStatus::Running => "running",
        JobStatus::Paused => "paused",
        JobStatus::Done => "done",
        JobStatus::Failed => "failed",
        JobStatus::Cancelled => "cancelled",
    }
}

pub(super) async fn get_queue(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    query: web::Query<QueueScopeQuery>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let admin = request_is_admin(&req, auth.get_ref(), store.get_ref().as_ref());
    let all = admin && query.scope.as_deref() != Some("mine");
    let summaries = store.list_queue(if all { None } else { Some(owner_id.as_str()) });
    let mut queue_position = 0usize;
    let jobs: Vec<Value> = summaries
        .into_iter()
        .map(|summary| {
            let job = store.get(&summary.id);
            let position = if summary.status == JobStatus::Pending {
                queue_position += 1;
                Some(queue_position)
            } else {
                None
            };
            let owner = if all {
                job.as_ref().and_then(|job| {
                    if job.owner_id == crate::server::auth_handlers::LOCAL_GUEST_USER_ID {
                        Some("Local Guest".to_string())
                    } else {
                        store.get_user(&job.owner_id).map(|user| user.battletag)
                    }
                })
            } else {
                None
            };
            json!({
                "id": summary.id,
                "status": queue_item_status(&summary.status),
                "sim_type": summary.sim_type,
                "created_at": summary.created_at,
                "fight_style": summary.fight_style,
                "iterations": summary.iterations,
                "player_name": summary.player_name,
                "player_class": summary.player_class,
                "realm": summary.realm,
                "batch_id": summary.batch_id,
                "queue_position": position,
                "progress": job.as_ref().map(|job| job.progress_pct).unwrap_or(0),
                "progress_stage": job.as_ref().and_then(|job| job.progress_stage.clone()),
                "progress_detail": job.as_ref().and_then(|job| job.progress_detail.clone()),
                "owner": owner,
            })
        })
        .collect();
    let queued_count = jobs
        .iter()
        .filter(|job| job.get("status").and_then(Value::as_str) == Some("pending"))
        .count();
    let running_count = jobs
        .iter()
        .filter(|job| job.get("status").and_then(Value::as_str) == Some("running"))
        .count();

    HttpResponse::Ok().json(json!({
        "jobs": jobs,
        "queued_count": queued_count,
        "running_count": running_count,
        "max_parallel_jobs": store.get_max_parallel_jobs(),
        "scope": if all { "all" } else { "mine" },
        "can_manage_all": admin,
    }))
}

pub(super) async fn reorder_queue(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    payload: web::Json<ReorderQueueRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let admin = request_is_admin(&req, auth.get_ref(), store.get_ref().as_ref());
    let all = admin && payload.scope.as_deref() != Some("mine");
    let scope = if all { None } else { Some(owner_id.as_str()) };
    match store.reorder_queue(scope, &payload.job_ids) {
        Ok(()) => {
            for job in store.list_queue(scope) {
                if job.status == JobStatus::Pending {
                    simc_runner::update_simulation_queue_order(&job.id, job.queue_order);
                }
            }
            HttpResponse::Ok().json(json!({ "status": "ok" }))
        }
        Err(detail) if detail.starts_with("The queue changed") => {
            HttpResponse::Conflict().json(json!({ "detail": detail }))
        }
        Err(detail) => HttpResponse::BadRequest().json(json!({ "detail": detail })),
    }
}

pub(super) async fn run_next(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    query: web::Query<QueueScopeQuery>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let admin = request_is_admin(&req, auth.get_ref(), store.get_ref().as_ref());
    let all = admin && query.scope.as_deref() != Some("mine");
    let scope = if all { None } else { Some(owner_id.as_str()) };
    let job_id = path.into_inner();
    match store.run_next(scope, &job_id) {
        Ok(()) => {
            for job in store.list_queue(scope) {
                if job.status == JobStatus::Pending {
                    simc_runner::update_simulation_queue_order(&job.id, job.queue_order);
                }
            }
            HttpResponse::Ok().json(json!({ "status": "ok" }))
        }
        Err(detail) => HttpResponse::NotFound().json(json!({ "detail": detail })),
    }
}

pub(super) async fn list_related_sims(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let id = path.into_inner();
    let job = match store.get_owned(&owner_id, &id) {
        Some(j) => j,
        None => return HttpResponse::NotFound().json(json!({ "detail": "Job not found" })),
    };

    let parent_id = job.batch_id.clone().unwrap_or_else(|| job.id.clone());
    let max_jobs = store.get_max_jobs();
    let summaries = store.list_recent_owned(
        &owner_id,
        std::cmp::max(max_jobs, 3000),
        None,
        None,
        false,
        false,
        false,
    );

    let related: Vec<Value> = summaries
        .into_iter()
        .filter(|s| s.id == parent_id || s.batch_id.as_deref() == Some(parent_id.as_str()))
        .map(|s| {
            json!({
                "id": s.id,
                "status": s.status,
                "sim_type": s.sim_type,
                "batch_id": s.batch_id,
                "fight_style": s.fight_style,
                "player_name": s.player_name,
                "created_at": s.created_at,
            })
        })
        .collect();

    HttpResponse::Ok().json(related)
}

pub(super) async fn get_sim_status(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let job_id = path.into_inner();
    let job = match store.get_owned(&owner_id, &job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    let status_str = match job.status {
        JobStatus::Pending => "pending",
        JobStatus::Running => "running",
        JobStatus::Paused => "paused",
        JobStatus::Done => "done",
        JobStatus::Failed => "failed",
        JobStatus::Cancelled => "cancelled",
    };

    let progress = match job.status {
        JobStatus::Done => 100,
        _ => job.progress_pct as i32,
    };

    let parsed_result: Option<Value> = if job.status == JobStatus::Done {
        job.result_json
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
    } else {
        None
    };

    let mut profilesets_completed = 0;
    let mut profilesets_total = 0;
    let mut iterations_completed = 0;
    if let Some(ref detail) = job.progress_detail {
        if let Some(caps) = regex::Regex::new(r"(\d+)/(\d+) profilesets")
            .unwrap()
            .captures(detail)
        {
            profilesets_completed = caps[1].parse::<usize>().unwrap_or(0);
            profilesets_total = caps[2].parse::<usize>().unwrap_or(0);
        } else if let Some(caps) = regex::Regex::new(r"(\d+)/(\d+) iterations")
            .unwrap()
            .captures(detail)
        {
            iterations_completed = caps[1].parse::<usize>().unwrap_or(0);
        } else if let Some(caps) = regex::Regex::new(r"(\d+) combos").unwrap().captures(detail) {
            profilesets_total = caps[1].parse::<usize>().unwrap_or(0);
        }
    }

    let mut cpu_cores = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);
    for line in job.simc_input.lines() {
        if let Some(val) = line.trim().strip_prefix("threads=") {
            if let Ok(n) = val.parse::<u32>() {
                cpu_cores = n;
                break;
            }
        }
    }

    let mut cpu_pct = 0.0;
    let mut mem_bytes = 0;
    if job.status == JobStatus::Running {
        if let Some((cpu, mem)) = crate::simc_runner::get_process_stats(&job_id) {
            cpu_pct = cpu / cpu_cores as f32;
            mem_bytes = mem;
        }
    }

    let control_available = simc_runner::control_status(&job_id).is_some();
    let active_stage_elapsed = job.active_stage_elapsed_seconds();
    let queue_position = if job.status == JobStatus::Pending {
        store
            .list_queue(Some(&job.owner_id))
            .into_iter()
            .filter(|summary| summary.status == JobStatus::Pending)
            .position(|summary| summary.id == job.id)
            .map(|position| position + 1)
    } else {
        None
    };

    HttpResponse::Ok().json(json!({
        "id": job.id,
        "status": status_str,
        "sim_type": job.sim_type,
        "simc_input": job.simc_input,
        "options": job.options,
        "created_at": job.created_at,
        "progress": progress,
        "progress_stage": job.progress_stage,
        "progress_detail": job.progress_detail,
        "stages_completed": job.stages_completed,
        "stage_timings": job.stage_timings,
        "active_stage_elapsed": active_stage_elapsed,
        "queue_position": queue_position,
        "result": parsed_result,
        "error": job.error_message,
        "iterations": job.iterations,
        "iterations_completed": iterations_completed,
        "fight_style": job.fight_style,
        "profilesets_completed": profilesets_completed,
        "profilesets_total": profilesets_total,
        "cpu_pct": cpu_pct,
        "mem_bytes": mem_bytes,
        "cpu_cores": cpu_cores,
        "pause_available": control_available && matches!(job.status, JobStatus::Pending | JobStatus::Running),
        "resume_available": control_available && job.status == JobStatus::Paused,
        "linked_region": job.linked_region,
        "linked_realm": job.linked_realm,
        "linked_name": job.linked_name,
    }))
}

pub(super) async fn pause_sim(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let job_id = path.into_inner();
    let Some(job) = store.get_owned(&owner_id, &job_id) else {
        return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
    };
    if !matches!(job.status, JobStatus::Pending | JobStatus::Running) {
        return HttpResponse::BadRequest().json(json!({"detail": "Job is not running"}));
    }
    if simc_runner::control_status(&job_id).is_none() {
        return HttpResponse::Conflict().json(json!({
            "detail": "This simulation is no longer available for pause/resume control."
        }));
    }

    if let Err(error) = simc_runner::pause_job(&job_id) {
        return HttpResponse::Conflict().json(json!({"detail": error}));
    }
    if !store.transition_status(&job_id, job.status, JobStatus::Paused) {
        let _ = simc_runner::resume_job(&job_id);
        return HttpResponse::Conflict().json(json!({
            "detail": "The simulation changed state before it could be paused."
        }));
    }

    HttpResponse::Ok().json(json!({"status": "paused"}))
}

pub(super) async fn resume_sim(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let job_id = path.into_inner();
    let Some(job) = store.get_owned(&owner_id, &job_id) else {
        return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
    };
    if job.status != JobStatus::Paused {
        return HttpResponse::BadRequest().json(json!({"detail": "Job is not paused"}));
    }
    if simc_runner::control_status(&job_id).is_none() {
        return HttpResponse::Conflict().json(json!({
            "detail": "This paused simulation cannot be resumed after the backend restarted."
        }));
    }

    let target = match simc_runner::resume_job(&job_id) {
        Ok(target) => target,
        Err(error) => return HttpResponse::Conflict().json(json!({"detail": error})),
    };
    let target_status = match target {
        simc_runner::JobControlState::Pending => JobStatus::Pending,
        simc_runner::JobControlState::Running => JobStatus::Running,
        simc_runner::JobControlState::Paused => JobStatus::Paused,
    };
    if !store.transition_status(&job_id, JobStatus::Paused, target_status.clone()) {
        let _ = simc_runner::pause_job(&job_id);
        return HttpResponse::Conflict().json(json!({
            "detail": "The simulation changed state before it could be resumed."
        }));
    }

    let status = match target_status {
        JobStatus::Pending => "pending",
        JobStatus::Running => "running",
        _ => "paused",
    };
    HttpResponse::Ok().json(json!({"status": status}))
}

pub(super) async fn get_sim_logs(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    query: web::Query<LogsQuery>,
    log_buffer: web::Data<Arc<LogBuffer>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let job_id = path.into_inner();
    if store.get_owned(&owner_id, &job_id).is_none() {
        return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
    }
    let (lines, next) = log_buffer.get_lines_after(&job_id, query.after);
    HttpResponse::Ok().json(json!({
        "lines": lines,
        "next": next,
    }))
}

pub(super) async fn cancel_sim(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let job_id = path.into_inner();
    let job = match request_is_admin(&req, auth.get_ref(), store.get_ref().as_ref()) {
        true => store.get(&job_id),
        false => store.get_owned(&owner_id, &job_id),
    };
    let job = match job {
        Some(j) => j,
        None => return HttpResponse::NotFound().json(json!({"detail": "Job not found"})),
    };

    match job.status {
        JobStatus::Pending | JobStatus::Running | JobStatus::Paused => {
            // Mark as cancelled first so the error handler doesn't overwrite
            if !store.transition_status(&job_id, job.status, JobStatus::Cancelled) {
                return HttpResponse::Conflict()
                    .json(json!({"detail": "Job changed state before cancellation"}));
            }
            // Kill the simc process if running
            simc_runner::kill_job(&job_id);
            HttpResponse::Ok().json(json!({"status": "cancelled"}))
        }
        _ => HttpResponse::BadRequest().json(json!({"detail": "Job is not running"})),
    }
}

pub(super) async fn get_sim_input(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let job_id = path.into_inner();
    let job = match store.get_owned(&owner_id, &job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    HttpResponse::Ok()
        .content_type("text/plain; charset=utf-8")
        .body(job.simc_input)
}

pub(super) async fn get_sim_raw(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let job_id = path.into_inner();
    let job = match store.get_owned(&owner_id, &job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    match &job.raw_json {
        Some(raw) => match serde_json::from_str::<Value>(raw) {
            Ok(val) => HttpResponse::Ok().json(val),
            Err(_) => HttpResponse::InternalServerError()
                .json(json!({"detail": "Failed to parse stored raw JSON"})),
        },
        None => {
            // Fallback to parsed result if raw not available
            match &job.result_json {
                Some(result) => match serde_json::from_str::<Value>(result) {
                    Ok(val) => HttpResponse::Ok().json(val),
                    Err(_) => HttpResponse::InternalServerError()
                        .json(json!({"detail": "Failed to parse stored result"})),
                },
                None => {
                    HttpResponse::NotFound().json(json!({"detail": "No results available yet"}))
                }
            }
        }
    }
}

pub(super) async fn get_sim_html(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let job_id = path.into_inner();
    let job = match store.get_owned(&owner_id, &job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    match &job.html_report {
        Some(html) => HttpResponse::Ok()
            .content_type("text/html; charset=utf-8")
            .body(html.clone()),
        None => HttpResponse::NotFound()
            .json(json!({"detail": "HTML report not available for this sim"})),
    }
}

pub(super) async fn get_sim_text_output(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let job_id = path.into_inner();
    let job = match store.get_owned(&owner_id, &job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    match &job.text_output {
        Some(text) => HttpResponse::Ok()
            .content_type("text/plain; charset=utf-8")
            .body(text.clone()),
        None => HttpResponse::NotFound()
            .json(json!({"detail": "Text output not available for this sim"})),
    }
}

pub(super) async fn get_sim_csv(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let job_id = path.into_inner();
    let job = match store.get_owned(&owner_id, &job_id) {
        Some(j) => j,
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
        }
    };

    let result = match &job.result_json {
        Some(r) => match serde_json::from_str::<Value>(r) {
            Ok(v) => v,
            Err(_) => {
                return HttpResponse::InternalServerError()
                    .json(json!({"detail": "Failed to parse result"}))
            }
        },
        None => {
            return HttpResponse::NotFound().json(json!({"detail": "No results available yet"}))
        }
    };

    let mut csv = String::from("actor,dps,dps_error\n");

    if result.get("type").and_then(|t| t.as_str()) == Some("top_gear") {
        // Top Gear / Droptimizer: base + profileset results
        if let Some(base_dps) = result.get("base_dps").and_then(|v| v.as_f64()) {
            let name = result
                .get("player_name")
                .and_then(|n| n.as_str())
                .unwrap_or("Base");
            csv.push_str(&format!("{},{:.1},\n", name, base_dps));
        }
        if let Some(results) = result.get("results").and_then(|r| r.as_array()) {
            for r in results {
                let name = r.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let dps = r.get("dps").and_then(|v| v.as_f64()).unwrap_or(0.0);
                csv.push_str(&format!("{},{:.1},\n", name, dps));
            }
        }
    } else {
        // Quick Sim
        let name = result
            .get("player_name")
            .and_then(|n| n.as_str())
            .unwrap_or("Player");
        let dps = result.get("dps").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let error = result
            .get("dps_error")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        csv.push_str(&format!("{},{:.1},{:.1}\n", name, dps, error));
    }

    HttpResponse::Ok()
        .content_type("text/csv; charset=utf-8")
        .insert_header((
            "Content-Disposition",
            format!("attachment; filename=\"sim-{}.csv\"", job_id),
        ))
        .body(csv)
}

pub(super) async fn delete_sim(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let id = path.into_inner();
    if store.get_owned(&owner_id, &id).is_none() {
        return HttpResponse::NotFound().json(json!({"detail": "Job not found"}));
    }
    store.delete_owned(&owner_id, &id);
    crate::simc_runner::cleanup_job_control(&id);
    crate::simc_runner::cleanup_cancelled_job(&id);
    HttpResponse::Ok().json(json!({"status": "deleted"}))
}

pub(super) async fn get_history_stats(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let size = store.get_storage_size_owned(&owner_id);
    let sims = store.list_recent_owned(&owner_id, 1000, None, None, false, false, false);
    HttpResponse::Ok().json(json!({
        "size_bytes": size,
        "count": sims.len(),
    }))
}

pub(super) async fn clear_history(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    store.clear_history_owned(&owner_id);
    HttpResponse::Ok().json(json!({"status": "cleared"}))
}

#[derive(Deserialize)]
pub struct LinkSimRequest {
    pub region: Option<String>,
    pub realm: Option<String>,
    pub name: Option<String>,
}

pub(super) async fn link_sim(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    payload: web::Json<LinkSimRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let id = path.into_inner();
    store.link_character_owned(
        &owner_id,
        &id,
        payload.region.clone(),
        payload.realm.clone(),
        payload.name.clone(),
    );
    HttpResponse::Ok().json(json!({"status": "linked"}))
}

#[derive(Deserialize)]
pub struct PinSimRequest {
    pub pinned: bool,
}

pub(super) async fn pin_sim(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    path: web::Path<String>,
    payload: web::Json<PinSimRequest>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let id = path.into_inner();
    store.set_pinned_owned(&owner_id, &id, payload.pinned);
    HttpResponse::Ok().json(json!({"status": "updated", "pinned": payload.pinned}))
}

pub(super) async fn get_history_characters(
    req: HttpRequest,
    auth: web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    let owner_id = owner_id(&req, &auth);
    let sims = store.list_recent_owned(&owner_id, 10000, None, None, false, false, false);
    let mut seen = std::collections::HashSet::new();
    let mut chars = Vec::new();

    for sim in sims {
        // Use the summary names which already incorporate linked overrides
        let name = sim.player_name.clone();
        let realm = sim.realm.clone().unwrap_or_else(|| "Unknown".to_string());
        let region = sim
            .linked_region
            .clone()
            .unwrap_or_else(|| "us".to_string());

        if let Some(n) = name {
            let key = format!(
                "{}-{}-{}",
                n.to_lowercase(),
                realm.to_lowercase(),
                region.to_lowercase()
            );
            if seen.insert(key) {
                chars.push(json!({
                    "name": n,
                    "realm": realm,
                    "region": region,
                }));
            }
        }
    }

    HttpResponse::Ok().json(chars)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Job, JobStatus};
    use crate::storage::MemoryStorage;
    use actix_web::body::to_bytes;

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    fn test_request() -> HttpRequest {
        actix_web::test::TestRequest::default().to_http_request()
    }

    fn test_auth() -> web::Data<Arc<crate::server::auth_handlers::BlizzardAuthState>> {
        web::Data::new(Arc::new(
            crate::server::auth_handlers::BlizzardAuthState::new(
                None,
                None,
                "http://localhost/callback".to_string(),
                "test-secret".to_string(),
            ),
        ))
    }

    async fn list_sims(
        query: web::Query<ListSimsQuery>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::list_sims(test_request(), test_auth(), query, store).await
    }
    async fn list_related_sims(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::list_related_sims(test_request(), test_auth(), path, store).await
    }
    async fn get_sim_status(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::get_sim_status(test_request(), test_auth(), path, store).await
    }
    async fn rerun_sim(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
        simc_path: web::Data<PathBuf>,
        log_buffer: web::Data<Arc<LogBuffer>>,
    ) -> HttpResponse {
        super::rerun_sim(
            test_request(),
            test_auth(),
            path,
            store,
            simc_path,
            log_buffer,
        )
        .await
    }
    async fn pause_sim(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::pause_sim(test_request(), test_auth(), path, store).await
    }
    async fn resume_sim(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::resume_sim(test_request(), test_auth(), path, store).await
    }
    async fn cancel_sim(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::cancel_sim(test_request(), test_auth(), path, store).await
    }
    async fn get_sim_input(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::get_sim_input(test_request(), test_auth(), path, store).await
    }
    async fn get_sim_raw(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::get_sim_raw(test_request(), test_auth(), path, store).await
    }
    async fn get_sim_html(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::get_sim_html(test_request(), test_auth(), path, store).await
    }
    async fn get_sim_text_output(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::get_sim_text_output(test_request(), test_auth(), path, store).await
    }
    async fn get_sim_csv(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::get_sim_csv(test_request(), test_auth(), path, store).await
    }
    async fn delete_sim(
        path: web::Path<String>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::delete_sim(test_request(), test_auth(), path, store).await
    }
    async fn get_history_stats(store: web::Data<Arc<dyn JobStorage>>) -> HttpResponse {
        super::get_history_stats(test_request(), test_auth(), store).await
    }
    async fn clear_history(store: web::Data<Arc<dyn JobStorage>>) -> HttpResponse {
        super::clear_history(test_request(), test_auth(), store).await
    }
    async fn link_sim(
        path: web::Path<String>,
        payload: web::Json<LinkSimRequest>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::link_sim(test_request(), test_auth(), path, payload, store).await
    }
    async fn pin_sim(
        path: web::Path<String>,
        payload: web::Json<PinSimRequest>,
        store: web::Data<Arc<dyn JobStorage>>,
    ) -> HttpResponse {
        super::pin_sim(test_request(), test_auth(), path, payload, store).await
    }
    async fn get_history_characters(store: web::Data<Arc<dyn JobStorage>>) -> HttpResponse {
        super::get_history_characters(test_request(), test_auth(), store).await
    }
    async fn get_sim_logs(
        path: web::Path<String>,
        query: web::Query<LogsQuery>,
        log_buffer: web::Data<Arc<LogBuffer>>,
    ) -> HttpResponse {
        let job_id = path.into_inner();
        let (lines, next) = log_buffer.get_lines_after(&job_id, query.after);
        HttpResponse::Ok().json(json!({"lines": lines, "next": next}))
    }

    fn make_job(id: &str, status: JobStatus, created_at: &str) -> Job {
        let mut job = Job::new(
            "mage=\"Alice\"\nserver=illidan\nthreads=8\n".to_string(),
            "quick".to_string(),
            1000,
            "Patchwerk".to_string(),
            0.1,
        );
        job.id = id.to_string();
        job.status = status;
        job.created_at = created_at.to_string();
        job
    }

    async fn json_body(resp: HttpResponse) -> Value {
        let body = to_bytes(resp.into_body()).await.expect("body bytes");
        serde_json::from_slice(&body).expect("json body")
    }

    async fn text_body(resp: HttpResponse) -> String {
        let body = to_bytes(resp.into_body()).await.expect("body bytes");
        String::from_utf8(body.to_vec()).expect("utf8 body")
    }

    #[test]
    fn rerun_preserves_specialized_input_metadata_and_options() {
        let mut source = make_job("source", JobStatus::Done, "2026-01-01T00:00:00Z");
        source.sim_type = "top_gear".to_string();
        source.simc_input = concat!(
            "# Base Actor\n",
            "mage=Alice\n",
            "### Combo 1\n",
            "profileset.\"Combo 1\"+=head=id=123\n"
        )
        .to_string();
        source.options = Some(json!({
            "iterations": 2500,
            "fight_style": "HecticAddCleave",
            "target_error": 0.04,
            "threads": 6,
            "include_timeline": true
        }));
        source.combo_metadata_json = Some(
            json!({
                "_combo_count": 7,
                "_combo_metadata": {"Combo 1": [{"slot": "head", "item_id": 123}]}
            })
            .to_string(),
        );

        let options = rerun_options(&source);
        assert_eq!(options["sim_type"], json!("top_gear"));
        assert_eq!(options["iterations"], json!(source.iterations));
        assert_eq!(options["fight_style"], json!(source.fight_style));
        assert_eq!(options["threads"], json!(6));
        assert_eq!(stored_combo_count(&source), Some(7));
        assert!(is_staged_sim_type(&source.sim_type));
    }

    #[actix_web::test]
    async fn rerun_returns_not_found_for_unknown_job() {
        let response = rerun_sim(
            web::Path::from("missing".to_string()),
            test_store(),
            web::Data::new(PathBuf::from("missing-simc")),
            web::Data::new(Arc::new(LogBuffer::new())),
        )
        .await;
        assert_eq!(response.status(), actix_web::http::StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn status_handler_shapes_done_and_running_progress() {
        let store = test_store();
        let mut done = make_job("done", JobStatus::Done, "2026-01-02T00:00:00Z");
        done.progress_pct = 17;
        done.result_json = Some(json!({"player_name":"Alice","dps":1234.5}).to_string());
        store.insert(done);

        let done_resp = get_sim_status(web::Path::from("done".to_string()), store.clone()).await;
        assert_eq!(done_resp.status(), 200);
        let done_payload = json_body(done_resp).await;
        assert_eq!(
            done_payload.get("status").and_then(Value::as_str),
            Some("done")
        );
        assert_eq!(
            done_payload.get("progress").and_then(Value::as_i64),
            Some(100)
        );
        assert_eq!(
            done_payload
                .get("result")
                .and_then(|v| v.get("player_name"))
                .and_then(Value::as_str),
            Some("Alice")
        );
        assert_eq!(
            done_payload.get("cpu_cores").and_then(Value::as_u64),
            Some(8)
        );

        let mut running = make_job("running", JobStatus::Running, "2026-01-03T00:00:00Z");
        running.progress_detail = Some("12/30 profilesets".to_string());
        store.insert(running);

        let running_resp =
            get_sim_status(web::Path::from("running".to_string()), store.clone()).await;
        let running_payload = json_body(running_resp).await;
        assert_eq!(
            running_payload
                .get("profilesets_completed")
                .and_then(Value::as_u64),
            Some(12)
        );
        assert_eq!(
            running_payload
                .get("profilesets_total")
                .and_then(Value::as_u64),
            Some(30)
        );

        let pending = make_job("pending", JobStatus::Pending, "2026-01-04T00:00:00Z");
        store.insert(pending);
        let pending_resp = get_sim_status(web::Path::from("pending".to_string()), store.clone()).await;
        let pending_payload = json_body(pending_resp).await;
        assert_eq!(
            pending_payload.get("queue_position").and_then(Value::as_u64),
            Some(1)
        );

        let missing = get_sim_status(web::Path::from("missing".to_string()), store).await;
        assert_eq!(missing.status(), 404);
    }

    #[actix_web::test]
    async fn status_handler_parses_iteration_and_combo_progress_details() {
        let store = test_store();

        let mut iterations = make_job("iterations", JobStatus::Running, "2026-01-04T00:00:00Z");
        iterations.progress_detail = Some("345/1000 iterations".to_string());
        store.insert(iterations);

        let iterations_resp =
            get_sim_status(web::Path::from("iterations".to_string()), store.clone()).await;
        let iterations_payload = json_body(iterations_resp).await;
        assert_eq!(
            iterations_payload
                .get("iterations_completed")
                .and_then(Value::as_u64),
            Some(345)
        );
        assert_eq!(
            iterations_payload
                .get("profilesets_total")
                .and_then(Value::as_u64),
            Some(0)
        );

        let mut combos = make_job("combos", JobStatus::Running, "2026-01-05T00:00:00Z");
        combos.progress_detail = Some("17 combos".to_string());
        store.insert(combos);

        let combos_resp =
            get_sim_status(web::Path::from("combos".to_string()), store.clone()).await;
        let combos_payload = json_body(combos_resp).await;
        assert_eq!(
            combos_payload
                .get("profilesets_total")
                .and_then(Value::as_u64),
            Some(17)
        );
        assert_eq!(
            combos_payload
                .get("profilesets_completed")
                .and_then(Value::as_u64),
            Some(0)
        );
    }

    #[actix_web::test]
    async fn pause_and_resume_handlers_preserve_pending_and_running_control_states() {
        let store = test_store();
        let pending_id = "pause-handler-pending";
        store.insert(make_job(
            pending_id,
            JobStatus::Pending,
            "2026-01-01T00:00:00Z",
        ));
        simc_runner::register_job_control(pending_id);

        assert_eq!(
            pause_sim(web::Path::from(pending_id.to_string()), store.clone())
                .await
                .status(),
            200
        );
        assert_eq!(
            store.get(pending_id).expect("pending job").status,
            JobStatus::Paused
        );
        assert_eq!(
            resume_sim(web::Path::from(pending_id.to_string()), store.clone())
                .await
                .status(),
            200
        );
        assert_eq!(
            store.get(pending_id).expect("resumed job").status,
            JobStatus::Pending
        );
        simc_runner::cleanup_job_control(pending_id);

        let running_id = "pause-handler-running";
        store.insert(make_job(
            running_id,
            JobStatus::Running,
            "2026-01-02T00:00:00Z",
        ));
        simc_runner::register_job_control(running_id);
        assert!(simc_runner::start_job_control(running_id));

        assert_eq!(
            pause_sim(web::Path::from(running_id.to_string()), store.clone())
                .await
                .status(),
            200
        );
        assert_eq!(
            resume_sim(web::Path::from(running_id.to_string()), store.clone())
                .await
                .status(),
            200
        );
        assert_eq!(
            store.get(running_id).expect("running job").status,
            JobStatus::Running
        );
        simc_runner::cleanup_job_control(running_id);
    }

    #[actix_web::test]
    async fn resume_handler_rejects_persisted_paused_jobs_without_live_control() {
        let store = test_store();
        let id = "pause-handler-unavailable";
        store.insert(make_job(id, JobStatus::Paused, "2026-01-03T00:00:00Z"));

        let response = resume_sim(web::Path::from(id.to_string()), store).await;
        assert_eq!(response.status(), 409);
    }

    #[actix_web::test]
    async fn pause_handler_rejects_terminal_jobs_and_missing_controls() {
        let store = test_store();
        store.insert(make_job(
            "pause-done",
            JobStatus::Done,
            "2026-01-04T00:00:00Z",
        ));
        assert_eq!(
            pause_sim(web::Path::from("pause-done".to_string()), store.clone())
                .await
                .status(),
            400
        );

        store.insert(make_job(
            "pause-missing-control",
            JobStatus::Running,
            "2026-01-05T00:00:00Z",
        ));
        assert_eq!(
            pause_sim(web::Path::from("pause-missing-control".to_string()), store,)
                .await
                .status(),
            409
        );
    }

    #[actix_web::test]
    async fn pausing_one_control_does_not_change_a_sibling_control() {
        let store = test_store();
        let first = "pause-sibling-first";
        let second = "pause-sibling-second";
        store.insert(make_job(first, JobStatus::Running, "2026-01-06T00:00:00Z"));
        store.insert(make_job(second, JobStatus::Running, "2026-01-07T00:00:00Z"));
        simc_runner::register_job_control(first);
        simc_runner::register_job_control(second);
        assert!(simc_runner::start_job_control(first));
        assert!(simc_runner::start_job_control(second));

        assert_eq!(
            pause_sim(web::Path::from(first.to_string()), store.clone())
                .await
                .status(),
            200
        );
        assert_eq!(
            store.get(first).expect("first sibling").status,
            JobStatus::Paused
        );
        assert_eq!(
            simc_runner::control_status(second),
            Some(simc_runner::JobControlState::Running)
        );
        assert_eq!(
            store.get(second).expect("second sibling").status,
            JobStatus::Running
        );
        simc_runner::cleanup_job_control(first);
        simc_runner::cleanup_job_control(second);
    }

    #[actix_web::test]
    async fn list_sims_ignores_empty_filters_and_applies_linked_and_pinned_flags() {
        let store = test_store();

        let mut linked = make_job("linked", JobStatus::Done, "2026-01-06T00:00:00Z");
        linked.linked_region = Some("us".to_string());
        linked.linked_realm = Some("illidan".to_string());
        linked.linked_name = Some("Alice".to_string());
        linked.pinned = true;
        store.insert(linked);

        let unlinked = make_job("unlinked", JobStatus::Done, "2026-01-05T00:00:00Z");
        store.insert(unlinked);

        let all_resp = list_sims(
            web::Query(ListSimsQuery {
                player: String::new(),
                realm: String::new(),
                linked_only: false,
                unlinked_only: false,
                pinned_only: false,
            }),
            store.clone(),
        )
        .await;
        let all_payload = json_body(all_resp).await;
        assert_eq!(all_payload.as_array().map(Vec::len), Some(2));

        let linked_resp = list_sims(
            web::Query(ListSimsQuery {
                player: "Alice".to_string(),
                realm: "illidan".to_string(),
                linked_only: true,
                unlinked_only: false,
                pinned_only: false,
            }),
            store.clone(),
        )
        .await;
        let linked_payload = json_body(linked_resp).await;
        let linked_ids: Vec<&str> = linked_payload
            .as_array()
            .expect("linked array")
            .iter()
            .filter_map(|v| v.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(linked_ids, vec!["linked"]);

        let pinned_resp = list_sims(
            web::Query(ListSimsQuery {
                player: String::new(),
                realm: String::new(),
                linked_only: false,
                unlinked_only: false,
                pinned_only: true,
            }),
            store.clone(),
        )
        .await;
        let pinned_payload = json_body(pinned_resp).await;
        let pinned_ids: Vec<&str> = pinned_payload
            .as_array()
            .expect("pinned array")
            .iter()
            .filter_map(|v| v.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(pinned_ids, vec!["linked"]);

        let unlinked_resp = list_sims(
            web::Query(ListSimsQuery {
                player: String::new(),
                realm: String::new(),
                linked_only: false,
                unlinked_only: true,
                pinned_only: false,
            }),
            store.clone(),
        )
        .await;
        let unlinked_payload = json_body(unlinked_resp).await;
        let unlinked_ids: Vec<&str> = unlinked_payload
            .as_array()
            .expect("unlinked array")
            .iter()
            .filter_map(|v| v.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(unlinked_ids, vec!["unlinked"]);

        let linked_without_identity_resp = list_sims(
            web::Query(ListSimsQuery {
                player: String::new(),
                realm: String::new(),
                linked_only: true,
                unlinked_only: false,
                pinned_only: false,
            }),
            store.clone(),
        )
        .await;
        let linked_without_identity_payload = json_body(linked_without_identity_resp).await;
        let linked_without_identity_ids: Vec<&str> = linked_without_identity_payload
            .as_array()
            .expect("linked fallback array")
            .iter()
            .filter_map(|v| v.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(linked_without_identity_ids, vec!["linked", "unlinked"]);
    }

    #[actix_web::test]
    async fn related_sims_follow_parent_batch_and_missing_jobs_404() {
        let store = test_store();
        let parent = make_job("batch-root", JobStatus::Done, "2026-01-01T00:00:00Z");
        let mut child = make_job("batch-child", JobStatus::Done, "2026-01-02T00:00:00Z");
        child.batch_id = Some("batch-root".to_string());
        let unrelated = make_job("other", JobStatus::Done, "2026-01-03T00:00:00Z");
        store.insert(parent);
        store.insert(child);
        store.insert(unrelated);

        let resp =
            list_related_sims(web::Path::from("batch-child".to_string()), store.clone()).await;
        let payload = json_body(resp).await;
        let ids: Vec<&str> = payload
            .as_array()
            .expect("related array")
            .iter()
            .filter_map(|v| v.get("id").and_then(Value::as_str))
            .collect();
        assert_eq!(ids, vec!["batch-child", "batch-root"]);

        let missing = list_related_sims(web::Path::from("missing".to_string()), store).await;
        assert_eq!(missing.status(), 404);
    }

    #[actix_web::test]
    async fn raw_html_text_csv_and_input_handlers_return_expected_fallbacks() {
        let store = test_store();
        let mut job = make_job("job", JobStatus::Done, "2026-01-01T00:00:00Z");
        job.result_json =
            Some(json!({"player_name":"Alice","dps":1000.0,"dps_error":1.5}).to_string());
        job.html_report = Some("<html>report</html>".to_string());
        job.text_output = Some("plain output".to_string());
        store.insert(job);

        assert_eq!(
            text_body(get_sim_input(web::Path::from("job".to_string()), store.clone()).await).await,
            "mage=\"Alice\"\nserver=illidan\nthreads=8\n"
        );
        assert_eq!(
            json_body(get_sim_raw(web::Path::from("job".to_string()), store.clone()).await)
                .await
                .get("player_name")
                .and_then(Value::as_str),
            Some("Alice")
        );
        assert_eq!(
            text_body(get_sim_html(web::Path::from("job".to_string()), store.clone()).await).await,
            "<html>report</html>"
        );
        assert_eq!(
            text_body(get_sim_text_output(web::Path::from("job".to_string()), store.clone()).await)
                .await,
            "plain output"
        );
        let csv =
            text_body(get_sim_csv(web::Path::from("job".to_string()), store.clone()).await).await;
        assert!(csv.contains("actor,dps,dps_error"));
        assert!(csv.contains("Alice,1000.0,1.5"));

        let mut no_result = make_job("empty", JobStatus::Pending, "2026-01-02T00:00:00Z");
        no_result.result_json = None;
        store.insert(no_result);
        assert_eq!(
            get_sim_raw(web::Path::from("empty".to_string()), store.clone())
                .await
                .status(),
            404
        );
        assert_eq!(
            get_sim_csv(web::Path::from("empty".to_string()), store)
                .await
                .status(),
            404
        );
    }

    #[actix_web::test]
    async fn list_logs_cancel_link_pin_history_and_clear_paths() {
        let store = test_store();
        let mut pending = make_job("pending", JobStatus::Pending, "2026-01-02T00:00:00Z");
        pending.result_json = Some(json!({"player_name":"Alice","dps":1000.0}).to_string());
        store.insert(pending);
        let done = make_job("done", JobStatus::Done, "2026-01-01T00:00:00Z");
        store.insert(done);

        let cancel_done = cancel_sim(web::Path::from("done".to_string()), store.clone()).await;
        assert_eq!(cancel_done.status(), 400);
        let cancel_pending =
            cancel_sim(web::Path::from("pending".to_string()), store.clone()).await;
        assert_eq!(cancel_pending.status(), 200);
        assert_eq!(
            store.get_ref().get("pending").expect("pending job").status,
            JobStatus::Cancelled
        );

        let link = link_sim(
            web::Path::from("pending".to_string()),
            web::Json(LinkSimRequest {
                region: Some("us".to_string()),
                realm: Some("illidan".to_string()),
                name: Some("Alice".to_string()),
            }),
            store.clone(),
        )
        .await;
        assert_eq!(link.status(), 200);

        let pin = pin_sim(
            web::Path::from("pending".to_string()),
            web::Json(PinSimRequest { pinned: true }),
            store.clone(),
        )
        .await;
        assert_eq!(
            json_body(pin).await.get("pinned").and_then(Value::as_bool),
            Some(true)
        );

        let chars = json_body(get_history_characters(store.clone()).await).await;
        assert_eq!(
            chars
                .as_array()
                .and_then(|arr| arr.first())
                .and_then(|v| v.get("name"))
                .and_then(Value::as_str),
            Some("Alice")
        );

        let logs = Arc::new(LogBuffer::new());
        logs.push_line("pending", "line one".to_string());
        let log_resp = get_sim_logs(
            web::Path::from("pending".to_string()),
            web::Query(LogsQuery { after: 0 }),
            web::Data::new(logs),
        )
        .await;
        assert_eq!(
            json_body(log_resp)
                .await
                .get("lines")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );

        let stats = json_body(get_history_stats(store.clone()).await).await;
        assert_eq!(stats.get("count").and_then(Value::as_u64), Some(2));

        assert_eq!(clear_history(store.clone()).await.status(), 200);
        assert_eq!(
            json_body(get_history_stats(store).await)
                .await
                .get("count")
                .and_then(Value::as_u64),
            Some(0)
        );
    }
}
