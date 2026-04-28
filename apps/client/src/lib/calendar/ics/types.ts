import type { CalendarEvent } from "$lib/components/calendar/types";

/**
 * Result of parsing a `.ics` file: events ready for upsert plus warnings about
 * fields that were lossy or skipped (unknown TZIDs, dropped alarm REPEAT, etc.).
 */
export interface IcsParseResult {
	events: CalendarEvent[];
	warnings: string[];
}

/**
 * Counters returned to the UI after a bulk import. Drives the toast message
 * `Imported N new, updated M, skipped K older revisions`.
 */
export interface IcsImportSummary {
	added: number;
	updated: number;
	skippedOlder: number;
	warnings: string[];
}
