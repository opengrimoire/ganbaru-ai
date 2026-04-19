import type {
  AlarmAction, AttendeeRole, AttendeeStatus, CalendarEvent, EventAlarm,
  EventAttendee, EventOverride, EventOrganizer, EventStatus,
  EventTransparency, EventVisibility, GeoCoordinates, GuestPermissions,
} from "$lib/components/calendar/types";
import { rruleToRecurrence } from "$lib/components/calendar/rrule";
import { normalizeEventColor } from "$lib/components/calendar/utils";

export interface DbCalendarEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  timezone: string;
  calendar_id: string;
  color: number | null;
  description: string;
  rrule: string | null;
  notifications: string | null;
  exceptions: string | null;
  repeat_until: string | null;
  all_day: number;
  location: string;
  url: string;
  transparency: string;
  status: string;
  // migration 3: icalendar import readiness
  source_uid: string | null;
  visibility: string;
  priority: number | null;
  categories: string | null;
  geo: string | null;
  sequence: number;
  rdate: string | null;
  extended_properties: string | null;
  organizer: string | null;
  // migration 4: guest permissions
  guest_can_modify: number;
  guest_can_invite_others: number;
  guest_can_see_other_guests: number;
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
  name: string | null;
  email: string;
  role: string;
  status: string;
  rsvp: number;
  sort_order: number;
}

export interface DbAlarm {
  id: string;
  event_id: string;
  action: string;
  trigger_type: string;
  trigger_value: string;
  description: string | null;
  sort_order: number;
}

export interface DbOverride {
  id: string;
  parent_event_id: string;
  recurrence_id: string;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  location: string | null;
  url: string | null;
  color: number | null;
  status: string | null;
  transparency: string | null;
  visibility: string | null;
  extended_properties: string | null;
}

export function safeJsonParse<T>(json: string | null): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

export function toCalendarDate(dbTime: string): string {
  return dbTime.substring(0, 16).replace("T", " ");
}

export function toDbTime(calendarDate: string): string {
  return calendarDate + ":00";
}

export function mapRow(r: DbCalendarEvent): CalendarEvent {
  return {
    id: r.id,
    title: r.title,
    start: toCalendarDate(r.start_time),
    end: toCalendarDate(r.end_time),
    timezone: r.timezone,
    calendarId: r.calendar_id,
    color: normalizeEventColor(r.color),
    description: r.description || undefined,
    recurrence: r.rrule ? rruleToRecurrence(r.rrule, r.repeat_until ?? undefined) : undefined,
    notifications: safeJsonParse<number[]>(r.notifications),
    exceptions: safeJsonParse<string[]>(r.exceptions),
    allDay: r.all_day === 1 ? true : undefined,
    location: r.location || undefined,
    url: r.url || undefined,
    transparency: r.transparency === "transparent" ? "transparent" as EventTransparency : undefined,
    status: r.status !== "confirmed" ? r.status as EventStatus : undefined,
    sourceUid: r.source_uid || undefined,
    visibility: r.visibility !== "public" ? r.visibility as EventVisibility : undefined,
    priority: r.priority ?? undefined,
    categories: safeJsonParse<string[]>(r.categories),
    geo: safeJsonParse<GeoCoordinates>(r.geo),
    sequence: r.sequence || undefined,
    rdate: safeJsonParse<string[]>(r.rdate),
    extendedProperties: safeJsonParse<Record<string, string>>(r.extended_properties),
    organizer: safeJsonParse<EventOrganizer>(r.organizer),
    guestPermissions: (r.guest_can_modify !== 0 || r.guest_can_invite_others !== 1 || r.guest_can_see_other_guests !== 1)
      ? {
        canModify: r.guest_can_modify === 1,
        canInviteOthers: r.guest_can_invite_others === 1,
        canSeeOtherGuests: r.guest_can_see_other_guests === 1,
      } : undefined,
    pomodoroConfig: r.focus_duration_minutes != null ? {
      focusDurationMinutes: r.focus_duration_minutes,
      shortBreakMinutes: r.short_break_minutes!,
      longBreakMinutes: r.long_break_minutes!,
      pomodoroCount: r.pomodoro_count!,
      idleTimeoutMinutes: r.idle_timeout_minutes,
    } : undefined,
  };
}

export function mapAttendee(r: DbAttendee): EventAttendee {
  return {
    id: r.id,
    name: r.name || undefined,
    email: r.email,
    role: r.role as AttendeeRole,
    status: r.status as AttendeeStatus,
    rsvp: r.rsvp === 1,
  };
}

export function mapAlarm(r: DbAlarm): EventAlarm {
  return {
    id: r.id,
    action: r.action as AlarmAction,
    triggerType: r.trigger_type as "relative" | "absolute",
    triggerValue: r.trigger_value,
    description: r.description || undefined,
  };
}

export function mapOverride(r: DbOverride): EventOverride {
  return {
    id: r.id,
    parentEventId: r.parent_event_id,
    recurrenceId: r.recurrence_id,
    title: r.title || undefined,
    start: r.start_time ? toCalendarDate(r.start_time) : undefined,
    end: r.end_time ? toCalendarDate(r.end_time) : undefined,
    description: r.description || undefined,
    location: r.location || undefined,
    url: r.url || undefined,
    color: normalizeEventColor(r.color),
    status: r.status ? r.status as EventStatus : undefined,
    transparency: r.transparency ? r.transparency as EventTransparency : undefined,
    visibility: r.visibility ? r.visibility as EventVisibility : undefined,
    extendedProperties: safeJsonParse<Record<string, string>>(r.extended_properties),
  };
}
