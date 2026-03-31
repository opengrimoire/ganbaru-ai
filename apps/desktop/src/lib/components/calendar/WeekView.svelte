<script lang="ts">
  import type { CalendarEvent } from "./types";
  import type { DayNameFormat } from "./utils";
  import {
    getWeekDays,
    formatDayName,
    formatDatePart,
    layoutAllDayEventsForWeek,
    getEventColor,
    GUTTER_WIDTH_PER_TZ,
    createSmoothScroll,
  } from "./utils";
  import TimeGutter from "./TimeGutter.svelte";
  import DayColumn from "./DayColumn.svelte";
  import TimezoneSelector from "./TimezoneSelector.svelte";
  import CalendarScrollbar from "./CalendarScrollbar.svelte";
  import AllDayEventChip from "./AllDayEventChip.svelte";
  import { useDragController } from "./useDragController.svelte";
  import { useAllDayDragController } from "./useAllDayDragController.svelte";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import { onMount } from "svelte";

  let {
    anchorDate,
    events,
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
    isDark?: boolean;
    timezones?: string[];
    onEventClick: (event: CalendarEvent, rect?: DOMRect) => void;
    onEventUpdate: (event: CalendarEvent) => void;
    onEventCreate: (start: string, end: string, allDay?: boolean) => void;
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
  // Computed from grid: repeat(N, 22px) 6px + padding 2px*2
  const stickyAllDayHeight = $derived(allDayMaxRow > 0 ? Math.max(1, allDayMaxRow) * 22 + 10 : 0);
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
  let wheelCooldown = false;
  let ready = $state(false);

  // stickyAllDayHeight is tracked via bind:clientHeight on the always-visible all-day banner
  const calZoom = getCalendarZoom();
  const smoothScroll = createSmoothScroll(() => scrollContainer);

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey) {
      e.preventDefault();
      if (!calZoom.isAnimating && scrollContainer) {
        smoothScroll.cancel();
        const rect = scrollContainer.getBoundingClientRect();
        calZoom.zoomAt(e.deltaY, e.clientY - rect.top, gutterTopHeight, scrollContainer);
      }
      return;
    }
    smoothScroll(e);
  }

  function handleHeaderWheel(e: WheelEvent) {
    if (e.ctrlKey) {
      e.preventDefault();
      if (!calZoom.isAnimating && scrollContainer) {
        smoothScroll.cancel();
        const rect = scrollContainer.getBoundingClientRect();
        calZoom.zoomAt(e.deltaY, e.clientY - rect.top, gutterTopHeight, scrollContainer);
      }
      return;
    }
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

  // Sync --hour-h CSS property via setProperty so Svelte's template never
  // owns it. This prevents re-renders (from scroll events, etc.) from
  // overwriting the imperative value set during zoom.
  $effect(() => {
    scrollContainer?.style.setProperty("--hour-h", String(calZoom.hourHeight));
  });

  onMount(() => {
    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 1000);

    // Immediately refresh time on wake from sleep / tab re-focus
    function onVisibilityChange() {
      if (!document.hidden) updateCurrentTime();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    if (scrollContainer) {
      // Set --hour-h before any scroll/layout so the initial paint is correct
      scrollContainer.style.setProperty("--hour-h", String(calZoom.hourHeight));

      const hh = calZoom.hourHeight;
      if (initialScrollMinute >= 0) {
        scrollContainer.scrollTop = (initialScrollMinute / 60) * hh;
      } else {
        const now = new Date();
        const targetHour = Math.max(0, now.getHours() - 2);
        scrollContainer.scrollTop = targetHour * hh;
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
    if (!scrollContainer || !onScrollChange || calZoom.isAnimating) return;
    const minute = (scrollContainer.scrollTop / calZoom.hourHeight) * 60;
    onScrollChange(Math.round(minute));
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
    hourHeight: () => calZoom.hourHeight,
    getColumnDate,
    onEventUpdate: (e) => onEventUpdate(e),
    onEventCreate: (s, e) => onEventCreate(s, e),
    canDrag: (id) => !previewedIds || !previewedIds.has(id) || id === editingId,
  });

  // All-day column bounds from header cells
  let allDayGridEl: HTMLDivElement | undefined = $state();

  function getAllDayColumnBounds(): DOMRect[] {
    if (!allDayGridEl) return [];
    const cells = allDayGridEl.querySelectorAll<HTMLElement>(".allday-col-target");
    return Array.from(cells, (c) => c.getBoundingClientRect());
  }

  const allDayDrag = useAllDayDragController({
    events: () => events,
    weekDays: () => weekDays,
    getColumnBounds: getAllDayColumnBounds,
    getPositionedEvents: () => allDayPositioned,
    onEventUpdate: (e) => onEventUpdate(e),
    canDrag: (id) => !previewedIds || !previewedIds.has(id) || id === editingId,
  });

  const allDayEffectiveRows = $derived.by(() => {
    const base = Math.max(1, allDayMaxRow);
    const dp = allDayDrag.allDayDragPreview;
    if (!dp) return base;
    return Math.max(base, dp.row + 1);
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
        class="sticky top-0 z-[48] grid {allDayMaxRow === 0 ? 'border-b border-[var(--cal-gridline)]' : ''}"
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
              class="relative flex flex-col"
            >
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                class="flex flex-1 cursor-pointer items-center justify-center hover:bg-accent/50"
                onclick={() => onDayHeaderClick?.(day)}
                role="button"
                tabindex="-1"
              >
                <span class="text-[13px]" style="color: {past ? 'var(--muted-foreground)' : 'var(--foreground)'};">
                  {#if dayFormat !== "none"}{formatDayName(day, dayFormat)}&nbsp;{/if}{day.getDate()}
                </span>
              </div>
              {#if allDayMaxRow === 0}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  class="absolute inset-x-0 bottom-0 cursor-pointer transition-colors hover:bg-foreground/10"
                  style="height: 6px;"
                  onclick={(e) => {
                    e.stopPropagation();
                    const dateStr = formatDatePart(day);
                    onEventCreate(`${dateStr} 00:00`, `${dateStr} 00:00`, true);
                  }}
                ></div>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      {#if allDayMaxRow > 0}
      <!-- All-day banner -->
      <div
        class="sticky z-[49] grid border-b border-[var(--cal-gridline)]"
        onwheel={handleHeaderWheel}
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
          bind:this={allDayGridEl}
          class="relative grid"
          style="
            grid-column: span 7;
            grid-template-columns: subgrid;
            grid-template-rows: repeat({allDayEffectiveRows}, 22px) 6px;
            padding: 2px 0;
          "
        >
          <!-- Thin click-to-create strip + column measurement targets -->
          {#each weekDays as day, i}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="allday-col-target cursor-pointer"
              style="grid-column: {i + 1}; grid-row: 1 / -1; z-index: 0;"
              onclick={(e) => {
                e.stopPropagation();
                const dateStr = formatDatePart(day);
                onEventCreate(`${dateStr} 00:00`, `${dateStr} 00:00`, true);
              }}
            ></div>
          {/each}

          <!-- Positioned all-day events -->
          {#each allDayPositioned as pos (pos.event.id)}
            {@const endDateStr = pos.event.end.split(" ")[0]}
            {#if pos.event.id !== allDayDrag.draggingEventId}
              <div style="grid-column: {pos.startCol + 1} / span {pos.spanCols}; grid-row: {pos.row + 1}; z-index: 2; min-width: 0;">
                <AllDayEventChip
                  event={pos.event}
                  {isDark}
                  editing={editingId === pos.event.id}
                  preview={previewedIds?.has(pos.event.id) ?? false}
                  isPast={endDateStr < todayStr}
                  onclick={(rect) => { if (!allDayDrag.didDrag) onEventClick(pos.event, rect); }}
                  onpointerdown={(e) => allDayDrag.handleDragStart(pos.event.id, e)}
                />
              </div>
            {/if}
          {/each}

          <!-- Drag preview -->
          {#if allDayDrag.allDayDragPreview}
            {@const dp = allDayDrag.allDayDragPreview}
            {@const dpColor = getEventColor(dp.event.color, isDark)}
            <div
              class="allday-drag-preview pointer-events-none select-none truncate rounded px-1.5 text-[10px] leading-[20px]"
              style="
                grid-column: {dp.startCol + 1} / span {dp.spanCols};
                grid-row: {dp.row + 1};
                z-index: 10;
                min-width: 0;
                background-color: {dpColor.bg};
                color: {dpColor.text};
                opacity: 0.8;
                margin: 1px 0;
              "
            >
              {#if dp.event.title}{dp.event.title}{:else}<span class="opacity-50">(No title)</span>{/if}
            </div>
          {/if}

        </div>
      </div>
      {/if}

      <!-- Body: one cell per timezone + 7 day columns -->
      <TimeGutter {timezones} {anchorDate} tzCount={tzCount} />

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
              isToday={formatDatePart(day) === todayStr}
              isPast={formatDatePart(day) < todayStr}
              {isDark}
              {currentTimeMinute}
              {editingId}
              {previewedIds}
              draggingEventId={drag.dragPreview ? drag.dragState?.eventId : undefined}
              dragPreview={drag.getDragPreviewForDate(dateStr)}
              createPreview={drag.getCreatePreviewForDate(dateStr)}
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
</div>

<style>
  .allday-drag-preview {
    position: relative;
  }

  .allday-drag-preview::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 1.5px solid currentColor;
    border-radius: inherit;
    pointer-events: none;
    z-index: 3;
  }
</style>
