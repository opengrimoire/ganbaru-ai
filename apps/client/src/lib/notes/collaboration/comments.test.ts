import { describe, expect, it } from "vitest";
import { parseNotesCommentThread } from "$lib/notes/blocks/validation";
import {
  notesCommentAnchorDraft,
  notesCommentAnchorsForBlock,
  notesCommentParentKey,
  notesCommentPlainText,
  notesResolveCommentAnchor,
  notesCommentThreadSnippet,
  openNotesCommentThreadCount,
  unreadNotesCommentThreadCount,
} from "./comments";
import { createRichText } from "$lib/notes/blocks/factory";

const comment = {
  object: "comment",
  id: "10101010-1010-4010-8010-101010101010",
  parent: { type: "block_id", block_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  discussion_id: "90909090-9090-4090-8090-909090909090",
  created_time: "2026-06-30T00:00:00.000Z",
  last_edited_time: "2026-06-30T00:00:00.000Z",
  created_by: { object: "user", id: "local-user" },
  rich_text: [createRichText("Review this")],
  attachments: [],
  display_name: { type: "user", resolved_name: "You" },
  deleted_at: null,
};

describe("notes comments", () => {
  it("parses comment thread DTOs from the Tauri boundary", () => {
    const thread = parseNotesCommentThread({
      object: "comment_thread",
      id: "90909090-9090-4090-8090-909090909090",
      parent: { type: "block_id", block_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      page_id: "11111111-1111-4111-8111-111111111111",
      block_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "open",
      resolved_at: null,
      resolved_by: null,
      anchor: null,
      created_time: "2026-06-30T00:00:00.000Z",
      last_edited_time: "2026-06-30T00:00:00.000Z",
      unread: false,
      comments: [comment],
    });

    expect(thread.block_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(notesCommentPlainText(thread.comments[0])).toBe("Review this");
  });

  it("rejects workspace parents for comments", () => {
    expect(() =>
      parseNotesCommentThread({
        object: "comment_thread",
        id: "90909090-9090-4090-8090-909090909090",
        parent: { type: "workspace", workspace: true },
        page_id: "11111111-1111-4111-8111-111111111111",
        block_id: null,
        status: "open",
        resolved_at: null,
        resolved_by: null,
        anchor: null,
        created_time: "2026-06-30T00:00:00.000Z",
        last_edited_time: "2026-06-30T00:00:00.000Z",
        unread: false,
        comments: [],
      }),
    ).toThrow("comment thread.parent.type must be page_id or block_id");
  });

  it("summarizes open threads and parent keys", () => {
    const openThread = parseNotesCommentThread({
      object: "comment_thread",
      id: "90909090-9090-4090-8090-909090909090",
      parent: { type: "block_id", block_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      page_id: "11111111-1111-4111-8111-111111111111",
      block_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "open",
      resolved_at: null,
      resolved_by: null,
      anchor: null,
      created_time: "2026-06-30T00:00:00.000Z",
      last_edited_time: "2026-06-30T00:00:00.000Z",
      unread: true,
      comments: [comment],
    });
    const resolvedThread = { ...openThread, id: "80808080-8080-4080-8080-808080808080", status: "resolved" as const };

    expect(openNotesCommentThreadCount([openThread, resolvedThread])).toBe(1);
    expect(unreadNotesCommentThreadCount([openThread, resolvedThread])).toBe(2);
    expect(notesCommentThreadSnippet(openThread)).toBe("Review this");
    expect(notesCommentParentKey(openThread.parent)).toBe("block:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("parses and resolves inline text anchors", () => {
    const thread = parseNotesCommentThread({
      object: "comment_thread",
      id: "90909090-9090-4090-8090-909090909090",
      parent: { type: "block_id", block_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      page_id: "11111111-1111-4111-8111-111111111111",
      block_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "open",
      resolved_at: null,
      resolved_by: null,
      anchor: {
        object: "comment_anchor",
        type: "text_range",
        block_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        start: 6,
        end: 10,
        text: "beta",
        prefix: "Alpha ",
        suffix: " gamma",
        created_time: "2026-06-30T00:00:00.000Z",
        last_edited_time: "2026-06-30T00:00:00.000Z",
      },
      created_time: "2026-06-30T00:00:00.000Z",
      last_edited_time: "2026-06-30T00:00:00.000Z",
      unread: false,
      comments: [comment],
    });

    expect(notesResolveCommentAnchor(thread, "Alpha beta gamma")).toMatchObject({
      start: 6,
      end: 10,
      text: "beta",
    });
    expect(notesResolveCommentAnchor(thread, "Intro Alpha beta gamma")).toMatchObject({
      start: 12,
      end: 16,
    });
    expect(notesCommentAnchorsForBlock(
      [thread],
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "Intro Alpha beta gamma",
    )).toHaveLength(1);
    expect(notesResolveCommentAnchor(thread, "Alpha gamma")).toBeNull();
  });

  it("creates inline anchor drafts from selections", () => {
    expect(notesCommentAnchorDraft("Alpha beta gamma", 6, 10)).toEqual({
      start: 6,
      end: 10,
      text: "beta",
      prefix: "Alpha ",
      suffix: " gamma",
    });
    expect(notesCommentAnchorDraft("Alpha beta gamma", 0, 0)).toBeNull();
    expect(notesCommentAnchorDraft("Alpha beta gamma", 5, 6)).toBeNull();
  });
});
