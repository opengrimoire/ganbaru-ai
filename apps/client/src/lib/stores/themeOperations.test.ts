import { describe, it, expect } from "vitest";
import { PALETTE_SIZE } from "$lib/components/calendar/types";
import {
  cloneTheme,
  mergeThemePatch,
  nextUniqueDisplayName,
  normalizeDisplayName,
} from "./themeOperations";
import { type Theme } from "./themes";

function makeTheme(overrides: Partial<Theme> = {}): Theme {
  const eventPalette: string[] = Array.from(
    { length: PALETTE_SIZE },
    () => "#abcdef",
  );
  return {
    id: "seed",
    displayName: "Seed",
    base: "dark",
    blendCanvas: "#101010",
    eventPalette,
    ...overrides,
  };
}

describe("cloneTheme", () => {
  it("assigns the supplied id and displayName", () => {
    const copy = cloneTheme(makeTheme(), "fork", "Fork");
    expect(copy.id).toBe("fork");
    expect(copy.displayName).toBe("Fork");
  });

  it("copies base and blendCanvas verbatim", () => {
    const source = makeTheme({ base: "light", blendCanvas: "#fafafa" });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.base).toBe("light");
    expect(copy.blendCanvas).toBe("#fafafa");
  });

  it("clones the eventPalette so source mutations do not leak", () => {
    const source = makeTheme();
    const copy = cloneTheme(source, "fork", "Fork");
    (copy.eventPalette as string[])[2] = "#ff0000";
    expect(source.eventPalette[2]).toBe("#abcdef");
  });

  it("clones appTokenOverrides when present", () => {
    const source = makeTheme({ appTokenOverrides: { "--primary": "#111111" } });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.appTokenOverrides).toEqual({ "--primary": "#111111" });
    expect(copy.appTokenOverrides).not.toBe(source.appTokenOverrides);
  });

  it("clones calendarTokenOverrides when present", () => {
    const source = makeTheme({
      calendarTokenOverrides: { "--cal-bg": "#202020" },
    });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.calendarTokenOverrides).toEqual({ "--cal-bg": "#202020" });
    expect(copy.calendarTokenOverrides).not.toBe(source.calendarTokenOverrides);
  });

  it("omits override blocks that the source did not carry", () => {
    const copy = cloneTheme(makeTheme(), "fork", "Fork");
    expect(copy.appTokenOverrides).toBeUndefined();
    expect(copy.calendarTokenOverrides).toBeUndefined();
  });
});

describe("mergeThemePatch", () => {
  it("preserves the original id even if the patch tries to spread one", () => {
    const current = makeTheme({ id: "user-1" });
    const next = mergeThemePatch(current, {
      displayName: "renamed",
    } as Partial<Omit<Theme, "id">>);
    expect(next.id).toBe("user-1");
    expect(next.displayName).toBe("renamed");
  });

  it("replaces eventPalette wholesale when the patch supplies one", () => {
    const current = makeTheme();
    const next = mergeThemePatch(current, {
      eventPalette: [...current.eventPalette].map((hex, i) =>
        i === 2 ? "#ff0000" : hex,
      ),
    });
    expect(next.eventPalette[2]).toBe("#ff0000");
    expect(next.eventPalette[12]).toBe(current.eventPalette[12]);
  });

  it("does not mutate the source palette", () => {
    const current = makeTheme();
    const before = current.eventPalette[2];
    const patched = [...current.eventPalette];
    patched[2] = "#ff0000";
    mergeThemePatch(current, { eventPalette: patched });
    expect(current.eventPalette[2]).toBe(before);
  });

  it("clones the patch palette so later mutations do not leak", () => {
    const current = makeTheme();
    const patched = [...current.eventPalette];
    patched[2] = "#ff0000";
    const next = mergeThemePatch(current, { eventPalette: patched });
    patched[2] = "#0000ff";
    expect(next.eventPalette[2]).toBe("#ff0000");
  });

  it("replaces appTokenOverrides wholesale", () => {
    const current = makeTheme({
      appTokenOverrides: { "--primary": "#111111", "--background": "#000000" },
    });
    const next = mergeThemePatch(current, {
      appTokenOverrides: { "--primary": "#222222" },
    });
    expect(next.appTokenOverrides).toEqual({ "--primary": "#222222" });
  });

  it("collapses an empty appTokenOverrides patch to undefined", () => {
    const current = makeTheme({
      appTokenOverrides: { "--primary": "#111111" },
    });
    const next = mergeThemePatch(current, { appTokenOverrides: {} });
    expect(next.appTokenOverrides).toBeUndefined();
  });

  it("collapses an empty calendarTokenOverrides patch to undefined", () => {
    const current = makeTheme({
      calendarTokenOverrides: { "--cal-bg": "#202020" },
    });
    const next = mergeThemePatch(current, { calendarTokenOverrides: {} });
    expect(next.calendarTokenOverrides).toBeUndefined();
  });

  it("leaves overrides alone when the patch omits them", () => {
    const current = makeTheme({
      appTokenOverrides: { "--primary": "#111111" },
      calendarTokenOverrides: { "--cal-bg": "#202020" },
    });
    const next = mergeThemePatch(current, { displayName: "renamed" });
    expect(next.appTokenOverrides).toEqual({ "--primary": "#111111" });
    expect(next.calendarTokenOverrides).toEqual({ "--cal-bg": "#202020" });
  });

  it("flips base when the patch supplies it", () => {
    const current = makeTheme({ base: "dark" });
    const next = mergeThemePatch(current, { base: "light" });
    expect(next.base).toBe("light");
  });
});

describe("nextUniqueDisplayName", () => {
  it("returns the base name when nothing collides", () => {
    expect(nextUniqueDisplayName("Solarized", [])).toBe("Solarized");
    expect(nextUniqueDisplayName("Solarized", ["Other"])).toBe("Solarized");
  });

  it("appends 2 on first collision", () => {
    expect(nextUniqueDisplayName("Solarized", ["Solarized"])).toBe("Solarized 2");
  });

  it("walks the suffix until a free slot is found", () => {
    expect(
      nextUniqueDisplayName("Theme", ["Theme", "Theme 2", "Theme 3"]),
    ).toBe("Theme 4");
  });

  it("compares case-insensitively", () => {
    expect(nextUniqueDisplayName("SOLARIZED", ["solarized"])).toBe(
      "SOLARIZED 2",
    );
  });

  it("accepts iterables, not just arrays", () => {
    const set = new Set(["Theme"]);
    expect(nextUniqueDisplayName("Theme", set)).toBe("Theme 2");
  });
});

describe("normalizeDisplayName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeDisplayName("  hi  ")).toBe("hi");
  });

  it("returns undefined for empty or whitespace-only input", () => {
    expect(normalizeDisplayName("")).toBeUndefined();
    expect(normalizeDisplayName("   ")).toBeUndefined();
    expect(normalizeDisplayName("\t\n")).toBeUndefined();
  });

  it("caps length at 60 characters", () => {
    const long = "a".repeat(120);
    const result = normalizeDisplayName(long);
    expect(result).toBeDefined();
    expect(result!.length).toBe(60);
  });

  it("leaves short names untouched", () => {
    expect(normalizeDisplayName("Solarized")).toBe("Solarized");
  });
});
