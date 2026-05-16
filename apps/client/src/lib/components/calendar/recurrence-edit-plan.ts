import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent, RecurrenceConfig, RecurringScope } from "./types";
import { expandRecurring, fmtYMD, parseYMD } from "./recurrence";

/**
 * Inclusive date window used by recurrence expansion. Edit-flow consumers
 * thread the active calendar viewport here so previews honor the same
 * windowed expansion the store uses.
 */
export interface ExpansionWindow {
  start: Temporal.PlainDate;
  end: Temporal.PlainDate;
}

export interface DisplayResult {
  events: CalendarEvent[];
  previewedIds: Set<string>;
  editingId: string | undefined;
}

export type FieldOperation<T> =
  | { kind: "unchanged"; value: T | undefined }
  | { kind: "cleared" }
  | { kind: "set"; value: T };

export type RecurrenceFieldOperation = FieldOperation<RecurrenceConfig>;

export interface RecurringCommitPlan {
  scope: RecurringScope;
  templateId: string;
  instanceDate: string;
  recurrenceOperation: RecurrenceFieldOperation;
  recurrenceCleared: boolean;
  activeOnSelectedDate: boolean;
  activeOnToday: boolean;
  today: string;
}

export interface RecurringEditPlan {
  display: DisplayResult;
  commit: RecurringCommitPlan;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const DISPLAY_CHANGE_KEYS = [
  "title",
  "start",
  "end",
  "color",
  "recurrence",
  "pomodoroConfig",
  "allDay",
  "meetingEnabled",
  "location",
  "transparency",
  "status",
  "localParticipationStatus",
  "rdate",
] satisfies (keyof CalendarEvent)[];

export function fieldEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null && b === null) return true;
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function hasVisibleEventChanges(
  originalEvent: CalendarEvent,
  changes: Partial<CalendarEvent>,
): boolean {
  for (const key of DISPLAY_CHANGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
    if (!fieldEqual(changes[key], originalEvent[key])) return true;
  }
  return false;
}

export function hasChange<K extends keyof CalendarEvent>(
  changes: Partial<CalendarEvent>,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(changes, key);
}

export function recurrenceFieldValuesEqual(
  a: RecurrenceConfig | undefined,
  b: RecurrenceConfig | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function getRecurrenceFieldOperation(
  baseline: RecurrenceConfig | undefined,
  changes: Partial<CalendarEvent>,
): RecurrenceFieldOperation {
  if (!hasChange(changes, "recurrence")) {
    return { kind: "unchanged", value: baseline };
  }
  if (changes.recurrence === undefined) {
    return baseline === undefined
      ? { kind: "unchanged", value: undefined }
      : { kind: "cleared" };
  }
  return recurrenceFieldValuesEqual(changes.recurrence, baseline)
    ? { kind: "unchanged", value: baseline }
    : { kind: "set", value: changes.recurrence };
}

function closedDisplay(storeEvents: CalendarEvent[]): DisplayResult {
  return {
    events: storeEvents,
    previewedIds: new Set(),
    editingId: undefined,
  };
}

function unchangedEditDisplay(events: CalendarEvent[], editingId: string): DisplayResult {
  return {
    events,
    previewedIds: new Set([editingId]),
    editingId,
  };
}

export function buildRecurringCommitPlan(input: {
  rawBlocks: CalendarEvent[];
  templateId: string;
  instanceEvent: CalendarEvent;
  changes: Partial<CalendarEvent>;
  scope: RecurringScope;
  activeBlockId?: string;
  today?: string;
}): RecurringCommitPlan {
  const template = input.rawBlocks.find((block) => block.id === input.templateId);
  const baselineRecurrence = template?.recurrence ?? input.instanceEvent.recurrence;
  const recurrenceOperation = getRecurrenceFieldOperation(baselineRecurrence, input.changes);
  const instanceDate = input.instanceEvent.start.split(" ")[0];
  const today = input.today ?? fmtYMD(new Date());
  const activeBlockId = input.activeBlockId;
  const activeOnSelectedDate = activeBlockId === input.instanceEvent.id
    || activeBlockId === `${input.templateId}::${instanceDate}`;
  const activeOnToday = activeBlockId === input.templateId
    || activeBlockId === `${input.templateId}::${today}`;

  return {
    scope: input.scope,
    templateId: input.templateId,
    instanceDate,
    recurrenceOperation,
    recurrenceCleared: recurrenceOperation.kind === "cleared",
    activeOnSelectedDate,
    activeOnToday,
    today,
  };
}

export function buildRecurringEditPlan(input: {
  rawBlocks: CalendarEvent[];
  storeEvents: CalendarEvent[];
  originalEvent: CalendarEvent;
  instanceEvent: CalendarEvent;
  templateId: string;
  changes: Partial<CalendarEvent>;
  scope: RecurringScope;
  window: ExpansionWindow;
  activeDate?: string;
}): RecurringEditPlan {
  const display = input.scope === "this"
    ? applyThis(input.storeEvents, input.originalEvent, input.changes)
    : input.scope === "all"
      ? applyAll(
          input.rawBlocks,
          input.storeEvents,
          input.templateId,
          input.instanceEvent,
          input.changes,
          input.window,
          input.activeDate,
        )
      : applyFollowing(
          input.rawBlocks,
          input.storeEvents,
          input.templateId,
          input.instanceEvent,
          input.changes,
          input.window,
        );

  return {
    display,
    commit: buildRecurringCommitPlan({
      rawBlocks: input.rawBlocks,
      templateId: input.templateId,
      instanceEvent: input.instanceEvent,
      changes: input.changes,
      scope: input.scope,
      activeBlockId: input.activeDate ? `${input.templateId}::${input.activeDate}` : undefined,
    }),
  };
}

/**
 * "This" scope: replace only the specific instance in-place.
 * No re-expansion needed since the event replaces itself at the same position.
 */
export function applyThis(
  events: CalendarEvent[],
  originalEvent: CalendarEvent,
  changes: Partial<CalendarEvent>,
): DisplayResult {
  const targetId = originalEvent.id;

  const eventExists = events.some((e) => e.id === targetId);
  if (!eventExists) {
    return closedDisplay(events);
  }
  if (!hasVisibleEventChanges(originalEvent, changes)) {
    return unchangedEditDisplay(events, targetId);
  }

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
 * "All" scope: patch the template and re-expand, but keep past instances
 * frozen at their original positions. Only today and future instances show
 * the preview changes, matching the save behavior.
 */
export function applyAll(
  rawBlocks: CalendarEvent[],
  storeEvents: CalendarEvent[],
  templateId: string,
  instanceEvent: CalendarEvent,
  changes: Partial<CalendarEvent>,
  window: ExpansionWindow,
  activeDate?: string,
): DisplayResult {
  const template = rawBlocks.find((b) => b.id === templateId);
  if (!template) return closedDisplay(storeEvents);

  const todayStr = fmtYMD(new Date());
  const templateStartDate = template.start.split(" ")[0];
  const hasPast = templateStartDate < todayStr;
  const recurrenceCleared = getRecurrenceFieldOperation(template.recurrence, changes).kind === "cleared";

  const instanceDateStr = instanceEvent.start.split(" ")[0];
  const changesDateStr = changes.start ? String(changes.start).split(" ")[0] : instanceDateStr;
  const deltaDays = dateDiffDays(instanceDateStr, changesDateStr);
  const belongsToSeries = (e: CalendarEvent) =>
    e.id === templateId || e.recurringParentId === templateId;
  const otherEvents = storeEvents.filter((e) => !belongsToSeries(e));

  if (recurrenceCleared) {
    const targetStart = changes.start ? String(changes.start) : instanceEvent.start;
    const targetEnd = changes.end ? String(changes.end) : instanceEvent.end;
    const collapsedId = hasPast ? `__va__${templateId}` : templateId;
    const splitDate = hasPast && instanceDateStr < todayStr ? instanceDateStr : todayStr;
    const preservedSeries = hasPast
      ? storeEvents.filter((e) => belongsToSeries(e) && e.start.split(" ")[0] < splitDate)
      : [];
    const collapsed: CalendarEvent = {
      ...template,
      ...changes,
      id: collapsedId,
      start: targetStart,
      end: targetEnd,
      recurrence: undefined,
      recurringParentId: undefined,
      exceptions: undefined,
    };

    return {
      events: [...otherEvents, ...preservedSeries, collapsed],
      previewedIds: new Set([collapsedId]),
      editingId: collapsedId,
    };
  }

  const newStartDate = deltaDays !== 0 ? shiftDateStr(templateStartDate, deltaDays) : templateStartDate;
  const changesEndDateStr = changes.end ? String(changes.end).split(" ")[0] : changesDateStr;
  const changesDaySpan = dateDiffDays(changesDateStr, changesEndDateStr);
  const newEndDate = shiftDateStr(newStartDate, changesDaySpan);
  const newStartTime = changes.start ? String(changes.start).split(" ")[1] : template.start.split(" ")[1];
  const newEndTime = changes.end ? String(changes.end).split(" ")[1] : template.end.split(" ")[1];

  const patched: CalendarEvent = {
    ...template,
    ...changes,
    id: template.id,
    start: `${newStartDate} ${newStartTime}`,
    end: `${newEndDate} ${newEndTime}`,
    recurringParentId: undefined,
  };

  const expanded = expandRecurring([patched], window.start, window.end);

  let seriesEvents: CalendarEvent[];
  const previewedIds = new Set<string>();
  let editingId: string | undefined;

  if (hasPast) {
    const pastFromStore = storeEvents.filter(
      (e) => belongsToSeries(e) && e.start.split(" ")[0] < todayStr,
    );

    const activeDayEvents: CalendarEvent[] = [];

    if (activeDate && activeDate >= todayStr) {
      const todayOriginal = storeEvents.find(
        (e) => belongsToSeries(e) && e.start.split(" ")[0] === activeDate,
      );
      if (todayOriginal) {
        const newSTime = changes.start ? String(changes.start).split(" ")[1] : todayOriginal.start.split(" ")[1];
        const newETime = changes.end ? String(changes.end).split(" ")[1] : todayOriginal.end.split(" ")[1];
        let endDateForActive = activeDate;
        if (changes.start && changes.end) {
          const span = dateDiffDays(String(changes.start).split(" ")[0], String(changes.end).split(" ")[0]);
          if (span !== 0) endDateForActive = shiftDateStr(activeDate, span);
        }

        const now = new Date();
        const nowTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
        const newStartOnToday = `${activeDate} ${newSTime}`;
        const newEndOnToday = `${endDateForActive} ${newETime}`;
        const nowStr = `${activeDate} ${nowTime}`;

        if (nowStr >= newStartOnToday && nowStr < newEndOnToday) {
          const hybridEnd = newEndOnToday > nowStr ? newEndOnToday : nowStr;
          const hybrid: CalendarEvent = {
            ...todayOriginal,
            ...changes,
            id: todayOriginal.id,
            start: todayOriginal.start,
            end: hybridEnd,
          };
          activeDayEvents.push(hybrid);
          previewedIds.add(hybrid.id);
          if (activeDate === changesDateStr) editingId = hybrid.id;
        } else {
          const capped: CalendarEvent = {
            ...todayOriginal,
            id: todayOriginal.id,
            start: todayOriginal.start,
            end: nowStr,
          };
          activeDayEvents.push(capped);
          previewedIds.add(capped.id);

          if (nowStr < newEndOnToday) {
            const newBlock: CalendarEvent = {
              ...todayOriginal,
              ...changes,
              id: `${todayOriginal.id}::preview`,
              start: newStartOnToday,
              end: newEndOnToday,
              recurringParentId: undefined,
              recurrence: undefined,
            };
            activeDayEvents.push(newBlock);
            previewedIds.add(newBlock.id);
          }
        }
      }
    }

    const futureFromExpanded = expanded.filter(
      (e) => belongsToSeries(e)
        && e.start.split(" ")[0] >= todayStr
        && (!activeDate || e.start.split(" ")[0] !== activeDate),
    );
    seriesEvents = [...pastFromStore, ...activeDayEvents, ...futureFromExpanded];

    for (const e of futureFromExpanded) {
      previewedIds.add(e.id);
      if (e.start.split(" ")[0] === changesDateStr) editingId = e.id;
    }
  } else {
    seriesEvents = expanded.filter(belongsToSeries);
    for (const e of seriesEvents) {
      previewedIds.add(e.id);
      if (e.start.split(" ")[0] === changesDateStr) editingId = e.id;
    }
  }

  if (!editingId) editingId = templateId;

  return {
    events: [...otherEvents, ...seriesEvents],
    previewedIds,
    editingId,
  };
}

/**
 * "Following" scope: cap old template at day before instance, create virtual
 * new template for future instances. No DB mutation, pure computation.
 */
export function applyFollowing(
  rawBlocks: CalendarEvent[],
  storeEvents: CalendarEvent[],
  templateId: string,
  instanceEvent: CalendarEvent,
  changes: Partial<CalendarEvent>,
  window: ExpansionWindow,
): DisplayResult {
  const template = rawBlocks.find((b) => b.id === templateId);
  if (!template) return closedDisplay(storeEvents);

  const instanceDateStr = instanceEvent.start.split(" ")[0];
  const newStartDateStr = changes.start ? String(changes.start).split(" ")[0] : instanceDateStr;

  const capDate = newStartDateStr < instanceDateStr ? newStartDateStr : instanceDateStr;
  const dayBefore = shiftDateStr(capDate, -1);

  const cappedRecurrence: RecurrenceConfig | undefined = template.recurrence
    ? { ...template.recurrence, end: { type: "until", date: dayBefore } }
    : undefined;
  const cappedTemplate: CalendarEvent = {
    ...template,
    recurrence: cappedRecurrence,
  };

  const virtualId = `__vf__${templateId}`;
  const newStart = changes.start
    ? String(changes.start)
    : instanceEvent.start;
  const newEnd = changes.end
    ? String(changes.end)
    : instanceEvent.end;
  const recurrenceChanged = hasChange(changes, "recurrence")
    && !fieldEqual(changes.recurrence, template.recurrence);
  const newRecurrence: RecurrenceConfig | undefined = recurrenceChanged
    ? changes.recurrence
    : template.recurrence
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

  const expanded = expandRecurring([cappedTemplate, virtualTemplate], window.start, window.end);

  const previewedIds = new Set<string>();
  let editingId: string | undefined;
  const changesDateStr = changes.start ? String(changes.start).split(" ")[0] : instanceDateStr;

  for (const e of expanded) {
    if (e.id === virtualId || e.recurringParentId === virtualId) {
      previewedIds.add(e.id);
    }
    if ((e.id === virtualId || e.recurringParentId === virtualId) && e.start.split(" ")[0] === changesDateStr) {
      editingId = e.id;
    }
  }
  if (!editingId) editingId = virtualId;

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
