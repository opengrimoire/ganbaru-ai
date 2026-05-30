<script lang="ts">
  import { getNavigation, type View } from "$lib/stores/navigation.svelte";
  import {
    firstMainView,
    isDetachableTabView,
    mainTabViews,
    type DetachableTabView,
  } from "$lib/navigation";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";
  import { getDoomscrollingDesktopBlocker } from "$lib/stores/doomscrolling-desktop-blocker.svelte";
  import { getDoomscrollingUsage } from "$lib/stores/doomscrolling-usage.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getZoom } from "$lib/stores/zoom.svelte";
  import { getSettingsLauncher } from "$lib/stores/settingsLauncher.svelte";
  import { getViewport } from "$lib/stores/viewport.svelte";
  import { getDetachedWindows } from "$lib/stores/detached-windows.svelte";
  import { selectActivePomodoroBlock } from "$lib/stores/pomodoro-scheduler";
  import {
    classifyPomodoroCompletion,
    type PomodoroCompletionKind,
  } from "$lib/stores/pomodoro-completion";
  import { detachableTabViewFromWindowLabel } from "$lib/windows/detached";
  import { ensureDbUrl } from "$lib/api/db";
  import { APP_SOUND_IDS, playAppSound, type AppSoundId } from "$lib/app-sounds";
  import "$lib/stores/app-session";
  import { parseCalendarDate } from "$lib/components/calendar/utils";
  import type { CalendarEvent } from "$lib/components/calendar/types";
  import { Temporal } from "@js-temporal/polyfill";
  import { hydrateCalendarEventTimezones } from "$lib/stores/timezone-migration";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { hasOnlyShortcutModifier, hasShortcutModifier } from "$lib/keyboard-shortcuts";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import WindowResizeHandles from "$lib/components/WindowResizeHandles.svelte";
  import CalendarView from "$lib/components/calendar/CalendarView.svelte";
  import CompletionOverlay from "$lib/components/pomodoro/CompletionOverlay.svelte";
  import MusicPlaybackHost from "$lib/components/music/MusicPlaybackHost.svelte";
  import MusicView from "$lib/components/music/MusicView.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import TooltipHost from "$lib/components/ui/TooltipHost.svelte";
  import { formatEventNotificationBody } from "$lib/components/calendar/event-notifications";
  import {
    firstMarkTime,
    mark as perfMark,
    setShellStartupMs,
  } from "$lib/stores/perflog.svelte";
  import type { MemoryReport, StartupMemorySnapshot } from "$lib/components/perf/memoryReport";
  import { isEditableKeyboardTarget, shouldUseKeyboardFocusIntent } from "$lib/utils";
  import { onMount } from "svelte";

  perfMark("boot.script-start");

  const appWindow = getCurrentWindow();
  const isMainWindow = appWindow.label === "main";
  const detachedWindowView = detachableTabViewFromWindowLabel(appWindow.label);
  const nav = getNavigation();
  const calendar = getCalendar();
  const calendars = getCalendars();
  const doomscrolling = getDoomscrolling();
  const desktopBlocker = getDoomscrollingDesktopBlocker();
  const doomscrollingUsage = getDoomscrollingUsage();
  const pomodoro = getPomodoro();
  const zoom = getZoom();
  const settingsLauncher = getSettingsLauncher();
  const viewport = getViewport();
  const detachedWindows = getDetachedWindows();
  let unlistenCalendarNotificationOpen: UnlistenFn | null = null;
  let unlistenDoomscrollingDesktopSettingsOpen: UnlistenFn | null = null;
  let unlistenDoomscrollingLimitsSettingsOpen: UnlistenFn | null = null;
  const ACTIVE_BLOCK_CHECK_INTERVAL_MS = 1000;
  const EVENT_NOTIFICATION_CHECK_INTERVAL_MS = 1000;
  const DESKTOP_BLOCKING_CHECK_INTERVAL_MS = 5_000;

  let isMaximized = $state(true);
  let completionOverlay = $state<{ kind: PomodoroCompletionKind } | null>(null);
  type BenchmarkOverlayComponent = typeof import("$lib/components/benchmark/BenchmarkOverlay.svelte").default;
  type IdleOverlayComponent = typeof import("$lib/components/pomodoro/IdleOverlay.svelte").default;
  let BenchmarkOverlay = $state<BenchmarkOverlayComponent | null>(null);
  let IdleOverlay = $state<IdleOverlayComponent | null>(null);
  let loadingBenchmarkOverlay: Promise<void> | null = null;
  let loadingIdleOverlay: Promise<void> | null = null;

  function ensureBenchmarkOverlay(): Promise<void> {
    if (BenchmarkOverlay) return Promise.resolve();
    loadingBenchmarkOverlay ??= import("$lib/components/benchmark/BenchmarkOverlay.svelte")
      .then((module) => {
        BenchmarkOverlay = module.default;
      })
      .finally(() => {
        loadingBenchmarkOverlay = null;
      });
    return loadingBenchmarkOverlay;
  }

  async function afterAnimationFrames(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  }

  async function startNormalCalendarBoot(): Promise<void> {
    calendars.load().catch((e) => console.error("Failed to load calendars:", e));
    if (isMainWindow) {
      await pomodoro.cleanupOrphans().catch((e) => console.warn("Failed to clean up orphans:", e));
    }
    // The legacy wall-clock to UTC ISO migration runs here instead of in
    // main.ts so first paint is not blocked by a per-event UPDATE pass on
    // first boot after the migration shipped. The hydrator is idempotent:
    // it short-circuits via a config marker once the migration succeeds,
    // so on every subsequent boot this is a single config read. Calendar
    // load is gated on it so the renderer never reads half-migrated rows.
    try {
      await hydrateCalendarEventTimezones();
      perfMark("boot.tz-hydrated");
      await calendar.load();
      // Calendar startup marks are still produced for normal boots.
    } catch (e) {
      console.error("Failed to migrate or load calendar:", e);
    }
  }

  async function startBenchmarkOrNormalCalendarBoot(): Promise<void> {
    let benchmarkClaimedBoot = false;
    try {
      const stateJson = await invoke<string | null>("read_benchmark_state");
      if (stateJson) {
        // Resolve the DB URL while the benchmark state is still pending.
        // The runner flips the state to running before scenario setup, and
        // running states intentionally fall back to the user DB on a fresh
        // boot so interrupted benchmarks cannot keep touching benchmark data.
        await ensureDbUrl();
        await ensureBenchmarkOverlay();
        await afterAnimationFrames(2);
        const { getBenchmarkRunner } = await import("$lib/stores/benchmarkRunner.svelte");
        benchmarkClaimedBoot = await getBenchmarkRunner().checkAndResume();
      }
    } catch (e) {
      console.error("benchmark resume failed:", e);
    } finally {
      if (!benchmarkClaimedBoot) {
        await startNormalCalendarBoot();
      }
    }
  }
  function loadIdleOverlay(): Promise<void> {
    if (IdleOverlay) return Promise.resolve();
    loadingIdleOverlay ??= import("$lib/components/pomodoro/IdleOverlay.svelte")
      .then((module) => {
        IdleOverlay = module.default;
      })
      .finally(() => {
        loadingIdleOverlay = null;
      });
    return loadingIdleOverlay;
  }

  /**
   * Time spent before App.svelte could emit `boot.script-start`. The Rust
   * command is process-spawn anchored, while performance.now is anchored to
   * the WebKit document. Adding the script-start mark produces the baseline
   * used by the launch table and benchmark output.
   */
  let shellStartupMs = $state<number | null>(null);
  let startupMemorySnapshot = $state<StartupMemorySnapshot>({ status: "pending" });

  onMount(() => {
    perfMark("boot.app-mount");
    if (isMainWindow) {
      listen("calendar-notification-open", () => {
        nav.navigate("calendar");
      })
        .then((unlisten) => {
          unlistenCalendarNotificationOpen = unlisten;
        })
        .catch((e) => console.error("Failed to listen for calendar notification opens:", e));
      listen("doomscrolling-open-desktop-settings", () => {
        settingsLauncher.open("doomscrolling", { doomscrollingTab: "desktop" });
      })
        .then((unlisten) => {
          unlistenDoomscrollingDesktopSettingsOpen = unlisten;
        })
        .catch((e) => console.error("Failed to listen for doomscrolling settings opens:", e));
      listen("doomscrolling-open-limits-settings", () => {
        settingsLauncher.open("doomscrolling", { doomscrollingTab: "limits" });
      })
        .then((unlisten) => {
          unlistenDoomscrollingLimitsSettingsOpen = unlisten;
        })
        .catch((e) => console.error("Failed to listen for doomscrolling limit settings opens:", e));
    }

    // Valid benchmark boots are claimed before normal calendar hydration so
    // the measured window is the scenario anchor, not today's normal window.
    startBenchmarkOrNormalCalendarBoot().catch((e) =>
      console.error("calendar boot failed:", e),
    );
    appWindow.isMaximized().then((v) => (isMaximized = v));
    invoke<number>("get_startup_elapsed_ms").then((ms) => {
      const scriptStartMs = firstMarkTime("boot.script-start") ?? 0;
      const nextShellStartupMs = Math.max(0, Math.round(ms - performance.now() + scriptStartMs));
      shellStartupMs = nextShellStartupMs;
      setShellStartupMs(nextShellStartupMs);
    });
    const startupMemoryTimerId = setTimeout(() => {
      invoke<MemoryReport>("get_memory_report")
        .then((report) => {
          startupMemorySnapshot = { status: "ready", report };
        })
        .catch((e) => {
          startupMemorySnapshot = {
            status: "failed",
            message: e instanceof Error ? e.message : String(e),
          };
        });
    }, 10_000);

    // Prevent native webview scaling from modified wheel input.
    const blockNativeWheelScale = (e: WheelEvent) => { if (hasShortcutModifier(e)) e.preventDefault(); };
    const blockNativeContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("wheel", blockNativeWheelScale, { passive: false, capture: true });
    document.addEventListener("contextmenu", blockNativeContextMenu, { capture: true });

    const root = document.documentElement;
    const markPointerFocus = () => {
      root.dataset.focusIntent = "pointer";
    };
    const markKeyboardFocus = (event: KeyboardEvent) => {
      if (shouldUseKeyboardFocusIntent(event)) {
        root.dataset.focusIntent = "keyboard";
      }
    };
    markPointerFocus();
    document.addEventListener("pointerdown", markPointerFocus, { capture: true });
    document.addEventListener("keydown", markKeyboardFocus, { capture: true });

    // Track device timezone changes (travel, OS-level update). On change,
    // reload calendar events so wall-clock strings reflect the new zone.
    // Re-resolves on visibility change (returning from suspend/lock screen),
    // window focus, and a cheap 60s sanity poll for cases where neither
    // event fires (background tab, multi-window).
    let knownZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const checkZone = () => {
      const current = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (current !== knownZone) {
        knownZone = current;
        calendar.load().catch((e) => console.error("Failed to reload calendar after zone change:", e));
      }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") checkZone(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", checkZone);
    const zoneIntervalId = setInterval(checkZone, 60_000);
    const desktopBlockerIntervalId = isMainWindow
      ? setInterval(checkDesktopAppBlocking, DESKTOP_BLOCKING_CHECK_INTERVAL_MS)
      : null;
    const stopDoomscrollingUsage = isMainWindow ? doomscrollingUsage.start() : null;
    checkDesktopAppBlocking();

    return () => {
      unlistenCalendarNotificationOpen?.();
      unlistenCalendarNotificationOpen = null;
      unlistenDoomscrollingDesktopSettingsOpen?.();
      unlistenDoomscrollingDesktopSettingsOpen = null;
      unlistenDoomscrollingLimitsSettingsOpen?.();
      unlistenDoomscrollingLimitsSettingsOpen = null;
      document.removeEventListener("wheel", blockNativeWheelScale, { capture: true });
      document.removeEventListener("contextmenu", blockNativeContextMenu, { capture: true });
      document.removeEventListener("pointerdown", markPointerFocus, { capture: true });
      document.removeEventListener("keydown", markKeyboardFocus, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", checkZone);
      clearTimeout(startupMemoryTimerId);
      clearInterval(zoneIntervalId);
      if (desktopBlockerIntervalId) clearInterval(desktopBlockerIntervalId);
      stopDoomscrollingUsage?.();
    };
  });

  $effect(() => {
    const _running = pomodoro.isRunning;
    const _phase = pomodoro.phase;
    const _enabled = doomscrolling.desktopEnabled;
    const _focus = doomscrolling.desktopBlockDuringFocus;
    const _shortBreaks = doomscrolling.desktopBlockDuringShortBreaks;
    const _longBreaks = doomscrolling.desktopBlockDuringLongBreaks;
    const _rules = doomscrolling.blockedApps;
    checkDesktopAppBlocking();
  });

  $effect(() => {
    const _limitsEnabled = doomscrolling.limitsEnabled;
    const _limits = doomscrolling.usageLimits;
    if (isMainWindow) void doomscrollingUsage.refresh();
  });

  $effect(() => {
    let cleanup: (() => void) | undefined;
    appWindow.onResized(() => {
      appWindow.isMaximized().then((v) => (isMaximized = v));
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  });

  const visibleTabViews = $derived.by<DetachableTabView[]>(() => {
    if (detachedWindowView) return [detachedWindowView];
    return mainTabViews(detachedWindows.views);
  });
  const keyboardViews = $derived.by<View[]>(() => {
    if (!isMainWindow) return visibleTabViews;
    return [...visibleTabViews, "music"];
  });
  let showStopConfirm = $state(false);
  let savedBlockState: CalendarEvent | null = null;
  let reverting = false;

  function navigatePrev() {
    if (keyboardViews.length === 0) return;
    const i = Math.max(0, keyboardViews.indexOf(nav.current));
    nav.navigate(keyboardViews[(i - 1 + keyboardViews.length) % keyboardViews.length]);
  }

  function navigateNext() {
    if (keyboardViews.length === 0) return;
    const i = Math.max(0, keyboardViews.indexOf(nav.current));
    nav.navigate(keyboardViews[(i + 1) % keyboardViews.length]);
  }

  const suspendInfo = $derived(pomodoro.suspendedAway);
  const idleInfo = $derived(pomodoro.idlePaused);

  $effect(() => {
    if (idleInfo) void loadIdleOverlay();
  });

  function formatAwayDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${totalSeconds}s`;
  }

  function desktopAppBlockingActive(): boolean {
    if (!isMainWindow || !pomodoro.isRunning || !doomscrolling.desktopEnabled) return false;
    if (pomodoro.phase === "focus") return doomscrolling.desktopBlockDuringFocus;
    if (pomodoro.phase === "short_break") return doomscrolling.desktopBlockDuringShortBreaks;
    if (pomodoro.phase === "long_break") return doomscrolling.desktopBlockDuringLongBreaks;
    return false;
  }

  function checkDesktopAppBlocking(): void {
    if (!desktopAppBlockingActive()) {
      desktopBlocker.clear();
      return;
    }
    void desktopBlocker.check(doomscrolling.blockedApps);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (hasOnlyShortcutModifier(e) && e.key === ",") {
      e.preventDefault();
      if (settingsLauncher.isOpen) {
        settingsLauncher.close();
      } else {
        settingsLauncher.open();
      }
      return;
    }

    if (hasOnlyShortcutModifier(e) && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      zoom.zoomIn();
      return;
    }
    if (hasOnlyShortcutModifier(e) && e.key === "-") {
      e.preventDefault();
      zoom.zoomOut();
      return;
    }
    if (hasOnlyShortcutModifier(e) && e.key === "0") {
      e.preventDefault();
      zoom.reset();
      return;
    }

    if (showStopConfirm || suspendInfo || idleInfo) return;

    if (e.altKey && e.key >= "1" && e.key <= String(visibleTabViews.length)) {
      e.preventDefault();
      nav.navigate(visibleTabViews[parseInt(e.key) - 1]);
      return;
    }

    if (isMainWindow && hasOnlyShortcutModifier(e) && e.key.toLowerCase() === "m") {
      if (isEditableKeyboardTarget(e.target)) return;
      e.preventDefault();
      nav.navigate("music");
      return;
    }

    if (hasShortcutModifier(e) && !e.altKey && e.code === "Tab") {
      e.preventDefault();
      if (e.shiftKey) navigatePrev();
      else navigateNext();
      return;
    }

    if (hasOnlyShortcutModifier(e) && (e.key === "PageDown" || e.key === "PageUp")) {
      e.preventDefault();
      if (e.key === "PageUp") navigatePrev();
      else navigateNext();
    }
  }

  async function findActiveBlock(): Promise<CalendarEvent | undefined> {
    const now = new Date();
    const today = Temporal.Now.plainDateISO();
    const events = await calendar.loadPomodoroSchedulerEvents(
      today.subtract({ days: 1 }),
      today.add({ days: 1 }),
    );
    return selectActivePomodoroBlock(events, {
      now,
      activeBlockId: pomodoro.activeBlockId,
    });
  }

  function soundForCompletionKind(kind: PomodoroCompletionKind): AppSoundId {
    if (kind === "workweek") return APP_SOUND_IDS.pomodoroWorkweekComplete;
    if (kind === "day") return APP_SOUND_IDS.pomodoroDayComplete;
    return APP_SOUND_IDS.eventFinished;
  }

  async function showNaturalPomodoroCompletion(block: CalendarEvent | null): Promise<void> {
    if (!block) return;
    let kind: PomodoroCompletionKind = "event";
    try {
      const dateText = block.start.split(" ")[0];
      const date = Temporal.PlainDate.from(dateText);
      const events = await calendar.loadPomodoroSchedulerEvents(date, date);
      kind = classifyPomodoroCompletion(block, events);
    } catch (e) {
      console.warn("Failed to classify pomodoro completion:", e);
    }
    completionOverlay = { kind };
    playAppSound(soundForCompletionKind(kind)).catch((e) =>
      console.warn("Failed to play pomodoro completion sound:", e),
    );
  }

  let trackedBlockSnapshot: CalendarEvent | null = null;
  let activeBlockCheckRunning = false;
  let activeBlockCheckQueued = false;

  async function runActiveBlockCheck(): Promise<void> {
    if (!isMainWindow) return;
    if (!calendar.loaded) return;
    if (showStopConfirm || reverting || suspendInfo || idleInfo || pomodoro.autoStartSuppressed) return;

    const activeBlock = await findActiveBlock();

    // Clear dismissed block once its time window passes
    if (pomodoro.dismissedBlockId && activeBlock?.id !== pomodoro.dismissedBlockId) {
      pomodoro.dismissedBlockId = null;
    }

    if (activeBlock && activeBlock.id === pomodoro.dismissedBlockId) {
      return;
    }

    if (activeBlock) {
      if (pomodoro.blockExpired) pomodoro.clearBlockExpired();
      const pc = activeBlock.pomodoroConfig!;
      void pomodoro.startFromBlock(
        activeBlock.id,
        {
          focusMinutes: pc.focusDurationMinutes,
          shortBreakMinutes: pc.shortBreakMinutes,
          longBreakMinutes: pc.longBreakMinutes,
          cyclesBeforeLongBreak: pc.pomodoroCount,
        },
        activeBlock.end,
        activeBlock.start.split(" ")[0],
        pc.idleTimeoutMinutes,
      );
      trackedBlockSnapshot = { ...activeBlock };
    } else if (pomodoro.activeBlockId && pomodoro.blockExpired) {
      // Block naturally ended, no successor: stop the timer and show a terminal notice.
      await showNaturalPomodoroCompletion(trackedBlockSnapshot);
      pomodoro.clearBlockExpired();
      trackedBlockSnapshot = null;
      pomodoro.stopSession();
    } else if (
      pomodoro.activeBlockId &&
      trackedBlockSnapshot &&
      parseCalendarDate(trackedBlockSnapshot.end).getTime() <= Date.now()
    ) {
      // A paused session has no tick to mark blockExpired. If the event window
      // has naturally passed, finish it silently instead of offering an edit
      // rollback that would not change anything useful.
      savedBlockState = null;
      await showNaturalPomodoroCompletion(trackedBlockSnapshot);
      trackedBlockSnapshot = null;
      pomodoro.stopSession();
    } else if (pomodoro.activeBlockId && trackedBlockSnapshot) {
      // No overlapping scheduler candidate is not proof that the active event vanished.
      // Explicit expiry and protected edit/delete paths own session stops.
      return;
    }
  }

  async function checkActiveBlock(): Promise<void> {
    if (activeBlockCheckRunning) {
      activeBlockCheckQueued = true;
      return;
    }

    activeBlockCheckRunning = true;
    try {
      do {
        activeBlockCheckQueued = false;
        await runActiveBlockCheck();
      } while (activeBlockCheckQueued);
    } catch (e) {
      console.warn("active pomodoro block check failed", e);
    } finally {
      activeBlockCheckRunning = false;
    }
  }

  function confirmStop() {
    showStopConfirm = false;
    savedBlockState = null;
    trackedBlockSnapshot = null;
    pomodoro.stopSession();
  }

  function cancelStop() {
    if (!savedBlockState) {
      showStopConfirm = false;
      return;
    }
    const blockToRestore = savedBlockState;
    showStopConfirm = false;
    savedBlockState = null;
    reverting = true;
    calendar.updateBlock(blockToRestore).then(() => {
      reverting = false;
    });
  }

  // React to calendar event changes and block expiry immediately
  $effect(() => {
    const _v = calendar.indexVersion;
    const _expired = pomodoro.blockExpired;
    void checkActiveBlock();
  });

  $effect(() => {
    if (detachedWindowView) {
      if (nav.current !== detachedWindowView) nav.navigate(detachedWindowView);
      return;
    }
    if (isDetachableTabView(nav.current) && !visibleTabViews.includes(nav.current)) {
      nav.navigate(firstMainView(detachedWindows.views));
    }
  });

  // Also poll for time-based transitions
  $effect(() => {
    const id = setInterval(() => {
      void checkActiveBlock();
    }, ACTIVE_BLOCK_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  });

  // Event notifications
  const notifiedEvents = new Set<string>();

  function checkEventNotifications() {
    if (!isMainWindow) return;
    const now = new Date();
    const today = Temporal.Now.plainDateISO();
    const events = calendar.eventsInWindow(
      today.subtract({ days: 1 }),
      today.add({ days: 7 }),
    );
    for (const event of events) {
      if (!event.notifications || event.notifications.length === 0) continue;

      const startTime = parseCalendarDate(event.start);
      for (const minutes of event.notifications) {
        const notifKey = `${event.id}::${minutes}`;
        if (notifiedEvents.has(notifKey)) continue;

        const notifyTime = new Date(startTime.getTime() - minutes * 60_000);
        const diff = now.getTime() - notifyTime.getTime();

        // Fire if within a narrow window that covers the 1s polling interval with margin.
        if (diff >= 0 && diff < 2_500) {
          notifiedEvents.add(notifKey);
          const title = event.title.trim() || "Calendar event";
          const body = formatEventNotificationBody(event, now);
          invoke("show_event_notification", { title, body, openCalendar: true }).catch((e) =>
            console.error("[notifications] failed:", e),
          );
        }
      }
    }
  }

  // Check notifications on event changes and every scheduler tick.
  $effect(() => {
    const _v = calendar.indexVersion;
    checkEventNotifications();
  });

  $effect(() => {
    const id = setInterval(checkEventNotifications, EVENT_NOTIFICATION_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="app-shell h-screen w-screen"
  class:app-rounded={!isMaximized}
  data-size-class={viewport.sizeClass}
>
  <div class="flex h-full flex-col overflow-hidden bg-sidebar">
    <TitleBar {shellStartupMs} {startupMemorySnapshot} {ensureBenchmarkOverlay} />
    <main class="content-panel flex-1 min-h-0 overflow-hidden bg-background">
      {#if nav.current === "calendar"}
        <CalendarView />
      {:else if nav.current === "projects"}
        <div class="h-full"></div>
      {:else if nav.current === "notes"}
        <div class="h-full"></div>
      {:else if nav.current === "music"}
        <MusicView />
      {/if}
    </main>
  </div>

  {#if showStopConfirm}
    <ConfirmDialog
      title="Stop the focus session?"
      message="All focus features will stop"
      confirmLabel="Stop session (Enter)"
      cancelLabel="Undo changes (Esc)"
      onConfirm={confirmStop}
      onCancel={cancelStop}
    />
  {/if}

  {#if suspendInfo}
    <ConfirmDialog
      title="Resume focus session?"
      message="You were away for {formatAwayDuration(suspendInfo.awaySeconds)}"
      confirmLabel="Resume (Enter)"
      cancelLabel="Stop session (Esc)"
      danger={false}
      onConfirm={() => { void pomodoro.dismissSuspend(true); }}
      onCancel={() => { pomodoro.dismissedBlockId = pomodoro.activeBlockId; void pomodoro.dismissSuspend(false); }}
    />
  {/if}

  {#if idleInfo && IdleOverlay}
    {@const Idle = IdleOverlay}
    <Idle
      idleSeconds={idleInfo.idleSeconds}
      nativeOverlay={idleInfo.nativeOverlay}
      focusFailed={idleInfo.focusFailed}
      onResume={() => pomodoro.dismissIdle(true)}
      onStop={async () => {
        pomodoro.dismissedBlockId = pomodoro.activeBlockId;
        await pomodoro.dismissIdle(false);
      }}
      onFocusFailed={() => pomodoro.markIdleFocusFailed()}
    />
  {/if}

  {#if completionOverlay}
    <CompletionOverlay
      kind={completionOverlay.kind}
      onDismiss={() => { completionOverlay = null; }}
    />
  {/if}

  {#if BenchmarkOverlay}
    {@const Overlay = BenchmarkOverlay}
    <Overlay />
  {/if}

  <MusicPlaybackHost />
  <TooltipHost />
  <WindowResizeHandles disabled={isMaximized || !!idleInfo} />
</div>

<style>
  .app-rounded {
    border-radius: var(--content-radius);
    overflow: hidden;
  }
</style>
