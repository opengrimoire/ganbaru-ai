import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./types";
import {
  mapPomodoroSegmentRows,
  pomodoroSegmentSnapshotKey,
  queryPomodoroSegmentEventIds,
  visiblePomodoroEventIds,
  type DbPomodoroSegmentRow,
} from "./pomodoro-rail-segments";

const pomodoroConfig = {
  focusDurationMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  pomodoroCount: 4,
  idleTimeoutMinutes: null,
};

function event(id: string, pomodoro = true): CalendarEvent {
  return {
    id,
    title: id,
    start: "2026-05-04 09:00",
    end: "2026-05-04 10:00",
    timezone: "UTC",
    calendarId: "local",
    pomodoroConfig: pomodoro ? pomodoroConfig : undefined,
  };
}

function row(eventId: string, eventDate: string): DbPomodoroSegmentRow {
  return {
    id: `${eventId}-${eventDate}`,
    event_id: eventId,
    event_date: eventDate,
    run_id: "run-1",
    cycle_number: 1,
    phase: "focus",
    planned_start: `${eventDate}T09:00:00Z`,
    planned_end: `${eventDate}T09:25:00Z`,
    actual_start: `${eventDate}T09:00:00Z`,
    actual_end: `${eventDate}T09:25:00Z`,
    pauses: [],
    status: "completed",
  };
}

describe("visiblePomodoroEventIds", () => {
  it("returns sorted visible pomodoro ids only", () => {
    expect(visiblePomodoroEventIds([
      event("b"),
      event("a", false),
      event("a::2026-05-04"),
      event("b"),
    ])).toEqual(["a::2026-05-04", "b"]);
  });
});

describe("queryPomodoroSegmentEventIds", () => {
  it("includes recurring roots for synthetic visible ids", () => {
    expect(queryPomodoroSegmentEventIds(["b", "a::2026-05-04"])).toEqual([
      "a",
      "a::2026-05-04",
      "b",
    ]);
  });
});

describe("pomodoroSegmentSnapshotKey", () => {
  it("is stable for the same segment version and id set", () => {
    expect(pomodoroSegmentSnapshotKey(3, ["b", "a"])).toBe("3|a,b");
  });
});

describe("mapPomodoroSegmentRows", () => {
  it("maps root rows back to visible synthetic occurrences", () => {
    const mapped = mapPomodoroSegmentRows(
      [row("event-root", "2026-05-04")],
      ["event-root::2026-05-04"],
    );

    expect(mapped.get("event-root::2026-05-04")?.[0]).toMatchObject({
      eventId: "event-root::2026-05-04",
      eventDate: "2026-05-04",
      phase: "focus",
    });
  });
});
