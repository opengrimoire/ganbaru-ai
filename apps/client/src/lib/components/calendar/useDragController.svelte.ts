import type { CalendarEvent, DragState, EventColor, PositionedEvent } from "./types";
import type { PanelAnchor } from "./edit-session.svelte";
import { tick } from "svelte";
import {
  minuteOfDay,
  snapToGrid,
  clampMinute,
  formatDatePart,
  durationMinutes,
  minuteOffsetToDateStr,
  parseCalendarDate,
} from "./utils";
import { getCalendarZoom } from "$lib/stores/calendarZoom.svelte";

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

// Auto-scroll constants
const AUTO_SCROLL_ZONE = 48; // px from edge to start scrolling
const AUTO_SCROLL_MAX_SPEED = 12; // px per frame at the very edge
const DEFAULT_CLICK_EVENT_MINUTES = 60;
const CREATE_HOLD_PREVIEW_DELAY_MS = 160;
const CREATE_DRAG_THRESHOLD_PX = 3;
const EVENT_DRAG_THRESHOLD_PX = 3;

export interface DragControllerConfig {
  events: () => CalendarEvent[];
  hourHeight: () => number;
  getColumnDate: (clientX: number) => string;
  getScrollContainer: () => HTMLElement | null;
  onEventUpdate: (event: CalendarEvent) => void | Promise<void>;
  onEventCreate: (start: string, end: string, anchor?: PanelAnchor) => void;
  canDrag?: (eventId: string) => boolean;
  /** Returns true if event has completed progress and should not be moved or resized. */
  isEventLocked?: (eventId: string) => boolean;
  /** The currently active pomodoro block ID (only resize-bottom is allowed). */
  activeBlockId?: () => string | null;
}

export function useDragController(config: DragControllerConfig) {
  const calZoom = getCalendarZoom();
  let dragState = $state<DragState | null>(null);
  let dragPreviewDate = $state<string | null>(null);
  let dragPreview = $state<PositionedEvent | null>(null);
  let dragGuideDate = $state<string | null>(null);
  let dragGuideMinute = $state<number | null>(null);
  let grabbingId = $state<string | null>(null); // Set immediately on pointerdown for visual feedback
  let _didDrag = $state(false); // Suppress click after drag

  let createState = $state<{
    dateStr: string;
    anchorMinute: number;
    columnEl: HTMLElement;
    pointerStartX: number;
    pointerStartY: number;
    mode: "pending" | "selecting";
  } | null>(null);
  let createPreviewDate = $state<string | null>(null);
  let createPreview = $state<PositionedEvent | null>(null);
  let createGuideDate = $state<string | null>(null);
  let createGuideMinute = $state<number | null>(null);
  let createHoldTimer = 0;

  // Track latest pointer position for scroll-triggered updates and auto-scroll
  let lastPointerEvent: PointerEvent | null = null;
  let dragInteractionActive = false;
  let autoScrollRaf = 0;
  let scrollUpdateRaf = 0;
  let scrollUpdateContainer: HTMLElement | null = null;

  // Auto-scroll

  function getScrollEdgeSpeed(container: HTMLElement, clientY: number): number {
    const rect = container.getBoundingClientRect();
    // Find the bottom of any sticky header inside the container
    let topEdge = rect.top;
    for (const el of container.querySelectorAll(":scope > .sticky, :scope > div > .sticky")) {
      const h = el as HTMLElement;
      if (h.offsetHeight > 0) {
        topEdge = Math.max(topEdge, h.getBoundingClientRect().bottom);
      }
    }
    const distFromTop = clientY - topEdge;
    const distFromBottom = rect.bottom - clientY;

    if (distFromTop < AUTO_SCROLL_ZONE && distFromTop < distFromBottom) {
      // Scroll up: speed increases as pointer gets closer to edge
      return -AUTO_SCROLL_MAX_SPEED * (1 - distFromTop / AUTO_SCROLL_ZONE);
    }
    if (distFromBottom < AUTO_SCROLL_ZONE && distFromBottom < distFromTop) {
      // Scroll down
      return AUTO_SCROLL_MAX_SPEED * (1 - distFromBottom / AUTO_SCROLL_ZONE);
    }
    return 0;
  }

  function autoScrollLoop() {
    autoScrollRaf = 0;
    const container = config.getScrollContainer();
    if (!container || (!dragState && !createState) || !lastPointerEvent) return;

    const speed = getScrollEdgeSpeed(container, lastPointerEvent.clientY);
    if (speed !== 0) {
      container.scrollTop += speed;
      // Re-run the move handler so the preview tracks the new scroll position
      if (dragState && dragInteractionActive) updateDragPreview();
      if (createState) updateCreatePreview();
    }
    autoScrollRaf = requestAnimationFrame(autoScrollLoop);
  }

  function startAutoScroll() {
    if (!autoScrollRaf) autoScrollRaf = requestAnimationFrame(autoScrollLoop);
  }

  function stopAutoScroll() {
    if (autoScrollRaf) {
      cancelAnimationFrame(autoScrollRaf);
      autoScrollRaf = 0;
    }
  }

  function scheduleScrollDrivenUpdate() {
    if (scrollUpdateRaf) return;
    scrollUpdateRaf = requestAnimationFrame(() => {
      scrollUpdateRaf = 0;
      if (dragState && dragInteractionActive) updateDragPreview();
      if (createState) updateCreatePreview();
    });
  }

  function startScrollDrivenUpdates() {
    const container = config.getScrollContainer();
    if (!container || scrollUpdateContainer === container) return;
    stopScrollDrivenUpdates();
    scrollUpdateContainer = container;
    container.addEventListener("scroll", scheduleScrollDrivenUpdate, { passive: true });
  }

  function stopScrollDrivenUpdates() {
    if (scrollUpdateContainer) {
      scrollUpdateContainer.removeEventListener("scroll", scheduleScrollDrivenUpdate);
      scrollUpdateContainer = null;
    }
    if (scrollUpdateRaf) {
      cancelAnimationFrame(scrollUpdateRaf);
      scrollUpdateRaf = 0;
    }
  }

  function clearCreateHoldTimer() {
    if (createHoldTimer) {
      clearTimeout(createHoldTimer);
      createHoldTimer = 0;
    }
  }

  function guideFromDateStr(value: string): { date: string; minute: number } {
    return {
      date: value.split(" ")[0],
      minute: clampMinute(minuteOfDay(value)),
    };
  }

  // Scroll-aware delta

  function scrollAwareDeltaY(clientY: number): number {
    if (!dragState) return 0;
    const container = config.getScrollContainer();
    const scrollDelta = container ? container.scrollTop - dragState.scrollTopAtStart : 0;
    return (clientY - dragState.pointerStartY) + scrollDelta;
  }

  // Existing event drag (move / resize)

  function handleDragStart(eventId: string, e: PointerEvent, forceEdge?: "resize-top" | "resize-bottom") {
    if (config.canDrag && !config.canDrag(eventId)) return;

    const event = config.events().find((ev) => ev.id === eventId);
    if (!event || event.allDay) return;

    const dateStr = event.start.split(" ")[0];
    const startMin = minuteOfDay(event.start);
    const dur = durationMinutes(event.start, event.end);
    const container = config.getScrollContainer();

    dragState = {
      eventId,
      type: "move",
      originDate: dateStr,
      startColumnDate: config.getColumnDate(e.clientX),
      originStartMinute: startMin,
      originEndMinute: startMin + dur,
      pointerStartY: e.clientY,
      pointerStartX: e.clientX,
      scrollTopAtStart: container ? container.scrollTop : 0,
      columnWidth: 0,
      startColumnIndex: 0,
    };

    if (forceEdge) {
      dragState.type = forceEdge;
    } else {
      const blockEl = (e.target as HTMLElement).closest(".event-block-wrapper");
      if (blockEl) {
        const rect = blockEl.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        const clippedTop = blockEl.hasAttribute("data-clipped-top");
        const clippedBottom = blockEl.hasAttribute("data-clipped-bottom");
        // Match the resize handle's visible zone (6px inside block after overflow clipping)
        // Top handle: visible from y=0 to y<6 (6 pixels)
        // Bottom handle: visible from y>H-6 to y<H (6 pixels, where H is block height)
        if (relY < 6 && !clippedTop) {
          dragState.type = "resize-top";
        } else if (relY >= rect.height - 6 && !clippedBottom) {
          dragState.type = "resize-bottom";
        }
      }
    }

    // Active block: only allow resize-bottom (extend/shrink future end)
    const activeId = config.activeBlockId?.();
    if (activeId && eventId === activeId) {
      if (dragState.type !== "resize-bottom") {
        dragState = null;
        return;
      }
    }

    // Locked events (past with completed progress): no drag/resize at all
    if (config.isEventLocked?.(eventId)) {
      dragState = null;
      return;
    }

    if (dragState.type === "resize-top" || dragState.type === "resize-bottom") {
      lockCursor("ns-resize");
    } else {
      lockCursor("grabbing");
    }

    dragInteractionActive = dragState.type === "resize-top" || dragState.type === "resize-bottom";
    grabbingId = eventId; // Show contour immediately on grab
    lastPointerEvent = e;
    window.addEventListener("pointermove", handleDragMove);
    window.addEventListener("pointerup", handleDragEnd);
    startScrollDrivenUpdates();
    if (dragInteractionActive) startAutoScroll();
  }

  function updateDragPreview() {
    if (!dragState || !lastPointerEvent) return;

    const event = config.events().find((ev) => ev.id === dragState!.eventId);
    if (!event) return;

    const e = lastPointerEvent;
    const hourHeight = config.hourHeight();
    const deltaY = scrollAwareDeltaY(e.clientY);
    const deltaMinutes = snapToGrid((deltaY / hourHeight) * 60, calZoom.gridMinutes);

    let newStart: number;
    let newEnd: number;
    let targetDate = dragState.originDate;
    let resizeGuideEdge: "start" | "end" | null = null;

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
      let rawStart = snapToGrid(dragState.originStartMinute + deltaMinutes, calZoom.gridMinutes);

      // Shift target day when event fully crosses midnight vertically
      while (rawStart >= 1440) {
        rawStart -= 1440;
        const td = parseCalendarDate(`${targetDate} 00:00`);
        td.setDate(td.getDate() + 1);
        targetDate = formatDatePart(td);
      }
      while (rawStart + dur <= 0) {
        rawStart += 1440;
        const td = parseCalendarDate(`${targetDate} 00:00`);
        td.setDate(td.getDate() - 1);
        targetDate = formatDatePart(td);
      }

      newStart = Math.min(1430, rawStart);
      newEnd = newStart + dur; // may exceed 1440 or start < 0 (cross-midnight)
    } else if (dragState.type === "resize-top") {
      const minSize = calZoom.gridMinutes;
      const anchor = dragState.originEndMinute;
      let raw = snapToGrid(dragState.originStartMinute + deltaMinutes, minSize);
      raw = Math.max(0, raw);
      if (raw < anchor) {
        newStart = raw;
        newEnd = anchor;
        if (newEnd - newStart < minSize) newStart = newEnd - minSize;
        resizeGuideEdge = "start";
      } else {
        // Flipped: top handle crossed below bottom
        newStart = anchor;
        newEnd = raw;
        if (newEnd - newStart < minSize) newEnd = newStart + minSize;
        resizeGuideEdge = "end";
      }
    } else {
      // resize-bottom (supports crossover and crossing midnight)
      const minSize = calZoom.gridMinutes;
      const anchor = dragState.originStartMinute;
      let raw = snapToGrid(dragState.originEndMinute + deltaMinutes, minSize);
      if (raw > anchor) {
        newStart = anchor;
        newEnd = raw;
        if (newEnd - newStart < minSize) newEnd = newStart + minSize;
        resizeGuideEdge = "end";
      } else {
        // Flipped: bottom handle crossed above top
        raw = Math.max(0, raw);
        newStart = raw;
        newEnd = anchor;
        if (newEnd - newStart < minSize) newStart = newEnd - minSize;
        resizeGuideEdge = "start";
      }
    }

    // Active block: start is sacred, only future end can change
    const activeResize = config.activeBlockId?.();
    if (activeResize && dragState.eventId === activeResize) {
      newStart = dragState.originStartMinute;
      resizeGuideEdge = "end";
      const now = new Date();
      const nowMinute = now.getHours() * 60 + now.getMinutes();
      const snap = calZoom.gridMinutes;
      const minEnd = snapToGrid(nowMinute, snap) + snap;
      if (newEnd < minEnd) newEnd = minEnd;
    }

    // During resize, if end reaches midnight, snap to at least 00:30 next day
    // so the continuation "tip" is clearly visible and easy to grab.
    // For move, exact midnight (1440) is valid since duration is preserved.
    if (dragState.type !== "move" && newEnd >= 1440 && newEnd < 1470) {
      newEnd = 1470;
    }

    const startStr = minuteOffsetToDateStr(targetDate, newStart);
    const endStr = minuteOffsetToDateStr(targetDate, newEnd);

    // Minute-based metrics for the primary (start) day column
    const visibleEnd = Math.min(newEnd, 1440);

    dragPreviewDate = targetDate;
    dragPreview = {
      event: {
        ...event,
        start: startStr,
        end: endStr,
      },
      startMinute: newStart,
      durationMinutes: visibleEnd - newStart,
      left: 0,
      width: 100,
      column: 0,
      totalColumns: 1,
    };

    if (resizeGuideEdge) {
      const guide = guideFromDateStr(resizeGuideEdge === "start" ? startStr : endStr);
      dragGuideDate = guide.date;
      dragGuideMinute = guide.minute;
    } else {
      dragGuideDate = null;
      dragGuideMinute = null;
    }
  }

  function handleDragMove(e: PointerEvent) {
    if (!dragState) return;
    lastPointerEvent = e;
    if (!dragInteractionActive) {
      const dx = e.clientX - dragState.pointerStartX;
      const dy = e.clientY - dragState.pointerStartY;
      const movedEnough = Math.hypot(dx, dy) >= EVENT_DRAG_THRESHOLD_PX;
      if (!movedEnough) return;
      dragInteractionActive = true;
      startAutoScroll();
    }
    updateDragPreview();
  }

  async function handleDragEnd(e: PointerEvent) {
    window.removeEventListener("pointermove", handleDragMove);
    window.removeEventListener("pointerup", handleDragEnd);
    stopAutoScroll();
    stopScrollDrivenUpdates();
    unlockCursor();

    if (dragState) {
      lastPointerEvent = e;
      if (!dragInteractionActive) {
        const dx = e.clientX - dragState.pointerStartX;
        const dy = e.clientY - dragState.pointerStartY;
        dragInteractionActive = Math.hypot(dx, dy) >= EVENT_DRAG_THRESHOLD_PX;
      }
      if (dragInteractionActive) updateDragPreview();
    }

    const state = dragState;
    const wasDragging = !!dragPreview;

    if (dragPreview && state) {
      // Always notify parent that drag ended (sets lastDragEndTime to prevent panel close).
      // The parent checks if position actually changed before doing DB update.
      await config.onEventUpdate(dragPreview.event);
    }

    // Suppress the click that fires after pointerup
    if (wasDragging) {
      _didDrag = true;
      setTimeout(() => { _didDrag = false; }, 0);
    }

    dragState = null;
    dragPreview = null;
    dragPreviewDate = null;
    dragGuideDate = null;
    dragGuideMinute = null;
    grabbingId = null;
    lastPointerEvent = null;
    dragInteractionActive = false;
  }

  // Create-by-drag

  function handleCreateStart(dateStr: string, minute: number, e: PointerEvent) {
    if (dragState) return; // don't start create while an event drag is active

    const columnEl = (e.target as HTMLElement).closest("[data-day-column-shell]") as HTMLElement | null;
    if (!columnEl) return;

    const roundedMinute = Math.round(minute);
    createState = {
      dateStr,
      anchorMinute: roundedMinute,
      columnEl,
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      mode: "pending",
    };

    lastPointerEvent = e;
    lockCursor("crosshair");
    window.addEventListener("pointermove", handleCreateMove);
    window.addEventListener("pointerup", handleCreateEnd);
    createHoldTimer = window.setTimeout(() => {
      enterCreateSelection();
    }, CREATE_HOLD_PREVIEW_DELAY_MS);
  }

  function enterCreateSelection() {
    const state = createState;
    if (!state || state.mode === "selecting") return;

    clearCreateHoldTimer();
    createState = { ...state, mode: "selecting" };
    const snap = calZoom.gridMinutes;
    createPreviewDate = state.dateStr;
    createGuideDate = state.dateStr;
    createGuideMinute = state.anchorMinute;
    createPreview = buildPreview(
      state.dateStr,
      state.anchorMinute,
      Math.min(state.anchorMinute + snap, 1440),
    );
    startScrollDrivenUpdates();
    startAutoScroll();
  }

  function updateCreatePreview() {
    if (!createState || createState.mode !== "selecting" || !lastPointerEvent) return;

    const hourHeight = config.hourHeight();
    const rect = createState.columnEl.getBoundingClientRect();
    const offsetY = lastPointerEvent.clientY - rect.top;
    const cursorMinute = clampMinute(snapToGrid((offsetY / hourHeight) * 60, calZoom.gridMinutes));
    createGuideDate = createState.dateStr;
    createGuideMinute = cursorMinute;

    const anchor = createState.anchorMinute;
    let startMinute = Math.min(anchor, cursorMinute);
    let endMinute = Math.max(anchor, cursorMinute);
    const snap = calZoom.gridMinutes;
    if (endMinute - startMinute < snap) endMinute = startMinute + snap;

    createPreview = buildPreview(
      createState.dateStr,
      startMinute,
      clampMinute(endMinute),
    );
  }

  function getCreatePreviewAnchor(preview: PositionedEvent, columnEl: HTMLElement): PanelAnchor {
    const rect = columnEl.getBoundingClientRect();
    const hourHeight = config.hourHeight();
    return {
      x: rect.right,
      y: rect.top + (preview.startMinute / 60) * hourHeight,
      width: rect.width,
      height: (preview.durationMinutes / 60) * hourHeight,
    };
  }

  function handleCreateMove(e: PointerEvent) {
    const state = createState;
    if (!state) return;
    lastPointerEvent = e;

    if (state.mode === "pending") {
      const dx = e.clientX - state.pointerStartX;
      const dy = e.clientY - state.pointerStartY;
      const movedEnough = Math.hypot(dx, dy) >= CREATE_DRAG_THRESHOLD_PX;
      if (!movedEnough) return;
      enterCreateSelection();
    }

    updateCreatePreview();
  }

  async function handleCreateEnd(e: PointerEvent) {
    window.removeEventListener("pointermove", handleCreateMove);
    window.removeEventListener("pointerup", handleCreateEnd);
    clearCreateHoldTimer();
    stopAutoScroll();
    stopScrollDrivenUpdates();
    unlockCursor();

    if (createState) {
      lastPointerEvent = e;
      if (createState.mode === "pending") {
        const dx = e.clientX - createState.pointerStartX;
        const dy = e.clientY - createState.pointerStartY;
        if (Math.hypot(dx, dy) >= CREATE_DRAG_THRESHOLD_PX) {
          enterCreateSelection();
        }
      }
      updateCreatePreview();
    }

    const state = createState;

    if (state?.mode === "pending") {
      const endMinute = clampMinute(
        Math.min(state.anchorMinute + DEFAULT_CLICK_EVENT_MINUTES, 1440),
      );
      const preview = buildPreview(state.dateStr, state.anchorMinute, endMinute);
      createPreviewDate = state.dateStr;
      createPreview = preview;
      await tick();

      const start = preview.event.start;
      const end = preview.event.end;
      const anchor = getCreatePreviewAnchor(preview, state.columnEl);
      createState = null;
      createPreview = null;
      createPreviewDate = null;
      createGuideDate = null;
      createGuideMinute = null;
      config.onEventCreate(start, end, anchor);
      lastPointerEvent = null;
      return;
    }

    if (createPreview && state) {
      // Save values and clear preview state before calling onEventCreate.
      // This prevents both __create__ and PENDING_CREATE_ID from existing simultaneously,
      // which would cause the layout to see them as overlapping and animate width changes.
      const start = createPreview.event.start;
      const end = createPreview.event.end;
      const anchor = getCreatePreviewAnchor(createPreview, state.columnEl);
      createState = null;
      createPreview = null;
      createPreviewDate = null;
      createGuideDate = null;
      createGuideMinute = null;
      config.onEventCreate(start, end, anchor);
      lastPointerEvent = null;
    } else {
      createState = null;
      createPreview = null;
      createPreviewDate = null;
      createGuideDate = null;
      createGuideMinute = null;
      lastPointerEvent = null;
    }
  }

  function buildPreview(
    dateStr: string,
    startMinute: number,
    endMinute: number,
    title?: string,
    color?: EventColor,
  ): PositionedEvent {
    const start = Math.round(startMinute);
    const end = Math.round(Math.min(endMinute, 1440));
    const sh = String(Math.floor(start / 60)).padStart(2, "0");
    const sm = String(start % 60).padStart(2, "0");
    const eh = String(Math.floor(end / 60)).padStart(2, "0");
    const em = String(end % 60).padStart(2, "0");

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
      startMinute,
      durationMinutes: endMinute - startMinute,
      left: 0,
      width: 100,
      column: 0,
      totalColumns: 1,
    };
  }

  // Computed helpers for DayColumn props

  function getDragPreviewForDate(dateStr: string): PositionedEvent | null {
    if (!dragPreview) return null;

    const previewStartDate = dragPreview.event.start.split(" ")[0];
    const previewEndDate = dragPreview.event.end.split(" ")[0];

    // Single-day event: return preview as-is for its date
    if (previewStartDate === previewEndDate) {
      return dateStr === previewStartDate ? dragPreview : null;
    }

    // Start day: show from event start to bottom of day
    if (dateStr === previewStartDate) {
      const startMin = minuteOfDay(dragPreview.event.start);
      return {
        ...dragPreview,
        startMinute: startMin,
        durationMinutes: 1440 - startMin,
      };
    }

    // End day: show from top to event end
    if (dateStr === previewEndDate) {
      const endMin = minuteOfDay(dragPreview.event.end);
      if (endMin <= 0) return null;
      return {
        ...dragPreview,
        startMinute: 0,
        durationMinutes: endMin,
      };
    }

    return null;
  }

  function getCreatePreviewForDate(dateStr: string): PositionedEvent | null {
    if (createPreviewDate === dateStr) return createPreview;
    return null;
  }

  function getDragGuideMinuteForDate(dateStr: string): number | null {
    return dragGuideDate === dateStr ? dragGuideMinute : null;
  }

  function getCreateGuideMinuteForDate(dateStr: string): number | null {
    return createGuideDate === dateStr ? createGuideMinute : null;
  }

  return {
    get dragState() { return dragState; },
    get dragPreview() { return dragPreview; },
    get dragPreviewDate() { return dragPreviewDate; },
    get createPreview() { return createPreview; },
    get createPreviewDate() { return createPreviewDate; },
    get grabbingId() { return grabbingId; },
    get didDrag() { return _didDrag; },
    handleDragStart,
    handleCreateStart,
    getDragPreviewForDate,
    getCreatePreviewForDate,
    getDragGuideMinuteForDate,
    getCreateGuideMinuteForDate,
  };
}
