use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{Manager, Runtime};

const STATE_FILE: &str = "doomscrolling-state.json";
const EXTENSION_CONNECTION_FILE: &str = "doomscrolling-extension-status.json";
const EXTENSION_CONNECTION_STALE_SECONDS: i64 = 60;
const EXTENSION_INSTALL_README_URL: &str =
    "https://github.com/opengrimoire/GanbaruAI/blob/dev/extensions/chrome/README.md";

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

#[cfg(test)]
mod tests {
    use super::{extension_status_from_file_contents, validate_state, DoomscrollingRuntimeState};
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
}
