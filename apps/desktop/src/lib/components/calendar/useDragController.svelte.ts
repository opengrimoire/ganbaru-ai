import type { CalendarEvent, DragState, EventColor, PositionedEvent } from "./types";
import {
  minuteOfDay,
  minuteToTop,
  snapToGrid,
  clampMinute,
  formatDatePart,
  durationMinutes,
  minuteOffsetToDateStr,
  parseCalendarDate,
} from "./utils";

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
  document.body.style.cursor = "";
}

export interface DragControllerConfig {
  events: () => CalendarEvent[];
  hourHeight: () => number;
  getColumnDate: (clientX: number) => string;
  onEventUpdate: (event: CalendarEvent) => void | Promise<void>;
  onEventCreate: (start: string, end: string) => void;
}

export function useDragController(config: DragControllerConfig) {
  let dragState = $state<DragState | null>(null);
  let dragPreviewDate = $state<string | null>(null);
  let dragPreview = $state<PositionedEvent | null>(null);

  let createState = $state<{
    dateStr: string;
    anchorMinute: number;
    columnEl: HTMLElement;
  } | null>(null);
  let createPreviewDate = $state<string | null>(null);
  let createPreview = $state<PositionedEvent | null>(null);

  // --- Existing event drag (move / resize) ---

  function handleDragStart(eventId: string, e: PointerEvent) {
    const event = config.events().find((ev) => ev.id === eventId);
    if (!event) return;

    const dateStr = event.start.split(" ")[0];
    const startMin = minuteOfDay(event.start);
    const dur = durationMinutes(event.start, event.end);

    dragState = {
      eventId,
      type: "move",
      originDate: dateStr,
      startColumnDate: config.getColumnDate(e.clientX),
      originStartMinute: startMin,
      originEndMinute: startMin + dur,
      pointerStartY: e.clientY,
      pointerStartX: e.clientX,
      columnWidth: 0,
      startColumnIndex: 0,
    };

    const blockEl = (e.target as HTMLElement).closest(".event-block-wrapper");
    if (blockEl) {
      const rect = blockEl.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      if (relY <= 6) {
        dragState.type = "resize-top";
      } else if (relY >= rect.height - 6) {
        dragState.type = "resize-bottom";
      }
    }

    if (dragState.type === "resize-top" || dragState.type === "resize-bottom") {
      lockCursor("ns-resize");
    } else {
      lockCursor("grabbing");
    }

    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
  }

  function handleDragMove(e: PointerEvent) {
    if (!dragState) return;

    const event = config.events().find((ev) => ev.id === dragState!.eventId);
    if (!event) return;

    const hourHeight = config.hourHeight();
    const deltaY = e.clientY - dragState.pointerStartY;
    const deltaMinutes = snapToGrid((deltaY / hourHeight) * 60);

    let newStart: number;
    let newEnd: number;
    let targetDate = dragState.originDate;

    if (dragState.type === "move") {
      // Compute column delta to handle dragging from continuation blocks
      const currentColumnDate = config.getColumnDate(e.clientX);
      const startCol = parseCalendarDate(`${dragState.startColumnDate} 00:00`);
      const currentCol = parseCalendarDate(`${currentColumnDate} 00:00`);
      const dayDelta = Math.round(
        (currentCol.getTime() - startCol.getTime()) / 86400000,
      );
      const originDate = parseCalendarDate(`${dragState.originDate} 00:00`);
      originDate.setDate(originDate.getDate() + dayDelta);
      targetDate = formatDatePart(originDate);

      const dur = dragState.originEndMinute - dragState.originStartMinute;
      newStart = snapToGrid(dragState.originStartMinute + deltaMinutes);
      newStart = Math.max(0, Math.min(1430, newStart));
      newEnd = newStart + dur; // may exceed 1440 — cross-midnight
    } else if (dragState.type === "resize-top") {
      newStart = snapToGrid(dragState.originStartMinute + deltaMinutes);
      newStart = Math.max(0, newStart);
      newEnd = dragState.originEndMinute;
      if (newStart >= newEnd) newStart = newEnd - 10;
      if (newEnd - newStart < 10) newEnd = newStart + 10;
    } else {
      // resize-bottom: allow crossing midnight
      newStart = dragState.originStartMinute;
      newEnd = snapToGrid(dragState.originEndMinute + deltaMinutes);
      if (newEnd <= newStart) newEnd = newStart + 10;
      if (newEnd - newStart < 10) newEnd = newStart + 10;
    }

    // During resize, if end reaches midnight, snap to at least 00:30 next day
    // so the continuation "tip" is clearly visible and easy to grab.
    // For move, exact midnight (1440) is valid since duration is preserved.
    if (dragState.type !== "move" && newEnd >= 1440 && newEnd < 1470) {
      newEnd = 1470;
    }

    const startStr = minuteOffsetToDateStr(targetDate, newStart);
    const endStr = minuteOffsetToDateStr(targetDate, newEnd);

    // Visual metrics for the primary (start) day column
    const visibleEnd = Math.min(newEnd, 1440);
    const top = minuteToTop(newStart, hourHeight);
    const height = ((visibleEnd - newStart) / 60) * hourHeight;

    dragPreviewDate = targetDate;
    dragPreview = {
      event: {
        ...event,
        start: startStr,
        end: endStr,
      },
      top,
      height,
      left: 0,
      width: 100,
      column: 0,
      totalColumns: 1,
    };
  }

  async function handleDragEnd() {
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", handleDragEnd);
    unlockCursor();

    if (dragPreview) {
      await config.onEventUpdate(dragPreview.event);
    }

    dragState = null;
    dragPreview = null;
    dragPreviewDate = null;
  }

  // --- Create-by-drag ---

  function handleCreateStart(dateStr: string, minute: number, e: PointerEvent) {
    const columnEl = (e.target as HTMLElement).closest(
      '[style*="border-left"]',
    ) as HTMLElement;
    if (!columnEl) return;

    createState = { dateStr, anchorMinute: minute, columnEl };
    const endMinute = Math.min(minute + 10, 1440);
    createPreviewDate = dateStr;
    createPreview = buildPreview(dateStr, minute, endMinute);

    lockCursor("crosshair");
    window.addEventListener("pointermove", handleCreateMove);
    window.addEventListener("pointerup", handleCreateEnd);
  }

  function handleCreateMove(e: PointerEvent) {
    if (!createState) return;

    const hourHeight = config.hourHeight();
    const rect = createState.columnEl.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const cursorMinute = clampMinute(snapToGrid((offsetY / hourHeight) * 60));

    const anchor = createState.anchorMinute;
    let startMinute = Math.min(anchor, cursorMinute);
    let endMinute = Math.max(anchor, cursorMinute);
    if (endMinute - startMinute < 10) endMinute = startMinute + 10;

    createPreview = buildPreview(
      createState.dateStr,
      startMinute,
      clampMinute(endMinute),
    );
  }

  function handleCreateEnd() {
    window.removeEventListener("pointermove", handleCreateMove);
    window.removeEventListener("pointerup", handleCreateEnd);
    unlockCursor();

    if (createPreview) {
      config.onEventCreate(createPreview.event.start, createPreview.event.end);
    }

    createState = null;
    createPreview = null;
    createPreviewDate = null;
  }

  function buildPreview(
    dateStr: string,
    startMinute: number,
    endMinute: number,
    title?: string,
    color?: EventColor,
  ): PositionedEvent {
    const hourHeight = config.hourHeight();
    const sh = String(Math.floor(startMinute / 60)).padStart(2, "0");
    const sm = String(startMinute % 60).padStart(2, "0");
    const eh = String(Math.floor(Math.min(endMinute, 1440) / 60)).padStart(2, "0");
    const em = String(Math.min(endMinute, 1440) % 60).padStart(2, "0");

    return {
      event: {
        id: "__create__",
        title: title ?? "",
        start: `${dateStr} ${sh}:${sm}`,
        end: `${dateStr} ${eh}:${em}`,
        color,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        calendarId: "default",
      },
      top: minuteToTop(startMinute, hourHeight),
      height: ((endMinute - startMinute) / 60) * hourHeight,
      left: 0,
      width: 100,
      column: 0,
      totalColumns: 1,
    };
  }

  // --- Computed helpers for DayColumn props ---

  function getDragPreviewForDate(dateStr: string): PositionedEvent | null {
    if (!dragPreview) return null;

    const previewStartDate = dragPreview.event.start.split(" ")[0];
    const previewEndDate = dragPreview.event.end.split(" ")[0];

    // Single-day event — return preview as-is for its date
    if (previewStartDate === previewEndDate) {
      return dateStr === previewStartDate ? dragPreview : null;
    }

    const hourHeight = config.hourHeight();

    // Start day — show from event start to bottom of day
    if (dateStr === previewStartDate) {
      const startMin = minuteOfDay(dragPreview.event.start);
      return {
        ...dragPreview,
        top: minuteToTop(startMin, hourHeight),
        height: ((1440 - startMin) / 60) * hourHeight,
      };
    }

    // End day — show from top to event end
    if (dateStr === previewEndDate) {
      const endMin = minuteOfDay(dragPreview.event.end);
      if (endMin <= 0) return null;
      return {
        ...dragPreview,
        top: 0,
        height: (endMin / 60) * hourHeight,
      };
    }

    return null;
  }

  function getCreatePreviewForDate(dateStr: string): PositionedEvent | null {
    if (createPreviewDate === dateStr) return createPreview;
    return null;
  }

  function getHideSnapLine(dateStr: string): boolean {
    if (dragState?.type === "move") return true;
    // During create-by-drag, only show snap on the column being drawn on
    if (createState) return createPreviewDate !== dateStr;
    // During resize, hide hover snap on columns without an active snap override
    if (dragState) return getSnapOverrideMinute(dateStr) === null;
    return false;
  }

  function getSnapOverrideMinute(dateStr: string): number | null {
    // During create-by-drag, show snap at the active edge on the create column
    if (createState && createPreview && createPreviewDate === dateStr) {
      const anchor = createState.anchorMinute;
      const startMin = minuteOfDay(createPreview.event.start);
      const endMin = minuteOfDay(createPreview.event.end);
      return startMin === anchor ? endMin : startMin;
    }

    if (!dragPreview || !dragState || dragState.type === "move") return null;

    const previewStartDate = dragPreview.event.start.split(" ")[0];
    const previewEndDate = dragPreview.event.end.split(" ")[0];

    if (dragState.type === "resize-top") {
      // Snap line tracks the start handle
      if (dateStr === previewStartDate) {
        return minuteOfDay(dragPreview.event.start);
      }
      return null;
    }

    // resize-bottom: snap line tracks the end handle
    if (previewStartDate === previewEndDate) {
      // Same day — show snap on that day
      return dateStr === previewStartDate
        ? minuteOfDay(dragPreview.event.end)
        : null;
    }

    // Cross-midnight — show snap on the end day only
    if (dateStr === previewEndDate) {
      return minuteOfDay(dragPreview.event.end);
    }
    return null;
  }

  return {
    get dragState() { return dragState; },
    get dragPreview() { return dragPreview; },
    get dragPreviewDate() { return dragPreviewDate; },
    get createPreview() { return createPreview; },
    get createPreviewDate() { return createPreviewDate; },
    handleDragStart,
    handleCreateStart,
    getDragPreviewForDate,
    getCreatePreviewForDate,
    getHideSnapLine,
    getSnapOverrideMinute,
  };
}
