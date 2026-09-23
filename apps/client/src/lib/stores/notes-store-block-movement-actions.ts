import { trashNotesBlock } from "$lib/api/notes";
import { collectLoadedBlockSubtreeIds } from "$lib/notes/block-duplicate";
import { blockPlainText, blockWithRichText, createBlockUpdate, isTextEditableBlock } from "$lib/notes/block-factory";
import { planNotesBlockDrop, type NotesBlockDropIntent } from "$lib/notes/block-drag";
import { planNotesDeletedBlockFocus } from "$lib/notes/editor-focus";
import {
  notesSelectionRootBlockIds,
  notesSelectionSubtreeIds,
  planNotesSelectionMoveWithinSiblings,
  type NotesSelectionMoveDirection,
} from "$lib/notes/block-selection-operations";
import {
  planDeleteBlock,
  planMergeWithPrevious,
  planMoveBlockWithinSiblings,
  planNestBlock,
  planOutdentBlock,
  planReparentChildrenAfterMerge,
  planReparentChildrenBeforeDelete,
  type NotesChildReparentPlan,
  type NotesTreeState,
} from "$lib/notes/block-tree";
import type { NotesTextSelection } from "$lib/notes/editor-selection";
import type {
  NotesBlock,
  NotesBlockTreeItem,
  NotesBlockUpdate,
  NotesMoveBlockRequest,
  NotesMoveBlocksRequest,
  NotesParent,
} from "$lib/notes/types";
import type {
  NotesUndoKind,
  NotesUndoSnapshot,
} from "$lib/notes/undo-history";
import type { NotesPostMutationResult } from "$lib/notes/post-mutation";

interface NotesBlockMovementActionsContext {
  readSelectedPageId: () => string | null;
  treeState: () => NotesTreeState;
  blockById: (blockId: string) => NotesBlock | undefined;
  flatBlockItemsForBlockContext: (blockId: string) => NotesBlockTreeItem[];
  requestBlockFocus: (blockId: string | null, selection?: NotesTextSelection | null) => void;
  flushBlockSave: (blockId: string) => Promise<void>;
  flushPendingBlockSaves: () => Promise<void>;
  localRemoveLeafBlock: (blockId: string) => boolean;
  loadPageTree: (pageId: string) => Promise<void>;
  applyPostMutation: (result: NotesPostMutationResult) => void;
  createUndoSnapshot: (
    focusBlockId: string | null,
    extraBlocks?: readonly NotesBlock[],
    focusSelection?: NotesTextSelection | null,
  ) => NotesUndoSnapshot | null;
  replaceBlockWithUpdate: (blockId: string, update: NotesBlockUpdate) => Promise<void>;
  moveAndApply: (blockId: string, request: NotesMoveBlockRequest) => Promise<NotesBlock>;
  moveManyAndApply: (request: NotesMoveBlocksRequest) => Promise<NotesBlock[]>;
  trashAndApply: (rootBlockIds: readonly string[]) => Promise<void>;
  pendingOptimisticWrite: (blockId: string) => Promise<void> | null;
  trackOptimisticBlockWrites: (blockIds: readonly string[], persistence: Promise<void>) => void;
  undoSnapshot: (focusBlockId: string | null) => NotesUndoSnapshot | null;
  recordUndo: (
    kind: NotesUndoKind,
    before: NotesUndoSnapshot | null,
    after: NotesUndoSnapshot | null,
  ) => void;
  recordUndoAfter: (
    kind: NotesUndoKind,
    before: NotesUndoSnapshot | null,
    focusBlockId: string | null,
    groupKey?: string | null,
    extraBlocks?: readonly NotesBlock[],
  ) => void;
}

export interface NotesBlockMovementActions {
  deleteBlock: (blockId: string) => Promise<void>;
  deleteBlockSelection: (blockIds: readonly string[]) => Promise<void>;
  mergeBlockWithPrevious: (blockId: string) => Promise<void>;
  nestBlock: (blockId: string) => Promise<void>;
  outdentBlock: (blockId: string) => Promise<void>;
  moveBlockUp: (blockId: string) => Promise<void>;
  moveBlockDown: (blockId: string) => Promise<void>;
  moveBlockSelection: (
    blockIds: readonly string[],
    direction: NotesSelectionMoveDirection,
  ) => Promise<void>;
  dropBlockWithinSiblings: (
    sourceBlockId: string,
    targetBlockId: string,
    position: "before" | "after",
  ) => Promise<void>;
  dropBlockOnBlock: (
    sourceBlockId: string,
    targetBlockId: string,
    intent: NotesBlockDropIntent,
  ) => Promise<void>;
  moveBlockToPage: (blockId: string, pageId: string) => Promise<void>;
}

/** Create delete, merge, reparent, drag, and cross-page move actions. */
export function createNotesBlockMovementActions(
  context: NotesBlockMovementActionsContext,
): NotesBlockMovementActions {
  function selectionAtBlockEnd(blockId: string): NotesTextSelection | null {
    const block = context.blockById(blockId);
    if (!block || !isTextEditableBlock(block.type)) return null;
    const end = blockPlainText(block).length;
    return { start: end, end };
  }

  function parentFromMoveParentId(parentId: string): NotesParent | null {
    const pageId = context.readSelectedPageId();
    if (!pageId) return null;
    return parentId === pageId
      ? { type: "page_id", page_id: pageId }
      : { type: "block_id", block_id: parentId };
  }

  function focusAfterDeletingSelection(rootBlockIds: readonly string[]): string | null {
    const firstRoot = rootBlockIds[0];
    if (!firstRoot) return null;
    return planNotesDeletedBlockFocus({
      visibleBlockIds: context.flatBlockItemsForBlockContext(firstRoot).map((item) => item.block.id),
      removedBlockIds: notesSelectionSubtreeIds(context.treeState(), rootBlockIds),
      firstRemovedBlockId: firstRoot,
    });
  }

  async function moveReparentedChildren(plan: NotesChildReparentPlan): Promise<boolean> {
    if (plan.childIds.length === 0) return true;
    const parent = parentFromMoveParentId(plan.parentId);
    if (!parent) return false;
    let after = plan.after;
    for (const childId of plan.childIds) {
      await context.flushBlockSave(childId);
      await context.moveAndApply(childId, { parent, after, before: null });
      after = childId;
    }
    return true;
  }

  async function persistOptimisticLeafDelete(
    pageId: string,
    blockId: string,
    prerequisite: Promise<void> | null,
  ): Promise<void> {
    try {
      await prerequisite;
      await context.flushBlockSave(blockId);
      await trashNotesBlock(blockId, true);
      context.applyPostMutation({ removedBlockIds: [blockId] });
    } catch (error) {
      console.warn("notes leaf block delete persistence failed", error);
      await context.loadPageTree(pageId);
    }
  }

  async function deleteBlock(blockId: string): Promise<void> {
    const pageId = context.readSelectedPageId();
    if (!pageId) return;
    const plan = planDeleteBlock(context.flatBlockItemsForBlockContext(blockId), blockId);
    if (!plan) return;
    const before = context.undoSnapshot(blockId);
    if (plan.keepOnlyBlockAsParagraph) {
      await context.flushBlockSave(blockId);
      await context.replaceBlockWithUpdate(blockId, createBlockUpdate("paragraph", ""));
      context.requestBlockFocus(blockId);
      context.recordUndoAfter("delete", before, blockId);
      return;
    }
    if (plan.deleteBlockId) {
      const childPlan = planReparentChildrenBeforeDelete(context.treeState(), plan.deleteBlockId);
      if (!childPlan) return;
      const deletedBlock = context.blockById(plan.deleteBlockId);
      const optimistic = childPlan.childIds.length === 0
        && deletedBlock !== undefined
        && isTextEditableBlock(deletedBlock.type)
        && blockPlainText(deletedBlock).length === 0;
      if (optimistic) {
        const prerequisite = context.pendingOptimisticWrite(plan.deleteBlockId);
        const focusSelection = selectionAtBlockEnd(plan.focusBlockId);
        if (!context.localRemoveLeafBlock(plan.deleteBlockId)) return;
        context.requestBlockFocus(plan.focusBlockId, focusSelection);
        context.recordUndo(
          "delete",
          before,
          context.createUndoSnapshot(plan.focusBlockId, [], focusSelection),
        );
        const persistence = persistOptimisticLeafDelete(pageId, plan.deleteBlockId, prerequisite);
        context.trackOptimisticBlockWrites([plan.deleteBlockId], persistence);
        void persistence;
        return;
      }
      await context.flushBlockSave(blockId);
      if (!(await moveReparentedChildren(childPlan))) return;
      await context.trashAndApply([plan.deleteBlockId]);
    }
    context.requestBlockFocus(plan.focusBlockId);
    context.recordUndoAfter("delete", before, plan.focusBlockId);
  }

  async function deleteBlockSelection(blockIds: readonly string[]): Promise<void> {
    if (!context.readSelectedPageId()) return;
    const roots = notesSelectionRootBlockIds(context.treeState(), blockIds);
    if (roots.length === 0) return;
    await context.flushPendingBlockSaves();
    const before = context.undoSnapshot(roots[0] ?? null);
    const focus = focusAfterDeletingSelection(roots);
    await context.trashAndApply(roots);
    context.requestBlockFocus(focus);
    context.recordUndoAfter("delete", before, focus);
  }

  async function mergeBlockWithPrevious(blockId: string): Promise<void> {
    if (!context.readSelectedPageId()) return;
    await context.flushBlockSave(blockId);
    let plan = planMergeWithPrevious(context.flatBlockItemsForBlockContext(blockId), blockId);
    if (!plan) return;
    await context.flushBlockSave(plan.targetBlockId);
    plan = planMergeWithPrevious(context.flatBlockItemsForBlockContext(blockId), blockId);
    if (!plan) return;
    const target = context.blockById(plan.targetBlockId);
    if (!target) return;
    const childPlan = planReparentChildrenAfterMerge(
      context.treeState(),
      plan.sourceBlockId,
      plan.targetBlockId,
    );
    if (!childPlan) return;
    const before = context.undoSnapshot(blockId);
    await context.replaceBlockWithUpdate(target.id, blockWithRichText(target, plan.mergedRichText));
    if (!(await moveReparentedChildren(childPlan))) return;
    await context.trashAndApply([plan.sourceBlockId]);
    context.requestBlockFocus(target.id);
    context.recordUndoAfter("delete", before, target.id);
  }

  async function nestBlock(blockId: string): Promise<void> {
    if (!context.readSelectedPageId()) return;
    await context.flushBlockSave(blockId);
    const plan = planNestBlock(context.treeState(), blockId);
    if (!plan) return;
    const before = context.undoSnapshot(blockId);
    await context.moveAndApply(blockId, {
      parent: { type: "block_id", block_id: plan.parentId },
      after: plan.after,
    });
    context.requestBlockFocus(blockId);
    context.recordUndoAfter("move", before, blockId);
  }

  async function outdentBlock(blockId: string): Promise<void> {
    const pageId = context.readSelectedPageId();
    if (!pageId) return;
    await context.flushBlockSave(blockId);
    const plan = planOutdentBlock(context.treeState(), blockId);
    if (!plan) return;
    const parent: NotesParent = plan.parentId === pageId
      ? { type: "page_id", page_id: pageId }
      : { type: "block_id", block_id: plan.parentId };
    const before = context.undoSnapshot(blockId);
    await context.moveAndApply(blockId, { parent, after: plan.after });
    context.requestBlockFocus(blockId);
    context.recordUndoAfter("move", before, blockId);
  }

  async function moveBlockWithinSiblings(blockId: string, direction: "up" | "down"): Promise<void> {
    if (!context.readSelectedPageId()) return;
    await context.flushBlockSave(blockId);
    const plan = planMoveBlockWithinSiblings(context.treeState(), blockId, direction);
    if (!plan) return;
    const parent = parentFromMoveParentId(plan.parentId);
    if (!parent) return;
    const before = context.undoSnapshot(blockId);
    await context.moveAndApply(blockId, { parent, after: plan.after, before: plan.before });
    context.requestBlockFocus(blockId);
    context.recordUndoAfter("move", before, blockId);
  }

  async function moveBlockSelection(
    blockIds: readonly string[],
    direction: NotesSelectionMoveDirection,
  ): Promise<void> {
    if (!context.readSelectedPageId()) return;
    const roots = notesSelectionRootBlockIds(context.treeState(), blockIds);
    const plan = planNotesSelectionMoveWithinSiblings(context.treeState(), roots, direction);
    if (!plan) return;
    const parent = parentFromMoveParentId(plan.parentId);
    if (!parent) return;
    await context.flushPendingBlockSaves();
    const before = context.undoSnapshot(plan.focusBlockId);
    await context.moveManyAndApply({
      block_ids: plan.blockIds,
      parent,
      after: plan.after,
      before: plan.before,
    });
    context.requestBlockFocus(plan.focusBlockId);
    context.recordUndoAfter("move", before, plan.focusBlockId);
  }

  async function dropBlockOnBlock(
    sourceBlockId: string,
    targetBlockId: string,
    intent: NotesBlockDropIntent,
  ): Promise<void> {
    if (!context.readSelectedPageId()) return;
    await context.flushPendingBlockSaves();
    const plan = planNotesBlockDrop(context.treeState(), sourceBlockId, targetBlockId, intent);
    if (!plan) return;
    const parent = parentFromMoveParentId(plan.parentId);
    if (!parent) return;
    const before = context.undoSnapshot(sourceBlockId);
    await context.moveAndApply(sourceBlockId, { parent, after: plan.after, before: plan.before });
    context.requestBlockFocus(sourceBlockId);
    context.recordUndoAfter("move", before, sourceBlockId);
  }

  async function moveBlockToPage(blockId: string, pageId: string): Promise<void> {
    const selectedPageId = context.readSelectedPageId();
    if (!selectedPageId || pageId === selectedPageId) return;
    const block = context.blockById(blockId);
    if (!block || (block.type === "child_page" && block.id === pageId)) return;
    await context.flushPendingBlockSaves();
    const before = context.undoSnapshot(blockId);
    const state = context.treeState();
    const subtreeIds = collectLoadedBlockSubtreeIds(state, blockId);
    const focus = planNotesDeletedBlockFocus({
      visibleBlockIds: context.flatBlockItemsForBlockContext(blockId).map((item) => item.block.id),
      removedBlockIds: subtreeIds,
      firstRemovedBlockId: blockId,
    });
    const subtree = subtreeIds
      .map((id) => context.blockById(id))
      .filter((candidate): candidate is NotesBlock => candidate !== undefined);
    const moved = await context.moveAndApply(blockId, {
      parent: { type: "page_id", page_id: pageId },
      after: null,
      before: null,
    });
    context.applyPostMutation({ sidebarImpact: "hierarchy" });
    context.requestBlockFocus(focus);
    context.recordUndoAfter(
      "move",
      before,
      focus,
      null,
      subtree.map((item) => item.id === moved.id ? moved : item),
    );
  }

  return {
    deleteBlock,
    deleteBlockSelection,
    mergeBlockWithPrevious,
    nestBlock,
    outdentBlock,
    moveBlockUp: (blockId) => moveBlockWithinSiblings(blockId, "up"),
    moveBlockDown: (blockId) => moveBlockWithinSiblings(blockId, "down"),
    moveBlockSelection,
    dropBlockWithinSiblings: (source, target, position) => dropBlockOnBlock(source, target, position),
    dropBlockOnBlock,
    moveBlockToPage,
  };
}
