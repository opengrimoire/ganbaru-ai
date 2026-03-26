import { describe, it, expect } from "vitest";
import type { CalendarEvent } from "./types";
import {
  closedDisplay,
  buildCreateDisplay,
  applyNonRecurring,
  applyThis,
  applyAll,
  applyFollowing,
  dateDiffDays,
  shiftDateStr,
  PENDING_CREATE_ID,
} from "./display-events";

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

describe("buildCreateDisplay", () => {
  it("injects create pseudo-event", () => {
    const events = [makeEvent()];
    const preview = { dateStr: "2026-03-20", startMinute: 600, endMinute: 660 };
    const result = buildCreateDisplay(events, preview, {});
    expect(result.events.length).toBe(2);
    expect(result.editingId).toBe(PENDING_CREATE_ID);
    expect(result.previewedIds.has(PENDING_CREATE_ID)).toBe(true);

    const created = result.events.find((e) => e.id === PENDING_CREATE_ID);
    expect(created).toBeDefined();
    expect(created!.start).toBe("2026-03-20 10:00");
    expect(created!.end).toBe("2026-03-20 11:00");
  });

  it("expands recurring create preview", () => {
    const events: CalendarEvent[] = [];
    const preview = {
      dateStr: "2026-03-20",
      startMinute: 600,
      endMinute: 660,
      recurrence: { frequency: "daily" as const, interval: 1, end: { type: "never" as const } },
    };
    const result = buildCreateDisplay(events, preview, {});
    // Template + expanded instances
    expect(result.events.length).toBeGreaterThan(1);
    expect(result.previewedIds.size).toBeGreaterThan(1);
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
});

describe("applyThis", () => {
  it("only modifies the target instance", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");
    const inst21 = makeInstance(template, "2026-03-21");
    const events = [template, inst20, inst21];

    const result = applyThis(events, inst20, inst20, { title: "Changed" });

    expect(result.editingId).toBe(inst20.id);
    expect(result.previewedIds.size).toBe(1);
    expect(result.previewedIds.has(inst20.id)).toBe(true);

    const modified = result.events.find((e) => e.id === inst20.id)!;
    expect(modified.title).toBe("Changed");

    // Siblings unchanged
    const sibling = result.events.find((e) => e.id === inst21.id)!;
    expect(sibling.title).toBe("Daily standup");
  });
});

describe("applyAll", () => {
  it("patches all instances via re-expansion", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");
    const events = [template, inst20];

    const result = applyAll(
      [template], events, template.id, inst20,
      { title: "All changed" },
    );

    expect(result.previewedIds.size).toBeGreaterThan(1);
    for (const e of result.events) {
      if (e.id === template.id || e.recurringParentId === template.id) {
        expect(e.title).toBe("All changed");
      }
    }
  });

  it("shifts template dates by day delta", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");
    const events = [template, inst20];

    const result = applyAll(
      [template], events, template.id, inst20,
      { start: "2026-03-22 09:00", end: "2026-03-22 09:30" },
    );

    // Template should have shifted by +2 days (20 -> 22)
    const tmpl = result.events.find((e) => e.id === template.id)!;
    expect(tmpl.start).toBe("2026-03-17 09:00"); // 15 + 2 = 17
    expect(tmpl.end).toBe("2026-03-17 09:30");
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

  it("sets editingId to the virtual instance on the target date", () => {
    const template = makeRecurringTemplate();
    const inst20 = makeInstance(template, "2026-03-20");
    const events = [template, inst20];

    const result = applyFollowing(
      [template], events, template.id, inst20,
      { title: "Future" },
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
