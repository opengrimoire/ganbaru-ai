import { describe, expect, it } from "vitest";
import {
  comparePointEstimates,
  compareMeanEstimates,
  compareMeanGuardrail,
  compareRateGuardrail,
  compareRateEstimates,
  estimateMean,
  estimateMeanWithVariance,
  estimateRate,
} from "./statistics";

describe("adaptive statistics", () => {
  it("estimates binary rates with bounded Wilson intervals", () => {
    const estimate = estimateRate(50, 100);

    expect(estimate.point).toBe(0.5);
    expect(estimate.lowerBound).toBeGreaterThan(0.39);
    expect(estimate.upperBound).toBeLessThan(0.61);
    expect(estimate.standardError).toBeCloseTo(0.05);
  });

  it("handles empty and out-of-range rate inputs safely", () => {
    expect(estimateRate(4, 0)).toEqual({
      successes: 0,
      trials: 0,
      point: 0,
      lowerBound: 0,
      upperBound: 0,
      standardError: 0,
    });
    expect(estimateRate(12, 10).successes).toBe(10);
    expect(estimateRate(-1, 10).successes).toBe(0);
  });

  it("estimates aggregate means without inventing variance", () => {
    expect(estimateMean(900, 3)).toEqual({
      total: 900,
      count: 3,
      point: 300,
    });
    expect(estimateMean(Number.NaN, 3).point).toBe(0);
    expect(estimateMean(900, 0).point).toBe(0);
  });

  it("estimates aggregate means with variance from square totals", () => {
    const estimate = estimateMeanWithVariance(60, 1400, 3);

    expect(estimate.point).toBe(20);
    expect(estimate.sampleVariance).toBe(100);
    expect(estimate.standardError).toBeCloseTo(5.7735, 4);
    expect(estimate.lowerBound).toBeLessThan(20);
    expect(estimate.upperBound).toBeGreaterThan(20);
  });

  it("compares rates conservatively by direction", () => {
    const control = estimateRate(700, 1000);
    const treatment = estimateRate(900, 1000);
    const comparison = compareRateEstimates(control, treatment, "higher_is_better", 0.05);

    expect(comparison.pointImprovement).toBeCloseTo(0.2);
    expect(comparison.conservativeImprovement).toBeGreaterThan(0);
    expect(comparison.meaningful).toBe(true);
  });

  it("compares lower-is-better point estimates", () => {
    const comparison = comparePointEstimates(120, 60, 30, "lower_is_better", 20);

    expect(comparison.pointImprovement).toBe(60);
    expect(comparison.conservativeImprovement).toBe(30);
    expect(comparison.meaningful).toBe(true);
  });

  it("compares means conservatively by interval overlap", () => {
    const stableControl = estimateMeanWithVariance(10 * 120, 10 * 120 * 120, 10);
    const stableTreatment = estimateMeanWithVariance(10 * 30, 10 * 30 * 30, 10);
    const noisyControl = estimateMeanWithVariance(10 * 120, 10 * 120 * 120, 10);
    const noisyTreatment = estimateMeanWithVariance(10 * 30, 9 * 0 + 900 * 900, 10);

    expect(compareMeanEstimates(
      stableControl,
      stableTreatment,
      "lower_is_better",
      60,
    ).meaningful).toBe(true);
    expect(compareMeanEstimates(
      noisyControl,
      noisyTreatment,
      "lower_is_better",
      60,
    ).meaningful).toBe(false);
  });

  it("detects mean guardrail harm with conservative or severe evidence", () => {
    const stable = compareMeanGuardrail(
      estimateMeanWithVariance(10 * 60, 10 * 60 * 60, 10),
      estimateMeanWithVariance(10 * 150, 10 * 150 * 150, 10),
      "lower_is_better",
      60,
    );
    const severe = compareMeanGuardrail(
      estimateMeanWithVariance(10 * 60, 10 * 60 * 60, 10),
      estimateMeanWithVariance(10 * 150, 9 * 0 + 900 * 900, 10),
      "lower_is_better",
      60,
      80,
    );

    expect(stable.breached).toBe(true);
    expect(severe.conservativeHarm).toBeLessThan(60);
    expect(severe.severePointHarm).toBe(true);
    expect(severe.breached).toBe(true);
  });

  it("detects conservative rate guardrail harm", () => {
    const comparison = compareRateGuardrail(
      estimateRate(95, 100),
      estimateRate(60, 100),
      "higher_is_better",
      0.15,
    );

    expect(comparison.pointHarm).toBeCloseTo(0.35);
    expect(comparison.conservativeHarm).toBeGreaterThan(0.15);
    expect(comparison.severePointHarm).toBe(false);
    expect(comparison.breached).toBe(true);
  });

  it("keeps noisy rate harm below guardrail unless the point harm is severe", () => {
    const noisy = compareRateGuardrail(
      estimateRate(9, 10),
      estimateRate(6, 10),
      "higher_is_better",
      0.15,
    );
    const safetyStop = compareRateGuardrail(
      estimateRate(9, 10),
      estimateRate(6, 10),
      "higher_is_better",
      0.15,
      0.25,
    );

    expect(noisy.conservativeHarm).toBeLessThan(0.15);
    expect(noisy.breached).toBe(false);
    expect(safetyStop.severePointHarm).toBe(true);
    expect(safetyStop.breached).toBe(true);
  });
});
