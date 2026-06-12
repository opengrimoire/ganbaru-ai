import { invoke } from "@tauri-apps/api/core";
import type { CalendarEvent, RecurrenceConfig } from "$lib/components/calendar/types";
import {
  moveDatedPatchToDate,
  type RecurringCommitPlan,
} from "$lib/components/calendar/recurrence-edit-plan";
import {
  occurrenceOnDate,
  patchForTemplateAnchor,
  templateEndForDate,
  templateEventIdForDate,
} from "$lib/components/calendar/recurrence-commit-helpers";
import { fmtYMD, parseYMD } from "$lib/components/calendar/recurrence";
import { recurrenceConfigsEqual, recurrenceToRrule } from "$lib/components/calendar/rrule";
import { sanitizeCalendarDescriptionHtml } from "$lib/calendar/description-sanitizer";
import { dbUrl } from "$lib/api/db";
import { toDbTime } from "./map-row";
import {
  hasEventPatchKey,
  hasMeetingState,
  localTimezone,
  nowIso,
  prepareUpdateBlockPayload,
  resolvedPomodoroConfigForTimedEvent,
  type CalendarRecurrenceCommitOperationPayload,
} from "./calendar-event-payloads";
import { slimEvent } from "./calendar-event-hydration";

export interface CalendarRecurrenceCommitResult {
  blocks: readonly CalendarEvent[];
  addedCount: number;
  operationResults: Map<string, CalendarEvent>;
  activeRunTransferred: boolean;
  changed: boolean;
}

export async function applyCalendarRecurrenceCommitPlan(
  plan: RecurringCommitPlan,
  blocks: readonly CalendarEvent[],
): Promise<CalendarRecurrenceCommitResult> {
  const backendOperations: CalendarRecurrenceCommitOperationPayload[] = [];
  const operationResults = new Map<string, CalendarEvent>();
  let workingBlocks = blocks.map((block) => ({ ...block }));
  let addedCount = 0;
  let activeRunTransferred = false;

  const replaceWorkingBlock = (event: CalendarEvent): void => {
    workingBlocks = workingBlocks.map((block) => block.id === event.id ? { ...block, ...event } : block);
  };

  const appendWorkingBlock = (event: CalendarEvent): void => {
    workingBlocks = [...workingBlocks.filter((block) => block.id !== event.id), event];
    addedCount += 1;
  };

  const getWorkingTemplate = (eventOrId: CalendarEvent | string): CalendarEvent | undefined => {
    const id = typeof eventOrId === "string"
      ? eventOrId
      : eventOrId.recurringParentId ?? eventOrId.id;
    return workingBlocks.find((block) => block.id === id);
  };

  const queueUpdate = (patch: Partial<CalendarEvent> & { id: string }): CalendarEvent => {
    const { parentId, toUpdate, payload } = prepareUpdateBlockPayload(patch, workingBlocks);
    backendOperations.push({ type: "update_event", patch: payload });
    const existing = workingBlocks.find((block) => block.id === parentId);
    const updated = slimEvent({
      ...existing,
      ...toUpdate,
      id: parentId,
      recurringParentId: undefined,
    } as CalendarEvent);
    replaceWorkingBlock(updated);
    return updated;
  };

  const queueSetRepeatUntil = (parentId: string, date: string): CalendarEvent | undefined => {
    const parent = getWorkingTemplate(parentId);
    if (!parent?.recurrence) return undefined;
    const updatedRecurrence: RecurrenceConfig = {
      ...parent.recurrence,
      end: { type: "until", date },
    };
    return queueUpdate({ id: parentId, recurrence: updatedRecurrence });
  };

  const queueDetachInstance = (instanceEvent: CalendarEvent): CalendarEvent => {
    const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
    const parent = getWorkingTemplate(parentId);
    if (!parent) throw new Error("Parent template not found");

    const instanceDate = instanceEvent.start.split(" ")[0];
    const exceptions = Array.from(new Set([...(parent.exceptions ?? []), instanceDate]));
    const now = nowIso();
    const newId = crypto.randomUUID();
    const timezone = parent.timezone || localTimezone();
    const notifications = parent.notifications && parent.notifications.length > 0
      ? JSON.stringify(parent.notifications)
      : null;
    backendOperations.push({
      type: "detach_instance",
      input: {
        parentId,
        instanceDate,
        exceptions: JSON.stringify(exceptions),
        newId,
        title: instanceEvent.title,
        startTime: toDbTime(instanceEvent.start, timezone, parent.allDay),
        endTime: toDbTime(instanceEvent.end, timezone, parent.allDay),
        timezone,
        calendarId: parent.calendarId,
        color: instanceEvent.color ?? null,
        notifications,
        allDay: parent.allDay ?? false,
        location: parent.location ?? "",
        transparency: parent.transparency ?? "opaque",
        status: parent.status ?? "confirmed",
        now,
      },
    });

    replaceWorkingBlock({ ...parent, exceptions });
    const standalone = slimEvent({
      id: newId,
      title: instanceEvent.title,
      start: instanceEvent.start,
      end: instanceEvent.end,
      timezone,
      calendarId: parent.calendarId,
      color: instanceEvent.color,
      allDay: parent.allDay,
      location: parent.location,
      transparency: parent.transparency,
      status: parent.status,
      localParticipationStatus: parent.localParticipationStatus,
      meetingEnabled: parent.meetingEnabled,
      notifications: parent.notifications,
      pomodoroConfig: parent.allDay ? undefined : parent.pomodoroConfig,
    });
    appendWorkingBlock(standalone);
    return standalone;
  };

  const queueSplitSeries = (
    instanceEvent: CalendarEvent,
    changes: Partial<CalendarEvent>,
  ): CalendarEvent => {
    const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
    const parent = getWorkingTemplate(parentId);
    if (!parent) throw new Error("Parent template not found");

    const splitDate = instanceEvent.start.split(" ")[0];
    const newStartDateStr = changes.start
      ? String(changes.start).split(" ")[0]
      : splitDate;
    const capDate = newStartDateStr < splitDate ? newStartDateStr : splitDate;
    const capBefore = parseYMD(capDate);
    capBefore.setDate(capBefore.getDate() - 1);
    const dayBefore = fmtYMD(capBefore);
    const now = nowIso();
    const cappedRecurrence: RecurrenceConfig | undefined = parent.recurrence
      ? { ...parent.recurrence, end: { type: "until", date: dayBefore } }
      : undefined;
    const cappedRrule = cappedRecurrence ? recurrenceToRrule(cappedRecurrence) : null;
    const newId = crypto.randomUUID();
    const newStart = changes.start
      ? String(changes.start)
      : `${splitDate} ${instanceEvent.start.split(" ")[1]}`;
    const newEnd = changes.end
      ? String(changes.end)
      : `${splitDate} ${instanceEvent.end.split(" ")[1]}`;
    const newStartDate = newStart.split(" ")[0];
    const newExceptions = (parent.exceptions ?? []).filter((date) => date >= newStartDate);
    const merged = { ...parent, ...changes };
    const meetingEnabled = merged.meetingEnabled ?? hasMeetingState(merged);
    const recurrenceChanged = hasEventPatchKey(changes, "recurrence")
      && !recurrenceConfigsEqual(changes.recurrence, parent.recurrence);
    const newRecurrence: RecurrenceConfig | undefined = recurrenceChanged
      ? changes.recurrence
      : parent.recurrence
        ? { ...parent.recurrence, end: { type: "never" } }
        : undefined;
    const rrule = newRecurrence ? recurrenceToRrule(newRecurrence) : null;
    const notifications = merged.notifications && merged.notifications.length > 0
      ? JSON.stringify(merged.notifications)
      : null;
    const exceptions = newExceptions.length > 0 ? JSON.stringify(newExceptions) : null;
    const homeZone = parent.timezone || localTimezone();
    const descriptionPatch = "description" in changes
      ? sanitizeCalendarDescriptionHtml(changes.description ?? "")
      : null;
    const urlPatch = "url" in changes ? (changes.url ?? "") : null;
    const pomodoroState = resolvedPomodoroConfigForTimedEvent(parent, changes, merged.allDay);

    backendOperations.push({
      type: "split_series",
      input: {
        parentId,
        dayBefore,
        cappedRrule,
        newId,
        title: merged.title ?? parent.title,
        startTime: toDbTime(newStart, homeZone, merged.allDay),
        endTime: toDbTime(newEnd, homeZone, merged.allDay),
        timezone: homeZone,
        calendarId: parent.calendarId,
        color: merged.color ?? null,
        notifications,
        exceptions,
        rrule,
        allDay: merged.allDay ?? false,
        location: merged.location ?? "",
        transparency: merged.transparency ?? "opaque",
        status: merged.status ?? "confirmed",
        descriptionPatch,
        urlPatch,
        localRsvpStatus: merged.localParticipationStatus ?? null,
        meetingEnabled,
        copyPomodoroConfig: pomodoroState.copyFromParent,
        pomodoroConfig: pomodoroState.payloadConfig,
        now,
      },
    });

    if (cappedRecurrence) replaceWorkingBlock({ ...parent, recurrence: cappedRecurrence });
    const newTemplate = slimEvent({
      ...parent,
      ...changes,
      id: newId,
      start: newStart,
      end: newEnd,
      timezone: homeZone,
      recurrence: newRecurrence,
      recurringParentId: undefined,
      exceptions: newExceptions.length > 0 ? newExceptions : undefined,
      pomodoroConfig: pomodoroState.finalConfig,
    });
    appendWorkingBlock(newTemplate);
    return newTemplate;
  };

  const resolveTransferTarget = (
    operation: Extract<RecurringCommitPlan["operations"][number], { type: "transfer-active-run" }>,
  ): { id: string; end?: string; date?: string } => {
    const target = operation.to;
    if (target.kind === "event-id") {
      return {
        id: target.eventId,
        date: target.eventId.split("::")[1],
      };
    }

    const result = operationResults.get(target.operationId);
    if (!result) {
      throw new Error(`Missing result for recurrence operation ${target.operationId}`);
    }

    if (target.kind === "operation-result") {
      return {
        id: result.id,
        end: result.end,
        date: result.start.split(" ")[0],
      };
    }

    return {
      id: templateEventIdForDate(result, target.date),
      end: templateEndForDate(result, target.date),
      date: target.date,
    };
  };

  const toPlannedEnd = (value: string | undefined): string | null => {
    if (!value) return null;
    const ms = new Date(value.replace(" ", "T")).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  };

  for (const operation of plan.operations) {
    switch (operation.type) {
      case "detach-occurrence": {
        const detached = queueDetachInstance(operation.occurrence);
        const updated = queueUpdate({
          ...detached,
          ...operation.patch,
          recurrence: operation.target === "recurring-template"
            ? operation.patch.recurrence
            : undefined,
          recurringParentId: undefined,
        });
        operationResults.set(operation.operationId, updated);
        break;
      }
      case "cap-template":
        queueSetRepeatUntil(operation.templateId, operation.untilDate);
        break;
      case "split-series": {
        const newTemplate = queueSplitSeries(operation.occurrence, operation.patch);
        operationResults.set(operation.operationId, newTemplate);
        break;
      }
      case "update-template-fields": {
        const template = getWorkingTemplate(operation.selectedOccurrence);
        if (!template) throw new Error(`Template ${operation.templateId} not found`);
        if (operation.protectedUntilDate) {
          if (!operation.firstMutableDate) {
            throw new Error(`No mutable occurrence remains for recurrence template ${operation.templateId}`);
          }
          const virtualInstance = occurrenceOnDate(template, template.id, operation.firstMutableDate);
          const patch = moveDatedPatchToDate(operation.patch, operation.firstMutableDate);
          const newTemplate = queueSplitSeries(virtualInstance, patch);
          operationResults.set(operation.templateId, newTemplate);
          break;
        }
        const updated = queueUpdate(
          patchForTemplateAnchor(template, operation.selectedOccurrence, operation.patch),
        );
        operationResults.set(operation.templateId, updated);
        break;
      }
      case "collapse-series": {
        const template = getWorkingTemplate(operation.survivor);
        if (!template) throw new Error(`Template ${operation.templateId} not found`);
        const patch = { ...operation.patch, recurrence: undefined };
        if (operation.protectedUntilDate) {
          queueSetRepeatUntil(operation.templateId, operation.protectedUntilDate);
          const detached = queueDetachInstance(operation.survivor);
          const updated = queueUpdate({
            ...detached,
            ...patch,
            id: detached.id,
            recurrence: undefined,
            recurringParentId: undefined,
            exceptions: undefined,
          });
          operationResults.set(operation.operationId, updated);
          break;
        }
        const updated = queueUpdate({
          ...template,
          ...patch,
          id: template.id,
          start: patch.start ? String(patch.start) : operation.survivor.start,
          end: patch.end ? String(patch.end) : operation.survivor.end,
          recurrence: undefined,
          recurringParentId: undefined,
          exceptions: undefined,
        });
        operationResults.set(operation.operationId, updated);
        break;
      }
      case "materialize-protected-history": {
        const datesToProtect = await invoke<string[]>("calendar_progress_dates_before", {
          dbUrl: dbUrl(),
          templateId: operation.templateId,
          cutoffDate: operation.cutoffDate,
          excludeDate: operation.excludeDate ?? null,
        });
        const parent = getWorkingTemplate(operation.templateId);
        if (!parent) break;
        for (const date of datesToProtect) {
          queueDetachInstance(occurrenceOnDate(parent, operation.templateId, date));
        }
        break;
      }
      case "materialize-occurrence": {
        const detached = queueDetachInstance(operation.occurrence);
        const updated = operation.patch
          ? queueUpdate({ ...detached, ...operation.patch, id: detached.id, recurringParentId: undefined })
          : detached;
        operationResults.set(operation.operationId, updated);
        break;
      }
      case "transfer-active-run":
        {
          const target = resolveTransferTarget(operation);
          backendOperations.push({
            type: "transfer_active_event_reference",
            transfer: {
              newEventId: target.id,
              newEventDate: target.date ?? null,
              plannedEnd: toPlannedEnd(operation.newEnd ?? target.end),
            },
          });
          activeRunTransferred = true;
        }
        break;
      case "refresh-window":
        break;
    }
  }

  if (backendOperations.length > 0) {
    await invoke("calendar_apply_recurrence_commit_plan", {
      dbUrl: dbUrl(),
      operations: backendOperations,
    });
    return {
      blocks: workingBlocks.map((block) => slimEvent(block)),
      addedCount,
      operationResults,
      activeRunTransferred,
      changed: true,
    };
  }

  return {
    blocks,
    addedCount: 0,
    operationResults,
    activeRunTransferred,
    changed: false,
  };
}
