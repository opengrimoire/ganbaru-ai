import { execute, select } from "$lib/api/db";
import type { Calendar } from "$lib/components/calendar/types";

interface DbCalendar {
  id: string;
  name: string;
  color: string;
  source: string;
  visible: number;
  read_only: number;
  source_url: string | null;
  last_synced: string | null;
}

function mapRow(r: DbCalendar): Calendar {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    source: r.source,
    visible: r.visible === 1,
    readOnly: r.read_only === 1,
    sourceUrl: r.source_url ?? undefined,
    lastSynced: r.last_synced ?? undefined,
  };
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

let calendars = $state<Calendar[]>([]);

export function getCalendars() {
  return {
    get list(): Calendar[] {
      return calendars;
    },

    get visibleIds(): Set<string> {
      return new Set(calendars.filter((c) => c.visible).map((c) => c.id));
    },

    async load() {
      const rows = await select<DbCalendar>(
        "SELECT id, name, color, source, visible, read_only, source_url, last_synced FROM calendars ORDER BY name ASC",
      );
      calendars = rows.map(mapRow);
    },

    async toggleVisibility(id: string) {
      const cal = calendars.find((c) => c.id === id);
      if (!cal) return;
      const newVisible = cal.visible ? 0 : 1;
      await execute(
        "UPDATE calendars SET visible = $1, updated_at = $2 WHERE id = $3",
        [newVisible, nowLocal(), id],
      );
      calendars = calendars.map((c) =>
        c.id === id ? { ...c, visible: !c.visible } : c,
      );
    },

    async add(cal: Omit<Calendar, "id" | "visible" | "readOnly"> & { id?: string; visible?: boolean; readOnly?: boolean }): Promise<Calendar> {
      const id = cal.id ?? crypto.randomUUID();
      const now = nowLocal();
      await execute(
        `INSERT INTO calendars
           (id, name, color, source, visible, read_only, source_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id, cal.name, cal.color, cal.source,
          (cal.visible ?? true) ? 1 : 0,
          (cal.readOnly ?? false) ? 1 : 0,
          cal.sourceUrl ?? null,
          now, now,
        ],
      );
      const entry: Calendar = {
        id,
        name: cal.name,
        color: cal.color,
        source: cal.source,
        visible: cal.visible ?? true,
        readOnly: cal.readOnly ?? false,
        sourceUrl: cal.sourceUrl,
        lastSynced: cal.lastSynced,
      };
      calendars = [...calendars, entry];
      return entry;
    },

    async remove(id: string) {
      await execute("DELETE FROM calendar_events WHERE calendar_id = $1", [id]);
      await execute("DELETE FROM calendars WHERE id = $1", [id]);
      calendars = calendars.filter((c) => c.id !== id);
    },

    /**
     * Find an existing imported calendar that originated from `filename`, or
     * create a new one. Used by the .ics import flow so that re-importing the
     * same file keeps a single calendar grouping (whose deletion cascades to
     * every event from that file).
     */
    async findOrCreateImported(filename: string): Promise<Calendar> {
      const rows = await select<DbCalendar>(
        "SELECT id, name, color, source, visible, read_only, source_url, last_synced FROM calendars WHERE source = 'ics' AND source_url = $1 LIMIT 1",
        [filename],
      );
      if (rows.length > 0) {
        const cal = mapRow(rows[0]);
        if (!calendars.some((c) => c.id === cal.id)) {
          calendars = [...calendars, cal];
        }
        return cal;
      }
      const today = new Date();
      const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const baseName = filename.replace(/\.ics$/i, "");
      return this.add({
        name: `Imported from ${baseName} (${stamp})`,
        color: "",
        source: "ics",
        sourceUrl: filename,
      });
    },

    /**
     * Count events in a calendar without loading their full rows (used by the
     * settings panel listing).
     */
    async countEvents(calendarId: string): Promise<number> {
      const rows = await select<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM calendar_events WHERE calendar_id = $1",
        [calendarId],
      );
      return rows[0]?.cnt ?? 0;
    },

    isReadOnly(calendarId: string): boolean {
      return calendars.find((c) => c.id === calendarId)?.readOnly ?? false;
    },
  };
}
