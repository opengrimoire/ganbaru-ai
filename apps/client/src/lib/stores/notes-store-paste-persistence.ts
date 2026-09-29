import { appendNotesBlockChildren, duplicateNotesBlocks } from "$lib/api/notes";
import type { NotesAppendBlockChildrenRequest } from "$lib/notes/types";

/** Persist pasted notes through page-aware duplication, preserving order and completed batches on retry. */
export function createNotesPastePersistence(
  requests: readonly NotesAppendBlockChildrenRequest[],
  copiedPageIds: Readonly<Record<string, string>> = {},
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
