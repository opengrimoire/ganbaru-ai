<script lang="ts">
  import type { CalendarEvent } from "./types";
  import type { DayNameFormat } from "./utils";
  import {
    formatDatePart,
    formatDayName,
    allDayEventsForDay,
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
      // Only compute rect and call zoom when the gate is open (first event).
      // Subsequent events in the gesture just preventDefault -- nothing else.
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

  let currentTimeMinute = $state(-1);
  let todayStr = $state(formatDatePart(new Date()));

  const today = $derived(formatDatePart(anchorDate) === todayStr);
  const past = $derived(formatDatePart(anchorDate) < todayStr);
  const dateStr = $derived(formatDatePart(anchorDate));
  const allDayEvents = $derived(allDayEventsForDay(events, anchorDate));
  // Computed from flex: N chips at 22px + 6px strip + py-1 padding (8px)
  const stickyAllDayHeight = $derived(allDayEvents.length > 0 ? allDayEvents.length * 22 + 14 : 0);
  const gutterTopHeight = $derived(stickyHeaderHeight + stickyAllDayHeight);
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

  const drag = useDragController({
    events: () => events,
    hourHeight: () => calZoom.hourHeight,
    getColumnDate: () => dateStr,
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
    <div class="grid" style="grid-template-columns: {gridCols};">
      <!-- Sticky header row -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:clientHeight={stickyHeaderHeight}
        class="sticky top-0 z-[48] grid {allDayEvents.length === 0 ? 'border-b border-[var(--cal-gridline)]' : ''}"
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
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="sticky z-[49] grid border-b border-[var(--cal-gridline)]"
        style="
          top: var(--cal-header-row-h);
          grid-column: 1 / -1;
          grid-template-columns: subgrid;
          background-color: var(--cal-header-bg);
        "
      >
        <div style="grid-column: span {tzCount};"></div>
        <div class="flex min-w-0 flex-col px-1 py-1">
          {#each allDayEvents as evt (evt.id)}
            <AllDayEventChip
              event={evt}
              {isDark}
              editing={editingId === evt.id}
              preview={previewedIds?.has(evt.id) ?? false}
              isPast={past}
              onclick={(rect) => onEventClick(evt, rect)}
            />
          {/each}
          <!-- Thin click-to-create strip -->
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

  <!-- Custom scrollbar gutter -->
  <div class="flex flex-col" style="width: 12px;">
    <div style="height: {gutterTopHeight}px; background-color: var(--cal-header-bg);"></div>
    <div class="relative flex-1" style="background-color: var(--background);">
      <CalendarScrollbar {scrollContainer} />
    </div>
  </div>
</div>
</div>
