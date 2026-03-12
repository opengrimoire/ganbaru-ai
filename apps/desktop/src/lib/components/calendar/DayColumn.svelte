<script lang="ts">
  import type { CalendarEvent, PositionedEvent } from "./types";
  import {
    eventsForDay,
    layoutEventsForDay,
    formatDatePart,
    minuteOfDay,
    snapToGrid,
    clampMinute,
  } from "./utils";
  import EventBlock from "./EventBlock.svelte";

  let {
    date,
    events,
    hourHeight = 48,
    isToday = false,
    isPast = false,
    isDark = false,
    currentTimeMinute = -1,
    dragPreview = null,
    onSlotClick,
    onEventClick,
    onDragStart,
  }: {
    date: Date;
    events: CalendarEvent[];
    hourHeight?: number;
    isToday?: boolean;
    isPast?: boolean;
    isDark?: boolean;
    currentTimeMinute?: number;
    dragPreview?: PositionedEvent | null;
    onSlotClick: (dateStr: string, startMinute: number) => void;
    onEventClick: (event: CalendarEvent) => void;
    onDragStart: (eventId: string, e: PointerEvent) => void;
  } = $props();

  // Height of the past-time overlay in pixels
  const pastOverlayHeight = $derived.by(() => {
    if (isPast) return 24 * hourHeight;
    if (isToday && currentTimeMinute >= 0) {
      return (currentTimeMinute / 60) * hourHeight;
    }
    return 0;
  });

  const hours = Array.from({ length: 24 }, (_, i) => i);

  const dayEvents = $derived(eventsForDay(events, date));
  const positioned = $derived(layoutEventsForDay(dayEvents, hourHeight));

  const totalHeight = $derived(24 * hourHeight);
  const dateStr = $derived(formatDatePart(date));

  function isEventPast(event: CalendarEvent): boolean {
    if (isPast) return true;
    if (isToday && currentTimeMinute >= 0) {
      return minuteOfDay(event.end) <= currentTimeMinute;
    }
    return false;
  }

  function handleSlotClick(e: MouseEvent, hour: number) {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minuteWithinHour = snapToGrid((offsetY / hourHeight) * 60);
    const minute = clampMinute(hour * 60 + minuteWithinHour);
    onSlotClick(dateStr, minute);
  }
</script>

<div
  class="relative min-w-0"
  style="height: {totalHeight}px; border-left: 1px solid var(--cal-gridline);"
>
  <!-- Past time dimming overlay -->
  {#if pastOverlayHeight > 0}
    <div
      class="pointer-events-none absolute left-0 right-0 top-0 z-[1]"
      style="height: {pastOverlayHeight}px; background-color: var(--cal-past-overlay);"
    ></div>
  {/if}

  <!-- Hour cells (click targets + gridlines) -->
  {#each hours as hour}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="hour-cell absolute w-full cursor-pointer"
      style="
        top: {hour * hourHeight}px;
        height: {hourHeight}px;
        border-bottom: 1px solid var(--cal-gridline);
      "
      onclick={(e) => handleSlotClick(e, hour)}
    ></div>
  {/each}

  <!-- Events -->
  {#each positioned as pos (pos.event.id)}
    <EventBlock
      positioned={pos}
      {isDark}
      isPast={isEventPast(pos.event)}
      onclick={() => onEventClick(pos.event)}
      onpointerdown={(e) => onDragStart(pos.event.id, e)}
    />
  {/each}

  <!-- Drag preview -->
  {#if dragPreview}
    <div
      class="pointer-events-none absolute overflow-hidden rounded px-1.5 py-0.5 text-[11px] leading-tight opacity-50"
      style="
        top: {dragPreview.top}px;
        height: {dragPreview.height}px;
        left: 0;
        width: 100%;
        background-color: var(--cal-today-circle);
        z-index: 10;
      "
    >
      <div class="truncate font-medium">{dragPreview.event.title}</div>
    </div>
  {/if}

  <!-- Half-hour dashed lines -->
  {#each hours as hour}
    <div
      class="pointer-events-none absolute w-full"
      style="
        top: {hour * hourHeight + hourHeight / 2}px;
        height: 0;
        border-bottom: 1px dashed var(--cal-gridline);
        opacity: 0.4;
      "
    ></div>
  {/each}

  <!-- Current time line -->
  {#if isToday && currentTimeMinute >= 0}
    <div
      class="pointer-events-none absolute left-0 right-0 z-[2]"
      style="top: {(currentTimeMinute / 60) * hourHeight}px;"
    >
      <div class="flex items-center">
        <div
          class="h-2.5 w-2.5 shrink-0 rounded-full"
          style="background-color: var(--cal-current-time); margin-left: -5px;"
        ></div>
        <div
          class="h-[2px] flex-1"
          style="background-color: var(--cal-current-time);"
        ></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .hour-cell:hover {
    background-color: var(--cal-hover);
  }
</style>
