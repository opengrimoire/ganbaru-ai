<script lang="ts">
  import type { CalendarEvent } from "./types";
  import type { DayNameFormat } from "./utils";
  import {
    getMonthGrid,
    isPastDay,
    allEventsForDay,
    getEventColor,
    getPastEventColor,
    getOutsideMonthEventColor,
    formatDayName,
  } from "./utils";
  import type { Theme } from "$lib/stores/themes";

  let {
    anchorDate,
    events,
    theme,
    onDayClick,
    onEventClick,
    onWheelNavigate,
  }: {
    anchorDate: Date;
    events: CalendarEvent[];
    theme: Theme;
    onDayClick: (date: Date) => void;
    onEventClick: (event: CalendarEvent, rect?: DOMRect) => void;
    onWheelNavigate?: (direction: "back" | "forward") => void;
  } = $props();

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
          <span class="text-[13px]" style="color: var(--foreground);">
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
          {@const dayNumberColor = active
            ? 'var(--foreground)'
            : !inMonth
              ? 'color-mix(in srgb, var(--muted-foreground) 25%, var(--background))'
              : 'var(--muted-foreground)'}
          {@const moreColor = past
            ? 'color-mix(in srgb, var(--muted-foreground) 45%, var(--background))'
            : !inMonth
              ? 'color-mix(in srgb, var(--muted-foreground) 25%, var(--background))'
              : 'var(--muted-foreground)'}
          {@const dayEvts = allEventsForDay(events, day)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="relative flex min-h-0 cursor-pointer flex-col overflow-hidden p-1"
            style="{di < 6 ? `border-right: 1px solid var(--cal-gridline);` : ''}"
            onclick={() => onDayClick(day)}
          >
            <span
              class="relative z-[2] mb-px flex h-6 w-6 items-center justify-center self-center text-xs"
              style="color: {dayNumberColor};"
            >
              {day.getDate()}
            </span>

            {#each dayEvts.slice(0, maxVisible) as evt}
              {@const evtColors = past
                ? getPastEventColor(evt.color, theme)
                : !inMonth
                  ? getOutsideMonthEventColor(evt.color, theme)
                  : getEventColor(evt.color, theme)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="relative z-[2] mb-px flex items-center gap-1 truncate rounded px-1 py-px text-[10px]"
                style="background-color: {evtColors.bg}; color: {evtColors.text};"
                onclick={(e) => { e.stopPropagation(); onEventClick(evt, (e.currentTarget as HTMLElement).getBoundingClientRect()); }}
              >
                <span class="truncate">{#if evt.title}{evt.title}{:else}(No title){/if}</span>
              </div>
            {/each}

            {#if dayEvts.length > maxVisible}
              <span class="relative z-[2] mt-px text-center text-[10px]" style="color: {moreColor};">
                +{dayEvts.length - maxVisible} more
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>
