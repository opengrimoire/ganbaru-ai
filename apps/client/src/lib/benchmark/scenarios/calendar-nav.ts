/**
 * Week-view forward-nav scenario. Drives the same held-arrow cadence used by
 * the calendar UI: one immediate forward move, a hold delay, then gated repeat
 * ticks. This keeps the memory stress representative of a real user holding
 * the right arrow instead of forcing internal frame-rate navigation.
 *
 * Seeding lays down a versioned dense calendar in the isolated
 * benchmark DB so the dense dataset compares across builds. `cleanup` is a no-op:
 * the entire benchmark DB file is deleted on summary close, so
 * per-calendar deletion would be redundant.
 */
import { getCalendarNavHandle } from "$lib/components/calendar/nav-handle.svelte";
import {
  HeldNavigationController,
  NAV_HOLD_DELAY_MS,
  NAV_REPEAT_MS,
} from "$lib/components/calendar/held-navigation";
import {
  CORE_BENCHMARK_DATASETS,
  DEFAULT_BENCHMARK_DATASET,
  STRESS_DURATION_MS,
  type BenchmarkMetric,
  type BenchmarkDatasetProfile,
  type BenchmarkScenario,
  type BenchmarkSeedHandle,
} from "../types";
import {
  loadCalendarBenchmarkWindow,
  parseCalendarBenchmarkAnchor,
  seedCalendarDataset,
  waitForMs,
} from "./calendar-utils";

export const calendarNavScenario: BenchmarkScenario = {
  id: "calendar-nav",
  label: "Calendar week-view nav",
  description:
    "Holds forward week-view navigation for 3 seconds with the same delay, repeat cadence, and readiness gate as the real right-arrow shortcut. It runs against an empty baseline plus 1-year and 10-year dense calendars. All datasets use an isolated benchmark DB; your real calendar is never touched.",
  workload: {
    kind: "stress-memory",
    question: "How much memory does repeated week navigation use?",
    label: "held right-arrow week-view navigation",
    durationMs: STRESS_DURATION_MS,
    memoryMode: "post-workload",
  },
  defaultDataset: DEFAULT_BENCHMARK_DATASET,
  benchmarkDatasets: [...CORE_BENCHMARK_DATASETS],

  async setup(): Promise<void> {
    const handle = getCalendarNavHandle();
    if (!handle.available) {
      throw new Error("Calendar view is not mounted; cannot run calendar benchmark");
    }
    handle.setViewMode("week");
    handle.setAnchorDate(parseCalendarBenchmarkAnchor());
    await loadCalendarBenchmarkWindow("week");
    // One frame for the view to settle before peak sampling starts.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    const handle = getCalendarNavHandle();
    let moves = 0;
    let repeats = 0;
    let skippedTicks = 0;

    const controller = new HeldNavigationController({
      holdDelayMs: NAV_HOLD_DELAY_MS,
      repeatMs: NAV_REPEAT_MS,
      navigate: (direction, source) => {
        moves++;
        if (source === "hold-repeat") repeats++;
        handle.navigate(direction, source);
      },
      canRepeat: () => handle.canRepeatHeldNavigation(),
      mark: (event) => {
        if (event.type === "repeat-skip") skippedTicks++;
      },
    });

    controller.start("ArrowRight", "forward");
    try {
      await waitForMs(STRESS_DURATION_MS, signal);
    } finally {
      controller.stop("ArrowRight");
    }

    return [
      { label: "held navigation moves", unit: "count", value: moves },
      { label: "held navigation repeats", unit: "count", value: repeats },
      { label: "held navigation skipped ticks", unit: "count", value: skippedTicks },
    ];
  },

  async seed(dataset: BenchmarkDatasetProfile): Promise<BenchmarkSeedHandle> {
    return seedCalendarDataset(dataset);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The whole benchmark DB file is deleted on summary close, so
    // per-calendar deletion would just be an extra round-trip against a DB
    // that is about to disappear. The parameter stays in the signature for
    // scenarios that need finer-grained cleanup.
  },
};
