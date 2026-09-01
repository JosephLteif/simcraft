use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::types::SimOptions;
use crate::log_buffer::LogBuffer;
use crate::models::{Job, JobStatus};
use crate::result_parser;
use crate::simc_runner;
use crate::storage::{self, JobStorage};
use crate::types::ResolveGearResponse;

fn is_staged_sim_type(sim_type: &str) -> bool {
    matches!(
        sim_type,
        "top_gear"
            | "droptimizer"
            | "external_buff_matrix"
            | "consumable_matrix"
            | "trinket_tier_heatmap"
    )
}

pub(super) fn resolve_simc_binary_for_request(simc_path: &Path) -> Result<PathBuf, String> {
    #[cfg(feature = "desktop")]
    {
        if simc_path.exists() {
            return Ok(simc_path.to_path_buf());
        }

        Err(
            "SimulationCraft is not available yet. Check your internet connection or update the SimC runtime from Settings."
                .to_string(),
        )
    }

    #[cfg(not(feature = "desktop"))]
    {
        if simc_path.exists() {
            Ok(simc_path.to_path_buf())
        } else {
            Err(format!("simc binary not found at: {}", simc_path.display()))
        }
    }
}

/// Sanitize user-provided custom SimC input by stripping dangerous directives.
pub(super) fn sanitize_custom_simc(input: &str) -> String {
    let blocked = regex::Regex::new(r"(?mi)^\s*(output|html|json2?|xml)\s*=").unwrap();
    input
        .lines()
        .filter(|line| !blocked.is_match(line))
        .collect::<Vec<_>>()
        .join("\n")
}

fn sanitize_simc_token(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    let ok = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '/' | ':' | '+'));
    if ok {
        Some(trimmed.to_string())
    } else {
        None
    }
}

pub(super) fn apply_shared_simc_options(
    simc_input: &str,
    options: &SimOptions,
    include_external_buffs: bool,
) -> String {
    let mut extra_lines: Vec<String> = Vec::new();

    if include_external_buffs {
        if options.raid_buff_customized {
            extra_lines.push(format!(
                "override.bloodlust={}",
                if options.raid_buff_bloodlust { 1 } else { 0 }
            ));
            extra_lines.push(format!(
                "override.arcane_intellect={}",
                if options.raid_buff_arcane_intellect {
                    1
                } else {
                    0
                }
            ));
            extra_lines.push(format!(
                "override.power_word_fortitude={}",
                if options.raid_buff_power_word_fortitude {
                    1
                } else {
                    0
                }
            ));
            extra_lines.push(format!(
                "override.battle_shout={}",
                if options.raid_buff_battle_shout { 1 } else { 0 }
            ));
            extra_lines.push(format!(
                "override.mark_of_the_wild={}",
                if options.raid_buff_mark_of_the_wild {
                    1
                } else {
                    0
                }
            ));
            extra_lines.push(format!(
                "override.hunters_mark={}",
                if options.raid_buff_hunters_mark { 1 } else { 0 }
            ));
            extra_lines.push(format!(
                "override.bleeding={}",
                if options.raid_buff_bleeding { 1 } else { 0 }
            ));
            extra_lines.push(format!(
                "override.mystic_touch={}",
                if options.external_buff_mystic_touch {
                    1
                } else {
                    0
                }
            ));
            extra_lines.push(format!(
                "override.chaos_brand={}",
                if options.external_buff_chaos_brand {
                    1
                } else {
                    0
                }
            ));
            extra_lines.push(format!(
                "override.skyfury={}",
                if options.external_buff_skyfury { 1 } else { 0 }
            ));
            extra_lines.push(format!(
                "override.blessing_of_the_bronze={}",
                if options.external_buff_blessing_of_bronze {
                    1
                } else {
                    0
                }
            ));
        } else {
            if options.external_buff_chaos_brand {
                extra_lines.push("override.chaos_brand=1".to_string());
            }
            if options.external_buff_mystic_touch {
                extra_lines.push("override.mystic_touch=1".to_string());
            }
            if options.external_buff_skyfury {
                extra_lines.push("override.skyfury=1".to_string());
            }
            if options.external_buff_blessing_of_bronze {
                extra_lines.push("override.blessing_of_the_bronze=1".to_string());
            }
        }

        if options.external_buff_power_infusion {
            extra_lines.push("external_buffs.power_infusion=0/120/240".to_string());
        }
        if options.external_buff_augmentation {
            extra_lines.push("dragonflight.brilliance_party=1".to_string());
        }
    }

    if let Some(v) = sanitize_simc_token(&options.consumable_flask) {
        extra_lines.push(format!("flask={}", v));
    }
    if let Some(v) = sanitize_simc_token(&options.consumable_food) {
        extra_lines.push(format!("food={}", v));
    }
    if let Some(v) = sanitize_simc_token(&options.consumable_potion) {
        extra_lines.push(format!("potion={}", v));
    }
    if let Some(v) = sanitize_simc_token(&options.consumable_augmentation) {
        extra_lines.push(format!("augmentation={}", v));
    }
    if let Some(v) = sanitize_simc_token(&options.consumable_temporary_enchant) {
        if !v.starts_with("off_hand:") {
            extra_lines.push(format!("temporary_enchant={}", v));
        }
    }

    if extra_lines.is_empty() {
        return simc_input.to_string();
    }

    let shared_opts = format!("\n# Shared Sim Options\n{}\n", extra_lines.join("\n"));

    if let Some(idx) = simc_input.find("### Combo 1") {
        let mut out = String::new();
        out.push_str(&simc_input[..idx]);
        out.push_str(&shared_opts);
        out.push_str(&simc_input[idx..]);
        out
    } else {
        let mut out = simc_input.to_string();
        out.push_str(&shared_opts);
        out
    }
}

/// Inject expert mode fields at the correct positions in the SimC profile.
///
/// For profileset sims (has `# Base Actor` and `### Combo` markers):
///   {header} → # Base Actor → {base lines} → {base_player} → ### Combo 1 →
///   {gear} → {raid_actors} → ### Combo 2..N → {post_combos} → {footer}
///
/// For quick sim (no markers):
///   {header} → {raw input} → {base_player} → {raid_actors} → {post_combos} → {footer}
pub(super) fn inject_expert_fields(simc_input: &str, options: &SimOptions) -> String {
    let header = sanitize_custom_simc(&options.simc_header);
    let base_player = sanitize_custom_simc(&options.simc_base_player);
    let custom_apl = sanitize_custom_simc(&options.custom_apl);
    let raid_actors = sanitize_custom_simc(&options.simc_raid_actors);
    let post_combos = sanitize_custom_simc(&options.simc_post_combos);
    let footer = sanitize_custom_simc(&options.simc_footer);

    let all_empty = header.trim().is_empty()
        && base_player.trim().is_empty()
        && custom_apl.trim().is_empty()
        && raid_actors.trim().is_empty()
        && post_combos.trim().is_empty()
        && footer.trim().is_empty();

    if all_empty {
        return simc_input.to_string();
    }

    let lines: Vec<&str> = simc_input.lines().collect();
    let has_base_actor = lines.iter().any(|l| l.trim() == "# Base Actor");

    if !has_base_actor {
        // Quick Sim: no markers, just concatenate in order
        let mut parts: Vec<&str> = Vec::new();
        if !header.trim().is_empty() {
            parts.push("# Header");
            parts.push(&header);
            parts.push("");
        }
        parts.push(simc_input);
        if !base_player.trim().is_empty() {
            parts.push("");
            parts.push("# Base Player Customization");
            parts.push(&base_player);
        }
        if !custom_apl.trim().is_empty() {
            parts.push("");
            parts.push("# Custom APL");
            parts.push(&custom_apl);
        }
        if !raid_actors.trim().is_empty() {
            parts.push("");
            parts.push("# Raid Actors");
            parts.push(&raid_actors);
        }
        if !post_combos.trim().is_empty() {
            parts.push("");
            parts.push("# Post Combination Actors");
            parts.push(&post_combos);
        }
        if !footer.trim().is_empty() {
            parts.push("");
            parts.push("# Footer");
            parts.push(&footer);
        }
        return parts.join("\n");
    }

    // Profileset sim: find markers and inject at the right positions
    let mut result: Vec<String> = Vec::new();
    let mut i = 0;
    let mut injected_base_player = false;
    let mut injected_raid_actors = false;
    let mut _last_combo_end = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim();

        // Inject header before "# Base Actor"
        if trimmed == "# Base Actor" && !header.trim().is_empty() {
            result.push("# Header".to_string());
            result.push(header.clone());
            result.push(String::new());
        }

        // Inject base_player and custom_apl before "### Combo 1"
        if trimmed == "### Combo 1" && !injected_base_player {
            if !base_player.trim().is_empty() {
                result.push("# Base Player Customization".to_string());
                result.push(base_player.clone());
                result.push(String::new());
            }
            if !custom_apl.trim().is_empty() {
                result.push("# Custom APL".to_string());
                result.push(custom_apl.clone());
                result.push(String::new());
            }
            injected_base_player = true;
        }

        // Inject raid_actors before "### Combo 2"
        if trimmed == "### Combo 2" && !raid_actors.trim().is_empty() && !injected_raid_actors {
            result.push("# Raid Actors".to_string());
            result.push(raid_actors.clone());
            result.push(String::new());
            injected_raid_actors = true;
        }

        result.push(lines[i].to_string());

        // Track end of combo blocks
        if trimmed.starts_with("### Combo") {
            _last_combo_end = result.len();
            // Scan ahead to find end of this combo block
            i += 1;
            while i < lines.len() {
                let next = lines[i].trim();
                if next.starts_with("### Combo") {
                    break; // start of next combo, don't consume
                }
                result.push(lines[i].to_string());
                _last_combo_end = result.len();
                i += 1;
            }
            continue;
        }

        i += 1;
    }

    // If raid_actors wasn't injected (only 1 combo / no Combo 2), inject after Combo 1 block
    if !injected_raid_actors && !raid_actors.trim().is_empty() {
        result.push(String::new());
        result.push("# Raid Actors".to_string());
        result.push(raid_actors);
    }

    // Post combos after all profilesets
    if !post_combos.trim().is_empty() {
        result.push(String::new());
        result.push("# Post Combination Actors".to_string());
        result.push(post_combos);
    }

    // Footer at the very end
    if !footer.trim().is_empty() {
        result.push(String::new());
        result.push("# Footer".to_string());
        result.push(footer);
    }

    result.join("\n")
}

/// Convert ResolveGearResponse slots into the items_by_slot ResolvedItem format
/// used by profileset_generator and game_data functions.
pub(super) fn resolve_to_items_by_slot(
    resolved: &ResolveGearResponse,
) -> HashMap<String, Vec<crate::types::ResolvedItem>> {
    let mut items_by_slot: HashMap<String, Vec<crate::types::ResolvedItem>> = HashMap::new();
    for (slot, slot_res) in &resolved.slots {
        let mut items: Vec<crate::types::ResolvedItem> = Vec::new();
        if let Some(eq) = &slot_res.equipped {
            items.push(eq.clone());
        }
        for alt in &slot_res.alternatives {
            items.push(alt.clone());
        }
        if !items.is_empty() {
            items_by_slot.insert(slot.clone(), items);
        }
    }
    items_by_slot
}

/// Replace the talents= line in a simc input string with a new talent string.
pub(super) fn apply_talent_override(simc_input: &str, talents: &str) -> String {
    if talents.is_empty() {
        return simc_input.to_string();
    }
    let re = regex::Regex::new(r"(?m)^talents=.+$").unwrap();
    if re.is_match(simc_input) {
        re.replace(simc_input, format!("talents={}", talents))
            .to_string()
    } else {
        format!("{}\ntalents={}", simc_input, talents)
    }
}

/// Replace the spec= line in a simc input string.
pub(super) fn apply_spec_override(simc_input: &str, spec: &str) -> String {
    if spec.is_empty() {
        return simc_input.to_string();
    }
    let re = regex::Regex::new(r"(?m)^spec=.+$").unwrap();
    if re.is_match(simc_input) {
        re.replace(simc_input, format!("spec={}", spec)).to_string()
    } else {
        format!("{}\nspec={}", simc_input, spec)
    }
}

/// Extract server= (realm), region= and talents= from a simc input string and inject it into a parsed result.
pub(super) fn inject_realm(parsed: &mut Value, simc_input: &str) {
    for line in simc_input.lines() {
        let trimmed = line.trim();
        if let Some(val) = trimmed.strip_prefix("server=") {
            parsed["realm"] = json!(val.trim_matches('"'));
        }
        if let Some(val) = trimmed.strip_prefix("region=") {
            parsed["region"] = json!(val.trim_matches('"'));
        }
        if let Some(val) = trimmed.strip_prefix("talents=") {
            parsed["talent_string"] = json!(val.trim_matches('"'));
        }
    }
}

/// Wait for a job's turn and transition it to running once a slot is available.
pub(super) async fn prepare_job_run(
    store: &Arc<dyn JobStorage>,
    job_id: &str,
) -> Option<simc_runner::SimulationAdmissionGuard> {
    loop {
        let Some(job) = store.get(job_id) else {
            return None;
        };

        match job.status {
            JobStatus::Pending => {
                let admission =
                    match simc_runner::acquire_simulation_slot(job_id, job.queue_order).await {
                        Ok(admission) => admission,
                        Err(_) => return None,
                    };
                if store.transition_status(job_id, JobStatus::Pending, JobStatus::Running) {
                    simc_runner::start_job_control(job_id);
                    return Some(admission);
                }
                drop(admission);
            }
            JobStatus::Paused => {
                if simc_runner::wait_until_resumed(job_id).await.is_err() {
                    return None;
                }
            }
            JobStatus::Running => {
                return simc_runner::acquire_simulation_slot(job_id, job.queue_order)
                    .await
                    .ok();
            }
            JobStatus::Done | JobStatus::Failed | JobStatus::Cancelled => return None,
        }
    }
}

fn recovered_combo_count(job: &Job) -> usize {
    job.combo_metadata_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|metadata| metadata.get("_combo_count").and_then(Value::as_u64))
        .and_then(|count| usize::try_from(count).ok())
        .filter(|count| *count > 0)
        .or_else(|| {
            let count = job
                .simc_input
                .lines()
                .filter(|line| line.trim_start().starts_with("### "))
                .count();
            (count > 0).then_some(count)
        })
        .unwrap_or(1)
}

/// Recreate runner tasks for pending jobs that survived a backend restart.
pub(super) fn recover_pending_jobs(
    store: Arc<dyn JobStorage>,
    auth: Arc<crate::server::auth_handlers::BlizzardAuthState>,
    simc: PathBuf,
    log_buffer: Arc<LogBuffer>,
) {
    for job in store.list_pending_jobs() {
        let job_id = job.id.clone();
        let options = job.options.clone().unwrap_or_else(|| json!({}));
        let combo_count = recovered_combo_count(&job);
        if is_staged_sim_type(&job.sim_type) {
            spawn_staged_sim(
                store.clone(),
                auth.clone(),
                simc.clone(),
                options,
                job_id,
                job.simc_input,
                combo_count,
                log_buffer.clone(),
            );
        } else {
            spawn_direct_sim(
                store.clone(),
                auth.clone(),
                simc.clone(),
                options,
                job_id,
                job.simc_input,
                log_buffer.clone(),
            );
        }
    }
}

pub(super) fn spawn_staged_sim(
    store: Arc<dyn JobStorage>,
    auth: Arc<crate::server::auth_handlers::BlizzardAuthState>,
    simc: PathBuf,
    options: Value,
    job_id: String,
    simc_input: String,
    combo_count: usize,
    log_buffer: Arc<LogBuffer>,
) {
    simc_runner::register_job_control(&job_id);
    tokio::spawn(async move {
        let Some(_admission) = prepare_job_run(&store, &job_id).await else {
            simc_runner::cleanup_job_control(&job_id);
            log_buffer.remove(&job_id);
            return;
        };
        let store_progress = store.clone();
        let store_stages = store.clone();
        let jid_progress = job_id.clone();
        let jid_stages = job_id.clone();
        let logs = log_buffer.clone();
        let jid_logs = job_id.clone();
        match simc_runner::run_simc_staged(
            &simc,
            &job_id,
            &simc_input,
            &options,
            combo_count,
            move |pct, stage, detail| {
                store_progress.update_progress(&jid_progress, pct, stage, detail);
            },
            move |summary| {
                store_stages.complete_stage(&jid_stages, summary);
            },
            move |line| {
                logs.push_line(&jid_logs, line.to_string());
            },
        )
        .await
        {
            Ok(output) => {
                let job_snap = store.get(&job_id);
                let combo_meta_val: Option<Value> = job_snap
                    .as_ref()
                    .and_then(|j| j.combo_metadata_json.as_ref())
                    .and_then(|s| serde_json::from_str(s).ok());

                let meta: Option<HashMap<String, Vec<Value>>> = combo_meta_val
                    .as_ref()
                    .and_then(|v| v.get("_combo_metadata").cloned())
                    .and_then(|v| serde_json::from_value(v).ok());

                let mut parsed = result_parser::parse_top_gear_result(&output.json, meta.as_ref());

                // Inject currencies if present in job metadata
                if let Some(currencies) = combo_meta_val.as_ref().and_then(|v| v.get("currencies"))
                {
                    if let Some(obj) = parsed.as_object_mut() {
                        obj.insert("currencies".to_string(), currencies.clone());
                    }
                }

                if let Some(baseline_live_stats) = job_snap
                    .as_ref()
                    .and_then(|j| j.options.as_ref())
                    .and_then(|options| options.get("baseline_live_stats"))
                    .filter(|stats| !stats.is_null())
                {
                    if let Some(obj) = parsed.as_object_mut() {
                        obj.insert(
                            "baseline_live_stats".to_string(),
                            baseline_live_stats.clone(),
                        );
                    }
                }

                inject_realm(&mut parsed, &simc_input);
                let result_str = serde_json::to_string(&parsed).unwrap_or_default();
                let raw_str = serde_json::to_string(&output.json).ok();
                store.set_result(&job_id, result_str, raw_str);
                store.set_report_files(&job_id, output.html_report, output.text_output);
                super::discord_webhook::spawn_sim_completion_notification(
                    store.clone(),
                    auth.clone(),
                    job_id.clone(),
                );
            }
            Err(e) => {
                // Don't overwrite cancelled status with a generic error
                let is_cancelled = store
                    .get(&job_id)
                    .map(|j| j.status == JobStatus::Cancelled)
                    .unwrap_or(false);
                if !is_cancelled {
                    store.set_error(&job_id, e.to_string());
                }
            }
        }
        log_buffer.remove(&job_id);
    });
}

pub(super) fn spawn_direct_sim(
    store: Arc<dyn JobStorage>,
    auth: Arc<crate::server::auth_handlers::BlizzardAuthState>,
    simc: PathBuf,
    options: Value,
    job_id: String,
    simc_input: String,
    log_buffer: Arc<LogBuffer>,
) {
    simc_runner::register_job_control(&job_id);
    tokio::spawn(async move {
        let Some(_admission) = prepare_job_run(&store, &job_id).await else {
            simc_runner::cleanup_job_control(&job_id);
            log_buffer.remove(&job_id);
            return;
        };
        store.update_progress(&job_id, 20, "Simulating", "");
        let logs = log_buffer.clone();
        let store_progress = store.clone();
        let progress_job_id = job_id.clone();
        let log_job_id = job_id.clone();

        match simc_runner::run_simc(
            &simc,
            &job_id,
            &simc_input,
            &options,
            move |current, total| {
                let pct = 20 + ((current as f64 / total as f64) * 80.0) as u8;
                store_progress.update_progress(
                    &progress_job_id,
                    pct,
                    "Simulating",
                    &format!("{}/{} iterations", current, total),
                );
            },
            move |line| {
                logs.push_line(&log_job_id, line.to_string());
            },
        )
        .await
        {
            Ok(output) => {
                let mut parsed = result_parser::parse_simc_result(&output.json, true);
                if let Some(job_snap) = store.get(&job_id) {
                    if let Some(baseline_live_stats) = job_snap
                        .options
                        .as_ref()
                        .and_then(|options| options.get("baseline_live_stats"))
                        .filter(|stats| !stats.is_null())
                    {
                        if let Some(obj) = parsed.as_object_mut() {
                            obj.insert(
                                "baseline_live_stats".to_string(),
                                baseline_live_stats.clone(),
                            );
                        }
                    }
                }
                inject_realm(&mut parsed, &simc_input);
                let result_str = serde_json::to_string(&parsed).unwrap_or_default();
                let raw_str = serde_json::to_string(&output.json).ok();
                store.set_result(&job_id, result_str, raw_str);
                store.set_report_files(&job_id, output.html_report, output.text_output);
                super::discord_webhook::spawn_sim_completion_notification(
                    store.clone(),
                    auth,
                    job_id.clone(),
                );
            }
            Err(error) => {
                let is_cancelled = store
                    .get(&job_id)
                    .map(|job| job.status == JobStatus::Cancelled)
                    .unwrap_or(false);
                if !is_cancelled {
                    store.set_error(&job_id, error.to_string());
                }
            }
        }
        log_buffer.remove(&job_id);
    });
}

/// Validate batch_id against MAX_SCENARIOS. Returns an error response if rejected.
pub(super) fn validate_batch(
    owner_id: &str,
    batch_id: &Option<String>,
    store: &dyn JobStorage,
) -> Option<actix_web::HttpResponse> {
    let bid = match batch_id {
        Some(b) if !b.is_empty() => b,
        _ => return None,
    };
    let max = *storage::MAX_SCENARIOS;
    if max == 0 {
        return Some(actix_web::HttpResponse::BadRequest().json(json!({
            "detail": "Batch scenarios are disabled on this server."
        })));
    }
    if store.count_batch_owned(owner_id, bid) >= max {
        return Some(actix_web::HttpResponse::BadRequest().json(json!({
            "detail": format!("Batch limit reached ({max} scenarios max).")
        })));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Job;
    use crate::storage::MemoryStorage;
    use crate::types::{CharacterResolveInfo, ResolveGearResponse, ResolvedItem, SlotResolution};
    use actix_web::body::to_bytes;
    use std::collections::HashMap;

    fn sim_options(value: Value) -> SimOptions {
        serde_json::from_value(value).expect("sim options")
    }

    fn job_in_batch(batch_id: &str) -> Job {
        let mut job = Job::new(
            "warrior=tester".to_string(),
            "quick".to_string(),
            1000,
            "Patchwerk".to_string(),
            0.05,
        );
        job.batch_id = Some(batch_id.to_string());
        job
    }

    #[test]
    fn sanitize_custom_simc_strips_output_directives_and_keeps_safe_lines() {
        let sanitized = sanitize_custom_simc(
            "actions+=/use_item,name=safe\n output=/tmp/out.simc\nHTML=report.html\njson2=report.json\nxml=report.xml\n# keep comment",
        );

        assert!(sanitized.contains("actions+=/use_item,name=safe"));
        assert!(sanitized.contains("# keep comment"));
        assert!(!sanitized.contains("output=/tmp/out.simc"));
        assert!(!sanitized.contains("HTML=report.html"));
        assert!(!sanitized.contains("json2=report.json"));
        assert!(!sanitized.contains("xml=report.xml"));
    }

    #[test]
    fn sanitize_custom_simc_keeps_safe_directive_prefixes() {
        let sanitized = sanitize_custom_simc(
            "output_mode=summary\nhtml_safe=1\njson_profile=1\nxml_setting=enabled",
        );

        assert_eq!(
            sanitized,
            "output_mode=summary\nhtml_safe=1\njson_profile=1\nxml_setting=enabled"
        );
    }

    #[test]
    fn inject_expert_fields_sanitizes_all_user_provided_sections() {
        let options = sim_options(json!({
            "simc_header": "default_actions=1\noutput=/tmp/header.simc",
            "simc_base_player": "copy=base\nhtml=base.html",
            "custom_apl": "actions+=/spell\njson=apl.json",
            "simc_raid_actors": "priest=helper\nxml=raid.xml",
            "simc_post_combos": "hunter=post\njson2=post.json",
            "simc_footer": "iterations=1000\n output=footer.simc"
        }));

        let injected = inject_expert_fields("warrior=tester", &options);

        assert!(injected.contains("default_actions=1"));
        assert!(injected.contains("copy=base"));
        assert!(injected.contains("actions+=/spell"));
        assert!(injected.contains("priest=helper"));
        assert!(injected.contains("hunter=post"));
        assert!(injected.contains("iterations=1000"));
        assert!(!injected.contains("output=/tmp/header.simc"));
        assert!(!injected.contains("html=base.html"));
        assert!(!injected.contains("json=apl.json"));
        assert!(!injected.contains("xml=raid.xml"));
        assert!(!injected.contains("json2=post.json"));
        assert!(!injected.contains("output=footer.simc"));
    }

    #[test]
    fn inject_expert_fields_adds_raid_actors_after_single_combo_profileset() {
        let options = sim_options(json!({
            "simc_raid_actors": "priest=helper"
        }));
        let input = "# Base Actor\nmage=tester\n### Combo 1\nprofileset.\"one\"+=talents=abc";

        let injected = inject_expert_fields(input, &options);

        assert!(injected.contains(
            "### Combo 1\nprofileset.\"one\"+=talents=abc\n\n# Raid Actors\npriest=helper"
        ));
    }

    #[test]
    fn apply_shared_simc_options_filters_unsafe_consumable_tokens() {
        let options = sim_options(json!({
            "consumable_flask": "safe_flask",
            "consumable_food": "bad food;rm",
            "consumable_potion": "potion/name:rank+3",
            "consumable_augmentation": "augmentation$(bad)",
            "consumable_temporary_enchant": "off_hand:ignored"
        }));

        let input = "mage=tester\n### Combo 1\nprofileset.\"one\"+=item=1";
        let output = apply_shared_simc_options(input, &options, false);

        assert!(output.contains("flask=safe_flask"));
        assert!(output.contains("potion=potion/name:rank+3"));
        assert!(!output.contains("bad food;rm"));
        assert!(!output.contains("augmentation$(bad)"));
        assert!(!output.contains("temporary_enchant=off_hand:ignored"));
        assert!(
            output.find("# Shared Sim Options").expect("shared options")
                < output.find("### Combo 1").expect("combo marker")
        );
    }

    #[test]
    fn apply_shared_simc_options_includes_customized_buffs_and_appends_without_combo_marker() {
        let options = sim_options(json!({
            "raid_buff_customized": true,
            "raid_buff_bloodlust": false,
            "raid_buff_arcane_intellect": true,
            "raid_buff_power_word_fortitude": false,
            "raid_buff_battle_shout": true,
            "raid_buff_mark_of_the_wild": false,
            "raid_buff_hunters_mark": true,
            "raid_buff_bleeding": false,
            "external_buff_mystic_touch": true,
            "external_buff_chaos_brand": false,
            "external_buff_skyfury": true,
            "external_buff_blessing_of_bronze": false,
            "external_buff_power_infusion": true,
            "external_buff_augmentation": true
        }));

        let output = apply_shared_simc_options("mage=tester", &options, true);

        assert!(output.contains("override.bloodlust=0"));
        assert!(output.contains("override.arcane_intellect=1"));
        assert!(output.contains("override.battle_shout=1"));
        assert!(output.contains("override.mystic_touch=1"));
        assert!(output.contains("override.skyfury=1"));
        assert!(output.contains("external_buffs.power_infusion=0/120/240"));
        assert!(output.contains("dragonflight.brilliance_party=1"));
        assert!(output.ends_with('\n'));
    }

    #[test]
    fn override_helpers_replace_existing_lines_or_append_when_missing() {
        assert_eq!(
            apply_talent_override("warrior=tester\ntalents=old", "newbuild"),
            "warrior=tester\ntalents=newbuild"
        );
        assert_eq!(
            apply_talent_override("warrior=tester", "newbuild"),
            "warrior=tester\ntalents=newbuild"
        );
        assert_eq!(
            apply_spec_override("warrior=tester\nspec=arms", "fury"),
            "warrior=tester\nspec=fury"
        );
        assert_eq!(
            apply_spec_override("warrior=tester", "fury"),
            "warrior=tester\nspec=fury"
        );
    }

    #[test]
    fn resolve_to_items_by_slot_and_inject_realm_preserve_expected_metadata() {
        let resolved = ResolveGearResponse {
            character: CharacterResolveInfo {
                class_name: Some("mage".to_string()),
                spec: Some("arcane".to_string()),
                can_dual_wield: false,
                can_use_offhand: true,
            },
            base_profile: "mage=tester".to_string(),
            slots: HashMap::from([
                (
                    "head".to_string(),
                    SlotResolution {
                        equipped: Some(ResolvedItem {
                            uid: "head-1".to_string(),
                            slot: "head".to_string(),
                            item_id: 1001,
                            ..Default::default()
                        }),
                        alternatives: vec![ResolvedItem {
                            uid: "head-2".to_string(),
                            slot: "head".to_string(),
                            item_id: 1002,
                            ..Default::default()
                        }],
                    },
                ),
                (
                    "neck".to_string(),
                    SlotResolution {
                        equipped: None,
                        alternatives: vec![],
                    },
                ),
            ]),
            excluded: vec![],
            talent_loadouts: vec![],
            catalyst_charges: None,
        };

        let items_by_slot = resolve_to_items_by_slot(&resolved);
        assert_eq!(items_by_slot.len(), 1);
        assert_eq!(items_by_slot["head"].len(), 2);
        assert_eq!(items_by_slot["head"][0].item_id, 1001);
        assert_eq!(items_by_slot["head"][1].item_id, 1002);

        let mut parsed = json!({});
        inject_realm(
            &mut parsed,
            "mage=Tester\nserver=\"area-52\"\nregion=\"us\"\ntalents=\"abc123\"",
        );
        assert_eq!(parsed["realm"].as_str(), Some("area-52"));
        assert_eq!(parsed["region"].as_str(), Some("us"));
        assert_eq!(parsed["talent_string"].as_str(), Some("abc123"));
    }

    #[actix_web::test]
    async fn validate_batch_allows_empty_and_under_limit_batches() {
        let store = MemoryStorage::new();

        assert!(validate_batch("local-guest", &None, &store).is_none());
        assert!(validate_batch("local-guest", &Some(String::new()), &store).is_none());

        let max = *storage::MAX_SCENARIOS;
        for _ in 0..max.saturating_sub(1) {
            store.insert(job_in_batch("batch-a"));
        }

        assert!(validate_batch("local-guest", &Some("batch-a".to_string()), &store).is_none());
    }

    #[actix_web::test]
    async fn validate_batch_rejects_batches_at_max_scenarios() {
        let store = MemoryStorage::new();
        let max = *storage::MAX_SCENARIOS;
        for _ in 0..max {
            store.insert(job_in_batch("batch-full"));
        }

        let resp = validate_batch("local-guest", &Some("batch-full".to_string()), &store)
            .expect("batch should be rejected");
        assert_eq!(resp.status(), 400);

        let body = to_bytes(resp.into_body()).await.expect("response body");
        let payload: Value = serde_json::from_slice(&body).expect("json body");
        assert!(payload
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("Batch limit reached"));
    }
}
