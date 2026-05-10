<script lang="ts">
  import { untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import Play from "@lucide/svelte/icons/play";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { cn } from "$lib/utils";
  import { getBenchmarkStatus } from "$lib/stores/benchmarkStatus.svelte";
  import {
    BENCHMARK_SCENARIOS,
    BENCHMARK_SUITES,
    type BenchmarkSuiteMetadata,
  } from "$lib/benchmark/registry";
  import type { BenchmarkScenarioMetadata } from "$lib/benchmark/types";
  import { perfLog, type PerfLogEntry, clear as clearPerfLog, setTracking } from "$lib/stores/perflog.svelte";
  import MemoryChart from "$lib/components/perf/MemoryChart.svelte";
  import type { MemorySample } from "$lib/components/perf/memorySamples";
  import { SAMPLE_CAP, SAMPLE_INTERVAL_MS, samplesToCSV } from "$lib/components/perf/memorySamples";
  import {
    memoryDisplayRows,
    type MemoryDisplayRow,
    type MemoryReport,
    type StartupMemorySnapshot,
  } from "$lib/components/perf/memoryReport";

  let {
    shellStartupMs = null,
    startupMemorySnapshot = { status: "pending" },
    pinned = false,
    onPinnedChange = () => {},
    ensureBenchmarkOverlay = async () => {},
  }: {
    shellStartupMs: number | null;
    startupMemorySnapshot: StartupMemorySnapshot;
    pinned: boolean;
    onPinnedChange: (pinned: boolean) => void;
    ensureBenchmarkOverlay?: () => Promise<void>;
  } = $props();

  const benchmarkStatus = getBenchmarkStatus();
  const sectionDividerClass = "mx-0 my-3 h-px bg-border";

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
  let chartHoverSample = $state<MemorySample | null>(null);
  let expandedBenchmarkSuites = $state<string[]>([]);

  const displayReport = $derived.by<MemoryReport | null>(() => {
    // While the user is hovering the live trend chart, the per-process panel
    // mirrors the hovered sample so we do not have to draw a duplicate
    // tooltip below the plot. Falls back to live or startup snapshot otherwise.
    if (perfLive && chartHoverSample && liveReport) {
      return {
        processes: chartHoverSample.processes.map((p) => ({ name: p.name, mb: p.mb })),
        total_mb: chartHoverSample.totalMb,
        platform: liveReport.platform,
      };
    }
    if (perfLive) return liveReport;
    return startupMemorySnapshot.status === "ready" ? startupMemorySnapshot.report : null;
  });
  const memoryRows = $derived.by<MemoryDisplayRow[]>(() => memoryDisplayRows(displayReport));

  // Recolor the numbers while hovering so the user can tell at a glance the
  // panel is reflecting a past sample instead of the live reading.
  const showingHoveredSample = $derived(perfLive && chartHoverSample !== null);

  $effect(() => {
    function update() {
      const t = untrack(() => {
        const next = pollIndex * SAMPLE_INTERVAL_MS;
        pollIndex++;
        return next;
      });
      invoke<MemoryReport>("get_memory_report")
        .then((r) => {
          liveReport = r;
          memorySamples.push({
            t,
            totalMb: r.total_mb,
            processes: r.processes.map((p) => ({ name: p.name, mb: p.mb })),
          });
          if (memorySamples.length > SAMPLE_CAP) memorySamples.shift();
        })
        .catch((e) => {
          console.warn("[perf] memory report failed:", e);
        });
    }
    update();
    const id = setInterval(update, SAMPLE_INTERVAL_MS);
    return () => clearInterval(id);
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
    steps: { label: string; ms: number }[];
  };
  type PendingChain = { start: PerfLogEntry; steps: PerfLogEntry[] };

  function panelRequest(entry: PerfLogEntry): number | undefined {
    const value = entry.detail?.request;
    return typeof value === "number" ? value : undefined;
  }

  function panelStepLabel(tag: string): string {
    if (tag === "panel.module-ready") return "module";
    if (tag === "panel.details-ready") return "details";
    if (tag === "panel.state-open") return "state";
    if (tag === "panel.flush-done") return "flush";
    return tag.replace(/^panel\./, "");
  }

  function findPanelChainIndex(stack: PendingChain[], entry: PerfLogEntry): number {
    const request = panelRequest(entry);
    if (request === undefined) return stack.length - 1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (panelRequest(stack[i].start) === request) return i;
    }
    return -1;
  }

  const actionChains = $derived.by<ChainRow[]>(() => {
    const results: ChainRow[] = [];
    const stacks: Record<string, PendingChain[]> = {};
    for (const e of perfLog.entries) {
      const m = /^(nav|view|panel)\.(start|module-ready|details-ready|state-open|flush-done|paint-done)$/.exec(e.tag);
      if (!m) continue;
      const prefix = m[1];
      const sub = m[2];
      if (sub === "start") {
        (stacks[prefix] ??= []).push({ start: e, steps: [] });
        continue;
      }
      const stack = stacks[prefix];
      if (!stack || stack.length === 0) continue;
      const chainIndex = prefix === "panel" ? findPanelChainIndex(stack, e) : stack.length - 1;
      if (chainIndex < 0) continue;
      const active = stack[chainIndex];
      if (prefix === "panel" && sub !== "paint-done") {
        active.steps.push(e);
        continue;
      }
      const [chain] = stack.splice(chainIndex, 1);
      if (!chain) continue;
      const start = chain.start;
      const d = start.detail ?? {};
      let action = "";
      if (prefix === "nav") action = String(d.dir ?? "");
      else if (prefix === "view") action = `${d.from} -> ${d.to}`;
      else if (prefix === "panel") {
        const state = d.state ? ` ${d.state}` : "";
        const moduleState = d.module ? `/${d.module}` : "";
        action = `${String(d.mode ?? "")}${state}${moduleState}`;
      }
      results.push({
        prefix: prefix as ChainRow["prefix"],
        action,
        durationMs: Math.round((e.t - start.t) * 10) / 10,
        steps: chain.steps.map((step) => ({
          label: panelStepLabel(step.tag),
          ms: Math.round((step.t - start.t) * 10) / 10,
        })),
      });
    }
    return results;
  });
  const hasSpeedLogEntries = $derived(
    perfLog.entries.some((entry) => !entry.tag.startsWith("boot.")),
  );

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
    const steps = row.steps.length > 0
      ? ` (${row.steps.map((step) => `${step.label} ${step.ms} ms`).join(", ")})`
      : "";
    return `  ${row.prefix.padEnd(6)} ${row.action.padEnd(16)} ${row.durationMs} ms${steps}`;
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

  function copyStartupRam() {
    if (startupMemorySnapshot.status !== "ready") return;
    copyToClipboard(
      "startup-ram",
      ramReportLines(startupMemorySnapshot.report, "Startup RAM snapshot (10s)").join("\n"),
    );
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
      const { getBenchmarkRunner } = await import("$lib/stores/benchmarkRunner.svelte");
      getBenchmarkRunner().request(scenarioId);
    } catch (e) {
      console.error("benchmark overlay load failed", e);
    }
  }

  async function requestBenchmarkSuite(suite: BenchmarkSuiteMetadata): Promise<void> {
    try {
      await ensureBenchmarkOverlay();
      const { getBenchmarkRunner } = await import("$lib/stores/benchmarkRunner.svelte");
      getBenchmarkRunner().requestSuite(suite.scenarioIds, suite.label.toLowerCase());
    } catch (e) {
      console.error("benchmark overlay load failed", e);
    }
  }

  function scenariosForSuite(suite: BenchmarkSuiteMetadata): BenchmarkScenarioMetadata[] {
    const suiteIds = new Set(suite.scenarioIds);
    return BENCHMARK_SCENARIOS.filter((scenario) => suiteIds.has(scenario.id));
  }

  function suiteExpanded(suiteId: string): boolean {
    return expandedBenchmarkSuites.includes(suiteId);
  }

  function toggleBenchmarkSuite(suiteId: string): void {
    expandedBenchmarkSuites = suiteExpanded(suiteId)
      ? expandedBenchmarkSuites.filter((id) => id !== suiteId)
      : [...expandedBenchmarkSuites, suiteId];
  }
</script>

<!--
  Stop wheel propagation so scrolling the diagnostics list (or any future
  scrollable region inside the perf popover) does not bubble up to the title
  bar's tab-wheel handler.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="perf-scroll fixed z-50 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-popover px-3 py-3 shadow-lg"
  style="top: calc(var(--titlebar-h) + 4px); right: 8px; width: min(18rem, calc(100vw - 16px)); max-height: calc(100dvh - var(--titlebar-h) - 12px);"
  onwheel={(e) => e.stopPropagation()}
>
  <div class="flex items-center justify-between gap-2">
    <div class="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] uppercase tracking-wider">
      <button
        onclick={() => { perfLive = true; }}
        class={cn(
          "min-w-0 truncate transition-colors",
          perfLive ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground/70",
        )}
      >LIVE RAM</button>
      <span class="text-muted-foreground/30">|</span>
      <button
        onclick={() => { perfLive = false; }}
        class={cn(
          "min-w-0 truncate transition-colors",
          !perfLive ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground/70",
        )}
      >STARTUP RAM (10s)</button>
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

  {#if !perfLive && startupMemorySnapshot.status === "pending"}
    <div class="mt-2 text-xs text-muted-foreground">Startup snapshot pending...</div>
  {:else if !perfLive && startupMemorySnapshot.status === "failed"}
    <div class="mt-2 text-xs text-muted-foreground">Startup snapshot unavailable.</div>
  {/if}

  <div class="mt-2 space-y-1.5" aria-busy={displayReport === null}>
    {#each memoryRows as row (row.label)}
      <div class="flex items-baseline justify-between">
        <span class="text-xs text-muted-foreground">{row.label}</span>
        {#if row.mb === null}
          <span class="min-w-14 text-right text-[11px] tabular-nums text-muted-foreground/50">...</span>
        {:else}
          <span class={cn("min-w-14 text-right text-[11px] tabular-nums text-foreground", showingHoveredSample && "italic")}>{row.mb.toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB</span>
        {/if}
      </div>
    {/each}
  </div>

  {#if perfLive}
    <div class="mt-3 flex justify-center">
      <MemoryChart
        samples={memorySamples}
        width={240}
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
  {:else if startupMemorySnapshot.status === "ready"}
    <button
      onclick={copyStartupRam}
      class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {#if copiedId === "startup-ram"}
        <Check size={11} />
        Copied
      {:else}
        <Copy size={11} />
        Copy startup ram
      {/if}
    </button>
  {/if}

  {#if launchMs !== null}
    <div class={sectionDividerClass}></div>
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
            <div class="flex min-w-0 justify-between gap-2 text-muted-foreground tabular-nums">
              <span class="min-w-0 truncate">{row.label}</span>
              <span class="shrink-0">{row.deltaMs} ms</span>
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

  <div class={sectionDividerClass}></div>
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
        disabled={!hasSpeedLogEntries}
        class="text-[10px] uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground/60"
        title="Clear speed log buffer"
      >Clear</button>
    </div>
  </div>
  {#if actionChains.length > 0}
    <div bind:this={speedLogEl} class="perf-scroll mt-1.5 max-h-48 overflow-y-auto rounded border border-border/50 bg-muted/30 px-2 py-1.5 text-[10px] leading-tight">
      {#each actionChains as row, i (i)}
        <div class="min-w-0 text-muted-foreground tabular-nums">
          <div class="flex min-w-0 justify-between gap-2">
            <span class="min-w-0 truncate"><span class="text-muted-foreground/60">{row.prefix}</span> {row.action}</span>
            <span class="shrink-0">{row.durationMs} ms</span>
          </div>
          {#if row.steps.length > 0}
            <div class="truncate pl-6 text-muted-foreground/60">
              {row.steps.map((step) => `${step.label} ${step.ms} ms`).join("  ")}
            </div>
          {/if}
        </div>
      {/each}
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

  {#if BENCHMARK_SUITES.length > 0}
    <div class={sectionDividerClass}></div>
    <div class="flex items-center justify-between">
      <span class="text-[10px] uppercase tracking-wider text-foreground">Benchmarks</span>
      <span class="text-[10px] uppercase tracking-wider text-muted-foreground/60"
        >restarts app</span
      >
    </div>
    <div class="perf-scroll mt-1.5 flex max-h-56 flex-col gap-1 overflow-y-auto">
      {#each BENCHMARK_SUITES as suite (suite.id)}
        <div class="flex flex-col gap-1">
          <div class="flex gap-1">
            <button
              onclick={() => void requestBenchmarkSuite(suite)}
              disabled={benchmarkStatus.status !== "idle"}
              class="flex h-6 min-w-0 flex-1 items-center justify-start gap-1.5 rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              title={suite.description}
            >
              <Play size={12} class="shrink-0" />
              <span class="truncate">Run {suite.label.toLowerCase()}</span>
            </button>
            <button
              type="button"
              onclick={() => toggleBenchmarkSuite(suite.id)}
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:bg-transparent"
              title={suiteExpanded(suite.id) ? `Hide ${suite.label.toLowerCase()}` : `Show ${suite.label.toLowerCase()}`}
              aria-label={suiteExpanded(suite.id) ? `Hide ${suite.label}` : `Show ${suite.label}`}
              aria-expanded={suiteExpanded(suite.id)}
            >
              <ChevronDown
                size={13}
                class={cn("transition-transform", suiteExpanded(suite.id) && "rotate-180")}
              />
            </button>
          </div>
          {#if suiteExpanded(suite.id)}
            <div class="flex flex-col gap-1">
              {#each scenariosForSuite(suite) as scenario (scenario.id)}
                <button
                  onclick={() => void requestBenchmark(scenario.id)}
                  disabled={benchmarkStatus.status !== "idle"}
                  class="flex h-6 w-full min-w-0 items-center justify-start gap-1.5 rounded-md bg-muted/70 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  title={scenario.description}
                >
                  <Play size={11} class="shrink-0" />
                  <span class="truncate">{scenario.label}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
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
