import type { CalendarEvent } from "./types";

export const MONTH_EVENT_CHIP_HEIGHT_PX = 20;
export const MONTH_EVENT_ROW_GAP_PX = 1;

const DEFAULT_HORIZONTAL_GAP_PX = 2;
const DEFAULT_MIN_EVENT_WIDTH_PX = 28;
const DEFAULT_MIN_MORE_WIDTH_PX = 42;
const DEFAULT_HORIZONTAL_PADDING_PX = 8;
const DEFAULT_AVG_CHAR_WIDTH_PX = 5.6;

interface MonthDayLayoutBase {
  row: number;
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
}

export interface MonthDayEventLayoutItem extends MonthDayLayoutBase {
  kind: "event";
  event: CalendarEvent;
}

export interface MonthDayMoreLayoutItem extends MonthDayLayoutBase {
  kind: "more";
  hiddenCount: number;
}

export type MonthDayLayoutItem = MonthDayEventLayoutItem | MonthDayMoreLayoutItem;

export interface MonthDayLayout {
  items: MonthDayLayoutItem[];
  hiddenCount: number;
  rowCount: number;
}

export interface MonthDayLayoutOptions {
  cellWidthPx: number;
  availableHeightPx: number;
  chipHeightPx?: number;
  rowGapPx?: number;
  horizontalGapPx?: number;
  minEventWidthPx?: number;
  minMoreWidthPx?: number;
  horizontalPaddingPx?: number;
  avgCharWidthPx?: number;
}

interface NormalizedMonthDayLayoutOptions {
  cellWidthPx: number;
  chipHeightPx: number;
  rowGapPx: number;
  horizontalGapPx: number;
  minEventWidthPx: number;
  minMoreWidthPx: number;
  horizontalPaddingPx: number;
  avgCharWidthPx: number;
}

function roundPx(value: number): number {
  return Math.round(value * 100) / 100;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}

function normalizeOptions(options: MonthDayLayoutOptions): NormalizedMonthDayLayoutOptions {
  const cellWidthPx = Math.max(0, Number.isFinite(options.cellWidthPx) ? options.cellWidthPx : 0);
  return {
    cellWidthPx,
    chipHeightPx: finitePositive(options.chipHeightPx, MONTH_EVENT_CHIP_HEIGHT_PX),
    rowGapPx: Math.max(0, finitePositive(options.rowGapPx, MONTH_EVENT_ROW_GAP_PX)),
    horizontalGapPx: Math.max(0, finitePositive(options.horizontalGapPx, DEFAULT_HORIZONTAL_GAP_PX)),
    minEventWidthPx: Math.max(0, finitePositive(options.minEventWidthPx, DEFAULT_MIN_EVENT_WIDTH_PX)),
    minMoreWidthPx: Math.max(0, finitePositive(options.minMoreWidthPx, DEFAULT_MIN_MORE_WIDTH_PX)),
    horizontalPaddingPx: Math.max(
      0,
      finitePositive(options.horizontalPaddingPx, DEFAULT_HORIZONTAL_PADDING_PX),
    ),
    avgCharWidthPx: finitePositive(options.avgCharWidthPx, DEFAULT_AVG_CHAR_WIDTH_PX),
  };
}

function rowCountForHeight(availableHeightPx: number, chipHeightPx: number, rowGapPx: number): number {
  if (!Number.isFinite(availableHeightPx) || availableHeightPx < chipHeightPx) return 0;
  return Math.max(0, Math.floor((availableHeightPx + rowGapPx) / (chipHeightPx + rowGapPx)));
}

function visibleTitle(event: CalendarEvent): string {
  const title = event.title.trim();
  return title.length > 0 ? title : "(No title)";
}

function textWidth(text: string, options: NormalizedMonthDayLayoutOptions): number {
  return text.length * options.avgCharWidthPx;
}

function estimateEventWidth(event: CalendarEvent, options: NormalizedMonthDayLayoutOptions): number {
  if (options.cellWidthPx <= 0) return 0;
  const minWidth = Math.min(options.cellWidthPx, options.minEventWidthPx);
  const maxTwoAcrossWidth = Math.max(
    minWidth,
    (options.cellWidthPx - options.horizontalGapPx) / 2,
  );
  const naturalWidth = textWidth(visibleTitle(event), options) + options.horizontalPaddingPx;
  return roundPx(Math.min(options.cellWidthPx, Math.max(minWidth, Math.min(naturalWidth, maxTwoAcrossWidth))));
}

function estimateMoreWidth(hiddenCount: number, options: NormalizedMonthDayLayoutOptions): number {
  if (options.cellWidthPx <= 0) return 0;
  const minWidth = Math.min(options.cellWidthPx, options.minMoreWidthPx);
  const naturalWidth = textWidth(`+${hiddenCount} more`, options) + options.horizontalPaddingPx;
  return roundPx(Math.min(options.cellWidthPx, Math.max(minWidth, naturalWidth)));
}

function topForRow(row: number, options: NormalizedMonthDayLayoutOptions): number {
  return row * (options.chipHeightPx + options.rowGapPx);
}

function rowRight(items: readonly MonthDayEventLayoutItem[], row: number): number {
  let right = 0;
  for (const item of items) {
    if (item.row === row) right = Math.max(right, item.leftPx + item.widthPx);
  }
  return right;
}

function findLastItemIndexInRow(items: readonly MonthDayEventLayoutItem[], row: number): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].row === row) return i;
  }
  return -1;
}

function expandedLastEvents(
  items: readonly MonthDayLayoutItem[],
  rowCount: number,
  options: NormalizedMonthDayLayoutOptions,
): MonthDayLayoutItem[] {
  const next = items.map((item) => ({ ...item })) as MonthDayLayoutItem[];

  for (let row = 0; row < rowCount; row += 1) {
    let lastEventIndex = -1;
    let moreLeft: number | undefined;

    for (let i = 0; i < next.length; i += 1) {
      const item = next[i];
      if (item.row !== row) continue;
      if (item.kind === "event") {
        lastEventIndex = i;
      } else {
        moreLeft = item.leftPx;
      }
    }

    if (lastEventIndex < 0) continue;
    const item = next[lastEventIndex];
    if (item.kind !== "event") continue;
    const rowRightBoundary = moreLeft !== undefined
      ? Math.max(item.leftPx, moreLeft - options.horizontalGapPx)
      : options.cellWidthPx;
    item.widthPx = roundPx(Math.max(item.widthPx, rowRightBoundary - item.leftPx));
  }

  return next;
}

function appendMoreChip(
  eventItems: MonthDayEventLayoutItem[],
  hiddenCount: number,
  rowCount: number,
  options: NormalizedMonthDayLayoutOptions,
): MonthDayLayout {
  const targetRow = Math.max(0, rowCount - 1);
  let hidden = hiddenCount;
  const items = [...eventItems];

  while (true) {
    const widthPx = estimateMoreWidth(hidden, options);
    const occupiedRight = rowRight(items, targetRow);
    const leftPx = occupiedRight > 0 ? occupiedRight + options.horizontalGapPx : 0;

    if (leftPx + widthPx <= options.cellWidthPx || items.length === 0) {
      const hasRowEvent = items.some((item) => item.row === targetRow);
      const moreItem: MonthDayMoreLayoutItem = {
        kind: "more",
        hiddenCount: hidden,
        row: targetRow,
        leftPx: roundPx(hasRowEvent ? options.cellWidthPx - widthPx : Math.min(leftPx, options.cellWidthPx)),
        topPx: topForRow(targetRow, options),
        widthPx,
        heightPx: options.chipHeightPx,
      };
      return {
        items: expandedLastEvents([...items, moreItem], rowCount, options),
        hiddenCount: hidden,
        rowCount,
      };
    }

    const removeIndex = findLastItemIndexInRow(items, targetRow);
    if (removeIndex < 0) {
      const moreItem: MonthDayMoreLayoutItem = {
        kind: "more",
        hiddenCount: hidden,
        row: targetRow,
        leftPx: 0,
        topPx: topForRow(targetRow, options),
        widthPx,
        heightPx: options.chipHeightPx,
      };
      return {
        items: expandedLastEvents([...items, moreItem], rowCount, options),
        hiddenCount: hidden,
        rowCount,
      };
    }

    items.splice(removeIndex, 1);
    hidden += 1;
  }
}

export function layoutMonthDayEvents(
  events: readonly CalendarEvent[],
  options: MonthDayLayoutOptions,
): MonthDayLayout {
  const normalized = normalizeOptions(options);
  const rowCount = rowCountForHeight(
    options.availableHeightPx,
    normalized.chipHeightPx,
    normalized.rowGapPx,
  );

  if (events.length === 0) {
    return { items: [], hiddenCount: 0, rowCount };
  }
  if (rowCount === 0 || normalized.cellWidthPx <= 0) {
    return { items: [], hiddenCount: events.length, rowCount };
  }

  const items: MonthDayEventLayoutItem[] = [];
  let row = 0;
  let cursorX = 0;
  let packedCount = 0;

  for (const event of events) {
    const widthPx = estimateEventWidth(event, normalized);
    if (cursorX > 0 && cursorX + normalized.horizontalGapPx + widthPx > normalized.cellWidthPx) {
      row += 1;
      cursorX = 0;
    }
    if (row >= rowCount) break;

    const leftPx = cursorX > 0 ? cursorX + normalized.horizontalGapPx : 0;
    items.push({
      kind: "event",
      event,
      row,
      leftPx: roundPx(leftPx),
      topPx: topForRow(row, normalized),
      widthPx,
      heightPx: normalized.chipHeightPx,
    });
    cursorX = leftPx + widthPx;
    packedCount += 1;
  }

  const hiddenCount = events.length - packedCount;
  if (hiddenCount <= 0) {
    return { items: expandedLastEvents(items, rowCount, normalized), hiddenCount: 0, rowCount };
  }

  return appendMoreChip(items, hiddenCount, rowCount, normalized);
}
