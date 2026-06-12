use sqlx::Row;
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

use super::validation::{
    canonical_event_id, normalize_segment_update, require_non_empty, synthetic_event_date,
    validate_active_event_reference_transfer, validate_adaptive_decision_envelope_for_segment,
    validate_run_closure, validate_run_event_write, validate_run_window_update, validate_run_write,
    validate_segment_update, validate_segment_write,
};
use super::writes::{
    close_run_tx, insert_adaptive_decision_envelope_tx, insert_run_event_tx, insert_run_tx,
    insert_segment_tx, load_existing_pauses, load_segment_event_context, log_new_pause_events,
    log_segment_update_events, replace_segment_pauses, RunEventInsert,
};
use super::*;

pub(super) async fn pomodoro_start_run<R: Runtime>(
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

pub(super) async fn pomodoro_transition_run<R: Runtime>(
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

pub(super) async fn pomodoro_insert_segments<R: Runtime>(
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

pub(super) async fn pomodoro_insert_segment_with_adaptive_decision<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    segment: PomodoroSegmentWrite,
    adaptive_decision: PomodoroAdaptiveDecisionEnvelopeWrite,
) -> Result<(), String> {
    validate_segment_write(&segment)?;
    validate_adaptive_decision_envelope_for_segment(&adaptive_decision, &segment)?;

    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    insert_segment_tx(&mut tx, &segment).await?;
    insert_adaptive_decision_envelope_tx(&mut tx, &adaptive_decision).await?;
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

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

pub(super) async fn pomodoro_update_segments<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    segments: Vec<PomodoroSegmentUpdate>,
) -> Result<(), String> {
    let segments = segments
        .into_iter()
        .map(normalize_segment_update)
        .collect::<Vec<_>>();
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

pub(super) async fn pomodoro_close_run<R: Runtime>(
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

pub(super) async fn pomodoro_update_run_window<R: Runtime>(
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

pub(super) async fn pomodoro_transfer_active_event_reference<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    transfer: PomodoroActiveEventReferenceTransfer,
) -> Result<(), String> {
    validate_active_event_reference_transfer(&transfer)?;
    let canonical_event_id = canonical_event_id(&transfer.new_event_id)?.to_string();
    let event_date = transfer
        .new_event_date
        .clone()
        .or_else(|| synthetic_event_date(&transfer.new_event_id).map(str::to_string));
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;

    let run_id: Option<String> =
        sqlx::query_scalar("SELECT id FROM pomodoro_runs WHERE ended_at IS NULL LIMIT 1")
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| format!("load active pomodoro run: {e}"))?;
    let Some(run_id) = run_id else {
        tx.commit().await.map_err(|e| format!("commit: {e}"))?;
        return Ok(());
    };

    sqlx::query(
        "UPDATE pomodoro_runs
         SET event_id = ?,
             original_event_id = ?,
             event_date = COALESCE(?, event_date),
             planned_end = COALESCE(?, planned_end)
         WHERE id = ? AND ended_at IS NULL",
    )
    .bind(&canonical_event_id)
    .bind(&transfer.new_event_id)
    .bind(&event_date)
    .bind(&transfer.planned_end)
    .bind(&run_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("transfer active pomodoro run reference: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET event_id = ?,
             event_date = COALESCE(?, event_date)
         WHERE run_id = ?",
    )
    .bind(&canonical_event_id)
    .bind(&event_date)
    .bind(&run_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("transfer active pomodoro segment references: {e}"))?;

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

pub(super) async fn pomodoro_heartbeat<R: Runtime>(
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

pub(super) async fn pomodoro_record_run_event<R: Runtime>(
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

pub(super) async fn pomodoro_recover_open_runs<R: Runtime>(
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
