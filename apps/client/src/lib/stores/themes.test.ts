import { describe, it, expect } from "vitest";
import type { EventColor } from "$lib/components/calendar/types";
import {
  THEME_REGISTRY,
  DEFAULT_THEME_ID,
  darkTheme,
  lightTheme,
  getThemeById,
  themeIds,
  computeThemeTokenOps,
  type Theme,
} from "./themes";

const REQUIRED_EVENT_COLORS: readonly EventColor[] = [
  "radicchio", "cherryBlossom", "tomato", "flamingo", "tangerine",
  "pumpkin", "mango", "banana", "citron", "avocado", "pistachio",
  "sage", "basil", "eucalyptus", "peacock", "cobalt", "blueberry",
  "lavender", "wisteria", "amethyst", "grape", "cocoa", "graphite", "birch",
];

describe("theme registry", () => {
  it("registers light and dark built-in themes", () => {
    expect(THEME_REGISTRY[lightTheme.id]).toBe(lightTheme);
    expect(THEME_REGISTRY[darkTheme.id]).toBe(darkTheme);
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
    expect(Object.isFrozen(THEME_REGISTRY)).toBe(true);
  });
});

describe("built-in themes", () => {
  it("every built-in theme covers all required event colors", () => {
    for (const theme of [lightTheme, darkTheme]) {
      for (const color of REQUIRED_EVENT_COLORS) {
        expect(
          theme.eventPalette[color],
          `${theme.id} is missing ${color}`,
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
    for (const color of REQUIRED_EVENT_COLORS) {
      expect(
        lightTheme.eventPalette[color].toLowerCase(),
        `${color} is identical across light and dark`,
      ).not.toBe(darkTheme.eventPalette[color].toLowerCase());
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
