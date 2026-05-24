<script lang="ts">
  import type {
    CalendarEvent, CalendarViewMode, EventAttendee, EventColor, EventStatus, EventSurfaceStatus,
    EventTransparency, EventVisibility, GuestPermissions, AttendeeStatus,
    PomodoroConfig, RecurrenceConfig, RecurringScope,
  } from "./types";
  import {
    addDays, computeViewWindow, formatCalendarDate, formatDatePart,
    getEventSurfaceStatusForIdentity, getLocalTimezone, parseCalendarDate,
  } from "./utils";
  import type { TimezoneAbbrMode } from "./utils";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import {
    concreteRecurringOccurrenceForMutation,
    deleteActionForCalendarEvent,
  } from "$lib/stores/calendar-mutations";
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
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import X from "@lucide/svelte/icons/x";
  import { createEditSession } from "./edit-session.svelte";
  import type { PanelAnchor } from "./edit-session.svelte";
  import { mark as perfMark } from "$lib/stores/perflog.svelte";
  import { isAppShortcutBlockedTarget, isEditableKeyboardTarget } from "$lib/utils";
  import { formatShortcut, hasOnlyShortcutModifier } from "$lib/keyboard-shortcuts";
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
    buildRecurringCommitPlan,
    dateDiffDays,
    shiftDateStr,
    PENDING_CREATE_ID,
  } from "./display-events";
  import { executeRecurrenceCommitPlan } from "./recurrence-edit-executor";
  import {
    protectedRecurringOccurrencesForArchive,
    visibleEventsAfterRecurringDeleteScope,
  } from "./delete-scope";

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
  let saveDisplayFreeze = $state<CalendarEvent[] | null>(null);
  let panelSurfaceStatus = $state<EventSurfaceStatus | undefined>(undefined);
  let panelSurfaceStatusEventId = $state<string | undefined>(undefined);

  // Visible-viewport window. Drives both the store's expansion index and
  // the edit-flow preview. Held-arrow nav stays cheap because anchor changes
  // are coalesced to one viewport update per animation frame.
  const viewWindow = $derived(computeViewWindow(anchorDate, viewMode));

  $effect(() => {
    if (!calendarStore.loaded) return;
    void calendarStore.loadWindow(viewWindow.start, viewWindow.end)
      .catch((e) => console.error("[CalendarView] load window failed:", e));
  });

  // Keep the headless handle's cached view mode in sync so external drivers
  // (the benchmark harness) read the current value without polling.
  $effect(() => {
    getCalendarNavHandle().reportViewMode(viewMode);
  });

  const displayResult = $derived.by(() => {
    const visIds = calendarsStore.visibleIds;
    const storeEvents = calendarStore
      .eventsInWindow(viewWindow.start, viewWindow.end)
      .filter((e) => visIds.has(e.calendarId));
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
    let activeDate: string | undefined;
    if (pomodoro.activeBlockId && s.templateId) {
      const parts = pomodoro.activeBlockId.split("::");
      if (parts[0] === s.templateId) activeDate = parts[1];
    }
    return computeEditDisplay(
      calendarStore.rawBlocks,
      storeEvents,
      { originalEvent: s.originalEvent, instanceEvent: s.instanceEvent, templateId: s.templateId },
      session.changes,
      session.scope,
      viewWindow,
      activeDate,
      currentDate,
      currentTime,
    );
  });

  function currentVisibleStoreEvents(): CalendarEvent[] {
    const visIds = calendarsStore.visibleIds;
    return calendarStore
      .eventsInWindow(viewWindow.start, viewWindow.end)
      .filter((event) => visIds.has(event.calendarId));
  }

  function activeDateForEditSession(templateId: string): string | undefined {
    if (!pomodoro.activeBlockId) return undefined;
    const parts = pomodoro.activeBlockId.split("::");
    return parts[0] === templateId ? parts[1] : undefined;
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
          scope ?? session.scope,
          viewWindow,
          activeDateForEditSession(state.templateId),
          currentDate,
          currentTime,
        ).events,
      );
    }

    return cloneDisplayEvents(displayResult.events);
  }

  function buildDeleteDisplayFreeze(id: string, scope?: RecurringScope): CalendarEvent[] {
    const storeEvents = currentVisibleStoreEvents();
    const s = session.state;
    if (scope && s.mode === "edit") {
      const instanceDate = s.instanceEvent.start.split(" ")[0];
      const templateId = s.instanceEvent.recurringParentId ?? s.instanceEvent.id;
      return cloneDisplayEvents(
        visibleEventsAfterRecurringDeleteScope(storeEvents, templateId, instanceDate, scope),
      );
    }
    return cloneDisplayEvents(storeEvents.filter((event) => event.id !== id));
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
    const scopeArg = isRecurring(session.state.instanceEvent) ? session.scope : undefined;
    return wouldDeleteActiveSession(scopeArg);
  });

  // Past pomodoro events are read-only (completed work is sacred)
  const isEditingLocked = $derived.by(() => {
    const s = session.state;
    if (s.mode !== "edit") return false;
    const ev = s.originalEvent;
    if (!ev.pomodoroConfig) return false;
    if (ev.id === pomodoro.activeBlockId) return false;
    return parseCalendarDate(ev.end).getTime() < Date.now();
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
        recurringScopeEnabled: isRecurring(s.originalEvent),
        anchor: s.anchor,
        detailsLoaded: panelDetailsLoaded,
        readOnly: isEditingLocked || calendarsStore.isReadOnly(s.originalEvent.calendarId),
        allowDeleteWhenReadOnly: isEditingLocked && !calendarsStore.isReadOnly(s.originalEvent.calendarId),
        skipInlineDeleteConfirm: deleteWouldStopSession,
      };
    }
    return null;
  }

  const panelRender = $derived.by<PanelRenderState | null>(() => {
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
      return {
        parked: false,
        mode: "edit",
        sessionKey: s.sessionKey,
        start: "",
        end: "",
        anchor: s.anchor,
        initialAllDay: false,
        event: panelEvent,
        recurringScopeEnabled: isRecurring(s.originalEvent),
        detailsLoaded: panelDetailsLoaded,
        externalDirty: session.dirty,
        readOnly: isEditingLocked || calendarsStore.isReadOnly(s.originalEvent.calendarId),
        allowDeleteWhenReadOnly: isEditingLocked && !calendarsStore.isReadOnly(s.originalEvent.calendarId),
        skipInlineDeleteConfirm: deleteWouldStopSession,
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

  function activePomodoroDate(activeId: string): string | undefined {
    const [, syntheticDate] = activeId.split("::");
    if (syntheticDate) return syntheticDate;
    return pomodoro.segments.find((segment) => segment.status === "active")?.eventDate;
  }

  function eventMatchesActivePomodoro(event: CalendarEvent, activeId: string): boolean {
    if (event.id === activeId) return true;

    const eventRoot = (event.recurringParentId ?? event.id).split("::")[0];
    const activeRoot = activeId.split("::")[0];
    if (eventRoot !== activeRoot) return false;

    const activeDate = activePomodoroDate(activeId);
    if (!activeDate) return true;
    return event.start.split(" ")[0] === activeDate;
  }

  /** Would this delete stop the active pomodoro session? */
  function wouldDeleteActiveSession(scope?: RecurringScope): boolean {
    if (!pomodoro.activeBlockId || session.state.mode !== "edit") return false;
    const activeId = pomodoro.activeBlockId;
    const event = session.state.instanceEvent;

    // Non-recurring or "this" delete of the active block
    if (!scope || scope === "this") return eventMatchesActivePomodoro(event, activeId);

    // "Following" delete: stops if active block is at or after the split point
    if (scope === "following") {
      const activeRoot = activeId.includes("::") ? activeId.split("::")[0] : activeId;
      const inst = session.state.instanceEvent;
      const targetRoot = (inst.recurringParentId ?? inst.id).split("::")[0];
      if (activeRoot !== targetRoot) return false;
      const instanceDate = inst.start.split(" ")[0];
      const activeDate = activePomodoroDate(activeId) ?? formatDatePart(new Date());
      return instanceDate <= activeDate;
    }

    const activeRoot = activeId.split("::")[0];
    const targetRoot = (event.recurringParentId ?? event.id).split("::")[0];
    return activeRoot === targetRoot;
  }

  /** Would this save displace the active block out of the current time window? */
  function wouldSaveStopSession(data: { start: string; end: string }, scope?: RecurringScope): boolean {
    if (!pomodoro.activeBlockId || session.state.mode !== "edit") return false;
    // "Following" splits from next day, preserving the active block
    if (scope === "following") return false;

    const s = session.state;
    const activeId = pomodoro.activeBlockId;

    // "All events" scope: check if the new time window still covers "now" on today
    if (scope === "all") {
      const templateId = (s.instanceEvent.recurringParentId ?? s.instanceEvent.id).split("::")[0];
      const activeRoot = activeId.includes("::") ? activeId.split("::")[0] : activeId;
      if (activeRoot !== templateId) return false;

      const todayStr = formatDatePart(new Date());
      const activeDate = activeId.includes("::") ? activeId.split("::")[1] : null;
      if (activeDate !== todayStr) return false;

      // Compute the new time window projected onto today
      const newStartTime = data.start.split(" ")[1];
      const newEndTime = data.end.split(" ")[1];
      const dataStartDate = data.start.split(" ")[0];
      const dataEndDate = data.end.split(" ")[0];
      const endDaySpan = dateDiffDays(dataStartDate, dataEndDate);
      const endDateForToday = endDaySpan !== 0 ? shiftDateStr(todayStr, endDaySpan) : todayStr;

      const now = new Date();
      const newStartMs = parseCalendarDate(`${todayStr} ${newStartTime}`).getTime();
      const newEndMs = parseCalendarDate(`${endDateForToday} ${newEndTime}`).getTime();

      // Session continues only if the new time window covers right now
      return !(now.getTime() >= newStartMs && now.getTime() < newEndMs);
    }

    // Direct edit of active block (non-recurring or "this")
    if (s.instanceEvent.id !== activeId) return false;
    const now = new Date();
    const newStart = parseCalendarDate(data.start);
    const newEnd = parseCalendarDate(data.end);
    return !(now >= newStart && now < newEnd);
  }

  // Flag: the user confirmed the session stop but the actual stopSession() call
  // must happen after the save because hybrid logic needs activeBlockId intact.
  let sessionStopPending = false;
  let deleteStopPending = false;

  // View history for Alt+Left/Right navigation (capped at 50)
  const VIEW_HISTORY_LIMIT = 50;
  type ViewState = { mode: CalendarViewMode; date: Date };
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
    viewMode = history[historyIndex].mode;
    anchorDate = history[historyIndex].date;
    isNavigatingHistory = false;
  }

  function historyForward() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    isNavigatingHistory = true;
    viewMode = history[historyIndex].mode;
    anchorDate = history[historyIndex].date;
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

  interface DeleteUndoToast {
    id: string;
    restore: () => Promise<void>;
    label: string;
  }

  let deleteUndoToast: DeleteUndoToast | null = $state(null);
  let deleteUndoTimer: ReturnType<typeof setTimeout> | undefined;

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

  function showDeleteUndoToast(label: string, restore: () => Promise<void>): void {
    clearDeleteUndoTimer();
    const id = crypto.randomUUID();
    deleteUndoToast = { id, restore, label };
    deleteUndoTimer = setTimeout(() => {
      if (deleteUndoToast?.id === id) deleteUndoToast = null;
      deleteUndoTimer = undefined;
    }, DELETE_UNDO_TIMEOUT_MS);
  }

  async function undoDeletedEvent(): Promise<void> {
    const toast = deleteUndoToast;
    if (!toast) return;
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
      notifications: e.notifications, pomodoroConfig: e.pomodoroConfig,
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

  function restoreForDeleteOutcome(
    outcome: CalendarDeleteOutcome,
    mutationEvent: CalendarEvent,
    snapshot?: CalendarEvent,
  ): (() => Promise<void>) | undefined {
    if (outcome === "archive") {
      const restoreTarget = mutationEvent.id.includes("::") ? mutationEvent : (snapshot ?? mutationEvent);
      return () => calendarStore.restoreArchivedBlock(restoreTarget);
    }
    if (!snapshot) return undefined;
    if (mutationEvent.id.includes("::")) return () => calendarStore.updateBlock(snapshot);
    return () => restoreDeletedBlock(snapshot);
  }

  function combineRestoreCallbacks(
    ...callbacks: Array<(() => Promise<void>) | undefined>
  ): (() => Promise<void>) | undefined {
    const restoreCallbacks = callbacks.filter(
      (callback): callback is () => Promise<void> => !!callback,
    );
    if (restoreCallbacks.length === 0) return undefined;
    return async () => {
      for (const callback of restoreCallbacks) {
        await callback();
      }
    };
  }

  onDestroy(() => {
    clearDeleteUndoTimer();
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

  function targetAnchorForNavigation(direction: "forward" | "back"): Date {
    const delta = direction === "forward" ? 1 : -1;
    const base = currentAnchor();
    if (viewMode === "week") return addDays(base, 7 * delta);
    if (viewMode === "day") return addDays(base, delta);
    const d = new Date(base);
    const targetMonth = d.getMonth() + delta;
    d.setDate(1);
    d.setMonth(targetMonth);
    return d;
  }

  function canRepeatHeldNavigation(direction: "forward" | "back"): boolean {
    if (
      pendingAnchor !== null
      || anchorRaf !== 0
      || calendarStore.foregroundWindowLoadBusy
      || !calendarStore.isWindowCurrent(viewWindow.start, viewWindow.end)
    ) {
      return false;
    }
    const targetWindow = computeViewWindow(targetAnchorForNavigation(direction), viewMode);
    return calendarStore.hasWindow(targetWindow.start, targetWindow.end);
  }

  function startNavHold(
    key: HeldNavigationKey,
    direction: "forward" | "back",
  ) {
    if (heldNavigation.activeKey === key) {
      heldNavigation.repeatFromKeydown(key);
      return;
    }
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
    if (anchorRaf !== 0) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
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
          startNavHold("ArrowLeft", "back");
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          startNavHold("ArrowRight", "forward");
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          if (viewMode === "month") {
            startNavHold(e.key, e.key === "ArrowUp" ? "back" : "forward");
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
      setAnchorDate: (date) => { anchorDate = date; },
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
      if (anchorRaf !== 0) {
        cancelAnimationFrame(anchorRaf);
        anchorRaf = 0;
      }
      pendingAnchor = null;
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("keyup", handleKeyup);
      window.removeEventListener("blur", handleBlur);
    };
  });

  // Scripted and wheel navigation can arrive faster than paint. Coalesce
  // anchor mutations to one commit per frame and always base the next step on
  // the latest pending target. Held keyboard navigation is separately gated
  // before it reaches this point.
  let pendingAnchor: Date | null = null;
  let anchorRaf = 0;
  function currentAnchor(): Date {
    return pendingAnchor ?? anchorDate;
  }
  function commitAnchor(next: Date) {
    pendingAnchor = next;
    if (anchorRaf !== 0) return;
    anchorRaf = requestAnimationFrame(() => {
      anchorRaf = 0;
      if (pendingAnchor) anchorDate = pendingAnchor;
      pendingAnchor = null;
      perfMark("nav.anchor-committed");
      tick().then(() => {
        perfMark("nav.display-ready", { count: visibleEvents.length });
        requestAnimationFrame(() => perfMark("nav.paint-done"));
      });
    });
  }

  function navigate(
    direction: "today" | "back" | "forward",
    source: "programmatic" | "wheel" | "key" | "hold-repeat" = "programmatic",
  ) {
    perfMark("nav.start", { dir: direction, source });
    if (direction === "today") {
      commitAnchor(new Date());
      return;
    }

    commitAnchor(targetAnchorForNavigation(direction));
  }

  function handleWheelNavigate(direction: "back" | "forward") {
    navigate(direction, "wheel");
  }

  function changeView(mode: CalendarViewMode) {
    perfMark("view.start", { from: viewMode, to: mode });
    pushHistory(mode, anchorDate);
    viewMode = mode;
    tick().then(() => {
      perfMark("view.mounted", { count: visibleEvents.length });
      requestAnimationFrame(() => perfMark("view.paint-done"));
    });
  }

  async function handleEventCreate(start: string, end: string, allDay?: boolean, createAnchor?: PanelAnchor) {
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
  }

  async function handleEventClick(event: CalendarEvent, rect?: DOMRect): Promise<void> {
    if (event.id === PENDING_CREATE_ID || event.id.startsWith(PENDING_CREATE_ID + "::")) return;

    // Already editing this exact event. Toggle panel closed if clean.
    if (session.state.mode === "edit" && (
      session.state.originalEvent.id === event.id || editingId === event.id
    )) {
      handlePanelClose();
      return;
    }

    const anchor: PanelAnchor = rect
      ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
      : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };

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
        "Your changes will be lost.",
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

    if (isRecurring(event)) {
      // Resolve the original instance before drag modified its position
      const originalInstance = visibleEvents.find((e) => e.id === event.id);
      if (!originalInstance) return;

      // If session is dirty, ask to discard before switching
      if (session.dirty) {
        const el = containerEl?.querySelector(`[data-event-id="${event.id}"]`);
        const rect = el?.getBoundingClientRect();
        const anchor: PanelAnchor = rect
          ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
          : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };
        requestConfirm(
          "Your changes will be lost.",
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
      const el = containerEl?.querySelector(`[data-event-id="${event.id}"]`);
      const rect = el?.getBoundingClientRect();
      const anchor: PanelAnchor = rect
        ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
        : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };

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
    panelOpenRequestId++;
    pendingEditEventId = undefined;
    if (session.dirty) {
      requestConfirm(
        "Your changes will be lost.",
        async () => { closeSession(); },
        { title: "Discard unsaved changes?", yesLabel: "Discard (Enter)", noLabel: "Cancel (Esc)" },
      );
      return;
    }
    closeSession();
  }

  function isPanelOrEventTarget(target: EventTarget | null): boolean {
    return target instanceof Element
      && (target.closest("[data-event-id]") !== null || target.closest(".panel-root") !== null);
  }

  function isConfirmDialogPanelTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(".confirm-dialog") !== null;
  }

  function handleOutsidePointerDown(e: PointerEvent) {
    if (confirmAction) return;
    if (session.state.mode === "closed") return;
    if (isPanelOrEventTarget(e.target)) return;

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

  async function handlePanelSave(data: {
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
  }, scope?: RecurringScope) {
    // Gate: confirm before stopping the active pomodoro session.
    // stopSession() is deferred until after the save so hybrid logic still sees activeBlockId.
    if (!sessionStopPending && wouldSaveStopSession(data, scope)) {
      requestConfirm(
        "The current focus session will stop.",
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
    const suppressPomodoroAutoStart = s.mode === "edit" && !!pomodoro.activeBlockId;
    // While save is in flight, hide edit outlines but keep the previewed
    // layout until canonical reload has updated the store. Capture from the
    // submitted save payload before suppressing preview recomputation.
    const saveFreeze = buildSaveDisplayFreeze(data, scope);
    suppressEditingGlow = true;
    suppressEditPreview = true;
    saveDisplayFreeze = saveFreeze;
    if (suppressPomodoroAutoStart) pomodoro.autoStartSuppressed = true;

    try {
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

        if (isRec && scope) {
          const now = new Date();
          const recurrencePlan = buildRecurringCommitPlan({
            rawBlocks: calendarStore.rawBlocks,
            templateId: s.templateId,
            instanceEvent,
            changes: data,
            scope,
            activeBlockId: pomodoro.activeBlockId ?? undefined,
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
          await syncSavedActivePomodoro(updated);
        }
      }

      // Stop session after all mutations complete because hybrid save logic needs activeBlockId intact.
      if (sessionStopPending) {
        await pomodoro.stopSession();
        sessionStopPending = false;
      }
      if (!saveRefreshedVisibleWindow) {
        await calendarStore.refreshWindow(viewWindow.start, viewWindow.end);
      }
      closeSession();
      await tick();
    } finally {
      if (suppressPomodoroAutoStart) pomodoro.autoStartSuppressed = false;
      suppressEditingGlow = false;
      suppressEditPreview = false;
      saveDisplayFreeze = null;
    }
  }

  type CalendarDeleteOutcome = "delete" | "archive";

  function eventDeleteOutcomeLabel(outcome: CalendarDeleteOutcome): string {
    return outcome === "archive" ? "Event archived" : "Event deleted";
  }

  function isActivePomodoroMutationError(message: string): boolean {
    return message.includes("active pomodoro run");
  }

  function suppressActivePomodoroRestart(event: CalendarEvent): void {
    const activeId = pomodoro.activeBlockId;
    if (activeId && eventMatchesActivePomodoro(event, activeId)) {
      pomodoro.dismissedBlockId = event.id;
    }
  }

  async function syncSavedActivePomodoro(event: CalendarEvent): Promise<void> {
    const activeId = pomodoro.activeBlockId;
    const config = event.pomodoroConfig;
    if (!activeId || event.id !== activeId || !config) return;
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

  async function deleteOrArchiveEvent(
    event: CalendarEvent,
    retryAfterStop = true,
  ): Promise<CalendarDeleteOutcome> {
    const action = deleteActionForCalendarEvent(event);
    try {
      if (action === "archive") {
        await calendarStore.archiveBlock(event);
        return "archive";
      } else {
        await calendarStore.deleteBlock(event);
        return "delete";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (action === "delete" && message.includes("archive it instead")) {
        await calendarStore.archiveBlock(event);
        return "archive";
      }
      if (retryAfterStop && isActivePomodoroMutationError(message)) {
        suppressActivePomodoroRestart(event);
        await pomodoro.stopSession();
        return deleteOrArchiveEvent(event, false);
      }
      throw error;
    }
  }

  async function handleDelete(id: string, scope?: RecurringScope) {
    const deletesActiveSession = wouldDeleteActiveSession(scope);
    if (deletesActiveSession && !deleteStopPending) {
      const action = session.state.mode === "edit"
        ? deleteActionForCalendarEvent(session.state.instanceEvent)
        : "delete";
      const actionVerb = action === "archive" ? "archive" : "delete";
      requestConfirm(
        `The current focus session will stop before this event is ${action === "archive" ? "archived" : "deleted"}.`,
        async () => {
          deleteStopPending = true;
          await handleDelete(id, scope);
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

    const activeBlockIdForDelete = pomodoro.activeBlockId;
    const s = session.state;

    if (deletesActiveSession && deleteStopPending) {
      deleteStopPending = false;
      if (s.mode === "edit") suppressActivePomodoroRestart(s.instanceEvent);
      await pomodoro.stopSession();
    }

    suppressEditPreview = true;
    saveDisplayFreeze = buildDeleteDisplayFreeze(id, scope);

    try {
    let restoreDeleted: (() => Promise<void>) | undefined;
    let deleteOutcome: CalendarDeleteOutcome = "delete";

    const archiveProtectedOccurrencesThenCapSeries = async (
      rangeStartDate: string,
      capBeforeDate: string,
      parentId: string,
      template: CalendarEvent,
      snapshot: CalendarEvent,
    ) => {
      const archiveEndDate = formatDatePart(new Date());
      const archivedOccurrences: CalendarEvent[] = [];
      for (const occurrence of protectedRecurringOccurrencesForArchive(
        snapshot,
        rangeStartDate,
        archiveEndDate,
      )) {
        await calendarStore.archiveBlock(occurrence);
        archivedOccurrences.push(occurrence);
      }
      const dayBefore = shiftDateStr(capBeforeDate, -1);
      await calendarStore.setRepeatUntil(parentId, dayBefore);
      deleteOutcome = archivedOccurrences.length > 0 ? "archive" : "delete";
      const restoreOccurrences = archivedOccurrences.length > 0
        ? async () => {
            for (const occurrence of archivedOccurrences) {
              await calendarStore.restoreArchivedBlock(occurrence);
            }
          }
        : undefined;
      restoreDeleted = combineRestoreCallbacks(
        restoreOccurrences,
        () => calendarStore.updateBlock(snapshot),
      );
    };

    if (scope && s.mode === "edit") {
      const instanceEvent = s.instanceEvent;
      const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
      if (scope === "this") {
        const template = calendarStore.getTemplate(instanceEvent);
        const full = await calendarStore.loadFullEvent(parentId);
        const snapshot = full ?? (template ? { ...template } : undefined);
        const mutationEvent = concreteRecurringOccurrenceForMutation(instanceEvent, template);
        deleteOutcome = await deleteOrArchiveEvent(mutationEvent);
        restoreDeleted = restoreForDeleteOutcome(deleteOutcome, mutationEvent, snapshot);
      } else if (scope === "following") {
        const template = calendarStore.getTemplate(instanceEvent);
        const full = await calendarStore.loadFullEvent(parentId);
        const snapshot = full ?? (template ? { ...template } : undefined);
        const instanceDate = instanceEvent.start.split(" ")[0];
        if (template && snapshot) {
          await archiveProtectedOccurrencesThenCapSeries(
            instanceDate,
            instanceDate,
            parentId,
            template,
            snapshot,
          );
        } else {
          const dayBefore = shiftDateStr(instanceDate, -1);
          await calendarStore.setRepeatUntil(parentId, dayBefore);
          if (snapshot) restoreDeleted = () => calendarStore.updateBlock(snapshot);
        }
      } else {
        const template = calendarStore.getTemplate(instanceEvent);
        const templateStartDate = template?.start.split(" ")[0];
        const currentDate = formatDatePart(new Date());
        const templateIsFutureOnly = !!template
          && deleteActionForCalendarEvent(template) === "delete"
          && !!templateStartDate
          && templateStartDate >= currentDate;

        if (template && templateStartDate && !templateIsFutureOnly) {
          const full = await calendarStore.loadFullEvent(parentId);
          const snapshot = full ?? { ...template };
          await archiveProtectedOccurrencesThenCapSeries(
            templateStartDate,
            templateStartDate,
            parentId,
            template,
            snapshot,
          );
        } else {
          let splitDate = formatDatePart(new Date());
          if (template && activeBlockIdForDelete) {
            const parts = activeBlockIdForDelete.split("::");
            if (parts[0] === template.id && parts[1] === splitDate) {
              splitDate = shiftDateStr(splitDate, 1);
            }
          }

          if (templateStartDate && templateStartDate < splitDate) {
            const full = await calendarStore.loadFullEvent(parentId);
            const snapshot = full ?? (template ? { ...template } : undefined);
            const dayBefore = shiftDateStr(splitDate, -1);
            await calendarStore.setRepeatUntil(parentId, dayBefore);
            if (snapshot) {
              restoreDeleted = () => calendarStore.updateBlock(snapshot);
            }
          } else {
            if (template) {
              const full = await calendarStore.loadFullEvent(template.id);
              const snapshot = full ?? { ...template };
              deleteOutcome = await deleteOrArchiveEvent(template);
              restoreDeleted = restoreForDeleteOutcome(deleteOutcome, template, snapshot);
            } else {
              await calendarStore.deleteBlock(parentId);
            }
          }
        }
      }
    } else {
      const event = calendarStore.getTemplate({ id } as CalendarEvent) ?? visibleEvents.find((e) => e.id === id);
      const full = event ? await calendarStore.loadFullEvent(event.id) : undefined;
      if (event) {
        deleteOutcome = await deleteOrArchiveEvent(event);
      } else {
        await calendarStore.deleteBlock(id);
      }
      const snapshot = full ?? (event ? { ...event } : undefined);
      if (event) {
        restoreDeleted = restoreForDeleteOutcome(deleteOutcome, event, snapshot);
      } else if (snapshot) {
        restoreDeleted = () => restoreDeletedBlock(snapshot);
      }
    }

    closeSession();
    if (restoreDeleted) showDeleteUndoToast(eventDeleteOutcomeLabel(deleteOutcome), restoreDeleted);
    } finally {
      suppressEditPreview = false;
      saveDisplayFreeze = null;
    }
  }

  function handleDayClickFromMonth(date: Date) {
    pushHistory("day", date);
    anchorDate = date;
    viewMode = "day";
  }

  function handleWeekDayHeaderClick(date: Date) {
    pushHistory("day", date);
    anchorDate = date;
    viewMode = "day";
  }

  function handleDayHeaderClick() {
    pushHistory("week", anchorDate);
    viewMode = "week";
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
    onDaySelect={(date) => { anchorDate = date; }}
  />

  <div bind:this={viewWrapperEl} class="min-w-0 flex-1 overflow-hidden" style="background-color: var(--cal-bg);">
    {#if viewMode === "week"}
      <WeekView
        {anchorDate}
        events={visibleEvents}
        {eventsByDay}
        theme={theme.current}
        {timezones}
        {tzAbbrMode}
        editingId={visualEditingId}
        {previewedIds}
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
      calendarIdentityEmail={panelCalendarIdentityEmail}
      loadFullEvent={calendarStore.loadPanelEvent}
      onSave={handlePanelSave}
      onDelete={panelRender.mode === "edit" && !panelRender.parked ? handleDelete : undefined}
      onChange={handlePanelChange}
      onInitialSync={handlePanelInitialSync}
      onClose={handlePanelClose}
      onScopeChange={handleScopeChange}
      onSurfaceStatusChange={handlePanelSurfaceStatusChange}
    />
  {/if}

  {#if deleteUndoToast}
    <div
      role="status"
      aria-live="polite"
      class="fixed bottom-4 left-1/2 z-70 flex w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-popover px-3 py-2 text-[0.866667rem] text-popover-foreground shadow-lg"
    >
      <span class="min-w-0 flex-1 truncate">{deleteUndoToast.label}</span>
      <button
        type="button"
        class="rounded-sm px-2 py-1 text-[0.8rem] font-medium text-popover-foreground underline decoration-popover-foreground/40 underline-offset-2 transition-colors hover:bg-accent hover:text-accent-foreground hover:no-underline focus:outline-none focus:ring-1 focus:ring-ring"
        onclick={undoDeletedEvent}
      >
        Undo
      </button>
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        onclick={dismissDeleteUndoToast}
      >
        <span class="sr-only">Dismiss event notification</span>
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  {/if}

</div>
