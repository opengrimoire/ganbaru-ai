import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  blockPlainText,
  createBlockWrite,
} from "$lib/notes/block-factory";
import { buildNotesChildIdsByParent, type NotesTreeState } from "$lib/notes/block-tree";
import type { NotesTextSelection } from "$lib/notes/editor-selection";
import {
  createNotesUndoSnapshotForBlocks,
  type NotesUndoSnapshot,
} from "$lib/notes/undo-history";
import type { NotesBlock, NotesChildDatabaseBlock, NotesParent } from "$lib/notes/types";
import { createNotesUndoController } from "./notes-store-undo";

const notesApi = vi.hoisted(() => ({
  clearNotesUndoState: vi.fn(async () => undefined),
  loadNotesUndoState: vi.fn(async () => null),
  moveNotesBlock: vi.fn(async () => undefined),
  saveNotesUndoState: vi.fn(async () => undefined),
  trashNotesBlock: vi.fn(async () => undefined),
  updateNotesBlock: vi.fn(async () => undefined),
}));

vi.mock("$lib/api/notes", () => notesApi);

const blockId = "00000000-0000-4000-8000-000000000001";
const secondBlockId = "00000000-0000-4000-8000-000000000003";
const pageId = "00000000-0000-4000-8000-000000000002";
const parent: NotesParent = { type: "page_id", page_id: pageId };

function paragraph(text: string, id = blockId): NotesBlock {
  const write = createBlockWrite(id, "paragraph", text);
  if (write.type !== "paragraph") throw new Error("expected paragraph write");
  return {
    object: "block",
    id: write.id,
    parent,
    created_time: "2026-07-10T12:00:00.000Z",
    last_edited_time: "2026-07-10T12:00:00.000Z",
    has_children: false,
    in_trash: false,
    archived: false,
    source_provider: null,
    source_object_id: null,
    source_last_edited_time: null,
    type: "paragraph",
    paragraph: write.paragraph,
  };
}

function tree(block: NotesBlock): NotesTreeState {
  return {
    blocksById: { [block.id]: block },
    childIdsByParentId: buildNotesChildIdsByParent([block]),
  };
}

function treeFromBlocks(blocks: readonly NotesBlock[]): NotesTreeState {
  return {
    blocksById: Object.fromEntries(blocks.map((block) => [block.id, block])),
    childIdsByParentId: buildNotesChildIdsByParent(blocks),
  };
}

describe("notes undo controller", () => {
  beforeEach(() => vi.clearAllMocks());
  it("restores canonical database identities even when undo and redo were queued before creation finished", async () => {
    notesApi.updateNotesBlock.mockClear();
    const optimistic: NotesChildDatabaseBlock = { ...paragraph("", secondBlockId), type: "child_database", child_database: { title: "Historical title" } };
    const canonical: NotesChildDatabaseBlock = { ...optimistic, child_database: { title: "Saved title", database_id: secondBlockId, data_source_id: "source", view_id: "view" } };
    const before = createNotesUndoSnapshotForBlocks(pageId, treeFromBlocks([paragraph("")]), blockId, [blockId, secondBlockId]);
    const after = createNotesUndoSnapshotForBlocks(pageId, treeFromBlocks([paragraph(""), optimistic]), secondBlockId, [blockId, secondBlockId]);
    const queued: Array<() => Promise<void>> = [];
    const controller = createNotesUndoController({
      enqueueEditorMutation: (mutation) => { queued.push(mutation); return Promise.resolve(); },
      readSelectedPageId: () => pageId, readTreeState: () => treeFromBlocks([paragraph(""), optimistic]),
      loadPageTreeForUndo: async () => undefined, requestBlockFocus: () => undefined,
      flushPendingMutations: async () => undefined, applyLocalSnapshot: () => undefined,
    });
    controller.record({ kind: "paste", before, after });
    await controller.undo();
    await controller.redo();
    controller.reconcileDatabaseIdentity(canonical);
    for (const mutation of queued) await mutation();
    expect(notesApi.updateNotesBlock).toHaveBeenCalledWith(secondBlockId, {
      type: "child_database", child_database: { title: "Historical title", database_id: secondBlockId, data_source_id: "source", view_id: "view" },
    });
    controller.dispose();
  });
  it("applies typing undo locally before background persistence", async () => {
    let currentTree = tree(paragraph("ab"));
    let locallyAppliedText: string | null = null;
    let requestedSelection: NotesTextSelection | null = null;
    const loadPageTreeForUndo = vi.fn(async () => undefined);
    const controller = createNotesUndoController({
      enqueueEditorMutation: async (mutation) => { await Promise.resolve(); await mutation(); },
      readSelectedPageId: () => pageId,
      readTreeState: () => currentTree,
      loadPageTreeForUndo,
      requestBlockFocus: (_blockId, selection) => {
        requestedSelection = selection ?? null;
      },
      flushPendingMutations: async () => undefined,
      applyLocalSnapshot: (target) => {
        const block = target.blocks[0];
        if (!block) throw new Error("expected local undo block");
        currentTree = tree(block);
        locallyAppliedText = blockPlainText(block);
      },
    });
    const before = createNotesUndoSnapshotForBlocks(
      pageId,
      tree(paragraph("a")),
      blockId,
      [blockId],
      [],
      { start: 1, end: 1 },
    );
    const after = createNotesUndoSnapshotForBlocks(
      pageId,
      currentTree,
      blockId,
      [blockId],
      [],
      { start: 2, end: 2 },
    );
    if (!before || !after) throw new Error("expected undo snapshots");
    controller.record({ kind: "typing", before, after, groupKey: `typing:${blockId}` });

    const result = controller.undo();

    expect(locallyAppliedText).toBe("a");
    expect(requestedSelection).toEqual({ start: 1, end: 1 });
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(true);
    await expect(result).resolves.toBe(true);
    await vi.waitFor(() => expect(notesApi.updateNotesBlock).toHaveBeenCalledTimes(1));
    expect(loadPageTreeForUndo).toHaveBeenCalledTimes(0);

    await expect(controller.redo()).resolves.toBe(true);
    expect(locallyAppliedText).toBe("ab");
    expect(requestedSelection).toEqual({ start: 2, end: 2 });
  });

  it("removes and restores a row for Enter undo and redo", async () => {
    const first = paragraph("First");
    const second = paragraph("", secondBlockId);
    let currentTree = treeFromBlocks([first, second]);
    const applyLocalSnapshot = (
      target: NotesUndoSnapshot,
      source: NotesUndoSnapshot,
    ): void => {
      const targetIds = new Set(target.blocks.map((block) => block.id));
      const nextBlocks = { ...currentTree.blocksById };
      for (const block of source.blocks) {
        if (!targetIds.has(block.id)) delete nextBlocks[block.id];
      }
      for (const block of target.blocks) nextBlocks[block.id] = block;
      currentTree = treeFromBlocks(Object.values(nextBlocks));
    };
    const controller = createNotesUndoController({
      enqueueEditorMutation: async (mutation) => { await Promise.resolve(); await mutation(); },
      readSelectedPageId: () => pageId,
      readTreeState: () => currentTree,
      loadPageTreeForUndo: async () => undefined,
      requestBlockFocus: () => undefined,
      flushPendingMutations: async () => undefined,
      applyLocalSnapshot,
    });
    const before = createNotesUndoSnapshotForBlocks(
      pageId,
      treeFromBlocks([first]),
      blockId,
      [blockId],
    );
    const after = createNotesUndoSnapshotForBlocks(
      pageId,
      currentTree,
      secondBlockId,
      [blockId, secondBlockId],
    );
    if (!before || !after) throw new Error("expected Enter undo snapshots");
    controller.record({ kind: "create", before, after });

    await expect(controller.undo()).resolves.toBe(true);
    expect(Object.keys(currentTree.blocksById)).toEqual([blockId]);

    await expect(controller.redo()).resolves.toBe(true);
    expect(Object.keys(currentTree.blocksById)).toEqual([blockId, secondBlockId]);
  });

  it("reserves repeated undo and redo entries before background writes finish", async () => {
    let currentTree = tree(paragraph("abc"));
    const controller = createNotesUndoController({
      enqueueEditorMutation: async (mutation) => { await Promise.resolve(); await mutation(); },
      readSelectedPageId: () => pageId,
      readTreeState: () => currentTree,
      loadPageTreeForUndo: async () => undefined,
      requestBlockFocus: () => undefined,
      flushPendingMutations: async () => undefined,
      applyLocalSnapshot: (target) => {
        const block = target.blocks[0];
        if (!block) throw new Error("expected local history block");
        currentTree = tree(block);
      },
    });
    const snapshot = (text: string): NotesUndoSnapshot => {
      const value = createNotesUndoSnapshotForBlocks(
        pageId,
        tree(paragraph(text)),
        blockId,
        [blockId],
      );
      if (!value) throw new Error("expected history snapshot");
      return value;
    };
    controller.record({ kind: "update", before: snapshot("a"), after: snapshot("ab") });
    controller.record({ kind: "update", before: snapshot("ab"), after: snapshot("abc") });

    const firstUndo = controller.undo();
    const secondUndo = controller.undo();

    expect(blockPlainText(currentTree.blocksById[blockId])).toBe("a");
    await expect(Promise.all([firstUndo, secondUndo])).resolves.toEqual([true, true]);

    const firstRedo = controller.redo();
    const secondRedo = controller.redo();

    expect(blockPlainText(currentTree.blocksById[blockId])).toBe("abc");
    await expect(Promise.all([firstRedo, secondRedo])).resolves.toEqual([true, true]);
  });
  it("moves surviving children before trashing their previous parent during history replay", async () => {
    const childId = "00000000-0000-4000-8000-000000000004";
    const child = { ...paragraph("Child", childId), parent: { type: "block_id" as const, block_id: secondBlockId } };
    const restored: NotesUndoSnapshot = {
      pageId, blocks: [paragraph("First"), paragraph("Second", secondBlockId), child],
      childIdsByParentId: { [pageId]: [blockId, secondBlockId], [secondBlockId]: [childId] },
      focusBlockId: secondBlockId, focusSelection: null,
    };
    const merged: NotesUndoSnapshot = {
      pageId, blocks: [paragraph("FirstSecond"), { ...child, parent: { type: "block_id", block_id: blockId } }],
      childIdsByParentId: { [pageId]: [blockId], [blockId]: [childId] },
      focusBlockId: blockId, focusSelection: null,
    };
    const events: string[] = [];
    notesApi.moveNotesBlock.mockImplementation(async (...args: unknown[]) => { events.push(`move:${args[0]}`); });
    notesApi.trashNotesBlock.mockImplementation(async (...args: unknown[]) => { events.push(`trash:${args[0]}`); });
    let persisted = Promise.resolve();
    const controller = createNotesUndoController({
      enqueueEditorMutation: (mutation) => { persisted = mutation(); return persisted; },
      readSelectedPageId: () => pageId, readTreeState: () => treeFromBlocks(restored.blocks),
      loadPageTreeForUndo: async () => undefined, requestBlockFocus: () => undefined,
      flushPendingMutations: async () => undefined, applyLocalSnapshot: () => undefined,
    });
    controller.record({ kind: "update", before: merged, after: restored });
    await controller.undo();
    await persisted;
    expect(events.indexOf(`move:${childId}`)).toBeGreaterThanOrEqual(0);
    expect(events.indexOf(`move:${childId}`)).toBeLessThan(events.indexOf(`trash:${secondBlockId}`));
  });

});
