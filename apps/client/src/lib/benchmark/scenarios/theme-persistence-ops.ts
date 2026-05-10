import { type UserThemeRead, type UserThemeWrite } from "$lib/api/themes";
import { PALETTE_SIZE } from "$lib/components/calendar/types";
import {
  APP_TOKEN_KEYS,
  BASE_APP_TOKENS,
  BASE_CALENDAR_TOKENS,
  CALENDAR_TOKEN_KEYS,
  DERIVATION_ENGINE_VERSION,
  SOURCE_KEY_ORDER,
  type ThemeSources,
} from "$lib/stores/themes";
import { type BenchmarkMetric, type BenchmarkScenario } from "../types";
import { seedCalendarSynth } from "./calendar-utils";
import {
  DEFAULT_OPERATION_RUNS,
  ensureBenchmarkDbReady,
  invokeDb,
  measureMs,
  repeatedMeasuredTimingMetric,
} from "./operation-utils";

const THEME_LOAD_FIXTURES = 4;

const SOURCE_COLORS: ThemeSources = {
  canvas: "#27282A",
  ink: "#ECECF2",
  primary: "#ECECF2",
  destructive: "#E54545",
  destructiveText: "#FFFFFF",
  confirm: "#065F46",
  confirmText: "#D1FAE5",
  warning: "#F59E0B",
  warningText: "#FFFFFF",
};

const EVENT_PALETTE = Object.freeze([
  "#AD1457", "#D81B60", "#D50000", "#E67C73", "#F4511E", "#EF6C00",
  "#F09300", "#F6BF26", "#E4C441", "#C0CA33", "#7CB342", "#33B679",
  "#0B8043", "#009688", "#039BE5", "#4285F4", "#3F51B5", "#7986CB",
  "#B39DDB", "#9E69AF", "#8E24AA", "#A142F4", "#795548", "#616161",
] as const);

type ThemeTokenWrite = UserThemeWrite["tokens"][number];
type ThemePaletteWrite = UserThemeWrite["palette"][number];

function sourceTokenRows(): ThemeTokenWrite[] {
  return SOURCE_KEY_ORDER.map((key) => ({
    kind: "source",
    key,
    value: SOURCE_COLORS[key],
    isolated: false,
  }));
}

function appTokenRows(): ThemeTokenWrite[] {
  return APP_TOKEN_KEYS.map((key) => ({
    kind: "app",
    key,
    value: BASE_APP_TOKENS.dark[key],
    isolated: false,
  }));
}

function calendarTokenRows(): ThemeTokenWrite[] {
  return CALENDAR_TOKEN_KEYS.map((key) => ({
    kind: "calendar",
    key,
    value: BASE_CALENDAR_TOKENS.dark[key],
    isolated: false,
  }));
}

function paletteRows(offset: number): ThemePaletteWrite[] {
  return Array.from({ length: PALETTE_SIZE }, (_, slot) => ({
    slot,
    value: EVENT_PALETTE[(slot + offset) % EVENT_PALETTE.length],
  }));
}

function themeWrite(id: string, name: string, offset: number = 0): UserThemeWrite {
  const tokens = [
    ...sourceTokenRows(),
    ...appTokenRows(),
    ...calendarTokenRows(),
  ];
  const palette = paletteRows(offset);
  return {
    id,
    displayName: name,
    iconLabel: "dark",
    seedIconLabel: "dark",
    blendCanvas: BASE_CALENDAR_TOKENS.dark["--cal-bg"],
    seedBlendCanvas: BASE_CALENDAR_TOKENS.dark["--cal-bg"],
    derivationEngineVersion: DERIVATION_ENGINE_VERSION,
    calendarDefaultMode: "app-canvas",
    calendarDefaultCustom: BASE_APP_TOKENS.dark["--background"],
    seedCalendarDefaultMode: "app-canvas",
    seedCalendarDefaultCustom: BASE_APP_TOKENS.dark["--background"],
    tokens,
    palette,
    seedTokens: tokens,
    seedPalette: palette,
  };
}

function derivedAppTokens(value: string): Record<string, string> {
  return Object.fromEntries(
    APP_TOKEN_KEYS.map((key) => [key, key === "--background" ? value : BASE_APP_TOKENS.dark[key]]),
  );
}

function derivedCalendarTokens(value: string): Record<string, string> {
  return Object.fromEntries(
    CALENDAR_TOKEN_KEYS.map((key) => [key, key === "--cal-bg" ? value : BASE_CALENDAR_TOKENS.dark[key]]),
  );
}

async function insertTheme(id: string, index: number): Promise<void> {
  await invokeDb<void>("theme_insert", {
    write: themeWrite(id, `Benchmark theme ${index}`, index),
  });
}

async function deleteTheme(id: string): Promise<void> {
  await invokeDb<void>("theme_delete", { id });
}

async function insertSample(index: number): Promise<number> {
  const id = `bench-theme-insert-${index}-${crypto.randomUUID()}`;
  try {
    return await measureMs(() => insertTheme(id, index));
  } finally {
    await deleteTheme(id).catch(() => {});
  }
}

async function replaceSample(index: number): Promise<number> {
  const id = `bench-theme-replace-${index}-${crypto.randomUUID()}`;
  await insertTheme(id, index);
  try {
    return await measureMs(() =>
      invokeDb<void>("theme_replace_content", {
        write: themeWrite(id, `Benchmark theme replaced ${index}`, index + 1),
      }),
    );
  } finally {
    await deleteTheme(id).catch(() => {});
  }
}

async function sourceCascadeSample(index: number): Promise<number> {
  const id = `bench-theme-cascade-${index}-${crypto.randomUUID()}`;
  const nextCanvas = index % 2 === 0 ? "#30343B" : "#24262A";
  await insertTheme(id, index);
  try {
    return await measureMs(() =>
      invokeDb<void>("theme_update_source_cascade", {
        write: {
          id,
          sourceKey: "canvas",
          value: nextCanvas,
          derivedApp: derivedAppTokens(nextCanvas),
          derivedCal: derivedCalendarTokens(nextCanvas),
          nextBlendCanvas: nextCanvas,
        },
      }),
    );
  } finally {
    await deleteTheme(id).catch(() => {});
  }
}

async function resetSample(index: number): Promise<number> {
  const id = `bench-theme-reset-${index}-${crypto.randomUUID()}`;
  await insertTheme(id, index);
  await invokeDb<void>("theme_update_blend_canvas", {
    id,
    value: "#30343B",
  });
  try {
    return await measureMs(() =>
      invokeDb<void>("theme_reset_to_seed", { id }),
    );
  } finally {
    await deleteTheme(id).catch(() => {});
  }
}

async function loadAllSample(_index: number): Promise<number> {
  return measureMs(async () => {
    await invokeDb<UserThemeRead[]>("theme_load_all");
  });
}

async function withLoadFixtures<T>(operation: () => Promise<T>): Promise<T> {
  const ids = Array.from(
    { length: THEME_LOAD_FIXTURES },
    (_, index) => `bench-theme-load-${index}-${crypto.randomUUID()}`,
  );
  try {
    for (let i = 0; i < ids.length; i++) {
      await insertTheme(ids[i], i);
    }
    return await operation();
  } finally {
    await Promise.all(ids.map((id) => deleteTheme(id).catch(() => {})));
  }
}

export const themePersistenceOpsScenario: BenchmarkScenario = {
  id: "theme-persistence-ops",
  label: "Theme persistence operations",
  description:
    "Measures Rust-backed theme snapshot insert, replace, load, source cascade, and reset commands against normalized theme tables.",
  workload: {
    kind: "operation-latency",
    question: "How quickly do Rust-backed theme persistence commands finish?",
    label: "scripted theme persistence commands",
    durationMs: 0,
    memoryMode: "none",
  },
  defaultSeedSize: 1000,

  async setup(): Promise<void> {
    await ensureBenchmarkDbReady();
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    return [
      await repeatedMeasuredTimingMetric(
        "theme snapshot insert avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        insertSample,
      ),
      await repeatedMeasuredTimingMetric(
        "theme snapshot replace avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        replaceSample,
      ),
      await withLoadFixtures(() =>
        repeatedMeasuredTimingMetric(
          "theme load all avg",
          DEFAULT_OPERATION_RUNS,
          signal,
          loadAllSample,
          { fixtureThemes: THEME_LOAD_FIXTURES },
        ),
      ),
      await repeatedMeasuredTimingMetric(
        "theme source cascade avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        sourceCascadeSample,
      ),
      await repeatedMeasuredTimingMetric(
        "theme reset to seed avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        resetSample,
      ),
    ];
  },

  async seed(version: string, seedSize: number): Promise<{ calendarId: string; eventCount: number }> {
    return seedCalendarSynth(version, seedSize);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The isolated benchmark DB is deleted after the run.
  },
};
