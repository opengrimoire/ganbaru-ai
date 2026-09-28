import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotesWorkspaceShell } from "$lib/notes/types";

const backend = vi.hoisted(() => {
  const resolvers: Array<(shell: NotesWorkspaceShell) => void> = [];
  return {
    resolvers,
    load: vi.fn(() => new Promise<NotesWorkspaceShell>((resolve) => resolvers.push(resolve))),
  };
});

vi.mock("$lib/api/notes", () => ({
  loadNotesWorkspaceShell: backend.load,
}));

function shell(cursor: string): NotesWorkspaceShell {
  return {
    pages: [],
    folders: [],
    navigation_pages: [],
    navigation_folders: [],
    navigation_page_ids_with_children: [],
    page_ids_with_children: [],
    missing_parent_page_ids: [],
    trashed_parent_page_ids: [],
    resolved_selected_page_id: null,
    total_page_count: 0,
    total_folder_count: 0,
    next_page_cursor: cursor,
    next_folder_cursor: null,
  };
}

describe("Notes workspace reloads", () => {
  beforeEach(() => {
    backend.resolvers.length = 0;
    backend.load.mockClear();
  });

  it("rereads a shell that began before a local navigation mutation", async () => {
    const { createNotesWorkspaceController } = await import("./notes-store-workspace.svelte");
    let mutationRevision = 0;
    const mergeReloadedShell = vi.fn();
    const controller = createNotesWorkspaceController({
      readRequestState: () => ({
        projectId: "project-a",
        expandedPageIds: [],
        seedPageIds: [],
        selectedPageId: null,
      }),
      readNavigationMutationRevision: () => mutationRevision,
      prepareLoad: vi.fn(),
      applyInitialShell: () => null,
      applyAdditionalShell: vi.fn(),
      mergeReloadedShell,
      loadSelectedPage: async () => undefined,
      clearSelectedPageState: vi.fn(),
      readSelectedPageId: () => null,
    });

    const pending = controller.reloadPages();
    mutationRevision += 1;
    backend.resolvers[0]?.(shell("stale"));
    await vi.waitFor(() => expect(backend.load).toHaveBeenCalledTimes(2));
    expect(mergeReloadedShell).not.toHaveBeenCalled();

    const fresh = shell("fresh");
    backend.resolvers[1]?.(fresh);
    await pending;
    expect(mergeReloadedShell).toHaveBeenCalledExactlyOnceWith(fresh);
  });

  it("drops stale pagination results and resets its cursor from the fresh shell", async () => {
    const { createNotesWorkspaceController } = await import("./notes-store-workspace.svelte");
    let mutationRevision = 0;
    const applyAdditionalShell = vi.fn();
    const mergeReloadedShell = vi.fn();
    const controller = createNotesWorkspaceController({
      readRequestState: () => ({
        projectId: "project-a",
        expandedPageIds: [],
        seedPageIds: [],
        selectedPageId: null,
      }),
      readNavigationMutationRevision: () => mutationRevision,
      prepareLoad: vi.fn(),
      applyInitialShell: () => null,
      applyAdditionalShell,
      mergeReloadedShell,
      loadSelectedPage: async () => undefined,
      clearSelectedPageState: vi.fn(),
      readSelectedPageId: () => null,
    });

    const initial = controller.load();
    backend.resolvers[0]?.(shell("initial-next"));
    await initial;
    const pagination = controller.loadMoreWorkspaceWindow();
    mutationRevision += 1;
    backend.resolvers[1]?.(shell("stale-next"));
    await vi.waitFor(() => expect(backend.load).toHaveBeenCalledTimes(3));
    expect(applyAdditionalShell).not.toHaveBeenCalled();

    const fresh = shell("fresh-next");
    backend.resolvers[2]?.(fresh);
    await pagination;
    expect(mergeReloadedShell).toHaveBeenCalledExactlyOnceWith(fresh);
    expect(controller.totalPageCount).toBe(fresh.total_page_count);

    const nextPage = controller.loadMoreWorkspaceWindow();
    expect(backend.load).toHaveBeenLastCalledWith(expect.objectContaining({
      page_cursor: "fresh-next",
    }));
    backend.resolvers[3]?.(shell("end"));
    await nextPage;
  });
});
