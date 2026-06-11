import { emptyAdaptiveFeatureVector } from "./features";
import {
  scoreReplayObservedOutcomesByCandidate,
  type AdaptiveReplayCandidateObservedOutcomeScore,
  type AdaptiveReplayObservedOutcome,
  type AdaptiveReplayRunStartOpportunity,
} from "./replay";
import type { PomodoroAdaptiveHistoryRead } from "./persistence";
import type { CountPomodoroRhythm } from "$lib/pomodoro/rhythm";

export type AdaptiveReplayPersistedOutcomeWindow = "phase" | "run" | "day" | "next_day";

export interface AdaptiveReplayPersistedOutcomeRow {
  opportunityId: string;
  outcomeWindow: AdaptiveReplayPersistedOutcomeWindow;
  outcomeKey: string;
  numericValue: number | null;
  booleanValue: boolean | null;
  categoricalValue: string | null;
}

export interface BuildReplayObservedRunOutcomesOptions {
  observedRhythmsByOpportunity?: ReadonlyMap<string, CountPomodoroRhythm>;
}

export interface PomodoroAdaptiveReplayDatasetRead {
  opportunities: PomodoroAdaptiveReplayRunStartOpportunityRead[];
  outcomes: AdaptiveReplayPersistedOutcomeRow[];
  histories: PomodoroAdaptiveReplayOpportunityHistoryRead[];
}

export interface PomodoroAdaptiveReplayRunStartOpportunityRead {
  id: string;
  runId: string;
  startedAt: string;
  plannedStart: string;
  plannedEnd: string;
  candidateId: string | null;
  currentRhythm: CountPomodoroRhythm;
  selectedRhythm: CountPomodoroRhythm;
}

export interface PomodoroAdaptiveReplayOpportunityHistoryRead {
  opportunityId: string;
  history: PomodoroAdaptiveHistoryRead;
}

/**
 * Converts persisted run-window outcome rows into replay-observed outcomes.
 */
export function buildReplayObservedRunOutcomesFromRows(
  rows: readonly AdaptiveReplayPersistedOutcomeRow[],
  options: BuildReplayObservedRunOutcomesOptions = {},
): AdaptiveReplayObservedOutcome[] {
  const rowsByOpportunity = runRowsByOpportunity(rows);
  return [...rowsByOpportunity.entries()].map(([opportunityId, outcomeRows]) => {
    const observedRhythm = options.observedRhythmsByOpportunity?.get(opportunityId);
    const outcome = {
      opportunityId,
      features: runOutcomeFeatureVector(outcomeRows),
    };
    return observedRhythm ? { ...outcome, observedRhythm } : outcome;
  });
}

/**
 * Converts a persisted backend replay dataset into run-start opportunities.
 */
export function buildReplayRunStartOpportunitiesFromDataset(
  dataset: PomodoroAdaptiveReplayDatasetRead,
  historiesByOpportunity: ReadonlyMap<string, PomodoroAdaptiveHistoryRead | null> = new Map(),
): AdaptiveReplayRunStartOpportunity[] {
  const datasetHistories = new Map(
    dataset.histories.map((entry) => [entry.opportunityId, entry.history]),
  );
  return dataset.opportunities.map((opportunity) => ({
    id: opportunity.id,
    label: opportunity.runId,
    startedAt: opportunity.startedAt,
    plannedStart: opportunity.plannedStart,
    plannedEnd: opportunity.plannedEnd,
    currentRhythm: opportunity.currentRhythm,
    idleDetectionEnabled: true,
    history: historiesByOpportunity.has(opportunity.id)
      ? historiesByOpportunity.get(opportunity.id) ?? null
      : datasetHistories.get(opportunity.id) ?? null,
  }));
}

/**
 * Converts a persisted backend replay dataset into scored observed outcomes.
 */
export function buildReplayObservedRunOutcomesFromDataset(
  dataset: PomodoroAdaptiveReplayDatasetRead,
): AdaptiveReplayObservedOutcome[] {
  return buildReplayObservedRunOutcomesFromRows(dataset.outcomes, {
    observedRhythmsByOpportunity: new Map(
      dataset.opportunities.map((opportunity) => [opportunity.id, opportunity.selectedRhythm]),
    ),
  });
}

/**
 * Scores persisted run outcomes grouped by the replay candidate that produced them.
 */
export function scoreReplayObservedRunOutcomesByCandidateFromDataset(
  dataset: PomodoroAdaptiveReplayDatasetRead,
): AdaptiveReplayCandidateObservedOutcomeScore[] {
  return scoreReplayObservedOutcomesByCandidate(
    buildReplayObservedRunOutcomesFromDataset(dataset),
    new Map(
      dataset.opportunities.map((opportunity) => [opportunity.id, opportunity.candidateId]),
    ),
  );
}

function runRowsByOpportunity(
  rows: readonly AdaptiveReplayPersistedOutcomeRow[],
): Map<string, Map<string, AdaptiveReplayPersistedOutcomeRow>> {
  const rowsByOpportunity = new Map<string, Map<string, AdaptiveReplayPersistedOutcomeRow>>();
  for (const row of rows) {
    if (row.outcomeWindow !== "run") continue;
    const existingRows = rowsByOpportunity.get(row.opportunityId) ?? new Map();
    if (existingRows.has(row.outcomeKey)) {
      throw new Error(
        `Duplicate adaptive replay run outcome ${row.outcomeKey} for opportunity ${row.opportunityId}.`,
      );
    }
    existingRows.set(row.outcomeKey, row);
    rowsByOpportunity.set(row.opportunityId, existingRows);
  }
  return rowsByOpportunity;
}

function runOutcomeFeatureVector(
  rowsByKey: ReadonlyMap<string, AdaptiveReplayPersistedOutcomeRow>,
) {
  return {
    ...emptyAdaptiveFeatureVector(),
    completedFocusSegments: numericOutcome(rowsByKey, "completed_focus_segments"),
    interruptedFocusSegments: numericOutcome(rowsByKey, "interrupted_focus_segments"),
    focusFailureCount: numericOutcome(rowsByKey, "focus_failure_count"),
    cleanFocusSeconds: numericOutcome(rowsByKey, "clean_focus_seconds"),
    plannedFocusSeconds: numericOutcome(rowsByKey, "planned_focus_seconds"),
    idlePauseCount: numericOutcome(rowsByKey, "idle_pause_count"),
    idlePauseSeconds: numericOutcome(rowsByKey, "idle_pause_seconds"),
    manualPauseCount: numericOutcome(rowsByKey, "manual_pause_count"),
    manualPauseSeconds: numericOutcome(rowsByKey, "manual_pause_seconds"),
    suspendPauseCount: numericOutcome(rowsByKey, "suspend_pause_count"),
    suspendPauseSeconds: numericOutcome(rowsByKey, "suspend_pause_seconds"),
    breakStartedCount: numericOutcome(rowsByKey, "break_started_count"),
    breakCompletedCount: numericOutcome(rowsByKey, "break_completed_count"),
    breakSkippedCount: numericOutcome(rowsByKey, "break_skipped_count"),
    shortBreakOvertimeSeconds: numericOutcome(rowsByKey, "short_break_overtime_seconds"),
    longBreakOvertimeSeconds: numericOutcome(rowsByKey, "long_break_overtime_seconds"),
    blockedAttemptCount: numericOutcome(rowsByKey, "blocked_attempt_count"),
    stopCount: booleanOutcome(rowsByKey, "run_stopped") ? 1 : 0,
  };
}

function numericOutcome(
  rowsByKey: ReadonlyMap<string, AdaptiveReplayPersistedOutcomeRow>,
  key: string,
): number {
  const value = rowsByKey.get(key)?.numericValue;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanOutcome(
  rowsByKey: ReadonlyMap<string, AdaptiveReplayPersistedOutcomeRow>,
  key: string,
): boolean {
  return rowsByKey.get(key)?.booleanValue === true;
}
