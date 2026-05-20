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
      "Toggle performance panel",
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
        "Toggle performance panel",
      ]),
    );
    expect(matchingActions("ctrl + p")).toEqual(
      expect.arrayContaining([
        "Show or hide playlist",
        "Toggle performance panel",
      ]),
    );
    expect(matchingActions("ctrl p")).not.toContain("Zoom in");
    expect(matchingActions("ctrl+ +")).not.toContain("Toggle performance panel");
    expect(matchingActions("ctrl+ +")).not.toContain("Open theme picker");
  });

  it("matches single keys wherever they appear in a shortcut", () => {
    expect(matchingActions("0")).toEqual(
      expect.arrayContaining([
        "Reset zoom",
        "Go to today",
        "Reset calendar timeline zoom",
        "Jump to 0% through 90%",
      ]),
    );
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
    expect(matchingActions("ctrl +")).toEqual(actions);
    expect(matchingActions("Ctrl + ")).toEqual(actions);
    expect(matchingActions("ctrl shift")).toEqual(
      expect.arrayContaining([
        "Toggle light/dark mode",
        "Open theme picker",
        "Toggle performance panel",
        "Previous view",
        "Close app",
      ]),
    );
    expect(matchingActions("ctrl + shift +")).toEqual(
      expect.arrayContaining([
        "Toggle light/dark mode",
        "Open theme picker",
        "Toggle performance panel",
        "Previous view",
        "Close app",
      ]),
    );
  });

  it("matches either side of slash-separated modifiers", () => {
    expect(matchingActions("ctrl enter")).toContain("Save event");
    expect(matchingActions("cmd enter")).toContain("Save event");
    expect(matchingActions("option left")).toContain("Back in calendar history");
  });

  it("matches arrow shortcuts by arrow name or direction", () => {
    expect(matchingActions("arrow right")).toEqual(
      expect.arrayContaining([
        "Next date range",
        "Forward in calendar history",
        "Seek backward or forward",
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
    expect(normalizedShortcutVariants("Ctrl/Cmd + Enter")).toEqual(
      expect.arrayContaining(["ctrlcmdenter", "ctrlenter", "cmdenter"]),
    );
  });
});
