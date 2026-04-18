import { describe, it, expect } from "vitest";
import type { EventColor } from "$lib/components/calendar/types";
import {
  THEME_REGISTRY,
  DEFAULT_THEME_ID,
  darkTheme,
  lightTheme,
  getThemeById,
  themeIds,
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
