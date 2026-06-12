import { describe, expect, it } from "vitest";
import { calendarEvent } from "./adaptive-test-helpers";
import { buildAdaptivePlannedBlocksForDate } from "./planned-blocks";

describe("adaptive planned block snapshots", () => {
  it("maps scheduler events to stable planned block identities", () => {
    const blocks = buildAdaptivePlannedBlocksForDate([
      calendarEvent({
        id: "template-1::2026-06-10",
        recurringParentId: "template-1",
        start: "2026-06-10 09:00",
        end: "2026-06-10 10:00",
      }),
      calendarEvent({
        id: "single-1",
        start: "2026-06-10 11:00",
        end: "2026-06-10 12:00",
      }),
      calendarEvent({
        id: "other-day",
        start: "2026-06-11 09:00",
        end: "2026-06-11 10:00",
      }),
    ], "2026-06-10");

    expect(blocks).toEqual([
      {
        eventDate: "2026-06-10",
        eventId: "template-1::2026-06-10",
        originalEventId: "template-1",
        plannedStart: new Date(2026, 5, 10, 9, 0).toISOString(),
        plannedEnd: new Date(2026, 5, 10, 10, 0).toISOString(),
        sourceKind: "scheduler_snapshot",
      },
      {
        eventDate: "2026-06-10",
        eventId: "single-1",
        originalEventId: "single-1",
        plannedStart: new Date(2026, 5, 10, 11, 0).toISOString(),
        plannedEnd: new Date(2026, 5, 10, 12, 0).toISOString(),
        sourceKind: "scheduler_snapshot",
      },
    ]);
  });
});
