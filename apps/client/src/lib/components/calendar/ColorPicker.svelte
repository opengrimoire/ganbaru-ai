<script lang="ts">
  import type { EventColor } from "./types";
  import { EVENT_COLOR_OPTIONS, getEventColor } from "./utils";
  import type { Theme } from "$lib/stores/themes";

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
</script>

<div class="relative flex items-center">
  <button
    onclick={() => { open = !open; }}
    class="h-3 w-5 shrink-0 rounded-sm"
    style="background-color: {colorEntry.bg};"
    title="Event color"
  ></button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-[60]" onclick={() => { open = false; }}></div>
    <div class="absolute right-0 top-full z-[61] mt-1 grid gap-1.5 rounded-lg bg-popover p-2.5 shadow-lg ring-1 ring-border/60" style="grid-template-columns: repeat(4, 44px);">
      {#each EVENT_COLOR_OPTIONS as c}
        {@const entry = getEventColor(c, theme)}
        <button
          onclick={() => { onselect(color === c ? undefined : c); open = false; }}
          class="h-[18px] w-11 rounded-md"
          style="background-color: {entry.bg};{color === c ? ' outline: 2px solid var(--cal-color-picker-outline); outline-offset: 0;' : ''}"
          title={entry.bg}
        ></button>
      {/each}
    </div>
  {/if}
</div>
