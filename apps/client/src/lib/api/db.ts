import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { HARNESS_VERSION, STATE_TTL_MS, SYNTH_VERSION } from "$lib/benchmark/types";

/**
 * Connection string for the active database. Resolved exactly once on the
 * first call to `getDb()` and cached for the rest of the process lifetime.
 *
 * The resolution checks the persisted benchmark state file: only fresh
 * `*-pending` states route to the isolated `ganbaruai-benchmark.db`.
 * Interrupted `*-running` states fall back to the user DB and are cleaned
 * up by the benchmark runner after boot.
 */
let cachedUrl: string | null = null;

function defaultUserUrl(): string {
  return import.meta.env.DEV ? "sqlite:ganbaruai-dev.db" : "sqlite:ganbaruai.db";
}

/** Minimal shape needed for the URL decision. The full state lives in `benchmark/types.ts`. */
interface VaultModeProbe {
  vaultMode?: "user" | "benchmark";
  stage?: string;
  harnessVersion?: string;
  synthVersion?: string;
  startedAt?: string;
}

async function resolveUrl(): Promise<string> {
  try {
    const json = await invoke<string | null>("read_benchmark_state");
    if (json) {
      const parsed = JSON.parse(json) as VaultModeProbe;
      const ageMs = Date.now() - new Date(parsed.startedAt ?? "").getTime();
      const validVersion = parsed?.harnessVersion === HARNESS_VERSION
        && parsed?.synthVersion === SYNTH_VERSION;
      const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= STATE_TTL_MS;
      const benchmarkPending = parsed?.stage === "phase-a-pending"
        || parsed?.stage === "phase-b-pending";
      if (parsed?.vaultMode === "benchmark" && benchmarkPending && validVersion && fresh) {
        return "sqlite:ganbaruai-benchmark.db";
      }
    }
  } catch (e) {
    console.error("dbUrl: failed to probe benchmark state, falling back to user DB", e);
  }
  return defaultUserUrl();
}

/**
 * Returns the resolved DB URL. Throws if called before `getDb()` has been
 * awaited at least once. Both existing call sites (this module's own
 * `getDb` and `calendar.svelte.ts:bulkImport`) run after `getDb()` is in
 * flight, so the throw is a guard against accidental misuse.
 */
export function dbUrl(): string {
  if (cachedUrl === null) {
    throw new Error("dbUrl() called before getDb()");
  }
  return cachedUrl;
}

let dbPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const url = await resolveUrl();
      cachedUrl = url;
      return Database.load(url);
    })();
    dbPromise.catch(() => {
      dbPromise = null;
      cachedUrl = null;
    });
  }
  return dbPromise;
}

export async function select<T>(
  query: string,
  bindValues?: unknown[],
): Promise<T[]> {
  const database = await getDb();
  return database.select<T[]>(query, bindValues);
}
