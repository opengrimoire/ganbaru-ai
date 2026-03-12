<script lang="ts">
  import type { PositionedEvent } from "./types";
  import { getEventColor } from "./utils";

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
    onclick: () => void;
    onpointerdown?: (e: PointerEvent) => void;
  } = $props();

  const colors = $derived(getEventColor(positioned.event.color, isDark));

  const startTime = $derived(positioned.event.start.split(" ")[1] ?? "");
  const endTime = $derived(positioned.event.end.split(" ")[1] ?? "");

  function handlePointerDown(e: PointerEvent) {
    e.stopPropagation();
    onpointerdown?.(e);
  }

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    onclick();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="absolute overflow-hidden rounded px-1.5 py-0.5 text-[11px] leading-tight select-none"
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
  <div class="truncate font-medium">{positioned.event.title}</div>
  {#if positioned.height > 28}
    <div class="truncate opacity-80">{startTime} - {endTime}</div>
  {/if}
</div>
