import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./types";
import { layoutMonthDayEvents, MONTH_EVENT_CHIP_HEIGHT_PX } from "./month-event-layout";

function evt(id: string, title: string): CalendarEvent {
  return {
    id,
    title,
    start: "2026-03-13 09:00",
    end: "2026-03-13 10:00",
    timezone: "UTC",
    calendarId: "local",
  };
}

describe("layoutMonthDayEvents", () => {
  it("packs short events into the same row when they fit", () => {
    const layout = layoutMonthDayEvents([
      evt("1", "Sleep"),
      evt("2", "Breakfast"),
    ], {
      cellWidthPx: 100,
      availableHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX,
    });

    expect(layout.hiddenCount).toBe(0);
    expect(layout.items).toHaveLength(2);
    expect(layout.items.map((item) => item.row)).toEqual([0, 0]);
    expect(layout.items[1].leftPx).toBeGreaterThan(layout.items[0].leftPx);
  });

  it("expands the last event in each row to the row edge", () => {
    const layout = layoutMonthDayEvents([
      evt("1", "Sleep"),
      evt("2", "Breakfast"),
    ], {
      cellWidthPx: 100,
      availableHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX,
    });

    const last = layout.items[1];
    expect(last.kind).toBe("event");
    expect(last.leftPx + last.widthPx).toBe(100);
  });

  it("moves a long event to the next row when the current row is full", () => {
    const layout = layoutMonthDayEvents([
      evt("1", "Sleep"),
      evt("2", "Breakfast"),
      evt("3", "Deep planning review"),
    ], {
      cellWidthPx: 100,
      availableHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX * 2 + 1,
    });

    expect(layout.hiddenCount).toBe(0);
    expect(layout.items.map((item) => item.row)).toEqual([0, 0, 1]);
  });

  it("uses the half-row cap for packing before expanding the last event", () => {
    const layout = layoutMonthDayEvents([
      evt("1", "This is a very long event title that cannot fit naturally"),
      evt("2", "Another very long event title that still shares a row"),
    ], {
      cellWidthPx: 200,
      availableHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX,
    });

    expect(layout.items).toHaveLength(2);
    expect(layout.items.map((item) => item.row)).toEqual([0, 0]);
    expect(layout.items[0].widthPx).toBeLessThanOrEqual(99);
  });

  it("uses available height to limit rows without shrinking chips", () => {
    const layout = layoutMonthDayEvents([
      evt("1", "Sleep"),
      evt("2", "Breakfast"),
      evt("3", "Meditate"),
      evt("4", "Review"),
    ], {
      cellWidthPx: 100,
      availableHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX,
    });

    expect(layout.rowCount).toBe(1);
    expect(layout.items.every((item) => item.heightPx === MONTH_EVENT_CHIP_HEIGHT_PX)).toBe(true);
    expect(layout.items.every((item) => item.topPx === 0)).toBe(true);
    expect(layout.hiddenCount).toBeGreaterThan(0);
  });

  it("adds a more chip when events overflow", () => {
    const layout = layoutMonthDayEvents([
      evt("1", "Sleep"),
      evt("2", "Breakfast"),
      evt("3", "Meditate"),
      evt("4", "Review"),
    ], {
      cellWidthPx: 100,
      availableHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX,
    });

    const more = layout.items.find((item) => item.kind === "more");
    expect(more).toBeDefined();
    expect(more?.hiddenCount).toBe(3);
  });

  it("keeps the more chip compact while expanding the previous event", () => {
    const layout = layoutMonthDayEvents([
      evt("1", "A"),
      evt("2", "B"),
      evt("3", "C"),
      evt("4", "D"),
    ], {
      cellWidthPx: 100,
      availableHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX,
    });

    const eventItem = layout.items.find((item) => item.kind === "event");
    const more = layout.items.find((item) => item.kind === "more");
    expect(eventItem?.kind).toBe("event");
    expect(more?.kind).toBe("more");
    expect(more?.widthPx).toBeLessThan(60);
    if (eventItem?.kind === "event" && more?.kind === "more") {
      expect(more.leftPx + more.widthPx).toBe(100);
      expect(eventItem.leftPx + eventItem.widthPx).toBe(more.leftPx - 2);
    }
  });

  it("replaces visible chips until the more chip fits", () => {
    const layout = layoutMonthDayEvents([
      evt("1", "A"),
      evt("2", "B"),
      evt("3", "C"),
    ], {
      cellWidthPx: 60,
      availableHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX,
    });

    expect(layout.items).toHaveLength(1);
    expect(layout.items[0].kind).toBe("more");
    expect(layout.hiddenCount).toBe(3);
  });

  it("returns no visible items when no legible row fits", () => {
    const layout = layoutMonthDayEvents([
      evt("1", "Sleep"),
    ], {
      cellWidthPx: 100,
      availableHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX - 1,
    });

    expect(layout.rowCount).toBe(0);
    expect(layout.items).toEqual([]);
    expect(layout.hiddenCount).toBe(1);
  });

  it("clamps chip width inside very narrow cells", () => {
    const layout = layoutMonthDayEvents([
      evt("1", "Sleep"),
    ], {
      cellWidthPx: 20,
      availableHeightPx: MONTH_EVENT_CHIP_HEIGHT_PX,
    });

    expect(layout.items).toHaveLength(1);
    expect(layout.items[0].widthPx).toBeLessThanOrEqual(20);
  });
});
