use crate::db_path::connect_sqlite;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{Manager, Runtime};

const STATE_FILE: &str = "doomscrolling-state.json";
const EXTENSION_CONNECTION_FILE: &str = "doomscrolling-extension-status.json";
const LIMIT_STATE_FILE: &str = "doomscrolling-limit-state.json";
const EXTENSION_CONNECTION_STALE_SECONDS: i64 = 60;
const ALLOWED_USAGE_DATABASE_FILES: &[&str] = &[
    "ganbaru-ai.db",
    "ganbaru-ai-dev.db",
    "ganbaru-ai-benchmark.db",
];
const EXTENSION_INSTALL_README_URL: &str =
    "https://github.com/opengrimoire/ganbaru-ai/blob/dev/extensions/chrome/README.md";
const PROTECTED_DESKTOP_APP_NAMES: &[&str] = &[
    "Ganbaru AI",
    "ganbaru-ai",
    "ganbaru-ai-dev",
    "Ganbaru AI Dev",
    "Ganbaru AI (dev)",
    "org.opengrimoire.ganbaru-ai",
    "org.opengrimoire.ganbaru-ai.dev",
    "Activity Monitor",
    "Advanced Network Configuration",
    "Calculator",
    "Characters",
    "Clocks",
    "Command Prompt",
    "Console",
    "Control Panel",
    "Disk Utility",
    "Disk Usage Analyzer",
    "Disks",
    "Event Viewer",
    "Extension Manager",
    "Extensions",
    "File Explorer",
    "Files",
    "Finder",
    "Fonts",
    "GDebi Package Installer",
    "GNOME System Monitor",
    "Help",
    "Htop",
    "IBus Preferences",
    "Input Method",
    "Keychain Access",
    "Language Support",
    "Logs",
    "Notepad",
    "Passwords and Keys",
    "Power Statistics",
    "PowerShell",
    "Settings",
    "Startup Applications",
    "System Monitor",
    "System Preferences",
    "System Settings",
    "Task Manager",
    "Terminal",
    "Text Editor",
    "UXTerm",
    "Windows Explorer",
    "Windows PowerShell",
    "XTerm",
];
const PROTECTED_DESKTOP_PROCESS_NAMES: &[&str] = &[
    "Activity Monitor",
    "bash",
    "cmd",
    "cmd.exe",
    "conhost.exe",
    "ControlCenter",
    "csrss.exe",
    "dash",
    "dbus-broker",
    "dbus-daemon",
    "dllhost.exe",
    "Dock",
    "dwm.exe",
    "electron",
    "explorer.exe",
    "Finder",
    "fish",
    "flatpak",
    "gnome-control-center",
    "gnome-keyring-daemon",
    "gnome-shell",
    "gnome-terminal",
    "gnome-terminal-server",
    "ibus-daemon",
    "java",
    "javaw",
    "javaw.exe",
    "kitty",
    "konsole",
    "kwin_wayland",
    "kwin_x11",
    "launchd",
    "loginwindow",
    "mmc.exe",
    "mutter",
    "node",
    "plasmashell",
    "PowerShell",
    "powershell.exe",
    "pwsh",
    "pwsh.exe",
    "python",
    "python3",
    "python3.11",
    "python3.12",
    "pythonw.exe",
    "regedit.exe",
    "rundll32.exe",
    "services.exe",
    "sh",
    "ShellExperienceHost.exe",
    "sihost.exe",
    "snap",
    "StartMenuExperienceHost.exe",
    "svchost.exe",
    "System Settings",
    "SystemUIServer",
    "taskmgr.exe",
    "Terminal",
    "wezterm",
    "winlogon.exe",
    "WindowsTerminal.exe",
    "WindowServer",
    "wt.exe",
    "wscript.exe",
    "xdg-desktop-portal",
    "xdg-desktop-portal-gnome",
    "xdg-desktop-portal-gtk",
    "Xorg",
    "XTerm",
    "Xwayland",
    "zsh",
];

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoomscrollingRuntimeState {
    active: bool,
    phase: String,
    active_run_id: Option<String>,
    active_block_id: Option<String>,
    remaining_seconds: Option<i64>,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DoomscrollingExtensionConnectionFile {
    last_seen_at: String,
    last_message_type: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoomscrollingExtensionStatus {
    connected: bool,
    last_seen_at: Option<String>,
    last_message_type: Option<String>,
    checked_at: String,
    stale_seconds: i64,
    reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoomscrollingUsageSampleInput {
    id: Option<String>,
    source_type: String,
    source_key: String,
    display_name: Option<String>,
    started_at: i64,
    elapsed_seconds: i64,
    local_date: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoomscrollingUsageSampleRow {
    id: String,
    source_type: String,
    source_key: String,
    display_name: Option<String>,
    started_at: i64,
    elapsed_seconds: i64,
    local_date: String,
    created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoomscrollingLimitState {
    local_date: String,
    updated_at: String,
    database_file_name: String,
    limits: Vec<DoomscrollingLimitStateItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoomscrollingLimitStateItem {
    id: String,
    used_seconds: i64,
    limit_seconds: i64,
    remaining_seconds: i64,
    exhausted: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoomscrollingForegroundDesktopAppStatus {
    available: bool,
    app_name: Option<String>,
    process_name: Option<String>,
    process_id: Option<u32>,
    match_names: Vec<String>,
    reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoomscrollingForegroundDesktopAppExpectation {
    app_name: Option<String>,
    process_name: Option<String>,
    process_id: Option<u32>,
    #[serde(default)]
    match_names: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoomscrollingDesktopAppCandidate {
    name: String,
    source: String,
    detail: Option<String>,
    process_names: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoomscrollingDesktopAppRuleInput {
    name: String,
    match_names: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoomscrollingRunningDesktopAppMatch {
    app_name: String,
    process_name: String,
    process_id: u32,
}

fn state_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&path).map_err(|e| format!("create app config dir: {e}"))?;
    path.push(STATE_FILE);
    Ok(path)
}

fn extension_connection_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&path).map_err(|e| format!("create app config dir: {e}"))?;
    path.push(EXTENSION_CONNECTION_FILE);
    Ok(path)
}

fn limit_state_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&path).map_err(|e| format!("create app config dir: {e}"))?;
    path.push(LIMIT_STATE_FILE);
    Ok(path)
}

fn validate_state(state: &DoomscrollingRuntimeState) -> Result<(), String> {
    match state.phase.as_str() {
        "inactive" | "focus" | "short_break" | "long_break" => {}
        other => return Err(format!("unsupported doomscrolling phase '{other}'")),
    }
    if state
        .remaining_seconds
        .is_some_and(|remaining_seconds| remaining_seconds < 0)
    {
        return Err("remaining_seconds must be non-negative".to_string());
    }
    if state.updated_at.trim().is_empty() {
        return Err("updated_at is required".to_string());
    }
    Ok(())
}

fn now_utc() -> DateTime<Utc> {
    std::time::SystemTime::now().into()
}

fn now_epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

#[cfg(target_os = "linux")]
fn open_fixed_url(url: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open browser: {e}"))
}

#[cfg(target_os = "macos")]
fn open_fixed_url(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open browser: {e}"))
}

#[cfg(windows)]
fn open_fixed_url(url: &str) -> Result<(), String> {
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open browser: {e}"))
}

fn candidate(
    name: impl Into<String>,
    source: &'static str,
    detail: Option<String>,
    process_names: Vec<String>,
) -> DoomscrollingDesktopAppCandidate {
    let name = name.into();
    DoomscrollingDesktopAppCandidate {
        process_names: normalize_process_match_names(&name, process_names),
        name,
        source: source.to_string(),
        detail,
    }
}

fn app_name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

fn is_protected_desktop_app_name(name: &str) -> bool {
    let key = app_name_key(name);
    PROTECTED_DESKTOP_APP_NAMES
        .iter()
        .chain(PROTECTED_DESKTOP_PROCESS_NAMES.iter())
        .any(|protected_name| app_name_key(protected_name) == key)
}

fn is_protected_desktop_app_candidate(app: &DoomscrollingDesktopAppCandidate) -> bool {
    is_protected_desktop_app_name(&app.name)
        || app
            .process_names
            .iter()
            .any(|name| is_protected_desktop_app_name(name))
}

fn normalize_app_candidate_name(name: &str) -> Option<String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name.chars().any(char::is_control) {
        return None;
    }
    Some(name.chars().take(80).collect())
}

fn normalize_usage_host(input: &str) -> Option<String> {
    let trimmed = input.trim().trim_end_matches('.').to_ascii_lowercase();
    let host = trimmed.strip_prefix("*.").unwrap_or(&trimmed);
    if host.is_empty() || host.contains('*') || host.contains(' ') || host.contains('@') {
        return None;
    }
    Some(host.to_string())
}

fn normalize_usage_source_key(source_type: &str, source_key: &str) -> Option<String> {
    match source_type {
        "website" => normalize_usage_host(source_key),
        "desktop-app" | "mobile-app" => {
            normalize_app_candidate_name(source_key).map(|name| name.to_lowercase())
        }
        _ => None,
    }
}

fn normalize_usage_display_name(value: Option<String>) -> Option<String> {
    value.and_then(|name| {
        let normalized = name.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.is_empty() {
            None
        } else {
            Some(normalized.chars().take(120).collect())
        }
    })
}

fn validate_local_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn normalize_usage_sample(
    sample: DoomscrollingUsageSampleInput,
    fallback_id_prefix: &str,
) -> Result<DoomscrollingUsageSampleRow, String> {
    let source_type = match sample.source_type.as_str() {
        "website" | "desktop-app" | "mobile-app" => sample.source_type,
        other => return Err(format!("unsupported usage source type '{other}'")),
    };
    let source_key = normalize_usage_source_key(&source_type, &sample.source_key)
        .ok_or_else(|| "usage sample source key is invalid".to_string())?;
    if source_type == "desktop-app" && is_protected_desktop_app_name(&source_key) {
        return Err("protected desktop apps cannot be tracked".to_string());
    }
    if sample.elapsed_seconds <= 0 || sample.elapsed_seconds > 86_400 {
        return Err("elapsed_seconds must be between 1 and 86400".to_string());
    }
    if sample.started_at < 0 {
        return Err("started_at must be non-negative".to_string());
    }
    if !validate_local_date(&sample.local_date) {
        return Err("local_date must use yyyy-mm-dd".to_string());
    }
    let id = sample.id.unwrap_or_else(|| {
        format!(
            "{fallback_id_prefix}-{}-{}",
            now_epoch_ms(),
            std::process::id()
        )
    });
    if id.trim().is_empty() {
        return Err("usage sample id is required".to_string());
    }

    Ok(DoomscrollingUsageSampleRow {
        id: id.chars().take(120).collect(),
        source_type,
        source_key,
        display_name: normalize_usage_display_name(sample.display_name),
        started_at: sample.started_at,
        elapsed_seconds: sample.elapsed_seconds,
        local_date: sample.local_date,
        created_at: now_epoch_ms(),
    })
}

fn validate_limit_state(state: &DoomscrollingLimitState) -> Result<(), String> {
    if !validate_local_date(&state.local_date) {
        return Err("local_date must use yyyy-mm-dd".to_string());
    }
    DateTime::parse_from_rfc3339(&state.updated_at)
        .map_err(|e| format!("parse updated_at: {e}"))?;
    if !ALLOWED_USAGE_DATABASE_FILES.contains(&state.database_file_name.as_str()) {
        return Err("database_file_name is not supported".to_string());
    }
    for limit in &state.limits {
        if limit.id.trim().is_empty() {
            return Err("limit id is required".to_string());
        }
        if limit.used_seconds < 0 || limit.limit_seconds <= 0 || limit.remaining_seconds < 0 {
            return Err("limit seconds must be non-negative".to_string());
        }
    }
    Ok(())
}

fn normalize_process_match_name(name: &str) -> Option<String> {
    let trimmed = name.trim().trim_matches('"').trim_matches('\'');
    let basename = Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(trimmed);
    normalize_app_candidate_name(basename)
}

fn normalize_process_match_name_aliases(name: &str) -> Vec<String> {
    let Some(primary) = normalize_process_match_name(name) else {
        return Vec::new();
    };
    let mut aliases = vec![primary.clone()];
    let lower = primary.to_lowercase();
    for suffix in [".exe", ".desktop"] {
        if lower.ends_with(suffix) {
            if let Some(alias) =
                normalize_app_candidate_name(&primary[..primary.len() - suffix.len()])
            {
                aliases.push(alias);
            }
        }
    }
    aliases
}

fn normalize_process_match_names(name: &str, process_names: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for candidate in std::iter::once(name.to_string()).chain(process_names.into_iter()) {
        for process_name in normalize_process_match_name_aliases(&candidate) {
            let key = app_name_key(&process_name);
            if is_protected_desktop_app_name(&process_name) || seen.contains(&key) {
                continue;
            }
            seen.insert(key);
            normalized.push(process_name);
        }
    }
    normalized
}

fn unavailable_foreground_desktop_app_status(
    reason: impl Into<String>,
) -> DoomscrollingForegroundDesktopAppStatus {
    DoomscrollingForegroundDesktopAppStatus {
        available: false,
        app_name: None,
        process_name: None,
        process_id: None,
        match_names: Vec::new(),
        reason: Some(reason.into()),
    }
}

fn foreground_status_from_parts(
    app_name: impl Into<String>,
    process_name: Option<String>,
    process_id: Option<u32>,
    match_names: Vec<String>,
) -> DoomscrollingForegroundDesktopAppStatus {
    let raw_app_name = app_name.into();
    let app_name = normalize_app_candidate_name(&raw_app_name);
    let process_name = process_name.and_then(|name| {
        normalize_process_match_name_aliases(&name)
            .into_iter()
            .next()
    });
    let Some(app_name) = app_name else {
        return unavailable_foreground_desktop_app_status("foreground app name is unavailable");
    };
    let mut raw_match_names = match_names;
    if let Some(process_name) = &process_name {
        raw_match_names.push(process_name.clone());
    }
    DoomscrollingForegroundDesktopAppStatus {
        match_names: normalize_process_match_names(&app_name, raw_match_names),
        available: true,
        app_name: Some(app_name),
        process_name,
        process_id,
        reason: None,
    }
}

fn foreground_status_match_names(status: &DoomscrollingForegroundDesktopAppStatus) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(app_name) = &status.app_name {
        names.push(app_name.clone());
    }
    if let Some(process_name) = &status.process_name {
        names.push(process_name.clone());
    }
    names.extend(status.match_names.iter().cloned());
    normalize_process_match_names(status.app_name.as_deref().unwrap_or(""), names)
}

fn foreground_expectation_matches(
    status: &DoomscrollingForegroundDesktopAppStatus,
    expected: &DoomscrollingForegroundDesktopAppExpectation,
) -> bool {
    if !status.available {
        return false;
    }
    if let (Some(status_process_id), Some(expected_process_id)) =
        (status.process_id, expected.process_id)
    {
        return status_process_id == expected_process_id;
    }
    let status_names = foreground_status_match_names(status)
        .into_iter()
        .map(|name| app_name_key(&name))
        .collect::<HashSet<_>>();
    let mut expected_names = Vec::new();
    if let Some(app_name) = &expected.app_name {
        expected_names.push(app_name.clone());
    }
    if let Some(process_name) = &expected.process_name {
        expected_names.push(process_name.clone());
    }
    expected_names.extend(expected.match_names.iter().cloned());
    normalize_process_match_names(expected.app_name.as_deref().unwrap_or(""), expected_names)
        .into_iter()
        .any(|name| status_names.contains(&app_name_key(&name)))
}

fn validate_foreground_status_is_closeable(
    status: &DoomscrollingForegroundDesktopAppStatus,
) -> Result<(), String> {
    let names = foreground_status_match_names(status);
    if names.is_empty() {
        return Err("foreground app is unavailable".to_string());
    }
    if status
        .app_name
        .as_deref()
        .is_some_and(is_protected_desktop_app_name)
    {
        return Err("refusing to close protected foreground app".to_string());
    }
    if names
        .iter()
        .all(|name| is_protected_desktop_app_name(name))
    {
        return Err("refusing to close protected foreground app".to_string());
    }
    Ok(())
}

fn sort_and_deduplicate_candidates(
    candidates: Vec<DoomscrollingDesktopAppCandidate>,
) -> Vec<DoomscrollingDesktopAppCandidate> {
    let mut by_name = HashMap::<String, DoomscrollingDesktopAppCandidate>::new();
    for app in candidates {
        if is_protected_desktop_app_candidate(&app) {
            continue;
        }
        if let Some(name) = normalize_app_candidate_name(&app.name) {
            let key = app_name_key(&name);
            by_name
                .entry(key)
                .or_insert_with(|| DoomscrollingDesktopAppCandidate {
                    process_names: normalize_process_match_names(&name, app.process_names),
                    name,
                    source: app.source,
                    detail: app.detail,
                });
        }
    }
    let mut apps = by_name.into_values().collect::<Vec<_>>();
    apps.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.name.cmp(&b.name))
    });
    apps
}

#[cfg(target_os = "linux")]
fn decode_desktop_entry_value(value: &str) -> String {
    let mut decoded = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            decoded.push(ch);
            continue;
        }
        match chars.next() {
            Some('s') => decoded.push(' '),
            Some('n') => decoded.push('\n'),
            Some('t') => decoded.push('\t'),
            Some('\\') => decoded.push('\\'),
            Some(other) => decoded.push(other),
            None => decoded.push('\\'),
        }
    }
    decoded
}

#[cfg(target_os = "linux")]
fn first_exec_token(exec: &str) -> Option<String> {
    let mut token = String::new();
    let mut in_quote = false;
    let mut quote_char = '\0';
    let mut escaped = false;
    for ch in exec.trim().chars() {
        if escaped {
            token.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if in_quote {
            if ch == quote_char {
                in_quote = false;
            } else {
                token.push(ch);
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            in_quote = true;
            quote_char = ch;
            continue;
        }
        if ch.is_whitespace() {
            if token.is_empty() {
                continue;
            }
            break;
        }
        token.push(ch);
    }
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

#[cfg(target_os = "linux")]
fn process_name_from_exec(exec: &str) -> Option<String> {
    let token = first_exec_token(exec)?;
    normalize_process_match_name(&token)
}

#[cfg(target_os = "linux")]
fn decode_desktop_entry_list(value: &str) -> Vec<String> {
    value
        .split(';')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(decode_desktop_entry_value)
        .collect()
}

#[cfg(target_os = "linux")]
fn current_desktop_names() -> Vec<String> {
    std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .split([':', ';'])
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(target_os = "linux")]
fn linux_entry_matches_current_desktop(only_show_in: &[String], not_show_in: &[String]) -> bool {
    let current_desktops = current_desktop_names();
    if !not_show_in.is_empty()
        && current_desktops.iter().any(|desktop| {
            not_show_in
                .iter()
                .any(|blocked| blocked.eq_ignore_ascii_case(desktop))
        })
    {
        return false;
    }
    only_show_in.is_empty()
        || current_desktops.iter().any(|desktop| {
            only_show_in
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(desktop))
        })
}

#[cfg(target_os = "linux")]
fn linux_desktop_entry_is_system_utility(name: &str, categories: &[String], detail: &str) -> bool {
    let detail_key = app_name_key(detail);
    if detail_key.starts_with("gnome-") && detail_key.contains("-panel.desktop") {
        return true;
    }
    if detail_key.starts_with("xdg-desktop-portal")
        || detail_key.starts_with("gcr-")
        || detail_key.starts_with("nm-")
        || detail_key.starts_with("org.freedesktop.ibus.")
        || detail_key.starts_with("org.gnome.shell.")
        || detail_key.starts_with("org.gnome.settings.")
    {
        return true;
    }
    if is_protected_desktop_app_name(name) {
        return true;
    }

    let has_category = |category: &str| {
        categories
            .iter()
            .any(|item| item.eq_ignore_ascii_case(category))
    };
    let has_any_category = |items: &[&str]| items.iter().any(|item| has_category(item));

    if has_any_category(&[
        "Calculator",
        "Clock",
        "ConsoleOnly",
        "Core",
        "DesktopSettings",
        "Documentation",
        "FileManager",
        "HardwareSettings",
        "Monitor",
        "Security",
        "Settings",
        "TerminalEmulator",
        "X-GNOME-Settings-Panel",
        "X-GNOME-Utilities",
        "X-XFCE-SettingsDialog",
        "X-Unity-Settings-Panel",
    ]) {
        return true;
    }

    has_category("System")
        && !has_any_category(&[
            "AudioVideo",
            "Development",
            "Game",
            "Graphics",
            "Network",
            "Office",
            "Player",
            "Recorder",
            "WebBrowser",
        ])
}

#[cfg(target_os = "linux")]
fn parse_desktop_entry(contents: &str, detail: String) -> Option<DoomscrollingDesktopAppCandidate> {
    let mut in_desktop_entry = false;
    let mut entry_type: Option<String> = None;
    let mut name: Option<String> = None;
    let mut exec: Option<String> = None;
    let mut hidden = false;
    let mut no_display = false;
    let mut categories = Vec::new();
    let mut only_show_in = Vec::new();
    let mut not_show_in = Vec::new();

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            in_desktop_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_desktop_entry {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match key {
            "Type" => entry_type = Some(value.trim().to_string()),
            "Name" => name = Some(decode_desktop_entry_value(value.trim())),
            "Exec" => exec = Some(decode_desktop_entry_value(value.trim())),
            "Hidden" => hidden = value.trim().eq_ignore_ascii_case("true"),
            "NoDisplay" => no_display = value.trim().eq_ignore_ascii_case("true"),
            "Categories" => categories = decode_desktop_entry_list(value.trim()),
            "OnlyShowIn" => only_show_in = decode_desktop_entry_list(value.trim()),
            "NotShowIn" => not_show_in = decode_desktop_entry_list(value.trim()),
            _ => {}
        }
    }

    if hidden
        || no_display
        || entry_type
            .as_deref()
            .is_some_and(|value| value != "Application")
        || !linux_entry_matches_current_desktop(&only_show_in, &not_show_in)
    {
        return None;
    }
    let name = normalize_app_candidate_name(name.as_deref()?)?;
    if linux_desktop_entry_is_system_utility(&name, &categories, &detail) {
        return None;
    }
    let mut process_names = exec
        .as_deref()
        .and_then(process_name_from_exec)
        .into_iter()
        .collect::<Vec<_>>();
    process_names.push(detail.clone());
    if let Some(stem) = Path::new(&detail).file_stem().and_then(|name| name.to_str()) {
        process_names.push(stem.to_string());
    }
    Some(candidate(
        name,
        "Installed app",
        Some(detail),
        process_names,
    ))
}

#[cfg(target_os = "linux")]
fn collect_desktop_entry_files(dir: &Path, depth: usize, files: &mut Vec<PathBuf>) {
    if depth > 3 || files.len() >= 2_000 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_desktop_entry_files(&path, depth + 1, files);
        } else if path
            .extension()
            .is_some_and(|extension| extension == "desktop")
        {
            files.push(path);
            if files.len() >= 2_000 {
                return;
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn linux_application_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        dirs.push(home.join(".local/share/applications"));
        dirs.push(home.join(".local/share/flatpak/exports/share/applications"));
    }
    if let Some(xdg_data_home) = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from) {
        dirs.push(xdg_data_home.join("applications"));
    }
    let xdg_data_dirs = std::env::var_os("XDG_DATA_DIRS")
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "/usr/local/share:/usr/share".to_string());
    for dir in xdg_data_dirs.split(':').filter(|dir| !dir.is_empty()) {
        dirs.push(PathBuf::from(dir).join("applications"));
    }
    dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));

    let mut seen = std::collections::HashSet::new();
    dirs.into_iter()
        .filter(|dir| seen.insert(dir.clone()))
        .collect()
}

#[cfg(target_os = "linux")]
fn list_installed_desktop_apps() -> Vec<DoomscrollingDesktopAppCandidate> {
    let mut files = Vec::new();
    for dir in linux_application_dirs() {
        collect_desktop_entry_files(&dir, 0, &mut files);
    }
    let mut candidates = Vec::new();
    for path in files {
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > 128 * 1024 {
            continue;
        }
        let Ok(contents) = std::fs::read_to_string(&path) else {
            continue;
        };
        let detail = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string());
        if let Some(app) = parse_desktop_entry(&contents, detail) {
            candidates.push(app);
        }
    }
    candidates
}

#[cfg(target_os = "macos")]
fn collect_macos_apps(dir: &Path, depth: usize, apps: &mut Vec<DoomscrollingDesktopAppCandidate>) {
    if depth > 2 || apps.len() >= 2_000 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|extension| extension == "app") {
            if let Some(name) = path.file_stem().and_then(|name| name.to_str()) {
                apps.push(candidate(
                    name.to_string(),
                    "Installed app",
                    Some(path.to_string_lossy().to_string()),
                    vec![name.to_string()],
                ));
            }
        } else if path.is_dir() {
            collect_macos_apps(&path, depth + 1, apps);
        }
        if apps.len() >= 2_000 {
            return;
        }
    }
}

#[cfg(target_os = "macos")]
fn list_installed_desktop_apps() -> Vec<DoomscrollingDesktopAppCandidate> {
    let mut apps = Vec::new();
    collect_macos_apps(Path::new("/Applications"), 0, &mut apps);
    collect_macos_apps(Path::new("/System/Applications"), 0, &mut apps);
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        collect_macos_apps(&home.join("Applications"), 0, &mut apps);
    }
    apps
}

#[cfg(windows)]
fn collect_windows_shortcuts(
    dir: &Path,
    depth: usize,
    apps: &mut Vec<DoomscrollingDesktopAppCandidate>,
) {
    if depth > 4 || apps.len() >= 2_000 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_windows_shortcuts(&path, depth + 1, apps);
        } else if path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("lnk") || extension.eq_ignore_ascii_case("appref-ms")
            })
        {
            if let Some(name) = path.file_stem().and_then(|name| name.to_str()) {
                apps.push(candidate(
                    name.to_string(),
                    "Installed app",
                    Some(path.to_string_lossy().to_string()),
                    vec![name.to_string()],
                ));
            }
        }
        if apps.len() >= 2_000 {
            return;
        }
    }
}

#[cfg(windows)]
fn list_installed_desktop_apps() -> Vec<DoomscrollingDesktopAppCandidate> {
    let mut apps = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
        collect_windows_shortcuts(
            &appdata.join("Microsoft\\Windows\\Start Menu\\Programs"),
            0,
            &mut apps,
        );
    }
    if let Some(programdata) = std::env::var_os("PROGRAMDATA").map(PathBuf::from) {
        collect_windows_shortcuts(
            &programdata.join("Microsoft\\Windows\\Start Menu\\Programs"),
            0,
            &mut apps,
        );
    }
    apps
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn list_installed_desktop_apps() -> Vec<DoomscrollingDesktopAppCandidate> {
    Vec::new()
}

fn desktop_rule_matchers(apps: Vec<DoomscrollingDesktopAppRuleInput>) -> HashMap<String, String> {
    let mut matchers = HashMap::new();
    for app in apps {
        let Some(app_name) = normalize_app_candidate_name(&app.name) else {
            continue;
        };
        if is_protected_desktop_app_name(&app_name) {
            continue;
        }
        for match_name in normalize_process_match_names(&app_name, app.match_names) {
            matchers
                .entry(app_name_key(&match_name))
                .or_insert_with(|| app_name.clone());
        }
    }
    matchers
}

#[cfg(target_os = "linux")]
fn read_linux_process_name(path: &Path) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(comm) = std::fs::read_to_string(path.join("comm")) {
        if let Some(name) = normalize_process_match_name(&comm) {
            names.push(name);
        }
    }
    if let Ok(cmdline) = std::fs::read(path.join("cmdline")) {
        if let Some(first_arg) = cmdline.split(|byte| *byte == 0).next() {
            if !first_arg.is_empty() {
                let command = String::from_utf8_lossy(first_arg);
                if let Some(name) = normalize_process_match_name(&command) {
                    names.push(name);
                }
            }
        }
    }
    names
}

#[cfg(target_os = "linux")]
fn list_blocked_desktop_app_matches(
    apps: Vec<DoomscrollingDesktopAppRuleInput>,
) -> Vec<DoomscrollingRunningDesktopAppMatch> {
    let matchers = desktop_rule_matchers(apps);
    if matchers.is_empty() {
        return Vec::new();
    }
    let current_process_id = std::process::id();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    let mut matches = Vec::new();
    let mut seen_processes = HashSet::new();
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(pid_text) = file_name.to_str() else {
            continue;
        };
        let Ok(process_id) = pid_text.parse::<u32>() else {
            continue;
        };
        if process_id <= 1 || process_id == current_process_id {
            continue;
        }
        for process_name in read_linux_process_name(&entry.path()) {
            let key = app_name_key(&process_name);
            let Some(app_name) = matchers.get(&key) else {
                continue;
            };
            if !seen_processes.insert(process_id) {
                break;
            }
            matches.push(DoomscrollingRunningDesktopAppMatch {
                app_name: app_name.clone(),
                process_name,
                process_id,
            });
            break;
        }
    }
    matches.sort_by(|a, b| {
        a.app_name
            .to_lowercase()
            .cmp(&b.app_name.to_lowercase())
            .then_with(|| a.process_id.cmp(&b.process_id))
    });
    matches
}

#[cfg(not(target_os = "linux"))]
fn list_blocked_desktop_app_matches(
    _apps: Vec<DoomscrollingDesktopAppRuleInput>,
) -> Vec<DoomscrollingRunningDesktopAppMatch> {
    Vec::new()
}

#[cfg(target_os = "linux")]
fn signal_desktop_process(process_id: u32, signal: &str) -> Result<(), String> {
    let status = std::process::Command::new("kill")
        .arg(signal)
        .arg(process_id.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("close app: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("close app failed with status {status}"))
    }
}

#[cfg(target_os = "linux")]
fn desktop_process_exists(process_id: u32) -> bool {
    std::process::Command::new("kill")
        .arg("-0")
        .arg(process_id.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn validate_close_process_id(process_id: u32) -> Result<(), String> {
    if process_id <= 1 || process_id == std::process::id() {
        return Err("refusing to close protected process".to_string());
    }
    let process_path = PathBuf::from("/proc").join(process_id.to_string());
    if read_linux_process_name(&process_path)
        .iter()
        .any(|name| is_protected_desktop_app_name(name))
    {
        return Err("refusing to close protected process".to_string());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn close_desktop_process(process_id: u32) -> Result<(), String> {
    validate_close_process_id(process_id)?;
    if !desktop_process_exists(process_id) {
        return Ok(());
    }
    if let Err(err) = signal_desktop_process(process_id, "-TERM") {
        if !desktop_process_exists(process_id) {
            return Ok(());
        }
        return Err(err);
    }
    for _ in 0..8 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if !desktop_process_exists(process_id) {
            return Ok(());
        }
    }
    signal_desktop_process(process_id, "-KILL")
}

#[cfg(not(target_os = "linux"))]
fn close_desktop_process(_process_id: u32) -> Result<(), String> {
    Err("desktop app closing is only available on Linux for now".to_string())
}

#[cfg(windows)]
fn windows_foreground_window() -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0 == 0 {
        None
    } else {
        Some(hwnd)
    }
}

#[cfg(windows)]
fn windows_foreground_process_id(
    hwnd: windows::Win32::Foundation::HWND,
) -> Option<u32> {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    let mut process_id = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut process_id as *mut u32));
    }
    if process_id == 0 {
        None
    } else {
        Some(process_id)
    }
}

#[cfg(windows)]
fn windows_process_image_path(process_id: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::core::PWSTR;

    let handle = unsafe {
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?
    };
    let mut buffer = vec![0u16; 32_768];
    let mut size = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size as *mut u32,
        )
    };
    let _ = unsafe { CloseHandle(handle) };
    result.ok()?;
    if size == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..size as usize]))
}

#[cfg(windows)]
fn windows_status_for_window(
    hwnd: windows::Win32::Foundation::HWND,
) -> DoomscrollingForegroundDesktopAppStatus {
    let Some(process_id) = windows_foreground_process_id(hwnd) else {
        return unavailable_foreground_desktop_app_status(
            "foreground window process is unavailable",
        );
    };
    let process_path = windows_process_image_path(process_id);
    let process_name = process_path
        .as_deref()
        .and_then(normalize_process_match_name)
        .or_else(|| Some(format!("process-{process_id}")));
    let app_name = process_path
        .as_deref()
        .and_then(|path| Path::new(path).file_stem().and_then(|name| name.to_str()))
        .and_then(normalize_app_candidate_name)
        .or_else(|| process_name.clone())
        .unwrap_or_else(|| format!("process-{process_id}"));
    let mut match_names = Vec::new();
    if let Some(path) = process_path {
        match_names.push(path);
    }
    foreground_status_from_parts(app_name, process_name, Some(process_id), match_names)
}

#[cfg(windows)]
fn foreground_desktop_app_status() -> DoomscrollingForegroundDesktopAppStatus {
    let Some(hwnd) = windows_foreground_window() else {
        return unavailable_foreground_desktop_app_status("no foreground window is active");
    };
    windows_status_for_window(hwnd)
}

#[cfg(windows)]
fn close_current_foreground_desktop_app(
    expected: DoomscrollingForegroundDesktopAppExpectation,
) -> Result<(), String> {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};

    let hwnd = windows_foreground_window().ok_or_else(|| "no foreground window is active".to_string())?;
    let status = windows_status_for_window(hwnd);
    validate_foreground_status_is_closeable(&status)?;
    if !foreground_expectation_matches(&status, &expected) {
        return Err("foreground app changed before it could be closed".to_string());
    }
    unsafe {
        PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))
            .map_err(|e| format!("close foreground window: {e}"))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn ns_string_to_string(value: Option<objc2::rc::Retained<objc2_foundation::NSString>>) -> Option<String> {
    value
        .map(|value| value.to_string())
        .and_then(|value| normalize_app_candidate_name(&value))
}

#[cfg(target_os = "macos")]
fn foreground_desktop_app_status() -> DoomscrollingForegroundDesktopAppStatus {
    use objc2_app_kit::NSWorkspace;

    let workspace = NSWorkspace::sharedWorkspace();
    let Some(app) = workspace.frontmostApplication() else {
        return unavailable_foreground_desktop_app_status("no foreground app is active");
    };
    let app_name = ns_string_to_string(app.localizedName())
        .or_else(|| ns_string_to_string(app.bundleIdentifier()));
    let Some(app_name) = app_name else {
        return unavailable_foreground_desktop_app_status("foreground app name is unavailable");
    };
    let process_id = app.processIdentifier();
    let process_id = if process_id > 0 {
        Some(process_id as u32)
    } else {
        None
    };
    let bundle_id = ns_string_to_string(app.bundleIdentifier());
    let mut match_names = Vec::new();
    if let Some(bundle_id) = bundle_id {
        match_names.push(bundle_id);
    }
    foreground_status_from_parts(app_name.clone(), Some(app_name), process_id, match_names)
}

#[cfg(target_os = "macos")]
fn close_current_foreground_desktop_app(
    expected: DoomscrollingForegroundDesktopAppExpectation,
) -> Result<(), String> {
    use objc2_app_kit::NSRunningApplication;

    let status = foreground_desktop_app_status();
    validate_foreground_status_is_closeable(&status)?;
    if !foreground_expectation_matches(&status, &expected) {
        return Err("foreground app changed before it could be closed".to_string());
    }
    let process_id = status
        .process_id
        .ok_or_else(|| "foreground app process is unavailable".to_string())?;
    let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(
        process_id as libc::pid_t,
    ) else {
        return Err("foreground app is no longer running".to_string());
    };
    if app.terminate() {
        Ok(())
    } else {
        Err("foreground app refused the close request".to_string())
    }
}

#[cfg(target_os = "linux")]
fn linux_is_wayland_session() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[cfg(target_os = "linux")]
fn x11_intern_atom<C: x11rb::connection::Connection>(
    conn: &C,
    name: &[u8],
) -> Result<u32, String> {
    use x11rb::protocol::xproto::ConnectionExt as _;

    conn.intern_atom(false, name)
        .map_err(|e| format!("intern X11 atom: {e}"))?
        .reply()
        .map(|reply| reply.atom)
        .map_err(|e| format!("read X11 atom: {e}"))
}

#[cfg(target_os = "linux")]
fn x11_property_u32<C: x11rb::connection::Connection>(
    conn: &C,
    window: u32,
    property: u32,
    type_: u32,
) -> Result<Option<u32>, String> {
    use x11rb::protocol::xproto::ConnectionExt as _;

    let reply = conn
        .get_property(false, window, property, type_, 0, 1)
        .map_err(|e| format!("read X11 property: {e}"))?
        .reply()
        .map_err(|e| format!("read X11 property reply: {e}"))?;
    Ok(reply.value32().and_then(|mut values| values.next()))
}

#[cfg(target_os = "linux")]
fn x11_property_string<C: x11rb::connection::Connection>(
    conn: &C,
    window: u32,
    property: u32,
    type_: u32,
) -> Option<String> {
    use x11rb::protocol::xproto::ConnectionExt as _;

    let reply = conn
        .get_property(false, window, property, type_, 0, 4096)
        .ok()?
        .reply()
        .ok()?;
    let value = String::from_utf8_lossy(&reply.value)
        .trim_matches('\0')
        .trim()
        .to_string();
    normalize_app_candidate_name(&value)
}

#[cfg(target_os = "linux")]
fn x11_wm_class<C: x11rb::connection::Connection>(conn: &C, window: u32) -> Vec<String> {
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _};

    let Ok(cookie) = conn.get_property(false, window, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 4096)
    else {
        return Vec::new();
    };
    let Ok(reply) = cookie.reply() else {
        return Vec::new();
    };
    reply
        .value
        .split(|byte| *byte == 0)
        .filter_map(|part| std::str::from_utf8(part).ok())
        .filter_map(normalize_app_candidate_name)
        .collect()
}

#[cfg(target_os = "linux")]
fn x11_foreground_window_status() -> Result<DoomscrollingForegroundDesktopAppStatus, String> {
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xproto::AtomEnum;

    let (conn, screen_num) = x11rb::connect(None).map_err(|e| format!("connect to X11: {e}"))?;
    let root = conn.setup().roots[screen_num].root;
    let active_window_atom = x11_intern_atom(&conn, b"_NET_ACTIVE_WINDOW")?;
    let Some(window) = x11_property_u32(&conn, root, active_window_atom, AtomEnum::WINDOW.into())?
    else {
        return Err("no active X11 window is available".to_string());
    };
    if window == 0 {
        return Err("no active X11 window is available".to_string());
    }
    x11_window_status(&conn, window)
}

#[cfg(target_os = "linux")]
fn x11_window_status<C: x11rb::connection::Connection>(
    conn: &C,
    window: u32,
) -> Result<DoomscrollingForegroundDesktopAppStatus, String> {
    use x11rb::protocol::xproto::AtomEnum;

    let pid_atom = x11_intern_atom(conn, b"_NET_WM_PID")?;
    let process_id = x11_property_u32(conn, window, pid_atom, AtomEnum::CARDINAL.into())?;
    let utf8_atom = x11_intern_atom(conn, b"UTF8_STRING")?;
    let wm_name_atom = x11_intern_atom(conn, b"_NET_WM_NAME")?;
    let title = x11_property_string(conn, window, wm_name_atom, utf8_atom)
        .or_else(|| x11_property_string(conn, window, AtomEnum::WM_NAME.into(), AtomEnum::STRING.into()));
    let wm_class_names = x11_wm_class(conn, window);
    let process_names = process_id
        .map(|id| read_linux_process_name(&PathBuf::from("/proc").join(id.to_string())))
        .unwrap_or_default();
    let app_name = wm_class_names
        .last()
        .cloned()
        .or_else(|| title.clone())
        .or_else(|| process_names.first().cloned())
        .ok_or_else(|| "active X11 window app name is unavailable".to_string())?;
    let process_name = process_names.first().cloned();
    let mut match_names = Vec::new();
    match_names.extend(wm_class_names);
    match_names.extend(process_names);
    if let Some(title) = title {
        match_names.push(title);
    }
    Ok(foreground_status_from_parts(
        app_name,
        process_name,
        process_id,
        match_names,
    ))
}

#[cfg(target_os = "linux")]
fn x11_close_active_window(
    expected: DoomscrollingForegroundDesktopAppExpectation,
) -> Result<(), String> {
    use x11rb::connection::Connection as _;
    use x11rb::protocol::xproto::{
        AtomEnum, ClientMessageData, ClientMessageEvent, ConnectionExt as _, EventMask,
    };

    let (conn, screen_num) = x11rb::connect(None).map_err(|e| format!("connect to X11: {e}"))?;
    let root = conn.setup().roots[screen_num].root;
    let active_window_atom = x11_intern_atom(&conn, b"_NET_ACTIVE_WINDOW")?;
    let Some(window) = x11_property_u32(&conn, root, active_window_atom, AtomEnum::WINDOW.into())?
    else {
        return Err("no active X11 window is available".to_string());
    };
    let status = x11_window_status(&conn, window)?;
    validate_foreground_status_is_closeable(&status)?;
    if !foreground_expectation_matches(&status, &expected) {
        return Err("foreground app changed before it could be closed".to_string());
    }
    let close_atom = x11_intern_atom(&conn, b"_NET_CLOSE_WINDOW")?;
    let event = ClientMessageEvent::new(
        32,
        window,
        close_atom,
        ClientMessageData::from([0u32, 2, 0, 0, 0]),
    );
    conn.send_event(
        false,
        root,
        EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
        event,
    )
    .map_err(|e| format!("send X11 close request: {e}"))?;
    conn.flush().map_err(|e| format!("flush X11 close request: {e}"))?;
    Ok(())
}

#[cfg(target_os = "linux")]
#[derive(Clone)]
struct WaylandToplevelInfo {
    handle: wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_handle_v1::ZwlrForeignToplevelHandleV1,
    title: Option<String>,
    app_id: Option<String>,
    active: bool,
    closed: bool,
}

#[cfg(target_os = "linux")]
struct WaylandToplevelState {
    manager: Option<wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_manager_v1::ZwlrForeignToplevelManagerV1>,
    toplevels: HashMap<wayland_client::backend::ObjectId, WaylandToplevelInfo>,
    finished: bool,
}

#[cfg(target_os = "linux")]
fn wayland_state_is_activated(state: &[u8]) -> bool {
    const ACTIVATED_STATE: u32 = 2;
    state.chunks_exact(4).any(|chunk| {
        u32::from_ne_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) == ACTIVATED_STATE
    })
}

#[cfg(target_os = "linux")]
fn wayland_status_from_toplevel(
    info: &WaylandToplevelInfo,
) -> Option<DoomscrollingForegroundDesktopAppStatus> {
    let app_name = info.app_id.clone().or_else(|| info.title.clone())?;
    let mut match_names = Vec::new();
    if let Some(app_id) = &info.app_id {
        match_names.push(app_id.clone());
    }
    if let Some(title) = &info.title {
        match_names.push(title.clone());
    }
    Some(foreground_status_from_parts(
        app_name,
        info.app_id.clone(),
        None,
        match_names,
    ))
}

#[cfg(target_os = "linux")]
impl WaylandToplevelState {
    fn active_toplevel(&self) -> Option<&WaylandToplevelInfo> {
        self.toplevels
            .values()
            .find(|info| info.active && !info.closed && (info.app_id.is_some() || info.title.is_some()))
    }
}

#[cfg(target_os = "linux")]
impl wayland_client::Dispatch<
    wayland_client::protocol::wl_registry::WlRegistry,
    (),
> for WaylandToplevelState {
    fn event(
        state: &mut Self,
        registry: &wayland_client::protocol::wl_registry::WlRegistry,
        event: wayland_client::protocol::wl_registry::Event,
        _: &(),
        _: &wayland_client::Connection,
        qh: &wayland_client::QueueHandle<Self>,
    ) {
        if let wayland_client::protocol::wl_registry::Event::Global {
            name,
            interface,
            version,
        } = event
        {
            if interface == "zwlr_foreign_toplevel_manager_v1" {
                let manager = registry.bind::<
                    wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_manager_v1::ZwlrForeignToplevelManagerV1,
                    _,
                    _,
                >(name, version.min(3), qh, ());
                state.manager = Some(manager);
            }
        }
    }
}

#[cfg(target_os = "linux")]
impl wayland_client::Dispatch<
    wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_manager_v1::ZwlrForeignToplevelManagerV1,
    (),
> for WaylandToplevelState {
    fn event(
        state: &mut Self,
        _: &wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_manager_v1::ZwlrForeignToplevelManagerV1,
        event: wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_manager_v1::Event,
        _: &(),
        _: &wayland_client::Connection,
        _: &wayland_client::QueueHandle<Self>,
    ) {
        use wayland_client::Proxy as _;
        use wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_manager_v1::Event;

        match event {
            Event::Toplevel { toplevel } => {
                state.toplevels.insert(
                    toplevel.id(),
                    WaylandToplevelInfo {
                        handle: toplevel,
                        title: None,
                        app_id: None,
                        active: false,
                        closed: false,
                    },
                );
            }
            Event::Finished => state.finished = true,
            _ => {}
        }
    }
}

#[cfg(target_os = "linux")]
impl wayland_client::Dispatch<
    wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_handle_v1::ZwlrForeignToplevelHandleV1,
    (),
> for WaylandToplevelState {
    fn event(
        state: &mut Self,
        toplevel: &wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_handle_v1::ZwlrForeignToplevelHandleV1,
        event: wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_handle_v1::Event,
        _: &(),
        _: &wayland_client::Connection,
        _: &wayland_client::QueueHandle<Self>,
    ) {
        use wayland_client::Proxy as _;
        use wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_handle_v1::Event;

        let key = toplevel.id();
        let Some(info) = state.toplevels.get_mut(&key) else {
            return;
        };
        match event {
            Event::Title { title } => info.title = normalize_app_candidate_name(&title),
            Event::AppId { app_id } => info.app_id = normalize_app_candidate_name(&app_id),
            Event::State { state: raw_state } => {
                info.active = wayland_state_is_activated(&raw_state);
            }
            Event::Closed => info.closed = true,
            _ => {}
        }
    }
}

#[cfg(target_os = "linux")]
wayland_client::delegate_noop!(WaylandToplevelState: ignore wayland_client::protocol::wl_output::WlOutput);

#[cfg(target_os = "linux")]
fn with_wayland_toplevel_state<T>(
    action: impl FnOnce(&wayland_client::Connection, &mut WaylandToplevelState) -> Result<T, String>,
) -> Result<T, String> {
    let conn = wayland_client::Connection::connect_to_env()
        .map_err(|e| format!("connect to Wayland: {e}"))?;
    let mut event_queue = conn.new_event_queue();
    let qh = event_queue.handle();
    conn.display().get_registry(&qh, ());
    let mut state = WaylandToplevelState {
        manager: None,
        toplevels: HashMap::new(),
        finished: false,
    };
    event_queue
        .roundtrip(&mut state)
        .map_err(|e| format!("read Wayland globals: {e}"))?;
    if state.manager.is_none() {
        return Err("Wayland compositor does not advertise zwlr_foreign_toplevel_manager_v1".to_string());
    }
    event_queue
        .roundtrip(&mut state)
        .map_err(|e| format!("read Wayland toplevels: {e}"))?;
    action(&conn, &mut state)
}

#[cfg(target_os = "linux")]
fn wayland_foreground_window_status() -> Result<DoomscrollingForegroundDesktopAppStatus, String> {
    with_wayland_toplevel_state(|_, state| {
        let Some(info) = state.active_toplevel() else {
            return Err("no active Wayland toplevel is available".to_string());
        };
        wayland_status_from_toplevel(info)
            .ok_or_else(|| "active Wayland toplevel app name is unavailable".to_string())
    })
}

#[cfg(target_os = "linux")]
fn wayland_close_active_window(
    expected: DoomscrollingForegroundDesktopAppExpectation,
) -> Result<(), String> {
    with_wayland_toplevel_state(|conn, state| {
        let Some(info) = state.active_toplevel().cloned() else {
            return Err("no active Wayland toplevel is available".to_string());
        };
        let status = wayland_status_from_toplevel(&info)
            .ok_or_else(|| "active Wayland toplevel app name is unavailable".to_string())?;
        validate_foreground_status_is_closeable(&status)?;
        if !foreground_expectation_matches(&status, &expected) {
            return Err("foreground app changed before it could be closed".to_string());
        }
        info.handle.close();
        conn.flush()
            .map_err(|e| format!("flush Wayland close request: {e}"))?;
        Ok(())
    })
}

#[cfg(target_os = "linux")]
fn foreground_desktop_app_status() -> DoomscrollingForegroundDesktopAppStatus {
    if linux_is_wayland_session() {
        return wayland_foreground_window_status()
            .unwrap_or_else(unavailable_foreground_desktop_app_status);
    }
    if std::env::var_os("DISPLAY").is_some() {
        return x11_foreground_window_status()
            .unwrap_or_else(unavailable_foreground_desktop_app_status);
    }
    unavailable_foreground_desktop_app_status(
        "foreground desktop app detection needs X11 or a Wayland compositor with zwlr_foreign_toplevel_manager_v1",
    )
}

#[cfg(target_os = "linux")]
fn close_current_foreground_desktop_app(
    expected: DoomscrollingForegroundDesktopAppExpectation,
) -> Result<(), String> {
    if linux_is_wayland_session() {
        return wayland_close_active_window(expected);
    }
    if std::env::var_os("DISPLAY").is_some() {
        return x11_close_active_window(expected);
    }
    Err("foreground desktop app closing needs X11 or a Wayland compositor with zwlr_foreign_toplevel_manager_v1".to_string())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn foreground_desktop_app_status() -> DoomscrollingForegroundDesktopAppStatus {
    unavailable_foreground_desktop_app_status(
        "foreground desktop app detection is not supported on this platform",
    )
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn close_current_foreground_desktop_app(
    _expected: DoomscrollingForegroundDesktopAppExpectation,
) -> Result<(), String> {
    Err("foreground desktop app closing is not supported on this platform".to_string())
}

fn disconnected_extension_status(
    checked_at: DateTime<Utc>,
    reason: impl Into<String>,
) -> DoomscrollingExtensionStatus {
    DoomscrollingExtensionStatus {
        connected: false,
        last_seen_at: None,
        last_message_type: None,
        checked_at: checked_at.to_rfc3339_opts(SecondsFormat::Millis, true),
        stale_seconds: EXTENSION_CONNECTION_STALE_SECONDS,
        reason: Some(reason.into()),
    }
}

fn extension_status_from_file_contents(
    contents: &str,
    checked_at: DateTime<Utc>,
    fresh_after: Option<DateTime<Utc>>,
) -> DoomscrollingExtensionStatus {
    let Ok(record) = serde_json::from_str::<DoomscrollingExtensionConnectionFile>(contents) else {
        return disconnected_extension_status(checked_at, "connection status file is invalid");
    };
    let Ok(last_seen_at) = DateTime::parse_from_rfc3339(&record.last_seen_at) else {
        return disconnected_extension_status(checked_at, "connection timestamp is invalid");
    };

    let age_seconds = (checked_at - last_seen_at.with_timezone(&Utc))
        .num_seconds()
        .max(0);
    let before_current_app_session = fresh_after
        .is_some_and(|minimum_seen_at| last_seen_at.with_timezone(&Utc) < minimum_seen_at);
    DoomscrollingExtensionStatus {
        connected: age_seconds <= EXTENSION_CONNECTION_STALE_SECONDS && !before_current_app_session,
        last_seen_at: Some(record.last_seen_at),
        last_message_type: record.last_message_type,
        checked_at: checked_at.to_rfc3339_opts(SecondsFormat::Millis, true),
        stale_seconds: EXTENSION_CONNECTION_STALE_SECONDS,
        reason: if before_current_app_session {
            Some("connection is from an older app session".to_string())
        } else if age_seconds > EXTENSION_CONNECTION_STALE_SECONDS {
            Some("connection status is stale".to_string())
        } else {
            None
        },
    }
}

fn write_text_file_atomically(path: &std::path::Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "state path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "state path has no file name".to_string())?
        .to_string_lossy();
    let tmp_path = parent.join(format!("{file_name}.tmp"));
    {
        let mut file = std::fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp_path, path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn doomscrolling_write_state<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: DoomscrollingRuntimeState,
) -> Result<(), String> {
    validate_state(&state)?;
    let path = state_path(&app)?;
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    write_text_file_atomically(&path, &json)
}

#[tauri::command]
pub async fn doomscrolling_record_usage_sample<R: Runtime>(
    app: tauri::AppHandle<R>,
    db_url: String,
    sample: DoomscrollingUsageSampleInput,
) -> Result<(), String> {
    let sample = normalize_usage_sample(sample, "app")?;
    let pool = connect_sqlite(app, db_url).await?;
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
    .map_err(|e| format!("record doomscrolling usage sample: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn doomscrolling_list_usage_samples<R: Runtime>(
    app: tauri::AppHandle<R>,
    db_url: String,
    local_date: String,
) -> Result<Vec<DoomscrollingUsageSampleRow>, String> {
    if !validate_local_date(&local_date) {
        return Err("local_date must use yyyy-mm-dd".to_string());
    }
    let pool = connect_sqlite(app, db_url).await?;
    let rows = sqlx::query(
        "SELECT id, source_type, source_key, display_name, started_at,
                elapsed_seconds, local_date, created_at
         FROM doomscrolling_usage_samples
         WHERE local_date = ?
         ORDER BY started_at ASC, id ASC",
    )
    .bind(local_date)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("list doomscrolling usage samples: {e}"))?;

    rows.into_iter()
        .map(|row| {
            Ok(DoomscrollingUsageSampleRow {
                id: row.try_get("id").map_err(|e| e.to_string())?,
                source_type: row.try_get("source_type").map_err(|e| e.to_string())?,
                source_key: row.try_get("source_key").map_err(|e| e.to_string())?,
                display_name: row.try_get("display_name").map_err(|e| e.to_string())?,
                started_at: row.try_get("started_at").map_err(|e| e.to_string())?,
                elapsed_seconds: row.try_get("elapsed_seconds").map_err(|e| e.to_string())?,
                local_date: row.try_get("local_date").map_err(|e| e.to_string())?,
                created_at: row.try_get("created_at").map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

#[tauri::command]
pub fn doomscrolling_write_limit_state<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: DoomscrollingLimitState,
) -> Result<(), String> {
    validate_limit_state(&state)?;
    let path = limit_state_path(&app)?;
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    write_text_file_atomically(&path, &json)
}

#[tauri::command]
pub fn doomscrolling_get_extension_status<R: Runtime>(
    app: tauri::AppHandle<R>,
    fresh_after: Option<String>,
) -> Result<DoomscrollingExtensionStatus, String> {
    let checked_at = now_utc();
    let fresh_after = fresh_after
        .as_deref()
        .map(DateTime::parse_from_rfc3339)
        .transpose()
        .map_err(|e| format!("parse fresh_after: {e}"))?
        .map(|date| date.with_timezone(&Utc));
    let path = extension_connection_path(&app)?;
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(extension_status_from_file_contents(
            &contents,
            checked_at,
            fresh_after,
        )),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(
            disconnected_extension_status(checked_at, "no extension connection has been recorded"),
        ),
        Err(err) => Err(format!("read extension connection status: {err}")),
    }
}

#[tauri::command]
pub fn doomscrolling_open_extension_install_docs() -> Result<(), String> {
    open_fixed_url(EXTENSION_INSTALL_README_URL)
}

#[tauri::command]
pub fn doomscrolling_list_desktop_apps() -> Vec<DoomscrollingDesktopAppCandidate> {
    sort_and_deduplicate_candidates(list_installed_desktop_apps())
}

#[tauri::command]
pub fn doomscrolling_list_blocked_desktop_app_matches(
    apps: Vec<DoomscrollingDesktopAppRuleInput>,
) -> Vec<DoomscrollingRunningDesktopAppMatch> {
    list_blocked_desktop_app_matches(apps)
}

#[tauri::command]
pub fn doomscrolling_close_desktop_app(process_id: u32) -> Result<(), String> {
    close_desktop_process(process_id)
}

#[tauri::command]
pub fn doomscrolling_close_current_foreground_desktop_app(
    expected: DoomscrollingForegroundDesktopAppExpectation,
) -> Result<(), String> {
    close_current_foreground_desktop_app(expected)
}

#[tauri::command]
pub fn doomscrolling_get_foreground_desktop_app() -> DoomscrollingForegroundDesktopAppStatus {
    foreground_desktop_app_status()
}

#[cfg(test)]
mod tests {
    use super::{
        extension_status_from_file_contents, normalize_app_candidate_name,
        sort_and_deduplicate_candidates, validate_state, DoomscrollingDesktopAppCandidate,
        DoomscrollingDesktopAppRuleInput, DoomscrollingLimitState, DoomscrollingLimitStateItem,
        DoomscrollingRuntimeState, DoomscrollingUsageSampleInput,
    };
    use chrono::{DateTime, Utc};

    fn state(phase: &str) -> DoomscrollingRuntimeState {
        DoomscrollingRuntimeState {
            active: phase != "inactive",
            phase: phase.to_string(),
            active_run_id: None,
            active_block_id: None,
            remaining_seconds: Some(30),
            updated_at: "2026-05-26T00:00:00.000Z".to_string(),
        }
    }

    #[test]
    fn accepts_supported_phases() {
        for phase in ["inactive", "focus", "short_break", "long_break"] {
            assert!(validate_state(&state(phase)).is_ok());
        }
    }

    #[test]
    fn rejects_unknown_phase() {
        assert!(validate_state(&state("planning")).is_err());
    }

    #[test]
    fn rejects_negative_remaining_seconds() {
        let mut state = state("focus");
        state.remaining_seconds = Some(-1);
        assert!(validate_state(&state).is_err());
    }

    #[test]
    fn recent_extension_status_is_connected() {
        let checked_at = DateTime::parse_from_rfc3339("2026-05-26T00:01:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        let status = extension_status_from_file_contents(
            r#"{"lastSeenAt":"2026-05-26T00:00:05.000Z","lastMessageType":"get_state"}"#,
            checked_at,
            None,
        );

        assert!(status.connected);
        assert_eq!(status.last_message_type.as_deref(), Some("get_state"));
        assert_eq!(
            status.last_seen_at.as_deref(),
            Some("2026-05-26T00:00:05.000Z")
        );
        assert!(status.reason.is_none());
    }

    #[test]
    fn stale_extension_status_is_disconnected() {
        let checked_at = DateTime::parse_from_rfc3339("2026-05-26T00:03:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        let status = extension_status_from_file_contents(
            r#"{"lastSeenAt":"2026-05-26T00:00:00.000Z","lastMessageType":"get_state"}"#,
            checked_at,
            None,
        );

        assert!(!status.connected);
        assert_eq!(status.reason.as_deref(), Some("connection status is stale"));
    }

    #[test]
    fn previous_app_session_extension_status_is_disconnected() {
        let checked_at = DateTime::parse_from_rfc3339("2026-05-26T00:01:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        let fresh_after = DateTime::parse_from_rfc3339("2026-05-26T00:00:30.000Z")
            .unwrap()
            .with_timezone(&Utc);
        let status = extension_status_from_file_contents(
            r#"{"lastSeenAt":"2026-05-26T00:00:05.000Z","lastMessageType":"get_state"}"#,
            checked_at,
            Some(fresh_after),
        );

        assert!(!status.connected);
        assert_eq!(
            status.reason.as_deref(),
            Some("connection is from an older app session")
        );
    }

    #[test]
    fn normalizes_desktop_app_candidate_names() {
        assert_eq!(
            normalize_app_candidate_name("  Visual   Studio Code  ").as_deref(),
            Some("Visual Studio Code")
        );
        assert!(normalize_app_candidate_name("   ").is_none());
    }

    #[test]
    fn recognizes_protected_desktop_app_and_process_names() {
        assert!(super::is_protected_desktop_app_name("Ganbaru AI"));
        assert!(super::is_protected_desktop_app_name("Terminal"));
        assert!(super::is_protected_desktop_app_name("gnome-shell"));
        assert!(super::is_protected_desktop_app_name("python3.12"));
        assert!(super::is_protected_desktop_app_name("explorer.exe"));
        assert!(!super::is_protected_desktop_app_name("Steam"));
    }

    #[test]
    fn foreground_app_detection_reports_unavailable_without_guessing() {
        let status = super::foreground_desktop_app_status();
        assert!(!status.available);
        assert!(status.app_name.is_none());
        assert!(status.process_name.is_none());
        assert!(status.process_id.is_none());
    }

    #[test]
    fn usage_samples_reject_protected_desktop_apps() {
        let sample = DoomscrollingUsageSampleInput {
            id: Some("sample-1".to_string()),
            source_type: "desktop-app".to_string(),
            source_key: "Terminal".to_string(),
            display_name: Some("Terminal".to_string()),
            started_at: 1_779_923_600_000,
            elapsed_seconds: 30,
            local_date: "2026-05-28".to_string(),
        };

        assert!(super::normalize_usage_sample(sample, "test").is_err());
    }

    #[test]
    fn usage_samples_normalize_website_hosts() {
        let sample = DoomscrollingUsageSampleInput {
            id: Some("sample-1".to_string()),
            source_type: "website".to_string(),
            source_key: "YouTube.com.".to_string(),
            display_name: Some("YouTube".to_string()),
            started_at: 1_779_923_600_000,
            elapsed_seconds: 30,
            local_date: "2026-05-28".to_string(),
        };

        let normalized = super::normalize_usage_sample(sample, "test").unwrap();
        assert_eq!(normalized.source_key, "youtube.com");
        assert_eq!(normalized.elapsed_seconds, 30);
    }

    #[test]
    fn limit_state_requires_a_local_date() {
        let state = DoomscrollingLimitState {
            local_date: "today".to_string(),
            updated_at: "2026-05-28T00:00:00.000Z".to_string(),
            database_file_name: "ganbaru-ai-dev.db".to_string(),
            limits: vec![DoomscrollingLimitStateItem {
                id: "youtube".to_string(),
                used_seconds: 60,
                limit_seconds: 600,
                remaining_seconds: 540,
                exhausted: false,
            }],
        };

        assert!(super::validate_limit_state(&state).is_err());
    }

    #[test]
    fn sorts_and_deduplicates_desktop_app_candidates() {
        let apps = sort_and_deduplicate_candidates(vec![
            DoomscrollingDesktopAppCandidate {
                name: "Terminal".to_string(),
                source: "Installed app".to_string(),
                detail: Some("terminal.desktop".to_string()),
                process_names: vec!["gnome-terminal".to_string()],
            },
            DoomscrollingDesktopAppCandidate {
                name: "Steam".to_string(),
                source: "Installed app".to_string(),
                detail: Some("steam.desktop".to_string()),
                process_names: vec!["Steam".to_string(), "steam".to_string()],
            },
            DoomscrollingDesktopAppCandidate {
                name: "steam".to_string(),
                source: "Installed app".to_string(),
                detail: Some("duplicate.desktop".to_string()),
                process_names: vec!["steam".to_string()],
            },
            DoomscrollingDesktopAppCandidate {
                name: "Discord".to_string(),
                source: "Installed app".to_string(),
                detail: None,
                process_names: vec!["Discord".to_string()],
            },
        ]);

        assert_eq!(
            apps.iter().map(|app| app.name.as_str()).collect::<Vec<_>>(),
            vec!["Discord", "Steam"]
        );
    }

    #[test]
    fn desktop_rule_matchers_skip_protected_process_names() {
        let matchers = super::desktop_rule_matchers(vec![
            DoomscrollingDesktopAppRuleInput {
                name: "Terminal".to_string(),
                match_names: vec!["gnome-terminal".to_string()],
            },
            DoomscrollingDesktopAppRuleInput {
                name: "Steam".to_string(),
                match_names: vec!["sh".to_string(), "steam".to_string()],
            },
        ]);

        assert!(!matchers.contains_key("terminal"));
        assert!(!matchers.contains_key("gnome-terminal"));
        assert!(!matchers.contains_key("sh"));
        assert_eq!(matchers.get("steam").map(String::as_str), Some("Steam"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parses_visible_linux_desktop_entries() {
        let app = super::parse_desktop_entry(
            r#"
[Desktop Entry]
Type=Application
Name=Visual\sStudio\sCode
Exec=code
"#,
            "code.desktop".to_string(),
        )
        .unwrap();

        assert_eq!(app.name, "Visual Studio Code");
        assert_eq!(app.source, "Installed app");
        assert_eq!(app.process_names, vec!["Visual Studio Code", "code"]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn extracts_linux_process_name_from_exec() {
        assert_eq!(
            super::process_name_from_exec(r#""/usr/bin/gnome-calculator" %U"#).as_deref(),
            Some("gnome-calculator")
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn skips_hidden_linux_desktop_entries() {
        assert!(super::parse_desktop_entry(
            r#"
[Desktop Entry]
Type=Application
Name=Hidden app
NoDisplay=true
"#,
            "hidden.desktop".to_string(),
        )
        .is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn skips_linux_system_utility_desktop_entries() {
        assert!(super::parse_desktop_entry(
            r#"
[Desktop Entry]
Type=Application
Name=Settings
Categories=GNOME;GTK;Settings;
Exec=gnome-control-center
"#,
            "org.gnome.Settings.desktop".to_string(),
        )
        .is_none());
        assert!(super::parse_desktop_entry(
            r#"
[Desktop Entry]
Type=Application
Name=System Monitor
Categories=GNOME;GTK;System;Monitor;
Exec=gnome-system-monitor
"#,
            "org.gnome.SystemMonitor.desktop".to_string(),
        )
        .is_none());
    }
}
