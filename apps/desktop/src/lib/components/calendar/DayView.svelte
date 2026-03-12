<script lang="ts">
  import type { CalendarEvent, DragState, PositionedEvent } from "./types";
  import {
    isToday,
    isPastDay,
    formatDatePart,
    formatDayName,
    minuteOfDay,
    minuteToTop,
    snapToGrid,
    clampMinute,
    GUTTER_WIDTH_PER_TZ,
  } from "./utils";
  import TimeGutter from "./TimeGutter.svelte";
  import DayColumn from "./DayColumn.svelte";
  import TimezoneSelector from "./TimezoneSelector.svelte";
  import { onMount } from "svelte";

  let {
    anchorDate,
    events,
    hourHeight = 48,
    isDark = false,
    timezones = [] as string[],
    onSlotClick,
    onEventClick,
    onEventUpdate,
    onAddTimezone,
    onRemoveTimezone,
    onWheelNavigate,
  }: {
    anchorDate: Date;
    events: CalendarEvent[];
    hourHeight?: number;
    isDark?: boolean;
    timezones?: string[];
    onSlotClick: (dateStr: string, startMinute: number) => void;
    onEventClick: (event: CalendarEvent) => void;
    onEventUpdate: (event: CalendarEvent) => void;
    onAddTimezone?: (tz: string) => void;
    onRemoveTimezone?: (index: number) => void;
    onWheelNavigate?: (direction: "back" | "forward") => void;
  } = $props();

  let scrollContainer: HTMLDivElement | undefined = $state();
  let wheelCooldown = false;

  function handleHeaderWheel(e: WheelEvent) {
    e.preventDefault();
    if (!onWheelNavigate || wheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    wheelCooldown = true;
    onWheelNavigate(e.deltaY > 0 ? "forward" : "back");
    setTimeout(() => { wheelCooldown = false; }, 300);
  }
  let currentTimeMinute = $state(-1);
  let dragState: DragState | null = $state(null);
  let dragPreview: PositionedEvent | null = $state(null);

  const today = $derived(isToday(anchorDate));
  const past = $derived(isPastDay(anchorDate));
  const dateStr = $derived(formatDatePart(anchorDate));
  const tzCount = $derived(Math.max(1, timezones.length));
  const gridCols = $derived(
    `repeat(${tzCount}, ${GUTTER_WIDTH_PER_TZ}px) 1fr`,
  );

  const dayLabel = $derived(
    `${formatDayName(anchorDate, "long")}, ${anchorDate.toLocaleDateString("en-US", { month: "long" })} ${anchorDate.getDate()}`,
  );

  function updateCurrentTime() {
    const now = new Date();
    currentTimeMinute = now.getHours() * 60 + now.getMinutes();
  }

  onMount(() => {
    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000);

    if (scrollContainer) {
      const now = new Date();
      const targetHour = Math.max(0, now.getHours() - 2);
      scrollContainer.scrollTop = targetHour * hourHeight;
    }

    return () => clearInterval(interval);
  });

  function handleDragStart(eventId: string, e: PointerEvent) {
    const event = events.find((ev) => ev.id === eventId);
    if (!event) return;

    dragState = {
      eventId,
      type: "move",
      originDate: dateStr,
      originStartMinute: minuteOfDay(event.start),
      originEndMinute: minuteOfDay(event.end),
      pointerStartY: e.clientY,
      pointerStartX: e.clientX,
      columnWidth: 0,
      startColumnIndex: 0,
    };

    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
  }

  function handleDragMove(e: PointerEvent) {
    if (!dragState) return;

    const event = events.find((ev) => ev.id === dragState!.eventId);
    if (!event) return;

    const deltaY = e.clientY - dragState.pointerStartY;
    const deltaMinutes = snapToGrid((deltaY / hourHeight) * 60);

    let newStart: number;
    let newEnd: number;

    if (dragState.type === "move") {
      newStart = clampMinute(dragState.originStartMinute + deltaMinutes);
      const dur = dragState.originEndMinute - dragState.originStartMinute;
      newEnd = clampMinute(newStart + dur);
      if (newEnd > 1440) {
        newEnd = 1440;
        newStart = newEnd - dur;
      }
      if (newStart < 0) {
        newStart = 0;
        newEnd = dur;
      }
    } else if (dragState.type === "resize-top") {
      newStart = clampMinute(dragState.originStartMinute + deltaMinutes);
      newEnd = dragState.originEndMinute;
      if (newStart >= newEnd - 15) newStart = newEnd - 15;
    } else {
      newStart = dragState.originStartMinute;
      newEnd = clampMinute(dragState.originEndMinute + deltaMinutes);
      if (newEnd <= newStart + 15) newEnd = newStart + 15;
    }

    const startH = String(Math.floor(newStart / 60)).padStart(2, "0");
    const startM = String(newStart % 60).padStart(2, "0");
    const endH = String(Math.floor(Math.min(newEnd, 1440) / 60)).padStart(2, "0");
    const endM = String(Math.min(newEnd, 1440) % 60).padStart(2, "0");

    dragPreview = {
      event: {
        ...event,
        start: `${dateStr} ${startH}:${startM}`,
        end: `${dateStr} ${endH}:${endM}`,
      },
      top: minuteToTop(newStart, hourHeight),
      height: ((newEnd - newStart) / 60) * hourHeight,
      left: 0,
      width: 100,
      column: 0,
      totalColumns: 1,
    };
  }

  function handleDragEnd() {
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", handleDragEnd);

    if (dragPreview) {
      onEventUpdate(dragPreview.event);
    }

    dragState = null;
    dragPreview = null;
  }
</script>

<div
  bind:this={scrollContainer}
  class="h-full overflow-y-auto overflow-x-hidden"
  style="background-color: var(--cal-bg);"
>
  <div class="grid" style="grid-template-columns: {gridCols};">
    <!-- Sticky header row -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="sticky top-0 z-10 grid"
      onwheel={handleHeaderWheel}
      style="
        grid-column: 1 / -1;
        grid-template-columns: subgrid;
        height: var(--cal-header-row-h);
        background-color: var(--cal-header-bg);
      "
    >
      <TimezoneSelector
        {timezones}
        {tzCount}
        onAdd={(tz) => onAddTimezone?.(tz)}
        onRemove={(i) => onRemoveTimezone?.(i)}
      />
      <div
        class="flex items-center px-4"
        style="{past ? 'opacity: 0.45;' : ''}"
      >
        <span class="text-[13px] font-semibold" style="color: {past ? 'var(--muted-foreground)' : 'var(--foreground)'};">
          {dayLabel}
        </span>
      </div>
    </div>

    <!-- Body row -->
    <TimeGutter {hourHeight} {timezones} {anchorDate} {tzCount} />
    <div class="min-w-0">
      <DayColumn
        date={anchorDate}
        {events}
        {hourHeight}
        isToday={today}
        isPast={past}
        {isDark}
        {currentTimeMinute}
        {dragPreview}
        onSlotClick={onSlotClick}
        onEventClick={onEventClick}
        onDragStart={handleDragStart}
      />
    </div>
  </div>
</div>
