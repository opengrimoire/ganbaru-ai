//! Device snapshot discovery, vault path checks, and runtime freshness.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer};
use std::path::{Path, PathBuf};

use crate::config::{DoomscrollingConfig, default_config, read_config};
use crate::{NativeResponse, now_utc};

const STATE_FILE: &str = "doomscrolling-state.json";
const LIMIT_STATE_FILE: &str = "doomscrolling-limit-state.json";
const APP_STATE_FILE: &str = "app-state.json";
const CONFIG_FILE: &str = "config.json";
const APP_SQLITE_FILE: &str = "ganbaru-ai.sqlite";
const STALE_STATE_SECONDS: i64 = 75;
const ACTIVE_STATE_STALE_SECONDS: i64 = 45;
const LIMIT_STATE_STALE_SECONDS: i64 = 20;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeState {
    pub(super) active: bool,
    pub(super) paused: bool,
    #[serde(deserialize_with = "required_nullable")]
    pub(super) pause_reason: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub(super) active_run_id: Option<String>,
    pub(super) phase: String,
    #[serde(deserialize_with = "required_nullable")]
    pub(super) remaining_seconds: Option<i64>,
    pub(super) updated_at: String,
}

#[derive(Debug)]
pub(super) struct StateSnapshot {
    pub(super) config_dir: Option<PathBuf>,
    pub(super) vault_path: Option<PathBuf>,
    pub(super) config: DoomscrollingConfig,
    pub(super) runtime: Option<RuntimeState>,
    pub(super) limit_state: Option<LimitState>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LimitState {
    pub(super) local_date: String,
    pub(super) week_start_local_date: String,
    pub(super) updated_at: String,
    pub(super) database_path: String,
    pub(super) limits: Vec<LimitStateItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    #[serde(deserialize_with = "required_nullable")]
    active_vault_path: Option<String>,
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LimitStateItem {
    pub(super) id: String,
    pub(super) period: String,
    pub(super) window_start_local_date: String,
    pub(super) window_end_local_date: String,
    pub(super) used_seconds: i64,
    pub(super) limit_seconds: i64,
    pub(super) remaining_seconds: i64,
    pub(super) exhausted: bool,
}

pub(super) fn load_snapshot() -> StateSnapshot {
    let config_dir = config_dir_candidates().into_iter().find(|dir| {
        dir.join(STATE_FILE).exists()
            || dir.join(LIMIT_STATE_FILE).exists()
            || dir.join(APP_STATE_FILE).exists()
    });
    let vault_path = config_dir
        .as_ref()
        .and_then(|dir| read_app_state(&dir.join(APP_STATE_FILE)))
        .and_then(active_vault_path_from_state);
    let config = vault_path
        .as_ref()
        .and_then(|dir| read_config(&dir.join(CONFIG_FILE)))
        .unwrap_or_else(default_config);
    let runtime = config_dir
        .as_ref()
        .and_then(|dir| read_runtime_state(&dir.join(STATE_FILE)));
    let limit_state = config_dir
        .as_ref()
        .and_then(|dir| read_limit_state(&dir.join(LIMIT_STATE_FILE), vault_path.as_deref()));
    StateSnapshot {
        config_dir,
        vault_path,
        config,
        runtime,
        limit_state,
    }
}

pub(super) fn config_dir_candidates() -> Vec<PathBuf> {
    if let Ok(dir) = std::env::var("GANBARU_AI_CONFIG_DIR") {
        return vec![PathBuf::from(dir)];
    }

    let ids = [
        "org.opengrimoire.ganbaruai",
        "org.opengrimoire.ganbaruai.dev",
    ];
    let mut candidates = Vec::new();

    #[cfg(target_os = "linux")]
    {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")));
        if let Some(base) = base {
            for id in ids {
                candidates.push(base.join(id));
            }
        }
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        let base = home.join("Library").join("Application Support");
        for id in ids {
            candidates.push(base.join(id));
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
        for id in ids {
            candidates.push(appdata.join(id));
        }
    }

    candidates
}

fn read_runtime_state(path: &std::path::Path) -> Option<RuntimeState> {
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn read_app_state(path: &std::path::Path) -> Option<AppState> {
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn active_vault_path_from_state(state: AppState) -> Option<PathBuf> {
    let path = PathBuf::from(state.active_vault_path?);
    if !path.is_absolute() || !path.is_dir() {
        return None;
    }
    path.join("vault.json").exists().then_some(path)
}

fn read_limit_state(path: &std::path::Path, vault_path: Option<&Path>) -> Option<LimitState> {
    let contents = std::fs::read_to_string(path).ok()?;
    let state: LimitState = serde_json::from_str(&contents).ok()?;
    limit_state_is_fresh(&state, vault_path).then_some(state)
}

pub(super) fn runtime_status(
    snapshot: &StateSnapshot,
) -> (bool, String, Option<i64>, Option<String>) {
    runtime_status_at(snapshot, now_utc())
}

pub(super) fn runtime_status_at(
    snapshot: &StateSnapshot,
    checked_at: DateTime<Utc>,
) -> (bool, String, Option<i64>, Option<String>) {
    if !snapshot.config.enabled {
        return (
            false,
            "inactive".to_string(),
            None,
            Some("Doomscrolling disabled".to_string()),
        );
    }

    let Some(runtime) = &snapshot.runtime else {
        return (
            false,
            "inactive".to_string(),
            None,
            Some("no runtime state".to_string()),
        );
    };

    let Ok(updated_at) = DateTime::parse_from_rfc3339(&runtime.updated_at) else {
        return (
            false,
            "inactive".to_string(),
            None,
            Some("runtime state has invalid timestamp".to_string()),
        );
    };
    let age_seconds = (checked_at - updated_at.with_timezone(&Utc))
        .num_seconds()
        .max(0);
    let stale_state_seconds = if runtime.active {
        ACTIVE_STATE_STALE_SECONDS
    } else {
        STALE_STATE_SECONDS
    };
    if age_seconds > stale_state_seconds {
        return (
            false,
            "inactive".to_string(),
            None,
            Some("runtime state is stale".to_string()),
        );
    }

    let remaining_seconds = runtime.remaining_seconds.map(|remaining| {
        if runtime.paused {
            remaining
        } else {
            (remaining - age_seconds).max(0)
        }
    });
    (
        runtime.active,
        runtime.phase.clone(),
        remaining_seconds,
        None,
    )
}

pub(super) fn should_enforce(snapshot: &StateSnapshot, response: &mut NativeResponse) -> bool {
    if !response.active {
        return false;
    }

    if snapshot
        .runtime
        .as_ref()
        .is_some_and(pause_should_suspend_enforcement)
        && snapshot.config.pause_during_focus_pause
    {
        return false;
    }

    match response.phase.as_str() {
        "focus" => snapshot.config.block_during_focus,
        "short_break" => snapshot.config.block_during_short_breaks,
        "long_break" => snapshot.config.block_during_long_breaks,
        _ => false,
    }
}

fn pause_should_suspend_enforcement(runtime: &RuntimeState) -> bool {
    runtime.paused && !matches!(runtime.pause_reason.as_deref(), Some("idle" | "suspend"))
}

pub(super) fn valid_local_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn database_path_is_allowed(path: &Path, vault_path: Option<&Path>) -> bool {
    if !path.is_absolute()
        || path.file_name().and_then(|name| name.to_str()) != Some(APP_SQLITE_FILE)
    {
        return false;
    }
    match vault_path {
        Some(vault_path) => path == vault_path.join(APP_SQLITE_FILE),
        None => true,
    }
}

pub(super) fn usage_db_path(vault_path: &Path, limit_state: Option<&LimitState>) -> PathBuf {
    limit_state
        .map(|state| PathBuf::from(&state.database_path))
        .filter(|path| database_path_is_allowed(path, Some(vault_path)))
        .unwrap_or_else(|| vault_path.join(APP_SQLITE_FILE))
}

fn limit_state_is_fresh(state: &LimitState, vault_path: Option<&Path>) -> bool {
    if !valid_local_date(&state.local_date) {
        return false;
    }
    if !valid_local_date(&state.week_start_local_date) {
        return false;
    }
    if state.limits.iter().any(|limit| {
        !matches!(limit.period.as_str(), "day" | "week")
            || !valid_local_date(&limit.window_start_local_date)
            || !valid_local_date(&limit.window_end_local_date)
            || limit.window_start_local_date > limit.window_end_local_date
    }) {
        return false;
    }
    if !database_path_is_allowed(Path::new(&state.database_path), vault_path) {
        return false;
    }
    let Ok(updated_at) = DateTime::parse_from_rfc3339(&state.updated_at) else {
        return false;
    };
    let age_seconds = (now_utc() - updated_at.with_timezone(&Utc))
        .num_seconds()
        .max(0);
    age_seconds <= LIMIT_STATE_STALE_SECONDS
}
