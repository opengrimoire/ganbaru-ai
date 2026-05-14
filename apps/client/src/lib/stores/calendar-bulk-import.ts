/**
 * Pure helpers for calendar bulk import payloads. ICS parsing stays in
 * TypeScript for now, but durable database application is handled by the
 * Rust `calendar_bulk_import` command.
 */
import type {
  CalendarEvent,
  EventAlarm,
  EventAttendee,
  EventOverride,
} from "$lib/components/calendar/types";
import type {
  IcsPreservedComponent,
  IcsPreservedObject,
  IcsPreservationPayload,
  IcsPreservationStatus,
} from "$lib/calendar/ics/types";
import { recurrenceToRrule } from "$lib/components/calendar/rrule";
import { sanitizeCalendarDescriptionHtml } from "$lib/calendar/description-sanitizer";
import { toDbTime } from "./map-row";

export type CalendarImportSourceKind =
  | "import-file"
  | "import-zip-entry"
  | "local-export-base"
  | "subscription";

export type CalendarBulkImportAction = "added" | "updated";

export interface CalendarBulkImportApplied {
  candidateId: string;
  eventId: string;
  action: CalendarBulkImportAction;
}

export interface CalendarBulkImportResult {
  added: number;
  updated: number;
  skippedOlder: number;
  warnings: string[];
  applied: CalendarBulkImportApplied[];
}

export interface CalendarBulkImportPayload {
  targetCalendarId: string;
  now: string;
  preservation: CalendarBulkImportPreservation | null;
  events: CalendarBulkImportEvent[];
}

export interface CalendarBulkImportPreservation {
  sourceKind: CalendarImportSourceKind;
  sourceName: string;
  sourceFingerprint: string;
  objects: CalendarBulkImportPreservedObject[];
}

export interface CalendarBulkImportPreservedObject {
  id: string;
  prodid: string | null;
  version: string | null;
  method: string | null;
  calendarScale: string | null;
  rawJcal: string;
  diagnostics: string;
  components: CalendarBulkImportPreservedComponent[];
}

export interface CalendarBulkImportPreservedComponent {
  id: string;
  componentType: string;
  uid: string | null;
  recurrenceId: string | null;
  recurrenceIdValueType: string | null;
  sequence: number | null;
  dtstartKey: string | null;
  rawJcal: string;
  preservationStatus: IcsPreservationStatus;
  projectionWarnings: string;
  components: CalendarBulkImportPreservedComponent[];
}

export interface CalendarBulkImportEvent {
  candidateId: string;
  title: string;
  startTime: string;
  endTime: string;
  timezone: string;
  color: number | null;
  description: string;
  rrule: string | null;
  notifications: string | null;
  exceptions: string | null;
  repeatUntil: string | null;
  allDay: boolean;
  location: string;
  url: string;
  transparency: string;
  status: string;
  sourceUid: string | null;
  visibility: string;
  priority: number | null;
  categories: string | null;
  geo: string | null;
  sequence: number;
  rdate: string | null;
  extendedProperties: string | null;
  organizer: string | null;
  guestCanModify: boolean;
  guestCanInviteOthers: boolean;
  guestCanSeeOtherGuests: boolean;
  attendees: CalendarBulkImportAttendee[];
  alarms: CalendarBulkImportAlarm[];
  overrides: CalendarBulkImportOverride[];
}

export interface CalendarBulkImportAttendee {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  rsvp: boolean;
}

export interface CalendarBulkImportAlarm {
  id: string;
  action: string;
  triggerType: string;
  triggerValue: string;
  description: string | null;
}

export interface CalendarBulkImportOverride {
  id: string;
  recurrenceId: string;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  description: string | null;
  location: string | null;
  url: string | null;
  color: number | null;
  status: string | null;
  transparency: string | null;
  visibility: string | null;
  extendedProperties: string | null;
}

export function buildBulkImportPayload(
  events: CalendarEvent[],
  targetCalendarId: string,
  now: string,
  fallbackZone: string,
  newId: () => string,
  preservation: IcsPreservationPayload | null = null,
  sourceName = "",
  sourceKind: CalendarImportSourceKind = "import-file",
): CalendarBulkImportPayload {
  return {
    targetCalendarId,
    now,
    preservation: buildPreservationPayload(preservation, sourceName, sourceKind, newId),
    events: events.map((event) =>
      buildBulkImportEvent(event, newId(), fallbackZone),
    ),
  };
}

function buildPreservationPayload(
  preservation: IcsPreservationPayload | null,
  sourceName: string,
  sourceKind: CalendarImportSourceKind,
  newId: () => string,
): CalendarBulkImportPreservation | null {
  if (!preservation || preservation.objects.length === 0) return null;
  return {
    sourceKind,
    sourceName,
    sourceFingerprint: preservation.sourceFingerprint,
    objects: preservation.objects.map((object) =>
      buildPreservedObject(object, newId),
    ),
  };
}

function buildPreservedObject(
  object: IcsPreservedObject,
  newId: () => string,
): CalendarBulkImportPreservedObject {
  return {
    id: newId(),
    prodid: object.prodid ?? null,
    version: object.version ?? null,
    method: object.method ?? null,
    calendarScale: object.calendarScale ?? null,
    rawJcal: JSON.stringify(object.rawJcal),
    diagnostics: JSON.stringify(object.diagnostics),
    components: object.components.map((component) =>
      buildPreservedComponent(component, newId),
    ),
  };
}

function buildPreservedComponent(
  component: IcsPreservedComponent,
  newId: () => string,
): CalendarBulkImportPreservedComponent {
  return {
    id: newId(),
    componentType: component.componentType,
    uid: component.uid ?? null,
    recurrenceId: component.recurrenceId ?? null,
    recurrenceIdValueType: component.recurrenceIdValueType ?? null,
    sequence: component.sequence ?? null,
    dtstartKey: component.dtstartKey ?? null,
    rawJcal: JSON.stringify(component.rawJcal),
    preservationStatus: component.preservationStatus,
    projectionWarnings: JSON.stringify(component.projectionWarnings),
    components: component.components.map((child) =>
      buildPreservedComponent(child, newId),
    ),
  };
}

function buildBulkImportEvent(
  event: CalendarEvent,
  candidateId: string,
  fallbackZone: string,
): CalendarBulkImportEvent {
  const homeZone = event.timezone || fallbackZone;
  const gp = event.guestPermissions;
  return {
    candidateId,
    title: event.title,
    startTime: toDbTime(event.start, homeZone, event.allDay),
    endTime: toDbTime(event.end, homeZone, event.allDay),
    timezone: homeZone,
    color: event.color ?? null,
    description: sanitizeCalendarDescriptionHtml(event.description ?? ""),
    rrule: event.recurrence ? recurrenceToRrule(event.recurrence) : null,
    notifications: jsonOrNull(event.notifications),
    exceptions: jsonOrNull(event.exceptions),
    repeatUntil: event.recurrence?.end.type === "until"
      ? event.recurrence.end.date
      : null,
    allDay: event.allDay ?? false,
    location: event.location ?? "",
    url: event.url ?? "",
    transparency: event.transparency ?? "opaque",
    status: event.status ?? "confirmed",
    sourceUid: event.sourceUid ?? null,
    visibility: event.visibility ?? "public",
    priority: event.priority ?? null,
    categories: jsonOrNull(event.categories),
    geo: jsonOrNull(event.geo),
    sequence: event.sequence ?? 0,
    rdate: jsonOrNull(event.rdate),
    extendedProperties: jsonOrNull(event.extendedProperties),
    organizer: jsonOrNull(event.organizer),
    guestCanModify: gp?.canModify ?? false,
    guestCanInviteOthers: gp?.canInviteOthers ?? true,
    guestCanSeeOtherGuests: gp?.canSeeOtherGuests ?? true,
    attendees: buildAttendees(event.attendees),
    alarms: buildAlarms(event.alarms),
    overrides: buildOverrides(event.overrides, homeZone, event.allDay === true),
  };
}

function buildAttendees(
  attendees: CalendarEvent["attendees"],
): CalendarBulkImportAttendee[] {
  return (attendees ?? []).map((attendee: EventAttendee) => ({
    id: attendee.id,
    name: attendee.name ?? null,
    email: attendee.email,
    role: attendee.role,
    status: attendee.status,
    rsvp: attendee.rsvp,
  }));
}

function buildAlarms(alarms: CalendarEvent["alarms"]): CalendarBulkImportAlarm[] {
  return (alarms ?? []).map((alarm: EventAlarm) => ({
    id: alarm.id,
    action: alarm.action,
    triggerType: alarm.triggerType,
    triggerValue: alarm.triggerValue,
    description: alarm.description ?? null,
  }));
}

function buildOverrides(
  overrides: CalendarEvent["overrides"],
  zone: string,
  allDay: boolean,
): CalendarBulkImportOverride[] {
  return (overrides ?? []).map((overrideRow: EventOverride) => ({
    id: overrideRow.id,
    recurrenceId: overrideRow.recurrenceId,
    title: overrideRow.title ?? null,
    startTime: overrideRow.start
      ? toDbTime(overrideRow.start, zone, allDay)
      : null,
    endTime: overrideRow.end
      ? toDbTime(overrideRow.end, zone, allDay)
      : null,
    description: overrideRow.description === undefined || overrideRow.description === null
      ? null
      : sanitizeCalendarDescriptionHtml(overrideRow.description),
    location: overrideRow.location ?? null,
    url: overrideRow.url ?? null,
    color: overrideRow.color ?? null,
    status: overrideRow.status ?? null,
    transparency: overrideRow.transparency ?? null,
    visibility: overrideRow.visibility ?? null,
    extendedProperties: jsonOrNull(overrideRow.extendedProperties),
  }));
}

function jsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (typeof value === "object" && Object.keys(value).length === 0) return null;
  return JSON.stringify(value);
}
