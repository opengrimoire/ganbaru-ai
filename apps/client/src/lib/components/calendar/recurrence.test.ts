import { describe, it, expect } from "vitest";
import type { CalendarEvent, RecurrenceConfig } from "./types";
import { expandRecurring, findOrdinalWeekday, fmtYMD, parseYMD } from "./recurrence";

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
    const result = expandRecurring([evt]);
    expect(result).toHaveLength(3);
    const dates = collectDates(result);
    expect(dates).toEqual(["2026-03-15", "2026-03-16", "2026-03-17"]);
  });

  it("expands simple weekly recurrence", () => {
    const evt = makeEvent({
      recurrence: { frequency: "weekly", interval: 1, end: { type: "count", count: 3 } },
    });
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
    const dates = collectDates(result);
    expect(dates).not.toContain("2026-03-15");
    expect(result).toHaveLength(2);
  });

  it("sets recurringParentId on generated instances", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 2 } },
    });
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
    expect(result[1].start).toBe("2026-03-22 09:00");
    expect(result[1].end).toBe("2026-03-24 10:00");
  });

  it("includes non-recurring events as-is", () => {
    const evt = makeEvent();
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
    const dates = collectDates(result);
    // Apr 6 2026, Jul 6 2026 (1st Mon of Jul), then Apr 5 2027 (beyond horizon)
    // Only first two are within the 180-day horizon from ~Mar 27 2026
    expect(dates).toContain("2026-04-06");
    expect(dates).toContain("2026-07-06");
    expect(dates.length).toBeGreaterThanOrEqual(2);
  });
});

describe("expandRecurring - RDATE", () => {
  it("adds RDATE instances to recurring event", () => {
    const evt = makeEvent({
      recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 2 } },
      rdate: ["2026-04-01"],
    });
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
    const dates = collectDates(result);
    expect(dates).not.toContain("2026-04-01");
  });

  it("adds RDATE to non-recurring event", () => {
    const evt = makeEvent({
      rdate: ["2026-04-01", "2026-05-01"],
    });
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
    const result = expandRecurring([evt]);
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
