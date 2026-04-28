import type { IcsParseResult } from "./types";

/**
 * Parse the text of a `.ics` file into a list of `CalendarEvent` rows ready
 * for upsert by `source_uid`. Warnings collect any fields that could not be
 * fully represented (unknown TZIDs, dropped alarm REPEAT/DURATION, etc.).
 *
 * Implementation lives in step 2 of the import/export plan; the signature is
 * stable so dependent UI code can be wired up without waiting on the body.
 *
 * @param text - Raw `.ics` file contents (RFC 5545).
 * @returns Parsed events plus a list of human-readable warnings.
 */
export function parseIcs(text: string): IcsParseResult {
	void text;
	return { events: [], warnings: [] };
}
