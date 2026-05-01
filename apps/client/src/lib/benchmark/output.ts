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
import type { BenchmarkResult, PhaseResult, SamplePoint, SampleLabel } from "./types";
import {
  SAMPLE_LABELS,
  STRESS_DURATION_MS,
  STRESS_PEAK_INTERVAL_MS,
  SAMPLE_OFFSETS_MS,
  formatOffsetProse,
} from "./types";

/**
 * Boot marks emitted in the order they appear in the markdown table. The
 * first row is the synthetic `launch-total` derived from
 * `get_startup_elapsed_ms`; the rest come from the perflog.
 */
const BOOT_MARK_ORDER: string[] = [
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
 * is the maximum across the burst samples; the other rows come from the
 * post-stress idle curve.
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
 * v2 caveat: with only `t0` and `+30s` in the curve, the "floor" is a
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

function formatBootRow(mark: string, a: PhaseResult, b: PhaseResult): string {
  const aVal = a.boot.marks[mark];
  const bVal = b.boot.marks[mark];
  const left = aVal === undefined ? "n/a" : Math.round(aVal).toString();
  const right = bVal === undefined ? "n/a" : Math.round(bVal).toString();
  // Strip "boot." prefix so the column reads as the conceptual mark name.
  const short = mark.startsWith("boot.") ? mark.slice(5) : mark;
  return `| ${pad(short, 17)} | ${pad(left, leftColWidth(a))} | ${pad(right, rightColWidth(b))} |`;
}

function formatLaunchRow(a: PhaseResult, b: PhaseResult): string {
  const left = a.startupMs === undefined ? "n/a" : Math.round(a.startupMs).toString();
  const right = b.startupMs === undefined ? "n/a" : Math.round(b.startupMs).toString();
  return `| ${pad("launch-total", 17)} | ${pad(left, leftColWidth(a))} | ${pad(right, rightColWidth(b))} |`;
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

function leftColLabel(p: PhaseResult): string {
  return `Phase A (${p.eventCountAtStart} events)`;
}

function rightColLabel(p: PhaseResult): string {
  return `Phase B (${p.eventCountAtStart} events)`;
}

function leftColWidth(p: PhaseResult): number {
  return Math.max(15, leftColLabel(p).length);
}

function rightColWidth(p: PhaseResult): number {
  return Math.max(20, rightColLabel(p).length);
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

  const aSamples = orderedSamples(result.phaseA);
  const bSamples = orderedSamples(result.phaseB);
  const floorA = findSettledFloor(result.phaseA);
  const floorB = findSettledFloor(result.phaseB);

  const aLabel = leftColLabel(result.phaseA);
  const bLabel = rightColLabel(result.phaseB);
  const aWidth = leftColWidth(result.phaseA);
  const bWidth = rightColWidth(result.phaseB);

  const lines: string[] = [];
  lines.push(`## Benchmark ${dateStr}${headerSuffix}`);
  lines.push("");
  lines.push(
    `Scenario: ${result.scenarioId}, dataset benchmark-synth-${result.synthVersion} (${result.phaseB.eventCountAtStart} events).`,
  );
  const offsetsClause = SAMPLE_OFFSETS_MS.length === 1
    ? `once at ${formatOffsetProse(SAMPLE_OFFSETS_MS[0])}`
    : `at ${SAMPLE_OFFSETS_MS.map(formatOffsetProse).join(", ")}`;
  lines.push(
    `Methodology: cold-cold against an isolated benchmark DB; ${STRESS_DURATION_MS} ms programmatic stress; sampled at ${STRESS_PEAK_INTERVAL_MS} ms during stress, then ${offsetsClause} post-stress.`,
  );
  lines.push("");
  lines.push("### Boot (ms from process start)");
  lines.push("");
  lines.push(`| ${pad("Mark", 17)} | ${pad(aLabel, aWidth)} | ${pad(bLabel, bWidth)} |`);
  lines.push(`|${"-".repeat(19)}|${"-".repeat(aWidth + 2)}|${"-".repeat(bWidth + 2)}|`);
  lines.push(formatLaunchRow(result.phaseA, result.phaseB));
  for (const mark of BOOT_MARK_ORDER) {
    lines.push(formatBootRow(mark, result.phaseA, result.phaseB));
  }
  lines.push("");
  lines.push("### Memory PSS, MB (backend / frontend / network / total)");
  lines.push("");
  const memWidth = Math.max(27, aLabel.length, bLabel.length);
  lines.push(`| ${pad("t", 5)} | ${pad(aLabel, memWidth)} | ${pad(bLabel, memWidth)} |`);
  lines.push(`|${"-".repeat(7)}|${"-".repeat(memWidth + 2)}|${"-".repeat(memWidth + 2)}|`);
  for (const label of SAMPLE_LABELS) {
    const left = formatSampleCell(aSamples.get(label));
    const right = formatSampleCell(bSamples.get(label));
    lines.push(`| ${pad(label, 5)} | ${pad(left, memWidth)} | ${pad(right, memWidth)} |`);
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
      : ` ${result.phaseB.eventCountAtStart}-event delta over empty: ${signed(floorDelta)} MB at floor, ${signed(peakDelta)} MB at peak.`;
    lines.push(
      `Settled floor: empty ${formatTotalMb(floorA.totalMb)} MB at ${floorA.label}, synth ${formatTotalMb(floorB.totalMb)} MB at ${floorB.label}.${peakStr}`,
    );
  }

  return lines.join("\n");
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
