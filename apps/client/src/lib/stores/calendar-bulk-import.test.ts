import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "$lib/components/calendar/types";
import {
  buildAlarmInsertStatements,
  buildAttendeeInsertStatements,
  buildBulkImportStatements,
  buildChildDeleteStatements,
  buildEventInsertStatements,
  buildEventUpdateStatements,
  buildOverrideInsertStatements,
  CHILDREN_PER_INSERT,
  classifyImportEvents,
  EVENT_INSERT_PLACEHOLDERS,
  EVENT_UPDATE_BINDS,
  EVENTS_PER_INSERT,
  type ExistingEventRow,
  type ImportClassification,
  type ImportStatement,
} from "./calendar-bulk-import";

const NOW = "2026-04-29 10:00:00";
const ZONE = "UTC";
const CAL = "cal-1";

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "ignored",
    title: "Imported event",
    start: "2026-05-01 10:00",
    end: "2026-05-01 11:00",
    timezone: ZONE,
    calendarId: CAL,
    sourceUid: "uid-1@example.com",
    sequence: 0,
    ...overrides,
  };
}

function deterministicIds(): () => string {
  let i = 0;
  return () => `new-${++i}`;
}

describe("classifyImportEvents", () => {
  it("classifies missing-uid events as warnings and skips them", () => {
    const events = [makeEvent({ sourceUid: undefined })];
    const result = classifyImportEvents(events, [], deterministicIds());
    expect(result.warnings).toEqual(["Event without UID skipped."]);
    expect(result.toAdd).toHaveLength(0);
    expect(result.toUpdate).toHaveLength(0);
    expect(result.skippedOlder).toBe(0);
  });

  it("treats fresh sourceUids as adds and assigns generated ids", () => {
    const events = [makeEvent({ sourceUid: "a" }), makeEvent({ sourceUid: "b" })];
    const result = classifyImportEvents(events, [], deterministicIds());
    expect(result.added).toBe(2);
    expect(result.toAdd.map((a) => a.newId)).toEqual(["new-1", "new-2"]);
  });

  it("treats matching sourceUid with equal sequence as an update (idempotence)", () => {
    const existing: ExistingEventRow[] = [
      { id: "row-1", source_uid: "a", sequence: 0 },
    ];
    const events = [makeEvent({ sourceUid: "a", sequence: 0 })];
    const result = classifyImportEvents(events, existing, deterministicIds());
    expect(result.added).toBe(0);
    expect(result.skippedOlder).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.toUpdate[0].existingId).toBe("row-1");
  });

  it("skips events whose imported sequence is lower than existing", () => {
    const existing: ExistingEventRow[] = [
      { id: "row-1", source_uid: "a", sequence: 5 },
    ];
    const events = [makeEvent({ sourceUid: "a", sequence: 3 })];
    const result = classifyImportEvents(events, existing, deterministicIds());
    expect(result.skippedOlder).toBe(1);
    expect(result.toAdd).toHaveLength(0);
    expect(result.toUpdate).toHaveLength(0);
  });

  it("updates when imported sequence is greater than existing", () => {
    const existing: ExistingEventRow[] = [
      { id: "row-1", source_uid: "a", sequence: 1 },
    ];
    const events = [makeEvent({ sourceUid: "a", sequence: 2 })];
    const result = classifyImportEvents(events, existing, deterministicIds());
    expect(result.updated).toBe(1);
    expect(result.toUpdate[0].existingId).toBe("row-1");
  });

  it("handles a mix of add, update, and skip in one pass", () => {
    const existing: ExistingEventRow[] = [
      { id: "row-a", source_uid: "a", sequence: 0 },
      { id: "row-b", source_uid: "b", sequence: 5 },
    ];
    const events = [
      makeEvent({ sourceUid: "a", sequence: 1 }),
      makeEvent({ sourceUid: "b", sequence: 3 }),
      makeEvent({ sourceUid: "c", sequence: 0 }),
    ];
    const result = classifyImportEvents(events, existing, deterministicIds());
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.skippedOlder).toBe(1);
  });
});

describe("buildEventInsertStatements", () => {
  it("returns no statements for empty input", () => {
    expect(buildEventInsertStatements([], CAL, NOW, ZONE)).toEqual([]);
  });

  it("packs binds into a single multi-row INSERT for small batches", () => {
    const toAdd = [
      { event: makeEvent({ sourceUid: "a" }), newId: "id-a" },
      { event: makeEvent({ sourceUid: "b" }), newId: "id-b" },
    ];
    const statements = buildEventInsertStatements(toAdd, CAL, NOW, ZONE);
    expect(statements).toHaveLength(1);
    expect(statements[0].binds).toHaveLength(EVENT_INSERT_PLACEHOLDERS * 2);
    expect(statements[0].query.startsWith("INSERT INTO calendar_events")).toBe(true);
  });

  it("splits into multiple INSERTs when above EVENTS_PER_INSERT", () => {
    const toAdd = Array.from({ length: EVENTS_PER_INSERT + 3 }, (_, i) => ({
      event: makeEvent({ sourceUid: `uid-${i}` }),
      newId: `id-${i}`,
    }));
    const statements = buildEventInsertStatements(toAdd, CAL, NOW, ZONE);
    expect(statements).toHaveLength(2);
    expect(statements[0].binds).toHaveLength(EVENT_INSERT_PLACEHOLDERS * EVENTS_PER_INSERT);
    expect(statements[1].binds).toHaveLength(EVENT_INSERT_PLACEHOLDERS * 3);
  });
});

describe("buildEventUpdateStatements", () => {
  it("emits one UPDATE per event with EVENT_UPDATE_BINDS placeholders", () => {
    const toUpdate = [
      { event: makeEvent({ sourceUid: "a" }), existingId: "row-a" },
      { event: makeEvent({ sourceUid: "b" }), existingId: "row-b" },
    ];
    const statements = buildEventUpdateStatements(toUpdate, NOW, ZONE);
    expect(statements).toHaveLength(2);
    for (const s of statements) {
      expect(s.binds).toHaveLength(EVENT_UPDATE_BINDS);
      expect(s.query.startsWith("UPDATE calendar_events")).toBe(true);
    }
    expect(statements[0].binds[EVENT_UPDATE_BINDS - 1]).toBe("row-a");
    expect(statements[1].binds[EVENT_UPDATE_BINDS - 1]).toBe("row-b");
  });
});

describe("buildChildDeleteStatements", () => {
  it("returns empty when nothing to update", () => {
    expect(buildChildDeleteStatements([])).toEqual([]);
  });

  it("emits one DELETE per child table and binds the same id list to each", () => {
    const ids = ["a", "b"];
    const statements = buildChildDeleteStatements(ids);
    expect(statements).toHaveLength(3);
    for (const s of statements) {
      expect(s.binds).toEqual(ids);
      expect(s.query.startsWith("DELETE FROM")).toBe(true);
    }
  });
});

describe("buildAttendeeInsertStatements", () => {
  it("returns no statements when no attendees are present", () => {
    const events = [
      { eventId: "e1", event: makeEvent() },
      { eventId: "e2", event: makeEvent() },
    ];
    expect(buildAttendeeInsertStatements(events)).toEqual([]);
  });

  it("emits one row per attendee with a stable sort_order per parent", () => {
    const events = [{
      eventId: "e1",
      event: makeEvent({
        attendees: [
          { id: "a1", email: "a@x", role: "req-participant", status: "needs-action", rsvp: false },
          { id: "a2", email: "b@x", role: "req-participant", status: "accepted", rsvp: true },
        ],
      }),
    }];
    const statements = buildAttendeeInsertStatements(events);
    expect(statements).toHaveLength(1);
    expect(statements[0].binds).toHaveLength(8 * 2);
    expect(statements[0].binds[7]).toBe(0);
    expect(statements[0].binds[15]).toBe(1);
    expect(statements[0].binds[6]).toBe(0);
    expect(statements[0].binds[14]).toBe(1);
  });

  it("chunks attendees across statements when the total exceeds CHILDREN_PER_INSERT", () => {
    const attendees = Array.from({ length: CHILDREN_PER_INSERT + 5 }, (_, i) => ({
      id: `a-${i}`, email: `${i}@x`, role: "req-participant" as const,
      status: "needs-action" as const, rsvp: false,
    }));
    const events = [{ eventId: "e1", event: makeEvent({ attendees }) }];
    const statements = buildAttendeeInsertStatements(events);
    expect(statements).toHaveLength(2);
    expect(statements[0].binds).toHaveLength(8 * CHILDREN_PER_INSERT);
    expect(statements[1].binds).toHaveLength(8 * 5);
  });
});

describe("buildAlarmInsertStatements", () => {
  it("emits 7 binds per alarm and respects CHILDREN_PER_INSERT", () => {
    const alarms = Array.from({ length: CHILDREN_PER_INSERT + 1 }, (_, i) => ({
      id: `al-${i}`, action: "display" as const,
      triggerType: "relative" as const, triggerValue: "-PT15M",
    }));
    const statements = buildAlarmInsertStatements([
      { eventId: "e1", event: makeEvent({ alarms }) },
    ]);
    expect(statements).toHaveLength(2);
    expect(statements[0].binds).toHaveLength(7 * CHILDREN_PER_INSERT);
    expect(statements[1].binds).toHaveLength(7 * 1);
  });
});

describe("buildOverrideInsertStatements", () => {
  it("emits 14 binds per override and converts wall-clock to UTC ISO", () => {
    const events = [{
      eventId: "e1",
      event: makeEvent({
        overrides: [{
          id: "o1",
          parentEventId: "e1",
          recurrenceId: "2026-05-02",
          start: "2026-05-02 14:30",
          end: "2026-05-02 15:30",
        }],
      }),
      zone: "UTC",
    }];
    const statements = buildOverrideInsertStatements(events);
    expect(statements).toHaveLength(1);
    expect(statements[0].binds).toHaveLength(14);
    expect(statements[0].binds[4]).toBe("2026-05-02T14:30:00Z");
    expect(statements[0].binds[5]).toBe("2026-05-02T15:30:00Z");
  });
});

describe("buildBulkImportStatements", () => {
  function classify(opts: {
    add?: number; update?: number; skip?: number; perEventChildren?: number;
  }): ImportClassification {
    const toAdd = Array.from({ length: opts.add ?? 0 }, (_, i) => ({
      event: makeEvent({
        sourceUid: `add-${i}`,
        attendees: opts.perEventChildren
          ? Array.from({ length: opts.perEventChildren }, (_, j) => ({
              id: `att-${i}-${j}`, email: `x@y`, role: "req-participant" as const,
              status: "needs-action" as const, rsvp: false,
            }))
          : undefined,
      }),
      newId: `new-${i}`,
    }));
    const toUpdate = Array.from({ length: opts.update ?? 0 }, (_, i) => ({
      event: makeEvent({ sourceUid: `up-${i}` }),
      existingId: `row-${i}`,
    }));
    return {
      toAdd, toUpdate,
      skippedOlder: opts.skip ?? 0,
      added: toAdd.length, updated: toUpdate.length, warnings: [],
    };
  }

  it("returns the empty list when nothing changes", () => {
    const statements = buildBulkImportStatements(
      classify({}), CAL, NOW, ZONE,
    );
    expect(statements).toEqual([]);
  });

  it("emits insert + delete-children + child-inserts in order for adds and updates", () => {
    const c = classify({ add: 1, update: 1, perEventChildren: 1 });
    const statements = buildBulkImportStatements(c, CAL, NOW, ZONE);
    const queries = statements.map((s: ImportStatement) => s.query.split(/\s+/)[0]);
    expect(queries[0]).toBe("INSERT");
    const insertCount = queries.filter((q) => q === "INSERT").length;
    const deleteCount = queries.filter((q) => q === "DELETE").length;
    const updateCount = queries.filter((q) => q === "UPDATE").length;
    expect(insertCount).toBeGreaterThanOrEqual(2);
    expect(deleteCount).toBe(3);
    expect(updateCount).toBe(1);
  });

  it("re-import idempotence: same input twice produces the same updates and zero adds the second time", () => {
    const events = [makeEvent({ sourceUid: "a", sequence: 0 })];
    const first = classifyImportEvents(events, [], deterministicIds());
    expect(first.added).toBe(1);
    const existing: ExistingEventRow[] = first.toAdd.map((a) => ({
      id: a.newId,
      source_uid: a.event.sourceUid as string,
      sequence: a.event.sequence ?? 0,
    }));
    const second = classifyImportEvents(events, existing, deterministicIds());
    expect(second.added).toBe(0);
    expect(second.skippedOlder).toBe(0);
    expect(second.updated).toBe(1);
    expect(second.toUpdate[0].existingId).toBe(existing[0].id);
  });
});
