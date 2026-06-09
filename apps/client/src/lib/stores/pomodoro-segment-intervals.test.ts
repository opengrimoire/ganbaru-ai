import { describe, expect, it } from "vitest";
import type { PersistedSegment } from "$lib/components/calendar/types";
import {
  normalizePauseForSegment,
  normalizePausesForSegment,
  normalizeSegmentEndIso,
} from "./pomodoro-segment-intervals";

function segment(overrides: Partial<PersistedSegment> = {}): PersistedSegment {
  return {
    id: "segment-1",
    eventId: "event-1",
    eventDate: "2026-05-29",
    runId: "run-1",
    rhythmPosition: 1,
    phase: "focus",
    plannedStart: "2026-05-29T10:00:00.000Z",
    plannedEnd: "2026-05-29T10:40:00.000Z",
    actualStart: "2026-05-29T10:05:00.000Z",
    actualEnd: null,
    pauseLog: [],
    status: "active",
    ...overrides,
  };
}

describe("normalizePauseForSegment", () => {
  it("clamps a pause start that predates the segment actual start", () => {
    expect(
      normalizePauseForSegment(segment(), {
        startedAt: "2026-05-29T10:00:00.000Z",
        endedAt: null,
        reason: "idle",
      }),
    ).toEqual({
      startedAt: "2026-05-29T10:05:00.000Z",
      endedAt: null,
      reason: "idle",
    });
  });

  it("clamps a pause end that predates the normalized pause start", () => {
    expect(
      normalizePauseForSegment(segment(), {
        startedAt: "2026-05-29T10:00:00.000Z",
        endedAt: "2026-05-29T10:03:00.000Z",
        reason: "idle",
      }),
    ).toEqual({
      startedAt: "2026-05-29T10:05:00.000Z",
      endedAt: "2026-05-29T10:05:00.000Z",
      reason: "idle",
    });
  });

  it("falls back to planned start when actual start is missing", () => {
    expect(
      normalizePauseForSegment(segment({ actualStart: null }), {
        startedAt: "2026-05-29T09:55:00.000Z",
        endedAt: null,
        reason: "suspend",
      }).startedAt,
    ).toBe("2026-05-29T10:00:00.000Z");
  });
});

describe("normalizePausesForSegment", () => {
  it("normalizes every pause in a segment pause log", () => {
    expect(
      normalizePausesForSegment(segment(), [
        {
          startedAt: "2026-05-29T10:01:00.000Z",
          endedAt: "2026-05-29T10:02:00.000Z",
          reason: "idle",
        },
      ]),
    ).toEqual([
      {
        startedAt: "2026-05-29T10:05:00.000Z",
        endedAt: "2026-05-29T10:05:00.000Z",
        reason: "idle",
      },
    ]);
  });
});

describe("normalizeSegmentEndIso", () => {
  it("clamps segment end to actual start when a stop timestamp predates it", () => {
    expect(
      normalizeSegmentEndIso(segment(), "2026-05-29T10:04:00.000Z"),
    ).toBe("2026-05-29T10:05:00.000Z");
  });

  it("keeps a valid segment end timestamp", () => {
    expect(
      normalizeSegmentEndIso(segment(), "2026-05-29T10:12:00.000Z"),
    ).toBe("2026-05-29T10:12:00.000Z");
  });
});
