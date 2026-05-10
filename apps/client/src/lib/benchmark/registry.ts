/**
 * Registry of installed benchmark scenarios. Adding a scenario means
 * dropping a new module under `scenarios/` and pushing it onto this
 * array. The Settings developer section reads this list directly so a
 * new scenario surfaces in the UI without any other UI change.
 *
 * Order is rendered order; keep startup and memory baselines first so
 * pasted suite output is easy to place in PERFORMANCE.md.
 */
import type { BenchmarkScenario } from "./types";
import { startupBootScenario } from "./scenarios/startup-boot";
import { idleMemoryScenario } from "./scenarios/idle-memory";
import { calendarNavScenario } from "./scenarios/calendar-nav";
import { eventPanelOpenScenario } from "./scenarios/event-panel-open";
import { calendarCreateCancelScenario } from "./scenarios/calendar-create-cancel";
import { calendarWriteOpsScenario } from "./scenarios/calendar-write-ops";
import { calendarImportOpsScenario } from "./scenarios/calendar-import-ops";
import { themePersistenceOpsScenario } from "./scenarios/theme-persistence-ops";
import { pomodoroPersistenceOpsScenario } from "./scenarios/pomodoro-persistence-ops";

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  startupBootScenario,
  idleMemoryScenario,
  calendarNavScenario,
  eventPanelOpenScenario,
  calendarCreateCancelScenario,
  calendarWriteOpsScenario,
  calendarImportOpsScenario,
  themePersistenceOpsScenario,
  pomodoroPersistenceOpsScenario,
];

export function getScenarioById(id: string): BenchmarkScenario | undefined {
  return BENCHMARK_SCENARIOS.find((s) => s.id === id);
}
