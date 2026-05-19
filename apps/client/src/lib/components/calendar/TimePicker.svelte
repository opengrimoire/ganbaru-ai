<script lang="ts">
  import { createSmoothScroll } from "./utils";

  let {
    currentTime,
    isEnd = false,
    startMinutes = 0,
    onselect,
  }: {
    currentTime: string;
    isEnd?: boolean;
    startMinutes?: number;
    onselect: (time: string) => void;
  } = $props();

  const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2);
    const m = (i % 2) * 30;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });

  let scrollEl: HTMLDivElement | undefined = $state();
  const onWheel = createSmoothScroll(() => scrollEl, 2, 8);

  const nearestSlot = $derived.by(() => {
    const [h, m] = (currentTime || "0:0").split(":").map(Number);
    return TIME_SLOTS[Math.min(Math.round((h * 60 + m) / 30), TIME_SLOTS.length - 1)];
  });

  // Scroll to nearest slot on mount
  $effect(() => {
    if (!scrollEl) return;
    const el = scrollEl;
    const time = currentTime;
    requestAnimationFrame(() => {
      let target = el.querySelector(`[data-time="${time}"]`);
      if (!target && time) {
        const [h, m] = time.split(":").map(Number);
        const idx = Math.min(Math.round((h * 60 + m) / 30), TIME_SLOTS.length - 1);
        target = el.querySelector(`[data-time="${TIME_SLOTS[idx]}"]`);
      }
      target?.scrollIntoView({ block: "center" });
    });
  });

  function getDurationLabel(slot: string): string {
    if (!isEnd) return "";
    const [h, m] = slot.split(":").map(Number);
    let d = h * 60 + m - startMinutes;
    if (d <= 0) d += 1440;
    if (d >= 1440) return "";
    const hrs = d / 60;
    if (d % 60 === 0) return `${hrs} ${hrs === 1 ? "hr" : "hrs"}`;
    return `${hrs.toFixed(1)} hrs`;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={scrollEl} onwheel={onWheel} class="time-picker-scroll max-h-50 overflow-y-auto">
  {#each TIME_SLOTS as slot}
    {@const selected = currentTime === slot}
    {@const isNow = slot === nearestSlot}
    {@const durLabel = getDurationLabel(slot)}
    <button onclick={() => onselect(slot)}
      data-time={slot}
      class="flex w-full items-center px-2 py-1 text-left text-[0.8rem] transition-colors hover:bg-black/5 dark:hover:bg-black/15
        {selected ? 'bg-accent' : ''}"
      style="font-weight: {isNow ? 600 : selected ? 500 : 400}; color: {isNow || selected ? 'var(--foreground)' : 'var(--muted-foreground)'};">
      <span>{slot}</span>
      {#if durLabel}
        <span class="ml-1.5 text-[0.666667rem]" style="color: var(--muted-foreground); font-weight: 400;">({durLabel})</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .time-picker-scroll {
    -webkit-mask-image: linear-gradient(to bottom, transparent, black 24px, black calc(100% - 24px), transparent);
    mask-image: linear-gradient(to bottom, transparent, black 24px, black calc(100% - 24px), transparent);
  }
</style>
