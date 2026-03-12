<script lang="ts">
  import type { CalendarEvent } from "./types";
  import {
    getMonthGrid,
    isToday,
    isSameDay,
    formatDatePart,
    eventsForDay,
    getEventColor,
  } from "./utils";

  let {
    anchorDate,
    events,
    isDark = false,
    onDayClick,
    onEventClick,
  }: {
    anchorDate: Date;
    events: CalendarEvent[];
    isDark?: boolean;
    onDayClick: (date: Date) => void;
    onEventClick: (event: CalendarEvent) => void;
  } = $props();

  const currentMonth = $derived(anchorDate.getMonth());
  const weeks = $derived(
    getMonthGrid(anchorDate.getFullYear(), anchorDate.getMonth()),
  );

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const maxVisible = 3;
</script>

<div
  class="flex h-full flex-col overflow-hidden"
  style="background-color: var(--cal-bg);"
>
  <!-- Day name headers -->
  <div
    class="grid shrink-0 grid-cols-7 border-b"
    style="border-color: var(--cal-gridline);"
  >
    {#each dayNames as name}
      <div
        class="py-1.5 text-center text-[11px] font-medium"
        style="color: var(--cal-time-label);"
      >
        {name}
      </div>
    {/each}
  </div>

  <!-- Week rows -->
  <div class="grid min-h-0 flex-1 auto-rows-fr">
    {#each weeks as week}
      <div
        class="grid grid-cols-7"
        style="border-bottom: 1px solid var(--cal-gridline);"
      >
        {#each week as day}
          {@const today = isToday(day)}
          {@const inMonth = day.getMonth() === currentMonth}
          {@const dayEvts = eventsForDay(events, day)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="flex min-h-0 cursor-pointer flex-col overflow-hidden p-1"
            style="border-right: 1px solid var(--cal-gridline); opacity: {inMonth ? 1 : 0.4};"
            onclick={() => onDayClick(day)}
          >
            <span
              class="mb-0.5 flex h-6 w-6 items-center justify-center self-center rounded-full text-xs font-medium"
              style={today
                ? "background-color: var(--cal-today-circle); color: var(--cal-today-circle-text); font-weight: 700;"
                : "color: var(--foreground);"}
            >
              {day.getDate()}
            </span>

            {#each dayEvts.slice(0, maxVisible) as evt}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="mb-px flex items-center gap-1 truncate rounded px-1 py-px text-[10px]"
                style="background-color: {getEventColor(evt.color, isDark).bg}; color: {getEventColor(evt.color, isDark).text};"
                onclick={(e) => { e.stopPropagation(); onEventClick(evt); }}
              >
                <span class="truncate">{evt.title}</span>
              </div>
            {/each}

            {#if dayEvts.length > maxVisible}
              <span class="mt-px text-center text-[10px] text-muted-foreground">
                +{dayEvts.length - maxVisible} more
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>
