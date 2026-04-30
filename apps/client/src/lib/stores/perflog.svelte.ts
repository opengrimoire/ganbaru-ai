/**
 * Production diagnostic ring buffer for performance instrumentation.
 *
 * Always-on, capped, in-memory log of timing marks. The performance panel
 * reads `entries` reactively and renders the most recent slice; the copy
 * button serializes the buffer to clipboard so users on a release `.deb`
 * (where DevTools is disabled) can capture traces without a terminal.
 *
 * Marks are timestamps plus an optional small `detail` map. No event
 * content, titles, or PII is recorded.
 */

const MAX_ENTRIES = 500;

/**
 * One timing mark in the ring buffer.
 *
 * @property t Timestamp from `performance.now()` rounded to 0.1 ms.
 * @property tag Short identifier (e.g. `"boot.sql-main-done"`, `"nav.start"`).
 * @property detail Optional small map of scalar context. Keep keys short.
 */
export type PerfLogEntry = {
  t: number;
  tag: string;
  detail?: Record<string, string | number>;
};

/**
 * Reactive ring buffer of perf log entries. Bound to `$state` so the panel
 * re-renders when new marks land. Always treated as append-only externally;
 * use `clear()` to reset.
 */
export const perfLog = $state<{ entries: PerfLogEntry[] }>({ entries: [] });

/**
 * Append a mark to the buffer. Drops the oldest entry when the buffer is
 * full. Called on hot paths (boot, navigation, view switch); cost is a
 * single timestamp plus an array push.
 *
 * @param tag Short identifier of the event.
 * @param detail Optional small map of scalar context (event counts, view
 *   names, etc.). Do not pass user-visible strings or PII.
 */
export function mark(tag: string, detail?: Record<string, string | number>): void {
  const t = Math.round(performance.now() * 10) / 10;
  const entry: PerfLogEntry = detail ? { t, tag, detail } : { t, tag };
  if (perfLog.entries.length >= MAX_ENTRIES) {
    perfLog.entries.shift();
  }
  perfLog.entries.push(entry);
}

/**
 * Returns a read-only frozen view of the current buffer for serialization
 * (copy-to-clipboard). The panel itself reads `perfLog.entries` directly
 * for reactivity; this helper exists for non-reactive consumers.
 */
export function snapshot(): readonly PerfLogEntry[] {
  return Object.freeze(perfLog.entries.slice());
}

/**
 * Empty the buffer. Used by the perf panel's "Clear" button before a new
 * trace capture so the user copies only the relevant scenario.
 */
export function clear(): void {
  perfLog.entries.length = 0;
}

/**
 * Format a single entry as `+<delta>ms | <tag> | <detail>`. The delta is
 * relative to the first entry in the provided array (so a copied trace is
 * readable without knowing absolute boot time).
 *
 * @param entry The entry to format.
 * @param baseT The timestamp to subtract for the delta column.
 */
export function formatEntry(entry: PerfLogEntry, baseT: number): string {
  const delta = (entry.t - baseT).toFixed(1);
  const head = `+${delta}ms | ${entry.tag}`;
  if (!entry.detail) return head;
  const detail = Object.entries(entry.detail)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `${head} | ${detail}`;
}
