use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsRuntimeState {
    pub(crate) active: bool,
    pub(crate) paused: bool,
    pub(crate) pause_reason: Option<String>,
    pub(crate) phase: String,
    pub(crate) active_run_id: Option<String>,
    pub(crate) active_occurrence_id: Option<String>,
    pub(crate) remaining_seconds: Option<i64>,
    pub(crate) updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) valid_until_ms: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DistractionsExtensionConnectionFile {
    pub(super) last_seen_at: String,
    pub(super) last_message_type: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsExtensionStatus {
    pub(crate) connected: bool,
    pub(crate) last_seen_at: Option<String>,
    pub(crate) last_message_type: Option<String>,
    pub(crate) checked_at: String,
    pub(crate) stale_seconds: i64,
    pub(crate) reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsUsageSampleInput {
    pub(crate) id: Option<String>,
    pub(crate) source_type: String,
    pub(crate) source_key: String,
    pub(crate) display_name: Option<String>,
    pub(crate) started_at_ms: i64,
    pub(crate) elapsed_seconds: i64,
    pub(crate) local_date: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsDesktopBlockEventInput {
    pub(crate) app_name: String,
    pub(crate) process_name: Option<String>,
    pub(crate) process_id: Option<u32>,
}

pub(super) struct NormalizedDesktopBlockEvent {
    pub(super) source_key: String,
    pub(super) display_name: Option<String>,
    pub(super) process_id: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsUsageSampleRow {
    pub(crate) id: String,
    pub(crate) source_type: String,
    pub(crate) source_key: String,
    pub(crate) display_name: Option<String>,
    pub(crate) started_at_ms: i64,
    pub(crate) elapsed_seconds: i64,
    pub(crate) local_date: String,
    pub(crate) created_at_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsLimitState {
    pub(crate) local_date: String,
    pub(crate) week_start_local_date: String,
    pub(crate) updated_at: String,
    #[serde(default)]
    pub(crate) database_path: Option<String>,
    #[serde(default)]
    pub(crate) configuration_digest: Option<String>,
    pub(crate) limits: Vec<DistractionsLimitStateItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsLimitStateItem {
    pub(crate) id: String,
    pub(crate) period: String,
    pub(crate) window_start_local_date: String,
    pub(crate) window_end_local_date: String,
    pub(crate) used_seconds: i64,
    pub(crate) limit_seconds: i64,
    pub(crate) remaining_seconds: i64,
    pub(crate) exhausted: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsForegroundDesktopAppStatus {
    pub(crate) available: bool,
    pub(crate) app_name: Option<String>,
    pub(crate) process_name: Option<String>,
    pub(crate) process_id: Option<u32>,
    #[serde(skip_serializing)]
    pub(crate) process_identity: Option<String>,
    pub(crate) match_names: Vec<String>,
    pub(crate) reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsForegroundDesktopAppExpectation {
    pub(crate) app_name: Option<String>,
    pub(crate) process_name: Option<String>,
    pub(crate) process_id: Option<u32>,
    #[serde(default)]
    pub(crate) process_identity: Option<String>,
    pub(crate) match_names: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsDesktopAppCandidate {
    pub(crate) name: String,
    pub(crate) source: String,
    pub(crate) detail: Option<String>,
    pub(crate) process_names: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsDesktopAppRuleInput {
    pub(crate) rule_identity: DistractionsDesktopRuleIdentity,
    pub(crate) name: String,
    pub(crate) match_names: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DistractionsDesktopRuleIdentity {
    DesktopApp { rule_id: String },
    UsageLimit { rule_id: String, entry_id: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsRunningDesktopAppMatch {
    pub(crate) app_name: String,
    pub(crate) process_name: String,
    pub(crate) process_id: u32,
    pub(crate) process_identity: String,
    pub(crate) rule_identity: DistractionsDesktopRuleIdentity,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistractionsCloseDesktopAppRequest {
    pub(crate) process_id: u32,
    pub(crate) process_name: String,
    pub(crate) process_identity: String,
    pub(crate) rule_identity: DistractionsDesktopRuleIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[cfg(any(target_os = "linux", test))]
pub(super) struct ObservedDesktopProcess {
    pub(super) process_name: String,
    pub(super) match_names: Vec<String>,
    pub(super) process_identity: String,
}

#[derive(Clone, Debug)]
#[cfg(any(target_os = "linux", test))]
pub(super) struct DesktopRuleMatcher {
    pub(super) app_name: String,
    pub(super) rule_identity: DistractionsDesktopRuleIdentity,
}
