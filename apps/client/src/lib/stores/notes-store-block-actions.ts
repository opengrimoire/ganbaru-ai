import { createBlockWrite } from "$lib/notes/block-factory";
import type { NotesRichTextAnnotationName } from "$lib/notes/rich-text";
import { createNotesDocumentEdit, createNotesDocumentFormatting } from "./notes-store-document-edit";
import {
  appendNotesBlockChildren,
  duplicateNotesBlocks,
  moveNotesBlock,
  moveNotesBlocks,
  trashNotesBlock,
  trashNotesBlocks,
} from "$lib/api/notes";
import {
  collectLoadedBlockSubtreeIds,
} from "$lib/notes/block-duplicate";
import { cloneNotesJson } from "$lib/notes/json-clone";
import type { NotesDocumentSelection, NotesTextSelection } from "$lib/notes/editor-selection";
import type { NotesTreeState } from "$lib/notes/block-tree";
import {
  type NotesUndoKind,
  type NotesUndoRecordOptions,
  type NotesUndoSnapshot,
} from "$lib/notes/undo-history";
import type {
  NotesBlock,
  NotesAppendBlockChildrenRequest,
  NotesBlockTreeItem,
  NotesBlockUpdate,
  NotesBlockWrite,
  NotesMoveBlockRequest,
  NotesMoveBlocksRequest,
  NotesColumnBlockItems,
  NotesParent,
  NotesTabBlockItems,
  NotesTableRowBlock,
} from "$lib/notes/types";
import {
  createNotesColumnActions,
  type NotesColumnActions,
} from "$lib/stores/notes-store-column-actions";
import {
  createNotesTabActions,
  type NotesTabActions,
} from "$lib/stores/notes-store-tab-actions";
import {
  createNotesMediaBlockActions,
  invalidateReplacedNotesMediaAsset,
  type NotesMediaBlockActions,
} from "$lib/stores/notes-store-block-media-actions";
import {
  createNotesRichTextBlockActions,
  type NotesRichTextBlockActions,
} from "$lib/stores/notes-store-block-rich-text-actions";
import {
  createNotesTableBlockActions,
  type NotesTableBlockActions,
} from "$lib/stores/notes-store-block-table-actions";
import {
  createNotesTemplateBlockActions,
  type NotesTemplateBlockActions,
} from "$lib/stores/notes-store-block-template-actions";
import {
  createNotesBlockDuplicationActions,
  type NotesBlockDuplicationActions,
} from "$lib/stores/notes-store-block-duplication-actions";
import {
  createNotesBlockMovementActions,
  type NotesBlockMovementActions,
} from "$lib/stores/notes-store-block-movement-actions";
import {
  createNotesBlockPasteActions,
  type NotesBlockPasteActions,
} from "$lib/stores/notes-store-block-paste-actions";
import {
  createNotesStructuralBlockActions,
  type NotesStructuralBlockActions,
} from "$lib/stores/notes-store-block-structural-actions";
import {
  notesPostAppendResult,
  notesPostMoveManyResult,
  notesPostMoveResult,
  notesPostTrashResult,
  type NotesPostMutationResult,
} from "$lib/notes/post-mutation";
import { createNotesOptimisticWriteTracker } from "./notes-store-optimistic-writes";

export interface NotesBlockReadCapabilities {
  readSelectedPageId: () => string | null;
  /** Includes unloaded root outlines, so partial hydration never looks like an empty page. */
  readPageRootBlockIds: () => readonly string[];
  readBlocksById: () => Record<string, NotesBlock>;
  readChildIdsByParentId: () => Record<string, string[]>;
  treeState: () => NotesTreeState;
  outlineSubtreeIds: (rootBlockIds: readonly string[]) => string[];
  blockById: (blockId: string) => NotesBlock | undefined;
  flatBlockItemsForBlockContext: (blockId: string) => NotesBlockTreeItem[];
  tableRowsForBlock: (blockId: string) => NotesTableRowBlock[];
  columnItemsForBlock: (blockId: string) => NotesColumnBlockItems[];
  tabItemsForBlock: (blockId: string) => NotesTabBlockItems[];
}

export interface NotesBlockNavigationCapabilities {
  setSidebarPageCollapsed: (pageId: string, collapsed: boolean) => void;
  requestBlockFocus: (blockId: string | null, selection?: NotesTextSelection | null) => void;
  createChildPageFromBlock: (blockId: string) => Promise<void>;
  createChildPageAfterBlock: (blockId: string) => Promise<void>;
  loadPageTree: (pageId: string) => Promise<void>;
  refreshOpenLinks: () => Promise<void>;
}

export interface NotesBlockLocalMutationCapabilities {
  applyPostMutation: (result: NotesPostMutationResult) => void;
  localApplyBlockUpdate: (blockId: string, update: NotesBlockUpdate) => void;
  localInsertBlockAfter: (block: NotesBlock, afterBlockId: string | null) => void;
  localRemoveLeafBlock: (blockId: string) => boolean;
}

export interface NotesBlockPersistenceCapabilities {
  enqueueEditorMutation: (mutation: () => Promise<void>) => Promise<void>;
  awaitSelectedPageReady: () => Promise<void>;
  saveBlockNow: (blockId: string, update: NotesBlockUpdate) => Promise<void>;
  scheduleBlockSave: (blockId: string, update: NotesBlockUpdate) => void;
  flushBlockSave: (blockId: string) => Promise<void>;
  flushPendingBlockSaves: () => Promise<void>;
}

export interface NotesBlockUndoCapabilities {
  createUndoSnapshot: (
    focusBlockId: string | null,
    extraBlocks?: readonly NotesBlock[],
    focusSelection?: NotesTextSelection | null,
  ) => NotesUndoSnapshot | null;
  createUndoSnapshotForBlocks: (
    focusBlockId: string | null,
    blockIds: readonly string[],
    extraBlocks?: readonly NotesBlock[],
    focusSelection?: NotesTextSelection | null,
  ) => NotesUndoSnapshot | null;
  recordUndo: (options: Omit<NotesUndoRecordOptions, "id">) => void;
}

export interface NotesBlockActionsContext
  extends NotesBlockReadCapabilities,
    NotesBlockNavigationCapabilities,
    NotesBlockLocalMutationCapabilities,
    NotesBlockPersistenceCapabilities,
    NotesBlockUndoCapabilities {}

export interface NotesBlockActions
  extends NotesColumnActions,
    NotesTabActions,
    NotesMediaBlockActions,
    NotesRichTextBlockActions,
    NotesTableBlockActions,
    NotesTemplateBlockActions,
    NotesBlockDuplicationActions,
    NotesBlockMovementActions,
    NotesBlockPasteActions,
    NotesStructuralBlockActions {
  formatDocumentRange: (ids: readonly string[], start: number, end: number, annotation: NotesRichTextAnnotationName, documentSelection?: NotesDocumentSelection) => Promise<void>;
  replaceDocumentRange: (ids: readonly string[], start: number, end: number, text: string, html?: string, documentSelection?: NotesDocumentSelection) => Promise<void>;
  flushOptimisticBlockWrites: () => Promise<void>;
  ensurePageBody: (pageId: string) => string | null;
}

/**
 * Create Notes block mutation and UI action methods.
 */
export function createNotesBlockActions(context: NotesBlockActionsContext): NotesBlockActions {
  const optimisticWrites = createNotesOptimisticWriteTracker();
  const trackOptimisticBlockWrites = optimisticWrites.track;
  const enqueueEditorMutation = (mutation: () => Promise<void>) => context.enqueueEditorMutation(async () => {
    await context.awaitSelectedPageReady();
    await mutation();
  });

  async function flushOptimisticBlockWrites(): Promise<void> {
    await optimisticWrites.flush();
  }

  function optimisticBlockFromWrite(write: NotesBlockWrite, parent: NotesParent): NotesBlock {
    const now = new Date().toISOString();
    const plainWrite = cloneNotesJson(write);
    const plainParent = cloneNotesJson(parent);
    return {
      object: "block",
      parent: plainParent,
      created_time: now,
      last_edited_time: now,
      has_children: false,
      in_trash: false,
      source_provider: null,
      source_object_id: null,
      source_last_edited_time: null,
      ...plainWrite,
    } as NotesBlock;
  }

  /** Keep an empty page writable immediately, without adding a separate undo step. */
  function ensurePageBody(pageId: string): string | null {
    if (context.readSelectedPageId() !== pageId) return null;
    const existing = context.readPageRootBlockIds()[0];
    if (existing) return existing;
    const write = createBlockWrite(crypto.randomUUID(), "paragraph", "");
    const parent: NotesParent = { type: "page_id", page_id: pageId };
    context.localInsertBlockAfter(optimisticBlockFromWrite(write, parent), null);
    const persistence = enqueueEditorMutation(async () => {
      // The local draft may already contain typing. Do not apply the stale append response.
      await appendNotesBlockChildren({ parent, after: null, children: [write] });
    });
    trackOptimisticBlockWrites([write.id], persistence);
    return write.id;
  }

  function undoSnapshot(
    focusBlockId: string | null,
    extraBlocks: readonly NotesBlock[] = [],
  ): NotesUndoSnapshot | null {
    return context.createUndoSnapshot(focusBlockId, extraBlocks);
  }

  function undoSnapshotForBlocks(
    blockIds: readonly string[],
    focusBlockId: string | null,
    focusSelection: NotesTextSelection | null = null,
    extraBlocks: readonly NotesBlock[] = [],
  ): NotesUndoSnapshot | null {
    return context.createUndoSnapshotForBlocks(
      focusBlockId,
      blockIds,
      extraBlocks,
      focusSelection,
    );
  }

  function recordUndo(
    kind: NotesUndoKind,
    before: NotesUndoSnapshot | null,
    after: NotesUndoSnapshot | null,
    groupKey: string | null = null,
  ): void {
    context.recordUndo({ kind, before, after, groupKey });
  }

  function recordUndoAfter(
    kind: NotesUndoKind,
    before: NotesUndoSnapshot | null,
    focusBlockId: string | null,
    groupKey: string | null = null,
    extraBlocks: readonly NotesBlock[] = [],
  ): void {
    recordUndo(kind, before, undoSnapshot(focusBlockId, extraBlocks), groupKey);
  }

  const columnActions = createNotesColumnActions(context);
  const tabActions = createNotesTabActions(context);
  const mediaActions = createNotesMediaBlockActions(context);
  const richTextActions = createNotesRichTextBlockActions({
    ...context,
    enqueueEditorMutation,
    hasPendingOptimisticWrite: optimisticWrites.has,
  });
  const tableActions = createNotesTableBlockActions({
    ...context,
    appendAndApply,
    trashAndApply,
    replaceBlockWithUpdate,
    undoSnapshot,
    recordUndoAfter,
  });
  const templateActions = createNotesTemplateBlockActions({
    ...context,
    appendAndApply,
    duplicateSubtreesAndApply,
    undoSnapshot,
    recordUndoAfter,
  });
  const duplicationActions = createNotesBlockDuplicationActions({
    ...context,
    duplicateSubtreesAndApply,
    undoSnapshot,
    recordUndoAfter,
  });
  const movementActions = createNotesBlockMovementActions({
    ...context,
    ensurePageBody,
    enqueueEditorMutation,
    replaceBlockWithUpdate,
    moveAndApply,
    moveManyAndApply,
    trashAndApply,
    pendingOptimisticWrite: optimisticWrites.pending,
    trackOptimisticBlockWrites,
    undoSnapshot,
    recordUndo,
    recordUndoAfter,
  });
  const pasteActions = createNotesBlockPasteActions({
    ...context,
    enqueueEditorMutation,
    appendAndApply,
    pendingOptimisticWrite: optimisticWrites.pending,
    trackOptimisticBlockWrites,
    optimisticBlockFromWrite,
    undoSnapshotForBlocks,
    recordUndo,
  });
  const structuralActions = createNotesStructuralBlockActions({
    ...context,
    enqueueEditorMutation,
    replaceBlockWithUpdate,
    appendAndApply,
    undoSnapshot,
    recordUndoAfter,
  });

  async function replaceBlockWithUpdate(blockId: string, update: NotesBlockUpdate): Promise<void> {
    const previous = context.blockById(blockId);
    await context.flushBlockSave(blockId);
    context.localApplyBlockUpdate(blockId, update);
    await context.saveBlockNow(blockId, update);
    invalidateReplacedNotesMediaAsset(previous, update);
  }

  async function appendAndApply(request: NotesAppendBlockChildrenRequest): Promise<NotesBlock[]> {
    await context.awaitSelectedPageReady();
    const response = await appendNotesBlockChildren(request);
    context.applyPostMutation(notesPostAppendResult(request, response));
    return response.results;
  }

  async function moveAndApply(
    blockId: string,
    request: NotesMoveBlockRequest,
  ): Promise<NotesBlock> {
    await context.awaitSelectedPageReady();
    const hierarchyChanged = context.blockById(blockId)?.type === "child_page";
    const block = await moveNotesBlock(blockId, request);
    context.applyPostMutation({
      ...notesPostMoveResult(block, request),
      sidebarImpact: hierarchyChanged ? "hierarchy" : "none",
    });
    return block;
  }

  async function moveManyAndApply(request: NotesMoveBlocksRequest): Promise<NotesBlock[]> {
    await context.awaitSelectedPageReady();
    const hierarchyChanged = request.block_ids.some(
      (blockId) => context.blockById(blockId)?.type === "child_page",
    );
    const response = await moveNotesBlocks(request);
    context.applyPostMutation({
      ...notesPostMoveManyResult(request, response),
      sidebarImpact: hierarchyChanged ? "hierarchy" : "none",
    });
    return response.results;
  }

  async function trashAndApply(rootBlockIds: readonly string[]): Promise<void> {
    await context.awaitSelectedPageReady();
    const before = context.treeState();
    const hierarchyChanged = rootBlockIds.some((blockId) => (
      collectLoadedBlockSubtreeIds(before, blockId).some(
        (subtreeId) => before.blocksById[subtreeId]?.type === "child_page",
      )
    ));
    if (rootBlockIds.length === 1) {
      const blockId = rootBlockIds[0];
      if (!blockId) return;
      await trashNotesBlock(blockId, true);
    } else {
      await trashNotesBlocks({ block_ids: [...rootBlockIds], in_trash: true });
    }
    context.applyPostMutation({
      ...notesPostTrashResult(before, rootBlockIds),
      sidebarImpact: hierarchyChanged ? "hierarchy" : "none",
    });
  }

  async function duplicateSubtreesAndApply(input: {
    rootBlockIds: readonly string[];
    sourceSubtreeBlockIds: readonly string[];
    parent: NotesParent;
    after: string | null;
    before?: string | null;
    includeTrashedSources?: boolean;
  }): Promise<NotesBlock[]> {
    await context.awaitSelectedPageReady();
    const request = {
      block_ids: [...input.rootBlockIds],
      duplicated_block_ids: input.sourceSubtreeBlockIds.map((sourceId) => ({
        source_id: sourceId,
        duplicate_id: crypto.randomUUID(),
      })),
      parent: input.parent,
      after: input.after,
      before: input.before ?? null,
      include_trashed_sources: input.includeTrashedSources ?? false,
    };
    const response = await duplicateNotesBlocks(request);
    context.applyPostMutation(notesPostMoveManyResult(request, response));
    return response.results;
  }

  return {
    formatDocumentRange: createNotesDocumentFormatting(context),
    replaceDocumentRange: createNotesDocumentEdit(context, optimisticBlockFromWrite),
    flushOptimisticBlockWrites,
    ensurePageBody,
    ...richTextActions,
    ...mediaActions,
    ...tableActions,
    ...columnActions,
    ...tabActions,
    ...structuralActions,
    ...pasteActions,
    ...duplicationActions,
    ...movementActions,
    ...templateActions,
  };
}
