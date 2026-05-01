/**
 * Cross-component launcher for the Settings modal.
 *
 * The modal itself is mounted once in `TitleBar.svelte`; any component (the
 * calendar header, the calendar sidebar popover, future feature surfaces)
 * can request that it open targeted at a specific section instead of having
 * to reach back into the title bar for state.
 *
 * The store deliberately exposes a tiny API: callers say `open("calendars")`
 * and the title bar reacts. The `targetSection` is only consumed when the
 * modal mounts; clearing it on `close()` keeps re-opens (gear icon) free of
 * stale targeting.
 */

import type { SectionId } from "$lib/components/settings/types";

class SettingsLauncherStore {
  isOpen = $state(false);
  targetSection = $state<SectionId | undefined>(undefined);

  /**
   * Request that the Settings modal open. Pass `section` to land on a
   * specific section; omit it to keep the previously selected section
   * (defaulting to Appearance on first open).
   */
  open(section?: SectionId) {
    this.targetSection = section;
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
    this.targetSection = undefined;
  }
}

let store: SettingsLauncherStore | null = null;

export function getSettingsLauncher(): SettingsLauncherStore {
  if (!store) store = new SettingsLauncherStore();
  return store;
}
