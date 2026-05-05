/**
 * Type contracts for the in-app performance benchmark harness.
 *
 * The harness drives deterministic workloads twice (Phase A on an empty
 * baseline DB, Phase B on a 1000-event synthetic dataset) and emits compact
 * markdown ready for `docs/PERFORMANCE.md`. Each scenario declares whether
 * it measures startup, memory, or feature latency so the runner avoids
 * unrelated waits. Both phases run after a cold restart against an isolated
 * `ganbaruai-benchmark.db` so the user's real DB and vault are never touched.
 * The rationale lives in `docs/features/performance-benchmark.md`.
 */
import type { CalendarEvent } from "$lib/components/calendar/types";

/**
 * Cadence pinned in code so historical rows in PERFORMANCE.md stay
 * comparable. Do not let UI parameterize these. See the spec doc for the
 * rationale behind each offset.
 */
export const STRESS_DURATION_MS = 3000;
export const STRESS_PEAK_INTERVAL_MS = 200;
/**
 * Offsets in milliseconds, measured from the moment `runWorkload` resolves.
 *
 * v2 cuts the curve to a single +30s reading. Empirically (2026-05-01) the
 * GC sweep that drops 60-100 MB lands between t0 and +30s; everything
 * after +30s sits in a flat ~10 MB jitter band. The +30s point preserves
 * the cross-build comparable signal at a fraction of the wall time. See
 * the spec doc for the data and the "bounded-window asymptote" caveat.
 */
export const SAMPLE_OFFSETS_MS = [30_000];
/** Stale state older than this on boot is discarded silently. */
export const STATE_TTL_MS = 60 * 60 * 1000;

/**
 * Bumped manually when the harness output shape, sampling cadence, or synth
 * generator changes in a way that would invalidate cross-build comparison.
 * Stored on the persisted state file so a stale Phase A captured by an old
 * build cannot accidentally feed Phase B on a new build.
 *
 * v4 (2026-05-04): question-oriented scenarios with explicit memory
 * sampling modes and primary-metric output. v1/v2/v3 state files are
 * silently discarded on read.
 */
export const HARNESS_VERSION = "4";

/** Synth dataset shape version. Bumping this requires renaming the calendar grouping. */
export const SYNTH_VERSION = "v1";

export type SampleLabel = string;

/**
 * Compact form like `+30s` used as a `SampleLabel` and as a column header
 * in the markdown output. Derived from a `SAMPLE_OFFSETS_MS` entry so the
 * label cannot drift away from the offset that produced it.
 */
export function formatOffsetLabel(ms: number): string {
  return `+${Math.round(ms / 1000)}s`;
}

/**
 * Human-readable form like `+30 s` used in the prose methodology line of
 * the markdown output. Same source of truth as `formatOffsetLabel`, with a
 * space so the rendered sentence reads naturally.
 */
export function formatOffsetProse(ms: number): string {
  return `+${Math.round(ms / 1000)} s`;
}

export const SAMPLE_LABELS: SampleLabel[] = [
  "peak",
  "t0",
  ...SAMPLE_OFFSETS_MS.map(formatOffsetLabel),
];

/** Single memory reading at one sample point. MB units, PSS on Linux, RSS on Windows. */
export interface SamplePoint {
  label: SampleLabel;
  /** Milliseconds since the stress phase resolved. `peak` carries the peak's offset. */
  tMs: number;
  totalMb: number;
  backendMb: number;
  frontendMb: number;
  networkMb: number;
}

export type BenchmarkQuestionKind =
  | "startup"
  | "idle-memory"
  | "stress-memory"
  | "interaction-latency"
  | "operation-latency";

export type BenchmarkMemoryMode = "none" | "post-workload";

export interface BenchmarkWorkload {
  /** Primary question this scenario answers. Controls markdown output shape. */
  kind: BenchmarkQuestionKind;
  /** Human-readable question shown in docs and benchmark output. */
  question: string;
  /** Short phrase used in methodology output, e.g. "programmatic week-view navigation". */
  label: string;
  /**
   * Target wall time for fixed-window workloads. Interaction and operation
   * benchmarks can use `0` when they finish after their measured actions.
   */
  durationMs: number;
  /** Whether the runner should sample workload peak, t0, and post-workload RAM. */
  memoryMode: BenchmarkMemoryMode;
}

export type BenchmarkMetricUnit = "ms" | "count";

export interface BenchmarkMetric {
  /** Stable row label within a scenario, e.g. `edit open from closed`. */
  label: string;
  unit: BenchmarkMetricUnit;
  value: number;
  /** Optional scalar breakdown, such as `moduleMs`, `detailsMs`, or row counts. */
  details?: Record<string, string | number>;
}

/**
 * Boot timing extracted from the perflog ring buffer. The marks the harness
 * cares about exist regardless of whether a benchmark is running, so the
 * runner's job is to filter the snapshot by these tags and compute deltas
 * relative to `boot.script-start` (the first mark fired).
 */
export interface BootTimings {
  /** Tag-keyed milliseconds from `boot.script-start`. Missing marks are omitted. */
  marks: Record<string, number>;
  /**
   * Process-spawn to first-paint time, derived from the boot baseline and
   * the first-paint mark. Optional when either input is unavailable.
   */
  launchTotalMs?: number;
}

/** One phase's complete result: boot, optional memory samples, metrics, plus context. */
export interface PhaseResult {
  /** "A" for the empty-baseline run, "B" for the synth-seeded run. */
  phase: "A" | "B";
  /** Wall-clock ISO 8601 string captured at the start of the phase. */
  startedAt: string;
  /** Total ms the scenario workload ran. */
  workloadDurationMs: number;
  /** All readings during workloads that opt into memory sampling. */
  peakSamples: SamplePoint[];
  /** Post-workload samples for memory benchmarks. Empty for latency-only scenarios. */
  curve: SamplePoint[];
  /** Optional scenario-specific timings or counters captured during the workload. */
  metrics?: BenchmarkMetric[];
  /** Filtered slice of perflog entries scoped to boot of the run that produced this phase. */
  boot: BootTimings;
  /**
   * Wall-clock launch time, in ms, derived from the stored shell baseline
   * plus the first-paint mark. Anchored to Rust process spawn
   * (`PROCESS_START`), which fires before WebKit loads the document, so a
   * build that improves Tauri/WebKit shell startup shows here even when
   * JS-anchored marks stay flat. Optional because older runs may not have
   * captured it.
   */
  startupMs?: number;
  /** Number of events in `rawBlocks` at the moment the phase started. */
  eventCountAtStart: number;
}

/**
 * Persisted across each restart in the benchmark sequence. Lives in
 * `app_config_dir/benchmark-state.json` (NOT vault), so a `reset_database`
 * call does not blow it away mid-run, and the file never pollutes the
 * vault folder users back up.
 *
 * The harness writes this file twice per run: once after the user
 * confirms (`stage: "phase-a-pending"`) and again after Phase A finishes
 * (`stage: "phase-b-pending"`, carrying `phaseA` and `seedHandle`). The
 * boot path reads `vaultMode` to decide which DB file to open before any
 * scenario logic runs.
 */
export interface BenchmarkState {
  scenarioId: string;
  /** ISO 8601 from when the run was confirmed. Drives the stale TTL check. */
  startedAt: string;
  /** Pinned `HARNESS_VERSION` at write time. Mismatch on read clears state. */
  harnessVersion: string;
  /** Synth dataset version pinned at seed time. Currently `v1`. */
  synthVersion: string;
  /** Platform string at write time, just for the markdown header. */
  platform: string;
  /**
   * Which DB the next boot should open. `"benchmark"` routes
   * `db.ts:resolveUrl()` to the isolated `ganbaruai-benchmark.db`; the
   * user's real DB stays untouched. Always `"benchmark"` for the current
   * harness; the field exists to make the boot path's decision explicit
   * and to leave room for future scenarios that need user-DB access.
   */
  vaultMode: "user" | "benchmark";
  /** Which phase the runner should execute on the next boot. */
  stage: "phase-a-pending" | "phase-b-pending";
  /** Phase A result, present once Phase A has run (i.e., from `phase-b-pending` onward). */
  phaseA?: PhaseResult;
  /** Calendar id holding the seeded synth events; absent during `phase-a-pending`. */
  seedHandle?: { calendarId: string; eventCount: number };
  /** Present when the user chose Run all instead of one scenario. */
  suite?: BenchmarkSuiteState;
}

export interface BenchmarkSuiteState {
  scenarioIds: string[];
  index: number;
  results: BenchmarkResult[];
}

/**
 * Implemented by every scenario module. The runner is scenario-agnostic;
 * adding a new scenario means dropping a new module under
 * `lib/benchmark/scenarios/` and registering it in `registry.ts`.
 */
export interface BenchmarkScenario {
  /** Stable id used in the persisted state file and markdown output. */
  id: string;
  /** Human label rendered on the perf-panel Run button. */
  label: string;
  /** Short paragraph rendered as a tooltip on hover. Explain what the scenario stresses. */
  description: string;
  /** Workload shape used by the runner and markdown formatter. */
  workload: BenchmarkWorkload;
  /** Default seed size used by `seed()` for Phase B. */
  defaultSeedSize: number;
  /**
   * Configure the app into the precondition required by the stress phase.
   * Runs at the start of every phase (A and B).
   */
  setup(): Promise<void>;
  /**
   * Drive the deterministic workload. The scenario keeps the work loop
   * going for `workload.durationMs` only when it needs a fixed window. It
   * may return scenario-specific metrics for the markdown summary.
   */
  runWorkload(signal: AbortSignal): Promise<void | BenchmarkMetric[]>;
  /**
   * Seed the synthetic dataset for Phase B. Called once between Phase A and
   * the restart. Returns a handle that `cleanup()` can use to undo.
   */
  seed(version: string, seedSize: number): Promise<{ calendarId: string; eventCount: number }>;
  /**
   * Undo whatever `seed()` created. Runs on summary close, on cancel, and
   * on stale-state cleanup at boot.
   */
  cleanup(seedHandle: { calendarId: string }): Promise<void>;
}

/** A whole benchmark run after Phase B completes. */
export interface BenchmarkResult {
  scenarioId: string;
  scenarioLabel: string;
  workload: BenchmarkWorkload;
  synthVersion: string;
  harnessVersion: string;
  platform: string;
  phaseA: PhaseResult;
  phaseB: PhaseResult;
  /** Peak total memory (MB) observed in either phase, present only for memory benchmarks. */
  peakTotalMb?: number;
}

/** Synthetic event shape produced by the v1 generator. */
export interface SynthEventDraft {
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  recurrence?: CalendarEvent["recurrence"];
  alarms?: CalendarEvent["alarms"];
  attendees?: CalendarEvent["attendees"];
}
