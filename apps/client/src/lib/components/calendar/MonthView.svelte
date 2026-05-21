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
  let dayFormat: DayNameFormat = $state("short");

  $effect(() => {
    const el = headerCells[0];
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0].contentBoxSize[0].inlineSize;
      if (w >= 110) dayFormat = "long";
      else if (w >= 60) dayFormat = "short";
      else dayFormat = "narrow";
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  const maxVisible = 3;
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
  <div class="grid min-h-0 flex-1 overflow-x-hidden" style="grid-template-rows: repeat({weeks.length}, minmax(0, 1fr));"
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
          {@const dayEvts = sortDayCellEvents(eventsByDay.get(formatDatePart(day)) ?? EMPTY_DAY)}
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

            {#each dayEvts.slice(0, maxVisible) as evt}
              {@const evtColors = preferences.calendarDimPastEvents && past
                ? getPastEventColor(evt.color, theme)
                : !inMonth
                  ? getOutsideMonthEventColor(evt.color, theme)
                  : getEventColor(evt.color, theme)}
              {@const evtIsCancelled = isEventSurfaceCancelled(evt)}
              {@const evtStatusPatternClass = getEventStatusPatternClass(evt)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="month-event-surface relative z-2 mb-px flex items-center gap-1 truncate rounded px-1 py-px text-[0.666667rem] {evtStatusPatternClass}"
                style="
                  background-color: {evtColors.bg};
                  color: {evtColors.text};
                "
                onpointerenter={() => onEventPrefetch?.(evt)}
                onpointerdown={() => onEventPrefetch?.(evt)}
                onclick={(e) => { e.stopPropagation(); onEventClick(evt, (e.currentTarget as HTMLElement).getBoundingClientRect()); }}
              >
                <span class="relative z-10 truncate" style={evtIsCancelled ? 'text-decoration: line-through;' : ''}>{#if evt.title}{evt.title}{:else}(No title){/if}</span>
              </div>
            {/each}

            {#if dayEvts.length > maxVisible}
              <span class="relative z-2 mt-px text-center text-[0.666667rem]" style="color: {moreColor};">
                +{dayEvts.length - maxVisible} more
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
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
</style>
