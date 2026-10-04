import {
  loadDoomscrollingUsageProjection,
  type DoomscrollingBudgetTotal,
  type DoomscrollingForegroundDesktopAppStatus,
} from "$lib/api/doomscrolling";
import { onActiveVaultIdentityChange, requireActiveVaultIdentity } from "$lib/vault/active-vault";
import type { DoomscrollingLimitPeriod, DoomscrollingLimitTotal } from "$lib/doomscrolling";
import type { SchedulerRunContext } from "$lib/scheduling/lifecycle-scheduler";

export const DOOMSCROLLING_USAGE_REFRESH_INTERVAL_MS = 5_000;

let localDate = $state("");
let weekStartLocalDate = $state("");
let totals = $state<DoomscrollingBudgetTotal[]>([]);
let foregroundStatus = $state<DoomscrollingForegroundDesktopAppStatus>(unavailableStatus());
let refreshRunning = false;
let generation = 0;

function unavailableStatus(): DoomscrollingForegroundDesktopAppStatus {
  return { available: false, appName: null, processName: null, processId: null, matchNames: [], reason: null };
}

onActiveVaultIdentityChange(() => {
  generation += 1;
  localDate = "";
  weekStartLocalDate = "";
  totals = [];
  foregroundStatus = unavailableStatus();
});

/** Refresh settings presentation. Native execution continues independently of this reader. */
async function refreshUsage(context?: SchedulerRunContext): Promise<void> {
  if (refreshRunning) return;
  refreshRunning = true;
  const expectedGeneration = generation;
  try {
    const expectedVault = requireActiveVaultIdentity();
    const projection = await loadDoomscrollingUsageProjection();
    if (context && !context.isCurrent()) return;
    if (expectedGeneration !== generation || projection.vaultId !== expectedVault) return;
    localDate = projection.localDate;
    weekStartLocalDate = projection.weekStartLocalDate;
    totals = projection.totals;
    foregroundStatus = projection.foregroundStatus;
  } catch (error) {
    if (expectedGeneration !== generation || (context && !context.isCurrent())) return;
    totals = [];
    foregroundStatus = unavailableStatus();
    console.warn("Failed to refresh doomscrolling usage limits:", error);
  } finally {
    refreshRunning = false;
  }
}

/** Expose canonical budgets and observed adapter availability for settings rendering. */
export function getDoomscrollingUsage() {
  return {
    get localDate(): string { return localDate; },
    get weekStartLocalDate(): string { return weekStartLocalDate; },
    get totals(): readonly DoomscrollingLimitTotal[] { return totals; },
    get foregroundStatus(): DoomscrollingForegroundDesktopAppStatus { return foregroundStatus; },
    entryTotalsFor(limitId: string, period: DoomscrollingLimitPeriod) {
      return totals.find((total) => total.limitId === limitId && total.period === period)?.entries ?? [];
    },
    totalFor(limitId: string): DoomscrollingLimitTotal | null {
      return totals.find((total) => total.limitId === limitId) ?? null;
    },
    totalsFor(limitId: string): readonly DoomscrollingLimitTotal[] {
      return totals.filter((total) => total.limitId === limitId);
    },
    refresh: refreshUsage,
  };
}
