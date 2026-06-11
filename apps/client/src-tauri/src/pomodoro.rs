mod commands;
mod reads;
#[cfg(test)]
mod tests;
mod time;
mod validation;
mod writes;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[cfg(test)]
use reads::{load_adaptive_history_from_pool, load_adaptive_replay_dataset_from_pool};
#[cfg(test)]
use validation::{
    canonical_event_id, normalize_segment_update, validate_adaptive_decision_envelope_for_segment,
    validate_event_type, validate_pause_reason, validate_phase, validate_run_end_reason,
    validate_run_window_update, validate_segment_end_reason, validate_status,
};
#[cfg(test)]
use writes::{
    close_run_tx, insert_adaptive_decision_envelope_tx, insert_run_event_tx, insert_run_tx,
    insert_segment_tx, record_matured_adaptive_day_outcomes_tx,
    record_matured_adaptive_next_day_outcomes_tx, RunEventInsert,
};

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

#[tauri::command]
pub async fn pomodoro_load_segments_for_events<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    event_ids: Vec<String>,
) -> Result<Vec<PomodoroSegmentRead>, String> {
    reads::pomodoro_load_segments_for_events(app, db_url, event_ids).await
}

#[tauri::command]
pub async fn pomodoro_load_adaptive_history<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    before: String,
    policy_id: String,
    segment_limit: i64,
) -> Result<PomodoroAdaptiveHistoryRead, String> {
    reads::pomodoro_load_adaptive_history(app, db_url, before, policy_id, segment_limit).await
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
    reads::pomodoro_load_adaptive_replay_dataset(
        app,
        db_url,
        before,
        policy_id,
        limit,
        history_segment_limit,
    )
    .await
}

#[tauri::command]
pub async fn pomodoro_start_run<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    run: PomodoroRunWrite,
    segment: PomodoroSegmentWrite,
) -> Result<(), String> {
    commands::pomodoro_start_run(app, db_url, run, segment).await
}

#[tauri::command]
pub async fn pomodoro_transition_run<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    transition: PomodoroTransitionRunWrite,
) -> Result<(), String> {
    commands::pomodoro_transition_run(app, db_url, transition).await
}

#[tauri::command]
pub async fn pomodoro_insert_segments<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    segments: Vec<PomodoroSegmentWrite>,
) -> Result<(), String> {
    commands::pomodoro_insert_segments(app, db_url, segments).await
}

#[tauri::command]
pub async fn pomodoro_insert_segment_with_adaptive_decision<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    segment: PomodoroSegmentWrite,
    adaptive_decision: PomodoroAdaptiveDecisionEnvelopeWrite,
) -> Result<(), String> {
    commands::pomodoro_insert_segment_with_adaptive_decision(
        app,
        db_url,
        segment,
        adaptive_decision,
    )
    .await
}

#[tauri::command]
pub async fn pomodoro_update_segments<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    segments: Vec<PomodoroSegmentUpdate>,
) -> Result<(), String> {
    commands::pomodoro_update_segments(app, db_url, segments).await
}

#[tauri::command]
pub async fn pomodoro_close_run<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    closure: PomodoroRunClosure,
) -> Result<(), String> {
    commands::pomodoro_close_run(app, db_url, closure).await
}

#[tauri::command]
pub async fn pomodoro_update_run_window<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    update: PomodoroRunWindowUpdate,
) -> Result<(), String> {
    commands::pomodoro_update_run_window(app, db_url, update).await
}

#[tauri::command]
pub async fn pomodoro_transfer_active_event_reference<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    transfer: PomodoroActiveEventReferenceTransfer,
) -> Result<(), String> {
    commands::pomodoro_transfer_active_event_reference(app, db_url, transfer).await
}

#[tauri::command]
pub async fn pomodoro_heartbeat<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    run_id: String,
    heartbeat_at: String,
) -> Result<(), String> {
    commands::pomodoro_heartbeat(app, db_url, run_id, heartbeat_at).await
}

#[tauri::command]
pub async fn pomodoro_record_run_event<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    event: PomodoroRunEventWrite,
) -> Result<(), String> {
    commands::pomodoro_record_run_event(app, db_url, event).await
}

#[tauri::command]
pub async fn pomodoro_recover_open_runs<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<(), String> {
    commands::pomodoro_recover_open_runs(app, db_url).await
}
