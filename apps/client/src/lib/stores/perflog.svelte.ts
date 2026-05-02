/**
 * Diagnostic ring buffer for performance instrumentation.
 *
 * Capped, in-memory log of timing marks. The performance panel reads
 * `entries` reactively and renders the most recent slice; the copy button
 * serializes the buffer to clipboard so users on a release `.deb` (where
 * DevTools is disabled) can capture traces without a terminal.
 *
 * Boot marks (tags starting with `boot.`) are always recorded so the
 * benchmark harness can extract them regardless of the user's preference.
 * Every other mark is gated behind the `tracking` flag, which the user
 * toggles from the perf popup. The flag is session-local and resets to
 * off on every launch, so normal use never accumulates `nav.*` / `view.*`
 * / `col.*` events in the background.
 *
 * Marks are timestamps plus an optional small `detail` map. No event
 * content, titles, or PII is recorded.
 */

const MAX_ENTRIES = 100;

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
 * Reactive ring buffer of perf log entries plus the in-memory tracking
 * flag. Bound to `$state` so the panel re-renders when either changes.
 * Always treated as append-only externally; use `clear()` to reset.
 * `tracking` resets to `false` on every page load by design.
 */
export const perfLog = $state<{ entries: PerfLogEntry[]; tracking: boolean }>({
  entries: [],
  tracking: false,
});

/**
 * Flip interaction tracking on or off for the current session. Boot marks
 * are unaffected. The flag is intentionally not persisted; reopening the
 * app always starts with tracking off so a forgotten toggle never bloats
 * the buffer in production.
 */
export function setTracking(on: boolean): void {
  perfLog.tracking = on;
}

/**
 * Append a mark to the buffer. Drops the oldest entry when the buffer is
 * full. Called on hot paths (boot, navigation, view switch); cost is a
 * single timestamp plus an array push.
 *
 * Tags starting with `boot.` are always recorded. Every other tag requires
 * `tracking` to be on, otherwise this is a no-op.
 *
 * @param tag Short identifier of the event.
 * @param detail Optional small map of scalar context (event counts, view
 *   names, etc.). Do not pass user-visible strings or PII.
 */
export function mark(tag: string, detail?: Record<string, string | number>): void {
  if (!tag.startsWith("boot.") && !perfLog.tracking) return;
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
