/**
 * Week-view forward-nav scenario. Drives `navigate("forward")` once per
 * animation frame for the full stress window, which is the closest
 * automation can get to the user's "hold right arrow" measurement loop
 * without depending on real keyboard input timing.
 *
 * Seeding lays down a versioned dense calendar in the isolated
 * benchmark DB so the dense dataset compares across builds. `cleanup` is a no-op:
 * the entire benchmark DB file is deleted on summary close, so
 * per-calendar deletion would be redundant.
 */
import { getCalendarNavHandle } from "$lib/components/calendar/nav-handle.svelte";
import {
  CORE_BENCHMARK_DATASETS,
  DEFAULT_BENCHMARK_DATASET,
  STRESS_DURATION_MS,
  type BenchmarkDatasetProfile,
  type BenchmarkScenario,
  type BenchmarkSeedHandle,
} from "../types";
import {
  loadCalendarBenchmarkWindow,
  parseCalendarBenchmarkAnchor,
  seedCalendarDataset,
} from "./calendar-utils";

export const calendarNavScenario: BenchmarkScenario = {
  id: "calendar-nav",
  label: "Calendar week-view nav",
  description:
    "Drives forward week-view navigation for 3 seconds, then samples memory while the page settles. It runs against an empty baseline plus 1-year and 10-year dense calendars. All datasets use an isolated benchmark DB; your real calendar is never touched.",
  workload: {
    kind: "stress-memory",
    question: "How much memory does repeated week navigation use?",
    label: "programmatic week-view navigation stress",
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

  runWorkload(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const handle = getCalendarNavHandle();
      const start = performance.now();
      let rafId = 0;

      const onAbort = () => {
        cancelAnimationFrame(rafId);
        resolve();
      };
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });

      function step() {
        if (signal.aborted) {
          resolve();
          return;
        }
        const elapsed = performance.now() - start;
        if (elapsed >= STRESS_DURATION_MS) {
          signal.removeEventListener("abort", onAbort);
          resolve();
          return;
        }
        handle.navigate("forward");
        rafId = requestAnimationFrame(step);
      }

      rafId = requestAnimationFrame(step);
    });
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
