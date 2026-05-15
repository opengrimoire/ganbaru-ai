<script lang="ts">
  import type { EventColor } from "./types";
  import { EVENT_COLOR_OPTIONS, getEventColor } from "./utils";
  import {
    isThemeCalendarDark,
    resolveCalendarTokens,
    type Theme,
  } from "$lib/stores/themes";

  let {
    color,
    theme,
    onselect,
  }: {
    color: EventColor | undefined;
    theme: Theme;
    onselect: (color: EventColor | undefined) => void;
  } = $props();

  let open = $state(false);

  const colorEntry = $derived(getEventColor(color, theme));
  const calendarTokens = $derived(resolveCalendarTokens(theme));
  const pickerBg = $derived(calendarTokens["--cal-bg"]);
  const pickerText = $derived(calendarTokens["--cal-time-label"]);
  const pickerRing = $derived(calendarTokens["--cal-gridline"]);
  const outlineMix = $derived(isThemeCalendarDark(theme) ? "white" : "black");

  function swatchStyle(bg: string): string {
    return `
      background-color: ${bg};
      --event-bg: ${bg};
      --outline-mix: ${outlineMix};
    `;
  }
</script>

<div class="relative flex items-center">
  <button
    onclick={() => { open = !open; }}
    class="size-4 shrink-0 rounded-sm"
    style="background-color: {colorEntry.bg};"
    title="Event color"
  ></button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-60" onclick={() => { open = false; }}></div>
    <div
      class="absolute right-0 top-full z-61 mt-1 grid gap-1.5 rounded-lg p-2.5 shadow-lg ring-1"
      style="
        grid-template-columns: repeat(4, 1.25rem);
        background-color: {pickerBg};
        color: {pickerText};
        --tw-ring-color: {pickerRing};
      "
    >
      {#each EVENT_COLOR_OPTIONS as c}
        {@const entry = getEventColor(c, theme)}
        <button
          onclick={() => { onselect(color === c ? undefined : c); }}
          class="calendar-color-swatch size-5 rounded-[3px]"
          class:swatch-selected={color === c}
          style={swatchStyle(entry.bg)}
          title={entry.bg}
        ></button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .calendar-color-swatch {
    position: relative;
    overflow: hidden;
  }

  .calendar-color-swatch.swatch-selected::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 2px solid color-mix(in oklab, var(--event-bg) 65%, var(--outline-mix));
    border-radius: inherit;
    pointer-events: none;
  }
</style>
