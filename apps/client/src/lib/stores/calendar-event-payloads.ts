import type {
  AttendeeStatus,
  CalendarEvent,
  EventStatus,
  EventTransparency,
  EventVisibility,
  GuestPermissions,
  PomodoroConfig,
} from "$lib/components/calendar/types";
import { recurrenceToRrule } from "$lib/components/calendar/rrule";
import { sanitizeCalendarTime } from "$lib/components/calendar/utils";
import { sanitizeCalendarDescriptionHtml } from "$lib/calendar/description-sanitizer";
import { configEquals } from "$lib/pomodoro/rhythm";
import { toDbTime } from "./map-row";

export type CalendarUpdateField =
  | { field: "title"; value: string }
  | { field: "startTime"; value: string }
  | { field: "endTime"; value: string }
  | { field: "timezone"; value: string }
  | { field: "calendarId"; value: string }
  | { field: "color"; value: number | null }
  | { field: "description"; value: string }
  | { field: "rrule"; value: string | null }
  | { field: "repeatUntil"; value: string | null }
  | { field: "notifications"; value: string | null }
  | { field: "exceptions"; value: string | null }
  | { field: "allDay"; value: boolean }
  | { field: "meetingEnabled"; value: boolean }
  | { field: "location"; value: string }
  | { field: "url"; value: string }
  | { field: "transparency"; value: EventTransparency }
  | { field: "status"; value: EventStatus }
  | { field: "sourceUid"; value: string | null }
  | { field: "visibility"; value: EventVisibility }
  | { field: "priority"; value: number | null }
  | { field: "categories"; value: string | null }
  | { field: "geo"; value: string | null }
  | { field: "sequence"; value: number }
  | { field: "rdate"; value: string | null }
  | { field: "extendedProperties"; value: string | null }
  | { field: "organizer"; value: string | null }
  | { field: "localRsvpStatus"; value: AttendeeStatus | null }
  | {
      field: "guestPermissions";
      value: {
        guestCanModify: boolean;
        guestCanInviteOthers: boolean;
        guestCanSeeOtherGuests: boolean;
      };
    };

export type PomodoroConfigPatch =
  | { action: "set"; value: PomodoroConfig }
  | { action: "clear" };

export interface CalendarEventUpdatePayload {
  id: string;
  updatedAt: string;
  fields: CalendarUpdateField[];
  attendees: Array<{
    id: string;
    name: string | null;
    email: string;
    role: string;
    status: string;
    rsvp: boolean;
  }> | null;
  alarms: Array<{
    id: string;
    action: string;
    triggerType: string;
    triggerValue: string;
    description: string | null;
  }> | null;
  pomodoroConfig: PomodoroConfigPatch | null;
}

export interface CalendarDetachInstancePayload {
  parentId: string;
  instanceDate: string;
  exceptions: string;
  newId: string;
  title: string;
  startTime: string;
  endTime: string;
  timezone: string;
  calendarId: string;
  color: number | null;
  notifications: string | null;
  allDay: boolean;
  location: string;
  transparency: EventTransparency;
  status: EventStatus;
  now: string;
}

export interface CalendarSplitSeriesPayload {
  parentId: string;
  dayBefore: string;
  cappedRrule: string | null;
  newId: string;
  title: string;
  startTime: string;
  endTime: string;
  timezone: string;
  calendarId: string;
  color: number | null;
  notifications: string | null;
  exceptions: string | null;
  rrule: string | null;
  allDay: boolean;
  location: string;
  transparency: EventTransparency;
  status: EventStatus;
  descriptionPatch: string | null;
  urlPatch: string | null;
  localRsvpStatus: AttendeeStatus | null;
  meetingEnabled: boolean;
  copyPomodoroConfig: boolean;
  pomodoroConfig: PomodoroConfig | null;
  now: string;
}

export type CalendarRecurrenceCommitOperationPayload =
  | { type: "update_event"; patch: CalendarEventUpdatePayload }
  | { type: "detach_instance"; input: CalendarDetachInstancePayload }
  | { type: "split_series"; input: CalendarSplitSeriesPayload }
  | {
      type: "transfer_active_event_reference";
      transfer: {
        newEventId: string;
        newEventDate: string | null;
        plannedEnd: string | null;
      };
    };

export function nowIso(): string {
  return new Date().toISOString();
}

export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function hasNonDefaultGuestPermissions(value: GuestPermissions | undefined): boolean {
  return !!value && (value.canModify || !value.canInviteOthers || !value.canSeeOtherGuests);
}

export function hasMeetingState(value: Partial<CalendarEvent>): boolean {
  return value.meetingEnabled === true
    || !!(value.attendees && value.attendees.length > 0)
    || !!value.organizer
    || !!value.location
    || !!value.url
    || !!value.geo
    || value.localParticipationStatus !== undefined
    || hasNonDefaultGuestPermissions(value.guestPermissions);
}

export function hasEventPatchKey<K extends keyof CalendarEvent>(
  changes: Partial<CalendarEvent>,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(changes, key);
}

export function resolvedPomodoroConfigForTimedEvent(
  parent: CalendarEvent,
  changes: Partial<CalendarEvent>,
  allDay: boolean | undefined,
): {
  copyFromParent: boolean;
  finalConfig: PomodoroConfig | undefined;
  payloadConfig: PomodoroConfig | null;
} {
  if (allDay) {
    return { copyFromParent: false, finalConfig: undefined, payloadConfig: null };
  }
  if (hasEventPatchKey(changes, "pomodoroConfig")) {
    return {
      copyFromParent: false,
      finalConfig: changes.pomodoroConfig,
      payloadConfig: changes.pomodoroConfig ?? null,
    };
  }
  return {
    copyFromParent: true,
    finalConfig: parent.pomodoroConfig,
    payloadConfig: null,
  };
}

/**
 * Detect whether changes affect event timing or pomodoro structure
 * (which would invalidate existing pomodoro segments) vs. purely cosmetic fields.
 */
export function hasStructuralChanges(
  template: CalendarEvent,
  changes: Partial<CalendarEvent>,
): boolean {
  if (changes.start) {
    const oldTime = template.start.split(" ")[1];
    const newTime = String(changes.start).split(" ")[1];
    if (oldTime !== newTime) return true;
  }
  if (changes.end) {
    const oldTime = template.end.split(" ")[1];
    const newTime = String(changes.end).split(" ")[1];
    if (oldTime !== newTime) return true;
  }
  if (changes.pomodoroConfig !== undefined) {
    const oldCfg = template.pomodoroConfig;
    const newCfg = changes.pomodoroConfig;
    if (!oldCfg && newCfg) return true;
    if (oldCfg && !newCfg) return true;
    if (oldCfg && newCfg) {
      if (!configEquals(oldCfg, newCfg)) return true;
    }
  }
  return false;
}

export function prepareUpdateBlockPayload(
  patch: Partial<CalendarEvent> & { id: string },
  blocks: readonly CalendarEvent[],
): { parentId: string; toUpdate: Partial<CalendarEvent> & { id: string }; payload: CalendarEventUpdatePayload } {
  const parentId = patch.recurringParentId ?? patch.id;
  let toUpdate: Partial<CalendarEvent> & { id: string };

  if (patch.recurringParentId) {
    const template = blocks.find((b) => b.id === parentId);
    toUpdate = { ...patch, id: parentId };
    delete toUpdate.recurringParentId;
    if (template) {
      if (patch.start) {
        const templateStartDate = template.start.split(" ")[0];
        toUpdate.start = `${templateStartDate} ${String(patch.start).split(" ")[1]}`;
      }
      if (patch.end) {
        const templateEndDate = template.end.split(" ")[0];
        toUpdate.end = `${templateEndDate} ${String(patch.end).split(" ")[1]}`;
      }
    }
  } else {
    toUpdate = { ...patch };
    delete toUpdate.recurringParentId;
  }

  if (toUpdate.start !== undefined) {
    const sanitized = sanitizeCalendarTime(String(toUpdate.start));
    if (!sanitized) {
      throw new Error(`Invalid calendar time format: start="${toUpdate.start}"`);
    }
    toUpdate.start = sanitized;
  }
  if (toUpdate.end !== undefined) {
    const sanitized = sanitizeCalendarTime(String(toUpdate.end));
    if (!sanitized) {
      throw new Error(`Invalid calendar time format: end="${toUpdate.end}"`);
    }
    toUpdate.end = sanitized;
  }
  if ("description" in toUpdate) {
    toUpdate.description = sanitizeCalendarDescriptionHtml(toUpdate.description ?? "");
  }

  const existing = blocks.find((b) => b.id === parentId);
  const homeZone = toUpdate.timezone ?? existing?.timezone ?? localTimezone();
  const allDayForDb = "allDay" in toUpdate ? !!toUpdate.allDay : !!existing?.allDay;
  const fields: CalendarUpdateField[] = [];
  const presentKeys = new Set(Object.keys(toUpdate) as Array<keyof CalendarEvent | "id">);
  const addField = (field: CalendarUpdateField) => {
    fields.push(field);
  };

  for (const key of presentKeys) {
    switch (key) {
      case "id":
      case "recurringParentId":
      case "pomodoroConfig":
      case "attendees":
      case "alarms":
      case "overrides":
        break;
      case "title":
        addField({ field: "title", value: toUpdate.title ?? "" });
        break;
      case "start":
        addField({
          field: "startTime",
          value: toDbTime(String(toUpdate.start), homeZone, allDayForDb),
        });
        break;
      case "end":
        addField({
          field: "endTime",
          value: toDbTime(String(toUpdate.end), homeZone, allDayForDb),
        });
        break;
      case "timezone":
        addField({ field: "timezone", value: toUpdate.timezone ?? "" });
        break;
      case "calendarId":
        addField({ field: "calendarId", value: toUpdate.calendarId ?? "local" });
        break;
      case "color":
        addField({ field: "color", value: toUpdate.color ?? null });
        break;
      case "description":
        addField({ field: "description", value: toUpdate.description ?? "" });
        break;
      case "recurrence": {
        const rrule = toUpdate.recurrence ? recurrenceToRrule(toUpdate.recurrence) : null;
        const repeatUntil = toUpdate.recurrence?.end.type === "until"
          ? toUpdate.recurrence.end.date
          : null;
        addField({ field: "rrule", value: rrule });
        addField({ field: "repeatUntil", value: repeatUntil });
        break;
      }
      case "notifications": {
        const notifJson = toUpdate.notifications && toUpdate.notifications.length > 0
          ? JSON.stringify(toUpdate.notifications)
          : null;
        addField({ field: "notifications", value: notifJson });
        break;
      }
      case "exceptions": {
        const exceptionsJson = toUpdate.exceptions && toUpdate.exceptions.length > 0
          ? JSON.stringify(toUpdate.exceptions)
          : null;
        addField({ field: "exceptions", value: exceptionsJson });
        break;
      }
      case "allDay":
        addField({ field: "allDay", value: !!toUpdate.allDay });
        break;
      case "meetingEnabled":
        addField({ field: "meetingEnabled", value: !!toUpdate.meetingEnabled });
        break;
      case "location":
        addField({ field: "location", value: toUpdate.location ?? "" });
        break;
      case "url":
        addField({ field: "url", value: toUpdate.url ?? "" });
        break;
      case "transparency":
        addField({ field: "transparency", value: toUpdate.transparency ?? "opaque" });
        break;
      case "status":
        addField({ field: "status", value: toUpdate.status ?? "confirmed" });
        break;
      case "sourceUid":
        addField({ field: "sourceUid", value: toUpdate.sourceUid ?? null });
        break;
      case "visibility":
        addField({ field: "visibility", value: toUpdate.visibility ?? "public" });
        break;
      case "priority":
        addField({ field: "priority", value: toUpdate.priority ?? null });
        break;
      case "categories":
        addField({
          field: "categories",
          value: toUpdate.categories ? JSON.stringify(toUpdate.categories) : null,
        });
        break;
      case "geo":
        addField({
          field: "geo",
          value: toUpdate.geo ? JSON.stringify(toUpdate.geo) : null,
        });
        break;
      case "sequence":
        addField({ field: "sequence", value: toUpdate.sequence ?? 0 });
        break;
      case "rdate":
        addField({
          field: "rdate",
          value: toUpdate.rdate ? JSON.stringify(toUpdate.rdate) : null,
        });
        break;
      case "extendedProperties":
        addField({
          field: "extendedProperties",
          value: toUpdate.extendedProperties ? JSON.stringify(toUpdate.extendedProperties) : null,
        });
        break;
      case "organizer":
        addField({
          field: "organizer",
          value: toUpdate.organizer ? JSON.stringify(toUpdate.organizer) : null,
        });
        break;
      case "localParticipationStatus":
        addField({
          field: "localRsvpStatus",
          value: toUpdate.localParticipationStatus ?? null,
        });
        break;
      case "guestPermissions": {
        const gp = toUpdate.guestPermissions;
        addField({
          field: "guestPermissions",
          value: {
            guestCanModify: gp?.canModify ?? false,
            guestCanInviteOthers: gp?.canInviteOthers ?? true,
            guestCanSeeOtherGuests: gp?.canSeeOtherGuests ?? true,
          },
        });
        break;
      }
      case "hasCallLink":
      case "surfaceStatus":
      case "surfaceAttendees":
      case "icalendarComponentId":
      case "icalendarPreservationStatus":
      case "icalendarProjectionWarnings":
      case "icalendarRawJcal":
        break;
    }
  }

  const pomodoroConfig: PomodoroConfigPatch | null = allDayForDb && presentKeys.has("allDay")
    ? { action: "clear" }
    : presentKeys.has("pomodoroConfig")
    ? toUpdate.pomodoroConfig
      ? { action: "set", value: toUpdate.pomodoroConfig }
      : { action: "clear" }
    : null;

  return {
    parentId,
    toUpdate,
    payload: {
      id: parentId,
      updatedAt: nowIso(),
      fields,
      attendees: presentKeys.has("attendees")
        ? (toUpdate.attendees ?? []).map((attendee) => ({
            id: attendee.id,
            name: attendee.name ?? null,
            email: attendee.email,
            role: attendee.role,
            status: attendee.status,
            rsvp: attendee.rsvp,
          }))
        : null,
      alarms: presentKeys.has("alarms")
        ? (toUpdate.alarms ?? []).map((alarm) => ({
            id: alarm.id,
            action: alarm.action,
            triggerType: alarm.triggerType,
            triggerValue: alarm.triggerValue,
            description: alarm.description ?? null,
          }))
        : null,
      pomodoroConfig,
    },
  };
}
