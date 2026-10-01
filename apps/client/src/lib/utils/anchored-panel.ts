/** Viewport and anchor bounds used by shared floating controls. */
export interface AnchoredPanelInput {
  triggerRect: { top: number; right: number; bottom: number; left: number };
  viewportWidth: number;
  viewportHeight: number;
  preferredWidth?: number;
  preferredMaxHeight?: number;
  /** Intrinsic border-box height, measured independently of the scroll viewport. */
  contentHeight?: number;
  horizontalAlign?: "start" | "end";
  margin?: number;
  gap?: number;
}

/** Resolve the panel width before measuring wrapped content. */
export function anchoredPanelWidth(input: AnchoredPanelInput): number {
  const margin = input.margin ?? 8;
  return Math.max(0, Math.min(input.preferredWidth ?? 256, input.viewportWidth - margin * 2));
}

/** Measure intrinsic content and fractional borders without scrollbar rounding. */
export function anchoredPanelContentHeight(panel: HTMLElement, content: readonly HTMLElement[]): number {
  const style = window.getComputedStyle(panel);
  const borders = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
  return content.reduce((height, element) => height + element.getBoundingClientRect().height, borders);
}

/** Place a panel above or below its anchor without leaving the viewport. */
export function anchoredPanelStyle(
  input: AnchoredPanelInput,
): string {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 4;
  const preferredMaxHeight = input.preferredMaxHeight ?? 448;
  const contentHeight = Math.max(0, Math.min(input.contentHeight ?? preferredMaxHeight, preferredMaxHeight));
  const width = anchoredPanelWidth(input);
  const maxLeft = Math.max(margin, input.viewportWidth - margin - width);
  const anchorLeft = input.horizontalAlign === "end"
    ? input.triggerRect.right - width
    : input.triggerRect.left;
  const left = clamp(anchorLeft, margin, maxLeft);
  const belowTop = input.triggerRect.bottom + gap;
  const aboveAvailable = Math.max(0, input.triggerRect.top - margin - gap);
  const belowAvailable = Math.max(0, input.viewportHeight - belowTop - margin);
  const openAbove = belowAvailable < Math.min(180, contentHeight) && aboveAvailable > belowAvailable;
  const maxHeight = Math.max(0, Math.min(preferredMaxHeight, openAbove ? aboveAvailable : belowAvailable));
  const height = Math.min(contentHeight, maxHeight);
  const top = openAbove
    ? Math.max(margin, input.triggerRect.top - gap - height)
    : Math.min(belowTop, Math.max(margin, input.viewportHeight - margin - height));
  return [
    "position:fixed",
    `left:${Math.round(left)}px`,
    `top:${Math.round(top)}px`,
    `width:${Math.round(width)}px`,
    `max-height:${Math.round(maxHeight)}px`,
  ].join("; ");
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
