import { invoke } from "@tauri-apps/api/core";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "$lib/components/calendar/types";
import { wallClockToUtcIso } from "$lib/components/calendar/utils";
import { ensureDbUrl } from "$lib/api/db";
import { localTimezone } from "./calendar-event-payloads";
import {
  mapWindowRows,
  type CalendarPomodoroSchedulerRows,
} from "./calendar-event-hydration";

let pomodoroSchedulerWindowCache: {
  key: string;
  version: number;
  promise: Promise<CalendarEvent[]>;
} | null = null;

function calendarWindowKey(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
  renderZone: string,
): string {
  return `${renderZone}:${windowStart.toString()}:${windowEnd.toString()}`;
}

export function clearPomodoroSchedulerWindowCache(): void {
  pomodoroSchedulerWindowCache = null;
}

export async function loadPomodoroSchedulerEventsFromDb(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
  version: number,
): Promise<CalendarEvent[]> {
  const renderZone = localTimezone();
  const key = calendarWindowKey(windowStart, windowEnd, renderZone);
  if (
    pomodoroSchedulerWindowCache &&
    pomodoroSchedulerWindowCache.key === key &&
    pomodoroSchedulerWindowCache.version === version
  ) {
    return pomodoroSchedulerWindowCache.promise;
  }

  const promise = (async () => {
    const url = await ensureDbUrl();
    const windowStartDate = windowStart.toString();
    const windowEndDate = windowEnd.toString();
    const windowEndExclusiveDate = windowEnd.add({ days: 1 }).toString();
    const rows = await invoke<CalendarPomodoroSchedulerRows>(
      "calendar_load_pomodoro_scheduler_window",
      {
        dbUrl: url,
        windowStartDate,
        windowEndDate,
        windowStartUtc: wallClockToUtcIso(`${windowStartDate} 00:00`, renderZone),
        windowEndExclusiveUtc: wallClockToUtcIso(`${windowEndExclusiveDate} 00:00`, renderZone),
      },
    );
    const mapped = mapWindowRows(
      {
        events: rows.events,
        overrides: rows.overrides,
        attendees: [],
        total_event_count: rows.events.length,
      },
      renderZone,
    );
    const expanded = await invoke<CalendarEvent[]>("calendar_expand_render_events", {
      events: mapped,
      windowStartDate,
      windowEndDate,
    });
    return expanded.filter((event) => event.pomodoroConfig);
  })().catch((error: unknown) => {
    if (pomodoroSchedulerWindowCache?.promise === promise) {
      pomodoroSchedulerWindowCache = null;
    }
    throw error;
  });

  pomodoroSchedulerWindowCache = { key, version, promise };
  return promise;
}
