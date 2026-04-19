//! Vault filesystem layer.
//!
//! The vault is a single folder on disk that holds all user data the app
//! produces (notes, diary, events index, settings). For now only
//! `vault/config.json` is wired; the rest of the vault layout described in
//! `CLAUDE.md` will land as the matching features ship.
//!
//! Path: `app_config_dir / "vault"`. A future "vault location" setting can
//! replace [`vault_path`] without touching callers.
//!
//! Writes are atomic: serialize to `.tmp`, fsync, rename. A crash mid-write
//! leaves either the previous good file or the temp file (which is ignored
//! on next read).

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

const CONFIG_FILE: &str = "config.json";

/// Resolve the vault folder path. The folder is created on demand by the
/// helpers below; callers do not need to ensure it exists.
fn vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    path.push("vault");
    Ok(path)
}

fn ensure_vault(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = vault_path(app)?;
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Read `vault/config.json` as a string. Returns `"{}"` if the file is
/// missing so the frontend can treat first-run identically to a wiped
/// config.
#[tauri::command]
pub fn vault_read_config(app: tauri::AppHandle) -> Result<String, String> {
    let mut path = ensure_vault(&app)?;
    path.push(CONFIG_FILE);
    if !path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write `vault/config.json` atomically. Validates the input parses as JSON
/// before persisting (defense in depth: the frontend is the source of truth
/// for shape but the backend refuses to write garbage).
#[tauri::command]
pub fn vault_write_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|e| format!("config payload is not valid JSON: {e}"))?;

    let dir = ensure_vault(&app)?;
    let final_path = dir.join(CONFIG_FILE);
    let tmp_path = dir.join(format!("{CONFIG_FILE}.tmp"));

    {
        let mut file = fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }

    fs::rename(&tmp_path, &final_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Read a UTF-8 text file from an absolute path returned by the dialog
/// plugin. The user has already authorized that location by picking it.
/// Pulls in only `std::fs::read_to_string` so we don't depend on
/// tauri-plugin-fs just for one read.
#[tauri::command]
pub fn vault_read_text(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err("path must be absolute".to_string());
    }
    fs::read_to_string(&p).map_err(|e| e.to_string())
}

/// Write a UTF-8 text file to an absolute path returned by the dialog
/// plugin (typically through a Save dialog). Atomic via .tmp + rename so
/// an interrupted write cannot leave the target file truncated.
#[tauri::command]
pub fn vault_write_text(path: String, contents: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.is_absolute() {
        return Err("path must be absolute".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "target has no parent directory".to_string())?
        .to_path_buf();
    let file_name = target
        .file_name()
        .ok_or_else(|| "target has no file name".to_string())?
        .to_string_lossy()
        .into_owned();
    let tmp_path = parent.join(format!("{file_name}.tmp"));
    {
        let mut file = fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp_path, &target).map_err(|e| e.to_string())?;
    Ok(())
}
