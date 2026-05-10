import { getCalendar } from "$lib/stores/calendar.svelte";
import { getCalendars } from "$lib/stores/calendars.svelte";
import type { CalendarEvent } from "$lib/components/calendar/types";
import type { CalendarViewMode } from "$lib/components/calendar/types";
import { computeViewWindow } from "$lib/components/calendar/utils";
import { generateSynthEvents, DEFAULT_SEED } from "../synth";
import type { BenchmarkMetric, SynthEventDraft } from "../types";

/** Anchor used by calendar benchmarks so both passes hit the same window. */
export const CALENDAR_BENCHMARK_ANCHOR_ISO = "2026-04-30";

/** Calendar grouping name template. Renaming requires bumping `SYNTH_VERSION`. */
export function synthCalendarFilename(version: string): string {
  return `benchmark-synth-${version}.ics`;
}

export function parseCalendarBenchmarkAnchor(): Date {
  const [y, m, d] = CALENDAR_BENCHMARK_ANCHOR_ISO.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export async function loadCalendarBenchmarkWindow(mode: CalendarViewMode = "week"): Promise<void> {
  const window = computeViewWindow(parseCalendarBenchmarkAnchor(), mode);
  await getCalendar().loadWindow(window.start, window.end);
}

export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Convert a deterministic synth draft into a full event ready for
 * `bulkImport`. The source UID lets re-seeds land as updates instead of
 * warning and skipping.
 */
export function draftToEvent(
  draft: SynthEventDraft,
  index: number,
  calendarId: string,
  version: string,
): CalendarEvent {
  const id = crypto.randomUUID();
  const event: CalendarEvent = {
    id,
    title: draft.title,
    start: draft.start,
    end: draft.end,
    timezone: localTimezone(),
    calendarId,
    sourceUid: `synth-${version}-${index}`,
    sequence: 1,
  };
  if (draft.allDay) event.allDay = true;
  if (draft.description) event.description = draft.description;
  if (draft.recurrence) event.recurrence = draft.recurrence;
  if (draft.alarms) event.alarms = draft.alarms;
  if (draft.attendees) event.attendees = draft.attendees;
  return event;
}

export async function seedCalendarSynth(
  version: string,
  seedSize: number,
): Promise<{ calendarId: string; eventCount: number }> {
  const calendarStore = getCalendar();
  const calendarsStore = getCalendars();
  const cal = await calendarsStore.findOrCreateImported(synthCalendarFilename(version));

  const drafts = generateSynthEvents({
    count: seedSize,
    anchor: parseCalendarBenchmarkAnchor(),
    seed: DEFAULT_SEED,
  });
  const events = drafts.map((d, i) => draftToEvent(d, i, cal.id, version));

  await calendarStore.bulkImport(events, cal.id);
  return { calendarId: cal.id, eventCount: events.length };
}

export async function waitForFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}

export function waitForMs(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
}

interface TimingStats {
  meanMs: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

function timingStats(values: number[]): TimingStats | undefined {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length === 0) return undefined;
  const meanMs = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  return {
    meanMs,
    minMs: valid[0],
    medianMs: percentile(valid, 0.5),
    p95Ms: percentile(valid, 0.95),
    maxMs: valid[valid.length - 1],
  };
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 1) return sortedValues[0];
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * p) - 1);
  return sortedValues[index];
}

export function timingStatsMetric(
  label: string,
  values: number[],
  details: Record<string, string | number> = {},
): BenchmarkMetric {
  const stats = timingStats(values);
  if (!stats) {
    return {
      label,
      unit: "ms",
      value: Number.NaN,
      details: { missing: "valid timing sample", ...details },
    };
  }
  return {
    label,
    unit: "ms",
    value: stats.meanMs,
    details: {
      runs: values.filter(Number.isFinite).length,
      minMs: stats.minMs,
      medianMs: stats.medianMs,
      p95Ms: stats.p95Ms,
      maxMs: stats.maxMs,
      ...details,
    },
  };
}
