export type PomodoroPhase = "focus" | "short_break" | "long_break";

export interface PomodoroState {
  phase: PomodoroPhase;
  remainingSeconds: number;
  currentCycle: number;
  totalCycles: number;
  isRunning: boolean;
}

export interface PomodoroConfig {
  focusDurationMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  pomodoroCount: number;
  idleTimeoutMinutes: number | null;
}

export interface SessionBlock {
  id: string;
  title: string;
  taskIds: string[];
  skillBranchIds: string[];
  timezone: string;
  calendarId: string;
  rrule: string | null;
  pomodoroConfig: PomodoroConfig | null;
  startTime: string;
  endTime: string;
  environmentId: string | null;
  playlistId: string | null;
  createdAt: string;
  updatedAt: string;
}
