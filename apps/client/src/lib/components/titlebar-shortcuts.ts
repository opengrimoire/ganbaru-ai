import { hasOnlyShortcutModifier, type KeyboardModifierState } from "$lib/keyboard-shortcuts";

export interface ResetShortcutSequenceState {
  pressCount: number;
  lastPressAtMs: number | null;
}

export interface ResetShortcutSequenceOptions {
  requiredPresses: number;
  maxGapMs: number;
}

export interface ResetShortcutSequenceResult {
  state: ResetShortcutSequenceState;
  resetTriggered: boolean;
}

export type CloseWindowShortcutEvent = Pick<KeyboardEvent, "key"> & KeyboardModifierState;

/**
 * Record one hidden reset shortcut press.
 *
 * The reset shortcut shares its key chord with close. Callers should only
 * consume the keyboard event when `resetTriggered` is true so earlier presses
 * can keep their normal close behavior.
 */
export function recordResetShortcutPress(
  state: ResetShortcutSequenceState,
  nowMs: number,
  options: ResetShortcutSequenceOptions,
): ResetShortcutSequenceResult {
  const sequenceIsActive =
    state.lastPressAtMs !== null
    && nowMs - state.lastPressAtMs <= options.maxGapMs;
  const pressCount = (sequenceIsActive ? state.pressCount : 0) + 1;

  if (pressCount >= options.requiredPresses) {
    return {
      state: { pressCount: 0, lastPressAtMs: null },
      resetTriggered: true,
    };
  }

  return {
    state: { pressCount, lastPressAtMs: nowMs },
    resetTriggered: false,
  };
}

export function isCloseWindowShortcut(event: CloseWindowShortcutEvent): boolean {
  const key = event.key.toLowerCase();
  if (key !== "w") return false;
  return hasOnlyShortcutModifier(event) || hasOnlyShortcutModifier(event, { shift: true });
}
