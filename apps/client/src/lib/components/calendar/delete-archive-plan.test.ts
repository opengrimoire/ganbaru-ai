import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./types";
import {
  buildCalendarDeleteArchivePlan,
  classifyEventProtection,
  eventMatchesActiveOccurrence,
} from "./delete-archive-plan";

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    title: "Focus",
    start: "2026-05-24 09:00",
    end: "2026-05-24 10:00",
    timezone: "UTC",
    calendarId: "local",
    ...overrides,
  };
}

function dailyTemplate(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return event({
    id: "template-1",
    recurrence: {
      frequency: "daily",
      interval: 1,
      end: { type: "never" },
    },
    ...overrides,
  });
}

function occurrence(template: CalendarEvent, date: string): CalendarEvent {
  const startTime = template.start.split(" ")[1];
  const endTime = template.end.split(" ")[1];
  return {
    ...template,
    id: template.start.split(" ")[0] === date ? template.id : `${template.id}::${date}`,
    start: `${date} ${startTime}`,
    end: `${date} ${endTime}`,
    recurringParentId: template.id,
  };
}

describe("calendar delete/archive planner", () => {
  it("plans a non-recurring future untracked event as a hard delete", () => {
    const selected = event({ start: "2026-05-25 09:00", end: "2026-05-25 10:00" });
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [selected],
      visibleEvents: [selected],
      selectedEvent: selected,
      now: new Date("2026-05-24T12:00:00"),
    });

    expect(plan.outcome).toBe("delete");
    expect(plan.operations).toEqual([{
      type: "delete_event",
      target: {
        id: selected.id,
        occurrenceStart: "2026-05-25T09:00:00Z",
        occurrenceEnd: "2026-05-25T10:00:00Z",
      },
    }]);
    expect(plan.finalVisibleEvents).toEqual([]);
    expect(plan.restore.snapshots).toMatchObject([{ restoreMode: "insert", event: { id: selected.id } }]);
  });

  it("plans started, active, and tracked events as archive operations", () => {
    const started = event({ id: "started", start: "2026-05-24 09:00", end: "2026-05-24 10:00" });
    const active = event({ id: "active", start: "2026-05-24 14:00", end: "2026-05-24 15:00" });
    const tracked = event({ id: "tracked", start: "2026-05-25 09:00", end: "2026-05-25 10:00" });
    const now = new Date("2026-05-24T12:00:00");

    expect(classifyEventProtection(started, { now }).reason).toBe("started");
    expect(classifyEventProtection(active, {
      now,
      activePomodoro: { blockId: "active" },
    }).reason).toBe("active");
    expect(classifyEventProtection(tracked, {
      now,
      protectedEventIds: new Set(["tracked"]),
    }).reason).toBe("pomodoro-history");

    for (const selected of [started, active, tracked]) {
      const plan = buildCalendarDeleteArchivePlan({
        rawBlocks: [selected],
        visibleEvents: [selected],
        selectedEvent: selected,
        now,
        activePomodoro: selected.id === "active" ? { blockId: "active" } : undefined,
        protectedEventIds: selected.id === "tracked" ? new Set(["tracked"]) : undefined,
      });
      expect(plan.outcome).toBe("archive");
      expect(plan.operations[0].type).toBe("archive_event");
    }
  });

  it("marks active event plans as requiring one active-session stop", () => {
    const selected = event({ id: "active" });
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [selected],
      visibleEvents: [selected],
      selectedEvent: selected,
      now: new Date("2026-05-24T08:00:00"),
      activePomodoro: { blockId: "active" },
    });

    expect(plan.requiresActiveStop).toBe(true);
    expect(plan.operations).toHaveLength(1);
  });

  it("targets the first recurring occurrence as a synthetic only-this mutation", () => {
    const template = dailyTemplate({ start: "2026-05-25 09:00", end: "2026-05-25 10:00" });
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [template],
      visibleEvents: [template, occurrence(template, "2026-05-26")],
      selectedEvent: template,
      scope: "this",
      now: new Date("2026-05-24T12:00:00"),
    });

    expect(plan.operations).toMatchObject([{
      type: "delete_event",
      target: { id: "template-1::2026-05-25" },
    }]);
    expect([...plan.affectedVisibleIds]).toEqual(["template-1"]);
    expect(plan.restore.snapshots).toMatchObject([{ restoreMode: "update", event: { id: "template-1" } }]);
  });

  it("plans only-this future synthetic occurrence as one exception delete", () => {
    const template = dailyTemplate({ start: "2026-05-25 09:00", end: "2026-05-25 10:00" });
    const selected = occurrence(template, "2026-05-26");
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [template],
      visibleEvents: [template, selected],
      selectedEvent: selected,
      scope: "this",
      now: new Date("2026-05-24T12:00:00"),
    });

    expect(plan.operations).toMatchObject([{
      type: "delete_event",
      target: { id: "template-1::2026-05-26" },
    }]);
    expect([...plan.affectedVisibleIds]).toEqual(["template-1::2026-05-26"]);
  });

  it("plans following scope from a started occurrence as archive-only through now", () => {
    const template = dailyTemplate({ start: "2026-05-22 09:00", end: "2026-05-22 10:00" });
    const selected = occurrence(template, "2026-05-24");
    const future = occurrence(template, "2026-05-25");
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [template],
      visibleEvents: [occurrence(template, "2026-05-23"), selected, future],
      selectedEvent: selected,
      scope: "following",
      now: new Date("2026-05-24T12:00:00"),
    });

    expect([...plan.affectedVisibleIds]).toEqual(["template-1::2026-05-24"]);
    expect(plan.finalVisibleEvents.map((item) => item.id)).toEqual([
      "template-1::2026-05-23",
      "template-1::2026-05-25",
    ]);
    expect(plan.operations.map((operation) => operation.type)).toEqual(["archive_event"]);
    expect(plan.operations[0]).toMatchObject({
      target: { id: "template-1::2026-05-24" },
    });
    expect(plan.outcome).toBe("archive");
  });

  it("plans following scope from a future occurrence as a cap", () => {
    const template = dailyTemplate({ start: "2026-05-22 09:00", end: "2026-05-22 10:00" });
    const selected = occurrence(template, "2026-05-25");
    const future = occurrence(template, "2026-05-26");
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [template],
      visibleEvents: [occurrence(template, "2026-05-24"), selected, future],
      selectedEvent: selected,
      scope: "following",
      now: new Date("2026-05-24T12:00:00"),
    });

    expect([...plan.affectedVisibleIds]).toEqual(["template-1::2026-05-25", "template-1::2026-05-26"]);
    expect(plan.finalVisibleEvents.map((item) => item.id)).toEqual(["template-1::2026-05-24"]);
    expect(plan.operations).toMatchObject([{
      type: "cap_series",
      eventId: "template-1",
      repeatUntil: "2026-05-24",
    }]);
    expect(plan.outcome).toBe("delete");
  });

  it("plans all scope on a future-only untracked series as a template hard delete", () => {
    const template = dailyTemplate({ start: "2026-05-25 09:00", end: "2026-05-25 10:00" });
    const next = occurrence(template, "2026-05-26");
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [template],
      visibleEvents: [template, next],
      selectedEvent: next,
      scope: "all",
      now: new Date("2026-05-24T12:00:00"),
    });

    expect(plan.operations).toMatchObject([{ type: "delete_event", target: { id: "template-1" } }]);
    expect(plan.finalVisibleEvents).toEqual([]);
    expect(plan.outcome).toBe("delete");
  });

  it("plans all scope on a future tracked series as archive plus cap", () => {
    const template = dailyTemplate({ start: "2026-05-25 09:00", end: "2026-05-25 10:00" });
    const selected = occurrence(template, "2026-05-26");
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [template],
      visibleEvents: [template, selected],
      selectedEvent: selected,
      scope: "all",
      now: new Date("2026-05-24T12:00:00"),
      protectedEventIds: new Set(["template-1::2026-05-26"]),
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual(["archive_event", "cap_series"]);
    expect(plan.operations[0]).toMatchObject({
      type: "archive_event",
      target: { id: "template-1::2026-05-26" },
    });
    expect(plan.operations[1]).toMatchObject({
      type: "cap_series",
      repeatUntil: "2026-05-24",
    });
    expect(plan.outcome).toBe("mixed");
  });

  it("plans all scope from a future occurrence as a cap after started history", () => {
    const template = dailyTemplate({ start: "2026-05-22 09:00", end: "2026-05-22 10:00" });
    const selected = occurrence(template, "2026-05-25");
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [template],
      visibleEvents: [
        template,
        occurrence(template, "2026-05-23"),
        occurrence(template, "2026-05-24"),
        selected,
        occurrence(template, "2026-05-26"),
      ],
      selectedEvent: selected,
      scope: "all",
      now: new Date("2026-05-24T12:00:00"),
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "cap_series",
    ]);
    expect(plan.operations.at(-1)).toMatchObject({
      type: "cap_series",
      eventId: "template-1",
      repeatUntil: "2026-05-24",
    });
    expect([...plan.affectedVisibleIds]).toEqual([
      "template-1::2026-05-25",
      "template-1::2026-05-26",
    ]);
    expect(plan.finalVisibleEvents.map((item) => item.id)).toEqual([
      "template-1",
      "template-1::2026-05-23",
      "template-1::2026-05-24",
    ]);
    expect(plan.outcome).toBe("delete");
  });

  it("caps instead of hard deleting all future occurrences after past exceptions removed history", () => {
    const template = dailyTemplate({
      start: "2026-05-18 09:00",
      end: "2026-05-18 10:00",
      exceptions: [
        "2026-05-18",
        "2026-05-19",
        "2026-05-20",
        "2026-05-21",
        "2026-05-22",
        "2026-05-23",
        "2026-05-24",
      ],
    });
    const detachedActive = event({
      id: "active-detached",
      start: "2026-05-24 09:00",
      end: "2026-05-24 10:00",
      recurrence: undefined,
      recurringParentId: undefined,
    });
    const selected = occurrence(template, "2026-05-25");
    const future = occurrence(template, "2026-05-26");
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [template, detachedActive],
      visibleEvents: [detachedActive, selected, future],
      selectedEvent: selected,
      scope: "all",
      now: new Date("2026-05-24T12:00:00"),
    });

    expect(plan.operations).toMatchObject([{
      type: "cap_series",
      eventId: "template-1",
      repeatUntil: "2026-05-24",
    }]);
    expect([...plan.affectedVisibleIds]).toEqual([
      "template-1::2026-05-25",
      "template-1::2026-05-26",
    ]);
    expect(plan.finalVisibleEvents.map((item) => item.id)).toEqual(["active-detached"]);
    expect(plan.requiresActiveStop).toBe(false);
  });

  it("does not stop an earlier active occurrence when deleting all future occurrences", () => {
    const template = dailyTemplate({ start: "2026-05-22 09:00", end: "2026-05-22 10:00" });
    const selected = occurrence(template, "2026-05-25");
    const active = occurrence(template, "2026-05-24");
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [template],
      visibleEvents: [template, active, selected],
      selectedEvent: selected,
      scope: "all",
      now: new Date("2026-05-24T09:30:00"),
      activePomodoro: { blockId: active.id },
    });

    expect(plan.requiresActiveStop).toBe(false);
    expect(plan.operations).toMatchObject([{
      type: "cap_series",
      eventId: "template-1",
      repeatUntil: "2026-05-24",
    }]);
    expect(plan.finalVisibleEvents.map((item) => item.id)).toEqual([
      "template-1",
      "template-1::2026-05-24",
    ]);
  });

  it("plans all scope from a started occurrence as archive-only through now", () => {
    const template = dailyTemplate({ start: "2026-05-22 09:00", end: "2026-05-22 10:00" });
    const selected = occurrence(template, "2026-05-23");
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [template],
      visibleEvents: [
        template,
        selected,
        occurrence(template, "2026-05-24"),
        occurrence(template, "2026-05-25"),
      ],
      selectedEvent: selected,
      scope: "all",
      now: new Date("2026-05-24T12:00:00"),
    });

    expect([...plan.affectedVisibleIds]).toEqual([
      "template-1",
      "template-1::2026-05-23",
      "template-1::2026-05-24",
    ]);
    expect(plan.finalVisibleEvents.map((item) => item.id)).toEqual(["template-1::2026-05-25"]);
    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "archive_event",
      "archive_event",
      "archive_event",
    ]);
    expect(plan.outcome).toBe("archive");
  });

  it("records empty original exceptions in recurring restore snapshots", () => {
    const template = dailyTemplate({ start: "2026-05-25 09:00", end: "2026-05-25 10:00" });
    const selected = occurrence(template, "2026-05-26");
    const plan = buildCalendarDeleteArchivePlan({
      rawBlocks: [template],
      visibleEvents: [template, selected],
      selectedEvent: selected,
      scope: "all",
      now: new Date("2026-05-24T12:00:00"),
      protectedEventIds: new Set(["template-1::2026-05-26"]),
    });

    expect(plan.restore.snapshots).toHaveLength(1);
    expect(plan.restore.snapshots[0].restoreMode).toBe("update");
    expect(plan.restore.snapshots[0].event.exceptions).toEqual([]);
  });

  it("keeps active occurrence matching exact when an occurrence date is known", () => {
    const template = dailyTemplate();

    expect(eventMatchesActiveOccurrence(
      occurrence(template, "2026-05-24"),
      { blockId: "template-1", eventDate: "2026-05-24" },
      template,
    )).toBe(true);
    expect(eventMatchesActiveOccurrence(
      occurrence(template, "2026-05-25"),
      { blockId: "template-1", eventDate: "2026-05-24" },
      template,
    )).toBe(false);
  });
});
