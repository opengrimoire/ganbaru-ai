import { describe, expect, it } from "vitest";
import {
  CONTEXT,
  blockedBurstEvents,
  breakDriftExperimentHistory,
  cadenceExpansionExperimentHistory,
  cadenceExperimentHistory,
  configFromSelectedRhythm,
  experimentOutcome,
  experimentState,
  focusSegment,
  longBreakDriftExperimentHistory,
  stableExperimentHistory,
} from "./adaptive-test-helpers";
import { ADAPTIVE_BASELINE_RHYTHM } from "./constants";
import {
  RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT,
  RUN_LONG_BREAK_CADENCE_EXPERIMENT,
  RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT,
  RUN_LONG_BREAK_DURATION_EXPERIMENT,
  RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT,
} from "./experiments";
import {
  adaptiveContextKey,
  buildRunStartAdaptiveSnapshot,
  decideBoundaryAdaptiveRhythm,
  decideRunStartAdaptiveRhythm,
  previousAdaptiveStateForContext,
  snapshotFromBoundaryAdaptiveDecision,
  snapshotFromRunStartAdaptiveDecision,
} from "./persistence";
import { computePlannedSegments } from "$lib/utils/pomodoro-segments";

describe("adaptive persistence payloads", () => {
  it("builds a run-start snapshot for the Adaptive baseline", () => {
    const snapshot = buildRunStartAdaptiveSnapshot({
      runId: "run-1",
      segmentId: "segment-1",
      startedAt: "2026-06-10T09:00:00.000Z",
      plannedStart: "2026-06-10T09:00:00.000Z",
      plannedEnd: "2026-06-10T10:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: false,
    });

    expect(snapshot.policyId).toBe("local-adaptive-policy-v1");
    expect(snapshot.contextSnapshot.runId).toBe("run-1");
    expect(snapshot.contextSnapshot.segmentId).toBe("segment-1");
    expect(snapshot.contextSnapshot.eventLength).toBe("medium");
    expect(snapshot.contextSnapshot.dataQualityFlags).toEqual([
      "diary_missing",
      "idle_detection_disabled",
      "extension_unavailable",
    ]);
    expect(snapshot.contextSnapshot.features).toContainEqual({
      featureKey: "comparable_opportunity_count",
      numericValue: 0,
      categoricalValue: null,
      booleanValue: null,
      missing: false,
      sourceKind: "pomodoro",
    });
    expect(snapshot.decision.opportunityKind).toBe("run_start");
    expect(snapshot.decision.decisionMode).toBe("fallback");
    expect(snapshot.decision.reasonCodes).toContain("no_history");
    expect(snapshot.experimentUpdates).toEqual([]);
    expect(snapshot.experimentAssignments).toEqual([]);
    expect(snapshot.plannedBlocks).toEqual([]);
    expect(snapshot.decision.values).toEqual([
      {
        valueKey: "focus_duration_minutes",
        previousNumericValue: 40,
        selectedNumericValue: 40,
        valueUnit: "minutes",
      },
      {
        valueKey: "short_break_minutes",
        previousNumericValue: 5,
        selectedNumericValue: 5,
        valueUnit: "minutes",
      },
      {
        valueKey: "long_break_minutes",
        previousNumericValue: 10,
        selectedNumericValue: 10,
        valueUnit: "minutes",
      },
      {
        valueKey: "long_break_after_focus_count",
        previousNumericValue: 4,
        selectedNumericValue: 4,
        valueUnit: "count",
      },
    ]);
  });

  it("serializes deterministic experiment assignments in run-start snapshots", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T09:00:00.000Z",
      plannedStart: "2026-06-10T09:00:00.000Z",
      plannedEnd: "2026-06-10T10:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: stableExperimentHistory(),
    });
    const snapshot = snapshotFromRunStartAdaptiveDecision(decision, {
      runId: "run-1",
      segmentId: "segment-1",
    });

    expect(decision.decisionMode).toBe("explore");
    expect(decision.reasonCodes).toContain("experiment_assignment");
    expect(decision.experimentAssignment).not.toBeNull();
    expect(snapshot.experimentUpdates).toEqual([]);
    expect(snapshot.experimentAssignments).toHaveLength(1);
    expect(snapshot.experimentAssignments[0].experiment.id).toBe("run-focus-duration-40-vs-45-v1");
    expect(snapshot.experimentAssignments[0].assignment.runId).toBe("run-1");
    expect(snapshot.experimentAssignments[0].assignment.segmentId).toBe("segment-1");
    expect(snapshot.experimentAssignments[0].assignment.contextSnapshotId)
      .toBe(snapshot.contextSnapshot.id);
    expect(snapshot.decision.values).toContainEqual({
      valueKey: "focus_duration_minutes",
      previousNumericValue: 40,
      selectedNumericValue: decision.selectedRhythm.focusDurationMinutes,
      valueUnit: "minutes",
    });
  });

  it("applies completed focus-with-short-break support treatment on safe capacity growth", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T09:00:00.000Z",
      plannedStart: "2026-06-10T09:00:00.000Z",
      plannedEnd: "2026-06-10T10:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: {
        ...stableExperimentHistory(),
        experimentOutcomes: [
          experimentOutcome({
            experimentId: RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id,
            variantKey: "control_40_5",
            runObservedCount: 10,
            runCompletedCount: 9,
            cleanFocusSecondsSum: 10 * 39 * 60,
            nextDayObservedCount: 5,
            nextDayStartedRunCount: 5,
          }),
          experimentOutcome({
            experimentId: RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id,
            variantKey: "focus_45_short_break_7",
            runObservedCount: 10,
            runCompletedCount: 9,
            cleanFocusSecondsSum: 10 * 44 * 60,
            nextDayObservedCount: 5,
            nextDayStartedRunCount: 5,
          }),
        ],
      },
    });

    expect(decision.selectedRhythm).toEqual({
      ...ADAPTIVE_BASELINE_RHYTHM,
      focusDurationMinutes: 45,
      shortBreakMinutes: 7,
    });
    expect(decision.experimentUpdate?.id).toBe(RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id);
    expect(decision.experimentUpdate?.status).toBe("completed");
    expect(decision.experimentAssignment).toBeNull();
  });

  it("applies completed long-recovery support treatment on clean long-break drift", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T09:00:00.000Z",
      plannedStart: "2026-06-10T09:00:00.000Z",
      plannedEnd: "2026-06-10T10:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: {
        ...longBreakDriftExperimentHistory(),
        experimentOutcomes: [
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
        ],
      },
    });

    expect(decision.selectedRhythm).toEqual({
      ...ADAPTIVE_BASELINE_RHYTHM,
      longBreakMinutes: 15,
      longBreakAfterFocusCount: 3,
    });
    expect(decision.experimentUpdate?.id).toBe(RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT.id);
    expect(decision.experimentUpdate?.status).toBe("completed");
    expect(decision.experimentAssignment).toBeNull();
  });

  it("serializes planned blocks into run-start snapshots", () => {
    const plannedBlocks = [
      {
        eventDate: "2026-06-10",
        eventId: "event-1::2026-06-10",
        originalEventId: "event-1",
        plannedStart: "2026-06-10T14:00:00.000Z",
        plannedEnd: "2026-06-10T15:00:00.000Z",
        sourceKind: "scheduler_snapshot" as const,
      },
    ];
    const snapshot = buildRunStartAdaptiveSnapshot({
      runId: "run-1",
      segmentId: "segment-1",
      startedAt: "2026-06-10T14:00:00.000Z",
      plannedStart: "2026-06-10T14:00:00.000Z",
      plannedEnd: "2026-06-10T15:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      plannedBlocks,
    });

    expect(snapshot.plannedBlocks).toEqual(plannedBlocks);
  });

  it("uses experiment guardrails to hold control after harmful treatment evidence", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T09:00:00.000Z",
      plannedStart: "2026-06-10T09:00:00.000Z",
      plannedEnd: "2026-06-10T10:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: {
        ...stableExperimentHistory(),
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
            runCompletedCount: 6,
            cleanFocusSecondsSum: 10 * 44 * 60,
          }),
        ],
      },
    });

    expect(decision.decisionMode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("experiment_guardrail");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(40);
    expect(decision.experimentUpdate?.status).toBe("abandoned");
    expect(decision.experimentAssignment).toBeNull();
    const snapshot = snapshotFromRunStartAdaptiveDecision(decision, {
      runId: "run-1",
      segmentId: "segment-1",
    });
    expect(snapshot.experimentUpdates).toHaveLength(1);
    expect(snapshot.experimentUpdates[0].status).toBe("abandoned");
  });

  it("holds control during abandoned experiment cooldown", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T09:00:00.000Z",
      plannedStart: "2026-06-10T09:00:00.000Z",
      plannedEnd: "2026-06-10T10:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: {
        ...stableExperimentHistory(),
        experimentStates: [
          experimentState({
            status: "abandoned",
            endedAt: "2026-06-09T09:00:00.000Z",
          }),
        ],
      },
    });

    expect(decision.decisionMode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("experiment_guardrail");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(40);
    expect(decision.experimentUpdate).toBeNull();
    expect(decision.experimentAssignment).toBeNull();
  });

  it("serializes completed experiment status after treatment evidence wins", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T09:00:00.000Z",
      plannedStart: "2026-06-10T09:00:00.000Z",
      plannedEnd: "2026-06-10T10:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: {
        ...stableExperimentHistory(),
        experimentOutcomes: [
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
        ],
      },
    });
    const snapshot = snapshotFromRunStartAdaptiveDecision(decision, {
      runId: "run-1",
      segmentId: "segment-1",
    });

    expect(decision.experimentAssignment).toBeNull();
    expect(decision.experimentUpdate?.status).toBe("completed");
    expect(snapshot.experimentUpdates).toHaveLength(1);
    expect(snapshot.experimentUpdates[0].status).toBe("completed");
  });

  it("uses short-break experiment guardrails to hold control after harmful longer-break evidence", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T09:00:00.000Z",
      plannedStart: "2026-06-10T09:00:00.000Z",
      plannedEnd: "2026-06-10T10:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: {
        ...breakDriftExperimentHistory(),
        experimentOutcomes: [
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
        ],
      },
    });

    expect(decision.decisionMode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("experiment_guardrail");
    expect(decision.selectedRhythm.shortBreakMinutes).toBe(5);
    expect(decision.experimentUpdate?.id).toBe("run-short-break-duration-5-vs-7-v1");
    expect(decision.experimentUpdate?.status).toBe("abandoned");
    expect(decision.experimentAssignment).toBeNull();
  });

  it("uses long-break experiment guardrails to hold control after harmful longer-break evidence", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T09:00:00.000Z",
      plannedStart: "2026-06-10T09:00:00.000Z",
      plannedEnd: "2026-06-10T10:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: {
        ...longBreakDriftExperimentHistory(),
        experimentOutcomes: [
          experimentOutcome({
            experimentId: RUN_LONG_BREAK_DURATION_EXPERIMENT.id,
            variantKey: "control_10",
            runObservedCount: 10,
            runCompletedCount: 9,
            cleanFocusSecondsSum: 10 * 40 * 60,
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
        ],
      },
    });

    expect(decision.decisionMode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("experiment_guardrail");
    expect(decision.selectedRhythm.longBreakMinutes).toBe(10);
    expect(decision.experimentUpdate?.id).toBe(RUN_LONG_BREAK_DURATION_EXPERIMENT.id);
    expect(decision.experimentUpdate?.status).toBe("abandoned");
    expect(decision.experimentAssignment).toBeNull();
  });

  it("uses cadence experiment guardrails to hold control after harmful earlier-cadence evidence", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T09:00:00.000Z",
      plannedStart: "2026-06-10T09:00:00.000Z",
      plannedEnd: "2026-06-10T10:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: {
        ...cadenceExperimentHistory(),
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
      },
    });

    expect(decision.decisionMode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("experiment_guardrail");
    expect(decision.selectedRhythm.longBreakAfterFocusCount).toBe(4);
    expect(decision.experimentUpdate?.id).toBe(RUN_LONG_BREAK_CADENCE_EXPERIMENT.id);
    expect(decision.experimentUpdate?.status).toBe("abandoned");
    expect(decision.experimentAssignment).toBeNull();
  });

  it("uses cadence expansion guardrails to hold control after harmful later-cadence evidence", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T09:00:00.000Z",
      plannedStart: "2026-06-10T09:00:00.000Z",
      plannedEnd: "2026-06-10T10:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: {
        ...cadenceExpansionExperimentHistory(),
        experimentOutcomes: [
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
        ],
      },
    });

    expect(decision.decisionMode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("experiment_guardrail");
    expect(decision.selectedRhythm.longBreakAfterFocusCount).toBe(4);
    expect(decision.experimentUpdate?.id).toBe(RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.id);
    expect(decision.experimentUpdate?.status).toBe("abandoned");
    expect(decision.experimentAssignment).toBeNull();
  });

  it("selects a recovery rhythm from run-start history", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T11:00:00.000Z",
      plannedStart: "2026-06-10T11:00:00.000Z",
      plannedEnd: "2026-06-10T12:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: {
        segments: [
          focusSegment({
            runId: "run-1",
            actualEnd: "2026-06-10T09:15:00.000Z",
            status: "interrupted",
            endReason: "focus_failed",
            pauseLog: [
              {
                startedAt: "2026-06-10T09:10:00.000Z",
                endedAt: "2026-06-10T09:15:00.000Z",
                reason: "idle",
              },
            ],
          }),
          focusSegment({
            runId: "run-2",
            plannedStart: "2026-06-10T10:00:00.000Z",
            plannedEnd: "2026-06-10T10:40:00.000Z",
            actualStart: "2026-06-10T10:00:00.000Z",
            actualEnd: "2026-06-10T10:20:00.000Z",
            status: "interrupted",
            endReason: "focus_failed",
          }),
          focusSegment({
            runId: "run-3",
            plannedStart: "2026-06-10T10:30:00.000Z",
            plannedEnd: "2026-06-10T11:10:00.000Z",
            actualStart: "2026-06-10T10:30:00.000Z",
            actualEnd: "2026-06-10T10:50:00.000Z",
            status: "interrupted",
            endReason: "focus_failed",
          }),
        ],
        runEvents: [
          {
            eventType: "focus_failed",
            occurredAt: "2026-06-10T09:15:00.000Z",
            phase: "focus",
            reason: "long_idle",
            durationSeconds: 300,
          },
        ],
        blockEvents: blockedBurstEvents(),
        previousStates: [
          {
            contextKey: "morning:first:medium:low:unknown:none",
            readiness: 0.9,
            strain: 0.1,
            recoveryDebt: 0.1,
            avoidancePressure: 0.1,
            momentum: 0.9,
            confidence: 0.9,
          },
          {
            contextKey: "midday:late:medium:low:unknown:none",
            readiness: 0.1,
            strain: 0.8,
            recoveryDebt: 0.7,
            avoidancePressure: 0.6,
            momentum: 0.1,
            confidence: 0.8,
          },
        ],
        experimentStates: [],
        experimentOutcomes: [],
      },
    });

    expect(decision.decisionMode).toBe("recovery");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(35);
    expect(decision.selectedRhythm.longBreakMinutes).toBe(15);
    expect(decision.selectedRhythm.longBreakAfterFocusCount).toBe(3);
    expect(decision.reasonCodes).toContain("high_strain");
    expect(decision.context.sessionPosition).toBe("late");
  });

  it("plans fresh-session segments from the selected adaptive rhythm", () => {
    const decision = decideRunStartAdaptiveRhythm({
      startedAt: "2026-06-10T11:00:00.000Z",
      plannedStart: "2026-06-10T11:00:00.000Z",
      plannedEnd: "2026-06-10T13:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: {
        segments: [
          focusSegment({
            runId: "run-1",
            actualEnd: "2026-06-10T09:15:00.000Z",
            status: "interrupted",
            endReason: "focus_failed",
          }),
          focusSegment({
            runId: "run-2",
            plannedStart: "2026-06-10T10:00:00.000Z",
            plannedEnd: "2026-06-10T10:40:00.000Z",
            actualStart: "2026-06-10T10:00:00.000Z",
            actualEnd: "2026-06-10T10:20:00.000Z",
            status: "interrupted",
            endReason: "focus_failed",
          }),
          focusSegment({
            runId: "run-3",
            plannedStart: "2026-06-10T10:30:00.000Z",
            plannedEnd: "2026-06-10T11:10:00.000Z",
            actualStart: "2026-06-10T10:30:00.000Z",
            actualEnd: "2026-06-10T10:50:00.000Z",
            status: "interrupted",
            endReason: "focus_failed",
          }),
        ],
        runEvents: [],
        blockEvents: blockedBurstEvents(),
        previousStates: [
          {
            contextKey: "midday:late:medium:low:unknown:none",
            readiness: 0.1,
            strain: 0.8,
            recoveryDebt: 0.7,
            avoidancePressure: 0.6,
            momentum: 0.1,
            confidence: 0.8,
          },
        ],
        experimentStates: [],
        experimentOutcomes: [],
      },
    });
    const planned = computePlannedSegments(
      configFromSelectedRhythm(decision.selectedRhythm),
      120,
    );

    expect(decision.selectedRhythm).toEqual({
      kind: "count",
      focusDurationMinutes: 35,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakAfterFocusCount: 3,
    });
    expect(planned.slice(0, 6)).toEqual([
      { rhythmPosition: 1, phase: "focus", startOffsetMinutes: 0, endOffsetMinutes: 35 },
      { rhythmPosition: 1, phase: "short_break", startOffsetMinutes: 35, endOffsetMinutes: 40 },
      { rhythmPosition: 2, phase: "focus", startOffsetMinutes: 40, endOffsetMinutes: 75 },
      { rhythmPosition: 2, phase: "short_break", startOffsetMinutes: 75, endOffsetMinutes: 80 },
      { rhythmPosition: 3, phase: "focus", startOffsetMinutes: 80, endOffsetMinutes: 115 },
      { rhythmPosition: 3, phase: "long_break", startOffsetMinutes: 115, endOffsetMinutes: 120 },
    ]);
  });

  it("uses previous state only from the matching context key", () => {
    const matched = previousAdaptiveStateForContext(CONTEXT, [
      {
        contextKey: "evening:late:long:high:unknown:none",
        readiness: 0.1,
        strain: 0.9,
        recoveryDebt: 0.9,
        avoidancePressure: 0.9,
        momentum: 0.1,
        confidence: 0.9,
      },
      {
        contextKey: adaptiveContextKey(CONTEXT),
        readiness: 0.7,
        strain: 0.2,
        recoveryDebt: 0.1,
        avoidancePressure: 0.15,
        momentum: 0.75,
        confidence: 0.8,
      },
    ]);

    expect(matched).toEqual({
      readiness: 0.7,
      strain: 0.2,
      recoveryDebt: 0.1,
      avoidancePressure: 0.15,
      momentum: 0.75,
      confidence: 0.8,
    });
    expect(previousAdaptiveStateForContext(CONTEXT, [
      {
        contextKey: "evening:late:long:high:unknown:none",
        readiness: 0.1,
        strain: 0.9,
        recoveryDebt: 0.9,
        avoidancePressure: 0.9,
        momentum: 0.1,
        confidence: 0.9,
      },
    ])).toBeNull();
  });

  it("builds a boundary adaptive decision envelope for a break start", () => {
    const decision = decideBoundaryAdaptiveRhythm({
      opportunityKind: "break_start",
      startedAt: "2026-06-10T09:40:00.000Z",
      plannedStart: "2026-06-10T09:40:00.000Z",
      plannedEnd: "2026-06-10T11:00:00.000Z",
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      idleDetectionEnabled: true,
      history: null,
    });
    const envelope = snapshotFromBoundaryAdaptiveDecision(decision, {
      runId: "run-1",
      segmentId: "segment-2",
    });

    expect(decision.opportunityKind).toBe("break_start");
    expect(envelope.contextSnapshot.runId).toBe("run-1");
    expect(envelope.contextSnapshot.segmentId).toBe("segment-2");
    expect(envelope.decision.runId).toBe("run-1");
    expect(envelope.decision.segmentId).toBe("segment-2");
    expect(envelope.decision.opportunityKind).toBe("break_start");
    expect(envelope.decision.values).toContainEqual({
      valueKey: "focus_duration_minutes",
      previousNumericValue: 40,
      selectedNumericValue: 40,
      valueUnit: "minutes",
    });
  });
});
