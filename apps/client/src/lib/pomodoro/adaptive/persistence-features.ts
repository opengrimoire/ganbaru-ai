import type {
  AdaptiveDataQualityFlag,
  AdaptiveFeatureSourceKind,
  AdaptiveFeatureVector,
} from "./types";
import type { PomodoroAdaptiveFeatureWrite } from "./persistence-types";

export function featureWrites(features: AdaptiveFeatureVector): PomodoroAdaptiveFeatureWrite[] {
  return [
    numericFeature("completed_focus_segments", features.completedFocusSegments, "pomodoro"),
    numericFeature("interrupted_focus_segments", features.interruptedFocusSegments, "pomodoro"),
    numericFeature("focus_failure_count", features.focusFailureCount, "pomodoro"),
    numericFeature("late_focus_segment_count", features.lateFocusSegmentCount, "pomodoro"),
    numericFeature("late_focus_failure_count", features.lateFocusFailureCount, "pomodoro"),
    numericFeature("clean_focus_seconds", features.cleanFocusSeconds, "pomodoro"),
    numericFeature("planned_focus_seconds", features.plannedFocusSeconds, "pomodoro"),
    numericFeature("idle_pause_count", features.idlePauseCount, "pomodoro"),
    numericFeature("idle_pause_seconds", features.idlePauseSeconds, "pomodoro"),
    numericFeature("focus_idle_pause_count", features.focusIdlePauseCount, "pomodoro"),
    numericFeature("focus_idle_pause_seconds", features.focusIdlePauseSeconds, "pomodoro"),
    numericFeature("early_focus_idle_pause_count", features.earlyFocusIdlePauseCount, "pomodoro"),
    numericFeature("late_focus_idle_pause_count", features.lateFocusIdlePauseCount, "pomodoro"),
    numericFeature("manual_pause_count", features.manualPauseCount, "pomodoro"),
    numericFeature("manual_pause_seconds", features.manualPauseSeconds, "pomodoro"),
    numericFeature("suspend_pause_count", features.suspendPauseCount, "pomodoro"),
    numericFeature("suspend_pause_seconds", features.suspendPauseSeconds, "pomodoro"),
    numericFeature("break_started_count", features.breakStartedCount, "pomodoro"),
    numericFeature("break_completed_count", features.breakCompletedCount, "pomodoro"),
    numericFeature("break_skipped_count", features.breakSkippedCount, "pomodoro"),
    numericFeature(
      "skipped_break_next_focus_success_count",
      features.skippedBreakNextFocusSuccessCount,
      "pomodoro",
    ),
    numericFeature(
      "skipped_break_next_focus_failure_count",
      features.skippedBreakNextFocusFailureCount,
      "pomodoro",
    ),
    numericFeature(
      "skipped_short_break_next_focus_failure_count",
      features.skippedShortBreakNextFocusFailureCount,
      "pomodoro",
    ),
    numericFeature(
      "skipped_long_break_next_focus_failure_count",
      features.skippedLongBreakNextFocusFailureCount,
      "pomodoro",
    ),
    numericFeature("short_break_overtime_seconds", features.shortBreakOvertimeSeconds, "pomodoro"),
    numericFeature("long_break_overtime_seconds", features.longBreakOvertimeSeconds, "pomodoro"),
    numericFeature("blocked_attempt_count", features.blockedAttemptCount, "doomscrolling"),
    numericFeature("blocked_burst_count", features.blockedBurstCount, "doomscrolling"),
    numericFeature(
      "repeated_blocked_source_attempt_count",
      features.repeatedBlockedSourceAttemptCount,
      "doomscrolling",
    ),
    numericFeature(
      "focus_repeated_blocked_source_attempt_count",
      features.focusRepeatedBlockedSourceAttemptCount,
      "doomscrolling",
    ),
    numericFeature(
      "break_repeated_blocked_source_attempt_count",
      features.breakRepeatedBlockedSourceAttemptCount,
      "doomscrolling",
    ),
    numericFeature("focus_blocked_attempt_count", features.focusBlockedAttemptCount, "doomscrolling"),
    numericFeature(
      "early_focus_blocked_attempt_count",
      features.earlyFocusBlockedAttemptCount,
      "doomscrolling",
    ),
    numericFeature(
      "late_focus_blocked_attempt_count",
      features.lateFocusBlockedAttemptCount,
      "doomscrolling",
    ),
    numericFeature("break_blocked_attempt_count", features.breakBlockedAttemptCount, "doomscrolling"),
    numericFeature(
      "break_overtime_blocked_attempt_count",
      features.breakOvertimeBlockedAttemptCount,
      "doomscrolling",
    ),
    numericFeature(
      "short_break_overtime_blocked_attempt_count",
      features.shortBreakOvertimeBlockedAttemptCount,
      "doomscrolling",
    ),
    numericFeature(
      "long_break_overtime_blocked_attempt_count",
      features.longBreakOvertimeBlockedAttemptCount,
      "doomscrolling",
    ),
    numericFeature("extension_count", features.extensionCount, "pomodoro"),
    numericFeature("go_to_break_now_count", features.goToBreakNowCount, "pomodoro"),
    numericFeature("early_go_to_break_now_count", features.earlyGoToBreakNowCount, "pomodoro"),
    numericFeature("late_go_to_break_now_count", features.lateGoToBreakNowCount, "pomodoro"),
    numericFeature("start_focus_now_count", features.startFocusNowCount, "pomodoro"),
    numericFeature("start_focus_now_success_count", features.startFocusNowSuccessCount, "pomodoro"),
    numericFeature("start_focus_now_failure_count", features.startFocusNowFailureCount, "pomodoro"),
    numericFeature("stop_count", features.stopCount, "pomodoro"),
    numericFeature("comparable_opportunity_count", features.comparableOpportunityCount, "pomodoro"),
  ];
}

export function dedupeDataQualityFlags(
  flags: readonly AdaptiveDataQualityFlag[],
): AdaptiveDataQualityFlag[] {
  return [...new Set(flags)];
}

function numericFeature(
  featureKey: string,
  numericValue: number,
  sourceKind: AdaptiveFeatureSourceKind,
): PomodoroAdaptiveFeatureWrite {
  return {
    featureKey,
    numericValue,
    categoricalValue: null,
    booleanValue: null,
    missing: false,
    sourceKind,
  };
}
