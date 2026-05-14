import { describe, it, expect } from "vitest";
import type { CalendarEvent } from "./types";
import { expandRecurring, findOrdinalWeekday, fmtYMD, parseYMD } from "./recurrence";

// A window wide enough to keep most legacy assertions intact while still
// exercising the new windowed signature. Tests that probe window boundaries
// pass explicit dates instead.
const TEST_WINDOW_START = Temporal.PlainDate.from("2025-01-01");
const TEST_WINDOW_END = Temporal.PlainDate.from("2028-12-31");

function expand(
  events: CalendarEvent[],
  start: Temporal.PlainDate = TEST_WINDOW_START,
  end: Temporal.PlainDate = TEST_WINDOW_END,
): CalendarEvent[] {
  return expandRecurring(events, start, end);
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    title: "Test",
    start: "2026-03-15 09:00",
    end: "2026-03-15 10:00",
    timezone: "UTC",
    calendarId: "local",
    ...overrides,
  };
}

function collectDates(events: CalendarEvent[]): string[] {
  return events.map((e) => e.start.split(" ")[0]).sort();
}

describe("parseYMD and fmtYMD", () => {
  it("round-trips a date string", () => {
    expect(fmtYMD(parseYMD("2026-03-15"))).toBe("2026-03-15");
  });

  it("handles year boundaries", () => {
    expect(fmtYMD(parseYMD("2026-01-01"))).toBe("2026-01-01");
    expect(fmtYMD(parseYMD("2025-12-31"))).toBe("2025-12-31");
  });
});

describe("findOrdinalWeekday", () => {
  // March 2026: Sun=1, Mon=2, Tue=3, ..., Sat=7
  // 1st day is Sunday

  it("finds 1st Tuesday of March 2026", () => {
    // March 3, 2026 is the 1st Tuesday
    expect(findOrdinalWeekday(2026, 2, 2, 1)).toBe(3);
  });

  it("finds 2nd Tuesday of March 2026", () => {
    expect(findOrdinalWeekday(2026, 2, 2, 2)).toBe(10);
  });

  it("finds 3rd Tuesday of March 2026", () => {
    expect(findOrdinalWeekday(2026, 2, 2, 3)).toBe(17);
  });

  it("finds last Friday of March 2026", () => {
    // March 27, 2026 is the last Friday
    expect(findOrdinalWeekday(2026, 2, 5, -1)).toBe(27);
  });

  it("finds last Monday of February 2026", () => {
    // Feb 2026 has 28 days, Feb 23 is last Monday
    expect(findOrdinalWeekday(2026, 1, 1, -1)).toBe(23);
  });

  it("returns null for 5th occurrence when only 4 exist", () => {
    // April 2026 has 4 Tuesdays (7, 14, 21, 28)
    expect(findOrdinalWeekday(2026, 3, 2, 5)).toBeNull();
  });

  it("returns null for ordinal 0", () => {
    expect(findOrdinalWeekday(2026, 2, 2, 0)).toBeNull();
  });

  it("finds 1st Sunday of March 2026", () => {
    expect(findOrdinalWeekday(2026, 2, 0, 1)).toBe(1);
  });
});

describe("expandRecurring - backward compatibility", () => {
  it("expands simple daily recurrence", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 3 } },
    });
    const result = expand([evt]);
    expect(result).toHaveLength(3);
    const dates = collectDates(result);
    expect(dates).toEqual(["2026-03-15", "2026-03-16", "2026-03-17"]);
  });

  it("expands simple weekly recurrence", () => {
    const evt = makeEvent({
      recurrence: { frequency: "weekly", interval: 1, end: { type: "count", count: 3 } },
    });
    const result = expand([evt]);
    expect(result).toHaveLength(3);
    const dates = collectDates(result);
    expect(dates).toEqual(["2026-03-15", "2026-03-22", "2026-03-29"]);
  });

  it("expands weekly with specific weekdays", () => {
    const evt = makeEvent({
      start: "2026-03-16 09:00", // Monday
      end: "2026-03-16 10:00",
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["MO", "WE", "FR"],
        end: { type: "count", count: 6 },
      },
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    expect(dates).toEqual([
      "2026-03-16", // Mon
      "2026-03-18", // Wed
      "2026-03-20", // Fri
      "2026-03-23", // Mon
      "2026-03-25", // Wed
      "2026-03-27", // Fri
    ]);
  });

  it("respects exceptions", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 5 } },
      exceptions: ["2026-03-17"],
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    expect(dates).not.toContain("2026-03-17");
    // Exceptions skip dates but don't count against COUNT, so the engine
    // continues generating to fill the count with non-excluded dates
    expect(result).toHaveLength(5);
  });

  it("skips template when its start is in exceptions", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 3 } },
      exceptions: ["2026-03-15"],
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    expect(dates).not.toContain("2026-03-15");
    expect(result).toHaveLength(2);
  });

  it("sets recurringParentId on generated instances", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 2 } },
    });
    const result = expand([evt]);
    // First is the template itself, no recurringParentId
    expect(result[0].recurringParentId).toBeUndefined();
    // Second is generated
    expect(result[1].recurringParentId).toBe("evt-1");
    expect(result[1].id).toBe("evt-1::2026-03-16");
  });

  it("preserves multi-day span on instances", () => {
    const evt = makeEvent({
      start: "2026-03-15 09:00",
      end: "2026-03-17 10:00", // 2-day event
      recurrence: { frequency: "weekly", interval: 1, end: { type: "count", count: 2 } },
    });
    const result = expand([evt]);
    expect(result[1].start).toBe("2026-03-22 09:00");
    expect(result[1].end).toBe("2026-03-24 10:00");
  });

  it("includes non-recurring events as-is", () => {
    const evt = makeEvent();
    const result = expand([evt]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(evt);
  });
});

describe("expandRecurring - UNTIL", () => {
  it("stops at UNTIL date", () => {
    const evt = makeEvent({
      recurrence: {
        frequency: "daily",
        interval: 1,
        end: { type: "until", date: "2026-03-18" },
      },
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    expect(dates).toEqual(["2026-03-15", "2026-03-16", "2026-03-17", "2026-03-18"]);
  });

  it("stops at UNTIL datetime", () => {
    const evt = makeEvent({
      recurrence: {
        frequency: "daily",
        interval: 1,
        end: { type: "until", date: "2026-03-17T23:59:59Z" },
      },
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    expect(dates).toContain("2026-03-17");
    expect(dates).not.toContain("2026-03-18");
  });

  it("excludes event when start is past UNTIL", () => {
    const evt = makeEvent({
      start: "2026-03-20 09:00",
      end: "2026-03-20 10:00",
      recurrence: {
        frequency: "daily",
        interval: 1,
        end: { type: "until", date: "2026-03-18" },
      },
    });
    const result = expand([evt]);
    expect(result).toHaveLength(0);
  });
});

describe("expandRecurring - monthly ordinal BYDAY", () => {
  it("expands 2nd Tuesday monthly", () => {
    const evt = makeEvent({
      start: "2026-03-10 09:00", // 2nd Tue of March 2026
      end: "2026-03-10 10:00",
      recurrence: {
        frequency: "monthly",
        interval: 1,
        ordinalWeekdays: [{ day: "TU", ordinal: 2 }],
        end: { type: "count", count: 3 },
      },
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    // Mar 10, Apr 14, May 12 are 2nd Tuesdays
    expect(dates).toEqual(["2026-03-10", "2026-04-14", "2026-05-12"]);
  });

  it("expands last Friday monthly", () => {
    const evt = makeEvent({
      start: "2026-03-27 09:00", // Last Fri of March 2026
      end: "2026-03-27 10:00",
      recurrence: {
        frequency: "monthly",
        interval: 1,
        ordinalWeekdays: [{ day: "FR", ordinal: -1 }],
        end: { type: "count", count: 3 },
      },
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    // Mar 27, Apr 24, May 29 are last Fridays
    expect(dates).toEqual(["2026-03-27", "2026-04-24", "2026-05-29"]);
  });
});

describe("expandRecurring - monthly BYMONTHDAY", () => {
  it("expands on the 15th of every month", () => {
    const evt = makeEvent({
      start: "2026-03-15 09:00",
      end: "2026-03-15 10:00",
      recurrence: {
        frequency: "monthly",
        interval: 1,
        byMonthDay: [15],
        end: { type: "count", count: 3 },
      },
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    expect(dates).toEqual(["2026-03-15", "2026-04-15", "2026-05-15"]);
  });

  it("handles BYMONTHDAY=31 with short months", () => {
    const evt = makeEvent({
      start: "2026-01-31 09:00",
      end: "2026-01-31 10:00",
      recurrence: {
        frequency: "monthly",
        interval: 1,
        byMonthDay: [31],
        end: { type: "count", count: 4 },
      },
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    // Jan 31, Mar 31, May 31, Jul 31 (skips Feb 28, Apr 30, Jun 30)
    expect(dates).toEqual(["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"]);
  });

  it("handles multiple BYMONTHDAY values", () => {
    const evt = makeEvent({
      start: "2026-03-01 09:00",
      end: "2026-03-01 10:00",
      recurrence: {
        frequency: "monthly",
        interval: 1,
        byMonthDay: [1, 15],
        end: { type: "count", count: 5 },
      },
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    expect(dates).toEqual([
      "2026-03-01",
      "2026-03-15",
      "2026-04-01",
      "2026-04-15",
      "2026-05-01",
    ]);
  });
});

describe("expandRecurring - yearly ordinal BYDAY", () => {
  it("expands 1st Monday of multiple months yearly", () => {
    const evt = makeEvent({
      // 1st Monday of April 2026 is April 6
      start: "2026-04-06 09:00",
      end: "2026-04-06 10:00",
      recurrence: {
        frequency: "yearly",
        interval: 1,
        ordinalWeekdays: [{ day: "MO", ordinal: 1 }],
        byMonth: [4, 7], // April and July
        end: { type: "count", count: 3 },
      },
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    // 1st Mon of Apr 2026 is Apr 6, of Jul 2026 is Jul 6, of Apr 2027 is Apr 5.
    // The default test window (2025..2028) captures all three for COUNT=3.
    expect(dates).toEqual(["2026-04-06", "2026-07-06", "2027-04-05"]);
  });
});

describe("expandRecurring - RDATE", () => {
  it("adds RDATE instances to recurring event", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 2 } },
      rdate: ["2026-04-01"],
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    expect(dates).toContain("2026-03-15");
    expect(dates).toContain("2026-03-16");
    expect(dates).toContain("2026-04-01");
    expect(result).toHaveLength(3);
  });

  it("deduplicates RDATE that overlaps RRULE instance", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 3 } },
      rdate: ["2026-03-16"], // already generated by RRULE
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    const march16Count = dates.filter((d) => d === "2026-03-16").length;
    expect(march16Count).toBe(1);
  });

  it("respects exceptions on RDATE instances", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 2 } },
      rdate: ["2026-04-01"],
      exceptions: ["2026-04-01"],
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    expect(dates).not.toContain("2026-04-01");
  });

  it("adds RDATE to non-recurring event", () => {
    const evt = makeEvent({
      rdate: ["2026-04-01", "2026-05-01"],
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    expect(dates).toContain("2026-03-15"); // original
    expect(dates).toContain("2026-04-01");
    expect(dates).toContain("2026-05-01");
    expect(result).toHaveLength(3);
  });

  it("RDATE instances have recurringParentId", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 2 } },
      rdate: ["2026-04-01"],
    });
    const result = expand([evt]);
    const rdateInstance = result.find((e) => e.start.startsWith("2026-04-01"));
    expect(rdateInstance).toBeDefined();
    expect(rdateInstance!.recurringParentId).toBe("evt-1");
    expect(rdateInstance!.id).toBe("evt-1::2026-04-01");
  });
});

describe("expandRecurring - overrides", () => {
  it("merges override fields into generated instance", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 3 } },
      overrides: [
        {
          id: "ovr-1",
          parentEventId: "evt-1",
          recurrenceId: "2026-03-16",
          title: "Changed title",
        },
      ],
    });
    const result = expand([evt]);
    const march16 = result.find((e) => e.start.startsWith("2026-03-16"));
    expect(march16).toBeDefined();
    expect(march16!.title).toBe("Changed title");
  });

  it("preserves non-overridden fields", () => {
    const evt = makeEvent({
      title: "Original",
      description: "Description",
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 2 } },
      overrides: [
        {
          id: "ovr-1",
          parentEventId: "evt-1",
          recurrenceId: "2026-03-16",
          title: "New title",
        },
      ],
    });
    const result = expand([evt]);
    const march16 = result.find((e) => e.start.startsWith("2026-03-16"));
    expect(march16!.title).toBe("New title");
    expect(march16!.description).toBe("Description");
  });

  it("applies override to RDATE instance", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 2 } },
      rdate: ["2026-04-01"],
      overrides: [
        {
          id: "ovr-1",
          parentEventId: "evt-1",
          recurrenceId: "2026-04-01",
          title: "RDATE override",
        },
      ],
    });
    const result = expand([evt]);
    const april1 = result.find((e) => e.start.startsWith("2026-04-01"));
    expect(april1).toBeDefined();
    expect(april1!.title).toBe("RDATE override");
  });

  it("handles override with datetime recurrenceId", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 2 } },
      overrides: [
        {
          id: "ovr-1",
          parentEventId: "evt-1",
          recurrenceId: "2026-03-16 09:00",
          title: "Datetime override",
        },
      ],
    });
    const result = expand([evt]);
    const march16 = result.find((e) => e.start.startsWith("2026-03-16"));
    expect(march16!.title).toBe("Datetime override");
  });

  it("override can change color and status", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 2 } },
      overrides: [
        {
          id: "ovr-1",
          parentEventId: "evt-1",
          recurrenceId: "2026-03-16",
          color: 2,
          status: "tentative",
        },
      ],
    });
    const result = expand([evt]);
    const march16 = result.find((e) => e.start.startsWith("2026-03-16"));
    expect(march16!.color).toBe(2);
    expect(march16!.status).toBe("tentative");
  });
});

describe("expandRecurring - exceptions + overrides together", () => {
  it("exception takes precedence over override", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 3 } },
      exceptions: ["2026-03-16"],
      overrides: [
        {
          id: "ovr-1",
          parentEventId: "evt-1",
          recurrenceId: "2026-03-16",
          title: "Should not appear",
        },
      ],
    });
    const result = expand([evt]);
    const dates = collectDates(result);
    expect(dates).not.toContain("2026-03-16");
  });
});

describe("expandRecurring - events without new fields", () => {
  it("events with no new fields expand identically to simple recurrence", () => {
    const evt = makeEvent({
      recurrence: {
        frequency: "weekly",
        interval: 2,
        weekdays: ["MO", "FR"],
        end: { type: "count", count: 4 },
      },
    });
    const result = expand([evt]);
    // All instances should have the basic properties
    for (const instance of result) {
      expect(instance.overrides).toBeUndefined();
      expect(instance.rdate).toBeUndefined();
      expect(instance.start).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    }
  });
});

describe("expandRecurring - DST anchoring", () => {
  // 2026 spring-forward in America/New_York is on March 8 at 02:00 local.
  // A daily 09:00 event must keep its 09:00 wall clock in the home zone.
  // Date arithmetic on Temporal.PlainDate is zone-free, so day-counting
  // never slips by one across DST. The wall-clock string is reattached
  // verbatim, so 09:00 stays 09:00.
  it("preserves 09:00 wall clock through US spring-forward (Mar 7 to Mar 9)", () => {
    const evt = makeEvent({
      timezone: "America/New_York",
      start: "2026-03-07 09:00",
      end: "2026-03-07 10:00",
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 4 } },
    });
    const result = expand([evt]);
    expect(result.map((e) => e.start)).toEqual([
      "2026-03-07 09:00",
      "2026-03-08 09:00",
      "2026-03-09 09:00",
      "2026-03-10 09:00",
    ]);
    expect(result.map((e) => e.end)).toEqual([
      "2026-03-07 10:00",
      "2026-03-08 10:00",
      "2026-03-09 10:00",
      "2026-03-10 10:00",
    ]);
  });

  it("preserves 18:30 wall clock for half-hour zone (Asia/Kolkata, weekly)", () => {
    const evt = makeEvent({
      timezone: "Asia/Kolkata",
      start: "2026-03-15 18:30",
      end: "2026-03-15 19:30",
      recurrence: { frequency: "weekly", interval: 1, end: { type: "count", count: 3 } },
    });
    const result = expand([evt]);
    expect(result.map((e) => e.start)).toEqual([
      "2026-03-15 18:30",
      "2026-03-22 18:30",
      "2026-03-29 18:30",
    ]);
  });

  it("walks BYDAY in the home zone through spring-forward without skipping", () => {
    // Weekly on TU/TH starting Tue 2026-03-03; DST kicks in Mar 8 (Sun).
    const evt = makeEvent({
      timezone: "America/New_York",
      start: "2026-03-03 09:00", // Tuesday
      end: "2026-03-03 10:00",
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["TU", "TH"],
        end: { type: "count", count: 4 },
      },
    });
    const result = expand([evt]);
    expect(collectDates(result)).toEqual([
      "2026-03-03", // Tue
      "2026-03-05", // Thu
      "2026-03-10", // Tue (after DST)
      "2026-03-12", // Thu
    ]);
    for (const inst of result) {
      expect(inst.start.endsWith("09:00")).toBe(true);
    }
  });
});

describe("expandRecurring - window scoping", () => {
  it("emits only instances overlapping the window for an indefinite recurrence", () => {
    const evt = makeEvent({
      start: "2020-01-01 09:00",
      end: "2020-01-01 10:00",
      recurrence: { frequency: "weekly", interval: 1, end: { type: "never" } },
    });
    const start = Temporal.PlainDate.from("2026-04-27");
    const end = Temporal.PlainDate.from("2026-05-03");
    const result = expandRecurring([evt], start, end);
    const dates = collectDates(result);
    // Original was a Wednesday; weekly cadence places one instance every
    // Wednesday inside the week. There is exactly one Wednesday in this
    // 7-day range: 2026-04-29.
    expect(dates).toEqual(["2026-04-29"]);
  });

  it("emits indefinite recurrences far in the future when the window asks for them", () => {
    const evt = makeEvent({
      start: "2026-01-01 09:00",
      end: "2026-01-01 10:00",
      recurrence: { frequency: "monthly", interval: 1, end: { type: "never" } },
    });
    const start = Temporal.PlainDate.from("2030-01-01");
    const end = Temporal.PlainDate.from("2030-12-31");
    const result = expandRecurring([evt], start, end);
    const dates = collectDates(result);
    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe("2030-01-01");
    expect(dates[11]).toBe("2030-12-01");
  });

  it("returns nothing when the window is entirely before the first occurrence", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 3 } },
    });
    const start = Temporal.PlainDate.from("2020-01-01");
    const end = Temporal.PlainDate.from("2020-12-31");
    expect(expandRecurring([evt], start, end)).toHaveLength(0);
  });

  it("respects COUNT even when most occurrences are before the window", () => {
    const evt = makeEvent({
      start: "2026-03-15 09:00",
      end: "2026-03-15 10:00",
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 5 } },
    });
    const start = Temporal.PlainDate.from("2026-03-18");
    const end = Temporal.PlainDate.from("2030-01-01");
    const result = expandRecurring([evt], start, end);
    const dates = collectDates(result);
    // COUNT=5 means 5 instances ever exist (15..19). The window starts on
    // the 18th, so only 18 and 19 should be emitted.
    expect(dates).toEqual(["2026-03-18", "2026-03-19"]);
  });

  it("includes a multi-day occurrence whose start is before the window if it ends inside", () => {
    const evt = makeEvent({
      start: "2026-04-25 09:00",
      end: "2026-04-30 10:00", // 5-day event
      recurrence: { frequency: "weekly", interval: 1, end: { type: "count", count: 3 } },
    });
    const start = Temporal.PlainDate.from("2026-04-28");
    const end = Temporal.PlainDate.from("2026-05-02");
    const result = expandRecurring([evt], start, end);
    // Original event (Apr 25..30) overlaps the window even though its start
    // is before windowStart.
    const dates = collectDates(result);
    expect(dates).toContain("2026-04-25");
  });

  it("non-recurring events outside the window are excluded", () => {
    const inWindow = makeEvent({ id: "in", start: "2026-04-29 09:00", end: "2026-04-29 10:00" });
    const past = makeEvent({ id: "past", start: "2020-01-01 09:00", end: "2020-01-01 10:00" });
    const future = makeEvent({ id: "future", start: "2030-01-01 09:00", end: "2030-01-01 10:00" });
    const start = Temporal.PlainDate.from("2026-04-01");
    const end = Temporal.PlainDate.from("2026-04-30");
    const result = expandRecurring([inWindow, past, future], start, end);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("in");
  });

  it("RDATEs outside the window are dropped, RDATEs inside the window are kept", () => {
    const evt = makeEvent({
      start: "2026-04-01 09:00",
      end: "2026-04-01 10:00",
      rdate: ["2026-04-15", "2030-01-01"],
    });
    const start = Temporal.PlainDate.from("2026-04-01");
    const end = Temporal.PlainDate.from("2026-04-30");
    const result = expandRecurring([evt], start, end);
    const dates = collectDates(result);
    expect(dates).toContain("2026-04-15");
    expect(dates).not.toContain("2030-01-01");
  });
});

describe("expandRecurring - fast-forward correctness (origin years before window)", () => {
  it("daily: emits the first in-window instance with correct id and ::date suffix", () => {
    const evt = makeEvent({
      start: "2020-01-01 09:00",
      end: "2020-01-01 10:00",
      recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
    });
    const start = Temporal.PlainDate.from("2026-04-29");
    const end = Temporal.PlainDate.from("2026-05-05");
    const result = expandRecurring([evt], start, end);
    expect(collectDates(result)).toEqual([
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
    ]);
    expect(result[0].id).toBe("evt-1::2026-04-29");
    expect(result[0].recurringParentId).toBe("evt-1");
  });

  it("daily with interval=3: emits only valid stride dates inside the window", () => {
    const evt = makeEvent({
      start: "2020-01-01 09:00",
      end: "2020-01-01 10:00",
      recurrence: { frequency: "daily", interval: 3, end: { type: "never" } },
    });
    const start = Temporal.PlainDate.from("2026-04-29");
    const end = Temporal.PlainDate.from("2026-05-05");
    const result = expandRecurring([evt], start, end);
    // 2020-01-01 + N*3 days. Find the first such date >= 2026-04-29.
    // (2026-04-29 - 2020-01-01) = 2310 days. ceil(2310/3) = 770 → +2310 days = 2026-04-29.
    expect(collectDates(result)).toEqual(["2026-04-29", "2026-05-02", "2026-05-05"]);
  });

  it("weekly without BYDAY: jumps to the same dayOfWeek inside the window", () => {
    const evt = makeEvent({
      start: "2020-01-01 09:00", // Wednesday
      end: "2020-01-01 10:00",
      recurrence: { frequency: "weekly", interval: 1, end: { type: "never" } },
    });
    const start = Temporal.PlainDate.from("2026-04-27");
    const end = Temporal.PlainDate.from("2026-05-03");
    const result = expandRecurring([evt], start, end);
    expect(collectDates(result)).toEqual(["2026-04-29"]); // Wed 2026-04-29
  });

  it("weekly interval=2: lands on the correct biweekly Wednesday", () => {
    const evt = makeEvent({
      start: "2020-01-01 09:00", // Wednesday
      end: "2020-01-01 10:00",
      recurrence: { frequency: "weekly", interval: 2, end: { type: "never" } },
    });
    // 2026-04-29 is 2310 days after 2020-01-01. 2310 / 14 = 165.0 exactly,
    // so the biweekly cadence lands on 2026-04-29.
    const start = Temporal.PlainDate.from("2026-04-27");
    const end = Temporal.PlainDate.from("2026-05-10");
    const result = expandRecurring([evt], start, end);
    expect(collectDates(result)).toEqual(["2026-04-29"]);
  });

  it("monthly with safe day-of-month: jumps to first in-window month", () => {
    const evt = makeEvent({
      start: "2020-01-15 09:00",
      end: "2020-01-15 10:00",
      recurrence: { frequency: "monthly", interval: 1, end: { type: "never" } },
    });
    const start = Temporal.PlainDate.from("2026-04-01");
    const end = Temporal.PlainDate.from("2026-04-30");
    const result = expandRecurring([evt], start, end);
    expect(collectDates(result)).toEqual(["2026-04-15"]);
  });

  it("yearly: jumps to first in-window year", () => {
    const evt = makeEvent({
      start: "2010-06-15 09:00",
      end: "2010-06-15 10:00",
      recurrence: { frequency: "yearly", interval: 1, end: { type: "never" } },
    });
    const start = Temporal.PlainDate.from("2026-01-01");
    const end = Temporal.PlainDate.from("2026-12-31");
    const result = expandRecurring([evt], start, end);
    expect(collectDates(result)).toEqual(["2026-06-15"]);
  });

  it("daily with COUNT exhausted before window: emits nothing", () => {
    const evt = makeEvent({
      start: "2020-01-01 09:00",
      end: "2020-01-01 10:00",
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 100 } },
    });
    const start = Temporal.PlainDate.from("2026-04-29");
    const end = Temporal.PlainDate.from("2026-05-05");
    expect(expandRecurring([evt], start, end)).toHaveLength(0);
  });

  it("daily with COUNT straddling window start: emits remaining instances", () => {
    // origin 2026-04-25, COUNT=10 → instances 2026-04-25..2026-05-04
    const evt = makeEvent({
      start: "2026-04-25 09:00",
      end: "2026-04-25 10:00",
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 10 } },
    });
    const start = Temporal.PlainDate.from("2026-04-29");
    const end = Temporal.PlainDate.from("2026-05-10");
    const result = expandRecurring([evt], start, end);
    expect(collectDates(result)).toEqual([
      "2026-04-29",
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
      "2026-05-04",
    ]);
  });

  it("daily with UNTIL exhausted before window: emits nothing", () => {
    const evt = makeEvent({
      start: "2020-01-01 09:00",
      end: "2020-01-01 10:00",
      recurrence: { frequency: "daily", interval: 1, end: { type: "until", date: "2025-12-31" } },
    });
    const start = Temporal.PlainDate.from("2026-04-29");
    const end = Temporal.PlainDate.from("2026-05-05");
    expect(expandRecurring([evt], start, end)).toHaveLength(0);
  });

  it("daily honors EXDATE on the first in-window instance", () => {
    const evt = makeEvent({
      start: "2020-01-01 09:00",
      end: "2020-01-01 10:00",
      recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
      exceptions: ["2026-04-29"],
    });
    const start = Temporal.PlainDate.from("2026-04-29");
    const end = Temporal.PlainDate.from("2026-05-01");
    const result = expandRecurring([evt], start, end);
    expect(collectDates(result)).toEqual(["2026-04-30", "2026-05-01"]);
  });

  it("daily honors RDATE inside the window without duplicating the recurring instance", () => {
    const evt = makeEvent({
      start: "2020-01-01 09:00",
      end: "2020-01-01 10:00",
      recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
      rdate: ["2026-04-30"], // also generated by RRULE on this date
    });
    const start = Temporal.PlainDate.from("2026-04-29");
    const end = Temporal.PlainDate.from("2026-05-01");
    const result = expandRecurring([evt], start, end);
    const apr30 = result.filter((e) => e.start.startsWith("2026-04-30"));
    expect(apr30).toHaveLength(1);
  });

  it("monthly day=31: falls back to iterative path (skip-fast-forward path)", () => {
    // Day-31 origins drift under all-at-once month addition. The fast-forward
    // helper bails on origDay > 28 so behavior matches the iterative loop.
    const evt = makeEvent({
      start: "2020-01-31 09:00",
      end: "2020-01-31 10:00",
      recurrence: { frequency: "monthly", interval: 1, end: { type: "never" } },
    });
    const start = Temporal.PlainDate.from("2026-04-01");
    const end = Temporal.PlainDate.from("2026-04-30");
    const result = expandRecurring([evt], start, end);
    // Iterative drift over 6+ years lands somewhere on the late days of
    // months without a 31st. Just assert one instance is emitted in April.
    expect(result).toHaveLength(1);
    expect(result[0].start.startsWith("2026-04")).toBe(true);
  });

  it("yearly Feb 29 origin: falls back to iterative path", () => {
    const evt = makeEvent({
      start: "2020-02-29 09:00",
      end: "2020-02-29 10:00",
      recurrence: { frequency: "yearly", interval: 1, end: { type: "never" } },
    });
    const start = Temporal.PlainDate.from("2026-01-01");
    const end = Temporal.PlainDate.from("2026-12-31");
    const result = expandRecurring([evt], start, end);
    // 2026 is non-leap; iterative add({years:1}) constrains to Feb 28.
    expect(result).toHaveLength(1);
    expect(result[0].start.startsWith("2026-02-")).toBe(true);
  });
});

describe("expandRecurring - weekly BYDAY fast-forward", () => {
  it("origin years ago, MO/WE/FR: emits the right MO/WE/FR inside the window", () => {
    // 2020-01-06 is a Monday. Recurrence: every Mon, Wed, Fri.
    const evt = makeEvent({
      start: "2020-01-06 09:00",
      end: "2020-01-06 10:00",
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["MO", "WE", "FR"],
        end: { type: "never" },
      },
    });
    const start = Temporal.PlainDate.from("2026-04-27"); // Monday
    const end = Temporal.PlainDate.from("2026-05-03"); // Sunday
    const result = expandRecurring([evt], start, end);
    expect(collectDates(result)).toEqual([
      "2026-04-27", // Mon
      "2026-04-29", // Wed
      "2026-05-01", // Fri
    ]);
  });

  it("origin on Wednesday, sortedDays MO/WE/FR: handles k0 != 0", () => {
    // 2020-01-08 is a Wednesday.
    const evt = makeEvent({
      start: "2020-01-08 09:00",
      end: "2020-01-08 10:00",
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["MO", "WE", "FR"],
        end: { type: "never" },
      },
    });
    const start = Temporal.PlainDate.from("2026-04-27");
    const end = Temporal.PlainDate.from("2026-05-03");
    const result = expandRecurring([evt], start, end);
    expect(collectDates(result)).toEqual([
      "2026-04-27",
      "2026-04-29",
      "2026-05-01",
    ]);
  });

  it("origin on Friday, sortedDays MO/WE/FR: only Fri remaining in origin's week", () => {
    // 2020-01-10 is a Friday.
    const evt = makeEvent({
      start: "2020-01-10 09:00",
      end: "2020-01-10 10:00",
      recurrence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["MO", "WE", "FR"],
        end: { type: "never" },
      },
    });
    const start = Temporal.PlainDate.from("2026-04-27");
    const end = Temporal.PlainDate.from("2026-05-03");
    const result = expandRecurring([evt], start, end);
    expect(collectDates(result)).toEqual([
      "2026-04-27",
      "2026-04-29",
      "2026-05-01",
    ]);
  });

  it("interval=2 weekly BYDAY: only emits in active weeks", () => {
    // Biweekly Mon/Wed starting 2020-01-06.
    // (2026-04-27 - 2020-01-06) = 2303 days = 329 weeks exactly + 0 days.
    // 329 / 2 = 164.5 → 2026-04-27 falls in an OFF week (week 329, odd).
    // Next active week starts 2026-05-04.
    const evt = makeEvent({
      start: "2020-01-06 09:00",
      end: "2020-01-06 10:00",
      recurrence: {
        frequency: "weekly",
        interval: 2,
        weekdays: ["MO", "WE"],
        end: { type: "never" },
      },
    });
    const start = Temporal.PlainDate.from("2026-04-27");
    const end = Temporal.PlainDate.from("2026-05-10");
    const result = expandRecurring([evt], start, end);
    expect(collectDates(result)).toEqual([
      "2026-05-04", // Mon, active week
      "2026-05-06", // Wed, active week
    ]);
  });

  it("matches iterative output for many random configurations", () => {
    // Cross-check fast-forward emission set against the same computation
    // performed with COUNT large enough to cover the window.
    const cases: Array<{ start: string; weekdays: ("MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU")[]; interval: number }> = [
      { start: "2020-01-06 09:00", weekdays: ["MO"], interval: 1 },
      { start: "2020-01-06 09:00", weekdays: ["MO", "TH"], interval: 1 },
      { start: "2020-01-08 09:00", weekdays: ["MO", "WE", "FR"], interval: 1 },
      { start: "2020-01-10 09:00", weekdays: ["TU", "FR"], interval: 2 },
      { start: "2020-01-06 09:00", weekdays: ["MO", "TU", "WE", "TH", "FR"], interval: 1 },
    ];
    const winStart = Temporal.PlainDate.from("2026-04-27");
    const winEnd = Temporal.PlainDate.from("2026-05-03");
    for (const c of cases) {
      const ff = makeEvent({
        start: c.start,
        end: c.start,
        recurrence: {
          frequency: "weekly",
          interval: c.interval,
          weekdays: c.weekdays,
          end: { type: "never" },
        },
      });
      const ffResult = collectDates(expandRecurring([ff], winStart, winEnd));
      // Manually derive expected: each weekday in the window that satisfies
      // the period parity from origin.
      const origPlain = Temporal.PlainDate.from(c.start.split(" ")[0]);
      const expected: string[] = [];
      for (let d = winStart; Temporal.PlainDate.compare(d, winEnd) <= 0; d = d.add({ days: 1 })) {
        const dow = d.dayOfWeek;
        const matchDay = c.weekdays.some((w) => {
          const target = w === "SU" ? 7 : ({ MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 } as const)[w];
          return target === dow;
        });
        if (!matchDay) continue;
        // Period parity: number of complete weeks between origin and d, modulo interval.
        // origin baseDay = Mon of origin's week.
        const origDow = origPlain.dayOfWeek;
        const origBase = origPlain.subtract({ days: origDow - 1 });
        const dBase = d.subtract({ days: dow - 1 });
        const weeksDiff = origBase.until(dBase, { largestUnit: "weeks" }).weeks;
        if (weeksDiff < 0) continue;
        if (weeksDiff % c.interval !== 0) continue;
        // For origin's own week (weeksDiff=0), only sortedDays >= origDow count.
        if (weeksDiff === 0 && dow < origDow) continue;
        expected.push(d.toString());
      }
      expect(ffResult.sort()).toEqual(expected.sort());
    }
  });
});
