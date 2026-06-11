use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::raw_sql;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::OnceLock;

// Chromium native messaging host names allow underscores but not hyphens.
const HOST_NAME: &str = "org.opengrimoire.ganbaru_ai.doomscrolling";
const DEV_HOST_NAME: &str = "org.opengrimoire.ganbaru_ai.doomscrolling_dev";
const STATE_FILE: &str = "doomscrolling-state.json";
const LIMIT_STATE_FILE: &str = "doomscrolling-limit-state.json";
const EXTENSION_CONNECTION_FILE: &str = "doomscrolling-extension-status.json";
const EVENTS_FILE: &str = "doomscrolling-events.jsonl";
const APP_STATE_FILE: &str = "app-state.json";
const CONFIG_FILE: &str = "config.json";
const APP_SQLITE_FILE: &str = "ganbaru-ai.sqlite";
const STALE_STATE_SECONDS: i64 = 75;
const ACTIVE_STATE_STALE_SECONDS: i64 = 45;
const LIMIT_STATE_STALE_SECONDS: i64 = 20;
const USAGE_SAMPLE_TABLE_SQL: &str = "
    CREATE TABLE IF NOT EXISTS doomscrolling_usage_samples (
        id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
        source_type TEXT NOT NULL CHECK (source_type IN ('website', 'desktop-app', 'mobile-app')),
        source_key TEXT NOT NULL CHECK (trim(source_key) <> ''),
        display_name TEXT,
        started_at INTEGER NOT NULL CHECK (started_at >= 0),
        elapsed_seconds INTEGER NOT NULL CHECK (elapsed_seconds > 0 AND elapsed_seconds <= 86400),
        local_date TEXT NOT NULL CHECK (
            length(local_date) = 10
            AND substr(local_date, 5, 1) = '-'
            AND substr(local_date, 8, 1) = '-'
        ),
        created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_doomscrolling_usage_samples_date_source
        ON doomscrolling_usage_samples(local_date, source_type, source_key);
    CREATE INDEX IF NOT EXISTS idx_doomscrolling_usage_samples_started
        ON doomscrolling_usage_samples(started_at);
";
const BLOCK_EVENT_TABLE_SQL: &str = "
    CREATE TABLE IF NOT EXISTS doomscrolling_block_events (
        id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
        run_id TEXT REFERENCES pomodoro_runs(id) ON DELETE SET NULL,
        segment_id TEXT REFERENCES pomodoro_segments(id) ON DELETE SET NULL,
        occurred_at TEXT NOT NULL CHECK (trim(occurred_at) <> ''),
        source_type TEXT NOT NULL CHECK (source_type IN ('browser', 'desktop_app', 'mobile_app')),
        source_key TEXT NOT NULL CHECK (trim(source_key) <> '' AND instr(source_key, '://') = 0),
        display_name TEXT,
        phase TEXT CHECK (
            phase IS NULL OR
            phase IN ('focus', 'short_break', 'long_break', 'manual_pause', 'idle_pause', 'suspend_pause')
        ),
        decision TEXT NOT NULL CHECK (
            decision IN ('blocked', 'temporary_allowed', 'false_positive_reported', 'limit_exhausted')
        ),
        rule_id TEXT,
        category_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_doomscrolling_block_events_run
        ON doomscrolling_block_events(run_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_doomscrolling_block_events_source
        ON doomscrolling_block_events(source_type, source_key, occurred_at);
    CREATE TABLE IF NOT EXISTS doomscrolling_block_event_rule_snapshots (
        block_event_id TEXT PRIMARY KEY REFERENCES doomscrolling_block_events(id) ON DELETE CASCADE,
        rule_id TEXT,
        rule_kind TEXT CHECK (
            rule_kind IS NULL OR
            rule_kind IN ('domain', 'url_pattern', 'category', 'custom_category', 'usage_limit', 'desktop_app')
        ),
        rule_label TEXT,
        environment_id TEXT,
        blocker_mode TEXT CHECK (
            blocker_mode IS NULL OR
            blocker_mode IN ('blacklist', 'whitelist', 'limit')
        )
    );
";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltInCategory {
    id: String,
    label: String,
    #[serde(default)]
    hosts: Vec<String>,
    #[serde(default)]
    domain_keywords: Vec<String>,
    #[serde(default)]
    reddit_subreddit_keywords: Vec<String>,
}

const BUILT_IN_CATEGORIES_JSON: &str =
    include_str!("../../../src/lib/doomscrolling/categories.json");

fn built_in_categories() -> &'static [BuiltInCategory] {
    static CATEGORIES: OnceLock<Vec<BuiltInCategory>> = OnceLock::new();
    CATEGORIES
        .get_or_init(|| parse_built_in_categories(BUILT_IN_CATEGORIES_JSON))
        .as_slice()
}

fn parse_built_in_categories(json: &str) -> Vec<BuiltInCategory> {
    let categories: Vec<BuiltInCategory> =
        serde_json::from_str(json).expect("embedded doomscrolling categories must be valid JSON");
    let mut seen_ids = HashSet::new();
    for category in &categories {
        assert!(
            !category.id.trim().is_empty(),
            "embedded doomscrolling category id must not be empty"
        );
        assert!(
            !category.label.trim().is_empty(),
            "embedded doomscrolling category label must not be empty"
        );
        assert!(
            seen_ids.insert(category.id.as_str()),
            "embedded doomscrolling category ids must be unique"
        );
    }
    categories
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeRequest {
    #[serde(rename = "type")]
    message_type: String,
    url: Option<String>,
    host: Option<String>,
    log_event: Option<bool>,
    source_type: Option<String>,
    source_key: Option<String>,
    display_name: Option<String>,
    elapsed_seconds: Option<i64>,
    started_at: Option<i64>,
    local_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeResponse {
    #[serde(rename = "type")]
    message_type: &'static str,
    host_name: String,
    connected: bool,
    active: bool,
    paused: bool,
    pause_reason: Option<String>,
    phase: String,
    remaining_seconds: Option<i64>,
    rules_fingerprint: String,
    blocked: bool,
    host: Option<String>,
    matched_rule_name: Option<String>,
    reason: Option<String>,
    environment_name: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeState {
    active: bool,
    #[serde(default)]
    paused: bool,
    #[serde(default)]
    pause_reason: Option<String>,
    #[serde(default)]
    active_run_id: Option<String>,
    phase: String,
    remaining_seconds: Option<i64>,
    updated_at: String,
}

#[derive(Debug, Clone)]
enum DoomscrollingMode {
    Blacklist,
    Whitelist,
}

#[derive(Debug, Clone)]
struct CustomCategoryStack {
    id: String,
    name: String,
    hosts: Vec<String>,
}

#[derive(Debug, Clone)]
struct UsageLimitEntry {
    id: String,
    name: Option<String>,
    website_host: Option<String>,
    mobile_app_name: Option<String>,
    desktop_app_name: Option<String>,
}

#[derive(Debug, Clone)]
struct UsageLimit {
    id: String,
    name: String,
    enabled: bool,
    minutes_per_day: Option<i64>,
    minutes_per_week: Option<i64>,
    entries: Vec<UsageLimitEntry>,
}

#[derive(Debug, Clone)]
struct UsageLimitsConfig {
    enabled: bool,
    items: Vec<UsageLimit>,
}

#[derive(Debug, Clone)]
struct DoomscrollingConfig {
    mode: DoomscrollingMode,
    enabled: bool,
    block_during_focus: bool,
    block_during_short_breaks: bool,
    block_during_long_breaks: bool,
    pause_during_focus_pause: bool,
    blocked_category_ids: Vec<String>,
    custom_category_stacks: Vec<CustomCategoryStack>,
    blocked_hosts: Vec<String>,
    exception_hosts: Vec<String>,
    allowed_hosts: Vec<String>,
    limits: UsageLimitsConfig,
}

#[derive(Debug)]
struct StateSnapshot {
    config_dir: Option<PathBuf>,
    vault_path: Option<PathBuf>,
    config: DoomscrollingConfig,
    runtime: Option<RuntimeState>,
    limit_state: Option<LimitState>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LimitState {
    local_date: String,
    week_start_local_date: Option<String>,
    updated_at: String,
    database_path: Option<String>,
    limits: Vec<LimitStateItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    active_vault_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LimitStateItem {
    id: String,
    period: Option<String>,
    window_start_local_date: Option<String>,
    window_end_local_date: Option<String>,
    used_seconds: i64,
    limit_seconds: i64,
    remaining_seconds: i64,
    exhausted: bool,
}

#[derive(Debug)]
struct UsageSample {
    id: String,
    source_type: String,
    source_key: String,
    display_name: Option<String>,
    started_at: i64,
    elapsed_seconds: i64,
    local_date: String,
    created_at: i64,
}

fn main() {
    let response = match run() {
        Ok(response) => response,
        Err(reason) => NativeResponse {
            message_type: "error",
            host_name: native_host_name(),
            connected: false,
            active: false,
            paused: false,
            pause_reason: None,
            phase: "inactive".to_string(),
            remaining_seconds: None,
            rules_fingerprint: "unavailable".to_string(),
            blocked: false,
            host: None,
            matched_rule_name: None,
            reason: Some(reason),
            environment_name: "Ganbaru AI",
        },
    };

    if let Err(err) = write_native_message(&response) {
        eprintln!("failed to write native messaging response: {err}");
    }
}

fn native_host_name() -> String {
    match std::env::var("GANBARU_AI_NATIVE_HOST_NAME") {
        Ok(value) if value == DEV_HOST_NAME => value,
        _ => HOST_NAME.to_string(),
    }
}

fn run() -> Result<NativeResponse, String> {
    let request = read_native_message()?;
    let snapshot = load_snapshot();
    if let Err(err) =
        record_extension_connection(snapshot.config_dir.as_deref(), &request.message_type)
    {
        eprintln!("failed to record extension connection: {err}");
    }
    let mut response = response_from_snapshot(&snapshot);

    if request.message_type == "decide_url" {
        if let Some(host) = normalized_request_host(&request) {
            response.host = Some(host.clone());
            let regular_rules_active = should_enforce(&snapshot, &mut response);
            let decision = decide_url_with_limits(
                &host,
                request.url.as_deref(),
                &snapshot.config,
                snapshot.limit_state.as_ref(),
                regular_rules_active,
            );
            response.blocked = decision.blocked;
            response.matched_rule_name = decision.matched_rule_name;
            if response.blocked && request.log_event.unwrap_or(true) {
                log_block_event(&snapshot, &host, response.matched_rule_name.as_deref());
            }
        } else {
            response.reason = Some("unsupported or invalid URL".to_string());
        }
    } else if request.message_type == "record_usage" {
        match normalize_usage_sample(&request) {
            Ok(sample) => {
                match record_usage_sample(
                    snapshot.vault_path.as_deref(),
                    snapshot.limit_state.as_ref(),
                    sample,
                ) {
                    Ok(()) => {}
                    Err(reason) => response.reason = Some(reason),
                }
            }
            Err(reason) => response.reason = Some(reason),
        }
    } else if request.message_type != "get_state" {
        response.reason = Some(format!(
            "unsupported message type '{}'",
            request.message_type
        ));
    }

    Ok(response)
}

fn write_text_file_atomically(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "connection status path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "connection status path has no file name".to_string())?
        .to_string_lossy();
    let tmp_path = parent.join(format!("{file_name}.tmp"));
    {
        let mut file = std::fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

fn extension_connection_dir(config_dir: Option<&Path>) -> Option<PathBuf> {
    config_dir
        .map(Path::to_path_buf)
        .or_else(|| config_dir_candidates().into_iter().next())
}

fn record_extension_connection(
    config_dir: Option<&Path>,
    message_type: &str,
) -> Result<(), String> {
    let dir = extension_connection_dir(config_dir)
        .ok_or_else(|| "app config directory is unavailable".to_string())?;
    let payload = serde_json::json!({
        "lastSeenAt": now_utc().to_rfc3339_opts(SecondsFormat::Millis, true),
        "lastMessageType": message_type,
    });
    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    write_text_file_atomically(&dir.join(EXTENSION_CONNECTION_FILE), &json)
}

fn read_native_message() -> Result<NativeRequest, String> {
    let mut stdin = std::io::stdin().lock();
    let mut length_bytes = [0_u8; 4];
    stdin
        .read_exact(&mut length_bytes)
        .map_err(|e| format!("read message length: {e}"))?;
    let length = u32::from_ne_bytes(length_bytes) as usize;
    if length > 1024 * 1024 {
        return Err("native message exceeds 1 MiB".to_string());
    }
    let mut buffer = vec![0_u8; length];
    stdin
        .read_exact(&mut buffer)
        .map_err(|e| format!("read message body: {e}"))?;
    serde_json::from_slice(&buffer).map_err(|e| format!("parse native message: {e}"))
}

fn write_native_message(response: &NativeResponse) -> Result<(), String> {
    let bytes = serde_json::to_vec(response).map_err(|e| e.to_string())?;
    let length = u32::try_from(bytes.len())
        .map_err(|_| "native response exceeds u32 length".to_string())?
        .to_ne_bytes();
    let mut stdout = std::io::stdout().lock();
    stdout.write_all(&length).map_err(|e| e.to_string())?;
    stdout.write_all(&bytes).map_err(|e| e.to_string())?;
    stdout.flush().map_err(|e| e.to_string())
}

fn load_snapshot() -> StateSnapshot {
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

fn config_dir_candidates() -> Vec<PathBuf> {
    if let Ok(dir) = std::env::var("GANBARU_AI_CONFIG_DIR") {
        return vec![PathBuf::from(dir)];
    }

    let ids = [
        "org.opengrimoire.ganbaru-ai",
        "org.opengrimoire.ganbaru-ai.dev",
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

fn read_config(path: &std::path::Path) -> Option<DoomscrollingConfig> {
    let contents = std::fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&contents).ok()?;
    let doomscrolling = value.get("doomscrolling")?;
    let (mode, has_mode) = read_mode(doomscrolling);
    Some(DoomscrollingConfig {
        mode,
        enabled: doomscrolling
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        block_during_focus: doomscrolling
            .get("blockDuringFocus")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        block_during_short_breaks: doomscrolling
            .get("blockDuringShortBreaks")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        block_during_long_breaks: doomscrolling
            .get("blockDuringLongBreaks")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        pause_during_focus_pause: doomscrolling
            .get("pauseDuringFocusPause")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        blocked_category_ids: read_category_array(doomscrolling.get("blockedCategories")),
        custom_category_stacks: read_custom_category_stacks(
            doomscrolling.get("customCategoryStacks"),
        ),
        blocked_hosts: read_host_array(doomscrolling.get("blockedHosts")),
        exception_hosts: read_host_array(doomscrolling.get("exceptionHosts")),
        allowed_hosts: if has_mode {
            read_host_array(doomscrolling.get("allowedHosts"))
        } else {
            Vec::new()
        },
        limits: read_usage_limits_config(doomscrolling.get("limits")),
    })
}

fn read_mode(doomscrolling: &Value) -> (DoomscrollingMode, bool) {
    match doomscrolling.get("mode").and_then(Value::as_str) {
        Some("whitelist") => (DoomscrollingMode::Whitelist, true),
        Some("blacklist") => (DoomscrollingMode::Blacklist, true),
        _ => (DoomscrollingMode::Blacklist, false),
    }
}

fn built_in_category(id: &str) -> Option<&'static BuiltInCategory> {
    built_in_categories()
        .iter()
        .find(|category| category.id == id)
}

fn default_built_in_category_ids() -> Vec<String> {
    built_in_categories()
        .iter()
        .filter(|category| category.id != "news")
        .map(|category| category.id.to_string())
        .collect()
}

fn read_category_array(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = value else {
        return default_built_in_category_ids();
    };
    let mut categories = Vec::new();
    for item in items {
        let Some(id) = read_category_rule(item) else {
            continue;
        };
        if !categories.contains(&id) {
            categories.push(id);
        }
    }
    categories
}

fn read_category_rule(item: &Value) -> Option<String> {
    match item {
        Value::String(id) if built_in_category(id).is_some() => Some(id.clone()),
        Value::Object(record) => {
            if record.get("enabled").and_then(Value::as_bool) != Some(true) {
                return None;
            }
            let id = record.get("id").and_then(Value::as_str)?;
            built_in_category(id).map(|category| category.id.to_string())
        }
        _ => None,
    }
}

fn read_custom_category_stacks(value: Option<&Value>) -> Vec<CustomCategoryStack> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    let mut stacks = Vec::new();
    for item in items {
        let Some(stack) = read_custom_category_stack(item) else {
            continue;
        };
        if !stacks
            .iter()
            .any(|existing: &CustomCategoryStack| existing.id == stack.id)
        {
            stacks.push(stack);
        }
    }
    stacks
}

fn read_custom_category_stack(item: &Value) -> Option<CustomCategoryStack> {
    let Value::Object(record) = item else {
        return None;
    };
    if record.get("enabled").and_then(Value::as_bool) == Some(false) {
        return None;
    }
    let id = record.get("id").and_then(Value::as_str)?.trim();
    if id.is_empty() || id.len() > 80 {
        return None;
    }
    let name = record
        .get("name")
        .and_then(Value::as_str)
        .map(normalize_custom_category_stack_name)?;
    if name.is_empty() {
        return None;
    }
    let hosts = read_host_array(record.get("hosts"));
    if hosts.is_empty() {
        return None;
    }
    Some(CustomCategoryStack {
        id: id.to_string(),
        name,
        hosts,
    })
}

fn read_usage_limits_config(value: Option<&Value>) -> UsageLimitsConfig {
    let Some(Value::Object(record)) = value else {
        return UsageLimitsConfig {
            enabled: true,
            items: Vec::new(),
        };
    };
    let mut limits = Vec::new();
    let mut seen_ids = HashSet::new();
    if let Some(Value::Array(items)) = record.get("items") {
        for item in items {
            let Some(limit) = read_usage_limit(item) else {
                continue;
            };
            if seen_ids.insert(limit.id.clone()) {
                limits.push(limit);
            }
        }
    }
    UsageLimitsConfig {
        enabled: record.get("enabled").and_then(Value::as_bool) != Some(false),
        items: limits,
    }
}

fn read_usage_limit(item: &Value) -> Option<UsageLimit> {
    let Value::Object(record) = item else {
        return None;
    };
    let id = normalize_limit_id(record.get("id").and_then(Value::as_str)?)?;
    let name = normalize_usage_limit_name(record.get("name").and_then(Value::as_str)?)?;
    let minutes_per_day = read_optional_limit_minutes(record.get("minutesPerDay"), 1440)?;
    let minutes_per_week = read_optional_limit_minutes(record.get("minutesPerWeek"), 7 * 24 * 60)?;
    if minutes_per_day.is_none() && minutes_per_week.is_none() {
        return None;
    }
    let entries = read_usage_limit_entries(record.get("entries")?)?;
    Some(UsageLimit {
        id,
        name,
        enabled: record.get("enabled").and_then(Value::as_bool) != Some(false),
        minutes_per_day,
        minutes_per_week,
        entries,
    })
}

fn read_optional_limit_minutes(value: Option<&Value>, max_minutes: i64) -> Option<Option<i64>> {
    match value {
        None | Some(Value::Null) => Some(None),
        Some(value) => {
            let minutes = value.as_i64()?;
            (1..=max_minutes)
                .contains(&minutes)
                .then_some(Some(minutes))
        }
    }
}

fn normalize_limit_id(value: &str) -> Option<String> {
    let id = value.trim();
    if id.is_empty()
        || id.len() > 80
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return None;
    }
    Some(id.to_string())
}

fn normalize_usage_limit_name(input: &str) -> Option<String> {
    let name = input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect::<String>();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn read_usage_limit_entries(value: &Value) -> Option<Vec<UsageLimitEntry>> {
    let Value::Array(items) = value else {
        return None;
    };
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    let mut seen_ids = HashSet::new();
    for item in items {
        let Some(entry) = read_usage_limit_entry(item) else {
            continue;
        };
        if !seen_ids.insert(entry.id.clone()) {
            return None;
        }
        for key in usage_limit_entry_source_keys(&entry) {
            if !seen.insert(key) {
                return None;
            }
        }
        entries.push(entry);
    }
    (!entries.is_empty()).then_some(entries)
}

fn read_usage_limit_entry(item: &Value) -> Option<UsageLimitEntry> {
    let Value::Object(record) = item else {
        return None;
    };
    let id = normalize_limit_id(record.get("id").and_then(Value::as_str)?)?;
    let name = record
        .get("name")
        .and_then(Value::as_str)
        .and_then(normalize_usage_limit_name);
    let website_host = record
        .get("websiteHost")
        .and_then(Value::as_str)
        .and_then(normalize_host_rule);
    let mobile_app_name = record
        .get("mobileAppName")
        .and_then(Value::as_str)
        .and_then(normalize_app_name);
    let desktop_app_name = record
        .get("desktopAppName")
        .and_then(Value::as_str)
        .and_then(normalize_app_name);
    if website_host.is_none() && mobile_app_name.is_none() && desktop_app_name.is_none() {
        return None;
    }
    if desktop_app_name
        .as_deref()
        .is_some_and(is_protected_app_name)
    {
        return None;
    }
    Some(UsageLimitEntry {
        id,
        name,
        website_host,
        mobile_app_name,
        desktop_app_name,
    })
}

fn normalize_app_name(input: &str) -> Option<String> {
    let name = input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect::<String>();
    if name.is_empty() || name.chars().any(char::is_control) {
        None
    } else {
        Some(name)
    }
}

fn is_protected_app_name(name: &str) -> bool {
    let key = name.trim().to_lowercase();
    let protected = [
        "ganbaru-ai",
        "ganbaru-ai-dev",
        "terminal",
        "gnome-terminal",
        "system monitor",
        "gnome-shell",
        "explorer.exe",
        "taskmgr.exe",
        "python",
        "python3",
        "python3.12",
        "sh",
        "bash",
        "zsh",
    ];
    protected.iter().any(|name| *name == key)
}

fn usage_limit_entry_source_keys(entry: &UsageLimitEntry) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(host) = &entry.website_host {
        keys.push(format!("website:{host}"));
    }
    if let Some(name) = &entry.mobile_app_name {
        keys.push(format!("mobile-app:{}", name.to_lowercase()));
    }
    if let Some(name) = &entry.desktop_app_name {
        keys.push(format!("desktop-app:{}", name.to_lowercase()));
    }
    keys
}

fn normalize_custom_category_stack_name(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(60)
        .collect()
}

fn read_host_array(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    let mut hosts = Vec::new();
    for item in items {
        let Some(host) = read_host_rule(item) else {
            continue;
        };
        if !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    hosts
}

fn read_host_rule(item: &Value) -> Option<String> {
    match item {
        Value::String(host) => normalize_host_rule(host),
        Value::Object(record) => {
            if record.get("enabled").and_then(Value::as_bool) == Some(false) {
                return None;
            }
            record
                .get("host")
                .and_then(Value::as_str)
                .and_then(normalize_host_rule)
        }
        _ => None,
    }
}

fn default_config() -> DoomscrollingConfig {
    DoomscrollingConfig {
        mode: DoomscrollingMode::Blacklist,
        enabled: true,
        block_during_focus: true,
        block_during_short_breaks: true,
        block_during_long_breaks: true,
        pause_during_focus_pause: true,
        blocked_category_ids: default_built_in_category_ids(),
        custom_category_stacks: Vec::new(),
        blocked_hosts: Vec::new(),
        exception_hosts: Vec::new(),
        allowed_hosts: Vec::new(),
        limits: UsageLimitsConfig {
            enabled: true,
            items: Vec::new(),
        },
    }
}

fn response_from_snapshot(snapshot: &StateSnapshot) -> NativeResponse {
    let (active, phase, remaining_seconds, reason) = runtime_status(snapshot);
    let paused = snapshot
        .runtime
        .as_ref()
        .is_some_and(|runtime| active && runtime.paused);
    let pause_reason = snapshot.runtime.as_ref().and_then(|runtime| {
        (active && runtime.paused)
            .then(|| runtime.pause_reason.clone())
            .flatten()
    });
    NativeResponse {
        message_type: "decision",
        host_name: native_host_name(),
        connected: snapshot.config_dir.is_some(),
        active,
        paused,
        pause_reason,
        phase,
        remaining_seconds,
        rules_fingerprint: rules_fingerprint(&snapshot.config, snapshot.limit_state.as_ref()),
        blocked: false,
        host: None,
        matched_rule_name: None,
        reason,
        environment_name: "Ganbaru AI",
    }
}

fn runtime_status(snapshot: &StateSnapshot) -> (bool, String, Option<i64>, Option<String>) {
    runtime_status_at(snapshot, now_utc())
}

fn runtime_status_at(
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

fn should_enforce(snapshot: &StateSnapshot, response: &mut NativeResponse) -> bool {
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

struct HostDecision {
    blocked: bool,
    matched_rule_name: Option<String>,
}

fn decide_url_with_limits(
    host: &str,
    url: Option<&str>,
    config: &DoomscrollingConfig,
    limit_state: Option<&LimitState>,
    regular_rules_active: bool,
) -> HostDecision {
    let regular_decision = regular_rules_active.then(|| decide_url(host, url, config));
    if let Some(decision) = &regular_decision {
        if decision.blocked {
            return HostDecision {
                blocked: decision.blocked,
                matched_rule_name: decision.matched_rule_name.clone(),
            };
        }
    }
    let limit_decision = decide_url_limit(host, config, limit_state);
    if limit_decision.blocked {
        return limit_decision;
    }
    regular_decision.unwrap_or(HostDecision {
        blocked: false,
        matched_rule_name: None,
    })
}

fn decide_url(host: &str, url: Option<&str>, config: &DoomscrollingConfig) -> HostDecision {
    if is_safety_allowed_host(host) {
        return HostDecision {
            blocked: false,
            matched_rule_name: Some("browser safety allowlist".to_string()),
        };
    }

    match config.mode {
        DoomscrollingMode::Whitelist => {
            for allowed_host in &config.allowed_hosts {
                if host_matches_rule(host, allowed_host) {
                    return HostDecision {
                        blocked: false,
                        matched_rule_name: Some(format!("whitelist: {allowed_host}")),
                    };
                }
            }
            HostDecision {
                blocked: true,
                matched_rule_name: Some("not in whitelist".to_string()),
            }
        }
        DoomscrollingMode::Blacklist => {
            for exception_host in &config.exception_hosts {
                if host_matches_rule(host, exception_host) {
                    return HostDecision {
                        blocked: false,
                        matched_rule_name: Some(format!("exception: {exception_host}")),
                    };
                }
            }
            for blocked_host in &config.blocked_hosts {
                if host_matches_rule(host, blocked_host) {
                    return HostDecision {
                        blocked: true,
                        matched_rule_name: Some(format!("blocked host: {blocked_host}")),
                    };
                }
            }
            for stack in &config.custom_category_stacks {
                for stack_host in &stack.hosts {
                    if host_matches_rule(host, stack_host) {
                        return HostDecision {
                            blocked: true,
                            matched_rule_name: Some(format!("custom stack: {}", stack.name)),
                        };
                    }
                }
            }
            for category_id in &config.blocked_category_ids {
                let Some(category) = built_in_category(category_id) else {
                    continue;
                };
                if category_matches_url(host, url, category) {
                    return HostDecision {
                        blocked: true,
                        matched_rule_name: Some(format!("category: {}", category.label)),
                    };
                }
            }
            HostDecision {
                blocked: false,
                matched_rule_name: None,
            }
        }
    }
}

fn decide_url_limit(
    host: &str,
    config: &DoomscrollingConfig,
    limit_state: Option<&LimitState>,
) -> HostDecision {
    if is_safety_allowed_host(host) || !config.limits.enabled {
        return HostDecision {
            blocked: false,
            matched_rule_name: None,
        };
    }
    let Some(limit_state) = limit_state else {
        return HostDecision {
            blocked: false,
            matched_rule_name: None,
        };
    };
    for limit in &config.limits.items {
        if !limit.enabled {
            continue;
        }
        let Some(total) = limit_state
            .limits
            .iter()
            .find(|total| total.id == limit.id && total.exhausted)
        else {
            continue;
        };
        if total.used_seconds < total.limit_seconds {
            continue;
        }
        if limit
            .entries
            .iter()
            .any(|entry| limit_entry_matches_host(entry, host))
        {
            let period = total.period.as_deref().unwrap_or("day");
            let period_label = if period == "week" { "weekly" } else { "daily" };
            return HostDecision {
                blocked: true,
                matched_rule_name: Some(format!("{period_label} limit: {}", limit.name)),
            };
        }
    }
    HostDecision {
        blocked: false,
        matched_rule_name: None,
    }
}

fn limit_entry_matches_host(entry: &UsageLimitEntry, host: &str) -> bool {
    entry
        .website_host
        .as_deref()
        .is_some_and(|source_host| host_matches_rule(host, source_host))
}

fn category_matches_url(host: &str, url: Option<&str>, category: &BuiltInCategory) -> bool {
    if category
        .hosts
        .iter()
        .any(|category_host| host_matches_rule(host, category_host))
    {
        return true;
    }
    if category
        .domain_keywords
        .iter()
        .any(|keyword| host.contains(keyword))
    {
        return true;
    }
    if !host_matches_rule(host, "reddit.com") {
        return false;
    }
    let Some(subreddit) = url.and_then(reddit_subreddit_from_url) else {
        return false;
    };
    category
        .reddit_subreddit_keywords
        .iter()
        .any(|keyword| subreddit.contains(keyword))
}

impl DoomscrollingMode {
    fn as_str(&self) -> &'static str {
        match self {
            DoomscrollingMode::Blacklist => "blacklist",
            DoomscrollingMode::Whitelist => "whitelist",
        }
    }
}

fn feed_fingerprint(hash: &mut u64, value: &str) {
    for byte in value.as_bytes() {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(1_099_511_628_211);
    }
    *hash ^= 0xff;
    *hash = hash.wrapping_mul(1_099_511_628_211);
}

fn feed_fingerprint_bool(hash: &mut u64, value: bool) {
    feed_fingerprint(hash, if value { "1" } else { "0" });
}

fn feed_fingerprint_hosts(hash: &mut u64, label: &str, hosts: &[String]) {
    feed_fingerprint(hash, label);
    for host in hosts {
        feed_fingerprint(hash, host);
    }
}

fn rules_fingerprint(config: &DoomscrollingConfig, limit_state: Option<&LimitState>) -> String {
    let mut hash = 14_695_981_039_346_656_037_u64;
    feed_fingerprint(&mut hash, "built_in_categories");
    feed_fingerprint(&mut hash, BUILT_IN_CATEGORIES_JSON);
    feed_fingerprint(&mut hash, config.mode.as_str());
    feed_fingerprint_bool(&mut hash, config.enabled);
    feed_fingerprint_bool(&mut hash, config.block_during_focus);
    feed_fingerprint_bool(&mut hash, config.block_during_short_breaks);
    feed_fingerprint_bool(&mut hash, config.block_during_long_breaks);
    feed_fingerprint_bool(&mut hash, config.pause_during_focus_pause);
    feed_fingerprint_hosts(&mut hash, "category", &config.blocked_category_ids);
    feed_fingerprint(&mut hash, "custom_stack");
    for stack in &config.custom_category_stacks {
        feed_fingerprint(&mut hash, &stack.id);
        feed_fingerprint(&mut hash, &stack.name);
        for host in &stack.hosts {
            feed_fingerprint(&mut hash, host);
        }
    }
    feed_fingerprint_hosts(&mut hash, "blocked", &config.blocked_hosts);
    feed_fingerprint_hosts(&mut hash, "exception", &config.exception_hosts);
    feed_fingerprint_hosts(&mut hash, "allowed", &config.allowed_hosts);
    feed_fingerprint_bool(&mut hash, config.limits.enabled);
    feed_fingerprint(&mut hash, "limits");
    for limit in &config.limits.items {
        feed_fingerprint(&mut hash, &limit.id);
        feed_fingerprint(&mut hash, &limit.name);
        feed_fingerprint_bool(&mut hash, limit.enabled);
        feed_fingerprint(&mut hash, "day");
        if let Some(minutes_per_day) = limit.minutes_per_day {
            feed_fingerprint(&mut hash, &minutes_per_day.to_string());
        } else {
            feed_fingerprint(&mut hash, "none");
        }
        feed_fingerprint(&mut hash, "week");
        if let Some(minutes_per_week) = limit.minutes_per_week {
            feed_fingerprint(&mut hash, &minutes_per_week.to_string());
        } else {
            feed_fingerprint(&mut hash, "none");
        }
        for entry in &limit.entries {
            feed_fingerprint(&mut hash, &entry.id);
            if let Some(name) = &entry.name {
                feed_fingerprint(&mut hash, name);
            }
            for key in usage_limit_entry_source_keys(entry) {
                feed_fingerprint(&mut hash, &key);
            }
        }
    }
    if let Some(limit_state) = limit_state {
        feed_fingerprint(&mut hash, &limit_state.local_date);
        if let Some(week_start_local_date) = &limit_state.week_start_local_date {
            feed_fingerprint(&mut hash, week_start_local_date);
        }
        if let Some(database_path) = &limit_state.database_path {
            feed_fingerprint(&mut hash, database_path);
        }
        for limit in &limit_state.limits {
            feed_fingerprint(&mut hash, &limit.id);
            if let Some(period) = &limit.period {
                feed_fingerprint(&mut hash, period);
            }
            if let Some(window_start_local_date) = &limit.window_start_local_date {
                feed_fingerprint(&mut hash, window_start_local_date);
            }
            if let Some(window_end_local_date) = &limit.window_end_local_date {
                feed_fingerprint(&mut hash, window_end_local_date);
            }
            feed_fingerprint(&mut hash, &limit.used_seconds.to_string());
            feed_fingerprint(&mut hash, &limit.limit_seconds.to_string());
            feed_fingerprint(&mut hash, &limit.remaining_seconds.to_string());
            feed_fingerprint_bool(&mut hash, limit.exhausted);
        }
    }
    format!("{hash:016x}")
}

fn normalized_request_host(request: &NativeRequest) -> Option<String> {
    request
        .host
        .as_deref()
        .and_then(normalize_host_rule)
        .or_else(|| request.url.as_deref().and_then(host_from_url))
}

fn normalize_usage_sample(request: &NativeRequest) -> Result<UsageSample, String> {
    let source_type = request
        .source_type
        .as_deref()
        .ok_or_else(|| "usage sourceType is required".to_string())?;
    if !matches!(source_type, "website" | "desktop-app" | "mobile-app") {
        return Err(format!("unsupported usage source type '{source_type}'"));
    }
    let raw_source_key = request
        .source_key
        .as_deref()
        .or(request.host.as_deref())
        .ok_or_else(|| "usage sourceKey is required".to_string())?;
    let source_key = match source_type {
        "website" => normalize_host_rule(raw_source_key)
            .ok_or_else(|| "usage website host is invalid".to_string())?,
        "desktop-app" | "mobile-app" => normalize_app_name(raw_source_key)
            .ok_or_else(|| "usage app name is invalid".to_string())?
            .to_lowercase(),
        _ => unreachable!(),
    };
    if source_type == "desktop-app" && is_protected_app_name(&source_key) {
        return Err("protected desktop apps cannot be tracked".to_string());
    }
    let elapsed_seconds = request
        .elapsed_seconds
        .ok_or_else(|| "usage elapsedSeconds is required".to_string())?;
    if elapsed_seconds <= 0 || elapsed_seconds > 86_400 {
        return Err("usage elapsedSeconds must be between 1 and 86400".to_string());
    }
    let started_at = request
        .started_at
        .ok_or_else(|| "usage startedAt is required".to_string())?;
    if started_at < 0 {
        return Err("usage startedAt must be non-negative".to_string());
    }
    let local_date = request
        .local_date
        .clone()
        .ok_or_else(|| "usage localDate is required".to_string())?;
    if !valid_local_date(&local_date) {
        return Err("usage localDate must use yyyy-mm-dd".to_string());
    }
    let display_name = request.display_name.as_ref().and_then(|value| {
        let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
        (!normalized.is_empty()).then(|| normalized.chars().take(120).collect::<String>())
    });
    Ok(UsageSample {
        id: format!(
            "ext-{}-{}-{}",
            started_at,
            now_epoch_ms(),
            std::process::id()
        ),
        source_type: source_type.to_string(),
        source_key,
        display_name,
        started_at,
        elapsed_seconds,
        local_date,
        created_at: now_epoch_ms(),
    })
}

fn valid_local_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn now_epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
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

fn usage_db_path(vault_path: &Path, limit_state: Option<&LimitState>) -> PathBuf {
    limit_state
        .and_then(|state| state.database_path.as_deref())
        .map(PathBuf::from)
        .filter(|path| database_path_is_allowed(path, Some(vault_path)))
        .unwrap_or_else(|| vault_path.join(APP_SQLITE_FILE))
}

fn record_usage_sample(
    vault_path: Option<&Path>,
    limit_state: Option<&LimitState>,
    sample: UsageSample,
) -> Result<(), String> {
    let vault_path =
        vault_path.ok_or_else(|| "active Ganbaru AI folder is unavailable".to_string())?;
    let db_path = usage_db_path(vault_path, limit_state);
    if !db_path.exists() {
        return Err("usage database is unavailable".to_string());
    }
    tauri::async_runtime::block_on(async move {
        let db_url = format!(
            "sqlite:{}",
            db_path
                .to_str()
                .ok_or_else(|| "usage database path contains non-utf8 characters".to_string())?
        );
        let options = SqliteConnectOptions::from_str(&db_url)
            .map_err(|e| format!("parse usage database url: {e}"))?;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(|e| format!("connect usage database: {e}"))?;
        raw_sql("PRAGMA busy_timeout=5000")
            .execute(&pool)
            .await
            .map_err(|e| format!("usage database busy timeout: {e}"))?;
        raw_sql(USAGE_SAMPLE_TABLE_SQL)
            .execute(&pool)
            .await
            .map_err(|e| format!("ensure usage sample table: {e}"))?;
        sqlx::query(
            "INSERT OR IGNORE INTO doomscrolling_usage_samples
                (id, source_type, source_key, display_name, started_at, elapsed_seconds, local_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(sample.id)
        .bind(sample.source_type)
        .bind(sample.source_key)
        .bind(sample.display_name)
        .bind(sample.started_at)
        .bind(sample.elapsed_seconds)
        .bind(sample.local_date)
        .bind(sample.created_at)
        .execute(&pool)
        .await
        .map_err(|e| format!("record usage sample: {e}"))?;
        pool.close().await;
        Ok(())
    })
}

fn host_from_url(url: &str) -> Option<String> {
    let (_, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let after_user = authority.rsplit('@').next().unwrap_or(authority);
    let host = after_user
        .strip_prefix('[')
        .and_then(|value| value.split_once(']').map(|(host, _)| host))
        .unwrap_or_else(|| after_user.split(':').next().unwrap_or_default());
    normalize_host_rule(host)
}

fn normalize_host_rule(input: &str) -> Option<String> {
    let trimmed = input.trim().trim_end_matches('.').to_ascii_lowercase();
    let host = trimmed.strip_prefix("*.").unwrap_or(&trimmed);
    if host.is_empty() || host.contains('*') || host.contains(' ') || host.contains('@') {
        return None;
    }
    Some(host.to_string())
}

fn host_matches_rule(host: &str, rule_host: &str) -> bool {
    host == rule_host
        || host
            .strip_suffix(rule_host)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

fn reddit_subreddit_from_url(url: &str) -> Option<String> {
    let (_, rest) = url.split_once("://")?;
    let path_start = rest.find('/')?;
    let path = rest[path_start..]
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let subreddit = path.strip_prefix("/r/")?.split('/').next()?;
    if subreddit.is_empty() {
        return None;
    }
    Some(subreddit.to_string())
}

fn is_safety_allowed_host(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1" || host == "::1" || host.ends_with(".localhost")
}

fn now_utc() -> DateTime<Utc> {
    std::time::SystemTime::now().into()
}

fn limit_state_is_fresh(state: &LimitState, vault_path: Option<&Path>) -> bool {
    if !valid_local_date(&state.local_date) {
        return false;
    }
    if state
        .week_start_local_date
        .as_deref()
        .is_some_and(|local_date| !valid_local_date(local_date))
    {
        return false;
    }
    if state.limits.iter().any(|limit| {
        limit
            .period
            .as_deref()
            .is_some_and(|period| period != "day" && period != "week")
            || limit
                .window_start_local_date
                .as_deref()
                .is_some_and(|local_date| !valid_local_date(local_date))
            || limit
                .window_end_local_date
                .as_deref()
                .is_some_and(|local_date| !valid_local_date(local_date))
            || limit
                .window_start_local_date
                .as_deref()
                .zip(limit.window_end_local_date.as_deref())
                .is_some_and(|(start, end)| start > end)
    }) {
        return false;
    }
    if state
        .database_path
        .as_deref()
        .map(Path::new)
        .is_some_and(|path| !database_path_is_allowed(path, vault_path))
    {
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

fn log_block_event(snapshot: &StateSnapshot, host: &str, matched_rule_name: Option<&str>) {
    let occurred_at = now_utc().to_rfc3339_opts(SecondsFormat::Millis, true);
    let Some(config_dir) = &snapshot.config_dir else {
        return;
    };
    let event = serde_json::json!({
        "occurredAt": occurred_at,
        "urlHost": host,
        "phase": snapshot.runtime.as_ref().map(|state| state.phase.as_str()).unwrap_or("inactive"),
        "ruleNameSnapshot": matched_rule_name,
        "decision": "blocked"
    });
    if let Ok(line) = serde_json::to_string(&event) {
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(config_dir.join(EVENTS_FILE))
        {
            let _ = writeln!(file, "{line}");
        }
    }
    if let Err(err) =
        record_block_event_in_database(snapshot, &occurred_at, host, matched_rule_name)
    {
        eprintln!("failed to record doomscrolling block event: {err}");
    }
}

fn record_block_event_in_database(
    snapshot: &StateSnapshot,
    occurred_at: &str,
    host: &str,
    matched_rule_name: Option<&str>,
) -> Result<(), String> {
    let vault_path = snapshot
        .vault_path
        .as_deref()
        .ok_or_else(|| "active Ganbaru AI folder is unavailable".to_string())?;
    let db_path = usage_db_path(vault_path, snapshot.limit_state.as_ref());
    if !db_path.exists() {
        return Err("usage database is unavailable".to_string());
    }
    let source_key =
        normalize_host_rule(host).ok_or_else(|| "block event host is invalid".to_string())?;
    let phase = block_event_phase(snapshot.runtime.as_ref());
    let run_id = phase
        .as_deref()
        .and(snapshot.runtime.as_ref())
        .and_then(|runtime| runtime.active_run_id.clone());
    let decision = block_event_decision(matched_rule_name);
    let rule_kind = block_event_rule_kind(matched_rule_name);
    let blocker_mode = block_event_mode(&snapshot.config, decision);
    let event_nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let event_id = format!("block-{event_nonce}-{}", std::process::id());

    tauri::async_runtime::block_on(async move {
        let db_url = format!(
            "sqlite:{}",
            db_path.to_str().ok_or_else(|| {
                "usage database path contains non-utf8 characters".to_string()
            })?
        );
        let options = SqliteConnectOptions::from_str(&db_url)
            .map_err(|e| format!("parse usage database url: {e}"))?;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(|e| format!("connect usage database: {e}"))?;
        raw_sql("PRAGMA busy_timeout=5000")
            .execute(&pool)
            .await
            .map_err(|e| format!("usage database busy timeout: {e}"))?;
        raw_sql(BLOCK_EVENT_TABLE_SQL)
            .execute(&pool)
            .await
            .map_err(|e| format!("ensure block event tables: {e}"))?;
        sqlx::query(
            "INSERT OR IGNORE INTO doomscrolling_block_events
                (id, run_id, segment_id, occurred_at, source_type, source_key,
                 display_name, phase, decision, rule_id, category_id)
             VALUES (?, ?, NULL, ?, 'browser', ?, ?, ?, ?, NULL, NULL)",
        )
        .bind(&event_id)
        .bind(&run_id)
        .bind(occurred_at)
        .bind(&source_key)
        .bind(&source_key)
        .bind(&phase)
        .bind(decision)
        .execute(&pool)
        .await
        .map_err(|e| format!("record block event: {e}"))?;
        if matched_rule_name.is_some() || rule_kind.is_some() || blocker_mode.is_some() {
            sqlx::query(
                "INSERT OR REPLACE INTO doomscrolling_block_event_rule_snapshots
                    (block_event_id, rule_id, rule_kind, rule_label, environment_id, blocker_mode)
                 VALUES (?, NULL, ?, ?, NULL, ?)",
            )
            .bind(&event_id)
            .bind(rule_kind)
            .bind(matched_rule_name)
            .bind(blocker_mode)
            .execute(&pool)
            .await
            .map_err(|e| format!("record block event rule snapshot: {e}"))?;
        }
        pool.close().await;
        Ok(())
    })
}

fn block_event_phase(runtime: Option<&RuntimeState>) -> Option<String> {
    let runtime = runtime?;
    if runtime.paused {
        return match runtime.pause_reason.as_deref() {
            Some("idle") => Some("idle_pause".to_string()),
            Some("suspend") => Some("suspend_pause".to_string()),
            Some("manual") | None => Some("manual_pause".to_string()),
            Some(_) => None,
        };
    }
    match runtime.phase.as_str() {
        "focus" | "short_break" | "long_break" => Some(runtime.phase.clone()),
        _ => None,
    }
}

fn block_event_decision(matched_rule_name: Option<&str>) -> &'static str {
    if matched_rule_name
        .is_some_and(|rule| rule.starts_with("daily limit:") || rule.starts_with("weekly limit:"))
    {
        "limit_exhausted"
    } else {
        "blocked"
    }
}

fn block_event_rule_kind(matched_rule_name: Option<&str>) -> Option<&'static str> {
    let rule = matched_rule_name?;
    if rule.starts_with("daily limit:") || rule.starts_with("weekly limit:") {
        Some("usage_limit")
    } else if rule.starts_with("category:") {
        Some("category")
    } else if rule.starts_with("custom stack:") {
        Some("custom_category")
    } else if rule.starts_with("blocked host:") || rule == "not in whitelist" {
        Some("domain")
    } else {
        None
    }
}

fn block_event_mode(config: &DoomscrollingConfig, decision: &str) -> Option<&'static str> {
    if decision == "limit_exhausted" {
        return Some("limit");
    }
    match config.mode {
        DoomscrollingMode::Blacklist => Some("blacklist"),
        DoomscrollingMode::Whitelist => Some("whitelist"),
    }
}

#[cfg(test)]
#[path = "ganbaru-ai-native-messaging/tests.rs"]
mod tests;
