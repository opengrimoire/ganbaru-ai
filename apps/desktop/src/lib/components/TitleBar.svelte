<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { getNavigation, type View } from "$lib/stores/navigation.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { cn } from "$lib/utils";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import LayoutList from "@lucide/svelte/icons/layout-list";
  import Timer from "@lucide/svelte/icons/timer";
  import TreePine from "@lucide/svelte/icons/tree-pine";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Settings from "@lucide/svelte/icons/settings";
  import Minus from "@lucide/svelte/icons/minus";
  import Square from "@lucide/svelte/icons/square";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";

  const win = getCurrentWindow();
  const nav = getNavigation();
  const pomodoro = getPomodoro();
  const theme = getTheme();

  let isMaximized = $state(false);

  const tabs: { view: View; label: string; icon: typeof CalendarDays }[] = [
    { view: "calendar", label: "Calendar", icon: CalendarDays },
    { view: "kanban", label: "Kanban", icon: LayoutList },
    { view: "pomodoro", label: "Pomodoro", icon: Timer },
    { view: "skill-tree", label: "Skill tree", icon: TreePine },
  ];

  $effect(() => {
    win.isMaximized().then((v) => (isMaximized = v));
    let cleanup: (() => void) | undefined;
    win.onResized(() => {
      win.isMaximized().then((v) => (isMaximized = v));
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  });

  let tabWheelCooldown = false;

  function handleTabWheel(e: WheelEvent) {
    e.preventDefault();
    if (tabWheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    tabWheelCooldown = true;
    const currentIndex = tabs.findIndex((t) => t.view === nav.current);
    const delta = e.deltaY > 0 ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(tabs.length - 1, currentIndex + delta));
    if (nextIndex !== currentIndex) {
      nav.navigate(tabs[nextIndex].view);
    }
    setTimeout(() => { tabWheelCooldown = false; }, 300);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-tauri-drag-region
  class="flex h-12 w-full shrink-0 select-none items-center bg-sidebar"
  onwheel={handleTabWheel}
>
  <!-- Navigation tabs -->
  <div class="flex items-center gap-0.5 pl-3">
    {#each tabs as tab, i}
      <button
        onclick={() => nav.navigate(tab.view)}
        class={cn(
          "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
          nav.current === tab.view
            ? "bg-background dark:bg-accent text-foreground dark:text-white"
            : "text-sidebar-foreground dark:text-white/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
        title={`${tab.label} (Alt+${i + 1})`}
      >
        <span class="relative">
          <tab.icon size={14} />
          {#if tab.view === "pomodoro" && pomodoro.isRunning}
            <span class="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500"></span>
          {/if}
        </span>
        <span>{tab.label}</span>
      </button>
    {/each}
  </div>

  <!-- Draggable spacer -->
  <div class="flex-1" />

  <!-- Theme toggle -->
  <button
    onclick={() => theme.toggle()}
    class="mr-1 flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
    title={theme.isDark ? "Switch to light mode" : "Switch to dark mode"}
  >
    {#if theme.isDark}
      <Sun size={14} />
    {:else}
      <Moon size={14} />
    {/if}
  </button>

  <!-- TODO: implement help panel -->
  <button
    onclick={() => {}}
    class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
    title="Help"
  >
    <CircleHelp size={14} />
  </button>

  <!-- TODO: implement settings panel -->
  <button
    onclick={() => {}}
    class="mr-1 flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
    title="Settings"
  >
    <Settings size={14} />
  </button>

  <!-- Window controls -->
  <button
    onclick={() => win.minimize()}
    class="flex h-12 w-11 items-center justify-center text-sidebar-foreground/70 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-foreground"
    title="Minimize"
  >
    <Minus size={14} />
  </button>
  <button
    onclick={() => win.toggleMaximize()}
    class="flex h-12 w-11 items-center justify-center text-sidebar-foreground/70 dark:text-white hover:bg-sidebar-accent hover:text-sidebar-foreground"
    title={isMaximized ? "Restore" : "Maximize"}
  >
    {#if isMaximized}
      <Minimize2 size={13} />
    {:else}
      <Square size={13} />
    {/if}
  </button>
  <button
    onclick={() => win.close()}
    class="flex h-12 w-11 items-center justify-center text-sidebar-foreground/70 dark:text-white hover:bg-destructive hover:text-white"
    title="Close"
  >
    <X size={14} />
  </button>
</div>
