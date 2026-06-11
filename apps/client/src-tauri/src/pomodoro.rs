use chrono::{DateTime, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, Transaction};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

const MAX_ADAPTIVE_PLANNED_BLOCKS_PER_SNAPSHOT: usize = 512;
const DEFAULT_ADAPTIVE_REPLAY_HISTORY_SEGMENT_LIMIT: i64 = 120;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroRunWrite {
    id: String,
    event_id: String,
    event_date: String,
    planned_start: String,
    planned_end: String,
    started_at: String,
    rhythm: PomodoroRunRhythm,
    rhythm_source: String,
    preset_key: Option<String>,
    idle_timeout_minutes: Option<i64>,
    event_title_snapshot: Option<String>,
    inherited_focus_minutes: i64,
    inherited_rhythm_position: i64,
    inherited_from_run_id: Option<String>,
    start_trigger: String,
    adaptive_snapshot: Option<PomodoroRunAdaptiveSnapshotWrite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroRunAdaptiveSnapshotWrite {
    policy_id: String,
    policy_version: i64,
    model_version: i64,
    context_snapshot: PomodoroAdaptiveContextSnapshotWrite,
    decision: PomodoroAdaptiveDecisionWrite,
    #[serde(default)]
    planned_blocks: Vec<PomodoroAdaptivePlannedBlockWrite>,
    #[serde(default)]
    experiment_updates: Vec<PomodoroAdaptiveExperimentWrite>,
    experiment_assignments: Vec<PomodoroAdaptiveExperimentAssignmentWrite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveDecisionEnvelopeWrite {
    policy_id: String,
    policy_version: i64,
    model_version: i64,
    context_snapshot: PomodoroAdaptiveContextSnapshotWrite,
    decision: PomodoroAdaptiveDecisionWrite,
    #[serde(default)]
    experiment_updates: Vec<PomodoroAdaptiveExperimentWrite>,
    experiment_assignments: Vec<PomodoroAdaptiveExperimentAssignmentWrite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveContextSnapshotWrite {
    id: String,
    run_id: String,
    segment_id: Option<String>,
    local_started_at: String,
    time_of_day: String,
    session_position: String,
    event_length: String,
    workload: String,
    energy: String,
    environment_id: Option<String>,
    features: Vec<PomodoroAdaptiveFeatureWrite>,
    data_quality_flags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveFeatureWrite {
    feature_key: String,
    numeric_value: Option<f64>,
    categorical_value: Option<String>,
    boolean_value: Option<bool>,
    missing: bool,
    source_kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveDecisionWrite {
    id: String,
    policy_id: String,
    run_id: String,
    segment_id: Option<String>,
    context_snapshot_id: String,
    opportunity_kind: String,
    #[serde(default)]
    candidate_id: Option<String>,
    decision_mode: String,
    policy_version: i64,
    model_version: i64,
    occurred_at: String,
    values: Vec<PomodoroAdaptiveDecisionValueWrite>,
    reason_codes: Vec<String>,
    state_scores: PomodoroAdaptiveStateScoresWrite,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveDecisionValueWrite {
    value_key: String,
    previous_numeric_value: Option<f64>,
    selected_numeric_value: f64,
    value_unit: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveExperimentAssignmentWrite {
    experiment: PomodoroAdaptiveExperimentWrite,
    assignment: PomodoroAdaptiveAssignmentWrite,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptivePlannedBlockWrite {
    event_date: String,
    event_id: Option<String>,
    original_event_id: String,
    planned_start: String,
    planned_end: String,
    source_kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveExperimentWrite {
    id: String,
    policy_id: String,
    parameter_key: String,
    assignment_unit: String,
    status: String,
    started_at: Option<String>,
    ended_at: Option<String>,
    variants: Vec<PomodoroAdaptiveExperimentVariantWrite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveExperimentVariantWrite {
    variant_key: String,
    numeric_value: f64,
    is_control: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveAssignmentWrite {
    id: String,
    experiment_id: String,
    variant_key: String,
    run_id: String,
    segment_id: Option<String>,
    context_snapshot_id: String,
    assignment_seed: String,
    assigned_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveStateScoresWrite {
    readiness: f64,
    strain: f64,
    recovery_debt: f64,
    avoidance_pressure: f64,
    momentum: f64,
    confidence: f64,
}

#[derive(Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum PomodoroRunRhythm {
    Count {
        focus_duration_minutes: i64,
        short_break_minutes: i64,
        long_break_minutes: i64,
        long_break_after_focus_count: i64,
    },
    Sequence {
        steps: Vec<PomodoroRunSequenceStep>,
    },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroRunSequenceStep {
    focus_duration_minutes: i64,
    break_phase: String,
    break_duration_minutes: i64,
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
pub struct PomodoroActiveEventReferenceTransfer {
    new_event_id: String,
    new_event_date: Option<String>,
    planned_end: Option<String>,
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
    rhythm_position: i64,
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
    rhythm_position: i64,
    phase: String,
    planned_start: String,
    planned_end: String,
    actual_start: Option<String>,
    actual_end: Option<String>,
    status: String,
    pauses: Vec<PomodoroPauseWrite>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveHistoryRead {
    segments: Vec<PomodoroAdaptiveHistorySegmentRead>,
    run_events: Vec<PomodoroAdaptiveHistoryRunEventRead>,
    block_events: Vec<PomodoroAdaptiveHistoryBlockEventRead>,
    previous_states: Vec<PomodoroAdaptiveHistoryContextStateRead>,
    experiment_states: Vec<PomodoroAdaptiveHistoryExperimentStateRead>,
    experiment_outcomes: Vec<PomodoroAdaptiveHistoryExperimentOutcomeRead>,
    experiment_assignments: Vec<PomodoroAdaptiveHistoryExperimentAssignmentRead>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveHistorySegmentRead {
    run_id: String,
    rhythm_position: i64,
    phase: String,
    planned_start: String,
    planned_end: String,
    actual_start: Option<String>,
    actual_end: Option<String>,
    status: String,
    end_reason: Option<String>,
    pause_log: Vec<PomodoroPauseWrite>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveHistoryRunEventRead {
    event_type: String,
    occurred_at: String,
    phase: Option<String>,
    reason: Option<String>,
    duration_seconds: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveHistoryBlockEventRead {
    occurred_at: String,
    phase: Option<String>,
    source_type: String,
    source_key: String,
    decision: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveHistoryContextStateRead {
    context_key: String,
    readiness: f64,
    strain: f64,
    recovery_debt: f64,
    avoidance_pressure: f64,
    momentum: f64,
    confidence: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveHistoryExperimentStateRead {
    experiment_id: String,
    status: String,
    started_at: Option<String>,
    ended_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveHistoryExperimentAssignmentRead {
    experiment_id: String,
    variant_key: String,
    context_key: String,
    assigned_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveHistoryExperimentOutcomeRead {
    experiment_id: String,
    variant_key: String,
    context_key: String,
    assignment_count: i64,
    run_observed_count: i64,
    run_completed_count: i64,
    run_stopped_count: i64,
    clean_focus_seconds_sum: f64,
    clean_focus_seconds_square_sum: f64,
    blocked_attempt_count_sum: f64,
    blocked_attempt_count_square_sum: f64,
    break_skipped_count_sum: f64,
    break_skipped_count_square_sum: f64,
    short_break_overtime_seconds_sum: f64,
    short_break_overtime_seconds_square_sum: f64,
    long_break_overtime_seconds_sum: f64,
    long_break_overtime_seconds_square_sum: f64,
    day_observed_count: i64,
    day_started_planned_pomodoro_count_sum: f64,
    day_missed_planned_pomodoro_count_sum: f64,
    day_missed_planned_pomodoro_count_square_sum: f64,
    day_clean_focus_seconds_sum: f64,
    day_blocked_attempt_count_sum: f64,
    day_blocked_attempt_count_square_sum: f64,
    next_day_observed_count: i64,
    next_day_started_run_count: i64,
    next_day_clean_focus_seconds_sum: f64,
    next_day_blocked_attempt_count_sum: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveReplayDatasetRead {
    opportunities: Vec<PomodoroAdaptiveReplayRunStartOpportunityRead>,
    outcomes: Vec<PomodoroAdaptiveReplayOutcomeRowRead>,
    histories: Vec<PomodoroAdaptiveReplayOpportunityHistoryRead>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveReplayRunStartOpportunityRead {
    id: String,
    run_id: String,
    started_at: String,
    planned_start: String,
    planned_end: String,
    candidate_id: Option<String>,
    current_rhythm: PomodoroRunRhythm,
    selected_rhythm: PomodoroRunRhythm,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveReplayOutcomeRowRead {
    opportunity_id: String,
    outcome_window: String,
    outcome_key: String,
    numeric_value: Option<f64>,
    boolean_value: Option<bool>,
    categorical_value: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroAdaptiveReplayOpportunityHistoryRead {
    opportunity_id: String,
    history: PomodoroAdaptiveHistoryRead,
}

struct PomodoroSegmentRow {
    id: String,
    event_id: String,
    event_date: String,
    run_id: String,
    rhythm_position: i64,
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
    rhythm_position,
    phase,
    planned_start,
    planned_end,
    actual_start,
    actual_end,
    status,
});

struct PomodoroAdaptiveHistorySegmentRow {
    id: String,
    run_id: String,
    rhythm_position: i64,
    phase: String,
    planned_start: String,
    planned_end: String,
    actual_start: Option<String>,
    actual_end: Option<String>,
    status: String,
    end_reason: Option<String>,
}
impl_sqlite_from_row!(PomodoroAdaptiveHistorySegmentRow {
    id,
    run_id,
    rhythm_position,
    phase,
    planned_start,
    planned_end,
    actual_start,
    actual_end,
    status,
    end_reason,
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
        "SELECT id, event_id, event_date, run_id, rhythm_position, phase,
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
                rhythm_position: row.rhythm_position,
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
pub async fn pomodoro_load_adaptive_history<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    before: String,
    policy_id: String,
    segment_limit: i64,
) -> Result<PomodoroAdaptiveHistoryRead, String> {
    require_non_empty(&before, "before")?;
    require_non_empty(&policy_id, "policy_id")?;
    validate_adaptive_history_limit(segment_limit)?;
    let pool = connect_sqlite(app, db_url).await?;
    load_adaptive_history_from_pool(&pool, &before, &policy_id, segment_limit).await
}

#[tauri::command]
pub async fn pomodoro_load_adaptive_replay_dataset<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    before: String,
    policy_id: String,
    limit: i64,
    history_segment_limit: Option<i64>,
) -> Result<PomodoroAdaptiveReplayDatasetRead, String> {
    require_non_empty(&before, "before")?;
    require_non_empty(&policy_id, "policy_id")?;
    validate_adaptive_replay_limit(limit)?;
    let history_segment_limit =
        history_segment_limit.unwrap_or(DEFAULT_ADAPTIVE_REPLAY_HISTORY_SEGMENT_LIMIT);
    validate_adaptive_history_limit(history_segment_limit)?;
    let pool = connect_sqlite(app, db_url).await?;
    load_adaptive_replay_dataset_from_pool(&pool, &before, &policy_id, limit, history_segment_limit)
        .await
}

async fn load_adaptive_replay_dataset_from_pool(
    pool: &sqlx::SqlitePool,
    before: &str,
    policy_id: &str,
    limit: i64,
    history_segment_limit: i64,
) -> Result<PomodoroAdaptiveReplayDatasetRead, String> {
    let rows = sqlx::query(
        "SELECT d.id AS decision_id,
                d.run_id AS run_id,
                d.occurred_at AS occurred_at,
                d.candidate_id AS candidate_id,
                r.planned_start AS planned_start,
                r.planned_end AS planned_end,
                MAX(CASE
                    WHEN v.value_key = 'focus_duration_minutes'
                    THEN v.previous_numeric_value
                END) AS previous_focus_duration_minutes,
                MAX(CASE
                    WHEN v.value_key = 'short_break_minutes'
                    THEN v.previous_numeric_value
                END) AS previous_short_break_minutes,
                MAX(CASE
                    WHEN v.value_key = 'long_break_minutes'
                    THEN v.previous_numeric_value
                END) AS previous_long_break_minutes,
                MAX(CASE
                    WHEN v.value_key = 'long_break_after_focus_count'
                    THEN v.previous_numeric_value
                END) AS previous_long_break_after_focus_count,
                MAX(CASE
                    WHEN v.value_key = 'focus_duration_minutes'
                    THEN v.selected_numeric_value
                END) AS selected_focus_duration_minutes,
                MAX(CASE
                    WHEN v.value_key = 'short_break_minutes'
                    THEN v.selected_numeric_value
                END) AS selected_short_break_minutes,
                MAX(CASE
                    WHEN v.value_key = 'long_break_minutes'
                    THEN v.selected_numeric_value
                END) AS selected_long_break_minutes,
                MAX(CASE
                    WHEN v.value_key = 'long_break_after_focus_count'
                    THEN v.selected_numeric_value
                END) AS selected_long_break_after_focus_count
         FROM pomodoro_adaptive_decisions d
         JOIN pomodoro_runs r ON r.id = d.run_id
         JOIN pomodoro_adaptive_decision_values v ON v.decision_id = d.id
         WHERE d.policy_id = ?
           AND d.opportunity_kind = 'run_start'
           AND d.occurred_at < ?
         GROUP BY d.id, d.run_id, d.occurred_at, d.candidate_id, r.planned_start, r.planned_end
         HAVING COUNT(DISTINCT v.value_key) = 4
         ORDER BY d.occurred_at DESC
         LIMIT ?",
    )
    .bind(policy_id)
    .bind(before)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load adaptive replay decisions: {e}"))?;

    let opportunities = rows
        .into_iter()
        .map(|row| {
            let decision_id: String = row
                .try_get("decision_id")
                .map_err(|e| format!("read adaptive replay decision_id: {e}"))?;
            Ok(PomodoroAdaptiveReplayRunStartOpportunityRead {
                id: decision_id,
                run_id: row
                    .try_get("run_id")
                    .map_err(|e| format!("read adaptive replay run_id: {e}"))?,
                started_at: row
                    .try_get("occurred_at")
                    .map_err(|e| format!("read adaptive replay occurred_at: {e}"))?,
                planned_start: row
                    .try_get("planned_start")
                    .map_err(|e| format!("read adaptive replay planned_start: {e}"))?,
                planned_end: row
                    .try_get("planned_end")
                    .map_err(|e| format!("read adaptive replay planned_end: {e}"))?,
                candidate_id: row
                    .try_get("candidate_id")
                    .map_err(|e| format!("read adaptive replay candidate_id: {e}"))?,
                current_rhythm: read_replay_count_rhythm(&row, "previous")?,
                selected_rhythm: read_replay_count_rhythm(&row, "selected")?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let opportunity_ids = opportunities
        .iter()
        .map(|opportunity| opportunity.id.as_str())
        .collect::<Vec<_>>();
    let outcomes = load_adaptive_replay_outcome_rows(pool, &opportunity_ids).await?;
    let histories =
        load_adaptive_replay_histories(pool, &opportunities, policy_id, history_segment_limit)
            .await?;
    Ok(PomodoroAdaptiveReplayDatasetRead {
        opportunities,
        outcomes,
        histories,
    })
}

async fn load_adaptive_replay_outcome_rows(
    pool: &sqlx::SqlitePool,
    opportunity_ids: &[&str],
) -> Result<Vec<PomodoroAdaptiveReplayOutcomeRowRead>, String> {
    if opportunity_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat_n("?", opportunity_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT decision_id, outcome_window, outcome_key, numeric_value, boolean_value,
                categorical_value
         FROM pomodoro_adaptive_outcomes
         WHERE decision_id IN ({placeholders})
           AND outcome_window = 'run'
         ORDER BY measured_at ASC, outcome_key ASC"
    );
    let mut q = sqlx::query(&query);
    for id in opportunity_ids {
        q = q.bind(id);
    }
    let rows = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("load adaptive replay outcomes: {e}"))?;
    rows.into_iter()
        .map(|row| {
            let boolean_value: Option<i64> = row
                .try_get("boolean_value")
                .map_err(|e| format!("read adaptive replay boolean_value: {e}"))?;
            Ok(PomodoroAdaptiveReplayOutcomeRowRead {
                opportunity_id: row
                    .try_get("decision_id")
                    .map_err(|e| format!("read adaptive replay outcome decision_id: {e}"))?,
                outcome_window: row
                    .try_get("outcome_window")
                    .map_err(|e| format!("read adaptive replay outcome_window: {e}"))?,
                outcome_key: row
                    .try_get("outcome_key")
                    .map_err(|e| format!("read adaptive replay outcome_key: {e}"))?,
                numeric_value: row
                    .try_get("numeric_value")
                    .map_err(|e| format!("read adaptive replay numeric_value: {e}"))?,
                boolean_value: boolean_value.map(|value| value != 0),
                categorical_value: row
                    .try_get("categorical_value")
                    .map_err(|e| format!("read adaptive replay categorical_value: {e}"))?,
            })
        })
        .collect()
}

async fn load_adaptive_replay_histories(
    pool: &sqlx::SqlitePool,
    opportunities: &[PomodoroAdaptiveReplayRunStartOpportunityRead],
    policy_id: &str,
    history_segment_limit: i64,
) -> Result<Vec<PomodoroAdaptiveReplayOpportunityHistoryRead>, String> {
    let mut histories = Vec::with_capacity(opportunities.len());
    for opportunity in opportunities {
        histories.push(PomodoroAdaptiveReplayOpportunityHistoryRead {
            opportunity_id: opportunity.id.clone(),
            history: load_adaptive_history_snapshot_from_pool(
                pool,
                &opportunity.started_at,
                policy_id,
                history_segment_limit,
                AdaptiveHistoryStateSource::Historical,
            )
            .await?,
        });
    }
    Ok(histories)
}

fn read_replay_count_rhythm(
    row: &sqlx::sqlite::SqliteRow,
    prefix: &str,
) -> Result<PomodoroRunRhythm, String> {
    Ok(PomodoroRunRhythm::Count {
        focus_duration_minutes: read_replay_i64(row, &format!("{prefix}_focus_duration_minutes"))?,
        short_break_minutes: read_replay_i64(row, &format!("{prefix}_short_break_minutes"))?,
        long_break_minutes: read_replay_i64(row, &format!("{prefix}_long_break_minutes"))?,
        long_break_after_focus_count: read_replay_i64(
            row,
            &format!("{prefix}_long_break_after_focus_count"),
        )?,
    })
}

fn read_replay_i64(row: &sqlx::sqlite::SqliteRow, column: &str) -> Result<i64, String> {
    let value: Option<f64> = row
        .try_get(column)
        .map_err(|e| format!("read adaptive replay {column}: {e}"))?;
    let Some(value) = value else {
        return Err(format!("adaptive replay decision missing {column}"));
    };
    if !value.is_finite() {
        return Err(format!("adaptive replay decision {column} must be finite"));
    }
    Ok(value.round() as i64)
}

async fn load_adaptive_history_from_pool(
    pool: &sqlx::SqlitePool,
    before: &str,
    policy_id: &str,
    segment_limit: i64,
) -> Result<PomodoroAdaptiveHistoryRead, String> {
    load_adaptive_history_snapshot_from_pool(
        pool,
        before,
        policy_id,
        segment_limit,
        AdaptiveHistoryStateSource::Current,
    )
    .await
}

enum AdaptiveHistoryStateSource {
    Current,
    Historical,
}

async fn load_adaptive_history_snapshot_from_pool(
    pool: &sqlx::SqlitePool,
    before: &str,
    policy_id: &str,
    segment_limit: i64,
    state_source: AdaptiveHistoryStateSource,
) -> Result<PomodoroAdaptiveHistoryRead, String> {
    let mut segment_rows = sqlx::query_as::<_, PomodoroAdaptiveHistorySegmentRow>(
        "SELECT id, run_id, rhythm_position, phase, planned_start, planned_end, actual_start, actual_end,
                status, end_reason
         FROM pomodoro_segments
         WHERE planned_start < ?
           AND status IN ('completed', 'interrupted')
         ORDER BY planned_start DESC
         LIMIT ?",
    )
    .bind(before)
    .bind(segment_limit)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load adaptive pomodoro segments: {e}"))?;
    segment_rows.reverse();

    let segment_ids = segment_rows
        .iter()
        .map(|row| row.id.as_str())
        .collect::<Vec<_>>();
    let pauses_by_segment = load_pauses_for_segment_ids(pool, &segment_ids).await?;

    let run_ids = segment_rows
        .iter()
        .map(|row| row.run_id.as_str())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let run_events = load_adaptive_run_events(pool, &run_ids).await?;
    let block_events = load_adaptive_block_events(pool, before, segment_limit).await?;
    let previous_states = match state_source {
        AdaptiveHistoryStateSource::Current => {
            load_adaptive_context_states(pool, policy_id).await?
        }
        AdaptiveHistoryStateSource::Historical => {
            load_adaptive_context_states_before(pool, policy_id, before).await?
        }
    };
    let experiment_states = load_adaptive_experiment_states(pool, policy_id, before).await?;
    let experiment_outcomes = load_adaptive_experiment_outcomes(pool, policy_id, before).await?;
    let experiment_assignments =
        load_adaptive_experiment_assignments(pool, policy_id, before).await?;

    let segments = segment_rows
        .into_iter()
        .map(|row| PomodoroAdaptiveHistorySegmentRead {
            pause_log: pauses_by_segment.get(&row.id).cloned().unwrap_or_default(),
            run_id: row.run_id,
            rhythm_position: row.rhythm_position,
            phase: row.phase,
            planned_start: row.planned_start,
            planned_end: row.planned_end,
            actual_start: row.actual_start,
            actual_end: row.actual_end,
            status: row.status,
            end_reason: row.end_reason,
        })
        .collect();

    Ok(PomodoroAdaptiveHistoryRead {
        segments,
        run_events,
        block_events,
        previous_states,
        experiment_states,
        experiment_outcomes,
        experiment_assignments,
    })
}

async fn load_pauses_for_segment_ids(
    pool: &sqlx::SqlitePool,
    segment_ids: &[&str],
) -> Result<HashMap<String, Vec<PomodoroPauseWrite>>, String> {
    if segment_ids.is_empty() {
        return Ok(HashMap::new());
    }
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
    for id in segment_ids {
        pause_q = pause_q.bind(id);
    }
    let pause_rows = pause_q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("load adaptive pomodoro pauses: {e}"))?;
    let mut pauses_by_segment: HashMap<String, Vec<PomodoroPauseWrite>> = HashMap::new();
    for row in pause_rows {
        let segment_id: String = row
            .try_get("segment_id")
            .map_err(|e| format!("read adaptive pause segment_id: {e}"))?;
        let pause = PomodoroPauseWrite {
            started_at: row
                .try_get("started_at")
                .map_err(|e| format!("read adaptive pause started_at: {e}"))?,
            ended_at: row
                .try_get("ended_at")
                .map_err(|e| format!("read adaptive pause ended_at: {e}"))?,
            reason: row
                .try_get("reason")
                .map_err(|e| format!("read adaptive pause reason: {e}"))?,
        };
        pauses_by_segment.entry(segment_id).or_default().push(pause);
    }
    Ok(pauses_by_segment)
}

async fn load_adaptive_run_events(
    pool: &sqlx::SqlitePool,
    run_ids: &[&str],
) -> Result<Vec<PomodoroAdaptiveHistoryRunEventRead>, String> {
    if run_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat_n("?", run_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT event_type, occurred_at, phase, reason, duration_seconds
         FROM pomodoro_run_events
         WHERE run_id IN ({placeholders})
         ORDER BY occurred_at ASC"
    );
    let mut q = sqlx::query(&query);
    for id in run_ids {
        q = q.bind(id);
    }
    let rows = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("load adaptive run events: {e}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(PomodoroAdaptiveHistoryRunEventRead {
                event_type: row
                    .try_get("event_type")
                    .map_err(|e| format!("read adaptive run event event_type: {e}"))?,
                occurred_at: row
                    .try_get("occurred_at")
                    .map_err(|e| format!("read adaptive run event occurred_at: {e}"))?,
                phase: row
                    .try_get("phase")
                    .map_err(|e| format!("read adaptive run event phase: {e}"))?,
                reason: row
                    .try_get("reason")
                    .map_err(|e| format!("read adaptive run event reason: {e}"))?,
                duration_seconds: row
                    .try_get("duration_seconds")
                    .map_err(|e| format!("read adaptive run event duration_seconds: {e}"))?,
            })
        })
        .collect()
}

async fn load_adaptive_block_events(
    pool: &sqlx::SqlitePool,
    before: &str,
    limit: i64,
) -> Result<Vec<PomodoroAdaptiveHistoryBlockEventRead>, String> {
    let mut rows = sqlx::query(
        "SELECT occurred_at, phase, source_type, source_key, decision
         FROM doomscrolling_block_events
         WHERE occurred_at < ?
         ORDER BY occurred_at DESC
         LIMIT ?",
    )
    .bind(before)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load adaptive block events: {e}"))?;
    rows.reverse();
    rows.into_iter()
        .map(|row| {
            Ok(PomodoroAdaptiveHistoryBlockEventRead {
                occurred_at: row
                    .try_get("occurred_at")
                    .map_err(|e| format!("read adaptive block event occurred_at: {e}"))?,
                phase: row
                    .try_get("phase")
                    .map_err(|e| format!("read adaptive block event phase: {e}"))?,
                source_type: row
                    .try_get("source_type")
                    .map_err(|e| format!("read adaptive block event source_type: {e}"))?,
                source_key: row
                    .try_get("source_key")
                    .map_err(|e| format!("read adaptive block event source_key: {e}"))?,
                decision: row
                    .try_get("decision")
                    .map_err(|e| format!("read adaptive block event decision: {e}"))?,
            })
        })
        .collect()
}

async fn load_adaptive_context_states(
    pool: &sqlx::SqlitePool,
    policy_id: &str,
) -> Result<Vec<PomodoroAdaptiveHistoryContextStateRead>, String> {
    let rows = sqlx::query(
        "SELECT context_key, readiness, strain, recovery_debt, avoidance_pressure, momentum,
                confidence
         FROM pomodoro_adaptive_context_states
         WHERE policy_id = ?
         ORDER BY updated_at DESC
         LIMIT 120",
    )
    .bind(policy_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load adaptive context states: {e}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(PomodoroAdaptiveHistoryContextStateRead {
                context_key: row
                    .try_get("context_key")
                    .map_err(|e| format!("read adaptive context state key: {e}"))?,
                readiness: row
                    .try_get("readiness")
                    .map_err(|e| format!("read adaptive state readiness: {e}"))?,
                strain: row
                    .try_get("strain")
                    .map_err(|e| format!("read adaptive state strain: {e}"))?,
                recovery_debt: row
                    .try_get("recovery_debt")
                    .map_err(|e| format!("read adaptive state recovery_debt: {e}"))?,
                avoidance_pressure: row
                    .try_get("avoidance_pressure")
                    .map_err(|e| format!("read adaptive state avoidance_pressure: {e}"))?,
                momentum: row
                    .try_get("momentum")
                    .map_err(|e| format!("read adaptive state momentum: {e}"))?,
                confidence: row
                    .try_get("confidence")
                    .map_err(|e| format!("read adaptive state confidence: {e}"))?,
            })
        })
        .collect()
}

async fn load_adaptive_context_states_before(
    pool: &sqlx::SqlitePool,
    policy_id: &str,
    before: &str,
) -> Result<Vec<PomodoroAdaptiveHistoryContextStateRead>, String> {
    let rows = sqlx::query(
        "SELECT h.context_key, h.readiness, h.strain, h.recovery_debt,
                h.avoidance_pressure, h.momentum, h.confidence
         FROM pomodoro_adaptive_context_state_history h
         JOIN (
            SELECT context_key, MAX(observed_at) AS observed_at
            FROM pomodoro_adaptive_context_state_history
            WHERE policy_id = ?
              AND observed_at < ?
            GROUP BY context_key
         ) latest
           ON latest.context_key = h.context_key
          AND latest.observed_at = h.observed_at
         WHERE h.policy_id = ?
         ORDER BY h.observed_at DESC
         LIMIT 120",
    )
    .bind(policy_id)
    .bind(before)
    .bind(policy_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load adaptive historical context states: {e}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(PomodoroAdaptiveHistoryContextStateRead {
                context_key: row
                    .try_get("context_key")
                    .map_err(|e| format!("read adaptive historical context state key: {e}"))?,
                readiness: row
                    .try_get("readiness")
                    .map_err(|e| format!("read adaptive historical state readiness: {e}"))?,
                strain: row
                    .try_get("strain")
                    .map_err(|e| format!("read adaptive historical state strain: {e}"))?,
                recovery_debt: row
                    .try_get("recovery_debt")
                    .map_err(|e| format!("read adaptive historical state recovery_debt: {e}"))?,
                avoidance_pressure: row.try_get("avoidance_pressure").map_err(|e| {
                    format!("read adaptive historical state avoidance_pressure: {e}")
                })?,
                momentum: row
                    .try_get("momentum")
                    .map_err(|e| format!("read adaptive historical state momentum: {e}"))?,
                confidence: row
                    .try_get("confidence")
                    .map_err(|e| format!("read adaptive historical state confidence: {e}"))?,
            })
        })
        .collect()
}

async fn load_adaptive_experiment_states(
    pool: &sqlx::SqlitePool,
    policy_id: &str,
    before: &str,
) -> Result<Vec<PomodoroAdaptiveHistoryExperimentStateRead>, String> {
    let rows = sqlx::query(
        "SELECT id, status, started_at, ended_at
         FROM pomodoro_adaptive_experiments
         WHERE policy_id = ?
           AND (started_at IS NULL OR started_at < ?)
           AND (ended_at IS NULL OR ended_at < ?)
         ORDER BY COALESCE(ended_at, started_at, created_at) DESC
         LIMIT 50",
    )
    .bind(policy_id)
    .bind(before)
    .bind(before)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load adaptive experiment states: {e}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(PomodoroAdaptiveHistoryExperimentStateRead {
                experiment_id: row
                    .try_get("id")
                    .map_err(|e| format!("read adaptive experiment state id: {e}"))?,
                status: row
                    .try_get("status")
                    .map_err(|e| format!("read adaptive experiment state status: {e}"))?,
                started_at: row
                    .try_get("started_at")
                    .map_err(|e| format!("read adaptive experiment state started_at: {e}"))?,
                ended_at: row
                    .try_get("ended_at")
                    .map_err(|e| format!("read adaptive experiment state ended_at: {e}"))?,
            })
        })
        .collect()
}

async fn load_adaptive_experiment_assignments(
    pool: &sqlx::SqlitePool,
    policy_id: &str,
    before: &str,
) -> Result<Vec<PomodoroAdaptiveHistoryExperimentAssignmentRead>, String> {
    let rows = sqlx::query(
        "SELECT a.experiment_id AS experiment_id,
                a.variant_key AS variant_key,
                cs.time_of_day || ':' ||
                    cs.session_position || ':' ||
                    cs.event_length || ':' ||
                    cs.workload || ':' ||
                    cs.energy || ':' ||
                    COALESCE(cs.environment_id, 'none') AS context_key,
                a.assigned_at AS assigned_at
         FROM pomodoro_adaptive_assignments a
         JOIN pomodoro_adaptive_experiments e ON e.id = a.experiment_id
         JOIN pomodoro_adaptive_context_snapshots cs ON cs.id = a.context_snapshot_id
         WHERE e.policy_id = ?
           AND a.assigned_at < ?
         ORDER BY a.assigned_at DESC
         LIMIT 100",
    )
    .bind(policy_id)
    .bind(before)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load adaptive experiment assignments: {e}"))?;

    rows.into_iter()
        .map(|row| {
            Ok(PomodoroAdaptiveHistoryExperimentAssignmentRead {
                experiment_id: row
                    .try_get("experiment_id")
                    .map_err(|e| format!("read adaptive assignment experiment_id: {e}"))?,
                variant_key: row
                    .try_get("variant_key")
                    .map_err(|e| format!("read adaptive assignment variant_key: {e}"))?,
                context_key: row
                    .try_get("context_key")
                    .map_err(|e| format!("read adaptive assignment context_key: {e}"))?,
                assigned_at: row
                    .try_get("assigned_at")
                    .map_err(|e| format!("read adaptive assignment assigned_at: {e}"))?,
            })
        })
        .collect()
}

async fn load_adaptive_experiment_outcomes(
    pool: &sqlx::SqlitePool,
    policy_id: &str,
    before: &str,
) -> Result<Vec<PomodoroAdaptiveHistoryExperimentOutcomeRead>, String> {
    let rows = sqlx::query(
        "SELECT a.experiment_id AS experiment_id,
                a.variant_key AS variant_key,
                cs.time_of_day || ':' ||
                    cs.session_position || ':' ||
                    cs.event_length || ':' ||
                    cs.workload || ':' ||
                    cs.energy || ':' ||
                    COALESCE(cs.environment_id, 'none') AS context_key,
                COUNT(DISTINCT a.id) AS assignment_count,
                COUNT(DISTINCT CASE
                    WHEN o.outcome_window = 'run' AND o.outcome_key = 'run_completed'
                    THEN o.id
                END) AS run_observed_count,
                COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run'
                     AND o.outcome_key = 'run_completed'
                     AND o.boolean_value = 1
                    THEN 1 ELSE 0
                END), 0) AS run_completed_count,
                COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run'
                     AND o.outcome_key = 'run_stopped'
                     AND o.boolean_value = 1
                    THEN 1 ELSE 0
                END), 0) AS run_stopped_count,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run' AND o.outcome_key = 'clean_focus_seconds'
                    THEN o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS clean_focus_seconds_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run' AND o.outcome_key = 'clean_focus_seconds'
                    THEN o.numeric_value * o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS clean_focus_seconds_square_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run' AND o.outcome_key = 'blocked_attempt_count'
                    THEN o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS blocked_attempt_count_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run' AND o.outcome_key = 'blocked_attempt_count'
                    THEN o.numeric_value * o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS blocked_attempt_count_square_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run' AND o.outcome_key = 'break_skipped_count'
                    THEN o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS break_skipped_count_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run' AND o.outcome_key = 'break_skipped_count'
                    THEN o.numeric_value * o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS break_skipped_count_square_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run' AND o.outcome_key = 'short_break_overtime_seconds'
                    THEN o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS short_break_overtime_seconds_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run' AND o.outcome_key = 'short_break_overtime_seconds'
                    THEN o.numeric_value * o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS short_break_overtime_seconds_square_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run' AND o.outcome_key = 'long_break_overtime_seconds'
                    THEN o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS long_break_overtime_seconds_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'run' AND o.outcome_key = 'long_break_overtime_seconds'
                    THEN o.numeric_value * o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS long_break_overtime_seconds_square_sum,
                COUNT(DISTINCT CASE
                    WHEN o.outcome_window = 'day' AND o.outcome_key = 'day_observed'
                    THEN o.id
                END) AS day_observed_count,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'day'
                     AND o.outcome_key = 'day_started_planned_pomodoro_event_count'
                    THEN o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS day_started_planned_pomodoro_count_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'day'
                     AND o.outcome_key = 'day_missed_planned_pomodoro_event_count'
                    THEN o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS day_missed_planned_pomodoro_count_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'day'
                     AND o.outcome_key = 'day_missed_planned_pomodoro_event_count'
                    THEN o.numeric_value * o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS day_missed_planned_pomodoro_count_square_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'day'
                     AND o.outcome_key = 'day_clean_focus_seconds'
                    THEN o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS day_clean_focus_seconds_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'day'
                     AND o.outcome_key = 'day_blocked_attempt_count'
                    THEN o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS day_blocked_attempt_count_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'day'
                     AND o.outcome_key = 'day_blocked_attempt_count'
                    THEN o.numeric_value * o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS day_blocked_attempt_count_square_sum,
                COUNT(DISTINCT CASE
                    WHEN o.outcome_window = 'next_day' AND o.outcome_key = 'next_day_observed'
                    THEN o.id
                END) AS next_day_observed_count,
                COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'next_day'
                     AND o.outcome_key = 'next_day_started_run'
                     AND o.boolean_value = 1
                    THEN 1 ELSE 0
                END), 0) AS next_day_started_run_count,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'next_day'
                     AND o.outcome_key = 'next_day_clean_focus_seconds'
                    THEN o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS next_day_clean_focus_seconds_sum,
                CAST(COALESCE(SUM(CASE
                    WHEN o.outcome_window = 'next_day'
                     AND o.outcome_key = 'next_day_blocked_attempt_count'
                    THEN o.numeric_value ELSE 0
                END), 0.0) AS REAL) AS next_day_blocked_attempt_count_sum
         FROM pomodoro_adaptive_assignments a
         JOIN pomodoro_adaptive_experiments e ON e.id = a.experiment_id
         JOIN pomodoro_adaptive_context_snapshots cs ON cs.id = a.context_snapshot_id
         LEFT JOIN pomodoro_adaptive_outcomes o ON o.assignment_id = a.id
         WHERE e.policy_id = ?
           AND a.assigned_at < ?
         GROUP BY a.experiment_id, a.variant_key, context_key
         ORDER BY a.experiment_id ASC, a.variant_key ASC, context_key ASC",
    )
    .bind(policy_id)
    .bind(before)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load adaptive experiment outcomes: {e}"))?;

    rows.into_iter()
        .map(|row| {
            Ok(PomodoroAdaptiveHistoryExperimentOutcomeRead {
                experiment_id: row
                    .try_get("experiment_id")
                    .map_err(|e| format!("read adaptive experiment outcome experiment_id: {e}"))?,
                variant_key: row
                    .try_get("variant_key")
                    .map_err(|e| format!("read adaptive experiment outcome variant_key: {e}"))?,
                context_key: row
                    .try_get("context_key")
                    .map_err(|e| format!("read adaptive experiment outcome context_key: {e}"))?,
                assignment_count: row
                    .try_get("assignment_count")
                    .map_err(|e| format!("read adaptive experiment outcome assignment_count: {e}"))?,
                run_observed_count: row.try_get("run_observed_count").map_err(|e| {
                    format!("read adaptive experiment outcome run_observed_count: {e}")
                })?,
                run_completed_count: row.try_get("run_completed_count").map_err(|e| {
                    format!("read adaptive experiment outcome run_completed_count: {e}")
                })?,
                run_stopped_count: row.try_get("run_stopped_count").map_err(|e| {
                    format!("read adaptive experiment outcome run_stopped_count: {e}")
                })?,
                clean_focus_seconds_sum: row.try_get("clean_focus_seconds_sum").map_err(|e| {
                    format!("read adaptive experiment outcome clean_focus_seconds_sum: {e}")
                })?,
                clean_focus_seconds_square_sum: row
                    .try_get("clean_focus_seconds_square_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome clean_focus_seconds_square_sum: {e}"
                        )
                    })?,
                blocked_attempt_count_sum: row.try_get("blocked_attempt_count_sum").map_err(|e| {
                    format!("read adaptive experiment outcome blocked_attempt_count_sum: {e}")
                })?,
                blocked_attempt_count_square_sum: row
                    .try_get("blocked_attempt_count_square_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome blocked_attempt_count_square_sum: {e}"
                        )
                    })?,
                break_skipped_count_sum: row.try_get("break_skipped_count_sum").map_err(|e| {
                    format!("read adaptive experiment outcome break_skipped_count_sum: {e}")
                })?,
                break_skipped_count_square_sum: row
                    .try_get("break_skipped_count_square_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome break_skipped_count_square_sum: {e}"
                        )
                    })?,
                short_break_overtime_seconds_sum: row
                    .try_get("short_break_overtime_seconds_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome short_break_overtime_seconds_sum: {e}"
                        )
                    })?,
                short_break_overtime_seconds_square_sum: row
                    .try_get("short_break_overtime_seconds_square_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome short_break_overtime_seconds_square_sum: {e}"
                        )
                    })?,
                long_break_overtime_seconds_sum: row
                    .try_get("long_break_overtime_seconds_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome long_break_overtime_seconds_sum: {e}"
                        )
                    })?,
                long_break_overtime_seconds_square_sum: row
                    .try_get("long_break_overtime_seconds_square_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome long_break_overtime_seconds_square_sum: {e}"
                        )
                    })?,
                day_observed_count: row.try_get("day_observed_count").map_err(|e| {
                    format!("read adaptive experiment outcome day_observed_count: {e}")
                })?,
                day_started_planned_pomodoro_count_sum: row
                    .try_get("day_started_planned_pomodoro_count_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome day_started_planned_pomodoro_count_sum: {e}"
                        )
                    })?,
                day_missed_planned_pomodoro_count_sum: row
                    .try_get("day_missed_planned_pomodoro_count_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome day_missed_planned_pomodoro_count_sum: {e}"
                        )
                    })?,
                day_missed_planned_pomodoro_count_square_sum: row
                    .try_get("day_missed_planned_pomodoro_count_square_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome day_missed_planned_pomodoro_count_square_sum: {e}"
                        )
                    })?,
                day_clean_focus_seconds_sum: row.try_get("day_clean_focus_seconds_sum").map_err(
                    |e| format!("read adaptive experiment outcome day_clean_focus_seconds_sum: {e}"),
                )?,
                day_blocked_attempt_count_sum: row
                    .try_get("day_blocked_attempt_count_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome day_blocked_attempt_count_sum: {e}"
                        )
                    })?,
                day_blocked_attempt_count_square_sum: row
                    .try_get("day_blocked_attempt_count_square_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome day_blocked_attempt_count_square_sum: {e}"
                        )
                    })?,
                next_day_observed_count: row.try_get("next_day_observed_count").map_err(|e| {
                    format!("read adaptive experiment outcome next_day_observed_count: {e}")
                })?,
                next_day_started_run_count: row.try_get("next_day_started_run_count").map_err(
                    |e| format!("read adaptive experiment outcome next_day_started_run_count: {e}"),
                )?,
                next_day_clean_focus_seconds_sum: row
                    .try_get("next_day_clean_focus_seconds_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome next_day_clean_focus_seconds_sum: {e}"
                        )
                    })?,
                next_day_blocked_attempt_count_sum: row
                    .try_get("next_day_blocked_attempt_count_sum")
                    .map_err(|e| {
                        format!(
                            "read adaptive experiment outcome next_day_blocked_attempt_count_sum: {e}"
                        )
                    })?,
            })
        })
        .collect()
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
pub async fn pomodoro_insert_segment_with_adaptive_decision<R: Runtime>(
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

#[tauri::command]
pub async fn pomodoro_update_segments<R: Runtime>(
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
pub async fn pomodoro_transfer_active_event_reference<R: Runtime>(
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

async fn insert_adaptive_decision_envelope_tx(
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

async fn close_run_tx(
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

async fn record_matured_adaptive_day_outcomes_tx(
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

async fn record_matured_adaptive_next_day_outcomes_tx(
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

fn bounded_overlap_seconds(start: &str, end: &str, lower: &str, upper: &str) -> i64 {
    let Some(start) = DateTime::parse_from_rfc3339(start).ok() else {
        return 0;
    };
    let Some(end) = DateTime::parse_from_rfc3339(end).ok() else {
        return 0;
    };
    let Some(lower) = DateTime::parse_from_rfc3339(lower).ok() else {
        return 0;
    };
    let Some(upper) = DateTime::parse_from_rfc3339(upper).ok() else {
        return 0;
    };
    let clipped_start = start.max(lower);
    let clipped_end = end.min(upper);
    (clipped_end - clipped_start).num_seconds().max(0)
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
    validate_rhythm_source(&run.rhythm_source, run.preset_key.as_deref())?;
    validate_run_rhythm(&run.rhythm)?;
    if let Some(idle_timeout) = run.idle_timeout_minutes {
        if idle_timeout < 0 {
            return Err("idle_timeout_minutes cannot be negative".to_string());
        }
    }
    if run.inherited_focus_minutes < 0 {
        return Err("inherited_focus_minutes cannot be negative".to_string());
    }
    if run.inherited_rhythm_position <= 0 {
        return Err("inherited_rhythm_position must be positive".to_string());
    }
    validate_start_trigger(&run.start_trigger)
}

fn validate_run_adaptive_snapshot_for_segment(
    run: &PomodoroRunWrite,
    segment: &PomodoroSegmentWrite,
) -> Result<(), String> {
    let Some(snapshot) = &run.adaptive_snapshot else {
        return Ok(());
    };
    require_non_empty(&snapshot.policy_id, "adaptive_snapshot.policy_id")?;
    validate_positive_version(snapshot.policy_version, "adaptive_snapshot.policy_version")?;
    validate_positive_version(snapshot.model_version, "adaptive_snapshot.model_version")?;

    let context = &snapshot.context_snapshot;
    require_non_empty(&context.id, "adaptive_snapshot.context_snapshot.id")?;
    require_non_empty(&context.run_id, "adaptive_snapshot.context_snapshot.run_id")?;
    if context.run_id != run.id {
        return Err("adaptive context run_id must match run id".to_string());
    }
    if let Some(segment_id) = &context.segment_id {
        if segment_id != &segment.id {
            return Err("adaptive context segment_id must match initial segment id".to_string());
        }
    }
    require_non_empty(
        &context.local_started_at,
        "adaptive_snapshot.context_snapshot.local_started_at",
    )?;
    validate_adaptive_time_of_day(&context.time_of_day)?;
    validate_adaptive_session_position(&context.session_position)?;
    validate_adaptive_event_length(&context.event_length)?;
    validate_adaptive_workload(&context.workload)?;
    validate_adaptive_energy(&context.energy)?;
    validate_adaptive_features(&context.features)?;
    validate_adaptive_data_quality_flags(&context.data_quality_flags)?;

    let decision = &snapshot.decision;
    require_non_empty(&decision.id, "adaptive_snapshot.decision.id")?;
    require_non_empty(&decision.policy_id, "adaptive_snapshot.decision.policy_id")?;
    require_non_empty(&decision.run_id, "adaptive_snapshot.decision.run_id")?;
    if decision.policy_id != snapshot.policy_id {
        return Err("adaptive decision policy_id must match snapshot policy_id".to_string());
    }
    if decision.run_id != run.id {
        return Err("adaptive decision run_id must match run id".to_string());
    }
    if let Some(segment_id) = &decision.segment_id {
        if segment_id != &segment.id {
            return Err("adaptive decision segment_id must match initial segment id".to_string());
        }
    }
    if decision.context_snapshot_id != context.id {
        return Err(
            "adaptive decision context_snapshot_id must match context snapshot id".to_string(),
        );
    }
    validate_optional_adaptive_candidate_id(&decision.candidate_id)?;
    validate_adaptive_opportunity_kind(&decision.opportunity_kind)?;
    validate_adaptive_decision_mode(&decision.decision_mode)?;
    validate_positive_version(
        decision.policy_version,
        "adaptive_snapshot.decision.policy_version",
    )?;
    validate_positive_version(
        decision.model_version,
        "adaptive_snapshot.decision.model_version",
    )?;
    if decision.policy_version != snapshot.policy_version {
        return Err(
            "adaptive decision policy_version must match snapshot policy_version".to_string(),
        );
    }
    if decision.model_version != snapshot.model_version {
        return Err(
            "adaptive decision model_version must match snapshot model_version".to_string(),
        );
    }
    require_non_empty(
        &decision.occurred_at,
        "adaptive_snapshot.decision.occurred_at",
    )?;
    validate_adaptive_decision_values(&decision.values)?;
    validate_adaptive_reason_codes(&decision.reason_codes)?;
    validate_adaptive_state_scores(&decision.state_scores)?;
    validate_adaptive_planned_blocks(&snapshot.planned_blocks, run)?;
    validate_adaptive_experiment_updates_for_policy(
        &snapshot.experiment_updates,
        &snapshot.policy_id,
    )?;
    validate_adaptive_experiment_assignments_for_context(
        &snapshot.experiment_assignments,
        &snapshot.policy_id,
        &context.id,
        &run.id,
        Some(&segment.id),
    )
}

fn validate_adaptive_decision_envelope_for_segment(
    envelope: &PomodoroAdaptiveDecisionEnvelopeWrite,
    segment: &PomodoroSegmentWrite,
) -> Result<(), String> {
    require_non_empty(&envelope.policy_id, "adaptive_decision.policy_id")?;
    validate_positive_version(envelope.policy_version, "adaptive_decision.policy_version")?;
    validate_positive_version(envelope.model_version, "adaptive_decision.model_version")?;

    let context = &envelope.context_snapshot;
    require_non_empty(&context.id, "adaptive_decision.context_snapshot.id")?;
    require_non_empty(&context.run_id, "adaptive_decision.context_snapshot.run_id")?;
    if context.run_id != segment.run_id {
        return Err("adaptive context run_id must match segment run_id".to_string());
    }
    if let Some(segment_id) = &context.segment_id {
        if segment_id != &segment.id {
            return Err("adaptive context segment_id must match segment id".to_string());
        }
    }
    require_non_empty(
        &context.local_started_at,
        "adaptive_decision.context_snapshot.local_started_at",
    )?;
    validate_adaptive_time_of_day(&context.time_of_day)?;
    validate_adaptive_session_position(&context.session_position)?;
    validate_adaptive_event_length(&context.event_length)?;
    validate_adaptive_workload(&context.workload)?;
    validate_adaptive_energy(&context.energy)?;
    validate_adaptive_features(&context.features)?;
    validate_adaptive_data_quality_flags(&context.data_quality_flags)?;

    let decision = &envelope.decision;
    require_non_empty(&decision.id, "adaptive_decision.decision.id")?;
    require_non_empty(&decision.policy_id, "adaptive_decision.decision.policy_id")?;
    require_non_empty(&decision.run_id, "adaptive_decision.decision.run_id")?;
    if decision.policy_id != envelope.policy_id {
        return Err("adaptive decision policy_id must match envelope policy_id".to_string());
    }
    if decision.run_id != segment.run_id {
        return Err("adaptive decision run_id must match segment run_id".to_string());
    }
    if let Some(segment_id) = &decision.segment_id {
        if segment_id != &segment.id {
            return Err("adaptive decision segment_id must match segment id".to_string());
        }
    }
    if decision.context_snapshot_id != context.id {
        return Err(
            "adaptive decision context_snapshot_id must match context snapshot id".to_string(),
        );
    }
    validate_optional_adaptive_candidate_id(&decision.candidate_id)?;
    validate_adaptive_opportunity_kind(&decision.opportunity_kind)?;
    match decision.opportunity_kind.as_str() {
        "focus_start" if segment.phase == "focus" => {}
        "break_start" if segment.phase == "short_break" || segment.phase == "long_break" => {}
        _ => {
            return Err(
                "adaptive boundary opportunity must match inserted segment phase".to_string(),
            )
        }
    }
    validate_adaptive_decision_mode(&decision.decision_mode)?;
    validate_positive_version(
        decision.policy_version,
        "adaptive_decision.decision.policy_version",
    )?;
    validate_positive_version(
        decision.model_version,
        "adaptive_decision.decision.model_version",
    )?;
    if decision.policy_version != envelope.policy_version {
        return Err(
            "adaptive decision policy_version must match envelope policy_version".to_string(),
        );
    }
    if decision.model_version != envelope.model_version {
        return Err(
            "adaptive decision model_version must match envelope model_version".to_string(),
        );
    }
    require_non_empty(
        &decision.occurred_at,
        "adaptive_decision.decision.occurred_at",
    )?;
    validate_adaptive_decision_values(&decision.values)?;
    validate_adaptive_reason_codes(&decision.reason_codes)?;
    validate_adaptive_state_scores(&decision.state_scores)?;
    validate_adaptive_experiment_updates_for_policy(
        &envelope.experiment_updates,
        &envelope.policy_id,
    )?;
    validate_adaptive_experiment_assignments_for_context(
        &envelope.experiment_assignments,
        &envelope.policy_id,
        &context.id,
        &segment.run_id,
        Some(&segment.id),
    )
}

fn validate_adaptive_experiment_updates_for_policy(
    experiments: &[PomodoroAdaptiveExperimentWrite],
    policy_id: &str,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    for experiment in experiments {
        validate_adaptive_experiment(experiment, policy_id)?;
        if !seen.insert(experiment.id.as_str()) {
            return Err("adaptive experiment updated more than once".to_string());
        }
    }
    Ok(())
}

fn validate_adaptive_experiment_assignments_for_context(
    assignments: &[PomodoroAdaptiveExperimentAssignmentWrite],
    policy_id: &str,
    context_snapshot_id: &str,
    run_id: &str,
    segment_id: Option<&str>,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    for envelope in assignments {
        validate_adaptive_experiment_assignment(
            envelope,
            policy_id,
            context_snapshot_id,
            run_id,
            segment_id,
        )?;
        if !seen.insert(envelope.assignment.experiment_id.as_str()) {
            return Err("adaptive experiment assigned more than once".to_string());
        }
    }
    Ok(())
}

fn validate_adaptive_experiment_assignment(
    envelope: &PomodoroAdaptiveExperimentAssignmentWrite,
    policy_id: &str,
    context_snapshot_id: &str,
    run_id: &str,
    segment_id: Option<&str>,
) -> Result<(), String> {
    let experiment = &envelope.experiment;
    let assignment = &envelope.assignment;
    validate_adaptive_experiment(experiment, policy_id)?;
    require_non_empty(&assignment.id, "adaptive_assignment.id")?;
    require_non_empty(
        &assignment.experiment_id,
        "adaptive_assignment.experiment_id",
    )?;
    require_non_empty(&assignment.variant_key, "adaptive_assignment.variant_key")?;
    require_non_empty(&assignment.run_id, "adaptive_assignment.run_id")?;
    require_non_empty(
        &assignment.context_snapshot_id,
        "adaptive_assignment.context_snapshot_id",
    )?;
    require_non_empty(
        &assignment.assignment_seed,
        "adaptive_assignment.assignment_seed",
    )?;
    require_non_empty(&assignment.assigned_at, "adaptive_assignment.assigned_at")?;
    if assignment.experiment_id != experiment.id {
        return Err("adaptive assignment experiment_id must match experiment id".to_string());
    }
    if assignment.run_id != run_id {
        return Err("adaptive assignment run_id must match run id".to_string());
    }
    if assignment.context_snapshot_id != context_snapshot_id {
        return Err(
            "adaptive assignment context_snapshot_id must match context snapshot id".to_string(),
        );
    }
    if assignment.segment_id.as_deref() != segment_id {
        return Err("adaptive assignment segment_id must match segment id".to_string());
    }
    if !experiment
        .variants
        .iter()
        .any(|variant| variant.variant_key == assignment.variant_key)
    {
        return Err("adaptive assignment variant_key must exist in experiment".to_string());
    }
    Ok(())
}

fn validate_adaptive_experiment(
    experiment: &PomodoroAdaptiveExperimentWrite,
    policy_id: &str,
) -> Result<(), String> {
    require_non_empty(&experiment.id, "adaptive_experiment.id")?;
    require_non_empty(&experiment.policy_id, "adaptive_experiment.policy_id")?;
    if experiment.policy_id != policy_id {
        return Err("adaptive experiment policy_id must match policy id".to_string());
    }
    validate_adaptive_experiment_parameter_key(&experiment.parameter_key)?;
    validate_adaptive_assignment_unit(&experiment.assignment_unit)?;
    validate_adaptive_experiment_status(&experiment.status)?;
    if let Some(started_at) = &experiment.started_at {
        require_non_empty(started_at, "adaptive_experiment.started_at")?;
    }
    if let Some(ended_at) = &experiment.ended_at {
        require_non_empty(ended_at, "adaptive_experiment.ended_at")?;
    }
    let terminal_status = experiment.status == "completed" || experiment.status == "abandoned";
    if terminal_status && experiment.ended_at.is_none() {
        return Err("terminal adaptive experiment status needs ended_at".to_string());
    }
    if !terminal_status && experiment.ended_at.is_some() {
        return Err("non-terminal adaptive experiment status cannot have ended_at".to_string());
    }
    if experiment.variants.len() < 2 {
        return Err("adaptive experiment must include at least two variants".to_string());
    }
    let mut control_count = 0;
    let mut variant_keys = HashSet::new();
    for variant in &experiment.variants {
        require_non_empty(
            &variant.variant_key,
            "adaptive_experiment_variant.variant_key",
        )?;
        if !variant.numeric_value.is_finite() {
            return Err("adaptive experiment variant numeric_value must be finite".to_string());
        }
        if variant.is_control {
            control_count += 1;
        }
        if !variant_keys.insert(variant.variant_key.as_str()) {
            return Err("adaptive experiment variants must be unique".to_string());
        }
    }
    if control_count != 1 {
        return Err("adaptive experiment must include exactly one control variant".to_string());
    }
    Ok(())
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

fn validate_active_event_reference_transfer(
    transfer: &PomodoroActiveEventReferenceTransfer,
) -> Result<(), String> {
    canonical_event_id(&transfer.new_event_id)?;
    if let Some(date) = &transfer.new_event_date {
        require_non_empty(date, "transfer.new_event_date")?;
    }
    if let Some(planned_end) = &transfer.planned_end {
        require_non_empty(planned_end, "transfer.planned_end")?;
    }
    Ok(())
}

fn validate_segment_write(segment: &PomodoroSegmentWrite) -> Result<(), String> {
    require_non_empty(&segment.id, "id")?;
    canonical_event_id(&segment.event_id)?;
    require_non_empty(&segment.event_date, "event_date")?;
    require_non_empty(&segment.run_id, "run_id")?;
    if segment.rhythm_position <= 0 {
        return Err("rhythm_position must be positive".to_string());
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
        "completed" | "stopped" | "skipped_by_user" | "event_expired" | "focus_failed"
        | "reconfigured" | "block_transition" | "crash_recovery" => Ok(()),
        _ => Err(format!("invalid pomodoro segment end reason: {reason}")),
    }
}

fn validate_start_trigger(trigger: &str) -> Result<(), String> {
    match trigger {
        "manual" | "block_auto" | "block_transition" | "reconfigure" | "crash_recovery" => Ok(()),
        _ => Err(format!("invalid pomodoro start trigger: {trigger}")),
    }
}

fn validate_run_rhythm(rhythm: &PomodoroRunRhythm) -> Result<(), String> {
    match rhythm {
        PomodoroRunRhythm::Count {
            focus_duration_minutes,
            short_break_minutes,
            long_break_minutes,
            long_break_after_focus_count,
        } => {
            validate_config_minutes(*focus_duration_minutes, "focus_duration_minutes")?;
            validate_config_minutes(*short_break_minutes, "short_break_minutes")?;
            validate_config_minutes(*long_break_minutes, "long_break_minutes")?;
            validate_rhythm_position_count(
                *long_break_after_focus_count,
                "long_break_after_focus_count",
            )
        }
        PomodoroRunRhythm::Sequence { steps } => {
            if steps.is_empty() {
                return Err("sequence rhythm must include at least one step".to_string());
            }
            validate_rhythm_position_count(steps.len() as i64, "sequence step count")?;
            for (index, step) in steps.iter().enumerate() {
                validate_config_minutes(
                    step.focus_duration_minutes,
                    &format!("sequence step {index} focus_duration_minutes"),
                )?;
                validate_phase(&step.break_phase)?;
                validate_config_minutes(
                    step.break_duration_minutes,
                    &format!("sequence step {index} break_duration_minutes"),
                )?;
            }
            Ok(())
        }
    }
}

fn validate_rhythm_source(source: &str, preset_key: Option<&str>) -> Result<(), String> {
    match source {
        "preset" => {
            let Some(key) = preset_key else {
                return Err("preset rhythm_source requires preset_key".to_string());
            };
            match key {
                "adaptive" | "creative" | "balanced" | "deep" | "extended" => Ok(()),
                _ => Err(format!("invalid preset_key: {key}")),
            }
        }
        "custom" => {
            if preset_key.is_some() {
                return Err("custom rhythm_source cannot include preset_key".to_string());
            }
            Ok(())
        }
        _ => Err(format!("invalid rhythm_source: {source}")),
    }
}

fn validate_rhythm_position_count(value: i64, field: &str) -> Result<(), String> {
    if !(1..=12).contains(&value) {
        Err(format!("{field} must be between 1 and 12"))
    } else {
        Ok(())
    }
}

fn validate_event_type(event_type: &str) -> Result<(), String> {
    match event_type {
        "start" | "phase_start" | "phase_complete" | "pause_start" | "pause_end"
        | "idle_detected" | "focus_failed" | "suspend_detected" | "skip_break" | "extend_focus"
        | "go_to_break_now" | "start_focus_now" | "reconfigure" | "block_transition" | "stop"
        | "complete" | "crash_recovery" => Ok(()),
        _ => Err(format!("invalid pomodoro run event type: {event_type}")),
    }
}

fn validate_positive_version(value: i64, field: &str) -> Result<(), String> {
    if value <= 0 {
        Err(format!("{field} must be positive"))
    } else {
        Ok(())
    }
}

fn validate_adaptive_history_limit(value: i64) -> Result<(), String> {
    if !(1..=240).contains(&value) {
        Err("adaptive history segment_limit must be between 1 and 240".to_string())
    } else {
        Ok(())
    }
}

fn validate_adaptive_replay_limit(value: i64) -> Result<(), String> {
    if !(1..=100).contains(&value) {
        Err("adaptive replay limit must be between 1 and 100".to_string())
    } else {
        Ok(())
    }
}

fn validate_adaptive_time_of_day(value: &str) -> Result<(), String> {
    match value {
        "morning" | "midday" | "afternoon" | "evening" | "late" => Ok(()),
        _ => Err(format!("invalid adaptive time_of_day: {value}")),
    }
}

fn validate_adaptive_session_position(value: &str) -> Result<(), String> {
    match value {
        "first" | "middle" | "late" => Ok(()),
        _ => Err(format!("invalid adaptive session_position: {value}")),
    }
}

fn validate_adaptive_event_length(value: &str) -> Result<(), String> {
    match value {
        "short" | "medium" | "long" => Ok(()),
        _ => Err(format!("invalid adaptive event_length: {value}")),
    }
}

fn validate_adaptive_workload(value: &str) -> Result<(), String> {
    match value {
        "low" | "normal" | "high" => Ok(()),
        _ => Err(format!("invalid adaptive workload: {value}")),
    }
}

fn validate_adaptive_energy(value: &str) -> Result<(), String> {
    match value {
        "low" | "normal" | "high" | "unknown" => Ok(()),
        _ => Err(format!("invalid adaptive energy: {value}")),
    }
}

fn validate_adaptive_opportunity_kind(value: &str) -> Result<(), String> {
    match value {
        "run_start" | "focus_start" | "break_start" | "focus_tick" | "break_overtime"
        | "block_event" | "idle_failure" | "run_outcome" => Ok(()),
        _ => Err(format!("invalid adaptive opportunity_kind: {value}")),
    }
}

fn validate_adaptive_decision_mode(value: &str) -> Result<(), String> {
    match value {
        "fallback" | "hold" | "recovery" | "guardrail" | "exploit" | "explore" => Ok(()),
        _ => Err(format!("invalid adaptive decision_mode: {value}")),
    }
}

fn validate_adaptive_feature_source(value: &str) -> Result<(), String> {
    match value {
        "pomodoro" | "doomscrolling" | "calendar" | "diary" | "project" | "environment"
        | "device" => Ok(()),
        _ => Err(format!("invalid adaptive feature source_kind: {value}")),
    }
}

fn validate_adaptive_planned_block_source(value: &str) -> Result<(), String> {
    match value {
        "live_event" | "archived_event" | "scheduler_snapshot" => Ok(()),
        _ => Err(format!(
            "invalid adaptive planned block source_kind: {value}"
        )),
    }
}

fn validate_adaptive_data_quality_flag(value: &str) -> Result<(), String> {
    match value {
        "extension_unavailable"
        | "desktop_tracking_unavailable"
        | "diary_missing"
        | "idle_detection_disabled"
        | "crash_recovered"
        | "calendar_clipped" => Ok(()),
        _ => Err(format!("invalid adaptive data quality flag: {value}")),
    }
}

fn validate_adaptive_parameter_key(value: &str) -> Result<(), String> {
    match value {
        "focus_duration_minutes"
        | "short_break_minutes"
        | "long_break_minutes"
        | "long_break_after_focus_count" => Ok(()),
        _ => Err(format!("invalid adaptive value_key: {value}")),
    }
}

fn validate_adaptive_experiment_parameter_key(value: &str) -> Result<(), String> {
    match value {
        "rhythm_bundle" => Ok(()),
        _ => validate_adaptive_parameter_key(value)
            .map_err(|_| format!("invalid adaptive experiment parameter_key: {value}")),
    }
}

fn validate_adaptive_value_unit(value: &str) -> Result<(), String> {
    match value {
        "minutes" | "count" => Ok(()),
        _ => Err(format!("invalid adaptive value_unit: {value}")),
    }
}

fn validate_adaptive_assignment_unit(value: &str) -> Result<(), String> {
    match value {
        "phase" | "run" | "day" | "context" => Ok(()),
        _ => Err(format!("invalid adaptive assignment_unit: {value}")),
    }
}

fn validate_adaptive_experiment_status(value: &str) -> Result<(), String> {
    match value {
        "draft" | "active" | "paused" | "completed" | "abandoned" => Ok(()),
        _ => Err(format!("invalid adaptive experiment status: {value}")),
    }
}

fn validate_adaptive_reason_code(value: &str) -> Result<(), String> {
    match value {
        "no_history"
        | "low_confidence"
        | "missing_extension_data"
        | "missing_diary_data"
        | "high_strain"
        | "high_avoidance_pressure"
        | "high_recovery_debt"
        | "clean_momentum"
        | "break_return_drift"
        | "break_transition_pressure"
        | "skipped_break_recovery"
        | "focus_idle_pressure"
        | "repeated_blocked_source_pressure"
        | "capacity_rebuild"
        | "experiment_assignment"
        | "experiment_guardrail"
        | "guardrail_recovery"
        | "replay_candidate"
        | "hold_current_rhythm" => Ok(()),
        _ => Err(format!("invalid adaptive reason_code: {value}")),
    }
}

fn validate_optional_adaptive_candidate_id(value: &Option<String>) -> Result<(), String> {
    if let Some(candidate_id) = value {
        require_non_empty(candidate_id, "adaptive decision candidate_id")?;
    }
    Ok(())
}

fn validate_adaptive_features(features: &[PomodoroAdaptiveFeatureWrite]) -> Result<(), String> {
    let mut keys = HashSet::new();
    for feature in features {
        require_non_empty(&feature.feature_key, "adaptive feature feature_key")?;
        if !keys.insert(feature.feature_key.as_str()) {
            return Err(format!(
                "duplicate adaptive feature: {}",
                feature.feature_key
            ));
        }
        if let Some(value) = feature.numeric_value {
            validate_finite(value, "adaptive feature numeric_value")?;
        }
        if !feature.missing
            && feature.numeric_value.is_none()
            && feature.categorical_value.is_none()
            && feature.boolean_value.is_none()
        {
            return Err(format!(
                "adaptive feature {} needs a value",
                feature.feature_key
            ));
        }
        validate_adaptive_feature_source(&feature.source_kind)?;
    }
    Ok(())
}

fn validate_adaptive_data_quality_flags(flags: &[String]) -> Result<(), String> {
    let mut seen = HashSet::new();
    for flag in flags {
        validate_adaptive_data_quality_flag(flag)?;
        if !seen.insert(flag.as_str()) {
            return Err(format!("duplicate adaptive data quality flag: {flag}"));
        }
    }
    Ok(())
}

fn validate_adaptive_planned_blocks(
    blocks: &[PomodoroAdaptivePlannedBlockWrite],
    run: &PomodoroRunWrite,
) -> Result<(), String> {
    if blocks.len() > MAX_ADAPTIVE_PLANNED_BLOCKS_PER_SNAPSHOT {
        return Err(format!(
            "adaptive planned block snapshot exceeds {} rows",
            MAX_ADAPTIVE_PLANNED_BLOCKS_PER_SNAPSHOT
        ));
    }
    let mut seen = HashSet::new();
    for block in blocks {
        require_non_empty(&block.event_date, "adaptive planned block event_date")?;
        if block.event_date != run.event_date {
            return Err("adaptive planned block event_date must match run event_date".to_string());
        }
        if let Some(event_id) = &block.event_id {
            require_non_empty(event_id, "adaptive planned block event_id")?;
        }
        require_non_empty(
            &block.original_event_id,
            "adaptive planned block original_event_id",
        )?;
        require_non_empty(&block.planned_start, "adaptive planned block planned_start")?;
        require_non_empty(&block.planned_end, "adaptive planned block planned_end")?;
        let Some(duration_seconds) = iso_seconds_between(&block.planned_start, &block.planned_end)
        else {
            return Err("adaptive planned block timestamps must be valid instants".to_string());
        };
        if duration_seconds <= 0 {
            return Err(
                "adaptive planned block planned_end must be after planned_start".to_string(),
            );
        }
        validate_adaptive_planned_block_source(&block.source_kind)?;
        let key = format!("{}|{}", block.original_event_id, block.planned_start);
        if !seen.insert(key) {
            return Err(format!(
                "duplicate adaptive planned block: {} at {}",
                block.original_event_id, block.planned_start
            ));
        }
    }
    Ok(())
}

fn validate_adaptive_decision_values(
    values: &[PomodoroAdaptiveDecisionValueWrite],
) -> Result<(), String> {
    if values.is_empty() {
        return Err("adaptive decision must include selected values".to_string());
    }
    let mut keys = HashSet::new();
    for value in values {
        validate_adaptive_parameter_key(&value.value_key)?;
        if !keys.insert(value.value_key.as_str()) {
            return Err(format!(
                "duplicate adaptive decision value: {}",
                value.value_key
            ));
        }
        if let Some(previous) = value.previous_numeric_value {
            validate_finite(previous, "adaptive decision previous_numeric_value")?;
        }
        validate_finite(
            value.selected_numeric_value,
            "adaptive decision selected_numeric_value",
        )?;
        validate_adaptive_value_unit(&value.value_unit)?;
    }
    Ok(())
}

fn validate_adaptive_reason_codes(reason_codes: &[String]) -> Result<(), String> {
    if reason_codes.is_empty() {
        return Err("adaptive decision must include at least one reason_code".to_string());
    }
    let mut seen = HashSet::new();
    for reason_code in reason_codes {
        validate_adaptive_reason_code(reason_code)?;
        if !seen.insert(reason_code.as_str()) {
            return Err(format!("duplicate adaptive reason_code: {reason_code}"));
        }
    }
    Ok(())
}

fn validate_adaptive_state_scores(scores: &PomodoroAdaptiveStateScoresWrite) -> Result<(), String> {
    validate_score(scores.readiness, "adaptive state readiness")?;
    validate_score(scores.strain, "adaptive state strain")?;
    validate_score(scores.recovery_debt, "adaptive state recovery_debt")?;
    validate_score(
        scores.avoidance_pressure,
        "adaptive state avoidance_pressure",
    )?;
    validate_score(scores.momentum, "adaptive state momentum")?;
    validate_score(scores.confidence, "adaptive state confidence")
}

fn validate_score(value: f64, field: &str) -> Result<(), String> {
    validate_finite(value, field)?;
    if !(0.0..=1.0).contains(&value) {
        Err(format!("{field} must be between 0 and 1"))
    } else {
        Ok(())
    }
}

fn validate_finite(value: f64, field: &str) -> Result<(), String> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(format!("{field} must be finite"))
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

fn synthetic_event_date(value: &str) -> Option<&str> {
    value
        .split_once("::")
        .map(|(_, date)| date)
        .filter(|date| !date.trim().is_empty())
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

fn iso_is_before(left: &str, right: &str) -> bool {
    let Some(left) = DateTime::parse_from_rfc3339(left).ok() else {
        return false;
    };
    let Some(right) = DateTime::parse_from_rfc3339(right).ok() else {
        return false;
    };
    left < right
}

fn normalize_pause_write(mut pause: PomodoroPauseWrite) -> PomodoroPauseWrite {
    if pause
        .ended_at
        .as_deref()
        .is_some_and(|ended_at| iso_is_before(ended_at, &pause.started_at))
    {
        pause.ended_at = Some(pause.started_at.clone());
    }
    pause
}

fn normalize_segment_update(mut segment: PomodoroSegmentUpdate) -> PomodoroSegmentUpdate {
    if let (Some(start), Some(end)) = (&segment.actual_start, &segment.actual_end) {
        if iso_is_before(end, start) {
            segment.actual_end = Some(start.clone());
        }
    }
    segment.pauses = segment
        .pauses
        .into_iter()
        .map(normalize_pause_write)
        .collect();
    segment
}

#[cfg(test)]
mod tests {
    use crate::db::run_migrations;

    use super::{
        canonical_event_id, close_run_tx, insert_adaptive_decision_envelope_tx,
        insert_run_event_tx, insert_run_tx, insert_segment_tx, load_adaptive_history_from_pool,
        load_adaptive_replay_dataset_from_pool, normalize_segment_update,
        record_matured_adaptive_day_outcomes_tx, record_matured_adaptive_next_day_outcomes_tx,
        validate_adaptive_decision_envelope_for_segment, validate_event_type,
        validate_pause_reason, validate_phase, validate_run_end_reason, validate_run_window_update,
        validate_segment_end_reason, validate_status, PomodoroAdaptiveAssignmentWrite,
        PomodoroAdaptiveContextSnapshotWrite, PomodoroAdaptiveDecisionEnvelopeWrite,
        PomodoroAdaptiveDecisionValueWrite, PomodoroAdaptiveDecisionWrite,
        PomodoroAdaptiveExperimentAssignmentWrite, PomodoroAdaptiveExperimentVariantWrite,
        PomodoroAdaptiveExperimentWrite, PomodoroAdaptiveFeatureWrite,
        PomodoroAdaptivePlannedBlockWrite, PomodoroAdaptiveStateScoresWrite, PomodoroPauseWrite,
        PomodoroRunAdaptiveSnapshotWrite, PomodoroRunClosure, PomodoroRunRhythm,
        PomodoroRunSequenceStep, PomodoroRunWindowUpdate, PomodoroRunWrite, PomodoroSegmentUpdate,
        PomodoroSegmentWrite, RunEventInsert,
    };
    use sqlx::Row;

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
    fn normalizes_inverted_segment_update_intervals() {
        let normalized = normalize_segment_update(PomodoroSegmentUpdate {
            id: "segment-1".to_string(),
            status: "interrupted".to_string(),
            planned_end: "2026-05-29T10:40:00Z".to_string(),
            actual_start: Some("2026-05-29T10:05:00Z".to_string()),
            actual_end: Some("2026-05-29T10:00:00Z".to_string()),
            end_reason: Some("stopped".to_string()),
            occurred_at: Some("2026-05-29T10:00:00Z".to_string()),
            pauses: vec![PomodoroPauseWrite {
                started_at: "2026-05-29T10:05:00Z".to_string(),
                ended_at: Some("2026-05-29T10:04:00Z".to_string()),
                reason: "idle".to_string(),
            }],
        });

        assert_eq!(
            normalized.actual_end,
            Some("2026-05-29T10:05:00Z".to_string())
        );
        assert_eq!(
            normalized.pauses[0].ended_at,
            Some("2026-05-29T10:05:00Z".to_string())
        );
    }

    async fn migrated_pool_with_event() -> sqlx::SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql("PRAGMA foreign_keys=ON")
            .execute(&pool)
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO calendar_events (id, title, start_time, end_time)
             VALUES ('event-1', 'Focus block', '2026-05-29T10:00:00Z', '2026-05-29T11:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn run_write(rhythm: PomodoroRunRhythm) -> PomodoroRunWrite {
        PomodoroRunWrite {
            id: "run-1".to_string(),
            event_id: "event-1".to_string(),
            event_date: "2026-05-29".to_string(),
            planned_start: "2026-05-29T10:00:00Z".to_string(),
            planned_end: "2026-05-29T11:00:00Z".to_string(),
            started_at: "2026-05-29T10:00:00Z".to_string(),
            rhythm,
            rhythm_source: "custom".to_string(),
            preset_key: None,
            idle_timeout_minutes: Some(3),
            event_title_snapshot: Some("Focus block".to_string()),
            inherited_focus_minutes: 0,
            inherited_rhythm_position: 1,
            inherited_from_run_id: None,
            start_trigger: "manual".to_string(),
            adaptive_snapshot: None,
        }
    }

    fn initial_segment() -> PomodoroSegmentWrite {
        PomodoroSegmentWrite {
            id: "segment-1".to_string(),
            event_id: "event-1".to_string(),
            event_date: "2026-05-29".to_string(),
            run_id: "run-1".to_string(),
            rhythm_position: 1,
            phase: "focus".to_string(),
            planned_start: "2026-05-29T10:00:00Z".to_string(),
            planned_end: "2026-05-29T10:40:00Z".to_string(),
            actual_start: Some("2026-05-29T10:00:00Z".to_string()),
            actual_end: None,
            pauses: Vec::new(),
            status: "active".to_string(),
            end_reason: None,
        }
    }

    fn adaptive_snapshot() -> PomodoroRunAdaptiveSnapshotWrite {
        PomodoroRunAdaptiveSnapshotWrite {
            policy_id: "local-adaptive-policy-v1".to_string(),
            policy_version: 1,
            model_version: 1,
            context_snapshot: PomodoroAdaptiveContextSnapshotWrite {
                id: "context-1".to_string(),
                run_id: "run-1".to_string(),
                segment_id: Some("segment-1".to_string()),
                local_started_at: "2026-05-29T10:00:00Z".to_string(),
                time_of_day: "morning".to_string(),
                session_position: "first".to_string(),
                event_length: "medium".to_string(),
                workload: "low".to_string(),
                energy: "unknown".to_string(),
                environment_id: None,
                features: vec![PomodoroAdaptiveFeatureWrite {
                    feature_key: "comparable_opportunity_count".to_string(),
                    numeric_value: Some(0.0),
                    categorical_value: None,
                    boolean_value: None,
                    missing: false,
                    source_kind: "pomodoro".to_string(),
                }],
                data_quality_flags: vec!["diary_missing".to_string()],
            },
            decision: PomodoroAdaptiveDecisionWrite {
                id: "decision-1".to_string(),
                policy_id: "local-adaptive-policy-v1".to_string(),
                run_id: "run-1".to_string(),
                segment_id: Some("segment-1".to_string()),
                context_snapshot_id: "context-1".to_string(),
                opportunity_kind: "run_start".to_string(),
                candidate_id: None,
                decision_mode: "fallback".to_string(),
                policy_version: 1,
                model_version: 1,
                occurred_at: "2026-05-29T10:00:00Z".to_string(),
                values: vec![
                    adaptive_value("focus_duration_minutes", 40.0, "minutes"),
                    adaptive_value("short_break_minutes", 5.0, "minutes"),
                    adaptive_value("long_break_minutes", 10.0, "minutes"),
                    adaptive_value("long_break_after_focus_count", 4.0, "count"),
                ],
                reason_codes: vec!["no_history".to_string(), "missing_diary_data".to_string()],
                state_scores: PomodoroAdaptiveStateScoresWrite {
                    readiness: 0.0,
                    strain: 0.0,
                    recovery_debt: 0.0,
                    avoidance_pressure: 0.0,
                    momentum: 0.0,
                    confidence: 0.0,
                },
            },
            planned_blocks: Vec::new(),
            experiment_updates: Vec::new(),
            experiment_assignments: Vec::new(),
        }
    }

    fn adaptive_boundary_envelope(
        segment: &PomodoroSegmentWrite,
    ) -> PomodoroAdaptiveDecisionEnvelopeWrite {
        PomodoroAdaptiveDecisionEnvelopeWrite {
            policy_id: "local-adaptive-policy-v1".to_string(),
            policy_version: 1,
            model_version: 1,
            context_snapshot: PomodoroAdaptiveContextSnapshotWrite {
                id: "context-boundary-1".to_string(),
                run_id: segment.run_id.clone(),
                segment_id: Some(segment.id.clone()),
                local_started_at: "2026-05-29T10:40:00Z".to_string(),
                time_of_day: "morning".to_string(),
                session_position: "first".to_string(),
                event_length: "medium".to_string(),
                workload: "low".to_string(),
                energy: "unknown".to_string(),
                environment_id: None,
                features: vec![PomodoroAdaptiveFeatureWrite {
                    feature_key: "comparable_opportunity_count".to_string(),
                    numeric_value: Some(4.0),
                    categorical_value: None,
                    boolean_value: None,
                    missing: false,
                    source_kind: "pomodoro".to_string(),
                }],
                data_quality_flags: vec!["diary_missing".to_string()],
            },
            decision: PomodoroAdaptiveDecisionWrite {
                id: "decision-boundary-1".to_string(),
                policy_id: "local-adaptive-policy-v1".to_string(),
                run_id: segment.run_id.clone(),
                segment_id: Some(segment.id.clone()),
                context_snapshot_id: "context-boundary-1".to_string(),
                opportunity_kind: "break_start".to_string(),
                candidate_id: None,
                decision_mode: "hold".to_string(),
                policy_version: 1,
                model_version: 1,
                occurred_at: "2026-05-29T10:40:00Z".to_string(),
                values: vec![
                    adaptive_value("focus_duration_minutes", 40.0, "minutes"),
                    adaptive_value("short_break_minutes", 5.0, "minutes"),
                    adaptive_value("long_break_minutes", 10.0, "minutes"),
                    adaptive_value("long_break_after_focus_count", 4.0, "count"),
                ],
                reason_codes: vec!["hold_current_rhythm".to_string()],
                state_scores: PomodoroAdaptiveStateScoresWrite {
                    readiness: 0.5,
                    strain: 0.1,
                    recovery_debt: 0.1,
                    avoidance_pressure: 0.1,
                    momentum: 0.6,
                    confidence: 0.5,
                },
            },
            experiment_updates: Vec::new(),
            experiment_assignments: Vec::new(),
        }
    }

    fn adaptive_snapshot_with_assignment() -> PomodoroRunAdaptiveSnapshotWrite {
        let mut snapshot = adaptive_snapshot();
        snapshot.decision.decision_mode = "explore".to_string();
        snapshot
            .decision
            .reason_codes
            .push("experiment_assignment".to_string());
        snapshot.decision.values[0].selected_numeric_value = 45.0;
        snapshot.experiment_assignments = vec![PomodoroAdaptiveExperimentAssignmentWrite {
            experiment: adaptive_experiment("active"),
            assignment: PomodoroAdaptiveAssignmentWrite {
                id: "assignment-1".to_string(),
                experiment_id: "run-focus-duration-40-vs-45-v1".to_string(),
                variant_key: "focus_45".to_string(),
                run_id: "run-1".to_string(),
                segment_id: Some("segment-1".to_string()),
                context_snapshot_id: "context-1".to_string(),
                assignment_seed: "seed-1".to_string(),
                assigned_at: "2026-05-29T10:00:00Z".to_string(),
            },
        }];
        snapshot
    }

    fn adaptive_experiment(status: &str) -> PomodoroAdaptiveExperimentWrite {
        PomodoroAdaptiveExperimentWrite {
            id: "run-focus-duration-40-vs-45-v1".to_string(),
            policy_id: "local-adaptive-policy-v1".to_string(),
            parameter_key: "focus_duration_minutes".to_string(),
            assignment_unit: "run".to_string(),
            status: status.to_string(),
            started_at: Some("2026-05-29T10:00:00Z".to_string()),
            ended_at: if status == "completed" || status == "abandoned" {
                Some("2026-05-29T10:00:00Z".to_string())
            } else {
                None
            },
            variants: vec![
                PomodoroAdaptiveExperimentVariantWrite {
                    variant_key: "control_40".to_string(),
                    numeric_value: 40.0,
                    is_control: true,
                },
                PomodoroAdaptiveExperimentVariantWrite {
                    variant_key: "focus_45".to_string(),
                    numeric_value: 45.0,
                    is_control: false,
                },
            ],
        }
    }

    fn adaptive_bundle_experiment(status: &str) -> PomodoroAdaptiveExperimentWrite {
        PomodoroAdaptiveExperimentWrite {
            id: "run-focus-short-break-support-40-5-vs-45-7-v1".to_string(),
            policy_id: "local-adaptive-policy-v1".to_string(),
            parameter_key: "rhythm_bundle".to_string(),
            assignment_unit: "run".to_string(),
            status: status.to_string(),
            started_at: Some("2026-05-29T10:00:00Z".to_string()),
            ended_at: if status == "completed" || status == "abandoned" {
                Some("2026-05-29T10:00:00Z".to_string())
            } else {
                None
            },
            variants: vec![
                PomodoroAdaptiveExperimentVariantWrite {
                    variant_key: "control_40_5".to_string(),
                    numeric_value: 0.0,
                    is_control: true,
                },
                PomodoroAdaptiveExperimentVariantWrite {
                    variant_key: "focus_45_short_break_7".to_string(),
                    numeric_value: 1.0,
                    is_control: false,
                },
            ],
        }
    }

    fn adaptive_value(
        value_key: &str,
        selected_numeric_value: f64,
        value_unit: &str,
    ) -> PomodoroAdaptiveDecisionValueWrite {
        PomodoroAdaptiveDecisionValueWrite {
            value_key: value_key.to_string(),
            previous_numeric_value: Some(selected_numeric_value),
            selected_numeric_value,
            value_unit: value_unit.to_string(),
        }
    }

    fn adaptive_planned_block() -> PomodoroAdaptivePlannedBlockWrite {
        PomodoroAdaptivePlannedBlockWrite {
            event_date: "2026-05-29".to_string(),
            event_id: Some("event-1::2026-05-29".to_string()),
            original_event_id: "event-1".to_string(),
            planned_start: "2026-05-29T10:00:00Z".to_string(),
            planned_end: "2026-05-29T11:00:00Z".to_string(),
            source_kind: "scheduler_snapshot".to_string(),
        }
    }

    #[test]
    fn insert_run_snapshots_count_rhythm() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            tx.commit().await.unwrap();

            let saved: (String, i64, i64) = sqlx::query_as(
                "SELECT r.rhythm_kind, c.focus_duration_minutes, c.long_break_after_focus_count
                 FROM pomodoro_runs r
                 JOIN pomodoro_run_count_rhythms c ON c.run_id = r.id
                 WHERE r.id = 'run-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(saved, ("count".to_string(), 40, 4));
        });
    }

    #[test]
    fn insert_run_records_adaptive_experiment_assignment() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 45,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            run.rhythm_source = "preset".to_string();
            run.preset_key = Some("adaptive".to_string());
            run.adaptive_snapshot = Some(adaptive_snapshot_with_assignment());
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            tx.commit().await.unwrap();

            let assignment: (String, String, String) = sqlx::query_as(
                "SELECT experiment_id, variant_key, assignment_seed
                 FROM pomodoro_adaptive_assignments
                 WHERE id = 'assignment-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(
                assignment,
                (
                    "run-focus-duration-40-vs-45-v1".to_string(),
                    "focus_45".to_string(),
                    "seed-1".to_string()
                )
            );

            let variant_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)
                 FROM pomodoro_adaptive_experiment_variants
                 WHERE experiment_id = 'run-focus-duration-40-vs-45-v1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(variant_count, 2);

            let selected_focus: f64 = sqlx::query_scalar(
                "SELECT selected_numeric_value
                 FROM pomodoro_adaptive_decision_values
                 WHERE decision_id = 'decision-1'
                   AND value_key = 'focus_duration_minutes'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(selected_focus, 45.0);
        });
    }

    #[test]
    fn insert_run_records_adaptive_bundle_experiment_assignment() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 45,
                short_break_minutes: 7,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            run.rhythm_source = "preset".to_string();
            run.preset_key = Some("adaptive".to_string());
            let mut snapshot = adaptive_snapshot();
            snapshot.decision.decision_mode = "explore".to_string();
            snapshot
                .decision
                .reason_codes
                .push("experiment_assignment".to_string());
            snapshot.decision.values[0].selected_numeric_value = 45.0;
            snapshot.decision.values[1].selected_numeric_value = 7.0;
            snapshot.experiment_assignments = vec![PomodoroAdaptiveExperimentAssignmentWrite {
                experiment: adaptive_bundle_experiment("active"),
                assignment: PomodoroAdaptiveAssignmentWrite {
                    id: "assignment-bundle".to_string(),
                    experiment_id: "run-focus-short-break-support-40-5-vs-45-7-v1".to_string(),
                    variant_key: "focus_45_short_break_7".to_string(),
                    run_id: "run-1".to_string(),
                    segment_id: Some("segment-1".to_string()),
                    context_snapshot_id: "context-1".to_string(),
                    assignment_seed: "seed-bundle".to_string(),
                    assigned_at: "2026-05-29T10:00:00Z".to_string(),
                },
            }];
            run.adaptive_snapshot = Some(snapshot);
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            tx.commit().await.unwrap();

            let experiment: (String, String) = sqlx::query_as(
                "SELECT parameter_key, status
                 FROM pomodoro_adaptive_experiments
                 WHERE id = 'run-focus-short-break-support-40-5-vs-45-7-v1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(
                experiment,
                ("rhythm_bundle".to_string(), "active".to_string())
            );

            let assignment_variant: String = sqlx::query_scalar(
                "SELECT variant_key
                 FROM pomodoro_adaptive_assignments
                 WHERE id = 'assignment-bundle'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(assignment_variant, "focus_45_short_break_7");

            let selected_short_break: f64 = sqlx::query_scalar(
                "SELECT selected_numeric_value
                 FROM pomodoro_adaptive_decision_values
                 WHERE decision_id = 'decision-1'
                   AND value_key = 'short_break_minutes'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(selected_short_break, 7.0);
        });
    }

    #[test]
    fn insert_run_records_adaptive_experiment_status_update_without_assignment() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 45,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            run.rhythm_source = "preset".to_string();
            run.preset_key = Some("adaptive".to_string());
            let mut snapshot = adaptive_snapshot();
            snapshot.experiment_updates = vec![adaptive_experiment("completed")];
            run.adaptive_snapshot = Some(snapshot);
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            tx.commit().await.unwrap();

            let lifecycle: (String, String) = sqlx::query_as(
                "SELECT status, ended_at
                 FROM pomodoro_adaptive_experiments
                 WHERE id = 'run-focus-duration-40-vs-45-v1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let assignment_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)
                 FROM pomodoro_adaptive_assignments
                 WHERE experiment_id = 'run-focus-duration-40-vs-45-v1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(
                lifecycle,
                ("completed".to_string(), "2026-05-29T10:00:00Z".to_string())
            );
            assert_eq!(assignment_count, 0);
        });
    }

    #[test]
    fn insert_run_snapshots_sequence_rhythm() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let run = run_write(PomodoroRunRhythm::Sequence {
                steps: vec![
                    PomodoroRunSequenceStep {
                        focus_duration_minutes: 25,
                        break_phase: "short_break".to_string(),
                        break_duration_minutes: 5,
                    },
                    PomodoroRunSequenceStep {
                        focus_duration_minutes: 35,
                        break_phase: "long_break".to_string(),
                        break_duration_minutes: 12,
                    },
                ],
            });
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            tx.commit().await.unwrap();

            let steps: Vec<(i64, i64, String, i64)> = sqlx::query_as(
                "SELECT step_index, focus_duration_minutes, break_phase, break_duration_minutes
                 FROM pomodoro_run_sequence_steps
                 WHERE run_id = 'run-1'
                 ORDER BY step_index",
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(
                steps,
                vec![
                    (0, 25, "short_break".to_string(), 5),
                    (1, 35, "long_break".to_string(), 12),
                ],
            );
        });
    }

    #[test]
    fn insert_run_snapshots_adaptive_decision() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            run.rhythm_source = "preset".to_string();
            run.preset_key = Some("adaptive".to_string());
            run.adaptive_snapshot = Some(adaptive_snapshot());
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            tx.commit().await.unwrap();

            let row = sqlx::query(
                "SELECT rs.policy_version, cs.time_of_day, d.decision_mode,
                        v.selected_numeric_value, ss.confidence
                 FROM pomodoro_run_adaptive_snapshots rs
                 JOIN pomodoro_adaptive_context_snapshots cs ON cs.id = rs.context_snapshot_id
                 JOIN pomodoro_adaptive_decisions d ON d.id = rs.decision_id
                 JOIN pomodoro_adaptive_decision_values v ON v.decision_id = d.id
                 JOIN pomodoro_adaptive_decision_state_scores ss ON ss.decision_id = d.id
                 WHERE rs.run_id = 'run-1' AND v.value_key = 'focus_duration_minutes'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            let policy_version: i64 = row.try_get("policy_version").unwrap();
            let time_of_day: String = row.try_get("time_of_day").unwrap();
            let decision_mode: String = row.try_get("decision_mode").unwrap();
            let selected_focus: f64 = row.try_get("selected_numeric_value").unwrap();
            let confidence: f64 = row.try_get("confidence").unwrap();
            assert_eq!(policy_version, 1);
            assert_eq!(time_of_day, "morning");
            assert_eq!(decision_mode, "fallback");
            assert_eq!(selected_focus, 40.0);
            assert_eq!(confidence, 0.0);

            let counts: (i64, i64, i64, i64) = sqlx::query_as(
                "SELECT
                    (SELECT COUNT(*) FROM pomodoro_adaptive_policy_bounds),
                    (SELECT COUNT(*) FROM pomodoro_adaptive_context_snapshot_features),
                    (SELECT COUNT(*) FROM pomodoro_adaptive_data_quality_flags),
                    (SELECT COUNT(*) FROM pomodoro_adaptive_decision_reasons)",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(counts, (4, 1, 1, 2));
        });
    }

    #[test]
    fn insert_run_snapshots_records_adaptive_candidate_id() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            run.rhythm_source = "preset".to_string();
            run.preset_key = Some("adaptive".to_string());
            let mut snapshot = adaptive_snapshot();
            snapshot.decision.candidate_id =
                Some("focus-growth-with-short-break-support".to_string());
            snapshot.decision.decision_mode = "explore".to_string();
            snapshot.decision.reason_codes = vec!["replay_candidate".to_string()];
            snapshot.decision.values[0].selected_numeric_value = 45.0;
            run.adaptive_snapshot = Some(snapshot);
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            tx.commit().await.unwrap();

            let row = sqlx::query(
                "SELECT candidate_id, decision_mode
                 FROM pomodoro_adaptive_decisions
                 WHERE id = 'decision-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(
                row.try_get::<String, _>("candidate_id").unwrap(),
                "focus-growth-with-short-break-support"
            );
            assert_eq!(
                row.try_get::<String, _>("decision_mode").unwrap(),
                "explore"
            );

            let reason_count: (i64,) = sqlx::query_as(
                "SELECT COUNT(*)
                 FROM pomodoro_adaptive_decision_reasons
                 WHERE decision_id = 'decision-1' AND reason_code = 'replay_candidate'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(reason_count.0, 1);
        });
    }

    #[test]
    fn insert_segment_with_adaptive_decision_records_boundary_decision() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut tx = pool.begin().await.unwrap();
            let run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            let initial_segment = initial_segment();
            insert_run_tx(&mut tx, &run, &initial_segment)
                .await
                .unwrap();
            tx.commit().await.unwrap();

            let break_segment = PomodoroSegmentWrite {
                id: "segment-2".to_string(),
                event_id: "event-1".to_string(),
                event_date: "2026-05-29".to_string(),
                run_id: "run-1".to_string(),
                rhythm_position: 1,
                phase: "short_break".to_string(),
                planned_start: "2026-05-29T10:40:00Z".to_string(),
                planned_end: "2026-05-29T10:45:00Z".to_string(),
                actual_start: Some("2026-05-29T10:40:00Z".to_string()),
                actual_end: None,
                pauses: Vec::new(),
                status: "active".to_string(),
                end_reason: None,
            };
            let envelope = adaptive_boundary_envelope(&break_segment);
            let mut tx = pool.begin().await.unwrap();
            validate_adaptive_decision_envelope_for_segment(&envelope, &break_segment).unwrap();
            insert_segment_tx(&mut tx, &break_segment).await.unwrap();
            insert_adaptive_decision_envelope_tx(&mut tx, &envelope)
                .await
                .unwrap();
            insert_run_event_tx(
                &mut tx,
                RunEventInsert {
                    run_id: "run-1",
                    segment_id: Some("segment-2"),
                    event_type: "phase_start",
                    occurred_at: "2026-05-29T10:40:00Z",
                    phase: Some("short_break"),
                    reason: None,
                    duration_seconds: None,
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let row = sqlx::query(
                "SELECT d.opportunity_kind, d.segment_id, v.value_key, v.selected_numeric_value
                 FROM pomodoro_adaptive_decisions d
                 JOIN pomodoro_adaptive_decision_values v ON v.decision_id = d.id
                 WHERE d.id = 'decision-boundary-1'
                   AND v.value_key = 'short_break_minutes'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(
                row.try_get::<String, _>("opportunity_kind").unwrap(),
                "break_start"
            );
            assert_eq!(row.try_get::<String, _>("segment_id").unwrap(), "segment-2");
            assert_eq!(
                row.try_get::<String, _>("value_key").unwrap(),
                "short_break_minutes"
            );
            assert_eq!(
                row.try_get::<f64, _>("selected_numeric_value").unwrap(),
                5.0
            );

            let event_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pomodoro_run_events
                 WHERE run_id = 'run-1'
                   AND segment_id = 'segment-2'
                   AND event_type = 'phase_start'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(event_count, 1);
        });
    }

    #[test]
    fn reject_invalid_adaptive_snapshot_before_insert() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            let mut snapshot = adaptive_snapshot();
            snapshot.decision.state_scores.confidence = 1.5;
            run.adaptive_snapshot = Some(snapshot);
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            let result = insert_run_tx(&mut tx, &run, &segment).await;
            assert!(result.is_err());
            tx.rollback().await.unwrap();

            let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_runs")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(run_count, 0);
        });
    }

    #[test]
    fn insert_run_persists_provided_adaptive_planned_blocks() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            let mut snapshot = adaptive_snapshot();
            snapshot.planned_blocks = vec![adaptive_planned_block()];
            run.adaptive_snapshot = Some(snapshot);
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            tx.commit().await.unwrap();

            let saved: (String, String, String) = sqlx::query_as(
                "SELECT event_id, original_event_id, source_kind
                 FROM pomodoro_adaptive_planned_blocks
                 WHERE event_date = '2026-05-29'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(
                saved,
                (
                    "event-1::2026-05-29".to_string(),
                    "event-1".to_string(),
                    "scheduler_snapshot".to_string(),
                ),
            );
        });
    }

    #[test]
    fn reject_invalid_adaptive_planned_block_before_insert() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            let mut snapshot = adaptive_snapshot();
            let mut block = adaptive_planned_block();
            block.event_date = "2026-05-30".to_string();
            snapshot.planned_blocks = vec![block];
            run.adaptive_snapshot = Some(snapshot);
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            let result = insert_run_tx(&mut tx, &run, &segment).await;
            assert!(result.is_err());
            tx.rollback().await.unwrap();

            let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_runs")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(run_count, 0);
        });
    }

    #[test]
    fn close_run_records_adaptive_outcomes_and_context_state() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            run.rhythm_source = "preset".to_string();
            run.preset_key = Some("adaptive".to_string());
            run.adaptive_snapshot = Some(adaptive_snapshot());
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            tx.commit().await.unwrap();

            sqlx::query(
                "INSERT INTO doomscrolling_block_events
                    (id, run_id, segment_id, occurred_at, source_type, source_key,
                     phase, decision)
                 VALUES ('block-1', 'run-1', 'segment-1', '2026-05-29T10:10:00Z',
                         'browser', 'youtube.com', 'focus', 'blocked')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let mut tx = pool.begin().await.unwrap();
            close_run_tx(
                &mut tx,
                &PomodoroRunClosure {
                    run_id: "run-1".to_string(),
                    ended_at: "2026-05-29T10:40:00Z".to_string(),
                    end_reason: "completed".to_string(),
                    segment_status: "completed".to_string(),
                    segment_end_reason: "completed".to_string(),
                    event_type: "complete".to_string(),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let clean_focus: f64 = sqlx::query_scalar(
                "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'run'
                   AND outcome_key = 'clean_focus_seconds'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let blocked_attempts: f64 = sqlx::query_scalar(
                "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'run'
                   AND outcome_key = 'blocked_attempt_count'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let run_completed: i64 = sqlx::query_scalar(
                "SELECT boolean_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'run'
                   AND outcome_key = 'run_completed'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let run_end_reason: String = sqlx::query_scalar(
                "SELECT categorical_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'run'
                   AND outcome_key = 'run_end_reason'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let phase_clean_focus: f64 = sqlx::query_scalar(
                "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_clean_focus_seconds'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let phase_kind: String = sqlx::query_scalar(
                "SELECT categorical_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_kind'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(clean_focus, 40.0 * 60.0);
            assert_eq!(blocked_attempts, 1.0);
            assert_eq!(run_completed, 1);
            assert_eq!(run_end_reason, "completed");
            assert_eq!(phase_clean_focus, 40.0 * 60.0);
            assert_eq!(phase_kind, "focus");

            let state = sqlx::query(
                "SELECT context_key, readiness, avoidance_pressure, confidence
                 FROM pomodoro_adaptive_context_states
                 WHERE policy_id = 'local-adaptive-policy-v1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let context_key: String = state.try_get("context_key").unwrap();
            let readiness: f64 = state.try_get("readiness").unwrap();
            let avoidance_pressure: f64 = state.try_get("avoidance_pressure").unwrap();
            let confidence: f64 = state.try_get("confidence").unwrap();
            assert_eq!(context_key, "morning:first:medium:low:unknown:none");
            assert!(readiness > 0.0);
            assert!(avoidance_pressure > 0.0);
            assert!(confidence > 0.0);

            let history_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pomodoro_adaptive_context_state_history
                 WHERE policy_id = 'local-adaptive-policy-v1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(history_count, 1);
        });
    }

    #[test]
    fn close_run_links_adaptive_outcomes_to_assignment() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 45,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            run.rhythm_source = "preset".to_string();
            run.preset_key = Some("adaptive".to_string());
            run.adaptive_snapshot = Some(adaptive_snapshot_with_assignment());
            let mut segment = initial_segment();
            segment.planned_end = "2026-05-29T10:45:00Z".to_string();

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            close_run_tx(
                &mut tx,
                &PomodoroRunClosure {
                    run_id: "run-1".to_string(),
                    ended_at: "2026-05-29T10:45:00Z".to_string(),
                    end_reason: "completed".to_string(),
                    segment_status: "completed".to_string(),
                    segment_end_reason: "completed".to_string(),
                    event_type: "complete".to_string(),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let assignment_id: String = sqlx::query_scalar(
                "SELECT assignment_id
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'run'
                   AND outcome_key = 'clean_focus_seconds'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let phase_assignment_id: String = sqlx::query_scalar(
                "SELECT assignment_id
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_clean_focus_seconds'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(assignment_id, "assignment-1");
            assert_eq!(phase_assignment_id, "assignment-1");
        });
    }

    #[test]
    fn close_run_records_boundary_phase_outcomes() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            run.rhythm_source = "preset".to_string();
            run.preset_key = Some("adaptive".to_string());
            run.adaptive_snapshot = Some(adaptive_snapshot());
            let initial_segment = initial_segment();
            let break_segment = PomodoroSegmentWrite {
                id: "segment-2".to_string(),
                event_id: "event-1".to_string(),
                event_date: "2026-05-29".to_string(),
                run_id: "run-1".to_string(),
                rhythm_position: 1,
                phase: "short_break".to_string(),
                planned_start: "2026-05-29T10:40:00Z".to_string(),
                planned_end: "2026-05-29T10:45:00Z".to_string(),
                actual_start: Some("2026-05-29T10:40:00Z".to_string()),
                actual_end: None,
                pauses: Vec::new(),
                status: "active".to_string(),
                end_reason: None,
            };
            let envelope = adaptive_boundary_envelope(&break_segment);

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &initial_segment)
                .await
                .unwrap();
            tx.commit().await.unwrap();
            sqlx::query(
                "UPDATE pomodoro_segments
                 SET status = 'completed',
                     actual_end = '2026-05-29T10:40:00Z',
                     end_reason = 'completed'
                 WHERE id = 'segment-1'",
            )
            .execute(&pool)
            .await
            .unwrap();

            let mut tx = pool.begin().await.unwrap();
            insert_segment_tx(&mut tx, &break_segment).await.unwrap();
            insert_adaptive_decision_envelope_tx(&mut tx, &envelope)
                .await
                .unwrap();
            insert_run_event_tx(
                &mut tx,
                RunEventInsert {
                    run_id: "run-1",
                    segment_id: Some("segment-2"),
                    event_type: "phase_start",
                    occurred_at: "2026-05-29T10:40:00Z",
                    phase: Some("short_break"),
                    reason: None,
                    duration_seconds: None,
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            sqlx::query(
                "INSERT INTO doomscrolling_block_events
                    (id, run_id, segment_id, occurred_at, source_type, source_key,
                     phase, decision)
                 VALUES ('block-break-1', 'run-1', 'segment-2', '2026-05-29T10:46:00Z',
                         'browser', 'youtube.com', 'short_break', 'blocked')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let mut tx = pool.begin().await.unwrap();
            close_run_tx(
                &mut tx,
                &PomodoroRunClosure {
                    run_id: "run-1".to_string(),
                    ended_at: "2026-05-29T10:47:00Z".to_string(),
                    end_reason: "completed".to_string(),
                    segment_status: "completed".to_string(),
                    segment_end_reason: "completed".to_string(),
                    event_type: "complete".to_string(),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let phase_kind: String = sqlx::query_scalar(
                "SELECT categorical_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-boundary-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_kind'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let break_overtime: f64 = sqlx::query_scalar(
                "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-boundary-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_break_overtime_seconds'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let blocked_attempts: f64 = sqlx::query_scalar(
                "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-boundary-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_blocked_attempt_count'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let next_focus_observed: i64 = sqlx::query_scalar(
                "SELECT boolean_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-boundary-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'post_break_next_focus_observed'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(phase_kind, "short_break");
            assert_eq!(break_overtime, 120.0);
            assert_eq!(blocked_attempts, 1.0);
            assert_eq!(next_focus_observed, 0);
        });
    }

    #[test]
    fn records_matured_day_outcomes_for_run_start_decisions() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            run.rhythm_source = "preset".to_string();
            run.preset_key = Some("adaptive".to_string());
            run.adaptive_snapshot = Some(adaptive_snapshot());
            let segment = initial_segment();

            sqlx::query(
                "INSERT INTO calendar_events (id, title, start_time, end_time)
                 VALUES ('event-2', 'Missed focus block',
                         '2026-05-29T13:00:00Z', '2026-05-29T14:00:00Z')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_configs
                    (event_id, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes)
                 VALUES ('event-1', 'count', 'preset', 'adaptive', NULL),
                        ('event-2', 'count', 'preset', 'adaptive', NULL)",
            )
            .execute(&pool)
            .await
            .unwrap();
            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            close_run_tx(
                &mut tx,
                &PomodoroRunClosure {
                    run_id: "run-1".to_string(),
                    ended_at: "2026-05-29T10:40:00Z".to_string(),
                    end_reason: "completed".to_string(),
                    segment_status: "completed".to_string(),
                    segment_end_reason: "completed".to_string(),
                    event_type: "complete".to_string(),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            sqlx::query("DELETE FROM calendar_events WHERE id = 'event-2'")
                .execute(&pool)
                .await
                .unwrap();
            let captured_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)
                 FROM pomodoro_adaptive_planned_blocks
                 WHERE event_date = '2026-05-29'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(captured_count, 2);
            sqlx::query(
                "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-current', 'event-1', 'event-1', '2026-05-30',
                         '2026-05-30T10:00:00Z', '2026-05-30T10:10:00Z',
                         '2026-05-30T10:00:00Z', '2026-05-30T10:10:00Z',
                         'count', 'preset', 'adaptive', '2026-05-30T10:10:00Z',
                         'completed', 'manual')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let mut tx = pool.begin().await.unwrap();
            record_matured_adaptive_day_outcomes_tx(&mut tx, "run-current", "2026-05-30T10:10:00Z")
                .await
                .unwrap();
            tx.commit().await.unwrap();

            let observed: i64 = sqlx::query_scalar(
                "SELECT boolean_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'day'
                   AND outcome_key = 'day_observed'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let clean_focus: f64 = sqlx::query_scalar(
                "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'day'
                   AND outcome_key = 'day_clean_focus_seconds'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let planned_count: f64 = sqlx::query_scalar(
                "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'day'
                   AND outcome_key = 'day_planned_pomodoro_event_count'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let missed_count: f64 = sqlx::query_scalar(
                "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'day'
                   AND outcome_key = 'day_missed_planned_pomodoro_event_count'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(observed, 1);
            assert_eq!(clean_focus, 40.0 * 60.0);
            assert_eq!(planned_count, 2.0);
            assert_eq!(missed_count, 1.0);
        });
    }

    #[test]
    fn records_matured_next_day_outcomes_for_run_start_decisions() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            let mut run = run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            });
            run.rhythm_source = "preset".to_string();
            run.preset_key = Some("adaptive".to_string());
            run.adaptive_snapshot = Some(adaptive_snapshot());
            let segment = initial_segment();

            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(&mut tx, &run, &segment).await.unwrap();
            close_run_tx(
                &mut tx,
                &PomodoroRunClosure {
                    run_id: "run-1".to_string(),
                    ended_at: "2026-05-29T10:40:00Z".to_string(),
                    end_reason: "completed".to_string(),
                    segment_status: "completed".to_string(),
                    segment_end_reason: "completed".to_string(),
                    event_type: "complete".to_string(),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            sqlx::query(
                "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-next-day', 'event-1', 'event-1', '2026-05-30',
                         '2026-05-30T10:00:00Z', '2026-05-30T11:00:00Z',
                         '2026-05-30T10:00:00Z', '2026-05-30T10:30:00Z',
                         'count', 'preset', 'adaptive', '2026-05-30T10:30:00Z',
                         'completed', 'manual')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, rhythm_position, phase,
                     planned_start, planned_end, actual_start, actual_end, status, end_reason)
                 VALUES ('segment-next-day', 'event-1', '2026-05-30', 'run-next-day',
                         1, 'focus', '2026-05-30T10:00:00Z',
                         '2026-05-30T10:30:00Z', '2026-05-30T10:00:00Z',
                         '2026-05-30T10:30:00Z', 'completed', 'completed')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-current', 'event-1', 'event-1', '2026-05-31',
                         '2026-05-31T10:00:00Z', '2026-05-31T10:10:00Z',
                         '2026-05-31T10:00:00Z', '2026-05-31T10:10:00Z',
                         'count', 'preset', 'adaptive', '2026-05-31T10:10:00Z',
                         'completed', 'manual')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let mut tx = pool.begin().await.unwrap();
            record_matured_adaptive_next_day_outcomes_tx(
                &mut tx,
                "run-current",
                "2026-05-31T10:10:00Z",
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let observed: i64 = sqlx::query_scalar(
                "SELECT boolean_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'next_day'
                   AND outcome_key = 'next_day_observed'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let clean_focus: f64 = sqlx::query_scalar(
                "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'next_day'
                   AND outcome_key = 'next_day_clean_focus_seconds'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let run_count: f64 = sqlx::query_scalar(
                "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'next_day'
                   AND outcome_key = 'next_day_run_count'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(observed, 1);
            assert_eq!(clean_focus, 30.0 * 60.0);
            assert_eq!(run_count, 1.0);
        });
    }

    #[test]
    fn load_adaptive_history_reads_recent_signals() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            sqlx::query(
                "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-1', 'event-1', 'event-1', '2026-05-29',
                         '2026-05-29T10:00:00Z', '2026-05-29T11:00:00Z',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:20:00Z',
                         'count', 'preset', 'adaptive', '2026-05-29T10:20:00Z',
                         'stopped', 'manual')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, rhythm_position, phase,
                     planned_start, planned_end, actual_start, actual_end, status, end_reason)
                 VALUES ('segment-1', 'event-1', '2026-05-29', 'run-1', 1, 'focus',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:40:00Z',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:20:00Z',
                         'interrupted', 'focus_failed')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_pauses (id, segment_id, started_at, ended_at, reason)
                 VALUES ('pause-1', 'segment-1', '2026-05-29T10:10:00Z',
                         '2026-05-29T10:14:00Z', 'idle')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_run_events
                    (id, run_id, segment_id, event_type, occurred_at, phase, reason, duration_seconds)
                 VALUES ('run-event-1', 'run-1', 'segment-1', 'focus_failed',
                         '2026-05-29T10:20:00Z', 'focus', 'long_idle', 300)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_policies
                    (id, status, policy_version, model_version)
                 VALUES ('local-adaptive-policy-v1', 'active', 1, 1)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_context_states
                    (policy_id, context_key, readiness, strain, recovery_debt,
                     avoidance_pressure, momentum, confidence, updated_at)
                 VALUES ('local-adaptive-policy-v1', 'morning:first', 0.2, 0.7, 0.6,
                         0.4, 0.1, 0.8, '2026-05-29T10:30:00Z')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO doomscrolling_block_events
                    (id, run_id, segment_id, occurred_at, source_type, source_key,
                     phase, decision)
                 VALUES ('block-1', 'run-1', 'segment-1', '2026-05-29T10:05:00Z',
                         'browser', 'youtube.com', 'focus', 'blocked')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let history = load_adaptive_history_from_pool(
                &pool,
                "2026-05-29T11:00:00Z",
                "local-adaptive-policy-v1",
                20,
            )
            .await
            .unwrap();

            assert_eq!(history.segments.len(), 1);
            assert_eq!(history.segments[0].run_id, "run-1");
            assert_eq!(history.segments[0].rhythm_position, 1);
            assert_eq!(
                history.segments[0].end_reason.as_deref(),
                Some("focus_failed")
            );
            assert_eq!(history.segments[0].pause_log.len(), 1);
            assert_eq!(history.run_events.len(), 1);
            assert_eq!(history.run_events[0].event_type, "focus_failed");
            assert_eq!(history.block_events.len(), 1);
            assert_eq!(history.block_events[0].source_key, "youtube.com");
            assert_eq!(history.previous_states.len(), 1);
            assert_eq!(history.previous_states[0].context_key, "morning:first");
            assert_eq!(history.previous_states[0].confidence, 0.8);
            assert!(history.experiment_states.is_empty());
            assert!(history.experiment_outcomes.is_empty());
            assert!(history.experiment_assignments.is_empty());
        });
    }

    #[test]
    fn load_adaptive_history_reads_experiment_outcome_summaries() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            sqlx::query(
                "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-1', 'event-1', 'event-1', '2026-05-29',
                         '2026-05-29T10:00:00Z', '2026-05-29T11:00:00Z',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:45:00Z',
                         'count', 'preset', 'adaptive', '2026-05-29T10:45:00Z',
                         'completed', 'manual')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_policies
                    (id, status, policy_version, model_version)
                 VALUES ('local-adaptive-policy-v1', 'active', 1, 1)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_context_snapshots
                    (id, run_id, local_started_at, time_of_day, session_position,
                     event_length, workload, energy)
                 VALUES ('context-control', 'run-1', '2026-05-29T10:00:00Z',
                         'morning', 'first', 'medium', 'low', 'unknown'),
                        ('context-treatment', 'run-1', '2026-05-29T11:00:00Z',
                         'morning', 'first', 'medium', 'low', 'unknown')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_experiments
                    (id, policy_id, parameter_key, assignment_unit, status, started_at)
                 VALUES ('run-focus-duration-40-vs-45-v1', 'local-adaptive-policy-v1',
                         'focus_duration_minutes', 'run', 'active', '2026-05-29T10:00:00Z')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_experiment_variants
                    (experiment_id, variant_key, numeric_value, is_control)
                 VALUES ('run-focus-duration-40-vs-45-v1', 'control_40', 40, 1),
                        ('run-focus-duration-40-vs-45-v1', 'focus_45', 45, 0)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_assignments
                    (id, experiment_id, variant_key, run_id, context_snapshot_id,
                     assignment_seed, assigned_at)
                 VALUES ('assignment-control', 'run-focus-duration-40-vs-45-v1',
                         'control_40', 'run-1', 'context-control', 'seed-control',
                         '2026-05-29T10:00:00Z'),
                        ('assignment-treatment', 'run-focus-duration-40-vs-45-v1',
                         'focus_45', 'run-1', 'context-treatment', 'seed-treatment',
                         '2026-05-29T11:00:00Z')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_outcomes
                    (id, assignment_id, outcome_window, outcome_key, numeric_value,
                     boolean_value, measured_at)
                 VALUES
                    ('outcome-control-completed', 'assignment-control', 'run',
                     'run_completed', NULL, 1, '2026-05-29T10:40:00Z'),
                    ('outcome-control-clean', 'assignment-control', 'run',
                     'clean_focus_seconds', 2400, NULL, '2026-05-29T10:40:00Z'),
                    ('outcome-control-blocked', 'assignment-control', 'run',
                     'blocked_attempt_count', 1, NULL, '2026-05-29T10:40:00Z'),
                    ('outcome-control-short-break-overtime', 'assignment-control', 'run',
                     'short_break_overtime_seconds', 90, NULL, '2026-05-29T10:40:00Z'),
                    ('outcome-control-day', 'assignment-control', 'day',
                     'day_observed', NULL, 1, '2026-05-30T09:00:00Z'),
                    ('outcome-control-day-started', 'assignment-control', 'day',
                     'day_started_planned_pomodoro_event_count', 2, NULL,
                     '2026-05-30T09:00:00Z'),
                    ('outcome-control-day-missed', 'assignment-control', 'day',
                     'day_missed_planned_pomodoro_event_count', 0, NULL,
                     '2026-05-30T09:00:00Z'),
                    ('outcome-control-day-clean', 'assignment-control', 'day',
                     'day_clean_focus_seconds', 4800, NULL, '2026-05-30T09:00:00Z'),
                    ('outcome-treatment-completed', 'assignment-treatment', 'run',
                     'run_completed', NULL, 0, '2026-05-29T11:45:00Z'),
                    ('outcome-treatment-stopped', 'assignment-treatment', 'run',
                     'run_stopped', NULL, 1, '2026-05-29T11:45:00Z'),
                    ('outcome-treatment-clean', 'assignment-treatment', 'run',
                     'clean_focus_seconds', 1800, NULL, '2026-05-29T11:45:00Z'),
                    ('outcome-treatment-short-break-overtime', 'assignment-treatment', 'run',
                     'short_break_overtime_seconds', 30, NULL, '2026-05-29T11:45:00Z'),
                    ('outcome-treatment-day', 'assignment-treatment', 'day',
                     'day_observed', NULL, 1, '2026-05-30T09:00:00Z'),
                    ('outcome-treatment-day-started', 'assignment-treatment', 'day',
                     'day_started_planned_pomodoro_event_count', 1, NULL,
                     '2026-05-30T09:00:00Z'),
                    ('outcome-treatment-day-missed', 'assignment-treatment', 'day',
                     'day_missed_planned_pomodoro_event_count', 1, NULL,
                     '2026-05-30T09:00:00Z'),
                    ('outcome-treatment-day-blocked', 'assignment-treatment', 'day',
                     'day_blocked_attempt_count', 4, NULL, '2026-05-30T09:00:00Z'),
                    ('outcome-treatment-next-day', 'assignment-treatment', 'next_day',
                     'next_day_observed', NULL, 1, '2026-05-31T09:00:00Z'),
                    ('outcome-treatment-next-day-started', 'assignment-treatment', 'next_day',
                     'next_day_started_run', NULL, 0, '2026-05-31T09:00:00Z')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let history = load_adaptive_history_from_pool(
                &pool,
                "2026-06-01T00:00:00Z",
                "local-adaptive-policy-v1",
                20,
            )
            .await
            .unwrap();

            assert_eq!(history.experiment_states.len(), 1);
            assert_eq!(
                history.experiment_states[0].experiment_id,
                "run-focus-duration-40-vs-45-v1"
            );
            assert_eq!(history.experiment_states[0].status, "active");
            assert_eq!(history.experiment_assignments.len(), 2);
            assert_eq!(
                history.experiment_assignments[0].experiment_id,
                "run-focus-duration-40-vs-45-v1"
            );
            assert_eq!(history.experiment_assignments[0].variant_key, "focus_45");
            assert_eq!(
                history.experiment_assignments[0].context_key,
                "morning:first:medium:low:unknown:none"
            );
            assert_eq!(
                history.experiment_assignments[0].assigned_at,
                "2026-05-29T11:00:00Z"
            );
            assert_eq!(history.experiment_outcomes.len(), 2);
            let control = history
                .experiment_outcomes
                .iter()
                .find(|outcome| outcome.variant_key == "control_40")
                .unwrap();
            let treatment = history
                .experiment_outcomes
                .iter()
                .find(|outcome| outcome.variant_key == "focus_45")
                .unwrap();
            assert_eq!(control.assignment_count, 1);
            assert_eq!(control.context_key, "morning:first:medium:low:unknown:none");
            assert_eq!(control.run_observed_count, 1);
            assert_eq!(control.run_completed_count, 1);
            assert_eq!(control.clean_focus_seconds_sum, 2400.0);
            assert_eq!(control.clean_focus_seconds_square_sum, 5_760_000.0);
            assert_eq!(control.blocked_attempt_count_sum, 1.0);
            assert_eq!(control.blocked_attempt_count_square_sum, 1.0);
            assert_eq!(control.short_break_overtime_seconds_sum, 90.0);
            assert_eq!(control.short_break_overtime_seconds_square_sum, 8_100.0);
            assert_eq!(control.day_observed_count, 1);
            assert_eq!(control.day_started_planned_pomodoro_count_sum, 2.0);
            assert_eq!(control.day_missed_planned_pomodoro_count_sum, 0.0);
            assert_eq!(control.day_missed_planned_pomodoro_count_square_sum, 0.0);
            assert_eq!(control.day_clean_focus_seconds_sum, 4800.0);
            assert_eq!(treatment.assignment_count, 1);
            assert_eq!(treatment.run_observed_count, 1);
            assert_eq!(treatment.run_completed_count, 0);
            assert_eq!(treatment.run_stopped_count, 1);
            assert_eq!(treatment.short_break_overtime_seconds_sum, 30.0);
            assert_eq!(treatment.short_break_overtime_seconds_square_sum, 900.0);
            assert_eq!(treatment.day_observed_count, 1);
            assert_eq!(treatment.day_missed_planned_pomodoro_count_sum, 1.0);
            assert_eq!(treatment.day_missed_planned_pomodoro_count_square_sum, 1.0);
            assert_eq!(treatment.day_blocked_attempt_count_sum, 4.0);
            assert_eq!(treatment.day_blocked_attempt_count_square_sum, 16.0);
            assert_eq!(treatment.next_day_observed_count, 1);
            assert_eq!(treatment.next_day_started_run_count, 0);
        });
    }

    #[test]
    fn load_adaptive_replay_dataset_reads_run_start_decisions_and_outcomes() {
        tauri::async_runtime::block_on(async {
            let pool = migrated_pool_with_event().await;
            sqlx::query(
                "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-1', 'event-1', 'event-1', '2026-05-29',
                         '2026-05-29T10:00:00Z', '2026-05-29T11:00:00Z',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:45:00Z',
                         'count', 'preset', 'adaptive', '2026-05-29T10:45:00Z',
                         'completed', 'manual')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_policies
                    (id, status, policy_version, model_version)
                 VALUES ('local-adaptive-policy-v1', 'active', 1, 1)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-prior', 'event-1', 'event-1', '2026-05-28',
                         '2026-05-28T09:00:00Z', '2026-05-28T10:00:00Z',
                         '2026-05-28T09:00:00Z', '2026-05-28T09:40:00Z',
                         'count', 'preset', 'adaptive', '2026-05-28T09:40:00Z',
                         'completed', 'manual')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, rhythm_position, phase,
                     planned_start, planned_end, actual_start, actual_end, status, end_reason)
                 VALUES ('segment-prior', 'event-1', '2026-05-28', 'run-prior', 1,
                         'focus', '2026-05-28T09:00:00Z', '2026-05-28T09:40:00Z',
                         '2026-05-28T09:00:00Z', '2026-05-28T09:40:00Z',
                         'completed', 'completed')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_context_state_history
                    (id, policy_id, context_key, observed_at, readiness, strain,
                     recovery_debt, avoidance_pressure, momentum, confidence)
                 VALUES ('state-before', 'local-adaptive-policy-v1',
                         'morning:first:medium:low:unknown:none',
                         '2026-05-28T10:00:00Z', 0.5, 0.2, 0.2, 0.1, 0.6, 0.7),
                        ('state-after', 'local-adaptive-policy-v1',
                         'morning:first:medium:low:unknown:none',
                         '2026-05-29T11:00:00Z', 0.9, 0.1, 0.1, 0.0, 0.9, 0.95)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_context_snapshots
                    (id, run_id, local_started_at, time_of_day, session_position,
                     event_length, workload, energy)
                 VALUES ('context-1', 'run-1', '2026-05-29T10:00:00Z',
                         'morning', 'first', 'medium', 'low', 'unknown')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_decisions
                    (id, policy_id, run_id, context_snapshot_id, opportunity_kind,
                     candidate_id, decision_mode, policy_version, model_version, occurred_at)
                 VALUES ('decision-1', 'local-adaptive-policy-v1', 'run-1',
                         'context-1', 'run_start',
                         'focus-growth-with-short-break-support',
                         'explore', 1, 1,
                         '2026-05-29T10:00:00Z')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_decision_values
                    (decision_id, value_key, previous_numeric_value, selected_numeric_value,
                     value_unit)
                 VALUES
                    ('decision-1', 'focus_duration_minutes', 40, 45, 'minutes'),
                    ('decision-1', 'short_break_minutes', 5, 5, 'minutes'),
                    ('decision-1', 'long_break_minutes', 10, 10, 'minutes'),
                    ('decision-1', 'long_break_after_focus_count', 4, 4, 'count')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_adaptive_outcomes
                    (id, decision_id, outcome_window, outcome_key, numeric_value,
                     boolean_value, measured_at)
                 VALUES
                    ('outcome-clean', 'decision-1', 'run', 'clean_focus_seconds',
                     2700, NULL, '2026-05-29T10:45:00Z'),
                    ('outcome-completed', 'decision-1', 'run', 'run_completed',
                     NULL, 1, '2026-05-29T10:45:00Z')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let prior_segment_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)
                 FROM pomodoro_segments
                 WHERE planned_start < '2026-05-29T10:00:00Z'
                   AND status IN ('completed', 'interrupted')",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(prior_segment_count, 1);

            let dataset = load_adaptive_replay_dataset_from_pool(
                &pool,
                "2026-05-30T00:00:00Z",
                "local-adaptive-policy-v1",
                20,
                20,
            )
            .await
            .unwrap();

            assert_eq!(dataset.opportunities.len(), 1);
            let opportunity = &dataset.opportunities[0];
            assert_eq!(opportunity.id, "decision-1");
            assert_eq!(opportunity.run_id, "run-1");
            assert_eq!(opportunity.started_at, "2026-05-29T10:00:00Z");
            assert_eq!(
                opportunity.candidate_id.as_deref(),
                Some("focus-growth-with-short-break-support")
            );
            match &opportunity.current_rhythm {
                PomodoroRunRhythm::Count {
                    focus_duration_minutes,
                    short_break_minutes,
                    long_break_minutes,
                    long_break_after_focus_count,
                } => {
                    assert_eq!(*focus_duration_minutes, 40);
                    assert_eq!(*short_break_minutes, 5);
                    assert_eq!(*long_break_minutes, 10);
                    assert_eq!(*long_break_after_focus_count, 4);
                }
                PomodoroRunRhythm::Sequence { .. } => panic!("expected count rhythm"),
            }
            match &opportunity.selected_rhythm {
                PomodoroRunRhythm::Count {
                    focus_duration_minutes,
                    ..
                } => assert_eq!(*focus_duration_minutes, 45),
                PomodoroRunRhythm::Sequence { .. } => panic!("expected count rhythm"),
            }
            assert_eq!(dataset.outcomes.len(), 2);
            let completed = dataset
                .outcomes
                .iter()
                .find(|outcome| outcome.outcome_key == "run_completed")
                .unwrap();
            assert_eq!(completed.boolean_value, Some(true));
            assert_eq!(dataset.histories.len(), 1);
            assert_eq!(dataset.histories[0].opportunity_id, "decision-1");
            assert_eq!(dataset.histories[0].history.segments.len(), 1);
            assert_eq!(dataset.histories[0].history.segments[0].run_id, "run-prior");
            assert_eq!(dataset.histories[0].history.previous_states.len(), 1);
            assert_eq!(
                dataset.histories[0].history.previous_states[0].confidence,
                0.7
            );
        });
    }

    #[test]
    fn close_run_clamps_end_to_active_segment_start() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::raw_sql("PRAGMA foreign_keys=ON")
                .execute(&pool)
                .await
                .unwrap();
            run_migrations(&pool).await.unwrap();

            sqlx::query(
                "INSERT INTO calendar_events (id, title, start_time, end_time)
                 VALUES ('event-1', 'Focus block', '2026-05-29T10:00:00Z', '2026-05-29T11:00:00Z')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     start_trigger)
                 VALUES ('run-1', 'event-1', 'event-1', '2026-05-29',
                         '2026-05-29T10:00:00Z', '2026-05-29T11:00:00Z',
                         '2026-05-29T10:05:00Z', 'count', 'preset', 'adaptive',
                         '2026-05-29T10:05:00Z', 'manual')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, rhythm_position, phase,
                     planned_start, planned_end, actual_start, status)
                 VALUES ('segment-1', 'event-1', '2026-05-29', 'run-1', 1, 'focus',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:40:00Z',
                         '2026-05-29T10:05:00Z', 'active')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO pomodoro_pauses (id, segment_id, started_at, reason)
                 VALUES ('pause-1', 'segment-1', '2026-05-29T10:05:00Z', 'idle')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let mut tx = pool.begin().await.unwrap();
            close_run_tx(
                &mut tx,
                &PomodoroRunClosure {
                    run_id: "run-1".to_string(),
                    ended_at: "2026-05-29T10:00:00Z".to_string(),
                    end_reason: "completed".to_string(),
                    segment_status: "interrupted".to_string(),
                    segment_end_reason: "event_expired".to_string(),
                    event_type: "complete".to_string(),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let row = sqlx::query(
                "SELECT r.ended_at AS run_end, s.actual_end AS segment_end, p.ended_at AS pause_end
                 FROM pomodoro_runs r
                 JOIN pomodoro_segments s ON s.run_id = r.id
                 JOIN pomodoro_pauses p ON p.segment_id = s.id
                 WHERE r.id = 'run-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            let run_end: String = row.try_get("run_end").unwrap();
            let segment_end: String = row.try_get("segment_end").unwrap();
            let pause_end: String = row.try_get("pause_end").unwrap();
            assert_eq!(run_end, "2026-05-29T10:05:00Z");
            assert_eq!(segment_end, "2026-05-29T10:05:00Z");
            assert_eq!(pause_end, "2026-05-29T10:05:00Z");
        });
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
        assert!(validate_segment_end_reason("focus_failed").is_ok());
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
        assert!(validate_event_type("go_to_break_now").is_ok());
        assert!(validate_event_type("start_focus_now").is_ok());
        assert!(validate_event_type("focus_failed").is_ok());
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
