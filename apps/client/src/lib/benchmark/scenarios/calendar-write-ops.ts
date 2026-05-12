import {
  DEFAULT_BENCHMARK_DATASET,
  type BenchmarkDatasetProfile,
  type BenchmarkMetric,
  type BenchmarkScenario,
  type BenchmarkScenarioContext,
  type BenchmarkSeedHandle,
} from "../types";
import { seedCalendarDataset } from "./calendar-utils";
import {
  DEFAULT_OPERATION_RUNS,
  ensureBenchmarkDbReady,
  invokeDb,
  isoMinutesFromAnchor,
  measureMs,
  nowLocal,
  repeatedMeasuredTimingMetric,
} from "./operation-utils";

const RECURRENCE_RUNS = 5;

interface CalendarPomodoroConfig {
  focusDurationMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  pomodoroCount: number;
  idleTimeoutMinutes: number | null;
}

interface CalendarEventCreateCommand {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  timezone: string;
  calendarId: string;
  color: number | null;
  description: string;
  rrule: string | null;
  notifications: string | null;
  repeatUntil: string | null;
  allDay: boolean;
  location: string;
  url: string;
  transparency: string;
  status: string;
  sourceUid: string | null;
  visibility: string;
  priority: number | null;
  categories: string | null;
  geo: string | null;
  sequence: number;
  rdate: string | null;
  extendedProperties: string | null;
  organizer: string | null;
  guestCanModify: boolean;
  guestCanInviteOthers: boolean;
  guestCanSeeOtherGuests: boolean;
  createdAt: string;
  updatedAt: string;
  pomodoroConfig: CalendarPomodoroConfig | null;
  attendees: Array<{
    id: string;
    name: string | null;
    email: string;
    role: string;
    status: string;
    rsvp: boolean;
  }>;
}

type CalendarUpdateField =
  | { field: "title"; value: string }
  | { field: "startTime"; value: string }
  | { field: "endTime"; value: string }
  | { field: "location"; value: string };

function makeEvent(
  id: string,
  title: string,
  startOffsetMinutes: number,
  options: {
    calendarId?: string;
    rrule?: string | null;
    pomodoroConfig?: CalendarPomodoroConfig | null;
    attendees?: CalendarEventCreateCommand["attendees"];
  } = {},
): CalendarEventCreateCommand {
  const now = nowLocal();
  return {
    id,
    title,
    startTime: isoMinutesFromAnchor(startOffsetMinutes),
    endTime: isoMinutesFromAnchor(startOffsetMinutes + 45),
    timezone: "UTC",
    calendarId: options.calendarId ?? "local",
    color: null,
    description: "Benchmark operation event",
    rrule: options.rrule ?? null,
    notifications: null,
    repeatUntil: null,
    allDay: false,
    location: "",
    url: "",
    transparency: "opaque",
    status: "confirmed",
    sourceUid: null,
    visibility: "public",
    priority: null,
    categories: null,
    geo: null,
    sequence: 0,
    rdate: null,
    extendedProperties: null,
    organizer: null,
    guestCanModify: false,
    guestCanInviteOthers: true,
    guestCanSeeOtherGuests: true,
    createdAt: now,
    updatedAt: now,
    pomodoroConfig: options.pomodoroConfig ?? null,
    attendees: options.attendees ?? [],
  };
}

async function addEvent(event: CalendarEventCreateCommand): Promise<void> {
  await invokeDb<void>("calendar_add_event", { event });
}

async function deleteEvent(id: string): Promise<void> {
  await invokeDb<void>("calendar_delete_event", { id });
}

async function patchEvent(id: string, fields: CalendarUpdateField[]): Promise<void> {
  await invokeDb<void>("calendar_update_event", {
    patch: {
      id,
      updatedAt: nowLocal(),
      fields,
      attendees: null,
      alarms: null,
      pomodoroConfig: null,
    },
  });
}

async function createSample(index: number): Promise<number> {
  const id = `bench-calendar-create-${index}-${crypto.randomUUID()}`;
  try {
    return await measureMs(() =>
      addEvent(makeEvent(id, `Benchmark create ${index}`, index * 60)),
    );
  } finally {
    await deleteEvent(id).catch(() => {});
  }
}

async function updateSample(index: number): Promise<number> {
  const id = `bench-calendar-update-${index}-${crypto.randomUUID()}`;
  await addEvent(makeEvent(id, `Benchmark update ${index}`, 600 + index * 60));
  try {
    return await measureMs(() =>
      patchEvent(id, [
        { field: "title", value: `Benchmark updated ${index}` },
        { field: "location", value: "Benchmark room" },
        { field: "startTime", value: isoMinutesFromAnchor(620 + index * 60) },
        { field: "endTime", value: isoMinutesFromAnchor(665 + index * 60) },
      ]),
    );
  } finally {
    await deleteEvent(id).catch(() => {});
  }
}

async function deleteSample(index: number): Promise<number> {
  const id = `bench-calendar-delete-${index}-${crypto.randomUUID()}`;
  await addEvent(makeEvent(id, `Benchmark delete ${index}`, 1200 + index * 60));
  return measureMs(() => deleteEvent(id));
}

async function detachSample(index: number): Promise<number> {
  const parentId = `bench-calendar-detach-parent-${index}-${crypto.randomUUID()}`;
  const detachedId = `bench-calendar-detach-child-${index}-${crypto.randomUUID()}`;
  await addEvent(makeEvent(
    parentId,
    `Benchmark detach ${index}`,
    1800 + index * 60,
    { rrule: "FREQ=DAILY;COUNT=10" },
  ));
  try {
    return await measureMs(() =>
      invokeDb<void>("calendar_detach_instance", {
        input: {
          parentId,
          instanceDate: "2026-05-02",
          exceptions: JSON.stringify(["2026-05-02"]),
          newId: detachedId,
          title: `Benchmark detached ${index}`,
          startTime: isoMinutesFromAnchor(1800 + index * 60 + 24 * 60),
          endTime: isoMinutesFromAnchor(1845 + index * 60 + 24 * 60),
          timezone: "UTC",
          calendarId: "local",
          color: null,
          notifications: null,
          allDay: false,
          location: "",
          transparency: "opaque",
          status: "confirmed",
          now: nowLocal(),
        },
      }),
    );
  } finally {
    await deleteEvent(detachedId).catch(() => {});
    await deleteEvent(parentId).catch(() => {});
  }
}

async function splitSample(index: number): Promise<number> {
  const parentId = `bench-calendar-split-parent-${index}-${crypto.randomUUID()}`;
  const splitId = `bench-calendar-split-child-${index}-${crypto.randomUUID()}`;
  await addEvent(makeEvent(
    parentId,
    `Benchmark split ${index}`,
    2400 + index * 60,
    { rrule: "FREQ=DAILY;COUNT=10" },
  ));
  try {
    return await measureMs(() =>
      invokeDb<void>("calendar_split_series", {
        input: {
          parentId,
          dayBefore: "2026-05-01",
          cappedRrule: "FREQ=DAILY;UNTIL=20260501T235959Z",
          newId: splitId,
          title: `Benchmark split new ${index}`,
          startTime: isoMinutesFromAnchor(2400 + index * 60 + 2 * 24 * 60),
          endTime: isoMinutesFromAnchor(2445 + index * 60 + 2 * 24 * 60),
          timezone: "UTC",
          calendarId: "local",
          color: null,
          notifications: null,
          rrule: "FREQ=DAILY;COUNT=8",
          allDay: false,
          location: "",
          transparency: "opaque",
          status: "confirmed",
          descriptionPatch: null,
          urlPatch: null,
          pomodoroConfig: null,
          now: nowLocal(),
        },
      }),
    );
  } finally {
    await deleteEvent(splitId).catch(() => {});
    await deleteEvent(parentId).catch(() => {});
  }
}

export const calendarWriteOpsScenario: BenchmarkScenario = {
  id: "calendar-write-ops",
  label: "Calendar write operations",
  description:
    "Measures Rust-backed calendar event create, patch, delete, detach, and split commands through Tauri IPC against the isolated benchmark DB.",
  workload: {
    kind: "operation-latency",
    question: "How quickly do Rust-backed calendar write commands finish?",
    label: "scripted calendar write commands",
    durationMs: 0,
    memoryMode: "none",
  },
  defaultDataset: DEFAULT_BENCHMARK_DATASET,
  runMode: "dense-only",

  async setup(): Promise<void> {
    await ensureBenchmarkDbReady();
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    return [
      await repeatedMeasuredTimingMetric(
        "event create save avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        createSample,
      ),
      await repeatedMeasuredTimingMetric(
        "event patch save avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        updateSample,
      ),
      await repeatedMeasuredTimingMetric(
        "event delete avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        deleteSample,
      ),
      await repeatedMeasuredTimingMetric(
        "recurring detach avg",
        RECURRENCE_RUNS,
        signal,
        detachSample,
      ),
      await repeatedMeasuredTimingMetric(
        "recurring split avg",
        RECURRENCE_RUNS,
        signal,
        splitSample,
      ),
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
