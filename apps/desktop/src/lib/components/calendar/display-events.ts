/**
 * Pure functions that overlay edit session changes onto clean expanded events.
 * No store mutation, no fake IDs. Events keep their real IDs throughout.
 */

import type { CalendarEvent, RecurrenceConfig, RecurringScope } from "./types";
import type { CreatePreview } from "./edit-session.svelte";
import { expandRecurring, parseYMD, fmtYMD } from "./recurrence";

export interface DisplayResult {
  events: CalendarEvent[];
  previewedIds: Set<string>;
  editingId: string | undefined;
}

const PENDING_CREATE_ID = "__pending_create__";
const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtMin = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

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
  const endStr = changes.end
    ? String(changes.end)
    : isAllDay && preview.endDateStr
      ? `${preview.endDateStr} 00:00`
      : `${preview.dateStr} ${fmtMin(preview.endMinute)}`;

  const template: CalendarEvent = {
    id: PENDING_CREATE_ID,
    title: preview.title ?? changes.title ?? "",
    start: changes.start ? String(changes.start) : `${preview.dateStr} ${fmtMin(preview.startMinute)}`,
    end: endStr,
    timezone: "",
    calendarId: "ganbaruai",
    color: preview.color ?? changes.color,
    recurrence: preview.recurrence ?? changes.recurrence,
    pomodoroConfig: changes.pomodoroConfig,
    allDay: isAllDay || undefined,
  };

  const expanded = template.recurrence ? expandRecurring([template]) : [template];
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
): DisplayResult {
  const { originalEvent, instanceEvent, templateId } = session;
  const isRecurring = !!originalEvent.recurringParentId || !!originalEvent.recurrence;

  if (!isRecurring) {
    return applyNonRecurring(storeEvents, originalEvent, changes);
  }

  switch (scope) {
    case "this":
      return applyThis(storeEvents, originalEvent, instanceEvent, changes);
    case "all":
      return applyAll(rawBlocks, storeEvents, templateId, instanceEvent, changes);
    case "following":
      return applyFollowing(rawBlocks, storeEvents, templateId, instanceEvent, changes);
  }
}

/** Non-recurring: replace the event in-place with merged changes. */
export function applyNonRecurring(
  events: CalendarEvent[],
  originalEvent: CalendarEvent,
  changes: Partial<CalendarEvent>,
): DisplayResult {
  const merged = { ...originalEvent, ...changes };
  const result = events.map((e) =>
    e.id === originalEvent.id ? { ...e, ...merged, id: e.id } : e,
  );
  return {
    events: result,
    previewedIds: new Set([originalEvent.id]),
    editingId: originalEvent.id,
  };
}

/**
 * "This" scope: replace only the specific instance in-place.
 * No re-expansion needed since the event replaces itself at the same position.
 */
export function applyThis(
  events: CalendarEvent[],
  originalEvent: CalendarEvent,
  instanceEvent: CalendarEvent,
  changes: Partial<CalendarEvent>,
): DisplayResult {
  const targetId = originalEvent.id;
  const merged = { ...originalEvent, ...changes };
  const result = events.map((e) =>
    e.id === targetId ? { ...e, ...merged, id: e.id } : e,
  );
  return {
    events: result,
    previewedIds: new Set([targetId]),
    editingId: targetId,
  };
}

/**
 * "All" scope: patch the template and re-expand the whole series.
 * The instance's day delta is applied to the template's start/end dates.
 */
export function applyAll(
  rawBlocks: CalendarEvent[],
  storeEvents: CalendarEvent[],
  templateId: string,
  instanceEvent: CalendarEvent,
  changes: Partial<CalendarEvent>,
): DisplayResult {
  const template = rawBlocks.find((b) => b.id === templateId);
  if (!template) return closedDisplay(storeEvents);

  // Compute day delta between instance date and changes date
  const instanceDateStr = instanceEvent.start.split(" ")[0];
  const changesDateStr = changes.start ? String(changes.start).split(" ")[0] : instanceDateStr;
  const deltaDays = dateDiffDays(instanceDateStr, changesDateStr);

  // Compute new template dates
  const templateStartDate = template.start.split(" ")[0];
  const templateEndDate = template.end.split(" ")[0];
  const newStartDate = deltaDays !== 0 ? shiftDateStr(templateStartDate, deltaDays) : templateStartDate;
  const newEndDate = deltaDays !== 0 ? shiftDateStr(templateEndDate, deltaDays) : templateEndDate;
  const newStartTime = changes.start ? String(changes.start).split(" ")[1] : template.start.split(" ")[1];
  const newEndTime = changes.end ? String(changes.end).split(" ")[1] : template.end.split(" ")[1];

  // Build patched template
  const patched: CalendarEvent = {
    ...template,
    ...changes,
    id: template.id,
    start: `${newStartDate} ${newStartTime}`,
    end: `${newEndDate} ${newEndTime}`,
    recurringParentId: undefined,
  };

  // Re-expand with patched template
  const patchedRaw = rawBlocks.map((b) => b.id === templateId ? patched : b);
  const expanded = expandRecurring(patchedRaw);

  // Collect all IDs from this series
  const previewedIds = new Set<string>();
  let editingId: string | undefined;
  for (const e of expanded) {
    if (e.id === templateId || e.recurringParentId === templateId) {
      previewedIds.add(e.id);
      // The editing instance is the one on the changes date
      const eDate = e.start.split(" ")[0];
      if (eDate === changesDateStr) {
        editingId = e.id;
      }
    }
  }
  // Fallback: if no instance lands on the exact date, use template
  if (!editingId) editingId = templateId;

  // Replace all events from this template with re-expanded versions,
  // keep events from other templates unchanged
  const otherEvents = storeEvents.filter((e) =>
    e.id !== templateId && e.recurringParentId !== templateId,
  );
  const seriesEvents = expanded.filter((e) =>
    e.id === templateId || e.recurringParentId === templateId,
  );

  return {
    events: [...otherEvents, ...seriesEvents],
    previewedIds,
    editingId,
  };
}

/**
 * "Following" scope: cap old template at day before instance, create virtual
 * new template for future instances. No DB mutation -- pure computation.
 */
export function applyFollowing(
  rawBlocks: CalendarEvent[],
  storeEvents: CalendarEvent[],
  templateId: string,
  instanceEvent: CalendarEvent,
  changes: Partial<CalendarEvent>,
): DisplayResult {
  const template = rawBlocks.find((b) => b.id === templateId);
  if (!template) return closedDisplay(storeEvents);

  const instanceDateStr = instanceEvent.start.split(" ")[0];
  const newStartDateStr = changes.start ? String(changes.start).split(" ")[0] : instanceDateStr;

  // Cap date: day before the earlier of instance date and new start date
  const capDate = newStartDateStr < instanceDateStr ? newStartDateStr : instanceDateStr;
  const dayBefore = shiftDateStr(capDate, -1);

  // Cap old template's recurrence
  const cappedRecurrence: RecurrenceConfig | undefined = template.recurrence
    ? { ...template.recurrence, end: { type: "until", date: dayBefore } }
    : undefined;
  const cappedTemplate: CalendarEvent = {
    ...template,
    recurrence: cappedRecurrence,
  };

  // New virtual template for "following" instances
  const virtualId = `__vf__${templateId}`;
  const newStart = changes.start
    ? String(changes.start)
    : instanceEvent.start;
  const newEnd = changes.end
    ? String(changes.end)
    : instanceEvent.end;
  const newRecurrence: RecurrenceConfig | undefined = template.recurrence
    ? { ...template.recurrence, end: { type: "never" } }
    : undefined;
  const virtualTemplate: CalendarEvent = {
    ...template,
    ...changes,
    id: virtualId,
    start: newStart,
    end: newEnd,
    recurrence: newRecurrence,
    recurringParentId: undefined,
    exceptions: undefined,
  };

  // Re-expand both old capped + new virtual
  const patchedRaw = rawBlocks.map((b) => b.id === templateId ? cappedTemplate : b);
  const expanded = expandRecurring([...patchedRaw, virtualTemplate]);

  // Collect preview IDs: all from old capped template + all from virtual template
  const previewedIds = new Set<string>();
  let editingId: string | undefined;
  const changesDateStr = changes.start ? String(changes.start).split(" ")[0] : instanceDateStr;

  for (const e of expanded) {
    // Only preview instances from the virtual (following) template
    if (e.id === virtualId || e.recurringParentId === virtualId) {
      previewedIds.add(e.id);
    }
    // The editing instance from the virtual template on the target date
    if ((e.id === virtualId || e.recurringParentId === virtualId) && e.start.split(" ")[0] === changesDateStr) {
      editingId = e.id;
    }
  }
  if (!editingId) editingId = virtualId;

  // Replace events from this template with re-expanded versions
  const otherEvents = storeEvents.filter((e) =>
    e.id !== templateId && e.recurringParentId !== templateId,
  );
  const affectedEvents = expanded.filter((e) =>
    e.id === templateId || e.recurringParentId === templateId ||
    e.id === virtualId || e.recurringParentId === virtualId,
  );

  return {
    events: [...otherEvents, ...affectedEvents],
    previewedIds,
    editingId,
  };
}

// --- Helpers ---

export function dateDiffDays(fromDateStr: string, toDateStr: string): number {
  return Math.round(
    (parseYMD(toDateStr).getTime() - parseYMD(fromDateStr).getTime()) / 86400000,
  );
}

export function shiftDateStr(dateStr: string, days: number): string {
  const d = parseYMD(dateStr);
  d.setDate(d.getDate() + days);
  return fmtYMD(d);
}

export { PENDING_CREATE_ID };
