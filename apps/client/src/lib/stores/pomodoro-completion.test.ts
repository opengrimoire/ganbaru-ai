import { describe, expect, it } from "vitest";
import type { CalendarEvent, PomodoroConfig } from "$lib/components/calendar/types";
import { createPresetPomodoroConfig } from "$lib/pomodoro/rhythm";
import { classifyPomodoroCompletion } from "./pomodoro-completion";

const pomodoroConfig: PomodoroConfig = createPresetPomodoroConfig("adaptive");

function event(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "start" | "end">): CalendarEvent {
  return {
    title: "Focus",
    description: "",
    calendarId: "local",
    color: 1,
    allDay: false,
    location: "",
    url: "",
    status: "confirmed",
    visibility: "default",
    priority: 0,
    transparency: "opaque",
    categories: [],
    extendedProperties: {},
    attendees: [],
    alarms: [],
    pomodoroConfig,
    ...overrides,
  } as CalendarEvent;
}

describe("classifyPomodoroCompletion", () => {
  it("returns event when another pomodoro event remains that local day", () => {
    const ended = event({
      id: "ended",
      start: "2026-05-28 09:00",
      end: "2026-05-28 10:00",
    });
    const later = event({
      id: "later",
      start: "2026-05-28 11:00",
      end: "2026-05-28 12:00",
    });

    expect(classifyPomodoroCompletion(ended, [ended, later])).toBe("event");
  });

  it("returns day when no later pomodoro event remains that local day", () => {
    const ended = event({
      id: "ended",
      start: "2026-05-28 09:00",
      end: "2026-05-28 10:00",
    });

    expect(classifyPomodoroCompletion(ended, [ended])).toBe("day");
  });

  it("returns workweek on friday when no later pomodoro event remains that local day", () => {
    const ended = event({
      id: "ended",
      start: "2026-05-29 09:00",
      end: "2026-05-29 10:00",
    });

    expect(classifyPomodoroCompletion(ended, [ended])).toBe("workweek");
  });
});
