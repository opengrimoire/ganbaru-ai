/**
 * One-shot boot-time migration that rewrites legacy calendar event times
 * (naive wall-clock "YYYY-MM-DD HH:MM:SS" strings interpreted as device
 * local) into UTC ISO 8601 with a Z suffix, and populates the `timezone`
 * column with the device's IANA zone.
 *
 * The SQL migration v8 (in src-tauri/src/db.rs) already backfills empty
 * timezone columns to 'UTC' so the parser cannot trip over a row written
 * before the column had a meaning. This hydrator does the actual wall-clock
 * rewrite, which cannot run in pure SQL because SQLite has no IANA tz
 * database.
 *
 * Idempotency: a marker preference (`preferences.calendarTimezoneMigratedV8`)
 * is set to true on success. Subsequent boots short-circuit. The marker
 * lives in vault/config.json so it survives DB rebuilds during dev.
 *
 * Mirrors the `hydrateUserThemes` pattern from theme.svelte.ts — runs in
 * main.ts after `ensureConfigLoaded()` and before the App component imports
 * any calendar code.
 */

import { invoke } from "@tauri-apps/api/core";
import { dbUrl, select } from "$lib/api/db";
import { flushConfig, getConfigKey, setConfigKey } from "$lib/vault/config";

const MIGRATION_MARKER_KEY = "preferences.calendarTimezoneMigratedV8";

interface LegacyEventRow {
  id: string;
  start_time: string;
  end_time: string;
  timezone: string;
  all_day: number;
}

interface LegacyOverrideRow {
  id: string;
  recurrence_id: string;
  start_time: string | null;
  end_time: string | null;
  parent_event_id: string;
}

interface ParentZoneRow {
  id: string;
  timezone: string;
  all_day: number;
}

interface EventTimezoneHydration {
  id: string;
  startTime: string;
  endTime: string;
  timezone: string;
}

interface OverrideTimezoneHydration {
  id: string;
  recurrenceId: string;
  startTime: string | null;
  endTime: string | null;
}

/**
 * Detect a legacy wall-clock string. Migrated values either end in `Z`
 * (UTC instant) or contain `+`/`-` after the date portion (offset). All-day
 * date-only strings ("YYYY-MM-DD") are also treated as already-migrated
 * because they are floating in the new model.
 */
function isLegacyWallClock(value: string): boolean {
  if (!value) return false;
  if (value.endsWith("Z")) return false;
  // "YYYY-MM-DD" only (10 chars) is floating, leave alone.
  if (value.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Look for an offset (+HH:MM or -HH:MM) after the date portion.
  const offsetMatch = value.slice(10).match(/[+\-]\d{2}:?\d{2}$/);
  if (offsetMatch) return false;
  return true;
}

/**
 * Convert a legacy "YYYY-MM-DD HH:MM:SS" (or "YYYY-MM-DDTHH:MM:SS") wall
 * clock interpreted in `homeZone` to a UTC ISO 8601 instant with Z suffix.
 * Uses `Temporal.ZonedDateTime` "compatible" disambiguation, which matches
 * RFC 5545 expectations: in fall-back ambiguity (1:30 AM happening twice)
 * pick the earlier instant, in spring-forward gaps shift forward by the gap.
 */
function legacyToUtcIso(legacy: string, homeZone: string): string {
  // Normalize separator: PlainDateTime.from accepts both "T" and " ".
  const normalized = legacy.includes("T") ? legacy : legacy.replace(" ", "T");
  // Pad seconds if missing (some rows are "YYYY-MM-DD HH:MM").
  const padded = /T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
  const plain = Temporal.PlainDateTime.from(padded);
  const zoned = plain.toZonedDateTime(homeZone, { disambiguation: "compatible" });
  return zoned.toInstant().toString();
}

function getDeviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Run the one-time legacy-to-UTC rewrite for calendar_events and
 * calendar_event_overrides. Idempotent: a successful run sets
 * `preferences.calendarTimezoneMigratedV8 = true` in vault/config.json
 * and subsequent calls short-circuit.
 */
export async function hydrateCalendarEventTimezones(): Promise<void> {
  if (getConfigKey<boolean>(MIGRATION_MARKER_KEY, false)) return;

  const deviceZone = getDeviceZone();

  try {
    const eventHydrations: EventTimezoneHydration[] = [];
    const overrideHydrations: OverrideTimezoneHydration[] = [];
    const events = await select<LegacyEventRow>(
      `SELECT id, start_time, end_time, timezone, all_day
       FROM calendar_events`,
    );

    for (const row of events) {
      // All-day events are floating: leave them alone, the all_day flag
      // tells the renderer to interpret the wall clock as a date.
      if (row.all_day === 1) continue;

      const startLegacy = isLegacyWallClock(row.start_time);
      const endLegacy = isLegacyWallClock(row.end_time);
      if (!startLegacy && !endLegacy) continue;

      // Treat the row's wall clock as device-local. The v8 SQL migration
      // backfilled empty timezones to 'UTC' as a defensive default, but
      // the actual authoring zone for legacy rows is the device's current
      // zone (the user wrote the event in their local time before zone
      // awareness existed).
      const homeZone = deviceZone;
      const newStart = startLegacy
        ? legacyToUtcIso(row.start_time, homeZone)
        : row.start_time;
      const newEnd = endLegacy
        ? legacyToUtcIso(row.end_time, homeZone)
        : row.end_time;

      eventHydrations.push({
        id: row.id,
        startTime: newStart,
        endTime: newEnd,
        timezone: homeZone,
      });
    }

    // Overrides reference their parent's home zone for recurrence_id
    // matching. Pull the parent zones in one query and rewrite per-row.
    const overrides = await select<LegacyOverrideRow>(
      `SELECT id, recurrence_id, start_time, end_time, parent_event_id
       FROM calendar_event_overrides`,
    );

    if (overrides.length > 0) {
      const parentRows = await select<ParentZoneRow>(
        `SELECT id, timezone, all_day FROM calendar_events`,
      );
      const hydratedEventZoneById = new Map(
        eventHydrations.map((event) => [event.id, event.timezone] as const),
      );
      const parentZoneById = new Map<string, { timezone: string; allDay: boolean }>();
      for (const p of parentRows) {
        parentZoneById.set(p.id, {
          timezone: hydratedEventZoneById.get(p.id) ?? (p.timezone || deviceZone),
          allDay: p.all_day === 1,
        });
      }

      for (const row of overrides) {
        const parent = parentZoneById.get(row.parent_event_id);
        if (!parent || parent.allDay) continue;
        const homeZone = parent.timezone;

        const recIdLegacy = isLegacyWallClock(row.recurrence_id);
        const startLegacy = row.start_time !== null && isLegacyWallClock(row.start_time);
        const endLegacy = row.end_time !== null && isLegacyWallClock(row.end_time);
        if (!recIdLegacy && !startLegacy && !endLegacy) continue;

        const newRecId = recIdLegacy
          ? legacyToUtcIso(row.recurrence_id, homeZone)
          : row.recurrence_id;
        const newStart = startLegacy
          ? legacyToUtcIso(row.start_time as string, homeZone)
          : row.start_time;
        const newEnd = endLegacy
          ? legacyToUtcIso(row.end_time as string, homeZone)
          : row.end_time;

        overrideHydrations.push({
          id: row.id,
          recurrenceId: newRecId,
          startTime: newStart,
          endTime: newEnd,
        });
      }
    }

    if (eventHydrations.length > 0 || overrideHydrations.length > 0) {
      await invoke("calendar_apply_timezone_hydration", {
        dbUrl: dbUrl(),
        payload: {
          events: eventHydrations,
          overrides: overrideHydrations,
        },
      });
    }

    setConfigKey(MIGRATION_MARKER_KEY, true);
    await flushConfig();
  } catch (err) {
    console.error("[calendar] hydrateCalendarEventTimezones failed", err);
    // Do not set the marker on failure: a subsequent boot will retry.
  }
}
