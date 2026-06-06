import type {
  AlarmAction, AttendeeRole, AttendeeStatus, CalendarEvent, EventAlarm,
  EventAttendee, EventOverride, EventStatus, EventSurfaceAttendee, EventTransparency,
} from "$lib/components/calendar/types";
import { rruleToRecurrence } from "$lib/components/calendar/rrule";
import {
  isUtcIso,
  normalizeEventColor,
  utcIsoToWallClock,
  wallClockToUtcIso,
} from "$lib/components/calendar/utils";

/**
 * Row shape returned by the boot SELECT in `calendar.svelte.ts:load()`.
 * Only the columns the slim in-memory `CalendarEvent` reads. Heavy columns
 * (description, organizer, geo, extendedProperties, categories, priority,
 * sequence, sourceUid, visibility, guest_can_*) stay in the DB and are loaded
 * on demand by `loadFullEvent` when the EventPanel or ICS export needs them.
 * The call link URL stays in the DB; window rows only expose whether it exists.
 * Window loads may attach `surfaceAttendees` separately for RSVP rendering.
 */
export interface DbCalendarEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  timezone: string;
  calendar_id: string;
  color: number | null;
  rrule: string | null;
  notifications: string | null;
  exceptions: string | null;
  repeat_until: string | null;
  all_day: number;
  location: string;
  has_call_link?: number;
  meeting_enabled: number;
  transparency: string;
  status: string;
  local_rsvp_status: string | null;
  created_at: string;
  rdate: string | null;
  // LEFT JOIN pomodoro_configs
  focus_duration_minutes: number | null;
  short_break_minutes: number | null;
  long_break_minutes: number | null;
  pomodoro_count: number | null;
  idle_timeout_minutes: number | null;
}

export interface DbAttendee {
  id: string;
  event_id: string;
  icalendar_component_id: string | null;
  icalendar_property_index: number | null;
  name: string | null;
  email: string;
  role: string;
  status: string;
  rsvp: number;
  sort_order: number;
}

export interface DbWindowAttendee {
  event_id: string;
  email: string;
  status: string;
}

export interface DbAlarm {
  id: string;
  event_id: string;
  icalendar_component_id: string | null;
  action: string;
  trigger_type: string;
  trigger_value: string;
  description: string | null;
  sort_order: number;
}

/**
 * Slim override row: only the columns that drive render/expansion. The
 * description, location, url, extended_properties, and visibility columns
 * stay in the DB but are not loaded into memory.
 */
export interface DbOverride {
  id: string;
  parent_event_id: string;
  recurrence_id: string;
  recurrence_range: string | null;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  color: number | null;
  status: string | null;
  transparency: string | null;
}

export function safeJsonParse<T>(json: string | null): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

/**
 * Convert a DB-stored datetime to a wall clock string for the in-memory
 * `CalendarEvent.start`/`end`. The usual shape is minute precision, with
 * non-zero seconds preserved for exact pomodoro cut timestamps. The
 * canonical form is UTC ISO 8601; rendering happens in `renderZone` (the
 * device zone by default). Non-UTC rows are treated as wall-clock text so a
 * malformed or hand-edited row degrades predictably.
 *
 * For all-day events, the caller is expected to skip this and use the
 * date portion of `dbTime` directly: zone conversion would shift the date
 * across midnight in zones east/west of UTC, which is not what an all-day
 * event means. Pass `allDay = true` to short-circuit that case here.
 */
export function toCalendarDate(
  dbTime: string,
  renderZone: string,
  allDay = false,
): string {
  if (allDay) {
    return `${dbTime.substring(0, 10)} 00:00`;
  }
  if (!isUtcIso(dbTime)) {
    return dbTime.substring(0, 16).replace("T", " ");
  }
  return utcIsoToWallClock(dbTime, renderZone);
}

/**
 * Convert a wall clock "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS" in
 * `zone` back to a DB-storable UTC ISO 8601 instant. For all-day events,
 * store `YYYY-MM-DDT00:00:00Z`
 * (UTC midnight) so the row is stable across zones; the `all_day` column
 * is what tells consumers to treat the date portion as floating.
 */
export function toDbTime(
  calendarDate: string,
  zone: string,
  allDay = false,
): string {
  if (allDay) {
    return `${calendarDate.substring(0, 10)}T00:00:00Z`;
  }
  return wallClockToUtcIso(calendarDate, zone);
}

/**
 * Build the slim in-memory `CalendarEvent`. Only keys with meaningful values
 * are assigned (no `key: undefined`); this keeps the V8 hidden class compact
 * and prevents the patch-based `updateBlock` from receiving spurious keys
 * that would clear heavy DB columns when callers spread `{...slimEvent}`.
 */
export function mapRow(r: DbCalendarEvent, renderZone: string): CalendarEvent {
  const allDay = r.all_day === 1;
  const slim: CalendarEvent = {
    id: r.id,
    title: r.title,
    start: toCalendarDate(r.start_time, renderZone, allDay),
    end: toCalendarDate(r.end_time, renderZone, allDay),
    timezone: r.timezone,
    calendarId: r.calendar_id,
  };
  const color = normalizeEventColor(r.color);
  if (color !== undefined) slim.color = color;
  if (r.rrule) {
    slim.recurrence = rruleToRecurrence(r.rrule, r.repeat_until ?? undefined);
  }
  const notifications = safeJsonParse<number[]>(r.notifications);
  if (notifications) slim.notifications = notifications;
  const exceptions = safeJsonParse<string[]>(r.exceptions);
  if (exceptions) slim.exceptions = exceptions;
  if (allDay) slim.allDay = true;
  if (r.location) slim.location = r.location;
  if (r.has_call_link === 1) slim.hasCallLink = true;
  if (r.meeting_enabled === 1) slim.meetingEnabled = true;
  if (r.transparency === "transparent") slim.transparency = "transparent";
  if (r.status !== "confirmed") slim.status = r.status as EventStatus;
  if (r.local_rsvp_status) slim.localParticipationStatus = r.local_rsvp_status as AttendeeStatus;
  if (r.created_at) slim.createdAt = r.created_at;
  const rdate = safeJsonParse<string[]>(r.rdate);
  if (rdate) slim.rdate = rdate;
  if (r.focus_duration_minutes != null) {
    slim.pomodoroConfig = {
      focusDurationMinutes: r.focus_duration_minutes,
      shortBreakMinutes: r.short_break_minutes!,
      longBreakMinutes: r.long_break_minutes!,
      pomodoroCount: r.pomodoro_count!,
      idleTimeoutMinutes: r.idle_timeout_minutes,
    };
  }
  return slim;
}

export function mapAttendee(r: DbAttendee): EventAttendee {
  const attendee: EventAttendee = {
    id: r.id,
    name: r.name || undefined,
    email: r.email,
    role: r.role as AttendeeRole,
    status: r.status as AttendeeStatus,
    rsvp: r.rsvp === 1,
  };
  if (r.icalendar_component_id) attendee.icalendarComponentId = r.icalendar_component_id;
  if (r.icalendar_property_index != null) {
    attendee.icalendarPropertyIndex = r.icalendar_property_index;
  }
  return attendee;
}

export function mapWindowAttendee(r: DbWindowAttendee): EventSurfaceAttendee {
  return {
    email: r.email,
    status: r.status as AttendeeStatus,
  };
}

export function mapAlarm(r: DbAlarm): EventAlarm {
  const alarm: EventAlarm = {
    id: r.id,
    action: r.action as AlarmAction,
    triggerType: r.trigger_type as "relative" | "absolute",
    triggerValue: r.trigger_value,
    description: r.description || undefined,
  };
  if (r.icalendar_component_id) alarm.icalendarComponentId = r.icalendar_component_id;
  return alarm;
}

/**
 * Build the slim in-memory `EventOverride`. Description, location, url,
 * extended_properties, and visibility live in the DB but are not loaded.
 */
export function mapOverride(r: DbOverride, renderZone: string, allDay = false): EventOverride {
  const slim: EventOverride = {
    id: r.id,
    parentEventId: r.parent_event_id,
    recurrenceId: r.recurrence_id,
  };
  if (r.recurrence_range === "this-and-future") slim.recurrenceRange = "this-and-future";
  if (r.title) slim.title = r.title;
  if (r.start_time) slim.start = toCalendarDate(r.start_time, renderZone, allDay);
  if (r.end_time) slim.end = toCalendarDate(r.end_time, renderZone, allDay);
  const color = normalizeEventColor(r.color);
  if (color !== undefined) slim.color = color;
  if (r.status) slim.status = r.status as EventStatus;
  if (r.transparency) slim.transparency = r.transparency as EventTransparency;
  return slim;
}
