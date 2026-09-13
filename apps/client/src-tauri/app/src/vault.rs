//! Ganbaru AI folder filesystem layer.
//!
//! The Ganbaru AI folder holds portable user data. The Tauri app config
//! directory stores only the active folder pointer and device-local runtime
//! files.
//!
//! Writes are atomic: serialize to `.tmp`, fsync, rename. A crash mid-write
//! leaves either the previous good file or the temp file, which is ignored
//! on next read.

use chrono::{DateTime, SecondsFormat, Utc};
#[cfg(target_os = "android")]
use ganbaru_mobile_documents::MobileDocumentsExt;
use std::collections::BTreeMap;
use std::fs;
#[cfg(not(target_os = "android"))]
use std::io::Read;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};
#[cfg(not(target_os = "android"))]
use tauri_plugin_dialog::{DialogExt, FilePath};
#[cfg(target_os = "ios")]
use tauri_plugin_fs::{FsExt, OpenOptions};

static APP_STATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
static CONFIG_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) mod backup;
pub(crate) mod handoff;
pub(crate) mod ownership;
#[allow(dead_code)] // H04 consumes the source-freeze boundary.
pub(crate) mod quiescence;

pub const APP_SQLITE_FILE: &str = "ganbaru-ai.sqlite";
const PRODUCTION_DATA_FOLDER_NAME: &str = "Ganbaru AI";
const DEVELOPMENT_DATA_FOLDER_NAME: &str = "Ganbaru AI Dev";
const APP_STATE_FILE: &str = "app-state.json";
const VAULT_MANIFEST_FILE: &str = "vault.json";
const CONFIG_FILE: &str = "config.json";
const VAULT_APP_MARKER: &str = "ganbaru-ai";
const VAULT_SCHEMA_VERSION: u32 = 1;
const MAX_RECENT_VAULTS: usize = 8;
const MAX_CONFIG_PATCH_DEPTH: usize = 16;
const MAX_CONFIG_PATCH_SEGMENT_BYTES: usize = 128;
const MAX_CONFIG_PATCH_PATH_BYTES: usize = 1024;
const MAX_CONFIG_PATCH_COUNT: usize = 256;
const MAX_CONFIG_PATCH_BATCH_BYTES: usize = 1024 * 1024;
#[cfg(target_os = "android")]
const MOBILE_VAULT_IMPORT_MAX_FILES: u32 = 100_000;
#[cfg(target_os = "android")]
const MOBILE_VAULT_IMPORT_MAX_BYTES: u64 = 100 * 1024 * 1024 * 1024;
#[cfg(target_os = "android")]
const MOBILE_VAULT_IMPORT_MAX_DEPTH: u32 = 64;

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultAppState {
    #[serde(deserialize_with = "required_nullable")]
    pub device_id: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub active_vault_path: Option<String>,
    pub recent_vault_paths: Vec<String>,
    pub music_root_bindings: BTreeMap<String, BTreeMap<String, String>>,
    pub project_working_folders: ganbaru_working_folders::WorkingFolderDeviceState,
    pub chat: crate::chat::device_state::ChatDeviceState,
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    <Option<T> as serde::Deserialize>::deserialize(deserializer)
}

#[tauri::command]
pub(crate) fn vault_device_id<R: Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    ensure_device_id(&app)
}

pub(crate) fn ensure_device_id<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<String, String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("create device id timestamp: {error}"))?
        .as_nanos();
    let candidate = format!("device-{timestamp:x}-{:x}", std::process::id());
    update_app_state(app, |state| {
        if let Some(device_id) = state
            .device_id
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            return Ok(device_id.clone());
        }
        state.device_id = Some(candidate.clone());
        Ok(candidate)
    })
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultManifest {
    app: String,
    schema_version: u32,
    vault_id: String,
    display_name: String,
    created_at: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub path: String,
    pub config_path: String,
    pub database_path: String,
    pub vault_id: String,
    pub display_name: String,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultConfigPatch {
    pub path: Vec<String>,
    #[serde(default)]
    pub remove: bool,
    #[serde(default)]
    pub value: serde_json::Value,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDefaultLocation {
    pub path: String,
    pub parent_path: String,
    pub folder_name: String,
    pub development_build: bool,
}

fn app_state_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    path.push(APP_STATE_FILE);
    Ok(path)
}

fn read_app_state_from_path(path: &Path) -> Result<VaultAppState, String> {
    if !path.exists() {
        return Ok(VaultAppState::default());
    }
    let contents = fs::read_to_string(path).map_err(|e| format!("read app state: {e}"))?;
    serde_json::from_str(&contents).map_err(|e| format!("parse app state: {e}"))
}

fn write_app_state_to_path(path: &Path, state: &VaultAppState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create app config dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    write_text_file_atomically(path, &json)
}

pub(crate) fn read_app_state<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<VaultAppState, String> {
    let _guard = APP_STATE_LOCK
        .lock()
        .map_err(|_| "app state lock is unavailable".to_string())?;
    read_app_state_from_path(&app_state_path(app)?)
}

pub(crate) fn update_app_state<R: Runtime, T>(
    app: &tauri::AppHandle<R>,
    update: impl FnOnce(&mut VaultAppState) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = APP_STATE_LOCK
        .lock()
        .map_err(|_| "app state lock is unavailable".to_string())?;
    let path = app_state_path(app)?;
    let mut state = read_app_state_from_path(&path)?;
    let result = update(&mut state)?;
    write_app_state_to_path(&path, &state)?;
    Ok(result)
}

fn path_to_string(path: &Path, label: &str) -> Result<String, String> {
    path.to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{label} path contains non-utf8 characters"))
}

fn display_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(default_data_folder_name())
        .to_string()
}

fn is_development_build() -> bool {
    cfg!(debug_assertions)
}

fn default_data_folder_name() -> &'static str {
    if is_development_build() {
        DEVELOPMENT_DATA_FOLDER_NAME
    } else {
        PRODUCTION_DATA_FOLDER_NAME
    }
}

fn new_vault_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("vault-{:x}-{:x}", std::process::id(), nanos)
}

fn now_utc() -> DateTime<Utc> {
    std::time::SystemTime::now().into()
}

fn require_absolute_directory(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Ganbaru AI folder path must be absolute".to_string());
    }
    let metadata =
        fs::metadata(path).map_err(|e| format!("failed to inspect Ganbaru AI folder path: {e}"))?;
    if metadata.is_dir() {
        Ok(())
    } else {
        Err("Ganbaru AI path must be a folder".to_string())
    }
}

fn canonical_vault_path(path: PathBuf) -> Result<PathBuf, String> {
    require_absolute_directory(&path)?;
    fs::canonicalize(&path).map_err(|e| format!("canonicalize Ganbaru AI folder path: {e}"))
}

fn folder_is_empty(path: &Path) -> Result<bool, String> {
    let mut entries = fs::read_dir(path).map_err(|e| format!("read Ganbaru AI folder: {e}"))?;
    Ok(entries.next().is_none())
}

fn manifest_path(path: &Path) -> PathBuf {
    path.join(VAULT_MANIFEST_FILE)
}

fn config_path(path: &Path) -> PathBuf {
    path.join(CONFIG_FILE)
}

fn database_path(path: &Path) -> PathBuf {
    path.join(APP_SQLITE_FILE)
}

fn read_vault_manifest(path: &Path) -> Result<VaultManifest, String> {
    let manifest_path = manifest_path(path);
    let contents = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read Ganbaru AI folder marker: {e}"))?;
    let manifest: VaultManifest = serde_json::from_str(&contents)
        .map_err(|e| format!("parse Ganbaru AI folder marker: {e}"))?;
    if manifest.app != VAULT_APP_MARKER {
        return Err("selected folder is not a Ganbaru AI folder".to_string());
    }
    if manifest.schema_version != VAULT_SCHEMA_VERSION {
        return Err(format!(
            "unsupported Ganbaru AI folder schema version {}",
            manifest.schema_version
        ));
    }
    Ok(manifest)
}

fn vault_info_from_manifest(path: &Path, manifest: VaultManifest) -> Result<VaultInfo, String> {
    Ok(VaultInfo {
        path: path_to_string(path, "Ganbaru AI folder")?,
        config_path: path_to_string(&config_path(path), "config")?,
        database_path: path_to_string(&database_path(path), "database")?,
        vault_id: manifest.vault_id,
        display_name: if manifest.display_name.trim().is_empty() {
            display_name_from_path(path)
        } else {
            manifest.display_name
        },
    })
}

fn vault_info_from_path(path: &Path) -> Result<VaultInfo, String> {
    let path = canonical_vault_path(path.to_path_buf())?;
    vault_info_from_manifest(&path, read_vault_manifest(&path)?)
}

fn ensure_vault_skeleton(path: &Path) -> Result<(), String> {
    for relative in [
        "notes/daily",
        "notes/projects",
        "diary/morning",
        "diary/evening",
        "projects",
        "reports",
        "assets",
        "templates",
        ".yjs",
    ] {
        fs::create_dir_all(path.join(relative))
            .map_err(|e| format!("create Ganbaru AI folder path '{relative}': {e}"))?;
    }
    if !config_path(path).exists() {
        write_text_file_atomically(&config_path(path), "{}\n")?;
    }
    if !database_path(path).exists() {
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(database_path(path))
            .map_err(|e| format!("create ganbaru-ai.sqlite: {e}"))?;
    }
    Ok(())
}

fn initialize_vault(path: &Path) -> Result<VaultInfo, String> {
    let path = canonical_vault_path(path.to_path_buf())?;
    if manifest_path(&path).exists() {
        ensure_vault_skeleton(&path)?;
        return vault_info_from_path(&path);
    }
    if !folder_is_empty(&path)? {
        return Err("selected folder is not empty and is not a Ganbaru AI folder".to_string());
    }
    let manifest = VaultManifest {
        app: VAULT_APP_MARKER.to_string(),
        schema_version: VAULT_SCHEMA_VERSION,
        vault_id: new_vault_id(),
        display_name: display_name_from_path(&path),
        created_at: now_utc().to_rfc3339_opts(SecondsFormat::Millis, true),
    };
    ensure_vault_skeleton(&path)?;
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    write_text_file_atomically(&manifest_path(&path), &json)?;
    vault_info_from_manifest(&path, manifest)
}

fn select_vault<R: Runtime>(app: &tauri::AppHandle<R>, info: &VaultInfo) -> Result<(), String> {
    update_app_state(app, |state| {
        state.active_vault_path = Some(info.path.clone());
        state
            .recent_vault_paths
            .retain(|path| path != &info.path && !path.trim().is_empty());
        state.recent_vault_paths.insert(0, info.path.clone());
        state.recent_vault_paths.truncate(MAX_RECENT_VAULTS);
        Ok(())
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn pick_folder(
    app: &tauri::AppHandle,
    title: &str,
    start_directory: Option<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    let mut picker = app.dialog().file().set_title(title);
    if let Some(directory) = start_directory {
        picker = picker.set_directory(directory);
    }
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    picker.pick_folder(move |path| {
        let result = path.map(dialog_path).transpose();
        let _ = tx.try_send(result);
    });
    rx.recv()
        .await
        .ok_or_else(|| "folder picker closed without returning a result".to_string())?
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn existing_documents_directory(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().document_dir().ok().filter(|path| path.is_dir())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn default_data_parent(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .map_err(|e| format!("find Documents folder: {e}"))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn default_data_parent(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("find private application data folder: {e}"))
}

fn default_data_folder_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(default_data_parent(app)?.join(default_data_folder_name()))
}

fn default_location_from_path(path: PathBuf) -> Result<VaultDefaultLocation, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Ganbaru AI folder has no parent directory".to_string())?;
    Ok(VaultDefaultLocation {
        path: path_to_string(&path, "Ganbaru AI folder")?,
        parent_path: path_to_string(parent, "Ganbaru AI folder parent")?,
        folder_name: default_data_folder_name().to_string(),
        development_build: is_development_build(),
    })
}

fn create_and_select_vault(app: &tauri::AppHandle, path: &Path) -> Result<VaultInfo, String> {
    fs::create_dir_all(path).map_err(|e| format!("create Ganbaru AI folder: {e}"))?;
    let info = initialize_vault(path)?;
    select_vault(app, &info)?;
    Ok(info)
}

#[tauri::command]
pub fn vault_read_app_state(app: tauri::AppHandle) -> Result<VaultAppState, String> {
    read_app_state(&app)
}

#[tauri::command]
pub fn vault_default_location(app: tauri::AppHandle) -> Result<VaultDefaultLocation, String> {
    default_location_from_path(default_data_folder_path(&app)?)
}

#[tauri::command]
pub fn vault_use_default_folder(app: tauri::AppHandle) -> Result<VaultInfo, String> {
    let path = default_data_folder_path(&app)?;
    create_and_select_vault(&app, &path)
}

#[tauri::command]
pub fn vault_active_info(app: tauri::AppHandle) -> Result<Option<VaultInfo>, String> {
    let Some(path) = read_app_state(&app)?.active_vault_path else {
        return Ok(None);
    };
    vault_info_from_path(&PathBuf::from(path)).map(Some)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn vault_pick_create(app: tauri::AppHandle) -> Result<Option<VaultInfo>, String> {
    let Some(path) =
        pick_folder(&app, "Select a folder", existing_documents_directory(&app)).await?
    else {
        return Ok(None);
    };
    let info = create_and_select_vault(&app, &path)?;
    Ok(Some(info))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn vault_pick_open(app: tauri::AppHandle) -> Result<Option<VaultInfo>, String> {
    let Some(path) = pick_folder(
        &app,
        "Import Ganbaru AI folder",
        existing_documents_directory(&app),
    )
    .await?
    else {
        return Ok(None);
    };
    let info = vault_info_from_path(&path)?;
    ensure_vault_skeleton(&PathBuf::from(&info.path))?;
    select_vault(&app, &info)?;
    Ok(Some(info))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub fn vault_pick_open(app: tauri::AppHandle) -> Result<Option<VaultInfo>, String> {
    let target = default_data_folder_path(&app)?;
    let parent = target
        .parent()
        .ok_or_else(|| "Ganbaru AI folder has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("create app data directory: {error}"))?;
    let staging = parent.join(format!(".{}.import", default_data_folder_name()));
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|error| format!("remove stale folder import: {error}"))?;
    }
    if target.exists() {
        if !folder_is_empty(&target)? {
            return Err(
                "the private Ganbaru AI folder already exists; use it or remove its test data first"
                    .to_string(),
            );
        }
        fs::remove_dir(&target)
            .map_err(|error| format!("remove empty Ganbaru AI folder: {error}"))?;
    }

    let staging_path = path_to_string(&staging, "folder import staging")?;
    let selected = app.mobile_documents().pick_vault_tree_to_path(
        &staging_path,
        MOBILE_VAULT_IMPORT_MAX_FILES,
        MOBILE_VAULT_IMPORT_MAX_BYTES,
        MOBILE_VAULT_IMPORT_MAX_DEPTH,
    )?;
    if selected.is_none() {
        return Ok(None);
    }

    let result = (|| {
        let imported = vault_info_from_path(&staging)?;
        ensure_vault_skeleton(Path::new(&imported.path))?;
        fs::rename(&staging, &target)
            .map_err(|error| format!("activate imported Ganbaru AI folder: {error}"))?;
        let info = vault_info_from_path(&target)?;
        select_vault(&app, &info)?;
        Ok(Some(info))
    })();
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn vault_select_recent(app: tauri::AppHandle, path: String) -> Result<VaultInfo, String> {
    let state = read_app_state(&app)?;
    if !state
        .recent_vault_paths
        .iter()
        .any(|recent| recent == &path)
    {
        return Err("folder is not in the recent Ganbaru AI folder list".to_string());
    }
    let info = vault_info_from_path(&PathBuf::from(path))?;
    ensure_vault_skeleton(&PathBuf::from(&info.path))?;
    select_vault(&app, &info)?;
    Ok(info)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub fn vault_reveal_active(app: tauri::AppHandle) -> Result<(), String> {
    let path = active_vault_path(&app)?;
    reveal_vault_folder(&path)
}

pub fn active_vault_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let Some(path) = read_app_state(app)?.active_vault_path else {
        return Err("no active Ganbaru AI folder selected".to_string());
    };
    let path = canonical_vault_path(PathBuf::from(path))?;
    read_vault_manifest(&path)?;
    Ok(path)
}

pub(crate) struct WritableVaultPath {
    path: PathBuf,
    _permit: ownership::ManagedVaultWritePermit,
}

impl WritableVaultPath {
    pub(crate) fn join(mut self, path: impl AsRef<Path>) -> Self {
        self.path.push(path);
        self
    }
}

impl std::ops::Deref for WritableVaultPath {
    type Target = Path;

    fn deref(&self) -> &Self::Target {
        &self.path
    }
}

impl AsRef<Path> for WritableVaultPath {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

pub(crate) fn active_writable_vault_path<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<WritableVaultPath, String> {
    let path = active_vault_path(app)?;
    let vault_id = read_vault_manifest(&path)?.vault_id;
    let permit = app
        .state::<ownership::VaultOwnershipManager>()
        .acquire_managed_write(&vault_id)?;
    Ok(WritableVaultPath {
        path,
        _permit: permit,
    })
}

pub(crate) fn active_vault_id<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<String, String> {
    let path = active_vault_path(app)?;
    Ok(read_vault_manifest(&path)?.vault_id)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn active_database_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(database_path(&active_vault_path(app)?))
}

/// Read active Ganbaru AI folder `config.json` as a string. Returns `"{}"` if
/// the file is missing so the frontend can treat a reset config as defaults.
#[tauri::command]
pub fn vault_read_config(app: tauri::AppHandle) -> Result<String, String> {
    let _guard = CONFIG_LOCK
        .lock()
        .map_err(|_| "vault config lock is unavailable".to_string())?;
    let path = config_path(&active_vault_path(&app)?);
    if !path.exists() {
        return Ok("{}".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

pub(crate) fn mutate_active_vault_config<R: Runtime, T, E>(
    app: &tauri::AppHandle<R>,
    mutate: impl FnOnce(&mut serde_json::Value) -> Result<T, E>,
    map_storage_error: impl Fn(String) -> E,
) -> Result<T, E> {
    let writable_root = active_writable_vault_path(app).map_err(&map_storage_error)?;
    let _guard = CONFIG_LOCK
        .lock()
        .map_err(|_| map_storage_error("vault config lock is unavailable".to_string()))?;
    let path = config_path(&writable_root);
    let raw = if path.exists() {
        fs::read_to_string(&path).map_err(|error| map_storage_error(error.to_string()))?
    } else {
        "{}".to_string()
    };
    let mut root = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| map_storage_error(format!("config payload is not valid JSON: {error}")))?;
    if !root.is_object() {
        return Err(map_storage_error(
            "config payload root must be an object".to_string(),
        ));
    }
    let result = mutate(&mut root)?;
    crate::chat::config::parse_chat_config_branch(&root)
        .map_err(|error| map_storage_error(format!("config Chat branch is invalid: {error}")))?;
    let serialized = serde_json::to_string_pretty(&root)
        .map_err(|error| map_storage_error(error.to_string()))?;
    write_text_file_atomically(&path, &serialized).map_err(map_storage_error)?;
    Ok(result)
}

fn validate_config_patch_path(path: &[String]) -> Result<(), String> {
    let total_bytes = path.iter().map(String::len).sum::<usize>();
    if path.is_empty()
        || path.len() > MAX_CONFIG_PATCH_DEPTH
        || total_bytes > MAX_CONFIG_PATCH_PATH_BYTES
        || path.iter().any(|segment| {
            segment.is_empty()
                || segment.len() > MAX_CONFIG_PATCH_SEGMENT_BYTES
                || matches!(segment.as_str(), "__proto__" | "prototype" | "constructor")
        })
    {
        return Err("vault config patch path is invalid".to_string());
    }
    Ok(())
}

fn apply_config_patch(root: &mut serde_json::Value, patch: VaultConfigPatch) -> Result<(), String> {
    validate_config_patch_path(&patch.path)?;
    let mut current = root
        .as_object_mut()
        .ok_or_else(|| "config payload root must be an object".to_string())?;
    let (leaf, parents) = patch
        .path
        .split_last()
        .ok_or_else(|| "vault config patch path is invalid".to_string())?;
    for segment in parents {
        let next = current
            .entry(segment.clone())
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
        if !next.is_object() {
            *next = serde_json::Value::Object(serde_json::Map::new());
        }
        current = next
            .as_object_mut()
            .ok_or_else(|| "vault config patch target is invalid".to_string())?;
    }
    if patch.remove {
        current.remove(leaf);
    } else {
        current.insert(leaf.clone(), patch.value);
    }
    Ok(())
}

/// Applies bounded key-level mutations without replacing unrelated config
/// branches that another feature may have updated since the frontend loaded.
#[tauri::command]
pub fn vault_patch_config(
    app: tauri::AppHandle,
    patches: Vec<VaultConfigPatch>,
) -> Result<(), String> {
    if patches.is_empty() {
        return Ok(());
    }
    if patches.len() > MAX_CONFIG_PATCH_COUNT
        || serde_json::to_vec(&patches)
            .map_err(|error| error.to_string())?
            .len()
            > MAX_CONFIG_PATCH_BATCH_BYTES
    {
        return Err("vault config patch batch is too large".to_string());
    }
    mutate_active_vault_config(
        &app,
        |root| {
            for patch in patches {
                apply_config_patch(root, patch)?;
            }
            Ok(())
        },
        |error| error,
    )
}

fn require_absolute_path(path: &Path) -> Result<(), String> {
    if path.is_absolute() {
        Ok(())
    } else {
        Err("path must be absolute".to_string())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn require_extension(path: &Path, allowed: &[&str], label: &str) -> Result<(), String> {
    require_absolute_path(path)?;
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if allowed
        .iter()
        .any(|allowed_ext| ext.eq_ignore_ascii_case(allowed_ext))
    {
        Ok(())
    } else {
        Err(format!(
            "{label} file must use one of: {}",
            allowed.join(", ")
        ))
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn dialog_path(path: FilePath) -> Result<PathBuf, String> {
    path.into_path()
        .map_err(|e| format!("selected path is not a local file: {e}"))
}

fn default_file_name(input: &str, fallback_stem: &str, extension: &str) -> String {
    let trimmed = input.trim();
    let from_input = Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback_stem);
    if Path::new(from_input)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
    {
        from_input.to_string()
    } else {
        format!("{from_input}.{extension}")
    }
}

#[cfg(not(target_os = "android"))]
fn read_utf8_capped(reader: &mut impl Read, max_bytes: u64, label: &str) -> Result<String, String> {
    let mut contents = String::new();
    let mut limited = reader.take(max_bytes + 1);
    limited
        .read_to_string(&mut contents)
        .map_err(|e| format!("failed to read {label} as UTF-8: {e}"))?;
    if contents.len() as u64 > max_bytes {
        return Err(format!("{label} exceeds the limit of {max_bytes} bytes"));
    }
    Ok(contents)
}

fn require_text_within_limit(contents: &str, max_bytes: u64, label: &str) -> Result<(), String> {
    let byte_count = contents.len() as u64;
    if byte_count > max_bytes {
        return Err(format!(
            "{label} is {byte_count} bytes, exceeding the limit of {max_bytes} bytes"
        ));
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn read_text_file_capped(path: &Path, max_bytes: u64, label: &str) -> Result<String, String> {
    require_absolute_path(path)?;
    let metadata = fs::metadata(path).map_err(|e| format!("failed to inspect {label}: {e}"))?;
    if metadata.len() > max_bytes {
        return Err(format!(
            "{label} is {} bytes, exceeding the limit of {max_bytes} bytes",
            metadata.len()
        ));
    }

    let mut file = fs::File::open(path).map_err(|e| format!("failed to open {label}: {e}"))?;
    read_utf8_capped(&mut file, max_bytes, label)
}

/// Write a UTF-8 text file atomically via `.tmp` plus rename so an
/// interrupted write cannot leave the target file truncated.
fn write_text_file_atomically(path: &Path, contents: &str) -> Result<(), String> {
    require_absolute_path(path)?;
    let target = path;
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
    fs::rename(&tmp_path, target).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn pick_open_path(
    app: &tauri::AppHandle,
    title: &str,
    filter_name: &str,
    extensions: &[&str],
    start_directory: Option<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    let mut picker = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter(filter_name, extensions);
    if let Some(directory) = start_directory {
        picker = picker.set_directory(directory);
    }
    picker.blocking_pick_file().map(dialog_path).transpose()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn pick_save_path(
    app: &tauri::AppHandle,
    title: &str,
    default_name: &str,
    filter_name: &str,
    extensions: &[&str],
    start_directory: Option<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    let mut picker = app
        .dialog()
        .file()
        .set_title(title)
        .set_file_name(default_name)
        .add_filter(filter_name, extensions);
    if let Some(directory) = start_directory {
        picker = picker.set_directory(directory);
    }
    picker.blocking_save_file().map(dialog_path).transpose()
}

#[cfg(target_os = "linux")]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reveal_vault_folder(path: &Path) -> Result<(), String> {
    spawn_file_manager_command("xdg-open", [path.as_os_str()])
}

#[cfg(target_os = "macos")]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reveal_vault_folder(path: &Path) -> Result<(), String> {
    spawn_file_manager_command("open", [path.as_os_str()])
}

#[cfg(windows)]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reveal_vault_folder(path: &Path) -> Result<(), String> {
    spawn_file_manager_command("explorer.exe", [path.as_os_str()])
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn reveal_vault_folder(_path: &Path) -> Result<(), String> {
    Err("opening Ganbaru AI folders is not implemented for this platform".to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn spawn_file_manager_command<I, S>(program: &str, args: I) -> Result<(), String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    std::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open Ganbaru AI folder: {e}"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn existing_downloads_directory(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().download_dir().ok().filter(|path| path.is_dir())
}

/// Hard cap on the number of entries we will inspect inside a single zip.
/// 1024 is well above the realistic count for an export from Google
/// Calendar (one .ics per calendar a user owns or subscribes to is usually
/// < 50) and protects against pathological inputs that could DoS the read
/// loop.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const ICS_ZIP_MAX_ENTRIES: usize = 1024;

/// Hard cap on the uncompressed size of a single entry, in bytes. 25 MiB
/// is large enough for a multi-decade calendar with thousands of events
/// (text-only iCalendar averages ~1 KiB per event) while clearly rejecting
/// decompression bombs.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const ICS_ZIP_MAX_ENTRY_BYTES: u64 = 25 * 1024 * 1024;

/// Hard cap on the aggregate uncompressed size across every entry. Keeps a
/// zip with many oversized entries from defeating the per-entry guard.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const ICS_ZIP_MAX_TOTAL_BYTES: u64 = 250 * 1024 * 1024;

/// Plain `.ics` imports share the zip per-entry cap so the import flow has
/// one clear maximum payload size regardless of container.
const ICS_PLAIN_MAX_BYTES: u64 = 25 * 1024 * 1024;

/// Theme JSON is small configuration data. One MiB leaves room for custom
/// comments and future tokens while rejecting accidental large-file picks.
const THEME_JSON_MAX_BYTES: u64 = 1024 * 1024;

#[cfg(target_os = "ios")]
const THEME_JSON_DOCUMENT_FILTERS: &[&str] = &["json"];

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeJsonWriteOutcome {
    saved: bool,
    destination: Option<&'static str>,
    file_name: Option<String>,
}

impl ThemeJsonWriteOutcome {
    #[cfg(not(target_os = "android"))]
    fn cancelled() -> Self {
        Self {
            saved: false,
            destination: None,
            file_name: None,
        }
    }

    #[cfg(not(target_os = "android"))]
    fn saved_to_selected_file() -> Self {
        Self {
            saved: true,
            destination: None,
            file_name: None,
        }
    }

    #[cfg(target_os = "android")]
    fn saved_to_downloads(file_name: String) -> Self {
        Self {
            saved: true,
            destination: Some("downloads"),
            file_name: Some(file_name),
        }
    }
}

#[derive(Debug, serde::Serialize)]
pub struct IcsZipEntry {
    /// File-name-only basename (no directory components) so an entry path
    /// like `personal/work.ics` is exposed as `work.ics` to the frontend.
    pub name: String,
    /// UTF-8-decoded entry contents. RFC 5545 mandates UTF-8, so a decode
    /// failure is reported as an error rather than silently lossy-replaced.
    pub contents: String,
}

/// Read every `.ics` entry inside the zip at `path` and return their decoded
/// contents. Used by the calendar import flow so a Google or Apple export
/// (which always arrives as a `.ics.zip` bundle) can be imported in one
/// step instead of forcing the user to unzip first.
///
/// Safety contract:
///
/// - Path must be absolute (matching every other `vault_*` helper).
/// - Entry paths are validated through `enclosed_name`, which rejects any
///   entry that tries to escape (zip-slip via `..` or absolute paths).
/// - Encrypted entries are refused; we only ship the deflate feature.
/// - Per-entry and aggregate decompressed-size caps reject decompression
///   bombs even if the zip header lies about uncompressed size (the read
///   itself is wrapped in a `Take` adapter so the cap holds at I/O level).
/// - Only entries whose extension matches `.ics` are returned. Anything
///   else (`__MACOSX/`, `.DS_Store`, signature files, archived metadata)
///   is silently skipped so the importer never sees them.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn read_ics_zip_entries_from_path(path: &Path) -> Result<Vec<IcsZipEntry>, String> {
    require_extension(path, &["zip"], "ICS zip import")?;

    let file = fs::File::open(path).map_err(|e| format!("failed to open zip: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("not a valid zip archive: {e}"))?;

    if archive.len() > ICS_ZIP_MAX_ENTRIES {
        return Err(format!(
            "zip has {} entries, exceeding the limit of {ICS_ZIP_MAX_ENTRIES}",
            archive.len()
        ));
    }

    let mut entries: Vec<IcsZipEntry> = Vec::new();
    let mut total_uncompressed: u64 = 0;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("failed to read zip entry {i}: {e}"))?;

        if entry.is_dir() {
            continue;
        }

        // `enclosed_name` returns `None` for any entry whose path escapes
        // the archive root (zip-slip protection). Treat that as fatal so we
        // never silently import from a tampered bundle.
        let enclosed = match entry.enclosed_name() {
            Some(name) => name,
            None => {
                return Err("zip contains an entry with an unsafe path".to_string());
            }
        };

        let ext_is_ics = enclosed
            .extension()
            .map(|e| e.eq_ignore_ascii_case("ics"))
            .unwrap_or(false);
        if !ext_is_ics {
            continue;
        }

        if entry.encrypted() {
            return Err(format!(
                "zip entry '{}' is encrypted; encrypted .ics imports are not supported",
                enclosed.display()
            ));
        }

        let reported_size = entry.size();
        if reported_size > ICS_ZIP_MAX_ENTRY_BYTES {
            return Err(format!(
                "zip entry '{}' uncompressed size ({reported_size} bytes) exceeds the per-entry limit of {ICS_ZIP_MAX_ENTRY_BYTES} bytes",
                enclosed.display()
            ));
        }
        total_uncompressed = total_uncompressed.saturating_add(reported_size);
        if total_uncompressed > ICS_ZIP_MAX_TOTAL_BYTES {
            return Err(format!(
                "zip total uncompressed size exceeds the limit of {ICS_ZIP_MAX_TOTAL_BYTES} bytes"
            ));
        }

        let display_name = enclosed
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| format!("entry-{i}.ics"));

        // Capture only the basename for the frontend before borrowing the
        // entry mutably for the read.
        drop(enclosed);

        // The `Take` adapter is the real defense against a lying header:
        // even if `entry.size()` claims a small value, we still stop after
        // one byte past the cap and reject the entry.
        let mut contents = String::new();
        let mut limited = entry.by_ref().take(ICS_ZIP_MAX_ENTRY_BYTES + 1);
        limited
            .read_to_string(&mut contents)
            .map_err(|e| format!("failed to read zip entry '{display_name}' as UTF-8: {e}"))?;
        if contents.len() as u64 > ICS_ZIP_MAX_ENTRY_BYTES {
            return Err(format!(
                "zip entry '{display_name}' exceeds the per-entry size limit during decompression"
            ));
        }

        entries.push(IcsZipEntry {
            name: display_name,
            contents,
        });
    }

    Ok(entries)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn read_plain_ics_entry_from_path(path: &Path) -> Result<IcsZipEntry, String> {
    require_extension(path, &["ics"], "ICS import")?;
    let contents = read_text_file_capped(path, ICS_PLAIN_MAX_BYTES, "ICS import")?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "calendar.ics".to_string());
    Ok(IcsZipEntry { name, contents })
}

/// Open a native file picker and read one `.ics` file or every `.ics` entry
/// inside one `.zip` bundle. The selected path never crosses the IPC
/// boundary, and Rust re-validates the extension before reading.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn vault_pick_and_read_ics_import(
    app: tauri::AppHandle,
) -> Result<Option<Vec<IcsZipEntry>>, String> {
    let Some(path) = pick_open_path(
        &app,
        "Import calendar",
        "iCalendar (.ics or .zip)",
        &["ics", "zip"],
        existing_downloads_directory(&app),
    )?
    else {
        return Ok(None);
    };

    require_extension(&path, &["ics", "zip"], "ICS import")?;
    let is_zip = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"));
    if is_zip {
        read_ics_zip_entries_from_path(&path).map(Some)
    } else {
        read_plain_ics_entry_from_path(&path).map(|entry| Some(vec![entry]))
    }
}

/// Open a native save dialog and write a calendar `.ics` export. The
/// selected path stays in Rust and must still have a `.ics` extension.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn vault_pick_and_write_ics_export(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
) -> Result<bool, String> {
    let default_name = default_file_name(&default_name, "calendar", "ics");
    let Some(path) = pick_save_path(
        &app,
        "Export calendar",
        &default_name,
        "iCalendar",
        &["ics"],
        None,
    )?
    else {
        return Ok(false);
    };
    require_extension(&path, &["ics"], "ICS export")?;
    write_text_file_atomically(&path, &contents)?;
    Ok(true)
}

/// Ask Android to select and read one bounded iCalendar document.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn vault_pick_and_read_ics_import(
    app: tauri::AppHandle,
) -> Result<Option<Vec<IcsZipEntry>>, String> {
    app.mobile_documents()
        .pick_utf8_document_matching(
            ICS_PLAIN_MAX_BYTES,
            &["ics"],
            &["text/calendar", "application/ics", "text/plain"],
            "calendar",
        )
        .map(|selected| {
            selected.map(|contents| {
                vec![IcsZipEntry {
                    name: "calendar.ics".to_string(),
                    contents,
                }]
            })
        })
}

/// Save an iCalendar export to Android's public Downloads collection.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn vault_pick_and_write_ics_export(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
) -> Result<bool, String> {
    let default_name = default_file_name(&default_name, "calendar", "ics");
    app.mobile_documents().save_utf8_download_with_type(
        &default_name,
        &contents,
        ICS_PLAIN_MAX_BYTES,
        &["ics"],
        "text/calendar",
        "calendar",
    )?;
    Ok(true)
}

#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn vault_pick_and_read_ics_import(
    _app: tauri::AppHandle,
) -> Result<Option<Vec<IcsZipEntry>>, String> {
    Err("calendar document import is not available on iOS yet".to_string())
}

#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn vault_pick_and_write_ics_export(
    _app: tauri::AppHandle,
    _default_name: String,
    _contents: String,
) -> Result<bool, String> {
    Err("calendar document export is not available on iOS yet".to_string())
}

/// Open a native file picker and read a theme `.json` file with a small cap.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn vault_pick_and_read_theme_json(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    let Some(path) = pick_open_path(&app, "Import theme", "Theme JSON", &["json"], None)? else {
        return Ok(None);
    };
    require_extension(&path, &["json"], "theme import")?;
    read_text_file_capped(&path, THEME_JSON_MAX_BYTES, "theme import").map(Some)
}

/// Open a native save dialog and write a theme `.json` export.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn vault_pick_and_write_theme_json(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
) -> Result<ThemeJsonWriteOutcome, String> {
    require_text_within_limit(&contents, THEME_JSON_MAX_BYTES, "theme export")?;
    let default_name = default_file_name(&default_name, "theme", "json");
    let Some(path) = pick_save_path(
        &app,
        "Export theme",
        &default_name,
        "Theme JSON",
        &["json"],
        existing_downloads_directory(&app),
    )?
    else {
        return Ok(ThemeJsonWriteOutcome::cancelled());
    };
    require_extension(&path, &["json"], "theme export")?;
    write_text_file_atomically(&path, &contents)?;
    Ok(ThemeJsonWriteOutcome::saved_to_selected_file())
}

#[cfg(target_os = "ios")]
fn finish_mobile_document_access<R: Runtime, T>(
    app: &tauri::AppHandle<R>,
    path: FilePath,
    result: Result<T, String>,
) -> Result<T, String> {
    let cleanup = app
        .fs()
        .stop_accessing_security_scoped_resource(path)
        .map_err(|e| format!("release selected theme document: {e}"));
    match result {
        Err(error) => Err(error),
        Ok(value) => cleanup.map(|()| value),
    }
}

#[cfg(target_os = "ios")]
fn read_mobile_theme_document<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: FilePath,
) -> Result<String, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    let result = (|| {
        let mut file = app
            .fs()
            .open(path.clone(), options)
            .map_err(|e| format!("failed to open theme import: {e}"))?;
        read_utf8_capped(&mut file, THEME_JSON_MAX_BYTES, "theme import")
    })();
    finish_mobile_document_access(app, path, result)
}

#[cfg(target_os = "ios")]
fn write_mobile_theme_document<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: FilePath,
    contents: &str,
) -> Result<(), String> {
    require_text_within_limit(contents, THEME_JSON_MAX_BYTES, "theme export")?;
    let mut options = OpenOptions::new();
    options.write(true).truncate(true);
    let result = (|| {
        let mut file = app
            .fs()
            .open(path.clone(), options)
            .map_err(|e| format!("failed to open theme export: {e}"))?;
        file.write_all(contents.as_bytes())
            .map_err(|e| format!("failed to write theme export: {e}"))?;
        file.flush()
            .map_err(|e| format!("failed to flush theme export: {e}"))?;
        Ok(())
    })();
    finish_mobile_document_access(app, path, result)
}

/// Open iOS document storage and read one bounded theme JSON file.
#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn vault_pick_and_read_theme_json(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter("Theme JSON", THEME_JSON_DOCUMENT_FILTERS)
        .blocking_pick_file();
    selected
        .map(|path| read_mobile_theme_document(&app, path))
        .transpose()
}

/// Create a theme JSON document through iOS document storage.
#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn vault_pick_and_write_theme_json(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
) -> Result<ThemeJsonWriteOutcome, String> {
    require_text_within_limit(&contents, THEME_JSON_MAX_BYTES, "theme export")?;
    let default_name = default_file_name(&default_name, "theme", "json");
    let selected = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter("Theme JSON", THEME_JSON_DOCUMENT_FILTERS)
        .blocking_save_file();
    let Some(path) = selected else {
        return Ok(ThemeJsonWriteOutcome::cancelled());
    };
    write_mobile_theme_document(&app, path, &contents)?;
    Ok(ThemeJsonWriteOutcome::saved_to_selected_file())
}

/// Ask Android to select and read one bounded UTF-8 theme document.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn vault_pick_and_read_theme_json(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    app.mobile_documents()
        .pick_utf8_document(THEME_JSON_MAX_BYTES)
}

/// Save a theme JSON export to Android's public Downloads collection.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn vault_pick_and_write_theme_json(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
) -> Result<ThemeJsonWriteOutcome, String> {
    require_text_within_limit(&contents, THEME_JSON_MAX_BYTES, "theme export")?;
    let default_name = default_file_name(&default_name, "theme", "json");
    let file_name = app.mobile_documents().save_utf8_download(
        &default_name,
        &contents,
        THEME_JSON_MAX_BYTES,
    )?;
    Ok(ThemeJsonWriteOutcome::saved_to_downloads(file_name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn unique_path(suffix: &str) -> PathBuf {
        // Avoid pulling in `tempfile` for two tests: hand-roll a unique path
        // under the system temp dir, salted with pid + time + a per-call seq
        // so parallel runs do not collide.
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let pid = std::process::id();
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let mut path = std::env::temp_dir();
        path.push(format!(
            "ganbaru-ai-vault-test-{pid}-{nanos}-{seq}-{suffix}"
        ));
        path
    }

    #[test]
    fn read_text_file_capped_rejects_relative_paths() {
        let err = read_text_file_capped(Path::new("relative/path.txt"), 1024, "test").unwrap_err();
        assert_eq!(err, "path must be absolute");
    }

    #[test]
    fn write_text_file_atomically_rejects_relative_paths() {
        let err = write_text_file_atomically(Path::new("relative/path.txt"), "data").unwrap_err();
        assert_eq!(err, "path must be absolute");
    }

    #[test]
    fn read_text_file_capped_returns_file_contents_for_absolute_path() {
        let path = unique_path("read.txt");
        fs::write(&path, "hello vault").expect("seed file");
        let result = read_text_file_capped(&path, 1024, "test");
        let _ = fs::remove_file(&path);
        assert_eq!(result.unwrap(), "hello vault");
    }

    #[test]
    fn read_utf8_capped_enforces_the_limit_while_streaming() {
        let mut reader = std::io::Cursor::new(b"12345");
        let error = read_utf8_capped(&mut reader, 4, "theme import").unwrap_err();
        assert_eq!(error, "theme import exceeds the limit of 4 bytes");
    }

    #[test]
    fn theme_export_rejects_oversized_text_before_opening_a_document() {
        let contents = "x".repeat((THEME_JSON_MAX_BYTES + 1) as usize);
        let error =
            require_text_within_limit(&contents, THEME_JSON_MAX_BYTES, "theme export").unwrap_err();
        assert!(error.contains("exceeding the limit"));
    }

    #[test]
    fn default_file_name_drops_path_components_and_preserves_json_extension() {
        assert_eq!(
            default_file_name("../../midnight", "theme", "json"),
            "midnight.json"
        );
        assert_eq!(
            default_file_name("midnight.JSON", "theme", "json"),
            "midnight.JSON"
        );
    }

    #[test]
    fn write_text_file_atomically_writes_atomically_to_absolute_path() {
        let path = unique_path("write.txt");
        let parent = path.parent().unwrap().to_path_buf();
        let file_name = path.file_name().unwrap().to_string_lossy().into_owned();
        let tmp_sibling = parent.join(format!("{file_name}.tmp"));

        write_text_file_atomically(&path, "payload").expect("write should succeed");

        let on_disk = fs::read_to_string(&path).expect("file should exist");
        assert_eq!(on_disk, "payload");
        // The .tmp sibling must not survive a successful write.
        assert!(
            !tmp_sibling.exists(),
            "tmp file should have been renamed away"
        );

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn config_patches_preserve_unrelated_branches() {
        let chat = serde_json::json!({
            "schemaVersion": 1,
            "providers": [{ "instanceId": "codex" }]
        });
        let mut root = serde_json::json!({
            "chat": chat.clone(),
            "theme": { "activeId": "light" }
        });

        apply_config_patch(
            &mut root,
            VaultConfigPatch {
                path: vec!["theme".to_string(), "activeId".to_string()],
                remove: false,
                value: serde_json::json!("dark"),
            },
        )
        .unwrap();

        assert_eq!(root["chat"], chat);
        assert_eq!(root["theme"]["activeId"], "dark");
    }

    #[test]
    fn config_patches_reject_prototype_paths() {
        let mut root = serde_json::json!({});
        let error = apply_config_patch(
            &mut root,
            VaultConfigPatch {
                path: vec!["__proto__".to_string(), "polluted".to_string()],
                remove: false,
                value: serde_json::json!(true),
            },
        )
        .unwrap_err();

        assert_eq!(error, "vault config patch path is invalid");
        assert_eq!(root, serde_json::json!({}));
    }

    #[test]
    fn initialize_vault_creates_manifest_config_database_and_dirs() {
        let path = unique_path("portable-vault");
        fs::create_dir_all(&path).expect("create vault folder");

        let info = initialize_vault(&path).expect("initialize vault");

        assert_eq!(
            info.database_path,
            path.join(APP_SQLITE_FILE).to_string_lossy()
        );
        assert!(path.join(VAULT_MANIFEST_FILE).exists());
        assert!(path.join(CONFIG_FILE).exists());
        assert!(path.join(APP_SQLITE_FILE).exists());
        assert!(path.join("notes").join("daily").is_dir());
        assert!(path.join("diary").join("morning").is_dir());
        assert!(path.join(".yjs").is_dir());

        let _ = fs::remove_dir_all(&path);
    }

    #[test]
    fn initialize_vault_rejects_non_empty_non_vault_folders() {
        let path = unique_path("non-empty");
        fs::create_dir_all(&path).expect("create vault folder");
        fs::write(path.join("random.txt"), "existing file").expect("seed file");

        let err = initialize_vault(&path).unwrap_err();

        assert_eq!(
            err,
            "selected folder is not empty and is not a Ganbaru AI folder"
        );
        let _ = fs::remove_dir_all(&path);
    }

    #[test]
    fn default_data_folder_name_tracks_build_mode() {
        if cfg!(debug_assertions) {
            assert_eq!(default_data_folder_name(), DEVELOPMENT_DATA_FOLDER_NAME);
        } else {
            assert_eq!(default_data_folder_name(), PRODUCTION_DATA_FOLDER_NAME);
        }
    }

    #[test]
    fn app_state_round_trips_active_and_recent_vault_paths() {
        let path = unique_path("app-state.json");
        let mut music_root_bindings = BTreeMap::new();
        music_root_bindings.insert(
            "vault-1".to_string(),
            BTreeMap::from([(
                "soundtracks".to_string(),
                "/mnt/music/soundtracks".to_string(),
            )]),
        );
        let state = VaultAppState {
            device_id: Some("device-test".to_string()),
            active_vault_path: Some("/tmp/ganbaru-ai-vault".to_string()),
            recent_vault_paths: vec!["/tmp/ganbaru-ai-vault".to_string()],
            music_root_bindings,
            project_working_folders: Default::default(),
            chat: Default::default(),
        };

        write_app_state_to_path(&path, &state).expect("write app state");
        let saved = read_app_state_from_path(&path).expect("read app state");

        assert_eq!(saved.active_vault_path, state.active_vault_path);
        assert_eq!(saved.device_id, state.device_id);
        assert_eq!(saved.recent_vault_paths, state.recent_vault_paths);
        assert_eq!(saved.music_root_bindings, state.music_root_bindings);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn app_state_rejects_missing_current_device_state_sections() {
        let path = unique_path("incomplete-app-state.json");
        fs::write(
            &path,
            r#"{"activeVaultPath":"/tmp/vault","recentVaultPaths":[]}"#,
        )
        .expect("write incomplete state");

        let state = read_app_state_from_path(&path);

        assert!(state.is_err());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn app_state_requires_current_nullable_fields() {
        let current = serde_json::to_value(VaultAppState::default()).expect("serialize app state");
        assert!(serde_json::from_value::<VaultAppState>(current.clone()).is_ok());

        for field in ["deviceId", "activeVaultPath"] {
            let mut incomplete = current.clone();
            incomplete.as_object_mut().unwrap().remove(field);

            assert!(
                serde_json::from_value::<VaultAppState>(incomplete).is_err(),
                "missing {field} must be rejected"
            );
        }
    }

    #[test]
    fn provider_probe_requires_current_authority_support_fields() {
        let path = unique_path("incomplete-provider-probe-app-state.json");
        fs::write(
            &path,
            r#"{
  "deviceId": "device-test",
  "activeVaultPath": null,
  "recentVaultPaths": [],
  "musicRootBindings": {},
  "projectWorkingFolders": { "schemaVersion": 1, "vaults": {} },
  "chat": {
    "schemaVersion": 1,
    "vaults": {
      "vault-test": {
        "device-test": {
          "providerInstances": {
            "codex": {
              "executablePath": null,
              "providerHomePath": null,
              "lastProbe": {
                "instanceId": "codex",
                "state": "healthy",
                "version": "1.0.0",
                "negotiatedProtocolVersion": null,
                "accountLabel": null,
                "capabilities": { "entries": [] },
                "authoritySupport": {
                  "internalHostTools": true,
                  "denyShell": true,
                  "readOnlyRoot": true,
                  "writableRoot": true,
                  "confinedCommands": true,
                  "networkBoundary": true,
                  "classifiedPublish": true
                },
                "checkedAt": "2026-08-22T00:00:00Z",
                "detail": null
              },
              "lastSuccessfulProbeAt": null,
              "modelCatalog": null
            }
          },
          "fullAccessTrust": {},
          "preferences": {
            "restoreLastSelectedThread": false,
            "lastSelectedThreadId": null
          },
          "diagnostics": { "captureEnabled": false, "retentionDays": 7 },
          "executionEnvironmentPaths": {}
        }
      }
    }
  }
}"#,
        )
        .expect("write incomplete provider probe state");

        let state = read_app_state_from_path(&path);

        assert!(state.is_err());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn read_plain_ics_entry_rejects_wrong_extensions() {
        let path = unique_path("calendar.txt");
        fs::write(&path, "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n").expect("seed file");
        let result = read_plain_ics_entry_from_path(&path);
        let _ = fs::remove_file(&path);
        let err = result.unwrap_err();
        assert!(
            err.contains("ICS import file must use one of: ics"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn read_plain_ics_entry_rejects_oversized_files() {
        let path = unique_path("oversized.ics");
        let file = fs::File::create(&path).expect("create file");
        file.set_len(ICS_PLAIN_MAX_BYTES + 1)
            .expect("set oversized length");
        let result = read_plain_ics_entry_from_path(&path);
        let _ = fs::remove_file(&path);
        let err = result.unwrap_err();
        assert!(
            err.contains("exceeding the limit"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn read_theme_json_rejects_oversized_files() {
        let path = unique_path("oversized.json");
        let file = fs::File::create(&path).expect("create file");
        file.set_len(THEME_JSON_MAX_BYTES + 1)
            .expect("set oversized length");
        let result = read_text_file_capped(&path, THEME_JSON_MAX_BYTES, "theme import");
        let _ = fs::remove_file(&path);
        let err = result.unwrap_err();
        assert!(
            err.contains("exceeding the limit"),
            "unexpected error: {err}"
        );
    }

    /// Build a zip file at `path` containing the given `(name, contents)`
    /// pairs. Uses the Stored compression method so the test does not depend
    /// on the deflate path being exercised correctly.
    fn write_zip(path: &PathBuf, entries: &[(&str, &[u8])]) {
        use zip::write::SimpleFileOptions;
        use zip::write::ZipWriter;
        use zip::CompressionMethod;

        let file = fs::File::create(path).expect("create zip file");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, data) in entries {
            writer.start_file(*name, options).expect("start_file");
            writer.write_all(data).expect("write entry");
        }
        writer.finish().expect("finish zip");
    }

    #[test]
    fn read_ics_zip_entries_rejects_relative_paths() {
        let err = read_ics_zip_entries_from_path(Path::new("relative/path.zip")).unwrap_err();
        assert_eq!(err, "path must be absolute");
    }

    #[test]
    fn read_ics_zip_entries_rejects_wrong_extensions() {
        let path = unique_path("archive.txt");
        fs::write(&path, b"this is not a zip archive").expect("seed file");
        let result = read_ics_zip_entries_from_path(&path);
        let _ = fs::remove_file(&path);
        let err = result.unwrap_err();
        assert!(
            err.contains("ICS zip import file must use one of: zip"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn read_ics_zip_entries_rejects_non_zip_files() {
        let path = unique_path("not-a-zip.zip");
        fs::write(&path, b"this is not a zip archive").expect("seed file");
        let result = read_ics_zip_entries_from_path(&path);
        let _ = fs::remove_file(&path);
        let err = result.unwrap_err();
        assert!(
            err.starts_with("not a valid zip archive"),
            "expected not-a-zip error, got: {err}"
        );
    }

    #[test]
    fn read_ics_zip_entries_returns_only_ics_entries() {
        let path = unique_path("mixed.zip");
        let ics_a = b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
        let ics_b = b"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
        write_zip(
            &path,
            &[
                ("calendar.ics", ics_a),
                ("readme.txt", b"ignore me"),
                ("nested/holidays.ICS", ics_b),
                ("__MACOSX/.DS_Store", b"junk"),
            ],
        );

        let result = read_ics_zip_entries_from_path(&path);
        let _ = fs::remove_file(&path);
        let entries = result.expect("should succeed");
        assert_eq!(entries.len(), 2, "should keep only the .ics entries");

        // Names are basenames, not full archive paths.
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"calendar.ics"), "got names: {names:?}");
        assert!(names.contains(&"holidays.ICS"), "got names: {names:?}");

        let calendar = entries.iter().find(|e| e.name == "calendar.ics").unwrap();
        assert_eq!(calendar.contents.as_bytes(), ics_a);
    }

    #[test]
    fn read_ics_zip_entries_returns_empty_when_no_ics_present() {
        let path = unique_path("no-ics.zip");
        write_zip(&path, &[("readme.txt", b"hello"), ("notes.md", b"# title")]);
        let result = read_ics_zip_entries_from_path(&path);
        let _ = fs::remove_file(&path);
        assert!(result.unwrap().is_empty());
    }
}
