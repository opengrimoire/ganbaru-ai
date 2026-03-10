import type { PomodoroPhase } from "@ganbaruai/shared-types";
import { execute } from "$lib/api/db";
import { calculateActivityXp } from "$lib/utils/xp";

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

let phase = $state<PomodoroPhase>("focus");
let remainingSeconds = $state(DEFAULT_CONFIG.focusMinutes * 60);
let currentCycle = $state(1);
let totalCycles = $state(DEFAULT_CONFIG.cyclesBeforeLongBreak);
let isRunning = $state(false);
let config = $state<PomodoroConfig>({ ...DEFAULT_CONFIG });
let intervalId: ReturnType<typeof setInterval> | null = null;
let completedPomodoros = $state(0);
let sessionStartTime: string | null = null;
let lastXp = $state<number | null>(null);

async function saveCompletedSession(startTime: string, endTime: string): Promise<void> {
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
  if (remainingSeconds <= 0) {
    advancePhase();
    return;
  }
  remainingSeconds -= 1;
}

function advancePhase() {
  if (phase === "focus") {
    const endTime = new Date().toISOString();
    if (sessionStartTime) {
      saveCompletedSession(sessionStartTime, endTime);
    }
    completedPomodoros += 1;
    sessionStartTime = null;
    if (currentCycle >= totalCycles) {
      phase = "long_break";
      remainingSeconds = config.longBreakMinutes * 60;
      currentCycle = 1;
    } else {
      phase = "short_break";
      remainingSeconds = config.shortBreakMinutes * 60;
      currentCycle += 1;
    }
  } else {
    phase = "focus";
    remainingSeconds = config.focusMinutes * 60;
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
      isRunning = true;
      if (!sessionStartTime) {
        sessionStartTime = new Date().toISOString();
      }
      intervalId = setInterval(tick, 1000);
    },
    pause() {
      isRunning = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    reset() {
      isRunning = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      phase = "focus";
      remainingSeconds = config.focusMinutes * 60;
      currentCycle = 1;
      completedPomodoros = 0;
      sessionStartTime = null;
      lastXp = null;
    },
    skip() {
      advancePhase();
    },
    configure(newConfig: Partial<PomodoroConfig>) {
      config = { ...config, ...newConfig };
      totalCycles = config.cyclesBeforeLongBreak;
      if (!isRunning) {
        remainingSeconds = config.focusMinutes * 60;
      }
    },
    setTotalCycles(cycles: number) {
      totalCycles = cycles;
    },
  };
}
