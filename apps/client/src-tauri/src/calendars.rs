use serde::Deserialize;
use sqlx::Connection;
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarWrite {
    id: String,
    name: String,
    color: String,
    source: String,
    visible: bool,
    read_only: bool,
    source_url: Option<String>,
    created_at: String,
    updated_at: String,
}

#[tauri::command]
pub async fn calendar_add_calendar<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    calendar: CalendarWrite,
) -> Result<(), String> {
    validate_calendar_write(&calendar)?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    sqlx::query(
        "INSERT INTO calendars
           (id, name, color, source, visible, read_only, source_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(calendar.id)
    .bind(calendar.name)
    .bind(calendar.color)
    .bind(calendar.source)
    .bind(if calendar.visible { 1_i64 } else { 0_i64 })
    .bind(if calendar.read_only { 1_i64 } else { 0_i64 })
    .bind(calendar.source_url)
    .bind(calendar.created_at)
    .bind(calendar.updated_at)
    .execute(&mut conn)
    .await
    .map_err(|e| format!("insert calendar: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn calendar_set_visibility<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
    visible: bool,
    updated_at: String,
) -> Result<(), String> {
    require_non_empty(&id, "id")?;
    require_non_empty(&updated_at, "updated_at")?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let result = sqlx::query("UPDATE calendars SET visible = ?, updated_at = ? WHERE id = ?")
        .bind(if visible { 1_i64 } else { 0_i64 })
        .bind(updated_at)
        .bind(id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("update calendar visibility: {e}"))?;
    if result.rows_affected() == 0 {
        return Err("calendar not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn calendar_remove_calendar<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
) -> Result<(), String> {
    require_non_empty(&id, "id")?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;
    sqlx::query("DELETE FROM calendar_events WHERE calendar_id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("delete calendar events: {e}"))?;
    let result = sqlx::query("DELETE FROM calendars WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("delete calendar: {e}"))?;
    if result.rows_affected() == 0 {
        return Err("calendar not found".to_string());
    }
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

fn validate_calendar_write(calendar: &CalendarWrite) -> Result<(), String> {
    require_non_empty(&calendar.id, "id")?;
    require_non_empty(&calendar.name, "name")?;
    require_non_empty(&calendar.source, "source")?;
    require_non_empty(&calendar.created_at, "created_at")?;
    require_non_empty(&calendar.updated_at, "updated_at")
}

fn require_non_empty(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} cannot be empty"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_calendar_write, CalendarWrite};

    fn calendar() -> CalendarWrite {
        CalendarWrite {
            id: "cal".to_string(),
            name: "Calendar".to_string(),
            color: "".to_string(),
            source: "local".to_string(),
            visible: true,
            read_only: false,
            source_url: None,
            created_at: "2026-05-01 00:00:00".to_string(),
            updated_at: "2026-05-01 00:00:00".to_string(),
        }
    }

    #[test]
    fn validates_calendar_write_identity() {
        assert!(validate_calendar_write(&calendar()).is_ok());
        let mut invalid = calendar();
        invalid.id = " ".to_string();
        assert!(validate_calendar_write(&invalid).is_err());
    }
}
