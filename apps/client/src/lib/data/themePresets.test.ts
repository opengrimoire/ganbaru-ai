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
const AA_FOREGROUND_PAIRS: ReadonlyArray<[string, string]> = [
  ["--foreground", "--background"],
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

const MUTED_BANDS: ReadonlyArray<{ fg: string; bg: string }> = [
  { fg: "--muted-foreground", bg: "--muted" },
];

const BORDER_PAIRS: ReadonlyArray<{ border: string; against: string }> = [
  { border: "--ring", against: "--background" },
];

describe("THEME_PRESETS", () => {
  for (const preset of THEME_PRESETS) {
    describe(preset.displayName, () => {
      const app = deriveAppTokens(preset.sources, preset.base);
      const cal = deriveCalendarTokens(preset.sources, preset.base);
      const baseApp = BASE_APP_TOKENS[preset.base];
      const baseCal = BASE_CALENDAR_TOKENS[preset.base];
      const resolvedApp = { ...baseApp, ...app };
      const resolvedCal = { ...baseCal, ...cal };

      it("meets AA 4.5:1 on every foreground/background pair", () => {
        for (const [fg, bg] of AA_FOREGROUND_PAIRS) {
          const ratio = contrastRatio(resolvedApp[fg], resolvedApp[bg]);
          if (ratio < 4.5) {
            throw new Error(
              `${preset.displayName}: ${fg} (${resolvedApp[fg]}) on ${bg} (${resolvedApp[bg]}) = ${ratio.toFixed(2)}:1`,
            );
          }
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("parks muted captions inside [3.0, 4.5]", () => {
        for (const { fg, bg } of MUTED_BANDS) {
          const ratio = contrastRatio(resolvedApp[fg], resolvedApp[bg]);
          expect(ratio).toBeGreaterThanOrEqual(3.0);
          expect(ratio).toBeLessThanOrEqual(4.5);
        }
      });

      it("keeps borders at or above 3:1", () => {
        for (const { border, against } of BORDER_PAIRS) {
          const ratio = contrastRatio(resolvedApp[border], resolvedApp[against]);
          expect(ratio).toBeGreaterThanOrEqual(3.0);
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

      it("parks calendar time label inside [3.0, 4.5] against cal header", () => {
        const ratio = contrastRatio(
          resolvedCal["--cal-time-label"],
          resolvedCal["--cal-header-bg"],
        );
        expect(ratio).toBeGreaterThanOrEqual(3.0);
        expect(ratio).toBeLessThanOrEqual(4.5);
      });
    });
  }

  it("all presets have unique ids", () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
