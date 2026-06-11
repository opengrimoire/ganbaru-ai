import type {
  PauseInterval,
  PersistedSegment,
  SegmentPhase,
} from "$lib/components/calendar/types";
import type {
  PomodoroRunAdaptiveSnapshotWrite,
} from "$lib/pomodoro/adaptive/persistence";
import type { PomodoroConfig } from "./pomodoro-machine";
import { normalizePausesForSegment } from "./pomodoro-segment-intervals";

export interface PomodoroSegmentWrite {
  id: string;
  eventId: string;
  eventDate: string;
  runId: string;
  rhythmPosition: number;
  phase: SegmentPhase;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  pauses: PauseInterval[];
  status: PersistedSegment["status"];
  endReason: PomodoroSegmentEndReason | null;
}

export interface PomodoroSegmentUpdate {
  id: string;
  status: PersistedSegment["status"];
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  endReason: PomodoroSegmentEndReason | null;
  occurredAt: string | null;
  pauses: PauseInterval[];
}

export type PomodoroStartTrigger = "manual" | "block_auto" | "block_transition" | "reconfigure" | "crash_recovery";
export type PomodoroRunEndReason = "completed" | "stopped" | "interrupted" | "reconfigured" | "block_transition";
export type PomodoroSegmentEndReason =
  | "completed"
  | "stopped"
  | "skipped_by_user"
  | "event_expired"
  | "focus_failed"
  | "reconfigured"
  | "block_transition"
  | "crash_recovery";
export type PomodoroRunEventType =
  | "start"
  | "phase_start"
  | "phase_complete"
  | "pause_start"
  | "pause_end"
  | "idle_detected"
  | "focus_failed"
  | "suspend_detected"
  | "skip_break"
  | "extend_focus"
  | "go_to_break_now"
  | "start_focus_now"
  | "reconfigure"
  | "block_transition"
  | "stop"
  | "complete"
  | "crash_recovery";

export interface PomodoroRunWrite {
  id: string;
  eventId: string;
  eventDate: string;
  plannedStart: string;
  plannedEnd: string;
  startedAt: string;
  rhythm: PomodoroConfig["rhythm"];
  rhythmSource: PomodoroConfig["rhythmSource"];
  presetKey: PomodoroConfig["presetKey"];
  idleTimeoutMinutes: number | null;
  eventTitleSnapshot: string | null;
  inheritedFocusMinutes: number;
  inheritedRhythmPosition: number;
  inheritedFromRunId: string | null;
  startTrigger: PomodoroStartTrigger;
  adaptiveSnapshot: PomodoroRunAdaptiveSnapshotWrite | null;
}

export interface PomodoroRunClosure {
  runId: string;
  endedAt: string;
  endReason: PomodoroRunEndReason;
  segmentStatus: "completed" | "interrupted";
  segmentEndReason: PomodoroSegmentEndReason;
  eventType: PomodoroRunEventType;
}

export interface PomodoroRunWindowUpdate {
  runId: string;
  plannedEnd: string;
}

export interface PomodoroActiveEventReferenceTransfer {
  newEventId: string;
  newEventDate: string | null;
  plannedEnd: string | null;
}

export interface PomodoroTransitionRunWrite {
  closure: PomodoroRunClosure;
  run: PomodoroRunWrite;
  segment: PomodoroSegmentWrite;
}

export interface PomodoroBackendWriteOptions {
  bumpSegmentVersion?: boolean;
  publishSnapshot?: boolean;
}

export interface PomodoroRunEventWrite {
  runId: string;
  segmentId: string | null;
  eventType: PomodoroRunEventType;
  occurredAt: string;
  phase: SegmentPhase | null;
  reason: string | null;
  durationSeconds: number | null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function buildPomodoroSegmentWrite(seg: PersistedSegment): PomodoroSegmentWrite {
  return {
    id: seg.id,
    eventId: seg.eventId,
    eventDate: seg.eventDate,
    runId: seg.runId,
    rhythmPosition: seg.rhythmPosition,
    phase: seg.phase,
    plannedStart: seg.plannedStart,
    plannedEnd: seg.plannedEnd,
    actualStart: seg.actualStart,
    actualEnd: seg.actualEnd,
    pauses: normalizePausesForSegment(seg, seg.pauseLog),
    status: seg.status,
    endReason: null,
  };
}

export function buildPomodoroSegmentUpdate(
  seg: PersistedSegment,
  endReason: PomodoroSegmentEndReason | null,
  occurredAt: string | null = null,
): PomodoroSegmentUpdate {
  return {
    id: seg.id,
    status: seg.status,
    plannedEnd: seg.plannedEnd,
    actualStart: seg.actualStart,
    actualEnd: seg.actualEnd,
    endReason,
    occurredAt,
    pauses: normalizePausesForSegment(seg, seg.pauseLog),
  };
}
