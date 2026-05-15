<script lang="ts">
  import type { PositionedEvent } from "./types";
  import {
    getEventColor,
    getEventStatusPatternClass,
    getPastEventColor,
    isEventSurfaceCancelled,
  } from "./utils";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import { isThemeCalendarDark, type Theme } from "$lib/stores/themes";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Users from "@lucide/svelte/icons/users";

  const calZoom = getCalendarZoom();

  let {
    positioned,
    theme,
    editing = false,
    preview = false,
    grabbing = false,
    canDrag = true,
    isPast = false,
    inResizeZone = false,
    onclick,
    onprefetch,
    onpointerdown,
  }: {
    positioned: PositionedEvent;
    theme: Theme;
    editing?: boolean;
    preview?: boolean;
    grabbing?: boolean;
    canDrag?: boolean;
    isPast?: boolean;
    inResizeZone?: boolean;
    onclick: (rect?: DOMRect) => void;
    onprefetch?: () => void;
    onpointerdown?: (e: PointerEvent) => void;
  } = $props();

  const isDark = $derived(isThemeCalendarDark(theme));

  // Events with IDs starting with __ are temporary (preview/pending) and should never animate
  const isTemporaryEvent = $derived(positioned.event.id.startsWith("__"));

  const startTime = $derived(positioned.event.start.split(" ")[1] ?? "");
  const endTime = $derived(positioned.event.end.split(" ")[1] ?? "");
  const hasRepeat = $derived(!!positioned.event.recurrence || !!positioned.event.recurringParentId);
  const hasMeeting = $derived(positioned.event.meetingEnabled === true);
  const isCancelled = $derived(isEventSurfaceCancelled(positioned.event));
  const blockPixelHeight = $derived((positioned.durationMinutes / 60) * calZoom.hourHeight);

  const usePastColors = $derived(isPast && !editing && !preview && !grabbing);
  const statusPatternClass = $derived(getEventStatusPatternClass(positioned.event));
  const activeColors = $derived(
    usePastColors
      ? getPastEventColor(positioned.event.color, theme)
      : getEventColor(positioned.event.color, theme)
  );

  const timeColor = $derived(`color-mix(in srgb, ${activeColors.text} 80%, ${activeColors.bg})`);
  const locationColor = $derived(`color-mix(in srgb, ${activeColors.text} 60%, ${activeColors.bg})`);
  const iconColor = $derived(`color-mix(in srgb, ${activeColors.text} 70%, ${activeColors.bg})`);

  function handlePointerDown(e: PointerEvent) {
    onprefetch?.();
    e.stopPropagation();
    onpointerdown?.(e);
  }

  let blockEl: HTMLDivElement | undefined = $state();

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    const eventRect = blockEl?.getBoundingClientRect();
    const colRect = blockEl?.closest("[data-day-column]")?.getBoundingClientRect();
    // Use column boundaries for horizontal positioning so the panel clears the rail
    const rect = eventRect && colRect
      ? new DOMRect(colRect.x, eventRect.y, colRect.width, eventRect.height)
      : eventRect;
    onclick(rect);
  }

  // Cursor is controlled by parent (DayColumn) via inResizeZone prop
  const effectiveCursor = $derived(
    !canDrag ? 'pointer' : inResizeZone ? 'ns-resize' : 'grab'
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={blockEl}
  data-event-id={positioned.event.id}
  data-clipped-top={positioned.isClippedTop || undefined}
  data-clipped-bottom={positioned.isClippedBottom || undefined}
  title={blockPixelHeight <= 14 ? `${positioned.event.title || '(No title)'} ${startTime} - ${endTime}` : undefined}
  class="event-block-wrapper absolute flex overflow-hidden text-[11px] leading-tight select-none {statusPatternClass} {editing || preview || grabbing || isTemporaryEvent ? 'event-editing' : ''} {positioned.isClippedTop && positioned.isClippedBottom ? '' : positioned.isClippedTop ? 'rounded-b' : positioned.isClippedBottom ? 'rounded-t' : 'rounded'}"
  style="
    top: calc({positioned.startMinute} / 60 * var(--hour-h) * 1px);
    height: calc({positioned.durationMinutes} / 60 * var(--hour-h) * 1px - {positioned.isClippedBottom || !positioned.hasEventBelow ? 0 : 2}px);
    left: {positioned.left}%;
    width: {positioned.totalColumns > 1 ? `calc(${positioned.width}% - 2px)` : `${positioned.width}%`};
    background-color: {activeColors.bg};
    color: {activeColors.text};
    --event-bg: {activeColors.bg};
    --outline-mix: {isDark ? 'white' : 'black'};
    cursor: {effectiveCursor};
    z-index: {editing ? 45 : 3};
    filter: none;
  "
  onclick={handleClick}
  onpointerenter={onprefetch}
  onpointerdown={handlePointerDown}
>
  <!-- Resize handle: top (hidden on clipped edge) -->
  {#if !positioned.isClippedTop}
    <div class="resize-handle-top" onpointerdown={handlePointerDown}></div>
  {/if}

  <!-- Content -->
  <div class="relative z-10 min-w-0 flex-1 overflow-hidden px-1 py-0.5">
    {#if hasRepeat || hasMeeting}
      <div class="event-icons absolute right-1 flex items-center gap-0.5" style="top: 5px; color: {iconColor};">
        {#if hasRepeat}
          <Repeat size={8} class="shrink-0" />
        {/if}
        {#if hasMeeting}
          <Users size={8} class="shrink-0" />
        {/if}
      </div>
    {/if}
    <div class="event-title truncate font-medium" class:pr-5={hasRepeat || hasMeeting} style={isCancelled ? 'text-decoration: line-through;' : ''}>
      {#if positioned.event.title}{positioned.event.title}{:else}(No title){/if}
    </div>
    <div class="event-time truncate" style="color: {timeColor};">{startTime} - {endTime}</div>
    {#if positioned.event.location}
      <div class="event-location truncate text-[9px]" style="color: {locationColor};">{positioned.event.location}</div>
    {/if}
  </div>

  <!-- Resize handle: bottom (hidden on clipped edge) -->
  {#if !positioned.isClippedBottom}
    <div class="resize-handle-bottom" onpointerdown={handlePointerDown}></div>
  {/if}
</div>

<style>
  .resize-handle-top,
  .resize-handle-bottom {
    position: absolute;
    left: 0;
    right: 0;
    height: 11px;
    z-index: 20;
  }

  .resize-handle-top {
    top: -5px;
  }

  .resize-handle-bottom {
    bottom: -5px;
  }

  .event-block-wrapper {
    container-type: size;
    container-name: event-block;
    transition: left 250ms cubic-bezier(0.25, 0.1, 0.25, 1), width 250ms cubic-bezier(0.25, 0.1, 0.25, 1);
  }

  .event-block-wrapper::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }

  .event-block-wrapper.event-pattern-tentative::before {
    background-image: linear-gradient(
      90deg,
      color-mix(in srgb, currentColor 10%, transparent) 0 1px,
      transparent 1px
    );
    background-repeat: repeat;
    background-size: 6px 100%;
  }

  .event-block-wrapper.event-pattern-declined::before {
    background-image: linear-gradient(
      135deg,
      transparent 0 44%,
      color-mix(in srgb, currentColor 11%, transparent) 44% 56%,
      transparent 56%
    );
    background-repeat: repeat;
    background-size: 7px 7px;
  }

  .event-block-wrapper.event-pattern-pending::before {
    background-image: radial-gradient(
      circle,
      color-mix(in srgb, currentColor 16%, transparent) 1px,
      transparent 1.3px
    );
    background-size: 9px 9px;
  }

  .event-title,
  .event-icons,
  .event-time,
  .event-location {
    display: none;
  }

  @container event-block (min-height: 14px) {
    .event-title { display: block; }
  }

  @container event-block (min-height: 16px) {
    .event-icons { display: flex; }
  }

  @container event-block (min-height: 28px) {
    .event-time { display: block; }
  }

  @container event-block (min-height: 44px) {
    .event-location { display: block; }
  }

  /* Disable layout transition for events being edited/created to avoid jank */
  .event-block-wrapper.event-editing {
    transition: none;
  }

  .event-editing {
    outline: 2px solid color-mix(in oklab, var(--event-bg) 65%, var(--outline-mix));
    outline-offset: 0;
  }
</style>
