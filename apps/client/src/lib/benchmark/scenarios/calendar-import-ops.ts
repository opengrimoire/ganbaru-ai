import { getCalendars } from "$lib/stores/calendars.svelte";
import {
  buildBulkImportPayload,
  type CalendarBulkImportResult,
} from "$lib/stores/calendar-bulk-import";
import { generateDenseCalendarEvents } from "../dense";
import {
  DEFAULT_BENCHMARK_DATASET,
  type BenchmarkDatasetProfile,
  type BenchmarkMetric,
  type BenchmarkScenario,
  type BenchmarkScenarioContext,
  type BenchmarkSeedHandle,
} from "../types";
import {
  draftToEvent,
  parseCalendarBenchmarkAnchor,
  seedCalendarDataset,
} from "./calendar-utils";
import { namespaceImportChildIds } from "./calendar-import-ops-data";
import {
  ensureBenchmarkDbReady,
  invokeDb,
  measureMs,
  nowLocal,
  repeatedMeasuredTimingMetric,
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

function buildPayload(
  calendarId: string,
  count: number,
  label: string,
  context: BenchmarkScenarioContext,
) {
  const drafts = generateDenseCalendarEvents({
    dataset: DEFAULT_BENCHMARK_DATASET,
    count,
    anchor: parseCalendarBenchmarkAnchor(context.anchorDate),
    offset: label.length,
  });
  const events = drafts.map((draft, index) =>
    draftToEvent(draft, index, calendarId),
  );
  return buildBulkImportPayload(
    namespaceImportChildIds(events, calendarId),
    calendarId,
    nowLocal(),
    localTimezone(),
    () => crypto.randomUUID(),
  );
}

async function applyImport(
  calendarId: string,
  count: number,
  label: string,
  context: BenchmarkScenarioContext,
) {
  return invokeDb<CalendarBulkImportResult>("calendar_bulk_import", {
    payload: buildPayload(calendarId, count, label, context),
  });
}

async function importAddSample(
  count: number,
  label: string,
  context: BenchmarkScenarioContext,
): Promise<number> {
  const calendarId = await createImportCalendar(label);
  try {
    return await measureMs(async () => {
      await applyImport(calendarId, count, label, context);
    });
  } finally {
    await removeImportCalendar(calendarId).catch(() => {});
  }
}

async function importUpdateSample(
  count: number,
  label: string,
  context: BenchmarkScenarioContext,
): Promise<number> {
  const calendarId = await createImportCalendar(label);
  try {
    await applyImport(calendarId, count, label, context);
    return await measureMs(async () => {
      await applyImport(calendarId, count, label, context);
    });
  } finally {
    await removeImportCalendar(calendarId).catch(() => {});
  }
}

async function largeImportMetrics(
  signal: AbortSignal,
  context: BenchmarkScenarioContext,
): Promise<BenchmarkMetric[]> {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const addMs = await importAddSample(LARGE_IMPORT_EVENTS, "large-add", context);
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const updateMs = await importUpdateSample(LARGE_IMPORT_EVENTS, "large-update", context);
  return [
    scalarMsMetric("bulk import 1000 add", addMs),
    scalarMsMetric("bulk import 1000 update", updateMs),
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
  defaultDataset: DEFAULT_BENCHMARK_DATASET,

  async setup(): Promise<void> {
    await ensureBenchmarkDbReady();
    await getCalendars().load();
  },

  async runWorkload(
    signal: AbortSignal,
    context: BenchmarkScenarioContext,
  ): Promise<BenchmarkMetric[]> {
    const smallAddMetric = await repeatedMeasuredTimingMetric(
      "bulk import 100 add avg",
      SMALL_IMPORT_RUNS,
      signal,
      async (index) => {
        return importAddSample(SMALL_IMPORT_EVENTS, `small-add-${index}`, context);
      },
      { events: SMALL_IMPORT_EVENTS },
    );
    const smallUpdateMetric = await repeatedMeasuredTimingMetric(
      "bulk import 100 update avg",
      SMALL_IMPORT_RUNS,
      signal,
      async (index) => {
        return importUpdateSample(SMALL_IMPORT_EVENTS, `small-update-${index}`, context);
      },
      { events: SMALL_IMPORT_EVENTS },
    );
    const largeMetrics = await largeImportMetrics(signal, context);
    return [
      smallAddMetric,
      smallUpdateMetric,
      ...largeMetrics,
    ];
  },

  async seed(
    dataset: BenchmarkDatasetProfile,
    context: BenchmarkScenarioContext,
  ): Promise<BenchmarkSeedHandle> {
    return seedCalendarDataset(dataset, context);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The isolated benchmark DB is deleted after the run.
  },
};
