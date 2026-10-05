<script lang="ts">
  import { untrack } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type {
    NotesHtmlImportRequest,
    NotesJsonGraphExportRequest,
    NotesNotionApiImportRequest,
    NotesNotionExportImportRequest,
  } from "$lib/notes/types";
  import { getNotes } from "$lib/stores/notes.svelte";
  import {
    beginLazyComponentLoad,
    rejectLazyComponentLoad,
    resolveLazyComponentLoad,
    type LazyComponentLoadState,
  } from "$lib/lazy-component-loader";
  import {
    loadNotesTransferDialog,
    retryNotesTransferDialog,
    type LoadedNotesTransferDialog,
  } from "./notes-transfer-dialog-registry";
  import type { NotesTransferOperation } from "$lib/settings/types";

  let {
    operation,
    onCancel,
    compactLayout = false,
    iconRailLayout = false,
    onScrollContainerChange = () => {},
    onScrollbarInsetsChange = () => {},
  }: {
    operation: NotesTransferOperation;
    onCancel: () => void;
    compactLayout?: boolean;
    iconRailLayout?: boolean;
    onScrollContainerChange?: (scrollContainer: HTMLElement | undefined) => void;
    onScrollbarInsetsChange?: (insets: { top: number; bottom: number }) => void;
  } = $props();

  const notes = getNotes();
  const { t } = getLocalization();
  let panelRootEl: HTMLElement | undefined = $state();
  let panelScrollEl: HTMLElement | undefined = $state();
  let dialogLoadState = $state<LazyComponentLoadState<
    NotesTransferOperation,
    LoadedNotesTransferDialog
  > | null>(null);
  const activeDialogLoadState = $derived(
    dialogLoadState?.key === operation ? dialogLoadState : null,
  );
  const contentPaddingX = $derived(compactLayout ? "0.75rem" : iconRailLayout ? "1.25rem" : "2rem");
  const contentPaddingY = $derived(compactLayout ? "1rem" : iconRailLayout ? "1.25rem" : "2rem");

  function requestDialog(nextOperation: NotesTransferOperation, retry = false): void {
    if (!retry && dialogLoadState?.key === nextOperation) return;
    const loadingState = beginLazyComponentLoad(dialogLoadState, nextOperation);
    dialogLoadState = loadingState;
    const request = retry
      ? retryNotesTransferDialog(nextOperation)
      : loadNotesTransferDialog(nextOperation);
    void request
      .then((component) => {
        if (!dialogLoadState) return;
        const nextState = resolveLazyComponentLoad(
          dialogLoadState,
          nextOperation,
          loadingState.requestId,
          component,
        );
        if (nextState !== dialogLoadState) dialogLoadState = nextState;
      })
      .catch((error: unknown) => {
        if (!dialogLoadState) return;
        const nextState = rejectLazyComponentLoad(
          dialogLoadState,
          nextOperation,
          loadingState.requestId,
          error,
        );
        if (nextState === dialogLoadState) return;
        dialogLoadState = nextState;
        console.error(`Failed to load ${nextOperation} Notes transfer dialog:`, error);
      });
  }

  const initialOperation = untrack(() => operation);
  requestDialog(initialOperation);

  $effect(() => {
    requestDialog(operation);
  });

  $effect(() => {
    onScrollContainerChange(panelScrollEl);
    reportScrollbarInsets();

    const contentEl = panelRootEl?.closest<HTMLElement>("[data-settings-content]");
    if (!panelRootEl || !panelScrollEl || !contentEl) {
      return () => {
        onScrollContainerChange(undefined);
        onScrollbarInsetsChange({ top: 0, bottom: 0 });
      };
    }

    const observer = new ResizeObserver(reportScrollbarInsets);
    observer.observe(panelRootEl);
    observer.observe(panelScrollEl);
    observer.observe(contentEl);
    window.addEventListener("resize", reportScrollbarInsets);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reportScrollbarInsets);
      onScrollContainerChange(undefined);
      onScrollbarInsetsChange({ top: 0, bottom: 0 });
    };
  });

  function reportScrollbarInsets(): void {
    const contentEl = panelRootEl?.closest<HTMLElement>("[data-settings-content]");
    if (!panelScrollEl || !contentEl) {
      onScrollbarInsetsChange({ top: 0, bottom: 0 });
      return;
    }
    const contentRect = contentEl.getBoundingClientRect();
    const scrollRect = panelScrollEl.getBoundingClientRect();
    onScrollbarInsetsChange({
      top: Math.max(0, scrollRect.top - contentRect.top),
      bottom: Math.max(0, contentRect.bottom - scrollRect.bottom),
    });
  }

  function operationDescription(): string {
    if (operation === "html-import") return t("settings.notesTransfers.htmlImportDescription");
    if (operation === "notion-api-import") return t("settings.notesTransfers.notionApiImportDescription");
    if (operation === "notion-export-import") return t("settings.notesTransfers.notionExportImportDescription");
    return t("settings.notesTransfers.jsonGraphExportDescription");
  }

  function importHtmlPage(input: {
    html: string;
    title: string | null;
    sourceName: string | null;
    keepExternalFileReferences: boolean;
    projectId: string | null;
  }) {
    const request: Omit<NotesHtmlImportRequest, "parent"> = {
      html: input.html,
      title: input.title,
      source_name: input.sourceName,
      keep_external_file_references: input.keepExternalFileReferences,
      project_id: input.projectId,
    };
    return notes.importHtmlPage(request);
  }

  function importNotionApi(input: {
    integrationToken: string;
    sourceWorkspaceId: string | null;
    pageIds: string[];
    dataSourceIds: string[];
    includeComments: boolean;
    includeUsers: boolean;
    keepExternalFileReferences: boolean;
    projectId: string | null;
  }) {
    const request: Omit<NotesNotionApiImportRequest, "parent"> = {
      integration_token: input.integrationToken,
      source_workspace_id: input.sourceWorkspaceId,
      page_ids: input.pageIds,
      data_source_ids: input.dataSourceIds,
      include_comments: input.includeComments,
      include_users: input.includeUsers,
      keep_external_file_references: input.keepExternalFileReferences,
      project_id: input.projectId,
    };
    return notes.importNotionApi(request);
  }

  function importNotionExportFolder(input: {
    exportRootPath: string;
    sourceWorkspaceId: string | null;
    keepExternalFileReferences: boolean;
    copyLocalFileReferences: boolean;
    importMarkdown: boolean;
    importHtml: boolean;
    importCsv: boolean;
    projectId: string | null;
  }) {
    const request: Omit<NotesNotionExportImportRequest, "parent"> = {
      export_root_path: input.exportRootPath,
      source_workspace_id: input.sourceWorkspaceId,
      keep_external_file_references: input.keepExternalFileReferences,
      copy_local_file_references: input.copyLocalFileReferences,
      import_markdown: input.importMarkdown,
      import_html: input.importHtml,
      import_csv: input.importCsv,
      project_id: input.projectId,
    };
    return notes.importNotionExportFolder(request);
  }

  function exportJsonGraph(input: {
    includeIndexes: boolean;
    includeHistory: boolean;
    includeTemplates: boolean;
    includeLocalState: boolean;
    pretty: boolean;
  }) {
    const request: NotesJsonGraphExportRequest = {
      include_indexes: input.includeIndexes,
      include_history: input.includeHistory,
      include_templates: input.includeTemplates,
      include_local_state: input.includeLocalState,
      pretty: input.pretty,
    };
    return notes.exportJsonGraph(request);
  }
</script>

<div bind:this={panelRootEl} class="flex h-full min-h-0 flex-col">
  <main
    bind:this={panelScrollEl}
    class="hide-scrollbar min-h-0 flex-1 overflow-y-auto"
    style="padding: {contentPaddingY} {contentPaddingX};"
  >
    {#if activeDialogLoadState?.status === "ready"}
      {@const loadedDialog = activeDialogLoadState.component}
      {#if loadedDialog.operation === "html-import"}
        {@const DialogComponent = loadedDialog.component}
        <DialogComponent
          embedded
          description={operationDescription()}
          onImport={importHtmlPage}
          onCancel={onCancel}
        />
      {:else if loadedDialog.operation === "notion-api-import"}
        {@const DialogComponent = loadedDialog.component}
        <DialogComponent
          embedded
          description={operationDescription()}
          onImport={importNotionApi}
          onCancel={onCancel}
        />
      {:else if loadedDialog.operation === "notion-export-import"}
        {@const DialogComponent = loadedDialog.component}
        <DialogComponent
          embedded
          description={operationDescription()}
          onImport={importNotionExportFolder}
          onCancel={onCancel}
        />
      {:else}
        {@const DialogComponent = loadedDialog.component}
        <DialogComponent
          embedded
          description={operationDescription()}
          onExport={exportJsonGraph}
          onCancel={onCancel}
        />
      {/if}
    {:else if activeDialogLoadState?.status === "failed"}
      {@const failedOperation = activeDialogLoadState.key}
      <div class="flex min-h-40 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground" role="alert">
        <p>{t("common.viewLoadFailed", operationDescription())}</p>
        <button
          type="button"
          class="min-h-9 rounded-md border border-border bg-background px-3 font-medium text-foreground hover:bg-accent"
          onclick={() => requestDialog(failedOperation, true)}
        >
          {t("common.retry")}
        </button>
      </div>
    {:else}
      <div class="flex min-h-40 items-center justify-center text-sm text-muted-foreground" aria-busy="true">
        {t("common.loading")}
      </div>
    {/if}
  </main>
</div>
