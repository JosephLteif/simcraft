use rusqlite::{params, Connection};
use std::sync::Mutex;

use super::JobStorage;
use crate::models::{
    extract_result_summary, AppUser, Job, JobStatus, JobSummary, SavedCharacterProfile, SavedRoute,
};

pub struct SqliteStorage {
    conn: Mutex<Connection>,
    max_jobs: Mutex<usize>,
    max_parallel_jobs: Mutex<usize>,
}

impl SqliteStorage {
    pub fn new(path: &str) -> Self {
        let mut conn = Connection::open(path).expect("Failed to open SQLite database");
        conn.pragma_update(None, "foreign_keys", "ON")
            .expect("Failed to enable SQLite foreign keys");
        conn.pragma_update(None, "journal_mode", "WAL")
            .expect("Failed to enable SQLite WAL mode");
        initialize_schema(&mut conn).expect("Failed to initialize SQLite schema");

        let max_jobs = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'max_jobs'",
                [],
                |row| {
                    let s: String = row.get(0)?;
                    Ok(s.parse::<usize>().unwrap_or(*super::MAX_JOBS))
                },
            )
            .unwrap_or(*super::MAX_JOBS);

        let max_parallel_jobs = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'max_parallel_jobs'",
                [],
                |row| {
                    let s: String = row.get(0)?;
                    Ok(s.parse::<usize>()
                        .unwrap_or(*super::MAX_PARALLEL_JOBS)
                        .max(1))
                },
            )
            .unwrap_or(*super::MAX_PARALLEL_JOBS);

        Self {
            conn: Mutex::new(conn),
            max_jobs: Mutex::new(max_jobs),
            max_parallel_jobs: Mutex::new(max_parallel_jobs),
        }
    }
}

const SQLITE_SCHEMA_VERSION: i64 = 3;

fn initialize_schema(conn: &mut Connection) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let current_version: i64 = tx.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                sim_type TEXT NOT NULL,
                simc_input TEXT NOT NULL,
                options TEXT,
                result_json TEXT,
                combo_metadata_json TEXT,
                error_message TEXT,
                progress_pct INTEGER NOT NULL DEFAULT 0,
                progress_stage TEXT,
                progress_detail TEXT,
                stages_completed TEXT NOT NULL DEFAULT '[]',
                stage_timings TEXT NOT NULL DEFAULT '[]',
                active_stage_elapsed REAL NOT NULL DEFAULT 0,
                active_stage_started_at TEXT,
                iterations INTEGER NOT NULL,
                fight_style TEXT NOT NULL,
                target_error REAL NOT NULL,
                created_at TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_cache (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_configs (
                user_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (user_id, key)
            );
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                provider_subject TEXT UNIQUE,
                battletag TEXT NOT NULL COLLATE NOCASE UNIQUE,
                role TEXT NOT NULL DEFAULT 'member',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                last_login_at TEXT
            );
            CREATE TABLE IF NOT EXISTS auth_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                encrypted_access_token TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS dungeon_routes (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                name TEXT NOT NULL,
                dungeon TEXT NOT NULL,
                level INTEGER,
                pull_count INTEGER,
                timer_seconds INTEGER,
                affixes TEXT,
                route_data TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS character_profiles (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                name TEXT NOT NULL,
                realm TEXT NOT NULL,
                region TEXT NOT NULL,
                class TEXT,
                spec TEXT,
                simc_input TEXT NOT NULL,
                created_at TEXT NOT NULL
            );",
    )?;

    if current_version < SQLITE_SCHEMA_VERSION {
        for (table, column, definition) in [
            ("jobs", "html_report", "TEXT"),
            ("jobs", "text_output", "TEXT"),
            ("jobs", "raw_json", "TEXT"),
            ("jobs", "options", "TEXT"),
            ("jobs", "batch_id", "TEXT"),
            ("jobs", "linked_region", "TEXT"),
            ("jobs", "linked_realm", "TEXT"),
            ("jobs", "linked_name", "TEXT"),
            ("jobs", "pinned", "INTEGER NOT NULL DEFAULT 0"),
            ("jobs", "stage_timings", "TEXT NOT NULL DEFAULT '[]'"),
            ("jobs", "active_stage_elapsed", "REAL NOT NULL DEFAULT 0"),
            ("jobs", "active_stage_started_at", "TEXT"),
            ("dungeon_routes", "level", "INTEGER"),
            ("dungeon_routes", "pull_count", "INTEGER"),
            ("dungeon_routes", "timer_seconds", "INTEGER"),
            ("dungeon_routes", "affixes", "TEXT"),
            ("jobs", "owner_id", "TEXT NOT NULL DEFAULT 'local-guest'"),
            (
                "dungeon_routes",
                "owner_id",
                "TEXT NOT NULL DEFAULT 'local-guest'",
            ),
            (
                "character_profiles",
                "owner_id",
                "TEXT NOT NULL DEFAULT 'local-guest'",
            ),
        ] {
            let mut columns = tx.prepare(&format!("PRAGMA table_info({table})"))?;
            let exists = columns
                .query_map([], |row| row.get::<_, String>(1))?
                .any(|column_name| column_name.as_deref() == Ok(column));
            drop(columns);
            if !exists {
                tx.execute_batch(&format!(
                    "ALTER TABLE {table} ADD COLUMN {column} {definition};"
                ))?;
            }
        }
    }

    tx.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
         CREATE INDEX IF NOT EXISTS idx_jobs_owner_created_at ON jobs(owner_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_routes_owner_created_at ON dungeon_routes(owner_id, created_at DESC);
         CREATE INDEX IF NOT EXISTS idx_profiles_owner_created_at ON character_profiles(owner_id, created_at DESC);",
    )?;

    tx.pragma_update(None, "user_version", SQLITE_SCHEMA_VERSION)?;
    tx.commit()
}

impl SqliteStorage {
    fn status_to_str(status: &JobStatus) -> &'static str {
        match status {
            JobStatus::Pending => "pending",
            JobStatus::Running => "running",
            JobStatus::Paused => "paused",
            JobStatus::Done => "done",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
        }
    }

    fn str_to_status(s: &str) -> JobStatus {
        match s {
            "running" => JobStatus::Running,
            "paused" => JobStatus::Paused,
            "done" => JobStatus::Done,
            "failed" => JobStatus::Failed,
            "cancelled" => JobStatus::Cancelled,
            _ => JobStatus::Pending,
        }
    }

    fn row_to_job(row: &rusqlite::Row) -> rusqlite::Result<Job> {
        let status_str: String = row.get(1)?;
        let stages_str: String = row.get(11)?;
        let stages: Vec<String> = serde_json::from_str(&stages_str).unwrap_or_default();
        let stage_timings_str: String = row.get(25).unwrap_or_else(|_| "[]".to_string());
        let stage_timings = serde_json::from_str(&stage_timings_str).unwrap_or_default();
        let active_stage_elapsed = row.get(26).unwrap_or(0.0);
        let active_stage_started_at = row.get(27).ok().flatten();
        let options_json: Option<String> = row.get(4)?;
        let options = options_json.and_then(|s| serde_json::from_str(&s).ok());

        Ok(Job {
            id: row.get(0)?,
            owner_id: row.get(24).unwrap_or_else(|_| "local-guest".to_string()),
            status: SqliteStorage::str_to_status(&status_str),
            sim_type: row.get(2)?,
            simc_input: row.get(3)?,
            options,
            result_json: row.get(5)?,
            combo_metadata_json: row.get(6)?,
            error_message: row.get(7)?,
            progress_pct: row.get::<_, u8>(8)?,
            progress_stage: row.get(9)?,
            progress_detail: row.get(10)?,
            stages_completed: stages,
            stage_timings,
            active_stage_elapsed,
            active_stage_started_at,
            iterations: row.get::<_, u32>(12)?,
            fight_style: row.get(13)?,
            target_error: row.get(14)?,
            created_at: row.get(15)?,
            raw_json: row.get(16).ok().flatten(),
            html_report: row.get(17).ok().flatten(),
            text_output: row.get(18).ok().flatten(),
            batch_id: row.get(19).ok().flatten(),
            linked_region: row.get(20).ok().flatten(),
            linked_realm: row.get(21).ok().flatten(),
            linked_name: row.get(22).ok().flatten(),
            pinned: row.get::<_, i64>(23).unwrap_or(0) != 0,
        })
    }
}

impl JobStorage for SqliteStorage {
    fn insert(&self, job: Job) {
        let conn = self.conn.lock().unwrap();
        let owner_id = job.owner_id.clone();
        let stages_json = serde_json::to_string(&job.stages_completed).unwrap();
        let options_json = job
            .options
            .as_ref()
            .map(|o| serde_json::to_string(o).unwrap());
        conn.execute(
            "INSERT INTO jobs (id, status, sim_type, simc_input, options, result_json, combo_metadata_json,
             error_message, progress_pct, progress_stage, progress_detail, stages_completed,
             iterations, fight_style, target_error, created_at, batch_id, raw_json, html_report, text_output, linked_region, linked_realm, linked_name, pinned, owner_id,
             stage_timings, active_stage_elapsed, active_stage_started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28)",
            params![
                job.id,
                Self::status_to_str(&job.status),
                job.sim_type,
                job.simc_input,
                options_json,
                job.result_json,
                job.combo_metadata_json,
                job.error_message,
                job.progress_pct,
                job.progress_stage,
                job.progress_detail,
                stages_json,
                job.iterations,
                job.fight_style,
                job.target_error,
                job.created_at,
                job.batch_id,
                job.raw_json,
                job.html_report,
                job.text_output,
                job.linked_region,
                job.linked_realm,
                job.linked_name,
                if job.pinned { 1 } else { 0 },
                owner_id,
                serde_json::to_string(&job.stage_timings).unwrap(),
                job.active_stage_elapsed,
                job.active_stage_started_at,
            ],
        )
        .expect("Failed to insert job");

        // Garbage collect oldest jobs beyond limit
        let limit = *self.max_jobs.lock().unwrap();
        conn.execute(
            "DELETE FROM jobs WHERE owner_id = ?1 AND pinned = 0 AND id NOT IN (SELECT id FROM jobs WHERE owner_id = ?1 AND pinned = 0 ORDER BY created_at DESC LIMIT ?2)",
            params![job.owner_id, limit as u32],
        ).ok();
    }

    fn get(&self, id: &str) -> Option<Job> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, status, sim_type, simc_input, options, result_json, combo_metadata_json,
             error_message, progress_pct, progress_stage, progress_detail, stages_completed,
             iterations, fight_style, target_error, created_at, raw_json, html_report, text_output, batch_id, linked_region, linked_realm, linked_name, pinned, owner_id,
             stage_timings, active_stage_elapsed, active_stage_started_at
             FROM jobs WHERE id = ?1",
            params![id],
            Self::row_to_job,
        )
        .ok()
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
        let conn = self.conn.lock().unwrap();
        let fetch_limit = if player.is_some() || realm.is_some() {
            std::cmp::max(200, limit) as u32
        } else {
            limit as u32
        };
        let mut stmt = conn.prepare(
            "SELECT id, status, sim_type, created_at, fight_style, iterations, error_message, result_json, simc_input, batch_id,
             raw_json, html_report, text_output, combo_metadata_json, linked_region, linked_realm, linked_name, pinned
             FROM jobs WHERE owner_id = ?1 ORDER BY created_at DESC LIMIT ?2"
        ).unwrap();
        let all: Vec<JobSummary> = stmt
            .query_map(params![owner_id, fetch_limit], |row| {
                let status_str: String = row.get(1)?;
                let result_json: Option<String> = row.get(7)?;
                let simc_input: String = row.get::<_, String>(8).unwrap_or_default();
                let s = extract_result_summary(&result_json, &simc_input);

                let mut size_bytes = simc_input.len() as u64;
                size_bytes += result_json.as_ref().map(|s| s.len()).unwrap_or(0) as u64;
                size_bytes += row
                    .get::<_, Option<String>>(10)?
                    .as_ref()
                    .map(|s| s.len())
                    .unwrap_or(0) as u64;
                size_bytes += row
                    .get::<_, Option<String>>(11)?
                    .as_ref()
                    .map(|s| s.len())
                    .unwrap_or(0) as u64;
                size_bytes += row
                    .get::<_, Option<String>>(12)?
                    .as_ref()
                    .map(|s| s.len())
                    .unwrap_or(0) as u64;
                size_bytes += row
                    .get::<_, Option<String>>(13)?
                    .as_ref()
                    .map(|s| s.len())
                    .unwrap_or(0) as u64;

                let linked_region: Option<String> = row.get(14).ok().flatten();
                let linked_realm: Option<String> = row.get(15).ok().flatten();
                let linked_name: Option<String> = row.get(16).ok().flatten();
                let pinned = row.get::<_, i64>(17).unwrap_or(0) != 0;

                Ok(JobSummary {
                    id: row.get(0)?,
                    status: Self::str_to_status(&status_str),
                    sim_type: row.get(2)?,
                    created_at: row.get(3)?,
                    fight_style: row.get(4)?,
                    iterations: row.get::<_, u32>(5)?,
                    error_message: row.get(6)?,
                    player_name: linked_name.clone().or_else(|| s.player_name.clone()),
                    player_class: s.player_class,
                    realm: linked_realm.clone().or_else(|| s.realm.clone()),
                    dps: s.dps,
                    batch_id: row.get(9).ok().flatten(),
                    size_bytes,
                    upgrades: s.upgrades,
                    downgrades: s.downgrades,
                    linked_region,
                    linked_realm,
                    linked_name,
                    pinned,
                })
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        if player.is_none() && realm.is_none() && !unlinked_only && !pinned_only {
            return all;
        }
        all.into_iter()
            .filter(|j| {
                if unlinked_only
                    && (j.linked_name.is_some()
                        || j.linked_realm.is_some()
                        || j.linked_region.is_some())
                {
                    return false;
                }
                if pinned_only && !j.pinned {
                    return false;
                }

                if linked_only {
                    if let Some(p) = player {
                        if j.linked_name.as_deref() != Some(p) {
                            return false;
                        }
                    }
                    if let Some(r) = realm {
                        if j.linked_realm.as_deref() != Some(r) {
                            return false;
                        }
                    }
                } else {
                    if let Some(p) = player {
                        if j.player_name.as_deref() != Some(p) {
                            return false;
                        }
                    }
                    if let Some(r) = realm {
                        if j.realm.as_deref() != Some(r) {
                            return false;
                        }
                    }
                }
                true
            })
            .take(limit)
            .collect()
    }

    fn update_status(&self, id: &str, status: JobStatus) {
        let Some(mut job) = self.get(id) else {
            return;
        };
        let from = job.status.clone();
        job.transition_stage_timing(&from, &status);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET status = ?1, stage_timings = ?2, active_stage_elapsed = ?3, active_stage_started_at = ?4 WHERE id = ?5",
            params![
                Self::status_to_str(&status),
                serde_json::to_string(&job.stage_timings).unwrap(),
                job.active_stage_elapsed,
                job.active_stage_started_at,
                id
            ],
        )
        .ok();
    }

    fn transition_status(&self, id: &str, from: JobStatus, to: JobStatus) -> bool {
        let Some(mut job) = self.get(id) else {
            return false;
        };
        if job.status != from {
            return false;
        }
        job.transition_stage_timing(&from, &to);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET status = ?1, stage_timings = ?2, active_stage_elapsed = ?3, active_stage_started_at = ?4 WHERE id = ?5 AND status = ?6",
            params![
                Self::status_to_str(&to),
                serde_json::to_string(&job.stage_timings).unwrap(),
                job.active_stage_elapsed,
                job.active_stage_started_at,
                id,
                Self::status_to_str(&from)
            ],
        )
        .map(|changed| changed == 1)
        .unwrap_or(false)
    }

    fn update_progress(&self, id: &str, pct: u8, stage: &str, detail: &str) {
        let Some(mut job) = self.get(id) else {
            return;
        };
        job.update_stage_timing(stage);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET progress_pct = ?1, progress_stage = ?2, progress_detail = ?3, stage_timings = ?4, active_stage_elapsed = ?5, active_stage_started_at = ?6 WHERE id = ?7",
            params![
                pct,
                job.progress_stage,
                detail,
                serde_json::to_string(&job.stage_timings).unwrap(),
                job.active_stage_elapsed,
                job.active_stage_started_at,
                id
            ],
        ).ok();
    }

    fn complete_stage(&self, id: &str, summary: &str) {
        let Some(mut job) = self.get(id) else {
            return;
        };
        job.complete_stage_timing();
        job.stages_completed.push(summary.to_string());
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET stages_completed = ?1, stage_timings = ?2, active_stage_elapsed = ?3, active_stage_started_at = ?4 WHERE id = ?5",
            params![
                serde_json::to_string(&job.stages_completed).unwrap(),
                serde_json::to_string(&job.stage_timings).unwrap(),
                job.active_stage_elapsed,
                job.active_stage_started_at,
                id
            ],
        )
        .ok();
    }

    fn set_result(&self, id: &str, result: String, raw_json: Option<String>) {
        let Some(mut job) = self.get(id) else {
            return;
        };
        job.complete_stage_timing();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET result_json = ?1, raw_json = ?2, status = 'done', stage_timings = ?3, active_stage_elapsed = ?4, active_stage_started_at = ?5 WHERE id = ?6",
            params![
                result,
                raw_json,
                serde_json::to_string(&job.stage_timings).unwrap(),
                job.active_stage_elapsed,
                job.active_stage_started_at,
                id
            ],
        )
        .ok();
    }

    fn set_error(&self, id: &str, error: String) {
        let Some(mut job) = self.get(id) else {
            return;
        };
        job.complete_stage_timing();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET error_message = ?1, status = 'failed', stage_timings = ?2, active_stage_elapsed = ?3, active_stage_started_at = ?4 WHERE id = ?5",
            params![
                error,
                serde_json::to_string(&job.stage_timings).unwrap(),
                job.active_stage_elapsed,
                job.active_stage_started_at,
                id
            ],
        )
        .ok();
    }

    fn set_report_files(&self, id: &str, html: Option<String>, text: Option<String>) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET html_report = ?1, text_output = ?2 WHERE id = ?3",
            params![html, text, id],
        )
        .ok();
    }

    fn count_batch_owned(&self, owner_id: &str, batch_id: &str) -> usize {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM jobs WHERE owner_id = ?1 AND batch_id = ?2",
            params![owner_id, batch_id],
            |row| row.get::<_, i64>(0).map(|count| count as usize),
        )
        .unwrap_or(0)
    }

    fn delete(&self, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM jobs WHERE id = ?1", params![id])
            .ok();
    }

    fn delete_owned(&self, owner_id: &str, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM jobs WHERE owner_id = ?1 AND id = ?2",
            params![owner_id, id],
        )
        .ok();
    }

    fn get_storage_size_owned(&self, owner_id: &str) -> u64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT SUM(
                LENGTH(CAST(simc_input AS BLOB)) +
                IFNULL(LENGTH(CAST(result_json AS BLOB)), 0) +
                IFNULL(LENGTH(CAST(raw_json AS BLOB)), 0) +
                IFNULL(LENGTH(CAST(html_report AS BLOB)), 0) +
                IFNULL(LENGTH(CAST(text_output AS BLOB)), 0) +
                IFNULL(LENGTH(CAST(combo_metadata_json AS BLOB)), 0)
            ) FROM jobs WHERE owner_id = ?1",
            params![owner_id],
            |row| {
                row.get::<_, Option<f64>>(0)
                    .map(|v| v.unwrap_or(0.0) as u64)
            },
        )
        .unwrap_or(0)
    }

    fn clear_history_owned(&self, owner_id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM jobs WHERE owner_id = ?1", params![owner_id])
            .ok();
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
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('max_jobs', ?1)
             ON CONFLICT(key) DO UPDATE SET value = ?1",
            params![limit.to_string()],
        )
        .ok();

        conn.execute(
            "DELETE FROM jobs WHERE pinned = 0 AND id NOT IN (SELECT id FROM jobs WHERE pinned = 0 ORDER BY created_at DESC LIMIT ?1)",
            params![limit as u32],
        )
        .ok();
    }

    fn get_max_parallel_jobs(&self) -> usize {
        *self.max_parallel_jobs.lock().unwrap()
    }

    fn set_max_parallel_jobs(&self, limit: usize) {
        let limit = limit.max(1);
        let mut current = self.max_parallel_jobs.lock().unwrap();
        *current = limit;
        drop(current);

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('max_parallel_jobs', ?1)
             ON CONFLICT(key) DO UPDATE SET value = ?1",
            params![limit.to_string()],
        )
        .ok();
    }

    fn set_cache(&self, key: &str, value: String) {
        let conn = self.conn.lock().unwrap();
        let updated_at = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO app_cache (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, updated_at],
        )
        .ok();
    }

    fn get_cache(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM app_cache WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .ok()
    }

    fn remove_cache(&self, key: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM app_cache WHERE key = ?1", params![key])
            .ok();
    }

    fn link_character_owned(
        &self,
        owner_id: &str,
        id: &str,
        region: Option<String>,
        realm: Option<String>,
        name: Option<String>,
    ) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET linked_region = ?1, linked_realm = ?2, linked_name = ?3 WHERE owner_id = ?4 AND id = ?5",
            params![region, realm, name, owner_id, id],
        )
        .ok();
    }

    fn set_pinned_owned(&self, owner_id: &str, id: &str, pinned: bool) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE jobs SET pinned = ?1 WHERE owner_id = ?2 AND id = ?3",
            params![if pinned { 1 } else { 0 }, owner_id, id],
        )
        .ok();
    }

    fn set_user_config(&self, user_id: &str, key: &str, value: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO user_configs (user_id, key, value) VALUES (?1, ?2, ?3)
             ON CONFLICT(user_id, key) DO UPDATE SET value = ?3",
            params![user_id, key, value],
        )
        .ok();
    }

    fn get_user_config(&self, user_id: &str, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM user_configs WHERE user_id = ?1 AND key = ?2",
            params![user_id, key],
            |row| row.get::<_, String>(0),
        )
        .ok()
    }

    fn remove_user_config(&self, user_id: &str, key: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM user_configs WHERE user_id = ?1 AND key = ?2",
            params![user_id, key],
        )
        .ok();
    }

    fn list_users(&self) -> Vec<AppUser> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, provider_subject, battletag, role, enabled, created_at, last_login_at FROM users ORDER BY created_at")
            .unwrap();
        stmt.query_map([], |row| {
            Ok(AppUser {
                id: row.get(0)?,
                provider_subject: row.get(1)?,
                battletag: row.get(2)?,
                role: row.get(3)?,
                enabled: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
                last_login_at: row.get(6)?,
            })
        })
        .unwrap()
        .filter_map(Result::ok)
        .collect()
    }

    fn get_user(&self, id: &str) -> Option<AppUser> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, provider_subject, battletag, role, enabled, created_at, last_login_at FROM users WHERE id = ?1",
            params![id],
            |row| Ok(AppUser {
                id: row.get(0)?, provider_subject: row.get(1)?, battletag: row.get(2)?,
                role: row.get(3)?, enabled: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?, last_login_at: row.get(6)?,
            }),
        ).ok()
    }

    fn find_user_by_provider_subject(&self, provider_subject: &str) -> Option<AppUser> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, provider_subject, battletag, role, enabled, created_at, last_login_at FROM users WHERE provider_subject = ?1",
            params![provider_subject],
            |row| Ok(AppUser {
                id: row.get(0)?, provider_subject: row.get(1)?, battletag: row.get(2)?,
                role: row.get(3)?, enabled: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?, last_login_at: row.get(6)?,
            }),
        ).ok()
    }

    fn find_user_by_battletag(&self, battletag: &str) -> Option<AppUser> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, provider_subject, battletag, role, enabled, created_at, last_login_at FROM users WHERE battletag = ?1 COLLATE NOCASE",
            params![battletag],
            |row| Ok(AppUser {
                id: row.get(0)?, provider_subject: row.get(1)?, battletag: row.get(2)?,
                role: row.get(3)?, enabled: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?, last_login_at: row.get(6)?,
            }),
        ).ok()
    }

    fn save_user(&self, user: AppUser) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (id, provider_subject, battletag, role, enabled, created_at, last_login_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET provider_subject = excluded.provider_subject, battletag = excluded.battletag, role = excluded.role, enabled = excluded.enabled, last_login_at = excluded.last_login_at",
            params![user.id, user.provider_subject, user.battletag, user.role, if user.enabled { 1 } else { 0 }, user.created_at, user.last_login_at],
        ).expect("Failed to save user");
    }

    fn delete_user(&self, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM users WHERE id = ?1", params![id])
            .ok();
    }

    fn save_auth_session(
        &self,
        session_id: &str,
        user_id: &str,
        encrypted_access_token: &str,
        expires_at: i64,
    ) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO auth_sessions (id, user_id, encrypted_access_token, expires_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET encrypted_access_token = excluded.encrypted_access_token, expires_at = excluded.expires_at",
            params![session_id, user_id, encrypted_access_token, expires_at],
        ).expect("Failed to save auth session");
    }

    fn get_auth_session(&self, session_id: &str) -> Option<(String, String, i64)> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT user_id, encrypted_access_token, expires_at FROM auth_sessions WHERE id = ?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok()
    }

    fn delete_auth_session(&self, session_id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM auth_sessions WHERE id = ?1",
            params![session_id],
        )
        .ok();
    }

    fn delete_user_auth_sessions(&self, user_id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM auth_sessions WHERE user_id = ?1",
            params![user_id],
        )
        .ok();
    }

    fn save_route_owned(&self, owner_id: &str, route: SavedRoute) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO dungeon_routes (id, owner_id, name, dungeon, level, pull_count, timer_seconds, affixes, route_data, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, dungeon = excluded.dungeon, level = excluded.level, pull_count = excluded.pull_count, timer_seconds = excluded.timer_seconds, affixes = excluded.affixes, route_data = excluded.route_data WHERE dungeon_routes.owner_id = excluded.owner_id",
            params![
                route.id,
                owner_id,
                route.name,
                route.dungeon,
                route.level,
                route.pull_count,
                route.timer_seconds,
                route.affixes,
                route.route_data,
                route.created_at,
            ],
        )
        .expect("Failed to save route");
    }

    fn list_routes_owned(&self, owner_id: &str) -> Vec<SavedRoute> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, dungeon, level, pull_count, timer_seconds, affixes, route_data, created_at FROM dungeon_routes WHERE owner_id = ?1 ORDER BY created_at DESC")
            .unwrap();
        stmt.query_map(params![owner_id], |row| {
            Ok(SavedRoute {
                id: row.get(0)?,
                name: row.get(1)?,
                dungeon: row.get(2)?,
                level: row.get(3)?,
                pull_count: row.get(4)?,
                timer_seconds: row.get(5)?,
                affixes: row.get(6)?,
                route_data: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    fn delete_route_owned(&self, owner_id: &str, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM dungeon_routes WHERE owner_id = ?1 AND id = ?2",
            params![owner_id, id],
        )
        .ok();
    }

    fn save_character_profile_owned(&self, owner_id: &str, profile: SavedCharacterProfile) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO character_profiles (id, owner_id, name, realm, region, class, spec, simc_input, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, realm = excluded.realm, region = excluded.region, class = excluded.class, spec = excluded.spec, simc_input = excluded.simc_input WHERE character_profiles.owner_id = excluded.owner_id",
            params![
                profile.id,
                owner_id,
                profile.name,
                profile.realm,
                profile.region,
                profile.class,
                profile.spec,
                profile.simc_input,
                profile.created_at,
            ],
        )
        .expect("Failed to save character profile");
    }

    fn list_character_profiles_owned(
        &self,
        owner_id: &str,
        name: Option<&str>,
        realm: Option<&str>,
        region: Option<&str>,
    ) -> Vec<SavedCharacterProfile> {
        let conn = self.conn.lock().unwrap();
        let mut sql = "SELECT id, name, realm, region, class, spec, simc_input, created_at FROM character_profiles WHERE owner_id = ?".to_string();
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(owner_id.to_string())];

        if let Some(n) = name {
            sql.push_str(" AND LOWER(name) = LOWER(?)");
            params_vec.push(Box::new(n.to_string()));
        }
        if let Some(r) = realm {
            sql.push_str(" AND LOWER(realm) = LOWER(?)");
            params_vec.push(Box::new(r.to_string()));
        }
        if let Some(reg) = region {
            sql.push_str(" AND LOWER(region) = LOWER(?)");
            params_vec.push(Box::new(reg.to_string()));
        }
        sql.push_str(" ORDER BY created_at DESC");

        let mut stmt = conn.prepare(&sql).unwrap();
        let params_refs: Vec<&dyn rusqlite::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        stmt.query_map(params_refs.as_slice(), |row| {
            Ok(SavedCharacterProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                realm: row.get(2)?,
                region: row.get(3)?,
                class: row.get(4)?,
                spec: row.get(5)?,
                simc_input: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    fn delete_character_profile_owned(&self, owner_id: &str, id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM character_profiles WHERE owner_id = ?1 AND id = ?2",
            params![owner_id, id],
        )
        .ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Job, JobStatus};
    use crate::storage::JobStorage;
    use tempfile::TempDir;

    fn create_storage() -> (TempDir, SqliteStorage) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("whylowdps-tests.db");
        let storage = SqliteStorage::new(path.to_string_lossy().as_ref());
        (dir, storage)
    }

    #[test]
    fn sqlite_schema_migration_is_versioned_and_transactional() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("legacy.db");
        let conn = Connection::open(&path).expect("open legacy db");
        conn.execute_batch(
            "CREATE TABLE jobs (
                id TEXT PRIMARY KEY, status TEXT NOT NULL, sim_type TEXT NOT NULL,
                simc_input TEXT NOT NULL, options TEXT, result_json TEXT,
                combo_metadata_json TEXT, error_message TEXT, progress_pct INTEGER NOT NULL,
                progress_stage TEXT, progress_detail TEXT, stages_completed TEXT NOT NULL,
                iterations INTEGER NOT NULL, fight_style TEXT NOT NULL, target_error REAL NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE dungeon_routes (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, dungeon TEXT NOT NULL,
                route_data TEXT NOT NULL, created_at TEXT NOT NULL
            );
            PRAGMA user_version = 0;",
        )
        .expect("create legacy schema");
        drop(conn);

        let _storage = SqliteStorage::new(path.to_string_lossy().as_ref());
        let conn = Connection::open(path).expect("reopen migrated db");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("schema version");
        let html_column: String = conn
            .query_row(
                "SELECT name FROM pragma_table_info('jobs') WHERE name = 'html_report'",
                [],
                |row| row.get(0),
            )
            .expect("migrated html column");
        assert_eq!(version, SQLITE_SCHEMA_VERSION);
        assert_eq!(html_column, "html_report");
    }

    fn make_job(
        id: &str,
        created_at: &str,
        simc_input: &str,
        result_json: Option<&str>,
        pinned: bool,
    ) -> Job {
        Job {
            id: id.to_string(),
            owner_id: "local-guest".to_string(),
            status: JobStatus::Pending,
            sim_type: "quick".to_string(),
            simc_input: simc_input.to_string(),
            options: None,
            result_json: result_json.map(str::to_string),
            raw_json: None,
            combo_metadata_json: None,
            error_message: None,
            progress_pct: 0,
            progress_stage: None,
            progress_detail: None,
            stages_completed: Vec::new(),
            stage_timings: Vec::new(),
            active_stage_elapsed: 0.0,
            active_stage_started_at: None,
            iterations: 2000,
            fight_style: "Patchwerk".to_string(),
            target_error: 0.1,
            created_at: created_at.to_string(),
            html_report: None,
            text_output: None,
            batch_id: None,
            linked_region: None,
            linked_realm: None,
            linked_name: None,
            pinned,
        }
    }

    #[test]
    fn sqlite_status_string_conversion_covers_all_known_and_unknown_values() {
        assert_eq!(SqliteStorage::status_to_str(&JobStatus::Pending), "pending");
        assert_eq!(SqliteStorage::status_to_str(&JobStatus::Running), "running");
        assert_eq!(SqliteStorage::status_to_str(&JobStatus::Paused), "paused");
        assert_eq!(SqliteStorage::status_to_str(&JobStatus::Done), "done");
        assert_eq!(SqliteStorage::status_to_str(&JobStatus::Failed), "failed");
        assert_eq!(
            SqliteStorage::status_to_str(&JobStatus::Cancelled),
            "cancelled"
        );

        assert_eq!(SqliteStorage::str_to_status("pending"), JobStatus::Pending);
        assert_eq!(SqliteStorage::str_to_status("running"), JobStatus::Running);
        assert_eq!(SqliteStorage::str_to_status("paused"), JobStatus::Paused);
        assert_eq!(SqliteStorage::str_to_status("done"), JobStatus::Done);
        assert_eq!(SqliteStorage::str_to_status("failed"), JobStatus::Failed);
        assert_eq!(
            SqliteStorage::str_to_status("cancelled"),
            JobStatus::Cancelled
        );
        assert_eq!(SqliteStorage::str_to_status("unknown"), JobStatus::Pending);
        assert_eq!(SqliteStorage::str_to_status(""), JobStatus::Pending);
    }

    #[test]
    fn sqlite_row_to_job_falls_back_for_invalid_status_stages_and_options() {
        let (_dir, storage) = create_storage();
        storage.insert(make_job(
            "job-invalid-row",
            "2026-02-01T00:00:00Z",
            "mage=\"Alice\"\nserver=illidan\n",
            None,
            false,
        ));

        {
            let conn = storage.conn.lock().unwrap();
            conn.execute(
                "UPDATE jobs
                 SET status = 'mystery',
                     options = '{invalid json',
                     stages_completed = 'not-json'
                 WHERE id = ?1",
                params!["job-invalid-row"],
            )
            .expect("update invalid row fields");
        }

        let job = storage.get("job-invalid-row").expect("job should exist");
        assert_eq!(job.status, JobStatus::Pending);
        assert_eq!(job.options, None);
        assert!(job.stages_completed.is_empty());
    }

    #[test]
    fn sqlite_history_filters_support_linked_unlinked_and_pinned_views() {
        let (_dir, storage) = create_storage();
        storage.insert(make_job(
            "linked",
            "2026-02-03T00:00:00Z",
            "mage=\"Alice\"\nserver=illidan\n",
            Some(r#"{"player_name":"Alice","player_class":"Mage","dps":1234.0}"#),
            false,
        ));
        storage.insert(make_job(
            "unlinked",
            "2026-02-02T00:00:00Z",
            "warrior=\"Bob\"\nserver=stormrage\n",
            Some(r#"{"player_name":"Bob","player_class":"Warrior","dps":999.0}"#),
            false,
        ));
        storage.link_character(
            "linked",
            Some("us".to_string()),
            Some("illidan".to_string()),
            Some("Alice".to_string()),
        );
        storage.set_pinned("linked", true);

        let linked_only =
            storage.list_recent(10, Some("Alice"), Some("illidan"), true, false, false);
        assert_eq!(linked_only.len(), 1);
        assert_eq!(linked_only[0].id, "linked");
        assert_eq!(linked_only[0].linked_name.as_deref(), Some("Alice"));

        let unlinked_only = storage.list_recent(10, None, None, false, true, false);
        assert_eq!(unlinked_only.len(), 1);
        assert_eq!(unlinked_only[0].id, "unlinked");

        let pinned_only = storage.list_recent(10, None, None, false, false, true);
        assert_eq!(pinned_only.len(), 1);
        assert_eq!(pinned_only[0].id, "linked");
    }

    #[test]
    fn sqlite_player_filter_searches_beyond_requested_limit() {
        let (_dir, storage) = create_storage();
        storage.insert(make_job(
            "target",
            "2026-02-01T00:00:00Z",
            "mage=\"Alice\"\nserver=illidan\n",
            Some(r#"{"player_name":"Alice","player_class":"Mage","dps":1234.0}"#),
            false,
        ));
        storage.insert(make_job(
            "newer-nonmatch",
            "2026-02-02T00:00:00Z",
            "warrior=\"Bob\"\nserver=stormrage\n",
            Some(r#"{"player_name":"Bob","player_class":"Warrior","dps":999.0}"#),
            false,
        ));

        let filtered = storage.list_recent(1, Some("Alice"), None, false, false, false);

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "target");
    }

    #[test]
    fn sqlite_retention_keeps_pinned_jobs_when_max_jobs_is_small() {
        let (_dir, storage) = create_storage();
        storage.set_max_jobs(1);

        storage.insert(make_job(
            "pinned",
            "2026-02-01T00:00:00Z",
            "mage=\"Pinned\"\nserver=illidan\n",
            None,
            true,
        ));
        storage.insert(make_job(
            "old-unpinned",
            "2026-02-02T00:00:00Z",
            "mage=\"Old\"\nserver=illidan\n",
            None,
            false,
        ));
        storage.insert(make_job(
            "new-unpinned",
            "2026-02-03T00:00:00Z",
            "mage=\"New\"\nserver=illidan\n",
            None,
            false,
        ));

        assert!(storage.get("pinned").is_some());
        assert!(storage.get("old-unpinned").is_none());
        assert!(storage.get("new-unpinned").is_some());
    }

    #[test]
    fn sqlite_job_state_updates_cover_progress_result_errors_and_reports() {
        let (_dir, storage) = create_storage();
        storage.insert(make_job(
            "job-1",
            "2026-02-01T00:00:00Z",
            "evoker=\"Scaler\"\nserver=tichondrius\n",
            None,
            false,
        ));

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
    fn sqlite_history_summary_size_counts_all_payload_fields() {
        let (_dir, storage) = create_storage();
        let mut job = make_job(
            "job-size",
            "2026-02-01T00:00:00Z",
            "mage=\"Sizer\"\nserver=illidan\n",
            Some(r#"{"player_name":"Sizer","dps":1000.0}"#),
            false,
        );
        job.raw_json = Some(r#"{"raw":true}"#.to_string());
        job.combo_metadata_json = Some(r#"{"_combo_count":2}"#.to_string());
        job.html_report = Some("<html>report</html>".to_string());
        job.text_output = Some("text output".to_string());

        let expected_size = job.simc_input.len()
            + job.result_json.as_ref().map(|s| s.len()).unwrap_or(0)
            + job.raw_json.as_ref().map(|s| s.len()).unwrap_or(0)
            + job
                .combo_metadata_json
                .as_ref()
                .map(|s| s.len())
                .unwrap_or(0)
            + job.html_report.as_ref().map(|s| s.len()).unwrap_or(0)
            + job.text_output.as_ref().map(|s| s.len()).unwrap_or(0);

        storage.insert(job);

        let summary = storage
            .list_recent(1, None, None, false, false, false)
            .pop()
            .expect("summary");
        assert_eq!(summary.id, "job-size");
        assert_eq!(summary.size_bytes, expected_size as u64);
    }

    #[test]
    fn sqlite_cache_and_user_config_round_trip_and_delete() {
        let (_dir, storage) = create_storage();
        storage.set_cache("api:foo", "cached".to_string());
        assert_eq!(storage.get_cache("api:foo").as_deref(), Some("cached"));
        storage.remove_cache("api:foo");
        assert!(storage.get_cache("api:foo").is_none());

        storage.set_user_config("u1", "discord_link_hidden", "true");
        assert_eq!(
            storage
                .get_user_config("u1", "discord_link_hidden")
                .as_deref(),
            Some("true")
        );
        storage.remove_user_config("u1", "discord_link_hidden");
        assert!(storage
            .get_user_config("u1", "discord_link_hidden")
            .is_none());
    }

    #[test]
    fn sqlite_cache_and_user_config_writes_replace_existing_values() {
        let (_dir, storage) = create_storage();

        storage.set_cache("api:foo", "cached-old".to_string());
        storage.set_cache("api:foo", "cached-new".to_string());
        assert_eq!(storage.get_cache("api:foo").as_deref(), Some("cached-new"));

        storage.set_user_config("u1", "discord_link_hidden", "true");
        storage.set_user_config("u1", "discord_link_hidden", "false");
        assert_eq!(
            storage
                .get_user_config("u1", "discord_link_hidden")
                .as_deref(),
            Some("false")
        );
    }

    #[test]
    fn sqlite_batch_delete_and_clear_history_update_storage_state() {
        let (_dir, storage) = create_storage();

        let mut batch_a = make_job(
            "job-a",
            "2026-02-01T00:00:00Z",
            "mage=\"Alice\"\nserver=illidan\n",
            Some(r#"{"player_name":"Alice","dps":12345.0}"#),
            false,
        );
        batch_a.batch_id = Some("batch-a".to_string());
        batch_a.combo_metadata_json = Some(r#"{"_combo_count":1}"#.to_string());
        storage.insert(batch_a);

        let mut batch_b = make_job(
            "job-b",
            "2026-02-02T00:00:00Z",
            "warrior=\"Bob\"\nserver=stormrage\n",
            Some(r#"{"player_name":"Bob","dps":23456.0}"#),
            false,
        );
        batch_b.batch_id = Some("batch-a".to_string());
        storage.insert(batch_b);

        assert_eq!(storage.count_batch("batch-a"), 2);
        assert!(storage.get_storage_size() > 0);

        storage.delete("job-a");
        assert!(storage.get("job-a").is_none());
        assert_eq!(storage.count_batch("batch-a"), 1);

        storage.clear_history();
        assert!(storage
            .list_recent(10, None, None, false, false, false)
            .is_empty());
        assert_eq!(storage.get_storage_size(), 0);
    }

    #[test]
    fn sqlite_explicit_linking_and_pinning_update_existing_jobs() {
        let (_dir, storage) = create_storage();
        storage.insert(make_job(
            "job-1",
            "2026-02-01T00:00:00Z",
            "mage=\"Alice\"\nserver=illidan\n",
            None,
            false,
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
    fn sqlite_missing_job_mutators_do_not_create_state() {
        let (_dir, storage) = create_storage();

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
    fn sqlite_persists_max_jobs_setting_across_reopen() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("whylowdps-tests.db");
        let db_path = path.to_string_lossy().to_string();

        let storage = SqliteStorage::new(&db_path);
        let original_limit = storage.get_max_jobs();
        let updated_limit = original_limit.saturating_sub(1).max(1);

        storage.set_max_jobs(updated_limit);
        assert_eq!(storage.get_max_jobs(), updated_limit);

        drop(storage);

        let reopened = SqliteStorage::new(&db_path);
        assert_eq!(reopened.get_max_jobs(), updated_limit);
    }

    #[test]
    fn sqlite_invalid_persisted_max_jobs_falls_back_to_default_limit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("whylowdps-tests.db");
        let db_path = path.to_string_lossy().to_string();

        let storage = SqliteStorage::new(&db_path);
        {
            let conn = storage.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('max_jobs', 'not-a-number')
                 ON CONFLICT(key) DO UPDATE SET value = 'not-a-number'",
                [],
            )
            .expect("store invalid max_jobs");
        }

        drop(storage);

        let reopened = SqliteStorage::new(&db_path);
        assert_eq!(reopened.get_max_jobs(), *crate::storage::MAX_JOBS);
    }

    #[test]
    fn sqlite_persists_max_parallel_jobs_setting_across_reopen() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("whylowdps-tests.db");
        let db_path = path.to_string_lossy().to_string();

        let storage = SqliteStorage::new(&db_path);
        let updated_limit = storage.get_max_parallel_jobs().saturating_add(1);

        storage.set_max_parallel_jobs(updated_limit);
        assert_eq!(storage.get_max_parallel_jobs(), updated_limit);

        drop(storage);

        let reopened = SqliteStorage::new(&db_path);
        assert_eq!(reopened.get_max_parallel_jobs(), updated_limit);
    }

    #[test]
    fn sqlite_invalid_persisted_max_parallel_jobs_falls_back_to_default_limit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("whylowdps-tests.db");
        let db_path = path.to_string_lossy().to_string();

        let storage = SqliteStorage::new(&db_path);
        {
            let conn = storage.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('max_parallel_jobs', 'not-a-number')
                 ON CONFLICT(key) DO UPDATE SET value = 'not-a-number'",
                [],
            )
            .expect("store invalid max_parallel_jobs");
        }

        drop(storage);

        let reopened = SqliteStorage::new(&db_path);
        assert_eq!(
            reopened.get_max_parallel_jobs(),
            *crate::storage::MAX_PARALLEL_JOBS
        );
    }

    #[test]
    fn sqlite_route_and_profile_upserts_replace_content_and_keep_original_created_at() {
        let (_dir, storage) = create_storage();

        storage.save_route(SavedRoute {
            id: "route-1".to_string(),
            name: "Old Route".to_string(),
            dungeon: "Ara-Kara".to_string(),
            level: Some(10),
            pull_count: Some(12),
            timer_seconds: Some(1800),
            affixes: Some("Fortified".to_string()),
            route_data: "OLD".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        });
        storage.save_route(SavedRoute {
            id: "route-1".to_string(),
            name: "Updated Route".to_string(),
            dungeon: "Dawnbreaker".to_string(),
            level: Some(12),
            pull_count: Some(14),
            timer_seconds: Some(1700),
            affixes: Some("Tyrannical".to_string()),
            route_data: "UPDATED".to_string(),
            created_at: "2026-01-02T00:00:00Z".to_string(),
        });

        let route = storage.list_routes().pop().expect("saved route");
        assert_eq!(route.name, "Updated Route");
        assert_eq!(route.dungeon, "Dawnbreaker");
        assert_eq!(route.route_data, "UPDATED");
        assert_eq!(route.created_at, "2026-01-01T00:00:00Z");

        storage.save_character_profile(SavedCharacterProfile {
            id: "profile-1".to_string(),
            name: "OldName".to_string(),
            realm: "Illidan".to_string(),
            region: "US".to_string(),
            class: Some("Mage".to_string()),
            spec: Some("Arcane".to_string()),
            simc_input: "mage=\"OldName\"".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        });
        storage.save_character_profile(SavedCharacterProfile {
            id: "profile-1".to_string(),
            name: "NewName".to_string(),
            realm: "Stormrage".to_string(),
            region: "EU".to_string(),
            class: Some("Priest".to_string()),
            spec: Some("Shadow".to_string()),
            simc_input: "priest=\"NewName\"".to_string(),
            created_at: "2026-01-02T00:00:00Z".to_string(),
        });

        let profile = storage
            .list_character_profiles(Some("newname"), Some("stormrage"), Some("eu"))
            .pop()
            .expect("updated profile");
        assert_eq!(profile.id, "profile-1");
        assert_eq!(profile.class.as_deref(), Some("Priest"));
        assert_eq!(profile.spec.as_deref(), Some("Shadow"));
        assert_eq!(profile.simc_input, "priest=\"NewName\"");
        assert_eq!(profile.created_at, "2026-01-01T00:00:00Z");
    }

    #[test]
    fn sqlite_routes_and_profiles_support_user_crud_filters_and_sorting() {
        let (_dir, storage) = create_storage();
        storage.save_route(SavedRoute {
            id: "r-old".to_string(),
            name: "Old Route".to_string(),
            dungeon: "Ara-Kara".to_string(),
            level: Some(10),
            pull_count: Some(12),
            timer_seconds: Some(1800),
            affixes: Some("Fortified".to_string()),
            route_data: "OLD".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        });
        storage.save_route(SavedRoute {
            id: "r-new".to_string(),
            name: "New Route".to_string(),
            dungeon: "Ara-Kara".to_string(),
            level: Some(12),
            pull_count: Some(14),
            timer_seconds: Some(1750),
            affixes: Some("Tyrannical".to_string()),
            route_data: "NEW".to_string(),
            created_at: "2026-01-02T00:00:00Z".to_string(),
        });

        let routes = storage.list_routes();
        assert_eq!(routes.len(), 2);
        assert_eq!(routes[0].id, "r-new");
        assert_eq!(routes[1].id, "r-old");
        storage.delete_route("r-old");
        assert_eq!(storage.list_routes().len(), 1);

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
        storage.save_character_profile(SavedCharacterProfile {
            id: "p2".to_string(),
            name: "Alt".to_string(),
            realm: "Stormrage".to_string(),
            region: "US".to_string(),
            class: Some("Priest".to_string()),
            spec: Some("Shadow".to_string()),
            simc_input: "priest=\"Alt\"".to_string(),
            created_at: "2026-01-02T00:00:00Z".to_string(),
        });

        let filtered = storage.list_character_profiles(Some("mymain"), Some("illidan"), Some("us"));
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "p1");
        storage.delete_character_profile("p1");
        assert_eq!(
            storage
                .list_character_profiles(Some("mymain"), None, None)
                .len(),
            0
        );
    }

    #[test]
    fn sqlite_isolates_jobs_routes_profiles_and_history_by_owner() {
        let (_dir, storage) = create_storage();
        let mut alice_job = make_job(
            "alice-job",
            "2026-01-01T00:00:00Z",
            "mage=Alice",
            None,
            false,
        );
        alice_job.owner_id = "alice".to_string();
        let mut bob_job = make_job("bob-job", "2026-01-02T00:00:00Z", "mage=Bob", None, false);
        bob_job.owner_id = "bob".to_string();
        storage.insert(alice_job);
        storage.insert(bob_job);

        assert!(storage.get_owned("alice", "alice-job").is_some());
        assert!(storage.get_owned("bob", "alice-job").is_none());
        assert_eq!(
            storage
                .list_recent_owned("alice", 10, None, None, false, false, false)
                .len(),
            1
        );
        storage.clear_history_owned("alice");
        assert!(storage.get("alice-job").is_none());
        assert!(storage.get("bob-job").is_some());

        storage.save_route_owned(
            "alice",
            SavedRoute {
                id: "route".to_string(),
                name: "Alice route".to_string(),
                dungeon: "Test".to_string(),
                level: None,
                pull_count: None,
                timer_seconds: None,
                affixes: None,
                route_data: "A".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            },
        );
        assert_eq!(storage.list_routes_owned("alice").len(), 1);
        assert!(storage.list_routes_owned("bob").is_empty());

        storage.save_character_profile_owned(
            "bob",
            SavedCharacterProfile {
                id: "profile".to_string(),
                name: "Bob".to_string(),
                realm: "Realm".to_string(),
                region: "US".to_string(),
                class: None,
                spec: None,
                simc_input: "mage=Bob".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            },
        );
        assert!(storage
            .list_character_profiles_owned("alice", None, None, None)
            .is_empty());
        assert_eq!(
            storage
                .list_character_profiles_owned("bob", None, None, None)
                .len(),
            1
        );
    }
}
