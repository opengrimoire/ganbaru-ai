import { describe, expect, it } from "vitest";
import type { CalendarEvent, PomodoroConfig } from "./types";
import {
  endActiveEventWouldStopProductivity,
  sameConcreteOccurrence,
} from "./active-event-end";

const pomodoroConfig: PomodoroConfig = {
  focusDurationMinutes: 40,
  shortBreakMinutes: 5,
  longBreakMinutes: 10,
  pomodoroCount: 4,
  idleTimeoutMinutes: 1,
};

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Focus",
    start: "2026-05-24 09:00",
    end: "2026-05-24 13:00",
    timezone: "UTC",
    calendarId: "local",
    pomodoroConfig,
    ...overrides,
  };
}

describe("active event end helpers", () => {
  it("requires the stronger confirmation when no other pomodoro event overlaps now", () => {
    const selected = event();
    const future = event({
      id: "future",
      start: "2026-05-24 14:00",
      end: "2026-05-24 18:00",
    });

    expect(endActiveEventWouldStopProductivity(
      selected,
      [selected, future],
      new Date("2026-05-24T10:30:00"),
    )).toBe(true);
  });

  it("uses inline confirmation when another pomodoro event overlaps now", () => {
    const selected = event();
    const stacked = event({
      id: "stacked",
      start: "2026-05-24 10:00",
      end: "2026-05-24 12:00",
    });

    expect(endActiveEventWouldStopProductivity(
      selected,
      [selected, stacked],
      new Date("2026-05-24T10:30:00"),
    )).toBe(false);
  });

  it("treats a template first occurrence and synthetic occurrence on the same date as the same concrete event", () => {
    const template = event({
      id: "template-1",
      recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
    });
    const firstSynthetic = event({
      id: "template-1::2026-05-24",
      recurringParentId: "template-1",
    });

    expect(sameConcreteOccurrence(template, firstSynthetic)).toBe(true);
  });
});
