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
  const draft = value.trim();
  if (!draft) return null;

  let hoursText = "";
  let minutesText = "";
  const colonMatch = /^(\d{1,2}):(\d{2})$/.exec(draft);
  if (colonMatch) {
    hoursText = colonMatch[1];
    minutesText = colonMatch[2];
  } else if (/^\d{1,4}$/.test(draft)) {
    if (draft.length <= 2) {
      hoursText = draft;
      minutesText = "00";
    } else {
      hoursText = draft.slice(0, -2);
      minutesText = draft.slice(-2);
    }
  } else {
    return null;
  }

  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
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
