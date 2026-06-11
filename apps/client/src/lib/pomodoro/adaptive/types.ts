import type { SegmentPhase } from "$lib/components/calendar/types";
import type { CountPomodoroRhythm } from "$lib/pomodoro/rhythm";

export type AdaptiveOpportunityKind =
  | "run_start"
  | "focus_start"
  | "break_start"
  | "focus_tick"
  | "break_overtime"
  | "block_event"
  | "idle_failure"
  | "run_outcome";

export type AdaptiveDecisionMode =
  | "fallback"
  | "hold"
  | "recovery"
  | "guardrail"
  | "exploit"
  | "explore";

export type AdaptiveReasonCode =
  | "no_history"
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
  | "hold_current_rhythm";

export type AdaptiveDataQualityFlag =
  | "extension_unavailable"
  | "desktop_tracking_unavailable"
  | "diary_missing"
  | "idle_detection_disabled"
  | "crash_recovered"
  | "calendar_clipped";

export type AdaptiveParameterKey =
  | "focus_duration_minutes"
  | "short_break_minutes"
  | "long_break_minutes"
  | "long_break_after_focus_count";

export type AdaptiveValueUnit = "minutes" | "count";

export type AdaptiveFeatureSourceKind =
  | "pomodoro"
  | "doomscrolling"
  | "calendar"
  | "diary"
  | "project"
  | "environment"
  | "device";

export type AdaptiveBlockSourceType = "browser" | "desktop_app" | "mobile_app";

export type AdaptiveBlockDecision =
  | "blocked"
  | "temporary_allowed"
  | "false_positive_reported"
  | "limit_exhausted";

export type AdaptiveRunEventType =
  | "start"
  | "phase_start"
  | "phase_complete"
  | "pause_start"
  | "pause_end"
  | "idle_detected"
  | "focus_failed"
  | "suspend_detected"
  | "skip_break"
  | "extend_focus"
  | "go_to_break_now"
  | "start_focus_now"
  | "reconfigure"
  | "block_transition"
  | "stop"
  | "complete"
  | "crash_recovery";

export type AdaptivePauseReason = "idle" | "manual" | "suspend";

export type AdaptiveSegmentStatus = "active" | "completed" | "interrupted" | "skipped";

export type AdaptiveSegmentEndReason =
  | "completed"
  | "stopped"
  | "skipped_by_user"
  | "event_expired"
  | "focus_failed"
  | "reconfigured"
  | "block_transition"
  | "crash_recovery";

export type AdaptiveTimeOfDayBucket = "morning" | "midday" | "afternoon" | "evening" | "late";
export type AdaptiveSessionPosition = "first" | "middle" | "late";
export type AdaptiveEventLengthBucket = "short" | "medium" | "long";
export type AdaptiveWorkloadBucket = "low" | "normal" | "high";
export type AdaptiveEnergyBucket = "low" | "normal" | "high" | "unknown";

export interface AdaptivePauseInput {
  startedAt: string;
  endedAt: string | null;
  reason: AdaptivePauseReason;
}

export interface AdaptiveSegmentInput {
  runId?: string;
  rhythmPosition?: number;
  phase: SegmentPhase;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  status: AdaptiveSegmentStatus;
  endReason: AdaptiveSegmentEndReason | null;
  pauseLog: readonly AdaptivePauseInput[];
}

export interface AdaptiveRunEventInput {
  eventType: AdaptiveRunEventType;
  occurredAt: string;
  phase: SegmentPhase | null;
  reason: string | null;
  durationSeconds: number | null;
}

export interface AdaptiveBlockEventInput {
  occurredAt: string;
  phase: SegmentPhase | "manual_pause" | "idle_pause" | "suspend_pause" | null;
  sourceType: AdaptiveBlockSourceType;
  sourceKey: string;
  decision: AdaptiveBlockDecision;
}

export interface AdaptiveContextBucket {
  timeOfDay: AdaptiveTimeOfDayBucket;
  sessionPosition: AdaptiveSessionPosition;
  eventLength: AdaptiveEventLengthBucket;
  workload: AdaptiveWorkloadBucket;
  energy: AdaptiveEnergyBucket;
  environmentId: string | null;
}

export interface AdaptiveContextInput {
  localStartedAt: string;
  plannedEventMinutes: number;
  sessionIndexToday: number;
  cleanFocusMinutesToday: number;
  energyLevel: number | null;
  environmentId: string | null;
}

export interface AdaptiveFeatureInput {
  segments: readonly AdaptiveSegmentInput[];
  runEvents?: readonly AdaptiveRunEventInput[];
  blockEvents?: readonly AdaptiveBlockEventInput[];
  dataQualityFlags?: readonly AdaptiveDataQualityFlag[];
  observationEndedAt?: string;
}

export interface AdaptiveFeatureVector {
  completedFocusSegments: number;
  interruptedFocusSegments: number;
  focusFailureCount: number;
  lateFocusSegmentCount: number;
  lateFocusFailureCount: number;
  cleanFocusSeconds: number;
  plannedFocusSeconds: number;
  idlePauseCount: number;
  idlePauseSeconds: number;
  focusIdlePauseCount: number;
  focusIdlePauseSeconds: number;
  earlyFocusIdlePauseCount: number;
  lateFocusIdlePauseCount: number;
  manualPauseCount: number;
  manualPauseSeconds: number;
  suspendPauseCount: number;
  suspendPauseSeconds: number;
  breakStartedCount: number;
  breakCompletedCount: number;
  breakSkippedCount: number;
  skippedBreakNextFocusSuccessCount: number;
  skippedBreakNextFocusFailureCount: number;
  skippedShortBreakNextFocusFailureCount: number;
  skippedLongBreakNextFocusFailureCount: number;
  shortBreakOvertimeSeconds: number;
  longBreakOvertimeSeconds: number;
  blockedAttemptCount: number;
  blockedBurstCount: number;
  repeatedBlockedSourceAttemptCount: number;
  focusRepeatedBlockedSourceAttemptCount: number;
  breakRepeatedBlockedSourceAttemptCount: number;
  focusBlockedAttemptCount: number;
  earlyFocusBlockedAttemptCount: number;
  lateFocusBlockedAttemptCount: number;
  breakBlockedAttemptCount: number;
  breakOvertimeBlockedAttemptCount: number;
  shortBreakOvertimeBlockedAttemptCount: number;
  longBreakOvertimeBlockedAttemptCount: number;
  extensionCount: number;
  goToBreakNowCount: number;
  earlyGoToBreakNowCount: number;
  lateGoToBreakNowCount: number;
  startFocusNowCount: number;
  startFocusNowSuccessCount: number;
  startFocusNowFailureCount: number;
  stopCount: number;
  comparableOpportunityCount: number;
  dataQualityFlags: readonly AdaptiveDataQualityFlag[];
}

export interface AdaptiveStateScores {
  readiness: number;
  strain: number;
  recoveryDebt: number;
  avoidancePressure: number;
  momentum: number;
  confidence: number;
}

export interface AdaptivePolicyInput {
  currentRhythm: CountPomodoroRhythm;
  features: AdaptiveFeatureVector;
  state: AdaptiveStateScores;
  context: AdaptiveContextBucket;
}

export interface AdaptivePolicyDecision {
  selectedRhythm: CountPomodoroRhythm;
  mode: AdaptiveDecisionMode;
  reasonCodes: readonly AdaptiveReasonCode[];
  stateScores: AdaptiveStateScores;
}
