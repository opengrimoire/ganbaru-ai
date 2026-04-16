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
    getEventColor,
  } from "./utils";
  import { computeDayTimelineBands } from "$lib/utils/pomodoro-segments";
  import { PENDING_CREATE_ID } from "./display-events";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { select } from "$lib/api/db";
  import EventBlock from "./EventBlock.svelte";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import { onMount } from "svelte";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Bell from "@lucide/svelte/icons/bell";

  let {
    date,
    events,
    isToday = false,
    isPast = false,
    isDark = false,
    currentTimeMinute = -1,
    dragPreview = null,
    createPreview = null,
    onEventClick,
    onDragStart,
    onCreateStart,
    editingId,
    previewedIds,
    draggingEventId,
    grabbingId,
    didDrag = false,
  }: {
    date: Date;
    events: CalendarEvent[];
    isToday?: boolean;
    isPast?: boolean;
    isDark?: boolean;
    currentTimeMinute?: number;
    editingId?: string;
    previewedIds?: Set<string>;
    dragPreview?: PositionedEvent | null;
    createPreview?: PositionedEvent | null;
    draggingEventId?: string;
    grabbingId?: string;
    didDrag?: boolean;
    onEventClick: (event: CalendarEvent, rect?: DOMRect) => void;
    onDragStart: (eventId: string, e: PointerEvent, forceEdge?: "resize-top" | "resize-bottom") => void;
    onCreateStart: (dateStr: string, minute: number, e: PointerEvent) => void;
  } = $props();

  const panelOpen = $derived(!!editingId);

  const pastOverlayMinutes = $derived.by(() => {
    if (isPast) return 1440;
    if (isToday && currentTimeMinute >= 0) return currentTimeMinute;
    return 0;
  });

  const hours = Array.from({ length: 24 }, (_, i) => i);

  const dateStr = $derived(formatDatePart(date));
  const dayEvents = $derived(eventsForDay(events, date));
  const positioned = $derived(layoutEventsForDay(dayEvents, dateStr));

  // Layout-aware preview: include drag/create preview in layout computation
  // so overlapping events shift in real time to show the final result.
  const previewEvent = $derived(dragPreview?.event ?? createPreview?.event ?? null);

  const layoutWithPreview = $derived.by(() => {
    if (!previewEvent && !draggingEventId) {
      return { items: positioned, preview: null as PositionedEvent | null };
    }

    // Always exclude the dragged event (it may have moved to another day)
    const baseEvents = draggingEventId
      ? dayEvents.filter(e => e.id !== draggingEventId)
      : dayEvents;

    const eventsForLayout = previewEvent
      ? [...baseEvents, previewEvent]
      : baseEvents;

    const all = layoutEventsForDay(eventsForLayout, dateStr);

    if (!previewEvent) {
      return { items: all, preview: null as PositionedEvent | null };
    }

    const previewId = previewEvent.id;
    const items: PositionedEvent[] = [];
    let preview: PositionedEvent | null = null;

    for (const p of all) {
      if (p.event.id === previewId) {
        preview = p;
      } else {
        items.push(p);
      }
    }

    return { items, preview };
  });

  const effectivePositioned = $derived(layoutWithPreview.items);
  const layoutedPreview = $derived(layoutWithPreview.preview);

  // Centralized pomodoro timeline
  const pomodoro = getPomodoro();
  const calZoom = getCalendarZoom();
  const railWidth = 6;

  // One rail segment per contiguous group of pomodoro events (merge overlapping/adjacent)
  const railSegments = $derived.by(() => {
    const ranges: { start: number; end: number }[] = [];
    for (const p of positioned) {
      if (draggingEventId && p.event.id === draggingEventId) continue;
      if (!p.event.pomodoroConfig) continue;
      const { startMinute, endMinute } = effectiveMinuteRange(p.event, dateStr);
      ranges.push({ start: startMinute, end: endMinute });
    }
    // Include drag preview if it has pomodoro config
    if (dragPreview?.event.pomodoroConfig) {
      const { startMinute, endMinute } = effectiveMinuteRange(dragPreview.event, dateStr);
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
    pause_log: string | null;
    status: string;
  }

  let persistedSegmentsMap = $state(new Map<string, PersistedSegment[]>());

  $effect(() => {
    void pomodoro.segmentVersion; // re-fetch when segments are written to DB
    const eventIds = positioned
      .filter((p) => p.event.pomodoroConfig && p.event.id !== pomodoro.activeBlockId && p.event.id !== draggingEventId)
      .map((p) => p.event.id);
    if (eventIds.length === 0) {
      persistedSegmentsMap = new Map();
      return;
    }
    const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(",");
    select<DbSegmentRow>(
      `SELECT id, event_id, event_date, run_id, cycle_number, phase,
              planned_start, planned_end, actual_start, actual_end, pause_log, status
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
          pauseLog: r.pause_log ? JSON.parse(r.pause_log) : [],
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
    void currentTimeMinute; // re-run every second (even during pause)
    const dayMidnight = parseCalendarDate(`${dateStr} 00:00`);
    const dayStartMs = dayMidnight.getTime();
    const nowMs = Date.now();

    const nowMinuteOfDay = (nowMs - dayStartMs) / 60000;
    const pomodoroEvents = positioned
      .filter((p) => p.event.pomodoroConfig && !(draggingEventId && p.event.id === draggingEventId))
      .map((p) => {
        const { startMinute, endMinute } = effectiveMinuteRange(p.event, dateStr);
        let evStartMs = parseCalendarDate(p.event.start).getTime();
        let evStartMinute = startMinute;

        // Create preview (including expanded recurring instances): focus will start
        // at save time (now), not event start. Clamp to now so break marks match.
        if (p.event.id.startsWith(PENDING_CREATE_ID) && evStartMs < nowMs) {
          evStartMs = nowMs;
          evStartMinute = Math.max(startMinute, nowMinuteOfDay);
        }

        return {
          id: p.event.id,
          config: p.event.pomodoroConfig!,
          startMs: evStartMs,
          endMs: parseCalendarDate(p.event.end).getTime(),
          startMinute: evStartMinute,
          endMinute,
        };
      });
    // Include drag preview for rail band previsualization
    if (dragPreview?.event.pomodoroConfig) {
      const { startMinute, endMinute } = effectiveMinuteRange(dragPreview.event, dateStr);
      pomodoroEvents.push({
        id: dragPreview.event.id,
        config: dragPreview.event.pomodoroConfig,
        startMs: parseCalendarDate(dragPreview.event.start).getTime(),
        endMs: parseCalendarDate(dragPreview.event.end).getTime(),
        startMinute,
        endMinute,
      });
    }

    return computeDayTimelineBands(pomodoroEvents, {
      activeBlockId: pomodoro.activeBlockId,
      segments: pomodoro.segments,
      remainingSeconds: pomodoro.remainingSeconds,
      breakOvertimeSeconds: pomodoro.breakOvertimeSeconds,
    }, dayStartMs, nowMs, persistedSegmentsMap);
  });

  let columnEl: HTMLDivElement | undefined = $state();
  let lastClientX: number | null = $state(null);
  let lastClientY: number | null = $state(null);
  let scrollProximityRaf = 0;
  let isScrolling = $state(false);
  let zoomModifierPressed = $state(false); // Ctrl or Shift held for zoom
  // Track when mouse is near a block's resize edge (top or bottom)
  let hoverResizeBlockId: string | null = $state(null);

  // Re-check resize proximity when block layout changes (e.g. new block saved)
  $effect(() => {
    void effectivePositioned;
    if (lastClientX === null || lastClientY === null || !columnEl) return;
    recheckProximity();
  });

  function recheckProximity() {
    if (!columnEl || lastClientX === null || lastClientY === null) return;
    const colRect = columnEl.getBoundingClientRect();
    const colOffsetX = lastClientX - colRect.left;
    const colOffsetY = lastClientY - colRect.top;
    const nearby = findNearbyBlockEdge(colOffsetX, colOffsetY, colRect.width);
    if (nearby) {
      hoverResizeBlockId = (panelOpen && nearby.eventId !== editingId) ? null : nearby.eventId;
    } else {
      hoverResizeBlockId = null;
    }
  }

  onMount(() => {
    function clearMouseState() {
      lastClientX = null;
      lastClientY = null;
      hoverResizeBlockId = null;
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Control" || e.key === "Shift") {
        zoomModifierPressed = true;
      }
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.key === "Control" || e.key === "Shift") zoomModifierPressed = false;
    }
    window.addEventListener("blur", clearMouseState);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clearMouseState();
    });

    // Track scroll for resize detection during scroll
    const sp = columnEl?.closest('.hide-scrollbar') as HTMLElement | null;
    if (sp) {
      sp.addEventListener('scroll', handleParentScroll);
    }

    return () => {
      window.removeEventListener("blur", clearMouseState);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      sp?.removeEventListener('scroll', handleParentScroll);
      if (scrollProximityRaf) cancelAnimationFrame(scrollProximityRaf);
    };
  });

  function getResizeThreshold(): number {
    // Fixed 6px to match the resize handle's visible zone in EventBlock
    // (resize handle has height: 11px, top: -5px, but overflow: hidden clips it to 6px inside)
    return 6;
  }

  function findNearbyBlockEdge(offsetX: number, offsetY: number, colWidth: number): { eventId: string; edge: "resize-top" | "resize-bottom" } | null {
    const hh = calZoom.hourHeight;
    const threshold = getResizeThreshold();

    // Blocks are positioned inside a container offset by railWidth + 4
    const eventAreaLeft = railWidth + 4;
    const eventAreaWidth = colWidth - eventAreaLeft;

    // First pass: find the block that strictly contains the mouse (standard bounding box)
    // At boundaries, blocks are [top, bottom) so only one block contains any given point
    for (const pos of effectivePositioned) {
      if (pos.event.id === "__create__") continue;
      if (panelOpen && pos.event.id !== editingId) continue;

      // Don't subtract gap for hit detection to avoid dead zones between stacked blocks
      const blockLeftPx = eventAreaLeft + (pos.left / 100) * eventAreaWidth;
      const blockRightPx = eventAreaLeft + ((pos.left + pos.width) / 100) * eventAreaWidth;
      if (offsetX < blockLeftPx || offsetX > blockRightPx) continue;

      const blockTopY = (pos.startMinute / 60) * hh;
      const blockBottomY = ((pos.startMinute + pos.durationMinutes) / 60) * hh;

      // Strict containment: [top, bottom)
      if (offsetY >= blockTopY && offsetY < blockBottomY) {
        // Mouse is inside this block. Check if near an edge.
        if (!pos.isClippedTop && Math.abs(offsetY - blockTopY) < threshold) {
          return { eventId: pos.event.id, edge: "resize-top" };
        }
        if (!pos.isClippedBottom && Math.abs(offsetY - blockBottomY) < threshold) {
          return { eventId: pos.event.id, edge: "resize-bottom" };
        }
        // Inside block but not near edge
        return null;
      }
    }

    // Mouse is not inside any block, allow event creation
    return null;
  }

  // Get resize edge for a specific block from click coordinates
  function getBlockEdgeFromClick(eventId: string, e: PointerEvent): "resize-top" | "resize-bottom" | undefined {
    if (!columnEl) return undefined;
    const colRect = columnEl.getBoundingClientRect();
    const colOffsetX = e.clientX - colRect.left;
    const colOffsetY = e.clientY - colRect.top;
    const nearby = findNearbyBlockEdge(colOffsetX, colOffsetY, colRect.width);
    if (nearby && nearby.eventId === eventId) {
      return nearby.edge;
    }
    return undefined;
  }

  function handleSlotPointerDown(e: PointerEvent, hour: number) {
    if (e.button !== 0) return;

    // Calculate position from actual click coordinates
    if (!columnEl) return;
    const colRect = columnEl.getBoundingClientRect();
    const colOffsetX = e.clientX - colRect.left;
    const colOffsetY = e.clientY - colRect.top;

    // Check proximity to existing block edges for resize
    const nearby = findNearbyBlockEdge(colOffsetX, colOffsetY, colRect.width);
    if (nearby) {
      onDragStart(nearby.eventId, e, nearby.edge);
      return;
    }

    // No event creation when panel is open
    if (panelOpen) return;

    // Calculate minute from actual click position
    const hh = calZoom.hourHeight;
    const rawMinute = (colOffsetY / hh) * 60;
    let minute = clampMinute(snapToGrid(rawMinute, calZoom.gridMinutes));

    // Snap to current time if close
    if (isToday && currentTimeMinute >= 0) {
      const currentTimeY = (currentTimeMinute / 60) * hh;
      if (Math.abs(colOffsetY - currentTimeY) < getResizeThreshold()) {
        minute = Math.floor(currentTimeMinute);
      }
    }

    onCreateStart(dateStr, minute, e);
  }

  function handleParentScroll() {
    if (lastClientY === null || !columnEl) return;
    if (calZoom.isAnimating) return;

    isScrolling = true;

    // Defer proximity check to next frame to avoid blocking scroll
    if (!scrollProximityRaf) {
      scrollProximityRaf = requestAnimationFrame(() => {
        scrollProximityRaf = 0;
        recheckProximity();
      });
    }
  }

  function handleColumnMouseMove(e: MouseEvent) {
    if (!columnEl) return;

    // Skip processing during zoom to prevent forced layout recalculations
    if (zoomModifierPressed || calZoom.isAnimating) {
      hoverResizeBlockId = null;
      return;
    }

    // Track mouse position for resize detection
    lastClientX = e.clientX;
    lastClientY = e.clientY;

    // Detect if mouse is near a block's resize edge
    const colRect = columnEl.getBoundingClientRect();
    const colOffsetX = e.clientX - colRect.left;
    const colOffsetY = e.clientY - colRect.top;
    const nearby = findNearbyBlockEdge(colOffsetX, colOffsetY, colRect.width);

    if (nearby) {
      // When panel is open, only show resize for edited event
      hoverResizeBlockId = (panelOpen && nearby.eventId !== editingId) ? null : nearby.eventId;
    } else {
      hoverResizeBlockId = null;
    }
  }

  function handleColumnMouseLeave() {
    lastClientX = null;
    lastClientY = null;
    hoverResizeBlockId = null;
    isScrolling = false;
  }

  function handleRailAreaPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !columnEl || draggingEventId || panelOpen) return;
    const colRect = columnEl.getBoundingClientRect();
    // Only handle clicks in the rail zone (left of columnEl)
    if (e.clientX >= colRect.left) return;
    const hh = calZoom.hourHeight;
    const offsetY = e.clientY - colRect.top;
    const rawMinute = (offsetY / hh) * 60;
    if (railSegments.some(seg => seg.start <= rawMinute && seg.end >= rawMinute)) return;
    let minute = clampMinute(snapToGrid(rawMinute, calZoom.gridMinutes));

    // Snap to current time if close (use floor to match displayed clock minute)
    if (isToday && currentTimeMinute >= 0) {
      const currentTimeY = (currentTimeMinute / 60) * hh;
      if (Math.abs(offsetY - currentTimeY) < getResizeThreshold()) {
        minute = Math.floor(currentTimeMinute);
      }
    }

    onCreateStart(dateStr, minute, e);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-day-column
  class="relative min-w-0 {zoomModifierPressed ? 'zoom-active' : hoverResizeBlockId !== null ? 'cursor-ns-resize' : panelOpen ? '' : 'cursor-crosshair'}"
  style="height: calc(24 * var(--hour-h) * 1px); contain: layout style;"
  onmousemove={handleColumnMouseMove}
  onmouseleave={handleColumnMouseLeave}
  onpointerdown={handleRailAreaPointerDown}
>
  <!-- Current time indicator (outside overflow-hidden so the circle can bleed left) -->
  {#if isToday && currentTimeMinute >= 0}
    <div
      class="pointer-events-none absolute left-0 right-0"
      style="top: calc({currentTimeMinute} / 60 * var(--hour-h) * 1px); z-index: 46;"
    >
      <div
        class="h-2.5 w-2.5 shrink-0 rounded-full absolute"
        style="background-color: var(--cal-current-time); left: -5px; top: -5px;"
      ></div>
      <div
        class="absolute left-0 right-0 h-[2.3px]"
        style="background-color: var(--cal-current-time); top: -1.15px;"
      ></div>
    </div>
  {/if}

  <!-- Hourly gridlines (23 solid lines, one at each hour boundary) -->
  {#each hours as hour}
    {#if hour < 23}
      <div
        class="pointer-events-none absolute left-0 right-0 z-[2]"
        style="top: calc({hour + 1} * var(--hour-h) * 1px); height: 0; border-bottom: 1px solid var(--cal-gridline);"
      ></div>
    {/if}
  {/each}

  <!-- Past time dimming overlay (full width, behind rail and content) -->
  {#if pastOverlayMinutes > 0}
    <div
      class="pointer-events-none absolute left-0 right-0 top-0 z-[1]"
      style="height: calc({pastOverlayMinutes} / 60 * var(--hour-h) * 1px); background-color: var(--cal-past-overlay);"
    ></div>
  {/if}

  <!-- Pomodoro timeline rails (one per contiguous group of pomodoro events) -->
  {#each railSegments as seg}
    <div
      class="pointer-events-none absolute z-[3] overflow-hidden"
      style="
        left: 2px;
        width: {railWidth}px;
        top: calc({seg.start} / 60 * var(--hour-h) * 1px);
        height: calc({seg.end - seg.start} / 60 * var(--hour-h) * 1px);
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
          "
        ></div>
      {/each}
      <!-- Break bands (on top of focus fills) -->
      {#each timelineBands.filter(b => b.phase !== "focus" && b.topMinute < seg.end && b.topMinute + b.heightMinutes > seg.start) as band}
        <div
          class="absolute left-0 right-0 {band.status === 'active' ? 'break-band-active' : ''}"
          style="
            top: {((band.topMinute - seg.start) / (seg.end - seg.start)) * 100}%;
            height: {Math.max((band.heightMinutes / (seg.end - seg.start)) * 100, 0.5)}%;
            background-color: var(--cal-timeline-break);
          "
        ></div>
      {/each}
    </div>
  {/each}

  <div
    bind:this={columnEl}
    class="absolute top-0 right-0 bottom-0 overflow-hidden"
    style="left: {railWidth + 4}px;"
  >
  <!-- Hour cells (click targets only, gridlines are in outer container) -->
  {#each hours as hour}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute w-full {draggingEventId ? 'pointer-events-none' : zoomModifierPressed ? '' : hoverResizeBlockId !== null ? 'cursor-ns-resize' : panelOpen ? '' : 'cursor-crosshair'}"
      style="top: calc({hour} * var(--hour-h) * 1px); height: calc(var(--hour-h) * 1px);"
      onpointerdown={(e) => handleSlotPointerDown(e, hour)}
    ></div>
  {/each}

  <!-- Events (use layout-aware positions that account for drag/create preview) -->
  {#each effectivePositioned as pos (pos.event.id)}
    <EventBlock
      positioned={pos}
      {isDark}
      editing={pos.event.id === editingId}
      preview={previewedIds?.has(pos.event.id) === true}
      grabbing={pos.event.id === grabbingId}
      canDrag={!panelOpen || pos.event.id === editingId}
      isPast={isPast || (isToday && currentTimeMinute >= 0 && effectiveMinuteRange(pos.event, dateStr).endMinute <= currentTimeMinute)}
      inResizeZone={hoverResizeBlockId === pos.event.id}
      onclick={(rect) => { if (!didDrag) onEventClick(pos.event, rect); }}
      onpointerdown={(e) => onDragStart(pos.event.id, e, getBlockEdgeFromClick(pos.event.id, e))}
    />
  {/each}

  <!-- Drag preview (replaces the original block at the target position, layout-aware) -->
  {#if dragPreview && layoutedPreview}
    {@const lp = layoutedPreview}
    {@const dragColor = dragPreview.event.color ? getEventColor(dragPreview.event.color, isDark) : null}
    {@const dragH = (lp.durationMinutes / 60) * calZoom.hourHeight}
    {@const dragHasRepeat = !!dragPreview.event.recurrence || !!dragPreview.event.recurringParentId}
    {@const dragHasNotification = !!dragPreview.event.notifications?.length}
    <div
      class="preview-outline pointer-events-none absolute flex overflow-hidden rounded text-[11px] leading-tight"
      style="
        top: calc({lp.startMinute} / 60 * var(--hour-h) * 1px);
        height: calc({lp.durationMinutes} / 60 * var(--hour-h) * 1px);
        left: {lp.left}%;
        width: {lp.totalColumns > 1 ? `calc(${lp.width}% - 2px)` : `${lp.width}%`};
        color: {dragColor?.text ?? getEventColor(undefined, isDark).text};
        z-index: 46;
      "
    >
      <div class="min-w-0 flex-1 px-1 py-0.5" style="background-color: {dragColor?.bg ?? getEventColor(undefined, isDark).bg};">
        {#if dragHasRepeat || dragHasNotification}
          <div class="absolute right-1 flex items-center gap-0.5" style="top: 5px;">
            {#if dragHasRepeat}
              <Repeat size={8} class="shrink-0 opacity-70" />
            {/if}
            {#if dragHasNotification}
              <Bell size={8} class="shrink-0 opacity-70" />
            {/if}
          </div>
        {/if}
        <div class="truncate font-medium" class:pr-5={dragHasRepeat || dragHasNotification}>
          {#if dragPreview.event.title}{dragPreview.event.title}{:else}<span class="opacity-50">(No title)</span>{/if}
        </div>
        {#if dragH > 28}
          {@const st = dragPreview.event.start.split(" ")[1] ?? ""}
          {@const et = dragPreview.event.end.split(" ")[1] ?? ""}
          <div class="truncate opacity-80">{st} - {et}</div>
        {/if}
        {#if dragH > 44 && dragPreview.event.location}
          <div class="truncate text-[9px] opacity-60">{dragPreview.event.location}</div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Create preview (new block being drawn, layout-aware) -->
  {#if createPreview && layoutedPreview}
    {@const lp = layoutedPreview}
    {@const createH = (lp.durationMinutes / 60) * calZoom.hourHeight}
    <div
      data-create-preview
      class="preview-outline pointer-events-none absolute flex overflow-hidden rounded text-[11px] leading-tight"
      style="
        top: calc({lp.startMinute} / 60 * var(--hour-h) * 1px);
        height: calc({lp.durationMinutes} / 60 * var(--hour-h) * 1px);
        left: {lp.left}%;
        width: {lp.totalColumns > 1 ? `calc(${lp.width}% - 2px)` : `${lp.width}%`};
        color: {getEventColor(undefined, isDark).text};
        z-index: 10;
      "
    >
      <div class="min-w-0 flex-1 px-1 py-0.5" style="background-color: {getEventColor(undefined, isDark).bg};">
        <div class="truncate font-medium">
          {#if createPreview.event.title}{createPreview.event.title}{:else}<span class="opacity-50">(No title)</span>{/if}
        </div>
        {#if createH > 28}
          {@const st = createPreview.event.start.split(" ")[1] ?? ""}
          {@const et = createPreview.event.end.split(" ")[1] ?? ""}
          <div class="truncate opacity-80">{st} - {et}</div>
        {/if}
      </div>
    </div>
  {/if}

  </div>

  </div>

<style>
  .preview-outline {
    position: relative;
    transition: left 120ms ease-out, width 120ms ease-out;
  }

  .preview-outline::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid rgba(0, 0, 0, 0.3);
    border-radius: inherit;
    pointer-events: none;
    z-index: 3;
  }

  :global(.dark) .preview-outline::after {
    border-color: rgba(255, 255, 255, 0.5);
  }

  .break-band-active {
    animation: break-pulse 1.5s ease-in-out infinite;
  }

  @keyframes break-pulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.9; }
  }

  .zoom-active,
  .zoom-active :global(*) {
    cursor: none !important;
  }
</style>
