/**
 * Markdown formatter for benchmark results.
 *
 * The shape is pinned so historical rows in `docs/PERFORMANCE.md` stay
 * comparable across builds. The vitest suite in `output.test.ts` locks the
 * format with golden assertions; do not change spacing or column order
 * without bumping `HARNESS_VERSION` in `types.ts`.
 *
 * See the spec doc for the rationale and a worked example.
 */
import type {
  BenchmarkMetric,
  BenchmarkResult,
  PhaseResult,
  SamplePoint,
  SampleLabel,
} from "./types";
import {
  SAMPLE_LABELS,
  STRESS_PEAK_INTERVAL_MS,
  SAMPLE_OFFSETS_MS,
  formatOffsetProse,
} from "./types";

/**
 * Boot marks emitted in the order they appear in the markdown table. The
 * first row is the synthetic `launch-total` derived from the shell baseline
 * and first-paint mark; the rest come from the perflog.
 */
const BOOT_MARK_ORDER: string[] = [
  "boot.app-mount",
  "boot.tz-hydrated",
  "boot.sql-start",
  "boot.sql-main-done",
  "boot.maprow-done",
  "boot.first-paint",
];

function formatMb(n: number): string {
  if (Number.isNaN(n) || !Number.isFinite(n)) return "n/a";
  return n.toFixed(1);
}

function formatTotalMb(n: number): string {
  if (Number.isNaN(n) || !Number.isFinite(n)) return "n/a";
  return Math.round(n).toString();
}

function formatMetricValue(metric: BenchmarkMetric | undefined): string {
  if (!metric) return "n/a";
  if (!Number.isFinite(metric.value)) return "n/a";
  return metric.unit === "count"
    ? Math.round(metric.value).toString()
    : Math.round(metric.value).toString();
}

function formatMetricDetails(metric: BenchmarkMetric | undefined): string {
  if (!metric?.details) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(metric.details)) {
    const label = key.replace(/Ms$/, "");
    if (typeof value === "number") {
      parts.push(key.endsWith("Ms") ? `${label} ${Math.round(value)} ms` : `${label} ${value}`);
    } else {
      parts.push(`${label} ${value}`);
    }
  }
  return parts.join(", ");
}

/** Format one sample row's right-side cell, e.g. `87.0 / 245.0 / 15.8 / 348`. */
export function formatSampleCell(s: SamplePoint | undefined): string {
  if (!s) return "n/a";
  return `${formatMb(s.backendMb)} / ${formatMb(s.frontendMb)} / ${formatMb(s.networkMb)} / ${formatTotalMb(s.totalMb)}`;
}

function findSample(samples: SamplePoint[], label: SampleLabel): SamplePoint | undefined {
  return samples.find((p) => p.label === label);
}

/**
 * Order the curve as the markdown expects (`peak`, `t0`, `+30s`). `peak`
 * is the maximum across the workload samples; the other rows come from the
 * post-workload idle curve.
 */
function orderedSamples(phase: PhaseResult): Map<SampleLabel, SamplePoint | undefined> {
  const map = new Map<SampleLabel, SamplePoint | undefined>();
  let peak: SamplePoint | undefined;
  for (const s of phase.peakSamples) {
    if (!peak || s.totalMb > peak.totalMb) peak = s;
  }
  if (peak) {
    map.set("peak", { ...peak, label: "peak" });
  }
  for (const label of SAMPLE_LABELS) {
    if (label === "peak") continue;
    map.set(label, findSample(phase.curve, label));
  }
  return map;
}

/**
 * Settled floor: the lowest total in the post-peak idle curve. Ties pick
 * the earliest label so the footer reads as the moment we first hit it.
 *
 * Harness caveat: with only `t0` and `+30s` in the curve, the "floor" is a
 * bounded-window asymptote, not a true settled value. Late WebKit GC can
 * fire well past the sampling window. The spec doc explains why this is
 * still the right tradeoff for cross-build comparison.
 */
function findSettledFloor(phase: PhaseResult): { totalMb: number; label: SampleLabel } | undefined {
  let best: { totalMb: number; label: SampleLabel } | undefined;
  for (const s of phase.curve) {
    if (s.label === "peak") continue;
    if (!best || s.totalMb < best.totalMb) {
      best = { totalMb: s.totalMb, label: s.label };
    }
  }
  return best;
}

function metricsByLabel(phase: PhaseResult): Map<string, BenchmarkMetric> {
  const map = new Map<string, BenchmarkMetric>();
  for (const metric of phase.metrics ?? []) {
    map.set(metric.label, metric);
  }
  return map;
}

function formatBootValue(value: number | undefined): string {
  return value === undefined ? "n/a" : Math.round(value).toString();
}

function phaseDataset(result: BenchmarkResult, phase: PhaseResult): string {
  if (phase.phase === "A") {
    return phase.eventCountAtStart === 0 ? "empty" : `setup, ${phase.eventCountAtStart} events`;
  }
  return `benchmark-synth-${result.synthVersion}, ${phase.eventCountAtStart} events`;
}

function formatBootTableRow(result: BenchmarkResult, phase: PhaseResult): string {
  const cells = [
    `Phase ${phase.phase}`,
    phaseDataset(result, phase),
    formatBootValue(phase.startupMs),
    ...BOOT_MARK_ORDER.map((mark) => formatBootValue(phase.boot.marks[mark])),
  ];
  return `| ${cells.join(" | ")} |`;
}

function formatMemoryTableRow(
  result: BenchmarkResult,
  phase: PhaseResult,
  label: SampleLabel,
  sample: SamplePoint | undefined,
): string {
  const timepoint = label === "peak" ? "workload peak" : label === "t0" ? "workload end" : label;
  const cells = [
    `Phase ${phase.phase}`,
    phaseDataset(result, phase),
    timepoint,
    sample ? formatMb(sample.backendMb) : "n/a",
    sample ? formatMb(sample.frontendMb) : "n/a",
    sample ? formatMb(sample.networkMb) : "n/a",
    sample ? formatTotalMb(sample.totalMb) : "n/a",
  ];
  return `| ${cells.join(" | ")} |`;
}

/**
 * Format a complete benchmark result as a single markdown block. Suitable
 * for pasting into `docs/PERFORMANCE.md` and for in-app display in the
 * summary overlay.
 */
export function formatBenchmarkMarkdown(result: BenchmarkResult, opts: {
  /** Override the date stamp; defaults to today's local YYYY-MM-DD. */
  date?: string;
  /** Optional environment hint, e.g. "Linux Ubuntu 25.10, WebKitGTK 2.46". */
  env?: string;
  /** Optional build identifier shown in the header. */
  build?: string;
}): string {
  const dateStr = opts.date ?? today();
  const headerBits: string[] = [];
  if (opts.build) headerBits.push(`build ${opts.build}`);
  if (opts.env) headerBits.push(opts.env);
  else headerBits.push(result.platform);
  const headerSuffix = headerBits.length > 0 ? ` (${headerBits.join(", ")})` : "";

  const lines: string[] = [];
  lines.push(`## Benchmark ${dateStr}${headerSuffix}`);
  lines.push("");
  lines.push(`Scenario: ${result.scenarioId}. Question: ${result.workload.question}`);
  lines.push(
    `Datasets: Phase A ${phaseDataset(result, result.phaseA)}. Phase B ${phaseDataset(result, result.phaseB)}.`,
  );
  lines.push(formatMethodology(result));

  if (result.workload.kind === "startup") {
    appendBootSection(lines, result);
  } else if (result.workload.memoryMode === "post-workload") {
    appendMemorySection(lines, result);
  } else {
    appendMetricsSection(lines, result);
  }

  return lines.join("\n");
}

function formatMethodology(result: BenchmarkResult): string {
  const duration = result.workload.durationMs > 0
    ? `${result.workload.durationMs} ms ${result.workload.label}`
    : result.workload.label;
  if (result.workload.memoryMode === "post-workload") {
    const offsetsClause = SAMPLE_OFFSETS_MS.length === 1
      ? `once at ${formatOffsetProse(SAMPLE_OFFSETS_MS[0])}`
      : `at ${SAMPLE_OFFSETS_MS.map(formatOffsetProse).join(", ")}`;
    return `Methodology: cold-cold against an isolated benchmark DB; ${duration}; memory sampled at ${STRESS_PEAK_INTERVAL_MS} ms during the workload, then ${offsetsClause} post-workload.`;
  }
  return `Methodology: cold-cold against an isolated benchmark DB; ${duration}; no post-workload memory wait.`;
}

function appendBootSection(lines: string[], result: BenchmarkResult): void {
  lines.push("");
  lines.push("### Startup boot");
  lines.push("");
  lines.push("| Phase | Dataset | Launch total ms | App mount ms | Tz hydrated ms | SQL start ms | SQL main done ms | Map row done ms | First paint ms |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|");
  lines.push(formatBootTableRow(result, result.phaseA));
  lines.push(formatBootTableRow(result, result.phaseB));
}

function appendMemorySection(lines: string[], result: BenchmarkResult): void {
  const aSamples = orderedSamples(result.phaseA);
  const bSamples = orderedSamples(result.phaseB);
  const floorA = findSettledFloor(result.phaseA);
  const floorB = findSettledFloor(result.phaseB);

  lines.push("");
  lines.push("### Memory PSS, MB");
  lines.push("");
  lines.push("| Phase | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |");
  lines.push("|---|---|---|---:|---:|---:|---:|");
  for (const label of SAMPLE_LABELS) {
    lines.push(formatMemoryTableRow(result, result.phaseA, label, aSamples.get(label)));
    lines.push(formatMemoryTableRow(result, result.phaseB, label, bSamples.get(label)));
  }
  lines.push("");
  if (floorA && floorB) {
    const peakA = aSamples.get("peak");
    const peakB = bSamples.get("peak");
    const floorDelta = Math.round(floorB.totalMb - floorA.totalMb);
    const peakDelta = peakA && peakB
      ? Math.round(peakB.totalMb - peakA.totalMb)
      : undefined;
    const peakStr = peakDelta === undefined
      ? ""
      : ` Phase B delta over Phase A: ${signed(floorDelta)} MB at floor, ${signed(peakDelta)} MB at peak.`;
    lines.push(
      `Settled floor: Phase A ${formatTotalMb(floorA.totalMb)} MB at ${floorA.label}, Phase B ${formatTotalMb(floorB.totalMb)} MB at ${floorB.label}.${peakStr}`,
    );
  }
}

function appendMetricsSection(lines: string[], result: BenchmarkResult): void {
  const metricLabels = [
    ...new Set([
      ...(result.phaseA.metrics ?? []).map((metric) => metric.label),
      ...(result.phaseB.metrics ?? []).map((metric) => metric.label),
    ]),
  ];
  lines.push("");
  lines.push("### Primary metrics");
  lines.push("");
  if (metricLabels.length === 0) {
    lines.push("No primary metrics were captured.");
    return;
  }

  const phaseAMetrics = metricsByLabel(result.phaseA);
  const phaseBMetrics = metricsByLabel(result.phaseB);
  lines.push("| Metric | Unit | Phase A | Details A | Phase B | Details B |");
  lines.push("|---|---|---:|---|---:|---|");
  for (const label of metricLabels) {
    const aMetric = phaseAMetrics.get(label);
    const bMetric = phaseBMetrics.get(label);
    lines.push(
      `| ${label} | ${aMetric?.unit ?? bMetric?.unit ?? ""} | ${formatMetricValue(aMetric)} | ${formatMetricDetails(aMetric)} | ${formatMetricValue(bMetric)} | ${formatMetricDetails(bMetric)} |`,
    );
  }
}

export function formatBenchmarkSuiteMarkdown(results: BenchmarkResult[], opts: {
  date?: string;
  env?: string;
  build?: string;
}): string {
  return results.map((result) => formatBenchmarkMarkdown(result, opts)).join("\n\n");
}

function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return "0";
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
