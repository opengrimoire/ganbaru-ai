import type {
  PomodoroConfig,
  PlannedSegment,
  AccentBarBand,
  PauseInterval,
  PersistedSegment,
  TimelineBand,
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
export interface TimelineEvent {
  id: string;
  config: PomodoroConfig;
  startMs: number; // full event start timestamp
  endMs: number; // full event end timestamp
  startMinute: number; // day-clipped minute-of-day
  endMinute: number; // day-clipped minute-of-day
}

export interface ActivePomodoroState {
  activeBlockId: string | null;
  segments: PersistedSegment[];
  remainingSeconds: number;
  breakOvertimeSeconds: number;
}

/**
 * Compute a unified timeline of break and focus-fill bands for an entire day column.
 *
 * 1. Filter out contained events (covered by a longer event's schedule).
 * 2. Walk remaining events by start time, computing inheritance between them.
 * 3. For the active event, project bands from persisted segments.
 * 4. For events with persisted segments, output focus fill bands.
 * 5. For planned events, compute from config with inheritance.
 * 6. Skip past events without persisted segments.
 */
export function computeDayTimelineBands(
  events: TimelineEvent[],
  activeState: ActivePomodoroState | null,
  dayStartMs: number,
  nowMs: number,
  persistedSegments?: Map<string, PersistedSegment[]>,
): TimelineBand[] {
  if (events.length === 0) return [];

  // Step 1: filter contained events
  const nonContained = filterContained(events);

  // Step 2: sort by start minute, then by start time for tiebreak
  const sorted = [...nonContained].sort((a, b) =>
    a.startMinute !== b.startMinute ? a.startMinute - b.startMinute : a.startMs - b.startMs,
  );

  const bands: TimelineBand[] = [];
  let cursor = -Infinity; // tracks where the previous event's coverage ends (minute-of-day)
  let inheritedFocus = 0;
  let inheritedCycle = 1;

  for (const ev of sorted) {
    const isActive = activeState?.activeBlockId === ev.id;

    // Gap between events: reset inheritance
    if (ev.startMinute > cursor) {
      inheritedFocus = 0;
      inheritedCycle = 1;
    } else if (cursor > ev.startMinute) {
      // Overlap: compute predecessor's state at this event's start point
      // The cursor already reflects the previous event's end, and inheritance
      // was computed for the full previous event. We need to re-derive state
      // at the overlap point. Find the previous event that set the cursor.
      // Since we process in order, the previous event's segments were computed
      // with its own inheritance. We need state at ev.startMinute.
      // This is handled by the cursor walk: we compute segments only from
      // effectiveStart, so inheritance from the predecessor at cursor is correct.
    }

    const effectiveStart = Math.max(cursor, ev.startMinute);
    const duration = ev.endMinute - effectiveStart;
    if (duration <= 0) {
      cursor = Math.max(cursor, ev.endMinute);
      continue;
    }

    if (isActive && activeState && activeState.segments.length > 0) {
      // Active event: project both focus fills and break bands from persisted segments
      const activeBands = projectActiveSegments(
        activeState.segments,
        activeState.remainingSeconds,
        ev,
        dayStartMs,
        nowMs,
      );
      bands.push(...activeBands);
    } else {
      // Check for persisted segments (past completed sessions)
      const evPersistedSegs = persistedSegments?.get(ev.id);
      if (evPersistedSegs && evPersistedSegs.length > 0) {
        // Output focus fill and break bands from persisted segments
        const pastBands = projectPersistedSegments(evPersistedSegs, ev, dayStartMs);
        bands.push(...pastBands);
      }

      // Skip fully past planned events (persisted bands already added above)
      const evEndMs = dayStartMs + ev.endMinute * 60000;
      if (nowMs >= evEndMs) {
        // Still compute trailing state for inheritance
        const evFullDuration = (ev.endMs - ev.startMs) / 60000;
        const fullSegments = computePlannedSegments(ev.config, evFullDuration, inheritedFocus, inheritedCycle);
        inheritedFocus = computeTrailingFocusMinutes(fullSegments);
        inheritedCycle = computeTrailingCycleNumber(fullSegments);
        cursor = Math.max(cursor, ev.endMinute);
        continue;
      }

      // Compute remaining planned bands from now (or effectiveStart)
      const evStartMs = dayStartMs + effectiveStart * 60000;
      const plannedStartMs = Math.max(nowMs, evStartMs);
      const plannedStartMinute = (plannedStartMs - dayStartMs) / 60000;
      const remainingDuration = ev.endMinute - plannedStartMinute;

      if (remainingDuration > 0) {
        // If we're starting partway through, adjust inheritance for elapsed time
        let adjustedFocus = inheritedFocus;
        let adjustedCycle = inheritedCycle;
        const elapsedSinceEffective = plannedStartMinute - effectiveStart;
        if (elapsedSinceEffective > 0) {
          const elapsedSegments = computePlannedSegments(ev.config, elapsedSinceEffective, inheritedFocus, inheritedCycle);
          adjustedFocus = computeTrailingFocusMinutes(elapsedSegments);
          adjustedCycle = computeTrailingCycleNumber(elapsedSegments);
        }

        const planned = computePlannedSegments(ev.config, remainingDuration, adjustedFocus, adjustedCycle);
        for (const seg of planned) {
          if (seg.phase === "focus") continue;
          bands.push({
            topMinute: plannedStartMinute + seg.startOffsetMinutes,
            heightMinutes: seg.endOffsetMinutes - seg.startOffsetMinutes,
            phase: seg.phase,
            status: "planned",
          });
        }
      }
    }

    // Compute trailing state for inheritance to next event (using full event duration)
    const fullDurationFromStart = ev.endMinute - effectiveStart;
    const fullSegments = computePlannedSegments(ev.config, fullDurationFromStart, inheritedFocus, inheritedCycle);
    inheritedFocus = computeTrailingFocusMinutes(fullSegments);
    inheritedCycle = computeTrailingCycleNumber(fullSegments);
    cursor = Math.max(cursor, ev.endMinute);
  }

  return bands.sort((a, b) => a.topMinute - b.topMinute);
}

/**
 * Filter out events that are fully contained within a longer event.
 * For same-range events, the one with shorter focus duration is kept (main).
 */
function filterContained(events: TimelineEvent[]): TimelineEvent[] {
  return events.filter((ev) => {
    const evDuration = ev.endMs - ev.startMs;
    for (const other of events) {
      if (other.id === ev.id) continue;
      // Check if other fully contains ev
      if (other.startMs > ev.startMs || other.endMs < ev.endMs) continue;
      const otherDuration = other.endMs - other.startMs;
      if (
        otherDuration > evDuration ||
        (otherDuration === evDuration && other.config.focusDurationMinutes < ev.config.focusDurationMinutes)
      ) {
        return false; // ev is contained by other
      }
    }
    return true;
  });
}

/**
 * Split a time range [startMs, endMs] into sub-ranges excluding pause intervals.
 * Each returned range is a filled period where focus was actually running.
 */
function splitAroundPauses(
  startMs: number,
  endMs: number,
  pauseLog: PauseInterval[],
): Array<{ start: number; end: number }> {
  if (pauseLog.length === 0) return [{ start: startMs, end: endMs }];

  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = startMs;

  for (const [pauseStart, pauseEnd] of pauseLog) {
    const pStartMs = new Date(pauseStart).getTime();
    const pEndMs = pauseEnd ? new Date(pauseEnd).getTime() : endMs;

    if (pStartMs > cursor) {
      ranges.push({ start: cursor, end: Math.min(pStartMs, endMs) });
    }
    cursor = Math.min(pEndMs, endMs);
    if (cursor >= endMs) break;
  }

  if (cursor < endMs) {
    ranges.push({ start: cursor, end: endMs });
  }

  return ranges;
}

/**
 * Emit focus fill bands for a segment, splitting around pause gaps.
 */
function emitFocusFillBands(
  startMs: number,
  endMs: number,
  pauseLog: PauseInterval[],
  dayStartMs: number,
  ev: TimelineEvent,
  status: SegmentStatus,
  bands: TimelineBand[],
): void {
  const ranges = splitAroundPauses(startMs, endMs, pauseLog);
  for (const r of ranges) {
    const topMinute = (r.start - dayStartMs) / 60000;
    const heightMinutes = (r.end - r.start) / 60000;
    if (heightMinutes > 0 && topMinute + heightMinutes > ev.startMinute && topMinute < ev.endMinute) {
      bands.push({ topMinute, heightMinutes, phase: "focus", status });
    }
  }
}

/**
 * Project bands from persisted (active) segments onto minute-of-day coordinates.
 * Outputs both focus fill bands and break bands.
 */
function projectActiveSegments(
  segments: PersistedSegment[],
  remainingSeconds: number,
  ev: TimelineEvent,
  dayStartMs: number,
  nowMs: number,
): TimelineBand[] {
  const bands: TimelineBand[] = [];
  const activeIdx = segments.findIndex((s) => s.status === "active");
  const currentEndMs = nowMs + remainingSeconds * 1000;
  let cursor = currentEndMs;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const plannedDurMs = new Date(seg.plannedEnd).getTime() - new Date(seg.plannedStart).getTime();

    if (seg.status === "completed" || seg.status === "skipped" || seg.status === "interrupted") {
      const startMs = new Date(seg.actualStart ?? seg.plannedStart).getTime();
      const endMs = new Date(seg.actualEnd ?? seg.plannedEnd).getTime();
      if (seg.phase === "focus") {
        emitFocusFillBands(startMs, endMs, seg.pauseLog, dayStartMs, ev, seg.status, bands);
      } else {
        const topMinute = (startMs - dayStartMs) / 60000;
        const heightMinutes = (endMs - startMs) / 60000;
        if (topMinute + heightMinutes > ev.startMinute && topMinute < ev.endMinute) {
          bands.push({ topMinute, heightMinutes, phase: seg.phase, status: seg.status });
        }
      }
    } else if (i === activeIdx) {
      if (seg.phase === "focus") {
        // Active focus: fill from actual_start to now (capped at segment end),
        // split around pause gaps.
        const startMs = new Date(seg.actualStart!).getTime();
        const segEndMs = startMs + plannedDurMs;
        const fillEndMs = Math.min(nowMs, segEndMs);
        if (fillEndMs > startMs) {
          emitFocusFillBands(startMs, fillEndMs, seg.pauseLog, dayStartMs, ev, "active", bands);
        }
      } else {
        // Active break
        const startMs = new Date(seg.actualStart!).getTime();
        const topMinute = (startMs - dayStartMs) / 60000;
        const heightMinutes = (cursor - startMs) / 60000;
        if (heightMinutes > 0 && topMinute + heightMinutes > ev.startMinute && topMinute < ev.endMinute) {
          bands.push({ topMinute, heightMinutes, phase: seg.phase, status: "active" });
        }
      }
    } else if (i > activeIdx || activeIdx === -1) {
      // Future planned segments: only output breaks (no focus fill for planned)
      if (seg.phase === "focus") {
        cursor += plannedDurMs;
        continue;
      }
      const topMinute = (cursor - dayStartMs) / 60000;
      const heightMinutes = plannedDurMs / 60000;
      if (topMinute + heightMinutes > ev.startMinute && topMinute < ev.endMinute) {
        bands.push({ topMinute, heightMinutes, phase: seg.phase, status: seg.status });
      }
      cursor += plannedDurMs;
    }
  }

  return bands;
}

/**
 * Project bands from persisted segments of past (non-active) events.
 * Only outputs completed focus and break bands (no planned fills).
 */
function projectPersistedSegments(
  segments: PersistedSegment[],
  ev: TimelineEvent,
  dayStartMs: number,
): TimelineBand[] {
  const bands: TimelineBand[] = [];
  for (const seg of segments) {
    if (seg.status === "planned") continue;
    if (!seg.actualStart) continue;
    const startMs = new Date(seg.actualStart).getTime();
    const endMs = seg.actualEnd ? new Date(seg.actualEnd).getTime() : startMs;
    if (endMs <= startMs) continue;
    if (seg.phase === "focus") {
      emitFocusFillBands(startMs, endMs, seg.pauseLog, dayStartMs, ev, seg.status, bands);
    } else {
      const topMinute = (startMs - dayStartMs) / 60000;
      const heightMinutes = (endMs - startMs) / 60000;
      if (topMinute + heightMinutes > ev.startMinute && topMinute < ev.endMinute) {
        bands.push({ topMinute, heightMinutes, phase: seg.phase, status: seg.status });
      }
    }
  }
  return bands;
}

/**
 * Compute the focus score for a completed session.
 *
 * Parameters
 * ----------
 * startMs : number
 *     Session start timestamp (ms).
 * endMs : number
 *     Session end timestamp (ms).
 * pauseLog : PauseInterval[]
 *     Array of [pauseStart, resumeOrNull] intervals.
 *
 * Returns
 * -------
 * number
 *     Ratio of actual focus time to total elapsed time (0.0 to 1.0).
 */
export function computeFocusScore(
  startMs: number,
  endMs: number,
  pauseLog: PauseInterval[],
): number {
  const totalMs = endMs - startMs;
  if (totalMs <= 0) return 1.0;
  let pauseMs = 0;
  for (const [pStart, pEnd] of pauseLog) {
    const ps = new Date(pStart).getTime();
    const pe = pEnd ? new Date(pEnd).getTime() : endMs;
    pauseMs += Math.max(0, Math.min(pe, endMs) - Math.max(ps, startMs));
  }
  return Math.round(Math.max(0, (totalMs - pauseMs) / totalMs) * 100) / 100;
}

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
