<script lang="ts">
  import type { CalendarEvent } from "./types";
  import {
    getMonthGrid,
    isPastDay,
    eventsForDay,
    getEventColor,
  } from "./utils";

  let {
    anchorDate,
    events,
    isDark = false,
    onDayClick,
    onEventClick,
    onWheelNavigate,
  }: {
    anchorDate: Date;
    events: CalendarEvent[];
    isDark?: boolean;
    onDayClick: (date: Date) => void;
    onEventClick: (event: CalendarEvent) => void;
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
    "
  >
    <div class="grid h-full grid-cols-7">
      {#each dayNameDates as day}
        <div
          class="flex items-center justify-center"
          style=""
        >
          <span class="text-[13px] font-semibold" style="color: var(--foreground);">
            {day.toLocaleDateString("en-US", { weekday: "short" })}
          </span>
        </div>
      {/each}
    </div>
  </div>

  <!-- Week rows -->
  <div class="grid min-h-0 flex-1 overflow-x-hidden" style="grid-template-rows: repeat({weeks.length}, minmax(0, 1fr));"
  >
    {#each weeks as week}
      <div
        class="grid grid-cols-7"
        style="border-bottom: 1px solid var(--cal-gridline);"
      >
        {#each week as day}
          {@const inMonth = day.getMonth() === currentMonth}
          {@const past = isPastDay(day)}
          {@const active = inMonth && !past}
          {@const textOpacity = !inMonth ? 0.25 : 1}
          {@const dayEvts = eventsForDay(events, day)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="relative flex min-h-0 cursor-pointer flex-col overflow-hidden p-1"
            style="border-right: 1px solid var(--cal-gridline);"
            onclick={() => onDayClick(day)}
          >
            <!-- Past day overlay (all past days, including previous/next month) -->
            {#if past}
              <div
                class="pointer-events-none absolute inset-0 z-[1]"
                style="background-color: var(--cal-past-overlay);"
              ></div>
            {/if}

            <span
              class="relative z-[2] mb-0.5 flex h-6 w-6 items-center justify-center self-center text-xs"
              style="color: {active ? 'var(--foreground)' : 'var(--muted-foreground)'}; opacity: {textOpacity};{active && !isDark ? ' font-weight: 700;' : ''}"
            >
              {day.getDate()}
            </span>

            {#each dayEvts.slice(0, maxVisible) as evt}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="relative z-[2] mb-px flex items-center gap-1 truncate rounded px-1 py-px text-[10px]"
                style="background-color: {getEventColor(evt.color, isDark).bg}; color: {getEventColor(evt.color, isDark).text}; opacity: {past ? 0.45 : textOpacity};"
                onclick={(e) => { e.stopPropagation(); onEventClick(evt); }}
              >
                <span class="truncate">{evt.title}</span>
              </div>
            {/each}

            {#if dayEvts.length > maxVisible}
              <span class="relative z-[2] mt-px text-center text-[10px] text-muted-foreground" style="opacity: {past ? 0.45 : textOpacity};">
                +{dayEvts.length - maxVisible} more
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>
