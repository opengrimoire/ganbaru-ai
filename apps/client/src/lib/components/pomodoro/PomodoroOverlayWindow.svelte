<script lang="ts">
  import { onMount } from "svelte";
  import { emit } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { APP_SOUND_IDS, playAppSound } from "$lib/app-sounds";
  import { IDLE_FOCUS_FAILURE_DELAY_SECONDS } from "$lib/stores/pomodoro-machine";
  import {
    delayUntil,
    elapsedSecondsSince,
    nextIntervalTargetAfter,
    remainingSecondsUntil,
    shouldScheduleIdleAlert,
  } from "./blocked-screen";
  import PomodoroBlockedScreen from "./PomodoroBlockedScreen.svelte";
  import type { PomodoroBlockedScreenState } from "./blocked-screen";

  const IDLE_ALERT_INTERVAL_MS = 10_000;
  const MAX_BREAK_EXTENSION_MINUTES = 3;

  type OverlayMode =
    | { kind: "idle"; initialIdleSeconds: number }
    | { kind: "break"; breakEndsAtMs: number };

  interface BreakExtendedPayload {
    seconds: number;
  }

  interface IdleFocusFailedPayload {
    failedAtMs: number;
  }

  function numberParam(params: URLSearchParams, name: string, fallback: number): number {
    const value = Number(params.get(name));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  }

  function overlayModeFromLocation(): OverlayMode {
    const params = new URLSearchParams(window.location.search);
    if (params.get("overlayKind") === "idle") {
      return {
        kind: "idle",
        initialIdleSeconds: numberParam(params, "idleSeconds", 0),
      };
    }

    const fallbackBreakSeconds = numberParam(params, "breakSeconds", 0);
    return {
      kind: "break",
      breakEndsAtMs: numberParam(
        params,
        "breakEndsAtMs",
        Date.now() + fallbackBreakSeconds * 1000,
      ),
    };
  }

  const mode = overlayModeFromLocation();
  let overlayStartedAtMs = Date.now();
  let idleFailureDueAtMs = overlayStartedAtMs + IDLE_FOCUS_FAILURE_DELAY_SECONDS * 1000;
  let seconds = $state(
    mode.kind === "idle"
      ? mode.initialIdleSeconds
      : remainingSecondsUntil(mode.breakEndsAtMs, Date.now()),
  );
  let screenState = $state<PomodoroBlockedScreenState>(
    mode.kind === "idle" ? "idle" : "break_countdown",
  );
  let extensionMinutes = $state(0);
  let escPresses = $state(0);
  let closed = false;
  let focusFailureSent = false;
  let breakEndMs = mode.kind === "break" ? mode.breakEndsAtMs : 0;
  let breakFinishedAtMs: number | null = null;
  let idleAlertTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let idleFailureTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let tickIntervalId: ReturnType<typeof setInterval> | null = null;
  let syncedScreenState: PomodoroBlockedScreenState | null = null;

  function closeOverlay(): void {
    if (closed) return;
    closed = true;
    invoke("close_pomodoro_overlay").catch((error) => {
      console.warn("Failed to close pomodoro overlay:", error);
    });
  }

  function clearIdleTimers(): void {
    if (idleAlertTimeoutId !== null) {
      clearTimeout(idleAlertTimeoutId);
      idleAlertTimeoutId = null;
    }
    if (idleFailureTimeoutId !== null) {
      clearTimeout(idleFailureTimeoutId);
      idleFailureTimeoutId = null;
    }
  }

  function playIdleAlert(): void {
    playAppSound(APP_SOUND_IDS.idleAlert).catch(() => {});
  }

  function scheduleNextIdleAlert(targetMs: number): void {
    if (!shouldScheduleIdleAlert(targetMs, idleFailureDueAtMs)) return;
    idleAlertTimeoutId = setTimeout(() => {
      idleAlertTimeoutId = null;
      if (closed || screenState !== "idle") return;
      if (!shouldScheduleIdleAlert(Date.now(), idleFailureDueAtMs)) {
        triggerFocusFailure();
        return;
      }
      playIdleAlert();
      scheduleNextIdleAlert(
        nextIntervalTargetAfter(targetMs, IDLE_ALERT_INTERVAL_MS, Date.now()),
      );
    }, delayUntil(targetMs, Date.now()));
  }

  function reinforceFullscreen(): void {
    const window = getCurrentWindow();
    window.setAlwaysOnTop(true).catch(() => {});
    window.setFullscreen(true).catch(() => {});
    window.setFocus().catch(() => {});
  }

  function triggerFocusFailure(): void {
    if (focusFailureSent || screenState === "idle_failed") return;
    focusFailureSent = true;
    screenState = "idle_failed";
    clearIdleTimers();
    if (mode.kind === "idle") {
      seconds =
        mode.initialIdleSeconds + elapsedSecondsSince(overlayStartedAtMs, idleFailureDueAtMs);
    }
    playAppSound(APP_SOUND_IDS.focusSessionFailedLongIdle).catch(() => {});
    const payload: IdleFocusFailedPayload = { failedAtMs: idleFailureDueAtMs };
    emit("idle-overlay-focus-failed", payload).catch((error) => {
      console.warn("Failed to emit idle focus failure:", error);
    });
  }

  function enterBreakFinished(): void {
    if (screenState === "break_finished") return;
    screenState = "break_finished";
    breakFinishedAtMs = Date.now();
    seconds = 0;
  }

  function tick(): void {
    if (mode.kind === "idle") {
      seconds = mode.initialIdleSeconds + elapsedSecondsSince(overlayStartedAtMs, Date.now());
      return;
    }

    if (screenState === "break_finished") {
      seconds = breakFinishedAtMs === null
        ? 0
        : Math.floor((Date.now() - breakFinishedAtMs) / 1000);
      return;
    }

    const remaining = remainingSecondsUntil(breakEndMs, Date.now());
    seconds = remaining;
    if (remaining <= 0) enterBreakFinished();
  }

  async function acknowledgeBreak(): Promise<void> {
    if (screenState !== "break_finished") return;
    await emit("pomodoro-break-acknowledged");
    closeOverlay();
  }

  async function skipBreak(): Promise<void> {
    await emit("pomodoro-skip-break");
    closeOverlay();
  }

  async function extendBreak(): Promise<void> {
    escPresses = 0;
    if (extensionMinutes >= MAX_BREAK_EXTENSION_MINUTES) return;
    extensionMinutes += 1;
    breakEndMs += 60_000;
    seconds = remainingSecondsUntil(breakEndMs, Date.now());
    const payload: BreakExtendedPayload = { seconds: 60 };
    await emit("pomodoro-break-extended", payload);
  }

  async function resumeIdle(): Promise<void> {
    clearIdleTimers();
    await emit("idle-overlay-resume");
    closeOverlay();
  }

  function handleKeydown(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (mode.kind === "idle") {
      if (event.code === "Space") {
        void resumeIdle();
      }
      return;
    }

    if (screenState === "break_finished") {
      void acknowledgeBreak();
      return;
    }

    if (event.code === "Space" && event.ctrlKey && event.shiftKey) {
      void extendBreak();
      return;
    }

    if (event.key === "Escape") {
      escPresses = Math.min(3, escPresses + 1);
      if (escPresses >= 3) {
        void skipBreak();
      }
      return;
    }

    escPresses = 0;
  }

  function handleClick(): void {
    if (mode.kind === "break" && screenState === "break_finished") {
      void acknowledgeBreak();
    }
  }

  function afterNextPaint(callback: () => void): () => void {
    let cancelled = false;
    let firstFrameId = 0;
    let secondFrameId = 0;
    firstFrameId = requestAnimationFrame(() => {
      secondFrameId = requestAnimationFrame(() => {
        if (!cancelled) callback();
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrameId);
      cancelAnimationFrame(secondFrameId);
    };
  }

  onMount(() => {
    overlayStartedAtMs = Date.now();
    idleFailureDueAtMs = overlayStartedAtMs + IDLE_FOCUS_FAILURE_DELAY_SECONDS * 1000;
    reinforceFullscreen();
    const fullscreenTimerIds = [
      setTimeout(reinforceFullscreen, 100),
      setTimeout(reinforceFullscreen, 500),
      setTimeout(reinforceFullscreen, 1000),
    ];
    const focusIntervalId = setInterval(reinforceFullscreen, 2000);
    tick();
    window.addEventListener("keydown", handleKeydown, true);

    if (mode.kind === "idle") {
      const cancelIdlePaintSideEffects = afterNextPaint(() => {
        overlayStartedAtMs = Date.now();
        idleFailureDueAtMs = overlayStartedAtMs + IDLE_FOCUS_FAILURE_DELAY_SECONDS * 1000;
        seconds = mode.initialIdleSeconds;
        invoke("show_event_notification", {
          title: "Focus session paused",
          body: "No activity detected. Return to resume your session.",
          playSound: false,
        }).catch(() => {});
        playIdleAlert();
        scheduleNextIdleAlert(overlayStartedAtMs + IDLE_ALERT_INTERVAL_MS);
        idleFailureTimeoutId = setTimeout(
          triggerFocusFailure,
          delayUntil(idleFailureDueAtMs, Date.now()),
        );
      });

      tickIntervalId = setInterval(tick, 1000);

      return () => {
        cancelIdlePaintSideEffects();
        for (const id of fullscreenTimerIds) clearTimeout(id);
        clearInterval(focusIntervalId);
        window.removeEventListener("keydown", handleKeydown, true);
        clearIdleTimers();
        if (tickIntervalId !== null) clearInterval(tickIntervalId);
      };
    }

    const cancelBreakStartSound = afterNextPaint(() => {
      playAppSound(APP_SOUND_IDS.breakStart).catch(() => {});
    });
    tickIntervalId = setInterval(tick, 1000);

    return () => {
      cancelBreakStartSound();
      for (const id of fullscreenTimerIds) clearTimeout(id);
      clearInterval(focusIntervalId);
      window.removeEventListener("keydown", handleKeydown, true);
      clearIdleTimers();
      if (tickIntervalId !== null) clearInterval(tickIntervalId);
    };
  });

  $effect(() => {
    if (screenState === syncedScreenState) return;
    syncedScreenState = screenState;
    invoke("set_pomodoro_overlay_state", { state: screenState }).catch((error) => {
      console.warn("Failed to sync pomodoro overlay state:", error);
    });
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="h-full w-full" onclick={handleClick}>
  <PomodoroBlockedScreen
    state={screenState}
    {seconds}
    {extensionMinutes}
    maxExtensionMinutes={MAX_BREAK_EXTENSION_MINUTES}
    {escPresses}
  />
</div>
