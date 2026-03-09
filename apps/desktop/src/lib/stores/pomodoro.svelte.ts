import type { PomodoroPhase } from "@ganbaruai/shared-types";

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

function tick() {
  if (remainingSeconds <= 0) {
    advancePhase();
    return;
  }
  remainingSeconds -= 1;
}

function advancePhase() {
  if (phase === "focus") {
    completedPomodoros += 1;
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
    get formattedTime() {
      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;
      return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
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
