<script lang="ts">
  import type { CalendarEvent } from "./types";
  import type { DayNameFormat } from "./utils";
  import {
    getMonthGrid,
    isPastDay,
    getEventColor,
    getEventStatusPatternClass,
    getPastEventColor,
    getOutsideMonthEventColor,
    isEventSurfaceCancelled,
    formatDayName,
    formatDatePart,
  } from "./utils";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import type { Theme } from "$lib/stores/themes";
  import { resolveAppTokens, resolveCalendarTokens } from "$lib/stores/themes";
  import { dayNumberShade } from "$lib/components/ui/colorMath";
  import {
    layoutMonthDayEvents,
    MONTH_EVENT_CHIP_HEIGHT_PX,
    MONTH_EVENT_ROW_GAP_PX,
    type MonthDayLayoutItem,
  } from "./month-event-layout";
  import { getMeetingIndicatorState } from "./event-indicators";
  import Video from "@lucide/svelte/icons/video";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Users from "@lucide/svelte/icons/users";

  let {
    anchorDate,
    eventsByDay,
    theme,
    onDayClick,
    onEventClick,
    onEventPrefetch,
    onWheelNavigate,
  }: {
    anchorDate: Date;
    eventsByDay: Map<string, CalendarEvent[]>;
    theme: Theme;
    onDayClick: (date: Date) => void;
    onEventClick: (event: CalendarEvent, rect?: DOMRect) => void;
    onEventPrefetch?: (event: CalendarEvent) => void;
    onWheelNavigate?: (direction: "back" | "forward") => void;
  } = $props();

  const preferences = getPreferences();

  /** Stable empty fallback for days with no events. */
  const EMPTY_DAY: CalendarEvent[] = [];
  const MONTH_CELL_PAD_X_PX = 4;
  const MONTH_CELL_PAD_Y_PX = 4;
  const MONTH_DAY_NUMBER_HEIGHT_PX = 24;
  const MONTH_DAY_NUMBER_MARGIN_PX = 1;
  const MONTH_CELL_BORDER_PX = 1;
  const MONTH_CELL_RIGHT_EDGE_INSET_PX = 1;

  /**
   * Per-cell ordering: all-day events first, sorted by title then start;
   * timed events second, sorted by start. Reproduces the contract of the
   * old `allEventsForDay` helper, but on the pre-bucketed day slice instead
   * of scanning the full visible-event array per cell.
   */
  function sortDayCellEvents(arr: CalendarEvent[]): CalendarEvent[] {
    if (arr.length === 0) return arr;
    const allDay: CalendarEvent[] = [];
    const timed: CalendarEvent[] = [];
    for (const e of arr) (e.allDay ? allDay : timed).push(e);
    if (allDay.length > 1) {
      allDay.sort((a, b) => {
        const at = (a.title || "").toLowerCase();
        const bt = (b.title || "").toLowerCase();
        if (at !== bt) return at < bt ? -1 : 1;
        return a.start.localeCompare(b.start);
      });
    }
    if (timed.length > 1) {
      timed.sort((a, b) => a.start.localeCompare(b.start));
    }
    if (allDay.length === 0) return timed;
    if (timed.length === 0) return allDay;
    return allDay.concat(timed);
  }

  let wheelCooldown = false;

  function handleHeaderWheel(e: WheelEvent) {
    e.preventDefault();
    if (!onWheelNavigate || wheelCooldown) return;
    if (Math.abs(e.deltaY) < 5) return;
    wheelCooldown = true;
    onWheelNavigate(e.deltaY > 0 ? "forward" : "back");
    setTimeout(() => { wheelCooldown = false; }, 300);
  }

  const currentMonth = $derived(anchorDate.getMonth());
  const weeks = $derived(
    getMonthGrid(anchorDate.getFullYear(), anchorDate.getMonth()),
  );

  const shadeRefs = $derived.by(() => {
    const app = resolveAppTokens(theme);
    const cal = resolveCalendarTokens(theme);
    return { bg: cal["--cal-bg"], ink: app["--foreground"] };
  });

  // Reference days for day-of-week headers (Mon-Sun from first week)
  const dayNameDates = $derived(weeks[0]);

  // Responsive day name format based on column width
  let headerCells: HTMLElement[] = $state([]);
  let headerCellWidths: number[] = $state([]);
  let dayFormat: DayNameFormat = $state("short");
  let monthGridEl: HTMLDivElement | undefined = $state();
  let monthGridWidth = $state(0);
  let monthGridHeight = $state(0);

  $effect(() => {
    const observedCells = headerCells.filter((el): el is HTMLElement => !!el);
    if (observedCells.length === 0) return;
    const observer = new ResizeObserver((entries) => {
      const next = [...headerCellWidths];
      for (const entry of entries) {
        const index = headerCells.indexOf(entry.target as HTMLElement);
        if (index < 0) continue;
        next[index] = resizeObserverBox(entry).width;
      }
      headerCellWidths = next;
      const firstWidth = next[0] ?? 0;
      if (firstWidth >= 110) dayFormat = "long";
      else if (firstWidth >= 60) dayFormat = "short";
      else dayFormat = "narrow";
    });
    for (const el of observedCells) observer.observe(el);
    return () => observer.disconnect();
  });

  function resizeObserverBox(entry: ResizeObserverEntry): { width: number; height: number } {
    const rawBox = entry.contentBoxSize;
    const box = Array.isArray(rawBox) ? rawBox[0] : rawBox;
    return {
      width: box?.inlineSize ?? entry.contentRect.width,
      height: box?.blockSize ?? entry.contentRect.height,
    };
  }

  $effect(() => {
    const el = monthGridEl;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = resizeObserverBox(entry);
      monthGridWidth = Math.max(0, width);
      monthGridHeight = Math.max(0, height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  const monthLayoutOptionsByColumn = $derived.by(() => {
    const cellHeightPx = monthGridHeight > 0 && weeks.length > 0
      ? monthGridHeight / weeks.length
      : 0;
    const availableHeightPx = Math.max(
      0,
      cellHeightPx
        - MONTH_CELL_PAD_Y_PX * 2
        - MONTH_DAY_NUMBER_HEIGHT_PX
        - MONTH_DAY_NUMBER_MARGIN_PX,
    );
    return Array.from({ length: 7 }, (_, i) => {
      const fallbackColumnWidth = monthGridWidth > 0 ? monthGridWidth / 7 : 0;
      const columnWidth = headerCellWidths[i] ?? fallbackColumnWidth;
      const borderWidth = i < 6 ? MONTH_CELL_BORDER_PX : 0;
      const cellWidthPx = Math.max(
        0,
        columnWidth
          - MONTH_CELL_PAD_X_PX * 2
          - borderWidth
          - MONTH_CELL_RIGHT_EDGE_INSET_PX,
      );
      return {
        cellWidthPx,
        availableHeightPx,
        chipHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX,
        rowGapPx: MONTH_EVENT_ROW_GAP_PX,
      };
    });
  });

  const fallbackMonthLayoutOptions = $derived({
    cellWidthPx: 0,
    availableHeightPx: 0,
    chipHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX,
    rowGapPx: MONTH_EVENT_ROW_GAP_PX,
  });

  function monthLayoutOptionsForColumn(columnIndex: number) {
    return monthLayoutOptionsByColumn[columnIndex] ?? fallbackMonthLayoutOptions;
  }

  function monthLayoutItemKey(item: MonthDayLayoutItem): string {
    return item.kind === "event" ? `event:${item.event.id}` : "more";
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flex h-full flex-col overflow-hidden"
  style="background-color: var(--cal-bg);"
  onwheel={handleHeaderWheel}
>
  <!-- Day name headers (matches week/day view design) -->
  <div
    class="sticky top-0 z-10 shrink-0"
    style="
      height: var(--cal-header-row-h);
      background-color: var(--cal-header-bg);
      border-bottom: 1px solid var(--sidebar);
    "
  >
    <div class="grid h-full grid-cols-7">
      {#each dayNameDates as day, i}
        <div
          bind:this={headerCells[i]}
          class="flex items-center justify-center"
        >
          <span class="text-[0.866667rem]" style="color: var(--foreground);">
            {formatDayName(day, dayFormat)}
          </span>
        </div>
      {/each}
    </div>
  </div>

  <!-- Week rows -->
  <div
    bind:this={monthGridEl}
    data-calendar-edit-close-zone
    class="grid min-h-0 flex-1 overflow-x-hidden"
    style="grid-template-rows: repeat({weeks.length}, minmax(0, 1fr));"
  >
    {#each weeks as week, wi}
      <div
        class="grid grid-cols-7"
        style="{wi < weeks.length - 1 ? `border-bottom: 1px solid var(--cal-gridline);` : ''}"
      >
        {#each week as day, di}
          {@const inMonth = day.getMonth() === currentMonth}
          {@const past = isPastDay(day)}
          {@const active = inMonth && !past}
          {@const dayNumberColor = dayNumberShade(
            shadeRefs.bg,
            shadeRefs.ink,
            inMonth,
            past,
          )}
          {@const moreColor = dayNumberShade(
            shadeRefs.bg,
            shadeRefs.ink,
            inMonth,
            past,
          )}
          {@const dateStr = formatDatePart(day)}
          {@const dayEvts = sortDayCellEvents(eventsByDay.get(dateStr) ?? EMPTY_DAY)}
          {@const dayLayout = layoutMonthDayEvents(dayEvts, monthLayoutOptionsForColumn(di))}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="relative flex min-h-0 cursor-pointer flex-col overflow-hidden p-1"
            style="{di < 6 ? `border-right: 1px solid var(--cal-gridline);` : ''}"
            onclick={() => onDayClick(day)}
          >
            <span
              class="relative z-2 mb-px flex h-6 w-6 items-center justify-center self-center text-xs"
              style="color: {dayNumberColor};"
            >
              {day.getDate()}
            </span>

            <div class="relative min-h-0 flex-1 overflow-hidden">
              {#each dayLayout.items as item (monthLayoutItemKey(item))}
                {#if item.kind === "event"}
                  {@const evt = item.event}
                  {@const evtColors = preferences.calendarDimPastEvents && past
                    ? getPastEventColor(evt.color, theme)
                    : !inMonth
                      ? getOutsideMonthEventColor(evt.color, theme)
                      : getEventColor(evt.color, theme)}
                  {@const evtIsCancelled = isEventSurfaceCancelled(evt)}
                  {@const evtStatusPatternClass = getEventStatusPatternClass(evt)}
                  {@const evtMeetingIndicators = getMeetingIndicatorState(evt)}
                  {@const evtIconColor = `color-mix(in srgb, ${evtColors.text} 70%, ${evtColors.bg})`}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    data-event-id={evt.id}
                    class="month-event-surface absolute z-2 flex min-w-0 items-center gap-1 overflow-hidden rounded px-1 text-[0.666667rem] leading-5 {evtStatusPatternClass}"
                    style="
                      left: {item.leftPx}px;
                      top: {item.topPx}px;
                      width: {item.widthPx}px;
                      height: {item.heightPx}px;
                      background-color: {evtColors.bg};
                      color: {evtColors.text};
                    "
                    onpointerenter={() => onEventPrefetch?.(evt)}
                    onpointerdown={() => onEventPrefetch?.(evt)}
                    onclick={(e) => { e.stopPropagation(); onEventClick(evt, (e.currentTarget as HTMLElement).getBoundingClientRect()); }}
                  >
                    <span class="relative z-10 min-w-0 flex-1 truncate" style={evtIsCancelled ? 'text-decoration: line-through;' : ''}>{#if evt.title}{evt.title}{:else}(No title){/if}</span>
                    {#if evtMeetingIndicators.iconCount > 0}
                      <span class="relative z-10 flex shrink-0 items-center gap-0.5" style="color: {evtIconColor};">
                        {#if evtMeetingIndicators.hasCallLink}
                          <Video size={8} class="shrink-0" />
                        {/if}
                        {#if evtMeetingIndicators.hasLocation}
                          <MapPin size={8} class="shrink-0" />
                        {/if}
                        {#if evtMeetingIndicators.hasGenericMeeting}
                          <Users size={8} class="shrink-0" />
                        {/if}
                      </span>
                    {/if}
                  </div>
                {:else}
                  <button
                    type="button"
                    aria-label="+{item.hiddenCount} more"
                    title="+{item.hiddenCount} more"
                    class="month-more-surface absolute z-2 flex min-w-0 cursor-pointer items-center justify-center overflow-hidden truncate rounded px-1 text-[0.666667rem] leading-5"
                    style="
                      left: {item.leftPx}px;
                      top: {item.topPx}px;
                      width: {item.widthPx}px;
                      height: {item.heightPx}px;
                      --month-more-color: {moreColor};
                      color: var(--month-more-color);
                    "
                    onclick={(e) => { e.stopPropagation(); onDayClick(day); }}
                  >
                    {item.label}
                  </button>
                {/if}
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .month-event-surface,
  .month-more-surface {
    box-sizing: border-box;
  }

  .month-event-surface::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }

  .month-event-surface.event-pattern-tentative::before {
    background-image: linear-gradient(
      90deg,
      color-mix(in srgb, currentColor 10%, transparent) 0 1px,
      transparent 1px
    );
    background-repeat: repeat;
    background-size: 6px 100%;
  }

  .month-event-surface.event-pattern-declined::before {
    background-image: linear-gradient(
      135deg,
      transparent 0 44%,
      color-mix(in srgb, currentColor 11%, transparent) 44% 56%,
      transparent 56%
    );
    background-repeat: repeat;
    background-size: 7px 7px;
  }

  .month-event-surface.event-pattern-pending::before {
    background-image: radial-gradient(
      circle,
      color-mix(in srgb, currentColor 15%, transparent) 1px,
      transparent 1.3px
    );
    background-size: 8px 8px;
  }

  .month-more-surface {
    appearance: none;
    background-color: transparent;
    border: 1px solid transparent;
  }

  .month-more-surface:hover {
    background-color: transparent;
  }
</style>
