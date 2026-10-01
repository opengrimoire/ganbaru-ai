// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type {
  NotesPage,
  NotesPageSummaryWindow,
  NotesSearchWindow,
  NotesWorkspaceShell,
} from "$lib/notes/types";

const backend = vi.hoisted(() => {
  function queue<T>() {
    const resolvers: Array<(value: T) => void> = [];
    return {
      next: vi.fn(() => new Promise<T>((resolve) => resolvers.push(resolve))),
      resolve(index: number, value: T): void {
        resolvers[index]?.(value);
      },
    };
  }
  return {
    archive: queue<NotesPageSummaryWindow>(),
    search: queue<NotesSearchWindow>(),
    destinations: queue<NotesWorkspaceShell>(),
  };
});

vi.mock("$lib/api/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/api/notes")>();
  return {
    ...actual,
    listArchivedNotesPages: backend.archive.next,
    listTrashedNotesPages: vi.fn(),
    searchNotes: backend.search.next,
    listNotesDestinationCandidates: backend.destinations.next,
  };
});

function destinationPage(id: string, folderId: string | null): NotesPage {
  return {
    object: "page",
    id,
    created_time: "2026-07-03T00:00:00.000Z",
    last_edited_time: "2026-07-03T00:00:00.000Z",
    parent: { type: "workspace", workspace: true },
    folder_id: folderId,
    in_trash: false,
    archived: false,
    icon: null,
    cover: null,
    properties: {},
    url: null,
    public_url: null,
    source_provider: null,
    source_object_id: null,
    source_workspace_id: null,
    source_last_edited_time: null,
  };
}

function destinationShell(pages: NotesPage[]): NotesWorkspaceShell {
  return {
    pages,
    folders: [],
    navigation_pages: [],
    navigation_folders: [],
    navigation_page_ids_with_children: [],
    navigation_databases: [],
    page_ids_with_children: [],
    missing_parent_page_ids: [],
    trashed_parent_page_ids: [],
    resolved_selected_page_id: null,
    total_page_count: pages.length,
    total_folder_count: 0,
    next_page_cursor: null,
    next_folder_cursor: null,
  };
}

describe("Notes query controllers", () => {
  it("rejects a stale archive reload", async () => {
    const { createNotesArchiveController } = await import("./notes-store-archive.svelte");
    const controller = createNotesArchiveController();
    const stale = controller.reloadArchivedPages("old");
    const current = controller.reloadArchivedPages("new");
    backend.archive.resolve(1, { pages: [], next_cursor: "current", total_count: 0 });
    await current;
    backend.archive.resolve(0, { pages: [], next_cursor: "stale", total_count: 0 });
    await stale;

    expect(controller.archiveHasMore).toBe(true);
    const more = controller.loadMoreArchivedPages();
    expect(backend.archive.next).toHaveBeenLastCalledWith({
      cursor: "current",
      query: "new",
    });
    backend.archive.resolve(2, { pages: [], next_cursor: null, total_count: 0 });
    await more;
  });

  it("rejects stale search results", async () => {
    const { createNotesSearchController } = await import("./notes-store-search.svelte");
    const controller = createNotesSearchController();
    const stale = controller.search("old");
    const current = controller.search("new");
    backend.search.resolve(1, { results: [], next_cursor: "current" });
    await current;
    backend.search.resolve(0, { results: [], next_cursor: "stale" });
    await stale;

    expect(controller.hasMore).toBe(true);
    const more = controller.loadMoreSearchResults();
    expect(backend.search.next).toHaveBeenLastCalledWith("new", 20, false, "current");
    backend.search.resolve(2, { results: [], next_cursor: null });
    await more;
  });

  it("keeps changed and removed pages current when a destination read finishes late", async () => {
    const { createNotesLinksController } = await import("./notes-store-links.svelte");
    const stale = destinationPage("page-a", "old-folder");
    const current = destinationPage("page-a", "new-folder");
    const extra = destinationPage("page-b", null);
    let workspacePages: NotesPage[] = [stale];
    const controller = createNotesLinksController({
      readSelectedPageId: () => null,
      readSelectedProjectId: () => "project-a",
      readAllPages: () => workspacePages,
      reloadSelectedPage: async () => undefined,
      scheduleVisibleMetadataRefresh: () => undefined,
    });

    const pending = controller.reloadLinkResolutionPages();
    workspacePages = [current];
    controller.reconcileDestinationPages([current], []);
    backend.destinations.resolve(0, destinationShell([stale, extra]));
    await pending;
    expect(controller.destinations).toEqual([current, extra]);

    const movedAgain = destinationPage("page-a", "latest-folder");
    workspacePages = [movedAgain];
    controller.reconcileDestinationPages([movedAgain], []);
    expect(controller.destinations).toEqual([movedAgain, extra]);

    workspacePages = [];
    controller.reconcileDestinationPages([], [current.id]);
    expect(controller.destinations).toEqual([extra]);
    const late = controller.reloadLinkResolutionPages();
    backend.destinations.resolve(1, destinationShell([stale, extra]));
    await late;
    expect(controller.destinations).toEqual([extra]);
  });
});
