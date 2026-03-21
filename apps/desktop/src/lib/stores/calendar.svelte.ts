import { execute, select } from "$lib/api/db";
import type { CalendarEvent, EventColor, PomodoroConfig, RecurrenceConfig } from "$lib/components/calendar/types";
import { recurrenceToRrule, rruleToRecurrence } from "$lib/components/calendar/rrule";
import { expandRecurring, parseYMD, fmtYMD } from "$lib/components/calendar/recurrence";

export { expandRecurring, parseYMD, fmtYMD };

interface DbCalendarEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  timezone: string;
  calendar_id: string;
  color: string | null;
  description: string;
  rrule: string | null;
  notification_minutes: number | null;
  notifications: string | null;
  exceptions: string | null;
  repeat_until: string | null;
  // LEFT JOIN pomodoro_configs
  focus_duration_minutes: number | null;
  short_break_minutes: number | null;
  long_break_minutes: number | null;
  pomodoro_count: number | null;
}

function toCalendarDate(dbTime: string): string {
  return dbTime.substring(0, 16).replace("T", " ");
}

function toDbTime(calendarDate: string): string {
  return calendarDate + ":00";
}

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

// --- Store ---

/** DB-backed template events (no virtual instances). */
let rawBlocks = $state<CalendarEvent[]>([]);
/** Expanded events including virtual recurring instances. */
let blocks = $state<CalendarEvent[]>([]);
function reexpand() {
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

function mapRow(r: DbCalendarEvent): CalendarEvent {
  return {
    id: r.id,
    title: r.title,
    start: toCalendarDate(r.start_time),
    end: toCalendarDate(r.end_time),
    timezone: r.timezone,
    calendarId: r.calendar_id,
    color: (r.color as EventColor) ?? undefined,
    description: r.description || undefined,
    recurrence: r.rrule ? rruleToRecurrence(r.rrule, r.repeat_until ?? undefined) : undefined,
    notifications: r.notifications
      ? JSON.parse(r.notifications) as number[]
      : r.notification_minutes != null ? [r.notification_minutes] : undefined,
    exceptions: r.exceptions ? JSON.parse(r.exceptions) as string[] : undefined,
    pomodoroConfig: r.focus_duration_minutes != null ? {
      focusDurationMinutes: r.focus_duration_minutes,
      shortBreakMinutes: r.short_break_minutes!,
      longBreakMinutes: r.long_break_minutes!,
      pomodoroCount: r.pomodoro_count!,
    } : undefined,
  };
}

export function getCalendar() {
  return {
    get events(): CalendarEvent[] {
      return blocks;
    },

    get rawBlocks(): CalendarEvent[] {
      return rawBlocks;
    },

    async load() {
      console.log("[calendar] load() called");
      try {
        const rows = await select<DbCalendarEvent>(
          `SELECT ce.id, ce.title, ce.start_time, ce.end_time, ce.timezone,
                  ce.calendar_id, ce.color, ce.description, ce.rrule,
                  ce.notification_minutes, ce.notifications, ce.exceptions, ce.repeat_until,
                  pc.focus_duration_minutes, pc.short_break_minutes,
                  pc.long_break_minutes, pc.pomodoro_count
           FROM calendar_events ce
           LEFT JOIN pomodoro_configs pc ON pc.event_id = ce.id
           ORDER BY ce.start_time ASC`,
        );
        console.log(`[calendar] loaded ${rows.length} blocks from DB`, rows);
        rawBlocks = rows.map(mapRow);
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
      color?: EventColor;
      description?: string;
      recurrence?: RecurrenceConfig;
      notifications?: number[];
      pomodoroConfig?: PomodoroConfig;
    }): Promise<CalendarEvent> {
      const id = opts.id ?? crypto.randomUUID();
      const now = nowLocal();
      const timezone = localTimezone();
      const rrule = opts.recurrence ? recurrenceToRrule(opts.recurrence) : null;
      const repeatUntil = opts.recurrence?.end.type === "until"
        ? opts.recurrence.end.date : null;
      const notifJson = opts.notifications && opts.notifications.length > 0
        ? JSON.stringify(opts.notifications) : null;
      await execute(
        `INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, rrule, notifications, repeat_until,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [id, opts.title, toDbTime(opts.start), toDbTime(opts.end),
         timezone, "local", opts.color ?? null, opts.description ?? "",
         rrule, notifJson, repeatUntil, now, now],
      );
      if (opts.pomodoroConfig) {
        await execute(
          `INSERT INTO pomodoro_configs
             (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, opts.pomodoroConfig.focusDurationMinutes, opts.pomodoroConfig.shortBreakMinutes,
           opts.pomodoroConfig.longBreakMinutes, opts.pomodoroConfig.pomodoroCount],
        );
      }
      const event: CalendarEvent = {
        id, title: opts.title, start: opts.start, end: opts.end,
        timezone, calendarId: "local",
        color: opts.color, description: opts.description,
        recurrence: opts.recurrence, notifications: opts.notifications,
        pomodoroConfig: opts.pomodoroConfig,
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

      const now = nowLocal();
      const rrule = toUpdate.recurrence ? recurrenceToRrule(toUpdate.recurrence) : null;
      const repeatUntil = toUpdate.recurrence?.end.type === "until"
        ? toUpdate.recurrence.end.date : null;
      const notifJson = toUpdate.notifications && toUpdate.notifications.length > 0
        ? JSON.stringify(toUpdate.notifications) : null;
      await execute(
        `UPDATE calendar_events
         SET title = $1, start_time = $2, end_time = $3,
             color = $4, description = $5,
             rrule = $6, notifications = $7,
             repeat_until = $8, updated_at = $9
         WHERE id = $10`,
        [
          toUpdate.title,
          toDbTime(String(toUpdate.start)),
          toDbTime(String(toUpdate.end)),
          toUpdate.color ?? null,
          toUpdate.description ?? "",
          rrule,
          notifJson,
          repeatUntil,
          now,
          parentId,
        ],
      );
      if (toUpdate.pomodoroConfig) {
        await execute(
          `INSERT OR REPLACE INTO pomodoro_configs
             (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [parentId, toUpdate.pomodoroConfig.focusDurationMinutes,
           toUpdate.pomodoroConfig.shortBreakMinutes,
           toUpdate.pomodoroConfig.longBreakMinutes,
           toUpdate.pomodoroConfig.pomodoroCount],
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
      await execute(
        `INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, notifications, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          newId, instanceEvent.title,
          toDbTime(instanceEvent.start), toDbTime(instanceEvent.end),
          timezone, parent.calendarId,
          instanceEvent.color ?? null,
          instanceEvent.description ?? "",
          notifJson,
          now, now,
        ],
      );
      if (parent.pomodoroConfig) {
        await execute(
          `INSERT INTO pomodoro_configs
             (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [newId, parent.pomodoroConfig.focusDurationMinutes,
           parent.pomodoroConfig.shortBreakMinutes,
           parent.pomodoroConfig.longBreakMinutes,
           parent.pomodoroConfig.pomodoroCount],
        );
      }

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
      await execute(
        `INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, rrule, notifications, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          newId, merged.title ?? parent.title,
          toDbTime(newStart),
          toDbTime(newEnd),
          parent.timezone, parent.calendarId,
          merged.color ?? null,
          merged.description ?? "",
          rrule,
          splitNotifJson,
          now, now,
        ],
      );

      const pomConfig = merged.pomodoroConfig ?? parent.pomodoroConfig;
      if (pomConfig) {
        await execute(
          `INSERT INTO pomodoro_configs
             (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [newId, pomConfig.focusDurationMinutes, pomConfig.shortBreakMinutes,
           pomConfig.longBreakMinutes, pomConfig.pomodoroCount],
        );
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
  };
}
