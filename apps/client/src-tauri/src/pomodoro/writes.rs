use std::collections::HashMap;

use chrono::{Duration, NaiveDate};
use sqlx::{Row, Sqlite, Transaction};

use super::time::{bounded_overlap_seconds, iso_is_before, iso_seconds_between};
use super::validation::{
    canonical_event_id, validate_event_type, validate_pause, validate_phase,
    validate_run_adaptive_snapshot_for_segment,
};
use super::*;

pub(super) struct SegmentEventContext {
    run_id: String,
    phase: String,
    status: String,
    planned_end: String,
}

pub(super) struct ExistingPause {
    started_at: String,
    ended_at: Option<String>,
    reason: String,
}

pub(super) struct RunEventInsert<'a> {
    pub(super) run_id: &'a str,
    pub(super) segment_id: Option<&'a str>,
    pub(super) event_type: &'a str,
    pub(super) occurred_at: &'a str,
    pub(super) phase: Option<&'a str>,
    pub(super) reason: Option<&'a str>,
    pub(super) duration_seconds: Option<i64>,
}

struct AdaptiveRunSnapshotForClose {
    policy_id: String,
    decision_id: String,
    context_key: String,
    state_scores: PomodoroAdaptiveStateScoresWrite,
}

#[derive(Default)]
struct AdaptiveRunOutcomeSummary {
    segments: Vec<AdaptiveSegmentOutcomeSummary>,
    completed_focus_segments: i64,
    interrupted_focus_segments: i64,
    focus_failure_count: i64,
    clean_focus_seconds: i64,
    planned_focus_seconds: i64,
    idle_pause_count: i64,
    idle_pause_seconds: i64,
    manual_pause_count: i64,
    manual_pause_seconds: i64,
    suspend_pause_count: i64,
    suspend_pause_seconds: i64,
    break_started_count: i64,
    break_completed_count: i64,
    break_skipped_count: i64,
    short_break_overtime_seconds: i64,
    long_break_overtime_seconds: i64,
    blocked_attempt_count: i64,
}

struct AdaptiveSegmentOutcomeSummary {
    segment_id: String,
    phase: String,
    status: String,
    end_reason: Option<String>,
    measured_at: String,
    planned_seconds: i64,
    actual_seconds: i64,
    clean_focus_seconds: i64,
    idle_pause_count: i64,
    idle_pause_seconds: i64,
    manual_pause_count: i64,
    manual_pause_seconds: i64,
    suspend_pause_count: i64,
    suspend_pause_seconds: i64,
    break_overtime_seconds: i64,
    blocked_attempt_count: i64,
}

#[derive(Default)]
struct AdaptiveNextDayOutcomeSummary {
    run_count: i64,
    completed_run_count: i64,
    stopped_run_count: i64,
    clean_focus_seconds: i64,
    completed_focus_segments: i64,
    interrupted_focus_segments: i64,
    focus_failure_count: i64,
    break_skipped_count: i64,
    break_overtime_seconds: i64,
    blocked_attempt_count: i64,
}

#[derive(Default)]
struct AdaptiveDayOutcomeSummary {
    run_count: i64,
    completed_run_count: i64,
    stopped_run_count: i64,
    clean_focus_seconds: i64,
    completed_focus_segments: i64,
    interrupted_focus_segments: i64,
    focus_failure_count: i64,
    break_skipped_count: i64,
    break_overtime_seconds: i64,
    blocked_attempt_count: i64,
    planned_pomodoro_event_count: i64,
    started_planned_pomodoro_event_count: i64,
    missed_planned_pomodoro_event_count: i64,
    planned_pomodoro_minutes: i64,
}

struct AdaptivePlannedPomodoroBlock {
    event_id: Option<String>,
    original_event_id: String,
    planned_start: String,
    planned_end: String,
    source_kind: String,
}

struct AdaptiveDecisionForPhaseOutcome {
    decision_id: String,
    segment_id: String,
}

struct AdaptiveDecisionForNextDayOutcome {
    decision_id: String,
    event_date: String,
}

struct AdaptiveDecisionForDayOutcome {
    decision_id: String,
    event_date: String,
}

pub(super) async fn insert_run_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run: &PomodoroRunWrite,
    initial_segment: &PomodoroSegmentWrite,
) -> Result<(), String> {
    validate_run_adaptive_snapshot_for_segment(run, initial_segment)?;
    let canonical_event_id = canonical_event_id(&run.event_id)?.to_string();
    sqlx::query(
        "INSERT INTO pomodoro_runs
            (id, event_id, original_event_id, event_date, planned_start, planned_end,
             started_at, rhythm_kind, rhythm_source, preset_key,
             idle_timeout_minutes, last_heartbeat, event_title_snapshot,
             inherited_focus_minutes, inherited_rhythm_position, inherited_from_run_id, start_trigger)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&run.id)
    .bind(&canonical_event_id)
    .bind(&run.event_id)
    .bind(&run.event_date)
    .bind(&run.planned_start)
    .bind(&run.planned_end)
    .bind(&run.started_at)
    .bind(run_rhythm_kind(&run.rhythm))
    .bind(&run.rhythm_source)
    .bind(&run.preset_key)
    .bind(run.idle_timeout_minutes)
    .bind(&run.started_at)
    .bind(&run.event_title_snapshot)
    .bind(run.inherited_focus_minutes)
    .bind(run.inherited_rhythm_position)
    .bind(&run.inherited_from_run_id)
    .bind(&run.start_trigger)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert pomodoro run: {e}"))?;

    insert_run_rhythm_snapshot_tx(tx, run).await?;

    if let Some(snapshot) = &run.adaptive_snapshot {
        if snapshot.planned_blocks.is_empty() {
            capture_adaptive_planned_blocks_for_day_tx(
                tx,
                &run.id,
                &run.event_date,
                &run.started_at,
            )
            .await?;
        } else {
            insert_adaptive_planned_blocks_tx(
                tx,
                &run.id,
                &run.event_date,
                &run.started_at,
                &snapshot.planned_blocks,
            )
            .await?;
        }
    }

    insert_segment_tx(tx, initial_segment).await?;
    if let Some(snapshot) = &run.adaptive_snapshot {
        insert_run_adaptive_snapshot_tx(tx, run, snapshot).await?;
    }
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

fn run_rhythm_kind(rhythm: &PomodoroRunRhythm) -> &'static str {
    match rhythm {
        PomodoroRunRhythm::Count { .. } => "count",
        PomodoroRunRhythm::Sequence { .. } => "sequence",
    }
}

async fn insert_run_rhythm_snapshot_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run: &PomodoroRunWrite,
) -> Result<(), String> {
    match &run.rhythm {
        PomodoroRunRhythm::Count {
            focus_duration_minutes,
            short_break_minutes,
            long_break_minutes,
            long_break_after_focus_count,
        } => {
            sqlx::query(
                "INSERT INTO pomodoro_run_count_rhythms
                    (run_id, focus_duration_minutes, short_break_minutes, long_break_minutes,
                     long_break_after_focus_count)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&run.id)
            .bind(focus_duration_minutes)
            .bind(short_break_minutes)
            .bind(long_break_minutes)
            .bind(long_break_after_focus_count)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("insert pomodoro run count rhythm: {e}"))?;
        }
        PomodoroRunRhythm::Sequence { steps } => {
            for (step_index, step) in steps.iter().enumerate() {
                sqlx::query(
                    "INSERT INTO pomodoro_run_sequence_steps
                        (run_id, step_index, focus_duration_minutes, break_phase, break_duration_minutes)
                     VALUES (?, ?, ?, ?, ?)",
                )
                .bind(&run.id)
                .bind(step_index as i64)
                .bind(step.focus_duration_minutes)
                .bind(&step.break_phase)
                .bind(step.break_duration_minutes)
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("insert pomodoro run sequence step: {e}"))?;
            }
        }
    }
    Ok(())
}

async fn insert_run_adaptive_snapshot_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run: &PomodoroRunWrite,
    snapshot: &PomodoroRunAdaptiveSnapshotWrite,
) -> Result<(), String> {
    upsert_adaptive_policy_tx(tx, snapshot).await?;
    insert_adaptive_context_snapshot_tx(tx, &snapshot.context_snapshot).await?;
    insert_adaptive_decision_tx(tx, &snapshot.decision).await?;
    for experiment in &snapshot.experiment_updates {
        upsert_adaptive_experiment_tx(tx, experiment).await?;
    }
    for assignment in &snapshot.experiment_assignments {
        insert_adaptive_experiment_assignment_tx(tx, assignment).await?;
    }
    sqlx::query(
        "INSERT INTO pomodoro_run_adaptive_snapshots
            (run_id, policy_id, policy_version, model_version, context_snapshot_id, decision_id)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&run.id)
    .bind(&snapshot.policy_id)
    .bind(snapshot.policy_version)
    .bind(snapshot.model_version)
    .bind(&snapshot.context_snapshot.id)
    .bind(&snapshot.decision.id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert pomodoro run adaptive snapshot: {e}"))?;
    Ok(())
}

pub(super) async fn insert_adaptive_decision_envelope_tx(
    tx: &mut Transaction<'_, Sqlite>,
    envelope: &PomodoroAdaptiveDecisionEnvelopeWrite,
) -> Result<(), String> {
    upsert_adaptive_policy_from_parts_tx(
        tx,
        &envelope.policy_id,
        envelope.policy_version,
        envelope.model_version,
        &envelope.decision.occurred_at,
    )
    .await?;
    insert_adaptive_context_snapshot_tx(tx, &envelope.context_snapshot).await?;
    insert_adaptive_decision_tx(tx, &envelope.decision).await?;
    for experiment in &envelope.experiment_updates {
        upsert_adaptive_experiment_tx(tx, experiment).await?;
    }
    for assignment in &envelope.experiment_assignments {
        insert_adaptive_experiment_assignment_tx(tx, assignment).await?;
    }
    Ok(())
}

async fn upsert_adaptive_experiment_tx(
    tx: &mut Transaction<'_, Sqlite>,
    experiment: &PomodoroAdaptiveExperimentWrite,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pomodoro_adaptive_experiments
            (id, policy_id, parameter_key, assignment_unit, status, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            policy_id = excluded.policy_id,
            parameter_key = excluded.parameter_key,
            assignment_unit = excluded.assignment_unit,
            status = CASE
                WHEN pomodoro_adaptive_experiments.status IN ('completed', 'abandoned')
                     AND excluded.status = 'active'
                THEN pomodoro_adaptive_experiments.status
                ELSE excluded.status
            END,
            started_at = COALESCE(pomodoro_adaptive_experiments.started_at, excluded.started_at),
            ended_at = COALESCE(excluded.ended_at, pomodoro_adaptive_experiments.ended_at)",
    )
    .bind(&experiment.id)
    .bind(&experiment.policy_id)
    .bind(&experiment.parameter_key)
    .bind(&experiment.assignment_unit)
    .bind(&experiment.status)
    .bind(&experiment.started_at)
    .bind(&experiment.ended_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("upsert adaptive experiment: {e}"))?;

    for variant in &experiment.variants {
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_experiment_variants
                (experiment_id, variant_key, numeric_value, is_control)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(experiment_id, variant_key) DO UPDATE SET
                numeric_value = excluded.numeric_value,
                is_control = excluded.is_control",
        )
        .bind(&experiment.id)
        .bind(&variant.variant_key)
        .bind(variant.numeric_value)
        .bind(if variant.is_control { 1_i64 } else { 0_i64 })
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("upsert adaptive experiment variant: {e}"))?;
    }

    Ok(())
}

async fn insert_adaptive_experiment_assignment_tx(
    tx: &mut Transaction<'_, Sqlite>,
    envelope: &PomodoroAdaptiveExperimentAssignmentWrite,
) -> Result<(), String> {
    upsert_adaptive_experiment_tx(tx, &envelope.experiment).await?;
    let assignment = &envelope.assignment;
    sqlx::query(
        "INSERT INTO pomodoro_adaptive_assignments
            (id, experiment_id, variant_key, run_id, segment_id, context_snapshot_id,
             assignment_seed, assigned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&assignment.id)
    .bind(&assignment.experiment_id)
    .bind(&assignment.variant_key)
    .bind(&assignment.run_id)
    .bind(&assignment.segment_id)
    .bind(&assignment.context_snapshot_id)
    .bind(&assignment.assignment_seed)
    .bind(&assignment.assigned_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert adaptive experiment assignment: {e}"))?;
    Ok(())
}

async fn upsert_adaptive_policy_tx(
    tx: &mut Transaction<'_, Sqlite>,
    snapshot: &PomodoroRunAdaptiveSnapshotWrite,
) -> Result<(), String> {
    upsert_adaptive_policy_from_parts_tx(
        tx,
        &snapshot.policy_id,
        snapshot.policy_version,
        snapshot.model_version,
        &snapshot.decision.occurred_at,
    )
    .await
}

async fn upsert_adaptive_policy_from_parts_tx(
    tx: &mut Transaction<'_, Sqlite>,
    policy_id: &str,
    policy_version: i64,
    model_version: i64,
    occurred_at: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pomodoro_adaptive_policies
            (id, status, policy_version, model_version, exploration_budget_per_week, created_at, updated_at)
         VALUES (?, 'active', ?, ?, 2, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            policy_version = excluded.policy_version,
            model_version = excluded.model_version,
            updated_at = excluded.updated_at",
    )
    .bind(policy_id)
    .bind(policy_version)
    .bind(model_version)
    .bind(occurred_at)
    .bind(occurred_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("upsert pomodoro adaptive policy: {e}"))?;

    for (parameter_key, min_value, max_value) in [
        ("focus_duration_minutes", 15.0, 60.0),
        ("short_break_minutes", 3.0, 12.0),
        ("long_break_minutes", 10.0, 30.0),
        ("long_break_after_focus_count", 2.0, 5.0),
    ] {
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_policy_bounds
                (policy_id, parameter_key, min_value, max_value)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(policy_id, parameter_key) DO UPDATE SET
                min_value = excluded.min_value,
                max_value = excluded.max_value",
        )
        .bind(policy_id)
        .bind(parameter_key)
        .bind(min_value)
        .bind(max_value)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("upsert pomodoro adaptive policy bounds: {e}"))?;
    }

    Ok(())
}

async fn insert_adaptive_context_snapshot_tx(
    tx: &mut Transaction<'_, Sqlite>,
    snapshot: &PomodoroAdaptiveContextSnapshotWrite,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pomodoro_adaptive_context_snapshots
            (id, run_id, segment_id, local_started_at, time_of_day, session_position,
             event_length, workload, energy, environment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&snapshot.id)
    .bind(&snapshot.run_id)
    .bind(&snapshot.segment_id)
    .bind(&snapshot.local_started_at)
    .bind(&snapshot.time_of_day)
    .bind(&snapshot.session_position)
    .bind(&snapshot.event_length)
    .bind(&snapshot.workload)
    .bind(&snapshot.energy)
    .bind(&snapshot.environment_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert pomodoro adaptive context snapshot: {e}"))?;

    for feature in &snapshot.features {
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_context_snapshot_features
                (snapshot_id, feature_key, numeric_value, categorical_value,
                 boolean_value, missing, source_kind)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&snapshot.id)
        .bind(&feature.feature_key)
        .bind(feature.numeric_value)
        .bind(&feature.categorical_value)
        .bind(
            feature
                .boolean_value
                .map(|value| if value { 1_i64 } else { 0_i64 }),
        )
        .bind(i64::from(feature.missing))
        .bind(&feature.source_kind)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("insert pomodoro adaptive context feature: {e}"))?;
    }

    for flag in &snapshot.data_quality_flags {
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_data_quality_flags (snapshot_id, flag)
             VALUES (?, ?)",
        )
        .bind(&snapshot.id)
        .bind(flag)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("insert pomodoro adaptive data quality flag: {e}"))?;
    }

    Ok(())
}

async fn insert_adaptive_decision_tx(
    tx: &mut Transaction<'_, Sqlite>,
    decision: &PomodoroAdaptiveDecisionWrite,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pomodoro_adaptive_decisions
            (id, policy_id, run_id, segment_id, context_snapshot_id, opportunity_kind,
             candidate_id, decision_mode, policy_version, model_version, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&decision.id)
    .bind(&decision.policy_id)
    .bind(&decision.run_id)
    .bind(&decision.segment_id)
    .bind(&decision.context_snapshot_id)
    .bind(&decision.opportunity_kind)
    .bind(&decision.candidate_id)
    .bind(&decision.decision_mode)
    .bind(decision.policy_version)
    .bind(decision.model_version)
    .bind(&decision.occurred_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert pomodoro adaptive decision: {e}"))?;

    for value in &decision.values {
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_decision_values
                (decision_id, value_key, previous_numeric_value, selected_numeric_value, value_unit)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&decision.id)
        .bind(&value.value_key)
        .bind(value.previous_numeric_value)
        .bind(value.selected_numeric_value)
        .bind(&value.value_unit)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("insert pomodoro adaptive decision value: {e}"))?;
    }

    for reason_code in &decision.reason_codes {
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_decision_reasons (decision_id, reason_code)
             VALUES (?, ?)",
        )
        .bind(&decision.id)
        .bind(reason_code)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("insert pomodoro adaptive decision reason: {e}"))?;
    }

    sqlx::query(
        "INSERT INTO pomodoro_adaptive_decision_state_scores
            (decision_id, readiness, strain, recovery_debt, avoidance_pressure, momentum, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&decision.id)
    .bind(decision.state_scores.readiness)
    .bind(decision.state_scores.strain)
    .bind(decision.state_scores.recovery_debt)
    .bind(decision.state_scores.avoidance_pressure)
    .bind(decision.state_scores.momentum)
    .bind(decision.state_scores.confidence)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert pomodoro adaptive decision state scores: {e}"))?;

    Ok(())
}

pub(super) async fn insert_segment_tx(
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
            (id, event_id, event_date, run_id, rhythm_position, phase,
             planned_start, planned_end, actual_start, actual_end, status, end_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&segment.id)
    .bind(event_id)
    .bind(&segment.event_date)
    .bind(&segment.run_id)
    .bind(segment.rhythm_position)
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

pub(super) async fn close_run_tx(
    tx: &mut Transaction<'_, Sqlite>,
    closure: &PomodoroRunClosure,
) -> Result<(), String> {
    let ended_at = normalized_close_run_ended_at(tx, closure).await?;

    sqlx::query(
        "UPDATE pomodoro_pauses
         SET ended_at = CASE
           WHEN started_at > ? THEN started_at
           ELSE ?
         END
         WHERE ended_at IS NULL
           AND segment_id IN (
             SELECT id FROM pomodoro_segments WHERE run_id = ?
           )",
    )
    .bind(&ended_at)
    .bind(&ended_at)
    .bind(&closure.run_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("close pomodoro pauses: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET status = ?,
             actual_end = COALESCE(actual_end, CASE
               WHEN actual_start IS NOT NULL AND actual_start > ? THEN actual_start
               ELSE ?
             END),
             end_reason = ?
         WHERE run_id = ? AND status = 'active'",
    )
    .bind(&closure.segment_status)
    .bind(&ended_at)
    .bind(&ended_at)
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
    .bind(&ended_at)
    .bind(&closure.end_reason)
    .bind(&ended_at)
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
            occurred_at: &ended_at,
            phase: None,
            reason: Some(&closure.end_reason),
            duration_seconds: None,
        },
    )
    .await?;

    record_adaptive_run_close_tx(tx, closure, &ended_at).await
}

async fn record_adaptive_run_close_tx(
    tx: &mut Transaction<'_, Sqlite>,
    closure: &PomodoroRunClosure,
    ended_at: &str,
) -> Result<(), String> {
    let Some(snapshot) = load_adaptive_run_snapshot_for_close(tx, &closure.run_id).await? else {
        return Ok(());
    };
    let summary = load_adaptive_run_outcome_summary(tx, &closure.run_id, ended_at).await?;
    insert_adaptive_run_outcomes_tx(tx, &snapshot.decision_id, closure, ended_at, &summary).await?;
    insert_adaptive_phase_outcomes_tx(tx, &closure.run_id, &summary).await?;
    record_matured_adaptive_day_outcomes_tx(tx, &closure.run_id, ended_at).await?;
    record_matured_adaptive_next_day_outcomes_tx(tx, &closure.run_id, ended_at).await?;
    upsert_adaptive_context_state_tx(tx, &snapshot, ended_at, &summary, closure).await
}

async fn load_adaptive_run_snapshot_for_close(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
) -> Result<Option<AdaptiveRunSnapshotForClose>, String> {
    let row = sqlx::query(
        "SELECT rs.policy_id AS policy_id,
                rs.decision_id AS decision_id,
                cs.time_of_day AS time_of_day,
                cs.session_position AS session_position,
                cs.event_length AS event_length,
                cs.workload AS workload,
                cs.energy AS energy,
                cs.environment_id AS environment_id,
                ss.readiness AS readiness,
                ss.strain AS strain,
                ss.recovery_debt AS recovery_debt,
                ss.avoidance_pressure AS avoidance_pressure,
                ss.momentum AS momentum,
                ss.confidence AS confidence
         FROM pomodoro_run_adaptive_snapshots rs
         JOIN pomodoro_adaptive_context_snapshots cs ON cs.id = rs.context_snapshot_id
         JOIN pomodoro_adaptive_decision_state_scores ss ON ss.decision_id = rs.decision_id
         WHERE rs.run_id = ?",
    )
    .bind(run_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load adaptive run snapshot for close: {e}"))?;
    let Some(row) = row else {
        return Ok(None);
    };
    let policy_id: Option<String> = row
        .try_get("policy_id")
        .map_err(|e| format!("read adaptive close policy_id: {e}"))?;
    let decision_id: Option<String> = row
        .try_get("decision_id")
        .map_err(|e| format!("read adaptive close decision_id: {e}"))?;
    let Some(policy_id) = policy_id else {
        return Ok(None);
    };
    let Some(decision_id) = decision_id else {
        return Ok(None);
    };
    let environment_id: Option<String> = row
        .try_get("environment_id")
        .map_err(|e| format!("read adaptive close environment_id: {e}"))?;
    let context_key = format!(
        "{}:{}:{}:{}:{}:{}",
        row.try_get::<String, _>("time_of_day")
            .map_err(|e| format!("read adaptive close time_of_day: {e}"))?,
        row.try_get::<String, _>("session_position")
            .map_err(|e| format!("read adaptive close session_position: {e}"))?,
        row.try_get::<String, _>("event_length")
            .map_err(|e| format!("read adaptive close event_length: {e}"))?,
        row.try_get::<String, _>("workload")
            .map_err(|e| format!("read adaptive close workload: {e}"))?,
        row.try_get::<String, _>("energy")
            .map_err(|e| format!("read adaptive close energy: {e}"))?,
        environment_id.as_deref().unwrap_or("none"),
    );
    Ok(Some(AdaptiveRunSnapshotForClose {
        policy_id,
        decision_id,
        context_key,
        state_scores: PomodoroAdaptiveStateScoresWrite {
            readiness: row
                .try_get("readiness")
                .map_err(|e| format!("read adaptive close readiness: {e}"))?,
            strain: row
                .try_get("strain")
                .map_err(|e| format!("read adaptive close strain: {e}"))?,
            recovery_debt: row
                .try_get("recovery_debt")
                .map_err(|e| format!("read adaptive close recovery_debt: {e}"))?,
            avoidance_pressure: row
                .try_get("avoidance_pressure")
                .map_err(|e| format!("read adaptive close avoidance_pressure: {e}"))?,
            momentum: row
                .try_get("momentum")
                .map_err(|e| format!("read adaptive close momentum: {e}"))?,
            confidence: row
                .try_get("confidence")
                .map_err(|e| format!("read adaptive close confidence: {e}"))?,
        },
    }))
}

async fn load_adaptive_run_outcome_summary(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    ended_at: &str,
) -> Result<AdaptiveRunOutcomeSummary, String> {
    let segment_rows = sqlx::query(
        "SELECT id, phase, planned_start, planned_end, actual_start, actual_end, status, end_reason
         FROM pomodoro_segments
         WHERE run_id = ?
         ORDER BY planned_start ASC",
    )
    .bind(run_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| format!("load adaptive run close segments: {e}"))?;
    let segment_ids = segment_rows
        .iter()
        .map(|row| row.try_get::<String, _>("id"))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("read adaptive run close segment id: {e}"))?;
    let pauses_by_segment = load_pauses_by_segment_tx(tx, &segment_ids).await?;
    let mut summary = AdaptiveRunOutcomeSummary::default();

    for row in segment_rows {
        let segment_id: String = row
            .try_get("id")
            .map_err(|e| format!("read adaptive outcome segment id: {e}"))?;
        let phase: String = row
            .try_get("phase")
            .map_err(|e| format!("read adaptive outcome phase: {e}"))?;
        let planned_start: String = row
            .try_get("planned_start")
            .map_err(|e| format!("read adaptive outcome planned_start: {e}"))?;
        let planned_end: String = row
            .try_get("planned_end")
            .map_err(|e| format!("read adaptive outcome planned_end: {e}"))?;
        let actual_start: Option<String> = row
            .try_get("actual_start")
            .map_err(|e| format!("read adaptive outcome actual_start: {e}"))?;
        let actual_end: Option<String> = row
            .try_get("actual_end")
            .map_err(|e| format!("read adaptive outcome actual_end: {e}"))?;
        let status: String = row
            .try_get("status")
            .map_err(|e| format!("read adaptive outcome status: {e}"))?;
        let end_reason: Option<String> = row
            .try_get("end_reason")
            .map_err(|e| format!("read adaptive outcome end_reason: {e}"))?;
        let planned_seconds = iso_seconds_between(&planned_start, &planned_end)
            .unwrap_or(0)
            .max(0);
        let actual_end = actual_end.as_deref().unwrap_or(ended_at);
        let pauses = pauses_by_segment
            .get(&segment_id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let actual_start_for_window = actual_start.as_deref().unwrap_or(&planned_start);
        let actual_seconds = iso_seconds_between(actual_start_for_window, actual_end)
            .unwrap_or(0)
            .max(0);
        let mut segment_outcome = AdaptiveSegmentOutcomeSummary {
            segment_id: segment_id.clone(),
            phase: phase.clone(),
            status: status.clone(),
            end_reason: end_reason.clone(),
            measured_at: actual_end.to_string(),
            planned_seconds,
            actual_seconds,
            clean_focus_seconds: 0,
            idle_pause_count: 0,
            idle_pause_seconds: 0,
            manual_pause_count: 0,
            manual_pause_seconds: 0,
            suspend_pause_count: 0,
            suspend_pause_seconds: 0,
            break_overtime_seconds: 0,
            blocked_attempt_count: count_blocked_attempts_for_interval_tx(
                tx,
                run_id,
                actual_start_for_window,
                actual_end,
            )
            .await?,
        };

        if phase == "focus" {
            summary.planned_focus_seconds += planned_seconds;
            if status == "completed" {
                summary.completed_focus_segments += 1;
            } else if status == "interrupted" {
                summary.interrupted_focus_segments += 1;
            }
            if end_reason.as_deref() == Some("focus_failed") {
                summary.focus_failure_count += 1;
            }
            if let Some(actual_start) = actual_start.as_deref() {
                let pause_seconds = pause_seconds_for_segment(pauses, actual_start, actual_end);
                let clean_focus_seconds = (actual_seconds - pause_seconds).max(0);
                summary.clean_focus_seconds += clean_focus_seconds;
                segment_outcome.clean_focus_seconds = clean_focus_seconds;
            }
        } else {
            if status != "skipped" {
                summary.break_started_count += 1;
            }
            if status == "completed" {
                summary.break_completed_count += 1;
            }
            if status == "skipped" || end_reason.as_deref() == Some("skipped_by_user") {
                summary.break_skipped_count += 1;
            }
            let overtime_seconds = iso_seconds_between(&planned_end, actual_end)
                .unwrap_or(0)
                .max(0);
            if phase == "short_break" {
                summary.short_break_overtime_seconds += overtime_seconds;
            } else if phase == "long_break" {
                summary.long_break_overtime_seconds += overtime_seconds;
            }
            segment_outcome.break_overtime_seconds = overtime_seconds;
        }

        for pause in pauses {
            let pause_seconds = pause_duration_seconds(pause, actual_end);
            match pause.reason.as_str() {
                "idle" => {
                    summary.idle_pause_count += 1;
                    summary.idle_pause_seconds += pause_seconds;
                    segment_outcome.idle_pause_count += 1;
                    segment_outcome.idle_pause_seconds += pause_seconds;
                }
                "manual" => {
                    summary.manual_pause_count += 1;
                    summary.manual_pause_seconds += pause_seconds;
                    segment_outcome.manual_pause_count += 1;
                    segment_outcome.manual_pause_seconds += pause_seconds;
                }
                "suspend" => {
                    summary.suspend_pause_count += 1;
                    summary.suspend_pause_seconds += pause_seconds;
                    segment_outcome.suspend_pause_count += 1;
                    segment_outcome.suspend_pause_seconds += pause_seconds;
                }
                _ => {}
            }
        }
        summary.segments.push(segment_outcome);
    }

    summary.blocked_attempt_count = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM doomscrolling_block_events
         WHERE run_id = ?
           AND occurred_at <= ?
           AND decision IN ('blocked', 'limit_exhausted')",
    )
    .bind(run_id)
    .bind(ended_at)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("count adaptive close block events: {e}"))?;

    Ok(summary)
}

async fn count_blocked_attempts_for_interval_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    started_at: &str,
    ended_at: &str,
) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM doomscrolling_block_events
         WHERE run_id = ?
           AND occurred_at >= ?
           AND occurred_at <= ?
           AND decision IN ('blocked', 'limit_exhausted')",
    )
    .bind(run_id)
    .bind(started_at)
    .bind(ended_at)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("count adaptive segment block events: {e}"))
}

async fn load_pauses_by_segment_tx(
    tx: &mut Transaction<'_, Sqlite>,
    segment_ids: &[String],
) -> Result<HashMap<String, Vec<PomodoroPauseWrite>>, String> {
    if segment_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = std::iter::repeat_n("?", segment_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT segment_id, started_at, ended_at, reason
         FROM pomodoro_pauses
         WHERE segment_id IN ({placeholders})
         ORDER BY started_at ASC"
    );
    let mut q = sqlx::query(&query);
    for id in segment_ids {
        q = q.bind(id);
    }
    let rows = q
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| format!("load adaptive close pauses: {e}"))?;
    let mut pauses_by_segment: HashMap<String, Vec<PomodoroPauseWrite>> = HashMap::new();
    for row in rows {
        let segment_id: String = row
            .try_get("segment_id")
            .map_err(|e| format!("read adaptive close pause segment_id: {e}"))?;
        pauses_by_segment
            .entry(segment_id)
            .or_default()
            .push(PomodoroPauseWrite {
                started_at: row
                    .try_get("started_at")
                    .map_err(|e| format!("read adaptive close pause started_at: {e}"))?,
                ended_at: row
                    .try_get("ended_at")
                    .map_err(|e| format!("read adaptive close pause ended_at: {e}"))?,
                reason: row
                    .try_get("reason")
                    .map_err(|e| format!("read adaptive close pause reason: {e}"))?,
            });
    }
    Ok(pauses_by_segment)
}

async fn insert_adaptive_run_outcomes_tx(
    tx: &mut Transaction<'_, Sqlite>,
    decision_id: &str,
    closure: &PomodoroRunClosure,
    ended_at: &str,
    summary: &AdaptiveRunOutcomeSummary,
) -> Result<(), String> {
    let assignment_id = load_adaptive_assignment_id_for_decision_tx(tx, decision_id).await?;
    let assignment_id = assignment_id.as_deref();
    for (key, value) in [
        ("completed_focus_segments", summary.completed_focus_segments),
        (
            "interrupted_focus_segments",
            summary.interrupted_focus_segments,
        ),
        ("focus_failure_count", summary.focus_failure_count),
        ("clean_focus_seconds", summary.clean_focus_seconds),
        ("planned_focus_seconds", summary.planned_focus_seconds),
        ("idle_pause_count", summary.idle_pause_count),
        ("idle_pause_seconds", summary.idle_pause_seconds),
        ("manual_pause_count", summary.manual_pause_count),
        ("manual_pause_seconds", summary.manual_pause_seconds),
        ("suspend_pause_count", summary.suspend_pause_count),
        ("suspend_pause_seconds", summary.suspend_pause_seconds),
        ("break_started_count", summary.break_started_count),
        ("break_completed_count", summary.break_completed_count),
        ("break_skipped_count", summary.break_skipped_count),
        (
            "short_break_overtime_seconds",
            summary.short_break_overtime_seconds,
        ),
        (
            "long_break_overtime_seconds",
            summary.long_break_overtime_seconds,
        ),
        ("blocked_attempt_count", summary.blocked_attempt_count),
    ] {
        insert_adaptive_outcome_numeric_tx(
            tx,
            decision_id,
            assignment_id,
            "run",
            key,
            value as f64,
            ended_at,
        )
        .await?;
    }
    insert_adaptive_outcome_boolean_tx(
        tx,
        decision_id,
        assignment_id,
        "run",
        "run_completed",
        closure.end_reason == "completed",
        ended_at,
    )
    .await?;
    insert_adaptive_outcome_boolean_tx(
        tx,
        decision_id,
        assignment_id,
        "run",
        "run_stopped",
        closure.end_reason == "stopped",
        ended_at,
    )
    .await?;
    insert_adaptive_outcome_categorical_tx(
        tx,
        decision_id,
        assignment_id,
        "run",
        "run_end_reason",
        &closure.end_reason,
        ended_at,
    )
    .await
}

async fn insert_adaptive_phase_outcomes_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    summary: &AdaptiveRunOutcomeSummary,
) -> Result<(), String> {
    let decisions = load_adaptive_phase_outcome_decisions_tx(tx, run_id).await?;
    for decision in decisions {
        let Some(segment) = summary
            .segments
            .iter()
            .find(|segment| segment.segment_id == decision.segment_id)
        else {
            continue;
        };
        insert_adaptive_segment_phase_outcomes_tx(tx, &decision.decision_id, segment).await?;
        if segment.phase == "short_break" || segment.phase == "long_break" {
            insert_adaptive_post_break_outcomes_tx(tx, &decision.decision_id, segment, summary)
                .await?;
        }
    }
    Ok(())
}

async fn load_adaptive_phase_outcome_decisions_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
) -> Result<Vec<AdaptiveDecisionForPhaseOutcome>, String> {
    let rows = sqlx::query(
        "SELECT id, segment_id
         FROM pomodoro_adaptive_decisions
         WHERE run_id = ?
           AND segment_id IS NOT NULL
           AND opportunity_kind IN ('run_start', 'focus_start', 'break_start')
         ORDER BY occurred_at ASC",
    )
    .bind(run_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| format!("load adaptive phase outcome decisions: {e}"))?;
    rows.into_iter()
        .map(|row| {
            let segment_id: Option<String> = row
                .try_get("segment_id")
                .map_err(|e| format!("read adaptive phase outcome segment_id: {e}"))?;
            let Some(segment_id) = segment_id else {
                return Err("adaptive phase outcome decision missing segment_id".to_string());
            };
            Ok(AdaptiveDecisionForPhaseOutcome {
                decision_id: row
                    .try_get("id")
                    .map_err(|e| format!("read adaptive phase outcome decision id: {e}"))?,
                segment_id,
            })
        })
        .collect()
}

async fn insert_adaptive_segment_phase_outcomes_tx(
    tx: &mut Transaction<'_, Sqlite>,
    decision_id: &str,
    segment: &AdaptiveSegmentOutcomeSummary,
) -> Result<(), String> {
    let assignment_id = load_adaptive_assignment_id_for_decision_tx(tx, decision_id).await?;
    let assignment_id = assignment_id.as_deref();
    for (key, value) in [
        ("phase_planned_seconds", segment.planned_seconds),
        ("phase_actual_seconds", segment.actual_seconds),
        ("phase_clean_focus_seconds", segment.clean_focus_seconds),
        ("phase_idle_pause_count", segment.idle_pause_count),
        ("phase_idle_pause_seconds", segment.idle_pause_seconds),
        ("phase_manual_pause_count", segment.manual_pause_count),
        ("phase_manual_pause_seconds", segment.manual_pause_seconds),
        ("phase_suspend_pause_count", segment.suspend_pause_count),
        ("phase_suspend_pause_seconds", segment.suspend_pause_seconds),
        (
            "phase_break_overtime_seconds",
            segment.break_overtime_seconds,
        ),
        ("phase_blocked_attempt_count", segment.blocked_attempt_count),
    ] {
        insert_adaptive_outcome_numeric_tx(
            tx,
            decision_id,
            assignment_id,
            "phase",
            key,
            value as f64,
            &segment.measured_at,
        )
        .await?;
    }
    insert_adaptive_outcome_boolean_tx(
        tx,
        decision_id,
        assignment_id,
        "phase",
        "phase_completed",
        segment.status == "completed",
        &segment.measured_at,
    )
    .await?;
    insert_adaptive_outcome_boolean_tx(
        tx,
        decision_id,
        assignment_id,
        "phase",
        "phase_interrupted",
        segment.status == "interrupted",
        &segment.measured_at,
    )
    .await?;
    insert_adaptive_outcome_categorical_tx(
        tx,
        decision_id,
        assignment_id,
        "phase",
        "phase_kind",
        &segment.phase,
        &segment.measured_at,
    )
    .await?;
    insert_adaptive_outcome_categorical_tx(
        tx,
        decision_id,
        assignment_id,
        "phase",
        "phase_status",
        &segment.status,
        &segment.measured_at,
    )
    .await?;
    insert_adaptive_outcome_categorical_tx(
        tx,
        decision_id,
        assignment_id,
        "phase",
        "phase_end_reason",
        segment.end_reason.as_deref().unwrap_or("none"),
        &segment.measured_at,
    )
    .await
}

async fn insert_adaptive_post_break_outcomes_tx(
    tx: &mut Transaction<'_, Sqlite>,
    decision_id: &str,
    break_segment: &AdaptiveSegmentOutcomeSummary,
    summary: &AdaptiveRunOutcomeSummary,
) -> Result<(), String> {
    let assignment_id = load_adaptive_assignment_id_for_decision_tx(tx, decision_id).await?;
    let assignment_id = assignment_id.as_deref();
    let next_focus = next_focus_after_segment(summary, &break_segment.segment_id);
    insert_adaptive_outcome_boolean_tx(
        tx,
        decision_id,
        assignment_id,
        "phase",
        "post_break_next_focus_observed",
        next_focus.is_some(),
        &break_segment.measured_at,
    )
    .await?;

    let Some(next_focus) = next_focus else {
        return Ok(());
    };
    insert_adaptive_outcome_boolean_tx(
        tx,
        decision_id,
        assignment_id,
        "phase",
        "post_break_next_focus_completed",
        next_focus.status == "completed",
        &next_focus.measured_at,
    )
    .await?;
    insert_adaptive_outcome_numeric_tx(
        tx,
        decision_id,
        assignment_id,
        "phase",
        "post_break_next_focus_clean_seconds",
        next_focus.clean_focus_seconds as f64,
        &next_focus.measured_at,
    )
    .await?;
    insert_adaptive_outcome_numeric_tx(
        tx,
        decision_id,
        assignment_id,
        "phase",
        "post_break_next_focus_blocked_attempt_count",
        next_focus.blocked_attempt_count as f64,
        &next_focus.measured_at,
    )
    .await
}

fn next_focus_after_segment<'a>(
    summary: &'a AdaptiveRunOutcomeSummary,
    segment_id: &str,
) -> Option<&'a AdaptiveSegmentOutcomeSummary> {
    let start_index = summary
        .segments
        .iter()
        .position(|segment| segment.segment_id == segment_id)?;
    summary
        .segments
        .iter()
        .skip(start_index + 1)
        .find(|segment| segment.phase == "focus")
}

async fn capture_adaptive_planned_blocks_for_day_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    event_date: &str,
    captured_at: &str,
) -> Result<(), String> {
    let blocks = load_calendar_adaptive_planned_blocks_tx(tx, event_date).await?;
    for block in blocks {
        insert_adaptive_planned_block_tx(tx, run_id, event_date, captured_at, &block).await?;
    }
    Ok(())
}

async fn insert_adaptive_planned_blocks_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    event_date: &str,
    captured_at: &str,
    blocks: &[PomodoroAdaptivePlannedBlockWrite],
) -> Result<(), String> {
    for block in blocks {
        let planned_block = AdaptivePlannedPomodoroBlock {
            event_id: block.event_id.clone(),
            original_event_id: block.original_event_id.clone(),
            planned_start: block.planned_start.clone(),
            planned_end: block.planned_end.clone(),
            source_kind: block.source_kind.clone(),
        };
        insert_adaptive_planned_block_tx(tx, run_id, event_date, captured_at, &planned_block)
            .await?;
    }
    Ok(())
}

async fn insert_adaptive_planned_block_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
    event_date: &str,
    captured_at: &str,
    block: &AdaptivePlannedPomodoroBlock,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR IGNORE INTO pomodoro_adaptive_planned_blocks
            (id, capture_run_id, event_date, event_id, original_event_id,
             planned_start, planned_end, source_kind, captured_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(run_id)
    .bind(event_date)
    .bind(&block.event_id)
    .bind(&block.original_event_id)
    .bind(&block.planned_start)
    .bind(&block.planned_end)
    .bind(&block.source_kind)
    .bind(captured_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("capture adaptive planned pomodoro block: {e}"))?;
    Ok(())
}

pub(super) async fn record_matured_adaptive_day_outcomes_tx(
    tx: &mut Transaction<'_, Sqlite>,
    current_run_id: &str,
    measured_at: &str,
) -> Result<(), String> {
    let Some(current_event_date) = load_run_event_date_tx(tx, current_run_id).await? else {
        return Ok(());
    };
    let decisions = load_matured_day_decisions_tx(tx, &current_event_date).await?;
    for decision in decisions {
        if decision.event_date >= current_event_date {
            continue;
        }
        let summary = load_adaptive_day_outcome_summary_tx(tx, &decision.event_date).await?;
        insert_adaptive_day_outcomes_tx(tx, &decision.decision_id, measured_at, &summary).await?;
    }
    Ok(())
}

pub(super) async fn record_matured_adaptive_next_day_outcomes_tx(
    tx: &mut Transaction<'_, Sqlite>,
    current_run_id: &str,
    measured_at: &str,
) -> Result<(), String> {
    let Some(current_event_date) = load_run_event_date_tx(tx, current_run_id).await? else {
        return Ok(());
    };
    let decisions = load_matured_next_day_decisions_tx(tx, &current_event_date).await?;
    for decision in decisions {
        let Some(next_event_date) = next_event_date(&decision.event_date) else {
            continue;
        };
        if next_event_date >= current_event_date {
            continue;
        }
        let summary = load_adaptive_next_day_outcome_summary_tx(tx, &next_event_date).await?;
        insert_adaptive_next_day_outcomes_tx(tx, &decision.decision_id, measured_at, &summary)
            .await?;
    }
    Ok(())
}

async fn load_run_event_date_tx(
    tx: &mut Transaction<'_, Sqlite>,
    run_id: &str,
) -> Result<Option<String>, String> {
    sqlx::query_scalar("SELECT event_date FROM pomodoro_runs WHERE id = ?")
        .bind(run_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| format!("load adaptive run event date: {e}"))
}

async fn load_matured_day_decisions_tx(
    tx: &mut Transaction<'_, Sqlite>,
    current_event_date: &str,
) -> Result<Vec<AdaptiveDecisionForDayOutcome>, String> {
    let rows = sqlx::query(
        "SELECT d.id AS decision_id, r.event_date AS event_date
         FROM pomodoro_run_adaptive_snapshots rs
         JOIN pomodoro_adaptive_decisions d ON d.id = rs.decision_id
         JOIN pomodoro_runs r ON r.id = rs.run_id
         WHERE r.ended_at IS NOT NULL
           AND r.event_date < ?
           AND NOT EXISTS (
             SELECT 1
             FROM pomodoro_adaptive_outcomes o
             WHERE o.decision_id = d.id
               AND o.outcome_window = 'day'
               AND o.outcome_key = 'day_observed'
           )
         ORDER BY r.event_date ASC, d.occurred_at ASC
         LIMIT 50",
    )
    .bind(current_event_date)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| format!("load matured adaptive day decisions: {e}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(AdaptiveDecisionForDayOutcome {
                decision_id: row
                    .try_get("decision_id")
                    .map_err(|e| format!("read day decision id: {e}"))?,
                event_date: row
                    .try_get("event_date")
                    .map_err(|e| format!("read day event date: {e}"))?,
            })
        })
        .collect()
}

async fn load_matured_next_day_decisions_tx(
    tx: &mut Transaction<'_, Sqlite>,
    current_event_date: &str,
) -> Result<Vec<AdaptiveDecisionForNextDayOutcome>, String> {
    let rows = sqlx::query(
        "SELECT d.id AS decision_id, r.event_date AS event_date
         FROM pomodoro_run_adaptive_snapshots rs
         JOIN pomodoro_adaptive_decisions d ON d.id = rs.decision_id
         JOIN pomodoro_runs r ON r.id = rs.run_id
         WHERE r.ended_at IS NOT NULL
           AND r.event_date < ?
           AND NOT EXISTS (
             SELECT 1
             FROM pomodoro_adaptive_outcomes o
             WHERE o.decision_id = d.id
               AND o.outcome_window = 'next_day'
               AND o.outcome_key = 'next_day_observed'
           )
         ORDER BY r.event_date ASC, d.occurred_at ASC
         LIMIT 50",
    )
    .bind(current_event_date)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| format!("load matured adaptive next-day decisions: {e}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(AdaptiveDecisionForNextDayOutcome {
                decision_id: row
                    .try_get("decision_id")
                    .map_err(|e| format!("read next-day decision id: {e}"))?,
                event_date: row
                    .try_get("event_date")
                    .map_err(|e| format!("read next-day event date: {e}"))?,
            })
        })
        .collect()
}

async fn load_adaptive_day_outcome_summary_tx(
    tx: &mut Transaction<'_, Sqlite>,
    event_date: &str,
) -> Result<AdaptiveDayOutcomeSummary, String> {
    let mut summary = AdaptiveDayOutcomeSummary::default();
    add_run_outcomes_for_date_tx(tx, event_date, &mut summary).await?;
    add_planned_pomodoro_day_outcomes_tx(tx, event_date, &mut summary).await?;
    Ok(summary)
}

async fn load_adaptive_next_day_outcome_summary_tx(
    tx: &mut Transaction<'_, Sqlite>,
    event_date: &str,
) -> Result<AdaptiveNextDayOutcomeSummary, String> {
    let mut summary = AdaptiveNextDayOutcomeSummary::default();
    add_run_outcomes_for_date_tx(tx, event_date, &mut summary).await?;
    Ok(summary)
}

trait AdaptiveDailyRunOutcomeAccumulator {
    fn add_run_outcome(
        &mut self,
        end_reason: Option<&str>,
        run_summary: &AdaptiveRunOutcomeSummary,
    );
}

impl AdaptiveDailyRunOutcomeAccumulator for AdaptiveDayOutcomeSummary {
    fn add_run_outcome(
        &mut self,
        end_reason: Option<&str>,
        run_summary: &AdaptiveRunOutcomeSummary,
    ) {
        self.run_count += 1;
        if end_reason == Some("completed") {
            self.completed_run_count += 1;
        }
        if end_reason == Some("stopped") {
            self.stopped_run_count += 1;
        }
        self.clean_focus_seconds += run_summary.clean_focus_seconds;
        self.completed_focus_segments += run_summary.completed_focus_segments;
        self.interrupted_focus_segments += run_summary.interrupted_focus_segments;
        self.focus_failure_count += run_summary.focus_failure_count;
        self.break_skipped_count += run_summary.break_skipped_count;
        self.break_overtime_seconds +=
            run_summary.short_break_overtime_seconds + run_summary.long_break_overtime_seconds;
        self.blocked_attempt_count += run_summary.blocked_attempt_count;
    }
}

impl AdaptiveDailyRunOutcomeAccumulator for AdaptiveNextDayOutcomeSummary {
    fn add_run_outcome(
        &mut self,
        end_reason: Option<&str>,
        run_summary: &AdaptiveRunOutcomeSummary,
    ) {
        self.run_count += 1;
        if end_reason == Some("completed") {
            self.completed_run_count += 1;
        }
        if end_reason == Some("stopped") {
            self.stopped_run_count += 1;
        }
        self.clean_focus_seconds += run_summary.clean_focus_seconds;
        self.completed_focus_segments += run_summary.completed_focus_segments;
        self.interrupted_focus_segments += run_summary.interrupted_focus_segments;
        self.focus_failure_count += run_summary.focus_failure_count;
        self.break_skipped_count += run_summary.break_skipped_count;
        self.break_overtime_seconds +=
            run_summary.short_break_overtime_seconds + run_summary.long_break_overtime_seconds;
        self.blocked_attempt_count += run_summary.blocked_attempt_count;
    }
}

async fn add_run_outcomes_for_date_tx<T>(
    tx: &mut Transaction<'_, Sqlite>,
    event_date: &str,
    summary: &mut T,
) -> Result<(), String>
where
    T: AdaptiveDailyRunOutcomeAccumulator,
{
    let rows = sqlx::query(
        "SELECT id, ended_at, end_reason
         FROM pomodoro_runs
         WHERE event_date = ?
           AND ended_at IS NOT NULL
         ORDER BY started_at ASC",
    )
    .bind(event_date)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| format!("load adaptive next-day runs: {e}"))?;
    for row in rows {
        let run_id: String = row
            .try_get("id")
            .map_err(|e| format!("read next-day run id: {e}"))?;
        let ended_at: String = row
            .try_get("ended_at")
            .map_err(|e| format!("read next-day run ended_at: {e}"))?;
        let end_reason: Option<String> = row
            .try_get("end_reason")
            .map_err(|e| format!("read next-day run end_reason: {e}"))?;
        let run_summary = load_adaptive_run_outcome_summary(tx, &run_id, &ended_at).await?;

        summary.add_run_outcome(end_reason.as_deref(), &run_summary);
    }
    Ok(())
}

async fn add_planned_pomodoro_day_outcomes_tx(
    tx: &mut Transaction<'_, Sqlite>,
    event_date: &str,
    summary: &mut AdaptiveDayOutcomeSummary,
) -> Result<(), String> {
    let mut planned_events = load_captured_adaptive_planned_blocks_tx(tx, event_date).await?;
    if planned_events.is_empty() {
        planned_events = load_calendar_adaptive_planned_blocks_tx(tx, event_date).await?;
    }

    for block in planned_events {
        let planned_seconds = iso_seconds_between(&block.planned_start, &block.planned_end)
            .unwrap_or(0)
            .max(0);
        let synthetic_original_event_id = format!("{}::{event_date}", block.original_event_id);
        let started_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM pomodoro_runs
             WHERE event_date = ?
               AND (
                 event_id = ?
                 OR original_event_id = ?
                 OR original_event_id = ?
               )",
        )
        .bind(event_date)
        .bind(&block.event_id)
        .bind(&block.original_event_id)
        .bind(&synthetic_original_event_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("count adaptive planned day started runs: {e}"))?;
        summary.planned_pomodoro_event_count += 1;
        summary.planned_pomodoro_minutes += planned_seconds / 60;
        if started_count > 0 {
            summary.started_planned_pomodoro_event_count += 1;
        } else {
            summary.missed_planned_pomodoro_event_count += 1;
        }
    }
    Ok(())
}

async fn load_captured_adaptive_planned_blocks_tx(
    tx: &mut Transaction<'_, Sqlite>,
    event_date: &str,
) -> Result<Vec<AdaptivePlannedPomodoroBlock>, String> {
    let rows = sqlx::query(
        "SELECT event_id, original_event_id, planned_start, planned_end, source_kind
         FROM pomodoro_adaptive_planned_blocks
         WHERE event_date = ?
         ORDER BY planned_start ASC",
    )
    .bind(event_date)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| format!("load captured adaptive planned pomodoro blocks: {e}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(AdaptivePlannedPomodoroBlock {
                event_id: row
                    .try_get("event_id")
                    .map_err(|e| format!("read captured planned block event_id: {e}"))?,
                original_event_id: row
                    .try_get("original_event_id")
                    .map_err(|e| format!("read captured planned block original_event_id: {e}"))?,
                planned_start: row
                    .try_get("planned_start")
                    .map_err(|e| format!("read captured planned block planned_start: {e}"))?,
                planned_end: row
                    .try_get("planned_end")
                    .map_err(|e| format!("read captured planned block planned_end: {e}"))?,
                source_kind: row
                    .try_get("source_kind")
                    .map_err(|e| format!("read captured planned block source_kind: {e}"))?,
            })
        })
        .collect()
}

async fn load_calendar_adaptive_planned_blocks_tx(
    tx: &mut Transaction<'_, Sqlite>,
    event_date: &str,
) -> Result<Vec<AdaptivePlannedPomodoroBlock>, String> {
    let rows = sqlx::query(
        "SELECT ce.id AS event_id,
                ce.id AS original_event_id,
                ce.start_time AS start_time,
                ce.end_time AS end_time,
                'live_event' AS source_kind
         FROM calendar_events ce
         JOIN pomodoro_configs pc ON pc.event_id = ce.id
         WHERE ce.all_day = 0
           AND ce.status != 'cancelled'
           AND substr(ce.start_time, 1, 10) = ?
         UNION
         SELECT cea.source_event_id AS event_id,
                cea.source_event_id AS original_event_id,
                cea.start_time AS start_time,
                cea.end_time AS end_time,
                'archived_event' AS source_kind
         FROM calendar_events_archive cea
         JOIN calendar_event_archive_pomodoro_configs pc
           ON pc.archive_event_id = cea.id
         WHERE cea.all_day = 0
           AND cea.status != 'cancelled'
           AND substr(cea.start_time, 1, 10) = ?",
    )
    .bind(event_date)
    .bind(event_date)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| format!("load adaptive planned pomodoro day events: {e}"))?;

    let mut planned_events = HashMap::<String, AdaptivePlannedPomodoroBlock>::new();
    for row in rows {
        let event_id: String = row
            .try_get("event_id")
            .map_err(|e| format!("read adaptive planned day event_id: {e}"))?;
        let original_event_id: String = row
            .try_get("original_event_id")
            .map_err(|e| format!("read adaptive planned day original_event_id: {e}"))?;
        let start_time: String = row
            .try_get("start_time")
            .map_err(|e| format!("read adaptive planned day start_time: {e}"))?;
        let end_time: String = row
            .try_get("end_time")
            .map_err(|e| format!("read adaptive planned day end_time: {e}"))?;
        let source_kind: String = row
            .try_get("source_kind")
            .map_err(|e| format!("read adaptive planned day source_kind: {e}"))?;
        let key = format!("{original_event_id}|{start_time}");
        planned_events
            .entry(key)
            .or_insert(AdaptivePlannedPomodoroBlock {
                event_id: Some(event_id),
                original_event_id,
                planned_start: start_time,
                planned_end: end_time,
                source_kind,
            });
    }
    let mut blocks = planned_events.into_values().collect::<Vec<_>>();
    blocks.sort_by(|a, b| a.planned_start.cmp(&b.planned_start));
    Ok(blocks)
}

async fn insert_adaptive_day_outcomes_tx(
    tx: &mut Transaction<'_, Sqlite>,
    decision_id: &str,
    measured_at: &str,
    summary: &AdaptiveDayOutcomeSummary,
) -> Result<(), String> {
    let assignment_id = load_adaptive_assignment_id_for_decision_tx(tx, decision_id).await?;
    let assignment_id = assignment_id.as_deref();
    for (key, value) in [
        ("day_run_count", summary.run_count),
        ("day_completed_run_count", summary.completed_run_count),
        ("day_stopped_run_count", summary.stopped_run_count),
        ("day_clean_focus_seconds", summary.clean_focus_seconds),
        (
            "day_completed_focus_segments",
            summary.completed_focus_segments,
        ),
        (
            "day_interrupted_focus_segments",
            summary.interrupted_focus_segments,
        ),
        ("day_focus_failure_count", summary.focus_failure_count),
        ("day_break_skipped_count", summary.break_skipped_count),
        ("day_break_overtime_seconds", summary.break_overtime_seconds),
        ("day_blocked_attempt_count", summary.blocked_attempt_count),
        (
            "day_planned_pomodoro_event_count",
            summary.planned_pomodoro_event_count,
        ),
        (
            "day_started_planned_pomodoro_event_count",
            summary.started_planned_pomodoro_event_count,
        ),
        (
            "day_missed_planned_pomodoro_event_count",
            summary.missed_planned_pomodoro_event_count,
        ),
        (
            "day_planned_pomodoro_minutes",
            summary.planned_pomodoro_minutes,
        ),
    ] {
        insert_adaptive_outcome_numeric_tx(
            tx,
            decision_id,
            assignment_id,
            "day",
            key,
            value as f64,
            measured_at,
        )
        .await?;
    }
    insert_adaptive_outcome_boolean_tx(
        tx,
        decision_id,
        assignment_id,
        "day",
        "day_started_run",
        summary.run_count > 0,
        measured_at,
    )
    .await?;
    insert_adaptive_outcome_boolean_tx(
        tx,
        decision_id,
        assignment_id,
        "day",
        "day_observed",
        true,
        measured_at,
    )
    .await
}

async fn insert_adaptive_next_day_outcomes_tx(
    tx: &mut Transaction<'_, Sqlite>,
    decision_id: &str,
    measured_at: &str,
    summary: &AdaptiveNextDayOutcomeSummary,
) -> Result<(), String> {
    let assignment_id = load_adaptive_assignment_id_for_decision_tx(tx, decision_id).await?;
    let assignment_id = assignment_id.as_deref();
    for (key, value) in [
        ("next_day_run_count", summary.run_count),
        ("next_day_completed_run_count", summary.completed_run_count),
        ("next_day_stopped_run_count", summary.stopped_run_count),
        ("next_day_clean_focus_seconds", summary.clean_focus_seconds),
        (
            "next_day_completed_focus_segments",
            summary.completed_focus_segments,
        ),
        (
            "next_day_interrupted_focus_segments",
            summary.interrupted_focus_segments,
        ),
        ("next_day_focus_failure_count", summary.focus_failure_count),
        ("next_day_break_skipped_count", summary.break_skipped_count),
        (
            "next_day_break_overtime_seconds",
            summary.break_overtime_seconds,
        ),
        (
            "next_day_blocked_attempt_count",
            summary.blocked_attempt_count,
        ),
    ] {
        insert_adaptive_outcome_numeric_tx(
            tx,
            decision_id,
            assignment_id,
            "next_day",
            key,
            value as f64,
            measured_at,
        )
        .await?;
    }
    insert_adaptive_outcome_boolean_tx(
        tx,
        decision_id,
        assignment_id,
        "next_day",
        "next_day_started_run",
        summary.run_count > 0,
        measured_at,
    )
    .await?;
    insert_adaptive_outcome_boolean_tx(
        tx,
        decision_id,
        assignment_id,
        "next_day",
        "next_day_observed",
        true,
        measured_at,
    )
    .await
}

fn next_event_date(event_date: &str) -> Option<String> {
    let date = NaiveDate::parse_from_str(event_date, "%Y-%m-%d").ok()?;
    date.checked_add_signed(Duration::days(1))
        .map(|next| next.format("%Y-%m-%d").to_string())
}

async fn load_adaptive_assignment_id_for_decision_tx(
    tx: &mut Transaction<'_, Sqlite>,
    decision_id: &str,
) -> Result<Option<String>, String> {
    sqlx::query_scalar(
        "SELECT a.id
         FROM pomodoro_adaptive_assignments a
         JOIN pomodoro_adaptive_decisions d
           ON d.context_snapshot_id = a.context_snapshot_id
         WHERE d.id = ?
           AND (d.run_id IS NULL OR a.run_id IS NULL OR d.run_id = a.run_id)
           AND (d.segment_id IS NULL OR a.segment_id IS NULL OR d.segment_id = a.segment_id)
         ORDER BY a.assigned_at ASC
         LIMIT 1",
    )
    .bind(decision_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load adaptive assignment for decision: {e}"))
}

async fn insert_adaptive_outcome_numeric_tx(
    tx: &mut Transaction<'_, Sqlite>,
    decision_id: &str,
    assignment_id: Option<&str>,
    outcome_window: &str,
    outcome_key: &str,
    numeric_value: f64,
    measured_at: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pomodoro_adaptive_outcomes
            (id, decision_id, assignment_id, outcome_window, outcome_key,
             numeric_value, boolean_value, categorical_value, measured_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, NULL, NULL, ?)",
    )
    .bind(decision_id)
    .bind(assignment_id)
    .bind(outcome_window)
    .bind(outcome_key)
    .bind(numeric_value)
    .bind(measured_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert adaptive numeric outcome {outcome_key}: {e}"))?;
    Ok(())
}

async fn insert_adaptive_outcome_boolean_tx(
    tx: &mut Transaction<'_, Sqlite>,
    decision_id: &str,
    assignment_id: Option<&str>,
    outcome_window: &str,
    outcome_key: &str,
    boolean_value: bool,
    measured_at: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pomodoro_adaptive_outcomes
            (id, decision_id, assignment_id, outcome_window, outcome_key,
             numeric_value, boolean_value, categorical_value, measured_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, NULL, ?, NULL, ?)",
    )
    .bind(decision_id)
    .bind(assignment_id)
    .bind(outcome_window)
    .bind(outcome_key)
    .bind(if boolean_value { 1_i64 } else { 0_i64 })
    .bind(measured_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert adaptive boolean outcome {outcome_key}: {e}"))?;
    Ok(())
}

async fn insert_adaptive_outcome_categorical_tx(
    tx: &mut Transaction<'_, Sqlite>,
    decision_id: &str,
    assignment_id: Option<&str>,
    outcome_window: &str,
    outcome_key: &str,
    categorical_value: &str,
    measured_at: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pomodoro_adaptive_outcomes
            (id, decision_id, assignment_id, outcome_window, outcome_key,
             numeric_value, boolean_value, categorical_value, measured_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, NULL, NULL, ?, ?)",
    )
    .bind(decision_id)
    .bind(assignment_id)
    .bind(outcome_window)
    .bind(outcome_key)
    .bind(categorical_value)
    .bind(measured_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert adaptive categorical outcome {outcome_key}: {e}"))?;
    Ok(())
}

async fn upsert_adaptive_context_state_tx(
    tx: &mut Transaction<'_, Sqlite>,
    snapshot: &AdaptiveRunSnapshotForClose,
    ended_at: &str,
    summary: &AdaptiveRunOutcomeSummary,
    closure: &PomodoroRunClosure,
) -> Result<(), String> {
    let base =
        load_existing_adaptive_context_state_tx(tx, &snapshot.policy_id, &snapshot.context_key)
            .await?
            .unwrap_or_else(|| snapshot.state_scores.clone());
    let observed = observed_state_from_run_summary(summary, closure);
    let updated = blend_adaptive_state_scores(&base, &observed);

    sqlx::query(
        "INSERT INTO pomodoro_adaptive_context_states
            (policy_id, context_key, readiness, strain, recovery_debt,
             avoidance_pressure, momentum, confidence, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(policy_id, context_key) DO UPDATE SET
            readiness = excluded.readiness,
            strain = excluded.strain,
            recovery_debt = excluded.recovery_debt,
            avoidance_pressure = excluded.avoidance_pressure,
            momentum = excluded.momentum,
            confidence = excluded.confidence,
            updated_at = excluded.updated_at",
    )
    .bind(&snapshot.policy_id)
    .bind(&snapshot.context_key)
    .bind(updated.readiness)
    .bind(updated.strain)
    .bind(updated.recovery_debt)
    .bind(updated.avoidance_pressure)
    .bind(updated.momentum)
    .bind(updated.confidence)
    .bind(ended_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("upsert adaptive context state: {e}"))?;

    sqlx::query(
        "INSERT INTO pomodoro_adaptive_context_state_history
            (id, policy_id, context_key, observed_at, readiness, strain,
             recovery_debt, avoidance_pressure, momentum, confidence)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&snapshot.policy_id)
    .bind(&snapshot.context_key)
    .bind(ended_at)
    .bind(updated.readiness)
    .bind(updated.strain)
    .bind(updated.recovery_debt)
    .bind(updated.avoidance_pressure)
    .bind(updated.momentum)
    .bind(updated.confidence)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert adaptive context state history: {e}"))?;

    Ok(())
}

async fn load_existing_adaptive_context_state_tx(
    tx: &mut Transaction<'_, Sqlite>,
    policy_id: &str,
    context_key: &str,
) -> Result<Option<PomodoroAdaptiveStateScoresWrite>, String> {
    let row = sqlx::query(
        "SELECT readiness, strain, recovery_debt, avoidance_pressure, momentum, confidence
         FROM pomodoro_adaptive_context_states
         WHERE policy_id = ? AND context_key = ?",
    )
    .bind(policy_id)
    .bind(context_key)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load existing adaptive context state: {e}"))?;
    let Some(row) = row else {
        return Ok(None);
    };
    Ok(Some(PomodoroAdaptiveStateScoresWrite {
        readiness: row
            .try_get("readiness")
            .map_err(|e| format!("read existing adaptive readiness: {e}"))?,
        strain: row
            .try_get("strain")
            .map_err(|e| format!("read existing adaptive strain: {e}"))?,
        recovery_debt: row
            .try_get("recovery_debt")
            .map_err(|e| format!("read existing adaptive recovery_debt: {e}"))?,
        avoidance_pressure: row
            .try_get("avoidance_pressure")
            .map_err(|e| format!("read existing adaptive avoidance_pressure: {e}"))?,
        momentum: row
            .try_get("momentum")
            .map_err(|e| format!("read existing adaptive momentum: {e}"))?,
        confidence: row
            .try_get("confidence")
            .map_err(|e| format!("read existing adaptive confidence: {e}"))?,
    }))
}

fn observed_state_from_run_summary(
    summary: &AdaptiveRunOutcomeSummary,
    closure: &PomodoroRunClosure,
) -> PomodoroAdaptiveStateScoresWrite {
    let focus_attempts =
        (summary.completed_focus_segments + summary.interrupted_focus_segments).max(1) as f64;
    let break_attempts = (summary.break_started_count + summary.break_skipped_count).max(1) as f64;
    let clean_completion_rate = summary.completed_focus_segments as f64 / focus_attempts;
    let failure_rate = summary.focus_failure_count as f64 / focus_attempts;
    let idle_pressure = normalized_score(
        summary.idle_pause_count as f64 + summary.idle_pause_seconds as f64 / 600.0,
        4.0,
    );
    let manual_pause_pressure = normalized_score(
        summary.manual_pause_count as f64 + summary.manual_pause_seconds as f64 / 900.0,
        4.0,
    );
    let blocked_pressure = normalized_score(summary.blocked_attempt_count as f64, 8.0);
    let skipped_break_pressure = normalized_score(summary.break_skipped_count as f64, 3.0);
    let break_overtime_pressure = normalized_score(
        summary.short_break_overtime_seconds as f64 / 180.0
            + summary.long_break_overtime_seconds as f64 / 300.0,
        4.0,
    );
    let stop_pressure = if closure.end_reason == "stopped" {
        1.0
    } else {
        0.0
    };
    let recovery_debt = clamp_score(
        skipped_break_pressure * 0.35
            + break_overtime_pressure * 0.32
            + failure_rate * 0.20
            + stop_pressure * 0.13,
    );
    let strain = clamp_score(
        failure_rate * 0.32
            + idle_pressure * 0.25
            + manual_pause_pressure * 0.12
            + blocked_pressure * 0.18
            + stop_pressure * 0.13,
    );
    let avoidance_pressure = clamp_score(blocked_pressure * 0.80 + stop_pressure * 0.20);
    let momentum = clamp_score(
        clean_completion_rate * 0.55
            + normalized_score(summary.clean_focus_seconds as f64 / 60.0, 120.0) * 0.25
            + (1.0 - blocked_pressure) * 0.10
            - recovery_debt * 0.25,
    );
    let readiness = clamp_score(
        momentum * 0.55 + clean_completion_rate * 0.25 - strain * 0.25 - recovery_debt * 0.20,
    );
    let confidence = clamp_score(
        normalized_score(focus_attempts + break_attempts, 8.0) * 0.55
            + normalized_score(summary.clean_focus_seconds as f64 / 60.0, 180.0) * 0.25
            + 0.20,
    );

    PomodoroAdaptiveStateScoresWrite {
        readiness,
        strain,
        recovery_debt,
        avoidance_pressure,
        momentum,
        confidence,
    }
}

fn blend_adaptive_state_scores(
    previous: &PomodoroAdaptiveStateScoresWrite,
    observed: &PomodoroAdaptiveStateScoresWrite,
) -> PomodoroAdaptiveStateScoresWrite {
    PomodoroAdaptiveStateScoresWrite {
        readiness: blend_score(previous.readiness, observed.readiness),
        strain: blend_score(previous.strain, observed.strain),
        recovery_debt: blend_score(previous.recovery_debt, observed.recovery_debt),
        avoidance_pressure: blend_score(previous.avoidance_pressure, observed.avoidance_pressure),
        momentum: blend_score(previous.momentum, observed.momentum),
        confidence: blend_score(previous.confidence, observed.confidence).max(observed.confidence),
    }
}

fn blend_score(previous: f64, observed: f64) -> f64 {
    clamp_score(previous * 0.65 + observed * 0.35)
}

fn normalized_score(value: f64, scale: f64) -> f64 {
    if scale <= 0.0 {
        0.0
    } else {
        clamp_score(value / scale)
    }
}

fn clamp_score(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    value.clamp(0.0, 1.0)
}

fn pause_seconds_for_segment(
    pauses: &[PomodoroPauseWrite],
    segment_start: &str,
    segment_end: &str,
) -> i64 {
    pauses
        .iter()
        .map(|pause| {
            let pause_end = pause.ended_at.as_deref().unwrap_or(segment_end);
            bounded_overlap_seconds(&pause.started_at, pause_end, segment_start, segment_end)
        })
        .sum()
}

fn pause_duration_seconds(pause: &PomodoroPauseWrite, fallback_end: &str) -> i64 {
    iso_seconds_between(
        &pause.started_at,
        pause.ended_at.as_deref().unwrap_or(fallback_end),
    )
    .unwrap_or(0)
    .max(0)
}

async fn normalized_close_run_ended_at(
    tx: &mut Transaction<'_, Sqlite>,
    closure: &PomodoroRunClosure,
) -> Result<String, String> {
    let active_start = sqlx::query_scalar::<_, String>(
        "SELECT actual_start
         FROM pomodoro_segments
         WHERE run_id = ? AND status = 'active'
         ORDER BY actual_start DESC
         LIMIT 1",
    )
    .bind(&closure.run_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load active pomodoro segment start: {e}"))?;

    Ok(active_start
        .filter(|start| iso_is_before(&closure.ended_at, start))
        .unwrap_or_else(|| closure.ended_at.clone()))
}

pub(super) async fn load_segment_event_context(
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

pub(super) async fn load_existing_pauses(
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

pub(super) async fn replace_segment_pauses(
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

pub(super) async fn log_segment_update_events(
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

pub(super) async fn log_new_pause_events(
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

pub(super) async fn insert_run_event_tx(
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
