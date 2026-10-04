import { expect, it, vi } from "vitest";

import { ADAPTIVE_BASELINE_RHYTHM } from "./constants";
import { CONTEXT, baseFeatures, breakDriftExperimentFeatures, cadenceExpansionExperimentFeatures, cadenceExperimentFeatures, experimentAssignmentHistory, experimentOutcome, experimentState, longBreakDriftExperimentFeatures, longRecoverySupportExperimentFeatures, safeExperimentState } from "./adaptive-test-helpers";
import { analyzeRunFocusDurationExperiment, analyzeRunFocusWithShortBreakSupportExperiment, analyzeRunLongBreakCadenceExperiment, analyzeRunLongBreakCadenceExpansionExperiment, analyzeRunLongBreakDurationExperiment, analyzeRunLongRecoverySupportExperiment, analyzeRunShortBreakDurationExperiment, experimentContextKey, experimentCooldownState, RUN_FOCUS_DURATION_EXPERIMENT, RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT, RUN_LONG_BREAK_CADENCE_EXPERIMENT, RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT, RUN_LONG_BREAK_DURATION_EXPERIMENT, RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT, RUN_SHORT_BREAK_DURATION_EXPERIMENT, selectRunStartExperimentAssignment, stableVariantIndex } from "./experiments";
import type { AdaptiveExperimentAnalysis, AdaptiveExperimentDefinition, AdaptiveExperimentVariantOutcome, SelectRunStartExperimentInput } from "./experiment-types";
import type { AdaptiveFeatureVector } from "./types";
import type { CountPomodoroRhythm } from "../rhythm";

interface Lane {
  lane: string;
  definition: AdaptiveExperimentDefinition;
  analyze: (outcomes: readonly AdaptiveExperimentVariantOutcome[], contextKey?: string) => AdaptiveExperimentAnalysis;
  features: AdaptiveFeatureVector;
  rhythm: Partial<CountPomodoroRhythm>;
}

const lanes: Lane[] = [
  { lane: "focus_duration", definition: RUN_FOCUS_DURATION_EXPERIMENT, analyze: analyzeRunFocusDurationExperiment, features: baseFeatures({ comparableOpportunityCount: 8 }), rhythm: { focusDurationMinutes: 45 } },
  { lane: "short_break", definition: RUN_SHORT_BREAK_DURATION_EXPERIMENT, analyze: analyzeRunShortBreakDurationExperiment, features: breakDriftExperimentFeatures(), rhythm: { shortBreakMinutes: 7 } },
  { lane: "long_break", definition: RUN_LONG_BREAK_DURATION_EXPERIMENT, analyze: analyzeRunLongBreakDurationExperiment, features: longBreakDriftExperimentFeatures(), rhythm: { longBreakMinutes: 15 } },
  { lane: "earlier_cadence", definition: RUN_LONG_BREAK_CADENCE_EXPERIMENT, analyze: analyzeRunLongBreakCadenceExperiment, features: cadenceExperimentFeatures(), rhythm: { longBreakAfterFocusCount: 3 } },
  { lane: "later_cadence", definition: RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT, analyze: analyzeRunLongBreakCadenceExpansionExperiment, features: cadenceExpansionExperimentFeatures(), rhythm: { longBreakAfterFocusCount: 5 } },
  { lane: "focus_support", definition: RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT, analyze: analyzeRunFocusWithShortBreakSupportExperiment, features: baseFeatures({ comparableOpportunityCount: 24, completedFocusSegments: 8, breakCompletedCount: 8 }), rhythm: { focusDurationMinutes: 45 } },
  { lane: "long_recovery", definition: RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT, analyze: analyzeRunLongRecoverySupportExperiment, features: longRecoverySupportExperimentFeatures(), rhythm: { longBreakMinutes: 15 } },
];

const occurredAt = "2026-06-10T09:00:00.000Z";
const contextKey = experimentContextKey(CONTEXT);

/** Build shared experiment fixtures from the policy being replaced. */
it("retains seven experiment lanes, cooldowns, evidence tiers, and UTF-16 assignments", async () => {
  vi.stubEnv("TZ", "America/Monterrey");
  try {
    const selection: Array<{ name: string; input: SelectRunStartExperimentInput; localDateString: string; expected: ReturnType<typeof selectRunStartExperimentAssignment> }> = [];
    for (const lane of lanes) {
      const input: SelectRunStartExperimentInput = { occurredAt, currentRhythm: { ...ADAPTIVE_BASELINE_RHYTHM }, selectedRhythm: { ...ADAPTIVE_BASELINE_RHYTHM, ...lane.rhythm }, context: CONTEXT, features: lane.features, state: safeExperimentState(), experimentOutcomes: [], experimentStates: [], experimentAssignments: [] };
      const variants: Array<[string, Partial<SelectRunStartExperimentInput>]> = [
        ["eligible", {}],
        ["other seed", { occurredAt: "2026-06-10T09:01:00.000Z" }],
        ["non-ASCII environment", { context: { ...CONTEXT, environmentId: "estudio-ñ-机-🌱" } }],
        ["insufficient evidence", { features: { ...input.features, comparableOpportunityCount: 7 } }],
        ["low confidence", { state: { ...input.state, confidence: 0.499 } }],
        ["missing extension", { features: { ...input.features, dataQualityFlags: ["extension_unavailable"] } }],
        ["high strain", { state: { ...input.state, strain: 0.58 } }],
        ["high recovery debt", { state: { ...input.state, recoveryDebt: 0.58 } }],
        ["high avoidance", { state: { ...input.state, avoidancePressure: 0.58 } }],
        ["changed baseline", { currentRhythm: { ...input.currentRhythm, shortBreakMinutes: 6 } }],
        ["completed cooldown", { experimentStates: [experimentState({ experimentId: lane.definition.id, status: "completed", endedAt: "2026-06-01T09:00:00.000Z" })] }],
        ["abandoned cooldown", { experimentStates: [experimentState({ experimentId: lane.definition.id, status: "abandoned", endedAt: "2026-06-01T09:00:00.000Z" })] }],
        ["expired cooldown", { experimentStates: [experimentState({ experimentId: lane.definition.id, status: "abandoned", endedAt: "2026-05-26T08:59:59.999Z" })] }],
        ["weekly budget exhausted", { experimentAssignments: [experimentAssignmentHistory({ experimentId: lane.definition.id }), experimentAssignmentHistory({ experimentId: lane.definition.id, assignedAt: "2026-06-08T09:00:00.000Z" })] }],
        ["other lane in current window", { experimentAssignments: [experimentAssignmentHistory({ experimentId: "other-lane" })] }],
        ["same lane in current window", { experimentAssignments: [experimentAssignmentHistory({ experimentId: lane.definition.id })] }],
        ["future assignment ignored", { experimentAssignments: [experimentAssignmentHistory({ experimentId: "other-lane", assignedAt: occurredAt })] }],
        ["old assignment ignored", { experimentAssignments: [experimentAssignmentHistory({ experimentId: "other-lane", assignedAt: "2026-06-03T08:59:59.999Z" })] }],
        ["week boundary included", { experimentAssignments: [experimentAssignmentHistory({ experimentId: "other-lane", assignedAt: "2026-06-03T09:00:00.000Z" })] }],
      ];
      for (const [name, changes] of variants) {
        const changed = { ...input, ...changes };
        selection.push({ name: `${lane.lane}: ${name}`, input: changed, localDateString: new Date(changed.occurredAt).toDateString(), expected: selectRunStartExperimentAssignment(changed) });
      }
    }
    const analysis = lanes.flatMap((lane) => {
      const row = (treatment: boolean, changes: Partial<AdaptiveExperimentVariantOutcome> = {}) => experimentOutcome({ experimentId: lane.definition.id, variantKey: lane.definition.variants[treatment ? 1 : 0].variantKey, contextKey, runObservedCount: 10, runCompletedCount: 9, cleanFocusSecondsSum: 24_000, cleanFocusSecondsSquareSum: 57_600_000, ...changes });
      const variants: Array<[string, AdaptiveExperimentVariantOutcome[]]> = [
        ["missing", []],
        ["sample threshold below", [row(false, { runObservedCount: 7 }), row(true, { runObservedCount: 7 })]],
        ["sample threshold exact", [row(false, { runObservedCount: 8 }), row(true, { runObservedCount: 8 })]],
        ["stable", [row(false), row(true)]],
        ["clean focus treatment benefit", [row(false), row(true, { cleanFocusSecondsSum: 27_000, cleanFocusSecondsSquareSum: 72_900_000 })]],
        ["severe completion harm", [row(false), row(true, { runCompletedCount: 6 })]],
        ["severe stop harm", [row(false), row(true, { runStoppedCount: 3 })]],
        ["blocking harm", [row(false), row(true, { blockedAttemptCountSum: 30, blockedAttemptCountSquareSum: 90 })]],
        ["break skipping harm", [row(false), row(true, { breakSkippedCountSum: 10, breakSkippedCountSquareSum: 10 })]],
        ["short drift harm", [row(false), row(true, { shortBreakOvertimeSecondsSum: 900, shortBreakOvertimeSecondsSquareSum: 81_000 })]],
        ["long drift harm", [row(false), row(true, { longBreakOvertimeSecondsSum: 1800, longBreakOvertimeSecondsSquareSum: 324_000 })]],
        ["day plan harm", [row(false, { dayObservedCount: 4 }), row(true, { dayObservedCount: 4, dayMissedPlannedPomodoroCountSum: 4, dayMissedPlannedPomodoroCountSquareSum: 4 })]],
        ["day blocking harm", [row(false, { dayObservedCount: 4 }), row(true, { dayObservedCount: 4, dayBlockedAttemptCountSum: 16, dayBlockedAttemptCountSquareSum: 64 })]],
        ["next day harm", [row(false, { nextDayObservedCount: 10, nextDayStartedRunCount: 10 }), row(true, { nextDayObservedCount: 10, nextDayStartedRunCount: 6 })]],
        ["neighbor pooling", [row(false, { runObservedCount: 4 }), row(true, { runObservedCount: 4 }), row(false, { contextKey: "midday:first:medium:low:unknown:none", runObservedCount: 40 }), row(true, { contextKey: "midday:first:medium:low:unknown:none", runObservedCount: 40 })]],
        ["global fallback", [row(false, { contextKey: "evening:late:long:high:high:other" }), row(true, { contextKey: "evening:late:long:high:high:other" })]],
      ];
      return variants.map(([name, outcomes]) => ({ name: `${lane.lane}: ${name}`, lane: lane.lane, outcomes, contextKey, expected: lane.analyze(outcomes, contextKey) }));
    });
    const cooldown = ["2026-05-27T08:59:59.999Z", "2026-05-27T09:00:00.000Z", "2026-06-10T09:00:00.000Z", "2026-06-10T09:00:00.001Z"].map((endedAt) => {
      const states = [experimentState({ status: "completed", endedAt }), experimentState({ status: "active", endedAt: null })];
      return { states, experimentId: RUN_FOCUS_DURATION_EXPERIMENT.id, occurredAt, expected: experimentCooldownState(states, RUN_FOCUS_DURATION_EXPERIMENT.id, occurredAt) };
    });
    const hashes = ["", "abc", "café", "𝌆", "工作-🌱", "a\u0000b"].flatMap((seed) => [0, 1, 2, 3, 7, 101].map((variantCount) => ({ seed, variantCount, expected: stableVariantIndex(seed, variantCount) })));
    await expect(`${JSON.stringify({ selection, analysis, cooldown, hashes }, null, 2)}\n`).toMatchFileSnapshot("../../../../../../crates/ganbaru-focus/fixtures/adaptive-experiment-parity.json");
  } finally { vi.unstubAllEnvs(); }
});
