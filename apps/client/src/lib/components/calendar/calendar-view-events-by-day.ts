import type { CalendarEvent } from "./types";

/**
 * Advance a `YYYY-MM-DD` string by one calendar day. This avoids Temporal
 * allocations while bucketing visible calendar events in render hot paths.
 */
function nextDayStr(s: string): string {
  const y = Number(s.substring(0, 4));
  const m = Number(s.substring(5, 7));
  const d = Number(s.substring(8, 10));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, "0");
  const nd = String(dt.getDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

/**
 * Bucket events by every date they touch. Timed events land on each day where
 * their end is after midnight, while all-day events use an inclusive date span.
 */
export function buildEventsByDay(
  events: readonly CalendarEvent[],
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    let d = event.start.substring(0, 10);
    if (event.allDay) {
      const endDay = event.end.substring(0, 10);
      while (d <= endDay) {
        const arr = map.get(d);
        if (arr) arr.push(event);
        else map.set(d, [event]);
        d = nextDayStr(d);
      }
    } else {
      while (event.end > `${d} 00:00`) {
        const arr = map.get(d);
        if (arr) arr.push(event);
        else map.set(d, [event]);
        d = nextDayStr(d);
      }
    }
  }
  return map;
}
