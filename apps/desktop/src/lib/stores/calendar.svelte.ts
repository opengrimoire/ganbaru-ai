import { execute, select } from "$lib/api/db";
import type { CalendarEvent } from "$lib/components/calendar/types";

interface DbSessionBlock {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  pomodoro_count: number;
}

function toCalendarDate(isoOrSqlite: string): string {
  // Handles both 'YYYY-MM-DD HH:MM:SS' (SQLite) and ISO 8601 strings
  return isoOrSqlite.substring(0, 16).replace("T", " ");
}

function toIsoString(calendarDate: string): string {
  return new Date(calendarDate.replace(" ", "T")).toISOString();
}

let blocks = $state<CalendarEvent[]>([]);

export function getCalendar() {
  return {
    get events(): CalendarEvent[] {
      return blocks;
    },

    async load() {
      const rows = await select<DbSessionBlock>(
        "SELECT id, title, start_time, end_time FROM session_blocks ORDER BY start_time ASC",
      );
      blocks = rows.map((r) => ({
        id: r.id,
        title: r.title,
        start: toCalendarDate(r.start_time),
        end: toCalendarDate(r.end_time),
      }));
    },

    async addBlock(
      title: string,
      start: string,
      end: string,
      existingId?: string,
    ): Promise<CalendarEvent> {
      const id = existingId ?? crypto.randomUUID();
      const now = new Date().toISOString();
      await execute(
        `INSERT INTO session_blocks (id, title, start_time, end_time, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, title, toIsoString(start), toIsoString(end), now, now],
      );
      const event: CalendarEvent = { id, title, start, end };
      blocks = [...blocks, event];
      return event;
    },

    async updateBlock(event: CalendarEvent) {
      const now = new Date().toISOString();
      await execute(
        `UPDATE session_blocks
         SET title = $1, start_time = $2, end_time = $3, updated_at = $4
         WHERE id = $5`,
        [
          event.title,
          toIsoString(String(event.start)),
          toIsoString(String(event.end)),
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
  };
}
