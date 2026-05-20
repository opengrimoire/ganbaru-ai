import { hasOnlyShortcutModifier, hasShortcutModifier } from "$lib/keyboard-shortcuts";

/**
 * Local keydown handler for panel input/textarea elements.
 *
 * Stops propagation so keys like Mod+Z (undo text) do not leak into the
 * CalendarView global shortcut handler, while explicitly letting the panel's
 * own shortcuts (Mod+Enter save, Mod+D delete, Escape close) bubble up to
 * the window-level listeners.
 */
export function panelInputKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter" && hasShortcutModifier(e)) return;
  if ((e.key === "d" || e.key === "D") && hasOnlyShortcutModifier(e)) return;
  if (e.key === "Escape") return;
  e.stopPropagation();
}
