/**
 * Cross-component runner state for the in-app benchmark harness.
 *
 * Mounted once in `TitleBar.svelte` (the same place as the floating theme
 * editor and settings modal). Settings panels call `request()` to ask for
 * a run; the overlay reacts to status transitions.
 *
 * The runner walks: confirming -> running Phase A -> seeding -> persisting
 * -> restart_app (Rust never returns) -> on next boot, App.svelte's
 * `checkAndResume()` picks the state up and walks: running Phase B ->
 * cleanup -> summary -> idle.
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
  persistPhaseA,
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
  #seedHandle: { calendarId: string; eventCount: number } | null = null;

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
    await this.#runPhaseA(scenario);
  }

  /**
   * Aborts whatever is running, removes any seeded synth data, and clears
   * the state file. Safe to call from any non-idle status.
   */
  async cancel() {
    this.#abort?.abort();
    if (this.#seedHandle) {
      const scenario = this.#currentScenario();
      if (scenario) {
        try {
          await scenario.cleanup({ calendarId: this.#seedHandle.calendarId });
        } catch (e) {
          console.error("benchmark cleanup failed", e);
        }
      }
      this.#seedHandle = null;
    }
    try {
      await clearPersistedState();
    } catch (e) {
      console.error("benchmark clear state failed", e);
    }
    this.#reset();
  }

  closeSummary() {
    if (this.status !== "summary" && this.status !== "error") return;
    this.#reset();
  }

  /**
   * Boot-time entry point. Reads the persisted state file; if a Phase A is
   * waiting and still valid, runs Phase B against the seeded data. If the
   * file is stale or the scenario no longer exists, clears it silently.
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
    const scenario = getScenarioById(state.scenarioId);
    if (!scenario) {
      await clearPersistedState();
      return;
    }
    await this.#runPhaseB(scenario, state);
  }

  async #runPhaseA(scenario: BenchmarkScenario) {
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
    this.#seedHandle = seedHandle;
    if (this.#abort?.signal.aborted) return;

    this.#updateStep("Restarting app");
    try {
      const platform = await this.#detectPlatform();
      await persistPhaseA({
        scenarioId: scenario.id,
        platform,
        phaseA,
        seedHandle,
      });
    } catch (e) {
      this.#failWith(`Persisting state failed: ${this.#errMsg(e)}`);
      return;
    }

    // restartApp() does not return; the new process picks up Phase B via
    // App.svelte's checkAndResume() once boot.first-paint settles.
    restartApp();
  }

  async #runPhaseB(scenario: BenchmarkScenario, state: BenchmarkState) {
    this.status = "running";
    this.errorMessage = undefined;
    this.running = {
      phase: "B",
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      step: "Setting up",
    };
    this.#abort = new AbortController();
    this.#seedHandle = state.seedHandle;
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

    this.#updateStep("Cleaning up synth data", /* clearCurve */ true);
    try {
      await scenario.cleanup({ calendarId: state.seedHandle.calendarId });
    } catch (e) {
      console.error("benchmark cleanup failed", e);
    }
    this.#seedHandle = null;
    try {
      await clearPersistedState();
    } catch (e) {
      console.error("benchmark clear state failed", e);
    }

    const peakA = Math.max(0, ...state.phaseA.peakSamples.map((s) => s.totalMb));
    const peakB = Math.max(0, ...phaseB.peakSamples.map((s) => s.totalMb));

    this.result = {
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      synthVersion: state.synthVersion,
      harnessVersion: state.harnessVersion,
      platform: state.platform,
      phaseA: state.phaseA,
      phaseB,
      peakTotalMb: Math.max(peakA, peakB),
    };
    this.running = undefined;
    this.status = "summary";
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
  }

  #currentScenario(): BenchmarkScenario | undefined {
    if (!this.running) return undefined;
    return getScenarioById(this.running.scenarioId);
  }

  #reset() {
    this.status = "idle";
    this.running = undefined;
    this.result = null;
    this.errorMessage = undefined;
    this.pendingScenarioId = undefined;
    this.#abort = null;
    this.#seedHandle = null;
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
