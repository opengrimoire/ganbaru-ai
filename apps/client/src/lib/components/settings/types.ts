/**
 * Shared types for the Settings modal. Lives alongside `SettingsModal.svelte`
 * so external launchers (the calendar header, future feature surfaces) can
 * type their requests against the same identifier set.
 */
export type SectionId =
  | "appearance"
  | "calendars"
  | "focus"
  | "music"
  | "doomscrolling"
  | "data"
  | "updates"
  | "shortcuts"
  | "about";

export type DoomscrollingSettingsTab = "limits" | "browser" | "mobile" | "desktop";

export type DoomscrollingLimitEditorTarget =
  | { mode: "create" }
  | { mode: "edit"; limitId: string };
