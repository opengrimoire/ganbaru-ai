/**
 * Week-view forward-nav scenario. Dispatches the same ArrowRight keydown and
 * keyup events used by a physical held key, then observes CalendarView's real
 * held-navigation controller. This keeps the memory stress representative of
 * a user holding the right arrow instead of a benchmark-only controller.
 *
 * Seeding lays down a versioned dense calendar in the isolated
 * benchmark DB so the dense dataset compares across builds. `cleanup` is a no-op:
 * the entire benchmark DB file is deleted on summary close, so
 * per-calendar deletion would be redundant.
 */
import { getCalendarNavHandle } from "$lib/components/calendar/nav-handle.svelte";
import {
  DEFAULT_BENCHMARK_DATASET,
  HELD_NAVIGATION_DURATION_MS,
  type BenchmarkMetric,
  type BenchmarkDatasetProfile,
  type BenchmarkScenario,
  type BenchmarkScenarioContext,
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
    "Dispatches ArrowRight keydown and keyup for a 3-second hold, using the same window keyboard handler and held-navigation controller as a physical right-arrow hold. It runs against the 1-year practical dense calendar. The isolated benchmark DB keeps your real calendar untouched.",
  workload: {
    kind: "stress-memory",
    question: "How much memory does repeated week navigation use?",
    label: "held right-arrow week-view navigation",
    durationMs: HELD_NAVIGATION_DURATION_MS,
    memoryMode: "post-workload",
  },
  defaultDataset: DEFAULT_BENCHMARK_DATASET,
  runMode: "dense-only",

  async setup(context: BenchmarkScenarioContext): Promise<void> {
    const handle = getCalendarNavHandle();
    if (!handle.available) {
      throw new Error("Calendar view is not mounted; cannot run calendar benchmark");
    }
    handle.setViewMode("week");
    handle.setAnchorDate(parseCalendarBenchmarkAnchor(context.anchorDate));
    await loadCalendarBenchmarkWindow(context.anchorDate, "week");
    // One frame for the view to settle before the held navigation action starts.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    const handle = getCalendarNavHandle();
    let moves = 0;
    let repeats = 0;
    let skippedTicks = 0;

    const stopObserving = handle.observeHeldNavigation((event) => {
      if (event.key !== "ArrowRight") return;
      if (event.type === "hold-start") {
        moves++;
      } else if (event.type === "repeat") {
        moves++;
        repeats++;
      } else if (event.type === "repeat-skip") {
        skippedTicks++;
      }
    });

    dispatchRightArrow("keydown");
    if (moves === 0) {
      stopObserving();
      throw new Error("Calendar benchmark ArrowRight keydown did not start held navigation");
    }

    try {
      await waitForMs(HELD_NAVIGATION_DURATION_MS, signal);
    } finally {
      dispatchRightArrow("keyup");
      stopObserving();
    }

    return [
      { label: "held navigation moves", unit: "count", value: moves },
      { label: "held navigation repeats", unit: "count", value: repeats },
      { label: "held navigation skipped ticks", unit: "count", value: skippedTicks },
    ];
  },

  async seed(
    dataset: BenchmarkDatasetProfile,
    context: BenchmarkScenarioContext,
  ): Promise<BenchmarkSeedHandle> {
    return seedCalendarDataset(dataset, context);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The whole benchmark DB file is deleted on summary close, so
    // per-calendar deletion would just be an extra round-trip against a DB
    // that is about to disappear. The parameter stays in the signature for
    // scenarios that need finer-grained cleanup.
  },
};

function dispatchRightArrow(type: "keydown" | "keyup"): void {
  window.dispatchEvent(new KeyboardEvent(type, {
    key: "ArrowRight",
    code: "ArrowRight",
    bubbles: true,
    cancelable: true,
  }));
}
