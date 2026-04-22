<script lang="ts">
  import type { CalendarEvent } from "./types";
  import {
    getEventColor,
    getPastEventColor,
    getCancelledEventColor,
    getFreeEventColor,
  } from "./utils";
  import { isThemeCalendarDark, type Theme } from "$lib/stores/themes";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Bell from "@lucide/svelte/icons/bell";

  let {
    event,
    theme,
    editing = false,
    preview = false,
    grabbing = false,
    canDrag = true,
    isPast = false,
    onclick,
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
    onpointerdown?: (e: PointerEvent) => void;
  } = $props();

  const isDark = $derived(isThemeCalendarDark(theme));
  const hasRepeat = $derived(!!event.recurrence || !!event.recurringParentId);
  const hasNotification = $derived(event.notifications && event.notifications.length > 0);
  const isFree = $derived(event.transparency === "transparent");
  const isTentative = $derived(event.status === "tentative");
  const isCancelled = $derived(event.status === "cancelled");

  const usePastColors = $derived(isPast && !editing && !preview && !grabbing);
  const activeColors = $derived(
    isCancelled
      ? getCancelledEventColor(event.color, theme)
      : isFree
        ? getFreeEventColor(event.color, theme)
        : usePastColors
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
    e.stopPropagation();
    onpointerdown?.(e);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={chipEl}
  data-event-id={event.id}
  class="allday-chip relative min-w-0 flex-1 select-none truncate rounded px-1.5 text-[10px] leading-[20px]
    {editing || preview || grabbing ? 'chip-editing' : ''}"
  style="
    background-color: {activeColors.bg};
    color: {activeColors.text};
    --event-bg: {activeColors.bg};
    --outline-mix: {isDark ? 'white' : 'black'};
    cursor: {canDrag ? 'grab' : 'pointer'};
    z-index: 1;
    filter: none;
    {isFree ? 'border-left: 2px dashed currentColor;' : ''}
    {isTentative ? 'background-image: repeating-linear-gradient(135deg, transparent, transparent 3px, color-mix(in srgb, currentColor 8%, transparent) 3px, color-mix(in srgb, currentColor 8%, transparent) 5px);' : ''}
  "
  onclick={handleClick}
  onpointerdown={handlePointerDown}
>
  {#if hasRepeat || hasNotification}
    <span class="absolute right-1 top-[3px] flex items-center gap-0.5" style="color: {iconColor};">
      {#if hasRepeat}
        <Repeat size={8} class="shrink-0" />
      {/if}
      {#if hasNotification}
        <Bell size={8} class="shrink-0" />
      {/if}
    </span>
  {/if}
  <span class="truncate" class:pr-5={hasRepeat || hasNotification} style={isCancelled ? 'text-decoration: line-through;' : ''}>
    {#if event.title}{event.title}{:else}(No title){/if}
  </span>
</div>

<style>
  .chip-editing {
    outline: 2px solid color-mix(in oklab, var(--event-bg) 65%, var(--outline-mix));
    outline-offset: 0;
  }
</style>
