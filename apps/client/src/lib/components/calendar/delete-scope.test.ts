import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./types";
import {
  protectedRecurringOccurrencesForArchive,
  visibleEventsAfterRecurringDeleteScope,
} from "./delete-scope";

function dailyTemplate(start = "2026-05-20 09:00"): CalendarEvent {
  const [date, time] = start.split(" ");
  const endTime = time === "17:00" ? "18:00" : "10:00";
  return {
    id: "template-1",
    title: "Focus",
    start,
    end: `${date} ${endTime}`,
    timezone: "UTC",
    calendarId: "local",
    recurrence: {
      frequency: "daily",
      interval: 1,
      end: { type: "never" },
    },
  };
}

describe("recurring delete scope", () => {
  it("returns protected concrete occurrences inside the affected range", () => {
    const occurrences = protectedRecurringOccurrencesForArchive(
      dailyTemplate(),
      "2026-05-22",
      "2026-05-23",
      new Date("2026-05-23T12:00:00"),
    );

    expect(occurrences.map((event) => event.id)).toEqual([
      "template-1::2026-05-22",
      "template-1::2026-05-23",
    ]);
  });

  it("does not archive same-day occurrences that have not started", () => {
    const occurrences = protectedRecurringOccurrencesForArchive(
      dailyTemplate("2026-05-23 17:00"),
      "2026-05-23",
      "2026-05-23",
      new Date("2026-05-23T12:00:00"),
    );

    expect(occurrences).toEqual([]);
  });

  it("projects recurring only-this delete to one visible occurrence", () => {
    const template = dailyTemplate();
    const next = { ...template, id: "template-1::2026-05-21", start: "2026-05-21 09:00", end: "2026-05-21 10:00", recurringParentId: template.id };
    const other: CalendarEvent = { ...template, id: "other", recurrence: undefined };

    expect(visibleEventsAfterRecurringDeleteScope(
      [template, next, other],
      template.id,
      "2026-05-20",
      "this",
    ).map((event) => event.id)).toEqual(["template-1::2026-05-21", "other"]);
  });

  it("projects recurring following delete to selected and later visible occurrences", () => {
    const template = dailyTemplate();
    const selected = { ...template, id: "template-1::2026-05-21", start: "2026-05-21 09:00", end: "2026-05-21 10:00", recurringParentId: template.id };
    const later = { ...template, id: "template-1::2026-05-22", start: "2026-05-22 09:00", end: "2026-05-22 10:00", recurringParentId: template.id };

    expect(visibleEventsAfterRecurringDeleteScope(
      [template, selected, later],
      template.id,
      "2026-05-21",
      "following",
    ).map((event) => event.id)).toEqual(["template-1"]);
  });

  it("projects recurring all delete to no visible series occurrences", () => {
    const template = dailyTemplate();
    const next = { ...template, id: "template-1::2026-05-21", start: "2026-05-21 09:00", end: "2026-05-21 10:00", recurringParentId: template.id };
    const other: CalendarEvent = { ...template, id: "other", recurrence: undefined };

    expect(visibleEventsAfterRecurringDeleteScope(
      [template, next, other],
      template.id,
      "2026-05-20",
      "all",
    ).map((event) => event.id)).toEqual(["other"]);
  });
});
