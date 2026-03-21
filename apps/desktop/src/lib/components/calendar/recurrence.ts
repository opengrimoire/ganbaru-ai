/**
 * Pure recurrence expansion utilities. No Svelte runes, safe for unit tests.
 * Extracted from calendar.svelte.ts so display-events.ts can import without
 * pulling in $state/$derived.
 */

import type { CalendarEvent, RecurrenceConfig, Weekday } from "./types";

export function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function fmtYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DAY_INDEX: Record<Weekday, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

function advanceDate(from: Date, config: RecurrenceConfig): Date {
  const d = new Date(from);

  if (config.frequency === "weekly" && config.weekdays && config.weekdays.length > 0) {
    const allowedDays = new Set(config.weekdays.map((w) => DAY_INDEX[w]));
    const startDay = d.getDay();
    const sortedDays = [...allowedDays].sort((a, b) => a - b);
    const nextInWeek = sortedDays.find((day) => day > startDay);
    if (nextInWeek !== undefined) {
      d.setDate(d.getDate() + (nextInWeek - startDay));
    } else {
      const daysUntilEndOfWeek = 7 - startDay;
      const skipWeeks = (config.interval - 1) * 7;
      d.setDate(d.getDate() + daysUntilEndOfWeek + skipWeeks + sortedDays[0]);
    }
    return d;
  }

  switch (config.frequency) {
    case "daily":
      d.setDate(d.getDate() + config.interval);
      return d;
    case "weekly":
      d.setDate(d.getDate() + 7 * config.interval);
      return d;
    case "monthly":
      d.setMonth(d.getMonth() + config.interval);
      return d;
    case "yearly":
      d.setFullYear(d.getFullYear() + config.interval);
      return d;
  }
}

const EXPANSION_DAYS = 180;
const MAX_INSTANCES = 500;

export function expandRecurring(templates: CalendarEvent[]): CalendarEvent[] {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + EXPANSION_DAYS);

  const result: CalendarEvent[] = [];

  for (const evt of templates) {
    const startDateStr = evt.start.split(" ")[0];
    const config = evt.recurrence;
    const untilDate = config?.end.type === "until" ? config.end.date : undefined;

    if (untilDate && startDateStr > untilDate) continue;

    if (!evt.exceptions?.includes(startDateStr)) {
      result.push(evt);
    }
    if (!config) continue;

    const startTimeStr = evt.start.split(" ")[1];
    const endDateStr = evt.end.split(" ")[0];
    const endTimeStr = evt.end.split(" ")[1];
    const origStart = parseYMD(startDateStr);
    const origEnd = parseYMD(endDateStr);
    const daySpan = Math.round((origEnd.getTime() - origStart.getTime()) / 86400000);

    const exceptionsSet = evt.exceptions ? new Set(evt.exceptions) : null;
    const maxCount = config.end.type === "count" ? config.end.count : MAX_INSTANCES;

    let cursor = advanceDate(origStart, config);
    let generated = 1;

    while (cursor <= horizon && generated < maxCount) {
      const occStartStr = fmtYMD(cursor);

      if (untilDate && occStartStr > untilDate) break;

      if (exceptionsSet?.has(occStartStr)) {
        cursor = advanceDate(cursor, config);
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

      cursor = advanceDate(cursor, config);
      generated++;
    }
  }

  return result;
}
