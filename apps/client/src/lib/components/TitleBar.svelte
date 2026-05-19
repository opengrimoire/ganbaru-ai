<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";
  import { getNavigation, type View } from "$lib/stores/navigation.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getZoom } from "$lib/stores/zoom.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { getViewport } from "$lib/stores/viewport.svelte";
  import type { TitleBarControlId } from "$lib/stores/preferences";
  import { cn, isEditableKeyboardTarget } from "$lib/utils";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import LayoutList from "@lucide/svelte/icons/layout-list";
  import CircleGauge from "@lucide/svelte/icons/circle-gauge";
  import Music from "@lucide/svelte/icons/music";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Settings from "@lucide/svelte/icons/settings";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import Check from "@lucide/svelte/icons/check";
  import MoreHorizontal from "@lucide/svelte/icons/more-horizontal";
  import Minus from "@lucide/svelte/icons/minus";
  import Square from "@lucide/svelte/icons/square";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { getThemeEditor } from "$lib/stores/themeEditor.svelte";
  import { getSettingsLauncher } from "$lib/stores/settingsLauncher.svelte";
  import { getBenchmarkStatus } from "$lib/stores/benchmarkStatus.svelte";
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
  const preferences = getPreferences();
  const viewport = getViewport();
  const benchmarkStatus = getBenchmarkStatus();

  let isMaximized = $state(false);
  let showCloseConfirm = $state(false);
  let showPomodoroMenu = $state(false);
  let showResetConfirm = $state(false);
  let showPerfMenu = $state(false);
  let showTitleBarMenu = $state(false);
  let showUtilityOverflowMenu = $state(false);
  let titleBarMenuStyle = $state("");
  const settingsLauncher = getSettingsLauncher();
  const themeEditor = getThemeEditor();
  let perfPinned = $state(false);
  const lockedByBenchmark = $derived(benchmarkStatus.status !== "idle");

  type PerformancePopoverComponent = typeof import("$lib/components/perf/PerformancePopover.svelte").default;
  type SettingsModalComponent = typeof import("$lib/components/settings/SettingsModal.svelte").default;
  type FloatingThemeEditorComponent = typeof import("$lib/components/settings/FloatingThemeEditor.svelte").default;
  type HelpShortcutsModalComponent = typeof import("$lib/components/HelpShortcutsModal.svelte").default;

  let PerformancePopover = $state<PerformancePopoverComponent | null>(null);
  let SettingsModal = $state<SettingsModalComponent | null>(null);
  let FloatingThemeEditor = $state<FloatingThemeEditorComponent | null>(null);
  let HelpShortcutsModal = $state<HelpShortcutsModalComponent | null>(null);
  let loadingPerformancePopover: Promise<void> | null = null;
  let loadingSettingsModal: Promise<void> | null = null;
  let loadingFloatingThemeEditor: Promise<void> | null = null;
  let loadingHelpShortcutsModal: Promise<void> | null = null;

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

  function loadHelpShortcutsModal(): Promise<void> {
    if (HelpShortcutsModal) return Promise.resolve();
    loadingHelpShortcutsModal ??= import("$lib/components/HelpShortcutsModal.svelte")
      .then((module) => {
        HelpShortcutsModal = module.default;
      })
      .finally(() => {
        loadingHelpShortcutsModal = null;
      });
    return loadingHelpShortcutsModal;
  }

  function togglePerfMenu() {
    showPerfMenu = !showPerfMenu;
    showUtilityOverflowMenu = false;
    if (showPerfMenu) void loadPerformancePopover();
  }

  function toggleTheme() {
    if (lockedByThemeEditor) return;
    showUtilityOverflowMenu = false;
    theme.toggle();
  }

  function openSettings() {
    showUtilityOverflowMenu = false;
    settingsLauncher.open();
    void loadSettingsModal();
  }

  let showHelpShortcuts = $state(false);

  function openHelpShortcuts() {
    showUtilityOverflowMenu = false;
    showHelpShortcuts = true;
    void loadHelpShortcutsModal();
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

  function activateOverflowControl(id: TitleBarControlId) {
    if (overflowControlDisabled(id)) return;
    showUtilityOverflowMenu = false;
    if (id === "theme") {
      theme.toggle();
    } else if (id === "performance") {
      togglePerfMenu();
    } else if (id === "reset") {
      showResetConfirm = true;
    } else if (id === "help") {
      openHelpShortcuts();
    } else if (id === "settings") {
      openSettings();
    }
  }

  async function benchmarkBlocksClose(): Promise<boolean> {
    if (lockedByBenchmark) return true;
    try {
      return (await invoke<string | null>("read_benchmark_state")) !== null;
    } catch {
      return false;
    }
  }

  async function handleClose() {
    if (await benchmarkBlocksClose()) {
      void ensureBenchmarkOverlay();
      return;
    }
    showCloseConfirm = true;
  }

  function confirmClose() {
    if (lockedByBenchmark) {
      showCloseConfirm = false;
      void ensureBenchmarkOverlay();
      return;
    }
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
    { view: "todo", label: "To-do", icon: LayoutList },
  ];

  const titleBarControls: { id: TitleBarControlId; label: string }[] = [
    { id: "pomodoro", label: "Pomodoro" },
    { id: "music", label: "Music" },
    { id: "theme", label: "Theme toggle" },
    { id: "performance", label: "Performance" },
    { id: "reset", label: "Reset database" },
    { id: "help", label: "Help" },
    { id: "settings", label: "Settings" },
  ];

  const TITLE_BAR_MENU_WIDTH = 224;
  const MENU_EDGE_GAP = 8;
  const themeEditorLockedControlIds = new Set<TitleBarControlId>([
    "theme",
    "reset",
    "help",
    "settings",
  ]);
  const TITLE_BAR_ICON_COLOR_CLASS = "text-foreground/68 dark:text-white/76";
  const TITLE_BAR_ICON_STROKE_WIDTH = 1.5;
  const TITLE_BAR_ICON_SIZE = 14;
  const POMODORO_RING_SIZE = 16;
  const POMODORO_RING_STROKE_WIDTH = 2.15;

  const autoCompactTabs = $derived(
    preferences.titleBarVisibility.compactTabs || viewport.below("regular"),
  );
  const activeTabOnly = $derived(viewport.below("narrow"));
  const compactOverflowIds = $derived.by(() => {
    const ids = new Set<TitleBarControlId>();
    if (viewport.below("regular")) {
      ids.add("theme");
      ids.add("performance");
      ids.add("reset");
      ids.add("help");
    }
    return ids;
  });
  const overflowActionControls = $derived(
    titleBarControls.filter((control) =>
      control.id !== "compactTabs"
      && preferences.titleBarVisibility[control.id]
      && compactOverflowIds.has(control.id),
    ),
  );
  function titleBarControlVisible(id: TitleBarControlId): boolean {
    return preferences.titleBarVisibility[id] && !compactOverflowIds.has(id);
  }

  function overflowControlDisabled(id: TitleBarControlId): boolean {
    return lockedByThemeEditor && themeEditorLockedControlIds.has(id);
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
      void handleClose();
    }).then((unlisten) => {
      cleanupClose = unlisten;
    });
    return () => {
      cleanupResize?.();
      cleanupClose?.();
    };
  });

  function handleModalKeydown(e: KeyboardEvent) {
    if (showUtilityOverflowMenu && e.key === "Escape") {
      showUtilityOverflowMenu = false;
      return;
    }

    if (showTitleBarMenu && e.key === "Escape") {
      showTitleBarMenu = false;
      return;
    }

    if (e.key === "F1") {
      e.preventDefault();
      e.stopPropagation();
      if (!lockedByThemeEditor) openHelpShortcuts();
      return;
    }

    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "l") {
      if (isEditableKeyboardTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      toggleTheme();
      return;
    }

    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "p") {
      if (isEditableKeyboardTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      togglePerfMenu();
      return;
    }

    if (e.ctrlKey && e.shiftKey && e.key === "W") {
      e.preventDefault();
      e.stopPropagation();
      if (lockedByBenchmark) {
        void ensureBenchmarkOverlay();
        return;
      }
      void handleClose();
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
  let indicatorFrame = 0;

  function updateIndicator() {
    const idx = tabs.findIndex((t) => t.view === nav.current);
    const el = tabEls[idx];
    if (!el) {
      indicatorStyle = "";
      return;
    }
    const parent = el.parentElement;
    if (!parent) {
      indicatorStyle = "";
      return;
    }
    const parentRect = parent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    indicatorStyle = `left: ${elRect.left - parentRect.left}px; width: ${elRect.width}px;`;
  }

  function scheduleIndicatorUpdate() {
    if (indicatorFrame) cancelAnimationFrame(indicatorFrame);
    indicatorFrame = requestAnimationFrame(() => {
      indicatorFrame = 0;
      updateIndicator();
    });
  }

  $effect(() => {
    void nav.current;
    void autoCompactTabs;
    void activeTabOnly;
    void preferences.fontFamilyId;
    void preferences.fontScale;
    scheduleIndicatorUpdate();
    return () => {
      if (indicatorFrame) {
        cancelAnimationFrame(indicatorFrame);
        indicatorFrame = 0;
      }
    };
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

  function openTitleBarMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const left = Math.min(
      Math.max(MENU_EDGE_GAP, e.clientX),
      Math.max(MENU_EDGE_GAP, window.innerWidth - TITLE_BAR_MENU_WIDTH - MENU_EDGE_GAP),
    );
    const top = Math.max(MENU_EDGE_GAP, e.clientY);
    titleBarMenuStyle = [
      `left: ${left}px`,
      `top: ${top}px`,
      `width: ${TITLE_BAR_MENU_WIDTH}px`,
      `max-height: calc(100vh - ${top + MENU_EDGE_GAP}px)`,
    ].join("; ");
    showTitleBarMenu = true;
  }

  function toggleTitleBarControl(id: TitleBarControlId) {
    preferences.toggleTitleBarControl(id);
    showTitleBarMenu = false;
  }
</script>

<svelte:window onkeydown={handleModalKeydown} />

{#snippet performancePopover()}
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
        class="fixed z-50 overflow-hidden rounded-lg border border-border bg-popover px-3 py-3 text-xs text-muted-foreground shadow-lg"
        style="top: calc(var(--titlebar-h) + 4px); right: 8px; width: min(18rem, calc(100vw - 16px)); max-height: calc(100dvh - var(--titlebar-h) - 12px);"
      >
        Loading...
      </div>
    {/if}
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-tauri-drag-region
  class="flex w-full shrink-0 select-none items-center bg-sidebar"
  style="height: var(--titlebar-h);"
  onwheel={handleTabWheel}
  oncontextmenu={openTitleBarMenu}
>
  <!-- Navigation tabs -->
  <div class="relative flex min-w-0 items-center gap-0.5 overflow-hidden pl-1.5">
    {#if indicatorStyle}
      <div
        class="tab-indicator absolute top-0 h-full rounded-md bg-background dark:bg-accent"
        style="{indicatorStyle} box-shadow: 0 0 0 1px {theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)'};"
      ></div>
    {/if}
    {#each tabs as tab, i}
      <button
        bind:this={tabEls[i]}
        onclick={() => nav.navigate(tab.view)}
        class={cn(
          "titlebar-tab relative z-1 flex items-center rounded-md text-sm font-medium transition-colors",
          activeTabOnly && nav.current !== tab.view ? "hidden" : "",
          autoCompactTabs
            ? "titlebar-tab-compact justify-center"
            : "gap-1.5 px-3",
          nav.current === tab.view
            ? "text-foreground dark:text-white"
            : "text-sidebar-foreground dark:text-white/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
        title={`${tab.label} (Alt+${i + 1})`}
      >
        <tab.icon size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
        {#if !autoCompactTabs}
          <span>{tab.label}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Draggable spacer -->
  <div class="flex-1"></div>

  <!-- Utility buttons -->
  <div class="flex shrink-0 items-center gap-0.5">
    <!-- Pomodoro progress ring with dropdown -->
    {#if titleBarControlVisible("pomodoro")}
      <div class="relative">
        <button
          onclick={() => { showPomodoroMenu = !showPomodoroMenu; }}
          class="titlebar-icon-button flex items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent"
          title={pomodoro.isRunning ? `${pomodoro.formattedTime} remaining` : "Pomodoro"}
        >
          <svg viewBox="0 0 20 20" width={POMODORO_RING_SIZE} height={POMODORO_RING_SIZE}>
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke-width={POMODORO_RING_STROKE_WIDTH}
              class={isActive ? "stroke-foreground/20 dark:stroke-white/20" : "stroke-foreground/15 dark:stroke-white/15"}
            />
            {#if isActive}
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke-width={POMODORO_RING_STROKE_WIDTH}
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
    {/if}

    {#if titleBarControlVisible("music")}
      <button
        type="button"
        onclick={() => nav.navigate("music")}
        class={cn(
          "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors",
          nav.current === "music"
            ? "bg-background text-foreground dark:bg-accent dark:text-white"
            : `${TITLE_BAR_ICON_COLOR_CLASS} hover:bg-sidebar-accent`,
        )}
        title="Music (Ctrl + M)"
        aria-label="Music"
      >
        <Music size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
      </button>
    {/if}

    <!-- Theme toggle -->
    {#if titleBarControlVisible("theme")}
      <button
        onclick={toggleTheme}
        disabled={lockedByThemeEditor}
        class={cn(
          "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors",
          TITLE_BAR_ICON_COLOR_CLASS,
          lockedByThemeEditor
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-sidebar-accent",
        )}
        title={lockedByThemeEditor
          ? "Disabled while editing a theme"
          : theme.isDark
            ? "Switch to light mode (Ctrl + Shift + L)"
            : "Switch to dark mode (Ctrl + Shift + L)"}
      >
        {#if theme.isDark}
          <Sun size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
        {:else}
          <Moon size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
        {/if}
      </button>
    {/if}

    <!-- Performance monitor -->
    {#if titleBarControlVisible("performance")}
      <div class="relative">
        <button
          onclick={togglePerfMenu}
          class="titlebar-icon-button flex items-center justify-center rounded-lg text-foreground/68 dark:text-white/76 transition-colors hover:bg-sidebar-accent"
          title="Performance (Ctrl + Shift + P)"
        >
          <CircleGauge size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
        </button>
      </div>
    {/if}

    <!-- Reset database -->
    {#if titleBarControlVisible("reset")}
      <button
        onclick={() => { showResetConfirm = true; }}
        disabled={lockedByThemeEditor}
        class={cn(
          "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors",
          TITLE_BAR_ICON_COLOR_CLASS,
          lockedByThemeEditor
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-sidebar-accent",
        )}
        title={lockedByThemeEditor ? "Disabled while editing a theme" : "Reset database"}
      >
        <CircleX size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
      </button>
    {/if}

    {#if titleBarControlVisible("help")}
      <button
        onclick={openHelpShortcuts}
        disabled={lockedByThemeEditor}
        class={cn(
          "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors",
          TITLE_BAR_ICON_COLOR_CLASS,
          lockedByThemeEditor
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-sidebar-accent",
        )}
        title={lockedByThemeEditor ? "Disabled while editing a theme" : "Help (F1 key)"}
        aria-label="Help"
      >
        <CircleHelp size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
      </button>
    {/if}

    <!-- Settings -->
    {#if titleBarControlVisible("settings")}
      <button
        onclick={openSettings}
        disabled={lockedByThemeEditor}
        class={cn(
          "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors",
          TITLE_BAR_ICON_COLOR_CLASS,
          lockedByThemeEditor
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-sidebar-accent",
        )}
        title={lockedByThemeEditor ? "Disabled while editing a theme" : "Settings (Ctrl + ,)"}
        aria-label="Settings"
      >
        <Settings size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
      </button>
    {/if}

    {#if overflowActionControls.length > 0}
      <div class="relative">
        <button
          onclick={() => { showUtilityOverflowMenu = !showUtilityOverflowMenu; showPerfMenu = false; }}
          class="titlebar-icon-button flex items-center justify-center rounded-lg text-foreground/68 dark:text-white/76 transition-colors hover:bg-sidebar-accent"
          aria-label="More controls"
          data-app-tooltip-disabled="true"
        >
          <MoreHorizontal size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
        </button>
        {#if showUtilityOverflowMenu}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="fixed inset-0 z-40"
            onclick={() => { showUtilityOverflowMenu = false; }}
            onkeydown={(e) => { if (e.key === "Escape") showUtilityOverflowMenu = false; }}
          ></div>
          <div class="absolute right-0 top-9 z-50 min-w-40 rounded-lg border border-border bg-popover py-1 shadow-lg">
            {#each overflowActionControls as control}
              {@const disabled = overflowControlDisabled(control.id)}
              <button
                onclick={() => activateOverflowControl(control.id)}
                {disabled}
                class={cn(
                  "flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors",
                  disabled
                    ? "cursor-not-allowed text-muted-foreground/50"
                    : "text-foreground hover:bg-accent",
                )}
              >
                {control.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Window controls -->
  <div class="flex shrink-0 items-center gap-0.5 pr-1.5">
    <button
      onclick={() => win.minimize()}
      class="titlebar-icon-button flex items-center justify-center rounded-lg text-foreground/68 dark:text-white/76 transition-colors hover:bg-sidebar-accent"
      aria-label="Minimize"
      data-app-tooltip-disabled="true"
    >
      <Minus size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
    </button>
    <button
      onclick={() => win.toggleMaximize()}
      class="titlebar-icon-button flex items-center justify-center rounded-lg text-foreground/68 dark:text-white/76 transition-colors hover:bg-sidebar-accent"
      aria-label={isMaximized ? "Restore" : "Maximize"}
      data-app-tooltip-disabled="true"
    >
      {#if isMaximized}
        <Minimize2 size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
      {:else}
        <Square size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
      {/if}
    </button>
    <button
      onclick={handleClose}
      disabled={lockedByBenchmark}
      class={cn(
        "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors",
        TITLE_BAR_ICON_COLOR_CLASS,
        lockedByBenchmark
          ? "cursor-not-allowed opacity-40"
          : "hover:bg-destructive hover:text-destructive-foreground",
      )}
      title={lockedByBenchmark ? "Disabled while a benchmark is active" : "Close app (Ctrl + Shift + W)"}
      aria-label="Close"
    >
      <X size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
    </button>
  </div>
</div>

{@render performancePopover()}

{#if showTitleBarMenu}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40"
    onclick={() => { showTitleBarMenu = false; }}
    oncontextmenu={(e) => { e.preventDefault(); showTitleBarMenu = false; }}
  ></div>
  <div
    class="fixed z-50 overflow-hidden rounded-lg border border-border bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl"
    style={titleBarMenuStyle}
    role="menu"
  >
    <div class="p-1">
      {#each titleBarControls as control}
        {@const checked = preferences.titleBarVisibility[control.id]}
        <button
          role="menuitemcheckbox"
          aria-checked={checked}
          onclick={() => toggleTitleBarControl(control.id)}
          class={cn(
            "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors",
            checked
              ? "text-popover-foreground hover:bg-accent"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <span class="flex size-5 shrink-0 items-center justify-center text-primary">
            {#if checked}
              <Check size={15} strokeWidth={2.4} />
            {/if}
          </span>
          <span class="min-w-0 flex-1 truncate">{control.label}</span>
        </button>
      {/each}
      <div class="my-1 h-px bg-border/80"></div>
      <button
        role="menuitemcheckbox"
        aria-checked={preferences.titleBarVisibility.compactTabs}
        onclick={() => toggleTitleBarControl("compactTabs")}
        class={cn(
          "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors",
          preferences.titleBarVisibility.compactTabs
            ? "text-popover-foreground hover:bg-accent"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <span class="flex size-5 shrink-0 items-center justify-center text-primary">
          {#if preferences.titleBarVisibility.compactTabs}
            <Check size={15} strokeWidth={2.4} />
          {/if}
        </span>
        <span class="min-w-0 flex-1 truncate">Compact tabs</span>
      </button>
    </div>
  </div>
{/if}

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

{#if showHelpShortcuts && HelpShortcutsModal}
  {@const ShortcutsModal = HelpShortcutsModal}
  <ShortcutsModal onClose={() => { showHelpShortcuts = false; }} />
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
  .titlebar-tab {
    height: 32px;
  }

  .titlebar-tab-compact,
  .titlebar-icon-button {
    width: 32px;
  }

  .titlebar-icon-button {
    height: 32px;
  }

  .tab-indicator {
    transition: none;
  }

  :global(html[data-focus-intent="keyboard"]) .titlebar-tab:focus {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--ring);
  }
</style>
