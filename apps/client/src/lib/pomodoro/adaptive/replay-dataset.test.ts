import { describe, expect, it } from "vitest";
import {
  buildReplayObservedRunOutcomesFromDataset,
  buildReplayObservedRunOutcomesFromRows,
  buildReplayRunStartOpportunitiesFromDataset,
  scoreReplayObservedRunOutcomesByCandidateFromDataset,
  type AdaptiveReplayPersistedOutcomeRow,
  type PomodoroAdaptiveReplayDatasetRead,
} from "./replay-dataset";
import {
  joinReplayRunStartOutcomes,
  scoreReplayJoinedOutcomes,
} from "./replay";
import { decideRunStartAdaptiveRhythm } from "./persistence";
import { ADAPTIVE_BASELINE_RHYTHM } from "./constants";
import type { PomodoroAdaptiveHistoryRead } from "./persistence";

describe("adaptive replay dataset", () => {
  it("converts persisted run outcome rows into replay outcomes", () => {
    const decision = fallbackDecision();
    const outcomes = buildReplayObservedRunOutcomesFromRows(
      [
        numericRow("completed_focus_segments", 2),
        numericRow("interrupted_focus_segments", 1),
        numericRow("focus_failure_count", 1),
        numericRow("clean_focus_seconds", 3600),
        numericRow("planned_focus_seconds", 7200),
        numericRow("break_skipped_count", 1),
        numericRow("short_break_overtime_seconds", 180),
        numericRow("blocked_attempt_count", 3),
        booleanRow("run_stopped", true),
        numericRow("phase_blocked_attempt_count", 99, "phase"),
      ],
      {
        observedRhythmsByOpportunity: new Map([
          ["decision-1", decision.selectedRhythm],
        ]),
      },
    );
    const joined = joinReplayRunStartOutcomes([
      {
        opportunityId: "decision-1",
        decision,
      },
    ], outcomes);
    const score = scoreReplayJoinedOutcomes(joined, {
      attribution: "selected_rhythm_match",
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].features.completedFocusSegments).toBe(2);
    expect(outcomes[0].features.interruptedFocusSegments).toBe(1);
    expect(outcomes[0].features.blockedAttemptCount).toBe(3);
    expect(outcomes[0].features.stopCount).toBe(1);
    expect(score.scoredOutcomeCount).toBe(1);
    expect(score.guardrailReasonCounts.short_break_overtime).toBe(1);
    expect(score.guardrailReasonCounts.blocked_attempts).toBe(1);
  });

  it("rejects duplicate persisted run outcome keys for the same opportunity", () => {
    expect(() => buildReplayObservedRunOutcomesFromRows([
      numericRow("clean_focus_seconds", 1200),
      numericRow("clean_focus_seconds", 1800),
    ])).toThrow("Duplicate adaptive replay run outcome clean_focus_seconds");
  });

  it("ignores non-run outcome windows", () => {
    const outcomes = buildReplayObservedRunOutcomesFromRows([
      numericRow("phase_blocked_attempt_count", 2, "phase"),
    ]);

    expect(outcomes).toEqual([]);
  });

  it("converts backend replay datasets into opportunities and observed outcomes", () => {
    const dataset: PomodoroAdaptiveReplayDatasetRead = {
      opportunities: [
        {
          id: "decision-1",
          runId: "run-1",
          startedAt: "2026-06-20T09:00:00.000Z",
          plannedStart: "2026-06-20T09:00:00.000Z",
          plannedEnd: "2026-06-20T10:00:00.000Z",
          candidateId: null,
          currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
          selectedRhythm: {
            ...ADAPTIVE_BASELINE_RHYTHM,
            focusDurationMinutes: 45,
          },
        },
      ],
      outcomes: [
        numericRow("clean_focus_seconds", 2700),
      ],
      histories: [
        {
          opportunityId: "decision-1",
          history: emptyHistory(),
        },
      ],
    };
    const opportunities = buildReplayRunStartOpportunitiesFromDataset(dataset);
    const outcomes = buildReplayObservedRunOutcomesFromDataset(dataset);

    expect(opportunities).toEqual([
      {
        id: "decision-1",
        label: "run-1",
        startedAt: "2026-06-20T09:00:00.000Z",
        plannedStart: "2026-06-20T09:00:00.000Z",
        plannedEnd: "2026-06-20T10:00:00.000Z",
        currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
        idleDetectionEnabled: true,
        history: emptyHistory(),
      },
    ]);
    expect(outcomes[0].observedRhythm?.focusDurationMinutes).toBe(45);
  });

  it("scores observed run outcomes by persisted replay candidate id", () => {
    const cleanCandidate = "focus-growth-with-short-break-support";
    const strainedCandidate = "long-recovery-support";
    const dataset: PomodoroAdaptiveReplayDatasetRead = {
      opportunities: [
        replayOpportunity({
          id: "decision-clean",
          runId: "run-clean",
          candidateId: cleanCandidate,
        }),
        replayOpportunity({
          id: "decision-strained",
          runId: "run-strained",
          candidateId: strainedCandidate,
        }),
        replayOpportunity({
          id: "decision-control",
          runId: "run-control",
          candidateId: null,
        }),
      ],
      outcomes: [
        numericRow("clean_focus_seconds", 2400, "run", "decision-clean"),
        numericRow("planned_focus_seconds", 2400, "run", "decision-clean"),
        numericRow("completed_focus_segments", 1, "run", "decision-clean"),
        numericRow("clean_focus_seconds", 1200, "run", "decision-strained"),
        numericRow("planned_focus_seconds", 2400, "run", "decision-strained"),
        numericRow("interrupted_focus_segments", 1, "run", "decision-strained"),
        numericRow("blocked_attempt_count", 3, "run", "decision-strained"),
        booleanRow("run_stopped", true, "decision-strained"),
        numericRow("clean_focus_seconds", 2400, "run", "decision-control"),
      ],
      histories: [],
    };
    const scores = scoreReplayObservedRunOutcomesByCandidateFromDataset(dataset);

    expect(scores.map((score) => score.candidateId)).toEqual([
      cleanCandidate,
      strainedCandidate,
    ]);
    expect(scores[0].opportunityIds).toEqual(["decision-clean"]);
    expect(scores[0].outcomeScore.cleanFocusRatio).toBe(1);
    expect(scores[0].outcomeScore.guardrailBreachRate).toBe(0);
    expect(scores[1].opportunityIds).toEqual(["decision-strained"]);
    expect(scores[1].outcomeScore.guardrailBreachRate).toBe(1);
    expect(scores[1].outcomeScore.guardrailReasonCounts.blocked_attempts).toBe(1);
    expect(scores[1].outcomeScore.guardrailReasonCounts.stopped_run).toBe(1);
  });
});

function replayOpportunity(
  overrides: Partial<PomodoroAdaptiveReplayDatasetRead["opportunities"][number]>,
): PomodoroAdaptiveReplayDatasetRead["opportunities"][number] {
  return {
    id: "decision-1",
    runId: "run-1",
    startedAt: "2026-06-20T09:00:00.000Z",
    plannedStart: "2026-06-20T09:00:00.000Z",
    plannedEnd: "2026-06-20T10:00:00.000Z",
    candidateId: null,
    currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
    selectedRhythm: ADAPTIVE_BASELINE_RHYTHM,
    ...overrides,
  };
}

function fallbackDecision() {
  return decideRunStartAdaptiveRhythm({
    startedAt: "2026-06-20T09:00:00.000Z",
    plannedStart: "2026-06-20T09:00:00.000Z",
    plannedEnd: "2026-06-20T10:00:00.000Z",
    currentRhythm: ADAPTIVE_BASELINE_RHYTHM,
    idleDetectionEnabled: true,
    history: null,
  });
}

function numericRow(
  outcomeKey: string,
  numericValue: number,
  outcomeWindow: AdaptiveReplayPersistedOutcomeRow["outcomeWindow"] = "run",
  opportunityId = "decision-1",
): AdaptiveReplayPersistedOutcomeRow {
  return {
    opportunityId,
    outcomeWindow,
    outcomeKey,
    numericValue,
    booleanValue: null,
    categoricalValue: null,
  };
}

function booleanRow(
  outcomeKey: string,
  booleanValue: boolean,
  opportunityId = "decision-1",
): AdaptiveReplayPersistedOutcomeRow {
  return {
    opportunityId,
    outcomeWindow: "run",
    outcomeKey,
    numericValue: null,
    booleanValue,
    categoricalValue: null,
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
    experimentAssignments: [],
  };
}
