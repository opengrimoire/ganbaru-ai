<script lang="ts">
  import type { EventColor } from "./types";
  import { EVENT_COLOR_OPTIONS, getEventColor } from "./utils";

  let {
    color,
    isDark,
    onselect,
  }: {
    color: EventColor | undefined;
    isDark: boolean;
    onselect: (color: EventColor | undefined) => void;
  } = $props();

  let open = $state(false);

  const colorEntry = $derived(getEventColor(color, isDark));
</script>

<div class="relative flex items-center">
  <button
    onclick={() => { open = !open; }}
    class="h-[14px] w-[14px] shrink-0 rounded-full transition-transform hover:scale-110"
    style="background-color: {colorEntry.accent};"
    title="Event color"
  ></button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-[60]" onclick={() => { open = false; }}></div>
    <div class="absolute right-0 top-full z-[61] mt-0.5 flex flex-wrap gap-2 rounded-lg bg-popover p-2.5 shadow-lg ring-1 ring-border/60" style="width: 220px;">
      {#each EVENT_COLOR_OPTIONS as c}
        {@const entry = getEventColor(c, isDark)}
        <button onclick={() => { onselect(color === c ? undefined : c); open = false; }}
          class="h-[18px] w-[18px] rounded-full transition-transform hover:scale-110"
          style="background-color:{entry.accent}; {color === c ? `box-shadow: 0 0 0 2px var(--card), 0 0 0 3.5px ${entry.accent}; transform: scale(1.15);` : ''}"
          title={c}></button>
      {/each}
    </div>
  {/if}
</div>
