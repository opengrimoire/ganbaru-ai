import {
  ADAPTIVE_BASELINE_RHYTHM,
  HIGH_AVOIDANCE_THRESHOLD,
  HIGH_MOMENTUM_THRESHOLD,
  HIGH_RECOVERY_DEBT_THRESHOLD,
  HIGH_STRAIN_THRESHOLD,
  LONG_BREAK_DRIFT_SECONDS,
  LOW_RISK_THRESHOLD,
  MODERATE_CONFIDENCE_THRESHOLD,
} from "./constants";
import {
  analyzeRunFocusDurationExperiment,
  analyzeRunFocusWithShortBreakSupportExperiment,
  analyzeRunLongBreakCadenceExperiment,
  analyzeRunLongBreakCadenceExpansionExperiment,
  analyzeRunLongBreakDurationExperiment,
  analyzeRunLongRecoverySupportExperiment,
  analyzeRunShortBreakDurationExperiment,
} from "./experiment-analysis";
import {
  RUN_FOCUS_DURATION_EXPERIMENT,
  RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT,
  RUN_LONG_BREAK_CADENCE_EXPERIMENT,
  RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT,
  RUN_LONG_BREAK_DURATION_EXPERIMENT,
  RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT,
  RUN_SHORT_BREAK_DURATION_EXPERIMENT,
  type AdaptiveExperimentAnalysis,
  type AdaptiveExperimentAssignment,
  type AdaptiveExperimentAssignmentHistory,
  type AdaptiveExperimentState,
  type AdaptiveExperimentVariantOutcome,
  type SelectRunStartExperimentInput,
} from "./experiment-types";
import type { AdaptiveContextBucket } from "./types";
import type { CountPomodoroRhythm } from "$lib/pomodoro/rhythm";

type AnalyzeExperimentWithFallback = (
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey?: string,
) => AdaptiveExperimentAnalysis;

const EXPERIMENT_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const EXPLORATION_BUDGET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CONTEXT_EXPLORATION_BUDGET_PER_WEEK = 2;

export function selectRunStartExperimentAssignment(
  input: SelectRunStartExperimentInput,
): AdaptiveExperimentAssignment | null {
  if (!hasContextExplorationBudget(input)) return null;
  for (const selectAssignment of [
    selectRunFocusWithShortBreakSupportExperimentAssignment,
    selectRunFocusExperimentAssignment,
    selectRunShortBreakExperimentAssignment,
    selectRunLongRecoverySupportExperimentAssignment,
    selectRunLongBreakExperimentAssignment,
    selectRunLongBreakCadenceExperimentAssignment,
    selectRunLongBreakCadenceExpansionExperimentAssignment,
  ]) {
    const assignment = selectAssignment(input);
    if (assignment && hasCompatibleContextExperimentLane(input, assignment.experiment.id)) {
      return assignment;
    }
  }
  return null;
}

function hasContextExplorationBudget(input: SelectRunStartExperimentInput): boolean {
  return recentContextAssignments(input).length < DEFAULT_CONTEXT_EXPLORATION_BUDGET_PER_WEEK;
}

function hasCompatibleContextExperimentLane(
  input: SelectRunStartExperimentInput,
  experimentId: string,
): boolean {
  const latestAssignment = latestRecentContextAssignment(input);
  return !latestAssignment || latestAssignment.experimentId === experimentId;
}

function latestRecentContextAssignment(
  input: SelectRunStartExperimentInput,
): AdaptiveExperimentAssignmentHistory | null {
  let latestAssignment: AdaptiveExperimentAssignmentHistory | null = null;
  let latestAssignedAtMs = Number.NEGATIVE_INFINITY;
  for (const assignment of recentContextAssignments(input)) {
    const assignedAtMs = Date.parse(assignment.assignedAt);
    if (assignedAtMs > latestAssignedAtMs) {
      latestAssignment = assignment;
      latestAssignedAtMs = assignedAtMs;
    }
  }
  return latestAssignment;
}

function recentContextAssignments(
  input: SelectRunStartExperimentInput,
): AdaptiveExperimentAssignmentHistory[] {
  const assignments = input.experimentAssignments;
  if (!assignments || assignments.length === 0) return [];
  const occurredAtMs = Date.parse(input.occurredAt);
  if (!Number.isFinite(occurredAtMs)) return [];
  const contextKey = experimentContextKey(input.context);
  const windowStartMs = occurredAtMs - EXPLORATION_BUDGET_WINDOW_MS;
  return assignments.filter((assignment) => {
    if (assignment.contextKey !== contextKey) return false;
    const assignedAtMs = Date.parse(assignment.assignedAt);
    return Number.isFinite(assignedAtMs) &&
      assignedAtMs >= windowStartMs &&
      assignedAtMs < occurredAtMs;
  });
}

function selectRunFocusWithShortBreakSupportExperimentAssignment(
  input: SelectRunStartExperimentInput,
): AdaptiveExperimentAssignment | null {
  if (!isEligibleForRunFocusWithShortBreakSupportExperiment(input)) return null;
  if (
    scalarComponentRejected(input, RUN_FOCUS_DURATION_EXPERIMENT.id, analyzeRunFocusDurationExperiment) ||
    scalarComponentRejected(input, RUN_SHORT_BREAK_DURATION_EXPERIMENT.id, analyzeRunShortBreakDurationExperiment)
  ) {
    return null;
  }
  if (experimentCooldownState(
    input.experimentStates ?? [],
    RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id,
    input.occurredAt,
  )) {
    return null;
  }
  const analysis = analyzeRunFocusWithShortBreakSupportExperiment(
    input.experimentOutcomes ?? [],
    experimentContextKey(input.context),
  );
  if (analysis.decision === "prefer_control" || analysis.decision === "prefer_treatment") {
    return null;
  }
  const assignmentSeed = runAssignmentSeed(
    RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id,
    input.context,
    input.occurredAt,
  );
  const variant = RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.variants[
    stableVariantIndex(assignmentSeed, RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.variants.length)
  ];

  return {
    experiment: RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT,
    variant,
    assignmentSeed,
    assignedAt: input.occurredAt,
    selectedRhythm: variant.isControl
      ? { ...ADAPTIVE_BASELINE_RHYTHM }
      : focusWithShortBreakSupportRhythm(),
  };
}

function selectRunFocusExperimentAssignment(
  input: SelectRunStartExperimentInput,
): AdaptiveExperimentAssignment | null {
  if (!isEligibleForRunFocusExperiment(input)) return null;
  if (experimentCooldownState(
    input.experimentStates ?? [],
    RUN_FOCUS_DURATION_EXPERIMENT.id,
    input.occurredAt,
  )) {
    return null;
  }
  const analysis = analyzeRunFocusDurationExperiment(
    input.experimentOutcomes ?? [],
    experimentContextKey(input.context),
  );
  if (analysis.decision === "prefer_control" || analysis.decision === "prefer_treatment") {
    return null;
  }
  const assignmentSeed = runAssignmentSeed(RUN_FOCUS_DURATION_EXPERIMENT.id, input.context, input.occurredAt);
  const variant = RUN_FOCUS_DURATION_EXPERIMENT.variants[
    stableVariantIndex(assignmentSeed, RUN_FOCUS_DURATION_EXPERIMENT.variants.length)
  ];

  return {
    experiment: RUN_FOCUS_DURATION_EXPERIMENT,
    variant,
    assignmentSeed,
    assignedAt: input.occurredAt,
    selectedRhythm: {
      ...input.selectedRhythm,
      focusDurationMinutes: variant.numericValue,
    },
  };
}

function selectRunShortBreakExperimentAssignment(
  input: SelectRunStartExperimentInput,
): AdaptiveExperimentAssignment | null {
  if (!isEligibleForRunShortBreakExperiment(input)) return null;
  if (experimentCooldownState(
    input.experimentStates ?? [],
    RUN_SHORT_BREAK_DURATION_EXPERIMENT.id,
    input.occurredAt,
  )) {
    return null;
  }
  const analysis = analyzeRunShortBreakDurationExperiment(
    input.experimentOutcomes ?? [],
    experimentContextKey(input.context),
  );
  if (analysis.decision === "prefer_control" || analysis.decision === "prefer_treatment") {
    return null;
  }
  const assignmentSeed = runAssignmentSeed(
    RUN_SHORT_BREAK_DURATION_EXPERIMENT.id,
    input.context,
    input.occurredAt,
  );
  const variant = RUN_SHORT_BREAK_DURATION_EXPERIMENT.variants[
    stableVariantIndex(assignmentSeed, RUN_SHORT_BREAK_DURATION_EXPERIMENT.variants.length)
  ];

  return {
    experiment: RUN_SHORT_BREAK_DURATION_EXPERIMENT,
    variant,
    assignmentSeed,
    assignedAt: input.occurredAt,
    selectedRhythm: {
      ...input.selectedRhythm,
      shortBreakMinutes: variant.numericValue,
    },
  };
}

function selectRunLongBreakExperimentAssignment(
  input: SelectRunStartExperimentInput,
): AdaptiveExperimentAssignment | null {
  if (!isEligibleForRunLongBreakExperiment(input)) return null;
  if (experimentCooldownState(
    input.experimentStates ?? [],
    RUN_LONG_BREAK_DURATION_EXPERIMENT.id,
    input.occurredAt,
  )) {
    return null;
  }
  const analysis = analyzeRunLongBreakDurationExperiment(
    input.experimentOutcomes ?? [],
    experimentContextKey(input.context),
  );
  if (analysis.decision === "prefer_control" || analysis.decision === "prefer_treatment") {
    return null;
  }
  const assignmentSeed = runAssignmentSeed(
    RUN_LONG_BREAK_DURATION_EXPERIMENT.id,
    input.context,
    input.occurredAt,
  );
  const variant = RUN_LONG_BREAK_DURATION_EXPERIMENT.variants[
    stableVariantIndex(assignmentSeed, RUN_LONG_BREAK_DURATION_EXPERIMENT.variants.length)
  ];

  return {
    experiment: RUN_LONG_BREAK_DURATION_EXPERIMENT,
    variant,
    assignmentSeed,
    assignedAt: input.occurredAt,
    selectedRhythm: {
      ...input.selectedRhythm,
      longBreakMinutes: variant.numericValue,
    },
  };
}

function selectRunLongRecoverySupportExperimentAssignment(
  input: SelectRunStartExperimentInput,
): AdaptiveExperimentAssignment | null {
  if (!isEligibleForRunLongRecoverySupportExperiment(input)) return null;
  if (
    scalarComponentRejected(input, RUN_LONG_BREAK_DURATION_EXPERIMENT.id, analyzeRunLongBreakDurationExperiment) ||
    scalarComponentRejected(input, RUN_LONG_BREAK_CADENCE_EXPERIMENT.id, analyzeRunLongBreakCadenceExperiment)
  ) {
    return null;
  }
  if (experimentCooldownState(
    input.experimentStates ?? [],
    RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT.id,
    input.occurredAt,
  )) {
    return null;
  }
  const analysis = analyzeRunLongRecoverySupportExperiment(
    input.experimentOutcomes ?? [],
    experimentContextKey(input.context),
  );
  if (analysis.decision === "prefer_control" || analysis.decision === "prefer_treatment") {
    return null;
  }
  const assignmentSeed = runAssignmentSeed(
    RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT.id,
    input.context,
    input.occurredAt,
  );
  const variant = RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT.variants[
    stableVariantIndex(assignmentSeed, RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT.variants.length)
  ];

  return {
    experiment: RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT,
    variant,
    assignmentSeed,
    assignedAt: input.occurredAt,
    selectedRhythm: variant.isControl
      ? { ...input.selectedRhythm }
      : longRecoverySupportRhythm(),
  };
}

function scalarComponentRejected(
  input: SelectRunStartExperimentInput,
  experimentId: string,
  analyzeExperiment: AnalyzeExperimentWithFallback,
): boolean {
  const cooldownState = experimentCooldownState(
    input.experimentStates ?? [],
    experimentId,
    input.occurredAt,
  );
  if (cooldownState?.status === "abandoned") return true;
  const analysis = analyzeExperiment(
    input.experimentOutcomes ?? [],
    experimentContextKey(input.context),
  );
  return analysis.decision === "prefer_control";
}

function selectRunLongBreakCadenceExperimentAssignment(
  input: SelectRunStartExperimentInput,
): AdaptiveExperimentAssignment | null {
  if (!isEligibleForRunLongBreakCadenceExperiment(input)) return null;
  if (experimentCooldownState(
    input.experimentStates ?? [],
    RUN_LONG_BREAK_CADENCE_EXPERIMENT.id,
    input.occurredAt,
  )) {
    return null;
  }
  const analysis = analyzeRunLongBreakCadenceExperiment(
    input.experimentOutcomes ?? [],
    experimentContextKey(input.context),
  );
  if (analysis.decision === "prefer_control" || analysis.decision === "prefer_treatment") {
    return null;
  }
  const assignmentSeed = runAssignmentSeed(
    RUN_LONG_BREAK_CADENCE_EXPERIMENT.id,
    input.context,
    input.occurredAt,
  );
  const variant = RUN_LONG_BREAK_CADENCE_EXPERIMENT.variants[
    stableVariantIndex(assignmentSeed, RUN_LONG_BREAK_CADENCE_EXPERIMENT.variants.length)
  ];

  return {
    experiment: RUN_LONG_BREAK_CADENCE_EXPERIMENT,
    variant,
    assignmentSeed,
    assignedAt: input.occurredAt,
    selectedRhythm: {
      ...input.selectedRhythm,
      longBreakAfterFocusCount: variant.numericValue,
    },
  };
}

function selectRunLongBreakCadenceExpansionExperimentAssignment(
  input: SelectRunStartExperimentInput,
): AdaptiveExperimentAssignment | null {
  if (!isEligibleForRunLongBreakCadenceExpansionExperiment(input)) return null;
  if (experimentCooldownState(
    input.experimentStates ?? [],
    RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.id,
    input.occurredAt,
  )) {
    return null;
  }
  const analysis = analyzeRunLongBreakCadenceExpansionExperiment(
    input.experimentOutcomes ?? [],
    experimentContextKey(input.context),
  );
  if (analysis.decision === "prefer_control" || analysis.decision === "prefer_treatment") {
    return null;
  }
  const assignmentSeed = runAssignmentSeed(
    RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.id,
    input.context,
    input.occurredAt,
  );
  const variant = RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.variants[
    stableVariantIndex(assignmentSeed, RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.variants.length)
  ];

  return {
    experiment: RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT,
    variant,
    assignmentSeed,
    assignedAt: input.occurredAt,
    selectedRhythm: {
      ...input.selectedRhythm,
      longBreakAfterFocusCount: variant.numericValue,
    },
  };
}

export function experimentCooldownState(
  experimentStates: readonly AdaptiveExperimentState[],
  experimentId: string,
  occurredAt: string,
): AdaptiveExperimentState | null {
  const occurredAtMs = Date.parse(occurredAt);
  if (!Number.isFinite(occurredAtMs)) return null;
  let latestState: AdaptiveExperimentState | null = null;
  let latestEndedAtMs = Number.NEGATIVE_INFINITY;
  for (const state of experimentStates) {
    if (state.experimentId !== experimentId) continue;
    if (state.status !== "completed" && state.status !== "abandoned") continue;
    if (!state.endedAt) continue;
    const endedAtMs = Date.parse(state.endedAt);
    if (!Number.isFinite(endedAtMs) || endedAtMs > occurredAtMs) continue;
    if (occurredAtMs - endedAtMs > EXPERIMENT_COOLDOWN_MS) continue;
    if (endedAtMs > latestEndedAtMs) {
      latestState = state;
      latestEndedAtMs = endedAtMs;
    }
  }
  return latestState;
}

export function stableVariantIndex(seed: string, variantCount: number): number {
  if (!Number.isInteger(variantCount) || variantCount <= 0) return 0;
  return stableHash(seed) % variantCount;
}

function isEligibleForRunFocusWithShortBreakSupportExperiment(
  input: SelectRunStartExperimentInput,
): boolean {
  if (input.currentRhythm.kind !== "count" || input.selectedRhythm.kind !== "count") return false;
  if (!sameCountRhythm(input.currentRhythm, ADAPTIVE_BASELINE_RHYTHM)) return false;
  if (!sameCountRhythm(input.selectedRhythm, {
    ...ADAPTIVE_BASELINE_RHYTHM,
    focusDurationMinutes: 45,
  })) return false;
  if (input.features.comparableOpportunityCount < 24) return false;
  if (input.features.completedFocusSegments < 8) return false;
  if (input.features.breakCompletedCount < 8) return false;
  if (input.features.dataQualityFlags.includes("extension_unavailable")) return false;
  if (input.state.confidence < MODERATE_CONFIDENCE_THRESHOLD) return false;
  if (input.state.strain >= LOW_RISK_THRESHOLD) return false;
  if (input.state.recoveryDebt >= LOW_RISK_THRESHOLD) return false;
  if (input.state.avoidancePressure >= LOW_RISK_THRESHOLD) return false;
  if (input.features.focusFailureCount > 0) return false;
  if (input.features.interruptedFocusSegments > 0) return false;
  if (input.features.breakSkippedCount > 0) return false;
  return true;
}

function isEligibleForRunFocusExperiment(input: SelectRunStartExperimentInput): boolean {
  if (input.currentRhythm.kind !== "count" || input.selectedRhythm.kind !== "count") return false;
  if (!sameCountRhythm(input.currentRhythm, ADAPTIVE_BASELINE_RHYTHM)) return false;
  if (!sameCountRhythm(input.selectedRhythm, {
    ...ADAPTIVE_BASELINE_RHYTHM,
    focusDurationMinutes: 45,
  })) return false;
  if (input.features.comparableOpportunityCount < 8) return false;
  if (input.features.dataQualityFlags.includes("extension_unavailable")) return false;
  if (input.state.confidence < MODERATE_CONFIDENCE_THRESHOLD) return false;
  if (input.state.strain >= LOW_RISK_THRESHOLD) return false;
  if (input.state.recoveryDebt >= LOW_RISK_THRESHOLD) return false;
  if (input.state.avoidancePressure >= LOW_RISK_THRESHOLD) return false;
  return true;
}

function focusWithShortBreakSupportRhythm(): CountPomodoroRhythm {
  return {
    ...ADAPTIVE_BASELINE_RHYTHM,
    focusDurationMinutes: 45,
    shortBreakMinutes: 7,
  };
}

function isEligibleForRunShortBreakExperiment(input: SelectRunStartExperimentInput): boolean {
  if (input.currentRhythm.kind !== "count" || input.selectedRhythm.kind !== "count") return false;
  if (!sameCountRhythm(input.currentRhythm, ADAPTIVE_BASELINE_RHYTHM)) return false;
  if (!sameCountRhythm(input.selectedRhythm, {
    ...ADAPTIVE_BASELINE_RHYTHM,
    shortBreakMinutes: 7,
  })) return false;
  if (input.features.shortBreakOvertimeSeconds < 2 * 60) return false;
  if (input.features.comparableOpportunityCount < 8) return false;
  if (input.features.dataQualityFlags.includes("extension_unavailable")) return false;
  if (input.state.confidence < MODERATE_CONFIDENCE_THRESHOLD) return false;
  if (input.state.strain >= LOW_RISK_THRESHOLD) return false;
  if (input.state.recoveryDebt >= LOW_RISK_THRESHOLD) return false;
  if (input.state.avoidancePressure >= LOW_RISK_THRESHOLD) return false;
  return true;
}

function isEligibleForRunLongBreakExperiment(input: SelectRunStartExperimentInput): boolean {
  if (input.currentRhythm.kind !== "count" || input.selectedRhythm.kind !== "count") return false;
  if (!sameCountRhythm(input.currentRhythm, ADAPTIVE_BASELINE_RHYTHM)) return false;
  if (!sameCountRhythm(input.selectedRhythm, {
    ...ADAPTIVE_BASELINE_RHYTHM,
    longBreakMinutes: 15,
  })) return false;
  if (input.features.longBreakOvertimeSeconds < LONG_BREAK_DRIFT_SECONDS) return false;
  if (input.features.longBreakOvertimeBlockedAttemptCount > 0) return false;
  if (input.features.comparableOpportunityCount < 8) return false;
  if (input.features.dataQualityFlags.includes("extension_unavailable")) return false;
  if (input.state.confidence < MODERATE_CONFIDENCE_THRESHOLD) return false;
  if (input.state.strain >= LOW_RISK_THRESHOLD) return false;
  if (input.state.recoveryDebt >= LOW_RISK_THRESHOLD) return false;
  if (input.state.avoidancePressure >= LOW_RISK_THRESHOLD) return false;
  return true;
}

function isEligibleForRunLongRecoverySupportExperiment(input: SelectRunStartExperimentInput): boolean {
  if (input.currentRhythm.kind !== "count" || input.selectedRhythm.kind !== "count") return false;
  if (!sameCountRhythm(input.currentRhythm, ADAPTIVE_BASELINE_RHYTHM)) return false;
  if (!sameCountRhythm(input.selectedRhythm, {
    ...ADAPTIVE_BASELINE_RHYTHM,
    longBreakMinutes: 15,
  })) return false;
  if (input.features.longBreakOvertimeSeconds < LONG_BREAK_DRIFT_SECONDS) return false;
  if (input.features.longBreakOvertimeBlockedAttemptCount > 0) return false;
  if (input.features.completedFocusSegments < 8) return false;
  if (input.features.breakCompletedCount < 4) return false;
  if (input.features.breakSkippedCount > 0) return false;
  if (input.features.focusFailureCount > 0) return false;
  if (input.features.interruptedFocusSegments > 0) return false;
  if (input.features.comparableOpportunityCount < 24) return false;
  if (input.features.dataQualityFlags.includes("extension_unavailable")) return false;
  if (input.state.confidence < MODERATE_CONFIDENCE_THRESHOLD) return false;
  if (input.state.strain >= LOW_RISK_THRESHOLD) return false;
  if (input.state.recoveryDebt >= LOW_RISK_THRESHOLD) return false;
  if (input.state.avoidancePressure >= LOW_RISK_THRESHOLD) return false;
  return true;
}

function longRecoverySupportRhythm(): CountPomodoroRhythm {
  return {
    ...ADAPTIVE_BASELINE_RHYTHM,
    longBreakMinutes: 15,
    longBreakAfterFocusCount: 3,
  };
}

function isEligibleForRunLongBreakCadenceExperiment(input: SelectRunStartExperimentInput): boolean {
  if (input.currentRhythm.kind !== "count" || input.selectedRhythm.kind !== "count") return false;
  if (!sameCountRhythm(input.currentRhythm, ADAPTIVE_BASELINE_RHYTHM)) return false;
  if (!sameCountRhythm(input.selectedRhythm, {
    ...ADAPTIVE_BASELINE_RHYTHM,
    longBreakAfterFocusCount: 3,
  })) return false;
  if (input.features.lateFocusSegmentCount < 2) return false;
  if (
    input.features.lateFocusFailureCount < 1 &&
    input.features.lateFocusBlockedAttemptCount < 3
  ) {
    return false;
  }
  if (input.features.comparableOpportunityCount < 8) return false;
  if (input.features.dataQualityFlags.includes("extension_unavailable")) return false;
  if (input.state.confidence < MODERATE_CONFIDENCE_THRESHOLD) return false;
  if (input.state.strain >= HIGH_STRAIN_THRESHOLD) return false;
  if (input.state.recoveryDebt >= HIGH_RECOVERY_DEBT_THRESHOLD) return false;
  if (input.state.avoidancePressure >= HIGH_AVOIDANCE_THRESHOLD) return false;
  return true;
}

function isEligibleForRunLongBreakCadenceExpansionExperiment(input: SelectRunStartExperimentInput): boolean {
  if (input.currentRhythm.kind !== "count" || input.selectedRhythm.kind !== "count") return false;
  if (!sameCountRhythm(input.currentRhythm, ADAPTIVE_BASELINE_RHYTHM)) return false;
  if (!sameCountRhythm(input.selectedRhythm, {
    ...ADAPTIVE_BASELINE_RHYTHM,
    longBreakAfterFocusCount: 5,
  })) return false;
  if (input.features.completedFocusSegments < 12) return false;
  if (input.features.cleanFocusSeconds < input.features.plannedFocusSeconds) return false;
  if (input.features.interruptedFocusSegments > 0 || input.features.focusFailureCount > 0) return false;
  if (input.features.breakSkippedCount > 0) return false;
  if (input.features.breakCompletedCount < 10) return false;
  if (input.features.blockedAttemptCount > 0) return false;
  if (input.features.shortBreakOvertimeSeconds > 0 || input.features.longBreakOvertimeSeconds > 0) return false;
  if (input.features.comparableOpportunityCount < 24) return false;
  if (input.features.dataQualityFlags.includes("extension_unavailable")) return false;
  if (input.state.confidence < MODERATE_CONFIDENCE_THRESHOLD) return false;
  if (input.state.momentum < HIGH_MOMENTUM_THRESHOLD) return false;
  if (input.state.strain >= LOW_RISK_THRESHOLD) return false;
  if (input.state.recoveryDebt >= LOW_RISK_THRESHOLD) return false;
  if (input.state.avoidancePressure >= LOW_RISK_THRESHOLD) return false;
  return true;
}

function sameCountRhythm(a: CountPomodoroRhythm, b: CountPomodoroRhythm): boolean {
  return a.focusDurationMinutes === b.focusDurationMinutes &&
    a.shortBreakMinutes === b.shortBreakMinutes &&
    a.longBreakMinutes === b.longBreakMinutes &&
    a.longBreakAfterFocusCount === b.longBreakAfterFocusCount;
}

function runAssignmentSeed(
  experimentId: string,
  context: AdaptiveContextBucket,
  occurredAt: string,
): string {
  return [
    experimentId,
    experimentContextKey(context),
    localDayKey(occurredAt),
    occurredAt,
  ].join("|");
}

export function experimentContextKey(context: AdaptiveContextBucket): string {
  return [
    context.timeOfDay,
    context.sessionPosition,
    context.eventLength,
    context.workload,
    context.energy,
    context.environmentId ?? "none",
  ].join(":");
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function localDayKey(value: string): string {
  return new Date(value).toDateString();
}
