<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { invoke } from "@tauri-apps/api/core";
  import { getNavigation, type View } from "$lib/stores/navigation.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { cn } from "$lib/utils";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import LayoutList from "@lucide/svelte/icons/layout-list";
  import CircleGauge from "@lucide/svelte/icons/circle-gauge";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Settings from "@lucide/svelte/icons/settings";
  import Minus from "@lucide/svelte/icons/minus";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Square from "@lucide/svelte/icons/square";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";

  interface ProcessMemory {
    name: string;
    mb: number;
  }
  interface MemoryReport {
    processes: ProcessMemory[];
    total_mb: number;
    platform: string;
  }

  let { startupMs = null }: { startupMs: number | null } = $props();

  const win = getCurrentWindow();
  const webview = getCurrentWebviewWindow();
  const nav = getNavigation();
  const pomodoro = getPomodoro();
  const theme = getTheme();

  let isMaximized = $state(false);
  let showCloseConfirm = $state(false);
  let showPomodoroMenu = $state(false);
  let showResetConfirm = $state(false);
  let showPerfMenu = $state(false);
  let perfPinned = $state(false);
  let perfLive = $state(false);
  let copied = $state(false);

  // Zoom handling with predefined levels (Chrome-like behavior)
  const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  let zoomIndex = $state(ZOOM_LEVELS.indexOf(1)); // Start at 100%

  function zoomIn() {
    if (zoomIndex < ZOOM_LEVELS.length - 1) {
      zoomIndex++;
      webview.setZoom(ZOOM_LEVELS[zoomIndex]);
    }
  }

  function zoomOut() {
    if (zoomIndex > 0) {
      zoomIndex--;
      webview.setZoom(ZOOM_LEVELS[zoomIndex]);
    }
  }

  function resetZoom() {
    zoomIndex = ZOOM_LEVELS.indexOf(1);
    webview.setZoom(1);
  }

  const zoomPercent = $derived(Math.round(ZOOM_LEVELS[zoomIndex] * 100));

  async function confirmReset() {
    showResetConfirm = false;
    pomodoro.stopSession();
    await invoke("reset_database");
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
  ];

  let liveReport = $state<MemoryReport | null>(null);
  let snapshotReport = $state<MemoryReport | null>(null);
  let snapshotReady = $state(false);

  const displayReport = $derived(perfLive ? liveReport : snapshotReport);

  $effect(() => {
    function update() {
      invoke<MemoryReport>("get_memory_report").then((r) => {
        liveReport = r;
      });
    }
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  });

  let snapshotCountdown = $state(10);

  $effect(() => {
    const tick = setInterval(() => {
      if (snapshotCountdown > 0) snapshotCountdown--;
    }, 1000);
    const timer = setTimeout(() => {
      invoke<MemoryReport>("get_memory_report").then((r) => {
        snapshotReport = r;
        snapshotReady = true;
      });
    }, 10000);
    return () => {
      clearInterval(tick);
      clearTimeout(timer);
    };
  });

  function copyPerformanceData() {
    const report = displayReport;
    if (!report) return;
    const mode = perfLive ? "Live" : "Snapshot (10s)";
    const lines = [`Performance ${mode} (${report.platform})`];
    lines.push("");
    lines.push("RAM by process:");
    for (const p of report.processes) {
      lines.push(`  ${p.name}: ${p.mb.toFixed(1)} MB`);
    }
    lines.push(`  Total PSS: ${Math.round(report.total_mb)} MB`);
    if (startupMs !== null) {
      lines.push("");
      lines.push(`Launch time: ${startupMs} ms`);
    }
    navigator.clipboard.writeText(lines.join("\n"));
    copied = true;
    setTimeout(() => { copied = false; }, 2000);
  }

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
    if (e.ctrlKey && e.shiftKey && e.key === "W") {
      e.preventDefault();
      handleClose();
    }
  }

  // Capture zoom shortcuts early to prevent native webview handling
  $effect(() => {
    function handleZoom(e: KeyboardEvent) {
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          zoomIn();
        } else if (e.key === "-") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          zoomOut();
        } else if (e.key === "0") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          resetZoom();
        }
      }
    }
    window.addEventListener("keydown", handleZoom, { capture: true });
    return () => window.removeEventListener("keydown", handleZoom, { capture: true });
  });

  let tabEls: HTMLButtonElement[] = $state([]);
  let indicatorStyle = $state("");

  function updateIndicator() {
    const idx = tabs.findIndex((t) => t.view === nav.current);
    const el = tabEls[idx];
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    indicatorStyle = `left: ${elRect.left - parentRect.left}px; width: ${elRect.width}px;`;
  }

  $effect(() => {
    void nav.current;
    requestAnimationFrame(updateIndicator);
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

<svelte:window onkeydown={handleModalKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-tauri-drag-region
  class="flex h-12 w-full shrink-0 select-none items-center bg-sidebar"
  onwheel={handleTabWheel}
>
  <!-- Navigation tabs -->
  <div class="relative flex items-center gap-0.5 pl-3">
    <div
      class="tab-indicator absolute top-0 h-full rounded-md bg-background dark:bg-accent"
      style="{indicatorStyle} box-shadow: 0 0 0 1px {theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)'};"
    ></div>
    {#each tabs as tab, i}
      <button
        bind:this={tabEls[i]}
        onclick={() => nav.navigate(tab.view)}
        class={cn(
          "relative z-[1] flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          nav.current === tab.view
            ? "text-foreground dark:text-white"
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

  <!-- Utility buttons -->
  <div class="flex items-center gap-0.5">
    <!-- Reset zoom -->
    <button
      onclick={resetZoom}
      class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      title={`Zoom: ${zoomPercent}% (Ctrl+0 to reset)`}
    >
      <RotateCcw size={14} />
    </button>

    <!-- Pomodoro progress ring with dropdown -->
    <div class="relative">
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
      class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      title={theme.isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {#if theme.isDark}
        <Sun size={14} />
      {:else}
        <Moon size={14} />
      {/if}
    </button>

    <!-- Performance monitor -->
    <div class="relative">
      <button
        onclick={() => { showPerfMenu = !showPerfMenu; }}
        class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        title={liveReport ? `${Math.round(liveReport.total_mb)} MB (PSS)` : "Performance"}
      >
        <CircleGauge size={14} />
      </button>
      {#if showPerfMenu}
        {#if !perfPinned}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="fixed inset-0 z-40"
            onclick={() => { showPerfMenu = false; }}
            onkeydown={(e) => { if (e.key === "Escape") showPerfMenu = false; }}
          ></div>
        {/if}
        <div class="absolute left-1/2 top-10 z-50 w-72 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-3 shadow-lg">
          <!-- RAM toggle + pin -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-[10px] uppercase tracking-wider">
              <button
                onclick={() => { perfLive = false; }}
                class={cn(
                  "transition-colors",
                  !perfLive ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground/70",
                )}
              >RAM SNAPSHOT</button>
              <span class="text-muted-foreground/30">|</span>
              <button
                onclick={() => { perfLive = true; }}
                class={cn(
                  "transition-colors",
                  perfLive ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground/70",
                )}
              >LIVE RAM</button>
            </div>
            <button
              onclick={() => { perfPinned = !perfPinned; }}
              class={cn(
                "flex h-5 w-5 items-center justify-center rounded transition-colors",
                perfPinned ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground",
              )}
              title={perfPinned ? "Unpin" : "Pin"}
            >
              {#if perfPinned}
                <Pin size={11} />
              {:else}
                <PinOff size={11} />
              {/if}
            </button>
          </div>
          <!-- RAM data -->
          {#if !perfLive && !snapshotReady}
            <div class="mt-2 text-xs text-muted-foreground">Snapshot in {snapshotCountdown}s...</div>
          {:else if displayReport && displayReport.processes.length > 0}
            <div class="mt-2 space-y-1.5">
              {#each displayReport.processes as proc}
                <div class="flex items-baseline justify-between">
                  <span class="text-xs text-muted-foreground">{proc.name}</span>
                  <span class="text-[11px] tabular-nums text-foreground">{proc.mb.toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB</span>
                </div>
              {/each}
              <div class="flex items-baseline justify-between">
                <span class="text-xs text-muted-foreground">Total</span>
                <span class="text-[11px] tabular-nums text-foreground">{displayReport.total_mb.toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB</span>
              </div>
            </div>
          {/if}
          <!-- Launch time -->
          {#if startupMs !== null}
            <div class="mx-0 my-3 h-px bg-border"></div>
            <div class="flex items-baseline justify-between">
              <span class="text-[10px] uppercase tracking-wider text-foreground">Launch time</span>
              <span class="text-[11px] tabular-nums text-foreground">{startupMs.toLocaleString("en")} ms</span>
            </div>
          {/if}
          <!-- Copy -->
          <div class="mx-0 my-3 h-px bg-border"></div>
          <button
            onclick={copyPerformanceData}
            class="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {#if copied}
              <Check size={12} />
              Copied
            {:else}
              <Copy size={12} />
              Copy all
            {/if}
          </button>
        </div>
      {/if}
    </div>

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
      class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      title="Reset database"
    >
      <Settings size={14} />
    </button>
  </div>

  <!-- Window controls -->
  <div class="flex items-center gap-0.5 pr-2">
    <button
      onclick={() => win.minimize()}
      class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      title="Minimize"
    >
      <Minus size={14} />
    </button>
    <button
      onclick={() => win.toggleMaximize()}
      class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
      class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-destructive hover:text-white"
      title="Close"
    >
      <X size={14} />
    </button>
  </div>
</div>

{#if showResetConfirm}
  <ConfirmDialog
    message="This will permanently delete all session blocks, tasks, and XP data."
    confirmLabel="Reset everything (Enter)"
    cancelLabel="Cancel (Esc)"
    onConfirm={confirmReset}
    onCancel={() => { showResetConfirm = false; }}
  />
{/if}

{#if showCloseConfirm}
  <ConfirmDialog
    message="All productivity features will stop working if you close the app."
    confirmLabel="Close anyway (Enter)"
    cancelLabel="Stay (Esc)"
    onConfirm={confirmClose}
    onCancel={cancelClose}
  />
{/if}

<style>
  .tab-indicator {
    transition: left 200ms cubic-bezier(0.16, 1, 0.3, 1), width 200ms cubic-bezier(0.16, 1, 0.3, 1);
  }
</style>
