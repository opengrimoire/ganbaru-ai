import { getSettingsLauncher } from "$lib/stores/settingsLauncher.svelte";
import { getTheme } from "$lib/stores/theme.svelte";
import { getThemeEditor } from "$lib/stores/themeEditor.svelte";
import { type BenchmarkMetric, type BenchmarkScenario } from "../types";
import { seedCalendarSynth, timingStatsMetric, waitForFrames } from "./calendar-utils";

const OPEN_RUNS = 5;

export const themeEditorOpenScenario: BenchmarkScenario = {
  id: "theme-editor-open",
  label: "Theme editor open",
  description:
    "Loads and opens the settings modal plus the floating theme editor on the built-in dark theme. Reports module-load and mounted-open timings without writing theme changes.",
  workload: {
    kind: "interaction-latency",
    question: "How quickly do settings and the theme editor open?",
    label: "settings and theme-editor open interactions",
    durationMs: 0,
    memoryMode: "none",
  },
  defaultSeedSize: 1000,

  async setup(): Promise<void> {
    const settingsLauncher = getSettingsLauncher();
    const themeEditor = getThemeEditor();
    settingsLauncher.close();
    await themeEditor.cancel();
    await waitForFrames(1);
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    const settingsLauncher = getSettingsLauncher();
    const themeStore = getTheme();
    const themeEditor = getThemeEditor();
    const metrics: BenchmarkMetric[] = [];

    const settingsModuleStart = performance.now();
    await import("$lib/components/settings/SettingsModal.svelte");
    metrics.push({
      label: "settings module load",
      unit: "ms",
      value: performance.now() - settingsModuleStart,
    });

    const settingsOpenMs: number[] = [];
    for (let i = 0; i < OPEN_RUNS; i++) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const settingsOpenStart = performance.now();
      settingsLauncher.open("appearance");
      await waitForFrames(3);
      settingsOpenMs.push(performance.now() - settingsOpenStart);
      settingsLauncher.close();
      await waitForFrames(1);
    }
    metrics.push(timingStatsMetric("settings open paint avg", settingsOpenMs));

    const editorModuleStart = performance.now();
    await import("$lib/components/settings/FloatingThemeEditor.svelte");
    metrics.push({
      label: "theme editor module load",
      unit: "ms",
      value: performance.now() - editorModuleStart,
    });

    const previousActiveId = themeStore.id;
    if (themeStore.id !== "dark") themeStore.setTheme("dark");
    settingsLauncher.open("appearance");
    await waitForFrames(2);
    const editorOpenMs: number[] = [];
    for (let i = 0; i < OPEN_RUNS; i++) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const editorOpenStart = performance.now();
      themeEditor.open("dark", { previousActiveId });
      await waitForFrames(3);
      editorOpenMs.push(performance.now() - editorOpenStart);
      await themeEditor.cancel();
      await waitForFrames(1);
    }
    metrics.push(timingStatsMetric("theme editor open paint avg", editorOpenMs));

    await themeEditor.cancel();
    settingsLauncher.close();
    await waitForFrames(2);
    return metrics;
  },

  async seed(version: string, seedSize: number): Promise<{ calendarId: string; eventCount: number }> {
    return seedCalendarSynth(version, seedSize);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The isolated benchmark DB is deleted after the run.
  },
};
