/**
 * Cross-component runner state for the in-app benchmark harness (v2).
 *
 * Mounted once in `TitleBar.svelte` (the same place as the floating theme
 * editor and settings modal). Settings panels call `request()` to ask for
 * a run; the overlay reacts to status transitions.
 *
 * V2 flow (cold-cold against an isolated benchmark DB):
 *
 *   idle
 *     -> user clicks Run
 *   confirming
 *     -> user confirms
 *     -> prepare_benchmark_db (idempotent delete of any prior file)
 *     -> persistPhaseAPending(...)
 *     -> restart_app                                         # restart 1
 *   [boot, vaultMode=benchmark, stage=phase-a-pending]
 *     -> SQL plugin opens ganbaruai-benchmark.db (empty)
 *     -> checkAndResume runs Phase A
 *     -> scenario.seed(synth)
 *     -> persistPhaseBPending(...)
 *     -> restart_app                                         # restart 2
 *   [boot, vaultMode=benchmark, stage=phase-b-pending]
 *     -> SQL plugin opens ganbaruai-benchmark.db (now seeded)
 *     -> checkAndResume runs Phase B
 *     -> show summary
 *   summary
 *     -> user clicks Close
 *     -> teardown_benchmark_db (delete files)
 *     -> clear_benchmark_state
 *     -> restart_app                                         # restart 3
 *   [boot, no state, default]
 *     -> SQL plugin opens user DB (untouched throughout)
 *   idle
 *
 * The user's real DB and vault are never opened during the run.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCalendar } from "./calendar.svelte";
import {
  SYNTH_VERSION,
  type BenchmarkResult,
  type BenchmarkState,
  type BenchmarkScenario,
  type PhaseResult,
  type SampleLabel,
} from "$lib/benchmark/types";
import {
  createRunner,
  persistPhaseAPending,
  persistPhaseBPending,
  restartApp,
  loadPersistedState,
  clearPersistedState,
} from "$lib/benchmark/runner";
import { getScenarioById } from "$lib/benchmark/registry";

type Status = "idle" | "confirming" | "running" | "summary" | "error";

export interface RunningInfo {
  phase: "A" | "B";
  scenarioId: string;
  scenarioLabel: string;
  /** Short user-facing label for the current step (e.g. "Stress (3 s)"). */
  step: string;
  /** Set during the idle-curve schedule so the overlay can show progress. */
  curve?: { done: number; total: number; label: SampleLabel };
}

class BenchmarkRunnerStore {
  status = $state<Status>("idle");
  running = $state<RunningInfo | undefined>(undefined);
  result = $state<BenchmarkResult | null>(null);
  errorMessage = $state<string | undefined>(undefined);
  pendingScenarioId = $state<string | undefined>(undefined);

  #abort: AbortController | null = null;

  /** Open the confirmation dialog for `scenarioId`. */
  request(scenarioId: string) {
    if (this.status !== "idle") return;
    this.pendingScenarioId = scenarioId;
    this.status = "confirming";
  }

  cancelConfirm() {
    if (this.status !== "confirming") return;
    this.pendingScenarioId = undefined;
    this.status = "idle";
  }

  /**
   * The user accepted the dialog. Wipe any stale benchmark DB, write the
   * `phase-a-pending` marker, and restart. Phase A itself runs after the
   * restart against the freshly-opened isolated DB.
   */
  async confirm() {
    if (this.status !== "confirming") return;
    const scenarioId = this.pendingScenarioId;
    if (!scenarioId) return;
    const scenario = getScenarioById(scenarioId);
    if (!scenario) {
      this.errorMessage = `Unknown scenario: ${scenarioId}`;
      this.status = "error";
      return;
    }
    this.pendingScenarioId = undefined;

    this.status = "running";
    this.running = {
      phase: "A",
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      step: "Restarting for Phase A",
    };

    try {
      await invoke("prepare_benchmark_db");
      const platform = await this.#detectPlatform();
      await persistPhaseAPending({ scenarioId: scenario.id, platform });
    } catch (e) {
      this.#failWith(`Setup failed: ${this.#errMsg(e)}`);
      return;
    }

    restartApp();
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
    // on TTL or version mismatch. Anything that reaches here has a fresh
    // state file pointing at a valid stage; we still defend against a
    // scenario that has been removed and against a `phase-b-pending` state
    // that is missing the data needed to run it.
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
      step: "Setting up",
    };
    this.#abort = new AbortController();
    const calendarStore = getCalendar();
    const runner = createRunner(() => calendarStore.rawBlocks.length);

    let phaseA: PhaseResult;
    try {
      this.#updateStep("Stress (3 s)");
      phaseA = await runner.runPhaseA({
        scenario,
        signal: this.#abort.signal,
        onCurveProgress: (label, total, done) => {
          this.#updateCurve({ label, total, done });
        },
      });
    } catch (e) {
      if (this.#isAbort(e)) return;
      this.#failWith(`Phase A failed: ${this.#errMsg(e)}`);
      return;
    }
    if (this.#abort?.signal.aborted) return;

    this.#updateStep(`Seeding ${scenario.defaultSeedSize} events`, /* clearCurve */ true);
    let seedHandle: { calendarId: string; eventCount: number };
    try {
      seedHandle = await scenario.seed(SYNTH_VERSION, scenario.defaultSeedSize);
    } catch (e) {
      this.#failWith(`Seeding failed: ${this.#errMsg(e)}`);
      return;
    }
    if (this.#abort?.signal.aborted) return;

    this.#updateStep("Restarting for Phase B");
    try {
      await persistPhaseBPending({
        scenarioId: scenario.id,
        platform: state.platform,
        startedAt: state.startedAt,
        phaseA,
        seedHandle,
      });
    } catch (e) {
      this.#failWith(`Persisting state failed: ${this.#errMsg(e)}`);
      return;
    }

    restartApp();
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
      step: "Setting up",
    };
    this.#abort = new AbortController();
    const calendarStore = getCalendar();
    const runner = createRunner(() => calendarStore.rawBlocks.length);

    let phaseB: PhaseResult;
    try {
      this.#updateStep("Stress (3 s)");
      phaseB = await runner.runPhaseB({
        scenario,
        signal: this.#abort.signal,
        onCurveProgress: (label, total, done) => {
          this.#updateCurve({ label, total, done });
        },
      });
    } catch (e) {
      if (this.#isAbort(e)) return;
      this.#failWith(`Phase B failed: ${this.#errMsg(e)}`);
      return;
    }
    if (this.#abort?.signal.aborted) return;

    // The benchmark DB is about to be torn down on summary close, so
    // per-calendar cleanup is redundant. Keep `seedHandle` referenced so
    // the type stays load-bearing for future scenarios that need it.
    void seedHandle;

    const peakA = Math.max(0, ...phaseA.peakSamples.map((s) => s.totalMb));
    const peakB = Math.max(0, ...phaseB.peakSamples.map((s) => s.totalMb));

    this.result = {
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      synthVersion: state.synthVersion,
      harnessVersion: state.harnessVersion,
      platform: state.platform,
      phaseA,
      phaseB,
      peakTotalMb: Math.max(peakA, peakB),
    };
    this.running = undefined;
    this.status = "summary";
    notifyBenchmarkDone(
      "Benchmark complete",
      `${scenario.label}: peak ${Math.round(this.result.peakTotalMb)} MB. Open the app to copy the markdown.`,
    );
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
    this.errorMessage = undefined;
    this.pendingScenarioId = undefined;
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
