import {
  compareMeanEstimates,
  compareMeanGuardrail,
  compareRateEstimates,
  compareRateGuardrail,
  estimateMean,
  estimateMeanWithVariance,
  estimateRate,
  type AdaptiveMeanVarianceEstimate,
} from "./statistics";
import {
  neighborPooledExperimentOutcomes,
  pooledExperimentOutcomes,
  variantOutcome,
} from "./experiment-outcomes";
import {
  RUN_FOCUS_DURATION_EXPERIMENT,
  RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT,
  RUN_LONG_BREAK_CADENCE_EXPERIMENT,
  RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT,
  RUN_LONG_BREAK_DURATION_EXPERIMENT,
  RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT,
  RUN_SHORT_BREAK_DURATION_EXPERIMENT,
  type AdaptiveExperimentAnalysis,
  type AdaptiveExperimentAnalysisDecision,
  type AdaptiveExperimentDefinition,
  type AdaptiveExperimentVariant,
  type AdaptiveExperimentVariantOutcome,
} from "./experiment-types";

type AnalyzeExperimentScope = (
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey: string | null,
  analysisScope: AdaptiveExperimentAnalysis["analysisScope"],
) => AdaptiveExperimentAnalysis;

interface RunExperimentMetrics {
  control: AdaptiveExperimentVariantOutcome;
  treatment: AdaptiveExperimentVariantOutcome;
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
  hasRunEvidence: boolean;
  hasComparableNextDay: boolean;
}

interface RunExperimentAnalysisConfig {
  experiment: AdaptiveExperimentDefinition;
  missingVariantMessage: string;
  guardrails: readonly RunExperimentGuardrail[];
  preferTreatment: (metrics: RunExperimentMetrics) => boolean;
}

type RunExperimentGuardrail = (
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
) => boolean;

const MIN_EXPERIMENT_RUNS_PER_VARIANT = 8;
const MIN_CONTEXT_POOLING_RUNS_PER_VARIANT = 4;
const MIN_NEXT_DAY_OBSERVATIONS_PER_VARIANT = 4;
const TREATMENT_CLEAN_FOCUS_GAIN_SECONDS = 4 * 60;
const TREATMENT_CLEAN_FOCUS_LOSS_TOLERANCE_SECONDS = 4 * 60;
const COMPLETION_GUARDRAIL_DROP = 0.15;
const STOP_RATE_GUARDRAIL_INCREASE = 0.1;
const BLOCKED_ATTEMPT_GUARDRAIL_INCREASE = 2;
const BLOCKED_ATTEMPT_IMPROVEMENT = 1;
const COMPLETION_RATE_IMPROVEMENT = 0.1;
const SEVERE_COMPLETION_GUARDRAIL_DROP = 0.25;
const SEVERE_STOP_RATE_GUARDRAIL_INCREASE = 0.2;
const SEVERE_NEXT_DAY_START_GUARDRAIL_DROP = 0.3;
const SEVERE_MEAN_GUARDRAIL_MULTIPLIER = 2;
const MIN_DAY_OBSERVATIONS_PER_VARIANT = 4;
const DAY_MISSED_PLANNED_GUARDRAIL_INCREASE = 0.75;
const DAY_BLOCKED_ATTEMPT_GUARDRAIL_INCREASE = 3;
const NEXT_DAY_START_GUARDRAIL_DROP = 0.15;
const TREATMENT_COMPLETION_TOLERANCE = 0.05;
const TREATMENT_NEXT_DAY_TOLERANCE = 0.05;
const SHORT_BREAK_OVERTIME_IMPROVEMENT_SECONDS = 60;
const SHORT_BREAK_OVERTIME_GUARDRAIL_INCREASE = 60;
const LONG_BREAK_OVERTIME_IMPROVEMENT_SECONDS = 120;
const LONG_BREAK_OVERTIME_GUARDRAIL_INCREASE = 120;
const BREAK_SKIPPED_GUARDRAIL_INCREASE = 0.5;

const BASIC_RUN_GUARDRAILS = [
  completionGuardrailBreached,
  stopRateGuardrailBreached,
  blockedAttemptGuardrailBreached,
  dayMissedPlannedGuardrailBreached,
  dayBlockedAttemptGuardrailBreached,
  nextDayStartGuardrailBreached,
] as const;

const BREAK_DRIFT_GUARDRAILS = [
  ...BASIC_RUN_GUARDRAILS,
  breakSkippedGuardrailBreached,
] as const;

const CLEAN_FOCUS_PRESERVING_GUARDRAILS = [
  ...BREAK_DRIFT_GUARDRAILS,
  cleanFocusLossGuardrailBreached,
] as const;

const RUN_FOCUS_DURATION_ANALYSIS: RunExperimentAnalysisConfig = {
  experiment: RUN_FOCUS_DURATION_EXPERIMENT,
  missingVariantMessage: "Run focus-duration experiment needs one control and one treatment variant.",
  guardrails: BASIC_RUN_GUARDRAILS,
  preferTreatment: (metrics) =>
    cleanFocusGainMeaningful(metrics.control, metrics.treatment) &&
    preservesCompletion(metrics) &&
    preservesNextDay(metrics),
};

const RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_ANALYSIS: RunExperimentAnalysisConfig = {
  experiment: RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_EXPERIMENT,
  missingVariantMessage:
    "Run focus-with-short-break-support experiment needs one control and one treatment variant.",
  guardrails: [
    ...BREAK_DRIFT_GUARDRAILS,
    shortBreakOvertimeGuardrailBreached,
  ],
  preferTreatment: (metrics) =>
    cleanFocusGainMeaningful(metrics.control, metrics.treatment) &&
    preservesCompletion(metrics) &&
    preservesNextDay(metrics),
};

const RUN_SHORT_BREAK_DURATION_ANALYSIS: RunExperimentAnalysisConfig = {
  experiment: RUN_SHORT_BREAK_DURATION_EXPERIMENT,
  missingVariantMessage: "Run short-break experiment needs one control and one treatment variant.",
  guardrails: [
    ...BREAK_DRIFT_GUARDRAILS,
    shortBreakOvertimeGuardrailBreached,
  ],
  preferTreatment: (metrics) =>
    shortBreakOvertimeImprovementMeaningful(metrics.control, metrics.treatment) &&
    preservesCompletion(metrics) &&
    preservesNextDay(metrics),
};

const RUN_LONG_BREAK_DURATION_ANALYSIS: RunExperimentAnalysisConfig = {
  experiment: RUN_LONG_BREAK_DURATION_EXPERIMENT,
  missingVariantMessage: "Run long-break experiment needs one control and one treatment variant.",
  guardrails: [
    ...BREAK_DRIFT_GUARDRAILS,
    longBreakOvertimeGuardrailBreached,
  ],
  preferTreatment: (metrics) =>
    longBreakOvertimeImprovementMeaningful(metrics.control, metrics.treatment) &&
    preservesCompletion(metrics) &&
    preservesNextDay(metrics),
};

const RUN_LONG_RECOVERY_SUPPORT_ANALYSIS: RunExperimentAnalysisConfig = {
  experiment: RUN_LONG_RECOVERY_SUPPORT_EXPERIMENT,
  missingVariantMessage:
    "Run long-recovery-support experiment needs one control and one treatment variant.",
  guardrails: [
    ...CLEAN_FOCUS_PRESERVING_GUARDRAILS,
    longBreakOvertimeGuardrailBreached,
  ],
  preferTreatment: (metrics) =>
    (
      blockedAttemptImprovementMeaningful(metrics.control, metrics.treatment) ||
      longBreakOvertimeImprovementMeaningful(metrics.control, metrics.treatment) ||
      completionImprovementMeaningful(metrics.control, metrics.treatment)
    ) &&
    preservesCleanFocus(metrics.control, metrics.treatment) &&
    preservesCompletion(metrics) &&
    preservesNextDay(metrics),
};

const RUN_LONG_BREAK_CADENCE_ANALYSIS: RunExperimentAnalysisConfig = {
  experiment: RUN_LONG_BREAK_CADENCE_EXPERIMENT,
  missingVariantMessage:
    "Run long-break-cadence experiment needs one control and one treatment variant.",
  guardrails: CLEAN_FOCUS_PRESERVING_GUARDRAILS,
  preferTreatment: (metrics) =>
    (
      blockedAttemptImprovementMeaningful(metrics.control, metrics.treatment) ||
      completionImprovementMeaningful(metrics.control, metrics.treatment)
    ) &&
    preservesCleanFocus(metrics.control, metrics.treatment) &&
    preservesCompletion(metrics) &&
    preservesNextDay(metrics),
};

const RUN_LONG_BREAK_CADENCE_EXPANSION_ANALYSIS: RunExperimentAnalysisConfig = {
  experiment: RUN_LONG_BREAK_CADENCE_EXPANSION_EXPERIMENT,
  missingVariantMessage:
    "Run long-break-cadence-expansion experiment needs one control and one treatment variant.",
  guardrails: [
    ...BREAK_DRIFT_GUARDRAILS,
    longBreakOvertimeGuardrailBreached,
  ],
  preferTreatment: (metrics) =>
    cleanFocusGainMeaningful(metrics.control, metrics.treatment) &&
    preservesCompletion(metrics) &&
    !blockedAttemptGuardrailBreached(metrics.control, metrics.treatment) &&
    preservesNextDay(metrics),
};

export function analyzeRunFocusDurationExperiment(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey?: string,
): AdaptiveExperimentAnalysis {
  return analyzeExperimentWithContextFallback(
    outcomes,
    contextKey,
    createExperimentScopeAnalyzer(RUN_FOCUS_DURATION_ANALYSIS),
  );
}

export function analyzeRunFocusWithShortBreakSupportExperiment(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey?: string,
): AdaptiveExperimentAnalysis {
  return analyzeExperimentWithContextFallback(
    outcomes,
    contextKey,
    createExperimentScopeAnalyzer(RUN_FOCUS_WITH_SHORT_BREAK_SUPPORT_ANALYSIS),
  );
}

export function analyzeRunShortBreakDurationExperiment(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey?: string,
): AdaptiveExperimentAnalysis {
  return analyzeExperimentWithContextFallback(
    outcomes,
    contextKey,
    createExperimentScopeAnalyzer(RUN_SHORT_BREAK_DURATION_ANALYSIS),
  );
}

export function analyzeRunLongBreakDurationExperiment(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey?: string,
): AdaptiveExperimentAnalysis {
  return analyzeExperimentWithContextFallback(
    outcomes,
    contextKey,
    createExperimentScopeAnalyzer(RUN_LONG_BREAK_DURATION_ANALYSIS),
  );
}

export function analyzeRunLongRecoverySupportExperiment(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey?: string,
): AdaptiveExperimentAnalysis {
  return analyzeExperimentWithContextFallback(
    outcomes,
    contextKey,
    createExperimentScopeAnalyzer(RUN_LONG_RECOVERY_SUPPORT_ANALYSIS),
  );
}

export function analyzeRunLongBreakCadenceExperiment(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey?: string,
): AdaptiveExperimentAnalysis {
  return analyzeExperimentWithContextFallback(
    outcomes,
    contextKey,
    createExperimentScopeAnalyzer(RUN_LONG_BREAK_CADENCE_ANALYSIS),
  );
}

export function analyzeRunLongBreakCadenceExpansionExperiment(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey?: string,
): AdaptiveExperimentAnalysis {
  return analyzeExperimentWithContextFallback(
    outcomes,
    contextKey,
    createExperimentScopeAnalyzer(RUN_LONG_BREAK_CADENCE_EXPANSION_ANALYSIS),
  );
}

function createExperimentScopeAnalyzer(
  config: RunExperimentAnalysisConfig,
): AnalyzeExperimentScope {
  return (outcomes, contextKey, analysisScope) =>
    analyzeRunExperimentScope(outcomes, contextKey, analysisScope, config);
}

function analyzeExperimentWithContextFallback(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey: string | undefined,
  analyzeScope: AnalyzeExperimentScope,
): AdaptiveExperimentAnalysis {
  if (contextKey) {
    const contextAnalysis = analyzeScope(outcomes, contextKey, "context");
    if (hasMinimumRunEvidence(contextAnalysis)) return contextAnalysis;
    if (hasMinimumContextPoolingEvidence(contextAnalysis)) {
      const neighborPooledAnalysis = analyzeScope(
        neighborPooledExperimentOutcomes(outcomes, contextKey),
        contextKey,
        "neighbor_pooled",
      );
      if (hasMinimumRunEvidence(neighborPooledAnalysis)) return neighborPooledAnalysis;
      const pooledAnalysis = analyzeScope(
        pooledExperimentOutcomes(outcomes, contextKey),
        contextKey,
        "pooled",
      );
      if (hasMinimumRunEvidence(pooledAnalysis)) return pooledAnalysis;
    }
  }
  return analyzeScope(outcomes, null, "global");
}

function analyzeRunExperimentScope(
  outcomes: readonly AdaptiveExperimentVariantOutcome[],
  contextKey: string | null,
  analysisScope: AdaptiveExperimentAnalysis["analysisScope"],
  config: RunExperimentAnalysisConfig,
): AdaptiveExperimentAnalysis {
  const { controlVariant, treatmentVariant } = experimentVariantPair(config);
  const control = variantOutcome(
    outcomes,
    config.experiment.id,
    controlVariant.variantKey,
    contextKey,
  );
  const treatment = variantOutcome(
    outcomes,
    config.experiment.id,
    treatmentVariant.variantKey,
    contextKey,
  );
  const metrics = buildRunExperimentMetrics(control, treatment);
  const guardrailBreached = metrics.hasRunEvidence &&
    config.guardrails.some((guardrail) => guardrail(control, treatment));
  const decision = runExperimentDecision(metrics, guardrailBreached, config);

  return {
    experimentId: config.experiment.id,
    controlVariantKey: controlVariant.variantKey,
    treatmentVariantKey: treatmentVariant.variantKey,
    controlObservedRuns: metrics.controlObservedRuns,
    treatmentObservedRuns: metrics.treatmentObservedRuns,
    controlCompletionRate: metrics.controlCompletionRate,
    treatmentCompletionRate: metrics.treatmentCompletionRate,
    controlStopRate: metrics.controlStopRate,
    treatmentStopRate: metrics.treatmentStopRate,
    controlCleanFocusSecondsMean: metrics.controlCleanFocusSecondsMean,
    treatmentCleanFocusSecondsMean: metrics.treatmentCleanFocusSecondsMean,
    controlBlockedAttemptsMean: metrics.controlBlockedAttemptsMean,
    treatmentBlockedAttemptsMean: metrics.treatmentBlockedAttemptsMean,
    controlBreakSkippedMean: metrics.controlBreakSkippedMean,
    treatmentBreakSkippedMean: metrics.treatmentBreakSkippedMean,
    controlShortBreakOvertimeSecondsMean: metrics.controlShortBreakOvertimeSecondsMean,
    treatmentShortBreakOvertimeSecondsMean: metrics.treatmentShortBreakOvertimeSecondsMean,
    controlLongBreakOvertimeSecondsMean: metrics.controlLongBreakOvertimeSecondsMean,
    treatmentLongBreakOvertimeSecondsMean: metrics.treatmentLongBreakOvertimeSecondsMean,
    controlDayMissedPlannedPomodoroMean: metrics.controlDayMissedPlannedPomodoroMean,
    treatmentDayMissedPlannedPomodoroMean: metrics.treatmentDayMissedPlannedPomodoroMean,
    controlDayBlockedAttemptsMean: metrics.controlDayBlockedAttemptsMean,
    treatmentDayBlockedAttemptsMean: metrics.treatmentDayBlockedAttemptsMean,
    controlNextDayStartedRate: metrics.controlNextDayStartedRate,
    treatmentNextDayStartedRate: metrics.treatmentNextDayStartedRate,
    analysisScope,
    guardrailBreached,
    decision,
  };
}

function experimentVariantPair(config: RunExperimentAnalysisConfig): {
  controlVariant: AdaptiveExperimentVariant;
  treatmentVariant: AdaptiveExperimentVariant;
} {
  const controlVariant = config.experiment.variants.find((variant) => variant.isControl);
  const treatmentVariant = config.experiment.variants.find((variant) => !variant.isControl);
  if (!controlVariant || !treatmentVariant) {
    throw new Error(config.missingVariantMessage);
  }
  return { controlVariant, treatmentVariant };
}

function buildRunExperimentMetrics(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): RunExperimentMetrics {
  const controlObservedRuns = control.runObservedCount;
  const treatmentObservedRuns = treatment.runObservedCount;
  const controlNextDayStartedRate = enoughNextDay(control)
    ? ratio(control.nextDayStartedRunCount, control.nextDayObservedCount)
    : null;
  const treatmentNextDayStartedRate = enoughNextDay(treatment)
    ? ratio(treatment.nextDayStartedRunCount, treatment.nextDayObservedCount)
    : null;

  return {
    control,
    treatment,
    controlObservedRuns,
    treatmentObservedRuns,
    controlCompletionRate: ratio(control.runCompletedCount, controlObservedRuns),
    treatmentCompletionRate: ratio(treatment.runCompletedCount, treatmentObservedRuns),
    controlStopRate: ratio(control.runStoppedCount, controlObservedRuns),
    treatmentStopRate: ratio(treatment.runStoppedCount, treatmentObservedRuns),
    controlCleanFocusSecondsMean: mean(control.cleanFocusSecondsSum, controlObservedRuns),
    treatmentCleanFocusSecondsMean: mean(treatment.cleanFocusSecondsSum, treatmentObservedRuns),
    controlBlockedAttemptsMean: mean(control.blockedAttemptCountSum, controlObservedRuns),
    treatmentBlockedAttemptsMean: mean(treatment.blockedAttemptCountSum, treatmentObservedRuns),
    controlBreakSkippedMean: mean(control.breakSkippedCountSum, controlObservedRuns),
    treatmentBreakSkippedMean: mean(treatment.breakSkippedCountSum, treatmentObservedRuns),
    controlShortBreakOvertimeSecondsMean: mean(control.shortBreakOvertimeSecondsSum, controlObservedRuns),
    treatmentShortBreakOvertimeSecondsMean: mean(treatment.shortBreakOvertimeSecondsSum, treatmentObservedRuns),
    controlLongBreakOvertimeSecondsMean: mean(control.longBreakOvertimeSecondsSum, controlObservedRuns),
    treatmentLongBreakOvertimeSecondsMean: mean(treatment.longBreakOvertimeSecondsSum, treatmentObservedRuns),
    controlDayMissedPlannedPomodoroMean: enoughDay(control)
      ? mean(control.dayMissedPlannedPomodoroCountSum, control.dayObservedCount)
      : null,
    treatmentDayMissedPlannedPomodoroMean: enoughDay(treatment)
      ? mean(treatment.dayMissedPlannedPomodoroCountSum, treatment.dayObservedCount)
      : null,
    controlDayBlockedAttemptsMean: enoughDay(control)
      ? mean(control.dayBlockedAttemptCountSum, control.dayObservedCount)
      : null,
    treatmentDayBlockedAttemptsMean: enoughDay(treatment)
      ? mean(treatment.dayBlockedAttemptCountSum, treatment.dayObservedCount)
      : null,
    controlNextDayStartedRate,
    treatmentNextDayStartedRate,
    hasRunEvidence: controlObservedRuns >= MIN_EXPERIMENT_RUNS_PER_VARIANT &&
      treatmentObservedRuns >= MIN_EXPERIMENT_RUNS_PER_VARIANT,
    hasComparableNextDay: controlNextDayStartedRate !== null && treatmentNextDayStartedRate !== null,
  };
}

function runExperimentDecision(
  metrics: RunExperimentMetrics,
  guardrailBreached: boolean,
  config: RunExperimentAnalysisConfig,
): AdaptiveExperimentAnalysisDecision {
  if (!metrics.hasRunEvidence) return "insufficient_data";
  if (guardrailBreached) return "prefer_control";
  return config.preferTreatment(metrics) ? "prefer_treatment" : "continue";
}

function preservesCompletion(metrics: RunExperimentMetrics): boolean {
  return metrics.treatmentCompletionRate >=
    metrics.controlCompletionRate - TREATMENT_COMPLETION_TOLERANCE;
}

function preservesNextDay(metrics: RunExperimentMetrics): boolean {
  return !metrics.hasComparableNextDay ||
    (
      metrics.treatmentNextDayStartedRate !== null &&
      metrics.controlNextDayStartedRate !== null &&
      metrics.treatmentNextDayStartedRate >=
        metrics.controlNextDayStartedRate - TREATMENT_NEXT_DAY_TOLERANCE
    );
}

function preservesCleanFocus(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return !cleanFocusLossGuardrailBreached(control, treatment);
}

function completionImprovementMeaningful(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return compareRateEstimates(
    estimateRate(control.runCompletedCount, control.runObservedCount),
    estimateRate(treatment.runCompletedCount, treatment.runObservedCount),
    "higher_is_better",
    COMPLETION_RATE_IMPROVEMENT,
  ).meaningful;
}

function completionGuardrailBreached(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return compareRateGuardrail(
    estimateRate(control.runCompletedCount, control.runObservedCount),
    estimateRate(treatment.runCompletedCount, treatment.runObservedCount),
    "higher_is_better",
    COMPLETION_GUARDRAIL_DROP,
    SEVERE_COMPLETION_GUARDRAIL_DROP,
  ).breached;
}

function stopRateGuardrailBreached(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return compareRateGuardrail(
    estimateRate(control.runStoppedCount, control.runObservedCount),
    estimateRate(treatment.runStoppedCount, treatment.runObservedCount),
    "lower_is_better",
    STOP_RATE_GUARDRAIL_INCREASE,
    SEVERE_STOP_RATE_GUARDRAIL_INCREASE,
  ).breached;
}

function nextDayStartGuardrailBreached(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  if (!enoughNextDay(control) || !enoughNextDay(treatment)) return false;
  return compareRateGuardrail(
    estimateRate(control.nextDayStartedRunCount, control.nextDayObservedCount),
    estimateRate(treatment.nextDayStartedRunCount, treatment.nextDayObservedCount),
    "higher_is_better",
    NEXT_DAY_START_GUARDRAIL_DROP,
    SEVERE_NEXT_DAY_START_GUARDRAIL_DROP,
  ).breached;
}

function cleanFocusGainMeaningful(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return compareMeanEstimates(
    cleanFocusEstimate(control),
    cleanFocusEstimate(treatment),
    "higher_is_better",
    TREATMENT_CLEAN_FOCUS_GAIN_SECONDS,
  ).meaningful;
}

function cleanFocusLossGuardrailBreached(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return meanGuardrailBreached(
    cleanFocusEstimate(control),
    cleanFocusEstimate(treatment),
    "higher_is_better",
    TREATMENT_CLEAN_FOCUS_LOSS_TOLERANCE_SECONDS,
  );
}

function blockedAttemptGuardrailBreached(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return meanGuardrailBreached(
    blockedAttemptEstimate(control),
    blockedAttemptEstimate(treatment),
    "lower_is_better",
    BLOCKED_ATTEMPT_GUARDRAIL_INCREASE,
  );
}

function blockedAttemptImprovementMeaningful(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return compareMeanEstimates(
    blockedAttemptEstimate(control),
    blockedAttemptEstimate(treatment),
    "lower_is_better",
    BLOCKED_ATTEMPT_IMPROVEMENT,
  ).meaningful;
}

function breakSkippedGuardrailBreached(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return meanGuardrailBreached(
    breakSkippedEstimate(control),
    breakSkippedEstimate(treatment),
    "lower_is_better",
    BREAK_SKIPPED_GUARDRAIL_INCREASE,
  );
}

function shortBreakOvertimeImprovementMeaningful(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return compareMeanEstimates(
    shortBreakOvertimeEstimate(control),
    shortBreakOvertimeEstimate(treatment),
    "lower_is_better",
    SHORT_BREAK_OVERTIME_IMPROVEMENT_SECONDS,
  ).meaningful;
}

function shortBreakOvertimeGuardrailBreached(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return meanGuardrailBreached(
    shortBreakOvertimeEstimate(control),
    shortBreakOvertimeEstimate(treatment),
    "lower_is_better",
    SHORT_BREAK_OVERTIME_GUARDRAIL_INCREASE,
  );
}

function longBreakOvertimeImprovementMeaningful(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return compareMeanEstimates(
    longBreakOvertimeEstimate(control),
    longBreakOvertimeEstimate(treatment),
    "lower_is_better",
    LONG_BREAK_OVERTIME_IMPROVEMENT_SECONDS,
  ).meaningful;
}

function longBreakOvertimeGuardrailBreached(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  return meanGuardrailBreached(
    longBreakOvertimeEstimate(control),
    longBreakOvertimeEstimate(treatment),
    "lower_is_better",
    LONG_BREAK_OVERTIME_GUARDRAIL_INCREASE,
  );
}

function dayMissedPlannedGuardrailBreached(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  if (!enoughDay(control) || !enoughDay(treatment)) return false;
  return meanGuardrailBreached(
    dayMissedPlannedEstimate(control),
    dayMissedPlannedEstimate(treatment),
    "lower_is_better",
    DAY_MISSED_PLANNED_GUARDRAIL_INCREASE,
  );
}

function dayBlockedAttemptGuardrailBreached(
  control: AdaptiveExperimentVariantOutcome,
  treatment: AdaptiveExperimentVariantOutcome,
): boolean {
  if (!enoughDay(control) || !enoughDay(treatment)) return false;
  return meanGuardrailBreached(
    dayBlockedAttemptEstimate(control),
    dayBlockedAttemptEstimate(treatment),
    "lower_is_better",
    DAY_BLOCKED_ATTEMPT_GUARDRAIL_INCREASE,
  );
}

function meanGuardrailBreached(
  control: AdaptiveMeanVarianceEstimate,
  treatment: AdaptiveMeanVarianceEstimate,
  direction: "higher_is_better" | "lower_is_better",
  minimumMeaningfulHarm: number,
): boolean {
  return compareMeanGuardrail(
    control,
    treatment,
    direction,
    minimumMeaningfulHarm,
    minimumMeaningfulHarm * SEVERE_MEAN_GUARDRAIL_MULTIPLIER,
  ).breached;
}

function cleanFocusEstimate(
  outcome: AdaptiveExperimentVariantOutcome,
): AdaptiveMeanVarianceEstimate {
  return estimateMeanWithVariance(
    outcome.cleanFocusSecondsSum,
    outcome.cleanFocusSecondsSquareSum,
    outcome.runObservedCount,
  );
}

function blockedAttemptEstimate(
  outcome: AdaptiveExperimentVariantOutcome,
): AdaptiveMeanVarianceEstimate {
  return estimateMeanWithVariance(
    outcome.blockedAttemptCountSum,
    outcome.blockedAttemptCountSquareSum,
    outcome.runObservedCount,
  );
}

function breakSkippedEstimate(
  outcome: AdaptiveExperimentVariantOutcome,
): AdaptiveMeanVarianceEstimate {
  return estimateMeanWithVariance(
    outcome.breakSkippedCountSum,
    outcome.breakSkippedCountSquareSum,
    outcome.runObservedCount,
  );
}

function shortBreakOvertimeEstimate(
  outcome: AdaptiveExperimentVariantOutcome,
): AdaptiveMeanVarianceEstimate {
  return estimateMeanWithVariance(
    outcome.shortBreakOvertimeSecondsSum,
    outcome.shortBreakOvertimeSecondsSquareSum,
    outcome.runObservedCount,
  );
}

function longBreakOvertimeEstimate(
  outcome: AdaptiveExperimentVariantOutcome,
): AdaptiveMeanVarianceEstimate {
  return estimateMeanWithVariance(
    outcome.longBreakOvertimeSecondsSum,
    outcome.longBreakOvertimeSecondsSquareSum,
    outcome.runObservedCount,
  );
}

function dayMissedPlannedEstimate(
  outcome: AdaptiveExperimentVariantOutcome,
): AdaptiveMeanVarianceEstimate {
  return estimateMeanWithVariance(
    outcome.dayMissedPlannedPomodoroCountSum,
    outcome.dayMissedPlannedPomodoroCountSquareSum,
    outcome.dayObservedCount,
  );
}

function dayBlockedAttemptEstimate(
  outcome: AdaptiveExperimentVariantOutcome,
): AdaptiveMeanVarianceEstimate {
  return estimateMeanWithVariance(
    outcome.dayBlockedAttemptCountSum,
    outcome.dayBlockedAttemptCountSquareSum,
    outcome.dayObservedCount,
  );
}

function ratio(numerator: number, denominator: number): number {
  return estimateRate(numerator, denominator).point;
}

function mean(total: number, count: number): number {
  return estimateMean(total, count).point;
}

function enoughNextDay(outcome: AdaptiveExperimentVariantOutcome): boolean {
  return outcome.nextDayObservedCount >= MIN_NEXT_DAY_OBSERVATIONS_PER_VARIANT;
}

function enoughDay(outcome: AdaptiveExperimentVariantOutcome): boolean {
  return outcome.dayObservedCount >= MIN_DAY_OBSERVATIONS_PER_VARIANT;
}

function hasMinimumRunEvidence(analysis: AdaptiveExperimentAnalysis): boolean {
  return analysis.controlObservedRuns >= MIN_EXPERIMENT_RUNS_PER_VARIANT &&
    analysis.treatmentObservedRuns >= MIN_EXPERIMENT_RUNS_PER_VARIANT;
}

function hasMinimumContextPoolingEvidence(analysis: AdaptiveExperimentAnalysis): boolean {
  return analysis.controlObservedRuns >= MIN_CONTEXT_POOLING_RUNS_PER_VARIANT &&
    analysis.treatmentObservedRuns >= MIN_CONTEXT_POOLING_RUNS_PER_VARIANT;
}
