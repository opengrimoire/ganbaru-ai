<script lang="ts">
  import type {
    CalendarEvent, CalendarViewMode, EventAttendee, EventColor, EventStatus, EventSurfaceStatus,
    EventTransparency, EventVisibility, GuestPermissions, AttendeeStatus,
    PersistedSegment, PomodoroConfig, RecurrenceConfig, RecurringScope,
  } from "./types";
  import {
    addDays, adjacentWorkCycleAnchor, computeViewWindow, formatCalendarDate, formatDatePart,
    formatCalendarDateCeilMinute, getWeekDays, getWorkCycleDays,
    getEventSurfaceStatusForIdentity, getLocalTimezone, parseCalendarDate,
  } from "./utils";
  import type { TimezoneAbbrMode } from "./utils";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import { calendarIdentityEmail } from "$lib/calendar/calendar-display";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
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
  import { formatShortcut, hasOnlyShortcutModifier } from "$lib/keyboard-shortcuts";
  import { getCalendarNavHandle } from "./nav-handle.svelte";
  import { dbUrl } from "$lib/api/db";
  import { invoke } from "@tauri-apps/api/core";
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
  import { endActiveEventWouldStopProductivity } from "./active-event-end";
  import { activeRootId } from "./occurrence-protection";
  import { getCalendarEventEditLock } from "./event-edit-permissions";
  import {
    buildCalendarDeleteArchivePlan,
    type CalendarDeleteArchiveOutcome,
    type CalendarDeleteArchivePlan,
    type CalendarDeleteArchiveRestoreSnapshot,
  } from "./delete-archive-plan";
  import {
    mapPomodoroSegmentRows,
    pomodoroSegmentSnapshotKey,
    queryPomodoroSegmentEventIds,
    visiblePomodoroEventIds,
    type DbPomodoroSegmentRow,
  } from "./pomodoro-rail-segments";

  const calendarStore = getCalendar();
  const calendarsStore = getCalendars();
  const pomodoro = getPomodoro();
  const calZoom = getCalendarZoom();
  const theme = getTheme();

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

  /**
   * Advance a `YYYY-MM-DD` string by one calendar day. Inlined to keep
   * `eventsByDay` allocation-free of Temporal objects in the hot path.
   */
  function nextDayStr(s: string): string {
    const y = Number(s.substring(0, 4));
    const m = Number(s.substring(5, 7));
    const d = Number(s.substring(8, 10));
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + 1);
    const ny = dt.getFullYear();
    const nm = String(dt.getMonth() + 1).padStart(2, "0");
    const nd = String(dt.getDate()).padStart(2, "0");
    return `${ny}-${nm}-${nd}`;
  }

  type ViewState = { mode: CalendarViewMode; date: Date };

  let viewMode: CalendarViewMode = $state("week");
  let anchorDate: Date = $state(new Date());
  let timezones: string[] = $state([getLocalTimezone()]);
  let tzAbbrMode: TimezoneAbbrMode = $state("acronym");

  // Edit session (replaces panelState, panelDirty, lastPanelChanges, etc.)
  const session = createEditSession();

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
  let persistedSegmentsByEvent = $state<ReadonlyMap<string, PersistedSegment[]>>(new Map());
  let persistedSegmentsSnapshotKey = $state("");
  let persistedSegmentsRequestSeq = 0;

  function shouldLoadRailSegmentsFor(mode: CalendarViewMode): boolean {
    return mode === "day" || mode === "workweek" || mode === "week";
  }

  async function loadPersistedSegmentsForEvents(
    events: readonly CalendarEvent[],
  ): Promise<{
    key: string;
    map: ReadonlyMap<string, PersistedSegment[]>;
  }> {
    const visibleIds = visiblePomodoroEventIds(events);
    const key = pomodoroSegmentSnapshotKey(pomodoro.segmentVersion, visibleIds);
    if (key === persistedSegmentsSnapshotKey) {
      return { key, map: persistedSegmentsByEvent };
    }
    if (visibleIds.length === 0) {
      return { key, map: new Map() };
    }

    const rows = await invoke<DbPomodoroSegmentRow[]>("pomodoro_load_segments_for_events", {
      dbUrl: dbUrl(),
      eventIds: queryPomodoroSegmentEventIds(visibleIds),
    });
    return {
      key,
      map: mapPomodoroSegmentRows(rows, visibleIds),
    };
  }

  async function ensurePersistedSegmentsForTarget(
    target: ViewState,
  ): Promise<{
    key: string;
    map: ReadonlyMap<string, PersistedSegment[]>;
  }> {
    if (!shouldLoadRailSegmentsFor(target.mode)) {
      return { key: "", map: new Map() };
    }
    const targetWindow = computeViewWindow(target.date, target.mode);
    return loadPersistedSegmentsForEvents(visibleStoreEventsForWindow(targetWindow));
  }

  function applyPersistedSegmentsSnapshot(
    snapshot: {
      key: string;
      map: ReadonlyMap<string, PersistedSegment[]>;
    },
  ): void {
    if (snapshot.key === persistedSegmentsSnapshotKey && snapshot.map === persistedSegmentsByEvent) return;
    persistedSegmentsSnapshotKey = snapshot.key;
    persistedSegmentsByEvent = snapshot.map;
  }

  function refreshPersistedSegmentsForCurrentView(): void {
    const seq = ++persistedSegmentsRequestSeq;
    const target: ViewState = { mode: viewMode, date: new Date(anchorDate) };
    void ensurePersistedSegmentsForTarget(target)
      .then((snapshot) => {
        if (seq !== persistedSegmentsRequestSeq) return;
        applyPersistedSegmentsSnapshot(snapshot);
      })
      .catch((error) => {
        if (seq !== persistedSegmentsRequestSeq) return;
        console.warn("[CalendarView] Failed to load pomodoro rail segments:", error);
        applyPersistedSegmentsSnapshot({ key: "", map: new Map() });
      });
  }

  $effect(() => {
    if (!calendarStore.loaded) return;
    if (!calendarStore.hasWindow(viewWindow.start, viewWindow.end)) return;
    void pomodoro.segmentVersion;
    void visibleEvents;
    refreshPersistedSegmentsForCurrentView();
  });
  let lastSameAnchorPrefetchKey = "";
  $effect(() => {
    if (!calendarStore.loaded) return;
    if (!calendarStore.hasWindow(viewWindow.start, viewWindow.end)) return;
    const key = `${viewMode}:${formatDatePart(anchorDate)}`;
    if (key === lastSameAnchorPrefetchKey) return;
    lastSameAnchorPrefetchKey = key;
    calendarStore.prefetchWindows(sameAnchorPrefetchRequests({ mode: viewMode, date: anchorDate }));
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

  /**
   * Per-day bucket built once per `visibleEvents` recompute. Replaces
   * `eventsForDay`/`allEventsForDay` linear scans inside DayColumn and
   * MonthView, which previously cost O(views x columns x N) per nav. The
   * walk mirrors the old filter logic exactly: an event lands on every day
   * `d` where `e.end > "${d} 00:00"` for timed events, and on every day in
   * `[startDay, endDay]` (inclusive) for all-day events.
   */
  const eventsByDay = $derived.by(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of visibleEvents) {
      let d = e.start.substring(0, 10);
      if (e.allDay) {
        const endDay = e.end.substring(0, 10);
        while (d <= endDay) {
          const arr = map.get(d);
          if (arr) arr.push(e); else map.set(d, [e]);
          d = nextDayStr(d);
        }
      } else {
        while (e.end > `${d} 00:00`) {
          const arr = map.get(d);
          if (arr) arr.push(e); else map.set(d, [e]);
          d = nextDayStr(d);
        }
      }
    }
    return map;
  });

  let suppressEditingGlow = $state(false);
  let endingActiveEvent = $state(false);
  let pendingEditEventId = $state<string | undefined>(undefined);
  const previewedIds = $derived(suppressEditingGlow ? new Set<string>() : displayResult.previewedIds);
  const editingId = $derived(suppressEditingGlow ? undefined : displayResult.editingId);
  const visualEditingId = $derived(suppressEditingGlow ? undefined : (editingId ?? pendingEditEventId));

  // Track when drag operations end to prevent click-to-close after drag
  let lastDragEndTime = 0;
  let suppressOutsideClickUntil = 0;

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
    return getCalendarEventEditLock(s.originalEvent, calendarsStore.list, {
      isActivePomodoroEvent: isSelectedActiveOccurrence(s),
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
      return {
        mode: "edit",
        sessionKey: s.sessionKey,
        event: panelEvent,
        recurringScopeEnabled: isRecurring(s.originalEvent) && !isSelectedActiveOccurrence(s),
        anchor: s.anchor,
        detailsLoaded: panelDetailsLoaded,
        readOnly: selectedEditLock.locked,
        allowDeleteWhenReadOnly: selectedEditLock.locked && selectedEditLock.allowArchive,
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
        skipInlineDeleteConfirm: false,
      };
    }
    if (s.mode === "edit" && panelEvent) {
      const selectedActive = endingActiveEvent || isSelectedActiveOccurrence(s);
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
        allowDeleteWhenReadOnly: !endingActiveEvent && selectedEditLock.locked && selectedEditLock.allowArchive,
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

  function isSelectedActiveOccurrence(s: Extract<EditSessionState, { mode: "edit" }>): boolean {
    if (!pomodoro.isActive || !pomodoro.activeBlockId) return false;
    if (!isRecurring(s.originalEvent)) return s.originalEvent.id === pomodoro.activeBlockId;
    return activeDateForEditSession(s.templateId) === s.instanceEvent.start.split(" ")[0];
  }

  function selectedActiveEndWouldStopProductivity(
    s: Extract<EditSessionState, { mode: "edit" }>,
  ): boolean {
    if (!isSelectedActiveOccurrence(s)) return false;
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
    return isSelectedActiveOccurrence(s) ? "this" : requested ?? session.scope;
  }

  /** Would this save displace the active block out of the current time window? */
  function wouldSaveStopSession(data: { start: string; end: string }, _scope?: RecurringScope): boolean {
    if (!pomodoro.isActive || !pomodoro.activeBlockId || session.state.mode !== "edit") return false;

    const s = session.state;
    // Active recurring occurrences are isolated to this occurrence. Future
    // "following" or "all" edits in the same series do not move the active run.
    if (!isSelectedActiveOccurrence(s)) return false;
    const now = new Date();
    const newStart = parseCalendarDate(data.start);
    const newEnd = parseCalendarDate(data.end);
    return !(now >= newStart && now < newEnd);
  }

  // Flag: the user confirmed the session stop but the actual stopSession() call
  // must happen after the save because hybrid logic needs activeBlockId intact.
  let sessionStopPending = false;

  // View history for Alt+Left/Right navigation (capped at 50)
  const VIEW_HISTORY_LIMIT = 50;
  let history: ViewState[] = $state([{ mode: "week", date: new Date() }]);
  let historyIndex = $state(0);
  let isNavigatingHistory = false;

  function pushHistory(mode: CalendarViewMode, date: Date) {
    if (isNavigatingHistory) return;
    const base = history.slice(0, historyIndex + 1);
    base[base.length - 1] = { mode: viewMode, date: new Date(anchorDate) };
    history = [...base, { mode, date }];
    if (history.length > VIEW_HISTORY_LIMIT) {
      history = history.slice(history.length - VIEW_HISTORY_LIMIT);
    }
    historyIndex = history.length - 1;
  }

  function historyBack() {
    if (historyIndex <= 0) return;
    historyIndex--;
    isNavigatingHistory = true;
    void requestCalendarTarget(history[historyIndex], { history: false, reason: "history" });
    isNavigatingHistory = false;
  }

  function historyForward() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    isNavigatingHistory = true;
    void requestCalendarTarget(history[historyIndex], { history: false, reason: "history" });
    isNavigatingHistory = false;
  }

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

  const DELETE_UNDO_TIMEOUT_MS = 5_000;
  const SAVE_SUCCESS_TOAST_TIMEOUT_MS = 3_000;

  interface DeleteUndoToast {
    id: string;
    pending: boolean;
    restore?: () => Promise<void>;
    label: string;
  }

  interface SaveToast {
    id: string;
    pending: boolean;
    message: string;
  }

  let deleteUndoToast: DeleteUndoToast | null = $state(null);
  let deleteUndoTimer: ReturnType<typeof setTimeout> | undefined;
  let saveSuccessToast: SaveToast | null = $state(null);
  let saveSuccessTimer: ReturnType<typeof setTimeout> | undefined;

  function clearDeleteUndoTimer(): void {
    if (deleteUndoTimer) {
      clearTimeout(deleteUndoTimer);
      deleteUndoTimer = undefined;
    }
  }

  function dismissDeleteUndoToast(): void {
    clearDeleteUndoTimer();
    deleteUndoToast = null;
  }

  function showDeletePendingToast(label: string): string {
    clearDeleteUndoTimer();
    const id = crypto.randomUUID();
    deleteUndoToast = { id, pending: true, label };
    return id;
  }

  function dismissDeleteToastIfCurrent(id: string): void {
    if (deleteUndoToast?.id === id) dismissDeleteUndoToast();
  }

  function showDeleteUndoToast(id: string, label: string, restore?: () => Promise<void>): void {
    clearDeleteUndoTimer();
    if (deleteUndoToast?.id !== id) return;
    deleteUndoToast = { id, pending: false, restore, label };
    deleteUndoTimer = setTimeout(() => {
      if (deleteUndoToast?.id === id) deleteUndoToast = null;
      deleteUndoTimer = undefined;
    }, DELETE_UNDO_TIMEOUT_MS);
  }

  function clearSaveSuccessTimer(): void {
    if (saveSuccessTimer) {
      clearTimeout(saveSuccessTimer);
      saveSuccessTimer = undefined;
    }
  }

  function dismissSaveSuccessToast(): void {
    clearSaveSuccessTimer();
    saveSuccessToast = null;
  }

  function showSavePendingToast(): string {
    clearSaveSuccessTimer();
    const id = crypto.randomUUID();
    saveSuccessToast = { id, pending: true, message: "Saving..." };
    return id;
  }

  function dismissSaveToastIfCurrent(id: string): void {
    if (saveSuccessToast?.id === id) dismissSaveSuccessToast();
  }

  function showSaveSuccessToast(id: string): void {
    clearSaveSuccessTimer();
    if (saveSuccessToast?.id !== id) return;
    saveSuccessToast = { id, pending: false, message: "Saved" };
    saveSuccessTimer = setTimeout(() => {
      if (saveSuccessToast?.id === id) saveSuccessToast = null;
      saveSuccessTimer = undefined;
    }, SAVE_SUCCESS_TOAST_TIMEOUT_MS);
  }

  async function undoDeletedEvent(): Promise<void> {
    const toast = deleteUndoToast;
    if (!toast?.restore) return;
    dismissDeleteUndoToast();
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
    clearDeleteUndoTimer();
    clearSaveSuccessTimer();
  });

  // Confirmation dialog
  let confirmAction: (() => Promise<void>) | null = $state(null);
  let confirmTitle: string | undefined = $state(undefined);
  let confirmMessage = $state("");
  let confirmYesLabel = $state("Yes (Enter)");
  let confirmNoLabel = $state("No (Esc)");
  let confirmExtraShortcut: ((e: KeyboardEvent) => boolean) | undefined = $state(undefined);
  function requestConfirm(
    message: string,
    action: () => Promise<void>,
    opts?: {
      title?: string;
      yesLabel?: string;
      noLabel?: string;
      extraConfirmShortcut?: (e: KeyboardEvent) => boolean;
    },
  ) {
    confirmTitle = opts?.title;
    confirmMessage = message;
    confirmAction = action;
    confirmYesLabel = opts?.yesLabel ?? "Yes (Enter)";
    confirmNoLabel = opts?.noLabel ?? "No (Esc)";
    confirmExtraShortcut = opts?.extraConfirmShortcut;
  }

  async function confirmYes() {
    const action = confirmAction;
    confirmAction = null;
    confirmTitle = undefined;
    confirmMessage = "";
    confirmExtraShortcut = undefined;
    if (action) await action();
  }

  function confirmNo() {
    confirmAction = null;
    confirmTitle = undefined;
    confirmMessage = "";
    confirmExtraShortcut = undefined;
  }

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
    canRepeat: canRepeatHeldNavigation,
    mark: markHeldNav,
  });

  let pendingTarget: ViewState | null = null;
  let targetCommitPromise: Promise<void> | null = null;
  let targetRequestSeq = 0;
  let targetPaintPending = false;

  function currentTargetState(): ViewState {
    return pendingTarget ?? { mode: viewMode, date: anchorDate };
  }

  function targetAnchorForNavigation(direction: "forward" | "back"): Date {
    const delta = direction === "forward" ? 1 : -1;
    const currentTarget = currentTargetState();
    const base = currentTarget.date;
    if (currentTarget.mode === "week") return addDays(base, 7 * delta);
    if (currentTarget.mode === "workweek") return adjacentWorkCycleAnchor(base, direction);
    if (currentTarget.mode === "day") return addDays(base, delta);
    const d = new Date(base);
    const targetMonth = d.getMonth() + delta;
    d.setDate(1);
    d.setMonth(targetMonth);
    return d;
  }

  function canRepeatHeldNavigation(direction: "forward" | "back"): boolean {
    if (
      pendingTarget !== null
      || targetPaintPending
      || calendarStore.foregroundWindowLoadBusy
      || !calendarStore.hasWindow(viewWindow.start, viewWindow.end)
    ) {
      return false;
    }
    const targetMode = currentTargetState().mode;
    const targetWindow = computeViewWindow(targetAnchorForNavigation(direction), targetMode);
    return calendarStore.hasWindow(targetWindow.start, targetWindow.end);
  }

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
    void waitForNavigationSettled()
      .then(() => {
        if (seq !== navReleaseSeq) return;
        perfMark("nav.release-tail", {
          key,
          ms: Math.round(performance.now() - releasedAt),
          count: visibleEvents.length,
        });
      });
  }

  async function waitForNavigationSettled(): Promise<void> {
    if (targetCommitPromise) await targetCommitPromise;
    await tick();
    await calendarStore.whenForegroundWindowIdle();
    await tick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
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
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && session.state.mode === "closed" && !confirmAction) {
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
        void requestCalendarTarget({ mode: currentTargetState().mode, date }, {
          history: false,
          reason: "programmatic",
        });
      },
      openVisibleEvent: openVisibleEventForBenchmark,
      getVisibleEventCount: getVisibleEventCountForBenchmark,
      openCreatePanel: openCreatePanelForBenchmark,
      closePanel: closePanelForBenchmark,
      canRepeatHeldNavigation,
      getViewMode: () => viewMode,
    });

    return () => {
      unregisterNav();
      stopArrowScroll();
      stopNavHold();
      pendingTarget = null;
      targetPaintPending = false;
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("keyup", handleKeyup);
      window.removeEventListener("blur", handleBlur);
    };
  });

  function sameAnchorPrefetchRequests(target: ViewState): Array<{
    start: typeof viewWindow.start;
    end: typeof viewWindow.end;
  }> {
    const modes: CalendarViewMode[] = ["day", "workweek", "week", "month"];
    const seen = new Set<string>();
    const requests: Array<{ start: typeof viewWindow.start; end: typeof viewWindow.end }> = [];
    for (const mode of modes) {
      const requestWindow = computeViewWindow(target.date, mode);
      const key = `${requestWindow.start.toString()}..${requestWindow.end.toString()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (calendarStore.hasWindow(requestWindow.start, requestWindow.end)) continue;
      requests.push(requestWindow);
    }
    return requests;
  }

  function requestCalendarTarget(
    target: ViewState,
    options: {
      history: boolean;
      reason: "history" | "nav" | "programmatic" | "view";
    },
  ): Promise<void> {
    const requestId = ++targetRequestSeq;
    const normalizedTarget: ViewState = { mode: target.mode, date: new Date(target.date) };
    pendingTarget = normalizedTarget;
    targetPaintPending = true;
    const targetWindow = computeViewWindow(normalizedTarget.date, normalizedTarget.mode);

    const promise = (async () => {
      try {
        await calendarStore.ensureWindowReady(targetWindow.start, targetWindow.end);
        if (requestId !== targetRequestSeq) return;
        const segmentSnapshot = await ensurePersistedSegmentsForTarget(normalizedTarget);
        if (requestId !== targetRequestSeq) return;

        if (options.history) pushHistory(normalizedTarget.mode, normalizedTarget.date);
        applyPersistedSegmentsSnapshot(segmentSnapshot);
        viewMode = normalizedTarget.mode;
        anchorDate = normalizedTarget.date;
        void calendarStore.loadWindow(targetWindow.start, targetWindow.end)
          .catch((error) => console.error("[CalendarView] target state apply failed:", error));
        pendingTarget = null;
        calendarStore.prefetchWindows(sameAnchorPrefetchRequests(normalizedTarget));
        void tick().then(() => {
          if (requestId !== targetRequestSeq) return;
          perfMark(
            options.reason === "view" ? "view.mounted" : "nav.display-ready",
            { count: visibleEvents.length },
          );
          requestAnimationFrame(() => {
            if (requestId !== targetRequestSeq) return;
            targetPaintPending = false;
            perfMark(options.reason === "view" ? "view.paint-done" : "nav.paint-done");
          });
        });
      } catch (error) {
        if (requestId !== targetRequestSeq) return;
        pendingTarget = null;
        targetPaintPending = false;
        console.error("[CalendarView] target commit failed:", error);
      } finally {
        if (requestId === targetRequestSeq) targetCommitPromise = null;
      }
    })();

    targetCommitPromise = promise;
    return promise;
  }

  function navigate(
    direction: "today" | "back" | "forward",
    source: "programmatic" | "wheel" | "key" | "hold-repeat" = "programmatic",
  ) {
    perfMark("nav.start", { dir: direction, source });
    if (direction === "today") {
      void requestCalendarTarget(
        { mode: currentTargetState().mode, date: new Date() },
        { history: false, reason: "nav" },
      );
      return;
    }

    void requestCalendarTarget(
      { mode: currentTargetState().mode, date: targetAnchorForNavigation(direction) },
      { history: false, reason: "nav" },
    );
  }

  function handleWheelNavigate(direction: "back" | "forward") {
    navigate(direction, "wheel");
  }

  function changeView(mode: CalendarViewMode) {
    perfMark("view.start", { from: viewMode, to: mode });
    void requestCalendarTarget(
      { mode, date: currentTargetState().date },
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
        "Your changes will be lost",
        openCreate,
        { title: "Discard unsaved changes?", yesLabel: "Discard (Enter)", noLabel: "Cancel (Esc)" },
      );
      return;
    }

    await openCreate();
  }

  function fallbackPanelAnchor(): PanelAnchor {
    return { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };
  }

  function panelAnchorFromRect(rect: DOMRect | undefined): PanelAnchor {
    return rect
      ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
      : fallbackPanelAnchor();
  }

  function findRenderedEventElement(eventId: string): HTMLElement | undefined {
    if (!containerEl) return undefined;
    for (const el of containerEl.querySelectorAll<HTMLElement>("[data-event-id]")) {
      if (el.dataset.eventId === eventId) return el;
    }
    return undefined;
  }

  function panelAnchorFromRenderedEvent(eventId: string): PanelAnchor {
    const el = findRenderedEventElement(eventId);
    if (!el) return fallbackPanelAnchor();

    const eventRect = el.getBoundingClientRect();
    const columnRect = el.closest("[data-day-column]")?.getBoundingClientRect();
    if (columnRect) {
      return {
        x: columnRect.right,
        y: eventRect.top,
        width: columnRect.width,
        height: eventRect.height,
      };
    }

    return {
      x: eventRect.right,
      y: eventRect.top,
      width: eventRect.width,
      height: eventRect.height,
    };
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
        "Your changes will be lost",
        async () => { await openEvent(); },
        { title: "Discard unsaved changes?", yesLabel: "Discard (Enter)", noLabel: "Cancel (Esc)" },
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
          "Your changes will be lost",
          async () => {
            await loadEventPanel();
            session.openEdit(originalInstance, anchor, originalInstance);
            session.updateChanges({ start: event.start, end: event.end });
          },
          { title: "Discard unsaved changes?", yesLabel: "Discard (Enter)", noLabel: "Cancel (Esc)" },
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
          "Your changes will be lost",
          async () => {
            // Open with the pre-drag instance as originalEvent so the
            // session baseline starts from pre-drag values before the drag
            // delta is applied to changes.
            await loadEventPanel();
            session.openEdit(originalInstance, anchor, originalInstance);
            session.updateChanges({ start: event.start, end: event.end });
          },
          { title: "Discard unsaved changes?", yesLabel: "Discard (Enter)", noLabel: "Cancel (Esc)" },
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
        "Your changes will be lost",
        async () => { closeSession(); },
        { title: "Discard unsaved changes?", yesLabel: "Discard (Enter)", noLabel: "Cancel (Esc)" },
      );
      return;
    }
    closeSession();
  }

  function isPanelOrEventTarget(target: EventTarget | null): boolean {
    return target instanceof Element
      && (
        target.closest("[data-event-id]") !== null
        || target.closest("[data-create-preview]") !== null
        || target.closest(".panel-root") !== null
      );
  }

  function isConfirmDialogPanelTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(".confirm-dialog") !== null;
  }

  function isCalendarEditCloseTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest("[data-calendar-edit-close-zone]") !== null;
  }

  function handleOutsidePointerDown(e: PointerEvent) {
    if (confirmAction) return;
    if (panelCommitHidden) return;
    if (session.state.mode === "closed") return;
    if (isPanelOrEventTarget(e.target)) return;
    if (!isCalendarEditCloseTarget(e.target)) return;

    suppressOutsideClickUntil = performance.now() + 750;
    e.preventDefault();
    e.stopPropagation();

    if (Date.now() - lastDragEndTime < CREATE_CLOSE_GUARD_MS) return;
    handlePanelClose();
  }

  function handleOutsideClick(e: MouseEvent) {
    if (confirmAction && isConfirmDialogPanelTarget(e.target)) return;
    if (performance.now() > suppressOutsideClickUntil) {
      suppressOutsideClickUntil = 0;
      return;
    }
    suppressOutsideClickUntil = 0;
    e.preventDefault();
    e.stopPropagation();
  }

  function outsideClose(node: HTMLElement) {
    node.addEventListener("pointerdown", handleOutsidePointerDown, true);
    node.addEventListener("click", handleOutsideClick, true);
    return {
      destroy() {
        node.removeEventListener("pointerdown", handleOutsidePointerDown, true);
        node.removeEventListener("click", handleOutsideClick, true);
      },
    };
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

  async function handlePanelSave(data: PanelSaveData, scope?: RecurringScope) {
    // Gate: confirm before stopping the active pomodoro session.
    // stopSession() is deferred until after the save so hybrid logic still sees activeBlockId.
    if (!sessionStopPending && wouldSaveStopSession(data, scope)) {
      requestConfirm(
        "The current focus session will stop",
        async () => {
          sessionStopPending = true;
          await handlePanelSave(data, scope);
        },
        { title: "Save and stop the focus session?", yesLabel: "Stop and save (Enter)", noLabel: "Keep editing (Esc)" },
      );
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
    panelCommitHidden = true;
    saveDisplayFreeze = saveFreeze;
    if (suppressPomodoroAutoStart) pomodoro.autoStartSuppressed = true;
    const saveToastId = showSavePendingToast();

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
      showSaveSuccessToast(saveToastId);
      await tick();
    } finally {
      if (saveSuccessToast?.id === saveToastId && saveSuccessToast.pending) {
        dismissSaveToastIfCurrent(saveToastId);
      }
      if (suppressPomodoroAutoStart) pomodoro.autoStartSuppressed = false;
      suppressEditingGlow = false;
      suppressEditPreview = false;
      panelCommitHidden = false;
      saveDisplayFreeze = null;
    }
  }

  async function executeEndEvent(data: PanelSaveData, scope?: RecurringScope) {
    const s = session.state;
    if (s.mode !== "edit" || !isSelectedActiveOccurrence(s)) return;

    const actualEnd = new Date();
    const end = formatCalendarDateCeilMinute(actualEnd);
    const endedData: PanelSaveData = { ...data, end };
    const endIso = actualEnd.toISOString();
    const saveFreeze = buildSaveDisplayFreeze(endedData, scope);
    let saveRefreshedVisibleWindow = false;
    const suppressPomodoroAutoStart = pomodoro.isActive && !!pomodoro.activeBlockId;
    endingActiveEvent = true;
    suppressEditingGlow = true;
    suppressEditPreview = true;
    saveDisplayFreeze = saveFreeze;
    if (suppressPomodoroAutoStart) pomodoro.autoStartSuppressed = true;

    try {
      saveRefreshedVisibleWindow = await persistPanelData(endedData, scope, {
        syncActivePomodoro: false,
      });
      await pomodoro.completeActiveBlockAt(endIso);
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
    if (s.mode !== "edit" || !isSelectedActiveOccurrence(s)) return;

    if (selectedActiveEndWouldStopProductivity(s)) {
      requestConfirm(
        "The current focus session will stop",
        async () => {
          await executeEndEvent(data, scope);
        },
        {
          title: "Stop the focus session?",
          yesLabel: "End event (Enter)",
          noLabel: "Keep session (Esc)",
          extraConfirmShortcut: (e) =>
            (e.key === "d" || e.key === "D") && hasOnlyShortcutModifier(e),
        },
      );
      return;
    }

    await executeEndEvent(data, scope);
  }

  function eventDeleteOutcomeLabel(outcome: CalendarDeleteArchiveOutcome): string {
    if (outcome === "archive") return "Event archived";
    if (outcome === "mixed") return "Events deleted and archived";
    return "Event deleted";
  }

  function eventDeletePendingLabel(outcome: CalendarDeleteArchiveOutcome): string {
    if (outcome === "archive") return "Archiving...";
    if (outcome === "mixed") return "Deleting and archiving...";
    return "Deleting...";
  }

  async function syncSavedActivePomodoro(event: CalendarEvent): Promise<void> {
    const activeId = pomodoro.activeBlockId;
    const config = event.pomodoroConfig;
    if (!pomodoro.isActive || !activeId || event.id !== activeId || !config) return;
    await pomodoro.startFromBlock(
      activeId,
      {
        focusMinutes: config.focusDurationMinutes,
        shortBreakMinutes: config.shortBreakMinutes,
        longBreakMinutes: config.longBreakMinutes,
        cyclesBeforeLongBreak: config.pomodoroCount,
      },
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
    const deleteToastId = showDeletePendingToast(eventDeletePendingLabel(plan.outcome));

    try {
      const restoreDeleted = await buildRestoreCallbackForDeletePlan(plan);
      if (stopActiveSession && activeBlockId) {
        pomodoro.dismissedBlockId = activeBlockId;
        await pomodoro.stopSession();
      }
      await calendarStore.applyDeleteArchivePlan(plan.operations);
      await calendarStore.refreshWindow(viewWindow.start, viewWindow.end);
      closeSession();
      showDeleteUndoToast(deleteToastId, eventDeleteOutcomeLabel(plan.outcome), restoreDeleted);
    } finally {
      if (deleteUndoToast?.id === deleteToastId && deleteUndoToast.pending) {
        dismissDeleteToastIfCurrent(deleteToastId);
      }
      suppressEditPreview = false;
      panelCommitHidden = false;
      saveDisplayFreeze = null;
    }
  }

  async function handleDelete(id: string, scope?: RecurringScope) {
    const plan = buildDeleteArchivePlanForEvent(id, scope);
    if (plan.requiresActiveStop) {
      const actionVerb = plan.outcome === "archive" ? "archive" : "delete";
      requestConfirm(
        `The current focus session will stop before this event is ${actionVerb === "archive" ? "archived" : "deleted"}`,
        async () => {
          await executeDeleteArchivePlan(plan, true);
        },
        {
          title: `Stop and ${actionVerb} event?`,
          yesLabel: `Stop and ${actionVerb} (Enter)`,
          noLabel: "Keep session (Esc)",
          extraConfirmShortcut: (e) =>
            (e.key === "d" || e.key === "D") && hasOnlyShortcutModifier(e),
        },
      );
      return;
    }

    await executeDeleteArchivePlan(plan, false);
  }

  function handleDayClickFromMonth(date: Date) {
    void requestCalendarTarget({ mode: "day", date }, { history: true, reason: "view" });
  }

  function handleWeekDayHeaderClick(date: Date) {
    void requestCalendarTarget({ mode: "day", date }, { history: true, reason: "view" });
  }

  function handleDayHeaderClick() {
    void requestCalendarTarget(
      { mode: "workweek", date: currentTargetState().date },
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
      void requestCalendarTarget({ mode: currentTargetState().mode, date }, {
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
        {persistedSegmentsByEvent}
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
        {persistedSegmentsByEvent}
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
        onWheelNavigate={handleWheelNavigate}
      />
    {/if}
  </div>

  {#if confirmAction}
    <ConfirmDialog
      title={confirmTitle}
      message={confirmMessage}
      confirmLabel={confirmYesLabel}
      cancelLabel={confirmNoLabel}
      extraConfirmShortcut={confirmExtraShortcut}
      onConfirm={confirmYes}
      onCancel={confirmNo}
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
    <Panel
      parked={panelRender.parked}
      mode={panelRender.mode}
      panelSessionKey={panelRender.sessionKey}
      start={panelRender.start}
      end={panelRender.end}
      event={panelRender.mode === "edit" ? panelRender.event : undefined}
      recurringScopeEnabled={panelRender.mode === "edit" ? panelRender.recurringScopeEnabled : false}
      anchor={panelRender.anchor}
      initialAllDay={panelRender.initialAllDay}
      detailsLoaded={panelRender.detailsLoaded}
      externalDirty={panelRender.externalDirty}
      initialSyncSeeded
      readOnly={panelRender.readOnly}
      allowDeleteWhenReadOnly={panelRender.allowDeleteWhenReadOnly}
      skipInlineDeleteConfirm={panelRender.skipInlineDeleteConfirm}
      inlineEndEventConfirm={panelRender.mode === "edit" ? panelRender.inlineEndEventConfirm : false}
      lockStartControls={panelRender.mode === "edit" ? panelRender.endActiveEventAvailable : false}
      calendarIdentityEmail={panelCalendarIdentityEmail}
      loadFullEvent={calendarStore.loadPanelEvent}
      onSave={handlePanelSave}
      onDelete={panelRender.mode === "edit" && !panelRender.parked ? handleDelete : undefined}
      onEndEvent={panelRender.mode === "edit" && !panelRender.parked && panelRender.endActiveEventAvailable
        ? handleEndEvent
        : undefined}
      onChange={handlePanelChange}
      onInitialSync={handlePanelInitialSync}
      onClose={handlePanelClose}
      onScopeChange={handleScopeChange}
      onSurfaceStatusChange={handlePanelSurfaceStatusChange}
    />
  {/if}

  {#if deleteUndoToast}
    <ActionToast
      message={deleteUndoToast.label}
      actionLabel={!deleteUndoToast.pending && deleteUndoToast.restore ? "Undo" : undefined}
      reserveActionLabel="Undo"
      controlsVisible={!deleteUndoToast.pending}
      dismissLabel="Dismiss event notification"
      onAction={undoDeletedEvent}
      onDismiss={dismissDeleteUndoToast}
    />
  {/if}

  {#if saveSuccessToast}
    <ActionToast
      message={saveSuccessToast.message}
      variant="success"
      stacked={!!deleteUndoToast}
      controlsVisible={!saveSuccessToast.pending}
      dismissLabel="Dismiss save notification"
      onDismiss={dismissSaveSuccessToast}
    />
  {/if}

</div>
