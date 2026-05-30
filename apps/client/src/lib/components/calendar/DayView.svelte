<script lang="ts">
  import type { CalendarEvent, PersistedSegment } from "./types";
  import type { DayNameFormat, TimezoneAbbrMode } from "./utils";
  import {
    formatDatePart,
    formatDayName,
    allDayEventsForDay,
    GUTTER_WIDTH_PER_TZ,
    visibleMinuteRangeForScroll,
  } from "./utils";
  import { createTimelineWheelScroll } from "./timeline-scroll";
  import TimeGutter from "./TimeGutter.svelte";
  import DayColumn from "./DayColumn.svelte";
  import HourGridlines from "./HourGridlines.svelte";
  import TimezoneSelector from "./TimezoneSelector.svelte";
  import CalendarScrollbar from "./CalendarScrollbar.svelte";
  import AllDayEventChip from "./AllDayEventChip.svelte";
  import { useDragController } from "./useDragController.svelte";
  import { eventMatchesActiveOccurrence } from "./occurrence-protection";
  import { hasCalendarEventStarted } from "./event-edit-permissions";
  import type { PanelAnchor } from "./edit-session.svelte";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { onMount } from "svelte";
  import type { Theme } from "$lib/stores/themes";

  let {
    anchorDate,
    events,
    eventsByDay,
    theme,
    timezones = [] as string[],
    tzAbbrMode = "acronym" as TimezoneAbbrMode,
    onEventClick,
    onEventPrefetch,
    onEventUpdate,
    onEventCreate,
    editingId,
    previewedIds,
    persistedSegmentsByEvent = new Map<string, PersistedSegment[]>(),
    initialScrollMinute = -1,
    onScrollChange,
    onAddTimezone,
    onRemoveTimezone,
    onReorderTimezone,
    onTzAbbrModeChange,
    onWheelNavigate,
    onDayHeaderClick,
  }: {
    anchorDate: Date;
    events: CalendarEvent[];
    eventsByDay: Map<string, CalendarEvent[]>;
    theme: Theme;
    timezones?: string[];
    tzAbbrMode?: TimezoneAbbrMode;
    onEventClick: (event: CalendarEvent, rect?: DOMRect) => void;
    onEventPrefetch?: (event: CalendarEvent) => void;
    onEventUpdate: (event: CalendarEvent) => void;
    onEventCreate: (start: string, end: string, allDay?: boolean, anchor?: PanelAnchor) => void;
    editingId?: string;
    previewedIds?: Set<string>;
    persistedSegmentsByEvent?: ReadonlyMap<string, PersistedSegment[]>;
    initialScrollMinute?: number;
    onScrollChange?: (minute: number) => void;
    onAddTimezone?: (tz: string) => void;
    onRemoveTimezone?: (index: number) => void;
    onReorderTimezone?: (from: number, to: number) => void;
    onTzAbbrModeChange?: (mode: TimezoneAbbrMode) => void;
    onWheelNavigate?: (direction: "back" | "forward") => void;
    onDayHeaderClick?: () => void;
  } = $props();

  /** Stable empty fallback so the day column keeps a consistent prop reference. */
  const EMPTY_DAY: CalendarEvent[] = [];

  let scrollContainer: HTMLDivElement | undefined = $state();
  let wheelCooldown = false;
  let ready = $state(false);
  let stickyHeaderHeight = $state(0);
  let visibleStartMinute = $state(0);
  let visibleEndMinute = $state(1440);
  const calZoom = getCalendarZoom();
  const timelineWheelScroll = createTimelineWheelScroll(() => scrollContainer);

  function renderedHourHeight(): number {
    const raw = scrollContainer?.style.getPropertyValue("--hour-h") ?? "";
    const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : calZoom.hourHeight;
  }

  function updateVisibleMinuteRange() {
    if (!scrollContainer) return;
    const range = visibleMinuteRangeForScroll({
      scrollTop: scrollContainer.scrollTop,
      viewportHeight: scrollContainer.clientHeight,
      stickyTop: allDayOverlayHeight,
      hourHeight: renderedHourHeight(),
    });
    visibleStartMinute = range.startMinute;
    visibleEndMinute = range.endMinute;
  }

  function scrollTopForMinute(minute: number, hourHeight: number): number {
    if (minute <= 0) return 0;
    return allDayOverlayHeight + (minute / 60) * hourHeight;
  }

  function scrollMinuteFromTop(scrollTop: number, hourHeight: number): number {
    return (Math.max(0, scrollTop - allDayOverlayHeight) / hourHeight) * 60;
  }

  function scrollTimelineByWheel(e: WheelEvent) {
    if (!scrollContainer) return;
    e.preventDefault();
    e.stopPropagation();
    timelineWheelScroll(e);
  }

  function handleHeaderWheel(e: WheelEvent) {
    if (e.ctrlKey || e.shiftKey) {
      scrollTimelineByWheel(e);
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

  let currentTimeMinute = $state(-1);
  let todayStr = $state(formatDatePart(new Date()));

  const ALL_DAY_ROW_H = 21;
  const ALL_DAY_GAP = 1;
  const ALL_DAY_PAD = 2;
  const ALL_DAY_MAX_VISIBLE = 2;

  const today = $derived(formatDatePart(anchorDate) === todayStr);
  const past = $derived(formatDatePart(anchorDate) < todayStr);
  const dateStr = $derived(formatDatePart(anchorDate));
  const dayBucket = $derived(eventsByDay.get(dateStr) ?? EMPTY_DAY);
  const allDayEvents = $derived(allDayEventsForDay(dayBucket, anchorDate));

  let allDayExpanded = $state(false);
  const allDayCollapsible = $derived(allDayEvents.length > ALL_DAY_MAX_VISIBLE);
  const allDayVisibleCount = $derived(allDayExpanded || !allDayCollapsible ? allDayEvents.length : ALL_DAY_MAX_VISIBLE);
  const allDayDisplayRows = $derived(allDayCollapsible && !allDayExpanded ? allDayVisibleCount + 1 : allDayVisibleCount);

  // Reset expanded state on day change
  $effect(() => { void anchorDate; allDayExpanded = false; });

  let allDayOverlayHeight = $state(0);
  $effect(() => { if (allDayEvents.length === 0) allDayOverlayHeight = 0; });
  const gutterTopHeight = $derived(stickyHeaderHeight);
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

  const SCROLL_SETTLE_MS = 150;
  let lastScrollAt = 0;

  function updateCurrentTime() {
    if (calZoom.isAnimating) return;
    if (performance.now() - lastScrollAt < SCROLL_SETTLE_MS) return;
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

      // Register scroll container so buttons/keyboard can animate
      calZoom.registerScrollContainer(scrollContainer, 0);

      const hh = calZoom.hourHeight;
      if (initialScrollMinute >= 0) {
        scrollContainer.scrollTop = scrollTopForMinute(initialScrollMinute, hh);
      } else {
        const now = new Date();
        const targetHour = Math.max(0, now.getHours() - 2);
        scrollContainer.scrollTop = scrollTopForMinute(targetHour * 60, hh);
      }

      scrollContainer.addEventListener("scroll", handleScroll);
      updateVisibleMinuteRange();
      ready = true;
    }

    // Keyboard shortcuts: Shift + +/- and Shift + 0 for internal calendar zoom.
    // The physical key that produces "+" varies by keyboard layout:
    //   - US/French: "Equal" key (Shift + = produces +)
    //   - Spanish/German: "BracketRight" key (where + is printed)
    //   - Nordic: "Minus" key (+ is the base character)
    // Since the Keyboard API may not be available in all WebViews (e.g., Tauri),
    // we check all known physical key codes where + is commonly located.
    const PLUS_KEY_CODES = ["Equal", "BracketRight", "NumpadAdd"];
    const RESET_KEY_CODES = ["Digit0", "Numpad0"];

    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey) return; // Reserved for app-level zoom
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

      const resetZoom = e.shiftKey && (e.key === "0" || RESET_KEY_CODES.includes(e.code));
      const zoomIn = e.key === "+" || (e.shiftKey && PLUS_KEY_CODES.includes(e.code));

      if (resetZoom) {
        e.preventDefault();
        calZoom.reset();
      } else if (zoomIn) {
        e.preventDefault();
        calZoom.zoomStep(1);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        calZoom.zoomStep(-1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("keydown", handleKeyDown);
      scrollContainer?.removeEventListener("scroll", handleScroll);
      timelineWheelScroll.cancel();
    };
  });

  // Sync --hour-h when hourHeight changes outside of a zoom animation
  // (e.g. button-driven zoom). Also adjusts scrollTop to keep the
  // center time stable. Skipped during animations because the store
  // manages --hour-h imperatively until commit.
  $effect(() => {
    const newH = calZoom.hourHeight;
    if (!scrollContainer || calZoom.isAnimating) return;

    const oldHStr = scrollContainer.style.getPropertyValue("--hour-h");
    const oldH = oldHStr ? parseFloat(oldHStr) : newH;

    if (oldH !== newH && oldH > 0) {
      // Compute center time at old zoom level
      const viewportH = scrollContainer.clientHeight;
      const centerOffset = viewportH / 2;
      const centerMinute = scrollMinuteFromTop(scrollContainer.scrollTop + centerOffset, oldH);

      // Apply new zoom
      scrollContainer.style.setProperty("--hour-h", String(newH));

      // Adjust scrollTop to keep the same center time visible
      const newScrollTop = scrollTopForMinute(centerMinute, newH) - centerOffset;
      scrollContainer.scrollTop = Math.max(0, newScrollTop);
    } else {
      scrollContainer.style.setProperty("--hour-h", String(newH));
    }
    updateVisibleMinuteRange();
  });

  let previousAllDayOverlayHeight = 0;
  $effect(() => {
    const nextAllDayOverlayHeight = allDayOverlayHeight;
    if (scrollContainer && previousAllDayOverlayHeight !== nextAllDayOverlayHeight) {
      const delta = nextAllDayOverlayHeight - previousAllDayOverlayHeight;
      if (scrollContainer.scrollTop > 0) {
        scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop + delta);
      }
    }
    previousAllDayOverlayHeight = nextAllDayOverlayHeight;
    void gutterTopHeight;
    updateVisibleMinuteRange();
  });

  function handleScroll() {
    lastScrollAt = performance.now();
    updateVisibleMinuteRange();
    if (!scrollContainer || !onScrollChange || calZoom.isAnimating) return;
    const minute = scrollMinuteFromTop(scrollContainer.scrollTop, calZoom.hourHeight);
    onScrollChange(Math.round(minute));
  }

  const pomodoroStore = getPomodoro();

  function activePomodoroDate(): string | undefined {
    return pomodoroStore.segments.find((segment) => segment.status === "active")?.eventDate;
  }

  function isActiveCalendarEvent(event: CalendarEvent): boolean {
    return eventMatchesActiveOccurrence(event, {
      blockId: pomodoroStore.activeBlockId,
      eventDate: activePomodoroDate(),
    });
  }

  function isLockedCalendarEvent(id: string): boolean {
    const ev = events.find((event) => event.id === id);
    if (!ev) return false;
    if (isActiveCalendarEvent(ev)) return false;
    return hasCalendarEventStarted(ev);
  }

  const drag = useDragController({
    events: () => events,
    hourHeight: () => calZoom.hourHeight,
    getColumnDate: () => dateStr,
    getScrollContainer: () => scrollContainer ?? null,
    onEventUpdate: (e) => onEventUpdate(e),
    onEventCreate: (s, e, anchor) => onEventCreate(s, e, false, anchor),
    canDrag: (id) => editingId ? id === editingId : !previewedIds || !previewedIds.has(id),
    isActiveEvent: isActiveCalendarEvent,
    isEventLocked: isLockedCalendarEvent,
  });

  function allDayCreateAnchorFromHeader(target: HTMLElement): PanelAnchor {
    const rect = target.getBoundingClientRect();
    return {
      x: rect.right,
      y: rect.bottom + ALL_DAY_PAD,
      width: rect.width,
      height: ALL_DAY_ROW_H,
    };
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex h-full flex-col" style="visibility: {ready ? 'visible' : 'hidden'};">
<div class="relative min-h-0 flex-1" style="background-color: var(--cal-header-bg);">
  <div
    class="absolute left-0 right-0 top-0 z-40 grid"
    style="grid-template-columns: {gridCols}; background-color: var(--cal-header-bg);"
  >
    <!-- Header row -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      bind:offsetHeight={stickyHeaderHeight}
      class="grid {allDayEvents.length === 0 ? 'border-b border-sidebar' : ''}"
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
        abbrMode={tzAbbrMode}
        onAdd={(tz) => onAddTimezone?.(tz)}
        onRemove={(i) => onRemoveTimezone?.(i)}
        onReorder={(from, to) => onReorderTimezone?.(from, to)}
        onAbbrModeChange={(m) => onTzAbbrModeChange?.(m)}
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
          <span class="text-[0.866667rem]" style="color: {past ? 'var(--muted-foreground)' : 'var(--foreground)'};">
            {dayLabel}
          </span>
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="absolute inset-x-0 bottom-0 cursor-pointer transition-colors hover:bg-foreground/10"
          style="height: 6px;"
          onclick={(e) => {
            e.stopPropagation();
            onEventCreate(
              `${dateStr} 00:00`,
              `${dateStr} 00:00`,
              true,
              allDayCreateAnchorFromHeader(e.currentTarget as HTMLElement),
            );
          }}
        ></div>
      </div>
    </div>

    {#if allDayEvents.length > 0}
    <!-- All-day banner -->
    <div
      bind:offsetHeight={allDayOverlayHeight}
      class="grid border-b border-sidebar"
      onwheel={scrollTimelineByWheel}
      style="
        grid-column: 1 / -1;
        grid-template-columns: subgrid;
        background-color: var(--cal-header-bg);
      "
    >
      <div style="grid-column: span {tzCount};"></div>
      <div
        data-calendar-edit-close-zone
        class="flex min-w-0 flex-col px-1"
        style="padding-top: {ALL_DAY_PAD}px; padding-bottom: {ALL_DAY_PAD}px; gap: {ALL_DAY_GAP}px;"
      >
        {#each allDayEvents.slice(0, allDayVisibleCount) as evt (evt.id)}
          <AllDayEventChip
            event={evt}
            {theme}
            editing={editingId === evt.id}
            preview={previewedIds?.has(evt.id) ?? false}
            isPast={past}
            onclick={(rect) => onEventClick(evt, rect)}
            onprefetch={() => onEventPrefetch?.(evt)}
          />
        {/each}
        {#if allDayCollapsible && !allDayExpanded}
          <button
            class="flex items-center px-0.5 text-[0.666667rem] text-muted-foreground hover:text-foreground"
            style="height: {ALL_DAY_ROW_H}px;"
            onclick={(e) => { e.stopPropagation(); allDayExpanded = true; }}
          >
            +{allDayEvents.length - ALL_DAY_MAX_VISIBLE} more
          </button>
        {/if}
      </div>
    </div>
    {/if}
  </div>

  <div
    bind:this={scrollContainer}
    data-calendar-scroll-container
    onwheel={scrollTimelineByWheel}
    class="hide-scrollbar absolute inset-x-0 bottom-0 overflow-y-auto overflow-x-hidden"
    style="top: {gutterTopHeight}px; --hour-h: {calZoom.hourHeight}; background-color: var(--cal-bg);"
  >
    <div class="relative" style="height: calc({allDayOverlayHeight}px + 24 * var(--hour-h) * 1px);">
    <div
      class="absolute inset-x-0 top-0 grid"
      style="grid-template-columns: {gridCols}; transform: translateY({allDayOverlayHeight}px);"
    >
      <!-- Body row -->
      <div
        data-zoom-body
        class="grid"
        style="grid-column: 1 / -1; grid-template-columns: subgrid; {calZoom.isAnimating ? 'pointer-events: none;' : ''}"
      >
      <TimeGutter {timezones} {anchorDate} {tzCount} />
      <div
        data-day-column-shell
        data-calendar-edit-close-zone
        class="relative min-w-0"
        style="border-left: 1px solid var(--cal-gridline);"
      >
        <HourGridlines />
        <DayColumn
          date={anchorDate}
          events={dayBucket}
          {theme}
          isToday={today}
          isPast={past}
          {currentTimeMinute}
          {editingId}
          {previewedIds}
          {persistedSegmentsByEvent}
          draggingEventId={drag.dragPreview ? drag.dragState?.eventId : undefined}
          grabbingId={drag.grabbingId ?? undefined}
          didDrag={drag.didDrag}
          dragPreview={drag.getDragPreviewForDate(dateStr)}
          createPreview={drag.getCreatePreviewForDate(dateStr)}
          {visibleStartMinute}
          {visibleEndMinute}
          onEventClick={onEventClick}
          onEventPrefetch={onEventPrefetch}
          onDragStart={drag.handleDragStart}
          onCreateStart={drag.handleCreateStart}
          isActiveEvent={isActiveCalendarEvent}
          isEventLocked={isLockedCalendarEvent}
        />
      </div>
      </div>
    </div>
    </div>
  </div>
  <CalendarScrollbar {scrollContainer} stickyTop={gutterTopHeight + allDayOverlayHeight} onTimelineWheel={scrollTimelineByWheel} />
</div>
</div>
