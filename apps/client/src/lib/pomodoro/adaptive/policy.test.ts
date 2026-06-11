import { describe, expect, it } from "vitest";
import {
  CONTEXT,
  baseFeatures,
  safeExperimentState,
} from "./adaptive-test-helpers";
import { ADAPTIVE_BASELINE_RHYTHM } from "./constants";
import { selectAdaptiveRhythm } from "./policy";
import { deriveAdaptiveState } from "./state";

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
