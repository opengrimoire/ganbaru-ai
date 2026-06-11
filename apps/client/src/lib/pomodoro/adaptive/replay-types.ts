import type {
  BuildRunStartAdaptiveDecisionInput,
  PomodoroRunStartAdaptiveDecision,
} from "./persistence-types";
import type {
  AdaptiveDecisionMode,
  AdaptiveFeatureVector,
  AdaptiveParameterKey,
  AdaptiveReasonCode,
} from "./types";
import type { CountPomodoroRhythm } from "$lib/pomodoro/rhythm";

export interface AdaptiveReplayRunStartOpportunity extends BuildRunStartAdaptiveDecisionInput {
  id: string;
  label?: string;
}

export interface AdaptiveReplayRunStartResult {
  opportunityId: string;
  label?: string;
  decision: PomodoroRunStartAdaptiveDecision;
}

export interface AdaptiveReplaySummary {
  totalOpportunities: number;
  decisionModeCounts: Partial<Record<AdaptiveDecisionMode, number>>;
  reasonCodeCounts: Partial<Record<AdaptiveReasonCode, number>>;
  experimentAssignmentCounts: Record<string, number>;
  changedValueCounts: Partial<Record<AdaptiveParameterKey, number>>;
}

export type AdaptiveReplayOutcomeGuardrailReason =
  | "focus_failure"
  | "interrupted_focus"
  | "stopped_run"
  | "blocked_attempts"
  | "skipped_break"
  | "short_break_overtime"
  | "long_break_overtime"
  | "clean_focus_loss";

export interface AdaptiveReplayObservedOutcome {
  opportunityId: string;
  features: AdaptiveFeatureVector;
  observedRhythm?: CountPomodoroRhythm;
}

export interface AdaptiveReplayJoinedOutcome {
  result: AdaptiveReplayRunStartResult;
  outcome: AdaptiveReplayObservedOutcome;
  selectedRhythmMatchesObserved: boolean | null;
  guardrailReasons: AdaptiveReplayOutcomeGuardrailReason[];
}

export type AdaptiveReplayOutcomeAttribution = "all_observed" | "selected_rhythm_match";

export interface AdaptiveReplayOutcomeScoreOptions {
  attribution?: AdaptiveReplayOutcomeAttribution;
}

export interface AdaptiveReplayOutcomeScore {
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
  completionRate: number | null;
  cleanFocusRatio: number | null;
  blockedAttemptsMean: number | null;
  breakSkippedMean: number | null;
  shortBreakOvertimeSecondsMean: number | null;
  longBreakOvertimeSecondsMean: number | null;
  guardrailBreachCount: number;
  guardrailBreachRate: number | null;
  guardrailReasonCounts: Partial<Record<AdaptiveReplayOutcomeGuardrailReason, number>>;
}

export interface AdaptiveReplayCandidateObservedOutcomeScore {
  candidateId: string;
  opportunityIds: string[];
  outcomeScore: AdaptiveReplayOutcomeScore;
}

export interface AdaptiveReplayRunStartPolicyCandidate {
  id: string;
  parameterKeys?: readonly AdaptiveParameterKey[];
  componentCandidates?: readonly AdaptiveReplayRunStartPolicyCandidate[];
  decide: (opportunity: AdaptiveReplayRunStartOpportunity) => PomodoroRunStartAdaptiveDecision;
}

export interface AdaptiveReplayBoundedRunStartPolicyCandidateInput {
  id: string;
  focusDurationMinutes?: number;
  shortBreakMinutes?: number;
  longBreakMinutes?: number;
  longBreakAfterFocusCount?: number;
  focusDurationDeltaMinutes?: number;
  shortBreakDeltaMinutes?: number;
  longBreakDeltaMinutes?: number;
  longBreakAfterFocusCountDelta?: number;
  allowedDecisionModes?: readonly AdaptiveDecisionMode[];
}

export const DEFAULT_BOUNDED_REPLAY_RUN_START_POLICY_CANDIDATE_INPUTS = [
  {
    id: "focus-growth-with-short-break-support",
    focusDurationDeltaMinutes: 5,
    shortBreakDeltaMinutes: 2,
  },
  {
    id: "long-recovery-support",
    longBreakDeltaMinutes: 5,
    longBreakAfterFocusCountDelta: -1,
  },
  {
    id: "capacity-cadence-growth",
    focusDurationDeltaMinutes: 5,
    longBreakAfterFocusCountDelta: 1,
  },
] as const satisfies readonly AdaptiveReplayBoundedRunStartPolicyCandidateInput[];

export interface AdaptiveReplayPolicyEvaluation {
  candidateId: string;
  results: AdaptiveReplayRunStartResult[];
  summary: AdaptiveReplaySummary;
  outcomeScore: AdaptiveReplayOutcomeScore;
}

export interface AdaptiveReplayContextPolicyEvaluation extends AdaptiveReplayPolicyEvaluation {
  contextKey: string;
}

export interface AdaptiveReplayContextReport {
  contextKey: string;
  evaluations: AdaptiveReplayContextPolicyEvaluation[];
}

export type AdaptiveReplayPolicyGateStatus = "pass" | "fail" | "insufficient_evidence";

export type AdaptiveReplayPolicyGateReason =
  | "insufficient_matched_outcomes"
  | "guardrail_breach_rate";

export interface AdaptiveReplayPolicyGateOptions {
  minMatchedOutcomesPerContext?: number;
  maxGuardrailBreachRate?: number;
  observedCandidateOutcomeScores?: readonly AdaptiveReplayCandidateObservedOutcomeScore[];
  minObservedCandidateOutcomes?: number;
  maxObservedCandidateGuardrailBreachRate?: number;
  minInteractionMatchedOutcomes?: number;
  maxInteractionGuardrailBreachRateIncrease?: number;
  maxInteractionCleanFocusRatioDrop?: number;
  maxInteractionCompletionRateDrop?: number;
}

export interface AdaptiveReplayContextPolicyGate {
  candidateId: string;
  contextKey: string;
  status: AdaptiveReplayPolicyGateStatus;
  reasons: AdaptiveReplayPolicyGateReason[];
  scoredOutcomeCount: number;
  minMatchedOutcomesPerContext: number;
  guardrailBreachRate: number | null;
  maxGuardrailBreachRate: number;
}

export interface AdaptiveReplayPolicyGateEvaluation {
  candidateId: string;
  status: AdaptiveReplayPolicyGateStatus;
  reasons: AdaptiveReplayPolicyGateReason[];
  contextGates: AdaptiveReplayContextPolicyGate[];
}

export type AdaptiveReplayCandidateObservedOutcomeGateReason =
  | "insufficient_observed_candidate_outcomes"
  | "observed_candidate_guardrail_breach_rate";

export interface AdaptiveReplayCandidateObservedOutcomeGate {
  candidateId: string;
  status: AdaptiveReplayPolicyGateStatus;
  reasons: AdaptiveReplayCandidateObservedOutcomeGateReason[];
  scoredOutcomeCount: number;
  minObservedCandidateOutcomes: number;
  guardrailBreachRate: number | null;
  maxObservedCandidateGuardrailBreachRate: number;
}

export type AdaptiveReplayPolicyCandidateStatus = "usable" | "unsafe" | "inconclusive";

export interface AdaptiveReplayPolicyCandidateReview {
  candidateId: string;
  status: AdaptiveReplayPolicyCandidateStatus;
  evaluation: AdaptiveReplayPolicyEvaluation;
  gate: AdaptiveReplayPolicyGateEvaluation;
  observedOutcomeGate: AdaptiveReplayCandidateObservedOutcomeGate;
  interaction: AdaptiveReplayPolicyCandidateInteraction | null;
}

export interface AdaptiveReplayPolicyCandidateWorkflow {
  evaluations: AdaptiveReplayPolicyEvaluation[];
  contextReports: AdaptiveReplayContextReport[];
  gates: AdaptiveReplayPolicyGateEvaluation[];
  observedOutcomeGates: AdaptiveReplayCandidateObservedOutcomeGate[];
  interactions: AdaptiveReplayPolicyCandidateInteraction[];
  reviews: AdaptiveReplayPolicyCandidateReview[];
  usableCandidateIds: string[];
  unsafeCandidateIds: string[];
  inconclusiveCandidateIds: string[];
}

export type AdaptiveReplayPolicyInteractionStatus =
  | "favorable"
  | "neutral"
  | "antagonistic"
  | "insufficient_evidence";

export type AdaptiveReplayPolicyInteractionReason =
  | "insufficient_combined_evidence"
  | "insufficient_component_evidence"
  | "guardrail_exceeds_component"
  | "clean_focus_under_component"
  | "completion_under_component";

export interface AdaptiveReplayPolicyCandidateInteraction {
  candidateId: string;
  parameterKeys: AdaptiveParameterKey[];
  componentCandidateIds: string[];
  status: AdaptiveReplayPolicyInteractionStatus;
  reasons: AdaptiveReplayPolicyInteractionReason[];
  combinedEvaluation: AdaptiveReplayPolicyEvaluation;
  componentEvaluations: AdaptiveReplayPolicyEvaluation[];
  bestComponentEvaluation: AdaptiveReplayPolicyEvaluation | null;
  guardrailBreachRateIncrease: number | null;
  cleanFocusRatioDrop: number | null;
  completionRateDrop: number | null;
}
