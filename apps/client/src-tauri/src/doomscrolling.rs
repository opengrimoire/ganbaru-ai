use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{Manager, Runtime};

const STATE_FILE: &str = "doomscrolling-state.json";
const EXTENSION_CONNECTION_FILE: &str = "doomscrolling-extension-status.json";
const EXTENSION_CONNECTION_STALE_SECONDS: i64 = 60;
const EXTENSION_INSTALL_README_URL: &str =
    "https://github.com/opengrimoire/GanbaruAI/blob/dev/extensions/chrome/README.md";
const PROTECTED_DESKTOP_APP_NAMES: &[&str] = &[
    "GanbaruAI",
    "ganbaruai",
    "ganbaruai-dev",
    "GanbaruAI Dev",
    "GanbaruAI (dev)",
    "org.opengrimoire.ganbaruai",
    "org.opengrimoire.ganbaruai.dev",
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

fn normalize_process_match_name(name: &str) -> Option<String> {
    let trimmed = name.trim().trim_matches('"').trim_matches('\'');
    let basename = Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(trimmed);
    normalize_app_candidate_name(basename)
}

fn normalize_process_match_names(name: &str, process_names: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for candidate in std::iter::once(name.to_string()).chain(process_names.into_iter()) {
        let Some(process_name) = normalize_process_match_name(&candidate) else {
            continue;
        };
        let key = app_name_key(&process_name);
        if is_protected_desktop_app_name(&process_name) || seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        normalized.push(process_name);
    }
    normalized
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
    let process_names = exec
        .as_deref()
        .and_then(process_name_from_exec)
        .into_iter()
        .collect();
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

#[cfg(test)]
mod tests {
    use super::{
        extension_status_from_file_contents, normalize_app_candidate_name,
        sort_and_deduplicate_candidates, validate_state, DoomscrollingDesktopAppCandidate,
        DoomscrollingDesktopAppRuleInput, DoomscrollingRuntimeState,
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
        assert!(super::is_protected_desktop_app_name("GanbaruAI"));
        assert!(super::is_protected_desktop_app_name("Terminal"));
        assert!(super::is_protected_desktop_app_name("gnome-shell"));
        assert!(super::is_protected_desktop_app_name("python3.12"));
        assert!(super::is_protected_desktop_app_name("explorer.exe"));
        assert!(!super::is_protected_desktop_app_name("Steam"));
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
