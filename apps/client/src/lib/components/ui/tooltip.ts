export type TooltipPlacement = "top" | "bottom";

export interface TooltipRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface TooltipViewport {
  width: number;
  height: number;
}

export interface TooltipPositionOptions {
  gap?: number;
  margin?: number;
  arrowInset?: number;
}

export interface TooltipPosition {
  left: number;
  top: number;
  arrowLeft: number;
  placement: TooltipPlacement;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundPx(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calculates a stable tooltip position from the target element, not the
 * pointer position. The arrow still points at the target center after the
 * bubble is clamped inside the viewport.
 */
export function calculateTooltipPosition(
  anchor: TooltipRect,
  tooltip: TooltipRect,
  viewport: TooltipViewport,
  options: TooltipPositionOptions = {},
): TooltipPosition {
  const gap = options.gap ?? 10;
  const margin = options.margin ?? 8;
  const arrowInset = options.arrowInset ?? 12;
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  const anchorCenter = anchor.left + anchor.width / 2;
  const leftMax = Math.max(margin, viewportWidth - margin - tooltip.width);
  const left = clamp(anchorCenter - tooltip.width / 2, margin, leftMax);
  const topSpace = anchor.top - margin;
  const bottomSpace = viewportHeight - anchor.bottom - margin;
  const placement: TooltipPlacement =
    topSpace >= tooltip.height + gap || topSpace >= bottomSpace ? "top" : "bottom";
  const preferredTop = placement === "top"
    ? anchor.top - gap - tooltip.height
    : anchor.bottom + gap;
  const topMax = Math.max(margin, viewportHeight - margin - tooltip.height);
  const top = clamp(preferredTop, margin, topMax);
  const arrowMax = Math.max(arrowInset, tooltip.width - arrowInset);
  const arrowLeft = clamp(anchorCenter - left, arrowInset, arrowMax);

  return {
    left: roundPx(left),
    top: roundPx(top),
    arrowLeft: roundPx(arrowLeft),
    placement,
  };
}
