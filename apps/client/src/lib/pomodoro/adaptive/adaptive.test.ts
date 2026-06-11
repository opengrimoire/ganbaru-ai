import { describe, expect, it } from "vitest";
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
  type AdaptiveExperimentAssignmentHistory,
  type AdaptiveExperimentState,
  type AdaptiveExperimentVariantOutcome,
} from "./experiments";
import {
  deriveAdaptiveContextBucket,
  extractAdaptiveFeatures,
} from "./features";
import { buildAdaptivePlannedBlocksForDate } from "./planned-blocks";
import {
  adaptiveContextKey,
  buildRunStartAdaptiveSnapshot,
  decideBoundaryAdaptiveRhythm,
  decideRunStartAdaptiveRhythm,
  previousAdaptiveStateForContext,
  snapshotFromBoundaryAdaptiveDecision,
  snapshotFromRunStartAdaptiveDecision,
} from "./persistence";
import { selectAdaptiveRhythm } from "./policy";
import { deriveAdaptiveState } from "./state";
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

const CONTEXT: AdaptiveContextBucket = {
  timeOfDay: "morning",
  sessionPosition: "first",
  eventLength: "medium",
  workload: "low",
  energy: "unknown",
  environmentId: null,
};

describe("adaptive feature extraction", () => {
  it("excludes idle and manual pauses from clean focus", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:40:00.000Z",
          pauseLog: [
            {
              startedAt: "2026-06-10T09:10:00.000Z",
              endedAt: "2026-06-10T09:15:00.000Z",
              reason: "idle",
            },
            {
              startedAt: "2026-06-10T09:20:00.000Z",
              endedAt: "2026-06-10T09:22:00.000Z",
              reason: "manual",
            },
          ],
        }),
      ],
    });

    expect(features.completedFocusSegments).toBe(1);
    expect(features.plannedFocusSeconds).toBe(40 * 60);
    expect(features.cleanFocusSeconds).toBe(33 * 60);
    expect(features.idlePauseCount).toBe(1);
    expect(features.idlePauseSeconds).toBe(5 * 60);
    expect(features.focusIdlePauseCount).toBe(1);
    expect(features.focusIdlePauseSeconds).toBe(5 * 60);
    expect(features.earlyFocusIdlePauseCount).toBe(1);
    expect(features.lateFocusIdlePauseCount).toBe(0);
    expect(features.manualPauseSeconds).toBe(2 * 60);
  });

  it("splits focus idle pauses by focus timing", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:40:00.000Z",
          pauseLog: [
            {
              startedAt: "2026-06-10T09:03:00.000Z",
              endedAt: "2026-06-10T09:05:00.000Z",
              reason: "idle",
            },
            {
              startedAt: "2026-06-10T09:20:00.000Z",
              endedAt: "2026-06-10T09:22:00.000Z",
              reason: "idle",
            },
            {
              startedAt: "2026-06-10T09:37:00.000Z",
              endedAt: "2026-06-10T09:39:00.000Z",
              reason: "idle",
            },
          ],
        }),
      ],
    });

    expect(features.focusIdlePauseCount).toBe(3);
    expect(features.focusIdlePauseSeconds).toBe(6 * 60);
    expect(features.earlyFocusIdlePauseCount).toBe(1);
    expect(features.lateFocusIdlePauseCount).toBe(1);
  });

  it("counts blocked-site bursts in focus phases", () => {
    const features = extractAdaptiveFeatures({
      segments: [],
      blockEvents: blockedBurstEvents(),
    });

    expect(features.blockedAttemptCount).toBe(6);
    expect(features.focusBlockedAttemptCount).toBe(6);
    expect(features.blockedBurstCount).toBe(2);
  });

  it("counts repeated blocked attempts against the same source", () => {
    const features = extractAdaptiveFeatures({
      segments: [],
      blockEvents: [
        blockedFocusEvent("2026-06-10T09:01:00.000Z", "social-a"),
        blockedFocusEvent("2026-06-10T09:02:00.000Z", "social-a"),
        blockedFocusEvent("2026-06-10T09:03:00.000Z", "social-a"),
        blockedFocusEvent("2026-06-10T09:04:00.000Z", "social-b"),
        blockedFocusEvent("2026-06-10T09:05:00.000Z", "social-b"),
        blockedBreakEvent("2026-06-10T09:46:00.000Z", "short_break", "video-a"),
        blockedBreakEvent("2026-06-10T09:47:00.000Z", "short_break", "video-a"),
      ],
    });

    expect(features.repeatedBlockedSourceAttemptCount).toBe(4);
    expect(features.focusRepeatedBlockedSourceAttemptCount).toBe(3);
    expect(features.breakRepeatedBlockedSourceAttemptCount).toBe(1);
  });

  it("splits focus blocked attempts by focus timing", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:40:00.000Z",
        }),
      ],
      blockEvents: [
        blockedFocusEvent("2026-06-10T09:02:00.000Z"),
        blockedFocusEvent("2026-06-10T09:08:00.000Z"),
        blockedFocusEvent("2026-06-10T09:20:00.000Z"),
        blockedFocusEvent("2026-06-10T09:34:00.000Z"),
        blockedFocusEvent("2026-06-10T09:38:00.000Z"),
      ],
    });

    expect(features.focusBlockedAttemptCount).toBe(5);
    expect(features.earlyFocusBlockedAttemptCount).toBe(2);
    expect(features.lateFocusBlockedAttemptCount).toBe(2);
  });

  it("splits go to break now events by focus timing", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:40:00.000Z",
        }),
      ],
      runEvents: [
        runEvent({
          eventType: "go_to_break_now",
          occurredAt: "2026-06-10T09:03:00.000Z",
          phase: "focus",
        }),
        runEvent({
          eventType: "go_to_break_now",
          occurredAt: "2026-06-10T09:20:00.000Z",
          phase: "focus",
        }),
        runEvent({
          eventType: "go_to_break_now",
          occurredAt: "2026-06-10T09:37:00.000Z",
          phase: "focus",
        }),
      ],
    });

    expect(features.goToBreakNowCount).toBe(3);
    expect(features.earlyGoToBreakNowCount).toBe(1);
    expect(features.lateGoToBreakNowCount).toBe(1);
  });

  it("infers go to break now from early focus completion before a break", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:08:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
        breakSegment({
          plannedStart: "2026-06-10T09:08:00.000Z",
          plannedEnd: "2026-06-10T09:13:00.000Z",
          actualStart: "2026-06-10T09:08:00.000Z",
          actualEnd: "2026-06-10T09:13:00.000Z",
        }),
      ],
    });

    expect(features.goToBreakNowCount).toBe(1);
    expect(features.earlyGoToBreakNowCount).toBe(1);
    expect(features.lateGoToBreakNowCount).toBe(0);
  });

  it("does not double count explicit go to break now events", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:00:00.000Z",
          plannedEnd: "2026-06-10T09:40:00.000Z",
          actualStart: "2026-06-10T09:00:00.000Z",
          actualEnd: "2026-06-10T09:08:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
        breakSegment({
          plannedStart: "2026-06-10T09:08:00.000Z",
          plannedEnd: "2026-06-10T09:13:00.000Z",
          actualStart: "2026-06-10T09:08:00.000Z",
          actualEnd: "2026-06-10T09:13:00.000Z",
        }),
      ],
      runEvents: [
        runEvent({
          eventType: "go_to_break_now",
          occurredAt: "2026-06-10T09:08:00.000Z",
          phase: "focus",
        }),
      ],
    });

    expect(features.goToBreakNowCount).toBe(1);
    expect(features.earlyGoToBreakNowCount).toBe(1);
  });

  it("tracks blocked attempts that happen during break overtime", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        breakSegment({
          phase: "short_break",
          plannedStart: "2026-06-10T09:40:00.000Z",
          plannedEnd: "2026-06-10T09:45:00.000Z",
          actualStart: "2026-06-10T09:40:00.000Z",
          actualEnd: "2026-06-10T09:49:00.000Z",
        }),
        breakSegment({
          phase: "long_break",
          plannedStart: "2026-06-10T10:30:00.000Z",
          plannedEnd: "2026-06-10T10:40:00.000Z",
          actualStart: "2026-06-10T10:30:00.000Z",
          actualEnd: "2026-06-10T10:46:00.000Z",
        }),
      ],
      blockEvents: [
        blockedBreakEvent("2026-06-10T09:44:00.000Z", "short_break"),
        blockedBreakEvent("2026-06-10T09:47:00.000Z", "short_break"),
        blockedBreakEvent("2026-06-10T10:43:00.000Z", "long_break"),
      ],
    });

    expect(features.breakBlockedAttemptCount).toBe(3);
    expect(features.breakOvertimeBlockedAttemptCount).toBe(2);
    expect(features.shortBreakOvertimeBlockedAttemptCount).toBe(1);
    expect(features.longBreakOvertimeBlockedAttemptCount).toBe(1);
  });

  it("tracks failures that cluster late in a rhythm", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          rhythmPosition: 1,
          status: "completed",
          endReason: "completed",
        }),
        focusSegment({
          rhythmPosition: 3,
          status: "interrupted",
          endReason: "focus_failed",
        }),
        focusSegment({
          rhythmPosition: 4,
          status: "interrupted",
          endReason: "focus_failed",
        }),
      ],
    });

    expect(features.focusFailureCount).toBe(2);
    expect(features.lateFocusSegmentCount).toBe(2);
    expect(features.lateFocusFailureCount).toBe(2);
  });

  it("classifies early break endings by the next focus outcome", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        breakSegment({
          plannedStart: "2026-06-10T09:40:00.000Z",
          plannedEnd: "2026-06-10T09:45:00.000Z",
          actualStart: "2026-06-10T09:40:00.000Z",
          actualEnd: "2026-06-10T09:43:00.000Z",
        }),
        focusSegment({
          plannedStart: "2026-06-10T09:45:00.000Z",
          plannedEnd: "2026-06-10T10:25:00.000Z",
          actualStart: "2026-06-10T09:43:00.000Z",
          actualEnd: "2026-06-10T10:23:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
        breakSegment({
          plannedStart: "2026-06-10T10:23:00.000Z",
          plannedEnd: "2026-06-10T10:28:00.000Z",
          actualStart: "2026-06-10T10:23:00.000Z",
          actualEnd: "2026-06-10T10:25:00.000Z",
        }),
        focusSegment({
          plannedStart: "2026-06-10T10:28:00.000Z",
          plannedEnd: "2026-06-10T11:08:00.000Z",
          actualStart: "2026-06-10T10:25:00.000Z",
          actualEnd: "2026-06-10T10:40:00.000Z",
          status: "interrupted",
          endReason: "focus_failed",
        }),
      ],
      runEvents: [
        runEvent({
          eventType: "start_focus_now",
          occurredAt: "2026-06-10T09:43:00.000Z",
          phase: "short_break",
        }),
        runEvent({
          eventType: "start_focus_now",
          occurredAt: "2026-06-10T10:25:00.000Z",
          phase: "short_break",
        }),
      ],
    });

    expect(features.startFocusNowCount).toBe(2);
    expect(features.startFocusNowSuccessCount).toBe(1);
    expect(features.startFocusNowFailureCount).toBe(1);
  });

  it("infers early break endings from timing", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        breakSegment({
          plannedStart: "2026-06-10T09:40:00.000Z",
          plannedEnd: "2026-06-10T09:45:00.000Z",
          actualStart: "2026-06-10T09:40:00.000Z",
          actualEnd: "2026-06-10T09:42:00.000Z",
          status: "interrupted",
          endReason: "skipped_by_user",
        }),
        focusSegment({
          plannedStart: "2026-06-10T09:45:00.000Z",
          plannedEnd: "2026-06-10T10:25:00.000Z",
          actualStart: "2026-06-10T09:42:00.000Z",
          actualEnd: "2026-06-10T10:22:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
      ],
    });

    expect(features.startFocusNowCount).toBe(1);
    expect(features.startFocusNowSuccessCount).toBe(1);
    expect(features.startFocusNowFailureCount).toBe(0);
  });

  it("does not infer early break endings from system interruptions", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        breakSegment({
          plannedStart: "2026-06-10T09:40:00.000Z",
          plannedEnd: "2026-06-10T09:45:00.000Z",
          actualStart: "2026-06-10T09:40:00.000Z",
          actualEnd: "2026-06-10T09:42:00.000Z",
          status: "interrupted",
          endReason: "reconfigured",
        }),
        focusSegment({
          plannedStart: "2026-06-10T09:45:00.000Z",
          plannedEnd: "2026-06-10T10:25:00.000Z",
          actualStart: "2026-06-10T09:42:00.000Z",
          actualEnd: "2026-06-10T10:22:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
      ],
    });

    expect(features.startFocusNowCount).toBe(0);
    expect(features.startFocusNowSuccessCount).toBe(0);
    expect(features.startFocusNowFailureCount).toBe(0);
  });

  it("classifies skipped breaks by the next focus outcome", () => {
    const features = extractAdaptiveFeatures({
      segments: [
        focusSegment({
          plannedStart: "2026-06-10T09:45:00.000Z",
          plannedEnd: "2026-06-10T10:25:00.000Z",
          actualStart: "2026-06-10T09:45:00.000Z",
          actualEnd: "2026-06-10T10:25:00.000Z",
          status: "completed",
          endReason: "completed",
        }),
        focusSegment({
          plannedStart: "2026-06-10T10:45:00.000Z",
          plannedEnd: "2026-06-10T11:25:00.000Z",
          actualStart: "2026-06-10T10:45:00.000Z",
          actualEnd: "2026-06-10T11:00:00.000Z",
          status: "interrupted",
          endReason: "focus_failed",
        }),
      ],
      runEvents: [
        runEvent({
          eventType: "skip_break",
          occurredAt: "2026-06-10T09:40:00.000Z",
          phase: "short_break",
        }),
        runEvent({
          eventType: "skip_break",
          occurredAt: "2026-06-10T10:25:00.000Z",
          phase: "long_break",
        }),
      ],
    });

    expect(features.breakSkippedCount).toBe(2);
    expect(features.skippedBreakNextFocusSuccessCount).toBe(1);
    expect(features.skippedBreakNextFocusFailureCount).toBe(1);
    expect(features.skippedShortBreakNextFocusFailureCount).toBe(0);
    expect(features.skippedLongBreakNextFocusFailureCount).toBe(1);
  });

  it("derives coarse context buckets", () => {
    expect(deriveAdaptiveContextBucket({
      localStartedAt: "2026-06-10T08:30:00.000Z",
      plannedEventMinutes: 120,
      sessionIndexToday: 1,
      cleanFocusMinutesToday: 45,
      energyLevel: 2,
      environmentId: "env-1",
    })).toEqual({
      timeOfDay: "morning",
      sessionPosition: "first",
      eventLength: "medium",
      workload: "low",
      energy: "low",
      environmentId: "env-1",
    });
  });
});

describe("adaptive policy", () => {
  it("uses the fixed baseline when there is no history", () => {
    const features = baseFeatures();
    const state = deriveAdaptiveState(features);
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("fallback");
    expect(decision.reasonCodes).toContain("no_history");
    expect(decision.selectedRhythm).toEqual(ADAPTIVE_BASELINE_RHYTHM);
  });

  it("shortens focus and brings recovery forward after strain with focus failures", () => {
    const features = baseFeatures({
      completedFocusSegments: 6,
      interruptedFocusSegments: 3,
      focusFailureCount: 3,
      cleanFocusSeconds: 6 * 35 * 60,
      plannedFocusSeconds: 9 * 40 * 60,
      blockedAttemptCount: 12,
      focusBlockedAttemptCount: 12,
      blockedBurstCount: 3,
      comparableOpportunityCount: 14,
    });
    const state = deriveAdaptiveState(features);
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("recovery");
    expect(decision.reasonCodes).toContain("high_strain");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(35);
    expect(decision.selectedRhythm.longBreakMinutes).toBe(15);
    expect(decision.selectedRhythm.longBreakAfterFocusCount).toBe(3);
  });

  it("does not immediately shrink focus when blockers contain a clean focus session", () => {
    const features = baseFeatures({
      completedFocusSegments: 8,
      cleanFocusSeconds: 8 * 40 * 60,
      plannedFocusSeconds: 8 * 40 * 60,
      blockedAttemptCount: 7,
      focusBlockedAttemptCount: 7,
      blockedBurstCount: 1,
      comparableOpportunityCount: 10,
    });
    const state = deriveAdaptiveState(features);
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("hold");
    expect(decision.reasonCodes).toContain("high_avoidance_pressure");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(40);
  });

  it("tests a longer short break when returns drift without avoidance pressure", () => {
    const features = baseFeatures({
      completedFocusSegments: 4,
      cleanFocusSeconds: 4 * 40 * 60,
      plannedFocusSeconds: 4 * 40 * 60,
      breakStartedCount: 4,
      breakCompletedCount: 4,
      shortBreakOvertimeSeconds: 3 * 60,
      comparableOpportunityCount: 12,
    });
    const state = deriveAdaptiveState(features);
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("explore");
    expect(decision.reasonCodes).toContain("break_return_drift");
    expect(decision.selectedRhythm.shortBreakMinutes).toBe(7);
  });

  it("does not lengthen short breaks when break overtime includes blocker pressure", () => {
    const features = baseFeatures({
      completedFocusSegments: 4,
      cleanFocusSeconds: 4 * 40 * 60,
      plannedFocusSeconds: 4 * 40 * 60,
      breakStartedCount: 4,
      breakCompletedCount: 4,
      shortBreakOvertimeSeconds: 3 * 60,
      breakBlockedAttemptCount: 1,
      breakOvertimeBlockedAttemptCount: 1,
      shortBreakOvertimeBlockedAttemptCount: 1,
      comparableOpportunityCount: 12,
    });
    const state = {
      ...deriveAdaptiveState(features),
      confidence: 0.7,
      strain: 0.1,
      recoveryDebt: 0.2,
      avoidancePressure: 0.2,
    };
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("hold");
    expect(decision.reasonCodes).toContain("break_transition_pressure");
    expect(decision.selectedRhythm.shortBreakMinutes).toBe(5);
  });

  it("tests a longer long break when long-break returns drift without blocker pressure", () => {
    const features = baseFeatures({
      completedFocusSegments: 4,
      cleanFocusSeconds: 4 * 40 * 60,
      plannedFocusSeconds: 4 * 40 * 60,
      breakStartedCount: 4,
      breakCompletedCount: 4,
      longBreakOvertimeSeconds: 6 * 60,
      comparableOpportunityCount: 12,
    });
    const state = {
      ...deriveAdaptiveState(features),
      confidence: 0.7,
      strain: 0.1,
      recoveryDebt: 0.1,
      avoidancePressure: 0.1,
      momentum: 0.5,
    };
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("explore");
    expect(decision.reasonCodes).toContain("break_return_drift");
    expect(decision.selectedRhythm.longBreakMinutes).toBe(15);
  });

  it("tests earlier long-break cadence when late-cycle pressure is mild", () => {
    const features = baseFeatures({
      completedFocusSegments: 7,
      interruptedFocusSegments: 1,
      focusFailureCount: 1,
      lateFocusSegmentCount: 3,
      lateFocusFailureCount: 1,
      cleanFocusSeconds: 7 * 40 * 60,
      plannedFocusSeconds: 8 * 40 * 60,
      comparableOpportunityCount: 12,
    });
    const state = {
      ...deriveAdaptiveState(features),
      confidence: 0.7,
      strain: 0.3,
      recoveryDebt: 0.3,
      avoidancePressure: 0.2,
      momentum: 0.5,
    };
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("explore");
    expect(decision.reasonCodes).toContain("guardrail_recovery");
    expect(decision.selectedRhythm.longBreakAfterFocusCount).toBe(3);
    expect(decision.selectedRhythm.longBreakMinutes).toBe(10);
  });

  it("tests later long-break cadence after very clean high-momentum work", () => {
    const features = baseFeatures({
      completedFocusSegments: 12,
      cleanFocusSeconds: 12 * 40 * 60,
      plannedFocusSeconds: 12 * 40 * 60,
      breakStartedCount: 12,
      breakCompletedCount: 12,
      comparableOpportunityCount: 24,
    });
    const state = safeExperimentState();
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("explore");
    expect(decision.reasonCodes).toContain("capacity_rebuild");
    expect(decision.selectedRhythm.longBreakAfterFocusCount).toBe(5);
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(40);
  });

  it("brings long recovery forward when focus failures cluster late", () => {
    const features = baseFeatures({
      completedFocusSegments: 6,
      interruptedFocusSegments: 2,
      focusFailureCount: 2,
      lateFocusSegmentCount: 3,
      lateFocusFailureCount: 2,
      cleanFocusSeconds: 6 * 40 * 60,
      plannedFocusSeconds: 8 * 40 * 60,
      comparableOpportunityCount: 12,
    });
    const state = {
      ...deriveAdaptiveState(features),
      confidence: 0.7,
      strain: 0.4,
      recoveryDebt: 0.4,
      avoidancePressure: 0.1,
    };
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("guardrail_recovery");
    expect(decision.selectedRhythm.longBreakMinutes).toBe(15);
    expect(decision.selectedRhythm.longBreakAfterFocusCount).toBe(3);
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(40);
  });

  it("brings long recovery forward when skipped breaks lead to failed focus", () => {
    const features = baseFeatures({
      completedFocusSegments: 5,
      interruptedFocusSegments: 1,
      focusFailureCount: 1,
      cleanFocusSeconds: 5 * 40 * 60,
      plannedFocusSeconds: 6 * 40 * 60,
      breakSkippedCount: 1,
      skippedBreakNextFocusFailureCount: 1,
      skippedLongBreakNextFocusFailureCount: 1,
      comparableOpportunityCount: 12,
    });
    const state = {
      ...deriveAdaptiveState(features),
      confidence: 0.7,
      strain: 0.35,
      recoveryDebt: 0.35,
      avoidancePressure: 0.1,
    };
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("skipped_break_recovery");
    expect(decision.reasonCodes).toContain("guardrail_recovery");
    expect(decision.selectedRhythm.longBreakMinutes).toBe(15);
    expect(decision.selectedRhythm.longBreakAfterFocusCount).toBe(3);
  });

  it("shortens future focus after repeated early focus idle under strain", () => {
    const features = baseFeatures({
      completedFocusSegments: 4,
      interruptedFocusSegments: 1,
      focusFailureCount: 1,
      cleanFocusSeconds: 4 * 35 * 60,
      plannedFocusSeconds: 5 * 40 * 60,
      idlePauseCount: 2,
      idlePauseSeconds: 8 * 60,
      focusIdlePauseCount: 2,
      focusIdlePauseSeconds: 8 * 60,
      earlyFocusIdlePauseCount: 2,
      comparableOpportunityCount: 10,
    });
    const state = {
      ...deriveAdaptiveState(features),
      confidence: 0.7,
      strain: 0.4,
      recoveryDebt: 0.2,
      avoidancePressure: 0.2,
    };
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("focus_idle_pressure");
    expect(decision.reasonCodes).toContain("guardrail_recovery");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(35);
  });

  it("shortens future focus after repeated late focus idle under recovery debt", () => {
    const features = baseFeatures({
      completedFocusSegments: 5,
      cleanFocusSeconds: 5 * 35 * 60,
      plannedFocusSeconds: 5 * 40 * 60,
      idlePauseCount: 2,
      idlePauseSeconds: 8 * 60,
      focusIdlePauseCount: 2,
      focusIdlePauseSeconds: 8 * 60,
      lateFocusIdlePauseCount: 2,
      comparableOpportunityCount: 10,
    });
    const state = {
      ...deriveAdaptiveState(features),
      confidence: 0.7,
      strain: 0.25,
      recoveryDebt: 0.4,
      avoidancePressure: 0.1,
    };
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("focus_idle_pressure");
    expect(decision.reasonCodes).toContain("guardrail_recovery");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(35);
  });

  it("brings long recovery forward when blocked attempts cluster late in focus", () => {
    const features = baseFeatures({
      completedFocusSegments: 6,
      cleanFocusSeconds: 6 * 40 * 60,
      plannedFocusSeconds: 6 * 40 * 60,
      blockedAttemptCount: 5,
      focusBlockedAttemptCount: 5,
      lateFocusBlockedAttemptCount: 4,
      earlyFocusBlockedAttemptCount: 1,
      comparableOpportunityCount: 12,
    });
    const state = {
      ...deriveAdaptiveState(features),
      confidence: 0.7,
      strain: 0.3,
      recoveryDebt: 0.4,
      avoidancePressure: 0.4,
    };
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("guardrail_recovery");
    expect(decision.selectedRhythm.longBreakMinutes).toBe(15);
    expect(decision.selectedRhythm.longBreakAfterFocusCount).toBe(3);
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(40);
  });

  it("holds rhythm when repeated blocked-source pressure is contained by clean focus", () => {
    const features = baseFeatures({
      completedFocusSegments: 8,
      cleanFocusSeconds: 8 * 40 * 60,
      plannedFocusSeconds: 8 * 40 * 60,
      blockedAttemptCount: 6,
      repeatedBlockedSourceAttemptCount: 4,
      focusBlockedAttemptCount: 6,
      focusRepeatedBlockedSourceAttemptCount: 4,
      comparableOpportunityCount: 12,
    });
    const state = {
      ...deriveAdaptiveState(features),
      confidence: 0.7,
      strain: 0.2,
      recoveryDebt: 0.2,
      avoidancePressure: 0.5,
    };
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("hold");
    expect(decision.reasonCodes).toContain("repeated_blocked_source_pressure");
    expect(decision.reasonCodes).toContain("hold_current_rhythm");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(40);
  });

  it("shortens future focus after repeated early go to break under strain", () => {
    const features = baseFeatures({
      completedFocusSegments: 4,
      interruptedFocusSegments: 1,
      focusFailureCount: 1,
      cleanFocusSeconds: 4 * 35 * 60,
      plannedFocusSeconds: 5 * 40 * 60,
      goToBreakNowCount: 2,
      earlyGoToBreakNowCount: 2,
      comparableOpportunityCount: 10,
    });
    const state = {
      ...deriveAdaptiveState(features),
      confidence: 0.7,
      strain: 0.4,
      recoveryDebt: 0.25,
      avoidancePressure: 0.2,
    };
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("guardrail_recovery");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(35);
    expect(decision.selectedRhythm.longBreakMinutes).toBe(10);
  });

  it("shortens future focus after repeated late go to break under recovery debt", () => {
    const features = baseFeatures({
      completedFocusSegments: 5,
      cleanFocusSeconds: 5 * 38 * 60,
      plannedFocusSeconds: 5 * 40 * 60,
      goToBreakNowCount: 2,
      lateGoToBreakNowCount: 2,
      comparableOpportunityCount: 10,
    });
    const state = {
      ...deriveAdaptiveState(features),
      confidence: 0.7,
      strain: 0.3,
      recoveryDebt: 0.4,
      avoidancePressure: 0.1,
    };
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("guardrail");
    expect(decision.reasonCodes).toContain("guardrail_recovery");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(35);
    expect(decision.selectedRhythm.longBreakAfterFocusCount).toBe(4);
  });

  it("blocks upward focus exploration when recovery debt is high", () => {
    const features = baseFeatures({
      completedFocusSegments: 8,
      cleanFocusSeconds: 8 * 40 * 60,
      plannedFocusSeconds: 8 * 40 * 60,
      breakStartedCount: 8,
      breakCompletedCount: 4,
      breakSkippedCount: 4,
      longBreakOvertimeSeconds: 20 * 60,
      comparableOpportunityCount: 16,
    });
    const state = deriveAdaptiveState(features);
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("recovery");
    expect(decision.reasonCodes).toContain("high_recovery_debt");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(35);
    expect(decision.selectedRhythm.longBreakAfterFocusCount).toBe(3);
  });

  it("raises focus by one step after clean momentum with low recovery risk", () => {
    const features = baseFeatures({
      completedFocusSegments: 10,
      cleanFocusSeconds: 10 * 40 * 60,
      plannedFocusSeconds: 10 * 40 * 60,
      breakStartedCount: 10,
      breakCompletedCount: 10,
      comparableOpportunityCount: 20,
    });
    const state = deriveAdaptiveState(features);
    const decision = selectAdaptiveRhythm({
      currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
      features,
      state,
      context: CONTEXT,
    });

    expect(decision.mode).toBe("exploit");
    expect(decision.reasonCodes).toContain("capacity_rebuild");
    expect(decision.selectedRhythm.focusDurationMinutes).toBe(45);
  });

  it("lowers confidence when extension data is unavailable", () => {
    const completeFeatures = baseFeatures({
      completedFocusSegments: 8,
      cleanFocusSeconds: 8 * 40 * 60,
      plannedFocusSeconds: 8 * 40 * 60,
      breakStartedCount: 8,
      breakCompletedCount: 8,
      comparableOpportunityCount: 16,
    });
    const missingExtensionFeatures = baseFeatures({
      ...completeFeatures,
      dataQualityFlags: ["extension_unavailable"],
    });

    expect(deriveAdaptiveState(missingExtensionFeatures).confidence)
      .toBeLessThan(deriveAdaptiveState(completeFeatures).confidence);
  });
});

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

describe("adaptive planned block snapshots", () => {
  it("maps scheduler events to stable planned block identities", () => {
    const blocks = buildAdaptivePlannedBlocksForDate([
      calendarEvent({
        id: "template-1::2026-06-10",
        recurringParentId: "template-1",
        start: "2026-06-10 09:00",
        end: "2026-06-10 10:00",
      }),
      calendarEvent({
        id: "single-1",
        start: "2026-06-10 11:00",
        end: "2026-06-10 12:00",
      }),
      calendarEvent({
        id: "other-day",
        start: "2026-06-11 09:00",
        end: "2026-06-11 10:00",
      }),
    ], "2026-06-10");

    expect(blocks).toEqual([
      {
        eventDate: "2026-06-10",
        eventId: "template-1::2026-06-10",
        originalEventId: "template-1",
        plannedStart: new Date(2026, 5, 10, 9, 0).toISOString(),
        plannedEnd: new Date(2026, 5, 10, 10, 0).toISOString(),
        sourceKind: "scheduler_snapshot",
      },
      {
        eventDate: "2026-06-10",
        eventId: "single-1",
        originalEventId: "single-1",
        plannedStart: new Date(2026, 5, 10, 11, 0).toISOString(),
        plannedEnd: new Date(2026, 5, 10, 12, 0).toISOString(),
        sourceKind: "scheduler_snapshot",
      },
    ]);
  });
});

function configFromSelectedRhythm(rhythm: CountPomodoroRhythm): PomodoroConfig {
  return {
    ...createPresetPomodoroConfig("adaptive"),
    rhythm: { ...rhythm },
  };
}

function calendarEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
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

function capacityRhythm(): CountPomodoroRhythm {
  return {
    ...ADAPTIVE_BASELINE_RHYTHM,
    focusDurationMinutes: 45,
  };
}

function focusSegment(
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

function breakSegment(
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

function blockedBurstEvents(): AdaptiveBlockEventInput[] {
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

function blockedFocusEvent(occurredAt: string, sourceKey = "social"): AdaptiveBlockEventInput {
  return {
    occurredAt,
    phase: "focus",
    sourceType: "browser",
    sourceKey,
    decision: "blocked",
  };
}

function blockedBreakEvent(
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

function runEvent(overrides: Partial<AdaptiveRunEventInput>): AdaptiveRunEventInput {
  return {
    eventType: "start",
    occurredAt: "2026-06-10T09:00:00.000Z",
    phase: null,
    reason: null,
    durationSeconds: null,
    ...overrides,
  };
}

function baseFeatures(overrides: Partial<AdaptiveFeatureVector> = {}): AdaptiveFeatureVector {
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

function breakDriftExperimentFeatures(): AdaptiveFeatureVector {
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

function longBreakDriftExperimentFeatures(): AdaptiveFeatureVector {
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

function longRecoverySupportExperimentFeatures(): AdaptiveFeatureVector {
  return {
    ...longBreakDriftExperimentFeatures(),
    comparableOpportunityCount: 24,
  };
}

function cadenceExperimentFeatures(): AdaptiveFeatureVector {
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

function cadenceExpansionExperimentFeatures(): AdaptiveFeatureVector {
  return baseFeatures({
    completedFocusSegments: 12,
    cleanFocusSeconds: 12 * 40 * 60,
    plannedFocusSeconds: 12 * 40 * 60,
    breakStartedCount: 12,
    breakCompletedCount: 12,
    comparableOpportunityCount: 24,
  });
}

function safeExperimentState(): AdaptiveStateScores {
  return {
    readiness: 0.8,
    strain: 0.1,
    recoveryDebt: 0.1,
    avoidancePressure: 0.1,
    momentum: 0.78,
    confidence: 0.75,
  };
}

function experimentOutcome(
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

function experimentState(
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

function experimentAssignmentHistory(
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

function stableExperimentHistory() {
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

function breakDriftExperimentHistory() {
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

function longBreakDriftExperimentHistory() {
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

function cadenceExperimentHistory() {
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

function cadenceExpansionExperimentHistory() {
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
