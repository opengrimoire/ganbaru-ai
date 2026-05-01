/**
 * Type contracts for the in-app performance benchmark harness.
 *
 * The harness drives a deterministic stress sequence (Phase A on user data,
 * Phase B on a synthetic dataset after restart), samples memory across the
 * full GC-decay window, and emits a compact markdown block ready for
 * `docs/PERFORMANCE.md`. The rationale lives in
 * `docs/features/performance-benchmark.md`.
 */
import type { CalendarEvent } from "$lib/components/calendar/types";
import type { PerfLogEntry } from "$lib/stores/perflog.svelte";

/**
 * Cadence pinned in code so historical rows in PERFORMANCE.md stay
 * comparable. Do not let UI parameterize these. See the spec doc for the
 * rationale behind each offset.
 */
export const STRESS_DURATION_MS = 3000;
export const STRESS_PEAK_INTERVAL_MS = 200;
/** Offsets in milliseconds, measured from the moment `runStress` resolves. */
export const SAMPLE_OFFSETS_MS = [0, 5_000, 30_000, 60_000, 180_000, 300_000];
/** Stale state older than this on boot is discarded silently. */
export const STATE_TTL_MS = 60 * 60 * 1000;

/**
 * Bumped manually when the harness output shape, sampling cadence, or synth
 * generator changes in a way that would invalidate cross-build comparison.
 * Stored on the persisted state file so a stale Phase A captured by an old
 * build cannot accidentally feed Phase B on a new build.
 */
export const HARNESS_VERSION = "1";

/** Synth dataset shape version. Bumping this requires renaming the calendar grouping. */
export const SYNTH_VERSION = "v1";

export type SampleLabel = "peak" | "t0" | "+5s" | "+30s" | "+60s" | "+3m" | "+5m";

export const SAMPLE_LABELS: SampleLabel[] = ["peak", "t0", "+5s", "+30s", "+60s", "+3m", "+5m"];

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

/**
 * Boot timing extracted from the perflog ring buffer. The marks the harness
 * cares about exist regardless of whether a benchmark is running, so the
 * runner's job is to filter the snapshot by these tags and compute deltas
 * relative to `boot.script-start` (the first mark fired).
 */
export interface BootTimings {
  /** Tag-keyed milliseconds from `boot.script-start`. Missing marks are omitted. */
  marks: Record<string, number>;
}

/** One phase's complete result: boot, peak, idle curve, plus context. */
export interface PhaseResult {
  /** "A" for the run on user data, "B" for the run on the seeded synthetic data. */
  phase: "A" | "B";
  /** Wall-clock ISO 8601 string captured at the start of the phase. */
  startedAt: string;
  /** Total ms the stress loop ran (should equal STRESS_DURATION_MS within jitter). */
  stressDurationMs: number;
  /** All readings during the stress burst, including the peak. */
  peakSamples: SamplePoint[];
  /** Idle-curve samples at SAMPLE_OFFSETS_MS. `peak` from peakSamples is the first row. */
  curve: SamplePoint[];
  /** Filtered slice of perflog entries scoped to boot of the run that produced this phase. */
  boot: BootTimings;
  /** Number of events in `rawBlocks` at the moment the phase started. */
  eventCountAtStart: number;
}

/**
 * Persisted across the Phase A -> restart -> Phase B boundary. Lives in
 * `app_config_dir/benchmark-state.json` (NOT vault), so a `reset_database`
 * call does not blow it away mid-run, and the file never pollutes the
 * vault folder users back up.
 */
export interface BenchmarkState {
  scenarioId: string;
  /** ISO 8601 from when Phase A started. Drives the stale TTL check. */
  startedAt: string;
  /** Pinned `HARNESS_VERSION` at write time. Mismatch on read clears state. */
  harnessVersion: string;
  /** Synth dataset version pinned at seed time. Currently `v1`. */
  synthVersion: string;
  /** Platform string at write time, just for the markdown header. */
  platform: string;
  /** Phase A result waiting for Phase B to be captured on the next boot. */
  phaseA: PhaseResult;
  /** Calendar id holding the seeded synth events; passed to `cleanup()`. */
  seedHandle: { calendarId: string; eventCount: number };
}

/**
 * Implemented by every scenario module. The runner is scenario-agnostic;
 * adding a new scenario means dropping a new module under
 * `lib/benchmark/scenarios/` and registering it in `registry.ts`.
 */
export interface BenchmarkScenario {
  /** Stable id used in the persisted state file and markdown output. */
  id: string;
  /** Human label rendered on the Settings developer card. */
  label: string;
  /** Short paragraph rendered under the label. Explain what the scenario stresses. */
  description: string;
  /** Default seed size; the developer card shows it so the user can confirm before running. */
  defaultSeedSize: number;
  /**
   * Configure the app into the precondition required by the stress phase.
   * Runs at the start of every phase (A and B).
   */
  setup(): Promise<void>;
  /**
   * Drive the deterministic stress for exactly `STRESS_DURATION_MS`. The
   * runner starts a peak-sampling timer before calling this and stops it
   * after; the scenario keeps the work loop going for the full window.
   */
  runStress(signal: AbortSignal): Promise<void>;
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
  synthVersion: string;
  harnessVersion: string;
  platform: string;
  phaseA: PhaseResult;
  phaseB: PhaseResult;
  /** Peak total memory (MB) observed in either phase. */
  peakTotalMb: number;
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
