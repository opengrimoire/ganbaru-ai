<script lang="ts">
  import type { CalendarEvent, CalendarViewMode, EventColor, PomodoroConfig, RecurrenceConfig, RecurringScope } from "./types";
  import { addDays, getLocalTimezone } from "./utils";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { onMount } from "svelte";
  import CalendarHeader from "./CalendarHeader.svelte";
  import WeekView from "./WeekView.svelte";
  import DayView from "./DayView.svelte";
  import MonthView from "./MonthView.svelte";
  import EventPanel from "./EventPanel.svelte";

  const calendarStore = getCalendar();
  const theme = getTheme();

  let viewMode: CalendarViewMode = $state("week");
  let anchorDate: Date = $state(new Date());
  let timezones: string[] = $state([getLocalTimezone()]);

  // Calendar account visibility
  let enabledAccounts = $state(new Set(["ganbaruai"]));

  function toggleAccount(id: string) {
    const next = new Set(enabledAccounts);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    enabledAccounts = next;
  }

  // All current events belong to "ganbaruai"; filter them based on account visibility.
  // When the create panel is open, inject a pseudo-event so DayColumn renders
  // it as a full EventBlock with drag/resize support.
  const PENDING_CREATE_ID = "__pending_create__";
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const fmtMin = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

  const visibleEvents = $derived.by(() => {
    const events = enabledAccounts.has("ganbaruai") ? calendarStore.events : [];
    if (panelState.mode === "create" && pendingCreatePreview) {
      const p = pendingCreatePreview;
      return [...events, {
        id: PENDING_CREATE_ID,
        title: p.title || "",
        start: `${p.dateStr} ${fmtMin(p.startMinute)}`,
        end: `${p.dateStr} ${fmtMin(p.endMinute)}`,
        timezone: "",
        calendarId: "ganbaruai",
        color: p.color,
      } satisfies CalendarEvent];
    }
    return events;
  });

  // View history for Alt+Left/Right navigation (capped at 50)
  const VIEW_HISTORY_LIMIT = 50;
  type ViewState = { mode: CalendarViewMode; date: Date };
  let history: ViewState[] = $state([{ mode: "week", date: new Date() }]);
  let historyIndex = $state(0);
  let isNavigatingHistory = false;

  function pushHistory(mode: CalendarViewMode, date: Date) {
    if (isNavigatingHistory) return;
    // Snapshot current position before pushing — scroll/navigation may have
    // moved anchorDate since the current entry was created
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
      panelState = { mode: "closed" };
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

  // Event panel state
  type PanelAnchor = { x: number; y: number; width: number; height: number };
  type PanelState =
    | { mode: "closed" }
    | { mode: "create"; start: string; end: string; anchor: PanelAnchor }
    | { mode: "edit"; event: CalendarEvent; anchor: PanelAnchor; instanceEvent?: CalendarEvent };
  let panelState: PanelState = $state({ mode: "closed" });
  let containerEl: HTMLDivElement | undefined = $state();
  let pendingCreatePreview: { dateStr: string; startMinute: number; endMinute: number; title?: string; color?: EventColor } | null = $state(null);
  let lastPanelChanges: Partial<CalendarEvent> | null = $state(null);
  let currentScope: RecurringScope = $state("this");
  let panelDirty = $state(false);

  const editingEventId = $derived.by(() => {
    const ps = panelState;
    if (ps.mode === "edit") return ps.event.id;
    if (ps.mode === "create") return PENDING_CREATE_ID;
    return undefined;
  });

  function isRecurring(event: CalendarEvent): boolean {
    return !!event.recurringParentId || !!event.recurrence;
  }

  // Shared scroll position (preserved across view switches)
  let scrollMinute = $state(-1);

  onMount(() => {
    function handleKeydown(e: KeyboardEvent) {
      // Let contenteditable elements handle their own shortcuts
      const active = document.activeElement;
      if (active && (active as HTMLElement).isContentEditable) return;

      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        historyBack();
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        historyForward();
      } else if (confirmAction && e.key === "Enter") {
        e.preventDefault();
        confirmYes();
      } else if (confirmAction && e.key === "Escape") {
        e.preventDefault();
        confirmNo();
      } else if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        requestUndo();
      } else if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        requestRedo();
      } else if (e.key === "Escape" && panelState.mode !== "closed") {
        e.preventDefault();
        handlePanelClose();
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && panelState.mode === "closed" && !confirmAction) {
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
    // Extract date and minutes for preview
    const dateStr = start.split(" ")[0];
    const [sh, sm] = (start.split(" ")[1] ?? "0:0").split(":").map(Number);
    const [eh, em] = (end.split(" ")[1] ?? "0:0").split(":").map(Number);
    pendingCreatePreview = { dateStr, startMinute: sh * 60 + sm, endMinute: eh * 60 + em };

    // Find the create preview element to anchor the panel
    const previewEl = containerEl?.querySelector("[data-create-preview]");
    const rect = previewEl?.getBoundingClientRect();
    const anchor: PanelAnchor = rect
      ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
      : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };

    panelState = { mode: "create", start, end, anchor };
  }

  function handleEventClick(event: CalendarEvent, rect?: DOMRect) {
    pendingCreatePreview = null;
    lastPanelChanges = null;
    currentScope = "this";
    const anchor: PanelAnchor = rect
      ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
      : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };

    calendarStore.saveSnapshot();

    if (isRecurring(event)) {
      panelState = { mode: "edit", event, anchor, instanceEvent: event };
    } else {
      panelState = { mode: "edit", event, anchor };
    }
  }

  async function handleEventUpdate(event: CalendarEvent) {
    // Pseudo-event from create preview drag/resize
    if (event.id === PENDING_CREATE_ID) {
      if (panelState.mode === "create" && pendingCreatePreview) {
        const dateStr = event.start.split(" ")[0];
        const [sh, sm] = (event.start.split(" ")[1] ?? "0:0").split(":").map(Number);
        const [eh, em] = (event.end.split(" ")[1] ?? "0:0").split(":").map(Number);
        pendingCreatePreview = {
          ...pendingCreatePreview,
          dateStr,
          startMinute: sh * 60 + sm,
          endMinute: eh * 60 + em,
        };
        panelState = { mode: "create", start: event.start, end: event.end, anchor: panelState.anchor };
      }
      return;
    }

    if (isRecurring(event)) {
      // Resolve the original instance before drag modified its position.
      // calendarStore.events still has the pre-drag expanded list.
      const originalInstance = calendarStore.events.find((e) => e.id === event.id);
      if (!originalInstance) return;

      const el = containerEl?.querySelector(`[data-event-id="${event.id}"]`);
      const rect = el?.getBoundingClientRect();
      const anchor: PanelAnchor = rect
        ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
        : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };

      lastPanelChanges = { start: event.start, end: event.end };
      currentScope = "this";
      calendarStore.saveSnapshot();
      // Use originalInstance so exception/split targets the correct date
      calendarStore.previewRecurring(originalInstance, lastPanelChanges, currentScope);
      panelState = { mode: "edit", event: { ...event }, anchor, instanceEvent: originalInstance };
      return;
    }

    // Non-recurring: commit immediately
    const template = calendarStore.getTemplate(event);
    const before = template ? { ...template } : undefined;
    await calendarStore.updateBlock(event);
    if (before) {
      const after = calendarStore.getTemplate(event) ?? event;
      pushUndo({ type: "update", before, after: { ...after } });
      redoStack = [];
    }
    if (panelState.mode === "edit" && panelState.event.id === event.id) {
      const updated = calendarStore.getTemplate(panelState.event) ?? panelState.event;
      panelState = { mode: "edit", event: updated, anchor: panelState.anchor };
    }
  }

  function handlePanelChange(data: Partial<CalendarEvent>) {
    lastPanelChanges = data;
    if (panelState.mode === "edit" && panelState.instanceEvent) {
      // Recurring: scope-aware preview
      calendarStore.previewRecurring(panelState.instanceEvent, data, currentScope);
    } else if (panelState.mode === "edit") {
      // Non-recurring: direct preview
      calendarStore.previewBlock({ ...panelState.event, ...data });
    } else if (panelState.mode === "create" && pendingCreatePreview) {
      const updated = { ...pendingCreatePreview, title: data.title, color: data.color };
      if (data.start) {
        const dateStr = data.start.split(" ")[0];
        const [sh, sm] = (data.start.split(" ")[1] ?? "0:0").split(":").map(Number);
        updated.dateStr = dateStr;
        updated.startMinute = sh * 60 + sm;
      }
      if (data.end) {
        const [eh, em] = (data.end.split(" ")[1] ?? "0:0").split(":").map(Number);
        updated.endMinute = eh * 60 + em;
      }
      pendingCreatePreview = updated;
    }
  }

  function handleScopeChange(scope: RecurringScope) {
    currentScope = scope;
    if (panelState.mode === "edit" && panelState.instanceEvent && lastPanelChanges) {
      calendarStore.previewRecurring(panelState.instanceEvent, lastPanelChanges, scope);
    }
  }

  function handlePanelClose() {
    if (panelDirty) {
      requestConfirm(
        "Discard unsaved changes?",
        async () => {
          calendarStore.restoreSnapshot();
          panelState = { mode: "closed" };
          pendingCreatePreview = null;
          lastPanelChanges = null;
          panelDirty = false;
        },
        { yesLabel: "Discard (Enter)", noLabel: "Cancel (Esc)" },
      );
      return;
    }
    calendarStore.restoreSnapshot();
    panelState = { mode: "closed" };
    pendingCreatePreview = null;
    lastPanelChanges = null;
    panelDirty = false;
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
  }, scope?: RecurringScope) {
    const currentPanel = panelState;

    // Revert preview before DB writes so store operates on clean state
    calendarStore.restoreSnapshot();

    if (currentPanel.mode === "create") {
      const event = await calendarStore.addBlock({
        title: data.title, start: data.start, end: data.end,
        color: data.color, description: data.description,
        recurrence: data.recurrence, notifications: data.notifications,
        pomodoroConfig: data.pomodoroConfig,
      });
      pushUndo({ type: "add", event: { ...event } });
      redoStack = [];
    } else if (currentPanel.mode === "edit") {
      if (scope && currentPanel.instanceEvent) {
        const instanceEvent = currentPanel.instanceEvent;
        if (scope === "this") {
          const standalone = await calendarStore.detachInstance(instanceEvent);
          const updated: CalendarEvent = { ...standalone, ...data, recurrence: undefined };
          await calendarStore.updateBlock(updated);
        } else if (scope === "following") {
          await calendarStore.splitSeries(instanceEvent, data);
        } else {
          const template = calendarStore.getTemplate(instanceEvent);
          if (template) {
            // Compute day delta between original instance and save data (DST-safe)
            const [oy, om, od] = instanceEvent.start.split(" ")[0].split("-").map(Number);
            const [dy, dm, dd] = data.start.split(" ")[0].split("-").map(Number);
            const deltaDays = Math.round(
              (new Date(dy, dm - 1, dd).getTime() - new Date(oy, om - 1, od).getTime()) / 86400000,
            );
            const [sy, sm, sd] = template.start.split(" ")[0].split("-").map(Number);
            const [ey, em, ed] = template.end.split(" ")[0].split("-").map(Number);
            const sDate = new Date(sy, sm - 1, sd);
            const eDate = new Date(ey, em - 1, ed);
            if (deltaDays !== 0) {
              sDate.setDate(sDate.getDate() + deltaDays);
              eDate.setDate(eDate.getDate() + deltaDays);
            }
            const fmtD = (d: Date) =>
              `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            const updated: CalendarEvent = {
              ...template, ...data,
              start: `${fmtD(sDate)} ${data.start.split(" ")[1]}`,
              end: `${fmtD(eDate)} ${data.end.split(" ")[1]}`,
            };
            await calendarStore.updateBlock(updated);
          }
        }
      } else {
        // Non-recurring: update directly
        const updated: CalendarEvent = { ...currentPanel.event, ...data };
        const before = calendarStore.getTemplate(currentPanel.event) ?? currentPanel.event;
        await calendarStore.updateBlock(updated);
        pushUndo({ type: "update", before: { ...before }, after: { ...updated } });
        redoStack = [];
      }
    }
    calendarStore.discardSnapshot();
    panelState = { mode: "closed" };
    pendingCreatePreview = null;
    lastPanelChanges = null;
    panelDirty = false;
  }

  async function handleDelete(id: string, scope?: RecurringScope) {
    // Revert preview before DB writes
    calendarStore.restoreSnapshot();

    if (scope && panelState.mode === "edit" && panelState.instanceEvent) {
      const instanceEvent = panelState.instanceEvent;
      const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
      if (scope === "this") {
        const instanceDate = instanceEvent.start.split(" ")[0];
        await calendarStore.addException(parentId, instanceDate);
      } else if (scope === "following") {
        const instanceDate = instanceEvent.start.split(" ")[0];
        const d = new Date(instanceDate + "T00:00:00");
        d.setDate(d.getDate() - 1);
        const dayBefore = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
    calendarStore.discardSnapshot();
    panelState = { mode: "closed" };
    lastPanelChanges = null;
    panelDirty = false;
  }

  function handleDayClickFromMonth(date: Date) {
    pushHistory("day", date);
    anchorDate = date;
    viewMode = "day";
  }

  // Week view: click day header -> go to day view
  function handleWeekDayHeaderClick(date: Date) {
    pushHistory("day", date);
    anchorDate = date;
    viewMode = "day";
  }

  // Day view: click day header -> go to week view
  function handleDayHeaderClick() {
    pushHistory("week", anchorDate);
    viewMode = "week";
  }
</script>

<div bind:this={containerEl} class="relative flex h-full select-none overflow-hidden rounded-tl-lg">
  <CalendarHeader
    {anchorDate}
    {viewMode}
    {enabledAccounts}
    onNavigate={navigate}
    onViewChange={changeView}
    onDaySelect={(date) => { anchorDate = date; }}
    onAccountToggle={toggleAccount}
  />

  <div class="min-w-0 flex-1 overflow-hidden" style="background-color: var(--cal-bg);">
    {#if viewMode === "week"}
      <WeekView
        {anchorDate}
        events={visibleEvents}
        isDark={theme.isDark}
        {timezones}
        pendingCreatePreview={panelState.mode === "create" ? null : pendingCreatePreview}
        {editingEventId}
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
        pendingCreatePreview={panelState.mode === "create" ? null : pendingCreatePreview}
        {editingEventId}
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

  <!-- Undo/redo confirmation -->
  {#if confirmAction}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center"
      onclick={confirmNo}
    >
      <div class="absolute inset-0 bg-black/40"></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="relative z-10 rounded-lg border border-border bg-card px-6 py-4 shadow-xl"
        onclick={(e) => e.stopPropagation()}
      >
        <p class="mb-4 text-sm text-foreground">{confirmMessage}</p>
        <div class="flex items-center justify-end gap-2">
          <button
            onclick={confirmNo}
            class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {confirmNoLabel}
          </button>
          <button
            onclick={confirmYes}
            class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {confirmYesLabel}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Floating event panel -->
  {#if panelState.mode === "create" || panelState.mode === "edit"}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-40" onclick={handlePanelClose}></div>
    {#if panelState.mode === "create"}
      <EventPanel
        mode="create"
        start={panelState.start}
        end={panelState.end}
        anchor={panelState.anchor}
        onSave={handlePanelSave}
        onChange={handlePanelChange}
        onClose={handlePanelClose}
        onDirtyChange={(d) => { panelDirty = d; }}
      />
    {:else if panelState.mode === "edit"}
      <EventPanel
        mode="edit"
        event={panelState.event}
        anchor={panelState.anchor}
        onSave={handlePanelSave}
        onDelete={handleDelete}
        onChange={handlePanelChange}
        onClose={handlePanelClose}
        onScopeChange={handleScopeChange}
        onDirtyChange={(d) => { panelDirty = d; }}
      />
    {/if}
  {/if}

</div>
