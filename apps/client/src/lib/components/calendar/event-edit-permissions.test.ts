import { describe, expect, it } from "vitest";
import type { Calendar, CalendarEvent } from "./types";
import {
  getCalendarEventEditLock,
  hasCalendarEventEnded,
  isImportedCalendar,
} from "./event-edit-permissions";

const NOW = new Date("2026-05-26T12:00:00");

function calendar(patch: Partial<Calendar> = {}): Calendar {
  return {
    id: "local",
    name: "Local",
    color: "",
    source: "local",
    visible: true,
    readOnly: false,
    ...patch,
  };
}

function event(patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Focus",
    start: "2026-05-26 10:00",
    end: "2026-05-26 11:00",
    timezone: "UTC",
    calendarId: "local",
    ...patch,
  };
}

describe("calendar event edit permissions", () => {
  it("treats non-local calendars as imported", () => {
    expect(isImportedCalendar(calendar())).toBe(false);
    expect(isImportedCalendar(calendar({ id: "ics", source: "ics" }))).toBe(true);
  });

  it("uses the calendar date for all-day past detection", () => {
    expect(hasCalendarEventEnded(event({
      allDay: true,
      start: "2026-05-26 00:00",
      end: "2026-05-26 00:00",
    }), NOW)).toBe(false);

    expect(hasCalendarEventEnded(event({
      allDay: true,
      start: "2026-05-25 00:00",
      end: "2026-05-25 00:00",
    }), NOW)).toBe(true);
  });

  it("locks past imported events while allowing archive from the read-only panel", () => {
    const lock = getCalendarEventEditLock(
      event({ calendarId: "ics", end: "2026-05-25 11:00" }),
      [calendar({ id: "ics", source: "ics" })],
      { now: NOW },
    );

    expect(lock).toEqual({
      locked: true,
      reason: "past-imported",
      allowArchive: true,
    });
  });

  it("keeps future imported events editable", () => {
    const lock = getCalendarEventEditLock(
      event({ calendarId: "ics", start: "2026-05-27 10:00", end: "2026-05-27 11:00" }),
      [calendar({ id: "ics", source: "ics" })],
      { now: NOW },
    );

    expect(lock.locked).toBe(false);
  });

  it("locks read-only calendars before source-specific rules", () => {
    const lock = getCalendarEventEditLock(
      event({ calendarId: "ics", end: "2026-05-25 11:00" }),
      [calendar({ id: "ics", source: "ics", readOnly: true })],
      { now: NOW },
    );

    expect(lock).toEqual({
      locked: true,
      reason: "read-only-calendar",
      allowArchive: false,
    });
  });

  it("keeps the existing past pomodoro archive affordance for local events", () => {
    const lock = getCalendarEventEditLock(
      event({
        end: "2026-05-25 11:00",
        pomodoroConfig: {
          focusDurationMinutes: 25,
          shortBreakMinutes: 5,
          longBreakMinutes: 15,
          pomodoroCount: 4,
          idleTimeoutMinutes: null,
        },
      }),
      [calendar()],
      { now: NOW },
    );

    expect(lock).toEqual({
      locked: true,
      reason: "past-pomodoro",
      allowArchive: true,
    });
  });
});
