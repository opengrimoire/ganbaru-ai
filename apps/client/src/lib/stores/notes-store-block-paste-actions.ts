import { appendNotesBlockChildren, updateNotesBlock } from "$lib/api/notes";
import { cloneNotesJson } from "$lib/notes/json-clone";
import { notesPasteAppendRequests, planNotesPlainTextPaste } from "$lib/notes/block-clipboard";
import { planNotesRichHtmlPaste } from "$lib/notes/rich-text-paste";
import {
  blockColor,
} from "$lib/notes/block-color";
import {
  applyBlockUpdate,
  blockEditableRichText,
  blockIndent,
  blockUpdateWithIndent,
  blockPlainText,
  blockWithRichText,
  blockWithToggleOpen,
} from "$lib/notes/block-factory";
import { createBlockWriteFromRichText } from "$lib/notes/block-rich-text-write";
import {
  notesEnterSiblingBlockType,
  notesEnterSplitsRichTextBlock,
} from "$lib/notes/block-enter";
import { planNotesInsertedBlockFocus } from "$lib/notes/editor-focus";
import { parentIdForBlock } from "$lib/notes/block-tree";
import { splitRichTextForBlock } from "$lib/notes/rich-text-split";
import type { NotesTextSelection } from "$lib/notes/editor-selection";
import type {
  NotesAppendBlockChildrenRequest,
  NotesBlock,
  NotesBlockUpdate,
  NotesBlockWrite,
  NotesParent,
} from "$lib/notes/types";
import type {
  NotesUndoSnapshot,
} from "$lib/notes/undo-history";

const START_OF_BLOCK_SELECTION: NotesTextSelection = { start: 0, end: 0 };

interface OptimisticPastePlan {
  currentUpdate: NotesBlockUpdate;
  appendedBlocks: NotesBlockWrite[];
  blockDepths: number[];
  focusBlockId: string;
  focusOffset: number;
}

interface NotesBlockPasteActionsContext {
  enqueueEditorMutation: (mutation: () => Promise<void>) => Promise<void>;
  readSelectedPageId: () => string | null;
  blockById: (blockId: string) => NotesBlock | undefined;
  localApplyBlockUpdate: (blockId: string, update: NotesBlockUpdate) => void;
  localInsertBlockAfter: (block: NotesBlock, afterBlockId: string | null) => void;
  requestBlockFocus: (blockId: string | null, selection?: NotesTextSelection | null) => void;
  scheduleBlockSave: (blockId: string, update: NotesBlockUpdate) => void;
  saveBlockNow: (blockId: string, update: NotesBlockUpdate) => Promise<void>;
  flushBlockSave: (blockId: string) => Promise<void>;
  loadPageTree: (pageId: string) => Promise<void>;
  appendAndApply: (request: NotesAppendBlockChildrenRequest) => Promise<NotesBlock[]>;
  pendingOptimisticWrite: (blockId: string) => Promise<void> | null;
  trackOptimisticBlockWrites: (blockIds: readonly string[], persistence: Promise<void>) => void;
  optimisticBlockFromWrite: (write: NotesBlockWrite, parent: NotesParent) => NotesBlock;
  undoSnapshotForBlocks: (
    blockIds: readonly string[],
    focusBlockId: string | null,
    focusSelection?: NotesTextSelection | null,
  ) => NotesUndoSnapshot | null;
  recordUndo: (
    kind: "create" | "paste",
    before: NotesUndoSnapshot | null,
    after: NotesUndoSnapshot | null,
    groupKey?: string | null,
  ) => void;
}

export interface NotesBlockPasteActions {
  splitTextBlockAtSelection: (
    blockId: string,
    selectionStart: number,
    selectionEnd: number,
  ) => Promise<void>;
  pastePlainTextIntoBlock: (
    blockId: string,
    selectionStart: number,
    selectionEnd: number,
    plainText: string,
  ) => Promise<boolean>;
  pasteRichHtmlIntoBlock: (
    blockId: string,
    selectionStart: number,
    selectionEnd: number,
    html: string,
  ) => Promise<boolean>;
}

/** Create optimistic split, plain-text paste, and rich-HTML paste actions. */
export function createNotesBlockPasteActions(
  context: NotesBlockPasteActionsContext,
): NotesBlockPasteActions {
  async function splitTextBlockAtSelection(
    blockId: string,
    selectionStart: number,
    selectionEnd: number,
  ): Promise<void> {
    const block = context.blockById(blockId);
    const pageId = context.readSelectedPageId();
    if (!block || !notesEnterSplitsRichTextBlock(block.type) || !pageId) return;
    const beforeSelection = {
      start: Math.min(selectionStart, selectionEnd),
      end: Math.max(selectionStart, selectionEnd),
    };
    const before = context.undoSnapshotForBlocks([blockId], blockId, beforeSelection);
    const split = splitRichTextForBlock(blockEditableRichText(block), selectionStart, selectionEnd);
    const newBlockId = crypto.randomUUID();
    const textUpdate = blockWithRichText(block, split.before);
    const currentUpdate = cloneNotesJson(block.type === "toggle"
      ? blockWithToggleOpen(applyBlockUpdate(block, textUpdate), true)
      : textUpdate);
    const isToggle = block.type === "toggle";
    const nextPayload = createBlockWriteFromRichText(
      newBlockId,
      notesEnterSiblingBlockType(block.type),
      split.after,
      isToggle ? "default" : blockColor(block),
    );
    const nextWrite = cloneNotesJson({ id: newBlockId, ...blockUpdateWithIndent(nextPayload, isToggle ? 0 : blockIndent(block)) });
    const parent = cloneNotesJson(isToggle
      ? { type: "block_id" as const, block_id: block.id }
      : block.parent);
    const after = isToggle ? null : blockId;
    const nextBlock = context.optimisticBlockFromWrite(nextWrite, parent);
    const focusBlockId = planNotesInsertedBlockFocus([newBlockId], blockId) ?? newBlockId;

    context.localApplyBlockUpdate(blockId, currentUpdate);
    context.localInsertBlockAfter(nextBlock, after);
    context.requestBlockFocus(focusBlockId, START_OF_BLOCK_SELECTION);
    context.recordUndo(
      "create",
      before,
      context.undoSnapshotForBlocks(
        [blockId, newBlockId],
        focusBlockId,
        START_OF_BLOCK_SELECTION,
      ),
      `create:enter:${isToggle ? block.id : parentIdForBlock(block)}`,
    );
    const persistence = context.enqueueEditorMutation(async () => {
      await updateNotesBlock(blockId, currentUpdate);
      await appendNotesBlockChildren({ parent, after, children: [nextWrite] });
    });
    context.trackOptimisticBlockWrites([blockId, newBlockId], persistence);
  }

  function applyOptimisticPaste(
    pageId: string,
    currentBlock: NotesBlock,
    plan: OptimisticPastePlan,
    beforeFocusSelection: NotesTextSelection,
  ): void {
    const affectedIds = [currentBlock.id, ...plan.appendedBlocks.map((write) => write.id)];
    const before = context.undoSnapshotForBlocks(
      affectedIds,
      currentBlock.id,
      beforeFocusSelection,
    );
    const currentUpdate = cloneNotesJson(blockUpdateWithIndent(plan.currentUpdate, blockIndent(currentBlock)));
    const writes = plan.appendedBlocks.map((write, index) => cloneNotesJson({
      id: write.id,
      ...blockUpdateWithIndent(write, plan.blockDepths[index + 1] === 0 ? blockIndent(currentBlock) : 0),
    }));
    const parent = cloneNotesJson(currentBlock.parent);
    const focusSelection = { start: plan.focusOffset, end: plan.focusOffset };
    context.localApplyBlockUpdate(currentBlock.id, currentUpdate);
    const requests = notesPasteAppendRequests(currentBlock.id, parent, writes, plan.blockDepths);
    for (const request of requests) {
      let after = request.after ?? null;
      for (const write of request.children) {
        context.localInsertBlockAfter(context.optimisticBlockFromWrite(write, request.parent), after);
        after = write.id;
      }
    }
    context.requestBlockFocus(plan.focusBlockId, focusSelection);
    context.recordUndo(
      "paste",
      before,
      context.undoSnapshotForBlocks(affectedIds, plan.focusBlockId, focusSelection),
    );
    const persistence = context.enqueueEditorMutation(async () => {
      await updateNotesBlock(currentBlock.id, currentUpdate);
      for (const request of requests) await appendNotesBlockChildren(request);
    });
    context.trackOptimisticBlockWrites(affectedIds, persistence);
    void persistence;
  }

  async function pastePlainTextIntoBlock(
    blockId: string,
    selectionStart: number,
    selectionEnd: number,
    plainText: string,
  ): Promise<boolean> {
    const block = context.blockById(blockId);
    const pageId = context.readSelectedPageId();
    if (!block || !pageId) return false;
    const plan = planNotesPlainTextPaste({
      currentBlockId: blockId,
      currentBlockType: block.type,
      currentText: blockPlainText(block),
      selectionStart,
      selectionEnd,
      plainText,
      createId: () => crypto.randomUUID(),
    });
    if (!plan) return false;
    applyOptimisticPaste(pageId, block, plan, {
      start: Math.min(selectionStart, selectionEnd),
      end: Math.max(selectionStart, selectionEnd),
    });
    return true;
  }

  async function pasteRichHtmlIntoBlock(
    blockId: string,
    selectionStart: number,
    selectionEnd: number,
    html: string,
  ): Promise<boolean> {
    const block = context.blockById(blockId);
    const pageId = context.readSelectedPageId();
    if (!block || !pageId) return false;
    const plan = planNotesRichHtmlPaste({
      currentBlock: block,
      selectionStart,
      selectionEnd,
      html,
      createId: () => crypto.randomUUID(),
    });
    if (!plan) return false;
    applyOptimisticPaste(pageId, block, plan, {
      start: Math.min(selectionStart, selectionEnd),
      end: Math.max(selectionStart, selectionEnd),
    });
    return true;
  }

  return { splitTextBlockAtSelection, pastePlainTextIntoBlock, pasteRichHtmlIntoBlock };
}
