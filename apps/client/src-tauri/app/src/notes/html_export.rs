#[cfg(not(any(target_os = "android", target_os = "ios")))]
use super::NoteHtmlArchiveSaveDto;
use super::NoteHtmlExportRequest;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::vault;
use sqlx::SqlitePool;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::path::PathBuf;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{AppHandle, Runtime};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_dialog::{DialogExt, FilePath};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn pick_and_write_archive<R: Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
    request: NoteHtmlExportRequest,
) -> Result<NoteHtmlArchiveSaveDto, String> {
    let mut archive = ganbaru_notes::notes::html_export::export_archive(pool, request).await?;
    let Some(path) = app
        .dialog()
        .file()
        .set_title("Export Notes HTML archive")
        .set_file_name(&archive.default_file_name)
        .add_filter("Zip archive", &["zip"])
        .blocking_save_file()
        .map(dialog_path)
        .transpose()?
    else {
        return Ok(NoteHtmlArchiveSaveDto::canceled());
    };
    let asset_root = vault::active_vault_path(app)?.join("assets");
    ganbaru_notes::notes::html_export_archive::write_archive(&asset_root, &path, &mut archive)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn dialog_path(path: FilePath) -> Result<PathBuf, String> {
    path.into_path()
        .map_err(|error| format!("selected path is not a local file: {error}"))
}
