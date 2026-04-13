<script lang="ts">
  import type { PositionedEvent } from "./types";
  import { getEventColor } from "./utils";
  import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Bell from "@lucide/svelte/icons/bell";

  const calZoom = getCalendarZoom();
  const RESIZE_ZONE = 6; // pixels from edge for resize detection

  let {
    positioned,
    isDark = false,
    editing = false,
    preview = false,
    grabbing = false,
    canDrag = true,
    isPast = false,
    onclick,
    onpointerdown,
  }: {
    positioned: PositionedEvent;
    isDark?: boolean;
    editing?: boolean;
    preview?: boolean;
    grabbing?: boolean;
    canDrag?: boolean;
    isPast?: boolean;
    onclick: (rect?: DOMRect) => void;
    onpointerdown?: (e: PointerEvent) => void;
  } = $props();

  const colors = $derived(getEventColor(positioned.event.color, isDark));
  const activeColors = $derived(colors);

  const startTime = $derived(positioned.event.start.split(" ")[1] ?? "");
  const endTime = $derived(positioned.event.end.split(" ")[1] ?? "");
  const hasRepeat = $derived(!!positioned.event.recurrence || !!positioned.event.recurringParentId);
  const hasNotification = $derived(positioned.event.notifications && positioned.event.notifications.length > 0);
  const isFree = $derived(positioned.event.transparency === "transparent");
  const isTentative = $derived(positioned.event.status === "tentative");
  const isCancelled = $derived(positioned.event.status === "cancelled");
  const blockPixelHeight = $derived((positioned.durationMinutes / 60) * calZoom.hourHeight);

  // Track if mouse is in resize zone for cursor
  let inResizeZone = $state(false);

  function handlePointerDown(e: PointerEvent) {
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

  function handleMouseMove(e: MouseEvent) {
    if (!blockEl || !canDrag) {
      inResizeZone = false;
      return;
    }
    const rect = blockEl.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const isNearTop = relY < RESIZE_ZONE && !positioned.isClippedTop;
    const isNearBottom = relY > rect.height - RESIZE_ZONE && !positioned.isClippedBottom;
    inResizeZone = isNearTop || isNearBottom;
  }

  function handleMouseLeave() {
    inResizeZone = false;
  }

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
  class="event-block-wrapper absolute flex overflow-hidden text-[11px] leading-tight select-none {editing || preview || grabbing ? 'event-editing' : ''} {isPast && !editing && !preview && !grabbing && !isDark ? 'past-light' : ''} {isPast && !editing && !preview && !grabbing && isDark ? 'past-dark' : ''} {positioned.isClippedTop && positioned.isClippedBottom ? '' : positioned.isClippedTop ? 'rounded-b' : positioned.isClippedBottom ? 'rounded-t' : 'rounded'}"
  style="
    top: calc({positioned.startMinute} / 60 * var(--hour-h) * 1px);
    height: calc({positioned.durationMinutes} / 60 * var(--hour-h) * 1px - {positioned.isClippedBottom || !positioned.hasEventBelow ? 0 : 2}px);
    left: {positioned.left}%;
    width: {positioned.totalColumns > 1 ? `calc(${positioned.width}% - 2px)` : `${positioned.width}%`};
    color: {activeColors.text};
    cursor: {effectiveCursor};
    z-index: {editing ? 45 : 1};
    filter: none;
    opacity: {isCancelled ? 0.4 : isFree ? 0.55 : 1};
  "
  onclick={handleClick}
  onpointerdown={handlePointerDown}
  onmousemove={handleMouseMove}
  onmouseleave={handleMouseLeave}
>
  <!-- Resize handle: top (hidden on clipped edge) -->
  {#if !positioned.isClippedTop}
    <div class="resize-handle-top" onpointerdown={handlePointerDown}></div>
  {/if}

  <!-- Content -->
  <div class="relative min-w-0 flex-1 overflow-hidden px-1 py-0.5" style="background-color: {activeColors.bg};{isFree ? ' border-left: 2px dashed currentColor;' : ''}{isTentative ? ' background-image: repeating-linear-gradient(135deg, transparent, transparent 3px, color-mix(in srgb, currentColor 8%, transparent) 3px, color-mix(in srgb, currentColor 8%, transparent) 5px);' : ''}">
    {#if blockPixelHeight > 16 && (hasRepeat || hasNotification)}
      <div class="absolute right-1 flex items-center gap-0.5" style="top: 5px;">
        {#if hasRepeat}
          <Repeat size={8} class="shrink-0 opacity-70" />
        {/if}
        {#if hasNotification}
          <Bell size={8} class="shrink-0 opacity-70" />
        {/if}
      </div>
    {/if}
    {#if blockPixelHeight > 14}
      <div class="truncate font-medium" class:pr-5={(hasRepeat || hasNotification) && blockPixelHeight > 16} style={isCancelled ? 'text-decoration: line-through;' : ''}>
        {#if positioned.event.title}{positioned.event.title}{:else}<span class="opacity-50">(No title)</span>{/if}
      </div>
    {/if}
    {#if blockPixelHeight > 28}
      <div class="truncate opacity-80">{startTime} - {endTime}</div>
    {/if}
    {#if blockPixelHeight > 44 && positioned.event.location}
      <div class="truncate text-[9px] opacity-60">{positioned.event.location}</div>
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
    z-index: 2;
  }

  .resize-handle-top {
    top: -5px;
  }

  .resize-handle-bottom {
    bottom: -5px;
  }

  .event-block-wrapper {
    transition: left 250ms cubic-bezier(0.25, 0.1, 0.25, 1), width 250ms cubic-bezier(0.25, 0.1, 0.25, 1);
  }

  .event-editing::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid rgba(0, 0, 0, 0.3);
    border-radius: inherit;
    pointer-events: none;
    z-index: 3;
  }

  :global(.dark) .event-editing::after {
    border-color: rgba(255, 255, 255, 0.5);
  }

  .past-light::before {
    content: "";
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.3);
    border-radius: inherit;
    pointer-events: none;
    z-index: 1;
  }

  .past-dark::before {
    content: "";
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    border-radius: inherit;
    pointer-events: none;
    z-index: 1;
  }

</style>
