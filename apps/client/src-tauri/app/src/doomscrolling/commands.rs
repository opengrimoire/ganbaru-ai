use super::*;
use std::process::Stdio;
use tauri::Runtime;

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

#[tauri::command]
pub fn doomscrolling_open_extension_install_docs() -> Result<(), String> {
    open_fixed_url(EXTENSION_INSTALL_README_URL)
}

#[tauri::command]
pub async fn doomscrolling_list_blocked_desktop_app_matches(
    apps: Vec<DoomscrollingDesktopAppRuleInput>,
) -> Result<Vec<DoomscrollingRunningDesktopAppMatch>, String> {
    let generation = PROCESS_SCAN_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        list_blocked_desktop_app_matches(apps, || {
            PROCESS_SCAN_GENERATION.load(Ordering::Acquire) != generation
        })
    })
    .await
    .map_err(|error| format!("desktop process scan worker failed: {error}"))
}

#[tauri::command]
pub async fn doomscrolling_close_desktop_app<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: DoomscrollingCloseDesktopAppRequest,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || close_desktop_process(&app, request))
        .await
        .map_err(|error| format!("desktop close worker failed: {error}"))?
}

#[tauri::command]
pub async fn doomscrolling_close_current_foreground_desktop_app<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: DoomscrollingCloseForegroundDesktopAppRequest,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let rule_identity = request.rule_identity;
        let mut authorize = |status: &DoomscrollingForegroundDesktopAppStatus| {
            let authorization = load_close_authorization(&app, &rule_identity)?;
            validate_names_authorized(foreground_status_match_names(status), &authorization)
        };
        close_current_foreground_desktop_app(request.expected, &mut authorize)
    })
    .await
    .map_err(|error| format!("foreground close worker failed: {error}"))?
}

#[tauri::command]
pub async fn doomscrolling_get_foreground_desktop_app()
-> Result<DoomscrollingForegroundDesktopAppStatus, String> {
    let generation = FOREGROUND_OBSERVATION_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        let status = foreground_desktop_app_status();
        if FOREGROUND_OBSERVATION_GENERATION.load(Ordering::Acquire) != generation {
            unavailable_foreground_desktop_app_status("foreground observation was replaced")
        } else {
            status
        }
    })
    .await
    .map_err(|error| format!("foreground observation worker failed: {error}"))
}
