/**
 * Cross-component launcher for the Settings modal.
 *
 * The modal itself is mounted once in `TitleBarOverlayHost.svelte`; any
 * component (the calendar header, the calendar sidebar popover, other feature
 * surfaces) can request that it open targeted at a specific section instead of having
 * to reach back into the title bar for state.
 *
 * The store deliberately exposes a tiny API: callers say `open("calendars")`
 * and the title bar reacts. The `targetSection` is only consumed when the
 * modal mounts; clearing it on `close()` keeps re-opens (gear icon) free of
 * stale targeting.
 */

import type { ChatSettingsSubsection, DistractionsSettingsTab, SectionId } from "$lib/settings/types";

interface SettingsLaunchOptions {
  distractionsTab?: DistractionsSettingsTab;
  chatSubsection?: ChatSettingsSubsection;
  chatTeammateId?: string;
  chatChannelId?: string;
  chatCreateTeammate?: boolean;
}

class SettingsLauncherStore {
  isOpen = $state(false);
  targetSection = $state<SectionId | undefined>(undefined);
  targetDistractionsTab = $state<DistractionsSettingsTab | undefined>(undefined);
  targetChatSubsection = $state<ChatSettingsSubsection | undefined>(undefined);
  targetChatTeammateId = $state<string | undefined>(undefined);
  targetChatChannelId = $state<string | undefined>(undefined);
  targetChatCreateTeammate = $state(false);

  /**
   * Request that the Settings modal open. Pass `section` to land on a
   * specific section; omit it to keep the previously selected section
   * (defaulting to Appearance on first open).
   */
  open(section?: SectionId, options: SettingsLaunchOptions = {}) {
    this.targetSection = section;
    this.targetDistractionsTab = section === "distractions"
      ? options.distractionsTab
      : undefined;
    this.targetChatSubsection = section === "chat" ? options.chatSubsection : undefined;
    this.targetChatTeammateId = section === "chat" ? options.chatTeammateId : undefined;
    this.targetChatChannelId = section === "chat" ? options.chatChannelId : undefined;
    this.targetChatCreateTeammate = section === "chat" ? options.chatCreateTeammate ?? false : false;
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
    this.targetSection = undefined;
    this.targetDistractionsTab = undefined;
    this.targetChatSubsection = undefined;
    this.targetChatTeammateId = undefined;
    this.targetChatChannelId = undefined;
    this.targetChatCreateTeammate = false;
  }
}

let store: SettingsLauncherStore | null = null;

export function getSettingsLauncher(): SettingsLauncherStore {
  if (!store) store = new SettingsLauncherStore();
  return store;
}
