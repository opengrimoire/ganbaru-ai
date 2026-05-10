import { type BenchmarkMetric, type BenchmarkScenario } from "../types";
import { seedCalendarSynth } from "./calendar-utils";
import {
  DEFAULT_OPERATION_RUNS,
  ensureBenchmarkDbReady,
  invokeDb,
  isoMinutesFromAnchor,
  measureMs,
  nowLocal,
  repeatedMeasuredTimingMetric,
} from "./operation-utils";

type SegmentPhase = "focus" | "short_break" | "long_break";
type SegmentStatus = "planned" | "active" | "completed" | "skipped" | "interrupted";

interface PomodoroSegmentWrite {
  id: string;
  eventId: string;
  eventDate: string;
  runId: string;
  cycleNumber: number;
  phase: SegmentPhase;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  pauseLog: string;
  status: SegmentStatus;
}

interface PomodoroSegmentUpdate {
  id: string;
  status: SegmentStatus;
  actualStart: string | null;
  actualEnd: string | null;
  pauseLog: string;
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
  pomodoroConfig: {
    focusDurationMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    pomodoroCount: number;
    idleTimeoutMinutes: number | null;
  };
  attendees: [];
}

function makeEvent(id: string, index: number): CalendarEventCreateCommand {
  const now = nowLocal();
  return {
    id,
    title: `Benchmark pomodoro ${index}`,
    startTime: isoMinutesFromAnchor(3600 + index * 120),
    endTime: isoMinutesFromAnchor(3660 + index * 120),
    timezone: "UTC",
    calendarId: "local",
    color: null,
    description: "Benchmark pomodoro persistence event",
    rrule: null,
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
    pomodoroConfig: {
      focusDurationMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      pomodoroCount: 4,
      idleTimeoutMinutes: null,
    },
    attendees: [],
  };
}

async function addEvent(id: string, index: number): Promise<void> {
  await invokeDb<void>("calendar_add_event", { event: makeEvent(id, index) });
}

async function deleteEvent(id: string): Promise<void> {
  await invokeDb<void>("calendar_delete_event", { id });
}

function makeSegments(
  eventId: string,
  runId: string,
  index: number,
  count: number,
  status: SegmentStatus = "planned",
): PomodoroSegmentWrite[] {
  return Array.from({ length: count }, (_, segmentIndex) => {
    const phase: SegmentPhase =
      segmentIndex % 4 === 3 ? "long_break" : segmentIndex % 2 === 0 ? "focus" : "short_break";
    const plannedStart = isoMinutesFromAnchor(4800 + index * 240 + segmentIndex * 30);
    return {
      id: `${runId}-segment-${segmentIndex}`,
      eventId,
      eventDate: "2026-04-30",
      runId,
      cycleNumber: Math.floor(segmentIndex / 2) + 1,
      phase,
      plannedStart,
      plannedEnd: isoMinutesFromAnchor(4810 + index * 240 + segmentIndex * 30),
      actualStart: status === "planned" ? null : plannedStart,
      actualEnd: status === "completed" ? isoMinutesFromAnchor(4810 + index * 240 + segmentIndex * 30) : null,
      pauseLog: "[]",
      status,
    };
  });
}

function segmentUpdates(segments: PomodoroSegmentWrite[]): PomodoroSegmentUpdate[] {
  return segments.map((segment) => ({
    id: segment.id,
    status: "completed",
    actualStart: segment.plannedStart,
    actualEnd: segment.plannedEnd,
    pauseLog: JSON.stringify([[segment.plannedStart, segment.plannedStart]]),
  }));
}

async function insertSegments(segments: PomodoroSegmentWrite[]): Promise<void> {
  await invokeDb<void>("pomodoro_insert_segments", { segments });
}

async function insertSample(index: number): Promise<number> {
  const eventId = `bench-pomodoro-insert-${index}-${crypto.randomUUID()}`;
  const runId = `run-insert-${index}-${crypto.randomUUID()}`;
  await addEvent(eventId, index);
  try {
    return await measureMs(() =>
      insertSegments(makeSegments(eventId, runId, index, 8)),
    );
  } finally {
    await deleteEvent(eventId).catch(() => {});
  }
}

async function updateSample(index: number): Promise<number> {
  const eventId = `bench-pomodoro-update-${index}-${crypto.randomUUID()}`;
  const runId = `run-update-${index}-${crypto.randomUUID()}`;
  const segments = makeSegments(eventId, runId, index, 8);
  await addEvent(eventId, index);
  await insertSegments(segments);
  try {
    return await measureMs(() =>
      invokeDb<void>("pomodoro_update_segments", {
        segments: segmentUpdates(segments),
      }),
    );
  } finally {
    await deleteEvent(eventId).catch(() => {});
  }
}

async function cleanupEventSample(index: number): Promise<number> {
  const eventId = `bench-pomodoro-cleanup-event-${index}-${crypto.randomUUID()}`;
  const runId = `run-cleanup-event-${index}-${crypto.randomUUID()}`;
  await addEvent(eventId, index);
  await insertSegments([
    ...makeSegments(eventId, `${runId}-active`, index, 2, "active"),
    ...makeSegments(eventId, `${runId}-planned`, index + 1, 3, "planned"),
  ]);
  try {
    return await measureMs(() =>
      invokeDb<void>("pomodoro_cleanup_event_segments", {
        eventId,
        eventDate: "2026-04-30",
      }),
    );
  } finally {
    await deleteEvent(eventId).catch(() => {});
  }
}

async function cleanupOrphansSample(index: number): Promise<number> {
  const eventId = `bench-pomodoro-cleanup-orphans-${index}-${crypto.randomUUID()}`;
  const runId = `run-cleanup-orphans-${index}-${crypto.randomUUID()}`;
  await addEvent(eventId, index);
  await insertSegments([
    ...makeSegments(eventId, `${runId}-active`, index, 2, "active"),
    ...makeSegments(eventId, `${runId}-planned`, index + 1, 3, "planned"),
  ]);
  try {
    return await measureMs(() =>
      invokeDb<void>("pomodoro_cleanup_orphans"),
    );
  } finally {
    await deleteEvent(eventId).catch(() => {});
  }
}

async function saveSessionSample(index: number): Promise<number> {
  const eventId = `bench-pomodoro-session-${index}-${crypto.randomUUID()}`;
  const startMs = Date.UTC(2026, 3, 30, 14, 0, 0) + index * 3_600_000;
  const endMs = startMs + 25 * 60_000;
  await addEvent(eventId, index);
  try {
    return await measureMs(() =>
      invokeDb<void>("pomodoro_save_session", {
        session: {
          id: `bench-session-${index}-${crypto.randomUUID()}`,
          eventId,
          startTime: new Date(startMs).toISOString(),
          endTime: new Date(endMs).toISOString(),
          startMs,
          endMs,
          pauses: [
            {
              startMs: startMs + 5 * 60_000,
              endMs: startMs + 6 * 60_000,
            },
          ],
        },
      }),
    );
  } finally {
    await deleteEvent(eventId).catch(() => {});
  }
}

export const pomodoroPersistenceOpsScenario: BenchmarkScenario = {
  id: "pomodoro-persistence-ops",
  label: "Pomodoro persistence operations",
  description:
    "Measures Rust-backed Pomodoro segment insert, update, cleanup, orphan cleanup, and completed-session persistence commands.",
  workload: {
    kind: "operation-latency",
    question: "How quickly do Rust-backed Pomodoro persistence commands finish?",
    label: "scripted Pomodoro persistence commands",
    durationMs: 0,
    memoryMode: "none",
  },
  defaultSeedSize: 1000,

  async setup(): Promise<void> {
    await ensureBenchmarkDbReady();
  },

  async runWorkload(signal: AbortSignal): Promise<BenchmarkMetric[]> {
    return [
      await repeatedMeasuredTimingMetric(
        "pomodoro insert segments avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        insertSample,
        { segments: 8 },
      ),
      await repeatedMeasuredTimingMetric(
        "pomodoro update segments avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        updateSample,
        { segments: 8 },
      ),
      await repeatedMeasuredTimingMetric(
        "pomodoro cleanup event segments avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        cleanupEventSample,
      ),
      await repeatedMeasuredTimingMetric(
        "pomodoro cleanup orphans avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        cleanupOrphansSample,
      ),
      await repeatedMeasuredTimingMetric(
        "pomodoro save session avg",
        DEFAULT_OPERATION_RUNS,
        signal,
        saveSessionSample,
      ),
    ];
  },

  async seed(version: string, seedSize: number): Promise<{ calendarId: string; eventCount: number }> {
    return seedCalendarSynth(version, seedSize);
  },

  async cleanup(_seedHandle: { calendarId: string }): Promise<void> {
    // The isolated benchmark DB is deleted after the run.
  },
};

