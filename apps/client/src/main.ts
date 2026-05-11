import { Temporal } from "@js-temporal/polyfill";
(globalThis as unknown as { Temporal: typeof Temporal }).Temporal = Temporal;
import "@fontsource-variable/inter";
import "./app.css";
import { mount } from "svelte";
import { invoke } from "@tauri-apps/api/core";
import { ensureConfigLoaded } from "./lib/vault/config";
import { hydrateUserThemes } from "./lib/stores/theme.svelte";
import {
  HARNESS_VERSION,
  DENSE_DATASET_VERSION,
  isBenchmarkPendingStage,
  isFreshBenchmarkPendingAge,
  isFreshBenchmarkTotalAge,
} from "./lib/benchmark/types";

interface BenchmarkBootProbe {
  vaultMode?: "user" | "benchmark";
  stage?: string;
  harnessVersion?: string;
  datasetVersion?: string;
  startedAt?: string;
  updatedAt?: string;
}

async function hasFreshBenchmarkResumeState(): Promise<boolean> {
  try {
    const json = await invoke<string | null>("read_benchmark_state");
    if (!json) return false;
    const parsed = JSON.parse(json) as BenchmarkBootProbe;
    return parsed.vaultMode === "benchmark"
      && isBenchmarkPendingStage(parsed.stage)
      && parsed.harnessVersion === HARNESS_VERSION
      && parsed.datasetVersion === DENSE_DATASET_VERSION
      && isFreshBenchmarkTotalAge(parsed)
      && isFreshBenchmarkPendingAge(parsed);
  } catch (err) {
    console.error("benchmark boot probe failed", err);
    return false;
  }
}

// Boot order: hydrate vault/config.json, then load user themes from
// SQLite, then mount App. Config and theme reads block first paint so
// the initial render matches what the user has on disk (no flash of
// defaults). The one-shot calendar timezone migration runs from
// `App.svelte`'s onMount instead, gating only `calendar.load()`: the
// migration is idempotent (short-circuits once the marker is set), so on
// every boot after the first successful run it is a single config read,
// and on first run only the calendar grid waits while the rest of the
// chrome paints immediately.
const appPromise = (async () => {
  await ensureConfigLoaded();
  const benchmarkResumePending = await hasFreshBenchmarkResumeState();
  if (!benchmarkResumePending) {
    try {
      await hydrateUserThemes();
    } catch (err) {
      console.error("theme hydration failed before mount", err);
    }
  }
  const { default: App } = await import("./App.svelte");
  return mount(App, {
    target: document.getElementById("app")!,
  });
})();

export default appPromise;
