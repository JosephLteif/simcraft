use std::collections::HashMap;
use std::sync::Mutex;

use super::JobStorage;
use crate::models::{
    extract_result_summary, AppUser, Job, JobStatus, JobSummary, SavedCharacterProfile, SavedRoute,
};

pub struct MemoryStorage {
    jobs: Mutex<HashMap<String, Job>>,
    max_jobs: Mutex<usize>,
    max_parallel_jobs: Mutex<usize>,
    cache: Mutex<HashMap<String, String>>,
    user_configs: Mutex<HashMap<(String, String), String>>,
    routes: Mutex<HashMap<String, SavedRoute>>,
    character_profiles: Mutex<HashMap<String, SavedCharacterProfile>>,
    users: Mutex<HashMap<String, AppUser>>,
    auth_sessions: Mutex<HashMap<String, (String, String, i64)>>,
}

impl Default for MemoryStorage {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryStorage {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            max_jobs: Mutex::new(*super::MAX_JOBS),
            max_parallel_jobs: Mutex::new(*super::MAX_PARALLEL_JOBS),
            cache: Mutex::new(HashMap::new()),
            user_configs: Mutex::new(HashMap::new()),
            routes: Mutex::new(HashMap::new()),
            character_profiles: Mutex::new(HashMap::new()),
            users: Mutex::new(HashMap::new()),
            auth_sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl JobStorage for MemoryStorage {
    fn insert(&self, job: Job) {
        let mut job = job;
        let owner_id = job.owner_id.clone();
        let mut jobs = self.jobs.lock().unwrap();
        if job.queue_order == 0 {
            job.queue_order = jobs
                .values()
                .map(|existing| existing.queue_order)
                .max()
                .unwrap_or(0)
                .saturating_add(1);
        }
        jobs.insert(job.id.clone(), job);
        let limit = *self.max_jobs.lock().unwrap();
        if jobs.values().filter(|job| job.owner_id == owner_id).count() > limit {
            let mut entries: Vec<(String, String)> = jobs
                .iter()
                .filter(|(_, j)| j.owner_id == owner_id && !j.pinned)
                .map(|(id, j)| (id.clone(), j.created_at.clone()))
                .collect();
            entries.sort_by(|a, b| a.1.cmp(&b.1));
            let unpinned_count = entries.len();
            let to_remove = unpinned_count.saturating_sub(limit);
            for (id, _) in entries.into_iter().take(to_remove) {
                jobs.remove(&id);
            }
        }
    }

    fn get(&self, id: &str) -> Option<Job> {
        self.jobs.lock().unwrap().get(id).cloned()
    }

    fn list_recent_owned(
        &self,
        owner_id: &str,
        limit: usize,
        player: Option<&str>,
        realm: Option<&str>,
        linked_only: bool,
        unlinked_only: bool,
        pinned_only: bool,
    ) -> Vec<JobSummary> {
        let jobs = self.jobs.lock().unwrap();
        let mut entries: Vec<&Job> = jobs.values().collect();
        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let mut results: Vec<JobSummary> = Vec::new();
        for j in entries {
            if j.owner_id != owner_id {
                continue;
            }
            if results.len() >= limit {
                break;
            }
            let s = extract_result_summary(&j.result_json, &j.simc_input);
            let linked_region = j.linked_region.clone();
            let linked_realm = j.linked_realm.clone();
            let linked_name = j.linked_name.clone();

            let player_name = linked_name.clone().or_else(|| s.player_name.clone());
            let current_realm = linked_realm.clone().or_else(|| s.realm.clone());

            if unlinked_only
                && (linked_name.is_some() || linked_realm.is_some() || linked_region.is_some())
            {
                continue;
            }
            if pinned_only && !j.pinned {
                continue;
            }

            if linked_only {
                if let Some(p) = player {
                    if linked_name.as_deref() != Some(p) {
                        continue;
                    }
                }
                if let Some(r) = realm {
                    if linked_realm.as_deref() != Some(r) {
                        continue;
                    }
                }
            } else {
                if let Some(p) = player {
                    if player_name.as_deref() != Some(p) {
                        continue;
                    }
                }
                if let Some(r) = realm {
                    if current_realm.as_deref() != Some(r) {
                        continue;
                    }
                }
            }

            results.push(JobSummary {
                id: j.id.clone(),
                status: j.status.clone(),
                sim_type: j.sim_type.clone(),
                created_at: j.created_at.clone(),
                queue_order: j.queue_order,
                fight_style: j.fight_style.clone(),
                iterations: j.iterations,
                error_message: j.error_message.clone(),
                player_name,
                player_class: s.player_class,
                realm: current_realm,
                dps: s.dps,
                batch_id: j.batch_id.clone(),
                size_bytes: j.estimate_size(),
                upgrades: s.upgrades,
                downgrades: s.downgrades,
                linked_region,
                linked_realm,
                linked_name,
                pinned: j.pinned,
            });
        }
        results
    }

    fn list_queue(&self, owner_id: Option<&str>) -> Vec<JobSummary> {
        let jobs = self.jobs.lock().unwrap();
        let mut entries: Vec<&Job> = jobs
            .values()
            .filter(|job| {
                owner_id.is_none_or(|owner| job.owner_id == owner)
                    && matches!(
                        job.status,
                        JobStatus::Pending | JobStatus::Running | JobStatus::Paused
                    )
            })
            .collect();
        entries.sort_by(|a, b| {
            let status_rank = |job: &Job| match job.status {
                JobStatus::Pending => 0,
                JobStatus::Running => 1,
                JobStatus::Paused => 2,
                _ => 3,
            };
            status_rank(a)
                .cmp(&status_rank(b))
                .then_with(|| a.queue_order.cmp(&b.queue_order))
                .then_with(|| a.created_at.cmp(&b.created_at))
                .then_with(|| a.id.cmp(&b.id))
        });

        entries
            .into_iter()
            .map(|job| {
                let summary = extract_result_summary(&job.result_json, &job.simc_input);
                let linked_region = job.linked_region.clone();
                let linked_realm = job.linked_realm.clone();
                let linked_name = job.linked_name.clone();
                JobSummary {
                    id: job.id.clone(),
                    status: job.status.clone(),
                    sim_type: job.sim_type.clone(),
                    created_at: job.created_at.clone(),
                    queue_order: job.queue_order,
                    fight_style: job.fight_style.clone(),
                    iterations: job.iterations,
                    error_message: job.error_message.clone(),
                    player_name: linked_name.clone().or(summary.player_name),
                    player_class: summary.player_class,
                    realm: linked_realm.clone().or(summary.realm),
                    dps: summary.dps,
                    batch_id: job.batch_id.clone(),
                    size_bytes: job.estimate_size(),
                    upgrades: summary.upgrades,
                    downgrades: summary.downgrades,
                    linked_region,
                    linked_realm,
                    linked_name,
                    pinned: job.pinned,
                }
            })
            .collect()
    }

    fn reorder_queue(&self, owner_id: Option<&str>, ordered_ids: &[String]) -> Result<(), String> {
        let mut jobs = self.jobs.lock().unwrap();
        let mut current: Vec<(String, u64, String)> = jobs
            .values()
            .filter(|job| {
                owner_id.is_none_or(|owner| job.owner_id == owner)
                    && job.status == JobStatus::Pending
            })
            .map(|job| (job.id.clone(), job.queue_order, job.created_at.clone()))
            .collect();
        current.sort_by(|a, b| {
            a.1.cmp(&b.1)
                .then_with(|| a.2.cmp(&b.2))
                .then_with(|| a.0.cmp(&b.0))
        });
        let expected: std::collections::HashSet<&str> =
            current.iter().map(|(id, _, _)| id.as_str()).collect();
        let received: std::collections::HashSet<&str> =
            ordered_ids.iter().map(String::as_str).collect();
        if expected != received || ordered_ids.len() != current.len() {
            return Err("The queue changed. Refresh and try again.".to_string());
        }

        let slots: Vec<u64> = current.iter().map(|(_, order, _)| *order).collect();
        for (id, order) in ordered_ids.iter().zip(slots) {
            jobs.get_mut(id)
                .ok_or_else(|| "A queued job no longer exists.".to_string())?
                .queue_order = order;
        }
        Ok(())
    }

    fn run_next(&self, owner_id: Option<&str>, job_id: &str) -> Result<(), String> {
        let mut jobs = self.jobs.lock().unwrap();
        jobs.get(job_id)
            .filter(|job| {
                job.status == JobStatus::Pending
                    && owner_id.is_none_or(|owner| job.owner_id == owner)
            })
            .map(|job| job.queue_order)
            .ok_or_else(|| "Queued job not found.".to_string())?;
        let mut current: Vec<(String, u64, String)> = jobs
            .values()
            .filter(|job| {
                job.status == JobStatus::Pending
                    && owner_id.is_none_or(|owner| job.owner_id == owner)
            })
            .map(|job| (job.id.clone(), job.queue_order, job.created_at.clone()))
            .collect();
        current.sort_by(|a, b| {
            a.1.cmp(&b.1)
                .then_with(|| a.2.cmp(&b.2))
                .then_with(|| a.0.cmp(&b.0))
        });
        let target_index = current
            .iter()
            .position(|(id, _, _)| id == job_id)
            .ok_or_else(|| "Queued job not found.".to_string())?;
        if target_index == 0 {
            return Ok(());
        }
        let mut ordered_ids: Vec<String> = current.into_iter().map(|(id, _, _)| id).collect();
        let id = ordered_ids.remove(target_index);
        ordered_ids.insert(0, id);
        let mut slots: Vec<u64> = jobs
            .values()
            .filter(|job| {
                job.status == JobStatus::Pending
                    && owner_id.is_none_or(|owner| job.owner_id == owner)
            })
            .map(|job| job.queue_order)
            .collect();
        slots.sort_unstable();
        for (id, order) in ordered_ids.iter().zip(slots) {
            jobs.get_mut(id)
                .ok_or_else(|| "A queued job no longer exists.".to_string())?
                .queue_order = order;
        }
        Ok(())
    }

    fn list_pending_jobs(&self) -> Vec<Job> {
        let mut jobs: Vec<Job> = self
            .jobs
            .lock()
            .unwrap()
            .values()
            .filter(|job| job.status == JobStatus::Pending)
            .cloned()
            .collect();
        jobs.sort_by(|a, b| {
            a.queue_order
                .cmp(&b.queue_order)
                .then_with(|| a.created_at.cmp(&b.created_at))
                .then_with(|| a.id.cmp(&b.id))
        });
        jobs
    }

    fn update_status(&self, id: &str, status: JobStatus) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            let from = job.status.clone();
            job.transition_stage_timing(&from, &status);
            job.status = status;
        }
    }

    fn transition_status(&self, id: &str, from: JobStatus, to: JobStatus) -> bool {
        let mut jobs = self.jobs.lock().unwrap();
        let Some(job) = jobs.get_mut(id) else {
            return false;
        };
        if job.status != from {
            return false;
        }
        job.transition_stage_timing(&from, &to);
        job.status = to;
        true
    }

    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.update_stage_timing(stage);
            job.progress_pct = pct;
            job.progress_detail = Some(detail.to_string());
        }
    }

    fn complete_stage(&self, id: &str, summary: &str) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.complete_stage_timing();
            job.stages_completed.push(summary.to_string());
        }
    }

    fn set_result(&self, id: &str, result: String, raw_json: Option<String>) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.complete_stage_timing();
            job.result_json = Some(result);
            job.raw_json = raw_json;
            job.status = JobStatus::Done;
        }
    }

    fn set_error(&self, id: &str, error: String) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.complete_stage_timing();
            job.error_message = Some(error);
            job.status = JobStatus::Failed;
        }
    }

    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>) {
        if let Some(job) = self.jobs.lock().unwrap().get_mut(id) {
            job.html_report = html;
            job.text_output = text;
        }
    }

    fn count_batch_owned(&self, owner_id: &str, batch_id: &str) -> usize {
        self.jobs
            .lock()
            .unwrap()
            .values()
            .filter(|j| j.owner_id == owner_id && j.batch_id.as_deref() == Some(batch_id))
            .count()
    }

    fn delete(&self, id: &str) {
        self.jobs.lock().unwrap().remove(id);
    }

    fn delete_owned(&self, owner_id: &str, id: &str) {
        let mut jobs = self.jobs.lock().unwrap();
        if jobs.get(id).is_some_and(|job| job.owner_id == owner_id) {
            jobs.remove(id);
        }
    }

    fn get_storage_size_owned(&self, owner_id: &str) -> u64 {
        let jobs = self.jobs.lock().unwrap();
        jobs.values()
            .filter(|job| job.owner_id == owner_id)
            .map(|job| job.estimate_size())
            .sum()
    }

    fn clear_history_owned(&self, owner_id: &str) {
        self.jobs
            .lock()
            .unwrap()
            .retain(|_, job| job.owner_id != owner_id);
    }

    fn get_max_jobs(&self) -> usize {
        *self.max_jobs.lock().unwrap()
    }

    fn set_max_jobs(&self, limit: usize) {
        let mut mj = self.max_jobs.lock().unwrap();
        if *mj == limit {
            return;
        }
        *mj = limit;
        drop(mj);

        let mut jobs = self.jobs.lock().unwrap();
        if jobs.len() > limit {
            let mut entries: Vec<(String, String)> = jobs
                .iter()
                .filter(|(_, j)| !j.pinned)
                .map(|(id, j)| (id.clone(), j.created_at.clone()))
                .collect();
            entries.sort_by(|a, b| a.1.cmp(&b.1));
            let unpinned_count = entries.len();
            let to_remove = unpinned_count.saturating_sub(limit);
            for (id, _) in entries.into_iter().take(to_remove) {
                jobs.remove(&id);
            }
        }
    }

    fn get_max_parallel_jobs(&self) -> usize {
        *self.max_parallel_jobs.lock().unwrap()
    }

    fn set_max_parallel_jobs(&self, limit: usize) {
        *self.max_parallel_jobs.lock().unwrap() = limit.max(1);
    }

    fn set_cache(&self, key: &str, value: String) {
        let mut cache = self.cache.lock().unwrap();
        cache.insert(key.to_string(), value);
    }

    fn get_cache(&self, key: &str) -> Option<String> {
        let cache = self.cache.lock().unwrap();
        cache.get(key).cloned()
    }

    fn remove_cache(&self, key: &str) {
        let mut cache = self.cache.lock().unwrap();
        cache.remove(key);
    }

    fn link_character_owned(
        &self,
        owner_id: &str,
        id: &str,
        region: Option<String>,
        realm: Option<String>,
        name: Option<String>,
    ) {
        if let Some(job) = self
            .jobs
            .lock()
            .unwrap()
            .get_mut(id)
            .filter(|job| job.owner_id == owner_id)
        {
            job.linked_region = region;
            job.linked_realm = realm;
            job.linked_name = name;
        }
    }

    fn set_pinned_owned(&self, owner_id: &str, id: &str, pinned: bool) {
        if let Some(job) = self
            .jobs
            .lock()
            .unwrap()
            .get_mut(id)
            .filter(|job| job.owner_id == owner_id)
        {
            job.pinned = pinned;
        }
    }

    fn set_user_config(&self, user_id: &str, key: &str, value: &str) {
        let mut configs = self.user_configs.lock().unwrap();
        configs.insert((user_id.to_string(), key.to_string()), value.to_string());
    }

    fn get_user_config(&self, user_id: &str, key: &str) -> Option<String> {
        let configs = self.user_configs.lock().unwrap();
        configs
            .get(&(user_id.to_string(), key.to_string()))
            .cloned()
    }

    fn remove_user_config(&self, user_id: &str, key: &str) {
        let mut configs = self.user_configs.lock().unwrap();
        configs.remove(&(user_id.to_string(), key.to_string()));
    }

    fn list_users(&self) -> Vec<AppUser> {
        let mut users: Vec<_> = self.users.lock().unwrap().values().cloned().collect();
        users.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        users
    }

    fn get_user(&self, id: &str) -> Option<AppUser> {
        self.users.lock().unwrap().get(id).cloned()
    }

    fn find_user_by_provider_subject(&self, provider_subject: &str) -> Option<AppUser> {
        self.users
            .lock()
            .unwrap()
            .values()
            .find(|user| user.provider_subject.as_deref() == Some(provider_subject))
            .cloned()
    }

    fn find_user_by_battletag(&self, battletag: &str) -> Option<AppUser> {
        self.users
            .lock()
            .unwrap()
            .values()
            .find(|user| user.battletag.eq_ignore_ascii_case(battletag))
            .cloned()
    }

    fn save_user(&self, user: AppUser) {
        self.users.lock().unwrap().insert(user.id.clone(), user);
    }

    fn delete_user(&self, id: &str) {
        self.users.lock().unwrap().remove(id);
        self.delete_user_auth_sessions(id);
    }

    fn save_auth_session(
        &self,
        session_id: &str,
        user_id: &str,
        encrypted_access_token: &str,
        expires_at: i64,
    ) {
        self.auth_sessions.lock().unwrap().insert(
            session_id.to_string(),
            (
                user_id.to_string(),
                encrypted_access_token.to_string(),
                expires_at,
            ),
        );
    }

    fn get_auth_session(&self, session_id: &str) -> Option<(String, String, i64)> {
        self.auth_sessions.lock().unwrap().get(session_id).cloned()
    }

    fn delete_auth_session(&self, session_id: &str) {
        self.auth_sessions.lock().unwrap().remove(session_id);
    }

    fn delete_user_auth_sessions(&self, user_id: &str) {
        self.auth_sessions
            .lock()
            .unwrap()
            .retain(|_, (owner, _, _)| owner != user_id);
    }

    fn save_route_owned(&self, owner_id: &str, route: SavedRoute) {
        let mut routes = self.routes.lock().unwrap();
        routes.insert(format!("{owner_id}:{}", route.id), route);
    }

    fn list_routes_owned(&self, owner_id: &str) -> Vec<SavedRoute> {
        let prefix = format!("{owner_id}:");
        let routes = self.routes.lock().unwrap();
        let mut results: Vec<SavedRoute> = routes
            .iter()
            .filter(|(key, _)| key.starts_with(&prefix))
            .map(|(_, route)| route.clone())
            .collect();
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    }

    fn delete_route_owned(&self, owner_id: &str, id: &str) {
        let mut routes = self.routes.lock().unwrap();
        routes.remove(&format!("{owner_id}:{id}"));
    }

    fn save_character_profile_owned(&self, owner_id: &str, profile: SavedCharacterProfile) {
        let mut profiles = self.character_profiles.lock().unwrap();
        profiles.insert(format!("{owner_id}:{}", profile.id), profile);
    }

    fn list_character_profiles_owned(
        &self,
        owner_id: &str,
        name: Option<&str>,
        realm: Option<&str>,
        region: Option<&str>,
    ) -> Vec<SavedCharacterProfile> {
        let profiles = self.character_profiles.lock().unwrap();
        let prefix = format!("{owner_id}:");
        profiles
            .iter()
            .filter(|(key, _)| key.starts_with(&prefix))
            .map(|(_, profile)| profile)
            .filter(|p| {
                if let Some(n) = name {
                    if p.name.to_lowercase() != n.to_lowercase() {
                        return false;
                    }
                }
                if let Some(r) = realm {
                    if p.realm.to_lowercase() != r.to_lowercase() {
                        return false;
                    }
                }
                if let Some(reg) = region {
                    if p.region.to_lowercase() != reg.to_lowercase() {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect()
    }

    fn delete_character_profile_owned(&self, owner_id: &str, id: &str) {
        let mut profiles = self.character_profiles.lock().unwrap();
        profiles.remove(&format!("{owner_id}:{id}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Job, JobStatus, SavedCharacterProfile, SavedRoute};
    use crate::storage::JobStorage;

    fn make_job(
        id: &str,
        created_at: &str,
        simc_input: &str,
        result_json: Option<&str>,
        pinned: bool,
        linked: Option<(&str, &str, &str)>,
    ) -> Job {
        let (linked_region, linked_realm, linked_name) = match linked {
            Some((region, realm, name)) => (
                Some(region.to_string()),
                Some(realm.to_string()),
                Some(name.to_string()),
            ),
            None => (None, None, None),
        };

        Job {
            id: id.to_string(),
            owner_id: "local-guest".to_string(),
            status: JobStatus::Done,
            sim_type: "quick".to_string(),
            simc_input: simc_input.to_string(),
            options: None,
            result_json: result_json.map(str::to_string),
            raw_json: None,
            combo_metadata_json: None,
            error_message: None,
            progress_pct: 100,
            progress_stage: None,
            progress_detail: None,
            stages_completed: Vec::new(),
            stage_timings: Vec::new(),
            active_stage_elapsed: 0.0,
            active_stage_started_at: None,
            iterations: 10000,
            fight_style: "Patchwerk".to_string(),
            target_error: 0.1,
            created_at: created_at.to_string(),
            queue_order: 0,
            html_report: None,
            text_output: None,
            batch_id: None,
            linked_region,
            linked_realm,
            linked_name,
            pinned,
        }
    }

    fn pending_job(id: &str, owner_id: &str) -> Job {
        let mut job = Job::new(
            format!("mage=\"{id}\"\nserver=illidan\n"),
            "quick".to_string(),
            1000,
            "Patchwerk".to_string(),
            0.1,
        );
        job.id = id.to_string();
        job.owner_id = owner_id.to_string();
        job
    }

    #[test]
    fn queue_reorder_preserves_other_owners_and_run_next_scope() {
        let storage = MemoryStorage::new();
        storage.insert(pending_job("alice-1", "alice"));
        storage.insert(pending_job("bob-1", "bob"));
        storage.insert(pending_job("alice-2", "alice"));

        storage
            .reorder_queue(
                Some("alice"),
                &["alice-2".to_string(), "alice-1".to_string()],
            )
            .expect("member reorder should succeed");
        let all_ids: Vec<String> = storage
            .list_queue(None)
            .into_iter()
            .map(|job| job.id)
            .collect();
        assert_eq!(all_ids, vec!["alice-2", "bob-1", "alice-1"]);

        storage
            .run_next(Some("alice"), "alice-1")
            .expect("member run-next should succeed");
        let all_ids: Vec<String> = storage
            .list_queue(None)
            .into_iter()
            .map(|job| job.id)
            .collect();
        assert_eq!(all_ids, vec!["alice-1", "bob-1", "alice-2"]);

        storage
            .run_next(None, "bob-1")
            .expect("admin run-next should succeed");
        let all_ids: Vec<String> = storage
            .list_queue(None)
            .into_iter()
            .map(|job| job.id)
            .collect();
        assert_eq!(all_ids, vec!["bob-1", "alice-1", "alice-2"]);
    }

    #[test]
    fn queue_ties_use_creation_time_and_id_as_stable_tiebreakers() {
        let storage = MemoryStorage::new();
        let mut later = pending_job("z-job", "alice");
        later.queue_order = 10;
        later.created_at = "2026-01-02T00:00:00Z".to_string();
        storage.insert(later);

        let mut earlier = pending_job("a-job", "alice");
        earlier.queue_order = 10;
        earlier.created_at = "2026-01-01T00:00:00Z".to_string();
        storage.insert(earlier);

        let ids: Vec<String> = storage
            .list_queue(Some("alice"))
            .into_iter()
            .map(|job| job.id)
            .collect();
        assert_eq!(ids, vec!["a-job", "z-job"]);
    }

    #[test]
    fn paused_jobs_keep_their_queue_order_when_resumed() {
        let storage = MemoryStorage::new();
        storage.insert(pending_job("first", "alice"));
        storage.insert(pending_job("second", "alice"));
        let original_order = storage.get("first").expect("first job").queue_order;

        storage.update_status("first", JobStatus::Paused);
        storage.update_status("first", JobStatus::Pending);

        let resumed = storage.get("first").expect("resumed job");
        assert_eq!(resumed.queue_order, original_order);
        assert_eq!(
            storage
                .list_queue(Some("alice"))
                .into_iter()
                .map(|job| job.id)
                .collect::<Vec<_>>(),
            vec!["first", "second"]
        );
    }

    #[test]
    fn memory_storage_clamps_parallel_simulations_to_one_or_more() {
        let storage = MemoryStorage::new();

        storage.set_max_parallel_jobs(4);
        assert_eq!(storage.get_max_parallel_jobs(), 4);

        storage.set_max_parallel_jobs(0);
        assert_eq!(storage.get_max_parallel_jobs(), 1);
    }

    #[test]
    fn user_can_filter_history_for_linked_and_unlinked_character_views() {
        let storage = MemoryStorage::new();
        let linked_result = r#"{"player_name":"Alice","player_class":"Mage","dps":154321.0}"#;
        let unlinked_result = r#"{"player_name":"Bob","player_class":"Warrior","dps":123456.0}"#;

        storage.insert(make_job(
            "job-linked",
            "2026-01-03T00:00:00Z",
            "mage=\"Alice\"\nserver=illidan\n",
            Some(linked_result),
            false,
            Some(("us", "illidan", "Alice")),
        ));
        storage.insert(make_job(
            "job-unlinked",
            "2026-01-02T00:00:00Z",
            "warrior=\"Bob\"\nserver=stormrage\n",
            Some(unlinked_result),
            false,
            None,
        ));

        let linked = storage.list_recent(10, Some("Alice"), Some("illidan"), true, false, false);
        assert_eq!(linked.len(), 1);
        assert_eq!(linked[0].id, "job-linked");
        assert_eq!(linked[0].linked_name.as_deref(), Some("Alice"));
        assert_eq!(linked[0].player_name.as_deref(), Some("Alice"));

        let unlinked = storage.list_recent(10, None, None, false, true, false);
        assert_eq!(unlinked.len(), 1);
        assert_eq!(unlinked[0].id, "job-unlinked");
        assert!(unlinked[0].linked_name.is_none());
        assert_eq!(unlinked[0].player_name.as_deref(), Some("Bob"));
    }

    #[test]
    fn pinned_jobs_survive_retention_as_user_adds_more_runs() {
        let storage = MemoryStorage::new();
        storage.set_max_jobs(2);

        storage.insert(make_job(
            "job-pinned",
            "2026-01-01T00:00:00Z",
            "mage=\"Pinned\"\nserver=illidan\n",
            None,
            true,
            None,
        ));
        storage.insert(make_job(
            "job-old-unpinned",
            "2026-01-02T00:00:00Z",
            "mage=\"Old\"\nserver=illidan\n",
            None,
            false,
            None,
        ));
        storage.insert(make_job(
            "job-mid-unpinned",
            "2026-01-03T00:00:00Z",
            "mage=\"Mid\"\nserver=illidan\n",
            None,
            false,
            None,
        ));
        storage.insert(make_job(
            "job-new-unpinned",
            "2026-01-04T00:00:00Z",
            "mage=\"New\"\nserver=illidan\n",
            None,
            false,
            None,
        ));

        assert!(storage.get("job-pinned").is_some());
        assert!(storage.get("job-old-unpinned").is_none());
        assert!(storage.get("job-mid-unpinned").is_some());
        assert!(storage.get("job-new-unpinned").is_some());
    }

    #[test]
    fn job_state_updates_cover_progress_result_errors_and_reports() {
        let storage = MemoryStorage::new();
        storage.insert(make_job(
            "job-1",
            "2026-02-01T00:00:00Z",
            "evoker=\"Scaler\"\nserver=tichondrius\n",
            None,
            false,
            None,
        ));
        storage.update_status("job-1", JobStatus::Pending);

        assert!(storage.transition_status("job-1", JobStatus::Pending, JobStatus::Paused));
        assert!(!storage.transition_status("job-1", JobStatus::Pending, JobStatus::Running));
        assert_eq!(storage.get("job-1").unwrap().status, JobStatus::Paused);
        assert!(storage.transition_status("job-1", JobStatus::Paused, JobStatus::Running));
        storage.update_status("job-1", JobStatus::Running);
        storage.update_progress("job-1", 55, "simulating", "stage-2");
        storage.complete_stage("job-1", "parsed profile");
        storage.set_result(
            "job-1",
            r#"{"player_name":"Scaler","dps":7777.7}"#.to_string(),
            Some(r#"{"raw":"ok"}"#.to_string()),
        );
        storage.set_report_files(
            "job-1",
            Some("<html>report</html>".to_string()),
            Some("text output".to_string()),
        );

        let job = storage.get("job-1").expect("job should exist");
        assert_eq!(job.status, JobStatus::Done);
        assert_eq!(job.progress_pct, 55);
        assert_eq!(job.progress_stage.as_deref(), Some("simulating"));
        assert_eq!(job.progress_detail.as_deref(), Some("stage-2"));
        assert_eq!(job.stages_completed, vec!["parsed profile".to_string()]);
        assert_eq!(job.stage_timings.len(), 1);
        assert_eq!(job.stage_timings[0].name, "simulating");
        assert_eq!(job.raw_json.as_deref(), Some(r#"{"raw":"ok"}"#));
        assert_eq!(job.html_report.as_deref(), Some("<html>report</html>"));
        assert_eq!(job.text_output.as_deref(), Some("text output"));

        storage.set_error("job-1", "sim crashed".to_string());
        let failed = storage.get("job-1").expect("job should exist");
        assert_eq!(failed.status, JobStatus::Failed);
        assert_eq!(failed.error_message.as_deref(), Some("sim crashed"));
    }

    #[test]
    fn user_can_filter_saved_profiles_case_insensitively() {
        let storage = MemoryStorage::new();
        storage.save_character_profile(SavedCharacterProfile {
            id: "p1".to_string(),
            name: "MyMain".to_string(),
            realm: "Illidan".to_string(),
            region: "US".to_string(),
            class: Some("Mage".to_string()),
            spec: Some("Arcane".to_string()),
            simc_input: "mage=\"MyMain\"".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        });

        let results = storage.list_character_profiles(Some("mymain"), Some("illidan"), Some("us"));
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "p1");
    }

    #[test]
    fn user_can_save_and_remove_local_settings() {
        let storage = MemoryStorage::new();
        storage.set_user_config("user-1", "discord_link_hidden", "true");
        assert_eq!(
            storage
                .get_user_config("user-1", "discord_link_hidden")
                .as_deref(),
            Some("true")
        );

        storage.remove_user_config("user-1", "discord_link_hidden");
        assert!(storage
            .get_user_config("user-1", "discord_link_hidden")
            .is_none());
    }

    #[test]
    fn cache_batch_and_delete_operations_update_storage_state() {
        let storage = MemoryStorage::new();
        storage.set_cache(
            "characters:us:illidan:alice",
            "{\"name\":\"Alice\"}".to_string(),
        );
        assert_eq!(
            storage.get_cache("characters:us:illidan:alice").as_deref(),
            Some("{\"name\":\"Alice\"}")
        );

        let mut batch_a = make_job(
            "job-batch-a",
            "2026-01-01T00:00:00Z",
            "mage=\"Alice\"\nserver=illidan\n",
            None,
            false,
            None,
        );
        batch_a.batch_id = Some("batch-a".to_string());
        storage.insert(batch_a);

        let mut batch_b = make_job(
            "job-batch-b",
            "2026-01-02T00:00:00Z",
            "warrior=\"Bob\"\nserver=stormrage\n",
            None,
            false,
            None,
        );
        batch_b.batch_id = Some("batch-a".to_string());
        storage.insert(batch_b);

        assert_eq!(storage.count_batch("batch-a"), 2);
        assert!(storage.get_storage_size() > 0);

        storage.delete("job-batch-a");
        assert!(storage.get("job-batch-a").is_none());
        assert_eq!(storage.count_batch("batch-a"), 1);

        storage.remove_cache("characters:us:illidan:alice");
        assert!(storage.get_cache("characters:us:illidan:alice").is_none());
    }

    #[test]
    fn clear_history_removes_jobs_and_resets_storage_size() {
        let storage = MemoryStorage::new();
        storage.insert(make_job(
            "job-1",
            "2026-01-01T00:00:00Z",
            "mage=\"Alice\"\nserver=illidan\n",
            Some(r#"{"player_name":"Alice","dps":12345.0}"#),
            false,
            None,
        ));
        storage.insert(make_job(
            "job-2",
            "2026-01-02T00:00:00Z",
            "warrior=\"Bob\"\nserver=stormrage\n",
            Some(r#"{"player_name":"Bob","dps":23456.0}"#),
            false,
            None,
        ));

        assert_eq!(
            storage
                .list_recent(10, None, None, false, false, false)
                .len(),
            2
        );
        assert!(storage.get_storage_size() > 0);

        storage.clear_history();

        assert!(storage
            .list_recent(10, None, None, false, false, false)
            .is_empty());
        assert_eq!(storage.get_storage_size(), 0);
    }

    #[test]
    fn explicit_linking_and_pinning_update_existing_jobs() {
        let storage = MemoryStorage::new();
        storage.insert(make_job(
            "job-1",
            "2026-01-01T00:00:00Z",
            "mage=\"Alice\"\nserver=illidan\n",
            None,
            false,
            None,
        ));

        storage.link_character(
            "job-1",
            Some("us".to_string()),
            Some("illidan".to_string()),
            Some("Alice".to_string()),
        );
        storage.set_pinned("job-1", true);

        let job = storage.get("job-1").expect("job should exist");
        assert_eq!(job.linked_region.as_deref(), Some("us"));
        assert_eq!(job.linked_realm.as_deref(), Some("illidan"));
        assert_eq!(job.linked_name.as_deref(), Some("Alice"));
        assert!(job.pinned);
    }

    #[test]
    fn missing_job_mutators_do_not_create_state() {
        let storage = MemoryStorage::new();

        storage.update_status("missing", JobStatus::Running);
        storage.update_progress("missing", 50, "simulating", "step-1");
        storage.complete_stage("missing", "parsed profile");
        storage.set_result(
            "missing",
            r#"{"player_name":"Ghost","dps":1.0}"#.to_string(),
            Some(r#"{"raw":"ghost"}"#.to_string()),
        );
        storage.set_error("missing", "ghost failure".to_string());
        storage.set_report_files(
            "missing",
            Some("<html>ghost</html>".to_string()),
            Some("ghost text".to_string()),
        );
        storage.link_character(
            "missing",
            Some("us".to_string()),
            Some("illidan".to_string()),
            Some("Ghost".to_string()),
        );
        storage.set_pinned("missing", true);
        storage.delete("missing");

        assert!(storage.get("missing").is_none());
        assert!(storage
            .list_recent(10, None, None, false, false, false)
            .is_empty());
        assert_eq!(storage.get_storage_size(), 0);
    }

    #[test]
    fn user_can_save_list_and_delete_dungeon_routes() {
        let storage = MemoryStorage::new();
        storage.save_route(SavedRoute {
            id: "route-old".to_string(),
            name: "Old Route".to_string(),
            dungeon: "Ara-Kara".to_string(),
            level: Some(10),
            pull_count: Some(12),
            timer_seconds: Some(1800),
            affixes: Some("Fortified".to_string()),
            route_data: "ROUTE_DATA_OLD".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        });
        storage.save_route(SavedRoute {
            id: "route-new".to_string(),
            name: "New Route".to_string(),
            dungeon: "Ara-Kara".to_string(),
            level: Some(12),
            pull_count: Some(14),
            timer_seconds: Some(1780),
            affixes: Some("Tyrannical".to_string()),
            route_data: "ROUTE_DATA_NEW".to_string(),
            created_at: "2026-01-02T00:00:00Z".to_string(),
        });

        let listed = storage.list_routes();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "route-new");
        assert_eq!(listed[1].id, "route-old");

        storage.delete_route("route-old");
        let listed_after_delete = storage.list_routes();
        assert_eq!(listed_after_delete.len(), 1);
        assert_eq!(listed_after_delete[0].id, "route-new");
    }
}
