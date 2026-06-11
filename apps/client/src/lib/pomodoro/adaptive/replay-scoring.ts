import {
  LONG_BREAK_DRIFT_SECONDS,
  SHORT_BREAK_DRIFT_SECONDS,
} from "./constants";
import type { AdaptiveFeatureVector } from "./types";
import type {
  AdaptiveReplayCandidateObservedOutcomeScore,
  AdaptiveReplayJoinedOutcome,
  AdaptiveReplayObservedOutcome,
  AdaptiveReplayOutcomeAttribution,
  AdaptiveReplayOutcomeGuardrailReason,
  AdaptiveReplayOutcomeScore,
  AdaptiveReplayOutcomeScoreOptions,
  AdaptiveReplayRunStartResult,
} from "./replay-types";
import type { CountPomodoroRhythm } from "$lib/pomodoro/rhythm";

const CLEAN_FOCUS_LOSS_GUARDRAIL_SECONDS = 4 * 60;

interface MutableReplayOutcomeScore {
  attribution: AdaptiveReplayOutcomeAttribution;
  totalJoinedOutcomes: number;
  scoredOutcomeCount: number;
  matchedSelectedRhythmCount: number;
  mismatchedSelectedRhythmCount: number;
  unknownSelectedRhythmCount: number;
  completedFocusSegments: number;
  interruptedFocusSegments: number;
  focusFailureCount: number;
  stopCount: number;
  cleanFocusSeconds: number;
  plannedFocusSeconds: number;
  blockedAttemptCount: number;
  breakSkippedCount: number;
  shortBreakOvertimeSeconds: number;
  longBreakOvertimeSeconds: number;
  guardrailBreachCount: number;
  guardrailReasonCounts: Partial<Record<AdaptiveReplayOutcomeGuardrailReason, number>>;
}

export function joinReplayRunStartOutcomes(
  results: readonly AdaptiveReplayRunStartResult[],
  outcomes: readonly AdaptiveReplayObservedOutcome[],
): AdaptiveReplayJoinedOutcome[] {
  const outcomesByOpportunity = uniqueOutcomesByOpportunity(outcomes);
  const joined: AdaptiveReplayJoinedOutcome[] = [];
  for (const result of results) {
    const outcome = outcomesByOpportunity.get(result.opportunityId);
    if (!outcome) continue;
    joined.push({
      result,
      outcome,
      selectedRhythmMatchesObserved: outcome.observedRhythm
        ? countRhythmsEqual(result.decision.selectedRhythm, outcome.observedRhythm)
        : null,
      guardrailReasons: outcomeGuardrailReasons(outcome.features),
    });
  }
  return joined;
}

export function scoreReplayJoinedOutcomes(
  joinedOutcomes: readonly AdaptiveReplayJoinedOutcome[],
  options: AdaptiveReplayOutcomeScoreOptions = {},
): AdaptiveReplayOutcomeScore {
  const attribution = options.attribution ?? "all_observed";
  const totals = mutableOutcomeScore(attribution, joinedOutcomes.length);

  for (const joined of joinedOutcomes) {
    if (joined.selectedRhythmMatchesObserved === true) {
      totals.matchedSelectedRhythmCount += 1;
    } else if (joined.selectedRhythmMatchesObserved === false) {
      totals.mismatchedSelectedRhythmCount += 1;
    } else {
      totals.unknownSelectedRhythmCount += 1;
    }
    if (attribution === "selected_rhythm_match" && joined.selectedRhythmMatchesObserved !== true) {
      continue;
    }

    scoreReplayOutcomeFeatures(totals, joined.outcome.features);
  }

  return freezeOutcomeScore(totals);
}

export function scoreReplayObservedOutcomes(
  outcomes: readonly AdaptiveReplayObservedOutcome[],
): AdaptiveReplayOutcomeScore {
  const totals = mutableOutcomeScore("all_observed", outcomes.length);
  for (const outcome of outcomes) {
    totals.unknownSelectedRhythmCount += 1;
    scoreReplayOutcomeFeatures(totals, outcome.features);
  }
  return freezeOutcomeScore(totals);
}

export function scoreReplayObservedOutcomesByCandidate(
  outcomes: readonly AdaptiveReplayObservedOutcome[],
  candidateIdsByOpportunity: ReadonlyMap<string, string | null | undefined>,
): AdaptiveReplayCandidateObservedOutcomeScore[] {
  const outcomesByCandidate = new Map<string, AdaptiveReplayObservedOutcome[]>();
  const opportunityIdsByCandidate = new Map<string, string[]>();
  for (const outcome of outcomes) {
    const candidateId = candidateIdsByOpportunity.get(outcome.opportunityId);
    if (!candidateId) continue;
    const existingOutcomes = outcomesByCandidate.get(candidateId) ?? [];
    existingOutcomes.push(outcome);
    outcomesByCandidate.set(candidateId, existingOutcomes);
    const existingOpportunityIds = opportunityIdsByCandidate.get(candidateId) ?? [];
    existingOpportunityIds.push(outcome.opportunityId);
    opportunityIdsByCandidate.set(candidateId, existingOpportunityIds);
  }
  return [...outcomesByCandidate.entries()].map(([candidateId, candidateOutcomes]) => ({
    candidateId,
    opportunityIds: opportunityIdsByCandidate.get(candidateId) ?? [],
    outcomeScore: scoreReplayObservedOutcomes(candidateOutcomes),
  }));
}

export function compareReplayOutcomeScores(
  firstScore: AdaptiveReplayOutcomeScore,
  secondScore: AdaptiveReplayOutcomeScore,
): number {
  return compareAscending(firstScore.guardrailBreachRate, secondScore.guardrailBreachRate) ||
    compareDescending(firstScore.scoredOutcomeCount, secondScore.scoredOutcomeCount) ||
    compareDescending(firstScore.cleanFocusRatio, secondScore.cleanFocusRatio) ||
    compareDescending(firstScore.completionRate, secondScore.completionRate) ||
    compareAscending(firstScore.blockedAttemptsMean, secondScore.blockedAttemptsMean) ||
    compareAscending(firstScore.breakSkippedMean, secondScore.breakSkippedMean) ||
    compareAscending(firstScore.shortBreakOvertimeSecondsMean, secondScore.shortBreakOvertimeSecondsMean) ||
    compareAscending(firstScore.longBreakOvertimeSecondsMean, secondScore.longBreakOvertimeSecondsMean);
}

export function countRhythmsEqual(
  first: CountPomodoroRhythm,
  second: CountPomodoroRhythm,
): boolean {
  return first.focusDurationMinutes === second.focusDurationMinutes &&
    first.shortBreakMinutes === second.shortBreakMinutes &&
    first.longBreakMinutes === second.longBreakMinutes &&
    first.longBreakAfterFocusCount === second.longBreakAfterFocusCount;
}

export function incrementPartialCount<Key extends string>(
  counts: Partial<Record<Key, number>>,
  key: Key,
): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function incrementCount(
  counts: Record<string, number>,
  key: string,
): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function mutableOutcomeScore(
  attribution: AdaptiveReplayOutcomeAttribution,
  totalJoinedOutcomes: number,
): MutableReplayOutcomeScore {
  return {
    attribution,
    totalJoinedOutcomes,
    scoredOutcomeCount: 0,
    matchedSelectedRhythmCount: 0,
    mismatchedSelectedRhythmCount: 0,
    unknownSelectedRhythmCount: 0,
    completedFocusSegments: 0,
    interruptedFocusSegments: 0,
    focusFailureCount: 0,
    stopCount: 0,
    cleanFocusSeconds: 0,
    plannedFocusSeconds: 0,
    blockedAttemptCount: 0,
    breakSkippedCount: 0,
    shortBreakOvertimeSeconds: 0,
    longBreakOvertimeSeconds: 0,
    guardrailBreachCount: 0,
    guardrailReasonCounts: {},
  };
}

function scoreReplayOutcomeFeatures(
  totals: MutableReplayOutcomeScore,
  features: AdaptiveFeatureVector,
): void {
  totals.scoredOutcomeCount += 1;
  totals.completedFocusSegments += features.completedFocusSegments;
  totals.interruptedFocusSegments += features.interruptedFocusSegments;
  totals.focusFailureCount += features.focusFailureCount;
  totals.stopCount += features.stopCount;
  totals.cleanFocusSeconds += features.cleanFocusSeconds;
  totals.plannedFocusSeconds += features.plannedFocusSeconds;
  totals.blockedAttemptCount += features.blockedAttemptCount;
  totals.breakSkippedCount += features.breakSkippedCount;
  totals.shortBreakOvertimeSeconds += features.shortBreakOvertimeSeconds;
  totals.longBreakOvertimeSeconds += features.longBreakOvertimeSeconds;
  const guardrailReasons = outcomeGuardrailReasons(features);
  if (guardrailReasons.length > 0) {
    totals.guardrailBreachCount += 1;
    for (const reason of guardrailReasons) {
      incrementPartialCount(totals.guardrailReasonCounts, reason);
    }
  }
}

function freezeOutcomeScore(totals: MutableReplayOutcomeScore): AdaptiveReplayOutcomeScore {
  const completedAndInterruptedFocus =
    totals.completedFocusSegments + totals.interruptedFocusSegments;
  return {
    ...totals,
    completionRate: completedAndInterruptedFocus > 0
      ? totals.completedFocusSegments / completedAndInterruptedFocus
      : null,
    cleanFocusRatio: totals.plannedFocusSeconds > 0
      ? totals.cleanFocusSeconds / totals.plannedFocusSeconds
      : null,
    blockedAttemptsMean: totals.scoredOutcomeCount > 0
      ? totals.blockedAttemptCount / totals.scoredOutcomeCount
      : null,
    breakSkippedMean: totals.scoredOutcomeCount > 0
      ? totals.breakSkippedCount / totals.scoredOutcomeCount
      : null,
    shortBreakOvertimeSecondsMean: totals.scoredOutcomeCount > 0
      ? totals.shortBreakOvertimeSeconds / totals.scoredOutcomeCount
      : null,
    longBreakOvertimeSecondsMean: totals.scoredOutcomeCount > 0
      ? totals.longBreakOvertimeSeconds / totals.scoredOutcomeCount
      : null,
    guardrailBreachRate: totals.scoredOutcomeCount > 0
      ? totals.guardrailBreachCount / totals.scoredOutcomeCount
      : null,
  };
}

function uniqueOutcomesByOpportunity(
  outcomes: readonly AdaptiveReplayObservedOutcome[],
): Map<string, AdaptiveReplayObservedOutcome> {
  const byOpportunity = new Map<string, AdaptiveReplayObservedOutcome>();
  for (const outcome of outcomes) {
    if (byOpportunity.has(outcome.opportunityId)) {
      throw new Error(`Duplicate adaptive replay outcome for opportunity ${outcome.opportunityId}.`);
    }
    byOpportunity.set(outcome.opportunityId, outcome);
  }
  return byOpportunity;
}

function outcomeGuardrailReasons(
  features: AdaptiveFeatureVector,
): AdaptiveReplayOutcomeGuardrailReason[] {
  const reasons: AdaptiveReplayOutcomeGuardrailReason[] = [];
  if (features.focusFailureCount > 0) reasons.push("focus_failure");
  if (features.interruptedFocusSegments > 0) reasons.push("interrupted_focus");
  if (features.stopCount > 0) reasons.push("stopped_run");
  if (features.blockedAttemptCount > 0) reasons.push("blocked_attempts");
  if (features.breakSkippedCount > 0) reasons.push("skipped_break");
  if (features.shortBreakOvertimeSeconds >= SHORT_BREAK_DRIFT_SECONDS) {
    reasons.push("short_break_overtime");
  }
  if (features.longBreakOvertimeSeconds >= LONG_BREAK_DRIFT_SECONDS) {
    reasons.push("long_break_overtime");
  }
  if (
    features.plannedFocusSeconds > 0 &&
    features.cleanFocusSeconds < features.plannedFocusSeconds - CLEAN_FOCUS_LOSS_GUARDRAIL_SECONDS
  ) {
    reasons.push("clean_focus_loss");
  }
  return reasons;
}

function compareAscending(
  first: number | null,
  second: number | null,
): number {
  return nullableHigh(first) - nullableHigh(second);
}

function compareDescending(
  first: number | null,
  second: number | null,
): number {
  return nullableLow(second) - nullableLow(first);
}

function nullableHigh(value: number | null): number {
  return value ?? Number.POSITIVE_INFINITY;
}

function nullableLow(value: number | null): number {
  return value ?? Number.NEGATIVE_INFINITY;
}
