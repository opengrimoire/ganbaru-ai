import { getCalendarNavHandle } from "$lib/components/calendar/nav-handle.svelte";
import {
  CORE_SYNTHETIC_SEED_SIZES,
  DEFAULT_SYNTHETIC_SEED_SIZE,
  STRESS_DURATION_MS,
  type BenchmarkScenario,
} from "../types";
import {
  parseCalendarBenchmarkAnchor,
  loadCalendarBenchmarkWindow,
  seedCalendarSynth,
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
  defaultSeedSize: DEFAULT_SYNTHETIC_SEED_SIZE,
  syntheticSeedSizes: [...CORE_SYNTHETIC_SEED_SIZES],

  async setup(): Promise<void> {
    const handle = getCalendarNavHandle();
    if (!handle.available) {
      throw new Error("Calendar view is not mounted; cannot run idle-memory benchmark");
    }
    handle.setViewMode("week");
    handle.setAnchorDate(parseCalendarBenchmarkAnchor());
    await loadCalendarBenchmarkWindow("week");
    await waitForFrames(1);
  },

  async runWorkload(signal: AbortSignal): Promise<void> {
    await waitForMs(STRESS_DURATION_MS, signal);
  },

  async seed(version: string, seedSize: number): Promise<{ calendarId: string; eventCount: number }> {
    return seedCalendarSynth(version, seedSize);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The isolated benchmark DB is deleted after the run.
  },
};
