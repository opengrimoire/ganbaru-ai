import { getCalendarNavHandle } from "$lib/components/calendar/nav-handle.svelte";
import {
  CORE_BENCHMARK_DATASETS,
  DEFAULT_BENCHMARK_DATASET,
  type BenchmarkDatasetProfile,
  type BenchmarkScenario,
  type BenchmarkSeedHandle,
} from "../types";
import {
  parseCalendarBenchmarkAnchor,
  loadCalendarBenchmarkWindow,
  seedCalendarDataset,
  waitForFrames,
} from "./calendar-utils";

export const startupBootScenario: BenchmarkScenario = {
  id: "startup-boot",
  label: "Startup boot",
  description:
    "Captures repeated process launch samples to usable calendar paint without adding a memory settling window. Use this for startup-time regressions.",
  workload: {
    kind: "startup",
    question: "How fast does the app launch into the calendar?",
    label: "calendar startup launch samples",
    durationMs: 0,
    memoryMode: "none",
  },
  defaultDataset: DEFAULT_BENCHMARK_DATASET,
  benchmarkDatasets: [...CORE_BENCHMARK_DATASETS],

  async setup(): Promise<void> {
    const handle = getCalendarNavHandle();
    if (!handle.available) {
      throw new Error("Calendar view is not mounted; cannot run startup benchmark");
    }
    handle.setViewMode("week");
    handle.setAnchorDate(parseCalendarBenchmarkAnchor());
    await loadCalendarBenchmarkWindow("week");
    await waitForFrames(1);
  },

  async runWorkload(): Promise<void> {
    await waitForFrames(1);
  },

  async seed(dataset: BenchmarkDatasetProfile): Promise<BenchmarkSeedHandle> {
    return seedCalendarDataset(dataset);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The isolated benchmark DB is deleted after the run.
  },
};
