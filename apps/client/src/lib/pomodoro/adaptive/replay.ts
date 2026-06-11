import {
  adaptiveContextKey,
  decideRunStartAdaptiveRhythm,
  type PomodoroRunStartAdaptiveDecision,
} from "./persistence";
import {
  MAX_ADAPTIVE_FOCUS_MINUTES,
  MAX_ADAPTIVE_LONG_BREAK_CADENCE,
  MAX_ADAPTIVE_LONG_BREAK_MINUTES,
  MAX_ADAPTIVE_SHORT_BREAK_MINUTES,
  MIN_ADAPTIVE_FOCUS_MINUTES,
  MIN_ADAPTIVE_LONG_BREAK_CADENCE,
  MIN_ADAPTIVE_LONG_BREAK_MINUTES,
  MIN_ADAPTIVE_SHORT_BREAK_MINUTES,
} from "./constants";
import {
  compareReplayOutcomeScores,
  countRhythmsEqual,
  incrementCount,
  incrementPartialCount,
  joinReplayRunStartOutcomes,
  scoreReplayJoinedOutcomes,
} from "./replay-scoring";
import type {
  AdaptiveDecisionMode,
  AdaptiveParameterKey,
  AdaptiveReasonCode,
} from "./types";
import type { CountPomodoroRhythm } from "$lib/pomodoro/rhythm";
import {
  DEFAULT_BOUNDED_REPLAY_RUN_START_POLICY_CANDIDATE_INPUTS,
  type AdaptiveReplayBoundedRunStartPolicyCandidateInput,
  type AdaptiveReplayCandidateObservedOutcomeGate,
  type AdaptiveReplayCandidateObservedOutcomeGateReason,
  type AdaptiveReplayContextPolicyGate,
  type AdaptiveReplayContextReport,
  type AdaptiveReplayObservedOutcome,
  type AdaptiveReplayOutcomeScore,
  type AdaptiveReplayPolicyCandidateInteraction,
  type AdaptiveReplayPolicyCandidateReview,
  type AdaptiveReplayPolicyCandidateStatus,
  type AdaptiveReplayPolicyCandidateWorkflow,
  type AdaptiveReplayPolicyEvaluation,
  type AdaptiveReplayPolicyGateEvaluation,
  type AdaptiveReplayPolicyGateOptions,
  type AdaptiveReplayPolicyGateReason,
  type AdaptiveReplayPolicyGateStatus,
  type AdaptiveReplayPolicyInteractionReason,
  type AdaptiveReplayPolicyInteractionStatus,
  type AdaptiveReplayRunStartOpportunity,
  type AdaptiveReplayRunStartPolicyCandidate,
  type AdaptiveReplayRunStartResult,
  type AdaptiveReplaySummary,
} from "./replay-types";

export * from "./replay-types";
export {
  joinReplayRunStartOutcomes,
  scoreReplayJoinedOutcomes,
  scoreReplayObservedOutcomes,
  scoreReplayObservedOutcomesByCandidate,
} from "./replay-scoring";

interface IndexedReplayPolicyCandidateReview {
  review: AdaptiveReplayPolicyCandidateReview;
  index: number;
}

const DEFAULT_MIN_MATCHED_OUTCOMES_PER_CONTEXT = 4;
const DEFAULT_MAX_GUARDRAIL_BREACH_RATE = 0.25;
const DEFAULT_MIN_OBSERVED_CANDIDATE_OUTCOMES = 4;
const DEFAULT_MAX_OBSERVED_CANDIDATE_GUARDRAIL_BREACH_RATE = 0.25;
const DEFAULT_MIN_INTERACTION_MATCHED_OUTCOMES = 4;
const DEFAULT_MAX_INTERACTION_GUARDRAIL_BREACH_RATE_INCREASE = 0.15;
const DEFAULT_MAX_INTERACTION_CLEAN_FOCUS_RATIO_DROP = 0.1;
const DEFAULT_MAX_INTERACTION_COMPLETION_RATE_DROP = 0.1;
const DEFAULT_BOUNDED_CANDIDATE_DECISION_MODES: readonly AdaptiveDecisionMode[] = [
  "hold",
  "exploit",
  "explore",
];

/**
 * Builds a bounded offline run-start policy candidate for multi-parameter replay.
 */
export function buildBoundedReplayRunStartPolicyCandidate(
  input: AdaptiveReplayBoundedRunStartPolicyCandidateInput,
): AdaptiveReplayRunStartPolicyCandidate {
  return buildBoundedReplayRunStartPolicyCandidateFromInput(input, true);
}

function buildBoundedReplayRunStartPolicyCandidateFromInput(
  input: AdaptiveReplayBoundedRunStartPolicyCandidateInput,
  includeComponents: boolean,
): AdaptiveReplayRunStartPolicyCandidate {
  const allowedDecisionModes = new Set(
    input.allowedDecisionModes ?? DEFAULT_BOUNDED_CANDIDATE_DECISION_MODES,
  );
  const parameterKeys = boundedCandidateParameterKeys(input);

  return {
    id: input.id,
    parameterKeys,
    componentCandidates: includeComponents && parameterKeys.length > 1
      ? parameterKeys.map((parameterKey) =>
          buildBoundedReplayRunStartPolicyCandidateFromInput(
            boundedCandidateComponentInput(input, parameterKey),
            false,
          )
        )
      : [],
    decide: (opportunity) => {
      const decision = decideRunStartAdaptiveRhythm(opportunity);
      if (!allowedDecisionModes.has(decision.decisionMode)) return decision;

      const selectedRhythm = adjustBoundedCandidateRhythm(decision.selectedRhythm, input);
      if (countRhythmsEqual(selectedRhythm, decision.selectedRhythm)) return decision;

      return {
        ...decision,
        selectedRhythm,
        decisionMode: "explore",
        reasonCodes: replayCandidateReasonCodes(decision.reasonCodes),
        candidateId: input.id,
        experimentUpdate: null,
        experimentAssignment: null,
      };
    },
  };
}

/**
 * Builds the default bounded offline candidates for multi-parameter replay.
 */
export function buildDefaultBoundedReplayRunStartPolicyCandidates(): AdaptiveReplayRunStartPolicyCandidate[] {
  return DEFAULT_BOUNDED_REPLAY_RUN_START_POLICY_CANDIDATE_INPUTS.map((input) =>
    buildBoundedReplayRunStartPolicyCandidate(input),
  );
}

/**
 * Replays run-start opportunities through the current local adaptive policy.
 */
export function replayRunStartAdaptiveDecisions(
  opportunities: readonly AdaptiveReplayRunStartOpportunity[],
): AdaptiveReplayRunStartResult[] {
  return opportunities.map((opportunity) => {
    const decision = decideRunStartAdaptiveRhythm(opportunity);
    const result = {
      opportunityId: opportunity.id,
      decision,
    };
    return opportunity.label ? { ...result, label: opportunity.label } : result;
  });
}

/**
 * Summarizes replayed decisions for offline policy checks and diagnostics.
 */
export function summarizeReplayRunStartResults(
  results: readonly AdaptiveReplayRunStartResult[],
): AdaptiveReplaySummary {
  const decisionModeCounts: Partial<Record<AdaptiveDecisionMode, number>> = {};
  const reasonCodeCounts: Partial<Record<AdaptiveReasonCode, number>> = {};
  const experimentAssignmentCounts: Record<string, number> = {};
  const changedValueCounts: Partial<Record<AdaptiveParameterKey, number>> = {};

  for (const result of results) {
    const { decision } = result;
    incrementPartialCount(decisionModeCounts, decision.decisionMode);
    for (const reasonCode of decision.reasonCodes) {
      incrementPartialCount(reasonCodeCounts, reasonCode);
    }
    if (decision.experimentAssignment) {
      incrementCount(experimentAssignmentCounts, decision.experimentAssignment.experiment.id);
    }
    for (const valueKey of changedAdaptiveValueKeys(decision)) {
      incrementPartialCount(changedValueCounts, valueKey);
    }
  }

  return {
    totalOpportunities: results.length,
    decisionModeCounts,
    reasonCodeCounts,
    experimentAssignmentCounts,
    changedValueCounts,
  };
}

/**
 * Replays the same opportunities through one or more local policy candidates.
 */
export function evaluateReplayRunStartPolicyCandidates(
  opportunities: readonly AdaptiveReplayRunStartOpportunity[],
  candidates: readonly AdaptiveReplayRunStartPolicyCandidate[],
  outcomes: readonly AdaptiveReplayObservedOutcome[] = [],
): AdaptiveReplayPolicyEvaluation[] {
  return candidates.map((candidate) => {
    const results = replayRunStartPolicyCandidate(opportunities, candidate);
    const joinedOutcomes = joinReplayRunStartOutcomes(results, outcomes);
    return {
      candidateId: candidate.id,
      results,
      summary: summarizeReplayRunStartResults(results),
      outcomeScore: scoreReplayJoinedOutcomes(joinedOutcomes, {
        attribution: "selected_rhythm_match",
      }),
    };
  });
}

/**
 * Replays policy candidates and reports their observed burden per comparable context.
 */
export function evaluateReplayRunStartPolicyCandidatesByContext(
  opportunities: readonly AdaptiveReplayRunStartOpportunity[],
  candidates: readonly AdaptiveReplayRunStartPolicyCandidate[],
  outcomes: readonly AdaptiveReplayObservedOutcome[] = [],
): AdaptiveReplayContextReport[] {
  const resultsByContextAndCandidate = new Map<string, Map<string, AdaptiveReplayRunStartResult[]>>();
  const contextOrder: string[] = [];

  for (const candidate of candidates) {
    const results = replayRunStartPolicyCandidate(opportunities, candidate);
    for (const result of results) {
      const contextKey = adaptiveContextKey(result.decision.context);
      let resultsByCandidate = resultsByContextAndCandidate.get(contextKey);
      if (!resultsByCandidate) {
        resultsByCandidate = new Map();
        resultsByContextAndCandidate.set(contextKey, resultsByCandidate);
        contextOrder.push(contextKey);
      }
      const existing = resultsByCandidate.get(candidate.id) ?? [];
      existing.push(result);
      resultsByCandidate.set(candidate.id, existing);
    }
  }

  return contextOrder.map((contextKey) => {
    const resultsByCandidate = resultsByContextAndCandidate.get(contextKey) ?? new Map();
    return {
      contextKey,
      evaluations: candidates.map((candidate) => {
        const results = resultsByCandidate.get(candidate.id) ?? [];
        const joinedOutcomes = joinReplayRunStartOutcomes(results, outcomes);
        return {
          candidateId: candidate.id,
          contextKey,
          results,
          summary: summarizeReplayRunStartResults(results),
          outcomeScore: scoreReplayJoinedOutcomes(joinedOutcomes, {
            attribution: "selected_rhythm_match",
          }),
        };
      }),
    };
  });
}

/**
 * Evaluates whether multi-parameter candidates perform better than their component moves.
 */
export function evaluateReplayRunStartPolicyCandidateInteractions(
  opportunities: readonly AdaptiveReplayRunStartOpportunity[],
  candidates: readonly AdaptiveReplayRunStartPolicyCandidate[],
  outcomes: readonly AdaptiveReplayObservedOutcome[] = [],
  options: AdaptiveReplayPolicyGateOptions = {},
): AdaptiveReplayPolicyCandidateInteraction[] {
  return candidates.flatMap((candidate) => {
    const parameterKeys = [...(candidate.parameterKeys ?? [])];
    const componentCandidates = candidate.componentCandidates ?? [];
    if (parameterKeys.length < 2 || componentCandidates.length === 0) return [];

    const [combinedEvaluation] = evaluateReplayRunStartPolicyCandidates(
      opportunities,
      [candidate],
      outcomes,
    );
    if (!combinedEvaluation) return [];
    const componentEvaluations = evaluateReplayRunStartPolicyCandidates(
      opportunities,
      componentCandidates,
      outcomes,
    );
    return [
      evaluateReplayPolicyCandidateInteraction(
        candidate.id,
        parameterKeys,
        combinedEvaluation,
        componentEvaluations,
        options,
      ),
    ];
  });
}

/**
 * Applies conservative offline gates to per-context replay evaluations.
 */
export function gateReplayContextReports(
  reports: readonly AdaptiveReplayContextReport[],
  options: AdaptiveReplayPolicyGateOptions = {},
): AdaptiveReplayPolicyGateEvaluation[] {
  const minMatchedOutcomesPerContext = Math.max(
    1,
    Math.round(options.minMatchedOutcomesPerContext ?? DEFAULT_MIN_MATCHED_OUTCOMES_PER_CONTEXT),
  );
  const maxGuardrailBreachRate = clampRatio(
    options.maxGuardrailBreachRate ?? DEFAULT_MAX_GUARDRAIL_BREACH_RATE,
  );
  const candidateIds = replayContextReportCandidateIds(reports);

  return candidateIds.map((candidateId) => {
    const contextGates = reports.map((report) => {
      const evaluation = report.evaluations.find((entry) => entry.candidateId === candidateId);
      return gateReplayContextPolicyEvaluation(
        candidateId,
        report.contextKey,
        evaluation?.outcomeScore ?? null,
        minMatchedOutcomesPerContext,
        maxGuardrailBreachRate,
      );
    });
    const reasons = dedupeGateReasons(contextGates.flatMap((gate) => gate.reasons));
    return {
      candidateId,
      status: aggregatePolicyGateStatus(contextGates),
      reasons,
      contextGates,
    };
  });
}

/**
 * Evaluates candidates, context burden, and conservative replay gates in one pass.
 */
export function evaluateGatedReplayRunStartPolicyCandidates(
  opportunities: readonly AdaptiveReplayRunStartOpportunity[],
  candidates: readonly AdaptiveReplayRunStartPolicyCandidate[],
  outcomes: readonly AdaptiveReplayObservedOutcome[] = [],
  gateOptions: AdaptiveReplayPolicyGateOptions = {},
): AdaptiveReplayPolicyCandidateWorkflow {
  const evaluations = evaluateReplayRunStartPolicyCandidates(opportunities, candidates, outcomes);
  const contextReports = evaluateReplayRunStartPolicyCandidatesByContext(opportunities, candidates, outcomes);
  const gates = gateReplayContextReports(contextReports, gateOptions);
  const observedOutcomeGates = gateObservedCandidateOutcomes(candidates, gateOptions);
  const interactions = evaluateReplayRunStartPolicyCandidateInteractions(
    opportunities,
    candidates,
    outcomes,
    gateOptions,
  );
  const evaluationsByCandidate = new Map(evaluations.map((evaluation) => [evaluation.candidateId, evaluation]));
  const gatesByCandidate = new Map(gates.map((gate) => [gate.candidateId, gate]));
  const observedOutcomeGatesByCandidate = new Map(
    observedOutcomeGates.map((gate) => [gate.candidateId, gate]),
  );
  const interactionsByCandidate = new Map(
    interactions.map((interaction) => [interaction.candidateId, interaction]),
  );
  const reviews = candidates.map((candidate) => {
    const evaluation = evaluationsByCandidate.get(candidate.id);
    const gate = gatesByCandidate.get(candidate.id);
    const observedOutcomeGate = observedOutcomeGatesByCandidate.get(candidate.id);
    const interaction = interactionsByCandidate.get(candidate.id) ?? null;
    if (!evaluation || !gate || !observedOutcomeGate) {
      throw new Error(`Missing gated replay evaluation for candidate ${candidate.id}.`);
    }
    return {
      candidateId: candidate.id,
      status: candidateStatusFromGates(gate.status, observedOutcomeGate.status, interaction),
      evaluation,
      gate,
      observedOutcomeGate,
      interaction,
    };
  });

  return {
    evaluations,
    contextReports,
    gates,
    observedOutcomeGates,
    interactions,
    reviews,
    usableCandidateIds: reviews
      .filter((review) => review.status === "usable")
      .map((review) => review.candidateId),
    unsafeCandidateIds: reviews
      .filter((review) => review.status === "unsafe")
      .map((review) => review.candidateId),
    inconclusiveCandidateIds: reviews
      .filter((review) => review.status === "inconclusive")
      .map((review) => review.candidateId),
  };
}

/**
 * Evaluates the default bounded offline candidates through the gated replay workflow.
 */
export function evaluateDefaultBoundedReplayRunStartPolicyCandidates(
  opportunities: readonly AdaptiveReplayRunStartOpportunity[],
  outcomes: readonly AdaptiveReplayObservedOutcome[] = [],
  gateOptions: AdaptiveReplayPolicyGateOptions = {},
): AdaptiveReplayPolicyCandidateWorkflow {
  return evaluateGatedReplayRunStartPolicyCandidates(
    opportunities,
    buildDefaultBoundedReplayRunStartPolicyCandidates(),
    outcomes,
    gateOptions,
  );
}

/**
 * Selects the strongest usable candidate from a gated replay workflow.
 */
export function selectBestUsableReplayRunStartPolicyCandidate(
  workflow: AdaptiveReplayPolicyCandidateWorkflow,
): AdaptiveReplayPolicyCandidateReview | null {
  return selectBestUsableReplayReview(workflow.reviews);
}

/**
 * Selects the strongest usable candidate that passed gates for one context.
 */
export function selectBestUsableReplayRunStartPolicyCandidateForContext(
  workflow: AdaptiveReplayPolicyCandidateWorkflow,
  contextKey: string,
): AdaptiveReplayPolicyCandidateReview | null {
  return selectBestUsableReplayReview(
    workflow.reviews.filter((review) =>
      review.gate.contextGates.some((gate) =>
        gate.contextKey === contextKey && gate.status === "pass",
      ),
    ),
  );
}

function replayRunStartPolicyCandidate(
  opportunities: readonly AdaptiveReplayRunStartOpportunity[],
  candidate: AdaptiveReplayRunStartPolicyCandidate,
): AdaptiveReplayRunStartResult[] {
  return opportunities.map((opportunity) => {
    const decision = candidate.decide(opportunity);
    const result = {
      opportunityId: opportunity.id,
      decision,
    };
    return opportunity.label ? { ...result, label: opportunity.label } : result;
  });
}

function adjustBoundedCandidateRhythm(
  rhythm: CountPomodoroRhythm,
  input: AdaptiveReplayBoundedRunStartPolicyCandidateInput,
): CountPomodoroRhythm {
  return {
    kind: "count",
    focusDurationMinutes: adjustedBoundedInteger(
      rhythm.focusDurationMinutes,
      input.focusDurationMinutes,
      input.focusDurationDeltaMinutes,
      MIN_ADAPTIVE_FOCUS_MINUTES,
      MAX_ADAPTIVE_FOCUS_MINUTES,
    ),
    shortBreakMinutes: adjustedBoundedInteger(
      rhythm.shortBreakMinutes,
      input.shortBreakMinutes,
      input.shortBreakDeltaMinutes,
      MIN_ADAPTIVE_SHORT_BREAK_MINUTES,
      MAX_ADAPTIVE_SHORT_BREAK_MINUTES,
    ),
    longBreakMinutes: adjustedBoundedInteger(
      rhythm.longBreakMinutes,
      input.longBreakMinutes,
      input.longBreakDeltaMinutes,
      MIN_ADAPTIVE_LONG_BREAK_MINUTES,
      MAX_ADAPTIVE_LONG_BREAK_MINUTES,
    ),
    longBreakAfterFocusCount: adjustedBoundedInteger(
      rhythm.longBreakAfterFocusCount,
      input.longBreakAfterFocusCount,
      input.longBreakAfterFocusCountDelta,
      MIN_ADAPTIVE_LONG_BREAK_CADENCE,
      MAX_ADAPTIVE_LONG_BREAK_CADENCE,
    ),
  };
}

function boundedCandidateParameterKeys(
  input: AdaptiveReplayBoundedRunStartPolicyCandidateInput,
): AdaptiveParameterKey[] {
  const keys: AdaptiveParameterKey[] = [];
  if (candidateAdjustsValue(input.focusDurationMinutes, input.focusDurationDeltaMinutes)) {
    keys.push("focus_duration_minutes");
  }
  if (candidateAdjustsValue(input.shortBreakMinutes, input.shortBreakDeltaMinutes)) {
    keys.push("short_break_minutes");
  }
  if (candidateAdjustsValue(input.longBreakMinutes, input.longBreakDeltaMinutes)) {
    keys.push("long_break_minutes");
  }
  if (candidateAdjustsValue(input.longBreakAfterFocusCount, input.longBreakAfterFocusCountDelta)) {
    keys.push("long_break_after_focus_count");
  }
  return keys;
}

function candidateAdjustsValue(
  exactValue: number | undefined,
  deltaValue: number | undefined,
): boolean {
  if (typeof exactValue === "number" && Number.isFinite(exactValue)) return true;
  return typeof deltaValue === "number" && Number.isFinite(deltaValue) && deltaValue !== 0;
}

function boundedCandidateComponentInput(
  input: AdaptiveReplayBoundedRunStartPolicyCandidateInput,
  parameterKey: AdaptiveParameterKey,
): AdaptiveReplayBoundedRunStartPolicyCandidateInput {
  const componentInput: AdaptiveReplayBoundedRunStartPolicyCandidateInput = {
    id: `${input.id}:${parameterKey}`,
    allowedDecisionModes: input.allowedDecisionModes,
  };
  switch (parameterKey) {
    case "focus_duration_minutes":
      return {
        ...componentInput,
        focusDurationMinutes: input.focusDurationMinutes,
        focusDurationDeltaMinutes: input.focusDurationDeltaMinutes,
      };
    case "short_break_minutes":
      return {
        ...componentInput,
        shortBreakMinutes: input.shortBreakMinutes,
        shortBreakDeltaMinutes: input.shortBreakDeltaMinutes,
      };
    case "long_break_minutes":
      return {
        ...componentInput,
        longBreakMinutes: input.longBreakMinutes,
        longBreakDeltaMinutes: input.longBreakDeltaMinutes,
      };
    case "long_break_after_focus_count":
      return {
        ...componentInput,
        longBreakAfterFocusCount: input.longBreakAfterFocusCount,
        longBreakAfterFocusCountDelta: input.longBreakAfterFocusCountDelta,
      };
  }
}

function adjustedBoundedInteger(
  currentValue: number,
  exactValue: number | undefined,
  deltaValue: number | undefined,
  min: number,
  max: number,
): number {
  const hasExactValue = typeof exactValue === "number" && Number.isFinite(exactValue);
  const hasDeltaValue = typeof deltaValue === "number" && Number.isFinite(deltaValue);
  const rawValue = hasExactValue
    ? exactValue
    : currentValue + (hasDeltaValue ? deltaValue : 0);
  return Math.max(min, Math.min(max, Math.round(rawValue)));
}

function replayCandidateReasonCodes(
  reasonCodes: readonly AdaptiveReasonCode[],
): AdaptiveReasonCode[] {
  const nextReasonCodes = reasonCodes.filter((reasonCode) => reasonCode !== "hold_current_rhythm");
  if (!nextReasonCodes.includes("replay_candidate")) {
    nextReasonCodes.push("replay_candidate");
  }
  return nextReasonCodes;
}

function changedAdaptiveValueKeys(
  decision: PomodoroRunStartAdaptiveDecision,
): AdaptiveParameterKey[] {
  const changed: AdaptiveParameterKey[] = [];
  if (decision.currentRhythm.focusDurationMinutes !== decision.selectedRhythm.focusDurationMinutes) {
    changed.push("focus_duration_minutes");
  }
  if (decision.currentRhythm.shortBreakMinutes !== decision.selectedRhythm.shortBreakMinutes) {
    changed.push("short_break_minutes");
  }
  if (decision.currentRhythm.longBreakMinutes !== decision.selectedRhythm.longBreakMinutes) {
    changed.push("long_break_minutes");
  }
  if (decision.currentRhythm.longBreakAfterFocusCount !== decision.selectedRhythm.longBreakAfterFocusCount) {
    changed.push("long_break_after_focus_count");
  }
  return changed;
}

function gateReplayContextPolicyEvaluation(
  candidateId: string,
  contextKey: string,
  outcomeScore: AdaptiveReplayOutcomeScore | null,
  minMatchedOutcomesPerContext: number,
  maxGuardrailBreachRate: number,
): AdaptiveReplayContextPolicyGate {
  const scoredOutcomeCount = outcomeScore?.scoredOutcomeCount ?? 0;
  const guardrailBreachRate = outcomeScore?.guardrailBreachRate ?? null;
  const reasons: AdaptiveReplayPolicyGateReason[] = [];
  if (scoredOutcomeCount < minMatchedOutcomesPerContext) {
    reasons.push("insufficient_matched_outcomes");
  }
  if (
    guardrailBreachRate !== null &&
    scoredOutcomeCount >= minMatchedOutcomesPerContext &&
    guardrailBreachRate > maxGuardrailBreachRate
  ) {
    reasons.push("guardrail_breach_rate");
  }
  return {
    candidateId,
    contextKey,
    status: replayContextGateStatus(reasons),
    reasons,
    scoredOutcomeCount,
    minMatchedOutcomesPerContext,
    guardrailBreachRate,
    maxGuardrailBreachRate,
  };
}

function candidateStatusFromGate(
  status: AdaptiveReplayPolicyGateStatus,
): AdaptiveReplayPolicyCandidateStatus {
  if (status === "pass") return "usable";
  if (status === "fail") return "unsafe";
  return "inconclusive";
}

function candidateStatusFromGates(
  replayGateStatus: AdaptiveReplayPolicyGateStatus,
  observedOutcomeGateStatus: AdaptiveReplayPolicyGateStatus,
  interaction: AdaptiveReplayPolicyCandidateInteraction | null,
): AdaptiveReplayPolicyCandidateStatus {
  if (replayGateStatus === "fail" || observedOutcomeGateStatus === "fail") return "unsafe";
  if (interaction?.status === "antagonistic") return "unsafe";
  return candidateStatusFromGate(replayGateStatus);
}

function replayContextGateStatus(
  reasons: readonly AdaptiveReplayPolicyGateReason[],
): AdaptiveReplayPolicyGateStatus {
  if (reasons.includes("guardrail_breach_rate")) return "fail";
  if (reasons.includes("insufficient_matched_outcomes")) return "insufficient_evidence";
  return "pass";
}

function aggregatePolicyGateStatus(
  contextGates: readonly AdaptiveReplayContextPolicyGate[],
): AdaptiveReplayPolicyGateStatus {
  if (contextGates.some((gate) => gate.status === "fail")) return "fail";
  if (contextGates.some((gate) => gate.status === "insufficient_evidence")) {
    return "insufficient_evidence";
  }
  return "pass";
}

function evaluateReplayPolicyCandidateInteraction(
  candidateId: string,
  parameterKeys: AdaptiveParameterKey[],
  combinedEvaluation: AdaptiveReplayPolicyEvaluation,
  componentEvaluations: readonly AdaptiveReplayPolicyEvaluation[],
  options: AdaptiveReplayPolicyGateOptions,
): AdaptiveReplayPolicyCandidateInteraction {
  const minInteractionMatchedOutcomes = Math.max(
    1,
    Math.round(options.minInteractionMatchedOutcomes ?? DEFAULT_MIN_INTERACTION_MATCHED_OUTCOMES),
  );
  const maxGuardrailBreachRateIncrease = clampRatio(
    options.maxInteractionGuardrailBreachRateIncrease ??
      DEFAULT_MAX_INTERACTION_GUARDRAIL_BREACH_RATE_INCREASE,
  );
  const maxCleanFocusRatioDrop = clampRatio(
    options.maxInteractionCleanFocusRatioDrop ?? DEFAULT_MAX_INTERACTION_CLEAN_FOCUS_RATIO_DROP,
  );
  const maxCompletionRateDrop = clampRatio(
    options.maxInteractionCompletionRateDrop ?? DEFAULT_MAX_INTERACTION_COMPLETION_RATE_DROP,
  );
  const evidenceReadyComponents = componentEvaluations.filter(
    (evaluation) => evaluation.outcomeScore.scoredOutcomeCount >= minInteractionMatchedOutcomes,
  );
  const bestComponentEvaluation = bestReplayPolicyEvaluation(evidenceReadyComponents);
  const reasons: AdaptiveReplayPolicyInteractionReason[] = [];

  if (combinedEvaluation.outcomeScore.scoredOutcomeCount < minInteractionMatchedOutcomes) {
    reasons.push("insufficient_combined_evidence");
  }
  if (!bestComponentEvaluation) {
    reasons.push("insufficient_component_evidence");
  }

  const guardrailBreachRateIncrease = bestComponentEvaluation
    ? nullableDifference(
        combinedEvaluation.outcomeScore.guardrailBreachRate,
        bestComponentEvaluation.outcomeScore.guardrailBreachRate,
      )
    : null;
  const cleanFocusRatioDrop = bestComponentEvaluation
    ? nullableDifference(
        bestComponentEvaluation.outcomeScore.cleanFocusRatio,
        combinedEvaluation.outcomeScore.cleanFocusRatio,
      )
    : null;
  const completionRateDrop = bestComponentEvaluation
    ? nullableDifference(
        bestComponentEvaluation.outcomeScore.completionRate,
        combinedEvaluation.outcomeScore.completionRate,
      )
    : null;

  if (reasons.length === 0) {
    if (
      guardrailBreachRateIncrease !== null &&
      guardrailBreachRateIncrease > maxGuardrailBreachRateIncrease
    ) {
      reasons.push("guardrail_exceeds_component");
    }
    if (cleanFocusRatioDrop !== null && cleanFocusRatioDrop > maxCleanFocusRatioDrop) {
      reasons.push("clean_focus_under_component");
    }
    if (completionRateDrop !== null && completionRateDrop > maxCompletionRateDrop) {
      reasons.push("completion_under_component");
    }
  }

  return {
    candidateId,
    parameterKeys,
    componentCandidateIds: componentEvaluations.map((evaluation) => evaluation.candidateId),
    status: interactionStatusFromReasons(reasons, combinedEvaluation, bestComponentEvaluation),
    reasons,
    combinedEvaluation,
    componentEvaluations: [...componentEvaluations],
    bestComponentEvaluation,
    guardrailBreachRateIncrease,
    cleanFocusRatioDrop,
    completionRateDrop,
  };
}

function interactionStatusFromReasons(
  reasons: readonly AdaptiveReplayPolicyInteractionReason[],
  combinedEvaluation: AdaptiveReplayPolicyEvaluation,
  bestComponentEvaluation: AdaptiveReplayPolicyEvaluation | null,
): AdaptiveReplayPolicyInteractionStatus {
  if (
    reasons.includes("insufficient_combined_evidence") ||
    reasons.includes("insufficient_component_evidence")
  ) {
    return "insufficient_evidence";
  }
  if (
    reasons.includes("guardrail_exceeds_component") ||
    reasons.includes("clean_focus_under_component") ||
    reasons.includes("completion_under_component")
  ) {
    return "antagonistic";
  }
  if (
    bestComponentEvaluation &&
    compareReplayOutcomeScores(combinedEvaluation.outcomeScore, bestComponentEvaluation.outcomeScore) < 0
  ) {
    return "favorable";
  }
  return "neutral";
}

function bestReplayPolicyEvaluation(
  evaluations: readonly AdaptiveReplayPolicyEvaluation[],
): AdaptiveReplayPolicyEvaluation | null {
  const best = evaluations
    .map((evaluation, index) => ({ evaluation, index }))
    .sort((first, second) =>
      compareReplayOutcomeScores(first.evaluation.outcomeScore, second.evaluation.outcomeScore) ||
      first.index - second.index
    );
  return best[0]?.evaluation ?? null;
}

function gateObservedCandidateOutcomes(
  candidates: readonly AdaptiveReplayRunStartPolicyCandidate[],
  options: AdaptiveReplayPolicyGateOptions,
): AdaptiveReplayCandidateObservedOutcomeGate[] {
  const minObservedCandidateOutcomes = Math.max(
    1,
    Math.round(options.minObservedCandidateOutcomes ?? DEFAULT_MIN_OBSERVED_CANDIDATE_OUTCOMES),
  );
  const maxObservedCandidateGuardrailBreachRate = clampRatio(
    options.maxObservedCandidateGuardrailBreachRate ??
      DEFAULT_MAX_OBSERVED_CANDIDATE_GUARDRAIL_BREACH_RATE,
  );
  const scoresByCandidate = new Map(
    (options.observedCandidateOutcomeScores ?? []).map((score) => [score.candidateId, score]),
  );

  return candidates.map((candidate) =>
    gateObservedCandidateOutcomeScore(
      candidate.id,
      scoresByCandidate.get(candidate.id)?.outcomeScore ?? null,
      minObservedCandidateOutcomes,
      maxObservedCandidateGuardrailBreachRate,
    ),
  );
}

function gateObservedCandidateOutcomeScore(
  candidateId: string,
  outcomeScore: AdaptiveReplayOutcomeScore | null,
  minObservedCandidateOutcomes: number,
  maxObservedCandidateGuardrailBreachRate: number,
): AdaptiveReplayCandidateObservedOutcomeGate {
  const scoredOutcomeCount = outcomeScore?.scoredOutcomeCount ?? 0;
  const guardrailBreachRate = outcomeScore?.guardrailBreachRate ?? null;
  const reasons: AdaptiveReplayCandidateObservedOutcomeGateReason[] = [];
  if (scoredOutcomeCount < minObservedCandidateOutcomes) {
    reasons.push("insufficient_observed_candidate_outcomes");
  }
  if (
    guardrailBreachRate !== null &&
    scoredOutcomeCount >= minObservedCandidateOutcomes &&
    guardrailBreachRate > maxObservedCandidateGuardrailBreachRate
  ) {
    reasons.push("observed_candidate_guardrail_breach_rate");
  }
  return {
    candidateId,
    status: observedCandidateOutcomeGateStatus(reasons),
    reasons,
    scoredOutcomeCount,
    minObservedCandidateOutcomes,
    guardrailBreachRate,
    maxObservedCandidateGuardrailBreachRate,
  };
}

function observedCandidateOutcomeGateStatus(
  reasons: readonly AdaptiveReplayCandidateObservedOutcomeGateReason[],
): AdaptiveReplayPolicyGateStatus {
  if (reasons.includes("observed_candidate_guardrail_breach_rate")) return "fail";
  if (reasons.includes("insufficient_observed_candidate_outcomes")) {
    return "insufficient_evidence";
  }
  return "pass";
}

function selectBestUsableReplayReview(
  reviews: readonly AdaptiveReplayPolicyCandidateReview[],
): AdaptiveReplayPolicyCandidateReview | null {
  const usableReviews = reviews
    .map((review, index) => ({ review, index }))
    .filter(({ review }) => review.status === "usable")
    .sort(compareUsableReplayPolicyCandidateReviews);
  return usableReviews[0]?.review ?? null;
}

function compareUsableReplayPolicyCandidateReviews(
  first: IndexedReplayPolicyCandidateReview,
  second: IndexedReplayPolicyCandidateReview,
): number {
  return compareReplayOutcomeScores(first.review.evaluation.outcomeScore, second.review.evaluation.outcomeScore) ||
    first.index - second.index;
}

function nullableDifference(
  first: number | null,
  second: number | null,
): number | null {
  return first === null || second === null ? null : first - second;
}

function replayContextReportCandidateIds(
  reports: readonly AdaptiveReplayContextReport[],
): string[] {
  const candidateIds: string[] = [];
  const seen = new Set<string>();
  for (const report of reports) {
    for (const evaluation of report.evaluations) {
      if (seen.has(evaluation.candidateId)) continue;
      seen.add(evaluation.candidateId);
      candidateIds.push(evaluation.candidateId);
    }
  }
  return candidateIds;
}

function dedupeGateReasons(
  reasons: readonly AdaptiveReplayPolicyGateReason[],
): AdaptiveReplayPolicyGateReason[] {
  return [...new Set(reasons)];
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_GUARDRAIL_BREACH_RATE;
  return Math.max(0, Math.min(1, value));
}
