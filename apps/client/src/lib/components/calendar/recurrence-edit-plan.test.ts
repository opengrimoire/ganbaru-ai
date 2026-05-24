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
      currentDate: "2027-06-10",
      currentTime: "12:00",
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
        currentDate: "2027-06-10",
        currentTime: "12:00",
      }).display;
      const renderedIds = new Set(result.events.map((event) => event.id));

      expect([...result.previewedIds].every((id) => renderedIds.has(id))).toBe(true);
    }
  });

  it("previews following scope as affected occurrences when there are no field changes", () => {
    const template = makeRecurringTemplate();
    const inst16 = makeInstance(template, "2027-06-16");
    const inst17 = makeInstance(template, "2027-06-17");
    const storeEvents = [template, inst16, inst17];

    const result = buildRecurringEditPlan({
      rawBlocks: [template],
      storeEvents,
      originalEvent: inst16,
      instanceEvent: inst16,
      templateId: template.id,
      changes: {},
      scope: "following",
      window: TEST_WINDOW,
      currentDate: "2027-06-17",
      currentTime: "12:00",
    }).display;

    expect(result.events).toBe(storeEvents);
    expect(result.previewedIds).toEqual(new Set([inst16.id, inst17.id]));
    expect(result.editingId).toBe(inst16.id);
  });

  it("previews all scope as affected occurrences when there are no field changes", () => {
    const template = makeRecurringTemplate();
    const inst16 = makeInstance(template, "2027-06-16");
    const inst17 = makeInstance(template, "2027-06-17");
    const storeEvents = [template, inst16, inst17];

    const result = buildRecurringEditPlan({
      rawBlocks: [template],
      storeEvents,
      originalEvent: inst16,
      instanceEvent: inst16,
      templateId: template.id,
      changes: {},
      scope: "all",
      window: TEST_WINDOW,
      currentDate: "2027-06-17",
      currentTime: "12:00",
    }).display;

    expect(result.events).toBe(storeEvents);
    expect(result.previewedIds).toEqual(new Set([template.id, inst16.id, inst17.id]));
    expect(result.editingId).toBe(inst16.id);
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
      currentTime: "12:00",
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
      currentTime: "12:00",
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
      currentTime: "12:00",
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
      currentTime: "12:00",
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

  it("projects following clear on the active selected occurrence as the old active occurrence", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const inst21 = makeInstance(template, "2027-06-21");

    const result = buildRecurringEditPlan({
      rawBlocks: [template],
      storeEvents: [template, inst20, inst21],
      originalEvent: inst20,
      instanceEvent: inst20,
      templateId: template.id,
      changes: { recurrence: undefined },
      scope: "following",
      window: TEST_WINDOW,
      currentDate: "2027-06-10",
      currentTime: "12:00",
      activeDate: "2027-06-20",
    }).display;

    expect(result.events.some((event) => event.id === `__vf__${template.id}`)).toBe(false);
    expect(result.events.find((event) => event.id === inst20.id)).toBeDefined();
    expect(result.events.some((event) => event.id === inst21.id)).toBe(false);
    expect(result.editingId).toBe(inst20.id);
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
      currentTime: "12:00",
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

  it("projects following clear by keeping one selected survivor and a materialized active later occurrence", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const inst22 = makeInstance(template, "2027-06-22");

    const result = buildRecurringEditPlan({
      rawBlocks: [template],
      storeEvents: [template, inst20, inst22],
      originalEvent: inst20,
      instanceEvent: inst20,
      templateId: template.id,
      changes: { recurrence: undefined },
      scope: "following",
      window: TEST_WINDOW,
      currentDate: "2027-06-10",
      currentTime: "12:00",
      activeDate: "2027-06-22",
    }).display;

    const selectedSurvivors = result.events.filter((event) =>
      event.id === `__vf__${template.id}` || event.recurringParentId === `__vf__${template.id}`,
    );
    const activeSurvivor = result.events.find((event) =>
      event.id === `__vf_active__${template.id}::2027-06-22`
    );

    expect(selectedSurvivors).toHaveLength(1);
    expect(activeSurvivor).toBeDefined();
    expect(activeSurvivor?.recurrence).toBeUndefined();
    expect(result.previewedIds.has(activeSurvivor!.id)).toBe(true);
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
      currentTime: "12:00",
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

  it("plans following resize on the active selected occurrence from that occurrence", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const resized = { end: "2027-06-20 10:15" };

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: resized,
      scope: "following",
      activeBlockId: inst20.id,
      today: "2027-06-20",
      currentTime: "09:15",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "split-series",
      "transfer-active-run",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "split-series",
      startDate: "2027-06-20",
      patch: resized,
    });
    expect(plan.operations[1]).toMatchObject({
      type: "transfer-active-run",
      fromId: inst20.id,
      to: { kind: "operation-result", operationId: "split-active-selected" },
      newEnd: "2027-06-20 10:15",
    });
  });

  it("projects following resize on the active selected occurrence without dropping the active day", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const inst21 = makeInstance(template, "2027-06-21");

    const result = buildRecurringEditPlan({
      rawBlocks: [template],
      storeEvents: [template, inst20, inst21],
      originalEvent: inst20,
      instanceEvent: inst20,
      templateId: template.id,
      changes: { end: "2027-06-20 10:15" },
      scope: "following",
      window: TEST_WINDOW,
      currentDate: "2027-06-20",
      currentTime: "09:15",
      activeDate: "2027-06-20",
    }).display;

    const activeProjection = result.events.find((event) =>
      event.start.startsWith("2027-06-20 ")
        && (event.id === `__vf__${template.id}` || event.recurringParentId === `__vf__${template.id}`)
    );

    expect(activeProjection).toBeDefined();
    expect(activeProjection?.end).toBe("2027-06-20 10:15");
    expect(result.editingId).toBe(activeProjection?.id);
  });

  it("plans all resize on the active selected first occurrence by updating the active chain", () => {
    const template = makeRecurringTemplate({
      start: "2027-06-20 09:00",
      end: "2027-06-20 09:30",
    });

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: template,
      changes: { end: "2027-06-20 10:15" },
      scope: "all",
      activeBlockId: template.id,
      today: "2027-06-20",
      currentTime: "09:15",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "materialize-protected-history",
      "update-template-fields",
      "transfer-active-run",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "materialize-protected-history",
      cutoffDate: "2027-06-20",
    });
    expect(plan.operations[1]).toMatchObject({
      type: "update-template-fields",
      protectedUntilDate: undefined,
      firstMutableDate: undefined,
    });
    expect(plan.operations[2]).toMatchObject({
      type: "transfer-active-run",
      fromId: template.id,
      to: { kind: "event-id", eventId: template.id },
      newEnd: "2027-06-20 10:15",
    });
  });

  it("plans all edit on an active later occurrence from the active date", () => {
    const template = makeRecurringTemplate({
      start: "2026-05-18 20:20",
      end: "2026-05-18 23:20",
    });
    const active = makeInstance(template, "2026-05-23");

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: active,
      changes: { title: "Changed" },
      scope: "all",
      activeBlockId: active.id,
      today: "2026-05-23",
      currentTime: "21:00",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "materialize-protected-history",
      "update-template-fields",
      "transfer-active-run",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "materialize-protected-history",
      cutoffDate: "2026-05-23",
      excludeDate: "2026-05-23",
    });
    expect(plan.operations[1]).toMatchObject({
      type: "update-template-fields",
      protectedUntilDate: "2026-05-22",
      firstMutableDate: "2026-05-23",
      patch: { title: "Changed" },
    });
    expect(plan.operations[2]).toMatchObject({
      type: "transfer-active-run",
      fromId: active.id,
      to: { kind: "operation-result", operationId: template.id },
      newEnd: "2026-05-23 23:20",
    });
  });

  it("plans all move outside the active selected occurrence by cutting active and splitting future", () => {
    const template = makeRecurringTemplate({
      start: "2027-06-20 09:00",
      end: "2027-06-20 09:30",
    });

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: template,
      changes: { start: "2027-06-20 11:00", end: "2027-06-20 12:00" },
      scope: "all",
      activeBlockId: template.id,
      today: "2027-06-20",
      currentTime: "09:15",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "materialize-protected-history",
      "materialize-occurrence",
      "update-template-fields",
      "transfer-active-run",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "materialize-protected-history",
      excludeDate: "2027-06-20",
    });
    expect(plan.operations[1]).toMatchObject({
      type: "materialize-occurrence",
      occurrenceDate: "2027-06-20",
      reason: "active-session",
      patch: { end: "2027-06-20 09:15", recurrence: undefined },
    });
    expect(plan.operations[2]).toMatchObject({
      type: "update-template-fields",
      protectedUntilDate: "2027-06-20",
      firstMutableDate: "2027-06-21",
    });
    expect(plan.operations[3]).toMatchObject({
      type: "transfer-active-run",
      fromId: template.id,
      to: { kind: "operation-result", operationId: "materialize-active-all" },
      newEnd: "2027-06-20 09:15",
    });
  });

  it("plans all future edit by continuing the edited chain from a protected active occurrence", () => {
    const template = makeRecurringTemplate({
      start: "2026-05-18 20:20",
      end: "2026-05-18 23:20",
    });
    const selected = makeInstance(template, "2026-05-24");

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: selected,
      changes: { title: "Changed" },
      scope: "all",
      activeBlockId: `${template.id}::2026-05-23`,
      today: "2026-05-23",
      currentTime: "21:00",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "materialize-protected-history",
      "update-template-fields",
      "transfer-active-run",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "materialize-protected-history",
      cutoffDate: "2026-05-23",
    });
    expect(plan.operations[1]).toMatchObject({
      type: "update-template-fields",
      protectedUntilDate: "2026-05-22",
      firstMutableDate: "2026-05-23",
    });
    expect(plan.operations[2]).toMatchObject({
      type: "transfer-active-run",
      fromId: `${template.id}::2026-05-23`,
      to: { kind: "operation-result", operationId: template.id },
    });
  });

  it("plans all future move outside protected active occurrence by cutting active", () => {
    const template = makeRecurringTemplate({
      start: "2026-05-18 20:20",
      end: "2026-05-18 23:20",
    });
    const selected = makeInstance(template, "2026-05-24");

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: selected,
      changes: { start: "2026-05-24 10:00", end: "2026-05-24 11:00" },
      scope: "all",
      activeBlockId: `${template.id}::2026-05-23`,
      today: "2026-05-23",
      currentTime: "21:00",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "materialize-protected-history",
      "materialize-occurrence",
      "update-template-fields",
      "transfer-active-run",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "materialize-protected-history",
      excludeDate: "2026-05-23",
    });
    expect(plan.operations[1]).toMatchObject({
      type: "materialize-occurrence",
      occurrenceDate: "2026-05-23",
      patch: { end: "2026-05-23 21:00", recurrence: undefined },
    });
    expect(plan.operations[2]).toMatchObject({
      type: "update-template-fields",
      firstMutableDate: "2026-05-24",
    });
    expect(plan.operations[3]).toMatchObject({
      type: "transfer-active-run",
      fromId: `${template.id}::2026-05-23`,
      to: { kind: "operation-result", operationId: "materialize-active-all" },
      newEnd: "2026-05-23 21:00",
    });
  });

  it("projects all edits without duplicating the active protected occurrence", () => {
    const template = makeRecurringTemplate({
      start: "2026-05-18 20:20",
      end: "2026-05-18 23:20",
    });
    const storeEvents = [
      template,
      makeInstance(template, "2026-05-19"),
      makeInstance(template, "2026-05-20"),
      makeInstance(template, "2026-05-21"),
      makeInstance(template, "2026-05-22"),
      makeInstance(template, "2026-05-23"),
      makeInstance(template, "2026-05-24"),
    ];

    const result = buildRecurringEditPlan({
      rawBlocks: [template],
      storeEvents,
      originalEvent: storeEvents[2],
      instanceEvent: storeEvents[2],
      templateId: template.id,
      changes: { title: "Changed" },
      scope: "all",
      window: {
        start: Temporal.PlainDate.from("2026-05-18"),
        end: Temporal.PlainDate.from("2026-05-24"),
      },
      currentDate: "2026-05-23",
      currentTime: "21:00",
      activeDate: "2026-05-23",
    }).display;

    const activeDayEvents = result.events.filter((event) =>
      (event.id === template.id || event.recurringParentId === template.id)
        && event.start.startsWith("2026-05-23 ")
    );
    expect(activeDayEvents).toHaveLength(1);
    expect(activeDayEvents[0].id).toBe(`${template.id}::2026-05-23`);
    expect(activeDayEvents[0].title).toBe("Changed");
  });

  it("plans all clear on a future-only series as a selected survivor collapse", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence: undefined },
      scope: "all",
      today: "2027-06-10",
      currentTime: "12:00",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "collapse-series",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "collapse-series",
      survivorDate: "2027-06-20",
      patch: { recurrence: undefined },
      materializeProtectedHistory: true,
    });
  });

  it("plans all clear after today's occurrence ended by preserving through today", () => {
    const template = makeRecurringTemplate({
      start: "2026-05-11 08:00",
      end: "2026-05-11 09:00",
    });
    const inst17 = makeInstance(template, "2026-05-17");

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst17,
      changes: { recurrence: undefined },
      scope: "all",
      today: "2026-05-15",
      currentTime: "21:00",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "materialize-protected-history",
      "collapse-series",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "materialize-protected-history",
      cutoffDate: "2026-05-16",
      excludeDate: "2026-05-17",
    });
    expect(plan.operations[1]).toMatchObject({
      type: "collapse-series",
      survivorDate: "2026-05-17",
      protectedUntilDate: "2026-05-15",
      firstMutableDate: "2026-05-16",
      patch: { recurrence: undefined },
    });
  });

  it("projects all clear with a different active occurrence as an extra standalone survivor", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2027-06-20");
    const inst22 = makeInstance(template, "2027-06-22");

    const result = buildRecurringEditPlan({
      rawBlocks: [template],
      storeEvents: [template, inst20, inst22],
      originalEvent: inst20,
      instanceEvent: inst20,
      templateId: template.id,
      changes: { recurrence: undefined },
      scope: "all",
      window: TEST_WINDOW,
      currentDate: "2027-06-10",
      currentTime: "12:00",
      activeDate: "2027-06-22",
    }).display;

    expect(result.events.find((event) => event.id === template.id)?.start).toBe(inst20.start);
    const activeSurvivor = result.events.find((event) =>
      event.id === `__va_active__${template.id}::2027-06-22`
    );
    expect(activeSurvivor).toBeDefined();
    expect(activeSurvivor?.recurrence).toBeUndefined();
    expect(result.previewedIds.has(activeSurvivor!.id)).toBe(true);
  });

  it("projects all clear without duplicating a protected active occurrence", () => {
    const template = makeRecurringTemplate({
      start: "2026-05-18 20:20",
      end: "2026-05-18 23:20",
    });
    const active = makeInstance(template, "2026-05-23");
    const selected = makeInstance(template, "2026-05-24");

    const result = buildRecurringEditPlan({
      rawBlocks: [template],
      storeEvents: [
        template,
        makeInstance(template, "2026-05-19"),
        makeInstance(template, "2026-05-20"),
        makeInstance(template, "2026-05-21"),
        makeInstance(template, "2026-05-22"),
        active,
        selected,
      ],
      originalEvent: selected,
      instanceEvent: selected,
      templateId: template.id,
      changes: { recurrence: undefined },
      scope: "all",
      window: {
        start: Temporal.PlainDate.from("2026-05-18"),
        end: Temporal.PlainDate.from("2026-05-24"),
      },
      currentDate: "2026-05-23",
      currentTime: "21:00",
      activeDate: "2026-05-23",
    }).display;

    const activeDayEvents = result.events.filter((event) =>
      event.start.startsWith("2026-05-23 ")
    );
    expect(activeDayEvents).toHaveLength(1);
    expect(activeDayEvents[0].id).toBe(`__va_active__${template.id}::2026-05-23`);
  });

  it("contours protected all-scope occurrences without changing their frozen fields", () => {
    const template = makeRecurringTemplate({
      start: "2026-05-11 08:00",
      end: "2026-05-11 09:00",
    });
    const inst15 = makeInstance(template, "2026-05-15");
    const inst16 = makeInstance(template, "2026-05-16");
    const inst17 = makeInstance(template, "2026-05-17");

    const result = buildRecurringEditPlan({
      rawBlocks: [template],
      storeEvents: [template, makeInstance(template, "2026-05-12"), inst15, inst16, inst17],
      originalEvent: inst17,
      instanceEvent: inst17,
      templateId: template.id,
      changes: { title: "Changed" },
      scope: "all",
      window: {
        start: Temporal.PlainDate.from("2026-05-10"),
        end: Temporal.PlainDate.from("2026-05-18"),
      },
      currentDate: "2026-05-15",
      currentTime: "21:00",
    }).display;

    expect(result.previewedIds.has(inst15.id)).toBe(true);
    expect(result.events.find((event) => event.id === inst15.id)?.title).toBe("Daily standup");
    expect(result.previewedIds.has(inst16.id)).toBe(true);
    expect(result.events.find((event) => event.id === inst16.id)?.title).toBe("Changed");
  });

  it("previews all clear by preserving ended occurrences and removing future non-survivors", () => {
    const template = makeRecurringTemplate({
      start: "2026-05-11 08:00",
      end: "2026-05-11 09:00",
    });
    const inst15 = makeInstance(template, "2026-05-15");
    const inst16 = makeInstance(template, "2026-05-16");
    const inst17 = makeInstance(template, "2026-05-17");

    const result = buildRecurringEditPlan({
      rawBlocks: [template],
      storeEvents: [template, makeInstance(template, "2026-05-12"), inst15, inst16, inst17],
      originalEvent: inst17,
      instanceEvent: inst17,
      templateId: template.id,
      changes: { recurrence: undefined },
      scope: "all",
      window: {
        start: Temporal.PlainDate.from("2026-05-10"),
        end: Temporal.PlainDate.from("2026-05-18"),
      },
      currentDate: "2026-05-15",
      currentTime: "21:00",
    }).display;

    expect(result.events.find((event) => event.id === inst15.id)).toBeDefined();
    expect(result.previewedIds.has(inst15.id)).toBe(true);
    expect(result.events.find((event) => event.id === inst16.id)).toBeUndefined();
    expect(result.events.find((event) => event.id === `__va__${template.id}`)?.start).toBe(inst17.start);
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
      currentTime: "12:00",
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "materialize-protected-history",
      "update-template-fields",
      "refresh-window",
    ]);
    expect(plan.operations[0]).toMatchObject({
      type: "materialize-protected-history",
      cutoffDate: "2027-06-11",
    });
    expect(plan.operations[1]).toMatchObject({
      type: "update-template-fields",
      protectedUntilDate: "2027-06-10",
      firstMutableDate: "2027-06-11",
    });
  });
});
