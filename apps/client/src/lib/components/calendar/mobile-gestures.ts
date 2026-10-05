export const CALENDAR_TOUCH_LONG_PRESS_MS = 450;
export const CALENDAR_TOUCH_SLOP_PX = 10;

export type CalendarSwipeAxis = "horizontal" | "vertical" | null;

export interface CalendarSwipeCommitInput {
  deltaX: number;
  elapsedMs: number;
  viewportWidth: number;
}

export interface CalendarTouchHoldOptions {
  immediate?: boolean;
  onTap?: (event: PointerEvent) => void;
}

export function calendarTouchMovedBeyondSlop(deltaX: number, deltaY: number): boolean {
  return Math.hypot(deltaX, deltaY) > CALENDAR_TOUCH_SLOP_PX;
}

export function calendarSwipeAxis(deltaX: number, deltaY: number): CalendarSwipeAxis {
  if (!calendarTouchMovedBeyondSlop(deltaX, deltaY)) return null;
  return Math.abs(deltaX) > Math.abs(deltaY) * 1.15 ? "horizontal" : "vertical";
}

export function calendarSwipeDirection(deltaX: number): "back" | "forward" | null {
  if (deltaX === 0) return null;
  return deltaX < 0 ? "forward" : "back";
}

export function calendarSwipeNavigation(
  input: CalendarSwipeCommitInput,
): "back" | "forward" | null {
  const elapsedMs = Math.max(1, input.elapsedMs);
  const velocity = input.deltaX / elapsedMs;
  const distanceThreshold = Math.min(72, Math.max(36, input.viewportWidth * 0.12));
  const committed = Math.abs(input.deltaX) >= distanceThreshold || Math.abs(velocity) >= 0.3;
  if (!committed) return null;
  return calendarSwipeDirection(input.deltaX);
}

export class CalendarTouchHoldArbiter {
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private timer = 0;
  private active = false;
  private activate: (() => void) | null = null;
  private onTap: ((event: PointerEvent) => void) | null = null;

  get editingActive(): boolean {
    return this.active;
  }

  begin(
    event: PointerEvent,
    activate: () => void,
    options: CalendarTouchHoldOptions = {},
  ): void {
    this.finish();
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.activate = activate;
    this.onTap = options.onTap ?? null;
    window.addEventListener("pointermove", this.handlePendingPointerMove);
    window.addEventListener("pointerup", this.handlePendingPointerEnd);
    window.addEventListener("pointercancel", this.handlePendingPointerEnd);
    window.addEventListener("touchmove", this.blockActiveTouchMove, { capture: true, passive: false });
    if (options.immediate) {
      this.activateNow();
      return;
    }
    this.timer = window.setTimeout(this.activateNow, CALENDAR_TOUCH_LONG_PRESS_MS);
  }

  finish(): void {
    this.clearTimer();
    this.removePendingPointerListeners();
    window.removeEventListener("touchmove", this.blockActiveTouchMove, true);
    this.pointerId = null;
    this.activate = null;
    this.onTap = null;
    this.active = false;
  }

  private readonly activateNow = (): void => {
    const activate = this.activate;
    if (this.pointerId === null || !activate) return;
    this.clearTimer();
    this.removePendingPointerListeners();
    this.active = true;
    activate();
  };

  private readonly handlePendingPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    if (!calendarTouchMovedBeyondSlop(event.clientX - this.startX, event.clientY - this.startY)) return;
    this.finish();
  };

  private readonly handlePendingPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    const onTap = event.type === "pointerup" ? this.onTap : null;
    this.finish();
    onTap?.(event);
  };

  private readonly blockActiveTouchMove = (event: TouchEvent): void => {
    if (this.active && event.cancelable) event.preventDefault();
  };

  private clearTimer(): void {
    if (!this.timer) return;
    window.clearTimeout(this.timer);
    this.timer = 0;
  }

  private removePendingPointerListeners(): void {
    window.removeEventListener("pointermove", this.handlePendingPointerMove);
    window.removeEventListener("pointerup", this.handlePendingPointerEnd);
    window.removeEventListener("pointercancel", this.handlePendingPointerEnd);
  }
}
