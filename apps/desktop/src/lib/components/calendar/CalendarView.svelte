<script lang="ts">
  import type { CalendarEvent, CalendarViewMode, EventColor, RepeatRule } from "./types";
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
        await calendarStore.addBlock(
          action.event.title, action.event.start, action.event.end,
          action.event.id, action.event.color, action.event.description,
          action.event.repeatRule, action.event.notificationMinutes,
        );
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
        await calendarStore.addBlock(
          action.event.title, action.event.start, action.event.end,
          action.event.id, action.event.color, action.event.description,
          action.event.repeatRule, action.event.notificationMinutes,
        );
      } else if (action.type === "delete") {
        await calendarStore.deleteBlock(action.event.id);
      } else {
        await calendarStore.updateBlock(action.after);
      }
      pushUndo(action);
    });
  }

  // Recurring edit scope
  type RecurringScope = "this" | "following" | "all";

  // Event panel state
  type PanelAnchor = { x: number; y: number; width: number; height: number };
  type PanelState =
    | { mode: "closed" }
    | { mode: "create"; start: string; end: string; anchor: PanelAnchor }
    | { mode: "edit"; event: CalendarEvent; anchor: PanelAnchor; instanceEvent?: CalendarEvent };
  let panelState: PanelState = $state({ mode: "closed" });
  let editSnapshot: CalendarEvent | null = $state(null);
  let containerEl: HTMLDivElement | undefined = $state();
  let pendingCreatePreview: { dateStr: string; startMinute: number; endMinute: number; title?: string; color?: EventColor } | null = $state(null);

  // Unified scope action — shown after save/delete/drag on recurring events
  type ScopeAction =
    | { type: "save"; data: { title: string; start: string; end: string; color?: EventColor; description: string; repeatRule: RepeatRule; notificationMinutes?: number; focusDurationMinutes: number; shortBreakMinutes: number; longBreakMinutes: number }; instanceEvent: CalendarEvent }
    | { type: "delete"; instanceEvent: CalendarEvent }
    | { type: "drag"; event: CalendarEvent; before: CalendarEvent };
  let scopeAction: ScopeAction | null = $state(null);

  const scopeDialogTitle = $derived.by(() => {
    if (!scopeAction) return "";
    if (scopeAction.type === "save") return "Edit recurring event";
    if (scopeAction.type === "delete") return "Delete recurring event";
    return "Move recurring event";
  });

  function isRecurring(event: CalendarEvent): boolean {
    return !!event.recurringParentId || (!!event.repeatRule && event.repeatRule !== "none");
  }

  // Shared scroll position (preserved across view switches)
  let scrollMinute = $state(-1);

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
      } else if (e.key === "Escape" && scopeAction) {
        e.preventDefault();
        scopeAction = null;
      } else if (e.key === "Escape" && panelState.mode !== "closed") {
        e.preventDefault();
        handlePanelClose();
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && panelState.mode === "closed" && !confirmAction && !scopeAction) {
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
    const anchor: PanelAnchor = rect
      ? { x: rect.right, y: rect.top, width: rect.width, height: rect.height }
      : { x: window.innerWidth / 2, y: window.innerHeight / 3, width: 0, height: 0 };

    if (isRecurring(event)) {
      // Recurring: open editor without live preview
      panelState = { mode: "edit", event, anchor, instanceEvent: event };
    } else {
      // Non-recurring: open editor with live preview
      editSnapshot = { ...event };
      panelState = { mode: "edit", event, anchor };
    }
  }

  async function handleEventUpdate(event: CalendarEvent) {
    if (isRecurring(event)) {
      // Don't apply any changes yet — show scope dialog
      const template = calendarStore.getTemplate(event);
      if (template) {
        scopeAction = { type: "drag", event, before: { ...template } };
      }
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
    if (panelState.mode === "edit" && !panelState.instanceEvent) {
      // Live preview only for non-recurring events
      calendarStore.previewBlock({ ...panelState.event, ...data });
    } else if (panelState.mode === "create" && pendingCreatePreview) {
      pendingCreatePreview = {
        ...pendingCreatePreview,
        title: data.title,
        color: data.color,
      };
    }
  }

  function handlePanelClose() {
    if (editSnapshot) {
      calendarStore.previewBlock(editSnapshot);
      editSnapshot = null;
    }
    panelState = { mode: "closed" };
    pendingCreatePreview = null;
  }

  async function handlePanelSave(data: {
    title: string;
    start: string;
    end: string;
    color?: EventColor;
    description: string;
    repeatRule: RepeatRule;
    notificationMinutes?: number;
    focusDurationMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
  }) {
    const currentPanel = panelState;
    if (currentPanel.mode === "create") {
      const event = await calendarStore.addBlock(
        data.title, data.start, data.end, undefined,
        data.color, data.description, data.repeatRule, data.notificationMinutes,
      );
      const full: CalendarEvent = {
        ...event,
        focusDurationMinutes: data.focusDurationMinutes,
        shortBreakMinutes: data.shortBreakMinutes,
        longBreakMinutes: data.longBreakMinutes,
      };
      await calendarStore.updateBlock(full);
      pushUndo({ type: "add", event: { ...full } });
      redoStack = [];
    } else if (currentPanel.mode === "edit") {
      if (currentPanel.instanceEvent) {
        // Recurring instance: close panel, show scope dialog
        scopeAction = { type: "save", data, instanceEvent: currentPanel.instanceEvent };
        panelState = { mode: "closed" };
        return;
      }
      // Non-recurring: update directly
      const before = editSnapshot ?? calendarStore.events.find((e) => e.id === currentPanel.event.id);
      const updated: CalendarEvent = { ...currentPanel.event, ...data };
      await calendarStore.updateBlock(updated);
      if (before) {
        pushUndo({ type: "update", before: { ...before }, after: { ...updated } });
        redoStack = [];
      }
    }
    editSnapshot = null;
    panelState = { mode: "closed" };
    pendingCreatePreview = null;
  }

  async function handleDelete(id: string) {
    if (panelState.mode === "edit" && panelState.instanceEvent) {
      // Recurring instance: close panel, show scope dialog
      scopeAction = { type: "delete", instanceEvent: panelState.instanceEvent };
      panelState = { mode: "closed" };
      return;
    }
    // Non-recurring: delete directly
    const event = editSnapshot ?? calendarStore.events.find((e) => e.id === id);
    if (editSnapshot) {
      calendarStore.previewBlock(editSnapshot);
    }
    await calendarStore.deleteBlock(id);
    if (event) {
      pushUndo({ type: "delete", event: { ...event } });
      redoStack = [];
    }
    editSnapshot = null;
    panelState = { mode: "closed" };
  }

  async function handleScopeConfirm(scope: RecurringScope) {
    if (!scopeAction) return;
    const action = scopeAction;
    scopeAction = null;

    if (action.type === "save") {
      const { data, instanceEvent } = action;
      if (scope === "this") {
        const standalone = await calendarStore.detachInstance(instanceEvent);
        const updated: CalendarEvent = { ...standalone, ...data, repeatRule: undefined };
        await calendarStore.updateBlock(updated);
      } else if (scope === "following") {
        await calendarStore.splitSeries(instanceEvent, data);
      } else {
        // "all": merge time-of-day into template, keep template dates
        const template = calendarStore.getTemplate(instanceEvent);
        if (template) {
          const newStartTime = data.start.split(" ")[1];
          const newEndTime = data.end.split(" ")[1];
          const updated: CalendarEvent = {
            ...template, ...data,
            start: `${template.start.split(" ")[0]} ${newStartTime}`,
            end: `${template.end.split(" ")[0]} ${newEndTime}`,
          };
          await calendarStore.updateBlock(updated);
        }
      }
    } else if (action.type === "delete") {
      const { instanceEvent } = action;
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
    } else if (action.type === "drag") {
      const { event, before } = action;
      if (scope === "this") {
        const standalone = await calendarStore.detachInstance(event);
        const updated: CalendarEvent = { ...standalone, start: event.start, end: event.end };
        await calendarStore.updateBlock(updated);
      } else if (scope === "following") {
        await calendarStore.splitSeries(event, { start: event.start, end: event.end });
      } else {
        await calendarStore.updateBlock(event);
        pushUndo({ type: "update", before: { ...before }, after: { ...event } });
        redoStack = [];
      }
    }
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

  <!-- Recurring event scope dialog (save / delete / drag) -->
  {#if scopeAction}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-50 flex items-center justify-center" onclick={() => { scopeAction = null; }}>
      <div class="absolute inset-0 bg-black/40"></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="relative z-10 rounded-lg border border-border bg-card px-5 py-4 shadow-xl"
        onclick={(e) => e.stopPropagation()}
      >
        <p class="mb-3 text-sm font-medium text-foreground">{scopeDialogTitle}</p>
        <div class="flex flex-col gap-1.5">
          <button
            onclick={() => handleScopeConfirm("this")}
            class="rounded-md px-4 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent"
          >
            This event
          </button>
          <button
            onclick={() => handleScopeConfirm("following")}
            class="rounded-md px-4 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent"
          >
            This and following events
          </button>
          <button
            onclick={() => handleScopeConfirm("all")}
            class="rounded-md px-4 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent"
          >
            All events
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
      />
    {/if}
  {/if}

</div>
