<script lang="ts">
  import type { CalendarEvent, CalendarViewMode } from "./types";
  import { addDays, getLocalTimezone } from "./utils";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { onMount } from "svelte";
  import CalendarHeader from "./CalendarHeader.svelte";
  import WeekView from "./WeekView.svelte";
  import DayView from "./DayView.svelte";
  import MonthView from "./MonthView.svelte";
  import CreateDialog from "./CreateDialog.svelte";
  import EventDetail from "./EventDetail.svelte";

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

  // All current events belong to "ganbaruai"; filter them based on account visibility
  const visibleEvents = $derived(
    enabledAccounts.has("ganbaruai") ? calendarStore.events : [],
  );

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

  // Confirmation dialog for undo/redo
  let confirmAction: (() => Promise<void>) | null = $state(null);
  let confirmMessage = $state("");

  function requestConfirm(message: string, action: () => Promise<void>) {
    confirmMessage = message;
    confirmAction = action;
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
        await calendarStore.addBlock(action.event.title, action.event.start, action.event.end, action.event.id);
      } else {
        await calendarStore.updateBlock(action.before);
      }
      redoStack = [...redoStack, action];
      selectedEvent = null;
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
        await calendarStore.addBlock(action.event.title, action.event.start, action.event.end, action.event.id);
      } else if (action.type === "delete") {
        await calendarStore.deleteBlock(action.event.id);
      } else {
        await calendarStore.updateBlock(action.after);
      }
      pushUndo(action);
    });
  }

  // Create dialog state
  let showCreateDialog = $state(false);
  let pendingStart = $state("");
  let pendingEnd = $state("");
  let pendingCreatePreview: { dateStr: string; startMinute: number; endMinute: number } | null = $state(null);

  // Shared scroll position (preserved across view switches)
  let scrollMinute = $state(-1);

  // Event detail state
  let selectedEvent: CalendarEvent | null = $state(null);

  onMount(() => {
    function handleKeydown(e: KeyboardEvent) {
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
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && !showCreateDialog && !confirmAction && !selectedEvent) {
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
    pendingStart = start;
    pendingEnd = end;

    // Extract date and minutes for preview
    const dateStr = start.split(" ")[0];
    const [sh, sm] = (start.split(" ")[1] ?? "0:0").split(":").map(Number);
    const [eh, em] = (end.split(" ")[1] ?? "0:0").split(":").map(Number);
    pendingCreatePreview = { dateStr, startMinute: sh * 60 + sm, endMinute: eh * 60 + em };

    showCreateDialog = true;
    selectedEvent = null;
  }

  function handleEventClick(event: CalendarEvent) {
    selectedEvent = event;
  }

  async function handleEventUpdate(event: CalendarEvent) {
    const before = calendarStore.events.find((e) => e.id === event.id);
    await calendarStore.updateBlock(event);
    if (before) {
      pushUndo({ type: "update", before: { ...before }, after: { ...event } });
      redoStack = [];
    }
    if (selectedEvent?.id === event.id) {
      selectedEvent = event;
    }
  }

  async function handleCreate(title: string, start: string, end: string) {
    if (!start || !end) return;
    const event = await calendarStore.addBlock(title, start, end);
    pushUndo({ type: "add", event: { ...event } });
    redoStack = [];
    showCreateDialog = false;
    pendingCreatePreview = null;
  }

  async function handleDelete(id: string) {
    const event = calendarStore.events.find((e) => e.id === id);
    await calendarStore.deleteBlock(id);
    if (event) {
      pushUndo({ type: "delete", event: { ...event } });
      redoStack = [];
    }
    selectedEvent = null;
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

<div class="relative flex h-full select-none overflow-hidden rounded-tl-lg">
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
        {pendingCreatePreview}
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
        {pendingCreatePreview}
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

  <!-- Create dialog -->
  {#if showCreateDialog}
    <CreateDialog
      startTime={pendingStart}
      endTime={pendingEnd}
      onConfirm={handleCreate}
      onCancel={() => { showCreateDialog = false; pendingCreatePreview = null; }}
    />
  {/if}

  <!-- Undo/redo confirmation -->
  {#if confirmAction}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center"
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
            No (Esc)
          </button>
          <button
            onclick={confirmYes}
            class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Yes (Enter)
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Event detail panel -->
  {#if selectedEvent}
    <EventDetail
      event={selectedEvent}
      onClose={() => (selectedEvent = null)}
      onDelete={handleDelete}
    />
  {/if}
</div>
