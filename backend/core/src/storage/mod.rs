pub mod memory;
#[cfg(feature = "web")]
pub mod sqlite;

pub use memory::MemoryStorage;
#[cfg(feature = "web")]
pub use sqlite::SqliteStorage;

use crate::models::{AppUser, Job, JobStatus, JobSummary, SavedCharacterProfile, SavedRoute};
use once_cell::sync::Lazy;

fn parse_env_usize(key: &str) -> Option<usize> {
    std::env::var(key).ok()?.parse().ok()
}

fn default_max_jobs() -> usize {
    if cfg!(feature = "desktop") {
        50
    } else {
        200
    }
}

fn default_max_parallel_jobs() -> usize {
    parse_env_usize("MAX_CONCURRENT_SIMULATIONS")
        .filter(|limit| *limit > 0)
        .unwrap_or_else(|| {
            std::thread::available_parallelism()
                .map(|parallelism| parallelism.get())
                .unwrap_or(1)
                .max(1)
        })
}

/// Maximum number of jobs to retain. Oldest jobs are deleted on insert.
/// Override with MAX_JOBS env var. Defaults: desktop=50, web=200.
pub static MAX_JOBS: Lazy<usize> = Lazy::new(|| {
    parse_env_usize("MAX_JOBS_PER_USER")
        .or_else(|| parse_env_usize("MAX_JOBS"))
        .unwrap_or_else(default_max_jobs)
});

/// Maximum number of simulations that may execute at the same time.
/// Override with MAX_CONCURRENT_SIMULATIONS. Defaults to the host parallelism.
pub static MAX_PARALLEL_JOBS: Lazy<usize> = Lazy::new(default_max_parallel_jobs);

/// Maximum scenarios per batch. Set to 0 to disable batch submissions.
/// Override with MAX_SCENARIOS env var. Default: 10.
pub static MAX_SCENARIOS: Lazy<usize> =
    Lazy::new(|| parse_env_usize("MAX_SCENARIOS").unwrap_or(10));

/// Trait for job persistence — implemented by in-memory store (desktop) and SQLite (web).
pub trait JobStorage: Send + Sync {
    fn insert(&self, job: Job);
    fn get(&self, id: &str) -> Option<Job>;
    fn get_owned(&self, owner_id: &str, id: &str) -> Option<Job> {
        self.get(id).filter(|job| job.owner_id == owner_id)
    }
    fn list_recent(
        &self,
        limit: usize,
        player: Option<&str>,
        realm: Option<&str>,
        linked_only: bool,
        unlinked_only: bool,
        pinned_only: bool,
    ) -> Vec<JobSummary> {
        self.list_recent_owned(
            "local-guest",
            limit,
            player,
            realm,
            linked_only,
            unlinked_only,
            pinned_only,
        )
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
    ) -> Vec<JobSummary>;
    fn update_status(&self, id: &str, status: JobStatus);
    fn transition_status(&self, id: &str, from: JobStatus, to: JobStatus) -> bool;
    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str);
    fn complete_stage(&self, id: &str, summary: &str);
    fn set_result(&self, id: &str, result: String, raw_json: Option<String>);
    fn set_error(&self, id: &str, error: String);
    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>);
    fn count_batch(&self, batch_id: &str) -> usize {
        self.count_batch_owned("local-guest", batch_id)
    }
    fn count_batch_owned(&self, owner_id: &str, batch_id: &str) -> usize;
    fn delete(&self, id: &str);
    fn delete_owned(&self, owner_id: &str, id: &str);
    fn get_storage_size(&self) -> u64 {
        self.get_storage_size_owned("local-guest")
    }
    fn get_storage_size_owned(&self, owner_id: &str) -> u64;
    fn clear_history(&self) {
        self.clear_history_owned("local-guest")
    }
    fn clear_history_owned(&self, owner_id: &str);
    fn get_max_jobs(&self) -> usize;
    fn set_max_jobs(&self, limit: usize);
    fn get_max_parallel_jobs(&self) -> usize;
    fn set_max_parallel_jobs(&self, limit: usize);
    // Cache methods for app-level storage (e.g. blizzard API proxy)
    fn set_cache(&self, key: &str, value: String);
    fn get_cache(&self, key: &str) -> Option<String>;
    fn remove_cache(&self, key: &str);
    // Explicit linking
    fn link_character(
        &self,
        id: &str,
        region: Option<String>,
        realm: Option<String>,
        name: Option<String>,
    ) {
        self.link_character_owned("local-guest", id, region, realm, name)
    }
    fn link_character_owned(
        &self,
        owner_id: &str,
        id: &str,
        region: Option<String>,
        realm: Option<String>,
        name: Option<String>,
    );
    fn set_pinned(&self, id: &str, pinned: bool) {
        self.set_pinned_owned("local-guest", id, pinned)
    }
    fn set_pinned_owned(&self, owner_id: &str, id: &str, pinned: bool);
    // User configuration storage
    fn set_user_config(&self, user_id: &str, key: &str, value: &str);
    fn get_user_config(&self, user_id: &str, key: &str) -> Option<String>;
    fn remove_user_config(&self, user_id: &str, key: &str);

    // Users and durable OAuth sessions
    fn list_users(&self) -> Vec<AppUser>;
    fn get_user(&self, id: &str) -> Option<AppUser>;
    fn find_user_by_provider_subject(&self, provider_subject: &str) -> Option<AppUser>;
    fn find_user_by_battletag(&self, battletag: &str) -> Option<AppUser>;
    fn save_user(&self, user: AppUser);
    fn delete_user(&self, id: &str);
    fn save_auth_session(
        &self,
        session_id: &str,
        user_id: &str,
        encrypted_access_token: &str,
        expires_at: i64,
    );
    fn get_auth_session(&self, session_id: &str) -> Option<(String, String, i64)>;
    fn delete_auth_session(&self, session_id: &str);
    fn delete_user_auth_sessions(&self, user_id: &str);

    // Dungeon routes
    fn save_route(&self, route: SavedRoute) {
        self.save_route_owned("local-guest", route)
    }
    fn save_route_owned(&self, owner_id: &str, route: SavedRoute);
    fn list_routes(&self) -> Vec<SavedRoute> {
        self.list_routes_owned("local-guest")
    }
    fn list_routes_owned(&self, owner_id: &str) -> Vec<SavedRoute>;
    fn delete_route(&self, id: &str) {
        self.delete_route_owned("local-guest", id)
    }
    fn delete_route_owned(&self, owner_id: &str, id: &str);

    // Character profiles
    fn save_character_profile(&self, profile: SavedCharacterProfile) {
        self.save_character_profile_owned("local-guest", profile)
    }
    fn save_character_profile_owned(&self, owner_id: &str, profile: SavedCharacterProfile);
    fn list_character_profiles(
        &self,
        name: Option<&str>,
        realm: Option<&str>,
        region: Option<&str>,
    ) -> Vec<SavedCharacterProfile> {
        self.list_character_profiles_owned("local-guest", name, realm, region)
    }
    fn list_character_profiles_owned(
        &self,
        owner_id: &str,
        name: Option<&str>,
        realm: Option<&str>,
        region: Option<&str>,
    ) -> Vec<SavedCharacterProfile>;
    fn delete_character_profile(&self, id: &str) {
        self.delete_character_profile_owned("local-guest", id)
    }
    fn delete_character_profile_owned(&self, owner_id: &str, id: &str);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_env_usize_accepts_numeric_values_only() {
        std::env::set_var("CODEX_TEST_USIZE", "42");
        assert_eq!(parse_env_usize("CODEX_TEST_USIZE"), Some(42));

        std::env::set_var("CODEX_TEST_USIZE", "0");
        assert_eq!(parse_env_usize("CODEX_TEST_USIZE"), Some(0));

        std::env::set_var("CODEX_TEST_USIZE", "not-a-number");
        assert_eq!(parse_env_usize("CODEX_TEST_USIZE"), None);

        std::env::set_var("CODEX_TEST_USIZE", "-1");
        assert_eq!(parse_env_usize("CODEX_TEST_USIZE"), None);

        std::env::set_var("CODEX_TEST_USIZE", "");
        assert_eq!(parse_env_usize("CODEX_TEST_USIZE"), None);

        std::env::set_var("CODEX_TEST_USIZE", " 42 ");
        assert_eq!(parse_env_usize("CODEX_TEST_USIZE"), None);

        std::env::set_var("CODEX_TEST_USIZE", "184467440737095516160");
        assert_eq!(parse_env_usize("CODEX_TEST_USIZE"), None);

        std::env::remove_var("CODEX_TEST_USIZE");
        assert_eq!(parse_env_usize("CODEX_TEST_USIZE"), None);
    }

    #[test]
    fn max_storage_limits_use_expected_defaults_when_env_is_missing() {
        assert_eq!(
            default_max_jobs(),
            if cfg!(feature = "desktop") { 50 } else { 200 }
        );
        assert_eq!(parse_env_usize("CODEX_TEST_MISSING_LIMIT"), None);
        assert_eq!(*MAX_SCENARIOS, 10);
        assert_eq!(*MAX_JOBS, default_max_jobs());
        assert!(*MAX_PARALLEL_JOBS >= 1);
    }
}
