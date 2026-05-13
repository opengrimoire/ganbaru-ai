import {
  CALENDAR_FORWARDED_WHEEL_EVENT,
  type CalendarForwardedWheelDetail,
} from "$lib/components/calendar/timeline-scroll";

export const CALENDAR_SCROLL_CONTAINER_SELECTOR = "[data-calendar-scroll-container]";
export const CALENDAR_SCROLL_SAMPLE_MIN_MS = 5_000;
export const CALENDAR_SCROLL_SAMPLE_MAX_MS = 10_000;

export type CalendarWheelDeltaMode = "pixel" | "line" | "page" | "unknown";

export interface CalendarWheelDeltaModeCounts {
  pixel: number;
  line: number;
  page: number;
  unknown: number;
}

export interface CalendarScrollRawSample {
  capturedAtIso: string;
  durationMs: number;
  startScrollTopPx: number;
  endScrollTopPx: number;
  minScrollTopPx: number;
  maxScrollTopPx: number;
  viewportHeightPx: number;
  scrollHeightPx: number;
  devicePixelRatio: number;
  userAgent: string;
  frameIntervalsMs: number[];
  wheelDeltaY: number[];
  wheelDeltaModes: CalendarWheelDeltaModeCounts;
  wheelEventCount: number;
  wheelAtEdgeCount: number;
  wheelIntoEdgeCount: number;
  scrollDeltasPx: number[];
  scrollEventCount: number;
}

export interface CalendarScrollTimingSummary {
  count: number;
  averageMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  over16Ms: number;
  over25Ms: number;
  over33Ms: number;
  over50Ms: number;
}

export interface CalendarScrollSummary {
  capturedAtIso: string;
  durationMs: number;
  devicePixelRatio: number;
  userAgent: string;
  frames: CalendarScrollTimingSummary;
  estimatedFps: number | null;
  wheelEventCount: number;
  wheelSignedDeltaY: number;
  wheelTotalAbsDeltaY: number;
  wheelMaxAbsDeltaY: number;
  wheelDirectionChanges: number;
  wheelAtEdgeCount: number;
  wheelIntoEdgeCount: number;
  wheelDeltaModes: CalendarWheelDeltaModeCounts;
  scrollEventCount: number;
  scrollDistancePx: number;
  netScrollPx: number;
  scrollDirectionChanges: number;
  scrollDistanceToRangeRatio: number | null;
  maxScrollStepPx: number;
  touchedScrollRangePx: number;
  startScrollTopPx: number;
  endScrollTopPx: number;
  scrollLimitPx: number;
  endPosition: "top" | "bottom" | "inside";
}

export interface CalendarScrollCapture {
  stop: () => CalendarScrollRawSample;
}

function createWheelDeltaModeCounts(): CalendarWheelDeltaModeCounts {
  return { pixel: 0, line: 0, page: 0, unknown: 0 };
}

function wheelDeltaMode(deltaMode: number): CalendarWheelDeltaMode {
  if (deltaMode === 0) return "pixel";
  if (deltaMode === 1) return "line";
  if (deltaMode === 2) return "page";
  return "unknown";
}

function sumAbs(values: number[]): number {
  return values.reduce((sum, value) => sum + Math.abs(value), 0);
}

function sumSigned(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function maxAbs(values: number[]): number {
  return values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
}

function signOf(value: number): -1 | 0 | 1 {
  if (value < 0) return -1;
  if (value > 0) return 1;
  return 0;
}

function directionChangeCount(values: number[]): number {
  let previousSign: -1 | 0 | 1 = 0;
  let changes = 0;
  for (const value of values) {
    const nextSign = signOf(value);
    if (nextSign === 0) continue;
    if (previousSign !== 0 && nextSign !== previousSign) changes++;
    previousSign = nextSign;
  }
  return changes;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentile(sortedValues: number[], percentileValue: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.ceil(percentileValue * sortedValues.length) - 1;
  return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, index))];
}

function summarizeFrameIntervals(frameIntervalsMs: number[]): CalendarScrollTimingSummary {
  const sorted = [...frameIntervalsMs].sort((a, b) => a - b);
  const total = frameIntervalsMs.reduce((sum, value) => sum + value, 0);
  const averageMs = frameIntervalsMs.length > 0 ? total / frameIntervalsMs.length : null;
  const maxMs = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  return {
    count: frameIntervalsMs.length,
    averageMs: averageMs === null ? null : rounded(averageMs),
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs,
    over16Ms: frameIntervalsMs.filter((value) => value > 16.7).length,
    over25Ms: frameIntervalsMs.filter((value) => value > 25).length,
    over33Ms: frameIntervalsMs.filter((value) => value > 33.4).length,
    over50Ms: frameIntervalsMs.filter((value) => value > 50).length,
  };
}

export function summarizeCalendarScrollSample(sample: CalendarScrollRawSample): CalendarScrollSummary {
  const frames = summarizeFrameIntervals(sample.frameIntervalsMs);
  const scrollLimitPx = Math.max(0, sample.scrollHeightPx - sample.viewportHeightPx);
  const endDistanceFromBottom = Math.abs(scrollLimitPx - sample.endScrollTopPx);
  const endPosition = sample.endScrollTopPx <= 1 ? "top" : endDistanceFromBottom <= 1 ? "bottom" : "inside";
  const scrollDistancePx = rounded(sumAbs(sample.scrollDeltasPx));
  const touchedScrollRangePx = rounded(sample.maxScrollTopPx - sample.minScrollTopPx);
  return {
    capturedAtIso: sample.capturedAtIso,
    durationMs: rounded(sample.durationMs),
    devicePixelRatio: sample.devicePixelRatio,
    userAgent: sample.userAgent,
    frames,
    estimatedFps: frames.averageMs === null || frames.averageMs <= 0 ? null : rounded(1000 / frames.averageMs),
    wheelEventCount: sample.wheelEventCount,
    wheelSignedDeltaY: rounded(sumSigned(sample.wheelDeltaY)),
    wheelTotalAbsDeltaY: rounded(sumAbs(sample.wheelDeltaY)),
    wheelMaxAbsDeltaY: rounded(maxAbs(sample.wheelDeltaY)),
    wheelDirectionChanges: directionChangeCount(sample.wheelDeltaY),
    wheelAtEdgeCount: sample.wheelAtEdgeCount,
    wheelIntoEdgeCount: sample.wheelIntoEdgeCount,
    wheelDeltaModes: { ...sample.wheelDeltaModes },
    scrollEventCount: sample.scrollEventCount,
    scrollDistancePx,
    netScrollPx: rounded(sample.endScrollTopPx - sample.startScrollTopPx),
    scrollDirectionChanges: directionChangeCount(sample.scrollDeltasPx),
    scrollDistanceToRangeRatio: touchedScrollRangePx <= 0 ? null : rounded(scrollDistancePx / touchedScrollRangePx),
    maxScrollStepPx: rounded(maxAbs(sample.scrollDeltasPx)),
    touchedScrollRangePx,
    startScrollTopPx: rounded(sample.startScrollTopPx),
    endScrollTopPx: rounded(sample.endScrollTopPx),
    scrollLimitPx: rounded(scrollLimitPx),
    endPosition,
  };
}

function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatOptionalMs(value: number | null): string {
  return value === null ? "n/a" : `${formatNumber(value)} ms`;
}

function formatOptionalNumber(value: number | null): string {
  return value === null ? "n/a" : formatNumber(value);
}

function formatDeltaModes(counts: CalendarWheelDeltaModeCounts): string {
  return `pixel ${counts.pixel}, line ${counts.line}, page ${counts.page}, unknown ${counts.unknown}`;
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function formatCalendarScrollDiagnosticMarkdown(summary: CalendarScrollSummary): string {
  const rows = [
    ["Duration", `${formatNumber(summary.durationMs)} ms`],
    ["Estimated FPS", formatOptionalNumber(summary.estimatedFps)],
    ["Frame samples", summary.frames.count.toLocaleString("en")],
    ["Frame average", formatOptionalMs(summary.frames.averageMs)],
    ["Frame median", formatOptionalMs(summary.frames.medianMs)],
    ["Frame P95", formatOptionalMs(summary.frames.p95Ms)],
    ["Frame max", formatOptionalMs(summary.frames.maxMs)],
    ["Frames over 16.7 ms", summary.frames.over16Ms.toLocaleString("en")],
    ["Frames over 25 ms", summary.frames.over25Ms.toLocaleString("en")],
    ["Frames over 33.4 ms", summary.frames.over33Ms.toLocaleString("en")],
    ["Frames over 50 ms", summary.frames.over50Ms.toLocaleString("en")],
    ["Wheel events", summary.wheelEventCount.toLocaleString("en")],
    ["Wheel signed deltaY", formatNumber(summary.wheelSignedDeltaY)],
    ["Wheel total abs deltaY", formatNumber(summary.wheelTotalAbsDeltaY)],
    ["Wheel max abs deltaY", formatNumber(summary.wheelMaxAbsDeltaY)],
    ["Wheel direction changes", summary.wheelDirectionChanges.toLocaleString("en")],
    ["Wheel events at edge", summary.wheelAtEdgeCount.toLocaleString("en")],
    ["Wheel events into edge", summary.wheelIntoEdgeCount.toLocaleString("en")],
    ["Wheel delta modes", formatDeltaModes(summary.wheelDeltaModes)],
    ["Scroll events", summary.scrollEventCount.toLocaleString("en")],
    ["Scroll distance", `${formatNumber(summary.scrollDistancePx)} px`],
    ["Net scroll", `${formatNumber(summary.netScrollPx)} px`],
    ["Scroll direction changes", summary.scrollDirectionChanges.toLocaleString("en")],
    ["Scroll distance / touched range", formatOptionalNumber(summary.scrollDistanceToRangeRatio)],
    ["Max scroll step", `${formatNumber(summary.maxScrollStepPx)} px`],
    ["Touched scroll range", `${formatNumber(summary.touchedScrollRangePx)} px`],
    ["Start scrollTop", `${formatNumber(summary.startScrollTopPx)} px`],
    ["End scrollTop", `${formatNumber(summary.endScrollTopPx)} px`],
    ["Scroll limit", `${formatNumber(summary.scrollLimitPx)} px`],
    ["End position", summary.endPosition],
    ["Device pixel ratio", formatNumber(summary.devicePixelRatio, 2)],
    ["User agent", summary.userAgent],
  ];

  return [
    "# Calendar vertical scroll diagnostic",
    "",
    `Captured: ${summary.capturedAtIso}`,
    "",
    "| Metric | Value |",
    "|---|---:|",
    ...rows.map(([metric, value]) => `| ${escapeMarkdownCell(metric)} | ${escapeMarkdownCell(value)} |`),
  ].join("\n");
}

export function startCalendarScrollCapture(
  target: HTMLElement,
  onComplete: () => void,
): CalendarScrollCapture {
  const capturedAtIso = new Date().toISOString();
  const startedAt = performance.now();
  const frameIntervalsMs: number[] = [];
  const wheelDeltaY: number[] = [];
  const wheelDeltaModes = createWheelDeltaModeCounts();
  const scrollDeltasPx: number[] = [];
  let wheelEventCount = 0;
  let scrollEventCount = 0;
  let wheelAtEdgeCount = 0;
  let wheelIntoEdgeCount = 0;
  let lastFrameAt: number | null = null;
  let lastScrollTopPx = target.scrollTop;
  let minScrollTopPx = target.scrollTop;
  let maxScrollTopPx = target.scrollTop;
  let animationFrameId = 0;
  let timeoutId: ReturnType<typeof window.setTimeout> | null = null;
  let finalSample: CalendarScrollRawSample | null = null;

  const startScrollTopPx = target.scrollTop;
  const wheelOptions: AddEventListenerOptions = { capture: true, passive: true };
  const scrollOptions: AddEventListenerOptions = { passive: true };

  function trackWheelDelta(deltaY: number, deltaMode: number, scrollTop: number, maxScrollTop: number) {
    const atTop = scrollTop <= 1;
    const atBottom = scrollTop >= maxScrollTop - 1;
    wheelEventCount++;
    wheelDeltaY.push(deltaY);
    wheelDeltaModes[wheelDeltaMode(deltaMode)]++;
    if (atTop || atBottom) wheelAtEdgeCount++;
    if ((deltaY < 0 && atTop) || (deltaY > 0 && atBottom)) {
      wheelIntoEdgeCount++;
    }
  }

  function trackFrame(now: number) {
    if (lastFrameAt !== null) {
      frameIntervalsMs.push(now - lastFrameAt);
    }
    lastFrameAt = now;
    animationFrameId = window.requestAnimationFrame(trackFrame);
  }

  function trackWheel(event: WheelEvent) {
    const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    trackWheelDelta(event.deltaY, event.deltaMode, target.scrollTop, maxScrollTop);
  }

  function trackForwardedWheel(event: Event) {
    const detail = (event as CustomEvent<CalendarForwardedWheelDetail>).detail;
    const maxScrollTop = Math.max(0, detail.scrollHeight - detail.clientHeight);
    trackWheelDelta(detail.deltaY, detail.deltaMode, detail.scrollTop, maxScrollTop);
  }

  function trackScroll() {
    const nextScrollTopPx = target.scrollTop;
    scrollEventCount++;
    scrollDeltasPx.push(nextScrollTopPx - lastScrollTopPx);
    lastScrollTopPx = nextScrollTopPx;
    minScrollTopPx = Math.min(minScrollTopPx, nextScrollTopPx);
    maxScrollTopPx = Math.max(maxScrollTopPx, nextScrollTopPx);
  }

  target.addEventListener("wheel", trackWheel, wheelOptions);
  target.addEventListener(CALENDAR_FORWARDED_WHEEL_EVENT, trackForwardedWheel);
  target.addEventListener("scroll", trackScroll, scrollOptions);
  animationFrameId = window.requestAnimationFrame(trackFrame);
  timeoutId = window.setTimeout(onComplete, CALENDAR_SCROLL_SAMPLE_MAX_MS);

  function stop(): CalendarScrollRawSample {
    if (finalSample !== null) return finalSample;
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    window.cancelAnimationFrame(animationFrameId);
    target.removeEventListener("wheel", trackWheel, wheelOptions);
    target.removeEventListener(CALENDAR_FORWARDED_WHEEL_EVENT, trackForwardedWheel);
    target.removeEventListener("scroll", trackScroll, scrollOptions);
    const endScrollTopPx = target.scrollTop;
    minScrollTopPx = Math.min(minScrollTopPx, endScrollTopPx);
    maxScrollTopPx = Math.max(maxScrollTopPx, endScrollTopPx);
    finalSample = {
      capturedAtIso,
      durationMs: performance.now() - startedAt,
      startScrollTopPx,
      endScrollTopPx,
      minScrollTopPx,
      maxScrollTopPx,
      viewportHeightPx: target.clientHeight,
      scrollHeightPx: target.scrollHeight,
      devicePixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent,
      frameIntervalsMs: [...frameIntervalsMs],
      wheelDeltaY: [...wheelDeltaY],
      wheelDeltaModes: { ...wheelDeltaModes },
      wheelEventCount,
      wheelAtEdgeCount,
      wheelIntoEdgeCount,
      scrollDeltasPx: [...scrollDeltasPx],
      scrollEventCount,
    };
    return finalSample;
  }

  return { stop };
}
