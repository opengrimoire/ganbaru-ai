/**
 * Headless handle for driving calendar navigation from outside the component
 * tree. The benchmark harness calls `navigate("forward")` and
 * `setViewMode("week")` programmatically; without this indirection the
 * scenario module would have to reach into a Svelte component's internal
 * state, which Svelte 5 does not expose stably.
 *
 * `CalendarView.svelte` registers its in-component `navigate` and view-setter
 * on mount and clears them on unmount. Until a registration lands, the
 * methods are no-ops, which is also the right behavior when the calendar
 * view is not the current navigation target.
 */
import type { CalendarViewMode } from "./types";

type NavigateDirection = "today" | "back" | "forward";
type NavigateFn = (direction: NavigateDirection) => void;
type SetViewModeFn = (mode: CalendarViewMode) => void;
type SetAnchorDateFn = (date: Date) => void;
type OpenVisibleEventFn = (index: number) => Promise<boolean>;
type OpenCreatePanelFn = (start: string, end: string, allDay?: boolean) => Promise<boolean>;
type ClosePanelFn = () => Promise<void>;

class CalendarNavHandle {
  #navigate: NavigateFn | null = null;
  #setViewMode: SetViewModeFn | null = null;
  #setAnchorDate: SetAnchorDateFn | null = null;
  #openVisibleEvent: OpenVisibleEventFn | null = null;
  #openCreatePanel: OpenCreatePanelFn | null = null;
  #closePanel: ClosePanelFn | null = null;
  #viewMode: CalendarViewMode = "week";

  /**
   * Called by `CalendarView.svelte` on mount. Returns a disposer that the
   * component runs from its onMount cleanup.
   */
  register(opts: {
    navigate: NavigateFn;
    setViewMode: SetViewModeFn;
    setAnchorDate: SetAnchorDateFn;
    openVisibleEvent: OpenVisibleEventFn;
    openCreatePanel: OpenCreatePanelFn;
    closePanel: ClosePanelFn;
    getViewMode: () => CalendarViewMode;
  }): () => void {
    this.#navigate = opts.navigate;
    this.#setViewMode = opts.setViewMode;
    this.#setAnchorDate = opts.setAnchorDate;
    this.#openVisibleEvent = opts.openVisibleEvent;
    this.#openCreatePanel = opts.openCreatePanel;
    this.#closePanel = opts.closePanel;
    this.#viewMode = opts.getViewMode();
    return () => {
      this.#navigate = null;
      this.#setViewMode = null;
      this.#setAnchorDate = null;
      this.#openVisibleEvent = null;
      this.#openCreatePanel = null;
      this.#closePanel = null;
    };
  }

  /** Called from the view's $effect when viewMode changes so callers can read it. */
  reportViewMode(mode: CalendarViewMode) {
    this.#viewMode = mode;
  }

  /** Whether a CalendarView is currently mounted. */
  get available(): boolean {
    return this.#navigate !== null;
  }

  get viewMode(): CalendarViewMode {
    return this.#viewMode;
  }

  navigate(direction: NavigateDirection) {
    this.#navigate?.(direction);
  }

  setViewMode(mode: CalendarViewMode) {
    this.#setViewMode?.(mode);
  }

  setAnchorDate(date: Date) {
    this.#setAnchorDate?.(date);
  }

  openVisibleEvent(index: number): Promise<boolean> {
    return this.#openVisibleEvent?.(index) ?? Promise.resolve(false);
  }

  openCreatePanel(start: string, end: string, allDay?: boolean): Promise<boolean> {
    return this.#openCreatePanel?.(start, end, allDay) ?? Promise.resolve(false);
  }

  closePanel(): Promise<void> {
    return this.#closePanel?.() ?? Promise.resolve();
  }
}

let handle: CalendarNavHandle | null = null;

export function getCalendarNavHandle(): CalendarNavHandle {
  if (!handle) handle = new CalendarNavHandle();
  return handle;
}
