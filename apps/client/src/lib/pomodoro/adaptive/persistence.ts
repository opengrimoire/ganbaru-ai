import { deriveAdaptiveContextBucket, extractAdaptiveFeatures } from "./features";
import {
  dedupeDataQualityFlags,
  featureWrites,
} from "./persistence-features";
import {
  analyzeRunFocusDurationExperiment,
  analyzeRunFocusWithShortBreakSupportExperiment,
  analyzeRunLongBreakCadenceExperiment,
  analyzeRunLongBreakCadenceExpansionExperiment,
  analyzeRunLongBreakDurationExperiment,
  analyzeRunLongRecoverySupportExperiment,
  analyzeRunShortBreakDurationExperiment,
  experimentCooldownState,
  experimentContextKey,
  RUN_FOCUS_DURATION_EXPERIMENT,
  RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT,
  RUN_LONG_BREAK_CADENCE_EXPERIMENT,
  RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT,
  RUN_LONG_BREAK_DURATION_EXPERIMENT,
  RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT,
  RUN_SHORT_BREAK_DURATION_EXPERIMENT,
  selectRunStartExperimentAssignment,
  type AdaptiveExperimentAssignment,
  type AdaptiveExperimentDefinition,
  type AdaptiveExperimentStatus,
} from "./experiments";
import {
  DEFAULT_ADAPTIVE_MODEL_VERSION,
  DEFAULT_ADAPTIVE_POLICY_ID,
  DEFAULT_ADAPTIVE_POLICY_VERSION,
  type BuildBoundaryAdaptiveDecisionInput,
  type BuildRunStartAdaptiveDecisionInput,
  type BuildRunStartAdaptiveSnapshotInput,
  type PomodoroAdaptiveContextSnapshotWrite,
  type PomodoroAdaptiveContextStateRead,
  type PomodoroAdaptiveDecisionEnvelopeWrite,
  type PomodoroAdaptiveDecisionValueWrite,
  type PomodoroAdaptiveDecisionWrite,
  type PomodoroAdaptiveExperimentAssignmentWrite,
  type PomodoroAdaptiveExperimentWrite,
  type PomodoroAdaptiveFeatureWrite,
  type PomodoroAdaptiveHistoryRead,
  type PomodoroAdaptivePlannedBlockWrite,
  type PomodoroBoundaryAdaptiveDecision,
  type PomodoroRunAdaptiveSnapshotWrite,
  type PomodoroRunStartAdaptiveDecision,
  type RunStartAdaptiveSnapshotIds,
} from "./persistence-types";
import { selectAdaptiveRhythm } from "./policy";
import { deriveAdaptiveState } from "./state";
import type {
  AdaptiveContextBucket,
  AdaptiveDataQualityFlag,
  AdaptiveFeatureVector,
  AdaptiveParameterKey,
  AdaptiveReasonCode,
  AdaptiveSegmentInput,
  AdaptiveStateScores,
  AdaptiveValueUnit,
} from "./types";
import type { CountPomodoroRhythm } from "$lib/pomodoro/rhythm";

export * from "./persistence-types";

/**
 * Selects the effective run-start rhythm for Adaptive mode.
 */
export function decideRunStartAdaptiveRhythm(
  input: BuildRunStartAdaptiveDecisionInput,
): PomodoroRunStartAdaptiveDecision {
  const decision = decideAdaptiveRhythm(input);
  const experimentOutcomes = input.history?.experimentOutcomes ?? [];
  const experimentStates = input.history?.experimentStates ?? [];
  const focusSupportCooldownState = experimentCooldownState(
    experimentStates,
    RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT.id,
    input.startedAt,
  );
  if (
    focusSupportCooldownState?.status === "abandoned" &&
    decision.selectedRhythm.focusDurationMinutes > 40 &&
    decision.selectedRhythm.shortBreakMinutes > 5
  ) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        shortBreakMinutes: 5,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: null,
      experimentAssignment: null,
    };
  }
  const focusSupportExperimentAnalysis = analyzeRunFocusWithShortBreakSupportExperiment(
    experimentOutcomes,
    experimentContextKey(decision.context),
  );
  if (
    focusSupportExperimentAnalysis.decision === "prefer_control" &&
    decision.selectedRhythm.focusDurationMinutes > 40 &&
    decision.selectedRhythm.shortBreakMinutes > 5
  ) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        shortBreakMinutes: 5,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: focusSupportCooldownState?.status === "abandoned"
        ? null
        : experimentWrite(RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT, input.startedAt, "abandoned"),
      experimentAssignment: null,
    };
  }
  if (
    focusSupportExperimentAnalysis.decision === "prefer_control" &&
    focusSupportCooldownState?.status !== "abandoned" &&
    !decision.experimentUpdate
  ) {
    decision.experimentUpdate = experimentWrite(
      RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT,
      input.startedAt,
      "abandoned",
    );
  }
  if (
    focusSupportExperimentAnalysis.decision === "prefer_treatment" &&
    focusSupportCooldownState?.status !== "completed"
  ) {
    if (
      decision.selectedRhythm.focusDurationMinutes === 45 &&
      decision.selectedRhythm.shortBreakMinutes < 7
    ) {
      decision.selectedRhythm = {
        ...decision.selectedRhythm,
        shortBreakMinutes: 7,
      };
    }
    decision.experimentUpdate = experimentWrite(
      RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT,
      input.startedAt,
      "completed",
    );
  }
  const focusCooldownState = experimentCooldownState(
    experimentStates,
    RUN_FOCUS_DURATION_EXPERIMENT.id,
    input.startedAt,
  );
  if (focusCooldownState?.status === "abandoned" && decision.selectedRhythm.focusDurationMinutes > 40) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        focusDurationMinutes: 40,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: null,
      experimentAssignment: null,
    };
  }
  const experimentAnalysis = analyzeRunFocusDurationExperiment(
    experimentOutcomes,
    experimentContextKey(decision.context),
  );
  if (
    experimentAnalysis.decision === "prefer_control" &&
    decision.selectedRhythm.focusDurationMinutes > 40
  ) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        focusDurationMinutes: 40,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: focusCooldownState?.status === "abandoned"
        ? null
        : experimentWrite(RUN_FOCUS_DURATION_EXPERIMENT, input.startedAt, "abandoned"),
      experimentAssignment: null,
    };
  }
  if (
    experimentAnalysis.decision === "prefer_treatment" &&
    focusCooldownState?.status !== "completed" &&
    !decision.experimentUpdate
  ) {
    decision.experimentUpdate = experimentWrite(RUN_FOCUS_DURATION_EXPERIMENT, input.startedAt, "completed");
  }
  const shortBreakCooldownState = experimentCooldownState(
    experimentStates,
    RUN_SHORT_BREAK_DURATION_EXPERIMENT.id,
    input.startedAt,
  );
  if (shortBreakCooldownState?.status === "abandoned" && decision.selectedRhythm.shortBreakMinutes > 5) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        shortBreakMinutes: 5,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: null,
      experimentAssignment: null,
    };
  }
  const shortBreakExperimentAnalysis = analyzeRunShortBreakDurationExperiment(
    experimentOutcomes,
    experimentContextKey(decision.context),
  );
  if (
    shortBreakExperimentAnalysis.decision === "prefer_control" &&
    decision.selectedRhythm.shortBreakMinutes > 5
  ) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        shortBreakMinutes: 5,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: shortBreakCooldownState?.status === "abandoned"
        ? null
        : experimentWrite(RUN_SHORT_BREAK_DURATION_EXPERIMENT, input.startedAt, "abandoned"),
      experimentAssignment: null,
    };
  }
  if (
    shortBreakExperimentAnalysis.decision === "prefer_treatment" &&
    shortBreakCooldownState?.status !== "completed" &&
    !decision.experimentUpdate
  ) {
    decision.experimentUpdate = experimentWrite(
      RUN_SHORT_BREAK_DURATION_EXPERIMENT,
      input.startedAt,
      "completed",
    );
  }
  const longRecoverySupportCooldownState = experimentCooldownState(
    experimentStates,
    RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT.id,
    input.startedAt,
  );
  if (
    longRecoverySupportCooldownState?.status === "abandoned" &&
    decision.selectedRhythm.longBreakMinutes > 10 &&
    decision.selectedRhythm.longBreakAfterFocusCount < 4
  ) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        longBreakAfterFocusCount: 4,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: null,
      experimentAssignment: null,
    };
  }
  const longRecoverySupportExperimentAnalysis = analyzeRunLongRecoverySupportExperiment(
    experimentOutcomes,
    experimentContextKey(decision.context),
  );
  if (
    longRecoverySupportExperimentAnalysis.decision === "prefer_control" &&
    decision.selectedRhythm.longBreakMinutes > 10 &&
    decision.selectedRhythm.longBreakAfterFocusCount < 4
  ) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        longBreakAfterFocusCount: 4,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: longRecoverySupportCooldownState?.status === "abandoned"
        ? null
        : experimentWrite(RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT, input.startedAt, "abandoned"),
      experimentAssignment: null,
    };
  }
  if (
    longRecoverySupportExperimentAnalysis.decision === "prefer_control" &&
    longRecoverySupportCooldownState?.status !== "abandoned" &&
    !decision.experimentUpdate
  ) {
    decision.experimentUpdate = experimentWrite(
      RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT,
      input.startedAt,
      "abandoned",
    );
  }
  if (
    longRecoverySupportExperimentAnalysis.decision === "prefer_treatment" &&
    longRecoverySupportCooldownState?.status !== "completed"
  ) {
    if (
      decision.selectedRhythm.longBreakMinutes === 15 &&
      decision.selectedRhythm.longBreakAfterFocusCount > 3
    ) {
      decision.selectedRhythm = {
        ...decision.selectedRhythm,
        longBreakAfterFocusCount: 3,
      };
    }
    if (!decision.experimentUpdate) {
      decision.experimentUpdate = experimentWrite(
        RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT,
        input.startedAt,
        "completed",
      );
    }
  }
  const longBreakCooldownState = experimentCooldownState(
    experimentStates,
    RUN_LONG_BREAK_DURATION_EXPERIMENT.id,
    input.startedAt,
  );
  if (longBreakCooldownState?.status === "abandoned" && decision.selectedRhythm.longBreakMinutes > 10) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        longBreakMinutes: 10,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: null,
      experimentAssignment: null,
    };
  }
  const longBreakExperimentAnalysis = analyzeRunLongBreakDurationExperiment(
    experimentOutcomes,
    experimentContextKey(decision.context),
  );
  if (
    longBreakExperimentAnalysis.decision === "prefer_control" &&
    decision.selectedRhythm.longBreakMinutes > 10
  ) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        longBreakMinutes: 10,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: longBreakCooldownState?.status === "abandoned"
        ? null
        : experimentWrite(RUN_LONG_BREAK_DURATION_EXPERIMENT, input.startedAt, "abandoned"),
      experimentAssignment: null,
    };
  }
  if (
    longBreakExperimentAnalysis.decision === "prefer_treatment" &&
    longBreakCooldownState?.status !== "completed" &&
    !decision.experimentUpdate
  ) {
    decision.experimentUpdate = experimentWrite(
      RUN_LONG_BREAK_DURATION_EXPERIMENT,
      input.startedAt,
      "completed",
    );
  }
  const longBreakCadenceCooldownState = experimentCooldownState(
    experimentStates,
    RUN_LONG_BREAK_CADENCE_EXPERIMENT.id,
    input.startedAt,
  );
  if (
    longBreakCadenceCooldownState?.status === "abandoned" &&
    decision.selectedRhythm.longBreakAfterFocusCount < 4
  ) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        longBreakAfterFocusCount: 4,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: null,
      experimentAssignment: null,
    };
  }
  const longBreakCadenceExperimentAnalysis = analyzeRunLongBreakCadenceExperiment(
    experimentOutcomes,
    experimentContextKey(decision.context),
  );
  if (
    longBreakCadenceExperimentAnalysis.decision === "prefer_control" &&
    decision.selectedRhythm.longBreakAfterFocusCount < 4
  ) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        longBreakAfterFocusCount: 4,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: longBreakCadenceCooldownState?.status === "abandoned"
        ? null
        : experimentWrite(RUN_LONG_BREAK_CADENCE_EXPERIMENT, input.startedAt, "abandoned"),
      experimentAssignment: null,
    };
  }
  if (
    longBreakCadenceExperimentAnalysis.decision === "prefer_treatment" &&
    longBreakCadenceCooldownState?.status !== "completed" &&
    !decision.experimentUpdate
  ) {
    decision.experimentUpdate = experimentWrite(
      RUN_LONG_BREAK_CADENCE_EXPERIMENT,
      input.startedAt,
      "completed",
    );
  }
  const longBreakCadenceExpansionCooldownState = experimentCooldownState(
    experimentStates,
    RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT.id,
    input.startedAt,
  );
  if (
    longBreakCadenceExpansionCooldownState?.status === "abandoned" &&
    decision.selectedRhythm.longBreakAfterFocusCount > 4
  ) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        longBreakAfterFocusCount: 4,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: null,
      experimentAssignment: null,
    };
  }
  const longBreakCadenceExpansionExperimentAnalysis = analyzeRunLongBreakCadenceExpansionExperiment(
    experimentOutcomes,
    experimentContextKey(decision.context),
  );
  if (
    longBreakCadenceExpansionExperimentAnalysis.decision === "prefer_control" &&
    decision.selectedRhythm.longBreakAfterFocusCount > 4
  ) {
    return {
      ...decision,
      selectedRhythm: {
        ...decision.selectedRhythm,
        longBreakAfterFocusCount: 4,
      },
      decisionMode: "guardrail",
      reasonCodes: dedupeReasonCodes([
        ...decision.reasonCodes,
        "experiment_guardrail",
      ]),
      experimentUpdate: longBreakCadenceExpansionCooldownState?.status === "abandoned"
        ? null
        : experimentWrite(RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT, input.startedAt, "abandoned"),
      experimentAssignment: null,
    };
  }
  if (
    longBreakCadenceExpansionExperimentAnalysis.decision === "prefer_treatment" &&
    longBreakCadenceExpansionCooldownState?.status !== "completed" &&
    !decision.experimentUpdate
  ) {
    decision.experimentUpdate = experimentWrite(
      RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT,
      input.startedAt,
      "completed",
    );
  }
  const experimentAssignment = selectRunStartExperimentAssignment({
    occurredAt: input.startedAt,
    currentRhythm: decision.currentRhythm,
    selectedRhythm: decision.selectedRhythm,
    context: decision.context,
    features: decision.features,
    state: decision.stateScores,
    experimentOutcomes,
    experimentStates,
    experimentAssignments: input.history?.experimentAssignments,
  });
  if (!experimentAssignment) return decision;

  return {
    ...decision,
    selectedRhythm: { ...experimentAssignment.selectedRhythm },
    decisionMode: "explore",
    reasonCodes: dedupeReasonCodes([
      ...decision.reasonCodes,
      "experiment_assignment",
    ]),
    experimentAssignment,
  };
}

/**
 * Selects the effective rhythm for an Adaptive phase boundary.
 */
export function decideBoundaryAdaptiveRhythm(
  input: BuildBoundaryAdaptiveDecisionInput,
): PomodoroBoundaryAdaptiveDecision {
  return {
    ...decideAdaptiveRhythm(input),
    opportunityKind: input.opportunityKind,
  };
}

function decideAdaptiveRhythm(
  input: BuildRunStartAdaptiveDecisionInput,
): PomodoroRunStartAdaptiveDecision {
  const dataQualityFlags: AdaptiveDataQualityFlag[] = ["diary_missing"];
  if (!input.idleDetectionEnabled) dataQualityFlags.push("idle_detection_disabled");

  const history = input.history ?? null;
  const historyQualityFlags: AdaptiveDataQualityFlag[] = history ? [] : ["extension_unavailable"];
  const features = extractAdaptiveFeatures({
    segments: history?.segments ?? [],
    runEvents: history?.runEvents ?? [],
    blockEvents: history?.blockEvents ?? [],
    dataQualityFlags: dedupeDataQualityFlags([
      ...dataQualityFlags,
      ...historyQualityFlags,
    ]),
    observationEndedAt: input.startedAt,
  });
  const context = deriveAdaptiveContextBucket({
    localStartedAt: input.startedAt,
    plannedEventMinutes: minutesBetween(input.plannedStart, input.plannedEnd),
    sessionIndexToday: sessionIndexToday(history?.segments ?? [], input.startedAt),
    cleanFocusMinutesToday: cleanFocusMinutesToday(history?.segments ?? [], input.startedAt),
    energyLevel: null,
    environmentId: null,
  });
  const previousState = previousAdaptiveStateForContext(context, history?.previousStates ?? []);
  const state = deriveAdaptiveState(features, previousState);
  const decision = selectAdaptiveRhythm({
    currentRhythm: input.currentRhythm,
    features,
    state,
    context,
  });

  return {
    policyId: DEFAULT_ADAPTIVE_POLICY_ID,
    policyVersion: DEFAULT_ADAPTIVE_POLICY_VERSION,
    modelVersion: DEFAULT_ADAPTIVE_MODEL_VERSION,
    occurredAt: input.startedAt,
    currentRhythm: { ...input.currentRhythm },
    selectedRhythm: { ...decision.selectedRhythm },
    context,
    features,
    decisionMode: decision.mode,
    reasonCodes: [...decision.reasonCodes],
    candidateId: null,
    stateScores: decision.stateScores,
    experimentUpdate: null,
    experimentAssignment: null,
  };
}

/**
 * Builds the persisted snapshot for a previously selected run-start decision.
 */
export function snapshotFromRunStartAdaptiveDecision(
  decision: PomodoroRunStartAdaptiveDecision,
  ids: RunStartAdaptiveSnapshotIds,
): PomodoroRunAdaptiveSnapshotWrite {
  const contextSnapshotId = crypto.randomUUID();
  const decisionId = crypto.randomUUID();

  const experimentAssignments = decision.experimentAssignment
    ? [experimentAssignmentWrite(decision.experimentAssignment, ids, contextSnapshotId, decision.policyId)]
    : [];
  const experimentUpdates = decision.experimentUpdate ? [decision.experimentUpdate] : [];

  return {
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    modelVersion: decision.modelVersion,
    contextSnapshot: {
      id: contextSnapshotId,
      runId: ids.runId,
      segmentId: ids.segmentId,
      localStartedAt: decision.occurredAt,
      timeOfDay: decision.context.timeOfDay,
      sessionPosition: decision.context.sessionPosition,
      eventLength: decision.context.eventLength,
      workload: decision.context.workload,
      energy: decision.context.energy,
      environmentId: decision.context.environmentId,
      features: featureWrites(decision.features),
      dataQualityFlags: [...decision.features.dataQualityFlags],
    },
    decision: {
      id: decisionId,
      policyId: decision.policyId,
      runId: ids.runId,
      segmentId: ids.segmentId,
      contextSnapshotId,
      opportunityKind: "run_start",
      candidateId: decision.candidateId,
      decisionMode: decision.decisionMode,
      policyVersion: decision.policyVersion,
      modelVersion: decision.modelVersion,
      occurredAt: decision.occurredAt,
      values: decisionValueWrites(decision.currentRhythm, decision.selectedRhythm),
      reasonCodes: [...decision.reasonCodes],
      stateScores: decision.stateScores,
    },
    plannedBlocks: clonePlannedBlocks(ids.plannedBlocks ?? []),
    experimentUpdates,
    experimentAssignments,
  };
}

/**
 * Builds a run-start snapshot when the caller does not need the draft separately.
 */
export function buildRunStartAdaptiveSnapshot(
  input: BuildRunStartAdaptiveSnapshotInput,
): PomodoroRunAdaptiveSnapshotWrite {
  return snapshotFromRunStartAdaptiveDecision(decideRunStartAdaptiveRhythm(input), {
    runId: input.runId,
    segmentId: input.segmentId,
    plannedBlocks: input.plannedBlocks,
  });
}

/**
 * Builds a persisted adaptive decision envelope for a phase boundary.
 */
export function snapshotFromBoundaryAdaptiveDecision(
  decision: PomodoroBoundaryAdaptiveDecision,
  ids: RunStartAdaptiveSnapshotIds,
): PomodoroAdaptiveDecisionEnvelopeWrite {
  const contextSnapshotId = crypto.randomUUID();
  const decisionId = crypto.randomUUID();

  return {
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    modelVersion: decision.modelVersion,
    contextSnapshot: {
      id: contextSnapshotId,
      runId: ids.runId,
      segmentId: ids.segmentId,
      localStartedAt: decision.occurredAt,
      timeOfDay: decision.context.timeOfDay,
      sessionPosition: decision.context.sessionPosition,
      eventLength: decision.context.eventLength,
      workload: decision.context.workload,
      energy: decision.context.energy,
      environmentId: decision.context.environmentId,
      features: featureWrites(decision.features),
      dataQualityFlags: [...decision.features.dataQualityFlags],
    },
    decision: {
      id: decisionId,
      policyId: decision.policyId,
      runId: ids.runId,
      segmentId: ids.segmentId,
      contextSnapshotId,
      opportunityKind: decision.opportunityKind,
      candidateId: decision.candidateId,
      decisionMode: decision.decisionMode,
      policyVersion: decision.policyVersion,
      modelVersion: decision.modelVersion,
      occurredAt: decision.occurredAt,
      values: decisionValueWrites(decision.currentRhythm, decision.selectedRhythm),
      reasonCodes: [...decision.reasonCodes],
      stateScores: decision.stateScores,
    },
    experimentUpdates: decision.experimentUpdate ? [decision.experimentUpdate] : [],
    experimentAssignments: [],
  };
}

/**
 * Builds the stable key used to isolate adaptive state by comparable context.
 */
export function adaptiveContextKey(context: AdaptiveContextBucket): string {
  return [
    context.timeOfDay,
    context.sessionPosition,
    context.eventLength,
    context.workload,
    context.energy,
    context.environmentId ?? "none",
  ].join(":");
}

/**
 * Returns the prior hidden state for the same coarse context, if one exists.
 */
export function previousAdaptiveStateForContext(
  context: AdaptiveContextBucket,
  states: readonly PomodoroAdaptiveContextStateRead[],
): AdaptiveStateScores | null {
  const key = adaptiveContextKey(context);
  const matched = states.find((state) => state.contextKey === key);
  if (!matched) return null;
  return {
    readiness: matched.readiness,
    strain: matched.strain,
    recoveryDebt: matched.recoveryDebt,
    avoidancePressure: matched.avoidancePressure,
    momentum: matched.momentum,
    confidence: matched.confidence,
  };
}

function decisionValueWrites(
  previous: CountPomodoroRhythm,
  selected: CountPomodoroRhythm,
): PomodoroAdaptiveDecisionValueWrite[] {
  return [
    valueWrite("focus_duration_minutes", previous.focusDurationMinutes, selected.focusDurationMinutes, "minutes"),
    valueWrite("short_break_minutes", previous.shortBreakMinutes, selected.shortBreakMinutes, "minutes"),
    valueWrite("long_break_minutes", previous.longBreakMinutes, selected.longBreakMinutes, "minutes"),
    valueWrite(
      "long_break_after_focus_count",
      previous.longBreakAfterFocusCount,
      selected.longBreakAfterFocusCount,
      "count",
    ),
  ];
}

function valueWrite(
  valueKey: AdaptiveParameterKey,
  previousNumericValue: number,
  selectedNumericValue: number,
  valueUnit: AdaptiveValueUnit,
): PomodoroAdaptiveDecisionValueWrite {
  return {
    valueKey,
    previousNumericValue,
    selectedNumericValue,
    valueUnit,
  };
}

function experimentAssignmentWrite(
  experimentAssignment: AdaptiveExperimentAssignment,
  ids: RunStartAdaptiveSnapshotIds,
  contextSnapshotId: string,
  policyId: string,
): PomodoroAdaptiveExperimentAssignmentWrite {
  return {
    experiment: experimentWrite(
      experimentAssignment.experiment,
      experimentAssignment.assignedAt,
      experimentAssignment.experiment.status,
      policyId,
    ),
    assignment: {
      id: crypto.randomUUID(),
      experimentId: experimentAssignment.experiment.id,
      variantKey: experimentAssignment.variant.variantKey,
      runId: ids.runId,
      segmentId: ids.segmentId,
      contextSnapshotId,
      assignmentSeed: experimentAssignment.assignmentSeed,
      assignedAt: experimentAssignment.assignedAt,
    },
  };
}

function experimentWrite(
  experiment: AdaptiveExperimentDefinition,
  occurredAt: string,
  status: AdaptiveExperimentStatus,
  policyId = DEFAULT_ADAPTIVE_POLICY_ID,
): PomodoroAdaptiveExperimentWrite {
  return {
    id: experiment.id,
    policyId,
    parameterKey: experiment.parameterKey,
    assignmentUnit: experiment.assignmentUnit,
    status,
    startedAt: occurredAt,
    endedAt: status === "completed" || status === "abandoned" ? occurredAt : null,
    variants: experiment.variants.map((variant) => ({
      variantKey: variant.variantKey,
      numericValue: variant.numericValue,
      isControl: variant.isControl,
    })),
  };
}

function clonePlannedBlocks(
  plannedBlocks: readonly PomodoroAdaptivePlannedBlockWrite[],
): PomodoroAdaptivePlannedBlockWrite[] {
  return plannedBlocks.map((block) => ({ ...block }));
}

function dedupeReasonCodes(codes: readonly AdaptiveReasonCode[]): AdaptiveReasonCode[] {
  return [...new Set(codes)];
}

function minutesBetween(start: string, end: string): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return (endMs - startMs) / 60000;
}

function sessionIndexToday(segments: readonly AdaptiveSegmentInput[], startedAt: string): number {
  const startedDay = localDayKey(startedAt);
  const runIds = new Set<string>();
  for (const segment of segments) {
    const started = segment.actualStart ?? segment.plannedStart;
    if (localDayKey(started) === startedDay) {
      const runId = segment.runId ?? `${segment.plannedStart}:${segment.plannedEnd}`;
      runIds.add(runId);
    }
  }
  return Math.max(1, runIds.size + 1);
}

function cleanFocusMinutesToday(segments: readonly AdaptiveSegmentInput[], startedAt: string): number {
  const startedDay = localDayKey(startedAt);
  const features = extractAdaptiveFeatures({
    segments: segments.filter((segment) => {
      const started = segment.actualStart ?? segment.plannedStart;
      return segment.phase === "focus" && localDayKey(started) === startedDay;
    }),
    observationEndedAt: startedAt,
  });
  return features.cleanFocusSeconds / 60;
}

function localDayKey(value: string): string {
  return new Date(value).toDateString();
}
