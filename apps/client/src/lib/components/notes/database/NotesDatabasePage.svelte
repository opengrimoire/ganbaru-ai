<script lang="ts">
  import { untrack } from "svelte";
  import FileText from "@lucide/svelte/icons/file-text";
  import Share2 from "@lucide/svelte/icons/share-2";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    beginLazyComponentLoad,
    rejectLazyComponentLoad,
    resolveLazyComponentLoad,
    type LazyComponentLoadState,
  } from "$lib/lazy-component-loader";
  import type { NotesEditorStore } from "$lib/stores/notes/editor-session.svelte";
  import { portal } from "$lib/utils/portal";
  import {
    loadNotesAdvancedBlock,
    loadNotesEditorPanel,
    readNotesAdvancedBlock,
    readNotesEditorPanel,
    retryNotesAdvancedBlock,
    retryNotesEditorPanel,
    type LoadedNotesAdvancedBlock,
    type LoadedNotesEditorPanel,
  } from "$lib/components/notes/editor-component-registry";
  import NotesLoadingSkeleton from "$lib/components/notes/NotesLoadingSkeleton.svelte";

  let {
    editorStore,
    mobileLayout = false,
    pageActionsTarget = null,
  }: {
    editorStore: NotesEditorStore;
    mobileLayout?: boolean;
    pageActionsTarget?: HTMLElement | null;
  } = $props();

  const { t } = getLocalization();
  const block = $derived(editorStore.selectedDatabaseBlock);
  const databaseTitle = $derived(block?.child_database.title || t("notes.untitled"));
  let actionError = $state<string | null>(null);
  let deleting = $state(false);
  let shareButton = $state<HTMLButtonElement | null>(null);
  let shareOpen = $state(false);
  let sharePanelLoadState = $state<LazyComponentLoadState<"share", LoadedNotesEditorPanel> | null>(
    untrack(() => {
      const component = readNotesEditorPanel("share");
      return component ? { key: "share", status: "ready", requestId: 0, component } : null;
    }),
  );
  let rendererLoadState = $state<LazyComponentLoadState<
    "child-database",
    LoadedNotesAdvancedBlock
  > | null>(untrack(() => {
    const component = readNotesAdvancedBlock("child-database");
    return component ? { key: "child-database", status: "ready", requestId: 0, component } : null;
  }));

  /** Reuse the lazy block renderer and its bounded database session snapshots. */
  function requestRenderer(retry = false): void {
    if (!retry && rendererLoadState) return;
    const loading = beginLazyComponentLoad(rendererLoadState, "child-database");
    rendererLoadState = loading;
    const request = retry ? retryNotesAdvancedBlock("child-database") : loadNotesAdvancedBlock("child-database");
    void request.then((component) => {
      if (!rendererLoadState) return;
      rendererLoadState = resolveLazyComponentLoad(rendererLoadState, "child-database", loading.requestId, component);
    }).catch((error: unknown) => {
      if (!rendererLoadState) return;
      rendererLoadState = rejectLazyComponentLoad(rendererLoadState, "child-database", loading.requestId, error);
      console.error("Load Notes database page failed", error);
    });
  }

  /** Load the share popover only when the database page needs it. */
  function requestSharePanel(retry = false): void {
    if (!retry && sharePanelLoadState) return;
    const loading = beginLazyComponentLoad(sharePanelLoadState, "share");
    sharePanelLoadState = loading;
    const request = retry ? retryNotesEditorPanel("share") : loadNotesEditorPanel("share");
    void request.then((component) => {
      if (!sharePanelLoadState) return;
      sharePanelLoadState = resolveLazyComponentLoad(sharePanelLoadState, "share", loading.requestId, component);
    }).catch((error: unknown) => {
      if (!sharePanelLoadState) return;
      sharePanelLoadState = rejectLazyComponentLoad(sharePanelLoadState, "share", loading.requestId, error);
      console.error("Load Notes share panel failed", error);
    });
  }

  /** Toggle the share popover, loading its surface only on first use. */
  function toggleSharePanel(): void {
    shareOpen = !shareOpen;
    if (shareOpen) requestSharePanel();
  }

  /** Delete through the store's shared confirmation and mutation boundary. */
  async function deleteDatabase(blockId = block?.id): Promise<boolean> {
    if (!blockId || deleting) return false;
    deleting = true;
    actionError = null;
    try {
      return await editorStore.deleteBlock(blockId);
    } catch (error: unknown) {
      actionError = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      deleting = false;
    }
  }

  /** Follow a linked database's canonical source through the owning workspace. */
  async function openDatabase(blockId: string): Promise<void> {
    actionError = null;
    try {
      await editorStore.openDatabase(blockId);
    } catch (error: unknown) {
      actionError = error instanceof Error ? error.message : String(error);
    }
  }

  /** Open database rows using the normal Notes pane navigation. */
  function selectPage(pageId: string): void {
    void editorStore.openPageContextually(pageId).catch((error: unknown) => {
      actionError = error instanceof Error ? error.message : String(error);
    });
  }

  /** Keep an acknowledged title save tied to its block after returning to the note. */
  function createTitleSavedHandler(blockId: string): (databaseId: string, title: string) => void {
    return (databaseId, title) => editorStore.reconcileDatabaseTitle(blockId, databaseId, title);
  }

  $effect(() => { if (block) untrack(() => requestRenderer()); });
</script>

{#snippet actions()}
  <button
    type="button"
    class="flex items-center justify-center rounded-md px-2 hover:bg-accent {mobileLayout ? 'min-h-12 min-w-12' : 'h-7'}"
    aria-label={t("notes.databaseOpenContainingNote")}
    title={t("notes.databaseOpenContainingNote")}
    onclick={() => editorStore.closeDatabase()}
  >
    <FileText size={16} strokeWidth={1.75} />
  </button>
  <button
    bind:this={shareButton}
    type="button"
    class="flex items-center justify-center rounded-md px-2 hover:bg-accent {mobileLayout ? 'min-h-12 min-w-12' : 'h-7'} {shareOpen ? 'bg-accent' : ''}"
    aria-label={t("notes.share")}
    title={t("notes.share")}
    aria-haspopup="dialog"
    aria-expanded={shareOpen}
    onpointerenter={() => requestSharePanel()}
    onfocus={() => requestSharePanel()}
    onclick={toggleSharePanel}
  >
    <Share2 size={16} strokeWidth={1.75} />
  </button>
  {#if shareOpen}
    {#if sharePanelLoadState?.status === "ready" && sharePanelLoadState.component.kind === "share"}
      {@const NotesSharePopover = sharePanelLoadState.component.component}
      <NotesSharePopover anchor={shareButton} pageTitle={databaseTitle} {mobileLayout} onClose={() => { shareOpen = false; }} />
    {:else if sharePanelLoadState?.status === "failed"}
      <button class="surface-floating fixed inset-0 z-50 m-auto h-10 px-3" type="button" onclick={() => requestSharePanel(true)}>{t("common.retry")}</button>
    {/if}
  {/if}
  <button
    type="button"
    class="flex items-center justify-center rounded-md px-2 text-destructive hover:bg-accent {mobileLayout ? 'min-h-12 min-w-12' : 'h-7'}"
    aria-label={t("notes.databaseDelete")}
    title={t("notes.databaseDelete")}
    disabled={deleting}
    onclick={() => { void deleteDatabase(); }}
  >
    <Trash2 size={16} strokeWidth={1.75} />
  </button>
{/snippet}

<section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-notes-database-page={editorStore.selectedDatabaseBlockId}>
  {#if pageActionsTarget}
    <div use:portal={pageActionsTarget} class="flex items-center gap-1">{@render actions()}</div>
  {:else}
    <div class="flex shrink-0 justify-end gap-1 px-3 py-2">{@render actions()}</div>
  {/if}
  <div class="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
    {#if actionError}<p class="mb-3 text-sm text-destructive" role="alert">{actionError}</p>{/if}
    {#if block}
      {#if rendererLoadState?.status === "ready" && rendererLoadState.component.kind === "child-database"}
        {@const DatabaseRenderer = rendererLoadState.component.component}
        <DatabaseRenderer
          {block}
          focusBlockId={null}
          focusRequestId={0}
          onFocusBlock={() => {}}
          onKeydown={() => {}}
          onSelectPage={selectPage}
          onOpenDatabase={openDatabase}
          onDeleteDatabase={deleteDatabase}
          onCreateLinkedDatabaseView={(id) => editorStore.createLinkedDatabaseViewAfter(id)}
          onTitleSaved={createTitleSavedHandler(block.id)}
        />
      {:else if rendererLoadState?.status === "failed"}
        <div class="flex flex-col items-start gap-3" role="alert">
          <p class="text-sm text-destructive">{t("common.viewLoadFailed", block.child_database.title || t("notes.untitled"))}</p>
          <button type="button" class="min-h-9 rounded-md border border-border px-3 text-sm hover:bg-accent" onclick={() => requestRenderer(true)}>{t("common.retry")}</button>
        </div>
      {:else}
        <NotesLoadingSkeleton kind="database" />
      {/if}
    {:else}
      <NotesLoadingSkeleton kind="database" />
    {/if}
  </div>
</section>
