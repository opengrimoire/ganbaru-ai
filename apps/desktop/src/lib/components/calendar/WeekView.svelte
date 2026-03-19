<script lang="ts">
  import type { CalendarEvent, EventColor } from "./types";
  import type { DayNameFormat } from "./utils";
  import {
    getWeekDays,
    isToday,
    isPastDay,
    formatDayName,
    formatDatePart,
    GUTTER_WIDTH_PER_TZ,
  } from "./utils";
  import TimeGutter from "./TimeGutter.svelte";
  import DayColumn from "./DayColumn.svelte";
  import TimezoneSelector from "./TimezoneSelector.svelte";
  import { useDragController } from "./useDragController.svelte";
  import { onMount } from "svelte";

  let {
    anchorDate,
    events,
    hourHeight = 67,
    isDark = false,
    timezones = [] as string[],
    onEventClick,
    onEventUpdate,
    onEventCreate,
    pendingCreatePreview = null,
    initialScrollMinute = -1,
    onScrollChange,
    onAddTimezone,
    onRemoveTimezone,
    onWheelNavigate,
    onDayHeaderClick,
  }: {
    anchorDate: Date;
    events: CalendarEvent[];
    hourHeight?: number;
    isDark?: boolean;
    timezones?: string[];
    onEventClick: (event: CalendarEvent, rect?: DOMRect) => void;
    onEventUpdate: (event: CalendarEvent) => void;
    onEventCreate: (start: string, end: string) => void;
    pendingCreatePreview?: { dateStr: string; startMinute: number; endMinute: number; title?: string; color?: EventColor } | null;
    initialScrollMinute?: number;
    onScrollChange?: (minute: number) => void;
    onAddTimezone?: (tz: string) => void;
    onRemoveTimezone?: (index: number) => void;
    onWheelNavigate?: (direction: "back" | "forward") => void;
    onDayHeaderClick?: (date: Date) => void;
  } = $props();

  const weekDays = $derived(getWeekDays(anchorDate));
  const tzCount = $derived(Math.max(1, timezones.length));
  const gridCols = $derived(
    `repeat(${tzCount}, ${GUTTER_WIDTH_PER_TZ}px) repeat(7, 1fr)`,
  );

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
  let currentTimeMinute = $state(-1);
  let isScrolling = $state(false);
  let scrollDebounce: ReturnType<typeof setTimeout> | null = null;
  let wheelCooldown = false;
  let ready = $state(false);

  function handleHeaderWheel(e: WheelEvent) {
    e.preventDefault();
    if (!onWheelNavigate || wheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    wheelCooldown = true;
    onWheelNavigate(e.deltaY > 0 ? "forward" : "back");
    setTimeout(() => { wheelCooldown = false; }, 300);
  }

  function updateCurrentTime() {
    const now = new Date();
    currentTimeMinute = now.getHours() * 60 + now.getMinutes();
  }

  onMount(() => {
    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000);

    if (scrollContainer) {
      if (initialScrollMinute >= 0) {
        scrollContainer.scrollTop = (initialScrollMinute / 60) * hourHeight;
      } else {
        const now = new Date();
        const targetHour = Math.max(0, now.getHours() - 2);
        scrollContainer.scrollTop = targetHour * hourHeight;
      }

      scrollContainer.addEventListener("scroll", handleScroll);
      ready = true;
    }

    return () => {
      clearInterval(interval);
      scrollContainer?.removeEventListener("scroll", handleScroll);
    };
  });

  function handleScroll() {
    if (!scrollContainer) return;

    isScrolling = true;
    if (scrollDebounce) clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(() => { isScrolling = false; }, 150);

    if (onScrollChange) {
      const minute = (scrollContainer.scrollTop / hourHeight) * 60;
      onScrollChange(Math.round(minute));
    }
  }

  // Column date resolution for cross-column move drag
  function getColumnDate(clientX: number): string {
    const gridEl = scrollContainer?.querySelector(".week-grid");
    const cols = gridEl?.querySelectorAll(".day-col");
    if (!cols?.length) return formatDatePart(weekDays[0]);

    for (let i = 0; i < cols.length; i++) {
      const rect = cols[i].getBoundingClientRect();
      if (clientX >= rect.left && clientX < rect.right) {
        return formatDatePart(weekDays[i]);
      }
    }
    // Fallback: closest edge
    const firstRect = cols[0].getBoundingClientRect();
    if (clientX < firstRect.left) return formatDatePart(weekDays[0]);
    return formatDatePart(weekDays[6]);
  }

  const drag = useDragController({
    events: () => events,
    hourHeight: () => hourHeight,
    getColumnDate,
    onEventUpdate: (e) => onEventUpdate(e),
    onEventCreate: (s, e) => onEventCreate(s, e),
  });
</script>

<div
  bind:this={scrollContainer}
  class="h-full overflow-y-auto overflow-x-hidden"
  style="background-color: var(--cal-bg); visibility: {ready ? 'visible' : 'hidden'};"
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
      "
    >
      <TimezoneSelector
        {timezones}
        tzCount={tzCount}
        onAdd={(tz) => onAddTimezone?.(tz)}
        onRemove={(i) => onRemoveTimezone?.(i)}
      />

      <div
        class="grid"
        style="grid-column: span 7; grid-template-columns: subgrid;"
      >
        {#each weekDays as day, i}
          {@const past = isPastDay(day)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            bind:this={headerCells[i]}
            class="flex cursor-pointer items-center justify-center hover:bg-accent/50"
            onclick={() => onDayHeaderClick?.(day)}
            role="button"
            tabindex="-1"
          >
            <span class="text-[13px]" style="color: {past ? 'var(--muted-foreground)' : 'var(--foreground)'};">
              {#if dayFormat !== "none"}{formatDayName(day, dayFormat)}&nbsp;{/if}{day.getDate()}
            </span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Body: one cell per timezone + 7 day columns -->
    <TimeGutter {hourHeight} {timezones} {anchorDate} tzCount={tzCount} />

    <div
      class="grid"
      style="grid-column: span 7; grid-template-columns: subgrid;"
    >
      {#each weekDays as day}
        {@const dateStr = formatDatePart(day)}
        <div class="day-col min-w-0" style="border-left: 1px solid var(--cal-gridline);">
          <DayColumn
            date={day}
            {events}
            {hourHeight}
            isToday={isToday(day)}
            isPast={isPastDay(day)}
            {isDark}
            {currentTimeMinute}
            dragPreview={drag.getDragPreviewForDate(dateStr)}
            createPreview={drag.getCreatePreviewForDate(dateStr, pendingCreatePreview)}
            {isScrolling}
            hideSnapLine={drag.getHideSnapLine(dateStr)}
            snapOverrideMinute={drag.getSnapOverrideMinute(dateStr)}
            onEventClick={onEventClick}
            onDragStart={drag.handleDragStart}
            onCreateStart={drag.handleCreateStart}
          />
        </div>
      {/each}
    </div>
  </div>
</div>
