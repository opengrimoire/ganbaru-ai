/**
 * Registry of installed benchmark scenarios. Adding a scenario means adding
 * lightweight metadata here and a dynamic loader for the matching module.
 * UI paths read only the metadata list so normal app startup never pulls in
 * scenario implementation modules.
 *
 * Order is rendered order; keep startup and memory baselines first so
 * pasted suite output is easy to place in PERFORMANCE.md.
 */
import {
  CORE_SYNTHETIC_SEED_SIZES,
  DEFAULT_SYNTHETIC_SEED_SIZE,
  STRESS_DURATION_MS,
  type BenchmarkScenario,
  type BenchmarkScenarioMetadata,
} from "./types";

type BenchmarkScenarioLoader = () => Promise<BenchmarkScenario>;

export interface BenchmarkSuiteMetadata {
  id: "core" | "backend" | "all";
  label: string;
  description: string;
  scenarioIds: string[];
}

const CORE_BENCHMARK_SCENARIO_IDS = [
  "startup-boot",
  "idle-memory",
  "calendar-nav",
  "event-panel-open",
  "calendar-create-cancel",
];

const BACKEND_BENCHMARK_SCENARIO_IDS = [
  "calendar-write-ops",
  "calendar-import-ops",
  "theme-persistence-ops",
  "pomodoro-persistence-ops",
];

export const BENCHMARK_SCENARIOS: BenchmarkScenarioMetadata[] = [
  {
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
    defaultSeedSize: DEFAULT_SYNTHETIC_SEED_SIZE,
    syntheticSeedSizes: [...CORE_SYNTHETIC_SEED_SIZES],
  },
  {
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
  },
  {
    id: "calendar-nav",
    label: "Calendar week-view nav",
    description:
      "Drives forward week-view navigation for 3 seconds, then samples memory while the page settles. It runs against an empty baseline plus 1,000-event and 10,000-event synthetic calendars. All datasets use an isolated benchmark DB; your real calendar is never touched.",
    workload: {
      kind: "stress-memory",
      question: "How much memory does repeated week navigation use?",
      label: "programmatic week-view navigation stress",
      durationMs: STRESS_DURATION_MS,
      memoryMode: "post-workload",
    },
    defaultSeedSize: DEFAULT_SYNTHETIC_SEED_SIZE,
    syntheticSeedSizes: [...CORE_SYNTHETIC_SEED_SIZES],
  },
  {
    id: "event-panel-open",
    label: "Event panel open",
    description:
      "Measures edit-panel open from a closed calendar and switch while the panel is already mounted. It reports the same module, details, state, flush, and paint timing pieces shown in the Speed log.",
    workload: {
      kind: "interaction-latency",
      question: "How quickly does the event panel paint for existing events?",
      label: "scripted event-panel open interactions",
      durationMs: 0,
      memoryMode: "none",
    },
    defaultSeedSize: DEFAULT_SYNTHETIC_SEED_SIZE,
    syntheticSeedSizes: [...CORE_SYNTHETIC_SEED_SIZES],
  },
  {
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
  },
  {
    id: "calendar-write-ops",
    label: "Calendar write operations",
    description:
      "Measures Rust-backed calendar event create, patch, delete, detach, and split commands through Tauri IPC against the isolated benchmark DB.",
    workload: {
      kind: "operation-latency",
      question: "How quickly do Rust-backed calendar write commands finish?",
      label: "scripted calendar write commands",
      durationMs: 0,
      memoryMode: "none",
    },
    defaultSeedSize: DEFAULT_SYNTHETIC_SEED_SIZE,
  },
  {
    id: "calendar-import-ops",
    label: "Calendar import operations",
    description:
      "Measures the Rust calendar_bulk_import command for repeated 100-event imports and one 1000-event add/update pass.",
    workload: {
      kind: "operation-latency",
      question: "How quickly does Rust apply typed calendar import payloads?",
      label: "scripted calendar bulk import commands",
      durationMs: 0,
      memoryMode: "none",
    },
    defaultSeedSize: DEFAULT_SYNTHETIC_SEED_SIZE,
  },
  {
    id: "theme-persistence-ops",
    label: "Theme persistence operations",
    description:
      "Measures Rust-backed theme snapshot insert, replace, load, source cascade, and reset commands against normalized theme tables.",
    workload: {
      kind: "operation-latency",
      question: "How quickly do Rust-backed theme persistence commands finish?",
      label: "scripted theme persistence commands",
      durationMs: 0,
      memoryMode: "none",
    },
    defaultSeedSize: DEFAULT_SYNTHETIC_SEED_SIZE,
  },
  {
    id: "pomodoro-persistence-ops",
    label: "Pomodoro persistence operations",
    description:
      "Measures Rust-backed Pomodoro segment insert, update, cleanup, orphan cleanup, and completed-session persistence commands.",
    workload: {
      kind: "operation-latency",
      question: "How quickly do Rust-backed Pomodoro persistence commands finish?",
      label: "scripted Pomodoro persistence commands",
      durationMs: 0,
      memoryMode: "none",
    },
    defaultSeedSize: DEFAULT_SYNTHETIC_SEED_SIZE,
  },
];

export const BENCHMARK_SUITES: BenchmarkSuiteMetadata[] = [
  {
    id: "core",
    label: "Core benchmarks",
    description: "Startup, memory, and user-visible interaction latency.",
    scenarioIds: CORE_BENCHMARK_SCENARIO_IDS,
  },
  {
    id: "backend",
    label: "Backend benchmarks",
    description: "Rust-backed persistence, import, and storage command latency.",
    scenarioIds: BACKEND_BENCHMARK_SCENARIO_IDS,
  },
  {
    id: "all",
    label: "All benchmarks",
    description: "Complete core and backend benchmark suite.",
    scenarioIds: [...CORE_BENCHMARK_SCENARIO_IDS, ...BACKEND_BENCHMARK_SCENARIO_IDS],
  },
];

const SCENARIO_LOADERS: Record<string, BenchmarkScenarioLoader> = {
  "startup-boot": () => import("./scenarios/startup-boot").then((module) => module.startupBootScenario),
  "idle-memory": () => import("./scenarios/idle-memory").then((module) => module.idleMemoryScenario),
  "calendar-nav": () => import("./scenarios/calendar-nav").then((module) => module.calendarNavScenario),
  "event-panel-open": () => import("./scenarios/event-panel-open").then((module) => module.eventPanelOpenScenario),
  "calendar-create-cancel": () => import("./scenarios/calendar-create-cancel")
    .then((module) => module.calendarCreateCancelScenario),
  "calendar-write-ops": () => import("./scenarios/calendar-write-ops")
    .then((module) => module.calendarWriteOpsScenario),
  "calendar-import-ops": () => import("./scenarios/calendar-import-ops")
    .then((module) => module.calendarImportOpsScenario),
  "theme-persistence-ops": () => import("./scenarios/theme-persistence-ops")
    .then((module) => module.themePersistenceOpsScenario),
  "pomodoro-persistence-ops": () => import("./scenarios/pomodoro-persistence-ops")
    .then((module) => module.pomodoroPersistenceOpsScenario),
};

export function getScenarioMetadataById(id: string): BenchmarkScenarioMetadata | undefined {
  return BENCHMARK_SCENARIOS.find((scenario) => scenario.id === id);
}

export function hasScenarioLoader(id: string): boolean {
  return SCENARIO_LOADERS[id] !== undefined;
}

export async function loadScenarioById(id: string): Promise<BenchmarkScenario | undefined> {
  return SCENARIO_LOADERS[id]?.();
}
