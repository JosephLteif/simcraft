use crate::server::auth_handlers::{
    self, BlizzardAuthState, BlizzardCredentialSecretStore, Claims,
};
use crate::storage::JobStorage;
use actix_web::{web, HttpRequest, HttpResponse};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const CACHE_TTL_SECONDS: u64 = 15 * 60;
const RAIDER_IO_PROFILE_URL: &str = "https://raider.io/api/v1/characters/profile";
const WARCRAFT_LOGS_TOKEN_URL: &str = "https://www.warcraftlogs.com/oauth/token";
const WARCRAFT_LOGS_GRAPHQL_URL: &str = "https://www.warcraftlogs.com/api/v2/client";
const RAIDER_IO_ENABLED_KEY: &str = "integration_raider_io_enabled";
const WARCRAFT_LOGS_ENABLED_KEY: &str = "integration_warcraft_logs_enabled";
const WARCRAFT_LOGS_CLIENT_ID_KEY: &str = "warcraft_logs_client_id";
const WARCRAFT_LOGS_SHARED_CLIENT_ID_KEY: &str = "warcraft_logs_shared_client_id";
const WARCRAFT_LOGS_USER_SECRET_PREFIX: &str = "warcraft_logs:user:";
const WARCRAFT_LOGS_SHARED_SECRET_ID: &str = "warcraft_logs:shared";

#[derive(Clone)]
pub struct IntegrationState {
    pub client: Client,
    environment_client_id: Option<String>,
    environment_client_secret: Option<String>,
    wcl_tokens: Arc<Mutex<HashMap<String, CachedWclToken>>>,
}

#[derive(Clone)]
struct CachedWclToken {
    access_token: String,
    expires_at: u64,
}

impl IntegrationState {
    pub fn new() -> Self {
        Self::with_environment_credentials(
            std::env::var("WARCRAFT_LOGS_CLIENT_ID").ok(),
            std::env::var("WARCRAFT_LOGS_CLIENT_SECRET").ok(),
        )
    }

    fn with_environment_credentials(
        client_id: Option<String>,
        client_secret: Option<String>,
    ) -> Self {
        let client_id = non_empty(client_id);
        let client_secret = non_empty(client_secret);
        let (environment_client_id, environment_client_secret) =
            if client_id.is_some() && client_secret.is_some() {
                (client_id, client_secret)
            } else {
                (None, None)
            };

        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap_or_else(|_| Client::new()),
            environment_client_id,
            environment_client_secret,
            wcl_tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn test_wcl_credentials(
        &self,
        client_id: &str,
        client_secret: &str,
    ) -> Result<(), WclError> {
        self.wcl_access_token(client_id, client_secret, true)
            .await
            .map(|_| ())
    }

    async fn wcl_access_token(
        &self,
        client_id: &str,
        client_secret: &str,
        force_refresh: bool,
    ) -> Result<String, WclError> {
        let now = now_unix_secs();
        if !force_refresh {
            if let Some(token) = self
                .wcl_tokens
                .lock()
                .ok()
                .and_then(|tokens| tokens.get(client_id).cloned())
                .filter(|token| token.expires_at > now.saturating_add(60))
            {
                return Ok(token.access_token);
            }
        }

        let response = self
            .client
            .post(WARCRAFT_LOGS_TOKEN_URL)
            .basic_auth(client_id, Some(client_secret))
            .form(&[("grant_type", "client_credentials")])
            .send()
            .await
            .map_err(|_| WclError::Upstream)?;

        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            return Err(WclError::RateLimited);
        }
        if response.status() == StatusCode::UNAUTHORIZED
            || response.status() == StatusCode::FORBIDDEN
        {
            return Err(WclError::InvalidCredentials);
        }
        if !response.status().is_success() {
            return Err(WclError::Upstream);
        }

        let token: WclTokenResponse = response.json().await.map_err(|_| WclError::Upstream)?;
        if token.access_token.trim().is_empty() {
            return Err(WclError::Upstream);
        }

        let expires_at = now.saturating_add(token.expires_in.unwrap_or(3600).max(60));
        if let Ok(mut tokens) = self.wcl_tokens.lock() {
            tokens.insert(
                client_id.to_string(),
                CachedWclToken {
                    access_token: token.access_token.clone(),
                    expires_at,
                },
            );
        }
        Ok(token.access_token)
    }

    fn invalidate_wcl_token(&self, client_id: &str) {
        if let Ok(mut tokens) = self.wcl_tokens.lock() {
            tokens.remove(client_id);
        }
    }
}

impl Default for IntegrationState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IntegrationEnvelope<T> {
    pub status: String,
    pub data: Option<T>,
    pub fetched_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RaiderIoData {
    pub profile_url: String,
    pub name: String,
    pub realm: String,
    pub region: String,
    pub score: Option<f64>,
    pub ranks: Option<RaiderIoRanks>,
    pub best_runs: Vec<RaiderIoRun>,
    pub raid_progression: Vec<RaiderIoRaidProgression>,
    #[serde(default)]
    pub raid_achievements: Vec<RaiderIoRaidAchievement>,
    #[serde(default)]
    pub last_crawled_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RaiderIoRanks {
    pub world: Option<f64>,
    pub region: Option<f64>,
    pub realm: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RaiderIoRun {
    pub dungeon: String,
    pub level: Option<f64>,
    pub score: Option<f64>,
    pub completed_at: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RaiderIoRaidProgression {
    pub raid: String,
    pub summary: Option<String>,
    pub killed: Option<f64>,
    pub total: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RaiderIoRaidAchievement {
    pub raid: String,
    pub ahead_of_the_curve_at: Option<String>,
    pub cutting_edge_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WarcraftLogsData {
    pub profile_url: String,
    pub name: String,
    pub realm: String,
    pub region: String,
    pub reports: Vec<WarcraftLogsReport>,
    pub ranking: Option<WarcraftLogsRanking>,
    pub boss_rankings: Vec<WarcraftLogsBossRanking>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WarcraftLogsReport {
    pub code: String,
    pub title: Option<String>,
    pub zone_name: Option<String>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WarcraftLogsRanking {
    pub zone_id: Option<f64>,
    pub zone_name: Option<String>,
    pub metric: Option<String>,
    pub best_performance_average: Option<f64>,
    pub median_performance_average: Option<f64>,
    pub all_stars: Option<f64>,
    pub average_item_level: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WarcraftLogsBossRanking {
    pub encounter_id: Option<f64>,
    pub encounter_name: String,
    pub rank_percent: Option<f64>,
    pub median_percent: Option<f64>,
    pub total_kills: Option<f64>,
    pub best_amount: Option<f64>,
    pub metric: Option<String>,
    pub spec: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WarcraftLogsSettings {
    pub user_configured: bool,
    pub user_client_id: Option<String>,
    pub effective_source: Option<String>,
    pub environment_configured: bool,
    pub admin_configured: bool,
}

#[derive(Debug, Serialize)]
pub struct IntegrationSettingsResponse {
    pub raider_io_enabled: bool,
    pub warcraft_logs_enabled: bool,
    pub warcraft_logs: WarcraftLogsSettings,
}

#[derive(Debug, Deserialize)]
pub struct IntegrationSettingsUpdate {
    pub provider: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct WarcraftLogsCredentialsRequest {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Deserialize)]
pub struct CharacterIntegrationQuery {
    pub refresh: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CharacterIntegrationPath {
    pub region: String,
    pub realm: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy)]
enum WclError {
    InvalidCredentials,
    RateLimited,
    Upstream,
}

impl WclError {
    fn code(self) -> &'static str {
        match self {
            Self::InvalidCredentials => "invalid_credentials",
            Self::RateLimited => "rate_limited",
            Self::Upstream => "upstream",
        }
    }
}

#[derive(Debug, Deserialize)]
struct WclTokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
}

#[derive(Debug, Clone)]
struct EffectiveWclCredentials {
    client_id: String,
    client_secret: String,
    source: &'static str,
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

fn normalize_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut needs_separator = false;
    for character in value.trim().chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            if needs_separator && !slug.is_empty() {
                slug.push('-');
            }
            slug.push(character);
            needs_separator = false;
        } else if character == ' ' || character == '_' || character == '-' {
            needs_separator = true;
        }
    }
    slug.trim_matches('-').to_string()
}

fn normalize_region(value: &str) -> Option<String> {
    let region = value.trim().to_ascii_lowercase();
    matches!(region.as_str(), "us" | "eu" | "kr" | "tw" | "cn").then_some(region)
}

fn integration_cache_key(provider: &str, region: &str, realm: &str, name: &str) -> String {
    format!("integration:{provider}:character:{region}:{realm}:{name}")
}

fn envelope<T>(
    status: &str,
    data: Option<T>,
    fetched_at: Option<u64>,
    error_code: Option<&str>,
) -> IntegrationEnvelope<T> {
    IntegrationEnvelope {
        status: status.to_string(),
        data,
        fetched_at,
        error_code: error_code.map(str::to_string),
    }
}

fn json_response<T: Serialize>(value: &IntegrationEnvelope<T>) -> HttpResponse {
    HttpResponse::Ok().json(value)
}

fn cached_envelope<T: for<'de> Deserialize<'de>>(
    store: &dyn JobStorage,
    key: &str,
) -> Option<IntegrationEnvelope<T>> {
    let raw = store.get_cache(key)?;
    let value = serde_json::from_str::<IntegrationEnvelope<T>>(&raw).ok()?;
    let fetched_at = value.fetched_at?;
    (now_unix_secs().saturating_sub(fetched_at) < CACHE_TTL_SECONDS).then_some(value)
}

fn cache_envelope<T: Serialize>(store: &dyn JobStorage, key: &str, value: &IntegrationEnvelope<T>) {
    if value.status != "ok" {
        return;
    }
    if let Ok(serialized) = serde_json::to_string(value) {
        store.set_cache(key, serialized);
    }
}

fn require_session(
    req: &HttpRequest,
    state: &BlizzardAuthState,
    store: &dyn JobStorage,
) -> Result<Claims, HttpResponse> {
    auth_handlers::verify_active_session(req, state, store)
        .ok_or_else(|| HttpResponse::Unauthorized().json(json!({"error": "Not logged in"})))
}

fn user_secret_id(user_id: &str) -> String {
    format!("{WARCRAFT_LOGS_USER_SECRET_PREFIX}{user_id}")
}

fn read_admin_credentials(
    store: &dyn JobStorage,
    secrets: &dyn BlizzardCredentialSecretStore,
) -> Option<(String, String)> {
    let client_id = non_empty(store.get_user_config("system", WARCRAFT_LOGS_SHARED_CLIENT_ID_KEY))?;
    let client_secret = secrets
        .get_secret(WARCRAFT_LOGS_SHARED_SECRET_ID)
        .ok()
        .flatten()
        .and_then(|secret| non_empty(Some(secret)))?;
    Some((client_id, client_secret))
}

fn read_user_credentials(
    user_id: &str,
    store: &dyn JobStorage,
    secrets: &dyn BlizzardCredentialSecretStore,
) -> (Option<String>, Option<(String, String)>) {
    let client_id = non_empty(store.get_user_config(user_id, WARCRAFT_LOGS_CLIENT_ID_KEY));
    let secret = secrets
        .get_secret(&user_secret_id(user_id))
        .ok()
        .flatten()
        .and_then(|secret| non_empty(Some(secret)));
    let credentials = client_id.clone().zip(secret);
    (client_id, credentials)
}

fn effective_wcl_credentials(
    user_id: &str,
    state: &IntegrationState,
    store: &dyn JobStorage,
    secrets: &dyn BlizzardCredentialSecretStore,
) -> (Option<EffectiveWclCredentials>, Option<String>, bool, bool) {
    let (user_client_id, user_credentials) = read_user_credentials(user_id, store, secrets);
    let environment_credentials = state
        .environment_client_id
        .clone()
        .zip(state.environment_client_secret.clone());
    let admin_credentials = read_admin_credentials(store, secrets);
    let admin_configured = admin_credentials.is_some();
    let effective = user_credentials
        .map(|(client_id, client_secret)| EffectiveWclCredentials {
            client_id,
            client_secret,
            source: "user",
        })
        .or_else(|| {
            environment_credentials.map(|(client_id, client_secret)| EffectiveWclCredentials {
                client_id,
                client_secret,
                source: "environment",
            })
        })
        .or_else(|| {
            admin_credentials.map(|(client_id, client_secret)| EffectiveWclCredentials {
                client_id,
                client_secret,
                source: "admin",
            })
        });
    (
        effective,
        user_client_id,
        state.environment_client_id.is_some() && state.environment_client_secret.is_some(),
        admin_configured,
    )
}

fn is_enabled(store: &dyn JobStorage, user_id: &str, key: &str, default: bool) -> bool {
    store
        .get_user_config(user_id, key)
        .map(|value| value.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(default)
}

fn settings_snapshot(
    user_id: &str,
    state: &IntegrationState,
    store: &dyn JobStorage,
    secrets: &dyn BlizzardCredentialSecretStore,
) -> IntegrationSettingsResponse {
    let (effective, user_client_id, environment_configured, admin_configured) =
        effective_wcl_credentials(user_id, state, store, secrets);
    let wcl_default_enabled = effective.is_some();
    let wcl_enabled = is_enabled(
        store,
        user_id,
        WARCRAFT_LOGS_ENABLED_KEY,
        wcl_default_enabled,
    );
    IntegrationSettingsResponse {
        raider_io_enabled: is_enabled(store, user_id, RAIDER_IO_ENABLED_KEY, true),
        warcraft_logs_enabled: wcl_enabled,
        warcraft_logs: WarcraftLogsSettings {
            user_configured: read_user_credentials(user_id, store, secrets).1.is_some(),
            user_client_id,
            effective_source: effective.map(|credentials| credentials.source.to_string()),
            environment_configured,
            admin_configured,
        },
    }
}

pub async fn get_settings(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    integrations: web::Data<Arc<IntegrationState>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
) -> HttpResponse {
    let claims = match require_session(&req, state.get_ref(), &***store) {
        Ok(claims) => claims,
        Err(response) => return response,
    };
    HttpResponse::Ok().json(settings_snapshot(
        &claims.sub,
        integrations.get_ref(),
        &***store,
        &***secrets,
    ))
}

pub async fn update_settings(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    integrations: web::Data<Arc<IntegrationState>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
    body: web::Json<IntegrationSettingsUpdate>,
) -> HttpResponse {
    let claims = match require_session(&req, state.get_ref(), &***store) {
        Ok(claims) => claims,
        Err(response) => return response,
    };
    let key = match body.provider.trim().to_ascii_lowercase().as_str() {
        "raider_io" | "raider.io" => RAIDER_IO_ENABLED_KEY,
        "warcraft_logs" | "warcraft-logs" | "warcraft.logs" => WARCRAFT_LOGS_ENABLED_KEY,
        _ => return HttpResponse::BadRequest().json(json!({"error": "Unknown integration"})),
    };
    store.set_user_config(
        &claims.sub,
        key,
        if body.enabled { "true" } else { "false" },
    );
    HttpResponse::Ok().json(settings_snapshot(
        &claims.sub,
        integrations.get_ref(),
        &***store,
        &***secrets,
    ))
}

fn character_identity(
    path: &CharacterIntegrationPath,
) -> Result<(String, String, String), HttpResponse> {
    let region = normalize_region(&path.region)
        .ok_or_else(|| HttpResponse::BadRequest().json(json!({"error": "Invalid region"})))?;
    let realm = normalize_slug(&path.realm);
    let name = normalize_slug(&path.name);
    if realm.is_empty() || name.is_empty() {
        return Err(HttpResponse::BadRequest().json(json!({"error": "Invalid character"})));
    }
    Ok((region, realm, name))
}

fn raider_io_fields() -> String {
    let mut raid_slugs = crate::game_data::get_instances()
        .into_iter()
        .filter(|instance| {
            instance.get("type").and_then(Value::as_str) == Some("raid")
                && instance.get("current_season").and_then(Value::as_bool) == Some(true)
        })
        .filter_map(|instance| {
            instance
                .get("slug")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    raid_slugs.sort_unstable();
    raid_slugs.dedup();

    let mut fields = String::from(
        "mythic_plus_scores_by_season:current,mythic_plus_ranks,mythic_plus_best_runs,raid_progression",
    );
    if !raid_slugs.is_empty() {
        fields.push_str(",raid_achievement_curve:");
        fields.push_str(&raid_slugs.join(":"));
    }
    fields
}

pub async fn get_raider_io_character(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    integrations: web::Data<Arc<IntegrationState>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
    path: web::Path<CharacterIntegrationPath>,
    query: web::Query<CharacterIntegrationQuery>,
) -> HttpResponse {
    let claims = match require_session(&req, state.get_ref(), &***store) {
        Ok(claims) => claims,
        Err(response) => return response,
    };
    let (region, realm, name) = match character_identity(&path) {
        Ok(identity) => identity,
        Err(response) => return response,
    };
    let settings = settings_snapshot(&claims.sub, integrations.get_ref(), &***store, &***secrets);
    if !settings.raider_io_enabled {
        return json_response(&envelope(
            "unavailable",
            None::<RaiderIoData>,
            None,
            Some("disabled"),
        ));
    }

    let cache_key = integration_cache_key("raider-io", &region, &realm, &name);
    if query.refresh != Some(true) {
        if let Some(cached) = cached_envelope::<RaiderIoData>(&***store, &cache_key) {
            return json_response(&cached);
        }
    }

    let fields = raider_io_fields();
    let response = integrations
        .client
        .get(RAIDER_IO_PROFILE_URL)
        .query(&[
            ("region", region.as_str()),
            ("realm", realm.as_str()),
            ("name", name.as_str()),
            ("fields", fields.as_str()),
        ])
        .send()
        .await;

    let fetched_at = now_unix_secs();
    let result = match response {
        Ok(response) if response.status() == StatusCode::NOT_FOUND => {
            envelope("not_found", None, Some(fetched_at), Some("not_found"))
        }
        Ok(response) if response.status() == StatusCode::TOO_MANY_REQUESTS => {
            envelope("unavailable", None, Some(fetched_at), Some("rate_limited"))
        }
        Ok(response) if response.status().is_success() => match response.json::<Value>().await {
            Ok(value) => match normalize_raider_io(&value, &region, &realm, &name) {
                Some(data) => envelope("ok", Some(data), Some(fetched_at), None),
                None => envelope("unavailable", None, Some(fetched_at), Some("upstream")),
            },
            Err(_) => envelope("unavailable", None, Some(fetched_at), Some("upstream")),
        },
        Ok(_) | Err(_) => envelope("unavailable", None, Some(fetched_at), Some("upstream")),
    };
    cache_envelope(&***store, &cache_key, &result);
    json_response(&result)
}

pub async fn get_warcraft_logs_character(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    integrations: web::Data<Arc<IntegrationState>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
    path: web::Path<CharacterIntegrationPath>,
    query: web::Query<CharacterIntegrationQuery>,
) -> HttpResponse {
    let claims = match require_session(&req, state.get_ref(), &***store) {
        Ok(claims) => claims,
        Err(response) => return response,
    };
    let (region, realm, name) = match character_identity(&path) {
        Ok(identity) => identity,
        Err(response) => return response,
    };
    let settings = settings_snapshot(&claims.sub, integrations.get_ref(), &***store, &***secrets);
    if !settings.warcraft_logs_enabled {
        return json_response(&envelope(
            "unavailable",
            None::<WarcraftLogsData>,
            None,
            Some("disabled"),
        ));
    }
    let Some(credentials) =
        effective_wcl_credentials(&claims.sub, integrations.get_ref(), &***store, &***secrets).0
    else {
        return json_response(&envelope(
            "unavailable",
            None::<WarcraftLogsData>,
            None,
            Some("not_configured"),
        ));
    };

    let cache_key = integration_cache_key("warcraft-logs", &region, &realm, &name);
    if query.refresh != Some(true) {
        if let Some(cached) = cached_envelope::<WarcraftLogsData>(&***store, &cache_key) {
            return json_response(&cached);
        }
    }

    let result = match integrations
        .fetch_wcl_character(&credentials, &region, &realm, &name)
        .await
    {
        Ok(Some(data)) => envelope("ok", Some(data), Some(now_unix_secs()), None),
        Ok(None) => envelope("not_found", None, Some(now_unix_secs()), Some("not_found")),
        Err(error) => envelope(
            "unavailable",
            None,
            Some(now_unix_secs()),
            Some(error.code()),
        ),
    };
    cache_envelope(&***store, &cache_key, &result);
    json_response(&result)
}

impl IntegrationState {
    async fn fetch_wcl_character(
        &self,
        credentials: &EffectiveWclCredentials,
        region: &str,
        realm: &str,
        name: &str,
    ) -> Result<Option<WarcraftLogsData>, WclError> {
        const QUERY: &str = r#"
          query CharacterIntegration($name: String!, $serverSlug: String!, $serverRegion: String!) {
            characterData {
              character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
                name
                recentReports(limit: 5) {
                  data {
                    code
                    title
                    startTime
                    endTime
                    visibility
                    zone { id name }
                  }
                }
                zoneRankings
              }
            }
          }
        "#;
        let variables = json!({
            "name": name,
            "serverSlug": realm,
            "serverRegion": region.to_ascii_uppercase(),
        });

        let mut force_token_refresh = false;
        for attempt in 0..2 {
            let token = self
                .wcl_access_token(
                    &credentials.client_id,
                    &credentials.client_secret,
                    force_token_refresh,
                )
                .await?;
            let response = self
                .client
                .post(WARCRAFT_LOGS_GRAPHQL_URL)
                .bearer_auth(token)
                .json(&json!({"query": QUERY, "variables": variables}))
                .send()
                .await
                .map_err(|_| WclError::Upstream)?;

            if response.status() == StatusCode::UNAUTHORIZED && attempt == 0 {
                self.invalidate_wcl_token(&credentials.client_id);
                force_token_refresh = true;
                continue;
            }
            if response.status() == StatusCode::TOO_MANY_REQUESTS {
                return Err(WclError::RateLimited);
            }
            if response.status() == StatusCode::UNAUTHORIZED
                || response.status() == StatusCode::FORBIDDEN
            {
                return Err(WclError::InvalidCredentials);
            }
            if !response.status().is_success() {
                return Err(WclError::Upstream);
            }

            let payload: Value = response.json().await.map_err(|_| WclError::Upstream)?;
            if let Some(character) = payload
                .pointer("/data/characterData/character")
                .filter(|value| !value.is_null())
            {
                return normalize_warcraft_logs(character, region, realm, name)
                    .map(Some)
                    .ok_or(WclError::Upstream);
            }
            if payload
                .get("errors")
                .and_then(Value::as_array)
                .is_some_and(|errors| !errors.is_empty())
            {
                return Err(WclError::Upstream);
            }
            return Ok(None);
        }
        Err(WclError::Upstream)
    }
}

fn value_number(value: Option<&Value>) -> Option<f64> {
    value.and_then(|value| match value {
        Value::Number(number) => number.as_f64(),
        Value::String(string) => string.parse::<f64>().ok(),
        Value::Object(object) => value_number(
            object
                .get("value")
                .or_else(|| object.get("points"))
                .or_else(|| object.get("score")),
        ),
        Value::Array(values) => values
            .iter()
            .filter_map(|value| value_number(Some(value)))
            .max_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal)),
        _ => None,
    })
}

fn value_string(value: Option<&Value>) -> Option<String> {
    value.and_then(|value| match value {
        Value::String(string) if !string.trim().is_empty() => Some(string.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}

fn raid_kills(progression: &Value) -> Option<f64> {
    value_number(progression.get("bosses_killed"))
        .or_else(|| value_number(progression.get("killed")))
        .or_else(|| {
            [
                "normal_bosses_killed",
                "heroic_bosses_killed",
                "mythic_bosses_killed",
            ]
            .iter()
            .filter_map(|key| value_number(progression.get(*key)))
            .max_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal))
        })
}

fn current_score(payload: &Value) -> Option<f64> {
    if let Some(score) = value_number(payload.get("mythic_plus_score")) {
        return Some(score);
    }
    let scores = payload.get("mythic_plus_scores_by_season")?;
    match scores {
        Value::Array(entries) => entries.first().and_then(|entry| {
            value_number(entry.get("scores").and_then(|scores| {
                scores
                    .get("all")
                    .or_else(|| scores.get("overall"))
                    .or_else(|| scores.get("score"))
            }))
        }),
        Value::Object(_) => value_number(
            scores
                .get("all")
                .or_else(|| scores.get("overall"))
                .or_else(|| scores.get("score")),
        ),
        _ => None,
    }
}

fn current_ranks(payload: &Value) -> Option<RaiderIoRanks> {
    let overall = payload.get("mythic_plus_ranks")?.get("overall")?;
    let ranks = RaiderIoRanks {
        world: value_number(overall.get("world")).filter(|rank| *rank > 0.0),
        region: value_number(overall.get("region")).filter(|rank| *rank > 0.0),
        realm: value_number(overall.get("realm")).filter(|rank| *rank > 0.0),
    };
    (ranks.world.is_some() || ranks.region.is_some() || ranks.realm.is_some()).then_some(ranks)
}

fn normalize_raider_io(
    payload: &Value,
    region: &str,
    realm: &str,
    name: &str,
) -> Option<RaiderIoData> {
    let profile = payload.as_object()?;
    let display_name = value_string(profile.get("name")).unwrap_or_else(|| name.to_string());
    let display_realm = value_string(profile.get("realm").and_then(|value| {
        value
            .get("name")
            .or_else(|| value.get("slug"))
            .or(Some(value))
    }))
    .unwrap_or_else(|| realm.to_string());

    let best_runs = profile
        .get("mythic_plus_best_runs")
        .and_then(Value::as_array)
        .map(|runs| {
            runs.iter()
                .take(3)
                .filter_map(|run| {
                    let dungeon = value_string(run.get("dungeon").and_then(|dungeon| {
                        dungeon
                            .get("name")
                            .or_else(|| dungeon.get("short_name"))
                            .or(Some(dungeon))
                    }))?;
                    Some(RaiderIoRun {
                        dungeon,
                        level: value_number(
                            run.get("mythic_level")
                                .or_else(|| run.get("keystone_level"))
                                .or_else(|| run.get("level")),
                        ),
                        score: value_number(run.get("score")),
                        completed_at: value_string(
                            run.get("completed_at").or_else(|| run.get("completedAt")),
                        ),
                        url: value_string(run.get("url"))
                            .filter(|url| url.starts_with("https://raider.io/")),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let raid_progression = match profile.get("raid_progression") {
        Some(Value::Object(raids)) => raids
            .iter()
            .filter_map(|(raid, progression)| {
                let progression_object = progression.as_object()?;
                Some(RaiderIoRaidProgression {
                    raid: value_string(progression_object.get("name"))
                        .unwrap_or_else(|| raid.replace('-', " ")),
                    summary: value_string(progression_object.get("summary")),
                    killed: raid_kills(progression),
                    total: value_number(
                        progression_object
                            .get("total_bosses")
                            .or_else(|| progression_object.get("total")),
                    ),
                })
            })
            .collect(),
        Some(Value::Array(raids)) => raids
            .iter()
            .filter_map(|progression| {
                let progression_object = progression.as_object()?;
                Some(RaiderIoRaidProgression {
                    raid: value_string(
                        progression_object
                            .get("name")
                            .or_else(|| progression_object.get("raid")),
                    )?,
                    summary: value_string(progression_object.get("summary")),
                    killed: raid_kills(progression),
                    total: value_number(
                        progression_object
                            .get("total_bosses")
                            .or_else(|| progression_object.get("total")),
                    ),
                })
            })
            .collect(),
        _ => Vec::new(),
    };

    let raid_achievements = profile
        .get("raid_achievement_curve")
        .and_then(Value::as_array)
        .map(|achievements| {
            achievements
                .iter()
                .filter_map(|achievement| {
                    let achievement = achievement.as_object()?;
                    let raid =
                        value_string(achievement.get("raid").or_else(|| achievement.get("name")))?;
                    let ahead_of_the_curve_at = value_string(
                        achievement
                            .get("aotc")
                            .or_else(|| achievement.get("ahead_of_the_curve")),
                    );
                    let cutting_edge_at = value_string(
                        achievement
                            .get("cutting_edge")
                            .or_else(|| achievement.get("cutting_edge_at")),
                    );
                    (ahead_of_the_curve_at.is_some() || cutting_edge_at.is_some()).then_some(
                        RaiderIoRaidAchievement {
                            raid,
                            ahead_of_the_curve_at,
                            cutting_edge_at,
                        },
                    )
                })
                .collect()
        })
        .unwrap_or_default();

    Some(RaiderIoData {
        profile_url: value_string(profile.get("profile_url"))
            .filter(|url| url.starts_with("https://raider.io/characters/"))
            .unwrap_or_else(|| format!("https://raider.io/characters/{region}/{realm}/{name}")),
        name: display_name,
        realm: display_realm,
        region: region.to_string(),
        score: current_score(payload),
        ranks: current_ranks(payload),
        best_runs,
        raid_progression,
        raid_achievements,
        last_crawled_at: value_string(
            profile
                .get("last_crawled_at")
                .or_else(|| profile.get("lastCrawledAt")),
        ),
    })
}

fn normalize_warcraft_logs(
    character: &Value,
    region: &str,
    realm: &str,
    name: &str,
) -> Option<WarcraftLogsData> {
    let character_object = character.as_object()?;
    let display_name =
        value_string(character_object.get("name")).unwrap_or_else(|| name.to_string());
    let reports_value = character_object.get("recentReports");
    let reports = reports_value
        .and_then(|value| value.get("data").or(Some(value)))
        .and_then(Value::as_array)
        .map(|reports| {
            let mut reports = reports
                .iter()
                .filter(|report| {
                    value_string(report.get("visibility"))
                        .is_none_or(|visibility| visibility.eq_ignore_ascii_case("public"))
                })
                .filter_map(|report| {
                    let code = value_string(report.get("code"))?;
                    let zone = report.get("zone");
                    Some(WarcraftLogsReport {
                        url: format!("https://www.warcraftlogs.com/reports/{code}"),
                        code,
                        title: value_string(report.get("title")),
                        zone_name: value_string(zone.and_then(|zone| zone.get("name"))),
                        start_time: value_number(report.get("startTime")),
                        end_time: value_number(report.get("endTime")),
                    })
                })
                .collect::<Vec<_>>();
            reports.sort_by(|left, right| {
                right
                    .start_time
                    .zip(left.start_time)
                    .and_then(|(right, left)| right.partial_cmp(&left))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            reports.truncate(5);
            reports
        })
        .unwrap_or_default();

    let ranking = character_object
        .get("zoneRankings")
        .filter(|value| !value.is_null())
        .and_then(|ranking| {
            let ranking = ranking
                .as_array()
                .and_then(|entries| {
                    entries
                        .iter()
                        .find(|entry| entry.get("rankings").is_some())
                        .or_else(|| entries.first())
                })
                .unwrap_or(ranking);
            let metric = value_string(ranking.get("metric"));
            Some(WarcraftLogsRanking {
                zone_id: value_number(
                    ranking
                        .get("zone")
                        .and_then(|zone| zone.get("id"))
                        .or_else(|| ranking.get("zoneId"))
                        .or_else(|| ranking.get("zoneID"))
                        .or_else(|| ranking.get("zone")),
                ),
                zone_name: value_string(
                    ranking
                        .get("zone")
                        .and_then(|zone| zone.get("name"))
                        .or_else(|| ranking.get("zoneName")),
                ),
                metric,
                best_performance_average: value_number(ranking.get("bestPerformanceAverage")),
                median_performance_average: value_number(ranking.get("medianPerformanceAverage")),
                all_stars: value_number(ranking.get("allStars")),
                average_item_level: value_number(ranking.get("averageItemLevel")),
            })
        });

    let boss_rankings = character_object
        .get("zoneRankings")
        .filter(|value| !value.is_null())
        .and_then(|ranking| {
            let ranking = ranking
                .as_array()
                .and_then(|entries| {
                    entries
                        .iter()
                        .find(|entry| entry.get("rankings").is_some())
                        .or_else(|| entries.first())
                })
                .unwrap_or(ranking);
            let metric = value_string(ranking.get("metric"));
            ranking
                .get("rankings")
                .and_then(Value::as_array)
                .map(|rankings| normalize_warcraft_logs_boss_rankings(rankings, metric.as_deref()))
        })
        .unwrap_or_default();

    Some(WarcraftLogsData {
        profile_url: format!("https://www.warcraftlogs.com/character/{region}/{realm}/{name}"),
        name: display_name,
        realm: value_string(character_object.get("serverSlug"))
            .unwrap_or_else(|| realm.to_string()),
        region: value_string(character_object.get("serverRegion"))
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_else(|| region.to_string()),
        reports,
        ranking,
        boss_rankings,
    })
}

fn normalize_warcraft_logs_boss_rankings(
    rankings: &[Value],
    metric: Option<&str>,
) -> Vec<WarcraftLogsBossRanking> {
    rankings
        .iter()
        .filter_map(|entry| {
            let encounter = entry.get("encounter");
            let encounter_name = value_string(encounter.and_then(|value| value.get("name")))
                .or_else(|| value_string(entry.get("encounterName")))?;
            let best_amount = value_number(entry.get("bestAmount")).or_else(|| {
                entry
                    .get("bestRank")
                    .and_then(|rank| rank.get("per_second_amount"))
                    .and_then(|value| value_number(Some(value)))
            });
            Some(WarcraftLogsBossRanking {
                encounter_id: value_number(
                    encounter
                        .and_then(|value| value.get("id"))
                        .or_else(|| entry.get("encounterID"))
                        .or_else(|| entry.get("encounterId")),
                ),
                encounter_name,
                rank_percent: value_number(entry.get("rankPercent")),
                median_percent: value_number(entry.get("medianPercent")),
                total_kills: value_number(entry.get("totalKills")),
                best_amount,
                metric: value_string(entry.get("metric")).or_else(|| metric.map(str::to_string)),
                spec: value_string(entry.get("bestSpec"))
                    .or_else(|| value_string(entry.get("spec"))),
            })
        })
        .collect()
}

pub async fn test_warcraft_logs_credentials(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    integrations: web::Data<Arc<IntegrationState>>,
    body: web::Json<WarcraftLogsCredentialsRequest>,
) -> HttpResponse {
    if let Err(response) = require_session(&req, state.get_ref(), &***store) {
        return response;
    }
    let (client_id, client_secret) = match credential_values(&body) {
        Ok(values) => values,
        Err(response) => return response,
    };
    match integrations
        .test_wcl_credentials(&client_id, &client_secret)
        .await
    {
        Ok(()) => HttpResponse::Ok().json(json!({"status": "ok"})),
        Err(error) => HttpResponse::BadRequest().json(json!({
            "status": "unavailable",
            "error_code": error.code()
        })),
    }
}

pub async fn save_warcraft_logs_credentials(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
    integrations: web::Data<Arc<IntegrationState>>,
    body: web::Json<WarcraftLogsCredentialsRequest>,
) -> HttpResponse {
    let claims = match require_session(&req, state.get_ref(), &***store) {
        Ok(claims) => claims,
        Err(response) => return response,
    };
    let (client_id, client_secret) = match credential_values(&body) {
        Ok(values) => values,
        Err(response) => return response,
    };
    if let Err(error) = integrations
        .test_wcl_credentials(&client_id, &client_secret)
        .await
    {
        return HttpResponse::BadRequest().json(json!({
            "status": "unavailable",
            "error_code": error.code()
        }));
    }
    store.set_user_config(&claims.sub, WARCRAFT_LOGS_CLIENT_ID_KEY, &client_id);
    if secrets
        .set_secret(&user_secret_id(&claims.sub), &client_secret)
        .is_err()
    {
        store.remove_user_config(&claims.sub, WARCRAFT_LOGS_CLIENT_ID_KEY);
        return HttpResponse::InternalServerError()
            .json(json!({"error": "Unable to save credentials"}));
    }
    store.set_user_config(&claims.sub, WARCRAFT_LOGS_ENABLED_KEY, "true");
    HttpResponse::Ok().json(json!({"status": "saved", "enabled": true}))
}

pub async fn remove_warcraft_logs_credentials(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
) -> HttpResponse {
    let claims = match require_session(&req, state.get_ref(), &***store) {
        Ok(claims) => claims,
        Err(response) => return response,
    };
    store.remove_user_config(&claims.sub, WARCRAFT_LOGS_CLIENT_ID_KEY);
    store.remove_user_config(&claims.sub, WARCRAFT_LOGS_ENABLED_KEY);
    let _ = secrets.delete_secret(&user_secret_id(&claims.sub));
    HttpResponse::Ok().json(json!({"status": "removed"}))
}

fn credential_values(
    body: &WarcraftLogsCredentialsRequest,
) -> Result<(String, String), HttpResponse> {
    let client_id = body.client_id.trim();
    let client_secret = body.client_secret.trim();
    if client_id.is_empty() || client_secret.is_empty() {
        return Err(HttpResponse::BadRequest().json(json!({
            "error": "Client ID and Client Secret are required"
        })));
    }
    Ok((client_id.to_string(), client_secret.to_string()))
}

pub async fn get_admin_warcraft_logs_credentials(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
    integrations: web::Data<Arc<IntegrationState>>,
) -> HttpResponse {
    if let Err(response) = auth_handlers::require_admin(&req, state.get_ref(), &***store) {
        return response;
    }
    let admin_client_id =
        non_empty(store.get_user_config("system", WARCRAFT_LOGS_SHARED_CLIENT_ID_KEY));
    let admin_configured = read_admin_credentials(&***store, &***secrets).is_some();
    HttpResponse::Ok().json(json!({
        "configured": admin_configured,
        "client_id": admin_client_id,
        "environment_configured": integrations.environment_client_id.is_some()
            && integrations.environment_client_secret.is_some()
    }))
}

pub async fn save_admin_warcraft_logs_credentials(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
    integrations: web::Data<Arc<IntegrationState>>,
    body: web::Json<WarcraftLogsCredentialsRequest>,
) -> HttpResponse {
    if let Err(response) = auth_handlers::require_admin(&req, state.get_ref(), &***store) {
        return response;
    }
    let (client_id, client_secret) = match credential_values(&body) {
        Ok(values) => values,
        Err(response) => return response,
    };
    if let Err(error) = integrations
        .test_wcl_credentials(&client_id, &client_secret)
        .await
    {
        return HttpResponse::BadRequest().json(json!({
            "status": "unavailable",
            "error_code": error.code()
        }));
    }
    store.set_user_config("system", WARCRAFT_LOGS_SHARED_CLIENT_ID_KEY, &client_id);
    if secrets
        .set_secret(WARCRAFT_LOGS_SHARED_SECRET_ID, &client_secret)
        .is_err()
    {
        store.remove_user_config("system", WARCRAFT_LOGS_SHARED_CLIENT_ID_KEY);
        return HttpResponse::InternalServerError()
            .json(json!({"error": "Unable to save credentials"}));
    }
    HttpResponse::Ok().json(json!({"status": "saved", "configured": true}))
}

pub async fn remove_admin_warcraft_logs_credentials(
    req: HttpRequest,
    state: web::Data<Arc<BlizzardAuthState>>,
    store: web::Data<Arc<dyn JobStorage>>,
    secrets: web::Data<Arc<dyn BlizzardCredentialSecretStore>>,
) -> HttpResponse {
    if let Err(response) = auth_handlers::require_admin(&req, state.get_ref(), &***store) {
        return response;
    }
    store.remove_user_config("system", WARCRAFT_LOGS_SHARED_CLIENT_ID_KEY);
    let _ = secrets.delete_secret(WARCRAFT_LOGS_SHARED_SECRET_ID);
    HttpResponse::Ok().json(json!({"status": "removed", "configured": false}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::auth_handlers::MemoryBlizzardCredentialSecretStore;
    use crate::storage::{JobStorage, MemoryStorage};

    #[test]
    fn normalizes_provider_slugs_and_regions() {
        assert_eq!(normalize_slug("Area 52"), "area-52");
        assert_eq!(normalize_slug("Aerie_Peak"), "aerie-peak");
        assert_eq!(normalize_region("EU"), Some("eu".to_string()));
        assert_eq!(normalize_region("oce"), None);
    }

    #[test]
    fn normalizes_raider_io_current_score_runs_and_progression() {
        let payload = json!({
            "name": "Hero",
            "realm": {"name": "Aerie Peak"},
            "mythic_plus_scores_by_season": [{"scores": {"all": 2841.5}}],
            "mythic_plus_ranks": {
                "overall": {"world": 1200, "region": 340, "realm": 12}
            },
            "mythic_plus_best_runs": [{
                "dungeon": {"name": "Ara-Kara"},
                "mythic_level": 15,
                "score": 510.2,
                "completed_at": "2026-09-02T10:00:00Z"
            }],
            "raid_progression": {
                "current-raid": {"summary": "6/8 H", "bosses_killed": 6, "total_bosses": 8}
            },
            "raid_achievement_curve": [{
                "raid": "current-raid",
                "aotc": "2026-08-21T18:45:03Z",
                "cutting_edge": "2026-08-22T18:45:03Z"
            }],
            "last_crawled_at": "2026-09-02T11:02:52Z"
        });
        let normalized = normalize_raider_io(&payload, "us", "aerie-peak", "hero").unwrap();
        assert_eq!(normalized.score, Some(2841.5));
        assert_eq!(
            normalized.ranks.as_ref().and_then(|ranks| ranks.world),
            Some(1200.0)
        );
        assert_eq!(
            normalized.ranks.as_ref().and_then(|ranks| ranks.region),
            Some(340.0)
        );
        assert_eq!(
            normalized.ranks.as_ref().and_then(|ranks| ranks.realm),
            Some(12.0)
        );
        assert_eq!(normalized.best_runs[0].dungeon, "Ara-Kara");
        assert_eq!(
            normalized.raid_progression[0].summary.as_deref(),
            Some("6/8 H")
        );
        assert_eq!(normalized.raid_progression[0].killed, Some(6.0));
        assert_eq!(normalized.raid_achievements.len(), 1);
        assert_eq!(
            normalized.raid_achievements[0]
                .ahead_of_the_curve_at
                .as_deref(),
            Some("2026-08-21T18:45:03Z")
        );
        assert_eq!(
            normalized.raid_achievements[0].cutting_edge_at.as_deref(),
            Some("2026-08-22T18:45:03Z")
        );
        assert_eq!(
            normalized.last_crawled_at.as_deref(),
            Some("2026-09-02T11:02:52Z")
        );
    }

    #[test]
    fn normalizes_warcraft_logs_reports_and_rankings_without_upstream_shape() {
        let payload = json!({
            "name": "Hero",
            "recentReports": {"data": [{
                "code": "abc123",
                "title": "Raid night",
                "startTime": 1700000000000i64,
                "zone": {"id": 42, "name": "Current Raid"}
            }]},
            "zoneRankings": {
                "zone": {"id": 42, "name": "Current Raid"},
                "metric": "dps",
                "bestPerformanceAverage": 97.2,
                "medianPerformanceAverage": 91.1,
                "allStars": [{"points": 1234}, {"points": 876}],
                "averageItemLevel": 720,
                "rankings": [{
                    "encounter": {"id": 3470, "name": "Nek'zali the Soulcoiler"},
                    "rankPercent": 18.5777,
                    "medianPercent": 17.4,
                    "totalKills": 1,
                    "bestAmount": 85654.45,
                    "bestSpec": "Arcane"
                }]
            }
        });
        let normalized = normalize_warcraft_logs(&payload, "us", "aerie-peak", "hero").unwrap();
        assert_eq!(
            normalized.reports[0].url,
            "https://www.warcraftlogs.com/reports/abc123"
        );
        assert_eq!(normalized.ranking.as_ref().unwrap().all_stars, Some(1234.0));
        assert_eq!(normalized.boss_rankings.len(), 1);
        assert_eq!(normalized.boss_rankings[0].encounter_id, Some(3470.0));
        assert_eq!(
            normalized.boss_rankings[0].encounter_name,
            "Nek'zali the Soulcoiler"
        );
        assert_eq!(normalized.boss_rankings[0].rank_percent, Some(18.5777));
        assert_eq!(normalized.boss_rankings[0].median_percent, Some(17.4));
        assert_eq!(normalized.boss_rankings[0].total_kills, Some(1.0));
        assert_eq!(normalized.boss_rankings[0].best_amount, Some(85654.45));
        assert_eq!(normalized.boss_rankings[0].metric.as_deref(), Some("dps"));
        assert_eq!(normalized.boss_rankings[0].spec.as_deref(), Some("Arcane"));
    }

    #[test]
    fn normalizes_recent_public_reports_in_descending_start_order() {
        let payload = json!({
            "recentReports": {"data": [
                {"code": "old", "visibility": "public", "startTime": 1000},
                {"code": "private", "visibility": "private", "startTime": 3000},
                {"code": "new", "visibility": "public", "startTime": 2000}
            ]}
        });
        let normalized = normalize_warcraft_logs(&payload, "us", "aerie-peak", "hero").unwrap();
        assert_eq!(
            normalized
                .reports
                .iter()
                .map(|report| report.code.as_str())
                .collect::<Vec<_>>(),
            vec!["new", "old"]
        );
        assert_eq!(normalized.reports[0].start_time, Some(2000.0));
    }

    #[test]
    fn user_credentials_take_precedence_over_environment_and_admin() {
        let store = MemoryStorage::new();
        let secrets = MemoryBlizzardCredentialSecretStore::default();
        store.set_user_config("user-1", WARCRAFT_LOGS_CLIENT_ID_KEY, "user-id");
        secrets
            .set_secret(&user_secret_id("user-1"), "user-secret")
            .unwrap();
        store.set_user_config("system", WARCRAFT_LOGS_SHARED_CLIENT_ID_KEY, "admin-id");
        secrets
            .set_secret(WARCRAFT_LOGS_SHARED_SECRET_ID, "admin-secret")
            .unwrap();
        let state = IntegrationState::with_environment_credentials(
            Some("env-id".to_string()),
            Some("env-secret".to_string()),
        );

        let (effective, _, _, _) = effective_wcl_credentials("user-1", &state, &store, &secrets);
        assert_eq!(effective.unwrap().source, "user");
    }

    #[test]
    fn environment_credentials_take_precedence_over_admin_fallback() {
        let store = MemoryStorage::new();
        let secrets = MemoryBlizzardCredentialSecretStore::default();
        store.set_user_config("system", WARCRAFT_LOGS_SHARED_CLIENT_ID_KEY, "admin-id");
        secrets
            .set_secret(WARCRAFT_LOGS_SHARED_SECRET_ID, "admin-secret")
            .unwrap();
        let state = IntegrationState::with_environment_credentials(
            Some("env-id".to_string()),
            Some("env-secret".to_string()),
        );

        let (effective, _, _, _) = effective_wcl_credentials("user-1", &state, &store, &secrets);
        assert_eq!(effective.unwrap().source, "environment");
    }

    #[test]
    fn settings_never_serialize_warcraft_logs_secrets() {
        let store = MemoryStorage::new();
        let secrets = MemoryBlizzardCredentialSecretStore::default();
        store.set_user_config("user-1", WARCRAFT_LOGS_CLIENT_ID_KEY, "public-client-id");
        secrets
            .set_secret(&user_secret_id("user-1"), "do-not-return-this-secret")
            .unwrap();
        let state = IntegrationState::with_environment_credentials(None, None);

        let settings = settings_snapshot("user-1", &state, &store, &secrets);
        let serialized = serde_json::to_string(&settings).unwrap();
        assert!(serialized.contains("public-client-id"));
        assert!(!serialized.contains("do-not-return-this-secret"));
    }

    #[test]
    fn cache_refresh_uses_fifteen_minute_envelopes() {
        let store = MemoryStorage::new();
        let value = envelope("ok", Some("value".to_string()), Some(now_unix_secs()), None);
        cache_envelope(&store, "integration:test", &value);
        assert_eq!(
            cached_envelope::<String>(&store, "integration:test")
                .unwrap()
                .data,
            Some("value".to_string())
        );
    }
}
