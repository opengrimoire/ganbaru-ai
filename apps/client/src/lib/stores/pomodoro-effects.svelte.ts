import type { PomodoroPhase } from "@ganbaru-ai/shared-types";
import { invoke } from "@tauri-apps/api/core";

import { APP_SOUND_IDS, playAppSound } from "$lib/app-sounds";
import { getMusicPlayer } from "$lib/stores/music-player.svelte";
import { getPreferences } from "$lib/stores/preferences.svelte";

interface PomodoroTrayUpdateOptions {
  publishSnapshot?: boolean;
}

interface PomodoroTrayUpdatePayload {
  phase: PomodoroPhase;
  remainingSeconds: number;
  totalSeconds: number;
  isRunning: boolean;
  isActive: boolean;
  canPauseResume: boolean;
  canAddFocusTime: boolean;
  pausedPulseFrame: number | null;
}

export interface PomodoroEffectsContext {
  isCoordinator(): boolean;
  phase(): PomodoroPhase;
  remainingSeconds(): number;
  totalSeconds(): number;
  isRunning(): boolean;
  phaseEndTime(): number | null;
  isActive(): boolean;
  canPauseResume(): boolean;
  canAddFocusTime(): boolean;
  pausedFocusPulseActive(): boolean;
  notificationShown(): boolean;
  setNotificationShown(value: boolean): void;
  publishWindowSnapshot(): void;
  writeDoomscrollingRuntimeState(force?: boolean): void;
  initListeners(): void;
}

export interface PomodoroEffects {
  currentPausedTrayPulseFrame(): number | null;
  currentPausedPulseAmount(): number | null;
  clearBreakEndWarning(): void;
  scheduleBreakEndWarning(): void;
  clearMusicPausedByPomodoro(): void;
  pauseMusicForPomodoroPause(): void;
  resumeMusicFromPomodoroPause(): void;
  resetPausedFocusNotificationState(): void;
  suppressPausedFocusNotificationsForCurrentPause(): void;
  updateTray(options?: PomodoroTrayUpdateOptions): void;
  showBreakOverlay(breakSeconds: number): void;
  closePomodoroOverlay(): void;
  showNotification(): void;
  playBreakFinishedAlert(): void;
  startConfiguredBreakFinishedAlertInterval(): ReturnType<typeof setInterval> | null;
}

const PAUSED_PULSE_AMOUNTS = [
  0, 0, 0, 0, 0, 0.067, 0.25, 0.5, 0.75, 0.933, 1, 1, 1, 1, 1, 1,
  0.933, 0.75, 0.5, 0.25, 0.067, 0,
] as const;
const PAUSED_TRAY_PULSE_FRAME_COUNT = PAUSED_PULSE_AMOUNTS.length;
const PAUSED_TRAY_PULSE_FRAME_MS = 180;

export function createPomodoroEffects(context: PomodoroEffectsContext): PomodoroEffects {
  let pausedTrayPulseFrame = $state(0);
  let pausedTrayPulseIntervalId: ReturnType<typeof setInterval> | null = null;
  let breakEndWarningTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let musicPausedByPomodoroPause = false;
  let musicPauseInFlight: Promise<void> | null = null;
  let pausedFocusNotificationTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let pausedFocusNotificationSuppressed = false;

  function stopPausedTrayPulse(): void {
    if (pausedTrayPulseIntervalId !== null) {
      clearInterval(pausedTrayPulseIntervalId);
      pausedTrayPulseIntervalId = null;
    }
    pausedTrayPulseFrame = 0;
  }

  function currentPausedTrayPulseFrame(): number | null {
    return context.pausedFocusPulseActive() ? pausedTrayPulseFrame : null;
  }

  function currentPausedPulseAmount(): number | null {
    const frame = currentPausedTrayPulseFrame();
    if (frame === null) return null;
    return PAUSED_PULSE_AMOUNTS[frame % PAUSED_TRAY_PULSE_FRAME_COUNT];
  }

  function syncPausedTrayPulse(): void {
    if (!context.isCoordinator()) return;
    if (!context.pausedFocusPulseActive()) {
      stopPausedTrayPulse();
      return;
    }
    if (pausedTrayPulseIntervalId !== null) return;

    pausedTrayPulseFrame = 0;
    pausedTrayPulseIntervalId = setInterval(() => {
      if (!context.pausedFocusPulseActive()) {
        stopPausedTrayPulse();
        updateTray({ publishSnapshot: false });
        return;
      }

      pausedTrayPulseFrame = (pausedTrayPulseFrame + 1) % PAUSED_TRAY_PULSE_FRAME_COUNT;
      updateTray({ publishSnapshot: false });
    }, PAUSED_TRAY_PULSE_FRAME_MS);
  }

  function clearPausedFocusNotificationTimeout(): void {
    if (pausedFocusNotificationTimeoutId === null) return;
    clearTimeout(pausedFocusNotificationTimeoutId);
    pausedFocusNotificationTimeoutId = null;
  }

  function resetPausedFocusNotificationState(): void {
    clearPausedFocusNotificationTimeout();
    pausedFocusNotificationSuppressed = false;
  }

  function suppressPausedFocusNotificationsForCurrentPause(): void {
    pausedFocusNotificationSuppressed = true;
    clearPausedFocusNotificationTimeout();
  }

  function pausedFocusNotificationIntervalMs(): number {
    const minutes = getPreferences().focusPauseNotificationIntervalMinutes;
    return minutes > 0 ? minutes * 60_000 : 0;
  }

  function showPausedFocusNotification(): void {
    invoke("show_paused_focus_notification").catch((error) => {
      console.warn("Failed to show paused focus notification:", error);
    });
  }

  function scheduleNextPausedFocusNotification(): void {
    if (pausedFocusNotificationTimeoutId !== null) return;
    if (pausedFocusNotificationSuppressed || !context.pausedFocusPulseActive()) return;

    const delayMs = pausedFocusNotificationIntervalMs();
    if (delayMs <= 0) return;

    pausedFocusNotificationTimeoutId = setTimeout(() => {
      pausedFocusNotificationTimeoutId = null;
      if (pausedFocusNotificationSuppressed || !context.pausedFocusPulseActive()) return;
      if (pausedFocusNotificationIntervalMs() <= 0) return;
      showPausedFocusNotification();
      scheduleNextPausedFocusNotification();
    }, delayMs);
  }

  function syncPausedFocusNotification(): void {
    if (!context.isCoordinator()) return;
    if (
      pausedFocusNotificationSuppressed ||
      !context.pausedFocusPulseActive() ||
      pausedFocusNotificationIntervalMs() <= 0
    ) {
      clearPausedFocusNotificationTimeout();
      return;
    }
    scheduleNextPausedFocusNotification();
  }

  function updateTray(options: PomodoroTrayUpdateOptions = {}): void {
    if (options.publishSnapshot !== false) context.publishWindowSnapshot();
    if (!context.isCoordinator()) return;
    context.writeDoomscrollingRuntimeState();
    syncPausedTrayPulse();
    syncPausedFocusNotification();
    const update: PomodoroTrayUpdatePayload = {
      phase: context.phase(),
      remainingSeconds: context.remainingSeconds(),
      totalSeconds: context.totalSeconds(),
      isRunning: context.isRunning(),
      isActive: context.isActive(),
      canPauseResume: context.canPauseResume(),
      canAddFocusTime: context.canAddFocusTime(),
      pausedPulseFrame: currentPausedTrayPulseFrame(),
    };

    invoke("update_tray", { update }).catch(() => {});
  }

  function clearBreakEndWarning(): void {
    if (breakEndWarningTimeoutId === null) return;
    clearTimeout(breakEndWarningTimeoutId);
    breakEndWarningTimeoutId = null;
  }

  function scheduleBreakEndWarning(): void {
    clearBreakEndWarning();
    if (
      !context.isRunning() ||
      (context.phase() !== "short_break" && context.phase() !== "long_break") ||
      context.phaseEndTime() === null
    ) {
      return;
    }

    const warningSeconds = getPreferences().focusBreakEndWarningSeconds;
    if (warningSeconds <= 0) return;

    const targetMs = context.phaseEndTime()! - warningSeconds * 1000;
    const delayMs = targetMs - Date.now();
    if (delayMs <= 0) return;

    breakEndWarningTimeoutId = setTimeout(() => {
      breakEndWarningTimeoutId = null;
      if (
        !context.isRunning() ||
        (context.phase() !== "short_break" && context.phase() !== "long_break") ||
        context.phaseEndTime() === null
      ) {
        return;
      }
      playBreakFinishedAlert();
    }, delayMs);
  }

  function clearMusicPausedByPomodoro(): void {
    musicPausedByPomodoroPause = false;
    musicPauseInFlight = null;
  }

  function pauseMusicForPomodoroPause(): void {
    if (
      !context.isCoordinator()
      || context.phase() !== "focus"
      || !context.isActive()
      || !getPreferences().musicPauseOnPomodoroPause
    ) {
      clearMusicPausedByPomodoro();
      return;
    }
    const music = getMusicPlayer();
    if (!music.isPlaying) {
      clearMusicPausedByPomodoro();
      return;
    }
    musicPausedByPomodoroPause = true;
    const trackedPause = music.pausePlayback().catch((error) => {
      console.warn("Failed to pause music with pomodoro:", error);
    });
    musicPauseInFlight = trackedPause;
    void trackedPause.finally(() => {
      if (musicPauseInFlight === trackedPause) musicPauseInFlight = null;
    });
  }

  function resumeMusicFromPomodoroPause(): void {
    if (!musicPausedByPomodoroPause) return;
    musicPausedByPomodoroPause = false;
    if (!context.isCoordinator() || !getPreferences().musicPauseOnPomodoroPause) return;
    const music = getMusicPlayer();
    const pausePromise = musicPauseInFlight;
    musicPauseInFlight = null;
    void (async () => {
      if (pausePromise) await pausePromise;
      if (!music.currentSource || music.isPlaying || music.isBusy) return;
      await music.playPlayback();
    })().catch((error) => {
      console.warn("Failed to resume music with pomodoro:", error);
    });
  }

  function showBreakOverlay(breakSeconds: number): void {
    context.initListeners();
    const breakEndsAtMs = Math.max(
      0,
      Math.floor(context.phaseEndTime() ?? (Date.now() + breakSeconds * 1000)),
    );
    invoke("show_break_overlay", {
      breakEndsAtMs,
      breakEndEscPresses: getPreferences().focusBreakEndEscPresses,
      breakExtensionLimit: getPreferences().focusBreakExtensionLimit,
    }).catch((e) =>
      console.warn("Failed to show break overlay:", e),
    );
    scheduleBreakEndWarning();
  }

  function closePomodoroOverlay(): void {
    invoke("close_pomodoro_overlay").catch((e) =>
      console.warn("Failed to close pomodoro overlay:", e),
    );
  }

  function showNotification(): void {
    if (context.notificationShown()) return;
    context.setNotificationShown(true);

    invoke("show_pomodoro_notification", {
      remainingSeconds: 60,
      allowAddTime: context.canAddFocusTime(),
    }).catch((e) => {
      console.warn("Failed to show notification:", e);
      context.setNotificationShown(false);
    });
  }

  function playBreakFinishedAlert(): void {
    playAppSound(APP_SOUND_IDS.breakFinished).catch(() => {});
  }

  function startConfiguredBreakFinishedAlertInterval(): ReturnType<typeof setInterval> | null {
    const repeatSeconds = getPreferences().focusBreakFinishedRepeatSeconds;
    if (repeatSeconds <= 0) return null;
    return setInterval(playBreakFinishedAlert, repeatSeconds * 1000);
  }

  return {
    currentPausedTrayPulseFrame,
    currentPausedPulseAmount,
    clearBreakEndWarning,
    scheduleBreakEndWarning,
    clearMusicPausedByPomodoro,
    pauseMusicForPomodoroPause,
    resumeMusicFromPomodoroPause,
    resetPausedFocusNotificationState,
    suppressPausedFocusNotificationsForCurrentPause,
    updateTray,
    showBreakOverlay,
    closePomodoroOverlay,
    showNotification,
    playBreakFinishedAlert,
    startConfiguredBreakFinishedAlertInterval,
  };
}
