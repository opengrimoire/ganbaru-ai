/**
 * Shared types for the Settings modal. Lives alongside `SettingsModal.svelte`
 * so external launchers (the calendar header, future feature surfaces) can
 * type their requests against the same identifier set.
 */
export const SETTINGS_SECTION_IDS = [
  "appearance",
  "profile",
  "calendars",
  "projects",
  "notes",
  "chat",
  "focus",
  "music",
  "distractions",
  "data",
  "updates",
  "shortcuts",
  "about",
] as const;

export type SectionId = (typeof SETTINGS_SECTION_IDS)[number];

export type DistractionsSettingsTab = "limits" | "browser" | "mobile" | "desktop";
export type ChatSettingsSubsection = "teammates" | "providers" | "permissions" | "behavior";

export type DistractionsLimitEditorTarget =
  | { mode: "create" }
  | { mode: "edit"; limitId: string };

export const NOTES_TRANSFER_OPERATIONS = [
  "html-import",
  "notion-api-import",
  "notion-export-import",
  "json-graph-export",
] as const;

export type NotesTransferOperation = (typeof NOTES_TRANSFER_OPERATIONS)[number];

export type ChatProviderSetupTarget =
  | { mode: "create"; familyId: string }
  | { mode: "edit"; instanceId: string };

export const SETTINGS_DETAIL_KINDS = ["distractions-limit", "notes-transfer", "chat-provider"] as const;
export type SettingsDetailKind = (typeof SETTINGS_DETAIL_KINDS)[number];
