<script lang="ts">
  import { getNavigation, type View } from "$lib/stores/navigation.svelte";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { parseCalendarDate } from "$lib/components/calendar/utils";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import CalendarView from "$lib/components/calendar/CalendarView.svelte";
  import KanbanView from "$lib/components/kanban/KanbanView.svelte";
  import SkillTreeView from "$lib/components/skill-tree/SkillTreeView.svelte";

  const nav = getNavigation();
  const calendar = getCalendar();
  const pomodoro = getPomodoro();

  const views: View[] = ["calendar", "kanban", "skill-tree"];

  function navigatePrev() {
    const i = views.indexOf(nav.current);
    nav.navigate(views[(i - 1 + views.length) % views.length]);
  }

  function navigateNext() {
    const i = views.indexOf(nav.current);
    nav.navigate(views[(i + 1) % views.length]);
  }

  function handleKeydown(e: KeyboardEvent) {
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

  // Session watcher: auto-start/stop pomodoro based on active calendar blocks
  function checkActiveBlock() {
    const now = new Date();
    const activeBlock = calendar.events.find((event) => {
      const start = parseCalendarDate(event.start);
      const end = parseCalendarDate(event.end);
      return now >= start && now < end;
    });

    if (activeBlock) {
      pomodoro.startFromBlock(activeBlock.id, {
        focusMinutes: activeBlock.focusDurationMinutes ?? 25,
        shortBreakMinutes: activeBlock.shortBreakMinutes ?? 5,
        longBreakMinutes: activeBlock.longBreakMinutes ?? 15,
        cyclesBeforeLongBreak: activeBlock.pomodoroCount ?? 4,
      });
    } else if (pomodoro.activeBlockId) {
      pomodoro.stopSession();
    }
  }

  $effect(() => {
    checkActiveBlock();
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
