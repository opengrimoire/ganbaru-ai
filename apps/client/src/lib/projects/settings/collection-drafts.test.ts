import { describe, expect, it } from "vitest";
import {
  projectSettingsPriorityDraftDirty,
  projectSettingsPrioritySaveDrafts,
  projectSettingsStatusDraftDirty,
  projectSettingsStatusSaveDrafts,
  projectSettingsTagNameExists,
  projectSettingsTagSaveDrafts,
  type ProjectSettingsPriorityDraftState,
  type ProjectSettingsStatusDraftState,
  type ProjectSettingsTagDraftState,
} from "./collection-drafts";
import type {
  ProjectPriorityConfig,
  ProjectStatus,
  ProjectTag,
} from "$lib/projects/types";

function status(overrides: Partial<ProjectStatus> = {}): ProjectStatus {
  return {
    id: "status-1",
    projectId: "project-1",
    name: "Active",
    category: "active",
    color: 8,
    sortOrder: 1000,
    terminal: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function priority(overrides: Partial<ProjectPriorityConfig> = {}): ProjectPriorityConfig {
  return {
    id: "priority-1",
    projectId: "project-1",
    name: "Normal",
    color: 13,
    sortOrder: 1000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function tag(overrides: Partial<ProjectTag> = {}): ProjectTag {
  return {
    id: "tag-1",
    projectId: "project-1",
    name: "Research",
    color: 10,
    sortOrder: 1000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function statusState(
  overrides: Partial<ProjectSettingsStatusDraftState> = {},
): ProjectSettingsStatusDraftState {
  return {
    nameDrafts: {},
    categoryDrafts: {},
    colorDrafts: {},
    fallbackColor: 1,
    ...overrides,
  };
}

function priorityState(
  overrides: Partial<ProjectSettingsPriorityDraftState> = {},
): ProjectSettingsPriorityDraftState {
  return {
    nameDrafts: {},
    colorDrafts: {},
    fallbackColor: 1,
    ...overrides,
  };
}

function tagState(
  overrides: Partial<ProjectSettingsTagDraftState> = {},
): ProjectSettingsTagDraftState {
  return {
    nameDrafts: {},
    colorDrafts: {},
    fallbackColor: 1,
    ...overrides,
  };
}

describe("projectSettingsStatusSaveDrafts", () => {
  it("returns changed status drafts with trimmed names", () => {
    const active = status();
    const result = projectSettingsStatusSaveDrafts([
      active,
      status({ id: "status-2", name: "Done", category: "done", color: 9 }),
    ], statusState({
      nameDrafts: { "status-1": "  Started  " },
      categoryDrafts: { "status-1": "blocked" },
      colorDrafts: { "status-1": 11 },
    }));

    expect(result).toEqual({
      ok: true,
      drafts: [{ status: active, name: "Started", category: "blocked", color: 11 }],
    });
  });

  it("rejects a dirty status with a blank name", () => {
    expect(projectSettingsStatusSaveDrafts([
      status(),
    ], statusState({ nameDrafts: { "status-1": " " } }))).toEqual({
      ok: false,
      error: "name_required",
    });
  });

  it("detects changed status fields", () => {
    expect(projectSettingsStatusDraftDirty(status(), statusState())).toBe(false);
    expect(projectSettingsStatusDraftDirty(
      status(),
      statusState({ categoryDrafts: { "status-1": "done" } }),
    )).toBe(true);
  });
});

describe("projectSettingsPrioritySaveDrafts", () => {
  it("returns changed priority drafts with trimmed names", () => {
    const normal = priority();
    const result = projectSettingsPrioritySaveDrafts([
      normal,
      priority({ id: "priority-2", name: "Urgent", color: 14 }),
    ], priorityState({
      nameDrafts: { "priority-1": "  Focus  " },
      colorDrafts: { "priority-1": 12 },
    }));

    expect(result).toEqual({
      ok: true,
      drafts: [{ priority: normal, name: "Focus", color: 12 }],
    });
  });

  it("rejects a dirty priority with a blank name", () => {
    expect(projectSettingsPrioritySaveDrafts([
      priority(),
    ], priorityState({ nameDrafts: { "priority-1": "" } }))).toEqual({
      ok: false,
      error: "name_required",
    });
  });

  it("detects changed priority fields", () => {
    expect(projectSettingsPriorityDraftDirty(priority(), priorityState())).toBe(false);
    expect(projectSettingsPriorityDraftDirty(
      priority(),
      priorityState({ colorDrafts: { "priority-1": 12 } }),
    )).toBe(true);
  });
});

describe("projectSettingsTagSaveDrafts", () => {
  it("returns changed tag drafts and trims names", () => {
    const research = tag();
    const result = projectSettingsTagSaveDrafts([
      research,
      tag({ id: "tag-2", name: "Writing", color: 11 }),
    ], tagState({
      nameDrafts: { "tag-1": "  Reading  " },
      colorDrafts: { "tag-1": 12 },
    }));

    expect(result).toEqual({
      ok: true,
      drafts: [{ tag: research, name: "Reading", color: 12 }],
    });
  });

  it("rejects blank and duplicate tag draft names", () => {
    expect(projectSettingsTagSaveDrafts([
      tag(),
    ], tagState({ nameDrafts: { "tag-1": " " } }))).toEqual({
      ok: false,
      error: "name_required",
    });
    expect(projectSettingsTagSaveDrafts([
      tag(),
      tag({ id: "tag-2", name: "Writing" }),
    ], tagState({ nameDrafts: { "tag-2": " research " } }))).toEqual({
      ok: false,
      error: "name_exists",
    });
  });
});

describe("projectSettingsTagNameExists", () => {
  it("matches existing tag names case-insensitively", () => {
    expect(projectSettingsTagNameExists({
      tags: [tag()],
      name: " research ",
    })).toBe(true);
  });

  it("ignores blank names and the optional ignored tag", () => {
    expect(projectSettingsTagNameExists({
      tags: [tag()],
      name: " ",
    })).toBe(false);
    expect(projectSettingsTagNameExists({
      tags: [tag()],
      name: "Research",
      ignoredTagId: "tag-1",
    })).toBe(false);
  });
});
