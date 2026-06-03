import {
  closeDoomscrollingDesktopApp,
  listBlockedDoomscrollingDesktopAppMatches,
  showDoomscrollingDesktopBlockNotification,
  type DoomscrollingDesktopAppRulePayload,
  type DoomscrollingRunningDesktopAppMatch,
} from "$lib/api/doomscrolling";
import type { DoomscrollingAppRule } from "$lib/doomscrolling";

const CLOSED_NOTIFICATION_LIMIT = 5;
const CLOSED_NOTIFICATION_WINDOW_MS = 60_000;

let checkRunning = false;
const closingProcessIds = new Set<number>();
const closedNotificationTimes: number[] = [];

function payloadFromRules(
  rules: readonly DoomscrollingAppRule[],
): DoomscrollingDesktopAppRulePayload[] {
  return rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({
      name: rule.name,
      matchNames: rule.matchNames,
    }));
}

function clearAlert(): void {
  closingProcessIds.clear();
}

function shouldNotifyClosedApp(): boolean {
  const now = Date.now();
  while (
    closedNotificationTimes.length > 0 &&
    closedNotificationTimes[0] <= now - CLOSED_NOTIFICATION_WINDOW_MS
  ) {
    closedNotificationTimes.shift();
  }
  if (closedNotificationTimes.length >= CLOSED_NOTIFICATION_LIMIT) return false;
  closedNotificationTimes.push(now);
  return true;
}

async function enforceBlockedMatch(match: DoomscrollingRunningDesktopAppMatch): Promise<void> {
  if (closingProcessIds.has(match.processId)) return;
  closingProcessIds.add(match.processId);
  try {
    await closeDoomscrollingDesktopApp(match.processId);
    if (shouldNotifyClosedApp()) {
      await showDoomscrollingDesktopBlockNotification(match.appName);
    }
  } catch (err) {
    console.warn(`Failed to close blocked desktop app ${match.appName}:`, err);
  } finally {
    closingProcessIds.delete(match.processId);
  }
}

async function checkBlockedApps(rules: readonly DoomscrollingAppRule[]): Promise<void> {
  if (checkRunning) return;
  const apps = payloadFromRules(rules);
  if (apps.length === 0) {
    clearAlert();
    return;
  }
  checkRunning = true;
  try {
    const matches = await listBlockedDoomscrollingDesktopAppMatches(apps);
    await Promise.all(matches.map((match) => enforceBlockedMatch(match)));
  } catch (err) {
    console.warn("Failed to check blocked desktop apps:", err);
  } finally {
    checkRunning = false;
  }
}

export function getDoomscrollingDesktopBlocker() {
  return {
    clear(): void {
      clearAlert();
    },
    check(rules: readonly DoomscrollingAppRule[]): Promise<void> {
      return checkBlockedApps(rules);
    },
  };
}
