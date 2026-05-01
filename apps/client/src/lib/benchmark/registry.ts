/**
 * Registry of installed benchmark scenarios. Adding a scenario means
 * dropping a new module under `scenarios/` and pushing it onto this
 * array. The Settings developer section reads this list directly so a
 * new scenario surfaces in the UI without any other UI change.
 *
 * Order is rendered order; keep the first-shipped scenario first to
 * keep historical row ordering in PERFORMANCE.md predictable.
 */
import type { BenchmarkScenario } from "./types";
import { calendarNavScenario } from "./scenarios/calendar-nav";

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  calendarNavScenario,
];

export function getScenarioById(id: string): BenchmarkScenario | undefined {
  return BENCHMARK_SCENARIOS.find((s) => s.id === id);
}
