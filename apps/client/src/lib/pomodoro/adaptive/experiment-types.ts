import type {
  AdaptiveContextBucket,
  AdaptiveFeatureVector,
  AdaptiveParameterKey,
  AdaptiveStateScores,
} from "./types";
import type { CountPomodoroRhythm } from "$lib/pomodoro/rhythm";

export type AdaptiveAssignmentUnit = "phase" | "run" | "day" | "context";
export type AdaptiveExperimentStatus = "draft" | "active" | "paused" | "completed" | "abandoned";
export type AdaptiveExperimentParameterKey = AdaptiveParameterKey | "rhythm_bundle";

export interface AdaptiveExperimentVariant {
  variantKey: string;
  numericValue: number;
  isControl: boolean;
}

export interface AdaptiveExperimentDefinition {
  id: string;
  parameterKey: AdaptiveExperimentParameterKey;
  assignmentUnit: AdaptiveAssignmentUnit;
  status: AdaptiveExperimentStatus;
  variants: readonly AdaptiveExperimentVariant[];
}

export interface AdaptiveExperimentState {
  experimentId: string;
  status: AdaptiveExperimentStatus;
  startedAt: string | null;
  endedAt: string | null;
}

export interface AdaptiveExperimentAssignmentHistory {
  experimentId: string;
  variantKey: string;
  contextKey: string;
  assignedAt: string;
}

export interface AdaptiveExperimentAssignment {
  experiment: AdaptiveExperimentDefinition;
  variant: AdaptiveExperimentVariant;
  assignmentSeed: string;
  assignedAt: string;
  selectedRhythm: CountPomodoroRhythm;
}

export interface AdaptiveExperimentVariantOutcome {
  experimentId: string;
  variantKey: string;
  contextKey: string | null;
  assignmentCount: number;
  runObservedCount: number;
  runCompletedCount: number;
  runStoppedCount: number;
  cleanFocusSecondsSum: number;
  cleanFocusSecondsSquareSum: number;
  blockedAttemptCountSum: number;
  blockedAttemptCountSquareSum: number;
  breakSkippedCountSum: number;
  breakSkippedCountSquareSum: number;
  shortBreakOvertimeSecondsSum: number;
  shortBreakOvertimeSecondsSquareSum: number;
  longBreakOvertimeSecondsSum: number;
  longBreakOvertimeSecondsSquareSum: number;
  dayObservedCount: number;
  dayStartedPlannedPomodoroCountSum: number;
  dayMissedPlannedPomodoroCountSum: number;
  dayMissedPlannedPomodoroCountSquareSum: number;
  dayCleanFocusSecondsSum: number;
  dayBlockedAttemptCountSum: number;
  dayBlockedAttemptCountSquareSum: number;
  nextDayObservedCount: number;
  nextDayStartedRunCount: number;
  nextDayCleanFocusSecondsSum: number;
  nextDayBlockedAttemptCountSum: number;
}

export type AdaptiveExperimentAnalysisDecision =
  | "insufficient_data"
  | "continue"
  | "prefer_control"
  | "prefer_treatment";

export interface AdaptiveExperimentAnalysis {
  experimentId: string;
  controlVariantKey: string;
  treatmentVariantKey: string;
  controlObservedRuns: number;
  treatmentObservedRuns: number;
  controlCompletionRate: number;
  treatmentCompletionRate: number;
  controlStopRate: number;
  treatmentStopRate: number;
  controlCleanFocusSecondsMean: number;
  treatmentCleanFocusSecondsMean: number;
  controlBlockedAttemptsMean: number;
  treatmentBlockedAttemptsMean: number;
  controlBreakSkippedMean: number;
  treatmentBreakSkippedMean: number;
  controlShortBreakOvertimeSecondsMean: number;
  treatmentShortBreakOvertimeSecondsMean: number;
  controlLongBreakOvertimeSecondsMean: number;
  treatmentLongBreakOvertimeSecondsMean: number;
  controlDayMissedPlannedPomodoroMean: number | null;
  treatmentDayMissedPlannedPomodoroMean: number | null;
  controlDayBlockedAttemptsMean: number | null;
  treatmentDayBlockedAttemptsMean: number | null;
  controlNextDayStartedRate: number | null;
  treatmentNextDayStartedRate: number | null;
  analysisScope: "context" | "neighbor_pooled" | "pooled" | "global";
  guardrailBreached: boolean;
  decision: AdaptiveExperimentAnalysisDecision;
}

export interface SelectRunStartExperimentInput {
  occurredAt: string;
  currentRhythm: CountPomodoroRhythm;
  selectedRhythm: CountPomodoroRhythm;
  context: AdaptiveContextBucket;
  features: AdaptiveFeatureVector;
  state: AdaptiveStateScores;
  experimentOutcomes?: readonly AdaptiveExperimentVariantOutcome[];
  experimentStates?: readonly AdaptiveExperimentState[];
  experimentAssignments?: readonly AdaptiveExperimentAssignmentHistory[];
}

export const RUN_FOCUS_DURATION_EXPERIMENT: AdaptiveExperimentDefinition = {
  id: "run-focus-duration-40-vs-45-v1",
  parameterKey: "focus_duration_minutes",
  assignmentUnit: "run",
  status: "active",
  variants: [
    {
      variantKey: "control_40",
      numericValue: 40,
      isControl: true,
    },
    {
      variantKey: "focus_45",
      numericValue: 45,
      isControl: false,
    },
  ],
};

export const RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT: AdaptiveExperimentDefinition = {
  id: "run-focus-short-break-support-40-5-vs-45-7-v1",
  parameterKey: "rhythm_bundle",
  assignmentUnit: "run",
  status: "active",
  variants: [
    {
      variantKey: "control_40_5",
      numericValue: 0,
      isControl: true,
    },
    {
      variantKey: "focus_45_short_break_7",
      numericValue: 1,
      isControl: false,
    },
  ],
};

export const RUN_SHORT_BREAK_DURATION_EXPERIMENT: AdaptiveExperimentDefinition = {
  id: "run-short-break-duration-5-vs-7-v1",
  parameterKey: "short_break_minutes",
  assignmentUnit: "run",
  status: "active",
  variants: [
    {
      variantKey: "control_5",
      numericValue: 5,
      isControl: true,
    },
    {
      variantKey: "short_break_7",
      numericValue: 7,
      isControl: false,
    },
  ],
};

export const RUN_LONG_BREAK_DURATION_EXPERIMENT: AdaptiveExperimentDefinition = {
  id: "run-long-break-duration-10-vs-15-v1",
  parameterKey: "long_break_minutes",
  assignmentUnit: "run",
  status: "active",
  variants: [
    {
      variantKey: "control_10",
      numericValue: 10,
      isControl: true,
    },
    {
      variantKey: "long_break_15",
      numericValue: 15,
      isControl: false,
    },
  ],
};

export const RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT: AdaptiveExperimentDefinition = {
  id: "run-long-recovery-support-15-c4-vs-15-c3-v1",
  parameterKey: "rhythm_bundle",
  assignmentUnit: "run",
  status: "active",
  variants: [
    {
      variantKey: "long_break_15_cadence_4",
      numericValue: 0,
      isControl: true,
    },
    {
      variantKey: "long_break_15_cadence_3",
      numericValue: 1,
      isControl: false,
    },
  ],
};

export const RUN_LONG_BREAK_CADENCE_EXPERIMENT: AdaptiveExperimentDefinition = {
  id: "run-long-break-cadence-4-vs-3-v1",
  parameterKey: "long_break_after_focus_count",
  assignmentUnit: "run",
  status: "active",
  variants: [
    {
      variantKey: "control_4",
      numericValue: 4,
      isControl: true,
    },
    {
      variantKey: "cadence_3",
      numericValue: 3,
      isControl: false,
    },
  ],
};

export const RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT: AdaptiveExperimentDefinition = {
  id: "run-long-break-cadence-4-vs-5-v1",
  parameterKey: "long_break_after_focus_count",
  assignmentUnit: "run",
  status: "active",
  variants: [
    {
      variantKey: "control_4",
      numericValue: 4,
      isControl: true,
    },
    {
      variantKey: "cadence_5",
      numericValue: 5,
      isControl: false,
    },
  ],
};
