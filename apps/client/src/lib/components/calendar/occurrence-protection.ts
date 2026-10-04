import type { CalendarEvent } from "./types";

/** Identity published by the native Focus owner, independent of device-day evidence. */
export interface ActivePomodoroIdentity {
  blockId: string | null | undefined;
}

/** Preserve opaque template IDs while removing only a qualified recurrence suffix. */
export function rootIdForEvent(event: CalendarEvent): string {
  return event.recurringParentId ?? event.id.replace(/::\d{4}-\d{2}-\d{2}$/, "");
}

/** Match original home-zone identities even when rendering or overrides move the date. */
export function exactOccurrenceId(event: CalendarEvent, template?: CalendarEvent): string {
  const root = event.recurringParentId
    ?? template?.id
    ?? (event.recurrence || event.rdate?.length ? rootIdForEvent(event) : undefined);
  if (!root) return event.id;
  const qualifiedDate = event.id.match(/::(\d{4}-\d{2}-\d{2})$/)?.[1];
  // Legacy presentation drafts can omit native provenance; persisted projections
  // always supply recurrenceDate and must take precedence over displayed dates.
  const date = event.recurrenceDate ?? qualifiedDate ?? event.start.split(" ")[0];
  return `${root}::${date}`;
}

/** Highlight only the accepted native occurrence, never a segment's device day. */
export function eventMatchesActiveOccurrence(
  event: CalendarEvent,
  active: ActivePomodoroIdentity | undefined,
  template?: CalendarEvent,
): boolean {
  if (!active?.blockId) return false;
  return event.id === active.blockId || exactOccurrenceId(event, template) === active.blockId;
}

/** Compare aliases of one concrete occurrence without interpreting rendered geometry. */
export function sameConcreteOccurrence(a: CalendarEvent, b: CalendarEvent): boolean {
  if (a.id === b.id) return true;
  const aRecurring = !!a.recurringParentId || /::\d{4}-\d{2}-\d{2}$/.test(a.id) || !!a.recurrence || !!a.rdate?.length;
  const bRecurring = !!b.recurringParentId || /::\d{4}-\d{2}-\d{2}$/.test(b.id) || !!b.recurrence || !!b.rdate?.length;
  return (aRecurring || bRecurring)
    && rootIdForEvent(a) === rootIdForEvent(b)
    && exactOccurrenceId(a) === exactOccurrenceId(b);
}
