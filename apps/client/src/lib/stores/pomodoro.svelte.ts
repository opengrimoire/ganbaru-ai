import type { PomodoroPhase } from "@ganbaru-ai/shared-types";
import type {
  PersistedSegment,
  SegmentPhase,
} from "$lib/components/calendar/types";
import { writeDoomscrollingRuntimeState } from "$lib/api/doomscrolling";
import {
  breakAfterFocusPosition,
  clonePomodoroConfig,
  focusDurationMinutesAtPosition,
  nextRhythmPosition,
  normalizeRhythmPosition,
  phaseDurationMinutesAtPosition,
  rhythmPositionCount,
} from "$lib/pomodoro/rhythm";
import {
  type PomodoroAdaptivePlannedBlockWrite,
  type PomodoroBoundaryAdaptiveDecision,
  type PomodoroRunStartAdaptiveDecision,
} from "$lib/pomodoro/adaptive/persistence";
import {
  nowIso,
  type PomodoroBackendWriteOptions,
  type PomodoroRunClosure,
  type PomodoroRunEndReason,
  type PomodoroRunEventType,
  type PomodoroSegmentEndReason,
} from "./pomodoro-backend-writes";
import { createPomodoroRunRepository } from "./pomodoro-run-repository";
import { createPomodoroEffects } from "./pomodoro-effects.svelte";
import { createPomodoroWindowCoordinator } from "./pomodoro-window-coordinator";
import { createPomodoroSegmentController } from "./pomodoro-segment-controller";
import { createPomodoroIdleController } from "./pomodoro-idle-controller";
import {
  decideBoundaryAdaptiveForState,
  isAdaptiveCountConfig,
} from "./pomodoro-adaptive-decisions";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type PomodoroConfig,
  type TimerSnapshot,
  DEFAULT_CONFIG,
  TIME_MULTIPLIER,
  BREAK_EXTENSION_SECONDS,
  MAX_BREAK_EXTENSION_SECONDS,
  BREAK_OVERTIME_RAIL_GRACE_SECONDS,
  MAX_BREAK_OVERTIME_SECONDS,
  limitRemainingSecondsToBlockEnd,
  phaseDurationSeconds,
  isPomodoroSessionActive,
  canPauseResumePomodoro,
  decideTick,
  decideAdvancePhase,
  decideTransition,
  decideStartFromBlock,
  decideReconfigure,
} from "./pomodoro-machine";
import {
  cloneSegmentsForWindowSync,
  type IdlePauseState,
  type PomodoroWindowCommand,
  type PomodoroWindowSnapshot,
} from "./pomodoro-window-sync";

const PAUSED_FOCUS_NOTIFICATION_RESUME_EVENT = "pomodoro-paused-focus-resume";
const PAUSED_FOCUS_NOTIFICATION_STOP_ASKING_EVENT =
  "pomodoro-paused-focus-stop-asking";
const pomodoroCoordinator = getCurrentWindow().label === "main";

const DEFAULT_FOCUS_SECONDS = focusDurationMinutesAtPosition(DEFAULT_CONFIG, 1) * TIME_MULTIPLIER;

let phase = $state<PomodoroPhase>("focus");
let remainingSeconds = $state(DEFAULT_FOCUS_SECONDS);
let phaseTotalSeconds = $state(DEFAULT_FOCUS_SECONDS);
let phaseElapsedSeconds = 0;
let phaseWorkDurationSeconds = DEFAULT_FOCUS_SECONDS;
let currentRhythmPosition = $state(1);
let isRunning = $state(false);
let config = $state<PomodoroConfig>(clonePomodoroConfig(DEFAULT_CONFIG));
let intervalId: ReturnType<typeof setInterval> | null = null;
let pausedOpportunityIntervalId: ReturnType<typeof setInterval> | null = null;
let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
let phaseAdvanceInFlight = false;
let completedPomodoros = $state(0);
let sessionStartTime: string | null = null;
let skipNextBreak = false;
let listenersInitialized = false;
let notificationShown = false;
let focusExtensionUsed = false;
let phaseEndTime: number | null = null;
let activeBlockId = $state<string | null>(null);
let activeRunId = $state<string | null>(null);
let activeBlockEndMs = $state<number | null>(null);
let dismissedBlockId = $state<string | null>(null);
let autoStartSuppressed = $state(false);
const FOCUS_EXTENSION_SECONDS = 180;
const HEARTBEAT_INTERVAL_MS = 30_000;

// Segment tracking state
let segments = $state<PersistedSegment[]>([]);
let currentSegmentIndex = -1;
const segmentEndReasons = new Map<string, PomodoroSegmentEndReason>();

// Bumped after DB writes to persisted segments complete, so DayColumn re-fetches.
let segmentVersion = $state(0);

// Tracks seconds elapsed after a break timer reaches 0 but before user acknowledgment.
// Reactive ($state) so the rail derived recomputes during the grace window.
let breakOvertimeSeconds = $state(0);
let overtimeIntervalId: ReturnType<typeof setInterval> | null = null;
let overtimeAlertIntervalId: ReturnType<typeof setInterval> | null = null;

// Block expiry: set when the calendar event ends naturally (via tick).
// Keeps activeBlockId intact so the next checkActiveBlock can trigger
// transitionToBlock for focus inheritance to a successor block.
let blockExpired = $state(false);

// Suspend/wake detection
let lastTickMs: number | null = null;
let suspendedAway = $state<{ awaySeconds: number } | null>(null);

// Idle detection
let idleTimeoutMs: number | null = null; // null = disabled
let idlePaused = $state<IdlePauseState | null>(null);
let lastDoomscrollingStateKey = "";

type DoomscrollingPauseReason = "manual" | "idle" | "suspend";

function currentDoomscrollingPauseReason(paused: boolean): DoomscrollingPauseReason | null {
  if (!paused) return null;
  if (idlePaused) return "idle";
  if (suspendedAway) return "suspend";
  return "manual";
}

function writeCurrentDoomscrollingRuntimeState(force = false): void {
  if (!pomodoroCoordinator) return;
  const minuteBucket = Math.ceil(remainingSeconds / 60);
  const active = pomodoroSessionActive();
  const paused = active && !isRunning;
  const pauseReason = currentDoomscrollingPauseReason(paused);
  const stateKey = [
    active ? "1" : "0",
    paused ? "1" : "0",
    pauseReason ?? "",
    active ? phase : "inactive",
    activeRunId ?? "",
    activeBlockId ?? "",
    String(minuteBucket),
  ].join("|");
  if (!force && stateKey === lastDoomscrollingStateKey) return;
  lastDoomscrollingStateKey = stateKey;

  writeDoomscrollingRuntimeState({
    active,
    paused,
    pauseReason,
    phase: active ? phase : "inactive",
    activeRunId,
    activeBlockId,
    remainingSeconds: active ? remainingSeconds : null,
    updatedAt: nowIso(),
  }).catch((err) => console.warn("doomscrolling state write failed", err));
}

// Snapshot builder

function buildSnapshot(): TimerSnapshot {
  return {
    phase,
    remainingSeconds,
    currentRhythmPosition,
    config,
    skipNextBreak,
    notificationShown,
    phaseEndTime,
    activeBlockEndMs,
    lastTickMs,
  };
}

function buildWindowSnapshot(): PomodoroWindowSnapshot {
  return {
    phase,
    remainingSeconds,
    phaseTotalSeconds,
    phaseWorkDurationSeconds,
    currentRhythmPosition,
    totalRhythmPositions: rhythmPositionCount(config),
    isRunning,
    config: clonePomodoroConfig(config),
    completedPomodoros,
    activeBlockId,
    activeRunId,
    activeBlockEndMs,
    dismissedBlockId,
    breakOvertimeSeconds,
    segments: cloneSegmentsForWindowSync(segments),
    segmentVersion,
    blockExpired,
    focusExtensionUsed,
    suspendedAway: suspendedAway ? { ...suspendedAway } : null,
    idlePaused: idlePaused ? { ...idlePaused } : null,
  };
}

function applyWindowSnapshot(snapshot: PomodoroWindowSnapshot): void {
  if (pomodoroCoordinator) return;
  phase = snapshot.phase;
  remainingSeconds = snapshot.remainingSeconds;
  phaseTotalSeconds = snapshot.phaseTotalSeconds;
  phaseWorkDurationSeconds = snapshot.phaseWorkDurationSeconds;
  currentRhythmPosition = snapshot.currentRhythmPosition;
  isRunning = snapshot.isRunning;
  config = clonePomodoroConfig(snapshot.config);
  completedPomodoros = snapshot.completedPomodoros;
  activeBlockId = snapshot.activeBlockId;
  activeRunId = snapshot.activeRunId;
  activeBlockEndMs = snapshot.activeBlockEndMs;
  dismissedBlockId = snapshot.dismissedBlockId;
  breakOvertimeSeconds = snapshot.breakOvertimeSeconds;
  segments = cloneSegmentsForWindowSync(snapshot.segments);
  currentSegmentIndex = segments.findIndex((segment) => segment.status === "active");
  segmentVersion = snapshot.segmentVersion;
  blockExpired = snapshot.blockExpired;
  focusExtensionUsed = snapshot.focusExtensionUsed;
  suspendedAway = snapshot.suspendedAway ? { ...snapshot.suspendedAway } : null;
  idlePaused = snapshot.idlePaused ? { ...snapshot.idlePaused } : null;
}

const windowCoordinator = createPomodoroWindowCoordinator({
  isCoordinator: () => pomodoroCoordinator,
  beforePublishSnapshot: writeCurrentDoomscrollingRuntimeState,
  buildSnapshot: buildWindowSnapshot,
  applySnapshot: applyWindowSnapshot,
  handleCommand: handleWindowCommand,
});

function publishWindowSnapshot(): void {
  windowCoordinator.publishSnapshot();
}

function forwardWindowCommand(command: PomodoroWindowCommand): boolean {
  return windowCoordinator.forwardCommand(command);
}

// Segment helpers

function segmentEndReasonFor(seg: PersistedSegment): PomodoroSegmentEndReason | null {
  const explicit = segmentEndReasons.get(seg.id);
  if (explicit) return explicit;
  if (seg.status === "completed") return "completed";
  if (seg.status === "skipped") return "skipped_by_user";
  if (seg.status === "interrupted") return "stopped";
  return null;
}

const runRepository = createPomodoroRunRepository({
  endReasonForSegment: segmentEndReasonFor,
  completeWrite: completePomodoroBackendWrite,
});

function applyRunStartAdaptiveDecision(decision: PomodoroRunStartAdaptiveDecision): void {
  if (!isAdaptiveCountConfig(config)) return;
  config = {
    ...clonePomodoroConfig(config),
    rhythm: { ...decision.selectedRhythm },
  };
  currentRhythmPosition = normalizeRhythmPosition(config, currentRhythmPosition);
  if (phase !== "focus") return;
  const startedMs = Date.parse(decision.occurredAt);
  const nowMs = Number.isFinite(startedMs) ? startedMs : Date.now();
  setPhaseRemainingSeconds(
    focusDurationMinutesAtPosition(config, currentRhythmPosition) * TIME_MULTIPLIER,
    0,
    nowMs,
  );
  if (isRunning) {
    phaseEndTime = nowMs + remainingSeconds * 1000;
  }
}

function applyBoundaryAdaptiveDecision(decision: PomodoroBoundaryAdaptiveDecision | null): void {
  if (!decision || !isAdaptiveCountConfig(config)) return;
  config = {
    ...clonePomodoroConfig(config),
    rhythm: { ...decision.selectedRhythm },
  };
  currentRhythmPosition = normalizeRhythmPosition(config, currentRhythmPosition);
}

function runClosure(
  endedAt: string,
  endReason: PomodoroRunEndReason,
  segmentStatus: "completed" | "interrupted",
  segmentEndReason: PomodoroSegmentEndReason,
  eventType: PomodoroRunEventType,
): PomodoroRunClosure | null {
  if (!activeRunId) return null;
  const normalizedEndedAt = segmentController.normalizedActiveSegmentEndIso(endedAt);
  return {
    runId: activeRunId,
    endedAt: normalizedEndedAt,
    endReason,
    segmentStatus,
    segmentEndReason,
    eventType,
  };
}

async function closeActiveRun(
  endedAt: string,
  endReason: PomodoroRunEndReason,
  segmentStatus: "completed" | "interrupted",
  segmentEndReason: PomodoroSegmentEndReason,
  eventType: PomodoroRunEventType,
  throwOnError = false,
): Promise<void> {
  const closure = runClosure(endedAt, endReason, segmentStatus, segmentEndReason, eventType);
  stopHeartbeat();
  try {
    if (closure) await runRepository.closeRun(closure, "Failed to close pomodoro run:", throwOnError);
    activeRunId = null;
  } catch (error) {
    if (activeRunId) startHeartbeat();
    throw error;
  }
}

function actualPhaseElapsedSeconds(): number {
  return phaseElapsedSeconds;
}

function phaseWorkRemainingSeconds(): number {
  return Math.max(0, phaseWorkDurationSeconds - phaseElapsedSeconds);
}

function setPhaseRemainingSeconds(
  nextWorkRemainingSeconds: number,
  elapsedSeconds: number = 0,
  nowMs: number = Date.now(),
): number {
  const normalizedElapsedSeconds = Math.max(0, Math.ceil(elapsedSeconds));
  const normalizedWorkRemainingSeconds = Math.max(0, Math.ceil(nextWorkRemainingSeconds));
  const limitedRemaining = limitRemainingSecondsToBlockEnd(
    normalizedWorkRemainingSeconds,
    activeBlockEndMs,
    nowMs,
  );
  phaseElapsedSeconds = normalizedElapsedSeconds;
  phaseWorkDurationSeconds = normalizedElapsedSeconds + normalizedWorkRemainingSeconds;
  remainingSeconds = limitedRemaining;
  phaseTotalSeconds = normalizedElapsedSeconds + limitedRemaining;
  return limitedRemaining;
}

function setVisibleRemainingForPause(
  nextVisibleRemainingSeconds: number,
  elapsedSeconds: number,
  nowMs: number = Date.now(),
): number {
  const normalizedElapsedSeconds = Math.max(0, Math.ceil(elapsedSeconds));
  const limitedRemaining = limitRemainingSecondsToBlockEnd(
    nextVisibleRemainingSeconds,
    activeBlockEndMs,
    nowMs,
  );
  phaseElapsedSeconds = normalizedElapsedSeconds;
  remainingSeconds = limitedRemaining;
  phaseTotalSeconds = normalizedElapsedSeconds + limitedRemaining;
  return limitedRemaining;
}

function refreshCurrentPhaseLimit(nowMs: number = Date.now()): void {
  const elapsedSeconds = actualPhaseElapsedSeconds();
  const limitedRemaining = setPhaseRemainingSeconds(
    phaseWorkRemainingSeconds(),
    elapsedSeconds,
    nowMs,
  );
  if (isRunning) {
    phaseEndTime = nowMs + limitedRemaining * 1000;
  }
}

function recordRunningPhaseProgress(nextVisibleRemainingSeconds: number): void {
  const normalizedRemainingSeconds = Math.max(0, Math.ceil(nextVisibleRemainingSeconds));
  const elapsedDeltaSeconds = Math.max(0, remainingSeconds - normalizedRemainingSeconds);
  phaseElapsedSeconds = Math.min(
    phaseWorkDurationSeconds,
    phaseElapsedSeconds + elapsedDeltaSeconds,
  );
  remainingSeconds = normalizedRemainingSeconds;
}

function refreshPausedOpportunityRemaining(nowMs: number = Date.now()): boolean {
  const nextRemainingSeconds = limitRemainingSecondsToBlockEnd(
    phaseWorkRemainingSeconds(),
    activeBlockEndMs,
    nowMs,
  );
  if (nextRemainingSeconds === remainingSeconds) return false;
  remainingSeconds = nextRemainingSeconds;
  return true;
}

function activeBlockDeadlineReached(nowMs: number = Date.now()): boolean {
  return activeBlockEndMs !== null && nowMs >= activeBlockEndMs;
}

function pomodoroSessionActive(nowMs: number = Date.now()): boolean {
  return isPomodoroSessionActive({
    activeBlockId,
    activeBlockEndMs,
    blockExpired,
    isRunning,
    remainingSeconds,
    totalSeconds: phaseTotalSeconds,
    nowMs,
  });
}

function pausedFocusPulseActive(): boolean {
  return (
    phase === "focus" &&
    !isRunning &&
    !suspendedAway &&
    !idlePaused &&
    !overtimeIntervalId &&
    pomodoroSessionActive()
  );
}

const effects = createPomodoroEffects({
  isCoordinator: () => pomodoroCoordinator,
  phase: () => phase,
  remainingSeconds: () => remainingSeconds,
  totalSeconds: () => phaseTotalSeconds,
  isRunning: () => isRunning,
  phaseEndTime: () => phaseEndTime,
  isActive: () => pomodoroSessionActive(),
  canPauseResume: () => canPauseResumeSession(),
  canAddFocusTime: () => canExtendFocusTime(),
  pausedFocusPulseActive,
  notificationShown: () => notificationShown,
  setNotificationShown: (value) => {
    notificationShown = value;
  },
  publishWindowSnapshot,
  writeDoomscrollingRuntimeState: writeCurrentDoomscrollingRuntimeState,
  initListeners,
});

const segmentController = createPomodoroSegmentController({
  get phase() {
    return phase;
  },
  set phase(value) {
    phase = value;
  },
  get remainingSeconds() {
    return remainingSeconds;
  },
  set remainingSeconds(value) {
    remainingSeconds = value;
  },
  get currentRhythmPosition() {
    return currentRhythmPosition;
  },
  set currentRhythmPosition(value) {
    currentRhythmPosition = value;
  },
  get config() {
    return config;
  },
  set config(value) {
    config = value;
  },
  get isRunning() {
    return isRunning;
  },
  set isRunning(value) {
    isRunning = value;
  },
  get activeBlockId() {
    return activeBlockId;
  },
  set activeBlockId(value) {
    activeBlockId = value;
  },
  get activeRunId() {
    return activeRunId;
  },
  set activeRunId(value) {
    activeRunId = value;
  },
  get activeBlockEndMs() {
    return activeBlockEndMs;
  },
  set activeBlockEndMs(value) {
    activeBlockEndMs = value;
  },
  get idleTimeoutMs() {
    return idleTimeoutMs;
  },
  set idleTimeoutMs(value) {
    idleTimeoutMs = value;
  },
  get segments() {
    return segments;
  },
  set segments(value) {
    segments = value;
  },
  get currentSegmentIndex() {
    return currentSegmentIndex;
  },
  set currentSegmentIndex(value) {
    currentSegmentIndex = value;
  },
  get segmentVersion() {
    return segmentVersion;
  },
  set segmentVersion(value) {
    segmentVersion = value;
  },
  segmentEndReasons,
  publishWindowSnapshot,
  refreshCurrentPhaseLimit,
  scheduleBreakEndWarning: effects.scheduleBreakEndWarning,
  updateTray: effects.updateTray,
  startHeartbeat,
  stopSession: stopSessionInternal,
  isPausedForBridgeSegment: () => !isRunning && !overtimeIntervalId && !suspendedAway && !idlePaused,
  applyRunStartAdaptiveDecision,
}, runRepository);

const idleController = createPomodoroIdleController({
  get phase() {
    return phase;
  },
  set phase(value) {
    phase = value;
  },
  get isRunning() {
    return isRunning;
  },
  set isRunning(value) {
    isRunning = value;
  },
  get suspendedAway() {
    return suspendedAway;
  },
  set suspendedAway(value) {
    suspendedAway = value;
  },
  get idlePaused() {
    return idlePaused;
  },
  set idlePaused(value) {
    idlePaused = value;
  },
  get idleTimeoutMs() {
    return idleTimeoutMs;
  },
  set idleTimeoutMs(value) {
    idleTimeoutMs = value;
  },
  get phaseEndTime() {
    return phaseEndTime;
  },
  set phaseEndTime(value) {
    phaseEndTime = value;
  },
  get activeBlockEndMs() {
    return activeBlockEndMs;
  },
  set activeBlockEndMs(value) {
    activeBlockEndMs = value;
  },
  get activeBlockId() {
    return activeBlockId;
  },
  set activeBlockId(value) {
    activeBlockId = value;
  },
  get dismissedBlockId() {
    return dismissedBlockId;
  },
  set dismissedBlockId(value) {
    dismissedBlockId = value;
  },
  get activeRunId() {
    return activeRunId;
  },
  set activeRunId(value) {
    activeRunId = value;
  },
  get config() {
    return config;
  },
  set config(value) {
    config = value;
  },
  get currentRhythmPosition() {
    return currentRhythmPosition;
  },
  set currentRhythmPosition(value) {
    currentRhythmPosition = value;
  },
  get remainingSeconds() {
    return remainingSeconds;
  },
  set remainingSeconds(value) {
    remainingSeconds = value;
  },
  get segments() {
    return segments;
  },
  set segments(value) {
    segments = value;
  },
  get currentSegmentIndex() {
    return currentSegmentIndex;
  },
  set currentSegmentIndex(value) {
    currentSegmentIndex = value;
  },
  get completedPomodoros() {
    return completedPomodoros;
  },
  set completedPomodoros(value) {
    completedPomodoros = value;
  },
  get sessionStartTime() {
    return sessionStartTime;
  },
  set sessionStartTime(value) {
    sessionStartTime = value;
  },
  get skipNextBreak() {
    return skipNextBreak;
  },
  set skipNextBreak(value) {
    skipNextBreak = value;
  },
  get lastTickMs() {
    return lastTickMs;
  },
  set lastTickMs(value) {
    lastTickMs = value;
  },
  get intervalId() {
    return intervalId;
  },
  set intervalId(value) {
    intervalId = value;
  },
  tick,
  activeBlockDeadlineReached,
  expirePausedBlockAtDeadlineAndWait,
  stopPausedOpportunityCountdown,
  closePomodoroOverlay: effects.closePomodoroOverlay,
  clearMusicPausedByPomodoro: effects.clearMusicPausedByPomodoro,
  stopOvertime,
  resetFocusNotificationState,
  resetPhaseProgress,
  setPhaseRemainingSeconds,
  setVisibleRemainingForPause,
  actualPhaseElapsedSeconds,
  closeActiveRun,
  updateTray: effects.updateTray,
}, runRepository, segmentController, DEFAULT_FOCUS_SECONDS);

function expirePausedBlockAtDeadline(): void {
  if (activeBlockEndMs === null) return;
  effects.clearBreakEndWarning();
  effects.clearMusicPausedByPomodoro();
  effects.resetPausedFocusNotificationState();
  const endIso = new Date(activeBlockEndMs).toISOString();
  stopPausedOpportunityCountdown();
  refreshPausedOpportunityRemaining(activeBlockEndMs);

  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const segment = segments[currentSegmentIndex];
    if (segment.status === "active") {
      void segmentController.markSegment(currentSegmentIndex, "interrupted", true, endIso, "event_expired");
    }
    void segmentController.skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
  }

  void closeActiveRun(endIso, "completed", "interrupted", "event_expired", "complete");
  sessionStartTime = null;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopOvertime();
  idleController.stopChecking();
  isRunning = false;
  lastTickMs = null;
  phaseEndTime = null;
  remainingSeconds = 0;
  blockExpired = true;
  effects.updateTray();
}

async function expirePausedBlockAtDeadlineAndWait(): Promise<void> {
  if (activeBlockEndMs === null) return;
  effects.clearBreakEndWarning();
  effects.clearMusicPausedByPomodoro();
  effects.resetPausedFocusNotificationState();
  const endIso = new Date(activeBlockEndMs).toISOString();
  stopPausedOpportunityCountdown();
  refreshPausedOpportunityRemaining(activeBlockEndMs);

  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const segment = segments[currentSegmentIndex];
    if (segment.status === "active") {
      await segmentController.markSegment(currentSegmentIndex, "interrupted", true, endIso, "event_expired");
    }
    await segmentController.skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
  }

  await closeActiveRun(endIso, "completed", "interrupted", "event_expired", "complete");
  sessionStartTime = null;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopOvertime();
  idleController.stopChecking();
  isRunning = false;
  lastTickMs = null;
  phaseEndTime = null;
  remainingSeconds = 0;
  blockExpired = true;
  effects.updateTray();
}

function stopPausedOpportunityCountdown(): void {
  if (pausedOpportunityIntervalId !== null) {
    clearInterval(pausedOpportunityIntervalId);
    pausedOpportunityIntervalId = null;
  }
}

function startPausedOpportunityCountdown(): void {
  stopPausedOpportunityCountdown();
  if (!activeBlockId) return;
  if (activeBlockDeadlineReached()) {
    expirePausedBlockAtDeadline();
    return;
  }
  refreshPausedOpportunityRemaining();
  pausedOpportunityIntervalId = setInterval(() => {
    if (isRunning || !activeBlockId || suspendedAway || idlePaused) {
      stopPausedOpportunityCountdown();
      return;
    }
    if (activeBlockDeadlineReached()) {
      expirePausedBlockAtDeadline();
      return;
    }
    if (refreshPausedOpportunityRemaining()) effects.updateTray();
  }, 1000);
}

function resetPhaseProgress(defaultRemainingSeconds: number): void {
  phaseElapsedSeconds = 0;
  phaseWorkDurationSeconds = defaultRemainingSeconds;
  remainingSeconds = defaultRemainingSeconds;
  phaseTotalSeconds = defaultRemainingSeconds;
}

function resetFocusNotificationState(): void {
  notificationShown = false;
  focusExtensionUsed = false;
}

function isBreakPhase(value: PomodoroPhase | SegmentPhase): value is "short_break" | "long_break" {
  return value === "short_break" || value === "long_break";
}

function canExtendFocusTime(addSeconds: number = FOCUS_EXTENSION_SECONDS): boolean {
  if (phase !== "focus" || focusExtensionUsed || !pomodoroSessionActive()) return false;
  if (addSeconds <= 0) return false;

  const nowMs = Date.now();
  const currentWorkRemainingSeconds = phaseWorkRemainingSeconds();
  const currentVisibleRemainingSeconds = limitRemainingSecondsToBlockEnd(
    currentWorkRemainingSeconds,
    activeBlockEndMs,
    nowMs,
  );
  const extendedVisibleRemainingSeconds = limitRemainingSecondsToBlockEnd(
    currentWorkRemainingSeconds + addSeconds,
    activeBlockEndMs,
    nowMs,
  );
  return extendedVisibleRemainingSeconds > currentVisibleRemainingSeconds;
}

function canPauseResumeSession(nowMs: number = Date.now()): boolean {
  return canPauseResumePomodoro({
    phase,
    activeBlockId,
    activeBlockEndMs,
    blockExpired,
    isRunning,
    remainingSeconds,
    totalSeconds: phaseTotalSeconds,
    nowMs,
    suspendedAway: suspendedAway !== null,
    idlePaused: idlePaused !== null,
  });
}

function usedBreakExtensionSeconds(): number {
  if (!isBreakPhase(phase)) return 0;
  const configuredBreakSeconds = phaseDurationSeconds(
    phase,
    config,
    currentRhythmPosition,
  );
  return Math.max(0, phaseWorkDurationSeconds - configuredBreakSeconds);
}

function canExtendBreakTime(addSeconds: number = BREAK_EXTENSION_SECONDS): boolean {
  if (!isBreakPhase(phase) || !pomodoroSessionActive() || overtimeIntervalId !== null) return false;
  if (addSeconds <= 0) return false;

  const remainingExtensionSeconds = MAX_BREAK_EXTENSION_SECONDS - usedBreakExtensionSeconds();
  if (remainingExtensionSeconds <= 0) return false;

  const nowMs = Date.now();
  const currentWorkRemainingSeconds = phaseWorkRemainingSeconds();
  const currentVisibleRemainingSeconds = limitRemainingSecondsToBlockEnd(
    currentWorkRemainingSeconds,
    activeBlockEndMs,
    nowMs,
  );
  const extendedVisibleRemainingSeconds = limitRemainingSecondsToBlockEnd(
    currentWorkRemainingSeconds + Math.min(Math.ceil(addSeconds), remainingExtensionSeconds),
    activeBlockEndMs,
    nowMs,
  );
  return extendedVisibleRemainingSeconds > currentVisibleRemainingSeconds;
}

function addFocusTimeInternal(seconds: number = FOCUS_EXTENSION_SECONDS): void {
  if (!canExtendFocusTime(seconds)) return;

  const elapsedSeconds = actualPhaseElapsedSeconds();
  const nextWorkRemainingSeconds = phaseWorkRemainingSeconds() + seconds;
  const occurredAt = nowIso();
  focusExtensionUsed = true;
  notificationShown = false;
  setPhaseRemainingSeconds(nextWorkRemainingSeconds, elapsedSeconds);
  if (phaseEndTime !== null) phaseEndTime = Date.now() + remainingSeconds * 1000;
  const seg = segmentController.activeSegment();
  if (seg && seg.phase === "focus" && seg.status === "active") {
    seg.plannedEnd = new Date(new Date(seg.plannedEnd).getTime() + seconds * 1000).toISOString();
    runRepository.persistSegment(seg, "Failed to save focus extension:", true, occurredAt);
  }
  effects.updateTray();
}

function addBreakTimeInternal(seconds: number = BREAK_EXTENSION_SECONDS): void {
  if (!canExtendBreakTime(seconds)) return;

  const requestedSeconds = Math.max(0, Math.ceil(seconds));
  const remainingExtensionSeconds = MAX_BREAK_EXTENSION_SECONDS - usedBreakExtensionSeconds();
  const allowedSeconds = Math.min(requestedSeconds, remainingExtensionSeconds);
  const nowMs = Date.now();
  const elapsedSeconds = actualPhaseElapsedSeconds();
  const currentWorkRemainingSeconds = phaseWorkRemainingSeconds();
  const currentVisibleRemainingSeconds = limitRemainingSecondsToBlockEnd(
    currentWorkRemainingSeconds,
    activeBlockEndMs,
    nowMs,
  );
  const extendedVisibleRemainingSeconds = limitRemainingSecondsToBlockEnd(
    currentWorkRemainingSeconds + allowedSeconds,
    activeBlockEndMs,
    nowMs,
  );
  const addedVisibleSeconds = extendedVisibleRemainingSeconds - currentVisibleRemainingSeconds;
  if (addedVisibleSeconds <= 0) return;

  setPhaseRemainingSeconds(currentWorkRemainingSeconds + addedVisibleSeconds, elapsedSeconds, nowMs);
  if (phaseEndTime !== null) phaseEndTime = nowMs + remainingSeconds * 1000;
  effects.scheduleBreakEndWarning();

  const seg = segmentController.activeSegment();
  if (seg && isBreakPhase(seg.phase) && seg.status === "active") {
    seg.plannedEnd = new Date(new Date(seg.plannedEnd).getTime() + addedVisibleSeconds * 1000).toISOString();
    runRepository.persistSegment(seg, "Failed to save break extension:", true);
  }
  effects.updateTray();
}

function cappedActiveBreakEndIso(actualEndMs: number = Date.now()): string {
  const seg = segmentController.activeSegment();
  if (!seg || !isBreakPhase(seg.phase)) return new Date(actualEndMs).toISOString();

  const plannedEndMs = new Date(seg.plannedEnd).getTime();
  const cappedEndMs = Math.min(
    actualEndMs,
    plannedEndMs + BREAK_OVERTIME_RAIL_GRACE_SECONDS * 1000,
  );
  return new Date(cappedEndMs).toISOString();
}

function completePomodoroBackendWrite(options: PomodoroBackendWriteOptions = {}): void {
  if (options.bumpSegmentVersion !== false) segmentVersion++;
  if (options.publishSnapshot !== false) publishWindowSnapshot();
}

function recordManualPhaseAdvanceEvent(occurredAt: string): void {
  if (!activeRunId) return;
  const seg = segmentController.activeSegment();
  if (phase === "focus" && seg?.status === "active") {
    runRepository.recordRunEvent({
      runId: activeRunId,
      segmentId: seg.id,
      eventType: "go_to_break_now",
      occurredAt,
      phase: "focus",
      reason: "manual",
      durationSeconds: null,
    }, "Failed to record early focus end:");
    return;
  }
  if (isBreakPhase(phase) && seg?.status === "active" && phaseWorkRemainingSeconds() > 0) {
    runRepository.recordRunEvent({
      runId: activeRunId,
      segmentId: seg.id,
      eventType: "start_focus_now",
      occurredAt,
      phase,
      reason: "manual",
      durationSeconds: null,
    }, "Failed to record early break end:");
  }
}

function sendHeartbeat(): void {
  if (!activeRunId) return;
  writeCurrentDoomscrollingRuntimeState(true);
  runRepository.sendHeartbeat(activeRunId, nowIso());
}

function startHeartbeat(): void {
  stopHeartbeat();
  if (!activeRunId) return;
  sendHeartbeat();
  heartbeatIntervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatIntervalId !== null) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
}

/**
 * User explicitly changed the pomodoro config on the active block.
 * Adjusts the current phase timer to the new duration and rebuilds segments.
 */
async function reconfigureSession(
  blockId: string,
  newConfig: PomodoroConfig,
  eventEnd: string,
  eventDate: string,
) {
  stopPausedOpportunityCountdown();
  activeBlockEndMs = new Date(eventEnd.replace(" ", "T")).getTime();
  const elapsedSeconds = actualPhaseElapsedSeconds();

  const result = decideReconfigure({
    phase,
    remainingSeconds,
    elapsedSeconds,
    currentConfig: config,
    newConfig,
    currentRhythmPosition,
    hasOvertimeInterval: overtimeIntervalId !== null,
  });

  config = clonePomodoroConfig(newConfig);
  currentRhythmPosition = normalizeRhythmPosition(config, currentRhythmPosition);
  const nowMs = Date.now();
  setPhaseRemainingSeconds(result.newRemainingSeconds, elapsedSeconds, nowMs);

  if (isRunning) {
    phaseEndTime = nowMs + remainingSeconds * 1000;
  } else if (result.exitOvertime) {
    stopOvertime();
    isRunning = true;
    phaseEndTime = nowMs + remainingSeconds * 1000;
    intervalId = setInterval(tick, 1000);
    lastTickMs = nowMs;
  }
  effects.scheduleBreakEndWarning();

  if (result.resetNotification) {
    notificationShown = false;
  }

  await segmentController.rebuildSegments(blockId, eventEnd, eventDate, {
    runEndReason: "reconfigured",
    segmentStatus: "completed",
    segmentEndReason: "reconfigured",
    eventType: "reconfigure",
    startTrigger: "reconfigure",
    inheritedFocusSeconds: phase === "focus" ? elapsedSeconds : 0,
    inheritedRhythmPosition: currentRhythmPosition,
  });
  effects.updateTray();
}

/**
 * Seamless transition between adjacent/overlapping blocks.
 * Preserves focus continuity via inheritance: accumulated focus time is
 * compared to the new block's focus threshold. If exceeded, a break triggers.
 * If not, focus continues with adjusted remaining time.
 */
async function transitionToBlock(
  blockId: string,
  newConfig: PomodoroConfig,
  eventEnd: string,
  eventDate: string,
) {
  stopPausedOpportunityCountdown();
  const previousConfig = config;
  const elapsedSeconds = actualPhaseElapsedSeconds();
  const inheritedFocusSeconds = phase === "focus" ? elapsedSeconds : 0;
  const inheritedRhythmPosition = currentRhythmPosition;
  activeBlockId = blockId;
  activeBlockEndMs = new Date(eventEnd.replace(" ", "T")).getTime();
  initListeners();

  const result = decideTransition({
    previousConfig,
    newConfig,
    phase,
    remainingSeconds,
    elapsedFocusSeconds: phase === "focus" ? elapsedSeconds : undefined,
    currentRhythmPosition,
    blockExpired,
  });

  config = clonePomodoroConfig(newConfig);
  currentRhythmPosition = normalizeRhythmPosition(config, currentRhythmPosition);

  switch (result.kind) {
    case "trigger_break": {
      completedPomodoros += 1;
      sessionStartTime = null;
      notificationShown = false;

      phase = result.breakPhase;
      setPhaseRemainingSeconds(result.breakDurationSeconds);
      currentRhythmPosition = result.rhythmPosition;

      phaseEndTime = Date.now() + remainingSeconds * 1000;
      if (!isRunning) {
        isRunning = true;
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(tick, 1000);
        lastTickMs = Date.now();
      }

      effects.showBreakOverlay(remainingSeconds);
      break;
    }

    case "continue_focus": {
      setPhaseRemainingSeconds(result.remainingSeconds, elapsedSeconds);
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      if (!isRunning) {
        isRunning = true;
        if (!sessionStartTime) sessionStartTime = nowIso();
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(tick, 1000);
        lastTickMs = Date.now();
        idleController.startChecking();
      }
      if (result.resetNotification) {
        notificationShown = false;
      }
      break;
    }

    case "fresh_start": {
      stopOvertime();
      phase = "focus";
      setPhaseRemainingSeconds(result.remainingSeconds);
      currentRhythmPosition = 1;
      completedPomodoros = 0;
      resetFocusNotificationState();
      isRunning = true;
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      sessionStartTime = nowIso();
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(tick, 1000);
      lastTickMs = Date.now();
      idleController.startChecking();
      break;
    }

    case "keep_break":
      // Break running as-is; after it ends, startFocusSession uses the new config.
      break;
  }

  blockExpired = false;
  await segmentController.rebuildSegments(blockId, eventEnd, eventDate, {
    runEndReason: "block_transition",
    segmentStatus: "interrupted",
    segmentEndReason: "block_transition",
    eventType: "block_transition",
    startTrigger: "block_transition",
    inheritedFocusSeconds,
    inheritedRhythmPosition,
  });
  effects.updateTray();
}

// Listeners

function handleWindowCommand(command: PomodoroWindowCommand): void {
  if (!pomodoroCoordinator) return;
  switch (command.kind) {
    case "request-snapshot":
      publishWindowSnapshot();
      return;
    case "set-dismissed-block-id":
      setDismissedBlockId(command.id);
      return;
    case "clear-block-expired":
      clearBlockExpiredInternal();
      return;
    case "transfer-block-id":
      void transferBlockIdInternal(command.newBlockId, command.newEndTime);
      return;
    case "start-from-block":
      void startFromBlockInternal(
        command.blockId,
        command.blockConfig,
        command.eventEnd,
        command.eventDate,
        command.blockIdleTimeoutMinutes,
        command.syncIdleTimeoutOnExistingBlock,
        command.adaptivePlannedBlocks,
      );
      return;
    case "set-active-idle-threshold-minutes":
      idleController.setActiveThresholdMinutes(command.minutes);
      return;
    case "dismiss-suspend":
      void dismissSuspend(command.resume);
      return;
    case "dismiss-idle":
      void idleController.dismiss(command.resume);
      return;
    case "mark-idle-focus-failed":
      void idleController.markFocusFailed(command.failedAtMs ?? null);
      return;
    case "complete-active-block-at":
      void completeActiveBlockAtInternal(command.endIso);
      return;
    case "stop-session":
      void stopSessionInternal();
      return;
    case "pause":
      pauseSession();
      return;
    case "start":
      resumeSession();
      return;
    case "skip":
      skipSession();
      return;
    case "add-focus-time":
      addFocusTimeInternal(command.seconds);
      return;
    case "cleanup-orphans":
      void cleanupOrphansInternal();
      return;
  }
}

function initListeners() {
  if (!pomodoroCoordinator) return;
  if (listenersInitialized) return;
  listenersInitialized = true;

  listen("pomodoro-skip-break", () => {
    document.dispatchEvent(new Event("ganbaru-ai-clear-snap"));
    if (phase === "short_break" || phase === "long_break") {
      const occurredAt = nowIso();
      recordManualPhaseAdvanceEvent(occurredAt);
      if (activeRunId) {
        runRepository.recordRunEvent({
          runId: activeRunId,
          segmentId: segmentController.activeSegment()?.id ?? null,
          eventType: "skip_break",
          occurredAt,
          phase,
          reason: "skipped_by_user",
          durationSeconds: null,
        }, "Failed to record skipped break:");
      }
      void (async () => {
        await segmentController.markSegment(currentSegmentIndex, "interrupted", true, occurredAt, "skipped_by_user");
        await startFocusSession();
      })();
    } else {
      skipNextBreak = true;
    }
  }).catch((e) => console.warn("Failed to listen for pomodoro-skip-break:", e));

  listen("pomodoro-break-acknowledged", () => {
    document.dispatchEvent(new Event("ganbaru-ai-clear-snap"));
    if (phase === "short_break" || phase === "long_break") {
      void (async () => {
        await segmentController.markSegment(currentSegmentIndex, "completed", true, cappedActiveBreakEndIso());
        await startFocusSession();
      })();
    }
  }).catch((e) => console.warn("Failed to listen for pomodoro-break-acknowledged:", e));

  listen<{ seconds: number }>("pomodoro-break-extended", (event) => {
    addBreakTimeInternal(event.payload.seconds);
  }).catch((e) => console.warn("Failed to listen for pomodoro-break-extended:", e));

  listen("idle-overlay-resume", () => {
    if (idlePaused) void idleController.dismiss(true);
  }).catch((e) => console.warn("Failed to listen for idle-overlay-resume:", e));

  listen<{ failedAtMs?: number }>("idle-overlay-focus-failed", (event) => {
    if (!idlePaused) return;
    const failedAtMs = event.payload.failedAtMs;
    void idleController.markFocusFailed(
      typeof failedAtMs === "number" && Number.isFinite(failedAtMs) ? failedAtMs : null,
    );
  }).catch((e) => console.warn("Failed to listen for idle-overlay-focus-failed:", e));

  listen("tray-pause-resume", () => {
    if (!canPauseResumeSession()) return;
    if (isRunning) {
      pauseSession();
    } else {
      resumeSession();
    }
  }).catch((e) => console.warn("Failed to listen for tray-pause-resume:", e));

  listen("tray-skip", () => {
    if (suspendedAway || idlePaused) return;
    void advancePhase();
    effects.updateTray();
  }).catch((e) => console.warn("Failed to listen for tray-skip:", e));

  listen<{ seconds: number }>("pomodoro-add-time", (event) => {
    addFocusTimeInternal(event.payload.seconds);
  }).catch((e) => console.warn("Failed to listen for pomodoro-add-time:", e));

  listen(PAUSED_FOCUS_NOTIFICATION_RESUME_EVENT, () => {
    if (suspendedAway || idlePaused || isRunning || !pausedFocusPulseActive()) return;
    resumeSession();
  }).catch((e) =>
    console.warn("Failed to listen for paused focus notification resume:", e),
  );

  listen(PAUSED_FOCUS_NOTIFICATION_STOP_ASKING_EVENT, () => {
    if (!pausedFocusPulseActive()) return;
    effects.suppressPausedFocusNotificationsForCurrentPause();
  }).catch((e) =>
    console.warn("Failed to listen for paused focus notification stop asking:", e),
  );
}

// Session control

function stopOvertime() {
  if (overtimeIntervalId) {
    clearInterval(overtimeIntervalId);
    overtimeIntervalId = null;
  }
  if (overtimeAlertIntervalId) {
    clearInterval(overtimeAlertIntervalId);
    overtimeAlertIntervalId = null;
  }
  breakOvertimeSeconds = 0;
}

async function startFocusSession() {
  effects.closePomodoroOverlay();
  effects.clearBreakEndWarning();
  effects.clearMusicPausedByPomodoro();
  effects.resetPausedFocusNotificationState();
  stopPausedOpportunityCountdown();
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopOvertime();
  const boundaryOccurredAt = nowIso();
  const adaptiveDecision = await decideBoundaryAdaptiveForState({
    config,
    idleDetectionEnabled: idleTimeoutMs !== null,
    activeBlockEndMs,
    activeSegmentPlannedEnd: segmentController.activeSegment()?.plannedEnd ?? null,
    opportunityKind: "focus_start",
    occurredAt: boundaryOccurredAt,
  });
  applyBoundaryAdaptiveDecision(adaptiveDecision);
  const nextPosition = isBreakPhase(phase)
    ? nextRhythmPosition(config, currentRhythmPosition)
    : currentRhythmPosition;
  phase = "focus";
  currentRhythmPosition = nextPosition;
  setPhaseRemainingSeconds(
    focusDurationMinutesAtPosition(config, currentRhythmPosition) * TIME_MULTIPLIER,
  );
  resetFocusNotificationState();
  isRunning = true;
  const startedAt = nowIso();
  phaseEndTime = Date.now() + remainingSeconds * 1000;
  sessionStartTime = startedAt;
  intervalId = setInterval(tick, 1000);
  lastTickMs = Date.now();

  if (adaptiveDecision) {
    const segment = segmentController.boundarySegment("focus", currentRhythmPosition, startedAt);
    if (segment) {
      await segmentController.activateBoundarySegment(segment, adaptiveDecision);
    } else {
      const nextFocus = segments.findIndex(
        (s, i) => i > currentSegmentIndex && s.phase === "focus" && s.status === "planned",
      );
      if (nextFocus !== -1) {
        await segmentController.activateSegment(nextFocus);
      }
    }
  } else {
    const nextFocus = segments.findIndex(
      (s, i) => i > currentSegmentIndex && s.phase === "focus" && s.status === "planned",
    );
    if (nextFocus !== -1) {
      await segmentController.activateSegment(nextFocus);
    }
  }

  effects.updateTray();
}

async function dismissSuspend(resume: boolean): Promise<void> {
  stopPausedOpportunityCountdown();
  if (resume) {
    suspendedAway = null;
    // Clear cached end time so tick() won't auto-stop with stale data.
    // The next checkActiveBlock (triggered by suspendedAway going null)
    // will call startFromBlock with fresh event times.
    activeBlockEndMs = null;
    isRunning = true;
    phaseEndTime = Date.now() + remainingSeconds * 1000;
    lastTickMs = Date.now();
    intervalId = setInterval(tick, 1000);
    effects.scheduleBreakEndWarning();
    idleController.startChecking();
    effects.updateTray();
  } else {
    effects.clearBreakEndWarning();
    const seg = segmentController.activeSegment();
    const lastPause = seg?.pauseLog[seg.pauseLog.length - 1];
    const endIso = lastPause ? lastPause.startedAt : nowIso();
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      await segmentController.markSegment(currentSegmentIndex, "interrupted", true, endIso, "stopped");
      await segmentController.skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
    }
    await closeActiveRun(endIso, "stopped", "interrupted", "stopped", "stop");
    suspendedAway = null;
    stopOvertime();
    idleController.stopChecking();
    isRunning = false;
    phaseEndTime = null;
    dismissedBlockId = activeBlockId;
    activeBlockId = null;
    activeBlockEndMs = null;
    idleTimeoutMs = null;
    lastTickMs = null;
    phase = "focus";
    resetPhaseProgress(DEFAULT_FOCUS_SECONDS);
    currentRhythmPosition = 1;
    completedPomodoros = 0;
    sessionStartTime = null;
    skipNextBreak = false;
    resetFocusNotificationState();
    segmentController.clearSegments();
    effects.updateTray();
  }
}

// Timer

function tick() {
  const now = Date.now();
  const result = decideTick(buildSnapshot(), now);

  switch (result.kind) {
    case "suspend_and_block_expired": {
      effects.closePomodoroOverlay();
      effects.clearBreakEndWarning();
      // Record synthetic pause
      if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
        const seg = segments[currentSegmentIndex];
        segmentController.appendPause(seg, result.suspendStartIso, "suspend", result.suspendEndIso);
        runRepository.persistSegment(seg, "Failed to save suspend pause:", false);
      }
      setVisibleRemainingForPause(
        result.preSuspendRemainingSeconds,
        actualPhaseElapsedSeconds(),
        segmentController.timestampMs(result.suspendStartIso),
      );
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      isRunning = false;
      lastTickMs = null;
      // Mark segments
      markCurrentAndSkipRemaining(result.suspendStartIso);
      void closeActiveRun(result.suspendStartIso, "completed", "interrupted", "event_expired", "complete");
      sessionStartTime = null;
      stopOvertime();
      idleController.stopChecking();
      phaseEndTime = null;
      blockExpired = true;
      effects.updateTray();
      return;
    }

    case "suspend_block_active": {
      effects.clearBreakEndWarning();
      // Record synthetic pause
      if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
        const seg = segments[currentSegmentIndex];
        segmentController.appendPause(seg, result.suspendStartIso, "suspend", result.suspendEndIso);
        runRepository.persistSegment(seg, "Failed to save suspend pause:", false);
      }
      setVisibleRemainingForPause(
        result.preSuspendRemainingSeconds,
        actualPhaseElapsedSeconds(),
        segmentController.timestampMs(result.suspendStartIso),
      );
      phaseEndTime = result.newPhaseEndTime;
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      isRunning = false;
      lastTickMs = null;
      suspendedAway = { awaySeconds: result.awaySeconds };
      effects.updateTray();
      return;
    }

    case "block_expired": {
      effects.closePomodoroOverlay();
      effects.clearBreakEndWarning();
      lastTickMs = now;
      recordRunningPhaseProgress(0);
      const endIso = new Date(activeBlockEndMs!).toISOString();
      markCurrentAndSkipRemaining(endIso);
      void closeActiveRun(
        endIso,
        "completed",
        "interrupted",
        "event_expired",
        "complete",
      );
      sessionStartTime = null;
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      stopOvertime();
      idleController.stopChecking();
      isRunning = false;
      lastTickMs = null;
      phaseEndTime = null;
      blockExpired = true;
      effects.updateTray();
      return;
    }

    case "break_finished": {
      effects.clearBreakEndWarning();
      lastTickMs = now;
      recordRunningPhaseProgress(0);
      remainingSeconds = 0;
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      isRunning = false;
      breakOvertimeSeconds = 0;
      if (!overtimeIntervalId) {
        overtimeIntervalId = setInterval(() => {
          breakOvertimeSeconds += 1;
          publishWindowSnapshot();
          if (breakOvertimeSeconds >= MAX_BREAK_OVERTIME_SECONDS) {
            void (async () => {
              await segmentController.markSegment(currentSegmentIndex, "completed", true, cappedActiveBreakEndIso());
              await startFocusSession();
            })();
          }
        }, 1000);
      }
      if (!overtimeAlertIntervalId) {
        effects.playBreakFinishedAlert();
        overtimeAlertIntervalId = effects.startConfiguredBreakFinishedAlertInterval();
      }
      return;
    }

    case "focus_finished": {
      lastTickMs = now;
      recordRunningPhaseProgress(0);
      void advancePhase();
      return;
    }

    case "countdown_with_notification": {
      lastTickMs = now;
      recordRunningPhaseProgress(result.remainingSeconds);
      effects.showNotification();
      effects.updateTray();
      return;
    }

    case "countdown": {
      lastTickMs = now;
      recordRunningPhaseProgress(result.remainingSeconds);
      effects.updateTray();
      return;
    }
  }
}

/** Mark the current segment as completed and remaining planned segments as skipped. */
function markCurrentAndSkipRemaining(endIso: string = nowIso()) {
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    segmentController.markSegment(currentSegmentIndex, "interrupted", true, endIso, "event_expired");
    segmentController.skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
  }
}

async function advancePhase() {
  if (phaseAdvanceInFlight) return;
  phaseAdvanceInFlight = true;
  try {
    const boundaryOpportunity = phase === "focus" && !skipNextBreak ? "break_start" : "focus_start";
    const skippedBreakPhase = phase === "focus" && skipNextBreak
      ? breakAfterFocusPosition(config, currentRhythmPosition).phase
      : "short_break";

    // Persist the ending phase before boundary adaptation so the next decision can see it.
    let boundaryOccurredAt = nowIso();
    if (phase === "focus") {
      effects.clearMusicPausedByPomodoro();
      completedPomodoros += 1;
      sessionStartTime = null;
      notificationShown = false;
      await segmentController.markSegment(currentSegmentIndex, "completed", true, boundaryOccurredAt, "completed");
    } else {
      boundaryOccurredAt = cappedActiveBreakEndIso();
      await segmentController.markSegment(currentSegmentIndex, "completed", true, boundaryOccurredAt);
    }

    const adaptiveDecision = await decideBoundaryAdaptiveForState({
    config,
    idleDetectionEnabled: idleTimeoutMs !== null,
    activeBlockEndMs,
    activeSegmentPlannedEnd: segmentController.activeSegment()?.plannedEnd ?? null,
    opportunityKind: boundaryOpportunity,
    occurredAt: boundaryOccurredAt,
  });
    applyBoundaryAdaptiveDecision(adaptiveDecision);
    const result = decideAdvancePhase(buildSnapshot());

    switch (result.kind) {
      case "skip_break_to_focus": {
        skipNextBreak = false;
        phase = "focus";
        setPhaseRemainingSeconds(result.remainingSeconds);
        resetFocusNotificationState();
        phaseEndTime = Date.now() + remainingSeconds * 1000;
        currentRhythmPosition = result.nextRhythmPosition;

        const now = nowIso();
        if (activeRunId) {
          runRepository.recordRunEvent({
            runId: activeRunId,
            segmentId: null,
            eventType: "skip_break",
            occurredAt: now,
            phase: skippedBreakPhase,
            reason: "skip_next_break",
            durationSeconds: null,
          }, "Failed to record skipped break:");
        }
        const segment = adaptiveDecision
          ? segmentController.boundarySegment("focus", currentRhythmPosition, now)
          : null;
        if (segment) {
          await segmentController.activateBoundarySegment(segment, adaptiveDecision);
        } else {
          const breakIdx = currentSegmentIndex + 1;
          if (breakIdx < segments.length && segments[breakIdx].phase !== "focus") {
            segments[breakIdx].status = "skipped";
            segments[breakIdx].actualStart = now;
            segments[breakIdx].actualEnd = now;

            const nextFocus = segments.findIndex(
              (s, i) => i > breakIdx && s.phase === "focus" && s.status === "planned",
            );
            if (nextFocus !== -1) {
              await segmentController.activateSegment(nextFocus);
            }
          }
        }
        break;
      }

      case "focus_to_long_break": {
        phase = "long_break";
        setPhaseRemainingSeconds(result.remainingSeconds);
        phaseEndTime = Date.now() + remainingSeconds * 1000;
        currentRhythmPosition = result.rhythmPosition;

        const now = nowIso();
        const segment = adaptiveDecision
          ? segmentController.boundarySegment("long_break", currentRhythmPosition, now)
          : null;
        if (segment) {
          await segmentController.activateBoundarySegment(segment, adaptiveDecision);
        } else {
          const breakIdx = currentSegmentIndex + 1;
          if (breakIdx < segments.length && segments[breakIdx].phase === "long_break") {
            await segmentController.activateSegment(breakIdx);
          }
        }
        effects.showBreakOverlay(remainingSeconds);
        break;
      }

      case "focus_to_short_break": {
        phase = "short_break";
        setPhaseRemainingSeconds(result.remainingSeconds);
        phaseEndTime = Date.now() + remainingSeconds * 1000;
        currentRhythmPosition = result.rhythmPosition;

        const now = nowIso();
        const segment = adaptiveDecision
          ? segmentController.boundarySegment("short_break", currentRhythmPosition, now)
          : null;
        if (segment) {
          await segmentController.activateBoundarySegment(segment, adaptiveDecision);
        } else {
          const breakIdx = currentSegmentIndex + 1;
          if (breakIdx < segments.length && segments[breakIdx].phase === "short_break") {
            await segmentController.activateSegment(breakIdx);
          }
        }
        effects.showBreakOverlay(remainingSeconds);
        break;
      }

      case "break_to_focus": {
        phase = "focus";
        currentRhythmPosition = result.nextRhythmPosition;
        setPhaseRemainingSeconds(result.remainingSeconds);
        resetFocusNotificationState();
        phaseEndTime = Date.now() + remainingSeconds * 1000;

        const now = nowIso();
        const segment = adaptiveDecision
          ? segmentController.boundarySegment("focus", currentRhythmPosition, now)
          : null;
        if (segment) {
          await segmentController.activateBoundarySegment(segment, adaptiveDecision);
        } else {
          const nextFocus = segments.findIndex(
            (s, i) => i > currentSegmentIndex && s.phase === "focus" && s.status === "planned",
          );
          if (nextFocus !== -1) {
            await segmentController.activateSegment(nextFocus);
          }
        }
        break;
      }
    }
    effects.updateTray();
  } finally {
    phaseAdvanceInFlight = false;
  }
}

function setDismissedBlockId(id: string | null): void {
  dismissedBlockId = id;
  publishWindowSnapshot();
}

function clearBlockExpiredInternal(): void {
  blockExpired = false;
  publishWindowSnapshot();
}

async function transferBlockIdInternal(newBlockId: string, newEndTime?: string): Promise<void> {
  if (!activeBlockId) return;
  const newEndMs = newEndTime ? new Date(newEndTime.replace(" ", "T")).getTime() : null;
  const plannedEnd = newEndMs != null && Number.isFinite(newEndMs)
    ? new Date(newEndMs).toISOString()
    : null;
  const newEventDate = segmentController.eventDateFromBlockId(newBlockId) ?? segmentController.activeSegment()?.eventDate ?? null;
  await runRepository.transferActiveEventReference({
    newEventId: newBlockId,
    newEventDate,
    plannedEnd,
  });
  adoptTransferredBlockIdInternal(newBlockId, newEndTime, newEventDate);
}

function adoptTransferredBlockIdInternal(
  newBlockId: string,
  newEndTime?: string,
  eventDate?: string | null,
): void {
  if (!activeBlockId) return;
  const newEndMs = newEndTime ? new Date(newEndTime.replace(" ", "T")).getTime() : null;
  const newEventDate = segmentController.eventDateFromBlockId(newBlockId) ?? eventDate ?? segmentController.activeSegment()?.eventDate ?? null;
  activeBlockId = newBlockId;
  for (const seg of segments) {
    seg.eventId = newBlockId;
    if (newEventDate) seg.eventDate = newEventDate;
  }
  if (newEndMs != null && Number.isFinite(newEndMs)) {
    segmentController.applyActiveBlockWindowChange(newBlockId, newEndMs, newEventDate ?? undefined);
    return;
  }
  publishWindowSnapshot();
}

async function startFromBlockInternal(
  blockId: string,
  blockConfig: PomodoroConfig,
  eventEnd?: string,
  eventDate?: string,
  blockIdleTimeoutMinutes?: number | null,
  syncIdleTimeoutOnExistingBlock = true,
  adaptivePlannedBlocks: readonly PomodoroAdaptivePlannedBlockWrite[] = [],
): Promise<void> {
  const newConfig = clonePomodoroConfig(blockConfig);

  const idleMinutes = blockIdleTimeoutMinutes ?? newConfig.idleTimeoutMinutes;
  const newIdleMs = (idleMinutes != null && idleMinutes > 0)
    ? idleMinutes * 60_000 : null;

  const incomingEndMs = (eventEnd && eventDate)
    ? new Date(eventEnd.replace(" ", "T")).getTime()
    : null;

  const decision = decideStartFromBlock({
    currentBlockId: activeBlockId,
    incomingBlockId: blockId,
    incomingConfig: newConfig,
    currentConfig: config,
    currentEndMs: activeBlockEndMs,
    incomingEndMs,
    hasOvertimeInterval: overtimeIntervalId !== null,
  });
  const syncIdleTimeout =
    syncIdleTimeoutOnExistingBlock ||
    decision.kind === "new_session" ||
    decision.kind === "transition" ||
    decision.kind === "reconfigure";
  if (syncIdleTimeout) idleController.setActiveTimeoutMs(newIdleMs);

  switch (decision.kind) {
    case "noop":
      return;

    case "update_end_only":
      segmentController.applyActiveBlockWindowChange(blockId, decision.newEndMs, eventDate);
      return;

    case "reconfigure":
      await reconfigureSession(blockId, decision.newConfig, eventEnd!, eventDate!);
      return;

    case "rebuild_segments":
      segmentController.applyActiveBlockWindowChange(blockId, decision.newEndMs, eventDate);
      return;

    case "transition":
      await transitionToBlock(blockId, decision.newConfig, eventEnd!, eventDate!);
      return;

    case "new_session": {
      effects.clearBreakEndWarning();
      effects.clearMusicPausedByPomodoro();
      stopPausedOpportunityCountdown();
      initListeners();
      if (intervalId) { clearInterval(intervalId); intervalId = null; }

      activeBlockId = blockId;
      activeBlockEndMs = decision.newEndMs;
      config = clonePomodoroConfig(decision.newConfig);
      phase = "focus";
      currentRhythmPosition = 1;
      setPhaseRemainingSeconds(
        focusDurationMinutesAtPosition(config, currentRhythmPosition) * TIME_MULTIPLIER,
      );
      completedPomodoros = 0;
      skipNextBreak = false;
      resetFocusNotificationState();

      isRunning = true;
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      sessionStartTime = new Date().toISOString();
      intervalId = setInterval(tick, 1000);
      lastTickMs = Date.now();
      idleController.startChecking();

      if (eventEnd && eventDate) {
        await segmentController.createSegments(blockId, eventEnd, eventDate, adaptivePlannedBlocks);
      }

      effects.updateTray();
      return;
    }
  }
}

async function stopSessionInternal(): Promise<void> {
  effects.closePomodoroOverlay();
  effects.clearBreakEndWarning();
  effects.clearMusicPausedByPomodoro();
  effects.resetPausedFocusNotificationState();
  stopPausedOpportunityCountdown();
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const seg = segments[currentSegmentIndex];
    if (seg.status === "active") {
      const endIso = nowIso();
      await segmentController.markSegment(currentSegmentIndex, "interrupted", true, endIso, "stopped");
      await closeActiveRun(endIso, "stopped", "interrupted", "stopped", "stop");
    }
    await segmentController.skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
  } else if (activeRunId) {
    await closeActiveRun(nowIso(), "stopped", "interrupted", "stopped", "stop");
  }

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopOvertime();
  idleController.stopChecking();
  isRunning = false;
  lastTickMs = null;
  phaseEndTime = null;
  if (!dismissedBlockId && activeBlockId) dismissedBlockId = activeBlockId;
  activeBlockId = null;
  activeRunId = null;
  activeBlockEndMs = null;
  idleTimeoutMs = null;
  blockExpired = false;
  phase = "focus";
  resetPhaseProgress(DEFAULT_FOCUS_SECONDS);
  currentRhythmPosition = 1;
  completedPomodoros = 0;
  sessionStartTime = null;
  skipNextBreak = false;
  resetFocusNotificationState();
  segmentController.clearSegments();
  effects.updateTray();
}

async function completeActiveBlockAtInternal(endIso: string = nowIso()): Promise<void> {
  effects.closePomodoroOverlay();
  effects.clearBreakEndWarning();
  effects.resetPausedFocusNotificationState();
  const parsedEndMs = Date.parse(endIso);
  const normalizedEndIso = Number.isFinite(parsedEndMs)
    ? new Date(parsedEndMs).toISOString()
    : nowIso();

  effects.clearMusicPausedByPomodoro();
  stopPausedOpportunityCountdown();
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    await segmentController.markSegment(currentSegmentIndex, "interrupted", true, normalizedEndIso, "event_expired");
    await segmentController.skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
  } else if (activeRunId) {
    await closeActiveRun(
      normalizedEndIso,
      "completed",
      "interrupted",
      "event_expired",
      "complete",
      true,
    );
  }

  if (activeRunId) {
    await closeActiveRun(
      normalizedEndIso,
      "completed",
      "interrupted",
      "event_expired",
      "complete",
      true,
    );
  }

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopOvertime();
  idleController.stopChecking();
  isRunning = false;
  lastTickMs = null;
  phaseEndTime = null;
  if (!dismissedBlockId && activeBlockId) dismissedBlockId = activeBlockId;
  activeBlockId = null;
  activeRunId = null;
  activeBlockEndMs = null;
  idleTimeoutMs = null;
  blockExpired = false;
  suspendedAway = null;
  idlePaused = null;
  phase = "focus";
  resetPhaseProgress(DEFAULT_FOCUS_SECONDS);
  currentRhythmPosition = 1;
  completedPomodoros = 0;
  sessionStartTime = null;
  skipNextBreak = false;
  resetFocusNotificationState();
  effects.updateTray();
}

function pauseSession(): void {
  if (!isRunning || !canPauseResumeSession()) return;
  effects.clearBreakEndWarning();
  effects.resetPausedFocusNotificationState();
  isRunning = false;
  phaseEndTime = null;
  lastTickMs = null;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  idleController.stopChecking();
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const seg = segments[currentSegmentIndex];
    const now = nowIso();
    segmentController.appendPause(seg, now, "manual");
    runRepository.persistSegment(seg, "Failed to save pause:", false);
  }
  startPausedOpportunityCountdown();
  effects.pauseMusicForPomodoroPause();
  effects.updateTray();
}

function resumeSession(): void {
  if (isRunning) return;
  initListeners();
  refreshPausedOpportunityRemaining();
  if (activeBlockDeadlineReached()) {
    expirePausedBlockAtDeadline();
    return;
  }
  if (!canPauseResumeSession()) return;
  effects.resetPausedFocusNotificationState();
  stopPausedOpportunityCountdown();
  isRunning = true;
  phaseEndTime = Date.now() + remainingSeconds * 1000;
  if (!sessionStartTime) {
    sessionStartTime = new Date().toISOString();
  }
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const seg = segments[currentSegmentIndex];
    if (segmentController.closeLastPause(seg, nowIso())) {
      runRepository.persistSegment(seg, "Failed to save resume:", false);
    }
  }
  intervalId = setInterval(tick, 1000);
  lastTickMs = Date.now();
  effects.scheduleBreakEndWarning();
  idleController.startChecking();
  effects.resumeMusicFromPomodoroPause();
  effects.updateTray();
}

function skipSession(): void {
  recordManualPhaseAdvanceEvent(nowIso());
  void advancePhase();
}

async function cleanupOrphansInternal(): Promise<void> {
  await runRepository.cleanupOrphans()
    .catch((e) => console.warn("Failed to recover open pomodoro runs:", e));
}

// Public API

export function getPomodoro() {
  windowCoordinator.init();
  initListeners();
  return {
    get phase() {
      return phase;
    },
    get remainingSeconds() {
      return remainingSeconds;
    },
    get phaseElapsedSeconds() {
      return phaseElapsedSeconds;
    },
    get phaseWorkDurationSeconds() {
      return phaseWorkDurationSeconds;
    },
    get currentConfig() {
      return config;
    },
    get currentRhythmPosition() {
      return currentRhythmPosition;
    },
    get totalRhythmPositions() {
      return rhythmPositionCount(config);
    },
    get currentCycle() {
      return currentRhythmPosition;
    },
    get totalCycles() {
      return rhythmPositionCount(config);
    },
    get isRunning() {
      return isRunning;
    },
    get isActive() {
      return pomodoroSessionActive();
    },
    get completedPomodoros() {
      return completedPomodoros;
    },
    get totalSecondsForPhase() {
      return phaseTotalSeconds;
    },
    get canAddFocusTime() {
      return canExtendFocusTime();
    },
    get canPauseResume() {
      return canPauseResumeSession();
    },
    get pausedPulseFrame() {
      return effects.currentPausedTrayPulseFrame();
    },
    get pausedPulseAmount() {
      return effects.currentPausedPulseAmount();
    },
    get formattedTime() {
      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;
      return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    },
    get activeBlockId() {
      return activeBlockId;
    },
    get dismissedBlockId() {
      return dismissedBlockId;
    },
    set dismissedBlockId(id: string | null) {
      if (forwardWindowCommand({ kind: "set-dismissed-block-id", id })) return;
      setDismissedBlockId(id);
    },
    get autoStartSuppressed() {
      return autoStartSuppressed;
    },
    set autoStartSuppressed(value: boolean) {
      autoStartSuppressed = value;
    },
    get breakOvertimeSeconds() {
      return breakOvertimeSeconds;
    },
    get segments() {
      return segments;
    },
    get segmentVersion() {
      return segmentVersion;
    },
    get blockExpired() {
      return blockExpired;
    },
    clearBlockExpired() {
      if (forwardWindowCommand({ kind: "clear-block-expired" })) return;
      clearBlockExpiredInternal();
    },
    /** Transfer session to a new block ID without resetting state (after detachInstance creates a standalone). */
    async transferBlockId(newBlockId: string, newEndTime?: string) {
      if (forwardWindowCommand({ kind: "transfer-block-id", newBlockId, newEndTime })) return;
      await transferBlockIdInternal(newBlockId, newEndTime);
    },
    adoptTransferredBlockId(newBlockId: string, newEndTime?: string) {
      adoptTransferredBlockIdInternal(newBlockId, newEndTime);
    },
    get suspendedAway() {
      return suspendedAway;
    },
    async dismissSuspend(resume: boolean) {
      if (forwardWindowCommand({ kind: "dismiss-suspend", resume })) return;
      await dismissSuspend(resume);
    },
    get idlePaused() {
      return idlePaused;
    },
    async dismissIdle(resume: boolean) {
      if (forwardWindowCommand({ kind: "dismiss-idle", resume })) return;
      await idleController.dismiss(resume);
    },
    async markIdleFocusFailed(failedAtMs: number | null = null) {
      if (forwardWindowCommand({
        kind: "mark-idle-focus-failed",
        failedAtMs: failedAtMs ?? undefined,
      })) return;
      await idleController.markFocusFailed(failedAtMs);
    },
    async startFromBlock(
      blockId: string,
      blockConfig: PomodoroConfig,
      eventEnd?: string,
      eventDate?: string,
      blockIdleTimeoutMinutes?: number | null,
      syncIdleTimeoutOnExistingBlock?: boolean,
      adaptivePlannedBlocks?: PomodoroAdaptivePlannedBlockWrite[],
    ) {
      if (forwardWindowCommand({
        kind: "start-from-block",
        blockId,
        blockConfig,
        eventEnd,
        eventDate,
        blockIdleTimeoutMinutes,
        syncIdleTimeoutOnExistingBlock,
        adaptivePlannedBlocks,
      })) return;
      await startFromBlockInternal(
        blockId,
        blockConfig,
        eventEnd,
        eventDate,
        blockIdleTimeoutMinutes,
        syncIdleTimeoutOnExistingBlock,
        adaptivePlannedBlocks,
      );
    },
    setActiveIdleThresholdMinutes(minutes: number) {
      if (forwardWindowCommand({ kind: "set-active-idle-threshold-minutes", minutes })) return;
      idleController.setActiveThresholdMinutes(minutes);
    },
    async stopSession() {
      if (forwardWindowCommand({ kind: "stop-session" })) return;
      await stopSessionInternal();
    },
    async completeActiveBlockAt(endIso: string) {
      if (forwardWindowCommand({ kind: "complete-active-block-at", endIso })) return;
      await completeActiveBlockAtInternal(endIso);
    },
    pause() {
      if (forwardWindowCommand({ kind: "pause" })) return;
      pauseSession();
    },
    start() {
      if (forwardWindowCommand({ kind: "start" })) return;
      resumeSession();
    },
    skip() {
      if (forwardWindowCommand({ kind: "skip" })) return;
      skipSession();
    },
    addFocusTime(seconds: number = FOCUS_EXTENSION_SECONDS) {
      if (forwardWindowCommand({ kind: "add-focus-time", seconds })) return;
      addFocusTimeInternal(seconds);
    },
    /** Clean up orphaned segments from previous app sessions. Call once on startup. */
    async cleanupOrphans() {
      if (forwardWindowCommand({ kind: "cleanup-orphans" })) return;
      await cleanupOrphansInternal();
    },
  };
}
