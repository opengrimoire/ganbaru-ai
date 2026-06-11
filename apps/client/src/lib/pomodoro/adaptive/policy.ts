import {
  FOCUS_STEP_MINUTES,
  HIGH_AVOIDANCE_THRESHOLD,
  HIGH_MOMENTUM_THRESHOLD,
  HIGH_RECOVERY_DEBT_THRESHOLD,
  HIGH_STRAIN_THRESHOLD,
  LONG_BREAK_DRIFT_SECONDS,
  LOW_CONFIDENCE_THRESHOLD,
  LOW_RISK_THRESHOLD,
  MAX_ADAPTIVE_FOCUS_MINUTES,
  MAX_ADAPTIVE_LONG_BREAK_CADENCE,
  MAX_ADAPTIVE_LONG_BREAK_MINUTES,
  MAX_ADAPTIVE_SHORT_BREAK_MINUTES,
  MIN_ADAPTIVE_FOCUS_MINUTES,
  MIN_ADAPTIVE_LONG_BREAK_CADENCE,
  MIN_ADAPTIVE_LONG_BREAK_MINUTES,
  MIN_ADAPTIVE_SHORT_BREAK_MINUTES,
  MODERATE_CONFIDENCE_THRESHOLD,
  NORMAL_MIN_ADAPTIVE_FOCUS_MINUTES,
  SHORT_BREAK_DRIFT_SECONDS,
  SHORT_BREAK_DRIFT_STEP_MINUTES,
  LONG_BREAK_STEP_MINUTES,
} from "./constants";
import { reasonCodesForState } from "./state";
import type {
  AdaptivePolicyDecision,
  AdaptivePolicyInput,
  AdaptiveReasonCode,
} from "./types";
import type { CountPomodoroRhythm } from "$lib/pomodoro/rhythm";

/**
 * Selects the next count rhythm for Adaptive mode using conservative local signals.
 */
export function selectAdaptiveRhythm(input: AdaptivePolicyInput): AdaptivePolicyDecision {
  const selected = cloneCountRhythm(input.currentRhythm);
  const reasons = new Set<AdaptiveReasonCode>();
  const { state, features } = input;

  for (const reason of reasonCodesForState(state)) reasons.add(reason);

  if (features.dataQualityFlags.includes("extension_unavailable")) {
    reasons.add("missing_extension_data");
  }
  if (features.dataQualityFlags.includes("diary_missing")) {
    reasons.add("missing_diary_data");
  }

  if (state.confidence < LOW_CONFIDENCE_THRESHOLD) {
    reasons.add(features.comparableOpportunityCount === 0 ? "no_history" : "low_confidence");
    return {
      selectedRhythm: selected,
      mode: "fallback",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    state.recoveryDebt >= HIGH_RECOVERY_DEBT_THRESHOLD ||
    (state.strain >= HIGH_STRAIN_THRESHOLD && features.focusFailureCount > 0)
  ) {
    selected.focusDurationMinutes = decreaseFocus(
      selected.focusDurationMinutes,
      features.focusFailureCount > 0 ? MIN_ADAPTIVE_FOCUS_MINUTES : NORMAL_MIN_ADAPTIVE_FOCUS_MINUTES,
    );
    selected.longBreakMinutes = clampInteger(
      selected.longBreakMinutes + LONG_BREAK_STEP_MINUTES,
      MIN_ADAPTIVE_LONG_BREAK_MINUTES,
      MAX_ADAPTIVE_LONG_BREAK_MINUTES,
    );
    selected.longBreakAfterFocusCount = clampInteger(
      selected.longBreakAfterFocusCount - 1,
      MIN_ADAPTIVE_LONG_BREAK_CADENCE,
      MAX_ADAPTIVE_LONG_BREAK_CADENCE,
    );
    reasons.add("guardrail_recovery");
    return {
      selectedRhythm: selected,
      mode: "recovery",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (features.lateFocusSegmentCount >= 2 && features.lateFocusFailureCount >= 2) {
    selected.longBreakMinutes = clampInteger(
      selected.longBreakMinutes + LONG_BREAK_STEP_MINUTES,
      MIN_ADAPTIVE_LONG_BREAK_MINUTES,
      MAX_ADAPTIVE_LONG_BREAK_MINUTES,
    );
    selected.longBreakAfterFocusCount = clampInteger(
      selected.longBreakAfterFocusCount - 1,
      MIN_ADAPTIVE_LONG_BREAK_CADENCE,
      MAX_ADAPTIVE_LONG_BREAK_CADENCE,
    );
    reasons.add("guardrail_recovery");
    return {
      selectedRhythm: selected,
      mode: "guardrail",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    features.skippedLongBreakNextFocusFailureCount >= 1 ||
    features.skippedBreakNextFocusFailureCount >= 2
  ) {
    selected.longBreakMinutes = clampInteger(
      selected.longBreakMinutes + LONG_BREAK_STEP_MINUTES,
      MIN_ADAPTIVE_LONG_BREAK_MINUTES,
      MAX_ADAPTIVE_LONG_BREAK_MINUTES,
    );
    selected.longBreakAfterFocusCount = clampInteger(
      selected.longBreakAfterFocusCount - 1,
      MIN_ADAPTIVE_LONG_BREAK_CADENCE,
      MAX_ADAPTIVE_LONG_BREAK_CADENCE,
    );
    reasons.add("skipped_break_recovery");
    reasons.add("guardrail_recovery");
    return {
      selectedRhythm: selected,
      mode: "guardrail",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    features.lateFocusSegmentCount >= 2 &&
    (
      features.lateFocusFailureCount === 1 ||
      (
        features.lateFocusBlockedAttemptCount >= 3 &&
        features.lateFocusBlockedAttemptCount > features.earlyFocusBlockedAttemptCount &&
        state.recoveryDebt < LOW_RISK_THRESHOLD
      )
    ) &&
    state.strain < HIGH_STRAIN_THRESHOLD &&
    state.recoveryDebt < HIGH_RECOVERY_DEBT_THRESHOLD &&
    state.avoidancePressure < HIGH_AVOIDANCE_THRESHOLD
  ) {
    selected.longBreakAfterFocusCount = clampInteger(
      selected.longBreakAfterFocusCount - 1,
      MIN_ADAPTIVE_LONG_BREAK_CADENCE,
      MAX_ADAPTIVE_LONG_BREAK_CADENCE,
    );
    reasons.add("guardrail_recovery");
    return {
      selectedRhythm: selected,
      mode: "explore",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    features.earlyFocusIdlePauseCount >= 2 &&
    state.strain >= LOW_RISK_THRESHOLD &&
    state.avoidancePressure < HIGH_AVOIDANCE_THRESHOLD
  ) {
    selected.focusDurationMinutes = decreaseFocus(
      selected.focusDurationMinutes,
      NORMAL_MIN_ADAPTIVE_FOCUS_MINUTES,
    );
    reasons.add("focus_idle_pressure");
    reasons.add("guardrail_recovery");
    return {
      selectedRhythm: selected,
      mode: "guardrail",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    features.lateFocusIdlePauseCount >= 2 &&
    state.recoveryDebt >= LOW_RISK_THRESHOLD
  ) {
    selected.focusDurationMinutes = decreaseFocus(
      selected.focusDurationMinutes,
      NORMAL_MIN_ADAPTIVE_FOCUS_MINUTES,
    );
    reasons.add("focus_idle_pressure");
    reasons.add("guardrail_recovery");
    return {
      selectedRhythm: selected,
      mode: "guardrail",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    features.earlyGoToBreakNowCount >= 2 &&
    state.strain >= LOW_RISK_THRESHOLD &&
    state.avoidancePressure < HIGH_AVOIDANCE_THRESHOLD
  ) {
    selected.focusDurationMinutes = decreaseFocus(
      selected.focusDurationMinutes,
      NORMAL_MIN_ADAPTIVE_FOCUS_MINUTES,
    );
    reasons.add("guardrail_recovery");
    return {
      selectedRhythm: selected,
      mode: "guardrail",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    features.lateGoToBreakNowCount >= 2 &&
    state.recoveryDebt >= LOW_RISK_THRESHOLD
  ) {
    selected.focusDurationMinutes = decreaseFocus(
      selected.focusDurationMinutes,
      NORMAL_MIN_ADAPTIVE_FOCUS_MINUTES,
    );
    reasons.add("guardrail_recovery");
    return {
      selectedRhythm: selected,
      mode: "guardrail",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    features.lateFocusBlockedAttemptCount >= 3 &&
    features.lateFocusBlockedAttemptCount > features.earlyFocusBlockedAttemptCount &&
    state.recoveryDebt >= LOW_RISK_THRESHOLD
  ) {
    selected.longBreakMinutes = clampInteger(
      selected.longBreakMinutes + LONG_BREAK_STEP_MINUTES,
      MIN_ADAPTIVE_LONG_BREAK_MINUTES,
      MAX_ADAPTIVE_LONG_BREAK_MINUTES,
    );
    selected.longBreakAfterFocusCount = clampInteger(
      selected.longBreakAfterFocusCount - 1,
      MIN_ADAPTIVE_LONG_BREAK_CADENCE,
      MAX_ADAPTIVE_LONG_BREAK_CADENCE,
    );
    reasons.add("guardrail_recovery");
    return {
      selectedRhythm: selected,
      mode: "guardrail",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    state.avoidancePressure >= HIGH_AVOIDANCE_THRESHOLD &&
    state.strain < LOW_RISK_THRESHOLD &&
    state.recoveryDebt < LOW_RISK_THRESHOLD &&
    features.focusFailureCount === 0 &&
    features.interruptedFocusSegments === 0
  ) {
    reasons.add("hold_current_rhythm");
    return {
      selectedRhythm: selected,
      mode: "hold",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    features.focusRepeatedBlockedSourceAttemptCount >= 3 &&
    state.strain < LOW_RISK_THRESHOLD &&
    state.recoveryDebt < LOW_RISK_THRESHOLD &&
    features.focusFailureCount === 0 &&
    features.interruptedFocusSegments === 0
  ) {
    reasons.add("repeated_blocked_source_pressure");
    reasons.add("hold_current_rhythm");
    return {
      selectedRhythm: selected,
      mode: "hold",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    state.strain >= HIGH_STRAIN_THRESHOLD ||
    state.avoidancePressure >= HIGH_AVOIDANCE_THRESHOLD
  ) {
    selected.focusDurationMinutes = decreaseFocus(
      selected.focusDurationMinutes,
      NORMAL_MIN_ADAPTIVE_FOCUS_MINUTES,
    );
    if (state.avoidancePressure >= HIGH_AVOIDANCE_THRESHOLD && features.blockedBurstCount > 0) {
      selected.longBreakAfterFocusCount = clampInteger(
        selected.longBreakAfterFocusCount - 1,
        MIN_ADAPTIVE_LONG_BREAK_CADENCE,
        MAX_ADAPTIVE_LONG_BREAK_CADENCE,
      );
    }
    return {
      selectedRhythm: selected,
      mode: "guardrail",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    features.shortBreakOvertimeSeconds >= SHORT_BREAK_DRIFT_SECONDS &&
    features.shortBreakOvertimeBlockedAttemptCount > 0
  ) {
    reasons.add("break_transition_pressure");
    reasons.add("hold_current_rhythm");
    return {
      selectedRhythm: selected,
      mode: "hold",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    features.shortBreakOvertimeSeconds >= SHORT_BREAK_DRIFT_SECONDS &&
    state.avoidancePressure < LOW_RISK_THRESHOLD
  ) {
    selected.shortBreakMinutes = clampInteger(
      selected.shortBreakMinutes + SHORT_BREAK_DRIFT_STEP_MINUTES,
      MIN_ADAPTIVE_SHORT_BREAK_MINUTES,
      MAX_ADAPTIVE_SHORT_BREAK_MINUTES,
    );
    reasons.add("break_return_drift");
    return {
      selectedRhythm: selected,
      mode: "explore",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    features.longBreakOvertimeSeconds >= LONG_BREAK_DRIFT_SECONDS &&
    features.longBreakOvertimeBlockedAttemptCount === 0 &&
    state.avoidancePressure < LOW_RISK_THRESHOLD
  ) {
    selected.longBreakMinutes = clampInteger(
      selected.longBreakMinutes + LONG_BREAK_STEP_MINUTES,
      MIN_ADAPTIVE_LONG_BREAK_MINUTES,
      MAX_ADAPTIVE_LONG_BREAK_MINUTES,
    );
    reasons.add("break_return_drift");
    return {
      selectedRhythm: selected,
      mode: "explore",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    state.confidence >= MODERATE_CONFIDENCE_THRESHOLD &&
    state.momentum >= HIGH_MOMENTUM_THRESHOLD &&
    state.strain < LOW_RISK_THRESHOLD &&
    state.avoidancePressure < LOW_RISK_THRESHOLD &&
    state.recoveryDebt < LOW_RISK_THRESHOLD &&
    features.completedFocusSegments >= 12 &&
    features.cleanFocusSeconds >= features.plannedFocusSeconds &&
    features.interruptedFocusSegments === 0 &&
    features.focusFailureCount === 0 &&
    features.breakSkippedCount === 0 &&
    features.breakCompletedCount >= 10 &&
    features.blockedAttemptCount === 0 &&
    features.shortBreakOvertimeSeconds === 0 &&
    features.longBreakOvertimeSeconds === 0 &&
    features.comparableOpportunityCount >= 24
  ) {
    selected.longBreakAfterFocusCount = clampInteger(
      selected.longBreakAfterFocusCount + 1,
      MIN_ADAPTIVE_LONG_BREAK_CADENCE,
      MAX_ADAPTIVE_LONG_BREAK_CADENCE,
    );
    reasons.add("capacity_rebuild");
    return {
      selectedRhythm: selected,
      mode: "explore",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  if (
    state.confidence >= MODERATE_CONFIDENCE_THRESHOLD &&
    state.momentum >= HIGH_MOMENTUM_THRESHOLD &&
    state.strain < LOW_RISK_THRESHOLD &&
    state.avoidancePressure < LOW_RISK_THRESHOLD &&
    state.recoveryDebt < LOW_RISK_THRESHOLD
  ) {
    selected.focusDurationMinutes = clampInteger(
      selected.focusDurationMinutes + FOCUS_STEP_MINUTES,
      MIN_ADAPTIVE_FOCUS_MINUTES,
      MAX_ADAPTIVE_FOCUS_MINUTES,
    );
    reasons.add("capacity_rebuild");
    return {
      selectedRhythm: selected,
      mode: "exploit",
      reasonCodes: [...reasons],
      stateScores: state,
    };
  }

  reasons.add("hold_current_rhythm");
  return {
    selectedRhythm: selected,
    mode: "hold",
    reasonCodes: [...reasons],
    stateScores: state,
  };
}

function decreaseFocus(value: number, minimum: number): number {
  return clampInteger(
    value - FOCUS_STEP_MINUTES,
    minimum,
    MAX_ADAPTIVE_FOCUS_MINUTES,
  );
}

function cloneCountRhythm(rhythm: CountPomodoroRhythm): CountPomodoroRhythm {
  return { ...rhythm };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
