import type { CalendarEvent } from "$lib/components/calendar/types";
import { parseCalendarDate } from "$lib/components/calendar/utils";
import type { PomodoroAdaptivePlannedBlockWrite } from "./persistence";

function recurringRootId(event: CalendarEvent): string {
  return (event.recurringParentId ?? event.id).split("::")[0];
}

function utcIsoFromSchedulerTime(value: string): string | null {
  const date = parseCalendarDate(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? date.toISOString() : null;
}

/**
 * Builds an exact local day-plan snapshot from already-expanded scheduler events.
 */
export function buildAdaptivePlannedBlocksForDate(
  events: readonly CalendarEvent[],
  eventDate: string,
): PomodoroAdaptivePlannedBlockWrite[] {
  const blocks = new Map<string, PomodoroAdaptivePlannedBlockWrite>();
  for (const event of events) {
    if (!event.pomodoroConfig || event.allDay) continue;
    if (event.start.split(" ")[0] !== eventDate) continue;

    const plannedStart = utcIsoFromSchedulerTime(event.start);
    const plannedEnd = utcIsoFromSchedulerTime(event.end);
    if (!plannedStart || !plannedEnd) continue;
    if (Date.parse(plannedEnd) <= Date.parse(plannedStart)) continue;

    const originalEventId = recurringRootId(event);
    const key = `${originalEventId}|${plannedStart}`;
    if (blocks.has(key)) continue;
    blocks.set(key, {
      eventDate,
      eventId: event.id,
      originalEventId,
      plannedStart,
      plannedEnd,
      sourceKind: "scheduler_snapshot",
    });
  }
  return [...blocks.values()].sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
}
