use serde::Deserialize;
use sqlx::{Sqlite, Transaction};
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkPomodoroHistoryPayload {
    configs: Vec<BenchmarkPomodoroConfigSeed>,
    segments: Vec<BenchmarkPomodoroSegmentSeed>,
    sessions: Vec<BenchmarkPomodoroSessionSeed>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkPomodoroConfigSeed {
    event_id: String,
    focus_duration_minutes: i64,
    short_break_minutes: i64,
    long_break_minutes: i64,
    pomodoro_count: i64,
    idle_timeout_minutes: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkPomodoroSegmentSeed {
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
struct BenchmarkPomodoroSessionSeed {
    id: String,
    event_id: String,
    start_time: String,
    end_time: String,
    completed: bool,
    app_switch_count: i64,
    break_extended: bool,
    focus_score: f64,
    created_at: String,
}

#[tauri::command]
pub async fn benchmark_seed_pomodoro_history<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    payload: BenchmarkPomodoroHistoryPayload,
) -> Result<(), String> {
    validate_payload(&payload)?;

    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;

    for config in &payload.configs {
        insert_config(&mut tx, config).await?;
    }
    for segment in &payload.segments {
        insert_segment(&mut tx, segment).await?;
    }
    for session in &payload.sessions {
        insert_session(&mut tx, session).await?;
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

async fn insert_config(
    tx: &mut Transaction<'_, Sqlite>,
    config: &BenchmarkPomodoroConfigSeed,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR REPLACE INTO pomodoro_configs
            (event_id, focus_duration_minutes, short_break_minutes,
             long_break_minutes, pomodoro_count, idle_timeout_minutes)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&config.event_id)
    .bind(config.focus_duration_minutes)
    .bind(config.short_break_minutes)
    .bind(config.long_break_minutes)
    .bind(config.pomodoro_count)
    .bind(config.idle_timeout_minutes)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("seed benchmark pomodoro config: {e}"))?;
    Ok(())
}

async fn insert_segment(
    tx: &mut Transaction<'_, Sqlite>,
    segment: &BenchmarkPomodoroSegmentSeed,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR REPLACE INTO pomodoro_segments
            (id, event_id, event_date, run_id, cycle_number, phase,
             planned_start, planned_end, actual_start, actual_end, pause_log, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&segment.id)
    .bind(&segment.event_id)
    .bind(&segment.event_date)
    .bind(&segment.run_id)
    .bind(segment.cycle_number)
    .bind(&segment.phase)
    .bind(&segment.planned_start)
    .bind(&segment.planned_end)
    .bind(&segment.actual_start)
    .bind(&segment.actual_end)
    .bind(&segment.pause_log)
    .bind(&segment.status)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("seed benchmark pomodoro segment: {e}"))?;
    Ok(())
}

async fn insert_session(
    tx: &mut Transaction<'_, Sqlite>,
    session: &BenchmarkPomodoroSessionSeed,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR REPLACE INTO pomodoro_sessions
            (id, event_id, start_time, end_time, completed, app_switch_count,
             break_extended, focus_score, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&session.id)
    .bind(&session.event_id)
    .bind(&session.start_time)
    .bind(&session.end_time)
    .bind(if session.completed { 1_i64 } else { 0_i64 })
    .bind(session.app_switch_count)
    .bind(if session.break_extended { 1_i64 } else { 0_i64 })
    .bind(session.focus_score)
    .bind(&session.created_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("seed benchmark pomodoro session: {e}"))?;
    Ok(())
}

fn validate_payload(payload: &BenchmarkPomodoroHistoryPayload) -> Result<(), String> {
    for config in &payload.configs {
        require_non_empty(&config.event_id, "config.event_id")?;
        require_positive(config.focus_duration_minutes, "focus_duration_minutes")?;
        require_positive(config.short_break_minutes, "short_break_minutes")?;
        require_positive(config.long_break_minutes, "long_break_minutes")?;
        require_positive(config.pomodoro_count, "pomodoro_count")?;
    }
    for segment in &payload.segments {
        require_non_empty(&segment.id, "segment.id")?;
        require_non_empty(&segment.event_id, "segment.event_id")?;
        require_non_empty(&segment.event_date, "segment.event_date")?;
        require_non_empty(&segment.run_id, "segment.run_id")?;
        require_positive(segment.cycle_number, "cycle_number")?;
        validate_phase(&segment.phase)?;
        require_non_empty(&segment.planned_start, "planned_start")?;
        require_non_empty(&segment.planned_end, "planned_end")?;
        validate_status(&segment.status)?;
        validate_pause_log_json(&segment.pause_log)?;
    }
    for session in &payload.sessions {
        require_non_empty(&session.id, "session.id")?;
        require_non_empty(&session.event_id, "session.event_id")?;
        require_non_empty(&session.start_time, "start_time")?;
        require_non_empty(&session.end_time, "end_time")?;
        if session.app_switch_count < 0 {
            return Err("app_switch_count must be non-negative".to_string());
        }
        if !session.focus_score.is_finite()
            || session.focus_score < 0.0
            || session.focus_score > 1.0
        {
            return Err("focus_score must be between 0 and 1".to_string());
        }
    }
    Ok(())
}

fn require_non_empty(value: &str, name: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{name} is required"));
    }
    Ok(())
}

fn require_positive(value: i64, name: &str) -> Result<(), String> {
    if value <= 0 {
        return Err(format!("{name} must be positive"));
    }
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
        "completed" | "interrupted" | "active" | "planned" | "skipped" => Ok(()),
        _ => Err(format!("invalid pomodoro segment status: {status}")),
    }
}

fn validate_pause_log_json(value: &str) -> Result<(), String> {
    serde_json::from_str::<Vec<(String, Option<String>)>>(value)
        .map_err(|e| format!("pause_log is not a valid pause interval list: {e}"))?;
    Ok(())
}
