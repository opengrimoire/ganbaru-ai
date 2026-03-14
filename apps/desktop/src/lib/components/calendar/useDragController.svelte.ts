import type { CalendarEvent, DragState, PositionedEvent } from "./types";
import { minuteOfDay, minuteToTop, snapToGrid, clampMinute, formatDatePart } from "./utils";

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
  onEventUpdate: (event: CalendarEvent) => void;
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

    dragState = {
      eventId,
      type: "move",
      originDate: dateStr,
      originStartMinute: minuteOfDay(event.start),
      originEndMinute: minuteOfDay(event.end),
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
      targetDate = config.getColumnDate(e.clientX);
      newStart = clampMinute(dragState.originStartMinute + deltaMinutes);
      const dur = dragState.originEndMinute - dragState.originStartMinute;
      newEnd = clampMinute(newStart + dur);
      if (newEnd > 1440) {
        newEnd = 1440;
        newStart = newEnd - dur;
      }
      if (newStart < 0) {
        newStart = 0;
        newEnd = dur;
      }
    } else if (dragState.type === "resize-top") {
      newStart = clampMinute(dragState.originStartMinute + deltaMinutes);
      newEnd = dragState.originEndMinute;
      if (newStart > newEnd) {
        [newStart, newEnd] = [newEnd, newStart];
      }
      if (newEnd - newStart < 10) newEnd = newStart + 10;
    } else {
      newStart = dragState.originStartMinute;
      newEnd = clampMinute(dragState.originEndMinute + deltaMinutes);
      if (newEnd < newStart) {
        [newStart, newEnd] = [newEnd, newStart];
      }
      if (newEnd - newStart < 10) newEnd = newStart + 10;
    }

    const startH = String(Math.floor(newStart / 60)).padStart(2, "0");
    const startM = String(newStart % 60).padStart(2, "0");
    const endH = String(Math.floor(Math.min(newEnd, 1440) / 60)).padStart(2, "0");
    const endM = String(Math.min(newEnd, 1440) % 60).padStart(2, "0");

    dragPreviewDate = targetDate;
    dragPreview = {
      event: {
        ...event,
        start: `${targetDate} ${startH}:${startM}`,
        end: `${targetDate} ${endH}:${endM}`,
      },
      top: minuteToTop(newStart, hourHeight),
      height: ((newEnd - newStart) / 60) * hourHeight,
      left: 0,
      width: 100,
      column: 0,
      totalColumns: 1,
    };
  }

  function handleDragEnd() {
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", handleDragEnd);
    unlockCursor();

    if (dragPreview) {
      config.onEventUpdate(dragPreview.event);
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
  ): PositionedEvent {
    const hourHeight = config.hourHeight();
    const sh = String(Math.floor(startMinute / 60)).padStart(2, "0");
    const sm = String(startMinute % 60).padStart(2, "0");
    const eh = String(Math.floor(Math.min(endMinute, 1440) / 60)).padStart(2, "0");
    const em = String(Math.min(endMinute, 1440) % 60).padStart(2, "0");

    return {
      event: {
        id: "__create__",
        title: "",
        start: `${dateStr} ${sh}:${sm}`,
        end: `${dateStr} ${eh}:${em}`,
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
    return dragPreviewDate === dateStr ? dragPreview : null;
  }

  function getCreatePreviewForDate(
    dateStr: string,
    pendingCreatePreview?: {
      dateStr: string;
      startMinute: number;
      endMinute: number;
    } | null,
  ): PositionedEvent | null {
    if (createPreviewDate === dateStr) return createPreview;
    if (pendingCreatePreview?.dateStr === dateStr) {
      return buildPreview(
        dateStr,
        pendingCreatePreview.startMinute,
        pendingCreatePreview.endMinute,
      );
    }
    return null;
  }

  function getHideSnapLine(): boolean {
    return dragState?.type === "move" && !!dragPreview;
  }

  function getSnapOverrideMinute(dateStr: string): number | null {
    if (!dragPreview || !dragState || dragState.type === "move") return null;
    if (dragPreviewDate !== dateStr) return null;

    if (dragState.type === "resize-top") {
      return minuteOfDay(dragPreview.event.start) < dragState.originEndMinute
        ? minuteOfDay(dragPreview.event.start)
        : minuteOfDay(dragPreview.event.end);
    }
    return minuteOfDay(dragPreview.event.end) > dragState.originStartMinute
      ? minuteOfDay(dragPreview.event.end)
      : minuteOfDay(dragPreview.event.start);
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
