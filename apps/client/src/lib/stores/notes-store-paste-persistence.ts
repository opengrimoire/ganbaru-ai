import { appendNotesBlockChildren, duplicateNotesBlocks, duplicateNotesDatabase } from "$lib/api/notes";
import type { NotesAppendBlockChildrenRequest, NotesCreatedDatabase } from "$lib/notes/types";

/** Persist pasted notes through page-aware duplication, preserving order and completed batches on retry. */
export function createNotesPastePersistence(
  requests: readonly NotesAppendBlockChildrenRequest[],
  copiedPageIds: Readonly<Record<string, string>> = {},
  copiedDatabaseIds: Readonly<Record<string, string>> = {},
  onDatabaseCreated?: (id: string, created: NotesCreatedDatabase) => void,
): () => Promise<void> {
  const steps: Array<() => Promise<unknown>> = [];
  for (const request of requests) {
    let after = request.after ?? null;
    let children: NotesAppendBlockChildrenRequest["children"] = [];
    const flush = (): void => {
      if (!children.length) return;
      const batch = { parent: request.parent, after, children };
      steps.push(() => appendNotesBlockChildren(batch));
      after = children.at(-1)!.id;
      children = [];
    };
    for (const child of request.children) {
      const databaseId = copiedDatabaseIds[child.id];
      if (databaseId) {
        flush();
        const duplicateRequest = { id: child.id, source_block_id: databaseId, parent: request.parent, after_block_id: after };
        steps.push(async () => {
          const created = await duplicateNotesDatabase(duplicateRequest);
          onDatabaseCreated?.(child.id, created);
        });
        after = child.id;
        continue;
      }
      const sourceId = copiedPageIds[child.id];
      if (!sourceId) { children.push(child); continue; }
      flush();
      const duplicateRequest = {
        block_ids: [sourceId],
        duplicated_block_ids: [{ source_id: sourceId, duplicate_id: child.id }],
        parent: request.parent,
        after,
        before: null,
        include_trashed_sources: true,
      };
      steps.push(() => duplicateNotesBlocks(duplicateRequest));
      after = child.id;
    }
    flush();
  }
  let completed = 0;
  return async () => {
    while (completed < steps.length) {
      await steps[completed]();
      completed += 1;
    }
  };
}
