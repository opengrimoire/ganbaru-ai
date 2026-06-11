import {
  BLOCK_BURST_MIN_ATTEMPTS,
  BLOCK_BURST_WINDOW_SECONDS,
} from "./constants";
import type {
  AdaptiveBlockEventInput,
  AdaptiveContextBucket,
  AdaptiveContextInput,
  AdaptiveDataQualityFlag,
  AdaptiveEnergyBucket,
  AdaptiveEventLengthBucket,
  AdaptiveFeatureInput,
  AdaptiveFeatureVector,
  AdaptivePauseInput,
  AdaptiveRunEventInput,
  AdaptiveSegmentInput,
  AdaptiveSessionPosition,
  AdaptiveTimeOfDayBucket,
  AdaptiveWorkloadBucket,
} from "./types";

const EMPTY_FEATURES: AdaptiveFeatureVector = {
  completedFocusSegments: 0,
  interruptedFocusSegments: 0,
  focusFailureCount: 0,
  lateFocusSegmentCount: 0,
  lateFocusFailureCount: 0,
  cleanFocusSeconds: 0,
  plannedFocusSeconds: 0,
  idlePauseCount: 0,
  idlePauseSeconds: 0,
  focusIdlePauseCount: 0,
  focusIdlePauseSeconds: 0,
  earlyFocusIdlePauseCount: 0,
  lateFocusIdlePauseCount: 0,
  manualPauseCount: 0,
  manualPauseSeconds: 0,
  suspendPauseCount: 0,
  suspendPauseSeconds: 0,
  breakStartedCount: 0,
  breakCompletedCount: 0,
  breakSkippedCount: 0,
  skippedBreakNextFocusSuccessCount: 0,
  skippedBreakNextFocusFailureCount: 0,
  skippedShortBreakNextFocusFailureCount: 0,
  skippedLongBreakNextFocusFailureCount: 0,
  shortBreakOvertimeSeconds: 0,
  longBreakOvertimeSeconds: 0,
  blockedAttemptCount: 0,
  blockedBurstCount: 0,
  repeatedBlockedSourceAttemptCount: 0,
  focusRepeatedBlockedSourceAttemptCount: 0,
  breakRepeatedBlockedSourceAttemptCount: 0,
  focusBlockedAttemptCount: 0,
  earlyFocusBlockedAttemptCount: 0,
  lateFocusBlockedAttemptCount: 0,
  breakBlockedAttemptCount: 0,
  breakOvertimeBlockedAttemptCount: 0,
  shortBreakOvertimeBlockedAttemptCount: 0,
  longBreakOvertimeBlockedAttemptCount: 0,
  extensionCount: 0,
  goToBreakNowCount: 0,
  earlyGoToBreakNowCount: 0,
  lateGoToBreakNowCount: 0,
  startFocusNowCount: 0,
  startFocusNowSuccessCount: 0,
  startFocusNowFailureCount: 0,
  stopCount: 0,
  comparableOpportunityCount: 0,
  dataQualityFlags: [],
};

const FOCUS_EDGE_RATIO = 0.25;
const FOCUS_EDGE_SECONDS = 5 * 60;
const EARLY_MANUAL_END_TOLERANCE_SECONDS = 1;
const EXPLICIT_EVENT_MATCH_TOLERANCE_MS = 1500;

/**
 * Extracts adaptive behavior metrics from local Pomodoro and blocking history.
 */
export function extractAdaptiveFeatures(input: AdaptiveFeatureInput): AdaptiveFeatureVector {
  const totals = mutableFeatureTotals(input.dataQualityFlags ?? []);
  const observationEndMs = input.observationEndedAt ? parseTimeMs(input.observationEndedAt) : null;
  const focusWindows = focusBlockWindows(input.segments, observationEndMs);
  const breakWindows = breakBlockWindows(input.segments, observationEndMs);

  for (const segment of input.segments) {
    applySegmentFeatures(totals, segment, observationEndMs);
  }

  for (const event of input.runEvents ?? []) {
    applyRunEventFeatures(totals, event, input.segments, focusWindows);
  }

  applyManualTransitionInference(totals, input.segments, input.runEvents ?? [], focusWindows);
  applySkippedBreakOutcomes(totals, input.segments, input.runEvents ?? []);
  applyBlockEventFeatures(totals, input.blockEvents ?? [], focusWindows, breakWindows);

  totals.comparableOpportunityCount = Math.max(
    totals.comparableOpportunityCount,
    totals.completedFocusSegments + totals.interruptedFocusSegments + totals.breakStartedCount,
  );

  return freezeFeatureTotals(totals);
}

/**
 * Returns an empty adaptive feature vector for replay datasets and tests.
 */
export function emptyAdaptiveFeatureVector(): AdaptiveFeatureVector {
  return freezeFeatureTotals(mutableFeatureTotals([]));
}

/**
 * Builds a coarse context bucket for comparisons that should not overfit one user's sparse data.
 */
export function deriveAdaptiveContextBucket(input: AdaptiveContextInput): AdaptiveContextBucket {
  return {
    timeOfDay: timeOfDayBucket(input.localStartedAt),
    sessionPosition: sessionPosition(input.sessionIndexToday),
    eventLength: eventLengthBucket(input.plannedEventMinutes),
    workload: workloadBucket(input.cleanFocusMinutesToday),
    energy: energyBucket(input.energyLevel),
    environmentId: input.environmentId,
  };
}

interface MutableFeatureTotals {
  completedFocusSegments: number;
  interruptedFocusSegments: number;
  focusFailureCount: number;
  lateFocusSegmentCount: number;
  lateFocusFailureCount: number;
  cleanFocusSeconds: number;
  plannedFocusSeconds: number;
  idlePauseCount: number;
  idlePauseSeconds: number;
  focusIdlePauseCount: number;
  focusIdlePauseSeconds: number;
  earlyFocusIdlePauseCount: number;
  lateFocusIdlePauseCount: number;
  manualPauseCount: number;
  manualPauseSeconds: number;
  suspendPauseCount: number;
  suspendPauseSeconds: number;
  breakStartedCount: number;
  breakCompletedCount: number;
  breakSkippedCount: number;
  skippedBreakNextFocusSuccessCount: number;
  skippedBreakNextFocusFailureCount: number;
  skippedShortBreakNextFocusFailureCount: number;
  skippedLongBreakNextFocusFailureCount: number;
  shortBreakOvertimeSeconds: number;
  longBreakOvertimeSeconds: number;
  blockedAttemptCount: number;
  blockedBurstCount: number;
  repeatedBlockedSourceAttemptCount: number;
  focusRepeatedBlockedSourceAttemptCount: number;
  breakRepeatedBlockedSourceAttemptCount: number;
  focusBlockedAttemptCount: number;
  earlyFocusBlockedAttemptCount: number;
  lateFocusBlockedAttemptCount: number;
  breakBlockedAttemptCount: number;
  breakOvertimeBlockedAttemptCount: number;
  shortBreakOvertimeBlockedAttemptCount: number;
  longBreakOvertimeBlockedAttemptCount: number;
  extensionCount: number;
  goToBreakNowCount: number;
  earlyGoToBreakNowCount: number;
  lateGoToBreakNowCount: number;
  startFocusNowCount: number;
  startFocusNowSuccessCount: number;
  startFocusNowFailureCount: number;
  stopCount: number;
  comparableOpportunityCount: number;
  dataQualityFlags: AdaptiveDataQualityFlag[];
}

function mutableFeatureTotals(flags: readonly AdaptiveDataQualityFlag[]): MutableFeatureTotals {
  return {
    ...EMPTY_FEATURES,
    dataQualityFlags: [...new Set(flags)],
  };
}

function freezeFeatureTotals(totals: MutableFeatureTotals): AdaptiveFeatureVector {
  return {
    ...totals,
    dataQualityFlags: [...totals.dataQualityFlags],
  };
}

function applySegmentFeatures(
  totals: MutableFeatureTotals,
  segment: AdaptiveSegmentInput,
  observationEndMs: number | null,
): void {
  const actualStartMs = segment.actualStart ? parseTimeMs(segment.actualStart) : null;
  const actualEndMs = segment.actualEnd ? parseTimeMs(segment.actualEnd) : observationEndMs;
  const plannedStartMs = parseTimeMs(segment.plannedStart);
  const plannedEndMs = parseTimeMs(segment.plannedEnd);
  const plannedSeconds = boundedSecondsBetween(plannedStartMs, plannedEndMs);

  if (segment.phase === "focus") {
    totals.plannedFocusSeconds += plannedSeconds;
    const lateFocus = (segment.rhythmPosition ?? 1) >= 3;
    if (lateFocus) totals.lateFocusSegmentCount += 1;
    if (segment.status === "completed") totals.completedFocusSegments += 1;
    if (segment.status === "interrupted") totals.interruptedFocusSegments += 1;
    if (segment.endReason === "focus_failed") {
      totals.focusFailureCount += 1;
      if (lateFocus) totals.lateFocusFailureCount += 1;
    }
    if (actualStartMs !== null && actualEndMs !== null) {
      totals.cleanFocusSeconds += cleanSegmentSeconds(segment.pauseLog, actualStartMs, actualEndMs);
    }
  } else {
    if (segment.status !== "skipped") totals.breakStartedCount += 1;
    if (segment.status === "completed") totals.breakCompletedCount += 1;
    if (segment.status === "skipped" || segment.endReason === "skipped_by_user") {
      totals.breakSkippedCount += 1;
    }
    if (actualEndMs !== null) {
      const overtimeSeconds = Math.max(0, Math.ceil((actualEndMs - plannedEndMs) / 1000));
      if (segment.phase === "short_break") {
        totals.shortBreakOvertimeSeconds += overtimeSeconds;
      } else {
        totals.longBreakOvertimeSeconds += overtimeSeconds;
      }
    }
  }

  for (const pause of segment.pauseLog) {
    applyPauseFeatures(totals, pause, actualStartMs, actualEndMs);
    if (segment.phase === "focus") {
      applyFocusIdlePauseFeatures(
        totals,
        pause,
        actualStartMs ?? plannedStartMs,
        actualEndMs ?? plannedEndMs,
      );
    }
  }
}

function applyPauseFeatures(
  totals: MutableFeatureTotals,
  pause: AdaptivePauseInput,
  actualStartMs: number | null,
  actualEndMs: number | null,
): void {
  const startedAt = parseTimeMs(pause.startedAt);
  const endedAt = pause.endedAt ? parseTimeMs(pause.endedAt) : actualEndMs;
  if (endedAt === null) return;
  const lower = actualStartMs ?? startedAt;
  const seconds = boundedSecondsBetween(Math.max(startedAt, lower), endedAt);
  if (pause.reason === "idle") {
    totals.idlePauseCount += 1;
    totals.idlePauseSeconds += seconds;
  } else if (pause.reason === "manual") {
    totals.manualPauseCount += 1;
    totals.manualPauseSeconds += seconds;
  } else {
    totals.suspendPauseCount += 1;
    totals.suspendPauseSeconds += seconds;
  }
}

function applyFocusIdlePauseFeatures(
  totals: MutableFeatureTotals,
  pause: AdaptivePauseInput,
  focusStartMs: number,
  focusEndMs: number,
): void {
  if (pause.reason !== "idle") return;
  if (!Number.isFinite(focusStartMs) || !Number.isFinite(focusEndMs) || focusEndMs <= focusStartMs) return;
  const pauseStartMs = parseTimeMs(pause.startedAt);
  const pauseEndMs = pause.endedAt ? parseTimeMs(pause.endedAt) : focusEndMs;
  const seconds = boundedSecondsBetween(
    Math.max(pauseStartMs, focusStartMs),
    Math.min(pauseEndMs, focusEndMs),
  );
  if (seconds <= 0) return;

  totals.focusIdlePauseCount += 1;
  totals.focusIdlePauseSeconds += seconds;
  const timing = focusWindowTimingAt(pauseStartMs, [{ startMs: focusStartMs, endMs: focusEndMs }]);
  if (timing === "early") totals.earlyFocusIdlePauseCount += 1;
  if (timing === "late") totals.lateFocusIdlePauseCount += 1;
}

function applyRunEventFeatures(
  totals: MutableFeatureTotals,
  event: AdaptiveRunEventInput,
  segments: readonly AdaptiveSegmentInput[],
  focusWindows: readonly FocusBlockWindow[],
): void {
  if (event.eventType === "extend_focus") totals.extensionCount += 1;
  if (event.eventType === "go_to_break_now") {
    totals.goToBreakNowCount += 1;
    applyGoToBreakNowTiming(totals, event, focusWindows);
  }
  if (event.eventType === "start_focus_now") {
    totals.startFocusNowCount += 1;
    applyStartFocusNowOutcome(totals, event, segments);
  }
  if (event.eventType === "skip_break") totals.breakSkippedCount += 1;
  if (event.eventType === "focus_failed") totals.focusFailureCount += 1;
  if (event.eventType === "stop") totals.stopCount += 1;
  if (event.eventType === "crash_recovery") addDataQualityFlag(totals, "crash_recovered");
}

function applyGoToBreakNowTiming(
  totals: MutableFeatureTotals,
  event: AdaptiveRunEventInput,
  focusWindows: readonly FocusBlockWindow[],
): void {
  if (event.phase !== "focus") return;
  applyGoToBreakNowTimingAt(totals, parseTimeMs(event.occurredAt), focusWindows);
}

function applyGoToBreakNowTimingAt(
  totals: MutableFeatureTotals,
  occurredAtMs: number,
  focusWindows: readonly FocusBlockWindow[],
): void {
  const timing = focusWindowTimingAt(occurredAtMs, focusWindows);
  if (timing === "early") totals.earlyGoToBreakNowCount += 1;
  if (timing === "late") totals.lateGoToBreakNowCount += 1;
}

function applyStartFocusNowOutcome(
  totals: MutableFeatureTotals,
  event: AdaptiveRunEventInput,
  segments: readonly AdaptiveSegmentInput[],
): void {
  const nextFocus = nextFocusAfter(segments, parseTimeMs(event.occurredAt));

  if (!nextFocus) return;
  if (nextFocus.status === "completed") {
    totals.startFocusNowSuccessCount += 1;
  } else if (nextFocus.status === "interrupted" || nextFocus.endReason === "focus_failed") {
    totals.startFocusNowFailureCount += 1;
  }
}

function applyManualTransitionInference(
  totals: MutableFeatureTotals,
  segments: readonly AdaptiveSegmentInput[],
  runEvents: readonly AdaptiveRunEventInput[],
  focusWindows: readonly FocusBlockWindow[],
): void {
  const sortedSegments = segmentsByStart(segments);
  const explicitGoToBreakTimes = explicitEventTimes(runEvents, "go_to_break_now");
  const explicitStartFocusTimes = explicitEventTimes(runEvents, "start_focus_now");

  for (const segment of sortedSegments) {
    if (segment.phase === "focus") {
      applyInferredGoToBreakNow(
        totals,
        segment,
        sortedSegments,
        focusWindows,
        explicitGoToBreakTimes,
      );
    } else if (isBreakSegment(segment)) {
      applyInferredStartFocusNow(
        totals,
        segment,
        sortedSegments,
        explicitStartFocusTimes,
      );
    }
  }
}

function applyInferredGoToBreakNow(
  totals: MutableFeatureTotals,
  segment: AdaptiveSegmentInput,
  sortedSegments: readonly AdaptiveSegmentInput[],
  focusWindows: readonly FocusBlockWindow[],
  explicitTimes: readonly number[],
): void {
  const actualEndMs = segment.actualEnd ? parseTimeMs(segment.actualEnd) : null;
  if (actualEndMs === null) return;
  if (!segmentEndedEarly(segment, actualEndMs)) return;
  if (segment.status !== "completed" || segment.endReason !== "completed") return;
  const next = nextSegmentAfter(sortedSegments, actualEndMs);
  if (!next || !isBreakSegment(next)) return;
  if (hasExplicitEventNear(explicitTimes, actualEndMs)) return;

  totals.goToBreakNowCount += 1;
  applyGoToBreakNowTimingAt(totals, actualEndMs, focusWindows);
}

function applyInferredStartFocusNow(
  totals: MutableFeatureTotals,
  segment: AdaptiveSegmentInput & { phase: "short_break" | "long_break" },
  sortedSegments: readonly AdaptiveSegmentInput[],
  explicitTimes: readonly number[],
): void {
  const actualEndMs = segment.actualEnd ? parseTimeMs(segment.actualEnd) : null;
  if (actualEndMs === null) return;
  if (!segmentEndedEarly(segment, actualEndMs)) return;
  if (!isManualBreakEarlyEndCandidate(segment)) return;
  const nextFocus = nextFocusAfter(sortedSegments, actualEndMs);
  if (!nextFocus) return;
  if (hasExplicitEventNear(explicitTimes, actualEndMs)) return;

  totals.startFocusNowCount += 1;
  if (nextFocus.status === "completed") {
    totals.startFocusNowSuccessCount += 1;
  } else if (nextFocus.status === "interrupted" || nextFocus.endReason === "focus_failed") {
    totals.startFocusNowFailureCount += 1;
  }
}

function segmentEndedEarly(segment: AdaptiveSegmentInput, actualEndMs: number): boolean {
  const plannedEndMs = parseTimeMs(segment.plannedEnd);
  if (!Number.isFinite(plannedEndMs) || !Number.isFinite(actualEndMs)) return false;
  return plannedEndMs - actualEndMs >= EARLY_MANUAL_END_TOLERANCE_SECONDS * 1000;
}

function isManualBreakEarlyEndCandidate(
  segment: AdaptiveSegmentInput & { phase: "short_break" | "long_break" },
): boolean {
  if (segment.status === "skipped" || segment.endReason === "skipped_by_user") return true;
  return segment.status === "completed" && segment.endReason === "completed";
}

function explicitEventTimes(
  events: readonly AdaptiveRunEventInput[],
  eventType: "go_to_break_now" | "start_focus_now",
): number[] {
  return events
    .filter((event) => event.eventType === eventType)
    .map((event) => parseTimeMs(event.occurredAt))
    .filter((timeMs) => Number.isFinite(timeMs));
}

function hasExplicitEventNear(times: readonly number[], occurredAtMs: number): boolean {
  return times.some((timeMs) =>
    Math.abs(timeMs - occurredAtMs) <= EXPLICIT_EVENT_MATCH_TOLERANCE_MS
  );
}

function segmentsByStart(segments: readonly AdaptiveSegmentInput[]): AdaptiveSegmentInput[] {
  return [...segments].sort((a, b) => segmentStartMs(a) - segmentStartMs(b));
}

function segmentStartMs(segment: AdaptiveSegmentInput): number {
  return segment.actualStart ? parseTimeMs(segment.actualStart) : parseTimeMs(segment.plannedStart);
}

function nextSegmentAfter(
  sortedSegments: readonly AdaptiveSegmentInput[],
  occurredAtMs: number,
): AdaptiveSegmentInput | null {
  return sortedSegments.find((segment) => segmentStartMs(segment) >= occurredAtMs) ?? null;
}

interface SkippedBreakMarker {
  phase: "short_break" | "long_break";
  occurredAtMs: number;
}

function applySkippedBreakOutcomes(
  totals: MutableFeatureTotals,
  segments: readonly AdaptiveSegmentInput[],
  runEvents: readonly AdaptiveRunEventInput[],
): void {
  const markers = skippedBreakMarkers(segments, runEvents);
  for (const marker of markers) {
    const nextFocus = nextFocusAfter(segments, marker.occurredAtMs);
    if (!nextFocus) continue;
    if (nextFocus.status === "completed") {
      totals.skippedBreakNextFocusSuccessCount += 1;
    } else if (nextFocus.status === "interrupted" || nextFocus.endReason === "focus_failed") {
      totals.skippedBreakNextFocusFailureCount += 1;
      if (marker.phase === "short_break") {
        totals.skippedShortBreakNextFocusFailureCount += 1;
      } else {
        totals.skippedLongBreakNextFocusFailureCount += 1;
      }
    }
  }
}

function skippedBreakMarkers(
  segments: readonly AdaptiveSegmentInput[],
  runEvents: readonly AdaptiveRunEventInput[],
): SkippedBreakMarker[] {
  const markers = [
    ...segments
      .filter(isBreakSegment)
      .filter((segment) => segment.status === "skipped" || segment.endReason === "skipped_by_user")
      .map((segment) => ({
        phase: segment.phase,
        occurredAtMs: parseTimeMs(segment.actualEnd ?? segment.actualStart ?? segment.plannedStart),
      })),
    ...runEvents
      .filter((event) => event.eventType === "skip_break")
      .filter((event): event is AdaptiveRunEventInput & { phase: "short_break" | "long_break" } =>
        event.phase === "short_break" || event.phase === "long_break",
      )
      .map((event) => ({
        phase: event.phase,
        occurredAtMs: parseTimeMs(event.occurredAt),
      })),
  ];
  const seen = new Set<string>();
  return markers
    .filter((marker) => Number.isFinite(marker.occurredAtMs) && marker.occurredAtMs > 0)
    .filter((marker) => {
      const key = `${marker.phase}:${marker.occurredAtMs}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs);
}

function nextFocusAfter(
  segments: readonly AdaptiveSegmentInput[],
  occurredAtMs: number,
): AdaptiveSegmentInput | null {
  return segments
    .filter((segment) => segment.phase === "focus")
    .map((segment) => ({
      segment,
      startMs: segment.actualStart ? parseTimeMs(segment.actualStart) : parseTimeMs(segment.plannedStart),
    }))
    .filter((candidate) => candidate.startMs >= occurredAtMs)
    .sort((a, b) => a.startMs - b.startMs)[0]?.segment ?? null;
}

function applyBlockEventFeatures(
  totals: MutableFeatureTotals,
  blockEvents: readonly AdaptiveBlockEventInput[],
  focusWindows: readonly FocusBlockWindow[],
  breakWindows: readonly BreakBlockWindow[],
): void {
  const blocked = blockEvents
    .filter((event) => event.decision === "blocked" || event.decision === "limit_exhausted")
    .sort((a, b) => parseTimeMs(a.occurredAt) - parseTimeMs(b.occurredAt));
  const repeatedSourceCounts = repeatedBlockedSourceCounts(blocked);
  totals.blockedAttemptCount += blocked.length;
  totals.repeatedBlockedSourceAttemptCount += repeatedSourceCounts.total;
  totals.focusRepeatedBlockedSourceAttemptCount += repeatedSourceCounts.focus;
  totals.breakRepeatedBlockedSourceAttemptCount += repeatedSourceCounts.break;
  for (const event of blocked) {
    if (event.phase !== "focus") continue;
    totals.focusBlockedAttemptCount += 1;
    applyFocusBlockedTiming(totals, event, focusWindows);
  }
  totals.breakBlockedAttemptCount += blocked.filter(
    (event) => event.phase === "short_break" || event.phase === "long_break",
  ).length;
  for (const event of blocked) {
    if (event.phase !== "short_break" && event.phase !== "long_break") continue;
    applyBreakBlockedTiming(totals, event, breakWindows);
  }
  totals.blockedBurstCount += countBlockedBursts(blocked);
}

interface RepeatedBlockedSourceCounts {
  total: number;
  focus: number;
  break: number;
}

function repeatedBlockedSourceCounts(
  blocked: readonly AdaptiveBlockEventInput[],
): RepeatedBlockedSourceCounts {
  return {
    total: repeatedCountBySource(blocked),
    focus: repeatedCountBySource(blocked.filter((event) => event.phase === "focus")),
    break: repeatedCountBySource(blocked.filter(
      (event) => event.phase === "short_break" || event.phase === "long_break",
    )),
  };
}

function repeatedCountBySource(blocked: readonly AdaptiveBlockEventInput[]): number {
  const counts = new Map<string, number>();
  for (const event of blocked) {
    const key = `${event.sourceType}:${event.sourceKey}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

interface FocusBlockWindow {
  startMs: number;
  endMs: number;
}

function focusBlockWindows(
  segments: readonly AdaptiveSegmentInput[],
  observationEndMs: number | null,
): FocusBlockWindow[] {
  return segments
    .filter((segment) => segment.phase === "focus")
    .map((segment) => {
      const startMs = segment.actualStart ? parseTimeMs(segment.actualStart) : parseTimeMs(segment.plannedStart);
      const plannedEndMs = parseTimeMs(segment.plannedEnd);
      const fallbackEndMs = observationEndMs ?? plannedEndMs;
      const endMs = segment.actualEnd ? parseTimeMs(segment.actualEnd) : fallbackEndMs;
      return {
        startMs,
        endMs: Math.max(startMs, plannedEndMs, endMs),
      };
    })
    .filter((window) => window.endMs > window.startMs)
    .sort((a, b) => a.startMs - b.startMs);
}

interface BreakBlockWindow {
  phase: "short_break" | "long_break";
  plannedEndMs: number;
  actualEndMs: number;
}

function breakBlockWindows(
  segments: readonly AdaptiveSegmentInput[],
  observationEndMs: number | null,
): BreakBlockWindow[] {
  return segments
    .filter(isBreakSegment)
    .map((segment) => {
      const plannedEndMs = parseTimeMs(segment.plannedEnd);
      const fallbackEndMs = observationEndMs ?? plannedEndMs;
      const actualEndMs = segment.actualEnd ? parseTimeMs(segment.actualEnd) : fallbackEndMs;
      return {
        phase: segment.phase,
        plannedEndMs,
        actualEndMs: Math.max(plannedEndMs, actualEndMs),
      };
    })
    .filter((window) => window.actualEndMs > window.plannedEndMs)
    .sort((a, b) => a.plannedEndMs - b.plannedEndMs);
}

function isBreakSegment(
  segment: AdaptiveSegmentInput,
): segment is AdaptiveSegmentInput & { phase: "short_break" | "long_break" } {
  return segment.phase === "short_break" || segment.phase === "long_break";
}

function applyBreakBlockedTiming(
  totals: MutableFeatureTotals,
  event: AdaptiveBlockEventInput,
  breakWindows: readonly BreakBlockWindow[],
): void {
  const eventMs = parseTimeMs(event.occurredAt);
  const window = breakWindows.find(
    (candidate) =>
      candidate.phase === event.phase &&
      eventMs > candidate.plannedEndMs &&
      eventMs <= candidate.actualEndMs,
  );
  if (!window) return;
  totals.breakOvertimeBlockedAttemptCount += 1;
  if (window.phase === "short_break") {
    totals.shortBreakOvertimeBlockedAttemptCount += 1;
  } else {
    totals.longBreakOvertimeBlockedAttemptCount += 1;
  }
}

function applyFocusBlockedTiming(
  totals: MutableFeatureTotals,
  event: AdaptiveBlockEventInput,
  focusWindows: readonly FocusBlockWindow[],
): void {
  const timing = focusWindowTimingAt(parseTimeMs(event.occurredAt), focusWindows);
  if (timing === "early") totals.earlyFocusBlockedAttemptCount += 1;
  if (timing === "late") totals.lateFocusBlockedAttemptCount += 1;
}

type FocusWindowTiming = "early" | "late" | null;

function focusWindowTimingAt(
  eventMs: number,
  focusWindows: readonly FocusBlockWindow[],
): FocusWindowTiming {
  const window = focusWindows.find((candidate) => eventMs >= candidate.startMs && eventMs <= candidate.endMs);
  if (!window) return null;
  const durationSeconds = boundedSecondsBetween(window.startMs, window.endMs);
  if (durationSeconds <= 0) return null;
  const elapsedSeconds = boundedSecondsBetween(window.startMs, eventMs);
  const remainingSeconds = boundedSecondsBetween(eventMs, window.endMs);
  const elapsedRatio = elapsedSeconds / durationSeconds;
  const early = elapsedSeconds <= FOCUS_EDGE_SECONDS || elapsedRatio <= FOCUS_EDGE_RATIO;
  const late = remainingSeconds <= FOCUS_EDGE_SECONDS || elapsedRatio >= 1 - FOCUS_EDGE_RATIO;

  if (early && late) {
    return elapsedSeconds <= remainingSeconds ? "early" : "late";
  }
  if (early) return "early";
  if (late) return "late";
  return null;
}

function countBlockedBursts(blocked: readonly AdaptiveBlockEventInput[]): number {
  let bursts = 0;
  let windowStartIndex = 0;
  for (let index = 0; index < blocked.length; index += 1) {
    const currentMs = parseTimeMs(blocked[index].occurredAt);
    while (
      windowStartIndex < index &&
      currentMs - parseTimeMs(blocked[windowStartIndex].occurredAt) >
        BLOCK_BURST_WINDOW_SECONDS * 1000
    ) {
      windowStartIndex += 1;
    }
    if (index - windowStartIndex + 1 === BLOCK_BURST_MIN_ATTEMPTS) {
      bursts += 1;
      windowStartIndex = index + 1;
    }
  }
  return bursts;
}

function cleanSegmentSeconds(
  pauses: readonly AdaptivePauseInput[],
  actualStartMs: number,
  actualEndMs: number,
): number {
  const actualSeconds = boundedSecondsBetween(actualStartMs, actualEndMs);
  const pauseSeconds = pauses.reduce((total, pause) => {
    const pauseStartMs = Math.max(parseTimeMs(pause.startedAt), actualStartMs);
    const pauseEndMs = Math.min(
      pause.endedAt ? parseTimeMs(pause.endedAt) : actualEndMs,
      actualEndMs,
    );
    return total + boundedSecondsBetween(pauseStartMs, pauseEndMs);
  }, 0);
  return Math.max(0, actualSeconds - pauseSeconds);
}

function boundedSecondsBetween(startMs: number, endMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.ceil((endMs - startMs) / 1000));
}

function parseTimeMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addDataQualityFlag(totals: MutableFeatureTotals, flag: AdaptiveDataQualityFlag): void {
  if (!totals.dataQualityFlags.includes(flag)) totals.dataQualityFlags.push(flag);
}

function timeOfDayBucket(value: string): AdaptiveTimeOfDayBucket {
  const hour = new Date(value).getHours();
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 14) return "midday";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "late";
}

function sessionPosition(index: number): AdaptiveSessionPosition {
  if (index <= 1) return "first";
  if (index <= 3) return "middle";
  return "late";
}

function eventLengthBucket(minutes: number): AdaptiveEventLengthBucket {
  if (minutes < 60) return "short";
  if (minutes <= 150) return "medium";
  return "long";
}

function workloadBucket(cleanFocusMinutesToday: number): AdaptiveWorkloadBucket {
  if (cleanFocusMinutesToday < 90) return "low";
  if (cleanFocusMinutesToday <= 240) return "normal";
  return "high";
}

function energyBucket(energyLevel: number | null): AdaptiveEnergyBucket {
  if (energyLevel === null) return "unknown";
  if (energyLevel <= 2) return "low";
  if (energyLevel >= 4) return "high";
  return "normal";
}
