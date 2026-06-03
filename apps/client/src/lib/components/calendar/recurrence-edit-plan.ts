import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent, RecurrenceConfig, RecurringScope } from "./types";
import { expandRecurring, fmtYMD, parseYMD } from "./recurrence";
import { recurrenceConfigsEqual } from "./rrule";
import {
  calendarDateTime,
  calendarEventDatePart,
  occurrenceStartsAtOrBefore,
} from "./occurrence-protection";

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

export type RecurrenceTransferTarget =
  | { kind: "event-id"; eventId: string }
  | { kind: "operation-result"; operationId: string }
  | { kind: "split-occurrence"; operationId: string; date: string };

export type RecurrenceCommitOperation =
  | {
      type: "detach-occurrence";
      operationId: string;
      templateId: string;
      occurrence: CalendarEvent;
      occurrenceDate: string;
      target: "standalone" | "recurring-template";
      patch: Partial<CalendarEvent>;
      addsException: true;
    }
  | {
      type: "cap-template";
      templateId: string;
      untilDate: string;
    }
  | {
      type: "split-series";
      operationId: string;
      templateId: string;
      occurrence: CalendarEvent;
      startDate: string;
      patch: Partial<CalendarEvent>;
    }
  | {
      type: "update-template-fields";
      templateId: string;
      selectedOccurrence: CalendarEvent;
      currentDate: string;
      currentTime: string;
      protectedUntilDate?: string;
      firstMutableDate?: string;
      patch: Partial<CalendarEvent>;
      materializeProtectedHistory: boolean;
    }
  | {
      type: "collapse-series";
      operationId: string;
      templateId: string;
      survivor: CalendarEvent;
      survivorDate: string;
      currentDate: string;
      currentTime: string;
      protectedUntilDate?: string;
      firstMutableDate?: string;
      patch: Partial<CalendarEvent>;
      materializeProtectedHistory: boolean;
    }
  | {
      type: "materialize-protected-history";
      templateId: string;
      cutoffDate: string;
      excludeDate?: string;
    }
  | {
      type: "materialize-occurrence";
      operationId: string;
      templateId: string;
      occurrence: CalendarEvent;
      occurrenceDate: string;
      reason: "active-session" | "protected-progress";
      patch?: Partial<CalendarEvent>;
    }
  | {
      type: "transfer-active-run";
      fromId: string;
      to: RecurrenceTransferTarget;
      newEnd?: string;
    }
  | {
      type: "refresh-window";
      force: true;
    };

export interface RecurrencePlanDiagnostic {
  severity: "warning" | "error";
  message: string;
}

export interface RecurringCommitPlan {
  scope: RecurringScope;
  templateId: string;
  instanceDate: string;
  recurrenceOperation: RecurrenceFieldOperation;
  recurrenceCleared: boolean;
  activeOnSelectedDate: boolean;
  activeOnToday: boolean;
  today: string;
  currentTime: string;
  operations: RecurrenceCommitOperation[];
  requiresCanonicalRefresh: boolean;
  diagnostics: RecurrencePlanDiagnostic[];
}

export interface RecurringEditPlan {
  display: DisplayResult;
  commit: RecurringCommitPlan;
}

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

function normalizeVisibleChangeValue(key: keyof CalendarEvent, value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value) && value.length === 0) return undefined;
  switch (key) {
    case "allDay":
    case "meetingEnabled":
      return value === true ? true : undefined;
    case "description":
    case "location":
      return typeof value === "string" && value.length === 0 ? undefined : value;
    case "transparency":
      return value === "opaque" ? undefined : value;
    case "status":
      return value === "confirmed" ? undefined : value;
    case "visibility":
      return value === "public" ? undefined : value;
    default:
      return value;
  }
}

export function hasVisibleEventChanges(
  originalEvent: CalendarEvent,
  changes: Partial<CalendarEvent>,
): boolean {
  for (const key of DISPLAY_CHANGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
    const changedValue = normalizeVisibleChangeValue(key, changes[key]);
    const originalValue = normalizeVisibleChangeValue(key, originalEvent[key]);
    if (key === "recurrence") {
      if (!recurrenceFieldValuesEqual(
        changedValue as RecurrenceConfig | undefined,
        originalValue as RecurrenceConfig | undefined,
      )) {
        return true;
      }
      continue;
    }
    if (!fieldEqual(changedValue, originalValue)) {
      return true;
    }
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
  return recurrenceConfigsEqual(a, b);
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

function activeDateForTemplate(
  activeBlockId: string | undefined,
  templateId: string,
  today: string,
): string | undefined {
  if (!activeBlockId) return undefined;
  const [root, date] = activeBlockId.split("::");
  if (root !== templateId) return undefined;
  return date ?? today;
}

function datePart(value: string): string {
  return calendarEventDatePart(value);
}

function exceptionsFromDate(template: CalendarEvent, startDate: string): string[] | undefined {
  const exceptions = (template.exceptions ?? []).filter((date) => date >= startDate);
  return exceptions.length > 0 ? exceptions : undefined;
}

function applyScopeOnlyPreview(
  storeEvents: CalendarEvent[],
  templateId: string,
  instanceEvent: CalendarEvent,
  scope: RecurringScope,
  activeDate?: string,
  currentDate?: string,
  currentTime?: string,
): DisplayResult {
  const instanceDate = datePart(instanceEvent.start);
  const currentDateTime = currentDate && currentTime
    ? calendarDateTime(currentDate, currentTime)
    : undefined;
  const startedArchiveScope = scope !== "this"
    && currentDateTime !== undefined
    && occurrenceIsProtected(instanceEvent, currentDateTime);
  const belongsToSeries = (event: CalendarEvent) =>
    event.id === templateId || event.recurringParentId === templateId;
  const allFutureWithStartedHistory = scope === "all"
    && !startedArchiveScope
    && currentDateTime !== undefined
    && storeEvents.some((event) =>
      belongsToSeries(event) && occurrenceIsProtected(event, currentDateTime)
    );
  const previewedIds = new Set<string>();
  let editingId: string | undefined;

  for (const event of storeEvents) {
    if (!belongsToSeries(event)) continue;
    const eventDate = datePart(event.start);
    if (eventDate === activeDate && eventDate !== instanceDate) continue;
    const affected = scope === "all"
      || (scope === "following" && eventDate >= instanceDate)
      || (scope === "this" && eventDate === instanceDate);
    if (!affected) continue;
    if (startedArchiveScope && currentDateTime && !occurrenceIsProtected(event, currentDateTime)) continue;
    if (allFutureWithStartedHistory && currentDateTime && occurrenceIsProtected(event, currentDateTime)) continue;
    previewedIds.add(event.id);
    if (eventDate === instanceDate) editingId = event.id;
  }

  return {
    events: storeEvents,
    previewedIds,
    editingId: editingId ?? instanceEvent.id,
  };
}

function occurrenceIsProtected(event: CalendarEvent, currentDateTime: string): boolean {
  return occurrenceStartsAtOrBefore(event, currentDateTime);
}

function boundaryWindowEnd(currentDate: string, selectedDate: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(selectedDate > currentDate ? selectedDate : currentDate);
}

function firstMutableOccurrenceAfter(
  template: CalendarEvent,
  currentDateTime: string,
  afterDate: Temporal.PlainDate,
): string | undefined {
  for (const years of [1, 5, 30]) {
    const occurrences = expandRecurring([template], afterDate, afterDate.add({ years }));
    const mutable = occurrences.find((occurrence) =>
      !occurrenceIsProtected(occurrence, currentDateTime)
    );
    if (mutable) return datePart(mutable.start);
  }
  return undefined;
}

function recurrenceEditBoundary(
  template: CalendarEvent,
  selectedOccurrence: CalendarEvent,
  currentDate: string,
  currentTime: string,
): {
  currentDateTime: string;
  protectedUntilDate?: string;
  firstMutableDate?: string;
} {
  const currentDateTime = calendarDateTime(currentDate, currentTime);
  const selectedDate = datePart(selectedOccurrence.start);
  const occurrences = expandRecurring(
    [template],
    Temporal.PlainDate.from(datePart(template.start)),
    boundaryWindowEnd(currentDate, selectedDate),
  );

  let protectedUntilDate: string | undefined;
  let firstMutableDate: string | undefined;

  for (const occurrence of occurrences) {
    const occurrenceDate = datePart(occurrence.start);
    if (occurrenceIsProtected(occurrence, currentDateTime)) {
      protectedUntilDate = occurrenceDate;
    } else if (!firstMutableDate) {
      firstMutableDate = occurrenceDate;
    }
  }

  if (!firstMutableDate && !occurrenceIsProtected(selectedOccurrence, currentDateTime)) {
    firstMutableDate = selectedDate;
  }
  if (!firstMutableDate && protectedUntilDate) {
    firstMutableDate = firstMutableOccurrenceAfter(
      template,
      currentDateTime,
      boundaryWindowEnd(currentDate, selectedDate).add({ days: 1 }),
    );
  }

  return { currentDateTime, protectedUntilDate, firstMutableDate };
}

function recurringPatchForDetachedResult(
  changes: Partial<CalendarEvent>,
  recurrenceOperation: RecurrenceFieldOperation,
): Partial<CalendarEvent> {
  return {
    ...changes,
    recurrence: recurrenceOperation.kind === "set"
      ? recurrenceOperation.value
      : undefined,
  };
}

function patchWithRecurrenceOperation(
  changes: Partial<CalendarEvent>,
  recurrenceOperation: RecurrenceFieldOperation,
): Partial<CalendarEvent> {
  if (recurrenceOperation.kind === "cleared") {
    return { ...changes, recurrence: undefined };
  }
  if (recurrenceOperation.kind === "set") {
    return { ...changes, recurrence: recurrenceOperation.value };
  }
  return { ...changes };
}

export function moveDatedPatchToDate<T extends Partial<CalendarEvent>>(
  data: T,
  targetDate: string,
): T {
  if (!data.start && !data.end) return data;
  if (!data.start) {
    return {
      ...data,
      end: `${targetDate} ${String(data.end).split(" ")[1]}`,
    };
  }
  if (!data.end) {
    return {
      ...data,
      start: `${targetDate} ${String(data.start).split(" ")[1]}`,
    };
  }
  const dataStartDate = String(data.start).split(" ")[0];
  const dataEndDate = String(data.end).split(" ")[0];
  const daySpan = dateDiffDays(dataStartDate, dataEndDate);
  const newEndDate = daySpan !== 0 ? shiftDateStr(targetDate, daySpan) : targetDate;
  return {
    ...data,
    start: `${targetDate} ${String(data.start).split(" ")[1]}`,
    end: `${newEndDate} ${String(data.end).split(" ")[1]}`,
  };
}

function occurrenceOnDate(source: CalendarEvent, templateId: string, date: string): CalendarEvent {
  const startTime = source.start.split(" ")[1];
  const endTime = source.end.split(" ")[1];
  return {
    ...source,
    id: `${templateId}::${date}`,
    start: `${date} ${startTime}`,
    end: `${date} ${endTime}`,
    recurringParentId: templateId,
  };
}

function appendRefreshOperation(
  operations: RecurrenceCommitOperation[],
): RecurrenceCommitOperation[] {
  return [...operations, { type: "refresh-window", force: true }];
}

function buildCommitOperations(input: {
  template: CalendarEvent | undefined;
  templateId: string;
  instanceEvent: CalendarEvent;
  changes: Partial<CalendarEvent>;
  scope: RecurringScope;
  recurrenceOperation: RecurrenceFieldOperation;
  activeBlockId?: string;
  activeDate?: string;
  activeOnSelectedDate: boolean;
  today: string;
  currentTime: string;
}): {
  operations: RecurrenceCommitOperation[];
  diagnostics: RecurrencePlanDiagnostic[];
} {
  const diagnostics: RecurrencePlanDiagnostic[] = [];
  const template = input.template;
  if (!template) {
    return {
      operations: [],
      diagnostics: [{
        severity: "error",
        message: `Missing recurrence template ${input.templateId}.`,
      }],
    };
  }

  const instanceDate = input.instanceEvent.start.split(" ")[0];
  const recurrenceCleared = input.recurrenceOperation.kind === "cleared";
  const activeDate = input.activeDate
    ?? activeDateForTemplate(input.activeBlockId, input.templateId, input.today);
  const activeAfterSelected = activeDate !== undefined && activeDate > instanceDate;

  if (input.scope === "this") {
    const operationId = "detach-selected";
    const target = input.recurrenceOperation.kind === "set" ? "recurring-template" : "standalone";
    const operations: RecurrenceCommitOperation[] = [{
      type: "detach-occurrence",
      operationId,
      templateId: input.templateId,
      occurrence: input.instanceEvent,
      occurrenceDate: instanceDate,
      target,
      patch: recurringPatchForDetachedResult(input.changes, input.recurrenceOperation),
      addsException: true,
    }];
    if (input.activeOnSelectedDate && input.activeBlockId) {
      operations.push({
        type: "transfer-active-run",
        fromId: input.activeBlockId,
        to: { kind: "operation-result", operationId },
        newEnd: input.changes.end ? String(input.changes.end) : input.instanceEvent.end,
      });
    }
    return { operations: appendRefreshOperation(operations), diagnostics };
  }

  if (input.scope === "following") {
    const operations: RecurrenceCommitOperation[] = [];
    if (activeAfterSelected && input.activeBlockId && activeDate) {
      const operationId = "materialize-active-following";
      operations.push({
        type: "materialize-occurrence",
        operationId,
        templateId: input.templateId,
        occurrence: occurrenceOnDate(template, input.templateId, activeDate),
        occurrenceDate: activeDate,
        reason: "active-session",
      });
      operations.push({
        type: "transfer-active-run",
        fromId: input.activeBlockId,
        to: { kind: "operation-result", operationId },
      });
    }

    const splitOperationId = "split-following";
    operations.push({
      type: "split-series",
      operationId: splitOperationId,
      templateId: input.templateId,
      occurrence: input.instanceEvent,
      startDate: instanceDate,
      patch: patchWithRecurrenceOperation(input.changes, input.recurrenceOperation),
    });

    return { operations: appendRefreshOperation(operations), diagnostics };
  }

  const operations: RecurrenceCommitOperation[] = [];
  const boundary = recurrenceEditBoundary(template, input.instanceEvent, input.today, input.currentTime);
  const historyCutoffDate = boundary.firstMutableDate
    ?? (boundary.protectedUntilDate ? shiftDateStr(boundary.protectedUntilDate, 1) : input.today);
  if (boundary.protectedUntilDate) {
    operations.push({
      type: "materialize-protected-history",
      templateId: input.templateId,
      cutoffDate: historyCutoffDate,
      excludeDate: recurrenceCleared || input.activeOnSelectedDate ? instanceDate : undefined,
    });
  }

  if (recurrenceCleared) {
    const collapseOperationId = "collapse-series";
    operations.push({
      type: "collapse-series",
      operationId: collapseOperationId,
      templateId: input.templateId,
      survivor: input.instanceEvent,
      survivorDate: instanceDate,
      currentDate: input.today,
      currentTime: input.currentTime,
      protectedUntilDate: boundary.protectedUntilDate,
      firstMutableDate: boundary.firstMutableDate,
      patch: recurringPatchForDetachedResult(input.changes, input.recurrenceOperation),
      materializeProtectedHistory: true,
    });
    if (input.activeOnSelectedDate && input.activeBlockId) {
      operations.push({
        type: "transfer-active-run",
        fromId: input.activeBlockId,
        to: { kind: "operation-result", operationId: collapseOperationId },
        newEnd: input.changes.end ? String(input.changes.end) : input.instanceEvent.end,
      });
    }
    return { operations: appendRefreshOperation(operations), diagnostics };
  }

  operations.push({
    type: "update-template-fields",
    templateId: input.templateId,
    selectedOccurrence: input.instanceEvent,
    currentDate: input.today,
    currentTime: input.currentTime,
    protectedUntilDate: boundary.protectedUntilDate,
    firstMutableDate: boundary.firstMutableDate,
    patch: patchWithRecurrenceOperation(input.changes, input.recurrenceOperation),
    materializeProtectedHistory: true,
  });
  return { operations: appendRefreshOperation(operations), diagnostics };
}

export function buildRecurringCommitPlan(input: {
  rawBlocks: CalendarEvent[];
  templateId: string;
  instanceEvent: CalendarEvent;
  changes: Partial<CalendarEvent>;
  scope: RecurringScope;
  activeBlockId?: string;
  activeDate?: string;
  today: string;
  currentTime: string;
}): RecurringCommitPlan {
  const template = input.rawBlocks.find((block) => block.id === input.templateId);
  const baselineRecurrence = template?.recurrence ?? input.instanceEvent.recurrence;
  const recurrenceOperation = getRecurrenceFieldOperation(baselineRecurrence, input.changes);
  const instanceDate = input.instanceEvent.start.split(" ")[0];
  const today = input.today;
  const activeBlockId = input.activeBlockId;
  const activeDate = input.activeDate
    ?? activeDateForTemplate(activeBlockId, input.templateId, today);
  const activeOnSelectedDate = activeDate === instanceDate;
  const effectiveScope = activeOnSelectedDate ? "this" : input.scope;
  const activeOnToday = activeDate === today;
  const planned = buildCommitOperations({
    template,
    templateId: input.templateId,
    instanceEvent: input.instanceEvent,
    changes: input.changes,
    scope: effectiveScope,
    recurrenceOperation,
    activeBlockId,
    activeDate,
    activeOnSelectedDate,
    today,
    currentTime: input.currentTime,
  });

  return {
    scope: effectiveScope,
    templateId: input.templateId,
    instanceDate,
    recurrenceOperation,
    recurrenceCleared: recurrenceOperation.kind === "cleared",
    activeOnSelectedDate,
    activeOnToday,
    today,
    currentTime: input.currentTime,
    operations: planned.operations,
    requiresCanonicalRefresh: planned.operations.some((operation) => operation.type === "refresh-window"),
    diagnostics: planned.diagnostics,
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
  currentDate: string;
  currentTime: string;
  activeDate?: string;
}): RecurringEditPlan {
  const instanceDate = datePart(input.instanceEvent.start);
  const effectiveScope = input.activeDate === instanceDate ? "this" : input.scope;
  const display = !hasVisibleEventChanges(input.originalEvent, input.changes)
    ? applyScopeOnlyPreview(
        input.storeEvents,
        input.templateId,
        input.instanceEvent,
        effectiveScope,
        input.activeDate,
        input.currentDate,
        input.currentTime,
      )
    : effectiveScope === "this"
        ? applyThis(
            input.storeEvents,
            input.originalEvent,
            input.changes,
          )
        : effectiveScope === "all"
          ? applyAll(
              input.rawBlocks,
              input.storeEvents,
              input.templateId,
              input.instanceEvent,
              input.changes,
              input.window,
              input.currentDate,
              input.currentTime,
              input.activeDate,
            )
          : applyFollowing(
              input.rawBlocks,
              input.storeEvents,
              input.templateId,
              input.instanceEvent,
              input.changes,
              input.window,
              input.activeDate,
              input.currentDate,
              input.currentTime,
            );

  return {
    display,
    commit: buildRecurringCommitPlan({
      rawBlocks: input.rawBlocks,
      templateId: input.templateId,
      instanceEvent: input.instanceEvent,
      changes: input.changes,
      scope: effectiveScope,
      activeBlockId: input.activeDate ? `${input.templateId}::${input.activeDate}` : undefined,
      activeDate: input.activeDate,
      today: input.currentDate,
      currentTime: input.currentTime,
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
  const recurrenceOperation = getRecurrenceFieldOperation(originalEvent.recurrence, changes);

  const merged = {
    ...originalEvent,
    ...changes,
    recurrence: recurrenceOperation.kind === "set" ? recurrenceOperation.value : undefined,
    recurringParentId: undefined,
    exceptions: undefined,
  };
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
  currentDate: string,
  currentTime: string,
  activeDate?: string,
): DisplayResult {
  const template = rawBlocks.find((b) => b.id === templateId);
  if (!template) return closedDisplay(storeEvents);

  const currentDateTime = calendarDateTime(currentDate, currentTime);
  const templateStartDate = datePart(template.start);
  const recurrenceCleared = getRecurrenceFieldOperation(template.recurrence, changes).kind === "cleared";

  const instanceDateStr = datePart(instanceEvent.start);
  const changesDateStr = changes.start ? String(changes.start).split(" ")[0] : instanceDateStr;
  const deltaDays = dateDiffDays(instanceDateStr, changesDateStr);
  const belongsToSeries = (e: CalendarEvent) =>
    e.id === templateId || e.recurringParentId === templateId;
  const hasPast = storeEvents.some((e) => belongsToSeries(e) && occurrenceIsProtected(e, currentDateTime));
  const otherEvents = storeEvents.filter((e) => !belongsToSeries(e));

  if (recurrenceCleared) {
    const targetStart = changes.start ? String(changes.start) : instanceEvent.start;
    const targetEnd = changes.end ? String(changes.end) : instanceEvent.end;
    const collapsedId = hasPast ? `__va__${templateId}` : templateId;
    const preservedSeries = hasPast
      ? storeEvents.filter((e) =>
          belongsToSeries(e)
          && occurrenceIsProtected(e, currentDateTime)
        )
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

    const previewedIds = new Set([
      ...preservedSeries
        .filter((event) => datePart(event.start) !== activeDate)
        .map((event) => event.id),
      collapsedId,
    ]);

    return {
      events: [...otherEvents, ...preservedSeries, collapsed],
      previewedIds,
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
      (e) => belongsToSeries(e) && occurrenceIsProtected(e, currentDateTime),
    );

    for (const event of pastFromStore) {
      if (datePart(event.start) !== activeDate) previewedIds.add(event.id);
      if (datePart(event.start) === instanceDateStr) editingId = event.id;
    }

    const futureFromExpanded = expanded.filter(
      (e) => belongsToSeries(e)
        && !occurrenceIsProtected(e, currentDateTime)
        && datePart(e.start) !== activeDate,
    );
    seriesEvents = [...pastFromStore, ...futureFromExpanded];

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
  activeDate?: string,
  _currentDate?: string,
  _currentTime?: string,
): DisplayResult {
  const template = rawBlocks.find((b) => b.id === templateId);
  if (!template) return closedDisplay(storeEvents);

  const instanceDateStr = instanceEvent.start.split(" ")[0];
  const recurrenceOperation = getRecurrenceFieldOperation(template.recurrence, changes);
  const recurrenceCleared = recurrenceOperation.kind === "cleared";
  const activeOnSelectedDate = activeDate === instanceDateStr;

  const splitStartDate = instanceDateStr;
  const splitSourceEvent = instanceEvent;
  const splitPatch = changes;
  const newStartDateStr = splitPatch.start ? String(splitPatch.start).split(" ")[0] : splitStartDate;

  const capDate = newStartDateStr < instanceDateStr ? newStartDateStr : instanceDateStr;
  const dayBefore = activeOnSelectedDate && recurrenceCleared
    ? instanceDateStr
    : shiftDateStr(capDate, -1);

  const cappedRecurrence: RecurrenceConfig | undefined = template.recurrence
    ? { ...template.recurrence, end: { type: "until", date: dayBefore } }
    : undefined;
  const cappedTemplate: CalendarEvent = {
    ...template,
    recurrence: cappedRecurrence,
  };

  const virtualId = `__vf__${templateId}`;
  const newStart = splitPatch.start
    ? String(splitPatch.start)
    : splitSourceEvent.start;
  const newEnd = splitPatch.end
    ? String(splitPatch.end)
    : splitSourceEvent.end;
  const recurrenceChanged = hasChange(splitPatch, "recurrence")
    && !recurrenceConfigsEqual(splitPatch.recurrence, template.recurrence);
  const newRecurrence: RecurrenceConfig | undefined = recurrenceChanged
    ? splitPatch.recurrence
    : template.recurrence
      ? { ...template.recurrence, end: { type: "never" } }
      : undefined;
  const virtualTemplate: CalendarEvent = {
    ...template,
    ...splitPatch,
    id: virtualId,
    start: newStart,
    end: newEnd,
    recurrence: newRecurrence,
    recurringParentId: undefined,
    exceptions: exceptionsFromDate(template, datePart(newStart)),
  };

  const templatesToExpand = activeOnSelectedDate && recurrenceCleared
    ? [cappedTemplate]
    : [cappedTemplate, virtualTemplate];
  const expanded = expandRecurring(templatesToExpand, window.start, window.end);

  const previewedIds = new Set<string>();
  let editingId: string | undefined;
  const changesDateStr = splitPatch.start ? String(splitPatch.start).split(" ")[0] : splitStartDate;

  for (const e of expanded) {
    if (datePart(e.start) === activeDate && activeDate !== instanceDateStr) continue;
    if (e.id === virtualId || e.recurringParentId === virtualId) {
      previewedIds.add(e.id);
    }
    if ((e.id === virtualId || e.recurringParentId === virtualId) && e.start.split(" ")[0] === changesDateStr) {
      editingId = e.id;
    }
  }
  if (activeOnSelectedDate && recurrenceCleared) {
    const selected = expanded.find((e) =>
      (e.id === templateId || e.recurringParentId === templateId)
        && e.start.split(" ")[0] === instanceDateStr
    );
    if (selected) {
      previewedIds.add(selected.id);
      editingId = selected.id;
    }
  }
  if (!editingId) editingId = activeOnSelectedDate && recurrenceCleared
    ? instanceEvent.id
    : virtualId;

  const otherEvents = storeEvents.filter((e) =>
    e.id !== templateId && e.recurringParentId !== templateId,
  );
  const affectedEvents = expanded.filter((e) =>
    (e.id === templateId || e.recurringParentId === templateId ||
      e.id === virtualId || e.recurringParentId === virtualId)
    && (datePart(e.start) !== activeDate || activeDate === instanceDateStr),
  );
  const activeMaterialized = activeDate && activeDate > instanceDateStr
    ? storeEvents.find((e) =>
        (e.id === templateId || e.recurringParentId === templateId)
          && e.start.split(" ")[0] === activeDate
      )
    : undefined;
  const activePreview: CalendarEvent[] = activeMaterialized
    ? [{
        ...activeMaterialized,
        id: `__vf_active__${templateId}::${activeDate}`,
        recurringParentId: undefined,
        recurrence: undefined,
        exceptions: undefined,
      }]
    : [];

  return {
    events: [...otherEvents, ...affectedEvents, ...activePreview],
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
