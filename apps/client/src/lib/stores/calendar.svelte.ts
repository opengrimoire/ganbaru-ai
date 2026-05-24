import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Temporal } from "@js-temporal/polyfill";
import { dbUrl, ensureDbUrl } from "$lib/api/db";
import type {
  Calendar, CalendarEvent, EventAttendee, EventColor, EventOverride,
  EventOrganizer, EventStatus, EventTransparency, EventVisibility, AttendeeStatus,
  GeoCoordinates, GuestPermissions, IcalendarPreservationStatus, PomodoroConfig, RecurrenceConfig,
} from "$lib/components/calendar/types";
import type {
  CalendarDeleteArchiveOperation,
} from "$lib/components/calendar/delete-archive-plan";
import {
  moveDatedPatchToDate,
  type RecurringCommitPlan,
} from "$lib/components/calendar/recurrence-edit-plan";
import {
  occurrenceOnDate,
  patchForTemplateAnchor,
  templateEndForDate,
  templateEventIdForDate,
} from "$lib/components/calendar/recurrence-commit-helpers";
import { recurrenceToRrule } from "$lib/components/calendar/rrule";
import { expandRecurring, parseYMD, fmtYMD } from "$lib/components/calendar/recurrence";
import {
  buildExpansionIndex,
  eventsInWindowFromIndex,
  type ExpansionIndex,
} from "$lib/components/calendar/calendar-index";
import {
  computeViewWindow, sanitizeCalendarTime, wallClockToUtcIso,
} from "$lib/components/calendar/utils";
import {
  mapAlarm, mapAttendee, mapOverride, mapRow, mapWindowAttendee, safeJsonParse, toDbTime,
  type DbAlarm, type DbAttendee, type DbCalendarEvent, type DbOverride, type DbWindowAttendee,
} from "./map-row";
import {
  buildBulkImportPayload,
  type CalendarImportSourceKind,
  type CalendarBulkImportResult,
} from "./calendar-bulk-import";
import {
  buildCalendarEventMutationTarget,
  buildCalendarEventMutationTargetFromId,
  type CalendarEventMutationTarget,
} from "./calendar-mutations";
import { sanitizeCalendarDescriptionHtml } from "$lib/calendar/description-sanitizer";
import { calendarDisplayName } from "$lib/calendar/calendar-display";
import { adjacentCalendarWindowRequests } from "./calendar-window-prefetch";
import {
  BoundedWindowCache,
  LatestWindowLoadCoordinator,
  type WindowLoadEvent,
  type WindowLoadOutcome,
} from "./window-load-coordinator";
import type { IcsImportSummary, IcsPreservationPayload } from "$lib/calendar/ics/types";
import { deriveIcalendarProjectionState } from "$lib/calendar/ics/projection-state";
import { mark as perfMark } from "$lib/stores/perflog.svelte";
import {
  createWindowSyncEnvelope,
  isForeignWindowSyncEnvelope,
  isWindowSyncEnvelope,
} from "$lib/window-sync";

export { expandRecurring, parseYMD, fmtYMD };

type CalendarUpdateField =
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

type PomodoroConfigPatch =
  | { action: "set"; value: PomodoroConfig }
  | { action: "clear" };

interface CalendarEventUpdatePayload {
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

interface CalendarDetachInstancePayload {
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

interface CalendarSplitSeriesPayload {
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
  pomodoroConfig: PomodoroConfig | null;
  now: string;
}

type CalendarRecurrenceCommitOperationPayload =
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

const CALENDAR_WINDOW_SYNC_EVENT = "calendar-window-sync";

interface CalendarWindowSyncPayload {
  kind: "data-changed";
}

let calendarSyncInitialized = false;

function nowIso(): string {
  return new Date().toISOString();
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function hasNonDefaultGuestPermissions(value: GuestPermissions | undefined): boolean {
  return !!value && (value.canModify || !value.canInviteOthers || !value.canSeeOtherGuests);
}

function hasMeetingState(value: Partial<CalendarEvent>): boolean {
  return value.meetingEnabled === true
    || !!(value.attendees && value.attendees.length > 0)
    || !!value.organizer
    || !!value.location
    || !!value.url
    || !!value.geo
    || value.localParticipationStatus !== undefined
    || hasNonDefaultGuestPermissions(value.guestPermissions);
}

function hasEventPatchKey<K extends keyof CalendarEvent>(
  changes: Partial<CalendarEvent>,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(changes, key);
}

function recurrenceConfigsEqual(
  a: RecurrenceConfig | undefined,
  b: RecurrenceConfig | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Detect whether changes affect event timing or pomodoro structure
 * (which would invalidate existing pomodoro segments) vs. purely cosmetic fields.
 */
function hasStructuralChanges(
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
      if (oldCfg.focusDurationMinutes !== newCfg.focusDurationMinutes) return true;
      if (oldCfg.shortBreakMinutes !== newCfg.shortBreakMinutes) return true;
      if (oldCfg.longBreakMinutes !== newCfg.longBreakMinutes) return true;
      if (oldCfg.pomodoroCount !== newCfg.pomodoroCount) return true;
    }
  }
  return false;
}

function prepareUpdateBlockPayload(
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

  const pomodoroConfig: PomodoroConfigPatch | null = presentKeys.has("pomodoroConfig")
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

// Store

/** DB-backed template events for the current render window plus recurring templates. */
let rawBlocks = $state<CalendarEvent[]>([]);
let windowEvents = $state<CalendarEvent[]>([]);
let loaded = $state(false);
let totalEventCount = $state(0);
let currentWindowKey: string | null = null;
let currentWindowStart: Temporal.PlainDate | null = null;
let currentWindowEnd: Temporal.PlainDate | null = null;
let batchDepth = 0;
const PANEL_EVENT_CACHE_LIMIT = 64;
const panelEventCache = new Map<string, Promise<CalendarEvent | undefined>>();
const WINDOW_CACHE_LIMIT = 5;

type CalendarWindowLoadMode = "apply" | "prefetch";

interface CalendarWindowSnapshot {
  key: string;
  renderZone: string;
  windowStart: Temporal.PlainDate;
  windowEnd: Temporal.PlainDate;
  rawBlocks: CalendarEvent[];
  windowEvents: CalendarEvent[];
  totalEventCount: number;
}

interface CalendarWindowLoadRequest {
  key: string;
  renderZone: string;
  windowStart: Temporal.PlainDate;
  windowEnd: Temporal.PlainDate;
  markBoot: boolean;
  force: boolean;
  mode: CalendarWindowLoadMode;
}

const windowCache = new BoundedWindowCache<CalendarWindowSnapshot>(WINDOW_CACHE_LIMIT);
let prefetchGeneration = 0;
let foregroundWindowBusy = false;
let foregroundWindowRequestId = 0;
let foregroundWindowIdleWaiters: Array<() => void> = [];

type DbFullEvent = DbCalendarEvent & {
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

type DbFullOverride = DbOverride & {
  description: string | null;
  location: string | null;
  url: string | null;
  visibility: string | null;
  extended_properties: string | null;
  icalendar_component_id: string | null;
  icalendar_raw_jcal: string | null;
};

interface CalendarWindowRows {
  events: DbCalendarEvent[];
  overrides: DbOverride[];
  attendees: DbWindowAttendee[];
  total_event_count: number;
}

interface CalendarPanelEventRows {
  event: DbFullEvent | null;
  attendees: DbAttendee[];
}

interface CalendarFullEventRows {
  event: DbFullEvent | null;
  attendees: DbAttendee[];
  alarms: DbAlarm[];
  overrides: DbFullOverride[];
}

interface CalendarIcalendarExportMetadata {
  method: string | null;
  mixed_methods: boolean;
}

/**
 * Sorted lookup over the current render-window rows, rebuilt lazily after
 * each invalidate. The non-recurring events are sorted ascending by start so window queries can
 * bisect-and-walk in `O(log N + K)` instead of scanning every template.
 * Recurring templates stay in a small list and are walked exhaustively per
 * query. Until recurrence moves to Rust, the window command includes
 * recurring templates so TypeScript can preserve existing expansion behavior.
 */
let expansionIndex: ExpansionIndex | null = null;

/**
 * Reactivity token. `eventsInWindow` reads it so any `$derived` / `$effect`
 * that depends on the visible-event set re-runs after a mutation. Bumped
 * from `invalidate()`. External callers that need to react to mutations
 * without forcing an expansion subscribe via `void indexVersion`.
 */
let indexVersion = $state(0);

/**
 * Drop the cached index and bump the reactivity token so any
 * `$derived` / `$effect` reading `eventsInWindow` re-runs. The next read
 * rebuilds the index lazily; mutations are rare relative to reads so
 * eager rebuild would just waste work.
 */
function invalidate(recomputeWindow = true, clearCachedWindows = true) {
  if (batchDepth > 0) return;
  expansionIndex = null;
  if (clearCachedWindows) clearWindowCache();
  if (recomputeWindow && currentWindowStart && currentWindowEnd) {
    expansionIndex = buildExpansionIndex(rawBlocks);
    windowEvents = eventsInWindowFromIndex(expansionIndex, currentWindowStart, currentWindowEnd);
  }
  panelEventCache.clear();
  indexVersion++;
}

function rememberPanelEvent(id: string, promise: Promise<CalendarEvent | undefined>) {
  panelEventCache.set(id, promise);
  while (panelEventCache.size > PANEL_EVENT_CACHE_LIMIT) {
    const first = panelEventCache.keys().next().value;
    if (typeof first !== "string") break;
    panelEventCache.delete(first);
  }
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

function getIndex(): ExpansionIndex {
  if (!expansionIndex) expansionIndex = buildExpansionIndex(rawBlocks);
  return expansionIndex;
}

/**
 * Resolve an event to its DB-backed template.
 * For recurring instances returns the parent; for normal events returns itself.
 */
function resolveToTemplate(event: CalendarEvent): CalendarEvent | undefined {
  const parentId = event.recurringParentId ?? event.id;
  return rawBlocks.find((b) => b.id === parentId);
}

function mutationTargetForEvent(eventOrId: CalendarEvent | string): CalendarEventMutationTarget {
  if (typeof eventOrId === "string") {
    return buildCalendarEventMutationTargetFromId(eventOrId);
  }
  return buildCalendarEventMutationTarget(eventOrId, resolveToTemplate(eventOrId));
}

/**
 * Load slim per-instance overrides in one unfiltered query and group by
 * parent id. Heavy override columns (description, location, url,
 * extended_properties, visibility) stay in the DB and ride along with the
 * parent through the panel / full-event loaders when EventPanel, delete undo,
 * or ICS export needs them.
 */
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

function calendarWindowKey(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
  renderZone: string,
): string {
  return `${renderZone}:${windowStart.toString()}:${windowEnd.toString()}`;
}

function windowQueueKey(mode: CalendarWindowLoadMode, key: string): string {
  return `${mode}:${key}`;
}

function markWindowLoadEvent(event: WindowLoadEvent<CalendarWindowLoadRequest>): void {
  const request = "request" in event ? event.request : undefined;
  if (event.type === "start") {
    perfMark("window.load-start", {
      mode: request?.mode ?? "unknown",
      queued: windowLoadCoordinator.queuedKey ? 1 : 0,
    });
  } else if (event.type === "queue") {
    perfMark("window.load-queued", {
      mode: request?.mode ?? "unknown",
      replaced: event.replacedKey ? 1 : 0,
    });
  } else if (event.type === "drop") {
    perfMark("window.load-dropped", { reason: event.reason });
  } else if (event.type === "finish") {
    perfMark("window.load-finished", { outcome: event.outcome });
  } else {
    perfMark("window.load-error");
  }
}

function applyWindowSnapshot(snapshot: CalendarWindowSnapshot): void {
  rawBlocks = snapshot.rawBlocks;
  windowEvents = snapshot.windowEvents;
  totalEventCount = snapshot.totalEventCount;
  currentWindowKey = snapshot.key;
  currentWindowStart = snapshot.windowStart;
  currentWindowEnd = snapshot.windowEnd;
  loaded = true;
  invalidate(false, false);
  perfMark("window.applied", {
    rows: snapshot.rawBlocks.length,
    expanded: snapshot.windowEvents.length,
    cache: windowCache.size,
  });
}

function rememberWindowSnapshot(snapshot: CalendarWindowSnapshot): void {
  windowCache.set(snapshot.key, snapshot);
  perfMark("window.cache-put", {
    rows: snapshot.rawBlocks.length,
    expanded: snapshot.windowEvents.length,
    size: windowCache.size,
  });
}

function beginForegroundWindowLoad(): number {
  foregroundWindowBusy = true;
  return ++foregroundWindowRequestId;
}

function finishForegroundWindowLoad(requestId: number): void {
  if (requestId !== foregroundWindowRequestId) return;
  foregroundWindowBusy = false;
  resolveForegroundWindowIdle();
}

function resolveForegroundWindowIdle(): void {
  if (foregroundWindowBusy) return;
  const waiters = foregroundWindowIdleWaiters;
  foregroundWindowIdleWaiters = [];
  for (const resolve of waiters) resolve();
}

async function waitForForegroundWindowIdle(): Promise<void> {
  if (!foregroundWindowBusy) return;
  await new Promise<void>((resolve) => {
    foregroundWindowIdleWaiters.push(resolve);
  });
}

function adjacentWindowRequests(snapshot: CalendarWindowSnapshot): Array<{
  start: Temporal.PlainDate;
  end: Temporal.PlainDate;
}> {
  return adjacentCalendarWindowRequests(snapshot.windowStart, snapshot.windowEnd);
}

function mapWindowRows(rows: CalendarWindowRows, renderZone: string): CalendarEvent[] {
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

async function runWindowLoadRequest(
  request: CalendarWindowLoadRequest,
  isSuperseded: () => boolean,
): Promise<WindowLoadOutcome> {
  const {
    key,
    renderZone,
    windowStart,
    windowEnd,
    markBoot,
    mode,
  } = request;
  const url = await ensureDbUrl();
  const windowStartDate = windowStart.toString();
  const windowEndDate = windowEnd.toString();
  const windowEndExclusiveDate = windowEnd.add({ days: 1 }).toString();
  const rows = await invoke<CalendarWindowRows>("calendar_load_window", {
    dbUrl: url,
    windowStartDate,
    windowEndDate,
    windowStartUtc: wallClockToUtcIso(`${windowStartDate} 00:00`, renderZone),
    windowEndExclusiveUtc: wallClockToUtcIso(`${windowEndExclusiveDate} 00:00`, renderZone),
  });
  perfMark("window.rows-done", {
    mode,
    rows: rows.events.length,
    attendees: rows.attendees.length,
    total: rows.total_event_count,
  });

  if (!markBoot && isSuperseded()) {
    perfMark("window.load-superseded", { stage: "rows", mode });
    return "superseded";
  }

  if (markBoot) perfMark("boot.sql-main-done", { rows: rows.events.length, total: rows.total_event_count });
  const mapped = mapWindowRows(rows, renderZone);
  if (markBoot) perfMark("boot.maprow-done");

  if (!markBoot && isSuperseded()) {
    perfMark("window.load-superseded", { stage: "map", mode });
    return "superseded";
  }

  const expanded = await invoke<CalendarEvent[]>("calendar_expand_render_events", {
    events: mapped,
    windowStartDate,
    windowEndDate,
  });
  perfMark("window.expand-done", {
    mode,
    rows: mapped.length,
    expanded: expanded.length,
  });

  if (!markBoot && isSuperseded()) {
    perfMark("window.load-superseded", { stage: "expand", mode });
    return "superseded";
  }

  const snapshot: CalendarWindowSnapshot = {
    key,
    renderZone,
    windowStart,
    windowEnd,
    rawBlocks: mapped,
    windowEvents: expanded,
    totalEventCount: rows.total_event_count,
  };
  rememberWindowSnapshot(snapshot);

  if (mode === "apply") {
    applyWindowSnapshot(snapshot);
    if (markBoot) {
      perfMark("boot.sql-children-done");
      perfMark("boot.rawblocks-set", { events: rawBlocks.length, total: totalEventCount });
    }
    scheduleAdjacentPrefetch(snapshot);
  }

  return "applied";
}

const windowLoadCoordinator = new LatestWindowLoadCoordinator<CalendarWindowLoadRequest>(
  runWindowLoadRequest,
  markWindowLoadEvent,
);

async function loadWindowIntoState(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
  markBoot: boolean,
  force = false,
): Promise<void> {
  const renderZone = localTimezone();
  const key = calendarWindowKey(windowStart, windowEnd, renderZone);
  if (!force && !markBoot && loaded && currentWindowKey === key) return;
  if (!force && !markBoot) {
    const cached = windowCache.get(key);
    if (cached) {
      const foregroundId = ++foregroundWindowRequestId;
      foregroundWindowBusy = false;
      resolveForegroundWindowIdle();
      prefetchGeneration++;
      windowLoadCoordinator.supersedePending();
      perfMark("window.cache-hit", {
        rows: cached.rawBlocks.length,
        expanded: cached.windowEvents.length,
        size: windowCache.size,
      });
      applyWindowSnapshot(cached);
      scheduleAdjacentPrefetch(cached);
      finishForegroundWindowLoad(foregroundId);
      return;
    }
  }

  prefetchGeneration++;
  const foregroundId = beginForegroundWindowLoad();
  try {
    await windowLoadCoordinator.enqueue(windowQueueKey("apply", key), {
      key,
      renderZone,
      windowStart,
      windowEnd,
      markBoot,
      force,
      mode: "apply",
    });
  } finally {
    finishForegroundWindowLoad(foregroundId);
  }
}

async function prefetchWindow(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
  generation: number,
): Promise<void> {
  if (generation !== prefetchGeneration || !loaded) return;
  const renderZone = localTimezone();
  const key = calendarWindowKey(windowStart, windowEnd, renderZone);
  if (currentWindowKey === key || windowCache.has(key)) return;

  await windowLoadCoordinator.enqueue(windowQueueKey("prefetch", key), {
    key,
    renderZone,
    windowStart,
    windowEnd,
    markBoot: false,
    force: false,
    mode: "prefetch",
  });
}

function scheduleAdjacentPrefetch(snapshot: CalendarWindowSnapshot): void {
  const requests = adjacentWindowRequests(snapshot);
  if (requests.length === 0) return;
  const generation = ++prefetchGeneration;

  void (async () => {
    for (const request of requests) {
      if (generation !== prefetchGeneration) return;
      await prefetchWindow(request.start, request.end, generation);
    }
  })();
}

async function waitForWindowIdle(): Promise<void> {
  await windowLoadCoordinator.whenIdle();
}

function clearWindowCache(): void {
  windowCache.clear();
  prefetchGeneration++;
  windowLoadCoordinator.supersedePending();
}

async function reloadCurrentWindowFromDb(): Promise<void> {
  if (!currentWindowStart || !currentWindowEnd) {
    invalidate(false);
    return;
  }
  await reloadWindowFromDb(currentWindowStart, currentWindowEnd);
}

async function reloadWindowFromDb(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
): Promise<void> {
  clearWindowCache();
  await loadWindowIntoState(windowStart, windowEnd, false, true);
}

function isCalendarWindowSyncPayload(value: unknown): value is CalendarWindowSyncPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.kind === "data-changed";
}

function publishCalendarWindowSync(): void {
  emit(
    CALENDAR_WINDOW_SYNC_EVENT,
    createWindowSyncEnvelope<CalendarWindowSyncPayload>({ kind: "data-changed" }),
  ).catch((err) => console.warn("calendar window sync failed", err));
}

function initCalendarWindowSync(): void {
  if (calendarSyncInitialized) return;
  calendarSyncInitialized = true;
  listen<unknown>(CALENDAR_WINDOW_SYNC_EVENT, (event) => {
    const envelope = event.payload;
    if (!isWindowSyncEnvelope(envelope, isCalendarWindowSyncPayload)) return;
    if (!isForeignWindowSyncEnvelope(envelope)) return;
    reloadCurrentWindowFromDb().catch((err) => {
      console.warn("calendar window sync reload failed", err);
    });
  }).catch((err) => console.warn("calendar window sync listener failed", err));
}

/**
 * Build a slim copy of `e` containing only the keys the in-memory render,
 * expansion, and notification scheduler care about. Used at the boundary
 * where heavy events (ICS imports, addBlock opts) are pushed into
 * render state, so heavy fields stay in the DB and out of long-lived RAM.
 */
function slimEvent(e: CalendarEvent): CalendarEvent {
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

export function getCalendar() {
  initCalendarWindowSync();
  const store = {
    /**
     * View-scoped expansion. Pass the visible date range; the underlying
     * sorted index makes per-call cost bounded by the visible event count
     * rather than the full template count, so repeated calls stay cheap
     * even during held-arrow navigation.
     */
    eventsInWindow(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): CalendarEvent[] {
      void indexVersion;
      const key = calendarWindowKey(windowStart, windowEnd, localTimezone());
      if (currentWindowKey === key) {
        return windowEvents;
      }
      const cached = windowCache.peek(key);
      if (cached) return cached.windowEvents;
      return eventsInWindowFromIndex(getIndex(), windowStart, windowEnd);
    },

    /**
     * Reactivity token; consumers can `void store.indexVersion` inside an
     * `$effect` to re-run on any mutation without paying a wide-window
     * expansion just to subscribe.
     */
    get indexVersion(): number {
      return indexVersion;
    },

    get rawBlocks(): CalendarEvent[] {
      return rawBlocks;
    },

    get eventCount(): number {
      return totalEventCount;
    },

    get loaded(): boolean {
      return loaded;
    },

    get windowLoadBusy(): boolean {
      return windowLoadCoordinator.busy;
    },

    get foregroundWindowLoadBusy(): boolean {
      return foregroundWindowBusy;
    },

    isWindowCurrent(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): boolean {
      return currentWindowKey === calendarWindowKey(windowStart, windowEnd, localTimezone());
    },

    hasWindow(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): boolean {
      const key = calendarWindowKey(windowStart, windowEnd, localTimezone());
      return currentWindowKey === key || windowCache.has(key);
    },

    async whenWindowIdle(): Promise<void> {
      await waitForWindowIdle();
    },

    async whenForegroundWindowIdle(): Promise<void> {
      await waitForForegroundWindowIdle();
    },

    /** Suppress invalidate() during multi-step mutations. */
    beginBatch() { batchDepth++; },
    endBatch() { if (--batchDepth <= 0) { batchDepth = 0; invalidate(); } },

    async load() {
      perfMark("boot.sql-start");
      try {
        loaded = false;
        const initialWindow = computeViewWindow(new Date(), "week");
        await loadWindowIntoState(initialWindow.start, initialWindow.end, true);
      } catch (e) {
        console.error("[calendar] load() failed:", e);
        throw e;
      }
    },

    async loadWindow(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): Promise<void> {
      await loadWindowIntoState(windowStart, windowEnd, false);
    },

    async refreshCurrentWindow(): Promise<void> {
      await reloadCurrentWindowFromDb();
    },

    async refreshWindow(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): Promise<void> {
      await reloadWindowFromDb(windowStart, windowEnd);
    },

    /**
     * Fetch just the fields the event panel needs for first paint. This is
     * intentionally lighter than `loadFullEvent`: no alarms and no recurring
     * override mirrors. Results are cached until the next calendar mutation,
     * and event tiles prefetch this on pointer hover / pointer down.
     */
    async loadPanelEvent(id: string): Promise<CalendarEvent | undefined> {
      const cached = panelEventCache.get(id);
      if (cached) return cached;

      const promise = (async () => {
        const renderZone = localTimezone();
        const rows = await invoke<CalendarPanelEventRows>("calendar_load_panel_event", {
          dbUrl: dbUrl(),
          id,
        });
        if (!rows.event) return undefined;
        const event = mapRow(rows.event, renderZone);
        applyFullEventFields(rows.event, event);
        if (rows.attendees.length > 0) event.attendees = rows.attendees.map(mapAttendee);
        return event;
      })().catch((e: unknown) => {
        if (panelEventCache.get(id) === promise) panelEventCache.delete(id);
        throw e;
      });

      rememberPanelEvent(id, promise);
      return promise;
    },

    prefetchPanelEvent(id: string): void {
      void store.loadPanelEvent(id).catch((e) => {
        console.warn("[calendar] panel event prefetch failed:", e);
      });
    },

    /**
     * Fetch the full DB row for one event id and return a fully populated
     * `CalendarEvent`. The render path holds only a slim subset of columns in
     * the current window; this is what ICS export and delete undo call when
     * they need every heavy field, including alarms and override mirrors.
     */
    async loadFullEvent(id: string): Promise<CalendarEvent | undefined> {
      const renderZone = localTimezone();
      const rows = await invoke<CalendarFullEventRows>("calendar_load_full_event", {
        dbUrl: dbUrl(),
        id,
      });
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
    },

    async addBlock(opts: {
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
    }): Promise<CalendarEvent> {
      // Sanitize times to ensure clean integer minutes
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
      const event: CalendarEvent = slimEvent({
        id, title: opts.title, start: sanitizedStart, end: sanitizedEnd,
        timezone, calendarId,
        color: opts.color,
        recurrence: opts.recurrence, notifications: opts.notifications,
        exceptions: opts.exceptions,
        pomodoroConfig: opts.pomodoroConfig,
        meetingEnabled,
        allDay: opts.allDay, location: opts.location, url: opts.url,
        transparency: opts.transparency, status: opts.status,
        localParticipationStatus: opts.localParticipationStatus,
      });
      rawBlocks = [...rawBlocks, event];
      totalEventCount++;
      invalidate();
      publishCalendarWindowSync();
      return event;
    },

    /**
     * Apply a partial event patch. Only columns whose keys are present in
     * the patch are written; unrelated fields stay as-is. Callers can pass a
     * full event (every column rewritten, original behavior) or a narrow
     * patch like `{ id, start, end }` for drag commits.
     *
     * Child rows (attendees, alarms, pomodoroConfig) are touched only when
     * their key is explicitly present in the patch, so passing a slim
     * in-memory event without those keys preserves their existing rows.
     */
    async updateBlock(patch: Partial<CalendarEvent> & { id: string }): Promise<void> {
      const { parentId, toUpdate, payload } = prepareUpdateBlockPayload(patch, rawBlocks);

      await invoke("calendar_update_event", {
        dbUrl: dbUrl(),
        patch: payload,
      });

      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId
          ? { ...b, ...toUpdate, id: parentId, recurringParentId: undefined }
          : b,
      );
      invalidate();
      publishCalendarWindowSync();
    },

    async deleteBlock(eventOrId: CalendarEvent | string) {
      const target = mutationTargetForEvent(eventOrId);
      await invoke("calendar_delete_event", { dbUrl: dbUrl(), target });
      if (target.id.includes("::")) {
        const [parentId, date] = target.id.split("::");
        rawBlocks = rawBlocks.map((b) =>
          b.id === parentId ? { ...b, exceptions: [...(b.exceptions ?? []), date] } : b,
        );
      } else {
        rawBlocks = rawBlocks.filter((b) => b.id !== target.id);
        totalEventCount = Math.max(0, totalEventCount - 1);
      }
      invalidate();
      publishCalendarWindowSync();
    },

    async archiveBlock(eventOrId: CalendarEvent | string) {
      const target = mutationTargetForEvent(eventOrId);
      await invoke("calendar_archive_event", { dbUrl: dbUrl(), target });
      if (target.id.includes("::")) {
        const [parentId, date] = target.id.split("::");
        rawBlocks = rawBlocks.map((b) =>
          b.id === parentId ? { ...b, exceptions: [...(b.exceptions ?? []), date] } : b,
        );
      } else {
        rawBlocks = rawBlocks.filter((b) => b.id !== target.id);
        totalEventCount = Math.max(0, totalEventCount - 1);
      }
      invalidate();
      publishCalendarWindowSync();
    },

    async applyDeleteArchivePlan(operations: CalendarDeleteArchiveOperation[]) {
      await invoke("calendar_apply_delete_archive_plan", {
        dbUrl: dbUrl(),
        operations,
      });
      invalidate(false);
      panelEventCache.clear();
      publishCalendarWindowSync();
    },

    async restoreArchivedBlock(eventOrId: CalendarEvent | string) {
      const target = mutationTargetForEvent(eventOrId);
      await invoke("calendar_restore_archived_event", { dbUrl: dbUrl(), target });
      if (target.id.includes("::")) {
        const [parentId, date] = target.id.split("::");
        rawBlocks = rawBlocks.map((b) =>
          b.id === parentId
            ? { ...b, exceptions: (b.exceptions ?? []).filter((exception) => exception !== date) }
            : b,
        );
      } else {
        const existed = rawBlocks.some((b) => b.id === target.id);
        panelEventCache.delete(target.id);
        const restored = await store.loadFullEvent(target.id)
          ?? (typeof eventOrId === "string" ? undefined : { ...eventOrId, recurringParentId: undefined });
        if (restored) {
          rawBlocks = [...rawBlocks.filter((b) => b.id !== target.id), restored];
          if (!existed) totalEventCount += 1;
        }
      }
      invalidate();
      publishCalendarWindowSync();
    },

    /**
     * Resolve an event (possibly a recurring instance) to its DB-backed template.
     * Returns the template event, or undefined if not found.
     */
    getTemplate(event: CalendarEvent): CalendarEvent | undefined {
      return resolveToTemplate(event);
    },

    /**
     * Detach a recurring instance into a standalone event.
     * Creates a new DB row and adds the instance date as an exception on the parent.
     */
    async detachInstance(instanceEvent: CalendarEvent): Promise<CalendarEvent> {
      const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
      const parent = rawBlocks.find((b) => b.id === parentId);
      if (!parent) throw new Error("Parent template not found");

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

      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, exceptions } : b,
      );
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
        pomodoroConfig: parent.pomodoroConfig,
      });
      rawBlocks = [...rawBlocks, standalone];
      totalEventCount++;
      invalidate();
      publishCalendarWindowSync();
      return standalone;
    },

    /**
     * Add an exception date to a recurring parent (hides one instance without deleting it).
     */
    async addException(parentId: string, date: string) {
      const parent = rawBlocks.find((b) => b.id === parentId);
      if (!parent) return;

      const exceptions = [...(parent.exceptions ?? []), date];
      const now = nowIso();
      await invoke("calendar_update_event", {
        dbUrl: dbUrl(),
        patch: {
          id: parentId,
          updatedAt: now,
          fields: [{ field: "exceptions", value: JSON.stringify(exceptions) }],
          attendees: null,
          alarms: null,
          pomodoroConfig: null,
        },
      });
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, exceptions } : b,
      );
      invalidate();
      publishCalendarWindowSync();
    },

    /**
     * Set repeat_until on a recurring template to cap the series.
     */
    async setRepeatUntil(parentId: string, date: string) {
      const parent = rawBlocks.find((b) => b.id === parentId);
      if (!parent || !parent.recurrence) return;

      const now = nowIso();
      const updatedRecurrence: RecurrenceConfig = {
        ...parent.recurrence,
        end: { type: "until", date },
      };
      const rrule = recurrenceToRrule(updatedRecurrence);
      await invoke("calendar_update_event", {
        dbUrl: dbUrl(),
        patch: {
          id: parentId,
          updatedAt: now,
          fields: [
            { field: "repeatUntil", value: date },
            { field: "rrule", value: rrule },
          ],
          attendees: null,
          alarms: null,
          pomodoroConfig: null,
        },
      });
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, recurrence: updatedRecurrence } : b,
      );
      invalidate();
      publishCalendarWindowSync();
    },

    /**
     * Split a recurring series at a given date.
     * The original template stops at dayBefore(date), and a new recurring
     * template is created starting from date with the provided changes.
     */
    async splitSeries(
      instanceEvent: CalendarEvent,
      changes: Partial<CalendarEvent>,
    ): Promise<CalendarEvent> {
      const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
      const parent = rawBlocks.find((b) => b.id === parentId);
      if (!parent) throw new Error("Parent template not found");

      const splitDate = instanceEvent.start.split(" ")[0];
      const newStartDateStr = changes.start
        ? String(changes.start).split(" ")[0]
        : splitDate;
      // Cap old series before the earlier of instance date and new start date
      const capDate = newStartDateStr < splitDate ? newStartDateStr : splitDate;
      const capBefore = parseYMD(capDate);
      capBefore.setDate(capBefore.getDate() - 1);
      const dayBefore = fmtYMD(capBefore);
      const now = nowIso();

      // Cap the old template's recurrence at dayBefore
      const cappedRecurrence: RecurrenceConfig | undefined = parent.recurrence
        ? { ...parent.recurrence, end: { type: "until", date: dayBefore } }
        : undefined;
      const cappedRrule = cappedRecurrence ? recurrenceToRrule(cappedRecurrence) : null;

      // Create new recurring template starting at changes' full position
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
      // description and url are heavy columns. If `changes` carries them
      // (user edited via EventPanel after Step 3 lands), bind the new
      // value; COALESCE then prefers it. Otherwise bind NULL and the
      // parent's column wins. Other heavy columns (visibility, priority,
      // categories, geo, sequence, extended_properties, organizer,
      // guest_can_*) preserve current behavior: parent's row, never
      // overridden by `changes`.
      const descriptionPatch = "description" in changes
        ? sanitizeCalendarDescriptionHtml(changes.description ?? "") : null;
      const urlPatch = "url" in changes ? (changes.url ?? "") : null;
      const pomConfig = merged.pomodoroConfig ?? parent.pomodoroConfig;
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
          pomodoroConfig: pomConfig ?? null,
          now,
        },
      });

      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, recurrence: cappedRecurrence } : b,
      );
      const newTemplate: CalendarEvent = slimEvent({
        ...parent,
        ...changes,
        id: newId,
        start: newStart,
        end: newEnd,
        timezone: homeZone,
        recurrence: newRecurrence,
        recurringParentId: undefined,
        exceptions: newExceptions.length > 0 ? newExceptions : undefined,
        pomodoroConfig: pomConfig,
      });
      rawBlocks = [...rawBlocks, newTemplate];
      totalEventCount++;
      invalidate();
      return newTemplate;
    },

    async applyRecurrenceCommitPlan(plan: RecurringCommitPlan) {
      const backendOperations: CalendarRecurrenceCommitOperationPayload[] = [];
      const operationResults = new Map<string, CalendarEvent>();
      let workingBlocks = rawBlocks.map((block) => ({ ...block }));
      let addedCount = 0;
      let activeRunTransferred = false;

      const replaceWorkingBlock = (event: CalendarEvent): void => {
        workingBlocks = workingBlocks.map((block) => block.id === event.id ? { ...block, ...event } : block);
      };

      const appendWorkingBlock = (event: CalendarEvent): void => {
        workingBlocks = [...workingBlocks.filter((block) => block.id !== event.id), event];
        addedCount += 1;
      };

      const getWorkingTemplate = (eventOrId: CalendarEvent | string): CalendarEvent | undefined => {
        const id = typeof eventOrId === "string"
          ? eventOrId
          : eventOrId.recurringParentId ?? eventOrId.id;
        return workingBlocks.find((block) => block.id === id);
      };

      const queueUpdate = (patch: Partial<CalendarEvent> & { id: string }): CalendarEvent => {
        const { parentId, toUpdate, payload } = prepareUpdateBlockPayload(patch, workingBlocks);
        backendOperations.push({ type: "update_event", patch: payload });
        const existing = workingBlocks.find((block) => block.id === parentId);
        const updated = slimEvent({
          ...existing,
          ...toUpdate,
          id: parentId,
          recurringParentId: undefined,
        } as CalendarEvent);
        replaceWorkingBlock(updated);
        return updated;
      };

      const queueSetRepeatUntil = (parentId: string, date: string): CalendarEvent | undefined => {
        const parent = getWorkingTemplate(parentId);
        if (!parent?.recurrence) return undefined;
        const updatedRecurrence: RecurrenceConfig = {
          ...parent.recurrence,
          end: { type: "until", date },
        };
        return queueUpdate({ id: parentId, recurrence: updatedRecurrence });
      };

      const queueDetachInstance = (instanceEvent: CalendarEvent): CalendarEvent => {
        const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
        const parent = getWorkingTemplate(parentId);
        if (!parent) throw new Error("Parent template not found");

        const instanceDate = instanceEvent.start.split(" ")[0];
        const exceptions = Array.from(new Set([...(parent.exceptions ?? []), instanceDate]));
        const now = nowIso();
        const newId = crypto.randomUUID();
        const timezone = parent.timezone || localTimezone();
        const notifications = parent.notifications && parent.notifications.length > 0
          ? JSON.stringify(parent.notifications)
          : null;
        backendOperations.push({
          type: "detach_instance",
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
            notifications,
            allDay: parent.allDay ?? false,
            location: parent.location ?? "",
            transparency: parent.transparency ?? "opaque",
            status: parent.status ?? "confirmed",
            now,
          },
        });

        replaceWorkingBlock({ ...parent, exceptions });
        const standalone = slimEvent({
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
          pomodoroConfig: parent.pomodoroConfig,
        });
        appendWorkingBlock(standalone);
        return standalone;
      };

      const queueSplitSeries = (
        instanceEvent: CalendarEvent,
        changes: Partial<CalendarEvent>,
      ): CalendarEvent => {
        const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
        const parent = getWorkingTemplate(parentId);
        if (!parent) throw new Error("Parent template not found");

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
        const notifications = merged.notifications && merged.notifications.length > 0
          ? JSON.stringify(merged.notifications)
          : null;
        const exceptions = newExceptions.length > 0 ? JSON.stringify(newExceptions) : null;
        const homeZone = parent.timezone || localTimezone();
        const descriptionPatch = "description" in changes
          ? sanitizeCalendarDescriptionHtml(changes.description ?? "")
          : null;
        const urlPatch = "url" in changes ? (changes.url ?? "") : null;
        const pomodoroConfig = merged.pomodoroConfig ?? parent.pomodoroConfig;

        backendOperations.push({
          type: "split_series",
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
            notifications,
            exceptions,
            rrule,
            allDay: merged.allDay ?? false,
            location: merged.location ?? "",
            transparency: merged.transparency ?? "opaque",
            status: merged.status ?? "confirmed",
            descriptionPatch,
            urlPatch,
            localRsvpStatus: merged.localParticipationStatus ?? null,
            meetingEnabled,
            pomodoroConfig: pomodoroConfig ?? null,
            now,
          },
        });

        if (cappedRecurrence) replaceWorkingBlock({ ...parent, recurrence: cappedRecurrence });
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
          pomodoroConfig,
        });
        appendWorkingBlock(newTemplate);
        return newTemplate;
      };

      const resolveTransferTarget = (
        operation: Extract<RecurringCommitPlan["operations"][number], { type: "transfer-active-run" }>,
      ): { id: string; end?: string; date?: string } => {
        const target = operation.to;
        if (target.kind === "event-id") {
          return {
            id: target.eventId,
            date: target.eventId.split("::")[1],
          };
        }

        const result = operationResults.get(target.operationId);
        if (!result) {
          throw new Error(`Missing result for recurrence operation ${target.operationId}`);
        }

        if (target.kind === "operation-result") {
          return {
            id: result.id,
            end: result.end,
            date: result.start.split(" ")[0],
          };
        }

        return {
          id: templateEventIdForDate(result, target.date),
          end: templateEndForDate(result, target.date),
          date: target.date,
        };
      };

      const toPlannedEnd = (value: string | undefined): string | null => {
        if (!value) return null;
        const ms = new Date(value.replace(" ", "T")).getTime();
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
      };

      for (const operation of plan.operations) {
        switch (operation.type) {
          case "detach-occurrence": {
            const detached = queueDetachInstance(operation.occurrence);
            const updated = queueUpdate({
              ...detached,
              ...operation.patch,
              recurrence: operation.target === "recurring-template"
                ? operation.patch.recurrence
                : undefined,
              recurringParentId: undefined,
            });
            operationResults.set(operation.operationId, updated);
            break;
          }
          case "cap-template":
            queueSetRepeatUntil(operation.templateId, operation.untilDate);
            break;
          case "split-series": {
            const newTemplate = queueSplitSeries(operation.occurrence, operation.patch);
            operationResults.set(operation.operationId, newTemplate);
            break;
          }
          case "update-template-fields": {
            const template = getWorkingTemplate(operation.selectedOccurrence);
            if (!template) throw new Error(`Template ${operation.templateId} not found`);
            if (operation.protectedUntilDate) {
              if (!operation.firstMutableDate) {
                throw new Error(`No mutable occurrence remains for recurrence template ${operation.templateId}`);
              }
              const virtualInstance = occurrenceOnDate(template, template.id, operation.firstMutableDate);
              const patch = moveDatedPatchToDate(operation.patch, operation.firstMutableDate);
              const newTemplate = queueSplitSeries(virtualInstance, patch);
              operationResults.set(operation.templateId, newTemplate);
              break;
            }
            const updated = queueUpdate(
              patchForTemplateAnchor(template, operation.selectedOccurrence, operation.patch),
            );
            operationResults.set(operation.templateId, updated);
            break;
          }
          case "collapse-series": {
            const template = getWorkingTemplate(operation.survivor);
            if (!template) throw new Error(`Template ${operation.templateId} not found`);
            const patch = { ...operation.patch, recurrence: undefined };
            if (operation.protectedUntilDate) {
              queueSetRepeatUntil(operation.templateId, operation.protectedUntilDate);
              const detached = queueDetachInstance(operation.survivor);
              const updated = queueUpdate({
                ...detached,
                ...patch,
                id: detached.id,
                recurrence: undefined,
                recurringParentId: undefined,
                exceptions: undefined,
              });
              operationResults.set(operation.operationId, updated);
              break;
            }
            const updated = queueUpdate({
              ...template,
              ...patch,
              id: template.id,
              start: patch.start ? String(patch.start) : operation.survivor.start,
              end: patch.end ? String(patch.end) : operation.survivor.end,
              recurrence: undefined,
              recurringParentId: undefined,
              exceptions: undefined,
            });
            operationResults.set(operation.operationId, updated);
            break;
          }
          case "materialize-protected-history": {
            const datesToProtect = await invoke<string[]>("calendar_progress_dates_before", {
              dbUrl: dbUrl(),
              templateId: operation.templateId,
              cutoffDate: operation.cutoffDate,
              excludeDate: operation.excludeDate ?? null,
            });
            const parent = getWorkingTemplate(operation.templateId);
            if (!parent) break;
            for (const date of datesToProtect) {
              queueDetachInstance(occurrenceOnDate(parent, operation.templateId, date));
            }
            break;
          }
          case "materialize-occurrence": {
            const detached = queueDetachInstance(operation.occurrence);
            const updated = operation.patch
              ? queueUpdate({ ...detached, ...operation.patch, id: detached.id, recurringParentId: undefined })
              : detached;
            operationResults.set(operation.operationId, updated);
            break;
          }
          case "transfer-active-run":
            {
              const target = resolveTransferTarget(operation);
              backendOperations.push({
                type: "transfer_active_event_reference",
                transfer: {
                  newEventId: target.id,
                  newEventDate: target.date ?? null,
                  plannedEnd: toPlannedEnd(operation.newEnd ?? target.end),
                },
              });
              activeRunTransferred = true;
            }
            break;
          case "refresh-window":
            break;
        }
      }

      if (backendOperations.length > 0) {
        await invoke("calendar_apply_recurrence_commit_plan", {
          dbUrl: dbUrl(),
          operations: backendOperations,
        });
        rawBlocks = workingBlocks.map((block) => slimEvent(block));
        totalEventCount += addedCount;
        invalidate(false);
        panelEventCache.clear();
        publishCalendarWindowSync();
      }

      return { operationResults, activeRunTransferred };
    },

    async clearAll() {
      await invoke("calendar_clear_events", { dbUrl: dbUrl() });
      rawBlocks = [];
      totalEventCount = 0;
      invalidate();
      publishCalendarWindowSync();
    },

    /**
     * Insert or update a batch of events into a target calendar, deduplicated
     * by (calendar_id, source_uid). Newer revisions (higher SEQUENCE) win;
     * equal SEQUENCE counts as an update so re-importing the same file leaves
     * the DB clean. Child rows (attendees, alarms, overrides) are replaced.
     *
     * The whole batch ships as a typed payload to the Rust
     * `calendar_bulk_import` command. Rust deduplicates by UID, compares
     * SEQUENCE, replaces child rows, and commits once.
     */
    async bulkImport(
      events: CalendarEvent[],
      targetCalendarId: string,
      opts: {
        refreshWindow?: boolean;
        preservation?: IcsPreservationPayload | null;
        sourceName?: string;
        sourceKind?: CalendarImportSourceKind;
      } = {},
    ): Promise<IcsImportSummary> {
      const now = nowIso();
      const fallbackZone = localTimezone();

      const payload = buildBulkImportPayload(
        events,
        targetCalendarId,
        now,
        fallbackZone,
        () => crypto.randomUUID(),
        opts.preservation ?? null,
        opts.sourceName ?? "",
        opts.sourceKind ?? "import-file",
      );
      const result = await invoke<CalendarBulkImportResult>("calendar_bulk_import", {
        dbUrl: dbUrl(),
        payload,
      });

      if (result.applied.length === 0) {
        return {
          added: 0,
          updated: 0,
          skippedOlder: result.skippedOlder,
          warnings: result.warnings,
        };
      }

      totalEventCount += result.added;
      if (opts.refreshWindow ?? true) {
        await reloadCurrentWindowFromDb();
      }
      publishCalendarWindowSync();

      return {
        added: result.added,
        updated: result.updated,
        skippedOlder: result.skippedOlder,
        warnings: result.warnings,
      };
    },

    /**
     * Serialize every event of `calendar` into a `.ics` string ready to write
     * to disk. Event ids come from Rust because the render path owns only
     * the visible window. Heavy fields are loaded on demand via
     * `loadFullEvent` before serialization so the export is lossless.
     */
    async exportCalendarAsIcs(calendar: Calendar): Promise<string> {
      const ids = await invoke<string[]>("calendar_list_event_ids_for_calendar", {
        dbUrl: dbUrl(),
        calendarId: calendar.id,
      });
      const full = await Promise.all(ids.map((id) => store.loadFullEvent(id)));
      const calendarEvents = full.filter((e): e is CalendarEvent => e !== undefined);
      const preservedTimezoneRows = await invoke<string[]>(
        "calendar_load_icalendar_timezones_for_calendar",
        {
          dbUrl: dbUrl(),
          calendarId: calendar.id,
        },
      );
      const preservedTimezones = preservedTimezoneRows
        .map((row) => safeJsonParse<unknown>(row))
        .filter((row): row is unknown => row !== undefined);
      const preservedPassthroughRows = await invoke<string[]>(
        "calendar_load_icalendar_passthrough_components_for_calendar",
        {
          dbUrl: dbUrl(),
          calendarId: calendar.id,
        },
      );
      const preservedPassthroughComponents = preservedPassthroughRows
        .map((row) => safeJsonParse<unknown>(row))
        .filter((row): row is unknown => row !== undefined);
      const preservedExportMetadata = await invoke<CalendarIcalendarExportMetadata>(
        "calendar_load_icalendar_export_metadata_for_calendar",
        {
          dbUrl: dbUrl(),
          calendarId: calendar.id,
        },
      );
      if (preservedExportMetadata.mixed_methods) {
        console.warn(
          "iCalendar export used METHOD:PUBLISH because this calendar contains mixed preserved METHOD values.",
        );
      }
      const { serializeCalendarToIcs } = await import("$lib/calendar/ics/serializer");
      return serializeCalendarToIcs(
        { ...calendar, name: calendarDisplayName(calendar) },
        calendarEvents,
        undefined,
        preservedTimezones,
        preservedPassthroughComponents,
        preservedExportMetadata.method ?? undefined,
      );
    },

    /**
     * Check whether a specific recurring instance date has completed progress segments.
     */
    async hasProgressSegments(templateId: string, date: string): Promise<boolean> {
      return invoke<boolean>("calendar_has_progress_segments", {
        dbUrl: dbUrl(),
        templateId,
        date,
      });
    },

    /**
     * Check whether changes to a recurring template affect structural fields
     * (times, pomodoro config) vs. purely cosmetic fields (title, color, etc.).
     */
    hasStructuralChanges(template: CalendarEvent, changes: Partial<CalendarEvent>): boolean {
      return hasStructuralChanges(template, changes);
    },

    /**
     * Protect historical pomodoro progress by detaching past recurring instances
     * that have completed segments into standalone events before modifying the template.
     *
     * Returns the list of dates that were detached.
     */
    async protectHistoricalSegments(
      templateId: string,
      cutoffDate: string,
      excludeDate?: string,
    ): Promise<string[]> {
      const datesToProtect = await invoke<string[]>("calendar_progress_dates_before", {
        dbUrl: dbUrl(),
        templateId,
        cutoffDate,
        excludeDate: excludeDate ?? null,
      });

      if (datesToProtect.length === 0) return [];

      const parent = rawBlocks.find((b) => b.id === templateId);
      if (!parent) return [];

      const detachedDates: string[] = [];
      for (const date of datesToProtect) {
        const startTime = parent.start.split(" ")[1];
        const endTime = parent.end.split(" ")[1];
        const virtualInstance: CalendarEvent = {
          ...parent,
          id: `${templateId}::${date}`,
          start: `${date} ${startTime}`,
          end: `${date} ${endTime}`,
          recurringParentId: templateId,
          recurrence: undefined,
          exceptions: undefined,
        };
        await store.detachInstance(virtualInstance);
        detachedDates.push(date);
      }

      return detachedDates;
    },
  };
  return store;
}
