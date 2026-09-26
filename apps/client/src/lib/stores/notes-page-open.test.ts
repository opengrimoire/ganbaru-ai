// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from "vitest";
import { createBlockWrite } from "$lib/notes/block-factory";
import type {
  NotesBlock,
  NotesAppendBlockChildrenRequest,
  NotesBlockFrontier,
  NotesPage,
  NotesPageOpenResponse,
  NotesWorkspaceShell,
} from "$lib/notes/types";

const backend = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; ids?: readonly string[] }>,
  pages: new Map<string, NotesPageOpenResponse>(),
  hydrated: new Map<string, NotesBlock>(),
  frontier: async (_ids: readonly string[]): Promise<NotesBlockFrontier> => ({ blocks: [] }),
  record(name: string, ids?: readonly string[]): void {
    this.calls.push({ name, ids });
  },
  count(name: string): number {
    return this.calls.filter((call) => call.name === name).length;
  },
  clear(): void {
    this.calls.length = 0;
  },
}));

vi.mock("$lib/vault/config", () => ({
  getConfigKey: (_key: string, fallback: unknown) => fallback,
  setConfigKey: vi.fn(),
}));

vi.mock("$lib/api/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/api/notes")>();
  const unresolved = (name: string) => {
    backend.record(name);
    return new Promise<never>(() => undefined);
  };
  return {
    ...actual,
    loadNotesWorkspaceShell: async (): Promise<NotesWorkspaceShell> => ({
      pages: [...backend.pages.values()].map((response) => response.page),
      folders: [],
      navigation_pages: [],
      navigation_folders: [],
      navigation_page_ids_with_children: [],
      page_ids_with_children: [],
      missing_parent_page_ids: [],
      trashed_parent_page_ids: [],
      resolved_selected_page_id: null,
      total_page_count: backend.pages.size,
      total_folder_count: 0,
      next_page_cursor: null,
      next_folder_cursor: null,
    }),
    appendNotesBlockChildren: async (request: NotesAppendBlockChildrenRequest) => {
      backend.record("append");
      if (request.parent.type !== "page_id") throw new Error("Expected a page paragraph");
      const current = backend.pages.get(request.parent.page_id);
      if (!current) throw new Error("Missing append parent");
      const blocks = request.children.map((write) => ({
        ...paragraph(write.id, request.parent), ...write,
      }) as NotesBlock);
      const updated = response(current.page.id, [...current.blocks.results, ...blocks]);
      backend.pages.set(current.page.id, updated);
      return { object: "list", type: "block", block: {}, results: blocks, next_cursor: null, has_more: false };
    },
    openNotesPage: async (pageId: string) => {
      backend.record("open");
      const response = backend.pages.get(pageId);
      if (!response) throw new Error("missing page fixture");
      return response;
    },
    getNotesBlockFrontier: async (ids: readonly string[]) => {
      backend.record("frontier", [...ids]);
      return backend.frontier(ids);
    },
    getNotesBlockOutlineFrontier: async (_pageId: string, ids: readonly string[]) => {
      backend.record("frontier", [...ids]);
      const result = await backend.frontier(ids);
      for (const block of result.blocks) backend.hydrated.set(block.id, block);
      return result.blocks.map((block, index) => ({
        id: block.id,
        page_id: block.parent.type === "page_id" ? block.parent.page_id : pageAId,
        parent: block.parent.type === "page_id" || block.parent.type === "block_id"
          ? block.parent
          : { type: "page_id" as const, page_id: pageAId },
        type: block.type,
        sort_order: (index + 1) * 1_000,
        has_children: block.has_children,
        retained_height: 36,
      }));
    },
    hydrateNotesBlocks: async (request: { block_ids: string[] }) => request.block_ids
      .map((id) => backend.hydrated.get(id))
      .filter((block): block is NotesBlock => block !== undefined),
    getNotesBlockChildren: async () => ({
      object: "list",
      type: "block",
      block: {},
      results: [],
      next_cursor: null,
      has_more: false,
    }),
    listNotesBacklinks: () => unresolved("backlinks"),
    listNotesPageAliases: () => unresolved("aliases"),
    listNotesUnresolvedLinks: () => unresolved("unresolved"),
    listNotesDestinationCandidates: () => unresolved("destinations"),
    listNotesComments: () => unresolved("comments"),
    listNotesSuggestions: () => unresolved("suggestions"),
    listNotesPageHistorySnapshots: () => unresolved("history"),
    loadNotesUndoState: () => unresolved("undo"),
  };
});

const pageAId = "10000000-0000-4000-8000-000000000001";
const pageBId = "10000000-0000-4000-8000-000000000002";
const topAId = "10000000-0000-4000-8000-000000000003";
const topBId = "10000000-0000-4000-8000-000000000004";
const childAId = "10000000-0000-4000-8000-000000000005";
const childBId = "10000000-0000-4000-8000-000000000006";
const nestedId = "10000000-0000-4000-8000-000000000007";
const staleId = "10000000-0000-4000-8000-000000000008";
const now = "2026-07-11T12:00:00.000Z";

function page(id: string): NotesPage {
  return {
    object: "page",
    id,
    created_time: now,
    last_edited_time: now,
    parent: { type: "workspace", workspace: true },
    folder_id: null,
    in_trash: false,
    archived: false,
    icon: null,
    cover: null,
    properties: { title: { id: "title", type: "title", title: [], plain_text: id } },
    url: null,
    public_url: null,
    source_provider: null,
    source_object_id: null,
    source_workspace_id: null,
    source_last_edited_time: null,
  };
}

function paragraph(id: string, parent: NotesBlock["parent"], hasChildren = false): NotesBlock {
  const write = createBlockWrite(id, "paragraph", id);
  if (write.type !== "paragraph") throw new Error("expected paragraph");
  return {
    object: "block",
    id,
    parent,
    created_time: now,
    last_edited_time: now,
    has_children: hasChildren,
    in_trash: false,
    archived: false,
    source_provider: null,
    source_object_id: null,
    source_last_edited_time: null,
    type: "paragraph",
    paragraph: write.paragraph,
  };
}

function response(pageId: string, blocks: NotesBlock[]): NotesPageOpenResponse {
  for (const block of blocks) backend.hydrated.set(block.id, block);
  return {
    page: page(pageId),
    breadcrumb: [{ id: pageId, title: pageId, current: true, status: "active" }],
    outlines: blocks.map((block, index) => ({
      id: block.id,
      page_id: pageId,
      parent: block.parent.type === "page_id" || block.parent.type === "block_id"
        ? block.parent
        : { type: "page_id", page_id: pageId },
      type: block.type,
      sort_order: (index + 1) * 1_000,
      has_children: block.has_children,
      retained_height: 36,
    })),
    blocks: {
      object: "list",
      type: "block",
      block: {},
      results: blocks,
      next_cursor: null,
      has_more: false,
    },
  };
}

describe("Notes critical page opening", () => {
  let notes: ReturnType<(typeof import("./notes.svelte"))["getNotes"]>;

  beforeAll(async () => {
    backend.pages.set(pageAId, response(pageAId, [
      paragraph(topAId, { type: "page_id", page_id: pageAId }, true),
      paragraph(topBId, { type: "page_id", page_id: pageAId }, true),
    ]));
    backend.pages.set(pageBId, response(pageBId, [
      paragraph(childBId, { type: "page_id", page_id: pageBId }),
    ]));
    notes = (await import("./notes.svelte")).getNotes();
    await notes.load();
  });

  it("makes content ready after one critical command while auxiliary promises stay unresolved", async () => {
    backend.frontier = async (ids) => ({
      blocks: ids.includes(topAId)
        ? [
            paragraph(childAId, { type: "block_id", block_id: topAId }, true),
            paragraph(childBId, { type: "block_id", block_id: topBId }),
          ]
        : [paragraph(nestedId, { type: "block_id", block_id: childAId })],
    });
    backend.clear();

    await notes.selectPage(pageAId);

    expect(notes.primaryContentReady).toBe(true);
    expect(notes.loadedPage?.id).toBe(pageAId);
    expect(Object.keys(notes.blocksById)).toContain(topAId);
    expect(backend.count("open")).toBe(1);
    expect(backend.count("backlinks")).toBe(0);
    expect(backend.count("aliases")).toBe(0);
    expect(backend.count("unresolved")).toBe(0);
    expect(backend.count("comments")).toBe(0);
    expect(backend.count("suggestions")).toBe(0);
    expect(backend.count("history")).toBe(0);
    expect(backend.count("undo")).toBe(0);

    await vi.waitFor(() => expect(backend.count("frontier")).toBe(2));
    expect(backend.calls.filter((call) => call.name === "frontier").map((call) => call.ids)).toEqual([
      [topAId, topBId],
      [childAId],
    ]);
    await vi.waitFor(() => expect(Object.keys(notes.blocksById)).toContain(nestedId));
  });

  it("ignores a late descendant frontier after switching pages", async () => {
    const frontierDeferred: {
      resolve?: (value: NotesBlockFrontier) => void;
    } = {};
    backend.frontier = () => new Promise((resolve) => {
      frontierDeferred.resolve = resolve;
    });
    await notes.selectPage(null);
    backend.clear();
    await notes.selectPage(pageAId);
    await vi.waitFor(() => expect(backend.count("frontier")).toBe(1));
    await notes.selectPage(pageBId);
    frontierDeferred.resolve?.({
      blocks: [paragraph(staleId, { type: "block_id", block_id: topAId })],
    });
    await Promise.resolve();

    expect(notes.selectedPageId).toBe(pageBId);
    expect(notes.loadedPage?.id).toBe(pageBId);
    expect(Object.keys(notes.blocksById)).not.toContain(staleId);
  });

  it("returns to the primary note after closing a contextual page", async () => {
    backend.frontier = async () => ({ blocks: [] });
    await notes.selectPage(pageAId, { openMode: "full" });

    await notes.openPageContextually(pageBId);

    expect(notes.selectedPageId).toBe(pageBId);
    expect(notes.pageOpenMode).toBe("center");

    await notes.closeContextualPage();

    expect(notes.selectedPageId).toBe(pageAId);
    expect(notes.pageOpenMode).toBe("full");
  });
  it("opens a previously emptied note with a writable body and persists that recovery only once", async () => {
    const emptyPageId = "10000000-0000-4000-8000-000000000009";
    backend.pages.set(emptyPageId, response(emptyPageId, []));
    backend.clear();
    await notes.selectPage(emptyPageId);
    expect(notes.primaryContentReady).toBe(true);
    expect(notes.flatBlocks).toHaveLength(1);
    const paragraphId = notes.flatBlocks[0].block.id;
    expect(notes.flatBlocks[0].block.type).toBe("paragraph");
    await vi.waitFor(() => expect(backend.count("append")).toBe(1));
    await notes.selectPage(pageBId);
    await notes.selectPage(emptyPageId);
    expect(notes.flatBlocks.map((item) => item.block.id)).toEqual([paragraphId]);
    expect(backend.count("append")).toBe(1);
  });

});
