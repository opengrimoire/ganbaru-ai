import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "./types";
import { buildRecurringEditPlan, getRecurrenceFieldOperation } from "./recurrence-edit-plan";

const TEST_WINDOW = {
  start: Temporal.PlainDate.from("2027-01-01"),
  end: Temporal.PlainDate.from("2027-12-31"),
};

function makeRecurringTemplate(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "tmpl1",
    title: "Daily standup",
    start: "2027-06-15 09:00",
    end: "2027-06-15 09:30",
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

describe("recurrence edit planner", () => {
  it("distinguishes missing recurrence from explicit clear", () => {
    const recurrence = { frequency: "daily" as const, interval: 1, end: { type: "never" as const } };

    expect(getRecurrenceFieldOperation(recurrence, {})).toEqual({
      kind: "unchanged",
      value: recurrence,
    });
    expect(getRecurrenceFieldOperation(recurrence, { recurrence: undefined })).toEqual({
      kind: "cleared",
    });
    expect(getRecurrenceFieldOperation(undefined, { recurrence: undefined })).toEqual({
      kind: "unchanged",
      value: undefined,
    });
    expect(getRecurrenceFieldOperation(recurrence, {
      recurrence: { frequency: "weekly", interval: 1, end: { type: "never" } },
    })).toEqual({
      kind: "set",
      value: { frequency: "weekly", interval: 1, end: { type: "never" } },
    });
  });

  it("reprojects the same cleared recurrence draft when scope changes", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const inst21 = makeInstance(template, "2027-06-21");
    const storeEvents = [template, inst20, inst21];
    const input = {
      rawBlocks: [template],
      storeEvents,
      originalEvent: inst20,
      instanceEvent: inst20,
      templateId: template.id,
      changes: { recurrence: undefined },
      window: TEST_WINDOW,
    };

    const thisResult = buildRecurringEditPlan({ ...input, scope: "this" }).display;
    const followingResult = buildRecurringEditPlan({ ...input, scope: "following" }).display;
    const allResult = buildRecurringEditPlan({ ...input, scope: "all" }).display;

    expect(thisResult.events.find((event) => event.id === inst20.id)?.recurrence).toBeUndefined();
    expect(followingResult.events.filter((event) =>
      event.id === `__vf__${template.id}` || event.recurringParentId === `__vf__${template.id}`,
    )).toHaveLength(1);
    expect(allResult.events.filter((event) =>
      event.id === template.id || event.recurringParentId === template.id,
    )).toHaveLength(1);
    expect(allResult.events.find((event) => event.id === template.id)?.start).toBe(inst20.start);
  });

  it("keeps preview contour ids inside returned projections", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const storeEvents = [template, inst20, makeInstance(template, "2027-06-21")];

    for (const scope of ["this", "following", "all"] as const) {
      const result = buildRecurringEditPlan({
        rawBlocks: [template],
        storeEvents,
        originalEvent: inst20,
        instanceEvent: inst20,
        templateId: template.id,
        changes: { title: "Changed" },
        scope,
        window: TEST_WINDOW,
      }).display;
      const renderedIds = new Set(result.events.map((event) => event.id));

      expect([...result.previewedIds].every((id) => renderedIds.has(id))).toBe(true);
    }
  });
});
