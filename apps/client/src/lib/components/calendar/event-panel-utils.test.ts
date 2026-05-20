import { describe, expect, it } from "vitest";
import {
  commitTimeDraft,
  moveRovingIndex,
  normalizeTimeDraft,
  restoreTimeDraft,
} from "./event-panel-utils";

describe("normalizeTimeDraft", () => {
  it("normalizes shorthand hours and compact minutes", () => {
    expect(normalizeTimeDraft("9")).toBe("09:00");
    expect(normalizeTimeDraft("09")).toBe("09:00");
    expect(normalizeTimeDraft("930")).toBe("09:30");
    expect(normalizeTimeDraft("0930")).toBe("09:30");
    expect(normalizeTimeDraft("9:30")).toBe("09:30");
    expect(normalizeTimeDraft("2359")).toBe("23:59");
  });

  it("rejects empty, partial, impossible, and nonnumeric drafts", () => {
    expect(normalizeTimeDraft("")).toBeNull();
    expect(normalizeTimeDraft("9:3")).toBeNull();
    expect(normalizeTimeDraft("24:00")).toBeNull();
    expect(normalizeTimeDraft("2360")).toBeNull();
    expect(normalizeTimeDraft("nope")).toBeNull();
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
