/**
 * Memory + boot-mark sampling for the benchmark harness.
 *
 * Wraps `get_memory_report` (Tauri command in `lib.rs`) and the
 * `lib/stores/perflog.svelte.ts` ring buffer. Scenarios never call this
 * directly: the runner orchestrates peak sampling around `runWorkload` and
 * the idle-curve schedule afterwards.
 *
 * Cadence (`STRESS_PEAK_INTERVAL_MS`, `SAMPLE_OFFSETS_MS`) is pinned in
 * `types.ts` so historical PERFORMANCE.md rows stay comparable.
 */
import { invoke } from "@tauri-apps/api/core";
import { perfLog, snapshot as perfSnapshot, type PerfLogEntry } from "$lib/stores/perflog.svelte";
import { categorizeMemoryProcessName } from "$lib/components/perf/memoryReport";
import type { BootTimings, SampleLabel, SamplePoint } from "./types";
import { STRESS_PEAK_INTERVAL_MS, SAMPLE_OFFSETS_MS, formatOffsetLabel } from "./types";

interface MemoryReportProcess {
  name: string;
  mb: number;
}

interface MemoryReport {
  processes: MemoryReportProcess[];
  total_mb: number;
  platform: string;
}

/**
 * Read one memory snapshot from the backend. Maps the Rust report into the
 * `SamplePoint` shape (backend / frontend / network split). Process names
 * come from `lib.rs`, while category mapping is shared with the live
 * performance panel so both surfaces agree.
 */
export async function readMemorySample(
  label: SampleLabel,
  tMs: number,
): Promise<SamplePoint> {
  const report = await invoke<MemoryReport>("get_memory_report");
  let backend = 0;
  let frontend = 0;
  let network = 0;
  for (const p of report.processes) {
    const category = categorizeMemoryProcessName(p.name);
    if (category === "Backend") backend += p.mb;
    else if (category === "Network") network += p.mb;
    else frontend += p.mb;
  }
  return {
    label,
    tMs,
    totalMb: report.total_mb,
    backendMb: backend,
    frontendMb: frontend,
    networkMb: network,
  };
}

/**
 * Periodically sample memory at `STRESS_PEAK_INTERVAL_MS` cadence. Returns
 * a stop function that flushes any in-flight read, clears the timer, and
 * resolves with the captured samples. The runner calls this around
 * `runWorkload` so the peak buffer covers exactly the workload window.
 */
export function startPeakSampler(): { stop: () => Promise<SamplePoint[]> } {
  const samples: SamplePoint[] = [];
  let stopped = false;
  let failedSamples = 0;
  let lastError: unknown;
  const startedAt = performance.now();
  const inFlight: Promise<void>[] = [];

  function tick() {
    if (stopped) return;
    const tMs = performance.now() - startedAt;
    inFlight.push(
      readMemorySample("peak", tMs).then((s) => {
        samples.push(s);
      }).catch((error: unknown) => {
        failedSamples++;
        lastError = error;
      }),
    );
  }

  const intervalId = setInterval(tick, STRESS_PEAK_INTERVAL_MS);
  // Fire one immediately so the burst is not biased by the interval phase.
  tick();

  return {
    async stop(): Promise<SamplePoint[]> {
      stopped = true;
      clearInterval(intervalId);
      await Promise.all(inFlight);
      if (samples.length === 0) {
        const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
        throw new Error(`Peak memory sampling failed after ${failedSamples} attempt(s)${detail}`);
      }
      return samples;
    },
  };
}

/**
 * Run the post-stress idle-curve schedule. Each entry in `SAMPLE_OFFSETS_MS`
 * gets one reading; the resulting array is in chronological order. Aborts
 * cleanly via `signal`: pending timers are cleared and the promise resolves
 * with whatever samples were captured so far.
 */
export function sampleIdleCurve(opts: {
  signal: AbortSignal;
  onProgress?: (label: SampleLabel, samples: SamplePoint[]) => void;
}): Promise<SamplePoint[]> {
  return new Promise((resolve) => {
    const samples: SamplePoint[] = [];
    const startedAt = performance.now();
    let i = 0;

    function scheduleNext() {
      if (opts.signal.aborted || i >= SAMPLE_OFFSETS_MS.length) {
        resolve(samples);
        return;
      }
      const targetMs = SAMPLE_OFFSETS_MS[i];
      const elapsed = performance.now() - startedAt;
      const wait = Math.max(0, targetMs - elapsed);
      const timer = setTimeout(async () => {
        if (opts.signal.aborted) {
          resolve(samples);
          return;
        }
        const label = formatOffsetLabel(targetMs);
        try {
          const s = await readMemorySample(label, targetMs);
          if (!opts.signal.aborted) {
            samples.push(s);
            opts.onProgress?.(label, samples);
          }
        } catch {
          // Swallow; an empty cell is fine in the markdown.
        }
        i++;
        scheduleNext();
      }, wait);
      opts.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve(samples);
      }, { once: true });
    }

    scheduleNext();
  });
}

/**
 * Tags the harness lifts out of the perflog ring buffer.
 *
 * The harness omits `boot.sql-children-done` and `boot.rawblocks-set`
 * because both are intermediate implementation marks. `boot.usable-paint`
 * is the startup target: the calendar has loaded data and rendered a frame.
 */
const BOOT_MARKS_OF_INTEREST = new Set<string>([
  "boot.script-start",
  "boot.app-mount",
  "boot.tz-hydrated",
  "boot.sql-start",
  "boot.sql-main-done",
  "boot.maprow-done",
  "boot.first-paint",
  "boot.usable-paint",
]);

/**
 * Lift the boot marks from the perflog snapshot, expressed as ms relative
 * to `boot.script-start` (the first mark fired in `App.svelte`). If
 * `boot.script-start` is missing (very rare), falls back to the first mark
 * in the buffer so deltas stay consistent within the run.
 */
export function captureBootTimings(): BootTimings {
  const entries = perfSnapshot();
  const baseT = findBaseT(entries);
  const marks: Record<string, number> = {};
  let firstPaintT: number | undefined;
  let usablePaintT: number | undefined;
  for (const e of entries) {
    if (BOOT_MARKS_OF_INTEREST.has(e.tag)) {
      // First write wins so a re-emitted mark does not overwrite the boot value.
      if (!(e.tag in marks)) {
        marks[e.tag] = Math.max(0, e.t - baseT);
      }
      if (e.tag === "boot.first-paint" && firstPaintT === undefined) {
        firstPaintT = e.t;
      }
      if (e.tag === "boot.usable-paint" && usablePaintT === undefined) {
        usablePaintT = e.t;
      }
    }
  }
  const launchTargetT = usablePaintT ?? firstPaintT;
  const launchTotalMs = launchTargetT === undefined || perfLog.shellStartupMs === null
    ? undefined
    : Math.max(0, perfLog.shellStartupMs + launchTargetT - baseT);
  return launchTotalMs === undefined ? { marks } : { marks, launchTotalMs };
}

function findBaseT(entries: readonly PerfLogEntry[]): number {
  for (const e of entries) {
    if (e.tag === "boot.script-start") return e.t;
  }
  return entries[0]?.t ?? 0;
}
