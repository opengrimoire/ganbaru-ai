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
    onDragStart: (eventId: string, e: PointerEvent) => void;
    onCreateStart: (dateStr: string, minute: number, e: PointerEvent) => void;
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

  /** Does the grid line at `minute` fall within any rail segment? */
  function isMinuteInRail(minute: number): boolean {
    return railSegments.some(seg => seg.start <= minute && seg.end >= minute);
  }

  const subHourOffsets = $derived.by(() => {
    const gm = calZoom.gridMinutes;
    const spacing = (gm / 60) * calZoom.hourHeight;
    if (spacing < 8) return [];
    const offsets: number[] = [];
    for (let m = gm; m < 60; m += gm) {
      offsets.push(m);
    }
    return offsets;
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

    const pomodoroEvents = positioned
      .filter((p) => p.event.pomodoroConfig && !(draggingEventId && p.event.id === draggingEventId))
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
  let lastClientY: number | null = $state(null);

  // Clear snap line when dragging starts (prevents stale flash)
  $effect(() => {
    if (hideSnapLine) {
      snapMinute = null;
      lastClientY = null;
    }
  });

  onMount(() => {
    function clearSnap() {
      snapMinute = null;
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

  function handleSlotPointerDown(e: PointerEvent, hour: number) {
    if (e.button !== 0) return;
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
  }

  function handleColumnMouseMove(e: MouseEvent) {
    if (!columnEl || hideSnapLine) return;
    if (calZoom.isAnimating) {
      snapMinute = null;
      return;
    }
    lastClientY = e.clientY;
    updateSnapFromClientY(e.clientY, true);
  }

  function handleColumnMouseLeave() {
    lastClientY = null;
    snapMinute = null;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-day-column
  class="relative min-w-0"
  style="height: calc(24 * var(--hour-h) * 1px);"
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

  <!-- Gridlines (offset only where a rail segment covers that line) -->
  {#each hours as hour}
    {#if hour < 23}
      <div
        class="pointer-events-none absolute right-0"
        style="left: {isMinuteInRail((hour + 1) * 60) ? railWidth + 4 : 0}px; top: calc({hour} * var(--hour-h) * 1px); height: calc(var(--hour-h) * 1px); border-bottom: 1px solid var(--cal-gridline);"
      ></div>
    {/if}
    {#each subHourOffsets as subMinute}
      <div
        class="pointer-events-none absolute right-0"
        style="left: {isMinuteInRail(hour * 60 + subMinute) ? railWidth + 4 : 0}px; top: calc({hour * 60 + subMinute} / 60 * var(--hour-h) * 1px); height: 0; border-bottom: 1px dashed var(--cal-gridline); opacity: 0.4;"
      ></div>
    {/each}
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
    style="left: {railWidth + 4}px;"
    onmousemove={handleColumnMouseMove}
    onmouseleave={handleColumnMouseLeave}
  >
  <!-- Hour cells (click targets only, gridlines are in outer container) -->
  {#each hours as hour}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute w-full {draggingEventId ? 'pointer-events-none' : 'cursor-crosshair'}"
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

  <!-- Snap position indicator line with time label — always on top -->
  {#if effectiveSnapY !== null && !hideSnapLine}
    {@const effectiveMin = snapOverrideMinute ?? snapMinute ?? 0}
    {@const atBottom = effectiveMin >= 1440 - (2 / calZoom.hourHeight * 60)}
    <div
      class="pointer-events-none absolute left-0 right-0"
      style="top: calc({effectiveMin} / 60 * var(--hour-h) * 1px - {atBottom ? 2 : 0}px); z-index: 47;"
    >
      <div class="relative">
        <span
          class="absolute left-0 px-1.5 py-[1px] text-[10px] font-medium leading-tight {snapLabelBelow ? 'top-0 rounded-b' : 'bottom-0 rounded-t'}"
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
