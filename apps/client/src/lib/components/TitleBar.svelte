<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";
  import { getNavigation, type View } from "$lib/stores/navigation.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getZoom } from "$lib/stores/zoom.svelte";
  import { cn } from "$lib/utils";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import LayoutList from "@lucide/svelte/icons/layout-list";
  import CircleGauge from "@lucide/svelte/icons/circle-gauge";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Settings from "@lucide/svelte/icons/settings";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import Minus from "@lucide/svelte/icons/minus";
  import Square from "@lucide/svelte/icons/square";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { getThemeEditor } from "$lib/stores/themeEditor.svelte";
  import { getSettingsLauncher } from "$lib/stores/settingsLauncher.svelte";
  import type { StartupMemorySnapshot } from "$lib/components/perf/memoryReport";

  let {
    shellStartupMs = null,
    startupMemorySnapshot = { status: "pending" },
    ensureBenchmarkOverlay = async () => {},
  }: {
    shellStartupMs: number | null;
    startupMemorySnapshot: StartupMemorySnapshot;
    ensureBenchmarkOverlay?: () => Promise<void>;
  } = $props();

  const win = getCurrentWindow();
  const nav = getNavigation();
  const pomodoro = getPomodoro();
  const theme = getTheme();
  const zoom = getZoom();

  let isMaximized = $state(false);
  let showCloseConfirm = $state(false);
  let showPomodoroMenu = $state(false);
  let showResetConfirm = $state(false);
  let showPerfMenu = $state(false);
  const settingsLauncher = getSettingsLauncher();
  const themeEditor = getThemeEditor();
  let perfPinned = $state(false);

  type PerformancePopoverComponent = typeof import("$lib/components/perf/PerformancePopover.svelte").default;
  type SettingsModalComponent = typeof import("$lib/components/settings/SettingsModal.svelte").default;
  type FloatingThemeEditorComponent = typeof import("$lib/components/settings/FloatingThemeEditor.svelte").default;

  let PerformancePopover = $state<PerformancePopoverComponent | null>(null);
  let SettingsModal = $state<SettingsModalComponent | null>(null);
  let FloatingThemeEditor = $state<FloatingThemeEditorComponent | null>(null);
  let loadingPerformancePopover: Promise<void> | null = null;
  let loadingSettingsModal: Promise<void> | null = null;
  let loadingFloatingThemeEditor: Promise<void> | null = null;

  function loadPerformancePopover(): Promise<void> {
    if (PerformancePopover) return Promise.resolve();
    loadingPerformancePopover ??= import("$lib/components/perf/PerformancePopover.svelte")
      .then((module) => {
        PerformancePopover = module.default;
      })
      .finally(() => {
        loadingPerformancePopover = null;
      });
    return loadingPerformancePopover;
  }

  function loadSettingsModal(): Promise<void> {
    if (SettingsModal) return Promise.resolve();
    loadingSettingsModal ??= import("$lib/components/settings/SettingsModal.svelte")
      .then((module) => {
        SettingsModal = module.default;
      })
      .finally(() => {
        loadingSettingsModal = null;
      });
    return loadingSettingsModal;
  }

  function loadFloatingThemeEditor(): Promise<void> {
    if (FloatingThemeEditor) return Promise.resolve();
    loadingFloatingThemeEditor ??= import("$lib/components/settings/FloatingThemeEditor.svelte")
      .then((module) => {
        FloatingThemeEditor = module.default;
      })
      .finally(() => {
        loadingFloatingThemeEditor = null;
      });
    return loadingFloatingThemeEditor;
  }

  function togglePerfMenu() {
    showPerfMenu = !showPerfMenu;
    if (showPerfMenu) void loadPerformancePopover();
  }

  function openSettings() {
    settingsLauncher.open();
    void loadSettingsModal();
  }

  $effect(() => {
    if (settingsLauncher.isOpen) void loadSettingsModal();
  });

  $effect(() => {
    if (themeEditor.editingId) void loadFloatingThemeEditor();
  });

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
    // Best-effort rollback of any open theme edit so the vault does not
    // keep half-tuned colors after a forced quit. Debounced writes may not
    // flush before the process dies, so this is not a guarantee.
    if (themeEditor.editingId) void themeEditor.cancel();
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

  // While the floating theme editor is open, the buttons that would navigate
  // away from or disrupt the edit session (theme toggle flips base; settings
  // modal reopens behind the panel; help/reset are destructive or noisy) are
  // disabled. Window controls, pomodoro, and the performance monitor stay
  // live because they do not interfere with the edit session.
  const lockedByThemeEditor = $derived(!!themeEditor.editingId);

  const isActive = $derived(
    pomodoro.isRunning || pomodoro.remainingSeconds < pomodoro.totalSecondsForPhase,
  );

  const tabs: { view: View; label: string; icon: typeof CalendarDays }[] = [
    { view: "calendar", label: "Calendar", icon: CalendarDays },
    { view: "kanban", label: "Kanban", icon: LayoutList },
  ];

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
          zoom.zoomIn();
        } else if (e.key === "-") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          zoom.zoomOut();
        } else if (e.key === "0") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          zoom.reset();
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
  class="flex h-[42px] w-full shrink-0 select-none items-center bg-sidebar"
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
        <tab.icon size={14} strokeWidth={1.75} />
        <span>{tab.label}</span>
      </button>
    {/each}
  </div>

  <!-- Draggable spacer -->
  <div class="flex-1"></div>

  <!-- Utility buttons -->
  <div class="flex items-center gap-0.5">
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
      disabled={lockedByThemeEditor}
      class={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors",
        lockedByThemeEditor
          ? "cursor-not-allowed opacity-40"
          : "hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
      title={lockedByThemeEditor
        ? "Disabled while editing a theme"
        : theme.isDark
          ? "Switch to light mode"
          : "Switch to dark mode"}
    >
      {#if theme.isDark}
        <Sun size={14} strokeWidth={1.75} />
      {:else}
        <Moon size={14} strokeWidth={1.75} />
      {/if}
    </button>

    <!-- Performance monitor -->
    <div class="relative">
      <button
        onclick={togglePerfMenu}
        class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        title="Performance"
      >
        <CircleGauge size={14} strokeWidth={1.75} />
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
        {#if PerformancePopover}
          {@const Popover = PerformancePopover}
          <Popover
            {shellStartupMs}
            {startupMemorySnapshot}
            pinned={perfPinned}
            onPinnedChange={(nextPinned: boolean) => { perfPinned = nextPinned; }}
            {ensureBenchmarkOverlay}
          />
        {:else}
          <div
            class="absolute left-1/2 top-10 z-50 w-72 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-3 text-xs text-muted-foreground shadow-lg"
          >
            Loading...
          </div>
        {/if}
      {/if}
    </div>

    <!-- Reset database -->
    <button
      onclick={() => { showResetConfirm = true; }}
      disabled={lockedByThemeEditor}
      class={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors",
        lockedByThemeEditor
          ? "cursor-not-allowed opacity-40"
          : "hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
      title={lockedByThemeEditor ? "Disabled while editing a theme" : "Reset database"}
    >
      <CircleX size={14} strokeWidth={1.75} />
    </button>

    <!-- TODO: implement help panel -->
    <button
      onclick={() => {}}
      disabled={lockedByThemeEditor}
      class={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors",
        lockedByThemeEditor
          ? "cursor-not-allowed opacity-40"
          : "hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
      title={lockedByThemeEditor ? "Disabled while editing a theme" : "Help"}
    >
      <CircleHelp size={14} strokeWidth={1.75} />
    </button>

    <!-- Settings -->
    <button
      onclick={openSettings}
      disabled={lockedByThemeEditor}
      class={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors",
        lockedByThemeEditor
          ? "cursor-not-allowed opacity-40"
          : "hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
      title={lockedByThemeEditor ? "Disabled while editing a theme" : "Settings"}
    >
      <Settings size={14} strokeWidth={1.75} />
    </button>
  </div>

  <!-- Window controls -->
  <div class="flex items-center gap-0.5 pr-2">
    <button
      onclick={() => win.minimize()}
      class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      title="Minimize"
    >
      <Minus size={14} strokeWidth={1.75} />
    </button>
    <button
      onclick={() => win.toggleMaximize()}
      class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      title={isMaximized ? "Restore" : "Maximize"}
    >
      {#if isMaximized}
        <Minimize2 size={12.75} strokeWidth={1.75} />
      {:else}
        <Square size={12.75} strokeWidth={1.75} />
      {/if}
    </button>
    <button
      onclick={handleClose}
      class="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/70 dark:text-white transition-colors hover:bg-destructive hover:text-destructive-foreground"
      title="Close"
    >
      <X size={14} strokeWidth={1.75} />
    </button>
  </div>
</div>

{#if showResetConfirm}
  <ConfirmDialog
    title="Reset everything?"
    message="All data will be permanently deleted."
    confirmLabel="Reset everything (Enter)"
    cancelLabel="Cancel (Esc)"
    onConfirm={confirmReset}
    onCancel={() => { showResetConfirm = false; }}
  />
{/if}

{#if showCloseConfirm}
  <ConfirmDialog
    title="Close the app?"
    message="All productivity features will stop working."
    confirmLabel="Close anyway (Enter)"
    cancelLabel="Stay (Esc)"
    onConfirm={confirmClose}
    onCancel={cancelClose}
  />
{/if}

{#if settingsLauncher.isOpen}
  {#if SettingsModal}
    {@const Modal = SettingsModal}
    <Modal
      onClose={() => settingsLauncher.close()}
      initialSection={settingsLauncher.targetSection}
    />
  {/if}
{/if}

{#if themeEditor.editingId}
  {#if FloatingThemeEditor}
    {@const Editor = FloatingThemeEditor}
    <Editor
      onBackToList={() => {
        settingsLauncher.open("appearance");
        void loadSettingsModal();
      }}
    />
  {/if}
{/if}

<style>
  .tab-indicator {
    transition: left 200ms cubic-bezier(0.16, 1, 0.3, 1), width 200ms cubic-bezier(0.16, 1, 0.3, 1);
  }
</style>
