export type ViewportSizeClass = "micro" | "narrow" | "compact" | "regular" | "wide";
export type EventPanelLayout = "anchored" | "centered" | "bottom" | "fullscreen";

export const EVENT_PANEL_MAX_WIDTH = 320;
export const EVENT_PANEL_EDGE_MARGIN = 8;
export const EVENT_PANEL_TITLE_BAR_HEIGHT = 42;
export const EVENT_PANEL_MIN_USABLE_HEIGHT = 280;

const SIZE_ORDER: readonly ViewportSizeClass[] = [
  "micro",
  "narrow",
  "compact",
  "regular",
  "wide",
];

export interface ViewportSize {
  width: number;
  height: number;
}

export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EventPanelAnchor {
  /**
   * Right edge of the trigger rect. This matches the existing calendar panel
   * anchor shape.
   */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EventPanelLayoutInput {
  viewport: ViewportSize;
  anchor: EventPanelAnchor;
  panelWidth?: number;
  edgeMargin?: number;
  titleBarHeight?: number;
  minUsableHeight?: number;
}

export interface RectMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ToolbarItem<TId extends string> {
  id: TId;
  width: number;
  priority: number;
  alwaysVisible?: boolean;
}

export interface ToolbarPacking<TId extends string> {
  visible: TId[];
  overflow: TId[];
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function classifyViewport(width: number, height: number): ViewportSizeClass {
  const w = finiteOrZero(width);
  const h = finiteOrZero(height);

  if (w < 390 || h < 360) return "micro";
  if (w < 560) return "narrow";
  if (w < 800 || h < 600) return "compact";
  if (w < 1100 || h < 700) return "regular";
  return "wide";
}

export function compareSizeClasses(a: ViewportSizeClass, b: ViewportSizeClass): number {
  return SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b);
}

export function isSizeClassAtLeast(
  current: ViewportSizeClass,
  minimum: ViewportSizeClass,
): boolean {
  return compareSizeClasses(current, minimum) >= 0;
}

export function pickToolbarItems<TId extends string>(
  items: readonly ToolbarItem<TId>[],
  availableWidth: number,
): ToolbarPacking<TId> {
  const remainingWidth = finiteOrZero(availableWidth);
  const visible = new Set<TId>();
  let usedWidth = 0;

  for (const item of items) {
    if (!item.alwaysVisible) continue;
    visible.add(item.id);
    usedWidth += finiteOrZero(item.width);
  }

  const optionalItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.alwaysVisible)
    .sort((a, b) => a.item.priority - b.item.priority || a.index - b.index);

  for (const { item } of optionalItems) {
    const itemWidth = finiteOrZero(item.width);
    if (usedWidth + itemWidth > remainingWidth) continue;
    visible.add(item.id);
    usedWidth += itemWidth;
  }

  return {
    visible: items.filter((item) => visible.has(item.id)).map((item) => item.id),
    overflow: items.filter((item) => !visible.has(item.id)).map((item) => item.id),
  };
}

export function getResponsivePanelWidth(
  viewportWidth: number,
  maxWidth = EVENT_PANEL_MAX_WIDTH,
  margin = EVENT_PANEL_EDGE_MARGIN,
): number {
  const width = finiteOrZero(viewportWidth);
  const cap = finiteOrZero(maxWidth);
  const edge = finiteOrZero(margin);
  return Math.max(0, Math.min(cap, width - edge * 2));
}

export function getEventPanelUsableHeight(
  viewportHeight: number,
  titleBarHeight = EVENT_PANEL_TITLE_BAR_HEIGHT,
  edgeMargin = EVENT_PANEL_EDGE_MARGIN,
): number {
  return Math.max(
    0,
    finiteOrZero(viewportHeight) - finiteOrZero(titleBarHeight) - finiteOrZero(edgeMargin) * 2,
  );
}

export function pickEventPanelLayout(input: EventPanelLayoutInput): EventPanelLayout {
  const width = finiteOrZero(input.viewport.width);
  const edge = finiteOrZero(input.edgeMargin ?? EVENT_PANEL_EDGE_MARGIN);
  const panelWidth = finiteOrZero(input.panelWidth ?? EVENT_PANEL_MAX_WIDTH);
  const minUsableHeight = finiteOrZero(input.minUsableHeight ?? EVENT_PANEL_MIN_USABLE_HEIGHT);
  const usableHeight = getEventPanelUsableHeight(
    input.viewport.height,
    input.titleBarHeight ?? EVENT_PANEL_TITLE_BAR_HEIGHT,
    edge,
  );

  if (usableHeight < minUsableHeight) return "fullscreen";
  if (width < panelWidth + edge * 2) return "bottom";

  const anchorLeft = finiteOrZero(input.anchor.x) - finiteOrZero(input.anchor.width);
  const anchorRight = finiteOrZero(input.anchor.x);
  const requiredSideSpace = panelWidth + edge * 2;
  const fitsLeft = anchorLeft >= requiredSideSpace;
  const fitsRight = width - anchorRight >= requiredSideSpace;

  return fitsLeft || fitsRight ? "anchored" : "centered";
}

export function normalizeMargins(margins: number | Partial<RectMargins>): RectMargins {
  if (typeof margins === "number") {
    const value = finiteOrZero(margins);
    return { top: value, right: value, bottom: value, left: value };
  }
  return {
    top: finiteOrZero(margins.top ?? 0),
    right: finiteOrZero(margins.right ?? 0),
    bottom: finiteOrZero(margins.bottom ?? 0),
    left: finiteOrZero(margins.left ?? 0),
  };
}

export function clampPanelRect(
  rect: PanelRect,
  viewport: ViewportSize,
  margins: number | Partial<RectMargins>,
): PanelRect {
  const m = normalizeMargins(margins);
  const viewportWidth = finiteOrZero(viewport.width);
  const viewportHeight = finiteOrZero(viewport.height);
  const maxWidth = Math.max(0, viewportWidth - m.left - m.right);
  const maxHeight = Math.max(0, viewportHeight - m.top - m.bottom);
  const width = Math.min(finiteOrZero(rect.width), maxWidth);
  const height = Math.min(finiteOrZero(rect.height), maxHeight);
  const minX = m.left;
  const maxX = Math.max(minX, viewportWidth - m.right - width);
  const minY = m.top;
  const maxY = Math.max(minY, viewportHeight - m.bottom - height);
  const x = Math.min(Math.max(finiteOrZero(rect.x), minX), maxX);
  const y = Math.min(Math.max(finiteOrZero(rect.y), minY), maxY);
  return { x, y, width, height };
}
