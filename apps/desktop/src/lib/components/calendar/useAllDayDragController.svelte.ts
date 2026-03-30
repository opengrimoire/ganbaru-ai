import type {
  CalendarEvent,
  AllDayDragState,
  PositionedAllDayEvent,
} from "./types";
import { formatDatePart } from "./utils";

let cursorStyle: HTMLStyleElement | null = null;

function lockCursor(cursor: string) {
  unlockCursor();
  cursorStyle = document.createElement("style");
  cursorStyle.textContent = `* { cursor: ${cursor} !important; }`;
  document.head.appendChild(cursorStyle);
}

function unlockCursor() {
  if (cursorStyle) {
    cursorStyle.remove();
    cursorStyle = null;
  }
}

const CLICK_THRESHOLD = 5;
const EDGE_ZONE = 8;

export interface AllDayDragControllerConfig {
  events: () => CalendarEvent[];
  weekDays: () => Date[];
  getColumnBounds: () => DOMRect[];
  onEventUpdate: (event: CalendarEvent) => void | Promise<void>;
  canDrag?: (eventId: string) => boolean;
}

export function useAllDayDragController(config: AllDayDragControllerConfig) {
  let dragState = $state<AllDayDragState | null>(null);
  let allDayDragPreview = $state<PositionedAllDayEvent | null>(null);
  let draggingEventId = $state<string | null>(null);

  // --- Helpers ---

  function columnFromX(clientX: number, bounds: DOMRect[]): number {
    for (let i = 0; i < bounds.length; i++) {
      const mid = bounds[i].left + bounds[i].width / 2;
      if (clientX < mid) return i;
    }
    return bounds.length - 1;
  }

  function dateStrForCol(col: number): string {
    const days = config.weekDays();
    return formatDatePart(days[Math.max(0, Math.min(col, days.length - 1))]);
  }

  // --- Existing event drag (move / resize) ---

  function handleDragStart(eventId: string, e: PointerEvent) {
    if (config.canDrag && !config.canDrag(eventId)) return;

    const event = config.events().find((ev) => ev.id === eventId);
    if (!event) return;

    const bounds = config.getColumnBounds();
    if (bounds.length === 0) return;

    const days = config.weekDays();
    const dayStrs = days.map((d) => formatDatePart(d));
    const startDate = event.start.split(" ")[0];
    const endDate = event.end.split(" ")[0];

    const weekStart = dayStrs[0];
    const weekEnd = dayStrs[dayStrs.length - 1];
    const clippedStart = startDate < weekStart ? weekStart : startDate;
    const clippedEnd = endDate > weekEnd ? weekEnd : endDate;

    const startCol = dayStrs.indexOf(clippedStart);
    const endCol = dayStrs.indexOf(clippedEnd);
    if (startCol < 0 || endCol < 0) return;
    const spanCols = endCol - startCol + 1;

    // Detect type from pointer position relative to chip
    const chipEl = (e.target as HTMLElement).closest("[data-event-id]") as HTMLElement | null;
    let type: AllDayDragState["type"] = "move";
    if (chipEl) {
      const rect = chipEl.getBoundingClientRect();
      if (e.clientX - rect.left <= EDGE_ZONE && startDate >= weekStart) {
        type = "resize-start";
      } else if (rect.right - e.clientX <= EDGE_ZONE && endDate <= weekEnd) {
        type = "resize-end";
      }
    }

    dragState = {
      eventId,
      type,
      originStartCol: startCol,
      originSpanCols: spanCols,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      columnBounds: bounds,
    };

    draggingEventId = null; // not committed to drag yet (click threshold)

    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
  }

  function handleDragMove(e: PointerEvent) {
    if (!dragState) return;

    const dx = e.clientX - dragState.pointerStartX;
    const dy = e.clientY - dragState.pointerStartY;

    // Click threshold: don't start visual drag until pointer has moved enough
    if (!draggingEventId) {
      if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) return;
      draggingEventId = dragState.eventId;
      lockCursor(dragState.type === "move" ? "grabbing" : "ew-resize");
    }

    const event = config.events().find((ev) => ev.id === dragState!.eventId);
    if (!event) return;

    const currentCol = columnFromX(e.clientX, dragState.columnBounds);
    const maxCol = dragState.columnBounds.length;

    let newStartCol: number;
    let newSpanCols: number;

    if (dragState.type === "move") {
      const colDelta = currentCol - columnFromX(dragState.pointerStartX, dragState.columnBounds);
      newStartCol = dragState.originStartCol + colDelta;
      newSpanCols = dragState.originSpanCols;
      // Clamp within week bounds
      if (newStartCol < 0) newStartCol = 0;
      if (newStartCol + newSpanCols > maxCol) newStartCol = maxCol - newSpanCols;
    } else if (dragState.type === "resize-start") {
      const endCol = dragState.originStartCol + dragState.originSpanCols - 1;
      newStartCol = Math.min(currentCol, endCol);
      newStartCol = Math.max(0, newStartCol);
      newSpanCols = endCol - newStartCol + 1;
    } else {
      // resize-end
      newStartCol = dragState.originStartCol;
      const newEndCol = Math.max(currentCol, newStartCol);
      newSpanCols = Math.min(newEndCol - newStartCol + 1, maxCol - newStartCol);
    }

    allDayDragPreview = {
      event,
      row: 0,
      startCol: newStartCol,
      spanCols: newSpanCols,
    };
  }

  async function handleDragEnd() {
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", handleDragEnd);
    unlockCursor();

    const state = dragState;
    const preview = allDayDragPreview;

    dragState = null;
    allDayDragPreview = null;
    draggingEventId = null;

    if (!state || !preview) return;

    const event = config.events().find((ev) => ev.id === state.eventId);
    if (!event) return;

    // Check if position actually changed
    if (preview.startCol === state.originStartCol && preview.spanCols === state.originSpanCols) return;

    const newStartDate = dateStrForCol(preview.startCol);
    const newEndDate = dateStrForCol(preview.startCol + preview.spanCols - 1);

    await config.onEventUpdate({
      ...event,
      start: `${newStartDate} 00:00`,
      end: `${newEndDate} 00:00`,
    });
  }

  return {
    get dragState() { return dragState; },
    get allDayDragPreview() { return allDayDragPreview; },
    get draggingEventId() { return draggingEventId; },
    handleDragStart,
  };
}
