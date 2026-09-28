import { describe, expect, it, vi } from "vitest";
import { createBlockWrite, createRichText } from "$lib/notes/block-factory";
import type { NotesBlock, NotesPage } from "$lib/notes/types";
import { NotesTreeProjectionController } from "./notes-store-tree-projection.svelte";

function page(id: string, title: string): NotesPage {
  return {
    object: "page",
    id,
    created_time: "2026-07-03T00:00:00.000Z",
    last_edited_time: "2026-07-04T00:00:00.000Z",
    parent: { type: "workspace", workspace: true },
    folder_id: null,
    in_trash: false,
    archived: false,
    icon: null,
    cover: null,
    properties: { title: { id: "title", type: "title", title: [createRichText(title)] } },
    url: null,
    public_url: null,
    source_provider: null,
    source_object_id: null,
    source_workspace_id: null,
    source_last_edited_time: null,
  };
}

describe("Notes tree projection", () => {
  it("updates a loaded parent document's child page title after a rename", () => {
    const parentPage = page("parent-page", "Parent");
    const childWrite = createBlockWrite("child-page", "child_page", "Old title");
    if (childWrite.type !== "child_page") throw new Error("expected a child page block");
    const childBlock: NotesBlock = {
      object: "block",
      parent: { type: "page_id", page_id: parentPage.id },
      created_time: parentPage.created_time,
      last_edited_time: parentPage.created_time,
      has_children: false,
      in_trash: false,
      archived: false,
      source_provider: null,
      source_object_id: null,
      source_last_edited_time: null,
      ...childWrite,
    };
    const projection = new NotesTreeProjectionController({
      readSelectedPageId: () => parentPage.id,
    });
    const markLocallyChanged = vi.fn();
    projection.setLocalChangeMarker(markLocallyChanged);
    projection.setLoadedPage({
      page: parentPage,
      blocks: {
        object: "list",
        type: "block",
        block: {},
        results: [childBlock],
        next_cursor: null,
        has_more: false,
      },
    });

    projection.applyPostMutation({ pages: [page(childBlock.id, "New title")] });

    const updated = projection.blocksById[childBlock.id];
    expect(updated?.type).toBe("child_page");
    if (updated?.type !== "child_page") return;
    expect(updated.child_page.title).toBe("New title");
    expect(markLocallyChanged).not.toHaveBeenCalled();
  });
});
