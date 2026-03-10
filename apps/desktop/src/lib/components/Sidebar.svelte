<script lang="ts">
  import { getNavigation, type View } from "$lib/stores/navigation.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { cn } from "$lib/utils";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import LayoutList from "@lucide/svelte/icons/layout-list";
  import Timer from "@lucide/svelte/icons/timer";
  import TreePine from "@lucide/svelte/icons/tree-pine";

  const nav = getNavigation();
  const pomodoro = getPomodoro();

  const items: { view: View; label: string; icon: typeof CalendarDays }[] = [
    { view: "calendar", label: "Calendar", icon: CalendarDays },
    { view: "kanban", label: "Kanban", icon: LayoutList },
    { view: "pomodoro", label: "Pomodoro", icon: Timer },
    { view: "skill-tree", label: "Skill tree", icon: TreePine },
  ];
</script>

<aside class="flex w-16 shrink-0 flex-col border-r border-border bg-card">
  <nav class="flex flex-1 flex-col items-center gap-1 py-3">
    {#each items as item}
      <button
        onclick={() => nav.navigate(item.view)}
        class={cn(
          "group relative flex h-12 w-12 items-center justify-center rounded-lg transition-colors",
          nav.current === item.view
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
        title={item.label}
      >
        <item.icon size={17} />
        {#if item.view === "pomodoro" && pomodoro.isRunning}
          <span class="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500"></span>
        {/if}
      </button>
    {/each}
  </nav>

  {#if pomodoro.isRunning}
    <div class="pb-4 text-center text-xs font-mono text-muted-foreground">
      {pomodoro.formattedTime}
    </div>
  {/if}
</aside>
