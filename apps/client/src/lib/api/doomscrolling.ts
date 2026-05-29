import { invoke } from "@tauri-apps/api/core";
import type { PomodoroPhase } from "@ganbaru-ai/shared-types";

export interface DoomscrollingRuntimeState {
  active: boolean;
  phase: PomodoroPhase | "inactive";
  activeRunId: string | null;
  activeBlockId: string | null;
  remainingSeconds: number | null;
  updatedAt: string;
}

export interface DoomscrollingExtensionStatus {
  connected: boolean;
  lastSeenAt: string | null;
  lastMessageType: string | null;
  checkedAt: string;
  staleSeconds: number;
  reason: string | null;
}

export interface DoomscrollingDesktopAppCandidate {
  name: string;
  source: string;
  detail: string | null;
  processNames: string[];
}

export interface DoomscrollingDesktopAppRulePayload {
  name: string;
  matchNames: string[];
}

export interface DoomscrollingRunningDesktopAppMatch {
  appName: string;
  processName: string;
  processId: number;
}

export interface DoomscrollingUsageSamplePayload {
  id?: string;
  sourceType: "website" | "desktop-app" | "mobile-app";
  sourceKey: string;
  displayName: string | null;
  startedAt: number;
  elapsedSeconds: number;
  localDate: string;
}

export interface DoomscrollingUsageSampleRow {
  id: string;
  sourceType: "website" | "desktop-app" | "mobile-app";
  sourceKey: string;
  displayName: string | null;
  startedAt: number;
  elapsedSeconds: number;
  localDate: string;
  createdAt: number;
}

export interface DoomscrollingLimitStateItem {
  id: string;
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  exhausted: boolean;
}

export interface DoomscrollingLimitState {
  localDate: string;
  updatedAt: string;
  databaseFileName: "ganbaru-ai.db" | "ganbaru-ai-dev.db" | "ganbaru-ai-benchmark.db";
  limits: DoomscrollingLimitStateItem[];
}

export interface DoomscrollingForegroundDesktopAppStatus {
  available: boolean;
  appName: string | null;
  processName: string | null;
  processId: number | null;
  reason: string | null;
}

export async function writeDoomscrollingRuntimeState(
  state: DoomscrollingRuntimeState,
): Promise<void> {
  await invoke("doomscrolling_write_state", { state });
}

export async function getDoomscrollingExtensionStatus(
  freshAfter?: string,
): Promise<DoomscrollingExtensionStatus> {
  return await invoke<DoomscrollingExtensionStatus>(
    "doomscrolling_get_extension_status",
    { freshAfter: freshAfter ?? null },
  );
}

export async function listDoomscrollingDesktopApps(): Promise<DoomscrollingDesktopAppCandidate[]> {
  return await invoke<DoomscrollingDesktopAppCandidate[]>("doomscrolling_list_desktop_apps");
}

export async function listBlockedDoomscrollingDesktopAppMatches(
  apps: readonly DoomscrollingDesktopAppRulePayload[],
): Promise<DoomscrollingRunningDesktopAppMatch[]> {
  return await invoke<DoomscrollingRunningDesktopAppMatch[]>(
    "doomscrolling_list_blocked_desktop_app_matches",
    { apps },
  );
}

export async function closeDoomscrollingDesktopApp(processId: number): Promise<void> {
  await invoke("doomscrolling_close_desktop_app", { processId });
}

export async function showDoomscrollingDesktopBlockNotification(appName: string): Promise<void> {
  await invoke("show_doomscrolling_desktop_block_notification", { appName });
}

export async function recordDoomscrollingUsageSample(
  dbUrl: string,
  sample: DoomscrollingUsageSamplePayload,
): Promise<void> {
  await invoke("doomscrolling_record_usage_sample", { dbUrl, sample });
}

export async function listDoomscrollingUsageSamples(
  dbUrl: string,
  localDate: string,
): Promise<DoomscrollingUsageSampleRow[]> {
  return await invoke<DoomscrollingUsageSampleRow[]>(
    "doomscrolling_list_usage_samples",
    { dbUrl, localDate },
  );
}

export async function writeDoomscrollingLimitState(
  state: DoomscrollingLimitState,
): Promise<void> {
  await invoke("doomscrolling_write_limit_state", { state });
}

export async function getForegroundDoomscrollingDesktopApp(): Promise<DoomscrollingForegroundDesktopAppStatus> {
  return await invoke<DoomscrollingForegroundDesktopAppStatus>(
    "doomscrolling_get_foreground_desktop_app",
  );
}
