import { describe, it, expect } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "./types";
import {
  closedDisplay,
  buildCreateDisplay,
  computeEditDisplay,
  buildRecurringCommitPlan,
  getRecurrenceFieldOperation,
  applyNonRecurring,
  applyThis,
  applyAll,
  applyFollowing,
  dateDiffDays,
  shiftDateStr,
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

describe("helpers", () => {
  it("dateDiffDays computes positive delta", () => {
    expect(dateDiffDays("2026-03-15", "2026-03-18")).toBe(3);
  });

  it("dateDiffDays computes negative delta", () => {
    expect(dateDiffDays("2026-03-18", "2026-03-15")).toBe(-3);
  });

  it("dateDiffDays returns 0 for same date", () => {
    expect(dateDiffDays("2026-03-15", "2026-03-15")).toBe(0);
  });

  it("shiftDateStr shifts forward", () => {
    expect(shiftDateStr("2026-03-15", 3)).toBe("2026-03-18");
  });

  it("shiftDateStr shifts backward", () => {
    expect(shiftDateStr("2026-03-15", -1)).toBe("2026-03-14");
  });

  it("shiftDateStr handles month boundary", () => {
    expect(shiftDateStr("2026-03-31", 1)).toBe("2026-04-01");
  });
});

describe("closedDisplay", () => {
  it("returns store events unchanged", () => {
    const events = [makeEvent()];
    const result = closedDisplay(events);
    expect(result.events).toBe(events);
    expect(result.previewedIds.size).toBe(0);
    expect(result.editingId).toBeUndefined();
  });
});

describe("recurrence edit planning", () => {
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

  it("builds a shared commit plan for cleared following recurrence", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");

    const plan = buildRecurringCommitPlan({
      rawBlocks: [template],
      templateId: template.id,
      instanceEvent: inst20,
      changes: { recurrence: undefined },
      scope: "following",
      activeBlockId: `${template.id}::2026-03-20`,
      today: "2026-03-20",
    });

    expect(plan.recurrenceOperation).toEqual({ kind: "cleared" });
    expect(plan.recurrenceCleared).toBe(true);
    expect(plan.activeOnSelectedDate).toBe(true);
    expect(plan.activeOnToday).toBe(true);
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

describe("applyThis", () => {
  it("only modifies the target instance", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");
    const inst21 = makeInstance(template, "2026-03-21");
    const events = [template, inst20, inst21];

    const result = applyThis(events, inst20, { title: "Changed" });

    expect(result.editingId).toBe(inst20.id);
    expect(result.previewedIds.size).toBe(1);
    expect(result.previewedIds.has(inst20.id)).toBe(true);

    const modified = result.events.find((e) => e.id === inst20.id)!;
    expect(modified.title).toBe("Changed");

    // Siblings unchanged
    const sibling = result.events.find((e) => e.id === inst21.id)!;
    expect(sibling.title).toBe("Daily standup");
  });

  it("keeps the original event array when instance changes do not affect the calendar grid", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");
    const inst21 = makeInstance(template, "2026-03-21");
    const events = [template, inst20, inst21];

    const result = applyThis(events, inst20, {
      title: inst20.title,
      start: inst20.start,
      end: inst20.end,
      url: "https://meet.example",
      attendees: [{
        id: "attendee-1",
        email: "victor@example.com",
        role: "req-participant",
        status: "accepted",
        rsvp: true,
      }],
    });

    expect(result.events).toBe(events);
    expect(result.editingId).toBe(inst20.id);
    expect(result.previewedIds.has(inst20.id)).toBe(true);
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
    const storeEvents = [template, inst20, makeInstance(template, "2026-03-21")];

    const result = computeEditDisplay(
      [template],
      storeEvents,
      { originalEvent: inst20, instanceEvent: inst20, templateId: template.id },
      { recurrence: template.recurrence },
      "following",
      TEST_WINDOW,
    );

    expect(result.previewedIds.size).toBeGreaterThan(1);
    expect([...result.previewedIds].every((id) => id === `__vf__${template.id}` || id.startsWith(`__vf__${template.id}::`))).toBe(true);
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

describe("applyAll", () => {
  // Use future dates so no instances are frozen by the past-protection logic
  function makeFutureTemplate() {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    const base = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return makeRecurringTemplate({ start: `${base} 09:00`, end: `${base} 09:30` });
  }

  function futureDate(daysFromNow: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  it("patches all instances via re-expansion", () => {
    const template = makeFutureTemplate();
    const instDate = futureDate(10);
    const inst = makeInstance(template, instDate);
    const events = [template, inst];

    const result = applyAll(
      [template], events, template.id, inst,
      { title: "All changed" },
      TEST_WINDOW,
    );

    expect(result.previewedIds.size).toBeGreaterThan(1);
    for (const e of result.events) {
      if (e.id === template.id || e.recurringParentId === template.id) {
        expect(e.title).toBe("All changed");
      }
    }
  });

  it("previews clearing recurrence for all events", () => {
    const template = makeFutureTemplate();
    const instDate = futureDate(10);
    const inst = makeInstance(template, instDate);
    const events = [template, inst];

    const result = applyAll(
      [template], events, template.id, inst,
      { recurrence: undefined },
      TEST_WINDOW,
    );

    const seriesEvents = result.events.filter((e) =>
      e.id === template.id || e.recurringParentId === template.id,
    );
    expect(seriesEvents).toHaveLength(1);
    expect(seriesEvents[0]?.start).toBe(inst.start);
    expect(seriesEvents[0]?.end).toBe(inst.end);
    expect(seriesEvents[0]?.recurrence).toBeUndefined();
    expect(seriesEvents[0]?.recurringParentId).toBeUndefined();
  });

  it("keeps the edited instance when clearing recurrence after the first instance was detached", () => {
    const template = makeFutureTemplate();
    const templateDate = template.start.split(" ")[0];
    const instDate = futureDate(6);
    const inst = makeInstance(template, instDate);
    const standaloneOriginal = makeEvent({
      id: "standalone-original",
      start: template.start,
      end: template.end,
      recurrence: undefined,
      recurringParentId: undefined,
    });
    const detachedTemplate = { ...template, exceptions: [templateDate] };
    const events = [standaloneOriginal, inst];

    const result = applyAll(
      [detachedTemplate, standaloneOriginal], events, template.id, inst,
      { recurrence: undefined },
      TEST_WINDOW,
    );

    expect(result.events.find((e) => e.id === standaloneOriginal.id)).toBe(standaloneOriginal);
    const collapsed = result.events.find((e) => e.id === template.id);
    expect(collapsed).toBeDefined();
    expect(collapsed?.start).toBe(inst.start);
    expect(collapsed?.end).toBe(inst.end);
    expect(collapsed?.recurrence).toBeUndefined();
  });

  it("shifts template dates by day delta", () => {
    const template = makeFutureTemplate();
    const instDate = futureDate(10);
    const shiftedDate = futureDate(12);
    const inst = makeInstance(template, instDate);
    const events = [template, inst];

    const result = applyAll(
      [template], events, template.id, inst,
      { start: `${shiftedDate} 09:00`, end: `${shiftedDate} 09:30` },
      TEST_WINDOW,
    );

    // Template should have shifted by +2 days
    const tmpl = result.events.find((e) => e.id === template.id)!;
    const templateStartDate = template.start.split(" ")[0];
    const expected = shiftDateStr(templateStartDate, 2);
    expect(tmpl.start).toBe(`${expected} 09:00`);
    expect(tmpl.end).toBe(`${expected} 09:30`);
  });

  it("freezes past instances and only previews future ones", () => {
    // Template starts in the past with daily recurrence
    const template = makeRecurringTemplate({
      start: "2026-01-01 09:00",
      end: "2026-01-01 09:30",
    });
    const pastDate = "2026-01-10";
    const futDate = futureDate(10);
    const pastInst = makeInstance(template, pastDate);
    const futInst = makeInstance(template, futDate);
    const events = [template, pastInst, futInst];

    const result = applyAll(
      [template], events, template.id, futInst,
      { title: "Changed" },
      TEST_WINDOW,
    );

    // Past instance should keep its original title
    const pastEvt = result.events.find((e) => e.id === pastInst.id);
    expect(pastEvt).toBeDefined();
    expect(pastEvt!.title).toBe("Daily standup");

    // Past instance should NOT be in previewedIds
    expect(result.previewedIds.has(pastInst.id)).toBe(false);

    // Future instances should have the new title
    const futEvts = result.events.filter(
      (e) => (e.recurringParentId === template.id || e.id === template.id)
        && e.start.split(" ")[0] >= futDate.slice(0, 10),
    );
    expect(futEvts.length).toBeGreaterThan(0);
    for (const e of futEvts) {
      expect(e.title).toBe("Changed");
    }
  });
});

describe("applyFollowing", () => {
  it("caps old template and creates virtual future template", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");
    const events = [template, inst20];

    const result = applyFollowing(
      [template], events, template.id, inst20,
      { title: "Future changed" },
      TEST_WINDOW,
    );

    // Old template should be capped at 2026-03-19
    const oldTmpl = result.events.find((e) => e.id === template.id);
    expect(oldTmpl).toBeDefined();
    expect(oldTmpl!.recurrence?.end).toEqual({ type: "until", date: "2026-03-19" });

    // Virtual template instances should have the new title
    const virtualInstances = result.events.filter((e) =>
      e.recurringParentId?.startsWith("__vf__") || e.id.startsWith("__vf__"),
    );
    expect(virtualInstances.length).toBeGreaterThan(0);
    for (const vi of virtualInstances) {
      expect(vi.title).toBe("Future changed");
    }

    // previewedIds should include both old and virtual events
    expect(result.previewedIds.size).toBeGreaterThan(1);
  });

  it("previews clearing recurrence for following events", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");
    const events = [template, inst20];

    const result = applyFollowing(
      [template], events, template.id, inst20,
      { recurrence: undefined },
      TEST_WINDOW,
    );

    const virtualEvents = result.events.filter((e) =>
      e.id === `__vf__${template.id}` || e.recurringParentId === `__vf__${template.id}`,
    );
    expect(virtualEvents).toHaveLength(1);
    expect(virtualEvents[0]?.recurrence).toBeUndefined();
    expect(result.previewedIds).toEqual(new Set([`__vf__${template.id}`]));
  });

  it("sets editingId to the virtual instance on the target date", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");
    const events = [template, inst20];

    const result = applyFollowing(
      [template], events, template.id, inst20,
      { title: "Future" },
      TEST_WINDOW,
    );

    // editingId should reference a virtual event on 2026-03-20
    expect(result.editingId).toBeDefined();
    const editingEvent = result.events.find((e) => e.id === result.editingId);
    expect(editingEvent).toBeDefined();
    expect(editingEvent!.start.split(" ")[0]).toBe("2026-03-20");
  });

  it("preserves event times with empty changes", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");
    const events = [template, inst20];

    const result = applyFollowing(
      [template], events, template.id, inst20,
      {},
      TEST_WINDOW,
    );

    const virtualInstances = result.events.filter((e) =>
      e.recurringParentId?.startsWith("__vf__") || e.id.startsWith("__vf__"),
    );
    expect(virtualInstances.length).toBeGreaterThan(0);
    for (const vi of virtualInstances) {
      expect(vi.start.split(" ")[1]).toBe("09:00");
      expect(vi.end.split(" ")[1]).toBe("09:30");
    }
  });

  it("preserves cross-midnight end date with empty changes", () => {
    const template = makeRecurringTemplate({
      start: "2026-03-15 22:00",
      end: "2026-03-16 07:00",
    });
    const inst20 = {
      ...template,
      id: `${template.id}::2026-03-20`,
      start: "2026-03-20 22:00",
      end: "2026-03-21 07:00",
      recurringParentId: template.id,
    };
    const events = [template, inst20];

    const result = applyFollowing(
      [template], events, template.id, inst20,
      {},
      TEST_WINDOW,
    );

    const virtualTemplate = result.events.find((e) => e.id === `__vf__${template.id}`);
    expect(virtualTemplate).toBeDefined();
    expect(virtualTemplate!.start).toBe("2026-03-20 22:00");
    expect(virtualTemplate!.end).toBe("2026-03-21 07:00");

    // Check expanded instances also preserve cross-midnight
    const virtualInstances = result.events.filter((e) =>
      e.recurringParentId === `__vf__${template.id}`,
    );
    for (const vi of virtualInstances) {
      expect(vi.start.split(" ")[1]).toBe("22:00");
      expect(vi.end.split(" ")[1]).toBe("07:00");
      // End date should be day after start date
      const startDate = vi.start.split(" ")[0];
      const endDate = vi.end.split(" ")[0];
      expect(endDate).not.toBe(startDate);
    }
  });
});
