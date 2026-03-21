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
    ? { bg: "#2A2A2C", accent: "#888", text: "#CACACA" }
    : { bg: "#E8E8E8", accent: "#AAAAAA", text: "#666666" },
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
  data-event-id={positioned.event.id}
  class="event-block-wrapper absolute flex overflow-hidden text-[11px] leading-tight select-none {preview ? 'event-preview' : ''} {positioned.isClippedTop && positioned.isClippedBottom ? '' : positioned.isClippedTop ? 'rounded-b' : positioned.isClippedBottom ? 'rounded-t' : 'rounded'}"
  style="
    top: {positioned.top}px;
    height: {positioned.height}px;
    left: {positioned.left}%;
    width: {positioned.width}%;
    color: {activeColors.text};
    cursor: grab;
    z-index: {editing ? 45 : 1};
    {isPast ? 'filter: saturate(0.7) brightness(0.9);' : ''}
  "
  onclick={handleClick}
  onpointerdown={handlePointerDown}
>
  <!-- Resize handle: top -->
  <div class="resize-handle-top" onpointerdown={handlePointerDown}></div>

  <!-- Accent bar -->
  <div class="shrink-0" style="width: 10%; background-color: {activeColors.accent};"></div>

  <!-- Content -->
  <div class="relative min-w-0 flex-1 px-1 py-0.5" style="background-color: {activeColors.bg};">
    {#if hasRepeat || hasNotification}
      <div class="absolute right-1 flex items-center gap-0.5" style="top: 5px;">
        {#if hasRepeat}
          <Repeat size={8} class="shrink-0 opacity-70" />
        {/if}
        {#if hasNotification}
          <Bell size={8} class="shrink-0 opacity-70" />
        {/if}
      </div>
    {/if}
    <div class="truncate font-medium" class:pr-5={hasRepeat || hasNotification}>
      {positioned.event.title}
    </div>
    {#if positioned.height > 28}
      <div class="truncate opacity-80">{startTime} - {endTime}</div>
    {/if}
  </div>

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
    animation: preview-pulse 2s ease-in-out infinite;
  }

  @keyframes preview-pulse {
    0%, 100% { opacity: 0.75; }
    50% { opacity: 1; }
  }
</style>
