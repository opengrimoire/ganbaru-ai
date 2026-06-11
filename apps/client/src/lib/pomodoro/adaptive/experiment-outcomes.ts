import type { AdaptiveExperimentVariantOutcome } from "./experiment-types";

const CONTEXT_POOLING_PRIOR_RUNS_PER_VARIANT = 4;
const MIN_NEIGHBOR_CONTEXT_WEIGHT = 0.25;

export function variantOutcome(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  experimentId: string,
  variantKey: string,
  contextKey: string | null,
): AdaptiveExperimentVariantOutcome {
  const matched = outcomes.filter(
    (outcome) =>
      outcome.experimentId === experimentId &&
      outcome.variantKey === variantKey &&
      (contextKey === null || outcome.contextKey === contextKey),
  );
  if (matched.length > 0) {
    return matched.reduce<AdaptiveExperimentVariantOutcome>(
      (total, outcome) => sumVariantOutcomes(total, outcome, contextKey),
      emptyVariantOutcome(experimentId, variantKey, contextKey),
    );
  }
  return emptyVariantOutcome(experimentId, variantKey, contextKey);
}

export function pooledExperimentOutcomes(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey: string,
): AdaptiveExperimentVariantOutcome[] {
  return experimentVariantKeys(outcomes).map(({ experimentId, variantKey }) => {
    const contextOutcome = variantOutcome(outcomes, experimentId, variantKey, contextKey);
    const externalOutcome = variantOutcomeExcludingContext(outcomes, experimentId, variantKey, contextKey);
    return sumVariantOutcomes(
      contextOutcome,
      scaledVariantOutcome(
        externalOutcome,
        poolingPriorWeight(externalOutcome.runObservedCount),
      ),
      contextKey,
    );
  });
}

export function neighborPooledExperimentOutcomes(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey: string,
): AdaptiveExperimentVariantOutcome[] {
  return experimentVariantKeys(outcomes).map(({ experimentId, variantKey }) => {
    const contextOutcome = variantOutcome(outcomes, experimentId, variantKey, contextKey);
    const neighborOutcome = neighborVariantOutcome(outcomes, experimentId, variantKey, contextKey);
    return sumVariantOutcomes(
      contextOutcome,
      scaledVariantOutcome(
        neighborOutcome,
        poolingPriorWeight(neighborOutcome.runObservedCount),
      ),
      contextKey,
    );
  });
}

function emptyVariantOutcome(
  experimentId: string,
  variantKey: string,
  contextKey: string | null,
): AdaptiveExperimentVariantOutcome {
  return {
    experimentId,
    variantKey,
    contextKey,
    assignmentCount: 0,
    runObservedCount: 0,
    runCompletedCount: 0,
    runStoppedCount: 0,
    cleanFocusSecondsSum: 0,
    cleanFocusSecondsSquareSum: 0,
    blockedAttemptCountSum: 0,
    blockedAttemptCountSquareSum: 0,
    breakSkippedCountSum: 0,
    breakSkippedCountSquareSum: 0,
    shortBreakOvertimeSecondsSum: 0,
    shortBreakOvertimeSecondsSquareSum: 0,
    longBreakOvertimeSecondsSum: 0,
    longBreakOvertimeSecondsSquareSum: 0,
    dayObservedCount: 0,
    dayStartedPlannedPomodoroCountSum: 0,
    dayMissedPlannedPomodoroCountSum: 0,
    dayMissedPlannedPomodoroCountSquareSum: 0,
    dayCleanFocusSecondsSum: 0,
    dayBlockedAttemptCountSum: 0,
    dayBlockedAttemptCountSquareSum: 0,
    nextDayObservedCount: 0,
    nextDayStartedRunCount: 0,
    nextDayCleanFocusSecondsSum: 0,
    nextDayBlockedAttemptCountSum: 0,
  };
}

function experimentVariantKeys(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
): Array<{ experimentId: string; variantKey: string }> {
  const keys = new Map<string, { experimentId: string; variantKey: string }>();
  for (const outcome of outcomes) {
    const key = `${outcome.experimentId}:${outcome.variantKey}`;
    if (keys.has(key)) continue;
    keys.set(key, {
      experimentId: outcome.experimentId,
      variantKey: outcome.variantKey,
    });
  }
  return [...keys.values()];
}

function variantOutcomeExcludingContext(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  experimentId: string,
  variantKey: string,
  contextKey: string,
): AdaptiveExperimentVariantOutcome {
  const matching = outcomes.filter((outcome) =>
    outcome.experimentId === experimentId &&
    outcome.variantKey === variantKey &&
    outcome.contextKey !== contextKey
  );
  if (matching.length > 0) {
    return matching.reduce(
      (total, outcome) => sumVariantOutcomes(total, outcome, null),
      emptyVariantOutcome(experimentId, variantKey, null),
    );
  }
  return emptyVariantOutcome(experimentId, variantKey, null);
}

function neighborVariantOutcome(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  experimentId: string,
  variantKey: string,
  contextKey: string,
): AdaptiveExperimentVariantOutcome {
  const matching = outcomes
    .filter((outcome) =>
      outcome.experimentId === experimentId &&
      outcome.variantKey === variantKey &&
      outcome.contextKey !== null &&
      outcome.contextKey !== contextKey
    )
    .map((outcome) => ({
      outcome,
      weight: neighborContextWeight(contextKey, outcome.contextKey ?? ""),
    }))
    .filter(({ weight }) => weight >= MIN_NEIGHBOR_CONTEXT_WEIGHT);
  if (matching.length === 0) {
    return emptyVariantOutcome(experimentId, variantKey, null);
  }
  return matching.reduce(
    (total, { outcome, weight }) => sumVariantOutcomes(
      total,
      scaledVariantOutcome(outcome, weight),
      null,
    ),
    emptyVariantOutcome(experimentId, variantKey, null),
  );
}

function scaledVariantOutcome(
  outcome: AdaptiveExperimentVariantOutcome,
  weight: number,
): AdaptiveExperimentVariantOutcome {
  if (weight <= 0) {
    return emptyVariantOutcome(outcome.experimentId, outcome.variantKey, outcome.contextKey);
  }
  return {
    ...outcome,
    assignmentCount: outcome.assignmentCount * weight,
    runObservedCount: outcome.runObservedCount * weight,
    runCompletedCount: outcome.runCompletedCount * weight,
    runStoppedCount: outcome.runStoppedCount * weight,
    cleanFocusSecondsSum: outcome.cleanFocusSecondsSum * weight,
    cleanFocusSecondsSquareSum: outcome.cleanFocusSecondsSquareSum * weight,
    blockedAttemptCountSum: outcome.blockedAttemptCountSum * weight,
    blockedAttemptCountSquareSum: outcome.blockedAttemptCountSquareSum * weight,
    breakSkippedCountSum: outcome.breakSkippedCountSum * weight,
    breakSkippedCountSquareSum: outcome.breakSkippedCountSquareSum * weight,
    shortBreakOvertimeSecondsSum: outcome.shortBreakOvertimeSecondsSum * weight,
    shortBreakOvertimeSecondsSquareSum: outcome.shortBreakOvertimeSecondsSquareSum * weight,
    longBreakOvertimeSecondsSum: outcome.longBreakOvertimeSecondsSum * weight,
    longBreakOvertimeSecondsSquareSum: outcome.longBreakOvertimeSecondsSquareSum * weight,
    dayObservedCount: outcome.dayObservedCount * weight,
    dayStartedPlannedPomodoroCountSum: outcome.dayStartedPlannedPomodoroCountSum * weight,
    dayMissedPlannedPomodoroCountSum: outcome.dayMissedPlannedPomodoroCountSum * weight,
    dayMissedPlannedPomodoroCountSquareSum:
      outcome.dayMissedPlannedPomodoroCountSquareSum * weight,
    dayCleanFocusSecondsSum: outcome.dayCleanFocusSecondsSum * weight,
    dayBlockedAttemptCountSum: outcome.dayBlockedAttemptCountSum * weight,
    dayBlockedAttemptCountSquareSum: outcome.dayBlockedAttemptCountSquareSum * weight,
    nextDayObservedCount: outcome.nextDayObservedCount * weight,
    nextDayStartedRunCount: outcome.nextDayStartedRunCount * weight,
    nextDayCleanFocusSecondsSum: outcome.nextDayCleanFocusSecondsSum * weight,
    nextDayBlockedAttemptCountSum: outcome.nextDayBlockedAttemptCountSum * weight,
  };
}

function poolingPriorWeight(runObservedCount: number): number {
  if (runObservedCount <= 0) return 0;
  return Math.min(1, CONTEXT_POOLING_PRIOR_RUNS_PER_VARIANT / runObservedCount);
}

interface ParsedExperimentContextKey {
  timeOfDay: string;
  sessionPosition: string;
  eventLength: string;
  workload: string;
  energy: string;
  environmentId: string;
}

function neighborContextWeight(
  targetKey: string,
  candidateKey: string,
): number {
  const target = parseExperimentContextKey(targetKey);
  const candidate = parseExperimentContextKey(candidateKey);
  if (!target || !candidate) return 0;
  if (target.environmentId !== candidate.environmentId) return 0;
  return ordinalBucketWeight(
    target.timeOfDay,
    candidate.timeOfDay,
    ["morning", "midday", "afternoon", "evening", "late"],
  ) *
    ordinalBucketWeight(
      target.sessionPosition,
      candidate.sessionPosition,
      ["first", "middle", "late"],
    ) *
    ordinalBucketWeight(
      target.eventLength,
      candidate.eventLength,
      ["short", "medium", "long"],
    ) *
    ordinalBucketWeight(
      target.workload,
      candidate.workload,
      ["low", "normal", "high"],
    ) *
    energyBucketWeight(target.energy, candidate.energy);
}

function parseExperimentContextKey(
  key: string,
): ParsedExperimentContextKey | null {
  const [
    timeOfDay,
    sessionPosition,
    eventLength,
    workload,
    energy,
    environmentId,
  ] = key.split(":");
  if (
    !timeOfDay ||
    !sessionPosition ||
    !eventLength ||
    !workload ||
    !energy ||
    !environmentId
  ) {
    return null;
  }
  return {
    timeOfDay,
    sessionPosition,
    eventLength,
    workload,
    energy,
    environmentId,
  };
}

function ordinalBucketWeight(
  target: string,
  candidate: string,
  orderedBuckets: readonly string[],
): number {
  if (target === candidate) return 1;
  const targetIndex = orderedBuckets.indexOf(target);
  const candidateIndex = orderedBuckets.indexOf(candidate);
  if (targetIndex < 0 || candidateIndex < 0) return 0;
  return Math.abs(targetIndex - candidateIndex) === 1 ? 0.6 : 0;
}

function energyBucketWeight(
  target: string,
  candidate: string,
): number {
  if (target === candidate) return 1;
  if (target === "unknown" || candidate === "unknown") return 0.8;
  return ordinalBucketWeight(target, candidate, ["low", "normal", "high"]);
}

function sumVariantOutcomes(
  first: AdaptiveExperimentVariantOutcome,
  second: AdaptiveExperimentVariantOutcome,
  contextKey: string | null,
): AdaptiveExperimentVariantOutcome {
  return {
    experimentId: first.experimentId,
    variantKey: first.variantKey,
    contextKey,
    assignmentCount: first.assignmentCount + second.assignmentCount,
    runObservedCount: first.runObservedCount + second.runObservedCount,
    runCompletedCount: first.runCompletedCount + second.runCompletedCount,
    runStoppedCount: first.runStoppedCount + second.runStoppedCount,
    cleanFocusSecondsSum: first.cleanFocusSecondsSum + second.cleanFocusSecondsSum,
    cleanFocusSecondsSquareSum:
      first.cleanFocusSecondsSquareSum + second.cleanFocusSecondsSquareSum,
    blockedAttemptCountSum: first.blockedAttemptCountSum + second.blockedAttemptCountSum,
    blockedAttemptCountSquareSum:
      first.blockedAttemptCountSquareSum + second.blockedAttemptCountSquareSum,
    breakSkippedCountSum: first.breakSkippedCountSum + second.breakSkippedCountSum,
    breakSkippedCountSquareSum:
      first.breakSkippedCountSquareSum + second.breakSkippedCountSquareSum,
    shortBreakOvertimeSecondsSum:
      first.shortBreakOvertimeSecondsSum + second.shortBreakOvertimeSecondsSum,
    shortBreakOvertimeSecondsSquareSum:
      first.shortBreakOvertimeSecondsSquareSum + second.shortBreakOvertimeSecondsSquareSum,
    longBreakOvertimeSecondsSum:
      first.longBreakOvertimeSecondsSum + second.longBreakOvertimeSecondsSum,
    longBreakOvertimeSecondsSquareSum:
      first.longBreakOvertimeSecondsSquareSum + second.longBreakOvertimeSecondsSquareSum,
    dayObservedCount: first.dayObservedCount + second.dayObservedCount,
    dayStartedPlannedPomodoroCountSum:
      first.dayStartedPlannedPomodoroCountSum + second.dayStartedPlannedPomodoroCountSum,
    dayMissedPlannedPomodoroCountSum:
      first.dayMissedPlannedPomodoroCountSum + second.dayMissedPlannedPomodoroCountSum,
    dayMissedPlannedPomodoroCountSquareSum:
      first.dayMissedPlannedPomodoroCountSquareSum +
      second.dayMissedPlannedPomodoroCountSquareSum,
    dayCleanFocusSecondsSum: first.dayCleanFocusSecondsSum + second.dayCleanFocusSecondsSum,
    dayBlockedAttemptCountSum: first.dayBlockedAttemptCountSum + second.dayBlockedAttemptCountSum,
    dayBlockedAttemptCountSquareSum:
      first.dayBlockedAttemptCountSquareSum + second.dayBlockedAttemptCountSquareSum,
    nextDayObservedCount: first.nextDayObservedCount + second.nextDayObservedCount,
    nextDayStartedRunCount: first.nextDayStartedRunCount + second.nextDayStartedRunCount,
    nextDayCleanFocusSecondsSum:
      first.nextDayCleanFocusSecondsSum + second.nextDayCleanFocusSecondsSum,
    nextDayBlockedAttemptCountSum:
      first.nextDayBlockedAttemptCountSum + second.nextDayBlockedAttemptCountSum,
  };
}
