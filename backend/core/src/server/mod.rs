#[cfg(feature = "web")]
pub mod auth_handlers;
mod blizzard;
mod character_profile_handlers;
#[cfg(feature = "web")]
mod data_provider;
mod data_sync;
#[cfg(feature = "web")]
mod discord_webhook;
#[cfg(feature = "web")]
mod docker_updates;
#[cfg(feature = "web")]
pub mod dungeon_data;
#[cfg(feature = "web")]
pub mod dungeon_source_blizzard;
#[cfg(feature = "web")]
mod game_data_handlers;
#[cfg(feature = "web")]
mod helpers;
#[cfg(feature = "web")]
mod integrations;
#[cfg(feature = "web")]
mod job_handlers;
#[cfg(feature = "web")]
mod lan_access;
#[cfg(feature = "web")]
mod route_handlers;
#[cfg(feature = "web")]
mod sim_handlers;
#[cfg(feature = "web")]
mod system_handlers;
#[cfg(feature = "web")]
mod types;
#[cfg(feature = "web")]
mod upgrade_compare;

#[cfg(feature = "web")]
use actix_cors::Cors;
#[cfg(feature = "web")]
use actix_web::body::MessageBody;
#[cfg(feature = "web")]
use actix_web::dev::{ServiceRequest, ServiceResponse};
#[cfg(feature = "web")]
use actix_web::http::Method;
#[cfg(feature = "web")]
use actix_web::middleware::{self, Next};
#[cfg(feature = "web")]
use actix_web::{web, App, Error, HttpResponse, HttpServer};
use std::path::{Path, PathBuf};
use std::sync::Arc;
#[cfg(all(feature = "desktop", feature = "web"))]
use std::sync::Mutex;

#[cfg(feature = "web")]
use crate::log_buffer::LogBuffer;
use crate::storage::JobStorage;
#[cfg(feature = "web")]
use system_handlers::*;
#[cfg(feature = "web")]
use types::FrontendDir;

#[derive(Clone, Copy, Debug, Default)]
pub struct ServerSecurityOptions {
    /// Allow the desktop app to expose a paired LAN listener without using
    /// the environment-based external-server escape hatch.
    pub lan_pairing: bool,
}

pub fn is_loopback_bind(host: &str) -> bool {
    matches!(
        host.trim().trim_matches(['[', ']']),
        "localhost" | "127.0.0.1" | "::1"
    )
}

pub fn external_bind_allowed(configured: Option<&str>) -> bool {
    configured
        .map(|value| value.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn public_security_path(path: &str) -> bool {
    matches!(
        path,
        "/api/health"
            | "/api/auth/bnet/login"
            | "/api/auth/bnet/login-success"
            | "/api/auth/bnet/callback"
            | "/api/auth/poll"
            | "/api/auth/bnet/credentials-status"
            | "/api/auth/me"
            | "/api/data/status"
            | "/api/readiness"
            | "/api/lan/pair"
            | "/api/lan/pair/consume"
    )
}

fn lan_pairing_public_path(path: &str) -> bool {
    matches!(path, "/api/lan/pair" | "/api/lan/pair/consume")
}

fn runtime_credentials_public_request(req: &ServiceRequest) -> bool {
    if req.path() != "/api/auth/bnet/credential-profiles" {
        return false;
    }
    if *req.method() == Method::GET {
        return true;
    }
    if *req.method() != Method::POST || !auth_handlers::hosted_private_deployment() {
        return false;
    }
    let has_users = req
        .app_data::<web::Data<Arc<dyn JobStorage>>>()
        .is_some_and(|store| !store.list_users().is_empty());
    !has_users && same_origin_request(req)
}

fn admin_security_path(path: &str, method: &Method) -> bool {
    path.starts_with("/api/admin/")
        || (*method != Method::GET
            && (path == "/api/config"
                || path == "/api/system/blizzard/credentials"
                || path.starts_with("/api/auth/bnet/credential-profiles")
                || path == "/api/data/sync"
                || path == "/api/data/sync-dungeons"
                || path == "/api/data/files/open-directory"
                || path == "/api/data/files/missing/download"
                || (path.starts_with("/api/data/files/") && path.ends_with("/download"))))
}

fn public_light_mode_request(req: &ServiceRequest) -> bool {
    let path = req.path();
    let method = req.method();
    let is_read = matches!(*method, Method::GET | Method::OPTIONS);
    let is_write = *method == Method::POST;

    if path == "/api/sim" {
        return is_write || *method == Method::OPTIONS;
    }

    if let Some(suffix) = path.strip_prefix("/api/sim/") {
        let mut segments = suffix.split('/');
        let _id = segments.next();
        let action = segments.next();
        return is_read
            || (is_write
                && matches!(action, Some("cancel" | "pause" | "resume" | "rerun"))
                && segments.next().is_none());
    }

    if is_read
        && (matches!(
            path,
            "/api/sims"
                | "/api/history/stats"
                | "/api/history/characters"
                | "/api/config"
                | "/api/dungeons"
                | "/api/game-context"
                | "/api/game-data/state"
                | "/api/instances"
                | "/api/season-config"
                | "/api/upgrade-options"
                | "/api/upgrade-tracks"
        ) || path.starts_with("/api/data/images/")
            || path.starts_with("/api/data/instance-images/")
            || path.starts_with("/api/data/files/")
            || path.starts_with("/api/data/static/")
            || path.starts_with("/api/data/wowhead-zones-index")
            || path.starts_with("/api/enchant-info/")
            || path.starts_with("/api/gem-info/")
            || path.starts_with("/api/instances/")
            || path.starts_with("/api/item-info/")
            || path.starts_with("/api/talent-tree/")
            || path.starts_with("/api/gear/"))
    {
        return true;
    }

    is_write
        && matches!(
            path,
            "/api/droptimizer/sim"
                | "/api/item-info/batch"
                | "/api/max-upgrade-ilevels"
                | "/api/top-gear/combo-count"
                | "/api/top-gear/sim"
                | "/api/upgrade-compare/combo-count"
                | "/api/upgrade-compare/prepare"
                | "/api/upgrade-compare/sim"
        )
        || path.starts_with("/api/gear/")
}

fn is_loopback_peer(req: &ServiceRequest) -> bool {
    req.peer_addr()
        .is_some_and(|address| address.ip().is_loopback())
}

fn same_origin_request(req: &ServiceRequest) -> bool {
    let host = req.connection_info().host().to_string();
    ["origin", "referer"].iter().any(|header_name| {
        req.headers()
            .get(*header_name)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| {
                let (scheme, authority_and_path) = value.split_once("://")?;
                if !matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https") {
                    return None;
                }
                let authority = authority_and_path.split(['/', '?', '#']).next()?;
                (!authority.contains('@')).then_some(authority)
            })
            .map(|authority| authority.eq_ignore_ascii_case(&host))
            .unwrap_or(false)
    })
}

async fn enforce_security<B>(
    req: ServiceRequest,
    next: Next<B>,
    require_auth: bool,
    lan_pairing: bool,
) -> Result<ServiceResponse<B>, Error>
where
    B: MessageBody + 'static,
{
    if !require_auth || !req.path().starts_with("/api/") || is_loopback_peer(&req) {
        return next.call(req).await;
    }

    if lan_pairing && !lan_pairing_public_path(req.path()) {
        let lan_access = req
            .app_data::<web::Data<Arc<lan_access::LanAccessState>>>()
            .ok_or_else(|| {
                Error::from(actix_web::error::ErrorInternalServerError(
                    "LAN access state unavailable",
                ))
            })?;
        if !lan_access::has_valid_access(&req, lan_access.get_ref()) {
            return Err(actix_web::error::ErrorUnauthorized("LAN pairing required"));
        }

        let state_changing = matches!(
            *req.method(),
            Method::POST | Method::PUT | Method::PATCH | Method::DELETE
        );
        let has_bearer = req
            .headers()
            .get(actix_web::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("Bearer "));
        let is_disconnect = req.path() == "/api/lan/disconnect" && *req.method() == Method::POST;
        if state_changing && !has_bearer && !is_disconnect && !same_origin_request(&req) {
            return Err(actix_web::error::ErrorForbidden("CSRF validation failed"));
        }

        if public_security_path(req.path()) {
            return next.call(req).await;
        }
    }

    if runtime_credentials_public_request(&req) {
        return next.call(req).await;
    }

    if public_security_path(req.path()) {
        return next.call(req).await;
    }

    if !lan_pairing
        && !auth_handlers::hosted_private_deployment()
        && public_light_mode_request(&req)
    {
        let state_changing = matches!(
            *req.method(),
            Method::POST | Method::PUT | Method::PATCH | Method::DELETE
        );
        if state_changing && !same_origin_request(&req) {
            return Err(actix_web::error::ErrorForbidden("CSRF validation failed"));
        }
        return next.call(req).await;
    }

    let auth_state = req
        .app_data::<web::Data<Arc<auth_handlers::BlizzardAuthState>>>()
        .ok_or_else(|| actix_web::error::ErrorInternalServerError("auth state unavailable"))?;
    let claims = req
        .app_data::<web::Data<Arc<dyn JobStorage>>>()
        .and_then(|store| {
            auth_handlers::verify_active_session(
                req.request(),
                auth_state.get_ref(),
                store.get_ref().as_ref(),
            )
        })
        .or_else(|| {
            req.app_data::<web::Data<Arc<dyn JobStorage>>>()
                .is_none()
                .then(|| auth_handlers::verify_jwt_for_state(req.request(), auth_state.get_ref()))
                .flatten()
        });
    let Some(claims) = claims else {
        return Err(actix_web::error::ErrorUnauthorized(
            "authentication required",
        ));
    };
    if admin_security_path(req.path(), req.method()) && claims.role != "admin" {
        return Err(actix_web::error::ErrorForbidden("admin access required"));
    }

    let state_changing = matches!(
        *req.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );
    let has_bearer = req
        .headers()
        .get(actix_web::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("Bearer "));
    if state_changing && !has_bearer && !same_origin_request(&req) {
        return Err(actix_web::error::ErrorForbidden("CSRF validation failed"));
    }

    next.call(req).await
}

fn static_cache_control(path: &str) -> Option<&'static str> {
    if path.starts_with("/_next/static/") {
        Some("public, max-age=31536000, immutable")
    } else if path == "/sw.js" {
        Some("no-cache, no-store, must-revalidate")
    } else if path == "/manifest.webmanifest" {
        Some("no-cache, must-revalidate")
    } else {
        None
    }
}

async fn add_static_cache_headers<B>(
    req: ServiceRequest,
    next: Next<B>,
) -> Result<ServiceResponse<B>, Error>
where
    B: MessageBody + 'static,
{
    let cache_control = static_cache_control(req.path());
    let mut response = next.call(req).await?;
    if let Some(cache_control) = cache_control {
        response.headers_mut().insert(
            actix_web::http::header::CACHE_CONTROL,
            actix_web::http::header::HeaderValue::from_static(cache_control),
        );
    }
    Ok(response)
}

#[cfg(test)]
#[cfg(feature = "web")]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use actix_web::body::to_bytes;
    use actix_web::test::{call_service, init_service, try_call_service, TestRequest};
    use serde_json::Value;

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(crate::storage::MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    #[test]
    fn external_bind_requires_explicit_opt_in() {
        assert!(is_loopback_bind("127.0.0.1"));
        assert!(is_loopback_bind("[::1]"));
        assert!(!is_loopback_bind("0.0.0.0"));
        assert!(!external_bind_allowed(Some("false")));
        assert!(external_bind_allowed(Some("TRUE")));
    }

    #[test]
    fn config_mutations_are_admin_security_paths_but_reads_are_not() {
        assert!(!admin_security_path("/api/config", &Method::GET));
        assert!(admin_security_path("/api/config", &Method::POST));
        assert!(admin_security_path("/api/config", &Method::PUT));
    }

    #[test]
    fn static_cache_policy_matches_directly_served_frontend_assets() {
        assert_eq!(
            static_cache_control("/_next/static/chunks/app.js"),
            Some("public, max-age=31536000, immutable")
        );
        assert_eq!(
            static_cache_control("/sw.js"),
            Some("no-cache, no-store, must-revalidate")
        );
        assert_eq!(
            static_cache_control("/manifest.webmanifest"),
            Some("no-cache, must-revalidate")
        );
        assert_eq!(static_cache_control("/api/health"), None);
    }

    #[actix_web::test]
    async fn external_security_middleware_rejects_protected_routes_without_auth() {
        let state = web::Data::new(Arc::new(auth_handlers::BlizzardAuthState::new(
            None,
            None,
            "http://localhost/callback".to_string(),
            "a-secure-secret-with-more-than-32-bytes".to_string(),
        )));
        let app = init_service(
            App::new()
                .app_data(state)
                .wrap(middleware::from_fn(|req, next| {
                    enforce_security(req, next, true, false)
                }))
                .route(
                    "/api/protected",
                    web::get().to(|| async { HttpResponse::Ok().finish() }),
                ),
        )
        .await;

        let error =
            try_call_service(&app, TestRequest::get().uri("/api/protected").to_request()).await;
        assert_eq!(
            error
                .expect_err("request should be rejected")
                .as_response_error()
                .status_code(),
            actix_web::http::StatusCode::UNAUTHORIZED
        );
    }

    #[actix_web::test]
    async fn external_security_allows_light_mode_simulation_routes_without_auth() {
        let state = web::Data::new(Arc::new(auth_handlers::BlizzardAuthState::new(
            None,
            None,
            "http://localhost/callback".to_string(),
            "a-secure-secret-with-more-than-32-bytes".to_string(),
        )));
        let app = init_service(
            App::new()
                .app_data(state)
                .wrap(middleware::from_fn(|req, next| {
                    enforce_security(req, next, true, false)
                }))
                .route(
                    "/api/sim",
                    web::post().to(|| async { HttpResponse::Ok().finish() }),
                )
                .route(
                    "/api/sim/{id}",
                    web::get().to(|| async { HttpResponse::Ok().finish() }),
                )
                .route(
                    "/api/sim/{id}/rerun",
                    web::post().to(|| async { HttpResponse::Ok().finish() }),
                )
                .route(
                    "/api/data/files/{key}/content",
                    web::get().to(|| async { HttpResponse::Ok().finish() }),
                )
                .route(
                    "/api/protected",
                    web::get().to(|| async { HttpResponse::Ok().finish() }),
                ),
        )
        .await;

        let create_response = call_service(
            &app,
            TestRequest::post()
                .uri("/api/sim")
                .insert_header(("host", "localhost"))
                .insert_header(("origin", "http://localhost"))
                .to_request(),
        )
        .await;
        assert_eq!(create_response.status(), actix_web::http::StatusCode::OK);

        let rerun_response = call_service(
            &app,
            TestRequest::post()
                .uri("/api/sim/job-1/rerun")
                .insert_header(("host", "localhost"))
                .insert_header(("origin", "http://localhost"))
                .to_request(),
        )
        .await;
        assert_eq!(rerun_response.status(), actix_web::http::StatusCode::OK);

        let status_response =
            call_service(&app, TestRequest::get().uri("/api/sim/job-1").to_request()).await;
        assert_eq!(status_response.status(), actix_web::http::StatusCode::OK);

        let data_file_response = call_service(
            &app,
            TestRequest::get()
                .uri("/api/data/files/wow_expansions/content")
                .to_request(),
        )
        .await;
        assert_eq!(data_file_response.status(), actix_web::http::StatusCode::OK);

        let protected_error =
            try_call_service(&app, TestRequest::get().uri("/api/protected").to_request())
                .await
                .expect_err("protected route should still require authentication");
        assert_eq!(
            protected_error.as_response_error().status_code(),
            actix_web::http::StatusCode::UNAUTHORIZED
        );
    }

    #[actix_web::test]
    async fn lan_security_rejects_unpaired_remote_requests_but_keeps_loopback_access() {
        let lan_access = web::Data::new(Arc::new(lan_access::LanAccessState::new()));
        let app = init_service(
            App::new()
                .app_data(lan_access)
                .wrap(middleware::from_fn(|req, next| {
                    enforce_security(req, next, true, true)
                }))
                .route(
                    "/api/protected",
                    web::get().to(|| async { HttpResponse::Ok().finish() }),
                ),
        )
        .await;

        let remote_error = try_call_service(
            &app,
            TestRequest::get()
                .uri("/api/protected")
                .peer_addr("192.168.1.20:50000".parse().unwrap())
                .to_request(),
        )
        .await
        .expect_err("unpaired remote request should be rejected");
        assert_eq!(
            remote_error.as_response_error().status_code(),
            actix_web::http::StatusCode::UNAUTHORIZED
        );

        let loopback_response = call_service(
            &app,
            TestRequest::get()
                .uri("/api/protected")
                .peer_addr("127.0.0.1:50000".parse().unwrap())
                .to_request(),
        )
        .await;
        assert_eq!(loopback_response.status(), actix_web::http::StatusCode::OK);
    }

    #[actix_web::test]
    async fn lan_security_does_not_treat_public_auth_routes_as_paired_access() {
        let lan_access = web::Data::new(Arc::new(lan_access::LanAccessState::new()));
        let app = init_service(
            App::new()
                .app_data(lan_access)
                .wrap(middleware::from_fn(|req, next| {
                    enforce_security(req, next, true, true)
                }))
                .route(
                    "/api/auth/me",
                    web::get().to(|| async { HttpResponse::Ok().finish() }),
                ),
        )
        .await;

        let error = try_call_service(
            &app,
            TestRequest::get()
                .uri("/api/auth/me")
                .peer_addr("192.168.1.20:50000".parse().unwrap())
                .to_request(),
        )
        .await
        .expect_err("unpaired LAN auth request should be rejected");
        assert_eq!(
            error.as_response_error().status_code(),
            actix_web::http::StatusCode::UNAUTHORIZED
        );
    }

    #[actix_web::test]
    async fn external_security_middleware_requires_same_origin_for_cookie_mutations() {
        let secret = "a-secure-secret-with-more-than-32-bytes";
        let state = web::Data::new(Arc::new(auth_handlers::BlizzardAuthState::new(
            None,
            None,
            "http://localhost/callback".to_string(),
            secret.to_string(),
        )));
        let token = jsonwebtoken::encode(
            &jsonwebtoken::Header::default(),
            &auth_handlers::Claims {
                sub: "Tester#1".to_string(),
                session_id: "session-1".to_string(),
                battletag: "Tester#1".to_string(),
                role: "member".to_string(),
                session_epoch: None,
                exp: (chrono::Utc::now().timestamp() + 3600) as usize,
            },
            &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
        )
        .expect("jwt");
        let app = init_service(
            App::new()
                .app_data(state)
                .wrap(middleware::from_fn(|req, next| {
                    enforce_security(req, next, true, false)
                }))
                .route(
                    "/api/protected",
                    web::post().to(|| async { HttpResponse::Ok().finish() }),
                ),
        )
        .await;

        let error = try_call_service(
            &app,
            TestRequest::post()
                .uri("/api/protected")
                .cookie(actix_web::cookie::Cookie::new("bnet_session", token))
                .to_request(),
        )
        .await;
        assert_eq!(
            error
                .expect_err("request should be rejected")
                .as_response_error()
                .status_code(),
            actix_web::http::StatusCode::FORBIDDEN
        );
    }

    #[actix_web::test]
    async fn health_check_reports_ok_with_parallelism() {
        let resp = health_check().await;
        assert_eq!(resp.status(), 200);

        let body = to_bytes(resp.into_body()).await.expect("health body");
        let payload: Value = serde_json::from_slice(&body).expect("health json");
        assert_eq!(payload.get("status").and_then(Value::as_str), Some("ok"));
        let expected_mode = if cfg!(feature = "desktop") {
            "desktop"
        } else {
            "web"
        };
        assert_eq!(
            payload.get("mode").and_then(Value::as_str),
            Some(expected_mode)
        );
        assert!(payload
            .get("threads")
            .and_then(Value::as_u64)
            .is_some_and(|threads| threads > 0));
    }

    #[actix_web::test]
    async fn config_handlers_read_and_update_max_jobs() {
        let store = test_store();

        let update = update_config(
            web::Json(UpdateConfig {
                max_jobs: Some(7),
                max_parallel_jobs: None,
            }),
            store.clone(),
        )
        .await;
        assert_eq!(update.status(), 200);

        let config = get_config(store).await;
        assert_eq!(config.status(), 200);
        let body = to_bytes(config.into_body()).await.expect("config body");
        let payload: Value = serde_json::from_slice(&body).expect("config json");
        assert_eq!(payload.get("max_jobs").and_then(Value::as_u64), Some(7));
        assert!(payload
            .get("max_scenarios")
            .and_then(Value::as_u64)
            .is_some());
    }

    #[actix_web::test]
    async fn spa_fallback_serves_route_specific_and_dynamic_placeholder_files() {
        let dir = tempfile::tempdir().expect("frontend temp dir");
        std::fs::write(dir.path().join("index.html"), "root").expect("root index");
        std::fs::create_dir_all(dir.path().join("settings")).expect("settings dir");
        std::fs::write(dir.path().join("settings").join("index.html"), "settings")
            .expect("settings index");
        std::fs::create_dir_all(dir.path().join("sim").join("_")).expect("sim dir");
        std::fs::write(dir.path().join("sim").join("_").join("index.html"), "sim")
            .expect("sim placeholder");
        std::fs::create_dir_all(
            dir.path()
                .join("character")
                .join("us")
                .join("realm")
                .join("name"),
        )
        .expect("character dir");
        std::fs::write(
            dir.path()
                .join("character")
                .join("us")
                .join("realm")
                .join("name")
                .join("index.html"),
            "character",
        )
        .expect("character placeholder");

        let frontend = web::Data::new(FrontendDir(dir.path().to_path_buf()));
        let settings = spa_fallback(
            TestRequest::with_uri("/settings").to_http_request(),
            frontend.clone(),
        )
        .await
        .expect("settings fallback");
        assert_eq!(
            std::fs::read_to_string(settings.path()).expect("settings body"),
            "settings"
        );

        let sim = spa_fallback(
            TestRequest::with_uri("/sim/abc123").to_http_request(),
            frontend.clone(),
        )
        .await
        .expect("sim fallback");
        assert_eq!(
            std::fs::read_to_string(sim.path()).expect("sim body"),
            "sim"
        );

        let character = spa_fallback(
            TestRequest::with_uri("/character/us/area-52/tester").to_http_request(),
            frontend.clone(),
        )
        .await
        .expect("character fallback");
        assert_eq!(
            std::fs::read_to_string(character.path()).expect("character body"),
            "character"
        );

        let root = spa_fallback(
            TestRequest::with_uri("/missing").to_http_request(),
            frontend,
        )
        .await
        .expect("root fallback");
        assert_eq!(
            std::fs::read_to_string(root.path()).expect("root body"),
            "root"
        );
    }
}

// ---------- Server startup ----------

/// Start the HTTP server with in-memory storage (desktop default).
pub async fn start(
    resource_dir: &Path,
    frontend_dir: Option<PathBuf>,
) -> (actix_web::dev::Server, u16) {
    let simc_path = if cfg!(windows) {
        resource_dir.join("simc").join("simc.exe")
    } else {
        resource_dir.join("simc").join("simc")
    };
    let data_dir = Some(resource_dir.join("data"));
    let storage: Arc<dyn JobStorage> = Arc::new(crate::storage::memory::MemoryStorage::new());
    start_with_storage(storage, simc_path, 17384, frontend_dir, data_dir).await
}

/// Start the actix-web HTTP server with a given storage backend.
/// Returns the server handle and port number.
pub async fn start_with_storage(
    storage: Arc<dyn JobStorage>,
    simc_path: PathBuf,
    port: u16,
    frontend_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
) -> (actix_web::dev::Server, u16) {
    start_with_storage_bind(
        storage,
        simc_path,
        "127.0.0.1",
        port,
        frontend_dir,
        data_dir,
    )
    .await
}

/// Start the actix-web HTTP server with a given storage backend and bind address.
/// Returns the server handle and the port number.
pub async fn start_with_storage_bind(
    storage: Arc<dyn JobStorage>,
    simc_path: PathBuf,
    bind_host: &str,
    port: u16,
    frontend_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
) -> (actix_web::dev::Server, u16) {
    start_with_storage_bind_options(
        storage,
        simc_path,
        bind_host,
        port,
        frontend_dir,
        data_dir,
        ServerSecurityOptions::default(),
    )
    .await
}

/// Start the actix-web HTTP server with explicit security behavior.
///
/// The regular environment-based external-bind guard remains the default. The
/// desktop app uses the LAN pairing option so it can expose a trusted, paired
/// listener without making the backend directly reachable to unpaired clients.
pub async fn start_with_storage_bind_options(
    storage: Arc<dyn JobStorage>,
    simc_path: PathBuf,
    bind_host: &str,
    port: u16,
    frontend_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    security: ServerSecurityOptions,
) -> (actix_web::dev::Server, u16) {
    start_with_storage_bind_options_and_simc_runtime(
        storage,
        simc_path,
        bind_host,
        port,
        frontend_dir,
        data_dir,
        security,
        None,
    )
    .await
}

/// Start the HTTP server with an optional runtime-managed SimC installation.
/// The runtime controller is used by hosted Docker deployments; desktop and
/// test callers continue to use the fixed executable path above.
pub async fn start_with_storage_bind_options_and_simc_runtime(
    storage: Arc<dyn JobStorage>,
    simc_path: PathBuf,
    bind_host: &str,
    port: u16,
    frontend_dir: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    security: ServerSecurityOptions,
    simc_runtime: Option<Arc<crate::simc_runtime::SimcRuntimeState>>,
) -> (actix_web::dev::Server, u16) {
    #[cfg(feature = "web")]
    {
        crate::simc_runner::set_simulation_concurrency_limit(storage.get_max_parallel_jobs());
        let externally_reachable = !is_loopback_bind(bind_host);
        let lan_pairing = externally_reachable && security.lan_pairing;
        if externally_reachable
            && !lan_pairing
            && !external_bind_allowed(std::env::var("ALLOW_EXTERNAL_BIND").ok().as_deref())
        {
            panic!(
                "external bind to {bind_host} is disabled; set ALLOW_EXTERNAL_BIND=true and configure a strong JWT_SECRET"
            );
        }

        let store_data = web::Data::new(storage);
        let simc_data = web::Data::new(simc_path);
        let simc_runtime_data = simc_runtime.map(web::Data::new);
        if auth_handlers::hosted_private_deployment() && docker_updates::is_configured() {
            docker_updates::spawn_scheduler(store_data.get_ref().clone());
        }
        let log_data = web::Data::new(Arc::new(LogBuffer::new()));
        #[cfg(feature = "desktop")]
        let stats_data = web::Data::new(Arc::new(Mutex::new(SystemStats::new())));
        let frontend = frontend_dir.clone();
        let data = data_dir.clone();
        let lan_device_store = lan_pairing
            .then(|| {
                data.as_ref()
                    .and_then(|data_dir| data_dir.parent())
                    .map(|app_data_dir| app_data_dir.join("lan_devices.json"))
            })
            .flatten();
        let lan_access = lan_pairing.then(|| {
            web::Data::new(Arc::new(lan_access::LanAccessState::with_device_store(
                lan_device_store.clone(),
            )))
        });

        let bind_addr = format!("{}:{}", bind_host, port);

        let blizzard_state = web::Data::new(Arc::new(blizzard::BlizzardState::new()));
        let integrations_state = web::Data::new(Arc::new(integrations::IntegrationState::new()));

        let bnet_redirect = format!("http://localhost:{}/api/auth/bnet/callback", port);
        let jwt_secret = auth_handlers::validate_jwt_secret(
            std::env::var("JWT_SECRET").ok(),
            externally_reachable && !lan_pairing,
        )
        .unwrap_or_else(|error| panic!("unsafe JWT configuration: {error}"));

        let credential_encryption_secret = std::env::var("SESSION_ENCRYPTION_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| jwt_secret.clone());
        let blizzard_credential_secrets =
            web::Data::new(auth_handlers::create_blizzard_credential_secret_store(
                store_data.get_ref().clone(),
                &credential_encryption_secret,
            ));

        println!("Blizzard OAuth callback is derived from the request IP and port");

        let auth_state = web::Data::new(Arc::new(auth_handlers::BlizzardAuthState::new(
            None,
            None,
            bnet_redirect,
            jwt_secret,
        )));

        helpers::recover_pending_jobs(
            store_data.get_ref().clone(),
            auth_state.get_ref().clone(),
            simc_data.get_ref().clone(),
            log_data.get_ref().clone(),
        );

        let sync_state = web::Data::new(Arc::new(data_sync::DataSyncState::new()));

        // For historical/trait reasons, we still provide a web::Data<Option<Arc<BlizzardAuthState>>>
        // to the proxy handlers so они can check for JWT sub.
        let auth_state_opt_data = web::Data::new(Some(auth_state.get_ref().clone()));
        let sync_state_for_background = sync_state.get_ref().clone();
        let auth_state_for_background = auth_state.get_ref().clone();
        let blizzard_state_for_background = blizzard_state.get_ref().clone();
        let store_for_background = store_data.get_ref().clone();
        let secrets_for_background = blizzard_credential_secrets.get_ref().clone();
        let data_dir_for_background = data.clone();
        let server = HttpServer::new(move || {
            let cors = Cors::default()
                .allowed_origin_fn(|origin, _req_head| {
                    let origin_str = origin.to_str().unwrap_or("");
                    origin_str == "http://localhost:3000"
                        || origin_str == "tauri://localhost"
                        || origin_str == "https://tauri.localhost"
                        || origin_str == "http://tauri.localhost"
                        || origin_str == "tauri.localhost"
                        || origin_str.starts_with("http://localhost:")
                        || origin_str.starts_with("https://localhost:")
                        || origin_str.starts_with("http://127.0.0.1:")
                        || origin_str.starts_with("https://127.0.0.1:")
                })
                .allow_any_method()
                .allow_any_header()
                .supports_credentials()
                .max_age(3600);

            let mut app = App::new()
                .app_data(web::JsonConfig::default().error_handler(|err, _req| {
                    let detail = err.to_string();
                    actix_web::error::InternalError::from_response(
                        err,
                        HttpResponse::BadRequest().json(serde_json::json!({ "detail": detail })),
                    )
                    .into()
                }))
                .wrap(cors)
                .wrap(middleware::from_fn(add_static_cache_headers))
                .wrap(middleware::from_fn(move |req, next| {
                    enforce_security(req, next, externally_reachable, lan_pairing)
                }))
                .app_data(store_data.clone())
                .app_data(simc_data.clone())
                .app_data(log_data.clone())
                .app_data(blizzard_state.clone())
                .app_data(integrations_state.clone())
                .app_data(blizzard_credential_secrets.clone())
                .app_data(auth_state.clone())
                .app_data(auth_state_opt_data.clone());

            if let Some(simc_runtime_data) = simc_runtime_data.clone() {
                app = app
                    .app_data(simc_runtime_data)
                    .route(
                        "/api/admin/simc-runtime",
                        web::get().to(auth_handlers::get_simc_runtime),
                    )
                    .route(
                        "/api/admin/simc-runtime",
                        web::post().to(auth_handlers::set_simc_runtime),
                    );
            }

            if let Some(lan_access) = lan_access.clone() {
                app = app
                    .app_data(lan_access)
                    .route(
                        "/api/lan/pairing",
                        web::post().to(lan_access::create_pairing),
                    )
                    .route("/api/lan/pair", web::get().to(lan_access::show_pairing))
                    .route(
                        "/api/lan/pair/consume",
                        web::get().to(lan_access::consume_pairing),
                    )
                    .route("/api/lan/presence", web::get().to(lan_access::presence))
                    .route(
                        "/api/lan/disconnect",
                        web::post().to(lan_access::disconnect),
                    )
                    .route("/api/lan/devices", web::get().to(lan_access::list_devices))
                    .route(
                        "/api/lan/devices/{id}",
                        web::patch().to(lan_access::rename_device),
                    )
                    .route(
                        "/api/lan/devices/{id}",
                        web::delete().to(lan_access::remove_device),
                    );
            }

            app = app
                .route(
                    "/api/auth/bnet/login",
                    web::get().to(auth_handlers::bnet_login),
                )
                .route(
                    "/api/auth/bnet/login-success",
                    web::get().to(auth_handlers::login_success),
                )
                .route("/api/auth/poll", web::get().to(auth_handlers::poll_login))
                .route(
                    "/api/auth/bnet/callback",
                    web::get().to(auth_handlers::bnet_callback),
                )
                .route(
                    "/api/auth/bnet/credentials-status",
                    web::get().to(auth_handlers::get_credentials_status),
                )
                .route(
                    "/api/auth/bnet/credential-profiles",
                    web::get().to(auth_handlers::list_blizzard_credential_profiles),
                )
                .route(
                    "/api/auth/bnet/credential-profiles",
                    web::post().to(auth_handlers::save_blizzard_credential_profile),
                )
                .route(
                    "/api/auth/bnet/credential-profiles/{id}",
                    web::patch().to(auth_handlers::rename_blizzard_credential_profile),
                )
                .route(
                    "/api/auth/bnet/credential-profiles/{id}",
                    web::delete().to(auth_handlers::delete_blizzard_credential_profile),
                )
                .route("/api/auth/me", web::get().to(auth_handlers::get_me))
                .route(
                    "/api/auth/logout",
                    web::post().to(auth_handlers::bnet_logout),
                )
                .route(
                    "/api/bnet/user/characters",
                    web::get().to(auth_handlers::get_characters),
                )
                .route(
                    "/api/user/config",
                    web::get().to(auth_handlers::get_user_configs),
                )
                .route(
                    "/api/user/config",
                    web::post().to(auth_handlers::set_user_config),
                )
                .route(
                    "/api/user/discord-webhook",
                    web::get().to(discord_webhook::get_settings),
                )
                .route(
                    "/api/user/discord-webhook",
                    web::post().to(discord_webhook::update_settings),
                )
                .route(
                    "/api/user/discord-webhook/test",
                    web::post().to(discord_webhook::send_test),
                )
                .route(
                    "/api/user/blizzard/clear",
                    web::post().to(auth_handlers::clear_user_configs),
                )
                .route(
                    "/api/system/blizzard/credentials",
                    web::post().to(auth_handlers::set_system_blizzard_creds),
                )
                .route(
                    "/api/user/blizzard/test",
                    web::post().to(auth_handlers::test_blizzard_creds),
                )
                .route(
                    "/api/integrations/settings",
                    web::get().to(integrations::get_settings),
                )
                .route(
                    "/api/integrations/settings",
                    web::post().to(integrations::update_settings),
                )
                .route(
                    "/api/integrations/warcraft-logs/credentials/test",
                    web::post().to(integrations::test_warcraft_logs_credentials),
                )
                .route(
                    "/api/integrations/warcraft-logs/credentials",
                    web::post().to(integrations::save_warcraft_logs_credentials),
                )
                .route(
                    "/api/integrations/warcraft-logs/credentials",
                    web::delete().to(integrations::remove_warcraft_logs_credentials),
                )
                .route(
                    "/api/admin/users",
                    web::get().to(auth_handlers::list_hosted_users),
                )
                .route(
                    "/api/admin/users",
                    web::post().to(auth_handlers::create_hosted_user),
                )
                .route(
                    "/api/admin/users/{id}",
                    web::patch().to(auth_handlers::update_hosted_user),
                )
                .route(
                    "/api/admin/integrations/warcraft-logs",
                    web::get().to(integrations::get_admin_warcraft_logs_credentials),
                )
                .route(
                    "/api/admin/integrations/warcraft-logs",
                    web::post().to(integrations::save_admin_warcraft_logs_credentials),
                )
                .route(
                    "/api/admin/integrations/warcraft-logs",
                    web::delete().to(integrations::remove_admin_warcraft_logs_credentials),
                )
                .route(
                    "/api/admin/docker-updates",
                    web::get().to(docker_updates::get_status),
                )
                .route(
                    "/api/admin/docker-updates",
                    web::post().to(docker_updates::update),
                )
                .route(
                    "/api/data/status",
                    web::get().to(data_sync::get_sync_status),
                )
                .route("/api/readiness", web::get().to(readiness))
                .route(
                    "/api/data/missives",
                    web::get().to(game_data_handlers::list_missive_options),
                )
                .route(
                    "/api/data/files",
                    web::get().to(data_sync::get_data_file_states),
                )
                .route(
                    "/api/data/files/open-directory",
                    web::post().to(data_sync::open_data_directory),
                )
                .route(
                    "/api/data/files/missing/download",
                    web::post().to(data_sync::download_missing_data_files),
                )
                .route(
                    "/api/data/files/{key}/download",
                    web::post().to(data_sync::download_data_file),
                )
                .route(
                    "/api/data/files/{key}/content",
                    web::get().to(data_sync::get_data_file_content),
                )
                .route(
                    "/api/data/wowhead-zones-index",
                    web::get().to(data_sync::get_wowhead_zones_index),
                )
                .route(
                    "/api/data/wowhead-zones-index/summary",
                    web::get().to(data_sync::get_wowhead_zones_index_summary),
                )
                .route(
                    "/api/data/wowhead-zones-index/match",
                    web::get().to(data_sync::get_wowhead_zone_match),
                )
                .route(
                    "/api/data/images/{type}/{id}",
                    web::get().to(data_sync::get_data_image),
                )
                .route("/api/data/sync", web::post().to(data_sync::trigger_sync))
                .route(
                    "/api/data/sync-dungeons",
                    web::post().to(data_sync::trigger_dungeon_sync),
                );

            #[cfg(feature = "desktop")]
            {
                app = app.app_data(stats_data.clone());
            }

            // Simulation routes
            app = app
                .route("/api/sim", web::post().to(sim_handlers::create_sim))
                .route(
                    "/api/top-gear/sim",
                    web::post().to(sim_handlers::create_top_gear_sim),
                )
                .route(
                    "/api/top-gear/combo-count",
                    web::post().to(sim_handlers::get_top_gear_combo_count),
                )
                .route(
                    "/api/droptimizer/sim",
                    web::post().to(sim_handlers::create_droptimizer_sim),
                )
                // Upgrade compare routes
                .route(
                    "/api/upgrade-compare/prepare",
                    web::post().to(upgrade_compare::get_upgrade_compare_prepare),
                )
                .route(
                    "/api/upgrade-compare/sim",
                    web::post().to(upgrade_compare::create_upgrade_compare_sim),
                )
                .route(
                    "/api/upgrade-compare/combo-count",
                    web::post().to(upgrade_compare::get_upgrade_compare_combo_count),
                )
                .route(
                    "/api/upgrade-options",
                    web::get().to(upgrade_compare::get_upgrade_options_handler),
                )
                // Job management routes
                .route("/api/sim/{id}", web::get().to(job_handlers::get_sim_status))
                .route(
                    "/api/sim/{id}/rerun",
                    web::post().to(job_handlers::rerun_sim),
                )
                .route(
                    "/api/sim/{id}/related",
                    web::get().to(job_handlers::list_related_sims),
                )
                .route(
                    "/api/sim/{id}/logs",
                    web::get().to(job_handlers::get_sim_logs),
                )
                .route(
                    "/api/sim/{id}/cancel",
                    web::post().to(job_handlers::cancel_sim),
                )
                .route(
                    "/api/sim/{id}/run-next",
                    web::post().to(job_handlers::run_next),
                )
                .route(
                    "/api/sim/{id}/pause",
                    web::post().to(job_handlers::pause_sim),
                )
                .route(
                    "/api/sim/{id}/resume",
                    web::post().to(job_handlers::resume_sim),
                )
                .route("/api/sim/{id}/link", web::post().to(job_handlers::link_sim))
                .route("/api/sim/{id}/pin", web::post().to(job_handlers::pin_sim))
                .route(
                    "/api/sim/{id}/input",
                    web::get().to(job_handlers::get_sim_input),
                )
                .route(
                    "/api/sim/{id}/raw",
                    web::get().to(job_handlers::get_sim_raw),
                )
                .route(
                    "/api/sim/{id}/html",
                    web::get().to(job_handlers::get_sim_html),
                )
                .route(
                    "/api/sim/{id}/output.txt",
                    web::get().to(job_handlers::get_sim_text_output),
                )
                .route(
                    "/api/sim/{id}/data.csv",
                    web::get().to(job_handlers::get_sim_csv),
                )
                .route("/api/sim/{id}", web::delete().to(job_handlers::delete_sim))
                .route(
                    "/api/history/stats",
                    web::get().to(job_handlers::get_history_stats),
                )
                .route(
                    "/api/history/characters",
                    web::get().to(job_handlers::get_history_characters),
                )
                .route(
                    "/api/history/clear",
                    web::post().to(job_handlers::clear_history),
                )
                // Blizzard proxy routes (only active if configured)
                .route(
                    "/api/blizzard/character/{realm}/{name}/profile",
                    web::get().to(blizzard::proxy_character_profile),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/equipment",
                    web::get().to(blizzard::proxy_character_equipment),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/statistics",
                    web::get().to(blizzard::proxy_character_statistics),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/specializations",
                    web::get().to(blizzard::proxy_character_specializations),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/media/{type}",
                    web::get().to(blizzard::proxy_character_media),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/professions",
                    web::get().to(blizzard::proxy_character_professions),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/mythic-keystone-profile",
                    web::get().to(blizzard::proxy_character_mythic_keystone_profile),
                )
                .route(
                    "/api/blizzard/character/{realm}/{name}/encounters/raids",
                    web::get().to(blizzard::proxy_character_raid_encounters),
                )
                .route(
                    "/api/integrations/raider-io/character/{region}/{realm}/{name}",
                    web::get().to(integrations::get_raider_io_character),
                )
                .route(
                    "/api/integrations/warcraft-logs/character/{region}/{realm}/{name}",
                    web::get().to(integrations::get_warcraft_logs_character),
                )
                .route(
                    "/api/blizzard/mythic-keystone/dungeon/index",
                    web::get().to(blizzard::proxy_mythic_keystone_dungeon_index),
                )
                .route(
                    "/api/blizzard/mythic-keystone/dungeon/{dungeon_id}",
                    web::get().to(blizzard::proxy_mythic_keystone_dungeon_detail),
                )
                .route(
                    "/api/blizzard/realms",
                    web::get().to(blizzard::proxy_realms_index),
                )
                // Game data routes
                .route(
                    "/api/item-info/{id}",
                    web::get().to(game_data_handlers::get_item_info),
                )
                .route(
                    "/api/item-info/batch",
                    web::post().to(game_data_handlers::get_item_info_batch),
                )
                .route(
                    "/api/enchant-info/{id}",
                    web::get().to(game_data_handlers::get_enchant_info),
                )
                .route(
                    "/api/gem-info/{id}",
                    web::get().to(game_data_handlers::get_gem_info),
                )
                .route(
                    "/api/max-upgrade-ilevels",
                    web::post().to(game_data_handlers::get_max_upgrade_ilevels),
                )
                .route(
                    "/api/gear/enchant-options",
                    web::get().to(game_data_handlers::list_enchant_options),
                )
                .route(
                    "/api/gear/gem-options",
                    web::get().to(game_data_handlers::list_gem_options),
                )
                .route(
                    "/api/gear/embellishment-options",
                    web::get().to(game_data_handlers::list_embellishment_options),
                )
                .route(
                    "/api/gear/consumable-options",
                    web::get().to(game_data_handlers::list_consumable_options),
                )
                .route(
                    "/api/data/missives",
                    web::get().to(game_data_handlers::list_missive_options),
                )
                .route(
                    "/api/upgrade-tracks",
                    web::get().to(game_data_handlers::list_upgrade_tracks),
                )
                .route(
                    "/api/gear/resolve",
                    web::post().to(game_data_handlers::resolve_gear),
                )
                .route(
                    "/api/gear/catalyst-convert",
                    web::post().to(game_data_handlers::catalyst_convert),
                )
                .route(
                    "/api/season-config",
                    web::get().to(game_data_handlers::get_season_config),
                )
                .route(
                    "/api/game-context",
                    web::get().to(game_data_handlers::get_game_context),
                )
                // Saved dungeon routes
                .route("/api/routes", web::post().to(route_handlers::save_route))
                .route("/api/routes", web::get().to(route_handlers::list_routes))
                .route(
                    "/api/routes/{id}",
                    web::delete().to(route_handlers::delete_route),
                )
                // Character profiles
                .route(
                    "/api/character-profiles",
                    web::post().to(character_profile_handlers::save_character_profile),
                )
                .route(
                    "/api/character-profiles",
                    web::get().to(character_profile_handlers::list_character_profiles),
                )
                .route(
                    "/api/character-profiles/{id}",
                    web::delete().to(character_profile_handlers::delete_character_profile),
                )
                .route(
                    "/api/instances",
                    web::get().to(game_data_handlers::list_instances),
                )
                .route(
                    "/api/instances/type/{type}/drops",
                    web::get().to(game_data_handlers::get_drops_by_type),
                )
                .route(
                    "/api/instances/drops",
                    web::get().to(game_data_handlers::get_multi_instance_drops),
                )
                .route(
                    "/api/instances/{id}/drops",
                    web::get().to(game_data_handlers::get_instance_drops),
                )
                .route(
                    "/api/talent-tree/{specId}",
                    web::get().to(game_data_handlers::get_talent_tree),
                )
                .route("/api/sims", web::get().to(job_handlers::list_sims))
                .route("/api/queue", web::get().to(job_handlers::get_queue))
                .route(
                    "/api/queue/reorder",
                    web::post().to(job_handlers::reorder_queue),
                )
                .route("/api/config", web::get().to(get_config))
                .route("/api/config", web::post().to(update_config))
                .route(
                    "/api/dungeons",
                    web::get().to(game_data_handlers::get_dungeon_data),
                )
                .route(
                    "/api/game-data/state",
                    web::get().to(data_provider::get_game_data_state),
                )
                .route("/health", web::get().to(health_check));

            #[cfg(feature = "desktop")]
            {
                app = app.route("/api/system-stats", web::get().to(system_stats));
            }

            let data_dir_inner = data.clone();
            app = app.app_data(web::Data::new(data_dir_inner));
            app = app.app_data(sync_state.clone());

            // Serve cached assets from data directory
            if let Some(ref dir) = data {
                let images_dir = dir.join("instance-images");
                if images_dir.exists() {
                    app = app.service(
                        actix_files::Files::new("/api/data/instance-images", images_dir)
                            .prefer_utf8(true),
                    );
                }
                let static_dir = dir.join("static");
                if static_dir.exists() {
                    app = app.service(
                        actix_files::Files::new("/api/data/static", static_dir).prefer_utf8(true),
                    );
                }
            }

            // Serve static frontend files in production (not in dev mode)
            if let Some(ref dir) = frontend {
                app = app
                    .app_data(web::Data::new(FrontendDir(dir.clone())))
                    .service(actix_files::Files::new("/_next", dir.join("_next")).prefer_utf8(true))
                    .default_service(web::get().to(spa_fallback));
            }

            app
        })
        .bind(&bind_addr)
        .unwrap_or_else(|_| panic!("Failed to bind to {}", bind_addr))
        .run();

        data_sync::spawn_background_sync_loop(
            sync_state_for_background,
            auth_state_for_background,
            blizzard_state_for_background,
            store_for_background,
            secrets_for_background,
            data_dir_for_background,
        );

        println!("HTTP server starting on port {}", port);
        (server, port)
    }
    #[cfg(not(feature = "web"))]
    {
        panic!("HTTP server disabled (web feature not active)");
    }
}
