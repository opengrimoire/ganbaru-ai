import { describe, expect, it } from "vitest";
import {
  commitTimeDraft,
  displayTimeDraft,
  moveRovingIndex,
  normalizeTimeDraft,
  restoreTimeDraft,
  sanitizeTimeDraftInput,
} from "./event-panel-utils";

describe("normalizeTimeDraft", () => {
  it("normalizes shorthand hours and compact minutes", () => {
    expect(normalizeTimeDraft("9")).toBe("09:00");
    expect(normalizeTimeDraft("09")).toBe("09:00");
    expect(normalizeTimeDraft("930")).toBe("09:30");
    expect(normalizeTimeDraft("0930")).toBe("09:30");
    expect(normalizeTimeDraft("93")).toBe("09:30");
    expect(normalizeTimeDraft("9:30")).toBe("09:30");
    expect(normalizeTimeDraft("9:3")).toBe("09:30");
    expect(normalizeTimeDraft("2359")).toBe("23:59");
  });

  it("rejects empty, partial, impossible, and nonnumeric drafts", () => {
    expect(normalizeTimeDraft("")).toBeNull();
    expect(normalizeTimeDraft("12:")).toBeNull();
    expect(normalizeTimeDraft("24:00")).toBeNull();
    expect(normalizeTimeDraft("2360")).toBeNull();
    expect(normalizeTimeDraft("nope")).toBeNull();
  });
});

describe("sanitizeTimeDraftInput", () => {
  it("keeps only digits and one colon", () => {
    expect(sanitizeTimeDraftInput("1a2b:3c4")).toBe("12:34");
    expect(sanitizeTimeDraftInput("a9-3p0")).toBe("930");
    expect(sanitizeTimeDraftInput("1::2")).toBe("1:2");
  });
});

describe("displayTimeDraft", () => {
  it("adds the visual colon as soon as the typed prefix identifies the split", () => {
    expect(displayTimeDraft("12")).toBe("12");
    expect(displayTimeDraft("93")).toBe("9:3");
    expect(displayTimeDraft("25")).toBe("2:5");
    expect(displayTimeDraft("26")).toBe("02:06");
    expect(displayTimeDraft("125")).toBe("12:5");
    expect(displayTimeDraft("126")).toBe("1:26");
    expect(displayTimeDraft("236")).toBe("2:36");
    expect(displayTimeDraft("1200")).toBe("12:00");
    expect(displayTimeDraft("2359")).toBe("23:59");
  });

  it("treats compact pasted values as complete when possible", () => {
    expect(displayTimeDraft("930")).toBe("9:30");
    expect(displayTimeDraft("930", true)).toBe("9:30");
    expect(displayTimeDraft("125", true)).toBe("1:25");
    expect(displayTimeDraft("12")).toBe("12");
  });

  it("preserves explicitly typed colon drafts", () => {
    expect(displayTimeDraft("9:30")).toBe("9:30");
    expect(displayTimeDraft("12:")).toBe("12:");
  });

  it("ignores non-time characters before formatting", () => {
    expect(displayTimeDraft("9p3")).toBe("9:3");
    expect(displayTimeDraft("1a2b:3c4")).toBe("12:34");
    expect(displayTimeDraft("abc")).toBe("");
  });
});

describe("commitTimeDraft", () => {
  it("commits valid drafts and keeps invalid drafts from mutating time", () => {
    expect(commitTimeDraft("930", "08:00")).toEqual({ value: "09:30", committed: true });
    expect(commitTimeDraft("24:00", "08:00")).toEqual({ value: "08:00", committed: false });
  });

  it("restores the canonical value when editing is cancelled", () => {
    expect(restoreTimeDraft("14:30")).toBe("14:30");
  });
});

describe("moveRovingIndex", () => {
  it("moves through horizontal lists and respects boundaries", () => {
    expect(moveRovingIndex({ currentIndex: 0, itemCount: 3, key: "ArrowLeft", orientation: "horizontal" })).toBe(0);
    expect(moveRovingIndex({ currentIndex: 0, itemCount: 3, key: "ArrowRight", orientation: "horizontal" })).toBe(1);
    expect(moveRovingIndex({ currentIndex: 2, itemCount: 3, key: "ArrowRight", orientation: "horizontal" })).toBe(2);
  });

  it("moves through vertical lists and handles Home and End", () => {
    expect(moveRovingIndex({ currentIndex: 1, itemCount: 4, key: "ArrowUp", orientation: "vertical" })).toBe(0);
    expect(moveRovingIndex({ currentIndex: 1, itemCount: 4, key: "ArrowDown", orientation: "vertical" })).toBe(2);
    expect(moveRovingIndex({ currentIndex: 1, itemCount: 4, key: "Home", orientation: "vertical" })).toBe(0);
    expect(moveRovingIndex({ currentIndex: 1, itemCount: 4, key: "End", orientation: "vertical" })).toBe(3);
  });

  it("moves through fixed-column grids", () => {
    expect(moveRovingIndex({ currentIndex: 0, itemCount: 8, key: "ArrowDown", orientation: "grid", columns: 4 })).toBe(4);
    expect(moveRovingIndex({ currentIndex: 5, itemCount: 8, key: "ArrowUp", orientation: "grid", columns: 4 })).toBe(1);
    expect(moveRovingIndex({ currentIndex: 7, itemCount: 8, key: "ArrowDown", orientation: "grid", columns: 4 })).toBe(7);
    expect(moveRovingIndex({ currentIndex: 0, itemCount: 8, key: "End", orientation: "grid", columns: 4 })).toBe(7);
  });
});
