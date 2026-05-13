// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "$lib/components/calendar/types";
import { buildBulkImportPayload } from "./calendar-bulk-import";

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

describe("buildBulkImportPayload", () => {
  it("builds a DB-ready payload with generated candidate ids", () => {
    const payload = buildBulkImportPayload(
      [
        makeEvent({ sourceUid: "a" }),
        makeEvent({ sourceUid: "b" }),
      ],
      CAL,
      NOW,
      ZONE,
      deterministicIds(),
    );

    expect(payload.targetCalendarId).toBe(CAL);
    expect(payload.now).toBe(NOW);
    expect(payload.events.map((event) => event.candidateId)).toEqual([
      "new-1",
      "new-2",
    ]);
    expect(payload.events.map((event) => event.sourceUid)).toEqual(["a", "b"]);
  });

  it("converts event fields into the Rust import DTO shape", () => {
    const payload = buildBulkImportPayload(
      [
        makeEvent({
          color: 4,
          description: "Details",
          notifications: [15, 30],
          exceptions: ["2026-05-02"],
          allDay: true,
          location: "Office",
          url: "https://example.com",
          transparency: "transparent",
          status: "tentative",
          visibility: "private",
          priority: 3,
          categories: ["work"],
          geo: { lat: 1, lng: 2 },
          rdate: ["2026-05-03"],
          extendedProperties: { "X-TEST": "yes" },
          organizer: { email: "owner@example.com", name: "Owner" },
          guestPermissions: {
            canModify: true,
            canInviteOthers: false,
            canSeeOtherGuests: false,
          },
        }),
      ],
      CAL,
      NOW,
      ZONE,
      deterministicIds(),
    );

    const event = payload.events[0];
    expect(event.color).toBe(4);
    expect(event.description).toBe("Details");
    expect(event.notifications).toBe("[15,30]");
    expect(event.exceptions).toBe("[\"2026-05-02\"]");
    expect(event.allDay).toBe(true);
    expect(event.location).toBe("Office");
    expect(event.url).toBe("https://example.com");
    expect(event.transparency).toBe("transparent");
    expect(event.status).toBe("tentative");
    expect(event.visibility).toBe("private");
    expect(event.priority).toBe(3);
    expect(event.categories).toBe("[\"work\"]");
    expect(event.geo).toBe("{\"lat\":1,\"lng\":2}");
    expect(event.rdate).toBe("[\"2026-05-03\"]");
    expect(event.extendedProperties).toBe("{\"X-TEST\":\"yes\"}");
    expect(event.organizer).toBe("{\"email\":\"owner@example.com\",\"name\":\"Owner\"}");
    expect(event.guestCanModify).toBe(true);
    expect(event.guestCanInviteOthers).toBe(false);
    expect(event.guestCanSeeOtherGuests).toBe(false);
  });

  it("maps attendees, alarms, and overrides without SQL assembly", () => {
    const payload = buildBulkImportPayload(
      [
        makeEvent({
          attendees: [
            {
              id: "att-1",
              name: "User",
              email: "user@example.com",
              role: "req-participant",
              status: "accepted",
              rsvp: true,
            },
          ],
          alarms: [
            {
              id: "alarm-1",
              action: "display",
              triggerType: "relative",
              triggerValue: "-PT15M",
              description: "Reminder",
            },
          ],
          overrides: [
            {
              id: "override-1",
              parentEventId: "ignored",
              recurrenceId: "2026-05-01T10:00:00Z",
              title: "Moved",
              start: "2026-05-01 12:00",
              end: "2026-05-01 13:00",
              color: 2,
              status: "confirmed",
              transparency: "opaque",
              visibility: "public",
              extendedProperties: { "X-OVERRIDE": "yes" },
            },
          ],
        }),
      ],
      CAL,
      NOW,
      ZONE,
      deterministicIds(),
    );

    const event = payload.events[0];
    expect(event.attendees).toEqual([
      {
        id: "att-1",
        name: "User",
        email: "user@example.com",
        role: "req-participant",
        status: "accepted",
        rsvp: true,
      },
    ]);
    expect(event.alarms).toEqual([
      {
        id: "alarm-1",
        action: "display",
        triggerType: "relative",
        triggerValue: "-PT15M",
        description: "Reminder",
      },
    ]);
    expect(event.overrides[0]).toMatchObject({
      id: "override-1",
      recurrenceId: "2026-05-01T10:00:00Z",
      title: "Moved",
      color: 2,
      status: "confirmed",
      transparency: "opaque",
      visibility: "public",
      extendedProperties: "{\"X-OVERRIDE\":\"yes\"}",
    });
    expect(event.overrides[0].startTime).toBe("2026-05-01T12:00:00Z");
    expect(event.overrides[0].endTime).toBe("2026-05-01T13:00:00Z");
  });

  it("omits empty optional JSON fields", () => {
    const payload = buildBulkImportPayload(
      [makeEvent({ notifications: [], categories: [], extendedProperties: {} })],
      CAL,
      NOW,
      ZONE,
      deterministicIds(),
    );

    const event = payload.events[0];
    expect(event.notifications).toBeNull();
    expect(event.categories).toBeNull();
    expect(event.extendedProperties).toBeNull();
  });

  it("sanitizes imported event and override descriptions before persistence", () => {
    const payload = buildBulkImportPayload(
      [
        makeEvent({
          description:
            '<p onclick="alert(1)">Safe <strong>text</strong><script>alert(1)</script></p>',
          overrides: [
            {
              id: "override-1",
              parentEventId: "ignored",
              recurrenceId: "2026-05-01T10:00:00Z",
              description: '<img src=x onerror="alert(1)"><u>Override</u>',
            },
          ],
        }),
      ],
      CAL,
      NOW,
      ZONE,
      deterministicIds(),
    );

    const event = payload.events[0];
    expect(event.description).toBe("<p>Safe <strong>text</strong></p>");
    expect(event.overrides[0].description).toBe("<u>Override</u>");
  });
});
