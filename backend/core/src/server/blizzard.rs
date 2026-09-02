use crate::server::auth_handlers::BlizzardAuthState;
use actix_web::{web, HttpResponse};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BlizzardToken {
    access_token: String,
    expires_in: u64,
}

pub struct BlizzardState {
    pub client: Client,
}

impl BlizzardState {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub async fn get_token_with_creds(client: &Client, id: &str, secret: &str) -> Option<String> {
        let res = client
            .post("https://oauth.battle.net/token")
            .basic_auth(id, Some(secret))
            .form(&[("grant_type", "client_credentials")])
            .send()
            .await
            .ok()?;

        if !res.status().is_success() {
            return None;
        }

        let data: BlizzardToken = res.json().await.ok()?;
        Some(data.access_token)
    }

    pub fn get_effective_credentials(
        req: &actix_web::HttpRequest,
        auth_state: Option<&BlizzardAuthState>,
        store: &dyn crate::storage::JobStorage,
    ) -> Option<(String, String)> {
        let _ = (req, store);
        // Credentials are either configured through the process environment or
        // used for the current OAuth session. Legacy plaintext user-config
        // values are intentionally no longer accepted.
        if let Some(auth) = auth_state {
            if let (Some(id), Some(sec)) = (&auth.client_id, &auth.client_secret) {
                return Some((id.clone(), sec.clone()));
            }
        }

        None
    }
}

pub async fn get_effective_token(
    req: &actix_web::HttpRequest,
    state: &BlizzardState,
    auth_state: Option<&BlizzardAuthState>,
    store: &dyn crate::storage::JobStorage,
) -> Option<String> {
    // Priority 1: Check for an active user session token (direct access)
    if let Some(auth) = auth_state {
        if let Some(claims) = crate::server::auth_handlers::verify_jwt_for_state(req, auth) {
            if let Some(token) = auth.oauth_token(store, &claims.session_id) {
                return Some(token);
            }
        }
    }

    // Priority 2: Use client_credentials from the best available source
    if let Some((id, secret)) = BlizzardState::get_effective_credentials(req, auth_state, store) {
        return BlizzardState::get_token_with_creds(&state.client, &id, &secret).await;
    }

    None
}

#[derive(Deserialize)]
pub struct ProxyQuery {
    pub region: Option<String>,
    pub refresh: Option<bool>,
}

#[derive(Serialize, Deserialize)]
struct RealmEntry {
    slug: String,
    name: String,
}

#[derive(Serialize, Deserialize)]
struct RealmsResponse {
    region: String,
    realms: Vec<RealmEntry>,
}

fn parse_character_path_from_url(url: &str) -> Option<(String, String, String)> {
    let after_character = url.split("/character/").nth(1)?;
    let clean = after_character
        .split('?')
        .next()
        .unwrap_or(after_character)
        .split('#')
        .next()
        .unwrap_or(after_character);
    let parts: Vec<&str> = clean.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() < 3 {
        return None;
    }
    Some((
        parts[0].to_lowercase(),
        parts[1].to_lowercase(),
        parts[2].to_lowercase(),
    ))
}

fn enrich_member_with_profile_link(member: &mut Map<String, Value>) {
    let profile_url = member
        .get("profile")
        .and_then(|p| p.get("url"))
        .and_then(Value::as_str)
        .or_else(|| {
            member
                .get("character")
                .and_then(|c| c.get("url"))
                .and_then(Value::as_str)
        })
        .or_else(|| member.get("url").and_then(Value::as_str));

    let Some(url) = profile_url else { return };
    let url_owned = url.to_string();

    let Some((region, realm, name)) = parse_character_path_from_url(url) else {
        return;
    };

    member
        .entry("linked_region".to_string())
        .or_insert_with(|| Value::String(region.clone()));
    member
        .entry("linked_realm".to_string())
        .or_insert_with(|| Value::String(realm.clone()));
    member
        .entry("linked_name".to_string())
        .or_insert_with(|| Value::String(name.clone()));
    member
        .entry("linked_profile_url".to_string())
        .or_insert_with(|| Value::String(url_owned.clone()));

    if let Some(profile_obj) = member.get_mut("profile").and_then(Value::as_object_mut) {
        profile_obj
            .entry("region".to_string())
            .or_insert_with(|| Value::String(region.clone()));
        profile_obj
            .entry("name".to_string())
            .or_insert_with(|| Value::String(name.clone()));
        let realm_obj = profile_obj
            .entry("realm".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(realm_map) = realm_obj.as_object_mut() {
            realm_map
                .entry("slug".to_string())
                .or_insert_with(|| Value::String(realm));
        }
    }
}

fn enrich_mythic_profile_member_links(value: &mut Value) {
    match value {
        Value::Array(arr) => {
            for item in arr {
                enrich_mythic_profile_member_links(item);
            }
        }
        Value::Object(obj) => {
            if let Some(Value::Array(members)) = obj.get_mut("members") {
                for member in members {
                    if let Some(member_obj) = member.as_object_mut() {
                        enrich_member_with_profile_link(member_obj);
                    }
                }
            }
            for nested in obj.values_mut() {
                enrich_mythic_profile_member_links(nested);
            }
        }
        _ => {}
    }
}

fn has_mythic_best_runs(value: &Value) -> bool {
    value
        .get("current_period")
        .and_then(|period| period.get("best_runs"))
        .and_then(Value::as_array)
        .is_some_and(|runs| !runs.is_empty())
}

fn latest_mythic_season_id(value: &Value) -> Option<u64> {
    value
        .get("seasons")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|season| season.get("id").and_then(Value::as_u64))
        .max()
}

fn merge_mythic_season_best_runs(profile: &mut Value, season_details: &Value) {
    let Some(best_runs) = season_details
        .get("best_runs")
        .filter(|runs| runs.as_array().is_some_and(|entries| !entries.is_empty()))
    else {
        return;
    };

    let Some(profile_object) = profile.as_object_mut() else {
        return;
    };
    let current_period = profile_object
        .entry("current_period".to_string())
        .or_insert_with(|| serde_json::json!({}));
    let Some(period_object) = current_period.as_object_mut() else {
        return;
    };
    let has_existing_runs = period_object
        .get("best_runs")
        .and_then(Value::as_array)
        .is_some_and(|entries| !entries.is_empty());
    if !has_existing_runs {
        period_object.insert("best_runs".to_string(), best_runs.clone());
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use crate::server::auth_handlers::{BlizzardAuthState, Claims};
    use crate::storage::{JobStorage, MemoryStorage};
    use actix_web::cookie::Cookie;
    use actix_web::{test::TestRequest, web};
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde_json::json;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_state() -> web::Data<Arc<BlizzardState>> {
        web::Data::new(Arc::new(BlizzardState::new()))
    }

    fn no_auth_state() -> web::Data<Option<Arc<BlizzardAuthState>>> {
        web::Data::new(None)
    }

    fn test_store() -> web::Data<Arc<dyn JobStorage>> {
        web::Data::new(Arc::new(MemoryStorage::new()) as Arc<dyn JobStorage>)
    }

    fn make_jwt(sub: &str, access_token: &str, secret: &str) -> String {
        let claims = Claims {
            sub: sub.to_string(),
            session_id: access_token.to_string(),
            battletag: sub.to_string(),
            role: "member".to_string(),
            session_epoch: None,
            exp: (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_secs()
                + 3600) as usize,
        };
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        )
        .expect("jwt encode")
    }

    #[test]
    fn parse_character_path_from_url_extracts_region_realm_name() {
        let url = "https://worldofwarcraft.blizzard.com/en-us/character/us/illidan/tester?foo=bar";
        let parsed = parse_character_path_from_url(url);
        assert_eq!(
            parsed,
            Some((
                "us".to_string(),
                "illidan".to_string(),
                "tester".to_string()
            ))
        );
    }

    #[test]
    fn enrich_member_with_profile_link_populates_member_and_profile_fields() {
        let mut member = serde_json::json!({
            "profile": {
                "url": "https://worldofwarcraft.blizzard.com/en-us/character/us/illidan/tester"
            }
        })
        .as_object()
        .cloned()
        .expect("member object");

        enrich_member_with_profile_link(&mut member);

        assert_eq!(member.get("linked_region"), Some(&json!("us")));
        assert_eq!(member.get("linked_realm"), Some(&json!("illidan")));
        assert_eq!(member.get("linked_name"), Some(&json!("tester")));
        assert_eq!(
            member.get("linked_profile_url"),
            Some(&json!(
                "https://worldofwarcraft.blizzard.com/en-us/character/us/illidan/tester"
            ))
        );
        assert_eq!(member["profile"]["region"], "us");
        assert_eq!(member["profile"]["name"], "tester");
        assert_eq!(member["profile"]["realm"]["slug"], "illidan");
    }

    #[test]
    fn enrich_mythic_profile_member_links_recurses_nested_members_and_preserves_existing_fields() {
        let mut payload = json!({
            "members": [
                {
                    "character": {
                        "url": "https://worldofwarcraft.blizzard.com/en-us/character/eu/tarren-mill/healer"
                    },
                    "linked_name": "custom-name"
                }
            ],
            "nested": {
                "members": [
                    {
                        "url": "https://worldofwarcraft.blizzard.com/en-us/character/us/area-52/dps"
                    }
                ]
            }
        });

        enrich_mythic_profile_member_links(&mut payload);

        assert_eq!(payload["members"][0]["linked_region"], "eu");
        assert_eq!(payload["members"][0]["linked_realm"], "tarren-mill");
        assert_eq!(payload["members"][0]["linked_name"], "custom-name");
        assert_eq!(payload["nested"]["members"][0]["linked_region"], "us");
        assert_eq!(payload["nested"]["members"][0]["linked_realm"], "area-52");
        assert_eq!(payload["nested"]["members"][0]["linked_name"], "dps");
    }

    #[test]
    fn mythic_profile_fallback_uses_latest_season_best_runs_when_period_is_empty() {
        let mut profile = json!({
            "current_mythic_rating": { "rating": 2410.0 },
            "current_period": { "period": { "id": 12 }, "best_runs": [] },
            "seasons": [{ "id": 10 }, { "id": 11 }]
        });
        let season_details = json!({
            "best_runs": [{
                "keystone_level": 14,
                "dungeon": { "name": "The Dawnbreaker" }
            }]
        });

        assert_eq!(latest_mythic_season_id(&profile), Some(11));
        assert!(!has_mythic_best_runs(&profile));
        merge_mythic_season_best_runs(&mut profile, &season_details);

        assert!(has_mythic_best_runs(&profile));
        assert_eq!(
            profile["current_period"]["best_runs"][0]["keystone_level"],
            14
        );
        assert_eq!(profile["current_mythic_rating"]["rating"], 2410.0);
    }

    #[test]
    fn mythic_profile_fallback_does_not_replace_existing_period_runs() {
        let mut profile = json!({
            "current_period": {
                "best_runs": [{ "keystone_level": 12, "dungeon": { "name": "Ara-Kara" } }]
            }
        });
        let season_details = json!({
            "best_runs": [{ "keystone_level": 14, "dungeon": { "name": "The Dawnbreaker" } }]
        });

        merge_mythic_season_best_runs(&mut profile, &season_details);

        assert_eq!(
            profile["current_period"]["best_runs"][0]["keystone_level"],
            12
        );
        assert_eq!(
            profile["current_period"]["best_runs"][0]["dungeon"]["name"],
            "Ara-Kara"
        );
    }

    #[test]
    fn get_effective_credentials_ignores_legacy_system_plaintext() {
        let req = TestRequest::default().to_http_request();
        let store = MemoryStorage::new();
        store.set_user_config("system", "blizzard_client_id", "system-id");
        store.set_user_config("system", "blizzard_client_secret", "system-secret");

        let auth = BlizzardAuthState::new(
            Some("global-id".to_string()),
            Some("global-secret".to_string()),
            "http://localhost/callback".to_string(),
            "jwt-secret".to_string(),
        );

        let creds = BlizzardState::get_effective_credentials(&req, Some(&auth), &store);
        assert_eq!(
            creds,
            Some(("global-id".to_string(), "global-secret".to_string()))
        );
    }

    #[test]
    fn get_effective_credentials_falls_back_to_global_when_no_system() {
        let req = TestRequest::default().to_http_request();
        let store = MemoryStorage::new();
        let auth = BlizzardAuthState::new(
            Some("global-id".to_string()),
            Some("global-secret".to_string()),
            "http://localhost/callback".to_string(),
            "jwt-secret".to_string(),
        );

        let creds = BlizzardState::get_effective_credentials(&req, Some(&auth), &store);
        assert_eq!(
            creds,
            Some(("global-id".to_string(), "global-secret".to_string()))
        );
    }

    #[test]
    fn get_effective_credentials_ignores_legacy_user_plaintext() {
        let token = make_jwt("Tester#9999", "access-token", "jwt-secret");
        let req = TestRequest::default()
            .cookie(Cookie::new("bnet_session", token))
            .to_http_request();
        let store = MemoryStorage::new();
        store.set_user_config("Tester#9999", "blizzard_client_id", "user-id");
        store.set_user_config("Tester#9999", "blizzard_client_secret", "user-secret");

        let auth = BlizzardAuthState::new(
            Some("global-id".to_string()),
            Some("global-secret".to_string()),
            "http://localhost/callback".to_string(),
            "jwt-secret".to_string(),
        );

        let creds = BlizzardState::get_effective_credentials(&req, Some(&auth), &store);
        assert_eq!(
            creds,
            Some(("global-id".to_string(), "global-secret".to_string()))
        );
    }

    #[test]
    fn get_effective_credentials_ignores_legacy_user_and_system_plaintext() {
        let token = make_jwt("Tester#9999", "access-token", "jwt-secret");
        let req = TestRequest::default()
            .cookie(Cookie::new("bnet_session", token))
            .to_http_request();
        let store = MemoryStorage::new();
        store.set_user_config("system", "blizzard_client_id", "system-id");
        store.set_user_config("system", "blizzard_client_secret", "system-secret");
        store.set_user_config("Tester#9999", "blizzard_client_id", "user-id");
        store.set_user_config("Tester#9999", "blizzard_client_secret", "user-secret");

        let auth = BlizzardAuthState::new(
            Some("global-id".to_string()),
            Some("global-secret".to_string()),
            "http://localhost/callback".to_string(),
            "jwt-secret".to_string(),
        );

        let creds = BlizzardState::get_effective_credentials(&req, Some(&auth), &store);
        assert_eq!(
            creds,
            Some(("global-id".to_string(), "global-secret".to_string()))
        );
    }

    #[actix_web::test]
    async fn character_profile_proxy_rejects_requests_without_token_or_credentials() {
        let resp = proxy_character_profile(
            TestRequest::default().to_http_request(),
            test_state(),
            no_auth_state(),
            test_store(),
            web::Path::from(("Area 52".to_string(), "Thrall".to_string())),
            web::Query(ProxyQuery {
                region: Some("us".to_string()),
                refresh: Some(true),
            }),
        )
        .await;

        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn character_media_proxy_rejects_requests_without_token_or_credentials() {
        let resp = proxy_character_media(
            TestRequest::default().to_http_request(),
            test_state(),
            no_auth_state(),
            test_store(),
            web::Path::from((
                "Area 52".to_string(),
                "Thrall".to_string(),
                "main".to_string(),
            )),
            web::Query(ProxyQuery {
                region: Some("us".to_string()),
                refresh: Some(true),
            }),
        )
        .await;

        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn additional_character_proxy_handlers_reject_requests_without_token_or_credentials() {
        let equipment = proxy_character_equipment(
            TestRequest::default().to_http_request(),
            test_state(),
            no_auth_state(),
            test_store(),
            web::Path::from(("Area 52".to_string(), "Thrall".to_string())),
            web::Query(ProxyQuery {
                region: Some("us".to_string()),
                refresh: Some(true),
            }),
        )
        .await;
        assert_eq!(equipment.status(), 401);

        let statistics = proxy_character_statistics(
            TestRequest::default().to_http_request(),
            test_state(),
            no_auth_state(),
            test_store(),
            web::Path::from(("Area 52".to_string(), "Thrall".to_string())),
            web::Query(ProxyQuery {
                region: Some("us".to_string()),
                refresh: Some(true),
            }),
        )
        .await;
        assert_eq!(statistics.status(), 401);

        let specializations = proxy_character_specializations(
            TestRequest::default().to_http_request(),
            test_state(),
            no_auth_state(),
            test_store(),
            web::Path::from(("Area 52".to_string(), "Thrall".to_string())),
            web::Query(ProxyQuery {
                region: Some("us".to_string()),
                refresh: Some(true),
            }),
        )
        .await;
        assert_eq!(specializations.status(), 401);

        let professions = proxy_character_professions(
            TestRequest::default().to_http_request(),
            test_state(),
            no_auth_state(),
            test_store(),
            web::Path::from(("Area 52".to_string(), "Thrall".to_string())),
            web::Query(ProxyQuery {
                region: Some("us".to_string()),
                refresh: Some(true),
            }),
        )
        .await;
        assert_eq!(professions.status(), 401);
    }

    #[actix_web::test]
    async fn mythic_and_realm_proxy_handlers_reject_requests_without_token_or_credentials() {
        let mythic_profile = proxy_character_mythic_keystone_profile(
            TestRequest::default().to_http_request(),
            test_state(),
            no_auth_state(),
            test_store(),
            web::Path::from(("Area 52".to_string(), "Thrall".to_string())),
            web::Query(ProxyQuery {
                region: Some("us".to_string()),
                refresh: Some(true),
            }),
        )
        .await;
        assert_eq!(mythic_profile.status(), 401);

        let raid_progress = proxy_character_raid_encounters(
            TestRequest::default().to_http_request(),
            test_state(),
            no_auth_state(),
            test_store(),
            web::Path::from(("Area 52".to_string(), "Thrall".to_string())),
            web::Query(ProxyQuery {
                region: Some("us".to_string()),
                refresh: Some(true),
            }),
        )
        .await;
        assert_eq!(raid_progress.status(), 401);

        let dungeon_index = proxy_mythic_keystone_dungeon_index(
            TestRequest::default().to_http_request(),
            test_state(),
            no_auth_state(),
            test_store(),
            web::Query(ProxyQuery {
                region: Some("us".to_string()),
                refresh: Some(true),
            }),
        )
        .await;
        assert_eq!(dungeon_index.status(), 401);

        let dungeon_detail = proxy_mythic_keystone_dungeon_detail(
            TestRequest::default().to_http_request(),
            test_state(),
            no_auth_state(),
            test_store(),
            web::Path::from(399_u64),
            web::Query(ProxyQuery {
                region: Some("us".to_string()),
                refresh: Some(true),
            }),
        )
        .await;
        assert_eq!(dungeon_detail.status(), 401);

        let realms_index = proxy_realms_index(
            TestRequest::default().to_http_request(),
            test_state(),
            no_auth_state(),
            test_store(),
            web::Query(ProxyQuery {
                region: Some("us".to_string()),
                refresh: Some(true),
            }),
        )
        .await;
        assert_eq!(realms_index.status(), 401);
    }
}

async fn proxy_blizzard_data_url(
    req: &actix_web::HttpRequest,
    state: &web::Data<Arc<BlizzardState>>,
    auth_state: &web::Data<Option<Arc<BlizzardAuthState>>>,
    store: &web::Data<Arc<dyn crate::storage::JobStorage>>,
    cache_key: &str,
    url: &str,
    refresh: bool,
) -> HttpResponse {
    if !refresh {
        if let Some(cached) = store.get_cache(cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        req,
        state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        store.get_ref().as_ref(),
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let res = state
        .client
        .get(url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => HttpResponse::Ok().json(serde_json::json!({})),
    }
}

pub async fn proxy_character_profile(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_profile_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let mut data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            enrich_mythic_profile_member_links(&mut data);
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => HttpResponse::NotFound().finish(),
    }
}

pub async fn proxy_character_media(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name, _type) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let target_type = if _type == "render" || _type == "main" {
        "main-raw"
    } else {
        _type.as_str()
    };

    let cache_key = format!(
        "char_media_{}_{}_{}_{}",
        target_type,
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            return HttpResponse::Found()
                .append_header(("Location", cached))
                .finish();
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/character-media?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            if let Some(assets) = data.get("assets").and_then(|a| a.as_array()) {
                for asset in assets {
                    if let (Some(key), Some(value)) = (
                        asset.get("key").and_then(|v| v.as_str()),
                        asset.get("value").and_then(|v| v.as_str()),
                    ) {
                        if key == target_type {
                            store.set_cache(&cache_key, value.to_string());
                            return HttpResponse::Found()
                                .append_header(("Location", value))
                                .finish();
                        }
                    }
                }
            }
            HttpResponse::NotFound().finish()
        }
        _ => HttpResponse::NotFound().finish(),
    }
}

pub async fn proxy_character_equipment(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_equip_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/equipment?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => HttpResponse::NotFound().finish(),
    }
}

pub async fn proxy_character_statistics(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_stats_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/statistics?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => {
            println!("Blizzard API 404/Error for character statistics at {}", url);
            HttpResponse::Ok().json(serde_json::json!({}))
        }
    }
}

pub async fn proxy_character_specializations(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_specs_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/specializations?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => {
            println!("Blizzard API 404/Error for specializations at {}", url);
            HttpResponse::Ok().json(serde_json::json!({}))
        }
    }
}
pub async fn proxy_character_professions(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_profs_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/professions?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => HttpResponse::Ok().json(serde_json::json!({})),
    }
}

pub async fn proxy_character_mythic_keystone_profile(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_mplus_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/mythic-keystone-profile?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let mut data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            if !has_mythic_best_runs(&data) {
                if let Some(season_id) = latest_mythic_season_id(&data) {
                    let season_url = format!(
                        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/mythic-keystone-profile/season/{}?namespace={}&locale=en_US",
                        region,
                        realm_slug,
                        name.to_lowercase(),
                        season_id,
                        namespace
                    );
                    if let Ok(season_response) = state
                        .client
                        .get(&season_url)
                        .header("Authorization", format!("Bearer {}", token))
                        .send()
                        .await
                    {
                        if season_response.status().is_success() {
                            if let Ok(season_details) =
                                season_response.json::<serde_json::Value>().await
                            {
                                merge_mythic_season_best_runs(&mut data, &season_details);
                            }
                        }
                    }
                }
            }
            enrich_mythic_profile_member_links(&mut data);
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => HttpResponse::Ok().json(serde_json::json!({})),
    }
}

pub async fn proxy_character_raid_encounters(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<(String, String)>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let (realm, name) = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let namespace = format!("profile-{}", region);
    let realm_slug = realm.to_lowercase().replace("'", "").replace(" ", "-");

    let cache_key = format!(
        "char_raid_prog_{}_{}_{}",
        region,
        realm_slug,
        name.to_lowercase()
    );
    if !query.refresh.unwrap_or(false) {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/profile/wow/character/{}/{}/encounters/raids?namespace={}&locale=en_US",
        region,
        realm_slug,
        name.to_lowercase(),
        namespace
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            store.set_cache(&cache_key, data.to_string());
            HttpResponse::Ok().json(data)
        }
        _ => HttpResponse::Ok().json(serde_json::json!({})),
    }
}

pub async fn proxy_mythic_keystone_dungeon_index(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let region = query.region.as_deref().unwrap_or("us");
    let refresh = query.refresh.unwrap_or(false);
    let cache_key = format!("mplus_dungeon_index_{}", region);
    let url = format!(
        "https://{}.api.blizzard.com/data/wow/mythic-keystone/dungeon/index?namespace=dynamic-{}&locale=en_US",
        region, region
    );

    proxy_blizzard_data_url(&req, &state, &auth_state, &store, &cache_key, &url, refresh).await
}

pub async fn proxy_mythic_keystone_dungeon_detail(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    path: web::Path<u64>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let dungeon_id = path.into_inner();
    let region = query.region.as_deref().unwrap_or("us");
    let refresh = query.refresh.unwrap_or(false);
    let cache_key = format!("mplus_dungeon_detail_{}_{}", region, dungeon_id);
    let url = format!(
        "https://{}.api.blizzard.com/data/wow/mythic-keystone/dungeon/{}?namespace=dynamic-{}&locale=en_US",
        region, dungeon_id, region
    );

    proxy_blizzard_data_url(&req, &state, &auth_state, &store, &cache_key, &url, refresh).await
}

pub async fn proxy_realms_index(
    req: actix_web::HttpRequest,
    state: web::Data<Arc<BlizzardState>>,
    auth_state: web::Data<Option<Arc<BlizzardAuthState>>>,
    store: web::Data<Arc<dyn crate::storage::JobStorage>>,
    query: web::Query<ProxyQuery>,
) -> HttpResponse {
    let region = query.region.as_deref().unwrap_or("us").to_lowercase();
    let refresh = query.refresh.unwrap_or(false);
    let cache_key = format!("realms_index_{}", region);

    if !refresh {
        if let Some(cached) = store.get_cache(&cache_key) {
            if let Ok(json_val) = serde_json::from_str::<RealmsResponse>(&cached) {
                return HttpResponse::Ok().json(json_val);
            }
        }
    }

    let token = match get_effective_token(
        &req,
        &state,
        auth_state.as_ref().as_ref().map(|a| a.as_ref()),
        &***store,
    )
    .await
    {
        Some(t) => t,
        None => return HttpResponse::Unauthorized().finish(),
    };

    let url = format!(
        "https://{}.api.blizzard.com/data/wow/realm/index?namespace=dynamic-{}&locale=en_US",
        region, region
    );

    let res = state
        .client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or(serde_json::json!({}));
            let mut realms: Vec<RealmEntry> = data
                .get("realms")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| {
                            let slug = item.get("slug").and_then(|v| v.as_str())?.to_string();
                            let name = item
                                .get("name")
                                .and_then(|v| v.as_str())
                                .map(str::to_string)
                                .unwrap_or_else(|| slug.clone());
                            Some(RealmEntry { slug, name })
                        })
                        .collect()
                })
                .unwrap_or_default();
            realms.sort_by(|a, b| a.name.cmp(&b.name));
            let payload = RealmsResponse { region, realms };
            store.set_cache(
                &cache_key,
                serde_json::to_string(&payload).unwrap_or_default(),
            );
            HttpResponse::Ok().json(payload)
        }
        _ => HttpResponse::Ok().json(RealmsResponse {
            region,
            realms: Vec::new(),
        }),
    }
}
