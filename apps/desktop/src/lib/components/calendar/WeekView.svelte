<script lang="ts">
  import type { CalendarEvent } from "./types";
  import type { DayNameFormat } from "./utils";
  import {
    getWeekDays,
    formatDayName,
    formatDatePart,
    getEventColor,
    allDayEventsForWeek,
    layoutAllDayEventsForWeek,
    GUTTER_WIDTH_PER_TZ,
    createSmoothScroll,
  } from "./utils";
  import TimeGutter from "./TimeGutter.svelte";
  import DayColumn from "./DayColumn.svelte";
  import TimezoneSelector from "./TimezoneSelector.svelte";
  import CalendarScrollbar from "./CalendarScrollbar.svelte";
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
    editingId,
    previewedIds,
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
    editingId?: string;
    previewedIds?: Set<string>;
    initialScrollMinute?: number;
    onScrollChange?: (minute: number) => void;
    onAddTimezone?: (tz: string) => void;
    onRemoveTimezone?: (index: number) => void;
    onWheelNavigate?: (direction: "back" | "forward") => void;
    onDayHeaderClick?: (date: Date) => void;
  } = $props();

  const weekDays = $derived(getWeekDays(anchorDate));
  const allDayPositioned = $derived(layoutAllDayEventsForWeek(events, weekDays));
  const allDayMaxRow = $derived(allDayPositioned.length > 0 ? Math.max(...allDayPositioned.map((p) => p.row)) + 1 : 0);
  const timedEvents = $derived(events.filter((e) => !e.allDay));
  const tzCount = $derived(Math.max(1, timezones.length));
  const gridCols = $derived(
    `repeat(${tzCount}, ${GUTTER_WIDTH_PER_TZ}px) repeat(7, 1fr)`,
  );

  let headerCells: HTMLElement[] = $state([]);
  let dayFormat: DayNameFormat = $state("short");
  let stickyHeaderHeight = $state(0);
  let stickyAllDayHeight = $state(0);
  const gutterTopHeight = $derived(stickyHeaderHeight + stickyAllDayHeight);

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
  let todayStr = $state(formatDatePart(new Date()));
  let isScrolling = $state(false);
  let scrollDebounce: ReturnType<typeof setTimeout> | null = null;
  let wheelCooldown = false;
  let ready = $state(false);

  $effect(() => { if (allDayMaxRow === 0) stickyAllDayHeight = 0; });
  const onWheel = createSmoothScroll(() => scrollContainer);

  function handleHeaderWheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!onWheelNavigate || wheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    wheelCooldown = true;
    onWheelNavigate(e.deltaY > 0 ? "forward" : "back");
    setTimeout(() => { wheelCooldown = false; }, 300);
  }

  function updateCurrentTime() {
    const now = new Date();
    currentTimeMinute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const nowStr = formatDatePart(now);
    if (nowStr !== todayStr) todayStr = nowStr;
  }

  onMount(() => {
    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 1000);

    // Immediately refresh time on wake from sleep / tab re-focus
    function onVisibilityChange() {
      if (!document.hidden) updateCurrentTime();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

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
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
    canDrag: (id) => !previewedIds || !previewedIds.has(id) || id === editingId,
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex h-full flex-col" style="visibility: {ready ? 'visible' : 'hidden'};">
<div class="flex min-h-0 flex-1">
  <div
    bind:this={scrollContainer}
    onwheel={onWheel}
    class="hide-scrollbar min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
    style="background-color: var(--cal-bg);"
  >
    <div
      class="week-grid grid"
      style="grid-template-columns: {gridCols};"
    >
      <!-- Sticky header row -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:clientHeight={stickyHeaderHeight}
        class="sticky top-0 z-[48] grid"
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
            {@const past = formatDatePart(day) < todayStr}
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

      <!-- All-day banner -->
      {#if allDayMaxRow > 0}
        <div
          bind:clientHeight={stickyAllDayHeight}
          class="sticky z-[47] grid border-b border-[var(--cal-gridline)]"
          style="
            top: var(--cal-header-row-h);
            grid-column: 1 / -1;
            grid-template-columns: subgrid;
            background-color: var(--cal-header-bg);
          "
        >
          <!-- Gutter spacer -->
          <div style="grid-column: span {tzCount};"></div>
          <!-- Event grid -->
          <div
            class="relative grid"
            style="
              grid-column: span 7;
              grid-template-columns: subgrid;
              grid-template-rows: repeat({allDayMaxRow}, 22px);
              padding: 2px 0;
            "
          >
            {#each allDayPositioned as pos}
              {@const colors = getEventColor(pos.event.color, isDark)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="mx-0.5 cursor-pointer truncate rounded px-1.5 text-[10px] leading-[20px]"
                style="
                  grid-column: {pos.startCol + 1} / span {pos.spanCols};
                  grid-row: {pos.row + 1};
                  background-color: {colors.bg};
                  color: {colors.text};
                "
                onclick={(e) => { e.stopPropagation(); onEventClick(pos.event, (e.currentTarget as HTMLElement).getBoundingClientRect()); }}
              >
                {pos.event.title}
              </div>
            {/each}
          </div>
        </div>
      {/if}

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
              events={timedEvents}
              {hourHeight}
              isToday={formatDatePart(day) === todayStr}
              isPast={formatDatePart(day) < todayStr}
              {isDark}
              {currentTimeMinute}
              {editingId}
              {previewedIds}
              draggingEventId={drag.dragPreview ? drag.dragState?.eventId : undefined}
              dragPreview={drag.getDragPreviewForDate(dateStr)}
              createPreview={drag.getCreatePreviewForDate(dateStr)}
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

  <!-- Custom scrollbar gutter -->
  <div class="flex flex-col" style="width: 12px;">
    <div style="height: {gutterTopHeight}px; background-color: var(--cal-header-bg);"></div>
    <div class="relative flex-1" style="background-color: var(--background);">
      <CalendarScrollbar {scrollContainer} />
    </div>
  </div>
</div>
<!-- Bottom bar -->
<div style="height: 12px; background-color: var(--background);"></div>
</div>
