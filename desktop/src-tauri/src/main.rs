#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_logic;
mod discord_presence;

use std::io::{Read, Seek, Write};
use std::net::{IpAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use app_logic::*;
use discord_presence::{
    DiscordPresenceSettingsResponse, DiscordPresenceState, DiscordPresenceUpdate,
};
use rusqlite::{Connection, MAIN_DB};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::WindowEvent;
use tauri::{Emitter, Listener, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use whylowdps_core::game_data;
use whylowdps_core::server;
use whylowdps_core::simc_runtime::{
    resolve_simc_runtime, resolve_simc_runtime_with_progress, SimcChannel, SimcRuntimeConfig,
};
use whylowdps_core::storage::{JobStorage, SqliteStorage};
use zip::{ZipArchive, ZipWriter};

#[cfg(target_os = "windows")]
fn enable_high_dpi_awareness() {
    use windows::Win32::UI::HiDpi::{
        SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };

    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

#[cfg(not(target_os = "windows"))]
fn enable_high_dpi_awareness() {}

#[tauri::command]
async fn open_auth_window(handle: tauri::AppHandle, url: String) -> Result<(), String> {
    tauri::WebviewWindowBuilder::new(
        &handle,
        "auth",
        tauri::WebviewUrl::External(url.parse::<url::Url>().map_err(|e| e.to_string())?),
    )
    .title("Blizzard Login")
    .inner_size(600.0, 750.0)
    .resizable(true)
    .always_on_top(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

const SESSION_KEYRING_SERVICE: &str = "WhyLowDPS Session";
const SESSION_KEYRING_ACCOUNT: &str = "active-bnet-session";
const SESSION_KEYRING_ENCRYPTION_ACCOUNT: &str = "session-encryption-key";

fn install_session_encryption_key() -> Result<(), String> {
    let entry = keyring::Entry::new(SESSION_KEYRING_SERVICE, SESSION_KEYRING_ENCRYPTION_ACCOUNT)
        .map_err(|error| error.to_string())?;
    let key = match entry.get_password() {
        Ok(key) => key,
        Err(keyring::Error::NoEntry) => {
            let key = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
            entry
                .set_password(&key)
                .map_err(|error| error.to_string())?;
            key
        }
        Err(error) => return Err(error.to_string()),
    };
    std::env::set_var("SESSION_ENCRYPTION_KEY", key);
    Ok(())
}

#[tauri::command]
fn load_session_token() -> Result<Option<String>, String> {
    match keyring::Entry::new(SESSION_KEYRING_SERVICE, SESSION_KEYRING_ACCOUNT)
        .map_err(|error| error.to_string())?
        .get_password()
    {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_session_token(token: Option<String>) -> Result<(), String> {
    let entry = keyring::Entry::new(SESSION_KEYRING_SERVICE, SESSION_KEYRING_ACCOUNT)
        .map_err(|error| error.to_string())?;
    match token {
        Some(token) => entry
            .set_password(&token)
            .map_err(|error| error.to_string()),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        },
    }
}

#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to open external URL: {e}"))
}

#[tauri::command]
fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let data_dir = app_data_dir.join("data");

    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {e}"))?;

    let status = if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(data_dir.as_os_str())
            .status()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(data_dir.as_os_str())
            .status()
    } else {
        std::process::Command::new("xdg-open")
            .arg(data_dir.as_os_str())
            .status()
    }
    .map_err(|e| format!("Failed to launch file explorer: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "File explorer exited with status: {}",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ))
    }
}

const BACKUP_FORMAT_VERSION: u32 = 1;
const BACKUP_DB_FILE: &str = "whylowdps-multi-user.db";
const BACKUP_PREFS_FILE: &str = "desktop_prefs.json";
const BACKUP_FRONTEND_FILE: &str = "frontend-preferences.json";
const PENDING_DB_FILE: &str = "whylowdps-restore-pending.db";
const PENDING_PREFS_FILE: &str = "desktop_prefs.restore-pending.json";

#[derive(serde::Serialize, serde::Deserialize)]
struct BackupManifest {
    format_version: u32,
    created_at: String,
    files: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct FrontendPreferencesBackup {
    local_storage: std::collections::BTreeMap<String, String>,
}

fn backup_path(app: &tauri::AppHandle, path: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = path.filter(|value| !value.trim().is_empty()) {
        return Ok(PathBuf::from(path));
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?
        .join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create backup directory: {e}"))?;
    Ok(dir.join(format!(
        "whylowdps-backup-{}.zip",
        chrono::Utc::now().format("%Y%m%d-%H%M%S")
    )))
}

fn add_file_to_zip<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    name: &str,
    path: &Path,
) -> Result<(), String> {
    let mut file = std::fs::File::open(path).map_err(|e| format!("Unable to read {name}: {e}"))?;
    zip.start_file::<_, ()>(name, zip::write::FileOptions::default())
        .map_err(|e| format!("Unable to add {name} to backup: {e}"))?;
    std::io::copy(&mut file, zip).map_err(|e| format!("Unable to write {name}: {e}"))?;
    Ok(())
}

fn create_backup_database(source: &Path, destination: &Path) -> Result<(), String> {
    let source_connection =
        Connection::open(source).map_err(|e| format!("Unable to open database: {e}"))?;
    source_connection
        .backup(MAIN_DB, destination, None)
        .map_err(|e| format!("Unable to snapshot database: {e}"))?;
    drop(source_connection);
    let backup_connection = Connection::open(destination)
        .map_err(|e| format!("Unable to open backup database: {e}"))?;

    let sensitive_keys: Vec<(String, String)> = {
        let mut statement = backup_connection
            .prepare("SELECT user_id, key FROM user_configs")
            .map_err(|e| format!("Unable to inspect backup database: {e}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Unable to inspect backup keys: {e}"))?;
        rows.filter_map(Result::ok)
            .filter(|(_, key)| is_sensitive_backup_key(key))
            .collect()
    };

    for (user_id, key) in sensitive_keys {
        backup_connection
            .execute(
                "DELETE FROM user_configs WHERE user_id = ?1 AND key = ?2",
                rusqlite::params![user_id, key],
            )
            .map_err(|e| format!("Unable to remove sensitive backup data: {e}"))?;
    }
    backup_connection
        .execute("DELETE FROM app_cache", [])
        .map_err(|e| format!("Unable to remove cache data from backup: {e}"))?;
    Ok(())
}

#[tauri::command]
fn export_local_backup(
    app: tauri::AppHandle,
    frontend_preferences: FrontendPreferencesBackup,
    path: Option<String>,
) -> Result<String, String> {
    let output_path = backup_path(&app, path)?;
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Unable to create backup folder: {e}"))?;
    }
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    let db_path = app_data_dir.join(BACKUP_DB_FILE);
    let temp_db = app_data_dir.join("whylowdps-backup-snapshot.db");
    if temp_db.exists() {
        std::fs::remove_file(&temp_db)
            .map_err(|e| format!("Unable to replace temporary snapshot: {e}"))?;
    }
    create_backup_database(&db_path, &temp_db)?;

    let prefs_path = app_data_dir.join(BACKUP_PREFS_FILE);
    let frontend_json = serde_json::to_vec_pretty(&frontend_preferences)
        .map_err(|e| format!("Unable to encode frontend preferences: {e}"))?;
    let file = std::fs::File::create(&output_path)
        .map_err(|e| format!("Unable to create backup archive: {e}"))?;
    let mut zip = ZipWriter::new(file);
    add_file_to_zip(&mut zip, BACKUP_DB_FILE, &temp_db)?;
    let mut files = vec![BACKUP_DB_FILE.to_string(), BACKUP_FRONTEND_FILE.to_string()];
    if prefs_path.exists() {
        files.push(BACKUP_PREFS_FILE.to_string());
    }
    let manifest = BackupManifest {
        format_version: BACKUP_FORMAT_VERSION,
        created_at: chrono::Utc::now().to_rfc3339(),
        files,
    };
    zip.start_file::<_, ()>("manifest.json", zip::write::FileOptions::default())
        .map_err(|e| format!("Unable to write backup manifest: {e}"))?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Unable to write backup manifest: {e}"))?;
    if prefs_path.exists() {
        add_file_to_zip(&mut zip, BACKUP_PREFS_FILE, &prefs_path)?;
    }
    zip.start_file::<_, ()>(BACKUP_FRONTEND_FILE, zip::write::FileOptions::default())
        .map_err(|e| format!("Unable to write frontend preferences: {e}"))?;
    zip.write_all(&frontend_json)
        .map_err(|e| format!("Unable to write frontend preferences: {e}"))?;
    zip.finish()
        .map_err(|e| format!("Unable to finish backup archive: {e}"))?;
    let _ = std::fs::remove_file(temp_db);
    Ok(output_path.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
struct LocalBackupRestoreResult {
    recovery_path: Option<String>,
    frontend_preferences: FrontendPreferencesBackup,
}

fn validate_backup_database(path: &Path) -> Result<(), String> {
    let connection =
        Connection::open(path).map_err(|e| format!("Backup database is invalid: {e}"))?;
    for table in ["jobs", "settings", "dungeon_routes", "character_profiles"] {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                rusqlite::params![table],
                |row| row.get(0),
            )
            .map_err(|e| format!("Unable to validate backup database: {e}"))?;
        if !exists {
            return Err(format!("Backup database is missing the {table} table."));
        }
    }
    Ok(())
}

#[tauri::command]
fn import_local_backup(
    app: tauri::AppHandle,
    path: String,
) -> Result<LocalBackupRestoreResult, String> {
    let source_path = PathBuf::from(path);
    let file =
        std::fs::File::open(&source_path).map_err(|e| format!("Unable to open backup: {e}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Backup is not a valid ZIP archive: {e}"))?;
    let mut manifest_file = archive
        .by_name("manifest.json")
        .map_err(|_| "Backup manifest is missing.".to_string())?;
    let mut manifest_json = String::new();
    manifest_file
        .read_to_string(&mut manifest_json)
        .map_err(|e| format!("Unable to read backup manifest: {e}"))?;
    let manifest: BackupManifest = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("Backup manifest is invalid: {e}"))?;
    if manifest.format_version != BACKUP_FORMAT_VERSION
        || !manifest.files.iter().any(|name| name == BACKUP_DB_FILE)
    {
        return Err(
            "Backup format is unsupported or does not contain simulation data.".to_string(),
        );
    }
    drop(manifest_file);

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    let db_path = app_data_dir.join(BACKUP_DB_FILE);
    let recovery_path = if db_path.exists() {
        let recovery_path = app_data_dir.join(format!(
            "whylowdps-recovery-{}.db",
            chrono::Utc::now().format("%Y%m%d-%H%M%S")
        ));
        std::fs::copy(&db_path, &recovery_path)
            .map_err(|e| format!("Unable to preserve recovery copy: {e}"))?;
        Some(recovery_path)
    } else {
        None
    };
    let temp_db = app_data_dir.join(PENDING_DB_FILE);
    if temp_db.exists() {
        let _ = std::fs::remove_file(&temp_db);
    }
    {
        let mut entry = archive
            .by_name(BACKUP_DB_FILE)
            .map_err(|_| "Backup database is missing.".to_string())?;
        let mut output = std::fs::File::create(&temp_db)
            .map_err(|e| format!("Unable to prepare restore: {e}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|e| format!("Unable to extract backup database: {e}"))?;
    }
    validate_backup_database(&temp_db)?;

    let mut frontend_preferences = FrontendPreferencesBackup {
        local_storage: std::collections::BTreeMap::new(),
    };
    if manifest.files.iter().any(|name| name == BACKUP_PREFS_FILE) {
        let mut entry = archive
            .by_name(BACKUP_PREFS_FILE)
            .map_err(|_| "Backup preferences are missing.".to_string())?;
        let pending_prefs_path = app_data_dir.join(PENDING_PREFS_FILE);
        let mut output = std::fs::File::create(&pending_prefs_path)
            .map_err(|e| format!("Unable to restore desktop preferences: {e}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|e| format!("Unable to restore desktop preferences: {e}"))?;
        let prefs = std::fs::read_to_string(&pending_prefs_path)
            .map_err(|e| format!("Unable to validate desktop preferences: {e}"))?;
        serde_json::from_str::<AppClosePreferences>(&prefs)
            .map_err(|e| format!("Desktop preferences are invalid: {e}"))?;
    }
    if manifest
        .files
        .iter()
        .any(|name| name == BACKUP_FRONTEND_FILE)
    {
        let mut entry = archive
            .by_name(BACKUP_FRONTEND_FILE)
            .map_err(|_| "Frontend preferences are missing.".to_string())?;
        let mut frontend_json = String::new();
        entry
            .read_to_string(&mut frontend_json)
            .map_err(|e| format!("Unable to read frontend preferences: {e}"))?;
        frontend_preferences = serde_json::from_str(&frontend_json)
            .map_err(|e| format!("Frontend preferences are invalid: {e}"))?;
    }
    Ok(LocalBackupRestoreResult {
        recovery_path: recovery_path.map(|path| path.to_string_lossy().to_string()),
        frontend_preferences,
    })
}

fn apply_pending_restore(app_data_dir: &Path) -> Result<(), String> {
    let pending_db = app_data_dir.join(PENDING_DB_FILE);
    if pending_db.exists() {
        let db_path = app_data_dir.join(BACKUP_DB_FILE);
        std::fs::rename(&pending_db, &db_path)
            .map_err(|e| format!("Unable to apply pending database restore: {e}"))?;
    }
    let pending_prefs = app_data_dir.join(PENDING_PREFS_FILE);
    if pending_prefs.exists() {
        let prefs_path = app_data_dir.join(BACKUP_PREFS_FILE);
        std::fs::rename(&pending_prefs, &prefs_path)
            .map_err(|e| format!("Unable to apply pending preferences restore: {e}"))?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct SystemInfo {
    os: String,
    exe_path: String,
    data_dir: String,
    simc_dir: String,
    data_valid: bool,
    simc_valid: bool,
    api_url: String,
    version: String,
}

#[derive(serde::Serialize)]
struct SimcRuntimeStatusResponse {
    channel: String,
    version: String,
    updated: bool,
    simc_path: String,
    readiness: SimcReadiness,
}

#[derive(Clone, serde::Serialize)]
struct SimcRuntimeProgressEvent {
    status: String,
    channel: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    elapsed_ms: u64,
    speed_bytes_per_sec: u64,
    eta_seconds: Option<u64>,
    version: Option<String>,
    updated: Option<bool>,
    message: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct FileImportEvent {
    path: String,
    content: String,
}

#[derive(Clone, serde::Serialize)]
struct SimCompletedEvent {
    id: String,
    status: String,
    sim_type: String,
    player_name: String,
}

fn emit_file_imports(app: &tauri::AppHandle, args: &[String]) {
    for path in importable_file_paths(args) {
        if let Ok(payload) = read_import_file_path(path) {
            let _ = app.emit("whylowdps-file-import", payload);
        }
    }
}

fn read_import_file_path(path: PathBuf) -> Result<FileImportEvent, String> {
    if !is_supported_import_path(&path) {
        return Err("Only .simc, .txt, and .wldps files can be imported.".to_string());
    }
    let metadata = std::fs::metadata(&path).map_err(|e| format!("Unable to inspect file: {e}"))?;
    let max_bytes = if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("wldps"))
        .unwrap_or(false)
    {
        10 * 1024 * 1024
    } else {
        5 * 1024 * 1024
    };
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err(format!(
            "The selected file is missing, not a file, or larger than {} MB.",
            max_bytes / (1024 * 1024)
        ));
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Unable to read file: {e}"))?;
    Ok(FileImportEvent {
        path: path.to_string_lossy().to_string(),
        content,
    })
}

#[tauri::command]
fn read_import_file(path: String) -> Result<FileImportEvent, String> {
    read_import_file_path(PathBuf::from(path))
}

fn schedule_startup_file_imports(app: tauri::AppHandle) {
    let args: Vec<String> = std::env::args().collect();
    if importable_file_paths(&args).is_empty() {
        return;
    }

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1200)).await;
        emit_file_imports(&app, &args);
    });
}

#[tauri::command]
fn get_close_behavior_preference(
    state: tauri::State<'_, AppClosePreferencesState>,
) -> CloseBehaviorPreferenceResponse {
    let minimize_to_tray_on_close = state
        .prefs
        .lock()
        .ok()
        .and_then(|prefs| prefs.minimize_to_tray_on_close);

    CloseBehaviorPreferenceResponse {
        minimize_to_tray_on_close,
    }
}

#[tauri::command]
fn set_close_behavior_preference(
    state: tauri::State<'_, AppClosePreferencesState>,
    minimize_to_tray_on_close: bool,
) -> Result<(), String> {
    set_close_behavior_preference_internal(&state, minimize_to_tray_on_close)
}

#[tauri::command]
fn clear_close_behavior_preference(
    state: tauri::State<'_, AppClosePreferencesState>,
) -> Result<(), String> {
    clear_close_behavior_preference_internal(&state)
}

#[tauri::command]
fn get_light_mode_preference(
    state: tauri::State<'_, AppClosePreferencesState>,
) -> LightModePreferenceResponse {
    let light_mode = state.prefs.lock().ok().and_then(|prefs| prefs.light_mode);
    LightModePreferenceResponse { light_mode }
}

#[tauri::command]
fn set_light_mode_preference(
    state: tauri::State<'_, AppClosePreferencesState>,
    light_mode: bool,
) -> Result<(), String> {
    set_light_mode_preference_internal(&state, light_mode)
}

#[tauri::command]
fn get_discord_presence_settings(
    preferences: tauri::State<'_, AppClosePreferencesState>,
    presence: tauri::State<'_, DiscordPresenceState>,
) -> DiscordPresenceSettingsResponse {
    presence.settings(&preferences)
}

#[tauri::command]
fn set_discord_presence_settings(
    preferences: tauri::State<'_, AppClosePreferencesState>,
    presence: tauri::State<'_, DiscordPresenceState>,
    enabled: bool,
    client_id: Option<String>,
) -> Result<DiscordPresenceSettingsResponse, String> {
    presence.apply_settings(&preferences, enabled, client_id)
}

#[tauri::command]
fn update_discord_presence(
    preferences: tauri::State<'_, AppClosePreferencesState>,
    presence: tauri::State<'_, DiscordPresenceState>,
    update: DiscordPresenceUpdate,
) -> DiscordPresenceSettingsResponse {
    presence.update(&preferences, update)
}

#[tauri::command]
fn get_simc_update_channel(
    state: tauri::State<'_, AppClosePreferencesState>,
) -> SimcUpdateChannelResponse {
    let channel = state
        .prefs
        .lock()
        .ok()
        .and_then(|prefs| prefs.simc_update_channel.clone())
        .unwrap_or_else(|| "weekly".to_string());

    SimcUpdateChannelResponse { channel }
}

#[tauri::command]
fn get_simc_runtime_version(
    state: tauri::State<'_, AppClosePreferencesState>,
) -> SimcRuntimeVersionPreferenceResponse {
    let version = state
        .prefs
        .lock()
        .ok()
        .and_then(|prefs| prefs.simc_runtime_version.clone());

    SimcRuntimeVersionPreferenceResponse { version }
}

#[tauri::command]
fn set_simc_update_channel(
    state: tauri::State<'_, AppClosePreferencesState>,
    channel: String,
) -> Result<SimcUpdateChannelResponse, String> {
    let channel = set_simc_update_channel_internal(&state, &channel)?;
    Ok(SimcUpdateChannelResponse { channel })
}

#[tauri::command]
fn set_simc_runtime_version(
    state: tauri::State<'_, AppClosePreferencesState>,
    version: Option<String>,
) -> Result<SimcRuntimeVersionPreferenceResponse, String> {
    let version = set_simc_runtime_version_internal(&state, version.as_deref())?;
    Ok(SimcRuntimeVersionPreferenceResponse { version })
}

#[tauri::command]
async fn update_simc_runtime(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppClosePreferencesState>,
    channel: String,
    version: Option<String>,
) -> Result<SimcRuntimeStatusResponse, String> {
    let _runtime_guard = state.simc_runtime.update_lock.lock().await;
    state.simc_runtime.set_readiness(SimcReadiness::Downloading);
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let parsed_channel = SimcChannel::parse(&channel);
    let channel = parsed_channel.as_str().to_string();
    let release_tag = version.and_then(|value| normalize_simc_runtime_version(&value));
    let config = SimcRuntimeConfig::new(parsed_channel, app_data_dir.join("simc"))
        .with_release_tag(release_tag.clone());
    let _ = app.emit(
        "whylowdps-simc-runtime-progress",
        SimcRuntimeProgressEvent {
            status: "started".to_string(),
            channel: channel.clone(),
            downloaded_bytes: 0,
            total_bytes: None,
            elapsed_ms: 0,
            speed_bytes_per_sec: 0,
            eta_seconds: None,
            version: None,
            updated: None,
            message: Some(match release_tag.as_deref() {
                Some(version) => format!("Checking SimC runtime {version}..."),
                None => format!("Checking {channel} SimC runtime..."),
            }),
        },
    );
    let progress_app = app.clone();
    let progress_channel = channel.clone();
    let resolution = match resolve_simc_runtime_with_progress(&config, move |progress| {
        let _ = progress_app.emit(
            "whylowdps-simc-runtime-progress",
            SimcRuntimeProgressEvent {
                status: "progress".to_string(),
                channel: progress_channel.clone(),
                downloaded_bytes: progress.downloaded_bytes,
                total_bytes: progress.total_bytes,
                elapsed_ms: progress.elapsed_ms,
                speed_bytes_per_sec: progress.speed_bytes_per_sec,
                eta_seconds: progress.eta_seconds,
                version: None,
                updated: None,
                message: None,
            },
        );
    })
    .await
    {
        Ok(resolution) => resolution,
        Err(err) => {
            let _ = app.emit(
                "whylowdps-simc-runtime-progress",
                SimcRuntimeProgressEvent {
                    status: "error".to_string(),
                    channel,
                    downloaded_bytes: 0,
                    total_bytes: None,
                    elapsed_ms: 0,
                    speed_bytes_per_sec: 0,
                    eta_seconds: None,
                    version: None,
                    updated: None,
                    message: Some(err.clone()),
                },
            );
            state.simc_runtime.set_readiness(SimcReadiness::Failed);
            return Err(err);
        }
    };
    state.simc_runtime.set_readiness(SimcReadiness::Ready);
    let _ = app.emit(
        "whylowdps-simc-runtime-progress",
        SimcRuntimeProgressEvent {
            status: "finished".to_string(),
            channel: resolution.channel.clone(),
            downloaded_bytes: 0,
            total_bytes: None,
            elapsed_ms: 0,
            speed_bytes_per_sec: 0,
            eta_seconds: None,
            version: Some(resolution.version.clone()),
            updated: Some(resolution.updated),
            message: Some(if resolution.updated {
                format!("SimC {} runtime downloaded.", resolution.channel)
            } else {
                format!("SimC {} runtime is already up to date.", resolution.channel)
            }),
        },
    );

    Ok(SimcRuntimeStatusResponse {
        channel: resolution.channel,
        version: resolution.version,
        updated: resolution.updated,
        simc_path: resolution.simc_path.to_string_lossy().to_string(),
        readiness: state.simc_runtime.readiness(),
    })
}

#[tauri::command]
fn get_simc_runtime_status(state: tauri::State<'_, AppClosePreferencesState>) -> SimcReadiness {
    state.simc_runtime.readiness()
}

#[tauri::command]
fn apply_close_behavior_choice(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppClosePreferencesState>,
    minimize_to_tray_on_close: bool,
) -> Result<(), String> {
    set_close_behavior_preference_internal(&state, minimize_to_tray_on_close)?;

    if minimize_to_tray_on_close {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    } else {
        app.exit(0);
    }

    Ok(())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

#[derive(Clone, serde::Serialize)]
struct LanAccessInfo {
    enabled: bool,
    restart_required: bool,
    addresses: Vec<String>,
}

fn detected_private_ipv4() -> Vec<String> {
    let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else {
        return Vec::new();
    };

    // Connecting a UDP socket selects the route without sending a packet. The
    // selected local address is the address another device on the LAN should use.
    let _ = socket.connect("192.0.2.1:80");
    let Some(IpAddr::V4(address)) = socket.local_addr().ok().map(|value| value.ip()) else {
        return Vec::new();
    };

    if address.is_loopback() || address.is_unspecified() || !address.is_private() {
        return Vec::new();
    }

    vec![address.to_string()]
}

#[tauri::command]
fn get_lan_access_info(state: tauri::State<'_, AppClosePreferencesState>) -> LanAccessInfo {
    let enabled = state
        .prefs
        .lock()
        .map(|prefs| prefs.lan_sharing_enabled)
        .unwrap_or(false);

    LanAccessInfo {
        enabled,
        restart_required: enabled != state.lan_sharing_runtime_enabled,
        addresses: detected_private_ipv4(),
    }
}

#[tauri::command]
fn set_lan_sharing_enabled(
    state: tauri::State<'_, AppClosePreferencesState>,
    enabled: bool,
) -> Result<(), String> {
    set_lan_sharing_enabled_internal(&state, enabled)
}

#[tauri::command]
fn quit_app_now(app: tauri::AppHandle) {
    app.exit(0);
}

#[derive(Clone, serde::Serialize)]
struct DirectInstallProgressEvent {
    status: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    message: Option<String>,
}

#[tauri::command]
async fn download_and_install_release(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed_url = url::Url::parse(&url).map_err(|e| format!("Invalid update URL: {e}"))?;
    let filename = installer_filename_from_url(&url)?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let updates_dir = app_data_dir.join("updates");

    std::fs::create_dir_all(&updates_dir)
        .map_err(|e| format!("Failed to create updates dir: {e}"))?;

    let installer_path = updates_dir.join(filename);

    let client = reqwest::Client::new();

    let mut response = client
        .get(parsed_url)
        .send()
        .await
        .map_err(|e| format!("Update download request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Update download failed: {e}"))?;

    let total_bytes = response.content_length();

    let _ = app.emit(
        "whylowdps-direct-install-progress",
        DirectInstallProgressEvent {
            status: "started".to_string(),
            downloaded_bytes: 0,
            total_bytes,
            message: Some("Downloading installer...".to_string()),
        },
    );

    let mut file = tokio::fs::File::create(&installer_path)
        .await
        .map_err(|e| format!("Failed to create installer file: {e}"))?;

    let mut downloaded_bytes: u64 = 0;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed while downloading installer: {e}"))?
    {
        downloaded_bytes += chunk.len() as u64;

        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed while writing installer file: {e}"))?;

        let _ = app.emit(
            "whylowdps-direct-install-progress",
            DirectInstallProgressEvent {
                status: "progress".to_string(),
                downloaded_bytes,
                total_bytes,
                message: None,
            },
        );
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to finalize installer file: {e}"))?;

    // Important on Windows: close file handle before launching the installer.
    drop(file);

    let _ = app.emit(
        "whylowdps-direct-install-progress",
        DirectInstallProgressEvent {
            status: "finished".to_string(),
            downloaded_bytes,
            total_bytes,
            message: Some("Installer downloaded. Launching installer...".to_string()),
        },
    );

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    std::process::Command::new(&installer_path)
        .spawn()
        .map_err(|e| format!("Failed to launch installer: {e}"))?;

    // Give the UI thread a tiny window to process the "finished" event, then exit cleanly.
    tokio::time::sleep(Duration::from_millis(150)).await;

    app.exit(0);

    Ok(())
}

async fn run_sim_notification_watcher(
    notifier_handle: tauri::AppHandle,
    mut rx: mpsc::UnboundedReceiver<SimWatcherCommand>,
) {
    let client = reqwest::Client::new();

    let mut tracked_active: std::collections::HashMap<String, SimWatcherMeta> =
        std::collections::HashMap::new();

    let mut notified_sims: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Startup scan: attach to pre-existing active sims.
    for _ in 0..30 {
        let scan = client
            .get("http://127.0.0.1:17384/api/sims")
            .send()
            .await
            .and_then(|response| response.error_for_status());

        if let Ok(response) = scan {
            if let Ok(sims) = response.json::<Vec<SimNotificationSummary>>().await {
                for sim in sims {
                    if is_active_status(&sim.status) {
                        tracked_active.insert(sim.id.clone(), SimWatcherMeta::from_summary(&sim));
                    } else if is_terminal_status(&sim.status) {
                        notified_sims.insert(sim.id);
                    }
                }

                break;
            }
        }

        tokio::time::sleep(Duration::from_secs(2)).await;
    }

    loop {
        while let Ok(command) = rx.try_recv() {
            match command {
                SimWatcherCommand::Track(items) => {
                    handle_track_command(items, &mut tracked_active, &mut notified_sims);
                }
            }
        }

        if tracked_active.is_empty() {
            let Some(command) = rx.recv().await else {
                break;
            };

            match command {
                SimWatcherCommand::Track(items) => {
                    handle_track_command(items, &mut tracked_active, &mut notified_sims);
                }
            }

            continue;
        }

        tokio::select! {
            command = rx.recv() => {
                let Some(command) = command else {
                    break;
                };

                match command {
                    SimWatcherCommand::Track(items) => {
                        handle_track_command(items, &mut tracked_active, &mut notified_sims);
                    }
                }
            }

            _ = tokio::time::sleep(Duration::from_secs(5)) => {
                let ids: Vec<String> = tracked_active.keys().cloned().collect();

                for id in ids {
                    let status_url = format!("http://127.0.0.1:17384/api/sim/{id}");

                    let status_response = client
                        .get(&status_url)
                        .send()
                        .await
                        .and_then(|response| response.error_for_status());

                    let Ok(response) = status_response else {
                        continue;
                    };

                    let Ok(status) = response.json::<SimStatusResponse>().await else {
                        continue;
                    };

                    if is_active_status(&status.status) {
                        continue;
                    }

                    if !is_terminal_status(&status.status) {
                        continue;
                    }

                    let meta = tracked_active.remove(&id).unwrap_or(SimWatcherMeta {
                        sim_type: status.sim_type.clone(),
                        player_name: None,
                        linked_name: None,
                    });

                    if notified_sims.contains(&id) {
                        continue;
                    }

                    let body = build_sim_notification_body(&status, &meta);
                    let sim_type = resolve_notification_sim_type(&status, &meta).to_string();
                    let player_name = resolve_notification_player(&status, &meta);

                    let _ = notifier_handle.emit(
                        "whylowdps-sim-completed",
                        SimCompletedEvent {
                            id: id.clone(),
                            status: status.status.clone(),
                            sim_type,
                            player_name,
                        },
                    );

                    let _ = notifier_handle
                        .notification()
                        .builder()
                        .title(notification_title(&status.status))
                        .body(body)
                        .show();

                    notified_sims.insert(id);
                }
            }
        }
    }
}

#[tauri::command]
async fn get_system_info(app: tauri::AppHandle) -> Result<SystemInfo, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("./"));

    let data_dir = app_data_dir.join("data");

    let simc_dir = app_data_dir.join("simc");

    let classes_json = data_dir.join("classes.json");
    let simc_exe = simc_dir.join(simc_binary_name());

    Ok(SystemInfo {
        os: std::env::consts::OS.to_string(),
        exe_path: std::env::current_exe()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|_| "Unknown".to_string()),
        data_dir: data_dir.to_string_lossy().to_string(),
        simc_dir: simc_dir.to_string_lossy().to_string(),
        data_valid: classes_json.exists(),
        simc_valid: simc_exe.exists(),
        api_url: "http://localhost:17384".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

fn main() {
    enable_high_dpi_awareness();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            emit_file_imports(app, &argv);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            open_auth_window,
            load_session_token,
            save_session_token,
            open_external_url,
            open_data_dir,
            read_import_file,
            export_local_backup,
            import_local_backup,
            get_system_info,
            get_close_behavior_preference,
            set_close_behavior_preference,
            clear_close_behavior_preference,
            get_light_mode_preference,
            set_light_mode_preference,
            get_simc_update_channel,
            set_simc_update_channel,
            get_simc_runtime_version,
            set_simc_runtime_version,
            update_simc_runtime,
            get_simc_runtime_status,
            get_discord_presence_settings,
            set_discord_presence_settings,
            update_discord_presence,
            apply_close_behavior_choice,
            restart_app,
            get_lan_access_info,
            set_lan_sharing_enabled,
            quit_app_now,
            download_and_install_release
        ])
        .setup(|app| {
            install_session_encryption_key()
                .map_err(|error| format!("Failed to initialize session encryption: {error}"))?;
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("./"));

            if !app_data_dir.exists() {
                let _ = std::fs::create_dir_all(&app_data_dir);
            }

            if let Err(error) = apply_pending_restore(&app_data_dir) {
                eprintln!("Failed to apply pending local restore: {error}");
            }

            let close_prefs_path = app_data_dir.join("desktop_prefs.json");
            let close_prefs = load_close_preferences(&close_prefs_path);
            let lan_sharing_enabled = close_prefs.lan_sharing_enabled;
            let simc_channel = close_prefs
                .simc_update_channel
                .clone()
                .unwrap_or_else(|| "weekly".to_string());
            let simc_runtime_version = close_prefs.simc_runtime_version.clone();

            app.manage(AppClosePreferencesState {
                prefs: std::sync::Mutex::new(close_prefs),
                path: close_prefs_path,
                lan_sharing_runtime_enabled: lan_sharing_enabled,
                simc_runtime: SimcRuntimeCoordinator::new(SimcReadiness::Missing),
            });
            app.manage(DiscordPresenceState::default());

            let app_handle = app.handle().clone();
            let notifier_handle = app_handle.clone();
            schedule_startup_file_imports(app_handle.clone());

            let show_item = MenuItemBuilder::with_id("show_app", "Show WhyLowDps").build(app)?;
            let dashboard_item =
                MenuItemBuilder::with_id("open_dashboard", "Dashboard").build(app)?;
            let quick_sim_item = MenuItemBuilder::with_id("quick_sim", "Quick Sim").build(app)?;
            let top_gear_item = MenuItemBuilder::with_id("top_gear", "Top Gear").build(app)?;
            let drop_finder_item =
                MenuItemBuilder::with_id("drop_finder", "Drop Finder").build(app)?;
            let dungeons_item = MenuItemBuilder::with_id("dungeons", "Dungeons").build(app)?;
            let history_item =
                MenuItemBuilder::with_id("history", "Simulation History").build(app)?;
            let settings_item = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
            let check_updates_item =
                MenuItemBuilder::with_id("check_updates", "Check for Updates").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit_app", "Quit WhyLowDps").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&dashboard_item)
                .item(&quick_sim_item)
                .item(&top_gear_item)
                .item(&drop_finder_item)
                .item(&dungeons_item)
                .item(&history_item)
                .item(&settings_item)
                .separator()
                .item(&check_updates_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&tray_menu)
                .tooltip("WhyLowDps")
                .show_menu_on_left_click(false)
                .on_menu_event(
                    move |app: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
                        let focus_main_window =
                            |app: &tauri::AppHandle| -> Option<tauri::WebviewWindow> {
                                let window = app.get_webview_window("main")?;
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                Some(window)
                            };

                        match tray_menu_action(event.id().as_ref()) {
                            TrayMenuAction::ShowApp => {
                                let _ = focus_main_window(app);
                            }
                            TrayMenuAction::Navigate(route) => {
                                if let Some(window) = focus_main_window(app) {
                                    let _ = window.eval(navigation_script(route));
                                }
                            }
                            TrayMenuAction::CheckUpdates => {
                                if let Some(window) = focus_main_window(app) {
                                    let _ = window.eval(updater_check_script());
                                }
                            }
                            TrayMenuAction::Quit => {
                                app.exit(0);
                            }
                            TrayMenuAction::Ignore => {}
                        }
                    },
                )
                .on_tray_icon_event(move |tray: &tauri::tray::TrayIcon, event: TrayIconEvent| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder.build(app)?;

            // Force-apply bundled icon on startup so native window chrome does not keep
            // showing stale/cached icon resources.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);

                if let Some(icon) = app.default_window_icon().cloned() {
                    let _ = window.set_icon(icon);
                }
            }

            let (sim_watcher_tx_for_events, sim_watcher_rx) =
                mpsc::unbounded_channel::<SimWatcherCommand>();

            app.listen("whylowdps-track-sims", move |event| {
                if let TrackSimsPayloadParseResult::Track(sims) =
                    parse_track_sims_payload(event.payload())
                {
                    let _ = sim_watcher_tx_for_events.send(SimWatcherCommand::Track(sims));
                }
            });

            tauri::async_runtime::spawn(run_sim_notification_watcher(
                notifier_handle,
                sim_watcher_rx,
            ));

            let resolve_bundled_resource = |path: &str, dev_fallback: &str| {
                app_handle
                    .path()
                    .resolve(path, BaseDirectory::Resource)
                    .unwrap_or_else(|_| PathBuf::from(dev_fallback))
            };

            let bundled_data_dir = resolve_bundled_resource("data", "../../backend/resources/data");
            let bundled_wow_dir =
                resolve_bundled_resource("data/wow", "../../backend/resources/wow");
            let bundled_frontend_dir = lan_sharing_enabled
                .then(|| resolve_bundled_resource("frontend", "../../frontend/out"));

            println!("Resolved bundled_data_dir: {:?}", bundled_data_dir);
            println!("Resolved bundled_wow_dir: {:?}", bundled_wow_dir);
            if let Some(frontend_dir) = &bundled_frontend_dir {
                println!("Resolved bundled_frontend_dir: {:?}", frontend_dir);
            }

            let app_data_dir = app_handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("./"));

            if !app_data_dir.exists() {
                let _ = std::fs::create_dir_all(&app_data_dir);
            }

            let data_dir = app_data_dir.join("data");

            if !data_dir.exists() {
                let _ = std::fs::create_dir_all(&data_dir);
            }

            seed_runtime_data_if_missing(&bundled_data_dir, &data_dir);
            seed_runtime_data_if_missing(&bundled_wow_dir, &data_dir.join("wow"));

            let simc_dir = app_data_dir.join("simc");
            let simc_bin = simc_dir.join(simc_binary_name());

            let db_path = app_data_dir.join(BACKUP_DB_FILE);
            let db_path_str = db_path.to_string_lossy().to_string();

            let simc_runtime = app.state::<AppClosePreferencesState>().simc_runtime.clone();
            tauri::async_runtime::spawn({
                let simc_dir = simc_dir.clone();
                let simc_channel = simc_channel.clone();
                let simc_runtime_version = simc_runtime_version.clone();
                let simc_bin = simc_bin.clone();
                let app_handle = app_handle.clone();
                let bundled_frontend_dir = bundled_frontend_dir.clone();
                async move {
                    let _runtime_guard = simc_runtime.update_lock.lock().await;
                    simc_runtime.set_readiness(SimcReadiness::Downloading);
                    let simc_config =
                        SimcRuntimeConfig::new(SimcChannel::parse(&simc_channel), simc_dir)
                            .with_release_tag(simc_runtime_version);
                    let resolved_simc = match resolve_simc_runtime(&simc_config).await {
                        Ok(resolution) => {
                            simc_runtime.set_readiness(SimcReadiness::Ready);
                            println!(
                                "Using SimC {} channel version {} at {:?}",
                                resolution.channel, resolution.version, resolution.simc_path
                            );
                            resolution.simc_path
                        }
                        Err(err) => {
                            simc_runtime.set_readiness(SimcReadiness::Failed);
                            eprintln!("Failed to update SimC runtime: {err}");
                            let _ = app_handle.emit(
                                "whylowdps-simc-runtime-progress",
                                SimcRuntimeProgressEvent {
                                    status: "error".to_string(),
                                    channel: simc_channel,
                                    downloaded_bytes: 0,
                                    total_bytes: None,
                                    elapsed_ms: 0,
                                    speed_bytes_per_sec: 0,
                                    eta_seconds: None,
                                    version: None,
                                    updated: None,
                                    message: Some(err),
                                },
                            );
                            simc_bin
                        }
                    };

                    println!("Loading game data from {:?}", data_dir);
                    game_data::load(&data_dir);

                    println!("Using SQLite database at {}", db_path_str);

                    let storage: Arc<dyn JobStorage> = Arc::new(SqliteStorage::new(&db_path_str));

                    let bind_host = if lan_sharing_enabled {
                        "0.0.0.0"
                    } else {
                        "127.0.0.1"
                    };
                    let security = server::ServerSecurityOptions {
                        lan_pairing: lan_sharing_enabled,
                    };
                    let (server, _actual_port) = server::start_with_storage_bind_options(
                        storage,
                        resolved_simc,
                        bind_host,
                        17384,
                        bundled_frontend_dir,
                        Some(data_dir),
                        security,
                    )
                    .await;

                    server.await.expect("Server error");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppClosePreferencesState>();

                let close_behavior = state
                    .prefs
                    .lock()
                    .ok()
                    .and_then(|prefs| prefs.minimize_to_tray_on_close);

                match resolve_main_window_close_action(close_behavior) {
                    MainWindowCloseAction::HideToTray => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    MainWindowCloseAction::CloseNaturally => {
                        // Let the window close naturally.
                    }
                    MainWindowCloseAction::AskUser => {
                        api.prevent_close();
                        let _ = window.emit("whylowdps-close-choice-requested", ());
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
