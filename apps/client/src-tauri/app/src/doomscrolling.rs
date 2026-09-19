use crate::vault;
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{Manager, Runtime};

mod authorization;
pub(crate) mod catalog;
pub(crate) mod commands;
mod contracts;
mod foreground;
mod process_control;
mod processes;
mod rules;
pub(crate) mod state;
pub(crate) mod usage;

#[cfg(any(target_os = "linux", test))]
use contracts::{DesktopRuleMatcher, ObservedDesktopProcess};
#[allow(unused_imports)]
pub use contracts::{
    DoomscrollingCloseDesktopAppRequest, DoomscrollingCloseForegroundDesktopAppRequest,
    DoomscrollingDesktopAppCandidate, DoomscrollingDesktopAppRuleInput,
    DoomscrollingDesktopBlockEventInput, DoomscrollingDesktopRuleIdentity,
    DoomscrollingExtensionStatus, DoomscrollingForegroundDesktopAppExpectation,
    DoomscrollingForegroundDesktopAppStatus, DoomscrollingLimitState, DoomscrollingLimitStateItem,
    DoomscrollingRunningDesktopAppMatch, DoomscrollingRuntimeState, DoomscrollingUsageSampleInput,
    DoomscrollingUsageSampleRow,
};
use contracts::{DoomscrollingExtensionConnectionFile, NormalizedDesktopBlockEvent};

use authorization::{load_close_authorization, validate_names_authorized};
use foreground::{close_current_foreground_desktop_app, foreground_desktop_app_status};
use process_control::close_desktop_process;
use processes::list_blocked_desktop_app_matches;
#[cfg(target_os = "linux")]
use processes::{observe_linux_process, read_linux_process_name};
#[cfg(any(target_os = "linux", test))]
use rules::desktop_rule_matchers;
use rules::{
    app_name_key, foreground_expectation_matches, foreground_status_from_parts,
    foreground_status_match_names, is_protected_desktop_app_candidate,
    is_protected_desktop_app_name, normalize_app_candidate_name, normalize_process_match_name,
    normalize_process_match_names, unavailable_foreground_desktop_app_status,
    validate_foreground_status_is_closeable,
};
pub use state::clear_doomscrolling_enforcement_state;
use state::{
    block_event_phase_from_runtime, limit_state_path, read_fresh_limit_state,
    read_fresh_runtime_state, state_path,
};
use usage::validate_local_date;

#[cfg(test)]
use state::{
    clear_enforcement_state_files, extension_status_from_file_contents, validate_limit_state,
    validate_state, write_text_file_atomically,
};

#[cfg(test)]
use usage::{
    insert_desktop_block_event, insert_usage_samples, normalize_desktop_block_event,
    normalize_usage_sample,
};

#[cfg(test)]
use catalog::{parse_desktop_entry, sort_and_deduplicate_candidates};

#[cfg(all(test, target_os = "linux"))]
use catalog::process_name_from_exec;

#[cfg(test)]
use authorization::{configured_close_authorization, read_bounded_authorization_config};

#[cfg(all(test, target_os = "linux"))]
use process_control::{
    DesktopProcessController, DesktopProcessSignal, close_desktop_process_with,
    validate_observed_close_process,
};

const STATE_FILE: &str = "doomscrolling-state.json";
const EXTENSION_CONNECTION_FILE: &str = "doomscrolling-extension-status.json";
const LIMIT_STATE_FILE: &str = "doomscrolling-limit-state.json";
const VAULT_CONFIG_FILE: &str = "config.json";
const MAX_AUTHORIZATION_CONFIG_BYTES: u64 = 1024 * 1024;
const LIMIT_STATE_STALE_SECONDS: i64 = 20;
const EXTENSION_CONNECTION_STALE_SECONDS: i64 = 60;
const ACTIVE_STATE_STALE_SECONDS: i64 = 45;
static DESKTOP_APP_LIST_GENERATION: AtomicU64 = AtomicU64::new(0);
static PROCESS_SCAN_GENERATION: AtomicU64 = AtomicU64::new(0);
static FOREGROUND_OBSERVATION_GENERATION: AtomicU64 = AtomicU64::new(0);
const EXTENSION_INSTALL_README_URL: &str =
    "https://github.com/opengrimoire/ganbaru-ai/blob/dev/extensions/chrome/README.md";

fn now_utc() -> DateTime<Utc> {
    std::time::SystemTime::now().into()
}

fn now_epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
