/**
 * Pure recurrence expansion utilities. No Svelte runes, safe for unit tests.
 * Extracted from calendar.svelte.ts so display-events.ts can import without
 * pulling in $state/$derived.
 *
 * Date arithmetic runs on `Temporal.PlainDate` (zone-free) so day-counting
 * never drifts across DST transitions, and the wall-clock time-of-day
 * (`HH:MM`) is reattached verbatim. That keeps "9 AM daily" anchored to
 * 9 AM through spring-forward and fall-back: the UTC instant shifts, but
 * the stored wall clock in the home zone does not.
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

function plainDateFromYMD(s: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(s);
}

function ymdFromPlainDate(d: Temporal.PlainDate): string {
  return d.toString();
}

const DAY_INDEX: Record<Weekday, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

/**
 * Convert a JS-style weekday index (0=Sun..6=Sat) to Temporal's
 * (1=Mon..7=Sun).
 */
function jsWeekdayToTemporal(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Find the Nth occurrence of a weekday in a given month/year.
 * `month` is 0-based (matching Date semantics on the public API).
 * `weekday` is 0=Sun..6=Sat.
 * ordinal > 0: 1st, 2nd, 3rd, etc.
 * ordinal < 0: -1 = last, -2 = second-to-last, etc.
 * Returns the day-of-month (1-based) or null if not found.
 */
export function findOrdinalWeekday(year: number, month: number, weekday: number, ordinal: number): number | null {
  if (ordinal === 0) return null;
  const target = jsWeekdayToTemporal(weekday);
  const firstOfMonth = Temporal.PlainDate.from({ year, month: month + 1, day: 1 });
  const daysInMonth = firstOfMonth.daysInMonth;

  if (ordinal > 0) {
    let count = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const d = firstOfMonth.with({ day });
      if (d.dayOfWeek === target) {
        count++;
        if (count === ordinal) return day;
      }
    }
    return null;
  }

  const absOrd = -ordinal;
  let count = 0;
  for (let day = daysInMonth; day >= 1; day--) {
    const d = firstOfMonth.with({ day });
    if (d.dayOfWeek === target) {
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
function advanceDate(from: Temporal.PlainDate, config: RecurrenceConfig): Temporal.PlainDate {
  // Weekly with simple BYDAY
  if (config.frequency === "weekly" && config.weekdays && config.weekdays.length > 0) {
    const allowedTemporal = new Set(config.weekdays.map((w) => jsWeekdayToTemporal(DAY_INDEX[w])));
    const sortedDays = [...allowedTemporal].sort((a, b) => a - b);
    const startDay = from.dayOfWeek; // 1..7
    const nextInWeek = sortedDays.find((day) => day > startDay);
    if (nextInWeek !== undefined) {
      return from.add({ days: nextInWeek - startDay });
    }
    const daysUntilEndOfWeek = 7 - startDay;
    const skipWeeks = (config.interval - 1) * 7;
    return from.add({ days: daysUntilEndOfWeek + skipWeeks + sortedDays[0] });
  }

  // Monthly with ordinal BYDAY (e.g. "2nd Tuesday", "last Friday")
  if (config.frequency === "monthly" && config.ordinalWeekdays && config.ordinalWeekdays.length > 0) {
    return advanceMonthlyOrdinal(from, config.interval, config.ordinalWeekdays);
  }

  // Monthly with BYMONTHDAY (e.g. "15th of every month")
  if (config.frequency === "monthly" && config.byMonthDay && config.byMonthDay.length > 0) {
    return advanceMonthlyByDay(from, config.interval, config.byMonthDay);
  }

  // Yearly with ordinal BYDAY + BYMONTH
  if (config.frequency === "yearly" && config.ordinalWeekdays && config.ordinalWeekdays.length > 0) {
    return advanceYearlyOrdinal(from, config.interval, config.ordinalWeekdays, config.byMonth);
  }

  // Yearly with BYMONTH + BYMONTHDAY
  if (config.frequency === "yearly" && config.byMonth && config.byMonth.length > 0 && config.byMonthDay && config.byMonthDay.length > 0) {
    return advanceYearlyByMonthDay(from, config.interval, config.byMonth, config.byMonthDay);
  }

  // Simple frequency advancement
  switch (config.frequency) {
    case "daily":
      return from.add({ days: config.interval });
    case "weekly":
      return from.add({ weeks: config.interval });
    case "monthly":
      return from.add({ months: config.interval });
    case "yearly":
      return from.add({ years: config.interval });
  }
}

function advanceMonthlyOrdinal(
  from: Temporal.PlainDate,
  interval: number,
  ordWeekdays: OrdinalWeekday[],
): Temporal.PlainDate {
  const maxIter = 120;
  let probe = from.add({ months: interval }).with({ day: 1 });

  for (let i = 0; i < maxIter; i++) {
    for (const ow of ordWeekdays) {
      const ordinal = ow.ordinal ?? 1;
      const dayOfMonth = findOrdinalWeekday(probe.year, probe.month - 1, DAY_INDEX[ow.day], ordinal);
      if (dayOfMonth != null) {
        const candidate = probe.with({ day: dayOfMonth });
        if (Temporal.PlainDate.compare(candidate, from) > 0) return candidate;
      }
    }
    probe = probe.add({ months: interval });
  }
  return from.add({ months: interval });
}

function advanceMonthlyByDay(
  from: Temporal.PlainDate,
  interval: number,
  byMonthDay: number[],
): Temporal.PlainDate {
  const sorted = [...byMonthDay].sort((a, b) => a - b);
  const maxIter = 120;

  // Check remaining days in current month first
  const daysInCurrent = from.daysInMonth;
  for (const d of sorted) {
    const actual = d > 0 ? d : daysInCurrent + d + 1;
    if (actual > 0 && actual <= daysInCurrent && actual > from.day) {
      return from.with({ day: actual });
    }
  }

  let probe = from.add({ months: interval }).with({ day: 1 });
  for (let i = 0; i < maxIter; i++) {
    const daysInMonth = probe.daysInMonth;
    for (const d of sorted) {
      const actual = d > 0 ? d : daysInMonth + d + 1;
      if (actual > 0 && actual <= daysInMonth) {
        return probe.with({ day: actual });
      }
    }
    probe = probe.add({ months: interval });
  }
  return from.add({ months: interval });
}

function advanceYearlyOrdinal(
  from: Temporal.PlainDate,
  interval: number,
  ordWeekdays: OrdinalWeekday[],
  byMonth?: number[],
): Temporal.PlainDate {
  const months = byMonth ?? [from.month];
  let year = from.year;
  const maxIter = 50;

  // Check remaining months in current year
  for (const m of months) {
    for (const ow of ordWeekdays) {
      const ordinal = ow.ordinal ?? 1;
      const dayOfMonth = findOrdinalWeekday(year, m - 1, DAY_INDEX[ow.day], ordinal);
      if (dayOfMonth != null) {
        const candidate = Temporal.PlainDate.from({ year, month: m, day: dayOfMonth });
        if (Temporal.PlainDate.compare(candidate, from) > 0) return candidate;
      }
    }
  }

  year += interval;
  for (let i = 0; i < maxIter; i++) {
    for (const m of months) {
      for (const ow of ordWeekdays) {
        const ordinal = ow.ordinal ?? 1;
        const dayOfMonth = findOrdinalWeekday(year, m - 1, DAY_INDEX[ow.day], ordinal);
        if (dayOfMonth != null) {
          return Temporal.PlainDate.from({ year, month: m, day: dayOfMonth });
        }
      }
    }
    year += interval;
  }
  return from.add({ years: interval });
}

function advanceYearlyByMonthDay(
  from: Temporal.PlainDate,
  interval: number,
  byMonth: number[],
  byMonthDay: number[],
): Temporal.PlainDate {
  let year = from.year;
  const sortedMonths = [...byMonth].sort((a, b) => a - b);
  const sortedDays = [...byMonthDay].sort((a, b) => a - b);
  const maxIter = 50;

  for (const m of sortedMonths) {
    const probe = Temporal.PlainDate.from({ year, month: m, day: 1 });
    const daysInMonth = probe.daysInMonth;
    for (const d of sortedDays) {
      const actual = d > 0 ? d : daysInMonth + d + 1;
      if (actual > 0 && actual <= daysInMonth) {
        const candidate = probe.with({ day: actual });
        if (Temporal.PlainDate.compare(candidate, from) > 0) return candidate;
      }
    }
  }

  year += interval;
  for (let i = 0; i < maxIter; i++) {
    for (const m of sortedMonths) {
      const probe = Temporal.PlainDate.from({ year, month: m, day: 1 });
      const daysInMonth = probe.daysInMonth;
      for (const d of sortedDays) {
        const actual = d > 0 ? d : daysInMonth + d + 1;
        if (actual > 0 && actual <= daysInMonth) {
          return probe.with({ day: actual });
        }
      }
    }
    year += interval;
  }
  return from.add({ years: interval });
}

// Expansion

/**
 * Cap on cursor iterations per template. Shields against pathological
 * RRULEs (huge COUNT, very old `DTSTART` with daily frequency seen far in
 * the future). The window does the real bounding; this is just a runaway
 * guard. 10000 daily steps is roughly 27 years, ample for any realistic
 * recurrence.
 */
const MAX_INSTANCES = 10000;

/**
 * Build an override lookup map keyed by date string (YYYY-MM-DD)
 * extracted from the recurrenceId (which may be an ISO datetime).
 */
function buildOverrideMap(overrides: EventOverride[] | undefined): Map<string, EventOverride> | null {
  if (!overrides || overrides.length === 0) return null;
  const map = new Map<string, EventOverride>();
  for (const ovr of overrides) {
    // recurrenceId may be "2026-04-15", "2026-04-15 09:00", or "2026-04-15T09:00:00Z"
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
 * Both date-only and datetime UNTIL are reduced to date-only comparison
 * because instances are date-keyed in the expansion loop.
 */
function isPastUntil(occDateStr: string, untilDate: string): boolean {
  if (!untilDate.includes("T")) return occDateStr > untilDate;
  return occDateStr > untilDate.split("T")[0];
}

/**
 * Inclusive overlap test between an occurrence (start/end as PlainDate, both
 * inclusive) and the requested window. An event whose end touches
 * `windowStart` still counts as overlapping the window.
 */
function overlapsWindow(
  occStart: Temporal.PlainDate,
  occEnd: Temporal.PlainDate,
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
): boolean {
  if (Temporal.PlainDate.compare(occEnd, windowStart) < 0) return false;
  if (Temporal.PlainDate.compare(occStart, windowEnd) > 0) return false;
  return true;
}

/**
 * Expand templates into concrete event instances that overlap the
 * `[windowStart, windowEnd]` range. Both bounds are inclusive PlainDates.
 *
 * Non-recurring templates pass through if they overlap the window.
 * Recurring templates walk their RRULE cursor between origin and `windowEnd`,
 * skipping emission for instances entirely before `windowStart`. RDATE
 * instances are merged in afterwards. EXDATE drops emission without
 * counting against COUNT, mirroring how RFC 5545 treats EXDATE as a
 * subtraction from the recurrence set.
 *
 * The cursor walk is bounded by `MAX_INSTANCES` iterations as a safety
 * guard; the window bound is what should naturally terminate the loop in
 * normal use.
 */
export function expandRecurring(
  templates: CalendarEvent[],
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
): CalendarEvent[] {
  const result: CalendarEvent[] = [];
  for (const evt of templates) {
    expandTemplate(evt, windowStart, windowEnd, result);
  }
  return result;
}

/**
 * Expand a single template into all its instances overlapping
 * `[windowStart, windowEnd]` and append them to `result`. Handles
 * recurrence rules, EXDATE exceptions, RDATE additions, and per-instance
 * overrides. Exported for callers that already partition templates by
 * recurrence (the calendar store's sorted index does this once at build
 * time and walks each recurring template directly, avoiding the linear
 * scan over every non-recurring event that `expandRecurring` would do).
 */
export function expandTemplate(
  evt: CalendarEvent,
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
  result: CalendarEvent[],
): void {
  const startDateStr = evt.start.split(" ")[0];
  const endDateStr = evt.end.split(" ")[0];
  const config = evt.recurrence;
  const untilDate = config?.end.type === "until" ? config.end.date : undefined;

  if (untilDate && isPastUntil(startDateStr, untilDate)) return;

  const origStart = plainDateFromYMD(startDateStr);
  const origEnd = plainDateFromYMD(endDateStr);
  const daySpan = origStart.until(origEnd, { largestUnit: "days" }).days;

  const exceptionsSet = evt.exceptions ? new Set(evt.exceptions) : null;
  const overrideMap = buildOverrideMap(evt.overrides);

  // Emit the original template as the first occurrence when it overlaps the
  // window and is not itself excepted. Pushed without an `::date` suffix so
  // the primary event id is preserved (matching legacy behavior).
  const origInWindow = overlapsWindow(origStart, origEnd, windowStart, windowEnd);
  if (origInWindow && !exceptionsSet?.has(startDateStr)) {
    result.push(evt);
  }

  if (!config && (!evt.rdate || evt.rdate.length === 0)) return;

  const startTimeStr = evt.start.split(" ")[1];
  const endTimeStr = evt.end.split(" ")[1];
  const rdateSet = new Set<string>([startDateStr]);

  if (config) {
    const maxCount = config.end.type === "count" ? config.end.count : Infinity;
    let cursor = advanceDate(origStart, config);
    let generated = 1;
    let iter = 0;

    while (generated < maxCount && iter < MAX_INSTANCES) {
      iter++;
      const occStartStr = ymdFromPlainDate(cursor);

      if (untilDate && isPastUntil(occStartStr, untilDate)) break;
      if (Temporal.PlainDate.compare(cursor, windowEnd) > 0) break;

      rdateSet.add(occStartStr);

      // EXDATE: skip emission and do NOT count toward COUNT, matching the
      // legacy behavior validated by the "respects exceptions" test.
      if (exceptionsSet?.has(occStartStr)) {
        cursor = advanceDate(cursor, config);
        continue;
      }

      const occEnd = cursor.add({ days: daySpan });

      // The instance "exists" for COUNT purposes even if entirely before the
      // window; we just don't emit it.
      if (Temporal.PlainDate.compare(occEnd, windowStart) >= 0) {
        const occEndStr = ymdFromPlainDate(occEnd);
        let instance: CalendarEvent = {
          ...evt,
          id: `${evt.id}::${occStartStr}`,
          start: `${occStartStr} ${startTimeStr}`,
          end: `${occEndStr} ${endTimeStr}`,
          recurringParentId: evt.id,
        };
        const override = overrideMap?.get(occStartStr);
        if (override) instance = applyOverride(instance, override);
        result.push(instance);
      }

      cursor = advanceDate(cursor, config);
      generated++;
    }
  }

  if (evt.rdate && evt.rdate.length > 0) {
    for (const rdateStr of evt.rdate) {
      const rdate = rdateStr.split(/[ T]/)[0];
      if (rdateSet.has(rdate)) continue;
      if (exceptionsSet?.has(rdate)) continue;
      const rdatePlain = plainDateFromYMD(rdate);
      const rdateEndPlain = rdatePlain.add({ days: daySpan });
      if (!overlapsWindow(rdatePlain, rdateEndPlain, windowStart, windowEnd)) continue;
      if (untilDate && isPastUntil(rdate, untilDate)) continue;

      const occEndStr = ymdFromPlainDate(rdateEndPlain);
      let instance: CalendarEvent = {
        ...evt,
        id: `${evt.id}::${rdate}`,
        start: `${rdate} ${startTimeStr}`,
        end: `${occEndStr} ${endTimeStr}`,
        recurringParentId: evt.id,
      };
      const override = overrideMap?.get(rdate);
      if (override) instance = applyOverride(instance, override);
      result.push(instance);
    }
  }
}
