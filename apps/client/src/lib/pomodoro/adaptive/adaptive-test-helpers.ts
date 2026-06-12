import { ADAPTIVE_BASELINE_RHYTHM } from "./constants";
import type {
  AdaptiveExperimentAssignmentHistory,
  AdaptiveExperimentState,
  AdaptiveExperimentVariantOutcome,
} from "./experiments";
import { adaptiveContextKey } from "./persistence";
import type {
  AdaptiveBlockEventInput,
  AdaptiveContextBucket,
  AdaptiveFeatureVector,
  AdaptiveRunEventInput,
  AdaptiveSegmentInput,
  AdaptiveStateScores,
} from "./types";
import { computePlannedSegments } from "$lib/utils/pomodoro-segments";
import {
  createPresetPomodoroConfig,
  type CountPomodoroRhythm,
} from "$lib/pomodoro/rhythm";
import type { CalendarEvent, PomodoroConfig } from "$lib/components/calendar/types";

export const CONTEXT: AdaptiveContextBucket = {
  timeOfDay: "morning",
  sessionPosition: "first",
  eventLength: "medium",
  workload: "low",
  energy: "unknown",
  environmentId: null,
};

export function configFromSelectedRhythm(rhythm: CountPomodoroRhythm): PomodoroConfig {
  return {
    ...createPresetPomodoroConfig("adaptive"),
    rhythm: { ...rhythm },
  };
}

export function calendarEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "event-1",
    title: "Focus",
    start: "2026-06-10 09:00",
    end: "2026-06-10 10:00",
    timezone: "America/Monterrey",
    calendarId: "calendar-1",
    pomodoroConfig: createPresetPomodoroConfig("adaptive"),
    ...overrides,
  };
}

export function capacityRhythm(): CountPomodoroRhythm {
  return {
    ...ADAPTIVE_BASELINE_RHYTHM,
    focusDurationMinutes: 45,
  };
}

export function focusSegment(
  overrides: Partial<AdaptiveSegmentInput> = {},
): AdaptiveSegmentInput {
  return {
    phase: "focus",
    plannedStart: "2026-06-10T09:00:00.000Z",
    plannedEnd: "2026-06-10T09:40:00.000Z",
    actualStart: "2026-06-10T09:00:00.000Z",
    actualEnd: "2026-06-10T09:40:00.000Z",
    status: "completed",
    endReason: "completed",
    pauseLog: [],
    ...overrides,
  };
}

export function breakSegment(
  overrides: Partial<AdaptiveSegmentInput> = {},
): AdaptiveSegmentInput {
  return {
    phase: "short_break",
    plannedStart: "2026-06-10T09:40:00.000Z",
    plannedEnd: "2026-06-10T09:45:00.000Z",
    actualStart: "2026-06-10T09:40:00.000Z",
    actualEnd: "2026-06-10T09:45:45.000Z",
    status: "completed",
    endReason: "completed",
    pauseLog: [],
    ...overrides,
  };
}

export function blockedBurstEvents(): AdaptiveBlockEventInput[] {
  return [
    "2026-06-10T09:01:00.000Z",
    "2026-06-10T09:02:00.000Z",
    "2026-06-10T09:03:00.000Z",
    "2026-06-10T09:20:00.000Z",
    "2026-06-10T09:21:00.000Z",
    "2026-06-10T09:22:00.000Z",
  ].map((occurredAt, index) => ({
    occurredAt,
    phase: "focus",
    sourceType: "browser",
    sourceKey: `social-${index}`,
    decision: "blocked",
  }));
}

export function blockedFocusEvent(occurredAt: string, sourceKey = "social"): AdaptiveBlockEventInput {
  return {
    occurredAt,
    phase: "focus",
    sourceType: "browser",
    sourceKey,
    decision: "blocked",
  };
}

export function blockedBreakEvent(
  occurredAt: string,
  phase: "short_break" | "long_break",
  sourceKey = "social",
): AdaptiveBlockEventInput {
  return {
    occurredAt,
    phase,
    sourceType: "browser",
    sourceKey,
    decision: "blocked",
  };
}

export function runEvent(overrides: Partial<AdaptiveRunEventInput>): AdaptiveRunEventInput {
  return {
    eventType: "start",
    occurredAt: "2026-06-10T09:00:00.000Z",
    phase: null,
    reason: null,
    durationSeconds: null,
    ...overrides,
  };
}

export function baseFeatures(overrides: Partial<AdaptiveFeatureVector> = {}): AdaptiveFeatureVector {
  return {
    completedFocusSegments: 0,
    interruptedFocusSegments: 0,
    focusFailureCount: 0,
    lateFocusSegmentCount: 0,
    lateFocusFailureCount: 0,
    cleanFocusSeconds: 0,
    plannedFocusSeconds: 0,
    idlePauseCount: 0,
    idlePauseSeconds: 0,
    focusIdlePauseCount: 0,
    focusIdlePauseSeconds: 0,
    earlyFocusIdlePauseCount: 0,
    lateFocusIdlePauseCount: 0,
    manualPauseCount: 0,
    manualPauseSeconds: 0,
    suspendPauseCount: 0,
    suspendPauseSeconds: 0,
    breakStartedCount: 0,
    breakCompletedCount: 0,
    breakSkippedCount: 0,
    skippedBreakNextFocusSuccessCount: 0,
    skippedBreakNextFocusFailureCount: 0,
    skippedShortBreakNextFocusFailureCount: 0,
    skippedLongBreakNextFocusFailureCount: 0,
    shortBreakOvertimeSeconds: 0,
    longBreakOvertimeSeconds: 0,
    blockedAttemptCount: 0,
    blockedBurstCount: 0,
    repeatedBlockedSourceAttemptCount: 0,
    focusRepeatedBlockedSourceAttemptCount: 0,
    breakRepeatedBlockedSourceAttemptCount: 0,
    focusBlockedAttemptCount: 0,
    earlyFocusBlockedAttemptCount: 0,
    lateFocusBlockedAttemptCount: 0,
    breakBlockedAttemptCount: 0,
    breakOvertimeBlockedAttemptCount: 0,
    shortBreakOvertimeBlockedAttemptCount: 0,
    longBreakOvertimeBlockedAttemptCount: 0,
    extensionCount: 0,
    goToBreakNowCount: 0,
    earlyGoToBreakNowCount: 0,
    lateGoToBreakNowCount: 0,
    startFocusNowCount: 0,
    startFocusNowSuccessCount: 0,
    startFocusNowFailureCount: 0,
    stopCount: 0,
    comparableOpportunityCount: 0,
    dataQualityFlags: [],
    ...overrides,
  };
}

export function breakDriftExperimentFeatures(): AdaptiveFeatureVector {
  return baseFeatures({
    completedFocusSegments: 8,
    cleanFocusSeconds: 8 * 40 * 60,
    plannedFocusSeconds: 8 * 40 * 60,
    breakStartedCount: 4,
    breakCompletedCount: 4,
    shortBreakOvertimeSeconds: 3 * 60,
    comparableOpportunityCount: 12,
  });
}

export function longBreakDriftExperimentFeatures(): AdaptiveFeatureVector {
  return baseFeatures({
    completedFocusSegments: 8,
    cleanFocusSeconds: 8 * 40 * 60,
    plannedFocusSeconds: 8 * 40 * 60,
    breakStartedCount: 4,
    breakCompletedCount: 4,
    longBreakOvertimeSeconds: 6 * 60,
    comparableOpportunityCount: 12,
  });
}

export function longRecoverySupportExperimentFeatures(): AdaptiveFeatureVector {
  return {
    ...longBreakDriftExperimentFeatures(),
    comparableOpportunityCount: 24,
  };
}

export function cadenceExperimentFeatures(): AdaptiveFeatureVector {
  return baseFeatures({
    completedFocusSegments: 7,
    interruptedFocusSegments: 1,
    focusFailureCount: 1,
    lateFocusSegmentCount: 3,
    lateFocusFailureCount: 1,
    cleanFocusSeconds: 7 * 40 * 60,
    plannedFocusSeconds: 8 * 40 * 60,
    comparableOpportunityCount: 12,
  });
}

export function cadenceExpansionExperimentFeatures(): AdaptiveFeatureVector {
  return baseFeatures({
    completedFocusSegments: 12,
    cleanFocusSeconds: 12 * 40 * 60,
    plannedFocusSeconds: 12 * 40 * 60,
    breakStartedCount: 12,
    breakCompletedCount: 12,
    comparableOpportunityCount: 24,
  });
}

export function safeExperimentState(): AdaptiveStateScores {
  return {
    readiness: 0.8,
    strain: 0.1,
    recoveryDebt: 0.1,
    avoidancePressure: 0.1,
    momentum: 0.78,
    confidence: 0.75,
  };
}

export function experimentOutcome(
  overrides: Partial<AdaptiveExperimentVariantOutcome>,
): AdaptiveExperimentVariantOutcome {
  return {
    experimentId: "run-focus-duration-40-vs-45-v1",
    variantKey: "control_40",
    contextKey: null,
    assignmentCount: overrides.runObservedCount ?? 0,
    runObservedCount: 0,
    runCompletedCount: 0,
    runStoppedCount: 0,
    cleanFocusSecondsSum: 0,
    cleanFocusSecondsSquareSum: 0,
    blockedAttemptCountSum: 0,
    blockedAttemptCountSquareSum: 0,
    breakSkippedCountSum: 0,
    breakSkippedCountSquareSum: 0,
    shortBreakOvertimeSecondsSum: 0,
    shortBreakOvertimeSecondsSquareSum: 0,
    longBreakOvertimeSecondsSum: 0,
    longBreakOvertimeSecondsSquareSum: 0,
    dayObservedCount: 0,
    dayStartedPlannedPomodoroCountSum: 0,
    dayMissedPlannedPomodoroCountSum: 0,
    dayMissedPlannedPomodoroCountSquareSum: 0,
    dayCleanFocusSecondsSum: 0,
    dayBlockedAttemptCountSum: 0,
    dayBlockedAttemptCountSquareSum: 0,
    nextDayObservedCount: 0,
    nextDayStartedRunCount: 0,
    nextDayCleanFocusSecondsSum: 0,
    nextDayBlockedAttemptCountSum: 0,
    ...overrides,
  };
}

export function experimentState(
  overrides: Partial<AdaptiveExperimentState>,
): AdaptiveExperimentState {
  return {
    experimentId: "run-focus-duration-40-vs-45-v1",
    status: "active",
    startedAt: "2026-06-01T09:00:00.000Z",
    endedAt: null,
    ...overrides,
  };
}

export function experimentAssignmentHistory(
  overrides: Partial<AdaptiveExperimentAssignmentHistory>,
): AdaptiveExperimentAssignmentHistory {
  return {
    experimentId: "run-focus-duration-40-vs-45-v1",
    variantKey: "control_40",
    contextKey: adaptiveContextKey(CONTEXT),
    assignedAt: "2026-06-09T09:00:00.000Z",
    ...overrides,
  };
}

export function stableExperimentHistory() {
  return {
    segments: Array.from({ length: 10 }, (_, index) => focusSegment({
      runId: `run-${index + 1}`,
      plannedStart: `2026-06-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`,
      plannedEnd: `2026-06-${String(index + 1).padStart(2, "0")}T09:40:00.000Z`,
      actualStart: `2026-06-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`,
      actualEnd: `2026-06-${String(index + 1).padStart(2, "0")}T09:40:00.000Z`,
    })),
    runEvents: [],
    blockEvents: [],
    previousStates: [],
    experimentStates: [],
    experimentOutcomes: [],
  };
}

export function breakDriftExperimentHistory() {
  const focusSegments = Array.from({ length: 8 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return focusSegment({
      runId: `run-focus-${index + 1}`,
      plannedStart: `2026-06-${day}T09:00:00.000Z`,
      plannedEnd: `2026-06-${day}T09:40:00.000Z`,
      actualStart: `2026-06-${day}T09:00:00.000Z`,
      actualEnd: `2026-06-${day}T09:40:00.000Z`,
    });
  });
  const breaks = Array.from({ length: 4 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return breakSegment({
      runId: `run-break-${index + 1}`,
      plannedStart: `2026-06-${day}T09:40:00.000Z`,
      plannedEnd: `2026-06-${day}T09:45:00.000Z`,
      actualStart: `2026-06-${day}T09:40:00.000Z`,
      actualEnd: `2026-06-${day}T09:45:45.000Z`,
    });
  });
  return {
    segments: [...focusSegments, ...breaks],
    runEvents: [],
    blockEvents: [],
    previousStates: [],
    experimentStates: [],
    experimentOutcomes: [],
  };
}

export function longBreakDriftExperimentHistory() {
  const focusSegments = Array.from({ length: 8 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return focusSegment({
      runId: `run-focus-${index + 1}`,
      plannedStart: `2026-06-${day}T09:00:00.000Z`,
      plannedEnd: `2026-06-${day}T09:40:00.000Z`,
      actualStart: `2026-06-${day}T09:00:00.000Z`,
      actualEnd: `2026-06-${day}T09:40:00.000Z`,
    });
  });
  const breaks = Array.from({ length: 4 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return breakSegment({
      runId: `run-long-break-${index + 1}`,
      phase: "long_break",
      plannedStart: `2026-06-${day}T09:40:00.000Z`,
      plannedEnd: `2026-06-${day}T09:50:00.000Z`,
      actualStart: `2026-06-${day}T09:40:00.000Z`,
      actualEnd: `2026-06-${day}T09:51:30.000Z`,
    });
  });
  return {
    segments: [...focusSegments, ...breaks],
    runEvents: [],
    blockEvents: [],
    previousStates: [],
    experimentStates: [],
    experimentOutcomes: [],
  };
}

export function cadenceExperimentHistory() {
  const segments = Array.from({ length: 8 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const rhythmPosition = (index % 4) + 1;
    return focusSegment({
      runId: `run-cadence-${index + 1}`,
      rhythmPosition,
      plannedStart: `2026-06-${day}T09:00:00.000Z`,
      plannedEnd: `2026-06-${day}T09:40:00.000Z`,
      actualStart: `2026-06-${day}T09:00:00.000Z`,
      actualEnd: `2026-06-${day}T09:40:00.000Z`,
      status: index === 6 ? "interrupted" : "completed",
      endReason: index === 6 ? "focus_failed" : "completed",
    });
  });
  return {
    segments,
    runEvents: [],
    blockEvents: [],
    previousStates: [],
    experimentStates: [],
    experimentOutcomes: [],
  };
}

export function cadenceExpansionExperimentHistory() {
  const focusSegments = Array.from({ length: 12 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return focusSegment({
      runId: `run-cadence-expansion-focus-${index + 1}`,
      plannedStart: `2026-06-${day}T09:00:00.000Z`,
      plannedEnd: `2026-06-${day}T09:40:00.000Z`,
      actualStart: `2026-06-${day}T09:00:00.000Z`,
      actualEnd: `2026-06-${day}T09:40:00.000Z`,
    });
  });
  const breaks = Array.from({ length: 12 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return breakSegment({
      runId: `run-cadence-expansion-break-${index + 1}`,
      plannedStart: `2026-06-${day}T09:40:00.000Z`,
      plannedEnd: `2026-06-${day}T09:45:00.000Z`,
      actualStart: `2026-06-${day}T09:40:00.000Z`,
      actualEnd: `2026-06-${day}T09:45:00.000Z`,
    });
  });
  return {
    segments: [...focusSegments, ...breaks],
    runEvents: [],
    blockEvents: [],
    previousStates: [],
    experimentStates: [],
    experimentOutcomes: [],
  };
}
