import { notesPasteAppendRequests, planNotesPlainTextPaste } from "$lib/notes/block-clipboard";
import { createNotesPastePersistence } from "./notes-store-paste-persistence";
import type { NotesDocumentSelection } from "$lib/notes/editor-selection";
import { planNotesRichHtmlPaste } from "$lib/notes/rich-text-paste";
import { appendNotesBlockChildren, moveNotesBlock, trashNotesBlock, updateNotesBlock } from "$lib/api/notes";
import { applyBlockUpdate, blockIndent, blockUpdateWithIndent, blockEditableRichText, blockPlainText, blockWithRichText, createBlockUpdate, createBlockWrite, isTextEditableBlock } from "$lib/notes/block-factory";
import { blockChildrenAreVisible } from "$lib/notes/block-tree";
import { applyRichTextAnnotations, replaceRichTextRange, createTextRichText, richTextAnnotationsForSelection, richTextPlainText, type NotesRichTextAnnotationName } from "$lib/notes/rich-text";
import { splitRichTextForBlock } from "$lib/notes/rich-text-split";
import type { NotesBlockActionsContext } from "./notes-store-block-actions";
import type { NotesBlockPlacement } from "$lib/notes/post-mutation";
import { createBlockWriteFromRichText } from "$lib/notes/block-rich-text-write";
import { notesEnterSiblingBlockType } from "$lib/notes/block-enter";
import type { NotesBlock, NotesBlockWrite, NotesParent } from "$lib/notes/types";

/** Replace a document range as one local edit and one undo entry. */
export function createNotesDocumentEdit(context: NotesBlockActionsContext, optimisticBlockFromWrite: (write: NotesBlockWrite, parent: NotesParent) => NotesBlock) {
  return async function replaceDocumentRange(
    blockIds: readonly string[], start: number, end: number, text: string, html?: string, documentSelection?: NotesDocumentSelection,
  ): Promise<void> {
    const blocks = blockIds.map((id) => context.blockById(id));
    if (!blocks.length || blocks.some((block) => !block)) throw new Error("Notes selection content is not loaded");
    const originalFirst = blocks[0]!;
    const replacement = originalFirst.type === "child_page"
      ? createBlockWrite(crypto.randomUUID(), "paragraph", "") : null;
    const first = replacement ? optimisticBlockFromWrite(replacement, originalFirst.parent) : originalFirst;
    const last = blocks[blocks.length - 1]!;
    const prefix = splitRichTextForBlock(blockEditableRichText(first), start, blockPlainText(first).length).before;
    const suffix = last.type === "child_page" ? [] : splitRichTextForBlock(blockEditableRichText(last), 0, end).after;
    const lines = text.replace(/\r\n?/gu, "\n").split("\n");
    const richText = [...prefix, createTextRichText(lines[0]), ...(lines.length === 1 ? suffix : [])];
    let update = isTextEditableBlock(first.type)
      ? blockWithRichText(first, richText)
      : createBlockUpdate("paragraph", richTextPlainText(richText));
    let writes = lines.slice(1).map((line, index) => createBlockWriteFromRichText(
      crypto.randomUUID(), notesEnterSiblingBlockType(first.type),
      [createTextRichText(line), ...(index === lines.length - 2 ? suffix : [])],
    ));
    const merged = isTextEditableBlock(first.type)
      ? blockWithRichText(first, [...prefix, ...suffix]) : createBlockUpdate("paragraph", richTextPlainText([...prefix, ...suffix]));
    const richPastePlan = html ? planNotesRichHtmlPaste({
      currentBlock: applyBlockUpdate(first, merged),
      selectionStart: richTextPlainText(prefix).length, selectionEnd: richTextPlainText(prefix).length,
      html, createId: () => crypto.randomUUID(),
    }) : null;
    const pastePlan = html ? richPastePlan : text.trim() ? planNotesPlainTextPaste({
      currentBlockId: first.id, currentBlockType: first.type,
      currentText: richTextPlainText([...prefix, ...suffix]),
      selectionStart: richTextPlainText(prefix).length, selectionEnd: richTextPlainText(prefix).length,
      plainText: text, createId: () => crypto.randomUUID(),
    }) : null;
    if (pastePlan) {
      update = pastePlan.currentUpdate;
      writes = pastePlan.appendedBlocks;
      if (!html) {
        // Plain Markdown parsing must retain annotations outside the replaced range.
        let current = applyBlockUpdate(first, update);
        if (prefix.length) {
          update = blockWithRichText(current, replaceRichTextRange(blockEditableRichText(current), 0, richTextPlainText(prefix).length, prefix));
          current = applyBlockUpdate(first, update);
        }
        const lastWrite = writes.at(-1);
        const suffixBlock = lastWrite ? applyBlockUpdate(first, lastWrite) : current;
        const suffixText = blockEditableRichText(suffixBlock);
        const length = richTextPlainText(suffixText).length;
        if (suffix.length) {
          const suffixUpdate = blockWithRichText(suffixBlock, replaceRichTextRange(suffixText, length - richTextPlainText(suffix).length, length, suffix));
          if (lastWrite) writes[writes.length - 1] = { id: lastWrite.id, ...suffixUpdate };
          else update = suffixUpdate;
        }
      }
    }
    const fullySelectedHiddenRoots = blocks.filter((block, index) => {
      if (!block || blockChildrenAreVisible(block)) return false;
      const beginsAtStart = index > 0 || start === 0;
      const endsAtEnd = index < blocks.length - 1 || (end > 0 && end >= blockPlainText(block).length);
      return beginsAtStart && endsAtEnd;
    }).map((block) => block!.id);
    if (!text && fullySelectedHiddenRoots.includes(first.id) && first.type === "toggle") {
      update = blockWithRichText(applyBlockUpdate(first, createBlockUpdate("paragraph", "")), [...prefix, ...suffix]);
    }
    update = blockUpdateWithIndent(update, blockIndent(first));
    writes = writes.map((write, index) => ({ id: write.id,
      ...blockUpdateWithIndent(write, (pastePlan?.blockDepths[index + 1] ?? 0) === 0 ? blockIndent(first) : 0) }));
    const before = context.createUndoSnapshot(originalFirst.id, [], { start, end: originalFirst.id === last.id ? end : blockPlainText(originalFirst).length });
    if (before) before.documentSelection = documentSelection ?? { anchor: { blockId: originalFirst.id, offset: start }, focus: { blockId: last.id, offset: end } };
    const removed = new Set(blockIds.slice(1));
    if (replacement && start === 0 && (originalFirst.id !== last.id || end > 0)) removed.add(originalFirst.id);
    if (last.type === "child_page" && end === 0) removed.delete(last.id);
    for (const descendantId of context.outlineSubtreeIds(fullySelectedHiddenRoots)) {
      if (descendantId !== first.id) removed.add(descendantId);
    }
    const tree = context.treeState();
    const moved: NotesBlock[] = [];
    const placements: NotesBlockPlacement[] = [];
    // Descendants outside the text range must survive deletion of their parent.
    for (const id of removed) {
      for (const childId of tree.childIdsByParentId[id] ?? []) {
        if (removed.has(childId)) continue;
        const child = context.blockById(childId);
        if (!child) throw new Error("Notes selection descendants are not loaded");
        const parent = first.parent;
        if (parent.type !== "page_id" && parent.type !== "block_id") throw new Error("Invalid Notes selection parent");
        moved.push({ ...child, parent });
        placements.push({ blockId: childId, parent, after: placements.at(-1)?.blockId ?? first.id });
      }
    }
    if (replacement) {
      const inserted = applyBlockUpdate(first, update);
      if (start === 0) context.localInsertBlockBefore(inserted, originalFirst.id);
      else context.localInsertBlockAfter(inserted, originalFirst.id);
    } else context.localApplyBlockUpdate(first.id, update);
    context.applyPostMutation({ blocks: moved, placements, removedBlockIds: [...removed], sidebarImpact: blocks.some((block) => block?.type === "child_page") ? "hierarchy" : "none" });
    const requests = notesPasteAppendRequests(first.id, first.parent, writes, pastePlan?.blockDepths);
    for (const request of requests) {
      let after = request.after ?? null;
      for (const write of request.children) {
        context.localInsertBlockAfter(optimisticBlockFromWrite(write, request.parent), after);
        after = write.id;
      }
    }
    const focusId = pastePlan?.focusBlockId ?? writes.at(-1)?.id ?? first.id;
    const offset = pastePlan?.focusOffset ?? (writes.length ? lines[lines.length - 1].length : richTextPlainText(prefix).length + text.length);
    const selection = { start: offset, end: offset };
    context.requestBlockFocus(focusId, selection);
    context.recordUndo({ kind: "delete", before, after: context.createUndoSnapshot(focusId, [], selection) });
    const persistPaste = createNotesPastePersistence(requests, richPastePlan?.copiedPageIds);
    const mutations: Array<() => Promise<unknown>> = [];
    if (replacement) {
      mutations.push(() => appendNotesBlockChildren({ parent: first.parent, after: originalFirst.id, children: [{ id: first.id, ...update }] }));
      if (start === 0) mutations.push(() => moveNotesBlock(first.id, { parent: first.parent, after: null, before: originalFirst.id }));
    } else mutations.push(() => updateNotesBlock(first.id, update));
    mutations.push(persistPaste);
    for (const placement of placements) {
      mutations.push(() => moveNotesBlock(placement.blockId, { parent: placement.parent, after: placement.after, before: null }));
    }
    // Children first avoids trashing surviving descendants through a removed ancestor.
    for (const id of [...removed].reverse()) mutations.push(() => trashNotesBlock(id, true));
    let completed = 0;
    void context.enqueueEditorMutation(async () => {
      await context.awaitSelectedPageReady();
      // A retry must not use a removed note as an insertion anchor or duplicate completed writes.
      while (completed < mutations.length) {
        await mutations[completed]();
        completed += 1;
      }
      if (richPastePlan?.copiedPageIds) context.applyPostMutation({ sidebarImpact: "hierarchy" });
    });
  };
}

/** Toggle a formatting annotation over every selected text segment in one undo step. */
export function createNotesDocumentFormatting(context: NotesBlockActionsContext) {
  return async (ids: readonly string[], start: number, end: number, annotation: NotesRichTextAnnotationName, documentSelection?: NotesDocumentSelection): Promise<void> => {
    const segments = ids.flatMap((id, index) => {
      const block = context.blockById(id);
      if (!block) throw new Error("Notes selection content is not loaded");
      if (!isTextEditableBlock(block.type)) return [];
      const from = index === 0 ? start : 0;
      const to = Math.min(index === ids.length - 1 ? end : blockPlainText(block).length, blockPlainText(block).length);
      return from < to ? [{ block, from, to }] : [];
    });
    if (!segments.length) return;
    const enabled = !segments.every(({ block, from, to }) =>
      richTextAnnotationsForSelection(blockEditableRichText(block), from, to).annotations[annotation]);
    const before = context.createUndoSnapshot(ids[0]);
    const selected = documentSelection ?? { anchor: { blockId: ids[0], offset: start }, focus: { blockId: ids[ids.length - 1], offset: end } };
    if (before) before.documentSelection = selected;
    const updates = segments.map(({ block, from, to }) => ({
      id: block.id,
      update: blockWithRichText(block, applyRichTextAnnotations(blockEditableRichText(block), from, to, { [annotation]: enabled })),
    }));
    for (const { id, update } of updates) context.localApplyBlockUpdate(id, update);
    const after = context.createUndoSnapshot(ids[0]);
    if (after) after.documentSelection = selected;
    context.recordUndo({ kind: "formatting", before, after });
    void context.enqueueEditorMutation(async () => {
      await context.awaitSelectedPageReady();
      for (const { id, update } of updates) await updateNotesBlock(id, update);
    });
  };
}
