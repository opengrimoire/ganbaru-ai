/**
 * Local keydown handler for panel input/textarea elements.
 *
 * Stops propagation so keys like Ctrl+Z (undo text) do not leak into the
 * CalendarView global shortcut handler, while explicitly letting the panel's
 * own shortcuts (Ctrl+Enter save, Ctrl+D delete, Escape close) bubble up to
 * the window-level listeners.
 */
export function panelInputKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return;
  if ((e.key === "d" || e.key === "D") && (e.ctrlKey || e.metaKey) && !e.shiftKey) return;
  if (e.key === "Escape") return;
  e.stopPropagation();
}
