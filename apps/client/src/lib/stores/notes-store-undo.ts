import {
  clearNotesUndoState,
  loadNotesUndoState,
  moveNotesBlock,
  saveNotesUndoState,
  trashNotesBlock,
  updateNotesBlock,
} from "$lib/api/notes";
import { blockUpdateFromBlock } from "$lib/notes/block-factory";
import { parentIdForBlock, type NotesTreeState } from "$lib/notes/block-tree";
import type { NotesDocumentSelection, NotesTextSelection } from "$lib/notes/editor-selection";
import {
  createNotesUndoSnapshot,
  createNotesUndoSnapshotForBlocks,
  parentIdsByDepth,
  parseNotesUndoStateJson,
  recordNotesUndoEntry,
  serializeNotesUndoState,
  trimNotesUndoStateToByteLimit,
  type NotesUndoEntry,
  type NotesUndoRecordOptions,
  type NotesUndoSnapshot,
  type NotesUndoState,
} from "$lib/notes/undo-history";
import type { NotesBlock } from "$lib/notes/types";

const EMPTY_UNDO_STATE: NotesUndoState = { undo: [], redo: [] };

export interface NotesUndoControllerContext {
  enqueueEditorMutation: (mutation: () => Promise<void>) => Promise<void>;
  readSelectedPageId: () => string | null;
  readTreeState: () => NotesTreeState;
  loadPageTreeForUndo: (pageId: string) => Promise<void>;
  requestBlockFocus: (
    blockId: string | null,
    selection?: NotesTextSelection | null,
  ) => void;
  restoreDocumentSelection?: (pageId: string, selection: NotesDocumentSelection | null) => void;
  flushPendingMutations: () => Promise<void>;
  applyLocalSnapshot: (target: NotesUndoSnapshot, source: NotesUndoSnapshot) => void;
}

export interface NotesUndoController {
  persist: () => Promise<void>;
  dispose: () => void;
  reset: (pageId: string | null) => void;
  hydrate: (pageId: string | null) => Promise<void>;
  snapshot: (
    focusBlockId: string | null,
    extraBlocks?: readonly NotesBlock[],
    focusSelection?: NotesTextSelection | null,
  ) => NotesUndoSnapshot | null;
  snapshotBlocks: (
    focusBlockId: string | null,
    blockIds: readonly string[],
    extraBlocks?: readonly NotesBlock[],
    focusSelection?: NotesTextSelection | null,
  ) => NotesUndoSnapshot | null;
  record: (options: Omit<NotesUndoRecordOptions, "id">) => void;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

function entryIdsByPresence(
  target: NotesUndoSnapshot,
  source: NotesUndoSnapshot,
): { targetOnlyRoots: NotesBlock[]; sourceOnlyRoots: NotesBlock[] } {
  const targetIds = new Set(target.blocks.map((block) => block.id));
  const sourceIds = new Set(source.blocks.map((block) => block.id));
  const targetOnlyIds = new Set([...targetIds].filter((blockId) => !sourceIds.has(blockId)));
  const sourceOnlyIds = new Set([...sourceIds].filter((blockId) => !targetIds.has(blockId)));
  return {
    targetOnlyRoots: target.blocks.filter((block) => {
      if (!targetOnlyIds.has(block.id)) return false;
      return !targetOnlyIds.has(parentIdForBlock(block));
    }),
    sourceOnlyRoots: source.blocks.filter((block) => {
      if (!sourceOnlyIds.has(block.id)) return false;
      return !sourceOnlyIds.has(parentIdForBlock(block));
    }),
  };
}

function snapshotBlocksById(snapshot: NotesUndoSnapshot): Map<string, NotesBlock> {
  return new Map(snapshot.blocks.map((block) => [block.id, block]));
}

function stackWithLimit(entries: readonly NotesUndoEntry[]): NotesUndoEntry[] {
  return entries.slice(-40);
}

async function applyUndoSnapshot(
  target: NotesUndoSnapshot,
  source: NotesUndoSnapshot,
): Promise<void> {
  const { targetOnlyRoots, sourceOnlyRoots } = entryIdsByPresence(target, source);
  for (const block of targetOnlyRoots) {
    await trashNotesBlock(block.id, false);
  }

  for (const block of target.blocks) {
    await updateNotesBlock(block.id, blockUpdateFromBlock(block));
  }

  const targetById = snapshotBlocksById(target);
  for (const parentId of parentIdsByDepth(target)) {
    if (JSON.stringify(target.childIdsByParentId[parentId]) === JSON.stringify(source.childIdsByParentId[parentId])) continue;
    let before: string | null = null;
    const childIds = [...(target.childIdsByParentId[parentId] ?? [])]
      .reverse();
    for (const childId of childIds) {
      const block = targetById.get(childId);
      if (!block) { before = childId; continue; }
      await moveNotesBlock(childId, {
        parent: block.parent,
        after: null,
        before,
      });
      before = childId;
    }
  }
  // Move surviving descendants before trashing a removed parent.
  for (const block of sourceOnlyRoots) {
    await trashNotesBlock(block.id, true);
  }
}

/**
 * Create per-page Notes undo and redo history with SQLite-backed recovery state.
 */
export function createNotesUndoController(
  context: NotesUndoControllerContext,
): NotesUndoController {
  let state: NotesUndoState = EMPTY_UNDO_STATE;
  let hydratedPageId: string | null = null;
  let hydrateRequestId = 0;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let mutationChain = Promise.resolve();

  function persistPageId(): string | null {
    return state.undo.at(-1)?.after.pageId
      ?? state.redo.at(-1)?.before.pageId
      ?? hydratedPageId;
  }

  async function persistNow(): Promise<void> {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    const pageId = persistPageId();
    if (!pageId) return;
    state = trimNotesUndoStateToByteLimit(state);
    try {
      if (state.undo.length === 0 && state.redo.length === 0) {
        await clearNotesUndoState(pageId);
        return;
      }
      await saveNotesUndoState(pageId, serializeNotesUndoState(state));
    } catch (error) {
      console.warn("persist notes undo recovery state failed", error);
    }
  }

  function schedulePersist(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void context.flushPendingMutations().then(persistNow)
        .catch((error: unknown) => console.warn("Notes history is waiting for unsaved edits", error));
    }, 250);
  }

  async function hydrate(pageId: string | null): Promise<void> {
    const requestId = ++hydrateRequestId;
    hydratedPageId = pageId;
    if (!pageId) {
      state = EMPTY_UNDO_STATE;
      return;
    }
    try {
      const stateJson = await loadNotesUndoState(pageId);
      if (requestId !== hydrateRequestId) return;
      state = stateJson
        ? trimNotesUndoStateToByteLimit(parseNotesUndoStateJson(stateJson))
        : EMPTY_UNDO_STATE;
    } catch (error) {
      if (requestId !== hydrateRequestId) return;
      state = EMPTY_UNDO_STATE;
      await clearNotesUndoState(pageId).catch(() => undefined);
      console.warn("hydrate notes undo recovery state failed", error);
    }
  }

  function reset(pageId: string | null): void {
    hydrateRequestId += 1;
    hydratedPageId = pageId;
    state = EMPTY_UNDO_STATE;
  }

  function snapshot(
    focusBlockId: string | null,
    extraBlocks: readonly NotesBlock[] = [],
    focusSelection: NotesTextSelection | null = null,
  ): NotesUndoSnapshot | null {
    return createNotesUndoSnapshot(
      context.readSelectedPageId(),
      context.readTreeState(),
      focusBlockId,
      extraBlocks,
      focusSelection,
    );
  }

  function snapshotBlocks(
    focusBlockId: string | null,
    blockIds: readonly string[],
    extraBlocks: readonly NotesBlock[] = [],
    focusSelection: NotesTextSelection | null = null,
  ): NotesUndoSnapshot | null {
    return createNotesUndoSnapshotForBlocks(
      context.readSelectedPageId(),
      context.readTreeState(),
      focusBlockId,
      blockIds,
      extraBlocks,
      focusSelection,
    );
  }

  function record(options: Omit<NotesUndoRecordOptions, "id">): void {
    hydrateRequestId += 1;
    state = recordNotesUndoEntry(state, {
      ...options,
      id: crypto.randomUUID(),
    });
    schedulePersist();
  }

  function applyEntry(entry: NotesUndoEntry, direction: "undo" | "redo"): void {
    const target = direction === "undo" ? entry.before : entry.after;
    const source = direction === "undo" ? entry.after : entry.before;
    context.applyLocalSnapshot(target, source);
    context.requestBlockFocus(target.focusBlockId, target.focusSelection);
    context.restoreDocumentSelection?.(target.pageId, target.documentSelection ?? null);
    const persistence = context.enqueueEditorMutation(() => applyUndoSnapshot(target, source));
    mutationChain = persistence;
    void persistence
      .then(() => mutationChain === persistence ? persistNow() : undefined)
      .catch((error: unknown) => {
        console.warn(`notes ${direction} persistence failed`, error);
      });
  }

  async function undo(): Promise<boolean> {
    const entry = state.undo.at(-1);
    if (!entry) return false;
    state = {
      undo: state.undo.slice(0, -1),
      redo: stackWithLimit([...state.redo, entry]),
    };
    applyEntry(entry, "undo");
    return true;
  }

  async function redo(): Promise<boolean> {
    const entry = state.redo.at(-1);
    if (!entry) return false;
    state = {
      undo: stackWithLimit([...state.undo, entry]),
      redo: state.redo.slice(0, -1),
    };
    applyEntry(entry, "redo");
    return true;
  }

  return {
    persist: persistNow,
    dispose: () => {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = null;
      hydrateRequestId += 1;
    },
    reset,
    hydrate,
    snapshot,
    snapshotBlocks,
    record,
    undo,
    redo,
    canUndo: () => state.undo.length > 0,
    canRedo: () => state.redo.length > 0,
  };
}
