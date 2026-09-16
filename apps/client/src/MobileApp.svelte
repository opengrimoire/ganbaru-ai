<script lang="ts">
  import { onBackButtonPress } from "@tauri-apps/api/app";
  import { onMount } from "svelte";
  import MobileNavigation from "$lib/components/mobile/MobileNavigation.svelte";
  import MobileTopBar from "$lib/components/mobile/MobileTopBar.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { ensureDbUrl } from "$lib/api/db";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    MobileBackListenerController,
    resolveMobileBackAction,
  } from "$lib/mobile-back";
  import {
    mobileNavigationPresentation,
    mobileTopBarPanelGeometry,
  } from "$lib/mobile-layout";
  import {
    classifyLoadFailure,
    recoverLoadFailure,
    type LoadFailure,
  } from "$lib/module-load-recovery";
  import { MobilePersistenceLifecycleController } from "$lib/mobile-persistence-lifecycle";
  import type { View } from "$lib/navigation";
  import { BUILD_PLATFORM_PROFILE, platformHasCapability } from "$lib/platform";
  import { flushQuickNoteEditors } from "$lib/quick-notes/persistence";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import { getNavigation } from "$lib/stores/navigation.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getMobileBackStack } from "$lib/stores/mobile-back-stack.svelte";
  import { getViewport } from "$lib/stores/viewport.svelte";
  import { getSettingsLauncher } from "$lib/stores/settingsLauncher.svelte";
  import { mark as perfMark } from "$lib/stores/perflog.svelte";
  import { getZoom } from "$lib/stores/zoom.svelte";
  import { flushConfig } from "$lib/vault/config";

  type CalendarComponent = typeof import("$lib/components/calendar/CalendarView.svelte").default;
  type ProjectsComponent = typeof import("$lib/components/projects/ProjectsView.svelte").default;
  type NotesComponent = typeof import("$lib/components/notes/NotesView.svelte").default;
  type ChatComponent = typeof import("$lib/components/chat/ChatWorkspace.svelte").default;
  type QuickNotesComponent = typeof import("$lib/components/quick-notes/QuickNotesPanel.svelte").default;
  type SettingsComponent = typeof import("$lib/components/settings/SettingsModal.svelte").default;
  type MusicComponent = typeof import("$lib/components/music/MusicPanel.svelte").default;
  type MusicPlaybackHostComponent = typeof import("$lib/components/music/MusicPlaybackHost.svelte").default;
  type PomodoroMenuComponent = typeof import("$lib/components/pomodoro/PomodoroMenuContent.svelte").default;
  type LinkedDeviceControlComponent = typeof import("$lib/components/vault/LinkedDeviceControl.svelte").default;
  type ProjectViewComponents = import("$lib/components/projects/project-view-components").ProjectViewComponents;
  type NotesStore = ReturnType<typeof import("$lib/stores/notes.svelte").getNotes>;
  type DeferredSurface = Exclude<View, "calendar"> | "settings" | "quickNotes" | "music";
  interface PomodoroCalendarScheduler {
    setEnabled(enabled: boolean): void;
    invalidate(): void;
    resume(): void;
    dispose(): void;
    isEnabled(): boolean;
  }
  interface CalendarNotificationScheduler {
    reconcile(): Promise<void>;
    takeAction(): Promise<string | null>;
  }
  interface PomodoroScheduleScheduler {
    reconcile(): Promise<void>;
  }

  perfMark("boot.mobile-shell-script");

  const nav = getNavigation();
  const viewport = getViewport();
  const settingsLauncher = getSettingsLauncher();
  const calendar = getCalendar();
  const calendars = getCalendars();
  const pomodoro = getPomodoro();
  const mobileBackStack = getMobileBackStack();
  getZoom().reapply();
  const localization = getLocalization();
  const { t } = localization;
  const androidSystemBackAvailable = platformHasCapability(
    BUILD_PLATFORM_PROFILE,
    "system.android-back",
  );
  const musicAvailable = platformHasCapability(BUILD_PLATFORM_PROFILE, "view.music");
  const mobileMusicPlayerChromeHeight = 132;
  const mobileMusicMediaHeightRatio = 9 / 16;
  const mobileMusicStackedMediaShare = 0.65;

  let showPomodoro = $state(false);
  let showSettings = $state(false);
  let showQuickNotes = $state(false);
  let showMusic = $state(false);
  let musicPanelStyle = $state("");
  let musicPlaylistPanelStyle = $state("");
  let quickNotesPanelStyle = $state("");
  let nestedRouteOpen = $state(false);
  let loadError = $state<LoadFailure | null>(null);
  let backendReady = $state(false);
  let initializingWorkspace = $state(false);
  let CalendarSurface = $state<CalendarComponent | null>(null);
  let ProjectsSurface = $state<ProjectsComponent | null>(null);
  let NotesSurface = $state<NotesComponent | null>(null);
  let ChatSurface = $state<ChatComponent | null>(null);
  let QuickNotesSurface = $state<QuickNotesComponent | null>(null);
  let SettingsSurface = $state<SettingsComponent | null>(null);
  let MusicSurface = $state<MusicComponent | null>(null);
  let MusicPlaybackHostSurface = $state<MusicPlaybackHostComponent | null>(null);
  let PomodoroMenuSurface = $state<PomodoroMenuComponent | null>(null);
  let LinkedDeviceControlSurface = $state<LinkedDeviceControlComponent | null>(null);
  let notesStore = $state.raw<NotesStore | null>(null);
  let notesSurfaceMounted = $state(false);
  let projectViewComponents = $state.raw<ProjectViewComponents | null>(null);
  let deferredLoadErrors = $state<Partial<Record<DeferredSurface, LoadFailure>>>({});
  const deferredSurfaceLoads = new Map<DeferredSurface, Promise<void>>();
  let deferredPreparationStarted = false;
  let mobileAppDisposed = false;
  let stopMusicPreload = (): void => undefined;
  let removePomodoroBackLayer = (): void => undefined;
  let removeSettingsBackLayer = (): void => undefined;
  let removeQuickNotesBackLayer = (): void => undefined;
  let removeMusicBackLayer = (): void => undefined;
  let activeBlockScheduler = $state.raw<PomodoroCalendarScheduler | null>(null);
  let activeBlockSchedulerLoad: Promise<void> | null = null;
  let activeBlockSchedulerDisposed = false;
  let calendarNotificationScheduler = $state.raw<CalendarNotificationScheduler | null>(null);
  let calendarNotificationSchedulerLoad: Promise<void> | null = null;
  let calendarNotificationSchedulerDisposed = false;
  let pomodoroScheduleScheduler = $state.raw<PomodoroScheduleScheduler | null>(null);

  const navigationPresentation = $derived(
    mobileNavigationPresentation(viewport.layoutWidth),
  );
  const useNavigationRail = $derived(navigationPresentation === "rail");
  const suspendInfo = $derived(pomodoro.suspendedAway);
  const suspendDecisionOpen = $derived(suspendInfo !== null);
  const modalOpen = $derived(
    showSettings || showQuickNotes || showMusic || suspendDecisionOpen,
  );
  const currentTitle = $derived(t(`titleBar.tab.${nav.current}`));
  const currentDeferredSurface = $derived(
    nav.current === "calendar" ? null : nav.current,
  );
  const shouldInterceptSystemBack = $derived(
    androidSystemBackAvailable && (nestedRouteOpen
      || mobileBackStack.hasActiveLayer
      || nav.current !== "calendar"),
  );
  const backListenerController = new MobileBackListenerController(
    (handler) => onBackButtonPress(handler),
    handleSystemBack,
    (error) => {
      console.error("Failed to update Android back handling", error);
    },
  );
  const persistenceLifecycle = new MobilePersistenceLifecycleController({
    documentTarget: document,
    windowTarget: window,
    flushers: {
      config: flushConfig,
      notes: flushMountedNotes,
      quickNotes: flushQuickNoteEditors,
    },
    onError: (label, error) => {
      console.error(`Failed to flush mobile ${label} persistence`, error);
    },
  });

  function flushMountedNotes(): Promise<void> {
    if (!notesSurfaceMounted || !notesStore) return Promise.resolve();
    return notesStore.flushPendingWrites();
  }

  function rootPixelValue(property: string): number {
    const value = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(property),
    );
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function utilityPanelStyle(
    triggerSelector: string,
    desiredWidth: number,
    desiredHeight: number | ((panelWidth: number) => number),
  ): string {
    const trigger = document.querySelector<HTMLElement>(triggerSelector);
    if (!trigger) return "";
    const triggerRect = trigger.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportOffsetLeft = visualViewport?.offsetLeft ?? 0;
    const viewportOffsetTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const safeAreaLeft = rootPixelValue("--safe-area-left");
    const safeAreaRight = rootPixelValue("--safe-area-right");
    const safeAreaTop = rootPixelValue("--safe-area-top");
    const safeAreaBottom = rootPixelValue("--safe-area-bottom");
    const geometry = mobileTopBarPanelGeometry({
      anchorLeft: triggerRect.left,
      anchorWidth: triggerRect.width,
      anchorBottom: triggerRect.bottom,
      desiredWidth,
      desiredHeight: viewportHeight,
      viewportLeft: viewportOffsetLeft + safeAreaLeft,
      viewportWidth: Math.max(0, viewportWidth - safeAreaLeft - safeAreaRight),
      viewportTop: viewportOffsetTop + safeAreaTop,
      viewportHeight: Math.max(0, viewportHeight - safeAreaTop - safeAreaBottom),
    });
    const fittedHeight = typeof desiredHeight === "function"
      ? desiredHeight(geometry.width)
      : desiredHeight;
    return [
      `left:${Math.round(geometry.left)}px`,
      `top:${Math.round(geometry.top)}px`,
      `width:${Math.round(geometry.width)}px`,
      `height:${Math.round(Math.min(geometry.height, Math.max(0, fittedHeight)))}px`,
    ].join(";");
  }

  function updateUtilityPanelPositions(): void {
    quickNotesPanelStyle = utilityPanelStyle(
      "[data-mobile-quick-notes-trigger]",
      760,
      680,
    );
    musicPanelStyle = utilityPanelStyle(
      "[data-mobile-music-trigger]",
      1000,
      (panelWidth) => mobileMusicPlayerChromeHeight
        + panelWidth * mobileMusicMediaHeightRatio,
    );
    musicPlaylistPanelStyle = utilityPanelStyle(
      "[data-mobile-music-trigger]",
      1000,
      (panelWidth) => mobileMusicPlayerChromeHeight
        + (panelWidth * mobileMusicMediaHeightRatio) / mobileMusicStackedMediaShare,
    );
  }

  async function ensureActiveBlockScheduler(): Promise<void> {
    if (activeBlockScheduler) return;
    if (activeBlockSchedulerLoad) return activeBlockSchedulerLoad;
    activeBlockSchedulerLoad = (async () => {
      const { createPomodoroCalendarScheduler } = await import(
        "$lib/stores/pomodoro-calendar-scheduler"
      );
      if (activeBlockSchedulerDisposed) return;
      activeBlockScheduler = createPomodoroCalendarScheduler({
        calendar,
        pomodoro,
        isBlocked: () => suspendDecisionOpen || pomodoro.idlePaused !== null,
        onError: (error) => {
          console.warn("active mobile pomodoro block check failed", error);
        },
      });
    })().finally(() => {
      activeBlockSchedulerLoad = null;
    });
    return activeBlockSchedulerLoad;
  }

  async function ensureCalendarNotificationScheduler(): Promise<void> {
    if (calendarNotificationScheduler || calendarNotificationSchedulerDisposed) return;
    if (calendarNotificationSchedulerLoad) return calendarNotificationSchedulerLoad;
    calendarNotificationSchedulerLoad = (async () => {
      const [module, pomodoroScheduleModule] = await Promise.all([
        import("$lib/scheduling/mobile-calendar-notifications"),
        import("$lib/scheduling/mobile-pomodoro-schedule"),
      ]);
      if (calendarNotificationSchedulerDisposed) return;
      calendarNotificationScheduler = new module.MobileCalendarNotificationScheduler(
        t,
        () => localization.locale,
      );
      pomodoroScheduleScheduler = new pomodoroScheduleModule.MobilePomodoroScheduleScheduler(t);
      await Promise.all([
        calendarNotificationScheduler.reconcile(),
        pomodoroScheduleScheduler.reconcile(),
      ]);
      const eventId = await calendarNotificationScheduler.takeAction();
      if (eventId) navigate("calendar");
    })().catch((error: unknown) => {
      console.error("Failed to initialize Android Calendar notifications", error);
    }).finally(() => {
      calendarNotificationSchedulerLoad = null;
    });
    return calendarNotificationSchedulerLoad;
  }

  function afterAnimationFrames(count: number): Promise<void> {
    return new Promise((resolve) => {
      const advance = (remaining: number): void => {
        if (remaining === 0) {
          resolve();
          return;
        }
        requestAnimationFrame(() => advance(remaining - 1));
      };
      advance(count);
    });
  }

  async function prepareCriticalSurfaces(): Promise<void> {
    const [calendarModule, pomodoroMenuModule, linkedDeviceControlModule] = await Promise.all([
      import("$lib/components/calendar/CalendarView.svelte"),
      import("$lib/components/pomodoro/PomodoroMenuContent.svelte"),
      import("$lib/components/vault/LinkedDeviceControl.svelte"),
    ]);
    if (mobileAppDisposed) return;
    CalendarSurface = calendarModule.default;
    PomodoroMenuSurface = pomodoroMenuModule.default;
    LinkedDeviceControlSurface = linkedDeviceControlModule.default;
    perfMark("boot.mobile-critical-surfaces-ready");
  }

  function deferredSurfaceReady(surface: DeferredSurface): boolean {
    if (surface === "projects") return ProjectsSurface !== null && projectViewComponents !== null;
    if (surface === "notes") return NotesSurface !== null;
    if (surface === "chat") return ChatSurface !== null;
    if (surface === "settings") return SettingsSurface !== null;
    if (surface === "quickNotes") return QuickNotesSurface !== null;
    return MusicSurface !== null && MusicPlaybackHostSurface !== null;
  }

  async function prepareDeferredSurfaceNow(surface: DeferredSurface): Promise<void> {
    if (surface === "projects") {
      const [
        storeModule,
        projectsModule,
        listModule,
        dashboardModule,
        kanbanModule,
        ganttModule,
        calendarModule,
      ] = await Promise.all([
        import("$lib/stores/projects.svelte"),
        import("$lib/components/projects/ProjectsView.svelte"),
        import("$lib/components/projects/ProjectListView.svelte"),
        import("$lib/components/projects/ProjectDashboardView.svelte"),
        import("$lib/components/projects/ProjectKanbanView.svelte"),
        import("$lib/components/projects/ProjectGanttView.svelte"),
        import("$lib/components/calendar/CalendarView.svelte"),
      ]);
      if (mobileAppDisposed) return;
      ProjectsSurface = projectsModule.default;
      projectViewComponents = {
        list: listModule.default,
        dashboard: dashboardModule.default,
        kanban: kanbanModule.default,
        calendar: calendarModule.default,
        gantt: ganttModule.default,
      };
      void storeModule.getProjects().ensureLoaded().catch((error) => {
        console.warn("Mobile Projects preload failed", error);
      });
      return;
    }
    if (surface === "notes") {
      const [storeModule, module] = await Promise.all([
        import("$lib/stores/notes.svelte"),
        import("$lib/components/notes/NotesView.svelte"),
      ]);
      if (mobileAppDisposed) return;
      notesStore = storeModule.getNotes();
      NotesSurface = module.default;
      void notesStore.ensureLoaded().catch((error) => {
        console.warn("Mobile Notes preload failed", error);
      });
      return;
    }
    if (surface === "chat") {
      const [chatStoreModule, projectsStoreModule, module] = await Promise.all([
        import("$lib/stores/chat.svelte"),
        import("$lib/stores/projects.svelte"),
        import("$lib/components/chat/ChatWorkspace.svelte"),
      ]);
      if (mobileAppDisposed) return;
      ChatSurface = module.default;
      void chatStoreModule.getChat()
        .prewarmForProject(projectsStoreModule.getProjects().selectedProjectId)
        .catch((error) => {
          console.warn("Mobile Chat preload failed", error);
        });
      return;
    }
    if (surface === "settings") {
      const module = await import("$lib/components/settings/SettingsModal.svelte");
      if (!mobileAppDisposed) SettingsSurface = module.default;
      return;
    }
    if (surface === "quickNotes") {
      const [preloadModule, module] = await Promise.all([
        import("$lib/quick-notes/initial-snapshot"),
        import("$lib/components/quick-notes/QuickNotesPanel.svelte"),
      ]);
      if (mobileAppDisposed) return;
      QuickNotesSurface = module.default;
      void preloadModule.preloadQuickNotesInitialSnapshot().catch((error) => {
        console.warn("Mobile Quick notes preload failed", error);
      });
      return;
    }
    const [panelModule, playbackHostModule, preloadModule] = await Promise.all([
      import("$lib/components/music/MusicPanel.svelte"),
      import("$lib/components/music/MusicPlaybackHost.svelte"),
      import("$lib/music/music-first-use-preload"),
    ]);
    if (mobileAppDisposed) return;
    MusicSurface = panelModule.default;
    MusicPlaybackHostSurface = playbackHostModule.default;
    stopMusicPreload();
    stopMusicPreload = preloadModule.startMusicFirstUsePreload();
  }

  function prepareDeferredSurface(surface: DeferredSurface): Promise<void> {
    if (deferredSurfaceReady(surface)) return Promise.resolve();
    const existing = deferredSurfaceLoads.get(surface);
    if (existing) return existing;
    delete deferredLoadErrors[surface];
    const request = prepareDeferredSurfaceNow(surface)
      .then(() => {
        if (!mobileAppDisposed) perfMark(`boot.mobile-${surface}-ready`);
      })
      .catch((error: unknown) => {
        if (mobileAppDisposed) return;
        deferredLoadErrors[surface] = classifyLoadFailure(error);
        console.error(`Failed to prepare the mobile ${surface} surface`, error);
      })
      .finally(() => {
        deferredSurfaceLoads.delete(surface);
      });
    deferredSurfaceLoads.set(surface, request);
    return request;
  }

  async function prepareDeferredSurfacesAfterPaint(): Promise<void> {
    if (deferredPreparationStarted) return;
    deferredPreparationStarted = true;
    await afterAnimationFrames(2);
    if (mobileAppDisposed) return;
    perfMark("boot.mobile-calendar-presented");
    void synchronizeMobileDoomscrolling();
    void ensureCalendarNotificationScheduler();
    const batches: readonly (readonly DeferredSurface[])[] = [
      ["projects"],
      ["settings"],
      ["quickNotes"],
      ["notes"],
      ["chat"],
      ["music"],
    ];
    for (const batch of batches) {
      await Promise.all(batch.map((surface) => prepareDeferredSurface(surface)));
      await afterAnimationFrames(1);
      if (mobileAppDisposed) return;
    }
    perfMark("boot.mobile-standard-surfaces-ready");
  }

  async function initializeWorkspace(): Promise<void> {
    if (initializingWorkspace) return;
    initializingWorkspace = true;
    backendReady = false;
    loadError = null;
    try {
      const databaseReady = ensureDbUrl();
      const criticalSurfaces = prepareCriticalSurfaces();
      await databaseReady;
      perfMark("boot.mobile-database-ready");
      await Promise.all([
        criticalSurfaces,
        pomodoro.recoverMobileRun(),
        calendars.load(),
        calendar.load(),
      ]);
      perfMark("boot.mobile-calendar-data-ready");
      await ensureActiveBlockScheduler();
      backendReady = true;
      perfMark("boot.mobile-shell-ready");
      void prepareDeferredSurfacesAfterPaint();
    } catch (error) {
      loadError = classifyLoadFailure(error);
      console.error("Failed to initialize the mobile workspace", error);
    } finally {
      initializingWorkspace = false;
    }
  }

  async function synchronizeMobileDoomscrolling(): Promise<void> {
    try {
      const [storeModule, usageModule, mobileModule] = await Promise.all([
        import("$lib/stores/doomscrolling.svelte"),
        import("$lib/stores/doomscrolling-usage.svelte"),
        import("$lib/scheduling/mobile-doomscrolling"),
      ]);
      await storeModule.getDoomscrolling().publishMobileRules();
      await usageModule.getDoomscrollingUsage().refresh();
      const target = await mobileModule.takeMobileDoomscrollingNotificationAction();
      if (target) settingsLauncher.open("doomscrolling", { doomscrollingTab: target });
    } catch (error) {
      console.warn("Failed to synchronize Android Doomscrolling", error);
    }
  }

  function retryWorkspaceLoad(): void {
    const failure = loadError;
    if (!failure) return;
    recoverLoadFailure(failure, () => {
      void initializeWorkspace();
    });
  }

  function retryDeferredSurface(surface: DeferredSurface): void {
    const failure = deferredLoadErrors[surface];
    if (!failure) return;
    recoverLoadFailure(failure, () => {
      void prepareDeferredSurface(surface);
    });
  }

  function clearNestedRoute(): void {
    if (window.location.hash.length === 0) {
      nestedRouteOpen = false;
      return;
    }
    const previousUrl = window.location.href;
    const nextUrl = new URL(previousUrl);
    nextUrl.hash = "";
    window.history.replaceState(window.history.state, "", nextUrl);
    nestedRouteOpen = false;
    window.dispatchEvent(new HashChangeEvent("hashchange", {
      oldURL: previousUrl,
      newURL: nextUrl.href,
    }));
  }

  function navigate(view: View): void {
    if (view !== "notes") clearNestedRoute();
    if (!nav.navigate(view)) return;
    if (view !== "calendar") void prepareDeferredSurface(view);
  }

  function formatAwayDuration(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0 && minutes > 0) return t("focusDialog.awayHoursMinutes", hours, minutes);
    if (hours > 0) return t("focusDialog.awayHours", hours);
    if (minutes > 0) return t("focusDialog.awayMinutes", minutes);
    return t("focusDialog.awaySeconds", totalSeconds);
  }

  function stopSuspendedSession(): void {
    pomodoro.dismissedBlockId = pomodoro.activeBlockId;
    void pomodoro.dismissSuspend(false);
  }

  function closePomodoro(): void {
    removePomodoroBackLayer();
    removePomodoroBackLayer = () => undefined;
    showPomodoro = false;
  }

  function openPomodoro(): void {
    closeSettings();
    closeQuickNotes();
    closeMusic();
    showPomodoro = true;
    removePomodoroBackLayer();
    removePomodoroBackLayer = mobileBackStack.activate({ handle: closePomodoro });
  }

  function closeSettings(): void {
    removeSettingsBackLayer();
    removeSettingsBackLayer = () => undefined;
    showSettings = false;
    if (settingsLauncher.isOpen) settingsLauncher.close();
  }

  function openSettings(): void {
    closePomodoro();
    closeQuickNotes();
    closeMusic();
    showSettings = true;
    void prepareDeferredSurface("settings");
    removeSettingsBackLayer();
    removeSettingsBackLayer = mobileBackStack.activate({ handle: closeSettings });
  }

  $effect(() => {
    if (!settingsLauncher.isOpen || showSettings) return;
    openSettings();
  });

  function closeQuickNotes(): void {
    removeQuickNotesBackLayer();
    removeQuickNotesBackLayer = () => undefined;
    showQuickNotes = false;
  }

  function openQuickNotes(): void {
    if (showQuickNotes || !backendReady) return;
    closePomodoro();
    closeSettings();
    closeMusic();
    updateUtilityPanelPositions();
    showQuickNotes = true;
    void prepareDeferredSurface("quickNotes");
    removeQuickNotesBackLayer();
    removeQuickNotesBackLayer = mobileBackStack.activate({ handle: closeQuickNotes });
  }

  function closeMusic(): void {
    removeMusicBackLayer();
    removeMusicBackLayer = () => undefined;
    showMusic = false;
  }

  function openMusic(): void {
    if (!musicAvailable || showMusic || !backendReady) return;
    closePomodoro();
    closeSettings();
    closeQuickNotes();
    updateUtilityPanelPositions();
    showMusic = true;
    void prepareDeferredSurface("music");
    removeMusicBackLayer();
    removeMusicBackLayer = mobileBackStack.activate({ handle: closeMusic });
  }

  function handleSystemBack(): void {
    const action = resolveMobileBackAction({
      featureLayerOpen: mobileBackStack.hasActiveLayer,
      nestedRouteOpen,
      currentView: nav.current,
    });
    if (action === "consume-feature-layer") {
      mobileBackStack.consume();
    } else if (action === "close-nested-route") {
      clearNestedRoute();
    } else if (action === "navigate-calendar") {
      navigate("calendar");
    } else {
      void backListenerController.setEnabled(false);
    }
  }

  onMount(() => {
    mobileAppDisposed = false;
    const detachPersistenceLifecycle = persistenceLifecycle.attach();
    let schedulerResume: Promise<void> | null = null;
    const syncNestedRoute = (): void => {
      nestedRouteOpen = window.location.hash.length > 0;
    };
    const handleMusicAssignmentInspection = (event: Event): void => {
      if (!(event instanceof CustomEvent) || event.detail?.ready === true || nav.current === "calendar") return;
      const eventId = typeof event.detail?.eventId === "string" ? event.detail.eventId : null;
      if (!eventId) return;
      navigate("calendar");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("ganbaru-ai:inspect-music-assignment", {
          detail: { eventId, ready: true },
        }));
      }, 0);
    };
    const resumePomodoroScheduler = (): void => {
      if (document.visibilityState !== "visible" || !backendReady || schedulerResume) return;
      schedulerResume = (async () => {
        await pomodoro.recoverMobileRun();
        activeBlockScheduler?.resume();
        await Promise.all([
          calendarNotificationScheduler?.reconcile(),
          pomodoroScheduleScheduler?.reconcile(),
          synchronizeMobileDoomscrolling(),
        ]);
        const eventId = await calendarNotificationScheduler?.takeAction();
        if (eventId) navigate("calendar");
      })().catch((error) => {
        console.error("Failed to resume mobile focus schedulers", error);
      }).finally(() => {
        schedulerResume = null;
      });
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        pomodoro.prepareForMobileBackground();
        return;
      }
      resumePomodoroScheduler();
    };
    syncNestedRoute();
    window.addEventListener("hashchange", syncNestedRoute);
    window.addEventListener("popstate", syncNestedRoute);
    window.addEventListener("ganbaru-ai:inspect-music-assignment", handleMusicAssignmentInspection);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", resumePomodoroScheduler);

    void initializeWorkspace();

    return () => {
      mobileAppDisposed = true;
      window.removeEventListener("hashchange", syncNestedRoute);
      window.removeEventListener("popstate", syncNestedRoute);
      window.removeEventListener("ganbaru-ai:inspect-music-assignment", handleMusicAssignmentInspection);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", resumePomodoroScheduler);
      removePomodoroBackLayer();
      removeSettingsBackLayer();
      removeQuickNotesBackLayer();
      removeMusicBackLayer();
      detachPersistenceLifecycle();
      stopMusicPreload();
      void persistenceLifecycle.flush();
      void backListenerController.dispose();
      activeBlockSchedulerDisposed = true;
      activeBlockScheduler?.dispose();
      activeBlockScheduler = null;
      calendarNotificationSchedulerDisposed = true;
      calendarNotificationScheduler = null;
      pomodoroScheduleScheduler = null;
    };
  });

  $effect(() => {
    void backListenerController.setEnabled(shouldInterceptSystemBack);
  });

  $effect(() => {
    const _calendarVersion = calendar.indexVersion;
    if (!backendReady || !calendar.loaded) return;
    void calendarNotificationScheduler?.reconcile();
    void pomodoroScheduleScheduler?.reconcile();
  });

  $effect(() => {
    const _calendarVersion = calendar.indexVersion;
    const _expired = pomodoro.blockExpired;
    const _suspended = suspendDecisionOpen;
    const _idle = pomodoro.idlePaused;
    const _suppressed = pomodoro.autoStartSuppressed;
    const scheduler = activeBlockScheduler;
    if (!scheduler) return;
    const enabled = backendReady && calendar.loaded;
    const wasEnabled = scheduler.isEnabled();
    scheduler.setEnabled(enabled);
    if (enabled && wasEnabled) scheduler.invalidate();
  });

  $effect(() => {
    if (nav.current !== "notes" || !NotesSurface || !notesStore) return;
    notesSurfaceMounted = true;
  });

  $effect(() => {
    if (!showQuickNotes && !showMusic) return;
    updateUtilityPanelPositions();
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", updateUtilityPanelPositions);
    visualViewport?.addEventListener("resize", updateUtilityPanelPositions);
    visualViewport?.addEventListener("scroll", updateUtilityPanelPositions);
    return () => {
      window.removeEventListener("resize", updateUtilityPanelPositions);
      visualViewport?.removeEventListener("resize", updateUtilityPanelPositions);
      visualViewport?.removeEventListener("scroll", updateUtilityPanelPositions);
    };
  });
</script>

{#snippet loadingRing()}
  <svg
    viewBox="0 0 48 48"
    class="ganbaru-loading-ring size-12 text-foreground"
    aria-hidden="true"
  >
    <circle
      class="ganbaru-loading-ring-stroke"
      cx="24"
      cy="24"
      r="18"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
    />
  </svg>
{/snippet}

{#snippet deferredSurfacePlaceholder(
  surface: DeferredSurface,
  title: string,
  onClose: (() => void) | null = null,
)}
  <div class="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
    {#if deferredLoadErrors[surface]}
      {@const failure = deferredLoadErrors[surface]}
      <p class="text-sm font-medium" role="alert">{t("common.viewLoadFailed", title)}</p>
      <p class="max-w-md wrap-break-word text-xs text-muted-foreground">{failure.message}</p>
      <button
        type="button"
        class="min-h-12 rounded-xl border border-border bg-card px-5 text-sm font-medium active:bg-accent"
        onclick={() => retryDeferredSurface(surface)}
      >{t("common.retry")}</button>
      {#if onClose}
        <button
          type="button"
          class="min-h-12 rounded-xl px-5 text-sm font-medium active:bg-accent"
          onclick={onClose}
        >{t("common.close")}</button>
      {/if}
    {:else}
      <div role="status" aria-label={t("common.loading")}>
        {@render loadingRing()}
      </div>
    {/if}
  </div>
{/snippet}

<div
  class="mobile-app-shell mobile-viewport-height flex w-screen flex-col overflow-hidden bg-background text-foreground"
  data-size-class={viewport.sizeClass}
  style="width: calc(100vw * var(--mobile-interface-scale-inverse, 1)); height: calc(100vh * var(--mobile-interface-scale-inverse, 1)); height: calc(100dvh * var(--mobile-interface-scale-inverse, 1)); padding: var(--safe-area-top) var(--safe-area-right) var(--safe-area-bottom) var(--safe-area-left);"
>
  {#if !backendReady && !loadError}
    <section
      class="grid min-h-0 flex-1 place-items-center"
      role="status"
      aria-label={t("common.loading")}
    >
      {@render loadingRing()}
    </section>
  {:else}
  <div
    class="flex min-h-0 flex-1 flex-col"
    inert={modalOpen}
    aria-hidden={modalOpen ? "true" : undefined}
  >
    {#if PomodoroMenuSurface && LinkedDeviceControlSurface}
    <MobileTopBar
      current={nav.current}
      pomodoroTime={pomodoro.formattedTime}
      pomodoroActive={pomodoro.isActive}
      pomodoroRemainingSeconds={pomodoro.remainingSeconds}
      pomodoroTotalSeconds={pomodoro.totalSecondsForPhase}
      pomodoroPaused={pomodoro.isActive
        && pomodoro.phase === "focus"
        && !pomodoro.isRunning
        && !pomodoro.suspendedAway
        && !pomodoro.idlePaused}
      pomodoroPausedPulseAmount={pomodoro.pausedPulseAmount}
      pomodoroOpen={showPomodoro}
      {PomodoroMenuSurface}
      {LinkedDeviceControlSurface}
      quickNotesOpen={showQuickNotes}
      quickNotesDisabled={!backendReady}
      musicOpen={showMusic}
      musicDisabled={!backendReady}
      musicVisible={musicAvailable}
      primaryNavigationVisible={!useNavigationRail}
      onTogglePomodoro={() => {
        if (showPomodoro) closePomodoro();
        else openPomodoro();
      }}
      onClosePomodoro={closePomodoro}
      onOpenQuickNotes={openQuickNotes}
      onOpenMusic={openMusic}
      onOpenSettings={openSettings}
      onNavigate={navigate}
    />
    {/if}

    <div class="flex min-h-0 flex-1 overflow-hidden">
      {#if useNavigationRail}
        <MobileNavigation current={nav.current} presentation="rail" onNavigate={navigate} />
      {/if}

      <main class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        {#if loadError}
          <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
            <p class="text-sm font-medium">{t("common.viewLoadFailed", currentTitle)}</p>
            <p class="max-w-md text-xs text-muted-foreground">{loadError.message}</p>
            <button
              type="button"
              disabled={initializingWorkspace}
              class="min-h-12 rounded-xl border border-border bg-card px-5 text-sm font-medium active:bg-accent"
              onclick={retryWorkspaceLoad}
            >
              {initializingWorkspace ? t("common.loading") : t("common.retry")}
            </button>
          </div>
        {:else if nav.current === "calendar" && CalendarSurface}
          <CalendarSurface initialViewMode="day" mobileLayout />
        {:else if nav.current === "projects" && ProjectsSurface && projectViewComponents}
          <ProjectsSurface
            mobileLayout
            viewComponents={projectViewComponents}
          />
        {:else if nav.current === "notes" && NotesSurface}
          <NotesSurface mobileLayout />
        {:else if nav.current === "chat" && ChatSurface}
          <ChatSurface />
        {:else if currentDeferredSurface}
          {@render deferredSurfacePlaceholder(currentDeferredSurface, currentTitle)}
        {:else}
          <div class="flex h-full items-center justify-center">
            {@render loadingRing()}
          </div>
        {/if}
      </main>
    </div>
  </div>

  {#if MusicPlaybackHostSurface}
    <MusicPlaybackHostSurface />
  {/if}

  {#if showMusic && MusicSurface}
    <div inert={suspendDecisionOpen} aria-hidden={suspendDecisionOpen ? "true" : undefined}>
      <MusicSurface
        presentation="mobile"
        mobilePlayerPanelStyle={musicPanelStyle}
        mobilePlaylistPanelStyle={musicPlaylistPanelStyle}
        onclose={closeMusic}
      />
    </div>
  {:else if showMusic}
    <div
      class="fixed z-50 bg-background"
      inert={suspendDecisionOpen}
      aria-hidden={suspendDecisionOpen ? "true" : undefined}
      style="left: var(--visual-viewport-offset-left); top: var(--visual-viewport-offset-top); width: var(--visual-viewport-width); height: var(--visual-viewport-height); padding: var(--safe-area-top) var(--safe-area-right) var(--safe-area-bottom) var(--safe-area-left);"
    >
      {@render deferredSurfacePlaceholder("music", t("music.title"), closeMusic)}
    </div>
  {/if}

  {#if showSettings && SettingsSurface}
    <div inert={suspendDecisionOpen} aria-hidden={suspendDecisionOpen ? "true" : undefined}>
      <SettingsSurface
        presentation="mobile"
        initialSection={settingsLauncher.targetSection}
        initialDoomscrollingTab={settingsLauncher.targetDoomscrollingTab}
        initialChatSubsection={settingsLauncher.targetChatSubsection}
        initialChatTeammateId={settingsLauncher.targetChatTeammateId}
        initialChatChannelId={settingsLauncher.targetChatChannelId}
        initialChatCreateTeammate={settingsLauncher.targetChatCreateTeammate}
        onClose={closeSettings}
      />
    </div>
  {:else if showSettings}
    <div
      class="fixed z-50 bg-background"
      inert={suspendDecisionOpen}
      aria-hidden={suspendDecisionOpen ? "true" : undefined}
      style="left: var(--visual-viewport-offset-left); top: var(--visual-viewport-offset-top); width: var(--visual-viewport-width); height: var(--visual-viewport-height); padding: var(--safe-area-top) var(--safe-area-right) var(--safe-area-bottom) var(--safe-area-left);"
    >
      {@render deferredSurfacePlaceholder("settings", t("settings.title"), closeSettings)}
    </div>
  {/if}

  {#if showQuickNotes && QuickNotesSurface}
    <div inert={suspendDecisionOpen} aria-hidden={suspendDecisionOpen ? "true" : undefined}>
      <QuickNotesSurface mobileLayout mobilePanelStyle={quickNotesPanelStyle} onclose={closeQuickNotes} />
    </div>
  {:else if showQuickNotes}
    <div
      class="fixed z-50 bg-background"
      inert={suspendDecisionOpen}
      aria-hidden={suspendDecisionOpen ? "true" : undefined}
      style="left: var(--visual-viewport-offset-left); top: var(--visual-viewport-offset-top); width: var(--visual-viewport-width); height: var(--visual-viewport-height); padding: var(--safe-area-top) var(--safe-area-right) var(--safe-area-bottom) var(--safe-area-left);"
    >
      {@render deferredSurfacePlaceholder("quickNotes", t("quickNotes.title"), closeQuickNotes)}
    </div>
  {/if}

  {#if suspendInfo}
    <ConfirmDialog
      title={t("focusDialog.resumeTitle")}
      message={t("focusDialog.awayMessage", formatAwayDuration(suspendInfo.awaySeconds))}
      confirmLabel={t("focusDialog.resume")}
      cancelLabel={t("focusDialog.stopSessionCancel")}
      danger={false}
      onConfirm={() => { void pomodoro.dismissSuspend(true); }}
      onCancel={stopSuspendedSession}
      onDismiss={() => undefined}
    />
  {/if}
  {/if}

  {#await import("$lib/components/vault/VaultOwnershipPrompt.svelte") then module}
    {@const VaultOwnershipPrompt = module.default}
    <VaultOwnershipPrompt platform="android" />
  {/await}
</div>
