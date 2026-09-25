import { afterEach, describe, expect, it, vi } from "vitest";
import { applyBlockUpdate, blockPlainText, createBlockWrite } from "$lib/notes/block-factory";
import { flattenNotesBlockTree } from "$lib/notes/block-tree";
import { notesBlockOutlineFromBlock } from "$lib/notes/block-outline";
import type { NotesAppendBlockChildrenRequest, NotesBlock, NotesBlockUpdate, NotesBlockWrite, NotesParent } from "$lib/notes/types";
import { createNotesBlockActions } from "./notes-store-block-actions";
import { createNotesBlockPersistence } from "./notes-store-persistence";
import { NotesTreeProjectionController } from "./notes-store-tree-projection.svelte";
import { createNotesUndoController } from "./notes-store-undo";

const api = vi.hoisted(() => ({
  updateNotesBlock: vi.fn(), appendNotesBlockChildren: vi.fn(), trashNotesBlock: vi.fn(),
  moveNotesBlock: vi.fn(), saveNotesUndoState: vi.fn(), clearNotesUndoState: vi.fn(),
}));
vi.mock("$lib/api/notes", () => api);
const pageId = "00000000-0000-4000-8000-000000000001";
const firstId = "00000000-0000-4000-8000-000000000002";
const lastId = "00000000-0000-4000-8000-000000000003";
const parent: NotesParent = { type: "page_id", page_id: pageId };

/** Creates persisted block fixtures using the production payload factory. */
function fromWrite(write: NotesBlockWrite): NotesBlock {
  return {
    object: "block", parent, created_time: "2026-09-24T00:00:00Z", last_edited_time: "2026-09-24T00:00:00Z",
    has_children: false, in_trash: false, source_provider: null, source_object_id: null, source_last_edited_time: null,
    ...write,
  } as NotesBlock;
}

/** Connects the real action, projection, persistence, and history controllers to delayed storage. */
function editor() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = fromWrite(createBlockWrite(firstId, "paragraph", "FirstSecond"));
  const last = fromWrite(createBlockWrite(lastId, "paragraph", "Last"));
  const stored = new Map([first, last].map((block) => [block.id, block]));
  api.updateNotesBlock.mockImplementation(async (id: string, update: NotesBlockUpdate) => {
    await gate;
    const block = stored.get(id);
    if (!block) throw new Error(`Missing block ${id}`);
    const saved = applyBlockUpdate(block, update);
    stored.set(id, saved);
    return saved;
  });
  api.appendNotesBlockChildren.mockImplementation(async (request: NotesAppendBlockChildrenRequest) => {
    await gate;
    const blocks = request.children.map(fromWrite);
    for (const block of blocks) stored.set(block.id, block);
    return { results: blocks };
  });
  api.trashNotesBlock.mockImplementation(async (id: string, inTrash: boolean) => {
    await gate;
    const block = stored.get(id);
    if (!block) throw new Error(`Missing block ${id}`);
    stored.set(id, { ...block, in_trash: inTrash });
  });
  api.moveNotesBlock.mockResolvedValue(undefined);
  const projection = new NotesTreeProjectionController({ readSelectedPageId: () => pageId });
  projection.blocksById = { [firstId]: first, [lastId]: last };
  projection.childIdsByParentId = { [pageId]: [firstId, lastId] };
  projection.syncHydratedOutlines(pageId);
  const focus = vi.fn();
  const error = vi.fn();
  const persistence = createNotesBlockPersistence({
    readBlock: (id) => projection.blocksById[id], beforeSave: async () => undefined,
    replaceBlock: (block) => projection.replaceBlock(block), setLoadError: error, debounceMs: 250,
  });
  projection.setLocalChangeMarker(persistence.markBlockLocallyChanged);
  const undo = createNotesUndoController({
    readSelectedPageId: () => pageId, readTreeState: () => projection.treeState(),
    loadPageTreeForUndo: async () => undefined, requestBlockFocus: focus,
    flushPendingMutations: persistence.flushPendingBlockSaves, enqueueEditorMutation: persistence.enqueueEditorMutation,
    applyLocalSnapshot: (target, source) => projection.applyLocalUndoSnapshot(target, source),
  });
  const actions = createNotesBlockActions({
    ...persistence, readSelectedPageId: () => pageId,
    readBlocksById: () => projection.blocksById, readChildIdsByParentId: () => projection.childIdsByParentId,
    treeState: () => projection.treeState(), outlineSubtreeIds: (ids) => [...ids],
    blockById: (id) => projection.blocksById[id],
    flatBlockItemsForBlockContext: () => flattenNotesBlockTree(projection.treeState(), pageId),
    tableRowsForBlock: () => [], columnItemsForBlock: () => [], tabItemsForBlock: () => [],
    setSidebarPageCollapsed: () => undefined, requestBlockFocus: focus,
    createChildPageFromBlock: async () => undefined, createChildPageAfterBlock: async () => undefined,
    loadPageTree: async () => { throw new Error("Must retain local draft"); }, refreshOpenLinks: async () => undefined,
    applyPostMutation: (result) => {
      projection.applyPostMutation(result);
      projection.blockOutlines = projection.blockOutlines.filter((outline) => !result.removedBlockIds?.includes(outline.id));
      projection.syncHydratedOutlines(pageId);
    },
    localInsertBlockAfter: (block, after) => projection.insertBlockAfter(block, after),
    localRemoveLeafBlock: (id) => projection.removeLeafBlock(id), awaitSelectedPageReady: async () => undefined,
    createUndoSnapshot: undo.snapshot, createUndoSnapshotForBlocks: undo.snapshotBlocks, recordUndo: undo.record,
  });
  return { actions, undo, projection, persistence, stored, release, focus, error };
}

afterEach(() => { vi.clearAllMocks(); });

describe("Notes editing with delayed persistence", () => {
  it("renders Enter in place immediately and retains subsequent typing after the append response", async () => {
    const e = editor();
    await e.actions.splitTextBlockAtSelection(firstId, 5, 5);
    const newId = e.projection.childIdsByParentId[pageId][1];
    expect(e.projection.flatBlockOutlines.map((item) => item.outline.id)).toEqual([firstId, newId, lastId]);
    await e.actions.updateBlockText(newId, "Second edited");
    e.release();
    await e.persistence.flushPendingBlockSaves();
    expect(blockPlainText(e.projection.blocksById[newId])).toBe("Second edited");
    expect(blockPlainText(e.stored.get(newId)!)).toBe("Second edited");
  });

  it("merges, splits, and undoes before storage responds without resurrecting stale text", async () => {
    const e = editor();
    await e.actions.splitTextBlockAtSelection(firstId, 5, 5);
    const newId = e.projection.childIdsByParentId[pageId][1];
    await e.actions.updateBlockText(newId, "Second edited");
    await e.actions.mergeBlockWithPrevious(newId);
    expect(e.projection.childIdsByParentId[pageId]).toEqual([firstId, lastId]);
    expect(blockPlainText(e.projection.blocksById[firstId])).toBe("FirstSecond edited");
    expect(e.focus).toHaveBeenLastCalledWith(firstId, { start: 5, end: 5 });
    await e.undo.undo();
    expect(e.projection.childIdsByParentId[pageId]).toEqual([firstId, newId, lastId]);
    await e.actions.updateBlockText(newId, "After undo");
    e.release();
    await e.persistence.flushPendingBlockSaves();
    expect(blockPlainText(e.stored.get(firstId)!)).toBe("First");
    expect(blockPlainText(e.stored.get(newId)!)).toBe("After undo");
    expect(e.stored.get(newId)?.in_trash).toBe(false);
    expect(blockPlainText(e.projection.blocksById[newId])).toBe("After undo");
  });

  it("preserves middle block order across grouped Enter undo and redo", async () => {
    const e = editor();
    await e.actions.splitTextBlockAtSelection(firstId, 5, 5);
    const second = e.projection.childIdsByParentId[pageId][1];
    await e.actions.splitTextBlockAtSelection(second, 3, 3);
    const expected = [...e.projection.childIdsByParentId[pageId]];
    await e.undo.undo();
    expect(e.projection.childIdsByParentId[pageId]).toEqual([firstId, lastId]);
    await e.undo.redo();
    expect(e.projection.childIdsByParentId[pageId]).toEqual(expected);
    expect(e.projection.flatBlockOutlines.map((item) => item.outline.id)).toEqual(expected);
    e.release();
    await e.persistence.flushPendingBlockSaves();
    expect(e.error).not.toHaveBeenCalled();
  });

  it("keeps unloaded siblings in the outline when inserting within a loaded window", () => {
    const e = editor();
    const unloaded = fromWrite(createBlockWrite(crypto.randomUUID(), "paragraph", "Unloaded"));
    e.projection.replaceOutlines([e.projection.blocksById[firstId], unloaded, e.projection.blocksById[lastId]]
      .map((block, index) => notesBlockOutlineFromBlock(block, pageId, index)), pageId);
    const inserted = fromWrite(createBlockWrite(crypto.randomUUID(), "paragraph", "New"));
    e.projection.insertBlockAfter(inserted, firstId);
    expect(e.projection.flatBlockOutlines.map((item) => item.outline.id)).toEqual([firstId, inserted.id, unloaded.id, lastId]);
    e.release();
  });
  it("preserves position when reading older typing snapshots without sibling order", () => {
    const e = editor();
    const before = e.undo.snapshotBlocks(firstId, [firstId]);
    if (!before) throw new Error("Expected snapshot");
    const legacy = { ...before, childIdsByParentId: {} };
    e.projection.applyLocalUndoSnapshot(legacy, legacy);
    expect(e.projection.childIdsByParentId[pageId]).toEqual([firstId, lastId]);
    e.release();
  });

});
