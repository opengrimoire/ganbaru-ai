import type {
  AdaptiveAssignmentUnit,
  AdaptiveExperimentAssignment,
  AdaptiveExperimentAssignmentHistory,
  AdaptiveExperimentParameterKey,
  AdaptiveExperimentState,
  AdaptiveExperimentStatus,
  AdaptiveExperimentVariantOutcome,
} from "./experiments";
import type {
  AdaptiveBlockEventInput,
  AdaptiveContextBucket,
  AdaptiveDataQualityFlag,
  AdaptiveDecisionMode,
  AdaptiveFeatureSourceKind,
  AdaptiveFeatureVector,
  AdaptiveOpportunityKind,
  AdaptiveParameterKey,
  AdaptiveReasonCode,
  AdaptiveRunEventInput,
  AdaptiveSegmentInput,
  AdaptiveStateScores,
  AdaptiveValueUnit,
} from "./types";
import type { CountPomodoroRhythm } from "$lib/pomodoro/rhythm";

export const DEFAULT_ADAPTIVE_POLICY_ID = "local-adaptive-policy-v1";
export const DEFAULT_ADAPTIVE_POLICY_VERSION = 1;
export const DEFAULT_ADAPTIVE_MODEL_VERSION = 1;

export interface PomodoroAdaptiveContextSnapshotWrite {
  id: string;
  runId: string;
  segmentId: string | null;
  localStartedAt: string;
  timeOfDay: AdaptiveContextBucket["timeOfDay"];
  sessionPosition: AdaptiveContextBucket["sessionPosition"];
  eventLength: AdaptiveContextBucket["eventLength"];
  workload: AdaptiveContextBucket["workload"];
  energy: AdaptiveContextBucket["energy"];
  environmentId: string | null;
  features: PomodoroAdaptiveFeatureWrite[];
  dataQualityFlags: AdaptiveDataQualityFlag[];
}

export interface PomodoroAdaptiveFeatureWrite {
  featureKey: string;
  numericValue: number | null;
  categoricalValue: string | null;
  booleanValue: boolean | null;
  missing: boolean;
  sourceKind: AdaptiveFeatureSourceKind;
}

export interface PomodoroAdaptiveDecisionValueWrite {
  valueKey: AdaptiveParameterKey;
  previousNumericValue: number | null;
  selectedNumericValue: number;
  valueUnit: AdaptiveValueUnit;
}

export interface PomodoroAdaptiveDecisionWrite {
  id: string;
  policyId: string;
  runId: string;
  segmentId: string | null;
  contextSnapshotId: string;
  opportunityKind: AdaptiveOpportunityKind;
  candidateId: string | null;
  decisionMode: AdaptiveDecisionMode;
  policyVersion: number;
  modelVersion: number;
  occurredAt: string;
  values: PomodoroAdaptiveDecisionValueWrite[];
  reasonCodes: AdaptiveReasonCode[];
  stateScores: AdaptiveStateScores;
}

export interface PomodoroAdaptiveExperimentVariantWrite {
  variantKey: string;
  numericValue: number;
  isControl: boolean;
}

export interface PomodoroAdaptiveExperimentWrite {
  id: string;
  policyId: string;
  parameterKey: AdaptiveExperimentParameterKey;
  assignmentUnit: AdaptiveAssignmentUnit;
  status: AdaptiveExperimentStatus;
  startedAt: string | null;
  endedAt: string | null;
  variants: PomodoroAdaptiveExperimentVariantWrite[];
}

export interface PomodoroAdaptiveAssignmentWrite {
  id: string;
  experimentId: string;
  variantKey: string;
  runId: string;
  segmentId: string | null;
  contextSnapshotId: string;
  assignmentSeed: string;
  assignedAt: string;
}

export interface PomodoroAdaptiveExperimentAssignmentWrite {
  experiment: PomodoroAdaptiveExperimentWrite;
  assignment: PomodoroAdaptiveAssignmentWrite;
}

export type PomodoroAdaptivePlannedBlockSourceKind =
  | "live_event"
  | "archived_event"
  | "scheduler_snapshot";

export interface PomodoroAdaptivePlannedBlockWrite {
  eventDate: string;
  eventId: string | null;
  originalEventId: string;
  plannedStart: string;
  plannedEnd: string;
  sourceKind: PomodoroAdaptivePlannedBlockSourceKind;
}

export interface PomodoroRunAdaptiveSnapshotWrite {
  policyId: string;
  policyVersion: number;
  modelVersion: number;
  contextSnapshot: PomodoroAdaptiveContextSnapshotWrite;
  decision: PomodoroAdaptiveDecisionWrite;
  plannedBlocks: PomodoroAdaptivePlannedBlockWrite[];
  experimentUpdates: PomodoroAdaptiveExperimentWrite[];
  experimentAssignments: PomodoroAdaptiveExperimentAssignmentWrite[];
}

export interface PomodoroAdaptiveDecisionEnvelopeWrite {
  policyId: string;
  policyVersion: number;
  modelVersion: number;
  contextSnapshot: PomodoroAdaptiveContextSnapshotWrite;
  decision: PomodoroAdaptiveDecisionWrite;
  experimentUpdates: PomodoroAdaptiveExperimentWrite[];
  experimentAssignments: PomodoroAdaptiveExperimentAssignmentWrite[];
}

export interface PomodoroAdaptiveContextStateRead extends AdaptiveStateScores {
  contextKey: string;
}

export interface PomodoroAdaptiveHistoryRead {
  segments: AdaptiveSegmentInput[];
  runEvents: AdaptiveRunEventInput[];
  blockEvents: AdaptiveBlockEventInput[];
  previousStates: PomodoroAdaptiveContextStateRead[];
  experimentStates: AdaptiveExperimentState[];
  experimentOutcomes: AdaptiveExperimentVariantOutcome[];
  experimentAssignments?: AdaptiveExperimentAssignmentHistory[];
}

export interface BuildRunStartAdaptiveDecisionInput {
  startedAt: string;
  plannedStart: string;
  plannedEnd: string;
  currentRhythm: CountPomodoroRhythm;
  idleDetectionEnabled: boolean;
  history?: PomodoroAdaptiveHistoryRead | null;
}

export interface PomodoroRunStartAdaptiveDecision {
  policyId: string;
  policyVersion: number;
  modelVersion: number;
  occurredAt: string;
  currentRhythm: CountPomodoroRhythm;
  selectedRhythm: CountPomodoroRhythm;
  context: AdaptiveContextBucket;
  features: AdaptiveFeatureVector;
  decisionMode: AdaptiveDecisionMode;
  reasonCodes: AdaptiveReasonCode[];
  candidateId: string | null;
  stateScores: AdaptiveStateScores;
  experimentUpdate: PomodoroAdaptiveExperimentWrite | null;
  experimentAssignment: AdaptiveExperimentAssignment | null;
}

export interface BuildBoundaryAdaptiveDecisionInput extends BuildRunStartAdaptiveDecisionInput {
  opportunityKind: "focus_start" | "break_start";
}

export interface PomodoroBoundaryAdaptiveDecision extends PomodoroRunStartAdaptiveDecision {
  opportunityKind: "focus_start" | "break_start";
}

export interface BuildRunStartAdaptiveSnapshotInput extends BuildRunStartAdaptiveDecisionInput {
  runId: string;
  segmentId: string;
  plannedBlocks?: readonly PomodoroAdaptivePlannedBlockWrite[];
}

export interface RunStartAdaptiveSnapshotIds {
  runId: string;
  segmentId: string;
  plannedBlocks?: readonly PomodoroAdaptivePlannedBlockWrite[];
}
