<script lang="ts">
  import type { CalendarEvent, PositionedEvent, AccentBarBand } from "./types";
  import {
    eventsForDay,
    layoutEventsForDay,
    effectiveMinuteRange,
    formatDatePart,
    minuteOfDay,
    parseCalendarDate,
    snapToGrid,
    clampMinute,
    minuteToTop,
    getEventColor,
  } from "./utils";
  import { computePlannedSegments } from "$lib/utils/pomodoro-segments";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
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

  // Pomodoro accent bar bands
  const pomodoro = getPomodoro();

  const accentBandsMap = $derived.by(() => {
    // Reading breakOvertimeSeconds subscribes to it, so bands recompute
    // each second while the user hasn't acknowledged a finished break.
    void pomodoro.breakOvertimeSeconds;
    const map = new Map<string, AccentBarBand[]>();
    const now = new Date();

    for (const pos of positioned) {
      const ev = pos.event;
      if (!ev.pomodoroConfig) continue;

      const evStartMs = parseCalendarDate(ev.start).getTime();
      const evEndMs = parseCalendarDate(ev.end).getTime();
      const totalDurMs = evEndMs - evStartMs;
      if (totalDurMs <= 0) continue;

      // Visible range of this event on this day column
      const { startMinute, endMinute } = effectiveMinuteRange(ev, dateStr);
      const dayMidnightMs = parseCalendarDate(`${dateStr} 00:00`).getTime();
      const visStartFrac = (dayMidnightMs + startMinute * 60000 - evStartMs) / totalDurMs;
      const visEndFrac = (dayMidnightMs + endMinute * 60000 - evStartMs) / totalDurMs;
      const visDur = visEndFrac - visStartFrac;
      if (visDur <= 0) continue;

      let bands: AccentBarBand[];

      if (ev.id === pomodoro.activeBlockId && pomodoro.segments.length > 0) {
        // Active event: project future segment positions from current timer state.
        // Reading remainingSeconds makes this reactive to every tick.
        const currentEndMs = now.getTime() + pomodoro.remainingSeconds * 1000;
        const activeIdx = pomodoro.segments.findIndex((s) => s.status === "active");
        bands = [];
        let cursor = currentEndMs;

        for (let i = 0; i < pomodoro.segments.length; i++) {
          const seg = pomodoro.segments[i];
          const plannedDurMs = new Date(seg.plannedEnd).getTime() - new Date(seg.plannedStart).getTime();

          if (seg.status === "completed" || seg.status === "skipped" || seg.status === "interrupted") {
            if (seg.phase === "focus") continue;
            const startMs = new Date(seg.actualStart ?? seg.plannedStart).getTime();
            const endMs = new Date(seg.actualEnd ?? seg.plannedEnd).getTime();
            bands.push({
              topFraction: (startMs - evStartMs) / totalDurMs,
              heightFraction: (endMs - startMs) / totalDurMs,
              phase: seg.phase,
              status: seg.status,
            });
          } else if (i === activeIdx) {
            if (seg.phase !== "focus") {
              const startMs = new Date(seg.actualStart!).getTime();
              bands.push({
                topFraction: (startMs - evStartMs) / totalDurMs,
                heightFraction: (cursor - startMs) / totalDurMs,
                phase: seg.phase,
                status: seg.status,
              });
            }
          } else {
            if (seg.phase !== "focus") {
              bands.push({
                topFraction: (cursor - evStartMs) / totalDurMs,
                heightFraction: plannedDurMs / totalDurMs,
                phase: seg.phase,
                status: seg.status,
              });
            }
            cursor += plannedDurMs;
          }
        }
      } else {
        // Planned view: compute from config, starting from effective start
        if (now.getTime() >= evEndMs) continue;

        const effectiveStartMs = Math.max(now.getTime(), evStartMs);
        const remainingMin = (evEndMs - effectiveStartMs) / 60000;
        const offsetMin = (effectiveStartMs - evStartMs) / 60000;
        const totalDurMin = totalDurMs / 60000;

        const planned = computePlannedSegments(ev.pomodoroConfig, remainingMin);
        bands = planned
          .filter((s) => s.phase !== "focus")
          .map((s) => ({
            topFraction: (offsetMin + s.startOffsetMinutes) / totalDurMin,
            heightFraction: (s.endOffsetMinutes - s.startOffsetMinutes) / totalDurMin,
            phase: s.phase,
            status: "planned" as const,
          }));
      }

      // Clip bands to this day's visible portion and remap fractions
      const clipped: AccentBarBand[] = [];
      for (const band of bands) {
        const bStart = Math.max(band.topFraction, visStartFrac);
        const bEnd = Math.min(band.topFraction + band.heightFraction, visEndFrac);
        if (bStart >= bEnd) continue;
        clipped.push({
          topFraction: (bStart - visStartFrac) / visDur,
          heightFraction: (bEnd - bStart) / visDur,
          phase: band.phase,
          status: band.status,
        });
      }
      if (clipped.length > 0) map.set(ev.id, clipped);
    }
    return map;
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
        accentSegments={accentBandsMap.get(pos.event.id)}
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
      <div class="shrink-0" style="width: 10%; background-color: {dragColor?.accent ?? (isDark ? '#888' : '#AAAAAA')};"></div>
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
      <div class="shrink-0" style="width: 10%; background-color: {isDark ? '#888' : '#AAAAAA'};"></div>
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
  .preview-pulse {
    animation: preview-pulse 2s ease-in-out infinite;
  }

  @keyframes preview-pulse {
    0%, 100% { opacity: 0.75; }
    50% { opacity: 1; }
  }
</style>
