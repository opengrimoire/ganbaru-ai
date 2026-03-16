import { execute, select } from "$lib/api/db";
import type { CalendarEvent, EventColor, PomodoroConfig, RecurringScope, RepeatRule } from "$lib/components/calendar/types";
import { repeatRuleToRrule, rruleToRepeatRule } from "$lib/components/calendar/rrule";

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

    // Skip entirely if template's own date is past its repeat_until
    if (evt.repeatUntil && startDateStr > evt.repeatUntil) continue;

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
/** Snapshot of rawBlocks taken before editing, used to revert preview changes. */
let rawBlocksSnapshot: CalendarEvent[] | null = null;

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
    repeatRule: rruleToRepeatRule(r.rrule),
    notificationMinutes: r.notification_minutes ?? undefined,
    exceptions: r.exceptions ? JSON.parse(r.exceptions) as string[] : undefined,
    repeatUntil: r.repeat_until ?? undefined,
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

    async load() {
      console.log("[calendar] load() called");
      try {
        const rows = await select<DbCalendarEvent>(
          `SELECT ce.id, ce.title, ce.start_time, ce.end_time, ce.timezone,
                  ce.calendar_id, ce.color, ce.description, ce.rrule,
                  ce.notification_minutes, ce.exceptions, ce.repeat_until,
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
      repeatRule?: RepeatRule;
      notificationMinutes?: number;
      pomodoroConfig?: PomodoroConfig;
    }): Promise<CalendarEvent> {
      const id = opts.id ?? crypto.randomUUID();
      const now = nowLocal();
      const timezone = localTimezone();
      const rrule = opts.repeatRule && opts.repeatRule !== "none"
        ? repeatRuleToRrule(opts.repeatRule)
        : null;
      await execute(
        `INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, rrule, notification_minutes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [id, opts.title, toDbTime(opts.start), toDbTime(opts.end),
         timezone, "local", opts.color ?? null, opts.description ?? "",
         rrule, opts.notificationMinutes ?? null, now, now],
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
        repeatRule: opts.repeatRule, notificationMinutes: opts.notificationMinutes,
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
      const rrule = toUpdate.repeatRule && toUpdate.repeatRule !== "none"
        ? repeatRuleToRrule(toUpdate.repeatRule)
        : null;
      await execute(
        `UPDATE calendar_events
         SET title = $1, start_time = $2, end_time = $3,
             color = $4, description = $5,
             rrule = $6, notification_minutes = $7,
             updated_at = $8
         WHERE id = $9`,
        [
          toUpdate.title,
          toDbTime(String(toUpdate.start)),
          toDbTime(String(toUpdate.end)),
          toUpdate.color ?? null,
          toUpdate.description ?? "",
          rrule,
          toUpdate.notificationMinutes ?? null,
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
      await execute(
        `INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, notification_minutes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          newId, instanceEvent.title,
          toDbTime(instanceEvent.start), toDbTime(instanceEvent.end),
          timezone, parent.calendarId,
          instanceEvent.color ?? null,
          instanceEvent.description ?? "",
          instanceEvent.notificationMinutes ?? null,
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
        repeatRule: undefined,
        recurringParentId: undefined,
        exceptions: undefined,
        repeatUntil: undefined,
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
      if (!parent) return;

      const now = nowLocal();
      await execute(
        `UPDATE calendar_events SET repeat_until = $1, updated_at = $2 WHERE id = $3`,
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
      const newStartDateStr = changes.start
        ? String(changes.start).split(" ")[0]
        : splitDate;
      // Cap old series before the earlier of instance date and new start date
      const capDate = newStartDateStr < splitDate ? newStartDateStr : splitDate;
      const capBefore = parseYMD(capDate);
      capBefore.setDate(capBefore.getDate() - 1);
      const dayBefore = fmtYMD(capBefore);
      const now = nowLocal();

      // Set repeat_until on original template
      await execute(
        `UPDATE calendar_events SET repeat_until = $1, updated_at = $2 WHERE id = $3`,
        [dayBefore, now, parentId],
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
      const rrule = parent.repeatRule && parent.repeatRule !== "none"
        ? repeatRuleToRrule(parent.repeatRule)
        : null;

      await execute(
        `INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, rrule, notification_minutes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          newId, merged.title ?? parent.title,
          toDbTime(newStart),
          toDbTime(newEnd),
          parent.timezone, parent.calendarId,
          merged.color ?? null,
          merged.description ?? "",
          rrule,
          merged.notificationMinutes ?? null,
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
        b.id === parentId ? { ...b, repeatUntil: dayBefore } : b,
      );
      const newTemplate: CalendarEvent = {
        ...parent,
        ...changes,
        id: newId,
        start: newStart,
        end: newEnd,
        recurringParentId: undefined,
        exceptions: undefined,
        repeatUntil: undefined,
        pomodoroConfig: pomConfig,
      };
      rawBlocks = [...rawBlocks, newTemplate];
      reexpand();
      return newTemplate;
    },

    /** Save a snapshot of rawBlocks before editing for preview revert. */
    saveSnapshot() {
      rawBlocksSnapshot = rawBlocks.map((b) => ({ ...b }));
    },

    /** Revert rawBlocks from snapshot and re-expand. */
    restoreSnapshot() {
      if (rawBlocksSnapshot) {
        rawBlocks = rawBlocksSnapshot;
        rawBlocksSnapshot = null;
        reexpand();
      }
    },

    /** Discard snapshot without reverting (after successful DB write). */
    discardSnapshot() {
      rawBlocksSnapshot = null;
    },

    /**
     * Preview a recurring event edit in-memory under the given scope.
     * Always resets from snapshot first so switching scopes doesn't stack.
     */
    previewRecurring(
      instanceEvent: CalendarEvent,
      changes: Partial<CalendarEvent>,
      scope: RecurringScope,
    ) {
      if (!rawBlocksSnapshot) return;
      // Reset from snapshot
      rawBlocks = rawBlocksSnapshot.map((b) => ({ ...b }));

      const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
      const template = rawBlocks.find((b) => b.id === parentId);
      if (!template) { reexpand(); return; }

      const instanceDate = instanceEvent.start.split(" ")[0];

      if (scope === "this") {
        // Add exception to hide this instance, inject standalone preview
        const exceptions = [...(template.exceptions ?? []), instanceDate];
        rawBlocks = rawBlocks.map((b) =>
          b.id === parentId ? { ...b, exceptions } : b,
        );
        const preview: CalendarEvent = {
          ...instanceEvent,
          ...changes,
          id: `preview::${instanceDate}`,
          start: changes.start ?? instanceEvent.start,
          end: changes.end ?? instanceEvent.end,
          recurringParentId: undefined,
          repeatRule: undefined,
          exceptions: undefined,
          repeatUntil: undefined,
        };
        rawBlocks = [...rawBlocks, preview];
      } else if (scope === "all") {
        // Shift template dates by the day delta between original instance and changes
        const origDateStr = instanceDate;
        const changesDateStr = changes.start ? String(changes.start).split(" ")[0] : origDateStr;
        const deltaDays = Math.round(
          (parseYMD(changesDateStr).getTime() - parseYMD(origDateStr).getTime()) / 86400000,
        );
        const newStartTime = changes.start ? String(changes.start).split(" ")[1] : instanceEvent.start.split(" ")[1];
        const newEndTime = changes.end ? String(changes.end).split(" ")[1] : instanceEvent.end.split(" ")[1];
        let newStartDate = template.start.split(" ")[0];
        let newEndDate = template.end.split(" ")[0];
        if (deltaDays !== 0) {
          const sd = parseYMD(newStartDate);
          sd.setDate(sd.getDate() + deltaDays);
          newStartDate = fmtYMD(sd);
          const ed = parseYMD(newEndDate);
          ed.setDate(ed.getDate() + deltaDays);
          newEndDate = fmtYMD(ed);
        }
        rawBlocks = rawBlocks.map((b) =>
          b.id === parentId ? {
            ...template, ...changes,
            id: template.id,
            start: `${newStartDate} ${newStartTime}`,
            end: `${newEndDate} ${newEndTime}`,
            recurringParentId: undefined,
          } : b,
        );
      } else {
        // "following": cap old series before the earlier of instance date and new start date
        const newStartDateStr = changes.start
          ? String(changes.start).split(" ")[0]
          : instanceDate;
        const capDate = newStartDateStr < instanceDate ? newStartDateStr : instanceDate;
        const capBefore = parseYMD(capDate);
        capBefore.setDate(capBefore.getDate() - 1);
        const dayBefore = fmtYMD(capBefore);
        rawBlocks = rawBlocks.map((b) =>
          b.id === parentId ? { ...b, repeatUntil: dayBefore } : b,
        );
        const newStart = changes.start
          ? String(changes.start)
          : `${instanceDate} ${instanceEvent.start.split(" ")[1]}`;
        const newEnd = changes.end
          ? String(changes.end)
          : `${instanceDate} ${instanceEvent.end.split(" ")[1]}`;
        const newTemplate: CalendarEvent = {
          ...template,
          ...changes,
          id: `preview-following::${instanceDate}`,
          start: newStart,
          end: newEnd,
          recurringParentId: undefined,
          exceptions: undefined,
          repeatUntil: undefined,
        };
        rawBlocks = [...rawBlocks, newTemplate];
      }

      reexpand();
    },

    async clearAll() {
      await execute("DELETE FROM calendar_events");
      rawBlocks = [];
      blocks = [];
    },
  };
}
