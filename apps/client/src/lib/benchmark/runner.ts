/**
 * Phase orchestration for the benchmark harness.
 *
 * Public surface:
 * - `runPhaseA(scenario)` / `runPhaseB(scenario)`: drive the workload for one phase.
 * - `persistPhaseAPending(...)`: write state file before the first restart.
 * - `persistPhaseBPending(...)`: write state file between Phase A and Phase B.
 * - `loadPersistedState()` / `clearPersistedState()`: state file plumbing.
 *
 * The scenario module owns `setup()`, `runWorkload()`, `seed()`, and
 * `cleanup()`; the runner does not know the difference between a calendar
 * scenario and a future kanban / pomodoro scenario.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  STATE_TTL_MS,
  STRESS_DURATION_MS,
  HARNESS_VERSION,
  SYNTH_VERSION,
  SAMPLE_OFFSETS_MS,
  type BenchmarkScenario,
  type BenchmarkSuiteState,
  type BenchmarkState,
  type PhaseResult,
  type SampleLabel,
} from "./types";
import {
  startPeakSampler,
  sampleIdleCurve,
  captureBootTimings,
  readMemorySample,
} from "./sampler";

/**
 * Run one phase. The scenario provides `setup()` and `runWorkload()`;
 * the runner adds boot timing and, only for memory scenarios, peak sampling
 * plus the post-workload idle curve.
 */
async function runPhase(opts: {
  phase: "A" | "B";
  scenario: BenchmarkScenario;
  signal: AbortSignal;
  getEventCount: () => number;
  onCurveProgress?: (label: SampleLabel, total: number, completed: number) => void;
}): Promise<PhaseResult> {
  await opts.scenario.setup();
  if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

  const startedAt = new Date().toISOString();
  const eventCountAtStart = opts.getEventCount();
  const shouldSampleMemory = opts.scenario.workload.memoryMode === "post-workload";
  const peakSampler = shouldSampleMemory ? startPeakSampler() : undefined;

  const workloadStarted = performance.now();
  const maybeMetrics = await opts.scenario.runWorkload(opts.signal);
  const workloadDurationMs = performance.now() - workloadStarted;

  const peakSamples = await peakSampler?.stop() ?? [];
  if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

  let curve = [] as PhaseResult["curve"];
  if (shouldSampleMemory) {
    const t0 = await readMemorySample("t0", 0);
    const restCurve = await sampleIdleCurve({
      signal: opts.signal,
      onProgress: (label, samples) => {
        opts.onCurveProgress?.(label, SAMPLE_OFFSETS_MS.length, samples.length);
      },
    });
    curve = [t0, ...restCurve];
  }

  const boot = captureBootTimings();

  return {
    phase: opts.phase,
    startedAt,
    workloadDurationMs,
    peakSamples,
    curve,
    metrics: maybeMetrics ?? undefined,
    boot,
    startupMs: boot.launchTotalMs,
    eventCountAtStart,
  };
}

export function createRunner(getEventCount: () => number) {
  return {
    async runPhaseA(opts: {
      scenario: BenchmarkScenario;
      signal: AbortSignal;
      onCurveProgress?: (label: SampleLabel, total: number, completed: number) => void;
    }): Promise<PhaseResult> {
      return runPhase({
        phase: "A",
        scenario: opts.scenario,
        signal: opts.signal,
        getEventCount,
        onCurveProgress: opts.onCurveProgress,
      });
    },

    async runPhaseB(opts: {
      scenario: BenchmarkScenario;
      signal: AbortSignal;
      onCurveProgress?: (label: SampleLabel, total: number, completed: number) => void;
    }): Promise<PhaseResult> {
      return runPhase({
        phase: "B",
        scenario: opts.scenario,
        signal: opts.signal,
        getEventCount,
        onCurveProgress: opts.onCurveProgress,
      });
    },
  };
}

/**
 * Persist `phase-a-pending` state, written right after the user confirms.
 * The next cold boot opens the isolated benchmark DB (because
 * `vaultMode === "benchmark"`) and the runner picks up Phase A from
 * `checkAndResume`. State file lives in `app_config_dir/benchmark-state.json`,
 * not the vault.
 */
export async function persistPhaseAPending(opts: {
  scenarioId: string;
  platform: string;
  suite?: BenchmarkSuiteState;
}): Promise<void> {
  const state: BenchmarkState = {
    scenarioId: opts.scenarioId,
    startedAt: new Date().toISOString(),
    harnessVersion: HARNESS_VERSION,
    synthVersion: SYNTH_VERSION,
    platform: opts.platform,
    vaultMode: "benchmark",
    stage: "phase-a-pending",
    suite: opts.suite,
  };
  await invoke("write_benchmark_state", { json: JSON.stringify(state) });
}

/**
 * Persist `phase-b-pending` state, written between Phase A finishing and
 * the second restart. Carries the captured Phase A result and the seed
 * handle so Phase B can reference both after the next cold boot.
 */
export async function persistPhaseBPending(opts: {
  scenarioId: string;
  platform: string;
  startedAt: string;
  phaseA: PhaseResult;
  seedHandle: { calendarId: string; eventCount: number };
  suite?: BenchmarkSuiteState;
}): Promise<void> {
  const state: BenchmarkState = {
    scenarioId: opts.scenarioId,
    startedAt: opts.startedAt,
    harnessVersion: HARNESS_VERSION,
    synthVersion: SYNTH_VERSION,
    platform: opts.platform,
    vaultMode: "benchmark",
    stage: "phase-b-pending",
    phaseA: opts.phaseA,
    seedHandle: opts.seedHandle,
    suite: opts.suite,
  };
  await invoke("write_benchmark_state", { json: JSON.stringify(state) });
}

/** Trigger the relaunch. The Rust command never returns; do not await. */
export function restartApp(): void {
  void invoke("restart_app").catch(() => {
    // The IPC may resolve normally on platforms where the restart returns
    // before the new process kills the old one. Either way, nothing useful
    // can be done here.
  });
}

/**
 * Read the persisted state file from `app_config_dir/benchmark-state.json`.
 * Validates harness version, synth version, and TTL; if any check fails,
 * deletes the benchmark DB and clears the file silently before returning
 * `null`. The DB teardown matters because a stale state file usually
 * implies a stale benchmark DB sitting next to the user's real DB; we
 * want both gone before the next normal boot.
 */
export async function loadPersistedState(): Promise<BenchmarkState | null> {
  const json = await invoke<string | null>("read_benchmark_state");
  if (!json) return null;
  let parsed: BenchmarkState;
  try {
    parsed = JSON.parse(json) as BenchmarkState;
  } catch {
    await discardStaleArtifacts();
    return null;
  }
  if (parsed.harnessVersion !== HARNESS_VERSION) {
    await discardStaleArtifacts();
    return null;
  }
  if (parsed.synthVersion !== SYNTH_VERSION) {
    await discardStaleArtifacts();
    return null;
  }
  const ageMs = Date.now() - new Date(parsed.startedAt).getTime();
  if (Number.isNaN(ageMs) || ageMs > STATE_TTL_MS) {
    await discardStaleArtifacts();
    return null;
  }
  return parsed;
}

async function discardStaleArtifacts(): Promise<void> {
  try {
    await invoke("teardown_benchmark_db");
  } catch (e) {
    console.error("benchmark teardown (stale) failed", e);
  }
  await clearPersistedState();
}

export async function clearPersistedState(): Promise<void> {
  await invoke("clear_benchmark_state");
}

/** Confirm that a stress duration was within the expected window. */
export function withinStressBudget(actual: number): boolean {
  // Allow 10% slack either way for jitter.
  return Math.abs(actual - STRESS_DURATION_MS) <= STRESS_DURATION_MS * 0.1;
}
