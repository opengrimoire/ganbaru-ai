import { describe, it, expect } from "vitest";
import {
  parseCalendarDate,
  formatCalendarDate,
  formatDatePart,
  startOfWeek,
  getWeekDays,
  addDays,
  isSameDay,
  minuteOfDay,
  minuteToTop,
  durationMinutes,
  snapToGrid,
  clampMinute,
  eventsForDay,
  allDayEventsForDay,
  allDayEventsForWeek,
  layoutAllDayEventsForWeek,
  layoutEventsForDay,
  effectiveMinuteRange,
  minuteOffsetToDateStr,
  formatHour,
} from "./utils";
import type { CalendarEvent } from "./types";

/** Build a CalendarEvent with required timezone/calendarId defaults. */
function evt(base: Omit<CalendarEvent, "timezone" | "calendarId">): CalendarEvent {
  return { timezone: "UTC", calendarId: "local", ...base };
}

describe("parseCalendarDate", () => {
  it("parses YYYY-MM-DD HH:MM to a local Date", () => {
    const d = parseCalendarDate("2026-03-13 14:30");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // 0-indexed
    expect(d.getDate()).toBe(13);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it("defaults time to 00:00 if missing", () => {
    const d = parseCalendarDate("2026-01-01");
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});

describe("formatCalendarDate", () => {
  it("formats a Date to YYYY-MM-DD HH:MM", () => {
    const d = new Date(2026, 2, 13, 14, 30);
    expect(formatCalendarDate(d)).toBe("2026-03-13 14:30");
  });

  it("zero-pads single digit values", () => {
    const d = new Date(2026, 0, 5, 3, 7);
    expect(formatCalendarDate(d)).toBe("2026-01-05 03:07");
  });
});

describe("parseCalendarDate and formatCalendarDate round-trip", () => {
  it("round-trips without data loss", () => {
    const original = "2026-07-04 09:15";
    const parsed = parseCalendarDate(original);
    const formatted = formatCalendarDate(parsed);
    expect(formatted).toBe(original);
  });
});

describe("formatDatePart", () => {
  it("returns YYYY-MM-DD", () => {
    const d = new Date(2026, 11, 25, 18, 45);
    expect(formatDatePart(d)).toBe("2026-12-25");
  });
});

describe("startOfWeek", () => {
  it("returns Monday for any day of the week", () => {
    // 2026-03-13 is a Friday
    const friday = new Date(2026, 2, 13);
    const monday = startOfWeek(friday);
    expect(monday.getDay()).toBe(1); // Monday
    expect(monday.getDate()).toBe(9);
  });

  it("returns same day if already Monday", () => {
    const monday = new Date(2026, 2, 9);
    const result = startOfWeek(monday);
    expect(result.getDate()).toBe(9);
  });

  it("handles Sunday correctly (shifts back to previous Monday)", () => {
    const sunday = new Date(2026, 2, 15);
    const monday = startOfWeek(sunday);
    expect(monday.getDate()).toBe(9);
  });
});

describe("getWeekDays", () => {
  it("returns 7 days starting from Monday", () => {
    const days = getWeekDays(new Date(2026, 2, 13));
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(1); // Monday
    expect(days[6].getDay()).toBe(0); // Sunday
  });
});

describe("addDays", () => {
  it("adds positive days", () => {
    const d = addDays(new Date(2026, 2, 13), 5);
    expect(d.getDate()).toBe(18);
  });

  it("subtracts with negative days", () => {
    const d = addDays(new Date(2026, 2, 13), -3);
    expect(d.getDate()).toBe(10);
  });

  it("handles month boundaries", () => {
    const d = addDays(new Date(2026, 0, 31), 1);
    expect(d.getMonth()).toBe(1); // February
    expect(d.getDate()).toBe(1);
  });
});

describe("isSameDay", () => {
  it("returns true for same date different times", () => {
    const a = new Date(2026, 2, 13, 8, 0);
    const b = new Date(2026, 2, 13, 22, 30);
    expect(isSameDay(a, b)).toBe(true);
  });

  it("returns false for different dates", () => {
    const a = new Date(2026, 2, 13);
    const b = new Date(2026, 2, 14);
    expect(isSameDay(a, b)).toBe(false);
  });
});

describe("minuteOfDay", () => {
  it("parses HH:MM from calendar date string", () => {
    expect(minuteOfDay("2026-03-13 14:30")).toBe(870);
    expect(minuteOfDay("2026-03-13 00:00")).toBe(0);
    expect(minuteOfDay("2026-03-13 23:59")).toBe(1439);
  });

  it("defaults to 0 if no time part", () => {
    expect(minuteOfDay("2026-03-13")).toBe(0);
  });
});

describe("minuteToTop", () => {
  it("converts minutes to pixel position", () => {
    expect(minuteToTop(60, 48)).toBe(48); // 1 hour
    expect(minuteToTop(30, 48)).toBe(24); // 30 min
    expect(minuteToTop(0, 48)).toBe(0);
  });
});

describe("durationMinutes", () => {
  it("calculates duration between two calendar dates", () => {
    expect(durationMinutes("2026-03-13 14:00", "2026-03-13 15:30")).toBe(90);
    expect(durationMinutes("2026-03-13 08:00", "2026-03-13 08:30")).toBe(30);
  });

  it("returns 0 for same start and end", () => {
    expect(durationMinutes("2026-03-13 14:00", "2026-03-13 14:00")).toBe(0);
  });

  it("returns 0 for negative duration", () => {
    expect(durationMinutes("2026-03-13 15:00", "2026-03-13 14:00")).toBe(0);
  });
});

describe("snapToGrid", () => {
  it("snaps to 10-minute grid by default", () => {
    expect(snapToGrid(4)).toBe(0);
    expect(snapToGrid(5)).toBe(10);
    expect(snapToGrid(14)).toBe(10);
    expect(snapToGrid(15)).toBe(20);
    expect(snapToGrid(25)).toBe(30);
  });

  it("snaps to custom grid size", () => {
    expect(snapToGrid(20, 30)).toBe(30);
    expect(snapToGrid(14, 30)).toBe(0);
  });
});

describe("clampMinute", () => {
  it("clamps to 0-1440 range", () => {
    expect(clampMinute(-10)).toBe(0);
    expect(clampMinute(720)).toBe(720);
    expect(clampMinute(1500)).toBe(1440);
  });
});

describe("formatHour", () => {
  it("formats hour with leading zero", () => {
    expect(formatHour(0)).toBe("00:00");
    expect(formatHour(9)).toBe("09:00");
    expect(formatHour(14)).toBe("14:00");
  });
});

describe("eventsForDay", () => {
  const events: CalendarEvent[] = [
    evt({ id: "1", title: "A", start: "2026-03-13 09:00", end: "2026-03-13 10:00" }),
    evt({ id: "2", title: "B", start: "2026-03-14 09:00", end: "2026-03-14 10:00" }),
    evt({ id: "3", title: "C", start: "2026-03-13 14:00", end: "2026-03-13 15:00" }),
  ];

  it("filters events for a specific day", () => {
    const result = eventsForDay(events, new Date(2026, 2, 13));
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["1", "3"]);
  });

  it("returns empty array for days with no events", () => {
    const result = eventsForDay(events, new Date(2026, 2, 15));
    expect(result).toHaveLength(0);
  });

  it("includes cross-midnight events on the next day", () => {
    const crossEvents: CalendarEvent[] = [
      evt({ id: "1", title: "Night", start: "2026-03-13 22:00", end: "2026-03-14 02:00" }),
    ];
    // Should appear on both Mar 13 and Mar 14
    expect(eventsForDay(crossEvents, new Date(2026, 2, 13))).toHaveLength(1);
    expect(eventsForDay(crossEvents, new Date(2026, 2, 14))).toHaveLength(1);
    expect(eventsForDay(crossEvents, new Date(2026, 2, 15))).toHaveLength(0);
  });

  it("excludes events ending exactly at midnight of the queried day", () => {
    const crossEvents: CalendarEvent[] = [
      evt({ id: "1", title: "Until midnight", start: "2026-03-13 22:00", end: "2026-03-14 00:00" }),
    ];
    // Ends at midnight of Mar 14, so it should NOT appear on Mar 14
    expect(eventsForDay(crossEvents, new Date(2026, 2, 13))).toHaveLength(1);
    expect(eventsForDay(crossEvents, new Date(2026, 2, 14))).toHaveLength(0);
  });

  it("includes multi-day events on intermediate days", () => {
    const multiDay: CalendarEvent[] = [
      evt({ id: "1", title: "Long", start: "2026-03-13 22:00", end: "2026-03-16 06:00" }),
    ];
    expect(eventsForDay(multiDay, new Date(2026, 2, 13))).toHaveLength(1);
    expect(eventsForDay(multiDay, new Date(2026, 2, 14))).toHaveLength(1);
    expect(eventsForDay(multiDay, new Date(2026, 2, 15))).toHaveLength(1);
    expect(eventsForDay(multiDay, new Date(2026, 2, 16))).toHaveLength(1);
    expect(eventsForDay(multiDay, new Date(2026, 2, 17))).toHaveLength(0);
  });
});

describe("effectiveMinuteRange", () => {
  it("returns actual minutes for same-day events", () => {
    const event: CalendarEvent = evt({
      id: "1", title: "A", start: "2026-03-13 09:00", end: "2026-03-13 11:00",
    });
    const range = effectiveMinuteRange(event, "2026-03-13");
    expect(range.startMinute).toBe(540);
    expect(range.endMinute).toBe(660);
  });

  it("clips cross-midnight event on start day", () => {
    const event: CalendarEvent = evt({
      id: "1", title: "Night", start: "2026-03-13 22:00", end: "2026-03-14 02:00",
    });
    const range = effectiveMinuteRange(event, "2026-03-13");
    expect(range.startMinute).toBe(1320); // 22:00
    expect(range.endMinute).toBe(1440); // fills to bottom
  });

  it("clips cross-midnight event on end day", () => {
    const event: CalendarEvent = evt({
      id: "1", title: "Night", start: "2026-03-13 22:00", end: "2026-03-14 02:00",
    });
    const range = effectiveMinuteRange(event, "2026-03-14");
    expect(range.startMinute).toBe(0); // starts at top
    expect(range.endMinute).toBe(120); // 02:00
  });

  it("fills full day for intermediate days of multi-day events", () => {
    const event: CalendarEvent = evt({
      id: "1", title: "Long", start: "2026-03-13 22:00", end: "2026-03-16 06:00",
    });
    const range = effectiveMinuteRange(event, "2026-03-14");
    expect(range.startMinute).toBe(0);
    expect(range.endMinute).toBe(1440);
  });
});

describe("minuteOffsetToDateStr", () => {
  it("returns same day for normal minutes", () => {
    expect(minuteOffsetToDateStr("2026-03-13", 540)).toBe("2026-03-13 09:00");
  });

  it("rolls to next day for minutes > 1440", () => {
    expect(minuteOffsetToDateStr("2026-03-13", 1560)).toBe("2026-03-14 02:00");
  });

  it("handles exactly midnight (1440)", () => {
    expect(minuteOffsetToDateStr("2026-03-13", 1440)).toBe("2026-03-14 00:00");
  });

  it("handles month boundary rollover", () => {
    expect(minuteOffsetToDateStr("2026-01-31", 1500)).toBe("2026-02-01 01:00");
  });
});

describe("layoutEventsForDay", () => {
  it("positions a single event correctly", () => {
    const events: CalendarEvent[] = [
      evt({ id: "1", title: "A", start: "2026-03-13 09:00", end: "2026-03-13 10:00" }),
    ];
    const layout = layoutEventsForDay(events, "2026-03-13");
    expect(layout).toHaveLength(1);
    expect(layout[0].left).toBe(0);
    expect(layout[0].width).toBe(92);
    expect(layout[0].column).toBe(0);
    expect(layout[0].totalColumns).toBe(1);
  });

  it("splits overlapping events into columns", () => {
    const events: CalendarEvent[] = [
      evt({ id: "1", title: "A", start: "2026-03-13 09:00", end: "2026-03-13 11:00" }),
      evt({ id: "2", title: "B", start: "2026-03-13 10:00", end: "2026-03-13 12:00" }),
    ];
    const layout = layoutEventsForDay(events, "2026-03-13");
    expect(layout).toHaveLength(2);
    expect(layout[0].totalColumns).toBe(2);
    expect(layout[1].totalColumns).toBe(2);
    expect(layout[0].width).toBe(46);
    expect(layout[1].width).toBe(46);
  });

  it("returns empty array for no events", () => {
    expect(layoutEventsForDay([], "2026-03-13")).toEqual([]);
  });

  it("positions cross-midnight event on start day from start to bottom", () => {
    const events: CalendarEvent[] = [
      evt({ id: "1", title: "Night", start: "2026-03-13 22:00", end: "2026-03-14 02:00" }),
    ];
    const layout = layoutEventsForDay(events, "2026-03-13");
    expect(layout).toHaveLength(1);
    expect(layout[0].startMinute).toBe(1320); // 22:00 = minute 1320
    // Duration covers 22:00 to 24:00 = 120 minutes
    expect(layout[0].durationMinutes).toBe(120);
    expect(layout[0].isClippedTop).toBe(false);
    expect(layout[0].isClippedBottom).toBe(true);
  });

  it("positions cross-midnight event on end day from top to end", () => {
    const events: CalendarEvent[] = [
      evt({ id: "1", title: "Night", start: "2026-03-13 22:00", end: "2026-03-14 02:00" }),
    ];
    const layout = layoutEventsForDay(events, "2026-03-14");
    expect(layout).toHaveLength(1);
    expect(layout[0].startMinute).toBe(0);
    // Duration covers 00:00 to 02:00 = 120 minutes
    expect(layout[0].durationMinutes).toBe(120);
    expect(layout[0].isClippedTop).toBe(true);
    expect(layout[0].isClippedBottom).toBe(false);
  });
});

describe("calendar store time conversion round-trip", () => {
  // These test the contract of toDbTime/toCalendarDate without importing private functions.
  // The store stores "YYYY-MM-DD HH:MM:00" and loads back "YYYY-MM-DD HH:MM".

  it("appending :00 and taking substring(0,16) is a lossless round-trip", () => {
    const input = "2026-03-13 14:30";
    const dbTime = input + ":00"; // toDbTime
    const loaded = dbTime.substring(0, 16).replace("T", " "); // toCalendarDate
    expect(loaded).toBe(input);
  });

  it("handles midnight correctly", () => {
    const input = "2026-01-01 00:00";
    const dbTime = input + ":00";
    const loaded = dbTime.substring(0, 16).replace("T", " ");
    expect(loaded).toBe(input);
  });

  it("handles 23:59 correctly", () => {
    const input = "2026-12-31 23:59";
    const dbTime = input + ":00";
    const loaded = dbTime.substring(0, 16).replace("T", " ");
    expect(loaded).toBe(input);
  });

  it("handles legacy ISO format from old data gracefully", () => {
    // Old data stored as ISO: "2026-03-13T19:30:00.000Z"
    // toCalendarDate strips timezone and uses UTC hours (known limitation for old data)
    const isoString = "2026-03-13T19:30:00.000Z";
    const loaded = isoString.substring(0, 16).replace("T", " ");
    expect(loaded).toBe("2026-03-13 19:30");
  });
});

// --- All-day event helpers ---

describe("eventsForDay excludes all-day events", () => {
  it("filters out all-day events", () => {
    const events: CalendarEvent[] = [
      evt({ id: "1", title: "Timed", start: "2026-03-13 09:00", end: "2026-03-13 10:00" }),
      evt({ id: "2", title: "All day", start: "2026-03-13 00:00", end: "2026-03-13 00:00", allDay: true }),
    ];
    const result = eventsForDay(events, new Date(2026, 2, 13));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });
});

describe("allDayEventsForDay", () => {
  const events: CalendarEvent[] = [
    evt({ id: "1", title: "Timed", start: "2026-03-13 09:00", end: "2026-03-13 10:00" }),
    evt({ id: "2", title: "All day", start: "2026-03-13 00:00", end: "2026-03-13 00:00", allDay: true }),
    evt({ id: "3", title: "Multi day", start: "2026-03-12 00:00", end: "2026-03-14 00:00", allDay: true }),
  ];

  it("returns only all-day events for the given date", () => {
    const result = allDayEventsForDay(events, new Date(2026, 2, 13));
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id).sort()).toEqual(["2", "3"]);
  });

  it("does not return timed events", () => {
    const result = allDayEventsForDay(events, new Date(2026, 2, 13));
    expect(result.every((e) => e.allDay)).toBe(true);
  });

  it("returns empty for days without all-day events", () => {
    const result = allDayEventsForDay(events, new Date(2026, 2, 15));
    expect(result).toHaveLength(0);
  });

  it("handles multi-day all-day events on intermediate days", () => {
    const result = allDayEventsForDay(events, new Date(2026, 2, 12));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("3");
  });
});

describe("allDayEventsForWeek", () => {
  const weekDays = [
    new Date(2026, 2, 9), new Date(2026, 2, 10), new Date(2026, 2, 11),
    new Date(2026, 2, 12), new Date(2026, 2, 13), new Date(2026, 2, 14),
    new Date(2026, 2, 15),
  ];

  const events: CalendarEvent[] = [
    evt({ id: "1", title: "In week", start: "2026-03-11 00:00", end: "2026-03-11 00:00", allDay: true }),
    evt({ id: "2", title: "Before week", start: "2026-03-08 00:00", end: "2026-03-08 00:00", allDay: true }),
    evt({ id: "3", title: "Spanning", start: "2026-03-08 00:00", end: "2026-03-10 00:00", allDay: true }),
    evt({ id: "4", title: "Timed", start: "2026-03-11 09:00", end: "2026-03-11 10:00" }),
  ];

  it("returns all-day events overlapping the week", () => {
    const result = allDayEventsForWeek(events, weekDays);
    expect(result.map((e) => e.id).sort()).toEqual(["1", "3"]);
  });

  it("excludes events entirely before or after the week", () => {
    const result = allDayEventsForWeek(events, weekDays);
    expect(result.find((e) => e.id === "2")).toBeUndefined();
  });

  it("excludes timed events", () => {
    const result = allDayEventsForWeek(events, weekDays);
    expect(result.find((e) => e.id === "4")).toBeUndefined();
  });
});

describe("layoutAllDayEventsForWeek", () => {
  const weekDays = [
    new Date(2026, 2, 9), new Date(2026, 2, 10), new Date(2026, 2, 11),
    new Date(2026, 2, 12), new Date(2026, 2, 13), new Date(2026, 2, 14),
    new Date(2026, 2, 15),
  ];

  it("places a single-day event in row 0 with span 1", () => {
    const events: CalendarEvent[] = [
      evt({ id: "1", title: "A", start: "2026-03-11 00:00", end: "2026-03-11 00:00", allDay: true }),
    ];
    const result = layoutAllDayEventsForWeek(events, weekDays);
    expect(result).toHaveLength(1);
    expect(result[0].row).toBe(0);
    expect(result[0].startCol).toBe(2); // Wed = index 2
    expect(result[0].spanCols).toBe(1);
  });

  it("spans a multi-day event across correct columns", () => {
    const events: CalendarEvent[] = [
      evt({ id: "1", title: "A", start: "2026-03-10 00:00", end: "2026-03-12 00:00", allDay: true }),
    ];
    const result = layoutAllDayEventsForWeek(events, weekDays);
    expect(result).toHaveLength(1);
    expect(result[0].startCol).toBe(1); // Tue
    expect(result[0].spanCols).toBe(3); // Tue-Wed-Thu
  });

  it("stacks overlapping events in separate rows", () => {
    const events: CalendarEvent[] = [
      evt({ id: "1", title: "A", start: "2026-03-11 00:00", end: "2026-03-13 00:00", allDay: true }),
      evt({ id: "2", title: "B", start: "2026-03-12 00:00", end: "2026-03-12 00:00", allDay: true }),
    ];
    const result = layoutAllDayEventsForWeek(events, weekDays);
    expect(result).toHaveLength(2);
    const rows = result.map((r) => r.row).sort();
    expect(rows).toEqual([0, 1]);
  });

  it("clips events that extend beyond the week", () => {
    const events: CalendarEvent[] = [
      evt({ id: "1", title: "A", start: "2026-03-07 00:00", end: "2026-03-11 00:00", allDay: true }),
    ];
    const result = layoutAllDayEventsForWeek(events, weekDays);
    expect(result).toHaveLength(1);
    expect(result[0].startCol).toBe(0); // Clipped to Mon
    expect(result[0].spanCols).toBe(3); // Mon-Tue-Wed
  });

  it("excludes events entirely outside the week", () => {
    const events: CalendarEvent[] = [
      evt({ id: "1", title: "A", start: "2026-03-01 00:00", end: "2026-03-05 00:00", allDay: true }),
    ];
    const result = layoutAllDayEventsForWeek(events, weekDays);
    expect(result).toHaveLength(0);
  });

  it("returns empty for no events", () => {
    const result = layoutAllDayEventsForWeek([], weekDays);
    expect(result).toHaveLength(0);
  });
});
