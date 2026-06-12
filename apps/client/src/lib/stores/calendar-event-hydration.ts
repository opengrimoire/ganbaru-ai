import type {
  AttendeeStatus,
  CalendarEvent,
  EventOrganizer,
  EventOverride,
  EventVisibility,
  GeoCoordinates,
  IcalendarPreservationStatus,
} from "$lib/components/calendar/types";
import { sanitizeCalendarDescriptionHtml } from "$lib/calendar/description-sanitizer";
import { deriveIcalendarProjectionState } from "$lib/calendar/ics/projection-state";
import {
  mapAlarm,
  mapAttendee,
  mapOverride,
  mapRow,
  mapWindowAttendee,
  safeJsonParse,
  type DbAlarm,
  type DbAttendee,
  type DbCalendarEvent,
  type DbOverride,
  type DbWindowAttendee,
} from "./map-row";

export type DbFullEvent = DbCalendarEvent & {
  description: string | null;
  url: string | null;
  source_uid: string | null;
  visibility: string;
  priority: number | null;
  categories: string | null;
  geo: string | null;
  sequence: number;
  extended_properties: string | null;
  organizer: string | null;
  meeting_enabled: number;
  guest_can_modify: number;
  guest_can_invite_others: number;
  guest_can_see_other_guests: number;
  icalendar_component_id: string | null;
  icalendar_preservation_status: IcalendarPreservationStatus | null;
  icalendar_projection_warnings: string | null;
  icalendar_raw_jcal: string | null;
};

export type DbFullOverride = DbOverride & {
  description: string | null;
  location: string | null;
  url: string | null;
  visibility: string | null;
  extended_properties: string | null;
  icalendar_component_id: string | null;
  icalendar_raw_jcal: string | null;
};

export interface CalendarWindowRows {
  events: DbCalendarEvent[];
  overrides: DbOverride[];
  attendees: DbWindowAttendee[];
  total_event_count: number;
}

export interface CalendarPomodoroSchedulerRows {
  events: DbCalendarEvent[];
  overrides: DbOverride[];
}

export interface CalendarPanelEventRows {
  event: DbFullEvent | null;
  attendees: DbAttendee[];
}

export interface CalendarFullEventRows {
  event: DbFullEvent | null;
  attendees: DbAttendee[];
  alarms: DbAlarm[];
  overrides: DbFullOverride[];
}

export interface CalendarIcalendarExportMetadata {
  method: string | null;
  mixed_methods: boolean;
}

function applyFullEventFields(row: DbFullEvent, event: CalendarEvent) {
  if (row.description) event.description = sanitizeCalendarDescriptionHtml(row.description);
  if (row.url) event.url = row.url;
  if (row.source_uid) event.sourceUid = row.source_uid;
  if (row.visibility && row.visibility !== "public") {
    event.visibility = row.visibility as EventVisibility;
  }
  if (row.priority != null) event.priority = row.priority;
  const categories = safeJsonParse<string[]>(row.categories);
  if (categories) event.categories = categories;
  const geo = safeJsonParse<GeoCoordinates>(row.geo);
  if (geo) event.geo = geo;
  if (row.sequence) event.sequence = row.sequence;
  const extendedProperties =
    safeJsonParse<Record<string, string>>(row.extended_properties);
  if (extendedProperties) event.extendedProperties = extendedProperties;
  const organizer = safeJsonParse<EventOrganizer>(row.organizer);
  if (organizer) event.organizer = organizer;
  if (row.meeting_enabled === 1) event.meetingEnabled = true;
  if (row.local_rsvp_status) {
    event.localParticipationStatus = row.local_rsvp_status as AttendeeStatus;
  }
  if (row.guest_can_modify === 1
    || row.guest_can_invite_others === 0
    || row.guest_can_see_other_guests === 0) {
    event.guestPermissions = {
      canModify: row.guest_can_modify === 1,
      canInviteOthers: row.guest_can_invite_others !== 0,
      canSeeOtherGuests: row.guest_can_see_other_guests !== 0,
    };
  }
  if (row.icalendar_component_id) event.icalendarComponentId = row.icalendar_component_id;
  const projectionWarnings = safeJsonParse<string[]>(row.icalendar_projection_warnings);
  const projectionState = deriveIcalendarProjectionState({
    sourceUid: row.source_uid,
    componentId: row.icalendar_component_id,
    preservationStatus: row.icalendar_preservation_status,
    projectionWarnings,
  });
  if (projectionState.preservationStatus) {
    event.icalendarPreservationStatus = projectionState.preservationStatus;
  }
  if (projectionState.projectionWarnings) {
    event.icalendarProjectionWarnings = projectionState.projectionWarnings;
  }
  const rawJcal = safeJsonParse<unknown>(row.icalendar_raw_jcal);
  if (rawJcal) event.icalendarRawJcal = rawJcal;
}

function mapOverrides(
  rows: DbOverride[],
  renderZone: string,
  parentAllDayById: Map<string, boolean>,
): Map<string, EventOverride[]> {
  const map = new Map<string, EventOverride[]>();
  for (const r of rows) {
    const list = map.get(r.parent_event_id) ?? [];
    list.push(mapOverride(r, renderZone, parentAllDayById.get(r.parent_event_id) === true));
    map.set(r.parent_event_id, list);
  }
  return map;
}

export function mapWindowRows(rows: CalendarWindowRows, renderZone: string): CalendarEvent[] {
  const mapped = rows.events.map((r) => mapRow(r, renderZone));
  if (mapped.length === 0) return mapped;

  const parentAllDayById = new Map(mapped.map((event) => [event.id, event.allDay === true]));
  const overrideMap = mapOverrides(rows.overrides, renderZone, parentAllDayById);
  const surfaceAttendeesByEventId = new Map<string, DbWindowAttendee[]>();
  for (const attendee of rows.attendees) {
    const existing = surfaceAttendeesByEventId.get(attendee.event_id);
    if (existing) existing.push(attendee);
    else surfaceAttendeesByEventId.set(attendee.event_id, [attendee]);
  }
  for (const evt of mapped) {
    const ovr = overrideMap.get(evt.id);
    if (ovr?.length) evt.overrides = ovr;
    const surfaceAttendees = surfaceAttendeesByEventId.get(evt.id);
    if (surfaceAttendees?.length) {
      evt.surfaceAttendees = surfaceAttendees.map(mapWindowAttendee);
    }
  }
  return mapped;
}

export function slimEvent(e: CalendarEvent): CalendarEvent {
  const slim: CalendarEvent = {
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    timezone: e.timezone,
    calendarId: e.calendarId,
  };
  if (e.color !== undefined) slim.color = e.color;
  if (e.recurrence) slim.recurrence = e.recurrence;
  if (e.notifications && e.notifications.length > 0) slim.notifications = e.notifications;
  if (e.exceptions && e.exceptions.length > 0) slim.exceptions = e.exceptions;
  if (e.recurringParentId) slim.recurringParentId = e.recurringParentId;
  if (e.allDay) slim.allDay = true;
  if (e.meetingEnabled) slim.meetingEnabled = true;
  if (e.hasCallLink || e.url) slim.hasCallLink = true;
  if (e.location) slim.location = e.location;
  if (e.transparency === "transparent") slim.transparency = "transparent";
  if (e.status && e.status !== "confirmed") slim.status = e.status;
  if (e.localParticipationStatus) slim.localParticipationStatus = e.localParticipationStatus;
  if (e.pomodoroConfig) slim.pomodoroConfig = e.pomodoroConfig;
  if (e.rdate && e.rdate.length > 0) slim.rdate = e.rdate;
  if (e.overrides && e.overrides.length > 0) slim.overrides = e.overrides;
  return slim;
}

export function hydratePanelEvent(
  rows: CalendarPanelEventRows,
  renderZone: string,
): CalendarEvent | undefined {
  if (!rows.event) return undefined;
  const event = mapRow(rows.event, renderZone);
  applyFullEventFields(rows.event, event);
  if (rows.attendees.length > 0) event.attendees = rows.attendees.map(mapAttendee);
  return event;
}

export function hydrateFullEvent(
  rows: CalendarFullEventRows,
  renderZone: string,
): CalendarEvent | undefined {
  if (!rows.event) return undefined;
  const row = rows.event;
  const event = mapRow(row, renderZone);
  applyFullEventFields(row, event);

  if (rows.attendees.length > 0) {
    event.attendees = rows.attendees.map(mapAttendee);
  }
  if (rows.alarms.length > 0) {
    event.alarms = rows.alarms.map(mapAlarm);
  }
  if (rows.overrides.length > 0) {
    event.overrides = rows.overrides.map((r) => {
      const slim = mapOverride(r, renderZone, row.all_day === 1);
      if (r.description) {
        slim.description = sanitizeCalendarDescriptionHtml(r.description);
      }
      if (r.location) slim.location = r.location;
      if (r.url) slim.url = r.url;
      if (r.visibility) slim.visibility = r.visibility as EventVisibility;
      const ep = safeJsonParse<Record<string, string>>(r.extended_properties);
      if (ep) slim.extendedProperties = ep;
      if (r.icalendar_component_id) slim.icalendarComponentId = r.icalendar_component_id;
      const rawJcal = safeJsonParse<unknown>(r.icalendar_raw_jcal);
      if (rawJcal) slim.icalendarRawJcal = rawJcal;
      return slim;
    });
  }
  return event;
}
