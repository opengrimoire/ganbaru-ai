import { describe, expect, it } from "vitest";
import {
  deriveAppTokens,
  deriveCalendarTokens,
  BASE_APP_TOKENS,
  BASE_CALENDAR_TOKENS,
} from "$lib/stores/themes";
import {
  contrastRatio,
} from "$lib/components/ui/colorMath";
import { THEME_PRESETS } from "./themePresets";

/**
 * Foreground/background pairs that must meet AA body-text contrast (4.5:1)
 * across every preset. Mirrors `themeDerivation.test.ts` so a preset that
 * regresses fails the build.
 */
const AA_BODY_PAIRS: ReadonlyArray<[string, string]> = [
  ["--foreground", "--background"],
  ["--popover-foreground", "--popover"],
  ["--primary-foreground", "--primary"],
  ["--secondary-foreground", "--secondary"],
  ["--accent-foreground", "--accent"],
  ["--sidebar-foreground", "--sidebar"],
  ["--sidebar-accent-foreground", "--sidebar-accent"],
];

/**
 * Status / destructive / confirm surfaces targeted at AA-large (3:1).
 * BASE palettes paint white over these at roughly 3-4:1; that reads as
 * bold-weight-compliant button labels. Enforcing 4.5 here would flag
 * BASE's own design intent (see themeDerivation.test.ts for parity).
 * Warning is included now that presets provide an explicit warning text
 * source instead of inheriting the old built-in white-on-amber pairing.
 */
const AA_LARGE_PAIRS: ReadonlyArray<[string, string]> = [
  ["--destructive-foreground", "--destructive"],
  ["--action-confirm-foreground", "--action-confirm"],
  ["--action-danger-armed-foreground", "--action-danger-armed"],
  ["--status-accepted-foreground", "--status-accepted"],
  ["--status-tentative-foreground", "--status-tentative"],
  ["--status-declined-foreground", "--status-declined"],
];

const MUTED_BANDS: ReadonlyArray<{ fg: string; bg: string }> = [
  { fg: "--muted-foreground", bg: "--muted" },
];

describe("THEME_PRESETS", () => {
  for (const preset of THEME_PRESETS) {
    describe(preset.displayName, () => {
      const app = deriveAppTokens(preset.sources);
      const cal = deriveCalendarTokens(preset.sources);
      const baseApp = BASE_APP_TOKENS[preset.base];
      const baseCal = BASE_CALENDAR_TOKENS[preset.base];
      const resolvedApp = { ...baseApp, ...app };
      const resolvedCal = { ...baseCal, ...cal };

      it("meets AA 4.5:1 on every body-text pair", () => {
        for (const [fg, bg] of AA_BODY_PAIRS) {
          const ratio = contrastRatio(resolvedApp[fg], resolvedApp[bg]);
          if (ratio < 4.5) {
            throw new Error(
              `${preset.displayName}: ${fg} (${resolvedApp[fg]}) on ${bg} (${resolvedApp[bg]}) = ${ratio.toFixed(2)}:1`,
            );
          }
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("meets AA-large 3:1 on every status/destructive/confirm pair", () => {
        for (const [fg, bg] of AA_LARGE_PAIRS) {
          const ratio = contrastRatio(resolvedApp[fg], resolvedApp[bg]);
          if (ratio < 3.0) {
            throw new Error(
              `${preset.displayName}: ${fg} (${resolvedApp[fg]}) on ${bg} (${resolvedApp[bg]}) = ${ratio.toFixed(2)}:1`,
            );
          }
          expect(ratio).toBeGreaterThanOrEqual(3.0);
        }
      });

      it("keeps muted captions at or above AA-large 3:1", () => {
        for (const { fg, bg } of MUTED_BANDS) {
          const ratio = contrastRatio(resolvedApp[fg], resolvedApp[bg]);
          expect(ratio).toBeGreaterThanOrEqual(3.0);
          expect(ratio).toBeLessThanOrEqual(5.0);
        }
      });

      it("keeps calendar gridline at or above 1.4:1 against cal canvas", () => {
        // Gridline target is 1.4:1 (not 3:1) so cloned themes inherit
        // the built-in's subtle gridline style. Mirrors the derivation
        // constant in `themes.ts`.
        const ratio = contrastRatio(
          resolvedCal["--cal-gridline"],
          resolvedCal["--cal-bg"],
        );
        expect(ratio).toBeGreaterThanOrEqual(1.4);
      });

      it("keeps calendar time label at or above 3:1 against cal canvas", () => {
        // Time labels sit on cal-bg (the day cell background). The
        // walk-fraction derivation parks them at BASE.dark's OKLab-L
        // position; the achieved contrast varies with canvas brightness
        // but never drops below AA-large.
        const ratio = contrastRatio(
          resolvedCal["--cal-time-label"],
          resolvedCal["--cal-bg"],
        );
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      });
    });
  }

  it("all presets have unique ids", () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
