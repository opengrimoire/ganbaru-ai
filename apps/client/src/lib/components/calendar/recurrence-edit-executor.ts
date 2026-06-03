import type { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "./types";
import {
  moveDatedPatchToDate,
  type RecurrenceCommitOperation,
  type RecurringCommitPlan,
} from "./recurrence-edit-plan";
import {
  occurrenceOnDate,
  patchForTemplateAnchor,
  templateEndForDate,
  templateEventIdForDate,
} from "./recurrence-commit-helpers";

export interface RecurrenceEditCalendarStore {
  beginBatch(): void;
  endBatch(): void;
  detachInstance(instanceEvent: CalendarEvent): Promise<CalendarEvent>;
  setRepeatUntil(parentId: string, date: string): Promise<void>;
  splitSeries(
    instanceEvent: CalendarEvent,
    changes: Partial<CalendarEvent>,
  ): Promise<CalendarEvent>;
  updateBlock(patch: Partial<CalendarEvent> & { id: string }): Promise<void>;
  getTemplate(event: CalendarEvent): CalendarEvent | undefined;
  protectHistoricalSegments(
    templateId: string,
    cutoffDate: string,
    excludeDate?: string,
  ): Promise<string[]>;
  applyRecurrenceCommitPlan?(
    plan: RecurringCommitPlan,
  ): Promise<AppliedRecurrenceCommitPlan>;
  refreshWindow(windowStart: Temporal.PlainDate, windowEnd: Temporal.PlainDate): Promise<void>;
}

export interface AppliedRecurrenceCommitPlan {
  operationResults: ReadonlyMap<string, CalendarEvent>;
  activeRunTransferred: boolean;
}

export interface RecurrenceEditPomodoroBridge {
  transferBlockId(newBlockId: string, newEndTime?: string): Promise<void> | void;
  adoptTransferredBlockId?(newBlockId: string, newEndTime?: string): Promise<void> | void;
}

export interface RecurrenceEditExecutorDeps {
  calendarStore: RecurrenceEditCalendarStore;
  pomodoro?: RecurrenceEditPomodoroBridge;
  window?: {
    start: Temporal.PlainDate;
    end: Temporal.PlainDate;
  };
}

async function executeDetachOperation(
  operation: Extract<RecurrenceCommitOperation, { type: "detach-occurrence" }>,
  store: RecurrenceEditCalendarStore,
  operationResults: Map<string, CalendarEvent>,
): Promise<void> {
  const detached = await store.detachInstance(operation.occurrence);
  const updated: CalendarEvent = {
    ...detached,
    ...operation.patch,
    recurrence: operation.target === "recurring-template"
      ? operation.patch.recurrence
      : undefined,
    recurringParentId: undefined,
  };
  await store.updateBlock(updated);
  operationResults.set(operation.operationId, updated);
}

async function executeMaterializeOperation(
  operation: Extract<RecurrenceCommitOperation, { type: "materialize-occurrence" }>,
  store: RecurrenceEditCalendarStore,
  operationResults: Map<string, CalendarEvent>,
): Promise<void> {
  const detached = await store.detachInstance(operation.occurrence);
  const updated: CalendarEvent = operation.patch
    ? { ...detached, ...operation.patch, id: detached.id, recurringParentId: undefined }
    : detached;
  if (operation.patch) await store.updateBlock(updated);
  operationResults.set(operation.operationId, updated);
}

async function executeCollapseOperation(
  operation: Extract<RecurrenceCommitOperation, { type: "collapse-series" }>,
  store: RecurrenceEditCalendarStore,
  operationResults: Map<string, CalendarEvent>,
): Promise<void> {
  const template = store.getTemplate(operation.survivor);
  if (!template) throw new Error(`Template ${operation.templateId} not found`);
  const patch = {
    ...operation.patch,
    recurrence: undefined,
  };

  if (operation.protectedUntilDate) {
    await store.setRepeatUntil(operation.templateId, operation.protectedUntilDate);
    const detached = await store.detachInstance(operation.survivor);
    const updated: CalendarEvent = {
      ...detached,
      ...patch,
      id: detached.id,
      recurrence: undefined,
      recurringParentId: undefined,
      exceptions: undefined,
    };
    await store.updateBlock(updated);
    operationResults.set(operation.operationId, updated);
    return;
  }

  const updated: CalendarEvent = {
    ...template,
    ...patch,
    id: template.id,
    start: patch.start ? String(patch.start) : operation.survivor.start,
    end: patch.end ? String(patch.end) : operation.survivor.end,
    recurrence: undefined,
    recurringParentId: undefined,
    exceptions: undefined,
  };
  await store.updateBlock(updated);
  operationResults.set(operation.operationId, updated);
}

async function executeTemplateUpdateOperation(
  operation: Extract<RecurrenceCommitOperation, { type: "update-template-fields" }>,
  store: RecurrenceEditCalendarStore,
  operationResults: Map<string, CalendarEvent>,
): Promise<void> {
  const template = store.getTemplate(operation.selectedOccurrence);
  if (!template) throw new Error(`Template ${operation.templateId} not found`);

  if (operation.protectedUntilDate) {
    if (!operation.firstMutableDate) {
      throw new Error(`No mutable occurrence remains for recurrence template ${operation.templateId}`);
    }
    const virtualInstance = occurrenceOnDate(template, template.id, operation.firstMutableDate);
    const patch = moveDatedPatchToDate(operation.patch, operation.firstMutableDate);
    const newTemplate = await store.splitSeries(virtualInstance, patch);
    operationResults.set(operation.templateId, newTemplate);
    return;
  }

  const updated = patchForTemplateAnchor(template, operation.selectedOccurrence, operation.patch);
  await store.updateBlock(updated);
  operationResults.set(operation.templateId, updated);
}

function resolveTransferTarget(
  target: Extract<RecurrenceCommitOperation, { type: "transfer-active-run" }>["to"],
  operationResults: ReadonlyMap<string, CalendarEvent>,
): { id: string; end?: string } {
  if (target.kind === "event-id") return { id: target.eventId };

  const result = operationResults.get(target.operationId);
  if (!result) {
    throw new Error(`Missing result for recurrence operation ${target.operationId}`);
  }

  if (target.kind === "operation-result") {
    return { id: result.id, end: result.end };
  }

  return {
    id: templateEventIdForDate(result, target.date),
    end: templateEndForDate(result, target.date),
  };
}

export async function executeRecurrenceCommitPlan(
  plan: RecurringCommitPlan,
  deps: RecurrenceEditExecutorDeps,
): Promise<void> {
  const { calendarStore, pomodoro, window } = deps;
  const appliedPlan = calendarStore.applyRecurrenceCommitPlan
    ? await calendarStore.applyRecurrenceCommitPlan(plan)
    : undefined;
  const operationResults = appliedPlan
    ? new Map(appliedPlan.operationResults)
    : new Map<string, CalendarEvent>();
  let shouldRefresh = false;

  if (!calendarStore.applyRecurrenceCommitPlan) {
    calendarStore.beginBatch();
    try {
      for (const operation of plan.operations) {
        switch (operation.type) {
          case "detach-occurrence":
            await executeDetachOperation(operation, calendarStore, operationResults);
            break;
          case "cap-template":
            await calendarStore.setRepeatUntil(operation.templateId, operation.untilDate);
            break;
          case "split-series": {
            const newTemplate = await calendarStore.splitSeries(operation.occurrence, operation.patch);
            operationResults.set(operation.operationId, newTemplate);
            break;
          }
          case "update-template-fields":
            await executeTemplateUpdateOperation(operation, calendarStore, operationResults);
            break;
          case "collapse-series":
            await executeCollapseOperation(operation, calendarStore, operationResults);
            break;
          case "materialize-protected-history":
            await calendarStore.protectHistoricalSegments(
              operation.templateId,
              operation.cutoffDate,
              operation.excludeDate,
            );
            break;
          case "materialize-occurrence":
            await executeMaterializeOperation(operation, calendarStore, operationResults);
            break;
          case "transfer-active-run":
          case "refresh-window":
            break;
        }
      }
    } finally {
      calendarStore.endBatch();
    }
  }

  for (const operation of plan.operations) {
    if (operation.type === "refresh-window") {
      shouldRefresh = true;
      continue;
    }
    if (operation.type !== "transfer-active-run") continue;
    const target = resolveTransferTarget(operation.to, operationResults);
    if (appliedPlan?.activeRunTransferred && pomodoro?.adoptTransferredBlockId) {
      await pomodoro.adoptTransferredBlockId(target.id, operation.newEnd ?? target.end);
    } else {
      await pomodoro?.transferBlockId(target.id, operation.newEnd ?? target.end);
    }
  }

  if (shouldRefresh && window) {
    await calendarStore.refreshWindow(window.start, window.end);
  }
}
