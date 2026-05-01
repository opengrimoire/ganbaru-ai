import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

/**
 * Connection string for the active database. Resolved exactly once on the
 * first call to `getDb()` and cached for the rest of the process lifetime.
 *
 * The resolution checks the persisted benchmark state file: if a harness
 * run is in flight with `vaultMode === "benchmark"`, the URL points at the
 * isolated `ganbaruai-benchmark.db` so the user's real DB is never opened.
 * Otherwise it returns the dev or release user-DB filename.
 */
let cachedUrl: string | null = null;

function defaultUserUrl(): string {
  return import.meta.env.DEV ? "sqlite:ganbaruai-dev.db" : "sqlite:ganbaruai.db";
}

/** Minimal shape needed for the URL decision. The full state lives in `benchmark/types.ts`. */
interface VaultModeProbe {
  vaultMode?: "user" | "benchmark";
}

async function resolveUrl(): Promise<string> {
  try {
    const json = await invoke<string | null>("read_benchmark_state");
    if (json) {
      const parsed = JSON.parse(json) as VaultModeProbe;
      if (parsed?.vaultMode === "benchmark") {
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

export async function execute(
  query: string,
  bindValues?: unknown[],
): Promise<{ rowsAffected: number; lastInsertId: number }> {
  const database = await getDb();
  const result = await database.execute(query, bindValues);
  return { rowsAffected: result.rowsAffected, lastInsertId: result.lastInsertId ?? 0 };
}

export async function select<T>(
  query: string,
  bindValues?: unknown[],
): Promise<T[]> {
  const database = await getDb();
  return database.select<T[]>(query, bindValues);
}
