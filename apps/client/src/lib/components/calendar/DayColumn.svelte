<script lang="ts">
  import type { CalendarEvent, PositionedEvent, PersistedSegment, SnapLineState } from "./types";
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
    hideSnapLine = false,
    snapOverrideMinute = null,
    onEventClick,
    onDragStart,
    onCreateStart,
    onSnapChange,
    editingId,
    previewedIds,
    draggingEventId,
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
    hideSnapLine?: boolean;
    snapOverrideMinute?: number | null;
    draggingEventId?: string;
    onEventClick: (event: CalendarEvent, rect?: DOMRect) => void;
    onDragStart: (eventId: string, e: PointerEvent, forceEdge?: "resize-top" | "resize-bottom") => void;
    onCreateStart: (dateStr: string, minute: number, e: PointerEvent) => void;
    onSnapChange?: (state: SnapLineState | null) => void;
  } = $props();

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

  let snapMinute: number | null = $state(null);
  let snapTimeLabel: string = $state("");
  const snapLineY = $derived(snapMinute !== null ? (snapMinute / 60) * calZoom.hourHeight : null);
  let columnEl: HTMLDivElement | undefined = $state();
  let scrollParent: HTMLElement | null = null;
  let stickyBottom = $state(0);
  let lastClientX: number | null = $state(null);
  let lastClientY: number | null = $state(null);
  let scrollSnapTimer = 0;

  // Clear snap position when dragging starts (keeps mouse coords for restore)
  $effect(() => {
    if (hideSnapLine) {
      snapMinute = null;
    }
  });

  // Restore snap position and re-check proximity when drag/create ends
  $effect(() => {
    if (hideSnapLine) return;
    if (lastClientY === null || !columnEl || calZoom.isAnimating) return;
    updateSnapFromClientY(lastClientY, true);
    recheckProximity();
  });

  // Re-check proximity when block layout changes (e.g. new block saved)
  $effect(() => {
    void effectivePositioned;
    if (hideSnapLine || lastClientX === null || lastClientY === null || !columnEl) return;
    recheckProximity();
  });

  function recheckProximity() {
    if (!columnEl || lastClientX === null || lastClientY === null) return;
    const colRect = columnEl.getBoundingClientRect();
    const colOffsetX = lastClientX - colRect.left;
    const colOffsetY = lastClientY - colRect.top;
    const nearby = findNearbyBlockEdge(colOffsetX, colOffsetY, colRect.width);
    hoverResizeBlockId = nearby?.eventId ?? null;
  }

  onMount(() => {
    function clearSnap() {
      snapMinute = null;
      lastClientX = null;
      lastClientY = null;
    }
    window.addEventListener("blur", clearSnap);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clearSnap();
    });
    // Clear snap line when break overlay closes (GTK overlay steals WebView focus)
    document.addEventListener("ganbaruai-clear-snap", clearSnap);

    // Track scroll so snap line follows the mouse during scroll
    const sp = columnEl?.closest('.hide-scrollbar') as HTMLElement | null;
    if (sp) {
      scrollParent = sp;
      sp.addEventListener('scroll', handleParentScroll);
    }

    return () => {
      window.removeEventListener("blur", clearSnap);
      document.removeEventListener("ganbaruai-clear-snap", clearSnap);
      sp?.removeEventListener('scroll', handleParentScroll);
    };
  });

  function updateStickyBottom() {
    if (!columnEl) return;
    if (!scrollParent) scrollParent = columnEl.closest('.hide-scrollbar') as HTMLElement | null;
    if (scrollParent) {
      let bottom = scrollParent.getBoundingClientRect().top;
      for (const h of scrollParent.querySelectorAll(':scope .sticky')) {
        bottom = Math.max(bottom, h.getBoundingClientRect().bottom);
      }
      stickyBottom = bottom;
    }
  }

  const effectiveSnapY = $derived(
    snapOverrideMinute != null
      ? (snapOverrideMinute / 60) * calZoom.hourHeight
      : snapLineY,
  );
  const effectiveSnapLabel = $derived(
    snapOverrideMinute != null
      ? `${String(Math.floor(snapOverrideMinute / 60)).padStart(2, "0")}:${String(snapOverrideMinute % 60).padStart(2, "0")}`
      : snapTimeLabel,
  );
  const snapVisible = $derived(effectiveSnapY !== null && !hideSnapLine && !calZoom.isAnimating);
  const snapEffectiveMin = $derived(snapOverrideMinute ?? snapMinute ?? 0);
  const snapAtBottom = $derived(snapEffectiveMin >= 1440 - (2 / calZoom.hourHeight * 60));

  // Snap line matches block bounds during create/drag or resize-handle hover
  let hoverResizeBlockId: string | null = $state(null);
  const proximityResize = $derived(hoverResizeBlockId !== null);
  const hoverResizeLayout = $derived(
    hoverResizeBlockId ? effectivePositioned.find(p => p.event.id === hoverResizeBlockId) ?? null : null,
  );
  const activeBlockLayout = $derived(
    (layoutedPreview && (createPreview || dragPreview)) ? layoutedPreview : hoverResizeLayout,
  );
  const snapToBlock = $derived(!!activeBlockLayout);
  const snapBlockLeft = $derived(snapToBlock ? activeBlockLayout!.left : 0);
  const snapBlockWidth = $derived(snapToBlock ? activeBlockLayout!.width : 100);
  const snapBlockMultiCol = $derived(snapToBlock && activeBlockLayout!.totalColumns > 1);

  // Keep stickyBottom fresh when snap override changes (drag/resize)
  $effect(() => {
    if (snapOverrideMinute != null) updateStickyBottom();
  });

  // Flip label below line when it would be hidden behind the sticky header
  const snapLabelBelow = $derived.by(() => {
    if (effectiveSnapY === null || !columnEl) return false;
    const colRect = columnEl.getBoundingClientRect();
    const lineViewportY = colRect.top + effectiveSnapY;
    return lineViewportY < stickyBottom + 18;
  });

  // Report snap state to parent when onSnapChange is provided
  $effect(() => {
    if (!onSnapChange) return;
    if (snapVisible) {
      onSnapChange({
        minute: snapEffectiveMin,
        label: effectiveSnapLabel,
        labelBelow: snapLabelBelow,
        atBottom: snapAtBottom,
        leftInsetPx: snapToBlock ? railWidth + 4 : 0,
        blockLeft: snapBlockLeft,
        blockWidth: snapBlockWidth,
        blockMultiCol: snapBlockMultiCol,
      });
    } else {
      onSnapChange(null);
    }
  });

  function getResizeThreshold(hourHeight: number): number {
    // Linear interpolation: 3px at 30px/hour to 12px at 200px/hour
    return Math.round(3 + ((hourHeight - 30) / (200 - 30)) * 9);
  }

  function findNearbyBlockEdge(offsetX: number, offsetY: number, colWidth: number): { eventId: string; edge: "resize-top" | "resize-bottom" } | null {
    const hh = calZoom.hourHeight;
    const threshold = getResizeThreshold(hh);
    let best: { eventId: string; edge: "resize-top" | "resize-bottom"; dist: number } | null = null;

    for (const pos of effectivePositioned) {
      // Skip blocks whose horizontal range doesn't contain the cursor
      const blockLeftPx = (pos.left / 100) * colWidth;
      const blockRightPx = ((pos.left + pos.width) / 100) * colWidth - (pos.totalColumns > 1 ? 2 : 0);
      if (offsetX < blockLeftPx || offsetX > blockRightPx) continue;

      const blockTopY = (pos.startMinute / 60) * hh;
      const blockBottomY = ((pos.startMinute + pos.durationMinutes) / 60) * hh;

      // Check proximity from both sides of each edge (outside and inside the block)
      if (!pos.isClippedTop) {
        const absDist = Math.abs(offsetY - blockTopY);
        if (absDist <= threshold && (!best || absDist < best.dist)) {
          best = { eventId: pos.event.id, edge: "resize-top", dist: absDist };
        }
      }

      if (!pos.isClippedBottom) {
        const absDist = Math.abs(offsetY - blockBottomY);
        if (absDist <= threshold && (!best || absDist < best.dist)) {
          best = { eventId: pos.event.id, edge: "resize-bottom", dist: absDist };
        }
      }
    }

    return best ? { eventId: best.eventId, edge: best.edge } : null;
  }

  function handleSlotPointerDown(e: PointerEvent, hour: number) {
    if (e.button !== 0) return;

    // Check proximity to existing block edges before creating
    if (columnEl) {
      const colRect = columnEl.getBoundingClientRect();
      const colOffsetX = e.clientX - colRect.left;
      const colOffsetY = e.clientY - colRect.top;
      const nearby = findNearbyBlockEdge(colOffsetX, colOffsetY, colRect.width);
      if (nearby) {
        onDragStart(nearby.eventId, e, nearby.edge);
        return;
      }
    }

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minuteWithinHour = snapToGrid((offsetY / calZoom.hourHeight) * 60, calZoom.gridMinutes);
    const minute = clampMinute(hour * 60 + minuteWithinHour);
    onCreateStart(dateStr, minute, e);
  }

  function updateSnapFromClientY(clientY: number, snap: boolean) {
    if (!columnEl) return;
    const hh = calZoom.hourHeight;
    const rect = columnEl.getBoundingClientRect();
    const offsetY = clientY - rect.top;
    const rawMinute = (offsetY / hh) * 60;
    let snapped = clampMinute(snapToGrid(rawMinute, calZoom.gridMinutes));

    if (snap) {
      // Snap to block edges when cursor is near them
      for (const pos of effectivePositioned) {
        const blockTop = (pos.startMinute / 60) * hh;
        const blockBottom = ((pos.startMinute + pos.durationMinutes) / 60) * hh;

        if (Math.abs(offsetY - blockTop) < 8) {
          snapped = pos.startMinute;
          break;
        }
        if (Math.abs(offsetY - blockBottom) < 8) {
          const { endMinute } = effectiveMinuteRange(pos.event, dateStr);
          snapped = endMinute;
          break;
        }
      }
      snapMinute = snapped;
    } else {
      const clamped = clampMinute(Math.round(rawMinute));
      snapMinute = clamped;
    }

    updateStickyBottom();
    const h = String(Math.floor(snapped / 60)).padStart(2, "0");
    const m = String(snapped % 60).padStart(2, "0");
    snapTimeLabel = `${h}:${m}`;
  }

  function handleParentScroll() {
    if (lastClientY === null || !columnEl || hideSnapLine) return;
    // During zoom animation, snapLineY auto-tracks via $derived; skip recalculation
    if (calZoom.isAnimating) return;
    updateSnapFromClientY(lastClientY, false);
    clearTimeout(scrollSnapTimer);
    scrollSnapTimer = window.setTimeout(() => {
      if (lastClientY !== null) updateSnapFromClientY(lastClientY, true);
    }, 60);
  }

  function handleColumnMouseMove(e: MouseEvent) {
    if (!columnEl) return;

    // Always track mouse position and proximity (even during drag/create)
    lastClientX = e.clientX;
    lastClientY = e.clientY;

    const target = e.target as HTMLElement;
    const resizeHandle = target.closest('.resize-handle-top, .resize-handle-bottom');
    if (resizeHandle) {
      const blockWrapper = resizeHandle.closest('[data-event-id]');
      hoverResizeBlockId = blockWrapper?.getAttribute('data-event-id') ?? null;
    } else {
      const colRect = columnEl.getBoundingClientRect();
      const colOffsetX = e.clientX - colRect.left;
      const colOffsetY = e.clientY - colRect.top;
      const nearby = findNearbyBlockEdge(colOffsetX, colOffsetY, colRect.width);
      hoverResizeBlockId = nearby?.eventId ?? null;
    }

    // Only update snap position when not hidden by drag/create
    if (hideSnapLine) return;
    if (calZoom.isAnimating) {
      snapMinute = null;
      return;
    }
    updateSnapFromClientY(e.clientY, true);
  }

  function handleColumnMouseLeave() {
    lastClientX = null;
    lastClientY = null;
    snapMinute = null;
    hoverResizeBlockId = null;
  }

  function handleRailAreaPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !columnEl || draggingEventId) return;
    const colRect = columnEl.getBoundingClientRect();
    // Only handle clicks in the rail zone (left of columnEl)
    if (e.clientX >= colRect.left) return;
    const hh = calZoom.hourHeight;
    const offsetY = e.clientY - colRect.top;
    const rawMinute = (offsetY / hh) * 60;
    if (railSegments.some(seg => seg.start <= rawMinute && seg.end >= rawMinute)) return;
    const minute = clampMinute(snapToGrid(rawMinute, calZoom.gridMinutes));
    onCreateStart(dateStr, minute, e);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-day-column
  class="relative min-w-0 {proximityResize ? 'cursor-ns-resize' : 'cursor-crosshair'}"
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
        class="absolute left-0 right-0 h-[2px]"
        style="background-color: var(--cal-current-time); top: -1px;"
      ></div>
    </div>
  {/if}

  <!-- Hourly gridlines (23 solid lines, one at each hour boundary) -->
  {#each hours as hour}
    {#if hour < 23}
      <div
        class="pointer-events-none absolute left-0 right-0"
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
      class="pointer-events-none absolute z-[2] overflow-hidden"
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
            opacity: 0.85;
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
            opacity: {band.status === 'planned' ? 0.6 : band.status === 'skipped' ? 0.3 : band.status === 'completed' ? 0.35 : 0.9};
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
      class="absolute w-full {draggingEventId ? 'pointer-events-none' : proximityResize ? 'cursor-ns-resize' : 'cursor-crosshair'}"
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
      isPast={isPast || (isToday && currentTimeMinute >= 0 && effectiveMinuteRange(pos.event, dateStr).endMinute <= currentTimeMinute)}
      onclick={(rect) => onEventClick(pos.event, rect)}
      onpointerdown={(e) => onDragStart(pos.event.id, e)}
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
    {@const glowColor = isDark ? 'rgba(130, 160, 220, 0.3)' : 'rgba(0, 30, 80, 0.2)'}
    {@const createH = (lp.durationMinutes / 60) * calZoom.hourHeight}
    <div
      data-create-preview
      class="preview-glow pointer-events-none absolute flex overflow-hidden rounded text-[11px] leading-tight"
      style="
        top: calc({lp.startMinute} / 60 * var(--hour-h) * 1px);
        height: calc({lp.durationMinutes} / 60 * var(--hour-h) * 1px);
        left: {lp.left}%;
        width: {lp.totalColumns > 1 ? `calc(${lp.width}% - 2px)` : `${lp.width}%`};
        color: {getEventColor(undefined, isDark).text};
        z-index: 10;
        --glow-color: {glowColor};
        box-shadow: 0 0 3px 0 var(--glow-color), 0 0 8px 1px var(--glow-color), 0 0 16px 2px color-mix(in srgb, var(--glow-color) 40%, transparent);
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

  <!-- Snap position indicator line with time label (only rendered when parent does not handle it) -->
  {#if !onSnapChange}
  <div
    class="pointer-events-none absolute right-0"
    style="left: {snapToBlock ? railWidth + 4 : 0}px; top: calc({snapEffectiveMin} / 60 * var(--hour-h) * 1px - {snapAtBottom ? 2.3 : 1.3}px); z-index: 47; {snapVisible ? '' : 'display: none;'}"
  >
    <div class="relative" style="margin-left: {snapBlockLeft}%; width: {snapBlockMultiCol ? `calc(${snapBlockWidth}% - 2px)` : `${snapBlockWidth}%`};">
      <span
        class="absolute left-0 flex h-[16px] items-center justify-center px-1.5 text-[10px] leading-none font-semibold {snapLabelBelow ? 'top-[2.3px]' : 'bottom-0'}"
        style="background-color: var(--cal-snap-label); color: white; border-radius: {snapLabelBelow ? '0 0 2px 2px' : '2px 2px 0 0'};"
      ><span style="margin-left: -0.5px;">{effectiveSnapLabel}</span></span>
      <div
        class="h-[2.3px]"
        style="background-color: var(--cal-snap-label);"
      ></div>
    </div>
  </div>
  {/if}
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
    border: 1.5px solid currentColor;
    border-radius: inherit;
    pointer-events: none;
    z-index: 3;
  }

  .preview-glow {
    position: relative;
    transition: left 120ms ease-out, width 120ms ease-out;
  }

  .preview-glow::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    border-radius: inherit;
    pointer-events: none;
    z-index: 3;
  }

  .break-band-active {
    animation: break-pulse 1.5s ease-in-out infinite;
  }

  @keyframes break-pulse {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 0.9; }
  }
</style>
