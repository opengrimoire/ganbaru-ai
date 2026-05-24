import { invoke } from "@tauri-apps/api/core";
import { dbUrl, ensureDbUrl } from "$lib/api/db";
import { type BenchmarkMetric } from "../types";
import { timingStatsMetric } from "./calendar-utils";

export const DEFAULT_OPERATION_RUNS = 8;

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
}

export async function ensureBenchmarkDbReady(): Promise<void> {
  await ensureDbUrl();
}

export async function invokeDb<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return invoke<T>(command, { dbUrl: dbUrl(), ...args });
}

export async function measureMs(operation: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

export async function repeatedTimingMetric(
  label: string,
  runs: number,
  signal: AbortSignal,
  operation: (index: number) => Promise<void>,
  details: Record<string, string | number> = {},
): Promise<BenchmarkMetric> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    throwIfAborted(signal);
    samples.push(await measureMs(() => operation(i)));
  }
  return timingStatsMetric(label, samples, details);
}

export async function repeatedMeasuredTimingMetric(
  label: string,
  runs: number,
  signal: AbortSignal,
  sample: (index: number) => Promise<number>,
  details: Record<string, string | number> = {},
): Promise<BenchmarkMetric> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    throwIfAborted(signal);
    samples.push(await sample(i));
  }
  return timingStatsMetric(label, samples, details);
}

export function scalarMsMetric(label: string, value: number): BenchmarkMetric {
  return {
    label,
    unit: "ms",
    value,
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoMinutesFromAnchor(minutes: number): string {
  const base = Date.UTC(2026, 3, 30, 8, 0, 0);
  return new Date(base + minutes * 60_000).toISOString();
}
