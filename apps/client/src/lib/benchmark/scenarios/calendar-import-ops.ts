import { getCalendars } from "$lib/stores/calendars.svelte";
import {
  buildBulkImportPayload,
  type CalendarBulkImportResult,
} from "$lib/stores/calendar-bulk-import";
import { generateSynthEvents, DEFAULT_SEED } from "../synth";
import { type BenchmarkMetric, type BenchmarkScenario } from "../types";
import {
  draftToEvent,
  parseCalendarBenchmarkAnchor,
  seedCalendarSynth,
} from "./calendar-utils";
import { namespaceImportChildIds } from "./calendar-import-ops-data";
import {
  ensureBenchmarkDbReady,
  invokeDb,
  measureMs,
  nowLocal,
  repeatedMeasuredTimingMetric,
  scalarCountMetric,
  scalarMsMetric,
} from "./operation-utils";

const SMALL_IMPORT_RUNS = 3;
const SMALL_IMPORT_EVENTS = 100;
const LARGE_IMPORT_EVENTS = 1000;

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

async function createImportCalendar(label: string): Promise<string> {
  const id = `bench-import-${label}-${crypto.randomUUID()}`;
  const now = nowLocal();
  await invokeDb<void>("calendar_add_calendar", {
    calendar: {
      id,
      name: `Benchmark import ${label}`,
      color: "",
      source: "ics",
      visible: true,
      readOnly: false,
      sourceUrl: `benchmark-import-${label}.ics`,
      createdAt: now,
      updatedAt: now,
    },
  });
  return id;
}

async function removeImportCalendar(calendarId: string): Promise<void> {
  await invokeDb<void>("calendar_remove_calendar", { id: calendarId });
}

function buildPayload(calendarId: string, count: number, label: string) {
  const drafts = generateSynthEvents({
    count,
    anchor: parseCalendarBenchmarkAnchor(),
    seed: DEFAULT_SEED + count + label.length,
  });
  const events = drafts.map((draft, index) =>
    draftToEvent(draft, index, calendarId, `ops-${label}`),
  );
  return buildBulkImportPayload(
    namespaceImportChildIds(events, calendarId),
    calendarId,
    nowLocal(),
    localTimezone(),
    () => crypto.randomUUID(),
  );
}

async function applyImport(calendarId: string, count: number, label: string) {
  return invokeDb<CalendarBulkImportResult>("calendar_bulk_import", {
    payload: buildPayload(calendarId, count, label),
  });
}

async function importAddSample(count: number, label: string): Promise<number> {
  const calendarId = await createImportCalendar(label);
  try {
    return await measureMs(async () => {
      await applyImport(calendarId, count, label);
    });
  } finally {
    await removeImportCalendar(calendarId).catch(() => {});
  }
}

async function importUpdateSample(count: number, label: string): Promise<number> {
  const calendarId = await createImportCalendar(label);
  try {
    await applyImport(calendarId, count, label);
    return await measureMs(async () => {
      await applyImport(calendarId, count, label);
    });
  } finally {
    await removeImportCalendar(calendarId).catch(() => {});
  }
}

async function largeImportMetrics(signal: AbortSignal): Promise<BenchmarkMetric[]> {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const addMs = await importAddSample(LARGE_IMPORT_EVENTS, "large-add");
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const updateMs = await importUpdateSample(LARGE_IMPORT_EVENTS, "large-update");
  return [
    scalarMsMetric("bulk import 1000 add", addMs),
    scalarMsMetric("bulk import 1000 update", updateMs),
    scalarCountMetric("bulk import large event count", LARGE_IMPORT_EVENTS),
  ];
}

export const calendarImportOpsScenario: BenchmarkScenario = {
  id: "calendar-import-ops",
  label: "Calendar import operations",
  description:
    "Measures the Rust calendar_bulk_import command for repeated 100-event imports and one 1000-event add/update pass.",
  workload: {
    kind: "operation-latency",
    question: "How quickly does Rust apply typed calendar import payloads?",
    label: "scripted calendar bulk import commands",
    durationMs: 0,
    memoryMode: "none",
  },
  defaultSeedSize: 1000,

  async setup(): Promise<void> {
    await ensureBenchmarkDbReady();
    await getCalendars().load();
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    const smallAddMetric = await repeatedMeasuredTimingMetric(
      "bulk import 100 add avg",
      SMALL_IMPORT_RUNS,
      signal,
      async (index) => {
        return importAddSample(SMALL_IMPORT_EVENTS, `small-add-${index}`);
      },
      { events: SMALL_IMPORT_EVENTS },
    );
    const smallUpdateMetric = await repeatedMeasuredTimingMetric(
      "bulk import 100 update avg",
      SMALL_IMPORT_RUNS,
      signal,
      async (index) => {
        return importUpdateSample(SMALL_IMPORT_EVENTS, `small-update-${index}`);
      },
      { events: SMALL_IMPORT_EVENTS },
    );
    const largeMetrics = await largeImportMetrics(signal);
    return [
      smallAddMetric,
      smallUpdateMetric,
      ...largeMetrics,
    ];
  },

  async seed(version: string, seedSize: number): Promise<{ calendarId: string; eventCount: number }> {
    return seedCalendarSynth(version, seedSize);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The isolated benchmark DB is deleted after the run.
  },
};
