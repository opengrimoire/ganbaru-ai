import { describe, it, expect } from "vitest";
import { findOrdinalWeekday, fmtYMD, parseYMD } from "./recurrence";

describe("parseYMD and fmtYMD", () => {
  it("round-trips a date string", () => {
    expect(fmtYMD(parseYMD("2026-03-15"))).toBe("2026-03-15");
  });

  it("handles year boundaries", () => {
    expect(fmtYMD(parseYMD("2026-01-01"))).toBe("2026-01-01");
    expect(fmtYMD(parseYMD("2025-12-31"))).toBe("2025-12-31");
  });
});

describe("findOrdinalWeekday", () => {
  // March 2026: Sun=1, Mon=2, Tue=3, ..., Sat=7
  // 1st day is Sunday

  it("finds 1st Tuesday of March 2026", () => {
    // March 3, 2026 is the 1st Tuesday
    expect(findOrdinalWeekday(2026, 2, 2, 1)).toBe(3);
  });

  it("finds 2nd Tuesday of March 2026", () => {
    expect(findOrdinalWeekday(2026, 2, 2, 2)).toBe(10);
  });

  it("finds 3rd Tuesday of March 2026", () => {
    expect(findOrdinalWeekday(2026, 2, 2, 3)).toBe(17);
  });

  it("finds last Friday of March 2026", () => {
    // March 27, 2026 is the last Friday
    expect(findOrdinalWeekday(2026, 2, 5, -1)).toBe(27);
  });

  it("finds last Monday of February 2026", () => {
    // Feb 2026 has 28 days, Feb 23 is last Monday
    expect(findOrdinalWeekday(2026, 1, 1, -1)).toBe(23);
  });

  it("returns null for 5th occurrence when only 4 exist", () => {
    // April 2026 has 4 Tuesdays (7, 14, 21, 28)
    expect(findOrdinalWeekday(2026, 3, 2, 5)).toBeNull();
  });

  it("returns null for ordinal 0", () => {
    expect(findOrdinalWeekday(2026, 2, 2, 0)).toBeNull();
  });

  it("finds 1st Sunday of March 2026", () => {
    expect(findOrdinalWeekday(2026, 2, 0, 1)).toBe(1);
  });
});
