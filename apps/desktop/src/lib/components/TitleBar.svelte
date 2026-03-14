<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";
  import { getNavigation, type View } from "$lib/stores/navigation.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { execute } from "$lib/api/db";
  import { cn } from "$lib/utils";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import LayoutList from "@lucide/svelte/icons/layout-list";
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
  const calendar = getCalendar();
  const theme = getTheme();

  let isMaximized = $state(false);
  let showCloseConfirm = $state(false);
  let showPomodoroMenu = $state(false);
  let showResetConfirm = $state(false);

  async function confirmReset() {
    showResetConfirm = false;
    pomodoro.stopSession();
    await calendar.clearAll();
    await execute("DELETE FROM pomodoro_sessions");
    await execute("DELETE FROM xp_entries");
    await execute("DELETE FROM tasks");
  }

  function handleClose() {
    showCloseConfirm = true;
  }

  function confirmClose() {
    showCloseConfirm = false;
    invoke("force_quit");
  }

  function cancelClose() {
    showCloseConfirm = false;
  }

  const progressPercent = $derived(() => {
    const total = pomodoro.totalSecondsForPhase;
    if (total === 0) return 0;
    return ((total - pomodoro.remainingSeconds) / total) * 100;
  });

  const isActive = $derived(
    pomodoro.isRunning || pomodoro.remainingSeconds < pomodoro.totalSecondsForPhase,
  );

  const tabs: { view: View; label: string; icon: typeof CalendarDays }[] = [
    { view: "calendar", label: "Calendar", icon: CalendarDays },
    { view: "kanban", label: "Kanban", icon: LayoutList },
    { view: "skill-tree", label: "Skill tree", icon: TreePine },
  ];

  let memoryMb = $state(0);

  $effect(() => {
    function updateMemory() {
      invoke("get_memory_usage_mb").then((mb) => {
        memoryMb = Math.round(mb as number);
      });
    }
    updateMemory();
    const id = setInterval(updateMemory, 5000);
    return () => clearInterval(id);
  });

  $effect(() => {
    win.isMaximized().then((v) => (isMaximized = v));
    let cleanupResize: (() => void) | undefined;
    let cleanupClose: (() => void) | undefined;
    win.onResized(() => {
      win.isMaximized().then((v) => (isMaximized = v));
    }).then((unlisten) => {
      cleanupResize = unlisten;
    });
    win.onCloseRequested((e) => {
      e.preventDefault();
      showCloseConfirm = true;
    }).then((unlisten) => {
      cleanupClose = unlisten;
    });
    return () => {
      cleanupResize?.();
      cleanupClose?.();
    };
  });

  function handleModalKeydown(e: KeyboardEvent) {
    if (showCloseConfirm) {
      if (e.key === "Escape") { cancelClose(); e.stopPropagation(); }
      if (e.key === "Enter") { confirmClose(); e.stopPropagation(); }
    } else if (showResetConfirm) {
      if (e.key === "Escape") { showResetConfirm = false; e.stopPropagation(); }
      if (e.key === "Enter") { confirmReset(); e.stopPropagation(); }
    } else if (e.ctrlKey && e.shiftKey && e.key === "W") {
      e.preventDefault();
      handleClose();
    }
  }

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

<svelte:window onkeydown={handleModalKeydown} />

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
        <tab.icon size={14} />
        <span>{tab.label}</span>
      </button>
    {/each}
  </div>

  <!-- Draggable spacer -->
  <div class="flex-1"></div>

  <!-- RAM usage (dev) -->
  {#if memoryMb > 0}
    <span class="mr-2 text-[11px] tabular-nums text-sidebar-foreground/40">{memoryMb} MB</span>
  {/if}

  <!-- Pomodoro progress ring with dropdown -->
  <div class="relative mr-1">
    <button
      onclick={() => { showPomodoroMenu = !showPomodoroMenu; }}
      class="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent"
      title={pomodoro.isRunning ? `${pomodoro.formattedTime} remaining` : "Pomodoro"}
    >
      <svg viewBox="0 0 20 20" class="h-4 w-4">
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke-width="2.5"
          class={isActive ? "stroke-foreground/20 dark:stroke-white/20" : "stroke-foreground/15 dark:stroke-white/15"}
        />
        {#if isActive}
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke-width="2.5"
            stroke-dasharray={`${((100 - progressPercent()) / 100) * 50.27} 50.27`}
            stroke-linecap="round"
            class="stroke-foreground/60 dark:stroke-white/70 -rotate-90 origin-center"
          />
        {/if}
      </svg>
    </button>
    {#if showPomodoroMenu}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="fixed inset-0 z-40"
        onclick={() => { showPomodoroMenu = false; }}
        onkeydown={(e) => { if (e.key === "Escape") showPomodoroMenu = false; }}
      ></div>
      <div class="absolute right-0 top-9 z-50 min-w-36 rounded-lg border border-border bg-popover py-1 shadow-lg">
        {#if isActive}
          <div class="px-3 py-1.5 text-xs text-muted-foreground">
            {pomodoro.formattedTime} left
          </div>
          <div class="my-1 h-px bg-border"></div>
          {#if pomodoro.isRunning}
            <button
              onclick={() => { pomodoro.pause(); showPomodoroMenu = false; }}
              class="flex w-full items-center px-3 py-1.5 text-sm text-foreground hover:bg-accent"
            >Pause</button>
          {:else}
            <button
              onclick={() => { pomodoro.start(); showPomodoroMenu = false; }}
              class="flex w-full items-center px-3 py-1.5 text-sm text-foreground hover:bg-accent"
            >Resume</button>
          {/if}
          <button
            onclick={() => { pomodoro.skip(); showPomodoroMenu = false; }}
            class="flex w-full items-center px-3 py-1.5 text-sm text-foreground hover:bg-accent"
          >Skip</button>
        {:else}
          <div class="px-3 py-1.5 text-xs text-muted-foreground">
            No active session
          </div>
        {/if}
      </div>
    {/if}
  </div>

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

  <!-- Provisional: reset database -->
  <button
    onclick={() => { showResetConfirm = true; }}
    class="mr-1 flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
    title="Reset database"
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
    onclick={handleClose}
    class="flex h-12 w-11 items-center justify-center text-sidebar-foreground/70 dark:text-white hover:bg-destructive hover:text-white"
    title="Close"
  >
    <X size={14} />
  </button>
</div>

{#if showResetConfirm}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50"
    onclick={() => { showResetConfirm = false; }}
  >
    <div class="absolute inset-0 bg-background/90"></div>
    <div class="relative flex h-full flex-col items-center justify-center">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex flex-col items-center gap-5"
        onclick={(e) => e.stopPropagation()}
      >
        <p class="text-sm text-foreground dark:text-white">
          This will permanently delete all session blocks, tasks, and XP data.
        </p>
        <div class="flex gap-3">
          <button
            onclick={() => { showResetConfirm = false; }}
            class="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90"
          >
            Cancel
          </button>
          <button
            onclick={confirmReset}
            class="rounded-lg bg-red-800/80 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700/80"
          >
            Reset everything
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showCloseConfirm}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50"
    onclick={cancelClose}
  >
    <div class="absolute inset-0 bg-background/90"></div>
    <div class="relative flex h-full flex-col items-center justify-center">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex flex-col items-center gap-5"
        onclick={(e) => e.stopPropagation()}
      >
        <p class="text-sm text-foreground dark:text-white">
          All productivity features will stop working if you close the app.
        </p>
        <div class="flex gap-3">
          <button
            onclick={cancelClose}
            class="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90"
          >
            Stay
          </button>
          <button
            onclick={confirmClose}
            class="rounded-lg bg-red-800/80 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700/80"
          >
            Close anyway
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
