import { hasOnlyShortcutModifier, hasShortcutModifier } from "$lib/keyboard-shortcuts";

export type RovingOrientation = "horizontal" | "vertical" | "grid";

export interface RovingMoveInput {
  currentIndex: number;
  itemCount: number;
  key: string;
  orientation: RovingOrientation;
  columns?: number;
}

export interface DraftCommit<T> {
  value: T;
  committed: boolean;
}

/**
 * Local keydown handler for panel input/textarea elements.
 *
 * Stops propagation for normal text editing while explicitly letting the
 * panel's own shortcuts (Mod+Enter save, Mod+D delete, Escape close) bubble
 * up to the window-level listeners.
 */
export function panelInputKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter" && hasShortcutModifier(e)) return;
  if ((e.key === "d" || e.key === "D") && hasOnlyShortcutModifier(e)) return;
  if (e.key === "Escape") return;
  e.stopPropagation();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isValidHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 23;
}

function isValidMinute(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 59;
}

function canStartMinute(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 5;
}

/**
 * Move a roving focus index for one-dimensional lists and fixed-column grids.
 */
export function moveRovingIndex(input: RovingMoveInput): number {
  const itemCount = Math.max(0, Math.trunc(input.itemCount));
  if (itemCount === 0) return -1;

  const currentIndex = clamp(Math.trunc(input.currentIndex), 0, itemCount - 1);
  if (input.key === "Home") return 0;
  if (input.key === "End") return itemCount - 1;

  if (input.orientation === "horizontal") {
    if (input.key === "ArrowLeft") return clamp(currentIndex - 1, 0, itemCount - 1);
    if (input.key === "ArrowRight") return clamp(currentIndex + 1, 0, itemCount - 1);
    return currentIndex;
  }

  if (input.orientation === "vertical") {
    if (input.key === "ArrowUp") return clamp(currentIndex - 1, 0, itemCount - 1);
    if (input.key === "ArrowDown") return clamp(currentIndex + 1, 0, itemCount - 1);
    return currentIndex;
  }

  const columns = Math.max(1, Math.trunc(input.columns ?? 1));
  if (input.key === "ArrowLeft") return clamp(currentIndex - 1, 0, itemCount - 1);
  if (input.key === "ArrowRight") return clamp(currentIndex + 1, 0, itemCount - 1);
  if (input.key === "ArrowUp") return clamp(currentIndex - columns, 0, itemCount - 1);
  if (input.key === "ArrowDown") return clamp(currentIndex + columns, 0, itemCount - 1);
  return currentIndex;
}

export function normalizeTimeDraft(value: string): string | null {
  const draft = displayTimeDraft(value, true);
  if (!draft) return null;

  const colonMatch = /^(\d{1,2}):(\d{1,2})$/.exec(draft);
  if (colonMatch) {
    const hours = Number(colonMatch[1]);
    const minutes = colonMatch[2].length === 1
      ? Number(colonMatch[2]) * 10
      : Number(colonMatch[2]);
    if (!isValidHour(hours) || !isValidMinute(minutes)) return null;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  if (!/^\d{1,2}$/.test(draft)) {
    return null;
  }

  const hours = Number(draft);
  if (!isValidHour(hours)) return null;
  return `${String(hours).padStart(2, "0")}:00`;
}

export function sanitizeTimeDraftInput(value: string): string {
  let result = "";
  let colonUsed = false;

  for (const char of value) {
    if (/^\d$/.test(char)) {
      result += char;
    } else if (char === ":" && !colonUsed) {
      result += char;
      colonUsed = true;
    }
  }

  return result;
}

export function displayTimeDraft(value: string, formatShortCompact = false): string {
  const draft = sanitizeTimeDraftInput(value);
  if (!draft) return "";

  const explicitColon = /^(\d{0,2}):(\d*)$/.exec(draft);
  if (explicitColon) {
    return `${explicitColon[1]}:${explicitColon[2].slice(0, 2)}`;
  }

  if (/^\d+$/.test(draft)) {
    const digits = draft.slice(0, 4);
    const digitAt = (index: number) => Number(digits[index]);
    const firstTwo = digits.length >= 2 ? Number(digits.slice(0, 2)) : Number.NaN;
    const trailingTwo = digits.length >= 3 ? Number(digits.slice(1, 3)) : Number.NaN;

    if (digits.length === 2) {
      if (isValidHour(firstTwo)) return digits;
      if (canStartMinute(digitAt(1))) return `${digits[0]}:${digits[1]}`;
      return `0${digits[0]}:0${digits[1]}`;
    }

    if (digits.length === 3) {
      if (formatShortCompact && isValidMinute(trailingTwo)) return `${digits[0]}:${digits.slice(1)}`;
      if (isValidHour(firstTwo) && canStartMinute(digitAt(2))) return `${digits.slice(0, 2)}:${digits[2]}`;
      if (isValidMinute(trailingTwo)) return `${digits[0]}:${digits.slice(1)}`;
      return digits;
    }

    if (digits.length === 4) {
      const hours = Number(digits.slice(0, 2));
      const minutes = Number(digits.slice(2));
      if (isValidHour(hours) && isValidMinute(minutes)) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
    }

    return digits;
  }

  return draft;
}

export function commitTimeDraft(draft: string, previous: string): DraftCommit<string> {
  const normalized = normalizeTimeDraft(draft);
  if (!normalized) return { value: previous, committed: false };
  return { value: normalized, committed: normalized !== previous };
}

export function restoreTimeDraft(canonicalValue: string): string {
  return canonicalValue;
}

export function normalizeIntegerDraft(value: string, min: number, max: number): number | null {
  const draft = value.trim();
  if (!/^\d+$/.test(draft)) return null;
  const parsed = Number(draft);
  if (!Number.isSafeInteger(parsed)) return null;
  return clamp(parsed, min, max);
}

export function commitIntegerDraft(
  draft: string,
  previous: number,
  min: number,
  max: number,
): DraftCommit<number> {
  const normalized = normalizeIntegerDraft(draft, min, max);
  if (normalized === null) return { value: previous, committed: false };
  return { value: normalized, committed: normalized !== previous };
}
