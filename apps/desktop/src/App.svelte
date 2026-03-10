<script lang="ts">
  import { getNavigation } from "$lib/stores/navigation.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import CalendarView from "$lib/components/calendar/CalendarView.svelte";
  import KanbanView from "$lib/components/kanban/KanbanView.svelte";
  import PomodoroView from "$lib/components/pomodoro/PomodoroView.svelte";
  import SkillTreeView from "$lib/components/skill-tree/SkillTreeView.svelte";

  const nav = getNavigation();
</script>

<div class="flex h-screen flex-col overflow-hidden">
  <TitleBar />
  <div class="flex flex-1 overflow-hidden">
    <Sidebar />
    <main class="flex-1 overflow-hidden">
      {#if nav.current === "calendar"}
        <CalendarView />
      {:else if nav.current === "kanban"}
        <KanbanView />
      {:else if nav.current === "pomodoro"}
        <PomodoroView />
      {:else if nav.current === "skill-tree"}
        <SkillTreeView />
      {/if}
    </main>
  </div>
</div>
