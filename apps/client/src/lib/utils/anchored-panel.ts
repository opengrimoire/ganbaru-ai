/** Viewport and anchor bounds used by shared floating controls. */
export interface AnchoredPanelInput {
  triggerRect: { top: number; right: number; bottom: number; left: number };
  viewportWidth: number;
  viewportHeight: number;
  preferredWidth?: number;
  preferredMaxHeight?: number;
  margin?: number;
  gap?: number;
}

/** Place a panel above or below its anchor without leaving the viewport. */
export function anchoredPanelStyle(
  input: AnchoredPanelInput,
): string {
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 4;
  const preferredWidth = input.preferredWidth ?? 256;
  const preferredMaxHeight = input.preferredMaxHeight ?? 448;
  const width = Math.max(0, Math.min(preferredWidth, input.viewportWidth - margin * 2));
  const maxLeft = Math.max(margin, input.viewportWidth - margin - width);
  const left = clamp(input.triggerRect.left, margin, maxLeft);
  const belowTop = input.triggerRect.bottom + gap;
  const aboveAvailable = Math.max(0, input.triggerRect.top - margin - gap);
  const belowAvailable = Math.max(0, input.viewportHeight - belowTop - margin);
  const openAbove = belowAvailable < Math.min(180, preferredMaxHeight) && aboveAvailable > belowAvailable;
  const maxHeight = Math.max(0, Math.min(preferredMaxHeight, openAbove ? aboveAvailable : belowAvailable));
  const top = openAbove
    ? Math.max(margin, input.triggerRect.top - gap - maxHeight)
    : Math.min(belowTop, Math.max(margin, input.viewportHeight - margin - maxHeight));
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
