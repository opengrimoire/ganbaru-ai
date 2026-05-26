use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use tauri::{Manager, Runtime};

const STATE_FILE: &str = "procrastination-stopper-state.json";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcrastinationStopperRuntimeState {
    active: bool,
    phase: String,
    active_run_id: Option<String>,
    active_block_id: Option<String>,
    remaining_seconds: Option<i64>,
    updated_at: String,
}

fn state_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&path).map_err(|e| format!("create app config dir: {e}"))?;
    path.push(STATE_FILE);
    Ok(path)
}

fn validate_state(state: &ProcrastinationStopperRuntimeState) -> Result<(), String> {
    match state.phase.as_str() {
        "inactive" | "focus" | "short_break" | "long_break" => {}
        other => return Err(format!("unsupported stopper phase '{other}'")),
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
pub fn procrastination_stopper_write_state<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: ProcrastinationStopperRuntimeState,
) -> Result<(), String> {
    validate_state(&state)?;
    let path = state_path(&app)?;
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    write_text_file_atomically(&path, &json)
}

#[cfg(test)]
mod tests {
    use super::{validate_state, ProcrastinationStopperRuntimeState};

    fn state(phase: &str) -> ProcrastinationStopperRuntimeState {
        ProcrastinationStopperRuntimeState {
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
}
