<script lang="ts">
  import type { CalendarEvent } from "./types";
  import type { DayNameFormat } from "./utils";
  import {
    formatDatePart,
    formatDayName,
    allDayEventsForDay,
    parseCalendarDate,
    GUTTER_WIDTH_PER_TZ,
    createSmoothScroll,
  } from "./utils";
  import TimeGutter from "./TimeGutter.svelte";
  import DayColumn from "./DayColumn.svelte";
  import TimezoneSelector from "./TimezoneSelector.svelte";
  import CalendarScrollbar from "./CalendarScrollbar.svelte";
  import AllDayEventChip from "./AllDayEventChip.svelte";
  import { useDragController } from "./useDragController.svelte";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
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
    onDayHeaderClick?: () => void;
  } = $props();

  let scrollContainer: HTMLDivElement | undefined = $state();
  let wheelCooldown = false;
  let ready = $state(false);
  let stickyHeaderHeight = $state(0);
  const calZoom = getCalendarZoom();
  const smoothScroll = createSmoothScroll(() => scrollContainer);

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey) {
      e.preventDefault();
      if (scrollContainer) {
        smoothScroll.cancel();
        calZoom.zoomAt(e.deltaY, gutterTopHeight, scrollContainer);
      }
      return;
    }
    smoothScroll(e);
  }

  function blockWheel(node: HTMLElement) {
    const handler = (e: WheelEvent) => { e.preventDefault(); e.stopPropagation(); };
    node.addEventListener("wheel", handler, { passive: false });
    return { destroy() { node.removeEventListener("wheel", handler); } };
  }

  function handleHeaderWheel(e: WheelEvent) {
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    smoothScroll.cancel();
    e.preventDefault();
    e.stopPropagation();
    if (!onWheelNavigate || wheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    wheelCooldown = true;
    onWheelNavigate(e.deltaY > 0 ? "forward" : "back");
    setTimeout(() => { wheelCooldown = false; }, 300);
  }

  let currentTimeMinute = $state(-1);
  let todayStr = $state(formatDatePart(new Date()));

  const ALL_DAY_ROW_H = 21;
  const ALL_DAY_GAP = 1;
  const ALL_DAY_MAX_VISIBLE = 2;

  const today = $derived(formatDatePart(anchorDate) === todayStr);
  const past = $derived(formatDatePart(anchorDate) < todayStr);
  const dateStr = $derived(formatDatePart(anchorDate));
  const allDayEvents = $derived(allDayEventsForDay(events, anchorDate));

  let allDayExpanded = $state(false);
  const allDayCollapsible = $derived(allDayEvents.length > ALL_DAY_MAX_VISIBLE);
  const allDayVisibleCount = $derived(allDayExpanded || !allDayCollapsible ? allDayEvents.length : ALL_DAY_MAX_VISIBLE);
  const allDayDisplayRows = $derived(allDayCollapsible && !allDayExpanded ? allDayVisibleCount + 1 : allDayVisibleCount);

  // Reset expanded state on day change
  $effect(() => { void anchorDate; allDayExpanded = false; });

  let stickyAllDayBannerHeight = $state(0);
  $effect(() => { if (allDayEvents.length === 0) stickyAllDayBannerHeight = 0; });
  const gutterTopHeight = $derived(stickyHeaderHeight + stickyAllDayBannerHeight);
  const timedEvents = $derived(events.filter((e) => !e.allDay));
  const tzCount = $derived(Math.max(1, timezones.length));
  const gridCols = $derived(
    `repeat(${tzCount}, ${GUTTER_WIDTH_PER_TZ}px) 1fr`,
  );

  let headerCell: HTMLElement | undefined = $state();
  let dayFormat: DayNameFormat = $state("long");

  $effect(() => {
    const el = headerCell;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0].contentBoxSize[0].inlineSize;
      if (w >= 200) dayFormat = "long";
      else if (w >= 100) dayFormat = "short";
      else if (w >= 60) dayFormat = "narrow";
      else dayFormat = "none";
    });
    observer.observe(el);
    return () => observer.disconnect();
  });


  const dayLabel = $derived.by(() => {
    const name = formatDayName(anchorDate, dayFormat);
    const monthStr = anchorDate.toLocaleDateString("en-US", { month: dayFormat === "long" ? "long" : "short" });
    return name ? `${name}, ${monthStr} ${anchorDate.getDate()}` : `${monthStr} ${anchorDate.getDate()}`;
  });

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
      scrollContainer.addEventListener("cancel-smooth-scroll", () => smoothScroll.cancel());
      ready = true;
    }

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      scrollContainer?.removeEventListener("scroll", handleScroll);
    };
  });

  // Sync --hour-h when hourHeight changes outside of a zoom gesture
  // (e.g. button-driven zoom). Also adjusts scrollTop to keep the
  // center time stable. Skipped during gestures because the store
  // manages --hour-h imperatively via applyZoom/commitZoom.
  $effect(() => {
    const newH = calZoom.hourHeight;
    if (!scrollContainer || calZoom.isAnimating) return;

    const oldHStr = scrollContainer.style.getPropertyValue("--hour-h");
    const oldH = oldHStr ? parseFloat(oldHStr) : newH;

    if (oldH !== newH && oldH > 0) {
      // Compute center time at old zoom level
      const viewportH = scrollContainer.clientHeight;
      const centerOffset = (viewportH - gutterTopHeight) / 2;
      const centerMinute = (scrollContainer.scrollTop + centerOffset) / oldH * 60;

      // Apply new zoom
      scrollContainer.style.setProperty("--hour-h", String(newH));

      // Adjust scrollTop to keep the same center time visible
      const newScrollTop = (centerMinute / 60) * newH - centerOffset;
      scrollContainer.scrollTop = Math.max(0, newScrollTop);
    } else {
      scrollContainer.style.setProperty("--hour-h", String(newH));
    }
  });

  function handleScroll() {
    if (!scrollContainer || !onScrollChange || calZoom.isAnimating) return;
    const minute = (scrollContainer.scrollTop / calZoom.hourHeight) * 60;
    onScrollChange(Math.round(minute));
  }

  const pomodoroStore = getPomodoro();

  const drag = useDragController({
    events: () => events,
    hourHeight: () => calZoom.hourHeight,
    getColumnDate: () => dateStr,
    getScrollContainer: () => scrollContainer ?? null,
    onEventUpdate: (e) => onEventUpdate(e),
    onEventCreate: (s, e) => onEventCreate(s, e),
    canDrag: (id) => !previewedIds || !previewedIds.has(id) || id === editingId,
    activeBlockId: () => pomodoroStore.activeBlockId,
    isEventLocked: (id) => {
      const ev = events.find((e) => e.id === id);
      if (!ev || !ev.pomodoroConfig) return false;
      if (id === pomodoroStore.activeBlockId) return false;
      return parseCalendarDate(ev.end).getTime() < Date.now();
    },
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex h-full flex-col" style="visibility: {ready ? 'visible' : 'hidden'};">
<div class="relative min-h-0 flex-1" style="background-color: var(--cal-header-bg);">
  <div
    bind:this={scrollContainer}
    onwheel={onWheel}
    class="hide-scrollbar absolute inset-0 overflow-y-auto overflow-x-hidden"
    style="background-color: var(--cal-bg);"
  >
    <div class="grid" style="grid-template-columns: {gridCols};">
      <!-- Sticky header row -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:offsetHeight={stickyHeaderHeight}
        class="sticky top-0 z-[48] grid {allDayEvents.length === 0 ? 'border-b border-[var(--sidebar)]' : ''}"
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
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          bind:this={headerCell}
          class="relative flex flex-col"
        >
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="flex flex-1 cursor-pointer items-center px-4 hover:bg-accent/50"
            onclick={() => onDayHeaderClick?.()}
            role="button"
            tabindex="-1"
          >
            <span class="text-[13px]" style="color: {past ? 'var(--muted-foreground)' : 'var(--foreground)'};">
              {dayLabel}
            </span>
          </div>
          {#if allDayEvents.length === 0}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="absolute inset-x-0 bottom-0 cursor-pointer transition-colors hover:bg-foreground/10"
              style="height: 6px;"
              onclick={(e) => {
                e.stopPropagation();
                onEventCreate(`${dateStr} 00:00`, `${dateStr} 00:00`, true);
              }}
            ></div>
          {/if}
        </div>
      </div>

      {#if allDayEvents.length > 0}
      <!-- All-day banner -->
      <div
        bind:offsetHeight={stickyAllDayBannerHeight}
        class="sticky z-[49] grid border-b border-[var(--sidebar)]"
        use:blockWheel
        style="
          top: var(--cal-header-row-h);
          grid-column: 1 / -1;
          grid-template-columns: subgrid;
          background-color: var(--cal-header-bg);
        "
      >
        <div style="grid-column: span {tzCount};"></div>
        <div class="flex min-w-0 flex-col px-1" style="padding-top: 2px; padding-bottom: 2px; gap: {ALL_DAY_GAP}px;">
          {#each allDayEvents.slice(0, allDayVisibleCount) as evt (evt.id)}
            <AllDayEventChip
              event={evt}
              {isDark}
              editing={editingId === evt.id}
              preview={previewedIds?.has(evt.id) ?? false}
              isPast={past}
              onclick={(rect) => onEventClick(evt, rect)}
            />
          {/each}
          {#if allDayCollapsible && !allDayExpanded}
            <button
              class="flex items-center px-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              style="height: {ALL_DAY_ROW_H}px;"
              onclick={(e) => { e.stopPropagation(); allDayExpanded = true; }}
            >
              +{allDayEvents.length - ALL_DAY_MAX_VISIBLE} more
            </button>
          {/if}
          <!-- Thin click-to-create strip -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="cursor-pointer transition-colors hover:bg-accent/50"
            style="height: 6px;"
            onclick={(e) => {
              e.stopPropagation();
              onEventCreate(`${dateStr} 00:00`, `${dateStr} 00:00`, true);
            }}
          ></div>
        </div>
      </div>
      {/if}

      <!-- Body row -->
      <div
        data-zoom-body
        class="grid"
        style="grid-column: 1 / -1; grid-template-columns: subgrid; {calZoom.isAnimating ? 'pointer-events: none;' : ''}"
      >
      <TimeGutter {timezones} {anchorDate} {tzCount} />
      <div class="min-w-0" style="border-left: 1px solid var(--cal-gridline);">
        <DayColumn
          date={anchorDate}
          events={timedEvents}
          isToday={today}
          isPast={past}
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
      </div>
    </div>
  </div>
  <CalendarScrollbar {scrollContainer} stickyTop={gutterTopHeight} />
</div>
</div>
