import type { PomodoroPhase } from "@ganbaru-ai/shared-types";
import type {
  PauseInterval,
  PauseReason,
  PersistedSegment,
  SegmentPhase,
} from "$lib/components/calendar/types";
import { dbUrl } from "$lib/api/db";
import { writeDoomscrollingRuntimeState } from "$lib/api/doomscrolling";
import { APP_SOUND_IDS, playAppSound } from "$lib/app-sounds";
import { getMusicPlayer } from "$lib/stores/music-player.svelte";
import { getPreferences } from "$lib/stores/preferences.svelte";
import { computePlannedSegments } from "$lib/utils/pomodoro-segments";
import {
  type CountPomodoroRhythm,
  breakAfterFocusPosition,
  clonePomodoroConfig,
  focusDurationMinutesAtPosition,
  nextRhythmPosition,
  normalizeRhythmPosition,
  phaseDurationMinutesAtPosition,
  rhythmPositionCount,
} from "$lib/pomodoro/rhythm";
import {
  buildRunStartAdaptiveSnapshot,
  snapshotFromBoundaryAdaptiveDecision,
  snapshotFromRunStartAdaptiveDecision,
  type PomodoroAdaptiveDecisionEnvelopeWrite,
  type PomodoroAdaptivePlannedBlockWrite,
  type PomodoroBoundaryAdaptiveDecision,
  type PomodoroRunAdaptiveSnapshotWrite,
  type PomodoroRunStartAdaptiveDecision,
} from "$lib/pomodoro/adaptive/persistence";
import {
  normalizePauseForSegment,
  normalizeSegmentEndIso,
} from "./pomodoro-segment-intervals";
import {
  buildPomodoroSegmentUpdate,
  buildPomodoroSegmentWrite,
  nowIso,
  type PomodoroActiveEventReferenceTransfer,
  type PomodoroBackendWriteOptions,
  type PomodoroRunClosure,
  type PomodoroRunEndReason,
  type PomodoroRunEventType,
  type PomodoroRunEventWrite,
  type PomodoroRunWindowUpdate,
  type PomodoroRunWrite,
  type PomodoroSegmentEndReason,
  type PomodoroStartTrigger,
  type PomodoroTransitionRunWrite,
} from "./pomodoro-backend-writes";
import {
  decideBoundaryAdaptiveForState,
  decideRunStartAdaptiveForState,
  isAdaptiveCountConfig,
} from "./pomodoro-adaptive-decisions";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type PomodoroConfig,
  type TimerSnapshot,
  DEFAULT_CONFIG,
  TIME_MULTIPLIER,
  NOTIFICATION_THRESHOLD,
  BREAK_EXTENSION_SECONDS,
  MAX_BREAK_EXTENSION_SECONDS,
  BREAK_OVERTIME_RAIL_GRACE_SECONDS,
  MAX_BREAK_OVERTIME_SECONDS,
  IDLE_FOCUS_FAILURE_DELAY_SECONDS,
  IDLE_CHECK_MAX_INTERVAL_MS,
  limitRemainingSecondsToBlockEnd,
  phaseDurationSeconds,
  isPomodoroSessionActive,
  canPauseResumePomodoro,
  decideTick,
  decideAdvancePhase,
  decideTransition,
  decideStartFromBlock,
  decideReconfigure,
  decideIdleCheck,
  nextIdleCheckDelayMs,
} from "./pomodoro-machine";
import {
  createWindowSyncEnvelope,
  isForeignWindowSyncEnvelope,
  isWindowSyncEnvelope,
} from "$lib/window-sync";
import {
  cloneSegmentsForWindowSync,
  isPomodoroWindowCommand,
  isPomodoroWindowSnapshot,
  type IdlePauseState,
  type PomodoroWindowCommand,
  type PomodoroWindowSnapshot,
} from "./pomodoro-window-sync";

const POMODORO_WINDOW_SYNC_EVENT = "pomodoro-window-sync";
const POMODORO_WINDOW_COMMAND_EVENT = "pomodoro-window-command";
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
let pausedTrayPulseIntervalId: ReturnType<typeof setInterval> | null = null;
let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
let phaseAdvanceInFlight = false;
let pomodoroWriteQueue: Promise<void> = Promise.resolve();
let pausedTrayPulseFrame = $state(0);
let completedPomodoros = $state(0);
let sessionStartTime: string | null = null;
let skipNextBreak = false;
let listenersInitialized = false;
let windowSyncInitialized = false;
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
const PAUSED_PULSE_AMOUNTS = [
  0, 0, 0, 0, 0, 0.067, 0.25, 0.5, 0.75, 0.933, 1, 1, 1, 1, 1, 1,
  0.933, 0.75, 0.5, 0.25, 0.067, 0,
] as const;
const PAUSED_TRAY_PULSE_FRAME_COUNT = PAUSED_PULSE_AMOUNTS.length;
const PAUSED_TRAY_PULSE_FRAME_MS = 180;
let musicPausedByPomodoroPause = false;
let musicPauseInFlight: Promise<void> | null = null;
let pausedFocusNotificationTimeoutId: ReturnType<typeof setTimeout> | null = null;
let pausedFocusNotificationSuppressed = false;

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
let breakEndWarningTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Block expiry: set when the calendar event ends naturally (via tick).
// Keeps activeBlockId intact so the next checkActiveBlock can trigger
// transitionToBlock for focus inheritance to a successor block.
let blockExpired = $state(false);

// Suspend/wake detection
let lastTickMs: number | null = null;
let suspendedAway = $state<{ awaySeconds: number } | null>(null);

// Idle detection
let idleTimeoutMs: number | null = null; // null = disabled
let idleCheckTimeoutId: ReturnType<typeof setTimeout> | null = null;
let idleCheckGeneration = 0;
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

function publishWindowSnapshot(): void {
  if (!pomodoroCoordinator) return;
  writeCurrentDoomscrollingRuntimeState();
  emit(
    POMODORO_WINDOW_SYNC_EVENT,
    createWindowSyncEnvelope(buildWindowSnapshot()),
  ).catch((err) => console.warn("pomodoro window sync failed", err));
}

function sendWindowCommand(command: PomodoroWindowCommand): void {
  emit(
    POMODORO_WINDOW_COMMAND_EVENT,
    createWindowSyncEnvelope(command),
  ).catch((err) => console.warn("pomodoro window command failed", err));
}

function forwardWindowCommand(command: PomodoroWindowCommand): boolean {
  if (pomodoroCoordinator) return false;
  sendWindowCommand(command);
  return true;
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

function runPlannedEndForSegment(seg: PersistedSegment): string {
  return activeBlockEndMs === null ? seg.plannedEnd : new Date(activeBlockEndMs).toISOString();
}

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

function runWrite(
  runId: string,
  segmentId: string,
  eventId: string,
  eventDate: string,
  startedAt: string,
  plannedStart: string,
  plannedEnd: string,
  startTrigger: PomodoroStartTrigger,
  inheritedFocusMinutes = 0,
  inheritedRhythmPosition = 1,
  inheritedFromRunId: string | null = null,
  adaptiveSnapshotOverride?: PomodoroRunAdaptiveSnapshotWrite,
  adaptivePlannedBlocks: readonly PomodoroAdaptivePlannedBlockWrite[] = [],
): PomodoroRunWrite {
  const configSnapshot = clonePomodoroConfig(config);
  const adaptiveSnapshot = adaptiveSnapshotOverride ??
    (isAdaptiveCountConfig(configSnapshot)
      ? buildRunStartAdaptiveSnapshot({
          runId,
          segmentId,
          startedAt,
          plannedStart,
          plannedEnd,
          currentRhythm: configSnapshot.rhythm,
          idleDetectionEnabled: idleTimeoutMs !== null,
          plannedBlocks: adaptivePlannedBlocks,
        })
      : null);
  return {
    id: runId,
    eventId,
    eventDate,
    plannedStart,
    plannedEnd,
    startedAt,
    rhythm: configSnapshot.rhythm,
    rhythmSource: configSnapshot.rhythmSource,
    presetKey: configSnapshot.presetKey,
    idleTimeoutMinutes: idleTimeoutMs === null ? null : Math.round(idleTimeoutMs / 60000),
    eventTitleSnapshot: null,
    inheritedFocusMinutes,
    inheritedRhythmPosition,
    inheritedFromRunId,
    startTrigger,
    adaptiveSnapshot,
  };
}

function activeSegment(): PersistedSegment | null {
  return currentSegmentIndex >= 0 && currentSegmentIndex < segments.length
    ? segments[currentSegmentIndex]
    : null;
}

function runClosure(
  endedAt: string,
  endReason: PomodoroRunEndReason,
  segmentStatus: "completed" | "interrupted",
  segmentEndReason: PomodoroSegmentEndReason,
  eventType: PomodoroRunEventType,
): PomodoroRunClosure | null {
  if (!activeRunId) return null;
  const normalizedEndedAt = normalizedActiveSegmentEndIso(endedAt);
  return {
    runId: activeRunId,
    endedAt: normalizedEndedAt,
    endReason,
    segmentStatus,
    segmentEndReason,
    eventType,
  };
}

function enqueuePomodoroWrite(operation: () => Promise<void>): Promise<void> {
  const queued = pomodoroWriteQueue.then(operation, operation);
  pomodoroWriteQueue = queued.catch(() => undefined);
  return queued;
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
    if (closure) await closeRunInBackend(closure, "Failed to close pomodoro run:", throwOnError);
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

function stopPausedTrayPulse(): void {
  if (pausedTrayPulseIntervalId !== null) {
    clearInterval(pausedTrayPulseIntervalId);
    pausedTrayPulseIntervalId = null;
  }
  pausedTrayPulseFrame = 0;
}

function currentPausedTrayPulseFrame(): number | null {
  return pausedFocusPulseActive() ? pausedTrayPulseFrame : null;
}

function currentPausedPulseAmount(): number | null {
  const frame = currentPausedTrayPulseFrame();
  if (frame === null) return null;
  return PAUSED_PULSE_AMOUNTS[frame % PAUSED_TRAY_PULSE_FRAME_COUNT];
}

function syncPausedTrayPulse(): void {
  if (!pomodoroCoordinator) return;
  if (!pausedFocusPulseActive()) {
    stopPausedTrayPulse();
    return;
  }
  if (pausedTrayPulseIntervalId !== null) return;

  pausedTrayPulseFrame = 0;
  pausedTrayPulseIntervalId = setInterval(() => {
    if (!pausedFocusPulseActive()) {
      stopPausedTrayPulse();
      updateTray({ publishSnapshot: false });
      return;
    }

    pausedTrayPulseFrame = (pausedTrayPulseFrame + 1) % PAUSED_TRAY_PULSE_FRAME_COUNT;
    updateTray({ publishSnapshot: false });
  }, PAUSED_TRAY_PULSE_FRAME_MS);
}

function clearPausedFocusNotificationTimeout(): void {
  if (pausedFocusNotificationTimeoutId === null) return;
  clearTimeout(pausedFocusNotificationTimeoutId);
  pausedFocusNotificationTimeoutId = null;
}

function resetPausedFocusNotificationState(): void {
  clearPausedFocusNotificationTimeout();
  pausedFocusNotificationSuppressed = false;
}

function suppressPausedFocusNotificationsForCurrentPause(): void {
  pausedFocusNotificationSuppressed = true;
  clearPausedFocusNotificationTimeout();
}

function pausedFocusNotificationIntervalMs(): number {
  const minutes = getPreferences().focusPauseNotificationIntervalMinutes;
  return minutes > 0 ? minutes * 60_000 : 0;
}

function showPausedFocusNotification(): void {
  invoke("show_paused_focus_notification").catch((error) => {
    console.warn("Failed to show paused focus notification:", error);
  });
}

function scheduleNextPausedFocusNotification(): void {
  if (pausedFocusNotificationTimeoutId !== null) return;
  if (pausedFocusNotificationSuppressed || !pausedFocusPulseActive()) return;

  const delayMs = pausedFocusNotificationIntervalMs();
  if (delayMs <= 0) return;

  pausedFocusNotificationTimeoutId = setTimeout(() => {
    pausedFocusNotificationTimeoutId = null;
    if (pausedFocusNotificationSuppressed || !pausedFocusPulseActive()) return;
    if (pausedFocusNotificationIntervalMs() <= 0) return;
    showPausedFocusNotification();
    scheduleNextPausedFocusNotification();
  }, delayMs);
}

function syncPausedFocusNotification(): void {
  if (!pomodoroCoordinator) return;
  if (
    pausedFocusNotificationSuppressed ||
    !pausedFocusPulseActive() ||
    pausedFocusNotificationIntervalMs() <= 0
  ) {
    clearPausedFocusNotificationTimeout();
    return;
  }
  scheduleNextPausedFocusNotification();
}

function expirePausedBlockAtDeadline(): void {
  if (activeBlockEndMs === null) return;
  clearBreakEndWarning();
  clearMusicPausedByPomodoro();
  resetPausedFocusNotificationState();
  const endIso = new Date(activeBlockEndMs).toISOString();
  stopPausedOpportunityCountdown();
  refreshPausedOpportunityRemaining(activeBlockEndMs);

  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const segment = segments[currentSegmentIndex];
    if (segment.status === "active") {
      void markSegment(currentSegmentIndex, "interrupted", true, endIso, "event_expired");
    }
    void skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
  }

  void closeActiveRun(endIso, "completed", "interrupted", "event_expired", "complete");
  sessionStartTime = null;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopOvertime();
  stopIdleChecking();
  isRunning = false;
  lastTickMs = null;
  phaseEndTime = null;
  remainingSeconds = 0;
  blockExpired = true;
  updateTray();
}

async function expirePausedBlockAtDeadlineAndWait(): Promise<void> {
  if (activeBlockEndMs === null) return;
  clearBreakEndWarning();
  clearMusicPausedByPomodoro();
  resetPausedFocusNotificationState();
  const endIso = new Date(activeBlockEndMs).toISOString();
  stopPausedOpportunityCountdown();
  refreshPausedOpportunityRemaining(activeBlockEndMs);

  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const segment = segments[currentSegmentIndex];
    if (segment.status === "active") {
      await markSegment(currentSegmentIndex, "interrupted", true, endIso, "event_expired");
    }
    await skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
  }

  await closeActiveRun(endIso, "completed", "interrupted", "event_expired", "complete");
  sessionStartTime = null;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopOvertime();
  stopIdleChecking();
  isRunning = false;
  lastTickMs = null;
  phaseEndTime = null;
  remainingSeconds = 0;
  blockExpired = true;
  updateTray();
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
    if (refreshPausedOpportunityRemaining()) updateTray();
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
  const seg = activeSegment();
  if (seg && seg.phase === "focus" && seg.status === "active") {
    seg.plannedEnd = new Date(new Date(seg.plannedEnd).getTime() + seconds * 1000).toISOString();
    persistSegmentToBackend(seg, "Failed to save focus extension:", true, occurredAt);
  }
  updateTray();
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
  scheduleBreakEndWarning();

  const seg = activeSegment();
  if (seg && isBreakPhase(seg.phase) && seg.status === "active") {
    seg.plannedEnd = new Date(new Date(seg.plannedEnd).getTime() + addedVisibleSeconds * 1000).toISOString();
    persistSegmentToBackend(seg, "Failed to save break extension:", true);
  }
  updateTray();
}

function cappedActiveBreakEndIso(actualEndMs: number = Date.now()): string {
  const seg = activeSegment();
  if (!seg || !isBreakPhase(seg.phase)) return new Date(actualEndMs).toISOString();

  const plannedEndMs = new Date(seg.plannedEnd).getTime();
  const cappedEndMs = Math.min(
    actualEndMs,
    plannedEndMs + BREAK_OVERTIME_RAIL_GRACE_SECONDS * 1000,
  );
  return new Date(cappedEndMs).toISOString();
}

function addMinutesToIso(base: string, minutes: number): string {
  const d = new Date(base);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

function eventDateFromBlockId(blockId: string): string | null {
  return blockId.split("::")[1] ?? null;
}

function persistSegmentsToBackend(
  updatedSegments: PersistedSegment[],
  warning: string,
  bumpSegmentVersion: boolean,
  occurredAt: string | null = null,
  throwOnError = false,
): Promise<void> {
  const persisted = updatedSegments.filter((segment) => segment.status !== "planned" && segment.status !== "skipped");
  if (persisted.length === 0) return Promise.resolve();
  return enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_update_segments", {
      dbUrl: dbUrl(),
      segments: persisted.map((segment) =>
        buildPomodoroSegmentUpdate(segment, segmentEndReasonFor(segment), occurredAt),
      ),
    });
    if (bumpSegmentVersion) {
      segmentVersion++;
      publishWindowSnapshot();
    }
  }).catch((e) => {
    console.warn(warning, e);
    if (throwOnError) throw e;
  });
}

function persistSegmentToBackend(
  seg: PersistedSegment,
  warning: string,
  bumpSegmentVersion: boolean,
  occurredAt: string | null = null,
  throwOnError = false,
): Promise<void> {
  return persistSegmentsToBackend([seg], warning, bumpSegmentVersion, occurredAt, throwOnError);
}

async function insertSegmentsToBackend(newSegments: PersistedSegment[]) {
  const persisted = newSegments.filter((segment) => segment.status !== "planned" && segment.status !== "skipped");
  if (persisted.length === 0) return;
  await enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_insert_segments", {
      dbUrl: dbUrl(),
      segments: persisted.map(buildPomodoroSegmentWrite),
    });
    segmentVersion++;
    publishWindowSnapshot();
  }).catch((e) => console.warn("Failed to insert segments:", e));
}

async function insertSegmentWithAdaptiveDecisionToBackend(
  segment: PersistedSegment,
  adaptiveDecision: PomodoroAdaptiveDecisionEnvelopeWrite,
) {
  await enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_insert_segment_with_adaptive_decision", {
      dbUrl: dbUrl(),
      segment: buildPomodoroSegmentWrite(segment),
      adaptiveDecision,
    });
    segmentVersion++;
    publishWindowSnapshot();
  }).catch((e) => console.warn("Failed to insert adaptive boundary segment:", e));
}

function completePomodoroBackendWrite(options: PomodoroBackendWriteOptions = {}): void {
  if (options.bumpSegmentVersion !== false) segmentVersion++;
  if (options.publishSnapshot !== false) publishWindowSnapshot();
}

async function startRunInBackend(
  run: PomodoroRunWrite,
  segment: PersistedSegment,
  options: PomodoroBackendWriteOptions = {},
): Promise<void> {
  await enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_start_run", {
      dbUrl: dbUrl(),
      run,
      segment: buildPomodoroSegmentWrite(segment),
    });
    completePomodoroBackendWrite(options);
  });
}

async function transitionRunInBackend(
  transition: PomodoroTransitionRunWrite,
  options: PomodoroBackendWriteOptions = {},
): Promise<void> {
  await enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_transition_run", {
      dbUrl: dbUrl(),
      transition,
    });
    completePomodoroBackendWrite(options);
  });
}

function closeRunInBackend(
  closure: PomodoroRunClosure,
  warning = "Failed to close pomodoro run:",
  throwOnError = false,
): Promise<void> {
  return enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_close_run", {
      dbUrl: dbUrl(),
      closure,
    });
    segmentVersion++;
    publishWindowSnapshot();
  }).catch((e) => {
    console.warn(warning, e);
    if (throwOnError) throw e;
  });
}

function updateRunWindowInBackend(update: PomodoroRunWindowUpdate): void {
  enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_update_run_window", {
      dbUrl: dbUrl(),
      update,
    });
  }).catch((e) => console.warn("Failed to update pomodoro run window:", e));
}

function transferActiveEventReferenceInBackend(
  transfer: PomodoroActiveEventReferenceTransfer,
): Promise<void> {
  return enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_transfer_active_event_reference", {
      dbUrl: dbUrl(),
      transfer,
    });
    segmentVersion++;
    publishWindowSnapshot();
  }).catch((e) => console.warn("Failed to transfer pomodoro event reference:", e));
}

function recordRunEvent(event: PomodoroRunEventWrite, warning = "Failed to record pomodoro event:"): void {
  enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_record_run_event", {
      dbUrl: dbUrl(),
      event,
    });
  }).catch((e) => console.warn(warning, e));
}

function recordManualPhaseAdvanceEvent(occurredAt: string): void {
  if (!activeRunId) return;
  const seg = activeSegment();
  if (phase === "focus" && seg?.status === "active") {
    recordRunEvent({
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
    recordRunEvent({
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
  invoke("pomodoro_heartbeat", {
    dbUrl: dbUrl(),
    runId: activeRunId,
    heartbeatAt: nowIso(),
  }).catch((e) => console.warn("Failed to update pomodoro heartbeat:", e));
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

function skipPlannedSegmentsAfter(index: number, warning: string): Promise<void> {
  const updated: PersistedSegment[] = [];
  for (let i = index + 1; i < segments.length; i++) {
    if (segments[i].status === "planned") {
      segments[i].status = "skipped";
      updated.push(segments[i]);
    }
  }
  return persistSegmentsToBackend(updated, warning, true);
}

function timestampMs(value: string): number {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return ms;
}

function appendPause(seg: PersistedSegment, startedAt: string, reason: PauseReason, endedAt: string | null = null) {
  seg.pauseLog = [
    ...seg.pauseLog,
    normalizePauseForSegment(seg, { startedAt, endedAt, reason }),
  ];
}

function closeLastPause(seg: PersistedSegment, endedAt: string): boolean {
  const lastPause = seg.pauseLog[seg.pauseLog.length - 1];
  if (!lastPause || lastPause.endedAt !== null) return false;
  const updated = [...seg.pauseLog];
  updated[updated.length - 1] = normalizePauseForSegment(seg, { ...lastPause, endedAt });
  seg.pauseLog = updated;
  return true;
}

function normalizedActiveSegmentEndIso(requestedEndIso: string): string {
  const seg = activeSegment();
  return seg ? normalizeSegmentEndIso(seg, requestedEndIso) : requestedEndIso;
}

function markSegment(
  index: number,
  status: PersistedSegment["status"],
  setActualEnd: boolean = false,
  actualEndIso: string = nowIso(),
  endReason: PomodoroSegmentEndReason | null = null,
  throwOnError = false,
): Promise<void> {
  if (index < 0 || index >= segments.length) return Promise.resolve();
  const seg = segments[index];
  seg.status = status;
  if (endReason) segmentEndReasons.set(seg.id, endReason);
  const normalizedActualEndIso = normalizeSegmentEndIso(seg, actualEndIso);
  if (setActualEnd) seg.actualEnd = normalizedActualEndIso;

  // Close any open pause interval
  closeLastPause(seg, seg.actualEnd ?? normalizedActualEndIso);

  publishWindowSnapshot();
  return persistSegmentToBackend(
    seg,
    "Failed to update segment:",
    true,
    normalizedActualEndIso,
    throwOnError,
  );
}

function activateSegment(index: number): Promise<void> {
  if (index < 0 || index >= segments.length) return Promise.resolve();
  const seg = segments[index];
  seg.status = "active";
  seg.actualStart = nowIso();
  currentSegmentIndex = index;

  const persisted = insertSegmentsToBackend([seg]).catch((e) => console.warn("Failed to activate segment:", e));
  publishWindowSnapshot();
  return persisted;
}

async function activateBoundarySegment(
  segment: PersistedSegment,
  adaptiveDecision: PomodoroBoundaryAdaptiveDecision | null,
): Promise<void> {
  const kept = currentSegmentIndex >= 0
    ? segments.slice(0, currentSegmentIndex + 1)
    : [];
  segments = [...kept, segment];
  currentSegmentIndex = kept.length;

  const persisted = adaptiveDecision && activeRunId
    ? insertSegmentWithAdaptiveDecisionToBackend(
        segment,
        snapshotFromBoundaryAdaptiveDecision(adaptiveDecision, {
          runId: activeRunId,
          segmentId: segment.id,
        }),
      )
    : insertSegmentsToBackend([segment]);
  publishWindowSnapshot();
  await persisted;
  refreshFutureSegmentsForActiveWindow(segment.eventId, segment.eventDate);
  publishWindowSnapshot();
}

function boundarySegment(
  phase: SegmentPhase,
  rhythmPosition: number,
  plannedStart: string,
): PersistedSegment | null {
  if (!activeRunId || !activeBlockId) return null;
  const eventDate = activeSegment()?.eventDate ?? eventDateFromBlockId(activeBlockId);
  if (!eventDate) return null;
  const plannedStartMs = Date.parse(plannedStart);
  const plannedEndMs = Number.isFinite(plannedStartMs)
    ? plannedStartMs + remainingSeconds * 1000
    : Date.now() + remainingSeconds * 1000;
  return {
    id: crypto.randomUUID(),
    eventId: activeBlockId,
    eventDate,
    runId: activeRunId,
    rhythmPosition,
    phase,
    plannedStart,
    plannedEnd: new Date(plannedEndMs).toISOString(),
    actualStart: plannedStart,
    actualEnd: null,
    pauseLog: [],
    status: "active",
  };
}

async function createSegments(
  eventId: string,
  eventEnd: string,
  eventDate: string,
  adaptivePlannedBlocks: readonly PomodoroAdaptivePlannedBlockWrite[] = [],
) {
  const runId = crypto.randomUUID();

  const now = new Date();
  const end = new Date(eventEnd.replace(" ", "T"));
  const baseIso = now.toISOString();
  const runStartAdaptiveDecision = await decideRunStartAdaptiveForState({
    config,
    idleDetectionEnabled: idleTimeoutMs !== null,
    startedAt: baseIso,
    plannedStart: baseIso,
    plannedEnd: end.toISOString(),
  });
  if (runStartAdaptiveDecision) {
    applyRunStartAdaptiveDecision(runStartAdaptiveDecision);
  }
  const remainingMinutes = Math.max(0, (end.getTime() - now.getTime()) / 60000);

  const planned = computePlannedSegments(config, remainingMinutes, 0, currentRhythmPosition);

  const newSegments: PersistedSegment[] = planned.map((s, i) => ({
    id: crypto.randomUUID(),
    eventId,
    eventDate,
    runId,
    rhythmPosition: s.rhythmPosition,
    phase: s.phase as SegmentPhase,
    plannedStart: addMinutesToIso(baseIso, s.startOffsetMinutes),
    plannedEnd: addMinutesToIso(baseIso, s.endOffsetMinutes),
    actualStart: i === 0 ? baseIso : null,
    actualEnd: null,
    pauseLog: [],
    status: i === 0 ? "active" as const : "planned" as const,
  }));

  const firstSegment = newSegments.find((segment) => segment.status === "active");
  if (firstSegment) {
    const startedAt = firstSegment.actualStart ?? baseIso;
    const adaptiveSnapshot = runStartAdaptiveDecision
      ? snapshotFromRunStartAdaptiveDecision(runStartAdaptiveDecision, {
          runId,
          segmentId: firstSegment.id,
          plannedBlocks: adaptivePlannedBlocks,
        })
      : undefined;
    try {
      await startRunInBackend(
        runWrite(
          runId,
          firstSegment.id,
          eventId,
          eventDate,
          startedAt,
          firstSegment.plannedStart,
          runPlannedEndForSegment(firstSegment),
          "block_auto",
          0,
          1,
          null,
          adaptiveSnapshot,
          adaptivePlannedBlocks,
        ),
        firstSegment,
      );
    } catch (e) {
      console.warn("Failed to start pomodoro run:", e);
      void stopSessionInternal();
      return;
    }
    activeRunId = runId;
    startHeartbeat();
  }
  segments = newSegments;
  currentSegmentIndex = 0;
  publishWindowSnapshot();
}

function clearSegments() {
  segments = [];
  currentSegmentIndex = -1;
  segmentEndReasons.clear();
}

/**
 * Marks old segments as completed/skipped, builds a new segment plan
 * (bridge for current phase remainder + future segments), and persists.
 * Used by both reconfigureSession and transitionToBlock.
 */
interface RebuildRunOptions {
  runEndReason: PomodoroRunEndReason;
  segmentStatus: "completed" | "interrupted";
  segmentEndReason: PomodoroSegmentEndReason;
  eventType: PomodoroRunEventType;
  startTrigger: PomodoroStartTrigger;
  inheritedFocusSeconds: number;
  inheritedRhythmPosition: number;
}

function plannedSegmentsAfterCurrentPhase(
  blockId: string,
  eventDate: string,
  runId: string,
  baseAfter: string,
  afterMinutes: number,
): PersistedSegment[] {
  const newSegments: PersistedSegment[] = [];
  let offset = 0;
  let nextIsFocus = phase !== "focus";
  let rhythmPosition = nextIsFocus
    ? nextRhythmPosition(config, currentRhythmPosition)
    : currentRhythmPosition;

  while (offset < afterMinutes) {
    if (nextIsFocus) {
      const focusDuration = focusDurationMinutesAtPosition(config, rhythmPosition);
      const duration = Math.min(focusDuration, afterMinutes - offset);
      newSegments.push({
        id: crypto.randomUUID(),
        eventId: blockId,
        eventDate,
        runId,
        rhythmPosition,
        phase: "focus",
        plannedStart: addMinutesToIso(baseAfter, offset),
        plannedEnd: addMinutesToIso(baseAfter, offset + duration),
        actualStart: null,
        actualEnd: null,
        pauseLog: [],
        status: "planned",
      });
      offset += duration;
      if (offset >= afterMinutes) break;
      nextIsFocus = false;
    } else {
      const breakInfo = breakAfterFocusPosition(config, rhythmPosition);
      const duration = Math.min(breakInfo.durationMinutes, afterMinutes - offset);
      newSegments.push({
        id: crypto.randomUUID(),
        eventId: blockId,
        eventDate,
        runId,
        rhythmPosition,
        phase: breakInfo.phase,
        plannedStart: addMinutesToIso(baseAfter, offset),
        plannedEnd: addMinutesToIso(baseAfter, offset + duration),
        actualStart: null,
        actualEnd: null,
        pauseLog: [],
        status: "planned",
      });
      offset += duration;
      rhythmPosition = nextRhythmPosition(config, rhythmPosition);
      nextIsFocus = true;
    }
  }

  return newSegments;
}

function refreshFutureSegmentsForActiveWindow(blockId: string, eventDate: string): void {
  if (!activeRunId || activeBlockEndMs === null) return;
  if (currentSegmentIndex < 0 || currentSegmentIndex >= segments.length) return;

  const nowMs = Date.now();
  const currentPhaseEndMs = nowMs + Math.max(0, remainingSeconds) * 1000;
  const afterMinutes = Math.max(0, (activeBlockEndMs - currentPhaseEndMs) / 60000);
  const baseAfter = new Date(currentPhaseEndMs).toISOString();
  segments = [
    ...segments.slice(0, currentSegmentIndex + 1),
    ...plannedSegmentsAfterCurrentPhase(blockId, eventDate, activeRunId, baseAfter, afterMinutes),
  ];
}

function applyActiveBlockWindowChange(blockId: string, newEndMs: number, eventDate?: string): void {
  activeBlockEndMs = newEndMs;
  refreshCurrentPhaseLimit();
  scheduleBreakEndWarning();
  if (activeRunId) {
    updateRunWindowInBackend({
      runId: activeRunId,
      plannedEnd: new Date(newEndMs).toISOString(),
    });
  }

  const segmentEventDate = eventDate ?? activeSegment()?.eventDate;
  if (segmentEventDate) {
    refreshFutureSegmentsForActiveWindow(blockId, segmentEventDate);
  }
  updateTray();
}

async function rebuildSegments(
  blockId: string,
  eventEnd: string,
  eventDate: string,
  options: RebuildRunOptions,
) {
  const previousSegments = cloneSegmentsForWindowSync(segments);
  const previousSegmentIndex = currentSegmentIndex;
  const previousEndReasons = new Map(segmentEndReasons);
  const workingSegments = cloneSegmentsForWindowSync(segments);
  const workingEndReasons = new Map(segmentEndReasons);
  const previousRunId = activeRunId;
  const runId = crypto.randomUUID();
  const now = new Date();
  const nowStr = now.toISOString();

  if (currentSegmentIndex >= 0 && currentSegmentIndex < workingSegments.length) {
    const seg = workingSegments[currentSegmentIndex];
    if (seg.status !== "completed" && seg.status !== "skipped" && seg.status !== "interrupted") {
      seg.status = options.segmentStatus;
      seg.actualEnd = nowStr;
      workingEndReasons.set(seg.id, options.segmentEndReason);
      closeLastPause(seg, nowStr);
    }
  }

  const end = new Date(eventEnd.replace(" ", "T"));
  const totalRemainingMinutes = Math.max(0, (end.getTime() - now.getTime()) / 60000);
  const bridgeMinutes = remainingSeconds / 60;
  const currentPhaseType: SegmentPhase = phase === "focus" ? "focus"
    : phase === "short_break" ? "short_break" : "long_break";

  const newSegments: PersistedSegment[] = [];

  // Bridge segment: remainder of current phase
  const isPaused = !isRunning && !overtimeIntervalId && !suspendedAway && !idlePaused;
  if (bridgeMinutes > 0) {
    newSegments.push({
      id: crypto.randomUUID(),
      eventId: blockId,
      eventDate,
      runId,
      rhythmPosition: currentRhythmPosition,
      phase: currentPhaseType,
      plannedStart: nowStr,
      plannedEnd: addMinutesToIso(nowStr, bridgeMinutes),
      actualStart: nowStr,
      actualEnd: null,
      pauseLog: isPaused ? [{ startedAt: nowStr, endedAt: null, reason: "manual" }] : [],
      status: "active",
    });
  }

  // Future segments after current phase ends
  const afterMinutes = totalRemainingMinutes - bridgeMinutes;
  if (afterMinutes > 0) {
    const baseAfter = addMinutesToIso(nowStr, bridgeMinutes);
    newSegments.push(...plannedSegmentsAfterCurrentPhase(blockId, eventDate, runId, baseAfter, afterMinutes));
  }

  // Preserve completed/interrupted segments so the green progress bar
  // keeps showing focus time accumulated before this rebuild.
  const kept = workingSegments.filter(
    (s, i) => i <= currentSegmentIndex &&
      (s.status === "completed" || s.status === "interrupted"),
  );

  const firstSegment = newSegments.find((segment) => segment.status === "active");
  if (firstSegment) {
    const startedAt = firstSegment.actualStart ?? nowStr;
    const run = runWrite(
      runId,
      firstSegment.id,
      blockId,
      eventDate,
      startedAt,
      firstSegment.plannedStart,
      runPlannedEndForSegment(firstSegment),
      options.startTrigger,
      Math.floor(options.inheritedFocusSeconds / 60),
      options.inheritedRhythmPosition,
      previousRunId,
    );
    try {
      if (previousRunId) {
        await transitionRunInBackend({
          closure: {
            runId: previousRunId,
            endedAt: nowStr,
            endReason: options.runEndReason,
            segmentStatus: options.segmentStatus,
            segmentEndReason: options.segmentEndReason,
            eventType: options.eventType,
          },
          run,
          segment: buildPomodoroSegmentWrite(firstSegment),
        }, { bumpSegmentVersion: false, publishSnapshot: false });
      } else {
        await startRunInBackend(run, firstSegment, { bumpSegmentVersion: false, publishSnapshot: false });
      }
    } catch (e) {
      console.warn("Failed to rebuild pomodoro run:", e);
      segments = previousSegments;
      currentSegmentIndex = previousSegmentIndex;
      segmentEndReasons.clear();
      for (const [id, reason] of previousEndReasons) {
        segmentEndReasons.set(id, reason);
      }
      publishWindowSnapshot();
      return;
    }
    activeRunId = runId;
    startHeartbeat();
  }

  segmentEndReasons.clear();
  for (const [id, reason] of workingEndReasons) {
    segmentEndReasons.set(id, reason);
  }
  segments = [...kept, ...newSegments];
  currentSegmentIndex = kept.length + (firstSegment ? newSegments.indexOf(firstSegment) : -1);
  segmentVersion++;
  publishWindowSnapshot();
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
  scheduleBreakEndWarning();

  if (result.resetNotification) {
    notificationShown = false;
  }

  await rebuildSegments(blockId, eventEnd, eventDate, {
    runEndReason: "reconfigured",
    segmentStatus: "completed",
    segmentEndReason: "reconfigured",
    eventType: "reconfigure",
    startTrigger: "reconfigure",
    inheritedFocusSeconds: phase === "focus" ? elapsedSeconds : 0,
    inheritedRhythmPosition: currentRhythmPosition,
  });
  updateTray();
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

      showBreakOverlay(remainingSeconds);
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
        startIdleChecking();
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
      startIdleChecking();
      break;
    }

    case "keep_break":
      // Break running as-is; after it ends, startFocusSession uses the new config.
      break;
  }

  blockExpired = false;
  await rebuildSegments(blockId, eventEnd, eventDate, {
    runEndReason: "block_transition",
    segmentStatus: "interrupted",
    segmentEndReason: "block_transition",
    eventType: "block_transition",
    startTrigger: "block_transition",
    inheritedFocusSeconds,
    inheritedRhythmPosition,
  });
  updateTray();
}

// Tray

interface UpdateTrayOptions {
  publishSnapshot?: boolean;
}

interface PomodoroTrayUpdatePayload {
  phase: PomodoroPhase;
  remainingSeconds: number;
  totalSeconds: number;
  isRunning: boolean;
  isActive: boolean;
  canPauseResume: boolean;
  canAddFocusTime: boolean;
  pausedPulseFrame: number | null;
}

function updateTray(options: UpdateTrayOptions = {}) {
  if (options.publishSnapshot !== false) publishWindowSnapshot();
  if (!pomodoroCoordinator) return;
  writeCurrentDoomscrollingRuntimeState();
  syncPausedTrayPulse();
  syncPausedFocusNotification();
  const isActive = pomodoroSessionActive();
  const update: PomodoroTrayUpdatePayload = {
    phase,
    remainingSeconds,
    totalSeconds: phaseTotalSeconds,
    isRunning,
    isActive,
    canPauseResume: canPauseResumeSession(),
    canAddFocusTime: canExtendFocusTime(),
    pausedPulseFrame: currentPausedTrayPulseFrame(),
  };

  invoke("update_tray", { update }).catch(() => {});
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
      setActiveIdleThresholdMinutesInternal(command.minutes);
      return;
    case "dismiss-suspend":
      void dismissSuspend(command.resume);
      return;
    case "dismiss-idle":
      void dismissIdle(command.resume);
      return;
    case "mark-idle-focus-failed":
      void markIdleFocusFailed(command.failedAtMs ?? null);
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

function initWindowSync() {
  if (windowSyncInitialized) return;
  windowSyncInitialized = true;

  listen<unknown>(POMODORO_WINDOW_SYNC_EVENT, (event) => {
    const envelope = event.payload;
    if (!isWindowSyncEnvelope(envelope, isPomodoroWindowSnapshot)) return;
    if (!isForeignWindowSyncEnvelope(envelope)) return;
    applyWindowSnapshot(envelope.payload);
  }).catch((err) => console.warn("pomodoro window sync listener failed", err));

  listen<unknown>(POMODORO_WINDOW_COMMAND_EVENT, (event) => {
    const envelope = event.payload;
    if (!isWindowSyncEnvelope(envelope, isPomodoroWindowCommand)) return;
    if (!isForeignWindowSyncEnvelope(envelope)) return;
    handleWindowCommand(envelope.payload);
  }).catch((err) => console.warn("pomodoro window command listener failed", err));

  if (!pomodoroCoordinator) {
    sendWindowCommand({ kind: "request-snapshot" });
  } else {
    publishWindowSnapshot();
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
        recordRunEvent({
          runId: activeRunId,
          segmentId: activeSegment()?.id ?? null,
          eventType: "skip_break",
          occurredAt,
          phase,
          reason: "skipped_by_user",
          durationSeconds: null,
        }, "Failed to record skipped break:");
      }
      void (async () => {
        await markSegment(currentSegmentIndex, "interrupted", true, occurredAt, "skipped_by_user");
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
        await markSegment(currentSegmentIndex, "completed", true, cappedActiveBreakEndIso());
        await startFocusSession();
      })();
    }
  }).catch((e) => console.warn("Failed to listen for pomodoro-break-acknowledged:", e));

  listen<{ seconds: number }>("pomodoro-break-extended", (event) => {
    addBreakTimeInternal(event.payload.seconds);
  }).catch((e) => console.warn("Failed to listen for pomodoro-break-extended:", e));

  listen("idle-overlay-resume", () => {
    if (idlePaused) void dismissIdle(true);
  }).catch((e) => console.warn("Failed to listen for idle-overlay-resume:", e));

  listen<{ failedAtMs?: number }>("idle-overlay-focus-failed", (event) => {
    if (!idlePaused) return;
    const failedAtMs = event.payload.failedAtMs;
    void markIdleFocusFailed(
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
    updateTray();
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
    suppressPausedFocusNotificationsForCurrentPause();
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

function clearBreakEndWarning(): void {
  if (breakEndWarningTimeoutId === null) return;
  clearTimeout(breakEndWarningTimeoutId);
  breakEndWarningTimeoutId = null;
}

function scheduleBreakEndWarning(): void {
  clearBreakEndWarning();
  if (!isRunning || !isBreakPhase(phase) || phaseEndTime === null) return;

  const warningSeconds = getPreferences().focusBreakEndWarningSeconds;
  if (warningSeconds <= 0) return;

  const targetMs = phaseEndTime - warningSeconds * 1000;
  const delayMs = targetMs - Date.now();
  if (delayMs <= 0) return;

  breakEndWarningTimeoutId = setTimeout(() => {
    breakEndWarningTimeoutId = null;
    if (!isRunning || !isBreakPhase(phase) || phaseEndTime === null) return;
    playAppSound(APP_SOUND_IDS.breakFinished).catch(() => {});
  }, delayMs);
}

function clearMusicPausedByPomodoro(): void {
  musicPausedByPomodoroPause = false;
  musicPauseInFlight = null;
}

function pauseMusicForPomodoroPause(): void {
  if (
    !pomodoroCoordinator
    || phase !== "focus"
    || !pomodoroSessionActive()
    || !getPreferences().musicPauseOnPomodoroPause
  ) {
    clearMusicPausedByPomodoro();
    return;
  }
  const music = getMusicPlayer();
  if (!music.isPlaying) {
    clearMusicPausedByPomodoro();
    return;
  }
  musicPausedByPomodoroPause = true;
  const trackedPause = music.pausePlayback().catch((error) => {
    console.warn("Failed to pause music with pomodoro:", error);
  });
  musicPauseInFlight = trackedPause;
  void trackedPause.finally(() => {
    if (musicPauseInFlight === trackedPause) musicPauseInFlight = null;
  });
}

function resumeMusicFromPomodoroPause(): void {
  if (!musicPausedByPomodoroPause) return;
  musicPausedByPomodoroPause = false;
  if (!pomodoroCoordinator || !getPreferences().musicPauseOnPomodoroPause) return;
  const music = getMusicPlayer();
  const pausePromise = musicPauseInFlight;
  musicPauseInFlight = null;
  void (async () => {
    if (pausePromise) await pausePromise;
    if (!music.currentSource || music.isPlaying || music.isBusy) return;
    await music.playPlayback();
  })().catch((error) => {
    console.warn("Failed to resume music with pomodoro:", error);
  });
}

async function startFocusSession() {
  closePomodoroOverlay();
  clearBreakEndWarning();
  clearMusicPausedByPomodoro();
  resetPausedFocusNotificationState();
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
    activeSegmentPlannedEnd: activeSegment()?.plannedEnd ?? null,
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
    const segment = boundarySegment("focus", currentRhythmPosition, startedAt);
    if (segment) {
      await activateBoundarySegment(segment, adaptiveDecision);
    } else {
      const nextFocus = segments.findIndex(
        (s, i) => i > currentSegmentIndex && s.phase === "focus" && s.status === "planned",
      );
      if (nextFocus !== -1) {
        await activateSegment(nextFocus);
      }
    }
  } else {
    const nextFocus = segments.findIndex(
      (s, i) => i > currentSegmentIndex && s.phase === "focus" && s.status === "planned",
    );
    if (nextFocus !== -1) {
      await activateSegment(nextFocus);
    }
  }

  updateTray();
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
    scheduleBreakEndWarning();
    startIdleChecking();
    updateTray();
  } else {
    clearBreakEndWarning();
    const seg = activeSegment();
    const lastPause = seg?.pauseLog[seg.pauseLog.length - 1];
    const endIso = lastPause ? lastPause.startedAt : nowIso();
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      await markSegment(currentSegmentIndex, "interrupted", true, endIso, "stopped");
      await skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
    }
    await closeActiveRun(endIso, "stopped", "interrupted", "stopped", "stop");
    suspendedAway = null;
    stopOvertime();
    stopIdleChecking();
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
    clearSegments();
    updateTray();
  }
}

// Idle detection

interface IdleStatus {
  idle_ms: number;
  webcam_in_use: boolean;
}

function startIdleChecking() {
  stopIdleChecking();
  if (!shouldRunIdleChecks()) return;
  scheduleIdleCheck(0, idleCheckGeneration);
}

function setActiveIdleThresholdMinutesInternal(minutes: number): void {
  if (!Number.isFinite(minutes) || minutes <= 0 || idleTimeoutMs === null) return;
  const nextIdleMs = Math.round(minutes) * 60_000;
  setActiveIdleTimeoutMs(nextIdleMs);
}

function setActiveIdleTimeoutMs(nextIdleMs: number | null): void {
  if (idleTimeoutMs === nextIdleMs) return;
  idleTimeoutMs = nextIdleMs;
  if (nextIdleMs === null) {
    stopIdleChecking();
  } else {
    startIdleChecking();
  }
  updateTray();
}

function stopIdleChecking() {
  idleCheckGeneration += 1;
  if (idleCheckTimeoutId !== null) {
    clearTimeout(idleCheckTimeoutId);
    idleCheckTimeoutId = null;
  }
}

function shouldRunIdleChecks(): boolean {
  return (
    isRunning &&
    phase === "focus" &&
    suspendedAway === null &&
    idlePaused === null &&
    idleTimeoutMs !== null
  );
}

function scheduleIdleCheck(delayMs: number, generation: number): void {
  if (idleCheckTimeoutId !== null) clearTimeout(idleCheckTimeoutId);
  idleCheckTimeoutId = setTimeout(() => {
    idleCheckTimeoutId = null;
    void checkIdle(generation);
  }, Math.max(0, Math.floor(delayMs)));
}

function idleFocusFailedAtMs(state: IdlePauseState): number {
  return state.overlayStartedAtMs + IDLE_FOCUS_FAILURE_DELAY_SECONDS * 1000;
}

function failedIdleSegmentEndIso(state: IdlePauseState): string {
  const seg = activeSegment();
  const lastPause = seg?.pauseLog[seg.pauseLog.length - 1];
  return lastPause?.startedAt ?? new Date(state.idleStartMs).toISOString();
}

async function markIdleFocusFailed(failedAtMs: number | null = null): Promise<void> {
  const state = idlePaused;
  if (!state || state.focusFailed) return;
  const normalizedFailedAtMs = failedAtMs ?? idleFocusFailedAtMs(state);
  idlePaused = {
    ...state,
    focusFailed: true,
    focusFailedAtMs: normalizedFailedAtMs,
  };
  stopPausedOpportunityCountdown();
  stopIdleChecking();

  const seg = activeSegment();
  if (seg && seg.status === "active" && currentSegmentIndex >= 0) {
    const endIso = failedIdleSegmentEndIso(state);
    await markSegment(currentSegmentIndex, "interrupted", true, endIso, "focus_failed");
  }

  if (activeRunId) {
    recordRunEvent({
      runId: activeRunId,
      segmentId: seg?.id ?? null,
      eventType: "focus_failed",
      occurredAt: new Date(normalizedFailedAtMs).toISOString(),
      phase: "focus",
      reason: "long_idle",
      durationSeconds: IDLE_FOCUS_FAILURE_DELAY_SECONDS,
    }, "Failed to record focus failure:");
  }
  updateTray();
}

async function restartFocusAfterFailedIdle(): Promise<void> {
  if (!idlePaused) return;

  if (activeBlockDeadlineReached()) {
    idlePaused = null;
    await expirePausedBlockAtDeadlineAndWait();
    return;
  }

  const blockId = activeBlockId;
  const runId = activeRunId;
  const eventDate = activeSegment()?.eventDate ?? (blockId ? eventDateFromBlockId(blockId) : null);
  if (!blockId || !runId || !eventDate || activeBlockEndMs === null) {
    await dismissIdle(false);
    return;
  }

  clearMusicPausedByPomodoro();
  stopPausedOpportunityCountdown();
  stopOvertime();
  phase = "focus";
  resetFocusNotificationState();
  const nowMs = Date.now();
  const remaining = setPhaseRemainingSeconds(
    focusDurationMinutesAtPosition(config, currentRhythmPosition) * TIME_MULTIPLIER,
    0,
    nowMs,
  );
  if (remaining <= 0) {
    idlePaused = null;
    await expirePausedBlockAtDeadlineAndWait();
    return;
  }

  const now = new Date(nowMs).toISOString();
  const phaseEndMs = nowMs + remaining * 1000;
  const newSegment: PersistedSegment = {
    id: crypto.randomUUID(),
    eventId: blockId,
    eventDate,
    runId,
    rhythmPosition: currentRhythmPosition,
    phase: "focus",
    plannedStart: now,
    plannedEnd: new Date(phaseEndMs).toISOString(),
    actualStart: now,
    actualEnd: null,
    pauseLog: [],
    status: "active",
  };
  const kept = segments.filter(
    (segment, index) =>
      index <= currentSegmentIndex &&
      (segment.status === "completed" || segment.status === "interrupted"),
  );
  const previousPhase = phase;
  phase = "focus";
  const afterMinutes = Math.max(0, (activeBlockEndMs - phaseEndMs) / 60000);
  const futureSegments = plannedSegmentsAfterCurrentPhase(
    blockId,
    eventDate,
    runId,
    newSegment.plannedEnd,
    afterMinutes,
  );
  phase = previousPhase;

  segments = [...kept, newSegment, ...futureSegments];
  currentSegmentIndex = kept.length;
  idlePaused = null;
  isRunning = true;
  phaseEndTime = phaseEndMs;
  sessionStartTime = now;
  lastTickMs = nowMs;
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(tick, 1000);
  startIdleChecking();
  await insertSegmentsToBackend([newSegment]);
  updateTray();
}

async function checkIdle(generation: number = idleCheckGeneration) {
  if (generation !== idleCheckGeneration || !shouldRunIdleChecks()) return;
  let nextDelayMs = IDLE_CHECK_MAX_INTERVAL_MS;
  try {
    const status = await invoke<IdleStatus>("get_idle_status");
    if (generation !== idleCheckGeneration || !shouldRunIdleChecks()) return;
    const nowMs = Date.now();
    const currentIdleTimeoutMs = idleTimeoutMs;
    if (currentIdleTimeoutMs === null) return;
    nextDelayMs = nextIdleCheckDelayMs({
      idleTimeoutMs: currentIdleTimeoutMs,
      idleMs: status.idle_ms,
      webcamInUse: status.webcam_in_use,
    });

    const result = decideIdleCheck(
      {
        isRunning,
        phase,
        suspendedAway: suspendedAway !== null,
        idlePaused: idlePaused !== null,
        idleTimeoutMs: currentIdleTimeoutMs,
        webcamInUse: status.webcam_in_use,
        idleMs: status.idle_ms,
        phaseEndTime,
      },
      nowMs,
    );

    if (result.kind === "skip") return;

    const idleStartIso = new Date(result.idleStartMs).toISOString();

    // Record synthetic pause on current segment
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      const seg = segments[currentSegmentIndex];
      appendPause(seg, idleStartIso, "idle");
      persistSegmentToBackend(seg, "Failed to save idle pause:", false);
    }

    const elapsedAtIdleStart = Math.max(
      0,
      actualPhaseElapsedSeconds() - result.idleSeconds,
    );
    setVisibleRemainingForPause(
      result.preSuspendRemainingSeconds,
      elapsedAtIdleStart,
      result.idleStartMs,
    );
    phaseEndTime = null;

    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    isRunning = false;
    lastTickMs = null;

    const overlayStartedAtMs = Date.now();
    idlePaused = {
      idleSeconds: result.idleSeconds,
      nativeOverlay: true,
      idleStartMs: result.idleStartMs,
      overlayStartedAtMs,
      focusFailed: false,
      focusFailedAtMs: null,
    };
    updateTray();

    // Show the enforced fullscreen idle overlay. If native setup fails,
    // the main window falls back to the Svelte overlay component.
    let nativeOverlay = false;
    try {
      nativeOverlay = await invoke<boolean>("show_idle_overlay", {
        idleSeconds: result.idleSeconds,
      });
    } catch (e) {
      console.warn("Failed to show idle overlay:", e);
    }
    if (
      idlePaused?.idleStartMs === result.idleStartMs &&
      idlePaused.overlayStartedAtMs === overlayStartedAtMs &&
      idlePaused.nativeOverlay !== nativeOverlay
    ) {
      idlePaused = {
        ...idlePaused,
        nativeOverlay,
      };
      updateTray();
    }
  } catch (e) {
    console.warn("Idle check failed:", e);
  } finally {
    if (generation === idleCheckGeneration && shouldRunIdleChecks()) {
      scheduleIdleCheck(nextDelayMs, generation);
    }
  }
}

async function dismissIdle(resume: boolean): Promise<void> {
  closePomodoroOverlay();
  stopPausedOpportunityCountdown();
  const state = idlePaused;
  if (resume) {
    if (state?.focusFailed) {
      await restartFocusAfterFailedIdle();
      return;
    }
    // Close the open pause interval
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      const seg = segments[currentSegmentIndex];
      if (closeLastPause(seg, nowIso())) {
        await persistSegmentToBackend(seg, "Failed to close idle pause:", false);
      }
    }
    idlePaused = null;
    // Clear cached end time so tick() won't auto-stop with stale data.
    // The next checkActiveBlock (triggered by idlePaused going null)
    // will call startFromBlock with fresh event times.
    activeBlockEndMs = null;
    isRunning = true;
    phaseEndTime = Date.now() + remainingSeconds * 1000;
    lastTickMs = Date.now();
    intervalId = setInterval(tick, 1000);
    updateTray();
  } else {
    const seg = activeSegment();
    const lastPause = seg?.pauseLog[seg.pauseLog.length - 1];
    const endIso = lastPause ? lastPause.startedAt : nowIso();
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      if (segments[currentSegmentIndex].status === "active") {
        await markSegment(currentSegmentIndex, "interrupted", true, endIso, "stopped");
      }
      await skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
    }
    await closeActiveRun(endIso, "stopped", "interrupted", "stopped", "stop");
    idlePaused = null;
    stopOvertime();
    isRunning = false;
    phaseEndTime = null;
    dismissedBlockId = activeBlockId;
    activeBlockId = null;
    activeBlockEndMs = null;
    lastTickMs = null;
    phase = "focus";
    resetPhaseProgress(DEFAULT_FOCUS_SECONDS);
    currentRhythmPosition = 1;
    completedPomodoros = 0;
    sessionStartTime = null;
    skipNextBreak = false;
    resetFocusNotificationState();
    stopIdleChecking();
    clearSegments();
    updateTray();
  }
}

function showBreakOverlay(breakSeconds: number) {
  initListeners();
  const breakEndsAtMs = Math.max(
    0,
    Math.floor(phaseEndTime ?? (Date.now() + breakSeconds * 1000)),
  );
  invoke("show_break_overlay", {
    breakEndsAtMs,
    breakEndEscPresses: getPreferences().focusBreakEndEscPresses,
    breakExtensionLimit: getPreferences().focusBreakExtensionLimit,
  }).catch((e) =>
    console.warn("Failed to show break overlay:", e),
  );
  scheduleBreakEndWarning();
}

function closePomodoroOverlay(): void {
  invoke("close_pomodoro_overlay").catch((e) =>
    console.warn("Failed to close pomodoro overlay:", e),
  );
}

function showNotification() {
  if (notificationShown) return;
  notificationShown = true;

  invoke("show_pomodoro_notification", {
    remainingSeconds: NOTIFICATION_THRESHOLD,
    allowAddTime: canExtendFocusTime(),
  }).catch((e) => {
    console.warn("Failed to show notification:", e);
    notificationShown = false;
  });
}

// Timer

function tick() {
  const now = Date.now();
  const result = decideTick(buildSnapshot(), now);

  switch (result.kind) {
    case "suspend_and_block_expired": {
      closePomodoroOverlay();
      clearBreakEndWarning();
      // Record synthetic pause
      if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
        const seg = segments[currentSegmentIndex];
        appendPause(seg, result.suspendStartIso, "suspend", result.suspendEndIso);
        persistSegmentToBackend(seg, "Failed to save suspend pause:", false);
      }
      setVisibleRemainingForPause(
        result.preSuspendRemainingSeconds,
        actualPhaseElapsedSeconds(),
        timestampMs(result.suspendStartIso),
      );
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      isRunning = false;
      lastTickMs = null;
      // Mark segments
      markCurrentAndSkipRemaining(result.suspendStartIso);
      void closeActiveRun(result.suspendStartIso, "completed", "interrupted", "event_expired", "complete");
      sessionStartTime = null;
      stopOvertime();
      stopIdleChecking();
      phaseEndTime = null;
      blockExpired = true;
      updateTray();
      return;
    }

    case "suspend_block_active": {
      clearBreakEndWarning();
      // Record synthetic pause
      if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
        const seg = segments[currentSegmentIndex];
        appendPause(seg, result.suspendStartIso, "suspend", result.suspendEndIso);
        persistSegmentToBackend(seg, "Failed to save suspend pause:", false);
      }
      setVisibleRemainingForPause(
        result.preSuspendRemainingSeconds,
        actualPhaseElapsedSeconds(),
        timestampMs(result.suspendStartIso),
      );
      phaseEndTime = result.newPhaseEndTime;
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      isRunning = false;
      lastTickMs = null;
      suspendedAway = { awaySeconds: result.awaySeconds };
      updateTray();
      return;
    }

    case "block_expired": {
      closePomodoroOverlay();
      clearBreakEndWarning();
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
      stopIdleChecking();
      isRunning = false;
      lastTickMs = null;
      phaseEndTime = null;
      blockExpired = true;
      updateTray();
      return;
    }

    case "break_finished": {
      clearBreakEndWarning();
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
              await markSegment(currentSegmentIndex, "completed", true, cappedActiveBreakEndIso());
              await startFocusSession();
            })();
          }
        }, 1000);
      }
      if (!overtimeAlertIntervalId) {
        playAppSound(APP_SOUND_IDS.breakFinished).catch(() => {});
        const repeatSeconds = getPreferences().focusBreakFinishedRepeatSeconds;
        if (repeatSeconds > 0) {
          overtimeAlertIntervalId = setInterval(() => {
            playAppSound(APP_SOUND_IDS.breakFinished).catch(() => {});
          }, repeatSeconds * 1000);
        }
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
      showNotification();
      updateTray();
      return;
    }

    case "countdown": {
      lastTickMs = now;
      recordRunningPhaseProgress(result.remainingSeconds);
      updateTray();
      return;
    }
  }
}

/** Mark the current segment as completed and remaining planned segments as skipped. */
function markCurrentAndSkipRemaining(endIso: string = nowIso()) {
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    markSegment(currentSegmentIndex, "interrupted", true, endIso, "event_expired");
    skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
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
      clearMusicPausedByPomodoro();
      completedPomodoros += 1;
      sessionStartTime = null;
      notificationShown = false;
      await markSegment(currentSegmentIndex, "completed", true, boundaryOccurredAt, "completed");
    } else {
      boundaryOccurredAt = cappedActiveBreakEndIso();
      await markSegment(currentSegmentIndex, "completed", true, boundaryOccurredAt);
    }

    const adaptiveDecision = await decideBoundaryAdaptiveForState({
    config,
    idleDetectionEnabled: idleTimeoutMs !== null,
    activeBlockEndMs,
    activeSegmentPlannedEnd: activeSegment()?.plannedEnd ?? null,
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
          recordRunEvent({
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
          ? boundarySegment("focus", currentRhythmPosition, now)
          : null;
        if (segment) {
          await activateBoundarySegment(segment, adaptiveDecision);
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
              await activateSegment(nextFocus);
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
          ? boundarySegment("long_break", currentRhythmPosition, now)
          : null;
        if (segment) {
          await activateBoundarySegment(segment, adaptiveDecision);
        } else {
          const breakIdx = currentSegmentIndex + 1;
          if (breakIdx < segments.length && segments[breakIdx].phase === "long_break") {
            await activateSegment(breakIdx);
          }
        }
        showBreakOverlay(remainingSeconds);
        break;
      }

      case "focus_to_short_break": {
        phase = "short_break";
        setPhaseRemainingSeconds(result.remainingSeconds);
        phaseEndTime = Date.now() + remainingSeconds * 1000;
        currentRhythmPosition = result.rhythmPosition;

        const now = nowIso();
        const segment = adaptiveDecision
          ? boundarySegment("short_break", currentRhythmPosition, now)
          : null;
        if (segment) {
          await activateBoundarySegment(segment, adaptiveDecision);
        } else {
          const breakIdx = currentSegmentIndex + 1;
          if (breakIdx < segments.length && segments[breakIdx].phase === "short_break") {
            await activateSegment(breakIdx);
          }
        }
        showBreakOverlay(remainingSeconds);
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
          ? boundarySegment("focus", currentRhythmPosition, now)
          : null;
        if (segment) {
          await activateBoundarySegment(segment, adaptiveDecision);
        } else {
          const nextFocus = segments.findIndex(
            (s, i) => i > currentSegmentIndex && s.phase === "focus" && s.status === "planned",
          );
          if (nextFocus !== -1) {
            await activateSegment(nextFocus);
          }
        }
        break;
      }
    }
    updateTray();
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
  const newEventDate = eventDateFromBlockId(newBlockId) ?? activeSegment()?.eventDate ?? null;
  await transferActiveEventReferenceInBackend({
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
  const newEventDate = eventDateFromBlockId(newBlockId) ?? eventDate ?? activeSegment()?.eventDate ?? null;
  activeBlockId = newBlockId;
  for (const seg of segments) {
    seg.eventId = newBlockId;
    if (newEventDate) seg.eventDate = newEventDate;
  }
  if (newEndMs != null && Number.isFinite(newEndMs)) {
    applyActiveBlockWindowChange(newBlockId, newEndMs, newEventDate ?? undefined);
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
  if (syncIdleTimeout) setActiveIdleTimeoutMs(newIdleMs);

  switch (decision.kind) {
    case "noop":
      return;

    case "update_end_only":
      applyActiveBlockWindowChange(blockId, decision.newEndMs, eventDate);
      return;

    case "reconfigure":
      await reconfigureSession(blockId, decision.newConfig, eventEnd!, eventDate!);
      return;

    case "rebuild_segments":
      applyActiveBlockWindowChange(blockId, decision.newEndMs, eventDate);
      return;

    case "transition":
      await transitionToBlock(blockId, decision.newConfig, eventEnd!, eventDate!);
      return;

    case "new_session": {
      clearBreakEndWarning();
      clearMusicPausedByPomodoro();
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
      startIdleChecking();

      if (eventEnd && eventDate) {
        await createSegments(blockId, eventEnd, eventDate, adaptivePlannedBlocks);
      }

      updateTray();
      return;
    }
  }
}

async function stopSessionInternal(): Promise<void> {
  closePomodoroOverlay();
  clearBreakEndWarning();
  clearMusicPausedByPomodoro();
  resetPausedFocusNotificationState();
  stopPausedOpportunityCountdown();
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const seg = segments[currentSegmentIndex];
    if (seg.status === "active") {
      const endIso = nowIso();
      await markSegment(currentSegmentIndex, "interrupted", true, endIso, "stopped");
      await closeActiveRun(endIso, "stopped", "interrupted", "stopped", "stop");
    }
    await skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
  } else if (activeRunId) {
    await closeActiveRun(nowIso(), "stopped", "interrupted", "stopped", "stop");
  }

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopOvertime();
  stopIdleChecking();
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
  clearSegments();
  updateTray();
}

async function completeActiveBlockAtInternal(endIso: string = nowIso()): Promise<void> {
  closePomodoroOverlay();
  clearBreakEndWarning();
  resetPausedFocusNotificationState();
  const parsedEndMs = Date.parse(endIso);
  const normalizedEndIso = Number.isFinite(parsedEndMs)
    ? new Date(parsedEndMs).toISOString()
    : nowIso();

  clearMusicPausedByPomodoro();
  stopPausedOpportunityCountdown();
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    await markSegment(currentSegmentIndex, "interrupted", true, normalizedEndIso, "event_expired");
    await skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
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
  stopIdleChecking();
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
  updateTray();
}

function pauseSession(): void {
  if (!isRunning || !canPauseResumeSession()) return;
  clearBreakEndWarning();
  pausedFocusNotificationSuppressed = false;
  isRunning = false;
  phaseEndTime = null;
  lastTickMs = null;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopIdleChecking();
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const seg = segments[currentSegmentIndex];
    const now = nowIso();
    appendPause(seg, now, "manual");
    persistSegmentToBackend(seg, "Failed to save pause:", false);
  }
  startPausedOpportunityCountdown();
  pauseMusicForPomodoroPause();
  updateTray();
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
  resetPausedFocusNotificationState();
  stopPausedOpportunityCountdown();
  isRunning = true;
  phaseEndTime = Date.now() + remainingSeconds * 1000;
  if (!sessionStartTime) {
    sessionStartTime = new Date().toISOString();
  }
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const seg = segments[currentSegmentIndex];
    if (closeLastPause(seg, nowIso())) {
      persistSegmentToBackend(seg, "Failed to save resume:", false);
    }
  }
  intervalId = setInterval(tick, 1000);
  lastTickMs = Date.now();
  scheduleBreakEndWarning();
  startIdleChecking();
  resumeMusicFromPomodoroPause();
  updateTray();
}

function skipSession(): void {
  recordManualPhaseAdvanceEvent(nowIso());
  void advancePhase();
}

async function cleanupOrphansInternal(): Promise<void> {
  await invoke("pomodoro_recover_open_runs", {
    dbUrl: dbUrl(),
  }).then(() => {
    segmentVersion++;
    publishWindowSnapshot();
  }).catch((e) => console.warn("Failed to recover open pomodoro runs:", e));
}

// Public API

export function getPomodoro() {
  initWindowSync();
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
      return currentPausedTrayPulseFrame();
    },
    get pausedPulseAmount() {
      return currentPausedPulseAmount();
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
      await dismissIdle(resume);
    },
    async markIdleFocusFailed(failedAtMs: number | null = null) {
      if (forwardWindowCommand({
        kind: "mark-idle-focus-failed",
        failedAtMs: failedAtMs ?? undefined,
      })) return;
      await markIdleFocusFailed(failedAtMs);
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
      setActiveIdleThresholdMinutesInternal(minutes);
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
