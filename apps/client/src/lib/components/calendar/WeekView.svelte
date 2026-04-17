<script lang="ts">
  import type { CalendarEvent, PositionedAllDayEvent } from "./types";
  import type { DayNameFormat } from "./utils";
  import {
    getWeekDays,
    formatDayName,
    formatDatePart,
    layoutAllDayEventsForWeek,
    getEventColor,
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
  import { useAllDayDragController } from "./useAllDayDragController.svelte";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { onMount } from "svelte";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Bell from "@lucide/svelte/icons/bell";

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

  const ALL_DAY_ROW_H = 21;
  const ALL_DAY_GAP = 1;
  const ALL_DAY_PAD = 2;
  const ALL_DAY_MAX_VISIBLE = 2;

  const weekDays = $derived(getWeekDays(anchorDate));

  // Structurally memoize all-day layout: when the grid positions haven't changed
  // (same event IDs at same row/col/span), reuse the previous position objects so
  // the {#each} block skips re-evaluation of unchanged items. This prevents the
  // sticky CSS Grid banner from relayouting on every edit-session state change.
  let _prevAllDay: PositionedAllDayEvent[] = [];
  const allDayPositioned = $derived.by(() => {
    const next = layoutAllDayEventsForWeek(events, weekDays);
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
    // Layout is identical. Reuse prev position objects for items whose event
    // reference hasn't changed; only create new objects for changed events.
    let anyEventChanged = false;
    for (let i = 0; i < next.length; i++) {
      if (_prevAllDay[i].event !== next[i].event) { anyEventChanged = true; break; }
    }
    if (!anyEventChanged) return _prevAllDay;
    const stable = next.map((n, i) =>
      _prevAllDay[i].event === n.event ? _prevAllDay[i] : n,
    );
    _prevAllDay = stable;
    return stable;
  });
  const allDayMaxRow = $derived(allDayPositioned.length > 0 ? Math.max(...allDayPositioned.map((p) => p.row)) + 1 : 0);
  const timedEvents = $derived(events.filter((e) => !e.allDay));
  const tzCount = $derived(Math.max(1, timezones.length));
  const gridCols = $derived(
    `repeat(${tzCount}, ${GUTTER_WIDTH_PER_TZ}px) repeat(7, 1fr)`,
  );

  let allDayExpanded = $state(false);
  const allDayCollapsible = $derived(allDayMaxRow > ALL_DAY_MAX_VISIBLE);
  const allDayVisibleRows = $derived(allDayExpanded || !allDayCollapsible ? allDayMaxRow : ALL_DAY_MAX_VISIBLE);
  // +1 row for the "+N more" button when collapsed
  const allDayGridRows = $derived(allDayCollapsible && !allDayExpanded ? allDayVisibleRows + 1 : allDayVisibleRows);

  // Reset expanded state on week change
  $effect(() => { void anchorDate; allDayExpanded = false; });

  let headerCells: HTMLElement[] = $state([]);
  let dayFormat: DayNameFormat = $state("short");
  let stickyHeaderHeight = $state(0);
  let stickyAllDayBannerHeight = $state(0);
  $effect(() => { if (allDayMaxRow === 0) stickyAllDayBannerHeight = 0; });
  const gutterTopHeight = $derived(stickyHeaderHeight + stickyAllDayBannerHeight);

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

  // stickyAllDayBannerHeight is measured via bind:offsetHeight on the all-day banner
  const calZoom = getCalendarZoom();
  const smoothScroll = createSmoothScroll(() => scrollContainer);

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      if (scrollContainer) {
        smoothScroll.cancel();
        // Shift+Scroll converts deltaY to deltaX for horizontal scrolling, so check both
        const delta = e.shiftKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        calZoom.zoomAt(delta, gutterTopHeight, scrollContainer);
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
    if (e.ctrlKey || e.shiftKey) {
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
      calZoom.registerScrollContainer(scrollContainer, gutterTopHeight);

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

    // Keyboard shortcuts: Shift + +/- for internal calendar zoom.
    // The physical key that produces "+" varies by keyboard layout:
    //   - US/French: "Equal" key (Shift + = produces +)
    //   - Spanish/German: "BracketRight" key (where + is printed)
    //   - Nordic: "Minus" key (+ is the base character)
    // Since the Keyboard API may not be available in all WebViews (e.g., Tauri),
    // we check all known physical key codes where + is commonly located.
    const PLUS_KEY_CODES = ["Equal", "BracketRight", "NumpadAdd"];

    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey) return; // Reserved for app-level zoom
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

      // Zoom in: direct + character, or Shift + any known plus key location
      if (e.key === "+" || (e.shiftKey && PLUS_KEY_CODES.includes(e.code))) {
        e.preventDefault();
        calZoom.zoomStep(1);
      // Zoom out: - or _ (Shift + -)
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
    lastScrollAt = performance.now();
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

  const pomodoroStore = getPomodoro();

  const drag = useDragController({
    events: () => events,
    hourHeight: () => calZoom.hourHeight,
    getColumnDate,
    getScrollContainer: () => scrollContainer ?? null,
    onEventUpdate: (e) => onEventUpdate(e),
    onEventCreate: (s, e) => onEventCreate(s, e),
    canDrag: (id) => editingId ? id === editingId : !previewedIds || !previewedIds.has(id),
    activeBlockId: () => pomodoroStore.activeBlockId,
    isEventLocked: (id) => {
      const ev = events.find((e) => e.id === id);
      if (!ev || !ev.pomodoroConfig) return false;
      if (id === pomodoroStore.activeBlockId) return false;
      return parseCalendarDate(ev.end).getTime() < Date.now();
    },
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
    canDrag: (id) => editingId ? id === editingId : !previewedIds || !previewedIds.has(id),
  });

  const allDayEffectiveRows = $derived.by(() => {
    const base = Math.max(1, allDayGridRows);
    const dp = allDayDrag.allDayDragPreview;
    if (!dp) return base;
    return Math.max(base, dp.row + 1);
  });

  // Per-column count of hidden events when collapsed
  const allDayOverflowPerCol = $derived.by(() => {
    if (!allDayCollapsible || allDayExpanded) return new Array(7).fill(0) as number[];
    const counts = new Array(7).fill(0) as number[];
    for (const pos of allDayPositioned) {
      if (pos.row >= ALL_DAY_MAX_VISIBLE) {
        for (let c = pos.startCol; c < pos.startCol + pos.spanCols; c++) {
          counts[c]++;
        }
      }
    }
    return counts;
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
    <div
      class="week-grid grid"
      style="grid-template-columns: {gridCols};"
    >
      <!-- Sticky header row -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:offsetHeight={stickyHeaderHeight}
        class="sticky top-0 z-[48] grid {allDayMaxRow === 0 ? 'border-b border-[var(--sidebar)]' : ''}"
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
        <!-- Gutter spacer -->
        <div style="grid-column: span {tzCount};"></div>
        <!-- Event grid -->
        <div
          bind:this={allDayGridEl}
          class="relative grid"
          style="
            grid-column: span 7;
            grid-template-columns: subgrid;
            grid-template-rows: repeat({allDayEffectiveRows}, {ALL_DAY_ROW_H}px) 6px;
            padding: {ALL_DAY_PAD}px 0;
            gap: {ALL_DAY_GAP}px 0;
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

          <!-- Positioned all-day events: absolutely positioned to avoid
               CSS Grid relayout when chip classes change (glow on select). -->
          {#each allDayPositioned as pos (pos.event.id)}
            {@const endDateStr = pos.event.end.split(" ")[0]}
            {@const visible = pos.event.id !== allDayDrag.draggingEventId && (allDayExpanded || pos.row < ALL_DAY_MAX_VISIBLE || !allDayCollapsible)}
            <div
              class="absolute flex items-center px-0.5"
              style="
                left: {(pos.startCol / 7) * 100}%;
                width: {(pos.spanCols / 7) * 100}%;
                top: {ALL_DAY_PAD + pos.row * (ALL_DAY_ROW_H + ALL_DAY_GAP)}px;
                height: {ALL_DAY_ROW_H}px;
                z-index: 2;
                min-width: 0;
                {visible ? '' : 'display: none;'}
              "
            >
              <AllDayEventChip
                event={pos.event}
                {isDark}
                editing={editingId === pos.event.id}
                preview={previewedIds?.has(pos.event.id) ?? false}
                grabbing={allDayDrag.grabbingId === pos.event.id}
                canDrag={!editingId || pos.event.id === editingId}
                isPast={endDateStr < todayStr}
                onclick={(rect) => { if (!allDayDrag.didDrag) onEventClick(pos.event, rect); }}
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
                  class="absolute z-[3] flex cursor-pointer items-center px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                  style="
                    left: {(i / 7) * 100}%;
                    width: {(1 / 7) * 100}%;
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
            {@const dpColor = getEventColor(dp.event.color, isDark)}
            {@const dpIconColor = `color-mix(in srgb, ${dpColor.text} 70%, ${dpColor.bg})`}
            {@const dpHasRepeat = !!dp.event.recurrence || !!dp.event.recurringParentId}
            {@const dpHasNotification = !!dp.event.notifications?.length}
            <div
              class="pointer-events-none absolute flex items-center px-0.5"
              style="
                left: {(dp.startCol / 7) * 100}%;
                width: {(dp.spanCols / 7) * 100}%;
                top: {ALL_DAY_PAD + dp.row * (ALL_DAY_ROW_H + ALL_DAY_GAP)}px;
                height: {ALL_DAY_ROW_H}px;
                z-index: 10;
                min-width: 0;
              "
            >
            <div
              class="allday-drag-preview min-w-0 flex-1 select-none truncate rounded px-1.5 text-[10px] leading-[20px]"
              style="
                background-color: {dpColor.bg};
                color: {dpColor.text};
              "
            >
              {#if dpHasRepeat || dpHasNotification}
                <span class="absolute right-1 top-[3px] flex items-center gap-0.5" style="color: {dpIconColor};">
                  {#if dpHasRepeat}
                    <Repeat size={8} class="shrink-0" />
                  {/if}
                  {#if dpHasNotification}
                    <Bell size={8} class="shrink-0" />
                  {/if}
                </span>
              {/if}
              <span class="truncate" class:pr-5={dpHasRepeat || dpHasNotification}>
                {#if dp.event.title}{dp.event.title}{:else}(No title){/if}
              </span>
            </div>
            </div>
          {/if}

        </div>
      </div>
      {/if}

      <!-- Body: one cell per timezone + 7 day columns -->
      <div
        data-zoom-body
        class="grid"
        style="grid-column: 1 / -1; grid-template-columns: subgrid; {calZoom.isAnimating ? 'pointer-events: none;' : ''}"
      >
      <TimeGutter {timezones} {anchorDate} tzCount={tzCount} />

      <div
        class="relative grid"
        style="grid-column: span 7; grid-template-columns: subgrid;"
      >
        {#each weekDays as day, i}
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
              grabbingId={drag.grabbingId ?? undefined}
              didDrag={drag.didDrag}
              dragPreview={drag.getDragPreviewForDate(dateStr)}
              createPreview={drag.getCreatePreviewForDate(dateStr)}
              onEventClick={onEventClick}
              onDragStart={drag.handleDragStart}
              onCreateStart={drag.handleCreateStart}
            />
          </div>
        {/each}

              </div>
      </div>
    </div>
  </div>
  <CalendarScrollbar {scrollContainer} stickyTop={gutterTopHeight} />
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
    border: 1px solid rgba(0, 0, 0, 0.3);
    border-radius: inherit;
    pointer-events: none;
    z-index: 3;
  }

  :global(.dark) .allday-drag-preview::after {
    border-color: rgba(255, 255, 255, 0.5);
  }
</style>
