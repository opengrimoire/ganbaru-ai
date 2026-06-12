import { invoke } from "@tauri-apps/api/core";
import type { Calendar, CalendarEvent } from "$lib/components/calendar/types";
import type { IcsImportSummary, IcsPreservationPayload } from "$lib/calendar/ics/types";
import { calendarDisplayName } from "$lib/calendar/calendar-display";
import { dbUrl } from "$lib/api/db";
import { safeJsonParse } from "./map-row";
import {
  buildBulkImportPayload,
  type CalendarBulkImportResult,
  type CalendarImportSourceKind,
} from "./calendar-bulk-import";
import { localTimezone, nowIso } from "./calendar-event-payloads";
import type { CalendarIcalendarExportMetadata } from "./calendar-event-hydration";

export interface CalendarBulkImportOptions {
  refreshWindow?: boolean;
  preservation?: IcsPreservationPayload | null;
  sourceName?: string;
  sourceKind?: CalendarImportSourceKind;
}

export interface CalendarBulkImportStoreResult {
  summary: IcsImportSummary;
  applied: boolean;
  added: number;
  refreshWindow: boolean;
}

export async function bulkImportCalendarEvents(
  events: CalendarEvent[],
  targetCalendarId: string,
  opts: CalendarBulkImportOptions = {},
): Promise<CalendarBulkImportStoreResult> {
  const now = nowIso();
  const fallbackZone = localTimezone();
  const payload = buildBulkImportPayload(
    events,
    targetCalendarId,
    now,
    fallbackZone,
    () => crypto.randomUUID(),
    opts.preservation ?? null,
    opts.sourceName ?? "",
    opts.sourceKind ?? "import-file",
  );
  const result = await invoke<CalendarBulkImportResult>("calendar_bulk_import", {
    dbUrl: dbUrl(),
    payload,
  });

  return {
    summary: {
      added: result.added,
      updated: result.updated,
      skippedOlder: result.skippedOlder,
      warnings: result.warnings,
    },
    applied: result.applied.length > 0,
    added: result.added,
    refreshWindow: opts.refreshWindow ?? true,
  };
}

export async function exportCalendarAsIcs(
  calendar: Calendar,
  loadFullEvent: (id: string) => Promise<CalendarEvent | undefined>,
): Promise<string> {
  const ids = await invoke<string[]>("calendar_list_event_ids_for_calendar", {
    dbUrl: dbUrl(),
    calendarId: calendar.id,
  });
  const full = await Promise.all(ids.map((id) => loadFullEvent(id)));
  const calendarEvents = full.filter((event): event is CalendarEvent => event !== undefined);
  const preservedTimezoneRows = await invoke<string[]>(
    "calendar_load_icalendar_timezones_for_calendar",
    {
      dbUrl: dbUrl(),
      calendarId: calendar.id,
    },
  );
  const preservedTimezones = preservedTimezoneRows
    .map((row) => safeJsonParse<unknown>(row))
    .filter((row): row is unknown => row !== undefined);
  const preservedPassthroughRows = await invoke<string[]>(
    "calendar_load_icalendar_passthrough_components_for_calendar",
    {
      dbUrl: dbUrl(),
      calendarId: calendar.id,
    },
  );
  const preservedPassthroughComponents = preservedPassthroughRows
    .map((row) => safeJsonParse<unknown>(row))
    .filter((row): row is unknown => row !== undefined);
  const preservedExportMetadata = await invoke<CalendarIcalendarExportMetadata>(
    "calendar_load_icalendar_export_metadata_for_calendar",
    {
      dbUrl: dbUrl(),
      calendarId: calendar.id,
    },
  );
  if (preservedExportMetadata.mixed_methods) {
    console.warn(
      "iCalendar export used METHOD:PUBLISH because this calendar contains mixed preserved METHOD values.",
    );
  }
  const { serializeCalendarToIcs } = await import("$lib/calendar/ics/serializer");
  return serializeCalendarToIcs(
    { ...calendar, name: calendarDisplayName(calendar) },
    calendarEvents,
    undefined,
    preservedTimezones,
    preservedPassthroughComponents,
    preservedExportMetadata.method ?? undefined,
  );
}
