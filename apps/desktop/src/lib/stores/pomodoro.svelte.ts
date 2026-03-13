import type { PomodoroPhase } from "@ganbaruai/shared-types";
import { execute } from "$lib/api/db";
import { calculateActivityXp } from "$lib/utils/xp";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface PomodoroConfig {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLongBreak: number;
}

const DEFAULT_CONFIG: PomodoroConfig = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
};

// --- Testing flag: set to 1 to treat minutes as seconds ---
const TIME_MULTIPLIER = 1;

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

const NOTIFICATION_THRESHOLD = 10;

function initListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  listen("pomodoro-skip-break", () => {
    if (phase === "short_break" || phase === "long_break") {
      phase = "focus";
      remainingSeconds = config.focusMinutes * TIME_MULTIPLIER;
      phaseEndTime = Date.now() + remainingSeconds * 1000;
    } else {
      skipNextBreak = true;
    }
  }).catch((e) => console.warn("Failed to listen for pomodoro-skip-break:", e));

  listen<{ seconds: number }>("pomodoro-add-time", (event) => {
    remainingSeconds += event.payload.seconds;
    if (phaseEndTime !== null) {
      phaseEndTime += event.payload.seconds * 1000;
    }
    notificationShown = false;
  }).catch((e) => console.warn("Failed to listen for pomodoro-add-time:", e));
}

function showBreakOverlay(breakSeconds: number) {
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

function tick() {
  if (phaseEndTime !== null) {
    const now = Date.now();
    remainingSeconds = Math.max(0, Math.ceil((phaseEndTime - now) / 1000));
  }

  if (remainingSeconds <= 0) {
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

    if (skipNextBreak) {
      skipNextBreak = false;
      phase = "focus";
      remainingSeconds = config.focusMinutes * TIME_MULTIPLIER;
      phaseEndTime = Date.now() + remainingSeconds * 1000;
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
      showBreakOverlay(remainingSeconds);
    } else {
      phase = "short_break";
      remainingSeconds = config.shortBreakMinutes * TIME_MULTIPLIER;
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      currentCycle += 1;
      showBreakOverlay(remainingSeconds);
    }
  } else {
    phase = "focus";
    remainingSeconds = config.focusMinutes * TIME_MULTIPLIER;
    phaseEndTime = Date.now() + remainingSeconds * 1000;
  }
}

export function getPomodoro() {
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
    clearLastXp() {
      lastXp = null;
    },
    start() {
      if (isRunning) return;
      initListeners();
      isRunning = true;
      phaseEndTime = Date.now() + remainingSeconds * 1000;
      if (!sessionStartTime) {
        sessionStartTime = new Date().toISOString();
      }
      intervalId = setInterval(tick, 1000);
    },
    pause() {
      isRunning = false;
      phaseEndTime = null;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    reset() {
      isRunning = false;
      phaseEndTime = null;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      phase = "focus";
      remainingSeconds = config.focusMinutes * TIME_MULTIPLIER;
      currentCycle = 1;
      completedPomodoros = 0;
      sessionStartTime = null;
      lastXp = null;
      skipNextBreak = false;
      notificationShown = false;
    },
    skip() {
      advancePhase();
    },
    configure(newConfig: Partial<PomodoroConfig>) {
      config = { ...config, ...newConfig };
      totalCycles = config.cyclesBeforeLongBreak;
      if (!isRunning) {
        remainingSeconds = config.focusMinutes * TIME_MULTIPLIER;
      }
    },
    setTotalCycles(cycles: number) {
      totalCycles = cycles;
    },
  };
}
