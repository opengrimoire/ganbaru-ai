import { describe, expect, it } from "vitest";
import {
  BASE_APP_TOKENS,
  deriveAppTokens,
  deriveCalendarTokens,
  type ThemeSources,
} from "./themes";
import {
  contrastRatio,
  hexToOklab,
  meetsWcag,
  relativeLuminance,
  shiftPerceptualL,
} from "$lib/components/ui/colorMath";

/**
 * Source palettes fitted from the built-in light and dark themes.
 *
 * The light theme defines canvas / ink / primary / destructive explicitly
 * in `BASE_APP_TOKENS`. Calendar canvas is no longer a source: it
 * auto-derives from the app canvas via a direction-aware OKLab ΔL offset.
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
};

const DARK_SOURCES: ThemeSources = {
  canvas: BASE_APP_TOKENS.dark["--background"],
  ink: BASE_APP_TOKENS.dark["--foreground"],
  primary: BASE_APP_TOKENS.dark["--primary"],
  destructive: BASE_APP_TOKENS.dark["--destructive"],
  confirm: BASE_APP_TOKENS.dark["--action-confirm"],
  warning: BASE_APP_TOKENS.dark["--status-tentative"],
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
  ["--event-panel-text", "--event-panel-bg"],
  ["--event-panel-input-text", "--event-panel-bg"],
];

/**
 * Tokens that must park in the muted band `[3.0, 4.4]` against their
 * paired background: recessed enough to read as secondary copy,
 * readable enough to never disappear.
 */
const MUTED_BANDS: ReadonlyArray<{ fg: string; bg: string }> = [
  { fg: "--muted-foreground", bg: "--muted" },
  { fg: "--event-panel-placeholder", bg: "--event-panel-bg" },
  { fg: "--event-panel-muted-text", bg: "--event-panel-bg" },
];

const BORDER_PAIRS: ReadonlyArray<{ border: string; against: string }> = [
  { border: "--ring", against: "--background" },
  { border: "--event-panel-divider", against: "--event-panel-bg" },
  { border: "--cal-drag-preview-border", against: "--background" },
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

  /**
   * Surface hierarchy: the dark built-in establishes a layered stack
   * where sidebar recedes below canvas while card/popover/accent elevate
   * above it. Applying the ΔL deltas to any canvas must reproduce this
   * ordering. Near-white or near-black canvases clamp in
   * `shiftPerceptualL`, so the upper tiers may collapse to the gamut
   * boundary (accent = popover = card = 1 on a near-white canvas): the
   * invariant therefore allows non-strict `<=` ordering between tiers
   * that share the same direction, while sidebar (the only downward
   * step) must stay strictly below canvas whenever canvas has headroom.
   */
  for (const base of ["light", "dark"] as const) {
    const sources = base === "light" ? LIGHT_SOURCES : DARK_SOURCES;

    it(`preserves the surface hierarchy sidebar <= canvas <= card <= popover <= accent (${base})`, () => {
      const tokens = deriveAppTokens(sources, base);
      const L = (hex: string) => hexToOklab(hex)!.L;
      const sidebarL = L(tokens["--sidebar"]);
      const canvasL = L(tokens["--background"]);
      const cardL = L(tokens["--card"]);
      const popoverL = L(tokens["--popover"]);
      const accentL = L(tokens["--accent"]);
      expect(sidebarL).toBeLessThanOrEqual(canvasL);
      expect(canvasL).toBeLessThanOrEqual(cardL);
      expect(cardL).toBeLessThanOrEqual(popoverL);
      expect(popoverL).toBeLessThanOrEqual(accentL);
    });

    it(`places event-panel-contrast <= canvas and event-panel-bg >= canvas (${base})`, () => {
      const tokens = deriveAppTokens(sources, base);
      const L = (hex: string) => hexToOklab(hex)!.L;
      expect(L(tokens["--event-panel-contrast"])).toBeLessThanOrEqual(
        L(tokens["--background"]),
      );
      expect(L(tokens["--event-panel-bg"])).toBeGreaterThanOrEqual(
        L(tokens["--background"]),
      );
    });
  }

  it("preserves the surface hierarchy with strict ordering when canvas has headroom", () => {
    // A canvas in the mid-luminance band (~0.90 L) leaves full room for
    // every tier to separate without clamping. This is the scenario a
    // user creating a new custom theme typically lands on; the dark
    // built-in itself (~0.28 L) is the other end of the same space.
    const pastel: ThemeSources = { ...LIGHT_SOURCES, canvas: "#F4E9D3" };
    const tokens = deriveAppTokens(pastel, "light");
    const L = (hex: string) => hexToOklab(hex)!.L;
    expect(L(tokens["--sidebar"])).toBeLessThan(L(tokens["--background"]));
    expect(L(tokens["--background"])).toBeLessThan(L(tokens["--card"]));
    expect(L(tokens["--card"])).toBeLessThan(L(tokens["--popover"]));
    expect(L(tokens["--popover"])).toBeLessThan(L(tokens["--accent"]));
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
    };
    const tokens = deriveAppTokens(extreme, "dark");
    for (const [fg, bg] of AA_FOREGROUND_PAIRS) {
      assertAA(tokens[fg], tokens[bg], `extreme ${fg} on ${bg}`);
    }
  });

  it("ignores the cosmetic base label when sources are provided", () => {
    const asLight = deriveAppTokens(LIGHT_SOURCES, "light");
    const asDark = deriveAppTokens(LIGHT_SOURCES, "dark");
    for (const key of Object.keys(asLight)) {
      expect(asDark[key]).toBe(asLight[key]);
    }
  });
});

describe("deriveCalendarTokens", () => {
  it("returns entries for every derivable key, not for the fully-semantic ones", () => {
    const derived = deriveCalendarTokens(LIGHT_SOURCES, "light");
    expect(derived["--cal-bg"]).toBeDefined();
    expect(derived["--cal-header-bg"]).toBeDefined();
    expect(derived["--cal-gridline"]).toBeDefined();
    expect(derived["--cal-time-label"]).toBeDefined();
    expect(derived["--cal-timeline-rail"]).toBeDefined();
    expect(derived["--cal-today-circle"]).toBeDefined();
    expect(derived["--cal-today-circle-text"]).toBeDefined();
    expect(derived["--cal-timeline-break"]).toBeDefined();
    // current-time (red "now" line) and timeline-focus (green pomodoro
    // marker) carry hard-coded semantic meaning and stay undefined in
    // the derivation so the base CSS defaults win.
    expect(derived["--cal-current-time"]).toBeUndefined();
    expect(derived["--cal-timeline-focus"]).toBeUndefined();
  });

  it("pins the calendar header to the app canvas and derives cal-bg from it", () => {
    const light = deriveCalendarTokens(LIGHT_SOURCES, "light");
    expect(light["--cal-header-bg"]).toBe(LIGHT_SOURCES.canvas);
    // cal-bg is no longer a source: on a light canvas it lifts slightly
    // above canvas, so the two should diverge but stay close.
    expect(light["--cal-bg"]).not.toBe(LIGHT_SOURCES.canvas);
  });

  it("auto-derives cal-bg in opposite directions based on canvas luminance", () => {
    const light = deriveCalendarTokens(LIGHT_SOURCES, "light");
    const dark = deriveCalendarTokens(DARK_SOURCES, "dark");
    const canvasL = (hex: string) => hexToOklab(hex)!.L;
    // Light canvas: cal-bg lifts above canvas (positive ΔL).
    expect(canvasL(light["--cal-bg"])).toBeGreaterThan(
      canvasL(LIGHT_SOURCES.canvas),
    );
    // Dark canvas: cal-bg recedes below canvas (negative ΔL).
    expect(canvasL(dark["--cal-bg"])).toBeLessThan(
      canvasL(DARK_SOURCES.canvas),
    );
  });

  it("direction of cal-bg derivation flips at the luminance midpoint", () => {
    // A barely-dark canvas pulls cal-bg down; a barely-light canvas pushes
    // it up. This confirms the `< 0.5 relativeLuminance` branch.
    const darkish: ThemeSources = { ...LIGHT_SOURCES, canvas: "#404040" };
    const lightish: ThemeSources = { ...LIGHT_SOURCES, canvas: "#E0E0E0" };
    const darkTokens = deriveCalendarTokens(darkish, "dark");
    const lightTokens = deriveCalendarTokens(lightish, "light");
    expect(relativeLuminance(darkish.canvas)).toBeLessThan(0.5);
    expect(relativeLuminance(lightish.canvas)).toBeGreaterThanOrEqual(0.5);
    expect(hexToOklab(darkTokens["--cal-bg"])!.L).toBeLessThan(
      hexToOklab(darkish.canvas)!.L,
    );
    expect(hexToOklab(lightTokens["--cal-bg"])!.L).toBeGreaterThan(
      hexToOklab(lightish.canvas)!.L,
    );
  });

  it("matches shiftPerceptualL for cal-bg derivation (round-trip)", () => {
    // The derivation uses a direction-aware ΔL offset: -0.173 on dark
    // canvases, +0.044 on light. Re-deriving from the same canvas via
    // shiftPerceptualL should produce identical output (pure function).
    const canvas = "#27282A"; // dark built-in canvas
    const expected = shiftPerceptualL(canvas, -0.173);
    const sources: ThemeSources = { ...DARK_SOURCES, canvas };
    const tokens = deriveCalendarTokens(sources, "dark");
    expect(tokens["--cal-bg"]).toBe(expected);
  });

  for (const base of ["light", "dark"] as const) {
    const sources = base === "light" ? LIGHT_SOURCES : DARK_SOURCES;

    it(`gridline sits at or above 1.4:1 against the calendar canvas (${base})`, () => {
      // Gridline target was lowered from 3 to 1.4 so cloned themes
      // inherit the built-in's subtle gridline style (~1.5:1) instead
      // of the previous prominent 3:1 lines.
      const tokens = deriveCalendarTokens(sources, base);
      const ratio = contrastRatio(tokens["--cal-gridline"], tokens["--cal-bg"]);
      expect(ratio).toBeGreaterThanOrEqual(1.4);
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

    it(`today circle pairs its text at or above 4.5:1 (${base})`, () => {
      const tokens = deriveCalendarTokens(sources, base);
      const ratio = contrastRatio(
        tokens["--cal-today-circle-text"],
        tokens["--cal-today-circle"],
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it(`timeline break sits at or above 3:1 against the calendar canvas (${base})`, () => {
      const tokens = deriveCalendarTokens(sources, base);
      const ratio = contrastRatio(
        tokens["--cal-timeline-break"],
        tokens["--cal-bg"],
      );
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });
  }

  it("ignores the cosmetic base label when sources are provided", () => {
    const asLight = deriveCalendarTokens(LIGHT_SOURCES, "light");
    const asDark = deriveCalendarTokens(LIGHT_SOURCES, "dark");
    for (const key of Object.keys(asLight)) {
      expect(asDark[key]).toBe(asLight[key]);
    }
  });
});
