import type { PomodoroPhase } from "@ganbaru-ai/shared-types";
import { invoke } from "@tauri-apps/api/core";

import type { PersistedSegment } from "$lib/components/calendar/types";
import { focusDurationMinutesAtPosition, type PomodoroConfig } from "$lib/pomodoro/rhythm";
import {
  IDLE_CHECK_MAX_INTERVAL_MS,
  IDLE_FOCUS_FAILURE_DELAY_SECONDS,
  TIME_MULTIPLIER,
  decideIdleCheck,
  nextIdleCheckDelayMs,
} from "./pomodoro-machine";
import { nowIso } from "./pomodoro-backend-writes";
import type { PomodoroRunRepository } from "./pomodoro-run-repository";
import type { PomodoroSegmentController } from "./pomodoro-segment-controller";
import type { IdlePauseState } from "./pomodoro-window-sync";

interface IdleStatus {
  idle_ms: number;
  webcam_in_use: boolean;
}

interface PomodoroIdleContext {
  phase: PomodoroPhase;
  isRunning: boolean;
  suspendedAway: { awaySeconds: number } | null;
  idlePaused: IdlePauseState | null;
  idleTimeoutMs: number | null;
  phaseEndTime: number | null;
  activeBlockEndMs: number | null;
  activeBlockId: string | null;
  dismissedBlockId: string | null;
  activeRunId: string | null;
  config: PomodoroConfig;
  currentRhythmPosition: number;
  remainingSeconds: number;
  segments: PersistedSegment[];
  currentSegmentIndex: number;
  completedPomodoros: number;
  sessionStartTime: string | null;
  skipNextBreak: boolean;
  lastTickMs: number | null;
  intervalId: ReturnType<typeof setInterval> | null;
  tick(): void;
  activeBlockDeadlineReached(): boolean;
  expirePausedBlockAtDeadlineAndWait(): Promise<void>;
  stopPausedOpportunityCountdown(): void;
  closePomodoroOverlay(): void;
  clearMusicPausedByPomodoro(): void;
  stopOvertime(): void;
  resetFocusNotificationState(): void;
  resetPhaseProgress(defaultRemainingSeconds: number): void;
  setPhaseRemainingSeconds(
    nextWorkRemainingSeconds: number,
    elapsedSeconds?: number,
    nowMs?: number,
  ): number;
  setVisibleRemainingForPause(
    nextVisibleRemainingSeconds: number,
    elapsedSeconds: number,
    nowMs?: number,
  ): number;
  actualPhaseElapsedSeconds(): number;
  closeActiveRun(
    endedAt: string,
    endReason: "completed" | "stopped" | "interrupted" | "reconfigured" | "block_transition",
    segmentStatus: "completed" | "interrupted",
    segmentEndReason: "completed" | "stopped" | "skipped_by_user" | "event_expired" | "focus_failed" | "reconfigured" | "block_transition" | "crash_recovery",
    eventType: "start" | "phase_start" | "phase_complete" | "pause_start" | "pause_end" | "idle_detected" | "focus_failed" | "suspend_detected" | "skip_break" | "extend_focus" | "go_to_break_now" | "start_focus_now" | "reconfigure" | "block_transition" | "stop" | "complete" | "crash_recovery",
  ): Promise<void>;
  updateTray(): void;
}

export interface PomodoroIdleController {
  startChecking(): void;
  stopChecking(): void;
  setActiveThresholdMinutes(minutes: number): void;
  setActiveTimeoutMs(nextIdleMs: number | null): void;
  markFocusFailed(failedAtMs?: number | null): Promise<void>;
  dismiss(resume: boolean): Promise<void>;
}

export function createPomodoroIdleController(
  context: PomodoroIdleContext,
  repository: PomodoroRunRepository,
  segments: PomodoroSegmentController,
  defaultFocusSeconds: number,
): PomodoroIdleController {
  let idleCheckTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let idleCheckGeneration = 0;

  function startChecking(): void {
    stopChecking();
    if (!shouldRunChecks()) return;
    scheduleCheck(0, idleCheckGeneration);
  }

  function setActiveThresholdMinutes(minutes: number): void {
    if (!Number.isFinite(minutes) || minutes <= 0 || context.idleTimeoutMs === null) return;
    const nextIdleMs = Math.round(minutes) * 60_000;
    setActiveTimeoutMs(nextIdleMs);
  }

  function setActiveTimeoutMs(nextIdleMs: number | null): void {
    if (context.idleTimeoutMs === nextIdleMs) return;
    context.idleTimeoutMs = nextIdleMs;
    if (nextIdleMs === null) {
      stopChecking();
    } else {
      startChecking();
    }
    context.updateTray();
  }

  function stopChecking(): void {
    idleCheckGeneration += 1;
    if (idleCheckTimeoutId !== null) {
      clearTimeout(idleCheckTimeoutId);
      idleCheckTimeoutId = null;
    }
  }

  function shouldRunChecks(): boolean {
    return (
      context.isRunning &&
      context.phase === "focus" &&
      context.suspendedAway === null &&
      context.idlePaused === null &&
      context.idleTimeoutMs !== null
    );
  }

  function scheduleCheck(delayMs: number, generation: number): void {
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
    const segment = segments.activeSegment();
    const lastPause = segment?.pauseLog[segment.pauseLog.length - 1];
    return lastPause?.startedAt ?? new Date(state.idleStartMs).toISOString();
  }

  async function markFocusFailed(failedAtMs: number | null = null): Promise<void> {
    const state = context.idlePaused;
    if (!state || state.focusFailed) return;
    const normalizedFailedAtMs = failedAtMs ?? idleFocusFailedAtMs(state);
    context.idlePaused = {
      ...state,
      focusFailed: true,
      focusFailedAtMs: normalizedFailedAtMs,
    };
    context.stopPausedOpportunityCountdown();
    stopChecking();

    const segment = segments.activeSegment();
    if (segment && segment.status === "active" && context.currentSegmentIndex >= 0) {
      const endIso = failedIdleSegmentEndIso(state);
      await segments.markSegment(context.currentSegmentIndex, "interrupted", true, endIso, "focus_failed");
    }

    if (context.activeRunId) {
      repository.recordRunEvent({
        runId: context.activeRunId,
        segmentId: segment?.id ?? null,
        eventType: "focus_failed",
        occurredAt: new Date(normalizedFailedAtMs).toISOString(),
        phase: "focus",
        reason: "long_idle",
        durationSeconds: IDLE_FOCUS_FAILURE_DELAY_SECONDS,
      }, "Failed to record focus failure:");
    }
    context.updateTray();
  }

  async function restartFocusAfterFailedIdle(): Promise<void> {
    if (!context.idlePaused) return;

    if (context.activeBlockDeadlineReached()) {
      context.idlePaused = null;
      await context.expirePausedBlockAtDeadlineAndWait();
      return;
    }

    const blockId = context.activeBlockId;
    const runId = context.activeRunId;
    const eventDate = segments.activeSegment()?.eventDate ?? (blockId ? segments.eventDateFromBlockId(blockId) : null);
    if (!blockId || !runId || !eventDate || context.activeBlockEndMs === null) {
      await dismiss(false);
      return;
    }

    context.clearMusicPausedByPomodoro();
    context.stopPausedOpportunityCountdown();
    context.stopOvertime();
    context.phase = "focus";
    context.resetFocusNotificationState();
    const nowMs = Date.now();
    const remaining = context.setPhaseRemainingSeconds(
      focusDurationMinutesAtPosition(context.config, context.currentRhythmPosition) * TIME_MULTIPLIER,
      0,
      nowMs,
    );
    if (remaining <= 0) {
      context.idlePaused = null;
      await context.expirePausedBlockAtDeadlineAndWait();
      return;
    }

    const now = new Date(nowMs).toISOString();
    const phaseEndMs = nowMs + remaining * 1000;
    const newSegment: PersistedSegment = {
      id: crypto.randomUUID(),
      eventId: blockId,
      eventDate,
      runId,
      rhythmPosition: context.currentRhythmPosition,
      phase: "focus",
      plannedStart: now,
      plannedEnd: new Date(phaseEndMs).toISOString(),
      actualStart: now,
      actualEnd: null,
      pauseLog: [],
      status: "active",
    };
    const kept = context.segments.filter(
      (segment, index) =>
        index <= context.currentSegmentIndex &&
        (segment.status === "completed" || segment.status === "interrupted"),
    );
    const previousPhase = context.phase;
    context.phase = "focus";
    const afterMinutes = Math.max(0, (context.activeBlockEndMs - phaseEndMs) / 60000);
    const futureSegments = segments.plannedSegmentsAfterCurrentPhase(
      blockId,
      eventDate,
      runId,
      newSegment.plannedEnd,
      afterMinutes,
    );
    context.phase = previousPhase;

    context.segments = [...kept, newSegment, ...futureSegments];
    context.currentSegmentIndex = kept.length;
    context.idlePaused = null;
    context.isRunning = true;
    context.phaseEndTime = phaseEndMs;
    context.sessionStartTime = now;
    context.lastTickMs = nowMs;
    if (context.intervalId) clearInterval(context.intervalId);
    context.intervalId = setInterval(context.tick, 1000);
    startChecking();
    await repository.insertSegments([newSegment]);
    context.updateTray();
  }

  async function checkIdle(generation: number = idleCheckGeneration): Promise<void> {
    if (generation !== idleCheckGeneration || !shouldRunChecks()) return;
    let nextDelayMs = IDLE_CHECK_MAX_INTERVAL_MS;
    try {
      const status = await invoke<IdleStatus>("get_idle_status");
      if (generation !== idleCheckGeneration || !shouldRunChecks()) return;
      const nowMs = Date.now();
      const currentIdleTimeoutMs = context.idleTimeoutMs;
      if (currentIdleTimeoutMs === null) return;
      nextDelayMs = nextIdleCheckDelayMs({
        idleTimeoutMs: currentIdleTimeoutMs,
        idleMs: status.idle_ms,
        webcamInUse: status.webcam_in_use,
      });

      const result = decideIdleCheck(
        {
          isRunning: context.isRunning,
          phase: context.phase,
          suspendedAway: context.suspendedAway !== null,
          idlePaused: context.idlePaused !== null,
          idleTimeoutMs: currentIdleTimeoutMs,
          webcamInUse: status.webcam_in_use,
          idleMs: status.idle_ms,
          phaseEndTime: context.phaseEndTime,
        },
        nowMs,
      );

      if (result.kind === "skip") return;

      const idleStartIso = new Date(result.idleStartMs).toISOString();

      if (context.currentSegmentIndex >= 0 && context.currentSegmentIndex < context.segments.length) {
        const segment = context.segments[context.currentSegmentIndex];
        segments.appendPause(segment, idleStartIso, "idle");
        repository.persistSegment(segment, "Failed to save idle pause:", false);
      }

      const elapsedAtIdleStart = Math.max(
        0,
        context.actualPhaseElapsedSeconds() - result.idleSeconds,
      );
      context.setVisibleRemainingForPause(
        result.preSuspendRemainingSeconds,
        elapsedAtIdleStart,
        result.idleStartMs,
      );
      context.phaseEndTime = null;

      if (context.intervalId) {
        clearInterval(context.intervalId);
        context.intervalId = null;
      }
      context.isRunning = false;
      context.lastTickMs = null;

      const overlayStartedAtMs = Date.now();
      context.idlePaused = {
        idleSeconds: result.idleSeconds,
        nativeOverlay: true,
        idleStartMs: result.idleStartMs,
        overlayStartedAtMs,
        focusFailed: false,
        focusFailedAtMs: null,
      };
      context.updateTray();

      let nativeOverlay = false;
      try {
        nativeOverlay = await invoke<boolean>("show_idle_overlay", {
          idleSeconds: result.idleSeconds,
        });
      } catch (e) {
        console.warn("Failed to show idle overlay:", e);
      }
      if (
        context.idlePaused?.idleStartMs === result.idleStartMs &&
        context.idlePaused.overlayStartedAtMs === overlayStartedAtMs &&
        context.idlePaused.nativeOverlay !== nativeOverlay
      ) {
        context.idlePaused = {
          ...context.idlePaused,
          nativeOverlay,
        };
        context.updateTray();
      }
    } catch (e) {
      console.warn("Idle check failed:", e);
    } finally {
      if (generation === idleCheckGeneration && shouldRunChecks()) {
        scheduleCheck(nextDelayMs, generation);
      }
    }
  }

  async function dismiss(resume: boolean): Promise<void> {
    context.closePomodoroOverlay();
    context.stopPausedOpportunityCountdown();
    const state = context.idlePaused;
    if (resume) {
      if (state?.focusFailed) {
        await restartFocusAfterFailedIdle();
        return;
      }
      if (context.currentSegmentIndex >= 0 && context.currentSegmentIndex < context.segments.length) {
        const segment = context.segments[context.currentSegmentIndex];
        if (segments.closeLastPause(segment, nowIso())) {
          await repository.persistSegment(segment, "Failed to close idle pause:", false);
        }
      }
      context.idlePaused = null;
      context.activeBlockEndMs = null;
      context.isRunning = true;
      context.phaseEndTime = Date.now() + context.remainingSeconds * 1000;
      context.lastTickMs = Date.now();
      context.intervalId = setInterval(context.tick, 1000);
      context.updateTray();
    } else {
      const segment = segments.activeSegment();
      const lastPause = segment?.pauseLog[segment.pauseLog.length - 1];
      const endIso = lastPause ? lastPause.startedAt : nowIso();
      if (context.currentSegmentIndex >= 0 && context.currentSegmentIndex < context.segments.length) {
        if (context.segments[context.currentSegmentIndex].status === "active") {
          await segments.markSegment(context.currentSegmentIndex, "interrupted", true, endIso, "stopped");
        }
        await segments.skipPlannedSegmentsAfter(context.currentSegmentIndex, "Failed to skip segment:");
      }
      await context.closeActiveRun(endIso, "stopped", "interrupted", "stopped", "stop");
      context.idlePaused = null;
      context.stopOvertime();
      context.isRunning = false;
      context.phaseEndTime = null;
      context.dismissedBlockId = context.activeBlockId;
      context.activeBlockId = null;
      context.activeBlockEndMs = null;
      context.lastTickMs = null;
      context.phase = "focus";
      context.resetPhaseProgress(defaultFocusSeconds);
      context.currentRhythmPosition = 1;
      context.completedPomodoros = 0;
      context.sessionStartTime = null;
      context.skipNextBreak = false;
      context.resetFocusNotificationState();
      stopChecking();
      segments.clearSegments();
      context.updateTray();
    }
  }

  return {
    startChecking,
    stopChecking,
    setActiveThresholdMinutes,
    setActiveTimeoutMs,
    markFocusFailed,
    dismiss,
  };
}
