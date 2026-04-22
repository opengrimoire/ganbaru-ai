import { describe, it, expect } from "vitest";
import { PALETTE_SIZE } from "$lib/components/calendar/types";
import {
  BUILTIN_THEME_REGISTRY,
  DEFAULT_THEME_ID,
  APP_TOKEN_KEYS,
  CALENDAR_TOKEN_KEYS,
  darkTheme,
  lightTheme,
  getThemeById,
  isBuiltinThemeId,
  isThemeCalendarDark,
  isThemeDark,
  resolveCalCanvas,
  resolveCanvas,
  themeIds,
  computeThemeTokenOps,
  generateThemeId,
  serializeTheme,
  validateThemeJson,
  type Theme,
} from "./themes";

function buildValidThemeInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const palette: string[] = Array.from({ length: PALETTE_SIZE }, () => "#abcdef");
  return {
    id: "custom-theme",
    displayName: "Custom Theme",
    base: "dark",
    blendCanvas: "#202020",
    eventPalette: palette,
    ...overrides,
  };
}

const PALETTE_INDICES: readonly number[] = Array.from(
  { length: PALETTE_SIZE },
  (_, i) => i,
);

describe("theme registry", () => {
  it("registers light and dark built-in themes", () => {
    expect(BUILTIN_THEME_REGISTRY[lightTheme.id]).toBe(lightTheme);
    expect(BUILTIN_THEME_REGISTRY[darkTheme.id]).toBe(darkTheme);
  });

  it("exposes themeIds in insertion order", () => {
    const ids = themeIds();
    expect(ids).toContain("light");
    expect(ids).toContain("dark");
  });

  it("default theme ID is registered", () => {
    expect(getThemeById(DEFAULT_THEME_ID)).toBeDefined();
  });

  it("freezes registry to prevent mutation", () => {
    expect(Object.isFrozen(BUILTIN_THEME_REGISTRY)).toBe(true);
  });
});

describe("built-in themes", () => {
  it("every built-in theme has a hex value at every palette index", () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(theme.eventPalette.length).toBe(PALETTE_SIZE);
      for (const i of PALETTE_INDICES) {
        expect(
          theme.eventPalette[i],
          `${theme.id} is missing index ${i}`,
        ).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("lightTheme has base 'light'", () => {
    expect(lightTheme.base).toBe("light");
  });

  it("darkTheme has base 'dark'", () => {
    expect(darkTheme.base).toBe("dark");
  });

  it("every built-in theme provides a hex blendCanvas", () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(theme.blendCanvas).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("every built-in theme has a user-visible displayName", () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(theme.displayName.length).toBeGreaterThan(0);
    }
  });

  it("light and dark palettes differ for every slot", () => {
    for (const i of PALETTE_INDICES) {
      expect(
        lightTheme.eventPalette[i].toLowerCase(),
        `index ${i} is identical across light and dark`,
      ).not.toBe(darkTheme.eventPalette[i].toLowerCase());
    }
  });
});

describe("getThemeById", () => {
  it("returns the theme for a valid ID", () => {
    expect(getThemeById("light")).toBe(lightTheme);
    expect(getThemeById("dark")).toBe(darkTheme);
  });

  it("returns undefined for unknown IDs", () => {
    expect(getThemeById("nope")).toBeUndefined();
  });

  it("returns undefined for null, undefined, and empty inputs", () => {
    expect(getThemeById(null)).toBeUndefined();
    expect(getThemeById(undefined)).toBeUndefined();
    expect(getThemeById("")).toBeUndefined();
  });

  it("guards against prototype-chain keys", () => {
    expect(getThemeById("toString")).toBeUndefined();
    expect(getThemeById("__proto__")).toBeUndefined();
    expect(getThemeById("constructor")).toBeUndefined();
  });
});

describe("computeThemeTokenOps", () => {
  const withOverrides = (
    app?: Record<string, string>,
    cal?: Record<string, string>,
  ): Theme => ({
    ...lightTheme,
    id: "test",
    appTokenOverrides: app,
    calendarTokenOverrides: cal,
  });

  it("returns no-op when theme has no overrides and nothing was applied", () => {
    const result = computeThemeTokenOps(lightTheme, new Set());
    expect(result.toSet.size).toBe(0);
    expect(result.toClear.size).toBe(0);
    expect(result.applied.size).toBe(0);
  });

  it("sets every app and calendar token override", () => {
    const theme = withOverrides(
      { "--primary": "#abc", "--background": "#fff" },
      { "--cal-bg": "#eee" },
    );
    const result = computeThemeTokenOps(theme, new Set());
    expect(result.toSet.get("--primary")).toBe("#abc");
    expect(result.toSet.get("--background")).toBe("#fff");
    expect(result.toSet.get("--cal-bg")).toBe("#eee");
    expect(result.toClear.size).toBe(0);
    expect(result.applied).toEqual(
      new Set(["--primary", "--background", "--cal-bg"]),
    );
  });

  it("clears previously applied tokens that the new theme does not set", () => {
    const theme = withOverrides({ "--primary": "#abc" });
    const previous = new Set(["--primary", "--background", "--cal-bg"]);
    const result = computeThemeTokenOps(theme, previous);
    expect(result.toSet.get("--primary")).toBe("#abc");
    expect(result.toClear).toEqual(new Set(["--background", "--cal-bg"]));
    expect(result.applied).toEqual(new Set(["--primary"]));
  });

  it("reassigns a token the previous theme also set without clearing it", () => {
    const theme = withOverrides({ "--primary": "#xyz" });
    const result = computeThemeTokenOps(theme, new Set(["--primary"]));
    expect(result.toSet.get("--primary")).toBe("#xyz");
    expect(result.toClear.size).toBe(0);
    expect(result.applied).toEqual(new Set(["--primary"]));
  });

  it("clears all previously applied keys when switching to a theme without overrides", () => {
    const result = computeThemeTokenOps(
      lightTheme,
      new Set(["--primary", "--cal-bg"]),
    );
    expect(result.toSet.size).toBe(0);
    expect(result.toClear).toEqual(new Set(["--primary", "--cal-bg"]));
    expect(result.applied.size).toBe(0);
  });

  it("merges app and calendar overrides into one applied set", () => {
    const theme = withOverrides(
      { "--primary": "#111" },
      { "--cal-bg": "#222" },
    );
    const result = computeThemeTokenOps(theme, new Set());
    expect(result.applied).toEqual(new Set(["--primary", "--cal-bg"]));
  });
});

describe("isBuiltinThemeId", () => {
  it("identifies built-in IDs", () => {
    expect(isBuiltinThemeId("light")).toBe(true);
    expect(isBuiltinThemeId("dark")).toBe(true);
  });

  it("rejects unknown IDs", () => {
    expect(isBuiltinThemeId("custom-abc")).toBe(false);
    expect(isBuiltinThemeId(undefined)).toBe(false);
    expect(isBuiltinThemeId(null)).toBe(false);
    expect(isBuiltinThemeId("")).toBe(false);
  });

  it("guards against prototype-chain keys", () => {
    expect(isBuiltinThemeId("toString")).toBe(false);
    expect(isBuiltinThemeId("__proto__")).toBe(false);
  });
});

describe("token catalogs", () => {
  it("APP_TOKEN_KEYS only contains -- prefixed names", () => {
    for (const key of APP_TOKEN_KEYS) expect(key.startsWith("--")).toBe(true);
  });

  it("CALENDAR_TOKEN_KEYS only contains --cal- prefixed names", () => {
    for (const key of CALENDAR_TOKEN_KEYS) expect(key.startsWith("--cal-")).toBe(true);
  });

  it("are frozen", () => {
    expect(Object.isFrozen(APP_TOKEN_KEYS)).toBe(true);
    expect(Object.isFrozen(CALENDAR_TOKEN_KEYS)).toBe(true);
  });
});

describe("luminance-driven base detection", () => {
  it("resolveCanvas returns the source canvas when set", () => {
    const theme: Theme = {
      id: "bright",
      displayName: "Bright",
      base: "dark",
      blendCanvas: "#ffffff",
      eventPalette: Array.from({ length: PALETTE_SIZE }, () => "#abcdef"),
      sources: {
        canvas: "#FAF7F2",
        ink: "#1F1B16",
        primary: "#2563EB",
        destructive: "#B42318",
        confirm: "#047857",
        warning: "#B45309",
        calCanvas: "#FFFFFF",
      },
    };
    expect(resolveCanvas(theme).toLowerCase()).toBe("#faf7f2");
  });

  it("resolveCanvas override beats source", () => {
    const theme: Theme = {
      id: "pinned",
      displayName: "Pinned",
      base: "light",
      blendCanvas: "#000000",
      eventPalette: Array.from({ length: PALETTE_SIZE }, () => "#abcdef"),
      sources: {
        canvas: "#FFFFFF",
        ink: "#000000",
        primary: "#2563EB",
        destructive: "#B42318",
        confirm: "#047857",
        warning: "#B45309",
        calCanvas: "#FFFFFF",
      },
      appTokenOverrides: { "--background": "#101010" },
    };
    expect(resolveCanvas(theme).toLowerCase()).toBe("#101010");
  });

  it("isThemeDark ignores the base label when sources flip", () => {
    const theme: Theme = {
      id: "bright",
      displayName: "Bright (labeled dark)",
      base: "dark",
      blendCanvas: "#ffffff",
      eventPalette: Array.from({ length: PALETTE_SIZE }, () => "#abcdef"),
      sources: {
        canvas: "#FAF7F2",
        ink: "#1F1B16",
        primary: "#2563EB",
        destructive: "#B42318",
        confirm: "#047857",
        warning: "#B45309",
        calCanvas: "#FFFFFF",
      },
    };
    expect(isThemeDark(theme)).toBe(false);
  });

  it("isThemeDark returns true when canvas is dark regardless of label", () => {
    const theme: Theme = {
      id: "dim",
      displayName: "Dim (labeled light)",
      base: "light",
      blendCanvas: "#000000",
      eventPalette: Array.from({ length: PALETTE_SIZE }, () => "#abcdef"),
      sources: {
        canvas: "#1B1C1F",
        ink: "#E9EAEE",
        primary: "#90A5FF",
        destructive: "#F06060",
        confirm: "#44C48A",
        warning: "#F5B143",
        calCanvas: "#0E0F11",
      },
    };
    expect(isThemeDark(theme)).toBe(true);
  });

  it("isThemeCalendarDark keys off calCanvas, not canvas", () => {
    const theme: Theme = {
      id: "split",
      displayName: "Bright app, dark cal",
      base: "light",
      blendCanvas: "#0E0F11",
      eventPalette: Array.from({ length: PALETTE_SIZE }, () => "#abcdef"),
      sources: {
        canvas: "#FAF7F2",
        ink: "#1F1B16",
        primary: "#2563EB",
        destructive: "#B42318",
        confirm: "#047857",
        warning: "#B45309",
        calCanvas: "#0E0F11",
      },
    };
    expect(isThemeDark(theme)).toBe(false);
    expect(isThemeCalendarDark(theme)).toBe(true);
  });

  it("falls back to base defaults when the theme has no sources", () => {
    expect(resolveCanvas(lightTheme).toLowerCase()).toBe("#f4f4f7");
    expect(resolveCanvas(darkTheme).toLowerCase()).toBe("#27282a");
    expect(resolveCalCanvas(lightTheme).toLowerCase()).toBe("#ffffff");
    expect(resolveCalCanvas(darkTheme).toLowerCase()).toBe("#131314");
    expect(isThemeDark(lightTheme)).toBe(false);
    expect(isThemeDark(darkTheme)).toBe(true);
    expect(isThemeCalendarDark(lightTheme)).toBe(false);
    expect(isThemeCalendarDark(darkTheme)).toBe(true);
  });
});

describe("generateThemeId", () => {
  it("returns a unique ID not in the existing registry", () => {
    const existing = { "theme-aaaaaa": darkTheme };
    const id = generateThemeId(existing);
    expect(existing).not.toHaveProperty(id);
    expect(id.startsWith("theme-")).toBe(true);
  });

  it("uses the provided slug-shaped prefix", () => {
    const id = generateThemeId({}, "midnight");
    expect(id.startsWith("midnight-")).toBe(true);
  });

  it("falls back to the default prefix when given a non-slug prefix", () => {
    const id = generateThemeId({}, "not a slug!");
    expect(id.startsWith("theme-")).toBe(true);
  });
});

describe("validateThemeJson", () => {
  it("accepts a fully valid theme", () => {
    const result = validateThemeJson(buildValidThemeInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.id).toBe("custom-theme");
      expect(result.theme.displayName).toBe("Custom Theme");
      expect(result.theme.base).toBe("dark");
      expect(result.theme.eventPalette).toHaveLength(PALETTE_SIZE);
      expect(result.theme.eventPalette[0]).toBe("#abcdef");
    }
  });

  it("rejects non-object inputs", () => {
    expect(validateThemeJson(null).ok).toBe(false);
    expect(validateThemeJson("not an object").ok).toBe(false);
    expect(validateThemeJson(42).ok).toBe(false);
    expect(validateThemeJson([]).ok).toBe(false);
  });

  it("rejects an id that is not a slug", () => {
    const result = validateThemeJson(buildValidThemeInput({ id: "Has Spaces" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("rejects an empty displayName", () => {
    const result = validateThemeJson(buildValidThemeInput({ displayName: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("displayName"))).toBe(true);
  });

  it("rejects an oversized displayName", () => {
    const result = validateThemeJson(
      buildValidThemeInput({ displayName: "x".repeat(61) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.includes("displayName"))).toBe(true);
  });

  it("rejects unknown base values", () => {
    const result = validateThemeJson(buildValidThemeInput({ base: "rainbow" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("base"))).toBe(true);
  });

  it("rejects an invalid blendCanvas", () => {
    const result = validateThemeJson(buildValidThemeInput({ blendCanvas: "white" }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.includes("blendCanvas"))).toBe(true);
  });

  it("rejects a palette of the wrong length", () => {
    const partial = Array.from({ length: 3 }, () => "#000000");
    const result = validateThemeJson(
      buildValidThemeInput({ eventPalette: partial }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.includes("eventPalette"))).toBe(true);
  });

  it("rejects an eventPalette that is not an array", () => {
    const result = validateThemeJson(
      buildValidThemeInput({ eventPalette: { 0: "#abcdef" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.includes("eventPalette"))).toBe(true);
  });

  it("rejects a non-hex palette entry", () => {
    const palette: string[] = Array.from({ length: PALETTE_SIZE }, () => "#abcdef");
    palette[0] = "not-a-hex";
    const result = validateThemeJson(
      buildValidThemeInput({ eventPalette: palette }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.includes("[0]"))).toBe(true);
  });

  it("accepts known appTokenOverrides and rejects bad hex", () => {
    const result = validateThemeJson(
      buildValidThemeInput({
        appTokenOverrides: { "--primary": "#112233", "--background": "not-a-color" },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((e) => e.includes("--background"))).toBe(true);
  });

  it("strips unknown override keys without erroring", () => {
    const result = validateThemeJson(
      buildValidThemeInput({
        appTokenOverrides: { "--primary": "#112233", "--made-up-token": "#000000" },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.appTokenOverrides).toEqual({ "--primary": "#112233" });
    }
  });

  it("omits empty override blocks from the cleaned theme", () => {
    const result = validateThemeJson(
      buildValidThemeInput({ appTokenOverrides: { "--unknown": "#000000" } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.theme.appTokenOverrides).toBeUndefined();
  });

  it("ignores prototype-chain keys when reading overrides", () => {
    const overrides = Object.create({ "--primary": "#000000" }) as Record<string, string>;
    overrides["--accent"] = "#112233";
    const result = validateThemeJson(
      buildValidThemeInput({ appTokenOverrides: overrides }),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.theme.appTokenOverrides).toEqual({ "--accent": "#112233" });
  });
});

describe("serializeTheme round-trip", () => {
  it("survives validate(serialize(t))", () => {
    const result = validateThemeJson(buildValidThemeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = serializeTheme(result.theme);
    const reparsed = validateThemeJson(JSON.parse(json));
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) {
      expect(reparsed.theme.id).toBe(result.theme.id);
      expect(reparsed.theme.eventPalette).toEqual(result.theme.eventPalette);
    }
  });

  it("serializes overrides only when non-empty", () => {
    const result = validateThemeJson(buildValidThemeInput());
    if (!result.ok) throw new Error("expected valid theme");
    const json = serializeTheme(result.theme);
    expect(json).not.toContain("appTokenOverrides");
    expect(json).not.toContain("calendarTokenOverrides");
  });

  it("emits keys in canonical order", () => {
    const result = validateThemeJson(
      buildValidThemeInput({
        appTokenOverrides: { "--accent": "#111111", "--primary": "#222222" },
      }),
    );
    if (!result.ok) throw new Error("expected valid theme");
    const json = serializeTheme(result.theme);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      "id",
      "displayName",
      "base",
      "blendCanvas",
      "eventPalette",
      "appTokenOverrides",
    ]);
    const overrides = parsed.appTokenOverrides as Record<string, string>;
    expect(Object.keys(overrides)).toEqual(["--primary", "--accent"]);
  });
});
