// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotesFolder, NotesPage } from "$lib/notes/types";
import { createProvisionalNotesPage } from "$lib/notes/page-creation";
import NotesWorkspaceHeader from "./NotesWorkspaceHeader.svelte";

const notesState = vi.hoisted(() => ({
  store: {
    viewMode: "pages" as const,
    allPages: [] as NotesPage[],
    get navigationPages(): NotesPage[] { return this.allPages; },
    linkResolutionPages: [] as NotesPage[],
    folders: [] as NotesFolder[],
    sidebarPageIdsWithChildren: [] as string[],
    pageTitleDraftForPage: vi.fn((_pageId: string) => null),
    createPage: vi.fn(async () => undefined),
  },
}));

vi.mock("$lib/stores/notes.svelte", () => ({
  getNotes: () => notesState.store,
}));

vi.mock("$lib/stores/viewport.svelte", () => ({
  getViewport: () => ({ width: 1200, height: 800 }),
}));

const group = {
  id: "group-1",
  name: "Routine",
  icon: "repeat",
  sortOrder: 0,
  collapsed: false,
  createdAt: "2026-07-26T12:00:00.000Z",
  updatedAt: "2026-07-26T12:00:00.000Z",
};

const project = {
  id: "project-1",
  groupId: group.id,
  name: "Learning",
  icon: "graduation-cap",
  sortOrder: 0,
  status: "active" as const,
  defaultEventName: null,
  defaultEventTimeMode: "timed" as const,
  defaultEventDurationMinutes: null,
  defaultPomodoroMode: "preset" as const,
  defaultIdleSettingsSource: "global" as const,
  defaultIdlePauseEnabled: true,
  defaultIdleThresholdMinutes: 5 as const,
  createdAt: "2026-07-26T12:00:00.000Z",
  updatedAt: "2026-07-26T12:00:00.000Z",
};

const folder: NotesFolder = {
  object: "folder",
  id: "folder-1",
  project_id: project.id,
  parent_folder_id: null,
  name: "Lessons",
  created_time: "2026-07-26T12:00:00.000Z",
  last_edited_time: "2026-07-26T12:00:00.000Z",
};

const page: NotesPage = {
  object: "page",
  id: "page-1",
  created_time: "2026-07-26T12:00:00.000Z",
  last_edited_time: "2026-07-26T12:00:00.000Z",
  parent: { type: "workspace", workspace: true },
  folder_id: folder.id,
  in_trash: false,
  archived: false,
  icon: null,
  cover: null,
  properties: { __ganbaru_project_id: project.id },
  url: null,
  public_url: null,
  source_provider: null,
  source_object_id: null,
  source_workspace_id: null,
  source_last_edited_time: null,
};

describe("NotesWorkspaceHeader", () => {
  const mounted: { target: HTMLDivElement; component: ReturnType<typeof mount> }[] = [];

  afterEach(async () => {
    while (mounted.length > 0) {
      const entry = mounted.pop();
      if (!entry) continue;
      await unmount(entry.component);
      entry.target.remove();
    }
    notesState.store.allPages = [];
    notesState.store.linkResolutionPages = [];
    notesState.store.folders = [];
    vi.clearAllMocks();
  });

  function setup(explorerCollapsed: boolean, selectedPage = page, pages = [page]): HTMLDivElement {
    notesState.store.allPages = pages;
    notesState.store.folders = [folder];
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(NotesWorkspaceHeader, {
      target,
      props: {
        selectedProject: project,
        selectedGroup: group,
        selectedProjectId: project.id,
        selectedPage,
        explorerCollapsed,
        creationFolderId: folder.id,
        showInactiveProjects: false,
        onShowInactiveProjectsChange: vi.fn(),
        onProjectSelected: vi.fn(),
        onShowHome: vi.fn(),
        projectSettingsOpen: false,
        onToggleProjectSettings: vi.fn(),
      },
    });
    mounted.push({ target, component });
    return target;
  }

  it("places one navigator chevron after the final visible breadcrumb segment", () => {
    const expanded = setup(false);
    expect(expanded.querySelectorAll("[data-notes-context-chevron]")).toHaveLength(1);
    expect(expanded.querySelector("[data-notes-context-chevron]")?.closest("button")?.textContent).toContain("Learning");

    const collapsed = setup(true);
    expect(collapsed.querySelectorAll("[data-notes-context-chevron]")).toHaveLength(1);
    expect(collapsed.querySelector("[data-notes-context-chevron]")?.closest("button")?.textContent).toContain("Untitled");
  });

  it("shows group, project, main note, and sub-note in order with the sidebar collapsed", () => {
    const parent = createProvisionalNotesPage({
      id: "main", title: "Main note", first_block_id: "main-body", folder_id: null,
      parent: { type: "workspace", workspace: true }, properties: { __ganbaru_project_id: project.id },
    }).page;
    const child = createProvisionalNotesPage({
      id: "child", title: "Sub-note", first_block_id: "child-body", folder_id: null,
      parent: { type: "page_id", page_id: parent.id }, properties: parent.properties,
    }).page;
    const header = setup(true, child, [parent, child]);
    const labels = Array.from(header.querySelectorAll("button")).map((button) => button.textContent?.trim());
    expect(labels.filter((label) => ["Routine", "Learning", "Main note", "Sub-note"].includes(label ?? "")))
      .toEqual(["Routine", "Learning", "Main note", "Sub-note"]);
  });
});
