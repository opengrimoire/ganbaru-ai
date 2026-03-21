import type {
  PomodoroConfig,
  PlannedSegment,
  AccentBarBand,
  SegmentPhase,
  SegmentStatus,
} from "$lib/components/calendar/types";

/**
 * Compute the planned sequence of focus and break segments for a pomodoro
 * session within a given event duration.
 *
 * Parameters
 * ----------
 * config : PomodoroConfig
 *     Pomodoro timing settings.
 * eventDurationMinutes : number
 *     Total duration of the calendar event in minutes.
 *
 * Returns
 * -------
 * PlannedSegment[]
 *     Ordered list of segments with minute offsets from the event start.
 */
export function computePlannedSegments(
  config: PomodoroConfig,
  eventDurationMinutes: number,
): PlannedSegment[] {
  if (eventDurationMinutes <= 0) return [];

  const segments: PlannedSegment[] = [];
  let offset = 0;
  let cycle = 1;

  while (offset < eventDurationMinutes) {
    // Focus segment
    const focusEnd = Math.min(offset + config.focusDurationMinutes, eventDurationMinutes);
    segments.push({
      cycleNumber: cycle,
      phase: "focus",
      startOffsetMinutes: offset,
      endOffsetMinutes: focusEnd,
    });
    offset = focusEnd;

    if (offset >= eventDurationMinutes) break;

    // Break segment
    const isLongBreak = cycle >= config.pomodoroCount;
    const breakPhase: SegmentPhase = isLongBreak ? "long_break" : "short_break";
    const breakDuration = isLongBreak ? config.longBreakMinutes : config.shortBreakMinutes;
    const breakEnd = Math.min(offset + breakDuration, eventDurationMinutes);

    segments.push({
      cycleNumber: cycle,
      phase: breakPhase,
      startOffsetMinutes: offset,
      endOffsetMinutes: breakEnd,
    });
    offset = breakEnd;

    cycle = isLongBreak ? 1 : cycle + 1;
  }

  return segments;
}

/**
 * Convert planned segments into accent bar bands for rendering.
 * Only break segments produce bands (focus is the default accent fill).
 *
 * Parameters
 * ----------
 * segments : PlannedSegment[]
 *     Output from computePlannedSegments.
 * eventDurationMinutes : number
 *     Total duration of the calendar event in minutes.
 * status : SegmentStatus
 *     Status to assign to all bands (default "planned").
 *
 * Returns
 * -------
 * AccentBarBand[]
 *     Bands representing break positions within the accent bar.
 */
export function segmentsToAccentBands(
  segments: PlannedSegment[],
  eventDurationMinutes: number,
  status: SegmentStatus = "planned",
): AccentBarBand[] {
  if (eventDurationMinutes <= 0) return [];

  return segments
    .filter((s) => s.phase !== "focus")
    .map((s) => ({
      topFraction: s.startOffsetMinutes / eventDurationMinutes,
      heightFraction: (s.endOffsetMinutes - s.startOffsetMinutes) / eventDurationMinutes,
      phase: s.phase,
      status,
    }));
}
