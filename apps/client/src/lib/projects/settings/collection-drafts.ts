import type { EventColor } from "$lib/calendar/types";
import type {
  ProjectPriorityConfig,
  ProjectStatus,
  ProjectStatusCategory,
  ProjectTag,
} from "$lib/projects/types";

export type ProjectSettingsDraftError = "name_required" | "name_exists";

export type ProjectSettingsDraftResult<T> =
  | { ok: true; drafts: T[] }
  | { ok: false; error: ProjectSettingsDraftError };

export interface ProjectSettingsStatusDraftState {
  nameDrafts: Readonly<Record<string, string>>;
  categoryDrafts: Readonly<Record<string, ProjectStatusCategory>>;
  colorDrafts: Readonly<Record<string, EventColor>>;
  fallbackColor: EventColor;
}

export interface ProjectSettingsPriorityDraftState {
  nameDrafts: Readonly<Record<string, string>>;
  colorDrafts: Readonly<Record<string, EventColor>>;
  fallbackColor: EventColor;
}

export interface ProjectSettingsTagDraftState {
  nameDrafts: Readonly<Record<string, string>>;
  colorDrafts: Readonly<Record<string, EventColor>>;
  fallbackColor: EventColor;
}

export interface ProjectSettingsStatusSaveDraft {
  status: ProjectStatus;
  name: string;
  category: ProjectStatusCategory;
  color: EventColor;
}

export interface ProjectSettingsPrioritySaveDraft {
  priority: ProjectPriorityConfig;
  name: string;
  color: EventColor;
}

export interface ProjectSettingsTagSaveDraft {
  tag: ProjectTag;
  name: string;
  color: EventColor;
}

function normalizedDraftName(value: string): string {
  return value.trim().toLowerCase();
}

export function projectSettingsStatusNameDraftValue(
  status: ProjectStatus,
  state: ProjectSettingsStatusDraftState,
): string {
  return state.nameDrafts[status.id] ?? status.name;
}

export function projectSettingsStatusCategoryDraftValue(
  status: ProjectStatus,
  state: ProjectSettingsStatusDraftState,
): ProjectStatusCategory {
  return state.categoryDrafts[status.id] ?? status.category;
}

export function projectSettingsStatusColorDraftValue(
  status: ProjectStatus,
  state: ProjectSettingsStatusDraftState,
): EventColor {
  return state.colorDrafts[status.id] ?? status.color ?? state.fallbackColor;
}

export function projectSettingsStatusDraftDirty(
  status: ProjectStatus,
  state: ProjectSettingsStatusDraftState,
): boolean {
  return projectSettingsStatusNameDraftValue(status, state) !== status.name
    || projectSettingsStatusCategoryDraftValue(status, state) !== status.category
    || projectSettingsStatusColorDraftValue(status, state) !== status.color;
}

export function projectSettingsStatusSaveDrafts(
  statuses: readonly ProjectStatus[],
  state: ProjectSettingsStatusDraftState,
): ProjectSettingsDraftResult<ProjectSettingsStatusSaveDraft> {
  const drafts: ProjectSettingsStatusSaveDraft[] = [];
  for (const status of statuses) {
    if (!projectSettingsStatusDraftDirty(status, state)) continue;
    const name = projectSettingsStatusNameDraftValue(status, state).trim();
    if (!name) return { ok: false, error: "name_required" };
    drafts.push({
      status,
      name,
      category: projectSettingsStatusCategoryDraftValue(status, state),
      color: projectSettingsStatusColorDraftValue(status, state),
    });
  }
  return { ok: true, drafts };
}

export function projectSettingsPriorityNameDraftValue(
  priority: ProjectPriorityConfig,
  state: ProjectSettingsPriorityDraftState,
): string {
  return state.nameDrafts[priority.id] ?? priority.name;
}

export function projectSettingsPriorityColorDraftValue(
  priority: ProjectPriorityConfig,
  state: ProjectSettingsPriorityDraftState,
): EventColor {
  return state.colorDrafts[priority.id] ?? priority.color ?? state.fallbackColor;
}

export function projectSettingsPriorityDraftDirty(
  priority: ProjectPriorityConfig,
  state: ProjectSettingsPriorityDraftState,
): boolean {
  return projectSettingsPriorityNameDraftValue(priority, state) !== priority.name
    || projectSettingsPriorityColorDraftValue(priority, state) !== priority.color;
}

export function projectSettingsPrioritySaveDrafts(
  priorities: readonly ProjectPriorityConfig[],
  state: ProjectSettingsPriorityDraftState,
): ProjectSettingsDraftResult<ProjectSettingsPrioritySaveDraft> {
  const drafts: ProjectSettingsPrioritySaveDraft[] = [];
  for (const priority of priorities) {
    if (!projectSettingsPriorityDraftDirty(priority, state)) continue;
    const name = projectSettingsPriorityNameDraftValue(priority, state).trim();
    if (!name) return { ok: false, error: "name_required" };
    drafts.push({
      priority,
      name,
      color: projectSettingsPriorityColorDraftValue(priority, state),
    });
  }
  return { ok: true, drafts };
}

export function projectSettingsTagNameDraftValue(
  tag: ProjectTag,
  state: ProjectSettingsTagDraftState,
): string {
  return state.nameDrafts[tag.id] ?? tag.name;
}

export function projectSettingsTagColorDraftValue(
  tag: ProjectTag,
  state: ProjectSettingsTagDraftState,
): EventColor {
  return state.colorDrafts[tag.id] ?? tag.color ?? state.fallbackColor;
}

export function projectSettingsTagDraftDirty(
  tag: ProjectTag,
  state: ProjectSettingsTagDraftState,
): boolean {
  return projectSettingsTagNameDraftValue(tag, state) !== tag.name
    || projectSettingsTagColorDraftValue(tag, state) !== (tag.color ?? state.fallbackColor);
}

export function projectSettingsTagNameExists(input: {
  tags: readonly ProjectTag[];
  name: string;
  ignoredTagId?: string;
}): boolean {
  const normalized = normalizedDraftName(input.name);
  if (!normalized) return false;
  return input.tags.some((tag) =>
    tag.id !== input.ignoredTagId && tag.name.trim().toLowerCase() === normalized
  );
}

export function projectSettingsTagSaveDrafts(
  tags: readonly ProjectTag[],
  state: ProjectSettingsTagDraftState,
): ProjectSettingsDraftResult<ProjectSettingsTagSaveDraft> {
  const drafts: ProjectSettingsTagSaveDraft[] = [];
  const seenNames = new Set<string>();
  for (const tag of tags) {
    const name = projectSettingsTagNameDraftValue(tag, state).trim();
    if (!name) return { ok: false, error: "name_required" };
    const normalizedName = normalizedDraftName(name);
    if (seenNames.has(normalizedName)) return { ok: false, error: "name_exists" };
    seenNames.add(normalizedName);
    if (!projectSettingsTagDraftDirty(tag, state)) continue;
    drafts.push({
      tag,
      name,
      color: projectSettingsTagColorDraftValue(tag, state),
    });
  }
  return { ok: true, drafts };
}
