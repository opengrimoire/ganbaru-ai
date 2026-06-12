<script lang="ts">
  import type {
    CalendarEvent, CalendarViewMode, EventAttendee, EventColor, EventStatus, EventSurfaceStatus,
    EventTransparency, EventVisibility, GuestPermissions, AttendeeStatus,
    PomodoroConfig, RecurrenceConfig, RecurringScope,
  } from "./types";
  import {
    computeViewWindow, formatCalendarDate, formatDatePart,
    formatCalendarDateWithSeconds, getWeekDays, getWorkCycleDays,
    getEventSurfaceStatusForIdentity, getLocalTimezone,
  } from "./utils";
  import type { TimezoneAbbrMode } from "./utils";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import { calendarIdentityEmail } from "$lib/calendar/calendar-display";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { onDestroy, onMount, tick } from "svelte";
  import CalendarHeader from "./CalendarHeader.svelte";
  import WeekView from "./WeekView.svelte";
  import DayView from "./DayView.svelte";
  import MonthView from "./MonthView.svelte";
  import ActionToast from "$lib/components/ui/ActionToast.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { createEditSession } from "./edit-session.svelte";
  import type { EditSessionState, PanelAnchor } from "./edit-session.svelte";
  import { mark as perfMark } from "$lib/stores/perflog.svelte";
  import { isAppShortcutBlockedTarget, isEditableKeyboardTarget } from "$lib/utils";
  import { hasOnlyShortcutModifier } from "$lib/keyboard-shortcuts";
  import { getCalendarNavHandle } from "./nav-handle.svelte";
  import {
    HeldNavigationController,
    NAV_HOLD_DELAY_MS,
    NAV_REPEAT_MS,
    type HeldNavigationEvent,
    type HeldNavigationKey,
  } from "./held-navigation";
  import {
    closedDisplay,
    buildCreateDisplay,
    computeEditDisplay,
    PENDING_CREATE_ID,
  } from "./display-events";
  import { buildRecurringCommitPlan } from "./recurrence-edit-plan";
  import { executeRecurrenceCommitPlan } from "./recurrence-edit-executor";
  import {
    activePomodoroSaveWouldStopSession,
    endActiveEventWouldStopProductivity,
    isActiveTimedCalendarEvent,
  } from "./active-event-end";
  import { activeRootId } from "./occurrence-protection";
  import { getCalendarEventEditLock } from "./event-edit-permissions";
  import {
    DEFAULT_DAY_HEADER_RETURN_MODE,
    type DayHeaderReturnMode,
  } from "./view-navigation";
  import {
    buildCalendarDeleteArchivePlan,
    type CalendarDeleteArchiveOutcome,
    type CalendarDeleteArchivePlan,
    type CalendarDeleteArchiveRestoreSnapshot,
  } from "./delete-archive-plan";
  import { createCalendarViewToastController } from "./calendar-view-toasts.svelte";
  import { buildEventsByDay } from "./calendar-view-events-by-day";
  import { createCalendarViewConfirmationController } from "./calendar-view-confirmation.svelte";
  import {
    createCalendarOutsideCloseAction,
    panelAnchorFromRect,
    panelAnchorFromRenderedEvent as panelAnchorFromRenderedEventElement,
  } from "./calendar-view-panel-dom";
  import { createPersistedPomodoroSegmentsController } from "./calendar-view-persisted-segments.svelte";
  import { createCalendarViewTargetController } from "./calendar-view-target.svelte";

  const calendarStore = getCalendar();
  const calendarsStore = getCalendars();
  const pomodoro = getPomodoro();
  const calZoom = getCalendarZoom();
  const theme = getTheme();
  const preferences = getPreferences();
  const { t } = getLocalization();
  const toasts = createCalendarViewToastController();
  const confirm = createCalendarViewConfirmationController({
    defaultYesLabel: () => t("common.yesShortcut"),
    defaultNoLabel: () => t("common.noShortcut"),
  });
  const requestConfirm = confirm.requestConfirm;

  type EventPanelComponent = typeof import("./EventPanel.svelte").default;
  type ParkedPanelSnapshot =
    | {
        mode: "create";
        sessionKey: number;
        start: string;
        end: string;
        anchor: PanelAnchor;
        initialAllDay: boolean;
      }
    | {
        mode: "edit";
        sessionKey: number;
        event: CalendarEvent;
        recurringScopeEnabled: boolean;
        anchor: PanelAnchor;
        detailsLoaded: boolean;
        readOnly: boolean;
        allowDeleteWhenReadOnly: boolean;
        allowPomodoroWhenReadOnly: boolean;
        skipInlineDeleteConfirm: boolean;
        endActiveEventAvailable: boolean;
        inlineEndEventConfirm: boolean;
      };
  type PanelRenderState =
    | {
        parked: boolean;
        mode: "create";
        sessionKey: number;
        start: string;
        end: string;
        anchor: PanelAnchor;
        initialAllDay: boolean;
        event?: undefined;
        detailsLoaded: false;
        externalDirty: false;
        readOnly: false;
        allowDeleteWhenReadOnly: false;
        allowPomodoroWhenReadOnly: false;
        skipInlineDeleteConfirm: false;
      }
    | {
        parked: boolean;
        mode: "edit";
        sessionKey: number;
        start: "";
        end: "";
        anchor: PanelAnchor;
        initialAllDay: false;
        event: CalendarEvent;
        recurringScopeEnabled: boolean;
        detailsLoaded: boolean;
        externalDirty: boolean;
        readOnly: boolean;
        allowDeleteWhenReadOnly: boolean;
        allowPomodoroWhenReadOnly: boolean;
        skipInlineDeleteConfirm: boolean;
        endActiveEventAvailable: boolean;
        inlineEndEventConfirm: boolean;
      };
  type PanelSaveData = {
    title: string;
    start: string;
    end: string;
    color?: EventColor;
    description: string;
    recurrence?: RecurrenceConfig;
    notifications?: number[];
    pomodoroConfig?: PomodoroConfig;
    allDay?: boolean;
    meetingEnabled?: boolean;
    location?: string;
    url?: string;
    transparency?: EventTransparency;
    status?: EventStatus;
    visibility?: EventVisibility;
    attendees?: EventAttendee[];
    localParticipationStatus?: AttendeeStatus;
    guestPermissions?: GuestPermissions;
  };

  const CREATE_CLOSE_GUARD_MS = 500;

  let EventPanel = $state<EventPanelComponent | null>(null);
  let loadingEventPanel: Promise<void> | null = null;
  let panelOpenRequestId = 0;
  let parkedPanelSnapshot = $state<ParkedPanelSnapshot | null>(null);

  function loadEventPanel(): Promise<void> {
    if (EventPanel) return Promise.resolve();
    loadingEventPanel ??= import("./EventPanel.svelte")
      .then((module) => {
        EventPanel = module.default;
      })
      .finally(() => {
        loadingEventPanel = null;
      });
    return loadingEventPanel;
  }

  function ensureEventPanelReady(requestId: number): Promise<void> | undefined {
    if (EventPanel) {
      perfMark("panel.module-ready", { request: requestId });
      return undefined;
    }
    return loadEventPanel().then(() => {
      if (requestId === panelOpenRequestId) {
        perfMark("panel.module-ready", { request: requestId });
      }
    });
  }

  function closeSession() {
    const snapshot = snapshotCurrentPanel();
    if (snapshot) parkedPanelSnapshot = snapshot;
    pendingEditEventId = undefined;
    panelSurfaceStatus = undefined;
    panelSurfaceStatusEventId = undefined;
    session.close();
  }

  function handlePanelSurfaceStatusChange(status: EventSurfaceStatus | undefined) {
    const s = session.state;
    if (s.mode === "create") {
      panelSurfaceStatus = status;
      panelSurfaceStatusEventId = PENDING_CREATE_ID;
      return;
    }
    if (s.mode === "edit") {
      panelSurfaceStatus = status;
      panelSurfaceStatusEventId = s.originalEvent.id;
      return;
    }
    panelSurfaceStatus = undefined;
    panelSurfaceStatusEventId = undefined;
  }

  function markPanelPaintDone(requestId: number) {
    tick().then(() => {
      if (requestId !== panelOpenRequestId) return;
      perfMark("panel.flush-done", { request: requestId });
      requestAnimationFrame(() => {
        if (requestId === panelOpenRequestId) perfMark("panel.paint-done", { request: requestId });
      });
    });
  }

  async function waitForFrames(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  }

  const initialViewMode: CalendarViewMode = preferences.calendarViewMode;
  const initialAnchorDate = new Date();

  let viewMode: CalendarViewMode = $state(initialViewMode);
  let dayHeaderReturnMode: DayHeaderReturnMode = $state(DEFAULT_DAY_HEADER_RETURN_MODE);
  let anchorDate: Date = $state(initialAnchorDate);
  let timezones: string[] = $state([getLocalTimezone()]);
  let tzAbbrMode: TimezoneAbbrMode = $state("acronym");

  function getFocusIdleDefaults() {
    return {
      pauseWhenIdle: preferences.focusIdlePauseOnEventCreate,
      thresholdMinutes: preferences.focusIdleThresholdMinutes,
    };
  }

  // Edit session (replaces panelState, panelDirty, lastPanelChanges, etc.)
  const session = createEditSession(getFocusIdleDefaults);

  $effect(() => {
    if (session.state.mode === "create" || session.state.mode === "edit") {
      void loadEventPanel();
    }
  });

  // Display events (pure overlay, no store mutation)
  // When saving edits, suppress preview computation to prevent flash
  // (store updates before session closes, so preview would briefly conflict)
  let suppressEditPreview = $state(false);
  let panelCommitHidden = $state(false);
  let saveDisplayFreeze = $state<CalendarEvent[] | null>(null);
  let panelSurfaceStatus = $state<EventSurfaceStatus | undefined>(undefined);
  let panelSurfaceStatusEventId = $state<string | undefined>(undefined);

  // Visible viewport window. Navigation commits this target only after the
  // matching event and rail snapshots are ready.
  const viewWindow = $derived(computeViewWindow(anchorDate, viewMode));
  const multiDayRangeDays = $derived.by(() => {
    if (viewMode === "week") return getWeekDays(anchorDate);
    if (viewMode === "workweek") return getWorkCycleDays(anchorDate);
    return [];
  });

  // Keep the headless handle's cached view mode in sync so external drivers
  // (the benchmark harness) read the current value without polling.
  $effect(() => {
    getCalendarNavHandle().reportViewMode(viewMode);
  });

  function visibleStoreEventsForWindow(window: typeof viewWindow): CalendarEvent[] {
    const visIds = calendarsStore.visibleIds;
    return calendarStore
      .eventsInWindow(window.start, window.end)
      .filter((event) => visIds.has(event.calendarId));
  }

  const displayResult = $derived.by(() => {
    const storeEvents = visibleStoreEventsForWindow(viewWindow);
    if (saveDisplayFreeze) return closedDisplay(saveDisplayFreeze);
    const s = session.state;
    if (s.mode === "closed") return closedDisplay(storeEvents);
    if (s.mode === "create") return buildCreateDisplay(storeEvents, session.createPreview, session.changes, viewWindow);
    // mode === "edit": if saving, skip preview and use store directly
    if (suppressEditPreview) return closedDisplay(storeEvents);
    // Compute active date for hybrid preview (active session keeps original start)
    const now = new Date();
    const currentDate = formatDatePart(now);
    const currentTime = formatCalendarDate(now).split(" ")[1];
    const activeDate = activeDateForEditSession(s.templateId);
    return computeEditDisplay(
      calendarStore.rawBlocks,
      storeEvents,
      { originalEvent: s.originalEvent, instanceEvent: s.instanceEvent, templateId: s.templateId },
      session.dirty ? session.changes : {},
      session.scope,
      viewWindow,
      activeDate,
      currentDate,
      currentTime,
      pomodoro.isActive ? pomodoro.activeBlockId ?? undefined : undefined,
    );
  });

  function currentVisibleStoreEvents(): CalendarEvent[] {
    return visibleStoreEventsForWindow(viewWindow);
  }

  function activeBlockBelongsToTemplate(templateId: string, activeBlockId: string): boolean {
    return activeRootId({ blockId: activeBlockId }) === templateId;
  }

  function activeDateForEditSession(templateId: string): string | undefined {
    if (!pomodoro.isActive || !pomodoro.activeBlockId) return undefined;
    if (!activeBlockBelongsToTemplate(templateId, pomodoro.activeBlockId)) return undefined;
    const parts = pomodoro.activeBlockId.split("::");
    return parts[1]
      ?? activePomodoroDate(pomodoro.activeBlockId)
      ?? currentVisibleStoreEvents().find((event) => event.id === pomodoro.activeBlockId)?.start.split(" ")[0];
  }

  function activePomodoroDate(activeId: string): string | undefined {
    const [, syntheticDate] = activeId.split("::");
    if (syntheticDate) return syntheticDate;
    return pomodoro.segments.find((segment) => segment.status === "active")?.eventDate;
  }

  function buildDeleteArchivePlanForEvent(
    id: string,
    scope?: RecurringScope,
    now = new Date(),
  ): CalendarDeleteArchivePlan {
    const state = session.state;
    const selectedEvent = state.mode === "edit"
      ? state.instanceEvent
      : currentVisibleStoreEvents().find((event) => event.id === id)
        ?? calendarStore.getTemplate({ id } as CalendarEvent);
    if (!selectedEvent) throw new Error(`Calendar event '${id}' not found.`);

    const deleteScope = state.mode === "edit" && isRecurring(state.instanceEvent)
      ? effectiveRecurringScope(state, scope)
      : undefined;

    const recurringTemplateId = deleteScope
      ? (selectedEvent.recurringParentId ?? selectedEvent.id).split("::")[0]
      : undefined;
    const activeDate = recurringTemplateId ? activeDateForEditSession(recurringTemplateId) : undefined;
    const activeBlockId = pomodoro.isActive && (!recurringTemplateId || activeDate)
      ? pomodoro.activeBlockId
      : null;

    return buildCalendarDeleteArchivePlan({
      rawBlocks: calendarStore.rawBlocks,
      visibleEvents: currentVisibleStoreEvents(),
      selectedEvent,
      scope: deleteScope,
      now,
      activePomodoro: {
        blockId: activeBlockId,
        eventDate: activeDate ?? (activeBlockId ? activePomodoroDate(activeBlockId) : undefined),
      },
    });
  }

  function cloneDisplayEvents(events: CalendarEvent[]): CalendarEvent[] {
    return events.map((event) => ({ ...event }));
  }

  function buildSaveDisplayFreeze(data: Partial<CalendarEvent>, scope?: RecurringScope): CalendarEvent[] {
    const storeEvents = currentVisibleStoreEvents();
    const state = session.state;

    if (state.mode === "create") {
      return cloneDisplayEvents(
        buildCreateDisplay(storeEvents, session.createPreview, data, viewWindow).events,
      );
    }

    if (state.mode === "edit") {
      const now = new Date();
      const currentDate = formatDatePart(now);
      const currentTime = formatCalendarDate(now).split(" ")[1];
      return cloneDisplayEvents(
        computeEditDisplay(
          calendarStore.rawBlocks,
          storeEvents,
          {
            originalEvent: state.originalEvent,
            instanceEvent: state.instanceEvent,
            templateId: state.templateId,
          },
          data,
          isRecurring(state.instanceEvent) ? effectiveRecurringScope(state, scope) : scope ?? session.scope,
          viewWindow,
          activeDateForEditSession(state.templateId),
          currentDate,
          currentTime,
          pomodoro.isActive ? pomodoro.activeBlockId ?? undefined : undefined,
        ).events,
      );
    }

    return cloneDisplayEvents(displayResult.events);
  }

  const calendarIdentityById = $derived.by(() => {
    const identities = new Map<string, string>();
    for (const calendar of calendarsStore.list) {
      const identityEmail = calendarIdentityEmail(calendar);
      if (identityEmail) identities.set(calendar.id, identityEmail);
    }
    return identities;
  });

  function applyStoredSurfaceStatus(
    event: CalendarEvent,
    identityById: ReadonlyMap<string, string>,
  ): CalendarEvent {
    const surfaceStatus = getEventSurfaceStatusForIdentity(
      event,
      identityById.get(event.calendarId),
    );
    return surfaceStatus === undefined ? event : { ...event, surfaceStatus };
  }

  const surfaceDisplayEvents = $derived(
    displayResult.events.map((event) => applyStoredSurfaceStatus(event, calendarIdentityById)),
  );

  const visibleEvents = $derived.by(() => {
    if (!panelSurfaceStatus || !panelSurfaceStatusEventId) return surfaceDisplayEvents;
    return surfaceDisplayEvents.map((event) =>
      event.id === panelSurfaceStatusEventId
        ? { ...event, surfaceStatus: panelSurfaceStatus }
        : event,
    );
  });
  const persistedSegments = createPersistedPomodoroSegmentsController({
    getSegmentVersion: () => pomodoro.segmentVersion,
    visibleStoreEventsForWindow,
  });
  const targetController = createCalendarViewTargetController({
    calendarStore,
    getAnchorDate: () => anchorDate,
    getDayHeaderReturnMode: () => dayHeaderReturnMode,
    getViewMode: () => viewMode,
    getViewWindow: () => viewWindow,
    getVisibleEventCount: () => visibleEvents.length,
    persistedSegments,
    setAnchorDate: (date) => {
      anchorDate = date;
    },
    setDayHeaderReturnMode: (mode) => {
      dayHeaderReturnMode = mode;
    },
    setPreferredViewMode: (mode) => {
      preferences.setCalendarViewMode(mode);
    },
    setViewMode: (mode) => {
      viewMode = mode;
    },
  });

  $effect(() => {
    if (!calendarStore.loaded) return;
    if (!calendarStore.hasWindow(viewWindow.start, viewWindow.end)) return;
    void pomodoro.segmentVersion;
    void visibleEvents;
    persistedSegments.refreshForTarget({ mode: viewMode, date: new Date(anchorDate) });
  });
  let lastSameAnchorPrefetchKey = "";
  $effect(() => {
    if (!calendarStore.loaded) return;
    if (!calendarStore.hasWindow(viewWindow.start, viewWindow.end)) return;
    const key = `${viewMode}:${formatDatePart(anchorDate)}`;
    if (key === lastSameAnchorPrefetchKey) return;
    lastSameAnchorPrefetchKey = key;
    targetController.prefetchSameAnchor({ mode: viewMode, date: anchorDate });
  });
  let bootUsablePaintMarked = false;

  $effect(() => {
    if (bootUsablePaintMarked || !calendarStore.loaded) return;
    void visibleEvents.length;
    tick().then(() => {
      requestAnimationFrame(() => {
        if (bootUsablePaintMarked || !calendarStore.loaded) return;
        bootUsablePaintMarked = true;
        perfMark("boot.usable-paint", {
          count: visibleEvents.length,
          events: calendarStore.eventCount,
        });
      });
    });
  });

  const eventsByDay = $derived(buildEventsByDay(visibleEvents));

  let suppressEditingGlow = $state(false);
  let endingActiveEvent = $state(false);
  let pendingEditEventId = $state<string | undefined>(undefined);
  const previewedIds = $derived(suppressEditingGlow ? new Set<string>() : displayResult.previewedIds);
  const editingId = $derived(suppressEditingGlow ? undefined : displayResult.editingId);
  const visualEditingId = $derived(suppressEditingGlow ? undefined : (editingId ?? pendingEditEventId));

  // Track when drag operations end to prevent click-to-close after drag
  let lastDragEndTime = 0;
  const outsideClose = createCalendarOutsideCloseAction({
    closeGuardMs: CREATE_CLOSE_GUARD_MS,
    getConfirmOpen: () => !!confirm.action,
    getLastDragEndTime: () => lastDragEndTime,
    isPanelCommitHidden: () => panelCommitHidden,
    isSessionClosed: () => session.state.mode === "closed",
    onClose: handlePanelClose,
  });

  // Merged event for the panel (original + changes, so panel sees drag/resize updates)
  const panelEvent = $derived.by(() => {
    const s = session.state;
    if (s.mode === "edit") {
      return { ...s.originalEvent, ...session.changes } as CalendarEvent;
    }
    return undefined;
  });

  const panelDetailsLoaded = $derived(
    session.state.mode === "edit" ? session.state.detailsLoaded : false,
  );

  // Whether clicking delete for the current event+scope would stop the
  // active pomodoro session (modal will appear). When true, the panel
  // skips its inline two-step confirmation since the modal already acts
  // as a strong confirmation step.
  const deleteWouldStopSession = $derived.by(() => {
    if (session.state.mode !== "edit") return false;
    try {
      return buildDeleteArchivePlanForEvent(
        session.state.instanceEvent.id,
        isRecurring(session.state.instanceEvent)
          ? effectiveRecurringScope(session.state, session.scope)
          : undefined,
      ).requiresActiveStop;
    } catch {
      return false;
    }
  });

  const selectedEditLock = $derived.by(() => {
    const s = session.state;
    if (s.mode !== "edit") return { locked: false, allowArchive: false };
    return getCalendarEventEditLock(s.instanceEvent, calendarsStore.list, {
      isActivePomodoroEvent: isSelectedActivePomodoroOccurrence(s),
    });
  });

  function snapshotCurrentPanel(): ParkedPanelSnapshot | null {
    const s = session.state;
    if (s.mode === "create") {
      return {
        mode: "create",
        sessionKey: s.sessionKey,
        start: s.start,
        end: s.end,
        anchor: s.anchor,
        initialAllDay: !!session.changes.allDay,
      };
    }
    if (s.mode === "edit" && panelEvent) {
      const selectedActive = isSelectedEndableActiveOccurrence(s);
      const allowPomodoroWhenReadOnly = canEnablePomodoroForActiveCalendarEvent(s);
      return {
        mode: "edit",
        sessionKey: s.sessionKey,
        event: panelEvent,
        recurringScopeEnabled: isRecurring(s.originalEvent) && !selectedActive,
        anchor: s.anchor,
        detailsLoaded: panelDetailsLoaded,
        readOnly: selectedEditLock.locked,
        allowDeleteWhenReadOnly: selectedEditLock.locked && (selectedEditLock.allowArchive || selectedActive),
        allowPomodoroWhenReadOnly,
        skipInlineDeleteConfirm: deleteWouldStopSession,
        endActiveEventAvailable: false,
        inlineEndEventConfirm: false,
      };
    }
    return null;
  }

  const panelRender = $derived.by<PanelRenderState | null>(() => {
    if (panelCommitHidden) return null;
    const s = session.state;
    if (s.mode === "create") {
      return {
        parked: false,
        mode: "create",
        sessionKey: s.sessionKey,
        start: s.start,
        end: s.end,
        anchor: s.anchor,
        initialAllDay: !!session.changes.allDay,
        detailsLoaded: false,
        externalDirty: false,
        readOnly: false,
        allowDeleteWhenReadOnly: false,
        allowPomodoroWhenReadOnly: false,
        skipInlineDeleteConfirm: false,
      };
    }
    if (s.mode === "edit" && panelEvent) {
      const selectedActive = endingActiveEvent || isSelectedEndableActiveOccurrence(s);
      const allowPomodoroWhenReadOnly = !endingActiveEvent
        && canEnablePomodoroForActiveCalendarEvent(s);
      const endWouldStopProductivity = !endingActiveEvent && selectedActiveEndWouldStopProductivity(s);
      return {
        parked: false,
        mode: "edit",
        sessionKey: s.sessionKey,
        start: "",
        end: "",
        anchor: s.anchor,
        initialAllDay: false,
        event: panelEvent,
        recurringScopeEnabled: isRecurring(s.originalEvent) && !selectedActive,
        detailsLoaded: panelDetailsLoaded,
        externalDirty: session.dirty,
        readOnly: !endingActiveEvent && selectedEditLock.locked,
        allowDeleteWhenReadOnly: !endingActiveEvent
          && selectedEditLock.locked
          && (selectedEditLock.allowArchive || selectedActive),
        allowPomodoroWhenReadOnly,
        skipInlineDeleteConfirm: deleteWouldStopSession,
        endActiveEventAvailable: selectedActive,
        inlineEndEventConfirm: selectedActive && !endWouldStopProductivity,
      };
    }
    if (!parkedPanelSnapshot) return null;
    if (parkedPanelSnapshot.mode === "create") {
      return {
        parked: true,
        mode: "create",
        sessionKey: parkedPanelSnapshot.sessionKey,
        start: parkedPanelSnapshot.start,
        end: parkedPanelSnapshot.end,
        anchor: parkedPanelSnapshot.anchor,
        initialAllDay: parkedPanelSnapshot.initialAllDay,
        detailsLoaded: false,
        externalDirty: false,
        readOnly: false,
        allowDeleteWhenReadOnly: false,
        allowPomodoroWhenReadOnly: false,
        skipInlineDeleteConfirm: false,
      };
    }
    return {
      parked: true,
      mode: "edit",
      sessionKey: parkedPanelSnapshot.sessionKey,
      start: "",
      end: "",
      anchor: parkedPanelSnapshot.anchor,
      initialAllDay: false,
      event: parkedPanelSnapshot.event,
      recurringScopeEnabled: parkedPanelSnapshot.recurringScopeEnabled,
      detailsLoaded: parkedPanelSnapshot.detailsLoaded,
      externalDirty: false,
      readOnly: parkedPanelSnapshot.readOnly,
      allowDeleteWhenReadOnly: parkedPanelSnapshot.allowDeleteWhenReadOnly,
      allowPomodoroWhenReadOnly: parkedPanelSnapshot.allowPomodoroWhenReadOnly,
      skipInlineDeleteConfirm: parkedPanelSnapshot.skipInlineDeleteConfirm,
      endActiveEventAvailable: parkedPanelSnapshot.endActiveEventAvailable,
      inlineEndEventConfirm: parkedPanelSnapshot.inlineEndEventConfirm,
    };
  });

  const panelCalendarIdentityEmail = $derived.by(() => {
    if (!panelRender || panelRender.mode !== "edit") return undefined;
    return calendarIdentityEmail(
      calendarsStore.list.find((calendar) => calendar.id === panelRender.event.calendarId),
    );
  });

  function isRecurring(event: CalendarEvent): boolean {
    return !!event.recurringParentId || !!event.recurrence;
  }

  function isLocalWritableEvent(event: CalendarEvent): boolean {
    const calendar = calendarsStore.list.find((item) => item.id === event.calendarId);
    return calendar?.source === "local" && calendar.readOnly !== true;
  }

  function isSelectedActivePomodoroOccurrence(s: Extract<EditSessionState, { mode: "edit" }>): boolean {
    if (!pomodoro.isActive || !pomodoro.activeBlockId) return false;
    if (!isRecurring(s.originalEvent)) return s.originalEvent.id === pomodoro.activeBlockId;
    return activeDateForEditSession(s.templateId) === s.instanceEvent.start.split(" ")[0];
  }

  function isSelectedActiveCalendarOccurrence(s: Extract<EditSessionState, { mode: "edit" }>): boolean {
    return isLocalWritableEvent(s.originalEvent) && isActiveTimedCalendarEvent(s.instanceEvent);
  }

  function isSelectedEndableActiveOccurrence(s: Extract<EditSessionState, { mode: "edit" }>): boolean {
    return isSelectedActivePomodoroOccurrence(s) || isSelectedActiveCalendarOccurrence(s);
  }

  function canEnablePomodoroForActiveCalendarEvent(
    s: Extract<EditSessionState, { mode: "edit" }>,
  ): boolean {
    return !pomodoro.isActive
      && !isRecurring(s.originalEvent)
      && !s.instanceEvent.pomodoroConfig
      && isSelectedActiveCalendarOccurrence(s);
  }

  function selectedActiveEndWouldStopProductivity(
    s: Extract<EditSessionState, { mode: "edit" }>,
  ): boolean {
    if (!isSelectedActivePomodoroOccurrence(s)) return false;
    return endActiveEventWouldStopProductivity(
      s.instanceEvent,
      currentVisibleStoreEvents(),
      new Date(),
    );
  }

  function effectiveRecurringScope(
    s: Extract<EditSessionState, { mode: "edit" }>,
    requested?: RecurringScope,
  ): RecurringScope {
    return isSelectedEndableActiveOccurrence(s) ? "this" : requested ?? session.scope;
  }

  /** Would this save remove the active pomodoro or move it out of the current time window? */
  function wouldSaveStopSession(data: PanelSaveData, _scope?: RecurringScope): boolean {
    if (!pomodoro.isActive || !pomodoro.activeBlockId || session.state.mode !== "edit") return false;

    const s = session.state;
    // Active recurring occurrences are isolated to this occurrence. Future
    // "following" or "all" edits in the same series do not move the active run.
    if (!isSelectedActivePomodoroOccurrence(s)) return false;
    return activePomodoroSaveWouldStopSession(data);
  }

  // Flag: the user confirmed the session stop but the actual stopSession() call
  // must happen after the save because hybrid logic needs activeBlockId intact.
  let sessionStopPending = false;

  // The picker enforces this same cap; keep them in sync if you change one.
  const MAX_TIMEZONES = 5;

  function addTimezone(tz: string) {
    if (timezones.length < MAX_TIMEZONES && !timezones.includes(tz)) {
      timezones = [...timezones, tz];
    }
  }

  function removeTimezone(index: number) {
    // The device timezone (resolved at render time) is the only one that
    // can't be removed; other rows are free to leave regardless of index.
    if (index < 0 || index >= timezones.length) return;
    if (timezones[index] === getLocalTimezone()) return;
    timezones = timezones.filter((_, i) => i !== index);
  }

  function reorderTimezone(from: number, to: number) {
    if (from < 0 || to < 0) return;
    if (from >= timezones.length || to >= timezones.length) return;
    if (from === to) return;
    const next = [...timezones];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    timezones = next;
  }

  function saveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return t("calendar.view.unknownSaveError");
  }

  function logPanelSaveError(
    context: "enable-active-pomodoro" | "panel-save",
    error: unknown,
    data: PanelSaveData,
    scope?: RecurringScope,
  ): void {
    const s = session.state;
    console.error("[CalendarView] event save failed", {
      context,
      mode: s.mode,
      eventId: s.mode === "edit" ? s.originalEvent.id : undefined,
      scope,
      keys: Object.keys(data).sort(),
      hasPomodoroConfig: !!data.pomodoroConfig,
      allDay: !!data.allDay,
      error,
    });
  }

  async function undoDeletedEvent(): Promise<void> {
    const toast = toasts.deleteUndoToast;
    if (!toast?.restore) return;
    toasts.dismissDeleteUndoToast();
    try {
      await toast.restore();
    } catch (e) {
      console.error("[calendar] failed to restore deleted event:", e);
    }
  }

  async function restoreDeletedBlock(e: CalendarEvent): Promise<void> {
    await calendarStore.addBlock({
      id: e.id, title: e.title, start: e.start, end: e.end,
      timezone: e.timezone, calendarId: e.calendarId, color: e.color,
      description: e.description, recurrence: e.recurrence,
      notifications: e.notifications, exceptions: e.exceptions,
      pomodoroConfig: e.pomodoroConfig,
      allDay: e.allDay, location: e.location, url: e.url,
      meetingEnabled: e.meetingEnabled,
      transparency: e.transparency, status: e.status,
      sourceUid: e.sourceUid, visibility: e.visibility,
      priority: e.priority, categories: e.categories, geo: e.geo,
      sequence: e.sequence, rdate: e.rdate,
      extendedProperties: e.extendedProperties,
      organizer: e.organizer, attendees: e.attendees,
      localParticipationStatus: e.localParticipationStatus,
      guestPermissions: e.guestPermissions,
    });
  }

  async function hydrateRestoreSnapshot(
    snapshot: CalendarDeleteArchiveRestoreSnapshot,
  ): Promise<CalendarDeleteArchiveRestoreSnapshot> {
    const full = await calendarStore.loadFullEvent(snapshot.event.id);
    if (!full) return snapshot;
    return {
      ...snapshot,
      event: {
        ...full,
        exceptions: [...(snapshot.event.exceptions ?? full.exceptions ?? [])],
      },
    };
  }

  async function buildRestoreCallbackForDeletePlan(
    plan: CalendarDeleteArchivePlan,
  ): Promise<(() => Promise<void>) | undefined> {
    const snapshots = await Promise.all(plan.restore.snapshots.map(hydrateRestoreSnapshot));
    if (plan.restore.archivedEvents.length === 0 && snapshots.length === 0) return undefined;
    return async () => {
      for (const event of plan.restore.archivedEvents) {
        await calendarStore.restoreArchivedBlock(event);
      }
      for (const snapshot of snapshots) {
        if (snapshot.restoreMode === "insert") {
          await restoreDeletedBlock(snapshot.event);
        } else {
          await calendarStore.updateBlock(snapshot.event);
        }
      }
      await calendarStore.refreshWindow(viewWindow.start, viewWindow.end);
    };
  }

  onDestroy(() => {
    toasts.destroy();
  });

  let containerEl: HTMLDivElement | undefined = $state();

  // Shared scroll position (preserved across view switches)
  let scrollMinute = $state(-1);
  let viewWrapperEl: HTMLDivElement | undefined = $state();

  // rAF-based arrow key scrolling for day/week views
  const SCROLL_PX_PER_SEC = 600;
  let arrowScrollDir = 0;
  let arrowScrollRaf = 0;
  let arrowScrollPrev = 0;

  // Held-arrow navigation fires once immediately, then runs gated repeat
  // ticks after a hold delay. Busy calendar frames skip their tick instead
  // of building delayed movement after keyup.
  let navReleaseSeq = 0;

  function markHeldNav(event: HeldNavigationEvent) {
    getCalendarNavHandle().reportHeldNavigation(event);
    if (event.type === "hold-start") {
      perfMark("nav.hold-start", { key: event.key, dir: event.direction });
    } else if (event.type === "hold-stop") {
      perfMark("nav.hold-stop", { key: event.key, repeats: event.repeats });
    } else if (event.type === "repeat-skip") {
      perfMark("nav.repeat-skip", { key: event.key, repeats: event.repeats, reason: event.reason });
    } else if (event.type === "repeat") {
      perfMark("nav.repeat", { key: event.key, dir: event.direction, repeats: event.repeats });
    } else {
      perfMark("nav.repeat-cancelled", { key: event.key, stage: event.stage });
    }
  }

  const heldNavigation = new HeldNavigationController({
    holdDelayMs: NAV_HOLD_DELAY_MS,
    repeatMs: NAV_REPEAT_MS,
    navigate: (direction, source) => navigate(direction, source),
    canRepeat: targetController.canRepeatHeldNavigation,
    mark: markHeldNav,
  });

  function startNavHold(
    key: HeldNavigationKey,
    direction: "forward" | "back",
    repeated = false,
  ) {
    if (heldNavigation.activeKey === key) {
      if (repeated) heldNavigation.armRepeatsFromKeydown(key);
      return;
    }
    if (repeated) return;
    heldNavigation.start(key, direction);
  }

  function stopNavHold(key?: HeldNavigationKey) {
    const stoppedKey = heldNavigation.stop(key);
    if (stoppedKey) {
      markNavReleaseTail(stoppedKey);
    }
  }

  function markNavReleaseTail(key: string) {
    const seq = ++navReleaseSeq;
    const releasedAt = performance.now();
    void targetController.waitForSettled()
      .then(() => {
        if (seq !== navReleaseSeq) return;
        perfMark("nav.release-tail", {
          key,
          ms: Math.round(performance.now() - releasedAt),
          count: visibleEvents.length,
        });
      });
  }

  function arrowScrollStep(ts: number) {
    if (arrowScrollDir === 0) return;
    if (!arrowScrollPrev) arrowScrollPrev = ts;
    const dt = ts - arrowScrollPrev;
    arrowScrollPrev = ts;
    const el = viewWrapperEl?.querySelector(".hide-scrollbar");
    if (el) el.scrollTop += arrowScrollDir * SCROLL_PX_PER_SEC * (dt / 1000);
    arrowScrollRaf = requestAnimationFrame(arrowScrollStep);
  }

  function startArrowScroll(dir: -1 | 1) {
    if (arrowScrollDir === dir) return;
    arrowScrollDir = dir;
    arrowScrollPrev = 0;
    if (!arrowScrollRaf) arrowScrollRaf = requestAnimationFrame(arrowScrollStep);
  }

  function stopArrowScroll() {
    arrowScrollDir = 0;
    if (arrowScrollRaf) { cancelAnimationFrame(arrowScrollRaf); arrowScrollRaf = 0; }
  }

  onMount(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (
        e.key !== "Escape" &&
        (isEditableKeyboardTarget(e.target) ||
          isEditableKeyboardTarget(document.activeElement) ||
          isAppShortcutBlockedTarget(e.target) ||
          isAppShortcutBlockedTarget(document.activeElement))
      ) {
        return;
      }

      if (e.key === "Escape" && session.state.mode !== "closed") {
        e.preventDefault();
        handlePanelClose();
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && session.state.mode === "closed" && !confirm.action) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          startNavHold("ArrowLeft", "back", e.repeat);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          startNavHold("ArrowRight", "forward", e.repeat);
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          if (viewMode === "month") {
            startNavHold(e.key, e.key === "ArrowUp" ? "back" : "forward", e.repeat);
          } else {
            startArrowScroll(e.key === "ArrowUp" ? -1 : 1);
          }
        }
      }
    }

    function handleKeyup(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        stopNavHold(e.key);
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          stopArrowScroll();
        }
      }
    }

    function handleBlur() {
      stopArrowScroll();
      stopNavHold();
    }

    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("keyup", handleKeyup);
    window.addEventListener("blur", handleBlur);

    tick().then(() => {
      requestAnimationFrame(() => {
        perfMark("boot.first-paint", { count: visibleEvents.length });
      });
    });

    // Expose navigate / view-mode setters through the headless handle so the
    // benchmark harness (and any future scripted driver) can drive the
    // calendar without reaching into component internals.
    const navHandle = getCalendarNavHandle();
    const unregisterNav = navHandle.register({
      navigate,
      setViewMode: (mode) => changeView(mode),
      setAnchorDate: (date) => {
        void targetController.request({ mode: targetController.currentState().mode, date }, {
          history: false,
          reason: "programmatic",
        });
      },
      openVisibleEvent: openVisibleEventForBenchmark,
      getVisibleEventCount: getVisibleEventCountForBenchmark,
      openCreatePanel: openCreatePanelForBenchmark,
      closePanel: closePanelForBenchmark,
      canRepeatHeldNavigation: targetController.canRepeatHeldNavigation,
      getViewMode: () => viewMode,
    });

    return () => {
      unregisterNav();
      stopArrowScroll();
      stopNavHold();
      targetController.clearPending();
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("keyup", handleKeyup);
      window.removeEventListener("blur", handleBlur);
    };
  });

  function navigate(
    direction: "today" | "back" | "forward",
    source: "programmatic" | "wheel" | "key" | "hold-repeat" = "programmatic",
  ) {
    perfMark("nav.start", { dir: direction, source });
    if (direction === "today") {
      void targetController.request(
        { mode: targetController.currentState().mode, date: new Date() },
        { history: false, reason: "nav" },
      );
      return;
    }

    void targetController.request(
      {
        mode: targetController.currentState().mode,
        date: targetController.targetAnchorForNavigation(direction),
      },
      { history: false, reason: "nav" },
    );
  }

  function handleWheelNavigate(direction: "back" | "forward") {
    navigate(direction, "wheel");
  }

  function changeView(mode: CalendarViewMode) {
    perfMark("view.start", { from: viewMode, to: mode });
    void targetController.request(
      { mode, date: targetController.currentState().date },
      { history: true, reason: "view" },
    );
  }

  async function handleEventCreate(start: string, end: string, allDay?: boolean, createAnchor?: PanelAnchor) {
    if (panelCommitHidden) return;

    const openCreate = async () => {
      const requestId = ++panelOpenRequestId;
      pendingEditEventId = undefined;
      // Track that a create operation ended (prevents click-to-close)
      lastDragEndTime = Date.now();

      const anchor: PanelAnchor = createAnchor
        ?? { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };

      const panelState = session.state.mode === "closed"
        ? parkedPanelSnapshot ? "unpark" : "open"
        : "switch";
      perfMark("panel.start", {
        mode: "create",
        state: panelState,
        module: EventPanel ? "loaded" : "cold",
        request: requestId,
      });
      try {
        const panelReady = ensureEventPanelReady(requestId);
        session.openCreate(start, end, anchor, allDay);
        perfMark("panel.state-open", { request: requestId });
        if (panelReady) await panelReady;
        if (requestId !== panelOpenRequestId) return;
        markPanelPaintDone(requestId);
      } catch (e) {
        console.error("[CalendarView] open create panel failed:", e);
      }
    };

    if (session.dirty) {
      requestConfirm(
        t("calendar.view.changesLost"),
        openCreate,
        {
          title: t("calendar.view.discardUnsavedTitle"),
          yesLabel: t("calendar.view.discard"),
          noLabel: t("common.cancelShortcut"),
        },
      );
      return;
    }

    await openCreate();
  }

  function panelAnchorFromRenderedEvent(eventId: string): PanelAnchor {
    return panelAnchorFromRenderedEventElement(containerEl, eventId);
  }

  async function handleEventClick(event: CalendarEvent, rect?: DOMRect): Promise<void> {
    if (panelCommitHidden) return;
    if (event.id === PENDING_CREATE_ID || event.id.startsWith(PENDING_CREATE_ID + "::")) return;

    // Already editing this exact event. A clean panel is just a peek and can
    // be toggled closed. Dirty edits stay open so the block click does not
    // trigger discard confirmation.
    if (session.state.mode === "edit" && (
      session.state.originalEvent.id === event.id || editingId === event.id
    )) {
      if (!session.dirty) handlePanelClose();
      return;
    }

    const anchor = panelAnchorFromRect(rect);

    const openEvent = async () => {
      const requestId = ++panelOpenRequestId;
      pendingEditEventId = event.id;
      const panelState = session.state.mode === "closed"
        ? parkedPanelSnapshot ? "unpark" : "open"
        : "switch";
      perfMark("panel.start", {
        mode: "edit",
        state: panelState,
        module: EventPanel ? "loaded" : "cold",
        request: requestId,
      });
      try {
        const lookupId = event.recurringParentId ?? event.id;
        const [fullEvent] = await Promise.all([
          calendarStore.loadPanelEvent(lookupId).then((full) => {
            if (requestId === panelOpenRequestId) {
              perfMark("panel.details-ready", { found: full ? 1 : 0, request: requestId });
            }
            return full;
          }),
          ensureEventPanelReady(requestId) ?? Promise.resolve(),
        ]);
        if (requestId !== panelOpenRequestId) return;
        const hydratedEvent = fullEvent
          ? ({ ...fullEvent, ...event } as CalendarEvent)
          : event;
        if (isRecurring(event)) {
          session.openEdit(hydratedEvent, anchor, hydratedEvent, !!fullEvent);
        } else {
          session.openEdit(hydratedEvent, anchor, undefined, !!fullEvent);
        }
        perfMark("panel.state-open", { request: requestId });
        markPanelPaintDone(requestId);
      } catch (e) {
        console.error("[CalendarView] open event failed:", e);
      } finally {
        if (requestId === panelOpenRequestId) pendingEditEventId = undefined;
      }
    };

    if (session.dirty) {
      requestConfirm(
        t("calendar.view.changesLost"),
        async () => { await openEvent(); },
        {
          title: t("calendar.view.discardUnsavedTitle"),
          yesLabel: t("calendar.view.discard"),
          noLabel: t("common.cancelShortcut"),
        },
      );
      return;
    }

    await openEvent();
  }

  function handleEventPrefetch(event: CalendarEvent) {
    if (event.id === PENDING_CREATE_ID || event.id.startsWith(PENDING_CREATE_ID + "::")) return;
    calendarStore.prefetchPanelEvent(event.recurringParentId ?? event.id);
  }

  async function openVisibleEventForBenchmark(index: number): Promise<boolean> {
    const event = visibleEvents.filter((item) => !item.id.startsWith(PENDING_CREATE_ID))[index];
    if (!event) return false;
    await handleEventClick(event);
    await tick();
    await waitForFrames(2);
    return true;
  }

  function getVisibleEventCountForBenchmark(): number {
    return visibleEvents.filter((item) => !item.id.startsWith(PENDING_CREATE_ID)).length;
  }

  async function openCreatePanelForBenchmark(
    start: string,
    end: string,
    allDay?: boolean,
  ): Promise<boolean> {
    await handleEventCreate(start, end, allDay);
    await tick();
    await waitForFrames(2);
    return true;
  }

  async function closePanelForBenchmark(): Promise<void> {
    handlePanelClose();
    await tick();
    await waitForFrames(2);
  }

  async function handleEventUpdate(event: CalendarEvent) {
    if (panelCommitHidden) return;

    // Track that a drag operation ended (prevents click-to-close)
    lastDragEndTime = Date.now();

    // Pseudo-event from create preview drag/resize
    if (event.id === PENDING_CREATE_ID) {
      if (session.state.mode === "create") {
        session.updateChanges({ start: event.start, end: event.end });
      }
      return;
    }

    // If panel is open for this exact event, route drag through session so
    // pending field edits (title, pomodoro config, etc.) are not silently
    // discarded by an auto-save. The user must click Save to commit.
    // Covers both non-recurring and recurring (including virtual IDs from
    // Following/All scope overlays).
    if (session.state.mode === "edit" && (
      session.state.originalEvent.id === event.id || editingId === event.id
    )) {
      session.updateChanges({ start: event.start, end: event.end });
      return;
    }

    if (!isRecurring(event) && pomodoro.isActive && pomodoro.activeBlockId === event.id) {
      const originalInstance = visibleEvents.find((e) => e.id === event.id);
      if (!originalInstance) return;

      const anchor = panelAnchorFromRenderedEvent(event.id);

      if (session.dirty) {
        requestConfirm(
          t("calendar.view.changesLost"),
          async () => {
            await loadEventPanel();
            session.openEdit(originalInstance, anchor, originalInstance);
            session.updateChanges({ start: event.start, end: event.end });
          },
          {
            title: t("calendar.view.discardUnsavedTitle"),
            yesLabel: t("calendar.view.discard"),
            noLabel: t("common.cancelShortcut"),
          },
        );
        return;
      }

      await loadEventPanel();
      session.openEdit(originalInstance, anchor, originalInstance);
      session.updateChanges({ start: event.start, end: event.end });
      return;
    }

    if (isRecurring(event)) {
      // Resolve the original instance before drag modified its position
      const originalInstance = visibleEvents.find((e) => e.id === event.id);
      if (!originalInstance) return;

      // If session is dirty, ask to discard before switching
      if (session.dirty) {
        const anchor = panelAnchorFromRenderedEvent(event.id);
        requestConfirm(
          t("calendar.view.changesLost"),
          async () => {
            // Open with the pre-drag instance as originalEvent so the
            // session baseline starts from pre-drag values before the drag
            // delta is applied to changes.
            await loadEventPanel();
            session.openEdit(originalInstance, anchor, originalInstance);
            session.updateChanges({ start: event.start, end: event.end });
          },
          {
            title: t("calendar.view.discardUnsavedTitle"),
            yesLabel: t("calendar.view.discard"),
            noLabel: t("common.cancelShortcut"),
          },
        );
        return;
      }

      // Drag on recurring without panel open: open panel with changes
      const anchor = panelAnchorFromRenderedEvent(event.id);

      await loadEventPanel();
      session.openEdit(originalInstance, anchor, originalInstance);
      session.updateChanges({ start: event.start, end: event.end });
      return;
    }

    // Non-recurring: persist directly (no panel needed for drag)
    const template = calendarStore.getTemplate(event);
    // Skip DB update if position didn't actually change (drag ended at same spot)
    if (template && template.start === event.start && template.end === event.end) {
      return;
    }
    await calendarStore.updateBlock(event);
  }

  function handlePanelChange(data: Partial<CalendarEvent>) {
    session.updateChanges(data);
  }

  function handlePanelInitialSync(data: Partial<CalendarEvent>) {
    session.setInitialChanges(data);
  }

  function handleScopeChange(newScope: RecurringScope) {
    session.updateScope(newScope);
  }

  function handlePanelClose() {
    if (panelCommitHidden) return;
    panelOpenRequestId++;
    pendingEditEventId = undefined;
    if (session.dirty) {
      requestConfirm(
        t("calendar.view.changesLost"),
        async () => { closeSession(); },
        {
          title: t("calendar.view.discardUnsavedTitle"),
          yesLabel: t("calendar.view.discard"),
          noLabel: t("common.cancelShortcut"),
        },
      );
      return;
    }
    closeSession();
  }

  async function persistPanelData(
    data: PanelSaveData,
    scope?: RecurringScope,
    options: { syncActivePomodoro?: boolean } = {},
  ): Promise<boolean> {
    const s = session.state;
    let saveRefreshedVisibleWindow = false;
    const syncActivePomodoro = options.syncActivePomodoro ?? true;
    if (s.mode === "closed") return false;
    if (s.mode === "create") {
      await calendarStore.addBlock({
        title: data.title, start: data.start, end: data.end,
        color: data.color, description: data.description,
        recurrence: data.recurrence, notifications: data.notifications,
        pomodoroConfig: data.pomodoroConfig,
        allDay: data.allDay, location: data.location, url: data.url,
        meetingEnabled: data.meetingEnabled,
        transparency: data.transparency, status: data.status,
        visibility: data.visibility, attendees: data.attendees,
        localParticipationStatus: data.localParticipationStatus,
        guestPermissions: data.guestPermissions,
      });
    } else if (s.mode === "edit") {
      const instanceEvent = s.instanceEvent;
      const isRec = isRecurring(s.originalEvent);

      const effectiveScope = isRec ? effectiveRecurringScope(s, scope) : undefined;
      if (isRec && effectiveScope) {
        const now = new Date();
        const activeDate = activeDateForEditSession(s.templateId);
        const recurrencePlan = buildRecurringCommitPlan({
          rawBlocks: calendarStore.rawBlocks,
          templateId: s.templateId,
          instanceEvent,
          changes: data,
          scope: effectiveScope,
          activeBlockId: pomodoro.isActive && activeDate ? pomodoro.activeBlockId ?? undefined : undefined,
          activeDate,
          today: formatDatePart(now),
          currentTime: formatCalendarDate(now).split(" ")[1],
        });
        const blockingDiagnostic = recurrencePlan.diagnostics.find((diagnostic) => diagnostic.severity === "error");
        if (blockingDiagnostic) throw new Error(blockingDiagnostic.message);
        await executeRecurrenceCommitPlan(recurrencePlan, {
          calendarStore,
          pomodoro,
          window: viewWindow,
        });
        saveRefreshedVisibleWindow = recurrencePlan.requiresCanonicalRefresh;
      } else {
        const updated: CalendarEvent = { ...s.originalEvent, ...data };
        await calendarStore.updateBlock(updated);
        if (syncActivePomodoro) await syncSavedActivePomodoro(updated);
      }
    }

    return saveRefreshedVisibleWindow;
  }

  function shouldEnablePomodoroForActiveCalendarEvent(data: PanelSaveData): boolean {
    const s = session.state;
    return s.mode === "edit"
      && canEnablePomodoroForActiveCalendarEvent(s)
      && !!data.pomodoroConfig;
  }

  async function enablePomodoroForActiveCalendarEvent(data: PanelSaveData): Promise<void> {
    const s = session.state;
    const config = data.pomodoroConfig;
    if (s.mode !== "edit" || !config || !canEnablePomodoroForActiveCalendarEvent(s)) return;

    suppressEditingGlow = true;
    suppressEditPreview = true;
    saveDisplayFreeze = buildSaveDisplayFreeze(data);
    const saveToastId = toasts.showSavePendingToast(t("calendar.view.saving"));

    try {
      const updated: CalendarEvent = { ...s.originalEvent, ...data };
      await calendarStore.updateBlock(updated);
      await pomodoro.startFromBlock(
        s.originalEvent.id,
        config,
        data.end,
        data.start.split(" ")[0],
        config.idleTimeoutMinutes,
      );
      await calendarStore.refreshWindow(viewWindow.start, viewWindow.end);
      closeSession();
      toasts.showSaveSuccessToast(saveToastId, t("calendar.view.saved"));
      await tick();
    } catch (error) {
      logPanelSaveError("enable-active-pomodoro", error, data);
      toasts.showSaveErrorToast(saveToastId, t("calendar.view.saveFailed", saveErrorMessage(error)));
    } finally {
      if (toasts.saveSuccessToast?.id === saveToastId && toasts.saveSuccessToast.pending) {
        toasts.dismissSaveToastIfCurrent(saveToastId);
      }
      suppressEditingGlow = false;
      suppressEditPreview = false;
      saveDisplayFreeze = null;
    }
  }

  async function handlePanelSave(data: PanelSaveData, scope?: RecurringScope) {
    // Gate: confirm before stopping the active pomodoro session.
    // stopSession() is deferred until after the save so hybrid logic still sees activeBlockId.
    if (!sessionStopPending && wouldSaveStopSession(data, scope)) {
      requestConfirm(
        t("calendar.view.stopCurrentFocusSession"),
        async () => {
          sessionStopPending = true;
          await handlePanelSave(data, scope);
        },
        {
          title: t("calendar.view.saveAndStopTitle"),
          yesLabel: t("calendar.view.stopAndSave"),
          noLabel: t("calendar.view.keepEditing"),
        },
      );
      return;
    }

    if (shouldEnablePomodoroForActiveCalendarEvent(data)) {
      await enablePomodoroForActiveCalendarEvent(data);
      return;
    }

    const s = session.state;
    let saveRefreshedVisibleWindow = false;
    const suppressPomodoroAutoStart = s.mode === "edit" && pomodoro.isActive && !!pomodoro.activeBlockId;
    // While save is in flight, hide edit outlines but keep the previewed
    // layout until canonical reload has updated the store. Capture from the
    // submitted save payload before suppressing preview recomputation.
    const saveFreeze = buildSaveDisplayFreeze(data, scope);
    suppressEditingGlow = true;
    suppressEditPreview = true;
    saveDisplayFreeze = saveFreeze;
    if (suppressPomodoroAutoStart) pomodoro.autoStartSuppressed = true;
    const saveToastId = toasts.showSavePendingToast(t("calendar.view.saving"));

    try {
      saveRefreshedVisibleWindow = await persistPanelData(data, scope);

      // Stop session after all mutations complete because hybrid save logic needs activeBlockId intact.
      if (sessionStopPending) {
        await pomodoro.stopSession();
        sessionStopPending = false;
      }
      if (!saveRefreshedVisibleWindow) {
        await calendarStore.refreshWindow(viewWindow.start, viewWindow.end);
      }
      closeSession();
      toasts.showSaveSuccessToast(saveToastId, t("calendar.view.saved"));
      await tick();
    } catch (error) {
      sessionStopPending = false;
      logPanelSaveError("panel-save", error, data, scope);
      toasts.showSaveErrorToast(saveToastId, t("calendar.view.saveFailed", saveErrorMessage(error)));
    } finally {
      if (toasts.saveSuccessToast?.id === saveToastId && toasts.saveSuccessToast.pending) {
        toasts.dismissSaveToastIfCurrent(saveToastId);
      }
      if (suppressPomodoroAutoStart) pomodoro.autoStartSuppressed = false;
      suppressEditingGlow = false;
      suppressEditPreview = false;
      saveDisplayFreeze = null;
    }
  }

  async function executeEndEvent(data: PanelSaveData, scope?: RecurringScope) {
    const s = session.state;
    if (s.mode !== "edit" || !isSelectedEndableActiveOccurrence(s)) return;

    const actualEnd = new Date();
    const end = formatCalendarDateWithSeconds(actualEnd);
    const endedData: PanelSaveData = { ...data, end };
    const endIso = actualEnd.toISOString();
    const saveFreeze = buildSaveDisplayFreeze(endedData, scope);
    let saveRefreshedVisibleWindow = false;
    const completesPomodoro = isSelectedActivePomodoroOccurrence(s);
    const suppressPomodoroAutoStart = pomodoro.isActive && !!pomodoro.activeBlockId;
    endingActiveEvent = true;
    suppressEditingGlow = true;
    suppressEditPreview = true;
    saveDisplayFreeze = saveFreeze;
    if (suppressPomodoroAutoStart) pomodoro.autoStartSuppressed = true;

    try {
      if (!completesPomodoro && !isRecurring(s.originalEvent)) {
        await calendarStore.updateBlock({ id: s.originalEvent.id, end: endedData.end });
      } else {
        saveRefreshedVisibleWindow = await persistPanelData(endedData, scope, {
          syncActivePomodoro: false,
        });
      }
      if (completesPomodoro) {
        await pomodoro.completeActiveBlockAt(endIso);
      }
      if (!saveRefreshedVisibleWindow) {
        await calendarStore.refreshWindow(viewWindow.start, viewWindow.end);
      }
      closeSession();
      await tick();
    } finally {
      if (suppressPomodoroAutoStart) pomodoro.autoStartSuppressed = false;
      endingActiveEvent = false;
      suppressEditingGlow = false;
      suppressEditPreview = false;
      saveDisplayFreeze = null;
    }
  }

  async function handleEndEvent(data: PanelSaveData, scope?: RecurringScope) {
    if (endingActiveEvent) return;
    const s = session.state;
    if (s.mode !== "edit" || !isSelectedEndableActiveOccurrence(s)) return;

    if (selectedActiveEndWouldStopProductivity(s)) {
      requestConfirm(
        t("calendar.view.stopCurrentFocusSession"),
        async () => {
          await executeEndEvent(data, scope);
        },
        {
          title: t("calendar.view.stopFocusSessionTitle"),
          yesLabel: t("calendar.view.endEventConfirm"),
          noLabel: t("calendar.view.keepSession"),
          extraConfirmShortcut: (e) =>
            (e.key === "d" || e.key === "D") && hasOnlyShortcutModifier(e),
        },
      );
      return;
    }

    await executeEndEvent(data, scope);
  }

  function eventDeleteOutcomeLabel(outcome: CalendarDeleteArchiveOutcome): string {
    if (outcome === "archive") return t("calendar.view.eventArchived");
    if (outcome === "mixed") return t("calendar.view.eventsDeletedAndArchived");
    return t("calendar.view.eventDeleted");
  }

  function eventDeletePendingLabel(outcome: CalendarDeleteArchiveOutcome): string {
    if (outcome === "archive") return t("calendar.view.archiving");
    if (outcome === "mixed") return t("calendar.view.deletingAndArchiving");
    return t("calendar.view.deleting");
  }

  async function syncSavedActivePomodoro(event: CalendarEvent): Promise<void> {
    const activeId = pomodoro.activeBlockId;
    const config = event.pomodoroConfig;
    if (!pomodoro.isActive || !activeId || event.id !== activeId || !config) return;
    await pomodoro.startFromBlock(
      activeId,
      config,
      event.end,
      event.start.split(" ")[0],
      config.idleTimeoutMinutes,
    );
  }

  async function executeDeleteArchivePlan(
    plan: CalendarDeleteArchivePlan,
    stopActiveSession: boolean,
  ): Promise<void> {
    const activeBlockId = pomodoro.isActive ? pomodoro.activeBlockId : null;
    suppressEditPreview = true;
    panelCommitHidden = true;
    saveDisplayFreeze = cloneDisplayEvents(plan.finalVisibleEvents);
    const deleteToastId = toasts.showDeletePendingToast(eventDeletePendingLabel(plan.outcome));

    try {
      const restoreDeleted = await buildRestoreCallbackForDeletePlan(plan);
      if (stopActiveSession && activeBlockId) {
        pomodoro.dismissedBlockId = activeBlockId;
        await pomodoro.stopSession();
      }
      await calendarStore.applyDeleteArchivePlan(plan.operations);
      await calendarStore.refreshWindow(viewWindow.start, viewWindow.end);
      closeSession();
      toasts.showDeleteUndoToast(deleteToastId, eventDeleteOutcomeLabel(plan.outcome), restoreDeleted);
    } finally {
      if (toasts.deleteUndoToast?.id === deleteToastId && toasts.deleteUndoToast.pending) {
        toasts.dismissDeleteToastIfCurrent(deleteToastId);
      }
      suppressEditPreview = false;
      panelCommitHidden = false;
      saveDisplayFreeze = null;
    }
  }

  async function handleDelete(id: string, scope?: RecurringScope) {
    const plan = buildDeleteArchivePlanForEvent(id, scope);
    if (plan.requiresActiveStop) {
      requestConfirm(
        plan.outcome === "archive"
          ? t("calendar.view.stopBeforeArchived")
          : t("calendar.view.stopBeforeDeleted"),
        async () => {
          await executeDeleteArchivePlan(plan, true);
        },
        {
          title: plan.outcome === "archive"
            ? t("calendar.view.stopAndArchiveEventTitle")
            : t("calendar.view.stopAndDeleteEventTitle"),
          yesLabel: plan.outcome === "archive"
            ? t("calendar.view.stopAndArchive")
            : t("calendar.view.stopAndDelete"),
          noLabel: t("calendar.view.keepSession"),
          extraConfirmShortcut: (e) =>
            (e.key === "d" || e.key === "D") && hasOnlyShortcutModifier(e),
        },
      );
      return;
    }

    await executeDeleteArchivePlan(plan, false);
  }

  function handleDayClickFromMonth(date: Date) {
    void targetController.request({ mode: "day", date }, { history: true, reason: "view" });
  }

  function handleWeekDayHeaderClick(date: Date) {
    void targetController.request({ mode: "day", date }, { history: true, reason: "view" });
  }

  function handleDayHeaderClick() {
    void targetController.request(
      { mode: dayHeaderReturnMode, date: targetController.currentState().date },
      { history: true, reason: "view" },
    );
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={containerEl} use:outsideClose class="relative flex h-full flex-col select-none overflow-hidden">
  <CalendarHeader
    {anchorDate}
    {viewMode}
    onNavigate={navigate}
    onViewChange={changeView}
    onDaySelect={(date) => {
      void targetController.request({ mode: targetController.currentState().mode, date }, {
        history: false,
        reason: "programmatic",
      });
    }}
  />

  <div bind:this={viewWrapperEl} class="min-w-0 flex-1 overflow-hidden" style="background-color: var(--cal-bg);">
    {#if viewMode === "week" || viewMode === "workweek"}
      <WeekView
        {anchorDate}
        days={multiDayRangeDays}
        events={visibleEvents}
        {eventsByDay}
        theme={theme.current}
        {timezones}
        {tzAbbrMode}
        editingId={visualEditingId}
        {previewedIds}
        persistedSegmentsByEvent={persistedSegments.byEvent}
        initialScrollMinute={scrollMinute}
        onScrollChange={(m) => { scrollMinute = m; }}
        onEventClick={handleEventClick}
        onEventPrefetch={handleEventPrefetch}
        onEventUpdate={handleEventUpdate}
        onEventCreate={handleEventCreate}
        onAddTimezone={addTimezone}
        onRemoveTimezone={removeTimezone}
        onReorderTimezone={reorderTimezone}
        onTzAbbrModeChange={(m) => { tzAbbrMode = m; }}
        onWheelNavigate={handleWheelNavigate}
        onDayHeaderClick={handleWeekDayHeaderClick}
      />
    {:else if viewMode === "day"}
      <DayView
        {anchorDate}
        events={visibleEvents}
        {eventsByDay}
        theme={theme.current}
        {timezones}
        {tzAbbrMode}
        editingId={visualEditingId}
        {previewedIds}
        persistedSegmentsByEvent={persistedSegments.byEvent}
        initialScrollMinute={scrollMinute}
        onScrollChange={(m) => { scrollMinute = m; }}
        onEventClick={handleEventClick}
        onEventPrefetch={handleEventPrefetch}
        onEventUpdate={handleEventUpdate}
        onEventCreate={handleEventCreate}
        onAddTimezone={addTimezone}
        onRemoveTimezone={removeTimezone}
        onReorderTimezone={reorderTimezone}
        onTzAbbrModeChange={(m) => { tzAbbrMode = m; }}
        onWheelNavigate={handleWheelNavigate}
        onDayHeaderClick={handleDayHeaderClick}
      />
    {:else}
      <MonthView
        {anchorDate}
        {eventsByDay}
        theme={theme.current}
        onDayClick={handleDayClickFromMonth}
        onEventClick={handleEventClick}
        onEventPrefetch={handleEventPrefetch}
        onRequestPanelClose={handlePanelClose}
        onWheelNavigate={handleWheelNavigate}
      />
    {/if}
  </div>

  {#if confirm.action}
    <ConfirmDialog
      title={confirm.title}
      message={confirm.message}
      confirmLabel={confirm.yesLabel}
      cancelLabel={confirm.noLabel}
      extraConfirmShortcut={confirm.extraShortcut}
      onConfirm={confirm.confirmYes}
      onCancel={confirm.confirmNo}
    />
  {/if}

  <!-- Floating event panel -->
  {#if session.state.mode === "create" || session.state.mode === "edit"}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- Invisible backdrop: pointer-events pass through, clicks on empty space close panel -->
    <div class="fixed inset-0 z-40 pointer-events-none"></div>
  {/if}
  {#if EventPanel && panelRender}
    {@const Panel = EventPanel}
    {@const render = panelRender}
    <Panel
      parked={render.parked}
      mode={render.mode}
      panelSessionKey={render.sessionKey}
      start={render.start}
      end={render.end}
      event={render.mode === "edit" ? render.event : undefined}
      recurringScopeEnabled={render.mode === "edit" ? render.recurringScopeEnabled : false}
      anchor={render.anchor}
      initialAllDay={render.initialAllDay}
      detailsLoaded={render.detailsLoaded}
      externalDirty={render.externalDirty}
      initialSyncSeeded
      readOnly={render.readOnly}
      allowDeleteWhenReadOnly={render.allowDeleteWhenReadOnly}
      allowPomodoroWhenReadOnly={render.allowPomodoroWhenReadOnly}
      skipInlineDeleteConfirm={render.skipInlineDeleteConfirm}
      inlineEndEventConfirm={render.mode === "edit" ? render.inlineEndEventConfirm : false}
      lockStartControls={render.mode === "edit" ? render.endActiveEventAvailable : false}
      calendarIdentityEmail={panelCalendarIdentityEmail}
      loadFullEvent={calendarStore.loadPanelEvent}
      onSave={handlePanelSave}
      onDelete={render.mode === "edit" && !render.parked ? handleDelete : undefined}
      onEndEvent={render.mode === "edit" && !render.parked && render.endActiveEventAvailable
        ? handleEndEvent
        : undefined}
      onChange={handlePanelChange}
      onInitialSync={handlePanelInitialSync}
      onClose={handlePanelClose}
      onScopeChange={handleScopeChange}
      onSurfaceStatusChange={handlePanelSurfaceStatusChange}
    />
  {/if}

  {#if toasts.deleteUndoToast}
    {@const deleteToast = toasts.deleteUndoToast}
    <ActionToast
      message={deleteToast.label}
      actionLabel={!deleteToast.pending && deleteToast.restore ? t("calendar.view.undo") : undefined}
      reserveActionLabel={t("calendar.view.undo")}
      controlsVisible={!deleteToast.pending}
      dismissLabel={t("calendar.view.dismissEventNotification")}
      onAction={undoDeletedEvent}
      onDismiss={toasts.dismissDeleteUndoToast}
    />
  {/if}

  {#if toasts.saveSuccessToast}
    {@const saveToast = toasts.saveSuccessToast}
    <ActionToast
      message={saveToast.message}
      variant={saveToast.variant}
      stacked={!!toasts.deleteUndoToast}
      controlsVisible={!saveToast.pending}
      dismissLabel={t("calendar.view.dismissSaveNotification")}
      onDismiss={() => toasts.dismissSaveToastIfCurrent(saveToast.id)}
    />
  {/if}

</div>
