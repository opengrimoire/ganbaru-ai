use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use tauri::{AppHandle, Runtime};

use super::validate_id;
use crate::db::connect_sqlite;

const MAX_TAGS: usize = 9;
const MAX_TAG_NAME_CHARS: usize = 40;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNoteTagWrite {
    id: String,
    name: String,
}

#[derive(Clone, Debug, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNoteTagRead {
    id: String,
    name: String,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

pub(super) async fn list<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<Vec<QuickNoteTagRead>, String> {
    let pool = connect_sqlite(app, db_url).await?;
    sqlx::query_as::<_, QuickNoteTagRead>(
        "SELECT id, name, sort_order, created_at, updated_at
         FROM quick_note_tags ORDER BY sort_order, id",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| format!("list quick note tags: {error}"))
}

pub(super) async fn create<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    tag: QuickNoteTagWrite,
) -> Result<QuickNoteTagRead, String> {
    validate_id(&tag.id)?;
    let name = validate_tag_name(&tag.name)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("begin quick note tag create: {error}"))?;
    let orders =
        sqlx::query_scalar::<_, i64>("SELECT sort_order FROM quick_note_tags ORDER BY sort_order")
            .fetch_all(&mut *tx)
            .await
            .map_err(|error| format!("load quick note tag order: {error}"))?;
    if orders.len() >= MAX_TAGS {
        return Err(format!("quick notes cannot have more than {MAX_TAGS} tags"));
    }
    let sort_order = (0..MAX_TAGS as i64)
        .find(|candidate| !orders.contains(candidate))
        .ok_or_else(|| "quick note tag order is full".to_string())?;
    sqlx::query("INSERT INTO quick_note_tags (id, name, sort_order) VALUES (?, ?, ?)")
        .bind(&tag.id)
        .bind(name)
        .bind(sort_order)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("create quick note tag: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("commit quick note tag create: {error}"))?;
    sqlx::query_as::<_, QuickNoteTagRead>(
        "SELECT id, name, sort_order, created_at, updated_at FROM quick_note_tags WHERE id = ?",
    )
    .bind(tag.id)
    .fetch_one(&pool)
    .await
    .map_err(|error| format!("load created quick note tag: {error}"))
}

fn validate_tag_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > MAX_TAG_NAME_CHARS {
        return Err(format!(
            "quick note tag name must be between 1 and {MAX_TAG_NAME_CHARS} characters"
        ));
    }
    Ok(trimmed)
}
