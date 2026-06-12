use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

use super::validation::require_non_empty;

#[tauri::command]
pub async fn calendar_has_progress_segments<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    template_id: String,
    date: String,
) -> Result<bool, String> {
    require_non_empty(&template_id, "template_id")?;
    require_non_empty(&date, "date")?;
    let pool = connect_sqlite(app, db_url).await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM pomodoro_segments
         WHERE event_id IN (?, ? || '::' || ?) AND event_date = ?
           AND status IN ('completed', 'interrupted')
           AND actual_start IS NOT NULL",
    )
    .bind(&template_id)
    .bind(&template_id)
    .bind(&date)
    .bind(&date)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("count progress segments: {e}"))?;
    Ok(count > 0)
}
#[tauri::command]
pub async fn calendar_progress_dates_before<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    template_id: String,
    cutoff_date: String,
    exclude_date: Option<String>,
) -> Result<Vec<String>, String> {
    require_non_empty(&template_id, "template_id")?;
    require_non_empty(&cutoff_date, "cutoff_date")?;
    if let Some(date) = &exclude_date {
        require_non_empty(date, "exclude_date")?;
    }
    let pool = connect_sqlite(app, db_url).await?;
    let dates = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT event_date
         FROM pomodoro_segments
         WHERE (event_id = ? OR event_id = ? || '::' || event_date)
           AND event_date < ?
           AND status IN ('completed', 'interrupted')
           AND actual_start IS NOT NULL
         ORDER BY event_date ASC",
    )
    .bind(&template_id)
    .bind(&template_id)
    .bind(&cutoff_date)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load progress dates: {e}"))?;
    Ok(filter_excluded_dates(dates, exclude_date.as_deref()))
}
pub(super) fn filter_excluded_dates(dates: Vec<String>, exclude_date: Option<&str>) -> Vec<String> {
    match exclude_date {
        Some(exclude) => dates.into_iter().filter(|date| date != exclude).collect(),
        None => dates,
    }
}
