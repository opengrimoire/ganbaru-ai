import type { PomodoroPhase } from "@ganbaru-ai/shared-types";
import type {
  PauseReason,
  PersistedSegment,
  SegmentPhase,
} from "$lib/components/calendar/types";
import {
  buildRunStartAdaptiveSnapshot,
  snapshotFromBoundaryAdaptiveDecision,
  snapshotFromRunStartAdaptiveDecision,
  type PomodoroAdaptivePlannedBlockWrite,
  type PomodoroBoundaryAdaptiveDecision,
  type PomodoroRunAdaptiveSnapshotWrite,
  type PomodoroRunStartAdaptiveDecision,
} from "$lib/pomodoro/adaptive/persistence";
import {
  breakAfterFocusPosition,
  clonePomodoroConfig,
  focusDurationMinutesAtPosition,
  nextRhythmPosition,
  type PomodoroConfig,
} from "$lib/pomodoro/rhythm";
import { computePlannedSegments } from "$lib/utils/pomodoro-segments";
import {
  buildPomodoroSegmentWrite,
  nowIso,
  type PomodoroRunEndReason,
  type PomodoroRunEventType,
  type PomodoroRunWrite,
  type PomodoroSegmentEndReason,
  type PomodoroStartTrigger,
} from "./pomodoro-backend-writes";
import { decideRunStartAdaptiveForState, isAdaptiveCountConfig } from "./pomodoro-adaptive-decisions";
import { TIME_MULTIPLIER } from "./pomodoro-machine";
import type { PomodoroRunRepository } from "./pomodoro-run-repository";
import {
  normalizePauseForSegment,
  normalizeSegmentEndIso,
} from "./pomodoro-segment-intervals";
import { cloneSegmentsForWindowSync } from "./pomodoro-window-sync";

export interface RebuildRunOptions {
  runEndReason: PomodoroRunEndReason;
  segmentStatus: "completed" | "interrupted";
  segmentEndReason: PomodoroSegmentEndReason;
  eventType: PomodoroRunEventType;
  startTrigger: PomodoroStartTrigger;
  inheritedFocusSeconds: number;
  inheritedRhythmPosition: number;
}

interface PomodoroSegmentControllerContext {
  phase: PomodoroPhase;
  remainingSeconds: number;
  currentRhythmPosition: number;
  config: PomodoroConfig;
  isRunning: boolean;
  activeBlockId: string | null;
  activeRunId: string | null;
  activeBlockEndMs: number | null;
  idleTimeoutMs: number | null;
  segments: PersistedSegment[];
  currentSegmentIndex: number;
  segmentVersion: number;
  readonly segmentEndReasons: Map<string, PomodoroSegmentEndReason>;
  publishWindowSnapshot(): void;
  refreshCurrentPhaseLimit(nowMs?: number): void;
  scheduleBreakEndWarning(): void;
  updateTray(): void;
  startHeartbeat(): void;
  stopSession(): Promise<void>;
  isPausedForBridgeSegment(): boolean;
  applyRunStartAdaptiveDecision(decision: PomodoroRunStartAdaptiveDecision): void;
}

export interface PomodoroSegmentController {
  activeSegment(): PersistedSegment | null;
  runPlannedEndForSegment(segment: PersistedSegment): string;
  addMinutesToIso(base: string, minutes: number): string;
  eventDateFromBlockId(blockId: string): string | null;
  timestampMs(value: string): number;
  appendPause(
    segment: PersistedSegment,
    startedAt: string,
    reason: PauseReason,
    endedAt?: string | null,
  ): void;
  closeLastPause(segment: PersistedSegment, endedAt: string): boolean;
  normalizedActiveSegmentEndIso(requestedEndIso: string): string;
  markSegment(
    index: number,
    status: PersistedSegment["status"],
    setActualEnd?: boolean,
    actualEndIso?: string,
    endReason?: PomodoroSegmentEndReason | null,
    throwOnError?: boolean,
  ): Promise<void>;
  activateSegment(index: number): Promise<void>;
  activateBoundarySegment(
    segment: PersistedSegment,
    adaptiveDecision: PomodoroBoundaryAdaptiveDecision | null,
  ): Promise<void>;
  boundarySegment(
    phase: SegmentPhase,
    rhythmPosition: number,
    plannedStart: string,
  ): PersistedSegment | null;
  createSegments(
    eventId: string,
    eventEnd: string,
    eventDate: string,
    adaptivePlannedBlocks?: readonly PomodoroAdaptivePlannedBlockWrite[],
  ): Promise<void>;
  clearSegments(): void;
  skipPlannedSegmentsAfter(index: number, warning: string): Promise<void>;
  plannedSegmentsAfterCurrentPhase(
    blockId: string,
    eventDate: string,
    runId: string,
    baseAfter: string,
    afterMinutes: number,
  ): PersistedSegment[];
  refreshFutureSegmentsForActiveWindow(blockId: string, eventDate: string): void;
  applyActiveBlockWindowChange(blockId: string, newEndMs: number, eventDate?: string): void;
  rebuildSegments(
    blockId: string,
    eventEnd: string,
    eventDate: string,
    options: RebuildRunOptions,
  ): Promise<void>;
}

export function createPomodoroSegmentController(
  context: PomodoroSegmentControllerContext,
  repository: PomodoroRunRepository,
): PomodoroSegmentController {
  function activeSegment(): PersistedSegment | null {
    return context.currentSegmentIndex >= 0 && context.currentSegmentIndex < context.segments.length
      ? context.segments[context.currentSegmentIndex]
      : null;
  }

  function runPlannedEndForSegment(segment: PersistedSegment): string {
    return context.activeBlockEndMs === null
      ? segment.plannedEnd
      : new Date(context.activeBlockEndMs).toISOString();
  }

  function addMinutesToIso(base: string, minutes: number): string {
    const date = new Date(base);
    date.setMinutes(date.getMinutes() + minutes);
    return date.toISOString();
  }

  function eventDateFromBlockId(blockId: string): string | null {
    return blockId.split("::")[1] ?? null;
  }

  function timestampMs(value: string): number {
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) {
      throw new Error(`Invalid timestamp: ${value}`);
    }
    return ms;
  }

  function appendPause(
    segment: PersistedSegment,
    startedAt: string,
    reason: PauseReason,
    endedAt: string | null = null,
  ): void {
    segment.pauseLog = [
      ...segment.pauseLog,
      normalizePauseForSegment(segment, { startedAt, endedAt, reason }),
    ];
  }

  function closeLastPause(segment: PersistedSegment, endedAt: string): boolean {
    const lastPause = segment.pauseLog[segment.pauseLog.length - 1];
    if (!lastPause || lastPause.endedAt !== null) return false;
    const updated = [...segment.pauseLog];
    updated[updated.length - 1] = normalizePauseForSegment(segment, { ...lastPause, endedAt });
    segment.pauseLog = updated;
    return true;
  }

  function normalizedActiveSegmentEndIso(requestedEndIso: string): string {
    const segment = activeSegment();
    return segment ? normalizeSegmentEndIso(segment, requestedEndIso) : requestedEndIso;
  }

  async function markSegment(
    index: number,
    status: PersistedSegment["status"],
    setActualEnd = false,
    actualEndIso: string = nowIso(),
    endReason: PomodoroSegmentEndReason | null = null,
    throwOnError = false,
  ): Promise<void> {
    if (index < 0 || index >= context.segments.length) return;
    const segment = context.segments[index];
    segment.status = status;
    if (endReason) context.segmentEndReasons.set(segment.id, endReason);
    const normalizedActualEndIso = normalizeSegmentEndIso(segment, actualEndIso);
    if (setActualEnd) segment.actualEnd = normalizedActualEndIso;

    closeLastPause(segment, segment.actualEnd ?? normalizedActualEndIso);

    context.publishWindowSnapshot();
    await repository.persistSegment(
      segment,
      "Failed to update segment:",
      true,
      normalizedActualEndIso,
      throwOnError,
    );
  }

  function activateSegment(index: number): Promise<void> {
    if (index < 0 || index >= context.segments.length) return Promise.resolve();
    const segment = context.segments[index];
    segment.status = "active";
    segment.actualStart = nowIso();
    context.currentSegmentIndex = index;

    const persisted = repository.insertSegments([segment])
      .catch((e) => console.warn("Failed to activate segment:", e));
    context.publishWindowSnapshot();
    return persisted;
  }

  async function activateBoundarySegment(
    segment: PersistedSegment,
    adaptiveDecision: PomodoroBoundaryAdaptiveDecision | null,
  ): Promise<void> {
    const kept = context.currentSegmentIndex >= 0
      ? context.segments.slice(0, context.currentSegmentIndex + 1)
      : [];
    context.segments = [...kept, segment];
    context.currentSegmentIndex = kept.length;

    const persisted = adaptiveDecision && context.activeRunId
      ? repository.insertSegmentWithAdaptiveDecision(
          segment,
          snapshotFromBoundaryAdaptiveDecision(adaptiveDecision, {
            runId: context.activeRunId,
            segmentId: segment.id,
          }),
        )
      : repository.insertSegments([segment]);
    context.publishWindowSnapshot();
    await persisted;
    refreshFutureSegmentsForActiveWindow(segment.eventId, segment.eventDate);
    context.publishWindowSnapshot();
  }

  function boundarySegment(
    phase: SegmentPhase,
    rhythmPosition: number,
    plannedStart: string,
  ): PersistedSegment | null {
    if (!context.activeRunId || !context.activeBlockId) return null;
    const eventDate = activeSegment()?.eventDate ?? eventDateFromBlockId(context.activeBlockId);
    if (!eventDate) return null;
    const plannedStartMs = Date.parse(plannedStart);
    const plannedEndMs = Number.isFinite(plannedStartMs)
      ? plannedStartMs + context.remainingSeconds * 1000
      : Date.now() + context.remainingSeconds * 1000;
    return {
      id: crypto.randomUUID(),
      eventId: context.activeBlockId,
      eventDate,
      runId: context.activeRunId,
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
    const configSnapshot = clonePomodoroConfig(context.config);
    const adaptiveSnapshot = adaptiveSnapshotOverride ??
      (isAdaptiveCountConfig(configSnapshot)
        ? buildRunStartAdaptiveSnapshot({
            runId,
            segmentId,
            startedAt,
            plannedStart,
            plannedEnd,
            currentRhythm: configSnapshot.rhythm,
            idleDetectionEnabled: context.idleTimeoutMs !== null,
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
      idleTimeoutMinutes: context.idleTimeoutMs === null
        ? null
        : Math.round(context.idleTimeoutMs / 60000),
      eventTitleSnapshot: null,
      inheritedFocusMinutes,
      inheritedRhythmPosition,
      inheritedFromRunId,
      startTrigger,
      adaptiveSnapshot,
    };
  }

  async function createSegments(
    eventId: string,
    eventEnd: string,
    eventDate: string,
    adaptivePlannedBlocks: readonly PomodoroAdaptivePlannedBlockWrite[] = [],
  ): Promise<void> {
    const runId = crypto.randomUUID();

    const now = new Date();
    const end = new Date(eventEnd.replace(" ", "T"));
    const baseIso = now.toISOString();
    const runStartAdaptiveDecision = await decideRunStartAdaptiveForState({
      config: context.config,
      idleDetectionEnabled: context.idleTimeoutMs !== null,
      startedAt: baseIso,
      plannedStart: baseIso,
      plannedEnd: end.toISOString(),
    });
    if (runStartAdaptiveDecision) {
      context.applyRunStartAdaptiveDecision(runStartAdaptiveDecision);
    }
    const remainingMinutes = Math.max(0, (end.getTime() - now.getTime()) / 60000);

    const planned = computePlannedSegments(
      context.config,
      remainingMinutes,
      0,
      context.currentRhythmPosition,
    );

    const newSegments: PersistedSegment[] = planned.map((segment, index) => ({
      id: crypto.randomUUID(),
      eventId,
      eventDate,
      runId,
      rhythmPosition: segment.rhythmPosition,
      phase: segment.phase as SegmentPhase,
      plannedStart: addMinutesToIso(baseIso, segment.startOffsetMinutes),
      plannedEnd: addMinutesToIso(baseIso, segment.endOffsetMinutes),
      actualStart: index === 0 ? baseIso : null,
      actualEnd: null,
      pauseLog: [],
      status: index === 0 ? "active" as const : "planned" as const,
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
        await repository.startRun(
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
        void context.stopSession();
        return;
      }
      context.activeRunId = runId;
      context.startHeartbeat();
    }
    context.segments = newSegments;
    context.currentSegmentIndex = 0;
    context.publishWindowSnapshot();
  }

  function clearSegments(): void {
    context.segments = [];
    context.currentSegmentIndex = -1;
    context.segmentEndReasons.clear();
  }

  function skipPlannedSegmentsAfter(index: number, warning: string): Promise<void> {
    const updated: PersistedSegment[] = [];
    for (let i = index + 1; i < context.segments.length; i++) {
      if (context.segments[i].status === "planned") {
        context.segments[i].status = "skipped";
        updated.push(context.segments[i]);
      }
    }
    return repository.persistSegments(updated, warning, true);
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
    let nextIsFocus = context.phase !== "focus";
    let rhythmPosition = nextIsFocus
      ? nextRhythmPosition(context.config, context.currentRhythmPosition)
      : context.currentRhythmPosition;

    while (offset < afterMinutes) {
      if (nextIsFocus) {
        const focusDuration = focusDurationMinutesAtPosition(context.config, rhythmPosition);
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
        const breakInfo = breakAfterFocusPosition(context.config, rhythmPosition);
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
        rhythmPosition = nextRhythmPosition(context.config, rhythmPosition);
        nextIsFocus = true;
      }
    }

    return newSegments;
  }

  function refreshFutureSegmentsForActiveWindow(blockId: string, eventDate: string): void {
    if (!context.activeRunId || context.activeBlockEndMs === null) return;
    if (context.currentSegmentIndex < 0 || context.currentSegmentIndex >= context.segments.length) {
      return;
    }

    const nowMs = Date.now();
    const currentPhaseEndMs = nowMs + Math.max(0, context.remainingSeconds) * 1000;
    const afterMinutes = Math.max(0, (context.activeBlockEndMs - currentPhaseEndMs) / 60000);
    const baseAfter = new Date(currentPhaseEndMs).toISOString();
    context.segments = [
      ...context.segments.slice(0, context.currentSegmentIndex + 1),
      ...plannedSegmentsAfterCurrentPhase(
        blockId,
        eventDate,
        context.activeRunId,
        baseAfter,
        afterMinutes,
      ),
    ];
  }

  function applyActiveBlockWindowChange(
    blockId: string,
    newEndMs: number,
    eventDate?: string,
  ): void {
    context.activeBlockEndMs = newEndMs;
    context.refreshCurrentPhaseLimit();
    context.scheduleBreakEndWarning();
    if (context.activeRunId) {
      repository.updateRunWindow({
        runId: context.activeRunId,
        plannedEnd: new Date(newEndMs).toISOString(),
      });
    }

    const segmentEventDate = eventDate ?? activeSegment()?.eventDate;
    if (segmentEventDate) {
      refreshFutureSegmentsForActiveWindow(blockId, segmentEventDate);
    }
    context.updateTray();
  }

  async function rebuildSegments(
    blockId: string,
    eventEnd: string,
    eventDate: string,
    options: RebuildRunOptions,
  ): Promise<void> {
    const previousSegments = cloneSegmentsForWindowSync(context.segments);
    const previousSegmentIndex = context.currentSegmentIndex;
    const previousEndReasons = new Map(context.segmentEndReasons);
    const workingSegments = cloneSegmentsForWindowSync(context.segments);
    const workingEndReasons = new Map(context.segmentEndReasons);
    const previousRunId = context.activeRunId;
    const runId = crypto.randomUUID();
    const now = new Date();
    const nowStr = now.toISOString();

    if (context.currentSegmentIndex >= 0 && context.currentSegmentIndex < workingSegments.length) {
      const segment = workingSegments[context.currentSegmentIndex];
      if (
        segment.status !== "completed" &&
        segment.status !== "skipped" &&
        segment.status !== "interrupted"
      ) {
        segment.status = options.segmentStatus;
        segment.actualEnd = nowStr;
        workingEndReasons.set(segment.id, options.segmentEndReason);
        closeLastPause(segment, nowStr);
      }
    }

    const end = new Date(eventEnd.replace(" ", "T"));
    const totalRemainingMinutes = Math.max(0, (end.getTime() - now.getTime()) / 60000);
    const bridgeMinutes = context.remainingSeconds / 60;
    const currentPhaseType: SegmentPhase = context.phase === "focus"
      ? "focus"
      : context.phase === "short_break" ? "short_break" : "long_break";

    const newSegments: PersistedSegment[] = [];

    const isPaused = context.isPausedForBridgeSegment();
    if (bridgeMinutes > 0) {
      newSegments.push({
        id: crypto.randomUUID(),
        eventId: blockId,
        eventDate,
        runId,
        rhythmPosition: context.currentRhythmPosition,
        phase: currentPhaseType,
        plannedStart: nowStr,
        plannedEnd: addMinutesToIso(nowStr, bridgeMinutes),
        actualStart: nowStr,
        actualEnd: null,
        pauseLog: isPaused ? [{ startedAt: nowStr, endedAt: null, reason: "manual" }] : [],
        status: "active",
      });
    }

    const afterMinutes = totalRemainingMinutes - bridgeMinutes;
    if (afterMinutes > 0) {
      const baseAfter = addMinutesToIso(nowStr, bridgeMinutes);
      newSegments.push(...plannedSegmentsAfterCurrentPhase(blockId, eventDate, runId, baseAfter, afterMinutes));
    }

    const kept = workingSegments.filter(
      (segment, index) => index <= context.currentSegmentIndex &&
        (segment.status === "completed" || segment.status === "interrupted"),
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
          await repository.transitionRun({
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
          await repository.startRun(
            run,
            firstSegment,
            { bumpSegmentVersion: false, publishSnapshot: false },
          );
        }
      } catch (e) {
        console.warn("Failed to rebuild pomodoro run:", e);
        context.segments = previousSegments;
        context.currentSegmentIndex = previousSegmentIndex;
        context.segmentEndReasons.clear();
        for (const [id, reason] of previousEndReasons) {
          context.segmentEndReasons.set(id, reason);
        }
        context.publishWindowSnapshot();
        return;
      }
      context.activeRunId = runId;
      context.startHeartbeat();
    }

    context.segmentEndReasons.clear();
    for (const [id, reason] of workingEndReasons) {
      context.segmentEndReasons.set(id, reason);
    }
    context.segments = [...kept, ...newSegments];
    context.currentSegmentIndex = kept.length + (firstSegment ? newSegments.indexOf(firstSegment) : -1);
    context.segmentVersion++;
    context.publishWindowSnapshot();
  }

  return {
    activeSegment,
    runPlannedEndForSegment,
    addMinutesToIso,
    eventDateFromBlockId,
    timestampMs,
    appendPause,
    closeLastPause,
    normalizedActiveSegmentEndIso,
    markSegment,
    activateSegment,
    activateBoundarySegment,
    boundarySegment,
    createSegments,
    clearSegments,
    skipPlannedSegmentsAfter,
    plannedSegmentsAfterCurrentPhase,
    refreshFutureSegmentsForActiveWindow,
    applyActiveBlockWindowChange,
    rebuildSegments,
  };
}
