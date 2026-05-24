import { invoke } from "@tauri-apps/api/core";
import { dbUrl, ensureDbUrl } from "$lib/api/db";
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
  created_at: string;
  updated_at: string;
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function nowIso(): string {
  return new Date().toISOString();
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
      const rows = await invoke<DbCalendar[]>("calendar_list_calendars", { dbUrl: await ensureDbUrl() });
      calendars = rows.map(mapRow);
    },

    async toggleVisibility(id: string) {
      const cal = calendars.find((c) => c.id === id);
      if (!cal) return;
      await invoke("calendar_set_visibility", {
        dbUrl: dbUrl(),
        id,
        visible: !cal.visible,
        updatedAt: nowIso(),
      });
      calendars = calendars.map((c) =>
        c.id === id ? { ...c, visible: !c.visible } : c,
      );
    },

    async add(cal: Omit<Calendar, "id" | "visible" | "readOnly"> & { id?: string; visible?: boolean; readOnly?: boolean }): Promise<Calendar> {
      const id = cal.id ?? crypto.randomUUID();
      const now = nowIso();
      await invoke("calendar_add_calendar", {
        dbUrl: dbUrl(),
        calendar: {
          id,
          name: cal.name,
          color: cal.color,
          source: cal.source,
          visible: cal.visible ?? true,
          readOnly: cal.readOnly ?? false,
          sourceUrl: cal.sourceUrl ?? null,
          createdAt: now,
          updatedAt: now,
        },
      });
      const entry: Calendar = {
        id,
        name: cal.name,
        color: cal.color,
        source: cal.source,
        visible: cal.visible ?? true,
        readOnly: cal.readOnly ?? false,
        sourceUrl: cal.sourceUrl,
        lastSynced: cal.lastSynced,
        createdAt: now,
        updatedAt: now,
      };
      calendars = [...calendars, entry];
      return entry;
    },

    async remove(id: string) {
      await invoke("calendar_remove_calendar", { dbUrl: dbUrl(), id });
      calendars = calendars.filter((c) => c.id !== id);
    },

    /**
     * Find an existing imported calendar that originated from `filename`, or
     * create a new one. Used by the .ics import flow so that re-importing the
     * same file keeps a single calendar grouping (whose deletion cascades to
     * every event from that file).
     */
    async findOrCreateImported(filename: string): Promise<Calendar> {
      const row = await invoke<DbCalendar | null>("calendar_find_imported_calendar", {
        dbUrl: dbUrl(),
        filename,
      });
      if (row) {
        const cal = mapRow(row);
        if (!calendars.some((c) => c.id === cal.id)) {
          calendars = [...calendars, cal];
        }
        return cal;
      }
      const baseName = filename.replace(/\.ics$/i, "");
      return this.add({
        name: baseName,
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
      return invoke<number>("calendar_count_events", { dbUrl: dbUrl(), calendarId });
    },

    isReadOnly(calendarId: string): boolean {
      return calendars.find((c) => c.id === calendarId)?.readOnly ?? false;
    },
  };
}
