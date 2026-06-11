export type AdaptiveComparisonDirection = "higher_is_better" | "lower_is_better";

export interface AdaptiveRateEstimate {
  successes: number;
  trials: number;
  point: number;
  lowerBound: number;
  upperBound: number;
  standardError: number;
}

export interface AdaptiveMeanEstimate {
  total: number;
  count: number;
  point: number;
}

export interface AdaptiveMeanVarianceEstimate extends AdaptiveMeanEstimate {
  squareTotal: number;
  sampleVariance: number;
  standardError: number;
  lowerBound: number;
  upperBound: number;
}

export interface AdaptiveTreatmentComparison {
  direction: AdaptiveComparisonDirection;
  controlPoint: number;
  treatmentPoint: number;
  pointImprovement: number;
  conservativeImprovement: number;
  minimumMeaningfulImprovement: number;
  meaningful: boolean;
}

export interface AdaptiveRateGuardrailComparison {
  direction: AdaptiveComparisonDirection;
  controlPoint: number;
  treatmentPoint: number;
  pointHarm: number;
  conservativeHarm: number;
  minimumMeaningfulHarm: number;
  severePointHarmThreshold: number;
  severePointHarm: boolean;
  breached: boolean;
}

export interface AdaptiveMeanGuardrailComparison {
  direction: AdaptiveComparisonDirection;
  controlPoint: number;
  treatmentPoint: number;
  pointHarm: number;
  conservativeHarm: number;
  minimumMeaningfulHarm: number;
  severePointHarmThreshold: number;
  severePointHarm: boolean;
  breached: boolean;
}

const DEFAULT_CONFIDENCE_Z = 1.96;

/**
 * Estimates a bounded binary rate with a Wilson interval.
 */
export function estimateRate(
  successes: number,
  trials: number,
  confidenceZ = DEFAULT_CONFIDENCE_Z,
): AdaptiveRateEstimate {
  const safeTrials = Math.max(0, Math.round(trials));
  const safeSuccesses = clamp(Math.round(successes), 0, safeTrials);
  if (safeTrials === 0) {
    return {
      successes: 0,
      trials: 0,
      point: 0,
      lowerBound: 0,
      upperBound: 0,
      standardError: 0,
    };
  }

  const point = safeSuccesses / safeTrials;
  const zSquared = confidenceZ * confidenceZ;
  const denominator = 1 + zSquared / safeTrials;
  const center = point + zSquared / (2 * safeTrials);
  const margin = confidenceZ * Math.sqrt(
    (point * (1 - point) + zSquared / (4 * safeTrials)) / safeTrials,
  );
  return {
    successes: safeSuccesses,
    trials: safeTrials,
    point,
    lowerBound: clamp((center - margin) / denominator, 0, 1),
    upperBound: clamp((center + margin) / denominator, 0, 1),
    standardError: Math.sqrt((point * (1 - point)) / safeTrials),
  };
}

/**
 * Estimates a mean from an aggregate total and count.
 */
export function estimateMean(
  total: number,
  count: number,
): AdaptiveMeanEstimate {
  const safeCount = Math.max(0, Math.round(count));
  return {
    total: Number.isFinite(total) ? total : 0,
    count: safeCount,
    point: safeCount > 0 && Number.isFinite(total) ? total / safeCount : 0,
  };
}

/**
 * Estimates an aggregate mean and interval from total, square total, and count.
 */
export function estimateMeanWithVariance(
  total: number,
  squareTotal: number,
  count: number,
  confidenceZ = DEFAULT_CONFIDENCE_Z,
): AdaptiveMeanVarianceEstimate {
  const safeTotal = Number.isFinite(total) ? total : 0;
  const safeSquareTotal = Number.isFinite(squareTotal) ? Math.max(0, squareTotal) : 0;
  const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
  if (safeCount <= 0) {
    return {
      total: 0,
      squareTotal: 0,
      count: 0,
      point: 0,
      sampleVariance: 0,
      standardError: 0,
      lowerBound: 0,
      upperBound: 0,
    };
  }

  const point = safeTotal / safeCount;
  const sampleVariance = safeCount > 1
    ? Math.max(0, (safeSquareTotal - (safeTotal * safeTotal) / safeCount) / (safeCount - 1))
    : 0;
  const standardError = Math.sqrt(sampleVariance / safeCount);
  const margin = confidenceZ * standardError;
  return {
    total: safeTotal,
    squareTotal: safeSquareTotal,
    count: safeCount,
    point,
    sampleVariance,
    standardError,
    lowerBound: point - margin,
    upperBound: point + margin,
  };
}

/**
 * Compares two rate estimates with conservative interval overlap.
 */
export function compareRateEstimates(
  control: AdaptiveRateEstimate,
  treatment: AdaptiveRateEstimate,
  direction: AdaptiveComparisonDirection,
  minimumMeaningfulImprovement = 0,
): AdaptiveTreatmentComparison {
  return comparePointEstimates(
    control.point,
    treatment.point,
    conservativeRateImprovement(control, treatment, direction),
    direction,
    minimumMeaningfulImprovement,
  );
}

/**
 * Compares two mean estimates with conservative interval overlap.
 */
export function compareMeanEstimates(
  control: AdaptiveMeanVarianceEstimate,
  treatment: AdaptiveMeanVarianceEstimate,
  direction: AdaptiveComparisonDirection,
  minimumMeaningfulImprovement = 0,
): AdaptiveTreatmentComparison {
  return comparePointEstimates(
    control.point,
    treatment.point,
    conservativeMeanImprovement(control, treatment, direction),
    direction,
    minimumMeaningfulImprovement,
  );
}

/**
 * Compares whether a treatment harms a bounded rate metric enough to stop it.
 */
export function compareRateGuardrail(
  control: AdaptiveRateEstimate,
  treatment: AdaptiveRateEstimate,
  direction: AdaptiveComparisonDirection,
  minimumMeaningfulHarm = 0,
  severePointHarmThreshold = Number.POSITIVE_INFINITY,
): AdaptiveRateGuardrailComparison {
  const pointHarm = direction === "higher_is_better"
    ? control.point - treatment.point
    : treatment.point - control.point;
  const conservativeHarm = direction === "higher_is_better"
    ? control.lowerBound - treatment.upperBound
    : treatment.lowerBound - control.upperBound;
  const severePointHarm = pointHarm >= severePointHarmThreshold;
  return {
    direction,
    controlPoint: control.point,
    treatmentPoint: treatment.point,
    pointHarm,
    conservativeHarm,
    minimumMeaningfulHarm,
    severePointHarmThreshold,
    severePointHarm,
    breached: conservativeHarm >= minimumMeaningfulHarm || severePointHarm,
  };
}

/**
 * Compares whether a treatment harms an aggregate mean enough to stop it.
 */
export function compareMeanGuardrail(
  control: AdaptiveMeanVarianceEstimate,
  treatment: AdaptiveMeanVarianceEstimate,
  direction: AdaptiveComparisonDirection,
  minimumMeaningfulHarm = 0,
  severePointHarmThreshold = Number.POSITIVE_INFINITY,
): AdaptiveMeanGuardrailComparison {
  const pointHarm = direction === "higher_is_better"
    ? control.point - treatment.point
    : treatment.point - control.point;
  const conservativeHarm = direction === "higher_is_better"
    ? control.lowerBound - treatment.upperBound
    : treatment.lowerBound - control.upperBound;
  const severePointHarm = pointHarm >= severePointHarmThreshold;
  return {
    direction,
    controlPoint: control.point,
    treatmentPoint: treatment.point,
    pointHarm,
    conservativeHarm,
    minimumMeaningfulHarm,
    severePointHarmThreshold,
    severePointHarm,
    breached: conservativeHarm >= minimumMeaningfulHarm || severePointHarm,
  };
}

/**
 * Compares two point estimates when no variance estimate is available.
 */
export function comparePointEstimates(
  controlPoint: number,
  treatmentPoint: number,
  conservativeImprovement: number,
  direction: AdaptiveComparisonDirection,
  minimumMeaningfulImprovement = 0,
): AdaptiveTreatmentComparison {
  const pointImprovement = direction === "higher_is_better"
    ? treatmentPoint - controlPoint
    : controlPoint - treatmentPoint;
  return {
    direction,
    controlPoint,
    treatmentPoint,
    pointImprovement,
    conservativeImprovement,
    minimumMeaningfulImprovement,
    meaningful: conservativeImprovement >= minimumMeaningfulImprovement,
  };
}

function conservativeRateImprovement(
  control: AdaptiveRateEstimate,
  treatment: AdaptiveRateEstimate,
  direction: AdaptiveComparisonDirection,
): number {
  if (direction === "higher_is_better") {
    return treatment.lowerBound - control.upperBound;
  }
  return control.lowerBound - treatment.upperBound;
}

function conservativeMeanImprovement(
  control: AdaptiveMeanVarianceEstimate,
  treatment: AdaptiveMeanVarianceEstimate,
  direction: AdaptiveComparisonDirection,
): number {
  if (direction === "higher_is_better") {
    return treatment.lowerBound - control.upperBound;
  }
  return control.lowerBound - treatment.upperBound;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
