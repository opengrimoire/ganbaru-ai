import type { PomodoroPhase } from "@ganbaruai/shared-types";
import type { PauseInterval, PersistedSegment, SegmentPhase } from "$lib/components/calendar/types";
import { dbUrl } from "$lib/api/db";
import { computePlannedSegments } from "$lib/utils/pomodoro-segments";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  type PomodoroConfig,
  type TimerSnapshot,
  DEFAULT_CONFIG,
  TIME_MULTIPLIER,
  NOTIFICATION_THRESHOLD,
  MAX_BREAK_OVERTIME_SECONDS,
  decideTick,
  decideAdvancePhase,
  decideTransition,
  decideStartFromBlock,
  decideReconfigure,
  decideIdleCheck,
} from "./pomodoro-machine";

let phase = $state<PomodoroPhase>("focus");
let remainingSeconds = $state(DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER);
let currentCycle = $state(1);
let totalCycles = $state(DEFAULT_CONFIG.cyclesBeforeLongBreak);
let isRunning = $state(false);
let config = $state<PomodoroConfig>({ ...DEFAULT_CONFIG });
let intervalId: ReturnType<typeof setInterval> | null = null;
let completedPomodoros = $state(0);
let sessionStartTime: string | null = null;
let skipNextBreak = false;
let listenersInitialized = false;
let notificationShown = false;
let phaseEndTime: number | null = null;
let activeBlockId: string | null = null;
let activeBlockEndMs: number | null = null;
let dismissedBlockId: string | null = null;

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
    if (bumpSegmentVersion) segmentVersion++;
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

function markSegment(index: number, status: PersistedSegment["status"], setActualEnd: boolean = false) {
  if (index < 0 || index >= segments.length) return;
  const seg = segments[index];
  seg.status = status;
  if (setActualEnd) seg.actualEnd = nowIso();

  // Close any open pause interval
  const lastPause = seg.pauseLog[seg.pauseLog.length - 1];
  if (lastPause && lastPause[1] === null) {
    lastPause[1] = seg.actualEnd ?? nowIso();
    seg.pauseLog = [...seg.pauseLog];
  }

  persistSegmentToBackend(seg, "Failed to update segment:", true);
}

function activateSegment(index: number) {
  if (index < 0 || index >= segments.length) return;
  const seg = segments[index];
  seg.status = "active";
  seg.actualStart = nowIso();
  currentSegmentIndex = index;

  persistSegmentToBackend(seg, "Failed to activate segment:", false);
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
  activeBlockEndMs = new Date(eventEnd.replace(" ", "T")).getTime();

  const result = decideReconfigure({
    phase,
    remainingSeconds,
    currentConfig: config,
    newConfig,
    hasOvertimeInterval: overtimeIntervalId !== null,
  });

  config = newConfig;
  totalCycles = config.cyclesBeforeLongBreak;
  remainingSeconds = result.newRemainingSeconds;

  if (isRunning) {
    phaseEndTime = Date.now() + remainingSeconds * 1000;
  } else if (result.exitOvertime) {
    stopOvertime();
    isRunning = true;
    phaseEndTime = Date.now() + remainingSeconds * 1000;
    intervalId = setInterval(tick, 1000);
    lastTickMs = Date.now();
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
  const previousConfig = config;
  activeBlockId = blockId;
  activeBlockEndMs = new Date(eventEnd.replace(" ", "T")).getTime();
  initListeners();

  const result = decideTransition({
    previousConfig,
    newConfig,
    phase,
    remainingSeconds,
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
      remainingSeconds = result.breakDurationSeconds;
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
      remainingSeconds = result.remainingSeconds;
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
      remainingSeconds = result.remainingSeconds;
      currentCycle = 1;
      completedPomodoros = 0;
      notificationShown = false;
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
  const totalSeconds =
    phase === "focus"
      ? config.focusMinutes * TIME_MULTIPLIER
      : phase === "short_break"
        ? config.shortBreakMinutes * TIME_MULTIPLIER
        : config.longBreakMinutes * TIME_MULTIPLIER;

  invoke("update_tray", {
    phase,
    remainingSeconds,
    totalSeconds,
    isRunning,
  }).catch(() => {});
}

// Listeners

function initListeners() {
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
      isRunning = false;
      phaseEndTime = null;
      lastTickMs = null;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    } else {
      isRunning = true;
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      if (phase === "focus" && !sessionStartTime) {
        sessionStartTime = new Date().toISOString();
      }
      intervalId = setInterval(tick, 1000);
    lastTickMs = Date.now();
    }
    updateTray();
  }).catch((e) => console.warn("Failed to listen for tray-pause-resume:", e));

  listen("tray-skip", () => {
    if (suspendedAway || idlePaused) return;
    advancePhase();
    updateTray();
  }).catch((e) => console.warn("Failed to listen for tray-skip:", e));

  listen<{ seconds: number }>("pomodoro-add-time", (event) => {
    remainingSeconds += event.payload.seconds;
    if (phaseEndTime !== null) {
      phaseEndTime += event.payload.seconds * 1000;
    }
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
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  stopOvertime();
  phase = "focus";
  remainingSeconds = config.focusMinutes * TIME_MULTIPLIER;
  notificationShown = false;
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
    remainingSeconds = DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER;
    currentCycle = 1;
    completedPomodoros = 0;
    sessionStartTime = null;
    skipNextBreak = false;
    notificationShown = false;
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

    remainingSeconds = result.preSuspendRemainingSeconds;
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
    remainingSeconds = DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER;
    currentCycle = 1;
    completedPomodoros = 0;
    sessionStartTime = null;
    skipNextBreak = false;
    notificationShown = false;
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
      remainingSeconds = result.preSuspendRemainingSeconds;
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
      remainingSeconds = result.preSuspendRemainingSeconds;
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
      remainingSeconds = 0;
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
      isRunning = false;
      breakOvertimeSeconds = 0;
      if (!overtimeIntervalId) {
        overtimeIntervalId = setInterval(() => {
          breakOvertimeSeconds += 1;
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
      advancePhase();
      return;
    }

    case "countdown_with_notification": {
      lastTickMs = now;
      remainingSeconds = result.remainingSeconds;
      showNotification();
      updateTray();
      return;
    }

    case "countdown": {
      lastTickMs = now;
      remainingSeconds = result.remainingSeconds;
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
      remainingSeconds = result.remainingSeconds;
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
      remainingSeconds = result.remainingSeconds;
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
      remainingSeconds = result.remainingSeconds;
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
      remainingSeconds = result.remainingSeconds;
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
}

// Public API

export function getPomodoro() {
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
    get completedPomodoros() {
      return completedPomodoros;
    },
    get totalSecondsForPhase() {
      if (phase === "focus") return config.focusMinutes * TIME_MULTIPLIER;
      if (phase === "short_break")
        return config.shortBreakMinutes * TIME_MULTIPLIER;
      return config.longBreakMinutes * TIME_MULTIPLIER;
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
      dismissedBlockId = id;
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
      blockExpired = false;
    },
    /** Transfer session to a new block ID without resetting state (after detachInstance creates a standalone). */
    transferBlockId(newBlockId: string, newEndTime?: string) {
      if (!activeBlockId) return;
      activeBlockId = newBlockId;
      if (newEndTime) {
        activeBlockEndMs = new Date(newEndTime.replace(" ", "T")).getTime();
      }
      for (const seg of segments) {
        seg.eventId = newBlockId;
      }
    },
    get suspendedAway() {
      return suspendedAway;
    },
    dismissSuspend(resume: boolean) {
      dismissSuspend(resume);
    },
    get idlePaused() {
      return idlePaused;
    },
    dismissIdle(resume: boolean) {
      dismissIdle(resume);
    },
    startFromBlock(
      blockId: string,
      blockConfig: Partial<PomodoroConfig>,
      eventEnd?: string,
      eventDate?: string,
      blockIdleTimeoutMinutes?: number | null,
    ) {
      const newConfig = { ...DEFAULT_CONFIG, ...blockConfig };

      // Always update idle timeout from the latest block config
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
          return;

        case "reconfigure":
          reconfigureSession(blockId, decision.newConfig, eventEnd!, eventDate!);
          return;

        case "rebuild_segments":
          activeBlockEndMs = decision.newEndMs;
          rebuildSegments(blockId, eventEnd!, eventDate!);
          return;

        case "transition":
          transitionToBlock(blockId, decision.newConfig, eventEnd!, eventDate!);
          return;

        case "new_session": {
          initListeners();
          if (intervalId) { clearInterval(intervalId); intervalId = null; }

          activeBlockId = blockId;
          activeBlockEndMs = decision.newEndMs;
          config = decision.newConfig;
          totalCycles = config.cyclesBeforeLongBreak;
          phase = "focus";
          remainingSeconds = config.focusMinutes * TIME_MULTIPLIER;
          currentCycle = 1;
          completedPomodoros = 0;
          skipNextBreak = false;
          notificationShown = false;

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
    },
    stopSession() {
      // Mark current segment as interrupted, remaining as skipped
      if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
        markSegment(currentSegmentIndex, "interrupted", true);
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
      remainingSeconds = DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER;
      currentCycle = 1;
      completedPomodoros = 0;
      sessionStartTime = null;
      skipNextBreak = false;
      notificationShown = false;
      clearSegments();
      updateTray();
    },
    pause() {
      isRunning = false;
      phaseEndTime = null;
      lastTickMs = null;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      stopIdleChecking();
      // Record pause start on current segment
      if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
        const seg = segments[currentSegmentIndex];
        const now = nowIso();
        seg.pauseLog = [...seg.pauseLog, [now, null]];
        persistSegmentToBackend(seg, "Failed to save pause:", false);
      }
      updateTray();
    },
    start() {
      if (isRunning) return;
      initListeners();
      isRunning = true;
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      if (!sessionStartTime) {
        sessionStartTime = new Date().toISOString();
      }
      // Record resume on current segment's open pause interval
      if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
        const seg = segments[currentSegmentIndex];
        const lastPause = seg.pauseLog[seg.pauseLog.length - 1];
        if (lastPause && lastPause[1] === null) {
          lastPause[1] = nowIso();
          seg.pauseLog = [...seg.pauseLog]; // trigger reactivity
          persistSegmentToBackend(seg, "Failed to save resume:", false);
        }
      }
      intervalId = setInterval(tick, 1000);
      lastTickMs = Date.now();
      startIdleChecking();
      updateTray();
    },
    skip() {
      advancePhase();
      updateTray();
    },
    /** Clean up orphaned segments from previous app sessions. Call once on startup. */
    async cleanupOrphans() {
      await invoke("pomodoro_cleanup_orphans", {
        dbUrl: dbUrl(),
      }).then(() => {
        segmentVersion++;
      }).catch((e) => console.warn("Failed to clean up orphaned segments:", e));
    },
  };
}
