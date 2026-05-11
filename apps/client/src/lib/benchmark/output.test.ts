import { describe, it, expect } from "vitest";
import {
  buildBenchmarkSuitePreview,
  formatBenchmarkMarkdown,
  formatBenchmarkSuiteMarkdown,
  formatSampleCell,
} from "./output";
import { HARNESS_VERSION, STRESS_DURATION_MS } from "./types";
import type { BenchmarkResult, PhaseResult, SamplePoint, StartupBootSample } from "./types";

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

function mockPhase(
  phase: "A" | "B",
  peak: number,
  floor: number,
  eventCount: number,
  datasetId?: string,
): PhaseResult {
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
        "boot.usable-paint": phase === "A" ? 620 : 1030,
      },
      launchTotalMs: phase === "A" ? 1430 : 1612,
    },
    startupMs: phase === "A" ? 1430 : 1612,
    eventCountAtStart: eventCount,
    datasetId,
  };
}

function startupSample(
  eventCountAtStart: number,
  firstPaintMs: number,
  usablePaintMs: number,
  launchTotalMs: number,
): StartupBootSample {
  return {
    startedAt: "2026-05-01T10:00:00.000Z",
    eventCountAtStart,
    boot: {
      marks: {
        "boot.first-paint": firstPaintMs,
        "boot.usable-paint": usablePaintMs,
      },
      launchTotalMs,
    },
  };
}

const RESULT: BenchmarkResult = {
  scenarioId: "calendar-nav",
  scenarioLabel: "Calendar week-view nav",
  workload: {
    kind: "stress-memory",
    question: "How much memory does repeated week navigation use?",
    label: "held right-arrow week-view navigation",
    durationMs: STRESS_DURATION_MS,
    memoryMode: "post-workload",
  },
  datasetVersion: "v1",
  harnessVersion: HARNESS_VERSION,
  platform: "Linux",
  buildRef: "0.1.0+9815ea5",
  phaseA: mockPhase("A", 348, 278, 0),
  phaseB: mockPhase("B", 517, 318, 17_520, "dense-v1-r1y-s1-d1"),
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

const REPEATED_STARTUP_RESULT: BenchmarkResult = {
  ...STARTUP_RESULT,
  phaseA: {
    ...STARTUP_RESULT.phaseA,
    startupSamples: [
      startupSample(0, 95, 170, 800),
      startupSample(0, 105, 180, 900),
      startupSample(0, 90, 160, 700),
      startupSample(0, 98, 175, 850),
      startupSample(0, 101, 172, 830),
    ],
  },
  phaseB: {
    ...STARTUP_RESULT.phaseB,
    startupSamples: [
      startupSample(17_520, 230, 520, 1100),
      startupSample(17_520, 220, 500, 1050),
      startupSample(17_520, 240, 550, 1200),
      startupSample(17_520, 210, 490, 1000),
      startupSample(17_520, 235, 530, 1150),
    ],
  },
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
    eventCountAtStart: 2,
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

const WINDOW_SCALE_RESULT: BenchmarkResult = {
  ...RESULT,
  scenarioId: "calendar-window-scale",
  scenarioLabel: "Calendar fixed-window scale",
  workload: {
    kind: "idle-memory",
    question: "How much memory does one fixed calendar window use as stored history grows?",
    label: "fixed anchored week scale check",
    durationMs: STRESS_DURATION_MS,
    memoryMode: "post-workload",
  },
  phaseA: {
    ...RESULT.phaseA,
    metrics: [
      { label: "total stored events", unit: "count", value: 0 },
      { label: "current window rows", unit: "count", value: 0 },
      { label: "current window events", unit: "count", value: 0 },
    ],
  },
  phaseB: {
    ...RESULT.phaseB,
    metrics: [
      { label: "total stored events", unit: "count", value: 17_520 },
      { label: "current window rows", unit: "count", value: 216 },
      { label: "current window events", unit: "count", value: 216 },
    ],
  },
};

const MIXED_METRIC_RESULT: BenchmarkResult = {
  ...RESULT,
  scenarioId: "mixed-metrics",
  scenarioLabel: "Mixed metrics",
  workload: {
    kind: "operation-latency",
    question: "Can repeated and scalar metrics render without empty columns?",
    label: "mixed metric formatting",
    durationMs: 0,
    memoryMode: "none",
  },
  phaseA: {
    ...RESULT.phaseA,
    peakSamples: [],
    curve: [],
    metrics: [
      {
        label: "parse fixtures avg",
        unit: "ms",
        value: 21,
        details: { runs: 5, minMs: 16, medianMs: 17, p95Ms: 37, maxMs: 37 },
      },
      { label: "write fixtures", unit: "ms", value: 82 },
      { label: "import warnings", unit: "count", value: 3 },
    ],
  },
  phaseB: {
    ...RESULT.phaseB,
    peakSamples: [],
    curve: [],
    metrics: [
      {
        label: "parse fixtures avg",
        unit: "ms",
        value: 18,
        details: { runs: 5, minMs: 10, medianMs: 16, p95Ms: 29, maxMs: 29 },
      },
      { label: "write fixtures", unit: "ms", value: 353 },
      { label: "import warnings", unit: "count", value: 3 },
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
  it("emits one metadata table and dataset-based memory rows", () => {
    const md = formatBenchmarkMarkdown(RESULT, {
      date: "2026-05-01",
      build: "9815ea5",
      env: "Linux Ubuntu 25.10, WebKitGTK 2.46",
    });
    expect(md.startsWith("## Benchmark 2026-05-01-ID")).toBe(true);
    expect(md.includes("### Index")).toBe(false);
    expect(md.match(/### Run metadata/g)).toHaveLength(1);
    expect(md.includes(`| 2026-05-01-ID | v${HARNESS_VERSION} | 9815ea5 | Linux Ubuntu 25.10, WebKitGTK 2.46 |`)).toBe(true);
    expect(md.includes("Scenario:")).toBe(false);
    expect(md.includes("Phase A")).toBe(false);
    expect(md.includes("Phase B")).toBe(false);
    expect(md.includes(`${STRESS_DURATION_MS} ms held right-arrow week-view navigation`)).toBe(false);
    expect(md.includes("### Startup boot")).toBe(false);
    expect(md.includes("### Calendar held navigation memory")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | base-0 | workload peak")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | workload peak")).toBe(true);
    expect(md.includes("Settled floor:")).toBe(false);
    expect(md.includes("| Date |")).toBe(false);
    expect(md.includes("| Platform |")).toBe(true);
  });

  it("includes every dense dataset recorded in a multi-pass result", () => {
    const md = formatBenchmarkMarkdown({
      ...RESULT,
      datasetPhases: [
        RESULT.phaseB,
        mockPhase("B", 620, 390, 175_320, "dense-v1-r10y-s1-d1"),
      ],
    }, { date: "2026-05-01" });
    expect(md.includes("| 2026-05-01-ID | base-0 | workload peak")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | workload peak")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r10y-s1-d1 | workload peak")).toBe(true);
  });

  it("matches the golden snapshot so spacing changes are intentional", () => {
    const md = formatBenchmarkMarkdown(RESULT, {
      date: "2026-05-01",
      build: "9815ea5",
      env: "Linux Ubuntu 25.10, WebKitGTK 2.46",
    });
    expect(md).toMatchSnapshot();
  });

  it("substitutes 'n/a' when the usable paint mark is missing in one phase", () => {
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
    expect(md.includes("Usable paint median ms")).toBe(true);
    expect(md.includes("n/a")).toBe(true);
  });

  it("renders 'n/a' for launch median when launch timing is missing", () => {
    const partial: BenchmarkResult = {
      ...STARTUP_RESULT,
      phaseA: {
        ...STARTUP_RESULT.phaseA,
        boot: { marks: STARTUP_RESULT.phaseA.boot.marks },
        startupMs: undefined,
      },
    };
    const md = formatBenchmarkMarkdown(partial, { date: "2026-05-01" });
    expect(md.includes("Launch median ms")).toBe(true);
    expect(md.includes("n/a")).toBe(true);
  });

  it("renders startup boot rows with launch median as the rightmost column", () => {
    const md = formatBenchmarkMarkdown(STARTUP_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Startup boot")).toBe(true);
    const header = md.split("\n").find((line) => line.startsWith("| Run | Dataset | Runs |"));
    expect(header?.endsWith("| Launch median ms |")).toBe(true);
    expect(md.includes("Launch total ms")).toBe(false);
    expect(md.includes("### Calendar held navigation memory")).toBe(false);
    expect(md.includes("no post-workload memory wait")).toBe(false);
  });

  it("summarizes repeated startup launches with median as the headline value", () => {
    const md = formatBenchmarkMarkdown(REPEATED_STARTUP_RESULT, { date: "2026-05-01" });
    expect(md.includes("| 2026-05-01-ID | base-0 | 5 | 98 | 172 | 700 | 900 | 900 | 830 |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | 5 | 230 | 520 | 1000 | 1200 | 1200 | 1100 |")).toBe(true);
  });

  it("renders latency rows with stats split into canonical columns", () => {
    const md = formatBenchmarkMarkdown(METRIC_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Event panel latency")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max | Notes |")).toBe(false);
    expect(md.includes("edit open from closed avg")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | base-2 | edit open from closed avg | 121 | ms | 10 |  | 117 | 138 |  |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | edit open from closed avg | 176 | ms | 10 |  | 171 | 202 |  |")).toBe(true);
    expect(md.includes("details 44 ms")).toBe(false);
    expect(md.includes("### Calendar held navigation memory")).toBe(false);
  });

  it("renders scalar metrics after memory rows when a memory scenario returns checks", () => {
    const md = formatBenchmarkMarkdown(WINDOW_SCALE_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Calendar fixed-window scale memory")).toBe(true);
    expect(md.includes("| Run | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value | Unit |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | total stored events | 17520 | count |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | current window rows | 216 | count |")).toBe(true);
  });

  it("splits scalar metrics from repeated latency rows", () => {
    const md = formatBenchmarkMarkdown(MIXED_METRIC_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Mixed metrics")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | base-0 | parse fixtures avg | 21 | ms | 5 | 16 | 17 | 37 | 37 |")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value | Unit |\n|---|---|---|---:|---|")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | base-0 | write fixtures | 82 | ms |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | import warnings | 3 | count |")).toBe(true);
    expect(md.includes("| write fixtures | 82 | ms |  |")).toBe(false);
  });

  it("builds a structured preview for rendered summary tables", () => {
    const preview = buildBenchmarkSuitePreview([STARTUP_RESULT, METRIC_RESULT], {
      date: "2026-05-01",
      build: "9815ea5",
      env: "Linux Ubuntu 25.10, WebKitGTK 2.46",
    });
    expect(preview.metadata).toMatchObject({
      run: "2026-05-01-ID",
      harness: `v${HARNESS_VERSION}`,
      buildRef: "9815ea5",
      platform: "Linux Ubuntu 25.10, WebKitGTK 2.46",
    });
    expect(preview.sections).toHaveLength(2);
    expect(preview.sections[0]?.kind).toBe("startup");
    expect(preview.sections[1]?.kind).toBe("metrics");
    if (preview.sections[1]?.kind === "metrics") {
      expect(preview.sections[1].latencyRows).toHaveLength(2);
      expect(preview.sections[1].scalarRows).toHaveLength(0);
    }
  });

  it("formats multiple benchmark results as one pasteable suite block without duplicated metadata", () => {
    const md = formatBenchmarkSuiteMarkdown([RESULT, RESULT], { date: "2026-05-01" });
    expect(md.match(/^## Benchmark/gm)).toHaveLength(1);
    expect(md.match(/### Run metadata/g)).toHaveLength(1);
    expect(md.match(/### Calendar held navigation memory/g)).toHaveLength(2);
  });
});
