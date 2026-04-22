import { describe, expect, it } from "vitest";
import {
  BASE_APP_TOKENS,
  BASE_CALENDAR_TOKENS,
  deriveAppTokens,
  deriveCalendarTokens,
  type ThemeSources,
} from "./themes";
import {
  contrastRatio,
  meetsWcag,
} from "$lib/components/ui/colorMath";

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
  confirm: BASE_APP_TOKENS.light["--action-confirm"],
  warning: BASE_APP_TOKENS.light["--status-tentative"],
  calCanvas: BASE_CALENDAR_TOKENS.light["--cal-bg"],
};

const DARK_SOURCES: ThemeSources = {
  canvas: BASE_APP_TOKENS.dark["--background"],
  ink: BASE_APP_TOKENS.dark["--foreground"],
  primary: BASE_APP_TOKENS.dark["--primary"],
  destructive: BASE_APP_TOKENS.dark["--destructive"],
  confirm: BASE_APP_TOKENS.dark["--action-confirm"],
  warning: BASE_APP_TOKENS.dark["--status-tentative"],
  calCanvas: BASE_CALENDAR_TOKENS.dark["--cal-bg"],
};

/**
 * Pairs of (foreground token, background token) that must meet AA
 * body-text contrast (4.5:1). Every pair here is a surface where users
 * read prose-weight copy.
 */
const AA_FOREGROUND_PAIRS: ReadonlyArray<[string, string]> = [
  ["--foreground", "--background"],
  ["--card-foreground", "--card"],
  ["--popover-foreground", "--popover"],
  ["--primary-foreground", "--primary"],
  ["--secondary-foreground", "--secondary"],
  ["--accent-foreground", "--accent"],
  ["--destructive-foreground", "--destructive"],
  ["--sidebar-foreground", "--sidebar"],
  ["--sidebar-accent-foreground", "--sidebar-accent"],
  ["--action-confirm-foreground", "--action-confirm"],
  ["--action-danger-armed-foreground", "--action-danger-armed"],
  ["--status-accepted-foreground", "--status-accepted"],
  ["--status-tentative-foreground", "--status-tentative"],
  ["--status-declined-foreground", "--status-declined"],
];

/**
 * Tokens that must park in the muted band `[3.0, 4.4]` against their
 * paired background: recessed enough to read as secondary copy,
 * readable enough to never disappear.
 */
const MUTED_BANDS: ReadonlyArray<{ fg: string; bg: string }> = [
  { fg: "--muted-foreground", bg: "--muted" },
];

const BORDER_PAIRS: ReadonlyArray<{ border: string; against: string }> = [
  { border: "--ring", against: "--background" },
];

function assertAA(fgHex: string, bgHex: string, label: string) {
  const ratio = contrastRatio(fgHex, bgHex);
  if (!meetsWcag(fgHex, bgHex, "AA", "body")) {
    throw new Error(
      `${label}: fg ${fgHex} on bg ${bgHex} = ${ratio.toFixed(2)}:1, expected >= 4.5`,
    );
  }
  expect(ratio).toBeGreaterThanOrEqual(4.5);
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

  for (const base of ["light", "dark"] as const) {
    const sources = base === "light" ? LIGHT_SOURCES : DARK_SOURCES;

    it(`meets AA 4.5:1 on every foreground/background pair (${base})`, () => {
      const tokens = deriveAppTokens(sources, base);
      for (const [fg, bg] of AA_FOREGROUND_PAIRS) {
        assertAA(tokens[fg], tokens[bg], `${base} ${fg} on ${bg}`);
      }
    });

    it(`parks muted captions inside [3.0, 4.4] (${base})`, () => {
      const tokens = deriveAppTokens(sources, base);
      for (const { fg, bg } of MUTED_BANDS) {
        const ratio = contrastRatio(tokens[fg], tokens[bg]);
        expect(ratio).toBeGreaterThanOrEqual(3.0);
        expect(ratio).toBeLessThanOrEqual(4.5);
      }
    });

    it(`keeps borders at or above 3:1 (${base})`, () => {
      const tokens = deriveAppTokens(sources, base);
      for (const { border, against } of BORDER_PAIRS) {
        const ratio = contrastRatio(tokens[border], tokens[against]);
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      }
    });
  }

  it("pins the source colors to the tokens they represent", () => {
    const light = deriveAppTokens(LIGHT_SOURCES, "light");
    expect(light["--background"]).toBe(LIGHT_SOURCES.canvas);
    expect(light["--foreground"]).toBe(LIGHT_SOURCES.ink);
    expect(light["--primary"]).toBe(LIGHT_SOURCES.primary);
    expect(light["--destructive"]).toBe(LIGHT_SOURCES.destructive);
    expect(light["--action-confirm"]).toBe(LIGHT_SOURCES.confirm);
    expect(light["--status-tentative"]).toBe(LIGHT_SOURCES.warning);

    const dark = deriveAppTokens(DARK_SOURCES, "dark");
    expect(dark["--background"]).toBe(DARK_SOURCES.canvas);
    expect(dark["--foreground"]).toBe(DARK_SOURCES.ink);
    expect(dark["--primary"]).toBe(DARK_SOURCES.primary);
    expect(dark["--destructive"]).toBe(DARK_SOURCES.destructive);
  });

  it("lifts card and popover away from canvas toward ink", () => {
    const derived = deriveAppTokens(LIGHT_SOURCES, "light");
    expect(derived["--card"]).not.toBe(LIGHT_SOURCES.canvas);
    expect(derived["--popover"]).not.toBe(LIGHT_SOURCES.canvas);
    expect(
      contrastRatio(derived["--card"], LIGHT_SOURCES.canvas),
    ).toBeGreaterThan(1);
    expect(
      contrastRatio(derived["--popover"], derived["--card"]),
    ).toBeGreaterThan(1);
  });

  it("re-derives live when canvas changes", () => {
    const shifted: ThemeSources = { ...LIGHT_SOURCES, canvas: "#FFEEDD" };
    const derived = deriveAppTokens(shifted, "light");
    expect(derived["--background"]).toBe("#FFEEDD");
    expect(derived["--secondary"]).not.toBe(
      deriveAppTokens(LIGHT_SOURCES, "light")["--secondary"],
    );
  });

  it("flips --foreground when the user darkens canvas without touching ink", () => {
    const lightIshInk = LIGHT_SOURCES.ink;
    const shifted: ThemeSources = { ...LIGHT_SOURCES, canvas: "#0A0A1E" };
    const tokens = deriveAppTokens(shifted, "light");
    expect(tokens["--foreground"]).not.toBe(lightIshInk);
    assertAA(tokens["--foreground"], tokens["--background"], "shifted fg on bg");
  });

  it("stays legible when the user picks extreme canvas/ink pairs", () => {
    const extreme: ThemeSources = {
      canvas: "#000000",
      ink: "#FFFFFF",
      primary: "#FFD700",
      destructive: "#FF1493",
      confirm: "#00FF7F",
      warning: "#FFA500",
      calCanvas: "#0A0A0A",
    };
    const tokens = deriveAppTokens(extreme, "dark");
    for (const [fg, bg] of AA_FOREGROUND_PAIRS) {
      assertAA(tokens[fg], tokens[bg], `extreme ${fg} on ${bg}`);
    }
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

  for (const base of ["light", "dark"] as const) {
    const sources = base === "light" ? LIGHT_SOURCES : DARK_SOURCES;

    it(`gridline sits at or above 3:1 against the calendar canvas (${base})`, () => {
      const tokens = deriveCalendarTokens(sources, base);
      const ratio = contrastRatio(tokens["--cal-gridline"], tokens["--cal-bg"]);
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });

    it(`time label parks inside [3.0, 4.5] against the app canvas (${base})`, () => {
      const tokens = deriveCalendarTokens(sources, base);
      const ratio = contrastRatio(
        tokens["--cal-time-label"],
        tokens["--cal-header-bg"],
      );
      expect(ratio).toBeGreaterThanOrEqual(3.0);
      expect(ratio).toBeLessThanOrEqual(4.5);
    });
  }
});
