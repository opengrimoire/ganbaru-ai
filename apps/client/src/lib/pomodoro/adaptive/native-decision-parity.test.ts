import { expect, it, vi } from "vitest";

import { ADAPTIVE_BASELINE_RHYTHM } from "./constants";
import { breakDriftExperimentHistory, cadenceExpansionExperimentHistory, cadenceExperimentHistory, experimentOutcome, experimentState, longBreakDriftExperimentHistory, stableExperimentHistory } from "./adaptive-test-helpers";
import { RUN_FOCUS_DURATION_EXPERIMENT, RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT, RUN_LONG_BREAK_CADENCE_EXPERIMENT, RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT, RUN_LONG_BREAK_DURATION_EXPERIMENT, RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT, RUN_SHORT_BREAK_DURATION_EXPERIMENT } from "./experiments";
import { decideBoundaryAdaptiveRhythm, decideRunStartAdaptiveRhythm, snapshotFromBoundaryAdaptiveDecision, snapshotFromRunStartAdaptiveDecision } from "./persistence";
import type { BuildRunStartAdaptiveDecisionInput, PomodoroAdaptiveHistoryRead } from "./persistence-types";
import type { CountPomodoroRhythm } from "../rhythm";

const contextId = "00000000-0000-4000-8000-000000000001";
const decisionId = "00000000-0000-4000-8000-000000000002";
const assignmentId = "00000000-0000-4000-8000-000000000003";

/** Preserve the complete decision and persisted schema before removing frontend policy. */
it("retains native decision and snapshot golden results across all experiment lanes and local dates", async () => {
  const lanes = [
    { definition: RUN_FOCUS_DURATION_EXPERIMENT, history: stableExperimentHistory(), rhythm: { focusDurationMinutes: 45 } },
    { definition: RUN_SHORT_BREAK_DURATION_EXPERIMENT, history: breakDriftExperimentHistory(), rhythm: { shortBreakMinutes: 7 } },
    { definition: RUN_LONG_BREAK_DURATION_EXPERIMENT, history: longBreakDriftExperimentHistory(), rhythm: { longBreakMinutes: 15 } },
    { definition: RUN_LONG_BREAK_CADENCE_EXPERIMENT, history: cadenceExperimentHistory(), rhythm: { longBreakAfterFocusCount: 3 } },
    { definition: RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT, history: cadenceExpansionExperimentHistory(), rhythm: { longBreakAfterFocusCount: 5 } },
    { definition: RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT, history: cadenceExpansionExperimentHistory(), rhythm: { focusDurationMinutes: 45, shortBreakMinutes: 7 } },
    { definition: RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT, history: longBreakDriftExperimentHistory(), rhythm: { longBreakMinutes: 15, longBreakAfterFocusCount: 3 } },
  ];
  const cases: Array<{ name: string; history: PomodoroAdaptiveHistoryRead | null; rhythm: CountPomodoroRhythm }> = [
    { name: "missing evidence", history: null, rhythm: ADAPTIVE_BASELINE_RHYTHM },
    { name: "empty evidence", history: { ...stableExperimentHistory(), segments: [] }, rhythm: ADAPTIVE_BASELINE_RHYTHM },
  ];
  for (const lane of lanes) {
    cases.push({ name: `${lane.definition.id}: baseline opportunity`, history: lane.history, rhythm: ADAPTIVE_BASELINE_RHYTHM });
    const row = (treatment: boolean, harmful: boolean) => experimentOutcome({
      experimentId: lane.definition.id, variantKey: lane.definition.variants[treatment ? 1 : 0].variantKey,
      runObservedCount: 16, runCompletedCount: treatment && harmful ? 4 : 16,
      cleanFocusSecondsSum: treatment && !harmful ? 48_000 : 38_400,
      cleanFocusSecondsSquareSum: treatment && !harmful ? 144_000_000 : 92_160_000,
    });
    const histories: Array<[string, PomodoroAdaptiveHistoryRead]> = [
      ["eligible", lane.history],
      ["abandoned", { ...lane.history, experimentStates: [experimentState({ experimentId: lane.definition.id, status: "abandoned", endedAt: "2026-06-10T09:00:00.000Z" })] }],
      ["completed", { ...lane.history, experimentStates: [experimentState({ experimentId: lane.definition.id, status: "completed", endedAt: "2026-06-10T09:00:00.000Z" })] }],
      ["control guardrail", { ...lane.history, experimentOutcomes: [row(false, true), row(true, true)] }],
      ["treatment benefit", { ...lane.history, experimentOutcomes: [row(false, false), row(true, false)] }],
      ["weekly exploration budget", { ...lane.history, experimentAssignments: [0, 1].map((index) => ({ experimentId: lane.definition.id, variantKey: lane.definition.variants[0].variantKey, contextKey: "morning:first:medium:low:unknown:none", assignedAt: `2026-06-15T0${index}:00:00.000Z` })) }],
    ];
    for (const [name, history] of histories) {
      cases.push({ name: `${lane.definition.id}: ${name}`, history, rhythm: { ...ADAPTIVE_BASELINE_RHYTHM, ...lane.rhythm } });
    }
  }
  const rows = [];
  const randomUuid = vi.spyOn(crypto, "randomUUID");
  try {
    for (const zone of ["America/New_York", "America/Monterrey", "Asia/Kolkata"]) {
      vi.stubEnv("TZ", zone);
      for (const entry of cases) {
        const input: BuildRunStartAdaptiveDecisionInput = {
          startedAt: "2026-06-15T05:59:59.999Z", plannedStart: "2026-06-15T05:00:00.000Z", plannedEnd: "2026-06-15T07:00:00.000Z",
          currentRhythm: entry.rhythm, idleDetectionEnabled: entry.history !== null, history: entry.history,
        };
        const instants = new Set([Date.parse(input.startedAt), ...(input.history?.segments ?? []).map((segment) => Date.parse(segment.actualStart ?? segment.plannedStart))]);
        const facts = [...instants].sort((a, b) => a - b).map((epochMs) => {
          const date = new Date(epochMs);
          return { epochMs, dateKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`, dateString: date.toDateString(), hour: date.getHours() };
        });
        const expected = decideRunStartAdaptiveRhythm(input);
        randomUuid.mockReturnValueOnce(contextId).mockReturnValueOnce(decisionId).mockReturnValueOnce(assignmentId);
        const snapshot = snapshotFromRunStartAdaptiveDecision(expected, { runId: "run", segmentId: "segment" });
        randomUuid.mockReset();
        const boundary = decideBoundaryAdaptiveRhythm({ ...input, opportunityKind: "focus_start" });
        randomUuid.mockReturnValueOnce(contextId).mockReturnValueOnce(decisionId);
        const envelope = snapshotFromBoundaryAdaptiveDecision(boundary, { runId: "run", segmentId: "segment" });
        randomUuid.mockReset();
        const withSnapshot = entry.name === "missing evidence" ||
          (entry.name.startsWith(RUN_FOCUS_DURATION_EXPERIMENT.id) &&
            (entry.name.endsWith("control guardrail") || entry.name.endsWith("baseline opportunity")));
        rows.push({ name: `${zone}: ${entry.name}`, input, facts, expected, boundary,
          ...(withSnapshot ? { snapshot, envelope } : {}) });
      }
    }
    await expect(`${JSON.stringify(rows, null, 2)}\n`).toMatchFileSnapshot("../../../../../../crates/ganbaru-focus/fixtures/adaptive-decision-parity.json");
  } finally {
    randomUuid.mockRestore();
    vi.unstubAllEnvs();
  }
});
