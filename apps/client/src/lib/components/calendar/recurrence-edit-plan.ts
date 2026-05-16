import type { CalendarEvent, RecurrenceConfig } from "./types";

export type FieldOperation<T> =
  | { kind: "unchanged"; value: T | undefined }
  | { kind: "cleared" }
  | { kind: "set"; value: T };

export type RecurrenceFieldOperation = FieldOperation<RecurrenceConfig>;

function hasChange<K extends keyof CalendarEvent>(
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
