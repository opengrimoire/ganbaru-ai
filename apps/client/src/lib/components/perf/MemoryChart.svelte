<script lang="ts">
  import type { MemorySample } from "./memorySamples";
  import { formatElapsed, pickTicks } from "./memorySamples";

  let {
    samples,
    width = 256,
    height = 64,
  }: {
    samples: MemorySample[];
    width?: number;
    height?: number;
  } = $props();

  const PAD_X = 2;
  const PAD_TOP = 4;
  const PAD_BOTTOM = 14;

  let hoverX = $state<number | null>(null);

  const innerWidth = $derived(width - PAD_X * 2);
  const innerHeight = $derived(height - PAD_TOP - PAD_BOTTOM);

  const tMin = $derived(samples.length > 0 ? samples[0].t : 0);
  const tMax = $derived(samples.length > 0 ? samples[samples.length - 1].t : 1);

  const yBounds = $derived.by(() => {
    if (samples.length === 0) return { min: 0, max: 1 };
    let min = Infinity;
    let max = 0;
    for (const s of samples) {
      if (s.totalMb < min) min = s.totalMb;
      if (s.totalMb > max) max = s.totalMb;
    }
    // Pad the visible range so the line never sits exactly on the top or
    // bottom edge. Floor at 0 to keep the chart anchored when memory is low.
    const span = max - min;
    const pad = Math.max(5, span * 0.15);
    return { min: Math.max(0, min - pad), max: max + pad };
  });

  function xOf(t: number): number {
    const span = Math.max(1, tMax - tMin);
    return PAD_X + ((t - tMin) / span) * innerWidth;
  }

  function yOf(mb: number): number {
    const span = Math.max(1, yBounds.max - yBounds.min);
    return PAD_TOP + innerHeight - ((mb - yBounds.min) / span) * innerHeight;
  }

  const path = $derived.by(() => {
    if (samples.length < 2) return "";
    const parts: string[] = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      parts.push(`${i === 0 ? "M" : "L"} ${xOf(s.t).toFixed(1)} ${yOf(s.totalMb).toFixed(1)}`);
    }
    return parts.join(" ");
  });

  const xTicks = $derived.by(() => {
    if (samples.length < 2) return [];
    return pickTicks(tMin, tMax, innerWidth).map((t) => ({ t, label: formatElapsed(t) }));
  });

  const hoverSample = $derived.by(() => {
    if (hoverX === null || samples.length === 0) return null;
    const span = Math.max(1, tMax - tMin);
    const tHover = tMin + ((hoverX - PAD_X) / innerWidth) * span;
    let nearest = samples[0];
    let bestDiff = Math.abs(samples[0].t - tHover);
    for (let i = 1; i < samples.length; i++) {
      const diff = Math.abs(samples[i].t - tHover);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = samples[i];
      }
    }
    return nearest;
  });

  const tooltipLeft = $derived.by(() => {
    if (!hoverSample) return 0;
    const TOOLTIP_W = 128;
    const x = xOf(hoverSample.t) + 8;
    return Math.min(width - TOOLTIP_W, Math.max(0, x));
  });

  function onMove(e: PointerEvent) {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    hoverX = e.clientX - rect.left;
  }

  function onLeave() {
    hoverX = null;
  }
</script>

<div class="relative" style="width: {width}px; height: {height}px;">
  {#if samples.length < 2}
    <div
      class="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground"
    >
      Collecting samples...
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg
      {width}
      {height}
      onpointermove={onMove}
      onpointerleave={onLeave}
      class="block"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linejoin="round"
        class="text-foreground"
      />
      {#each xTicks as tick}
        <line
          x1={xOf(tick.t)}
          y1={PAD_TOP + innerHeight}
          x2={xOf(tick.t)}
          y2={PAD_TOP + innerHeight + 2}
          class="stroke-muted-foreground/40"
          stroke-width="1"
        />
        <text
          x={xOf(tick.t)}
          y={height - 2}
          text-anchor="middle"
          class="fill-muted-foreground"
          style="font-size: 9px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;"
        >{tick.label}</text>
      {/each}
      {#if hoverSample}
        <line
          x1={xOf(hoverSample.t)}
          y1={PAD_TOP}
          x2={xOf(hoverSample.t)}
          y2={PAD_TOP + innerHeight}
          class="stroke-muted-foreground/60"
          stroke-width="1"
          stroke-dasharray="2 2"
        />
        <circle
          cx={xOf(hoverSample.t)}
          cy={yOf(hoverSample.totalMb)}
          r="2.5"
          class="fill-foreground"
        />
      {/if}
    </svg>
    {#if hoverSample}
      <div
        class="pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2 py-1 text-[10px] leading-tight shadow-md"
        style="left: {tooltipLeft}px; top: 0; min-width: 120px;"
      >
        <div class="tabular-nums text-muted-foreground">t = {formatElapsed(hoverSample.t)}</div>
        <div class="tabular-nums font-medium text-foreground">
          {hoverSample.totalMb.toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB total
        </div>
        {#if hoverSample.processes.length > 0}
          <div class="mt-1 flex flex-col gap-0.5">
            {#each hoverSample.processes as p (p.name)}
              <div class="flex justify-between gap-2 tabular-nums text-muted-foreground">
                <span class="truncate">{p.name}</span>
                <span>{p.mb.toFixed(1)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
