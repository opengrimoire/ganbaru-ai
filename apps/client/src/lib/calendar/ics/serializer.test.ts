import { describe, expect, it } from "vitest";
import type { Calendar, CalendarEvent } from "$lib/components/calendar/types";
import { serializeCalendarToIcs } from "./serializer";

const baseCalendar: Calendar = {
	id: "cal-1",
	name: "Test Calendar",
	color: "",
	source: "ics",
	visible: true,
	readOnly: false,
};

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
	return {
		id: "ev-1",
		title: "Sample",
		start: "2026-06-01 14:00",
		end: "2026-06-01 15:00",
		timezone: "UTC",
		calendarId: "cal-1",
		sourceUid: "sample-uid@ganbaruai",
		...overrides,
	};
}

/**
 * Unfold long lines per RFC 5545 (continuation lines start with a single
 * space or tab). Used so substring assertions match the logical content.
 */
function unfold(ics: string): string {
	return ics.replace(/\r\n[ \t]/g, "");
}

describe("serializeCalendarToIcs", () => {
	describe("VCALENDAR envelope", () => {
		it("emits BEGIN/END VCALENDAR with required headers", () => {
			const ics = serializeCalendarToIcs(baseCalendar, [makeEvent()], "UTC");
			expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
			expect(ics).toContain("PRODID:-//GanbaruAI//Calendar//EN");
			expect(ics).toContain("VERSION:2.0");
			expect(ics).toContain("CALSCALE:GREGORIAN");
			expect(ics).toContain(`X-WR-CALNAME:${baseCalendar.name}`);
			expect(ics.trimEnd()).toMatch(/END:VCALENDAR$/);
		});

		it("uses CRLF line endings", () => {
			const ics = serializeCalendarToIcs(baseCalendar, [makeEvent()], "UTC");
			const lfOnlyCount = (ics.match(/(?<!\r)\n/g) ?? []).length;
			expect(lfOnlyCount).toBe(0);
		});
	});

	describe("DTSTART/DTEND emission", () => {
		it("emits non-recurring zoned events as UTC Z", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[makeEvent({ timezone: "UTC" })],
				"UTC",
			);
			expect(ics).toContain("DTSTART:20260601T140000Z");
			expect(ics).toContain("DTEND:20260601T150000Z");
		});

		it("emits all-day events with an exclusive VALUE=DATE end", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						allDay: true,
						start: "2026-06-01 00:00",
						end: "2026-06-05 00:00",
					}),
				],
				"UTC",
			);
			expect(ics).toContain("DTSTART;VALUE=DATE:20260601");
			expect(ics).toContain("DTEND;VALUE=DATE:20260606");
		});

		it("emits single-day all-day events with the next date as DTEND", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						allDay: true,
						start: "2026-05-13 00:00",
						end: "2026-05-13 00:00",
					}),
				],
				"UTC",
			);
			expect(ics).toContain("DTSTART;VALUE=DATE:20260513");
			expect(ics).toContain("DTEND;VALUE=DATE:20260514");
		});

		it("emits recurring zoned events with TZID and wall clock", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						timezone: "America/New_York",
						start: "2026-04-15 09:00",
						end: "2026-04-15 10:00",
						recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
					}),
				],
				"America/New_York",
			);
			expect(ics).toContain("DTSTART;TZID=America/New_York:20260415T090000");
			expect(ics).toContain("DTEND;TZID=America/New_York:20260415T100000");
			expect(ics).toContain("RRULE:FREQ=DAILY");
		});

		it("emits recurring UTC events as UTC Z (no VTIMEZONE block)", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						timezone: "UTC",
						recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
					}),
				],
				"UTC",
			);
			expect(ics).toContain("DTSTART:20260601T140000Z");
			expect(ics).not.toContain("BEGIN:VTIMEZONE");
		});
	});

	describe("VTIMEZONE stubs", () => {
		it("emits a VTIMEZONE block per unique zone among recurring events", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						sourceUid: "ny@ex",
						timezone: "America/New_York",
						start: "2026-04-15 09:00",
						end: "2026-04-15 10:00",
						recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
					}),
					makeEvent({
						sourceUid: "tokyo@ex",
						timezone: "Asia/Tokyo",
						start: "2026-04-15 09:00",
						end: "2026-04-15 10:00",
						recurrence: { frequency: "weekly", interval: 1, end: { type: "never" } },
					}),
				],
				"UTC",
			);
			expect(ics).toContain("TZID:America/New_York");
			expect(ics).toContain("TZID:Asia/Tokyo");
			const nyMatches = ics.match(/TZID:America\/New_York/g) ?? [];
			expect(nyMatches.length).toBeGreaterThanOrEqual(1);
		});

		it("does not emit a VTIMEZONE block for non-recurring events", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						timezone: "America/New_York",
						start: "2026-04-15 09:00",
						end: "2026-04-15 10:00",
					}),
				],
				"America/New_York",
			);
			expect(ics).not.toContain("BEGIN:VTIMEZONE");
		});

		it("VTIMEZONE stub has the correct UTC offset for the zone", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						timezone: "Asia/Tokyo",
						start: "2026-04-15 09:00",
						end: "2026-04-15 10:00",
						recurrence: { frequency: "daily", interval: 1, end: { type: "never" } },
					}),
				],
				"UTC",
			);
			expect(ics).toContain("TZID:Asia/Tokyo");
			expect(ics).toContain("TZOFFSETFROM:+0900");
			expect(ics).toContain("TZOFFSETTO:+0900");
		});
	});

	describe("text escaping", () => {
		it("escapes backslash, comma, semicolon, and newline in TEXT values", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						title: "Title; with, special\\chars\nand newline",
					}),
				],
				"UTC",
			);
			expect(ics).toContain("SUMMARY:Title\\; with\\, special\\\\chars\\nand newline");
		});

		it("does not escape URL values", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[makeEvent({ url: "https://meet.example.com/xyz?id=1&t=2" })],
				"UTC",
			);
			expect(ics).toContain("URL:https://meet.example.com/xyz?id=1&t=2");
		});
	});

	describe("optional fields", () => {
		it("emits STATUS, TRANSP, CLASS, PRIORITY, SEQUENCE", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						status: "tentative",
						transparency: "transparent",
						visibility: "private",
						priority: 5,
						sequence: 3,
					}),
				],
				"UTC",
			);
			expect(ics).toContain("STATUS:TENTATIVE");
			expect(ics).toContain("TRANSP:TRANSPARENT");
			expect(ics).toContain("CLASS:PRIVATE");
			expect(ics).toContain("PRIORITY:5");
			expect(ics).toContain("SEQUENCE:3");
		});

		it("emits CATEGORIES and GEO", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						categories: ["Work", "Team"],
						geo: { lat: 40.7128, lng: -74.006 },
					}),
				],
				"UTC",
			);
			expect(ics).toContain("CATEGORIES:Work,Team");
			expect(ics).toContain("GEO:40.7128;-74.006");
		});

		it("emits ORGANIZER and ATTENDEE properties", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						organizer: { name: "Alice", email: "alice@example.com" },
						attendees: [
							{
								id: "a1",
								name: "Bob",
								email: "bob@example.com",
								role: "req-participant",
								status: "accepted",
								rsvp: true,
							},
						],
					}),
				],
				"UTC",
			);
			const unfolded = unfold(ics);
			expect(unfolded).toContain("ORGANIZER;CN=Alice:mailto:alice@example.com");
			expect(unfolded).toContain(
				"ATTENDEE;CN=Bob;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:bob@example.com",
			);
		});

		it("emits VALARM blocks", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						alarms: [
							{
								id: "al1",
								action: "display",
								triggerType: "relative",
								triggerValue: "-PT15M",
								description: "Reminder",
							},
						],
					}),
				],
				"UTC",
			);
			expect(ics).toContain("BEGIN:VALARM");
			expect(ics).toContain("ACTION:DISPLAY");
			expect(ics).toContain("DESCRIPTION:Reminder");
			expect(ics).toContain("TRIGGER:-PT15M");
			expect(ics).toContain("END:VALARM");
		});

		it("emits X-* extended properties and X-GOOGLE-GUEST-* permissions", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						extendedProperties: { "X-CUSTOM": "custom-value" },
						guestPermissions: {
							canModify: false,
							canInviteOthers: false,
							canSeeOtherGuests: true,
						},
					}),
				],
				"UTC",
			);
			expect(ics).toContain("X-CUSTOM:custom-value");
			expect(ics).toContain("X-GOOGLE-GUEST-CAN-MODIFY:FALSE");
			expect(ics).toContain("X-GOOGLE-GUEST-CAN-INVITE-OTHERS:FALSE");
			expect(ics).toContain("X-GOOGLE-GUEST-CAN-SEE-OTHER-GUESTS:TRUE");
		});
	});

	describe("recurrence and overrides", () => {
		it("emits EXDATE for exceptions", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 5 } },
						exceptions: ["2026-06-02", "2026-06-04"],
					}),
				],
				"UTC",
			);
			expect(ics).toContain("EXDATE:20260602T000000Z,20260604T000000Z");
		});

		it("emits RDATE", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						rdate: ["2026-07-05T10:00:00.000Z", "2026-07-12T10:00:00.000Z"],
					}),
				],
				"UTC",
			);
			expect(ics).toContain("RDATE:20260705T100000Z,20260712T100000Z");
		});

		it("emits a separate VEVENT per override with RECURRENCE-ID", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[
					makeEvent({
						sourceUid: "rec@ex",
						recurrence: { frequency: "daily", interval: 1, end: { type: "count", count: 5 } },
						overrides: [
							{
								id: "ov1",
								parentEventId: "ev-1",
								recurrenceId: "2026-06-03T14:00:00.000Z",
								title: "Adjusted",
							},
						],
					}),
				],
				"UTC",
			);
			const veventCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
			expect(veventCount).toBe(2);
			expect(ics).toContain("RECURRENCE-ID:20260603T140000Z");
			expect(ics).toContain("SUMMARY:Adjusted");
		});
	});

	describe("UID fallback", () => {
		it("uses event.id as UID when sourceUid is absent", () => {
			const ics = serializeCalendarToIcs(
				baseCalendar,
				[makeEvent({ sourceUid: undefined, id: "internal-id-123" })],
				"UTC",
			);
			expect(ics).toContain("UID:internal-id-123");
		});
	});

	describe("line folding", () => {
		it("folds lines longer than 75 octets", () => {
			const longTitle = "X".repeat(200);
			const ics = serializeCalendarToIcs(baseCalendar, [makeEvent({ title: longTitle })], "UTC");
			const lines = ics.split("\r\n");
			for (const line of lines) {
				if (line.startsWith(" ")) continue;
				expect(line.length).toBeLessThanOrEqual(75);
			}
		});
	});
});
