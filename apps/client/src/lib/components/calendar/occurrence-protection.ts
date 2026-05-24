import type { CalendarEvent } from "./types";

export type EventProtectionReason = "started" | "active" | "pomodoro-history";

export interface EventProtection {
  protected: boolean;
  reason?: EventProtectionReason;
}

export interface ActivePomodoroIdentity {
  blockId: string | null | undefined;
  eventDate?: string;
}

export type CalendarEventDeleteAction = "delete" | "archive";

export function calendarEventDatePart(value: string): string {
  return value.split(" ")[0];
}

export function calendarEventTimePart(value: string, fallback = "00:00"): string {
  return (value.split(" ")[1] ?? fallback).slice(0, 5);
}

export function calendarDateTime(date: string, time: string): string {
  return `${date} ${time.slice(0, 5)}`;
}

function wallClockMs(value: string): number {
  return new Date(value.replace(" ", "T")).getTime();
}

export function rootIdForEvent(event: CalendarEvent): string {
  return (event.recurringParentId ?? event.id).split("::")[0];
}

export function exactOccurrenceId(event: CalendarEvent, template?: CalendarEvent): string {
  const recurringRoot = event.recurringParentId
    ?? template?.id
    ?? (event.recurrence ? event.id : undefined);
  if (!recurringRoot) return event.id;
  return `${recurringRoot.split("::")[0]}::${calendarEventDatePart(event.start)}`;
}

export function activeOccurrenceDate(active: ActivePomodoroIdentity | undefined): string | undefined {
  if (!active?.blockId) return undefined;
  const [, syntheticDate] = active.blockId.split("::");
  return syntheticDate ?? active.eventDate;
}

export function activeRootId(active: ActivePomodoroIdentity | undefined): string | undefined {
  return active?.blockId?.split("::")[0];
}

export function eventMatchesActiveOccurrence(
  event: CalendarEvent,
  active: ActivePomodoroIdentity | undefined,
  template?: CalendarEvent,
): boolean {
  const activeRoot = activeRootId(active);
  if (!activeRoot) return false;
  const eventRoot = rootIdForEvent(template ?? event);
  if (eventRoot !== activeRoot) return false;

  const activeDate = activeOccurrenceDate(active);
  if (!activeDate) {
    return event.id === active?.blockId || rootIdForEvent(event) === activeRoot;
  }
  return calendarEventDatePart(event.start) === activeDate;
}

export function occurrenceStartsAtOrBefore(event: CalendarEvent, boundaryDateTime: string): boolean {
  return `${calendarEventDatePart(event.start)} ${calendarEventTimePart(event.start)}` <= boundaryDateTime;
}

export function occurrenceStartedBy(event: CalendarEvent, now: Date): boolean {
  const startMs = wallClockMs(event.start);
  return Number.isFinite(startMs) && startMs <= now.getTime();
}

export function classifyEventProtection(
  event: CalendarEvent,
  input: {
    now: Date;
    activePomodoro?: ActivePomodoroIdentity;
    protectedEventIds?: ReadonlySet<string>;
    template?: CalendarEvent;
  },
): EventProtection {
  const exactId = exactOccurrenceId(event, input.template);
  if (
    input.protectedEventIds?.has(event.id)
    || input.protectedEventIds?.has(exactId)
  ) {
    return { protected: true, reason: "pomodoro-history" };
  }
  if (eventMatchesActiveOccurrence(event, input.activePomodoro, input.template)) {
    return { protected: true, reason: "active" };
  }
  if (occurrenceStartedBy(event, input.now)) {
    return { protected: true, reason: "started" };
  }
  return { protected: false };
}

export function sameConcreteOccurrence(a: CalendarEvent, b: CalendarEvent): boolean {
  if (a.id === b.id) return true;
  const aRecurring = !!a.recurringParentId || a.id.includes("::") || !!a.recurrence;
  const bRecurring = !!b.recurringParentId || b.id.includes("::") || !!b.recurrence;
  if (!aRecurring && !bRecurring) return false;
  return rootIdForEvent(a) === rootIdForEvent(b)
    && exactOccurrenceId(a) === exactOccurrenceId(b);
}

export function deleteActionForCalendarEvent(
  event: CalendarEvent,
  now: Date = new Date(),
): CalendarEventDeleteAction {
  return occurrenceStartedBy(event, now) ? "archive" : "delete";
}
