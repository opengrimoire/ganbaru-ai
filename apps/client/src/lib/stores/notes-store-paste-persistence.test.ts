import { describe, expect, it, vi } from "vitest";
import { createBlockWrite } from "$lib/notes/block-factory";
import { createNotesPastePersistence } from "./notes-store-paste-persistence";

const api = vi.hoisted(() => ({ appendNotesBlockChildren: vi.fn(), duplicateNotesBlocks: vi.fn(), duplicateNotesDatabase: vi.fn() }));
vi.mock("$lib/api/notes", () => api);

describe("pasted child-note persistence", () => {
  it("copies a database with canonical identities and retries only the unfinished trailing content", async () => {
    vi.clearAllMocks();
    const created = { block: { id: "copy", type: "child_database" } };
    api.duplicateNotesDatabase.mockResolvedValue(created);
    api.appendNotesBlockChildren.mockResolvedValueOnce({ results: [] }).mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue({ results: [] });
    const parent = { type: "page_id" as const, page_id: "page" };
    const accept = vi.fn();
    const persist = createNotesPastePersistence([{ parent, after: "current", children: [
      createBlockWrite("before", "paragraph", "Before"), createBlockWrite("copy", "child_database", "Tasks"), createBlockWrite("after", "paragraph", "After"),
    ] }], {}, { copy: "source" }, accept);
    await expect(persist()).rejects.toThrow("Unavailable");
    expect(api.duplicateNotesDatabase).toHaveBeenCalledExactlyOnceWith({ id: "copy", source_block_id: "source", parent, after_block_id: "before" });
    expect(accept).toHaveBeenCalledExactlyOnceWith("copy", created);
    await persist();
    expect(api.duplicateNotesDatabase).toHaveBeenCalledTimes(1);
    expect(api.appendNotesBlockChildren).toHaveBeenLastCalledWith({ parent, after: "copy", children: [createBlockWrite("after", "paragraph", "After")] });
  });
  it("preserves mixed content order and retries without inserting completed batches again", async () => {
    vi.clearAllMocks();
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
