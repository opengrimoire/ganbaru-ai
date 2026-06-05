import {
  closeDoomscrollingDesktopApp,
  closeCurrentForegroundDoomscrollingDesktopApp,
  getForegroundDoomscrollingDesktopApp,
  listBlockedDoomscrollingDesktopAppMatches,
  listDoomscrollingUsageSamples,
  recordDoomscrollingUsageSample,
  showDoomscrollingDesktopLimitNotification,
  writeDoomscrollingLimitState,
  type DoomscrollingDesktopAppRulePayload,
  type DoomscrollingForegroundDesktopAppStatus,
  type DoomscrollingRunningDesktopAppMatch,
  type DoomscrollingUsageSampleRow,
} from "$lib/api/doomscrolling";
import { ensureDbUrl } from "$lib/api/db";
import {
  computeDoomscrollingLimitTotals,
  doomscrollingWeekStartLocalDate,
  isProtectedDoomscrollingDesktopAppName,
  matchesDoomscrollingLimitEntry,
  type DoomscrollingLimitPeriod,
  type DoomscrollingLimitTotal,
  type DoomscrollingUsageSample,
} from "$lib/doomscrolling";
import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";

const REFRESH_INTERVAL_MS = 5_000;
const FOREGROUND_USAGE_INTERVAL_MS = 5_000;
const DESKTOP_LIMIT_CLOSE_THROTTLE_MS = 60_000;

interface ForegroundUsageSnapshot {
  sourceKey: string;
  displayName: string;
  startedAt: number;
  localDate: string;
}

interface ForegroundUsageSource {
  sourceKey: string;
  displayName: string;
}

interface OpenAppUsageSnapshot {
  sourceKey: string;
  displayName: string;
  processId: number;
  startedAt: number;
  localDate: string;
}

let localDate = $state(todayLocalDate());
let weekStartLocalDate = $state(doomscrollingWeekStartLocalDate(todayLocalDate()));
let totals = $state<DoomscrollingLimitTotal[]>([]);
let samples = $state<DoomscrollingUsageSample[]>([]);
let refreshRunning = false;
let foregroundStatus = $state<DoomscrollingForegroundDesktopAppStatus>({
  available: false,
  appName: null,
  processName: null,
  processId: null,
  matchNames: [],
  reason: null,
});
let foregroundUsageSnapshot: ForegroundUsageSnapshot | null = null;
let openAppUsageSnapshots = new Map<string, OpenAppUsageSnapshot>();
let foregroundUsageRunning = false;
const desktopLimitCloseAttempts = new Map<string, number>();

function todayLocalDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rowToSample(row: DoomscrollingUsageSampleRow): DoomscrollingUsageSample {
  return {
    sourceType: row.sourceType,
    sourceKey: row.sourceKey,
    displayName: row.displayName,
    elapsedSeconds: row.elapsedSeconds,
    startedAt: row.startedAt,
    localDate: row.localDate,
  };
}

async function refreshUsage(): Promise<void> {
  if (refreshRunning) return;
  refreshRunning = true;
  try {
    const nextLocalDate = todayLocalDate();
    const nextWeekStartLocalDate = doomscrollingWeekStartLocalDate(nextLocalDate);
    const dbUrl = await ensureDbUrl();
    const rows = await listDoomscrollingUsageSamples(dbUrl, nextWeekStartLocalDate, nextLocalDate);
    const doomscrolling = getDoomscrolling();
    const nextSamples = rows.map(rowToSample);
    const nextTotals = computeDoomscrollingLimitTotals(
      doomscrolling.config,
      nextSamples,
      nextLocalDate,
    );
    localDate = nextLocalDate;
    weekStartLocalDate = nextWeekStartLocalDate;
    samples = nextSamples;
    totals = nextTotals;
    await writeDoomscrollingLimitState({
      localDate: nextLocalDate,
      weekStartLocalDate: nextWeekStartLocalDate,
      updatedAt: new Date().toISOString(),
      limits: nextTotals.map((total) => ({
        id: total.limitId,
        period: total.period ?? "day",
        windowStartLocalDate: total.windowStartLocalDate ?? nextLocalDate,
        windowEndLocalDate: total.windowEndLocalDate ?? nextLocalDate,
        usedSeconds: total.usedSeconds,
        limitSeconds: total.limitSeconds,
        remainingSeconds: total.remainingSeconds,
        exhausted: total.exhausted,
      })),
    });
  } catch (err) {
    console.warn("Failed to refresh doomscrolling usage limits:", err);
  } finally {
    refreshRunning = false;
  }
}

function foregroundUsageSourceFromStatus(
  status: DoomscrollingForegroundDesktopAppStatus,
): ForegroundUsageSource | null {
  if (!status.available || !status.appName) return null;
  const matchNames = status.matchNames.filter((name) => name.trim() !== "");
  const candidates = [
    status.appName,
    ...matchNames,
    status.processName,
  ].filter((name): name is string => Boolean(name?.trim()));
  if (isProtectedDoomscrollingDesktopAppName(status.appName)) return null;
  const sourceKey = candidates.find((name) => !isProtectedDoomscrollingDesktopAppName(name));
  if (!sourceKey) return null;
  return {
    sourceKey,
    displayName: status.appName,
  };
}

function shouldUseOpenAppCounting(
  status: DoomscrollingForegroundDesktopAppStatus,
): boolean {
  return !status.available && status.reason?.toLowerCase().includes("wayland") === true;
}

async function recordForegroundUsageUntil(endedAt: number): Promise<boolean> {
  const snapshot = foregroundUsageSnapshot;
  foregroundUsageSnapshot = null;
  if (!snapshot) return false;
  const elapsedSeconds = Math.floor((endedAt - snapshot.startedAt) / 1000);
  if (elapsedSeconds < 1) return false;
  const dbUrl = await ensureDbUrl();
  await recordDoomscrollingUsageSample(dbUrl, {
    sourceType: "desktop-app",
    sourceKey: snapshot.sourceKey,
    displayName: snapshot.displayName,
    startedAt: snapshot.startedAt,
    elapsedSeconds,
    localDate: snapshot.localDate,
  });
  return true;
}

async function recordOpenAppUsageSnapshot(
  snapshot: OpenAppUsageSnapshot,
  endedAt: number,
): Promise<boolean> {
  const elapsedSeconds = Math.floor((endedAt - snapshot.startedAt) / 1000);
  if (elapsedSeconds < 1) return false;
  const dbUrl = await ensureDbUrl();
  await recordDoomscrollingUsageSample(dbUrl, {
    sourceType: "desktop-app",
    sourceKey: snapshot.sourceKey,
    displayName: snapshot.displayName,
    startedAt: snapshot.startedAt,
    elapsedSeconds,
    localDate: snapshot.localDate,
  });
  return true;
}

async function recordOpenAppUsageUntil(endedAt: number): Promise<boolean> {
  const snapshots = [...openAppUsageSnapshots.values()];
  openAppUsageSnapshots = new Map();
  const results = await Promise.all(
    snapshots.map((snapshot) => recordOpenAppUsageSnapshot(snapshot, endedAt)),
  );
  return results.some(Boolean);
}

function foregroundLimitSample(
  source: ForegroundUsageSource,
  startedAt: number,
  sampleLocalDate: string,
): DoomscrollingUsageSample {
  return {
    sourceType: "desktop-app",
    sourceKey: source.sourceKey,
    displayName: source.displayName,
    elapsedSeconds: 1,
    startedAt,
    localDate: sampleLocalDate,
  };
}

function exhaustedForegroundLimit(
  source: ForegroundUsageSource,
  startedAt: number,
  sampleLocalDate: string,
): { limitId: string; limitName: string; period: DoomscrollingLimitPeriod } | null {
  const doomscrolling = getDoomscrolling();
  if (!doomscrolling.limitsEnabled) return null;
  const sample = foregroundLimitSample(source, startedAt, sampleLocalDate);
  for (const limit of doomscrolling.usageLimits) {
    if (!limit.enabled) continue;
    const total = totals.find((item) =>
      item.limitId === limit.id
      && item.exhausted
      && item.usedSeconds >= item.limitSeconds
    );
    if (!total) continue;
    if (!limit.entries.some((entry) => matchesDoomscrollingLimitEntry(entry, sample))) continue;
    return { limitId: limit.id, limitName: limit.name, period: total.period ?? "day" };
  }
  return null;
}

async function enforceForegroundLimit(
  status: DoomscrollingForegroundDesktopAppStatus,
  source: ForegroundUsageSource,
  startedAt: number,
  sampleLocalDate: string,
): Promise<void> {
  const exhausted = exhaustedForegroundLimit(source, startedAt, sampleLocalDate);
  if (!exhausted) return;
  const closeKey = `${exhausted.limitId}:${source.sourceKey.toLowerCase()}`;
  const now = Date.now();
  const previousAttempt = desktopLimitCloseAttempts.get(closeKey) ?? 0;
  if (now - previousAttempt < DESKTOP_LIMIT_CLOSE_THROTTLE_MS) return;
  desktopLimitCloseAttempts.set(closeKey, now);
  await closeCurrentForegroundDoomscrollingDesktopApp({
    appName: status.appName,
    processName: status.processName,
    processId: status.processId,
    matchNames: status.matchNames,
  });
  await showDoomscrollingDesktopLimitNotification(source.displayName, exhausted.limitName);
}

function openAppLimitPayloads(): DoomscrollingDesktopAppRulePayload[] {
  const doomscrolling = getDoomscrolling();
  if (!doomscrolling.limitsEnabled) return [];
  const byKey = new Map<string, DoomscrollingDesktopAppRulePayload>();
  for (const limit of doomscrolling.usageLimits) {
    if (!limit.enabled) continue;
    for (const entry of limit.entries) {
      if (!entry.desktopAppName) continue;
      if (isProtectedDoomscrollingDesktopAppName(entry.desktopAppName)) continue;
      const matchNames = entry.desktopAppMatchNames.length > 0
        ? entry.desktopAppMatchNames
        : [entry.desktopAppName];
      byKey.set(entry.desktopAppName.toLowerCase(), {
        name: entry.desktopAppName,
        matchNames: [...matchNames],
      });
    }
  }
  return [...byKey.values()];
}

function openAppSourcesFromMatches(
  matches: readonly DoomscrollingRunningDesktopAppMatch[],
): OpenAppUsageSnapshot[] {
  const now = Date.now();
  const sampleLocalDate = todayLocalDate();
  const byKey = new Map<string, OpenAppUsageSnapshot>();
  for (const match of matches) {
    if (isProtectedDoomscrollingDesktopAppName(match.appName)) continue;
    const sourceKey = match.appName;
    const key = sourceKey.toLowerCase();
    if (byKey.has(key)) continue;
    byKey.set(key, {
      sourceKey,
      displayName: match.appName,
      processId: match.processId,
      startedAt: now,
      localDate: sampleLocalDate,
    });
  }
  return [...byKey.values()];
}

async function enforceOpenAppLimit(snapshot: OpenAppUsageSnapshot): Promise<void> {
  const exhausted = exhaustedForegroundLimit(
    {
      sourceKey: snapshot.sourceKey,
      displayName: snapshot.displayName,
    },
    snapshot.startedAt,
    snapshot.localDate,
  );
  if (!exhausted) return;
  const closeKey = `${exhausted.limitId}:${snapshot.sourceKey.toLowerCase()}`;
  const now = Date.now();
  const previousAttempt = desktopLimitCloseAttempts.get(closeKey) ?? 0;
  if (now - previousAttempt < DESKTOP_LIMIT_CLOSE_THROTTLE_MS) return;
  desktopLimitCloseAttempts.set(closeKey, now);
  await closeDoomscrollingDesktopApp(snapshot.processId);
  await showDoomscrollingDesktopLimitNotification(snapshot.displayName, exhausted.limitName);
}

async function updateOpenAppUsage(endedAt: number): Promise<boolean> {
  const payloads = openAppLimitPayloads();
  if (payloads.length === 0) {
    return await recordOpenAppUsageUntil(endedAt);
  }
  const matches = await listBlockedDoomscrollingDesktopAppMatches(payloads);
  const nextSnapshots = openAppSourcesFromMatches(matches);
  const activeKeys = new Set(nextSnapshots.map((snapshot) => snapshot.sourceKey.toLowerCase()));
  const staleSnapshots = [...openAppUsageSnapshots.values()]
    .filter((snapshot) => !activeKeys.has(snapshot.sourceKey.toLowerCase()));
  const continuingSnapshots = nextSnapshots.map((snapshot) => {
    const previous = openAppUsageSnapshots.get(snapshot.sourceKey.toLowerCase());
    return previous
      ? {
        ...snapshot,
        startedAt: previous.startedAt,
        localDate: previous.localDate,
      }
      : snapshot;
  });
  const recordedStale = await Promise.all(
    staleSnapshots.map((snapshot) => recordOpenAppUsageSnapshot(snapshot, endedAt)),
  );
  const recordedContinuing = await Promise.all(
    continuingSnapshots.map((snapshot) => recordOpenAppUsageSnapshot(snapshot, endedAt)),
  );
  openAppUsageSnapshots = new Map(
    nextSnapshots.map((snapshot) => [
      snapshot.sourceKey.toLowerCase(),
      {
        ...snapshot,
        startedAt: endedAt,
        localDate: todayLocalDate(),
      },
    ]),
  );
  const recorded = [...recordedStale, ...recordedContinuing].some(Boolean);
  if (recorded) {
    await refreshUsage();
  }
  await Promise.all(
    nextSnapshots.map((snapshot) =>
      enforceOpenAppLimit(snapshot).catch((err) => {
        console.warn("Failed to enforce doomscrolling open app limit:", err);
      })
    ),
  );
  return false;
}

async function updateForegroundUsage(): Promise<void> {
  if (foregroundUsageRunning) return;
  foregroundUsageRunning = true;
  const startedAt = Date.now();
  const sampleLocalDate = todayLocalDate();
  try {
    const status = await getForegroundDoomscrollingDesktopApp();
    foregroundStatus = status;
    const source = foregroundUsageSourceFromStatus(status);
    const recorded = await recordForegroundUsageUntil(startedAt);
    const recordedOpenApps = status.available
      ? await recordOpenAppUsageUntil(startedAt)
      : shouldUseOpenAppCounting(status)
        ? await updateOpenAppUsage(startedAt)
        : await recordOpenAppUsageUntil(startedAt);
    if (source) {
      foregroundUsageSnapshot = {
        ...source,
        startedAt,
        localDate: sampleLocalDate,
      };
    }
    if (recorded || recordedOpenApps) {
      await refreshUsage();
    }
    if (source) {
      await enforceForegroundLimit(status, source, startedAt, sampleLocalDate).catch((err) => {
        console.warn("Failed to enforce doomscrolling foreground limit:", err);
      });
    }
  } catch (err) {
    foregroundStatus = {
      available: false,
      appName: null,
      processName: null,
      processId: null,
      matchNames: [],
      reason: err instanceof Error ? err.message : String(err),
    };
    foregroundUsageSnapshot = null;
    openAppUsageSnapshots = new Map();
    console.warn("Failed to update doomscrolling foreground usage:", err);
  } finally {
    foregroundUsageRunning = false;
  }
}

export function getDoomscrollingUsage() {
  return {
    get localDate(): string {
      return localDate;
    },
    get weekStartLocalDate(): string {
      return weekStartLocalDate;
    },
    get totals(): readonly DoomscrollingLimitTotal[] {
      return totals;
    },
    get samples(): readonly DoomscrollingUsageSample[] {
      return samples;
    },
    get foregroundStatus(): DoomscrollingForegroundDesktopAppStatus {
      return foregroundStatus;
    },
    totalFor(limitId: string): DoomscrollingLimitTotal | null {
      return totals.find((total) => total.limitId === limitId) ?? null;
    },
    totalsFor(limitId: string): readonly DoomscrollingLimitTotal[] {
      return totals.filter((total) => total.limitId === limitId);
    },
    refresh(): Promise<void> {
      return refreshUsage();
    },
    start(): () => void {
      void refreshUsage();
      void updateForegroundUsage();
      const refreshInterval = setInterval(() => {
        void refreshUsage();
      }, REFRESH_INTERVAL_MS);
      const foregroundInterval = setInterval(() => {
        void updateForegroundUsage();
      }, FOREGROUND_USAGE_INTERVAL_MS);
      return () => {
        void recordForegroundUsageUntil(Date.now()).catch((err) => {
          console.warn("Failed to record final doomscrolling foreground usage sample:", err);
        });
        void recordOpenAppUsageUntil(Date.now()).catch((err) => {
          console.warn("Failed to record final doomscrolling open app usage sample:", err);
        });
        clearInterval(refreshInterval);
        clearInterval(foregroundInterval);
      };
    },
  };
}
