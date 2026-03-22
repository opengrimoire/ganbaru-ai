<script lang="ts">
  import type { CalendarEvent, PositionedEvent, PersistedSegment } from "./types";
  import {
    eventsForDay,
    layoutEventsForDay,
    effectiveMinuteRange,
    formatDatePart,
    parseCalendarDate,
    snapToGrid,
    clampMinute,
    minuteToTop,
    getEventColor,
  } from "./utils";
  import { computeDayTimelineBands } from "$lib/utils/pomodoro-segments";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { select } from "$lib/api/db";
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

  // Centralized pomodoro timeline
  const pomodoro = getPomodoro();
  const railWidth = 6;

  // One rail segment per contiguous group of pomodoro events (merge overlapping/adjacent)
  const railSegments = $derived.by(() => {
    const ranges: { start: number; end: number }[] = [];
    for (const p of positioned) {
      if (!p.event.pomodoroConfig) continue;
      const { startMinute, endMinute } = effectiveMinuteRange(p.event, dateStr);
      ranges.push({ start: startMinute, end: endMinute });
    }
    if (ranges.length === 0) return [];
    ranges.sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
      const last = merged[merged.length - 1];
      if (ranges[i].start <= last.end) {
        last.end = Math.max(last.end, ranges[i].end);
      } else {
        merged.push(ranges[i]);
      }
    }
    return merged;
  });

  // Load persisted segments from DB for all pomodoro events on this day
  interface DbSegmentRow {
    id: string;
    event_id: string;
    event_date: string;
    run_id: string;
    cycle_number: number;
    phase: string;
    planned_start: string;
    planned_end: string;
    actual_start: string | null;
    actual_end: string | null;
    status: string;
  }

  let persistedSegmentsMap = $state(new Map<string, PersistedSegment[]>());

  $effect(() => {
    const eventIds = positioned
      .filter((p) => p.event.pomodoroConfig && p.event.id !== pomodoro.activeBlockId)
      .map((p) => p.event.id);
    if (eventIds.length === 0) {
      persistedSegmentsMap = new Map();
      return;
    }
    const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(",");
    select<DbSegmentRow>(
      `SELECT id, event_id, event_date, run_id, cycle_number, phase,
              planned_start, planned_end, actual_start, actual_end, status
       FROM pomodoro_segments
       WHERE event_id IN (${placeholders})
         AND (status = 'completed' OR status = 'active' OR status = 'interrupted')
       ORDER BY planned_start ASC`,
      eventIds,
    ).then((rows) => {
      const map = new Map<string, PersistedSegment[]>();
      for (const r of rows) {
        const seg: PersistedSegment = {
          id: r.id,
          eventId: r.event_id,
          eventDate: r.event_date,
          runId: r.run_id,
          cycleNumber: r.cycle_number,
          phase: r.phase as PersistedSegment["phase"],
          plannedStart: r.planned_start,
          plannedEnd: r.planned_end,
          actualStart: r.actual_start,
          actualEnd: r.actual_end,
          status: r.status as PersistedSegment["status"],
        };
        const arr = map.get(seg.eventId) ?? [];
        arr.push(seg);
        map.set(seg.eventId, arr);
      }
      persistedSegmentsMap = map;
    }).catch((e) => console.warn("[DayColumn] Failed to load segments:", e));
  });

  const timelineBands = $derived.by(() => {
    void pomodoro.breakOvertimeSeconds;
    const dayMidnight = parseCalendarDate(`${dateStr} 00:00`);
    const dayStartMs = dayMidnight.getTime();
    const nowMs = Date.now();

    const pomodoroEvents = positioned
      .filter((p) => p.event.pomodoroConfig)
      .map((p) => {
        const { startMinute, endMinute } = effectiveMinuteRange(p.event, dateStr);
        return {
          id: p.event.id,
          config: p.event.pomodoroConfig!,
          startMs: parseCalendarDate(p.event.start).getTime(),
          endMs: parseCalendarDate(p.event.end).getTime(),
          startMinute,
          endMinute,
        };
      });

    return computeDayTimelineBands(pomodoroEvents, {
      activeBlockId: pomodoro.activeBlockId,
      segments: pomodoro.segments,
      remainingSeconds: pomodoro.remainingSeconds,
      breakOvertimeSeconds: pomodoro.breakOvertimeSeconds,
    }, dayStartMs, nowMs, persistedSegmentsMap);
  });

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
  class="relative min-w-0"
  style="height: {totalHeight}px;"
>
  <!-- Current time indicator (outside overflow-hidden so the circle can bleed left) -->
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

  <!-- Past time dimming overlay (full width, behind rail and content) -->
  {#if pastOverlayHeight > 0}
    <div
      class="pointer-events-none absolute left-0 right-0 top-0 z-[1]"
      style="height: {pastOverlayHeight}px; background-color: var(--cal-past-overlay);"
    ></div>
  {/if}

  <!-- Pomodoro timeline rails (one per contiguous group of pomodoro events) -->
  {#each railSegments as seg}
    <div
      class="pointer-events-none absolute z-[2]"
      style="
        left: 2px;
        width: {railWidth}px;
        top: {(seg.start / 60) * hourHeight}px;
        height: {((seg.end - seg.start) / 60) * hourHeight}px;
        background-color: var(--cal-timeline-rail);
        border-radius: 3px;
      "
    >
      <!-- Focus fill bands (green, behind breaks) -->
      {#each timelineBands.filter(b => b.phase === "focus" && b.topMinute < seg.end && b.topMinute + b.heightMinutes > seg.start) as band}
        <div
          class="absolute left-0 right-0"
          style="
            top: {((band.topMinute - seg.start) / (seg.end - seg.start)) * 100}%;
            height: {Math.max((band.heightMinutes / (seg.end - seg.start)) * 100, 0.5)}%;
            background-color: var(--cal-timeline-focus);
            opacity: {band.status === 'active' ? 0.85 : 0.7};
          "
        ></div>
      {/each}
      <!-- Break bands (on top of focus fills) -->
      {#each timelineBands.filter(b => b.phase !== "focus" && b.status !== "skipped" && b.topMinute < seg.end && b.topMinute + b.heightMinutes > seg.start) as band}
        <div
          class="absolute left-0 right-0 {band.status === 'active' ? 'break-band-active' : ''}"
          style="
            top: {((band.topMinute - seg.start) / (seg.end - seg.start)) * 100}%;
            height: {Math.max((band.heightMinutes / (seg.end - seg.start)) * 100, 0.5)}%;
            background-color: var(--cal-timeline-break);
            opacity: {band.status === 'planned' ? 0.6 : band.status === 'completed' ? 0.35 : 0.9};
          "
        ></div>
      {/each}
    </div>
  {/each}

  <div
    bind:this={columnEl}
    class="absolute top-0 right-0 bottom-0 overflow-hidden"
    style="left: {railSegments.length > 0 ? railWidth + 4 : 0}px;"
    onmousemove={handleColumnMouseMove}
    onmouseleave={handleColumnMouseLeave}
  >
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
      class="preview-pulse pointer-events-none absolute flex overflow-hidden rounded text-[11px] leading-tight"
      style="
        top: {dragPreview.top}px;
        height: {dragPreview.height}px;
        left: 0;
        width: 92%;
        color: {dragColor?.text ?? (isDark ? '#CACACA' : '#666666')};
        z-index: 46;
      "
    >
      <div class="min-w-0 flex-1 px-1 py-0.5" style="background-color: {dragColor?.bg ?? (isDark ? '#2A2A2C' : '#E8E8E8')};">
        <div class="truncate font-medium">{dragPreview.event.title}</div>
        {#if dragPreview.height > 28}
          {@const st = dragPreview.event.start.split(" ")[1] ?? ""}
          {@const et = dragPreview.event.end.split(" ")[1] ?? ""}
          <div class="truncate opacity-80">{st} - {et}</div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Create preview (new block being drawn) -->
  {#if createPreview}
    <div
      data-create-preview
      class="preview-pulse pointer-events-none absolute flex overflow-hidden rounded text-[11px] leading-tight"
      style="
        top: {createPreview.top}px;
        height: {createPreview.height}px;
        left: 0;
        width: 92%;
        color: {isDark ? '#CACACA' : '#666666'};
        z-index: 10;
      "
    >
      <div class="min-w-0 flex-1 px-1 py-0.5" style="background-color: {isDark ? '#2A2A2C' : '#E8E8E8'};">
        <div class="truncate font-medium">
          {createPreview.event.title || "Focus session"}
        </div>
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

  </div>
</div>

<style>
  .preview-pulse {
    animation: preview-pulse 2s ease-in-out infinite;
  }

  @keyframes preview-pulse {
    0%, 100% { opacity: 0.75; }
    50% { opacity: 1; }
  }

  .break-band-active {
    animation: break-pulse 1.5s ease-in-out infinite;
  }

  @keyframes break-pulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.9; }
  }
</style>
