<script lang="ts">
  import { getNavigation, type View } from "$lib/stores/navigation.svelte";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getZoom } from "$lib/stores/zoom.svelte";
  import { parseCalendarDate } from "$lib/components/calendar/utils";
  import type { CalendarEvent } from "$lib/components/calendar/types";
  import { Temporal } from "@js-temporal/polyfill";
  import { hydrateCalendarEventTimezones } from "$lib/stores/timezone-migration";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import CalendarView from "$lib/components/calendar/CalendarView.svelte";
  import KanbanView from "$lib/components/kanban/KanbanView.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import IdleOverlay from "$lib/components/pomodoro/IdleOverlay.svelte";
  import { onMount } from "svelte";

  const appWindow = getCurrentWindow();
  const nav = getNavigation();
  const calendar = getCalendar();
  const calendars = getCalendars();
  const pomodoro = getPomodoro();
  const zoom = getZoom();

  let isMaximized = $state(true);
  let startupMs = $state<number | null>(null);

  onMount(() => {
    calendars.load().catch((e) => console.error("Failed to load calendars:", e));
    // The legacy wall-clock to UTC ISO migration runs here instead of in
    // main.ts so first paint is not blocked by a per-event UPDATE pass on
    // first boot after the migration shipped. The hydrator is idempotent:
    // it short-circuits via a config marker once the migration succeeds,
    // so on every subsequent boot this is a single config read. Calendar
    // load is gated on it so the renderer never reads half-migrated rows.
    hydrateCalendarEventTimezones()
      .then(() => calendar.load())
      .catch((e) => console.error("Failed to migrate or load calendar:", e));
    pomodoro.cleanupOrphans().catch((e) => console.warn("Failed to clean up orphans:", e));
    appWindow.isMaximized().then((v) => (isMaximized = v));
    invoke<number>("get_startup_elapsed_ms").then((ms) => {
      startupMs = ms;
    });

    // Prevent default Ctrl+scroll behavior (used for calendar zoom)
    const blockCtrlWheel = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    document.addEventListener("wheel", blockCtrlWheel, { passive: false, capture: true });

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

    return () => {
      document.removeEventListener("wheel", blockCtrlWheel, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", checkZone);
      clearInterval(zoneIntervalId);
    };
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

  const views: View[] = ["calendar", "kanban"];
  let showStopConfirm = $state(false);
  let savedBlockState: CalendarEvent | null = null;
  let reverting = false;

  function navigatePrev() {
    const i = views.indexOf(nav.current);
    nav.navigate(views[(i - 1 + views.length) % views.length]);
  }

  function navigateNext() {
    const i = views.indexOf(nav.current);
    nav.navigate(views[(i + 1) % views.length]);
  }

  const suspendInfo = $derived(pomodoro.suspendedAway);
  const idleInfo = $derived(pomodoro.idlePaused);

  function formatAwayDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${totalSeconds}s`;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      zoom.zoomIn();
      return;
    }
    if (e.ctrlKey && e.key === "-") {
      e.preventDefault();
      zoom.zoomOut();
      return;
    }
    if (e.ctrlKey && e.key === "0") {
      e.preventDefault();
      zoom.reset();
      return;
    }

    if (showStopConfirm || suspendInfo || idleInfo) return;

    if (e.altKey && e.key >= "1" && e.key <= String(views.length)) {
      e.preventDefault();
      nav.navigate(views[parseInt(e.key) - 1]);
      return;
    }

    if (e.ctrlKey && e.code === "Tab") {
      e.preventDefault();
      if (e.shiftKey) navigatePrev();
      else navigateNext();
      return;
    }

    if (e.ctrlKey && (e.key === "PageDown" || e.key === "PageUp")) {
      e.preventDefault();
      if (e.key === "PageUp") navigatePrev();
      else navigateNext();
    }
  }

  function findActiveBlock() {
    const now = new Date();
    const today = Temporal.Now.plainDateISO();
    const events = calendar.eventsInWindow(
      today.subtract({ days: 1 }),
      today.add({ days: 1 }),
    );
    const active = events.filter((event) => {
      if (!event.pomodoroConfig) return false;
      const start = parseCalendarDate(event.start);
      const end = parseCalendarDate(event.end);
      return now >= start && now < end;
    });
    if (active.length === 0) return undefined;

    // Prefer the block the pomodoro is already running on
    if (pomodoro.activeBlockId) {
      const current = active.find((e) => e.id === pomodoro.activeBlockId);
      if (current) return current;
    }

    // Otherwise pick the one with the most remaining time
    return active.reduce((best, e) => {
      const bestEnd = parseCalendarDate(best.end).getTime();
      const eEnd = parseCalendarDate(e.end).getTime();
      return eEnd > bestEnd ? e : best;
    });
  }

  let trackedBlockSnapshot: CalendarEvent | null = null;

  function checkActiveBlock() {
    if (showStopConfirm || reverting || suspendInfo || idleInfo) return;

    const activeBlock = findActiveBlock();

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
      pomodoro.startFromBlock(
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
      // Block naturally ended, no successor: stop silently (no dialog)
      pomodoro.clearBlockExpired();
      trackedBlockSnapshot = null;
      pomodoro.stopSession();
    } else if (pomodoro.activeBlockId && trackedBlockSnapshot) {
      // Block moved/deleted by user: offer revert dialog (or stop if deleted)
      const parentId = pomodoro.activeBlockId.includes("::")
        ? pomodoro.activeBlockId.split("::")[0]
        : pomodoro.activeBlockId;
      const blockExists = calendar.rawBlocks.some((b) => b.id === parentId);
      if (blockExists) {
        savedBlockState = trackedBlockSnapshot;
        showStopConfirm = true;
      } else {
        trackedBlockSnapshot = null;
        pomodoro.stopSession();
      }
    } else if (pomodoro.activeBlockId) {
      pomodoro.stopSession();
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
    checkActiveBlock();
  });

  // Also poll for time-based transitions
  $effect(() => {
    const id = setInterval(checkActiveBlock, 30_000);
    return () => clearInterval(id);
  });

  // Event notifications
  const notifiedEvents = new Set<string>();

  function checkEventNotifications() {
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

        // Fire if within a 90-second window (covers 30s polling interval with margin)
        if (diff >= 0 && diff < 90_000) {
          notifiedEvents.add(notifKey);
          const minutesUntil = Math.round((startTime.getTime() - now.getTime()) / 60_000);
          let body: string;
          if (minutesUntil <= 0) body = "Starting now";
          else if (minutesUntil === 1) body = "Starts in 1 minute";
          else if (minutesUntil < 60) body = `Starts in ${minutesUntil} minutes`;
          else body = `Starts in ${Math.round(minutesUntil / 60)} hour(s)`;
          invoke("show_event_notification", { title: event.title, body }).catch((e) =>
            console.error("[notifications] failed:", e),
          );
        }
      }
    }
  }

  // Check notifications on event changes and every 30s
  $effect(() => {
    const _v = calendar.indexVersion;
    checkEventNotifications();
  });

  $effect(() => {
    const id = setInterval(checkEventNotifications, 30_000);
    return () => clearInterval(id);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="h-screen w-screen" class:app-rounded={!isMaximized}>
  <div class="flex h-full flex-col overflow-hidden bg-sidebar">
    <TitleBar {startupMs} />
    <main class="content-panel mx-3 mb-3 flex-1 min-h-0 overflow-hidden rounded-lg bg-background">
      {#if nav.current === "calendar"}
        <CalendarView />
      {:else if nav.current === "kanban"}
        <KanbanView />
      {/if}
    </main>
  </div>

  {#if showStopConfirm}
    <ConfirmDialog
      title="Stop the focus session?"
      message="All focus features will stop."
      confirmLabel="Stop session (Enter)"
      cancelLabel="Undo changes (Esc)"
      onConfirm={confirmStop}
      onCancel={cancelStop}
    />
  {/if}

  {#if suspendInfo}
    <ConfirmDialog
      title="Resume focus session?"
      message="You were away for {formatAwayDuration(suspendInfo.awaySeconds)}."
      confirmLabel="Resume (Enter)"
      cancelLabel="Stop session (Esc)"
      danger={false}
      onConfirm={() => pomodoro.dismissSuspend(true)}
      onCancel={() => { pomodoro.dismissedBlockId = pomodoro.activeBlockId; pomodoro.dismissSuspend(false); }}
    />
  {/if}

  {#if idleInfo}
    <IdleOverlay
      idleSeconds={idleInfo.idleSeconds}
      nativeOverlay={idleInfo.nativeOverlay}
      onResume={() => pomodoro.dismissIdle(true)}
      onStop={() => { pomodoro.dismissedBlockId = pomodoro.activeBlockId; pomodoro.dismissIdle(false); }}
    />
  {/if}
</div>

<style>
  .app-rounded {
    border-radius: 10px;
    overflow: hidden;
  }
</style>
