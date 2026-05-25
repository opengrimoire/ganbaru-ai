import type { CalendarEvent } from "$lib/components/calendar/types";
import { toDbTime } from "./map-row";

export interface CalendarEventMutationTarget {
  id: string;
  occurrenceStart: string | null;
  occurrenceEnd: string | null;
}

export function buildCalendarEventMutationTarget(
  event: CalendarEvent,
  template?: CalendarEvent,
): CalendarEventMutationTarget {
  const timezone = event.timezone || template?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const allDay = event.allDay ?? template?.allDay ?? false;
  return {
    id: event.id,
    occurrenceStart: toDbTime(event.start, timezone, allDay),
    occurrenceEnd: toDbTime(event.end, timezone, allDay),
  };
}

export function concreteRecurringOccurrenceForMutation(
  event: CalendarEvent,
  template?: CalendarEvent,
): CalendarEvent {
  const isRecurringOccurrence = !!event.recurringParentId || !!event.recurrence || !!template?.recurrence;
  if (!isRecurringOccurrence || event.id.includes("::")) return event;

  const parentId = event.recurringParentId ?? template?.id ?? event.id;
  const occurrenceDate = event.start.split(" ")[0];
  return {
    ...event,
    id: `${parentId}::${occurrenceDate}`,
    recurringParentId: parentId,
    recurrence: undefined,
    exceptions: undefined,
  };
}

export function buildCalendarEventMutationTargetFromId(
  id: string,
): CalendarEventMutationTarget {
  return {
    id,
    occurrenceStart: null,
    occurrenceEnd: null,
  };
}
