<script lang="ts">
  import type {
    CalendarEvent, CalendarViewMode, EventAttendee, EventColor, EventStatus,
    EventTransparency, EventVisibility, GuestPermissions,
    PomodoroConfig, RecurrenceConfig, RecurringScope,
  } from "./types";
  import { addDays, getLocalTimezone } from "./utils";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getCalendars } from "$lib/stores/calendars.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { onMount } from "svelte";
  import CalendarHeader from "./CalendarHeader.svelte";
  import WeekView from "./WeekView.svelte";
  import DayView from "./DayView.svelte";
  import MonthView from "./MonthView.svelte";
  import EventPanel from "./EventPanel.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import { createEditSession } from "./edit-session.svelte";
  import type { PanelAnchor } from "./edit-session.svelte";
  import {
    closedDisplay,
    buildCreateDisplay,
    computeEditDisplay,
    dateDiffDays,
    shiftDateStr,
    PENDING_CREATE_ID,
  } from "./display-events";

  const calendarStore = getCalendar();
  const calendarsStore = getCalendars();
  const theme = getTheme();

  let viewMode: CalendarViewMode = $state("week");
  let anchorDate: Date = $state(new Date());
  let timezones: string[] = $state([getLocalTimezone()]);

  // --- Edit session (replaces panelState, panelDirty, lastPanelChanges, etc.) ---
  const session = createEditSession();

  // --- Display events (pure overlay, no store mutation) ---
  const displayResult = $derived.by(() => {
    const visIds = calendarsStore.visibleIds;
    const storeEvents = calendarStore.events.filter((e) => visIds.has(e.calendarId));
    const s = session.state;
    if (s.mode === "closed") return closedDisplay(storeEvents);
    if (s.mode === "create") return buildCreateDisplay(storeEvents, session.createPreview, session.changes);
    // mode === "edit": dispatch by scope
    return computeEditDisplay(
      calendarStore.rawBlocks,
      storeEvents,
      { originalEvent: s.originalEvent, instanceEvent: s.instanceEvent, templateId: s.templateId },
      session.changes,
      session.scope,
    );
  });

  const visibleEvents = $derived(displayResult.events);
  let suppressEditingGlow = $state(false);
  const previewedIds = $derived(suppressEditingGlow ? new Set<string>() : displayResult.previewedIds);
  const editingId = $derived(suppressEditingGlow ? undefined : displayResult.editingId);

  // Merged event for the panel (original + changes, so panel sees drag/resize updates)
  const panelEvent = $derived.by(() => {
    const s = session.state;
    if (s.mode === "edit") {
      return { ...s.originalEvent, ...session.changes } as CalendarEvent;
    }
    return undefined;
  });

  function isRecurring(event: CalendarEvent): boolean {
    return !!event.recurringParentId || !!event.recurrence;
  }

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

  function addTimezone(tz: string) {
    if (timezones.length < 3 && !timezones.includes(tz)) {
      timezones = [...timezones, tz];
    }
  }

  function removeTimezone(index: number) {
    if (index > 0) {
      timezones = timezones.filter((_, i) => i !== index);
    }
  }

  // Event undo/redo (capped at 20)
  const UNDO_LIMIT = 20;
  type UndoAction =
    | { type: "add"; event: CalendarEvent }
    | { type: "delete"; event: CalendarEvent }
    | { type: "update"; before: CalendarEvent; after: CalendarEvent };
  let undoStack: UndoAction[] = $state([]);
  let redoStack: UndoAction[] = $state([]);

  function pushUndo(action: UndoAction) {
    undoStack = [...undoStack, action].slice(-UNDO_LIMIT);
  }

  // Confirmation dialog
  let confirmAction: (() => Promise<void>) | null = $state(null);
  let confirmMessage = $state("");
  let confirmYesLabel = $state("Yes (Enter)");
  let confirmNoLabel = $state("No (Esc)");
  function requestConfirm(
    message: string,
    action: () => Promise<void>,
    opts?: { yesLabel?: string; noLabel?: string },
  ) {
    confirmMessage = message;
    confirmAction = action;
    confirmYesLabel = opts?.yesLabel ?? "Yes (Enter)";
    confirmNoLabel = opts?.noLabel ?? "No (Esc)";
  }

  async function confirmYes() {
    const action = confirmAction;
    confirmAction = null;
    confirmMessage = "";
    if (action) await action();
  }

  function confirmNo() {
    confirmAction = null;
    confirmMessage = "";
  }

  function requestUndo() {
    const action = undoStack[undoStack.length - 1];
    if (!action) return;
    let message = "";
    if (action.type === "add") message = `Undo creating "${action.event.title}"?`;
    else if (action.type === "delete") message = `Undo deleting "${action.event.title}"?`;
    else message = `Undo moving "${action.after.title}"?`;
    requestConfirm(message, async () => {
      undoStack = undoStack.slice(0, -1);
      if (action.type === "add") {
        await calendarStore.deleteBlock(action.event.id);
      } else if (action.type === "delete") {
        await calendarStore.addBlock({
          title: action.event.title, start: action.event.start, end: action.event.end,
          id: action.event.id, color: action.event.color, description: action.event.description,
          recurrence: action.event.recurrence, notifications: action.event.notifications,
          pomodoroConfig: action.event.pomodoroConfig,
        });
      } else {
        await calendarStore.updateBlock(action.before);
      }
      redoStack = [...redoStack, action];
      session.close();
    });
  }

  function requestRedo() {
    const action = redoStack[redoStack.length - 1];
    if (!action) return;
    let message = "";
    if (action.type === "add") message = `Redo creating "${action.event.title}"?`;
    else if (action.type === "delete") message = `Redo deleting "${action.event.title}"?`;
    else message = `Redo moving "${action.after.title}"?`;
    requestConfirm(message, async () => {
      redoStack = redoStack.slice(0, -1);
      if (action.type === "add") {
        await calendarStore.addBlock({
          title: action.event.title, start: action.event.start, end: action.event.end,
          id: action.event.id, color: action.event.color, description: action.event.description,
          recurrence: action.event.recurrence, notifications: action.event.notifications,
          pomodoroConfig: action.event.pomodoroConfig,
        });
      } else if (action.type === "delete") {
        await calendarStore.deleteBlock(action.event.id);
      } else {
        await calendarStore.updateBlock(action.after);
      }
      pushUndo(action);
    });
  }

  let containerEl: HTMLDivElement | undefined = $state();

  // Shared scroll position (preserved across view switches)
  let scrollMinute = $state(-1);

  onMount(() => {
    function handleKeydown(e: KeyboardEvent) {
      const active = document.activeElement;
      if (active && (active as HTMLElement).isContentEditable) return;

      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        historyBack();
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        historyForward();
      } else if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        requestUndo();
      } else if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        requestRedo();
      } else if (e.key === "Escape" && session.state.mode !== "closed") {
        e.preventDefault();
        handlePanelClose();
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && session.state.mode === "closed" && !confirmAction) {
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          navigate("back");
        } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          navigate("forward");
        }
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  function navigate(direction: "today" | "back" | "forward") {
    if (direction === "today") {
      anchorDate = new Date();
      return;
    }

    const delta = direction === "forward" ? 1 : -1;

    if (viewMode === "week") {
      anchorDate = addDays(anchorDate, 7 * delta);
    } else if (viewMode === "day") {
      anchorDate = addDays(anchorDate, delta);
    } else {
      const d = new Date(anchorDate);
      d.setMonth(d.getMonth() + delta);
      anchorDate = d;
    }
  }

  function handleWheelNavigate(direction: "back" | "forward") {
    navigate(direction);
  }

  function changeView(mode: CalendarViewMode) {
    pushHistory(mode, anchorDate);
    viewMode = mode;
  }

  function handleEventCreate(start: string, end: string) {
    const previewEl = containerEl?.querySelector("[data-create-preview]");
    const rect = previewEl?.getBoundingClientRect();
    const anchor: PanelAnchor = rect
      ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
      : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };

    session.openCreate(start, end, anchor);
  }

  function handleEventClick(event: CalendarEvent, rect?: DOMRect) {
    if (event.id === PENDING_CREATE_ID || event.id.startsWith(PENDING_CREATE_ID + "::")) return;

    // Already editing this exact event, nothing to do
    if (session.state.mode === "edit" && (
      session.state.originalEvent.id === event.id || editingId === event.id
    )) return;

    const anchor: PanelAnchor = rect
      ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
      : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };

    const openEvent = () => {
      if (isRecurring(event)) {
        session.openEdit(event, anchor, event);
      } else {
        session.openEdit(event, anchor);
      }
    };

    if (session.dirty) {
      requestConfirm(
        "Discard unsaved changes?",
        async () => { openEvent(); },
        { yesLabel: "Discard (Enter)", noLabel: "Cancel (Esc)" },
      );
      return;
    }

    openEvent();
  }

  async function handleEventUpdate(event: CalendarEvent) {
    // Pseudo-event from create preview drag/resize
    if (event.id === PENDING_CREATE_ID) {
      if (session.state.mode === "create") {
        session.updateChanges({ start: event.start, end: event.end });
      }
      return;
    }

    if (isRecurring(event)) {
      // If the dragged event matches the current editing ID (may be a virtual ID
      // from Following/All overlay), route the time changes to the session
      if (session.state.mode === "edit" && (
        session.state.originalEvent.id === event.id || editingId === event.id
      )) {
        session.updateChanges({ start: event.start, end: event.end });
        return;
      }

      // Resolve the original instance before drag modified its position
      const originalInstance = calendarStore.events.find((e) => e.id === event.id);
      if (!originalInstance) return;

      // If session is dirty, ask to discard before switching
      if (session.dirty) {
        const el = containerEl?.querySelector(`[data-event-id="${event.id}"]`);
        const rect = el?.getBoundingClientRect();
        const anchor: PanelAnchor = rect
          ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
          : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };
        requestConfirm(
          "Discard unsaved changes?",
          async () => {
            session.openEdit(event, anchor, originalInstance);
            session.updateChanges({ start: event.start, end: event.end });
          },
          { yesLabel: "Discard (Enter)", noLabel: "Cancel (Esc)" },
        );
        return;
      }

      // Drag on recurring without panel open -- open panel with changes
      const el = containerEl?.querySelector(`[data-event-id="${event.id}"]`);
      const rect = el?.getBoundingClientRect();
      const anchor: PanelAnchor = rect
        ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
        : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };

      session.openEdit(event, anchor, originalInstance);
      session.updateChanges({ start: event.start, end: event.end });
      return;
    }

    // Non-recurring: persist directly (no panel needed for drag)
    const template = calendarStore.getTemplate(event);
    const before = template ? { ...template } : undefined;
    await calendarStore.updateBlock(event);
    if (before) {
      const after = calendarStore.getTemplate(event) ?? event;
      pushUndo({ type: "update", before, after: { ...after } });
      redoStack = [];
    }
    // If panel is open for this event, update it
    if (session.state.mode === "edit" && session.state.originalEvent.id === event.id) {
      const updated = calendarStore.getTemplate(event) ?? event;
      session.openEdit(updated, session.state.anchor);
    }
  }

  function handlePanelChange(data: Partial<CalendarEvent>) {
    session.updateChanges(data);
  }

  function handleScopeChange(newScope: RecurringScope) {
    session.updateScope(newScope);
  }

  function handlePanelClose() {
    if (session.dirty) {
      requestConfirm(
        "Discard unsaved changes?",
        async () => { session.close(); },
        { yesLabel: "Discard (Enter)", noLabel: "Cancel (Esc)" },
      );
      return;
    }
    session.close();
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
    location?: string;
    url?: string;
    transparency?: EventTransparency;
    status?: EventStatus;
    visibility?: EventVisibility;
    attendees?: EventAttendee[];
    guestPermissions?: GuestPermissions;
  }, scope?: RecurringScope) {
    const s = session.state;

    if (s.mode === "create") {
      const event = await calendarStore.addBlock({
        title: data.title, start: data.start, end: data.end,
        color: data.color, description: data.description,
        recurrence: data.recurrence, notifications: data.notifications,
        pomodoroConfig: data.pomodoroConfig,
        allDay: data.allDay, location: data.location, url: data.url,
        transparency: data.transparency, status: data.status,
        visibility: data.visibility, attendees: data.attendees,
        guestPermissions: data.guestPermissions,
      });
      pushUndo({ type: "add", event: { ...event } });
      redoStack = [];
    } else if (s.mode === "edit") {
      const instanceEvent = s.instanceEvent;
      const isRec = isRecurring(s.originalEvent);

      if (isRec && scope) {
        // Suppress both editingId and previewedIds so ALL event blocks
        // lose the glow simultaneously via CSS transition. This prevents
        // the glow from reappearing on recreated DOM elements after the
        // store mutation (which runs before session.close).
        suppressEditingGlow = true;

        if (scope === "this") {
          const standalone = await calendarStore.detachInstance(instanceEvent);
          const updated: CalendarEvent = { ...standalone, ...data, recurrence: undefined };
          await calendarStore.updateBlock(updated);
        } else if (scope === "following") {
          await calendarStore.splitSeries(instanceEvent, data);
        } else {
          // "all": shift template dates by day delta
          const template = calendarStore.getTemplate(instanceEvent);
          if (template) {
            const instanceDateStr = instanceEvent.start.split(" ")[0];
            const changesDateStr = data.start.split(" ")[0];
            const delta = dateDiffDays(instanceDateStr, changesDateStr);
            const templateStartDate = template.start.split(" ")[0];
            const templateEndDate = template.end.split(" ")[0];
            const newStartDate = delta !== 0 ? shiftDateStr(templateStartDate, delta) : templateStartDate;
            const newEndDate = delta !== 0 ? shiftDateStr(templateEndDate, delta) : templateEndDate;
            const updated: CalendarEvent = {
              ...template, ...data,
              start: `${newStartDate} ${data.start.split(" ")[1]}`,
              end: `${newEndDate} ${data.end.split(" ")[1]}`,
            };
            await calendarStore.updateBlock(updated);
          }
        }
      } else {
        // Non-recurring: CSS transition handles the fade naturally (same DOM element)
        const updated: CalendarEvent = { ...s.originalEvent, ...data };
        const before = calendarStore.getTemplate(s.originalEvent) ?? s.originalEvent;
        await calendarStore.updateBlock(updated);
        pushUndo({ type: "update", before: { ...before }, after: { ...updated } });
        redoStack = [];
      }
    }

    session.close();
    suppressEditingGlow = false;
  }

  async function handleDelete(id: string, scope?: RecurringScope) {
    const s = session.state;

    if (scope && s.mode === "edit") {
      const instanceEvent = s.instanceEvent;
      const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
      if (scope === "this") {
        const instanceDate = instanceEvent.start.split(" ")[0];
        await calendarStore.addException(parentId, instanceDate);
      } else if (scope === "following") {
        const instanceDate = instanceEvent.start.split(" ")[0];
        const dayBefore = shiftDateStr(instanceDate, -1);
        await calendarStore.setRepeatUntil(parentId, dayBefore);
      } else {
        const template = calendarStore.getTemplate(instanceEvent);
        if (template) {
          pushUndo({ type: "delete", event: { ...template } });
          redoStack = [];
        }
        await calendarStore.deleteBlock(parentId);
      }
    } else {
      // Non-recurring: delete directly
      const event = calendarStore.getTemplate({ id } as CalendarEvent) ?? calendarStore.events.find((e) => e.id === id);
      await calendarStore.deleteBlock(id);
      if (event) {
        pushUndo({ type: "delete", event: { ...event } });
        redoStack = [];
      }
    }

    session.close();
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

<div bind:this={containerEl} class="relative flex h-full select-none overflow-hidden rounded-tl-lg">
  <CalendarHeader
    {anchorDate}
    {viewMode}
    onNavigate={navigate}
    onViewChange={changeView}
    onDaySelect={(date) => { anchorDate = date; }}
  />

  <div class="min-w-0 flex-1 overflow-hidden" style="background-color: var(--cal-bg);">
    {#if viewMode === "week"}
      <WeekView
        {anchorDate}
        events={visibleEvents}
        isDark={theme.isDark}
        {timezones}
        editingId={editingId}
        {previewedIds}
        initialScrollMinute={scrollMinute}
        onScrollChange={(m) => { scrollMinute = m; }}
        onEventClick={handleEventClick}
        onEventUpdate={handleEventUpdate}
        onEventCreate={handleEventCreate}
        onAddTimezone={addTimezone}
        onRemoveTimezone={removeTimezone}
        onWheelNavigate={handleWheelNavigate}
        onDayHeaderClick={handleWeekDayHeaderClick}
      />
    {:else if viewMode === "day"}
      <DayView
        {anchorDate}
        events={visibleEvents}
        isDark={theme.isDark}
        {timezones}
        editingId={editingId}
        {previewedIds}
        initialScrollMinute={scrollMinute}
        onScrollChange={(m) => { scrollMinute = m; }}
        onEventClick={handleEventClick}
        onEventUpdate={handleEventUpdate}
        onEventCreate={handleEventCreate}
        onAddTimezone={addTimezone}
        onRemoveTimezone={removeTimezone}
        onWheelNavigate={handleWheelNavigate}
        onDayHeaderClick={handleDayHeaderClick}
      />
    {:else}
      <MonthView
        {anchorDate}
        events={visibleEvents}
        isDark={theme.isDark}
        onDayClick={handleDayClickFromMonth}
        onEventClick={handleEventClick}
        onWheelNavigate={handleWheelNavigate}
      />
    {/if}
  </div>

  {#if confirmAction}
    <ConfirmDialog
      message={confirmMessage}
      confirmLabel={confirmYesLabel}
      cancelLabel={confirmNoLabel}
      onConfirm={confirmYes}
      onCancel={confirmNo}
    />
  {/if}

  <!-- Floating event panel -->
  {#if session.state.mode === "create" || session.state.mode === "edit"}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-40" onclick={handlePanelClose}></div>
    {#if session.state.mode === "create"}
      <EventPanel
        mode="create"
        start={session.state.start}
        end={session.state.end}
        anchor={session.state.anchor}
        onSave={handlePanelSave}
        onChange={handlePanelChange}
        onClose={handlePanelClose}
      />
    {:else if session.state.mode === "edit"}
      <EventPanel
        mode="edit"
        event={panelEvent}
        anchor={session.state.anchor}
        externalDirty={session.dirty}
        readOnly={calendarsStore.isReadOnly(session.state.originalEvent.calendarId)}
        onSave={handlePanelSave}
        onDelete={handleDelete}
        onChange={handlePanelChange}
        onClose={handlePanelClose}
        onScopeChange={handleScopeChange}
      />
    {/if}
  {/if}

</div>
