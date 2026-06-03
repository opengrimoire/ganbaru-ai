import type { CalendarEvent, PersistedSegment } from "./types";

export interface DbPomodoroSegmentRow {
  id: string;
  event_id: string;
  event_date: string;
  run_id: string;
  cycle_number: number;
  phase: string;
  planned_start: string;
  planned_end: string;
  actual_start: string | null;
  actual_end: string | null;
  pauses: PersistedSegment["pauseLog"];
  status: string;
}

export function visiblePomodoroEventIds(events: readonly CalendarEvent[]): string[] {
  return Array.from(
    new Set(
      events
        .filter((event) => event.pomodoroConfig)
        .map((event) => event.id),
    ),
  ).sort();
}

export function queryPomodoroSegmentEventIds(visibleIds: readonly string[]): string[] {
  return Array.from(
    new Set(
      visibleIds.flatMap((id) => id.includes("::") ? [id, id.split("::")[0]] : [id]),
    ),
  ).sort();
}

export function pomodoroSegmentSnapshotKey(
  segmentVersion: number,
  visibleIds: readonly string[],
): string {
  return `${segmentVersion}|${[...visibleIds].sort().join(",")}`;
}

export function mapPomodoroSegmentRows(
  rows: readonly DbPomodoroSegmentRow[],
  visibleIds: readonly string[],
): Map<string, PersistedSegment[]> {
  const visible = new Set(visibleIds);
  const map = new Map<string, PersistedSegment[]>();

  for (const row of rows) {
    const virtualId = `${row.event_id}::${row.event_date}`;
    const mapKey = visible.has(row.event_id)
      ? row.event_id
      : visible.has(virtualId)
        ? virtualId
        : row.event_id;
    const segment: PersistedSegment = {
      id: row.id,
      eventId: mapKey,
      eventDate: row.event_date,
      runId: row.run_id,
      cycleNumber: row.cycle_number,
      phase: row.phase as PersistedSegment["phase"],
      plannedStart: row.planned_start,
      plannedEnd: row.planned_end,
      actualStart: row.actual_start,
      actualEnd: row.actual_end,
      pauseLog: row.pauses,
      status: row.status as PersistedSegment["status"],
    };
    const segments = map.get(mapKey);
    if (segments) segments.push(segment);
    else map.set(mapKey, [segment]);
  }

  return map;
}
