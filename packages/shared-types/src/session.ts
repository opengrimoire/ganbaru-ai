export type PomodoroPhase = "focus" | "short_break" | "long_break";

export interface PomodoroState {
  phase: PomodoroPhase;
  remainingSeconds: number;
  currentCycle: number;
  totalCycles: number;
  isRunning: boolean;
}

export interface SessionBlock {
  id: string;
  title: string;
  taskIds: string[];
  skillBranchIds: string[];
  pomodoroCount: number;
  focusDurationMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  startTime: string;
  endTime: string;
  environmentId: string | null;
  playlistId: string | null;
  createdAt: string;
  updatedAt: string;
}
