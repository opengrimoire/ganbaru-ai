import type { CalendarEvent } from "./types";
import { parseCalendarDate } from "./utils";

function isRecurringOccurrence(event: CalendarEvent): boolean {
  return !!event.recurringParentId || event.id.includes("::") || !!event.recurrence;
}

function occurrenceRoot(event: CalendarEvent): string {
  return event.recurringParentId ?? event.id.split("::")[0];
}

function occurrenceDate(event: CalendarEvent): string {
  return event.id.split("::")[1] ?? event.start.split(" ")[0];
}

export function sameConcreteOccurrence(a: CalendarEvent, b: CalendarEvent): boolean {
  if (a.id === b.id) return true;
  if (!isRecurringOccurrence(a) && !isRecurringOccurrence(b)) return false;
  return occurrenceRoot(a) === occurrenceRoot(b) && occurrenceDate(a) === occurrenceDate(b);
}

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
