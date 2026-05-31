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
import {
  parsePomodoroBlockedScreenState,
  pomodoroBlockedScreenPalette,
  pomodoroBlockedScreenStateFromOverlayKind,
  type PomodoroBlockedScreenState,
} from "./lib/components/pomodoro/blocked-screen";

interface BenchmarkBootProbe {
  vaultMode?: "user" | "benchmark";
  stage?: string;
  harnessVersion?: string;
  datasetVersion?: string;
  startedAt?: string;
  updatedAt?: string;
}

function pomodoroOverlayInitialStateFromLocation(): PomodoroBlockedScreenState {
  const params = new URLSearchParams(window.location.search);
  const screenState = params.get("screenState");
  if (screenState !== null) {
    return parsePomodoroBlockedScreenState(screenState);
  }
  return pomodoroBlockedScreenStateFromOverlayKind(params.get("overlayKind"));
}

function preparePomodoroOverlayDocument(): void {
  const { background } = pomodoroBlockedScreenPalette(
    pomodoroOverlayInitialStateFromLocation(),
  );
  const app = document.getElementById("app");
  document.documentElement.style.backgroundColor = background;
  document.body.style.backgroundColor = background;
  if (app) app.style.backgroundColor = background;
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
  const windowKind = new URLSearchParams(window.location.search).get("ganbaruWindow");
  if (windowKind === "pomodoroOverlay") {
    preparePomodoroOverlayDocument();
    const { default: PomodoroOverlayWindow } = await import(
      "$lib/components/pomodoro/PomodoroOverlayWindow.svelte"
    );
    return mount(PomodoroOverlayWindow, {
      target: document.getElementById("app")!,
    });
  }
  if (windowKind === "pomodoroOverlayBlocker") {
    preparePomodoroOverlayDocument();
    const { default: PomodoroOverlayBlocker } = await import(
      "$lib/components/pomodoro/PomodoroOverlayBlocker.svelte"
    );
    return mount(PomodoroOverlayBlocker, {
      target: document.getElementById("app")!,
    });
  }

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
