import type {
  PomodoroConfig,
  PlannedSegment,
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
 * @param config - Pomodoro timing settings.
 * @param eventDurationMinutes - Total duration of the calendar event in minutes.
 * @param initialFocusOffsetMinutes - Focus time already accumulated from a preceding event (inheritance).
 *     If >= focusDuration, the event starts with a break instead of focus.
 * @param initialCycleNumber - Cycle number to start at (from a preceding event's trailing cycle).
 *     Default 1. If >= pomodoroCount, the first break will be a long break.
 * @returns Ordered list of segments with minute offsets from the event start.
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
 * @param segments - Output from computePlannedSegments.
 * @param eventDurationMinutes - Total duration of the calendar event in minutes.
 * @param status - Status to assign to all bands (default "planned").
 * @returns Bands representing break positions within the accent bar.
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
  phaseElapsedSeconds?: number;
  currentConfig?: PomodoroConfig;
  breakOvertimeSeconds: number;
}

export function isLatestSegmentFetchResponse(
  responseKey: string,
  currentKey: string,
): boolean {
  return responseKey === currentKey;
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

  // Find the active event's range so planned bands from overlapping events
  // are suppressed (the active session's bands take visual priority).
  const activeEvRange = activeState?.activeBlockId
    ? sorted.find((ev) => ev.id === activeState.activeBlockId)
    : null;

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
      const activeRunIds = new Set(activeState.segments.map((segment) => segment.runId));
      const previousRunSegments = (persistedSegments?.get(ev.id) ?? [])
        .filter((segment) => !activeRunIds.has(segment.runId));
      if (previousRunSegments.length > 0) {
        bands.push(...projectPersistedSegments(previousRunSegments, ev, dayStartMs));
      }

      // Active event: project both focus fills and break bands from persisted segments
      const activeBands = projectActiveSegments(
        activeState.segments,
        activeState.remainingSeconds,
        activeState.phaseElapsedSeconds,
        activeState.currentConfig,
        ev,
        dayStartMs,
        nowMs,
      );
      bands.push(...activeBands);
    } else {
      // Check for persisted segments (past completed sessions)
      const evPersistedSegs = persistedSegments?.get(ev.id);
      const hasPersistedSegments = !!evPersistedSegs && evPersistedSegs.length > 0;
      if (hasPersistedSegments) {
        // Output focus fill and break bands from persisted segments
        const pastBands = projectPersistedSegments(evPersistedSegs ?? [], ev, dayStartMs);
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

      // Compute remaining planned bands from now or effectiveStart. Events
      // with persisted segments keep their original rhythm. Untracked events
      // that are already in progress preview from now, matching the schedule
      // created when the user starts Pomodoro work after saving.
      const evStartMs = dayStartMs + effectiveStart * 60000;
      const plannedStartMs = Math.max(nowMs, evStartMs);
      const plannedStartMinute = (plannedStartMs - dayStartMs) / 60000;
      const remainingDuration = ev.endMinute - plannedStartMinute;
      const untrackedInProgress = !hasPersistedSegments && nowMs > evStartMs && nowMs < evEndMs;

      if (remainingDuration > 0) {
        let adjustedFocus = untrackedInProgress ? 0 : inheritedFocus;
        let adjustedCycle = untrackedInProgress ? 1 : inheritedCycle;
        const elapsedSinceEffective = plannedStartMinute - effectiveStart;
        if (elapsedSinceEffective > 0 && !untrackedInProgress) {
          const elapsedSegments = computePlannedSegments(ev.config, elapsedSinceEffective, inheritedFocus, inheritedCycle);
          adjustedFocus = computeTrailingFocusMinutes(elapsedSegments);
          adjustedCycle = computeTrailingCycleNumber(elapsedSegments);
        }

        const planned = computePlannedSegments(ev.config, remainingDuration, adjustedFocus, adjustedCycle);
        for (const seg of planned) {
          if (seg.phase === "focus") continue;
          const bandTop = plannedStartMinute + seg.startOffsetMinutes;
          const bandEnd = bandTop + (seg.endOffsetMinutes - seg.startOffsetMinutes);
          // Skip planned bands that overlap with the active event's range
          // (the active session's bands take visual priority on the rail).
          if (activeEvRange && !isActive && bandTop < activeEvRange.endMinute && bandEnd > activeEvRange.startMinute) {
            continue;
          }
          bands.push({
            topMinute: bandTop,
            heightMinutes: seg.endOffsetMinutes - seg.startOffsetMinutes,
            phase: seg.phase,
            status: "planned",
          });
        }
      }
    }

    const evEndMsForTrailing = dayStartMs + ev.endMinute * 60000;
    const evStartMsForTrailing = dayStartMs + effectiveStart * 60000;
    const isUntrackedInProgressForTrailing = !isActive
      && !persistedSegments?.get(ev.id)?.length
      && nowMs > evStartMsForTrailing
      && nowMs < evEndMsForTrailing;
    const trailingStartMinute = isUntrackedInProgressForTrailing
      ? (Math.max(nowMs, evStartMsForTrailing) - dayStartMs) / 60000
      : effectiveStart;
    const trailingFocus = isUntrackedInProgressForTrailing ? 0 : inheritedFocus;
    const trailingCycle = isUntrackedInProgressForTrailing ? 1 : inheritedCycle;

    // Compute trailing state for inheritance to next event.
    const fullDurationFromStart = ev.endMinute - trailingStartMinute;
    const fullSegments = computePlannedSegments(ev.config, fullDurationFromStart, trailingFocus, trailingCycle);
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

function samePomodoroConfig(a: PomodoroConfig | undefined, b: PomodoroConfig | undefined): boolean {
  return !!a && !!b
    && a.focusDurationMinutes === b.focusDurationMinutes
    && a.shortBreakMinutes === b.shortBreakMinutes
    && a.longBreakMinutes === b.longBreakMinutes
    && a.pomodoroCount === b.pomodoroCount;
}

function phaseDurationMinutes(phase: SegmentPhase, config: PomodoroConfig): number {
  if (phase === "focus") return config.focusDurationMinutes;
  if (phase === "long_break") return config.longBreakMinutes;
  return config.shortBreakMinutes;
}

function projectedActiveSegmentEndMs(
  activeSegment: PersistedSegment,
  remainingSeconds: number,
  ev: TimelineEvent,
  nowMs: number,
  activeConfig?: PomodoroConfig,
  phaseElapsedSeconds?: number,
): number {
  const storedEndMs = nowMs + remainingSeconds * 1000;
  if (samePomodoroConfig(activeConfig, ev.config)) return storedEndMs;

  const targetDurationSeconds = phaseDurationMinutes(activeSegment.phase, ev.config) * 60;
  const elapsedSeconds = phaseElapsedSeconds ?? Math.max(
    0,
    phaseDurationMinutes(activeSegment.phase, activeConfig ?? ev.config) * 60 - remainingSeconds,
  );
  const projectedRemainingSeconds = Math.max(0, targetDurationSeconds - elapsedSeconds);
  return Math.min(ev.endMs, nowMs + projectedRemainingSeconds * 1000);
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

  for (const pause of pauseLog) {
    const pStartMs = new Date(pause.startedAt).getTime();
    const pEndMs = pause.endedAt ? new Date(pause.endedAt).getTime() : endMs;

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
    const rawTopMinute = (r.start - dayStartMs) / 60000;
    const rawEndMinute = (r.end - dayStartMs) / 60000;
    const topMinute = Math.max(rawTopMinute, ev.startMinute);
    const endMinute = Math.min(rawEndMinute, ev.endMinute);
    const heightMinutes = endMinute - topMinute;
    if (heightMinutes > 0) {
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
  phaseElapsedSeconds: number | undefined,
  activeConfig: PomodoroConfig | undefined,
  ev: TimelineEvent,
  dayStartMs: number,
  nowMs: number,
): TimelineBand[] {
  const bands: TimelineBand[] = [];
  const activeIdx = segments.findIndex((s) => s.status === "active");
  const activeSegment = activeIdx >= 0 ? segments[activeIdx] : null;
  const currentEndMs = activeSegment
    ? projectedActiveSegmentEndMs(activeSegment, remainingSeconds, ev, nowMs, activeConfig, phaseElapsedSeconds)
    : nowMs + remainingSeconds * 1000;

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
        const heightMinutes = (currentEndMs - startMs) / 60000;
        if (heightMinutes > 0 && topMinute + heightMinutes > ev.startMinute && topMinute < ev.endMinute) {
          bands.push({ topMinute, heightMinutes, phase: seg.phase, status: "active" });
        }
      }
    }
  }

  if (activeSegment) {
    emitProjectedFutureBreakBands(activeSegment, currentEndMs, ev, dayStartMs, bands);
  }

  return bands;
}

function emitProjectedFutureBreakBands(
  activeSegment: PersistedSegment,
  currentEndMs: number,
  ev: TimelineEvent,
  dayStartMs: number,
  bands: TimelineBand[],
): void {
  let cursor = currentEndMs;
  let cycle = activeSegment.cycleNumber;
  let nextIsFocus = activeSegment.phase !== "focus";

  if (activeSegment.phase === "short_break" || activeSegment.phase === "long_break") {
    cycle = activeSegment.phase === "long_break" ? 1 : activeSegment.cycleNumber + 1;
  }

  while (cursor < ev.endMs) {
    if (nextIsFocus) {
      cursor += ev.config.focusDurationMinutes * 60_000;
      nextIsFocus = false;
      continue;
    }

    const isLongBreak = cycle >= ev.config.pomodoroCount;
    const breakPhase: SegmentPhase = isLongBreak ? "long_break" : "short_break";
    const breakDurationMs = (isLongBreak ? ev.config.longBreakMinutes : ev.config.shortBreakMinutes) * 60_000;
    const breakEnd = Math.min(cursor + breakDurationMs, ev.endMs);
    const topMinute = (cursor - dayStartMs) / 60000;
    const heightMinutes = (breakEnd - cursor) / 60000;
    if (heightMinutes > 0 && topMinute + heightMinutes > ev.startMinute && topMinute < ev.endMinute) {
      bands.push({ topMinute, heightMinutes, phase: breakPhase, status: "planned" });
    }

    cursor += breakDurationMs;
    cycle = isLongBreak ? 1 : cycle + 1;
    nextIsFocus = true;
  }
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
