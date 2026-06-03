import type { CalendarEvent } from "./types";
import { formatDatePart, formatTimeRange, parseCalendarDate } from "./utils";

export type EventNotificationCopyInput = Pick<
  CalendarEvent,
  "start" | "end" | "allDay" | "location"
>;

function plural(value: number, singular: string, pluralLabel: string): string {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

export function formatEventNotificationLead(minutesUntil: number): string {
  if (minutesUntil <= 0) return "Starting now";
  if (minutesUntil < 60) {
    return `Starts in ${plural(minutesUntil, "minute", "minutes")}`;
  }

  if (minutesUntil >= 24 * 60) {
    const days = Math.round(minutesUntil / (24 * 60));
    return `Starts in ${plural(days, "day", "days")}`;
  }

  const hours = Math.floor(minutesUntil / 60);
  const minutes = minutesUntil % 60;
  if (minutes === 0) {
    return `Starts in ${plural(hours, "hour", "hours")}`;
  }
  return `Starts in ${plural(hours, "hour", "hours")} ${plural(minutes, "minute", "minutes")}`;
}

export function formatEventNotificationBody(
  event: EventNotificationCopyInput,
  now: Date,
): string {
  const startTime = parseCalendarDate(event.start);
  const minutesUntil = Math.round((startTime.getTime() - now.getTime()) / 60_000);
  const lines = [formatEventNotificationLead(minutesUntil)];
  const eventDate = formatDatePart(startTime);
  const today = formatDatePart(now);

  if (event.allDay) {
    lines.push(eventDate === today ? "All day" : `All day on ${eventDate}`);
  } else {
    const range = formatTimeRange(event.start, event.end, "24h", "compact");
    lines.push(eventDate === today ? range : `${eventDate} ${range}`);
  }

  const location = event.location?.trim().replace(/\s+/g, " ");
  if (location) lines.push(location);

  return lines.join("\n");
}
