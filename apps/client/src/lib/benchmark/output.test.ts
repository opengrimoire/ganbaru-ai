import { describe, it, expect } from "vitest";
import { formatBenchmarkMarkdown, formatSampleCell } from "./output";
import type { BenchmarkResult, PhaseResult, SamplePoint } from "./types";

function sample(label: SamplePoint["label"], total: number, frontend: number): SamplePoint {
  return {
    label,
    tMs: 0,
    totalMb: total,
    backendMb: 87,
    frontendMb: frontend,
    networkMb: 16,
  };
}

function mockPhase(phase: "A" | "B", peak: number, floor: number, eventCount: number): PhaseResult {
  // peakSamples carries the during-stress readings; the formatter picks the max.
  const peakSamples: SamplePoint[] = [
    sample("peak", peak - 5, peak - 92),
    sample("peak", peak, peak - 87),
    sample("peak", peak - 2, peak - 89),
  ];
  // The idle curve drains from t0 -> +5m. Pin floor at the last entry so
  // the formatter's "settled floor" line is deterministic.
  const curve: SamplePoint[] = [
    sample("t0", peak - 30, peak - 117),
    sample("+5s", peak - 35, peak - 122),
    sample("+30s", peak - 60, peak - 147),
    sample("+60s", floor + 5, floor - 82),
    sample("+3m", floor + 1, floor - 86),
    sample("+5m", floor, floor - 87),
  ];
  return {
    phase,
    startedAt: "2026-04-30T10:00:00.000Z",
    stressDurationMs: 3000,
    peakSamples,
    curve,
    boot: {
      marks: {
        "boot.sql-main-done": phase === "A" ? 412 : 609,
        "boot.maprow-done": phase === "A" ? 415 : 783,
        "boot.sql-children-done": phase === "A" ? 418 : 817,
        "boot.first-paint": phase === "A" ? 542 : 921,
        "boot.rawblocks-set": phase === "A" ? 545 : 924,
      },
    },
    eventCountAtStart: eventCount,
  };
}

const RESULT: BenchmarkResult = {
  scenarioId: "calendar-nav",
  scenarioLabel: "Calendar week-view nav",
  synthVersion: "v1",
  harnessVersion: "1",
  platform: "Linux",
  phaseA: mockPhase("A", 348, 278, 0),
  phaseB: mockPhase("B", 517, 318, 1000),
  peakTotalMb: 517,
};

describe("formatSampleCell", () => {
  it("formats backend / frontend / network / total with one decimal except total", () => {
    expect(formatSampleCell(sample("peak", 348, 245))).toBe("87.0 / 245.0 / 16.0 / 348");
  });

  it("returns 'n/a' for missing samples", () => {
    expect(formatSampleCell(undefined)).toBe("n/a");
  });
});

describe("formatBenchmarkMarkdown", () => {
  it("emits a single block with header, boot table, memory table, and footer", () => {
    const md = formatBenchmarkMarkdown(RESULT, {
      date: "2026-04-30",
      build: "ae2c02b",
      env: "Linux Ubuntu 25.10, WebKitGTK 2.46",
    });
    // Header line.
    expect(md.startsWith("## Benchmark 2026-04-30 (build ae2c02b, Linux Ubuntu 25.10, WebKitGTK 2.46)")).toBe(true);
    // Methodology line.
    expect(md.includes("3000 ms programmatic stress")).toBe(true);
    // Scenario line names the dataset.
    expect(md.includes("dataset benchmark-synth-v1 (1000 events)")).toBe(true);
    // Boot table presence.
    expect(md.includes("### Boot (ms from process start)")).toBe(true);
    expect(md.includes("sql-main-done")).toBe(true);
    expect(md.includes("first-paint")).toBe(true);
    // Memory table presence.
    expect(md.includes("### Memory PSS, MB (backend / frontend / network / total)")).toBe(true);
    // Floor footer.
    expect(md.includes("Settled floor:")).toBe(true);
  });

  it("matches the golden snapshot so spacing changes are intentional", () => {
    const md = formatBenchmarkMarkdown(RESULT, {
      date: "2026-04-30",
      build: "ae2c02b",
      env: "Linux Ubuntu 25.10, WebKitGTK 2.46",
    });
    expect(md).toMatchSnapshot();
  });

  it("substitutes 'n/a' when a boot mark is missing in one phase", () => {
    const partial: BenchmarkResult = {
      ...RESULT,
      phaseA: {
        ...RESULT.phaseA,
        boot: {
          marks: {
            "boot.sql-main-done": 412,
            "boot.first-paint": 542,
          },
        },
      },
    };
    const md = formatBenchmarkMarkdown(partial, { date: "2026-04-30" });
    // maprow-done is missing in A but present in B; cell should be 'n/a'.
    expect(md.includes("maprow-done")).toBe(true);
    expect(md.includes("n/a")).toBe(true);
  });

  it("computes the floor delta against the empty phase", () => {
    const md = formatBenchmarkMarkdown(RESULT, { date: "2026-04-30" });
    // Phase A floor 278, Phase B floor 318: delta is +40.
    expect(md.includes("+40")).toBe(true);
    // Peak A 348, peak B 517: delta is +169.
    expect(md.includes("+169")).toBe(true);
  });
});
