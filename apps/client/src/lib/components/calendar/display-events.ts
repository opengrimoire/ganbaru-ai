/**
 * Pure functions that overlay edit session changes onto clean expanded events.
 * No store mutation, no fake IDs. Events keep their real IDs throughout.
 */

import type { CalendarEvent, RecurrenceConfig, RecurringScope } from "./types";
import type { CreatePreview } from "./edit-session.svelte";
import { expandRecurring } from "./recurrence";
import {
  buildRecurringEditPlan,
  hasChange,
  hasVisibleEventChanges,
  type DisplayResult,
  type ExpansionWindow,
} from "./recurrence-edit-plan";

const PENDING_CREATE_ID = "__pending_create__";
const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtMin = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtTime = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

function changeOr<K extends keyof CalendarEvent>(
  changes: Partial<CalendarEvent>,
  key: K,
  fallback: CalendarEvent[K] | undefined,
): CalendarEvent[K] | undefined {
  return hasChange(changes, key) ? changes[key] : fallback;
}

function unchangedEditDisplay(events: CalendarEvent[], editingId: string): DisplayResult {
  return {
    events,
    previewedIds: new Set([editingId]),
    editingId,
  };
}

/** Compute display events when no edit session is active. */
export function closedDisplay(storeEvents: CalendarEvent[]): DisplayResult {
  return {
    events: storeEvents,
    previewedIds: new Set(),
    editingId: undefined,
  };
}

/** Compute display events for create mode. */
export function buildCreateDisplay(
  storeEvents: CalendarEvent[],
  preview: CreatePreview | null,
  changes: Partial<CalendarEvent>,
  window: ExpansionWindow,
): DisplayResult {
  if (!preview) {
    return {
      events: storeEvents,
      previewedIds: new Set([PENDING_CREATE_ID]),
      editingId: PENDING_CREATE_ID,
    };
  }

  // Use changes.end if available (panel provides correct cross-midnight end date),
  // otherwise fall back to the drag preview's same-day end
  const isAllDay = preview.allDay || changes.allDay;
  const startStr = changes.start ? String(changes.start) : `${preview.dateStr} ${fmtMin(preview.startMinute)}`;
  const endStr = changes.end
    ? String(changes.end)
    : isAllDay && preview.endDateStr
      ? `${preview.endDateStr} 00:00`
      : `${preview.dateStr} ${fmtMin(preview.endMinute)}`;

  // If a real event with the same start/end already exists in the store,
  // the save operation has completed. Return closedDisplay to avoid
  // showing both the preview and the real event (which would cause overlap).
  const realEventExists = storeEvents.some(
    (e) => e.start === startStr && e.end === endStr && !e.id.startsWith("__")
  );
  if (realEventExists) {
    return closedDisplay(storeEvents);
  }

  const template: CalendarEvent = {
    id: PENDING_CREATE_ID,
    title: changeOr(changes, "title", preview.title) ?? "",
    start: startStr,
    end: endStr,
    timezone: "",
    calendarId: "ganbaruai",
    color: changeOr(changes, "color", preview.color),
    recurrence: changeOr(changes, "recurrence", preview.recurrence),
    pomodoroConfig: changes.pomodoroConfig,
    notifications: changes.notifications,
    meetingEnabled: changes.meetingEnabled,
    location: changes.location,
    description: changes.description,
    url: changes.url,
    transparency: changes.transparency,
    status: changes.status,
    localParticipationStatus: changes.localParticipationStatus,
    allDay: isAllDay || undefined,
  };

  const expanded = template.recurrence
    ? expandRecurring([template], window.start, window.end)
    : [template];
  const ids = new Set(expanded.map((e) => e.id));

  return {
    events: [...storeEvents, ...expanded],
    previewedIds: ids,
    editingId: PENDING_CREATE_ID,
  };
}

/**
 * Compute display events for edit mode.
 * Dispatches to the appropriate scope handler.
 */
export function computeEditDisplay(
  rawBlocks: CalendarEvent[],
  storeEvents: CalendarEvent[],
  session: { originalEvent: CalendarEvent; instanceEvent: CalendarEvent; templateId: string },
  changes: Partial<CalendarEvent>,
  scope: RecurringScope,
  window: ExpansionWindow,
  activeDate?: string,
  currentDate = fmtDate(new Date()),
  currentTime = fmtTime(new Date()),
  _activeBlockId?: string,
): DisplayResult {
  const { originalEvent, instanceEvent, templateId } = session;
  const isRecurring = !!originalEvent.recurringParentId || !!originalEvent.recurrence;
  const scopeNeedsPreview = isRecurring && scope !== "this";

  if (!scopeNeedsPreview && !hasVisibleEventChanges(originalEvent, changes)) {
    return unchangedEditDisplay(storeEvents, originalEvent.id);
  }

  if (!isRecurring) {
    return applyNonRecurring(
      storeEvents,
      originalEvent,
      changes,
      window,
    );
  }

  return buildRecurringEditPlan({
    rawBlocks,
    storeEvents,
    originalEvent,
    instanceEvent,
    templateId,
    changes,
    scope,
    window,
    currentDate,
    currentTime,
    activeDate,
  }).display;
}

/** Non-recurring: replace the event in-place with merged changes. */
export function applyNonRecurring(
  events: CalendarEvent[],
  originalEvent: CalendarEvent,
  changes: Partial<CalendarEvent>,
  window?: ExpansionWindow,
): DisplayResult {
  // If the original event no longer exists, return store as-is
  const eventExists = events.some((e) => e.id === originalEvent.id);
  if (!eventExists) {
    return closedDisplay(events);
  }
  if (!hasVisibleEventChanges(originalEvent, changes)) {
    return unchangedEditDisplay(events, originalEvent.id);
  }

  const merged = { ...originalEvent, ...changes };
  if (merged.recurrence && window) {
    const expanded = expandRecurring([
      { ...merged, id: originalEvent.id, recurringParentId: undefined },
    ], window.start, window.end);
    const ids = new Set(expanded.map((e) => e.id));
    const targetDate = merged.start.split(" ")[0];
    const editingId = expanded.find((e) => e.start.split(" ")[0] === targetDate)?.id
      ?? originalEvent.id;
    return {
      events: [...events.filter((e) => e.id !== originalEvent.id), ...expanded],
      previewedIds: ids,
      editingId,
    };
  }

  const result = events.map((e) =>
    e.id === originalEvent.id ? { ...e, ...merged, id: e.id } : e,
  );
  return {
    events: result,
    previewedIds: new Set([originalEvent.id]),
    editingId: originalEvent.id,
  };
}

export { PENDING_CREATE_ID };
export {
  applyAll,
  applyFollowing,
  applyThis,
  buildRecurringCommitPlan,
  buildRecurringEditPlan,
  dateDiffDays,
  getRecurrenceFieldOperation,
  shiftDateStr,
} from "./recurrence-edit-plan";
export type {
  DisplayResult,
  ExpansionWindow,
  RecurrenceFieldOperation,
  RecurringCommitPlan,
  RecurringEditPlan,
} from "./recurrence-edit-plan";
