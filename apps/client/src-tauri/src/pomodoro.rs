use chrono::DateTime;
use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, Transaction};
use std::collections::HashMap;
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroRunWrite {
    id: String,
    event_id: String,
    event_date: String,
    planned_start: String,
    planned_end: String,
    started_at: String,
    focus_duration_minutes: i64,
    short_break_minutes: i64,
    long_break_minutes: i64,
    pomodoro_count: i64,
    idle_timeout_minutes: Option<i64>,
    event_title_snapshot: Option<String>,
    inherited_focus_minutes: i64,
    inherited_cycle: i64,
    inherited_from_run_id: Option<String>,
    start_trigger: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroRunClosure {
    run_id: String,
    ended_at: String,
    end_reason: String,
    segment_status: String,
    segment_end_reason: String,
    event_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroRunWindowUpdate {
    run_id: String,
    planned_end: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroTransitionRunWrite {
    closure: PomodoroRunClosure,
    run: PomodoroRunWrite,
    segment: PomodoroSegmentWrite,
}

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
    end_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroSegmentUpdate {
    id: String,
    status: String,
    planned_end: String,
    actual_start: Option<String>,
    actual_end: Option<String>,
    end_reason: Option<String>,
    occurred_at: Option<String>,
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
pub struct PomodoroRunEventWrite {
    run_id: String,
    segment_id: Option<String>,
    event_type: String,
    occurred_at: String,
    phase: Option<String>,
    reason: Option<String>,
    duration_seconds: Option<i64>,
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

struct SegmentEventContext {
    run_id: String,
    phase: String,
    status: String,
    planned_end: String,
}

struct ExistingPause {
    started_at: String,
    ended_at: Option<String>,
    reason: String,
}

struct RunEventInsert<'a> {
    run_id: &'a str,
    segment_id: Option<&'a str>,
    event_type: &'a str,
    occurred_at: &'a str,
    phase: Option<&'a str>,
    reason: Option<&'a str>,
    duration_seconds: Option<i64>,
}

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
pub async fn pomodoro_start_run<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    run: PomodoroRunWrite,
    segment: PomodoroSegmentWrite,
) -> Result<(), String> {
    validate_run_write(&run)?;
    validate_segment_write(&segment)?;
    if run.id != segment.run_id {
        return Err("initial segment run_id must match run id".to_string());
    }

    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    insert_run_tx(&mut tx, &run, &segment).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pomodoro_transition_run<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    transition: PomodoroTransitionRunWrite,
) -> Result<(), String> {
    validate_run_closure(&transition.closure)?;
    validate_run_write(&transition.run)?;
    validate_segment_write(&transition.segment)?;
    if transition.run.id != transition.segment.run_id {
        return Err("transition segment run_id must match run id".to_string());
    }

    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    close_run_tx(&mut tx, &transition.closure).await?;
    insert_run_tx(&mut tx, &transition.run, &transition.segment).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
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
        insert_segment_tx(&mut tx, &segment).await?;
        let occurred_at = segment
            .actual_start
            .as_deref()
            .unwrap_or(&segment.planned_start);
        insert_run_event_tx(
            &mut tx,
            RunEventInsert {
                run_id: &segment.run_id,
                segment_id: Some(&segment.id),
                event_type: "phase_start",
                occurred_at,
                phase: Some(&segment.phase),
                reason: None,
                duration_seconds: None,
            },
        )
        .await?;
        log_new_pause_events(&mut tx, &segment.run_id, &segment).await?;
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
        let context = load_segment_event_context(&mut tx, &segment.id).await?;
        let previous_pauses = load_existing_pauses(&mut tx, &segment.id).await?;
        let result = sqlx::query(
            "UPDATE pomodoro_segments
             SET status = ?, planned_end = ?, actual_start = ?, actual_end = ?, end_reason = ?
             WHERE id = ?",
        )
        .bind(&segment.status)
        .bind(&segment.planned_end)
        .bind(&segment.actual_start)
        .bind(&segment.actual_end)
        .bind(&segment.end_reason)
        .bind(&segment.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("update pomodoro segment: {e}"))?;
        if result.rows_affected() == 0 {
            return Err(format!("pomodoro segment not found: {}", segment.id));
        }
        replace_segment_pauses(&mut tx, &segment.id, &segment.pauses).await?;
        log_segment_update_events(&mut tx, &context, &segment, &previous_pauses).await?;
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pomodoro_close_run<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    closure: PomodoroRunClosure,
) -> Result<(), String> {
    validate_run_closure(&closure)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    close_run_tx(&mut tx, &closure).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pomodoro_update_run_window<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    update: PomodoroRunWindowUpdate,
) -> Result<(), String> {
    validate_run_window_update(&update)?;
    let pool = connect_sqlite(app, db_url).await?;
    let result = sqlx::query(
        "UPDATE pomodoro_runs
         SET planned_end = ?
         WHERE id = ? AND ended_at IS NULL",
    )
    .bind(&update.planned_end)
    .bind(&update.run_id)
    .execute(&pool)
    .await
    .map_err(|e| format!("update pomodoro run window: {e}"))?;
    if result.rows_affected() == 0 {
        return Err(format!("open pomodoro run not found: {}", update.run_id));
    }
    Ok(())
}

#[tauri::command]
pub async fn pomodoro_heartbeat<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    run_id: String,
    heartbeat_at: String,
) -> Result<(), String> {
    require_non_empty(&run_id, "run_id")?;
    require_non_empty(&heartbeat_at, "heartbeat_at")?;
    let pool = connect_sqlite(app, db_url).await?;
    let result = sqlx::query(
        "UPDATE pomodoro_runs
         SET last_heartbeat = ?
         WHERE id = ? AND ended_at IS NULL",
    )
    .bind(&heartbeat_at)
    .bind(&run_id)
    .execute(&pool)
    .await
    .map_err(|e| format!("update pomodoro heartbeat: {e}"))?;
    if result.rows_affected() == 0 {
        return Err(format!("open pomodoro run not found: {run_id}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn pomodoro_record_run_event<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    event: PomodoroRunEventWrite,
) -> Result<(), String> {
    validate_run_event_write(&event)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    insert_run_event_tx(
        &mut tx,
        RunEventInsert {
            run_id: &event.run_id,
            segment_id: event.segment_id.as_deref(),
            event_type: &event.event_type,
            occurred_at: &event.occurred_at,
            phase: event.phase.as_deref(),
            reason: event.reason.as_deref(),
            duration_seconds: event.duration_seconds,
        },
    )
    .await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pomodoro_recover_open_runs<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<(), String> {
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;

    let rows = sqlx::query(
        "SELECT id, last_heartbeat
         FROM pomodoro_runs
         WHERE ended_at IS NULL
         ORDER BY started_at ASC",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| format!("load open pomodoro runs: {e}"))?;

    for row in rows {
        let run_id: String = row
            .try_get("id")
            .map_err(|e| format!("read open run id: {e}"))?;
        let last_heartbeat: String = row
            .try_get("last_heartbeat")
            .map_err(|e| format!("read open run heartbeat: {e}"))?;
        let closure = PomodoroRunClosure {
            run_id,
            ended_at: last_heartbeat,
            end_reason: "interrupted".to_string(),
            segment_status: "interrupted".to_string(),
            segment_end_reason: "crash_recovery".to_string(),
            event_type: "crash_recovery".to_string(),
        };
        close_run_tx(&mut tx, &closure).await?;
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

async fn insert_run_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run: &PomodoroRunWrite,
    initial_segment: &PomodoroSegmentWrite,
) -> Result<(), String> {
    let canonical_event_id = canonical_event_id(&run.event_id)?.to_string();
    sqlx::query(
        "INSERT INTO pomodoro_runs
            (id, event_id, original_event_id, event_date, planned_start, planned_end,
             started_at, focus_duration_minutes, short_break_minutes, long_break_minutes,
             pomodoro_count, idle_timeout_minutes, last_heartbeat, event_title_snapshot,
             inherited_focus_minutes, inherited_cycle, inherited_from_run_id, start_trigger)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&run.id)
    .bind(&canonical_event_id)
    .bind(&run.event_id)
    .bind(&run.event_date)
    .bind(&run.planned_start)
    .bind(&run.planned_end)
    .bind(&run.started_at)
    .bind(run.focus_duration_minutes)
    .bind(run.short_break_minutes)
    .bind(run.long_break_minutes)
    .bind(run.pomodoro_count)
    .bind(run.idle_timeout_minutes)
    .bind(&run.started_at)
    .bind(&run.event_title_snapshot)
    .bind(run.inherited_focus_minutes)
    .bind(run.inherited_cycle)
    .bind(&run.inherited_from_run_id)
    .bind(&run.start_trigger)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert pomodoro run: {e}"))?;

    insert_segment_tx(tx, initial_segment).await?;
    insert_run_event_tx(
        tx,
        RunEventInsert {
            run_id: &run.id,
            segment_id: None,
            event_type: "start",
            occurred_at: &run.started_at,
            phase: None,
            reason: Some(&run.start_trigger),
            duration_seconds: None,
        },
    )
    .await?;
    let phase_start = initial_segment
        .actual_start
        .as_deref()
        .unwrap_or(&initial_segment.planned_start);
    insert_run_event_tx(
        tx,
        RunEventInsert {
            run_id: &run.id,
            segment_id: Some(&initial_segment.id),
            event_type: "phase_start",
            occurred_at: phase_start,
            phase: Some(&initial_segment.phase),
            reason: None,
            duration_seconds: None,
        },
    )
    .await?;
    log_new_pause_events(tx, &run.id, initial_segment).await
}

async fn insert_segment_tx(
    tx: &mut Transaction<'_, Sqlite>,
    segment: &PomodoroSegmentWrite,
) -> Result<(), String> {
    let event_id = canonical_event_id(&segment.event_id)?.to_string();
    if segment.status == "active" {
        let actual_start = segment
            .actual_start
            .as_deref()
            .unwrap_or(&segment.planned_start);
        sqlx::query(
            "UPDATE pomodoro_segments
             SET status = 'completed',
                 actual_end = COALESCE(actual_end, ?),
                 end_reason = COALESCE(end_reason, 'completed')
             WHERE run_id = ? AND status = 'active' AND id <> ?",
        )
        .bind(actual_start)
        .bind(&segment.run_id)
        .bind(&segment.id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("close previous active pomodoro segment: {e}"))?;
    }
    sqlx::query(
        "INSERT INTO pomodoro_segments
            (id, event_id, event_date, run_id, cycle_number, phase,
             planned_start, planned_end, actual_start, actual_end, status, end_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    .bind(&segment.end_reason)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert pomodoro segment: {e}"))?;
    replace_segment_pauses(tx, &segment.id, &segment.pauses).await
}

async fn close_run_tx(
    tx: &mut Transaction<'_, Sqlite>,
    closure: &PomodoroRunClosure,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE pomodoro_pauses
         SET ended_at = ?
         WHERE ended_at IS NULL
           AND segment_id IN (
             SELECT id FROM pomodoro_segments WHERE run_id = ?
           )",
    )
    .bind(&closure.ended_at)
    .bind(&closure.run_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("close pomodoro pauses: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET status = ?, actual_end = COALESCE(actual_end, ?), end_reason = ?
         WHERE run_id = ? AND status = 'active'",
    )
    .bind(&closure.segment_status)
    .bind(&closure.ended_at)
    .bind(&closure.segment_end_reason)
    .bind(&closure.run_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("close active pomodoro segment: {e}"))?;

    let result = sqlx::query(
        "UPDATE pomodoro_runs
         SET ended_at = ?, end_reason = ?, last_heartbeat = ?
         WHERE id = ? AND ended_at IS NULL",
    )
    .bind(&closure.ended_at)
    .bind(&closure.end_reason)
    .bind(&closure.ended_at)
    .bind(&closure.run_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("close pomodoro run: {e}"))?;
    if result.rows_affected() == 0 {
        return Err(format!("open pomodoro run not found: {}", closure.run_id));
    }

    insert_run_event_tx(
        tx,
        RunEventInsert {
            run_id: &closure.run_id,
            segment_id: None,
            event_type: &closure.event_type,
            occurred_at: &closure.ended_at,
            phase: None,
            reason: Some(&closure.end_reason),
            duration_seconds: None,
        },
    )
    .await
}

async fn load_segment_event_context(
    tx: &mut Transaction<'_, Sqlite>,
    segment_id: &str,
) -> Result<SegmentEventContext, String> {
    let row = sqlx::query(
        "SELECT run_id, phase, status, planned_end
         FROM pomodoro_segments
         WHERE id = ?",
    )
    .bind(segment_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("load pomodoro segment event context: {e}"))?;
    Ok(SegmentEventContext {
        run_id: row
            .try_get("run_id")
            .map_err(|e| format!("read segment run_id: {e}"))?,
        phase: row
            .try_get("phase")
            .map_err(|e| format!("read segment phase: {e}"))?,
        status: row
            .try_get("status")
            .map_err(|e| format!("read segment status: {e}"))?,
        planned_end: row
            .try_get("planned_end")
            .map_err(|e| format!("read segment planned_end: {e}"))?,
    })
}

async fn load_existing_pauses(
    tx: &mut Transaction<'_, Sqlite>,
    segment_id: &str,
) -> Result<Vec<ExistingPause>, String> {
    let rows = sqlx::query(
        "SELECT started_at, ended_at, reason
         FROM pomodoro_pauses
         WHERE segment_id = ?
         ORDER BY started_at ASC",
    )
    .bind(segment_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| format!("load existing pomodoro pauses: {e}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(ExistingPause {
                started_at: row
                    .try_get("started_at")
                    .map_err(|e| format!("read existing pause started_at: {e}"))?,
                ended_at: row
                    .try_get("ended_at")
                    .map_err(|e| format!("read existing pause ended_at: {e}"))?,
                reason: row
                    .try_get("reason")
                    .map_err(|e| format!("read existing pause reason: {e}"))?,
            })
        })
        .collect()
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

async fn log_segment_update_events(
    tx: &mut Transaction<'_, Sqlite>,
    context: &SegmentEventContext,
    segment: &PomodoroSegmentUpdate,
    previous_pauses: &[ExistingPause],
) -> Result<(), String> {
    let occurred_at = segment
        .occurred_at
        .as_deref()
        .or(segment.actual_end.as_deref())
        .or(segment.actual_start.as_deref())
        .unwrap_or(&segment.planned_end);

    if context.status == "active" && segment.status == "completed" {
        insert_run_event_tx(
            tx,
            RunEventInsert {
                run_id: &context.run_id,
                segment_id: Some(&segment.id),
                event_type: "phase_complete",
                occurred_at,
                phase: Some(&context.phase),
                reason: segment.end_reason.as_deref(),
                duration_seconds: None,
            },
        )
        .await?;
    }

    if context.phase == "focus" && context.planned_end != segment.planned_end {
        insert_run_event_tx(
            tx,
            RunEventInsert {
                run_id: &context.run_id,
                segment_id: Some(&segment.id),
                event_type: "extend_focus",
                occurred_at,
                phase: Some(&context.phase),
                reason: None,
                duration_seconds: iso_seconds_between(&context.planned_end, &segment.planned_end),
            },
        )
        .await?;
    }

    for pause in &segment.pauses {
        let previous = previous_pauses
            .iter()
            .find(|old| old.started_at == pause.started_at && old.reason == pause.reason);
        if previous.is_none() {
            insert_pause_start_events(tx, &context.run_id, &segment.id, &context.phase, pause)
                .await?;
            if let Some(ended_at) = &pause.ended_at {
                insert_run_event_tx(
                    tx,
                    RunEventInsert {
                        run_id: &context.run_id,
                        segment_id: Some(&segment.id),
                        event_type: "pause_end",
                        occurred_at: ended_at,
                        phase: Some(&context.phase),
                        reason: Some(&pause.reason),
                        duration_seconds: None,
                    },
                )
                .await?;
            }
            continue;
        }

        if previous.and_then(|old| old.ended_at.as_ref()).is_none() && pause.ended_at.is_some() {
            let ended_at = pause.ended_at.as_deref().unwrap_or(occurred_at);
            insert_run_event_tx(
                tx,
                RunEventInsert {
                    run_id: &context.run_id,
                    segment_id: Some(&segment.id),
                    event_type: "pause_end",
                    occurred_at: ended_at,
                    phase: Some(&context.phase),
                    reason: Some(&pause.reason),
                    duration_seconds: None,
                },
            )
            .await?;
        }
    }
    Ok(())
}

async fn log_new_pause_events(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    segment: &PomodoroSegmentWrite,
) -> Result<(), String> {
    for pause in &segment.pauses {
        insert_pause_start_events(tx, run_id, &segment.id, &segment.phase, pause).await?;
        if let Some(ended_at) = &pause.ended_at {
            insert_run_event_tx(
                tx,
                RunEventInsert {
                    run_id,
                    segment_id: Some(&segment.id),
                    event_type: "pause_end",
                    occurred_at: ended_at,
                    phase: Some(&segment.phase),
                    reason: Some(&pause.reason),
                    duration_seconds: None,
                },
            )
            .await?;
        }
    }
    Ok(())
}

async fn insert_pause_start_events(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    segment_id: &str,
    phase: &str,
    pause: &PomodoroPauseWrite,
) -> Result<(), String> {
    insert_run_event_tx(
        tx,
        RunEventInsert {
            run_id,
            segment_id: Some(segment_id),
            event_type: "pause_start",
            occurred_at: &pause.started_at,
            phase: Some(phase),
            reason: Some(&pause.reason),
            duration_seconds: None,
        },
    )
    .await?;
    if pause.reason == "idle" {
        insert_run_event_tx(
            tx,
            RunEventInsert {
                run_id,
                segment_id: Some(segment_id),
                event_type: "idle_detected",
                occurred_at: &pause.started_at,
                phase: Some(phase),
                reason: Some(&pause.reason),
                duration_seconds: None,
            },
        )
        .await?;
    }
    if pause.reason == "suspend" {
        insert_run_event_tx(
            tx,
            RunEventInsert {
                run_id,
                segment_id: Some(segment_id),
                event_type: "suspend_detected",
                occurred_at: &pause.started_at,
                phase: Some(phase),
                reason: Some(&pause.reason),
                duration_seconds: None,
            },
        )
        .await?;
    }
    Ok(())
}

async fn insert_run_event_tx(
    tx: &mut Transaction<'_, Sqlite>,
    event: RunEventInsert<'_>,
) -> Result<(), String> {
    validate_event_type(event.event_type)?;
    if let Some(phase) = event.phase {
        validate_phase(phase)?;
    }
    sqlx::query(
        "INSERT INTO pomodoro_run_events
            (id, run_id, segment_id, event_type, occurred_at, phase, reason, duration_seconds)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(event.run_id)
    .bind(event.segment_id)
    .bind(event.event_type)
    .bind(event.occurred_at)
    .bind(event.phase)
    .bind(event.reason)
    .bind(event.duration_seconds)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert pomodoro run event: {e}"))?;
    Ok(())
}

fn validate_run_write(run: &PomodoroRunWrite) -> Result<(), String> {
    require_non_empty(&run.id, "run.id")?;
    canonical_event_id(&run.event_id)?;
    require_non_empty(&run.event_date, "run.event_date")?;
    require_non_empty(&run.planned_start, "run.planned_start")?;
    require_non_empty(&run.planned_end, "run.planned_end")?;
    require_non_empty(&run.started_at, "run.started_at")?;
    validate_config_minutes(run.focus_duration_minutes, "focus_duration_minutes")?;
    validate_config_minutes(run.short_break_minutes, "short_break_minutes")?;
    validate_config_minutes(run.long_break_minutes, "long_break_minutes")?;
    validate_config_minutes(run.pomodoro_count, "pomodoro_count")?;
    if let Some(idle_timeout) = run.idle_timeout_minutes {
        if idle_timeout < 0 {
            return Err("idle_timeout_minutes cannot be negative".to_string());
        }
    }
    if run.inherited_focus_minutes < 0 {
        return Err("inherited_focus_minutes cannot be negative".to_string());
    }
    if run.inherited_cycle <= 0 {
        return Err("inherited_cycle must be positive".to_string());
    }
    validate_start_trigger(&run.start_trigger)
}

fn validate_run_closure(closure: &PomodoroRunClosure) -> Result<(), String> {
    require_non_empty(&closure.run_id, "closure.run_id")?;
    require_non_empty(&closure.ended_at, "closure.ended_at")?;
    validate_run_end_reason(&closure.end_reason)?;
    validate_status(&closure.segment_status)?;
    validate_segment_end_reason(&closure.segment_end_reason)?;
    validate_event_type(&closure.event_type)
}

fn validate_run_window_update(update: &PomodoroRunWindowUpdate) -> Result<(), String> {
    require_non_empty(&update.run_id, "update.run_id")?;
    require_non_empty(&update.planned_end, "update.planned_end")
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
    if segment.actual_start.is_none() {
        return Err("actual_start is required for persisted pomodoro segments".to_string());
    }
    validate_status(&segment.status)?;
    if let Some(reason) = &segment.end_reason {
        validate_segment_end_reason(reason)?;
    }
    for pause in &segment.pauses {
        validate_pause(pause)?;
    }
    Ok(())
}

fn validate_segment_update(segment: &PomodoroSegmentUpdate) -> Result<(), String> {
    require_non_empty(&segment.id, "id")?;
    require_non_empty(&segment.planned_end, "planned_end")?;
    validate_status(&segment.status)?;
    if let Some(reason) = &segment.end_reason {
        validate_segment_end_reason(reason)?;
    }
    for pause in &segment.pauses {
        validate_pause(pause)?;
    }
    Ok(())
}

fn validate_run_event_write(event: &PomodoroRunEventWrite) -> Result<(), String> {
    require_non_empty(&event.run_id, "event.run_id")?;
    validate_event_type(&event.event_type)?;
    require_non_empty(&event.occurred_at, "event.occurred_at")?;
    if let Some(phase) = &event.phase {
        validate_phase(phase)?;
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
        "active" | "completed" | "interrupted" => Ok(()),
        _ => Err(format!("invalid pomodoro segment status: {status}")),
    }
}

fn validate_run_end_reason(reason: &str) -> Result<(), String> {
    match reason {
        "completed" | "stopped" | "interrupted" | "reconfigured" | "block_transition" => Ok(()),
        _ => Err(format!("invalid pomodoro run end reason: {reason}")),
    }
}

fn validate_segment_end_reason(reason: &str) -> Result<(), String> {
    match reason {
        "completed" | "stopped" | "skipped_by_user" | "event_expired" | "reconfigured"
        | "block_transition" | "crash_recovery" => Ok(()),
        _ => Err(format!("invalid pomodoro segment end reason: {reason}")),
    }
}

fn validate_start_trigger(trigger: &str) -> Result<(), String> {
    match trigger {
        "manual" | "block_auto" | "block_transition" | "reconfigure" | "crash_recovery" => Ok(()),
        _ => Err(format!("invalid pomodoro start trigger: {trigger}")),
    }
}

fn validate_event_type(event_type: &str) -> Result<(), String> {
    match event_type {
        "start" | "phase_start" | "phase_complete" | "pause_start" | "pause_end"
        | "idle_detected" | "suspend_detected" | "skip_break" | "extend_focus" | "reconfigure"
        | "block_transition" | "stop" | "complete" | "crash_recovery" => Ok(()),
        _ => Err(format!("invalid pomodoro run event type: {event_type}")),
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

fn iso_seconds_between(start: &str, end: &str) -> Option<i64> {
    let start = DateTime::parse_from_rfc3339(start).ok()?;
    let end = DateTime::parse_from_rfc3339(end).ok()?;
    Some((end - start).num_seconds())
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_event_id, validate_event_type, validate_pause_reason, validate_phase,
        validate_run_end_reason, validate_run_window_update, validate_segment_end_reason,
        validate_status, PomodoroRunWindowUpdate,
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
    fn validates_run_and_segment_end_reasons() {
        assert!(validate_run_end_reason("completed").is_ok());
        assert!(validate_run_end_reason("crash_recovery").is_err());
        assert!(validate_segment_end_reason("crash_recovery").is_ok());
        assert!(validate_segment_end_reason("unknown").is_err());
    }

    #[test]
    fn validates_run_window_update() {
        assert!(validate_run_window_update(&PomodoroRunWindowUpdate {
            run_id: "run-1".to_string(),
            planned_end: "2026-05-23T15:00:00Z".to_string(),
        })
        .is_ok());
        assert!(validate_run_window_update(&PomodoroRunWindowUpdate {
            run_id: String::new(),
            planned_end: "2026-05-23T15:00:00Z".to_string(),
        })
        .is_err());
    }

    #[test]
    fn validates_run_event_types() {
        assert!(validate_event_type("skip_break").is_ok());
        assert!(validate_event_type("extend_focus").is_ok());
        assert!(validate_event_type("unknown").is_err());
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
}
