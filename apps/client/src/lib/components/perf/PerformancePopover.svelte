<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import Play from "@lucide/svelte/icons/play";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { cn } from "$lib/utils";
  import { getBenchmarkRunner } from "$lib/stores/benchmarkRunner.svelte";
  import { BENCHMARK_SCENARIOS } from "$lib/benchmark/registry";
  import { perfLog, type PerfLogEntry, clear as clearPerfLog, setTracking } from "$lib/stores/perflog.svelte";
  import MemoryChart from "$lib/components/perf/MemoryChart.svelte";
  import type { MemorySample } from "$lib/components/perf/memorySamples";
  import { SAMPLE_CAP, SAMPLE_INTERVAL_MS, samplesToCSV } from "$lib/components/perf/memorySamples";

  interface ProcessMemory {
    name: string;
    mb: number;
  }

  interface MemoryReport {
    processes: ProcessMemory[];
    total_mb: number;
    platform: string;
  }

  let {
    shellStartupMs = null,
    pinned = false,
    onPinnedChange = () => {},
    ensureBenchmarkOverlay = async () => {},
  }: {
    shellStartupMs: number | null;
    pinned: boolean;
    onPinnedChange: (pinned: boolean) => void;
    ensureBenchmarkOverlay?: () => Promise<void>;
  } = $props();

  const benchmarkRunner = getBenchmarkRunner();

  let perfLive = $state(true);
  // One slot for the most recently copied button so each one can flash a
  // "Copied" confirmation without needing a separate flag per button.
  let copiedId = $state<string | null>(null);
  let memorySamples = $state<MemorySample[]>([]);
  // Logical sample index. Multiplying by SAMPLE_INTERVAL_MS yields a
  // drift-free `t` even when setInterval fires a few ms early or late, so
  // the chart ticks land on clean 5 s multiples instead of accumulating
  // event-loop slop.
  let pollIndex = 0;

  let liveReport = $state<MemoryReport | null>(null);
  let snapshotReport = $state<MemoryReport | null>(null);
  let snapshotReady = $state(false);
  let chartHoverSample = $state<MemorySample | null>(null);

  const displayReport = $derived.by<MemoryReport | null>(() => {
    // While the user is hovering the live trend chart, the per-process panel
    // mirrors the hovered sample so we do not have to draw a duplicate
    // tooltip below the plot. Falls back to live or snapshot otherwise.
    if (perfLive && chartHoverSample && liveReport) {
      return {
        processes: chartHoverSample.processes.map((p) => ({ name: p.name, mb: p.mb })),
        total_mb: chartHoverSample.totalMb,
        platform: liveReport.platform,
      };
    }
    return perfLive ? liveReport : snapshotReport;
  });

  // Recolor the numbers while hovering so the user can tell at a glance the
  // panel is reflecting a past sample instead of the live reading.
  const showingHoveredSample = $derived(perfLive && chartHoverSample !== null);

  $effect(() => {
    function update() {
      const t = pollIndex * SAMPLE_INTERVAL_MS;
      pollIndex++;
      invoke<MemoryReport>("get_memory_report").then((r) => {
        liveReport = r;
        memorySamples.push({
          t,
          totalMb: r.total_mb,
          processes: r.processes.map((p) => ({ name: p.name, mb: p.mb })),
        });
        if (memorySamples.length > SAMPLE_CAP) memorySamples.shift();
      });
    }
    update();
    const id = setInterval(update, SAMPLE_INTERVAL_MS);
    return () => clearInterval(id);
  });

  let snapshotCountdown = $state(10);

  $effect(() => {
    const tick = setInterval(() => {
      if (snapshotCountdown > 0) snapshotCountdown--;
    }, 1000);
    const timer = setTimeout(() => {
      invoke<MemoryReport>("get_memory_report").then((r) => {
        snapshotReport = r;
        snapshotReady = true;
      });
    }, 10000);
    return () => {
      clearInterval(tick);
      clearTimeout(timer);
    };
  });

  let launchExpanded = $state(false);

  /**
   * Boot timeline rows. Each entry shows the time spent reaching that
   * milestone from the previous one, so the column reads as "this step took
   * X ms." The synthetic `shell-startup` row at the top covers the gap
   * between process spawn and `boot.script-start`. `boot.script-start`
   * itself is the anchor and is omitted: its delta would be 0 by definition.
   * `boot.rawblocks-set` is also omitted because the only work between it
   * and the previous mark is one assignment plus a sync `invalidate()`.
   */
  type BootRow = { label: string; deltaMs: number };
  const HIDDEN_BOOT_TAGS = new Set(["boot.rawblocks-set"]);
  const bootRows = $derived.by<BootRow[]>(() => {
    const rows: BootRow[] = [];
    if (shellStartupMs !== null) {
      rows.push({ label: "shell-startup", deltaMs: shellStartupMs });
    }
    let prev: PerfLogEntry | null = null;
    for (const e of perfLog.entries) {
      if (!e.tag.startsWith("boot.")) continue;
      if (HIDDEN_BOOT_TAGS.has(e.tag)) continue;
      if (prev === null) {
        prev = e;
        continue;
      }
      rows.push({
        label: e.tag.replace(/^boot\./, ""),
        deltaMs: Math.round((e.t - prev.t) * 10) / 10,
      });
      prev = e;
    }
    return rows;
  });

  /**
   * Headline Launch time, derived as the sum of all visible boot row deltas.
   * Computing it client-side from the same data the table renders means the
   * number on top and the rows below are guaranteed to agree.
   */
  const launchMs = $derived.by(() => {
    if (bootRows.length === 0) return null;
    return Math.round(bootRows.reduce((sum, r) => sum + r.deltaMs, 0));
  });

  /**
   * Action chains: pair `<prefix>.start` with the next `<prefix>.paint-done`
   * of the same prefix and report the duration. In-flight chains are hidden
   * until they complete, so the list never shows partial values.
   */
  type ChainRow = {
    prefix: "nav" | "view" | "panel";
    action: string;
    durationMs: number;
  };
  const actionChains = $derived.by<ChainRow[]>(() => {
    const results: ChainRow[] = [];
    const stacks: Record<string, PerfLogEntry[]> = {};
    for (const e of perfLog.entries) {
      const m = /^(nav|view|panel)\.(start|paint-done)$/.exec(e.tag);
      if (!m) continue;
      const prefix = m[1];
      const sub = m[2];
      if (sub === "start") {
        (stacks[prefix] ??= []).push(e);
        continue;
      }
      const start = stacks[prefix]?.pop();
      if (!start) continue;
      const d = start.detail ?? {};
      let action = "";
      if (prefix === "nav") action = String(d.dir ?? "");
      else if (prefix === "view") action = `${d.from} -> ${d.to}`;
      else if (prefix === "panel") action = String(d.mode ?? "");
      results.push({
        prefix: prefix as ChainRow["prefix"],
        action,
        durationMs: Math.round((e.t - start.t) * 10) / 10,
      });
    }
    return results;
  });

  // Pin the chain list scroll to the bottom on new entries so the latest
  // action is always in view.
  let speedLogEl = $state<HTMLDivElement | undefined>(undefined);
  $effect(() => {
    void actionChains.length;
    if (speedLogEl) speedLogEl.scrollTop = speedLogEl.scrollHeight;
  });

  function formatBootRowText(row: BootRow): string {
    return `  ${row.label.padEnd(20)} ${row.deltaMs} ms`;
  }

  function formatChainRowText(row: ChainRow): string {
    return `  ${row.prefix.padEnd(6)} ${row.action.padEnd(16)} ${row.durationMs} ms`;
  }

  function flashCopied(id: string) {
    copiedId = id;
    setTimeout(() => {
      if (copiedId === id) copiedId = null;
    }, 2000);
  }

  function copyToClipboard(id: string, text: string) {
    if (text.length === 0) return;
    navigator.clipboard.writeText(text);
    flashCopied(id);
  }

  function ramReportLines(report: MemoryReport, label: string): string[] {
    const lines: string[] = [`${label} (${report.platform})`, ""];
    lines.push("RAM by process:");
    for (const p of report.processes) {
      lines.push(`  ${p.name}: ${p.mb.toFixed(1)} MB`);
    }
    lines.push(`  Total PSS: ${Math.round(report.total_mb)} MB`);
    return lines;
  }

  function speedLogLines(): string[] {
    if (actionChains.length === 0) return [];
    const lines: string[] = [`Speed log (${actionChains.length} actions):`];
    for (const row of actionChains) {
      lines.push(formatChainRowText(row));
    }
    return lines;
  }

  function launchTableLines(): string[] {
    if (launchMs === null) return [];
    const lines: string[] = [`Launch time: ${launchMs} ms`, ""];
    for (const row of bootRows) {
      lines.push(formatBootRowText(row));
    }
    return lines;
  }

  function copyLiveRam() {
    if (!liveReport) return;
    copyToClipboard("live-ram", ramReportLines(liveReport, "Live RAM").join("\n"));
  }

  function copySnapshotRam() {
    if (!snapshotReport) return;
    copyToClipboard("snapshot-ram", ramReportLines(snapshotReport, "RAM snapshot (10s)").join("\n"));
  }

  function copyChart() {
    copyToClipboard("chart", samplesToCSV(memorySamples));
  }

  function copySpeedLog() {
    copyToClipboard("speed-log", speedLogLines().join("\n"));
  }

  function copyLaunchTable() {
    const lines = launchTableLines();
    if (lines.length === 0) return;
    copyToClipboard("launch", lines.join("\n"));
  }

  async function requestBenchmark(scenarioId: string): Promise<void> {
    try {
      await ensureBenchmarkOverlay();
    } catch (e) {
      console.error("benchmark overlay load failed", e);
      return;
    }
    benchmarkRunner.request(scenarioId);
  }
</script>

<!--
  Stop wheel propagation so scrolling the diagnostics list (or any future
  scrollable region inside the perf popover) does not bubble up to the title
  bar's tab-wheel handler.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="absolute left-1/2 top-10 z-50 w-72 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-3 shadow-lg"
  onwheel={(e) => e.stopPropagation()}
>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2 text-[10px] uppercase tracking-wider">
      <button
        onclick={() => { perfLive = true; }}
        class={cn(
          "transition-colors",
          perfLive ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground/70",
        )}
      >LIVE RAM</button>
      <span class="text-muted-foreground/30">|</span>
      <button
        onclick={() => { perfLive = false; }}
        class={cn(
          "transition-colors",
          !perfLive ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground/70",
        )}
      >RAM SNAPSHOT (10s)</button>
    </div>
    <button
      onclick={() => onPinnedChange(!pinned)}
      class={cn(
        "flex h-5 w-5 items-center justify-center rounded transition-colors",
        pinned ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground",
      )}
      title={pinned ? "Unpin" : "Pin"}
    >
      {#if pinned}
        <Pin size={11} />
      {:else}
        <PinOff size={11} />
      {/if}
    </button>
  </div>

  {#if !perfLive && !snapshotReady}
    <div class="mt-2 text-xs text-muted-foreground">Snapshot in {snapshotCountdown}s...</div>
  {:else if displayReport && displayReport.processes.length > 0}
    <div class="mt-2 space-y-1.5">
      {#each displayReport.processes as proc}
        <div class="flex items-baseline justify-between">
          <span class="text-xs text-muted-foreground">{proc.name}</span>
          <span class={cn("text-[11px] tabular-nums text-foreground", showingHoveredSample && "italic")}>{proc.mb.toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB</span>
        </div>
      {/each}
      <div class="flex items-baseline justify-between">
        <span class="text-xs text-muted-foreground">Total</span>
        <span class={cn("text-[11px] tabular-nums text-foreground", showingHoveredSample && "italic")}>{displayReport.total_mb.toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB</span>
      </div>
    </div>
  {/if}

  {#if perfLive}
    <div class="mt-3">
      <MemoryChart
        samples={memorySamples}
        width={252}
        height={64}
        onhover={(s) => { chartHoverSample = s; }}
      />
    </div>
    <div class="mt-3 grid grid-cols-2 gap-1.5">
      <button
        onclick={copyLiveRam}
        disabled={liveReport === null}
        class="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {#if copiedId === "live-ram"}
          <Check size={11} />
          Copied
        {:else}
          <Copy size={11} />
          Copy live ram
        {/if}
      </button>
      <button
        onclick={copyChart}
        disabled={memorySamples.length === 0}
        class="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {#if copiedId === "chart"}
          <Check size={11} />
          Copied
        {:else}
          <Copy size={11} />
          Copy chart
        {/if}
      </button>
    </div>
  {:else if snapshotReady}
    <button
      onclick={copySnapshotRam}
      class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {#if copiedId === "snapshot-ram"}
        <Check size={11} />
        Copied
      {:else}
        <Copy size={11} />
        Copy snapshot ram
      {/if}
    </button>
  {/if}

  {#if launchMs !== null}
    <div class="mx-0 my-3 h-px bg-border"></div>
    <button
      onclick={() => (launchExpanded = !launchExpanded)}
      class="flex w-full items-center justify-between rounded text-left transition-colors hover:bg-accent"
      title={launchExpanded ? "Hide boot breakdown" : "Show boot breakdown"}
    >
      <span class="text-[10px] uppercase tracking-wider text-foreground">Launch time</span>
      <span class="flex items-center gap-1.5">
        <span class="text-[11px] tabular-nums text-foreground">{launchMs.toLocaleString("en")} ms</span>
        <ChevronDown
          size={11}
          class={cn("text-muted-foreground transition-transform", launchExpanded && "rotate-180")}
        />
      </span>
    </button>
    {#if launchExpanded}
      {#if bootRows.length > 0}
        <div class="perf-scroll mt-1.5 max-h-48 overflow-y-auto rounded border border-border/50 bg-muted/30 px-2 py-1.5 text-[10px] leading-tight">
          {#each bootRows as row (row.label)}
            <div class="flex justify-between text-muted-foreground tabular-nums whitespace-nowrap">
              <span>{row.label}</span>
              <span>{row.deltaMs} ms</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="mt-1.5 text-[10px] text-muted-foreground/60">No boot marks captured.</div>
      {/if}
      <button
        onclick={copyLaunchTable}
        class="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {#if copiedId === "launch"}
          <Check size={11} />
          Copied
        {:else}
          <Copy size={11} />
          Copy launch table
        {/if}
      </button>
    {/if}
  {/if}

  <div class="mx-0 my-3 h-px bg-border"></div>
  <div class="flex items-center justify-between">
    <span class="text-[10px] uppercase tracking-wider text-foreground">
      Speed log ({actionChains.length})
    </span>
    <div class="flex items-center gap-2">
      <button
        onclick={() => setTracking(!perfLog.tracking)}
        class={cn(
          "text-[10px] uppercase tracking-wider transition-colors",
          perfLog.tracking ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground",
        )}
        title={perfLog.tracking
          ? "Stop recording navigation, view, and event panel actions"
          : "Record navigation, view, and event panel actions"}
      >Track: {perfLog.tracking ? "on" : "off"}</button>
      <button
        onclick={clearPerfLog}
        disabled={perfLog.entries.length === 0}
        class="text-[10px] uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground/60"
        title="Clear speed log buffer"
      >Clear</button>
    </div>
  </div>
  {#if actionChains.length > 0}
    <div bind:this={speedLogEl} class="perf-scroll mt-1.5 max-h-48 overflow-y-auto rounded border border-border/50 bg-muted/30 px-2 py-1.5 text-[10px] leading-tight">
      {#each actionChains as row, i (i)}
        <div class="flex justify-between text-muted-foreground tabular-nums whitespace-nowrap">
          <span><span class="text-muted-foreground/60">{row.prefix}</span> {row.action}</span>
          <span>{row.durationMs} ms</span>
        </div>
      {/each}
    </div>
  {:else}
    <div class="mt-1.5 text-[10px] text-muted-foreground/60">
      {perfLog.tracking
        ? "No actions recorded yet. Try navigating, switching view, or opening an event."
        : "Turn on Track to record action durations."}
    </div>
  {/if}
  <button
    onclick={copySpeedLog}
    disabled={actionChains.length === 0}
    class="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
  >
    {#if copiedId === "speed-log"}
      <Check size={11} />
      Copied
    {:else}
      <Copy size={11} />
      Copy speed log
    {/if}
  </button>

  {#if BENCHMARK_SCENARIOS.length > 0}
    <div class="mx-0 my-3 h-px bg-border"></div>
    <div class="flex items-center justify-between">
      <span class="text-[10px] uppercase tracking-wider text-foreground">Benchmarks</span>
      <span class="text-[10px] uppercase tracking-wider text-muted-foreground/60"
        >~80 s, restarts app</span
      >
    </div>
    <div class="mt-1.5 flex flex-col gap-1">
      {#each BENCHMARK_SCENARIOS as scenario (scenario.id)}
        <button
          onclick={() => void requestBenchmark(scenario.id)}
          disabled={benchmarkRunner.status !== "idle"}
          class="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Play size={12} />
          {scenario.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  /*
    Themed thin scrollbar for the diagnostics list. Matches the app's other
    in-popover scrollables by overlaying the theme's border color instead
    of the OS default.
  */
  .perf-scroll {
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .perf-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .perf-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .perf-scroll::-webkit-scrollbar-thumb {
    background-color: var(--border);
    border-radius: 3px;
  }
  .perf-scroll::-webkit-scrollbar-thumb:hover {
    background-color: var(--muted-foreground);
  }
</style>
