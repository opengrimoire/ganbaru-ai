<script lang="ts">
  import type { PositionedEvent } from "./types";
  import { getEventColor } from "./utils";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Bell from "@lucide/svelte/icons/bell";

  let {
    positioned,
    isDark = false,
    isPast = false,
    onclick,
    onpointerdown,
  }: {
    positioned: PositionedEvent;
    isDark?: boolean;
    isPast?: boolean;
    onclick: (rect?: DOMRect) => void;
    onpointerdown?: (e: PointerEvent) => void;
  } = $props();

  const colors = $derived(getEventColor(positioned.event.color, isDark));

  const startTime = $derived(positioned.event.start.split(" ")[1] ?? "");
  const endTime = $derived(positioned.event.end.split(" ")[1] ?? "");
  const hasRepeat = $derived(positioned.event.repeatRule && positioned.event.repeatRule !== "none");
  const hasNotification = $derived(positioned.event.notificationMinutes !== undefined);

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
  class="event-block-wrapper absolute overflow-hidden px-1.5 py-0.5 text-[11px] leading-tight select-none transition-all hover:shadow-md hover:ring-1 hover:ring-white/30 hover:brightness-125 {positioned.isClippedTop && positioned.isClippedBottom ? '' : positioned.isClippedTop ? 'rounded-b' : positioned.isClippedBottom ? 'rounded-t' : 'rounded'}"
  style="
    top: {positioned.top}px;
    height: {positioned.height}px;
    left: {positioned.left}%;
    width: {positioned.width}%;
    background-color: {colors.bg};
    border-left: 3px solid {colors.border};
    color: {colors.text};
    cursor: grab;
    z-index: 1;
    opacity: {isPast ? 0.45 : 1};
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
</style>
