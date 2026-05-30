<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { APP_SOUND_IDS, playAppSound } from "$lib/app-sounds";

  let {
    idleSeconds,
    nativeOverlay = false,
    focusFailed = false,
    onResume,
    onStop,
    onFocusFailed,
  }: {
    idleSeconds: number;
    nativeOverlay?: boolean;
    focusFailed?: boolean;
    onResume: () => void | Promise<void>;
    onStop: () => void | Promise<void>;
    onFocusFailed: () => void | Promise<void>;
  } = $props();

  const IDLE_ALERT_INTERVAL_MS = 10_000;
  const FOCUS_FAILURE_DELAY_MS = 60_000;

  let elapsed = $state(0);
  let alertIntervalId: ReturnType<typeof setInterval> | null = null;
  let failureTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let tickIntervalId: ReturnType<typeof setInterval> | null = null;
  let localFocusFailed = $state(false);

  const overlayFocusFailed = $derived(focusFailed || localFocusFailed);

  function formatDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function clearAlertTimer() {
    if (alertIntervalId !== null) {
      clearInterval(alertIntervalId);
      alertIntervalId = null;
    }
  }

  function clearFailureTimer() {
    if (failureTimeoutId !== null) {
      clearTimeout(failureTimeoutId);
      failureTimeoutId = null;
    }
  }

  function playIdleAlert() {
    playAppSound(APP_SOUND_IDS.idleAlert).catch(() => {});
  }

  function triggerFocusFailure() {
    if (localFocusFailed || focusFailed) return;
    localFocusFailed = true;
    clearAlertTimer();
    clearFailureTimer();
    playAppSound(APP_SOUND_IDS.focusSessionFailedLongIdle).catch(() => {});
    void onFocusFailed();
  }

  let wasFullscreen = false;

  async function enterFullscreen() {
    const win = getCurrentWindow();
    try {
      wasFullscreen = await win.isFullscreen();
      await win.setAlwaysOnTop(true);
      await win.setFullscreen(true);
      await win.setFocus();
    } catch (e) {
      console.warn("Failed to enter fullscreen for idle overlay:", e);
    }
  }

  async function exitFullscreen() {
    const win = getCurrentWindow();
    try {
      if (!wasFullscreen) {
        await win.setFullscreen(false);
      }
      await win.setAlwaysOnTop(false);
    } catch (e) {
      console.warn("Failed to exit fullscreen:", e);
    }
  }

  function handleResume() {
    void exitFullscreen().then(() => onResume());
  }

  function handleStop() {
    void exitFullscreen().then(() => onStop());
  }

  onMount(() => {
    elapsed = idleSeconds;

    // When the GTK overlay is active (Linux), it handles fullscreen, sounds,
    // notifications, and key capture. Skip those side effects here.
    if (!nativeOverlay) {
      enterFullscreen();

      invoke("show_event_notification", {
        title: "Focus session paused",
        body: "No activity detected. Return to resume your session.",
        playSound: false,
      }).catch(() => {});

      playIdleAlert();
      alertIntervalId = setInterval(playIdleAlert, IDLE_ALERT_INTERVAL_MS);
      failureTimeoutId = setTimeout(triggerFocusFailure, FOCUS_FAILURE_DELAY_MS);
    }

    tickIntervalId = setInterval(() => {
      elapsed += 1;
    }, 1000);

    function handleKeydown(e: KeyboardEvent) {
      if (nativeOverlay) return; // GTK overlay captures keys
      if (e.code === "Space") {
        e.preventDefault();
        e.stopPropagation();
        handleResume();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleStop();
      }
    }
    window.addEventListener("keydown", handleKeydown, true);

    return () => {
      window.removeEventListener("keydown", handleKeydown, true);
      clearAlertTimer();
      clearFailureTimer();
      if (tickIntervalId !== null) clearInterval(tickIntervalId);
    };
  });
</script>

<div class="fixed inset-0 z-60 flex flex-col items-center justify-center bg-black select-none">
  <div class="flex flex-col items-center gap-8">
    <p class="idle-copy text-sm tracking-wide uppercase" class:failed={overlayFocusFailed}>
      {overlayFocusFailed ? "Focus session failed" : "Focus session paused"}
    </p>

    <p class="idle-timer text-7xl font-light tabular-nums">
      {formatDuration(elapsed)}
    </p>

    <p class="idle-copy text-base" class:failed={overlayFocusFailed}>
      {overlayFocusFailed ? "focus lost" : "idle"}
    </p>
  </div>

  <div class="mt-16 flex flex-col items-center gap-3">
    <p class="idle-copy text-sm">
      Press <span class="idle-key">Space</span> to {overlayFocusFailed ? "restart focus" : "resume focus"}
    </p>
    <p class="idle-copy text-sm">
      Press <span class="idle-key">Esc</span> to stop session
    </p>
  </div>
</div>

<style>
  .idle-copy {
    color: #9CA3AF;
  }

  .idle-copy.failed {
    color: #FCA5A5;
  }

  .idle-timer,
  .idle-key {
    color: #FFFFFF;
  }
</style>
