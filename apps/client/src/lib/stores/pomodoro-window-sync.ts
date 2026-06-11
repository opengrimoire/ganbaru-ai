import type { PomodoroPhase } from "@ganbaru-ai/shared-types";
import type {
  PauseInterval,
  PauseReason,
  PersistedSegment,
  SegmentPhase,
} from "$lib/components/calendar/types";
import type { PomodoroAdaptivePlannedBlockWrite } from "$lib/pomodoro/adaptive/persistence";
import { isValidPomodoroConfig } from "$lib/pomodoro/rhythm";
import type { PomodoroConfig } from "./pomodoro-machine";

export interface PomodoroWindowSnapshot {
  phase: PomodoroPhase;
  remainingSeconds: number;
  phaseTotalSeconds: number;
  phaseWorkDurationSeconds: number;
  currentRhythmPosition: number;
  totalRhythmPositions: number;
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
  idlePaused: IdlePauseState | null;
}

export interface IdlePauseState {
  idleSeconds: number;
  nativeOverlay: boolean;
  idleStartMs: number;
  overlayStartedAtMs: number;
  focusFailed: boolean;
  focusFailedAtMs: number | null;
}

export type PomodoroWindowCommand =
  | { kind: "request-snapshot" }
  | { kind: "set-dismissed-block-id"; id: string | null }
  | { kind: "clear-block-expired" }
  | { kind: "transfer-block-id"; newBlockId: string; newEndTime?: string }
  | {
      kind: "start-from-block";
      blockId: string;
      blockConfig: PomodoroConfig;
      eventEnd?: string;
      eventDate?: string;
      blockIdleTimeoutMinutes?: number | null;
      syncIdleTimeoutOnExistingBlock?: boolean;
      adaptivePlannedBlocks?: PomodoroAdaptivePlannedBlockWrite[];
    }
  | { kind: "set-active-idle-threshold-minutes"; minutes: number }
  | { kind: "dismiss-suspend"; resume: boolean }
  | { kind: "dismiss-idle"; resume: boolean }
  | { kind: "mark-idle-focus-failed"; failedAtMs?: number }
  | { kind: "complete-active-block-at"; endIso: string }
  | { kind: "stop-session" }
  | { kind: "pause" }
  | { kind: "start" }
  | { kind: "skip" }
  | { kind: "add-focus-time"; seconds: number }
  | { kind: "cleanup-orphans" };

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
  return isRecord(value) && isValidPomodoroConfig(value as unknown as PomodoroConfig);
}

function isAdaptivePlannedBlock(value: unknown): value is PomodoroAdaptivePlannedBlockWrite {
  if (!isRecord(value)) return false;
  return (
    typeof value.eventDate === "string" &&
    isNullableString(value.eventId) &&
    typeof value.originalEventId === "string" &&
    typeof value.plannedStart === "string" &&
    typeof value.plannedEnd === "string" &&
    (
      value.sourceKind === "live_event" ||
      value.sourceKind === "archived_event" ||
      value.sourceKind === "scheduler_snapshot"
    )
  );
}

function isAdaptivePlannedBlockList(value: unknown): value is PomodoroAdaptivePlannedBlockWrite[] {
  return Array.isArray(value) && value.every(isAdaptivePlannedBlock);
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
    typeof value.rhythmPosition === "number" &&
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

export function isPomodoroWindowSnapshot(value: unknown): value is PomodoroWindowSnapshot {
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
      typeof idlePausedValue.nativeOverlay === "boolean" &&
      isNonNegativeNumber(idlePausedValue.idleStartMs) &&
      isNonNegativeNumber(idlePausedValue.overlayStartedAtMs) &&
      typeof idlePausedValue.focusFailed === "boolean" &&
      isNullableNumber(idlePausedValue.focusFailedAtMs)
    );

  return (
    isPomodoroPhase(value.phase) &&
    isNonNegativeNumber(value.remainingSeconds) &&
    isNonNegativeNumber(value.phaseTotalSeconds) &&
    isNonNegativeNumber(value.phaseWorkDurationSeconds) &&
    isPositiveNumber(value.currentRhythmPosition) &&
    isPositiveNumber(value.totalRhythmPositions) &&
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

export function isPomodoroWindowCommand(value: unknown): value is PomodoroWindowCommand {
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
    case "mark-idle-focus-failed":
      return value.failedAtMs === undefined || isNonNegativeNumber(value.failedAtMs);
    case "add-focus-time":
      return isPositiveNumber(value.seconds);
    case "set-active-idle-threshold-minutes":
      return isPositiveNumber(value.minutes);
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
        isPomodoroConfig(value.blockConfig) &&
        (value.eventEnd === undefined || typeof value.eventEnd === "string") &&
        (value.eventDate === undefined || typeof value.eventDate === "string") &&
        (
          value.blockIdleTimeoutMinutes === undefined ||
          value.blockIdleTimeoutMinutes === null ||
          isNonNegativeNumber(value.blockIdleTimeoutMinutes)
        ) &&
        (
          value.syncIdleTimeoutOnExistingBlock === undefined ||
          typeof value.syncIdleTimeoutOnExistingBlock === "boolean"
        ) &&
        (
          value.adaptivePlannedBlocks === undefined ||
          isAdaptivePlannedBlockList(value.adaptivePlannedBlocks)
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

export function cloneSegmentsForWindowSync(source: readonly PersistedSegment[]): PersistedSegment[] {
  return source.map((segment) => ({
    ...segment,
    pauseLog: segment.pauseLog.map((pause) => ({ ...pause })),
  }));
}
