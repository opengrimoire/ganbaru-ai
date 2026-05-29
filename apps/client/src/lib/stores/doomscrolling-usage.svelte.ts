import {
  getForegroundDoomscrollingDesktopApp,
  listDoomscrollingUsageSamples,
  writeDoomscrollingLimitState,
  type DoomscrollingForegroundDesktopAppStatus,
  type DoomscrollingUsageSampleRow,
} from "$lib/api/doomscrolling";
import { ensureDbUrl } from "$lib/api/db";
import {
  computeDoomscrollingLimitDailyTotals,
  type DoomscrollingDailyLimitTotal,
  type DoomscrollingUsageSample,
} from "$lib/doomscrolling";
import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";

const REFRESH_INTERVAL_MS = 5_000;
const ALLOWED_DATABASE_FILE_NAMES = [
  "ganbaru-ai.db",
  "ganbaru-ai-dev.db",
  "ganbaru-ai-benchmark.db",
] as const;

let localDate = $state(todayLocalDate());
let totals = $state<DoomscrollingDailyLimitTotal[]>([]);
let samples = $state<DoomscrollingUsageSample[]>([]);
let refreshRunning = false;
let foregroundStatus = $state<DoomscrollingForegroundDesktopAppStatus>({
  available: false,
  appName: null,
  processName: null,
  processId: null,
  reason: null,
});

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

function databaseFileNameFromUrl(
  dbUrl: string,
): (typeof ALLOWED_DATABASE_FILE_NAMES)[number] {
  const fileName = dbUrl
    .replace(/^sqlite:/, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
  const allowed = ALLOWED_DATABASE_FILE_NAMES.find((allowedName) => allowedName === fileName);
  if (!allowed) {
    throw new Error(`unsupported doomscrolling usage database '${dbUrl}'`);
  }
  return allowed;
}

async function refreshUsage(): Promise<void> {
  if (refreshRunning) return;
  refreshRunning = true;
  try {
    const nextLocalDate = todayLocalDate();
    const dbUrl = await ensureDbUrl();
    const rows = await listDoomscrollingUsageSamples(dbUrl, nextLocalDate);
    const doomscrolling = getDoomscrolling();
    const nextSamples = rows.map(rowToSample);
    const nextTotals = computeDoomscrollingLimitDailyTotals(
      doomscrolling.config,
      nextSamples,
      nextLocalDate,
    );
    localDate = nextLocalDate;
    samples = nextSamples;
    totals = nextTotals;
    await writeDoomscrollingLimitState({
      localDate: nextLocalDate,
      updatedAt: new Date().toISOString(),
      databaseFileName: databaseFileNameFromUrl(dbUrl),
      limits: nextTotals.map((total) => ({
        id: total.limitId,
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

async function refreshForegroundStatus(): Promise<void> {
  try {
    foregroundStatus = await getForegroundDoomscrollingDesktopApp();
  } catch (err) {
    foregroundStatus = {
      available: false,
      appName: null,
      processName: null,
      processId: null,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export function getDoomscrollingUsage() {
  return {
    get localDate(): string {
      return localDate;
    },
    get totals(): readonly DoomscrollingDailyLimitTotal[] {
      return totals;
    },
    get samples(): readonly DoomscrollingUsageSample[] {
      return samples;
    },
    get foregroundStatus(): DoomscrollingForegroundDesktopAppStatus {
      return foregroundStatus;
    },
    totalFor(limitId: string): DoomscrollingDailyLimitTotal | null {
      return totals.find((total) => total.limitId === limitId) ?? null;
    },
    refresh(): Promise<void> {
      return refreshUsage();
    },
    start(): () => void {
      void refreshUsage();
      void refreshForegroundStatus();
      const refreshInterval = setInterval(() => {
        void refreshUsage();
      }, REFRESH_INTERVAL_MS);
      const foregroundInterval = setInterval(() => {
        void refreshForegroundStatus();
      }, 30_000);
      return () => {
        clearInterval(refreshInterval);
        clearInterval(foregroundInterval);
      };
    },
  };
}
