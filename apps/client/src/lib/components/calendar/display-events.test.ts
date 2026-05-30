import { describe, it, expect } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "./types";
import {
  closedDisplay,
  buildCreateDisplay,
  computeEditDisplay,
  applyNonRecurring,
  isPendingCreateEventId,
  PENDING_CREATE_ID,
} from "./display-events";

const TEST_WINDOW = {
  start: Temporal.PlainDate.from("2025-01-01"),
  end: Temporal.PlainDate.from("2028-12-31"),
};

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt1",
    title: "Test event",
    start: "2026-03-20 10:00",
    end: "2026-03-20 11:00",
    timezone: "America/New_York",
    calendarId: "local",
    ...overrides,
  };
}

function makeRecurringTemplate(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "tmpl1",
    title: "Daily standup",
    start: "2026-03-15 09:00",
    end: "2026-03-15 09:30",
    timezone: "America/New_York",
    calendarId: "local",
    recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
    ...overrides,
  };
}

function makeInstance(template: CalendarEvent, dateStr: string): CalendarEvent {
  const startTime = template.start.split(" ")[1];
  const endTime = template.end.split(" ")[1];
  return {
    ...template,
    id: `${template.id}::${dateStr}`,
    start: `${dateStr} ${startTime}`,
    end: `${dateStr} ${endTime}`,
    recurringParentId: template.id,
  };
}

describe("closedDisplay", () => {
  it("returns store events unchanged", () => {
    const events = [makeEvent()];
    const result = closedDisplay(events);
    expect(result.events).toBe(events);
    expect(result.previewedIds.size).toBe(0);
    expect(result.editingId).toBeUndefined();
  });
});

describe("isPendingCreateEventId", () => {
  it("matches the create preview id and its expanded instances only", () => {
    expect(isPendingCreateEventId(PENDING_CREATE_ID)).toBe(true);
    expect(isPendingCreateEventId(`${PENDING_CREATE_ID}::2026-03-20`)).toBe(true);
    expect(isPendingCreateEventId("evt1")).toBe(false);
  });
});

describe("buildCreateDisplay", () => {
  it("injects create pseudo-event", () => {
    const events = [makeEvent()];
    // Use different time than makeEvent() (10:00-11:00) to avoid realEventExists check
    const preview = { dateStr: "2026-03-20", startMinute: 720, endMinute: 780 };
    const result = buildCreateDisplay(events, preview, {}, TEST_WINDOW);
    expect(result.events.length).toBe(2);
    expect(result.editingId).toBe(PENDING_CREATE_ID);
    expect(result.previewedIds.has(PENDING_CREATE_ID)).toBe(true);

    const created = result.events.find((e) => e.id === PENDING_CREATE_ID);
    expect(created).toBeDefined();
    expect(created!.start).toBe("2026-03-20 12:00");
    expect(created!.end).toBe("2026-03-20 13:00");
  });

  it("carries local RSVP status into the create preview", () => {
    const preview = { dateStr: "2026-03-20", startMinute: 720, endMinute: 780 };
    const result = buildCreateDisplay([], preview, {
      localParticipationStatus: "tentative",
    }, TEST_WINDOW);

    const created = result.events.find((e) => e.id === PENDING_CREATE_ID);
    expect(created?.localParticipationStatus).toBe("tentative");
  });

  it("carries enabled meeting state into the create preview", () => {
    const preview = { dateStr: "2026-03-20", startMinute: 720, endMinute: 780 };
    const result = buildCreateDisplay([], preview, {
      meetingEnabled: true,
    }, TEST_WINDOW);

    const created = result.events.find((e) => e.id === PENDING_CREATE_ID);
    expect(created?.meetingEnabled).toBe(true);
  });

  it("rolls a timed create preview ending at 1440 to next-day midnight", () => {
    const preview = { dateStr: "2026-03-20", startMinute: 1320, endMinute: 1440 };
    const result = buildCreateDisplay([], preview, {}, TEST_WINDOW);

    const created = result.events.find((e) => e.id === PENDING_CREATE_ID);
    expect(created?.start).toBe("2026-03-20 22:00");
    expect(created?.end).toBe("2026-03-21 00:00");
  });

  it("lets a timed toggle override an all-day create preview", () => {
    const preview = {
      dateStr: "2026-03-20",
      startMinute: 0,
      endMinute: 0,
      allDay: true,
      endDateStr: "2026-03-20",
    };
    const result = buildCreateDisplay([], preview, {
      start: "2026-03-20 14:00",
      end: "2026-03-20 15:00",
      allDay: undefined,
    }, TEST_WINDOW);

    const created = result.events.find((e) => e.id === PENDING_CREATE_ID);
    expect(created?.allDay).toBeUndefined();
    expect(created?.start).toBe("2026-03-20 14:00");
    expect(created?.end).toBe("2026-03-20 15:00");
  });

  it("expands recurring create preview", () => {
    const events: CalendarEvent[] = [];
    const preview = {
      dateStr: "2026-03-16",
      startMinute: 600,
      endMinute: 660,
      recurrence: { frequency: "daily" as const, interval: 1, end: { type: "never" as const } },
    };
    const result = buildCreateDisplay(events, preview, {}, {
      start: Temporal.PlainDate.from("2026-03-16"),
      end: Temporal.PlainDate.from("2026-03-22"),
    });
    const recurrenceDates = result.events.map((e) => e.start.split(" ")[0]);

    expect(recurrenceDates).toEqual([
      "2026-03-16",
      "2026-03-17",
      "2026-03-18",
      "2026-03-19",
      "2026-03-20",
      "2026-03-21",
      "2026-03-22",
    ]);
    expect(result.previewedIds.size).toBe(7);
  });

  it("lets cleared recurrence override stale create preview recurrence", () => {
    const preview = {
      dateStr: "2026-03-20",
      startMinute: 600,
      endMinute: 660,
      recurrence: { frequency: "daily" as const, interval: 1, end: { type: "never" as const } },
    };

    const result = buildCreateDisplay([], preview, { recurrence: undefined }, TEST_WINDOW);

    expect(result.events).toHaveLength(1);
    expect(result.previewedIds).toEqual(new Set([PENDING_CREATE_ID]));
    expect(result.events[0]?.recurrence).toBeUndefined();
  });
});

describe("applyNonRecurring", () => {
  it("replaces event in-place with merged changes", () => {
    const evt = makeEvent();
    const events = [evt, makeEvent({ id: "evt2", title: "Other" })];
    const result = applyNonRecurring(events, evt, { title: "Updated" });

    expect(result.editingId).toBe("evt1");
    expect(result.previewedIds.has("evt1")).toBe(true);
    expect(result.events.find((e) => e.id === "evt1")!.title).toBe("Updated");
    expect(result.events.find((e) => e.id === "evt2")!.title).toBe("Other");
  });

  it("treats local RSVP status as a visible preview change", () => {
    const evt = makeEvent();
    const result = applyNonRecurring([evt], evt, {
      localParticipationStatus: "tentative",
    });

    expect(result.previewedIds.has("evt1")).toBe(true);
    expect(result.events[0]?.localParticipationStatus).toBe("tentative");
  });

  it("moves active single-event previews as one block when the draft still contains now", () => {
    const evt = makeEvent({ start: "2026-03-20 09:00", end: "2026-03-20 13:00" });
    const result = applyNonRecurring(
      [evt],
      evt,
      { start: "2026-03-20 10:00", end: "2026-03-20 14:00" },
      TEST_WINDOW,
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: evt.id,
      start: "2026-03-20 10:00",
      end: "2026-03-20 14:00",
    });
  });

  it("moves active single-event previews as one block when the draft starts after now", () => {
    const evt = makeEvent({ start: "2026-03-20 09:00", end: "2026-03-20 13:00" });
    const result = applyNonRecurring(
      [evt],
      evt,
      { start: "2026-03-20 11:00", end: "2026-03-20 15:00" },
      TEST_WINDOW,
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: evt.id,
      start: "2026-03-20 11:00",
      end: "2026-03-20 15:00",
    });
  });

  it("expands preview instances when adding recurrence to a saved non-recurring event", () => {
    const evt = makeEvent();
    const other = makeEvent({ id: "evt2", title: "Other", start: "2026-03-20 14:00", end: "2026-03-20 15:00" });

    const result = computeEditDisplay(
      [evt, other],
      [evt, other],
      { originalEvent: evt, instanceEvent: evt, templateId: evt.id },
      { recurrence: { frequency: "daily", interval: 1, end: { type: "never" } } },
      "this",
      TEST_WINDOW,
    );

    const previewEvents = result.events.filter((e) =>
      e.id === evt.id || e.recurringParentId === evt.id,
    );
    expect(previewEvents.length).toBeGreaterThan(1);
    expect(previewEvents.every((e) => result.previewedIds.has(e.id))).toBe(true);
    expect(result.editingId).toBe(evt.id);
    expect(result.events.find((e) => e.id === other.id)).toBe(other);
  });

  it("keeps the original event array when changes do not affect the calendar grid", () => {
    const evt = makeEvent();
    const events = [evt, makeEvent({ id: "evt2", title: "Other" })];
    const result = applyNonRecurring(events, evt, {
      title: evt.title,
      start: evt.start,
      end: evt.end,
      description: "Updated notes",
      visibility: "private",
    });

    expect(result.events).toBe(events);
    expect(result.editingId).toBe("evt1");
    expect(result.previewedIds.has("evt1")).toBe(true);
  });
});

describe("computeEditDisplay", () => {
  it("reprojects the same cleared recurrence draft when scope changes", () => {
    const template = makeRecurringTemplate({
      start: "2026-06-15 09:00",
      end: "2026-06-15 09:30",
    });
    const inst20 = makeInstance(template, "2026-06-20");
    const inst21 = makeInstance(template, "2026-06-21");
    const storeEvents = [template, inst20, inst21];
    const session = { originalEvent: inst20, instanceEvent: inst20, templateId: template.id };
    const changes = { recurrence: undefined };

    const thisResult = computeEditDisplay(
      [template],
      storeEvents,
      session,
      changes,
      "this",
      TEST_WINDOW,
    );
    const followingResult = computeEditDisplay(
      [template],
      storeEvents,
      session,
      changes,
      "following",
      TEST_WINDOW,
    );
    const allResult = computeEditDisplay(
      [template],
      storeEvents,
      session,
      changes,
      "all",
      TEST_WINDOW,
    );

    expect(thisResult.events.find((event) => event.id === inst20.id)?.recurrence).toBeUndefined();
    expect(followingResult.events.filter((event) =>
      event.id === `__vf__${template.id}` || event.recurringParentId === `__vf__${template.id}`,
    )).toHaveLength(1);
    expect(allResult.events.filter((event) =>
      event.id === template.id || event.recurringParentId === template.id,
    )).toHaveLength(1);
    expect(allResult.events.find((event) => event.id === template.id)?.start).toBe(inst20.start);
  });

  it("keeps following scope preview contours when recurrence returns to its saved value", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");
    const inst21 = makeInstance(template, "2026-03-21");
    const storeEvents = [template, inst20, inst21];

    const result = computeEditDisplay(
      [template],
      storeEvents,
      { originalEvent: inst20, instanceEvent: inst20, templateId: template.id },
      { recurrence: template.recurrence },
      "following",
      TEST_WINDOW,
    );

    expect(result.previewedIds).toEqual(new Set([inst20.id, inst21.id]));
    expect(result.events.filter((event) => result.previewedIds.has(event.id)).length).toBe(result.previewedIds.size);
  });

  it("keeps all scope preview contours when recurrence returns to its saved value", () => {
    const template = makeRecurringTemplate({
      start: "2026-06-01 09:00",
      end: "2026-06-01 09:30",
    });
    const inst02 = makeInstance(template, "2026-06-02");
    const storeEvents = [template, inst02, makeInstance(template, "2026-06-03")];

    const result = computeEditDisplay(
      [template],
      storeEvents,
      { originalEvent: inst02, instanceEvent: inst02, templateId: template.id },
      { recurrence: template.recurrence },
      "all",
      TEST_WINDOW,
    );

    const seriesEvents = result.events.filter((event) =>
      event.id === template.id || event.recurringParentId === template.id,
    );
    expect(seriesEvents.length).toBeGreaterThan(1);
    expect(seriesEvents.every((event) => result.previewedIds.has(event.id))).toBe(true);
  });
});
