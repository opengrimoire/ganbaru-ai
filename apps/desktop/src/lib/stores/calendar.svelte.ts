import { execute, select } from "$lib/api/db";
import type { CalendarEvent } from "$lib/components/calendar/types";

interface DbSessionBlock {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  pomodoro_count: number;
  focus_duration_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
}

function toCalendarDate(dbTime: string): string {
  // "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS..." → "YYYY-MM-DD HH:MM"
  return dbTime.substring(0, 16).replace("T", " ");
}

function toDbTime(calendarDate: string): string {
  // "YYYY-MM-DD HH:MM" → "YYYY-MM-DD HH:MM:00" (local time, no timezone conversion)
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

let blocks = $state<CalendarEvent[]>([]);

export function getCalendar() {
  return {
    get events(): CalendarEvent[] {
      return blocks;
    },

    async load() {
      const rows = await select<DbSessionBlock>(
        `SELECT id, title, start_time, end_time, pomodoro_count,
                focus_duration_minutes, short_break_minutes, long_break_minutes
         FROM session_blocks ORDER BY start_time ASC`,
      );
      blocks = rows.map((r) => ({
        id: r.id,
        title: r.title,
        start: toCalendarDate(r.start_time),
        end: toCalendarDate(r.end_time),
        pomodoroCount: r.pomodoro_count,
        focusDurationMinutes: r.focus_duration_minutes,
        shortBreakMinutes: r.short_break_minutes,
        longBreakMinutes: r.long_break_minutes,
      }));
    },

    async addBlock(
      title: string,
      start: string,
      end: string,
      existingId?: string,
    ): Promise<CalendarEvent> {
      const id = existingId ?? crypto.randomUUID();
      const now = nowLocal();
      await execute(
        `INSERT INTO session_blocks (id, title, start_time, end_time, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, title, toDbTime(start), toDbTime(end), now, now],
      );
      const event: CalendarEvent = { id, title, start, end };
      blocks = [...blocks, event];
      return event;
    },

    async updateBlock(event: CalendarEvent) {
      const now = nowLocal();
      await execute(
        `UPDATE session_blocks
         SET title = $1, start_time = $2, end_time = $3, updated_at = $4
         WHERE id = $5`,
        [
          event.title,
          toDbTime(String(event.start)),
          toDbTime(String(event.end)),
          now,
          String(event.id),
        ],
      );
      blocks = blocks.map((b) =>
        b.id === event.id ? { ...b, ...event } : b,
      );
    },

    async deleteBlock(id: string) {
      await execute("DELETE FROM session_blocks WHERE id = $1", [id]);
      blocks = blocks.filter((b) => b.id !== id);
    },

    async clearAll() {
      await execute("DELETE FROM session_blocks");
      blocks = [];
    },
  };
}
