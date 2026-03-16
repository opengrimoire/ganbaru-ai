import { execute, select } from "$lib/api/db";
import type { CalendarEvent, EventColor, RepeatRule } from "$lib/components/calendar/types";

interface DbSessionBlock {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  pomodoro_count: number;
  focus_duration_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  color: string | null;
  description: string;
  repeat_rule: string | null;
  notification_minutes: number | null;
  exceptions: string | null;
  repeat_until: string | null;
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

// --- Recurrence helpers ---

function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmtYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function advanceDate(from: Date, rule: RepeatRule): Date {
  const d = new Date(from);
  switch (rule) {
    case "daily":
      d.setDate(d.getDate() + 1);
      return d;
    case "weekdays":
      do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
      return d;
    case "weekly":
      d.setDate(d.getDate() + 7);
      return d;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      return d;
    case "yearly":
      d.setFullYear(d.getFullYear() + 1);
      return d;
    default:
      return d;
  }
}

const EXPANSION_DAYS = 180;
const MAX_INSTANCES = 500;

function expandRecurring(templates: CalendarEvent[]): CalendarEvent[] {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + EXPANSION_DAYS);

  const result: CalendarEvent[] = [];

  for (const evt of templates) {
    const startDateStr = evt.start.split(" ")[0];

    // Skip template's own date if it was detached into a standalone event
    if (!evt.exceptions?.includes(startDateStr)) {
      result.push(evt);
    }
    if (!evt.repeatRule || evt.repeatRule === "none") continue;
    const startTimeStr = evt.start.split(" ")[1];
    const endDateStr = evt.end.split(" ")[0];
    const endTimeStr = evt.end.split(" ")[1];
    const origStart = parseYMD(startDateStr);
    const origEnd = parseYMD(endDateStr);
    const daySpan = Math.round((origEnd.getTime() - origStart.getTime()) / 86400000);

    const exceptionsSet = evt.exceptions ? new Set(evt.exceptions) : null;

    let cursor = advanceDate(origStart, evt.repeatRule);
    let count = 0;

    while (cursor <= horizon && count < MAX_INSTANCES) {
      const occStartStr = fmtYMD(cursor);

      // Stop if past repeat_until date
      if (evt.repeatUntil && occStartStr > evt.repeatUntil) break;

      // Skip exception dates
      if (exceptionsSet?.has(occStartStr)) {
        cursor = advanceDate(cursor, evt.repeatRule);
        continue;
      }

      const occEndDate = new Date(cursor);
      occEndDate.setDate(occEndDate.getDate() + daySpan);
      const occEndStr = fmtYMD(occEndDate);

      result.push({
        ...evt,
        id: `${evt.id}::${occStartStr}`,
        start: `${occStartStr} ${startTimeStr}`,
        end: `${occEndStr} ${endTimeStr}`,
        recurringParentId: evt.id,
      });

      cursor = advanceDate(cursor, evt.repeatRule);
      count++;
    }
  }

  return result;
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

export function getCalendar() {
  return {
    get events(): CalendarEvent[] {
      return blocks;
    },

    async load() {
      console.log("[calendar] load() called");
      try {
        const rows = await select<DbSessionBlock>(
          `SELECT id, title, start_time, end_time, pomodoro_count,
                  focus_duration_minutes, short_break_minutes, long_break_minutes,
                  color, description, repeat_rule, notification_minutes,
                  exceptions, repeat_until
           FROM session_blocks ORDER BY start_time ASC`,
        );
        console.log(`[calendar] loaded ${rows.length} blocks from DB`, rows);
        rawBlocks = rows.map((r) => ({
          id: r.id,
          title: r.title,
          start: toCalendarDate(r.start_time),
          end: toCalendarDate(r.end_time),
          pomodoroCount: r.pomodoro_count,
          focusDurationMinutes: r.focus_duration_minutes,
          shortBreakMinutes: r.short_break_minutes,
          longBreakMinutes: r.long_break_minutes,
          color: (r.color as EventColor) ?? undefined,
          description: r.description || undefined,
          repeatRule: (r.repeat_rule as RepeatRule) ?? undefined,
          notificationMinutes: r.notification_minutes ?? undefined,
          exceptions: r.exceptions ? JSON.parse(r.exceptions) as string[] : undefined,
          repeatUntil: r.repeat_until ?? undefined,
        }));
        reexpand();
        console.log(`[calendar] blocks set, count: ${blocks.length} (${rawBlocks.length} templates)`);
      } catch (e) {
        console.error("[calendar] load() failed:", e);
        throw e;
      }
    },

    async addBlock(
      title: string,
      start: string,
      end: string,
      existingId?: string,
      color?: EventColor,
      description?: string,
      repeatRule?: RepeatRule,
      notificationMinutes?: number,
    ): Promise<CalendarEvent> {
      const id = existingId ?? crypto.randomUUID();
      const now = nowLocal();
      await execute(
        `INSERT INTO session_blocks (id, title, start_time, end_time, focus_duration_minutes, short_break_minutes, long_break_minutes, color, description, repeat_rule, notification_minutes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 40, 5, 10, $5, $6, $7, $8, $9, $10)`,
        [id, title, toDbTime(start), toDbTime(end), color ?? null, description ?? "",
         repeatRule && repeatRule !== "none" ? repeatRule : null,
         notificationMinutes ?? null, now, now],
      );
      const event: CalendarEvent = { id, title, start, end, color, description, repeatRule, notificationMinutes };
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
      await execute(
        `UPDATE session_blocks
         SET title = $1, start_time = $2, end_time = $3,
             color = $4, description = $5,
             focus_duration_minutes = $6, short_break_minutes = $7, long_break_minutes = $8,
             repeat_rule = $9, notification_minutes = $10,
             updated_at = $11
         WHERE id = $12`,
        [
          toUpdate.title,
          toDbTime(String(toUpdate.start)),
          toDbTime(String(toUpdate.end)),
          toUpdate.color ?? null,
          toUpdate.description ?? "",
          toUpdate.focusDurationMinutes ?? 40,
          toUpdate.shortBreakMinutes ?? 5,
          toUpdate.longBreakMinutes ?? 10,
          toUpdate.repeatRule && toUpdate.repeatRule !== "none" ? toUpdate.repeatRule : null,
          toUpdate.notificationMinutes ?? null,
          now,
          parentId,
        ],
      );
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, ...toUpdate, id: parentId } : b,
      );
      reexpand();
    },

    /** Update in-memory only (no DB write) for live preview. */
    previewBlock(event: CalendarEvent) {
      const parentId = event.recurringParentId ?? event.id;
      if (event.recurringParentId) {
        const template = rawBlocks.find((b) => b.id === parentId);
        if (template) {
          const merged = mergeIntoTemplate(template, event);
          rawBlocks = rawBlocks.map((b) =>
            b.id === parentId ? merged : b,
          );
        }
      } else {
        rawBlocks = rawBlocks.map((b) =>
          b.id === event.id ? { ...b, ...event } : b,
        );
      }
      reexpand();
    },

    async deleteBlock(id: string) {
      // Resolve recurring instance to parent
      const parentId = id.includes("::") ? id.split("::")[0] : id;
      await execute("DELETE FROM session_blocks WHERE id = $1", [parentId]);
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
        `UPDATE session_blocks SET exceptions = $1, updated_at = $2 WHERE id = $3`,
        [JSON.stringify(exceptions), now, parentId],
      );

      // Create standalone event
      const newId = crypto.randomUUID();
      await execute(
        `INSERT INTO session_blocks (id, title, start_time, end_time, focus_duration_minutes, short_break_minutes, long_break_minutes, color, description, notification_minutes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          newId, instanceEvent.title,
          toDbTime(instanceEvent.start), toDbTime(instanceEvent.end),
          instanceEvent.focusDurationMinutes ?? 40,
          instanceEvent.shortBreakMinutes ?? 5,
          instanceEvent.longBreakMinutes ?? 10,
          instanceEvent.color ?? null,
          instanceEvent.description ?? "",
          instanceEvent.notificationMinutes ?? null,
          now, now,
        ],
      );

      // Update in-memory state
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, exceptions } : b,
      );
      const standalone: CalendarEvent = {
        ...instanceEvent,
        id: newId,
        repeatRule: undefined,
        recurringParentId: undefined,
        exceptions: undefined,
        repeatUntil: undefined,
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
        `UPDATE session_blocks SET exceptions = $1, updated_at = $2 WHERE id = $3`,
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
      if (!parent) return;

      const now = nowLocal();
      await execute(
        `UPDATE session_blocks SET repeat_until = $1, updated_at = $2 WHERE id = $3`,
        [date, now, parentId],
      );
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, repeatUntil: date } : b,
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
      const dayBefore = fmtYMD(
        new Date(parseYMD(splitDate).getTime() - 86400000),
      );
      const now = nowLocal();

      // Set repeat_until on original template
      await execute(
        `UPDATE session_blocks SET repeat_until = $1, updated_at = $2 WHERE id = $3`,
        [dayBefore, now, parentId],
      );

      // Create new recurring template from split date
      const newId = crypto.randomUUID();
      const startTime = instanceEvent.start.split(" ")[1];
      const endTime = instanceEvent.end.split(" ")[1];
      const merged = { ...parent, ...changes };

      await execute(
        `INSERT INTO session_blocks (id, title, start_time, end_time, focus_duration_minutes, short_break_minutes, long_break_minutes, color, description, repeat_rule, notification_minutes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          newId, merged.title ?? parent.title,
          toDbTime(`${splitDate} ${startTime}`),
          toDbTime(`${splitDate} ${endTime}`),
          merged.focusDurationMinutes ?? 40,
          merged.shortBreakMinutes ?? 5,
          merged.longBreakMinutes ?? 10,
          merged.color ?? null,
          merged.description ?? "",
          parent.repeatRule && parent.repeatRule !== "none" ? parent.repeatRule : null,
          merged.notificationMinutes ?? null,
          now, now,
        ],
      );

      // Update in-memory state
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, repeatUntil: dayBefore } : b,
      );
      const newTemplate: CalendarEvent = {
        ...parent,
        ...changes,
        id: newId,
        start: `${splitDate} ${startTime}`,
        end: `${splitDate} ${endTime}`,
        recurringParentId: undefined,
        exceptions: undefined,
        repeatUntil: undefined,
      };
      rawBlocks = [...rawBlocks, newTemplate];
      reexpand();
      return newTemplate;
    },

    async clearAll() {
      await execute("DELETE FROM session_blocks");
      rawBlocks = [];
      blocks = [];
    },
  };
}
