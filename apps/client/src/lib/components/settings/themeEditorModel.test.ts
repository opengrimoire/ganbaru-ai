import { describe, expect, it } from "vitest";
import {
  CALENDAR_GROUPS,
  SOURCE_GROUPS,
  TEXT_ACTION_GROUPS,
  THEME_NAV_ITEMS,
  isCalendarGroup,
  isTextActionGroup,
  tokenInfo,
  type SourceGroup,
  type SourceGroupId,
  type ThemeNavTarget,
} from "./themeEditorModel";

function groupIds(groups: readonly SourceGroup[]): SourceGroupId[] {
  return groups.map((group) => group.id);
}

describe("theme editor model", () => {
  it("uses stable unique ids for editable groups", () => {
    const ids = groupIds(SOURCE_GROUPS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps section partitions keyed by stable ids", () => {
    expect(groupIds(CALENDAR_GROUPS)).toEqual([
      "calendar-surface",
      "calendar-details",
      "event-panel",
    ]);
    expect(groupIds(TEXT_ACTION_GROUPS)).toEqual([
      "ink",
      "primary-action",
      "destructive",
      "confirm",
      "warning",
    ]);

    for (const group of CALENDAR_GROUPS) {
      expect(isCalendarGroup(group)).toBe(true);
      expect(isTextActionGroup(group)).toBe(false);
    }
    for (const group of TEXT_ACTION_GROUPS) {
      expect(isTextActionGroup(group)).toBe(true);
      expect(isCalendarGroup(group)).toBe(false);
    }
  });

  it("keeps navigation targets backed by model entry points", () => {
    const navTargets = new Set<ThemeNavTarget>(
      THEME_NAV_ITEMS.map((item) => item.target),
    );
    expect(navTargets).toEqual(
      new Set<ThemeNavTarget>([
        "general",
        "calendar",
        "signals",
        "json",
      ]),
    );

    const groupTargets = new Set(
      SOURCE_GROUPS.flatMap((group) =>
        group.navTarget === undefined ? [] : [group.navTarget],
      ),
    );
    expect(groupTargets.has("general")).toBe(true);
    expect(groupTargets.has("signals")).toBe(true);
    expect(CALENDAR_GROUPS.length).toBeGreaterThan(0);
  });

  it("provides visible labels and descriptions for every row", () => {
    for (const group of SOURCE_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.description.length).toBeGreaterThan(0);

      for (const row of group.rows) {
        if (row.kind === "single") {
          const info = tokenInfo(row);
          expect(info.title.length).toBeGreaterThan(0);
          expect(info.description.length).toBeGreaterThan(0);
        } else {
          expect(row.title.length).toBeGreaterThan(0);
          expect(row.description.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
