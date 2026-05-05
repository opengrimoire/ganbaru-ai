import { getCalendar } from "$lib/stores/calendar.svelte";
import { getCalendars } from "$lib/stores/calendars.svelte";
import { type BenchmarkMetric, type BenchmarkScenario } from "../types";
import { seedCalendarSynth, timingStatsMetric } from "./calendar-utils";
import googleSample from "../../../../test-fixtures/ics/google-calendar-sample.ics?raw";
import outlookSample from "../../../../test-fixtures/ics/outlook-sample.ics?raw";
import edgeCases from "../../../../test-fixtures/ics/edge-cases.ics?raw";

const FIXTURES = [
  { name: "google-calendar-sample.ics", text: googleSample },
  { name: "outlook-sample.ics", text: outlookSample },
  { name: "edge-cases.ics", text: edgeCases },
] as const;
const PARSE_RUNS = 5;

export const icsImportScenario: BenchmarkScenario = {
  id: "ics-import",
  label: "ICS import fixtures",
  description:
    "Parses and imports the committed Google, Outlook, and edge-case ICS fixtures into the isolated benchmark DB. Reports parser time, DB write time, imported event count, and warning count.",
  workload: {
    kind: "operation-latency",
    question: "How quickly can committed ICS fixtures be parsed and imported?",
    label: "ICS fixture parse and database import",
    durationMs: 0,
    memoryMode: "none",
  },
  defaultSeedSize: 1000,

  async setup(): Promise<void> {
    // No UI precondition. The benchmark database isolation is handled by the runner.
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    const [{ parseIcs }, calendarStore, calendarsStore] = await Promise.all([
      import("$lib/calendar/ics/parser"),
      Promise.resolve(getCalendar()),
      Promise.resolve(getCalendars()),
    ]);

    const parseMs: number[] = [];
    let warningCount = 0;
    let eventCount = 0;
    let parsed: Array<{
      fixture: typeof FIXTURES[number];
      calendarId: string;
      events: ReturnType<typeof parseIcs>["events"];
    }> = [];

    for (let i = 0; i < PARSE_RUNS; i++) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      warningCount = 0;
      eventCount = 0;
      const parseStart = performance.now();
      parsed = FIXTURES.map((fixture) => {
        const calendarId = `bench-ics-${fixture.name}`;
        const result = parseIcs(fixture.text, calendarId);
        warningCount += result.warnings.length;
        eventCount += result.events.length;
        return { fixture, calendarId, events: result.events };
      });
      parseMs.push(performance.now() - parseStart);
    }

    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const writeStart = performance.now();
    for (const item of parsed) {
      const cal = await calendarsStore.findOrCreateImported(item.fixture.name);
      const events = item.events.map((event) => ({ ...event, calendarId: cal.id }));
      await calendarStore.bulkImport(events, cal.id);
    }
    const writeMs = performance.now() - writeStart;

    return [
      timingStatsMetric("parse fixtures avg", parseMs),
      { label: "write fixtures", unit: "ms", value: writeMs },
      { label: "imported events", unit: "count", value: eventCount },
      { label: "import warnings", unit: "count", value: warningCount },
    ];
  },

  async seed(version: string, seedSize: number): Promise<{ calendarId: string; eventCount: number }> {
    return seedCalendarSynth(version, seedSize);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The isolated benchmark DB is deleted after the run.
  },
};
