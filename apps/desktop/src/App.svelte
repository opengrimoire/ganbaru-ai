<script lang="ts">
  import { getNavigation, type View } from "$lib/stores/navigation.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import CalendarView from "$lib/components/calendar/CalendarView.svelte";
  import KanbanView from "$lib/components/kanban/KanbanView.svelte";
  import PomodoroView from "$lib/components/pomodoro/PomodoroView.svelte";
  import SkillTreeView from "$lib/components/skill-tree/SkillTreeView.svelte";

  const nav = getNavigation();
  const theme = getTheme();

  const views: View[] = ["calendar", "kanban", "pomodoro", "skill-tree"];

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

    // Use e.code ("Tab") instead of e.key because WebKitGTK reports
    // key="Unidentified" for Ctrl+Shift+Tab while code stays correct.
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
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-screen flex-col overflow-hidden bg-sidebar">
  <TitleBar />
  <main class="mx-3 mb-3 flex-1 min-h-0 overflow-hidden rounded-xl bg-background">
    {#if nav.current === "calendar"}
      {#key theme.isDark}
        <CalendarView isDark={theme.isDark} />
      {/key}
    {:else if nav.current === "kanban"}
      <KanbanView />
    {:else if nav.current === "pomodoro"}
      <PomodoroView />
    {:else if nav.current === "skill-tree"}
      <SkillTreeView />
    {/if}
  </main>
</div>
