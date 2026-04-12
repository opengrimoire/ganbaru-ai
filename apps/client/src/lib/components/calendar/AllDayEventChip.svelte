<script lang="ts">
  import type { CalendarEvent } from "./types";
  import { getEventColor } from "./utils";
  import Repeat from "@lucide/svelte/icons/repeat";
  import Bell from "@lucide/svelte/icons/bell";

  let {
    event,
    isDark = false,
    editing = false,
    preview = false,
    isPast = false,
    onclick,
    onpointerdown,
  }: {
    event: CalendarEvent;
    isDark?: boolean;
    editing?: boolean;
    preview?: boolean;
    isPast?: boolean;
    onclick: (rect?: DOMRect) => void;
    onpointerdown?: (e: PointerEvent) => void;
  } = $props();

  const colors = $derived(getEventColor(event.color, isDark));
  const activeColors = $derived(colors);

  const hasRepeat = $derived(!!event.recurrence || !!event.recurringParentId);
  const hasNotification = $derived(event.notifications && event.notifications.length > 0);
  const isFree = $derived(event.transparency === "transparent");
  const isTentative = $derived(event.status === "tentative");
  const isCancelled = $derived(event.status === "cancelled");

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
    {editing || preview ? 'chip-editing' : ''}
    {isPast && !editing && !preview && !isDark ? 'chip-past-light' : ''}
    {isPast && !editing && !preview && isDark ? 'chip-past-dark' : ''}"
  style="
    background-color: {activeColors.bg};
    color: {activeColors.text};
    cursor: grab;
    z-index: 1;
    filter: none;
    opacity: {isCancelled ? 0.4 : isFree ? 0.55 : 1};
    --glow-color: {isDark ? 'rgba(130, 160, 220, 0.3)' : 'rgba(0, 30, 80, 0.2)'};
    {isFree ? 'border-left: 2px dashed currentColor;' : ''}
    {isTentative ? 'background-image: repeating-linear-gradient(135deg, transparent, transparent 3px, color-mix(in srgb, currentColor 8%, transparent) 3px, color-mix(in srgb, currentColor 8%, transparent) 5px);' : ''}
  "
  onclick={handleClick}
  onpointerdown={handlePointerDown}
>
  {#if hasRepeat || hasNotification}
    <span class="absolute right-1 top-[3px] flex items-center gap-0.5">
      {#if hasRepeat}
        <Repeat size={8} class="shrink-0 opacity-70" />
      {/if}
      {#if hasNotification}
        <Bell size={8} class="shrink-0 opacity-70" />
      {/if}
    </span>
  {/if}
  <span class="truncate" class:pr-5={hasRepeat || hasNotification} style={isCancelled ? 'text-decoration: line-through;' : ''}>
    {#if event.title}{event.title}{:else}<span class="opacity-50">(No title)</span>{/if}
  </span>
</div>

<style>
  .allday-chip {
    transition: box-shadow 180ms ease-out;
  }

  /* Past-light overlay: always present, opacity-controlled for smooth fade */
  .allday-chip::before {
    content: "";
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.3);
    border-radius: inherit;
    pointer-events: none;
    z-index: 1;
    opacity: 0;
    transition: opacity 180ms ease-out;
  }

  .chip-past-light::before {
    opacity: 1;
  }

  .chip-past-dark::before {
    background: rgba(0, 0, 0, 0.3);
    opacity: 1;
  }

  .allday-chip::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    border-radius: inherit;
    pointer-events: none;
    z-index: 3;
    opacity: 0;
    transition: opacity 180ms ease-out;
  }

  .chip-editing {
    box-shadow:
      0 0 2px 0 var(--glow-color),
      0 0 5px 0 color-mix(in srgb, var(--glow-color) 50%, transparent);
  }

  .chip-editing::after {
    opacity: 0.7;
  }
</style>
