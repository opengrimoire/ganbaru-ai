import { describe, it, expect } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { buildExpansionIndex, eventsInWindowFromIndex } from "./calendar-index";
import type { CalendarEvent } from "./types";

function evt(base: Partial<CalendarEvent> & {
  id: string; title: string; start: string; end: string;
}): CalendarEvent {
  return { timezone: "UTC", calendarId: "local", ...base } as CalendarEvent;
}

function plainDate(s: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(s);
}

describe("buildExpansionIndex", () => {
  it("partitions events into recurring and non-recurring", () => {
    const events: CalendarEvent[] = [
      evt({ id: "a", title: "A", start: "2026-04-29 09:00", end: "2026-04-29 10:00" }),
      evt({
        id: "b", title: "B",
        start: "2026-04-30 09:00", end: "2026-04-30 10:00",
        recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
      }),
    ];
    const index = buildExpansionIndex(events);
    expect(index.recurring.map((e) => e.id)).toEqual(["b"]);
    expect(index.nonRecurringSorted.map((e) => e.id)).toEqual(["a"]);
  });

  it("sorts non-recurring events by start ascending", () => {
    const events: CalendarEvent[] = [
      evt({ id: "c", title: "C", start: "2026-05-01 09:00", end: "2026-05-01 10:00" }),
      evt({ id: "a", title: "A", start: "2026-04-29 09:00", end: "2026-04-29 10:00" }),
      evt({ id: "b", title: "B", start: "2026-04-30 09:00", end: "2026-04-30 10:00" }),
    ];
    const index = buildExpansionIndex(events);
    expect(index.nonRecurringSorted.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(index.nonRecurringStarts).toEqual(
      index.nonRecurringSorted.map((e) => e.start),
    );
  });

  it("tracks the maximum non-recurring span across day-spanning events", () => {
    const events: CalendarEvent[] = [
      evt({ id: "short", title: "S", start: "2026-04-29 09:00", end: "2026-04-29 10:00" }),
      evt({ id: "wide",  title: "W", start: "2026-04-29",       end: "2026-05-09" }),
    ];
    expect(buildExpansionIndex(events).maxNonRecurringSpanDays).toBe(10);
  });

  it("classifies an event with rdate as recurring even without an rrule", () => {
    const events: CalendarEvent[] = [
      evt({
        id: "r", title: "R",
        start: "2026-04-29 09:00", end: "2026-04-29 10:00",
        rdate: ["2026-05-06"],
      }),
    ];
    const index = buildExpansionIndex(events);
    expect(index.recurring.map((e) => e.id)).toEqual(["r"]);
    expect(index.nonRecurringSorted).toEqual([]);
  });
});

describe("eventsInWindowFromIndex", () => {
  it("returns non-recurring events that fall inside the window", () => {
    const events: CalendarEvent[] = [
      evt({ id: "before", title: "Before", start: "2026-04-20 09:00", end: "2026-04-20 10:00" }),
      evt({ id: "inside", title: "Inside", start: "2026-04-29 09:00", end: "2026-04-29 10:00" }),
      evt({ id: "after",  title: "After",  start: "2026-05-10 09:00", end: "2026-05-10 10:00" }),
    ];
    const index = buildExpansionIndex(events);
    const result = eventsInWindowFromIndex(index, plainDate("2026-04-26"), plainDate("2026-05-02"));
    expect(result.map((e) => e.id)).toEqual(["inside"]);
  });

  it("includes a day-spanning event whose start is before the window", () => {
    const events: CalendarEvent[] = [
      evt({ id: "wide", title: "Wide", start: "2026-04-15", end: "2026-05-05" }),
    ];
    const index = buildExpansionIndex(events);
    const result = eventsInWindowFromIndex(index, plainDate("2026-04-26"), plainDate("2026-05-02"));
    expect(result.map((e) => e.id)).toEqual(["wide"]);
  });

  it("excludes events that ended before the window", () => {
    const events: CalendarEvent[] = [
      evt({ id: "old", title: "Old", start: "2026-04-15 09:00", end: "2026-04-15 10:00" }),
    ];
    const index = buildExpansionIndex(events);
    expect(eventsInWindowFromIndex(index, plainDate("2026-04-26"), plainDate("2026-05-02"))).toEqual([]);
  });

  it("excludes events whose start is after the window end", () => {
    const events: CalendarEvent[] = [
      evt({ id: "future", title: "F", start: "2026-05-10 09:00", end: "2026-05-10 10:00" }),
    ];
    const index = buildExpansionIndex(events);
    expect(eventsInWindowFromIndex(index, plainDate("2026-04-26"), plainDate("2026-05-02"))).toEqual([]);
  });

  it("includes an event that starts on the window-end day", () => {
    const events: CalendarEvent[] = [
      evt({ id: "edge", title: "E", start: "2026-05-02 23:00", end: "2026-05-02 23:30" }),
    ];
    const index = buildExpansionIndex(events);
    const result = eventsInWindowFromIndex(index, plainDate("2026-04-26"), plainDate("2026-05-02"));
    expect(result.map((e) => e.id)).toEqual(["edge"]);
  });

  it("includes an event that starts on the window-start day", () => {
    const events: CalendarEvent[] = [
      evt({ id: "edge", title: "E", start: "2026-04-26 00:00", end: "2026-04-26 00:30" }),
    ];
    const index = buildExpansionIndex(events);
    const result = eventsInWindowFromIndex(index, plainDate("2026-04-26"), plainDate("2026-05-02"));
    expect(result.map((e) => e.id)).toEqual(["edge"]);
  });

  it("expands recurring templates into the window", () => {
    const events: CalendarEvent[] = [
      evt({
        id: "daily", title: "Daily",
        start: "2026-04-25 09:00", end: "2026-04-25 10:00",
        recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
      }),
    ];
    const index = buildExpansionIndex(events);
    const result = eventsInWindowFromIndex(index, plainDate("2026-04-26"), plainDate("2026-04-30"));
    expect(result.length).toBe(5);
  });

  it("renders an indefinite recurrence at far-future windows", () => {
    const events: CalendarEvent[] = [
      evt({
        id: "weekly", title: "Weekly",
        start: "2026-04-29 09:00", end: "2026-04-29 10:00",
        recurrence: { frequency: "weekly", interval: 1, end: { type: "never" } },
      }),
    ];
    const index = buildExpansionIndex(events);
    const result = eventsInWindowFromIndex(index, plainDate("2030-01-01"), plainDate("2030-01-31"));
    expect(result.length).toBeGreaterThanOrEqual(4);
  });

  it("returns an empty list when the window is empty (start after end)", () => {
    const events: CalendarEvent[] = [
      evt({ id: "any", title: "A", start: "2026-04-29 09:00", end: "2026-04-29 10:00" }),
    ];
    const index = buildExpansionIndex(events);
    expect(
      eventsInWindowFromIndex(index, plainDate("2026-05-10"), plainDate("2026-05-09")),
    ).toEqual([]);
  });

  it("handles a date-only event ('YYYY-MM-DD' with no time) inside the window", () => {
    const events: CalendarEvent[] = [
      evt({ id: "allday", title: "All", start: "2026-04-29", end: "2026-04-29" }),
    ];
    const index = buildExpansionIndex(events);
    const result = eventsInWindowFromIndex(index, plainDate("2026-04-26"), plainDate("2026-05-02"));
    expect(result.map((e) => e.id)).toEqual(["allday"]);
  });
});
