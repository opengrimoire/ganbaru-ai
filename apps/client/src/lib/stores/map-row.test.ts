import { describe, it, expect, vi } from "vitest";
import { mapRow, type DbCalendarEvent } from "./map-row";

function makeDbRow(overrides: Partial<DbCalendarEvent> = {}): DbCalendarEvent {
  return {
    id: "evt-1",
    title: "Test event",
    start_time: "2026-03-15 09:00:00",
    end_time: "2026-03-15 10:00:00",
    timezone: "America/New_York",
    calendar_id: "local",
    color: null,
    description: "",
    rrule: null,
    notifications: null,
    exceptions: null,
    repeat_until: null,
    all_day: 0,
    location: "",
    url: "",
    transparency: "opaque",
    status: "confirmed",
    source_uid: null,
    visibility: "public",
    priority: null,
    categories: null,
    geo: null,
    sequence: 0,
    rdate: null,
    extended_properties: null,
    organizer: null,
    guest_can_modify: 0,
    guest_can_invite_others: 1,
    guest_can_see_other_guests: 1,
    focus_duration_minutes: null,
    short_break_minutes: null,
    long_break_minutes: null,
    pomodoro_count: null,
    idle_timeout_minutes: null,
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
    expect(result.description).toBeUndefined();
    expect(result.recurrence).toBeUndefined();
    expect(result.notifications).toBeUndefined();
    expect(result.exceptions).toBeUndefined();
    expect(result.allDay).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.url).toBeUndefined();
    expect(result.transparency).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.pomodoroConfig).toBeUndefined();
  });

  it("returns undefined for default icalendar fields", () => {
    const result = mapRow(makeDbRow());
    expect(result.sourceUid).toBeUndefined();
    expect(result.visibility).toBeUndefined();
    expect(result.priority).toBeUndefined();
    expect(result.categories).toBeUndefined();
    expect(result.geo).toBeUndefined();
    expect(result.sequence).toBeUndefined();
    expect(result.rdate).toBeUndefined();
    expect(result.extendedProperties).toBeUndefined();
    expect(result.organizer).toBeUndefined();
  });

  it("deserializes sourceUid", () => {
    const result = mapRow(makeDbRow({ source_uid: "abc123@google.com" }));
    expect(result.sourceUid).toBe("abc123@google.com");
  });

  it("deserializes visibility when not public", () => {
    expect(mapRow(makeDbRow({ visibility: "public" })).visibility).toBeUndefined();
    expect(mapRow(makeDbRow({ visibility: "private" })).visibility).toBe("private");
    expect(mapRow(makeDbRow({ visibility: "confidential" })).visibility).toBe("confidential");
  });

  it("deserializes priority", () => {
    expect(mapRow(makeDbRow({ priority: null })).priority).toBeUndefined();
    expect(mapRow(makeDbRow({ priority: 0 })).priority).toBe(0);
    expect(mapRow(makeDbRow({ priority: 5 })).priority).toBe(5);
    expect(mapRow(makeDbRow({ priority: 9 })).priority).toBe(9);
  });

  it("deserializes categories JSON", () => {
    const result = mapRow(makeDbRow({ categories: '["work","meeting"]' }));
    expect(result.categories).toEqual(["work", "meeting"]);
  });

  it("deserializes geo JSON", () => {
    const result = mapRow(makeDbRow({ geo: '{"lat":37.7749,"lng":-122.4194}' }));
    expect(result.geo).toEqual({ lat: 37.7749, lng: -122.4194 });
  });

  it("deserializes sequence when non-zero", () => {
    expect(mapRow(makeDbRow({ sequence: 0 })).sequence).toBeUndefined();
    expect(mapRow(makeDbRow({ sequence: 3 })).sequence).toBe(3);
  });

  it("deserializes rdate JSON", () => {
    const result = mapRow(makeDbRow({ rdate: '["2026-04-01","2026-05-01"]' }));
    expect(result.rdate).toEqual(["2026-04-01", "2026-05-01"]);
  });

  it("deserializes extended_properties JSON", () => {
    const result = mapRow(makeDbRow({
      extended_properties: '{"X-GOOGLE-CONFERENCE":"https://meet.google.com/abc"}',
    }));
    expect(result.extendedProperties).toEqual({
      "X-GOOGLE-CONFERENCE": "https://meet.google.com/abc",
    });
  });

  it("deserializes organizer JSON", () => {
    const result = mapRow(makeDbRow({
      organizer: '{"name":"John Doe","email":"john@example.com"}',
    }));
    expect(result.organizer).toEqual({ name: "John Doe", email: "john@example.com" });
  });

  it("deserializes organizer without name", () => {
    const result = mapRow(makeDbRow({
      organizer: '{"email":"john@example.com"}',
    }));
    expect(result.organizer).toEqual({ email: "john@example.com" });
  });

  it("handles malformed JSON gracefully", () => {
    const result = mapRow(makeDbRow({
      categories: "not valid json",
      geo: "{broken",
      rdate: "{{",
      extended_properties: "nope",
      organizer: "bad",
      notifications: "[invalid",
      exceptions: "x",
    }));
    expect(result.categories).toBeUndefined();
    expect(result.geo).toBeUndefined();
    expect(result.rdate).toBeUndefined();
    expect(result.extendedProperties).toBeUndefined();
    expect(result.organizer).toBeUndefined();
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

  it("maps location and url when non-empty", () => {
    const result = mapRow(makeDbRow({ location: "Room A", url: "https://meet.example.com" }));
    expect(result.location).toBe("Room A");
    expect(result.url).toBe("https://meet.example.com");
  });

  it("returns undefined guestPermissions for defaults (canModify=false, canInvite=true, canSee=true)", () => {
    const result = mapRow(makeDbRow());
    expect(result.guestPermissions).toBeUndefined();
  });

  it("maps guestPermissions when canModify is true", () => {
    const result = mapRow(makeDbRow({ guest_can_modify: 1 }));
    expect(result.guestPermissions).toEqual({
      canModify: true,
      canInviteOthers: true,
      canSeeOtherGuests: true,
    });
  });

  it("maps guestPermissions when canInviteOthers is false", () => {
    const result = mapRow(makeDbRow({ guest_can_invite_others: 0 }));
    expect(result.guestPermissions).toEqual({
      canModify: false,
      canInviteOthers: false,
      canSeeOtherGuests: true,
    });
  });

  it("maps guestPermissions when canSeeOtherGuests is false", () => {
    const result = mapRow(makeDbRow({ guest_can_see_other_guests: 0 }));
    expect(result.guestPermissions).toEqual({
      canModify: false,
      canInviteOthers: true,
      canSeeOtherGuests: false,
    });
  });

  it("maps guestPermissions with all non-default values", () => {
    const result = mapRow(makeDbRow({
      guest_can_modify: 1,
      guest_can_invite_others: 0,
      guest_can_see_other_guests: 0,
    }));
    expect(result.guestPermissions).toEqual({
      canModify: true,
      canInviteOthers: false,
      canSeeOtherGuests: false,
    });
  });
});
