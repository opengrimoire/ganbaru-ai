<script lang="ts">
  import { getNavigation, type View } from "$lib/stores/navigation.svelte";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { parseCalendarDate } from "$lib/components/calendar/utils";
  import type { CalendarEvent } from "$lib/components/calendar/types";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import CalendarView from "$lib/components/calendar/CalendarView.svelte";
  import KanbanView from "$lib/components/kanban/KanbanView.svelte";
  import SkillTreeView from "$lib/components/skill-tree/SkillTreeView.svelte";
  import { onMount } from "svelte";

  const nav = getNavigation();
  const calendar = getCalendar();
  const pomodoro = getPomodoro();

  // Load calendar data before any child component mounts
  onMount(() => {
    calendar.load();
  });

  const views: View[] = ["calendar", "kanban", "skill-tree"];

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

  function handleKeydown(e: KeyboardEvent) {
    // Modal keyboard shortcuts
    if (showStopConfirm) {
      if (e.key === "Escape") { cancelStop(); return; }
      if (e.key === "Enter") { confirmStop(); return; }
      return;
    }

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
    return calendar.events.find((event) => {
      const start = parseCalendarDate(event.start);
      const end = parseCalendarDate(event.end);
      return now >= start && now < end;
    });
  }

  let trackedBlockSnapshot: CalendarEvent | null = null;

  function checkActiveBlock() {
    if (showStopConfirm || reverting) return;

    const activeBlock = findActiveBlock();

    if (activeBlock) {
      pomodoro.startFromBlock(activeBlock.id, {
        focusMinutes: activeBlock.focusDurationMinutes ?? 25,
        shortBreakMinutes: activeBlock.shortBreakMinutes ?? 5,
        longBreakMinutes: activeBlock.longBreakMinutes ?? 15,
        cyclesBeforeLongBreak: activeBlock.pomodoroCount ?? 4,
      });
      trackedBlockSnapshot = { ...activeBlock };
    } else if (pomodoro.activeBlockId && trackedBlockSnapshot) {
      savedBlockState = trackedBlockSnapshot;
      showStopConfirm = true;
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

  // React to calendar event changes immediately
  $effect(() => {
    const _events = calendar.events;
    checkActiveBlock();
  });

  // Also poll for time-based transitions
  $effect(() => {
    const id = setInterval(checkActiveBlock, 30_000);
    return () => clearInterval(id);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-screen flex-col overflow-hidden bg-sidebar">
  <TitleBar />
  <main class="mx-3 mb-3 flex-1 min-h-0 overflow-hidden rounded-xl bg-background">
    {#if nav.current === "calendar"}
      <CalendarView />
    {:else if nav.current === "kanban"}
      <KanbanView />
    {:else if nav.current === "skill-tree"}
      <SkillTreeView />
    {/if}
  </main>
</div>

{#if showStopConfirm}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50"
  >
    <div class="absolute inset-0 bg-background/90"></div>
    <div class="relative flex h-full flex-col items-center justify-center">
      <div
        class="flex flex-col items-center gap-5"
        onclick={(e) => e.stopPropagation()}
      >
        <p class="text-sm text-foreground dark:text-white">
          No active session blocks right now. All focus features will stop.
        </p>
        <div class="flex gap-3">
          <button
            onclick={cancelStop}
            class="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90"
          >
            Undo changes
          </button>
          <button
            onclick={confirmStop}
            class="rounded-lg bg-red-800/80 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700/80"
          >
            Stop session
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
