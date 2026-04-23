import { describe, it, expect } from "vitest";
import { PALETTE_SIZE } from "$lib/components/calendar/types";
import {
  cloneTheme,
  mergeThemePatch,
  nextUniqueDisplayName,
  normalizeDisplayName,
  synthesizeSeedsIfMissing,
} from "./themeOperations";
import {
  APP_TOKEN_KEYS,
  BASE_APP_TOKENS,
  BASE_CALENDAR_TOKENS,
  CALENDAR_TOKEN_KEYS,
  type Theme,
} from "./themes";

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

  it("preserves explicit appTokenOverrides as pinned tokens", () => {
    const source = makeTheme({ appTokenOverrides: { "--primary": "#111111" } });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.appTokenOverrides?.["--primary"]).toBe("#111111");
    expect(copy.appTokenOverrides).not.toBe(source.appTokenOverrides);
  });

  it("preserves explicit calendarTokenOverrides as pinned tokens", () => {
    const source = makeTheme({
      calendarTokenOverrides: { "--cal-bg": "#202020" },
    });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.calendarTokenOverrides?.["--cal-bg"]).toBe("#202020");
    expect(copy.calendarTokenOverrides).not.toBe(source.calendarTokenOverrides);
  });

  it("does not invent identity overrides on a sourceless clone", () => {
    // The clone relies on the derivation producing the same surface
    // hierarchy as the built-in on any canvas. Pinning derived tokens
    // would prevent canvas edits from cascading, so overrides must
    // stay empty unless the source itself carried them.
    const source = makeTheme({ base: "dark" });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.appTokenOverrides).toBeUndefined();
    expect(copy.calendarTokenOverrides).toBeUndefined();
  });

  it("synthesizes sources from the resolved palette when source has none", () => {
    const source = makeTheme({ base: "light" });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.sources).toEqual({
      canvas: BASE_APP_TOKENS.light["--background"],
      ink: BASE_APP_TOKENS.light["--foreground"],
      primary: BASE_APP_TOKENS.light["--primary"],
      destructive: BASE_APP_TOKENS.light["--destructive"],
      confirm: BASE_APP_TOKENS.light["--action-confirm"],
      warning: BASE_APP_TOKENS.light["--status-tentative"],
    });
  });

  it("synthesizes sources from app overrides and preserves cal-bg as a pinned override", () => {
    // Calendar canvas is no longer a source: it auto-derives from
    // `sources.canvas`. A user-pinned --cal-bg is preserved through
    // `calendarTokenOverrides` so the clone keeps that surface color
    // isolated from the cascade.
    const source = makeTheme({
      base: "dark",
      appTokenOverrides: {
        "--background": "#111111",
        "--foreground": "#eeeeee",
      },
      calendarTokenOverrides: { "--cal-bg": "#222222" },
    });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.sources?.canvas).toBe("#111111");
    expect(copy.sources?.ink).toBe("#eeeeee");
    expect(copy.calendarTokenOverrides?.["--cal-bg"]).toBe("#222222");
  });

  it("preserves sources verbatim when the source already has them", () => {
    const theSources = {
      canvas: "#111111",
      ink: "#eeeeee",
      primary: "#00aaff",
      destructive: "#ff0033",
      confirm: "#00cc88",
      warning: "#f5a524",
    };
    const source = makeTheme({ sources: theSources });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.sources).toEqual(theSources);
    expect(copy.sources).not.toBe(source.sources);
  });

  it("snapshots seedAppTokens from the resolved source palette", () => {
    const source = makeTheme({
      base: "light",
      appTokenOverrides: { "--primary": "#abc123" },
    });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.seedAppTokens?.["--primary"]).toBe("#abc123");
    for (const key of APP_TOKEN_KEYS) {
      if (key === "--primary") continue;
      expect(copy.seedAppTokens?.[key]).toBe(BASE_APP_TOKENS.light[key]);
    }
  });

  it("snapshots seedCalendarTokens from the resolved source palette", () => {
    const source = makeTheme({
      base: "dark",
      calendarTokenOverrides: { "--cal-bg": "#202020" },
    });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.seedCalendarTokens?.["--cal-bg"]).toBe("#202020");
    for (const key of CALENDAR_TOKEN_KEYS) {
      if (key === "--cal-bg") continue;
      expect(copy.seedCalendarTokens?.[key]).toBe(
        BASE_CALENDAR_TOKENS.dark[key],
      );
    }
  });

  it("clones seedEventPalette so later mutations do not leak", () => {
    const source = makeTheme();
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.seedEventPalette).toEqual(copy.eventPalette);
    expect(copy.seedEventPalette).not.toBe(copy.eventPalette);
  });

  it("snapshots seedSources matching the clone's sources", () => {
    const source = makeTheme({ base: "light" });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.seedSources).toEqual(copy.sources);
    expect(copy.seedSources).not.toBe(copy.sources);
  });

  it("snapshots seedBlendCanvas from the source blendCanvas", () => {
    const source = makeTheme({ blendCanvas: "#fafafa" });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.seedBlendCanvas).toBe("#fafafa");
  });

  it("snapshots seedAppTokenOverrides when the source carries app overrides", () => {
    const source = makeTheme({
      appTokenOverrides: { "--primary": "#abc123" },
    });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.seedAppTokenOverrides?.["--primary"]).toBe("#abc123");
    expect(copy.seedAppTokenOverrides).not.toBe(copy.appTokenOverrides);
  });

  it("snapshots seedCalendarTokenOverrides when the source carries calendar overrides", () => {
    const source = makeTheme({
      calendarTokenOverrides: { "--cal-bg": "#202020" },
    });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.seedCalendarTokenOverrides?.["--cal-bg"]).toBe("#202020");
    expect(copy.seedCalendarTokenOverrides).not.toBe(
      copy.calendarTokenOverrides,
    );
  });

  it("leaves override seeds undefined when the source has sources and no overrides", () => {
    const source = makeTheme({
      sources: {
        canvas: "#111111",
        ink: "#eeeeee",
        primary: "#00aaff",
        destructive: "#ff0033",
        confirm: "#00cc88",
        warning: "#f5a524",
      },
    });
    const copy = cloneTheme(source, "fork", "Fork");
    expect(copy.seedAppTokenOverrides).toBeUndefined();
    expect(copy.seedCalendarTokenOverrides).toBeUndefined();
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

describe("synthesizeSeedsIfMissing", () => {
  it("returns the theme unchanged when seedSources already exist", () => {
    const existing: Theme = makeTheme({
      sources: {
        canvas: "#111111",
        ink: "#eeeeee",
        primary: "#00aaff",
        destructive: "#ff0033",
        confirm: "#00cc88",
        warning: "#f5a524",
      },
      seedSources: {
        canvas: "#222222",
        ink: "#dddddd",
        primary: "#0099ee",
        destructive: "#ee0022",
        confirm: "#00bb77",
        warning: "#e49413",
      },
    });
    const result = synthesizeSeedsIfMissing(existing);
    expect(result).toBe(existing);
  });

  it("synthesizes seeds for a sources-less legacy theme from resolved tokens", () => {
    const legacy = makeTheme({ base: "light" });
    const result = synthesizeSeedsIfMissing(legacy);
    expect(result).not.toBe(legacy);
    expect(result.seedSources).toEqual({
      canvas: BASE_APP_TOKENS.light["--background"],
      ink: BASE_APP_TOKENS.light["--foreground"],
      primary: BASE_APP_TOKENS.light["--primary"],
      destructive: BASE_APP_TOKENS.light["--destructive"],
      confirm: BASE_APP_TOKENS.light["--action-confirm"],
      warning: BASE_APP_TOKENS.light["--status-tentative"],
    });
  });

  it("copies sources into seedSources when the theme has sources but no seeds", () => {
    const src = {
      canvas: "#111111",
      ink: "#eeeeee",
      primary: "#00aaff",
      destructive: "#ff0033",
      confirm: "#00cc88",
      warning: "#f5a524",
    };
    const legacy = makeTheme({ sources: src });
    const result = synthesizeSeedsIfMissing(legacy);
    expect(result.seedSources).toEqual(src);
    expect(result.seedSources).not.toBe(legacy.sources);
  });

  it("snapshots the eventPalette and blendCanvas as seeds", () => {
    const legacy = makeTheme({ blendCanvas: "#abcdef" });
    const result = synthesizeSeedsIfMissing(legacy);
    expect(result.seedEventPalette).toEqual(legacy.eventPalette);
    expect(result.seedEventPalette).not.toBe(legacy.eventPalette);
    expect(result.seedBlendCanvas).toBe("#abcdef");
  });

  it("seeds app and calendar token snapshots from the resolved palette", () => {
    const legacy = makeTheme({
      base: "dark",
      appTokenOverrides: { "--primary": "#abc123" },
      calendarTokenOverrides: { "--cal-bg": "#202020" },
    });
    const result = synthesizeSeedsIfMissing(legacy);
    expect(result.seedAppTokens?.["--primary"]).toBe("#abc123");
    expect(result.seedCalendarTokens?.["--cal-bg"]).toBe("#202020");
    for (const key of APP_TOKEN_KEYS) {
      if (key === "--primary") continue;
      expect(result.seedAppTokens?.[key]).toBe(BASE_APP_TOKENS.dark[key]);
    }
    for (const key of CALENDAR_TOKEN_KEYS) {
      if (key === "--cal-bg") continue;
      expect(result.seedCalendarTokens?.[key]).toBe(
        BASE_CALENDAR_TOKENS.dark[key],
      );
    }
  });

  it("captures seedAppTokenOverrides when the theme has pinned tokens", () => {
    const legacy = makeTheme({
      appTokenOverrides: { "--primary": "#abc123" },
    });
    const result = synthesizeSeedsIfMissing(legacy);
    expect(result.seedAppTokenOverrides).toEqual({ "--primary": "#abc123" });
    expect(result.seedAppTokenOverrides).not.toBe(legacy.appTokenOverrides);
  });

  it("leaves seed override maps undefined when the theme has none", () => {
    const legacy = makeTheme();
    const result = synthesizeSeedsIfMissing(legacy);
    expect(result.seedAppTokenOverrides).toBeUndefined();
    expect(result.seedCalendarTokenOverrides).toBeUndefined();
  });

  it("is idempotent: running twice returns an equal seeded theme", () => {
    const legacy = makeTheme({ base: "light" });
    const first = synthesizeSeedsIfMissing(legacy);
    const second = synthesizeSeedsIfMissing(first);
    expect(second).toBe(first);
    expect(second.seedSources).toEqual(first.seedSources);
  });
});
