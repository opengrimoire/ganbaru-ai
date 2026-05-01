import { invoke } from "@tauri-apps/api/core";
import { dbUrl, execute, select } from "$lib/api/db";
import type {
  Calendar, CalendarEvent, EventAlarm, EventAttendee, EventColor, EventOverride,
  EventOrganizer, EventStatus, EventTransparency, EventVisibility,
  GeoCoordinates, GuestPermissions, PomodoroConfig, RecurrenceConfig,
} from "$lib/components/calendar/types";
import { recurrenceToRrule } from "$lib/components/calendar/rrule";
import { expandRecurring, parseYMD, fmtYMD } from "$lib/components/calendar/recurrence";
import {
  buildExpansionIndex,
  eventsInWindowFromIndex,
  type ExpansionIndex,
} from "$lib/components/calendar/calendar-index";
import {
  sanitizeCalendarTime, utcIsoToWallClock, wallClockToUtcIso,
} from "$lib/components/calendar/utils";
import {
  mapAlarm, mapAttendee, mapOverride, mapRow, safeJsonParse, toDbTime,
  type DbAlarm, type DbAttendee, type DbCalendarEvent, type DbOverride,
} from "./map-row";
import {
  buildBulkImportStatements,
  classifyImportEvents,
  type ExistingEventRow,
} from "./calendar-bulk-import";
import { serializeCalendarToIcs } from "$lib/calendar/ics/serializer";
import type { IcsImportSummary } from "$lib/calendar/ics/types";
import { mark as perfMark } from "$lib/stores/perflog.svelte";

export { expandRecurring, parseYMD, fmtYMD };

function nowLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
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

// Store

/** DB-backed template events (no virtual instances). */
let rawBlocks = $state<CalendarEvent[]>([]);
let batchDepth = 0;

/**
 * Sorted lookup over `rawBlocks`, rebuilt lazily after each invalidate. The
 * non-recurring events are sorted ascending by start so window queries can
 * bisect-and-walk in `O(log N + K)` instead of scanning every template.
 * Recurring templates stay in a small list and are walked exhaustively per
 * query (count is bounded; cost dominated by per-template RRULE walks).
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
function invalidate() {
  if (batchDepth > 0) return;
  expansionIndex = null;
  indexVersion++;
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

/**
 * Replace all attendees for an event (delete + insert).
 */
async function saveAttendees(eventId: string, attendees: EventAttendee[]): Promise<void> {
  await execute("DELETE FROM calendar_event_attendees WHERE event_id = $1", [eventId]);
  for (let i = 0; i < attendees.length; i++) {
    const att = attendees[i];
    await execute(
      `INSERT INTO calendar_event_attendees (id, event_id, name, email, role, status, rsvp, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [att.id, eventId, att.name ?? null, att.email, att.role, att.status, att.rsvp ? 1 : 0, i],
    );
  }
}

/**
 * Replace all alarms for an event (delete + insert).
 */
async function saveAlarms(eventId: string, alarms: EventAlarm[]): Promise<void> {
  await execute("DELETE FROM calendar_event_alarms WHERE event_id = $1", [eventId]);
  for (let i = 0; i < alarms.length; i++) {
    const a = alarms[i];
    await execute(
      `INSERT INTO calendar_event_alarms
         (id, event_id, action, trigger_type, trigger_value, description, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [a.id, eventId, a.action, a.triggerType, a.triggerValue, a.description ?? null, i],
    );
  }
}

/**
 * Replace all per-instance overrides for an event (delete + insert). Override
 * start/end are stored as UTC ISO 8601; the caller passes wall-clock plus the
 * event's home zone so the round-trip is lossless.
 */
async function saveOverrides(
  eventId: string,
  overrides: EventOverride[],
  zone: string,
): Promise<void> {
  await execute("DELETE FROM calendar_event_overrides WHERE parent_event_id = $1", [eventId]);
  for (const o of overrides) {
    const startTime = o.start ? wallClockToUtcIso(o.start, zone) : null;
    const endTime = o.end ? wallClockToUtcIso(o.end, zone) : null;
    await execute(
      `INSERT INTO calendar_event_overrides
         (id, parent_event_id, recurrence_id, title, start_time, end_time,
          description, location, url, color, status, transparency, visibility,
          extended_properties)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        o.id, eventId, o.recurrenceId, o.title ?? null,
        startTime, endTime,
        o.description ?? null, o.location ?? null, o.url ?? null,
        o.color ?? null, o.status ?? null, o.transparency ?? null,
        o.visibility ?? null,
        o.extendedProperties ? JSON.stringify(o.extendedProperties) : null,
      ],
    );
  }
}

/**
 * Load slim per-instance overrides in one unfiltered query and group by
 * parent id. Heavy override columns (description, location, url,
 * extended_properties, visibility) stay in the DB and ride along with the
 * parent through `loadFullEvent` when EventPanel or ICS export needs them.
 */
async function loadOverrides(renderZone: string): Promise<Map<string, EventOverride[]>> {
  const rows = await select<DbOverride>(
    `SELECT id, parent_event_id, recurrence_id, title, start_time, end_time,
            color, status, transparency
     FROM calendar_event_overrides`,
  );
  const map = new Map<string, EventOverride[]>();
  for (const r of rows) {
    const list = map.get(r.parent_event_id) ?? [];
    list.push(mapOverride(r, renderZone));
    map.set(r.parent_event_id, list);
  }
  return map;
}

/**
 * Build a slim copy of `e` containing only the keys the in-memory render,
 * expansion, and notification scheduler care about. Used at the boundary
 * where heavy events (ICS imports, addBlock opts) are pushed into
 * `rawBlocks`, so heavy fields stay in the DB and out of long-lived RAM.
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
  if (e.location) slim.location = e.location;
  if (e.transparency === "transparent") slim.transparency = "transparent";
  if (e.status && e.status !== "confirmed") slim.status = e.status;
  if (e.pomodoroConfig) slim.pomodoroConfig = e.pomodoroConfig;
  if (e.rdate && e.rdate.length > 0) slim.rdate = e.rdate;
  if (e.overrides && e.overrides.length > 0) slim.overrides = e.overrides;
  return slim;
}

export function getCalendar() {
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

    /** Suppress invalidate() during multi-step mutations. */
    beginBatch() { batchDepth++; },
    endBatch() { if (--batchDepth <= 0) { batchDepth = 0; invalidate(); } },

    async load() {
      perfMark("boot.sql-start");
      try {
        const renderZone = localTimezone();
        const rows = await select<DbCalendarEvent>(
          `SELECT ce.id, ce.title, ce.start_time, ce.end_time, ce.timezone,
                  ce.calendar_id, ce.color, ce.rrule,
                  ce.notifications, ce.exceptions, ce.repeat_until,
                  ce.all_day, ce.location, ce.transparency, ce.status,
                  ce.rdate,
                  pc.focus_duration_minutes, pc.short_break_minutes,
                  pc.long_break_minutes, pc.pomodoro_count,
                  pc.idle_timeout_minutes
           FROM calendar_events ce
           LEFT JOIN pomodoro_configs pc ON pc.event_id = ce.id
           ORDER BY ce.start_time ASC`,
        );
        perfMark("boot.sql-main-done", { rows: rows.length });
        const mapped = rows.map((r) => mapRow(r, renderZone));
        perfMark("boot.maprow-done");

        if (mapped.length > 0) {
          const overrideMap = await loadOverrides(renderZone);
          for (const evt of mapped) {
            const ovr = overrideMap.get(evt.id);
            if (ovr?.length) evt.overrides = ovr;
          }
        }
        perfMark("boot.sql-children-done");

        rawBlocks = mapped;
        invalidate();
        perfMark("boot.rawblocks-set", { events: rawBlocks.length });
      } catch (e) {
        console.error("[calendar] load() failed:", e);
        throw e;
      }
    },

    /**
     * Fetch the full DB row for one event id and return a fully populated
     * `CalendarEvent`. The boot path holds only a slim subset of columns in
     * `rawBlocks`; this is what EventPanel and the ICS exporter call when
     * they need the heavy fields (description, url, organizer, attendees,
     * alarms, visibility, priority, categories, geo, sequence,
     * extendedProperties, guestPermissions, plus heavy override columns).
     *
     * Four queries run in parallel: the main row joined with its pomodoro
     * config, plus attendees / alarms / overrides keyed by event_id /
     * parent_event_id. All four hit indexed PK or FK columns, so the cost
     * over Tauri IPC is a few milliseconds even on the release build.
     */
    async loadFullEvent(id: string): Promise<CalendarEvent | undefined> {
      const renderZone = localTimezone();
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
        guest_can_modify: number;
        guest_can_invite_others: number;
        guest_can_see_other_guests: number;
      };
      type DbFullOverride = DbOverride & {
        description: string | null;
        location: string | null;
        url: string | null;
        visibility: string | null;
        extended_properties: string | null;
      };
      const [rows, attendeeRows, alarmRows, overrideRows] = await Promise.all([
        select<DbFullEvent>(
          `SELECT ce.*,
                  pc.focus_duration_minutes, pc.short_break_minutes,
                  pc.long_break_minutes, pc.pomodoro_count,
                  pc.idle_timeout_minutes
           FROM calendar_events ce
           LEFT JOIN pomodoro_configs pc ON pc.event_id = ce.id
           WHERE ce.id = $1`,
          [id],
        ),
        select<DbAttendee>(
          `SELECT * FROM calendar_event_attendees WHERE event_id = $1
           ORDER BY sort_order ASC`,
          [id],
        ),
        select<DbAlarm>(
          `SELECT * FROM calendar_event_alarms WHERE event_id = $1
           ORDER BY sort_order ASC`,
          [id],
        ),
        select<DbFullOverride>(
          `SELECT * FROM calendar_event_overrides WHERE parent_event_id = $1`,
          [id],
        ),
      ]);
      if (rows.length === 0) return undefined;
      const row = rows[0];
      const event = mapRow(row, renderZone);

      if (row.description) event.description = row.description;
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
      if (row.guest_can_modify === 1
        || row.guest_can_invite_others === 0
        || row.guest_can_see_other_guests === 0) {
        event.guestPermissions = {
          canModify: row.guest_can_modify === 1,
          canInviteOthers: row.guest_can_invite_others !== 0,
          canSeeOtherGuests: row.guest_can_see_other_guests !== 0,
        };
      }

      if (attendeeRows.length > 0) {
        event.attendees = attendeeRows.map(mapAttendee);
      }
      if (alarmRows.length > 0) {
        event.alarms = alarmRows.map(mapAlarm);
      }
      if (overrideRows.length > 0) {
        event.overrides = overrideRows.map((r) => {
          const slim = mapOverride(r, renderZone);
          if (r.description) slim.description = r.description;
          if (r.location) slim.location = r.location;
          if (r.url) slim.url = r.url;
          if (r.visibility) slim.visibility = r.visibility as EventVisibility;
          const ep = safeJsonParse<Record<string, string>>(r.extended_properties);
          if (ep) slim.extendedProperties = ep;
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
      calendarId?: string;
      color?: EventColor;
      description?: string;
      recurrence?: RecurrenceConfig;
      notifications?: number[];
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
      guestPermissions?: GuestPermissions;
    }): Promise<CalendarEvent> {
      // Sanitize times to ensure clean integer minutes
      const sanitizedStart = sanitizeCalendarTime(opts.start);
      const sanitizedEnd = sanitizeCalendarTime(opts.end);
      if (!sanitizedStart || !sanitizedEnd) {
        throw new Error(`Invalid calendar time format: start="${opts.start}", end="${opts.end}"`);
      }

      const id = opts.id ?? crypto.randomUUID();
      const now = nowLocal();
      const timezone = localTimezone();
      const calendarId = opts.calendarId ?? "local";
      const rrule = opts.recurrence ? recurrenceToRrule(opts.recurrence) : null;
      const repeatUntil = opts.recurrence?.end.type === "until"
        ? opts.recurrence.end.date : null;
      const notifJson = opts.notifications && opts.notifications.length > 0
        ? JSON.stringify(opts.notifications) : null;
      await execute(
        `INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, rrule, notifications, repeat_until,
            all_day, location, url, transparency, status,
            source_uid, visibility, priority, categories, geo,
            sequence, rdate, extended_properties, organizer,
            guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                 $22, $23, $24, $25, $26, $27, $28, $29, $30)`,
        [id, opts.title,
         toDbTime(sanitizedStart, timezone, opts.allDay),
         toDbTime(sanitizedEnd, timezone, opts.allDay),
         timezone, calendarId, opts.color ?? null, opts.description ?? "",
         rrule, notifJson, repeatUntil,
         opts.allDay ? 1 : 0, opts.location ?? "", opts.url ?? "",
         opts.transparency ?? "opaque", opts.status ?? "confirmed",
         opts.sourceUid ?? null,
         opts.visibility ?? "public",
         opts.priority ?? null,
         opts.categories ? JSON.stringify(opts.categories) : null,
         opts.geo ? JSON.stringify(opts.geo) : null,
         opts.sequence ?? 0,
         opts.rdate ? JSON.stringify(opts.rdate) : null,
         opts.extendedProperties ? JSON.stringify(opts.extendedProperties) : null,
         opts.organizer ? JSON.stringify(opts.organizer) : null,
         opts.guestPermissions?.canModify ? 1 : 0,
         opts.guestPermissions?.canInviteOthers === false ? 0 : 1,
         opts.guestPermissions?.canSeeOtherGuests === false ? 0 : 1,
         now, now],
      );
      if (opts.pomodoroConfig) {
        await execute(
          `INSERT INTO pomodoro_configs
             (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count, idle_timeout_minutes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, opts.pomodoroConfig.focusDurationMinutes, opts.pomodoroConfig.shortBreakMinutes,
           opts.pomodoroConfig.longBreakMinutes, opts.pomodoroConfig.pomodoroCount,
           opts.pomodoroConfig.idleTimeoutMinutes],
        );
      }
      if (opts.attendees && opts.attendees.length > 0) {
        await saveAttendees(id, opts.attendees);
      }
      const event: CalendarEvent = slimEvent({
        id, title: opts.title, start: sanitizedStart, end: sanitizedEnd,
        timezone, calendarId,
        color: opts.color,
        recurrence: opts.recurrence, notifications: opts.notifications,
        pomodoroConfig: opts.pomodoroConfig,
        allDay: opts.allDay, location: opts.location,
        transparency: opts.transparency, status: opts.status,
      });
      rawBlocks = [...rawBlocks, event];
      invalidate();
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
      const parentId = patch.recurringParentId ?? patch.id;
      let toUpdate: Partial<CalendarEvent> & { id: string };

      if (patch.recurringParentId) {
        const template = rawBlocks.find((b) => b.id === parentId);
        toUpdate = { ...patch, id: parentId };
        delete toUpdate.recurringParentId;
        if (template) {
          // Merge instance-level changes onto the template's start/end date
          // so the template's wall-clock anchor stays put.
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

      const existing = rawBlocks.find((b) => b.id === parentId);
      const homeZone = toUpdate.timezone ?? existing?.timezone ?? localTimezone();
      const allDayForDb = "allDay" in toUpdate ? !!toUpdate.allDay : !!existing?.allDay;

      const sets: string[] = [];
      const binds: unknown[] = [];
      let p = 1;
      const addSet = (column: string, value: unknown) => {
        sets.push(`${column} = $${p++}`);
        binds.push(value);
      };

      const presentKeys = new Set(Object.keys(toUpdate));

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
            addSet("title", toUpdate.title ?? "");
            break;
          case "start":
            addSet("start_time", toDbTime(String(toUpdate.start), homeZone, allDayForDb));
            break;
          case "end":
            addSet("end_time", toDbTime(String(toUpdate.end), homeZone, allDayForDb));
            break;
          case "timezone":
            addSet("timezone", toUpdate.timezone ?? "");
            break;
          case "calendarId":
            addSet("calendar_id", toUpdate.calendarId ?? "local");
            break;
          case "color":
            addSet("color", toUpdate.color ?? null);
            break;
          case "description":
            addSet("description", toUpdate.description ?? "");
            break;
          case "recurrence": {
            const rrule = toUpdate.recurrence ? recurrenceToRrule(toUpdate.recurrence) : null;
            const repeatUntil = toUpdate.recurrence?.end.type === "until"
              ? toUpdate.recurrence.end.date : null;
            addSet("rrule", rrule);
            addSet("repeat_until", repeatUntil);
            break;
          }
          case "notifications": {
            const notifJson = toUpdate.notifications && toUpdate.notifications.length > 0
              ? JSON.stringify(toUpdate.notifications) : null;
            addSet("notifications", notifJson);
            break;
          }
          case "exceptions": {
            const exceptionsJson = toUpdate.exceptions && toUpdate.exceptions.length > 0
              ? JSON.stringify(toUpdate.exceptions) : null;
            addSet("exceptions", exceptionsJson);
            break;
          }
          case "allDay":
            addSet("all_day", toUpdate.allDay ? 1 : 0);
            break;
          case "location":
            addSet("location", toUpdate.location ?? "");
            break;
          case "url":
            addSet("url", toUpdate.url ?? "");
            break;
          case "transparency":
            addSet("transparency", toUpdate.transparency ?? "opaque");
            break;
          case "status":
            addSet("status", toUpdate.status ?? "confirmed");
            break;
          case "sourceUid":
            addSet("source_uid", toUpdate.sourceUid ?? null);
            break;
          case "visibility":
            addSet("visibility", toUpdate.visibility ?? "public");
            break;
          case "priority":
            addSet("priority", toUpdate.priority ?? null);
            break;
          case "categories":
            addSet("categories",
              toUpdate.categories ? JSON.stringify(toUpdate.categories) : null);
            break;
          case "geo":
            addSet("geo", toUpdate.geo ? JSON.stringify(toUpdate.geo) : null);
            break;
          case "sequence":
            addSet("sequence", toUpdate.sequence ?? 0);
            break;
          case "rdate":
            addSet("rdate", toUpdate.rdate ? JSON.stringify(toUpdate.rdate) : null);
            break;
          case "extendedProperties":
            addSet("extended_properties",
              toUpdate.extendedProperties ? JSON.stringify(toUpdate.extendedProperties) : null);
            break;
          case "organizer":
            addSet("organizer",
              toUpdate.organizer ? JSON.stringify(toUpdate.organizer) : null);
            break;
          case "guestPermissions": {
            const gp = toUpdate.guestPermissions;
            addSet("guest_can_modify", gp?.canModify ? 1 : 0);
            addSet("guest_can_invite_others", gp?.canInviteOthers === false ? 0 : 1);
            addSet("guest_can_see_other_guests", gp?.canSeeOtherGuests === false ? 0 : 1);
            break;
          }
        }
      }

      const now = nowLocal();
      addSet("updated_at", now);

      await execute(
        `UPDATE calendar_events SET ${sets.join(", ")} WHERE id = $${p}`,
        [...binds, parentId],
      );

      if (presentKeys.has("attendees")) {
        await saveAttendees(parentId, toUpdate.attendees ?? []);
      }
      if (presentKeys.has("alarms")) {
        await saveAlarms(parentId, toUpdate.alarms ?? []);
      }
      if (presentKeys.has("pomodoroConfig")) {
        if (toUpdate.pomodoroConfig) {
          await execute(
            `INSERT OR REPLACE INTO pomodoro_configs
               (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count, idle_timeout_minutes)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [parentId, toUpdate.pomodoroConfig.focusDurationMinutes,
             toUpdate.pomodoroConfig.shortBreakMinutes,
             toUpdate.pomodoroConfig.longBreakMinutes,
             toUpdate.pomodoroConfig.pomodoroCount,
             toUpdate.pomodoroConfig.idleTimeoutMinutes],
          );
        } else {
          await execute("DELETE FROM pomodoro_configs WHERE event_id = $1", [parentId]);
        }
      }

      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId
          ? { ...b, ...toUpdate, id: parentId, recurringParentId: undefined }
          : b,
      );
      invalidate();
    },

    async deleteBlock(id: string) {
      // Resolve recurring instance to parent
      const parentId = id.includes("::") ? id.split("::")[0] : id;
      await execute("DELETE FROM calendar_events WHERE id = $1", [parentId]);
      rawBlocks = rawBlocks.filter((b) => b.id !== parentId);
      invalidate();
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
      const now = nowLocal();

      // Add exception to parent
      await execute(
        `UPDATE calendar_events SET exceptions = $1, updated_at = $2 WHERE id = $3`,
        [JSON.stringify(exceptions), now, parentId],
      );

      // Create standalone event by copying heavy columns straight from the
      // parent's DB row. Identity, time, color, notifications, and the
      // recurrence-related columns come in as bind params; everything the
      // slim in-memory parent no longer carries (description, url,
      // organizer, geo, categories, extended_properties, guest_can_*,
      // visibility, priority, sequence) flows through the INSERT...SELECT.
      const newId = crypto.randomUUID();
      const timezone = parent.timezone || localTimezone();
      const notifJson = parent.notifications && parent.notifications.length > 0
        ? JSON.stringify(parent.notifications) : null;
      await execute(
        `INSERT INTO calendar_events (
           id, title, start_time, end_time, timezone, calendar_id,
           color, notifications, rrule, repeat_until, exceptions, rdate,
           all_day, location, transparency, status,
           source_uid,
           description, url, visibility, priority, categories, geo,
           sequence, extended_properties, organizer,
           guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
           created_at, updated_at
         )
         SELECT $1, $2, $3, $4, $5, $6,
                $7, $8, NULL, NULL, NULL, NULL,
                $9, $10, $11, $12,
                NULL,
                description, url, visibility, priority, categories, geo,
                sequence, extended_properties, organizer,
                guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
                $13, $14
         FROM calendar_events WHERE id = $15`,
        [
          newId, instanceEvent.title,
          toDbTime(instanceEvent.start, timezone, parent.allDay),
          toDbTime(instanceEvent.end, timezone, parent.allDay),
          timezone, parent.calendarId,
          instanceEvent.color ?? null, notifJson,
          parent.allDay ? 1 : 0,
          parent.location ?? "",
          parent.transparency ?? "opaque",
          parent.status ?? "confirmed",
          now, now,
          parentId,
        ],
      );
      if (parent.pomodoroConfig) {
        await execute(
          `INSERT INTO pomodoro_configs
             (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count, idle_timeout_minutes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId, parent.pomodoroConfig.focusDurationMinutes,
           parent.pomodoroConfig.shortBreakMinutes,
           parent.pomodoroConfig.longBreakMinutes,
           parent.pomodoroConfig.pomodoroCount,
           parent.pomodoroConfig.idleTimeoutMinutes],
        );
      }

      // Copy attendees from parent's DB row. lower(hex(randomblob(16)))
      // gives 32 hex chars; the schema PK is TEXT, no UUID format required.
      await execute(
        `INSERT INTO calendar_event_attendees
           (id, event_id, name, email, role, status, rsvp, sort_order)
         SELECT lower(hex(randomblob(16))), $1, name, email, role, status, rsvp, sort_order
         FROM calendar_event_attendees WHERE event_id = $2`,
        [newId, parentId],
      );

      // Migrate pomodoro segments from parent template to the new standalone event
      // Segments may be stored with event_id = parentId or event_id = parentId::date
      await execute(
        `UPDATE pomodoro_segments SET event_id = $1
         WHERE event_id IN ($2, $2 || '::' || $3) AND event_date = $3`,
        [newId, parentId, instanceDate],
      );

      // Update in-memory state
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
        notifications: parent.notifications,
        pomodoroConfig: parent.pomodoroConfig,
      });
      rawBlocks = [...rawBlocks, standalone];
      invalidate();
      return standalone;
    },

    /**
     * Add an exception date to a recurring parent (hides one instance without deleting it).
     */
    async addException(parentId: string, date: string) {
      const parent = rawBlocks.find((b) => b.id === parentId);
      if (!parent) return;

      const exceptions = [...(parent.exceptions ?? []), date];
      const now = nowLocal();
      await execute(
        `UPDATE calendar_events SET exceptions = $1, updated_at = $2 WHERE id = $3`,
        [JSON.stringify(exceptions), now, parentId],
      );
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, exceptions } : b,
      );
      invalidate();
    },

    /**
     * Set repeat_until on a recurring template to cap the series.
     */
    async setRepeatUntil(parentId: string, date: string) {
      const parent = rawBlocks.find((b) => b.id === parentId);
      if (!parent || !parent.recurrence) return;

      const now = nowLocal();
      const updatedRecurrence: RecurrenceConfig = {
        ...parent.recurrence,
        end: { type: "until", date },
      };
      const rrule = recurrenceToRrule(updatedRecurrence);
      await execute(
        `UPDATE calendar_events SET repeat_until = $1, rrule = $2, updated_at = $3 WHERE id = $4`,
        [date, rrule, now, parentId],
      );
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, recurrence: updatedRecurrence } : b,
      );
      invalidate();
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
      const now = nowLocal();

      // Cap the old template's recurrence at dayBefore
      const cappedRecurrence: RecurrenceConfig | undefined = parent.recurrence
        ? { ...parent.recurrence, end: { type: "until", date: dayBefore } }
        : undefined;
      const cappedRrule = cappedRecurrence ? recurrenceToRrule(cappedRecurrence) : null;
      await execute(
        `UPDATE calendar_events SET repeat_until = $1, rrule = $2, updated_at = $3 WHERE id = $4`,
        [dayBefore, cappedRrule, now, parentId],
      );

      // Create new recurring template starting at changes' full position
      const newId = crypto.randomUUID();
      const newStart = changes.start
        ? String(changes.start)
        : `${splitDate} ${instanceEvent.start.split(" ")[1]}`;
      const newEnd = changes.end
        ? String(changes.end)
        : `${splitDate} ${instanceEvent.end.split(" ")[1]}`;
      const merged = { ...parent, ...changes };
      // New template inherits the original recurrence (without the old end condition)
      const newRecurrence: RecurrenceConfig | undefined = parent.recurrence
        ? { ...parent.recurrence, end: { type: "never" } }
        : undefined;
      const rrule = newRecurrence ? recurrenceToRrule(newRecurrence) : null;

      const splitNotifJson = merged.notifications && merged.notifications.length > 0
        ? JSON.stringify(merged.notifications) : null;
      const homeZone = parent.timezone || localTimezone();
      // description and url are heavy columns. If `changes` carries them
      // (user edited via EventPanel after Step 3 lands), bind the new
      // value; COALESCE then prefers it. Otherwise bind NULL and the
      // parent's column wins. Other heavy columns (visibility, priority,
      // categories, geo, sequence, extended_properties, organizer,
      // guest_can_*) preserve current behavior: parent's row, never
      // overridden by `changes`.
      const descriptionPatch = "description" in changes
        ? (changes.description ?? "") : null;
      const urlPatch = "url" in changes ? (changes.url ?? "") : null;
      await execute(
        `INSERT INTO calendar_events (
           id, title, start_time, end_time, timezone, calendar_id,
           color, notifications, rrule, repeat_until, exceptions, rdate,
           all_day, location, transparency, status,
           source_uid,
           description, url, visibility, priority, categories, geo,
           sequence, extended_properties, organizer,
           guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
           created_at, updated_at
         )
         SELECT $1, $2, $3, $4, $5, $6,
                $7, $8, $9, NULL, NULL, NULL,
                $10, $11, $12, $13,
                NULL,
                COALESCE($14, description),
                COALESCE($15, url),
                visibility, priority, categories, geo,
                sequence, extended_properties, organizer,
                guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
                $16, $17
         FROM calendar_events WHERE id = $18`,
        [
          newId, merged.title ?? parent.title,
          toDbTime(newStart, homeZone, merged.allDay),
          toDbTime(newEnd, homeZone, merged.allDay),
          homeZone, parent.calendarId,
          merged.color ?? null,
          splitNotifJson,
          rrule,
          merged.allDay ? 1 : 0,
          merged.location ?? "",
          merged.transparency ?? "opaque",
          merged.status ?? "confirmed",
          descriptionPatch,
          urlPatch,
          now, now,
          parentId,
        ],
      );

      const pomConfig = merged.pomodoroConfig ?? parent.pomodoroConfig;
      if (pomConfig) {
        await execute(
          `INSERT INTO pomodoro_configs
             (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count, idle_timeout_minutes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId, pomConfig.focusDurationMinutes, pomConfig.shortBreakMinutes,
           pomConfig.longBreakMinutes, pomConfig.pomodoroCount,
           pomConfig.idleTimeoutMinutes],
        );
      }

      // Copy attendees from parent's DB row
      await execute(
        `INSERT INTO calendar_event_attendees
           (id, event_id, name, email, role, status, rsvp, sort_order)
         SELECT lower(hex(randomblob(16))), $1, name, email, role, status, rsvp, sort_order
         FROM calendar_event_attendees WHERE event_id = $2`,
        [newId, parentId],
      );

      // Update in-memory state
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
        exceptions: undefined,
        pomodoroConfig: pomConfig,
      });
      rawBlocks = [...rawBlocks, newTemplate];
      invalidate();
      return newTemplate;
    },

    async clearAll() {
      await execute("DELETE FROM calendar_events");
      rawBlocks = [];
      invalidate();
    },

    /**
     * Insert or update a batch of events into a target calendar, deduplicated
     * by (calendar_id, source_uid). Newer revisions (higher SEQUENCE) win;
     * equal SEQUENCE counts as an update so re-importing the same file leaves
     * the DB clean. Child rows (attendees, alarms, overrides) are replaced.
     *
     * The whole batch ships as a single SQLite transaction via the Rust
     * `db_execute_batch` command. SQLite auto-commits one statement at a time
     * when called through `tauri-plugin-sql`'s pool; that fsynced every
     * statement, turning a few-thousand-row import into a multi-minute job.
     * One transaction means one fsync at commit, even for ~5k events.
     */
    async bulkImport(
      events: CalendarEvent[],
      targetCalendarId: string,
    ): Promise<IcsImportSummary> {
      const now = nowLocal();
      const fallbackZone = localTimezone();

      // Pre-fetch existing rows for every imported sourceUid so we can
      // classify add/update/skip without per-event SELECT roundtrips.
      const SELECT_CHUNK = 500;
      const uniqueUids = [...new Set(
        events.map((e) => e.sourceUid).filter((u): u is string => Boolean(u)),
      )];
      const existing: ExistingEventRow[] = [];
      for (let i = 0; i < uniqueUids.length; i += SELECT_CHUNK) {
        const slice = uniqueUids.slice(i, i + SELECT_CHUNK);
        const placeholders = slice.map((_, idx) => `$${idx + 2}`).join(",");
        const rows = await select<{ id: string; source_uid: string; sequence: number | null }>(
          `SELECT id, source_uid, sequence FROM calendar_events
           WHERE calendar_id = $1 AND source_uid IN (${placeholders})`,
          [targetCalendarId, ...slice],
        );
        for (const r of rows) {
          existing.push({ id: r.id, source_uid: r.source_uid, sequence: r.sequence ?? 0 });
        }
      }

      const classification = classifyImportEvents(
        events, existing, () => crypto.randomUUID(),
      );

      // Skip the IPC roundtrip entirely when there is nothing to write
      // (every event was either missing a UID or had an older sequence).
      if (classification.toAdd.length === 0 && classification.toUpdate.length === 0) {
        return {
          added: 0,
          updated: 0,
          skippedOlder: classification.skippedOlder,
          warnings: classification.warnings,
        };
      }

      const statements = buildBulkImportStatements(
        classification, targetCalendarId, now, fallbackZone,
      );
      await invoke("db_execute_batch", { dbUrl: dbUrl(), statements });

      // In-memory state update: the previous implementation called
      // `store.load()` to re-read the universe from disk. Now that we know
      // exactly which rows we touched, splice them into `rawBlocks` directly
      // and run one invalidate at the end so cached window expansions drop.
      store.beginBatch();
      try {
        const reZone = (wallClock: string, sourceZone: string): string => {
          if (sourceZone === fallbackZone) return wallClock;
          return utcIsoToWallClock(wallClockToUtcIso(wallClock, sourceZone), fallbackZone);
        };
        const idToIdx = new Map<string, number>();
        const next = [...rawBlocks];
        for (let i = 0; i < next.length; i++) idToIdx.set(next[i].id, i);

        for (const { event, newId } of classification.toAdd) {
          const homeZone = event.timezone || fallbackZone;
          next.push(slimEvent({
            ...event,
            id: newId,
            calendarId: targetCalendarId,
            timezone: homeZone,
            start: event.allDay ? event.start : reZone(event.start, homeZone),
            end: event.allDay ? event.end : reZone(event.end, homeZone),
          }));
        }

        for (const { event, existingId } of classification.toUpdate) {
          const homeZone = event.timezone || fallbackZone;
          const idx = idToIdx.get(existingId);
          const merged: CalendarEvent = slimEvent({
            ...(idx !== undefined ? next[idx] : {} as CalendarEvent),
            ...event,
            id: existingId,
            calendarId: targetCalendarId,
            timezone: homeZone,
            start: event.allDay ? event.start : reZone(event.start, homeZone),
            end: event.allDay ? event.end : reZone(event.end, homeZone),
          });
          if (idx !== undefined) next[idx] = merged;
          else next.push(merged);
        }

        rawBlocks = next;
      } finally {
        store.endBatch();
      }

      return {
        added: classification.added,
        updated: classification.updated,
        skippedOlder: classification.skippedOlder,
        warnings: classification.warnings,
      };
    },

    /**
     * Serialize every event of `calendar` (template + child rows already
     * merged via `load()`) into a `.ics` string ready to write to disk.
     */
    exportCalendarAsIcs(calendar: Calendar): string {
      const calendarEvents = rawBlocks.filter((e) => e.calendarId === calendar.id);
      return serializeCalendarToIcs(calendar, calendarEvents);
    },

    /**
     * Check whether a specific recurring instance date has completed progress segments.
     */
    async hasProgressSegments(templateId: string, date: string): Promise<boolean> {
      const rows = await select<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM pomodoro_segments
         WHERE event_id IN ($1, $1 || '::' || $2) AND event_date = $2
           AND status IN ('completed', 'interrupted', 'skipped')
           AND actual_start IS NOT NULL`,
        [templateId, date],
      );
      return rows.length > 0 && rows[0].cnt > 0;
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
      const rows = await select<{ event_date: string }>(
        `SELECT DISTINCT event_date FROM pomodoro_segments
         WHERE (event_id = $1 OR event_id = $1 || '::' || event_date)
           AND event_date < $2
           AND status IN ('completed', 'interrupted', 'skipped')
           AND actual_start IS NOT NULL`,
        [templateId, cutoffDate],
      );

      const datesToProtect = rows
        .map((r) => r.event_date)
        .filter((d) => d !== excludeDate);

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
