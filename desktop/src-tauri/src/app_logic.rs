use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub(crate) fn is_supported_import_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("simc") | Some("txt") | Some("wldps")
    )
}

pub(crate) fn importable_file_paths(args: &[String]) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| is_supported_import_path(path))
        .collect()
}

pub(crate) fn is_sensitive_backup_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized.starts_with("api_cache_")
        || normalized.contains("token")
        || normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("credential")
}

pub(crate) fn seed_runtime_data_if_missing(bundled_data_dir: &Path, runtime_data_dir: &Path) {
    if !bundled_data_dir.exists() {
        return;
    }

    let mut stack: Vec<(PathBuf, PathBuf)> = vec![(
        bundled_data_dir.to_path_buf(),
        runtime_data_dir.to_path_buf(),
    )];

    while let Some((src_dir, dst_dir)) = stack.pop() {
        let _ = std::fs::create_dir_all(&dst_dir);

        let entries = match std::fs::read_dir(&src_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let src_path = entry.path();
            let dst_path = dst_dir.join(entry.file_name());

            if src_path.is_dir() {
                stack.push((src_path, dst_path));
            } else if src_path.is_file() && !dst_path.exists() {
                if let Some(parent) = dst_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::copy(&src_path, &dst_path);
            }
        }
    }
}

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
pub(crate) struct AppClosePreferences {
    #[serde(default)]
    pub(crate) minimize_to_tray_on_close: Option<bool>,
    #[serde(default)]
    pub(crate) simc_update_channel: Option<String>,
    #[serde(default)]
    pub(crate) simc_runtime_version: Option<String>,
    #[serde(default)]
    pub(crate) discord_presence_enabled: Option<bool>,
    #[serde(default)]
    pub(crate) discord_client_id: Option<String>,
    #[serde(default)]
    pub(crate) lan_sharing_enabled: bool,
    #[serde(default)]
    pub(crate) light_mode: Option<bool>,
}

#[derive(Debug)]
pub(crate) struct AppClosePreferencesState {
    pub(crate) prefs: Mutex<AppClosePreferences>,
    pub(crate) path: PathBuf,
    pub(crate) lan_sharing_runtime_enabled: bool,
    pub(crate) simc_runtime: SimcRuntimeCoordinator,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) enum SimcReadiness {
    Missing,
    Downloading,
    Ready,
    Failed,
}

#[derive(Clone, Debug)]
pub(crate) struct SimcRuntimeCoordinator {
    pub(crate) update_lock: Arc<tokio::sync::Mutex<()>>,
    readiness: Arc<Mutex<SimcReadiness>>,
}

impl SimcRuntimeCoordinator {
    pub(crate) fn new(initial: SimcReadiness) -> Self {
        Self {
            update_lock: Arc::new(tokio::sync::Mutex::new(())),
            readiness: Arc::new(Mutex::new(initial)),
        }
    }

    pub(crate) fn set_readiness(&self, readiness: SimcReadiness) {
        if let Ok(mut current) = self.readiness.lock() {
            *current = readiness;
        }
    }

    pub(crate) fn readiness(&self) -> SimcReadiness {
        self.readiness
            .lock()
            .map(|current| current.clone())
            .unwrap_or(SimcReadiness::Failed)
    }
}

#[derive(serde::Serialize)]
pub(crate) struct CloseBehaviorPreferenceResponse {
    pub(crate) minimize_to_tray_on_close: Option<bool>,
}

#[derive(serde::Serialize)]
pub(crate) struct SimcUpdateChannelResponse {
    pub(crate) channel: String,
}

#[derive(serde::Serialize)]
pub(crate) struct SimcRuntimeVersionPreferenceResponse {
    pub(crate) version: Option<String>,
}

#[derive(serde::Serialize)]
pub(crate) struct LightModePreferenceResponse {
    pub(crate) light_mode: Option<bool>,
}

pub(crate) fn normalize_simc_update_channel(channel: &str) -> String {
    match channel.trim().to_ascii_lowercase().as_str() {
        "nightly" => "nightly".to_string(),
        _ => "weekly".to_string(),
    }
}

pub(crate) fn normalize_simc_runtime_version(version: &str) -> Option<String> {
    let trimmed = version.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("latest") {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn load_close_preferences(path: &Path) -> AppClosePreferences {
    if !path.exists() {
        return AppClosePreferences::default();
    }

    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return AppClosePreferences::default(),
    };

    let mut prefs = serde_json::from_str::<AppClosePreferences>(&raw).unwrap_or_default();
    prefs.simc_update_channel = prefs
        .simc_update_channel
        .as_deref()
        .map(normalize_simc_update_channel);
    prefs.simc_runtime_version = prefs
        .simc_runtime_version
        .as_deref()
        .and_then(normalize_simc_runtime_version);
    prefs
}

pub(crate) fn save_close_preferences(
    path: &Path,
    prefs: &AppClosePreferences,
) -> Result<(), String> {
    let payload = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    std::fs::write(path, payload).map_err(|e| e.to_string())
}

pub(crate) fn set_simc_update_channel_internal(
    state: &AppClosePreferencesState,
    channel: &str,
) -> Result<String, String> {
    let normalized = normalize_simc_update_channel(channel);
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    prefs.simc_update_channel = Some(normalized.clone());
    save_close_preferences(&state.path, &prefs)?;
    Ok(normalized)
}

pub(crate) fn set_simc_runtime_version_internal(
    state: &AppClosePreferencesState,
    version: Option<&str>,
) -> Result<Option<String>, String> {
    let normalized = version.and_then(normalize_simc_runtime_version);
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    prefs.simc_runtime_version = normalized.clone();
    save_close_preferences(&state.path, &prefs)?;
    Ok(normalized)
}

pub(crate) fn set_close_behavior_preference_internal(
    state: &AppClosePreferencesState,
    minimize_to_tray_on_close: bool,
) -> Result<(), String> {
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    prefs.minimize_to_tray_on_close = Some(minimize_to_tray_on_close);
    save_close_preferences(&state.path, &prefs)
}

pub(crate) fn clear_close_behavior_preference_internal(
    state: &AppClosePreferencesState,
) -> Result<(), String> {
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    prefs.minimize_to_tray_on_close = None;
    save_close_preferences(&state.path, &prefs)
}

pub(crate) fn set_lan_sharing_enabled_internal(
    state: &AppClosePreferencesState,
    enabled: bool,
) -> Result<(), String> {
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    prefs.lan_sharing_enabled = enabled;
    save_close_preferences(&state.path, &prefs)
}

pub(crate) fn set_light_mode_preference_internal(
    state: &AppClosePreferencesState,
    light_mode: bool,
) -> Result<(), String> {
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    prefs.light_mode = Some(light_mode);
    save_close_preferences(&state.path, &prefs)
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct SimNotificationSummary {
    pub(crate) id: String,
    pub(crate) status: String,
    pub(crate) sim_type: String,
    pub(crate) player_name: Option<String>,
    pub(crate) linked_name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct SimTrackEventPayload {
    pub(crate) sims: Vec<SimTrackEventItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub(crate) struct SimTrackEventItem {
    pub(crate) id: String,
    pub(crate) sim_type: Option<String>,
    pub(crate) player_name: Option<String>,
    pub(crate) linked_name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct SimStatusResponse {
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) sim_type: String,
    #[serde(default)]
    pub(crate) simc_input: String,
    pub(crate) linked_name: Option<String>,
    pub(crate) result: Option<Value>,
}

#[derive(Debug)]
pub(crate) enum SimWatcherCommand {
    Track(Vec<SimTrackEventItem>),
}

#[derive(Debug, Clone)]
pub(crate) struct SimWatcherMeta {
    pub(crate) sim_type: String,
    pub(crate) player_name: Option<String>,
    pub(crate) linked_name: Option<String>,
}

impl SimWatcherMeta {
    pub(crate) fn from_summary(summary: &SimNotificationSummary) -> Self {
        Self {
            sim_type: summary.sim_type.clone(),
            player_name: summary.player_name.clone(),
            linked_name: summary.linked_name.clone(),
        }
    }

    pub(crate) fn from_event(item: &SimTrackEventItem) -> Self {
        Self {
            sim_type: item
                .sim_type
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "quick".to_string()),
            player_name: item.player_name.clone(),
            linked_name: item.linked_name.clone(),
        }
    }
}

pub(crate) fn is_active_status(status: &str) -> bool {
    status == "pending" || status == "running"
}

pub(crate) fn is_terminal_status(status: &str) -> bool {
    status == "done" || status == "failed" || status == "cancelled"
}

pub(crate) fn sim_type_label(sim_type: &str) -> &str {
    match sim_type {
        "quick" => "Quick Sim",
        "top_gear" => "Top Gear",
        "droptimizer" => "Drop Finder",
        "upgrade_compare" => "Upgrade Compare",
        _ => sim_type,
    }
}

pub(crate) fn notification_title(status: &str) -> &'static str {
    match status {
        "done" => "Simulation Finished",
        "failed" => "Simulation Failed",
        "cancelled" => "Simulation Cancelled",
        _ => "Simulation Update",
    }
}

pub(crate) fn parse_simc_player_name(simc_input: &str) -> Option<String> {
    let actor_keys = [
        "warrior",
        "paladin",
        "hunter",
        "rogue",
        "priest",
        "death_knight",
        "deathknight",
        "shaman",
        "mage",
        "warlock",
        "monk",
        "druid",
        "demon_hunter",
        "demonhunter",
        "evoker",
        "player",
        "name",
    ];

    for raw in simc_input.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };

        let key = key.trim().to_ascii_lowercase();
        if actor_keys.contains(&key.as_str()) {
            let cleaned = value.trim().trim_matches('"').to_string();
            if !cleaned.is_empty() {
                return Some(cleaned);
            }
        }
    }

    None
}

pub(crate) fn extract_dps_from_result(result: &Value) -> Option<f64> {
    let candidates = [
        result.pointer("/statistics/raid_dps/mean"),
        result.pointer("/statistics/dps"),
        result.pointer("/dps"),
    ];

    for candidate in candidates {
        let Some(value) = candidate else {
            continue;
        };

        if let Some(num) = value.as_f64() {
            return Some(num);
        }

        if let Some(num) = value.as_i64() {
            return Some(num as f64);
        }

        if let Some(text) = value.as_str() {
            if let Ok(num) = text.parse::<f64>() {
                return Some(num);
            }
        }
    }

    None
}

pub(crate) fn resolve_notification_player(
    status: &SimStatusResponse,
    meta: &SimWatcherMeta,
) -> String {
    status
        .linked_name
        .clone()
        .or(meta.linked_name.clone())
        .or(meta.player_name.clone())
        .or_else(|| parse_simc_player_name(&status.simc_input))
        .unwrap_or_else(|| "Simulation".to_string())
}

pub(crate) fn resolve_notification_sim_type<'a>(
    status: &'a SimStatusResponse,
    meta: &'a SimWatcherMeta,
) -> &'a str {
    if status.sim_type.trim().is_empty() {
        &meta.sim_type
    } else {
        &status.sim_type
    }
}

pub(crate) fn build_sim_notification_body(
    status: &SimStatusResponse,
    meta: &SimWatcherMeta,
) -> String {
    let player = resolve_notification_player(status, meta);
    let sim_type = sim_type_label(resolve_notification_sim_type(status, meta));

    if status.status == "done" {
        match status.result.as_ref().and_then(extract_dps_from_result) {
            Some(dps) => format!("{player} - {sim_type} - {} DPS", dps.round() as i64),
            None => format!("{player} - {sim_type}"),
        }
    } else {
        format!("{player} - {sim_type} - {}", status.status)
    }
}

pub(crate) fn handle_track_command(
    items: Vec<SimTrackEventItem>,
    tracked_active: &mut HashMap<String, SimWatcherMeta>,
    notified_sims: &mut HashSet<String>,
) {
    for item in items {
        if item.id.trim().is_empty() {
            continue;
        }

        tracked_active
            .entry(item.id.clone())
            .or_insert_with(|| SimWatcherMeta::from_event(&item));

        notified_sims.remove(&item.id);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TrayMenuAction {
    ShowApp,
    Navigate(&'static str),
    CheckUpdates,
    Quit,
    Ignore,
}

pub(crate) fn tray_menu_action(menu_id: &str) -> TrayMenuAction {
    match menu_id {
        "show_app" => TrayMenuAction::ShowApp,
        "open_dashboard" => TrayMenuAction::Navigate("/"),
        "quick_sim" => TrayMenuAction::Navigate("/quick-sim"),
        "top_gear" => TrayMenuAction::Navigate("/top-gear"),
        "drop_finder" => TrayMenuAction::Navigate("/drop-finder"),
        "dungeons" => TrayMenuAction::Navigate("/dungeons"),
        "history" => TrayMenuAction::Navigate("/history"),
        "settings" => TrayMenuAction::Navigate("/settings"),
        "check_updates" => TrayMenuAction::CheckUpdates,
        "quit_app" => TrayMenuAction::Quit,
        _ => TrayMenuAction::Ignore,
    }
}

pub(crate) fn navigation_script(route: &str) -> String {
    format!("window.location.href='{}';", route)
}

pub(crate) fn updater_check_script() -> &'static str {
    "window.dispatchEvent(new CustomEvent('whylowdps-updater-check', { detail: { background: false } }));"
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MainWindowCloseAction {
    HideToTray,
    CloseNaturally,
    AskUser,
}

pub(crate) fn resolve_main_window_close_action(
    minimize_to_tray_on_close: Option<bool>,
) -> MainWindowCloseAction {
    match minimize_to_tray_on_close {
        Some(true) => MainWindowCloseAction::HideToTray,
        Some(false) => MainWindowCloseAction::CloseNaturally,
        None => MainWindowCloseAction::AskUser,
    }
}

pub(crate) fn choose_simc_bin(
    bundled_simc_bin: PathBuf,
    legacy_runtime_simc_bin: PathBuf,
) -> PathBuf {
    if bundled_simc_bin.exists() {
        bundled_simc_bin
    } else {
        legacy_runtime_simc_bin
    }
}

pub(crate) fn simc_binary_name() -> &'static str {
    if cfg!(windows) {
        "simc.exe"
    } else {
        "simc"
    }
}

pub(crate) fn installer_filename_from_url(url: &str) -> Result<String, String> {
    let parsed_url = url::Url::parse(url).map_err(|e| format!("Invalid update URL: {e}"))?;

    Ok(parsed_url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("whylowdps-update-installer.exe")
        .to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TrackSimsPayloadParseResult {
    Empty,
    Invalid,
    NoSims,
    Track(Vec<SimTrackEventItem>),
}

pub(crate) fn parse_track_sims_payload(payload: &str) -> TrackSimsPayloadParseResult {
    if payload.trim().is_empty() {
        return TrackSimsPayloadParseResult::Empty;
    }

    let Ok(parsed) = serde_json::from_str::<SimTrackEventPayload>(payload) else {
        return TrackSimsPayloadParseResult::Invalid;
    };

    if parsed.sims.is_empty() {
        return TrackSimsPayloadParseResult::NoSims;
    }

    TrackSimsPayloadParseResult::Track(parsed.sims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simc_runtime_coordinator_tracks_startup_states() {
        let coordinator = SimcRuntimeCoordinator::new(SimcReadiness::Missing);
        assert_eq!(coordinator.readiness(), SimcReadiness::Missing);

        coordinator.set_readiness(SimcReadiness::Downloading);
        assert_eq!(coordinator.readiness(), SimcReadiness::Downloading);
        coordinator.set_readiness(SimcReadiness::Ready);
        assert_eq!(coordinator.readiness(), SimcReadiness::Ready);
        coordinator.set_readiness(SimcReadiness::Failed);
        assert_eq!(coordinator.readiness(), SimcReadiness::Failed);
    }
    use serde_json::json;
    use std::fs;

    fn write_file(path: impl AsRef<Path>, body: &str) {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        fs::write(path, body).expect("write file");
    }

    fn test_temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "whylowdps-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));

        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn seed_runtime_data_copies_packaged_wow_files_without_classes_marker() {
        let bundled = test_temp_dir("bundled");
        let runtime = test_temp_dir("runtime");

        write_file(
            bundled.join("wow").join("wow-seasons.json"),
            "bundled seasons",
        );

        seed_runtime_data_if_missing(&bundled, &runtime);

        assert_eq!(
            fs::read_to_string(runtime.join("wow").join("wow-seasons.json")).unwrap(),
            "bundled seasons"
        );
    }

    #[test]
    fn seed_runtime_data_copies_recursively_without_overwriting_existing_files() {
        let bundled = test_temp_dir("bundled");
        let runtime = test_temp_dir("runtime");

        write_file(bundled.join("classes.json"), "bundled classes");
        write_file(bundled.join("items.json"), "bundled items");
        write_file(bundled.join("nested").join("a.json"), "nested bundled");

        write_file(runtime.join("items.json"), "runtime items");

        seed_runtime_data_if_missing(&bundled, &runtime);

        assert_eq!(
            fs::read_to_string(runtime.join("classes.json")).unwrap(),
            "bundled classes"
        );
        assert_eq!(
            fs::read_to_string(runtime.join("items.json")).unwrap(),
            "runtime items"
        );
        assert_eq!(
            fs::read_to_string(runtime.join("nested").join("a.json")).unwrap(),
            "nested bundled"
        );
    }

    #[test]
    fn close_preferences_load_default_missing_or_invalid_file() {
        let dir = test_temp_dir("prefs");

        assert_eq!(
            load_close_preferences(&dir.join("missing.json")).minimize_to_tray_on_close,
            None
        );

        let invalid = dir.join("invalid.json");
        write_file(&invalid, "{bad-json");

        assert_eq!(
            load_close_preferences(&invalid).minimize_to_tray_on_close,
            None
        );
    }

    #[test]
    fn desktop_preferences_load_supported_simc_channel_or_default_weekly() {
        let dir = test_temp_dir("prefs");

        assert_eq!(
            load_close_preferences(&dir.join("missing.json")).simc_update_channel,
            None
        );

        let prefs = dir.join("prefs.json");
        write_file(&prefs, r#"{ "simc_update_channel": "nightly" }"#);
        assert_eq!(
            load_close_preferences(&prefs)
                .simc_update_channel
                .as_deref(),
            Some("nightly")
        );

        write_file(&prefs, r#"{ "simc_update_channel": "stable" }"#);
        assert_eq!(
            load_close_preferences(&prefs)
                .simc_update_channel
                .as_deref(),
            Some("weekly")
        );
    }

    #[test]
    fn desktop_preferences_load_and_save_pinned_simc_version() {
        let dir = test_temp_dir("prefs");
        let path = dir.join("prefs.json");
        write_file(
            &path,
            r#"{ "simc_update_channel": "nightly", "simc_runtime_version": "nightly-202606240100" }"#,
        );

        let prefs = load_close_preferences(&path);
        assert_eq!(prefs.simc_update_channel.as_deref(), Some("nightly"));
        assert_eq!(
            prefs.simc_runtime_version.as_deref(),
            Some("nightly-202606240100")
        );

        let state = AppClosePreferencesState {
            prefs: Mutex::new(AppClosePreferences::default()),
            path: path.clone(),
            lan_sharing_runtime_enabled: false,
            simc_runtime: SimcRuntimeCoordinator::new(SimcReadiness::Missing),
        };

        set_simc_runtime_version_internal(&state, Some("weekly-202606230100")).unwrap();
        assert_eq!(
            load_close_preferences(&path)
                .simc_runtime_version
                .as_deref(),
            Some("weekly-202606230100")
        );

        set_simc_runtime_version_internal(&state, None).unwrap();
        assert_eq!(load_close_preferences(&path).simc_runtime_version, None);
    }

    #[test]
    fn desktop_preferences_save_simc_channel() {
        let dir = test_temp_dir("prefs");
        let path = dir.join("prefs.json");

        let state = AppClosePreferencesState {
            prefs: Mutex::new(AppClosePreferences::default()),
            path: path.clone(),
            lan_sharing_runtime_enabled: false,
            simc_runtime: SimcRuntimeCoordinator::new(SimcReadiness::Missing),
        };

        set_simc_update_channel_internal(&state, "nightly").unwrap();
        assert_eq!(
            state.prefs.lock().unwrap().simc_update_channel.as_deref(),
            Some("nightly")
        );
        assert_eq!(
            load_close_preferences(&path).simc_update_channel.as_deref(),
            Some("nightly")
        );

        set_simc_update_channel_internal(&state, "stable").unwrap();
        assert_eq!(
            load_close_preferences(&path).simc_update_channel.as_deref(),
            Some("weekly")
        );
    }

    #[test]
    fn close_preferences_save_set_and_clear() {
        let dir = test_temp_dir("prefs");
        let path = dir.join("prefs.json");

        let state = AppClosePreferencesState {
            prefs: Mutex::new(AppClosePreferences::default()),
            path: path.clone(),
            lan_sharing_runtime_enabled: false,
            simc_runtime: SimcRuntimeCoordinator::new(SimcReadiness::Missing),
        };

        set_close_behavior_preference_internal(&state, true).unwrap();
        assert_eq!(
            state.prefs.lock().unwrap().minimize_to_tray_on_close,
            Some(true)
        );
        assert_eq!(
            load_close_preferences(&path).minimize_to_tray_on_close,
            Some(true)
        );

        set_close_behavior_preference_internal(&state, false).unwrap();
        assert_eq!(
            state.prefs.lock().unwrap().minimize_to_tray_on_close,
            Some(false)
        );
        assert_eq!(
            load_close_preferences(&path).minimize_to_tray_on_close,
            Some(false)
        );

        clear_close_behavior_preference_internal(&state).unwrap();
        assert_eq!(state.prefs.lock().unwrap().minimize_to_tray_on_close, None);
        assert_eq!(
            load_close_preferences(&path).minimize_to_tray_on_close,
            None
        );
    }

    #[test]
    fn light_mode_preference_persists() {
        let dir = test_temp_dir("prefs");
        let path = dir.join("prefs.json");
        let state = AppClosePreferencesState {
            prefs: Mutex::new(AppClosePreferences::default()),
            path: path.clone(),
            lan_sharing_runtime_enabled: false,
            simc_runtime: SimcRuntimeCoordinator::new(SimcReadiness::Missing),
        };

        set_light_mode_preference_internal(&state, false).unwrap();

        assert_eq!(load_close_preferences(&path).light_mode, Some(false));
    }

    #[test]
    fn lan_sharing_preference_defaults_off_and_persists() {
        let dir = test_temp_dir("prefs");
        let path = dir.join("prefs.json");

        assert!(!load_close_preferences(&path).lan_sharing_enabled);

        let state = AppClosePreferencesState {
            prefs: Mutex::new(AppClosePreferences::default()),
            path: path.clone(),
            lan_sharing_runtime_enabled: false,
            simc_runtime: SimcRuntimeCoordinator::new(SimcReadiness::Missing),
        };

        set_lan_sharing_enabled_internal(&state, true).unwrap();
        assert!(state.prefs.lock().unwrap().lan_sharing_enabled);
        assert!(load_close_preferences(&path).lan_sharing_enabled);

        set_lan_sharing_enabled_internal(&state, false).unwrap();
        assert!(!load_close_preferences(&path).lan_sharing_enabled);
    }

    #[test]
    fn status_helpers_match_only_exact_supported_values() {
        assert!(is_active_status("pending"));
        assert!(is_active_status("running"));
        assert!(!is_active_status("done"));
        assert!(!is_active_status(" Running "));

        assert!(is_terminal_status("done"));
        assert!(is_terminal_status("failed"));
        assert!(is_terminal_status("cancelled"));
        assert!(!is_terminal_status("running"));
        assert!(!is_terminal_status(" Done "));
    }

    #[test]
    fn sim_type_and_title_helpers_map_known_values() {
        assert_eq!(sim_type_label("quick"), "Quick Sim");
        assert_eq!(sim_type_label("top_gear"), "Top Gear");
        assert_eq!(sim_type_label("droptimizer"), "Drop Finder");
        assert_eq!(sim_type_label("upgrade_compare"), "Upgrade Compare");
        assert_eq!(sim_type_label("custom"), "custom");

        assert_eq!(notification_title("done"), "Simulation Finished");
        assert_eq!(notification_title("failed"), "Simulation Failed");
        assert_eq!(notification_title("cancelled"), "Simulation Cancelled");
        assert_eq!(notification_title("running"), "Simulation Update");
    }

    #[test]
    fn parse_simc_player_name_extracts_first_actor_name() {
        assert_eq!(
            parse_simc_player_name("spec=fury\nwarrior=\"Garrosh\"").as_deref(),
            Some("Garrosh")
        );

        assert_eq!(
            parse_simc_player_name("MAGE = \"Jaina\"").as_deref(),
            Some("Jaina")
        );

        assert_eq!(
            parse_simc_player_name("warrior=\"\"\nmage=\"Jaina\"").as_deref(),
            Some("Jaina")
        );

        assert_eq!(parse_simc_player_name("spec=fury\ntalents=abc"), None);
    }

    #[test]
    fn extract_dps_prefers_raid_dps_then_statistics_then_top_level() {
        assert_eq!(
            extract_dps_from_result(&json!({
                "statistics": {
                    "raid_dps": { "mean": 12345.6 },
                    "dps": 999.0
                },
                "dps": 111.0
            })),
            Some(12345.6)
        );

        assert_eq!(
            extract_dps_from_result(&json!({
                "statistics": { "dps": 99999 }
            })),
            Some(99999.0)
        );

        assert_eq!(
            extract_dps_from_result(&json!({ "dps": "123.5" })),
            Some(123.5)
        );
        assert_eq!(extract_dps_from_result(&json!({ "dps": "bad" })), None);
    }

    #[test]
    fn sim_watcher_meta_from_event_defaults_blank_type_to_quick() {
        let item = SimTrackEventItem {
            id: "job-1".to_string(),
            sim_type: Some("   ".to_string()),
            player_name: Some("Player".to_string()),
            linked_name: None,
        };

        let meta = SimWatcherMeta::from_event(&item);

        assert_eq!(meta.sim_type, "quick");
        assert_eq!(meta.player_name.as_deref(), Some("Player"));
    }

    #[test]
    fn importable_file_paths_accept_simc_text_and_shared_result_files_case_insensitively() {
        let args = vec![
            "whylowdps.exe".to_string(),
            "profile.SIMC".to_string(),
            "notes.txt".to_string(),
            "shared-result.WLDPS".to_string(),
            "image.png".to_string(),
        ];

        let paths = importable_file_paths(&args);

        assert_eq!(
            paths,
            vec![
                PathBuf::from("profile.SIMC"),
                PathBuf::from("notes.txt"),
                PathBuf::from("shared-result.WLDPS"),
            ]
        );
    }

    #[test]
    fn sensitive_backup_keys_exclude_tokens_secrets_and_cache_values() {
        assert!(is_sensitive_backup_key("api_cache_/api/status"));
        assert!(is_sensitive_backup_key("session_token"));
        assert!(is_sensitive_backup_key("blizzard_client_secret"));
        assert!(!is_sensitive_backup_key("whylowdps_fight_style"));
    }

    #[test]
    fn handle_track_command_adds_items_removes_notifications_and_preserves_existing_meta() {
        let mut tracked = HashMap::from([(
            "job-1".to_string(),
            SimWatcherMeta {
                sim_type: "quick".to_string(),
                player_name: Some("Original".to_string()),
                linked_name: None,
            },
        )]);

        let mut notified = HashSet::from(["job-1".to_string(), "job-2".to_string()]);

        handle_track_command(
            vec![
                SimTrackEventItem {
                    id: "job-1".to_string(),
                    sim_type: Some("top_gear".to_string()),
                    player_name: Some("New".to_string()),
                    linked_name: Some("Linked".to_string()),
                },
                SimTrackEventItem {
                    id: "job-2".to_string(),
                    sim_type: Some("droptimizer".to_string()),
                    player_name: Some("Dropper".to_string()),
                    linked_name: None,
                },
                SimTrackEventItem {
                    id: "   ".to_string(),
                    sim_type: Some("quick".to_string()),
                    player_name: Some("Ignored".to_string()),
                    linked_name: None,
                },
            ],
            &mut tracked,
            &mut notified,
        );

        assert_eq!(tracked.len(), 2);
        assert_eq!(tracked["job-1"].sim_type, "quick");
        assert_eq!(tracked["job-1"].player_name.as_deref(), Some("Original"));
        assert_eq!(tracked["job-2"].sim_type, "droptimizer");

        assert!(!notified.contains("job-1"));
        assert!(!notified.contains("job-2"));
    }

    #[test]
    fn build_notification_body_uses_linked_name_then_meta_then_simc_name_then_default() {
        let meta = SimWatcherMeta {
            sim_type: "quick".to_string(),
            player_name: Some("MetaPlayer".to_string()),
            linked_name: Some("MetaLinked".to_string()),
        };

        let status = SimStatusResponse {
            status: "done".to_string(),
            sim_type: "top_gear".to_string(),
            simc_input: "mage=\"Jaina\"".to_string(),
            linked_name: Some("StatusLinked".to_string()),
            result: Some(json!({ "dps": 12345.4 })),
        };

        assert_eq!(
            build_sim_notification_body(&status, &meta),
            "StatusLinked - Top Gear - 12345 DPS"
        );

        let status = SimStatusResponse {
            linked_name: None,
            ..status
        };

        assert_eq!(
            build_sim_notification_body(&status, &meta),
            "MetaLinked - Top Gear - 12345 DPS"
        );

        let meta = SimWatcherMeta {
            linked_name: None,
            player_name: None,
            sim_type: "quick".to_string(),
        };

        let status = SimStatusResponse {
            sim_type: "".to_string(),
            result: None,
            ..status
        };

        assert_eq!(
            build_sim_notification_body(&status, &meta),
            "Jaina - Quick Sim"
        );

        let status = SimStatusResponse {
            simc_input: "".to_string(),
            status: "failed".to_string(),
            ..status
        };

        assert_eq!(
            build_sim_notification_body(&status, &meta),
            "Simulation - Quick Sim - failed"
        );
    }

    #[test]
    fn serde_shapes_deserialize_with_expected_defaults() {
        let payload: SimTrackEventPayload = serde_json::from_value(json!({
            "sims": [{
                "id": "job-1",
                "sim_type": "quick",
                "player_name": "Player",
                "linked_name": "Linked"
            }]
        }))
        .unwrap();

        assert_eq!(payload.sims.len(), 1);
        assert_eq!(payload.sims[0].id, "job-1");

        let status: SimStatusResponse = serde_json::from_value(json!({
            "status": "done"
        }))
        .unwrap();

        assert_eq!(status.status, "done");
        assert_eq!(status.sim_type, "");
        assert_eq!(status.simc_input, "");
        assert_eq!(status.linked_name, None);
        assert_eq!(status.result, None);
    }

    #[test]
    fn tray_menu_action_maps_all_known_menu_ids() {
        assert_eq!(tray_menu_action("show_app"), TrayMenuAction::ShowApp);
        assert_eq!(
            tray_menu_action("open_dashboard"),
            TrayMenuAction::Navigate("/")
        );
        assert_eq!(
            tray_menu_action("quick_sim"),
            TrayMenuAction::Navigate("/quick-sim")
        );
        assert_eq!(
            tray_menu_action("top_gear"),
            TrayMenuAction::Navigate("/top-gear")
        );
        assert_eq!(
            tray_menu_action("drop_finder"),
            TrayMenuAction::Navigate("/drop-finder")
        );
        assert_eq!(
            tray_menu_action("dungeons"),
            TrayMenuAction::Navigate("/dungeons")
        );
        assert_eq!(
            tray_menu_action("history"),
            TrayMenuAction::Navigate("/history")
        );
        assert_eq!(
            tray_menu_action("settings"),
            TrayMenuAction::Navigate("/settings")
        );
        assert_eq!(
            tray_menu_action("check_updates"),
            TrayMenuAction::CheckUpdates
        );
        assert_eq!(tray_menu_action("quit_app"), TrayMenuAction::Quit);
        assert_eq!(tray_menu_action("unknown"), TrayMenuAction::Ignore);
        assert_eq!(tray_menu_action(""), TrayMenuAction::Ignore);
    }

    #[test]
    fn navigation_and_updater_scripts_match_frontend_contract() {
        assert_eq!(
            navigation_script("/top-gear"),
            "window.location.href='/top-gear';"
        );
        assert_eq!(navigation_script("/"), "window.location.href='/';");
        assert_eq!(
            updater_check_script(),
            "window.dispatchEvent(new CustomEvent('whylowdps-updater-check', { detail: { background: false } }));"
        );
    }

    #[test]
    fn resolve_main_window_close_action_maps_preferences() {
        assert_eq!(
            resolve_main_window_close_action(Some(true)),
            MainWindowCloseAction::HideToTray
        );
        assert_eq!(
            resolve_main_window_close_action(Some(false)),
            MainWindowCloseAction::CloseNaturally
        );
        assert_eq!(
            resolve_main_window_close_action(None),
            MainWindowCloseAction::AskUser
        );
    }

    #[test]
    fn choose_simc_bin_prefers_bundled_when_present_otherwise_legacy() {
        let dir = test_temp_dir("simc-choice");
        let bundled = dir.join("bundled").join(simc_binary_name());
        let legacy = dir.join("legacy").join(simc_binary_name());

        write_file(&bundled, "bundled simc");
        write_file(&legacy, "legacy simc");
        assert_eq!(choose_simc_bin(bundled.clone(), legacy.clone()), bundled);

        let missing_bundled = dir.join("missing").join(simc_binary_name());
        assert_eq!(choose_simc_bin(missing_bundled, legacy.clone()), legacy);
    }

    #[test]
    fn simc_binary_name_matches_target_os() {
        if cfg!(windows) {
            assert_eq!(simc_binary_name(), "simc.exe");
        } else {
            assert_eq!(simc_binary_name(), "simc");
        }
    }

    #[test]
    fn installer_filename_from_url_extracts_filename_or_default_and_rejects_invalid_urls() {
        assert_eq!(
            installer_filename_from_url(
                "https://github.com/org/repo/releases/download/v1/WhyLowDPS_1.0.0_x64-setup.exe"
            )
            .unwrap(),
            "WhyLowDPS_1.0.0_x64-setup.exe"
        );

        assert_eq!(
            installer_filename_from_url("https://example.com/releases/download/").unwrap(),
            "whylowdps-update-installer.exe"
        );

        let err = installer_filename_from_url("not a url").unwrap_err();
        assert!(err.contains("Invalid update URL"));
    }

    #[test]
    fn parse_track_sims_payload_handles_empty_invalid_no_sims_and_valid_payloads() {
        assert_eq!(
            parse_track_sims_payload(""),
            TrackSimsPayloadParseResult::Empty
        );
        assert_eq!(
            parse_track_sims_payload("   "),
            TrackSimsPayloadParseResult::Empty
        );
        assert_eq!(
            parse_track_sims_payload("{bad-json"),
            TrackSimsPayloadParseResult::Invalid
        );
        assert_eq!(
            parse_track_sims_payload(r#"{"sims":[]}"#),
            TrackSimsPayloadParseResult::NoSims
        );

        let result = parse_track_sims_payload(
            r#"{
                "sims": [
                    {
                        "id": "job-1",
                        "sim_type": "top_gear",
                        "player_name": "Player",
                        "linked_name": "Linked"
                    }
                ]
            }"#,
        );

        let TrackSimsPayloadParseResult::Track(items) = result else {
            panic!("expected track result");
        };

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "job-1");
        assert_eq!(items[0].sim_type.as_deref(), Some("top_gear"));
        assert_eq!(items[0].player_name.as_deref(), Some("Player"));
        assert_eq!(items[0].linked_name.as_deref(), Some("Linked"));
    }
}
