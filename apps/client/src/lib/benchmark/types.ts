/**
 * Type contracts for the in-app performance benchmark harness.
 *
 * The harness drives deterministic workloads against a baseline dataset and
 * one or more synthetic dataset sizes, then emits compact markdown ready for
 * `docs/PERFORMANCE.md`. Each scenario declares whether it measures startup,
 * memory, or feature latency so the runner avoids unrelated waits. Both
 * passes run after a cold restart against an isolated
 * `ganbaruai-benchmark.db` so the user's real DB and vault are never
 * touched. The rationale lives in `docs/features/performance-benchmark.md`.
 */
import type { CalendarEvent } from "$lib/components/calendar/types";

/**
 * Cadence pinned in code so historical rows in PERFORMANCE.md stay
 * comparable. Do not let UI parameterize these. See the spec doc for the
 * rationale behind each offset.
 */
export const STRESS_DURATION_MS = 3000;
export const STRESS_PEAK_INTERVAL_MS = 200;
/** Number of process launches captured per dataset by the startup benchmark. */
export const STARTUP_SAMPLE_RUNS = 5;
/** Closed-process wait before each startup benchmark relaunch sample. */
export const STARTUP_RELAUNCH_COOLDOWN_MS = 10_000;
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
 * Bumped manually when measurement methodology, sampling cadence, scenario
 * workload, or synth generator changes in a way that would invalidate
 * numeric cross-build comparison. Cosmetic markdown, rendered-preview,
 * wording, and docs changes do not bump this value.
 * Stored on the persisted state file so stale baseline data captured by an
 * old build cannot accidentally feed the synthetic pass on a new build.
 *
 * v7 (2026-05-10): core scenarios add a 10,000-event synthetic pass in the
 * same result as the existing 1,000-event pass.
 * v6 (2026-05-05): startup benchmark uses a closed-process cooldown before
 * repeated relaunch samples.
 * v5 (2026-05-05): startup benchmark reports repeated end-to-end launch
 * stats to a usable calendar paint instead of single launch samples.
 * v4 (2026-05-04): question-oriented scenarios with explicit memory
 * sampling modes and primary-metric output.
 * v1/v2/v3 state files are silently discarded on read.
 */
export const HARNESS_VERSION = "7";

/** Synth dataset shape version. Bumping this requires renaming the calendar grouping. */
export const SYNTH_VERSION = "v1";

/** Default synthetic scale used by all benchmark scenarios. */
export const DEFAULT_SYNTHETIC_SEED_SIZE = 1_000;
/** Large synthetic scale used by core benchmarks to expose growth costs. */
export const LARGE_SYNTHETIC_SEED_SIZE = 10_000;
/** Synthetic scales that core benchmarks must capture for the optimization gate. */
export const CORE_SYNTHETIC_SEED_SIZES = [
  DEFAULT_SYNTHETIC_SEED_SIZE,
  LARGE_SYNTHETIC_SEED_SIZE,
] as const;

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
   * Process-spawn to usable calendar paint time, derived from the boot
   * baseline and `boot.usable-paint`. Optional when either input is
   * unavailable. Older runs may fall back to first paint.
   */
  launchTotalMs?: number;
}

export interface StartupBootSample {
  /** Wall-clock ISO 8601 string captured when the sample was collected. */
  startedAt: string;
  /** Number of events in `rawBlocks` for this launch sample. */
  eventCountAtStart: number;
  /** Boot timings captured from process start to usable calendar paint. */
  boot: BootTimings;
}

/** One pass's complete result: boot, optional memory samples, metrics, plus context. */
export interface PhaseResult {
  /** "A" for the baseline run, "B" for the synth-seeded run. */
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
   * End-to-end launch time, in ms, derived from Rust process spawn to the
   * usable calendar paint mark. Optional because older runs may not have
   * captured it.
   */
  startupMs?: number;
  /** Individual process-launch samples for startup benchmark phases. */
  startupSamples?: StartupBootSample[];
  /** Number of events in `rawBlocks` at the moment the phase started. */
  eventCountAtStart: number;
}

/**
 * Persisted across each restart in the benchmark sequence. Lives in
 * `app_config_dir/benchmark-state.json` (NOT vault), so a `reset_database`
 * call does not blow it away mid-run, and the file never pollutes the
 * vault folder users back up.
 *
 * The harness writes this file before each intentional restart with a
 * `*-pending` stage, then flips that stage to `*-running` before the
 * measured pass starts. A later boot that sees `*-running` means the
 * process was killed mid-pass, so the runner discards benchmark artifacts
 * instead of resuming from a possibly dirty isolated DB.
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
  /** App version plus git ref at write time, e.g. `0.1.0+a7451de-dirty`. */
  buildRef?: string;
  /**
   * Which DB the next boot should open. `"benchmark"` routes
   * `db.ts:resolveUrl()` to the isolated `ganbaruai-benchmark.db`; the
   * user's real DB stays untouched. Always `"benchmark"` for the current
   * harness; the field exists to make the boot path's decision explicit
   * and to leave room for future scenarios that need user-DB access.
   */
  vaultMode: "user" | "benchmark";
  /** Pending stages intentionally resume; running stages mean interrupted work. */
  stage: "phase-a-pending" | "phase-a-running" | "phase-b-pending" | "phase-b-running";
  /** Baseline result, present once that pass has run (i.e., from `phase-b-pending` onward). */
  phaseA?: PhaseResult;
  /** Calendar id holding the seeded synth events; absent during `phase-a-pending`. */
  seedHandle?: { calendarId: string; eventCount: number };
  /** Synthetic seed sizes to run after the baseline pass. Defaults to the scenario's default size. */
  syntheticSeedSizes?: number[];
  /** Index into `syntheticSeedSizes` for the pending or running synthetic pass. */
  syntheticIndex?: number;
  /** Completed synthetic passes before the pending or running one. */
  syntheticPhases?: PhaseResult[];
  /** Present when the user chose Run all instead of one scenario. */
  suite?: BenchmarkSuiteState;
  /** Accumulated repeated launch samples for the startup benchmark. */
  startupRuns?: StartupRunState;
}

export interface BenchmarkSuiteState {
  scenarioIds: string[];
  index: number;
  results: BenchmarkResult[];
}

export interface StartupRunState {
  targetRuns: number;
  phaseA: PhaseResult[];
  phaseB: PhaseResult[];
}

/**
 * Lightweight scenario data safe to import in normal UI paths. This must not
 * carry executable scenario code or imports that pull in benchmark workloads.
 */
export interface BenchmarkScenarioMetadata {
  /** Stable id used in the persisted state file and markdown output. */
  id: string;
  /** Human label rendered on the perf-panel Run button. */
  label: string;
  /** Short paragraph rendered as a tooltip on hover. Explain what the scenario stresses. */
  description: string;
  /** Workload shape used by the runner and markdown formatter. */
  workload: BenchmarkWorkload;
  /** Default seed size used by `seed()` for the synthetic dataset. */
  defaultSeedSize: number;
  /** Optional ordered synthetic sizes. Defaults to `[defaultSeedSize]`. */
  syntheticSeedSizes?: number[];
}

/**
 * Implemented by every scenario module. The runner is scenario-agnostic;
 * adding a new scenario means dropping a new module under
 * `lib/benchmark/scenarios/` and registering it in `registry.ts`.
 */
export interface BenchmarkScenario extends BenchmarkScenarioMetadata {
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
   * Seed the synthetic dataset. Called once between the baseline pass and
   * the restart. Returns a handle that `cleanup()` can use to undo.
   */
  seed(version: string, seedSize: number): Promise<{ calendarId: string; eventCount: number }>;
  /**
   * Undo whatever `seed()` created. Runs on summary close, on cancel, and
   * on stale-state cleanup at boot.
   */
  cleanup(seedHandle: { calendarId: string }): Promise<void>;
}

/** A whole benchmark run after both passes complete. */
export interface BenchmarkResult {
  scenarioId: string;
  scenarioLabel: string;
  workload: BenchmarkWorkload;
  synthVersion: string;
  harnessVersion: string;
  platform: string;
  buildRef?: string;
  phaseA: PhaseResult;
  phaseB: PhaseResult;
  /** All synthetic passes. When absent, `phaseB` is the only synthetic pass. */
  syntheticPhases?: PhaseResult[];
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
