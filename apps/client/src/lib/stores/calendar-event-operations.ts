import { invoke } from "@tauri-apps/api/core";
import type {
  AttendeeStatus,
  CalendarEvent,
  EventAttendee,
  EventColor,
  EventOrganizer,
  EventStatus,
  EventTransparency,
  EventVisibility,
  GeoCoordinates,
  GuestPermissions,
  PomodoroConfig,
  RecurrenceConfig,
} from "$lib/components/calendar/types";
import { fmtYMD, parseYMD } from "$lib/components/calendar/recurrence";
import { recurrenceConfigsEqual, recurrenceToRrule } from "$lib/components/calendar/rrule";
import { sanitizeCalendarTime } from "$lib/components/calendar/utils";
import { sanitizeCalendarDescriptionHtml } from "$lib/calendar/description-sanitizer";
import { dbUrl } from "$lib/api/db";
import { toDbTime } from "./map-row";
import {
  hasEventPatchKey,
  hasMeetingState,
  localTimezone,
  nowIso,
  resolvedPomodoroConfigForTimedEvent,
} from "./calendar-event-payloads";
import { slimEvent } from "./calendar-event-hydration";

export interface CalendarAddBlockOptions {
  title: string;
  start: string;
  end: string;
  id?: string;
  timezone?: string;
  calendarId?: string;
  color?: EventColor;
  description?: string;
  recurrence?: RecurrenceConfig;
  notifications?: number[];
  exceptions?: string[];
  pomodoroConfig?: PomodoroConfig;
  allDay?: boolean;
  location?: string;
  url?: string;
  transparency?: EventTransparency;
  status?: EventStatus;
  sourceUid?: string;
  visibility?: EventVisibility;
  priority?: number;
  categories?: string[];
  geo?: GeoCoordinates;
  sequence?: number;
  rdate?: string[];
  extendedProperties?: Record<string, string>;
  organizer?: EventOrganizer;
  attendees?: EventAttendee[];
  localParticipationStatus?: AttendeeStatus;
  guestPermissions?: GuestPermissions;
  meetingEnabled?: boolean;
}

export interface CalendarDetachInstanceResult {
  parentId: string;
  exceptions: string[];
  standalone: CalendarEvent;
}

export interface CalendarSplitSeriesResult {
  parentId: string;
  cappedRecurrence: RecurrenceConfig | undefined;
  newTemplate: CalendarEvent;
}

export async function addCalendarException(
  parent: CalendarEvent,
  date: string,
): Promise<string[]> {
  const exceptions = [...(parent.exceptions ?? []), date];
  await invoke("calendar_update_event", {
    dbUrl: dbUrl(),
    patch: {
      id: parent.id,
      updatedAt: nowIso(),
      fields: [{ field: "exceptions", value: JSON.stringify(exceptions) }],
      attendees: null,
      alarms: null,
      pomodoroConfig: null,
    },
  });
  return exceptions;
}

export async function setCalendarRepeatUntil(
  parent: CalendarEvent,
  date: string,
): Promise<RecurrenceConfig | undefined> {
  if (!parent.recurrence) return undefined;
  const updatedRecurrence: RecurrenceConfig = {
    ...parent.recurrence,
    end: { type: "until", date },
  };
  await invoke("calendar_update_event", {
    dbUrl: dbUrl(),
    patch: {
      id: parent.id,
      updatedAt: nowIso(),
      fields: [
        { field: "repeatUntil", value: date },
        { field: "rrule", value: recurrenceToRrule(updatedRecurrence) },
      ],
      attendees: null,
      alarms: null,
      pomodoroConfig: null,
    },
  });
  return updatedRecurrence;
}

export async function addCalendarBlock(opts: CalendarAddBlockOptions): Promise<CalendarEvent> {
  const sanitizedStart = sanitizeCalendarTime(opts.start);
  const sanitizedEnd = sanitizeCalendarTime(opts.end);
  if (!sanitizedStart || !sanitizedEnd) {
    throw new Error(`Invalid calendar time format: start="${opts.start}", end="${opts.end}"`);
  }

  const id = opts.id ?? crypto.randomUUID();
  const now = nowIso();
  const timezone = opts.timezone ?? localTimezone();
  const calendarId = opts.calendarId ?? "local";
  const description = sanitizeCalendarDescriptionHtml(opts.description ?? "");
  const meetingEnabled = opts.meetingEnabled ?? hasMeetingState(opts);
  const rrule = opts.recurrence ? recurrenceToRrule(opts.recurrence) : null;
  const repeatUntil = opts.recurrence?.end.type === "until"
    ? opts.recurrence.end.date : null;
  const notifJson = opts.notifications && opts.notifications.length > 0
    ? JSON.stringify(opts.notifications) : null;
  const exceptionsJson = opts.exceptions && opts.exceptions.length > 0
    ? JSON.stringify(opts.exceptions) : null;
  await invoke("calendar_add_event", {
    dbUrl: dbUrl(),
    event: {
      id,
      title: opts.title,
      startTime: toDbTime(sanitizedStart, timezone, opts.allDay),
      endTime: toDbTime(sanitizedEnd, timezone, opts.allDay),
      timezone,
      calendarId,
      color: opts.color ?? null,
      description,
      rrule,
      notifications: notifJson,
      exceptions: exceptionsJson,
      repeatUntil,
      allDay: opts.allDay ?? false,
      location: opts.location ?? "",
      url: opts.url ?? "",
      transparency: opts.transparency ?? "opaque",
      status: opts.status ?? "confirmed",
      sourceUid: opts.sourceUid ?? null,
      visibility: opts.visibility ?? "public",
      priority: opts.priority ?? null,
      categories: opts.categories ? JSON.stringify(opts.categories) : null,
      geo: opts.geo ? JSON.stringify(opts.geo) : null,
      sequence: opts.sequence ?? 0,
      rdate: opts.rdate ? JSON.stringify(opts.rdate) : null,
      extendedProperties: opts.extendedProperties
        ? JSON.stringify(opts.extendedProperties)
        : null,
      organizer: opts.organizer ? JSON.stringify(opts.organizer) : null,
      meetingEnabled,
      localRsvpStatus: opts.localParticipationStatus ?? null,
      guestCanModify: opts.guestPermissions?.canModify ?? false,
      guestCanInviteOthers: opts.guestPermissions?.canInviteOthers ?? true,
      guestCanSeeOtherGuests: opts.guestPermissions?.canSeeOtherGuests ?? true,
      createdAt: now,
      updatedAt: now,
      pomodoroConfig: opts.pomodoroConfig ?? null,
      attendees: (opts.attendees ?? []).map((attendee) => ({
        id: attendee.id,
        name: attendee.name ?? null,
        email: attendee.email,
        role: attendee.role,
        status: attendee.status,
        rsvp: attendee.rsvp,
      })),
    },
  });
  return slimEvent({
    id,
    title: opts.title,
    start: sanitizedStart,
    end: sanitizedEnd,
    timezone,
    calendarId,
    color: opts.color,
    recurrence: opts.recurrence,
    notifications: opts.notifications,
    exceptions: opts.exceptions,
    pomodoroConfig: opts.pomodoroConfig,
    meetingEnabled,
    allDay: opts.allDay,
    location: opts.location,
    url: opts.url,
    transparency: opts.transparency,
    status: opts.status,
    localParticipationStatus: opts.localParticipationStatus,
  });
}

export async function detachCalendarInstance(
  instanceEvent: CalendarEvent,
  parent: CalendarEvent,
): Promise<CalendarDetachInstanceResult> {
  const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
  const instanceDate = instanceEvent.start.split(" ")[0];
  const exceptions = [...(parent.exceptions ?? []), instanceDate];
  const now = nowIso();
  const newId = crypto.randomUUID();
  const timezone = parent.timezone || localTimezone();
  const notifJson = parent.notifications && parent.notifications.length > 0
    ? JSON.stringify(parent.notifications) : null;
  await invoke("calendar_detach_instance", {
    dbUrl: dbUrl(),
    input: {
      parentId,
      instanceDate,
      exceptions: JSON.stringify(exceptions),
      newId,
      title: instanceEvent.title,
      startTime: toDbTime(instanceEvent.start, timezone, parent.allDay),
      endTime: toDbTime(instanceEvent.end, timezone, parent.allDay),
      timezone,
      calendarId: parent.calendarId,
      color: instanceEvent.color ?? null,
      notifications: notifJson,
      allDay: parent.allDay ?? false,
      location: parent.location ?? "",
      transparency: parent.transparency ?? "opaque",
      status: parent.status ?? "confirmed",
      now,
    },
  });

  const standalone: CalendarEvent = slimEvent({
    id: newId,
    title: instanceEvent.title,
    start: instanceEvent.start,
    end: instanceEvent.end,
    timezone,
    calendarId: parent.calendarId,
    color: instanceEvent.color,
    allDay: parent.allDay,
    location: parent.location,
    transparency: parent.transparency,
    status: parent.status,
    localParticipationStatus: parent.localParticipationStatus,
    meetingEnabled: parent.meetingEnabled,
    notifications: parent.notifications,
    pomodoroConfig: parent.allDay ? undefined : parent.pomodoroConfig,
  });
  return { parentId, exceptions, standalone };
}

export async function splitCalendarSeries(
  instanceEvent: CalendarEvent,
  changes: Partial<CalendarEvent>,
  parent: CalendarEvent,
): Promise<CalendarSplitSeriesResult> {
  const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
  const splitDate = instanceEvent.start.split(" ")[0];
  const newStartDateStr = changes.start
    ? String(changes.start).split(" ")[0]
    : splitDate;
  const capDate = newStartDateStr < splitDate ? newStartDateStr : splitDate;
  const capBefore = parseYMD(capDate);
  capBefore.setDate(capBefore.getDate() - 1);
  const dayBefore = fmtYMD(capBefore);
  const now = nowIso();

  const cappedRecurrence: RecurrenceConfig | undefined = parent.recurrence
    ? { ...parent.recurrence, end: { type: "until", date: dayBefore } }
    : undefined;
  const cappedRrule = cappedRecurrence ? recurrenceToRrule(cappedRecurrence) : null;
  const newId = crypto.randomUUID();
  const newStart = changes.start
    ? String(changes.start)
    : `${splitDate} ${instanceEvent.start.split(" ")[1]}`;
  const newEnd = changes.end
    ? String(changes.end)
    : `${splitDate} ${instanceEvent.end.split(" ")[1]}`;
  const newStartDate = newStart.split(" ")[0];
  const newExceptions = (parent.exceptions ?? []).filter((date) => date >= newStartDate);
  const merged = { ...parent, ...changes };
  const meetingEnabled = merged.meetingEnabled ?? hasMeetingState(merged);
  const recurrenceChanged = hasEventPatchKey(changes, "recurrence")
    && !recurrenceConfigsEqual(changes.recurrence, parent.recurrence);
  const newRecurrence: RecurrenceConfig | undefined = recurrenceChanged
    ? changes.recurrence
    : parent.recurrence
      ? { ...parent.recurrence, end: { type: "never" } }
      : undefined;
  const rrule = newRecurrence ? recurrenceToRrule(newRecurrence) : null;
  const localParticipationStatus = merged.localParticipationStatus;
  const splitNotifJson = merged.notifications && merged.notifications.length > 0
    ? JSON.stringify(merged.notifications) : null;
  const splitExceptionsJson = newExceptions.length > 0
    ? JSON.stringify(newExceptions) : null;
  const homeZone = parent.timezone || localTimezone();
  const descriptionPatch = "description" in changes
    ? sanitizeCalendarDescriptionHtml(changes.description ?? "") : null;
  const urlPatch = "url" in changes ? (changes.url ?? "") : null;
  const pomodoroState = resolvedPomodoroConfigForTimedEvent(parent, changes, merged.allDay);
  await invoke("calendar_split_series", {
    dbUrl: dbUrl(),
    input: {
      parentId,
      dayBefore,
      cappedRrule,
      newId,
      title: merged.title ?? parent.title,
      startTime: toDbTime(newStart, homeZone, merged.allDay),
      endTime: toDbTime(newEnd, homeZone, merged.allDay),
      timezone: homeZone,
      calendarId: parent.calendarId,
      color: merged.color ?? null,
      notifications: splitNotifJson,
      exceptions: splitExceptionsJson,
      rrule,
      allDay: merged.allDay ?? false,
      location: merged.location ?? "",
      transparency: merged.transparency ?? "opaque",
      status: merged.status ?? "confirmed",
      descriptionPatch,
      urlPatch,
      localRsvpStatus: localParticipationStatus ?? null,
      meetingEnabled,
      copyPomodoroConfig: pomodoroState.copyFromParent,
      pomodoroConfig: pomodoroState.payloadConfig,
      now,
    },
  });

  const newTemplate = slimEvent({
    ...parent,
    ...changes,
    id: newId,
    start: newStart,
    end: newEnd,
    timezone: homeZone,
    recurrence: newRecurrence,
    recurringParentId: undefined,
    exceptions: newExceptions.length > 0 ? newExceptions : undefined,
    pomodoroConfig: pomodoroState.finalConfig,
  });
  return { parentId, cappedRecurrence, newTemplate };
}
