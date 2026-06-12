import { describe, expect, it } from "vitest";
import {
  CONTEXT,
  baseFeatures,
  breakDriftExperimentFeatures,
  cadenceExpansionExperimentFeatures,
  cadenceExperimentFeatures,
  capacityRhythm,
  experimentAssignmentHistory,
  experimentOutcome,
  experimentState,
  longBreakDriftExperimentFeatures,
  longRecoverySupportExperimentFeatures,
  safeExperimentState,
} from "./adaptive-test-helpers";
import { ADAPTIVE_BASELINE_RHYTHM } from "./constants";
import {
  analyzeRunFocusDurationExperiment,
  analyzeRunFocusWithShortBreakSupportExperiment,
  analyzeRunLongBreakCadenceExperiment,
  analyzeRunLongBreakCadenceExpansionExperiment,
  analyzeRunLongBreakDurationExperiment,
  analyzeRunLongRecoverySupportExperiment,
  analyzeRunShortBreakDurationExperiment,
  experimentCooldownState,
  RUN_FOCUS_DURATION_EXPERIMENT,
  RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT,
  RUN_LONG_BREAK_CADENCE_EXPERIMENT,
  RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT,
  RUN_LONG_BREAK_DURATION_EXPERIMENT,
  RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT,
  RUN_SHORT_BREAK_DURATION_EXPERIMENT,
  selectRunStartExperimentAssignment,
  stableVariantIndex,
} from "./experiments";

describe("adaptive experiments", () => {
  it("keeps the focus experiment inconclusive below the minimum sample threshold", () => {
    const analysis = analyzeRunFocusDurationExperiment([
      experimentOutcome({
        variantKey: "control_40",
        runObservedCount: 7,
        runCompletedCount: 7,
        cleanFocusSecondsSum: 7 * 40 * 60,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        runObservedCount: 7,
        runCompletedCount: 7,
        cleanFocusSecondsSum: 7 * 45 * 60,
      }),
    ]);

    expect(analysis.decision).toBe("insufficient_data");
  });

  it("prefers treatment when clean focus improves and guardrails hold", () => {
    const analysis = analyzeRunFocusDurationExperiment([
      experimentOutcome({
        variantKey: "control_40",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 39 * 60,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 44 * 60,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_treatment");
    expect(analysis.guardrailBreached).toBe(false);
  });

  it("prefers the focus-with-short-break support bundle when clean focus improves safely", () => {
    const analysis = analyzeRunFocusWithShortBreakSupportExperiment([
      experimentOutcome({
        experimentId: RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id,
        variantKey: "control_40_5",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 39 * 60,
        shortBreakOvertimeSecondsSum: 10 * 60,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
      experimentOutcome({
        experimentId: RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id,
        variantKey: "focus_45_short_break_7",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 44 * 60,
        shortBreakOvertimeSecondsSum: 10 * 30,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
    ]);

    expect(analysis.experimentId).toBe(RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id);
    expect(analysis.decision).toBe("prefer_treatment");
    expect(analysis.guardrailBreached).toBe(false);
  });

  it("prefers control when the focus-with-short-break support bundle increases drift", () => {
    const analysis = analyzeRunFocusWithShortBreakSupportExperiment([
      experimentOutcome({
        experimentId: RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id,
        variantKey: "control_40_5",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 39 * 60,
        shortBreakOvertimeSecondsSum: 10 * 30,
      }),
      experimentOutcome({
        experimentId: RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id,
        variantKey: "focus_45_short_break_7",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 44 * 60,
        shortBreakOvertimeSecondsSum: 10 * 150,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_control");
    expect(analysis.guardrailBreached).toBe(true);
  });

  it("uses context-specific experiment evidence once that context has enough runs", () => {
    const contextKey = "morning:first:medium:low:unknown:none";
    const otherContextKey = "evening:late:medium:low:unknown:none";
    const analysis = analyzeRunFocusDurationExperiment([
      experimentOutcome({
        variantKey: "control_40",
        contextKey,
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 39 * 60,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        contextKey,
        runObservedCount: 10,
        runCompletedCount: 6,
        cleanFocusSecondsSum: 10 * 44 * 60,
      }),
      experimentOutcome({
        variantKey: "control_40",
        contextKey: otherContextKey,
        runObservedCount: 30,
        runCompletedCount: 26,
        cleanFocusSecondsSum: 30 * 39 * 60,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        contextKey: otherContextKey,
        runObservedCount: 30,
        runCompletedCount: 27,
        cleanFocusSecondsSum: 30 * 44 * 60,
      }),
    ], contextKey);

    expect(analysis.analysisScope).toBe("context");
    expect(analysis.decision).toBe("prefer_control");
    expect(analysis.guardrailBreached).toBe(true);
  });

  it("borrows sparse context evidence from similar neighboring contexts first", () => {
    const contextKey = "morning:first:medium:low:unknown:none";
    const neighborContextKey = "midday:first:medium:low:unknown:none";
    const distantContextKey = "evening:late:medium:low:unknown:none";
    const analysis = analyzeRunFocusDurationExperiment([
      experimentOutcome({
        variantKey: "control_40",
        contextKey,
        runObservedCount: 4,
        runCompletedCount: 4,
        cleanFocusSecondsSum: 4 * 39 * 60,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        contextKey,
        runObservedCount: 4,
        runCompletedCount: 4,
        cleanFocusSecondsSum: 4 * 44 * 60,
      }),
      experimentOutcome({
        variantKey: "control_40",
        contextKey: neighborContextKey,
        runObservedCount: 40,
        runCompletedCount: 40,
        cleanFocusSecondsSum: 40 * 39 * 60,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        contextKey: neighborContextKey,
        runObservedCount: 40,
        runCompletedCount: 40,
        cleanFocusSecondsSum: 40 * 44 * 60,
      }),
      experimentOutcome({
        variantKey: "control_40",
        contextKey: distantContextKey,
        runObservedCount: 40,
        runCompletedCount: 40,
        cleanFocusSecondsSum: 40 * 44 * 60,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        contextKey: distantContextKey,
        runObservedCount: 40,
        runCompletedCount: 30,
        cleanFocusSecondsSum: 40 * 30 * 60,
      }),
    ], contextKey);

    expect(analysis.analysisScope).toBe("neighbor_pooled");
    expect(analysis.controlObservedRuns).toBe(8);
    expect(analysis.treatmentObservedRuns).toBe(8);
    expect(analysis.decision).toBe("prefer_treatment");
  });

  it("pools sparse context evidence with discounted non-context evidence", () => {
    const contextKey = "morning:first:medium:low:unknown:none";
    const otherContextKey = "evening:late:medium:low:unknown:none";
    const analysis = analyzeRunFocusDurationExperiment([
      experimentOutcome({
        variantKey: "control_40",
        contextKey,
        runObservedCount: 4,
        runCompletedCount: 4,
        cleanFocusSecondsSum: 4 * 39 * 60,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        contextKey,
        runObservedCount: 4,
        runCompletedCount: 4,
        cleanFocusSecondsSum: 4 * 44 * 60,
      }),
      experimentOutcome({
        variantKey: "control_40",
        contextKey: otherContextKey,
        runObservedCount: 40,
        runCompletedCount: 40,
        cleanFocusSecondsSum: 40 * 39 * 60,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        contextKey: otherContextKey,
        runObservedCount: 40,
        runCompletedCount: 40,
        cleanFocusSecondsSum: 40 * 44 * 60,
      }),
    ], contextKey);

    expect(analysis.analysisScope).toBe("pooled");
    expect(analysis.controlObservedRuns).toBe(8);
    expect(analysis.treatmentObservedRuns).toBe(8);
    expect(analysis.decision).toBe("prefer_treatment");
  });

  it("falls back to global evidence when context has no paired treatment evidence", () => {
    const contextKey = "morning:first:medium:low:unknown:none";
    const otherContextKey = "evening:late:medium:low:unknown:none";
    const analysis = analyzeRunFocusDurationExperiment([
      experimentOutcome({
        variantKey: "control_40",
        contextKey,
        runObservedCount: 4,
        runCompletedCount: 4,
        cleanFocusSecondsSum: 4 * 39 * 60,
      }),
      experimentOutcome({
        variantKey: "control_40",
        contextKey: otherContextKey,
        runObservedCount: 20,
        runCompletedCount: 20,
        cleanFocusSecondsSum: 20 * 39 * 60,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        contextKey: otherContextKey,
        runObservedCount: 20,
        runCompletedCount: 20,
        cleanFocusSecondsSum: 20 * 44 * 60,
      }),
    ], contextKey);

    expect(analysis.analysisScope).toBe("global");
    expect(analysis.controlObservedRuns).toBe(24);
    expect(analysis.treatmentObservedRuns).toBe(20);
  });

  it("prefers control when treatment breaches completion guardrails", () => {
    const analysis = analyzeRunFocusDurationExperiment([
      experimentOutcome({
        variantKey: "control_40",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 39 * 60,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        runObservedCount: 10,
        runCompletedCount: 6,
        cleanFocusSecondsSum: 10 * 44 * 60,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_control");
    expect(analysis.guardrailBreached).toBe(true);
  });

  it("prefers control when treatment increases missed planned Pomodoro blocks", () => {
    const analysis = analyzeRunFocusDurationExperiment([
      experimentOutcome({
        variantKey: "control_40",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 39 * 60,
        dayObservedCount: 5,
        dayMissedPlannedPomodoroCountSum: 0,
        dayBlockedAttemptCountSum: 2,
      }),
      experimentOutcome({
        variantKey: "focus_45",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 44 * 60,
        dayObservedCount: 5,
        dayMissedPlannedPomodoroCountSum: 5,
        dayBlockedAttemptCountSum: 2,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_control");
    expect(analysis.guardrailBreached).toBe(true);
  });

  it("prefers longer short breaks when they reduce break drift without guardrail harm", () => {
    const analysis = analyzeRunShortBreakDurationExperiment([
      experimentOutcome({
        experimentId: "run-short-break-duration-5-vs-7-v1",
        variantKey: "control_5",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        shortBreakOvertimeSecondsSum: 10 * 150,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
      experimentOutcome({
        experimentId: "run-short-break-duration-5-vs-7-v1",
        variantKey: "short_break_7",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        shortBreakOvertimeSecondsSum: 10 * 60,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_treatment");
    expect(analysis.guardrailBreached).toBe(false);
    expect(analysis.controlShortBreakOvertimeSecondsMean).toBe(150);
    expect(analysis.treatmentShortBreakOvertimeSecondsMean).toBe(60);
  });

  it("keeps short-break treatment inconclusive when drift improvement is too noisy", () => {
    const analysis = analyzeRunShortBreakDurationExperiment([
      experimentOutcome({
        experimentId: "run-short-break-duration-5-vs-7-v1",
        variantKey: "control_5",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        shortBreakOvertimeSecondsSum: 10 * 150,
        shortBreakOvertimeSecondsSquareSum: 10 * 150 * 150,
      }),
      experimentOutcome({
        experimentId: "run-short-break-duration-5-vs-7-v1",
        variantKey: "short_break_7",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        shortBreakOvertimeSecondsSum: 600,
        shortBreakOvertimeSecondsSquareSum: 600 * 600,
      }),
    ]);

    expect(analysis.treatmentShortBreakOvertimeSecondsMean).toBe(60);
    expect(analysis.decision).toBe("continue");
    expect(analysis.guardrailBreached).toBe(false);
  });

  it("prefers control when longer short breaks increase break drift", () => {
    const analysis = analyzeRunShortBreakDurationExperiment([
      experimentOutcome({
        experimentId: "run-short-break-duration-5-vs-7-v1",
        variantKey: "control_5",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        shortBreakOvertimeSecondsSum: 10 * 60,
      }),
      experimentOutcome({
        experimentId: "run-short-break-duration-5-vs-7-v1",
        variantKey: "short_break_7",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        shortBreakOvertimeSecondsSum: 10 * 150,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_control");
    expect(analysis.guardrailBreached).toBe(true);
  });

  it("prefers longer long breaks when they reduce long-break drift without guardrail harm", () => {
    const analysis = analyzeRunLongBreakDurationExperiment([
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_DURATION_EXPERIMENT.id,
        variantKey: "control_10",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        longBreakOvertimeSecondsSum: 10 * 420,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_DURATION_EXPERIMENT.id,
        variantKey: "long_break_15",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        longBreakOvertimeSecondsSum: 10 * 240,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_treatment");
    expect(analysis.guardrailBreached).toBe(false);
    expect(analysis.controlLongBreakOvertimeSecondsMean).toBe(420);
    expect(analysis.treatmentLongBreakOvertimeSecondsMean).toBe(240);
  });

  it("prefers control when longer long breaks increase drift or skipping", () => {
    const analysis = analyzeRunLongBreakDurationExperiment([
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_DURATION_EXPERIMENT.id,
        variantKey: "control_10",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        breakSkippedCountSum: 0,
        longBreakOvertimeSecondsSum: 10 * 120,
      }),
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_DURATION_EXPERIMENT.id,
        variantKey: "long_break_15",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        breakSkippedCountSum: 10,
        longBreakOvertimeSecondsSum: 10 * 300,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_control");
    expect(analysis.guardrailBreached).toBe(true);
  });

  it("prefers earlier long recovery when it reduces pressure without guardrail harm", () => {
    const analysis = analyzeRunLongRecoverySupportExperiment([
      experimentOutcome({
        experimentId: RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT.id,
        variantKey: "long_break_15_cadence_4",
        runObservedCount: 10,
        runCompletedCount: 8,
        cleanFocusSecondsSum: 10 * 40 * 60,
        blockedAttemptCountSum: 10 * 4,
        longBreakOvertimeSecondsSum: 10 * 300,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
      experimentOutcome({
        experimentId: RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT.id,
        variantKey: "long_break_15_cadence_3",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 39 * 60,
        blockedAttemptCountSum: 10 * 2,
        longBreakOvertimeSecondsSum: 10 * 180,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_treatment");
    expect(analysis.guardrailBreached).toBe(false);
    expect(analysis.controlLongBreakOvertimeSecondsMean).toBe(300);
    expect(analysis.treatmentLongBreakOvertimeSecondsMean).toBe(180);
  });

  it("prefers control when earlier long recovery increases missed recovery costs", () => {
    const analysis = analyzeRunLongRecoverySupportExperiment([
      experimentOutcome({
        experimentId: RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT.id,
        variantKey: "long_break_15_cadence_4",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        blockedAttemptCountSum: 10,
        longBreakOvertimeSecondsSum: 10 * 120,
      }),
      experimentOutcome({
        experimentId: RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT.id,
        variantKey: "long_break_15_cadence_3",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 34 * 60,
        blockedAttemptCountSum: 10 * 4,
        breakSkippedCountSum: 10,
        longBreakOvertimeSecondsSum: 10 * 300,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_control");
    expect(analysis.guardrailBreached).toBe(true);
  });

  it("prefers earlier long-break cadence when it reduces blocker pressure without guardrail harm", () => {
    const analysis = analyzeRunLongBreakCadenceExperiment([
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_CADENCE_EXPERIMENT.id,
        variantKey: "control_4",
        runObservedCount: 10,
        runCompletedCount: 8,
        cleanFocusSecondsSum: 10 * 38 * 60,
        blockedAttemptCountSum: 10 * 4,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_CADENCE_EXPERIMENT.id,
        variantKey: "cadence_3",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 38 * 60,
        blockedAttemptCountSum: 10 * 2,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_treatment");
    expect(analysis.guardrailBreached).toBe(false);
    expect(analysis.controlBlockedAttemptsMean).toBe(4);
    expect(analysis.treatmentBlockedAttemptsMean).toBe(2);
  });

  it("prefers control when earlier long-break cadence reduces clean focus", () => {
    const analysis = analyzeRunLongBreakCadenceExperiment([
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_CADENCE_EXPERIMENT.id,
        variantKey: "control_4",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        blockedAttemptCountSum: 10 * 2,
      }),
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_CADENCE_EXPERIMENT.id,
        variantKey: "cadence_3",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 34 * 60,
        blockedAttemptCountSum: 10,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_control");
    expect(analysis.guardrailBreached).toBe(true);
  });

  it("prefers later long-break cadence when clean focus improves without guardrail harm", () => {
    const analysis = analyzeRunLongBreakCadenceExpansionExperiment([
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.id,
        variantKey: "control_4",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        blockedAttemptCountSum: 0,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.id,
        variantKey: "cadence_5",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 45 * 60,
        blockedAttemptCountSum: 0,
        nextDayObservedCount: 5,
        nextDayStartedRunCount: 5,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_treatment");
    expect(analysis.guardrailBreached).toBe(false);
    expect(analysis.controlCleanFocusSecondsMean).toBe(40 * 60);
    expect(analysis.treatmentCleanFocusSecondsMean).toBe(45 * 60);
  });

  it("prefers control when later long-break cadence increases blocker pressure", () => {
    const analysis = analyzeRunLongBreakCadenceExpansionExperiment([
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.id,
        variantKey: "control_4",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 40 * 60,
        blockedAttemptCountSum: 0,
      }),
      experimentOutcome({
        experimentId: RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.id,
        variantKey: "cadence_5",
        runObservedCount: 10,
        runCompletedCount: 9,
        cleanFocusSecondsSum: 10 * 45 * 60,
        blockedAttemptCountSum: 10 * 3,
      }),
    ]);

    expect(analysis.decision).toBe("prefer_control");
    expect(analysis.guardrailBreached).toBe(true);
  });

  it("assigns a stable run-level focus variant only in low-risk contexts", () => {
    const features = baseFeatures({
      completedFocusSegments: 10,
      cleanFocusSeconds: 10 * 40 * 60,
      plannedFocusSeconds: 10 * 40 * 60,
      breakStartedCount: 10,
      breakCompletedCount: 10,
      comparableOpportunityCount: 16,
    });
    const state = safeExperimentState();
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: capacityRhythm(),
      context: CONTEXT,
      features,
      state,
    });
    const repeated = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: capacityRhythm(),
      context: CONTEXT,
      features,
      state,
    });

    expect(assignment).not.toBeNull();
    expect(repeated?.variant.variantKey).toBe(assignment?.variant.variantKey);
    expect(repeated?.assignmentSeed).toBe(assignment?.assignmentSeed);
    expect(assignment?.variant.variantKey).toBe(
      assignment?.experiment.variants[
        stableVariantIndex(assignment.assignmentSeed, assignment.experiment.variants.length)
      ].variantKey,
    );
    expect(assignment?.selectedRhythm.focusDurationMinutes).toBe(assignment?.variant.numericValue);
  });

  it("assigns a stable focus-with-short-break support bundle only with high clean evidence", () => {
    const features = baseFeatures({
      completedFocusSegments: 10,
      cleanFocusSeconds: 10 * 40 * 60,
      plannedFocusSeconds: 10 * 40 * 60,
      breakStartedCount: 8,
      breakCompletedCount: 8,
      comparableOpportunityCount: 24,
    });
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: capacityRhythm(),
      context: CONTEXT,
      features,
      state: safeExperimentState(),
    });
    const lowerEvidenceAssignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: capacityRhythm(),
      context: CONTEXT,
      features: {
        ...features,
        comparableOpportunityCount: 16,
      },
      state: safeExperimentState(),
    });

    expect(assignment?.experiment.id).toBe(RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id);
    expect(assignment?.experiment.parameterKey).toBe("rhythm_bundle");
    expect([
      "control_40_5",
      "focus_45_short_break_7",
    ]).toContain(assignment?.variant.variantKey);
    if (assignment?.variant.variantKey === "focus_45_short_break_7") {
      expect(assignment.selectedRhythm).toEqual({
        ...ADAPTIVE_BASELINE_RHYTHM,
        focusDurationMinutes: 45,
        shortBreakMinutes: 7,
      });
    }
    expect(lowerEvidenceAssignment?.experiment.id).toBe(RUN_FOCUS_DURATION_EXPERIMENT.id);
  });

  it("does not assign a focus-with-short-break bundle when a scalar component is harmful", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: capacityRhythm(),
      context: CONTEXT,
      features: baseFeatures({
        completedFocusSegments: 10,
        cleanFocusSeconds: 10 * 40 * 60,
        plannedFocusSeconds: 10 * 40 * 60,
        breakStartedCount: 8,
        breakCompletedCount: 8,
        comparableOpportunityCount: 24,
      }),
      state: safeExperimentState(),
      experimentOutcomes: [
        experimentOutcome({
          experimentId: RUN_SHORT_BREAK_DURATION_EXPERIMENT.id,
          variantKey: "control_5",
          runObservedCount: 10,
          runCompletedCount: 9,
          cleanFocusSecondsSum: 10 * 40 * 60,
          shortBreakOvertimeSecondsSum: 10 * 60,
        }),
        experimentOutcome({
          experimentId: RUN_SHORT_BREAK_DURATION_EXPERIMENT.id,
          variantKey: "short_break_7",
          runObservedCount: 10,
          runCompletedCount: 9,
          cleanFocusSecondsSum: 10 * 40 * 60,
          shortBreakOvertimeSecondsSum: 10 * 150,
        }),
      ],
    });

    expect(assignment?.experiment.id).toBe(RUN_FOCUS_DURATION_EXPERIMENT.id);
  });

  it("assigns a stable run-level short-break variant only for low-risk break drift", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        shortBreakMinutes: 7,
      },
      context: CONTEXT,
      features: breakDriftExperimentFeatures(),
      state: safeExperimentState(),
    });
    const repeated = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        shortBreakMinutes: 7,
      },
      context: CONTEXT,
      features: breakDriftExperimentFeatures(),
      state: safeExperimentState(),
    });

    expect(assignment).not.toBeNull();
    expect(assignment?.experiment.id).toBe("run-short-break-duration-5-vs-7-v1");
    expect(repeated?.variant.variantKey).toBe(assignment?.variant.variantKey);
    expect(assignment?.selectedRhythm.shortBreakMinutes).toBe(assignment?.variant.numericValue);
  });

  it("assigns a stable run-level long-break variant only for low-risk long-break drift", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        longBreakMinutes: 15,
      },
      context: CONTEXT,
      features: longBreakDriftExperimentFeatures(),
      state: safeExperimentState(),
    });
    const repeated = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        longBreakMinutes: 15,
      },
      context: CONTEXT,
      features: longBreakDriftExperimentFeatures(),
      state: safeExperimentState(),
    });

    expect(assignment).not.toBeNull();
    expect(assignment?.experiment.id).toBe(RUN_LONG_BREAK_DURATION_EXPERIMENT.id);
    expect(repeated?.variant.variantKey).toBe(assignment?.variant.variantKey);
    expect(assignment?.selectedRhythm.longBreakMinutes).toBe(assignment?.variant.numericValue);
  });

  it("assigns a stable long-recovery support bundle only with enough clean evidence", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        longBreakMinutes: 15,
      },
      context: CONTEXT,
      features: longRecoverySupportExperimentFeatures(),
      state: safeExperimentState(),
    });
    const lowerEvidenceAssignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        longBreakMinutes: 15,
      },
      context: CONTEXT,
      features: longBreakDriftExperimentFeatures(),
      state: safeExperimentState(),
    });

    expect(assignment?.experiment.id).toBe(RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT.id);
    expect(assignment?.experiment.parameterKey).toBe("rhythm_bundle");
    expect([
      "long_break_15_cadence_4",
      "long_break_15_cadence_3",
    ]).toContain(assignment?.variant.variantKey);
    if (assignment?.variant.variantKey === "long_break_15_cadence_3") {
      expect(assignment.selectedRhythm).toEqual({
        ...ADAPTIVE_BASELINE_RHYTHM,
        longBreakMinutes: 15,
        longBreakAfterFocusCount: 3,
      });
    }
    expect(lowerEvidenceAssignment?.experiment.id).toBe(RUN_LONG_BREAK_DURATION_EXPERIMENT.id);
  });

  it("does not assign a long-recovery bundle when a scalar cadence component is harmful", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        longBreakMinutes: 15,
      },
      context: CONTEXT,
      features: longRecoverySupportExperimentFeatures(),
      state: safeExperimentState(),
      experimentOutcomes: [
        experimentOutcome({
          experimentId: RUN_LONG_BREAK_CADENCE_EXPERIMENT.id,
          variantKey: "control_4",
          runObservedCount: 10,
          runCompletedCount: 9,
          cleanFocusSecondsSum: 10 * 40 * 60,
          blockedAttemptCountSum: 10 * 2,
        }),
        experimentOutcome({
          experimentId: RUN_LONG_BREAK_CADENCE_EXPERIMENT.id,
          variantKey: "cadence_3",
          runObservedCount: 10,
          runCompletedCount: 9,
          cleanFocusSecondsSum: 10 * 34 * 60,
          blockedAttemptCountSum: 10,
        }),
      ],
    });

    expect(assignment?.experiment.id).toBe(RUN_LONG_BREAK_DURATION_EXPERIMENT.id);
  });

  it("assigns a stable run-level cadence variant only for low-risk late-cycle pressure", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        longBreakAfterFocusCount: 3,
      },
      context: CONTEXT,
      features: cadenceExperimentFeatures(),
      state: safeExperimentState(),
    });
    const repeated = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        longBreakAfterFocusCount: 3,
      },
      context: CONTEXT,
      features: cadenceExperimentFeatures(),
      state: safeExperimentState(),
    });

    expect(assignment).not.toBeNull();
    expect(assignment?.experiment.id).toBe(RUN_LONG_BREAK_CADENCE_EXPERIMENT.id);
    expect(repeated?.variant.variantKey).toBe(assignment?.variant.variantKey);
    expect(assignment?.selectedRhythm.longBreakAfterFocusCount)
      .toBe(assignment?.variant.numericValue);
  });

  it("assigns a stable run-level cadence expansion variant only for very clean momentum", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        longBreakAfterFocusCount: 5,
      },
      context: CONTEXT,
      features: cadenceExpansionExperimentFeatures(),
      state: safeExperimentState(),
    });
    const repeated = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        longBreakAfterFocusCount: 5,
      },
      context: CONTEXT,
      features: cadenceExpansionExperimentFeatures(),
      state: safeExperimentState(),
    });

    expect(assignment).not.toBeNull();
    expect(assignment?.experiment.id).toBe(RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.id);
    expect(repeated?.variant.variantKey).toBe(assignment?.variant.variantKey);
    expect(assignment?.selectedRhythm.longBreakAfterFocusCount)
      .toBe(assignment?.variant.numericValue);
  });

  it("does not assign experiments when recovery risk is high", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: capacityRhythm(),
      context: CONTEXT,
      features: baseFeatures({
        completedFocusSegments: 10,
        cleanFocusSeconds: 10 * 40 * 60,
        plannedFocusSeconds: 10 * 40 * 60,
        comparableOpportunityCount: 16,
      }),
      state: {
        ...safeExperimentState(),
        recoveryDebt: 0.5,
      },
    });

    expect(assignment).toBeNull();
  });

  it("does not assign experiments during terminal cooldown", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: capacityRhythm(),
      context: CONTEXT,
      features: baseFeatures({
        completedFocusSegments: 10,
        cleanFocusSeconds: 10 * 40 * 60,
        plannedFocusSeconds: 10 * 40 * 60,
        comparableOpportunityCount: 16,
      }),
      state: safeExperimentState(),
      experimentStates: [
        experimentState({
          status: "completed",
          endedAt: "2026-06-09T09:00:00.000Z",
        }),
      ],
    });

    expect(assignment).toBeNull();
    expect(experimentCooldownState(
      [
        experimentState({
          status: "completed",
          endedAt: "2026-06-09T09:00:00.000Z",
        }),
      ],
      "run-focus-duration-40-vs-45-v1",
      "2026-06-10T09:00:00.000Z",
    )?.status).toBe("completed");
  });

  it("allows experiments after terminal cooldown expires", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-25T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: capacityRhythm(),
      context: CONTEXT,
      features: baseFeatures({
        completedFocusSegments: 10,
        cleanFocusSeconds: 10 * 40 * 60,
        plannedFocusSeconds: 10 * 40 * 60,
        comparableOpportunityCount: 16,
      }),
      state: safeExperimentState(),
      experimentStates: [
        experimentState({
          status: "completed",
          endedAt: "2026-06-09T09:00:00.000Z",
        }),
      ],
    });

    expect(assignment).not.toBeNull();
  });

  it("stops experiment assignment when the context exploration budget is spent", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: capacityRhythm(),
      context: CONTEXT,
      features: baseFeatures({
        completedFocusSegments: 10,
        cleanFocusSeconds: 10 * 40 * 60,
        plannedFocusSeconds: 10 * 40 * 60,
        comparableOpportunityCount: 16,
      }),
      state: safeExperimentState(),
      experimentAssignments: [
        experimentAssignmentHistory({
          assignedAt: "2026-06-08T09:00:00.000Z",
        }),
        experimentAssignmentHistory({
          assignedAt: "2026-06-09T09:00:00.000Z",
        }),
      ],
    });

    expect(assignment).toBeNull();
  });

  it("does not start a different experiment lane in a recently assigned context", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        shortBreakMinutes: 7,
      },
      context: CONTEXT,
      features: breakDriftExperimentFeatures(),
      state: safeExperimentState(),
      experimentAssignments: [
        experimentAssignmentHistory({
          experimentId: "run-focus-duration-40-vs-45-v1",
          assignedAt: "2026-06-09T09:00:00.000Z",
        }),
      ],
    });

    expect(assignment).toBeNull();
  });

  it("keeps collecting evidence for the same experiment lane", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: {
        ...ADAPTIVE_BASELINE_RHYTHM,
        shortBreakMinutes: 7,
      },
      context: CONTEXT,
      features: breakDriftExperimentFeatures(),
      state: safeExperimentState(),
      experimentAssignments: [
        experimentAssignmentHistory({
          experimentId: RUN_SHORT_BREAK_DURATION_EXPERIMENT.id,
          variantKey: "short_break_7",
          assignedAt: "2026-06-09T09:00:00.000Z",
        }),
      ],
    });

    expect(assignment?.experiment.id).toBe(RUN_SHORT_BREAK_DURATION_EXPERIMENT.id);
  });

  it("does not keep assigning when experiment evidence prefers treatment", () => {
    const assignment = selectRunStartExperimentAssignment({
      occurredAt: "2026-06-10T09:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      selectedRhythm: capacityRhythm(),
      context: CONTEXT,
      features: baseFeatures({
        completedFocusSegments: 10,
        cleanFocusSeconds: 10 * 40 * 60,
        plannedFocusSeconds: 10 * 40 * 60,
        comparableOpportunityCount: 16,
      }),
      state: safeExperimentState(),
      experimentOutcomes: [
        experimentOutcome({
          variantKey: "control_40",
          runObservedCount: 10,
          runCompletedCount: 9,
          cleanFocusSecondsSum: 10 * 39 * 60,
        }),
        experimentOutcome({
          variantKey: "focus_45",
          runObservedCount: 10,
          runCompletedCount: 9,
          cleanFocusSecondsSum: 10 * 44 * 60,
        }),
      ],
    });

    expect(assignment).toBeNull();
  });
});
