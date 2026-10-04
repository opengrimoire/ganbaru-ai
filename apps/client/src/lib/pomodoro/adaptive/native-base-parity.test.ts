import { expect, it, vi } from "vitest";

import { ADAPTIVE_BASELINE_RHYTHM } from "./constants";
import { CONTEXT, baseFeatures, blockedBurstEvents, breakSegment, focusSegment, runEvent, safeExperimentState } from "./adaptive-test-helpers";
import { deriveAdaptiveContextBucket, extractAdaptiveFeatures } from "./features";
import { selectAdaptiveRhythm } from "./policy";
import { deriveAdaptiveState } from "./state";
import { estimateMeanWithVariance, estimateRate } from "./statistics";
import type { AdaptiveFeatureInput, AdaptiveFeatureVector, AdaptiveStateScores } from "./types";

interface PolicyCase {
  name: string;
  features?: Partial<AdaptiveFeatureVector>;
  state?: Partial<AdaptiveStateScores>;
}

const policyCases: PolicyCase[] = [
  { name: "empty evidence", state: { confidence: 0 } },
  { name: "sparse evidence", features: { comparableOpportunityCount: 1 }, state: { confidence: 0.249 } },
  { name: "confidence threshold", state: { confidence: 0.25 } },
  { name: "failure recovery", features: { focusFailureCount: 1 }, state: { strain: 0.58 } },
  { name: "recovery debt", state: { recoveryDebt: 0.58 } },
  { name: "late repeated failure", features: { lateFocusSegmentCount: 2, lateFocusFailureCount: 2 } },
  { name: "skipped long break harm", features: { skippedLongBreakNextFocusFailureCount: 1 } },
  { name: "skipped short break harm", features: { skippedBreakNextFocusFailureCount: 2 } },
  { name: "earlier cadence", features: { lateFocusSegmentCount: 2, lateFocusFailureCount: 1 } },
  { name: "late contained pressure", features: { lateFocusSegmentCount: 2, lateFocusBlockedAttemptCount: 3 } },
  { name: "early idle", features: { earlyFocusIdlePauseCount: 2 }, state: { strain: 0.35 } },
  { name: "late idle", features: { lateFocusIdlePauseCount: 2 }, state: { recoveryDebt: 0.35 } },
  { name: "early manual finish", features: { earlyGoToBreakNowCount: 2 }, state: { strain: 0.35 } },
  { name: "late manual finish", features: { lateGoToBreakNowCount: 2 }, state: { recoveryDebt: 0.35 } },
  { name: "late blocker recovery", features: { lateFocusBlockedAttemptCount: 3 }, state: { recoveryDebt: 0.35 } },
  { name: "contained avoidance", state: { avoidancePressure: 0.58 } },
  { name: "repeated source hold", features: { focusRepeatedBlockedSourceAttemptCount: 3 } },
  { name: "strain guardrail", state: { strain: 0.58 } },
  { name: "avoidance guardrail", features: { interruptedFocusSegments: 1, blockedBurstCount: 1 }, state: { avoidancePressure: 0.58 } },
  { name: "overtime blocker hold", features: { shortBreakOvertimeSeconds: 120, shortBreakOvertimeBlockedAttemptCount: 1 } },
  { name: "short break support", features: { shortBreakOvertimeSeconds: 120 } },
  { name: "long break support", features: { longBreakOvertimeSeconds: 300 } },
  { name: "capacity cadence", features: { completedFocusSegments: 12, cleanFocusSeconds: 28_800, plannedFocusSeconds: 28_800, breakCompletedCount: 10, comparableOpportunityCount: 24 } },
  { name: "capacity focus" },
  { name: "ordinary hold", state: { momentum: 0.4 } },
  { name: "missing optional evidence", features: { dataQualityFlags: ["extension_unavailable", "diary_missing"] }, state: { confidence: 0.2 } },
];

function featureCases(): Array<{ name: string; input: AdaptiveFeatureInput }> {
  const paused = focusSegment({
    rhythmPosition: 3,
    pauseLog: [
      { startedAt: "2026-06-10T09:03:00.001Z", endedAt: "2026-06-10T09:05:00.002Z", reason: "idle" },
      { startedAt: "2026-06-10T09:20:00.000Z", endedAt: "2026-06-10T09:22:00.000Z", reason: "manual" },
      { startedAt: "2026-06-10T09:37:00.000Z", endedAt: "2026-06-10T09:39:00.000Z", reason: "idle" },
    ],
  });
  const earlyFocus = focusSegment({ actualEnd: "2026-06-10T09:35:00.000Z" });
  const earlyBreak = breakSegment({ plannedStart: "2026-06-10T09:35:00.000Z", actualStart: "2026-06-10T09:35:00.000Z", actualEnd: "2026-06-10T09:40:00.000Z" });
  const nextFocus = focusSegment({ plannedStart: "2026-06-10T09:40:00.000Z", plannedEnd: "2026-06-10T10:20:00.000Z", actualStart: "2026-06-10T09:40:00.000Z", actualEnd: "2026-06-10T10:20:00.000Z" });
  return [
    { name: "empty", input: { segments: [] } },
    { name: "completed phases", input: { segments: [focusSegment(), breakSegment()] } },
    { name: "pause clipping and subsecond rounding", input: { segments: [paused] } },
    { name: "failed focus and recorded failure", input: { segments: [focusSegment({ status: "interrupted", endReason: "focus_failed", rhythmPosition: 4 })], runEvents: [runEvent({ eventType: "focus_failed" })] } },
    { name: "inferred manual boundaries", input: { segments: [earlyFocus, earlyBreak, nextFocus] } },
    { name: "explicit manual boundary deduplication", input: { segments: [earlyFocus, earlyBreak, nextFocus], runEvents: [runEvent({ eventType: "go_to_break_now", phase: "focus", occurredAt: "2026-06-10T09:35:00.000Z" }), runEvent({ eventType: "start_focus_now", phase: "short_break", occurredAt: "2026-06-10T09:40:00.000Z" })] } },
    { name: "skipped break marker deduplication", input: { segments: [breakSegment({ actualEnd: "2026-06-10T09:40:00.000Z", status: "interrupted", endReason: "skipped_by_user" }), { ...nextFocus, status: "interrupted", endReason: "focus_failed" }], runEvents: [runEvent({ eventType: "skip_break", phase: "short_break", occurredAt: "2026-06-10T09:40:00.000Z" })] } },
    { name: "active observation with open pause", input: { segments: [focusSegment({ status: "active", actualEnd: null, endReason: null, pauseLog: [{ startedAt: "2026-06-10T09:10:00.000Z", endedAt: null, reason: "suspend" }] })], observationEndedAt: "2026-06-10T09:20:00.000Z" } },
    { name: "blocker bursts and repeated identities", input: { segments: [focusSegment()], blockEvents: blockedBurstEvents().map((event, index) => ({ ...event, sourceKey: index % 2 === 0 ? "same" : "other" })) } },
    { name: "break overtime blockers", input: { segments: [breakSegment({ actualEnd: "2026-06-10T09:48:00.000Z" })], blockEvents: ["2026-06-10T09:45:00.000Z", "2026-06-10T09:46:00.000Z", "2026-06-10T09:48:00.000Z"].map((occurredAt) => ({ occurredAt, phase: "short_break", sourceType: "browser", sourceKey: "social", decision: "blocked" })) } },
    { name: "quality and lifecycle events", input: { segments: [], dataQualityFlags: ["diary_missing", "diary_missing"], runEvents: [runEvent({ eventType: "crash_recovery" }), runEvent({ eventType: "stop" }), runEvent({ eventType: "extend_focus" })] } },
  ];
}

/** The checked-in JSON is consumed directly by native tests during the cutover. */
it("retains shared feature, state, policy, statistics, and local-time golden results", async () => {
  const features = featureCases().map(({ name, input }) => ({ name, input, expected: extractAdaptiveFeatures(input) }));
  const policies = policyCases.map(({ name, features: featureChanges, state: stateChanges }) => {
    const input = { currentRhythm: ADAPTIVE_BASELINE_RHYTHM, features: baseFeatures(featureChanges), state: { ...safeExperimentState(), ...stateChanges }, context: CONTEXT };
    return { name, input, expected: selectAdaptiveRhythm(input) };
  });
  const states = [...features.map((entry) => entry.expected), ...policies.map((entry) => entry.input.features)].flatMap((features) => [null, safeExperimentState()].map((previous) => ({ features, previous, expected: deriveAdaptiveState(features, previous) })));
  const instants = ["2026-03-08T06:59:00Z", "2026-03-08T07:01:00Z", "2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z", "2026-10-02T05:59:59Z", "2026-10-02T06:00:00Z"];
  const localTime = [];
  try {
    for (const zone of ["America/New_York", "America/Monterrey", "Asia/Kolkata"]) {
      vi.stubEnv("TZ", zone);
      const facts = instants.map((instant) => {
        const date = new Date(instant);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return { epochMs: date.getTime(), dateKey: `${year}-${month}-${day}`, dateString: date.toDateString(), hour: date.getHours(), context: deriveAdaptiveContextBucket({ localStartedAt: instant, plannedEventMinutes: 60, sessionIndexToday: 1, cleanFocusMinutesToday: 0, energyLevel: null, environmentId: null }) };
      });
      localTime.push({ zone, facts });
    }
  } finally { vi.unstubAllEnvs(); }
  const rates = [[0, 0], [4, 0], [12, 10], [-1, 10], [50, 100], [9, 10], [6, 10], [0.5, 1.5]].map(([successes, trials]) => ({ successes, trials, expected: estimateRate(successes, trials) }));
  const means = [[0, 0, 0], [60, 1400, 3], [900, 810_000, 10], [300, 9000, 10], [7.5, 37.5, 1.5]].map(([total, squareTotal, count]) => ({ total, squareTotal, count, expected: estimateMeanWithVariance(total, squareTotal, count) }));
  await expect(`${JSON.stringify({ features, policies, states, localTime, rates, means }, null, 2)}\n`).toMatchFileSnapshot("../../../../../../crates/ganbaru-focus/fixtures/adaptive-base-parity.json");
});
