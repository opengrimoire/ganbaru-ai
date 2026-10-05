import type { SettingsDetailKind } from "$lib/settings/types";
import type { LoadedSettingsDetail } from "$lib/components/settings/detail-registry";

function unavailableDetail(kind: SettingsDetailKind): Promise<LoadedSettingsDetail> {
  return Promise.reject(new Error(`Settings detail ${kind} is unavailable on mobile.`));
}

let distractionsLimitLoaded = false;

/** Reject desktop-only settings detail surfaces without importing their component graphs. */
export function loadSettingsDetail(kind: SettingsDetailKind): Promise<LoadedSettingsDetail> {
  if (kind === "distractions-limit") {
    return import("$lib/components/settings/distractions/DistractionsLimitEditor.svelte").then((module) => ({
      kind: "distractions-limit" as const,
      component: module.default,
    })).then((loaded) => {
      distractionsLimitLoaded = true;
      return loaded;
    });
  }
  return unavailableDetail(kind);
}

/** Reject retries for settings detail surfaces that have no mobile implementation. */
export function retrySettingsDetail(kind: SettingsDetailKind): Promise<LoadedSettingsDetail> {
  return loadSettingsDetail(kind);
}

/** Mobile settings never cache a desktop-only detail surface. */
export function settingsDetailHasLoaded(kind: SettingsDetailKind): boolean {
  return kind === "distractions-limit" && distractionsLimitLoaded;
}
