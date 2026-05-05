/**
 * Cross-component runner state for the in-app benchmark harness.
 *
 * Mounted once in `TitleBar.svelte` (the same place as the floating theme
 * editor and settings modal). Settings panels call `request()` to ask for
 * a run; the overlay reacts to status transitions.
 *
 * Current flow (cold-cold against an isolated benchmark DB):
 *
 *   idle
 *     -> user clicks Run
 *   confirming
 *     -> user confirms
 *     -> prepare_benchmark_db (idempotent delete of any prior file)
 *     -> persistPhaseAPending(...)
 *     -> restart app, delayed for startup samples            # restart 1
 *   [boot, vaultMode=benchmark, stage=phase-a-pending]
 *     -> SQL plugin opens ganbaruai-benchmark.db (empty)
 *     -> stage becomes phase-a-running
 *     -> checkAndResume runs the baseline pass
 *     -> scenario.seed(synth)
 *     -> persistPhaseBPending(...)
 *     -> restart app, delayed for startup samples            # restart 2
 *   [boot, vaultMode=benchmark, stage=phase-b-pending]
 *     -> SQL plugin opens ganbaruai-benchmark.db (now seeded)
 *     -> stage becomes phase-b-running
 *     -> checkAndResume runs the synthetic pass
 *     -> teardown_benchmark_db (delete files)
 *     -> clear_benchmark_state
 *     -> show summary
 *   summary
 *     -> user clicks Close
 *     -> restart_app                                         # restart 3
 *   [boot, no state, default]
 *     -> SQL plugin opens user DB (untouched throughout)
 *   idle
 *
 * A later boot that sees a `*-running` stage treats the previous process as
 * killed mid-pass, discards the benchmark DB, clears state, and opens the
 * user's real DB. The user's real DB and vault are never opened during an
 * intentional run.
 */
import { invoke } from "@tauri-apps/api/core";
import { BUILD_REF } from "$lib/buildInfo";
import { getCalendar } from "./calendar.svelte";
import {
  STARTUP_RELAUNCH_COOLDOWN_MS,
  STARTUP_SAMPLE_RUNS,
  SYNTH_VERSION,
  type BootTimings,
  type BenchmarkResult,
  type BenchmarkSuiteState,
  type BenchmarkState,
  type BenchmarkScenario,
  type PhaseResult,
  type SampleLabel,
  type StartupBootSample,
  type StartupRunState,
} from "$lib/benchmark/types";
import {
  createRunner,
  persistPhaseAPending,
  persistPhaseBPending,
  persistBenchmarkState,
  restartApp,
  restartAppAfterDelay,
  loadPersistedState,
  clearPersistedState,
} from "$lib/benchmark/runner";
import { BENCHMARK_SCENARIOS, getScenarioById } from "$lib/benchmark/registry";

type Status = "idle" | "confirming" | "running" | "summary" | "error";
type PendingRequest = { mode: "single" | "suite"; scenarioIds: string[] };

export interface RunningInfo {
  phase: "A" | "B";
  scenarioId: string;
  scenarioLabel: string;
  suite?: { index: number; total: number };
  /** Short user-facing label for the current step, e.g. `Stress window: 3 s`. */
  step: string;
  /** Set during the idle-curve schedule so the overlay can show progress. */
  curve?: { done: number; total: number; label: SampleLabel };
}

class BenchmarkRunnerStore {
  status = $state<Status>("idle");
  running = $state<RunningInfo | undefined>(undefined);
  result = $state<BenchmarkResult | null>(null);
  results = $state<BenchmarkResult[]>([]);
  errorMessage = $state<string | undefined>(undefined);
  pendingRequest = $state<PendingRequest | undefined>(undefined);

  #abort: AbortController | null = null;

  /** Open the confirmation dialog for `scenarioId`. */
  request(scenarioId: string) {
    if (this.status !== "idle") return;
    this.pendingRequest = { mode: "single", scenarioIds: [scenarioId] };
    this.status = "confirming";
  }

  /** Open the confirmation dialog for every registered scenario. */
  requestAll() {
    if (this.status !== "idle") return;
    this.pendingRequest = {
      mode: "suite",
      scenarioIds: BENCHMARK_SCENARIOS.map((scenario) => scenario.id),
    };
    this.status = "confirming";
  }

  cancelConfirm() {
    if (this.status !== "confirming") return;
    this.pendingRequest = undefined;
    this.status = "idle";
  }

  get pendingMode(): "single" | "suite" | undefined {
    return this.pendingRequest?.mode;
  }

  get pendingScenarioLabels(): string[] {
    return (this.pendingRequest?.scenarioIds ?? [])
      .map((id) => getScenarioById(id)?.label ?? id);
  }

  /**
   * The user accepted the dialog. Wipe any stale benchmark DB, write the
   * `phase-a-pending` marker, and restart. The baseline pass itself runs
   * after the restart against the freshly-opened isolated DB.
   */
  async confirm() {
    if (this.status !== "confirming") return;
    const pending = this.pendingRequest;
    const scenarioId = pending?.scenarioIds[0];
    if (!pending || !scenarioId) return;
    const scenario = getScenarioById(scenarioId);
    if (!scenario) {
      this.errorMessage = `Unknown scenario: ${scenarioId}`;
      this.status = "error";
      return;
    }
    this.pendingRequest = undefined;

    this.status = "running";
    this.running = {
      phase: "A",
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      suite: pending.mode === "suite" ? { index: 0, total: pending.scenarioIds.length } : undefined,
      step: isStartupScenario(scenario)
        ? `Closing for ${startupCooldownSeconds()} s startup cooldown`
        : "Restarting for baseline dataset",
    };

    try {
      await invoke("prepare_benchmark_db");
      const platform = await this.#detectPlatform();
      await persistPhaseAPending({
        scenarioId: scenario.id,
        platform,
        buildRef: BUILD_REF,
        suite: pending.mode === "suite"
          ? { scenarioIds: pending.scenarioIds, index: 0, results: [] }
          : undefined,
      });
    } catch (e) {
      this.#failWith(`Setup failed: ${this.#errMsg(e)}`);
      return;
    }

    restartForScenario(scenario);
  }

  /**
   * Aborts whatever is running, deletes the benchmark DB, clears state,
   * and restarts the app so the user lands back on their real DB. Safe to
   * call from any non-idle status.
   */
  async cancel() {
    this.#abort?.abort();
    try {
      await invoke("teardown_benchmark_db");
    } catch (e) {
      console.error("benchmark teardown failed", e);
    }
    try {
      await clearPersistedState();
    } catch (e) {
      console.error("benchmark clear state failed", e);
    }
    this.#reset();
    // Restart so the next boot opens the user DB. Without this the SQL
    // plugin keeps the now-deleted benchmark DB connection alive for the
    // rest of the session.
    restartApp();
  }

  /**
   * The summary is a final-state UI; closing it tears down the benchmark
   * DB and restarts so the user resumes against their real DB.
   */
  closeSummary() {
    if (this.status !== "summary" && this.status !== "error") return;
    void this.#finishAndRestart();
  }

  async #finishAndRestart() {
    try {
      await invoke("teardown_benchmark_db");
    } catch (e) {
      console.error("benchmark teardown failed", e);
    }
    try {
      await clearPersistedState();
    } catch (e) {
      console.error("benchmark clear state failed", e);
    }
    this.#reset();
    restartApp();
  }

  /**
   * Boot-time entry point. Reads the persisted state file and dispatches
   * on `state.stage`. Stale or invalid state is silently cleaned up; if
   * no state exists, this is a no-op and the app behaves as a normal boot.
   */
  async checkAndResume() {
    if (this.status !== "idle") return;
    let state: BenchmarkState | null;
    try {
      state = await loadPersistedState();
    } catch (e) {
      console.error("benchmark loadPersistedState failed", e);
      return;
    }
    if (!state) return;

    // `loadPersistedState` already wipes the benchmark DB and clears state
    // on TTL, version mismatch, or an interrupted `*-running` stage.
    // Anything that reaches here has a fresh state file pointing at a valid
    // pending stage; we still defend against a scenario that has been
    // removed and against a `phase-b-pending` state that is missing the data
    // needed to run it.
    const scenario = getScenarioById(state.scenarioId);
    if (!scenario) {
      await this.#abandonStale();
      return;
    }

    if (state.stage === "phase-a-pending") {
      await this.#runPhaseAThenSeed(scenario, state);
    } else if (state.stage === "phase-b-pending") {
      if (!state.phaseA || !state.seedHandle) {
        await this.#abandonStale();
        return;
      }
      await this.#runPhaseB(scenario, state, state.phaseA, state.seedHandle);
    } else {
      await this.#abandonStale();
    }
  }

  async #abandonStale() {
    try {
      await invoke("teardown_benchmark_db");
    } catch (e) {
      console.error("benchmark teardown failed", e);
    }
    try {
      await clearPersistedState();
    } catch (e) {
      console.error("benchmark clear state failed", e);
    }
  }

  async #runPhaseAThenSeed(scenario: BenchmarkScenario, state: BenchmarkState) {
    this.status = "running";
    this.errorMessage = undefined;
    this.running = {
      phase: "A",
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      suite: state.suite
        ? { index: state.suite.index, total: state.suite.scenarioIds.length }
        : undefined,
      step: "Setting up",
    };
    this.#abort = new AbortController();
    const calendarStore = getCalendar();
    const runner = createRunner(() => calendarStore.rawBlocks.length);
    try {
      await persistBenchmarkState({ ...state, stage: "phase-a-running" });
    } catch (e) {
      this.#failWith(`Persisting state failed: ${this.#errMsg(e)}`);
      return;
    }

    let phaseA: PhaseResult;
    try {
      this.#updateStep(this.#workloadStep(scenario, state, "A"));
      phaseA = await runner.runPhaseA({
        scenario,
        signal: this.#abort.signal,
        onCurveProgress: (label, total, done) => {
          this.#updateCurve({ label, total, done });
        },
      });
    } catch (e) {
      if (this.#isAbort(e)) return;
      this.#failWith(`Baseline dataset failed: ${this.#errMsg(e)}`);
      return;
    }
    if (this.#abort?.signal.aborted) return;

    let startupRuns = state.startupRuns;
    if (isStartupScenario(scenario)) {
      startupRuns = appendStartupPhaseRun(startupRuns, "phaseA", phaseA);
      if (startupRuns.phaseA.length < startupRuns.targetRuns) {
        const nextSample = startupRuns.phaseA.length + 1;
        this.#updateStep(
          `Closing for ${startupCooldownSeconds()} s cooldown before baseline launch ${nextSample}/${startupRuns.targetRuns}`,
          true,
        );
        try {
          await persistPhaseAPending({
            scenarioId: scenario.id,
            platform: state.platform,
            buildRef: state.buildRef ?? BUILD_REF,
            startedAt: state.startedAt,
            suite: state.suite,
            startupRuns,
          });
        } catch (e) {
          this.#failWith(`Persisting state failed: ${this.#errMsg(e)}`);
          return;
        }
        restartForScenario(scenario);
        return;
      }
      phaseA = aggregateStartupPhase("A", startupRuns.phaseA);
    }

    this.#updateStep(`Seeding ${scenario.defaultSeedSize} events`, /* clearCurve */ true);
    let seedHandle: { calendarId: string; eventCount: number };
    try {
      seedHandle = await scenario.seed(SYNTH_VERSION, scenario.defaultSeedSize);
    } catch (e) {
      this.#failWith(`Seeding failed: ${this.#errMsg(e)}`);
      return;
    }
    if (this.#abort?.signal.aborted) return;

    this.#updateStep(
      isStartupScenario(scenario)
        ? `Closing for ${startupCooldownSeconds()} s cooldown before synthetic launch 1/${STARTUP_SAMPLE_RUNS}`
        : "Restarting for synthetic dataset",
    );
    try {
      await persistPhaseBPending({
        scenarioId: scenario.id,
        platform: state.platform,
        buildRef: state.buildRef ?? BUILD_REF,
        startedAt: state.startedAt,
        phaseA,
        seedHandle,
        suite: state.suite,
        startupRuns,
      });
    } catch (e) {
      this.#failWith(`Persisting state failed: ${this.#errMsg(e)}`);
      return;
    }

    restartForScenario(scenario);
  }

  async #runPhaseB(
    scenario: BenchmarkScenario,
    state: BenchmarkState,
    phaseA: PhaseResult,
    seedHandle: { calendarId: string; eventCount: number },
  ) {
    this.status = "running";
    this.errorMessage = undefined;
    this.running = {
      phase: "B",
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      suite: state.suite
        ? { index: state.suite.index, total: state.suite.scenarioIds.length }
        : undefined,
      step: "Setting up",
    };
    this.#abort = new AbortController();
    const calendarStore = getCalendar();
    const runner = createRunner(() => calendarStore.rawBlocks.length);
    try {
      await persistBenchmarkState({ ...state, stage: "phase-b-running" });
    } catch (e) {
      this.#failWith(`Persisting state failed: ${this.#errMsg(e)}`);
      return;
    }

    let phaseB: PhaseResult;
    try {
      this.#updateStep(this.#workloadStep(scenario, state, "B"));
      phaseB = await runner.runPhaseB({
        scenario,
        signal: this.#abort.signal,
        onCurveProgress: (label, total, done) => {
          this.#updateCurve({ label, total, done });
        },
      });
    } catch (e) {
      if (this.#isAbort(e)) return;
      this.#failWith(`Synthetic dataset failed: ${this.#errMsg(e)}`);
      return;
    }
    if (this.#abort?.signal.aborted) return;

    let finalPhaseA = phaseA;
    let startupRuns = state.startupRuns;
    if (isStartupScenario(scenario)) {
      startupRuns = appendStartupPhaseRun(startupRuns, "phaseB", phaseB);
      if (startupRuns.phaseB.length < startupRuns.targetRuns) {
        const nextSample = startupRuns.phaseB.length + 1;
        this.#updateStep(
          `Closing for ${startupCooldownSeconds()} s cooldown before synthetic launch ${nextSample}/${startupRuns.targetRuns}`,
          true,
        );
        try {
          await persistPhaseBPending({
            scenarioId: scenario.id,
            platform: state.platform,
            buildRef: state.buildRef ?? BUILD_REF,
            startedAt: state.startedAt,
            phaseA,
            seedHandle,
            suite: state.suite,
            startupRuns,
          });
        } catch (e) {
          this.#failWith(`Persisting state failed: ${this.#errMsg(e)}`);
          return;
        }
        restartForScenario(scenario);
        return;
      }
      finalPhaseA = aggregateStartupPhase("A", startupRuns.phaseA);
      phaseB = aggregateStartupPhase("B", startupRuns.phaseB);
    }

    // The benchmark DB is about to be torn down before summary, so
    // per-calendar cleanup is redundant. Keep `seedHandle` referenced so
    // the type stays load-bearing for future scenarios that need it.
    void seedHandle;

    const peakTotals = [...finalPhaseA.peakSamples, ...phaseB.peakSamples].map((s) => s.totalMb);
    const peakTotalMb = peakTotals.length > 0 ? Math.max(...peakTotals) : undefined;

    const result: BenchmarkResult = {
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      workload: scenario.workload,
      synthVersion: state.synthVersion,
      harnessVersion: state.harnessVersion,
      platform: state.platform,
      buildRef: state.buildRef ?? BUILD_REF,
      phaseA: finalPhaseA,
      phaseB,
      peakTotalMb,
    };

    const suite = state.suite;
    if (suite && suite.index < suite.scenarioIds.length - 1) {
      await this.#continueSuite(suite, result, state.platform, state.buildRef ?? BUILD_REF);
      return;
    }

    const finalResults = suite ? [...suite.results, result] : [result];
    this.result = result;
    this.results = finalResults;
    await this.#teardownFinishedBenchmark();
    this.running = undefined;
    this.status = "summary";
    notifyBenchmarkDone(
      suite ? "Benchmark suite complete" : "Benchmark complete",
      suite
        ? `${this.results.length} benchmarks finished. Open the app to review the benchmark output.`
        : this.#completionMessage(scenario, result),
    );
  }

  async #continueSuite(
    suite: BenchmarkSuiteState,
    result: BenchmarkResult,
    platform: string,
    buildRef: string,
  ): Promise<void> {
    const nextIndex = suite.index + 1;
    const nextScenarioId = suite.scenarioIds[nextIndex];
    const nextScenario = getScenarioById(nextScenarioId);
    if (!nextScenario) {
      this.#failWith(`Unknown suite scenario: ${nextScenarioId}`);
      return;
    }
    const nextSuite: BenchmarkSuiteState = {
      scenarioIds: suite.scenarioIds,
      index: nextIndex,
      results: [...suite.results, result],
    };
    this.result = result;
    this.results = nextSuite.results;
    this.running = {
      phase: "A",
      scenarioId: nextScenario.id,
      scenarioLabel: nextScenario.label,
      suite: { index: nextIndex, total: suite.scenarioIds.length },
      step: isStartupScenario(nextScenario)
        ? `Closing for ${startupCooldownSeconds()} s startup cooldown`
        : "Restarting for next benchmark",
    };
    try {
      await invoke("prepare_benchmark_db");
      await persistPhaseAPending({
        scenarioId: nextScenario.id,
        platform,
        buildRef,
        suite: nextSuite,
      });
    } catch (e) {
      this.#failWith(`Preparing next benchmark failed: ${this.#errMsg(e)}`);
      return;
    }
    restartForScenario(nextScenario);
  }

  #updateStep(step: string, clearCurve = false) {
    if (!this.running) return;
    this.running = clearCurve
      ? { ...this.running, step, curve: undefined }
      : { ...this.running, step };
  }

  #updateCurve(curve: { done: number; total: number; label: SampleLabel }) {
    if (!this.running) return;
    this.running = { ...this.running, step: "Idle curve", curve };
  }

  #workloadStep(
    scenario: BenchmarkScenario,
    state: BenchmarkState,
    phase: "A" | "B",
  ): string {
    if (isStartupScenario(scenario)) {
      const runs = normalizeStartupRunState(state.startupRuns);
      const done = phase === "A" ? runs.phaseA.length : runs.phaseB.length;
      return `Launch sample ${done + 1}/${runs.targetRuns}`;
    }
    if (scenario.workload.memoryMode === "post-workload") {
      const seconds = Math.round(scenario.workload.durationMs / 1000);
      const windowLabel = scenario.workload.kind === "idle-memory" ? "Idle window" : "Stress window";
      return `${windowLabel}: ${seconds} s`;
    }
    return scenario.workload.label;
  }

  #completionMessage(scenario: BenchmarkScenario, result: BenchmarkResult): string {
    if (result.workload.kind === "startup") {
      const baseMs = formatOptionalMs(result.phaseA.startupMs);
      const synthMs = formatOptionalMs(result.phaseB.startupMs);
      return `${scenario.label}: launch medians base ${baseMs}, synth ${synthMs}. Open the app to review the benchmark output.`;
    }
    if (result.peakTotalMb !== undefined) {
      return `${scenario.label}: peak ${Math.round(result.peakTotalMb)} MB. Open the app to review the benchmark output.`;
    }
    const metricCount = [
      ...(result.phaseA.metrics ?? []),
      ...(result.phaseB.metrics ?? []),
    ].length;
    return `${scenario.label}: ${metricCount} metric rows. Open the app to review the benchmark output.`;
  }

  async #teardownFinishedBenchmark(): Promise<void> {
    try {
      await invoke("teardown_benchmark_db");
    } catch (e) {
      console.error("benchmark teardown after summary failed", e);
    }
    try {
      await clearPersistedState();
    } catch (e) {
      console.error("benchmark clear state after summary failed", e);
    }
  }

  #failWith(message: string) {
    this.errorMessage = message;
    this.running = undefined;
    this.status = "error";
    notifyBenchmarkDone("Benchmark failed", message);
  }

  #reset() {
    this.status = "idle";
    this.running = undefined;
    this.result = null;
    this.results = [];
    this.errorMessage = undefined;
    this.pendingRequest = undefined;
    this.#abort = null;
  }

  #isAbort(e: unknown): boolean {
    return e instanceof DOMException && e.name === "AbortError";
  }

  #errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async #detectPlatform(): Promise<string> {
    try {
      const r = await invoke<{ platform: string }>("get_memory_report");
      return r.platform;
    } catch {
      return "unknown";
    }
  }
}

let store: BenchmarkRunnerStore | null = null;

export function getBenchmarkRunner(): BenchmarkRunnerStore {
  if (!store) store = new BenchmarkRunnerStore();
  return store;
}

/**
 * Fires the OS desktop notification used by the harness on terminal-state
 * transitions (`summary`, `error`). Reuses the same Tauri command the
 * calendar event reminders use; on Linux that path goes through
 * `notify-rust` with a `message-new-instant` sound hint, so the user hears
 * a chime even if they walked away from the app.
 */
function notifyBenchmarkDone(title: string, body: string): void {
  invoke("show_event_notification", { title, body }).catch((e) => {
    console.warn("Benchmark notification failed:", e);
  });
}

function isStartupScenario(scenario: BenchmarkScenario): boolean {
  return scenario.workload.kind === "startup";
}

function restartForScenario(scenario: BenchmarkScenario): void {
  if (isStartupScenario(scenario)) {
    restartAppAfterDelay(STARTUP_RELAUNCH_COOLDOWN_MS);
    return;
  }
  restartApp();
}

function startupCooldownSeconds(): number {
  return Math.round(STARTUP_RELAUNCH_COOLDOWN_MS / 1000);
}

function normalizeStartupRunState(state: StartupRunState | undefined): StartupRunState {
  return {
    targetRuns: state?.targetRuns && state.targetRuns > 0 ? state.targetRuns : STARTUP_SAMPLE_RUNS,
    phaseA: state?.phaseA ?? [],
    phaseB: state?.phaseB ?? [],
  };
}

function appendStartupPhaseRun(
  state: StartupRunState | undefined,
  phaseKey: "phaseA" | "phaseB",
  phaseResult: PhaseResult,
): StartupRunState {
  const current = normalizeStartupRunState(state);
  return {
    targetRuns: current.targetRuns,
    phaseA: phaseKey === "phaseA" ? [...current.phaseA, phaseResult] : current.phaseA,
    phaseB: phaseKey === "phaseB" ? [...current.phaseB, phaseResult] : current.phaseB,
  };
}

function aggregateStartupPhase(phase: "A" | "B", phases: PhaseResult[]): PhaseResult {
  const fallbackPhase = phases[0];
  const startupSamples = phases.flatMap(startupSamplesFromPhase);
  const boot = aggregateBootTimings(startupSamples);
  return {
    phase,
    startedAt: startupSamples[0]?.startedAt ?? fallbackPhase?.startedAt ?? new Date().toISOString(),
    workloadDurationMs: average(phases.map((sample) => sample.workloadDurationMs)),
    peakSamples: [],
    curve: [],
    metrics: undefined,
    boot,
    startupMs: boot.launchTotalMs,
    startupSamples,
    eventCountAtStart: startupSamples[0]?.eventCountAtStart ?? fallbackPhase?.eventCountAtStart ?? 0,
  };
}

function startupSamplesFromPhase(phase: PhaseResult): StartupBootSample[] {
  if (phase.startupSamples && phase.startupSamples.length > 0) {
    return phase.startupSamples;
  }
  return [{
    startedAt: phase.startedAt,
    eventCountAtStart: phase.eventCountAtStart,
    boot: {
      ...phase.boot,
      launchTotalMs: phase.boot.launchTotalMs ?? phase.startupMs,
    },
  }];
}

function aggregateBootTimings(samples: StartupBootSample[]): BootTimings {
  const markKeys = new Set<string>();
  for (const sample of samples) {
    for (const mark of Object.keys(sample.boot.marks)) {
      markKeys.add(mark);
    }
  }
  const marks: Record<string, number> = {};
  for (const mark of markKeys) {
    const value = median(samples.map((sample) => sample.boot.marks[mark]));
    if (value !== undefined) marks[mark] = value;
  }
  const launchTotalMs = median(samples.map((sample) => sample.boot.launchTotalMs));
  return launchTotalMs === undefined ? { marks } : { marks, launchTotalMs };
}

function median(values: Array<number | undefined>): number | undefined {
  const finite = values
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (finite.length === 0) return undefined;
  const mid = Math.floor(finite.length / 2);
  if (finite.length % 2 === 1) return finite[mid];
  const low = finite[mid - 1];
  const high = finite[mid];
  if (low === undefined || high === undefined) return undefined;
  return (low + high) / 2;
}

function average(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function formatOptionalMs(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "n/a" : `${Math.round(value)} ms`;
}
