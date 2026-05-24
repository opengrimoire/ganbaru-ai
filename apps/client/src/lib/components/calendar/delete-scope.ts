import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent, RecurringScope } from "./types";
import { expandRecurring } from "./recurrence";
import {
  concreteRecurringOccurrenceForMutation,
  deleteActionForCalendarEvent,
} from "$lib/stores/calendar-mutations";

export function protectedRecurringOccurrencesForArchive(
  template: CalendarEvent,
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): CalendarEvent[] {
  if (endDate < startDate) return [];
  const expanded = expandRecurring(
    [template],
    Temporal.PlainDate.from(startDate),
    Temporal.PlainDate.from(endDate),
  );
  const seen = new Set<string>();
  const protectedOccurrences: CalendarEvent[] = [];
  for (const occurrence of expanded) {
    const date = occurrence.start.split(" ")[0];
    if (date < startDate || date > endDate) continue;
    const mutationEvent = concreteRecurringOccurrenceForMutation(occurrence, template);
    if (seen.has(mutationEvent.id)) continue;
    if (deleteActionForCalendarEvent(mutationEvent, now) !== "archive") continue;
    seen.add(mutationEvent.id);
    protectedOccurrences.push(mutationEvent);
  }
  return protectedOccurrences;
}

export function visibleEventsAfterRecurringDeleteScope(
  events: CalendarEvent[],
  templateId: string,
  instanceDate: string,
  scope: RecurringScope,
): CalendarEvent[] {
  return events.filter((event) => {
    const rootId = event.recurringParentId ?? event.id;
    if (rootId !== templateId) return true;
    const eventDate = event.start.split(" ")[0];
    if (scope === "this") return eventDate !== instanceDate;
    if (scope === "following") return eventDate < instanceDate;
    return false;
  });
}
