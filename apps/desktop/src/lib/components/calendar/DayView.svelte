<script lang="ts">
  import type { CalendarEvent } from "./types";
  import type { DayNameFormat } from "./utils";
  import {
    isToday,
    isPastDay,
    formatDatePart,
    formatDayName,
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
    onDayHeaderClick?: () => void;
  } = $props();

  let scrollContainer: HTMLDivElement | undefined = $state();
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

  let currentTimeMinute = $state(-1);

  const today = $derived(isToday(anchorDate));
  const past = $derived(isPastDay(anchorDate));
  const dateStr = $derived(formatDatePart(anchorDate));
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

  const drag = useDragController({
    events: () => events,
    hourHeight: () => hourHeight,
    getColumnDate: () => dateStr,
    onEventUpdate: (e) => onEventUpdate(e),
    onEventCreate: (s, e) => onEventCreate(s, e),
    canDrag: (id) => !previewedIds || !previewedIds.has(id) || id === editingId,
  });
</script>

<div
  bind:this={scrollContainer}
  class="h-full overflow-y-auto overflow-x-hidden"
  style="background-color: var(--cal-bg); visibility: {ready ? 'visible' : 'hidden'};"
>
  <div class="grid" style="grid-template-columns: {gridCols};">
    <!-- Sticky header row -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
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
        {tzCount}
        onAdd={(tz) => onAddTimezone?.(tz)}
        onRemove={(i) => onRemoveTimezone?.(i)}
      />
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        bind:this={headerCell}
        class="flex cursor-pointer items-center px-4 hover:bg-accent/50"
        onclick={() => onDayHeaderClick?.()}
        role="button"
        tabindex="-1"
      >
        <span class="text-[13px]" style="color: {past ? 'var(--muted-foreground)' : 'var(--foreground)'};">
          {dayLabel}
        </span>
      </div>
    </div>

    <!-- Body row -->
    <TimeGutter {hourHeight} {timezones} {anchorDate} {tzCount} />
    <div class="min-w-0" style="border-left: 1px solid var(--cal-gridline);">
      <DayColumn
        date={anchorDate}
        {events}
        {hourHeight}
        isToday={today}
        isPast={past}
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
  </div>
</div>
