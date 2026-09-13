use crate::{db_path::connect_sqlite, vault};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::path::PathBuf;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Manager;
use tauri::{AppHandle, Runtime};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_dialog::{DialogExt, FilePath};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use ganbaru_notes::notes::file_assets::NotesFileAssetDto;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use ganbaru_notes::notes::file_assets::{
    NotesImportFileReferenceDto, NotesImportFileReferenceRequest,
};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn notes_pick_file_asset<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    block_type: String,
) -> Result<Option<NotesFileAssetDto>, String> {
    let mut picker = app.dialog().file().set_title("Attach local file");
    if let Some((filter_name, extensions)) =
        ganbaru_notes::notes::file_assets::picker_extensions_for_block_type(&block_type)?
    {
        picker = picker.add_filter(filter_name, extensions);
    }
    if let Some(directory) = app.path().document_dir().ok().filter(|path| path.is_dir()) {
        picker = picker.set_directory(directory);
    }
    let Some(path) = picker.blocking_pick_file().map(dialog_path).transpose()? else {
        return Ok(None);
    };
    let pool = connect_sqlite(app.clone(), db_url).await?;
    let vault_root = vault::active_writable_vault_path(&app)?;
    ganbaru_notes::notes::file_assets::save_selected_file(&pool, &vault_root, block_type, &path)
        .await
        .map(Some)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn notes_prepare_import_file_reference<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    request: NotesImportFileReferenceRequest,
) -> Result<NotesImportFileReferenceDto, String> {
    let pool = connect_sqlite(app.clone(), db_url).await?;
    let vault_root = vault::active_writable_vault_path(&app)?;
    ganbaru_notes::notes::file_assets::prepare_import_file_reference(&pool, &vault_root, request)
        .await
}

#[tauri::command]
pub async fn notes_file_asset_data_url<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    relative_path: String,
) -> Result<String, String> {
    let pool = connect_sqlite(app.clone(), db_url).await?;
    let vault_root = vault::active_vault_path(&app)?;
    ganbaru_notes::notes::file_assets::file_asset_data_url(&pool, &vault_root, relative_path).await
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn dialog_path(path: FilePath) -> Result<PathBuf, String> {
    path.into_path()
        .map_err(|error| format!("selected path is not a local file: {error}"))
}
