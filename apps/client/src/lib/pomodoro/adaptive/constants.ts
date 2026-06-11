import type { CountPomodoroRhythm } from "$lib/pomodoro/rhythm";

export const ADAPTIVE_BASELINE_RHYTHM: CountPomodoroRhythm = {
  kind: "count",
  focusDurationMinutes: 40,
  shortBreakMinutes: 5,
  longBreakMinutes: 10,
  longBreakAfterFocusCount: 4,
};

export const MIN_ADAPTIVE_FOCUS_MINUTES = 15;
export const NORMAL_MIN_ADAPTIVE_FOCUS_MINUTES = 25;
export const MAX_ADAPTIVE_FOCUS_MINUTES = 60;
export const FOCUS_STEP_MINUTES = 5;

export const MIN_ADAPTIVE_SHORT_BREAK_MINUTES = 3;
export const MAX_ADAPTIVE_SHORT_BREAK_MINUTES = 12;
export const SHORT_BREAK_DRIFT_STEP_MINUTES = 2;

export const MIN_ADAPTIVE_LONG_BREAK_MINUTES = 10;
export const MAX_ADAPTIVE_LONG_BREAK_MINUTES = 30;
export const LONG_BREAK_STEP_MINUTES = 5;

export const MIN_ADAPTIVE_LONG_BREAK_CADENCE = 2;
export const MAX_ADAPTIVE_LONG_BREAK_CADENCE = 5;

export const LOW_CONFIDENCE_THRESHOLD = 0.25;
export const MODERATE_CONFIDENCE_THRESHOLD = 0.5;
export const HIGH_STRAIN_THRESHOLD = 0.58;
export const HIGH_AVOIDANCE_THRESHOLD = 0.58;
export const HIGH_RECOVERY_DEBT_THRESHOLD = 0.58;
export const HIGH_MOMENTUM_THRESHOLD = 0.68;
export const LOW_RISK_THRESHOLD = 0.35;

export const BLOCK_BURST_WINDOW_SECONDS = 10 * 60;
export const BLOCK_BURST_MIN_ATTEMPTS = 3;
export const SHORT_BREAK_DRIFT_SECONDS = 2 * 60;
export const LONG_BREAK_DRIFT_SECONDS = 5 * 60;

export const STATE_DECAY = 0.55;
