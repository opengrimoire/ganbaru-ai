use chrono::{DateTime, Duration, SecondsFormat, Utc};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};

use super::read_budget::RecoveryBudget;
use super::writes::close_run_tx;
use super::{
    PomodoroMobileRecoveryRead, PomodoroPauseWrite, PomodoroRecoveredRunRead,
    PomodoroRecoveredSegmentRead, PomodoroRunClosure, PomodoroRunRhythm, PomodoroRunSequenceStep,
};

const RECOVERY_REASON_MULTIPLE_OPEN_RUNS: &str = "multiple_open_runs";
const RECOVERY_REASON_INVALID_STATE: &str = "invalid_state";
const RECOVERY_REASON_RUN_WINDOW_EXPIRED: &str = "run_window_expired";
const RECOVERY_REASON_PHASE_EXPIRED: &str = "phase_expired";

struct OpenRunRow {
    id: String,
    event_id: Option<String>,
    original_event_id: String,
    event_title_snapshot: Option<String>,
    event_date: String,
    planned_start: String,
    planned_end: String,
    started_at: String,
    rhythm_kind: String,
    rhythm_source: String,
    preset_key: Option<String>,
    idle_timeout_minutes: Option<i64>,
    last_heartbeat: String,
}

struct ActiveSegmentRow {
    id: String,
    event_id: Option<String>,
    event_date: String,
    rhythm_position: i64,
    phase: String,
    planned_start: String,
    planned_end: String,
    actual_start: String,
}

enum CandidateDecision {
    Resume(Box<PomodoroRecoveredRunRead>),
    Close {
        reason: &'static str,
        ended_at: String,
        expired_window: bool,
    },
}

pub(super) async fn recover_mobile_run_from_pool(
    pool: &SqlitePool,
    now_at: &str,
) -> Result<PomodoroMobileRecoveryRead, String> {
    let now = parse_timestamp(now_at, "recovery now")?;
    let recovered_at = canonical_timestamp(now);
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("begin mobile pomodoro recovery: {error}"))?;
    admit_recovery(&mut tx).await?;
    let open_runs = load_open_runs(&mut tx).await?;

    if open_runs.is_empty() {
        tx.commit()
            .await
            .map_err(|error| format!("commit mobile pomodoro recovery: {error}"))?;
        return Ok(PomodoroMobileRecoveryRead::None);
    }

    if open_runs.len() > 1 {
        let mut closed_run_ids = Vec::with_capacity(open_runs.len());
        for run in &open_runs {
            let ended_at = safe_recovery_end(run, now);
            close_recovery_run(&mut tx, &run.id, &ended_at, false).await?;
            closed_run_ids.push(run.id.clone());
        }
        tx.commit()
            .await
            .map_err(|error| format!("commit mobile pomodoro recovery: {error}"))?;
        return Ok(PomodoroMobileRecoveryRead::Closed {
            reason: RECOVERY_REASON_MULTIPLE_OPEN_RUNS.to_string(),
            closed_run_ids,
        });
    }

    let run = &open_runs[0];
    let decision = decide_candidate(&mut tx, run, now, &recovered_at).await?;
    match decision {
        CandidateDecision::Resume(recovered_run) => {
            tx.commit()
                .await
                .map_err(|error| format!("commit mobile pomodoro recovery: {error}"))?;
            Ok(PomodoroMobileRecoveryRead::Resumed { run: recovered_run })
        }
        CandidateDecision::Close {
            reason,
            ended_at,
            expired_window,
        } => {
            close_recovery_run(&mut tx, &run.id, &ended_at, expired_window).await?;
            tx.commit()
                .await
                .map_err(|error| format!("commit mobile pomodoro recovery: {error}"))?;
            Ok(PomodoroMobileRecoveryRead::Closed {
                reason: reason.to_string(),
                closed_run_ids: vec![run.id.clone()],
            })
        }
    }
}

/// Bound the complete recovery closure before loading or closing any run.
/// Closed unrelated history never consumes startup recovery admission.
async fn admit_recovery(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    let mut budget = RecoveryBudget::default();
    budget.admit(tx,
        "SELECT id, event_id, original_event_id, event_date, event_title_snapshot,
            planned_start, planned_end, started_at, last_heartbeat, rhythm_kind, rhythm_source, preset_key
         FROM pomodoro_runs WHERE ended_at IS NULL",
        &["id", "event_id", "original_event_id", "event_date", "event_title_snapshot", "planned_start", "planned_end", "started_at", "last_heartbeat", "rhythm_kind", "rhythm_source", "preset_key"],
        "open runs").await?;
    budget.admit(tx,
        "SELECT s.id, s.event_id, s.event_date, s.run_id, s.phase, s.planned_start, s.planned_end, s.actual_start
         FROM pomodoro_runs r CROSS JOIN pomodoro_segments s ON s.run_id = r.id
         WHERE r.ended_at IS NULL",
        &["id", "event_id", "event_date", "run_id", "phase", "planned_start", "planned_end", "actual_start"],
        "run segments").await?;
    budget.admit(tx,
        "SELECT p.id, p.segment_id, p.started_at, p.ended_at, p.reason
         FROM pomodoro_runs r CROSS JOIN pomodoro_segments s ON s.run_id = r.id CROSS JOIN pomodoro_pauses p ON p.segment_id = s.id
         WHERE r.ended_at IS NULL",
        &["id", "segment_id", "started_at", "ended_at", "reason"],
        "run pauses").await?;
    budget
        .admit(
            tx,
            "SELECT steps.run_id, steps.break_phase FROM pomodoro_runs r
         CROSS JOIN pomodoro_run_sequence_steps steps ON steps.run_id = r.id WHERE r.ended_at IS NULL",
            &["run_id", "break_phase"],
            "sequence steps",
        )
        .await?;
    Ok(())
}

async fn load_open_runs(tx: &mut Transaction<'_, Sqlite>) -> Result<Vec<OpenRunRow>, String> {
    let rows = sqlx::query(
        "SELECT id, event_id, original_event_id, event_date, planned_start, planned_end,
                started_at, rhythm_kind, rhythm_source, preset_key,
                idle_timeout_minutes, last_heartbeat, event_title_snapshot
         FROM pomodoro_runs
         WHERE ended_at IS NULL
         ORDER BY started_at ASC, id ASC",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| format!("load open mobile pomodoro runs: {error}"))?;

    rows.into_iter()
        .map(|row| {
            Ok(OpenRunRow {
                id: row
                    .try_get("id")
                    .map_err(|error| format!("read open run id: {error}"))?,
                event_id: row
                    .try_get("event_id")
                    .map_err(|error| format!("read open run event id: {error}"))?,
                original_event_id: row
                    .try_get("original_event_id")
                    .map_err(|error| format!("read open run original event id: {error}"))?,
                event_title_snapshot: row
                    .try_get("event_title_snapshot")
                    .map_err(|error| format!("read open run event title: {error}"))?,
                event_date: row
                    .try_get("event_date")
                    .map_err(|error| format!("read open run event date: {error}"))?,
                planned_start: row
                    .try_get("planned_start")
                    .map_err(|error| format!("read open run planned start: {error}"))?,
                planned_end: row
                    .try_get("planned_end")
                    .map_err(|error| format!("read open run planned end: {error}"))?,
                started_at: row
                    .try_get("started_at")
                    .map_err(|error| format!("read open run start: {error}"))?,
                rhythm_kind: row
                    .try_get("rhythm_kind")
                    .map_err(|error| format!("read open run rhythm kind: {error}"))?,
                rhythm_source: row
                    .try_get("rhythm_source")
                    .map_err(|error| format!("read open run rhythm source: {error}"))?,
                preset_key: row
                    .try_get("preset_key")
                    .map_err(|error| format!("read open run preset key: {error}"))?,
                idle_timeout_minutes: row
                    .try_get("idle_timeout_minutes")
                    .map_err(|error| format!("read open run idle timeout: {error}"))?,
                last_heartbeat: row
                    .try_get("last_heartbeat")
                    .map_err(|error| format!("read open run heartbeat: {error}"))?,
            })
        })
        .collect()
}

async fn decide_candidate(
    tx: &mut Transaction<'_, Sqlite>,
    run: &OpenRunRow,
    now: DateTime<Utc>,
    recovered_at: &str,
) -> Result<CandidateDecision, String> {
    let invalid_end = || CandidateDecision::Close {
        reason: RECOVERY_REASON_INVALID_STATE,
        ended_at: safe_recovery_end(run, now),
        expired_window: false,
    };

    let Ok(planned_start) = parse_utc_timestamp(&run.planned_start) else {
        return Ok(invalid_end());
    };
    let Ok(planned_end) = parse_utc_timestamp(&run.planned_end) else {
        return Ok(invalid_end());
    };
    let Ok(started_at) = parse_utc_timestamp(&run.started_at) else {
        return Ok(invalid_end());
    };
    let Ok(last_heartbeat) = parse_utc_timestamp(&run.last_heartbeat) else {
        return Ok(invalid_end());
    };
    if planned_start >= planned_end
        || started_at < planned_start
        || started_at > now
        || last_heartbeat < started_at
        || last_heartbeat > now
        || run
            .event_id
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        || run.original_event_id.trim().is_empty()
        || run.event_date.trim().is_empty()
        || !valid_run_settings(run)
    {
        return Ok(invalid_end());
    }
    let segments = load_active_segments(tx, &run.id).await?;
    if segments.len() != 1 {
        return Ok(invalid_end());
    }
    let segment = &segments[0];
    let Ok(segment_planned_start) = parse_utc_timestamp(&segment.planned_start) else {
        return Ok(invalid_end());
    };
    let Ok(segment_planned_end) = parse_utc_timestamp(&segment.planned_end) else {
        return Ok(invalid_end());
    };
    let Ok(actual_start) = parse_utc_timestamp(&segment.actual_start) else {
        return Ok(invalid_end());
    };
    if segment.event_id != run.event_id
        || segment.event_date != run.event_date
        || segment_planned_start >= segment_planned_end
        || actual_start < started_at
        || actual_start > now
        || !matches!(
            segment.phase.as_str(),
            "focus" | "short_break" | "long_break"
        )
        || segment.rhythm_position <= 0
    {
        return Ok(invalid_end());
    }

    let Some(rhythm) = load_rhythm(tx, run).await? else {
        return Ok(invalid_end());
    };
    if super::validation::validate_run_rhythm(&rhythm).is_err()
        || !rhythm_phase_is_valid(&rhythm, segment.rhythm_position, &segment.phase)
    {
        return Ok(invalid_end());
    }

    let Some(pauses) = load_active_segment_pauses(tx, &run.id, &segment.id).await? else {
        return Ok(invalid_end());
    };
    let Some(pause_timing) = validate_pause_timing(&pauses, actual_start, now) else {
        return Ok(invalid_end());
    };
    let work_duration = segment_planned_end - segment_planned_start;
    let elapsed_until = pause_timing.open_started_at.unwrap_or(now);
    let work_elapsed = elapsed_until - actual_start - pause_timing.closed_duration;
    if work_duration <= Duration::zero() || work_elapsed < Duration::zero() {
        return Ok(invalid_end());
    }
    // A recovery can account for the accepted phase only, even when the whole
    // calendar window elapsed while the app was absent.
    let open_pause_duration = pause_timing
        .open_started_at
        .map_or(Duration::zero(), |start| now - start);
    let accepted_phase_end =
        actual_start + work_duration + pause_timing.closed_duration + open_pause_duration;
    if now >= planned_end {
        return Ok(CandidateDecision::Close {
            reason: RECOVERY_REASON_RUN_WINDOW_EXPIRED,
            ended_at: canonical_timestamp(accepted_phase_end.min(planned_end)),
            expired_window: true,
        });
    }
    if work_elapsed >= work_duration {
        if pause_timing.open_started_at.is_some() {
            return Ok(invalid_end());
        }
        let phase_end = actual_start + work_duration + pause_timing.closed_duration;
        return Ok(CandidateDecision::Close {
            reason: RECOVERY_REASON_PHASE_EXPIRED,
            ended_at: canonical_timestamp(phase_end.min(planned_end)),
            expired_window: false,
        });
    }

    let remaining_work = work_duration - work_elapsed;
    let remaining_window = planned_end - now;
    let visible_remaining = remaining_work.min(remaining_window);
    if visible_remaining <= Duration::zero() {
        return Ok(CandidateDecision::Close {
            reason: RECOVERY_REASON_RUN_WINDOW_EXPIRED,
            ended_at: canonical_timestamp(planned_end),
            expired_window: true,
        });
    }

    let completed_focus_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)
         FROM pomodoro_segments
         WHERE run_id = ? AND phase = 'focus' AND status = 'completed'",
    )
    .bind(&run.id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| format!("count recovered focus segments: {error}"))?;
    let focus_extension_used = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)
         FROM pomodoro_run_events
         WHERE run_id = ? AND segment_id = ? AND event_type = 'extend_focus'",
    )
    .bind(&run.id)
    .bind(&segment.id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| format!("load recovered focus extension state: {error}"))?
        > 0;

    let work_duration_seconds = duration_seconds_ceil(work_duration);
    let work_elapsed_seconds = work_elapsed.num_seconds().max(0);
    let visible_remaining_seconds = duration_seconds_ceil(visible_remaining);
    let open_pause_reason = pauses
        .last()
        .filter(|pause| pause.ended_at.is_none())
        .map(|pause| pause.reason.clone());

    Ok(CandidateDecision::Resume(Box::new(
        PomodoroRecoveredRunRead {
            run_id: run.id.clone(),
            block_id: run.original_event_id.clone(),
            event_title: run.event_title_snapshot.clone(),
            event_date: run.event_date.clone(),
            planned_end: canonical_timestamp(planned_end),
            started_at: canonical_timestamp(started_at),
            recovered_at: recovered_at.to_string(),
            rhythm,
            rhythm_source: run.rhythm_source.clone(),
            preset_key: run.preset_key.clone(),
            idle_timeout_minutes: run.idle_timeout_minutes,
            segment: PomodoroRecoveredSegmentRead {
                id: segment.id.clone(),
                event_id: run.original_event_id.clone(),
                event_date: segment.event_date.clone(),
                run_id: run.id.clone(),
                rhythm_position: segment.rhythm_position,
                phase: segment.phase.clone(),
                planned_start: canonical_timestamp(segment_planned_start),
                planned_end: canonical_timestamp(segment_planned_end),
                actual_start: canonical_timestamp(actual_start),
                actual_end: None,
                status: "active".to_string(),
                pause_log: pauses,
            },
            completed_focus_count,
            phase_elapsed_seconds: work_elapsed_seconds,
            phase_work_duration_seconds: work_duration_seconds,
            remaining_seconds: visible_remaining_seconds,
            is_running: open_pause_reason.is_none(),
            focus_extension_used,
            open_pause_reason,
        },
    )))
}

fn valid_run_settings(run: &OpenRunRow) -> bool {
    let valid_rhythm_source = match run.rhythm_source.as_str() {
        "preset" => matches!(
            run.preset_key.as_deref(),
            Some("adaptive" | "creative" | "balanced" | "deep" | "extended")
        ),
        "custom" => run.preset_key.is_none(),
        _ => false,
    };
    let valid_idle_timeout = run
        .idle_timeout_minutes
        .map(|minutes| minutes > 0)
        .unwrap_or(true);
    valid_rhythm_source && valid_idle_timeout
}

async fn load_active_segments(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
) -> Result<Vec<ActiveSegmentRow>, String> {
    let rows = sqlx::query(
        "SELECT id, event_id, event_date, rhythm_position, phase, planned_start, planned_end,
                actual_start
         FROM pomodoro_segments
         WHERE run_id = ? AND status = 'active'
         ORDER BY actual_start ASC, id ASC",
    )
    .bind(run_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| format!("load active mobile pomodoro segments: {error}"))?;

    rows.into_iter()
        .map(|row| {
            Ok(ActiveSegmentRow {
                id: row
                    .try_get("id")
                    .map_err(|error| format!("read active segment id: {error}"))?,
                event_id: row
                    .try_get("event_id")
                    .map_err(|error| format!("read active segment event id: {error}"))?,
                event_date: row
                    .try_get("event_date")
                    .map_err(|error| format!("read active segment event date: {error}"))?,
                rhythm_position: row
                    .try_get("rhythm_position")
                    .map_err(|error| format!("read active segment rhythm position: {error}"))?,
                phase: row
                    .try_get("phase")
                    .map_err(|error| format!("read active segment phase: {error}"))?,
                planned_start: row
                    .try_get("planned_start")
                    .map_err(|error| format!("read active segment planned start: {error}"))?,
                planned_end: row
                    .try_get("planned_end")
                    .map_err(|error| format!("read active segment planned end: {error}"))?,
                actual_start: row
                    .try_get("actual_start")
                    .map_err(|error| format!("read active segment actual start: {error}"))?,
            })
        })
        .collect()
}

async fn load_active_segment_pauses(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    active_segment_id: &str,
) -> Result<Option<Vec<PomodoroPauseWrite>>, String> {
    let stray_open_pause_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)
         FROM pomodoro_pauses p
         JOIN pomodoro_segments s ON s.id = p.segment_id
         WHERE s.run_id = ? AND p.ended_at IS NULL AND p.segment_id <> ?",
    )
    .bind(run_id)
    .bind(active_segment_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| format!("count stray recovered pomodoro pauses: {error}"))?;
    if stray_open_pause_count > 0 {
        return Ok(None);
    }

    let rows = sqlx::query(
        "SELECT started_at, ended_at, reason
         FROM pomodoro_pauses
         WHERE segment_id = ?
         ORDER BY started_at ASC, id ASC",
    )
    .bind(active_segment_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| format!("load recovered pomodoro pauses: {error}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(PomodoroPauseWrite {
                started_at: row
                    .try_get("started_at")
                    .map_err(|error| format!("read recovered pause start: {error}"))?,
                ended_at: row
                    .try_get("ended_at")
                    .map_err(|error| format!("read recovered pause end: {error}"))?,
                reason: row
                    .try_get("reason")
                    .map_err(|error| format!("read recovered pause reason: {error}"))?,
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}

struct PauseTiming {
    closed_duration: Duration,
    open_started_at: Option<DateTime<Utc>>,
}

fn validate_pause_timing(
    pauses: &[PomodoroPauseWrite],
    actual_start: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Option<PauseTiming> {
    let mut closed_duration = Duration::zero();
    let mut previous_end = actual_start;
    let mut open_started_at = None;

    for (index, pause) in pauses.iter().enumerate() {
        if !matches!(pause.reason.as_str(), "idle" | "manual" | "suspend") {
            return None;
        }
        let started_at = parse_utc_timestamp(&pause.started_at).ok()?;
        if started_at < previous_end || started_at > now || open_started_at.is_some() {
            return None;
        }
        match pause.ended_at.as_deref() {
            Some(value) => {
                let ended_at = parse_utc_timestamp(value).ok()?;
                if ended_at < started_at || ended_at > now {
                    return None;
                }
                closed_duration += ended_at - started_at;
                previous_end = ended_at;
            }
            None => {
                if index + 1 != pauses.len() {
                    return None;
                }
                open_started_at = Some(started_at);
            }
        }
    }

    Some(PauseTiming {
        closed_duration,
        open_started_at,
    })
}

async fn load_rhythm(
    tx: &mut Transaction<'_, Sqlite>,
    run: &OpenRunRow,
) -> Result<Option<PomodoroRunRhythm>, String> {
    match run.rhythm_kind.as_str() {
        "count" => {
            let row = sqlx::query(
                "SELECT focus_duration_minutes, short_break_minutes,
                        long_break_minutes, long_break_after_focus_count
                 FROM pomodoro_run_count_rhythms
                 WHERE run_id = ?",
            )
            .bind(&run.id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|error| format!("load recovered count rhythm: {error}"))?;
            let Some(row) = row else {
                return Ok(None);
            };
            Ok(Some(PomodoroRunRhythm::Count {
                focus_duration_minutes: row
                    .try_get("focus_duration_minutes")
                    .map_err(|error| format!("read recovered focus duration: {error}"))?,
                short_break_minutes: row
                    .try_get("short_break_minutes")
                    .map_err(|error| format!("read recovered short break duration: {error}"))?,
                long_break_minutes: row
                    .try_get("long_break_minutes")
                    .map_err(|error| format!("read recovered long break duration: {error}"))?,
                long_break_after_focus_count: row
                    .try_get("long_break_after_focus_count")
                    .map_err(|error| format!("read recovered long break cadence: {error}"))?,
            }))
        }
        "sequence" => {
            let rows = sqlx::query(
                "SELECT step_index, focus_duration_minutes, break_phase,
                        break_duration_minutes
                 FROM pomodoro_run_sequence_steps
                 WHERE run_id = ?
                 ORDER BY step_index ASC",
            )
            .bind(&run.id)
            .fetch_all(&mut **tx)
            .await
            .map_err(|error| format!("load recovered sequence rhythm: {error}"))?;
            if rows.is_empty() {
                return Ok(None);
            }
            let mut steps = Vec::with_capacity(rows.len());
            for (expected_index, row) in rows.into_iter().enumerate() {
                let step_index: i64 = row
                    .try_get("step_index")
                    .map_err(|error| format!("read recovered sequence index: {error}"))?;
                if step_index != expected_index as i64 {
                    return Ok(None);
                }
                steps.push(PomodoroRunSequenceStep {
                    focus_duration_minutes: row.try_get("focus_duration_minutes").map_err(
                        |error| format!("read recovered sequence focus duration: {error}"),
                    )?,
                    break_phase: row
                        .try_get("break_phase")
                        .map_err(|error| format!("read recovered sequence break phase: {error}"))?,
                    break_duration_minutes: row.try_get("break_duration_minutes").map_err(
                        |error| format!("read recovered sequence break duration: {error}"),
                    )?,
                });
            }
            Ok(Some(PomodoroRunRhythm::Sequence { steps }))
        }
        _ => Ok(None),
    }
}

fn rhythm_phase_is_valid(rhythm: &PomodoroRunRhythm, position: i64, phase: &str) -> bool {
    if position <= 0 {
        return false;
    }
    match rhythm {
        PomodoroRunRhythm::Count {
            long_break_after_focus_count,
            ..
        } => {
            if position > *long_break_after_focus_count {
                return false;
            }
            phase == "focus"
                || (phase == "long_break" && position == *long_break_after_focus_count)
                || (phase == "short_break" && position < *long_break_after_focus_count)
        }
        PomodoroRunRhythm::Sequence { steps } => {
            let Some(step) = usize::try_from(position - 1)
                .ok()
                .and_then(|index| steps.get(index))
            else {
                return false;
            };
            phase == "focus" || phase == step.break_phase
        }
    }
}

async fn close_recovery_run(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    ended_at: &str,
    expired_window: bool,
) -> Result<(), String> {
    let closure = if expired_window {
        PomodoroRunClosure {
            run_id: run_id.to_string(),
            ended_at: ended_at.to_string(),
            end_reason: "completed".to_string(),
            segment_status: "interrupted".to_string(),
            segment_end_reason: "event_expired".to_string(),
            event_type: "complete".to_string(),
        }
    } else {
        PomodoroRunClosure {
            run_id: run_id.to_string(),
            ended_at: ended_at.to_string(),
            end_reason: "interrupted".to_string(),
            segment_status: "interrupted".to_string(),
            segment_end_reason: "crash_recovery".to_string(),
            event_type: "crash_recovery".to_string(),
        }
    };
    close_run_tx(tx, &closure).await
}

fn safe_recovery_end(run: &OpenRunRow, now: DateTime<Utc>) -> String {
    let mut ended_at = parse_utc_timestamp(&run.last_heartbeat)
        .ok()
        .filter(|heartbeat| *heartbeat <= now)
        .unwrap_or(now);
    if let Ok(planned_end) = parse_utc_timestamp(&run.planned_end) {
        ended_at = ended_at.min(planned_end);
    }
    canonical_timestamp(ended_at)
}

fn parse_timestamp(value: &str, label: &str) -> Result<DateTime<Utc>, String> {
    parse_utc_timestamp(value).map_err(|_| format!("{label} must be an RFC 3339 timestamp"))
}

fn parse_utc_timestamp(value: &str) -> Result<DateTime<Utc>, chrono::ParseError> {
    DateTime::parse_from_rfc3339(value).map(|timestamp| timestamp.with_timezone(&Utc))
}

fn canonical_timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn duration_seconds_ceil(duration: Duration) -> i64 {
    let milliseconds = duration.num_milliseconds().max(0);
    milliseconds.saturating_add(999) / 1_000
}
