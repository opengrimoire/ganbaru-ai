import { invoke } from "@tauri-apps/api/core";
import {
  computeDoomscrollingLimitTotals,
  doomscrollingWeekStartLocalDate,
  type DoomscrollingLimitTotal,
  type DoomscrollingUsageSample,
} from "$lib/doomscrolling";
import { getDoomscrolling } from "$lib/stores/doomscrolling.svelte";
import type { SchedulerRunContext } from "$lib/scheduling/lifecycle-scheduler";
import { publishMobileDoomscrollingUsage } from "$lib/scheduling/mobile-doomscrolling";

interface MobileUsageSampleRow extends DoomscrollingUsageSample {
  id: string;
  createdAt: number;
}

interface MobileSyncResult {
  imported: number;
  fullBatch: boolean;
}

let localDate = $state(todayLocalDate());
let weekStartLocalDate = $state(doomscrollingWeekStartLocalDate(todayLocalDate()));
let totals = $state<DoomscrollingLimitTotal[]>([]);
let samples = $state<DoomscrollingUsageSample[]>([]);
let refreshPromise: Promise<void> | null = null;
let usageEnabled = false;

function todayLocalDate(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function drainNativeJournal(): Promise<void> {
  for (let batch = 0; batch < 10; batch += 1) {
    const result = await invoke<MobileSyncResult>("doomscrolling_mobile_sync_events");
    if (!result.fullBatch) return;
  }
}

async function performRefresh(context?: SchedulerRunContext): Promise<void> {
  try {
    await drainNativeJournal();
    const nextLocalDate = todayLocalDate();
    const nextWeekStart = doomscrollingWeekStartLocalDate(nextLocalDate);
    const rows = await invoke<MobileUsageSampleRow[]>(
      "doomscrolling_mobile_list_usage_samples",
      { startLocalDate: nextWeekStart, endLocalDate: nextLocalDate },
    );
    if (context && !context.isCurrent()) return;
    const nextSamples = rows.map((row) => ({
      sourceType: row.sourceType,
      sourceKey: row.sourceKey,
      displayName: row.displayName,
      elapsedSeconds: row.elapsedSeconds,
      startedAt: row.startedAt,
      localDate: row.localDate,
    }));
    localDate = nextLocalDate;
    weekStartLocalDate = nextWeekStart;
    samples = nextSamples;
    const doomscrolling = getDoomscrolling();
    totals = computeDoomscrollingLimitTotals(
      doomscrolling.config,
      nextSamples,
      nextLocalDate,
    );
    await publishMobileDoomscrollingUsage(doomscrolling.config, totals);
  } catch (error) {
    console.warn("Failed to refresh mobile Doomscrolling usage", error);
  }
}

function refresh(context?: SchedulerRunContext): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = performRefresh(context).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
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
    get foregroundStatus() {
      return {
        available: true,
        appName: null,
        processName: null,
        processId: null,
        matchNames: [] as string[],
        reason: null,
      };
    },
    totalFor(limitId: string): DoomscrollingLimitTotal | null {
      return totals.find((total) => total.limitId === limitId) ?? null;
    },
    totalsFor(limitId: string): readonly DoomscrollingLimitTotal[] {
      return totals.filter((total) => total.limitId === limitId);
    },
    refresh(): Promise<void> {
      return refresh();
    },
    isEnabled(): boolean {
      return usageEnabled;
    },
    setEnabled(enabled: boolean): void {
      usageEnabled = enabled;
    },
    invalidate(): void {
      void refresh();
    },
    resume(): void {
      void refresh();
    },
    flush(): Promise<void> {
      return drainNativeJournal();
    },
    async runOnce(context: SchedulerRunContext): Promise<void> {
      if (!usageEnabled) return;
      await refresh(context);
    },
  };
}
