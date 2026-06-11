import {
  HIGH_AVOIDANCE_THRESHOLD,
  HIGH_RECOVERY_DEBT_THRESHOLD,
  HIGH_STRAIN_THRESHOLD,
  STATE_DECAY,
} from "./constants";
import type {
  AdaptiveFeatureVector,
  AdaptiveReasonCode,
  AdaptiveStateScores,
} from "./types";

const EMPTY_STATE: AdaptiveStateScores = {
  readiness: 0,
  strain: 0,
  recoveryDebt: 0,
  avoidancePressure: 0,
  momentum: 0,
  confidence: 0,
};

/**
 * Converts extracted behavior into bounded hidden-state scores for policy decisions.
 */
export function deriveAdaptiveState(
  features: AdaptiveFeatureVector,
  previousState: AdaptiveStateScores | null = null,
): AdaptiveStateScores {
  const current = currentStateFromFeatures(features);
  if (!previousState) return current;

  return {
    readiness: blend(previousState.readiness, current.readiness),
    strain: blend(previousState.strain, current.strain),
    recoveryDebt: blend(previousState.recoveryDebt, current.recoveryDebt),
    avoidancePressure: blend(previousState.avoidancePressure, current.avoidancePressure),
    momentum: blend(previousState.momentum, current.momentum),
    confidence: Math.max(current.confidence, blend(previousState.confidence, current.confidence)),
  };
}

/**
 * Returns reason codes that summarize the dominant adaptive state signals.
 */
export function reasonCodesForState(state: AdaptiveStateScores): AdaptiveReasonCode[] {
  const reasons: AdaptiveReasonCode[] = [];
  if (state.strain >= HIGH_STRAIN_THRESHOLD) reasons.push("high_strain");
  if (state.avoidancePressure >= HIGH_AVOIDANCE_THRESHOLD) reasons.push("high_avoidance_pressure");
  if (state.recoveryDebt >= HIGH_RECOVERY_DEBT_THRESHOLD) reasons.push("high_recovery_debt");
  if (state.momentum >= 0.68) reasons.push("clean_momentum");
  if (reasons.length === 0) reasons.push("hold_current_rhythm");
  return reasons;
}

function currentStateFromFeatures(features: AdaptiveFeatureVector): AdaptiveStateScores {
  const completed = features.completedFocusSegments;
  const interrupted = features.interruptedFocusSegments;
  const focusAttempts = Math.max(1, completed + interrupted);
  const breakAttempts = Math.max(1, features.breakStartedCount + features.breakSkippedCount);
  const cleanCompletionRate = completed / focusAttempts;
  const failureRate = features.focusFailureCount / focusAttempts;
  const lateFailureRate = features.lateFocusFailureCount / Math.max(1, features.lateFocusSegmentCount);
  const failureIntensity = normalized(features.focusFailureCount, 3);
  const lateFailurePressure = normalized(features.lateFocusFailureCount, 2);
  const idlePressure = normalized(features.idlePauseCount + features.idlePauseSeconds / 600, 4);
  const focusIdlePressure = normalized(
    features.focusIdlePauseCount + features.focusIdlePauseSeconds / 600,
    4,
  );
  const earlyFocusIdlePressure = normalized(features.earlyFocusIdlePauseCount, 2);
  const lateFocusIdlePressure = normalized(features.lateFocusIdlePauseCount, 2);
  const repeatedBlockedSourcePressure = normalized(
    features.repeatedBlockedSourceAttemptCount + features.focusRepeatedBlockedSourceAttemptCount,
    8,
  );
  const earlyFocusBlockPressure = normalized(features.earlyFocusBlockedAttemptCount, 6);
  const lateFocusBlockPressure = normalized(features.lateFocusBlockedAttemptCount, 4);
  const goToBreakNowPressure = normalized(features.goToBreakNowCount, 3);
  const earlyGoToBreakPressure = normalized(features.earlyGoToBreakNowCount, 2);
  const lateGoToBreakPressure = normalized(features.lateGoToBreakNowCount, 2);
  const earlyBreakSuccessPressure = normalized(features.startFocusNowSuccessCount, 3);
  const earlyBreakFailurePressure = normalized(features.startFocusNowFailureCount, 2);
  const breakOvertimeBlockPressure = normalized(features.breakOvertimeBlockedAttemptCount, 3);
  const skippedBreakFailurePressure = normalized(
    features.skippedBreakNextFocusFailureCount + features.skippedLongBreakNextFocusFailureCount,
    3,
  );
  const manualPausePressure = normalized(
    features.manualPauseCount + features.manualPauseSeconds / 900,
    4,
  );
  const blockedPressure = normalized(
    features.focusBlockedAttemptCount + features.blockedBurstCount * 2,
    8,
  );
  const breakOvertimePressure = normalized(
    features.shortBreakOvertimeSeconds / 180 + features.longBreakOvertimeSeconds / 300,
    4,
  );
  const skippedBreakPressure = normalized(features.breakSkippedCount, 3);
  const breakDrift = normalized(features.shortBreakOvertimeSeconds / 120, 3);
  const stopPressure = normalized(features.stopCount, 2);
  const confidencePenalty = dataQualityPenalty(features);

  const strain = clamp01(
    failureRate * 0.24 +
      failureIntensity * 0.34 +
      lateFailurePressure * 0.1 +
      idlePressure * 0.22 +
      focusIdlePressure * 0.08 +
      earlyFocusIdlePressure * 0.1 +
      lateFocusIdlePressure * 0.08 +
      lateFocusBlockPressure * 0.08 +
      goToBreakNowPressure * 0.1 +
      earlyGoToBreakPressure * 0.12 +
      lateGoToBreakPressure * 0.08 +
      earlyBreakFailurePressure * 0.08 +
      skippedBreakFailurePressure * 0.1 +
      manualPausePressure * 0.12 +
      blockedPressure * 0.18 +
      stopPressure * 0.08,
  );
  const avoidancePressure = clamp01(
    blockedPressure * 0.72 +
      repeatedBlockedSourcePressure * 0.22 +
      earlyFocusBlockPressure * 0.16 +
      normalized(features.breakBlockedAttemptCount, 6) * 0.16 +
      breakOvertimeBlockPressure * 0.2 +
      stopPressure * 0.12,
  );
  const recoveryDebt = clamp01(
    skippedBreakPressure * 0.32 +
      breakOvertimePressure * 0.26 +
      failureRate * 0.22 +
      lateFailureRate * 0.12 +
      focusIdlePressure * 0.06 +
      lateFocusIdlePressure * 0.12 +
      lateFocusBlockPressure * 0.12 +
      goToBreakNowPressure * 0.08 +
      earlyGoToBreakPressure * 0.08 +
      lateGoToBreakPressure * 0.12 +
      earlyBreakFailurePressure * 0.12 +
      breakOvertimeBlockPressure * 0.14 +
      skippedBreakFailurePressure * 0.2 +
      breakDrift * 0.12 +
      stopPressure * 0.08,
  );
  const momentum = clamp01(
    cleanCompletionRate * 0.52 +
      normalized(features.cleanFocusSeconds / 60, 120) * 0.2 +
      earlyBreakSuccessPressure * 0.06 +
      Math.max(0, 1 - blockedPressure) * 0.14 +
      Math.max(0, 1 - breakOvertimePressure) * 0.14 -
      recoveryDebt * 0.25,
  );
  const readiness = clamp01(
    momentum * 0.55 +
      cleanCompletionRate * 0.25 +
      normalized(features.extensionCount, 3) * 0.1 +
      earlyBreakSuccessPressure * 0.08 -
      strain * 0.28 -
      recoveryDebt * 0.22,
  );
  const confidence = clamp01(
    normalized(features.comparableOpportunityCount, 12) * 0.68 +
      normalized(focusAttempts, 8) * 0.22 +
      normalized(breakAttempts, 6) * 0.1 -
      confidencePenalty,
  );

  return {
    readiness,
    strain,
    recoveryDebt,
    avoidancePressure,
    momentum,
    confidence,
  };
}

function dataQualityPenalty(features: AdaptiveFeatureVector): number {
  return features.dataQualityFlags.reduce((penalty, flag) => {
    if (flag === "extension_unavailable") return penalty + 0.18;
    if (flag === "desktop_tracking_unavailable") return penalty + 0.06;
    if (flag === "diary_missing") return penalty + 0.04;
    if (flag === "idle_detection_disabled") return penalty + 0.08;
    if (flag === "crash_recovered") return penalty + 0.14;
    return penalty + 0.04;
  }, 0);
}

function blend(previous: number, current: number): number {
  return clamp01(previous * STATE_DECAY + current * (1 - STATE_DECAY));
}

function normalized(value: number, scale: number): number {
  if (scale <= 0) return 0;
  return clamp01(value / scale);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export const EMPTY_ADAPTIVE_STATE = EMPTY_STATE;
