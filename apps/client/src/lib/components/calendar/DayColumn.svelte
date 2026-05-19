<script lang="ts">
  import type { CalendarEvent, PositionedEvent, PersistedSegment } from "./types";
  import {
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
  import { dbUrl } from "$lib/api/db";
  import { mark as perfMark } from "$lib/stores/perflog.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import EventBlock from "./EventBlock.svelte";
  import { getEventIndicatorState } from "./event-indicators";
  import { CALENDAR_ZOOM_FRAME_EVENT, getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import { onMount } from "svelte";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Video from "@lucide/svelte/icons/video";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Users from "@lucide/svelte/icons/users";
  import {
    isThemeCalendarDark,
    type Theme,
  } from "$lib/stores/themes";

  let {
    date,
    events,
    theme,
    isToday = false,
    isPast = false,
    currentTimeMinute = -1,
    dragPreview = null,
    createPreview = null,
    onEventClick,
    onEventPrefetch,
    onDragStart,
    onCreateStart,
    editingId,
    previewedIds,
    draggingEventId,
    grabbingId,
    didDrag = false,
    visibleStartMinute = 0,
    visibleEndMinute = 1440,
  }: {
    date: Date;
    events: CalendarEvent[];
    theme: Theme;
    isToday?: boolean;
    isPast?: boolean;
    currentTimeMinute?: number;
    editingId?: string;
    previewedIds?: Set<string>;
    dragPreview?: PositionedEvent | null;
    createPreview?: PositionedEvent | null;
    draggingEventId?: string;
    grabbingId?: string;
    didDrag?: boolean;
    visibleStartMinute?: number;
    visibleEndMinute?: number;
    onEventClick: (event: CalendarEvent, rect?: DOMRect) => void;
    onEventPrefetch?: (event: CalendarEvent) => void;
    onDragStart: (eventId: string, e: PointerEvent, forceEdge?: "resize-top" | "resize-bottom") => void;
    onCreateStart: (dateStr: string, minute: number, e: PointerEvent) => void;
  } = $props();

  const isDark = $derived(isThemeCalendarDark(theme));

  const TIMED_RENDER_BUFFER_MINUTES = 1440;
  const panelOpen = $derived(!!editingId);

  const dateStr = $derived(formatDatePart(date));
  // `events` arrives pre-bucketed per day from CalendarView, so the only
  // remaining concern is to drop all-day rows which render in the banner.
  const dayEvents = $derived(events.filter((e) => !e.allDay));
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
  const renderedPositioned = $derived.by(() => {
    const minMinute = Math.max(0, visibleStartMinute - TIMED_RENDER_BUFFER_MINUTES);
    const maxMinute = Math.min(1440, visibleEndMinute + TIMED_RENDER_BUFFER_MINUTES);
    return effectivePositioned.filter((pos) => {
      if (pos.event.id === editingId || pos.event.id === grabbingId) return true;
      if (previewedIds?.has(pos.event.id) === true) return true;
      const start = pos.startMinute;
      const end = pos.startMinute + pos.durationMinutes;
      return end >= minMinute && start <= maxMinute;
    });
  });

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

  const visibleRailSegments = $derived.by(() => {
    const minMinute = Math.max(0, visibleStartMinute - TIMED_RENDER_BUFFER_MINUTES);
    const maxMinute = Math.min(1440, visibleEndMinute + TIMED_RENDER_BUFFER_MINUTES);
    return railSegments.filter((seg) => seg.end >= minMinute && seg.start <= maxMinute);
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
  // Snapshot key of the last fetch we kicked off. Plain `let`, not `$state`,
  // so reading or writing it does not participate in reactivity. The effect
  // still subscribes to its real deps (segmentVersion, positioned,
  // activeBlockId, draggingEventId), but parents that recreate `events`
  // every frame during a drag (CalendarView's displayResult re-runs on every
  // createPreview update) no longer cause hundreds of redundant SQL queries
  // per gesture. Both the segment version and the eventId set are checked,
  // so a real DB write or a real event-set change still triggers a refetch.
  let lastFetchKey = "";

  $effect(() => {
    const segVer = pomodoro.segmentVersion;
    const eventIds = positioned
      .filter((p) => p.event.pomodoroConfig && p.event.id !== pomodoro.activeBlockId && p.event.id !== draggingEventId)
      .map((p) => p.event.id)
      .sort();
    const queryEventIds = Array.from(new Set(
      eventIds.flatMap((id) => id.includes("::") ? [id, id.split("::")[0]] : [id]),
    )).sort();
    // Skip mark emission for the no-pomodoro path so a 1Hz effect on a column
    // with no pomodoro events does not flood the diagnostics ring buffer.
    if (eventIds.length === 0) {
      const emptyKey = `${segVer}|`;
      if (lastFetchKey === emptyKey) return;
      lastFetchKey = emptyKey;
      if (persistedSegmentsMap.size > 0) persistedSegmentsMap = new Map();
      return;
    }
    const fetchKey = `${segVer}|${eventIds.join(",")}`;
    if (fetchKey === lastFetchKey) return;
    lastFetchKey = fetchKey;
    const tStart = performance.now();
    perfMark("col.effect-start", { date: dateStr, eventCount: eventIds.length });
    const visibleIds = new Set(eventIds);
    invoke<DbSegmentRow[]>("pomodoro_load_segments_for_events", {
      dbUrl: dbUrl(),
      eventIds: queryEventIds,
    }).then((rows) => {
      const map = new Map<string, PersistedSegment[]>();
      for (const r of rows) {
        const virtualId = `${r.event_id}::${r.event_date}`;
        const mapKey = visibleIds.has(r.event_id)
          ? r.event_id
          : visibleIds.has(virtualId)
            ? virtualId
            : r.event_id;
        const seg: PersistedSegment = {
          id: r.id,
          eventId: mapKey,
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
        const arr = map.get(mapKey) ?? [];
        arr.push(seg);
        map.set(mapKey, arr);
      }
      persistedSegmentsMap = map;
      perfMark("col.effect-done", {
        date: dateStr,
        ms: Math.round((performance.now() - tStart) * 10) / 10,
        rows: rows.length,
      });
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
  let lastClientX: number | null = null;
  let lastClientY: number | null = null;
  let scrollProximityRaf = 0;
  // Track when mouse is near a block's resize edge (top or bottom)
  let hoverResizeBlockId: string | null = $state(null);

  $effect(() => {
    if (dragPreview || createPreview) {
      hoverResizeBlockId = null;
    }
  });

  // Re-check resize proximity when block layout changes (e.g. new block saved)
  $effect(() => {
    void renderedPositioned;
    if (lastClientX === null || lastClientY === null || !columnEl) return;
    recheckProximity();
  });

  function recheckProximity() {
    if (!columnEl || lastClientX === null || lastClientY === null) return;
    updateHoverStateFromClientPoint(lastClientX, lastClientY);
  }

  onMount(() => {
    function clearMouseState() {
      clearHoverTracking();
    }
    function handleVisibilityChange() {
      if (document.hidden) clearMouseState();
    }
    window.addEventListener("blur", clearMouseState);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Track scroll for resize detection during scroll
    const sp = columnEl?.closest(".hide-scrollbar") as HTMLElement | null;
    if (sp) {
      sp.addEventListener("scroll", handleParentScroll);
      sp.addEventListener(CALENDAR_ZOOM_FRAME_EVENT, handleZoomFrame);
    }

    return () => {
      window.removeEventListener("blur", clearMouseState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      sp?.removeEventListener("scroll", handleParentScroll);
      sp?.removeEventListener(CALENDAR_ZOOM_FRAME_EVENT, handleZoomFrame);
      if (scrollProximityRaf) cancelAnimationFrame(scrollProximityRaf);
    };
  });

  function clearHoverTracking() {
    const hasTracking = lastClientX !== null
      || lastClientY !== null
      || hoverResizeBlockId !== null
      || scrollProximityRaf !== 0;

    if (!hasTracking) return;

    lastClientX = null;
    lastClientY = null;
    if (scrollProximityRaf) {
      cancelAnimationFrame(scrollProximityRaf);
      scrollProximityRaf = 0;
    }
    hoverResizeBlockId = null;
  }

  function isTimedColumnSurface(target: EventTarget | null): boolean {
    return target instanceof Element
      && target.closest("[data-day-column], [data-day-column-shell]") !== null;
  }

  function getResizeThreshold(): number {
    // Fixed 6px to match the resize handle's visible zone in EventBlock
    // (resize handle has height: 11px, top: -5px, but overflow: hidden clips it to 6px inside)
    return 6;
  }

  function getRenderedHourHeight(): number {
    const scrollContainer = columnEl?.closest(".hide-scrollbar") as HTMLElement | null;
    const raw = scrollContainer?.style.getPropertyValue("--hour-h") ?? "";
    const rendered = raw ? parseFloat(raw) : Number.NaN;
    return Number.isFinite(rendered) && rendered > 0 ? rendered : calZoom.hourHeight;
  }

  type BlockHit =
    | { kind: "edge"; eventId: string; edge: "resize-top" | "resize-bottom" }
    | { kind: "body"; eventId: string };

  function findBlockHit(offsetX: number, offsetY: number, colWidth: number): BlockHit | null {
    const hh = getRenderedHourHeight();
    const threshold = getResizeThreshold();

    // Blocks are positioned inside a container offset by railWidth + 4
    const eventAreaLeft = railWidth + 4;
    const eventAreaWidth = colWidth - eventAreaLeft;

    // First pass: find the block that strictly contains the mouse (standard bounding box)
    // At boundaries, blocks are [top, bottom) so only one block contains any given point
    for (const pos of renderedPositioned) {
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
          return { kind: "edge", eventId: pos.event.id, edge: "resize-top" };
        }
        if (!pos.isClippedBottom && Math.abs(offsetY - blockBottomY) < threshold) {
          return { kind: "edge", eventId: pos.event.id, edge: "resize-bottom" };
        }
        // Inside block but not near edge
        return { kind: "body", eventId: pos.event.id };
      }
    }

    // Mouse is not inside any block, allow event creation
    return null;
  }

  function findNearbyBlockEdge(offsetX: number, offsetY: number, colWidth: number): { eventId: string; edge: "resize-top" | "resize-bottom" } | null {
    const hit = findBlockHit(offsetX, offsetY, colWidth);
    return hit?.kind === "edge" ? { eventId: hit.eventId, edge: hit.edge } : null;
  }

  function getCreateMinuteFromOffset(offsetY: number): number {
    const hh = getRenderedHourHeight();
    const rawMinute = (offsetY / hh) * 60;
    let minute = clampMinute(snapToGrid(rawMinute, calZoom.gridMinutes));

    if (isToday && currentTimeMinute >= 0) {
      const currentTimeY = (currentTimeMinute / 60) * hh;
      if (Math.abs(offsetY - currentTimeY) < getResizeThreshold()) {
        minute = Math.floor(currentTimeMinute);
      }
    }

    return minute;
  }

  function updateHoverStateFromClientPoint(
    clientX: number,
    clientY: number,
  ) {
    if (!columnEl) return;

    const colRect = columnEl.getBoundingClientRect();
    const colOffsetX = clientX - colRect.left;
    const colOffsetY = clientY - colRect.top;
    const hit = findBlockHit(colOffsetX, colOffsetY, colRect.width);

    if (hit?.kind === "edge") {
      hoverResizeBlockId = (panelOpen && hit.eventId !== editingId) ? null : hit.eventId;
    } else {
      hoverResizeBlockId = null;
    }
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

  function handleColumnAreaPointerDown(e: PointerEvent) {
    if (e.button !== 0 || draggingEventId) return;

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
    const minute = getCreateMinuteFromOffset(colOffsetY);

    onCreateStart(dateStr, minute, e);
  }

  function handleParentScroll() {
    if (lastClientY === null || !columnEl) return;
    if (calZoom.isAnimating) return;

    if (!scrollProximityRaf) {
      scrollProximityRaf = requestAnimationFrame(() => {
        scrollProximityRaf = 0;
        if (lastClientX !== null && lastClientY !== null) {
          updateHoverStateFromClientPoint(lastClientX, lastClientY);
        }
      });
    }
  }

  function handleZoomFrame() {
    if (lastClientX === null || lastClientY === null || !columnEl) return;
    updateHoverStateFromClientPoint(lastClientX, lastClientY);
  }

  function handleColumnMouseMove(e: MouseEvent) {
    if (!columnEl) return;

    lastClientX = e.clientX;
    lastClientY = e.clientY;
    updateHoverStateFromClientPoint(e.clientX, e.clientY);
  }

  function handleColumnMouseLeave(e: MouseEvent) {
    if (calZoom.isAnimating) return;
    const enteringTimedSurface = isTimedColumnSurface(e.relatedTarget);
    if (!enteringTimedSurface) clearHoverTracking();
  }

  function handleRailAreaPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !columnEl || draggingEventId || panelOpen) return;
    const colRect = columnEl.getBoundingClientRect();
    // Only handle clicks in the rail zone (left of columnEl)
    if (e.clientX >= colRect.left) return;
    const offsetY = e.clientY - colRect.top;
    const rawMinute = (offsetY / getRenderedHourHeight()) * 60;
    if (visibleRailSegments.some(seg => seg.start <= rawMinute && seg.end >= rawMinute)) return;
    const minute = getCreateMinuteFromOffset(offsetY);

    onCreateStart(dateStr, minute, e);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-day-column
  class="relative z-2 min-w-0 {hoverResizeBlockId !== null ? 'cursor-ns-resize' : 'cursor-default'}"
  style="
    height: calc(24 * var(--hour-h) * 1px);
    contain: layout style;
  "
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

  <!-- Pomodoro timeline rails (one per contiguous group of pomodoro events) -->
  {#each visibleRailSegments as seg}
    <div
      class="pointer-events-none absolute z-3 overflow-hidden"
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
    class="absolute top-0 right-0 bottom-0 {draggingEventId ? 'pointer-events-none' : hoverResizeBlockId !== null ? 'cursor-ns-resize' : 'cursor-default'}"
    style="left: {railWidth + 4}px;"
    onpointerdown={handleColumnAreaPointerDown}
  >
  <!-- Events (use layout-aware positions that account for drag/create preview) -->
  {#each renderedPositioned as pos (pos.event.id)}
    <EventBlock
      positioned={pos}
      {theme}
      editing={pos.event.id === editingId}
      preview={previewedIds?.has(pos.event.id) === true}
      grabbing={pos.event.id === grabbingId}
      canDrag={!panelOpen || pos.event.id === editingId}
      isPast={isPast || (isToday && currentTimeMinute >= 0 && effectiveMinuteRange(pos.event, dateStr).endMinute <= currentTimeMinute)}
      inResizeZone={hoverResizeBlockId === pos.event.id}
      onclick={(rect) => { if (!didDrag) onEventClick(pos.event, rect); }}
      onprefetch={() => onEventPrefetch?.(pos.event)}
      onpointerdown={(e) => onDragStart(pos.event.id, e, getBlockEdgeFromClick(pos.event.id, e))}
    />
  {/each}

  <!-- Drag preview (replaces the original block at the target position, layout-aware) -->
  {#if dragPreview && layoutedPreview}
    {@const lp = layoutedPreview}
    {@const dragBase = getEventColor(dragPreview.event.color, theme)}
    {@const dragIconColor = `color-mix(in srgb, ${dragBase.text} 70%, ${dragBase.bg})`}
    {@const dragTimeColor = `color-mix(in srgb, ${dragBase.text} 80%, ${dragBase.bg})`}
    {@const dragLocationColor = `color-mix(in srgb, ${dragBase.text} 60%, ${dragBase.bg})`}
    {@const dragH = (lp.durationMinutes / 60) * calZoom.hourHeight}
    {@const dragIndicators = getEventIndicatorState(dragPreview.event)}
    <div
      class="preview-outline pointer-events-none absolute flex overflow-hidden rounded text-[0.8rem] leading-tight"
      style="
        top: calc({lp.startMinute} / 60 * var(--hour-h) * 1px);
        height: calc({lp.durationMinutes} / 60 * var(--hour-h) * 1px);
        left: {lp.left}%;
        width: {lp.totalColumns > 1 ? `calc(${lp.width}% - 2px)` : `${lp.width}%`};
        color: {dragBase.text};
        --event-bg: {dragBase.bg};
        --outline-mix: {isDark ? 'white' : 'black'};
        z-index: 46;
      "
    >
      <div class="min-w-0 flex-1 px-1 py-0.5" style="background-color: {dragBase.bg};">
        {#if dragIndicators.iconCount > 0}
          <div class="absolute right-1 flex items-center gap-0.5" style="top: 5px; color: {dragIconColor};">
            {#if dragIndicators.hasRepeat}
              <Repeat size={9} class="shrink-0" />
            {/if}
            {#if dragIndicators.hasCallLink}
              <Video size={9} class="shrink-0" />
            {/if}
            {#if dragIndicators.hasLocation}
              <MapPin size={9} class="shrink-0" />
            {/if}
            {#if dragIndicators.hasGenericMeeting}
              <Users size={9} class="shrink-0" />
            {/if}
          </div>
        {/if}
        <div
          class="truncate font-medium"
          class:pr-5={dragIndicators.iconCount > 0 && dragIndicators.iconCount <= 2}
          class:pr-8={dragIndicators.iconCount > 2}
        >
          {#if dragPreview.event.title}{dragPreview.event.title}{:else}(No title){/if}
        </div>
        {#if dragH > 32}
          {@const st = dragPreview.event.start.split(" ")[1] ?? ""}
          {@const et = dragPreview.event.end.split(" ")[1] ?? ""}
          <div class="truncate" style="color: {dragTimeColor};">{st} - {et}</div>
        {/if}
        {#if dragH > 48 && dragPreview.event.location}
          <div class="truncate text-[0.666667rem]" style="color: {dragLocationColor};">{dragPreview.event.location}</div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Create preview (new block being drawn, layout-aware) -->
  {#if createPreview && layoutedPreview}
    {@const lp = layoutedPreview}
    {@const createBase = getEventColor(undefined, theme)}
    {@const createTimeColor = `color-mix(in srgb, ${createBase.text} 80%, ${createBase.bg})`}
    {@const createH = (lp.durationMinutes / 60) * calZoom.hourHeight}
    <div
      data-create-preview
      class="preview-outline pointer-events-none absolute flex overflow-hidden rounded text-[0.8rem] leading-tight"
      style="
        top: calc({lp.startMinute} / 60 * var(--hour-h) * 1px);
        height: calc({lp.durationMinutes} / 60 * var(--hour-h) * 1px);
        left: {lp.left}%;
        width: {lp.totalColumns > 1 ? `calc(${lp.width}% - 2px)` : `${lp.width}%`};
        color: {createBase.text};
        --event-bg: {createBase.bg};
        --outline-mix: {isDark ? 'white' : 'black'};
        z-index: 10;
      "
    >
      <div class="min-w-0 flex-1 px-1 py-0.5" style="background-color: {createBase.bg};">
        <div class="truncate font-medium">
          {#if createPreview.event.title}{createPreview.event.title}{:else}(No title){/if}
        </div>
        {#if createH > 32}
          {@const st = createPreview.event.start.split(" ")[1] ?? ""}
          {@const et = createPreview.event.end.split(" ")[1] ?? ""}
          <div class="truncate" style="color: {createTimeColor};">{st} - {et}</div>
        {/if}
      </div>
    </div>
  {/if}

  </div>

  </div>

<style>
  .preview-outline {
    position: relative;
    outline: 2px solid color-mix(in oklab, var(--event-bg) 65%, var(--outline-mix));
    outline-offset: 0;
    transition: left 120ms ease-out, width 120ms ease-out;
  }

  .break-band-active {
    animation: break-pulse 1.5s ease-in-out infinite;
  }

  @keyframes break-pulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.9; }
  }

</style>
