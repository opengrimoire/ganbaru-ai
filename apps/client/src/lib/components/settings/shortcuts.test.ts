import { describe, expect, it } from "vitest";
import {
  SHORTCUT_GROUPS,
  filterShortcutGroups,
  normalizedShortcutQueryCandidates,
  normalizedShortcutVariants,
} from "./shortcuts";

function matchingActions(query: string): string[] {
  return filterShortcutGroups(SHORTCUT_GROUPS, query).flatMap((group) =>
    group.items.map((item) => item.action),
  );
}

describe("shortcut search", () => {
  it("keeps all groups for an empty query", () => {
    expect(filterShortcutGroups(SHORTCUT_GROUPS, "")).toHaveLength(
      SHORTCUT_GROUPS.length,
    );
    expect(filterShortcutGroups(SHORTCUT_GROUPS, "   ")).toHaveLength(
      SHORTCUT_GROUPS.length,
    );
  });

  it("returns no matches for non-searchable input", () => {
    expect(matchingActions("=")).toEqual([]);
  });

  it("orders general shortcuts by navigation, opening, zooming, then other actions", () => {
    expect(SHORTCUT_GROUPS[0]?.title).toBe("General");
    expect(SHORTCUT_GROUPS[0]?.items.map((item) => item.action)).toEqual([
      "Next view",
      "Previous view",
      "Open calendar",
      "Open to-do",
      "Open music",
      "Open or close settings",
      "Zoom in",
      "Zoom out",
      "Reset zoom",
      "Toggle light/dark mode",
      "Open theme picker",
      "Toggle diagnostics panel",
      "Close app",
      "Open shortcuts",
    ]);
  });

  it("matches action text with or without spaces", () => {
    expect(matchingActions("theme picker")).toContain("Open theme picker");
    expect(matchingActions("themepicker")).toContain("Open theme picker");
  });

  it("does not treat plain action text as a keyboard alias", () => {
    const openActions = matchingActions("op");
    expect(openActions).toEqual(
      expect.arrayContaining([
        "Open calendar",
        "Open to-do",
        "Open music",
        "Open shortcuts",
        "Open theme picker",
      ]),
    );
    expect(openActions).not.toContain("Back in calendar history");
    expect(openActions).not.toContain("Forward in calendar history");
  });

  it("matches shortcut combinations written with spaces or plus signs", () => {
    expect(matchingActions("ctrl shift t")).toContain("Open theme picker");
    expect(matchingActions("ctrl+shift+t")).toContain("Open theme picker");
    expect(matchingActions("ctrlshiftt")).toEqual([]);
  });

  it("matches shortcut combinations while the user is still typing", () => {
    const ctrlActions = matchingActions("ctrl");
    expect(matchingActions("C")).toEqual(ctrlActions);
    expect(matchingActions("Ctr")).toEqual(ctrlActions);
    expect(matchingActions("Control")).toEqual(ctrlActions);

    const ctrlShiftActions = expect.arrayContaining([
      "Toggle light/dark mode",
      "Open theme picker",
      "Toggle diagnostics panel",
      "Previous view",
      "Close app",
    ]);
    expect(matchingActions("ctrl sh")).toEqual(ctrlShiftActions);
    expect(matchingActions("ctrl + sh")).toEqual(ctrlShiftActions);
    expect(matchingActions("ctrl s")).toEqual(ctrlShiftActions);
    expect(matchingActions("Ctrl + S")).toEqual(ctrlShiftActions);
    expect(matchingActions("Ctrl L")).toEqual(
      expect.arrayContaining([
        "Show or hide playlist",
        "Toggle light/dark mode",
      ]),
    );
  });

  it("understands symbol keys when searching combinations", () => {
    expect(matchingActions("ctrl plus")).toContain("Zoom in");
    expect(matchingActions("ctrl++")).toContain("Zoom in");
    expect(matchingActions("ctrl+ +")).toEqual(["Zoom in"]);
    expect(matchingActions("ctrl minus")).toContain("Zoom out");
    expect(matchingActions("ctrl ,")).toContain("Open or close settings");
    expect(matchingActions("ctrl comma")).toContain("Open or close settings");
  });

  it("matches typed keys in order without confusing letters for symbols", () => {
    expect(matchingActions("ctrl p")).toEqual(
      expect.arrayContaining([
        "Show or hide playlist",
      ]),
    );
    expect(matchingActions("ctrl + p")).toEqual(
      expect.arrayContaining([
        "Show or hide playlist",
      ]),
    );
    expect(matchingActions("ctrl d")).toEqual(
      expect.arrayContaining([
        "Toggle diagnostics panel",
        "Delete event",
      ]),
    );
    expect(matchingActions("ctrl + shift + d")).toContain("Toggle diagnostics panel");
    expect(matchingActions("ctrl p")).not.toContain("Zoom in");
    expect(matchingActions("ctrl+ +")).not.toContain("Toggle diagnostics panel");
    expect(matchingActions("ctrl+ +")).not.toContain("Open theme picker");
  });

  it("matches single keys wherever they appear in a shortcut", () => {
    expect(matchingActions("0")).toEqual(
      expect.arrayContaining([
        "Reset zoom",
        "Go to today",
        "Reset calendar timeline zoom",
        "Jump to playback position",
      ]),
    );
  });

  it("lists both shuffle shortcut keys", () => {
    const musicItems = SHORTCUT_GROUPS.find((group) => group.title === "Music")?.items ?? [];

    expect(musicItems.find((item) => item.action === "Toggle shuffle")?.keys).toEqual([
      "S",
      "R",
    ]);
    expect(matchingActions("r")).toContain("Toggle shuffle");
  });

  it("uses contiguous number shortcuts for calendar views", () => {
    const calendarItems = SHORTCUT_GROUPS.find((group) => group.title === "Calendar")?.items ?? [];
    expect(calendarItems.slice(0, 4).map((item) => item.keys)).toEqual([
      ["0", "T"],
      ["1", "D"],
      ["2", "W"],
      ["3", "M"],
    ]);
    expect(matchingActions("1")).toContain("Day view");
    expect(matchingActions("2")).toContain("Week view");
    expect(matchingActions("3")).toContain("Month view");
    expect(matchingActions("7")).not.toContain("Week view");
    expect(matchingActions("9")).not.toContain("Month view");
  });

  it("keeps event editor shortcuts at the end of calendar shortcuts", () => {
    const calendarItems = SHORTCUT_GROUPS.find((group) => group.title === "Calendar")?.items ?? [];

    expect(SHORTCUT_GROUPS.some((group) => group.title === "Event editor")).toBe(false);
    expect(calendarItems.slice(-2)).toEqual([
      { keys: ["Mod + Enter"], action: "Save event" },
      { keys: ["Mod + D"], action: "Delete event" },
    ]);
  });

  it("does not list calendar edit undo or redo shortcuts", () => {
    expect(matchingActions("undo calendar")).toEqual([]);
    expect(matchingActions("redo calendar")).toEqual([]);
    expect(matchingActions("ctrl z")).not.toContain("Undo calendar edit");
    expect(matchingActions("ctrl y")).not.toContain("Redo calendar edit");
  });

  it("allows modifier prefix searches to show matching shortcuts", () => {
    const actions = matchingActions("ctrl");
    expect(actions).toContain("Zoom in");
    expect(actions).toContain("Open theme picker");
    expect(actions).toContain("Show or hide playlist");
    expect(actions).not.toContain("Go to today");

    expect(matchingActions("Ctrl")).toEqual(actions);
    expect(matchingActions("Ctrl ")).toEqual(actions);
    expect(matchingActions("Control")).toEqual(actions);
    expect(matchingActions("Cmd")).toEqual(actions);
    expect(matchingActions("Command")).toEqual(actions);
    expect(matchingActions("ctrl +")).toEqual(actions);
    expect(matchingActions("Ctrl + ")).toEqual(actions);
    expect(matchingActions("ctrl shift")).toEqual(
      expect.arrayContaining([
        "Toggle light/dark mode",
        "Open theme picker",
        "Toggle diagnostics panel",
        "Previous view",
      ]),
    );
    expect(matchingActions("ctrl + shift +")).toEqual(
      expect.arrayContaining([
        "Toggle light/dark mode",
        "Open theme picker",
        "Toggle diagnostics panel",
        "Previous view",
      ]),
    );
  });

  it("matches either side of slash-separated modifiers", () => {
    expect(matchingActions("ctrl enter")).toContain("Save event");
    expect(matchingActions("cmd enter")).toContain("Save event");
    expect(matchingActions("option left")).toEqual([]);
  });

  it("matches arrow shortcuts by arrow name or direction", () => {
    expect(matchingActions("arrow right")).toEqual(
      expect.arrayContaining([
        "Previous or next date range",
        "Jump 10 seconds",
        "Next track",
      ]),
    );
    expect(matchingActions("shift right")).toContain("Next track");
  });

  it("normalizes query candidates without duplicate empty values", () => {
    expect(normalizedShortcutQueryCandidates(" ctrl + shift + t ")).toEqual([
      "ctrlshiftt",
    ]);
  });

  it("creates searchable variants for shortcut alternatives", () => {
    expect(normalizedShortcutVariants("Mod + Enter")).toEqual(
      expect.arrayContaining(["ctrlenter", "cmdenter"]),
    );
  });
});
