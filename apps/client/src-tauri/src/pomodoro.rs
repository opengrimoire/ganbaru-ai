use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, Transaction};
use std::collections::HashMap;
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
    pauses: Vec<PomodoroPauseWrite>,
    status: String,
    focus_duration_minutes: i64,
    short_break_minutes: i64,
    long_break_minutes: i64,
    pomodoro_count: i64,
    idle_timeout_minutes: Option<i64>,
    run_planned_end: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSegmentUpdate {
    id: String,
    status: String,
    actual_start: Option<String>,
    actual_end: Option<String>,
    pauses: Vec<PomodoroPauseWrite>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroPauseWrite {
    started_at: String,
    ended_at: Option<String>,
    reason: String,
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

#[derive(Serialize)]
pub struct PomodoroSegmentRead {
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
    status: String,
    pauses: Vec<PomodoroPauseWrite>,
}

struct PomodoroSegmentRow {
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
    status: String,
}
impl_sqlite_from_row!(PomodoroSegmentRow {
    id,
    event_id,
    event_date,
    run_id,
    cycle_number,
    phase,
    planned_start,
    planned_end,
    actual_start,
    actual_end,
    status,
});

#[tauri::command]
pub async fn pomodoro_load_segments_for_events<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    event_ids: Vec<String>,
) -> Result<Vec<PomodoroSegmentRead>, String> {
    if event_ids.is_empty() {
        return Ok(Vec::new());
    }
    for event_id in &event_ids {
        require_non_empty(event_id, "event_id")?;
    }

    let placeholders = std::iter::repeat_n("?", event_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT id, event_id, event_date, run_id, cycle_number, phase,
                planned_start, planned_end, actual_start, actual_end, status
         FROM pomodoro_segments
         WHERE event_id IN ({placeholders})
           AND (status = 'completed' OR status = 'active' OR status = 'interrupted')
         ORDER BY planned_start ASC"
    );
    let pool = connect_sqlite(app, db_url).await?;
    let mut q = sqlx::query_as::<_, PomodoroSegmentRow>(&query);
    for event_id in event_ids {
        q = q.bind(event_id);
    }
    let rows = q
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("load pomodoro event segments: {e}"))?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let segment_ids = rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>();
    let placeholders = std::iter::repeat_n("?", segment_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let pause_query = format!(
        "SELECT segment_id, started_at, ended_at, reason
         FROM pomodoro_pauses
         WHERE segment_id IN ({placeholders})
         ORDER BY started_at ASC"
    );
    let mut pause_q = sqlx::query(&pause_query);
    for id in &segment_ids {
        pause_q = pause_q.bind(id);
    }
    let pause_rows = pause_q
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("load pomodoro pauses: {e}"))?;
    let mut pauses_by_segment: HashMap<String, Vec<PomodoroPauseWrite>> = HashMap::new();
    for row in pause_rows {
        let segment_id: String = row
            .try_get("segment_id")
            .map_err(|e| format!("read pause segment_id: {e}"))?;
        let pause = PomodoroPauseWrite {
            started_at: row
                .try_get("started_at")
                .map_err(|e| format!("read pause started_at: {e}"))?,
            ended_at: row
                .try_get("ended_at")
                .map_err(|e| format!("read pause ended_at: {e}"))?,
            reason: row
                .try_get("reason")
                .map_err(|e| format!("read pause reason: {e}"))?,
        };
        pauses_by_segment.entry(segment_id).or_default().push(pause);
    }

    Ok(rows
        .into_iter()
        .map(|row| {
            let pauses = pauses_by_segment.remove(&row.id).unwrap_or_default();
            PomodoroSegmentRead {
                id: row.id,
                event_id: row.event_id,
                event_date: row.event_date,
                run_id: row.run_id,
                cycle_number: row.cycle_number,
                phase: row.phase,
                planned_start: row.planned_start,
                planned_end: row.planned_end,
                actual_start: row.actual_start,
                actual_end: row.actual_end,
                status: row.status,
                pauses,
            }
        })
        .collect())
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

    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;

    for segment in segments {
        let event_id = canonical_event_id(&segment.event_id)?.to_string();
        let started_at = segment
            .actual_start
            .as_deref()
            .unwrap_or(&segment.planned_start)
            .to_string();
        sqlx::query(
            "INSERT OR IGNORE INTO pomodoro_runs
                (id, event_id, original_event_id, event_date, planned_start, planned_end,
                 started_at, focus_duration_minutes, short_break_minutes, long_break_minutes,
                 pomodoro_count, idle_timeout_minutes, last_heartbeat, start_trigger)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'block_auto')",
        )
        .bind(&segment.run_id)
        .bind(&event_id)
        .bind(&event_id)
        .bind(&segment.event_date)
        .bind(&segment.planned_start)
        .bind(&segment.run_planned_end)
        .bind(&started_at)
        .bind(segment.focus_duration_minutes)
        .bind(segment.short_break_minutes)
        .bind(segment.long_break_minutes)
        .bind(segment.pomodoro_count)
        .bind(segment.idle_timeout_minutes)
        .bind(&started_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert pomodoro run: {e}"))?;

        sqlx::query(
            "INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, cycle_number, phase,
                 planned_start, planned_end, actual_start, actual_end, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&segment.id)
        .bind(event_id)
        .bind(&segment.event_date)
        .bind(&segment.run_id)
        .bind(segment.cycle_number)
        .bind(&segment.phase)
        .bind(&segment.planned_start)
        .bind(&segment.planned_end)
        .bind(&segment.actual_start)
        .bind(&segment.actual_end)
        .bind(&segment.status)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert pomodoro segment: {e}"))?;
        replace_segment_pauses(&mut tx, &segment.id, &segment.pauses).await?;
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

    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;

    for segment in segments {
        let result = sqlx::query(
            "UPDATE pomodoro_segments
             SET status = ?, actual_start = ?, actual_end = ?
             WHERE id = ?",
        )
        .bind(&segment.status)
        .bind(&segment.actual_start)
        .bind(&segment.actual_end)
        .bind(&segment.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("update pomodoro segment: {e}"))?;
        if result.rows_affected() == 0 {
            return Err(format!("pomodoro segment not found: {}", segment.id));
        }
        replace_segment_pauses(&mut tx, &segment.id, &segment.pauses).await?;
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

    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET status = 'interrupted',
             actual_end = COALESCE(actual_end, actual_start, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         WHERE event_id IN (?, ?) AND event_date = ? AND status = 'active'",
    )
    .bind(&event_id)
    .bind(&canonical_id)
    .bind(&event_date)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("interrupt active pomodoro segments: {e}"))?;

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pomodoro_cleanup_orphans<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<(), String> {
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET status = 'interrupted',
             actual_end = COALESCE(actual_end, actual_start, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         WHERE status = 'active'",
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("interrupt orphaned pomodoro segments: {e}"))?;

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

async fn replace_segment_pauses(
    tx: &mut Transaction<'_, Sqlite>,
    segment_id: &str,
    pauses: &[PomodoroPauseWrite],
) -> Result<(), String> {
    sqlx::query("DELETE FROM pomodoro_pauses WHERE segment_id = ?")
        .bind(segment_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("clear pomodoro pauses: {e}"))?;

    for (index, pause) in pauses.iter().enumerate() {
        validate_pause(pause)?;
        sqlx::query(
            "INSERT INTO pomodoro_pauses
                (id, segment_id, started_at, ended_at, reason, detected_at)
             VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?)",
        )
        .bind(segment_id)
        .bind(&pause.started_at)
        .bind(&pause.ended_at)
        .bind(&pause.reason)
        .bind(if pause.reason == "idle" {
            Some(pause.started_at.as_str())
        } else {
            None
        })
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("insert pomodoro pause {index}: {e}"))?;
    }
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

    let pool = connect_sqlite(app, db_url).await?;
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
    .execute(&pool)
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
    require_non_empty(&segment.run_planned_end, "run_planned_end")?;
    if segment.actual_start.is_none() {
        return Err("actual_start is required for persisted pomodoro segments".to_string());
    }
    validate_config_minutes(segment.focus_duration_minutes, "focus_duration_minutes")?;
    validate_config_minutes(segment.short_break_minutes, "short_break_minutes")?;
    validate_config_minutes(segment.long_break_minutes, "long_break_minutes")?;
    validate_config_minutes(segment.pomodoro_count, "pomodoro_count")?;
    if let Some(idle_timeout) = segment.idle_timeout_minutes {
        if idle_timeout < 0 {
            return Err("idle_timeout_minutes cannot be negative".to_string());
        }
    }
    validate_status(&segment.status)?;
    for pause in &segment.pauses {
        validate_pause(pause)?;
    }
    Ok(())
}

fn validate_segment_update(segment: &PomodoroSegmentUpdate) -> Result<(), String> {
    require_non_empty(&segment.id, "id")?;
    validate_status(&segment.status)?;
    for pause in &segment.pauses {
        validate_pause(pause)?;
    }
    Ok(())
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
        "active" | "completed" | "interrupted" => Ok(()),
        _ => Err(format!("invalid pomodoro segment status: {status}")),
    }
}

fn validate_pause(pause: &PomodoroPauseWrite) -> Result<(), String> {
    require_non_empty(&pause.started_at, "pause.started_at")?;
    validate_pause_reason(&pause.reason)
}

fn validate_pause_reason(reason: &str) -> Result<(), String> {
    match reason {
        "idle" | "manual" | "suspend" => Ok(()),
        _ => Err(format!("invalid pomodoro pause reason: {reason}")),
    }
}

fn validate_config_minutes(value: i64, field: &str) -> Result<(), String> {
    if value <= 0 {
        Err(format!("{field} must be positive"))
    } else {
        Ok(())
    }
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
        canonical_event_id, compute_focus_score, validate_pause_reason, validate_phase,
        validate_status, PomodoroPauseMs,
    };

    #[test]
    fn validates_segment_enums() {
        assert!(validate_phase("focus").is_ok());
        assert!(validate_phase("short_break").is_ok());
        assert!(validate_phase("wrong").is_err());
        assert!(validate_status("active").is_ok());
        assert!(validate_status("interrupted").is_ok());
        assert!(validate_status("planned").is_err());
        assert!(validate_status("wrong").is_err());
    }

    #[test]
    fn validates_pause_reason() {
        assert!(validate_pause_reason("idle").is_ok());
        assert!(validate_pause_reason("manual").is_ok());
        assert!(validate_pause_reason("suspend").is_ok());
        assert!(validate_pause_reason("unknown").is_err());
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
