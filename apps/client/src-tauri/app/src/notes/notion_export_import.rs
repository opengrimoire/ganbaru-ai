use super::{NoteNotionExportImportDto, NoteNotionExportImportRequest};
use crate::vault;
use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime};

pub async fn import_folder<R: Runtime>(
    app: &AppHandle<R>,
    _db_url: &str,
    pool: &SqlitePool,
    request: NoteNotionExportImportRequest,
) -> Result<NoteNotionExportImportDto, String> {
    let vault_root = vault::active_writable_vault_path(app)?;
    ganbaru_notes::notes::notion_export_import::import_folder(pool, &vault_root, request).await
}
