import type { PomodoroPhase } from "@ganbaru-ai/shared-types";
import type {
  PauseInterval,
  PauseReason,
  PersistedSegment,
  SegmentPhase,
} from "$lib/components/calendar/types";
import { dbUrl } from "$lib/api/db";
import { writeDoomscrollingRuntimeState } from "$lib/api/doomscrolling";
import { getMusicPlayer } from "$lib/stores/music-player.svelte";
import { getPreferences } from "$lib/stores/preferences.svelte";
import { computePlannedSegments } from "$lib/utils/pomodoro-segments";
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
  limitRemainingSecondsToBlockEnd,
  phaseDurationSeconds,
  isPomodoroSessionActive,
  decideTick,
  decideAdvancePhase,
  decideTransition,
  decideStartFromBlock,
  decideReconfigure,
  decideIdleCheck,
} from "./pomodoro-machine";
import {
  createWindowSyncEnvelope,
  isForeignWindowSyncEnvelope,
  isWindowSyncEnvelope,
} from "$lib/window-sync";

const POMODORO_WINDOW_SYNC_EVENT = "pomodoro-window-sync";
const POMODORO_WINDOW_COMMAND_EVENT = "pomodoro-window-command";
const pomodoroCoordinator = getCurrentWindow().label === "main";

interface PomodoroWindowSnapshot {
  phase: PomodoroPhase;
  remainingSeconds: number;
  phaseTotalSeconds: number;
  phaseWorkDurationSeconds: number;
  currentCycle: number;
  totalCycles: number;
  isRunning: boolean;
  config: PomodoroConfig;
  completedPomodoros: number;
  activeBlockId: string | null;
  activeRunId: string | null;
  activeBlockEndMs: number | null;
  dismissedBlockId: string | null;
  breakOvertimeSeconds: number;
  segments: PersistedSegment[];
  segmentVersion: number;
  blockExpired: boolean;
  focusExtensionUsed: boolean;
  suspendedAway: { awaySeconds: number } | null;
  idlePaused: { idleSeconds: number; nativeOverlay: boolean } | null;
}

type PomodoroWindowCommand =
  | { kind: "request-snapshot" }
  | { kind: "set-dismissed-block-id"; id: string | null }
  | { kind: "clear-block-expired" }
  | { kind: "transfer-block-id"; newBlockId: string; newEndTime?: string }
  | {
      kind: "start-from-block";
      blockId: string;
      blockConfig: Partial<PomodoroConfig>;
      eventEnd?: string;
      eventDate?: string;
      blockIdleTimeoutMinutes?: number | null;
    }
  | { kind: "dismiss-suspend"; resume: boolean }
  | { kind: "dismiss-idle"; resume: boolean }
  | { kind: "complete-active-block-at"; endIso: string }
  | { kind: "stop-session" }
  | { kind: "pause" }
  | { kind: "start" }
  | { kind: "skip" }
  | { kind: "add-focus-time"; seconds: number }
  | { kind: "cleanup-orphans" };

let phase = $state<PomodoroPhase>("focus");
let remainingSeconds = $state(DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER);
let phaseTotalSeconds = $state(DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER);
let phaseElapsedSeconds = 0;
let phaseWorkDurationSeconds = DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER;
let currentCycle = $state(1);
let totalCycles = $state(DEFAULT_CONFIG.cyclesBeforeLongBreak);
let isRunning = $state(false);
let config = $state<PomodoroConfig>({ ...DEFAULT_CONFIG });
let intervalId: ReturnType<typeof setInterval> | null = null;
let pausedOpportunityIntervalId: ReturnType<typeof setInterval> | null = null;
let pausedTrayPulseIntervalId: ReturnType<typeof setInterval> | null = null;
let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
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
let idleCheckIntervalId: ReturnType<typeof setInterval> | null = null;
let idlePaused = $state<{ idleSeconds: number; nativeOverlay: boolean } | null>(null);
let lastDoomscrollingStateKey = "";

function writeCurrentDoomscrollingRuntimeState(force = false): void {
  if (!pomodoroCoordinator) return;
  const minuteBucket = Math.ceil(remainingSeconds / 60);
  const active = isRunning && activeRunId !== null;
  const stateKey = [
    active ? "1" : "0",
    active ? phase : "inactive",
    activeRunId ?? "",
    activeBlockId ?? "",
    String(minuteBucket),
  ].join("|");
  if (!force && stateKey === lastDoomscrollingStateKey) return;
  lastDoomscrollingStateKey = stateKey;

  writeDoomscrollingRuntimeState({
    active,
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
    currentCycle,
    totalCycles,
    config,
    skipNextBreak,
    notificationShown,
    phaseEndTime,
    activeBlockEndMs,
    lastTickMs,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPomodoroPhase(value: unknown): value is PomodoroPhase {
  return value === "focus" || value === "short_break" || value === "long_break";
}

function isSegmentPhase(value: unknown): value is SegmentPhase {
  return isPomodoroPhase(value);
}

function isSegmentStatus(value: unknown): value is PersistedSegment["status"] {
  return (
    value === "planned" ||
    value === "active" ||
    value === "completed" ||
    value === "skipped" ||
    value === "interrupted"
  );
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNullableNumber(value: unknown): value is number | null {
  return (typeof value === "number" && Number.isFinite(value)) || value === null;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPomodoroConfig(value: unknown): value is PomodoroConfig {
  if (!isRecord(value)) return false;
  return (
    isPositiveNumber(value.focusMinutes) &&
    isPositiveNumber(value.shortBreakMinutes) &&
    isPositiveNumber(value.longBreakMinutes) &&
    isPositiveNumber(value.cyclesBeforeLongBreak)
  );
}

function isPartialPomodoroConfig(value: unknown): value is Partial<PomodoroConfig> {
  if (!isRecord(value)) return false;
  for (const key of [
    "focusMinutes",
    "shortBreakMinutes",
    "longBreakMinutes",
    "cyclesBeforeLongBreak",
  ] as const) {
    const found = value[key];
    if (found !== undefined && !isPositiveNumber(found)) return false;
  }
  return true;
}

function isPauseInterval(value: unknown): value is PauseInterval {
  return isRecord(value) &&
    typeof value.startedAt === "string" &&
    isNullableString(value.endedAt) &&
    isPauseReason(value.reason);
}

function isPauseReason(value: unknown): value is PauseReason {
  return value === "idle" || value === "manual" || value === "suspend";
}

function isPersistedSegment(value: unknown): value is PersistedSegment {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.eventId === "string" &&
    typeof value.eventDate === "string" &&
    typeof value.runId === "string" &&
    typeof value.cycleNumber === "number" &&
    isSegmentPhase(value.phase) &&
    typeof value.plannedStart === "string" &&
    typeof value.plannedEnd === "string" &&
    isNullableString(value.actualStart) &&
    isNullableString(value.actualEnd) &&
    Array.isArray(value.pauseLog) &&
    value.pauseLog.every(isPauseInterval) &&
    isSegmentStatus(value.status)
  );
}

function isPomodoroWindowSnapshot(value: unknown): value is PomodoroWindowSnapshot {
  if (!isRecord(value)) return false;
  const suspendedAwayValue = value.suspendedAway;
  const idlePausedValue = value.idlePaused;
  const validSuspendedAway =
    suspendedAwayValue === null ||
    (isRecord(suspendedAwayValue) && isNonNegativeNumber(suspendedAwayValue.awaySeconds));
  const validIdlePaused =
    idlePausedValue === null ||
    (
      isRecord(idlePausedValue) &&
      isNonNegativeNumber(idlePausedValue.idleSeconds) &&
      typeof idlePausedValue.nativeOverlay === "boolean"
    );

  return (
    isPomodoroPhase(value.phase) &&
    isNonNegativeNumber(value.remainingSeconds) &&
    isNonNegativeNumber(value.phaseTotalSeconds) &&
    isNonNegativeNumber(value.phaseWorkDurationSeconds) &&
    isPositiveNumber(value.currentCycle) &&
    isPositiveNumber(value.totalCycles) &&
    typeof value.isRunning === "boolean" &&
    isPomodoroConfig(value.config) &&
    isNonNegativeNumber(value.completedPomodoros) &&
    isNullableString(value.activeBlockId) &&
    isNullableString(value.activeRunId) &&
    isNullableNumber(value.activeBlockEndMs) &&
    isNullableString(value.dismissedBlockId) &&
    isNonNegativeNumber(value.breakOvertimeSeconds) &&
    Array.isArray(value.segments) &&
    value.segments.every(isPersistedSegment) &&
    isNonNegativeNumber(value.segmentVersion) &&
    typeof value.blockExpired === "boolean" &&
    typeof value.focusExtensionUsed === "boolean" &&
    validSuspendedAway &&
    validIdlePaused
  );
}

function isPomodoroWindowCommand(value: unknown): value is PomodoroWindowCommand {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "request-snapshot":
    case "clear-block-expired":
    case "stop-session":
    case "pause":
    case "start":
    case "skip":
    case "cleanup-orphans":
      return true;
    case "add-focus-time":
      return isPositiveNumber(value.seconds);
    case "set-dismissed-block-id":
      return isNullableString(value.id);
    case "transfer-block-id":
      return (
        typeof value.newBlockId === "string" &&
        (value.newEndTime === undefined || typeof value.newEndTime === "string")
      );
    case "start-from-block":
      return (
        typeof value.blockId === "string" &&
        isPartialPomodoroConfig(value.blockConfig) &&
        (value.eventEnd === undefined || typeof value.eventEnd === "string") &&
        (value.eventDate === undefined || typeof value.eventDate === "string") &&
        (
          value.blockIdleTimeoutMinutes === undefined ||
          value.blockIdleTimeoutMinutes === null ||
          isNonNegativeNumber(value.blockIdleTimeoutMinutes)
        )
      );
    case "dismiss-suspend":
    case "dismiss-idle":
      return typeof value.resume === "boolean";
    case "complete-active-block-at":
      return typeof value.endIso === "string";
    default:
      return false;
  }
}

function cloneSegmentsForWindowSync(source: readonly PersistedSegment[]): PersistedSegment[] {
  return source.map((segment) => ({
    ...segment,
    pauseLog: segment.pauseLog.map((pause) => ({ ...pause })),
  }));
}

function buildWindowSnapshot(): PomodoroWindowSnapshot {
  return {
    phase,
    remainingSeconds,
    phaseTotalSeconds,
    phaseWorkDurationSeconds,
    currentCycle,
    totalCycles,
    isRunning,
    config: { ...config },
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
  currentCycle = snapshot.currentCycle;
  totalCycles = snapshot.totalCycles;
  isRunning = snapshot.isRunning;
  config = { ...snapshot.config };
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

interface PomodoroSegmentWrite {
  id: string;
  eventId: string;
  eventDate: string;
  runId: string;
  cycleNumber: number;
  phase: SegmentPhase;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  pauses: PauseInterval[];
  status: PersistedSegment["status"];
  endReason: PomodoroSegmentEndReason | null;
}

interface PomodoroSegmentUpdate {
  id: string;
  status: PersistedSegment["status"];
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  endReason: PomodoroSegmentEndReason | null;
  occurredAt: string | null;
  pauses: PauseInterval[];
}

type PomodoroStartTrigger = "manual" | "block_auto" | "block_transition" | "reconfigure" | "crash_recovery";
type PomodoroRunEndReason = "completed" | "stopped" | "interrupted" | "reconfigured" | "block_transition";
type PomodoroSegmentEndReason =
  | "completed"
  | "stopped"
  | "skipped_by_user"
  | "event_expired"
  | "reconfigured"
  | "block_transition"
  | "crash_recovery";
type PomodoroRunEventType =
  | "start"
  | "phase_start"
  | "phase_complete"
  | "pause_start"
  | "pause_end"
  | "idle_detected"
  | "suspend_detected"
  | "skip_break"
  | "extend_focus"
  | "reconfigure"
  | "block_transition"
  | "stop"
  | "complete"
  | "crash_recovery";

interface PomodoroRunWrite {
  id: string;
  eventId: string;
  eventDate: string;
  plannedStart: string;
  plannedEnd: string;
  startedAt: string;
  focusDurationMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  pomodoroCount: number;
  idleTimeoutMinutes: number | null;
  eventTitleSnapshot: string | null;
  inheritedFocusMinutes: number;
  inheritedCycle: number;
  inheritedFromRunId: string | null;
  startTrigger: PomodoroStartTrigger;
}

interface PomodoroRunClosure {
  runId: string;
  endedAt: string;
  endReason: PomodoroRunEndReason;
  segmentStatus: "completed" | "interrupted";
  segmentEndReason: PomodoroSegmentEndReason;
  eventType: PomodoroRunEventType;
}

interface PomodoroRunWindowUpdate {
  runId: string;
  plannedEnd: string;
}

interface PomodoroActiveEventReferenceTransfer {
  newEventId: string;
  newEventDate: string | null;
  plannedEnd: string | null;
}

interface PomodoroTransitionRunWrite {
  closure: PomodoroRunClosure;
  run: PomodoroRunWrite;
  segment: PomodoroSegmentWrite;
}

interface PomodoroBackendWriteOptions {
  bumpSegmentVersion?: boolean;
  publishSnapshot?: boolean;
}

interface PomodoroRunEventWrite {
  runId: string;
  segmentId: string | null;
  eventType: PomodoroRunEventType;
  occurredAt: string;
  phase: SegmentPhase | null;
  reason: string | null;
  durationSeconds: number | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

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

function runWrite(
  runId: string,
  eventId: string,
  eventDate: string,
  startedAt: string,
  plannedStart: string,
  plannedEnd: string,
  startTrigger: PomodoroStartTrigger,
  inheritedFocusMinutes = 0,
  inheritedCycle = 1,
  inheritedFromRunId: string | null = null,
): PomodoroRunWrite {
  return {
    id: runId,
    eventId,
    eventDate,
    plannedStart,
    plannedEnd,
    startedAt,
    focusDurationMinutes: config.focusMinutes,
    shortBreakMinutes: config.shortBreakMinutes,
    longBreakMinutes: config.longBreakMinutes,
    pomodoroCount: config.cyclesBeforeLongBreak,
    idleTimeoutMinutes: idleTimeoutMs === null ? null : Math.round(idleTimeoutMs / 60000),
    eventTitleSnapshot: null,
    inheritedFocusMinutes,
    inheritedCycle,
    inheritedFromRunId,
    startTrigger,
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
  return {
    runId: activeRunId,
    endedAt,
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
): Promise<void> {
  const closure = runClosure(endedAt, endReason, segmentStatus, segmentEndReason, eventType);
  stopHeartbeat();
  activeRunId = null;
  if (closure) await closeRunInBackend(closure);
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

function expirePausedBlockAtDeadline(): void {
  if (activeBlockEndMs === null) return;
  clearMusicPausedByPomodoro();
  const endIso = new Date(activeBlockEndMs).toISOString();
  stopPausedOpportunityCountdown();
  refreshPausedOpportunityRemaining(activeBlockEndMs);

  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    void markSegment(currentSegmentIndex, "interrupted", true, endIso, "event_expired");
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

function usedBreakExtensionSeconds(): number {
  if (!isBreakPhase(phase)) return 0;
  const configuredBreakSeconds = phaseDurationSeconds(phase, config);
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

function segmentWrite(seg: PersistedSegment): PomodoroSegmentWrite {
  return {
    id: seg.id,
    eventId: seg.eventId,
    eventDate: seg.eventDate,
    runId: seg.runId,
    cycleNumber: seg.cycleNumber,
    phase: seg.phase,
    plannedStart: seg.plannedStart,
    plannedEnd: seg.plannedEnd,
    actualStart: seg.actualStart,
    actualEnd: seg.actualEnd,
    pauses: seg.pauseLog,
    status: seg.status,
    endReason: null,
  };
}

function segmentUpdate(seg: PersistedSegment, occurredAt: string | null = null): PomodoroSegmentUpdate {
  return {
    id: seg.id,
    status: seg.status,
    plannedEnd: seg.plannedEnd,
    actualStart: seg.actualStart,
    actualEnd: seg.actualEnd,
    endReason: segmentEndReasonFor(seg),
    occurredAt,
    pauses: seg.pauseLog,
  };
}

function persistSegmentsToBackend(
  updatedSegments: PersistedSegment[],
  warning: string,
  bumpSegmentVersion: boolean,
  occurredAt: string | null = null,
): Promise<void> {
  const persisted = updatedSegments.filter((segment) => segment.status !== "planned" && segment.status !== "skipped");
  if (persisted.length === 0) return Promise.resolve();
  return enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_update_segments", {
      dbUrl: dbUrl(),
      segments: persisted.map((segment) => segmentUpdate(segment, occurredAt)),
    });
    if (bumpSegmentVersion) {
      segmentVersion++;
      publishWindowSnapshot();
    }
  }).catch((e) => console.warn(warning, e));
}

function persistSegmentToBackend(
  seg: PersistedSegment,
  warning: string,
  bumpSegmentVersion: boolean,
  occurredAt: string | null = null,
): Promise<void> {
  return persistSegmentsToBackend([seg], warning, bumpSegmentVersion, occurredAt);
}

async function insertSegmentsToBackend(newSegments: PersistedSegment[]) {
  const persisted = newSegments.filter((segment) => segment.status !== "planned" && segment.status !== "skipped");
  if (persisted.length === 0) return;
  await enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_insert_segments", {
      dbUrl: dbUrl(),
      segments: persisted.map(segmentWrite),
    });
    segmentVersion++;
    publishWindowSnapshot();
  }).catch((e) => console.warn("Failed to insert segments:", e));
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
      segment: segmentWrite(segment),
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

function closeRunInBackend(closure: PomodoroRunClosure, warning = "Failed to close pomodoro run:"): Promise<void> {
  return enqueuePomodoroWrite(async () => {
    await invoke("pomodoro_close_run", {
      dbUrl: dbUrl(),
      closure,
    });
    segmentVersion++;
    publishWindowSnapshot();
  }).catch((e) => console.warn(warning, e));
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

function sendHeartbeat(): void {
  if (!activeRunId) return;
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
  seg.pauseLog = [...seg.pauseLog, { startedAt, endedAt, reason }];
}

function closeLastPause(seg: PersistedSegment, endedAt: string): boolean {
  const lastPause = seg.pauseLog[seg.pauseLog.length - 1];
  if (!lastPause || lastPause.endedAt !== null) return false;
  const updated = [...seg.pauseLog];
  updated[updated.length - 1] = { ...lastPause, endedAt };
  seg.pauseLog = updated;
  return true;
}

function markSegment(
  index: number,
  status: PersistedSegment["status"],
  setActualEnd: boolean = false,
  actualEndIso: string = nowIso(),
  endReason: PomodoroSegmentEndReason | null = null,
): Promise<void> {
  if (index < 0 || index >= segments.length) return Promise.resolve();
  const seg = segments[index];
  seg.status = status;
  if (endReason) segmentEndReasons.set(seg.id, endReason);
  if (setActualEnd) seg.actualEnd = actualEndIso;

  // Close any open pause interval
  closeLastPause(seg, seg.actualEnd ?? actualEndIso);

  publishWindowSnapshot();
  return persistSegmentToBackend(seg, "Failed to update segment:", true, actualEndIso);
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

async function createSegments(eventId: string, eventEnd: string, eventDate: string) {
  const runId = crypto.randomUUID();

  const now = new Date();
  const end = new Date(eventEnd.replace(" ", "T"));
  const remainingMinutes = Math.max(0, (end.getTime() - now.getTime()) / 60000);

  const planned = computePlannedSegments(
    {
      focusDurationMinutes: config.focusMinutes,
      shortBreakMinutes: config.shortBreakMinutes,
      longBreakMinutes: config.longBreakMinutes,
      pomodoroCount: config.cyclesBeforeLongBreak,
      idleTimeoutMinutes: null,
    },
    remainingMinutes,
  );

  const baseIso = now.toISOString();

  const newSegments: PersistedSegment[] = planned.map((s, i) => ({
    id: crypto.randomUUID(),
    eventId,
    eventDate,
    runId,
    cycleNumber: s.cycleNumber,
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
    try {
      await startRunInBackend(
        runWrite(
          runId,
          eventId,
          eventDate,
          startedAt,
          firstSegment.plannedStart,
          runPlannedEndForSegment(firstSegment),
          "block_auto",
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
  inheritedCycle: number;
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
  let cycle = currentCycle;
  let nextIsFocus = phase !== "focus";

  while (offset < afterMinutes) {
    if (nextIsFocus) {
      const duration = Math.min(config.focusMinutes, afterMinutes - offset);
      newSegments.push({
        id: crypto.randomUUID(),
        eventId: blockId,
        eventDate,
        runId,
        cycleNumber: cycle,
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
      const isLongBreak = cycle >= config.cyclesBeforeLongBreak;
      const breakPhase: SegmentPhase = isLongBreak ? "long_break" : "short_break";
      const breakDur = isLongBreak ? config.longBreakMinutes : config.shortBreakMinutes;
      const duration = Math.min(breakDur, afterMinutes - offset);
      newSegments.push({
        id: crypto.randomUUID(),
        eventId: blockId,
        eventDate,
        runId,
        cycleNumber: cycle,
        phase: breakPhase,
        plannedStart: addMinutesToIso(baseAfter, offset),
        plannedEnd: addMinutesToIso(baseAfter, offset + duration),
        actualStart: null,
        actualEnd: null,
        pauseLog: [],
        status: "planned",
      });
      offset += duration;
      cycle = isLongBreak ? 1 : cycle + 1;
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
      cycleNumber: currentCycle,
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
      blockId,
      eventDate,
      startedAt,
      firstSegment.plannedStart,
      runPlannedEndForSegment(firstSegment),
      options.startTrigger,
      Math.floor(options.inheritedFocusSeconds / 60),
      options.inheritedCycle,
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
          segment: segmentWrite(firstSegment),
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
    hasOvertimeInterval: overtimeIntervalId !== null,
  });

  config = newConfig;
  totalCycles = config.cyclesBeforeLongBreak;
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
    inheritedCycle: currentCycle,
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
  const inheritedCycle = currentCycle;
  activeBlockId = blockId;
  activeBlockEndMs = new Date(eventEnd.replace(" ", "T")).getTime();
  initListeners();

  const result = decideTransition({
    previousConfig,
    newConfig,
    phase,
    remainingSeconds,
    elapsedFocusSeconds: phase === "focus" ? elapsedSeconds : undefined,
    currentCycle,
    blockExpired,
  });

  config = newConfig;
  totalCycles = config.cyclesBeforeLongBreak;

  switch (result.kind) {
    case "trigger_break": {
      completedPomodoros += 1;
      sessionStartTime = null;
      notificationShown = false;

      phase = result.breakPhase;
      setPhaseRemainingSeconds(result.breakDurationSeconds);
      currentCycle = result.nextCycle;

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
      currentCycle = 1;
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
    inheritedCycle,
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
  canAddFocusTime: boolean;
  pausedPulseFrame: number | null;
}

function updateTray(options: UpdateTrayOptions = {}) {
  if (options.publishSnapshot !== false) publishWindowSnapshot();
  if (!pomodoroCoordinator) return;
  writeCurrentDoomscrollingRuntimeState();
  syncPausedTrayPulse();
  const isActive = pomodoroSessionActive();
  const update: PomodoroTrayUpdatePayload = {
    phase,
    remainingSeconds,
    totalSeconds: phaseTotalSeconds,
    isRunning,
    isActive,
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
      );
      return;
    case "dismiss-suspend":
      void dismissSuspend(command.resume);
      return;
    case "dismiss-idle":
      void dismissIdle(command.resume);
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
      markSegment(currentSegmentIndex, "interrupted", true, occurredAt, "skipped_by_user");
      startFocusSession();
    } else {
      skipNextBreak = true;
    }
  }).catch((e) => console.warn("Failed to listen for pomodoro-skip-break:", e));

  listen("pomodoro-break-acknowledged", () => {
    document.dispatchEvent(new Event("ganbaru-ai-clear-snap"));
    if (phase === "short_break" || phase === "long_break") {
      markSegment(currentSegmentIndex, "completed", true, cappedActiveBreakEndIso());
      startFocusSession();
    }
  }).catch((e) => console.warn("Failed to listen for pomodoro-break-acknowledged:", e));

  listen<{ seconds: number }>("pomodoro-break-extended", (event) => {
    addBreakTimeInternal(event.payload.seconds);
  }).catch((e) => console.warn("Failed to listen for pomodoro-break-extended:", e));

  listen("idle-overlay-resume", () => {
    if (idlePaused) void dismissIdle(true);
  }).catch((e) => console.warn("Failed to listen for idle-overlay-resume:", e));

  listen("idle-overlay-stop", () => {
    if (idlePaused) void dismissIdle(false);
  }).catch((e) => console.warn("Failed to listen for idle-overlay-stop:", e));

  listen("tray-pause-resume", () => {
    if (suspendedAway || idlePaused) return;
    if (isRunning) {
      pauseSession();
    } else {
      resumeSession();
    }
  }).catch((e) => console.warn("Failed to listen for tray-pause-resume:", e));

  listen("tray-skip", () => {
    if (suspendedAway || idlePaused) return;
    advancePhase();
    updateTray();
  }).catch((e) => console.warn("Failed to listen for tray-skip:", e));

  listen<{ seconds: number }>("pomodoro-add-time", (event) => {
    addFocusTimeInternal(event.payload.seconds);
  }).catch((e) => console.warn("Failed to listen for pomodoro-add-time:", e));
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

function startFocusSession() {
  clearMusicPausedByPomodoro();
  stopPausedOpportunityCountdown();
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopOvertime();
  phase = "focus";
  setPhaseRemainingSeconds(config.focusMinutes * TIME_MULTIPLIER);
  resetFocusNotificationState();
  isRunning = true;
  phaseEndTime = Date.now() + remainingSeconds * 1000;
  sessionStartTime = new Date().toISOString();
  intervalId = setInterval(tick, 1000);
  lastTickMs = Date.now();

  // Activate the next focus segment
  const nextFocus = segments.findIndex(
    (s, i) => i > currentSegmentIndex && s.phase === "focus" && s.status === "planned",
  );
  if (nextFocus !== -1) {
    activateSegment(nextFocus);
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
    startIdleChecking();
    updateTray();
  } else {
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
    resetPhaseProgress(DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER);
    currentCycle = 1;
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
  if (idleTimeoutMs === null) return;
  idleCheckIntervalId = setInterval(checkIdle, 15_000);
}

function stopIdleChecking() {
  if (idleCheckIntervalId !== null) {
    clearInterval(idleCheckIntervalId);
    idleCheckIntervalId = null;
  }
}

async function checkIdle() {
  try {
    const status = await invoke<IdleStatus>("get_idle_status");
    const nowMs = Date.now();

    const result = decideIdleCheck(
      {
        isRunning,
        phase,
        suspendedAway: suspendedAway !== null,
        idlePaused: idlePaused !== null,
        idleTimeoutMs,
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

    // Show fullscreen idle overlay (GTK on Linux, returns false on other platforms)
    let nativeOverlay = false;
    try {
      nativeOverlay = await invoke<boolean>("show_idle_overlay", { idleSeconds: result.idleSeconds });
    } catch (e) {
      console.warn("Failed to show idle overlay:", e);
    }

    idlePaused = { idleSeconds: result.idleSeconds, nativeOverlay };
    updateTray();
  } catch (e) {
    console.warn("Idle check failed:", e);
  }
}

async function dismissIdle(resume: boolean): Promise<void> {
  stopPausedOpportunityCountdown();
  if (resume) {
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
      await markSegment(currentSegmentIndex, "interrupted", true, endIso, "stopped");
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
    resetPhaseProgress(DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER);
    currentCycle = 1;
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
  invoke("show_break_overlay", { breakSeconds }).catch((e) =>
    console.warn("Failed to show break overlay:", e),
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
            markSegment(currentSegmentIndex, "completed", true, cappedActiveBreakEndIso());
            startFocusSession();
          }
        }, 1000);
      }
      if (!overtimeAlertIntervalId) {
        overtimeAlertIntervalId = setInterval(() => {
          invoke("play_alert_sound").catch(() => {});
        }, 60_000);
      }
      return;
    }

    case "focus_finished": {
      lastTickMs = now;
      recordRunningPhaseProgress(0);
      advancePhase();
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

function advancePhase() {
  const result = decideAdvancePhase(buildSnapshot());

  // Save completed focus session before transitioning away from focus
  if (phase === "focus") {
    clearMusicPausedByPomodoro();
    const endTime = new Date().toISOString();
    completedPomodoros += 1;
    sessionStartTime = null;
    notificationShown = false;
    markSegment(currentSegmentIndex, "completed", true, endTime, "completed");
  }

  switch (result.kind) {
    case "skip_break_to_focus": {
      skipNextBreak = false;
      phase = "focus";
      setPhaseRemainingSeconds(result.remainingSeconds);
      resetFocusNotificationState();
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      currentCycle = result.nextCycle;

      // Mark the break segment as skipped, activate next focus
      const breakIdx = currentSegmentIndex + 1;
      if (breakIdx < segments.length && segments[breakIdx].phase !== "focus") {
        const now = nowIso();
        if (activeRunId) {
          recordRunEvent({
            runId: activeRunId,
            segmentId: null,
            eventType: "skip_break",
            occurredAt: now,
            phase: segments[breakIdx].phase,
            reason: "skip_next_break",
            durationSeconds: null,
          }, "Failed to record skipped break:");
        }
        segments[breakIdx].status = "skipped";
        segments[breakIdx].actualStart = now;
        segments[breakIdx].actualEnd = now;

        const nextFocus = segments.findIndex(
          (s, i) => i > breakIdx && s.phase === "focus" && s.status === "planned",
        );
        if (nextFocus !== -1) {
          activateSegment(nextFocus);
        }
      }
      break;
    }

    case "focus_to_long_break": {
      phase = "long_break";
      setPhaseRemainingSeconds(result.remainingSeconds);
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      currentCycle = result.nextCycle;

      const breakIdx = currentSegmentIndex + 1;
      if (breakIdx < segments.length && segments[breakIdx].phase === "long_break") {
        activateSegment(breakIdx);
      }

      invoke("play_alert_sound").catch(() => {});
      showBreakOverlay(remainingSeconds);
      break;
    }

    case "focus_to_short_break": {
      phase = "short_break";
      setPhaseRemainingSeconds(result.remainingSeconds);
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      currentCycle = result.nextCycle;

      const breakIdx = currentSegmentIndex + 1;
      if (breakIdx < segments.length && segments[breakIdx].phase === "short_break") {
        activateSegment(breakIdx);
      }

      invoke("play_alert_sound").catch(() => {});
      showBreakOverlay(remainingSeconds);
      break;
    }

    case "break_to_focus": {
      markSegment(currentSegmentIndex, "completed", true, cappedActiveBreakEndIso());
      phase = "focus";
      setPhaseRemainingSeconds(result.remainingSeconds);
      resetFocusNotificationState();
      phaseEndTime = Date.now() + remainingSeconds * 1000;

      const nextFocus = segments.findIndex(
        (s, i) => i > currentSegmentIndex && s.phase === "focus" && s.status === "planned",
      );
      if (nextFocus !== -1) {
        activateSegment(nextFocus);
      }
      break;
    }
  }
  updateTray();
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
  blockConfig: Partial<PomodoroConfig>,
  eventEnd?: string,
  eventDate?: string,
  blockIdleTimeoutMinutes?: number | null,
): Promise<void> {
  const newConfig = { ...DEFAULT_CONFIG, ...blockConfig };

  const newIdleMs = (blockIdleTimeoutMinutes != null && blockIdleTimeoutMinutes > 0)
    ? blockIdleTimeoutMinutes * 60_000 : null;
  if (idleTimeoutMs !== newIdleMs) {
    idleTimeoutMs = newIdleMs;
    if (isRunning) startIdleChecking();
  }

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
      clearMusicPausedByPomodoro();
      stopPausedOpportunityCountdown();
      initListeners();
      if (intervalId) { clearInterval(intervalId); intervalId = null; }

      activeBlockId = blockId;
      activeBlockEndMs = decision.newEndMs;
      config = decision.newConfig;
      totalCycles = config.cyclesBeforeLongBreak;
      phase = "focus";
      setPhaseRemainingSeconds(config.focusMinutes * TIME_MULTIPLIER);
      currentCycle = 1;
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
        await createSegments(blockId, eventEnd, eventDate);
      }

      updateTray();
      return;
    }
  }
}

async function stopSessionInternal(): Promise<void> {
  clearMusicPausedByPomodoro();
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
  resetPhaseProgress(DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER);
  currentCycle = 1;
  completedPomodoros = 0;
  sessionStartTime = null;
  skipNextBreak = false;
  resetFocusNotificationState();
  clearSegments();
  updateTray();
}

async function completeActiveBlockAtInternal(endIso: string = nowIso()): Promise<void> {
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
    await closeActiveRun(normalizedEndIso, "completed", "interrupted", "event_expired", "complete");
  }

  if (activeRunId) {
    await closeActiveRun(normalizedEndIso, "completed", "interrupted", "event_expired", "complete");
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
  resetPhaseProgress(DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER);
  currentCycle = 1;
  completedPomodoros = 0;
  sessionStartTime = null;
  skipNextBreak = false;
  resetFocusNotificationState();
  updateTray();
}

function pauseSession(): void {
  if (!isRunning) return;
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
  if (!pomodoroSessionActive()) return;
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
  startIdleChecking();
  resumeMusicFromPomodoroPause();
  updateTray();
}

function skipSession(): void {
  advancePhase();
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
    get currentCycle() {
      return currentCycle;
    },
    get totalCycles() {
      return totalCycles;
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
    async startFromBlock(
      blockId: string,
      blockConfig: Partial<PomodoroConfig>,
      eventEnd?: string,
      eventDate?: string,
      blockIdleTimeoutMinutes?: number | null,
    ) {
      if (forwardWindowCommand({
        kind: "start-from-block",
        blockId,
        blockConfig,
        eventEnd,
        eventDate,
        blockIdleTimeoutMinutes,
      })) return;
      await startFromBlockInternal(
        blockId,
        blockConfig,
        eventEnd,
        eventDate,
        blockIdleTimeoutMinutes,
      );
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
