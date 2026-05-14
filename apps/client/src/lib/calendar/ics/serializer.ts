import { Temporal } from "@js-temporal/polyfill";
import type {
	Calendar,
	CalendarEvent,
	EventAlarm,
	EventAttendee,
	EventOrganizer,
	EventOverride,
} from "$lib/components/calendar/types";
import { recurrenceToRrule } from "$lib/components/calendar/rrule";
import { wallClockToUtcIso } from "$lib/components/calendar/utils";

const CRLF = "\r\n";
const PRODID = "-//GanbaruAI//Calendar//EN";
const textEncoder = new TextEncoder();

/**
 * Convert an in-memory wall-clock "YYYY-MM-DD HH:MM" pair to a UTC instant.
 * The in-memory representation is anchored to `renderZone` (device zone at
 * load time); we convert back through the same zone so the round trip is
 * lossless.
 */
function toUtcInstant(wallClock: string, renderZone: string, allDay: boolean | undefined): string {
	if (allDay) {
		return `${wallClock.substring(0, 10)}T00:00:00Z`;
	}
	return wallClockToUtcIso(wallClock, renderZone);
}

/**
 * Format a UTC instant as a UTC-Z RFC 5545 datetime, e.g. `20260601T140000Z`.
 */
function formatUtcDateTime(utcIso: string): string {
	const instant = Temporal.Instant.from(utcIso);
	const zoned = instant.toZonedDateTimeISO("UTC");
	return (
		String(zoned.year).padStart(4, "0") +
		String(zoned.month).padStart(2, "0") +
		String(zoned.day).padStart(2, "0") +
		"T" +
		String(zoned.hour).padStart(2, "0") +
		String(zoned.minute).padStart(2, "0") +
		String(zoned.second).padStart(2, "0") +
		"Z"
	);
}

/**
 * Format a UTC instant as a wall-clock RFC 5545 datetime in `zone`, e.g.
 * `20260601T090000`. Used together with `;TZID=` parameters.
 */
function formatZonedDateTime(utcIso: string, zone: string): string {
	const instant = Temporal.Instant.from(utcIso);
	const zoned = instant.toZonedDateTimeISO(zone);
	return (
		String(zoned.year).padStart(4, "0") +
		String(zoned.month).padStart(2, "0") +
		String(zoned.day).padStart(2, "0") +
		"T" +
		String(zoned.hour).padStart(2, "0") +
		String(zoned.minute).padStart(2, "0") +
		String(zoned.second).padStart(2, "0")
	);
}

/**
 * Format a UTC instant as a date-only RFC 5545 string, e.g. `20260601`.
 */
function formatUtcDate(utcIso: string): string {
	return utcIso.substring(0, 10).replace(/-/g, "");
}

function formatDateOnly(calendarDate: string): string {
	return calendarDate.substring(0, 10).replace(/-/g, "");
}

function addDaysToDateOnly(calendarDate: string, days: number): string {
	return Temporal.PlainDate.from(calendarDate.substring(0, 10)).add({ days }).toString();
}

function formatDateTimeOnDate(date: string, timeSource: string): string {
	const time = timeSource.slice(9);
	return `${formatDateOnly(date)}T${time}`;
}

/**
 * Compute the UTC offset (in minutes) of `zone` at the given instant. Used
 * to fill VTIMEZONE STANDARD/DAYLIGHT stub blocks.
 */
function getUtcOffsetMinutes(zone: string, instant: Temporal.Instant): number {
	const zoned = instant.toZonedDateTimeISO(zone);
	return Math.floor(zoned.offsetNanoseconds / 60_000_000_000);
}

function formatUtcOffset(minutes: number): string {
	const sign = minutes >= 0 ? "+" : "-";
	const abs = Math.abs(minutes);
	const h = Math.floor(abs / 60);
	const m = abs % 60;
	return `${sign}${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

/**
 * Build a stub VTIMEZONE block. We do not attempt to encode full DST rules;
 * we emit a single STANDARD subcomponent with the offset at the epoch. This
 * satisfies strict parsers (Outlook) and round-trips because consumers
 * resolve TZID as an IANA name anyway.
 */
function buildVTimezone(zone: string): string[] {
	if (zone === "UTC") return [];
	const offsetEpoch = getUtcOffsetMinutes(zone, Temporal.Instant.from("1970-01-01T00:00:00Z"));
	const offsetStr = formatUtcOffset(offsetEpoch);
	return [
		"BEGIN:VTIMEZONE",
		`TZID:${zone}`,
		"BEGIN:STANDARD",
		"DTSTART:19700101T000000",
		`TZOFFSETFROM:${offsetStr}`,
		`TZOFFSETTO:${offsetStr}`,
		"END:STANDARD",
		"END:VTIMEZONE",
	];
}

/**
 * Escape a TEXT value per RFC 5545 (backslash, semicolon, comma, newline).
 */
function escapeText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "");
}

/**
 * Escape a parameter value per RFC 5545 plus RFC 6868. Parameter escaping is
 * separate from TEXT value escaping.
 */
function escapeParamValue(value: string): string {
	const encoded = value
		.replace(/\^/g, "^^")
		.replace(/"/g, "^'")
		.replace(/\r\n|\r|\n/g, "^n");
	if (/[:;,]/.test(encoded)) return `"${encoded}"`;
	return encoded;
}

function param(name: string, value: string): string {
	return `${name}=${escapeParamValue(value)}`;
}

function utf8ByteLength(value: string): number {
	return textEncoder.encode(value).length;
}

/**
 * Fold lines longer than 75 octets per RFC 5545 without splitting UTF-8
 * code points. Continuation lines include the leading space in the limit.
 */
function foldLine(line: string): string {
	if (utf8ByteLength(line) <= 75) return line;
	const out: string[] = [];
	let current = "";
	let currentBytes = 0;
	for (const char of Array.from(line)) {
		const charBytes = utf8ByteLength(char);
		if (current && currentBytes + charBytes > 75) {
			out.push(current);
			current = ` ${char}`;
			currentBytes = 1 + charBytes;
		} else {
			current += char;
			currentBytes += charBytes;
		}
	}
	if (current) out.push(current);
	return out.join(CRLF);
}

const STATUS_REVERSE: Record<NonNullable<CalendarEvent["status"]>, string> = {
	confirmed: "CONFIRMED",
	tentative: "TENTATIVE",
	cancelled: "CANCELLED",
};

const TRANSP_REVERSE: Record<NonNullable<CalendarEvent["transparency"]>, string> = {
	opaque: "OPAQUE",
	transparent: "TRANSPARENT",
};

const VISIBILITY_REVERSE: Record<NonNullable<CalendarEvent["visibility"]>, string> = {
	public: "PUBLIC",
	private: "PRIVATE",
	confidential: "CONFIDENTIAL",
};

const ROLE_REVERSE: Record<EventAttendee["role"], string> = {
	"chair": "CHAIR",
	"req-participant": "REQ-PARTICIPANT",
	"opt-participant": "OPT-PARTICIPANT",
	"non-participant": "NON-PARTICIPANT",
};

const STATUS_ATTENDEE_REVERSE: Record<EventAttendee["status"], string> = {
	"needs-action": "NEEDS-ACTION",
	"accepted": "ACCEPTED",
	"declined": "DECLINED",
	"tentative": "TENTATIVE",
	"delegated": "DELEGATED",
};

function buildAttendee(att: EventAttendee): string {
	const params: string[] = [];
	if (att.name) params.push(param("CN", att.name));
	params.push(`ROLE=${ROLE_REVERSE[att.role]}`);
	params.push(`PARTSTAT=${STATUS_ATTENDEE_REVERSE[att.status]}`);
	params.push(`RSVP=${att.rsvp ? "TRUE" : "FALSE"}`);
	return `ATTENDEE;${params.join(";")}:mailto:${att.email}`;
}

function buildOrganizer(org: EventOrganizer): string {
	if (org.name) return `ORGANIZER;${param("CN", org.name)}:mailto:${org.email}`;
	return `ORGANIZER:mailto:${org.email}`;
}

function buildRecurrenceId(
	recurrenceIdUtc: string,
	isAllDay: boolean,
	useTzid: boolean,
	homeZone: string,
): string {
	if (isAllDay) return `RECURRENCE-ID;VALUE=DATE:${formatUtcDate(recurrenceIdUtc)}`;
	if (useTzid && homeZone !== "UTC") {
		return `RECURRENCE-ID;TZID=${homeZone}:${formatZonedDateTime(recurrenceIdUtc, homeZone)}`;
	}
	return `RECURRENCE-ID:${formatUtcDateTime(recurrenceIdUtc)}`;
}

function buildExdate(
	event: CalendarEvent,
	isAllDay: boolean,
	useTzid: boolean,
	homeZone: string,
	startUtc: string,
): string | undefined {
	if (!event.exceptions?.length) return undefined;
	if (isAllDay) {
		const exdates = event.exceptions.map((d) => formatDateOnly(d)).join(",");
		return `EXDATE;VALUE=DATE:${exdates}`;
	}

	if (useTzid && homeZone !== "UTC") {
		const localStart = formatZonedDateTime(startUtc, homeZone);
		const exdates = event.exceptions
			.map((d) => formatDateTimeOnDate(d, localStart))
			.join(",");
		return `EXDATE;TZID=${homeZone}:${exdates}`;
	}

	const utcStart = formatUtcDateTime(startUtc);
	const exdates = event.exceptions
		.map((d) => formatDateTimeOnDate(d, utcStart))
		.join(",");
	return `EXDATE:${exdates}`;
}

function buildAlarm(alarm: EventAlarm): string[] {
	const lines = ["BEGIN:VALARM", `ACTION:${alarm.action.toUpperCase()}`];
	if (alarm.description) lines.push(`DESCRIPTION:${escapeText(alarm.description)}`);
	lines.push(`TRIGGER:${alarm.triggerValue}`);
	lines.push("END:VALARM");
	return lines;
}

interface BuildVeventOptions {
	event: CalendarEvent;
	uid: string;
	renderZone: string;
	dtStamp: string;
	useTzid: boolean;
	recurrenceIdUtc?: string;
}

function buildVevent(opts: BuildVeventOptions): string[] {
	const { event, uid, renderZone, dtStamp, useTzid, recurrenceIdUtc } = opts;
	const isAllDay = event.allDay === true;
	const homeZone = event.timezone || "UTC";
	const startUtc = toUtcInstant(event.start, renderZone, isAllDay);
	const endUtc = toUtcInstant(event.end, renderZone, isAllDay);

	const lines: string[] = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${dtStamp}`];

	if (isAllDay) {
		lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(event.start)}`);
		lines.push(`DTEND;VALUE=DATE:${formatDateOnly(addDaysToDateOnly(event.end, 1))}`);
	} else if (useTzid && homeZone !== "UTC") {
		lines.push(`DTSTART;TZID=${homeZone}:${formatZonedDateTime(startUtc, homeZone)}`);
		lines.push(`DTEND;TZID=${homeZone}:${formatZonedDateTime(endUtc, homeZone)}`);
	} else {
		lines.push(`DTSTART:${formatUtcDateTime(startUtc)}`);
		lines.push(`DTEND:${formatUtcDateTime(endUtc)}`);
	}

	if (recurrenceIdUtc) {
		lines.push(buildRecurrenceId(recurrenceIdUtc, isAllDay, useTzid, homeZone));
	}

	lines.push(`SUMMARY:${escapeText(event.title)}`);
	if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
	if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
	if (event.url) lines.push(`URL:${event.url}`);

	if (event.recurrence) {
		lines.push(`RRULE:${recurrenceToRrule(event.recurrence)}`);
	}

	const exdateLine = buildExdate(event, isAllDay, useTzid, homeZone, startUtc);
	if (exdateLine) lines.push(exdateLine);

	if (event.rdate?.length) {
		if (isAllDay) {
			const rdates = event.rdate.map((iso) => formatUtcDate(iso)).join(",");
			lines.push(`RDATE;VALUE=DATE:${rdates}`);
		} else {
			const rdates = event.rdate.map((iso) => formatUtcDateTime(iso)).join(",");
			lines.push(`RDATE:${rdates}`);
		}
	}

	if (event.status) lines.push(`STATUS:${STATUS_REVERSE[event.status]}`);
	if (event.transparency) lines.push(`TRANSP:${TRANSP_REVERSE[event.transparency]}`);
	if (event.visibility) lines.push(`CLASS:${VISIBILITY_REVERSE[event.visibility]}`);
	if (typeof event.priority === "number") lines.push(`PRIORITY:${event.priority}`);
	if (typeof event.sequence === "number") lines.push(`SEQUENCE:${event.sequence}`);
	if (event.categories?.length) lines.push(`CATEGORIES:${event.categories.map(escapeText).join(",")}`);
	if (event.geo) lines.push(`GEO:${event.geo.lat};${event.geo.lng}`);
	if (event.organizer) lines.push(buildOrganizer(event.organizer));
	if (event.attendees?.length) {
		for (const att of event.attendees) lines.push(buildAttendee(att));
	}
	if (event.alarms?.length) {
		for (const alarm of event.alarms) lines.push(...buildAlarm(alarm));
	}
	if (event.guestPermissions) {
		const gp = event.guestPermissions;
		lines.push(`X-GOOGLE-GUEST-CAN-MODIFY:${gp.canModify ? "TRUE" : "FALSE"}`);
		lines.push(`X-GOOGLE-GUEST-CAN-INVITE-OTHERS:${gp.canInviteOthers ? "TRUE" : "FALSE"}`);
		lines.push(`X-GOOGLE-GUEST-CAN-SEE-OTHER-GUESTS:${gp.canSeeOtherGuests ? "TRUE" : "FALSE"}`);
	}
	if (event.extendedProperties) {
		for (const [k, v] of Object.entries(event.extendedProperties)) {
			lines.push(`${k}:${escapeText(v)}`);
		}
	}

	lines.push("END:VEVENT");
	return lines;
}

function buildOverrideVevent(
	parent: CalendarEvent,
	override: EventOverride,
	renderZone: string,
	dtStamp: string,
	useTzid: boolean,
): string[] {
	// Only `title`/`start`/`end` fall back to the parent so the emitted VEVENT
	// always has the RFC-required SUMMARY/DTSTART/DTEND. Optional fields keep
	// the override's exact value (including `undefined`) so a round trip is
	// lossless: an override that "explicitly clears" the parent's location
	// must not re-inherit the parent's location during export.
	const childEvent: CalendarEvent = {
		...parent,
		title: override.title ?? parent.title,
		start: override.start ?? parent.start,
		end: override.end ?? parent.end,
		description: override.description,
		location: override.location,
		url: override.url,
		color: override.color,
		status: override.status,
		transparency: override.transparency,
		visibility: override.visibility,
		extendedProperties: override.extendedProperties,
		recurrence: undefined,
		exceptions: undefined,
		rdate: undefined,
		overrides: undefined,
	};
	if (!parent.sourceUid) {
		throw new Error("Cannot serialize override for parent without a sourceUid (UID).");
	}
	return buildVevent({
		event: childEvent,
		uid: parent.sourceUid,
		renderZone,
		dtStamp,
		useTzid,
		recurrenceIdUtc: override.recurrenceId,
	});
}

/**
 * Serialize a calendar plus its events into a single `.ics` string ready to
 * be written to disk. Emits VTIMEZONE stubs for each unique IANA zone among
 * recurring events, plus one VEVENT per master and one VEVENT per override.
 *
 * Non-recurring zoned events are emitted as UTC (`DTSTART:...Z`); recurring
 * ones use `DTSTART;TZID=<zone>:...` so RRULE expansion stays anchored to
 * the correct wall clock through DST.
 *
 * @param calendar - The calendar being exported (used for X-WR-CALNAME).
 * @param events - Master events plus their attached overrides.
 * @param renderZone - The zone in which `event.start`/`event.end` are
 *                    expressed (defaults to the device's IANA zone).
 */
export function serializeCalendarToIcs(
	calendar: Calendar,
	events: CalendarEvent[],
	renderZone?: string,
): string {
	const zone = renderZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
	const dtStamp = formatUtcDateTime(new Date().toISOString());

	const recurringZones = new Set<string>();
	for (const ev of events) {
		if (ev.recurrence && !ev.allDay && ev.timezone && ev.timezone !== "UTC") {
			recurringZones.add(ev.timezone);
		}
	}

	const lines: string[] = [
		"BEGIN:VCALENDAR",
		`PRODID:${PRODID}`,
		"VERSION:2.0",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		`X-WR-CALNAME:${escapeText(calendar.name)}`,
	];

	for (const zoneId of recurringZones) {
		lines.push(...buildVTimezone(zoneId));
	}

	for (const ev of events) {
		const uid = ev.sourceUid ?? ev.id;
		const useTzid = !!ev.recurrence;
		lines.push(...buildVevent({ event: ev, uid, renderZone: zone, dtStamp, useTzid }));
		if (ev.overrides?.length) {
			for (const ovr of ev.overrides) {
				lines.push(
					...buildOverrideVevent(
						{ ...ev, sourceUid: uid },
						ovr,
						zone,
						dtStamp,
						useTzid,
					),
				);
			}
		}
	}

	lines.push("END:VCALENDAR");
	return lines.map(foldLine).join(CRLF) + CRLF;
}
