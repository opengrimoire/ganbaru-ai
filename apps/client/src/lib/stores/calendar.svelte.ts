import { execute, select } from "$lib/api/db";
import type {
  CalendarEvent, EventAlarm, EventAttendee, EventColor, EventOverride,
  EventOrganizer, EventStatus, EventTransparency, EventVisibility,
  GeoCoordinates, GuestPermissions, PomodoroConfig, RecurrenceConfig,
} from "$lib/components/calendar/types";
import { recurrenceToRrule } from "$lib/components/calendar/rrule";
import { expandRecurring, parseYMD, fmtYMD } from "$lib/components/calendar/recurrence";
import { sanitizeCalendarTime } from "$lib/components/calendar/utils";
import {
  mapRow, mapAttendee, mapAlarm, mapOverride, toDbTime,
  type DbCalendarEvent, type DbAttendee, type DbAlarm, type DbOverride,
} from "./map-row";

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
/** Expanded events including virtual recurring instances. */
let blocks = $state<CalendarEvent[]>([]);
let batchDepth = 0;
function reexpand() {
  if (batchDepth > 0) return;
  blocks = expandRecurring(rawBlocks);
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
 * When a recurring instance is edited (e.g. via drag), merge its changes
 * into the template: keep the template's date, take the instance's time-of-day
 * and all non-positional fields.
 */
function mergeIntoTemplate(template: CalendarEvent, changes: CalendarEvent): CalendarEvent {
  const templateStartDate = template.start.split(" ")[0];
  const templateEndDate = template.end.split(" ")[0];
  const newStartTime = changes.start.split(" ")[1];
  const newEndTime = changes.end.split(" ")[1];
  return {
    ...template,
    ...changes,
    id: template.id,
    start: `${templateStartDate} ${newStartTime}`,
    end: `${templateEndDate} ${newEndTime}`,
    recurringParentId: undefined,
  };
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

async function loadAttendees(eventIds: string[]): Promise<Map<string, EventAttendee[]>> {
  const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(",");
  const rows = await select<DbAttendee>(
    `SELECT * FROM calendar_event_attendees WHERE event_id IN (${placeholders}) ORDER BY sort_order ASC`,
    eventIds,
  );
  const map = new Map<string, EventAttendee[]>();
  for (const r of rows) {
    const list = map.get(r.event_id) ?? [];
    list.push(mapAttendee(r));
    map.set(r.event_id, list);
  }
  return map;
}

async function loadAlarms(eventIds: string[]): Promise<Map<string, EventAlarm[]>> {
  const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(",");
  const rows = await select<DbAlarm>(
    `SELECT * FROM calendar_event_alarms WHERE event_id IN (${placeholders}) ORDER BY sort_order ASC`,
    eventIds,
  );
  const map = new Map<string, EventAlarm[]>();
  for (const r of rows) {
    const list = map.get(r.event_id) ?? [];
    list.push(mapAlarm(r));
    map.set(r.event_id, list);
  }
  return map;
}

async function loadOverrides(eventIds: string[]): Promise<Map<string, EventOverride[]>> {
  const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(",");
  const rows = await select<DbOverride>(
    `SELECT * FROM calendar_event_overrides WHERE parent_event_id IN (${placeholders})`,
    eventIds,
  );
  const map = new Map<string, EventOverride[]>();
  for (const r of rows) {
    const list = map.get(r.parent_event_id) ?? [];
    list.push(mapOverride(r));
    map.set(r.parent_event_id, list);
  }
  return map;
}

export function getCalendar() {
  const store = {
    get events(): CalendarEvent[] {
      return blocks;
    },

    get rawBlocks(): CalendarEvent[] {
      return rawBlocks;
    },

    /** Suppress reexpand() during multi-step mutations. */
    beginBatch() { batchDepth++; },
    endBatch() { if (--batchDepth <= 0) { batchDepth = 0; reexpand(); } },

    async load() {
      console.log("[calendar] load() called");
      try {
        const rows = await select<DbCalendarEvent>(
          `SELECT ce.id, ce.title, ce.start_time, ce.end_time, ce.timezone,
                  ce.calendar_id, ce.color, ce.description, ce.rrule,
                  ce.notifications, ce.exceptions, ce.repeat_until,
                  ce.all_day, ce.location, ce.url, ce.transparency, ce.status,
                  ce.source_uid, ce.visibility, ce.priority, ce.categories,
                  ce.geo, ce.sequence, ce.rdate, ce.extended_properties,
                  ce.organizer,
                  ce.guest_can_modify, ce.guest_can_invite_others,
                  ce.guest_can_see_other_guests,
                  pc.focus_duration_minutes, pc.short_break_minutes,
                  pc.long_break_minutes, pc.pomodoro_count,
                  pc.idle_timeout_minutes
           FROM calendar_events ce
           LEFT JOIN pomodoro_configs pc ON pc.event_id = ce.id
           ORDER BY ce.start_time ASC`,
        );
        console.log(`[calendar] loaded ${rows.length} blocks from DB`, rows);
        const mapped = rows.map(mapRow);

        // Load related tables and merge into events
        if (mapped.length > 0) {
          const ids = mapped.map((e) => e.id);
          const [attendeeMap, alarmMap, overrideMap] = await Promise.all([
            loadAttendees(ids),
            loadAlarms(ids),
            loadOverrides(ids),
          ]);
          for (const evt of mapped) {
            const att = attendeeMap.get(evt.id);
            if (att?.length) evt.attendees = att;
            const alm = alarmMap.get(evt.id);
            if (alm?.length) evt.alarms = alm;
            const ovr = overrideMap.get(evt.id);
            if (ovr?.length) evt.overrides = ovr;
          }
        }

        rawBlocks = mapped;
        reexpand();
        console.log(`[calendar] blocks set, count: ${blocks.length} (${rawBlocks.length} templates)`);
      } catch (e) {
        console.error("[calendar] load() failed:", e);
        throw e;
      }
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
        [id, opts.title, toDbTime(sanitizedStart), toDbTime(sanitizedEnd),
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
      const event: CalendarEvent = {
        id, title: opts.title, start: sanitizedStart, end: sanitizedEnd,
        timezone, calendarId,
        color: opts.color, description: opts.description,
        recurrence: opts.recurrence, notifications: opts.notifications,
        pomodoroConfig: opts.pomodoroConfig,
        allDay: opts.allDay, location: opts.location, url: opts.url,
        transparency: opts.transparency, status: opts.status,
        sourceUid: opts.sourceUid, visibility: opts.visibility,
        priority: opts.priority, categories: opts.categories,
        geo: opts.geo, sequence: opts.sequence,
        rdate: opts.rdate, extendedProperties: opts.extendedProperties,
        organizer: opts.organizer,
        attendees: opts.attendees,
        guestPermissions: opts.guestPermissions,
      };
      rawBlocks = [...rawBlocks, event];
      reexpand();
      return event;
    },

    async updateBlock(event: CalendarEvent) {
      // Resolve recurring instance to its template
      const parentId = event.recurringParentId ?? event.id;
      let toUpdate = event;
      if (event.recurringParentId) {
        const template = rawBlocks.find((b) => b.id === parentId);
        if (template) {
          toUpdate = mergeIntoTemplate(template, event);
        }
      }
      toUpdate = { ...toUpdate, recurringParentId: undefined };

      // Sanitize times to ensure clean integer minutes
      const sanitizedStart = sanitizeCalendarTime(toUpdate.start);
      const sanitizedEnd = sanitizeCalendarTime(toUpdate.end);
      if (!sanitizedStart || !sanitizedEnd) {
        throw new Error(`Invalid calendar time format: start="${toUpdate.start}", end="${toUpdate.end}"`);
      }
      toUpdate = { ...toUpdate, start: sanitizedStart, end: sanitizedEnd };

      const now = nowLocal();
      const rrule = toUpdate.recurrence ? recurrenceToRrule(toUpdate.recurrence) : null;
      const repeatUntil = toUpdate.recurrence?.end.type === "until"
        ? toUpdate.recurrence.end.date : null;
      const notifJson = toUpdate.notifications && toUpdate.notifications.length > 0
        ? JSON.stringify(toUpdate.notifications) : null;
      const gp = toUpdate.guestPermissions;
      await execute(
        `UPDATE calendar_events
         SET title = $1, start_time = $2, end_time = $3,
             color = $4, description = $5,
             rrule = $6, notifications = $7,
             repeat_until = $8,
             all_day = $9, location = $10, url = $11,
             transparency = $12, status = $13,
             visibility = $14, priority = $15,
             categories = $16, geo = $17,
             sequence = $18, rdate = $19,
             extended_properties = $20, organizer = $21,
             guest_can_modify = $22, guest_can_invite_others = $23,
             guest_can_see_other_guests = $24,
             updated_at = $25
         WHERE id = $26`,
        [
          toUpdate.title,
          toDbTime(String(toUpdate.start)),
          toDbTime(String(toUpdate.end)),
          toUpdate.color ?? null,
          toUpdate.description ?? "",
          rrule,
          notifJson,
          repeatUntil,
          toUpdate.allDay ? 1 : 0,
          toUpdate.location ?? "",
          toUpdate.url ?? "",
          toUpdate.transparency ?? "opaque",
          toUpdate.status ?? "confirmed",
          toUpdate.visibility ?? "public",
          toUpdate.priority ?? null,
          toUpdate.categories ? JSON.stringify(toUpdate.categories) : null,
          toUpdate.geo ? JSON.stringify(toUpdate.geo) : null,
          toUpdate.sequence ?? 0,
          toUpdate.rdate ? JSON.stringify(toUpdate.rdate) : null,
          toUpdate.extendedProperties ? JSON.stringify(toUpdate.extendedProperties) : null,
          toUpdate.organizer ? JSON.stringify(toUpdate.organizer) : null,
          gp?.canModify ? 1 : 0,
          gp?.canInviteOthers === false ? 0 : 1,
          gp?.canSeeOtherGuests === false ? 0 : 1,
          now,
          parentId,
        ],
      );
      // Sync attendees
      await saveAttendees(parentId, toUpdate.attendees ?? []);
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
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, ...toUpdate, id: parentId } : b,
      );
      reexpand();
    },

    async deleteBlock(id: string) {
      // Resolve recurring instance to parent
      const parentId = id.includes("::") ? id.split("::")[0] : id;
      await execute("DELETE FROM calendar_events WHERE id = $1", [parentId]);
      rawBlocks = rawBlocks.filter((b) => b.id !== parentId);
      reexpand();
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

      // Create standalone event
      const newId = crypto.randomUUID();
      const timezone = parent.timezone || localTimezone();
      const notifJson = parent.notifications && parent.notifications.length > 0
        ? JSON.stringify(parent.notifications) : null;
      const gpD = parent.guestPermissions;
      await execute(
        `INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, notifications,
            all_day, location, url, transparency, status,
            visibility, priority, categories, geo,
            sequence, extended_properties, organizer,
            guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)`,
        [
          newId, instanceEvent.title,
          toDbTime(instanceEvent.start), toDbTime(instanceEvent.end),
          timezone, parent.calendarId,
          instanceEvent.color ?? null,
          instanceEvent.description ?? "",
          notifJson,
          parent.allDay ? 1 : 0,
          parent.location ?? "",
          parent.url ?? "",
          parent.transparency ?? "opaque",
          parent.status ?? "confirmed",
          parent.visibility ?? "public",
          parent.priority ?? null,
          parent.categories ? JSON.stringify(parent.categories) : null,
          parent.geo ? JSON.stringify(parent.geo) : null,
          parent.sequence ?? 0,
          parent.extendedProperties ? JSON.stringify(parent.extendedProperties) : null,
          parent.organizer ? JSON.stringify(parent.organizer) : null,
          gpD?.canModify ? 1 : 0,
          gpD?.canInviteOthers === false ? 0 : 1,
          gpD?.canSeeOtherGuests === false ? 0 : 1,
          now, now,
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

      // Copy attendees from parent
      if (parent.attendees && parent.attendees.length > 0) {
        const cloned = parent.attendees.map((a) => ({ ...a, id: crypto.randomUUID() }));
        await saveAttendees(newId, cloned);
      }

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
      const standalone: CalendarEvent = {
        ...instanceEvent,
        id: newId,
        timezone,
        calendarId: parent.calendarId,
        recurrence: undefined,
        recurringParentId: undefined,
        exceptions: undefined,
        pomodoroConfig: parent.pomodoroConfig,
        attendees: parent.attendees,
        guestPermissions: parent.guestPermissions,
      };
      rawBlocks = [...rawBlocks, standalone];
      reexpand();
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
      reexpand();
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
      reexpand();
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
      const gpS = parent.guestPermissions;
      await execute(
        `INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, rrule, notifications,
            all_day, location, url, transparency, status,
            visibility, priority, categories, geo,
            sequence, extended_properties, organizer,
            guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
        [
          newId, merged.title ?? parent.title,
          toDbTime(newStart),
          toDbTime(newEnd),
          parent.timezone, parent.calendarId,
          merged.color ?? null,
          merged.description ?? "",
          rrule,
          splitNotifJson,
          merged.allDay ? 1 : 0,
          merged.location ?? "",
          merged.url ?? "",
          merged.transparency ?? "opaque",
          merged.status ?? "confirmed",
          parent.visibility ?? "public",
          parent.priority ?? null,
          parent.categories ? JSON.stringify(parent.categories) : null,
          parent.geo ? JSON.stringify(parent.geo) : null,
          parent.sequence ?? 0,
          parent.extendedProperties ? JSON.stringify(parent.extendedProperties) : null,
          parent.organizer ? JSON.stringify(parent.organizer) : null,
          gpS?.canModify ? 1 : 0,
          gpS?.canInviteOthers === false ? 0 : 1,
          gpS?.canSeeOtherGuests === false ? 0 : 1,
          now, now,
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

      // Copy attendees from parent
      if (parent.attendees && parent.attendees.length > 0) {
        const cloned = parent.attendees.map((a) => ({ ...a, id: crypto.randomUUID() }));
        await saveAttendees(newId, cloned);
      }

      // Update in-memory state
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, recurrence: cappedRecurrence } : b,
      );
      const newTemplate: CalendarEvent = {
        ...parent,
        ...changes,
        id: newId,
        start: newStart,
        end: newEnd,
        recurrence: newRecurrence,
        recurringParentId: undefined,
        exceptions: undefined,
        pomodoroConfig: pomConfig,
        attendees: parent.attendees,
        guestPermissions: parent.guestPermissions,
      };
      rawBlocks = [...rawBlocks, newTemplate];
      reexpand();
      return newTemplate;
    },

    async clearAll() {
      await execute("DELETE FROM calendar_events");
      rawBlocks = [];
      blocks = [];
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
