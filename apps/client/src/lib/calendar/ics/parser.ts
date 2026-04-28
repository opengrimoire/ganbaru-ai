import ICAL from "ical.js";
import type {
	CalendarEvent,
	EventAlarm,
	EventAttendee,
	EventOrganizer,
	EventOverride,
	EventStatus,
	EventTransparency,
	EventVisibility,
	GeoCoordinates,
	GuestPermissions,
} from "$lib/components/calendar/types";
import { recurrenceToRrule, rruleToRecurrence } from "$lib/components/calendar/rrule";
import { utcIsoToWallClock, wallClockToUtcIso } from "$lib/components/calendar/utils";
import type { IcsParseResult } from "./types";

/**
 * Microsoft Windows to IANA timezone identifier map. Outlook emits
 * Windows zone names (e.g. "Pacific Standard Time") in TZID; Google emits
 * IANA names. The list below covers the most common Windows zones; missing
 * names fall back to UTC with a warning. Sourced from CLDR
 * (https://github.com/unicode-org/cldr/blob/main/common/supplemental/windowsZones.xml).
 */
const WINDOWS_TO_IANA: Record<string, string> = {
	"UTC": "UTC",
	"GMT Standard Time": "Europe/London",
	"GMT": "Etc/GMT",
	"Greenwich Standard Time": "Atlantic/Reykjavik",
	"W. Europe Standard Time": "Europe/Berlin",
	"Central Europe Standard Time": "Europe/Budapest",
	"Romance Standard Time": "Europe/Paris",
	"Central European Standard Time": "Europe/Warsaw",
	"E. Europe Standard Time": "Europe/Chisinau",
	"FLE Standard Time": "Europe/Kiev",
	"GTB Standard Time": "Europe/Bucharest",
	"Turkey Standard Time": "Europe/Istanbul",
	"Russian Standard Time": "Europe/Moscow",
	"Eastern Standard Time": "America/New_York",
	"Central Standard Time": "America/Chicago",
	"Mountain Standard Time": "America/Denver",
	"Pacific Standard Time": "America/Los_Angeles",
	"Alaskan Standard Time": "America/Anchorage",
	"Hawaiian Standard Time": "Pacific/Honolulu",
	"US Eastern Standard Time": "America/Indianapolis",
	"US Mountain Standard Time": "America/Phoenix",
	"Atlantic Standard Time": "America/Halifax",
	"SA Eastern Standard Time": "America/Cayenne",
	"SA Pacific Standard Time": "America/Bogota",
	"SA Western Standard Time": "America/La_Paz",
	"E. South America Standard Time": "America/Sao_Paulo",
	"Argentina Standard Time": "America/Argentina/Buenos_Aires",
	"Pacific SA Standard Time": "America/Santiago",
	"Newfoundland Standard Time": "America/St_Johns",
	"Tokyo Standard Time": "Asia/Tokyo",
	"Korea Standard Time": "Asia/Seoul",
	"China Standard Time": "Asia/Shanghai",
	"Singapore Standard Time": "Asia/Singapore",
	"Taipei Standard Time": "Asia/Taipei",
	"India Standard Time": "Asia/Kolkata",
	"Sri Lanka Standard Time": "Asia/Colombo",
	"Pakistan Standard Time": "Asia/Karachi",
	"Iran Standard Time": "Asia/Tehran",
	"Arabian Standard Time": "Asia/Dubai",
	"Arabic Standard Time": "Asia/Baghdad",
	"Israel Standard Time": "Asia/Jerusalem",
	"Egypt Standard Time": "Africa/Cairo",
	"South Africa Standard Time": "Africa/Johannesburg",
	"AUS Eastern Standard Time": "Australia/Sydney",
	"AUS Central Standard Time": "Australia/Darwin",
	"E. Australia Standard Time": "Australia/Brisbane",
	"W. Australia Standard Time": "Australia/Perth",
	"Cen. Australia Standard Time": "Australia/Adelaide",
	"New Zealand Standard Time": "Pacific/Auckland",
};

/**
 * Resolve a TZID emitted by ical.js to a usable IANA zone. Already-IANA
 * names pass through; Windows-style names are remapped via the lookup.
 * Unknown values fall back to UTC and append a warning.
 */
function resolveTimezone(tzid: string | null, warnings: string[]): string {
	if (!tzid) return "UTC";
	if (WINDOWS_TO_IANA[tzid]) return WINDOWS_TO_IANA[tzid];
	if (isIanaZone(tzid)) return tzid;
	if (!warnings.includes(`Unknown timezone "${tzid}", falling back to UTC.`)) {
		warnings.push(`Unknown timezone "${tzid}", falling back to UTC.`);
	}
	return "UTC";
}

function isIanaZone(tzid: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tzid });
		return true;
	} catch {
		return false;
	}
}

/**
 * Convert an `ICAL.Time` to a UTC ISO 8601 instant ending in `Z`.
 *
 * - All-day (date-only) inputs become `YYYY-MM-DDT00:00:00Z` (RFC 5545 floating).
 * - Floating wall-clock inputs (no TZID, no Z) are interpreted in the device's
 *   IANA zone via the Temporal polyfill.
 * - Zoned inputs are converted via `Time.toJSDate()`, which honors the
 *   VTIMEZONE rules registered by `ical.js` itself.
 */
function timeToUtcIso(time: ICAL.Time, deviceZone: string): string {
	if (time.isDate) {
		const y = String(time.year).padStart(4, "0");
		const m = String(time.month).padStart(2, "0");
		const d = String(time.day).padStart(2, "0");
		return `${y}-${m}-${d}T00:00:00Z`;
	}
	const zone = time.zone;
	const tzid = (zone as ICAL.Timezone | null)?.tzid;
	const isFloating = !tzid || tzid === "floating";
	if (isFloating) {
		const wall = formatWallClock(time);
		return wallClockToUtcIso(wall, deviceZone);
	}
	const date = time.toJSDate();
	return date.toISOString();
}

function formatWallClock(time: ICAL.Time): string {
	const y = String(time.year).padStart(4, "0");
	const m = String(time.month).padStart(2, "0");
	const d = String(time.day).padStart(2, "0");
	const h = String(time.hour).padStart(2, "0");
	const min = String(time.minute).padStart(2, "0");
	return `${y}-${m}-${d} ${h}:${min}`;
}

function getDeviceZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	} catch {
		return "UTC";
	}
}

const ATTENDEE_ROLE_MAP: Record<string, EventAttendee["role"]> = {
	"CHAIR": "chair",
	"REQ-PARTICIPANT": "req-participant",
	"OPT-PARTICIPANT": "opt-participant",
	"NON-PARTICIPANT": "non-participant",
};

const ATTENDEE_STATUS_MAP: Record<string, EventAttendee["status"]> = {
	"NEEDS-ACTION": "needs-action",
	"ACCEPTED": "accepted",
	"DECLINED": "declined",
	"TENTATIVE": "tentative",
	"DELEGATED": "delegated",
};

function stripMailto(value: string): string {
	return value.replace(/^mailto:/i, "");
}

function parseAttendee(prop: ICAL.Property): EventAttendee {
	const value = prop.getFirstValue();
	const email = typeof value === "string" ? stripMailto(value) : "";
	const cn = prop.getFirstParameter("cn");
	const role = prop.getFirstParameter("role")?.toUpperCase();
	const partstat = prop.getFirstParameter("partstat")?.toUpperCase();
	const rsvp = prop.getFirstParameter("rsvp")?.toUpperCase() === "TRUE";
	return {
		id: crypto.randomUUID(),
		name: cn || undefined,
		email,
		role: (role && ATTENDEE_ROLE_MAP[role]) || "req-participant",
		status: (partstat && ATTENDEE_STATUS_MAP[partstat]) || "needs-action",
		rsvp,
	};
}

function parseOrganizer(prop: ICAL.Property): EventOrganizer {
	const value = prop.getFirstValue();
	const email = typeof value === "string" ? stripMailto(value) : "";
	const cn = prop.getFirstParameter("cn");
	return cn ? { name: cn, email } : { email };
}

function parseAlarm(
	component: ICAL.Component,
	warnings: string[],
): EventAlarm | null {
	const action = (component.getFirstPropertyValue("action") as string | null)?.toUpperCase();
	const triggerProp = component.getFirstProperty("trigger");
	if (!action || !triggerProp) return null;
	const validAction: EventAlarm["action"] =
		action === "AUDIO" || action === "EMAIL" ? (action.toLowerCase() as EventAlarm["action"]) : "display";

	const triggerValue = triggerProp.getFirstValue();
	let triggerType: EventAlarm["triggerType"];
	let triggerString: string;
	if (triggerValue instanceof ICAL.Duration) {
		triggerType = "relative";
		triggerString = triggerValue.toString();
	} else if (triggerValue instanceof ICAL.Time) {
		triggerType = "absolute";
		triggerString = triggerValue.toJSDate().toISOString();
	} else if (typeof triggerValue === "string") {
		triggerType = triggerValue.startsWith("P") || triggerValue.startsWith("-P") ? "relative" : "absolute";
		triggerString = triggerValue;
	} else {
		return null;
	}

	const description = (component.getFirstPropertyValue("description") as string | null) ?? undefined;
	if (component.hasProperty("repeat") || component.hasProperty("duration")) {
		const msg = "VALARM REPEAT and DURATION dropped on import (not represented in schema).";
		if (!warnings.includes(msg)) warnings.push(msg);
	}
	return {
		id: crypto.randomUUID(),
		action: validAction,
		triggerType,
		triggerValue: triggerString,
		description,
	};
}

const STATUS_MAP: Record<string, EventStatus> = {
	"CONFIRMED": "confirmed",
	"TENTATIVE": "tentative",
	"CANCELLED": "cancelled",
};

const TRANSP_MAP: Record<string, EventTransparency> = {
	"OPAQUE": "opaque",
	"TRANSPARENT": "transparent",
};

const VISIBILITY_MAP: Record<string, EventVisibility> = {
	"PUBLIC": "public",
	"PRIVATE": "private",
	"CONFIDENTIAL": "confidential",
};

const STANDARD_PROPS = new Set([
	"uid", "summary", "description", "location", "url", "dtstart", "dtend",
	"duration", "rrule", "rdate", "exdate", "recurrence-id", "status", "class",
	"transp", "priority", "sequence", "categories", "geo", "organizer",
	"attendee", "dtstamp", "created", "last-modified",
]);

function collectExtendedProperties(component: ICAL.Component): {
	extended: Record<string, string>;
	guests: GuestPermissions | undefined;
} {
	const extended: Record<string, string> = {};
	let guests: GuestPermissions | undefined;
	for (const prop of component.getAllProperties()) {
		const name = prop.name;
		if (STANDARD_PROPS.has(name)) continue;
		const value = prop.getFirstValue();
		const stringValue = typeof value === "string" ? value : value?.toString() ?? "";
		switch (name.toUpperCase()) {
			case "X-GOOGLE-GUEST-CAN-MODIFY":
				guests = guests ?? defaultGuestPermissions();
				guests.canModify = stringValue.toUpperCase() === "TRUE";
				break;
			case "X-GOOGLE-GUEST-CAN-INVITE-OTHERS":
				guests = guests ?? defaultGuestPermissions();
				guests.canInviteOthers = stringValue.toUpperCase() === "TRUE";
				break;
			case "X-GOOGLE-GUEST-CAN-SEE-OTHER-GUESTS":
				guests = guests ?? defaultGuestPermissions();
				guests.canSeeOtherGuests = stringValue.toUpperCase() === "TRUE";
				break;
			default:
				extended[name.toUpperCase()] = stringValue;
		}
	}
	return { extended, guests };
}

function defaultGuestPermissions(): GuestPermissions {
	return { canModify: false, canInviteOthers: true, canSeeOtherGuests: true };
}

function parseExdates(component: ICAL.Component, deviceZone: string): string[] {
	const out: string[] = [];
	for (const prop of component.getAllProperties("exdate")) {
		for (const value of prop.getValues()) {
			if (value instanceof ICAL.Time) {
				const utc = timeToUtcIso(value, deviceZone);
				out.push(utc.slice(0, 10));
			}
		}
	}
	return out;
}

function parseRdates(component: ICAL.Component, deviceZone: string): string[] {
	const out: string[] = [];
	for (const prop of component.getAllProperties("rdate")) {
		for (const value of prop.getValues()) {
			if (value instanceof ICAL.Time) {
				out.push(timeToUtcIso(value, deviceZone));
			}
		}
	}
	return out;
}

function calendarEventBaseFromComponent(
	component: ICAL.Component,
	calendarId: string,
	deviceZone: string,
	warnings: string[],
): { event: CalendarEvent; recurrenceId?: string } | null {
	const dtstartProp = component.getFirstProperty("dtstart");
	if (!dtstartProp) return null;
	const dtstartValue = dtstartProp.getFirstValue();
	if (!(dtstartValue instanceof ICAL.Time)) return null;

	const isAllDay = dtstartValue.isDate;
	const startUtc = timeToUtcIso(dtstartValue, deviceZone);

	const dtstartTzid = dtstartProp.getFirstParameter("tzid");
	const homeZone = isAllDay
		? deviceZone
		: dtstartTzid
			? resolveTimezone(dtstartTzid, warnings)
			: dtstartValue.zone && (dtstartValue.zone as ICAL.Timezone).tzid === "UTC"
				? "UTC"
				: deviceZone;

	let endUtc: string;
	const dtendProp = component.getFirstProperty("dtend");
	const durationProp = component.getFirstProperty("duration");
	if (dtendProp) {
		const dtendValue = dtendProp.getFirstValue();
		if (dtendValue instanceof ICAL.Time) {
			endUtc = timeToUtcIso(dtendValue, deviceZone);
		} else {
			endUtc = startUtc;
		}
	} else if (durationProp) {
		const durValue = durationProp.getFirstValue();
		if (durValue instanceof ICAL.Duration) {
			const startInstant = Temporal.Instant.from(startUtc);
			const seconds = durValue.toSeconds();
			endUtc = startInstant.add({ seconds }).toString();
		} else {
			endUtc = startUtc;
		}
	} else {
		const startInstant = Temporal.Instant.from(startUtc);
		endUtc = startInstant.add({ minutes: 30 }).toString();
		warnings.push(
			`Event missing DTEND/DURATION (UID=${
				(component.getFirstPropertyValue("uid") as string | null) ?? "?"
			}); defaulted to 30 minutes.`,
		);
	}

	const start = isAllDay ? startUtc.slice(0, 10) + " 00:00" : utcIsoToWallClock(startUtc, homeZone);
	const end = isAllDay ? endUtc.slice(0, 10) + " 00:00" : utcIsoToWallClock(endUtc, homeZone);

	const sourceUid = (component.getFirstPropertyValue("uid") as string | null) ?? undefined;
	const summary = (component.getFirstPropertyValue("summary") as string | null) ?? "";
	const description = (component.getFirstPropertyValue("description") as string | null) ?? undefined;
	const location = (component.getFirstPropertyValue("location") as string | null) ?? undefined;
	const url = (component.getFirstPropertyValue("url") as string | null) ?? undefined;
	const status = (component.getFirstPropertyValue("status") as string | null);
	const transp = (component.getFirstPropertyValue("transp") as string | null);
	const visibility = (component.getFirstPropertyValue("class") as string | null);
	const priority = component.getFirstPropertyValue("priority");
	const sequence = component.getFirstPropertyValue("sequence");

	const categoriesProp = component.getFirstProperty("categories");
	const categories: string[] | undefined = categoriesProp
		? categoriesProp.getValues().map((v): string => (typeof v === "string" ? v : v?.toString() ?? ""))
		: undefined;

	const geoValue = component.getFirstPropertyValue("geo");
	const geo: GeoCoordinates | undefined = Array.isArray(geoValue) && geoValue.length >= 2
		? { lat: Number(geoValue[0]), lng: Number(geoValue[1]) }
		: undefined;

	const organizerProp = component.getFirstProperty("organizer");
	const organizer = organizerProp ? parseOrganizer(organizerProp) : undefined;

	const attendees: EventAttendee[] = component
		.getAllProperties("attendee")
		.map((p) => parseAttendee(p));

	const alarms: EventAlarm[] = component
		.getAllSubcomponents("valarm")
		.map((c) => parseAlarm(c, warnings))
		.filter((a): a is EventAlarm => a !== null);

	const exceptions = parseExdates(component, deviceZone);
	const rdate = parseRdates(component, deviceZone);

	const rruleValue = component.getFirstPropertyValue("rrule");
	let rruleString: string | undefined;
	if (rruleValue instanceof ICAL.Recur) {
		const original = rruleValue.toString();
		try {
			const config = rruleToRecurrence(original);
			rruleString = recurrenceToRrule(config);
		} catch {
			rruleString = original;
			warnings.push(`Failed to canonicalize RRULE "${original}"; stored as-is.`);
		}
	}

	const { extended, guests } = collectExtendedProperties(component);

	const recurrenceIdProp = component.getFirstProperty("recurrence-id");
	let recurrenceId: string | undefined;
	if (recurrenceIdProp) {
		const value = recurrenceIdProp.getFirstValue();
		if (value instanceof ICAL.Time) {
			recurrenceId = timeToUtcIso(value, deviceZone);
		}
	}

	const event: CalendarEvent = {
		id: crypto.randomUUID(),
		title: summary,
		start,
		end,
		timezone: homeZone,
		calendarId,
		allDay: isAllDay || undefined,
	};
	if (description) event.description = description;
	if (location) event.location = location;
	if (url) event.url = url;
	if (sourceUid) event.sourceUid = sourceUid;
	if (status && STATUS_MAP[status.toUpperCase()]) event.status = STATUS_MAP[status.toUpperCase()];
	if (transp && TRANSP_MAP[transp.toUpperCase()]) event.transparency = TRANSP_MAP[transp.toUpperCase()];
	if (visibility && VISIBILITY_MAP[visibility.toUpperCase()]) {
		event.visibility = VISIBILITY_MAP[visibility.toUpperCase()];
	}
	if (typeof priority === "number") event.priority = priority;
	if (typeof sequence === "number") event.sequence = sequence;
	if (categories?.length) event.categories = categories;
	if (geo) event.geo = geo;
	if (organizer) event.organizer = organizer;
	if (attendees.length) event.attendees = attendees;
	if (alarms.length) event.alarms = alarms;
	if (exceptions.length) event.exceptions = exceptions;
	if (rdate.length) event.rdate = rdate;
	if (rruleString) {
		event.recurrence = rruleToRecurrence(rruleString);
	}
	if (Object.keys(extended).length) event.extendedProperties = extended;
	if (guests) event.guestPermissions = guests;

	return { event, recurrenceId };
}

function buildOverride(parentEvent: CalendarEvent, child: CalendarEvent, recurrenceId: string): EventOverride {
	const override: EventOverride = {
		id: crypto.randomUUID(),
		parentEventId: parentEvent.id,
		recurrenceId,
	};
	if (child.title !== parentEvent.title) override.title = child.title;
	if (child.start !== parentEvent.start) override.start = child.start;
	if (child.end !== parentEvent.end) override.end = child.end;
	if (child.description !== parentEvent.description) override.description = child.description;
	if (child.location !== parentEvent.location) override.location = child.location;
	if (child.url !== parentEvent.url) override.url = child.url;
	if (child.color !== parentEvent.color) override.color = child.color;
	if (child.status !== parentEvent.status) override.status = child.status;
	if (child.transparency !== parentEvent.transparency) override.transparency = child.transparency;
	if (child.visibility !== parentEvent.visibility) override.visibility = child.visibility;
	if (child.extendedProperties) override.extendedProperties = child.extendedProperties;
	return override;
}

/**
 * Parse the text of a `.ics` file into a list of `CalendarEvent` rows ready
 * for upsert by `source_uid`. Master events have any matching `RECURRENCE-ID`
 * components attached as overrides. Warnings collect lossy or skipped fields.
 */
export function parseIcs(text: string, calendarId = "local"): IcsParseResult {
	const warnings: string[] = [];
	const deviceZone = getDeviceZone();

	let jcal: unknown;
	try {
		jcal = ICAL.parse(text);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { events: [], warnings: [`Failed to parse .ics file: ${msg}`] };
	}

	const root = new ICAL.Component(jcal as [string, unknown[], unknown[]]);
	const vcalendars = root.name === "vcalendar" ? [root] : root.getAllSubcomponents("vcalendar");
	if (vcalendars.length === 0) {
		return { events: [], warnings: ["No VCALENDAR component found in .ics file."] };
	}

	const masters = new Map<string, CalendarEvent>();
	const overrides: { uid: string; child: CalendarEvent; recurrenceId: string }[] = [];

	for (const vcal of vcalendars) {
		for (const vevent of vcal.getAllSubcomponents("vevent")) {
			const parsed = calendarEventBaseFromComponent(vevent, calendarId, deviceZone, warnings);
			if (!parsed) continue;
			const uid = parsed.event.sourceUid;
			if (!uid) {
				warnings.push("VEVENT missing UID; skipped.");
				continue;
			}
			if (parsed.recurrenceId) {
				overrides.push({ uid, child: parsed.event, recurrenceId: parsed.recurrenceId });
			} else if (!masters.has(uid)) {
				masters.set(uid, parsed.event);
			} else {
				warnings.push(`Duplicate UID ${uid}; keeping the first occurrence.`);
			}
		}
	}

	for (const { uid, child, recurrenceId } of overrides) {
		const parent = masters.get(uid);
		if (!parent) {
			warnings.push(`Override for UID ${uid} has no matching master VEVENT; skipped.`);
			continue;
		}
		parent.overrides = parent.overrides ?? [];
		parent.overrides.push(buildOverride(parent, child, recurrenceId));
	}

	return { events: Array.from(masters.values()), warnings };
}
