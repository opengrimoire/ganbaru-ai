import type { PomodoroPhase } from "@ganbaru-ai/shared-types";

// Types

export interface PomodoroConfig {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
}

/** Read-only snapshot of timer state, passed to pure decision functions. */
export interface TimerSnapshot {
  phase: PomodoroPhase;
  remainingSeconds: number;
  currentCycle: number;
  totalCycles: number;
  config: PomodoroConfig;
  skipNextBreak: boolean;
  notificationShown: boolean;
  phaseEndTime: number | null;
  activeBlockEndMs: number | null;
  lastTickMs: number | null;
}

// Constants

export const DEFAULT_CONFIG: PomodoroConfig = {
  focusMinutes: 40,
  shortBreakMinutes: 5,
  longBreakMinutes: 10,
  cyclesBeforeLongBreak: 4,
};

export const TIME_MULTIPLIER = 60;
export const SUSPEND_THRESHOLD_MS = 15_000;
export const NOTIFICATION_THRESHOLD = 60;
export const BREAK_EXTENSION_SECONDS = 60;
export const MAX_BREAK_EXTENSION_SECONDS = 180;
export const BREAK_OVERTIME_RAIL_GRACE_SECONDS = 10;
export const MAX_BREAK_OVERTIME_SECONDS = 1800;
export const IDLE_ALERT_INTERVAL_SECONDS = 10;
export const IDLE_FOCUS_FAILURE_DELAY_SECONDS = 60;
export const BREAK_FINISHED_ALERT_INTERVAL_SECONDS = 10;
export const IDLE_CHECK_MIN_INTERVAL_MS = 1_000;
export const IDLE_CHECK_MAX_INTERVAL_MS = 15_000;

// Utility functions

export function configEquals(a: PomodoroConfig, b: PomodoroConfig): boolean {
  return (
    a.focusMinutes === b.focusMinutes &&
    a.shortBreakMinutes === b.shortBreakMinutes &&
    a.longBreakMinutes === b.longBreakMinutes &&
    a.cyclesBeforeLongBreak === b.cyclesBeforeLongBreak
  );
}

export function phaseDurationSeconds(
  phase: PomodoroPhase,
  config: PomodoroConfig,
): number {
  if (phase === "focus") return config.focusMinutes * TIME_MULTIPLIER;
  if (phase === "short_break") return config.shortBreakMinutes * TIME_MULTIPLIER;
  return config.longBreakMinutes * TIME_MULTIPLIER;
}

export function limitRemainingSecondsToBlockEnd(
  remainingSeconds: number,
  activeBlockEndMs: number | null,
  nowMs: number,
): number {
  const normalizedRemaining = Math.max(0, Math.ceil(remainingSeconds));
  if (activeBlockEndMs === null) return normalizedRemaining;
  const blockRemainingSeconds = Math.max(
    0,
    Math.ceil((activeBlockEndMs - nowMs) / 1000),
  );
  return Math.min(normalizedRemaining, blockRemainingSeconds);
}

export interface PomodoroSessionActiveInput {
  activeBlockId: string | null;
  activeBlockEndMs: number | null;
  blockExpired: boolean;
  isRunning: boolean;
  remainingSeconds: number;
  totalSeconds: number;
  nowMs: number;
}

export function isPomodoroSessionActive(
  input: PomodoroSessionActiveInput,
): boolean {
  if (input.activeBlockId !== null) {
    if (input.blockExpired) return false;
    if (input.activeBlockEndMs !== null) {
      return input.nowMs < input.activeBlockEndMs;
    }
    return input.isRunning || input.remainingSeconds < input.totalSeconds;
  }

  return input.isRunning || input.remainingSeconds < input.totalSeconds;
}

// decideTick

export type TickResult =
  | {
      kind: "suspend_and_block_expired";
      preSuspendRemainingSeconds: number;
      suspendStartIso: string;
      suspendEndIso: string;
      awaySeconds: number;
    }
  | {
      kind: "suspend_block_active";
      preSuspendRemainingSeconds: number;
      newPhaseEndTime: number;
      suspendStartIso: string;
      suspendEndIso: string;
      awaySeconds: number;
    }
  | { kind: "block_expired" }
  | { kind: "break_finished" }
  | { kind: "focus_finished" }
  | { kind: "countdown_with_notification"; remainingSeconds: number }
  | { kind: "countdown"; remainingSeconds: number };

/**
 * Pure function that decides what action to take on each timer tick.
 * Handles suspend/wake detection, block expiry, phase completion, and notifications.
 * @param snapshot - Current timer state snapshot.
 * @param nowMs - Current timestamp in milliseconds.
 * @returns Action to take based on timer state.
 */
export function decideTick(snapshot: TimerSnapshot, nowMs: number): TickResult {
  // 1. Suspend/wake detection (highest priority)
  if (
    snapshot.lastTickMs !== null &&
    nowMs - snapshot.lastTickMs > SUSPEND_THRESHOLD_MS
  ) {
    const suspendStartIso = new Date(snapshot.lastTickMs).toISOString();
    const suspendEndIso = new Date(nowMs).toISOString();
    const awaySeconds = Math.round((nowMs - snapshot.lastTickMs) / 1000);

    const preSuspendRemainingSeconds =
      snapshot.phaseEndTime !== null
        ? Math.max(0, Math.ceil((snapshot.phaseEndTime - snapshot.lastTickMs) / 1000))
        : 0;

    if (
      snapshot.activeBlockEndMs !== null &&
      nowMs >= snapshot.activeBlockEndMs
    ) {
      return {
        kind: "suspend_and_block_expired",
        preSuspendRemainingSeconds,
        suspendStartIso,
        suspendEndIso,
        awaySeconds,
      };
    }

    return {
      kind: "suspend_block_active",
      preSuspendRemainingSeconds,
      newPhaseEndTime: nowMs + preSuspendRemainingSeconds * 1000,
      suspendStartIso,
      suspendEndIso,
      awaySeconds,
    };
  }

  // 2. Block expiry
  if (
    snapshot.activeBlockEndMs !== null &&
    nowMs >= snapshot.activeBlockEndMs
  ) {
    return { kind: "block_expired" };
  }

  // 3. Compute remaining seconds
  const remainingSeconds =
    snapshot.phaseEndTime !== null
      ? Math.max(0, Math.ceil((snapshot.phaseEndTime - nowMs) / 1000))
      : snapshot.remainingSeconds;

  // 4. Timer at zero
  if (remainingSeconds <= 0) {
    if (snapshot.phase === "short_break" || snapshot.phase === "long_break") {
      return { kind: "break_finished" };
    }
    return { kind: "focus_finished" };
  }

  // 5. Notification check (focus phase, exactly at threshold, not shown)
  if (
    snapshot.phase === "focus" &&
    remainingSeconds === NOTIFICATION_THRESHOLD &&
    !snapshot.notificationShown
  ) {
    return { kind: "countdown_with_notification", remainingSeconds };
  }

  // 6. Normal countdown
  return { kind: "countdown", remainingSeconds };
}

// decideAdvancePhase

export type AdvancePhaseResult =
  | {
      kind: "skip_break_to_focus";
      remainingSeconds: number;
      nextCycle: number;
    }
  | {
      kind: "focus_to_long_break";
      remainingSeconds: number;
      nextCycle: 1;
    }
  | {
      kind: "focus_to_short_break";
      remainingSeconds: number;
      nextCycle: number;
    }
  | {
      kind: "break_to_focus";
      remainingSeconds: number;
    };

/**
 * Pure function that decides the next phase when the current phase completes.
 * Handles skip-break preference and long break cycle logic.
 * @param snapshot - Current timer state snapshot.
 * @returns Next phase and its duration.
 */
export function decideAdvancePhase(snapshot: TimerSnapshot): AdvancePhaseResult {
  if (snapshot.phase === "focus") {
    if (snapshot.skipNextBreak) {
      const nextCycle =
        snapshot.currentCycle < snapshot.totalCycles
          ? snapshot.currentCycle + 1
          : 1;
      return {
        kind: "skip_break_to_focus",
        remainingSeconds: snapshot.config.focusMinutes * TIME_MULTIPLIER,
        nextCycle,
      };
    }

    if (snapshot.currentCycle >= snapshot.totalCycles) {
      return {
        kind: "focus_to_long_break",
        remainingSeconds: snapshot.config.longBreakMinutes * TIME_MULTIPLIER,
        nextCycle: 1,
      };
    }

    return {
      kind: "focus_to_short_break",
      remainingSeconds: snapshot.config.shortBreakMinutes * TIME_MULTIPLIER,
      nextCycle: snapshot.currentCycle + 1,
    };
  }

  // Break -> focus
  return {
    kind: "break_to_focus",
    remainingSeconds: snapshot.config.focusMinutes * TIME_MULTIPLIER,
  };
}

// decideTransition

export interface TransitionInput {
  previousConfig: PomodoroConfig;
  newConfig: PomodoroConfig;
  phase: PomodoroPhase;
  remainingSeconds: number;
  elapsedFocusSeconds?: number;
  currentCycle: number;
  blockExpired: boolean;
}

export type TransitionResult =
  | {
      kind: "trigger_break";
      breakPhase: "short_break" | "long_break";
      breakDurationSeconds: number;
      nextCycle: number;
      accumulatedFocusSeconds: number;
    }
  | {
      kind: "continue_focus";
      remainingSeconds: number;
      resetNotification: boolean;
    }
  | {
      kind: "fresh_start";
      remainingSeconds: number;
    }
  | { kind: "keep_break" };

/**
 * Pure function that decides how to handle a config change during an active session.
 * May trigger an early break if accumulated focus exceeds new threshold.
 * @param input - Current state and new config.
 * @returns Transition action (trigger break, continue, fresh start, or keep break).
 */
export function decideTransition(input: TransitionInput): TransitionResult {
  if (input.phase === "focus") {
    const oldFocusSec = input.previousConfig.focusMinutes * TIME_MULTIPLIER;
    const accumulatedFocusSec = Math.max(
      0,
      input.elapsedFocusSeconds ?? oldFocusSec - input.remainingSeconds,
    );
    const newFocusThresholdSec = input.newConfig.focusMinutes * TIME_MULTIPLIER;

    if (accumulatedFocusSec >= newFocusThresholdSec) {
      const isLong = input.currentCycle >= input.newConfig.cyclesBeforeLongBreak;
      return {
        kind: "trigger_break",
        breakPhase: isLong ? "long_break" : "short_break",
        breakDurationSeconds: isLong
          ? input.newConfig.longBreakMinutes * TIME_MULTIPLIER
          : input.newConfig.shortBreakMinutes * TIME_MULTIPLIER,
        nextCycle: isLong ? 1 : input.currentCycle + 1,
        accumulatedFocusSeconds: accumulatedFocusSec,
      };
    }

    return {
      kind: "continue_focus",
      remainingSeconds: newFocusThresholdSec - accumulatedFocusSec,
      resetNotification:
        newFocusThresholdSec - accumulatedFocusSec > NOTIFICATION_THRESHOLD,
    };
  }

  // Break phase
  if (input.blockExpired) {
    return {
      kind: "fresh_start",
      remainingSeconds: input.newConfig.focusMinutes * TIME_MULTIPLIER,
    };
  }

  return { kind: "keep_break" };
}

// decideStartFromBlock

export interface StartFromBlockInput {
  currentBlockId: string | null;
  incomingBlockId: string;
  incomingConfig: PomodoroConfig;
  currentConfig: PomodoroConfig;
  currentEndMs: number | null;
  incomingEndMs: number | null;
  hasOvertimeInterval: boolean;
}

export type StartFromBlockResult =
  | { kind: "noop" }
  | { kind: "update_end_only"; newEndMs: number }
  | { kind: "reconfigure"; newConfig: PomodoroConfig; newEndMs: number }
  | { kind: "rebuild_segments"; newEndMs: number }
  | { kind: "transition"; newConfig: PomodoroConfig; newEndMs: number }
  | { kind: "new_session"; newConfig: PomodoroConfig; newEndMs: number | null };

/**
 * Pure function that decides how to handle a calendar block becoming active.
 * Determines whether to start new session, transition, reconfigure, or do nothing.
 * @param input - Current block state and incoming block info.
 * @returns Action to take (noop, update end, reconfigure, rebuild, transition, or new session).
 */
export function decideStartFromBlock(
  input: StartFromBlockInput,
): StartFromBlockResult {
  if (input.currentBlockId === input.incomingBlockId) {
    // Same block
    if (input.incomingEndMs === null) return { kind: "noop" };

    const cfgChanged = !configEquals(input.currentConfig, input.incomingConfig);
    const endChanged = input.currentEndMs !== input.incomingEndMs;

    if (!cfgChanged && !endChanged) return { kind: "noop" };

    if (input.hasOvertimeInterval) {
      return { kind: "update_end_only", newEndMs: input.incomingEndMs };
    }

    if (cfgChanged) {
      return {
        kind: "reconfigure",
        newConfig: input.incomingConfig,
        newEndMs: input.incomingEndMs,
      };
    }

    return { kind: "rebuild_segments", newEndMs: input.incomingEndMs };
  }

  // Different block
  if (input.currentBlockId !== null && input.incomingEndMs !== null) {
    return {
      kind: "transition",
      newConfig: input.incomingConfig,
      newEndMs: input.incomingEndMs,
    };
  }

  // New session (no active block, or missing end time for transition)
  return {
    kind: "new_session",
    newConfig: input.incomingConfig,
    newEndMs: input.incomingEndMs,
  };
}

// decideReconfigure

export interface ReconfigureInput {
  phase: PomodoroPhase;
  remainingSeconds: number;
  elapsedSeconds?: number;
  currentConfig: PomodoroConfig;
  newConfig: PomodoroConfig;
  hasOvertimeInterval: boolean;
}

export interface ReconfigureResult {
  newRemainingSeconds: number;
  exitOvertime: boolean;
  resetNotification: boolean;
}

/**
 * Pure function that recalculates remaining time when config changes mid-phase.
 * Preserves elapsed time and adjusts remaining based on new duration.
 * @param input - Current phase state and new config.
 * @returns New remaining seconds and flags for overtime/notification reset.
 */
export function decideReconfigure(input: ReconfigureInput): ReconfigureResult {
  const oldDuration = phaseDurationSeconds(input.phase, input.currentConfig);
  const elapsed = Math.max(
    0,
    input.elapsedSeconds ?? oldDuration - input.remainingSeconds,
  );

  const newDuration = phaseDurationSeconds(input.phase, input.newConfig);
  const newRemaining = Math.max(0, newDuration - elapsed);

  return {
    newRemainingSeconds: newRemaining,
    exitOvertime: input.hasOvertimeInterval && newRemaining > 0,
    resetNotification:
      input.phase === "focus" && newRemaining > NOTIFICATION_THRESHOLD,
  };
}

// decideIdleCheck

export interface IdleCheckInput {
  isRunning: boolean;
  phase: PomodoroPhase;
  suspendedAway: boolean;
  idlePaused: boolean;
  idleTimeoutMs: number | null;
  webcamInUse: boolean;
  idleMs: number;
  phaseEndTime: number | null;
}

export type IdleCheckResult =
  | { kind: "skip" }
  | {
      kind: "trigger_idle";
      idleSeconds: number;
      preSuspendRemainingSeconds: number;
      idleStartMs: number;
    };

/**
 * Pure function that checks if user has been idle long enough to trigger auto-pause.
 * Only triggers during focus phase when not already paused and webcam is not in use.
 * @param input - Current idle detection state.
 * @param nowMs - Current timestamp in milliseconds.
 * @returns Skip or trigger idle pause with timing info.
 */
export function decideIdleCheck(
  input: IdleCheckInput,
  nowMs: number,
): IdleCheckResult {
  if (!input.isRunning) return { kind: "skip" };
  if (input.phase !== "focus") return { kind: "skip" };
  if (input.suspendedAway) return { kind: "skip" };
  if (input.idlePaused) return { kind: "skip" };
  if (input.idleTimeoutMs === null) return { kind: "skip" };
  if (input.webcamInUse) return { kind: "skip" };

  if (input.idleMs >= input.idleTimeoutMs) {
    const idleStartMs = nowMs - input.idleMs;
    const preSuspendRemainingSeconds =
      input.phaseEndTime !== null
        ? Math.max(0, Math.ceil((input.phaseEndTime - idleStartMs) / 1000))
        : 0;

    return {
      kind: "trigger_idle",
      idleSeconds: Math.round(input.idleMs / 1000),
      preSuspendRemainingSeconds,
      idleStartMs,
    };
  }

  return { kind: "skip" };
}

export function nextIdleCheckDelayMs({
  idleTimeoutMs,
  idleMs,
  webcamInUse,
  minIntervalMs = IDLE_CHECK_MIN_INTERVAL_MS,
  maxIntervalMs = IDLE_CHECK_MAX_INTERVAL_MS,
}: {
  idleTimeoutMs: number;
  idleMs: number;
  webcamInUse: boolean;
  minIntervalMs?: number;
  maxIntervalMs?: number;
}): number {
  const minMs = Math.max(1, Math.floor(minIntervalMs));
  const maxMs = Math.max(minMs, Math.floor(maxIntervalMs));
  if (webcamInUse) return maxMs;

  const remainingMs = idleTimeoutMs - idleMs;
  if (remainingMs <= 0) return minMs;
  return Math.min(maxMs, Math.max(minMs, Math.ceil(remainingMs)));
}

export function shouldTriggerIdleFocusFailure(overlayElapsedSeconds: number): boolean {
  return overlayElapsedSeconds >= IDLE_FOCUS_FAILURE_DELAY_SECONDS;
}

export function shouldPlayRepeatingSoundAtElapsedSecond(
  elapsedSeconds: number,
  intervalSeconds: number,
): boolean {
  if (elapsedSeconds < 0) return false;
  if (elapsedSeconds === 0) return true;
  if (intervalSeconds <= 0) return false;
  return elapsedSeconds % intervalSeconds === 0;
}
