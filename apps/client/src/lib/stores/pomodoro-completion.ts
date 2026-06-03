import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "$lib/components/calendar/types";
import { parseCalendarDate } from "$lib/components/calendar/utils";

export type PomodoroCompletionKind = "event" | "day" | "workweek";

function eventLocalDate(event: Pick<CalendarEvent, "start">): string {
  return event.start.split(" ")[0] ?? "";
}

export function classifyPomodoroCompletion(
  endedEvent: Pick<CalendarEvent, "id" | "start" | "end">,
  events: readonly Pick<CalendarEvent, "id" | "start" | "pomodoroConfig">[],
): PomodoroCompletionKind {
  const endedDate = eventLocalDate(endedEvent);
  const endedAtMs = parseCalendarDate(endedEvent.end).getTime();
  const hasLaterPomodoroEvent = events.some((event) => {
    if (event.id === endedEvent.id || !event.pomodoroConfig) return false;
    if (eventLocalDate(event) !== endedDate) return false;
    const startMs = parseCalendarDate(event.start).getTime();
    return Number.isFinite(startMs) && startMs >= endedAtMs;
  });

  if (hasLaterPomodoroEvent) return "event";
  const date = Temporal.PlainDate.from(endedDate);
  return date.dayOfWeek === 5 ? "workweek" : "day";
}
