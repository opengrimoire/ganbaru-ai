import { describe, it, expect } from "vitest";
import {
  buildBenchmarkSuitePreview,
  formatBenchmarkSuiteMarkdown,
} from "./output";
import { HARNESS_VERSION, HELD_NAVIGATION_DURATION_MS } from "./types";
import type {
  BenchmarkMetric,
  BenchmarkResult,
  PhaseResult,
  SamplePoint,
  StartupBootSample,
} from "./types";

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
  // Memory rows are derived from the observation samples.
  const curve: SamplePoint[] = [
    sample("+1s", peak - 30, peak - 117),
    sample("+2s", peak, peak - 87),
    sample("+30s", floor, floor - 87),
  ];
  return {
    phase,
    startedAt: "2026-05-01T10:00:00.000Z",
    workloadDurationMs: 3000,
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

function timingMetric(
  label: string,
  value: number,
  runs: number,
  medianMs: number,
  p95Ms: number,
): BenchmarkMetric {
  return {
    label,
    unit: "ms",
    value,
    details: { runs, medianMs, p95Ms },
  };
}

function scalarMsMetric(label: string, value: number): BenchmarkMetric {
  return {
    label,
    unit: "ms",
    value,
  };
}

const BASE_PHASE = mockPhase("A", 348, 278, 0);
const DENSE_PHASE = mockPhase("B", 517, 318, 19_710, "dense-v1-r1y-s1-d1");

const RESULT: BenchmarkResult = {
  scenarioId: "calendar-nav",
  scenarioLabel: "Calendar week-view nav",
  workload: {
    kind: "stress-memory",
    question: "How much memory does repeated week navigation use?",
    label: "held right-arrow week-view navigation",
    durationMs: HELD_NAVIGATION_DURATION_MS,
    memoryMode: "post-workload",
  },
  datasetVersion: "v1",
  harnessVersion: HARNESS_VERSION,
  platform: "Linux",
  buildRef: "0.1.0+9815ea5",
  anchorDate: "2026-05-01",
  phaseB: DENSE_PHASE,
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
  phaseA: BASE_PHASE,
};

const REPEATED_STARTUP_RESULT: BenchmarkResult = {
  ...STARTUP_RESULT,
  phaseA: {
    ...BASE_PHASE,
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
      startupSample(19_710, 230, 520, 1100),
      startupSample(19_710, 220, 500, 1050),
      startupSample(19_710, 240, 550, 1200),
      startupSample(19_710, 210, 490, 1000),
      startupSample(19_710, 235, 530, 1150),
    ],
  },
};

const METRIC_RESULT: BenchmarkResult = {
  ...RESULT,
  scenarioId: "calendar-panel-latency",
  scenarioLabel: "Calendar panel latency",
  workload: {
    kind: "interaction-latency",
    question: "How quickly does the calendar panel open from user actions?",
    label: "scripted calendar panel open actions",
    durationMs: 0,
    memoryMode: "none",
  },
  phaseB: {
    ...DENSE_PHASE,
    curve: [],
    metrics: [
      timingMetric("click existing event avg", 176, 50, 171, 202),
      timingMetric("click empty time slot avg", 117, 50, 99, 206),
    ],
  },
  peakTotalMb: undefined,
};

const IDLE_MEMORY_RESULT: BenchmarkResult = {
  ...RESULT,
  scenarioId: "idle-memory",
  scenarioLabel: "Idle memory",
  workload: {
    kind: "idle-memory",
    question: "How much memory does the calendar hold while idle?",
    label: "idle calendar baseline",
    durationMs: 0,
    memoryMode: "post-workload",
  },
  phaseA: BASE_PHASE,
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
    ...BASE_PHASE,
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
    ...DENSE_PHASE,
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

const IMPORT_RESULT: BenchmarkResult = {
  ...RESULT,
  scenarioId: "calendar-import-ops",
  scenarioLabel: "Calendar import operations",
  workload: {
    kind: "operation-latency",
    question: "How quickly does Rust apply typed calendar import payloads?",
    label: "scripted calendar bulk import commands",
    durationMs: 0,
    memoryMode: "none",
  },
  phaseB: {
    ...DENSE_PHASE,
    curve: [],
    metrics: [
      timingMetric("bulk import 100 add avg", 60, 3, 58, 85),
      timingMetric("bulk import 100 update avg", 42, 3, 40, 47),
      scalarMsMetric("bulk import 1000 add", 315),
      scalarMsMetric("bulk import 1000 update", 352),
    ],
  },
  peakTotalMb: undefined,
};

describe("formatBenchmarkSuiteMarkdown", () => {
  it("emits one metadata table and canonical held-navigation memory rows", () => {
    const md = formatBenchmarkSuiteMarkdown([RESULT], {
      date: "2026-05-01",
      build: "9815ea5",
      env: "Linux Ubuntu 25.10, WebKitGTK 2.46",
    });
    expect(md.startsWith("## Benchmark 2026-05-01-ID")).toBe(true);
    expect(md.includes("### Index")).toBe(false);
    expect(md.match(/### Run metadata/g)).toHaveLength(1);
    expect(md.includes(`| 2026-05-01-ID | v${HARNESS_VERSION} | 2026-05-01 | 9815ea5 | Linux Ubuntu 25.10, WebKitGTK 2.46 |`)).toBe(true);
    expect(md.includes("Scenario:")).toBe(false);
    expect(md.includes("Phase A")).toBe(false);
    expect(md.includes("Phase B")).toBe(false);
    expect(md.includes(`${HELD_NAVIGATION_DURATION_MS} ms held right-arrow week-view navigation`)).toBe(false);
    expect(md.includes("### Startup boot")).toBe(false);
    expect(md.includes("### Calendar held navigation memory")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | base-0 | Max")).toBe(false);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | Min | 87.0 | 231.0 | 16.0 | 318 |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | Max | 87.0 | 430.0 | 16.0 | 517 |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | End | 87.0 | 231.0 | 16.0 | 318 |")).toBe(true);
    expect(md.includes("Settled floor:")).toBe(false);
    expect(md.includes("| Date |")).toBe(false);
    expect(md.includes("| Platform |")).toBe(true);
  });

  it("keeps every dataset for total-history idle memory", () => {
    const md = formatBenchmarkSuiteMarkdown([{
      ...IDLE_MEMORY_RESULT,
      datasetPhases: [
        IDLE_MEMORY_RESULT.phaseB,
        mockPhase("B", 620, 390, 197_235, "dense-v1-r10y-s1-d1"),
      ],
    }], { date: "2026-05-01" });
    expect(md.includes("| 2026-05-01-ID | base-0 | Max")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | Max")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r10y-s1-d1 | Max")).toBe(true);
  });

  it("matches the golden snapshot so spacing changes are intentional", () => {
    const md = formatBenchmarkSuiteMarkdown([RESULT], {
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
        ...BASE_PHASE,
        boot: {
          marks: {
            "boot.sql-main-done": 412,
            "boot.first-paint": 542,
          },
        },
      },
    };
    const md = formatBenchmarkSuiteMarkdown([partial], { date: "2026-05-01" });
    expect(md.includes("Usable paint median ms")).toBe(true);
    expect(md.includes("n/a")).toBe(true);
  });

  it("renders 'n/a' for launch median when launch timing is missing", () => {
    const partial: BenchmarkResult = {
      ...STARTUP_RESULT,
      phaseA: {
        ...BASE_PHASE,
        boot: { marks: BASE_PHASE.boot.marks },
        startupMs: undefined,
      },
    };
    const md = formatBenchmarkSuiteMarkdown([partial], { date: "2026-05-01" });
    expect(md.includes("Launch median ms")).toBe(true);
    expect(md.includes("n/a")).toBe(true);
  });

  it("renders startup boot rows with launch P95 as the rightmost column", () => {
    const md = formatBenchmarkSuiteMarkdown([STARTUP_RESULT], { date: "2026-05-01" });
    expect(md.includes("### Startup boot")).toBe(true);
    const header = md.split("\n").find((line) => line.startsWith("| Run | Dataset | Runs |"));
    expect(header?.endsWith("| Launch P95 ms |")).toBe(true);
    expect(header?.includes("First paint median ms")).toBe(false);
    expect(header?.includes("Launch min ms")).toBe(false);
    expect(header?.includes("Launch max ms")).toBe(false);
    expect(md.includes("Launch total ms")).toBe(false);
    expect(md.includes("### Calendar held navigation memory")).toBe(false);
    expect(md.includes("no post-workload memory wait")).toBe(false);
  });

  it("summarizes repeated startup launches with median as the headline value", () => {
    const md = formatBenchmarkSuiteMarkdown([REPEATED_STARTUP_RESULT], { date: "2026-05-01" });
    expect(md.includes("| 2026-05-01-ID | base-0 | 5 | 172 | 830 | 900 |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | 5 | 520 | 1100 | 1200 |")).toBe(true);
  });

  it("renders latency rows in the reduced canonical shape", () => {
    const md = formatBenchmarkSuiteMarkdown([METRIC_RESULT], { date: "2026-05-01" });
    expect(md.includes("### Calendar panel latency")).toBe(true);
    expect(md.includes("50 runs per action")).toBe(false);
    expect(md.includes("| Run | Dataset | Action | Median ms | P95 ms |")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Runs | Median ms | P95 ms |")).toBe(false);
    expect(md.includes("| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |")).toBe(false);
    expect(md.includes("click existing event avg")).toBe(false);
    expect(md.includes("| 2026-05-01-ID | base-2 | click existing event")).toBe(false);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | click existing event | 171 | 202 |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | click empty time slot | 99 | 206 |")).toBe(true);
    expect(md.includes("edit switch while open")).toBe(false);
    expect(md.includes("create cancel after guard")).toBe(false);
    expect(md.includes("details 44 ms")).toBe(false);
    expect(md.includes("### Calendar held navigation memory")).toBe(false);
  });

  it("does not render dataset shape checks as idle memory metrics", () => {
    const md = formatBenchmarkSuiteMarkdown([IDLE_MEMORY_RESULT], { date: "2026-05-01" });
    expect(md.includes("### Idle memory")).toBe(true);
    expect(md.includes("| Run | Dataset | Statistic | Backend MB | Frontend MB | Network MB | Total MB |")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value | Unit |")).toBe(false);
    expect(md.includes("total stored events")).toBe(false);
    expect(md.includes("loaded week rows")).toBe(false);
  });

  it("splits scalar metrics from repeated latency rows", () => {
    const md = formatBenchmarkSuiteMarkdown([MIXED_METRIC_RESULT], { date: "2026-05-01" });
    expect(md.includes("### Mixed metrics")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Runs | Median ms | P95 ms |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | base-0 | parse fixtures | 5 | 17 | 37 |")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value | Unit |\n|---|---|---|---:|---|")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | base-0 | write fixtures | 82 | ms |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | import warnings | 3 | count |")).toBe(true);
    expect(md.includes("| write fixtures | 82 | ms |  |")).toBe(false);
  });

  it("keeps only 1000-event import scalar rows in the canonical scalar shape", () => {
    const md = formatBenchmarkSuiteMarkdown([IMPORT_RESULT], { date: "2026-05-01" });
    expect(md.includes("### Calendar import operations")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value ms |\n|---|---|---|---:|")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | bulk import 1000 add | 315 |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | bulk import 1000 update | 352 |")).toBe(true);
    expect(md.includes("bulk import 100 add")).toBe(false);
    expect(md.includes("bulk import 100 update")).toBe(false);
    expect(md.includes("base-0")).toBe(false);
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
      anchorDate: "2026-05-01",
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
