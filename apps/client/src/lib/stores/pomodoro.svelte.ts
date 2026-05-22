import type { PomodoroPhase } from "@ganbaruai/shared-types";
import type { PauseInterval, PersistedSegment, SegmentPhase } from "$lib/components/calendar/types";
import { dbUrl } from "$lib/api/db";
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
  MAX_BREAK_OVERTIME_SECONDS,
  limitRemainingSecondsToBlockEnd,
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
  currentCycle: number;
  totalCycles: number;
  isRunning: boolean;
  config: PomodoroConfig;
  completedPomodoros: number;
  activeBlockId: string | null;
  activeBlockEndMs: number | null;
  dismissedBlockId: string | null;
  breakOvertimeSeconds: number;
  segments: PersistedSegment[];
  segmentVersion: number;
  blockExpired: boolean;
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
  | { kind: "stop-session" }
  | { kind: "pause" }
  | { kind: "start" }
  | { kind: "skip" }
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
let completedPomodoros = $state(0);
let sessionStartTime: string | null = null;
let skipNextBreak = false;
let listenersInitialized = false;
let windowSyncInitialized = false;
let notificationShown = false;
let preBreakExtensionUsed = false;
let phaseEndTime: number | null = null;
let activeBlockId = $state<string | null>(null);
let activeBlockEndMs = $state<number | null>(null);
let dismissedBlockId = $state<string | null>(null);

// Segment tracking state
let segments = $state<PersistedSegment[]>([]);
let currentSegmentIndex = -1;

// Bumped after DB writes to persisted segments complete, so DayColumn re-fetches.
let segmentVersion = $state(0);

// Tracks seconds elapsed after a break timer reaches 0 but before user acknowledgment.
// Reactive ($state) so the accent bar derived recomputes and bands keep shifting.
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

// Snapshot builder

function buildSnapshot(): TimerSnapshot {
  return {
    phase,
    remainingSeconds,
    currentCycle,
    totalCycles,
    isRunning,
    config,
    completedPomodoros,
    skipNextBreak,
    notificationShown,
    phaseEndTime,
    activeBlockId,
    activeBlockEndMs,
    blockExpired,
    lastTickMs,
    sessionStartTime,
    hasOvertimeInterval: overtimeIntervalId !== null,
    suspendedAway: suspendedAway !== null,
    idlePaused: idlePaused !== null,
    idleTimeoutMs,
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
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    isNullableString(value[1])
  );
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
    isPositiveNumber(value.currentCycle) &&
    isPositiveNumber(value.totalCycles) &&
    typeof value.isRunning === "boolean" &&
    isPomodoroConfig(value.config) &&
    isNonNegativeNumber(value.completedPomodoros) &&
    isNullableString(value.activeBlockId) &&
    isNullableNumber(value.activeBlockEndMs) &&
    isNullableString(value.dismissedBlockId) &&
    isNonNegativeNumber(value.breakOvertimeSeconds) &&
    Array.isArray(value.segments) &&
    value.segments.every(isPersistedSegment) &&
    isNonNegativeNumber(value.segmentVersion) &&
    typeof value.blockExpired === "boolean" &&
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
    default:
      return false;
  }
}

function cloneSegmentsForWindowSync(source: readonly PersistedSegment[]): PersistedSegment[] {
  return source.map((segment) => ({
    ...segment,
    pauseLog: segment.pauseLog.map(([start, end]) => [start, end]),
  }));
}

function buildWindowSnapshot(): PomodoroWindowSnapshot {
  return {
    phase,
    remainingSeconds,
    phaseTotalSeconds,
    currentCycle,
    totalCycles,
    isRunning,
    config: { ...config },
    completedPomodoros,
    activeBlockId,
    activeBlockEndMs,
    dismissedBlockId,
    breakOvertimeSeconds,
    segments: cloneSegmentsForWindowSync(segments),
    segmentVersion,
    blockExpired,
    suspendedAway: suspendedAway ? { ...suspendedAway } : null,
    idlePaused: idlePaused ? { ...idlePaused } : null,
  };
}

function applyWindowSnapshot(snapshot: PomodoroWindowSnapshot): void {
  if (pomodoroCoordinator) return;
  phase = snapshot.phase;
  remainingSeconds = snapshot.remainingSeconds;
  phaseTotalSeconds = snapshot.phaseTotalSeconds;
  currentCycle = snapshot.currentCycle;
  totalCycles = snapshot.totalCycles;
  isRunning = snapshot.isRunning;
  config = { ...snapshot.config };
  completedPomodoros = snapshot.completedPomodoros;
  activeBlockId = snapshot.activeBlockId;
  activeBlockEndMs = snapshot.activeBlockEndMs;
  dismissedBlockId = snapshot.dismissedBlockId;
  breakOvertimeSeconds = snapshot.breakOvertimeSeconds;
  segments = cloneSegmentsForWindowSync(snapshot.segments);
  currentSegmentIndex = segments.findIndex((segment) => segment.status === "active");
  segmentVersion = snapshot.segmentVersion;
  blockExpired = snapshot.blockExpired;
  suspendedAway = snapshot.suspendedAway ? { ...snapshot.suspendedAway } : null;
  idlePaused = snapshot.idlePaused ? { ...snapshot.idlePaused } : null;
}

function publishWindowSnapshot(): void {
  if (!pomodoroCoordinator) return;
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
  pauseLog: string;
  status: PersistedSegment["status"];
}

interface PomodoroSegmentUpdate {
  id: string;
  status: PersistedSegment["status"];
  actualStart: string | null;
  actualEnd: string | null;
  pauseLog: string;
}

interface PomodoroPauseMs {
  startMs: number;
  endMs: number | null;
}

function nowIso(): string {
  return new Date().toISOString();
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

function expirePausedBlockAtDeadline(): void {
  if (activeBlockEndMs === null) return;
  const endIso = new Date(activeBlockEndMs).toISOString();
  stopPausedOpportunityCountdown();
  refreshPausedOpportunityRemaining(activeBlockEndMs);

  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    markSegment(currentSegmentIndex, "completed", true, endIso);
    skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
  }

  if (phase === "focus" && sessionStartTime) {
    const seg = currentSegmentIndex >= 0 && currentSegmentIndex < segments.length
      ? segments[currentSegmentIndex] : null;
    saveCompletedSession(sessionStartTime, endIso, seg?.pauseLog ?? [], activeBlockId);
    sessionStartTime = null;
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
  preBreakExtensionUsed = false;
}

function addMinutesToIso(base: string, minutes: number): string {
  const d = new Date(base);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
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
    pauseLog: JSON.stringify(seg.pauseLog),
    status: seg.status,
  };
}

function segmentUpdate(seg: PersistedSegment): PomodoroSegmentUpdate {
  return {
    id: seg.id,
    status: seg.status,
    actualStart: seg.actualStart,
    actualEnd: seg.actualEnd,
    pauseLog: JSON.stringify(seg.pauseLog),
  };
}

function persistSegmentsToBackend(
  updatedSegments: PersistedSegment[],
  warning: string,
  bumpSegmentVersion: boolean,
) {
  if (updatedSegments.length === 0) return;
  invoke("pomodoro_update_segments", {
    dbUrl: dbUrl(),
    segments: updatedSegments.map(segmentUpdate),
  }).then(() => {
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
) {
  persistSegmentsToBackend([seg], warning, bumpSegmentVersion);
}

async function insertSegmentsToBackend(newSegments: PersistedSegment[]) {
  if (newSegments.length === 0) return;
  await invoke("pomodoro_insert_segments", {
    dbUrl: dbUrl(),
    segments: newSegments.map(segmentWrite),
  }).then(() => {
    segmentVersion++;
    publishWindowSnapshot();
  }).catch((e) => console.warn("Failed to insert segments:", e));
}

async function cleanupEventSegments(eventId: string, eventDate: string) {
  await invoke("pomodoro_cleanup_event_segments", {
    dbUrl: dbUrl(),
    eventId,
    eventDate,
  }).catch((e) => console.warn("Failed to clean up orphaned event segments:", e));
}

function skipPlannedSegmentsAfter(index: number, warning: string) {
  const updated: PersistedSegment[] = [];
  for (let i = index + 1; i < segments.length; i++) {
    if (segments[i].status === "planned") {
      segments[i].status = "skipped";
      updated.push(segments[i]);
    }
  }
  persistSegmentsToBackend(updated, warning, true);
}

function timestampMs(value: string): number {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return ms;
}

function pauseIntervalsMs(pauseLog: PauseInterval[]): PomodoroPauseMs[] {
  return pauseLog.map(([start, end]) => ({
    startMs: timestampMs(start),
    endMs: end === null ? null : timestampMs(end),
  }));
}

function markSegment(
  index: number,
  status: PersistedSegment["status"],
  setActualEnd: boolean = false,
  actualEndIso: string = nowIso(),
) {
  if (index < 0 || index >= segments.length) return;
  const seg = segments[index];
  seg.status = status;
  if (setActualEnd) seg.actualEnd = actualEndIso;

  // Close any open pause interval
  const lastPause = seg.pauseLog[seg.pauseLog.length - 1];
  if (lastPause && lastPause[1] === null) {
    lastPause[1] = seg.actualEnd ?? actualEndIso;
    seg.pauseLog = [...seg.pauseLog];
  }

  persistSegmentToBackend(seg, "Failed to update segment:", true);
  publishWindowSnapshot();
}

function activateSegment(index: number) {
  if (index < 0 || index >= segments.length) return;
  const seg = segments[index];
  seg.status = "active";
  seg.actualStart = nowIso();
  currentSegmentIndex = index;

  persistSegmentToBackend(seg, "Failed to activate segment:", false);
  publishWindowSnapshot();
}

async function createSegments(eventId: string, eventEnd: string, eventDate: string) {
  await cleanupEventSegments(eventId, eventDate);

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

  await insertSegmentsToBackend(newSegments);

  segments = newSegments;
  currentSegmentIndex = 0;
  publishWindowSnapshot();
}

function clearSegments() {
  segments = [];
  currentSegmentIndex = -1;
}

/**
 * Marks old segments as completed/skipped, builds a new segment plan
 * (bridge for current phase remainder + future segments), and persists.
 * Used by both reconfigureSession and transitionToBlock.
 */
async function rebuildSegments(blockId: string, eventEnd: string, eventDate: string) {
  // Clean up old segments: mark current as completed, remaining planned as skipped.
  // Guard against double-completing (segments may already be completed by tick's
  // block expiry handler before transitionToBlock triggers a rebuild).
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const seg = segments[currentSegmentIndex];
    if (seg.status !== "completed" && seg.status !== "skipped" && seg.status !== "interrupted") {
      markSegment(currentSegmentIndex, "completed", true);
    }
  }
  skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");

  // Build new segment plan from now to event end
  const runId = crypto.randomUUID();
  const now = new Date();
  const nowStr = now.toISOString();
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
      pauseLog: isPaused ? [[nowStr, null] as [string, string | null]] : [],
      status: "active",
    });
  }

  // Future segments after current phase ends
  const afterMinutes = totalRemainingMinutes - bridgeMinutes;
  if (afterMinutes > 0) {
    const baseAfter = addMinutesToIso(nowStr, bridgeMinutes);
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
  }

  await insertSegmentsToBackend(newSegments);

  // Preserve completed/interrupted segments so the green progress bar
  // keeps showing focus time accumulated before this rebuild.
  const kept = segments.filter(
    (s, i) => i <= currentSegmentIndex &&
      (s.status === "completed" || s.status === "interrupted"),
  );

  segments = [...kept, ...newSegments];
  currentSegmentIndex = kept.length + (bridgeMinutes > 0 ? 0 : -1);
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

  await rebuildSegments(blockId, eventEnd, eventDate);
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
    totalCycles,
    blockExpired,
  });

  config = newConfig;
  totalCycles = config.cyclesBeforeLongBreak;

  switch (result.kind) {
    case "trigger_break": {
      const endTime = new Date().toISOString();
      if (sessionStartTime) {
        const seg = currentSegmentIndex >= 0 && currentSegmentIndex < segments.length
          ? segments[currentSegmentIndex] : null;
        saveCompletedSession(sessionStartTime, endTime, seg?.pauseLog ?? [], activeBlockId);
      }
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
  await rebuildSegments(blockId, eventEnd, eventDate);
  updateTray();
}

// Tray

function updateTray() {
  publishWindowSnapshot();
  if (!pomodoroCoordinator) return;
  const isActive = pomodoroSessionActive();

  invoke("update_tray", {
    phase,
    remainingSeconds,
    totalSeconds: phaseTotalSeconds,
    isRunning,
    isActive,
  }).catch(() => {});
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
      transferBlockIdInternal(command.newBlockId, command.newEndTime);
      return;
    case "start-from-block":
      startFromBlockInternal(
        command.blockId,
        command.blockConfig,
        command.eventEnd,
        command.eventDate,
        command.blockIdleTimeoutMinutes,
      );
      return;
    case "dismiss-suspend":
      dismissSuspend(command.resume);
      return;
    case "dismiss-idle":
      dismissIdle(command.resume);
      return;
    case "stop-session":
      stopSessionInternal();
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
    document.dispatchEvent(new Event("ganbaruai-clear-snap"));
    if (phase === "short_break" || phase === "long_break") {
      // Mark current break segment as skipped
      markSegment(currentSegmentIndex, "skipped", true);
      startFocusSession();
    } else {
      skipNextBreak = true;
    }
  }).catch((e) => console.warn("Failed to listen for pomodoro-skip-break:", e));

  listen("pomodoro-break-acknowledged", () => {
    document.dispatchEvent(new Event("ganbaruai-clear-snap"));
    if (phase === "short_break" || phase === "long_break") {
      // Mark current break segment as completed
      markSegment(currentSegmentIndex, "completed", true);
      startFocusSession();
    }
  }).catch((e) => console.warn("Failed to listen for pomodoro-break-acknowledged:", e));

  listen("idle-overlay-resume", () => {
    if (idlePaused) dismissIdle(true);
  }).catch((e) => console.warn("Failed to listen for idle-overlay-resume:", e));

  listen("idle-overlay-stop", () => {
    if (idlePaused) dismissIdle(false);
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
    if (phase !== "focus" || preBreakExtensionUsed) return;
    const elapsedSeconds = actualPhaseElapsedSeconds();
    const nextWorkRemainingSeconds = phaseWorkRemainingSeconds() + event.payload.seconds;
    preBreakExtensionUsed = true;
    notificationShown = false;
    setPhaseRemainingSeconds(nextWorkRemainingSeconds, elapsedSeconds);
    if (phaseEndTime !== null) phaseEndTime = Date.now() + remainingSeconds * 1000;
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

function startFocusSession() {
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

function dismissSuspend(resume: boolean) {
  stopPausedOpportunityCountdown();
  suspendedAway = null;
  if (resume) {
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
    // Stop: save partial session up to suspend start
    if (phase === "focus" && sessionStartTime) {
      const seg = currentSegmentIndex >= 0 && currentSegmentIndex < segments.length
        ? segments[currentSegmentIndex] : null;
      const lastPause = seg?.pauseLog[seg.pauseLog.length - 1];
      const endIso = lastPause ? lastPause[0] : nowIso();
      saveCompletedSession(sessionStartTime, endIso, seg?.pauseLog ?? [], activeBlockId);
    }
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      markSegment(currentSegmentIndex, "interrupted", true);
      skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
    }
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
      seg.pauseLog = [...seg.pauseLog, [idleStartIso, null]];
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

function dismissIdle(resume: boolean) {
  stopPausedOpportunityCountdown();
  idlePaused = null;
  if (resume) {
    // Close the open pause interval
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      const seg = segments[currentSegmentIndex];
      const lastPause = seg.pauseLog[seg.pauseLog.length - 1];
      if (lastPause && lastPause[1] === null) {
        const updated = [...seg.pauseLog];
        updated[updated.length - 1] = [lastPause[0], nowIso()];
        seg.pauseLog = updated;
        persistSegmentToBackend(seg, "Failed to close idle pause:", false);
      }
    }
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
    // Stop session
    if (phase === "focus" && sessionStartTime) {
      const seg = currentSegmentIndex >= 0 && currentSegmentIndex < segments.length
        ? segments[currentSegmentIndex] : null;
      const lastPause = seg?.pauseLog[seg.pauseLog.length - 1];
      const endIso = lastPause ? lastPause[0] : nowIso();
      saveCompletedSession(sessionStartTime, endIso, seg?.pauseLog ?? [], activeBlockId);
    }
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      markSegment(currentSegmentIndex, "interrupted", true);
      skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
    }
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
    allowAddTime: !preBreakExtensionUsed,
  }).catch((e) => {
    console.warn("Failed to show notification:", e);
    notificationShown = false;
  });
}

async function saveCompletedSession(
  startTime: string,
  endTime: string,
  pauseLog: PauseInterval[] = [],
  eventId: string | null = null,
): Promise<void> {
  try {
    await invoke("pomodoro_save_session", {
      dbUrl: dbUrl(),
      session: {
        id: crypto.randomUUID(),
        eventId,
        startTime,
        endTime,
        startMs: timestampMs(startTime),
        endMs: timestampMs(endTime),
        pauses: pauseIntervalsMs(pauseLog),
      },
    });
  } catch (e) {
    console.warn("Failed to save completed session:", e);
  }
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
        seg.pauseLog = [...seg.pauseLog, [result.suspendStartIso, result.suspendEndIso]];
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
      markCurrentAndSkipRemaining();
      if (phase === "focus" && sessionStartTime) {
        const seg = currentSegmentIndex >= 0 && currentSegmentIndex < segments.length
          ? segments[currentSegmentIndex] : null;
        saveCompletedSession(sessionStartTime, result.suspendStartIso, seg?.pauseLog ?? [], activeBlockId);
        sessionStartTime = null;
      }
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
        seg.pauseLog = [...seg.pauseLog, [result.suspendStartIso, result.suspendEndIso]];
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
      markCurrentAndSkipRemaining();
      if (phase === "focus" && sessionStartTime) {
        const seg = currentSegmentIndex >= 0 && currentSegmentIndex < segments.length
          ? segments[currentSegmentIndex] : null;
        saveCompletedSession(
          sessionStartTime,
          new Date(activeBlockEndMs!).toISOString(),
          seg?.pauseLog ?? [],
          activeBlockId,
        );
        sessionStartTime = null;
      }
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
            markSegment(currentSegmentIndex, "completed", true);
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
function markCurrentAndSkipRemaining() {
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    markSegment(currentSegmentIndex, "completed", true);
    skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
  }
}

function advancePhase() {
  const result = decideAdvancePhase(buildSnapshot());

  // Save completed focus session before transitioning away from focus
  if (phase === "focus") {
    const endTime = new Date().toISOString();
    if (sessionStartTime) {
      const seg = currentSegmentIndex >= 0 && currentSegmentIndex < segments.length
        ? segments[currentSegmentIndex] : null;
      saveCompletedSession(sessionStartTime, endTime, seg?.pauseLog ?? [], activeBlockId);
    }
    completedPomodoros += 1;
    sessionStartTime = null;
    notificationShown = false;
    markSegment(currentSegmentIndex, "completed", true);
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
        segments[breakIdx].status = "skipped";
        segments[breakIdx].actualStart = now;
        segments[breakIdx].actualEnd = now;
        persistSegmentToBackend(segments[breakIdx], "Failed to skip segment:", true);

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
      markSegment(currentSegmentIndex, "completed", true);
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

function transferBlockIdInternal(newBlockId: string, newEndTime?: string): void {
  if (!activeBlockId) return;
  activeBlockId = newBlockId;
  if (newEndTime) {
    activeBlockEndMs = new Date(newEndTime.replace(" ", "T")).getTime();
    refreshCurrentPhaseLimit();
  }
  for (const seg of segments) {
    seg.eventId = newBlockId;
  }
  publishWindowSnapshot();
}

function startFromBlockInternal(
  blockId: string,
  blockConfig: Partial<PomodoroConfig>,
  eventEnd?: string,
  eventDate?: string,
  blockIdleTimeoutMinutes?: number | null,
): void {
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
      activeBlockEndMs = decision.newEndMs;
      refreshCurrentPhaseLimit();
      publishWindowSnapshot();
      return;

    case "reconfigure":
      reconfigureSession(blockId, decision.newConfig, eventEnd!, eventDate!);
      return;

    case "rebuild_segments":
      activeBlockEndMs = decision.newEndMs;
      refreshCurrentPhaseLimit();
      rebuildSegments(blockId, eventEnd!, eventDate!);
      return;

    case "transition":
      transitionToBlock(blockId, decision.newConfig, eventEnd!, eventDate!);
      return;

    case "new_session": {
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
        createSegments(blockId, eventEnd, eventDate);
      }

      updateTray();
      return;
    }
  }
}

function stopSessionInternal(): void {
  stopPausedOpportunityCountdown();
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    const seg = segments[currentSegmentIndex];
    if (seg.status === "active") {
      markSegment(currentSegmentIndex, "interrupted", true);
    }
    skipPlannedSegmentsAfter(currentSegmentIndex, "Failed to skip segment:");
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
  activeBlockId = null;
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
    seg.pauseLog = [...seg.pauseLog, [now, null]];
    persistSegmentToBackend(seg, "Failed to save pause:", false);
  }
  startPausedOpportunityCountdown();
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
    const lastPause = seg.pauseLog[seg.pauseLog.length - 1];
    if (lastPause && lastPause[1] === null) {
      lastPause[1] = nowIso();
      seg.pauseLog = [...seg.pauseLog];
      persistSegmentToBackend(seg, "Failed to save resume:", false);
    }
  }
  intervalId = setInterval(tick, 1000);
  lastTickMs = Date.now();
  startIdleChecking();
  updateTray();
}

function skipSession(): void {
  advancePhase();
}

async function cleanupOrphansInternal(): Promise<void> {
  await invoke("pomodoro_cleanup_orphans", {
    dbUrl: dbUrl(),
  }).then(() => {
    segmentVersion++;
    publishWindowSnapshot();
  }).catch((e) => console.warn("Failed to clean up orphaned segments:", e));
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
    transferBlockId(newBlockId: string, newEndTime?: string) {
      if (forwardWindowCommand({ kind: "transfer-block-id", newBlockId, newEndTime })) return;
      transferBlockIdInternal(newBlockId, newEndTime);
    },
    get suspendedAway() {
      return suspendedAway;
    },
    dismissSuspend(resume: boolean) {
      if (forwardWindowCommand({ kind: "dismiss-suspend", resume })) return;
      dismissSuspend(resume);
    },
    get idlePaused() {
      return idlePaused;
    },
    dismissIdle(resume: boolean) {
      if (forwardWindowCommand({ kind: "dismiss-idle", resume })) return;
      dismissIdle(resume);
    },
    startFromBlock(
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
      startFromBlockInternal(
        blockId,
        blockConfig,
        eventEnd,
        eventDate,
        blockIdleTimeoutMinutes,
      );
    },
    stopSession() {
      if (forwardWindowCommand({ kind: "stop-session" })) return;
      stopSessionInternal();
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
    /** Clean up orphaned segments from previous app sessions. Call once on startup. */
    async cleanupOrphans() {
      if (forwardWindowCommand({ kind: "cleanup-orphans" })) return;
      await cleanupOrphansInternal();
    },
  };
}
