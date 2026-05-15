import { describe, it, expect, vi } from "vitest";
import {
  mapOverride,
  mapRow as mapRowImpl,
  type DbCalendarEvent,
  type DbOverride,
} from "./map-row";

// Tests fix the render zone so legacy-format inputs round-trip 1:1 with the
// stored wall-clock string (the conversion path only kicks in for UTC ISO
// values, which these tests don't exercise; see utils.test.ts for those).
const TEST_ZONE = "America/New_York";
function mapRow(r: DbCalendarEvent) {
  return mapRowImpl(r, TEST_ZONE);
}

function makeDbRow(overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent {
  return {
    id: "evt-1",
    title: "Test event",
    start_time: "2026-03-15 09:00:00",
    end_time: "2026-03-15 10:00:00",
    timezone: "America/New_York",
    calendar_id: "local",
    color: null,
    rrule: null,
    notifications: null,
    exceptions: null,
    repeat_until: null,
    all_day: 0,
    location: "",
    meeting_enabled: 0,
    transparency: "opaque",
    status: "confirmed",
    local_rsvp_status: null,
    rdate: null,
    focus_duration_minutes: null,
    short_break_minutes: null,
    long_break_minutes: null,
    pomodoro_count: null,
    idle_timeout_minutes: null,
    ...overrides,
  };
}

function makeDbOverride(overrides: Partial<DbOverride> = {}): DbOverride {
  return {
    id: "override-1",
    parent_event_id: "evt-1",
    recurrence_id: "2026-05-01T00:00:00Z",
    recurrence_range: null,
    title: null,
    start_time: "2026-05-01T00:00:00Z",
    end_time: "2026-05-01T00:00:00Z",
    color: null,
    status: null,
    transparency: null,
    ...overrides,
  };
}

describe("mapRow", () => {
  it("maps basic fields correctly", () => {
    const result = mapRow(makeDbRow());
    expect(result.id).toBe("evt-1");
    expect(result.title).toBe("Test event");
    expect(result.start).toBe("2026-03-15 09:00");
    expect(result.end).toBe("2026-03-15 10:00");
    expect(result.timezone).toBe("America/New_York");
    expect(result.calendarId).toBe("local");
  });

  it("returns undefined for default values", () => {
    const result = mapRow(makeDbRow());
    expect(result.color).toBeUndefined();
    expect(result.recurrence).toBeUndefined();
    expect(result.notifications).toBeUndefined();
    expect(result.exceptions).toBeUndefined();
    expect(result.allDay).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.transparency).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.pomodoroConfig).toBeUndefined();
    expect(result.rdate).toBeUndefined();
    expect(result.meetingEnabled).toBeUndefined();
  });

  it("maps enabled empty meeting state", () => {
    const result = mapRow(makeDbRow({ meeting_enabled: 1 }));
    expect(result.meetingEnabled).toBe(true);
  });

  it("maps local RSVP status", () => {
    const result = mapRow(makeDbRow({ local_rsvp_status: "tentative" }));
    expect(result.localParticipationStatus).toBe("tentative");
  });

  it("omits heavy fields entirely (loaded on demand by loadFullEvent)", () => {
    const result = mapRow(makeDbRow());
    // These keys must be absent (not just undefined) so spreading the slim
    // event into a patch payload does not accidentally clear DB columns.
    expect("description" in result).toBe(false);
    expect("url" in result).toBe(false);
    expect("sourceUid" in result).toBe(false);
    expect("visibility" in result).toBe(false);
    expect("priority" in result).toBe(false);
    expect("categories" in result).toBe(false);
    expect("geo" in result).toBe(false);
    expect("sequence" in result).toBe(false);
    expect("extendedProperties" in result).toBe(false);
    expect("organizer" in result).toBe(false);
    expect("attendees" in result).toBe(false);
    expect("alarms" in result).toBe(false);
    expect("guestPermissions" in result).toBe(false);
  });

  it("deserializes rdate JSON", () => {
    const result = mapRow(makeDbRow({ rdate: '["2026-04-01","2026-05-01"]' }));
    expect(result.rdate).toEqual(["2026-04-01", "2026-05-01"]);
  });

  it("handles malformed JSON gracefully", () => {
    const result = mapRow(makeDbRow({
      rdate: "{{",
      notifications: "[invalid",
      exceptions: "x",
    }));
    expect(result.rdate).toBeUndefined();
    expect(result.notifications).toBeUndefined();
    expect(result.exceptions).toBeUndefined();
  });

  it("maps all-day events", () => {
    const result = mapRow(makeDbRow({ all_day: 1 }));
    expect(result.allDay).toBe(true);
  });

  it("maps transparency", () => {
    expect(mapRow(makeDbRow({ transparency: "opaque" })).transparency).toBeUndefined();
    expect(mapRow(makeDbRow({ transparency: "transparent" })).transparency).toBe("transparent");
  });

  it("maps non-default status", () => {
    expect(mapRow(makeDbRow({ status: "confirmed" })).status).toBeUndefined();
    expect(mapRow(makeDbRow({ status: "tentative" })).status).toBe("tentative");
    expect(mapRow(makeDbRow({ status: "cancelled" })).status).toBe("cancelled");
  });

  it("maps pomodoro config when present", () => {
    const result = mapRow(makeDbRow({
      focus_duration_minutes: 25,
      short_break_minutes: 5,
      long_break_minutes: 15,
      pomodoro_count: 4,
      idle_timeout_minutes: 1,
    }));
    expect(result.pomodoroConfig).toEqual({
      focusDurationMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      pomodoroCount: 4,
      idleTimeoutMinutes: 1,
    });
  });

  it("maps color", () => {
    expect(mapRow(makeDbRow({ color: 2 })).color).toBe(2);
    expect(mapRow(makeDbRow({ color: null })).color).toBeUndefined();
  });

  it("drops out-of-range color values so render falls back to the default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(mapRow(makeDbRow({ color: 99 })).color).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it("maps location when non-empty", () => {
    const result = mapRow(makeDbRow({ location: "Room A" }));
    expect(result.location).toBe("Room A");
  });
});

describe("mapOverride", () => {
  it("maps all-day override dates without zone shifting", () => {
    const result = mapOverride(makeDbOverride(), TEST_ZONE, true);
    expect(result.start).toBe("2026-05-01 00:00");
    expect(result.end).toBe("2026-05-01 00:00");
  });

  it("maps recurrence range", () => {
    const result = mapOverride(makeDbOverride({ recurrence_range: "this-and-future" }), TEST_ZONE, true);
    expect(result.recurrenceRange).toBe("this-and-future");
  });
});
