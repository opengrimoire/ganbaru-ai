import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "$lib/components/calendar/types";
import {
  buildCalendarEventMutationTarget,
  concreteRecurringOccurrenceForMutation,
  deleteActionForCalendarEvent,
} from "./calendar-mutations";

describe("calendar event mutation targets", () => {
  it("converts the first template occurrence to concrete synthetic identity", () => {
    const template: CalendarEvent = {
      id: "template-1",
      title: "Focus",
      start: "2026-05-23 09:00",
      end: "2026-05-23 10:00",
      timezone: "UTC",
      calendarId: "local",
      recurrence: {
        frequency: "daily",
        interval: 1,
        end: { type: "never" },
      },
    };

    const occurrence = concreteRecurringOccurrenceForMutation(template, template);

    expect(occurrence.id).toBe("template-1::2026-05-23");
    expect(occurrence.recurringParentId).toBe("template-1");
    expect(occurrence.recurrence).toBeUndefined();
    expect(buildCalendarEventMutationTarget(occurrence, template)).toEqual({
      id: "template-1::2026-05-23",
      occurrenceStart: "2026-05-23T09:00:00Z",
      occurrenceEnd: "2026-05-23T10:00:00Z",
    });
  });

  it("keeps synthetic occurrence identity and sends concrete timing", () => {
    const template: CalendarEvent = {
      id: "template-1",
      title: "Focus",
      start: "2026-05-23 09:00",
      end: "2026-05-23 10:00",
      timezone: "UTC",
      calendarId: "local",
    };
    const occurrence: CalendarEvent = {
      ...template,
      id: "template-1::2026-05-24",
      start: "2026-05-24 09:00",
      end: "2026-05-24 10:00",
      recurringParentId: "template-1",
    };

    expect(buildCalendarEventMutationTarget(occurrence, template)).toEqual({
      id: "template-1::2026-05-24",
      occurrenceStart: "2026-05-24T09:00:00Z",
      occurrenceEnd: "2026-05-24T10:00:00Z",
    });
  });

  it("uses archive for started events and delete for future events", () => {
    const now = new Date("2026-05-23T12:00:00");
    const started: CalendarEvent = {
      id: "past",
      title: "Past",
      start: "2026-05-23 11:00",
      end: "2026-05-23 12:00",
      timezone: "UTC",
      calendarId: "local",
    };
    const future: CalendarEvent = {
      id: "future",
      title: "Future",
      start: "2026-05-23 13:00",
      end: "2026-05-23 14:00",
      timezone: "UTC",
      calendarId: "local",
    };

    expect(deleteActionForCalendarEvent(started, now)).toBe("archive");
    expect(deleteActionForCalendarEvent(future, now)).toBe("delete");
  });
});
