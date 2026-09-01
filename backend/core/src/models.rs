use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppUser {
    pub id: String,
    pub provider_subject: Option<String>,
    pub battletag: String,
    pub role: String,
    pub enabled: bool,
    pub created_at: String,
    pub last_login_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Running,
    Paused,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedRoute {
    pub id: String,
    pub name: String,
    pub dungeon: String,
    pub level: Option<i32>,
    pub pull_count: Option<i32>,
    pub timer_seconds: Option<i32>,
    pub affixes: Option<String>,
    pub route_data: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedCharacterProfile {
    pub id: String,
    pub name: String,
    pub realm: String,
    pub region: String,
    pub class: Option<String>,
    pub spec: Option<String>,
    pub simc_input: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    #[serde(default = "default_job_owner", skip_serializing)]
    pub owner_id: String,
    pub status: JobStatus,
    pub sim_type: String,
    pub simc_input: String,
    pub options: Option<serde_json::Value>,
    pub result_json: Option<String>,
    pub raw_json: Option<String>,
    pub combo_metadata_json: Option<String>,
    pub error_message: Option<String>,
    pub progress_pct: u8,
    pub progress_stage: Option<String>,
    pub progress_detail: Option<String>,
    pub stages_completed: Vec<String>,
    #[serde(default)]
    pub stage_timings: Vec<StageTiming>,
    #[serde(default)]
    pub active_stage_elapsed: f64,
    #[serde(default, skip_serializing)]
    pub active_stage_started_at: Option<String>,
    pub iterations: u32,
    pub fight_style: String,
    pub target_error: f64,
    pub created_at: String,
    #[serde(default)]
    pub queue_order: u64,
    pub html_report: Option<String>,
    pub text_output: Option<String>,
    pub batch_id: Option<String>,
    pub linked_region: Option<String>,
    pub linked_realm: Option<String>,
    pub linked_name: Option<String>,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StageTiming {
    pub name: String,
    pub elapsed: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobSummary {
    pub id: String,
    pub status: JobStatus,
    pub sim_type: String,
    pub created_at: String,
    pub queue_order: u64,
    pub fight_style: String,
    pub iterations: u32,
    pub error_message: Option<String>,
    pub player_name: Option<String>,
    pub player_class: Option<String>,
    pub realm: Option<String>,
    pub dps: Option<f64>,
    pub batch_id: Option<String>,
    pub size_bytes: u64,
    pub upgrades: Option<u32>,
    pub downgrades: Option<u32>,
    pub linked_region: Option<String>,
    pub linked_realm: Option<String>,
    pub linked_name: Option<String>,
    pub pinned: bool,
}

pub struct ResultSummary {
    pub player_name: Option<String>,
    pub player_class: Option<String>,
    pub dps: Option<f64>,
    pub realm: Option<String>,
    pub upgrades: Option<u32>,
    pub downgrades: Option<u32>,
}

pub fn extract_result_summary(result_json: &Option<String>, simc_input: &str) -> ResultSummary {
    let mut summary = ResultSummary {
        player_name: None,
        player_class: None,
        dps: None,
        realm: None,
        upgrades: None,
        downgrades: None,
    };

    // Extract DPS, player name, class from parsed result
    if let Some(json_str) = result_json {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
            summary.player_name = v
                .get("player_name")
                .and_then(|n| n.as_str())
                .map(String::from);
            summary.player_class = v
                .get("player_class")
                .and_then(|c| c.as_str())
                .map(String::from);
            summary.dps = v.get("dps").and_then(|d| d.as_f64());

            if let Some(sim_type) = v.get("type").and_then(|t| t.as_str()) {
                if sim_type == "top_gear" || sim_type == "droptimizer" {
                    if let Some(base_dps) = v.get("base_dps").and_then(|bd| bd.as_f64()) {
                        if let Some(results) = v.get("results").and_then(|r| r.as_array()) {
                            let mut upgrades = 0;
                            let mut downgrades = 0;
                            for r in results {
                                let name = r.get("name").and_then(|n| n.as_str()).unwrap_or("");
                                let delta = r.get("delta").and_then(|d| d.as_f64()).unwrap_or(0.0);

                                if delta == 0.0
                                    && (name.starts_with("Currently Equipped") || name == "Base")
                                {
                                    continue;
                                }

                                if let Some(dps) = r.get("dps").and_then(|d| d.as_f64()) {
                                    if dps > base_dps {
                                        upgrades += 1;
                                    } else {
                                        downgrades += 1;
                                    }
                                }
                            }
                            summary.upgrades = Some(upgrades);
                            summary.downgrades = Some(downgrades);
                        }
                    }
                }
            }
        }
    }

    // Extract realm/region from simc input
    for line in simc_input.lines() {
        let trimmed = line.trim();
        if let Some(val) = trimmed.strip_prefix("server=") {
            summary.realm = Some(val.to_string());
        } else if let Some(_val) = trimmed.strip_prefix("region=") {
            // This isn't in ResultSummary but we can use it to help get_history_characters if we added it to JobSummary
            // For now, we'll focus on names and realms
        }
    }

    // If player_name not in result yet, extract from simc input
    if summary.player_name.is_none() {
        // Match any SimC profile declaration so newly added classes do not
        // require a parser release. Reserved scalar settings are ignored.
        let re = Regex::new(r#"(?i)^([a-z_][a-z0-9_]*)\s*=\s*"([^"]+)""#).unwrap();
        let name_re = Regex::new(r#"(?i)^(?:name|player)\s*=\s*([^\s]+)"#).unwrap();
        let armory_re = Regex::new(r#"(?i)^armory=[^,]+,[^,]+,([^,\s]+)"#).unwrap();

        for line in simc_input.lines() {
            let trimmed = line.trim();
            if let Some(caps) = re.captures(trimmed) {
                let key = caps[1].to_ascii_lowercase();
                if !matches!(
                    key.as_str(),
                    "server" | "region" | "spec" | "talents" | "race"
                ) {
                    summary.player_name = Some(caps[2].to_string());
                    break;
                }
            }
            if let Some(caps) = armory_re.captures(trimmed) {
                summary.player_name = Some(caps[1].to_string());
                break;
            }
            if let Some(caps) = name_re.captures(trimmed) {
                summary.player_name = Some(caps[1].to_string());
                break;
            }
        }
    }

    summary
}

impl Job {
    pub fn new(
        simc_input: String,
        sim_type: String,
        iterations: u32,
        fight_style: String,
        target_error: f64,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            owner_id: default_job_owner(),
            status: JobStatus::Pending,
            sim_type,
            simc_input,
            options: None,
            result_json: None,
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
            iterations,
            fight_style,
            target_error,
            created_at: chrono::Utc::now().to_rfc3339(),
            queue_order: 0,
            html_report: None,
            text_output: None,
            batch_id: None,
            linked_region: None,
            linked_realm: None,
            linked_name: None,
            pinned: false,
        }
    }

    pub fn update_stage_timing(&mut self, stage: &str) {
        let now = chrono::Utc::now();
        if self.progress_stage.as_deref() != Some(stage) {
            self.finish_stage_timing(now, true);
            self.progress_stage = Some(stage.to_string());
            self.active_stage_elapsed = 0.0;
            self.active_stage_started_at = None;
        }

        if self.status == JobStatus::Running && self.active_stage_started_at.is_none() {
            self.active_stage_started_at = Some(now.to_rfc3339());
        }
    }

    pub fn transition_stage_timing(&mut self, from: &JobStatus, to: &JobStatus) {
        let now = chrono::Utc::now();
        if matches!(
            to,
            JobStatus::Done | JobStatus::Failed | JobStatus::Cancelled
        ) {
            self.finish_stage_timing(now, true);
        } else if *from == JobStatus::Running && *to != JobStatus::Running {
            self.accumulate_stage_timing(now);
        } else if *from == JobStatus::Paused
            && *to == JobStatus::Running
            && self.active_stage_started_at.is_none()
            && self.progress_stage.is_some()
        {
            self.active_stage_started_at = Some(now.to_rfc3339());
        }
    }

    pub fn complete_stage_timing(&mut self) {
        self.finish_stage_timing(chrono::Utc::now(), true);
    }

    pub fn active_stage_elapsed_seconds(&self) -> f64 {
        let live_elapsed = self
            .active_stage_started_at
            .as_deref()
            .and_then(|started| chrono::DateTime::parse_from_rfc3339(started).ok())
            .map(|started| {
                let elapsed =
                    chrono::Utc::now().signed_duration_since(started.with_timezone(&chrono::Utc));
                elapsed.num_milliseconds().max(0) as f64 / 1000.0
            })
            .unwrap_or(0.0);
        (self.active_stage_elapsed + live_elapsed).max(0.0)
    }

    fn accumulate_stage_timing(&mut self, now: chrono::DateTime<chrono::Utc>) {
        if let Some(started) = self.active_stage_started_at.take() {
            if let Ok(started) = chrono::DateTime::parse_from_rfc3339(&started) {
                let elapsed = now
                    .signed_duration_since(started.with_timezone(&chrono::Utc))
                    .num_milliseconds()
                    .max(0) as f64
                    / 1000.0;
                self.active_stage_elapsed += elapsed;
            }
        }
    }

    fn finish_stage_timing(&mut self, now: chrono::DateTime<chrono::Utc>, record: bool) {
        let had_active_timing =
            self.active_stage_started_at.is_some() || self.active_stage_elapsed > 0.0;
        self.accumulate_stage_timing(now);
        if record && had_active_timing {
            if let Some(name) = self.progress_stage.as_deref() {
                self.stage_timings.push(StageTiming {
                    name: name.to_string(),
                    elapsed: self.active_stage_elapsed.max(0.0),
                });
            }
        }
        self.active_stage_elapsed = 0.0;
    }

    pub fn estimate_size(&self) -> u64 {
        let mut total = self.simc_input.len() as u64;
        total += self.result_json.as_ref().map(|s| s.len()).unwrap_or(0) as u64;
        total += self.raw_json.as_ref().map(|s| s.len()).unwrap_or(0) as u64;
        total += self
            .combo_metadata_json
            .as_ref()
            .map(|s| s.len())
            .unwrap_or(0) as u64;
        total += self.html_report.as_ref().map(|s| s.len()).unwrap_or(0) as u64;
        total += self.text_output.as_ref().map(|s| s.len()).unwrap_or(0) as u64;
        total
    }
}

fn default_job_owner() -> String {
    "local-guest".to_string()
}

#[cfg(test)]
mod tests {
    use super::{extract_result_summary, Job, JobStatus};

    #[test]
    fn user_history_summary_counts_upgrades_and_downgrades_for_topgear_results() {
        let result_json = Some(
            serde_json::json!({
                "type": "top_gear",
                "player_name": "Alice",
                "player_class": "Mage",
                "base_dps": 1000.0,
                "results": [
                    { "name": "Currently Equipped", "delta": 0.0, "dps": 1000.0 },
                    { "name": "Combo Upgrade", "delta": 120.0, "dps": 1120.0 },
                    { "name": "Combo Downgrade", "delta": -80.0, "dps": 920.0 }
                ]
            })
            .to_string(),
        );

        let summary = extract_result_summary(&result_json, "mage=\"Alice\"\nserver=illidan\n");
        assert_eq!(summary.player_name.as_deref(), Some("Alice"));
        assert_eq!(summary.player_class.as_deref(), Some("Mage"));
        assert_eq!(summary.realm.as_deref(), Some("illidan"));
        assert_eq!(summary.upgrades, Some(1));
        assert_eq!(summary.downgrades, Some(1));
    }

    #[test]
    fn user_history_summary_falls_back_to_simc_input_name_and_armory() {
        let empty_result = None;

        let from_name_line = extract_result_summary(
            &empty_result,
            "evoker=\"Scalefriend\"\nserver=tichondrius\n",
        );
        assert_eq!(from_name_line.player_name.as_deref(), Some("Scalefriend"));
        assert_eq!(from_name_line.realm.as_deref(), Some("tichondrius"));

        let from_armory = extract_result_summary(&empty_result, "armory=us,illidan,Arcanefox\n");
        assert_eq!(from_armory.player_name.as_deref(), Some("Arcanefox"));
        assert_eq!(from_armory.realm, None);
    }

    #[test]
    fn user_history_summary_falls_back_when_result_json_is_invalid() {
        let invalid_result = Some("{not valid json".to_string());

        let summary =
            extract_result_summary(&invalid_result, "priest=\"Fallback\"\nserver=area52\n");

        assert_eq!(summary.player_name.as_deref(), Some("Fallback"));
        assert_eq!(summary.realm.as_deref(), Some("area52"));
        assert_eq!(summary.player_class, None);
        assert_eq!(summary.dps, None);
        assert_eq!(summary.upgrades, None);
        assert_eq!(summary.downgrades, None);
    }

    #[test]
    fn user_history_summary_ignores_zero_delta_baselines_and_missing_dps_results() {
        let result_json = Some(
            serde_json::json!({
                "type": "droptimizer",
                "player_name": "Alice",
                "base_dps": 1000.0,
                "results": [
                    { "name": "Base", "delta": 0.0, "dps": 1000.0 },
                    { "name": "Currently Equipped 1", "delta": 0.0, "dps": 1000.0 },
                    { "name": "No Dps Result", "delta": 50.0 },
                    { "name": "Upgrade", "delta": 120.0, "dps": 1120.0 },
                    { "name": "Downgrade", "delta": -80.0, "dps": 920.0 }
                ]
            })
            .to_string(),
        );

        let summary = extract_result_summary(&result_json, "mage=\"Alice\"\nserver=illidan\n");
        assert_eq!(summary.upgrades, Some(1));
        assert_eq!(summary.downgrades, Some(1));
    }

    #[test]
    fn user_history_summary_prefers_result_player_name_over_simc_input_fallback() {
        let result_json = Some(
            serde_json::json!({
                "player_name": "FromResult",
                "player_class": "Mage",
                "dps": 12345.0
            })
            .to_string(),
        );

        let summary = extract_result_summary(
            &result_json,
            "mage=\"FromInput\"\nserver=illidan\narmory=us,illidan,FromArmory\n",
        );

        assert_eq!(summary.player_name.as_deref(), Some("FromResult"));
        assert_eq!(summary.player_class.as_deref(), Some("Mage"));
        assert_eq!(summary.realm.as_deref(), Some("illidan"));
    }

    #[test]
    fn user_history_summary_uses_last_server_line_when_multiple_are_present() {
        let empty_result = None;

        let summary = extract_result_summary(
            &empty_result,
            "server=illidan\nregion=us\nserver=stormrage\nmage=\"Alice\"\n",
        );

        assert_eq!(summary.player_name.as_deref(), Some("Alice"));
        assert_eq!(summary.realm.as_deref(), Some("stormrage"));
    }

    #[test]
    fn job_status_serializes_and_deserializes_as_lowercase_strings() {
        assert_eq!(
            serde_json::to_string(&JobStatus::Pending).expect("serialize pending"),
            "\"pending\""
        );
        assert_eq!(
            serde_json::to_string(&JobStatus::Running).expect("serialize running"),
            "\"running\""
        );
        assert_eq!(
            serde_json::to_string(&JobStatus::Paused).expect("serialize paused"),
            "\"paused\""
        );
        assert_eq!(
            serde_json::to_string(&JobStatus::Done).expect("serialize done"),
            "\"done\""
        );
        assert_eq!(
            serde_json::to_string(&JobStatus::Failed).expect("serialize failed"),
            "\"failed\""
        );
        assert_eq!(
            serde_json::to_string(&JobStatus::Cancelled).expect("serialize cancelled"),
            "\"cancelled\""
        );

        assert_eq!(
            serde_json::from_str::<JobStatus>("\"pending\"").expect("deserialize pending"),
            JobStatus::Pending
        );
        assert_eq!(
            serde_json::from_str::<JobStatus>("\"running\"").expect("deserialize running"),
            JobStatus::Running
        );
        assert_eq!(
            serde_json::from_str::<JobStatus>("\"paused\"").expect("deserialize paused"),
            JobStatus::Paused
        );
        assert_eq!(
            serde_json::from_str::<JobStatus>("\"done\"").expect("deserialize done"),
            JobStatus::Done
        );
        assert_eq!(
            serde_json::from_str::<JobStatus>("\"failed\"").expect("deserialize failed"),
            JobStatus::Failed
        );
        assert_eq!(
            serde_json::from_str::<JobStatus>("\"cancelled\"").expect("deserialize cancelled"),
            JobStatus::Cancelled
        );
    }

    #[test]
    fn job_status_rejects_unknown_and_wrong_case_values() {
        assert!(serde_json::from_str::<JobStatus>("\"unknown\"").is_err());
        assert!(serde_json::from_str::<JobStatus>("\"Pending\"").is_err());
        assert!(serde_json::from_str::<JobStatus>("\"DONE\"").is_err());
    }

    #[test]
    fn stage_timing_survives_pause_and_reopen_without_resetting() {
        let mut job = Job::new(
            "mage=\"Tester\"\n".to_string(),
            "top_gear".to_string(),
            1000,
            "Patchwerk".to_string(),
            0.2,
        );
        job.status = JobStatus::Running;
        job.update_stage_timing("Stage 1 of 3");
        job.active_stage_started_at =
            Some((chrono::Utc::now() - chrono::Duration::seconds(5)).to_rfc3339());

        let elapsed_before_pause = job.active_stage_elapsed_seconds();
        assert!(elapsed_before_pause >= 4.0);

        job.transition_stage_timing(&JobStatus::Running, &JobStatus::Paused);
        assert!(job.active_stage_elapsed_seconds() >= 4.0);
        assert!(job.active_stage_started_at.is_none());

        let reopened = job.clone();
        assert!(reopened.active_stage_elapsed_seconds() >= 4.0);

        job.transition_stage_timing(&JobStatus::Paused, &JobStatus::Running);
        assert!(job.active_stage_started_at.is_some());
        job.complete_stage_timing();
        assert_eq!(job.stage_timings.len(), 1);
        assert_eq!(job.stage_timings[0].name, "Stage 1 of 3");
        assert!(job.stage_timings[0].elapsed >= 4.0);
    }

    #[test]
    fn user_history_summary_does_not_compute_upgrade_counts_for_other_result_types() {
        let result_json = Some(
            serde_json::json!({
                "type": "quick",
                "player_name": "Alice",
                "player_class": "Mage",
                "dps": 12345.0,
                "base_dps": 1000.0,
                "results": [
                    { "name": "Upgrade", "delta": 120.0, "dps": 1120.0 },
                    { "name": "Downgrade", "delta": -80.0, "dps": 920.0 }
                ]
            })
            .to_string(),
        );

        let summary = extract_result_summary(&result_json, "mage=\"Alice\"\nserver=illidan\n");
        assert_eq!(summary.player_name.as_deref(), Some("Alice"));
        assert_eq!(summary.player_class.as_deref(), Some("Mage"));
        assert_eq!(summary.dps, Some(12345.0));
        assert_eq!(summary.realm.as_deref(), Some("illidan"));
        assert_eq!(summary.upgrades, None);
        assert_eq!(summary.downgrades, None);
    }

    #[test]
    fn user_history_summary_supports_player_and_name_fallback_keys() {
        let empty_result = None;

        let from_player = extract_result_summary(
            &empty_result,
            "  player = \"PlayerAlias\"  \nserver=illidan\n",
        );
        assert_eq!(from_player.player_name.as_deref(), Some("PlayerAlias"));
        assert_eq!(from_player.realm.as_deref(), Some("illidan"));

        let from_name = extract_result_summary(&empty_result, "name=NameAlias\n");
        assert_eq!(from_name.player_name.as_deref(), Some("NameAlias"));
        assert_eq!(from_name.realm, None);
    }

    #[test]
    fn user_history_summary_supports_death_knight_and_demon_hunter_alias_keys() {
        let empty_result = None;

        let from_death_knight = extract_result_summary(
            &empty_result,
            "death_knight=\"Runeblade\"\nserver=illidan\n",
        );
        assert_eq!(from_death_knight.player_name.as_deref(), Some("Runeblade"));
        assert_eq!(from_death_knight.realm.as_deref(), Some("illidan"));

        let from_demon_hunter = extract_result_summary(&empty_result, "demon_hunter=\"Felrush\"\n");
        assert_eq!(from_demon_hunter.player_name.as_deref(), Some("Felrush"));
        assert_eq!(from_demon_hunter.realm, None);
    }

    #[test]
    fn user_history_summary_supports_compact_class_alias_keys() {
        let empty_result = None;

        let from_deathknight =
            extract_result_summary(&empty_result, "deathknight=\"RunebladeAlt\"\n");
        assert_eq!(
            from_deathknight.player_name.as_deref(),
            Some("RunebladeAlt")
        );
        assert_eq!(from_deathknight.realm, None);

        let from_demonhunter = extract_result_summary(
            &empty_result,
            "demonhunter=\"FelrushAlt\"\nserver=tichondrius\n",
        );
        assert_eq!(from_demonhunter.player_name.as_deref(), Some("FelrushAlt"));
        assert_eq!(from_demonhunter.realm.as_deref(), Some("tichondrius"));
    }

    #[test]
    fn new_job_starts_with_expected_defaults() {
        let job = Job::new(
            "mage=\"Alice\"\nserver=illidan\n".to_string(),
            "quick".to_string(),
            2000,
            "Patchwerk".to_string(),
            0.1,
        );

        assert!(!job.id.is_empty());
        assert_eq!(job.status, JobStatus::Pending);
        assert_eq!(job.sim_type, "quick");
        assert_eq!(job.iterations, 2000);
        assert_eq!(job.fight_style, "Patchwerk");
        assert_eq!(job.target_error, 0.1);
        assert!(job.options.is_none());
        assert!(job.result_json.is_none());
        assert!(job.raw_json.is_none());
        assert!(job.combo_metadata_json.is_none());
        assert!(job.error_message.is_none());
        assert_eq!(job.progress_pct, 0);
        assert!(job.progress_stage.is_none());
        assert!(job.progress_detail.is_none());
        assert!(job.stages_completed.is_empty());
        assert!(job.html_report.is_none());
        assert!(job.text_output.is_none());
        assert!(job.batch_id.is_none());
        assert!(job.linked_region.is_none());
        assert!(job.linked_realm.is_none());
        assert!(job.linked_name.is_none());
        assert!(!job.pinned);
        assert!(!job.created_at.is_empty());
    }

    #[test]
    fn estimate_size_counts_all_optional_payload_fields() {
        let mut job = Job::new(
            "mage=\"Alice\"\nserver=illidan\n".to_string(),
            "quick".to_string(),
            2000,
            "Patchwerk".to_string(),
            0.1,
        );
        job.result_json = Some("{\"dps\":12345}".to_string());
        job.raw_json = Some("{\"raw\":true}".to_string());
        job.combo_metadata_json = Some("{\"_combo_count\":2}".to_string());
        job.html_report = Some("<html>report</html>".to_string());
        job.text_output = Some("text output".to_string());

        let expected = job.simc_input.len()
            + job.result_json.as_ref().map(|s| s.len()).unwrap_or(0)
            + job.raw_json.as_ref().map(|s| s.len()).unwrap_or(0)
            + job
                .combo_metadata_json
                .as_ref()
                .map(|s| s.len())
                .unwrap_or(0)
            + job.html_report.as_ref().map(|s| s.len()).unwrap_or(0)
            + job.text_output.as_ref().map(|s| s.len()).unwrap_or(0);

        assert_eq!(job.estimate_size(), expected as u64);
    }
}
