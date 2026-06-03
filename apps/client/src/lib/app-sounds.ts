import { invoke } from "@tauri-apps/api/core";

export const APP_SOUND_IDS = {
  eventNotification: "event-notification",
  idleAlert: "idle-alert",
  focusSessionFailedLongIdle: "focus-session-failed-long-idle",
  focusEndingWarning: "focus-ending-warning",
  breakStart: "break-start",
  breakFinished: "break-finished",
  eventFinished: "event-finished",
  pomodoroDayComplete: "pomodoro-day-complete",
  pomodoroWorkweekComplete: "pomodoro-workweek-complete",
} as const;

export type AppSoundId = typeof APP_SOUND_IDS[keyof typeof APP_SOUND_IDS];

export function playAppSound(soundId: AppSoundId): Promise<void> {
  return invoke("play_app_sound", { soundId });
}
