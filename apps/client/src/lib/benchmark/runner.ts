/**
 * Phase orchestration for the benchmark harness.
 *
 * Public surface:
 * - `runPhaseA(scenario)`: drive the stress on the user's current data.
 * - `persistPhaseA(scenarioId, phaseA, seedHandle)`: save state and trigger restart.
 * - `runPhaseB(scenario, persisted)`: drive the stress on the seeded synth data.
 * - `loadPersistedState()` / `clearPersistedState()`: state file plumbing.
 *
 * The scenario module owns `setup()`, `runStress()`, `seed()`, and
 * `cleanup()`; the runner does not know the difference between a calendar
 * scenario and a future kanban / pomodoro scenario.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  STATE_TTL_MS,
  STRESS_DURATION_MS,
  HARNESS_VERSION,
  SYNTH_VERSION,
  type BenchmarkScenario,
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
 * Run the stress + idle curve sequence for one phase. Counterpart to the
 * scenario contract: the scenario provides `setup()` and `runStress()`,
 * the runner adds peak sampling, the post-stress idle curve, and the
 * boot-mark snapshot.
 */
async function runPhase(opts: {
  phase: "A" | "B";
  scenario: BenchmarkScenario;
  signal: AbortSignal;
  eventCountAtStart: number;
  onCurveProgress?: (label: SampleLabel, total: number, completed: number) => void;
}): Promise<PhaseResult> {
  await opts.scenario.setup();
  if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

  const startedAt = new Date().toISOString();
  const peakSampler = startPeakSampler();

  const stressStarted = performance.now();
  await opts.scenario.runStress(opts.signal);
  const stressDurationMs = performance.now() - stressStarted;

  const peakSamples = await peakSampler.stop();
  if (opts.signal.aborted) throw new DOMException("aborted", "AbortError");

  const t0 = await readMemorySample("t0", 0);
  // The idle curve starts from `t0`; but `t0` itself is also part of the
  // curve, so prepend it before kicking the scheduled offsets.
  const restCurve = await sampleIdleCurve({
    signal: opts.signal,
    onProgress: (label, samples) => {
      opts.onCurveProgress?.(label, 6, samples.length);
    },
  });
  // The first scheduled offset is 0 ms (also "t0" semantically). Drop the
  // duplicate label from the scheduler output so the curve has each label once.
  const dedup = restCurve.filter((s, i) => !(i === 0 && s.label === "t0"));

  return {
    phase: opts.phase,
    startedAt,
    stressDurationMs,
    peakSamples,
    curve: [t0, ...dedup],
    boot: captureBootTimings(),
    eventCountAtStart: opts.eventCountAtStart,
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
        eventCountAtStart: getEventCount(),
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
        eventCountAtStart: getEventCount(),
        onCurveProgress: opts.onCurveProgress,
      });
    },
  };
}

/**
 * Persist Phase A across the restart bridge. The state file lives in
 * `app_config_dir/benchmark-state.json` (NOT vault), so a `reset_database`
 * call only deletes DB files and never touches the harness's bridge.
 */
export async function persistPhaseA(opts: {
  scenarioId: string;
  platform: string;
  phaseA: PhaseResult;
  seedHandle: { calendarId: string; eventCount: number };
}): Promise<void> {
  const state: BenchmarkState = {
    scenarioId: opts.scenarioId,
    startedAt: opts.phaseA.startedAt,
    harnessVersion: HARNESS_VERSION,
    synthVersion: SYNTH_VERSION,
    platform: opts.platform,
    phaseA: opts.phaseA,
    seedHandle: opts.seedHandle,
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
 * clears the file silently and returns `null`. Callers that get a non-null
 * value can safely treat it as a Phase A result waiting for Phase B.
 */
export async function loadPersistedState(): Promise<BenchmarkState | null> {
  const json = await invoke<string | null>("read_benchmark_state");
  if (!json) return null;
  let parsed: BenchmarkState;
  try {
    parsed = JSON.parse(json) as BenchmarkState;
  } catch {
    await clearPersistedState();
    return null;
  }
  if (parsed.harnessVersion !== HARNESS_VERSION) {
    await clearPersistedState();
    return null;
  }
  if (parsed.synthVersion !== SYNTH_VERSION) {
    await clearPersistedState();
    return null;
  }
  const ageMs = Date.now() - new Date(parsed.startedAt).getTime();
  if (Number.isNaN(ageMs) || ageMs > STATE_TTL_MS) {
    await clearPersistedState();
    return null;
  }
  return parsed;
}

export async function clearPersistedState(): Promise<void> {
  await invoke("clear_benchmark_state");
}

/** Confirm that a stress duration was within the expected window. */
export function withinStressBudget(actual: number): boolean {
  // Allow 10% slack either way for jitter.
  return Math.abs(actual - STRESS_DURATION_MS) <= STRESS_DURATION_MS * 0.1;
}
