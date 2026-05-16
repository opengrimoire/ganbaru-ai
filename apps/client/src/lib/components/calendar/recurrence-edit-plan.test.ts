import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "./types";
import {
  buildRecurringCommitPlan,
  buildRecurringEditPlan,
  getRecurrenceFieldOperation,
} from "./recurrence-edit-plan";

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

  it("plans only-this clear as a standalone detach with refresh", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence: undefined },
      scope: "this",
      today: "2027-06-10",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "detach-occurrence",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "detach-occurrence",
      target: "standalone",
      occurrenceDate: "2027-06-20",
      addsException: true,
      patch: { recurrence: undefined },
    });
    expect(plan.requiresCanonicalRefresh).toBe(true);
  });

  it("plans only-this recurrence change as an independent recurring detach", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const recurrence = { frequency: "weekly" as const, interval: 1, end: { type: "never" as const } };

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence },
      scope: "this",
      today: "2027-06-10",
    });

    expect(plan.operations[0]).toMatchObject({
      type: "detach-occurrence",
      target: "recurring-template",
      patch: { recurrence },
    });
  });

  it("plans following clear as a split to one selected survivor", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence: undefined },
      scope: "following",
      today: "2027-06-10",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "split-series",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "split-series",
      startDate: "2027-06-20",
      patch: { recurrence: undefined },
    });
  });

  it("plans following clear on the active selected occurrence as a cap only", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence: undefined },
      scope: "following",
      activeBlockId: inst20.id,
      today: "2027-06-10",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "cap-template",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "cap-template",
      untilDate: "2027-06-20",
    });
  });

  it("plans following clear by materializing an active later occurrence", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const activeId = `${template.id}::2027-06-22`;

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence: undefined },
      scope: "following",
      activeBlockId: activeId,
      today: "2027-06-10",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "materialize-occurrence",
      "transfer-active-run",
      "split-series",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "materialize-occurrence",
      occurrenceDate: "2027-06-22",
      reason: "active-session",
    });
    expect(plan.operations[1]).toMatchObject({
      type: "transfer-active-run",
      fromId: activeId,
      to: { kind: "operation-result", operationId: "materialize-active-following" },
    });
  });

  it("plans following recurrence changes by transferring an active later occurrence to the new split template", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const activeId = `${template.id}::2027-06-22`;
    const recurrence = { frequency: "weekly" as const, interval: 1, end: { type: "never" as const } };

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence },
      scope: "following",
      activeBlockId: activeId,
      today: "2027-06-10",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "split-series",
      "transfer-active-run",
      "refresh-window",
    ]);
    expect(plan.operations[1]).toMatchObject({
      type: "transfer-active-run",
      fromId: activeId,
      to: { kind: "split-occurrence", operationId: "split-following", date: "2027-06-22" },
    });
  });

  it("plans all clear as a selected survivor collapse with protected history", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence: undefined },
      scope: "all",
      today: "2027-06-10",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "materialize-protected-history",
      "collapse-series",
      "refresh-window",
    ]);
    expect(plan.operations[1]).toMatchObject({
      type: "collapse-series",
      survivorDate: "2027-06-20",
      patch: { recurrence: undefined },
      materializeProtectedHistory: true,
    });
  });

  it("plans all recurrence changes with protected history materialization before template update", () => {
    const template = makeRecurringTemplate({
      start: "2027-01-01 09:00",
      end: "2027-01-01 09:30",
    });
    const inst20 = makeInstance(template, "2027-06-20");
    const recurrence = { frequency: "weekly" as const, interval: 1, end: { type: "never" as const } };

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence },
      scope: "all",
      today: "2027-06-10",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "materialize-protected-history",
      "update-template-fields",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "materialize-protected-history",
      cutoffDate: "2027-06-10",
    });
  });
});
