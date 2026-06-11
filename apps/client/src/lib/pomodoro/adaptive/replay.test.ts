import { describe, expect, it } from "vitest";
import {
  buildBoundedReplayRunStartPolicyCandidate,
  buildDefaultBoundedReplayRunStartPolicyCandidates,
  evaluateDefaultBoundedReplayRunStartPolicyCandidates,
  evaluateGatedReplayRunStartPolicyCandidates,
  evaluateReplayRunStartPolicyCandidatesByContext,
  evaluateReplayRunStartPolicyCandidates,
  evaluateReplayRunStartPolicyCandidateInteractions,
  gateReplayContextReports,
  joinReplayRunStartOutcomes,
  replayRunStartAdaptiveDecisions,
  scoreReplayJoinedOutcomes,
  scoreReplayObservedOutcomesByCandidate,
  selectBestUsableReplayRunStartPolicyCandidate,
  selectBestUsableReplayRunStartPolicyCandidateForContext,
  summarizeReplayRunStartResults,
  type AdaptiveReplayRunStartOpportunity,
  type AdaptiveReplayRunStartPolicyCandidate,
} from "./replay";
import {
  adaptiveContextKey,
  decideRunStartAdaptiveRhythm,
  type PomodoroAdaptiveHistoryRead,
} from "./persistence";
import { RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT } from "./experiments";
import { ADAPTIVE_BASELINE_RHYTHM } from "./constants";
import { extractAdaptiveFeatures } from "./features";
import type {
  AdaptiveBlockEventInput,
  AdaptiveParameterKey,
  AdaptiveRunEventInput,
  AdaptiveSegmentInput,
} from "./types";

describe("adaptive replay", () => {
  it("replays run-start opportunities through the current policy", () => {
    const fallback = replayOpportunity({
      id: "fallback",
      label: "no history",
      history: null,
    });
    const capacity = cadenceExpansionTreatmentOpportunity();
    const replayed = replayRunStartAdaptiveDecisions([fallback, capacity]);

    expect(replayed).toHaveLength(2);
    expect(replayed[0]).toEqual({
      opportunityId: "fallback",
      label: "no history",
      decision: decideRunStartAdaptiveRhythm(fallback),
    });
    expect(replayed[1]).toEqual({
      opportunityId: capacity.id,
      decision: decideRunStartAdaptiveRhythm(capacity),
    });
  });

  it("summarizes replayed modes, reasons, assignments, and changed rhythm values", () => {
    const replayed = replayRunStartAdaptiveDecisions([
      replayOpportunity({
        id: "fallback",
        history: null,
      }),
      cadenceExpansionTreatmentOpportunity(),
    ]);
    const summary = summarizeReplayRunStartResults(replayed);

    expect(summary.totalOpportunities).toBe(2);
    expect(summary.decisionModeCounts.fallback).toBe(1);
    expect(summary.decisionModeCounts.explore).toBe(1);
    expect(summary.reasonCodeCounts.no_history).toBe(1);
    expect(summary.reasonCodeCounts.capacity_rebuild).toBe(1);
    expect(summary.experimentAssignmentCounts[RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.id]).toBe(1);
    expect(summary.changedValueCounts.long_break_after_focus_count).toBe(1);
  });

  it("joins observed outcomes and scores guardrail burden", () => {
    const safe = cadenceExpansionTreatmentOpportunity();
    const strained = replayOpportunity({
      id: "strained",
      history: null,
    });
    const results = replayRunStartAdaptiveDecisions([safe, strained]);
    const joined = joinReplayRunStartOutcomes(results, [
      {
        opportunityId: safe.id,
        observedRhythm: results[0].decision.selectedRhythm,
        features: cleanOutcomeFeatures(),
      },
      {
        opportunityId: strained.id,
        observedRhythm: results[1].decision.selectedRhythm,
        features: guardrailOutcomeFeatures(),
      },
    ]);
    const score = scoreReplayJoinedOutcomes(joined);

    expect(joined).toHaveLength(2);
    expect(joined[0].selectedRhythmMatchesObserved).toBe(true);
    expect(joined[1].guardrailReasons).toEqual([
      "focus_failure",
      "interrupted_focus",
      "stopped_run",
      "blocked_attempts",
      "clean_focus_loss",
    ]);
    expect(score.scoredOutcomeCount).toBe(2);
    expect(score.guardrailBreachCount).toBe(1);
    expect(score.guardrailReasonCounts.blocked_attempts).toBe(1);
    expect(score.cleanFocusRatio).toBeLessThan(1);
  });

  it("compares candidate policies using only rhythm-matched observed outcomes", () => {
    const fallback = replayOpportunity({
      id: "fallback",
      history: null,
    });
    const capacity = cadenceExpansionTreatmentOpportunity();
    const currentCapacityDecision = decideRunStartAdaptiveRhythm(capacity);
    const holdCandidate: AdaptiveReplayRunStartPolicyCandidate = {
      id: "hold-baseline",
      decide: (opportunity) => ({
        ...decideRunStartAdaptiveRhythm(opportunity),
        selectedRhythm: opportunity.currentRhythm,
        decisionMode: "hold",
        reasonCodes: ["hold_current_rhythm"],
        experimentUpdate: null,
        experimentAssignment: null,
      }),
    };
    const evaluations = evaluateReplayRunStartPolicyCandidates(
      [fallback, capacity],
      [
        {
          id: "current",
          decide: decideRunStartAdaptiveRhythm,
        },
        holdCandidate,
      ],
      [
        {
          opportunityId: fallback.id,
          observedRhythm: fallback.currentRhythm,
          features: cleanOutcomeFeatures(),
        },
        {
          opportunityId: capacity.id,
          observedRhythm: currentCapacityDecision.selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
      ],
    );

    expect(evaluations[0].candidateId).toBe("current");
    expect(evaluations[0].outcomeScore.scoredOutcomeCount).toBe(2);
    expect(evaluations[1].candidateId).toBe("hold-baseline");
    expect(evaluations[1].outcomeScore.scoredOutcomeCount).toBe(1);
    expect(evaluations[1].outcomeScore.mismatchedSelectedRhythmCount).toBe(1);
    expect(evaluations[1].summary.decisionModeCounts.hold).toBe(2);
  });

  it("builds bounded multi-parameter candidates without overriding safety decisions", () => {
    const capacity = cadenceExpansionTreatmentOpportunity();
    const fallback = replayOpportunity({
      id: "fallback",
      history: null,
    });
    const candidate = buildBoundedReplayRunStartPolicyCandidate({
      id: "bounded-multi-parameter",
      focusDurationDeltaMinutes: 50,
      shortBreakDeltaMinutes: 20,
      longBreakDeltaMinutes: 25,
      longBreakAfterFocusCountDelta: -10,
    });
    const capacityDecision = candidate.decide(capacity);
    const fallbackDecision = candidate.decide(fallback);

    expect(capacityDecision.selectedRhythm).toEqual({
      kind: "count",
      focusDurationMinutes: 60,
      shortBreakMinutes: 12,
      longBreakMinutes: 30,
      longBreakAfterFocusCount: 2,
    });
    expect(capacityDecision.decisionMode).toBe("explore");
    expect(capacityDecision.reasonCodes).not.toContain("hold_current_rhythm");
    expect(capacityDecision.reasonCodes).toContain("replay_candidate");
    expect(capacityDecision.candidateId).toBe("bounded-multi-parameter");
    expect(capacityDecision.experimentAssignment).toBeNull();
    expect(capacityDecision.experimentUpdate).toBeNull();
    expect(fallbackDecision).toEqual(decideRunStartAdaptiveRhythm(fallback));
  });

  it("evaluates bounded candidate builders through the gated replay workflow", () => {
    const opportunity = cadenceExpansionTreatmentOpportunity();
    const candidate = buildBoundedReplayRunStartPolicyCandidate({
      id: "focus-and-short-break-growth",
      focusDurationDeltaMinutes: 5,
      shortBreakDeltaMinutes: 2,
    });
    const candidateDecision = candidate.decide(opportunity);
    const workflow = evaluateGatedReplayRunStartPolicyCandidates(
      [opportunity],
      [candidate],
      [
        {
          opportunityId: opportunity.id,
          observedRhythm: candidateDecision.selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
      ],
      {
        minMatchedOutcomesPerContext: 1,
        maxGuardrailBreachRate: 0,
      },
    );

    expect(workflow.reviews[0].status).toBe("usable");
    expect(workflow.usableCandidateIds).toEqual(["focus-and-short-break-growth"]);
    expect(workflow.evaluations[0].outcomeScore.scoredOutcomeCount).toBe(1);
    expect(workflow.evaluations[0].summary.changedValueCounts.focus_duration_minutes).toBe(1);
    expect(workflow.evaluations[0].summary.changedValueCounts.short_break_minutes).toBe(1);
  });

  it("scores multi-parameter candidate interactions against single-parameter components", () => {
    const combinedOpportunity = cadenceExpansionTreatmentOpportunity();
    const focusOpportunity = cadenceExpansionTreatmentOpportunityWithId("focus-component");
    const shortBreakOpportunity = cadenceExpansionTreatmentOpportunityWithId("short-break-component");
    const candidate = buildBoundedReplayRunStartPolicyCandidate({
      id: "focus-and-short-break-growth",
      focusDurationDeltaMinutes: 5,
      shortBreakDeltaMinutes: 2,
    });
    const focusComponent = componentCandidate(candidate, "focus_duration_minutes");
    const shortBreakComponent = componentCandidate(candidate, "short_break_minutes");
    const interaction = evaluateReplayRunStartPolicyCandidateInteractions(
      [combinedOpportunity, focusOpportunity, shortBreakOpportunity],
      [candidate],
      [
        {
          opportunityId: combinedOpportunity.id,
          observedRhythm: candidate.decide(combinedOpportunity).selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
        {
          opportunityId: focusOpportunity.id,
          observedRhythm: focusComponent.decide(focusOpportunity).selectedRhythm,
          features: mostlyCleanOutcomeFeatures(),
        },
        {
          opportunityId: shortBreakOpportunity.id,
          observedRhythm: shortBreakComponent.decide(shortBreakOpportunity).selectedRhythm,
          features: mostlyCleanOutcomeFeatures(),
        },
      ],
      {
        minInteractionMatchedOutcomes: 1,
      },
    )[0];

    expect(candidate.parameterKeys).toEqual([
      "focus_duration_minutes",
      "short_break_minutes",
    ]);
    expect(interaction?.status).toBe("favorable");
    expect(interaction?.bestComponentEvaluation?.candidateId).toBe(focusComponent.id);
    expect(interaction?.combinedEvaluation.outcomeScore.scoredOutcomeCount).toBe(1);
    expect(interaction?.componentEvaluations).toHaveLength(2);
    expect(interaction?.cleanFocusRatioDrop).toBeLessThanOrEqual(0);
  });

  it("marks a replay-approved combined candidate unsafe when component evidence is better", () => {
    const combinedOpportunity = cadenceExpansionTreatmentOpportunity();
    const focusOpportunity = cadenceExpansionTreatmentOpportunityWithId("focus-component");
    const shortBreakOpportunity = cadenceExpansionTreatmentOpportunityWithId("short-break-component");
    const candidate = buildBoundedReplayRunStartPolicyCandidate({
      id: "focus-and-short-break-growth",
      focusDurationDeltaMinutes: 5,
      shortBreakDeltaMinutes: 2,
    });
    const focusComponent = componentCandidate(candidate, "focus_duration_minutes");
    const shortBreakComponent = componentCandidate(candidate, "short_break_minutes");
    const workflow = evaluateGatedReplayRunStartPolicyCandidates(
      [combinedOpportunity, focusOpportunity, shortBreakOpportunity],
      [candidate],
      [
        {
          opportunityId: combinedOpportunity.id,
          observedRhythm: candidate.decide(combinedOpportunity).selectedRhythm,
          features: guardrailOutcomeFeatures(),
        },
        {
          opportunityId: focusOpportunity.id,
          observedRhythm: focusComponent.decide(focusOpportunity).selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
        {
          opportunityId: shortBreakOpportunity.id,
          observedRhythm: shortBreakComponent.decide(shortBreakOpportunity).selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
      ],
      {
        minMatchedOutcomesPerContext: 1,
        maxGuardrailBreachRate: 1,
        minInteractionMatchedOutcomes: 1,
        maxInteractionGuardrailBreachRateIncrease: 0.15,
      },
    );

    expect(workflow.reviews[0].gate.status).toBe("pass");
    expect(workflow.reviews[0].interaction?.status).toBe("antagonistic");
    expect(workflow.reviews[0].interaction?.reasons).toEqual([
      "guardrail_exceeds_component",
      "clean_focus_under_component",
      "completion_under_component",
    ]);
    expect(workflow.reviews[0].status).toBe("unsafe");
    expect(workflow.usableCandidateIds).toEqual([]);
    expect(workflow.unsafeCandidateIds).toEqual(["focus-and-short-break-growth"]);
    expect(selectBestUsableReplayRunStartPolicyCandidate(workflow)).toBeNull();
  });

  it("evaluates the default bounded candidate catalog through rhythm-matched evidence", () => {
    const opportunity = cadenceExpansionTreatmentOpportunity();
    const candidates = buildDefaultBoundedReplayRunStartPolicyCandidates();
    const targetCandidate = candidates.find(
      (candidate) => candidate.id === "focus-growth-with-short-break-support",
    );
    if (!targetCandidate) {
      throw new Error("Expected the focus growth candidate to exist.");
    }
    const targetDecision = targetCandidate.decide(opportunity);
    const workflow = evaluateDefaultBoundedReplayRunStartPolicyCandidates(
      [opportunity],
      [
        {
          opportunityId: opportunity.id,
          observedRhythm: targetDecision.selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
      ],
      {
        minMatchedOutcomesPerContext: 1,
        maxGuardrailBreachRate: 0,
      },
    );

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "focus-growth-with-short-break-support",
      "long-recovery-support",
      "capacity-cadence-growth",
    ]);
    expect(workflow.usableCandidateIds).toEqual(["focus-growth-with-short-break-support"]);
    expect(workflow.inconclusiveCandidateIds).toEqual([
      "long-recovery-support",
      "capacity-cadence-growth",
    ]);
    expect(workflow.reviews[1].gate.reasons).toEqual(["insufficient_matched_outcomes"]);
  });

  it("selects the strongest usable bounded candidate from a gated workflow", () => {
    const first = replayOpportunity({
      id: "clean-match",
      startedAt: "2026-06-25T09:00:00.000Z",
      plannedStart: "2026-06-25T09:00:00.000Z",
      plannedEnd: "2026-06-25T10:00:00.000Z",
      history: cleanMomentumHistory(),
    });
    const second = replayOpportunity({
      id: "weaker-match",
      startedAt: "2026-06-26T09:00:00.000Z",
      plannedStart: "2026-06-26T09:00:00.000Z",
      plannedEnd: "2026-06-26T10:00:00.000Z",
      history: cleanMomentumHistory(),
    });
    const weakerCandidate = buildBoundedReplayRunStartPolicyCandidate({
      id: "weaker-short-break-support",
      shortBreakDeltaMinutes: 2,
    });
    const strongerCandidate = buildBoundedReplayRunStartPolicyCandidate({
      id: "stronger-focus-growth",
      focusDurationDeltaMinutes: 5,
    });
    const weakerDecision = weakerCandidate.decide(second);
    const strongerDecision = strongerCandidate.decide(first);
    const workflow = evaluateGatedReplayRunStartPolicyCandidates(
      [first, second],
      [weakerCandidate, strongerCandidate],
      [
        {
          opportunityId: first.id,
          observedRhythm: strongerDecision.selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
        {
          opportunityId: second.id,
          observedRhythm: weakerDecision.selectedRhythm,
          features: mostlyCleanOutcomeFeatures(),
        },
      ],
      {
        minMatchedOutcomesPerContext: 1,
        maxGuardrailBreachRate: 0,
      },
    );
    const selected = selectBestUsableReplayRunStartPolicyCandidate(workflow);
    const contextSelected = selectBestUsableReplayRunStartPolicyCandidateForContext(
      workflow,
      adaptiveContextKey(strongerDecision.context),
    );

    expect(workflow.usableCandidateIds).toEqual([
      "weaker-short-break-support",
      "stronger-focus-growth",
    ]);
    expect(selected?.candidateId).toBe("stronger-focus-growth");
    expect(contextSelected?.candidateId).toBe("stronger-focus-growth");
    expect(
      selectBestUsableReplayRunStartPolicyCandidateForContext(
        workflow,
        "late|late|long|high|unknown|none",
      ),
    ).toBeNull();
    expect(
      selectBestUsableReplayRunStartPolicyCandidate({
        ...workflow,
        reviews: workflow.reviews.map((review) => ({
          ...review,
          status: "inconclusive",
        })),
      }),
    ).toBeNull();
  });

  it("reports candidate policy scores by comparable context", () => {
    const morning = replayOpportunity({
      id: "morning",
      history: null,
      startedAt: "2026-06-20T09:00:00.000Z",
      plannedStart: "2026-06-20T09:00:00.000Z",
      plannedEnd: "2026-06-20T10:00:00.000Z",
    });
    const evening = replayOpportunity({
      id: "evening",
      history: null,
      startedAt: "2026-06-20T20:00:00.000Z",
      plannedStart: "2026-06-20T20:00:00.000Z",
      plannedEnd: "2026-06-20T21:00:00.000Z",
    });
    const holdCandidate: AdaptiveReplayRunStartPolicyCandidate = {
      id: "hold-baseline",
      decide: (opportunity) => ({
        ...decideRunStartAdaptiveRhythm(opportunity),
        selectedRhythm: opportunity.currentRhythm,
        decisionMode: "hold",
        reasonCodes: ["hold_current_rhythm"],
        experimentUpdate: null,
        experimentAssignment: null,
      }),
    };
    const currentResults = replayRunStartAdaptiveDecisions([morning, evening]);
    const morningContextKey = adaptiveContextKey(currentResults[0].decision.context);
    const eveningContextKey = adaptiveContextKey(currentResults[1].decision.context);
    const reports = evaluateReplayRunStartPolicyCandidatesByContext(
      [morning, evening],
      [
        {
          id: "current",
          decide: decideRunStartAdaptiveRhythm,
        },
        holdCandidate,
      ],
      [
        {
          opportunityId: morning.id,
          observedRhythm: currentResults[0].decision.selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
        {
          opportunityId: evening.id,
          observedRhythm: currentResults[1].decision.selectedRhythm,
          features: guardrailOutcomeFeatures(),
        },
      ],
    );

    const morningReport = reports.find((report) => report.contextKey === morningContextKey);
    const eveningReport = reports.find((report) => report.contextKey === eveningContextKey);
    const morningCurrent = morningReport?.evaluations.find((evaluation) => evaluation.candidateId === "current");
    const eveningCurrent = eveningReport?.evaluations.find((evaluation) => evaluation.candidateId === "current");

    expect(reports).toHaveLength(2);
    expect(morningReport?.evaluations).toHaveLength(2);
    expect(eveningReport?.evaluations).toHaveLength(2);
    expect(morningCurrent?.summary.totalOpportunities).toBe(1);
    expect(morningCurrent?.outcomeScore.guardrailBreachCount).toBe(0);
    expect(eveningCurrent?.summary.totalOpportunities).toBe(1);
    expect(eveningCurrent?.outcomeScore.guardrailBreachCount).toBe(1);
    expect(eveningCurrent?.outcomeScore.guardrailReasonCounts.focus_failure).toBe(1);
  });

  it("gates candidate policies by context evidence and guardrail burden", () => {
    const morning = replayOpportunity({
      id: "morning",
      history: null,
      startedAt: "2026-06-20T09:00:00.000Z",
      plannedStart: "2026-06-20T09:00:00.000Z",
      plannedEnd: "2026-06-20T10:00:00.000Z",
    });
    const evening = replayOpportunity({
      id: "evening",
      history: null,
      startedAt: "2026-06-20T20:00:00.000Z",
      plannedStart: "2026-06-20T20:00:00.000Z",
      plannedEnd: "2026-06-20T21:00:00.000Z",
    });
    const currentResults = replayRunStartAdaptiveDecisions([morning, evening]);
    const reports = evaluateReplayRunStartPolicyCandidatesByContext(
      [morning, evening],
      [
        {
          id: "current",
          decide: decideRunStartAdaptiveRhythm,
        },
      ],
      [
        {
          opportunityId: morning.id,
          observedRhythm: currentResults[0].decision.selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
        {
          opportunityId: evening.id,
          observedRhythm: currentResults[1].decision.selectedRhythm,
          features: guardrailOutcomeFeatures(),
        },
      ],
    );
    const strictGate = gateReplayContextReports(reports, {
      minMatchedOutcomesPerContext: 1,
      maxGuardrailBreachRate: 0,
    });
    const evidenceGate = gateReplayContextReports(reports, {
      minMatchedOutcomesPerContext: 2,
      maxGuardrailBreachRate: 1,
    });

    expect(strictGate[0].status).toBe("fail");
    expect(strictGate[0].reasons).toEqual(["guardrail_breach_rate"]);
    expect(strictGate[0].contextGates.some((gate) => gate.status === "fail")).toBe(true);
    expect(evidenceGate[0].status).toBe("insufficient_evidence");
    expect(evidenceGate[0].reasons).toEqual(["insufficient_matched_outcomes"]);
  });

  it("classifies gated candidate policy workflow outcomes", () => {
    const clean = replayOpportunity({
      id: "clean",
      history: null,
    });
    const strained = replayOpportunity({
      id: "strained",
      history: null,
    });
    const currentCandidate: AdaptiveReplayRunStartPolicyCandidate = {
      id: "current",
      decide: decideRunStartAdaptiveRhythm,
    };
    const cleanDecision = decideRunStartAdaptiveRhythm(clean);
    const strainedDecision = decideRunStartAdaptiveRhythm(strained);
    const usable = evaluateGatedReplayRunStartPolicyCandidates(
      [clean],
      [currentCandidate],
      [
        {
          opportunityId: clean.id,
          observedRhythm: cleanDecision.selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
      ],
      {
        minMatchedOutcomesPerContext: 1,
        maxGuardrailBreachRate: 0,
      },
    );
    const unsafe = evaluateGatedReplayRunStartPolicyCandidates(
      [strained],
      [currentCandidate],
      [
        {
          opportunityId: strained.id,
          observedRhythm: strainedDecision.selectedRhythm,
          features: guardrailOutcomeFeatures(),
        },
      ],
      {
        minMatchedOutcomesPerContext: 1,
        maxGuardrailBreachRate: 0,
      },
    );
    const inconclusive = evaluateGatedReplayRunStartPolicyCandidates(
      [clean],
      [currentCandidate],
      [
        {
          opportunityId: clean.id,
          observedRhythm: cleanDecision.selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
      ],
      {
        minMatchedOutcomesPerContext: 2,
        maxGuardrailBreachRate: 1,
      },
    );

    expect(usable.reviews[0].status).toBe("usable");
    expect(usable.usableCandidateIds).toEqual(["current"]);
    expect(unsafe.reviews[0].status).toBe("unsafe");
    expect(unsafe.unsafeCandidateIds).toEqual(["current"]);
    expect(unsafe.reviews[0].gate.reasons).toEqual(["guardrail_breach_rate"]);
    expect(inconclusive.reviews[0].status).toBe("inconclusive");
    expect(inconclusive.inconclusiveCandidateIds).toEqual(["current"]);
    expect(inconclusive.reviews[0].gate.reasons).toEqual(["insufficient_matched_outcomes"]);
  });

  it("suppresses replay-approved candidates when direct candidate outcomes become harmful", () => {
    const opportunity = cadenceExpansionTreatmentOpportunity();
    const candidate = buildBoundedReplayRunStartPolicyCandidate({
      id: "focus-and-short-break-growth",
      focusDurationDeltaMinutes: 5,
      shortBreakDeltaMinutes: 2,
    });
    const candidateDecision = candidate.decide(opportunity);
    const observedCandidateOutcomeScores = scoreReplayObservedOutcomesByCandidate(
      [
        {
          opportunityId: "live-candidate-1",
          features: guardrailOutcomeFeatures(),
        },
        {
          opportunityId: "live-candidate-2",
          features: guardrailOutcomeFeatures(),
        },
      ],
      new Map([
        ["live-candidate-1", candidate.id],
        ["live-candidate-2", candidate.id],
      ]),
    );
    const workflow = evaluateGatedReplayRunStartPolicyCandidates(
      [opportunity],
      [candidate],
      [
        {
          opportunityId: opportunity.id,
          observedRhythm: candidateDecision.selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
      ],
      {
        minMatchedOutcomesPerContext: 1,
        maxGuardrailBreachRate: 0,
        observedCandidateOutcomeScores,
        minObservedCandidateOutcomes: 2,
        maxObservedCandidateGuardrailBreachRate: 0.25,
      },
    );

    expect(workflow.reviews[0].gate.status).toBe("pass");
    expect(workflow.reviews[0].observedOutcomeGate.status).toBe("fail");
    expect(workflow.reviews[0].observedOutcomeGate.reasons).toEqual([
      "observed_candidate_guardrail_breach_rate",
    ]);
    expect(workflow.reviews[0].status).toBe("unsafe");
    expect(workflow.usableCandidateIds).toEqual([]);
    expect(workflow.unsafeCandidateIds).toEqual(["focus-and-short-break-growth"]);
    expect(selectBestUsableReplayRunStartPolicyCandidate(workflow)).toBeNull();
  });

  it("keeps sparse direct candidate outcome evidence non-blocking", () => {
    const opportunity = cadenceExpansionTreatmentOpportunity();
    const candidate = buildBoundedReplayRunStartPolicyCandidate({
      id: "focus-and-short-break-growth",
      focusDurationDeltaMinutes: 5,
      shortBreakDeltaMinutes: 2,
    });
    const candidateDecision = candidate.decide(opportunity);
    const observedCandidateOutcomeScores = scoreReplayObservedOutcomesByCandidate(
      [
        {
          opportunityId: "live-candidate-1",
          features: guardrailOutcomeFeatures(),
        },
      ],
      new Map([
        ["live-candidate-1", candidate.id],
      ]),
    );
    const workflow = evaluateGatedReplayRunStartPolicyCandidates(
      [opportunity],
      [candidate],
      [
        {
          opportunityId: opportunity.id,
          observedRhythm: candidateDecision.selectedRhythm,
          features: cleanOutcomeFeatures(),
        },
      ],
      {
        minMatchedOutcomesPerContext: 1,
        maxGuardrailBreachRate: 0,
        observedCandidateOutcomeScores,
        minObservedCandidateOutcomes: 2,
        maxObservedCandidateGuardrailBreachRate: 0.25,
      },
    );

    expect(workflow.reviews[0].gate.status).toBe("pass");
    expect(workflow.reviews[0].observedOutcomeGate.status).toBe("insufficient_evidence");
    expect(workflow.reviews[0].status).toBe("usable");
    expect(workflow.usableCandidateIds).toEqual(["focus-and-short-break-growth"]);
    expect(selectBestUsableReplayRunStartPolicyCandidate(workflow)?.candidateId).toBe(candidate.id);
  });
});

function cadenceExpansionTreatmentOpportunity(): AdaptiveReplayRunStartOpportunity {
  for (let offsetDays = 0; offsetDays <= 60; offsetDays += 1) {
    const date = isoDateFromOffset("2026-06-20T00:00:00.000Z", offsetDays);
    const opportunity = replayOpportunity({
      id: `capacity-${date}`,
      startedAt: `${date}T09:00:00.000Z`,
      plannedStart: `${date}T09:00:00.000Z`,
      plannedEnd: `${date}T10:00:00.000Z`,
      history: cleanMomentumHistory(),
    });
    const decision = decideRunStartAdaptiveRhythm(opportunity);
    if (
      decision.experimentAssignment?.experiment.id === RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.id &&
      decision.experimentAssignment.variant.numericValue === 5
    ) {
      return opportunity;
    }
  }
  throw new Error("Expected a deterministic C5 treatment assignment in the search window.");
}

function cadenceExpansionTreatmentOpportunityWithId(
  id: string,
): AdaptiveReplayRunStartOpportunity {
  return {
    ...cadenceExpansionTreatmentOpportunity(),
    id,
  };
}

function componentCandidate(
  candidate: AdaptiveReplayRunStartPolicyCandidate,
  parameterKey: AdaptiveParameterKey,
): AdaptiveReplayRunStartPolicyCandidate {
  const component = candidate.componentCandidates?.find((entry) =>
    entry.parameterKeys?.includes(parameterKey)
  );
  if (!component) {
    throw new Error(`Expected component candidate for ${parameterKey}.`);
  }
  return component;
}

function isoDateFromOffset(
  startIso: string,
  offsetDays: number,
): string {
  const start = new Date(startIso);
  start.setUTCDate(start.getUTCDate() + offsetDays);
  return start.toISOString().slice(0, 10);
}

function replayOpportunity(
  overrides: Partial<AdaptiveReplayRunStartOpportunity>,
): AdaptiveReplayRunStartOpportunity {
  return {
    id: "opportunity-1",
    startedAt: "2026-06-20T09:00:00.000Z",
    plannedStart: "2026-06-20T09:00:00.000Z",
    plannedEnd: "2026-06-20T10:00:00.000Z",
    currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
    idleDetectionEnabled: true,
    history: emptyHistory(),
    ...overrides,
  };
}

function cleanMomentumHistory(): PomodoroAdaptiveHistoryRead {
  const focusSegments = Array.from({ length: 12 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return segment({
      runId: `run-focus-${index + 1}`,
      phase: "focus",
      plannedStart: `2026-06-${day}T09:00:00.000Z`,
      plannedEnd: `2026-06-${day}T09:40:00.000Z`,
      actualStart: `2026-06-${day}T09:00:00.000Z`,
      actualEnd: `2026-06-${day}T09:40:00.000Z`,
    });
  });
  const breaks = Array.from({ length: 12 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return segment({
      runId: `run-break-${index + 1}`,
      phase: "short_break",
      plannedStart: `2026-06-${day}T09:40:00.000Z`,
      plannedEnd: `2026-06-${day}T09:45:00.000Z`,
      actualStart: `2026-06-${day}T09:40:00.000Z`,
      actualEnd: `2026-06-${day}T09:45:00.000Z`,
    });
  });
  return {
    ...emptyHistory(),
    segments: [...focusSegments, ...breaks],
  };
}

function emptyHistory(): PomodoroAdaptiveHistoryRead {
  return {
    segments: [],
    runEvents: [],
    blockEvents: [],
    previousStates: [],
    experimentStates: [],
    experimentOutcomes: [],
  };
}

function cleanOutcomeFeatures() {
  return extractAdaptiveFeatures({
    segments: [
      segment({
        runId: "clean-run",
        phase: "focus",
        plannedStart: "2026-06-20T09:00:00.000Z",
        plannedEnd: "2026-06-20T09:40:00.000Z",
        actualStart: "2026-06-20T09:00:00.000Z",
        actualEnd: "2026-06-20T09:40:00.000Z",
      }),
    ],
  });
}

function mostlyCleanOutcomeFeatures() {
  return extractAdaptiveFeatures({
    segments: [
      segment({
        runId: "mostly-clean-run",
        phase: "focus",
        plannedStart: "2026-06-20T09:00:00.000Z",
        plannedEnd: "2026-06-20T09:40:00.000Z",
        actualStart: "2026-06-20T09:00:00.000Z",
        actualEnd: "2026-06-20T09:37:00.000Z",
      }),
    ],
  });
}

function guardrailOutcomeFeatures() {
  return extractAdaptiveFeatures({
    segments: [
      segment({
        runId: "strained-run",
        phase: "focus",
        plannedStart: "2026-06-20T10:00:00.000Z",
        plannedEnd: "2026-06-20T10:40:00.000Z",
        actualStart: "2026-06-20T10:00:00.000Z",
        actualEnd: "2026-06-20T10:10:00.000Z",
        status: "interrupted",
        endReason: "focus_failed",
      }),
    ],
    runEvents: [
      stopEvent(),
    ],
    blockEvents: [
      blockedFocusEvent(),
    ],
  });
}

function stopEvent(): AdaptiveRunEventInput {
  return {
    eventType: "stop",
    occurredAt: "2026-06-20T10:10:00.000Z",
    phase: "focus",
    reason: "manual",
    durationSeconds: null,
  };
}

function blockedFocusEvent(): AdaptiveBlockEventInput {
  return {
    occurredAt: "2026-06-20T10:05:00.000Z",
    phase: "focus",
    sourceType: "browser",
    sourceKey: "social",
    decision: "blocked",
  };
}

function segment(
  overrides: Partial<AdaptiveSegmentInput>,
): AdaptiveSegmentInput {
  return {
    phase: "focus",
    plannedStart: "2026-06-01T09:00:00.000Z",
    plannedEnd: "2026-06-01T09:40:00.000Z",
    actualStart: "2026-06-01T09:00:00.000Z",
    actualEnd: "2026-06-01T09:40:00.000Z",
    status: "completed",
    endReason: "completed",
    pauseLog: [],
    ...overrides,
  };
}
