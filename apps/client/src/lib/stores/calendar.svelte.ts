import { invoke } from "@tauri-apps/api/core";
import { Temporal } from "@js-temporal/polyfill";
import { dbUrl, ensureDbUrl } from "$lib/api/db";
import type {
  Calendar, CalendarEvent, CalendarViewMode,
} from "$lib/components/calendar/types";
import type {
  CalendarDeleteArchiveOperation,
} from "$lib/components/calendar/delete-archive-plan";
import type { RecurringCommitPlan } from "$lib/components/calendar/recurrence-edit-plan";
import { occurrenceOnDate } from "$lib/components/calendar/recurrence-commit-helpers";
import { expandRecurring, parseYMD, fmtYMD } from "$lib/components/calendar/recurrence";
import {
  buildExpansionIndex,
  eventsInWindowFromIndex,
  type ExpansionIndex,
} from "$lib/components/calendar/calendar-index";
import { computeViewWindow, wallClockToUtcIso } from "$lib/components/calendar/utils";
import {
  hasStructuralChanges as eventHasStructuralChanges,
  localTimezone,
  prepareUpdateBlockPayload,
} from "./calendar-event-payloads";
import {
  mapWindowRows,
  type CalendarWindowRows,
} from "./calendar-event-hydration";
import {
  buildCalendarEventMutationTarget,
  buildCalendarEventMutationTargetFromId,
  type CalendarEventMutationTarget,
} from "./calendar-mutations";
import { adjacentCalendarWindowRequests, calendarWindowCovers } from "./calendar-window-prefetch";
import {
  BoundedWindowCache,
  LatestWindowLoadCoordinator,
  type WindowLoadEvent,
  type WindowLoadOutcome,
} from "./window-load-coordinator";
import type { IcsImportSummary } from "$lib/calendar/ics/types";
import { mark as perfMark } from "$lib/stores/perflog.svelte";
import { getPreferences } from "$lib/stores/preferences.svelte";
import {
  initCalendarWindowSync,
  publishCalendarWindowSync,
} from "./calendar-window-sync";
import { applyCalendarRecurrenceCommitPlan } from "./calendar-recurrence-commit";
import {
  addCalendarBlock,
  addCalendarException,
  detachCalendarInstance,
  setCalendarRepeatUntil,
  splitCalendarSeries,
  type CalendarAddBlockOptions,
} from "./calendar-event-operations";
import {
  bulkImportCalendarEvents,
  exportCalendarAsIcs as exportCalendarIcs,
  type CalendarBulkImportOptions,
} from "./calendar-import-export";
import {
  clearPanelEventCache,
  deletePanelEventCacheEntry,
  loadFullEvent,
  loadPanelEvent,
  prefetchPanelEvent,
} from "./calendar-event-loaders";
import { removeCalendarMutationTarget } from "./calendar-block-state";
import { loadPomodoroSchedulerEventsFromDb } from "./calendar-pomodoro-window";

export { expandRecurring, parseYMD, fmtYMD };

/** DB-backed template events for the current render window plus recurring templates. */
let rawBlocks = $state<CalendarEvent[]>([]);
let windowEvents = $state<CalendarEvent[]>([]);
let loaded = $state(false);
let totalEventCount = $state(0);
let currentWindowKey: string | null = null;
let currentWindowRenderZone: string | null = null;
let currentWindowStart: Temporal.PlainDate | null = null;
let currentWindowEnd: Temporal.PlainDate | null = null;
let batchDepth = 0;
const WINDOW_CACHE_LIMIT = 12;

type CalendarWindowLoadMode = "apply" | "ensure" | "prefetch";

interface CalendarWindowSnapshot {
  key: string;
  renderZone: string;
  windowStart: Temporal.PlainDate;
  windowEnd: Temporal.PlainDate;
  rawBlocks: CalendarEvent[];
  windowEvents: CalendarEvent[];
  expansionIndex: ExpansionIndex;
  totalEventCount: number;
}

interface CalendarWindowLoadRequest {
  key: string;
  renderZone: string;
  windowStart: Temporal.PlainDate;
  windowEnd: Temporal.PlainDate;
  markBoot: boolean;
  force: boolean;
  mode: CalendarWindowLoadMode;
}

const windowCache = new BoundedWindowCache<CalendarWindowSnapshot>(WINDOW_CACHE_LIMIT);
let prefetchGeneration = 0;
let foregroundWindowBusy = false;
let foregroundWindowRequestId = 0;
let foregroundWindowIdleWaiters: Array<() => void> = [];

/**
 * Sorted lookup over the current render-window rows, rebuilt lazily after
 * each invalidate. The non-recurring events are sorted ascending by start so window queries can
 * bisect-and-walk in `O(log N + K)` instead of scanning every template.
 * Recurring templates stay in a small list and are walked exhaustively per
 * query. Until recurrence moves to Rust, the window command includes
 * recurring templates so TypeScript can preserve existing expansion behavior.
 */
let expansionIndex: ExpansionIndex | null = null;

/**
 * Reactivity token. `eventsInWindow` reads it so any `$derived` / `$effect`
 * that depends on the visible-event set re-runs after a mutation. Bumped
 * from `invalidate()`. External callers that need to react to mutations
 * without forcing an expansion subscribe via `void indexVersion`.
 */
let indexVersion = $state(0);

/**
 * Drop the cached index and bump the reactivity token so any
 * `$derived` / `$effect` reading `eventsInWindow` re-runs. The next read
 * rebuilds the index lazily; mutations are rare relative to reads so
 * eager rebuild would just waste work.
 */
function invalidate(recomputeWindow = true, clearCachedWindows = true) {
  if (batchDepth > 0) return;
  expansionIndex = null;
  if (clearCachedWindows) clearWindowCache();
  if (recomputeWindow && currentWindowStart && currentWindowEnd) {
    expansionIndex = buildExpansionIndex(rawBlocks);
    windowEvents = eventsInWindowFromIndex(expansionIndex, currentWindowStart, currentWindowEnd);
  }
  clearPanelEventCache();
  indexVersion++;
}


function getIndex(): ExpansionIndex {
  if (!expansionIndex) expansionIndex = buildExpansionIndex(rawBlocks);
  return expansionIndex;
}

/**
 * Resolve an event to its DB-backed template.
 * For recurring instances returns the parent; for normal events returns itself.
 */
function resolveToTemplate(event: CalendarEvent): CalendarEvent | undefined {
  const parentId = event.recurringParentId ?? event.id;
  return rawBlocks.find((b) => b.id === parentId);
}

function mutationTargetForEvent(eventOrId: CalendarEvent | string): CalendarEventMutationTarget {
  if (typeof eventOrId === "string") {
    return buildCalendarEventMutationTargetFromId(eventOrId);
  }
  return buildCalendarEventMutationTarget(eventOrId, resolveToTemplate(eventOrId));
}

/**
 * Load slim per-instance overrides in one unfiltered query and group by
 * parent id. Heavy override columns (description, location, url,
 * extended_properties, visibility) stay in the DB and ride along with the
 * parent through the panel / full-event loaders when EventPanel, delete undo,
 * or ICS export needs them.
 */

function calendarWindowKey(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
  renderZone: string,
): string {
  return `${renderZone}:${windowStart.toString()}:${windowEnd.toString()}`;
}

function currentWindowCovers(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
  renderZone: string,
): boolean {
  return loaded
    && currentWindowStart !== null
    && currentWindowEnd !== null
    && currentWindowRenderZone === renderZone
    && calendarWindowCovers(currentWindowStart, currentWindowEnd, windowStart, windowEnd);
}

function findCachedWindowCovering(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
  renderZone: string,
): CalendarWindowSnapshot | undefined {
  return windowCache.find((snapshot) =>
    snapshot.renderZone === renderZone
    && calendarWindowCovers(snapshot.windowStart, snapshot.windowEnd, windowStart, windowEnd)
  );
}

function windowQueueKey(mode: CalendarWindowLoadMode, key: string): string {
  return `${mode}:${key}`;
}

function markWindowLoadEvent(event: WindowLoadEvent<CalendarWindowLoadRequest>): void {
  const request = "request" in event ? event.request : undefined;
  if (event.type === "start") {
    perfMark("window.load-start", {
      mode: request?.mode ?? "unknown",
      queued: windowLoadCoordinator.queuedKey ? 1 : 0,
    });
  } else if (event.type === "queue") {
    perfMark("window.load-queued", {
      mode: request?.mode ?? "unknown",
      replaced: event.replacedKey ? 1 : 0,
    });
  } else if (event.type === "drop") {
    perfMark("window.load-dropped", { reason: event.reason });
  } else if (event.type === "finish") {
    perfMark("window.load-finished", { outcome: event.outcome });
  } else {
    perfMark("window.load-error");
  }
}

function applyWindowSnapshot(snapshot: CalendarWindowSnapshot): void {
  rawBlocks = snapshot.rawBlocks;
  windowEvents = snapshot.windowEvents;
  expansionIndex = snapshot.expansionIndex;
  totalEventCount = snapshot.totalEventCount;
  currentWindowKey = snapshot.key;
  currentWindowRenderZone = snapshot.renderZone;
  currentWindowStart = snapshot.windowStart;
  currentWindowEnd = snapshot.windowEnd;
  loaded = true;
  clearPanelEventCache();
  indexVersion++;
  perfMark("window.applied", {
    rows: snapshot.rawBlocks.length,
    expanded: snapshot.windowEvents.length,
    cache: windowCache.size,
  });
}

function rememberWindowSnapshot(snapshot: CalendarWindowSnapshot): void {
  windowCache.set(snapshot.key, snapshot);
  perfMark("window.cache-put", {
    rows: snapshot.rawBlocks.length,
    expanded: snapshot.windowEvents.length,
    size: windowCache.size,
  });
}

function beginForegroundWindowLoad(): number {
  foregroundWindowBusy = true;
  return ++foregroundWindowRequestId;
}

function finishForegroundWindowLoad(requestId: number): void {
  if (requestId !== foregroundWindowRequestId) return;
  foregroundWindowBusy = false;
  resolveForegroundWindowIdle();
}

function resolveForegroundWindowIdle(): void {
  if (foregroundWindowBusy) return;
  const waiters = foregroundWindowIdleWaiters;
  foregroundWindowIdleWaiters = [];
  for (const resolve of waiters) resolve();
}

async function waitForForegroundWindowIdle(): Promise<void> {
  if (!foregroundWindowBusy) return;
  await new Promise<void>((resolve) => {
    foregroundWindowIdleWaiters.push(resolve);
  });
}

function adjacentWindowRequests(snapshot: CalendarWindowSnapshot): Array<{
  start: Temporal.PlainDate;
  end: Temporal.PlainDate;
}> {
  return adjacentCalendarWindowRequests(snapshot.windowStart, snapshot.windowEnd);
}


async function runWindowLoadRequest(
  request: CalendarWindowLoadRequest,
  isSuperseded: () => boolean,
): Promise<WindowLoadOutcome> {
  const {
    key,
    renderZone,
    windowStart,
    windowEnd,
    markBoot,
    force,
    mode,
  } = request;
  const url = await ensureDbUrl();
  const windowStartDate = windowStart.toString();
  const windowEndDate = windowEnd.toString();
  if (!force && !markBoot && mode !== "apply") {
    const cached = findCachedWindowCovering(windowStart, windowEnd, renderZone);
    if (cached || currentWindowCovers(windowStart, windowEnd, renderZone)) {
      perfMark("window.load-covered", { mode });
      return "applied";
    }
  }
  const windowEndExclusiveDate = windowEnd.add({ days: 1 }).toString();
  const rows = await invoke<CalendarWindowRows>("calendar_load_window", {
    dbUrl: url,
    windowStartDate,
    windowEndDate,
    windowStartUtc: wallClockToUtcIso(`${windowStartDate} 00:00`, renderZone),
    windowEndExclusiveUtc: wallClockToUtcIso(`${windowEndExclusiveDate} 00:00`, renderZone),
  });
  perfMark("window.rows-done", {
    mode,
    rows: rows.events.length,
    attendees: rows.attendees.length,
    total: rows.total_event_count,
  });

  if (!markBoot && isSuperseded()) {
    perfMark("window.load-superseded", { stage: "rows", mode });
    return "superseded";
  }

  if (markBoot) perfMark("boot.sql-main-done", { rows: rows.events.length, total: rows.total_event_count });
  const mapped = mapWindowRows(rows, renderZone);
  if (markBoot) perfMark("boot.maprow-done");

  if (!markBoot && isSuperseded()) {
    perfMark("window.load-superseded", { stage: "map", mode });
    return "superseded";
  }

  const expanded = await invoke<CalendarEvent[]>("calendar_expand_render_events", {
    events: mapped,
    windowStartDate,
    windowEndDate,
  });
  perfMark("window.expand-done", {
    mode,
    rows: mapped.length,
    expanded: expanded.length,
  });

  if (!markBoot && isSuperseded()) {
    perfMark("window.load-superseded", { stage: "expand", mode });
    return "superseded";
  }

  const snapshot: CalendarWindowSnapshot = {
    key,
    renderZone,
    windowStart,
    windowEnd,
    rawBlocks: mapped,
    windowEvents: expanded,
    expansionIndex: buildExpansionIndex(mapped),
    totalEventCount: rows.total_event_count,
  };
  rememberWindowSnapshot(snapshot);

  if (mode === "apply") {
    applyWindowSnapshot(snapshot);
    if (markBoot) {
      perfMark("boot.sql-children-done");
      perfMark("boot.rawblocks-set", { events: rawBlocks.length, total: totalEventCount });
    }
    scheduleAdjacentPrefetch(snapshot);
  }

  return "applied";
}

const windowLoadCoordinator = new LatestWindowLoadCoordinator<CalendarWindowLoadRequest>(
  runWindowLoadRequest,
  markWindowLoadEvent,
);

async function loadWindowIntoState(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
  markBoot: boolean,
  force = false,
): Promise<void> {
  const renderZone = localTimezone();
  const key = calendarWindowKey(windowStart, windowEnd, renderZone);
  if (!force && !markBoot && loaded && currentWindowKey === key) return;
  if (!force && !markBoot && currentWindowCovers(windowStart, windowEnd, renderZone)) return;
  if (!force && !markBoot) {
    const cached = windowCache.get(key) ?? findCachedWindowCovering(windowStart, windowEnd, renderZone);
    if (cached) {
      const foregroundId = ++foregroundWindowRequestId;
      foregroundWindowBusy = false;
      resolveForegroundWindowIdle();
      prefetchGeneration++;
      windowLoadCoordinator.supersedePending();
      perfMark("window.cache-hit", {
        rows: cached.rawBlocks.length,
        expanded: cached.windowEvents.length,
        size: windowCache.size,
      });
      applyWindowSnapshot(cached);
      scheduleAdjacentPrefetch(cached);
      finishForegroundWindowLoad(foregroundId);
      return;
    }
  }

  prefetchGeneration++;
  const foregroundId = beginForegroundWindowLoad();
  try {
    await windowLoadCoordinator.enqueue(windowQueueKey("apply", key), {
      key,
      renderZone,
      windowStart,
      windowEnd,
      markBoot,
      force,
      mode: "apply",
    });
  } finally {
    finishForegroundWindowLoad(foregroundId);
  }
}

async function prefetchWindow(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
  generation: number,
): Promise<void> {
  if (generation !== prefetchGeneration || !loaded) return;
  const renderZone = localTimezone();
  const key = calendarWindowKey(windowStart, windowEnd, renderZone);
  if (currentWindowCovers(windowStart, windowEnd, renderZone)
    || findCachedWindowCovering(windowStart, windowEnd, renderZone)) return;

  await windowLoadCoordinator.enqueue(windowQueueKey("prefetch", key), {
    key,
    renderZone,
    windowStart,
    windowEnd,
    markBoot: false,
    force: false,
    mode: "prefetch",
  });
}

async function ensureWindowSnapshotReady(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
): Promise<void> {
  const renderZone = localTimezone();
  const key = calendarWindowKey(windowStart, windowEnd, renderZone);
  if (currentWindowCovers(windowStart, windowEnd, renderZone)
    || findCachedWindowCovering(windowStart, windowEnd, renderZone)) return;

  prefetchGeneration++;
  const foregroundId = beginForegroundWindowLoad();
  try {
    await windowLoadCoordinator.enqueue(windowQueueKey("ensure", key), {
      key,
      renderZone,
      windowStart,
      windowEnd,
      markBoot: false,
      force: false,
      mode: "ensure",
    });
  } finally {
    finishForegroundWindowLoad(foregroundId);
  }
}

function scheduleAdjacentPrefetch(snapshot: CalendarWindowSnapshot): void {
  const requests = adjacentWindowRequests(snapshot);
  if (requests.length === 0) return;
  const generation = ++prefetchGeneration;

  void (async () => {
    for (const request of requests) {
      if (generation !== prefetchGeneration) return;
      await prefetchWindow(request.start, request.end, generation);
    }
  })();
}

function scheduleWindowPrefetches(requests: Array<{
  start: Temporal.PlainDate;
  end: Temporal.PlainDate;
}>): void {
  if (requests.length === 0) return;
  const generation = prefetchGeneration;

  void (async () => {
    for (const request of requests) {
      if (generation !== prefetchGeneration) return;
      await prefetchWindow(request.start, request.end, generation);
    }
  })();
}

async function waitForWindowIdle(): Promise<void> {
  await windowLoadCoordinator.whenIdle();
}

function clearWindowCache(): void {
  windowCache.clear();
  prefetchGeneration++;
  windowLoadCoordinator.supersedePending();
}

async function reloadCurrentWindowFromDb(): Promise<void> {
  if (!currentWindowStart || !currentWindowEnd) {
    invalidate(false);
    return;
  }
  await reloadWindowFromDb(currentWindowStart, currentWindowEnd);
}

async function reloadWindowFromDb(
  windowStart: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
): Promise<void> {
  clearWindowCache();
  await loadWindowIntoState(windowStart, windowEnd, false, true);
}


export function getCalendar() {
  initCalendarWindowSync(() => reloadCurrentWindowFromDb());
  const store = {
    /**
     * View-scoped expansion. Pass the visible date range; the underlying
     * sorted index makes per-call cost bounded by the visible event count
     * rather than the full template count, so repeated calls stay cheap
     * even during held-arrow navigation.
     */
    eventsInWindow(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): CalendarEvent[] {
      void indexVersion;
      const renderZone = localTimezone();
      const key = calendarWindowKey(windowStart, windowEnd, renderZone);
      if (currentWindowKey === key) {
        return windowEvents;
      }
      if (currentWindowCovers(windowStart, windowEnd, renderZone)) {
        return eventsInWindowFromIndex(getIndex(), windowStart, windowEnd);
      }
      const cached = windowCache.peek(key);
      if (cached) return cached.windowEvents;
      const covering = findCachedWindowCovering(windowStart, windowEnd, renderZone);
      if (covering) {
        return eventsInWindowFromIndex(covering.expansionIndex, windowStart, windowEnd);
      }
      return [];
    },

    /**
     * Reactivity token; consumers can `void store.indexVersion` inside an
     * `$effect` to re-run on any mutation without paying a wide-window
     * expansion just to subscribe.
     */
    get indexVersion(): number {
      return indexVersion;
    },

    get rawBlocks(): CalendarEvent[] {
      return rawBlocks;
    },

    get eventCount(): number {
      return totalEventCount;
    },

    get loaded(): boolean {
      return loaded;
    },

    get windowLoadBusy(): boolean {
      return windowLoadCoordinator.busy;
    },

    get foregroundWindowLoadBusy(): boolean {
      return foregroundWindowBusy;
    },

    isWindowCurrent(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): boolean {
      return currentWindowKey === calendarWindowKey(windowStart, windowEnd, localTimezone());
    },

    hasWindow(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): boolean {
      const renderZone = localTimezone();
      return currentWindowCovers(windowStart, windowEnd, renderZone)
        || findCachedWindowCovering(windowStart, windowEnd, renderZone) !== undefined;
    },

    async ensureWindowReady(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): Promise<void> {
      await ensureWindowSnapshotReady(windowStart, windowEnd);
    },

    prefetchWindows(requests: Array<{
      start: Temporal.PlainDate;
      end: Temporal.PlainDate;
    }>): void {
      scheduleWindowPrefetches(requests);
    },

    async whenWindowIdle(): Promise<void> {
      await waitForWindowIdle();
    },

    async whenForegroundWindowIdle(): Promise<void> {
      await waitForForegroundWindowIdle();
    },

    /** Suppress invalidate() during multi-step mutations. */
    beginBatch() { batchDepth++; },
    endBatch() { if (--batchDepth <= 0) { batchDepth = 0; invalidate(); } },

    async load(initialViewMode: CalendarViewMode = getPreferences().calendarViewMode) {
      perfMark("boot.sql-start");
      try {
        loaded = false;
        const initialWindow = computeViewWindow(new Date(), initialViewMode);
        await loadWindowIntoState(initialWindow.start, initialWindow.end, true);
      } catch (e) {
        console.error("[calendar] load() failed:", e);
        throw e;
      }
    },

    async loadWindow(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): Promise<void> {
      await loadWindowIntoState(windowStart, windowEnd, false);
    },

    async refreshCurrentWindow(): Promise<void> {
      await reloadCurrentWindowFromDb();
    },

    async refreshWindow(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): Promise<void> {
      await reloadWindowFromDb(windowStart, windowEnd);
    },

    async loadPomodoroSchedulerEvents(
      windowStart: Temporal.PlainDate,
      windowEnd: Temporal.PlainDate,
    ): Promise<CalendarEvent[]> {
      return loadPomodoroSchedulerEventsFromDb(windowStart, windowEnd, indexVersion);
    },

    /**
     * Fetch just the fields the event panel needs for first paint. This is
     * intentionally lighter than `loadFullEvent`: no alarms and no recurring
     * override mirrors. Results are cached until the next calendar mutation,
     * and event tiles prefetch this on pointer hover / pointer down.
     */
    async loadPanelEvent(id: string): Promise<CalendarEvent | undefined> {
      return loadPanelEvent(id);
    },

    prefetchPanelEvent(id: string): void {
      prefetchPanelEvent(id);
    },

    /**
     * Fetch the full DB row for one event id and return a fully populated
     * `CalendarEvent`. The render path holds only a slim subset of columns in
     * the current window; this is what ICS export and delete undo call when
     * they need every heavy field, including alarms and override mirrors.
     */
    async loadFullEvent(id: string): Promise<CalendarEvent | undefined> {
      return loadFullEvent(id);
    },

    async addBlock(opts: CalendarAddBlockOptions): Promise<CalendarEvent> {
      const event = await addCalendarBlock(opts);
      rawBlocks = [...rawBlocks, event];
      totalEventCount++;
      invalidate();
      publishCalendarWindowSync();
      return event;
    },
    /**
     * Apply a partial event patch. Only columns whose keys are present in
     * the patch are written; unrelated fields stay as-is. Callers can pass a
     * full event (every column rewritten, original behavior) or a narrow
     * patch like `{ id, start, end }` for drag commits.
     *
     * Child rows (attendees, alarms, pomodoroConfig) are touched only when
     * their key is explicitly present in the patch, so passing a slim
     * in-memory event without those keys preserves their existing rows.
     */
    async updateBlock(patch: Partial<CalendarEvent> & { id: string }): Promise<void> {
      const { parentId, toUpdate, payload } = prepareUpdateBlockPayload(patch, rawBlocks);

      await invoke("calendar_update_event", {
        dbUrl: dbUrl(),
        patch: payload,
      });

      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId
          ? { ...b, ...toUpdate, id: parentId, recurringParentId: undefined }
          : b,
      );
      invalidate();
      publishCalendarWindowSync();
    },

    async deleteBlock(eventOrId: CalendarEvent | string) {
      const target = mutationTargetForEvent(eventOrId);
      await invoke("calendar_delete_event", { dbUrl: dbUrl(), target });
      const nextState = removeCalendarMutationTarget(rawBlocks, totalEventCount, target);
      rawBlocks = nextState.blocks;
      totalEventCount = nextState.totalEventCount;
      invalidate();
      publishCalendarWindowSync();
    },

    async archiveBlock(eventOrId: CalendarEvent | string) {
      const target = mutationTargetForEvent(eventOrId);
      await invoke("calendar_archive_event", { dbUrl: dbUrl(), target });
      const nextState = removeCalendarMutationTarget(rawBlocks, totalEventCount, target);
      rawBlocks = nextState.blocks;
      totalEventCount = nextState.totalEventCount;
      invalidate();
      publishCalendarWindowSync();
    },

    async applyDeleteArchivePlan(operations: CalendarDeleteArchiveOperation[]) {
      await invoke("calendar_apply_delete_archive_plan", {
        dbUrl: dbUrl(),
        operations,
      });
      invalidate(false);
      clearPanelEventCache();
      publishCalendarWindowSync();
    },

    async restoreArchivedBlock(eventOrId: CalendarEvent | string) {
      const target = mutationTargetForEvent(eventOrId);
      await invoke("calendar_restore_archived_event", { dbUrl: dbUrl(), target });
      if (target.id.includes("::")) {
        const [parentId, date] = target.id.split("::");
        rawBlocks = rawBlocks.map((b) =>
          b.id === parentId
            ? { ...b, exceptions: (b.exceptions ?? []).filter((exception) => exception !== date) }
            : b,
        );
      } else {
        const existed = rawBlocks.some((b) => b.id === target.id);
        deletePanelEventCacheEntry(target.id);
        const restored = await store.loadFullEvent(target.id)
          ?? (typeof eventOrId === "string" ? undefined : { ...eventOrId, recurringParentId: undefined });
        if (restored) {
          rawBlocks = [...rawBlocks.filter((b) => b.id !== target.id), restored];
          if (!existed) totalEventCount += 1;
        }
      }
      invalidate();
      publishCalendarWindowSync();
    },

    /**
     * Resolve an event (possibly a recurring instance) to its DB-backed template.
     * Returns the template event, or undefined if not found.
     */
    getTemplate(event: CalendarEvent): CalendarEvent | undefined {
      return resolveToTemplate(event);
    },

    /**
     * Detach a recurring instance into a standalone event.
     * Creates a new DB row and adds the instance date as an exception on the parent.
     */
    async detachInstance(instanceEvent: CalendarEvent): Promise<CalendarEvent> {
      const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
      const parent = rawBlocks.find((b) => b.id === parentId);
      if (!parent) throw new Error("Parent template not found");

      const result = await detachCalendarInstance(instanceEvent, parent);
      rawBlocks = rawBlocks.map((b) =>
        b.id === result.parentId ? { ...b, exceptions: result.exceptions } : b,
      );
      rawBlocks = [...rawBlocks, result.standalone];
      totalEventCount++;
      invalidate();
      publishCalendarWindowSync();
      return result.standalone;
    },

    /**
     * Add an exception date to a recurring parent (hides one instance without deleting it).
     */
    async addException(parentId: string, date: string) {
      const parent = rawBlocks.find((b) => b.id === parentId);
      if (!parent) return;

      const exceptions = await addCalendarException(parent, date);
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, exceptions } : b,
      );
      invalidate();
      publishCalendarWindowSync();
    },

    /**
     * Set repeat_until on a recurring template to cap the series.
     */
    async setRepeatUntil(parentId: string, date: string) {
      const parent = rawBlocks.find((b) => b.id === parentId);
      if (!parent || !parent.recurrence) return;

      const updatedRecurrence = await setCalendarRepeatUntil(parent, date);
      if (!updatedRecurrence) return;
      rawBlocks = rawBlocks.map((b) =>
        b.id === parentId ? { ...b, recurrence: updatedRecurrence } : b,
      );
      invalidate();
      publishCalendarWindowSync();
    },

    /**
     * Split a recurring series at a given date.
     * The original template stops at dayBefore(date), and a new recurring
     * template is created starting from date with the provided changes.
     */
    async splitSeries(
      instanceEvent: CalendarEvent,
      changes: Partial<CalendarEvent>,
    ): Promise<CalendarEvent> {
      const parentId = instanceEvent.recurringParentId ?? instanceEvent.id;
      const parent = rawBlocks.find((b) => b.id === parentId);
      if (!parent) throw new Error("Parent template not found");

      const result = await splitCalendarSeries(instanceEvent, changes, parent);
      rawBlocks = rawBlocks.map((b) =>
        b.id === result.parentId ? { ...b, recurrence: result.cappedRecurrence } : b,
      );
      rawBlocks = [...rawBlocks, result.newTemplate];
      totalEventCount++;
      invalidate();
      return result.newTemplate;
    },

    async applyRecurrenceCommitPlan(plan: RecurringCommitPlan) {
      const result = await applyCalendarRecurrenceCommitPlan(plan, rawBlocks);
      if (result.changed) {
        rawBlocks = [...result.blocks];
        totalEventCount += result.addedCount;
        invalidate(false);
        clearPanelEventCache();
        publishCalendarWindowSync();
      }
      return {
        operationResults: result.operationResults,
        activeRunTransferred: result.activeRunTransferred,
      };
    },

    async clearAll() {
      await invoke("calendar_clear_events", { dbUrl: dbUrl() });
      rawBlocks = [];
      totalEventCount = 0;
      invalidate();
      publishCalendarWindowSync();
    },

    /**
     * Insert or update a batch of events into a target calendar, deduplicated
     * by (calendar_id, source_uid). Newer revisions (higher SEQUENCE) win;
     * equal SEQUENCE counts as an update so re-importing the same file leaves
     * the DB clean. Child rows (attendees, alarms, overrides) are replaced.
     *
     * The whole batch ships as a typed payload to the Rust
     * `calendar_bulk_import` command. Rust deduplicates by UID, compares
     * SEQUENCE, replaces child rows, and commits once.
     */
    async bulkImport(
      events: CalendarEvent[],
      targetCalendarId: string,
      opts: CalendarBulkImportOptions = {},
    ): Promise<IcsImportSummary> {
      const result = await bulkImportCalendarEvents(events, targetCalendarId, opts);
      if (!result.applied) return result.summary;

      totalEventCount += result.added;
      if (result.refreshWindow) {
        await reloadCurrentWindowFromDb();
      }
      publishCalendarWindowSync();
      return result.summary;
    },

    /**
     * Serialize every event of `calendar` into a `.ics` string ready to write
     * to disk. Event ids come from Rust because the render path owns only
     * the visible window. Heavy fields are loaded on demand via
     * `loadFullEvent` before serialization so the export is lossless.
     */
    async exportCalendarAsIcs(calendar: Calendar): Promise<string> {
      return exportCalendarIcs(calendar, (id) => store.loadFullEvent(id));
    },

    /**
     * Check whether a specific recurring instance date has completed progress segments.
     */
    async hasProgressSegments(templateId: string, date: string): Promise<boolean> {
      return invoke<boolean>("calendar_has_progress_segments", {
        dbUrl: dbUrl(),
        templateId,
        date,
      });
    },

    /**
     * Check whether changes to a recurring template affect structural fields
     * (times, pomodoro config) vs. purely cosmetic fields (title, color, etc.).
     */
    hasStructuralChanges(template: CalendarEvent, changes: Partial<CalendarEvent>): boolean {
      return eventHasStructuralChanges(template, changes);
    },

    /**
     * Protect historical pomodoro progress by detaching past recurring instances
     * that have completed segments into standalone events before modifying the template.
     *
     * Returns the list of dates that were detached.
     */
    async protectHistoricalSegments(
      templateId: string,
      cutoffDate: string,
      excludeDate?: string,
    ): Promise<string[]> {
      const datesToProtect = await invoke<string[]>("calendar_progress_dates_before", {
        dbUrl: dbUrl(),
        templateId,
        cutoffDate,
        excludeDate: excludeDate ?? null,
      });

      if (datesToProtect.length === 0) return [];

      const parent = rawBlocks.find((b) => b.id === templateId);
      if (!parent) return [];

      const detachedDates: string[] = [];
      for (const date of datesToProtect) {
        const startTime = parent.start.split(" ")[1];
        const endTime = parent.end.split(" ")[1];
        const virtualInstance: CalendarEvent = {
          ...parent,
          id: `${templateId}::${date}`,
          start: `${date} ${startTime}`,
          end: `${date} ${endTime}`,
          recurringParentId: templateId,
          recurrence: undefined,
          exceptions: undefined,
        };
        await store.detachInstance(virtualInstance);
        detachedDates.push(date);
      }

      return detachedDates;
    },
  };
  return store;
}
