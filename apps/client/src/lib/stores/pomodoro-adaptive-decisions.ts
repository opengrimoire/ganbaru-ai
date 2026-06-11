import { invoke } from "@tauri-apps/api/core";

import { dbUrl } from "$lib/api/db";
import {
  DEFAULT_ADAPTIVE_POLICY_ID,
  adaptiveContextKey,
  decideBoundaryAdaptiveRhythm,
  decideRunStartAdaptiveRhythm,
  type PomodoroAdaptiveHistoryRead,
  type PomodoroBoundaryAdaptiveDecision,
  type PomodoroRunStartAdaptiveDecision,
} from "$lib/pomodoro/adaptive/persistence";
import {
  buildDefaultBoundedReplayRunStartPolicyCandidates,
  evaluateGatedReplayRunStartPolicyCandidates,
  selectBestUsableReplayRunStartPolicyCandidateForContext,
} from "$lib/pomodoro/adaptive/replay";
import {
  buildReplayObservedRunOutcomesFromDataset,
  buildReplayRunStartOpportunitiesFromDataset,
  scoreReplayObservedRunOutcomesByCandidateFromDataset,
  type PomodoroAdaptiveReplayDatasetRead,
} from "$lib/pomodoro/adaptive/replay-dataset";
import {
  clonePomodoroConfig,
  type CountPomodoroRhythm,
} from "$lib/pomodoro/rhythm";
import type { PomodoroConfig } from "./pomodoro-machine";

const ADAPTIVE_HISTORY_SEGMENT_LIMIT = 80;
const ADAPTIVE_REPLAY_DATASET_LIMIT = 50;

export function isAdaptiveCountConfig(
  value: PomodoroConfig,
): value is PomodoroConfig & {
  rhythm: CountPomodoroRhythm;
  rhythmSource: "preset";
  presetKey: "adaptive";
} {
  return value.rhythm.kind === "count" &&
    value.rhythmSource === "preset" &&
    value.presetKey === "adaptive";
}

interface RunStartAdaptiveStateInput {
  config: PomodoroConfig;
  idleDetectionEnabled: boolean;
  startedAt: string;
  plannedStart: string;
  plannedEnd: string;
}

interface BoundaryAdaptiveStateInput {
  config: PomodoroConfig;
  idleDetectionEnabled: boolean;
  activeBlockEndMs: number | null;
  activeSegmentPlannedEnd: string | null;
  opportunityKind: "focus_start" | "break_start";
  occurredAt: string;
}

export async function decideRunStartAdaptiveForState(
  input: RunStartAdaptiveStateInput,
): Promise<PomodoroRunStartAdaptiveDecision | null> {
  const configSnapshot = clonePomodoroConfig(input.config);
  if (!isAdaptiveCountConfig(configSnapshot)) return null;
  const history = await loadAdaptiveHistory(input.startedAt);
  const decisionInput = {
    startedAt: input.startedAt,
    plannedStart: input.plannedStart,
    plannedEnd: input.plannedEnd,
    currentRhythm: configSnapshot.rhythm,
    idleDetectionEnabled: input.idleDetectionEnabled,
    history,
  };
  const decision = decideRunStartAdaptiveRhythm(decisionInput);
  return selectReplayApprovedRunStartAdaptiveDecision(decisionInput, decision);
}

export async function decideBoundaryAdaptiveForState(
  input: BoundaryAdaptiveStateInput,
): Promise<PomodoroBoundaryAdaptiveDecision | null> {
  const configSnapshot = clonePomodoroConfig(input.config);
  if (!isAdaptiveCountConfig(configSnapshot)) return null;
  const plannedEnd = input.activeBlockEndMs === null
    ? input.activeSegmentPlannedEnd ?? input.occurredAt
    : new Date(input.activeBlockEndMs).toISOString();
  const history = await loadAdaptiveHistory(input.occurredAt);
  return decideBoundaryAdaptiveRhythm({
    opportunityKind: input.opportunityKind,
    startedAt: input.occurredAt,
    plannedStart: input.occurredAt,
    plannedEnd,
    currentRhythm: configSnapshot.rhythm,
    idleDetectionEnabled: input.idleDetectionEnabled,
    history,
  });
}

async function loadAdaptiveHistory(before: string): Promise<PomodoroAdaptiveHistoryRead | null> {
  try {
    return await invoke<PomodoroAdaptiveHistoryRead>("pomodoro_load_adaptive_history", {
      dbUrl: dbUrl(),
      before,
      policyId: DEFAULT_ADAPTIVE_POLICY_ID,
      segmentLimit: ADAPTIVE_HISTORY_SEGMENT_LIMIT,
    });
  } catch (e) {
    console.warn("Failed to load adaptive pomodoro history:", e);
    return null;
  }
}

async function loadAdaptiveReplayDataset(
  before: string,
): Promise<PomodoroAdaptiveReplayDatasetRead | null> {
  try {
    return await invoke<PomodoroAdaptiveReplayDatasetRead>("pomodoro_load_adaptive_replay_dataset", {
      dbUrl: dbUrl(),
      before,
      policyId: DEFAULT_ADAPTIVE_POLICY_ID,
      limit: ADAPTIVE_REPLAY_DATASET_LIMIT,
      historySegmentLimit: ADAPTIVE_HISTORY_SEGMENT_LIMIT,
    });
  } catch (e) {
    console.warn("Failed to load adaptive pomodoro replay dataset:", e);
    return null;
  }
}

async function selectReplayApprovedRunStartAdaptiveDecision(
  input: Parameters<typeof decideRunStartAdaptiveRhythm>[0],
  decision: PomodoroRunStartAdaptiveDecision,
): Promise<PomodoroRunStartAdaptiveDecision> {
  const dataset = await loadAdaptiveReplayDataset(input.startedAt);
  if (!dataset || dataset.opportunities.length === 0 || dataset.outcomes.length === 0) {
    return decision;
  }

  const candidates = buildDefaultBoundedReplayRunStartPolicyCandidates();
  const workflow = evaluateGatedReplayRunStartPolicyCandidates(
    buildReplayRunStartOpportunitiesFromDataset(dataset),
    candidates,
    buildReplayObservedRunOutcomesFromDataset(dataset),
    {
      observedCandidateOutcomeScores: scoreReplayObservedRunOutcomesByCandidateFromDataset(dataset),
    },
  );
  const review = selectBestUsableReplayRunStartPolicyCandidateForContext(
    workflow,
    adaptiveContextKey(decision.context),
  );
  if (!review) return decision;

  const candidate = candidates.find((entry) => entry.id === review.candidateId);
  if (!candidate) return decision;

  return candidate.decide({
    id: "current-run-start",
    ...input,
  });
}
