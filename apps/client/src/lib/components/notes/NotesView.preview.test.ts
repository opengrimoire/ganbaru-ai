// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyBlockUpdate, blockPlainText, createBlockUpdate } from "$lib/notes/block-factory";
import { notesBlockOutlineFromBlock } from "$lib/notes/block-outline";
import { createProvisionalNotesPage } from "$lib/notes/page-creation";
import type { NotesBlockHydrationRequest, NotesBlockUpdate, NotesChildPageFromBlockCreate, NotesLocalUser, NotesPageCreate, NotesPageOpenResponse, NotesWorkspaceShell } from "$lib/notes/types";
import type { NotesPageOpenMode } from "$lib/notes/page-open-mode";

const backend = vi.hoisted(() => ({
  pages: new Map<string, NotesPageOpenResponse>(),
  open: vi.fn(), createChild: vi.fn(), createPage: vi.fn(), saveBlock: vi.fn(),
}));

vi.mock("$lib/api/notes", async (importOriginal) => ({
  ...await importOriginal<typeof import("$lib/api/notes")>(),
  openNotesPage: backend.open,
  createNotesChildPageFromBlock: backend.createChild,
  createNotesPage: backend.createPage,
  updateNotesBlock: backend.saveBlock,
  loadNotesWorkspaceShell: async (): Promise<NotesWorkspaceShell> => ({
    pages: [...backend.pages.values()].map(({ page }) => page), folders: [],
    navigation_pages: [], navigation_folders: [], navigation_page_ids_with_children: [],
    page_ids_with_children: [], missing_parent_page_ids: [], trashed_parent_page_ids: [],
    resolved_selected_page_id: null, total_page_count: backend.pages.size, total_folder_count: 0,
    next_page_cursor: null, next_folder_cursor: null,
  }),
  getNotesPageBreadcrumb: async (id: string) => backend.pages.get(id)!.breadcrumb,
  hydrateNotesBlocks: async (request: NotesBlockHydrationRequest) => backend.pages.get(request.page_id)!.blocks.results.filter((block) => request.block_ids.includes(block.id)),
  listNotesBacklinks: async () => [], listNotesPageAliases: async () => [], listNotesUnresolvedLinks: async () => [],
  listNotesComments: async () => [], listNotesSuggestions: async () => [], listNotesDataSources: async () => [],
  getNotesLocalUser: async (): Promise<NotesLocalUser> => ({
    object: "user", id: "local", display_name: "Local",
    created_time: "2026-09-28T12:00:00Z", last_edited_time: "2026-09-28T12:00:00Z",
  }),
  saveNotesUndoState: async () => undefined,
  loadNotesUndoState: async () => null,
  listNotesWorkingMarkdown: async () => ({ roots: [], unavailableWorkingFolderIds: [] }),
  listNotesDestinationCandidates: async () => ({ pages: [...backend.pages.values()].map(({ page }) => page), next_page_cursor: null }),
}));
vi.mock("$lib/stores/projects.svelte", () => {
  const group = { id: "group", name: "Group", icon: "folder" };
  const project = { id: "project", groupId: group.id, name: "Project", icon: "folder", status: "active" };
  const store = {
    loaded: true, selectedProjectId: project.id, selectedProject: project, selectedGroup: group,
    projects: [project], tasks: [], customEmojis: [], ensureLoaded: async () => undefined,
    projectById: (id: string) => id === project.id ? project : undefined,
  };
  return { getProjects: () => store };
});
vi.mock("$lib/stores/calendar.svelte", () => ({ getCalendar: () => ({ loaded: true, rawBlocks: [] }) }));
vi.mock("$lib/stores/pomodoro.svelte", () => ({ getPomodoro: () => ({ activeRunId: null, formattedTime: "00:00" }) }));
vi.mock("$lib/vault/config", async (importOriginal) => ({
  ...await importOriginal<typeof import("$lib/vault/config")>(), setConfigKey: vi.fn(),
}));
vi.mock("$lib/stores/viewport.svelte", () => ({ getViewport: () => ({ width: 1200, height: 900 }) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

/** Build the same page, initial body, and outline contract returned by native page loading. */
function page(id: string, title: string, parentId?: string): NotesPageOpenResponse {
  const loaded = createProvisionalNotesPage({
    id, title, first_block_id: `${id}-body`, folder_id: null,
    parent: parentId ? { type: "page_id", page_id: parentId } : { type: "workspace", workspace: true },
    properties: { __ganbaru_project_id: "project" },
  });
  loaded.blocks.results[0] = applyBlockUpdate(loaded.blocks.results[0], createBlockUpdate("paragraph", `${title} content`));
  return {
    ...loaded,
    outlines: loaded.blocks.results.map((block, index) => notesBlockOutlineFromBlock(block, id, index)),
    breadcrumb: [
      ...(parentId ? [{ id: parentId, title: "Main note", current: false, status: "active" as const }] : []),
      { id, title, current: true, status: "active" },
    ],
  };
}

describe("Notes preview ownership", () => {
  let component: ReturnType<typeof mount> | undefined;
  afterEach(async () => {
    if (component) await unmount(component);
    component = undefined;
    const { getNotes } = await import("$lib/stores/notes.svelte");
    await getNotes().selectPage(null);
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    backend.pages.clear();
  });

  async function setup(openMode: NotesPageOpenMode = "full") {
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    const parent = page("parent", "Main note");
    const child = page("child", "Sub-note", parent.page.id);
    const sibling = page("sibling", "Second sub-note", parent.page.id);
    parent.blocks.results.push(...[child, sibling].map(({ page: childPage }) => applyBlockUpdate(
      { ...parent.blocks.results[0], id: childPage.id }, createBlockUpdate("child_page", childPage.id === child.page.id ? "Sub-note" : "Second sub-note"),
    )));
    parent.outlines = parent.blocks.results.map((block, index) => notesBlockOutlineFromBlock(block, parent.page.id, index));
    backend.pages.set(parent.page.id, parent);
    backend.pages.set(child.page.id, child);
    backend.pages.set(sibling.page.id, sibling);
    backend.open.mockImplementation(async (id: string) => backend.pages.get(id)!);
    backend.createPage.mockImplementation(async (request: NotesPageCreate) => {
      const parentId = request.parent.type === "page_id" ? request.parent.page_id : undefined;
      const created = page(request.id, request.title, parentId);
      backend.pages.set(created.page.id, created);
      const owner = parentId ? backend.pages.get(parentId) : undefined;
      if (owner) owner.blocks.results.push(applyBlockUpdate(
        { ...owner.blocks.results[0], id: created.page.id }, createBlockUpdate("child_page", request.title),
      ));
      return created;
    });
    backend.saveBlock.mockImplementation(async (id: string, update: NotesBlockUpdate) => {
      const owner = [...backend.pages.values()].find((page) => page.blocks.results.some((block) => block.id === id));
      if (!owner) throw new Error("Missing block");
      const index = owner.blocks.results.findIndex((block) => block.id === id);
      const next = applyBlockUpdate(owner.blocks.results[index], update);
      owner.blocks.results[index] = next;
      return next;
    });
    const { getNotes } = await import("$lib/stores/notes.svelte");
    const notes = getNotes();
    await notes.load();
    await notes.selectPage(parent.page.id, { openMode });
    notes.explorerCollapsed = true;
    const { default: NotesView } = await import("./NotesView.svelte");
    component = mount(NotesView, { target: document.body });
    await tick(); await tick();
    return { notes, parent, child, sibling };
  }

  it.each(["center", "side"] as const)("keeps the main editor mounted when a %s preview opens and closes, without reloading it", async (mode) => {
    const { notes, parent, child } = await setup();
    const mainViewport = document.querySelector<HTMLElement>("[data-notes-editor-scroll]")!;
    mainViewport.scrollTop = 240;
    mainViewport.dispatchEvent(new Event("scroll"));
    await notes.selectPage(child.page.id, { openMode: mode });
    await tick(); await tick();
    const background = document.querySelector("[data-notes-main-page]")!;
    expect((background as HTMLElement).inert).toBe(mode === "center");
    expect(background.querySelector("[data-notes-editor-scroll]")).toBe(mainViewport);
    expect(background.textContent).toContain("Main note content");
    expect(background.textContent).not.toContain("Sub-note content");
    expect(document.querySelector("[data-notes-page-peek]")?.textContent).toContain("Sub-note content");
    const path = document.querySelector("[data-notes-workspace-header]")!.textContent!;
    expect(path).toContain("Main note");
    expect(path.indexOf("Sub-note")).toBeGreaterThan(path.indexOf("Main note"));
    notes.focusBlock(child.blocks.results[0].id);
    await tick(); await tick();
    expect(background.contains(document.activeElement)).toBe(false);
    await notes.closeContextualPage();
    await tick(); await tick();
    expect(notes.selectedPageId).toBe(parent.page.id);
    expect(document.querySelector("[data-notes-page-peek]")).toBeNull();
    expect(document.querySelector<HTMLElement>("[data-notes-editor-scroll]")?.scrollTop).toBe(240);
    expect(document.querySelector("[data-notes-editor-scroll]")).toBe(mainViewport);
    expect(backend.open.mock.calls.filter(([id]) => id === parent.page.id)).toHaveLength(1);
    expect(document.querySelector("[data-notes-workspace-header]")?.textContent).not.toContain("Sub-note");
    expect(backend.saveBlock).not.toHaveBeenCalled();
  }, 15_000);

  it("converts the child row in its owning main editor and keeps that editor through further preview navigation", async () => {
    const { notes, parent } = await setup();
    const retained = notes.editorPanes[0].store;
    backend.createChild.mockImplementation(async (id: string, request: NotesChildPageFromBlockCreate) => {
      const created = page(id, request.title ?? "", parent.page.id);
      backend.pages.set(id, created);
      return created;
    });
    await notes.convertBlock(parent.blocks.results[0].id, "child_page", true);
    await tick(); await tick();
    expect(retained.selectedPageId).toBe(parent.page.id);
    expect(retained.blockById(parent.blocks.results[0].id)?.type).toBe("child_page");
    expect(document.querySelector("[data-notes-main-page] button[data-notes-atomic-block]")).not.toBeNull();
    await notes.selectPage("child", { openMode: "side" });
    await tick();
    expect(notes.editorPanes[0].store).toBe(retained);
    const previewViewport = document.querySelector("[data-notes-page-peek] [data-notes-editor-scroll]");
    await notes.showPaneAs(notes.activePaneId, "full");
    await tick();
    expect(notes.editorPanes).toHaveLength(1);
    expect(notes.editorPanes[0].store).not.toBe(retained);
    expect(document.querySelector("[data-notes-editor-scroll]")).toBe(previewViewport);
  });

  it.each(["center", "side"] as const)("retains a main note originally opened in %s mode when opening its child", async (mode) => {
    const { notes, parent, child } = await setup(mode);
    const mainViewport = document.querySelector("[data-notes-editor-scroll]");
    expect(notes.editorPanes).toHaveLength(1);
    await notes.openPageContextually(child.page.id);
    await tick(); await tick();
    expect(document.querySelector("[data-notes-main-page]")?.textContent).toContain("Main note content");
    expect(document.querySelector("[data-notes-page-peek]")?.textContent).toContain("Sub-note content");
    await notes.closeContextualPage();
    expect(notes.selectedPageId).toBe(parent.page.id);
    expect(notes.pageOpenMode).toBe("full");
    expect(document.querySelector("[data-notes-main-page] [data-notes-editor-scroll]")).toBe(mainViewport);
  });

  it("keeps the parent visible and the preview closable while loading and after a load failure", async () => {
    const { notes, parent, child } = await setup();
    let rejectLoad!: (error: Error) => void;
    backend.open.mockImplementationOnce(() => new Promise<never>((_resolve, reject) => { rejectLoad = reject; }));
    const opening = notes.openPageContextually(child.page.id);
    const failure = expect(opening).rejects.toThrow("Read failed");
    await vi.waitFor(() => expect(document.querySelector("[data-notes-page-peek] [aria-busy='true']")).not.toBeNull());
    expect(document.querySelector("[data-notes-main-page]")?.textContent).toContain("Main note content");
    rejectLoad(new Error("Read failed"));
    await failure; await tick();
    expect(document.querySelector("[data-notes-page-peek] [role='alert']")?.textContent).toContain("Read failed");
    document.querySelector<HTMLButtonElement>("[data-notes-page-peek] button")!.click();
    await vi.waitFor(() => {
      expect(notes.selectedPageId).toBe(parent.page.id);
      expect(notes.loadedPage?.id).toBe(parent.page.id);
      expect(notes.primaryContentReady).toBe(true);
    });
  });

  it("shows only the active note's ancestors while switching between two sibling previews and the main pane", async () => {
    const { notes, child, sibling } = await setup();
    const header = () => document.querySelector("[data-notes-workspace-header]")!.textContent!;
    expect(header()).toContain("Main note");
    expect(header()).not.toContain("Sub-note");
    expect(header()).not.toContain("Second sub-note");
    await notes.openPageContextually(child.page.id);
    await tick();
    expect(header()).toContain("Main note");
    expect(header()).toContain("Sub-note");
    expect(header()).not.toContain("Second sub-note");
    await notes.selectPage(sibling.page.id, { openMode: "side" });
    await tick();
    expect(header()).toContain("Main note");
    expect(header()).toContain("Second sub-note");
    expect(header()).not.toContain("Sub-note");
    document.querySelector<HTMLElement>("[data-notes-main-page] [contenteditable='true']")!.focus();
    await tick();
    expect(notes.activePaneId).toBe(notes.mainPaneId);
    expect(header()).not.toContain("Second sub-note");
    document.querySelector<HTMLElement>("[data-notes-page-peek] [contenteditable='true']")!.focus();
    await tick();
    expect(header()).toContain("Second sub-note");
    await notes.closeContextualPage();
    await tick();
    expect(header()).not.toContain("Second sub-note");
    expect(header()).not.toContain("Sub-note");
  });

  it("edits both side panes in their own documents and keeps undo history scoped to its editor", async () => {
    const { notes, parent, child } = await setup();
    const main = notes.editorPanes[0].store;
    await notes.selectPage(child.page.id, { openMode: "side" });
    await tick(); await tick();
    const preview = notes.previewPane!.store;
    const mainInput = document.querySelector<HTMLElement>("[data-notes-main-page] [contenteditable='true']")!;
    const childInput = document.querySelector<HTMLElement>("[data-notes-page-peek] [contenteditable='true']")!;
    for (const [input, text] of [[mainInput, "Edited main"], [childInput, "Edited child"]] as const) {
      input.focus();
      input.textContent = text;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
      await tick();
    }
    await notes.flushPendingWrites();
    expect(blockPlainText(main.blockById(parent.blocks.results[0].id)!)).toBe("Edited main");
    expect(blockPlainText(preview.blockById(child.blocks.results[0].id)!)).toBe("Edited child");
    expect(backend.saveBlock.mock.calls.map(([id]) => id)).toEqual(expect.arrayContaining(["parent-body", "child-body"]));
    expect(main.canUndoNotesEdit).toBe(true);
    expect(preview.canUndoNotesEdit).toBe(true);
    mainInput.focus();
    await notes.undoNotesEdit();
    await tick();
    expect(blockPlainText(main.blockById("parent-body")!)).toBe("Main note content");
    expect(blockPlainText(preview.blockById("child-body")!)).toBe("Edited child");
    await notes.closeContextualPage();
    await tick();
    expect(document.querySelector("[data-notes-main-page] [contenteditable='true']")).toBe(mainInput);
    expect(main.canRedoNotesEdit).toBe(true);
  });

  it("creates another child under the main page while a sibling preview is open", async () => {
    const { notes, parent, child } = await setup();
    const main = notes.editorPanes[0].store;
    await notes.selectPage(child.page.id, { openMode: "side" });
    await tick();
    const mainInput = document.querySelector<HTMLElement>("[data-notes-main-page] [contenteditable='true']")!;
    mainInput.focus();
    backend.createChild.mockImplementation(async (id: string, request: NotesChildPageFromBlockCreate) => {
      const created = page(id, request.title ?? "", parent.page.id);
      backend.pages.set(id, created);
      return created;
    });
    await main.convertBlock("parent-body", "child_page", true);
    await tick();
    expect(backend.createChild.mock.calls[0][0]).toBe("parent-body");
    expect(notes.loadedPage?.parent).toEqual({ type: "page_id", page_id: parent.page.id });
    expect(notes.editorPanes[0].store).toBe(main);
    expect(main.selectedPageId).toBe(parent.page.id);
    const header = document.querySelector("[data-notes-workspace-header]")!.textContent!;
    expect(header).toContain("Main note");
    expect(header).not.toContain("Sub-note");
    expect(header).not.toContain("Second sub-note");
  });

  it("keeps a preview draft open when closing cannot save it and leaves the main editor usable", async () => {
    const { notes, child } = await setup();
    const main = notes.editorPanes[0].store;
    await notes.selectPage(child.page.id, { openMode: "side" });
    const preview = notes.previewPane!;
    backend.saveBlock.mockRejectedValueOnce(new Error("Disk unavailable"));
    await preview.store.updateBlockText("child-body", "Unsaved child");
    await expect(notes.closeContextualPage()).rejects.toThrow("Disk unavailable");
    expect(notes.previewPane).toBe(preview);
    expect(blockPlainText(preview.store.blockById("child-body")!)).toBe("Unsaved child");
    await main.updateBlockText("parent-body", "Main remains editable");
    await main.flushPendingWrites();
    expect(main.editorSaveError).toBeNull();
    await preview.store.retryEditorMutations();
    await notes.closeContextualPage();
    expect(notes.previewPane).toBeNull();
  });

  it("inserts a new child row into the retained parent without reopening it", async () => {
    const { notes, parent } = await setup();
    const main = notes.editorPanes[0].store;
    await main.createSiblingAfter("parent-body", { kind: "block", blockType: "child_page" });
    const childId = notes.selectedPageId!;
    expect(main.blockById(childId)?.type).toBe("child_page");
    expect(main.childIdsByParentId[parent.page.id]).toEqual(["parent-body", childId, "child", "sibling"]);
    expect(backend.open.mock.calls.filter(([id]) => id === parent.page.id)).toHaveLength(1);
    await notes.closeContextualPage();
    await tick();
    expect(document.querySelectorAll("[data-notes-main-page] button[data-notes-atomic-block]")).toHaveLength(3);
  });

  it("returns to the mounted main editor when navigation explicitly opens it as a full page", async () => {
    const { notes, parent, child } = await setup();
    const viewport = document.querySelector("[data-notes-editor-scroll]");
    await notes.selectPage(child.page.id, { openMode: "side" });
    await notes.selectPage(parent.page.id, { openMode: "full" });
    await tick();
    expect(notes.previewPane).toBeNull();
    expect(notes.selectedPageId).toBe(parent.page.id);
    expect(document.querySelector("[data-notes-editor-scroll]")).toBe(viewport);
    expect(backend.open.mock.calls.filter(([id]) => id === parent.page.id)).toHaveLength(1);
  });
});
