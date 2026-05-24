import type { CalendarEvent } from "./types";
import { parseCalendarDate } from "./utils";
import { sameConcreteOccurrence } from "./occurrence-protection";

export { sameConcreteOccurrence };

function eventCoversInstant(event: CalendarEvent, instant: Date): boolean {
  const startMs = parseCalendarDate(event.start).getTime();
  const endMs = parseCalendarDate(event.end).getTime();
  const instantMs = instant.getTime();
  return Number.isFinite(startMs)
    && Number.isFinite(endMs)
    && startMs <= instantMs
    && instantMs < endMs;
}

export function endActiveEventWouldStopProductivity(
  selectedEvent: CalendarEvent,
  visibleEvents: readonly CalendarEvent[],
  now: Date = new Date(),
): boolean {
  return !visibleEvents.some((event) =>
    !!event.pomodoroConfig
    && !event.allDay
    && !sameConcreteOccurrence(event, selectedEvent)
    && eventCoversInstant(event, now),
  );
}
