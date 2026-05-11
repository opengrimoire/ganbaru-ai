import type { CalendarEvent, PomodoroConfig } from "$lib/components/calendar/types";
import { wallClockToUtcIso } from "$lib/components/calendar/utils";
import { computePlannedSegments } from "$lib/utils/pomodoro-segments";

export const DENSE_TIMED_POMODORO_CONFIG: PomodoroConfig = {
  focusDurationMinutes: 40,
  shortBreakMinutes: 5,
  longBreakMinutes: 10,
  pomodoroCount: 4,
  idleTimeoutMinutes: null,
};

export interface BenchmarkPomodoroConfigSeed {
  eventId: string;
  focusDurationMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  pomodoroCount: number;
  idleTimeoutMinutes: number | null;
}

export interface BenchmarkPomodoroSegmentSeed {
  id: string;
  eventId: string;
  eventDate: string;
  runId: string;
  cycleNumber: number;
  phase: "focus" | "short_break" | "long_break";
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  pauseLog: string;
  status: "completed";
}

export interface BenchmarkPomodoroSessionSeed {
  id: string;
  eventId: string;
  startTime: string;
  endTime: string;
  completed: boolean;
  appSwitchCount: number;
  breakExtended: boolean;
  focusScore: number;
  createdAt: string;
}

export interface BenchmarkPomodoroHistoryPayload {
  configs: BenchmarkPomodoroConfigSeed[];
  segments: BenchmarkPomodoroSegmentSeed[];
  sessions: BenchmarkPomodoroSessionSeed[];
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function parseWallClock(value: string): WallParts {
  const [date, time] = value.split(" ");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return { year, month, day, hour, minute };
}

function wallClockMinuteIndex(value: string): number {
  const parts = parseWallClock(value);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) / 60_000;
}

function wallClockAddMinutes(value: string, minutes: number): string {
  const parts = parseWallClock(value);
  const date = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute + minutes,
  ));
  return [
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`,
  ].join(" ");
}

function wallClockDurationMinutes(start: string, end: string): number {
  return wallClockMinuteIndex(end) - wallClockMinuteIndex(start);
}

function isPastTimedPomodoroEvent(event: CalendarEvent, pastCutoffWallClock: string): boolean {
  return !event.allDay
    && event.pomodoroConfig !== undefined
    && event.end <= pastCutoffWallClock;
}

function toIso(event: CalendarEvent, wallClock: string): string {
  return wallClockToUtcIso(wallClock, event.timezone);
}

export function buildDensePomodoroHistoryPayload(
  events: CalendarEvent[],
  pastCutoffWallClock: string,
): BenchmarkPomodoroHistoryPayload {
  const payload: BenchmarkPomodoroHistoryPayload = {
    configs: [],
    segments: [],
    sessions: [],
  };

  for (const event of events) {
    const config = event.pomodoroConfig;
    if (!config || event.allDay) continue;

    payload.configs.push({
      eventId: event.id,
      focusDurationMinutes: config.focusDurationMinutes,
      shortBreakMinutes: config.shortBreakMinutes,
      longBreakMinutes: config.longBreakMinutes,
      pomodoroCount: config.pomodoroCount,
      idleTimeoutMinutes: config.idleTimeoutMinutes,
    });

    if (!isPastTimedPomodoroEvent(event, pastCutoffWallClock)) continue;

    const durationMinutes = wallClockDurationMinutes(event.start, event.end);
    const planned = computePlannedSegments(config, durationMinutes);
    const runId = `${event.id}-run`;
    const eventDate = event.start.split(" ")[0];

    planned.forEach((segment, index) => {
      const plannedStartWall = wallClockAddMinutes(event.start, segment.startOffsetMinutes);
      const plannedEndWall = wallClockAddMinutes(event.start, segment.endOffsetMinutes);
      const plannedStart = toIso(event, plannedStartWall);
      const plannedEnd = toIso(event, plannedEndWall);
      const id = `${event.id}-segment-${index + 1}`;

      payload.segments.push({
        id,
        eventId: event.id,
        eventDate,
        runId,
        cycleNumber: segment.cycleNumber,
        phase: segment.phase,
        plannedStart,
        plannedEnd,
        actualStart: plannedStart,
        actualEnd: plannedEnd,
        pauseLog: "[]",
        status: "completed",
      });

      if (segment.phase === "focus") {
        payload.sessions.push({
          id: `${event.id}-session-${index + 1}`,
          eventId: event.id,
          startTime: plannedStart,
          endTime: plannedEnd,
          completed: true,
          appSwitchCount: 0,
          breakExtended: false,
          focusScore: 1,
          createdAt: plannedEnd,
        });
      }
    });
  }

  return payload;
}
