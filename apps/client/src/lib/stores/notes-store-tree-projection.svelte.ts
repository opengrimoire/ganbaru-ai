import { blockIndent } from "$lib/notes/block-queries";
import { flattenNotesBlockOutlines, notesBlockOutlineFromBlock, type NotesBlockOutlineItem } from "$lib/notes/block-outline";
import { buildNotesChildIdsByParent, parentIdForBlock, type NotesTreeState } from "$lib/notes/block-tree";
import type { NotesUndoSnapshot } from "$lib/notes/undo-history";
import { applyNotesPostMutationToTree, type NotesPostMutationResult } from "$lib/notes/post-mutation";
import type { NotesBlock, NotesBlockOutline, NotesLoadedPage, NotesPage } from "$lib/notes/types";
import { notesTreeState, notesTreeStateWithoutLeafBlock, type NotesBlockTreeSnapshot } from "./notes-store-block-tree";

export interface NotesTreeProjectionOptions {
  readSelectedPageId: () => string | null;
}

/** Owns the reactive projection of the currently loaded Notes block tree. */
export class NotesTreeProjectionController {
  loadedPage = $state<NotesPage | null>(null);
  blocksById = $state<Record<string, NotesBlock>>({});
  childIdsByParentId = $state<Record<string, string[]>>({});
  blockOutlines = $state<NotesBlockOutline[]>([]);
  flatBlockOutlines = $state<NotesBlockOutlineItem[]>([]);
  primaryContentReady = $state(false);

  private markLocallyChanged: (blockId: string) => void = () => {};

  constructor(private readonly options: NotesTreeProjectionOptions) {}

  setLocalChangeMarker(marker: (blockId: string) => void): void {
    this.markLocallyChanged = marker;
  }

  snapshot(): NotesBlockTreeSnapshot {
    return {
      selectedPageId: this.options.readSelectedPageId(),
      blocksById: this.blocksById,
      childIdsByParentId: this.childIdsByParentId,
    };
  }

  treeState(): NotesTreeState {
    return notesTreeState(this.snapshot());
  }

  replaceBlock(block: NotesBlock): void {
    const previous = this.blocksById[block.id];
    this.blocksById = { ...this.blocksById, [block.id]: block };
    // Conversions affect outline-based rendering even when sibling order is unchanged.
    if (previous && (previous.type !== block.type || blockIndent(previous) !== blockIndent(block))) this.syncLocalOutlines();
  }

  applyLocalUndoSnapshot(target: NotesUndoSnapshot, source: NotesUndoSnapshot): void {
    const targetIds = new Set(target.blocks.map((block) => block.id));
    const sourceIds = new Set(source.blocks.map((block) => block.id));
    const affectedIds = new Set([...targetIds, ...sourceIds]);
    const nextBlocksById = { ...this.blocksById };
    for (const blockId of sourceIds) {
      if (!targetIds.has(blockId)) delete nextBlocksById[blockId];
    }
    for (const block of target.blocks) nextBlocksById[block.id] = block;
    for (const blockId of affectedIds) this.markLocallyChanged(blockId);
    this.blocksById = nextBlocksById;
    const targetById = new Map(target.blocks.map((block) => [block.id, block]));
    const children = Object.fromEntries(Object.entries(this.childIdsByParentId)
      .map(([parentId, ids]) => [parentId, ids.filter((id) => {
        if (!affectedIds.has(id)) return true;
        const targetBlock = targetById.get(id);
        return !target.childIdsByParentId[parentId] && targetBlock !== undefined
          && parentIdForBlock(targetBlock) === parentId;
      })]));
    for (const [parentId, ids] of Object.entries(target.childIdsByParentId)) {
      const siblings = children[parentId] ?? [];
      for (let index = ids.length - 1; index >= 0; index -= 1) {
        const id = ids[index];
        if (!targetIds.has(id)) continue;
        const nextIndex = siblings.indexOf(ids[index + 1]);
        siblings.splice(nextIndex < 0 ? siblings.length : nextIndex, 0, id);
      }
      children[parentId] = siblings;
    }
    // Older recovery snapshots may not carry sibling order.
    for (const block of target.blocks) {
      const parentId = parentIdForBlock(block);
      const siblings = children[parentId] ?? [];
      if (!siblings.includes(block.id)) siblings.push(block.id);
      children[parentId] = siblings;
    }
    this.childIdsByParentId = children;
    this.blockOutlines = this.blockOutlines.filter((outline) => !sourceIds.has(outline.id) || targetIds.has(outline.id));
    this.syncLocalOutlines();
  }

  insertBlockAfter(block: NotesBlock, afterBlockId: string | null): void {
    const parentId = parentIdForBlock(block);
    const current = (this.childIdsByParentId[parentId] ?? []).filter((id) => id !== block.id);
    const afterIndex = afterBlockId ? current.indexOf(afterBlockId) : -1;
    const insertIndex = afterIndex >= 0 ? afterIndex + 1 : current.length;
    this.childIdsByParentId = {
      ...this.childIdsByParentId,
      [parentId]: [...current.slice(0, insertIndex), block.id, ...current.slice(insertIndex)],
    };
    this.replaceBlock(block);
    this.markLocallyChanged(block.id);
    this.syncLocalOutlines();
  }

  removeLeafBlock(blockId: string): boolean {
    const next = notesTreeStateWithoutLeafBlock(this.treeState(), blockId);
    if (!next) return false;
    this.markLocallyChanged(blockId);
    this.blocksById = next.blocksById;
    this.childIdsByParentId = next.childIdsByParentId;
    this.blockOutlines = this.blockOutlines.filter((outline) => outline.id !== blockId);
    this.syncLocalOutlines();
    return true;
  }

  private syncLocalOutlines(): void {
    const pageId = this.options.readSelectedPageId();
    if (pageId) this.syncHydratedOutlines(pageId);
  }

  setLoadedPage(loaded: NotesLoadedPage): void {
    this.loadedPage = loaded.page;
    const blocks = loaded.blocks.results;
    this.blocksById = Object.fromEntries(blocks.map((block) => [block.id, block]));
    this.childIdsByParentId = buildNotesChildIdsByParent(blocks);
    this.primaryContentReady = true;
  }

  replaceOutlines(outlines: readonly NotesBlockOutline[], pageId: string): void {
    this.blockOutlines = [...outlines];
    this.flatBlockOutlines = flattenNotesBlockOutlines(this.blockOutlines, pageId);
  }

  mergeOutlines(outlines: readonly NotesBlockOutline[], pageId: string): void {
    const next = new Map(this.blockOutlines.map((outline) => [outline.id, outline]));
    for (const outline of outlines) next.set(outline.id, outline);
    this.replaceOutlines([...next.values()], pageId);
  }

  syncHydratedOutlines(pageId: string): void {
    const next = new Map(this.blockOutlines.map((outline) => [outline.id, outline]));
    for (const [parentId, childIds] of Object.entries(this.childIdsByParentId)) {
      const loadedIds = new Set(childIds);
      const previous = [...next.values()].filter((outline) => (
        (outline.parent.type === "page_id" ? outline.parent.page_id : outline.parent.block_id) === parentId
      )).sort((left, right) => left.sort_order - right.sort_order);
      const ordered = [...childIds];
      // Retained, unloaded siblings stay ahead of their next known sibling.
      for (let index = previous.length - 1; index >= 0; index -= 1) {
        const outline = previous[index];
        if (loadedIds.has(outline.id)) continue;
        const following = ordered.indexOf(previous[index + 1]?.id);
        ordered.splice(following < 0 ? ordered.length : following, 0, outline.id);
      }
      ordered.forEach((blockId, index) => {
        const block = this.blocksById[blockId];
        const existing = next.get(blockId);
        const outline = block ? notesBlockOutlineFromBlock(block, pageId, index) : existing;
        if (!outline) return;
        next.set(blockId, {
          ...outline,
          sort_order: index,
          parent: parentId === pageId
            ? { type: "page_id", page_id: pageId }
            : { type: "block_id", block_id: parentId },
        });
      });
    }
    this.replaceOutlines([...next.values()], pageId);
  }

  applyPostMutation(result: NotesPostMutationResult): void {
    if (result.loadedPage !== undefined) {
      if (result.loadedPage) {
        this.setLoadedPage(result.loadedPage);
        this.blockOutlines = [];
        this.syncHydratedOutlines(result.loadedPage.page.id);
      } else {
        this.clearLoadedTree();
      }
    }
    if (result.blocks || result.placements || result.removedBlockIds) {
      const next = applyNotesPostMutationToTree(this.treeState(), result);
      this.blocksById = { ...next.blocksById };
      this.childIdsByParentId = Object.fromEntries(
        Object.entries(next.childIdsByParentId).map(([parentId, childIds]) => [parentId, [...childIds]]),
      );
      for (const block of result.blocks ?? []) this.markLocallyChanged(block.id);
      for (const blockId of result.removedBlockIds ?? []) this.markLocallyChanged(blockId);
    }
    if (this.loadedPage) {
      const returned = result.pages?.find((page) => page.id === this.loadedPage?.id);
      if (returned) this.loadedPage = returned;
      if (result.blocks || result.placements || result.removedBlockIds) {
        const removed = new Set(result.removedBlockIds ?? []);
        this.blockOutlines = this.blockOutlines.filter((outline) => !removed.has(outline.id));
        this.syncHydratedOutlines(this.loadedPage.id);
      }
    }
  }

  resetOutlines(): void {
    this.blockOutlines = [];
    this.flatBlockOutlines = [];
  }

  clearLoadedTree(): void {
    this.loadedPage = null;
    this.blocksById = {};
    this.childIdsByParentId = {};
  }

  clearSelection(): void {
    this.clearLoadedTree();
    this.resetOutlines();
    this.primaryContentReady = false;
  }
}
