/**
 * Pure recurrence expansion utilities. No Svelte runes, safe for unit tests.
 * Extracted from calendar.svelte.ts so display-events.ts can import without
 * pulling in $state/$derived.
 */

import type { CalendarEvent, EventOverride, OrdinalWeekday, RecurrenceConfig, Weekday } from "./types";

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

/**
 * Find the Nth occurrence of a weekday in a given month/year.
 * ordinal > 0: 1st, 2nd, 3rd, etc.
 * ordinal < 0: -1 = last, -2 = second-to-last, etc.
 * Returns the day-of-month (1-based) or null if not found.
 */
export function findOrdinalWeekday(year: number, month: number, weekday: number, ordinal: number): number | null {
  if (ordinal === 0) return null;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  if (ordinal > 0) {
    let count = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      if (new Date(year, month, day).getDay() === weekday) {
        count++;
        if (count === ordinal) return day;
      }
    }
    return null; // ordinal exceeds occurrences in this month
  }

  // Negative ordinal: count from end
  const absOrd = -ordinal;
  let count = 0;
  for (let day = daysInMonth; day >= 1; day--) {
    if (new Date(year, month, day).getDay() === weekday) {
      count++;
      if (count === absOrd) return day;
    }
  }
  return null;
}

/**
 * Advance to the next occurrence date based on the recurrence config.
 * For simple patterns (daily, weekly, monthly day-roll, yearly day-roll),
 * returns the next date. For complex patterns (BYMONTHDAY, ordinal BYDAY,
 * BYSETPOS), generates candidates and picks the next valid one.
 */
function advanceDate(from: Date, config: RecurrenceConfig): Date {
  const d = new Date(from);

  // Weekly with simple BYDAY
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

  // Monthly with ordinal BYDAY (e.g. "2nd Tuesday", "last Friday")
  if (config.frequency === "monthly" && config.ordinalWeekdays && config.ordinalWeekdays.length > 0) {
    return advanceMonthlyOrdinal(d, config.interval, config.ordinalWeekdays);
  }

  // Monthly with BYMONTHDAY (e.g. "15th of every month")
  if (config.frequency === "monthly" && config.byMonthDay && config.byMonthDay.length > 0) {
    return advanceMonthlyByDay(d, config.interval, config.byMonthDay);
  }

  // Yearly with ordinal BYDAY + BYMONTH
  if (config.frequency === "yearly" && config.ordinalWeekdays && config.ordinalWeekdays.length > 0) {
    return advanceYearlyOrdinal(d, config.interval, config.ordinalWeekdays, config.byMonth);
  }

  // Yearly with BYMONTH + BYMONTHDAY
  if (config.frequency === "yearly" && config.byMonth && config.byMonth.length > 0 && config.byMonthDay && config.byMonthDay.length > 0) {
    return advanceYearlyByMonthDay(d, config.interval, config.byMonth, config.byMonthDay);
  }

  // Simple frequency advancement
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

function advanceMonthlyOrdinal(from: Date, interval: number, ordWeekdays: OrdinalWeekday[]): Date {
  let year = from.getFullYear();
  let month = from.getMonth() + interval;
  const maxIter = 120; // safety: max 10 years of monthly checks

  for (let i = 0; i < maxIter; i++) {
    year += Math.floor(month / 12);
    month = month % 12;
    if (month < 0) { month += 12; year--; }

    for (const ow of ordWeekdays) {
      const ordinal = ow.ordinal ?? 1;
      const dayOfMonth = findOrdinalWeekday(year, month, DAY_INDEX[ow.day], ordinal);
      if (dayOfMonth != null) {
        const candidate = new Date(year, month, dayOfMonth);
        if (candidate > from) return candidate;
      }
    }
    month += interval;
  }
  // Fallback: just advance by interval months
  const fallback = new Date(from);
  fallback.setMonth(fallback.getMonth() + interval);
  return fallback;
}

function advanceMonthlyByDay(from: Date, interval: number, byMonthDay: number[]): Date {
  let year = from.getFullYear();
  let month = from.getMonth();
  const sorted = [...byMonthDay].sort((a, b) => a - b);
  const maxIter = 120;

  // Check remaining days in current month first
  const daysInCurrent = new Date(year, month + 1, 0).getDate();
  for (const d of sorted) {
    const actual = d > 0 ? d : daysInCurrent + d + 1;
    if (actual > 0 && actual <= daysInCurrent && actual > from.getDate()) {
      return new Date(year, month, actual);
    }
  }

  // Move to next month(s)
  month += interval;
  for (let i = 0; i < maxIter; i++) {
    year += Math.floor(month / 12);
    month = month % 12;
    if (month < 0) { month += 12; year--; }

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (const d of sorted) {
      const actual = d > 0 ? d : daysInMonth + d + 1;
      if (actual > 0 && actual <= daysInMonth) {
        return new Date(year, month, actual);
      }
    }
    month += interval;
  }
  const fallback = new Date(from);
  fallback.setMonth(fallback.getMonth() + interval);
  return fallback;
}

function advanceYearlyOrdinal(
  from: Date, interval: number, ordWeekdays: OrdinalWeekday[], byMonth?: number[],
): Date {
  const months = byMonth ?? [from.getMonth() + 1]; // 1-based
  let year = from.getFullYear();
  const maxIter = 50;

  // Check remaining months in current year
  for (const m of months) {
    for (const ow of ordWeekdays) {
      const ordinal = ow.ordinal ?? 1;
      const dayOfMonth = findOrdinalWeekday(year, m - 1, DAY_INDEX[ow.day], ordinal);
      if (dayOfMonth != null) {
        const candidate = new Date(year, m - 1, dayOfMonth);
        if (candidate > from) return candidate;
      }
    }
  }

  // Advance by interval years
  year += interval;
  for (let i = 0; i < maxIter; i++) {
    for (const m of months) {
      for (const ow of ordWeekdays) {
        const ordinal = ow.ordinal ?? 1;
        const dayOfMonth = findOrdinalWeekday(year, m - 1, DAY_INDEX[ow.day], ordinal);
        if (dayOfMonth != null) {
          return new Date(year, m - 1, dayOfMonth);
        }
      }
    }
    year += interval;
  }
  const fallback = new Date(from);
  fallback.setFullYear(fallback.getFullYear() + interval);
  return fallback;
}

function advanceYearlyByMonthDay(
  from: Date, interval: number, byMonth: number[], byMonthDay: number[],
): Date {
  let year = from.getFullYear();
  const sortedMonths = [...byMonth].sort((a, b) => a - b);
  const sortedDays = [...byMonthDay].sort((a, b) => a - b);
  const maxIter = 50;

  // Check remaining months in current year
  for (const m of sortedMonths) {
    const daysInMonth = new Date(year, m, 0).getDate();
    for (const d of sortedDays) {
      const actual = d > 0 ? d : daysInMonth + d + 1;
      if (actual > 0 && actual <= daysInMonth) {
        const candidate = new Date(year, m - 1, actual);
        if (candidate > from) return candidate;
      }
    }
  }

  year += interval;
  for (let i = 0; i < maxIter; i++) {
    for (const m of sortedMonths) {
      const daysInMonth = new Date(year, m, 0).getDate();
      for (const d of sortedDays) {
        const actual = d > 0 ? d : daysInMonth + d + 1;
        if (actual > 0 && actual <= daysInMonth) {
          return new Date(year, m - 1, actual);
        }
      }
    }
    year += interval;
  }
  const fallback = new Date(from);
  fallback.setFullYear(fallback.getFullYear() + interval);
  return fallback;
}

// Expansion

const EXPANSION_DAYS = 180;
const MAX_INSTANCES = 500;

/**
 * Build an override lookup map keyed by date string (YYYY-MM-DD)
 * extracted from the recurrenceId (which may be an ISO datetime).
 */
function buildOverrideMap(overrides: EventOverride[] | undefined): Map<string, EventOverride> | null {
  if (!overrides || overrides.length === 0) return null;
  const map = new Map<string, EventOverride>();
  for (const ovr of overrides) {
    // recurrenceId may be "2026-04-15" or "2026-04-15 09:00" or "2026-04-15T09:00:00"
    const dateKey = ovr.recurrenceId.split(/[ T]/)[0];
    map.set(dateKey, ovr);
  }
  return map;
}

/**
 * Apply an override to a generated recurring instance.
 * Only non-undefined override fields replace the instance fields.
 */
function applyOverride(instance: CalendarEvent, override: EventOverride): CalendarEvent {
  return {
    ...instance,
    title: override.title ?? instance.title,
    start: override.start ?? instance.start,
    end: override.end ?? instance.end,
    description: override.description ?? instance.description,
    location: override.location ?? instance.location,
    url: override.url ?? instance.url,
    color: override.color ?? instance.color,
    status: override.status ?? instance.status,
    transparency: override.transparency ?? instance.transparency,
    visibility: override.visibility ?? instance.visibility,
  };
}

/**
 * Compare a date string against an UNTIL value that may include time.
 */
function isPastUntil(occDateStr: string, untilDate: string): boolean {
  if (!untilDate.includes("T")) {
    // Date-only comparison
    return occDateStr > untilDate;
  }
  // UNTIL has time: compare the date portion only for the expansion loop
  // (the time precision matters for boundary cases, but our instances are date-keyed)
  const untilDatePart = untilDate.split("T")[0];
  return occDateStr > untilDatePart;
}

export function expandRecurring(templates: CalendarEvent[]): CalendarEvent[] {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + EXPANSION_DAYS);

  const result: CalendarEvent[] = [];

  for (const evt of templates) {
    const startDateStr = evt.start.split(" ")[0];
    const config = evt.recurrence;
    const untilDate = config?.end.type === "until" ? config.end.date : undefined;

    if (untilDate && isPastUntil(startDateStr, untilDate)) continue;

    if (!evt.exceptions?.includes(startDateStr)) {
      result.push(evt);
    }
    if (!config) {
      // Non-recurring: also add RDATE instances as standalone copies
      if (evt.rdate && evt.rdate.length > 0) {
        addRdateInstances(evt, result, horizon);
      }
      continue;
    }

    const startTimeStr = evt.start.split(" ")[1];
    const endDateStr = evt.end.split(" ")[0];
    const endTimeStr = evt.end.split(" ")[1];
    const origStart = parseYMD(startDateStr);
    const origEnd = parseYMD(endDateStr);
    const daySpan = Math.round((origEnd.getTime() - origStart.getTime()) / 86400000);

    const exceptionsSet = evt.exceptions ? new Set(evt.exceptions) : null;
    const overrideMap = buildOverrideMap(evt.overrides);
    const maxCount = config.end.type === "count" ? config.end.count : MAX_INSTANCES;
    const rdateSet = new Set<string>(); // track generated dates to dedup with RDATE

    let cursor = advanceDate(origStart, config);
    let generated = 1;
    rdateSet.add(startDateStr);

    while (cursor <= horizon && generated < maxCount) {
      const occStartStr = fmtYMD(cursor);

      if (untilDate && isPastUntil(occStartStr, untilDate)) break;

      rdateSet.add(occStartStr);

      if (exceptionsSet?.has(occStartStr)) {
        cursor = advanceDate(cursor, config);
        continue;
      }

      const occEndDate = new Date(cursor);
      occEndDate.setDate(occEndDate.getDate() + daySpan);
      const occEndStr = fmtYMD(occEndDate);

      let instance: CalendarEvent = {
        ...evt,
        id: `${evt.id}::${occStartStr}`,
        start: `${occStartStr} ${startTimeStr}`,
        end: `${occEndStr} ${endTimeStr}`,
        recurringParentId: evt.id,
      };

      // Apply per-instance override if available
      const override = overrideMap?.get(occStartStr);
      if (override) {
        instance = applyOverride(instance, override);
      }

      result.push(instance);

      cursor = advanceDate(cursor, config);
      generated++;
    }

    // Add RDATE instances (extra dates beyond the RRULE pattern)
    if (evt.rdate && evt.rdate.length > 0) {
      for (const rdateStr of evt.rdate) {
        const rdate = rdateStr.split(/[ T]/)[0];
        if (rdateSet.has(rdate)) continue; // already generated by RRULE
        if (exceptionsSet?.has(rdate)) continue;
        if (parseYMD(rdate) > horizon) continue;
        if (untilDate && isPastUntil(rdate, untilDate)) continue;

        const occEndDate = new Date(parseYMD(rdate));
        occEndDate.setDate(occEndDate.getDate() + daySpan);

        let instance: CalendarEvent = {
          ...evt,
          id: `${evt.id}::${rdate}`,
          start: `${rdate} ${startTimeStr}`,
          end: `${fmtYMD(occEndDate)} ${endTimeStr}`,
          recurringParentId: evt.id,
        };

        const override = overrideMap?.get(rdate);
        if (override) {
          instance = applyOverride(instance, override);
        }

        result.push(instance);
      }
    }
  }

  return result;
}

function addRdateInstances(evt: CalendarEvent, result: CalendarEvent[], horizon: Date): void {
  const startTimeStr = evt.start.split(" ")[1];
  const endTimeStr = evt.end.split(" ")[1];
  const startDateStr = evt.start.split(" ")[0];
  const endDateStr = evt.end.split(" ")[0];
  const origStart = parseYMD(startDateStr);
  const origEnd = parseYMD(endDateStr);
  const daySpan = Math.round((origEnd.getTime() - origStart.getTime()) / 86400000);

  for (const rdateStr of evt.rdate!) {
    const rdate = rdateStr.split(/[ T]/)[0];
    if (rdate === startDateStr) continue;
    if (parseYMD(rdate) > horizon) continue;

    const occEndDate = new Date(parseYMD(rdate));
    occEndDate.setDate(occEndDate.getDate() + daySpan);

    result.push({
      ...evt,
      id: `${evt.id}::${rdate}`,
      start: `${rdate} ${startTimeStr}`,
      end: `${fmtYMD(occEndDate)} ${endTimeStr}`,
      recurringParentId: evt.id,
    });
  }
}
