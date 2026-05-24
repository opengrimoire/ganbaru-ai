import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent, RecurringScope } from "./types";
import { expandRecurring } from "./recurrence";
import { recurrenceToRrule } from "./rrule";
import {
  buildCalendarEventMutationTarget,
  concreteRecurringOccurrenceForMutation,
} from "$lib/stores/calendar-mutations";
import type { CalendarEventMutationTarget } from "$lib/stores/calendar-mutations";

export type CalendarDeleteArchiveOutcome = "delete" | "archive" | "mixed";

export type EventProtectionReason = "started" | "active" | "pomodoro-history";

export interface EventProtection {
  protected: boolean;
  reason?: EventProtectionReason;
}

export type CalendarDeleteArchiveOperation =
  | { type: "delete_event"; target: CalendarEventMutationTarget }
  | { type: "archive_event"; target: CalendarEventMutationTarget }
  | { type: "cap_series"; eventId: string; repeatUntil: string; rrule: string };

export interface CalendarDeleteArchiveRestoreSnapshot {
  event: CalendarEvent;
  restoreMode: "insert" | "update";
}

export interface CalendarDeleteArchiveRestoreMetadata {
  archivedEvents: CalendarEvent[];
  snapshots: CalendarDeleteArchiveRestoreSnapshot[];
}

export interface CalendarDeleteArchivePlan {
  affectedVisibleIds: Set<string>;
  finalVisibleEvents: CalendarEvent[];
  outcome: CalendarDeleteArchiveOutcome;
  requiresActiveStop: boolean;
  operations: CalendarDeleteArchiveOperation[];
  restore: CalendarDeleteArchiveRestoreMetadata;
}

export interface ActivePomodoroIdentity {
  blockId: string | null | undefined;
  eventDate?: string;
}

export interface BuildCalendarDeleteArchivePlanInput {
  rawBlocks: CalendarEvent[];
  visibleEvents: CalendarEvent[];
  selectedEvent: CalendarEvent;
  scope?: RecurringScope;
  now: Date;
  activePomodoro?: ActivePomodoroIdentity;
  protectedEventIds?: ReadonlySet<string>;
}

function datePart(value: string): string {
  return value.split(" ")[0];
}

function wallClockMs(value: string): number {
  return new Date(value.replace(" ", "T")).getTime();
}

function currentDatePart(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

function rootIdForEvent(event: CalendarEvent): string {
  return (event.recurringParentId ?? event.id).split("::")[0];
}

export function exactOccurrenceId(event: CalendarEvent, template?: CalendarEvent): string {
  const recurringRoot = event.recurringParentId
    ?? template?.id
    ?? (event.recurrence ? event.id : undefined);
  if (!recurringRoot) return event.id;
  return `${recurringRoot.split("::")[0]}::${datePart(event.start)}`;
}

function activeOccurrenceDate(active: ActivePomodoroIdentity | undefined): string | undefined {
  if (!active?.blockId) return undefined;
  const [, syntheticDate] = active.blockId.split("::");
  return syntheticDate ?? active.eventDate;
}

function activeRootId(active: ActivePomodoroIdentity | undefined): string | undefined {
  return active?.blockId?.split("::")[0];
}

export function eventMatchesActiveOccurrence(
  event: CalendarEvent,
  active: ActivePomodoroIdentity | undefined,
  template?: CalendarEvent,
): boolean {
  const activeRoot = activeRootId(active);
  if (!activeRoot) return false;
  const eventRoot = rootIdForEvent(template ?? event);
  if (eventRoot !== activeRoot) return false;

  const activeDate = activeOccurrenceDate(active);
  if (!activeDate) {
    return event.id === active?.blockId || rootIdForEvent(event) === activeRoot;
  }
  return datePart(event.start) === activeDate;
}

function isStarted(event: CalendarEvent, now: Date): boolean {
  const startMs = wallClockMs(event.start);
  return Number.isFinite(startMs) && startMs <= now.getTime();
}

export function classifyEventProtection(
  event: CalendarEvent,
  input: {
    now: Date;
    activePomodoro?: ActivePomodoroIdentity;
    protectedEventIds?: ReadonlySet<string>;
    template?: CalendarEvent;
  },
): EventProtection {
  const exactId = exactOccurrenceId(event, input.template);
  if (
    input.protectedEventIds?.has(event.id)
    || input.protectedEventIds?.has(exactId)
  ) {
    return { protected: true, reason: "pomodoro-history" };
  }
  if (eventMatchesActiveOccurrence(event, input.activePomodoro, input.template)) {
    return { protected: true, reason: "active" };
  }
  if (isStarted(event, input.now)) {
    return { protected: true, reason: "started" };
  }
  return { protected: false };
}

function belongsToSeries(event: CalendarEvent, templateId: string): boolean {
  return event.id === templateId
    || event.recurringParentId === templateId
    || event.id.startsWith(`${templateId}::`);
}

function recurringAffectedVisibleEvents(
  visibleEvents: CalendarEvent[],
  templateId: string,
  selectedDate: string,
  scope: RecurringScope,
): CalendarEvent[] {
  return visibleEvents.filter((event) => {
    if (!belongsToSeries(event, templateId)) return false;
    const eventDate = datePart(event.start);
    return scope === "all"
      || (scope === "following" && eventDate >= selectedDate)
      || (scope === "this" && eventDate === selectedDate);
  });
}

function finalVisibleEvents(
  visibleEvents: CalendarEvent[],
  affectedVisibleIds: ReadonlySet<string>,
): CalendarEvent[] {
  return visibleEvents.filter((event) => !affectedVisibleIds.has(event.id));
}

function mutationEventForOccurrence(
  occurrence: CalendarEvent,
  template?: CalendarEvent,
): CalendarEvent {
  return concreteRecurringOccurrenceForMutation(occurrence, template);
}

function targetForOccurrence(
  occurrence: CalendarEvent,
  template?: CalendarEvent,
): CalendarEventMutationTarget {
  return buildCalendarEventMutationTarget(
    mutationEventForOccurrence(occurrence, template),
    template,
  );
}

function addSnapshot(
  snapshots: CalendarDeleteArchiveRestoreSnapshot[],
  event: CalendarEvent | undefined,
  restoreMode: CalendarDeleteArchiveRestoreSnapshot["restoreMode"],
): void {
  if (!event) return;
  if (
    snapshots.some((snapshot) =>
      snapshot.event.id === event.id && snapshot.restoreMode === restoreMode
    )
  ) {
    return;
  }
  snapshots.push({
    event: {
      ...event,
      exceptions: [...(event.exceptions ?? [])],
    },
    restoreMode,
  });
}

function outcomeForOperations(
  operations: CalendarDeleteArchiveOperation[],
): CalendarDeleteArchiveOutcome {
  const hasArchive = operations.some((operation) => operation.type === "archive_event");
  const hasDelete = operations.some((operation) =>
    operation.type === "delete_event" || operation.type === "cap_series"
  );
  if (hasArchive && hasDelete) return "mixed";
  return hasArchive ? "archive" : "delete";
}

function recurringOccurrenceOnDate(template: CalendarEvent, date: string): CalendarEvent {
  const templateStartDate = datePart(template.start);
  const templateEndDate = datePart(template.end);
  const daySpan = Temporal.PlainDate.from(templateEndDate)
    .since(Temporal.PlainDate.from(templateStartDate))
    .days;
  const endDate = daySpan === 0 ? date : shiftDate(date, daySpan);
  return {
    ...template,
    id: templateStartDate === date ? template.id : `${template.id}::${date}`,
    start: `${date} ${template.start.split(" ")[1]}`,
    end: `${endDate} ${template.end.split(" ")[1]}`,
    recurringParentId: template.id,
  };
}

function scopeIncludesDate(
  date: string,
  selectedDate: string,
  scope: RecurringScope,
): boolean {
  return scope === "all" || date >= selectedDate;
}

function appendExplicitProtectedOccurrences(
  occurrences: CalendarEvent[],
  template: CalendarEvent,
  input: BuildCalendarDeleteArchivePlanInput,
  selectedDate: string,
  scope: RecurringScope,
): CalendarEvent[] {
  if (!input.protectedEventIds || input.protectedEventIds.size === 0) {
    return occurrences;
  }

  const byExactId = new Map(
    occurrences.map((occurrence) => [exactOccurrenceId(occurrence, template), occurrence]),
  );
  for (const id of input.protectedEventIds) {
    const [rootId, date] = id.split("::");
    if (rootId !== template.id) continue;
    const occurrenceDate = date ?? datePart(template.start);
    if (!scopeIncludesDate(occurrenceDate, selectedDate, scope)) continue;
    const occurrence = mutationEventForOccurrence(
      recurringOccurrenceOnDate(template, occurrenceDate),
      template,
    );
    byExactId.set(exactOccurrenceId(occurrence, template), occurrence);
  }

  return [...byExactId.values()].sort((a, b) => a.start.localeCompare(b.start));
}

function protectedRecurringOccurrencesForRange(
  template: CalendarEvent,
  startDate: string,
  endDate: string,
  input: BuildCalendarDeleteArchivePlanInput,
): CalendarEvent[] {
  if (endDate < startDate) return [];
  const expanded = expandRecurring(
    [template],
    Temporal.PlainDate.from(startDate),
    Temporal.PlainDate.from(endDate),
  );
  const activeDate = activeOccurrenceDate(input.activePomodoro);
  const activeRoot = activeRootId(input.activePomodoro);
  if (activeRoot === template.id && activeDate && (activeDate < startDate || activeDate > endDate)) {
    expanded.push(recurringOccurrenceOnDate(template, activeDate));
  }

  const seen = new Set<string>();
  const protectedOccurrences: CalendarEvent[] = [];
  for (const occurrence of expanded) {
    const occurrenceDate = datePart(occurrence.start);
    if (occurrenceDate < startDate || occurrenceDate > endDate) continue;
    const exactId = exactOccurrenceId(occurrence, template);
    if (seen.has(exactId)) continue;
    const protection = classifyEventProtection(occurrence, {
      now: input.now,
      activePomodoro: input.activePomodoro,
      protectedEventIds: input.protectedEventIds,
      template,
    });
    if (!protection.protected) continue;
    seen.add(exactId);
    protectedOccurrences.push(mutationEventForOccurrence(occurrence, template));
  }
  return protectedOccurrences;
}

function capSeriesOperation(
  template: CalendarEvent,
  repeatUntil: string,
): CalendarDeleteArchiveOperation {
  const recurrence = template.recurrence
    ? { ...template.recurrence, end: { type: "until" as const, date: repeatUntil } }
    : undefined;
  if (!recurrence) {
    throw new Error(`Calendar event '${template.id}' is not recurring.`);
  }
  return {
    type: "cap_series",
    eventId: template.id,
    repeatUntil,
    rrule: recurrenceToRrule(recurrence),
  };
}

function requiresActiveStopForScope(
  selectedEvent: CalendarEvent,
  templateId: string | undefined,
  selectedDate: string,
  scope: RecurringScope | undefined,
  active: ActivePomodoroIdentity | undefined,
): boolean {
  const activeRoot = activeRootId(active);
  if (!activeRoot) return false;
  if (!templateId) return eventMatchesActiveOccurrence(selectedEvent, active);
  if (activeRoot !== templateId) return false;
  const activeDate = activeOccurrenceDate(active);
  if (scope === "all") return true;
  if (scope === "following") return !activeDate || activeDate >= selectedDate;
  return !activeDate || activeDate === selectedDate;
}

function buildSingleEventPlan(
  input: BuildCalendarDeleteArchivePlanInput,
  template: CalendarEvent | undefined,
): CalendarDeleteArchivePlan {
  const mutationEvent = template
    ? mutationEventForOccurrence(input.selectedEvent, template)
    : input.selectedEvent;
  const protection = classifyEventProtection(input.selectedEvent, {
    now: input.now,
    activePomodoro: input.activePomodoro,
    protectedEventIds: input.protectedEventIds,
    template,
  });
  const operation: CalendarDeleteArchiveOperation = protection.protected
    ? { type: "archive_event", target: buildCalendarEventMutationTarget(mutationEvent, template) }
    : { type: "delete_event", target: buildCalendarEventMutationTarget(mutationEvent, template) };
  const affectedVisibleIds = new Set([input.selectedEvent.id]);
  const snapshots: CalendarDeleteArchiveRestoreSnapshot[] = [];
  const archivedEvents = protection.protected ? [mutationEvent] : [];

  if (!protection.protected) {
    addSnapshot(
      snapshots,
      template && mutationEvent.id.includes("::") ? template : input.selectedEvent,
      mutationEvent.id.includes("::") ? "update" : "insert",
    );
  }

  return {
    affectedVisibleIds,
    finalVisibleEvents: finalVisibleEvents(input.visibleEvents, affectedVisibleIds),
    outcome: protection.protected ? "archive" : "delete",
    requiresActiveStop: requiresActiveStopForScope(
      input.selectedEvent,
      template?.id,
      datePart(input.selectedEvent.start),
      "this",
      input.activePomodoro,
    ),
    operations: [operation],
    restore: { archivedEvents, snapshots },
  };
}

export function buildCalendarDeleteArchivePlan(
  input: BuildCalendarDeleteArchivePlanInput,
): CalendarDeleteArchivePlan {
  const selectedRootId = rootIdForEvent(input.selectedEvent);
  const template = input.rawBlocks.find((event) => event.id === selectedRootId);
  const isRecurring = !!input.selectedEvent.recurringParentId
    || !!input.selectedEvent.recurrence
    || !!template?.recurrence;
  const scope = isRecurring ? input.scope ?? "this" : undefined;

  if (!isRecurring || !scope || scope === "this") {
    return buildSingleEventPlan(input, isRecurring ? template : undefined);
  }
  const recurringScope = scope;

  if (!template?.recurrence) {
    return buildSingleEventPlan(input, undefined);
  }

  const selectedDate = datePart(input.selectedEvent.start);
  const affectedEvents = recurringAffectedVisibleEvents(
    input.visibleEvents,
    template.id,
    selectedDate,
    recurringScope,
  );
  const affectedVisibleIds = new Set(affectedEvents.map((event) => event.id));
  const operations: CalendarDeleteArchiveOperation[] = [];
  const archivedEvents: CalendarEvent[] = [];
  const snapshots: CalendarDeleteArchiveRestoreSnapshot[] = [];
  const nowDate = currentDatePart(input.now);

  if (recurringScope === "following") {
    const archiveEndDate = maxDate(nowDate, activeOccurrenceDate(input.activePomodoro) ?? nowDate);
    const protectedOccurrences = appendExplicitProtectedOccurrences(
      protectedRecurringOccurrencesForRange(template, selectedDate, archiveEndDate, input),
      template,
      input,
      selectedDate,
      recurringScope,
    );
    for (const occurrence of protectedOccurrences) {
      operations.push({
        type: "archive_event",
        target: targetForOccurrence(occurrence, template),
      });
      archivedEvents.push(occurrence);
    }
    operations.push(capSeriesOperation(template, shiftDate(selectedDate, -1)));
    addSnapshot(snapshots, template, "update");
  } else {
    const templateStartDate = datePart(template.start);
    const archiveEndDate = maxDate(nowDate, activeOccurrenceDate(input.activePomodoro) ?? nowDate);
    const protectedOccurrences = appendExplicitProtectedOccurrences(
      protectedRecurringOccurrencesForRange(template, templateStartDate, archiveEndDate, input),
      template,
      input,
      selectedDate,
      recurringScope,
    );

    if (protectedOccurrences.length === 0) {
      operations.push({
        type: "delete_event",
        target: buildCalendarEventMutationTarget(template),
      });
      addSnapshot(snapshots, template, "insert");
    } else {
      for (const occurrence of protectedOccurrences) {
        operations.push({
          type: "archive_event",
          target: targetForOccurrence(occurrence, template),
        });
        archivedEvents.push(occurrence);
      }
      operations.push(capSeriesOperation(template, shiftDate(templateStartDate, -1)));
      addSnapshot(snapshots, template, "update");
    }
  }

  return {
    affectedVisibleIds,
    finalVisibleEvents: finalVisibleEvents(input.visibleEvents, affectedVisibleIds),
    outcome: outcomeForOperations(operations),
    requiresActiveStop: requiresActiveStopForScope(
      input.selectedEvent,
      template.id,
      selectedDate,
      scope,
      input.activePomodoro,
    ),
    operations,
    restore: { archivedEvents, snapshots },
  };
}

export function protectedRecurringOccurrencesForArchive(
  template: CalendarEvent,
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): CalendarEvent[] {
  return protectedRecurringOccurrencesForRange(template, startDate, endDate, {
    rawBlocks: [template],
    visibleEvents: [],
    selectedEvent: template,
    now,
  });
}

export function visibleEventsAfterRecurringDeleteScope(
  events: CalendarEvent[],
  templateId: string,
  instanceDate: string,
  scope: RecurringScope,
): CalendarEvent[] {
  const affected = recurringAffectedVisibleEvents(events, templateId, instanceDate, scope);
  return finalVisibleEvents(events, new Set(affected.map((event) => event.id)));
}
