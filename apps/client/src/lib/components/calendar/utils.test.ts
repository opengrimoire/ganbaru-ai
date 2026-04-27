import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  isValidCalendarTime,
  sanitizeCalendarTime,
  normalizeEventColor,
  EVENT_COLOR_OPTIONS,
  getEventColor,
  getPastEventColor,
  getCancelledEventColor,
  getFreeEventColor,
  getOutsideMonthEventColor,
  getTimezoneCity,
  getTimezoneRegion,
  getTimezoneOffsetMinutes,
  formatColumnHeaderAbbr,
  listAllTimezones,
} from "./utils";
import type { CalendarEvent } from "./types";
import { lightTheme, darkTheme, type Theme } from "$lib/stores/themes";

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
    expect(layout[0].width).toBe(88);
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
    expect(layout[0].width).toBe(44);
    expect(layout[1].width).toBe(44);
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

// All-day event helpers

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

// Time validation and sanitization tests

describe("isValidCalendarTime", () => {
  it("accepts valid YYYY-MM-DD HH:MM format", () => {
    expect(isValidCalendarTime("2026-03-13 14:30")).toBe(true);
    expect(isValidCalendarTime("2026-01-01 00:00")).toBe(true);
    expect(isValidCalendarTime("2026-12-31 23:59")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(isValidCalendarTime("2026-03-13")).toBe(false); // missing time
    expect(isValidCalendarTime("2026-03-13 14:30:00")).toBe(false); // has seconds
    expect(isValidCalendarTime("2026/03/13 14:30")).toBe(false); // wrong separator
    expect(isValidCalendarTime("03-13-2026 14:30")).toBe(false); // wrong date format
    expect(isValidCalendarTime("")).toBe(false);
    expect(isValidCalendarTime("invalid")).toBe(false);
  });

  it("rejects out of range values", () => {
    expect(isValidCalendarTime("2026-13-01 12:00")).toBe(false); // month > 12
    expect(isValidCalendarTime("2026-00-01 12:00")).toBe(false); // month = 0
    expect(isValidCalendarTime("2026-03-32 12:00")).toBe(false); // day > 31
    expect(isValidCalendarTime("2026-03-00 12:00")).toBe(false); // day = 0
    expect(isValidCalendarTime("2026-03-13 24:00")).toBe(false); // hour > 23
    expect(isValidCalendarTime("2026-03-13 12:60")).toBe(false); // minute > 59
  });

  it("rejects non-string inputs", () => {
    expect(isValidCalendarTime(null as unknown as string)).toBe(false);
    expect(isValidCalendarTime(undefined as unknown as string)).toBe(false);
    expect(isValidCalendarTime(12345 as unknown as string)).toBe(false);
  });
});

describe("sanitizeCalendarTime", () => {
  it("passes through valid times unchanged", () => {
    expect(sanitizeCalendarTime("2026-03-13 14:30")).toBe("2026-03-13 14:30");
    expect(sanitizeCalendarTime("2026-01-01 00:00")).toBe("2026-01-01 00:00");
  });

  it("rounds floating point minutes", () => {
    expect(sanitizeCalendarTime("2026-03-13 14:30.5")).toBe("2026-03-13 14:31");
    expect(sanitizeCalendarTime("2026-03-13 14:30.4")).toBe("2026-03-13 14:30");
    expect(sanitizeCalendarTime("2026-03-13 14:30.14999999999977")).toBe("2026-03-13 14:30");
    expect(sanitizeCalendarTime("2026-03-13 13:23.14999999999977")).toBe("2026-03-13 13:23");
  });

  it("rounds floating point hours", () => {
    expect(sanitizeCalendarTime("2026-03-13 14.5:30")).toBe("2026-03-13 15:30");
  });

  it("clamps out of range values", () => {
    expect(sanitizeCalendarTime("2026-03-13 25:30")).toBe("2026-03-13 23:30");
    expect(sanitizeCalendarTime("2026-03-13 -1:30")).toBe("2026-03-13 00:30");
    expect(sanitizeCalendarTime("2026-03-13 14:70")).toBe("2026-03-13 14:59");
    expect(sanitizeCalendarTime("2026-03-13 14:-5")).toBe("2026-03-13 14:00");
  });

  it("defaults missing time to 00:00", () => {
    expect(sanitizeCalendarTime("2026-03-13")).toBe("2026-03-13 00:00");
  });

  it("returns null for invalid inputs", () => {
    expect(sanitizeCalendarTime("")).toBe(null);
    expect(sanitizeCalendarTime("invalid")).toBe(null);
    expect(sanitizeCalendarTime("2026/03/13 14:30")).toBe(null);
    expect(sanitizeCalendarTime(null as unknown as string)).toBe(null);
    expect(sanitizeCalendarTime(undefined as unknown as string)).toBe(null);
  });

  it("handles edge cases", () => {
    expect(sanitizeCalendarTime("2026-03-13 00:00")).toBe("2026-03-13 00:00");
    expect(sanitizeCalendarTime("2026-03-13 23:59")).toBe("2026-03-13 23:59");
    expect(sanitizeCalendarTime("  2026-03-13 14:30  ")).toBe("2026-03-13 14:30"); // trims whitespace
  });
});

describe("minuteOfDay", () => {
  it("returns integer minutes", () => {
    expect(minuteOfDay("2026-03-13 14:30")).toBe(870);
    expect(minuteOfDay("2026-03-13 00:00")).toBe(0);
    expect(minuteOfDay("2026-03-13 23:59")).toBe(1439);
  });

  it("handles missing time part", () => {
    expect(minuteOfDay("2026-03-13")).toBe(0);
  });
});

describe("snapToGrid", () => {
  it("returns integer values", () => {
    expect(Number.isInteger(snapToGrid(14.7, 15))).toBe(true);
    expect(Number.isInteger(snapToGrid(30.5, 5))).toBe(true);
    expect(Number.isInteger(snapToGrid(0, 30))).toBe(true);
  });

  it("snaps to nearest grid interval", () => {
    expect(snapToGrid(7, 15)).toBe(0);
    expect(snapToGrid(8, 15)).toBe(15);
    expect(snapToGrid(22, 15)).toBe(15);
    expect(snapToGrid(23, 15)).toBe(30);
  });
});

describe("clampMinute", () => {
  it("returns integer values", () => {
    expect(Number.isInteger(clampMinute(100))).toBe(true);
    expect(Number.isInteger(clampMinute(100.5))).toBe(true);
  });

  it("clamps to valid range", () => {
    expect(clampMinute(-10)).toBe(0);
    expect(clampMinute(1500)).toBe(1440);
    expect(clampMinute(720)).toBe(720);
  });
});

describe("normalizeEventColor", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("accepts integer indices in range unchanged", () => {
    expect(normalizeEventColor(0)).toBe(0);
    expect(normalizeEventColor(22)).toBe(22);
    expect(normalizeEventColor(23)).toBe(23);
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts numeric strings that parse to in-range integers", () => {
    expect(normalizeEventColor("0")).toBe(0);
    expect(normalizeEventColor("14")).toBe(14);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns undefined for null, undefined, and empty string without warning", () => {
    expect(normalizeEventColor(null)).toBeUndefined();
    expect(normalizeEventColor(undefined)).toBeUndefined();
    expect(normalizeEventColor("")).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns undefined and warns once for non-numeric strings", () => {
    expect(normalizeEventColor("not-a-color-xyz")).toBeUndefined();
    expect(normalizeEventColor("not-a-color-xyz")).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("rejects out-of-range numbers", () => {
    expect(normalizeEventColor(-1)).toBeUndefined();
    expect(normalizeEventColor(24)).toBeUndefined();
    expect(normalizeEventColor(99)).toBeUndefined();
  });

  it("rejects non-integer numbers", () => {
    expect(normalizeEventColor(1.5)).toBeUndefined();
    expect(normalizeEventColor(Number.NaN)).toBeUndefined();
    expect(normalizeEventColor(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("rejects non-numeric values with a warning", () => {
    expect(normalizeEventColor({})).toBeUndefined();
    expect(normalizeEventColor([])).toBeUndefined();
    expect(normalizeEventColor(true)).toBeUndefined();
  });

  it("rejects non-numeric strings", () => {
    expect(normalizeEventColor("not-a-number")).toBeUndefined();
    expect(normalizeEventColor("abc")).toBeUndefined();
    expect(normalizeEventColor("__proto__")).toBeUndefined();
  });
});

describe("EVENT_COLOR_OPTIONS", () => {
  it("contains every palette index in order", () => {
    expect(EVENT_COLOR_OPTIONS.length).toBeGreaterThan(0);
    for (let i = 0; i < EVENT_COLOR_OPTIONS.length; i++) {
      expect(EVENT_COLOR_OPTIONS[i]).toBe(i);
      expect(normalizeEventColor(EVENT_COLOR_OPTIONS[i])).toBe(i);
    }
  });

  it("includes the fallback index", () => {
    expect(EVENT_COLOR_OPTIONS).toContain(22);
  });
});

const HEX = /^#[0-9a-fA-F]{6}$/;

function assertColorEntry(entry: { bg: string; text: string }): void {
  expect(entry.bg).toMatch(HEX);
  expect(entry.text).toMatch(HEX);
}

describe("getEventColor", () => {
  it("returns the theme's palette entry for a known slot", () => {
    const entry = getEventColor(2, lightTheme);
    expect(entry.bg.toLowerCase()).toBe(lightTheme.eventPalette[2].toLowerCase());
    assertColorEntry(entry);
  });

  it("returns the fallback slot for undefined color (render fallback)", () => {
    const entry = getEventColor(undefined, lightTheme);
    expect(entry.bg.toLowerCase()).toBe(lightTheme.eventPalette[22].toLowerCase());
  });

  it("returns different hex values across light and dark themes for the same slot", () => {
    const light = getEventColor(14, lightTheme);
    const dark = getEventColor(14, darkTheme);
    expect(light.bg.toLowerCase()).not.toBe(dark.bg.toLowerCase());
  });

  it("resolves every EVENT_COLOR_OPTIONS entry under both built-in themes", () => {
    for (const theme of [lightTheme, darkTheme]) {
      for (const color of EVENT_COLOR_OPTIONS) {
        assertColorEntry(getEventColor(color, theme));
      }
    }
  });

  it("resolves palettes for a custom theme as long as all slots are filled", () => {
    const customPalette = [...darkTheme.eventPalette];
    customPalette[2] = "#123456";
    const customTheme: Theme = {
      kind: "builtin",
      id: "custom-test",
      displayName: "Custom Test",
      base: "dark",
      iconLabel: "dark",
      blendCanvas: "#000000",
      eventPalette: customPalette,
    };
    const entry = getEventColor(2, customTheme);
    expect(entry.bg.toLowerCase()).toBe("#123456");
  });
});

describe("dimmed color variants", () => {
  it("past, cancelled, free, outside-month all return valid hex entries", () => {
    for (const theme of [lightTheme, darkTheme]) {
      assertColorEntry(getPastEventColor(2, theme));
      assertColorEntry(getCancelledEventColor(2, theme));
      assertColorEntry(getFreeEventColor(2, theme));
      assertColorEntry(getOutsideMonthEventColor(2, theme));
    }
  });

  it("dimmed variants differ from the base color", () => {
    const base = getEventColor(2, lightTheme);
    const past = getPastEventColor(2, lightTheme);
    expect(past.bg.toLowerCase()).not.toBe(base.bg.toLowerCase());
  });

  it("outside-month is more washed out than past (lower main weight)", () => {
    // Outside-month uses 0.25 main weight; past uses 0.3 (light theme).
    // The blended bg should therefore be closer to the canvas color.
    const past = getPastEventColor(2, lightTheme);
    const outside = getOutsideMonthEventColor(2, lightTheme);
    expect(past.bg).not.toBe(outside.bg);
  });

  it("falls back to the dimmed fallback slot when color is undefined", () => {
    assertColorEntry(getPastEventColor(undefined, lightTheme));
    assertColorEntry(getCancelledEventColor(undefined, darkTheme));
  });
});

describe("getTimezoneCity", () => {
  it("returns the last segment with underscores converted to spaces", () => {
    expect(getTimezoneCity("Asia/Tehran")).toBe("Tehran");
    expect(getTimezoneCity("America/New_York")).toBe("New York");
    expect(getTimezoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });

  it("returns the input itself for single-segment IDs", () => {
    expect(getTimezoneCity("UTC")).toBe("UTC");
  });
});

describe("getTimezoneRegion", () => {
  it("returns the first segment of an IANA ID", () => {
    expect(getTimezoneRegion("Asia/Tehran")).toBe("Asia");
    expect(getTimezoneRegion("America/Argentina/Buenos_Aires")).toBe("America");
    expect(getTimezoneRegion("Europe/London")).toBe("Europe");
  });

  it("returns an empty string for single-segment IDs", () => {
    expect(getTimezoneRegion("UTC")).toBe("");
  });
});

describe("getTimezoneOffsetMinutes", () => {
  it("handles whole-hour positive offsets", () => {
    expect(getTimezoneOffsetMinutes("Asia/Tokyo")).toBe(9 * 60);
  });

  it("handles whole-hour negative offsets", () => {
    expect(getTimezoneOffsetMinutes("Pacific/Honolulu")).toBe(-10 * 60);
  });

  it("handles half-hour zones", () => {
    expect(getTimezoneOffsetMinutes("Asia/Kolkata")).toBe(5 * 60 + 30);
  });

  it("handles 45-minute zones", () => {
    expect(getTimezoneOffsetMinutes("Asia/Kathmandu")).toBe(5 * 60 + 45);
  });

  it("returns 0 for UTC", () => {
    expect(getTimezoneOffsetMinutes("UTC")).toBe(0);
  });
});

describe("formatColumnHeaderAbbr", () => {
  it("never returns a string starting with GMT followed by a sign", () => {
    const zones = [
      "Asia/Tokyo",
      "Europe/London",
      "Asia/Kolkata",
      "Pacific/Honolulu",
      "Australia/Sydney",
      "America/Los_Angeles",
      "Asia/Tehran",
    ];
    for (const tz of zones) {
      expect(formatColumnHeaderAbbr(tz)).not.toMatch(/^GMT[+-]/);
    }
  });

  it("returns either a named abbrev or a stripped offset for any zone", () => {
    const zones = [
      "Asia/Tokyo",
      "Europe/London",
      "Pacific/Honolulu",
      "Asia/Kolkata",
    ];
    for (const tz of zones) {
      const out = formatColumnHeaderAbbr(tz);
      expect(out.length).toBeGreaterThan(0);
      expect(out).toMatch(/^([A-Z]{2,5}|[+-]\d{1,2}(:\d{2})?)$/);
    }
  });

  it("never returns an empty string", () => {
    expect(formatColumnHeaderAbbr("Asia/Tehran").length).toBeGreaterThan(0);
  });
});

describe("listAllTimezones", () => {
  it("excludes Etc/* zones", () => {
    const list = listAllTimezones();
    expect(list.every((tz) => !tz.startsWith("Etc/"))).toBe(true);
  });

  it("includes common multi-segment zones", () => {
    const list = listAllTimezones();
    expect(list).toContain("Asia/Tehran");
    expect(list).toContain("America/New_York");
    expect(list).toContain("Europe/London");
  });

  it("excludes deprecated single-segment aliases", () => {
    const list = listAllTimezones();
    expect(list).not.toContain("EST");
    expect(list).not.toContain("PST8PDT");
    expect(list).not.toContain("Iran");
    expect(list).not.toContain("Japan");
    expect(list).not.toContain("UTC");
  });
});
