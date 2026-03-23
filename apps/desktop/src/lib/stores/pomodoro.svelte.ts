import type { PomodoroPhase } from "@ganbaruai/shared-types";
import type { PersistedSegment, SegmentPhase } from "$lib/components/calendar/types";
import { execute } from "$lib/api/db";
import { calculateActivityXp } from "$lib/utils/xp";
import { computePlannedSegments } from "$lib/utils/pomodoro-segments";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface PomodoroConfig {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
}

const DEFAULT_CONFIG: PomodoroConfig = {
  focusMinutes: 40,
  shortBreakMinutes: 5,
  longBreakMinutes: 10,
  cyclesBeforeLongBreak: 4,
};

const TIME_MULTIPLIER = 60;

let phase = $state<PomodoroPhase>("focus");
let remainingSeconds = $state(DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER);
let currentCycle = $state(1);
let totalCycles = $state(DEFAULT_CONFIG.cyclesBeforeLongBreak);
let isRunning = $state(false);
let config = $state<PomodoroConfig>({ ...DEFAULT_CONFIG });
let intervalId: ReturnType<typeof setInterval> | null = null;
let completedPomodoros = $state(0);
let sessionStartTime: string | null = null;
let lastXp = $state<number | null>(null);
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
let activeRunId: string | null = null;

// Tracks seconds elapsed after a break timer reaches 0 but before user acknowledgment.
// Reactive ($state) so the accent bar derived recomputes and bands keep shifting.
let breakOvertimeSeconds = $state(0);
let overtimeIntervalId: ReturnType<typeof setInterval> | null = null;

const NOTIFICATION_THRESHOLD = 60;

// Suspend/wake detection
let lastTickMs: number | null = null;
const SUSPEND_THRESHOLD_MS = 5000;
let suspendedAway = $state<{ awaySeconds: number } | null>(null);

// Idle detection
let idleTimeoutMs: number | null = null; // null = disabled
let idleCheckIntervalId: ReturnType<typeof setInterval> | null = null;
let idlePaused = $state<{ idleSeconds: number; nativeOverlay: boolean } | null>(null);

// --- Config helpers ---

function configEquals(a: PomodoroConfig, b: PomodoroConfig): boolean {
  return a.focusMinutes === b.focusMinutes &&
    a.shortBreakMinutes === b.shortBreakMinutes &&
    a.longBreakMinutes === b.longBreakMinutes &&
    a.cyclesBeforeLongBreak === b.cyclesBeforeLongBreak;
}

// --- Segment helpers ---

function nowIso(): string {
  return new Date().toISOString();
}

function addMinutesToIso(base: string, minutes: number): string {
  const d = new Date(base);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
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

  execute(
    `UPDATE pomodoro_segments SET status = $1, actual_start = $2, actual_end = $3, pause_log = $4 WHERE id = $5`,
    [seg.status, seg.actualStart, seg.actualEnd, JSON.stringify(seg.pauseLog), seg.id],
  ).catch((e) => console.warn("Failed to update segment:", e));
}

function activateSegment(index: number) {
  if (index < 0 || index >= segments.length) return;
  const seg = segments[index];
  seg.status = "active";
  seg.actualStart = nowIso();
  currentSegmentIndex = index;

  execute(
    `UPDATE pomodoro_segments SET status = 'active', actual_start = $1 WHERE id = $2`,
    [seg.actualStart, seg.id],
  ).catch((e) => console.warn("Failed to activate segment:", e));
}

async function createSegments(eventId: string, eventEnd: string, eventDate: string) {
  // Clean up any orphaned segments from a previous session on this event
  // (e.g. app closed while running/paused)
  await execute(
    `UPDATE pomodoro_segments
     SET status = 'interrupted',
         actual_end = COALESCE(actual_end, actual_start, datetime('now')),
         pause_log = CASE
           WHEN pause_log IS NOT NULL AND pause_log LIKE '%null]%'
           THEN REPLACE(pause_log, 'null]', '"' || datetime('now') || 'Z"]')
           ELSE pause_log
         END
     WHERE event_id = $1 AND status = 'active'`,
    [eventId],
  ).catch((e) => console.warn("Failed to clean up orphaned active segments:", e));

  await execute(
    `UPDATE pomodoro_segments SET status = 'skipped' WHERE event_id = $1 AND status = 'planned'`,
    [eventId],
  ).catch((e) => console.warn("Failed to clean up orphaned planned segments:", e));

  const runId = crypto.randomUUID();
  activeRunId = runId;

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

  // Batch insert
  for (const seg of newSegments) {
    await execute(
      `INSERT INTO pomodoro_segments
        (id, event_id, event_date, run_id, cycle_number, phase, planned_start, planned_end, actual_start, actual_end, pause_log, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [seg.id, seg.eventId, seg.eventDate, seg.runId, seg.cycleNumber, seg.phase, seg.plannedStart, seg.plannedEnd, seg.actualStart, seg.actualEnd, "[]", seg.status],
    ).catch((e) => console.warn("Failed to insert segment:", e));
  }

  segments = newSegments;
  currentSegmentIndex = 0;
}

function clearSegments() {
  segments = [];
  currentSegmentIndex = -1;
  activeRunId = null;
}

/**
 * Marks old segments as completed/skipped, builds a new segment plan
 * (bridge for current phase remainder + future segments), and persists.
 * Used by both reconfigureSession and transitionToBlock.
 */
async function rebuildSegments(blockId: string, eventEnd: string, eventDate: string) {
  // Clean up old segments: mark current as completed, remaining planned as skipped
  if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
    markSegment(currentSegmentIndex, "completed", true);
  }
  for (let i = currentSegmentIndex + 1; i < segments.length; i++) {
    if (segments[i].status === "planned") {
      segments[i].status = "skipped";
      execute(
        `UPDATE pomodoro_segments SET status = 'skipped' WHERE id = $1`,
        [segments[i].id],
      ).catch((e) => console.warn("Failed to skip segment:", e));
    }
  }

  // Build new segment plan from now to event end
  const runId = crypto.randomUUID();
  activeRunId = runId;
  const now = new Date();
  const nowStr = now.toISOString();
  const end = new Date(eventEnd.replace(" ", "T"));
  const totalRemainingMinutes = Math.max(0, (end.getTime() - now.getTime()) / 60000);
  const bridgeMinutes = remainingSeconds / 60;
  const currentPhaseType: SegmentPhase = phase === "focus" ? "focus"
    : phase === "short_break" ? "short_break" : "long_break";

  const newSegments: PersistedSegment[] = [];

  // Bridge segment: remainder of current phase
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
      pauseLog: [],
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

  // Persist new segments
  for (const seg of newSegments) {
    await execute(
      `INSERT INTO pomodoro_segments
        (id, event_id, event_date, run_id, cycle_number, phase, planned_start, planned_end, actual_start, actual_end, pause_log, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [seg.id, seg.eventId, seg.eventDate, seg.runId, seg.cycleNumber, seg.phase, seg.plannedStart, seg.plannedEnd, seg.actualStart, seg.actualEnd, JSON.stringify(seg.pauseLog), seg.status],
    ).catch((e) => console.warn("Failed to insert segment:", e));
  }

  segments = newSegments;
  currentSegmentIndex = bridgeMinutes > 0 ? 0 : -1;
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

  // Compute elapsed time in current phase using old config durations
  const oldPhaseDurationSec = phase === "focus"
    ? config.focusMinutes * TIME_MULTIPLIER
    : phase === "short_break"
      ? config.shortBreakMinutes * TIME_MULTIPLIER
      : config.longBreakMinutes * TIME_MULTIPLIER;
  const elapsedSeconds = Math.max(0, oldPhaseDurationSec - remainingSeconds);

  // Apply new config
  config = newConfig;
  totalCycles = config.cyclesBeforeLongBreak;

  // Adjust remaining time for current phase with new durations
  const newPhaseDurationSec = phase === "focus"
    ? config.focusMinutes * TIME_MULTIPLIER
    : phase === "short_break"
      ? config.shortBreakMinutes * TIME_MULTIPLIER
      : config.longBreakMinutes * TIME_MULTIPLIER;
  remainingSeconds = Math.max(0, newPhaseDurationSec - elapsedSeconds);

  // Adjust timer state
  if (isRunning) {
    phaseEndTime = Date.now() + remainingSeconds * 1000;
  } else if (overtimeIntervalId && remainingSeconds > 0) {
    stopOvertime();
    isRunning = true;
    phaseEndTime = Date.now() + remainingSeconds * 1000;
    intervalId = setInterval(tick, 1000);
    lastTickMs = Date.now();
  }

  // Reset notification if remaining time increased past threshold
  if (phase === "focus" && remainingSeconds > NOTIFICATION_THRESHOLD) {
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
  activeBlockId = blockId;
  activeBlockEndMs = new Date(eventEnd.replace(" ", "T")).getTime();
  initListeners();

  const previousConfig = config;
  config = newConfig;
  totalCycles = config.cyclesBeforeLongBreak;

  if (phase === "focus") {
    // Compute accumulated focus time (seconds of focus consumed in current phase)
    const oldFocusSec = previousConfig.focusMinutes * TIME_MULTIPLIER;
    const accumulatedFocusSec = Math.max(0, oldFocusSec - remainingSeconds);
    const newFocusThresholdSec = config.focusMinutes * TIME_MULTIPLIER;

    if (accumulatedFocusSec >= newFocusThresholdSec) {
      // Already exceeded the new config's focus threshold: trigger break.
      // Save the completed focus session first.
      const endTime = new Date().toISOString();
      if (sessionStartTime) {
        saveCompletedSession(sessionStartTime, endTime);
      }
      completedPomodoros += 1;
      sessionStartTime = null;
      notificationShown = false;

      // Determine break type from cycle state
      const isLong = currentCycle >= totalCycles;
      phase = isLong ? "long_break" : "short_break";
      remainingSeconds = isLong
        ? config.longBreakMinutes * TIME_MULTIPLIER
        : config.shortBreakMinutes * TIME_MULTIPLIER;
      if (isLong) {
        currentCycle = 1;
      } else {
        currentCycle += 1;
      }

      phaseEndTime = Date.now() + remainingSeconds * 1000;
      if (!isRunning) {
        isRunning = true;
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(tick, 1000);
    lastTickMs = Date.now();
      } else {
        // Timer already running, just update end time
        phaseEndTime = Date.now() + remainingSeconds * 1000;
      }

      showBreakOverlay(remainingSeconds);
    } else {
      // Continue focus with inherited time: remainingSeconds = threshold - accumulated
      remainingSeconds = newFocusThresholdSec - accumulatedFocusSec;

      if (isRunning) {
        phaseEndTime = Date.now() + remainingSeconds * 1000;
      }

      // Reset notification if remaining went above threshold
      if (remainingSeconds > NOTIFICATION_THRESHOLD) {
        notificationShown = false;
      }
    }
  }
  // For break phases (short_break, long_break): keep the current break running as-is.
  // The break duration doesn't change (user already earned it). After the break,
  // startFocusSession will use the new config for the next focus.

  await rebuildSegments(blockId, eventEnd, eventDate);
  updateTray();
}

// --- Tray ---

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

// --- Listeners ---

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

// --- Session control ---

function stopOvertime() {
  if (overtimeIntervalId) {
    clearInterval(overtimeIntervalId);
    overtimeIntervalId = null;
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
      saveCompletedSession(sessionStartTime, endIso);
    }
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      markSegment(currentSegmentIndex, "interrupted", true);
      for (let i = currentSegmentIndex + 1; i < segments.length; i++) {
        if (segments[i].status === "planned") {
          segments[i].status = "skipped";
          execute(
            `UPDATE pomodoro_segments SET status = 'skipped' WHERE id = $1`,
            [segments[i].id],
          ).catch((e) => console.warn("Failed to skip segment:", e));
        }
      }
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

// --- Idle detection ---

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
  // Only check during active focus (not paused, not during break, not already idle/suspended)
  if (!isRunning || phase !== "focus" || suspendedAway || idlePaused) return;
  if (idleTimeoutMs === null) return;

  try {
    const status = await invoke<IdleStatus>("get_idle_status");

    // If webcam is in use (video meeting), skip idle detection
    if (status.webcam_in_use) return;

    // If idle time exceeds threshold, pause the timer
    if (status.idle_ms >= idleTimeoutMs) {
      const idleSeconds = Math.round(status.idle_ms / 1000);
      const idleStartMs = Date.now() - status.idle_ms;
      const idleStartIso = new Date(idleStartMs).toISOString();
      const nowIsoStr = new Date().toISOString();

      // Record synthetic pause on current segment
      if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
        const seg = segments[currentSegmentIndex];
        seg.pauseLog = [...seg.pauseLog, [idleStartIso, null]]; // open-ended pause
        execute(
          `UPDATE pomodoro_segments SET pause_log = $1 WHERE id = $2`,
          [JSON.stringify(seg.pauseLog), seg.id],
        ).catch((e) => console.warn("Failed to save idle pause:", e));
      }

      // Re-anchor phaseEndTime to preserve remaining time from idle start
      if (phaseEndTime !== null) {
        const preSuspendRemaining = Math.max(0, Math.ceil((phaseEndTime - idleStartMs) / 1000));
        remainingSeconds = preSuspendRemaining;
        phaseEndTime = null;
      }

      // Pause the timer
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      isRunning = false;
      lastTickMs = null;

      // Show fullscreen idle overlay (GTK on Linux, returns false on other platforms)
      let nativeOverlay = false;
      try {
        nativeOverlay = await invoke<boolean>("show_idle_overlay", { idleSeconds });
      } catch (e) {
        console.warn("Failed to show idle overlay:", e);
      }

      idlePaused = { idleSeconds, nativeOverlay };
      updateTray();
    }
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
        execute(
          `UPDATE pomodoro_segments SET pause_log = $1 WHERE id = $2`,
          [JSON.stringify(seg.pauseLog), seg.id],
        ).catch((e) => console.warn("Failed to close idle pause:", e));
      }
    }
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
      saveCompletedSession(sessionStartTime, endIso);
    }
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      markSegment(currentSegmentIndex, "interrupted", true);
      for (let i = currentSegmentIndex + 1; i < segments.length; i++) {
        if (segments[i].status === "planned") {
          segments[i].status = "skipped";
          execute(
            `UPDATE pomodoro_segments SET status = 'skipped' WHERE id = $1`,
            [segments[i].id],
          ).catch((e) => console.warn("Failed to skip segment:", e));
        }
      }
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
): Promise<void> {
  const sessionId = crypto.randomUUID();
  const xpId = crypto.randomUUID();
  const xp = calculateActivityXp(config.focusMinutes);

  await execute(
    `INSERT INTO pomodoro_sessions (id, start_time, end_time, completed, focus_score, created_at)
     VALUES ($1, $2, $3, 1, 1.0, $4)`,
    [sessionId, startTime, endTime, endTime],
  );

  await execute(
    `INSERT INTO xp_entries
       (id, pomodoro_session_id, activity_xp, total_xp, streak_multiplier, timestamp)
     VALUES ($1, $2, $3, $4, 1.0, $5)`,
    [xpId, sessionId, xp, xp, endTime],
  );

  lastXp = xp;
}

// --- Timer ---

function tick() {
  const now = Date.now();

  // --- Suspend/wake detection ---
  if (lastTickMs !== null && (now - lastTickMs) > SUSPEND_THRESHOLD_MS) {
    const suspendStartIso = new Date(lastTickMs).toISOString();
    const suspendEndIso = new Date(now).toISOString();
    const awaySeconds = Math.round((now - lastTickMs) / 1000);

    // Record synthetic pause on current segment
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      const seg = segments[currentSegmentIndex];
      seg.pauseLog = [...seg.pauseLog, [suspendStartIso, suspendEndIso]];
      execute(
        `UPDATE pomodoro_segments SET pause_log = $1 WHERE id = $2`,
        [JSON.stringify(seg.pauseLog), seg.id],
      ).catch((e) => console.warn("Failed to save suspend pause:", e));
    }

    // Re-anchor phaseEndTime so remainingSeconds stays at pre-suspend value
    if (phaseEndTime !== null) {
      const preSuspendRemaining = Math.max(0, Math.ceil((phaseEndTime - lastTickMs) / 1000));
      remainingSeconds = preSuspendRemaining;
      phaseEndTime = now + preSuspendRemaining * 1000;
    }

    // Pause the timer
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    isRunning = false;
    lastTickMs = null;

    // If event also ended during suspend, auto-stop (no dialog)
    if (activeBlockEndMs !== null && now >= activeBlockEndMs) {
      if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
        markSegment(currentSegmentIndex, "completed", true);
        for (let i = currentSegmentIndex + 1; i < segments.length; i++) {
          if (segments[i].status === "planned") {
            segments[i].status = "skipped";
            execute(
              `UPDATE pomodoro_segments SET status = 'skipped' WHERE id = $1`,
              [segments[i].id],
            ).catch((e) => console.warn("Failed to skip segment:", e));
          }
        }
      }
      if (phase === "focus" && sessionStartTime) {
        saveCompletedSession(sessionStartTime, suspendStartIso);
        sessionStartTime = null;
      }
      stopOvertime();
      phaseEndTime = null;
      activeBlockId = null;
      activeBlockEndMs = null;
      phase = "focus";
      remainingSeconds = DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER;
      currentCycle = 1;
      completedPomodoros = 0;
      clearSegments();
      updateTray();
      return;
    }

    // Show resume dialog
    suspendedAway = { awaySeconds };
    updateTray();
    return;
  }

  lastTickMs = now;

  // Auto-stop if the calendar event has ended
  if (activeBlockEndMs !== null && now >= activeBlockEndMs) {
    if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
      markSegment(currentSegmentIndex, "completed", true);
      for (let i = currentSegmentIndex + 1; i < segments.length; i++) {
        if (segments[i].status === "planned") {
          segments[i].status = "skipped";
          execute(
            `UPDATE pomodoro_segments SET status = 'skipped' WHERE id = $1`,
            [segments[i].id],
          ).catch((e) => console.warn("Failed to skip segment:", e));
        }
      }
    }
    if (phase === "focus" && sessionStartTime) {
      saveCompletedSession(sessionStartTime, new Date(activeBlockEndMs).toISOString());
      sessionStartTime = null;
    }
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    stopOvertime();
    isRunning = false;
    lastTickMs = null;
    phaseEndTime = null;
    activeBlockId = null;
    activeBlockEndMs = null;
    phase = "focus";
    remainingSeconds = DEFAULT_CONFIG.focusMinutes * TIME_MULTIPLIER;
    currentCycle = 1;
    completedPomodoros = 0;
    clearSegments();
    updateTray();
    return;
  }

  if (phaseEndTime !== null) {
    remainingSeconds = Math.max(0, Math.ceil((phaseEndTime - now) / 1000));
  }

  if (remainingSeconds <= 0) {
    // During break, don't auto-advance - wait for user acknowledgment
    if (phase === "short_break" || phase === "long_break") {
      remainingSeconds = 0;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      isRunning = false;
      // Start overtime counter so accent bar bands keep updating
      breakOvertimeSeconds = 0;
      if (!overtimeIntervalId) {
        overtimeIntervalId = setInterval(() => {
          breakOvertimeSeconds += 1;
        }, 1000);
      }
      return;
    }
    advancePhase();
    return;
  }

  if (
    phase === "focus" &&
    remainingSeconds === NOTIFICATION_THRESHOLD &&
    !notificationShown
  ) {
    showNotification();
  }

  updateTray();
}

function advancePhase() {
  if (phase === "focus") {
    const endTime = new Date().toISOString();
    if (sessionStartTime) {
      saveCompletedSession(sessionStartTime, endTime);
    }
    completedPomodoros += 1;
    sessionStartTime = null;
    notificationShown = false;

    // Mark current focus segment as completed
    markSegment(currentSegmentIndex, "completed", true);

    if (skipNextBreak) {
      skipNextBreak = false;
      phase = "focus";
      remainingSeconds = config.focusMinutes * TIME_MULTIPLIER;
      phaseEndTime = Date.now() + remainingSeconds * 1000;

      // Mark the break segment as skipped, activate next focus
      const breakIdx = currentSegmentIndex + 1;
      if (breakIdx < segments.length && segments[breakIdx].phase !== "focus") {
        const now = nowIso();
        segments[breakIdx].status = "skipped";
        segments[breakIdx].actualStart = now;
        segments[breakIdx].actualEnd = now;
        execute(
          `UPDATE pomodoro_segments SET status = 'skipped', actual_start = $1, actual_end = $2 WHERE id = $3`,
          [now, now, segments[breakIdx].id],
        ).catch((e) => console.warn("Failed to skip segment:", e));

        const nextFocus = segments.findIndex(
          (s, i) => i > breakIdx && s.phase === "focus" && s.status === "planned",
        );
        if (nextFocus !== -1) {
          activateSegment(nextFocus);
        }
      }

      if (currentCycle < totalCycles) {
        currentCycle += 1;
      } else {
        currentCycle = 1;
      }
    } else if (currentCycle >= totalCycles) {
      phase = "long_break";
      remainingSeconds = config.longBreakMinutes * TIME_MULTIPLIER;
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      currentCycle = 1;

      // Activate the break segment
      const breakIdx = currentSegmentIndex + 1;
      if (breakIdx < segments.length && segments[breakIdx].phase === "long_break") {
        activateSegment(breakIdx);
      }

      showBreakOverlay(remainingSeconds);
    } else {
      phase = "short_break";
      remainingSeconds = config.shortBreakMinutes * TIME_MULTIPLIER;
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      currentCycle += 1;

      // Activate the break segment
      const breakIdx = currentSegmentIndex + 1;
      if (breakIdx < segments.length && segments[breakIdx].phase === "short_break") {
        activateSegment(breakIdx);
      }

      showBreakOverlay(remainingSeconds);
    }
  } else {
    // Transition from break to focus (via tray-skip)
    markSegment(currentSegmentIndex, "completed", true);
    phase = "focus";
    remainingSeconds = config.focusMinutes * TIME_MULTIPLIER;
    phaseEndTime = Date.now() + remainingSeconds * 1000;

    // Activate next focus segment
    const nextFocus = segments.findIndex(
      (s, i) => i > currentSegmentIndex && s.phase === "focus" && s.status === "planned",
    );
    if (nextFocus !== -1) {
      activateSegment(nextFocus);
    }
  }
}

// --- Public API ---

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
    get lastXp() {
      return lastXp;
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
    clearLastXp() {
      lastXp = null;
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

      if (activeBlockId === blockId) {
        if (!eventEnd || !eventDate) return;
        const newEndMs = new Date(eventEnd.replace(" ", "T")).getTime();
        const configChanged = !configEquals(config, newConfig);
        const endChanged = activeBlockEndMs !== newEndMs;
        if (!configChanged && !endChanged) return;
        if (configChanged) {
          reconfigureSession(blockId, newConfig, eventEnd, eventDate);
        } else {
          // Event resized but config unchanged: rebuild segments for new duration
          activeBlockEndMs = newEndMs;
          rebuildSegments(blockId, eventEnd, eventDate);
        }
        return;
      }

      if (activeBlockId && eventEnd && eventDate) {
        // Pomodoro is active on a different block: seamless transition
        // with focus inheritance (accumulated focus vs new threshold)
        transitionToBlock(blockId, newConfig, eventEnd, eventDate);
        return;
      }

      initListeners();

      // Stop any running session first
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      activeBlockId = blockId;
      activeBlockEndMs = eventEnd ? new Date(eventEnd.replace(" ", "T")).getTime() : null;
      config = newConfig;
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

      // Create segments from now to event end
      if (eventEnd && eventDate) {
        createSegments(blockId, eventEnd, eventDate);
      }

      updateTray();
    },
    stopSession() {
      // Mark current segment as interrupted, remaining as skipped
      if (currentSegmentIndex >= 0 && currentSegmentIndex < segments.length) {
        markSegment(currentSegmentIndex, "interrupted", true);
        for (let i = currentSegmentIndex + 1; i < segments.length; i++) {
          if (segments[i].status === "planned") {
            segments[i].status = "skipped";
            execute(
              `UPDATE pomodoro_segments SET status = 'skipped' WHERE id = $1`,
              [segments[i].id],
            ).catch((e) => console.warn("Failed to skip segment:", e));
          }
        }
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
        execute(
          `UPDATE pomodoro_segments SET pause_log = $1 WHERE id = $2`,
          [JSON.stringify(seg.pauseLog), seg.id],
        ).catch((e) => console.warn("Failed to save pause:", e));
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
          execute(
            `UPDATE pomodoro_segments SET pause_log = $1 WHERE id = $2`,
            [JSON.stringify(seg.pauseLog), seg.id],
          ).catch((e) => console.warn("Failed to save resume:", e));
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
      // Mark orphaned active segments as interrupted (e.g. app closed while running)
      await execute(
        `UPDATE pomodoro_segments
         SET status = 'interrupted',
             actual_end = COALESCE(actual_end, actual_start, datetime('now'))
         WHERE status = 'active'`,
        [],
      ).catch((e) => console.warn("Failed to clean up orphaned segments:", e));
      // Mark orphaned planned segments as skipped
      await execute(
        `UPDATE pomodoro_segments SET status = 'skipped' WHERE status = 'planned'`,
        [],
      ).catch((e) => console.warn("Failed to clean up planned segments:", e));
    },
  };
}
