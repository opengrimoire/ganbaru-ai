/**
 * Fixed-window calendar memory scenario. It loads the same anchored week for
 * every dataset, waits in place, and reports the current render-window row
 * counts next to memory. This isolates total stored-event scale from visible
 * density so 1-year and 10-year dense datasets can be compared honestly.
 */
import { getCalendar } from "$lib/stores/calendar.svelte";
import { getCalendarNavHandle } from "$lib/components/calendar/nav-handle.svelte";
import { computeViewWindow } from "$lib/components/calendar/utils";
import {
  CORE_BENCHMARK_DATASETS,
  DEFAULT_BENCHMARK_DATASET,
  STRESS_DURATION_MS,
  type BenchmarkDatasetProfile,
  type BenchmarkMetric,
  type BenchmarkScenario,
  type BenchmarkSeedHandle,
} from "../types";
import {
  loadCalendarBenchmarkWindow,
  parseCalendarBenchmarkAnchor,
  seedCalendarDataset,
  waitForFrames,
  waitForMs,
} from "./calendar-utils";

function currentWindowMetrics(): BenchmarkMetric[] {
  const calendarStore = getCalendar();
  const anchor = parseCalendarBenchmarkAnchor();
  const window = computeViewWindow(anchor, "week");
  const events = calendarStore.eventsInWindow(window.start, window.end);
  return [
    { label: "total stored events", unit: "count", value: calendarStore.eventCount },
    { label: "current window rows", unit: "count", value: calendarStore.rawBlocks.length },
    { label: "current window events", unit: "count", value: events.length },
  ];
}

export const calendarWindowScaleScenario: BenchmarkScenario = {
  id: "calendar-window-scale",
  label: "Calendar fixed-window scale",
  description:
    "Loads the same anchored week, performs no navigation, and reports both memory and visible-window row counts for the empty baseline plus 1-year and 10-year dense calendars.",
  workload: {
    kind: "idle-memory",
    question: "How much memory does one fixed calendar window use as stored history grows?",
    label: "fixed anchored week scale check",
    durationMs: STRESS_DURATION_MS,
    memoryMode: "post-workload",
  },
  defaultDataset: DEFAULT_BENCHMARK_DATASET,
  benchmarkDatasets: [...CORE_BENCHMARK_DATASETS],

  async setup(): Promise<void> {
    const handle = getCalendarNavHandle();
    if (!handle.available) {
      throw new Error("Calendar view is not mounted; cannot run fixed-window benchmark");
    }
    handle.setViewMode("week");
    handle.setAnchorDate(parseCalendarBenchmarkAnchor());
    await loadCalendarBenchmarkWindow("week");
    await getCalendar().whenWindowIdle();
    await waitForFrames(1);
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    await waitForMs(STRESS_DURATION_MS, signal);
    return currentWindowMetrics();
  },

  async seed(dataset: BenchmarkDatasetProfile): Promise<BenchmarkSeedHandle> {
    return seedCalendarDataset(dataset);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The isolated benchmark DB is deleted after the run.
  },
};
