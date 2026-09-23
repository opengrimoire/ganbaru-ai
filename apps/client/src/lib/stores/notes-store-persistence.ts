import { updateNotesBlock } from "$lib/api/notes";
import { applyBlockUpdate } from "$lib/notes/block-factory";
import type { NotesBlock, NotesBlockUpdate } from "$lib/notes/types";

interface PendingBlockSave {
  timer: ReturnType<typeof setTimeout>;
  update: NotesBlockUpdate;
}

export interface NotesBlockPersistenceContext {
  readBlock: (blockId: string) => NotesBlock | undefined;
  beforeSave: (blockId: string) => Promise<void>;
  replaceBlock: (block: NotesBlock) => void;
  setLoadError: (message: string) => void;
  debounceMs: number;
}

export interface NotesBlockPersistence {
  hasLocalChanges: (blockId: string) => boolean;
  localApplyBlockUpdate: (blockId: string, update: NotesBlockUpdate) => void;
  markBlockLocallyChanged: (blockId: string) => void;
  saveBlockNow: (blockId: string, update: NotesBlockUpdate) => Promise<void>;
  scheduleBlockSave: (blockId: string, update: NotesBlockUpdate) => void;
  flushBlockSave: (blockId: string) => Promise<void>;
  flushPendingBlockSaves: () => Promise<void>;
}

/**
 * Create debounced block persistence helpers for the Notes store.
 */
export function createNotesBlockPersistence(
  context: NotesBlockPersistenceContext,
): NotesBlockPersistence {
  const pendingBlockSaves = new Map<string, PendingBlockSave>();
  const blockRevisions = new Map<string, number>();
  const saveChains = new Map<string, Promise<void>>();

  function markBlockLocallyChanged(blockId: string): void {
    blockRevisions.set(blockId, (blockRevisions.get(blockId) ?? 0) + 1);
  }

  function hasLocalChanges(blockId: string): boolean {
    return blockRevisions.has(blockId);
  }

  function localApplyBlockUpdate(blockId: string, update: NotesBlockUpdate): void {
    const block = context.readBlock(blockId);
    if (!block) return;
    markBlockLocallyChanged(blockId);
    context.replaceBlock(applyBlockUpdate(block, update));
  }

  async function saveBlockNow(blockId: string, update: NotesBlockUpdate): Promise<void> {
    const revision = blockRevisions.get(blockId) ?? 0;
    const previous = saveChains.get(blockId) ?? Promise.resolve();
    const save = previous
      .catch(() => undefined)
      .then(async () => {
        await context.beforeSave(blockId);
        const saved = await updateNotesBlock(blockId, update);
        if ((blockRevisions.get(blockId) ?? 0) === revision) {
          blockRevisions.delete(blockId);
          if (context.readBlock(blockId)) context.replaceBlock(saved);
        }
      });
    saveChains.set(blockId, save);
    try {
      await save;
    } finally {
      if (saveChains.get(blockId) === save) saveChains.delete(blockId);
    }
  }

  function scheduleBlockSave(blockId: string, update: NotesBlockUpdate): void {
    const pending = pendingBlockSaves.get(blockId);
    if (pending) clearTimeout(pending.timer);
    const timer = setTimeout(() => {
      void saveBlockNow(blockId, update)
        .then(() => {
          if (pendingBlockSaves.get(blockId)?.update === update) {
            pendingBlockSaves.delete(blockId);
          }
        })
        .catch((error) => {
          context.setLoadError(error instanceof Error ? error.message : String(error));
        });
    }, context.debounceMs);
    pendingBlockSaves.set(blockId, { timer, update });
  }

  async function flushBlockSave(blockId: string): Promise<void> {
    const pending = pendingBlockSaves.get(blockId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingBlockSaves.delete(blockId);
      await saveBlockNow(blockId, pending.update);
      return;
    }
    await saveChains.get(blockId);
  }

  async function flushPendingBlockSaves(): Promise<void> {
    const blockIds = [...pendingBlockSaves.keys()];
    await Promise.all(blockIds.map((blockId) => flushBlockSave(blockId)));
  }

  return {
    hasLocalChanges,
    localApplyBlockUpdate,
    markBlockLocallyChanged,
    saveBlockNow,
    scheduleBlockSave,
    flushBlockSave,
    flushPendingBlockSaves,
  };
}
