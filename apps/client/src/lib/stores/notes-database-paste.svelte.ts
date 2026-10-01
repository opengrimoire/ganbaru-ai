import { SvelteSet } from "svelte/reactivity";
import { appendNotesBlockChildren, createNotesLinkedDatabaseView, getNotesDatabaseReference, trashNotesBlock, updateNotesBlock } from "$lib/api/notes";
import { blockEditableRichText, blockPlainText, blockWithRichText, createBlockWrite } from "$lib/notes/block-factory";
import { notesLinkTarget } from "$lib/notes/link-navigation";
import { createDatabaseMentionRichText, replaceRichTextRange, richTextRangeSlice } from "$lib/notes/rich-text";
import type { NotesBlock, NotesBlockWrite, NotesChildDatabaseBlock, NotesCreatedDatabase, NotesDatabaseReference, NotesParent, NotesRichText } from "$lib/notes/types";
import type { NotesPostMutationResult } from "$lib/notes/post-mutation";
import type { NotesUndoSnapshot } from "$lib/notes/undo-history";

interface DatabasePasteContext {
  readPageId: () => string | null;
  blockById: (id: string) => NotesBlock | undefined;
  enqueue: (mutation: () => Promise<void>) => Promise<void>;
  retry: () => Promise<void>;
  apply: (result: NotesPostMutationResult) => void;
  updateLocal: (id: string, richText: readonly NotesRichText[]) => void;
  optimisticBlock: (write: NotesBlockWrite, parent: NotesParent) => NotesBlock;
  requestFocus: (id: string) => void;
  updateRichText: (id: string, richText: readonly NotesRichText[]) => Promise<void>;
  snapshot: (focusId: string | null) => NotesUndoSnapshot | null;
  recordUndo: (before: NotesUndoSnapshot | null, after: NotesUndoSnapshot | null) => void;
  reconcileIdentity?: (block: NotesChildDatabaseBlock) => void;
}

export type NotesDatabasePastePrompt = {
  kind: "copy";
  pageId: string;
  blockId: string;
  copies: Readonly<Record<string, string>>;
} | {
  kind: "link";
  pageId: string;
  blockId: string;
  start: number;
  end: number;
  text: string;
  url: string;
  reference: NotesDatabaseReference;
};

/** Own transient database paste choices without retaining copied row data. */
export function createNotesDatabasePasteController(context: DatabasePasteContext) {
  let prompt = $state<NotesDatabasePastePrompt | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let started = $state(false);
  let inspectGeneration = 0;
  const creating = new SvelteSet<string>();

  function dismiss(): void {
    prompt = null;
    error = null;
    started = false;
    inspectGeneration += 1;
  }

  function beginCopies(copies: Readonly<Record<string, string>>, pending = true): void {
    const pageId = context.readPageId();
    const ids = Object.keys(copies);
    if (!pageId || !ids.length) return;
    dismiss();
    if (pending) for (const id of ids) creating.add(id);
    prompt = { kind: "copy", pageId, blockId: ids[ids.length - 1], copies };
  }

  function acceptCopy(id: string, created: NotesCreatedDatabase): void {
    const current = context.blockById(id);
    if (current?.type === "child_database") {
      context.apply({ blocks: [{ ...created.block, child_database: { ...created.block.child_database, title: current.child_database.title } }] });
    }
    context.reconcileIdentity?.(created.block);
    creating.delete(id);
  }

  /** Offer local database choices only while the pasted text range still exists. */
  async function inspectLink(blockId: string, start: number, end: number, url: string): Promise<void> {
    const target = notesLinkTarget(url, typeof window === "undefined" ? undefined : window.location.href);
    const pageId = context.readPageId();
    const block = context.blockById(blockId);
    if (!pageId || !block || !target?.blockId) return;
    const known = context.blockById(target.blockId);
    if (known && known.type !== "child_database") return;
    const text = blockPlainText(block).slice(start, end);
    const generation = ++inspectGeneration;
    try {
      const reference = await getNotesDatabaseReference(target.blockId);
      const latest = context.blockById(blockId);
      if (!latest || generation !== inspectGeneration || context.readPageId() !== pageId
        || reference.page_id !== target.pageId || blockPlainText(latest).slice(start, end) !== text) return;
      prompt = { kind: "link", pageId, blockId, start, end, text, url, reference };
      error = null;
      started = false;
    } catch (caught: unknown) {
      // Ordinary local block links retain their hyperlink when no database exists.
      console.debug("Pasted Notes block reference has no available database", caught);
    }
  }

  function currentLink(value: Extract<NotesDatabasePastePrompt, { kind: "link" }>): NotesBlock {
    const block = context.blockById(value.blockId);
    if (!block || context.readPageId() !== value.pageId || blockPlainText(block).slice(value.start, value.end) !== value.text) {
      throw new Error("The pasted database reference has changed");
    }
    return block;
  }

  async function mention(): Promise<void> {
    const current = prompt;
    if (!current || current.kind !== "link" || busy || started) return;
    busy = true;
    error = null;
    try {
      const block = currentLink(current);
      const mention = createDatabaseMentionRichText(current.reference.block_id, current.reference.title);
      mention.href = current.url;
      const original = richTextRangeSlice(blockEditableRichText(block), current.start, current.end)[0];
      if (original) mention.annotations = { ...original.annotations };
      await context.updateRichText(block.id, replaceRichTextRange(blockEditableRichText(block), current.start, current.end, [mention]));
      if (prompt === current) dismiss();
    } catch (caught: unknown) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally { busy = false; }
  }

  function syncCopies(current: Extract<NotesDatabasePastePrompt, { kind: "copy" }>): Promise<void> {
    started = true;
    const items = Object.entries(current.copies).map(([copyId, sourceId]) => ({
      copyId, sourceId, id: crypto.randomUUID(), viewId: crypto.randomUUID(), created: null as NotesCreatedDatabase | null,
    }));
    let completed = 0;
    let before: NotesUndoSnapshot | null = null;
    return context.enqueue(async () => {
      if (context.readPageId() !== current.pageId) throw new Error("The destination note has changed");
      before ??= context.snapshot(current.blockId);
      while (completed < items.length) {
        const item = items[completed];
        const block = context.blockById(item.copyId);
        if (!block || block.type !== "child_database") throw new Error("The pasted database is no longer available");
        item.created ??= await createNotesLinkedDatabaseView({
          id: item.id, view_id: item.viewId, source_block_id: item.sourceId,
          title: block.child_database.title, parent: block.parent, after_block_id: block.id,
        });
        await trashNotesBlock(block.id, true);
        // Insert before removing the anchor so its document position survives.
        context.apply({ blocks: [item.created.block], placements: [{ blockId: item.id, parent: block.parent, after: block.id }] });
        context.apply({ removedBlockIds: [block.id] });
        completed += 1;
      }
      if (items.length) context.requestFocus(items[items.length - 1].id);
      context.recordUndo(before, context.snapshot(items.at(-1)?.id ?? null));
      if (prompt === current) dismiss();
    });
  }

  function linkView(current: Extract<NotesDatabasePastePrompt, { kind: "link" }>): Promise<void> {
    const block = currentLink(current);
    started = true;
    const before = context.snapshot(block.id);
    const whole = current.start === 0 && current.end === blockPlainText(block).length;
    const id = crypto.randomUUID();
    const viewId = crypto.randomUUID();
    const prefix = richTextRangeSlice(blockEditableRichText(block), 0, current.start);
    const suffix = richTextRangeSlice(blockEditableRichText(block), current.end, blockPlainText(block).length);
    const write = createBlockWrite(id, "child_database", current.reference.title);
    const suffixWrite = suffix.length ? { ...createBlockWrite(crypto.randomUUID(), "paragraph", ""),
      type: "paragraph" as const, paragraph: { rich_text: suffix, color: "default" as const } } : null;
    if (!whole) context.updateLocal(block.id, prefix);
    context.apply({ blocks: [context.optimisticBlock(write, block.parent)], placements: [{ blockId: id, parent: block.parent, after: block.id }] });
    if (suffixWrite) context.apply({ blocks: [context.optimisticBlock(suffixWrite, block.parent)], placements: [{ blockId: suffixWrite.id, parent: block.parent, after: id }] });
    if (whole) context.apply({ removedBlockIds: [block.id] });
    creating.add(id);
    current.blockId = id;
    context.requestFocus(id);
    context.recordUndo(before, context.snapshot(id));
    const steps: Array<() => Promise<unknown>> = [];
    if (!whole) steps.push(() => updateNotesBlock(block.id, blockWithRichText(block, prefix)));
    steps.push(async () => {
      const created = await createNotesLinkedDatabaseView({ id, view_id: viewId,
        source_block_id: current.reference.block_id, parent: block.parent, after_block_id: block.id });
      acceptCopy(id, created);
    });
    if (suffixWrite) steps.push(() => appendNotesBlockChildren({ parent: block.parent, after: id, children: [suffixWrite] }));
    if (whole) steps.push(() => trashNotesBlock(block.id, true));
    let completed = 0;
    return context.enqueue(async () => {
      while (completed < steps.length) {
        await steps[completed]();
        completed += 1;
      }
      if (prompt === current) dismiss();
    });
  }

  async function linkedView(): Promise<void> {
    const current = prompt;
    if (!current || busy) return;
    busy = true;
    error = null;
    try {
      if (started) await context.retry();
      else {
        await (current.kind === "copy" ? syncCopies(current) : linkView(current));
      }
    } catch (caught: unknown) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally { busy = false; }
  }

  return {
    get prompt() { return prompt; }, get busy() { return busy; }, get error() { return error; }, get started() { return started; },
    isCreating: (id: string) => creating.has(id), beginCopies, acceptCopy, inspectLink, dismiss, mention, linkedView,
  };
}

export type NotesDatabasePasteController = ReturnType<typeof createNotesDatabasePasteController>;
