import type { CalendarEvent } from "$lib/components/calendar/types";

/**
 * Namespace synthetic child row ids so operation-benchmark imports can run
 * beside the normal seeded synthetic calendar without colliding on global
 * child primary keys.
 */
export function namespaceImportChildIds(
  events: CalendarEvent[],
  namespace: string,
): CalendarEvent[] {
  return events.map((event) => ({
    ...event,
    attendees: event.attendees?.map((attendee) => ({
      ...attendee,
      id: `${namespace}:attendee:${attendee.id}`,
    })),
    alarms: event.alarms?.map((alarm) => ({
      ...alarm,
      id: `${namespace}:alarm:${alarm.id}`,
    })),
    overrides: event.overrides?.map((override) => ({
      ...override,
      id: `${namespace}:override:${override.id}`,
    })),
  }));
}

