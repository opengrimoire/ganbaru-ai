// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyBlockUpdate, blockEditableRichText, blockPlainText, createBlockWrite } from "$lib/notes/block-factory";
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
  const restoreSelection = vi.fn();
  const error = vi.fn();
  const persistence = createNotesBlockPersistence({
    readBlock: (id) => projection.blocksById[id], beforeSave: async () => undefined,
    replaceBlock: (block) => projection.replaceBlock(block), setLoadError: error, debounceMs: 250,
  });
  projection.setLocalChangeMarker(persistence.markBlockLocallyChanged);
  const undo = createNotesUndoController({
    readSelectedPageId: () => pageId, readTreeState: () => projection.treeState(),
    loadPageTreeForUndo: async () => undefined, requestBlockFocus: focus,
    restoreDocumentSelection: restoreSelection,
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
  return { actions, undo, projection, persistence, stored, release, focus, error, restoreSelection };
}

afterEach(() => { vi.clearAllMocks(); });

describe("Notes editing with delayed persistence", () => {
  it.each(["", "Replacement"])("restores select-all after replacing it with %j and clears the range on redo", async (text) => {
    const h = editor();
    const selection = { anchor: { blockId: firstId, offset: 0 }, focus: { blockId: lastId, offset: Number.MAX_SAFE_INTEGER } };
    await h.actions.replaceDocumentRange([firstId, lastId], 0, Number.MAX_SAFE_INTEGER, text, undefined, selection);
    await h.undo.undo();
    expect(h.projection.childIdsByParentId[pageId]).toEqual([firstId, lastId]);
    expect(h.restoreSelection).toHaveBeenLastCalledWith(pageId, selection);
    await h.undo.redo();
    expect(h.restoreSelection).toHaveBeenLastCalledWith(pageId, null);
    expect(blockPlainText(h.projection.blocksById[firstId])).toBe(text);
    await h.undo.undo();
    expect(h.restoreSelection).toHaveBeenLastCalledWith(pageId, selection);
    h.release();
    await h.persistence.flushPendingBlockSaves();
  });

  it("preserves a backward partial selection through replacement and formatting history", async () => {
    const h = editor();
    const selection = { anchor: { blockId: lastId, offset: 2 }, focus: { blockId: firstId, offset: 5 } };
    await h.actions.replaceDocumentRange([firstId, lastId], 5, 2, "X", undefined, selection);
    await h.undo.undo();
    expect(h.restoreSelection).toHaveBeenLastCalledWith(pageId, selection);
    await h.actions.formatDocumentRange([firstId, lastId], 5, 2, "bold", selection);
    await h.undo.undo();
    expect(h.restoreSelection).toHaveBeenLastCalledWith(pageId, selection);
    await h.undo.redo();
    expect(h.restoreSelection).toHaveBeenLastCalledWith(pageId, selection);
    h.release();
    await h.persistence.flushPendingBlockSaves();
  });

  it("preserves the unselected children of a removed boundary block", async () => {
    const h = editor();
    const child = { ...fromWrite(createBlockWrite("child", "paragraph", "Keep me")), parent: { type: "block_id" as const, block_id: lastId } };
    h.projection.insertBlockAfter(child, null);
    h.stored.set(child.id, child);
    await h.actions.replaceDocumentRange([firstId, lastId], 5, 2, "");
    expect(blockPlainText(h.projection.blocksById[child.id])).toBe("Keep me");
    expect(h.projection.blocksById[child.id].parent).toEqual(parent);
    expect(h.projection.childIdsByParentId[pageId]).toEqual([firstId, child.id]);
    h.release();
    await h.persistence.flushPendingBlockSaves();
    expect(api.moveNotesBlock).toHaveBeenCalledWith(child.id, { parent, after: firstId, before: null });
    expect(api.moveNotesBlock.mock.invocationCallOrder[0]).toBeLessThan(api.trashNotesBlock.mock.invocationCallOrder[0]);
  });

  it("formats a partial document range as one undo step", async () => {
    const h = editor();
    await h.actions.formatDocumentRange([firstId, lastId], 5, 2, "bold");
    expect(blockEditableRichText(h.projection.blocksById[firstId]).map((run) => [run.plain_text, run.annotations.bold]))
      .toEqual([["First", false], ["Second", true]]);
    expect(blockEditableRichText(h.projection.blocksById[lastId]).map((run) => [run.plain_text, run.annotations.bold]))
      .toEqual([["La", true], ["st", false]]);
    await h.undo.undo();
    expect(blockEditableRichText(h.projection.blocksById[firstId]).every((run) => !run.annotations.bold)).toBe(true);
    expect(blockEditableRichText(h.projection.blocksById[lastId]).every((run) => !run.annotations.bold)).toBe(true);
    h.release();
    await h.persistence.flushPendingBlockSaves();
  });

  it("pastes sanitized rich text over a cross-block range without losing the suffix", async () => {
    const h = editor();
    await h.actions.replaceDocumentRange([firstId, lastId], 5, 2, "Bold", "<p><strong>Bold</strong></p>");
    expect(blockPlainText(h.projection.blocksById[firstId])).toBe("FirstBoldst");
    expect(blockEditableRichText(h.projection.blocksById[firstId]).find((run) => run.plain_text === "Bold")?.annotations.bold).toBe(true);
    h.release();
    await h.persistence.flushPendingBlockSaves();
  });

  it("replaces partial text across blocks immediately and restores both blocks with one undo", async () => {
    const h = editor();
    await h.actions.replaceDocumentRange([firstId, lastId], 5, 2, "X");
    expect(blockPlainText(h.projection.blocksById[firstId])).toBe("FirstXst");
    expect(h.projection.blocksById[lastId]).toBeUndefined();
    await h.undo.undo();
    expect(blockPlainText(h.projection.blocksById[firstId])).toBe("FirstSecond");
    expect(blockPlainText(h.projection.blocksById[lastId])).toBe("Last");
    h.release();
    await h.persistence.flushPendingBlockSaves();
    expect(blockPlainText(h.stored.get(firstId)!)).toBe("FirstSecond");
    expect(h.stored.get(lastId)?.in_trash).toBe(false);
  });

  it("replaces a document range with multiple lines and preserves the trailing text", async () => {
    const h = editor();
    await h.actions.replaceDocumentRange([firstId, lastId], 5, 2, "A\nB");
    const ids = h.projection.childIdsByParentId[pageId];
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => blockPlainText(h.projection.blocksById[id]))).toEqual(["FirstA", "Bst"]);
    await h.actions.updateBlockText(ids[1], "B typed st");
    h.release();
    await h.persistence.flushPendingBlockSaves();
    expect(blockPlainText(h.stored.get(ids[1])!)).toBe("B typed st");
  });

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
