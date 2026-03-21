import { describe, it, expect } from "vitest";
import { computePlannedSegments, segmentsToAccentBands, computeTrailingFocusMinutes, computeTrailingCycleNumber } from "./pomodoro-segments";
import type { PomodoroConfig } from "$lib/components/calendar/types";

const DEFAULT_CONFIG: PomodoroConfig = {
  focusDurationMinutes: 40,
  shortBreakMinutes: 5,
  longBreakMinutes: 10,
  pomodoroCount: 4,
};

describe("computePlannedSegments", () => {
  it("returns empty for zero or negative duration", () => {
    expect(computePlannedSegments(DEFAULT_CONFIG, 0)).toEqual([]);
    expect(computePlannedSegments(DEFAULT_CONFIG, -10)).toEqual([]);
  });

  it("handles single focus period that fits exactly", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 40);
    expect(segments).toEqual([
      { cycleNumber: 1, phase: "focus", startOffsetMinutes: 0, endOffsetMinutes: 40 },
    ]);
  });

  it("clips focus period when event is shorter than one focus", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 25);
    expect(segments).toEqual([
      { cycleNumber: 1, phase: "focus", startOffsetMinutes: 0, endOffsetMinutes: 25 },
    ]);
  });

  it("produces focus + short break + next focus for sufficient duration", () => {
    // 90 min: focus 0-40, break 40-45, focus 45-85, clipped focus 85-90
    const segments = computePlannedSegments(DEFAULT_CONFIG, 90);
    expect(segments).toHaveLength(4);
    expect(segments[0]).toEqual({ cycleNumber: 1, phase: "focus", startOffsetMinutes: 0, endOffsetMinutes: 40 });
    expect(segments[1]).toEqual({ cycleNumber: 1, phase: "short_break", startOffsetMinutes: 40, endOffsetMinutes: 45 });
    expect(segments[2]).toEqual({ cycleNumber: 2, phase: "focus", startOffsetMinutes: 45, endOffsetMinutes: 85 });
    expect(segments[3]).toEqual({ cycleNumber: 2, phase: "short_break", startOffsetMinutes: 85, endOffsetMinutes: 90 });
  });

  it("clips break when event ends mid-break", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 43);
    expect(segments).toHaveLength(2);
    expect(segments[1]).toEqual({ cycleNumber: 1, phase: "short_break", startOffsetMinutes: 40, endOffsetMinutes: 43 });
  });

  it("produces long break after pomodoroCount cycles", () => {
    // 4 focus (40) + 3 short breaks (5) + 1 long break (10) = 185 min
    const segments = computePlannedSegments(DEFAULT_CONFIG, 185);
    const breaks = segments.filter((s) => s.phase !== "focus");
    expect(breaks).toHaveLength(4);
    expect(breaks[0].phase).toBe("short_break");
    expect(breaks[1].phase).toBe("short_break");
    expect(breaks[2].phase).toBe("short_break");
    expect(breaks[3].phase).toBe("long_break");
  });

  it("resets cycle count after long break", () => {
    // Enough for full cycle + start of next
    const segments = computePlannedSegments(DEFAULT_CONFIG, 230);
    const focusAfterLong = segments.find(
      (s) => s.phase === "focus" && s.startOffsetMinutes >= 185,
    );
    expect(focusAfterLong).toBeDefined();
    expect(focusAfterLong!.cycleNumber).toBe(1);
  });

  it("handles pomodoroCount = 1 (every break is long)", () => {
    const config: PomodoroConfig = { ...DEFAULT_CONFIG, pomodoroCount: 1 };
    const segments = computePlannedSegments(config, 100);
    const breaks = segments.filter((s) => s.phase !== "focus");
    for (const b of breaks) {
      expect(b.phase).toBe("long_break");
    }
  });

  it("handles exact fit for full cycle", () => {
    // 4*40 + 3*5 + 1*10 = 185
    const segments = computePlannedSegments(DEFAULT_CONFIG, 185);
    const last = segments[segments.length - 1];
    expect(last.endOffsetMinutes).toBe(185);
  });

  it("shortens first focus with initialFocusOffset", () => {
    // 30 min inherited: first focus is 10 min (40 - 30), then break
    const segments = computePlannedSegments(DEFAULT_CONFIG, 60, 30);
    expect(segments[0]).toEqual({ cycleNumber: 1, phase: "focus", startOffsetMinutes: 0, endOffsetMinutes: 10 });
    expect(segments[1]).toEqual({ cycleNumber: 1, phase: "short_break", startOffsetMinutes: 10, endOffsetMinutes: 15 });
    expect(segments[2]).toEqual({ cycleNumber: 2, phase: "focus", startOffsetMinutes: 15, endOffsetMinutes: 55 });
  });

  it("starts with break when inherited focus exceeds threshold", () => {
    // 45 min inherited (>= 40 focus): starts with break immediately
    const segments = computePlannedSegments(DEFAULT_CONFIG, 60, 45);
    expect(segments[0].phase).toBe("short_break");
    expect(segments[0].startOffsetMinutes).toBe(0);
    expect(segments[0].endOffsetMinutes).toBe(5);
    expect(segments[1].phase).toBe("focus");
    expect(segments[1].startOffsetMinutes).toBe(5);
  });

  it("starts with break when inherited focus equals threshold exactly", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 50, 40);
    expect(segments[0].phase).toBe("short_break");
    expect(segments[1].phase).toBe("focus");
  });

  it("inherits correctly with zero offset (no change)", () => {
    const withoutOffset = computePlannedSegments(DEFAULT_CONFIG, 90);
    const withZeroOffset = computePlannedSegments(DEFAULT_CONFIG, 90, 0);
    expect(withZeroOffset).toEqual(withoutOffset);
  });

  it("clips inherited shortened focus to event duration", () => {
    // 30 min inherited, but event is only 5 min long
    const segments = computePlannedSegments(DEFAULT_CONFIG, 5, 30);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ cycleNumber: 1, phase: "focus", startOffsetMinutes: 0, endOffsetMinutes: 5 });
  });

  it("clips inherited break to event duration", () => {
    // 40 min inherited: starts with break, but event is only 3 min
    const segments = computePlannedSegments(DEFAULT_CONFIG, 3, 40);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ cycleNumber: 1, phase: "short_break", startOffsetMinutes: 0, endOffsetMinutes: 3 });
  });

  it("starts at inherited cycle number", () => {
    // Start at cycle 3 (pomodoroCount=4): first break should be short, second should trigger long
    const segments = computePlannedSegments(DEFAULT_CONFIG, 185, 0, 3);
    const breaks = segments.filter((s) => s.phase !== "focus");
    // Cycle 3: short break, cycle 4: long break, then reset
    expect(breaks[0].phase).toBe("short_break");
    expect(breaks[0].cycleNumber).toBe(3);
    expect(breaks[1].phase).toBe("long_break");
    expect(breaks[1].cycleNumber).toBe(4);
  });

  it("triggers long break immediately when inherited cycle equals pomodoroCount", () => {
    // Start at cycle 4 (pomodoroCount=4): first break is long
    const segments = computePlannedSegments(DEFAULT_CONFIG, 100, 0, 4);
    const breaks = segments.filter((s) => s.phase !== "focus");
    expect(breaks[0].phase).toBe("long_break");
    expect(breaks[0].cycleNumber).toBe(4);
    // After long break, cycle resets: next break should be short at cycle 1
    if (breaks.length > 1) {
      expect(breaks[1].phase).toBe("short_break");
      expect(breaks[1].cycleNumber).toBe(1);
    }
  });

  it("triggers long break when inherited cycle exceeds pomodoroCount", () => {
    // Start at cycle 5 (pomodoroCount=4): cycle 5 >= 4 so first break is long
    const segments = computePlannedSegments(DEFAULT_CONFIG, 100, 0, 5);
    const breaks = segments.filter((s) => s.phase !== "focus");
    expect(breaks[0].phase).toBe("long_break");
  });

  it("combines focus offset and cycle inheritance", () => {
    // 30 min focus inherited, cycle 3: shortened focus, then short break (cycle 3 < 4)
    const segments = computePlannedSegments(DEFAULT_CONFIG, 120, 30, 3);
    expect(segments[0]).toEqual({ cycleNumber: 3, phase: "focus", startOffsetMinutes: 0, endOffsetMinutes: 10 });
    expect(segments[1].phase).toBe("short_break");
    expect(segments[1].cycleNumber).toBe(3);
    // Next focus at cycle 4, its break should be long
    const cycle4Break = segments.find((s) => s.cycleNumber === 4 && s.phase !== "focus");
    expect(cycle4Break).toBeDefined();
    expect(cycle4Break!.phase).toBe("long_break");
  });

  it("inherited break at high cycle uses long break", () => {
    // 40 min focus inherited + cycle 4 (pomodoroCount=4): starts with long break
    const segments = computePlannedSegments(DEFAULT_CONFIG, 60, 40, 4);
    expect(segments[0].phase).toBe("long_break");
    expect(segments[0].endOffsetMinutes).toBe(10); // long break = 10 min
    // After long break, reset to cycle 1
    expect(segments[1].phase).toBe("focus");
    expect(segments[1].cycleNumber).toBe(1);
  });

  it("cross-block scenario: Block A trailing cycle carries to Block B", () => {
    // Block A: 80 min, pomodoroCount=4
    // Cycle 1: focus 0-40, short_break 40-45, cycle 2: focus 45-80 (clipped)
    const blockA = computePlannedSegments(DEFAULT_CONFIG, 80);
    expect(computeTrailingFocusMinutes(blockA)).toBe(35); // 80-45=35 min focus
    expect(computeTrailingCycleNumber(blockA)).toBe(2);

    // Block B: 220 min, inherits 35 min focus + cycle 2
    const blockB = computePlannedSegments(DEFAULT_CONFIG, 220, 35, 2);
    // First focus shortened to 5 min (40-35), then short break (cycle 2 < 4)
    expect(blockB[0]).toEqual({ cycleNumber: 2, phase: "focus", startOffsetMinutes: 0, endOffsetMinutes: 5 });
    expect(blockB[1].phase).toBe("short_break");
    // Count breaks before the first long break
    let shortBreaksBeforeLong = 0;
    for (const s of blockB) {
      if (s.phase === "short_break") shortBreaksBeforeLong++;
      if (s.phase === "long_break") break;
    }
    // Block A had 1 short break, Block B should have 2 more before long break (total 3 short + 1 long = 4 cycles)
    expect(shortBreaksBeforeLong).toBe(2);
  });

  it("defaults to cycle 1 with zero or negative initialCycleNumber", () => {
    const withZero = computePlannedSegments(DEFAULT_CONFIG, 90, 0, 0);
    const withDefault = computePlannedSegments(DEFAULT_CONFIG, 90);
    expect(withZero).toEqual(withDefault);
  });
});

describe("computeTrailingFocusMinutes", () => {
  it("returns 0 for empty segments", () => {
    expect(computeTrailingFocusMinutes([])).toBe(0);
  });

  it("returns focus duration when last segment is focus", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 25);
    // Single clipped focus: 0-25
    expect(computeTrailingFocusMinutes(segments)).toBe(25);
  });

  it("returns 0 when last segment is a break", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 45);
    // focus 0-40, break 40-45
    expect(computeTrailingFocusMinutes(segments)).toBe(0);
  });

  it("returns trailing focus after a break", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 70);
    // focus 0-40, break 40-45, focus 45-70 (25 min)
    const last = segments[segments.length - 1];
    expect(last.phase).toBe("focus");
    expect(computeTrailingFocusMinutes(segments)).toBe(25);
  });
});

describe("computeTrailingCycleNumber", () => {
  it("returns 1 for empty segments", () => {
    expect(computeTrailingCycleNumber([])).toBe(1);
  });

  it("returns cycle number when last segment is focus", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 25);
    // Single focus at cycle 1
    expect(computeTrailingCycleNumber(segments)).toBe(1);
  });

  it("returns cycle + 1 when last segment is short break", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 45);
    // focus 0-40, short_break 40-45 at cycle 1
    expect(computeTrailingCycleNumber(segments)).toBe(2);
  });

  it("returns 1 when last segment is long break", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 185);
    // Full cycle: 4 focus + 3 short + 1 long
    const last = segments[segments.length - 1];
    expect(last.phase).toBe("long_break");
    expect(computeTrailingCycleNumber(segments)).toBe(1);
  });

  it("returns correct cycle for mid-focus at cycle 2", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 70);
    // focus 0-40, short_break 40-45, focus 45-70 (cycle 2)
    expect(computeTrailingCycleNumber(segments)).toBe(2);
  });

  it("returns correct cycle after multiple short breaks", () => {
    // 3 full cycles: 3*40 + 3*5 = 135 min, ending with short_break at cycle 3
    const segments = computePlannedSegments(DEFAULT_CONFIG, 135);
    const last = segments[segments.length - 1];
    expect(last.phase).toBe("short_break");
    expect(last.cycleNumber).toBe(3);
    expect(computeTrailingCycleNumber(segments)).toBe(4);
  });
});

describe("segmentsToAccentBands", () => {
  it("returns empty for no segments", () => {
    expect(segmentsToAccentBands([], 100)).toEqual([]);
  });

  it("returns empty for zero duration", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 40);
    expect(segmentsToAccentBands(segments, 0)).toEqual([]);
  });

  it("filters out focus segments, keeps only breaks", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 90);
    const bands = segmentsToAccentBands(segments, 90);
    expect(bands).toHaveLength(2);
    expect(bands[0].phase).toBe("short_break");
    expect(bands[1].phase).toBe("short_break");
  });

  it("computes correct fractions", () => {
    // 90 min event: focus 0-40, break 40-45, focus 45-85
    const segments = computePlannedSegments(DEFAULT_CONFIG, 90);
    const bands = segmentsToAccentBands(segments, 90);
    expect(bands[0].topFraction).toBeCloseTo(40 / 90);
    expect(bands[0].heightFraction).toBeCloseTo(5 / 90);
  });

  it("assigns the given status to all bands", () => {
    const segments = computePlannedSegments(DEFAULT_CONFIG, 90);
    const bands = segmentsToAccentBands(segments, 90, "completed");
    for (const b of bands) {
      expect(b.status).toBe("completed");
    }
  });
});
