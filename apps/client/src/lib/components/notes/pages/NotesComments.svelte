<script lang="ts">
  import { onMount } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { blockPlainText } from "$lib/notes/blocks/factory";
  import {
    notesCommentParentKey,
    notesCommentPlainText,
    notesResolveCommentAnchor,
  } from "$lib/notes/collaboration/comments";
  import type { NotesComment, NotesCommentParent, NotesCommentThread } from "$lib/notes/types";
  import { getNotesEditor } from "$lib/components/notes/editor-context";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import { scrollEdgeFadeAction } from "$lib/utils/scroll-edge-fade";

  const notes = getNotesEditor();
  const localization = getLocalization();
  const { t } = localization;
  let { embedded = false }: { embedded?: boolean } = $props();
  let open = $state(false);
  let newCommentDraft = $state("");
  let newCommentInput: HTMLTextAreaElement | null = $state(null);
  let replyThreadId = $state<string | null>(null);
  let replyDrafts = $state<Record<string, string>>({});
  let editingCommentId = $state<string | null>(null);
  let editingDraft = $state("");
  let lastMarkedReadKey = $state("");
  const activeParent = $derived(notes.activeCommentParent ?? pageCommentParent());
  const unreadThreadKey = $derived(
    notes.commentThreads
      .filter((thread) => thread.unread)
      .map((thread) => `${thread.id}:${thread.last_edited_time}`)
      .join("|"),
  );
  const panelOpen = $derived(embedded || open);

  onMount(() => {
    if (!embedded) return;
    const frame = requestAnimationFrame(() => newCommentInput?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (notes.activeCommentParent) open = true;
  });

  $effect(() => {
    if (!panelOpen || notes.commentsLoading || !unreadThreadKey || unreadThreadKey === lastMarkedReadKey) return;
    lastMarkedReadKey = unreadThreadKey;
    void notes.markVisibleCommentThreadsRead().catch((error) => {
      lastMarkedReadKey = "";
      console.warn("mark notes comments read failed", error);
    });
  });

  function pageCommentParent(): NotesCommentParent | null {
    return notes.selectedPageId ? { type: "page_id", page_id: notes.selectedPageId } : null;
  }

  function parentLabel(parent: NotesCommentParent | null): string {
    if (!parent || parent.type === "page_id") return t("notes.pageDiscussion");
    if (notes.activeCommentAnchor && notes.activeCommentParent) {
      return t("notes.inlineCommentOn", notes.activeCommentAnchor.text);
    }
    const block = notes.blockById(parent.block_id);
    const text = block ? blockPlainText(block).trim() : "";
    return text ? t("notes.blockCommentOn", text) : t("notes.blockComment");
  }

  function threadLabel(thread: NotesCommentThread): string {
    if (thread.parent.type === "page_id") return t("notes.pageDiscussion");
    if (thread.anchor) return t("notes.inlineCommentOn", thread.anchor.text);
    const blockId = thread.block_id ?? thread.parent.block_id;
    const block = notes.blockById(blockId);
    const text = block ? blockPlainText(block).trim() : "";
    return text ? t("notes.blockCommentOn", text) : t("notes.blockComment");
  }

  function isThreadAnchorMissing(thread: NotesCommentThread): boolean {
    if (!thread.anchor || !thread.block_id) return false;
    const block = notes.blockById(thread.block_id);
    return !block || !notesResolveCommentAnchor(thread, blockPlainText(block));
  }

  function commentTime(comment: NotesComment): string {
    return new Date(comment.last_edited_time).toLocaleString(localization.locale);
  }

  function displayName(comment: NotesComment): string {
    return comment.display_name.resolved_name;
  }

  async function addComment(): Promise<void> {
    const parent = activeParent;
    if (!parent || !newCommentDraft.trim()) return;
    await notes.createComment(newCommentDraft, parent);
    newCommentDraft = "";
  }

  async function addReply(thread: NotesCommentThread): Promise<void> {
    const draft = replyDrafts[thread.id] ?? "";
    if (!draft.trim()) return;
    await notes.replyToCommentThread(thread.id, draft);
    replyDrafts = { ...replyDrafts, [thread.id]: "" };
    replyThreadId = null;
  }

  function startEdit(comment: NotesComment): void {
    editingCommentId = comment.id;
    editingDraft = notesCommentPlainText(comment);
  }

  async function saveEdit(comment: NotesComment): Promise<void> {
    if (!editingDraft.trim()) return;
    await notes.updateComment(comment.id, editingDraft);
    editingCommentId = null;
    editingDraft = "";
  }

  function cancelDraftParent(): void {
    notes.setActiveCommentParent(null);
    newCommentDraft = "";
  }

  function isActiveParent(parent: NotesCommentParent | null): boolean {
    return !!parent && !!activeParent && notesCommentParentKey(parent) === notesCommentParentKey(activeParent);
  }
</script>

<div class={embedded ? "flex min-h-0 min-w-0 flex-col" : "mt-2"}>
  {#if !embedded}
    <button
      class="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[0.733333rem] text-muted-foreground hover:bg-accent hover:text-foreground"
      type="button"
      aria-expanded={open}
      onclick={() => {
        open = !open;
      }}
    >
      <MessageSquare class="size-3.5" />
      <span>
        {#if notes.commentsLoading}
          {t("notes.loadingComments")}
        {:else}
          {t("notes.pageDiscussion")}
        {/if}
      </span>
      <ChevronDown class={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  {/if}

  {#if panelOpen}
    <section class={embedded ? "flex min-h-0 flex-col" : "mt-2 max-w-3xl rounded-xl border border-border bg-popover shadow-sm"}>
      <div class="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
        <div class="min-w-0">
          <div class="truncate text-[0.933333rem] font-semibold text-foreground">
            {parentLabel(activeParent)}
          </div>
        </div>
        <label class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[0.733333rem] text-muted-foreground hover:text-foreground">
          <Checkbox
            checked={notes.commentsIncludeResolved}
            onChange={(checked) => {
              void notes.setCommentsIncludeResolved(checked);
            }}
          />
          <span>{t("notes.showResolvedComments")}</span>
        </label>
      </div>

      {#if notes.commentsError}
        <div class="mx-4 mt-3 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-[0.8rem] text-destructive" role="alert">
          {t("notes.loadCommentsFailed", notes.commentsError)}
        </div>
      {/if}

      <div class="flex min-w-0 flex-col gap-2 px-4 pb-3 pt-2">
        <textarea
          bind:this={newCommentInput}
          class="field min-h-18 w-full resize-y px-3 py-2 text-[0.866667rem]"
          bind:value={newCommentDraft}
          placeholder={t("notes.commentPlaceholder")}
          aria-label={t("notes.commentInput")}
        ></textarea>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <button
            class="h-8 rounded-md bg-primary px-3 text-[0.8rem] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={!newCommentDraft.trim() || !activeParent}
            onclick={() => {
              void addComment();
            }}
          >
            {t("notes.addComment")}
          </button>
          {#if notes.activeCommentParent && !isActiveParent(pageCommentParent())}
            <button
              class="rounded-md px-2.5 py-1.5 text-[0.8rem] text-muted-foreground hover:bg-accent hover:text-foreground"
              type="button"
              onclick={cancelDraftParent}
            >
              {t("common.cancel")}
            </button>
          {/if}
        </div>
      </div>

      <div class="min-h-0 min-w-0 space-y-2 overflow-y-auto px-1 pb-2" use:scrollEdgeFadeAction>
        {#if notes.commentsLoading && notes.commentThreads.length === 0}
          <div class="px-4 py-6 text-center text-[0.8rem] text-muted-foreground">{t("notes.loadingComments")}</div>
        {:else if notes.commentThreads.length === 0}
          <div class="flex flex-col items-center gap-2 px-4 py-8 text-center text-muted-foreground">
            <MessageSquare class="size-5" strokeWidth={1.5} />
            <span class="text-[0.8rem]">{t("notes.noComments")}</span>
          </div>
        {:else}
          {#each notes.commentThreads as thread (thread.id)}
            <article
              class={`rounded-lg px-3 py-3 ${
                thread.unread
                  ? "bg-primary/5"
                  : ""
              }`}
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                    <div class="line-clamp-2 text-[0.8rem] font-medium text-foreground">
                      {threadLabel(thread)}
                    </div>
                    {#if thread.unread}
                      <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[0.7rem] font-medium text-primary">
                        {t("notes.unreadCommentThread")}
                      </span>
                    {/if}
                  </div>
                  {#if isThreadAnchorMissing(thread)}
                    <div class="mt-0.5 text-[0.733333rem] text-muted-foreground">
                      {t("notes.inlineCommentAnchorMissing")}
                    </div>
                  {/if}
                </div>
                <button
                  class="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[0.733333rem] text-muted-foreground hover:bg-accent hover:text-foreground"
                  type="button"
                  onclick={() => {
                    void notes.setCommentThreadResolved(thread.id, thread.status !== "resolved");
                  }}
                >
                  {#if thread.status === "resolved"}
                    <RotateCcw class="size-3.5" />
                    <span>{t("notes.reopenCommentThread")}</span>
                  {:else}
                    <Check class="size-3.5" />
                    <span>{t("notes.resolveCommentThread")}</span>
                  {/if}
                </button>
              </div>

              <div class="mt-3 flex min-w-0 flex-col gap-3">
                {#each thread.comments as comment (comment.id)}
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center justify-between gap-2 text-[0.733333rem] text-muted-foreground">
                      <span>{displayName(comment)}, {commentTime(comment)}</span>
                      <span class="flex items-center gap-1">
                        <button
                          class="rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                          type="button"
                          onclick={() => startEdit(comment)}
                        >
                          {t("common.edit")}
                        </button>
                        <button
                          class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-destructive hover:bg-accent"
                          type="button"
                          onclick={() => {
                            void notes.deleteComment(comment.id);
                          }}
                        >
                          <Trash2 class="size-3" />
                          <span>{t("common.delete")}</span>
                        </button>
                      </span>
                    </div>
                    {#if editingCommentId === comment.id}
                      <textarea
                        class="field mt-1 min-h-14 w-full resize-y py-1.5 text-[0.866667rem]"
                        bind:value={editingDraft}
                        aria-label={t("notes.editCommentInput")}
                      ></textarea>
                      <div class="mt-1 flex gap-2">
                        <button
                          class="rounded-md bg-primary px-2 py-1 text-[0.733333rem] font-medium text-primary-foreground disabled:opacity-50"
                          type="button"
                          disabled={!editingDraft.trim()}
                          onclick={() => {
                            void saveEdit(comment);
                          }}
                        >
                          {t("common.save")}
                        </button>
                        <button
                          class="rounded-md px-2 py-1 text-[0.733333rem] text-muted-foreground hover:bg-accent hover:text-foreground"
                          type="button"
                          onclick={() => {
                            editingCommentId = null;
                            editingDraft = "";
                          }}
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    {:else}
                      <div class="mt-1 whitespace-pre-wrap text-[0.866667rem] text-foreground">
                        {notesCommentPlainText(comment)}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>

              {#if replyThreadId === thread.id}
                <div class="mt-2">
                  <textarea
                    class="field min-h-14 w-full resize-y py-1.5 text-[0.866667rem]"
                    value={replyDrafts[thread.id] ?? ""}
                    placeholder={t("notes.replyPlaceholder")}
                    aria-label={t("notes.replyCommentInput")}
                    oninput={(event) => {
                      replyDrafts = { ...replyDrafts, [thread.id]: event.currentTarget.value };
                    }}
                  ></textarea>
                  <div class="mt-1 flex gap-2">
                    <button
                      class="rounded-md bg-primary px-2 py-1 text-[0.733333rem] font-medium text-primary-foreground disabled:opacity-50"
                      type="button"
                      disabled={!(replyDrafts[thread.id] ?? "").trim()}
                      onclick={() => {
                        void addReply(thread);
                      }}
                    >
                      {t("notes.reply")}
                    </button>
                    <button
                      class="rounded-md px-2 py-1 text-[0.733333rem] text-muted-foreground hover:bg-accent hover:text-foreground"
                      type="button"
                      onclick={() => {
                        replyThreadId = null;
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              {:else if thread.status === "open"}
                <button
                  class="mt-2 rounded-md px-2 py-1 text-[0.733333rem] text-muted-foreground hover:bg-accent hover:text-foreground"
                  type="button"
                  onclick={() => {
                    replyThreadId = thread.id;
                  }}
                >
                  {t("notes.reply")}
                </button>
              {/if}
            </article>
          {/each}
        {/if}
      </div>
    </section>
  {/if}
</div>
