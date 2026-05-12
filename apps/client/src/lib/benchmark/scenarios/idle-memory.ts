import { getCalendarNavHandle } from "$lib/components/calendar/nav-handle.svelte";
import {
  CORE_BENCHMARK_DATASETS,
  DEFAULT_BENCHMARK_DATASET,
  STRESS_DURATION_MS,
  type BenchmarkMetric,
  type BenchmarkDatasetProfile,
  type BenchmarkScenario,
  type BenchmarkScenarioContext,
  type BenchmarkSeedHandle,
} from "../types";
import {
  parseCalendarBenchmarkAnchor,
  loadCalendarBenchmarkWindow,
  seedCalendarDataset,
  waitForFrames,
  waitForMs,
} from "./calendar-utils";

export const idleMemoryScenario: BenchmarkScenario = {
  id: "idle-memory",
  label: "Idle memory",
  description:
    "Boots into the calendar and performs no interaction for the workload window. Use this as the canonical idle-RAM baseline instead of manual panel snapshots.",
  workload: {
    kind: "idle-memory",
    question: "How much memory does the calendar hold while idle?",
    label: "idle calendar baseline",
    durationMs: STRESS_DURATION_MS,
    memoryMode: "post-workload",
  },
  defaultDataset: DEFAULT_BENCHMARK_DATASET,
  benchmarkDatasets: [...CORE_BENCHMARK_DATASETS],

  async setup(context: BenchmarkScenarioContext): Promise<void> {
    const handle = getCalendarNavHandle();
    if (!handle.available) {
      throw new Error("Calendar view is not mounted; cannot run idle-memory benchmark");
    }
    handle.setViewMode("week");
    handle.setAnchorDate(parseCalendarBenchmarkAnchor(context.anchorDate));
    await loadCalendarBenchmarkWindow(context.anchorDate, "week");
    await waitForFrames(1);
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    await waitForMs(STRESS_DURATION_MS, signal);
    return [];
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
