import { describe, expect, it } from "vitest";
import {
  PENDING_STATE_TTL_MS,
  STATE_TTL_MS,
  benchmarkPendingAgeMs,
  benchmarkTotalAgeMs,
  isBenchmarkPendingStage,
  isFreshBenchmarkPendingAge,
  isFreshBenchmarkTotalAge,
} from "./types";

const NOW_MS = Date.parse("2026-05-10T12:00:00.000Z");

function isoAgo(ms: number): string {
  return new Date(NOW_MS - ms).toISOString();
}

function isoAhead(ms: number): string {
  return new Date(NOW_MS + ms).toISOString();
}

describe("benchmark state freshness", () => {
  it("recognizes the pending stages that can route to the benchmark database", () => {
    expect(isBenchmarkPendingStage("phase-a-pending")).toBe(true);
    expect(isBenchmarkPendingStage("phase-b-pending")).toBe(true);
    expect(isBenchmarkPendingStage("phase-a-running")).toBe(false);
    expect(isBenchmarkPendingStage(undefined)).toBe(false);
  });

  it("tracks total run age from startedAt", () => {
    const state = { startedAt: isoAgo(30_000), updatedAt: isoAgo(5_000) };

    expect(benchmarkTotalAgeMs(state, NOW_MS)).toBe(30_000);
    expect(isFreshBenchmarkTotalAge(state, NOW_MS)).toBe(true);
    expect(isFreshBenchmarkTotalAge({ startedAt: isoAgo(STATE_TTL_MS + 1) }, NOW_MS))
      .toBe(false);
    expect(isFreshBenchmarkTotalAge({ startedAt: isoAhead(1) }, NOW_MS)).toBe(false);
  });

  it("tracks pending restart age from updatedAt when available", () => {
    const state = {
      startedAt: isoAgo(STATE_TTL_MS / 2),
      updatedAt: isoAgo(PENDING_STATE_TTL_MS - 1),
    };

    expect(benchmarkPendingAgeMs(state, NOW_MS)).toBe(PENDING_STATE_TTL_MS - 1);
    expect(isFreshBenchmarkPendingAge(state, NOW_MS)).toBe(true);
    expect(isFreshBenchmarkPendingAge({
      startedAt: isoAgo(STATE_TTL_MS / 2),
      updatedAt: isoAgo(PENDING_STATE_TTL_MS + 1),
    }, NOW_MS)).toBe(false);
  });

  it("falls back to startedAt for older state files without updatedAt", () => {
    expect(isFreshBenchmarkPendingAge({ startedAt: isoAgo(PENDING_STATE_TTL_MS - 1) }, NOW_MS))
      .toBe(true);
    expect(isFreshBenchmarkPendingAge({ startedAt: isoAgo(PENDING_STATE_TTL_MS + 1) }, NOW_MS))
      .toBe(false);
  });
});
