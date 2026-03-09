<script lang="ts">
  import { ScheduleXCalendar } from "@schedule-x/svelte";
  import {
    createCalendar,
    viewWeek,
    viewDay,
    viewMonthGrid,
    toDateTimeString,
  } from "@schedule-x/calendar";
  import { createEventsServicePlugin } from "@schedule-x/events-service";
  import { createDragAndDropPlugin } from "@schedule-x/drag-and-drop";
  import "@schedule-x/theme-default/dist/index.css";
  import type { CalendarEventExternal } from "@schedule-x/calendar";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { onMount } from "svelte";

  const calendarStore = getCalendar();
  const eventsService = createEventsServicePlugin();

  // Pending state for create dialog
  let showCreateDialog = $state(false);
  let pendingStart = $state("");
  let pendingEnd = $state("");
  let newTitle = $state("Focus session");

  // Selected event for detail panel
  let selectedEvent = $state<CalendarEventExternal | null>(null);

  function addOneHour(scheduleXDate: string): string {
    const [datePart, timePart] = scheduleXDate.split(" ");
    const [h, m] = timePart.split(":").map(Number);
    const newH = (h + 1) % 24;
    return `${datePart} ${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  const calendarApp = createCalendar(
    {
      defaultView: viewWeek.name,
      views: [viewWeek, viewDay, viewMonthGrid],
      isDark: true,
      events: [],
      callbacks: {
        onDoubleClickDateTime: (dt) => {
          pendingStart = toDateTimeString(dt);
          pendingEnd = addOneHour(pendingStart);
          newTitle = "Focus session";
          showCreateDialog = true;
        },
        onEventUpdate: async (event) => {
          await calendarStore.updateBlock(event);
        },
        onEventClick: (event) => {
          selectedEvent = event;
        },
      },
    },
    [eventsService, createDragAndDropPlugin()],
  );

  onMount(async () => {
    await calendarStore.load();
    eventsService.set(calendarStore.events);
  });

  async function handleCreate() {
    if (!pendingStart || !pendingEnd) return;
    const event = await calendarStore.addBlock(newTitle, pendingStart, pendingEnd);
    eventsService.add(event);
    showCreateDialog = false;
  }

  async function handleDelete() {
    if (!selectedEvent) return;
    await calendarStore.deleteBlock(String(selectedEvent.id));
    eventsService.remove(selectedEvent.id);
    selectedEvent = null;
  }
</script>

<div class="relative flex h-full flex-col overflow-hidden">
  <div class="sx-container flex-1 overflow-hidden">
    <ScheduleXCalendar calendarApp={calendarApp} />
  </div>

  <!-- Create dialog -->
  {#if showCreateDialog}
    <div
      class="absolute inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
    >
      <div class="w-80 rounded-lg border border-border bg-card p-4 shadow-xl">
        <p class="mb-3 text-sm font-semibold">New session block</p>
        <p class="mb-3 text-xs text-muted-foreground">
          {pendingStart} → {pendingEnd}
        </p>
        <input
          type="text"
          bind:value={newTitle}
          placeholder="Session title..."
          class="w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          onkeydown={(e) => {
            if (e.key === "Enter") handleCreate();
            if (e.key === "Escape") {
              showCreateDialog = false;
            }
          }}
        />
        <div class="mt-3 flex justify-end gap-2">
          <button
            class="rounded px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
            onclick={() => (showCreateDialog = false)}
          >
            Cancel
          </button>
          <button
            class="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:opacity-80"
            onclick={handleCreate}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Event detail panel -->
  {#if selectedEvent}
    <div
      class="absolute bottom-4 right-4 z-40 w-64 rounded-lg border border-border bg-card p-4 shadow-lg"
    >
      <div class="mb-1 flex items-start justify-between gap-2">
        <span class="text-sm font-medium">{selectedEvent.title}</span>
        <button
          onclick={() => (selectedEvent = null)}
          class="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        {selectedEvent.start} → {selectedEvent.end}
      </p>
      <button
        onclick={handleDelete}
        class="mt-3 w-full rounded bg-destructive px-2 py-1.5 text-xs text-white hover:opacity-90"
      >
        Delete
      </button>
    </div>
  {/if}
</div>

<style>
  .sx-container :global(.sx-svelte-calendar-wrapper),
  .sx-container :global(.sx__wrapper) {
    height: 100%;
  }
</style>
