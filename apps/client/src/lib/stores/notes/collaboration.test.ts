import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NotesCommentParent,
  NotesCommentThread,
  NotesCommentThreadReadUpdate,
} from "$lib/notes/types";
import { createNotesCollaborationController } from "./collaboration.svelte";

const backend = vi.hoisted(() => ({
  threads: [] as NotesCommentThread[],
  calls: [] as Array<{ pageId: string; includeResolved: boolean }>,
  readCalls: [] as Array<{ includeResolved: boolean; ids: string[] }>,
  fullReadGate: null as Promise<void> | null,
}));

vi.mock("$lib/api/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/api/notes")>();
  return {
    ...actual,
    listNotesComments: async (pageId: string, includeResolved: boolean) => {
      backend.calls.push({ pageId, includeResolved });
      const matching = backend.threads.filter((thread) =>
        thread.page_id === pageId && (includeResolved || thread.status === "open"));
      if (includeResolved && backend.fullReadGate) await backend.fullReadGate;
      return matching;
    },
    markNotesCommentThreadsRead: async (request: NotesCommentThreadReadUpdate) => {
      backend.readCalls.push({
        includeResolved: request.include_resolved ?? false,
        ids: [...request.discussion_ids],
      });
      backend.threads = backend.threads.map((thread) =>
        request.discussion_ids.includes(thread.id) ? { ...thread, unread: false } : thread);
      return backend.threads.filter((thread) =>
        thread.page_id === request.page_id
        && (request.include_resolved || thread.status === "open"));
    },
    resolveNotesCommentThread: async (id: string, resolved: boolean) => {
      const thread = backend.threads.find((candidate) => candidate.id === id);
      if (!thread) throw new Error("Missing comment thread fixture");
      const updated: NotesCommentThread = {
        ...thread,
        status: resolved ? "resolved" : "open",
        resolved_at: resolved ? "2026-01-02T00:00:00.000Z" : null,
      };
      backend.threads = backend.threads.map((candidate) => candidate.id === id ? updated : candidate);
      return updated;
    },
  };
});

function commentThread(id: string, pageId: string, status: "open" | "resolved"): NotesCommentThread {
  const parent: NotesCommentParent = { type: "page_id", page_id: pageId };
  return {
    object: "comment_thread",
    id,
    parent,
    page_id: pageId,
    block_id: null,
    status,
    resolved_at: status === "resolved" ? "2026-01-02T00:00:00.000Z" : null,
    resolved_by: null,
    anchor: null,
    created_time: "2026-01-01T00:00:00.000Z",
    last_edited_time: "2026-01-01T00:00:00.000Z",
    unread: false,
    comments: [{
      object: "comment",
      id: `${id}-comment`,
      parent,
      discussion_id: id,
      created_time: "2026-01-01T00:00:00.000Z",
      last_edited_time: "2026-01-01T00:00:00.000Z",
      created_by: { object: "user", id: "local-user" },
      rich_text: [],
      attachments: [],
      display_name: { type: "user", resolved_name: "Local user" },
      deleted_at: null,
    }],
  };
}

function controllerForPage(readPageId: () => string) {
  return createNotesCollaborationController({
    readSelectedPageId: readPageId,
    readBlocksById: () => ({}),
    flushBlockSave: async () => undefined,
    requestBlockFocus: () => undefined,
    updateBlockRichText: async () => undefined,
    isPanelOpen: () => true,
  });
}

beforeEach(() => {
  backend.threads = [
    commentThread("open-a", "page-a", "open"),
    commentThread("resolved-a", "page-a", "resolved"),
    commentThread("open-b", "page-b", "open"),
    commentThread("resolved-b", "page-b", "resolved"),
  ];
  backend.calls = [];
  backend.readCalls = [];
  backend.fullReadGate = null;
});

describe("Notes resolved comment visibility", () => {
  it("loads all threads with the page and filters every toggle locally", async () => {
    let pageId = "page-a";
    const controller = controllerForPage(() => pageId);

    await controller.reloadComments();
    expect(controller.commentThreads.map((thread) => thread.id)).toEqual(["open-a"]);
    await controller.setCommentsIncludeResolved(true);
    expect(controller.commentThreads.map((thread) => thread.id)).toEqual(["open-a", "resolved-a"]);
    await controller.setCommentsIncludeResolved(false);
    expect(controller.commentThreads.map((thread) => thread.id)).toEqual(["open-a"]);
    await controller.setCommentsIncludeResolved(true);
    expect(controller.commentThreads.map((thread) => thread.id)).toEqual(["open-a", "resolved-a"]);
    expect(backend.calls).toEqual([{ pageId: "page-a", includeResolved: true }]);

    await controller.setCommentsIncludeResolved(false);
    pageId = "page-b";
    await controller.reloadComments();
    expect(controller.commentThreads.map((thread) => thread.id)).toEqual(["open-b"]);
    expect(backend.calls.at(-1)).toEqual({ pageId: "page-b", includeResolved: true });
  });

  it("applies the latest visibility choice to a pending page read", async () => {
    const controller = controllerForPage(() => "page-a");
    let releaseRead: () => void = () => undefined;
    backend.fullReadGate = new Promise<void>((resolve) => { releaseRead = resolve; });

    const pendingRead = controller.reloadComments();
    expect(controller.commentsLoading).toBe(true);
    await controller.setCommentsIncludeResolved(true);
    await controller.setCommentsIncludeResolved(false);
    await controller.setCommentsIncludeResolved(true);
    expect(backend.calls).toEqual([{ pageId: "page-a", includeResolved: true }]);

    releaseRead();
    await pendingRead;
    expect(controller.commentThreads.map((thread) => thread.id)).toEqual(["open-a", "resolved-a"]);
    await controller.setCommentsIncludeResolved(false);
    expect(controller.commentThreads.map((thread) => thread.id)).toEqual(["open-a"]);
  });

  it("preserves resolved threads across resolution and read updates", async () => {
    backend.threads = backend.threads.map((thread) =>
      thread.id === "open-a" ? { ...thread, unread: true } : thread);
    const controller = controllerForPage(() => "page-a");
    await controller.reloadComments();
    await controller.setCommentsIncludeResolved(true);
    await controller.setCommentsIncludeResolved(false);

    await controller.markVisibleCommentThreadsRead();
    expect(backend.readCalls).toEqual([{ includeResolved: true, ids: ["open-a"] }]);
    expect(controller.commentThreads[0].unread).toBe(false);
    await controller.setCommentThreadResolved("open-a", true);
    expect(controller.commentThreads).toEqual([]);
    await controller.setCommentsIncludeResolved(true);
    expect(controller.commentThreads.map((thread) => thread.id)).toEqual(["open-a", "resolved-a"]);
    expect(backend.calls).toEqual([{ pageId: "page-a", includeResolved: true }]);
  });

  it("uses the backend read state for visible resolved threads", async () => {
    backend.threads = backend.threads.map((thread) =>
      thread.id === "resolved-a" ? { ...thread, unread: true } : thread);
    const controller = controllerForPage(() => "page-a");
    await controller.reloadComments();
    await controller.setCommentsIncludeResolved(true);

    await controller.markVisibleCommentThreadsRead();
    expect(backend.readCalls).toEqual([{ includeResolved: true, ids: ["resolved-a"] }]);
    expect(controller.commentThreads.find((thread) => thread.id === "resolved-a")?.unread).toBe(false);
    await controller.setCommentsIncludeResolved(false);
    await controller.setCommentsIncludeResolved(true);
    expect(backend.calls.filter((call) => call.includeResolved)).toHaveLength(1);
  });

  it("refreshes a pending page read after a comment changes", async () => {
    const controller = controllerForPage(() => "page-a");
    let releaseRead: () => void = () => undefined;
    backend.fullReadGate = new Promise<void>((resolve) => { releaseRead = resolve; });

    const pendingRead = controller.reloadComments();
    await controller.setCommentThreadResolved("open-a", true);
    expect(backend.calls.filter((call) => call.includeResolved)).toHaveLength(2);

    releaseRead();
    await pendingRead;
    await vi.waitFor(() => {
      expect(controller.commentsLoading).toBe(false);
      expect(controller.commentThreads).toEqual([]);
    });
    await controller.setCommentsIncludeResolved(true);
    expect(controller.commentThreads.every((thread) => thread.status === "resolved")).toBe(true);
  });
});
