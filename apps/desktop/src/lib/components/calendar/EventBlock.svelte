<script lang="ts">
  import type { PositionedEvent } from "./types";
  import { getEventColor } from "./utils";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Bell from "@lucide/svelte/icons/bell";

  let {
    positioned,
    isDark = false,
    isPast = false,
    editing = false,
    preview = false,
    onclick,
    onpointerdown,
  }: {
    positioned: PositionedEvent;
    isDark?: boolean;
    isPast?: boolean;
    editing?: boolean;
    preview?: boolean;
    onclick: (rect?: DOMRect) => void;
    onpointerdown?: (e: PointerEvent) => void;
  } = $props();

  const colors = $derived(getEventColor(positioned.event.color, isDark));
  const neutralColors = $derived(isDark
    ? { bg: "#2A2A2C", border: "#888", text: "#CACACA" }
    : { bg: "#E8E8E8", border: "#AAAAAA", text: "#666666" },
  );
  // Preview with no color selected: neutral gray; preview with color: event color; saved: event color
  const activeColors = $derived(preview && !positioned.event.color ? neutralColors : colors);

  const startTime = $derived(positioned.event.start.split(" ")[1] ?? "");
  const endTime = $derived(positioned.event.end.split(" ")[1] ?? "");
  const hasRepeat = $derived(!!positioned.event.recurrence || !!positioned.event.recurringParentId);
  const hasNotification = $derived(positioned.event.notifications && positioned.event.notifications.length > 0);

  function handlePointerDown(e: PointerEvent) {
    e.stopPropagation();
    onpointerdown?.(e);
  }

  let blockEl: HTMLDivElement | undefined = $state();

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    const rect = blockEl?.getBoundingClientRect();
    onclick(rect);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={blockEl}
  class="event-block-wrapper absolute overflow-hidden px-1.5 py-0.5 text-[11px] leading-tight select-none {preview ? 'event-preview' : ''} {positioned.isClippedTop && positioned.isClippedBottom ? '' : positioned.isClippedTop ? 'rounded-b' : positioned.isClippedBottom ? 'rounded-t' : 'rounded'}"
  style="
    top: {positioned.top}px;
    height: {positioned.height}px;
    left: {positioned.left}%;
    width: {positioned.width}%;
    background-color: {activeColors.bg};
    border-left: 3px solid {activeColors.border};
    color: {activeColors.text};
    cursor: grab;
    z-index: {editing ? 45 : 1};
    {isPast ? 'filter: saturate(0.7) brightness(0.9);' : ''}
    {preview ? `--stripe-color: ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)'};` : ''}
  "
  onclick={handleClick}
  onpointerdown={handlePointerDown}
>
  <!-- Resize handle: top -->
  <div class="resize-handle-top" onpointerdown={handlePointerDown}></div>

  <div class="flex items-center gap-0.5 truncate font-medium">
    <span class="truncate">{positioned.event.title}</span>
    {#if hasRepeat}
      <Repeat size={9} class="shrink-0 opacity-70" />
    {/if}
    {#if hasNotification}
      <Bell size={9} class="shrink-0 opacity-70" />
    {/if}
  </div>
  {#if positioned.height > 28}
    <div class="truncate opacity-80">{startTime} - {endTime}</div>
  {/if}

  <!-- Resize handle: bottom -->
  <div class="resize-handle-bottom" onpointerdown={handlePointerDown}></div>
</div>

<style>
  .resize-handle-top,
  .resize-handle-bottom {
    position: absolute;
    left: 0;
    right: 0;
    height: 6px;
    cursor: ns-resize;
    z-index: 2;
  }

  .resize-handle-top {
    top: 0;
  }

  .resize-handle-bottom {
    bottom: 0;
  }

  .event-preview {
    position: relative;
  }

  .event-preview::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 5px,
      var(--stripe-color) 5px,
      var(--stripe-color) 10px
    );
    pointer-events: none;
  }
</style>
