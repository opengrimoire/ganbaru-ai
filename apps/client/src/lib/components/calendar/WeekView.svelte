<script lang="ts">
  import type { CalendarEvent, PersistedSegment, PositionedAllDayEvent } from "./types";
  import type { DayNameFormat, TimezoneAbbrMode } from "./utils";
  import {
    formatDayName,
    formatDatePart,
    layoutAllDayEventsForWeek,
    getEventColor,
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
  import { getEventIndicatorState } from "./event-indicators";
  import { useDragController } from "./useDragController.svelte";
  import { useAllDayDragController } from "./useAllDayDragController.svelte";
  import { eventMatchesActiveOccurrence } from "./occurrence-protection";
  import { hasCalendarEventStarted } from "./event-edit-permissions";
  import type { PanelAnchor } from "./edit-session.svelte";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { onMount } from "svelte";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Video from "@lucide/svelte/icons/video";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Users from "@lucide/svelte/icons/users";
  import type { Theme } from "$lib/stores/themes";

  let {
    anchorDate,
    days = [] as Date[],
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
    days?: Date[];
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
    onDayHeaderClick?: (date: Date) => void;
  } = $props();

  /** Stable empty fallback so day columns without events keep a consistent prop reference. */
  const EMPTY_DAY: CalendarEvent[] = [];

  const ALL_DAY_ROW_H = 21;
  const ALL_DAY_GAP = 1;
  const ALL_DAY_PAD = 2;
  const ALL_DAY_MAX_VISIBLE = 2;

  const visibleDays = $derived(days.length > 0 ? days : [anchorDate]);
  const dayCount = $derived(visibleDays.length);

  // Structurally track all-day layout using stable fields only. Event object
  // identity can be a Svelte proxy/raw mix when panel state changes.
  let _prevAllDay: PositionedAllDayEvent[] = [];
  const allDayPositioned = $derived.by(() => {
    const next = layoutAllDayEventsForWeek(events, visibleDays);
    if (next.length !== _prevAllDay.length) { _prevAllDay = next; return next; }
    let layoutSame = true;
    for (let i = 0; i < next.length; i++) {
      const n = next[i], p = _prevAllDay[i];
      if (n.event.id !== p.event.id || n.row !== p.row || n.startCol !== p.startCol || n.spanCols !== p.spanCols) {
        layoutSame = false;
        break;
      }
    }
    if (!layoutSame) { _prevAllDay = next; return next; }
    _prevAllDay = next;
    return next;
  });
  const allDayMaxRow = $derived(allDayPositioned.length > 0 ? Math.max(...allDayPositioned.map((p) => p.row)) + 1 : 0);
  const tzCount = $derived(Math.max(1, timezones.length));
  const gridCols = $derived(
    `repeat(${tzCount}, ${GUTTER_WIDTH_PER_TZ}px) repeat(${dayCount}, 1fr)`,
  );

  let allDayExpanded = $state(false);
  const allDayCollapsible = $derived(allDayMaxRow > ALL_DAY_MAX_VISIBLE);
  const allDayVisibleRows = $derived(allDayExpanded || !allDayCollapsible ? allDayMaxRow : ALL_DAY_MAX_VISIBLE);
  // +1 row for the "+N more" button when collapsed
  const allDayGridRows = $derived(allDayCollapsible && !allDayExpanded ? allDayVisibleRows + 1 : allDayVisibleRows);

  // Reset expanded state on range change.
  $effect(() => { void visibleDays; allDayExpanded = false; });

  let headerCells: HTMLElement[] = $state([]);
  let dayFormat: DayNameFormat = $state("short");
  let stickyHeaderHeight = $state(0);
  let allDayOverlayHeight = $state(0);
  $effect(() => { if (allDayMaxRow === 0) allDayOverlayHeight = 0; });
  const gutterTopHeight = $derived(stickyHeaderHeight);

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
  let visibleStartMinute = $state(0);
  let visibleEndMinute = $state(1440);

  const calZoom = getCalendarZoom();
  const timelineWheelScroll = createTimelineWheelScroll(() => scrollContainer);
  const localization = getLocalization();
  const { t } = localization;
  const locale = $derived(localization.locale);

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

  // Column date resolution for cross-column move drag
  function getColumnDate(clientX: number): string {
    const gridEl = scrollContainer?.querySelector(".week-grid");
    const cols = gridEl?.querySelectorAll(".day-col");
    if (!cols?.length) return formatDatePart(visibleDays[0]);

    for (let i = 0; i < cols.length; i++) {
      const rect = cols[i].getBoundingClientRect();
      if (clientX >= rect.left && clientX < rect.right) {
        return formatDatePart(visibleDays[i]);
      }
    }
    // Fallback: closest edge
    const firstRect = cols[0].getBoundingClientRect();
    if (clientX < firstRect.left) return formatDatePart(visibleDays[0]);
    return formatDatePart(visibleDays[dayCount - 1]);
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
    getColumnDate,
    getScrollContainer: () => scrollContainer ?? null,
    onEventUpdate: (e) => onEventUpdate(e),
    onEventCreate: (s, e, anchor) => onEventCreate(s, e, false, anchor),
    canDrag: (id) => editingId ? id === editingId : !previewedIds || !previewedIds.has(id),
    isActiveEvent: isActiveCalendarEvent,
    isEventLocked: isLockedCalendarEvent,
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
    days: () => visibleDays,
    getColumnBounds: getAllDayColumnBounds,
    getPositionedEvents: () => allDayPositioned,
    onEventUpdate: (e) => onEventUpdate(e),
    canDrag: (id) => editingId ? id === editingId : !previewedIds || !previewedIds.has(id),
    isEventLocked: isLockedCalendarEvent,
  });

  const allDayEffectiveRows = $derived.by(() => {
    const base = Math.max(1, allDayGridRows);
    const dp = allDayDrag.allDayDragPreview;
    if (!dp) return base;
    return Math.max(base, dp.row + 1);
  });

  // Per-column count of hidden events when collapsed
  const allDayOverflowPerCol = $derived.by(() => {
    if (!allDayCollapsible || allDayExpanded) return new Array(dayCount).fill(0) as number[];
    const counts = new Array(dayCount).fill(0) as number[];
    for (const pos of allDayPositioned) {
      if (pos.row >= ALL_DAY_MAX_VISIBLE) {
        for (let c = pos.startCol; c < pos.startCol + pos.spanCols && c < counts.length; c++) {
          counts[c]++;
        }
      }
    }
    return counts;
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

  function allDayCreateAnchorFromGrid(target: HTMLElement): PanelAnchor {
    const rect = target.getBoundingClientRect();
    return {
      x: rect.right,
      y: rect.top + ALL_DAY_PAD,
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
      class="grid {allDayMaxRow === 0 ? 'border-b border-sidebar' : ''}"
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
        abbrMode={tzAbbrMode}
        onAdd={(tz) => onAddTimezone?.(tz)}
        onRemove={(i) => onRemoveTimezone?.(i)}
        onReorder={(from, to) => onReorderTimezone?.(from, to)}
        onAbbrModeChange={(m) => onTzAbbrModeChange?.(m)}
      />

      <div
        class="grid"
        style="grid-column: span {dayCount}; grid-template-columns: subgrid;"
      >
        {#each visibleDays as day, i}
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
              <span class="text-[0.866667rem]" style="color: {past ? 'var(--muted-foreground)' : 'var(--foreground)'};">
                {#if dayFormat !== "none"}{formatDayName(day, dayFormat, locale)}&nbsp;{/if}{day.getDate()}
              </span>
            </div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="absolute inset-x-0 bottom-0 cursor-pointer transition-colors hover:bg-foreground/10"
              style="height: 6px;"
              onclick={(e) => {
                e.stopPropagation();
                const dateStr = formatDatePart(day);
                onEventCreate(
                  `${dateStr} 00:00`,
                  `${dateStr} 00:00`,
                  true,
                  allDayCreateAnchorFromHeader(e.currentTarget as HTMLElement),
                );
              }}
            ></div>
          </div>
        {/each}
      </div>
    </div>

    {#if allDayMaxRow > 0}
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
      <!-- Gutter spacer -->
      <div style="grid-column: span {tzCount};"></div>
      <!-- Event grid -->
      <div
        bind:this={allDayGridEl}
        data-calendar-edit-close-zone
        class="relative grid"
        style="
          grid-column: span {dayCount};
          grid-template-columns: subgrid;
          grid-template-rows: repeat({allDayEffectiveRows}, {ALL_DAY_ROW_H}px);
          padding: {ALL_DAY_PAD}px 0;
          gap: {ALL_DAY_GAP}px 0;
        "
      >
        <!-- Column measurement targets -->
        {#each visibleDays as day, i}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="allday-col-target cursor-pointer"
            style="grid-column: {i + 1}; grid-row: 1 / -1; z-index: 0;"
            onclick={(e) => {
              e.stopPropagation();
              const dateStr = formatDatePart(day);
              onEventCreate(
                `${dateStr} 00:00`,
                `${dateStr} 00:00`,
                true,
                allDayCreateAnchorFromGrid(e.currentTarget as HTMLElement),
              );
            }}
          ></div>
        {/each}

        <!-- Positioned all-day events: absolutely positioned to avoid
             CSS Grid relayout when chip classes change (glow on select). -->
        {#each allDayPositioned as pos (pos.event.id)}
          {@const endDateStr = pos.event.end.split(" ")[0]}
          {@const visible = pos.event.id !== allDayDrag.draggingEventId && (allDayExpanded || pos.row < ALL_DAY_MAX_VISIBLE || !allDayCollapsible)}
          <div
            class="absolute flex items-center px-0.5"
            style="
              left: {(pos.startCol / dayCount) * 100}%;
              width: {(pos.spanCols / dayCount) * 100}%;
              top: {ALL_DAY_PAD + pos.row * (ALL_DAY_ROW_H + ALL_DAY_GAP)}px;
              height: {ALL_DAY_ROW_H}px;
              z-index: 2;
              min-width: 0;
              {visible ? '' : 'display: none;'}
            "
          >
            <AllDayEventChip
              event={pos.event}
              {theme}
              editing={editingId === pos.event.id}
              preview={previewedIds?.has(pos.event.id) ?? false}
              grabbing={allDayDrag.grabbingId === pos.event.id}
              canDrag={(!editingId || pos.event.id === editingId) && !isLockedCalendarEvent(pos.event.id)}
              isPast={endDateStr < todayStr}
              onclick={(rect) => { if (!allDayDrag.didDrag) onEventClick(pos.event, rect); }}
              onprefetch={() => onEventPrefetch?.(pos.event)}
              onpointerdown={(e) => allDayDrag.handleDragStart(pos.event.id, e)}
            />
          </div>
        {/each}

        <!-- "+N more" per column when collapsed -->
        {#if allDayCollapsible && !allDayExpanded}
          {#each allDayOverflowPerCol as count, i}
            {#if count > 0}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                class="absolute z-3 flex cursor-pointer items-center px-1.5 text-[0.666667rem] text-muted-foreground hover:text-foreground"
                style="
                  left: {(i / dayCount) * 100}%;
                  width: {(1 / dayCount) * 100}%;
                  top: {ALL_DAY_PAD + ALL_DAY_MAX_VISIBLE * (ALL_DAY_ROW_H + ALL_DAY_GAP)}px;
                  height: {ALL_DAY_ROW_H}px;
                "
                onclick={(e) => { e.stopPropagation(); allDayExpanded = true; }}
              >
                +{count} more
              </div>
            {/if}
          {/each}
        {/if}

        <!-- Drag preview -->
        {#if allDayDrag.allDayDragPreview}
          {@const dp = allDayDrag.allDayDragPreview}
          {@const dpColor = getEventColor(dp.event.color, theme)}
          {@const dpIconColor = `color-mix(in srgb, ${dpColor.text} 70%, ${dpColor.bg})`}
          {@const dpIndicators = getEventIndicatorState(dp.event)}
          <div
            class="pointer-events-none absolute flex items-center px-0.5"
            style="
              left: {(dp.startCol / dayCount) * 100}%;
              width: {(dp.spanCols / dayCount) * 100}%;
              top: {ALL_DAY_PAD + dp.row * (ALL_DAY_ROW_H + ALL_DAY_GAP)}px;
              height: {ALL_DAY_ROW_H}px;
              z-index: 10;
              min-width: 0;
            "
          >
          <div
            class="allday-drag-preview min-w-0 flex-1 select-none truncate rounded px-1.5 text-[0.666667rem] leading-5"
            style="
              background-color: {dpColor.bg};
              color: {dpColor.text};
              --event-bg: {dpColor.bg};
              --outline-mix: {dpColor.text};
            "
          >
            {#if dpIndicators.iconCount > 0}
              <span class="absolute right-1 top-0.75 flex items-center gap-0.5" style="color: {dpIconColor};">
                {#if dpIndicators.hasRepeat}
                  <Repeat size={8} class="shrink-0" />
                {/if}
                {#if dpIndicators.hasCallLink}
                  <Video size={8} class="shrink-0" />
                {/if}
                {#if dpIndicators.hasLocation}
                  <MapPin size={8} class="shrink-0" />
                {/if}
                {#if dpIndicators.hasGenericMeeting}
                  <Users size={8} class="shrink-0" />
                {/if}
              </span>
            {/if}
            <span
              class="truncate"
              class:pr-5={dpIndicators.iconCount > 0 && dpIndicators.iconCount <= 2}
              class:pr-8={dpIndicators.iconCount > 2}
            >
              {#if dp.event.title}{dp.event.title}{:else}{t("calendar.event.noTitle")}{/if}
            </span>
          </div>
          </div>
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
      class="week-grid absolute inset-x-0 top-0 grid"
      style="grid-template-columns: {gridCols}; transform: translateY({allDayOverlayHeight}px);"
    >
      <!-- Body: one cell per timezone + 7 day columns -->
      <div
        data-zoom-body
        class="grid"
        style="grid-column: 1 / -1; grid-template-columns: subgrid; {calZoom.isAnimating ? 'pointer-events: none;' : ''}"
      >
      <TimeGutter {timezones} {anchorDate} tzCount={tzCount} />

      <div
        data-calendar-edit-close-zone
        class="relative grid"
        style="grid-column: span {dayCount}; grid-template-columns: subgrid;"
      >
        <HourGridlines />
        {#each visibleDays as day, i}
          {@const dateStr = formatDatePart(day)}
          <div data-day-column-shell class="day-col min-w-0" style="border-left: 1px solid var(--cal-gridline);">
            <DayColumn
              date={day}
              events={eventsByDay.get(dateStr) ?? EMPTY_DAY}
              {theme}
              isToday={formatDatePart(day) === todayStr}
              isPast={formatDatePart(day) < todayStr}
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
        {/each}

              </div>
      </div>
    </div>
    </div>
  </div>
  <CalendarScrollbar {scrollContainer} stickyTop={gutterTopHeight + allDayOverlayHeight} onTimelineWheel={scrollTimelineByWheel} />
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
    border: 1px solid color-mix(in oklab, var(--event-bg) 65%, var(--outline-mix));
    border-radius: inherit;
    pointer-events: none;
    z-index: 3;
  }
</style>
