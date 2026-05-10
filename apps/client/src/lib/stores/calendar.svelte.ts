import { invoke } from "@tauri-apps/api/core";
import { dbUrl, select } from "$lib/api/db";
import type {
  Calendar, CalendarEvent, EventAttendee, EventColor, EventOverride,
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
  buildBulkImportPayload,
  type CalendarBulkImportResult,
} from "./calendar-bulk-import";
import type { IcsImportSummary } from "$lib/calendar/ics/types";
import { mark as perfMark } from "$lib/stores/perflog.svelte";

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
let loaded = $state(false);
let batchDepth = 0;
const PANEL_EVENT_CACHE_LIMIT = 64;
const panelEventCache = new Map<string, Promise<CalendarEvent | undefined>>();

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
 * Load slim per-instance overrides in one unfiltered query and group by
 * parent id. Heavy override columns (description, location, url,
 * extended_properties, visibility) stay in the DB and ride along with the
 * parent through the panel / full-event loaders when EventPanel, undo, or
 * ICS export needs them.
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

    get loaded(): boolean {
      return loaded;
    },

    /** Suppress invalidate() during multi-step mutations. */
    beginBatch() { batchDepth++; },
    endBatch() { if (--batchDepth <= 0) { batchDepth = 0; invalidate(); } },

    async load() {
      perfMark("boot.sql-start");
      try {
        loaded = false;
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
        loaded = true;
        invalidate();
        perfMark("boot.rawblocks-set", { events: rawBlocks.length });
      } catch (e) {
        console.error("[calendar] load() failed:", e);
        throw e;
      }
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
        const [rows, attendeeRows] = await Promise.all([
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
        ]);
        if (rows.length === 0) return undefined;
        const event = mapRow(rows[0], renderZone);
        applyFullEventFields(rows[0], event);
        if (attendeeRows.length > 0) event.attendees = attendeeRows.map(mapAttendee);
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
     * `CalendarEvent`. The boot path holds only a slim subset of columns in
     * `rawBlocks`; this is what ICS export and undo / redo call when they
     * need every heavy field, including alarms and override mirrors.
     */
    async loadFullEvent(id: string): Promise<CalendarEvent | undefined> {
      const renderZone = localTimezone();
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
      applyFullEventFields(row, event);

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
          description: opts.description ?? "",
          rrule,
          notifications: notifJson,
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

      const fields: CalendarUpdateField[] = [];
      const addField = (field: CalendarUpdateField) => {
        fields.push(field);
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
              ? toUpdate.recurrence.end.date : null;
            addField({ field: "rrule", value: rrule });
            addField({ field: "repeatUntil", value: repeatUntil });
            break;
          }
          case "notifications": {
            const notifJson = toUpdate.notifications && toUpdate.notifications.length > 0
              ? JSON.stringify(toUpdate.notifications) : null;
            addField({ field: "notifications", value: notifJson });
            break;
          }
          case "exceptions": {
            const exceptionsJson = toUpdate.exceptions && toUpdate.exceptions.length > 0
              ? JSON.stringify(toUpdate.exceptions) : null;
            addField({ field: "exceptions", value: exceptionsJson });
            break;
          }
          case "allDay":
            addField({ field: "allDay", value: !!toUpdate.allDay });
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
              value: toUpdate.extendedProperties
                ? JSON.stringify(toUpdate.extendedProperties)
                : null,
            });
            break;
          case "organizer":
            addField({
              field: "organizer",
              value: toUpdate.organizer ? JSON.stringify(toUpdate.organizer) : null,
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
        }
      }

      const now = nowLocal();
      const pomodoroConfig: PomodoroConfigPatch | null = presentKeys.has("pomodoroConfig")
        ? toUpdate.pomodoroConfig
          ? { action: "set", value: toUpdate.pomodoroConfig }
          : { action: "clear" }
        : null;

      await invoke("calendar_update_event", {
        dbUrl: dbUrl(),
        patch: {
          id: parentId,
          updatedAt: now,
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
      });

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
      await invoke("calendar_delete_event", { dbUrl: dbUrl(), id: parentId });
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
          rrule,
          allDay: merged.allDay ?? false,
          location: merged.location ?? "",
          transparency: merged.transparency ?? "opaque",
          status: merged.status ?? "confirmed",
          descriptionPatch,
          urlPatch,
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
        exceptions: undefined,
        pomodoroConfig: pomConfig,
      });
      rawBlocks = [...rawBlocks, newTemplate];
      invalidate();
      return newTemplate;
    },

    async clearAll() {
      await invoke("calendar_clear_events", { dbUrl: dbUrl() });
      rawBlocks = [];
      invalidate();
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
    ): Promise<IcsImportSummary> {
      const now = nowLocal();
      const fallbackZone = localTimezone();

      const payload = buildBulkImportPayload(
        events, targetCalendarId, now, fallbackZone, () => crypto.randomUUID(),
      );
      const eventByCandidateId = new Map(
        payload.events.map((event, index) => [event.candidateId, events[index]]),
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

        for (const applied of result.applied) {
          const event = eventByCandidateId.get(applied.candidateId);
          if (!event) continue;
          const homeZone = event.timezone || fallbackZone;
          const idx = idToIdx.get(applied.eventId);
          const merged: CalendarEvent = slimEvent({
            ...(idx !== undefined ? next[idx] : {} as CalendarEvent),
            ...event,
            id: applied.eventId,
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
        added: result.added,
        updated: result.updated,
        skippedOlder: result.skippedOlder,
        warnings: result.warnings,
      };
    },

    /**
     * Serialize every event of `calendar` into a `.ics` string ready to write
     * to disk. `rawBlocks` carries only the slim render shape, so heavy fields
     * (description, attendees, alarms, organizer, etc.) are loaded on demand
     * via `loadFullEvent` before serialization so the export is lossless.
     */
    async exportCalendarAsIcs(calendar: Calendar): Promise<string> {
      const slim = rawBlocks.filter((e) => e.calendarId === calendar.id);
      const full = await Promise.all(slim.map((e) => store.loadFullEvent(e.id)));
      const calendarEvents = full.filter((e): e is CalendarEvent => e !== undefined);
      const { serializeCalendarToIcs } = await import("$lib/calendar/ics/serializer");
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
