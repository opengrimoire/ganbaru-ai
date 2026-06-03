import type {
  PauseInterval,
  PersistedSegment,
} from "$lib/components/calendar/types";

function timestampMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

function segmentStartMs(segment: PersistedSegment): number | null {
  return timestampMs(segment.actualStart ?? segment.plannedStart);
}

/**
 * Clamp a pause so it cannot start before the segment it belongs to, and so
 * its end cannot precede its start. OS idle APIs can report an idle start
 * before a newly auto-started focus segment; persisting that raw timestamp
 * makes later stop paths create inverted focus intervals.
 */
export function normalizePauseForSegment(
  segment: PersistedSegment,
  pause: PauseInterval,
): PauseInterval {
  const startFloorMs = segmentStartMs(segment);
  const requestedStartMs = timestampMs(pause.startedAt);
  const startMs = requestedStartMs === null
    ? startFloorMs
    : startFloorMs === null
      ? requestedStartMs
      : Math.max(requestedStartMs, startFloorMs);

  const startedAt = startMs === null ? pause.startedAt : isoFromMs(startMs);

  if (pause.endedAt === null) {
    return { ...pause, startedAt };
  }

  const requestedEndMs = timestampMs(pause.endedAt);
  const endFloorMs = startMs ?? requestedStartMs ?? startFloorMs;
  const endedAt = requestedEndMs === null
    ? pause.endedAt
    : endFloorMs === null
      ? isoFromMs(requestedEndMs)
      : isoFromMs(Math.max(requestedEndMs, endFloorMs));

  return { ...pause, startedAt, endedAt };
}

export function normalizePausesForSegment(
  segment: PersistedSegment,
  pauses: readonly PauseInterval[],
): PauseInterval[] {
  return pauses.map((pause) => normalizePauseForSegment(segment, pause));
}

/**
 * Clamp a persisted segment end so focus history never stores an impossible
 * negative interval. The renderer may hide zero-length focus, but the data
 * layer should never contain `actualEnd` before `actualStart`.
 */
export function normalizeSegmentEndIso(
  segment: PersistedSegment,
  requestedEndIso: string,
): string {
  const requestedMs = timestampMs(requestedEndIso);
  const startMs = segmentStartMs(segment);
  if (requestedMs === null) return startMs === null ? requestedEndIso : isoFromMs(startMs);
  if (startMs === null) return isoFromMs(requestedMs);
  return isoFromMs(Math.max(requestedMs, startMs));
}
