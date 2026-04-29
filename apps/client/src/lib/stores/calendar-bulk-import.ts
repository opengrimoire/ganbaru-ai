/**
 * Pure helpers for `bulkImport`. Keeps SQL string assembly and event
 * classification out of the runes-bound store so they can be unit
 * tested without a Tauri runtime or DB plugin.
 *
 * Statements built here use `?` placeholders (sqlx binds positionally
 * for SQLite). They are shipped via the `db_execute_batch` Rust command
 * which wraps the whole batch in a single transaction. Per-statement
 * fsyncs were the dominant cost in the previous per-event loop.
 */
import type {
  CalendarEvent, EventAlarm, EventAttendee, EventOverride,
} from "$lib/components/calendar/types";
import { recurrenceToRrule } from "$lib/components/calendar/rrule";
import { wallClockToUtcIso } from "$lib/components/calendar/utils";
import { toDbTime } from "./map-row";

/** A single parameterized SQL statement with positional binds. */
export interface ImportStatement {
  query: string;
  binds: unknown[];
}

/** Existing row shape returned by the pre-import SELECT. */
export interface ExistingEventRow {
  id: string;
  source_uid: string;
  sequence: number;
}

/** Result of dividing imported events into add/update/skip buckets. */
export interface ImportClassification {
  toAdd: { event: CalendarEvent; newId: string }[];
  toUpdate: { event: CalendarEvent; existingId: string }[];
  skippedOlder: number;
  added: number;
  updated: number;
  warnings: string[];
}

/** Default chunk sizes. SQLite's parameter limit is 32766 (since 3.32). */
export const EVENTS_PER_INSERT = 500;
export const CHILDREN_PER_INSERT = 250;

const EVENT_INSERT_COLUMNS = [
  "id", "title", "start_time", "end_time", "timezone", "calendar_id",
  "color", "description", "rrule", "notifications", "exceptions", "repeat_until",
  "all_day", "location", "url", "transparency", "status",
  "source_uid", "visibility", "priority", "categories", "geo",
  "sequence", "rdate", "extended_properties", "organizer",
  "guest_can_modify", "guest_can_invite_others", "guest_can_see_other_guests",
  "created_at", "updated_at",
] as const;

const EVENT_INSERT_HEAD = `INSERT INTO calendar_events (${EVENT_INSERT_COLUMNS.join(", ")}) VALUES `;
export const EVENT_INSERT_PLACEHOLDERS = EVENT_INSERT_COLUMNS.length;

const EVENT_UPDATE_QUERY = `UPDATE calendar_events
SET title = ?, start_time = ?, end_time = ?, timezone = ?,
    color = ?, description = ?,
    rrule = ?, notifications = ?, exceptions = ?, repeat_until = ?,
    all_day = ?, location = ?, url = ?,
    transparency = ?, status = ?,
    visibility = ?, priority = ?,
    categories = ?, geo = ?,
    sequence = ?, rdate = ?,
    extended_properties = ?, organizer = ?,
    guest_can_modify = ?, guest_can_invite_others = ?,
    guest_can_see_other_guests = ?,
    updated_at = ?
WHERE id = ?`;
export const EVENT_UPDATE_BINDS = 28;

const ATTENDEE_INSERT_HEAD = `INSERT INTO calendar_event_attendees (id, event_id, name, email, role, status, rsvp, sort_order) VALUES `;
const ATTENDEE_BINDS_PER_ROW = 8;

const ALARM_INSERT_HEAD = `INSERT INTO calendar_event_alarms (id, event_id, action, trigger_type, trigger_value, description, sort_order) VALUES `;
const ALARM_BINDS_PER_ROW = 7;

const OVERRIDE_INSERT_HEAD = `INSERT INTO calendar_event_overrides
(id, parent_event_id, recurrence_id, title, start_time, end_time,
 description, location, url, color, status, transparency, visibility,
 extended_properties) VALUES `;
const OVERRIDE_BINDS_PER_ROW = 14;

function placeholdersFor(width: number): string {
  return `(${new Array(width).fill("?").join(", ")})`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Sort imported events into "new", "needs UPDATE" and "skip-older" buckets
 * based on the existing rows for the target calendar. Higher imported
 * `sequence` always wins; equal sequence still counts as an update so a
 * re-import of the same file lands cleanly. Events without a `sourceUid`
 * are dropped with a warning since the upsert key relies on it.
 *
 * @param events - parsed events from the ICS source
 * @param existing - rows already in the calendar, keyed implicitly by
 *   `source_uid`
 * @param newId - factory for fresh UUIDs (injected for test determinism)
 */
export function classifyImportEvents(
  events: CalendarEvent[],
  existing: ExistingEventRow[],
  newId: () => string,
): ImportClassification {
  const existingMap = new Map<string, ExistingEventRow>();
  for (const r of existing) existingMap.set(r.source_uid, r);
  const toAdd: ImportClassification["toAdd"] = [];
  const toUpdate: ImportClassification["toUpdate"] = [];
  let skippedOlder = 0;
  const warnings: string[] = [];
  for (const event of events) {
    if (!event.sourceUid) {
      warnings.push("Event without UID skipped.");
      continue;
    }
    const existingRow = existingMap.get(event.sourceUid);
    const importedSeq = event.sequence ?? 0;
    if (!existingRow) {
      toAdd.push({ event, newId: newId() });
    } else if (importedSeq < (existingRow.sequence ?? 0)) {
      skippedOlder++;
    } else {
      toUpdate.push({ event, existingId: existingRow.id });
    }
  }
  return {
    toAdd, toUpdate, skippedOlder,
    added: toAdd.length, updated: toUpdate.length, warnings,
  };
}

function eventInsertBinds(
  eventId: string,
  event: CalendarEvent,
  targetCalendarId: string,
  now: string,
  fallbackZone: string,
): unknown[] {
  const homeZone = event.timezone || fallbackZone;
  const startUtc = toDbTime(event.start, homeZone, event.allDay);
  const endUtc = toDbTime(event.end, homeZone, event.allDay);
  const rrule = event.recurrence ? recurrenceToRrule(event.recurrence) : null;
  const repeatUntil = event.recurrence?.end.type === "until"
    ? event.recurrence.end.date : null;
  const notifJson = event.notifications && event.notifications.length > 0
    ? JSON.stringify(event.notifications) : null;
  const exceptionsJson = event.exceptions && event.exceptions.length > 0
    ? JSON.stringify(event.exceptions) : null;
  const gp = event.guestPermissions;
  return [
    eventId, event.title, startUtc, endUtc, homeZone, targetCalendarId,
    event.color ?? null, event.description ?? "",
    rrule, notifJson, exceptionsJson, repeatUntil,
    event.allDay ? 1 : 0, event.location ?? "", event.url ?? "",
    event.transparency ?? "opaque", event.status ?? "confirmed",
    event.sourceUid ?? null,
    event.visibility ?? "public",
    event.priority ?? null,
    event.categories ? JSON.stringify(event.categories) : null,
    event.geo ? JSON.stringify(event.geo) : null,
    event.sequence ?? 0,
    event.rdate ? JSON.stringify(event.rdate) : null,
    event.extendedProperties ? JSON.stringify(event.extendedProperties) : null,
    event.organizer ? JSON.stringify(event.organizer) : null,
    gp?.canModify ? 1 : 0,
    gp?.canInviteOthers === false ? 0 : 1,
    gp?.canSeeOtherGuests === false ? 0 : 1,
    now, now,
  ];
}

function eventUpdateBinds(
  eventId: string,
  event: CalendarEvent,
  now: string,
  fallbackZone: string,
): unknown[] {
  const homeZone = event.timezone || fallbackZone;
  const startUtc = toDbTime(event.start, homeZone, event.allDay);
  const endUtc = toDbTime(event.end, homeZone, event.allDay);
  const rrule = event.recurrence ? recurrenceToRrule(event.recurrence) : null;
  const repeatUntil = event.recurrence?.end.type === "until"
    ? event.recurrence.end.date : null;
  const notifJson = event.notifications && event.notifications.length > 0
    ? JSON.stringify(event.notifications) : null;
  const exceptionsJson = event.exceptions && event.exceptions.length > 0
    ? JSON.stringify(event.exceptions) : null;
  const gp = event.guestPermissions;
  return [
    event.title, startUtc, endUtc, homeZone,
    event.color ?? null, event.description ?? "",
    rrule, notifJson, exceptionsJson, repeatUntil,
    event.allDay ? 1 : 0, event.location ?? "", event.url ?? "",
    event.transparency ?? "opaque", event.status ?? "confirmed",
    event.visibility ?? "public",
    event.priority ?? null,
    event.categories ? JSON.stringify(event.categories) : null,
    event.geo ? JSON.stringify(event.geo) : null,
    event.sequence ?? 0,
    event.rdate ? JSON.stringify(event.rdate) : null,
    event.extendedProperties ? JSON.stringify(event.extendedProperties) : null,
    event.organizer ? JSON.stringify(event.organizer) : null,
    gp?.canModify ? 1 : 0,
    gp?.canInviteOthers === false ? 0 : 1,
    gp?.canSeeOtherGuests === false ? 0 : 1,
    now, eventId,
  ];
}

/**
 * Multi-row INSERT for the `calendar_events` rows in `toAdd`, chunked at
 * `EVENTS_PER_INSERT` so we never approach SQLite's parameter limit.
 */
export function buildEventInsertStatements(
  toAdd: { event: CalendarEvent; newId: string }[],
  targetCalendarId: string,
  now: string,
  fallbackZone: string,
): ImportStatement[] {
  if (toAdd.length === 0) return [];
  const placeholderRow = placeholdersFor(EVENT_INSERT_PLACEHOLDERS);
  const statements: ImportStatement[] = [];
  for (const batch of chunk(toAdd, EVENTS_PER_INSERT)) {
    const values = new Array(batch.length).fill(placeholderRow).join(", ");
    const binds: unknown[] = [];
    for (const { event, newId } of batch) {
      binds.push(...eventInsertBinds(newId, event, targetCalendarId, now, fallbackZone));
    }
    statements.push({ query: `${EVENT_INSERT_HEAD}${values}`, binds });
  }
  return statements;
}

/** One UPDATE statement per event. Cheap inside a transaction. */
export function buildEventUpdateStatements(
  toUpdate: { event: CalendarEvent; existingId: string }[],
  now: string,
  fallbackZone: string,
): ImportStatement[] {
  return toUpdate.map(({ event, existingId }) => ({
    query: EVENT_UPDATE_QUERY,
    binds: eventUpdateBinds(existingId, event, now, fallbackZone),
  }));
}

/**
 * For events being updated (whose IDs already exist), wipe their child
 * rows so the next inserts produce a clean replacement. Events being
 * added have no pre-existing children, so they are skipped here.
 */
export function buildChildDeleteStatements(
  updateIds: string[],
): ImportStatement[] {
  if (updateIds.length === 0) return [];
  const placeholders = new Array(updateIds.length).fill("?").join(", ");
  return [
    {
      query: `DELETE FROM calendar_event_attendees WHERE event_id IN (${placeholders})`,
      binds: [...updateIds],
    },
    {
      query: `DELETE FROM calendar_event_alarms WHERE event_id IN (${placeholders})`,
      binds: [...updateIds],
    },
    {
      query: `DELETE FROM calendar_event_overrides WHERE parent_event_id IN (${placeholders})`,
      binds: [...updateIds],
    },
  ];
}

interface AttendeeRow { eventId: string; attendee: EventAttendee; sortOrder: number; }
interface AlarmRow { eventId: string; alarm: EventAlarm; sortOrder: number; }
interface OverrideRow { eventId: string; override: EventOverride; zone: string; }

/**
 * Build chunked multi-row INSERTs for attendees across all imported events.
 * Caller threads the resolved event IDs (UUID for adds, existing ID for
 * updates) so child rows reference the same row the parent will end up at.
 */
export function buildAttendeeInsertStatements(
  events: { eventId: string; event: CalendarEvent }[],
): ImportStatement[] {
  const rows: AttendeeRow[] = [];
  for (const { eventId, event } of events) {
    const list = event.attendees ?? [];
    for (let i = 0; i < list.length; i++) {
      rows.push({ eventId, attendee: list[i], sortOrder: i });
    }
  }
  if (rows.length === 0) return [];
  const placeholderRow = placeholdersFor(ATTENDEE_BINDS_PER_ROW);
  const statements: ImportStatement[] = [];
  for (const batch of chunk(rows, CHILDREN_PER_INSERT)) {
    const values = new Array(batch.length).fill(placeholderRow).join(", ");
    const binds: unknown[] = [];
    for (const r of batch) {
      binds.push(
        r.attendee.id, r.eventId, r.attendee.name ?? null, r.attendee.email,
        r.attendee.role, r.attendee.status, r.attendee.rsvp ? 1 : 0, r.sortOrder,
      );
    }
    statements.push({ query: `${ATTENDEE_INSERT_HEAD}${values}`, binds });
  }
  return statements;
}

/** Same shape as attendees, for alarms. */
export function buildAlarmInsertStatements(
  events: { eventId: string; event: CalendarEvent }[],
): ImportStatement[] {
  const rows: AlarmRow[] = [];
  for (const { eventId, event } of events) {
    const list = event.alarms ?? [];
    for (let i = 0; i < list.length; i++) {
      rows.push({ eventId, alarm: list[i], sortOrder: i });
    }
  }
  if (rows.length === 0) return [];
  const placeholderRow = placeholdersFor(ALARM_BINDS_PER_ROW);
  const statements: ImportStatement[] = [];
  for (const batch of chunk(rows, CHILDREN_PER_INSERT)) {
    const values = new Array(batch.length).fill(placeholderRow).join(", ");
    const binds: unknown[] = [];
    for (const r of batch) {
      binds.push(
        r.alarm.id, r.eventId, r.alarm.action, r.alarm.triggerType,
        r.alarm.triggerValue, r.alarm.description ?? null, r.sortOrder,
      );
    }
    statements.push({ query: `${ALARM_INSERT_HEAD}${values}`, binds });
  }
  return statements;
}

/**
 * Override rows. `start_time` / `end_time` are UTC ISO 8601; the caller
 * passes the parent event's home zone so wall-clock overrides round-trip
 * losslessly through the DB.
 */
export function buildOverrideInsertStatements(
  events: { eventId: string; event: CalendarEvent; zone: string }[],
): ImportStatement[] {
  const rows: OverrideRow[] = [];
  for (const { eventId, event, zone } of events) {
    const list = event.overrides ?? [];
    for (const o of list) {
      rows.push({ eventId, override: o, zone });
    }
  }
  if (rows.length === 0) return [];
  const placeholderRow = placeholdersFor(OVERRIDE_BINDS_PER_ROW);
  const statements: ImportStatement[] = [];
  for (const batch of chunk(rows, CHILDREN_PER_INSERT)) {
    const values = new Array(batch.length).fill(placeholderRow).join(", ");
    const binds: unknown[] = [];
    for (const r of batch) {
      const o = r.override;
      const startTime = o.start ? wallClockToUtcIso(o.start, r.zone) : null;
      const endTime = o.end ? wallClockToUtcIso(o.end, r.zone) : null;
      binds.push(
        o.id, r.eventId, o.recurrenceId, o.title ?? null,
        startTime, endTime,
        o.description ?? null, o.location ?? null, o.url ?? null,
        o.color ?? null, o.status ?? null, o.transparency ?? null,
        o.visibility ?? null,
        o.extendedProperties ? JSON.stringify(o.extendedProperties) : null,
      );
    }
    statements.push({ query: `${OVERRIDE_INSERT_HEAD}${values}`, binds });
  }
  return statements;
}

/**
 * Compose the full statement list for a bulk import: event inserts,
 * event updates, child-row deletes (for updates only), and child-row
 * inserts (for both adds and updates). All run inside one transaction.
 */
export function buildBulkImportStatements(
  classification: ImportClassification,
  targetCalendarId: string,
  now: string,
  fallbackZone: string,
): ImportStatement[] {
  const statements: ImportStatement[] = [];
  statements.push(...buildEventInsertStatements(
    classification.toAdd, targetCalendarId, now, fallbackZone,
  ));
  statements.push(...buildEventUpdateStatements(
    classification.toUpdate, now, fallbackZone,
  ));
  statements.push(...buildChildDeleteStatements(
    classification.toUpdate.map((u) => u.existingId),
  ));
  const allEvents: { eventId: string; event: CalendarEvent; zone: string }[] = [];
  for (const a of classification.toAdd) {
    const zone = a.event.timezone || fallbackZone;
    allEvents.push({ eventId: a.newId, event: a.event, zone });
  }
  for (const u of classification.toUpdate) {
    const zone = u.event.timezone || fallbackZone;
    allEvents.push({ eventId: u.existingId, event: u.event, zone });
  }
  statements.push(...buildAttendeeInsertStatements(allEvents));
  statements.push(...buildAlarmInsertStatements(allEvents));
  statements.push(...buildOverrideInsertStatements(allEvents));
  return statements;
}
