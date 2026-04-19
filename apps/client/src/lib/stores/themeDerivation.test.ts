import { describe, expect, it } from "vitest";
import {
  BASE_APP_TOKENS,
  BASE_CALENDAR_TOKENS,
  deriveAppTokens,
  deriveCalendarTokens,
  type ThemeSources,
} from "./themes";

/**
 * Source palettes fitted from the built-in light and dark themes.
 *
 * The light theme defines canvas / ink / primary / destructive explicitly
 * in `BASE_APP_TOKENS`; `calCanvas` is read from the calendar base.
 *
 * The dark theme reuses its `--foreground` color as `--primary`, which is
 * why `primary` and `ink` match exactly in this fixture.
 */
const LIGHT_SOURCES: ThemeSources = {
  canvas: BASE_APP_TOKENS.light["--background"],
  ink: BASE_APP_TOKENS.light["--foreground"],
  primary: BASE_APP_TOKENS.light["--primary"],
  destructive: BASE_APP_TOKENS.light["--destructive"],
  calCanvas: BASE_CALENDAR_TOKENS.light["--cal-bg"],
};

const DARK_SOURCES: ThemeSources = {
  canvas: BASE_APP_TOKENS.dark["--background"],
  ink: BASE_APP_TOKENS.dark["--foreground"],
  primary: BASE_APP_TOKENS.dark["--primary"],
  destructive: BASE_APP_TOKENS.dark["--destructive"],
  calCanvas: BASE_CALENDAR_TOKENS.dark["--cal-bg"],
};

/**
 * Max per-channel difference allowed between a derived color and its
 * corresponding built-in. The built-in palette was hand-tuned, and
 * several tokens (notably `--ring` and `--muted-foreground` in dark)
 * carry a stronger cool bias on the blue channel than a single-weight
 * linear blend of canvas + ink can reach (R and B need different
 * weights). Worst-case drift across all tokens at the current weights
 * is ~12 channels (dark ring) on a 255-scale channel. A tolerance of
 * 16 leaves headroom for the tuned values without masking regressions:
 * a future weight change that noticeably shifts a token past a subtle
 * tint will still fail the test.
 */
const MAX_CHANNEL_DRIFT = 16;

function parseChannels(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function channelDiff(a: string, b: string): number {
  const [ar, ag, ab] = parseChannels(a);
  const [br, bg, bb] = parseChannels(b);
  return Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb));
}

function assertCloseHex(actual: string, expected: string, label: string) {
  const drift = channelDiff(actual, expected);
  if (drift > MAX_CHANNEL_DRIFT) {
    throw new Error(
      `${label}: derived ${actual}, built-in ${expected}, drift ${drift} > ${MAX_CHANNEL_DRIFT}`,
    );
  }
  expect(drift).toBeLessThanOrEqual(MAX_CHANNEL_DRIFT);
}

describe("deriveAppTokens", () => {
  it("returns values for every derivable key in both bases", () => {
    const light = deriveAppTokens(LIGHT_SOURCES, "light");
    const dark = deriveAppTokens(DARK_SOURCES, "dark");
    for (const key of Object.keys(light)) {
      expect(light[key]).toBeDefined();
      expect(dark[key]).toBeDefined();
      expect(BASE_APP_TOKENS.light[key]).toBeDefined();
      expect(BASE_APP_TOKENS.dark[key]).toBeDefined();
    }
  });

  it("derives light tokens close to the built-in light palette", () => {
    const derived = deriveAppTokens(LIGHT_SOURCES, "light");
    for (const key of Object.keys(derived)) {
      assertCloseHex(derived[key], BASE_APP_TOKENS.light[key], `light ${key}`);
    }
  });

  it("derives dark tokens close to the built-in dark palette", () => {
    const derived = deriveAppTokens(DARK_SOURCES, "dark");
    for (const key of Object.keys(derived)) {
      assertCloseHex(derived[key], BASE_APP_TOKENS.dark[key], `dark ${key}`);
    }
  });

  it("pins the source colors to the tokens they represent", () => {
    const light = deriveAppTokens(LIGHT_SOURCES, "light");
    expect(light["--background"]).toBe(LIGHT_SOURCES.canvas);
    expect(light["--foreground"]).toBe(LIGHT_SOURCES.ink);
    expect(light["--primary"]).toBe(LIGHT_SOURCES.primary);
    expect(light["--destructive"]).toBe(LIGHT_SOURCES.destructive);

    const dark = deriveAppTokens(DARK_SOURCES, "dark");
    expect(dark["--background"]).toBe(DARK_SOURCES.canvas);
    expect(dark["--foreground"]).toBe(DARK_SOURCES.ink);
    expect(dark["--primary"]).toBe(DARK_SOURCES.primary);
    expect(dark["--destructive"]).toBe(DARK_SOURCES.destructive);
  });

  it("fixes card and popover to pure white in light mode", () => {
    const derived = deriveAppTokens(LIGHT_SOURCES, "light");
    expect(derived["--card"]).toBe("#FFFFFF");
    expect(derived["--popover"]).toBe("#FFFFFF");
  });

  it("pins sidebar foregrounds to #FFFFFF in dark mode", () => {
    const derived = deriveAppTokens(DARK_SOURCES, "dark");
    expect(derived["--sidebar-foreground"]).toBe("#FFFFFF");
    expect(derived["--sidebar-accent-foreground"]).toBe("#FFFFFF");
  });

  it("re-derives live when canvas changes", () => {
    const shifted: ThemeSources = { ...LIGHT_SOURCES, canvas: "#FFEEDD" };
    const derived = deriveAppTokens(shifted, "light");
    expect(derived["--background"]).toBe("#FFEEDD");
    expect(derived["--secondary"]).not.toBe(
      deriveAppTokens(LIGHT_SOURCES, "light")["--secondary"],
    );
  });
});

describe("deriveCalendarTokens", () => {
  it("returns only the derivable subset, not the semantic tokens", () => {
    const derived = deriveCalendarTokens(LIGHT_SOURCES, "light");
    expect(derived["--cal-bg"]).toBeDefined();
    expect(derived["--cal-header-bg"]).toBeDefined();
    expect(derived["--cal-gridline"]).toBeDefined();
    expect(derived["--cal-time-label"]).toBeDefined();
    expect(derived["--cal-timeline-rail"]).toBeDefined();
    expect(derived["--cal-today-circle"]).toBeUndefined();
    expect(derived["--cal-today-circle-text"]).toBeUndefined();
    expect(derived["--cal-current-time"]).toBeUndefined();
    expect(derived["--cal-timeline-break"]).toBeUndefined();
    expect(derived["--cal-timeline-focus"]).toBeUndefined();
  });

  it("pins the calendar canvas and header to source inputs", () => {
    const light = deriveCalendarTokens(LIGHT_SOURCES, "light");
    expect(light["--cal-bg"]).toBe(LIGHT_SOURCES.calCanvas);
    expect(light["--cal-header-bg"]).toBe(LIGHT_SOURCES.canvas);
  });

  it("derives light calendar tokens close to built-in values", () => {
    const derived = deriveCalendarTokens(LIGHT_SOURCES, "light");
    for (const key of Object.keys(derived)) {
      assertCloseHex(
        derived[key],
        BASE_CALENDAR_TOKENS.light[key],
        `light ${key}`,
      );
    }
  });

  it("derives dark calendar tokens close to built-in values", () => {
    const derived = deriveCalendarTokens(DARK_SOURCES, "dark");
    for (const key of Object.keys(derived)) {
      assertCloseHex(
        derived[key],
        BASE_CALENDAR_TOKENS.dark[key],
        `dark ${key}`,
      );
    }
  });
});
