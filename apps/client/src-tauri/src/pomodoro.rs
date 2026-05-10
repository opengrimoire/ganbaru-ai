use serde::Deserialize;
use sqlx::Connection;
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSegmentWrite {
    id: String,
    event_id: String,
    event_date: String,
    run_id: String,
    cycle_number: i64,
    phase: String,
    planned_start: String,
    planned_end: String,
    actual_start: Option<String>,
    actual_end: Option<String>,
    pause_log: String,
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSegmentUpdate {
    id: String,
    status: String,
    actual_start: Option<String>,
    actual_end: Option<String>,
    pause_log: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroPauseMs {
    start_ms: f64,
    end_ms: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSessionWrite {
    id: String,
    event_id: Option<String>,
    start_time: String,
    end_time: String,
    start_ms: f64,
    end_ms: f64,
    pauses: Vec<PomodoroPauseMs>,
}

#[tauri::command]
pub async fn pomodoro_insert_segments<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    segments: Vec<PomodoroSegmentWrite>,
) -> Result<(), String> {
    for segment in &segments {
        validate_segment_write(segment)?;
    }

    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

    for segment in segments {
        let event_id = canonical_event_id(&segment.event_id)?.to_string();
        sqlx::query(
            "INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, cycle_number, phase,
                 planned_start, planned_end, actual_start, actual_end, pause_log, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(segment.id)
        .bind(event_id)
        .bind(segment.event_date)
        .bind(segment.run_id)
        .bind(segment.cycle_number)
        .bind(segment.phase)
        .bind(segment.planned_start)
        .bind(segment.planned_end)
        .bind(segment.actual_start)
        .bind(segment.actual_end)
        .bind(segment.pause_log)
        .bind(segment.status)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert pomodoro segment: {e}"))?;
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pomodoro_update_segments<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    segments: Vec<PomodoroSegmentUpdate>,
) -> Result<(), String> {
    for segment in &segments {
        validate_segment_update(segment)?;
    }
    if segments.is_empty() {
        return Ok(());
    }

    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

    for segment in segments {
        let result = sqlx::query(
            "UPDATE pomodoro_segments
             SET status = ?, actual_start = ?, actual_end = ?, pause_log = ?
             WHERE id = ?",
        )
        .bind(&segment.status)
        .bind(&segment.actual_start)
        .bind(&segment.actual_end)
        .bind(&segment.pause_log)
        .bind(&segment.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("update pomodoro segment: {e}"))?;
        if result.rows_affected() == 0 {
            return Err(format!("pomodoro segment not found: {}", segment.id));
        }
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pomodoro_cleanup_event_segments<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    event_id: String,
    event_date: String,
) -> Result<(), String> {
    let canonical_id = canonical_event_id(&event_id)?.to_string();
    require_non_empty(&event_date, "event_date")?;

    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET status = 'interrupted',
             actual_end = COALESCE(actual_end, actual_start, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
             pause_log = CASE
               WHEN pause_log IS NOT NULL AND pause_log LIKE '%null]%'
               THEN REPLACE(pause_log, 'null]', '\"' || strftime('%Y-%m-%dT%H:%M:%fZ', 'now') || '\"]')
               ELSE pause_log
             END
         WHERE event_id IN (?, ?) AND event_date = ? AND status = 'active'",
    )
    .bind(&event_id)
    .bind(&canonical_id)
    .bind(&event_date)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("interrupt active pomodoro segments: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET status = 'skipped'
         WHERE event_id IN (?, ?) AND event_date = ? AND status = 'planned'",
    )
    .bind(&event_id)
    .bind(&canonical_id)
    .bind(&event_date)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("skip planned pomodoro segments: {e}"))?;

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pomodoro_cleanup_orphans<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<(), String> {
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET status = 'interrupted',
             actual_end = COALESCE(actual_end, actual_start, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         WHERE status = 'active'",
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("interrupt orphaned pomodoro segments: {e}"))?;

    sqlx::query("UPDATE pomodoro_segments SET status = 'skipped' WHERE status = 'planned'")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("skip orphaned pomodoro segments: {e}"))?;

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pomodoro_save_session<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    session: PomodoroSessionWrite,
) -> Result<(), String> {
    validate_session_write(&session)?;
    let event_id = match session.event_id.as_deref() {
        Some(id) => Some(canonical_event_id(id)?.to_string()),
        None => None,
    };
    let focus_score = compute_focus_score(session.start_ms, session.end_ms, &session.pauses)?;

    let mut conn = connect_sqlite(&app, &db_url).await?;
    sqlx::query(
        "INSERT INTO pomodoro_sessions
            (id, event_id, start_time, end_time, completed, focus_score, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)",
    )
    .bind(session.id)
    .bind(event_id)
    .bind(session.start_time)
    .bind(&session.end_time)
    .bind(focus_score)
    .bind(&session.end_time)
    .execute(&mut conn)
    .await
    .map_err(|e| format!("insert pomodoro session: {e}"))?;
    Ok(())
}

fn compute_focus_score(
    start_ms: f64,
    end_ms: f64,
    pauses: &[PomodoroPauseMs],
) -> Result<f64, String> {
    require_finite(start_ms, "start_ms")?;
    require_finite(end_ms, "end_ms")?;
    let total_ms = end_ms - start_ms;
    if total_ms <= 0.0 {
        return Ok(1.0);
    }

    let mut pause_ms = 0.0;
    for pause in pauses {
        require_finite(pause.start_ms, "pause.start_ms")?;
        let raw_end = pause.end_ms.unwrap_or(end_ms);
        require_finite(raw_end, "pause.end_ms")?;
        let pause_start = pause.start_ms.max(start_ms);
        let pause_end = raw_end.min(end_ms);
        pause_ms += (pause_end - pause_start).max(0.0);
    }

    let score = ((total_ms - pause_ms).max(0.0) / total_ms).max(0.0);
    Ok((score * 100.0).round() / 100.0)
}

fn validate_segment_write(segment: &PomodoroSegmentWrite) -> Result<(), String> {
    require_non_empty(&segment.id, "id")?;
    canonical_event_id(&segment.event_id)?;
    require_non_empty(&segment.event_date, "event_date")?;
    require_non_empty(&segment.run_id, "run_id")?;
    if segment.cycle_number <= 0 {
        return Err("cycle_number must be positive".to_string());
    }
    validate_phase(&segment.phase)?;
    require_non_empty(&segment.planned_start, "planned_start")?;
    require_non_empty(&segment.planned_end, "planned_end")?;
    validate_status(&segment.status)?;
    validate_pause_log_json(&segment.pause_log)
}

fn validate_segment_update(segment: &PomodoroSegmentUpdate) -> Result<(), String> {
    require_non_empty(&segment.id, "id")?;
    validate_status(&segment.status)?;
    validate_pause_log_json(&segment.pause_log)
}

fn validate_session_write(session: &PomodoroSessionWrite) -> Result<(), String> {
    require_non_empty(&session.id, "id")?;
    require_non_empty(&session.start_time, "start_time")?;
    require_non_empty(&session.end_time, "end_time")?;
    compute_focus_score(session.start_ms, session.end_ms, &session.pauses)?;
    Ok(())
}

fn validate_phase(phase: &str) -> Result<(), String> {
    match phase {
        "focus" | "short_break" | "long_break" => Ok(()),
        _ => Err(format!("invalid pomodoro segment phase: {phase}")),
    }
}

fn validate_status(status: &str) -> Result<(), String> {
    match status {
        "planned" | "active" | "completed" | "skipped" | "interrupted" => Ok(()),
        _ => Err(format!("invalid pomodoro segment status: {status}")),
    }
}

fn validate_pause_log_json(value: &str) -> Result<(), String> {
    serde_json::from_str::<Vec<(String, Option<String>)>>(value)
        .map_err(|e| format!("pause_log is not a valid pause interval list: {e}"))?;
    Ok(())
}

fn canonical_event_id(value: &str) -> Result<&str, String> {
    require_non_empty(value, "event_id")?;
    let id = value.split_once("::").map_or(value, |(parent, _)| parent);
    require_non_empty(id, "event_id")?;
    Ok(id)
}

fn require_non_empty(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} cannot be empty"))
    } else {
        Ok(())
    }
}

fn require_finite(value: f64, field: &str) -> Result<(), String> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(format!("{field} must be finite"))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_event_id, compute_focus_score, validate_pause_log_json, validate_phase,
        validate_status, PomodoroPauseMs,
    };

    #[test]
    fn validates_segment_enums() {
        assert!(validate_phase("focus").is_ok());
        assert!(validate_phase("short_break").is_ok());
        assert!(validate_phase("wrong").is_err());
        assert!(validate_status("active").is_ok());
        assert!(validate_status("interrupted").is_ok());
        assert!(validate_status("wrong").is_err());
    }

    #[test]
    fn validates_pause_log_shape() {
        assert!(validate_pause_log_json("[]").is_ok());
        assert!(validate_pause_log_json(r#"[["2026-05-09T10:00:00Z",null]]"#).is_ok());
        assert!(validate_pause_log_json(r#"{"bad":true}"#).is_err());
    }

    #[test]
    fn canonicalizes_recurring_instance_ids() {
        assert_eq!(canonical_event_id("event-1").unwrap(), "event-1");
        assert_eq!(
            canonical_event_id("event-1::2026-05-09").unwrap(),
            "event-1"
        );
        assert!(canonical_event_id("::2026-05-09").is_err());
    }

    #[test]
    fn computes_focus_score_with_pauses() {
        let pauses = vec![
            PomodoroPauseMs {
                start_ms: 5.0,
                end_ms: Some(10.0),
            },
            PomodoroPauseMs {
                start_ms: 25.0,
                end_ms: Some(30.0),
            },
        ];
        assert_eq!(compute_focus_score(0.0, 40.0, &pauses).unwrap(), 0.75);
    }

    #[test]
    fn computes_focus_score_with_open_pause() {
        let pauses = vec![PomodoroPauseMs {
            start_ms: 30.0,
            end_ms: None,
        }];
        assert_eq!(compute_focus_score(0.0, 40.0, &pauses).unwrap(), 0.75);
    }
}
