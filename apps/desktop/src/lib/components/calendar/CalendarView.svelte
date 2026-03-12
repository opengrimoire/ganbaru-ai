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

  // View history for Alt+Left/Right navigation
  type ViewState = { mode: CalendarViewMode; date: Date };
  let history: ViewState[] = $state([{ mode: "week", date: new Date() }]);
  let historyIndex = $state(0);
  let isNavigatingHistory = false;

  function pushHistory(mode: CalendarViewMode, date: Date) {
    if (isNavigatingHistory) return;
    // Trim forward history when making a new navigation
    history = [...history.slice(0, historyIndex + 1), { mode, date }];
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

  // Create dialog state
  let showCreateDialog = $state(false);
  let pendingStart = $state("");
  let pendingEnd = $state("");

  // Event detail state
  let selectedEvent: CalendarEvent | null = $state(null);

  onMount(async () => {
    await calendarStore.load();

    function handleKeydown(e: KeyboardEvent) {
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        historyBack();
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        historyForward();
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

  function handleSlotClick(dateStr: string, startMinute: number) {
    const h = String(Math.floor(startMinute / 60)).padStart(2, "0");
    const m = String(startMinute % 60).padStart(2, "0");
    pendingStart = `${dateStr} ${h}:${m}`;

    const endMinute = Math.min(startMinute + 60, 1440);
    const eh = String(Math.floor(endMinute / 60)).padStart(2, "0");
    const em = String(endMinute % 60).padStart(2, "0");
    pendingEnd = `${dateStr} ${eh}:${em}`;

    showCreateDialog = true;
    selectedEvent = null;
  }

  function handleEventClick(event: CalendarEvent) {
    selectedEvent = event;
  }

  async function handleEventUpdate(event: CalendarEvent) {
    await calendarStore.updateBlock(event);
    // If viewing the updated event, refresh the selection
    if (selectedEvent?.id === event.id) {
      selectedEvent = event;
    }
  }

  async function handleCreate(title: string, start: string, end: string) {
    if (!start || !end) return;
    await calendarStore.addBlock(title, start, end);
    showCreateDialog = false;
  }

  async function handleDelete(id: string) {
    await calendarStore.deleteBlock(id);
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

<div class="relative flex h-full overflow-hidden rounded-tl-lg">
  <CalendarHeader
    {anchorDate}
    {viewMode}
    onNavigate={navigate}
    onViewChange={changeView}
    onDaySelect={(date) => { anchorDate = date; }}
  />

  <div class="min-w-0 flex-1 overflow-hidden">
    {#if viewMode === "week"}
      <WeekView
        {anchorDate}
        events={calendarStore.events}
        isDark={theme.isDark}
        {timezones}
        onSlotClick={handleSlotClick}
        onEventClick={handleEventClick}
        onEventUpdate={handleEventUpdate}
        onAddTimezone={addTimezone}
        onRemoveTimezone={removeTimezone}
        onWheelNavigate={handleWheelNavigate}
        onDayHeaderClick={handleWeekDayHeaderClick}
      />
    {:else if viewMode === "day"}
      <DayView
        {anchorDate}
        events={calendarStore.events}
        isDark={theme.isDark}
        {timezones}
        onSlotClick={handleSlotClick}
        onEventClick={handleEventClick}
        onEventUpdate={handleEventUpdate}
        onAddTimezone={addTimezone}
        onRemoveTimezone={removeTimezone}
        onWheelNavigate={handleWheelNavigate}
        onDayHeaderClick={handleDayHeaderClick}
      />
    {:else}
      <MonthView
        {anchorDate}
        events={calendarStore.events}
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
      onCancel={() => (showCreateDialog = false)}
    />
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
