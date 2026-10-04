import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./types";
import { eventMatchesActiveOccurrence, exactOccurrenceId, rootIdForEvent, sameConcreteOccurrence } from "./occurrence-protection";

/** Native provenance deliberately differs from the moved display date. */
function occurrence(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: "source::2026-05-20", recurringParentId: "source", recurrenceDate: "2026-05-20",
    title: "Moved", start: "2026-06-01 00:30", end: "2026-06-01 01:30",
    timezone: "America/New_York", calendarId: "local", ...overrides };
}

describe("native occurrence presentation identity", () => {
  it("matches a moved occurrence by its accepted original identity and rejects displayed-day substitutes", () => {
    const event = occurrence();
    expect(exactOccurrenceId(event)).toBe("source::2026-05-20");
    expect(eventMatchesActiveOccurrence(event, { blockId: "source::2026-05-20" })).toBe(true);
    expect(eventMatchesActiveOccurrence(event, { blockId: "source::2026-06-01" })).toBe(false);
    expect(eventMatchesActiveOccurrence(event, undefined)).toBe(false);
  });

  it("keeps an unqualified accepted anchor distinct from later members of its family", () => {
    const anchor = occurrence({ id: "source", recurrenceDate: "2026-05-01",
      recurrence: { frequency: "daily", interval: 1, end: { type: "never" } } });
    expect(eventMatchesActiveOccurrence(anchor, { blockId: "source" })).toBe(true);
    expect(eventMatchesActiveOccurrence(anchor, { blockId: "source::2026-05-01" })).toBe(true);
    expect(eventMatchesActiveOccurrence(occurrence(), { blockId: "source" })).toBe(false);
  });

  it("compares first-occurrence aliases using home provenance rather than their rendered dates", () => {
    const template = occurrence({ id: "source", recurringParentId: undefined,
      recurrence: { frequency: "daily", interval: 1, end: { type: "never" } } });
    const synthetic = occurrence({ start: "2026-05-21 03:30", end: "2026-05-21 04:30" });
    expect(sameConcreteOccurrence(template, synthetic)).toBe(true);
    expect(sameConcreteOccurrence(template, occurrence({ id: "source::2026-05-21", recurrenceDate: "2026-05-21" }))).toBe(false);
  });

  it("preserves opaque source IDs containing separators", () => {
    const template = occurrence({ id: "import::preserved", recurringParentId: undefined,
      recurrence: { frequency: "daily", interval: 1, end: { type: "never" } } });
    const member = occurrence({ id: "import::preserved::2026-05-20", recurringParentId: "import::preserved" });
    expect(rootIdForEvent(template)).toBe("import::preserved");
    expect(exactOccurrenceId(template)).toBe(member.id);
    expect(sameConcreteOccurrence(template, member)).toBe(true);
  });
});
