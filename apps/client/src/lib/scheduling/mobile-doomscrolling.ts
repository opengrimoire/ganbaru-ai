import { invoke } from "@tauri-apps/api/core";
import type { DoomscrollingConfig, DoomscrollingLimitTotal } from "$lib/doomscrolling";
import { translate } from "$lib/i18n/translator.svelte";
import { flushConfig } from "$lib/vault/config";
import { getActiveVaultInfo } from "$lib/vault/state";

const PLUGIN_COMMAND = "plugin:ganbaru-mobile-doomscrolling";
let publicationGeneration = 0;

export interface MobileDoomscrollingAccessStatus {
  usageAccess: boolean;
  accessibility: boolean;
}

export interface MobileDoomscrollingAppCandidate {
  name: string;
  packageName: string;
}

export interface MobileDoomscrollingPendingEvent {
  id: string;
  kind: "usage" | "block";
  packageName: string;
  displayName: string;
  startedAt: number;
  elapsedSeconds: number;
  localDate: string;
  occurredAt: number;
  reason: string | null;
  ruleId: string | null;
  runId: string | null;
  phase: "focus" | "short_break" | "long_break" | null;
  vaultId: string;
}

interface MobileDoomscrollingSnapshot {
  schemaVersion: 1;
  vaultId: string;
  revision: string;
  generatedAtEpochMs: number;
  mobile: DoomscrollingConfig["mobile"];
  limits: {
    enabled: boolean;
    items: Array<{
      id: string;
      name: string;
      enabled: boolean;
      minutesPerDay: number | null;
      minutesPerWeek: number | null;
      packages: string[];
      acceptedUsage: {
        day: MobileAcceptedUsage | null;
        week: MobileAcceptedUsage | null;
      };
    }>;
  };
  copy: {
    channelName: string;
    channelDescription: string;
    blockedMessage: string;
    limitMessage: string;
  };
}

interface MobileAcceptedUsage {
  windowStartLocalDate: string;
  windowEndLocalDate: string;
  usedSeconds: number;
}

/** Read whether Android has granted the two accesses required for app enforcement. */
export async function mobileDoomscrollingAccessStatus(): Promise<MobileDoomscrollingAccessStatus> {
  return await invoke<MobileDoomscrollingAccessStatus>(`${PLUGIN_COMMAND}|accessStatus`);
}

/** Open Android's Usage Access settings with an app-details fallback. */
export async function openMobileDoomscrollingUsageAccessSettings(): Promise<void> {
  await invoke(`${PLUGIN_COMMAND}|openUsageAccessSettings`);
}

/** Open Android's Accessibility settings with an app-details fallback. */
export async function openMobileDoomscrollingAccessibilitySettings(): Promise<void> {
  await invoke(`${PLUGIN_COMMAND}|openAccessibilitySettings`);
}

/** List launchable Android applications that are safe to select for blocking. */
export async function listMobileDoomscrollingApps(): Promise<MobileDoomscrollingAppCandidate[]> {
  return await invoke<MobileDoomscrollingAppCandidate[]>(`${PLUGIN_COMMAND}|listLaunchableApps`);
}

/** Read a bounded batch from Android's durable enforcement journal. */
export async function pendingMobileDoomscrollingEvents(): Promise<MobileDoomscrollingPendingEvent[]> {
  return await invoke<MobileDoomscrollingPendingEvent[]>(`${PLUGIN_COMMAND}|pendingEvents`);
}

/** Acknowledge journal rows only after their canonical vault import commits. */
export async function acknowledgeMobileDoomscrollingEvents(ids: readonly string[]): Promise<void> {
  await invoke(`${PLUGIN_COMMAND}|acknowledgeEvents`, { ids });
}

/** Consume a notification deep-link target captured by the Android plugin. */
export async function takeMobileDoomscrollingNotificationAction(): Promise<"mobile" | "limits" | null> {
  const result = await invoke<{ target: "mobile" | "limits" | null }>(
    `${PLUGIN_COMMAND}|takeNotificationAction`,
  );
  return result.target;
}

/** Build the bounded native projection from the durable shared configuration. */
export function buildMobileDoomscrollingSnapshot(
  config: DoomscrollingConfig,
  vaultId: string,
  generatedAtEpochMs = Date.now(),
  totals: readonly DoomscrollingLimitTotal[] = [],
): MobileDoomscrollingSnapshot {
  return {
    schemaVersion: 1,
    vaultId,
    revision: `${generatedAtEpochMs}-${crypto.randomUUID()}`,
    generatedAtEpochMs,
    mobile: config.mobile,
    limits: {
      enabled: config.limits.enabled,
      items: config.limits.items.map((limit) => ({
        id: limit.id,
        name: limit.name,
        enabled: limit.enabled,
        minutesPerDay: limit.minutesPerDay,
        minutesPerWeek: limit.minutesPerWeek ?? null,
        packages: [...new Set(limit.entries.flatMap((entry) => (
          entry.mobileAppPackage ? [entry.mobileAppPackage] : []
        )))],
        acceptedUsage: {
          day: acceptedUsage(totals, limit.id, "day"),
          week: acceptedUsage(totals, limit.id, "week"),
        },
      })).filter((limit) => limit.packages.length > 0),
    },
    copy: {
      channelName: translate("settings.doomscrolling.mobile.channelName"),
      channelDescription: translate("settings.doomscrolling.mobile.channelDescription"),
      blockedMessage: translate("settings.doomscrolling.mobile.blockedMessage"),
      limitMessage: translate("settings.doomscrolling.mobile.limitMessage"),
    },
  };
}

function acceptedUsage(
  totals: readonly DoomscrollingLimitTotal[],
  limitId: string,
  period: "day" | "week",
): MobileAcceptedUsage | null {
  const total = totals.find((candidate) => (
    candidate.limitId === limitId && (candidate.period ?? "day") === period
  ));
  if (!total?.windowStartLocalDate || !total.windowEndLocalDate) return null;
  return {
    windowStartLocalDate: total.windowStartLocalDate,
    windowEndLocalDate: total.windowEndLocalDate,
    usedSeconds: total.usedSeconds,
  };
}

/** Flush config first, then atomically replace the native rule projection. */
export async function publishMobileDoomscrollingConfig(config: DoomscrollingConfig): Promise<void> {
  await publishMobileDoomscrollingSnapshot(config, [], true);
}

/** Refresh native accepted counters while preserving offline local accumulation. */
export async function publishMobileDoomscrollingUsage(
  config: DoomscrollingConfig,
  totals: readonly DoomscrollingLimitTotal[],
): Promise<void> {
  await publishMobileDoomscrollingSnapshot(config, totals, false);
}

async function publishMobileDoomscrollingSnapshot(
  config: DoomscrollingConfig,
  totals: readonly DoomscrollingLimitTotal[],
  shouldFlushConfig: boolean,
): Promise<void> {
  if (__GANBARU_AI_BUILD_PLATFORM__ !== "android") return;
  const generation = ++publicationGeneration;
  if (shouldFlushConfig) await flushConfig();
  if (generation !== publicationGeneration) return;
  const vault = await getActiveVaultInfo();
  if (!vault) throw new Error("Cannot publish mobile Doomscrolling rules without an active data folder");
  const snapshot = buildMobileDoomscrollingSnapshot(config, vault.vaultId, Date.now(), totals);
  await invoke(`${PLUGIN_COMMAND}|applyRules`, { snapshotJson: JSON.stringify(snapshot) });
}
