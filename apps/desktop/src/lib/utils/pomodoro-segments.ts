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
 * initialFocusOffsetMinutes : number
 *     Focus time already accumulated from a preceding event (inheritance).
 *     If >= focusDuration, the event starts with a break instead of focus.
 * initialCycleNumber : number
 *     Cycle number to start at (from a preceding event's trailing cycle).
 *     Default 1. If >= pomodoroCount, the first break will be a long break.
 *
 * Returns
 * -------
 * PlannedSegment[]
 *     Ordered list of segments with minute offsets from the event start.
 */
export function computePlannedSegments(
  config: PomodoroConfig,
  eventDurationMinutes: number,
  initialFocusOffsetMinutes: number = 0,
  initialCycleNumber: number = 1,
): PlannedSegment[] {
  if (eventDurationMinutes <= 0) return [];

  const segments: PlannedSegment[] = [];
  let offset = 0;
  let cycle = Math.max(1, initialCycleNumber);

  // Handle inherited focus: first focus is shortened (or skipped entirely for a break)
  const inherited = Math.max(0, initialFocusOffsetMinutes);

  if (inherited > 0) {
    const remainingFocus = config.focusDurationMinutes - inherited;

    if (remainingFocus > 0) {
      // Shortened first focus
      const focusEnd = Math.min(remainingFocus, eventDurationMinutes);
      segments.push({
        cycleNumber: cycle,
        phase: "focus",
        startOffsetMinutes: 0,
        endOffsetMinutes: focusEnd,
      });
      offset = focusEnd;

      if (offset < eventDurationMinutes) {
        // Break after the shortened focus
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
    } else {
      // Inherited focus exceeded threshold: start with a break
      const isLongBreak = cycle >= config.pomodoroCount;
      const breakPhase: SegmentPhase = isLongBreak ? "long_break" : "short_break";
      const breakDuration = isLongBreak ? config.longBreakMinutes : config.shortBreakMinutes;
      const breakEnd = Math.min(breakDuration, eventDurationMinutes);
      segments.push({
        cycleNumber: cycle,
        phase: breakPhase,
        startOffsetMinutes: 0,
        endOffsetMinutes: breakEnd,
      });
      offset = breakEnd;
      cycle = isLongBreak ? 1 : cycle + 1;
    }
  }

  // Standard alternating focus/break from here on
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
 * Compute the accumulated focus time at the end of a planned segment sequence.
 * Returns the minutes of focus in the last segment if it's a focus segment
 * (i.e., focus that would carry over to the next event). Returns 0 if the
 * last segment is a break (focus resets after a break).
 */
export function computeTrailingFocusMinutes(segments: PlannedSegment[]): number {
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1];
  if (last.phase === "focus") {
    return last.endOffsetMinutes - last.startOffsetMinutes;
  }
  // Last segment is a break, so focus resets
  return 0;
}

/**
 * Compute the cycle number that a successor event should start at.
 * - Empty segments or last segment is a long break: returns 1 (reset).
 * - Last segment is focus (cycle N): returns N (same cycle, break not yet taken).
 * - Last segment is short break (cycle N): returns N + 1 (cycle completed).
 */
export function computeTrailingCycleNumber(segments: PlannedSegment[]): number {
  if (segments.length === 0) return 1;
  const last = segments[segments.length - 1];
  if (last.phase === "long_break") return 1;
  if (last.phase === "short_break") return last.cycleNumber + 1;
  return last.cycleNumber;
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
