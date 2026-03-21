<script lang="ts">
  import type { CalendarEvent, PositionedEvent } from "./types";
  import {
    eventsForDay,
    layoutEventsForDay,
    effectiveMinuteRange,
    formatDatePart,
    minuteOfDay,
    snapToGrid,
    clampMinute,
    minuteToTop,
    getEventColor,
  } from "./utils";
  import EventBlock from "./EventBlock.svelte";
  import { onMount } from "svelte";

  let {
    date,
    events,
    hourHeight = 48,
    isToday = false,
    isPast = false,
    isDark = false,
    currentTimeMinute = -1,
    dragPreview = null,
    createPreview = null,
    hideSnapLine = false,
    isScrolling = false,
    snapOverrideMinute = null,
    onEventClick,
    onDragStart,
    onCreateStart,
    editingId,
    previewedIds,
    draggingEventId,
  }: {
    date: Date;
    events: CalendarEvent[];
    hourHeight?: number;
    isToday?: boolean;
    isPast?: boolean;
    isDark?: boolean;
    currentTimeMinute?: number;
    editingId?: string;
    previewedIds?: Set<string>;
    dragPreview?: PositionedEvent | null;
    createPreview?: PositionedEvent | null;
    hideSnapLine?: boolean;
    isScrolling?: boolean;
    snapOverrideMinute?: number | null;
    draggingEventId?: string;
    onEventClick: (event: CalendarEvent, rect?: DOMRect) => void;
    onDragStart: (eventId: string, e: PointerEvent) => void;
    onCreateStart: (dateStr: string, minute: number, e: PointerEvent) => void;
  } = $props();

  const pastOverlayHeight = $derived.by(() => {
    if (isPast) return 24 * hourHeight;
    if (isToday && currentTimeMinute >= 0) {
      return (currentTimeMinute / 60) * hourHeight;
    }
    return 0;
  });

  const hours = Array.from({ length: 24 }, (_, i) => i);

  const dateStr = $derived(formatDatePart(date));
  const dayEvents = $derived(eventsForDay(events, date));
  const positioned = $derived(layoutEventsForDay(dayEvents, hourHeight, dateStr));

  const totalHeight = $derived(24 * hourHeight);

  let snapLineY: number | null = $state(null);
  let snapTimeLabel: string = $state("");
  let columnEl: HTMLDivElement | undefined = $state();

  // Clear snap line when scrolling or dragging starts (prevents stale flash)
  $effect(() => {
    if (isScrolling || hideSnapLine) {
      snapLineY = null;
    }
  });

  onMount(() => {
    function clearSnap() {
      snapLineY = null;
    }
    window.addEventListener("blur", clearSnap);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) snapLineY = null;
    });
    // Clear snap line when break overlay closes (GTK overlay steals WebView focus)
    document.addEventListener("ganbaruai-clear-snap", clearSnap);
    return () => {
      window.removeEventListener("blur", clearSnap);
      document.removeEventListener("ganbaruai-clear-snap", clearSnap);
    };
  });

  const effectiveSnapY = $derived(
    snapOverrideMinute != null
      ? minuteToTop(snapOverrideMinute, hourHeight)
      : snapLineY,
  );
  const effectiveSnapLabel = $derived(
    snapOverrideMinute != null
      ? `${String(Math.floor(snapOverrideMinute / 60)).padStart(2, "0")}:${String(snapOverrideMinute % 60).padStart(2, "0")}`
      : snapTimeLabel,
  );

  function isEventPast(event: CalendarEvent): boolean {
    if (isPast) return true;
    if (isToday && currentTimeMinute >= 0) {
      const { endMinute } = effectiveMinuteRange(event, dateStr);
      return endMinute <= currentTimeMinute;
    }
    return false;
  }

  function handleSlotPointerDown(e: PointerEvent, hour: number) {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minuteWithinHour = snapToGrid((offsetY / hourHeight) * 60);
    const minute = clampMinute(hour * 60 + minuteWithinHour);
    onCreateStart(dateStr, minute, e);
  }

  function handleColumnMouseMove(e: MouseEvent) {
    if (!columnEl || hideSnapLine) return;
    const rect = columnEl.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const rawMinute = (offsetY / hourHeight) * 60;
    let snapped = clampMinute(snapToGrid(rawMinute));

    // Snap to block edges when cursor is near them
    for (const pos of positioned) {
      const blockTop = pos.top;
      const blockBottom = pos.top + pos.height;
      const cursorY = offsetY;

      if (Math.abs(cursorY - blockTop) < 8) {
        const { startMinute } = effectiveMinuteRange(pos.event, dateStr);
        snapped = startMinute;
        break;
      }
      if (Math.abs(cursorY - blockBottom) < 8) {
        const { endMinute } = effectiveMinuteRange(pos.event, dateStr);
        snapped = endMinute;
        break;
      }
    }

    snapLineY = minuteToTop(snapped, hourHeight);
    const h = String(Math.floor(snapped / 60)).padStart(2, "0");
    const m = String(snapped % 60).padStart(2, "0");
    snapTimeLabel = `${h}:${m}`;
  }

  function handleColumnMouseLeave() {
    snapLineY = null;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={columnEl}
  class="relative min-w-0"
  style="height: {totalHeight}px; overflow: hidden;"
  onmousemove={handleColumnMouseMove}
  onmouseleave={handleColumnMouseLeave}
>
  <!-- Past time dimming overlay -->
  {#if pastOverlayHeight > 0}
    <div
      class="pointer-events-none absolute left-0 right-0 top-0 z-[1]"
      style="height: {pastOverlayHeight}px; background-color: var(--cal-past-overlay);"
    ></div>
  {/if}

  <!-- Hour cells (click targets + gridlines) -->
  {#each hours as hour}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute w-full cursor-crosshair"
      style="
        top: {hour * hourHeight}px;
        height: {hourHeight}px;
        border-bottom: 1px solid var(--cal-gridline);
      "
      onpointerdown={(e) => handleSlotPointerDown(e, hour)}
    ></div>
  {/each}

  <!-- Half-hour dashed lines -->
  {#each hours as hour}
    <div
      class="pointer-events-none absolute w-full"
      style="
        top: {hour * hourHeight + hourHeight / 2}px;
        height: 0;
        border-bottom: 1px dashed var(--cal-gridline);
        opacity: 0.4;
      "
    ></div>
  {/each}

  <!-- Events (hide the one being dragged — the drag preview replaces it) -->
  {#each positioned as pos (pos.event.id)}
    {#if pos.event.id !== draggingEventId}
      <EventBlock
        positioned={pos}
        {isDark}
        isPast={isEventPast(pos.event)}
        editing={pos.event.id === editingId}
        preview={previewedIds?.has(pos.event.id) === true}
        onclick={(rect) => onEventClick(pos.event, rect)}
        onpointerdown={(e) => onDragStart(pos.event.id, e)}
      />
    {/if}
  {/each}

  <!-- Drag preview (replaces the original block at the target position) -->
  {#if dragPreview}
    {@const dragColor = dragPreview.event.color ? getEventColor(dragPreview.event.color, isDark) : null}
    <div
      class="preview-stripe pointer-events-none absolute overflow-hidden rounded px-1.5 py-0.5 text-[11px] leading-tight"
      style="
        top: {dragPreview.top}px;
        height: {dragPreview.height}px;
        left: 0;
        width: 100%;
        background-color: {dragColor?.bg ?? (isDark ? '#2A2A2C' : '#E8E8E8')};
        border-left: 3px solid {dragColor?.border ?? (isDark ? '#888' : '#AAAAAA')};
        color: {dragColor?.text ?? (isDark ? '#CACACA' : '#666666')};
        --stripe-color: {isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)'};
        z-index: 46;
      "
    >
      <div class="truncate font-medium">{dragPreview.event.title}</div>
      {#if dragPreview.height > 28}
        {@const st = dragPreview.event.start.split(" ")[1] ?? ""}
        {@const et = dragPreview.event.end.split(" ")[1] ?? ""}
        <div class="truncate opacity-80">{st} - {et}</div>
      {/if}
    </div>
  {/if}

  <!-- Create preview (new block being drawn) -->
  {#if createPreview}
    <div
      data-create-preview
      class="preview-stripe pointer-events-none absolute overflow-hidden rounded px-1.5 py-0.5 text-[11px] leading-tight"
      style="
        top: {createPreview.top}px;
        height: {createPreview.height}px;
        left: 0;
        width: 100%;
        background-color: {isDark ? '#2A2A2C' : '#E8E8E8'};
        border-left: 3px solid {isDark ? '#888' : '#AAAAAA'};
        color: {isDark ? '#CACACA' : '#666666'};
        --stripe-color: {isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)'};
        z-index: 10;
      "
    >
      <div class="truncate font-medium">
        {createPreview.event.title || "Focus session"}
      </div>
    </div>
  {/if}

  <!-- Snap position indicator line with time label — always on top -->
  {#if effectiveSnapY !== null && !hideSnapLine && !isScrolling}
    <div
      class="pointer-events-none absolute left-0 right-0"
      style="top: {effectiveSnapY}px; z-index: 47;"
    >
      <div class="relative">
        <span
          class="absolute bottom-0 left-0 rounded-t px-1.5 py-[1px] text-[10px] font-medium leading-tight"
          style="background-color: var(--cal-current-time); color: white;"
        >{effectiveSnapLabel}</span>
        <div
          class="h-[2px] w-full"
          style="background-color: var(--cal-current-time); opacity: 0.5;"
        ></div>
      </div>
    </div>
  {/if}

  <!-- Current time line -->
  {#if isToday && currentTimeMinute >= 0}
    <div
      class="pointer-events-none absolute left-0 right-0"
      style="top: {(currentTimeMinute / 60) * hourHeight}px; z-index: 46;"
    >
      <div class="flex items-center">
        <div
          class="h-2.5 w-2.5 shrink-0 rounded-full"
          style="background-color: var(--cal-current-time); margin-left: -5px;"
        ></div>
        <div
          class="h-[2px] flex-1"
          style="background-color: var(--cal-current-time);"
        ></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .preview-stripe {
    position: relative;
  }

  .preview-stripe::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 5px,
      var(--stripe-color) 5px,
      var(--stripe-color) 10px
    );
    pointer-events: none;
  }
</style>
