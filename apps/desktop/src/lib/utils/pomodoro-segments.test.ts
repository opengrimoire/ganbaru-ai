import { describe, it, expect } from "vitest";
import { computePlannedSegments, segmentsToAccentBands } from "./pomodoro-segments";
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
