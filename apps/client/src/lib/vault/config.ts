/**
 * Frontend bridge to the active Ganbaru AI folder's root `config.json`.
 *
 * Reads the file once at boot, keeps an in-memory cache, and flushes any
 * changes back to disk through a debounced write so a burst of edits
 * (dragging a color picker, typing in a name field) coalesces into one IO.
 *
 * Consumers go through `getConfigKey` / `setConfigKey` with dotted keys
 * (e.g. `"theme.activeId"`, `"preferences.fontScale"`). Dotted keys map to
 * nested objects on disk so the JSON stays human-readable and orthogonal
 * concerns (theme vs preferences vs themes.user) live under their own
 * branches.
 *
 * The Ganbaru AI folder path itself is owned by the Rust side (see
 * `src-tauri/src/vault.rs`). This module only knows how to read and write
 * the config payload and never talks to the filesystem directly.
 */

import { invoke } from "@tauri-apps/api/core";

type JsonObject = Record<string, unknown>;

const WRITE_DEBOUNCE_MS = 250;

const LEGACY_LOCALSTORAGE_MIGRATIONS: ReadonlyArray<{
  legacyKey: string;
  configKey: string;
  parse: (raw: string) => unknown;
}> = [
  { legacyKey: "ganbaru-ai-theme", configKey: "theme.activeId", parse: (s) => s },
  {
    legacyKey: "ganbaru-ai-font-family",
    configKey: "preferences.fontFamilyId",
    parse: (s) => s,
  },
  {
    legacyKey: "ganbaru-ai-font-scale",
    configKey: "preferences.fontScale",
    parse: (s) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : undefined;
    },
  },
];

let cache: JsonObject = {};
let loadPromise: Promise<void> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writeInflight: Promise<void> | null = null;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitKey(dotted: string): string[] {
  return dotted.split(".").filter((part) => part.length > 0);
}

function readPath(root: JsonObject, parts: readonly string[]): unknown {
  let current: unknown = root;
  for (const part of parts) {
    if (!isPlainObject(current)) return undefined;
    if (!Object.hasOwn(current, part)) return undefined;
    current = (current as JsonObject)[part];
  }
  return current;
}

function writePath(root: JsonObject, parts: readonly string[], value: unknown): void {
  if (parts.length === 0) return;
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = current[part];
    if (!isPlainObject(next)) {
      const fresh: JsonObject = {};
      current[part] = fresh;
      current = fresh;
    } else {
      current = next;
    }
  }
  current[parts[parts.length - 1]] = value;
}

function deletePath(root: JsonObject, parts: readonly string[]): void {
  if (parts.length === 0) return;
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = current[part];
    if (!isPlainObject(next)) return;
    current = next;
  }
  delete current[parts[parts.length - 1]];
}

async function fetchFromDisk(): Promise<JsonObject> {
  const raw = await invoke<string>("vault_read_config");
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch (err) {
    console.error("vault_read_config failed", err);
    return {};
  }
}

async function flushToDisk(): Promise<void> {
  const payload = JSON.stringify(cache, null, 2);
  try {
    await invoke("vault_write_config", { json: payload });
  } catch (err) {
    console.error("vault_write_config failed", err);
  }
}

function scheduleFlush(): void {
  if (writeTimer !== null) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeInflight = flushToDisk();
  }, WRITE_DEBOUNCE_MS);
}

function migrateFromLocalStorage(): boolean {
  if (typeof localStorage === "undefined") return false;
  let mutated = false;
  for (const { legacyKey, configKey, parse } of LEGACY_LOCALSTORAGE_MIGRATIONS) {
    const parts = splitKey(configKey);
    const existing = readPath(cache, parts);
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null && existing === undefined) {
      const value = parse(legacy);
      if (value !== undefined) {
        writePath(cache, parts, value);
        mutated = true;
      }
    }
    if (legacy !== null) {
      localStorage.removeItem(legacyKey);
    }
  }
  return mutated;
}

/**
 * Trigger the one-time config load. Idempotent: subsequent calls return the
 * same promise. Must complete before any consumer calls `getConfigKey`.
 */
export function ensureConfigLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    cache = await fetchFromDisk();
    if (migrateFromLocalStorage()) {
      await flushToDisk();
    }
  })();
  return loadPromise;
}

/**
 * Read a dotted-path config value. Returns `fallback` when the key is
 * missing or the stored value is the wrong shape (i.e. callers may pass a
 * runtime guard via the fallback's type).
 */
export function getConfigKey<T>(key: string, fallback: T): T {
  const parts = splitKey(key);
  const found = readPath(cache, parts);
  return found === undefined ? fallback : (found as T);
}

/**
 * Update a dotted-path config value and schedule a debounced disk write.
 * Pass `undefined` to remove the key.
 */
export function setConfigKey(key: string, value: unknown): void {
  const parts = splitKey(key);
  if (parts.length === 0) return;
  if (value === undefined) {
    deletePath(cache, parts);
  } else {
    writePath(cache, parts, value);
  }
  scheduleFlush();
}

/**
 * Resolve once any pending debounced write has flushed. Useful in tests
 * and in shutdown handlers; product code can rely on the debounced write.
 */
export async function flushConfig(): Promise<void> {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
    writeInflight = flushToDisk();
  }
  if (writeInflight) await writeInflight;
}
