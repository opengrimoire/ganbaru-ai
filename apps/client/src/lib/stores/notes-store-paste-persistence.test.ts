import { describe, expect, it, vi } from "vitest";
import { createBlockWrite } from "$lib/notes/block-factory";
import { createNotesPastePersistence } from "./notes-store-paste-persistence";

const api = vi.hoisted(() => ({ appendNotesBlockChildren: vi.fn(), duplicateNotesBlocks: vi.fn() }));
vi.mock("$lib/api/notes", () => api);

describe("pasted child-note persistence", () => {
  it("preserves mixed content order and retries without inserting completed batches again", async () => {
    api.appendNotesBlockChildren.mockResolvedValue({ results: [] });
    api.duplicateNotesBlocks.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue({ results: [] });
    const parent = { type: "page_id" as const, page_id: "page" };
    const persist = createNotesPastePersistence([{ parent, after: "current", children: [
      createBlockWrite("before", "paragraph", "Before"),
      createBlockWrite("copy", "child_page", "Note"),
      createBlockWrite("after", "paragraph", "After"),
    ] }], { copy: "source" });
    await expect(persist()).rejects.toThrow("Unavailable");
    expect(api.appendNotesBlockChildren).toHaveBeenCalledTimes(1);
    await persist();
    expect(api.appendNotesBlockChildren).toHaveBeenCalledTimes(2);
    expect(api.duplicateNotesBlocks).toHaveBeenLastCalledWith({
      block_ids: ["source"], duplicated_block_ids: [{ source_id: "source", duplicate_id: "copy" }],
      parent, after: "before", before: null, include_trashed_sources: true,
    });
    expect(api.appendNotesBlockChildren).toHaveBeenLastCalledWith({ parent, after: "copy", children: [createBlockWrite("after", "paragraph", "After")] });
    await persist();
    expect(api.appendNotesBlockChildren).toHaveBeenCalledTimes(2);
  });
});
