use serde::Deserialize;
use sqlx::{Row, Sqlite, Transaction};
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkPomodoroHistoryPayload {
    configs: Vec<BenchmarkPomodoroConfigSeed>,
    segments: Vec<BenchmarkPomodoroSegmentSeed>,
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
    pauses: Vec<BenchmarkPomodoroPauseSeed>,
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkPomodoroPauseSeed {
    started_at: String,
    ended_at: Option<String>,
    reason: String,
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
    let config = sqlx::query(
        "SELECT focus_duration_minutes, short_break_minutes, long_break_minutes,
                pomodoro_count, idle_timeout_minutes
         FROM pomodoro_configs
         WHERE event_id = ?",
    )
    .bind(&segment.event_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("load benchmark pomodoro config for run: {e}"))?;
    let focus_duration_minutes: i64 = config
        .try_get("focus_duration_minutes")
        .map_err(|e| format!("read focus_duration_minutes: {e}"))?;
    let short_break_minutes: i64 = config
        .try_get("short_break_minutes")
        .map_err(|e| format!("read short_break_minutes: {e}"))?;
    let long_break_minutes: i64 = config
        .try_get("long_break_minutes")
        .map_err(|e| format!("read long_break_minutes: {e}"))?;
    let pomodoro_count: i64 = config
        .try_get("pomodoro_count")
        .map_err(|e| format!("read pomodoro_count: {e}"))?;
    let idle_timeout_minutes: Option<i64> = config
        .try_get("idle_timeout_minutes")
        .map_err(|e| format!("read idle_timeout_minutes: {e}"))?;

    sqlx::query(
        "INSERT OR IGNORE INTO pomodoro_runs
            (id, event_id, original_event_id, event_date, planned_start, planned_end,
             started_at, ended_at, end_reason, focus_duration_minutes,
             short_break_minutes, long_break_minutes, pomodoro_count,
             idle_timeout_minutes, last_heartbeat, start_trigger)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, 'manual')",
    )
    .bind(&segment.run_id)
    .bind(&segment.event_id)
    .bind(&segment.event_id)
    .bind(&segment.event_date)
    .bind(&segment.planned_start)
    .bind(&segment.planned_end)
    .bind(
        segment
            .actual_start
            .as_deref()
            .unwrap_or(&segment.planned_start),
    )
    .bind(&segment.actual_end)
    .bind(focus_duration_minutes)
    .bind(short_break_minutes)
    .bind(long_break_minutes)
    .bind(pomodoro_count)
    .bind(idle_timeout_minutes)
    .bind(
        segment
            .actual_end
            .as_deref()
            .unwrap_or(&segment.planned_end),
    )
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("seed benchmark pomodoro run: {e}"))?;

    if let Some(actual_end) = &segment.actual_end {
        sqlx::query(
            "UPDATE pomodoro_runs
             SET planned_end = CASE WHEN planned_end < ? THEN ? ELSE planned_end END,
                 ended_at = CASE WHEN ended_at IS NULL OR ended_at < ? THEN ? ELSE ended_at END,
                 last_heartbeat = CASE WHEN last_heartbeat < ? THEN ? ELSE last_heartbeat END
             WHERE id = ?",
        )
        .bind(&segment.planned_end)
        .bind(&segment.planned_end)
        .bind(actual_end)
        .bind(actual_end)
        .bind(actual_end)
        .bind(actual_end)
        .bind(&segment.run_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("update benchmark pomodoro run bounds: {e}"))?;
    }

    sqlx::query(
        "INSERT OR REPLACE INTO pomodoro_segments
            (id, event_id, event_date, run_id, cycle_number, phase,
             planned_start, planned_end, actual_start, actual_end, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    .bind(&segment.status)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("seed benchmark pomodoro segment: {e}"))?;
    for (index, pause) in segment.pauses.iter().enumerate() {
        sqlx::query(
            "INSERT INTO pomodoro_pauses
                (id, segment_id, started_at, ended_at, reason)
             VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)",
        )
        .bind(&segment.id)
        .bind(&pause.started_at)
        .bind(&pause.ended_at)
        .bind(&pause.reason)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("seed benchmark pomodoro pause {index}: {e}"))?;
    }
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
        for pause in &segment.pauses {
            require_non_empty(&pause.started_at, "pause.started_at")?;
            if !matches!(pause.reason.as_str(), "idle" | "manual" | "suspend") {
                return Err(format!("invalid pomodoro pause reason: {}", pause.reason));
            }
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
        "completed" | "interrupted" | "active" => Ok(()),
        _ => Err(format!("invalid pomodoro segment status: {status}")),
    }
}
