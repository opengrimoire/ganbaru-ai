<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getNavigation } from "$lib/stores/navigation.svelte";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getZoom } from "$lib/stores/zoom.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { getViewport } from "$lib/stores/viewport.svelte";
  import type { TitleBarControlId } from "$lib/stores/preferences";
  import { firstMainView, mainTabViews, type DetachableTabView } from "$lib/navigation";
  import { getDetachedWindows } from "$lib/stores/detached-windows.svelte";
  import {
    DETACHED_VIEW_DRAG_MIME,
    DETACHED_VIEW_REATTACH_REQUESTED_EVENT,
    detachableTabViewFromWindowLabel,
    focusMainWindow,
    isDetachedViewReattachRequest,
    notifyDetachedViewReattachRequested,
    notifyDetachedViewWindowChanged,
    openDetachedViewWindow,
    parseDetachedViewDragPayload,
    serializeDetachedViewDragPayload,
  } from "$lib/windows/detached";
  import { cn, isEditableKeyboardTarget } from "$lib/utils";
  import Calendar from "@lucide/svelte/icons/calendar";
  import Folder from "@lucide/svelte/icons/folder";
  import Book from "@lucide/svelte/icons/book";
  import CircleGauge from "@lucide/svelte/icons/circle-gauge";
  import ClockPlus from "@lucide/svelte/icons/clock-plus";
  import Coffee from "@lucide/svelte/icons/coffee";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Music from "@lucide/svelte/icons/music";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import PlayIcon from "@lucide/svelte/icons/play";
  import SkipBack from "@lucide/svelte/icons/skip-back";
  import SkipForward from "@lucide/svelte/icons/skip-forward";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import Settings from "@lucide/svelte/icons/settings";
  import Check from "@lucide/svelte/icons/check";
  import MoreHorizontal from "@lucide/svelte/icons/more-horizontal";
  import Minus from "@lucide/svelte/icons/minus";
  import Square from "@lucide/svelte/icons/square";
  import SquareArrowLeft from "@lucide/svelte/icons/square-arrow-left";
  import SquareArrowUpRight from "@lucide/svelte/icons/square-arrow-up-right";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import X from "@lucide/svelte/icons/x";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { getThemeEditor } from "$lib/stores/themeEditor.svelte";
  import { getSettingsLauncher } from "$lib/stores/settingsLauncher.svelte";
  import { getBenchmarkStatus } from "$lib/stores/benchmarkStatus.svelte";
  import type { StartupMemorySnapshot } from "$lib/components/perf/memoryReport";
  import type { SectionId } from "$lib/components/settings/types";
  import { formatShortcut, hasOnlyShortcutModifier } from "$lib/keyboard-shortcuts";
  import type { PlaybackStatus } from "$lib/music/playback";
  import {
    isCloseWindowShortcut,
    recordResetShortcutPress,
    type ResetShortcutSequenceState,
  } from "$lib/components/titlebar-shortcuts";

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
  const isMainWindow = win.label === "main";
  const detachedWindowView = detachableTabViewFromWindowLabel(win.label);
  const nav = getNavigation();
  const musicPlayer = getMusicPlayer();
  const pomodoro = getPomodoro();
  const theme = getTheme();
  const zoom = getZoom();
  const preferences = getPreferences();
  const viewport = getViewport();
  const detachedWindows = getDetachedWindows();
  const benchmarkStatus = getBenchmarkStatus();

  let isMaximized = $state(false);
  let showCloseConfirm = $state(false);
  let showPomodoroMenu = $state(false);
  let showResetSequenceConfirm = $state(false);
  let showResetConfirm = $state(false);
  let showPerfMenu = $state(false);
  let showTitleBarMenu = $state(false);
  let showTabContextMenu = $state(false);
  let showUtilityOverflowMenu = $state(false);
  let titleBarMenuStyle = $state("");
  let tabContextMenuStyle = $state("");
  let tabContextView = $state<DetachableTabView | null>(null);
  const settingsLauncher = getSettingsLauncher();
  const themeEditor = getThemeEditor();
  let perfPinned = $state(false);
  const lockedByBenchmark = $derived(benchmarkStatus.status !== "idle");

  type PerformancePopoverComponent = typeof import("$lib/components/perf/PerformancePopover.svelte").default;
  type SettingsModalComponent = typeof import("$lib/components/settings/SettingsModal.svelte").default;
  type FloatingThemeEditorComponent = typeof import("$lib/components/settings/FloatingThemeEditor.svelte").default;
  type ThemeQuickSwitcherComponent = typeof import("$lib/components/ThemeQuickSwitcher.svelte").default;

  let PerformancePopover = $state<PerformancePopoverComponent | null>(null);
  let SettingsModal = $state<SettingsModalComponent | null>(null);
  let FloatingThemeEditor = $state<FloatingThemeEditorComponent | null>(null);
  let ThemeQuickSwitcher = $state<ThemeQuickSwitcherComponent | null>(null);
  let loadingPerformancePopover: Promise<void> | null = null;
  let loadingSettingsModal: Promise<void> | null = null;
  let loadingFloatingThemeEditor: Promise<void> | null = null;
  let loadingThemeQuickSwitcher: Promise<void> | null = null;

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

  function loadThemeQuickSwitcher(): Promise<void> {
    if (ThemeQuickSwitcher) return Promise.resolve();
    loadingThemeQuickSwitcher ??= import("$lib/components/ThemeQuickSwitcher.svelte")
      .then((module) => {
        ThemeQuickSwitcher = module.default;
      })
      .finally(() => {
        loadingThemeQuickSwitcher = null;
      });
    return loadingThemeQuickSwitcher;
  }

  function togglePerfMenu() {
    showPerfMenu = !showPerfMenu;
    showPomodoroMenu = false;
    showUtilityOverflowMenu = false;
    if (showPerfMenu) void loadPerformancePopover();
  }

  function toggleTheme() {
    if (lockedByThemeEditor) return;
    showPomodoroMenu = false;
    showUtilityOverflowMenu = false;
    theme.toggle();
  }

  function toggleThemeFromShortcut() {
    if (lockedByThemeEditor) return;
    theme.toggle();
  }

  let showThemeQuickSwitcher = $state(false);

  function openThemeQuickSwitcher() {
    if (lockedByThemeEditor) return;
    if (!perfPinned) showPerfMenu = false;
    settingsLauncher.close();
    showPomodoroMenu = false;
    showTitleBarMenu = false;
    showUtilityOverflowMenu = false;
    showThemeQuickSwitcher = true;
    void loadThemeQuickSwitcher();
  }

  function openSettings(section?: SectionId) {
    showPomodoroMenu = false;
    showUtilityOverflowMenu = false;
    settingsLauncher.open(section);
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

  function activateOverflowControl(id: TitleBarControlId) {
    if (overflowControlDisabled(id)) return;
    showPomodoroMenu = false;
    showUtilityOverflowMenu = false;
    if (id === "theme") {
      theme.toggle();
    } else if (id === "performance") {
      togglePerfMenu();
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
    if (detachedWindowView) {
      detachedWindows.markAttached(detachedWindowView);
      try {
        await notifyDetachedViewWindowChanged({
          view: detachedWindowView,
          detached: false,
        });
      } catch (error) {
        console.error("Failed to publish detached window close:", error);
      }
      await win.destroy();
      return;
    }
    if (showResetSequenceConfirm || showResetConfirm) return;
    if (await benchmarkBlocksClose()) {
      void ensureBenchmarkOverlay();
      return;
    }
    if (showResetSequenceConfirm || showResetConfirm) return;
    showCloseConfirm = true;
  }

  function confirmClose() {
    if (lockedByBenchmark) {
      showCloseConfirm = false;
      void ensureBenchmarkOverlay();
      return;
    }
    showCloseConfirm = false;
    // Best-effort rollback of any open theme edit so the config does not
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
  // modal reopens behind the panel) are disabled. Window controls,
  // pomodoro, and the diagnostics monitor stay live because they do not
  // interfere with the edit session.
  const lockedByThemeEditor = $derived(!!themeEditor.editingId);

  const isActive = $derived(pomodoro.isActive);
  const pomodoroPauseResumeLabel = $derived(
    isActive && !pomodoro.isRunning ? "Resume focus" : "Pause focus",
  );
  const pomodoroPausedPulseActive = $derived(
    isActive &&
    pomodoro.phase === "focus" &&
    !pomodoro.isRunning &&
    !pomodoro.suspendedAway &&
    !pomodoro.idlePaused,
  );
  const pomodoroPausedPulseAmount = $derived.by(() => {
    const amount = pomodoro.pausedPulseAmount;
    if (amount === null) return "0%";
    return `${Math.round(amount * 100)}%`;
  });
  const pomodoroPausedPulseStyle = $derived(
    pomodoroPausedPulseActive
      ? `--pomodoro-ring-paused-pulse-amount: ${pomodoroPausedPulseAmount};`
      : undefined,
  );
  const phaseAdvanceLabel = $derived(
    isActive
      ? pomodoro.phase === "focus"
        ? "Go to break now"
        : "Start focus now"
      : "Go to break now",
  );
  const canPauseResumePomodoro = $derived(pomodoro.canPauseResume);
  const canAdvancePomodoro = $derived(isActive);
  const titleBarVolumeStep = 0.05;
  const titleBarVolumeSliderProgress = $derived(musicPlayer.volumeMax > 0
    ? `${Math.min(100, Math.max(0, (musicPlayer.volumeControlValue / musicPlayer.volumeMax) * 100))}%`
    : "0%");
  const musicStatusText = $derived.by(() => {
    const title = musicPlayer.currentSource ? musicPlayer.loadedTitle.trim() : "";
    if (title) return title;
    if (musicPlayer.currentSource || musicPlayer.snapshot.status !== "idle") {
      return musicStatusLabel(musicPlayer.snapshot.status);
    }
    return "No music loaded";
  });
  const canPlayPauseMusic = $derived(Boolean(musicPlayer.currentSource) && !musicPlayer.isBusy);
  const musicPlayPauseLabel = $derived(musicPlayer.isPlaying ? "Pause music" : "Play music");
  const musicVolumeTooltipLine = $derived(`Volume: ${musicPlayer.volumePercentLabel}`);
  const pomodoroButtonTooltip = $derived(
    `${isActive ? `${pomodoro.formattedTime} remaining` : "Pomodoro"}\n${musicVolumeTooltipLine}`,
  );
  const musicButtonTooltip = $derived(
    `Music (${formatShortcut("Mod + M")})\n${musicVolumeTooltipLine}`,
  );

  const tabs: { view: DetachableTabView; label: string; icon: typeof Calendar }[] = [
    { view: "calendar", label: "Calendar", icon: Calendar },
    { view: "projects", label: "Projects", icon: Folder },
    { view: "notes", label: "Notes", icon: Book },
  ];
  const visibleTabs = $derived.by(() => {
    if (detachedWindowView) {
      return tabs.filter((tab) => tab.view === detachedWindowView);
    }
    const visibleViews = new Set(mainTabViews(detachedWindows.views));
    return tabs.filter((tab) => visibleViews.has(tab.view));
  });

  const titleBarControls: { id: TitleBarControlId; label: string }[] = [
    { id: "pomodoro", label: "Pomodoro" },
    { id: "music", label: "Music" },
    { id: "theme", label: "Theme toggle" },
    { id: "performance", label: "Diagnostics" },
    { id: "settings", label: "Settings" },
  ];

  const TITLE_BAR_MENU_WIDTH = 224;
  const TAB_CONTEXT_MENU_MAX_WIDTH = 260;
  const MENU_EDGE_GAP = 8;
  const themeEditorLockedControlIds = new Set<TitleBarControlId>([
    "theme",
    "settings",
  ]);
  const TITLE_BAR_ICON_COLOR_CLASS = "text-foreground/68 dark:text-white/76";
  const TITLE_BAR_ICON_STROKE_CLASS = "stroke-foreground/68 dark:stroke-white/76";
  const TITLE_BAR_SUBTLE_STROKE_CLASS = "stroke-foreground/20 dark:stroke-white/20";
  const TITLE_BAR_ICON_STROKE_WIDTH = 1.5;
  const TITLE_BAR_ICON_SIZE = 14;
  const TITLE_BAR_MENU_ICON_SIZE = 14;
  const TITLE_BAR_MENU_ICON_STROKE_WIDTH = 1.8;
  const POMODORO_RING_SIZE = TITLE_BAR_ICON_SIZE + 0.5;
  const POMODORO_RING_STROKE_WIDTH = 2.15;
  const RESET_SHORTCUT_REQUIRED_PRESSES = 10;
  const RESET_SHORTCUT_WINDOW_MS = 8_000;
  let resetShortcutSequence = $state<ResetShortcutSequenceState>({
    pressCount: 0,
    lastPressAtMs: null,
  });
  let resetShortcutTimer: ReturnType<typeof setTimeout> | undefined;

  const autoCompactTabs = $derived(
    preferences.titleBarVisibility.compactTabs || viewport.below("regular"),
  );
  const activeTabOnly = $derived(viewport.below("narrow"));
  const compactOverflowIds = $derived.by(() => {
    const ids = new Set<TitleBarControlId>();
    if (viewport.below("regular")) {
      ids.add("theme");
      ids.add("performance");
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

  function clearResetShortcutSequence() {
    resetShortcutSequence = { pressCount: 0, lastPressAtMs: null };
    if (resetShortcutTimer) clearTimeout(resetShortcutTimer);
    resetShortcutTimer = undefined;
  }

  function registerResetShortcutPress(): boolean {
    if (lockedByBenchmark) {
      void ensureBenchmarkOverlay();
      return false;
    }
    if (lockedByThemeEditor) return false;
    if (resetShortcutTimer) clearTimeout(resetShortcutTimer);
    const result = recordResetShortcutPress(
      resetShortcutSequence,
      performance.now(),
      {
        requiredPresses: RESET_SHORTCUT_REQUIRED_PRESSES,
        maxGapMs: RESET_SHORTCUT_WINDOW_MS,
      },
    );
    resetShortcutSequence = result.state;
    if (result.resetTriggered) {
      clearResetShortcutSequence();
      showCloseConfirm = false;
      showResetConfirm = false;
      showResetSequenceConfirm = true;
      return true;
    }
    resetShortcutTimer = setTimeout(
      clearResetShortcutSequence,
      RESET_SHORTCUT_WINDOW_MS,
    );
    return false;
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
      clearResetShortcutSequence();
    };
  });

  $effect(() => {
    if (!detachedWindowView) return;
    let cleanup: UnlistenFn | undefined;
    listen<unknown>(DETACHED_VIEW_REATTACH_REQUESTED_EVENT, (event) => {
      if (
        isDetachedViewReattachRequest(event.payload)
        && event.payload.view === detachedWindowView
      ) {
        void reattachDetachedTab();
      }
    }).then((unlisten) => {
      cleanup = unlisten;
    }).catch((error) => {
      console.error("Failed to listen for detached tab reattach:", error);
    });
    return () => cleanup?.();
  });

  function handleModalKeydown(e: KeyboardEvent) {
    if (showPomodoroMenu && e.key === "Escape") {
      showPomodoroMenu = false;
      return;
    }

    if (showUtilityOverflowMenu && e.key === "Escape") {
      showUtilityOverflowMenu = false;
      return;
    }

    if (showTabContextMenu && e.key === "Escape") {
      showTabContextMenu = false;
      tabContextView = null;
      return;
    }

    if (showTitleBarMenu && e.key === "Escape") {
      showTitleBarMenu = false;
      return;
    }

    if (showPerfMenu && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      showPerfMenu = false;
      return;
    }

    if (e.key === "F1") {
      e.preventDefault();
      e.stopPropagation();
      if (!lockedByThemeEditor) openSettings("shortcuts");
      return;
    }

    if (hasOnlyShortcutModifier(e, { shift: true }) && e.key.toLowerCase() === "d") {
      if (isEditableKeyboardTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      togglePerfMenu();
      return;
    }
  }

  // Capture shell shortcuts early so focused views and modals cannot intercept them.
  $effect(() => {
    function handleGlobalShellShortcut(e: KeyboardEvent) {
      if (isCloseWindowShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const resetTriggered =
          e.shiftKey
          &&
          !e.repeat
          && !isEditableKeyboardTarget(e.target)
          && registerResetShortcutPress();
        if (!resetTriggered) {
          void handleClose();
        }
        return;
      }

      if (hasOnlyShortcutModifier(e, { shift: true }) && e.key.toLowerCase() === "l") {
        if (isEditableKeyboardTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        toggleThemeFromShortcut();
        return;
      }

      if (hasOnlyShortcutModifier(e, { shift: true }) && e.key.toLowerCase() === "t") {
        if (isEditableKeyboardTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        openThemeQuickSwitcher();
        return;
      }

      if (hasOnlyShortcutModifier(e)) {
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
    window.addEventListener("keydown", handleGlobalShellShortcut, { capture: true });
    return () => window.removeEventListener("keydown", handleGlobalShellShortcut, { capture: true });
  });

  let tabEls: HTMLButtonElement[] = $state([]);
  let indicatorStyle = $state("");
  let indicatorFrame = 0;

  function updateIndicator() {
    const idx = visibleTabs.findIndex((t) => t.view === nav.current);
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
    void visibleTabs;
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
    if (showPomodoroMenu) {
      handleTitleBarVolumeWheel(e);
      return;
    }
    e.preventDefault();
    if (tabWheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    if (visibleTabs.length === 0) return;
    tabWheelCooldown = true;
    const currentIndex = Math.max(0, visibleTabs.findIndex((t) => t.view === nav.current));
    const delta = e.deltaY > 0 ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(visibleTabs.length - 1, currentIndex + delta));
    if (nextIndex !== currentIndex) {
      nav.navigate(visibleTabs[nextIndex].view);
    }
    setTimeout(() => { tabWheelCooldown = false; }, 300);
  }

  function openTitleBarMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    showPomodoroMenu = false;
    showTabContextMenu = false;
    tabContextView = null;

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

  function openTabContextMenu(e: MouseEvent, view: DetachableTabView) {
    e.preventDefault();
    e.stopPropagation();
    showPomodoroMenu = false;
    showTitleBarMenu = false;
    showUtilityOverflowMenu = false;
    showTabContextMenu = true;
    tabContextView = view;

    const left = Math.min(
      Math.max(MENU_EDGE_GAP, e.clientX),
      Math.max(MENU_EDGE_GAP, window.innerWidth - TAB_CONTEXT_MENU_MAX_WIDTH - MENU_EDGE_GAP),
    );
    const top = Math.max(MENU_EDGE_GAP, e.clientY);
    tabContextMenuStyle = [
      `left: ${left}px`,
      `top: ${top}px`,
      "width: max-content",
      "min-width: 196px",
      `max-width: min(${TAB_CONTEXT_MENU_MAX_WIDTH}px, calc(100vw - ${MENU_EDGE_GAP * 2}px))`,
      `max-height: calc(100vh - ${top + MENU_EDGE_GAP}px)`,
    ].join("; ");
  }

  function detachedViewDragPayload(event: DragEvent): ReturnType<typeof parseDetachedViewDragPayload> {
    const transfer = event.dataTransfer;
    if (!transfer) return undefined;
    const customPayload = transfer.getData(DETACHED_VIEW_DRAG_MIME);
    if (customPayload) return parseDetachedViewDragPayload(customPayload);
    const plainPayload = transfer.getData("text/plain");
    return plainPayload ? parseDetachedViewDragPayload(plainPayload) : undefined;
  }

  function hasDetachedViewDragPayload(event: DragEvent): boolean {
    const types = Array.from(event.dataTransfer?.types ?? []);
    return types.includes(DETACHED_VIEW_DRAG_MIME);
  }

  function handleTabDragStart(event: DragEvent, view: DetachableTabView): void {
    if (!detachedWindowView || view !== detachedWindowView || !event.dataTransfer) return;
    const payload = serializeDetachedViewDragPayload(view, win.label);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DETACHED_VIEW_DRAG_MIME, payload);
    event.dataTransfer.setData("text/plain", payload);
  }

  function handleTitleBarDragOver(event: DragEvent): void {
    if (!isMainWindow || !hasDetachedViewDragPayload(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function handleTitleBarDrop(event: DragEvent): void {
    if (!isMainWindow) return;
    const payload = detachedViewDragPayload(event);
    if (!payload) return;
    event.preventDefault();
    event.stopPropagation();
    void requestDetachedTabReattach(payload.view);
  }

  async function moveTabToNewWindow(): Promise<void> {
    if (!tabContextView) return;
    const view = tabContextView;
    showTabContextMenu = false;
    tabContextView = null;
    try {
      await openDetachedViewWindow(view);
      detachedWindows.markDetached(view);
      if (nav.current === view) {
        nav.navigate(firstMainView(detachedWindows.views));
      }
    } catch (error) {
      console.error("Failed to move tab to a new window:", error);
    }
  }

  async function requestDetachedTabReattach(view: DetachableTabView): Promise<void> {
    detachedWindows.markAttached(view);
    nav.navigate(view);
    try {
      await notifyDetachedViewWindowChanged({ view, detached: false });
    } catch (error) {
      console.error("Failed to publish detached window restore:", error);
    }
    try {
      await notifyDetachedViewReattachRequested({ view });
    } catch (error) {
      console.error("Failed to request detached window restore:", error);
    }
  }

  async function reattachDetachedTab(): Promise<void> {
    if (!detachedWindowView) return;
    const view = detachedWindowView;
    detachedWindows.markAttached(view);
    try {
      await notifyDetachedViewWindowChanged({ view, detached: false });
    } catch (error) {
      console.error("Failed to publish detached window restore:", error);
    }
    try {
      await focusMainWindow();
    } catch (error) {
      console.error("Failed to focus main window after tab restore:", error);
    }
    await win.destroy();
  }

  function activateTabContextAction(): void {
    if (detachedWindowView) {
      showTabContextMenu = false;
      tabContextView = null;
      void reattachDetachedTab();
      return;
    }
    void moveTabToNewWindow();
  }

  function toggleTitleBarControl(id: TitleBarControlId) {
    preferences.toggleTitleBarControl(id);
    showTitleBarMenu = false;
  }

  function musicStatusLabel(status: PlaybackStatus): string {
    switch (status) {
      case "playing":
        return "Playing";
      case "paused":
        return "Paused";
      case "loading":
        return "Loading";
      case "ready":
        return "Ready";
      case "ended":
        return "Ended";
      case "error":
        return "Error";
      case "idle":
        return "Idle";
    }
    return "Idle";
  }

  function togglePomodoroMenu(): void {
    const nextOpen = !showPomodoroMenu;
    showPomodoroMenu = nextOpen;
    if (!nextOpen) return;
    showPerfMenu = false;
    showTitleBarMenu = false;
    showUtilityOverflowMenu = false;
  }

  function openMusicFromTitleBarMenu(): void {
    showPomodoroMenu = false;
    nav.navigate("music");
  }

  function snappedTitleBarVolume(value: number): number {
    if (!Number.isFinite(value)) return musicPlayer.volumeControlValue;
    return Number((Math.round(value / titleBarVolumeStep) * titleBarVolumeStep).toFixed(2));
  }

  function setTitleBarVolume(value: number): void {
    void musicPlayer.setVolume(snappedTitleBarVolume(value));
  }

  function handleTitleBarVolumeWheel(event: WheelEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey) return;
    const delta = event.deltaY === 0 ? -event.deltaX : event.deltaY;
    if (delta === 0) return;
    const direction = delta > 0 ? -1 : 1;
    setTitleBarVolume(musicPlayer.volumeControlValue + direction * titleBarVolumeStep);
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
  ondragover={handleTitleBarDragOver}
  ondrop={handleTitleBarDrop}
>
  <!-- Navigation tabs -->
  <div class="relative flex min-w-0 items-center gap-0.5 overflow-hidden pl-1.5">
    {#if indicatorStyle}
      <div
        class="tab-indicator absolute top-0 h-full rounded-md bg-background dark:bg-accent"
        style={indicatorStyle}
      ></div>
    {/if}
    {#each visibleTabs as tab, i}
      <button
        bind:this={tabEls[i]}
        onclick={() => nav.navigate(tab.view)}
        oncontextmenu={(e) => openTabContextMenu(e, tab.view)}
        draggable={!!detachedWindowView}
        ondragstart={(e) => handleTabDragStart(e, tab.view)}
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
          onclick={togglePomodoroMenu}
          onwheel={handleTitleBarVolumeWheel}
          class={cn(
            "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors",
            showPomodoroMenu ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
          )}
          title={pomodoroButtonTooltip}
          aria-haspopup="menu"
          aria-expanded={showPomodoroMenu}
        >
          <svg viewBox="0 0 20 20" width={POMODORO_RING_SIZE} height={POMODORO_RING_SIZE}>
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke-width={POMODORO_RING_STROKE_WIDTH}
              class={TITLE_BAR_SUBTLE_STROKE_CLASS}
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
                class={cn(
                  `${TITLE_BAR_ICON_COLOR_CLASS} ${TITLE_BAR_ICON_STROKE_CLASS} -rotate-90 origin-center`,
                  pomodoroPausedPulseActive ? "pomodoro-ring-paused-pulse" : "",
                )}
                style={pomodoroPausedPulseStyle}
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
            onwheel={handleTitleBarVolumeWheel}
          ></div>
          <div
            class="absolute right-0 top-9 z-50 w-60 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover py-1 shadow-lg"
            onwheel={handleTitleBarVolumeWheel}
          >
            {#if isActive}
              <div class="px-3 py-1.5 text-xs text-muted-foreground">
                {pomodoro.formattedTime} left
              </div>
            {:else}
              <div class="px-3 py-1.5 text-xs text-muted-foreground">
                No active session
              </div>
            {/if}
            <button
              onclick={() => {
                if (pomodoro.isRunning) {
                  pomodoro.pause();
                } else {
                  pomodoro.start();
                }
                showPomodoroMenu = false;
              }}
              disabled={!canPauseResumePomodoro}
              class={cn(
                "flex w-full items-center justify-between gap-4 whitespace-nowrap px-3 py-1.5 text-left text-sm transition-colors",
                canPauseResumePomodoro
                  ? "text-foreground hover:bg-accent"
                  : "cursor-not-allowed text-muted-foreground/50",
              )}
            >
              <span>{pomodoroPauseResumeLabel}</span>
              {#if isActive && !pomodoro.isRunning}
                <PlayIcon
                  class="shrink-0 opacity-70"
                  size={TITLE_BAR_MENU_ICON_SIZE}
                  strokeWidth={TITLE_BAR_MENU_ICON_STROKE_WIDTH}
                />
              {:else}
                <PauseIcon
                  class="shrink-0 opacity-70"
                  size={TITLE_BAR_MENU_ICON_SIZE}
                  strokeWidth={TITLE_BAR_MENU_ICON_STROKE_WIDTH}
                />
              {/if}
            </button>
            <button
              onclick={() => { pomodoro.addFocusTime(); showPomodoroMenu = false; }}
              disabled={!pomodoro.canAddFocusTime}
              class={cn(
                "flex w-full items-center justify-between gap-4 whitespace-nowrap px-3 py-1.5 text-left text-sm transition-colors",
                pomodoro.canAddFocusTime
                  ? "text-foreground hover:bg-accent"
                  : "cursor-not-allowed text-muted-foreground/50",
              )}
            >
              <span>Extend focus 3 minutes</span>
              <ClockPlus
                class="shrink-0 opacity-70"
                size={TITLE_BAR_MENU_ICON_SIZE}
                strokeWidth={TITLE_BAR_MENU_ICON_STROKE_WIDTH}
              />
            </button>
            <button
              onclick={() => { pomodoro.skip(); showPomodoroMenu = false; }}
              disabled={!canAdvancePomodoro}
              class={cn(
                "flex w-full items-center justify-between gap-4 whitespace-nowrap px-3 py-1.5 text-left text-sm transition-colors",
                canAdvancePomodoro
                  ? "text-foreground hover:bg-accent"
                  : "cursor-not-allowed text-muted-foreground/50",
              )}
            >
              <span>{phaseAdvanceLabel}</span>
              {#if pomodoro.phase === "focus" || !isActive}
                <Coffee
                  class="shrink-0 opacity-70"
                  size={TITLE_BAR_MENU_ICON_SIZE}
                  strokeWidth={TITLE_BAR_MENU_ICON_STROKE_WIDTH}
                />
              {:else}
                <PlayIcon
                  class="shrink-0 opacity-70"
                  size={TITLE_BAR_MENU_ICON_SIZE}
                  strokeWidth={TITLE_BAR_MENU_ICON_STROKE_WIDTH}
                />
              {/if}
            </button>
            {#if isMainWindow}
              <div class="mx-3 my-1.5 h-px bg-border"></div>
              <div class="px-3 pb-1.5 pt-2 text-xs text-muted-foreground">
                <span class="block truncate">{musicStatusText}</span>
              </div>
              <button
                onclick={() => { void musicPlayer.togglePlay(); showPomodoroMenu = false; }}
                disabled={!canPlayPauseMusic}
                class={cn(
                  "flex w-full items-center justify-between gap-4 whitespace-nowrap px-3 py-1.5 text-left text-sm transition-colors",
                  canPlayPauseMusic
                    ? "text-foreground hover:bg-accent"
                    : "cursor-not-allowed text-muted-foreground/50",
                )}
              >
                <span>{musicPlayPauseLabel}</span>
                {#if musicPlayer.isPlaying}
                  <PauseIcon
                    class="shrink-0 opacity-70"
                    size={TITLE_BAR_MENU_ICON_SIZE}
                    strokeWidth={TITLE_BAR_MENU_ICON_STROKE_WIDTH}
                  />
                {:else}
                  <PlayIcon
                    class="shrink-0 opacity-70"
                    size={TITLE_BAR_MENU_ICON_SIZE}
                    strokeWidth={TITLE_BAR_MENU_ICON_STROKE_WIDTH}
                  />
                {/if}
              </button>
              <button
                onclick={() => { void musicPlayer.playPreviousTrack(); showPomodoroMenu = false; }}
                disabled={!musicPlayer.canPlayPreviousTrack}
                class={cn(
                  "flex w-full items-center justify-between gap-4 whitespace-nowrap px-3 py-1.5 text-left text-sm transition-colors",
                  musicPlayer.canPlayPreviousTrack
                    ? "text-foreground hover:bg-accent"
                    : "cursor-not-allowed text-muted-foreground/50",
                )}
              >
                <span>Previous music</span>
                <SkipBack
                  class="shrink-0 opacity-70"
                  size={TITLE_BAR_MENU_ICON_SIZE}
                  strokeWidth={TITLE_BAR_MENU_ICON_STROKE_WIDTH}
                />
              </button>
              <button
                onclick={() => { void musicPlayer.playNextTrack(); showPomodoroMenu = false; }}
                disabled={!musicPlayer.canPlayNextTrack}
                class={cn(
                  "flex w-full items-center justify-between gap-4 whitespace-nowrap px-3 py-1.5 text-left text-sm transition-colors",
                  musicPlayer.canPlayNextTrack
                    ? "text-foreground hover:bg-accent"
                    : "cursor-not-allowed text-muted-foreground/50",
                )}
              >
                <span>Next music</span>
                <SkipForward
                  class="shrink-0 opacity-70"
                  size={TITLE_BAR_MENU_ICON_SIZE}
                  strokeWidth={TITLE_BAR_MENU_ICON_STROKE_WIDTH}
                />
              </button>
              <div class="flex items-center gap-3 px-3 py-2 text-sm text-foreground">
                <span class="shrink-0">Volume</span>
                <input
                  type="range"
                  min="0"
                  max={musicPlayer.volumeMax}
                  step={titleBarVolumeStep}
                  value={musicPlayer.volumeControlValue}
                  class="titlebar-volume-slider min-w-0 flex-1"
                  style={`--titlebar-volume-progress: ${titleBarVolumeSliderProgress};`}
                  aria-label="Music volume"
                  tabindex="-1"
                  oninput={(event) => { setTitleBarVolume(Number(event.currentTarget.value)); }}
                />
              </div>
              <button
                onclick={openMusicFromTitleBarMenu}
                class="flex w-full items-center justify-between gap-4 whitespace-nowrap px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent"
              >
                <span>Open music</span>
                <ExternalLink
                  class="shrink-0 opacity-70"
                  size={TITLE_BAR_MENU_ICON_SIZE}
                  strokeWidth={TITLE_BAR_MENU_ICON_STROKE_WIDTH}
                />
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    {#if isMainWindow && titleBarControlVisible("music")}
      <button
        type="button"
        onclick={() => nav.navigate("music")}
        onwheel={handleTitleBarVolumeWheel}
        class={cn(
          "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors",
          nav.current === "music"
            ? "bg-background text-foreground dark:bg-accent dark:text-white"
            : `${TITLE_BAR_ICON_COLOR_CLASS} hover:bg-sidebar-accent`,
        )}
        title={musicButtonTooltip}
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
            ? `Switch to light mode (${formatShortcut("Mod + Shift + L")})`
            : `Switch to dark mode (${formatShortcut("Mod + Shift + L")})`}
      >
        {#if theme.isDark}
          <Sun size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
        {:else}
          <Moon size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
        {/if}
      </button>
    {/if}

    <!-- Diagnostics monitor -->
    {#if titleBarControlVisible("performance")}
      <div class="relative">
        <button
          onclick={togglePerfMenu}
          class={cn(
            "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent",
            TITLE_BAR_ICON_COLOR_CLASS,
          )}
          title={`Diagnostics (${formatShortcut("Mod + Shift + D")})`}
        >
          <CircleGauge size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
        </button>
      </div>
    {/if}

    <!-- Settings -->
    {#if titleBarControlVisible("settings")}
      <button
        onclick={() => openSettings()}
        disabled={lockedByThemeEditor}
        class={cn(
          "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors",
          TITLE_BAR_ICON_COLOR_CLASS,
          lockedByThemeEditor
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-sidebar-accent",
        )}
        title={lockedByThemeEditor ? "Disabled while editing a theme" : `Settings (${formatShortcut("Mod + ,")})`}
        aria-label="Settings"
      >
        <Settings size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
      </button>
    {/if}

    {#if overflowActionControls.length > 0}
      <div class="relative">
        <button
          onclick={() => {
            showUtilityOverflowMenu = !showUtilityOverflowMenu;
            showPomodoroMenu = false;
            showPerfMenu = false;
          }}
          class={cn(
            "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent",
            TITLE_BAR_ICON_COLOR_CLASS,
          )}
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
      class={cn(
        "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent",
        TITLE_BAR_ICON_COLOR_CLASS,
      )}
      aria-label="Minimize"
      data-app-tooltip-disabled="true"
    >
      <Minus size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
    </button>
    <button
      onclick={() => win.toggleMaximize()}
      class={cn(
        "titlebar-icon-button flex items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent",
        TITLE_BAR_ICON_COLOR_CLASS,
      )}
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
      title={lockedByBenchmark
        ? "Disabled while a benchmark is active"
        : isMainWindow
          ? `Close app (${formatShortcut("Mod + Shift + W")})`
          : `Close window (${formatShortcut("Mod + Shift + W")})`}
      aria-label="Close"
    >
      <X size={TITLE_BAR_ICON_SIZE} strokeWidth={TITLE_BAR_ICON_STROKE_WIDTH} />
    </button>
  </div>
</div>

{@render performancePopover()}

{#if showTabContextMenu && tabContextView}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-40"
    onclick={() => { showTabContextMenu = false; tabContextView = null; }}
    oncontextmenu={(e) => { e.preventDefault(); showTabContextMenu = false; tabContextView = null; }}
  ></div>
  <div
    class="fixed z-50 overflow-hidden rounded-lg border border-border bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl"
    style={tabContextMenuStyle}
    role="menu"
  >
    <div class="p-1">
      <button
        role="menuitem"
        onclick={activateTabContextAction}
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-popover-foreground transition-colors hover:bg-accent"
      >
        {#if detachedWindowView}
          <SquareArrowLeft size={15} strokeWidth={2.2} />
          <span class="shrink-0 whitespace-nowrap">Move back to main window</span>
        {:else}
          <SquareArrowUpRight size={15} strokeWidth={2.2} />
          <span class="shrink-0 whitespace-nowrap">Move to new window</span>
        {/if}
      </button>
    </div>
  </div>
{/if}

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

{#if showResetSequenceConfirm}
  <ConfirmDialog
    title="Open reset confirmation?"
    message="You pressed the hidden reset shortcut 10 times. Continue only if you meant to erase the structured database"
    confirmLabel="Continue (Enter)"
    cancelLabel="Cancel (Esc)"
    onConfirm={() => {
      showResetSequenceConfirm = false;
      showResetConfirm = true;
    }}
    onCancel={() => { showResetSequenceConfirm = false; }}
  />
{/if}

{#if showResetConfirm}
  <ConfirmDialog
    title="Reset database?"
    message="The active Ganbaru AI folder's ganbaru-ai.sqlite file will be permanently deleted"
    confirmLabel="Reset database (Enter)"
    cancelLabel="Cancel (Esc)"
    onConfirm={confirmReset}
    onCancel={() => { showResetConfirm = false; }}
  />
{/if}

{#if showCloseConfirm}
  <ConfirmDialog
    title="Close the app?"
    message="All productivity features will stop working"
    confirmLabel="Close anyway (Enter)"
    cancelLabel="Stay (Esc)"
    onConfirm={confirmClose}
    onCancel={cancelClose}
  />
{/if}

{#if showThemeQuickSwitcher && ThemeQuickSwitcher}
  {@const Switcher = ThemeQuickSwitcher}
  <Switcher onClose={() => { showThemeQuickSwitcher = false; }} />
{/if}

{#if settingsLauncher.isOpen}
  {#if SettingsModal}
    {@const Modal = SettingsModal}
    <Modal
      onClose={() => settingsLauncher.close()}
      initialSection={settingsLauncher.targetSection}
      initialDoomscrollingTab={settingsLauncher.targetDoomscrollingTab}
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

  .pomodoro-ring-paused-pulse {
    stroke: color-mix(
      in srgb,
      color-mix(in srgb, currentColor 30%, transparent)
        var(--pomodoro-ring-paused-pulse-amount, 0%),
      currentColor
    );
  }

  @media (prefers-reduced-motion: reduce) {
    .pomodoro-ring-paused-pulse {
      stroke: color-mix(in srgb, currentColor 50%, transparent);
    }
  }

  :global(html[data-focus-intent="keyboard"]) .titlebar-tab:focus {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--ring);
  }

  .titlebar-volume-slider {
    --titlebar-volume-thumb-size: 0.5rem;
    --titlebar-volume-track-height: 0.125rem;
    --titlebar-volume-track-color: color-mix(in srgb, var(--foreground) 18%, transparent);
    --titlebar-volume-fill-color: color-mix(in srgb, var(--foreground) 58%, transparent);

    height: var(--titlebar-volume-thumb-size);
    appearance: none;
    cursor: pointer;
    background:
      linear-gradient(
        to right,
        var(--titlebar-volume-fill-color) 0%,
        var(--titlebar-volume-fill-color) var(--titlebar-volume-progress),
        var(--titlebar-volume-track-color) var(--titlebar-volume-progress),
        var(--titlebar-volume-track-color) 100%
      )
      center / calc(100% - var(--titlebar-volume-thumb-size)) var(--titlebar-volume-track-height) no-repeat;
  }

  .titlebar-volume-slider::-webkit-slider-runnable-track {
    height: var(--titlebar-volume-track-height);
    border-radius: 999px;
    background: transparent;
  }

  .titlebar-volume-slider::-webkit-slider-thumb {
    width: var(--titlebar-volume-thumb-size);
    height: var(--titlebar-volume-thumb-size);
    margin-top: calc((var(--titlebar-volume-track-height) - var(--titlebar-volume-thumb-size)) / 2);
    appearance: none;
    border: 0;
    border-radius: 999px;
    background: var(--foreground);
  }

  .titlebar-volume-slider::-moz-range-track,
  .titlebar-volume-slider::-moz-range-progress {
    height: var(--titlebar-volume-track-height);
    border-radius: 999px;
    background: transparent;
  }

  .titlebar-volume-slider::-moz-range-thumb {
    width: var(--titlebar-volume-thumb-size);
    height: var(--titlebar-volume-thumb-size);
    border: 0;
    border-radius: 999px;
    background: var(--foreground);
  }
</style>
