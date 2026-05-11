import { describe, it, expect } from "vitest";
import {
  countDenseCalendarEvents,
  denseCalendarDateRange,
  generateDenseCalendarEvents,
} from "./dense";
import {
  benchmarkDatasetId,
  DEFAULT_BENCHMARK_DATASET,
  LARGE_BENCHMARK_DATASET,
} from "./types";

const ANCHOR = new Date(2026, 3, 30);

describe("benchmark dense calendar datasets", () => {
  it("formats dataset ids by version, year radius, stack count, and detail profile", () => {
    expect(benchmarkDatasetId(DEFAULT_BENCHMARK_DATASET)).toBe("dense-v1-r1y-s3-d1");
    expect(benchmarkDatasetId(LARGE_BENCHMARK_DATASET)).toBe("dense-v1-r10y-s3-d1");
  });

  it("counts the 1-year and 10-year dense spans around the fixed anchor", () => {
    expect(denseCalendarDateRange(DEFAULT_BENCHMARK_DATASET, ANCHOR)).toEqual({
      start: "2025-04-30",
      endExclusive: "2027-04-30",
      days: 730,
    });
    expect(countDenseCalendarEvents(DEFAULT_BENCHMARK_DATASET, ANCHOR)).toBe(52_560);
    expect(denseCalendarDateRange(LARGE_BENCHMARK_DATASET, ANCHOR)).toEqual({
      start: "2016-04-30",
      endExclusive: "2036-04-30",
      days: 7305,
    });
    expect(countDenseCalendarEvents(LARGE_BENCHMARK_DATASET, ANCHOR)).toBe(525_960);
  });

  it("places three stacked events at the same start of every hour", () => {
    const events = generateDenseCalendarEvents({
      dataset: DEFAULT_BENCHMARK_DATASET,
      anchor: ANCHOR,
      count: 8,
    });

    expect(events.map((event) => event.start)).toEqual([
      "2025-04-30 00:00",
      "2025-04-30 00:00",
      "2025-04-30 00:00",
      "2025-04-30 01:00",
      "2025-04-30 01:00",
      "2025-04-30 01:00",
      "2025-04-30 02:00",
      "2025-04-30 02:00",
    ]);
    expect(events.map((event) => event.end)).toEqual([
      "2025-04-30 00:50",
      "2025-04-30 00:50",
      "2025-04-30 00:50",
      "2025-04-30 01:50",
      "2025-04-30 01:50",
      "2025-04-30 01:50",
      "2025-04-30 02:50",
      "2025-04-30 02:50",
    ]);
  });

  it("keeps overlapping source UIDs stable when the year radius changes", () => {
    const defaultIndexForAnchor = 365 * 24 * DEFAULT_BENCHMARK_DATASET.stackCount;
    const largeIndexForAnchor = 3652 * 24 * LARGE_BENCHMARK_DATASET.stackCount;
    const defaultEvent = generateDenseCalendarEvents({
      dataset: DEFAULT_BENCHMARK_DATASET,
      anchor: ANCHOR,
      offset: defaultIndexForAnchor,
      count: 1,
    })[0];
    const largeEvent = generateDenseCalendarEvents({
      dataset: LARGE_BENCHMARK_DATASET,
      anchor: ANCHOR,
      offset: largeIndexForAnchor,
      count: 1,
    })[0];

    expect(defaultEvent?.start).toBe("2026-04-30 00:00");
    expect(defaultEvent?.sourceUid).toBe(largeEvent?.sourceUid);
  });

  it("adds detail profile fields to practical benchmark events", () => {
    const event = generateDenseCalendarEvents({
      dataset: DEFAULT_BENCHMARK_DATASET,
      anchor: ANCHOR,
      count: 1,
    })[0];

    expect(event).toMatchObject({
      start: "2025-04-30 00:00",
      end: "2025-04-30 00:50",
      sourceUid: "dense-v1-s3-d1-2025-04-30T00-stack1",
      notifications: [10],
      location: expect.stringContaining("Home office"),
      url: "https://benchmark.local/dense-v1-r1y-s3-d1/2025-04-30/00/1",
      organizer: {
        name: "Benchmark Calendar",
        email: "owner@benchmark.local",
      },
      guestPermissions: {
        canModify: false,
        canInviteOthers: true,
        canSeeOtherGuests: true,
      },
    });
    expect(event?.description).toContain("Preparation:");
    expect(event?.alarms).toHaveLength(1);
    expect(event?.attendees).toHaveLength(1);
    expect(event?.categories).toContain("benchmark");
    expect(event?.extendedProperties?.["X-BENCHMARK-DATASET"]).toBe("dense-v1-r1y-s3-d1");
  });

  it("supports deterministic chunked slices", () => {
    const whole = generateDenseCalendarEvents({
      dataset: DEFAULT_BENCHMARK_DATASET,
      anchor: ANCHOR,
      count: 12,
    });
    const chunk = generateDenseCalendarEvents({
      dataset: DEFAULT_BENCHMARK_DATASET,
      anchor: ANCHOR,
      offset: 6,
      count: 3,
    });

    expect(chunk).toEqual(whole.slice(6, 9));
  });
});
