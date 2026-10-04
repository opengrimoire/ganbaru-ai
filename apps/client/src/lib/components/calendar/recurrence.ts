/** Date-picker helpers. Canonical recurrence expansion belongs to Rust. */
import { Temporal } from "@js-temporal/polyfill";

/** Convert a date-picker value to a local JavaScript date. */
export function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Format a local date-picker value without applying occurrence semantics. */
export function fmtYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}


/** Convert the date-picker weekday numbering to Temporal numbering. */
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
