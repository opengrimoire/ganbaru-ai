export interface WillScores {
  focus: number;
  clarity: number;
  intensity: number;
  execution: number;
}

export interface XpEntry {
  id: string;
  sessionBlockId: string;
  taskId: string | null;
  activityXp: number;
  willScores: WillScores;
  focusXp: number;
  clarityXp: number;
  intensityXp: number;
  executionXp: number;
  totalXp: number;
  streakMultiplier: number;
  timestamp: string;
}
