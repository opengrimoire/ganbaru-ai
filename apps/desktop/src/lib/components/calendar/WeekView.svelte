<script lang="ts">
  import type { CalendarEvent, DragState, PositionedEvent } from "./types";
  import type { DayNameFormat } from "./utils";
  import {
    getWeekDays,
    isToday,
    isPastDay,
    formatDayName,
    formatDatePart,
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
    navTrigger = 0,
    navDirection = "forward" as "back" | "forward",
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
    navTrigger?: number;
    navDirection?: "back" | "forward";
  } = $props();

  const weekDays = $derived(getWeekDays(anchorDate));
  const tzCount = $derived(Math.max(1, timezones.length));
  const gridCols = $derived(
    `repeat(${tzCount}, ${GUTTER_WIDTH_PER_TZ}px) repeat(7, 1fr)`,
  );

  // Responsive day name format based on column width
  let headerCells: HTMLElement[] = $state([]);
  let dayFormat: DayNameFormat = $state("short");

  $effect(() => {
    const el = headerCells[0];
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0].contentBoxSize[0].inlineSize;
      if (w >= 110) dayFormat = "long";
      else if (w >= 60) dayFormat = "short";
      else if (w >= 36) dayFormat = "narrow";
      else dayFormat = "none";
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  let scrollContainer: HTMLDivElement | undefined = $state();
  let dayHeadersEl: HTMLDivElement | undefined = $state();
  let dayColumnsEl: HTMLDivElement | undefined = $state();
  let currentTimeMinute = $state(-1);
  let wheelCooldown = false;
  let lastNavTrigger = 0;

  $effect(() => {
    if (navTrigger > lastNavTrigger) {
      lastNavTrigger = navTrigger;
      const x = navDirection === "forward" ? "40px" : "-40px";
      const frames = [
        { transform: `translateX(${x})` },
        { transform: "translateX(0)" },
      ];
      const opts: KeyframeAnimationOptions = { duration: 200, easing: "ease-out" };
      dayHeadersEl?.animate(frames, opts);
      dayColumnsEl?.animate(frames, opts);
    }
  });

  function handleHeaderWheel(e: WheelEvent) {
    e.preventDefault();
    if (!onWheelNavigate || wheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    wheelCooldown = true;
    onWheelNavigate(e.deltaY > 0 ? "forward" : "back");
    setTimeout(() => { wheelCooldown = false; }, 300);
  }
  let dragState: DragState | null = $state(null);
  let dragPreviewDate: string | null = $state(null);
  let dragPreview: PositionedEvent | null = $state(null);

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

    const dateStr = event.start.split(" ")[0];

    const gridEl = scrollContainer?.querySelector(".week-grid");
    const firstCol = gridEl?.querySelector(".day-col") as HTMLElement | null;
    const columnWidth = firstCol?.getBoundingClientRect().width ?? 100;

    dragState = {
      eventId,
      type: "move",
      originDate: dateStr,
      originStartMinute: minuteOfDay(event.start),
      originEndMinute: minuteOfDay(event.end),
      pointerStartY: e.clientY,
      pointerStartX: e.clientX,
      columnWidth,
      startColumnIndex: weekDays.findIndex(
        (d) => formatDatePart(d) === dateStr,
      ),
    };

    const blockEl = (e.target as HTMLElement).closest(".event-block-wrapper");
    if (blockEl) {
      const rect = blockEl.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      if (relY <= 6) {
        dragState.type = "resize-top";
      } else if (relY >= rect.height - 6) {
        dragState.type = "resize-bottom";
      }
    }

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
    let targetDate = dragState.originDate;

    if (dragState.type === "move") {
      const deltaX = e.clientX - dragState.pointerStartX;
      const colShift = Math.round(deltaX / dragState.columnWidth);
      const newColIndex = Math.max(
        0,
        Math.min(6, dragState.startColumnIndex + colShift),
      );
      targetDate = formatDatePart(weekDays[newColIndex]);

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

    dragPreviewDate = targetDate;
    dragPreview = {
      event: {
        ...event,
        start: `${targetDate} ${startH}:${startM}`,
        end: `${targetDate} ${endH}:${endM}`,
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
    dragPreviewDate = null;
  }
</script>

<div
  bind:this={scrollContainer}
  class="h-full overflow-y-auto overflow-x-hidden"
  style="background-color: var(--cal-bg);"
>
  <div
    class="week-grid grid"
    style="grid-template-columns: {gridCols};"
  >
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
        border-bottom: 1px solid var(--cal-gridline);
      "
    >
      <!-- Timezone header cells — subgrid aligns with TimeGutter columns -->
      <TimezoneSelector
        {timezones}
        tzCount={tzCount}
        onAdd={(tz) => onAddTimezone?.(tz)}
        onRemove={(i) => onRemoveTimezone?.(i)}
      />

      <!-- Day headers (animatable) -->
      <div
        bind:this={dayHeadersEl}
        class="grid"
        style="grid-column: span 7; grid-template-columns: subgrid;"
      >
        {#each weekDays as day, i}
          {@const past = isPastDay(day)}
          <div
            bind:this={headerCells[i]}
            class="flex items-center justify-center"
            style="border-left: 1px solid var(--cal-gridline);{past ? ' opacity: 0.45;' : ''}"
          >
            <span class="text-[13px] font-semibold" style="color: var(--foreground);">
              {#if dayFormat !== "none"}{formatDayName(day, dayFormat)}&nbsp;{/if}{day.getDate()}
            </span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Body: one cell per timezone + 7 day columns -->
    <TimeGutter {hourHeight} {timezones} {anchorDate} tzCount={tzCount} />

    <!-- Day columns (animatable) -->
    <div
      bind:this={dayColumnsEl}
      class="grid"
      style="grid-column: span 7; grid-template-columns: subgrid;"
    >
      {#each weekDays as day}
        {@const dateStr = formatDatePart(day)}
        <div class="day-col min-w-0">
          <DayColumn
            date={day}
            {events}
            {hourHeight}
            isToday={isToday(day)}
            isPast={isPastDay(day)}
            {isDark}
            {currentTimeMinute}
            dragPreview={dragPreviewDate === dateStr ? dragPreview : null}
            onSlotClick={onSlotClick}
            onEventClick={onEventClick}
            onDragStart={handleDragStart}
          />
        </div>
      {/each}
    </div>
  </div>
</div>
