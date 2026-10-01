//! Explicit management of the saved views shown by an inline Notes database.

use super::models::{
    NoteDatabaseViewDto, NoteDatabaseViewDuplicate, NoteDatabaseViewRename, NoteDatabaseViewRow,
};
use super::validation::require_uuid;
use super::{history, project_history};
use serde_json::Value;
use sqlx::{Sqlite, SqlitePool, Transaction};

const VIEW_COLUMNS: &str = "id, database_id, data_source_id, name, type AS view_type, filter, sorts, configuration, source_provider, source_object_id, source_workspace_id, source_last_edited_time, url, created_time, last_edited_time";
const MAX_VIEW_NAME_CHARS: usize = 200;

fn view_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_VIEW_NAME_CHARS {
        return Err("view name must contain 1 to 200 characters".to_string());
    }
    if trimmed.chars().any(char::is_control) {
        return Err("view name must not contain control characters".to_string());
    }
    Ok(trimmed)
}

async fn page_id_tx(tx: &mut Transaction<'_, Sqlite>, database_id: &str) -> Result<String, String> {
    sqlx::query_scalar(
        "SELECT block.page_id
         FROM notes_databases AS database
         JOIN notes_blocks AS block ON block.id = database.id
         WHERE database.id = ? AND database.in_trash = 0 AND block.in_trash = 0",
    )
    .bind(database_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| format!("load Notes database parent page: {error}"))?
    .ok_or_else(|| "database not found".to_string())
}

async fn view_tx(
    tx: &mut Transaction<'_, Sqlite>,
    database_id: &str,
    view_id: &str,
) -> Result<NoteDatabaseViewRow, String> {
    let query = format!(
        "SELECT {VIEW_COLUMNS} FROM notes_database_views WHERE database_id = ? AND id = ?",
    );
    sqlx::query_as::<_, NoteDatabaseViewRow>(&query)
        .bind(database_id)
        .bind(view_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("load Notes database view: {error}"))?
        .ok_or_else(|| "view not found in database".to_string())
}

pub async fn list_database_views(
    pool: &SqlitePool,
    database_id: &str,
) -> Result<Vec<NoteDatabaseViewDto>, String> {
    require_uuid(database_id, "database_id")?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("begin Notes view list: {error}"))?;
    page_id_tx(&mut tx, database_id).await?;
    let query = format!(
        "SELECT {VIEW_COLUMNS} FROM notes_database_views WHERE database_id = ? ORDER BY sort_order ASC, created_time ASC, id ASC",
    );
    let rows = sqlx::query_as::<_, NoteDatabaseViewRow>(&query)
        .bind(database_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|error| format!("list Notes database views: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("commit Notes view list: {error}"))?;
    rows.into_iter().map(NoteDatabaseViewDto::new).collect()
}

pub async fn duplicate_database_view(
    pool: &SqlitePool,
    request: NoteDatabaseViewDuplicate,
) -> Result<NoteDatabaseViewDto, String> {
    require_uuid(&request.id, "id")?;
    require_uuid(&request.database_id, "database_id")?;
    require_uuid(&request.source_view_id, "source_view_id")?;
    let name = view_name(&request.name)?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("begin Notes view duplicate: {error}"))?;
    let page_id = page_id_tx(&mut tx, &request.database_id).await?;
    super::database_editing_lock::ensure_unlocked_tx(&mut tx, &request.database_id).await?;
    let source = view_tx(&mut tx, &request.database_id, &request.source_view_id).await?;
    history::record_page_snapshot_tx(&mut tx, &page_id, "duplicate_database_view").await?;
    project_history::mark_page_dirty_tx(&mut tx, &page_id, "Duplicate database view", false)
        .await?;
    let sort_order: f64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order) + 1, 1) FROM notes_database_views WHERE database_id = ?",
    )
    .bind(&request.database_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| format!("prepare Notes view order: {error}"))?;
    sqlx::query(
        "INSERT INTO notes_database_views (id, database_id, data_source_id, name, type, filter, sorts, configuration, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&request.id)
    .bind(&request.database_id)
    .bind(&source.data_source_id)
    .bind(name)
    .bind(&source.view_type)
    .bind(&source.filter)
    .bind(&source.sorts)
    .bind(&source.configuration)
    .bind(sort_order)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("duplicate Notes database view: {error}"))?;
    let created = view_tx(&mut tx, &request.database_id, &request.id).await?;
    tx.commit()
        .await
        .map_err(|error| format!("commit Notes view duplicate: {error}"))?;
    NoteDatabaseViewDto::new(created)
}

pub async fn rename_database_view(
    pool: &SqlitePool,
    database_id: &str,
    view_id: &str,
    update: NoteDatabaseViewRename,
) -> Result<NoteDatabaseViewDto, String> {
    require_uuid(database_id, "database_id")?;
    require_uuid(view_id, "view_id")?;
    let name = view_name(&update.name)?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("begin Notes view rename: {error}"))?;
    let page_id = page_id_tx(&mut tx, database_id).await?;
    super::database_editing_lock::ensure_unlocked_tx(&mut tx, database_id).await?;
    let current = view_tx(&mut tx, database_id, view_id).await?;
    if current.name != name {
        history::record_page_snapshot_tx(&mut tx, &page_id, "rename_database_view").await?;
        project_history::mark_page_dirty_tx(&mut tx, &page_id, "Rename database view", false)
            .await?;
        sqlx::query(
            "UPDATE notes_database_views SET name = ?, last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE database_id = ? AND id = ?",
        )
        .bind(name)
        .bind(database_id)
        .bind(view_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("rename Notes database view: {error}"))?;
    }
    let renamed = view_tx(&mut tx, database_id, view_id).await?;
    tx.commit()
        .await
        .map_err(|error| format!("commit Notes view rename: {error}"))?;
    NoteDatabaseViewDto::new(renamed)
}

pub async fn delete_database_view(
    pool: &SqlitePool,
    database_id: &str,
    view_id: &str,
) -> Result<String, String> {
    require_uuid(database_id, "database_id")?;
    require_uuid(view_id, "view_id")?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("begin Notes view delete: {error}"))?;
    let page_id = page_id_tx(&mut tx, database_id).await?;
    let current = view_tx(&mut tx, database_id, view_id).await?;
    super::database_editing_lock::ensure_unlocked_tx(&mut tx, database_id).await?;
    if current.view_type == "table" {
        let other_tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM notes_database_views WHERE data_source_id = ? AND type = 'table' AND id <> ?",
        )
        .bind(&current.data_source_id)
        .bind(view_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("count Notes table views: {error}"))?;
        if other_tables == 0 {
            return Err("a data source needs a table view to edit its properties".to_string());
        }
    }
    let replacement: Option<(String, String)> = sqlx::query_as(
        "SELECT id, data_source_id FROM notes_database_views WHERE database_id = ? AND id <> ? ORDER BY CASE WHEN type = 'table' THEN 0 ELSE 1 END, sort_order ASC, created_time ASC, id ASC LIMIT 1",
    )
    .bind(database_id)
    .bind(view_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| format!("find replacement Notes database view: {error}"))?;
    let replacement =
        replacement.ok_or_else(|| "a database needs at least one view".to_string())?;
    history::record_page_snapshot_tx(&mut tx, &page_id, "delete_database_view").await?;
    project_history::mark_page_dirty_tx(&mut tx, &page_id, "Delete database view", false).await?;
    let payload: String = sqlx::query_scalar("SELECT payload FROM notes_blocks WHERE id = ?")
        .bind(database_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("load Notes database block: {error}"))?;
    let mut payload: Value = serde_json::from_str(&payload)
        .map_err(|error| format!("parse Notes database block: {error}"))?;
    if payload.get("view_id").and_then(Value::as_str) == Some(view_id) {
        payload["view_id"] = Value::String(replacement.0);
        payload["data_source_id"] = Value::String(replacement.1);
        sqlx::query("UPDATE notes_blocks SET payload = ?, last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
            .bind(payload.to_string())
            .bind(database_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("update Notes database default view: {error}"))?;
    }
    sqlx::query("DELETE FROM notes_database_views WHERE database_id = ? AND id = ?")
        .bind(database_id)
        .bind(view_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("delete Notes database view: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("commit Notes view delete: {error}"))?;
    Ok(view_id.to_string())
}
