import { getCalendar } from "$lib/stores/calendar.svelte";
import { getCalendars } from "$lib/stores/calendars.svelte";
import type { CalendarEvent } from "$lib/components/calendar/types";
import type { CalendarViewMode } from "$lib/components/calendar/types";
import { computeViewWindow } from "$lib/components/calendar/utils";
import { countDenseCalendarEvents, generateDenseCalendarEvents } from "../dense";
import {
  benchmarkDatasetId,
  type BenchmarkDatasetProfile,
  type BenchmarkEventDraft,
  type BenchmarkMetric,
  type BenchmarkSeedHandle,
} from "../types";

/** Anchor used by calendar benchmarks so both passes hit the same window. */
export const CALENDAR_BENCHMARK_ANCHOR_ISO = "2026-04-30";

const DENSE_SEED_CHUNK_SIZE = 1_000;

/** Calendar grouping name template. Renaming requires bumping `DENSE_DATASET_VERSION`. */
export function denseCalendarFilename(dataset: BenchmarkDatasetProfile): string {
  return `benchmark-dense-${dataset.version}-s${dataset.stackCount}-${dataset.detailProfile}.ics`;
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
 * Convert a deterministic benchmark draft into a full event ready for
 * `bulkImport`. The source UID lets re-seeds land as updates instead of
 * warning and skipping.
 */
export function draftToEvent(
  draft: BenchmarkEventDraft,
  _index: number,
  calendarId: string,
): CalendarEvent {
  const id = crypto.randomUUID();
  const event: CalendarEvent = {
    id,
    title: draft.title,
    start: draft.start,
    end: draft.end,
    timezone: localTimezone(),
    calendarId,
    sourceUid: draft.sourceUid,
    sequence: 1,
  };
  if (draft.allDay) event.allDay = true;
  if (draft.description) event.description = draft.description;
  if (draft.recurrence) event.recurrence = draft.recurrence;
  if (draft.notifications) event.notifications = draft.notifications;
  if (draft.color !== undefined) event.color = draft.color;
  if (draft.location) event.location = draft.location;
  if (draft.url) event.url = draft.url;
  if (draft.transparency) event.transparency = draft.transparency;
  if (draft.status) event.status = draft.status;
  if (draft.visibility) event.visibility = draft.visibility;
  if (draft.priority !== undefined) event.priority = draft.priority;
  if (draft.categories) event.categories = draft.categories;
  if (draft.geo) event.geo = draft.geo;
  if (draft.extendedProperties) event.extendedProperties = draft.extendedProperties;
  if (draft.organizer) event.organizer = draft.organizer;
  if (draft.alarms) event.alarms = draft.alarms;
  if (draft.attendees) event.attendees = draft.attendees;
  if (draft.guestPermissions) event.guestPermissions = draft.guestPermissions;
  return event;
}

export async function seedCalendarDataset(
  dataset: BenchmarkDatasetProfile,
): Promise<BenchmarkSeedHandle> {
  const calendarStore = getCalendar();
  const calendarsStore = getCalendars();
  const cal = await calendarsStore.findOrCreateImported(denseCalendarFilename(dataset));
  const anchor = parseCalendarBenchmarkAnchor();
  const totalEvents = countDenseCalendarEvents(dataset, anchor);

  for (let offset = 0; offset < totalEvents; offset += DENSE_SEED_CHUNK_SIZE) {
    const drafts = generateDenseCalendarEvents({
      dataset,
      anchor,
      offset,
      count: DENSE_SEED_CHUNK_SIZE,
    });
    const events = drafts.map((d, i) => draftToEvent(d, offset + i, cal.id));
    await calendarStore.bulkImport(events, cal.id, { refreshWindow: false });
  }

  return {
    calendarId: cal.id,
    eventCount: totalEvents,
    datasetId: benchmarkDatasetId(dataset),
    dataset,
  };
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
