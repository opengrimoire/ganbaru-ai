import { describe, expect, it } from "vitest";
import {
  formatCalendarScrollDiagnosticMarkdown,
  summarizeCalendarScrollSample,
  type CalendarScrollRawSample,
} from "./calendarScrollDiagnostic";

function sample(overrides: Partial<CalendarScrollRawSample> = {}): CalendarScrollRawSample {
  return {
    capturedAtIso: "2026-05-13T12:00:00.000Z",
    durationMs: 7_250,
    startScrollTopPx: 100,
    endScrollTopPx: 410,
    minScrollTopPx: 100,
    maxScrollTopPx: 430,
    viewportHeightPx: 600,
    scrollHeightPx: 2_400,
    devicePixelRatio: 1.25,
    userAgent: "vitest",
    frameIntervalsMs: [16.2, 16.8, 17.1, 34.2, 52],
    wheelDeltaY: [120, 60, -30],
    wheelDeltaModes: { pixel: 3, line: 0, page: 0, unknown: 0 },
    wheelEventCount: 3,
    wheelAtEdgeCount: 1,
    wheelIntoEdgeCount: 1,
    scrollDeltasPx: [110, 120, 100, -20],
    scrollEventCount: 4,
    ...overrides,
  };
}

describe("summarizeCalendarScrollSample", () => {
  it("summarizes frame timing, wheel events, and scroll distance", () => {
    const summary = summarizeCalendarScrollSample(sample());

    expect(summary.durationMs).toBe(7250);
    expect(summary.frames.count).toBe(5);
    expect(summary.frames.averageMs).toBe(27.3);
    expect(summary.frames.medianMs).toBe(17.1);
    expect(summary.frames.p95Ms).toBe(52);
    expect(summary.frames.maxMs).toBe(52);
    expect(summary.frames.over16Ms).toBe(4);
    expect(summary.frames.over25Ms).toBe(2);
    expect(summary.frames.over33Ms).toBe(2);
    expect(summary.frames.over50Ms).toBe(1);
    expect(summary.wheelEventCount).toBe(3);
    expect(summary.wheelSignedDeltaY).toBe(150);
    expect(summary.wheelTotalAbsDeltaY).toBe(210);
    expect(summary.wheelMaxAbsDeltaY).toBe(120);
    expect(summary.wheelDirectionChanges).toBe(1);
    expect(summary.wheelAtEdgeCount).toBe(1);
    expect(summary.wheelIntoEdgeCount).toBe(1);
    expect(summary.scrollEventCount).toBe(4);
    expect(summary.scrollDistancePx).toBe(350);
    expect(summary.netScrollPx).toBe(310);
    expect(summary.scrollDirectionChanges).toBe(1);
    expect(summary.scrollDistanceToRangeRatio).toBe(1.1);
    expect(summary.maxScrollStepPx).toBe(120);
    expect(summary.touchedScrollRangePx).toBe(330);
    expect(summary.endPosition).toBe("inside");
  });

  it("marks a sample that ends at the bottom of the scroll range", () => {
    const summary = summarizeCalendarScrollSample(sample({
      endScrollTopPx: 1_800,
      maxScrollTopPx: 1_800,
    }));

    expect(summary.scrollLimitPx).toBe(1800);
    expect(summary.endPosition).toBe("bottom");
  });

  it("handles an empty frame buffer without inventing timing values", () => {
    const summary = summarizeCalendarScrollSample(sample({ frameIntervalsMs: [] }));

    expect(summary.frames.count).toBe(0);
    expect(summary.frames.averageMs).toBeNull();
    expect(summary.frames.medianMs).toBeNull();
    expect(summary.frames.p95Ms).toBeNull();
    expect(summary.frames.maxMs).toBeNull();
    expect(summary.estimatedFps).toBeNull();
  });
});

describe("formatCalendarScrollDiagnosticMarkdown", () => {
  it("emits a copyable markdown table with the diagnostic metrics", () => {
    const markdown = formatCalendarScrollDiagnosticMarkdown(summarizeCalendarScrollSample(sample()));

    expect(markdown).toContain("# Calendar vertical scroll diagnostic");
    expect(markdown).toContain("Captured: 2026-05-13T12:00:00.000Z");
    expect(markdown).toContain("| Frame P95 | 52.0 ms |");
    expect(markdown).toContain("| Frames over 33.4 ms | 2 |");
    expect(markdown).toContain("| Wheel events | 3 |");
    expect(markdown).toContain("| Wheel direction changes | 1 |");
    expect(markdown).toContain("| Wheel events into edge | 1 |");
    expect(markdown).toContain("| Scroll distance | 350.0 px |");
    expect(markdown).toContain("| Scroll direction changes | 1 |");
    expect(markdown).toContain("| End position | inside |");
  });

  it("escapes table separators in markdown values", () => {
    const markdown = formatCalendarScrollDiagnosticMarkdown(
      summarizeCalendarScrollSample(sample({ userAgent: "WebKit|GTK\nUbuntu" })),
    );

    expect(markdown).toContain("| User agent | WebKit\\|GTK Ubuntu |");
  });
});
