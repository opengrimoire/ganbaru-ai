import { expect, it, vi } from "vitest";

import { cadenceExpansionExperimentHistory, stableExperimentHistory } from "./adaptive-test-helpers";
import { ADAPTIVE_BASELINE_RHYTHM } from "./constants";
import { emptyAdaptiveFeatureVector } from "./features";
import { adaptiveContextKey } from "./persistence";
import {
  buildBoundedReplayRunStartPolicyCandidate,
  DEFAULT_BOUNDED_REPLAY_RUN_START_POLICY_CANDIDATE_INPUTS,
  evaluateGatedReplayRunStartPolicyCandidates,
  scoreReplayObservedOutcomesByCandidate,
  selectBestUsableReplayRunStartPolicyCandidateForContext,
  type AdaptiveReplayBoundedRunStartPolicyCandidateInput,
  type AdaptiveReplayObservedOutcome,
  type AdaptiveReplayPolicyGateOptions,
  type AdaptiveReplayRunStartOpportunity,
} from "./replay";

/** Capture complete gate, score, interaction and selection semantics for Rust. */
it("preserves replay approval, direct harm vetoes and component interactions", async () => {
  const rows = [];
  try {
    for (const zone of ["America/New_York", "America/Monterrey", "Asia/Kolkata"]) {
      vi.stubEnv("TZ", zone);
      for (const scenario of ["catalog", "fallback", "sparse", "matched", "harm", "component benefit", "antagonistic", "direct harm", "rounding", "protected mode"]) {
        const candidates: AdaptiveReplayBoundedRunStartPolicyCandidateInput[] = scenario === "catalog"
          ? [...DEFAULT_BOUNDED_REPLAY_RUN_START_POLICY_CANDIDATE_INPUTS]
          : [{ id: "combined", focusDurationDeltaMinutes: scenario === "rounding" ? -4.5 : 5, shortBreakDeltaMinutes: 2,
              ...(scenario === "protected mode" ? { allowedDecisionModes: ["fallback"] as const } : {}) }];
        const policies = candidates.map(buildBoundedReplayRunStartPolicyCandidate);
        const opportunities: AdaptiveReplayRunStartOpportunity[] = Array.from({ length: 3 }, (_, index) => ({
          id: `opportunity-${index}`, label: `run-${index}`,
          startedAt: "2026-06-20T05:59:59.999Z", plannedStart: "2026-06-20T05:00:00.000Z", plannedEnd: "2026-06-20T07:00:00.000Z",
          currentRhythm: ADAPTIVE_BASELINE_RHYTHM, idleDetectionEnabled: true,
          history: scenario === "fallback" ? null : index === 2 ? stableExperimentHistory() : cadenceExpansionExperimentHistory(),
        }));
        const clean = { ...emptyAdaptiveFeatureVector(), completedFocusSegments: 1, cleanFocusSeconds: 2400, plannedFocusSeconds: 2400 };
        const outcomes: AdaptiveReplayObservedOutcome[] = scenario === "sparse" ? [] : opportunities.map((opportunity, index) => {
          const policy = policies[0];
          const component = policy.componentCandidates?.[index - 1];
          const useComponent = index > 0 && (scenario === "component benefit" || scenario === "antagonistic");
          return {
            opportunityId: opportunity.id,
            observedRhythm: (useComponent && component ? component : policy).decide(opportunity).selectedRhythm,
            features: scenario === "harm" || (scenario === "antagonistic" && index === 0)
              ? { ...clean, completedFocusSegments: 0, interruptedFocusSegments: 1, focusFailureCount: 1, stopCount: 1, cleanFocusSeconds: 600, blockedAttemptCount: 2,
                  breakSkippedCount: 1, shortBreakOvertimeSeconds: 120, longBreakOvertimeSeconds: 300 }
              : scenario === "component benefit" && index > 0 ? { ...clean, cleanFocusSeconds: 2220 } : clean,
          };
        });
        const direct = scoreReplayObservedOutcomesByCandidate(
          outcomes.map((outcome) => scenario === "direct harm" ? { ...outcome, features: { ...clean, stopCount: 1 } } : outcome),
          new Map(opportunities.map((opportunity) => [opportunity.id, candidates[0].id])),
        );
        const options: AdaptiveReplayPolicyGateOptions = {
          minMatchedOutcomesPerContext: scenario === "sparse" ? 4 : 1,
          minInteractionMatchedOutcomes: 1,
          minObservedCandidateOutcomes: 1,
          maxGuardrailBreachRate: scenario === "antagonistic" ? 1 : 0.25,
          observedCandidateOutcomeScores: direct,
        };
        const expected = evaluateGatedReplayRunStartPolicyCandidates(opportunities, policies, outcomes, options);
        const contextKey = expected.evaluations[0].results[0] ? adaptiveContextKey(expected.evaluations[0].results[0].decision.context) : "";
        const instants = new Set(opportunities.flatMap((opportunity) => [Date.parse(opportunity.startedAt),
          ...(opportunity.history?.segments ?? []).map((segment) => Date.parse(segment.actualStart ?? segment.plannedStart))]));
        const facts = [...instants].sort((a, b) => a - b).map((epochMs) => {
          const date = new Date(epochMs);
          return { epochMs, dateKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
            dateString: date.toDateString(), hour: date.getHours() };
        });
        rows.push({ name: `${zone}: ${scenario}`, opportunities, candidates, outcomes, options, facts, expected, contextKey,
          selected: selectBestUsableReplayRunStartPolicyCandidateForContext(expected, contextKey)?.candidateId ?? null });
      }
    }
    expect(rows.some((row) => row.expected.usableCandidateIds.length > 0)).toBe(true);
    expect(rows.some((row) => row.expected.unsafeCandidateIds.length > 0)).toBe(true);
    expect(rows.some((row) => row.expected.interactions.some((interaction) => interaction.status === "antagonistic"))).toBe(true);
    await expect(`${JSON.stringify(rows)}\n`).toMatchFileSnapshot("../../../../../../crates/ganbaru-focus/fixtures/adaptive-replay-parity.json");
  } finally {
    vi.unstubAllEnvs();
  }
});
