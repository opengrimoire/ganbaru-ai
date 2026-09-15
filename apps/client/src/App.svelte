<script lang="ts">
  import { getNavigation } from "$lib/stores/navigation.svelte";
  import {
    firstMainView,
    isDetachableTabView,
    mainTabViews,
    type DetachableTabView,
  } from "$lib/navigation";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";
  import { getDoomscrollingDesktopBlocker } from "$lib/stores/doomscrolling-desktop-blocker.svelte";
  import { getDoomscrollingUsage } from "$lib/stores/doomscrolling-usage.svelte";
  import { getMusicPlayer } from "$lib/stores/music-player.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getNotes } from "$lib/stores/notes.svelte";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { getChat } from "$lib/stores/chat.svelte";
  import { getZoom } from "$lib/stores/zoom.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { getSettingsLauncher } from "$lib/stores/settingsLauncher.svelte";
  import { getUpdateManager } from "$lib/stores/updates.svelte";
  import { UPDATE_AUTO_CHECK_INTERVAL_MS } from "$lib/stores/updates";
  import { getViewport } from "$lib/stores/viewport.svelte";
  import { getDetachedWindows } from "$lib/stores/detached-windows.svelte";
  import { createPomodoroCalendarScheduler } from "$lib/stores/pomodoro-calendar-scheduler";
  import {
    classifyPomodoroCompletion,
    type PomodoroCompletionKind,
  } from "$lib/stores/pomodoro-completion";
  import { parseNotesLinkHash } from "$lib/notes/block-link";
  import {
    listPendingNotesMentionNotifications,
    markNotesMentionNotificationsDelivered,
  } from "$lib/api/notes";
  import { getNotesNotificationSchedule } from "$lib/notes/notification-schedule.svelte";
  import type {
    NotesMentionNotification,
    NotesMentionNotificationKind,
  } from "$lib/notes/types";
  import { detachableTabViewFromWindowLabel } from "$lib/windows/detached";
  import { ensureDbUrl } from "$lib/api/db";
  import { APP_SOUND_IDS, playAppSound, type AppSoundId } from "$lib/app-sounds";
  import "$lib/stores/app-session";
  import type { CalendarEvent } from "$lib/components/calendar/types";
  import { Temporal } from "@js-temporal/polyfill";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { hasOnlyShortcutModifier, hasShortcutModifier } from "$lib/keyboard-shortcuts";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import WindowResizeHandles from "$lib/components/WindowResizeHandles.svelte";
  import CalendarView from "$lib/components/calendar/CalendarView.svelte";
  import CompletionOverlay from "$lib/components/pomodoro/CompletionOverlay.svelte";
  import MusicPlaybackHost from "$lib/components/music/MusicPlaybackHost.svelte";
  import MusicContextCoordinator from "$lib/components/music/MusicContextCoordinator.svelte";
  import MusicSoundscapeCoordinator from "$lib/components/music/MusicSoundscapeCoordinator.svelte";
  import NotesView from "$lib/components/notes/NotesView.svelte";
  import ProjectsView from "$lib/components/projects/ProjectsView.svelte";
  import ProjectDashboardView from "$lib/components/projects/ProjectDashboardView.svelte";
  import ProjectGanttView from "$lib/components/projects/ProjectGanttView.svelte";
  import ProjectKanbanView from "$lib/components/projects/ProjectKanbanView.svelte";
  import ProjectListView from "$lib/components/projects/ProjectListView.svelte";
  import type { ProjectDesktopViewComponents } from "$lib/components/projects/project-desktop-view-components";
  import ChatWorkspace from "$lib/components/chat/ChatWorkspace.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import TooltipHost from "$lib/components/ui/TooltipHost.svelte";
  import UpdateNotificationToast from "$lib/components/updates/UpdateNotificationToast.svelte";
  import { formatEventNotificationBody } from "$lib/components/calendar/event-notifications";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    firstMarkTime,
    mark as perfMark,
    setShellStartupMs,
  } from "$lib/stores/perflog.svelte";
  import type { MemoryReport, StartupMemorySnapshot } from "$lib/components/perf/memoryReport";
  import { shouldUseKeyboardFocusIntent } from "$lib/utils";
  import {
    createLifecycleScheduler,
    type SchedulerRunContext,
  } from "$lib/scheduling/lifecycle-scheduler";
  import {
    createEventNotificationScheduler,
    createNotesNotificationScheduler,
  } from "$lib/scheduling/notification-schedulers";
  import { onMount } from "svelte";
  import { getNotesProjectHistoryScheduler } from "$lib/notes/project-history-scheduler";
  import { onActiveVaultIdentityChange } from "$lib/vault/active-vault";
  import { doomscrollingObservationPlan } from "$lib/stores/doomscrolling-observation-policy";
  import type { ProjectChatIntegration } from "$lib/projects/types";

  perfMark("boot.script-start");

  const appWindow = getCurrentWindow();
  const isMainWindow = appWindow.label === "main";
  const detachedWindowView = detachableTabViewFromWindowLabel(appWindow.label);
  const nav = getNavigation();
  const startupTabView = detachedWindowView ?? nav.current;
  if (nav.current !== startupTabView) nav.navigate(startupTabView);
  const calendar = getCalendar();
  const calendars = getCalendars();
  const doomscrolling = getDoomscrolling();
  const desktopBlocker = getDoomscrollingDesktopBlocker();
  const doomscrollingUsage = getDoomscrollingUsage();
  const music = getMusicPlayer();
  const pomodoro = getPomodoro();
  const notes = getNotes();
  const projects = getProjects();
  const chat = getChat();
  const zoom = getZoom();
  const preferences = getPreferences();
  const settingsLauncher = getSettingsLauncher();
  const updates = getUpdateManager();
  const viewport = getViewport();
  const localization = getLocalization();
  const { t } = localization;
  const locale = $derived(localization.locale);
  const detachedWindows = getDetachedWindows();
  const notesNotificationSchedule = getNotesNotificationSchedule();
  const notesProjectHistoryScheduler = getNotesProjectHistoryScheduler();
  const projectDesktopViewComponents = {
    list: ProjectListView,
    kanban: ProjectKanbanView,
    calendar: CalendarView,
    gantt: ProjectGanttView,
    dashboard: ProjectDashboardView,
  } satisfies ProjectDesktopViewComponents;
  const projectChatIntegration: ProjectChatIntegration = {
    listWorkingFolders: (projectId) => chat.workingFolders
      .filter((entry) => (
        entry.workingFolder.projectId === projectId
        && entry.workingFolder.archivedAt === null
      ))
      .map((entry) => ({
        id: entry.workingFolder.id,
        displayName: entry.workingFolder.displayName,
      })),
    ensureLoaded: () => chat.ensureLoaded(),
    openProject: async (projectId, workingFolderId) => {
      await chat.ensureLoaded();
      if (workingFolderId) chat.selectWorkingFolder(workingFolderId);
      else await chat.syncProjectSelection(projectId);
      nav.navigate("chat");
    },
  };
  const notesMusicMentionContext = $derived({
    currentMusicSource: music.currentSource,
    musicQueue: music.queue,
  });
  let unlistenCalendarNotificationOpen: UnlistenFn | null = null;
  let unlistenNotesNotificationOpen: UnlistenFn | null = null;
  let unlistenDoomscrollingDesktopSettingsOpen: UnlistenFn | null = null;
  let unlistenDoomscrollingLimitsSettingsOpen: UnlistenFn | null = null;
  const NOTES_NOTIFICATION_BODY_MAX_CHARS = 180;
  const DESKTOP_BLOCKING_CHECK_INTERVAL_MS = 5_000;
  const AUTOMATIC_UPDATE_CHECK_DELAY_MS = 3_000;
  const COMPLETION_MUSIC_FADE_OUT_MS = 1_200;
  const COMPLETION_MUSIC_FADE_IN_MS = 1_800;
  const COMPLETION_MUSIC_FADE_STEP_MS = 100;
  const COMPLETION_MUSIC_PAUSE_SETTLE_MS = 150;
  const COMPLETION_SOUND_RESUME_PAD_MS = 250;
  const COMPLETION_SOUND_DURATION_MS: Record<PomodoroCompletionKind, number> = {
    event: 15_714,
    day: 12_000,
    workweek: 11_455,
  };

  interface NotesNotificationOpenPayload {
    page_id: string;
    block_id?: string | null;
  }

  let isMaximized = $state(true);
  let completionOverlay = $state<{ kind: PomodoroCompletionKind } | null>(null);
  let completionMusicDuckingGeneration = 0;
  type BenchmarkOverlayComponent = typeof import("$lib/components/benchmark/BenchmarkOverlay.svelte").default;
  type IdleOverlayComponent = typeof import("$lib/components/pomodoro/IdleOverlay.svelte").default;
  let BenchmarkOverlay = $state<BenchmarkOverlayComponent | null>(null);
  let IdleOverlay = $state<IdleOverlayComponent | null>(null);
  let loadingBenchmarkOverlay: Promise<void> | null = null;
  let loadingIdleOverlay: Promise<void> | null = null;
  let devtoolsToggleInFlight = false;
  function ensureBenchmarkOverlay(): Promise<void> {
    if (BenchmarkOverlay) return Promise.resolve();
    loadingBenchmarkOverlay ??= import("$lib/components/benchmark/BenchmarkOverlay.svelte")
      .then((module) => {
        BenchmarkOverlay = module.default;
      })
      .finally(() => {
        loadingBenchmarkOverlay = null;
      });
    return loadingBenchmarkOverlay;
  }

  async function afterAnimationFrames(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  }

  async function startNormalCalendarBoot(): Promise<void> {
    calendars.load().catch((e) => console.error("Failed to load calendars:", e));
    if (isMainWindow) {
      await pomodoro.cleanupOrphans().catch((e) => console.warn("Failed to clean up orphans:", e));
    }
    try {
      await calendar.load();
      // Calendar startup marks are still produced for normal boots.
    } catch (e) {
      console.error("Failed to load calendar:", e);
    }
  }

  async function startBenchmarkOrNormalCalendarBoot(): Promise<void> {
    let benchmarkClaimedBoot = false;
    try {
      const stateJson = await invoke<string | null>("read_benchmark_state");
      if (stateJson) {
        // Resolve the DB URL while the benchmark state is still pending.
        // The runner flips the state to running before scenario setup, and
        // running states intentionally fall back to the user DB on a fresh
        // boot so interrupted benchmarks cannot keep touching benchmark data.
        await ensureDbUrl();
        await ensureBenchmarkOverlay();
        await afterAnimationFrames(2);
        const { getBenchmarkRunner } = await import("$lib/stores/benchmarkRunner.svelte");
        benchmarkClaimedBoot = await getBenchmarkRunner().checkAndResume();
      }
    } catch (e) {
      console.error("benchmark resume failed:", e);
    } finally {
      if (!benchmarkClaimedBoot) {
        await startNormalCalendarBoot();
      }
    }
  }
  function loadIdleOverlay(): Promise<void> {
    if (IdleOverlay) return Promise.resolve();
    loadingIdleOverlay ??= import("$lib/components/pomodoro/IdleOverlay.svelte")
      .then((module) => {
        IdleOverlay = module.default;
      })
      .finally(() => {
        loadingIdleOverlay = null;
      });
    return loadingIdleOverlay;
  }

  function parseNotesNotificationOpenPayload(
    payload: unknown,
  ): NotesNotificationOpenPayload | null {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    if (typeof record.page_id !== "string") return null;
    const blockId = record.block_id;
    if (blockId !== null && blockId !== undefined && typeof blockId !== "string") return null;
    return {
      page_id: record.page_id,
      block_id: blockId,
    };
  }

  function notesHashForNotification(payload: NotesNotificationOpenPayload): string {
    const params = new URLSearchParams({ page: payload.page_id });
    if (payload.block_id) params.set("block", payload.block_id);
    return `#notes?${params.toString()}`;
  }

  function openNotesNotification(payload: NotesNotificationOpenPayload): void {
    const nextHash = notesHashForNotification(payload);
    nav.navigate("notes");
    if (window.location.hash === nextHash) {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    window.location.hash = nextHash;
  }

  /**
   * Time spent before App.svelte could emit `boot.script-start`. The Rust
   * command is process-spawn anchored, while performance.now is anchored to
   * the WebKit document. Adding the script-start mark produces the baseline
   * used by the launch table and benchmark output.
   */
  let shellStartupMs = $state<number | null>(null);
  let startupMemorySnapshot = $state<StartupMemorySnapshot>({ status: "pending" });

  onMount(() => {
    perfMark("boot.app-mount");
    let disposed = false;
    const automaticUpdateCheckTimerId = isMainWindow
      ? setTimeout(() => {
        void updates.checkAutomatically({ kind: "startup" });
      }, AUTOMATIC_UPDATE_CHECK_DELAY_MS)
      : null;
    const automaticUpdateCheckIntervalId = isMainWindow
      ? setInterval(() => {
        void updates.checkAutomatically({ kind: "periodic" });
      }, UPDATE_AUTO_CHECK_INTERVAL_MS + AUTOMATIC_UPDATE_CHECK_DELAY_MS + 1_000)
      : null;
    const handleMusicAssignmentInspection = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail?.ready === true || nav.current === "calendar") return;
      const eventId = typeof event.detail?.eventId === "string" ? event.detail.eventId : null;
      if (!eventId) return;
      nav.navigate("calendar");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("ganbaru-ai:inspect-music-assignment", {
          detail: { eventId, ready: true },
        }));
      }, 0);
    };
    window.addEventListener("ganbaru-ai:inspect-music-assignment", handleMusicAssignmentInspection);
    if (isMainWindow) {
      notesProjectHistoryScheduler.setEnabled(true);
      listen("calendar-notification-open", () => {
        if (disposed) return;
        nav.navigate("calendar");
      })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          unlistenCalendarNotificationOpen = unlisten;
        })
        .catch((e) => console.error("Failed to listen for calendar notification opens:", e));
      listen<unknown>("notes-notification-open", (event) => {
        if (disposed) return;
        const payload = parseNotesNotificationOpenPayload(event.payload);
        if (!payload) return;
        openNotesNotification(payload);
      })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          unlistenNotesNotificationOpen = unlisten;
        })
        .catch((e) => console.error("Failed to listen for Notes notification opens:", e));
      listen("doomscrolling-open-desktop-settings", () => {
        if (disposed) return;
        settingsLauncher.open("doomscrolling", { doomscrollingTab: "desktop" });
      })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          unlistenDoomscrollingDesktopSettingsOpen = unlisten;
        })
        .catch((e) => console.error("Failed to listen for doomscrolling settings opens:", e));
      listen("doomscrolling-open-limits-settings", () => {
        if (disposed) return;
        settingsLauncher.open("doomscrolling", { doomscrollingTab: "limits" });
      })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          unlistenDoomscrollingLimitsSettingsOpen = unlisten;
        })
        .catch((e) => console.error("Failed to listen for doomscrolling limit settings opens:", e));
    }
    const unsubscribeHistoryVault = isMainWindow
      ? onActiveVaultIdentityChange((previousVaultId, nextVaultId) => {
          notesProjectHistoryScheduler.switchVault();
          chat.resetForVault();
          if (!nextVaultId) return;
          const projectsRequest = previousVaultId ? projects.load() : projects.ensureLoaded();
          void projectsRequest.then(() => Promise.all([
            previousVaultId ? notes.load() : notes.ensureLoaded(),
            chat.prewarmForProject(projects.selectedProjectId),
          ])).catch((error) => {
            console.error("core workspace preload failed", error);
          });
        })
      : null;

    if (isMainWindow) {
      void ensureDbUrl()
        .then(() => projects.ensureLoaded())
        .then(() => Promise.all([
          notes.ensureLoaded(),
          chat.prewarmForProject(projects.selectedProjectId),
        ]))
        .catch((error) => {
          console.error("core workspace preload failed", error);
        });
    }

    // Valid benchmark boots are claimed before normal calendar hydration so
    // the measured window is the scenario anchor, not today's normal window.
    startBenchmarkOrNormalCalendarBoot().catch((e) =>
      console.error("calendar boot failed:", e),
    );
    appWindow.isMaximized().then((v) => (isMaximized = v));
    invoke<number>("get_startup_elapsed_ms").then((ms) => {
      const scriptStartMs = firstMarkTime("boot.script-start") ?? 0;
      const nextShellStartupMs = Math.max(0, Math.round(ms - performance.now() + scriptStartMs));
      shellStartupMs = nextShellStartupMs;
      setShellStartupMs(nextShellStartupMs);
    });
    const startupMemoryTimerId = setTimeout(() => {
      invoke<MemoryReport>("get_memory_report")
        .then((report) => {
          startupMemorySnapshot = { status: "ready", report };
        })
        .catch((e) => {
          startupMemorySnapshot = {
            status: "failed",
            message: e instanceof Error ? e.message : String(e),
          };
        });
    }, 10_000);

    // Prevent native webview scaling from modified wheel input.
    const blockNativeWheelScale = (e: WheelEvent) => { if (hasShortcutModifier(e)) e.preventDefault(); };
    const blockNativeContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener("wheel", blockNativeWheelScale, { passive: false, capture: true });
    document.addEventListener("contextmenu", blockNativeContextMenu, { capture: true });

    const root = document.documentElement;
    const navigateToNotesHash = () => {
      if (parseNotesLinkHash(window.location.hash)) nav.navigate("notes");
    };
    const markPointerFocus = () => {
      root.dataset.focusIntent = "pointer";
    };
    const markKeyboardFocus = (event: KeyboardEvent) => {
      if (shouldUseKeyboardFocusIntent(event)) {
        root.dataset.focusIntent = "keyboard";
      }
    };
    markPointerFocus();
    navigateToNotesHash();
    document.addEventListener("pointerdown", markPointerFocus, { capture: true });
    document.addEventListener("keydown", markKeyboardFocus, { capture: true });
    window.addEventListener("hashchange", navigateToNotesHash);

    // Track device timezone changes (travel, OS-level update). On change,
    // reload calendar events so wall-clock strings reflect the new zone.
    // Re-resolves on visibility change and window focus after suspend or
    // device travel. Those same lifecycle events catch every scheduler up.
    let knownZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const checkZone = () => {
      const current = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (current !== knownZone) {
        knownZone = current;
        calendar.load().catch((e) => console.error("Failed to reload calendar after zone change:", e));
      }
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      checkZone();
      resumeLifecycleSchedulers();
    };
    const onFocus = () => {
      checkZone();
      resumeLifecycleSchedulers();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      disposed = true;
      unlistenCalendarNotificationOpen?.();
      unlistenCalendarNotificationOpen = null;
      unlistenNotesNotificationOpen?.();
      unlistenNotesNotificationOpen = null;
      unlistenDoomscrollingDesktopSettingsOpen?.();
      unlistenDoomscrollingDesktopSettingsOpen = null;
      unlistenDoomscrollingLimitsSettingsOpen?.();
      unlistenDoomscrollingLimitsSettingsOpen = null;
      document.removeEventListener("wheel", blockNativeWheelScale, { capture: true });
      document.removeEventListener("contextmenu", blockNativeContextMenu, { capture: true });
      document.removeEventListener("pointerdown", markPointerFocus, { capture: true });
      document.removeEventListener("keydown", markKeyboardFocus, { capture: true });
      window.removeEventListener("hashchange", navigateToNotesHash);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("ganbaru-ai:inspect-music-assignment", handleMusicAssignmentInspection);
      if (automaticUpdateCheckTimerId) clearTimeout(automaticUpdateCheckTimerId);
      if (automaticUpdateCheckIntervalId) clearInterval(automaticUpdateCheckIntervalId);
      clearTimeout(startupMemoryTimerId);
      unsubscribeHistoryVault?.();
      if (isMainWindow) {
        void notesProjectHistoryScheduler.shutdown().catch((error) => {
          console.error("Notes project history shutdown flush failed", error);
        });
      }
      disposeLifecycleSchedulers();
    };
  });

  $effect(() => {
    let cleanup: (() => void) | undefined;
    let disposed = false;
    appWindow.onResized(() => {
      if (disposed) return;
      appWindow.isMaximized().then((value) => {
        if (!disposed) isMaximized = value;
      });
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  });

  const visibleTabViews = $derived.by<DetachableTabView[]>(() => {
    if (detachedWindowView) return [detachedWindowView];
    return mainTabViews(detachedWindows.views);
  });
  const keyboardViews = $derived(visibleTabViews);
  let showStopConfirm = $state(false);
  let savedBlockState: CalendarEvent | null = null;
  let reverting = false;

  function navigatePrev() {
    if (keyboardViews.length === 0) return;
    const i = Math.max(0, keyboardViews.indexOf(nav.current));
    nav.navigate(keyboardViews[(i - 1 + keyboardViews.length) % keyboardViews.length]);
  }

  function navigateNext() {
    if (keyboardViews.length === 0) return;
    const i = Math.max(0, keyboardViews.indexOf(nav.current));
    nav.navigate(keyboardViews[(i + 1) % keyboardViews.length]);
  }

  const suspendInfo = $derived(pomodoro.suspendedAway);
  const idleInfo = $derived(pomodoro.idlePaused);

  $effect(() => {
    if (idleInfo && !idleInfo.nativeOverlay) void loadIdleOverlay();
  });

  function formatAwayDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0 && minutes > 0) return t("focusDialog.awayHoursMinutes", hours, minutes);
    if (hours > 0) return t("focusDialog.awayHours", hours);
    if (minutes > 0) return t("focusDialog.awayMinutes", minutes);
    return t("focusDialog.awaySeconds", totalSeconds);
  }

  function desktopAppBlockingActive(): boolean {
    if (!isMainWindow || !pomodoro.isActive || !doomscrolling.desktopEnabled) return false;
    const strictPause = pomodoro.idlePaused !== null || pomodoro.suspendedAway !== null;
    if (!pomodoro.isRunning && !strictPause && doomscrolling.desktopPauseDuringFocusPause) return false;
    if (pomodoro.phase === "focus") return doomscrolling.desktopBlockDuringFocus;
    if (pomodoro.phase === "short_break") return doomscrolling.desktopBlockDuringShortBreaks;
    if (pomodoro.phase === "long_break") return doomscrolling.desktopBlockDuringLongBreaks;
    return false;
  }

  async function checkDesktopAppBlocking(context?: SchedulerRunContext): Promise<void> {
    if (!desktopAppBlockingActive()) {
      desktopBlocker.clear();
      return;
    }
    await desktopBlocker.check(
      doomscrolling.blockedApps,
      () => context?.isCurrent() ?? desktopAppBlockingActive(),
    );
  }

  const desktopBlockingScheduler = createLifecycleScheduler({
    run: async (context) => {
      await checkDesktopAppBlocking(context);
      if (context.isCurrent()) await doomscrollingUsage.runOnce(context);
      return context.isCurrent()
        ? context.now() + DESKTOP_BLOCKING_CHECK_INTERVAL_MS
        : null;
    },
    onError: (error) => {
      console.warn("Failed to check blocked desktop apps:", error);
    },
  });

  $effect(() => {
    const _active = pomodoro.isActive;
    const _running = pomodoro.isRunning;
    const _phase = pomodoro.phase;
    const _idlePaused = pomodoro.idlePaused;
    const _suspendedAway = pomodoro.suspendedAway;
    const _enabled = doomscrolling.desktopEnabled;
    const _focus = doomscrolling.desktopBlockDuringFocus;
    const _shortBreaks = doomscrolling.desktopBlockDuringShortBreaks;
    const _longBreaks = doomscrolling.desktopBlockDuringLongBreaks;
    const _pause = doomscrolling.desktopPauseDuringFocusPause;
    const _rules = doomscrolling.blockedApps;
    const active = doomscrollingObservationPlan(
      isMainWindow,
      desktopAppBlockingActive(),
      doomscrollingUsage.isEnabled(),
    ).coordinatorEnabled;
    const wasEnabled = desktopBlockingScheduler.isEnabled();
    desktopBlockingScheduler.setEnabled(active);
    if (!active) {
      desktopBlocker.clear();
    } else if (wasEnabled) {
      desktopBlockingScheduler.invalidate();
    }
  });

  $effect(() => {
    const _limitsEnabled = doomscrolling.limitsEnabled;
    const _limits = doomscrolling.usageLimits;
    const enabled = isMainWindow
      && doomscrolling.limitsEnabled
      && doomscrolling.usageLimits.some((limit) => limit.enabled);
    const wasEnabled = doomscrollingUsage.isEnabled();
    doomscrollingUsage.setEnabled(enabled);
    const coordinatorEnabled = doomscrollingObservationPlan(
      isMainWindow,
      desktopAppBlockingActive(),
      enabled,
    ).coordinatorEnabled;
    const coordinatorWasEnabled = desktopBlockingScheduler.isEnabled();
    desktopBlockingScheduler.setEnabled(coordinatorEnabled);
    if (coordinatorEnabled && (wasEnabled || coordinatorWasEnabled)) {
      desktopBlockingScheduler.invalidate();
    }
  });

  function toggleDevtools(): void {
    if (!import.meta.env.DEV || devtoolsToggleInFlight) return;
    devtoolsToggleInFlight = true;
    invoke<boolean>("toggle_devtools")
      .catch((error) => {
        console.warn("Failed to toggle DevTools:", error);
      })
      .finally(() => {
        devtoolsToggleInFlight = false;
      });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (
      import.meta.env.DEV
      && (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i"))
    ) {
      e.preventDefault();
      toggleDevtools();
      return;
    }

    if (hasOnlyShortcutModifier(e) && e.key === ",") {
      e.preventDefault();
      if (settingsLauncher.isOpen) {
        settingsLauncher.close();
      } else {
        settingsLauncher.open();
      }
      return;
    }

    if (hasOnlyShortcutModifier(e) && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      zoom.zoomIn();
      return;
    }
    if (hasOnlyShortcutModifier(e) && e.key === "-") {
      e.preventDefault();
      zoom.zoomOut();
      return;
    }
    if (hasOnlyShortcutModifier(e) && e.key === "0") {
      e.preventDefault();
      zoom.reset();
      return;
    }

    if (showStopConfirm || suspendInfo || idleInfo) return;

    if (e.altKey && e.key >= "1" && e.key <= String(visibleTabViews.length)) {
      e.preventDefault();
      nav.navigate(visibleTabViews[parseInt(e.key) - 1]);
      return;
    }

    if (hasShortcutModifier(e) && !e.altKey && e.code === "Tab") {
      e.preventDefault();
      if (e.shiftKey) navigatePrev();
      else navigateNext();
      return;
    }

    if (hasOnlyShortcutModifier(e) && (e.key === "PageDown" || e.key === "PageUp")) {
      e.preventDefault();
      if (e.key === "PageUp") navigatePrev();
      else navigateNext();
    }
  }

  function soundForCompletionKind(kind: PomodoroCompletionKind): AppSoundId {
    if (kind === "workweek") return APP_SOUND_IDS.pomodoroWorkweekComplete;
    if (kind === "day") return APP_SOUND_IDS.pomodoroDayComplete;
    return APP_SOUND_IDS.eventFinished;
  }

  interface CompletionMusicDuck {
    generation: number;
    restoreVolume: number;
    shouldResume: boolean;
  }

  function delayMs(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, ms));
    });
  }

  function completionSoundDurationMs(kind: PomodoroCompletionKind): number {
    return COMPLETION_SOUND_DURATION_MS[kind];
  }

  function interpolateVolume(start: number, end: number, progress: number): number {
    const clampedProgress = Math.min(1, Math.max(0, progress));
    return start + (end - start) * clampedProgress;
  }

  async function fadeMusicVolume(
    targetVolume: number,
    durationMs: number,
    generation: number,
  ): Promise<boolean> {
    const startVolume = music.volumeControlValue;
    const steps = Math.max(1, Math.ceil(durationMs / COMPLETION_MUSIC_FADE_STEP_MS));
    for (let step = 1; step <= steps; step++) {
      await delayMs(durationMs / steps);
      if (generation !== completionMusicDuckingGeneration) return false;
      await music.setTransientVolume(
        interpolateVolume(startVolume, targetVolume, step / steps),
      );
    }
    return generation === completionMusicDuckingGeneration;
  }

  async function prepareMusicForCompletionSound(): Promise<CompletionMusicDuck | null> {
    const generation = ++completionMusicDuckingGeneration;
    if (!music.currentSource || !music.isPlaying || music.muted || music.volumeControlValue <= 0) {
      return null;
    }

    const restoreVolume = music.volumeControlValue;
    try {
      const faded = await fadeMusicVolume(0, COMPLETION_MUSIC_FADE_OUT_MS, generation);
      if (!faded) return null;

      await music.pausePlayback("system");
      await delayMs(COMPLETION_MUSIC_PAUSE_SETTLE_MS);
      return {
        generation,
        restoreVolume,
        shouldResume: true,
      };
    } catch (error) {
      console.warn("Failed to duck music for pomodoro completion sound:", error);
      await music.setTransientVolume(restoreVolume).catch(() => {});
      return null;
    }
  }

  async function playPomodoroCompletionSound(kind: PomodoroCompletionKind): Promise<void> {
    try {
      await playAppSound(soundForCompletionKind(kind));
    } catch (error) {
      console.warn("Failed to play pomodoro completion sound:", error);
    }
  }

  function restoreMusicAfterCompletionSound(
    duck: CompletionMusicDuck | null,
    kind: PomodoroCompletionKind,
  ): void {
    if (!duck?.shouldResume) return;
    void (async () => {
      await delayMs(completionSoundDurationMs(kind) + COMPLETION_SOUND_RESUME_PAD_MS);
      if (duck.generation !== completionMusicDuckingGeneration) return;
      if (!music.currentSource) return;
      await music.playPlayback("system");
      await fadeMusicVolume(duck.restoreVolume, COMPLETION_MUSIC_FADE_IN_MS, duck.generation);
      if (duck.generation === completionMusicDuckingGeneration) {
        await music.setTransientVolume(duck.restoreVolume);
      }
    })().catch((error) => {
      console.warn("Failed to restore music after pomodoro completion sound:", error);
    });
  }

  async function showNaturalPomodoroCompletion(block: CalendarEvent | null): Promise<void> {
    if (!block) return;
    let kind: PomodoroCompletionKind = "event";
    try {
      const dateText = block.start.split(" ")[0];
      const date = Temporal.PlainDate.from(dateText);
      const events = await calendar.loadPomodoroSchedulerEvents(date, date);
      kind = classifyPomodoroCompletion(block, events);
    } catch (e) {
      console.warn("Failed to classify pomodoro completion:", e);
    }

    const duck = await prepareMusicForCompletionSound();
    try {
      const nativeOverlay = await invoke<boolean>("show_pomodoro_completion_overlay", { kind });
      if (nativeOverlay) {
        await playPomodoroCompletionSound(kind);
        restoreMusicAfterCompletionSound(duck, kind);
        return;
      }
    } catch (e) {
      console.warn("Failed to show native pomodoro completion overlay:", e);
    }

    completionOverlay = { kind };
    await afterAnimationFrames(2);
    await playPomodoroCompletionSound(kind);
    restoreMusicAfterCompletionSound(duck, kind);
  }

  const activeBlockScheduler = createPomodoroCalendarScheduler({
    calendar,
    pomodoro,
    canStartAutomatically: (boundaryEpochMs) => invoke<boolean>("pomodoro_can_start_automatically", {
      boundaryEpochMs,
    }),
    isBlocked: () => showStopConfirm || reverting || Boolean(suspendInfo) || Boolean(idleInfo),
    onBeforeNaturalCompletion: () => {
      savedBlockState = null;
    },
    onNaturalCompletion: showNaturalPomodoroCompletion,
    onError: (error) => {
      console.warn("active pomodoro block check failed", error);
    },
  });

  function confirmStop() {
    showStopConfirm = false;
    savedBlockState = null;
    activeBlockScheduler.clearTrackedBlock();
    pomodoro.stopSession();
  }

  function cancelStop() {
    if (!savedBlockState) {
      showStopConfirm = false;
      return;
    }
    const blockToRestore = savedBlockState;
    showStopConfirm = false;
    savedBlockState = null;
    reverting = true;
    calendar.updateBlock(blockToRestore).then(() => {
      reverting = false;
    });
  }

  // React to calendar and timer state changes, then sleep until the exact
  // next event boundary instead of scanning every second.
  $effect(() => {
    const _v = calendar.indexVersion;
    const _expired = pomodoro.blockExpired;
    const _suspended = suspendInfo;
    const _idle = idleInfo;
    const _suppressed = pomodoro.autoStartSuppressed;
    const _confirming = showStopConfirm;
    const _reverting = reverting;
    const enabled = isMainWindow && calendar.loaded;
    const wasEnabled = activeBlockScheduler.isEnabled();
    activeBlockScheduler.setEnabled(enabled);
    if (enabled && wasEnabled) activeBlockScheduler.invalidate();
  });

  $effect(() => {
    if (detachedWindowView) {
      if (nav.current !== detachedWindowView) {
        nav.navigate(detachedWindowView);
        return;
      }
      return;
    }
    if (isDetachableTabView(nav.current) && !visibleTabViews.includes(nav.current)) {
      nav.navigate(firstMainView(detachedWindows.views));
      return;
    }
  });

  // Notes mention notifications
  function notesMentionNotificationSchedulerEnabled(): boolean {
    return preferences.notesMentionNotificationsEnabled
      && (
        preferences.notesReminderNotificationsEnabled
        || preferences.notesUserMentionNotificationsEnabled
        || preferences.notesTaskMentionNotificationsEnabled
      );
  }

  function notesMentionNotificationTitle(kind: NotesMentionNotificationKind): string {
    if (kind === "reminder") return t("notes.notification.reminderTitle");
    if (kind === "task_mention") return t("notes.notification.taskMentionTitle");
    return t("notes.notification.userMentionTitle");
  }

  function compactNotificationText(value: string): string {
    return value.replace(/\s+/gu, " ").trim();
  }

  function truncateNotificationText(value: string): string {
    const compact = compactNotificationText(value);
    if (compact.length <= NOTES_NOTIFICATION_BODY_MAX_CHARS) return compact;
    return `${compact.slice(0, NOTES_NOTIFICATION_BODY_MAX_CHARS - 3).trimEnd()}...`;
  }

  function notesMentionNotificationBody(notification: NotesMentionNotification): string {
    const pageTitle = notification.page_title.trim() || t("notes.untitled");
    if (preferences.notesNotificationIncludeContent) {
      const sourceText = truncateNotificationText(
        notification.source_plain_text || notification.plain_text,
      );
      if (sourceText) return sourceText;
    }
    return t("notes.notification.privateBody", pageTitle);
  }

  async function deliverNotesMentionNotification(
    notification: NotesMentionNotification,
  ): Promise<void> {
    await invoke("show_notes_notification", {
      title: notesMentionNotificationTitle(notification.kind),
      body: notesMentionNotificationBody(notification),
      pageId: notification.page_id,
      blockId: notification.block_id,
      playSound: true,
    });
    await markNotesMentionNotificationsDelivered({ ids: [notification.id] });
  }

  const notesNotificationScheduler = createNotesNotificationScheduler({
    listPending: listPendingNotesMentionNotifications,
    getPreferences: () => ({
      mentionNotificationsEnabled: preferences.notesMentionNotificationsEnabled,
      reminderNotificationsEnabled: preferences.notesReminderNotificationsEnabled,
      userMentionNotificationsEnabled: preferences.notesUserMentionNotificationsEnabled,
      taskMentionNotificationsEnabled: preferences.notesTaskMentionNotificationsEnabled,
    }),
    deliver: deliverNotesMentionNotification,
    onError: (error) => {
      console.error("[notes notifications] check failed:", error);
    },
    onDeliveryError: (error) => {
      console.error("[notes notifications] failed:", error);
    },
  });

  $effect(() => {
    const _enabled = preferences.notesMentionNotificationsEnabled;
    const _reminders = preferences.notesReminderNotificationsEnabled;
    const _users = preferences.notesUserMentionNotificationsEnabled;
    const _tasks = preferences.notesTaskMentionNotificationsEnabled;
    const _version = notesNotificationSchedule.version;
    const enabled = isMainWindow && notesMentionNotificationSchedulerEnabled();
    const wasEnabled = notesNotificationScheduler.isEnabled();
    notesNotificationScheduler.setEnabled(enabled);
    if (enabled && wasEnabled) notesNotificationScheduler.invalidate();
  });

  const chatScheduledMessageScheduler = createLifecycleScheduler({
    errorRetryMs: 60_000,
    run: async (context) => {
      const result = await chat.dispatchDueScheduledMessages();
      if (!context.isCurrent() || !result.nextDispatchAt) return null;
      const deadline = Date.parse(result.nextDispatchAt);
      return Number.isFinite(deadline) ? deadline : null;
    },
    onError: (error) => {
      console.error("[chat scheduled messages] dispatch failed:", error);
    },
  });

  $effect(() => {
    const _version = chat.scheduledMessagesVersion;
    const enabled = isMainWindow && chat.loaded;
    const wasEnabled = chatScheduledMessageScheduler.isEnabled();
    chatScheduledMessageScheduler.setEnabled(enabled);
    if (enabled && wasEnabled) chatScheduledMessageScheduler.invalidate();
  });

  // Event notifications
  const eventNotificationScheduler = createEventNotificationScheduler({
    getEvents: () => {
      const today = Temporal.Now.plainDateISO();
      return calendar.eventsInWindow(
        today.subtract({ days: 1 }),
        today.add({ days: 7 }),
      );
    },
    deliver: async ({ event }) => {
      const now = new Date();
      const title = event.title.trim() || t("calendar.notification.titleFallback");
      const body = formatEventNotificationBody(event, now, { t, locale });
      await invoke("show_event_notification", { title, body, openCalendar: true });
    },
    onError: (error) => {
      console.error("[notifications] failed:", error);
    },
  });

  // Recompute the exact next deadline whenever the calendar window changes.
  $effect(() => {
    const _v = calendar.indexVersion;
    const enabled = isMainWindow && calendar.loaded;
    const wasEnabled = eventNotificationScheduler.isEnabled();
    eventNotificationScheduler.setEnabled(enabled);
    if (enabled && wasEnabled) eventNotificationScheduler.invalidate();
  });

  function resumeLifecycleSchedulers(): void {
    activeBlockScheduler.resume();
    eventNotificationScheduler.resume();
    notesNotificationScheduler.resume();
    chatScheduledMessageScheduler.resume();
    notesProjectHistoryScheduler.resume();
    desktopBlockingScheduler.resume();
    doomscrollingUsage.resume();
    music.resumeSnapshotScheduler();
  }

  function disposeLifecycleSchedulers(): void {
    activeBlockScheduler.dispose();
    eventNotificationScheduler.dispose();
    notesNotificationScheduler.dispose();
    chatScheduledMessageScheduler.dispose();
    desktopBlockingScheduler.dispose();
    doomscrollingUsage.setEnabled(false);
    void doomscrollingUsage.flush().catch((error) => {
      console.warn("Failed to flush doomscrolling usage on shutdown:", error);
    });
    desktopBlocker.clear();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="app-shell h-screen w-screen"
  data-size-class={viewport.sizeClass}
>
  <div class="flex h-full flex-col overflow-hidden bg-sidebar">
    <TitleBar {shellStartupMs} {startupMemorySnapshot} {ensureBenchmarkOverlay} />
    <main class="content-panel flex-1 min-h-0 overflow-hidden bg-background">
      {#if nav.current === "calendar"}
        <CalendarView />
      {:else if nav.current === "projects"}
        <ProjectsView
          desktopViewComponents={projectDesktopViewComponents}
          projectChat={projectChatIntegration}
        />
      {:else if nav.current === "notes"}
        <NotesView musicMentionContext={notesMusicMentionContext} />
      {:else}
        <ChatWorkspace />
      {/if}
    </main>
  </div>

  {#if showStopConfirm}
    <ConfirmDialog
      title={t("focusDialog.stopTitle")}
      message={t("focusDialog.stopMessage")}
      confirmLabel={t("focusDialog.stopSession")}
      cancelLabel={t("focusDialog.undoChanges")}
      onConfirm={confirmStop}
      onCancel={cancelStop}
    />
  {/if}

  {#if suspendInfo}
    <ConfirmDialog
      title={t("focusDialog.resumeTitle")}
      message={t("focusDialog.awayMessage", formatAwayDuration(suspendInfo.awaySeconds))}
      confirmLabel={t("focusDialog.resume")}
      cancelLabel={t("focusDialog.stopSessionCancel")}
      danger={false}
      onConfirm={() => { void pomodoro.dismissSuspend(true); }}
      onCancel={() => { pomodoro.dismissedBlockId = pomodoro.activeBlockId; void pomodoro.dismissSuspend(false); }}
    />
  {/if}

  {#if idleInfo && !idleInfo.nativeOverlay && IdleOverlay}
    {@const Idle = IdleOverlay}
    <Idle
      idleSeconds={idleInfo.idleSeconds}
      nativeOverlay={idleInfo.nativeOverlay}
      focusFailed={idleInfo.focusFailed}
      onResume={() => pomodoro.dismissIdle(true)}
      onFocusFailed={(failedAtMs) => pomodoro.markIdleFocusFailed(failedAtMs)}
    />
  {/if}

  {#if completionOverlay}
    <CompletionOverlay
      kind={completionOverlay.kind}
      onDismiss={() => { completionOverlay = null; }}
    />
  {/if}

  {#if isMainWindow}
    <UpdateNotificationToast />
  {/if}

  {#if BenchmarkOverlay}
    {@const Overlay = BenchmarkOverlay}
    <Overlay />
  {/if}

  <MusicPlaybackHost />
  {#if isMainWindow}
    <MusicContextCoordinator />
    <MusicSoundscapeCoordinator />
  {/if}
  <TooltipHost />
  <WindowResizeHandles disabled={isMaximized || !!idleInfo} />
</div>
