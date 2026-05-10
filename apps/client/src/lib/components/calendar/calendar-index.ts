import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "./types";
import { expandTemplate } from "./recurrence";

/**
 * Pre-built lookup structure that bounds a window query by the visible event
 * count rather than the loaded template count. Built once per current
 * render-window mutation; queried per displayed viewport.
 *
 * The `nonRecurringSorted` and `nonRecurringStarts` arrays are parallel
 * (same indices). Storing the start strings separately keeps the bisect
 * loop allocation-free in the hot path.
 */
export interface ExpansionIndex {
  /** Templates with `recurrence` or non-empty `rdate`. Walked exhaustively per query. */
  recurring: CalendarEvent[];
  /** Non-recurring events, sorted ascending by `start` (lex order = chronological for `YYYY-MM-DD HH:MM`). */
  nonRecurringSorted: CalendarEvent[];
  /** Parallel `start` strings to `nonRecurringSorted`, for binary search without re-reading event objects. */
  nonRecurringStarts: string[];
  /** Largest `(end - start)` in days across non-recurring; bounds the walk-back when querying. */
  maxNonRecurringSpanDays: number;
}

/**
 * Build a window-query index from loaded template events. O(N) classify plus
 * O(N log N) sort. Called once per load and after each mutation; the
 * resulting index aliases entries from the current window state (no event objects are
 * cloned), so memory cost is just the container arrays.
 */
export function buildExpansionIndex(rawBlocks: CalendarEvent[]): ExpansionIndex {
  const recurring: CalendarEvent[] = [];
  const nonRec: CalendarEvent[] = [];
  let maxSpan = 0;
  for (const evt of rawBlocks) {
    if (evt.recurrence || (evt.rdate && evt.rdate.length > 0)) {
      recurring.push(evt);
      continue;
    }
    nonRec.push(evt);
    const startDateStr = evt.start.substring(0, 10);
    const endDateStr = evt.end.substring(0, 10);
    if (endDateStr !== startDateStr) {
      try {
        const sp = Temporal.PlainDate.from(startDateStr)
          .until(Temporal.PlainDate.from(endDateStr), { largestUnit: "days" })
          .days;
        if (sp > maxSpan) maxSpan = sp;
      } catch {
        // Malformed date strings should never reach the store, but if
        // they do we keep the event in the sorted scan and skip its
        // span contribution. The walk-back may then miss it; logged
        // upstream via mapRow validation.
      }
    }
  }
  nonRec.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return {
    recurring,
    nonRecurringSorted: nonRec,
    nonRecurringStarts: nonRec.map((e) => e.start),
    maxNonRecurringSpanDays: maxSpan,
  };
}

/**
 * Return all events overlapping the inclusive `[windowStart, windowEnd]`
 * range. Non-recurring events are picked via bisect plus a bounded walk-back
 * over the sorted index; recurring templates are expanded one at a time via
 * `expandTemplate`. For a typical week-view window over thousands of
 * non-recurring events, the non-recurring path runs in `O(log N + K)` where
 * `K` is the number of events in the window plus events whose start lies
 * within `maxNonRecurringSpanDays` before the window.
 */
export function eventsInWindowFromIndex(
  index: ExpansionIndex,
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
): CalendarEvent[] {
  const result: CalendarEvent[] = [];

  const windowStartDay = windowStart.toString();
  const upperTargetDay = windowEnd.add({ days: 1 }).toString();

  let lo = 0;
  let hi = index.nonRecurringStarts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index.nonRecurringStarts[mid].substring(0, 10) < upperTargetDay) lo = mid + 1;
    else hi = mid;
  }
  const upper = lo;

  const lowerBoundDay = index.maxNonRecurringSpanDays > 0
    ? windowStart.subtract({ days: index.maxNonRecurringSpanDays }).toString()
    : windowStartDay;

  for (let i = upper - 1; i >= 0; i--) {
    const evt = index.nonRecurringSorted[i];
    const evtStartDay = evt.start.substring(0, 10);
    if (evtStartDay < lowerBoundDay) break;
    const evtEndDay = evt.end.substring(0, 10);
    if (evtEndDay >= windowStartDay) {
      result.push(evt);
    }
  }

  for (const evt of index.recurring) {
    expandTemplate(evt, windowStart, windowEnd, result);
  }

  return result;
}
