import type { CalendarEvent } from "./types";
import { dateDiffDays, shiftDateStr } from "./recurrence-edit-plan";

export function occurrenceOnDate(source: CalendarEvent, templateId: string, date: string): CalendarEvent {
  const startTime = source.start.split(" ")[1];
  const endTime = source.end.split(" ")[1];
  return {
    ...source,
    id: `${templateId}::${date}`,
    start: `${date} ${startTime}`,
    end: `${date} ${endTime}`,
    recurringParentId: templateId,
    recurrence: undefined,
    exceptions: undefined,
  };
}

export function templateEventIdForDate(template: CalendarEvent, date: string): string {
  return template.start.split(" ")[0] === date ? template.id : `${template.id}::${date}`;
}

export function templateEndForDate(template: CalendarEvent, date: string): string {
  const templateStartDate = template.start.split(" ")[0];
  const templateEndDate = template.end.split(" ")[0];
  const daySpan = dateDiffDays(templateStartDate, templateEndDate);
  const endDate = daySpan !== 0 ? shiftDateStr(date, daySpan) : date;
  return `${endDate} ${template.end.split(" ")[1]}`;
}

export function patchForTemplateAnchor(
  template: CalendarEvent,
  selectedOccurrence: CalendarEvent,
  patch: Partial<CalendarEvent>,
): CalendarEvent {
  const selectedDate = selectedOccurrence.start.split(" ")[0];
  const patchStartDate = patch.start ? String(patch.start).split(" ")[0] : selectedDate;
  const delta = dateDiffDays(selectedDate, patchStartDate);
  const templateStartDate = template.start.split(" ")[0];
  const newStartDate = delta !== 0 ? shiftDateStr(templateStartDate, delta) : templateStartDate;
  const patchEndDate = patch.end ? String(patch.end).split(" ")[0] : patchStartDate;
  const daySpan = dateDiffDays(patchStartDate, patchEndDate);
  const newEndDate = shiftDateStr(newStartDate, daySpan);
  const startTime = patch.start ? String(patch.start).split(" ")[1] : template.start.split(" ")[1];
  const endTime = patch.end ? String(patch.end).split(" ")[1] : template.end.split(" ")[1];

  return {
    ...template,
    ...patch,
    id: template.id,
    title: patch.title ?? template.title,
    start: `${newStartDate} ${startTime}`,
    end: `${newEndDate} ${endTime}`,
    timezone: patch.timezone ?? template.timezone,
    calendarId: patch.calendarId ?? template.calendarId,
    recurringParentId: undefined,
  };
}
