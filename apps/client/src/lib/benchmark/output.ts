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
  StartupBootSample,
} from "./types";
import { SAMPLE_LABELS } from "./types";

/**
 * Boot marks used for startup summary stats. The headline launch stat uses
 * process spawn through usable calendar paint.
 */
const FIRST_PAINT_MARK = "boot.first-paint";
const USABLE_PAINT_MARK = "boot.usable-paint";

const STAT_DETAIL_KEYS = ["runs", "minMs", "medianMs", "p95Ms", "maxMs"] as const;
export interface BenchmarkRunMetadataRow {
  run: string;
  harness: string;
  buildRef: string;
  platform: string;
  notes: string;
}

export interface BenchmarkStartupRow {
  run: string;
  dataset: string;
  runs: string;
  firstPaintMedianMs: string;
  usablePaintMedianMs: string;
  launchMinMs: string;
  launchP95Ms: string;
  launchMaxMs: string;
  launchMedianMs: string;
}

export interface BenchmarkMemoryRow {
  run: string;
  dataset: string;
  timepoint: string;
  backendMb: string;
  frontendMb: string;
  networkMb: string;
  totalMb: string;
}

export interface BenchmarkLatencyRow {
  run: string;
  dataset: string;
  metric: string;
  value: string;
  unit: string;
  runs: string;
  min: string;
  median: string;
  p95: string;
  max: string;
}

export interface BenchmarkScalarMetricRow {
  run: string;
  dataset: string;
  metric: string;
  value: string;
  unit: string;
}

export type BenchmarkPreviewSection =
  | {
    id: string;
    title: string;
    kind: "startup";
    rows: BenchmarkStartupRow[];
  }
  | {
    id: string;
    title: string;
    kind: "memory";
    rows: BenchmarkMemoryRow[];
    latencyRows: BenchmarkLatencyRow[];
    scalarRows: BenchmarkScalarMetricRow[];
  }
  | {
    id: string;
    title: string;
    kind: "metrics";
    latencyRows: BenchmarkLatencyRow[];
    scalarRows: BenchmarkScalarMetricRow[];
  };

export interface BenchmarkSuitePreview {
  metadata: BenchmarkRunMetadataRow;
  sections: BenchmarkPreviewSection[];
}

interface BenchmarkOutputOptions {
  /** Override the date stamp; defaults to today's local YYYY-MM-DD. */
  date?: string;
  /** Optional environment hint, e.g. "Linux Ubuntu 25.10, WebKitGTK 2.46". */
  env?: string;
  /** Optional build identifier shown in run metadata. */
  build?: string;
  /** Optional complete run id. Defaults to `${date}-ID`. */
  run?: string;
  /** Optional run notes. */
  notes?: string;
}

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

interface NumberStats {
  runs: number;
  min?: number;
  median?: number;
  p95?: number;
  max?: number;
}

function numberStats(values: Array<number | undefined>): NumberStats {
  const finite = values
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (finite.length === 0) return { runs: 0 };
  return {
    runs: finite.length,
    min: finite[0],
    median: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    max: finite[finite.length - 1],
  };
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * fraction) - 1));
  return sortedValues[index] ?? Number.NaN;
}

function fallbackStartupSample(phase: PhaseResult): StartupBootSample {
  return {
    startedAt: phase.startedAt,
    eventCountAtStart: phase.eventCountAtStart,
    boot: {
      ...phase.boot,
      launchTotalMs: phase.boot.launchTotalMs ?? phase.startupMs,
    },
  };
}

function startupSamples(phase: PhaseResult): StartupBootSample[] {
  return phase.startupSamples && phase.startupSamples.length > 0
    ? phase.startupSamples
    : [fallbackStartupSample(phase)];
}

function resultPhases(result: BenchmarkResult): PhaseResult[] {
  return [
    result.phaseA,
    ...(result.datasetPhases && result.datasetPhases.length > 0
      ? result.datasetPhases
      : [result.phaseB]),
  ];
}

export function benchmarkDatasetLabel(result: BenchmarkResult, phase: PhaseResult): string {
  if (phase.phase === "A") {
    return `base-${phase.eventCountAtStart}`;
  }
  if (phase.datasetId) return phase.datasetId;
  const datasetVersion = result.datasetVersion.startsWith("v")
    ? result.datasetVersion
    : `v${result.datasetVersion}`;
  return `dense-${datasetVersion}-${phase.eventCountAtStart}`;
}

function timepointLabel(label: SampleLabel): string {
  return label === "peak" ? "workload peak" : label === "t0" ? "workload end" : label;
}

function buildStartupRows(result: BenchmarkResult, run: string): BenchmarkStartupRow[] {
  return resultPhases(result).map((phase) => {
    const samples = startupSamples(phase);
    const firstPaintStats = numberStats(samples.map((sample) => sample.boot.marks[FIRST_PAINT_MARK]));
    const usablePaintStats = numberStats(samples.map((sample) => sample.boot.marks[USABLE_PAINT_MARK]));
    const launchStats = numberStats(samples.map((sample) => sample.boot.launchTotalMs));
    return {
      run,
      dataset: benchmarkDatasetLabel(result, phase),
      runs: launchStats.runs.toString(),
      firstPaintMedianMs: formatBootValue(firstPaintStats.median),
      usablePaintMedianMs: formatBootValue(usablePaintStats.median),
      launchMinMs: formatBootValue(launchStats.min),
      launchP95Ms: formatBootValue(launchStats.p95),
      launchMaxMs: formatBootValue(launchStats.max),
      launchMedianMs: formatBootValue(launchStats.median),
    };
  });
}

function buildMemoryRows(result: BenchmarkResult, run: string): BenchmarkMemoryRow[] {
  const rows: BenchmarkMemoryRow[] = [];
  for (const phase of resultPhases(result)) {
    const samples = orderedSamples(phase);
    for (const label of SAMPLE_LABELS) {
      const sample = samples.get(label);
      rows.push(formatMemoryRow(result, phase, run, label, sample));
    }
  }
  return rows;
}

function formatMemoryRow(
  result: BenchmarkResult,
  phase: PhaseResult,
  run: string,
  label: SampleLabel,
  sample: SamplePoint | undefined,
): BenchmarkMemoryRow {
  return {
    run,
    dataset: benchmarkDatasetLabel(result, phase),
    timepoint: timepointLabel(label),
    backendMb: sample ? formatMb(sample.backendMb) : "n/a",
    frontendMb: sample ? formatMb(sample.frontendMb) : "n/a",
    networkMb: sample ? formatMb(sample.networkMb) : "n/a",
    totalMb: sample ? formatTotalMb(sample.totalMb) : "n/a",
  };
}

/**
 * Build the structured summary used by the readable in-app preview and the
 * canonical markdown formatter.
 */
export function buildBenchmarkSuitePreview(
  results: BenchmarkResult[],
  opts: BenchmarkOutputOptions = {},
): BenchmarkSuitePreview {
  const run = runId(opts);
  const buildRef = opts.build ?? unique(results.map((result) => result.buildRef).filter(isDefined)).join(", ");
  const platform = opts.env ?? unique(results.map((result) => result.platform)).join(", ");
  const harness = unique(results.map((result) => result.harnessVersion)).map(formatHarness).join(", ");
  const metadata: BenchmarkRunMetadataRow = {
    run,
    harness: harness || "n/a",
    buildRef: buildRef || "n/a",
    platform: platform || "n/a",
    notes: opts.notes ?? "",
  };
  const sections = results.map((result) => buildSection(result, run));
  return {
    metadata,
    sections,
  };
}

/**
 * Format a complete benchmark result as a canonical markdown block.
 */
export function formatBenchmarkMarkdown(
  result: BenchmarkResult,
  opts: BenchmarkOutputOptions = {},
): string {
  return formatBenchmarkSuiteMarkdown([result], opts);
}

function buildSection(result: BenchmarkResult, run: string): BenchmarkPreviewSection {
  if (result.workload.kind === "startup") {
    return {
      id: result.scenarioId,
      title: sectionTitle(result),
      kind: "startup",
      rows: buildStartupRows(result, run),
    };
  }
  if (result.workload.memoryMode === "post-workload") {
    const metricRows = buildMetricRows(result, run);
    return {
      id: result.scenarioId,
      title: sectionTitle(result),
      kind: "memory",
      rows: buildMemoryRows(result, run),
      ...metricRows,
    };
  }
  return {
    id: result.scenarioId,
    title: sectionTitle(result),
    kind: "metrics",
    ...buildMetricRows(result, run),
  };
}

function buildMetricRows(
  result: BenchmarkResult,
  run: string,
): { latencyRows: BenchmarkLatencyRow[]; scalarRows: BenchmarkScalarMetricRow[] } {
  const metricLabels = [
    ...new Set([
      ...resultPhases(result).flatMap((phase) => (phase.metrics ?? []).map((metric) => metric.label)),
    ]),
  ];
  const phases = resultPhases(result);
  const phaseMetrics = phases.map((phase) => metricsByLabel(phase));
  const latencyRows: BenchmarkLatencyRow[] = [];
  const scalarRows: BenchmarkScalarMetricRow[] = [];
  for (const label of metricLabels) {
    const metrics = phaseMetrics.map((metricsForPhase) => metricsForPhase.get(label));
    const unit = metrics.find((metric) => metric)?.unit ?? "";
    if (metrics.some(hasStatDetails)) {
      for (const [index, phase] of phases.entries()) {
        latencyRows.push(buildLatencyRow(result, phase, run, label, unit, metrics[index]));
      }
    } else {
      for (const [index, phase] of phases.entries()) {
        scalarRows.push(buildScalarMetricRow(result, phase, run, label, unit, metrics[index]));
      }
    }
  }
  return { latencyRows, scalarRows };
}

function buildLatencyRow(
  result: BenchmarkResult,
  phase: PhaseResult,
  run: string,
  label: string,
  unit: string,
  metric: BenchmarkMetric | undefined,
): BenchmarkLatencyRow {
  return {
    run,
    dataset: benchmarkDatasetLabel(result, phase),
    metric: label,
    value: formatMetricValue(metric),
    unit,
    runs: formatMetricDetail(metric, "runs"),
    min: formatMetricDetail(metric, "minMs"),
    median: formatMetricDetail(metric, "medianMs"),
    p95: formatMetricDetail(metric, "p95Ms"),
    max: formatMetricDetail(metric, "maxMs"),
  };
}

function buildScalarMetricRow(
  result: BenchmarkResult,
  phase: PhaseResult,
  run: string,
  label: string,
  unit: string,
  metric: BenchmarkMetric | undefined,
): BenchmarkScalarMetricRow {
  return {
    run,
    dataset: benchmarkDatasetLabel(result, phase),
    metric: label,
    value: formatMetricValue(metric),
    unit,
  };
}

function hasStatDetails(metric: BenchmarkMetric | undefined): boolean {
  if (!metric?.details) return false;
  return STAT_DETAIL_KEYS.some((key) => metric.details?.[key] !== undefined);
}

function formatMetricDetail(metric: BenchmarkMetric | undefined, key: string): string {
  const value = metric?.details?.[key];
  if (value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value).toString() : "";
  }
  return value;
}

function sectionTitle(result: BenchmarkResult): string {
  if (result.scenarioId === "startup-boot") return "Startup boot";
  if (result.scenarioId === "idle-memory") return "Idle memory";
  if (result.scenarioId === "calendar-window-scale") return "Calendar fixed-window scale memory";
  if (result.scenarioId === "calendar-nav") return "Calendar held navigation memory";
  if (result.scenarioId === "event-panel-open") return "Event panel latency";
  if (result.scenarioId === "calendar-create-cancel") return "Create panel latency";
  return result.scenarioLabel;
}

export function formatBenchmarkSuiteMarkdown(
  results: BenchmarkResult[],
  opts: BenchmarkOutputOptions = {},
): string {
  const preview = buildBenchmarkSuitePreview(results, opts);
  const lines: string[] = [];
  lines.push(`## Benchmark ${preview.metadata.run}`);
  lines.push("");
  appendRunMetadata(lines, preview.metadata);
  for (const section of preview.sections) {
    lines.push("");
    lines.push(`### ${section.title}`);
    lines.push("");
    if (section.kind === "startup") {
      appendStartupTable(lines, section.rows);
    } else if (section.kind === "memory") {
      appendMemoryTable(lines, section.rows);
      if (section.latencyRows.length > 0 || section.scalarRows.length > 0) {
        lines.push("");
        appendMetricTables(lines, section.latencyRows, section.scalarRows);
      }
    } else {
      appendMetricTables(lines, section.latencyRows, section.scalarRows);
    }
  }
  return lines.join("\n");
}

function appendRunMetadata(lines: string[], metadata: BenchmarkRunMetadataRow): void {
  lines.push("### Run metadata");
  lines.push("");
  lines.push("| Run | Harness | Build ref | Platform | Notes |");
  lines.push("|---|---|---|---|---|");
  lines.push(
    `| ${metadata.run} | ${metadata.harness} | ${metadata.buildRef} | ${metadata.platform} | ${metadata.notes} |`,
  );
}

function appendStartupTable(lines: string[], rows: BenchmarkStartupRow[]): void {
  lines.push("| Run | Dataset | Runs | First paint median ms | Usable paint median ms | Launch min ms | Launch P95 ms | Launch max ms | Launch median ms |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(
      `| ${row.run} | ${row.dataset} | ${row.runs} | ${row.firstPaintMedianMs} | ${row.usablePaintMedianMs} | ${row.launchMinMs} | ${row.launchP95Ms} | ${row.launchMaxMs} | ${row.launchMedianMs} |`,
    );
  }
}

function appendMemoryTable(lines: string[], rows: BenchmarkMemoryRow[]): void {
  lines.push("| Run | Dataset | Timepoint | Backend MB | Frontend MB | Network MB | Total MB |");
  lines.push("|---|---|---|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(
      `| ${row.run} | ${row.dataset} | ${row.timepoint} | ${row.backendMb} | ${row.frontendMb} | ${row.networkMb} | ${row.totalMb} |`,
    );
  }
}

function appendMetricTables(
  lines: string[],
  latencyRows: BenchmarkLatencyRow[],
  scalarRows: BenchmarkScalarMetricRow[],
): void {
  if (latencyRows.length === 0 && scalarRows.length === 0) {
    lines.push("No primary metrics were captured.");
    return;
  }
  if (latencyRows.length > 0) {
    appendLatencyTable(lines, latencyRows);
  }
  if (scalarRows.length > 0) {
    if (latencyRows.length > 0) lines.push("");
    appendScalarMetricTable(lines, scalarRows);
  }
}

function appendLatencyTable(lines: string[], rows: BenchmarkLatencyRow[]): void {
  lines.push("| Run | Dataset | Metric | Value | Unit | Runs | Min | Median | P95 | Max |");
  lines.push("|---|---|---|---:|---|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(
      `| ${row.run} | ${row.dataset} | ${row.metric} | ${row.value} | ${row.unit} | ${row.runs} | ${row.min} | ${row.median} | ${row.p95} | ${row.max} |`,
    );
  }
}

function appendScalarMetricTable(lines: string[], rows: BenchmarkScalarMetricRow[]): void {
  lines.push("| Run | Dataset | Metric | Value | Unit |");
  lines.push("|---|---|---|---:|---|");
  for (const row of rows) {
    lines.push(
      `| ${row.run} | ${row.dataset} | ${row.metric} | ${row.value} | ${row.unit} |`,
    );
  }
}

function runId(opts: BenchmarkOutputOptions): string {
  if (opts.run) return opts.run;
  return `${opts.date ?? today()}-ID`;
}

function formatHarness(version: string): string {
  if (!version) return "n/a";
  return version.startsWith("v") ? version : `v${version}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
