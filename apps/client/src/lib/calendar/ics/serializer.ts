import type { Calendar, CalendarEvent } from "$lib/components/calendar/types";

/**
 * Serialize a calendar plus its events into a single `.ics` string ready to
 * be written to disk. Emits one VCALENDAR with stub VTIMEZONE blocks for each
 * unique IANA zone referenced and one VEVENT per master event, with extra
 * VEVENTs for per-instance overrides (RECURRENCE-ID).
 *
 * Implementation lives in step 3 of the import/export plan; the signature is
 * stable so dependent UI code can be wired up without waiting on the body.
 *
 * @param calendar - The calendar being exported (used for X-WR-CALNAME, etc.).
 * @param events - Master events plus their attached overrides.
 * @returns A complete RFC 5545 `.ics` file as a string.
 */
export function serializeCalendarToIcs(calendar: Calendar, events: CalendarEvent[]): string {
	void calendar;
	void events;
	return "";
}
