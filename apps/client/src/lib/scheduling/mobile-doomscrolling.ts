import { invoke } from "@tauri-apps/api/core";
import { translate } from "$lib/i18n/translator.svelte";
import { flushConfig } from "$lib/vault/config";

const PLUGIN_COMMAND = "plugin:ganbaru-mobile-doomscrolling";

/** Persist settings and send localized text. Rust owns rule derivation and accounting. */
export async function publishMobileDoomscrollingConfig(): Promise<void> {
  if (__GANBARU_AI_BUILD_PLATFORM__ !== "android") return;
  await flushConfig();
  await invoke("doomscrolling_mobile_update_copy", {
    copy: {
      channelName: translate("settings.doomscrolling.mobile.channelName"),
      channelDescription: translate("settings.doomscrolling.mobile.channelDescription"),
      blockedMessage: translate("settings.doomscrolling.mobile.blockedMessage"),
      limitMessage: translate("settings.doomscrolling.mobile.limitMessage"),
    },
  });
}

export interface MobileDoomscrollingAccessStatus {
  usageAccess: boolean;
  accessibility: boolean;
}

export interface MobileDoomscrollingAppCandidate {
  name: string;
  packageName: string;
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

/** Consume a notification deep-link target captured by the Android plugin. */
export async function takeMobileDoomscrollingNotificationAction(): Promise<"mobile" | "limits" | null> {
  const result = await invoke<{ target: "mobile" | "limits" | null }>(
    `${PLUGIN_COMMAND}|takeNotificationAction`,
  );
  return result.target;
}
