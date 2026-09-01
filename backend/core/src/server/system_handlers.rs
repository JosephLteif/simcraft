use std::path::PathBuf;
use std::sync::Arc;

use actix_files::NamedFile;
use actix_web::{web, HttpRequest, HttpResponse};
use serde::Deserialize;
use serde_json::json;

#[cfg(feature = "desktop")]
use std::sync::Mutex;

use super::types::FrontendDir;
use super::{auth_handlers, data_sync};
use crate::simc_runtime::validate_simc_binary;
use crate::storage::{self, JobStorage};

#[cfg(feature = "desktop")]
/// Shared system info state, refreshed in background for live CPU readings.
pub(super) struct SystemStats {
    sys: sysinfo::System,
}

#[cfg(feature = "desktop")]
impl SystemStats {
    pub(super) fn new() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_cpu_all();
        Self { sys }
    }

    fn refresh(&mut self) {
        self.sys.refresh_cpu_all();
    }

    fn cpu_usage(&self) -> f32 {
        let cpus = self.sys.cpus();
        if cpus.is_empty() {
            return 0.0;
        }
        cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32
    }
}

pub(super) async fn get_config(store: web::Data<Arc<dyn JobStorage>>) -> HttpResponse {
    HttpResponse::Ok().json(json!({
        "max_scenarios": *storage::MAX_SCENARIOS,
        "max_jobs": store.get_max_jobs(),
        "max_parallel_jobs": store.get_max_parallel_jobs(),
    }))
}

#[derive(Deserialize)]
pub(super) struct UpdateConfig {
    pub(super) max_jobs: Option<usize>,
    #[serde(default)]
    pub(super) max_parallel_jobs: Option<usize>,
}

pub(super) async fn update_config(
    body: web::Json<UpdateConfig>,
    store: web::Data<Arc<dyn JobStorage>>,
) -> HttpResponse {
    if body.max_parallel_jobs == Some(0) {
        return HttpResponse::BadRequest()
            .json(json!({"error": "max_parallel_jobs must be at least 1"}));
    }
    if let Some(limit) = body.max_jobs {
        store.set_max_jobs(limit);
    }
    if let Some(limit) = body.max_parallel_jobs {
        store.set_max_parallel_jobs(limit);
        crate::simc_runner::set_simulation_concurrency_limit(limit);
    }
    HttpResponse::Ok().json(json!({"status": "updated"}))
}

fn app_metadata() -> (&'static str, String, String) {
    let version = std::env::var("WHYLOWDPS_VERSION")
        .ok()
        .filter(|value| !value.trim().is_empty() && value != "unknown")
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_owned());
    let revision = std::env::var("WHYLOWDPS_REVISION")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "unknown".to_owned());
    let mode = if auth_handlers::hosted_private_deployment() {
        "hosted"
    } else if cfg!(feature = "desktop") {
        "desktop"
    } else {
        "web"
    };
    (mode, version, revision)
}

fn last_sync_timestamp() -> Option<String> {
    crate::item_db::get_runtime_data()
        .get("last_sync")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

fn data_readiness_state(
    sync_status: &data_sync::SyncStatus,
    degraded: bool,
    summary: &data_sync::DataReadinessSummary,
) -> (&'static str, &'static str) {
    if !summary.available {
        return ("blocked", "The data directory is unavailable.");
    }
    if summary.required_missing > 0 {
        return ("blocked", "Required game data files are missing.");
    }
    if degraded {
        return ("degraded", "Using the last validated game-data snapshot.");
    }
    match sync_status {
        data_sync::SyncStatus::Ready => ("ready", "Game data is ready."),
        data_sync::SyncStatus::Syncing => ("syncing", "Refreshing game data."),
        data_sync::SyncStatus::NeedsCredentials => (
            "needs_credentials",
            "Blizzard credentials are required to refresh game data.",
        ),
        data_sync::SyncStatus::Error(_) => (
            "error",
            "Game data refresh failed. Retry or repair missing files.",
        ),
    }
}

fn overall_readiness_status(
    simulation_available: bool,
    data_status: &str,
    credentials_configured: bool,
) -> &'static str {
    if !simulation_available || data_status == "blocked" {
        "blocked"
    } else if data_status == "degraded" {
        "degraded"
    } else if data_status == "error" || data_status == "needs_credentials" {
        "attention"
    } else if data_status == "syncing" {
        "checking"
    } else if !credentials_configured {
        "attention"
    } else {
        "ready"
    }
}

pub(super) async fn readiness(
    data_dir: web::Data<Option<PathBuf>>,
    simc_path: web::Data<PathBuf>,
    sync_state: web::Data<Arc<data_sync::DataSyncState>>,
    auth_state: web::Data<Arc<auth_handlers::BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    secrets: web::Data<Arc<dyn auth_handlers::BlizzardCredentialSecretStore>>,
) -> HttpResponse {
    let sync_status = sync_state.status.lock().await.clone();
    let progress = sync_state.progress.lock().await.clone();
    let degraded = progress.starts_with("Degraded:");
    let summary = data_sync::summarize_data_files(data_dir.get_ref()).unwrap_or(
        data_sync::DataReadinessSummary {
            available: false,
            required_missing: 0,
            optional_missing: 0,
        },
    );
    let (data_status, data_message) = data_readiness_state(&sync_status, degraded, &summary);
    let credentials_configured =
        auth_handlers::get_available_blizzard_creds(&***auth_state, &***store, &***secrets)
            .is_some();
    let simulation_error = validate_simc_binary(simc_path.get_ref()).err();
    let simulation_available = simulation_error.is_none();
    let overall_status =
        overall_readiness_status(simulation_available, data_status, credentials_configured);
    let (mode, version, revision) = app_metadata();

    HttpResponse::Ok().json(json!({
        "status": overall_status,
        "app": {
            "mode": mode,
            "version": version,
            "revision": revision,
        },
        "credentials": {
            "configured": credentials_configured,
        },
        "data": {
            "status": data_status,
            "message": data_message,
            "degraded": degraded,
            "last_sync": last_sync_timestamp(),
            "required_missing": summary.required_missing,
            "optional_missing": summary.optional_missing,
            "available": summary.available,
        },
        "simulation": {
            "available": simulation_available,
            "error": simulation_error,
        },
    }))
}

pub(super) async fn health_check() -> HttpResponse {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let (mode, version, revision) = app_metadata();
    HttpResponse::Ok().json(json!({
        "status": "ok",
        "threads": threads,
        "mode": mode,
        "version": version,
        "revision": revision,
    }))
}

#[cfg(feature = "desktop")]
pub(super) async fn system_stats(stats: web::Data<Arc<Mutex<SystemStats>>>) -> HttpResponse {
    let mut s = stats.lock().unwrap();
    s.refresh();
    let cpu = s.cpu_usage();
    HttpResponse::Ok().json(json!({
        "cpu_usage": (cpu * 10.0).round() / 10.0,
    }))
}

/// SPA fallback: serve the appropriate HTML file for client-side routes.
pub(super) async fn spa_fallback(
    req: HttpRequest,
    frontend_dir: web::Data<FrontendDir>,
) -> actix_web::Result<NamedFile> {
    let path = req.path();
    let trimmed = path.trim_start_matches('/').trim_end_matches('/');

    if !trimmed.is_empty() {
        let asset = frontend_dir.0.join(trimmed);
        if asset.is_file() {
            return Ok(NamedFile::open(asset)?);
        }

        let folder_index = frontend_dir.0.join(trimmed).join("index.html");
        if folder_index.exists() {
            return Ok(NamedFile::open(folder_index)?);
        }

        let flat_html = frontend_dir.0.join(format!("{}.html", trimmed));
        if flat_html.exists() {
            return Ok(NamedFile::open(flat_html)?);
        }
    }

    if path.starts_with("/sim/") || path == "/sim" || path == "/sim/" {
        let sim_placeholder = frontend_dir.0.join("sim").join("_").join("index.html");
        if sim_placeholder.exists() {
            return Ok(NamedFile::open(sim_placeholder)?);
        }
    }

    if path.starts_with("/character/") || path == "/character" || path == "/character/" {
        let character_placeholder = frontend_dir
            .0
            .join("character")
            .join("us")
            .join("realm")
            .join("name")
            .join("index.html");
        if character_placeholder.exists() {
            return Ok(NamedFile::open(character_placeholder)?);
        }
    }

    Ok(NamedFile::open(frontend_dir.0.join("index.html"))?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{JobStorage, MemoryStorage};
    use actix_web::body::to_bytes;
    use actix_web::test::TestRequest;
    use serde_json::Value;
    use std::fs;

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    async fn response_json(resp: HttpResponse) -> Value {
        let body = to_bytes(resp.into_body()).await.expect("response body");
        serde_json::from_slice(&body).expect("response json")
    }

    fn write_file(path: impl AsRef<std::path::Path>, body: &str) {
        if let Some(parent) = path.as_ref().parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        fs::write(path, body).expect("write file");
    }

    #[actix_web::test]
    async fn get_config_returns_max_scenarios_and_current_max_jobs() {
        let store = test_store();
        store.set_max_jobs(7);

        let resp = get_config(store.clone()).await;

        assert_eq!(resp.status(), 200);

        let payload = response_json(resp).await;

        assert_eq!(
            payload["max_scenarios"].as_u64(),
            Some(*storage::MAX_SCENARIOS as u64)
        );

        assert_eq!(payload["max_jobs"].as_u64(), Some(7));
        assert_eq!(
            payload["max_parallel_jobs"].as_u64(),
            Some(store.get_max_parallel_jobs() as u64)
        );
    }

    #[actix_web::test]
    async fn update_config_without_max_jobs_preserves_existing_limit() {
        let store = test_store();
        store.set_max_jobs(9);

        let resp = update_config(
            web::Json(UpdateConfig {
                max_jobs: None,
                max_parallel_jobs: None,
            }),
            store.clone(),
        )
        .await;

        assert_eq!(resp.status(), 200);
        assert_eq!(
            response_json(resp).await["status"].as_str(),
            Some("updated")
        );

        let config = get_config(store).await;
        let payload = response_json(config).await;

        assert_eq!(payload["max_jobs"].as_u64(), Some(9));
    }

    #[actix_web::test]
    async fn update_config_with_max_jobs_updates_config() {
        let store = test_store();
        store.set_max_jobs(3);

        let resp = update_config(
            web::Json(UpdateConfig {
                max_jobs: Some(12),
                max_parallel_jobs: None,
            }),
            store.clone(),
        )
        .await;

        assert_eq!(resp.status(), 200);
        assert_eq!(
            response_json(resp).await["status"].as_str(),
            Some("updated")
        );

        let config = get_config(store).await;
        let payload = response_json(config).await;

        assert_eq!(payload["max_jobs"].as_u64(), Some(12));
        assert_eq!(
            payload["max_scenarios"].as_u64(),
            Some(*storage::MAX_SCENARIOS as u64)
        );
    }

    #[actix_web::test]
    async fn update_config_with_max_parallel_jobs_updates_config() {
        let store = test_store();
        let original_limit = crate::simc_runner::simulation_concurrency_limit();

        let resp = update_config(
            web::Json(UpdateConfig {
                max_jobs: None,
                max_parallel_jobs: Some(4),
            }),
            store.clone(),
        )
        .await;

        assert_eq!(resp.status(), 200);
        assert_eq!(store.get_max_parallel_jobs(), 4);

        let config = get_config(store).await;
        let payload = response_json(config).await;
        assert_eq!(payload["max_parallel_jobs"].as_u64(), Some(4));

        crate::simc_runner::set_simulation_concurrency_limit(original_limit);
    }

    #[actix_web::test]
    async fn update_config_rejects_zero_parallel_jobs_without_partial_updates() {
        let store = test_store();
        store.set_max_jobs(3);
        store.set_max_parallel_jobs(2);

        let resp = update_config(
            web::Json(UpdateConfig {
                max_jobs: Some(9),
                max_parallel_jobs: Some(0),
            }),
            store.clone(),
        )
        .await;

        assert_eq!(resp.status(), 400);
        assert_eq!(store.get_max_jobs(), 3);
        assert_eq!(store.get_max_parallel_jobs(), 2);
    }

    #[actix_web::test]
    async fn update_config_allows_zero_max_jobs() {
        let store = test_store();
        store.set_max_jobs(3);

        let resp = update_config(
            web::Json(UpdateConfig {
                max_jobs: Some(0),
                max_parallel_jobs: None,
            }),
            store.clone(),
        )
        .await;

        assert_eq!(resp.status(), 200);

        let config = get_config(store).await;
        let payload = response_json(config).await;

        assert_eq!(payload["max_jobs"].as_u64(), Some(0));
    }

    #[actix_web::test]
    async fn update_config_can_be_applied_multiple_times() {
        let store = test_store();

        update_config(
            web::Json(UpdateConfig {
                max_jobs: Some(4),
                max_parallel_jobs: None,
            }),
            store.clone(),
        )
        .await;

        update_config(
            web::Json(UpdateConfig {
                max_jobs: Some(15),
                max_parallel_jobs: None,
            }),
            store.clone(),
        )
        .await;

        let config = get_config(store).await;
        let payload = response_json(config).await;

        assert_eq!(payload["max_jobs"].as_u64(), Some(15));
    }

    #[actix_web::test]
    async fn health_check_reports_ok_mode_and_threads() {
        let health = health_check().await;

        assert_eq!(health.status(), 200);

        let payload = response_json(health).await;

        assert_eq!(payload["status"].as_str(), Some("ok"));
        let expected_mode = if cfg!(feature = "desktop") {
            "desktop"
        } else {
            "web"
        };
        assert_eq!(payload["mode"].as_str(), Some(expected_mode));
        assert!(payload["threads"].as_u64().unwrap_or(0) >= 1);
        assert!(payload["version"].as_str().is_some_and(|value| !value.is_empty()));
        assert!(payload["revision"].as_str().is_some_and(|value| !value.is_empty()));
    }

    #[test]
    fn readiness_reports_ready_without_sensitive_details() {
        let summary = data_sync::DataReadinessSummary {
            available: true,
            required_missing: 0,
            optional_missing: 0,
        };
        let (status, message) =
            data_readiness_state(&data_sync::SyncStatus::Ready, false, &summary);

        assert_eq!(status, "ready");
        assert_eq!(message, "Game data is ready.");
        assert!(!message.contains("C:"));
        assert!(!message.contains('/'));
    }

    #[test]
    fn readiness_reports_degraded_data_and_missing_data() {
        let complete = data_sync::DataReadinessSummary {
            available: true,
            required_missing: 0,
            optional_missing: 0,
        };
        let missing = data_sync::DataReadinessSummary {
            available: true,
            required_missing: 2,
            optional_missing: 1,
        };

        assert_eq!(
            data_readiness_state(&data_sync::SyncStatus::Ready, true, &complete).0,
            "degraded"
        );
        assert_eq!(
            data_readiness_state(&data_sync::SyncStatus::Ready, false, &missing).0,
            "blocked"
        );
    }

    #[test]
    fn readiness_reports_missing_credentials_and_simulation_runtime() {
        let summary = data_sync::DataReadinessSummary {
            available: true,
            required_missing: 0,
            optional_missing: 0,
        };

        assert_eq!(
            data_readiness_state(&data_sync::SyncStatus::NeedsCredentials, false, &summary).0,
            "needs_credentials"
        );
        assert_eq!(
            overall_readiness_status(true, "needs_credentials", false),
            "attention"
        );
        assert_eq!(overall_readiness_status(false, "ready", true), "blocked");
    }

    #[cfg(feature = "desktop")]
    #[test]
    fn system_stats_new_returns_non_negative_cpu_usage() {
        let stats = SystemStats::new();
        assert!(stats.cpu_usage() >= 0.0);
    }

    #[cfg(feature = "desktop")]
    #[test]
    fn system_stats_refresh_keeps_cpu_usage_non_negative() {
        let mut stats = SystemStats::new();
        stats.refresh();
        assert!(stats.cpu_usage() >= 0.0);
    }

    #[cfg(feature = "desktop")]
    #[actix_web::test]
    async fn system_stats_endpoint_returns_rounded_cpu_usage() {
        let stats = web::Data::new(Arc::new(Mutex::new(SystemStats::new())));

        let resp = system_stats(stats).await;

        assert_eq!(resp.status(), 200);

        let payload = response_json(resp).await;
        let cpu_usage = payload["cpu_usage"]
            .as_f64()
            .expect("cpu_usage should be numeric");

        assert!(cpu_usage >= 0.0);
        assert!(cpu_usage <= 100.0);
    }

    #[actix_web::test]
    async fn spa_fallback_serves_folder_index_for_nested_route() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("settings").join("index.html"), "settings");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(
            TestRequest::with_uri("/settings").to_http_request(),
            frontend,
        )
        .await
        .expect("settings fallback");

        assert_eq!(
            fs::read_to_string(file.path()).expect("settings body"),
            "settings"
        );
    }

    #[actix_web::test]
    async fn spa_fallback_serves_folder_index_when_route_has_trailing_slash() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("settings").join("index.html"), "settings");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(
            TestRequest::with_uri("/settings/").to_http_request(),
            frontend,
        )
        .await
        .expect("settings fallback");

        assert_eq!(
            fs::read_to_string(file.path()).expect("settings body"),
            "settings"
        );
    }

    #[actix_web::test]
    async fn spa_fallback_serves_flat_html_when_folder_index_is_missing() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("about.html"), "about");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(TestRequest::with_uri("/about").to_http_request(), frontend)
            .await
            .expect("about fallback");

        assert_eq!(
            fs::read_to_string(file.path()).expect("about body"),
            "about"
        );
    }

    #[actix_web::test]
    async fn spa_fallback_serves_root_frontend_assets_before_html_fallback() {
        let dir = tempfile::tempdir().expect("frontend temp dir");
        let asset_path = dir.path().join("icon.png");
        let asset_bytes = [0x89, b'P', b'N', b'G'];
        fs::write(&asset_path, asset_bytes).expect("icon asset");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));
        let file = spa_fallback(
            TestRequest::with_uri("/icon.png").to_http_request(),
            frontend,
        )
        .await
        .expect("icon fallback");

        assert_eq!(file.path(), asset_path.as_path());
        assert_eq!(fs::read(file.path()).expect("icon body"), asset_bytes);
    }

    #[actix_web::test]
    async fn spa_fallback_prefers_folder_index_over_flat_html() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("about").join("index.html"), "folder");
        write_file(dir.path().join("about.html"), "flat");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(TestRequest::with_uri("/about").to_http_request(), frontend)
            .await
            .expect("about fallback");

        assert_eq!(
            fs::read_to_string(file.path()).expect("about body"),
            "folder"
        );
    }

    #[actix_web::test]
    async fn spa_fallback_serves_sim_placeholder_for_sim_root() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("sim").join("_").join("index.html"), "sim");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        for uri in ["/sim", "/sim/"] {
            let file = spa_fallback(
                TestRequest::with_uri(uri).to_http_request(),
                frontend.clone(),
            )
            .await
            .expect("sim fallback");

            assert_eq!(fs::read_to_string(file.path()).expect("sim body"), "sim");
        }
    }

    #[actix_web::test]
    async fn spa_fallback_serves_sim_placeholder_for_nested_sim_route() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("sim").join("_").join("index.html"), "sim");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(
            TestRequest::with_uri("/sim/abc123").to_http_request(),
            frontend,
        )
        .await
        .expect("sim nested fallback");

        assert_eq!(fs::read_to_string(file.path()).expect("sim body"), "sim");
    }

    #[actix_web::test]
    async fn spa_fallback_serves_character_placeholder_for_character_root() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(
            dir.path()
                .join("character")
                .join("us")
                .join("realm")
                .join("name")
                .join("index.html"),
            "character",
        );

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        for uri in ["/character", "/character/"] {
            let file = spa_fallback(
                TestRequest::with_uri(uri).to_http_request(),
                frontend.clone(),
            )
            .await
            .expect("character fallback");

            assert_eq!(
                fs::read_to_string(file.path()).expect("character body"),
                "character"
            );
        }
    }

    #[actix_web::test]
    async fn spa_fallback_serves_character_placeholder_for_nested_character_route() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(
            dir.path()
                .join("character")
                .join("us")
                .join("realm")
                .join("name")
                .join("index.html"),
            "character",
        );

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(
            TestRequest::with_uri("/character/eu/turalyon/lazarruss").to_http_request(),
            frontend,
        )
        .await
        .expect("character nested fallback");

        assert_eq!(
            fs::read_to_string(file.path()).expect("character body"),
            "character"
        );
    }

    #[actix_web::test]
    async fn spa_fallback_serves_root_index_for_unknown_route() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("index.html"), "root");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(
            TestRequest::with_uri("/unknown").to_http_request(),
            frontend,
        )
        .await
        .expect("root fallback");

        assert_eq!(fs::read_to_string(file.path()).expect("root body"), "root");
    }

    #[actix_web::test]
    async fn spa_fallback_serves_root_index_for_root_path() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        write_file(dir.path().join("index.html"), "root");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let file = spa_fallback(TestRequest::with_uri("/").to_http_request(), frontend)
            .await
            .expect("root fallback");

        assert_eq!(fs::read_to_string(file.path()).expect("root body"), "root");
    }

    #[actix_web::test]
    async fn spa_fallback_errors_when_no_matching_file_or_root_index_exists() {
        let dir = tempfile::tempdir().expect("frontend temp dir");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));

        let missing = spa_fallback(
            TestRequest::with_uri("/missing").to_http_request(),
            frontend,
        )
        .await;

        assert!(missing.is_err());
    }
}
