import { getCalendarNavHandle } from "$lib/components/calendar/nav-handle.svelte";
import { getCalendar } from "$lib/stores/calendar.svelte";
import {
  clear as clearPerfLog,
  perfLog,
  setTracking,
  snapshot as perfSnapshot,
  type PerfLogEntry,
} from "$lib/stores/perflog.svelte";
import {
  DEFAULT_BENCHMARK_DATASET,
  type BenchmarkDatasetProfile,
  type BenchmarkMetric,
  type BenchmarkScenario,
  type BenchmarkScenarioContext,
  type BenchmarkSeedHandle,
} from "../types";
import {
  loadCalendarBenchmarkWindow,
  parseCalendarBenchmarkAnchor,
  seedCalendarDataset,
  timingStatsMetric,
  waitForFrames,
} from "./calendar-utils";

const PANEL_OPEN_RUNS = 10;

type PanelStep = "module" | "details" | "state" | "flush";

interface PanelChain {
  totalMs: number;
  steps: Partial<Record<PanelStep, number>>;
}

function panelRequest(entry: PerfLogEntry): number | undefined {
  const request = entry.detail?.request;
  return typeof request === "number" ? request : undefined;
}

function parseLatestPanelChain(): PanelChain | undefined {
  const entries = perfSnapshot();
  const starts = entries.filter((entry) => entry.tag === "panel.start");
  const start = starts[starts.length - 1];
  if (!start) return undefined;
  const request = panelRequest(start);
  const afterStart = entries.filter((entry) => entry.t >= start.t);
  const find = (tag: string) => afterStart.find((entry) =>
    entry.tag === tag && (request === undefined || panelRequest(entry) === request),
  );
  const done = find("panel.paint-done");
  if (!done) return undefined;
  const stepTags: Record<PanelStep, string> = {
    module: "panel.module-ready",
    details: "panel.details-ready",
    state: "panel.state-open",
    flush: "panel.flush-done",
  };
  const steps: Partial<Record<PanelStep, number>> = {};
  for (const [key, tag] of Object.entries(stepTags) as [PanelStep, string][]) {
    const entry = find(tag);
    if (entry) steps[key] = Math.max(0, entry.t - start.t);
  }
  return {
    totalMs: Math.max(0, done.t - start.t),
    steps,
  };
}

async function measurePanelAction(
  action: () => Promise<boolean>,
): Promise<PanelChain | undefined> {
  const wasTracking = perfLog.tracking;
  clearPerfLog();
  setTracking(true);
  try {
    const opened = await action();
    await waitForFrames(2);
    return opened ? parseLatestPanelChain() : undefined;
  } finally {
    clearPerfLog();
    setTracking(wasTracking);
  }
}

function metricFromChains(label: string, chains: PanelChain[]): BenchmarkMetric {
  return timingStatsMetric(label, chains.map((chain) => chain.totalMs), {
    moduleMs: averageStep(chains, "module"),
    detailsMs: averageStep(chains, "details"),
    stateMs: averageStep(chains, "state"),
    flushMs: averageStep(chains, "flush"),
  });
}

function averageStep(chains: PanelChain[], step: PanelStep): number {
  const values = chains
    .map((chain) => chain.steps[step])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
}

function targetEventTimes(anchorDate: string) {
  return {
    firstStart: `${anchorDate} 09:00`,
    firstEnd: `${anchorDate} 10:00`,
    secondStart: `${anchorDate} 11:00`,
    secondEnd: `${anchorDate} 12:00`,
  };
}

async function ensureTargetEvents(anchorDate: string): Promise<void> {
  const calendarStore = getCalendar();
  const existing = calendarStore.rawBlocks.filter((event) =>
    event.start >= `${anchorDate} 00:00`
    && event.start <= `${anchorDate} 23:59`,
  );
  if (existing.length >= 2) return;
  const times = targetEventTimes(anchorDate);
  await calendarStore.addBlock({
    title: "Benchmark panel target 1",
    start: times.firstStart,
    end: times.firstEnd,
    description: "Deterministic event used by the event-panel-open benchmark.",
  });
  await calendarStore.addBlock({
    title: "Benchmark panel target 2",
    start: times.secondStart,
    end: times.secondEnd,
    description: "Second deterministic event used by the switch benchmark.",
  });
}

export const eventPanelOpenScenario: BenchmarkScenario = {
  id: "event-panel-open",
  label: "Event panel open",
  description:
    "Measures edit-panel open from a closed calendar and switch while the panel is already mounted. It reports the same module, details, state, flush, and paint timing pieces shown in the Speed log.",
  workload: {
    kind: "interaction-latency",
    question: "How quickly does the event panel paint for existing events?",
    label: "scripted event-panel open interactions",
    durationMs: 0,
    memoryMode: "none",
  },
  defaultDataset: DEFAULT_BENCHMARK_DATASET,
  runMode: "dense-only",

  async setup(context: BenchmarkScenarioContext): Promise<void> {
    const handle = getCalendarNavHandle();
    if (!handle.available) {
      throw new Error("Calendar view is not mounted; cannot run event-panel benchmark");
    }
    handle.setViewMode("week");
    handle.setAnchorDate(parseCalendarBenchmarkAnchor(context.anchorDate));
    await loadCalendarBenchmarkWindow(context.anchorDate, "week");
    await ensureTargetEvents(context.anchorDate);
    await waitForFrames(2);
    await handle.closePanel();
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    const handle = getCalendarNavHandle();
    const openChains: PanelChain[] = [];
    const switchChains: PanelChain[] = [];

    for (let i = 0; i < PANEL_OPEN_RUNS; i++) {
      throwIfAborted(signal);
      const firstIndex = i % 2;
      const secondIndex = firstIndex === 0 ? 1 : 0;

      await handle.closePanel();
      const openChain = await measurePanelAction(() => handle.openVisibleEvent(firstIndex));
      if (openChain) openChains.push(openChain);

      throwIfAborted(signal);
      const switchChain = await measurePanelAction(() => handle.openVisibleEvent(secondIndex));
      if (switchChain) switchChains.push(switchChain);
    }

    await handle.closePanel();

    return [
      metricFromChains("edit open from closed avg", openChains),
      metricFromChains("edit switch while open avg", switchChains),
    ];
  },

  async seed(
    dataset: BenchmarkDatasetProfile,
    context: BenchmarkScenarioContext,
  ): Promise<BenchmarkSeedHandle> {
    return seedCalendarDataset(dataset, context);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The isolated benchmark DB is deleted after the run.
  },
};
