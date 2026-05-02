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

  const TOOLTIP_W = 188;
  const TOOLTIP_GAP = 10;

  /**
   * Place the tooltip on whichever side of the cursor has more room, so it
   * never covers the crosshair point. Falls back to a clamped position when
   * the chart is too narrow to fit the tooltip on either side cleanly.
   */
  const tooltipStyle = $derived.by(() => {
    if (!hoverSample) return "display: none;";
    const x = xOf(hoverSample.t);
    const spaceRight = width - x;
    const spaceLeft = x;
    if (spaceRight >= TOOLTIP_W + TOOLTIP_GAP) {
      return `left: ${x + TOOLTIP_GAP}px; top: 0; width: ${TOOLTIP_W}px;`;
    }
    if (spaceLeft >= TOOLTIP_W + TOOLTIP_GAP) {
      const right = width - x + TOOLTIP_GAP;
      return `right: ${right}px; top: 0; width: ${TOOLTIP_W}px;`;
    }
    const left = Math.max(0, Math.min(width - TOOLTIP_W, x + TOOLTIP_GAP));
    return `left: ${left}px; top: 0; width: ${TOOLTIP_W}px;`;
  });

  /**
   * First and last x-axis ticks anchor to the chart edge so their labels
   * don't bleed past the SVG box (which clips by default). Middle ticks
   * stay centered on their tick mark.
   */
  function tickAnchor(index: number, total: number): "start" | "middle" | "end" {
    if (index === 0) return "start";
    if (index === total - 1) return "end";
    return "middle";
  }

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
      {#each xTicks as tick, i}
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
          text-anchor={tickAnchor(i, xTicks.length)}
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
        class="pointer-events-none absolute z-10 flex flex-col gap-1.5 rounded-md border border-border bg-popover px-2 py-1.5 shadow-md"
        style={tooltipStyle}
      >
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-xs text-muted-foreground">t</span>
          <span class="text-[11px] tabular-nums text-foreground">{formatElapsed(hoverSample.t)}</span>
        </div>
        {#each hoverSample.processes as p (p.name)}
          <div class="flex items-baseline justify-between gap-2">
            <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.name}</span>
            <span class="shrink-0 text-[11px] tabular-nums text-foreground">{p.mb.toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB</span>
          </div>
        {/each}
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-xs text-muted-foreground">Total</span>
          <span class="text-[11px] tabular-nums text-foreground">{hoverSample.totalMb.toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB</span>
        </div>
      </div>
    {/if}
  {/if}
</div>
