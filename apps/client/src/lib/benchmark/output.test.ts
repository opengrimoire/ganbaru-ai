import { describe, it, expect } from "vitest";
import { formatBenchmarkMarkdown, formatBenchmarkSuiteMarkdown, formatSampleCell } from "./output";
import {
  SAMPLE_OFFSETS_MS,
  STRESS_DURATION_MS,
  STRESS_PEAK_INTERVAL_MS,
  formatOffsetProse,
} from "./types";
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
  // The current idle curve has just t0 and +30s; +30s is the bounded-window
  // floor we report. Pin it at `floor` so the formatter's footer is
  // deterministic.
  const curve: SamplePoint[] = [
    sample("t0", peak - 30, peak - 117),
    sample("+30s", floor, floor - 87),
  ];
  return {
    phase,
    startedAt: "2026-05-01T10:00:00.000Z",
    workloadDurationMs: 3000,
    peakSamples,
    curve,
    boot: {
      marks: {
        "boot.sql-main-done": phase === "A" ? 412 : 609,
        "boot.maprow-done": phase === "A" ? 415 : 783,
        "boot.first-paint": phase === "A" ? 542 : 921,
      },
    },
    startupMs: phase === "A" ? 1430 : 1612,
    eventCountAtStart: eventCount,
  };
}

const RESULT: BenchmarkResult = {
  scenarioId: "calendar-nav",
  scenarioLabel: "Calendar week-view nav",
  workload: {
    kind: "stress-memory",
    question: "How much memory does repeated week navigation use?",
    label: "programmatic week-view navigation stress",
    durationMs: STRESS_DURATION_MS,
    memoryMode: "post-workload",
  },
  synthVersion: "v1",
  harnessVersion: "4",
  platform: "Linux",
  phaseA: mockPhase("A", 348, 278, 0),
  phaseB: mockPhase("B", 517, 318, 1000),
  peakTotalMb: 517,
};

const STARTUP_RESULT: BenchmarkResult = {
  ...RESULT,
  scenarioId: "startup-boot",
  scenarioLabel: "Startup boot",
  workload: {
    kind: "startup",
    question: "How fast does the app launch into the calendar?",
    label: "calendar startup boot marks",
    durationMs: 0,
    memoryMode: "none",
  },
  peakTotalMb: undefined,
};

const METRIC_RESULT: BenchmarkResult = {
  ...RESULT,
  scenarioId: "event-panel-open",
  scenarioLabel: "Event panel open",
  workload: {
    kind: "interaction-latency",
    question: "How quickly does the event panel paint for existing events?",
    label: "scripted event-panel open interactions",
    durationMs: 0,
    memoryMode: "none",
  },
  phaseA: {
    ...RESULT.phaseA,
    peakSamples: [],
    curve: [],
    metrics: [
      {
        label: "edit open from closed avg",
        unit: "ms",
        value: 121,
        details: { runs: 10, medianMs: 117, p95Ms: 138, detailsMs: 44 },
      },
    ],
  },
  phaseB: {
    ...RESULT.phaseB,
    peakSamples: [],
    curve: [],
    metrics: [
      {
        label: "edit open from closed avg",
        unit: "ms",
        value: 176,
        details: { runs: 10, medianMs: 171, p95Ms: 202, detailsMs: 72 },
      },
    ],
  },
  peakTotalMb: undefined,
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
  it("emits a memory block without incidental boot tables", () => {
    const md = formatBenchmarkMarkdown(RESULT, {
      date: "2026-05-01",
      build: "9815ea5",
      env: "Linux Ubuntu 25.10, WebKitGTK 2.46",
    });
    expect(md.startsWith("## Benchmark 2026-05-01 (build 9815ea5, Linux Ubuntu 25.10, WebKitGTK 2.46)")).toBe(true);
    expect(md.includes("Question: How much memory does repeated week navigation use?")).toBe(true);
    expect(md.includes(`${STRESS_DURATION_MS} ms programmatic week-view navigation stress`)).toBe(true);
    expect(md.includes(`memory sampled at ${STRESS_PEAK_INTERVAL_MS} ms during the workload`)).toBe(true);
    expect(md.includes(`once at ${formatOffsetProse(SAMPLE_OFFSETS_MS[0])} post-workload`)).toBe(true);
    expect(md.includes("Phase B benchmark-synth-v1, 1000 events")).toBe(true);
    expect(md.includes("### Startup boot")).toBe(false);
    expect(md.includes("### Memory PSS, MB")).toBe(true);
    expect(md.includes("Phase A | empty")).toBe(true);
    expect(md.includes("Phase B | benchmark-synth-v1, 1000 events")).toBe(true);
    expect(md.includes("Settled floor:")).toBe(true);
  });

  it("matches the golden snapshot so spacing changes are intentional", () => {
    const md = formatBenchmarkMarkdown(RESULT, {
      date: "2026-05-01",
      build: "9815ea5",
      env: "Linux Ubuntu 25.10, WebKitGTK 2.46",
    });
    expect(md).toMatchSnapshot();
  });

  it("substitutes 'n/a' when a boot mark is missing in one phase", () => {
    const partial: BenchmarkResult = {
      ...STARTUP_RESULT,
      phaseA: {
        ...STARTUP_RESULT.phaseA,
        boot: {
          marks: {
            "boot.sql-main-done": 412,
            "boot.first-paint": 542,
          },
        },
      },
    };
    const md = formatBenchmarkMarkdown(partial, { date: "2026-05-01" });
    expect(md.includes("Map row done ms")).toBe(true);
    expect(md.includes("n/a")).toBe(true);
  });

  it("renders 'n/a' for launch-total when startupMs is missing", () => {
    const partial: BenchmarkResult = {
      ...STARTUP_RESULT,
      phaseA: { ...STARTUP_RESULT.phaseA, startupMs: undefined },
    };
    const md = formatBenchmarkMarkdown(partial, { date: "2026-05-01" });
    expect(md.includes("Launch total ms")).toBe(true);
    expect(md.includes("n/a")).toBe(true);
  });

  it("computes the floor delta against the empty phase", () => {
    const md = formatBenchmarkMarkdown(RESULT, { date: "2026-05-01" });
    // Phase A floor 278, Phase B floor 318: delta is +40.
    expect(md.includes("+40")).toBe(true);
    // Peak A 348, peak B 517: delta is +169.
    expect(md.includes("+169")).toBe(true);
  });

  it("renders startup boot rows without memory sampling output", () => {
    const md = formatBenchmarkMarkdown(STARTUP_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Startup boot")).toBe(true);
    expect(md.includes("Launch total ms")).toBe(true);
    expect(md.includes("### Memory PSS, MB")).toBe(false);
    expect(md.includes("no post-workload memory wait")).toBe(true);
  });

  it("renders primary metric rows when phases include metrics", () => {
    const md = formatBenchmarkMarkdown(METRIC_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Primary metrics")).toBe(true);
    expect(md.includes("edit open from closed avg")).toBe(true);
    expect(md.includes("runs 10")).toBe(true);
    expect(md.includes("details 44 ms")).toBe(true);
    expect(md.includes("details 72 ms")).toBe(true);
    expect(md.includes("### Memory PSS, MB")).toBe(false);
  });

  it("formats multiple benchmark results as one pasteable suite block", () => {
    const md = formatBenchmarkSuiteMarkdown([RESULT, RESULT], { date: "2026-05-01" });
    expect(md.match(/^## Benchmark/gm)).toHaveLength(2);
  });
});
