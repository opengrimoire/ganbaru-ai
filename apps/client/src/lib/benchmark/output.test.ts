import { describe, it, expect } from "vitest";
import {
  buildBenchmarkSuitePreview,
  formatBenchmarkMarkdown,
  formatBenchmarkSuiteMarkdown,
  formatSampleCell,
} from "./output";
import { HARNESS_VERSION, STRESS_DURATION_MS } from "./types";
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
  phaseB: mockPhase("B", 517, 318, 19_710, "dense-v1-r1y-s1-d1"),
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
      timingMetric("edit open from closed avg", 121, 10, 117, 138),
      timingMetric("edit switch while open avg", 44, 10, 41, 60),
    ],
  },
  phaseB: {
    ...RESULT.phaseB,
    peakSamples: [],
    curve: [],
    metrics: [
      timingMetric("edit open from closed avg", 176, 10, 171, 202),
      timingMetric("edit switch while open avg", 72, 10, 70, 95),
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
    durationMs: STRESS_DURATION_MS,
    memoryMode: "post-workload",
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

const CREATE_RESULT: BenchmarkResult = {
  ...RESULT,
  scenarioId: "calendar-create-cancel",
  scenarioLabel: "Calendar create cancel",
  workload: {
    kind: "interaction-latency",
    question: "How quickly does the create panel open and cancel?",
    label: "scripted create-panel open and cancel",
    durationMs: 0,
    memoryMode: "none",
  },
  phaseA: {
    ...RESULT.phaseA,
    peakSamples: [],
    curve: [],
    metrics: [
      timingMetric("create panel open avg", 39, 6, 34, 78),
      timingMetric("create cancel after guard avg", 60, 6, 59, 62),
    ],
  },
  phaseB: {
    ...RESULT.phaseB,
    peakSamples: [],
    curve: [],
    metrics: [
      timingMetric("create panel open avg", 117, 6, 99, 206),
      timingMetric("create cancel after guard avg", 130, 6, 127, 142),
    ],
  },
  datasetPhases: [
    {
      ...RESULT.phaseB,
      peakSamples: [],
      curve: [],
      metrics: [
        timingMetric("create panel open avg", 117, 6, 99, 206),
        timingMetric("create cancel after guard avg", 130, 6, 127, 142),
      ],
    },
    {
      ...RESULT.phaseB,
      eventCountAtStart: 197_235,
      datasetId: "dense-v1-r10y-s1-d1",
      peakSamples: [],
      curve: [],
      metrics: [
        timingMetric("create panel open avg", 127, 6, 98, 256),
        timingMetric("create cancel after guard avg", 130, 6, 127, 142),
      ],
    },
  ],
  peakTotalMb: undefined,
};

const WRITE_RESULT: BenchmarkResult = {
  ...RESULT,
  scenarioId: "calendar-write-ops",
  scenarioLabel: "Calendar write operations",
  workload: {
    kind: "operation-latency",
    question: "How quickly do Rust-backed calendar write commands finish?",
    label: "scripted calendar write commands",
    durationMs: 0,
    memoryMode: "none",
  },
  phaseA: {
    ...RESULT.phaseA,
    peakSamples: [],
    curve: [],
    metrics: [
      timingMetric("event create save avg", 8, 8, 6, 26),
      timingMetric("event patch save avg", 5, 8, 5, 6),
      timingMetric("event delete avg", 6, 8, 5, 8),
      timingMetric("recurring detach avg", 6, 5, 6, 7),
      timingMetric("recurring split avg", 6, 5, 5, 7),
    ],
  },
  phaseB: {
    ...RESULT.phaseB,
    peakSamples: [],
    curve: [],
    metrics: [
      timingMetric("event create save avg", 53, 8, 7, 341),
      timingMetric("event patch save avg", 6, 8, 6, 9),
      timingMetric("event delete avg", 12, 8, 11, 15),
      timingMetric("recurring detach avg", 5, 5, 5, 6),
      timingMetric("recurring split avg", 6, 5, 5, 8),
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
  phaseA: {
    ...RESULT.phaseA,
    peakSamples: [],
    curve: [],
    metrics: [
      timingMetric("bulk import 100 add avg", 43, 3, 39, 55),
      timingMetric("bulk import 100 update avg", 40, 3, 40, 45),
      scalarMsMetric("bulk import 1000 add", 295),
      scalarMsMetric("bulk import 1000 update", 318),
    ],
  },
  phaseB: {
    ...RESULT.phaseB,
    peakSamples: [],
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

const THEME_RESULT: BenchmarkResult = {
  ...RESULT,
  scenarioId: "theme-persistence-ops",
  scenarioLabel: "Theme persistence operations",
  workload: {
    kind: "operation-latency",
    question: "How quickly do Rust-backed theme persistence commands finish?",
    label: "scripted theme persistence commands",
    durationMs: 0,
    memoryMode: "none",
  },
  phaseA: {
    ...RESULT.phaseA,
    peakSamples: [],
    curve: [],
    metrics: [
      timingMetric("theme snapshot insert avg", 18, 8, 11, 68),
    ],
  },
  phaseB: {
    ...RESULT.phaseB,
    peakSamples: [],
    curve: [],
    metrics: [
      timingMetric("theme snapshot insert avg", 56, 8, 11, 340),
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
  it("emits one metadata table and canonical held-navigation memory rows", () => {
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
    expect(md.includes("| 2026-05-01-ID | base-0 | workload peak")).toBe(false);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | workload peak")).toBe(true);
    expect(md.includes("Settled floor:")).toBe(false);
    expect(md.includes("| Date |")).toBe(false);
    expect(md.includes("| Platform |")).toBe(true);
  });

  it("filters held-navigation memory to the practical dense dataset", () => {
    const md = formatBenchmarkMarkdown({
      ...RESULT,
      datasetPhases: [
        RESULT.phaseB,
        mockPhase("B", 620, 390, 197_235, "dense-v1-r10y-s1-d1"),
      ],
    }, { date: "2026-05-01" });
    expect(md.includes("| 2026-05-01-ID | base-0 | workload peak")).toBe(false);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | workload peak")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r10y-s1-d1 | workload peak")).toBe(false);
  });

  it("keeps every dataset for total-history idle memory", () => {
    const md = formatBenchmarkMarkdown({
      ...IDLE_MEMORY_RESULT,
      datasetPhases: [
        IDLE_MEMORY_RESULT.phaseB,
        mockPhase("B", 620, 390, 197_235, "dense-v1-r10y-s1-d1"),
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

  it("renders startup boot rows with launch P95 as the rightmost column", () => {
    const md = formatBenchmarkMarkdown(STARTUP_RESULT, { date: "2026-05-01" });
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
    const md = formatBenchmarkMarkdown(REPEATED_STARTUP_RESULT, { date: "2026-05-01" });
    expect(md.includes("| 2026-05-01-ID | base-0 | 5 | 172 | 830 | 900 |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | 5 | 520 | 1100 | 1200 |")).toBe(true);
  });

  it("renders latency rows in the reduced canonical shape", () => {
    const md = formatBenchmarkMarkdown(METRIC_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Event panel latency")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Runs | Median ms | P95 ms |")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |")).toBe(false);
    expect(md.includes("edit open from closed avg")).toBe(false);
    expect(md.includes("| 2026-05-01-ID | base-2 | edit open from closed")).toBe(false);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | edit open from closed | 10 | 171 | 202 |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | edit switch while open | 10 | 70 | 95 |")).toBe(true);
    expect(md.includes("details 44 ms")).toBe(false);
    expect(md.includes("### Calendar held navigation memory")).toBe(false);
  });

  it("does not render dataset shape checks as idle memory metrics", () => {
    const md = formatBenchmarkMarkdown(IDLE_MEMORY_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Idle memory")).toBe(true);
    expect(md.includes("| Run | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value | Unit |")).toBe(false);
    expect(md.includes("total stored events")).toBe(false);
    expect(md.includes("loaded week rows")).toBe(false);
  });

  it("splits scalar metrics from repeated latency rows", () => {
    const md = formatBenchmarkMarkdown(MIXED_METRIC_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Mixed metrics")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Runs | Median ms | P95 ms |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | base-0 | parse fixtures | 5 | 17 | 37 |")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value | Unit |\n|---|---|---|---:|---|")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | base-0 | write fixtures | 82 | ms |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | import warnings | 3 | count |")).toBe(true);
    expect(md.includes("| write fixtures | 82 | ms |  |")).toBe(false);
  });

  it("keeps only create-panel open latency for the practical dense dataset", () => {
    const md = formatBenchmarkMarkdown(CREATE_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Create panel latency")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | create panel open | 6 | 99 | 206 |")).toBe(true);
    expect(md.includes("create cancel after guard")).toBe(false);
    expect(md.includes("base-0")).toBe(false);
    expect(md.includes("dense-v1-r10y-s1-d1")).toBe(false);
  });

  it("keeps only canonical calendar write operations for the practical dense dataset", () => {
    const md = formatBenchmarkMarkdown(WRITE_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Calendar write operations")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | event create save | 8 | 7 | 341 |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | event patch save | 8 | 6 | 9 |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | recurring split | 5 | 5 | 8 |")).toBe(true);
    expect(md.includes("event delete")).toBe(false);
    expect(md.includes("recurring detach")).toBe(false);
    expect(md.includes("base-0")).toBe(false);
  });

  it("keeps only 1000-event import scalar rows in the canonical scalar shape", () => {
    const md = formatBenchmarkMarkdown(IMPORT_RESULT, { date: "2026-05-01" });
    expect(md.includes("### Calendar import operations")).toBe(true);
    expect(md.includes("| Run | Dataset | Metric | Value ms |\n|---|---|---|---:|")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | bulk import 1000 add | 315 |")).toBe(true);
    expect(md.includes("| 2026-05-01-ID | dense-v1-r1y-s1-d1 | bulk import 1000 update | 352 |")).toBe(true);
    expect(md.includes("bulk import 100 add")).toBe(false);
    expect(md.includes("bulk import 100 update")).toBe(false);
    expect(md.includes("base-0")).toBe(false);
  });

  it("omits diagnostic persistence sections from canonical suite markdown", () => {
    const md = formatBenchmarkSuiteMarkdown([WRITE_RESULT, THEME_RESULT], { date: "2026-05-01" });
    expect(md.includes("### Calendar write operations")).toBe(true);
    expect(md.includes("### Theme persistence operations")).toBe(false);
    expect(md.includes("theme snapshot insert")).toBe(false);
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
