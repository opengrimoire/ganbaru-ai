<script lang="ts">
  import type { CalendarEvent } from "./types";
  import {
    getEventColor,
    getEventStatusPatternClass,
    getPastEventColor,
    isEventSurfaceCancelled,
  } from "./utils";
  import { isThemeCalendarDark, type Theme } from "$lib/stores/themes";
  import { getEventIndicatorState } from "./event-indicators";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Video from "@lucide/svelte/icons/video";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Users from "@lucide/svelte/icons/users";

  let {
    event,
    theme,
    editing = false,
    preview = false,
    grabbing = false,
    canDrag = true,
    isPast = false,
    onclick,
    onprefetch,
    onpointerdown,
  }: {
    event: CalendarEvent;
    theme: Theme;
    editing?: boolean;
    preview?: boolean;
    grabbing?: boolean;
    canDrag?: boolean;
    isPast?: boolean;
    onclick: (rect?: DOMRect) => void;
    onprefetch?: () => void;
    onpointerdown?: (e: PointerEvent) => void;
  } = $props();

  const isDark = $derived(isThemeCalendarDark(theme));
  const indicators = $derived(getEventIndicatorState(event));
  const hasIcons = $derived(indicators.iconCount > 0);
  const isCancelled = $derived(isEventSurfaceCancelled(event));

  const usePastColors = $derived(isPast && !editing && !preview && !grabbing);
  const statusPatternClass = $derived(getEventStatusPatternClass(event));
  const activeColors = $derived(
    usePastColors
      ? getPastEventColor(event.color, theme)
      : getEventColor(event.color, theme)
  );

  const iconColor = $derived(`color-mix(in srgb, ${activeColors.text} 70%, ${activeColors.bg})`);

  let chipEl: HTMLDivElement | undefined = $state();

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    const rect = chipEl?.getBoundingClientRect();
    onclick(rect);
  }

  function handlePointerDown(e: PointerEvent) {
    onprefetch?.();
    e.stopPropagation();
    onpointerdown?.(e);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={chipEl}
  data-event-id={event.id}
  class="allday-chip relative min-w-0 flex-1 select-none truncate rounded px-1.5 text-[0.666667rem] leading-5 {statusPatternClass}
    {editing || preview || grabbing ? 'chip-editing' : ''}"
  style="
    background-color: {activeColors.bg};
    color: {activeColors.text};
    --event-bg: {activeColors.bg};
    --outline-mix: {isDark ? 'white' : 'black'};
    cursor: {canDrag ? 'grab' : 'pointer'};
    z-index: 1;
    filter: none;
  "
  onclick={handleClick}
  onpointerenter={onprefetch}
  onpointerdown={handlePointerDown}
>
  {#if hasIcons}
    <span class="absolute right-1 top-0.75 z-10 flex items-center gap-0.5" style="color: {iconColor};">
      {#if indicators.hasRepeat}
        <Repeat size={8} class="shrink-0" />
      {/if}
      {#if indicators.hasCallLink}
        <Video size={8} class="shrink-0" />
      {/if}
      {#if indicators.hasLocation}
        <MapPin size={8} class="shrink-0" />
      {/if}
      {#if indicators.hasGenericMeeting}
        <Users size={8} class="shrink-0" />
      {/if}
    </span>
  {/if}
  <span
    class="relative z-10 truncate"
    class:pr-5={indicators.iconCount > 0 && indicators.iconCount <= 2}
    class:pr-8={indicators.iconCount > 2}
    style={isCancelled ? 'text-decoration: line-through;' : ''}
  >
    {#if event.title}{event.title}{:else}(No title){/if}
  </span>
</div>

<style>
  .allday-chip::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }

  .allday-chip.event-pattern-tentative::before {
    background-image: linear-gradient(
      90deg,
      color-mix(in srgb, currentColor 10%, transparent) 0 1px,
      transparent 1px
    );
    background-repeat: repeat;
    background-size: 6px 100%;
  }

  .allday-chip.event-pattern-declined::before {
    background-image: linear-gradient(
      135deg,
      transparent 0 44%,
      color-mix(in srgb, currentColor 11%, transparent) 44% 56%,
      transparent 56%
    );
    background-repeat: repeat;
    background-size: 7px 7px;
  }

  .allday-chip.event-pattern-pending::before {
    background-image: radial-gradient(
      circle,
      color-mix(in srgb, currentColor 16%, transparent) 1px,
      transparent 1.3px
    );
    background-size: 9px 9px;
  }

  .chip-editing {
    outline: 2px solid color-mix(in oklab, var(--event-bg) 65%, var(--outline-mix));
    outline-offset: 0;
  }
</style>
