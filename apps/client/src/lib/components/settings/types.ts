/**
 * Shared types for the Settings modal. Lives alongside `SettingsModal.svelte`
 * so external launchers (the calendar header, future feature surfaces) can
 * type their requests against the same identifier set.
 */
export type SectionId = "appearance" | "calendars" | "music" | "doomscrolling" | "shortcuts";

export type DoomscrollingSettingsTab = "browser" | "mobile" | "desktop";
