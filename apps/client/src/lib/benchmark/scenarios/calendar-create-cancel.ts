import { getCalendarNavHandle } from "$lib/components/calendar/nav-handle.svelte";
import {
  clear as clearPerfLog,
  perfLog,
  setTracking,
  snapshot as perfSnapshot,
  type PerfLogEntry,
} from "$lib/stores/perflog.svelte";
import {
  CORE_SYNTHETIC_SEED_SIZES,
  DEFAULT_SYNTHETIC_SEED_SIZE,
  type BenchmarkMetric,
  type BenchmarkScenario,
} from "../types";
import {
  CALENDAR_BENCHMARK_ANCHOR_ISO,
  loadCalendarBenchmarkWindow,
  parseCalendarBenchmarkAnchor,
  seedCalendarSynth,
  timingStatsMetric,
  waitForFrames,
  waitForMs,
} from "./calendar-utils";

const CREATE_START = `${CALENDAR_BENCHMARK_ANCHOR_ISO} 13:00`;
const CREATE_END = `${CALENDAR_BENCHMARK_ANCHOR_ISO} 13:30`;
const CREATE_CLOSE_GUARD_MS = 500;
const CREATE_CANCEL_RUNS = 6;

function panelRequest(entry: PerfLogEntry): number | undefined {
  const request = entry.detail?.request;
  return typeof request === "number" ? request : undefined;
}

function latestCreateOpenMs(): number {
  const entries = perfSnapshot();
  const starts = entries.filter((entry) =>
    entry.tag === "panel.start" && entry.detail?.mode === "create",
  );
  const start = starts[starts.length - 1];
  if (!start) return Number.NaN;
  const request = panelRequest(start);
  const done = entries.find((entry) =>
    entry.t >= start.t
    && entry.tag === "panel.paint-done"
    && (request === undefined || panelRequest(entry) === request),
  );
  return done ? Math.max(0, done.t - start.t) : Number.NaN;
}

async function measureCreateOpen(): Promise<number> {
  const handle = getCalendarNavHandle();
  const wasTracking = perfLog.tracking;
  clearPerfLog();
  setTracking(true);
  try {
    await handle.openCreatePanel(CREATE_START, CREATE_END, false);
    await waitForFrames(2);
    return latestCreateOpenMs();
  } finally {
    clearPerfLog();
    setTracking(wasTracking);
  }
}

async function measureCreateCancel(signal: AbortSignal): Promise<number> {
  const handle = getCalendarNavHandle();
  await waitForMs(CREATE_CLOSE_GUARD_MS + 40, signal);
  const started = performance.now();
  await handle.closePanel();
  await waitForFrames(2);
  return performance.now() - started;
}

export const calendarCreateCancelScenario: BenchmarkScenario = {
  id: "calendar-create-cancel",
  label: "Calendar create cancel",
  description:
    "Opens a create panel on a deterministic empty slot, waits past the close guard, then cancels it. This protects the create-preview teardown path that is separate from editing an existing event.",
  workload: {
    kind: "interaction-latency",
    question: "How quickly does the create panel open and cancel?",
    label: "scripted create-panel open and cancel",
    durationMs: 0,
    memoryMode: "none",
  },
  defaultSeedSize: DEFAULT_SYNTHETIC_SEED_SIZE,
  syntheticSeedSizes: [...CORE_SYNTHETIC_SEED_SIZES],

  async setup(): Promise<void> {
    const handle = getCalendarNavHandle();
    if (!handle.available) {
      throw new Error("Calendar view is not mounted; cannot run create-cancel benchmark");
    }
    handle.setViewMode("week");
    handle.setAnchorDate(parseCalendarBenchmarkAnchor());
    await loadCalendarBenchmarkWindow("week");
    await waitForFrames(2);
    await handle.closePanel();
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    const openMs: number[] = [];
    const cancelMs: number[] = [];

    for (let i = 0; i < CREATE_CANCEL_RUNS; i++) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      openMs.push(await measureCreateOpen());
      cancelMs.push(await measureCreateCancel(signal));
    }

    return [
      timingStatsMetric("create panel open avg", openMs),
      timingStatsMetric("create cancel after guard avg", cancelMs, { guardMs: CREATE_CLOSE_GUARD_MS }),
    ];
  },

  async seed(version: string, seedSize: number): Promise<{ calendarId: string; eventCount: number }> {
    return seedCalendarSynth(version, seedSize);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The isolated benchmark DB is deleted after the run.
  },
};
