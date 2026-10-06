import { tick } from "svelte";
import {
  doubleClickProjectTaskListColumnResizeWidths,
  keyboardProjectTaskListColumnResizeWidths,
  moveProjectTaskListColumnResize,
  projectTaskListResizableColumnWidthRem,
  startProjectTaskListColumnResize,
  type ProjectTaskListColumnResizeGesture,
  type ProjectTaskListColumnWidths,
  type ProjectTaskListGridInput,
  type ProjectTaskListResizableColumn,
} from "$lib/projects/list/view";

const KEYBOARD_SCROLL_PX = 48;

/** Class of the Projects list scroll container. */
export const PROJECT_LIST_SCROLL_CLASS = "project-list-scroll";
/** Class of rows that stay in place while the list scrolls horizontally. */
export const PROJECT_LIST_STICKY_ROW_CLASS = "project-list-sticky-row";

const stickyOffsets = new WeakMap<HTMLElement, number>();

function setStickyRowOffset(row: HTMLElement, scrollLeft: number): void {
  row.style.setProperty("--project-list-scroll-left", `${scrollLeft}px`);
  row.style.setProperty("--project-list-scroll-left-negative", `${-scrollLeft}px`);
}

/**
 * Counter-translates every sticky row by the horizontal scroll offset.
 *
 * The offset is written on the sticky rows rather than on the container, because an inherited custom property on the container restyles every task cell on each scroll step.
 *
 * @param container Projects list scroll container.
 * @param scrollLeft Clamped horizontal scroll offset in pixels.
 */
export function setProjectListStickyRowsOffset(container: HTMLElement, scrollLeft: number): void {
  stickyOffsets.set(container, scrollLeft);
  for (const row of container.getElementsByClassName(PROJECT_LIST_STICKY_ROW_CLASS)) {
    if (row instanceof HTMLElement) setStickyRowOffset(row, scrollLeft);
  }
}

/**
 * Starts a sticky row that mounts after the list has scrolled at the current offset.
 *
 * @param node Sticky row element inside the Projects list scroll container.
 */
export function projectListStickyRow(node: HTMLElement): void {
  const container = node.closest<HTMLElement>(`.${PROJECT_LIST_SCROLL_CLASS}`);
  const scrollLeft = container ? stickyOffsets.get(container) : undefined;
  if (scrollLeft) setStickyRowOffset(node, scrollLeft);
}

export interface ProjectListViewportControllerContext {
  getColumnWidths: () => ProjectTaskListColumnWidths;
  getGridInput: (widths: ProjectTaskListColumnWidths) => ProjectTaskListGridInput;
  persistColumnWidths: (widths: ProjectTaskListColumnWidths) => Promise<void>;
}

function cssPixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function keyboardScrollAllowed(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return !target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']");
}

export class ProjectListViewportController {
  container = $state<HTMLDivElement | null>(null);
  resizeGesture = $state<ProjectTaskListColumnResizeGesture | null>(null);
  resizeError = $state<string | null>(null);
  private pendingWidths = $state<ProjectTaskListColumnWidths | null>(null);
  private resizeWriteId = 0;

  constructor(private readonly context: ProjectListViewportControllerContext) {}

  get effectiveColumnWidths(): ProjectTaskListColumnWidths {
    return this.resizeGesture?.draftWidths ?? this.pendingWidths ?? this.context.getColumnWidths();
  }

  /** Retain the preview until persistence and the parent's props have settled. */
  private async commitWidths(widths: ProjectTaskListColumnWidths): Promise<void> {
    const writeId = ++this.resizeWriteId;
    this.pendingWidths = widths;
    this.resizeError = null;
    try {
      await this.context.persistColumnWidths(widths);
    } catch (error) {
      if (writeId === this.resizeWriteId) {
        this.resizeError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      await tick();
      if (writeId === this.resizeWriteId) this.pendingWidths = null;
      this.syncAfterRender();
    }
  }

  maxHorizontalScrollLeft = (): number => {
    const element = this.container;
    if (!element) return 0;
    const content = element.firstElementChild;
    if (!(content instanceof HTMLElement)) {
      return Math.max(0, element.scrollWidth - element.clientWidth);
    }

    const paddingRight = cssPixelValue(getComputedStyle(content).paddingRight);
    let contentRight = 0;
    for (const child of Array.from(content.children)) {
      if (child instanceof HTMLElement) {
        contentRight = Math.max(contentRight, child.offsetLeft + child.offsetWidth);
      }
    }
    return contentRight <= 0
      ? Math.max(0, element.scrollWidth - element.clientWidth)
      : Math.max(0, contentRight + paddingRight - element.clientWidth);
  };

  setHorizontalScroll = (scrollLeft: number): number => {
    const element = this.container;
    if (!element) return scrollLeft;
    const nextScrollLeft = Math.max(0, Math.min(this.maxHorizontalScrollLeft(), scrollLeft));
    setProjectListStickyRowsOffset(element, nextScrollLeft);
    if (element.scrollLeft !== nextScrollLeft) element.scrollLeft = nextScrollLeft;
    return nextScrollLeft;
  };

  syncCounterScroll = (): void => {
    if (this.container) this.setHorizontalScroll(this.container.scrollLeft);
  };

  syncAfterRender(): void {
    void tick().then(this.syncCounterScroll);
  }

  startResize = (event: PointerEvent, column: ProjectTaskListResizableColumn): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement)) return;
    const parsedRootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const rootFontSizePx = Number.isFinite(parsedRootSize) && parsedRootSize > 0 ? parsedRootSize : 16;
    const headerCell = trigger.closest(".collection-cell");
    const startWidthRem = headerCell instanceof HTMLElement
      ? headerCell.getBoundingClientRect().width / rootFontSizePx
      : projectTaskListResizableColumnWidthRem(column, this.context.getGridInput(this.effectiveColumnWidths));
    this.resizeGesture = startProjectTaskListColumnResize({
      column,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidthRem,
      rootFontSizePx,
      widthsAtStart: { ...this.effectiveColumnWidths },
    });
    trigger.setPointerCapture(event.pointerId);
  };

  handleResizePointerMove = (event: PointerEvent): void => {
    const gesture = this.resizeGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    this.resizeGesture = moveProjectTaskListColumnResize(gesture, event.clientX);
    this.syncAfterRender();
  };

  finishResize = (event: PointerEvent, persist: boolean): void => {
    const gesture = this.resizeGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (persist && gesture.moved) void this.commitWidths(gesture.draftWidths);
    this.resizeGesture = null;
    this.syncAfterRender();
  };

  handleResizeDoubleClick = (event: MouseEvent, column: ProjectTaskListResizableColumn): void => {
    event.preventDefault();
    event.stopPropagation();
    void this.commitWidths(doubleClickProjectTaskListColumnResizeWidths({
      column,
      widths: this.effectiveColumnWidths,
      gridInput: this.context.getGridInput(this.effectiveColumnWidths),
    }));
    this.syncAfterRender();
  };

  handleResizeKeydown = (event: KeyboardEvent, column: ProjectTaskListResizableColumn): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    void this.commitWidths(keyboardProjectTaskListColumnResizeWidths({
      column,
      direction: event.key === "ArrowRight" ? 1 : -1,
      wideStep: event.shiftKey,
      widths: this.effectiveColumnWidths,
      gridInput: this.context.getGridInput(this.effectiveColumnWidths),
    }));
    this.syncAfterRender();
  };

  handleHorizontalKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || !keyboardScrollAllowed(event.target)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const element = this.container;
    if (!element || this.maxHorizontalScrollLeft() <= 0) return;
    const delta = event.key === "ArrowRight" ? KEYBOARD_SCROLL_PX : -KEYBOARD_SCROLL_PX;
    const next = Math.max(0, Math.min(this.maxHorizontalScrollLeft(), element.scrollLeft + delta));
    if (next === element.scrollLeft) return;
    event.preventDefault();
    this.setHorizontalScroll(next);
  }
}
