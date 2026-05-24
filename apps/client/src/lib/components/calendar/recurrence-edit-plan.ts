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
  return value.split(" ")[0];
}

function applyScopeOnlyPreview(
  storeEvents: CalendarEvent[],
  templateId: string,
  instanceEvent: CalendarEvent,
  scope: RecurringScope,
): DisplayResult {
  const instanceDate = datePart(instanceEvent.start);
  const belongsToSeries = (event: CalendarEvent) =>
    event.id === templateId || event.recurringParentId === templateId;
  const previewedIds = new Set<string>();
  let editingId: string | undefined;

  for (const event of storeEvents) {
    if (!belongsToSeries(event)) continue;
    const eventDate = datePart(event.start);
    const affected = scope === "all"
      || (scope === "following" && eventDate >= instanceDate)
      || (scope === "this" && eventDate === instanceDate);
    if (!affected) continue;
    previewedIds.add(event.id);
    if (eventDate === instanceDate) editingId = event.id;
  }

  return {
    events: storeEvents,
    previewedIds,
    editingId: editingId ?? instanceEvent.id,
  };
}

function timePart(value: string, fallback = "00:00"): string {
  return (value.split(" ")[1] ?? fallback).slice(0, 5);
}

function calendarDateTime(date: string, time: string): string {
  return `${date} ${time.slice(0, 5)}`;
}

function eventEndDateTime(event: CalendarEvent): string {
  return `${datePart(event.end)} ${timePart(event.end, "23:59")}`;
}

function occurrenceIsProtected(event: CalendarEvent, currentDateTime: string): boolean {
  return eventEndDateTime(event) <= currentDateTime;
}

function boundaryWindowEnd(currentDate: string, selectedDate: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(selectedDate > currentDate ? selectedDate : currentDate);
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
  if (!data.start || !data.end) return data;
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
  const activeDate = activeDateForTemplate(input.activeBlockId, input.templateId, input.today);
  const activeAfterSelected = activeDate !== undefined && activeDate > instanceDate;
  const activeOnDifferentOccurrence = activeDate !== undefined && activeDate !== instanceDate;

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
    if (input.activeOnSelectedDate) {
      if (recurrenceCleared) {
        return {
          operations: appendRefreshOperation([{
            type: "cap-template",
            templateId: input.templateId,
            untilDate: instanceDate,
          }]),
          diagnostics,
        };
      }

      const operationId = "split-active-selected";
      return {
        operations: appendRefreshOperation([
          {
            type: "split-series",
            operationId,
            templateId: input.templateId,
            occurrence: input.instanceEvent,
            startDate: instanceDate,
            patch: patchWithRecurrenceOperation(input.changes, input.recurrenceOperation),
          },
          {
            type: "transfer-active-run",
            fromId: input.activeBlockId ?? input.instanceEvent.id,
            to: { kind: "operation-result", operationId },
            newEnd: input.changes.end ? String(input.changes.end) : input.instanceEvent.end,
          },
        ]),
        diagnostics,
      };
    }

    const operations: RecurrenceCommitOperation[] = [];
    if (recurrenceCleared && activeAfterSelected && input.activeBlockId && activeDate) {
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

    if (!recurrenceCleared && activeAfterSelected && input.activeBlockId && activeDate) {
      operations.push({
        type: "transfer-active-run",
        fromId: input.activeBlockId,
        to: { kind: "split-occurrence", operationId: splitOperationId, date: activeDate },
      });
    }

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
      excludeDate: recurrenceCleared ? instanceDate : undefined,
    });
  }

  if (recurrenceCleared) {
    if (activeOnDifferentOccurrence && input.activeBlockId && activeDate) {
      const operationId = "materialize-active-all";
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
  if (input.activeBlockId && activeDate) {
    operations.push({
      type: "transfer-active-run",
      fromId: input.activeBlockId,
      to: { kind: "split-occurrence", operationId: input.templateId, date: activeDate },
      newEnd: input.activeOnSelectedDate && input.changes.end
        ? String(input.changes.end)
        : undefined,
    });
  }
  return { operations: appendRefreshOperation(operations), diagnostics };
}

export function buildRecurringCommitPlan(input: {
  rawBlocks: CalendarEvent[];
  templateId: string;
  instanceEvent: CalendarEvent;
  changes: Partial<CalendarEvent>;
  scope: RecurringScope;
  activeBlockId?: string;
  today: string;
  currentTime: string;
}): RecurringCommitPlan {
  const template = input.rawBlocks.find((block) => block.id === input.templateId);
  const baselineRecurrence = template?.recurrence ?? input.instanceEvent.recurrence;
  const recurrenceOperation = getRecurrenceFieldOperation(baselineRecurrence, input.changes);
  const instanceDate = input.instanceEvent.start.split(" ")[0];
  const today = input.today;
  const activeBlockId = input.activeBlockId;
  const activeOnSelectedDate = activeBlockId === input.instanceEvent.id
    || activeBlockId === `${input.templateId}::${instanceDate}`;
  const activeOnToday = activeBlockId === input.templateId
    || activeBlockId === `${input.templateId}::${today}`;
  const planned = buildCommitOperations({
    template,
    templateId: input.templateId,
    instanceEvent: input.instanceEvent,
    changes: input.changes,
    scope: input.scope,
    recurrenceOperation,
    activeBlockId,
    activeOnSelectedDate,
    today,
    currentTime: input.currentTime,
  });

  return {
    scope: input.scope,
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
  const display = !hasVisibleEventChanges(input.originalEvent, input.changes)
    ? applyScopeOnlyPreview(
        input.storeEvents,
        input.templateId,
        input.instanceEvent,
        input.scope,
      )
    : input.scope === "this"
        ? applyThis(input.storeEvents, input.originalEvent, input.changes)
        : input.scope === "all"
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
  currentDate: string,
  currentTime: string,
  activeDate?: string,
): DisplayResult {
  const template = rawBlocks.find((b) => b.id === templateId);
  if (!template) return closedDisplay(storeEvents);

  const todayStr = currentDate;
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
      ? storeEvents.filter((e) => belongsToSeries(e) && occurrenceIsProtected(e, currentDateTime))
      : [];
    const activeMaterialized = activeDate && activeDate !== instanceDateStr
      ? storeEvents.find((e) => belongsToSeries(e) && e.start.split(" ")[0] === activeDate)
      : undefined;
    const activePreview: CalendarEvent[] = activeMaterialized
      ? [{
          ...activeMaterialized,
          id: `__va_active__${templateId}::${activeDate}`,
          recurringParentId: undefined,
          recurrence: undefined,
          exceptions: undefined,
        }]
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
      ...preservedSeries.map((event) => event.id),
      collapsedId,
      ...activePreview.map((event) => event.id),
    ]);

    return {
      events: [...otherEvents, ...preservedSeries, ...activePreview, collapsed],
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
      previewedIds.add(event.id);
      if (datePart(event.start) === instanceDateStr) editingId = event.id;
    }

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

        const nowTime = currentTime;
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
        && !occurrenceIsProtected(e, currentDateTime)
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
  activeDate?: string,
): DisplayResult {
  const template = rawBlocks.find((b) => b.id === templateId);
  if (!template) return closedDisplay(storeEvents);

  const instanceDateStr = instanceEvent.start.split(" ")[0];
  const recurrenceOperation = getRecurrenceFieldOperation(template.recurrence, changes);
  const recurrenceCleared = recurrenceOperation.kind === "cleared";
  const activeOnSelectedDate = activeDate === instanceDateStr;
  const splitStartDate = activeOnSelectedDate && !recurrenceCleared
    ? shiftDateStr(instanceDateStr, 1)
    : instanceDateStr;
  const splitSourceEvent = activeOnSelectedDate && !recurrenceCleared
    ? occurrenceOnDate(instanceEvent, templateId, splitStartDate)
    : instanceEvent;
  const splitPatch = activeOnSelectedDate && !recurrenceCleared
    ? moveDatedPatchToDate(changes, splitStartDate)
    : changes;
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
    && !fieldEqual(splitPatch.recurrence, template.recurrence);
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
    exceptions: undefined,
  };

  const templatesToExpand = activeOnSelectedDate && recurrenceCleared
    ? [cappedTemplate]
    : [cappedTemplate, virtualTemplate];
  const expanded = expandRecurring(templatesToExpand, window.start, window.end);

  const previewedIds = new Set<string>();
  let editingId: string | undefined;
  const changesDateStr = splitPatch.start ? String(splitPatch.start).split(" ")[0] : splitStartDate;

  for (const e of expanded) {
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
    e.id === templateId || e.recurringParentId === templateId ||
    e.id === virtualId || e.recurringParentId === virtualId,
  );
  const activeMaterialized = recurrenceCleared && activeDate && activeDate > instanceDateStr
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
  for (const event of activePreview) previewedIds.add(event.id);

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
