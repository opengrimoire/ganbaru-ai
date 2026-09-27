<script lang="ts">
  import { onMount } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { hasOnlyShortcutModifier } from "$lib/keyboard-shortcuts";
  import {
    beginLazyComponentLoad,
    rejectLazyComponentLoad,
    resolveLazyComponentLoad,
    type LazyComponentLoadState,
  } from "$lib/lazy-component-loader";
  import { parseNotesLinkHash } from "$lib/notes/block-link";
  import { notesPageContainingFolderId } from "$lib/notes/hierarchy-navigation";
  import type { NotesPageOpenMode } from "$lib/notes/page-open-mode";
  import { notesUndoShortcutAction } from "$lib/notes/undo-history";
  import type { NotesWorkingMarkdownFileRef } from "$lib/notes/types";
  import { getNotes } from "$lib/stores/notes.svelte";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { getMobileBackStack } from "$lib/stores/mobile-back-stack.svelte";
  import { getViewport } from "$lib/stores/viewport.svelte";
  import { isAppShortcutBlockedTarget, isEditableKeyboardTarget } from "$lib/utils";
  import {
    loadNotesOptionalComponent,
    loadNotesSurface,
    retryNotesOptionalComponent,
    retryNotesSurface,
    type LoadedNotesOptionalComponent,
    type LoadedNotesSurface,
    type NotesOptionalComponentKind,
    type NotesSurfaceKind,
  } from "./notes-component-registry";
  import NotesEditor from "./NotesEditor.svelte";
  import NotesProjectHome from "./NotesProjectHome.svelte";
  import NotesProjectSettingsPanel from "$lib/components/notes/NotesProjectSettingsPanel.svelte";
  import NotesWorkspaceHeader from "./NotesWorkspaceHeader.svelte";
  import NotesWorkingMarkdownEditor from "$lib/components/notes/NotesWorkingMarkdownEditor.svelte";
  import {
    EMPTY_NOTES_MUSIC_MENTION_CONTEXT,
    type NotesMusicMentionContext,
  } from "./notes-block-mention-targets";

  let {
    mobileLayout = false,
    musicMentionContext = EMPTY_NOTES_MUSIC_MENTION_CONTEXT,
  }: {
    mobileLayout?: boolean;
    musicMentionContext?: NotesMusicMentionContext;
  } = $props();

  const notes = getNotes();
  const projects = getProjects();
  const mobileBackStack = getMobileBackStack();
  const viewport = getViewport();
  const { t } = getLocalization();

  const CENTER_PEEK_FULL_PAGE_MIN_WIDTH_PX = 608;
  const CENTER_PEEK_FULL_PAGE_MIN_HEIGHT_PX = 520;
  type ActiveNotesSurfaceKind = NotesSurfaceKind | "home" | "editor";

  let showInactiveProjects = $state(false);
  let creationFolderOverride = $state<string | null | undefined>(undefined);
  let creationContextProjectId = $state<string | null>(null);
  let creationContextPageId = $state<string | null>(null);
  let notesRootElement = $state<HTMLDivElement | null>(null);
  let pageActionsTarget = $state<HTMLElement | null>(null);
  let projectSettingsOpen = $state(false);
  let projectSettingsDirty = $state(false);
  let projectSettingsDiscardConfirmOpen = $state(false);
  let projectVersionHistoryOpen = $state(false);
  let pendingProjectSettingsAction: (() => void) | null = null;
  let activeNotesHistoryShortcut: "undo" | "redo" | null = null;
  let selectedWorkingMarkdownFile = $state<NotesWorkingMarkdownFileRef | null>(null);
  let workingMarkdownDirty = $state(false);
  let workingMarkdownProjectId = $state<string | null>(null);
  let surfaceLoadStates = $state<Partial<Record<
    NotesSurfaceKind,
    LazyComponentLoadState<NotesSurfaceKind, LoadedNotesSurface>
  >>>({});
  let optionalLoadStates = $state<Partial<Record<
    NotesOptionalComponentKind,
    LazyComponentLoadState<NotesOptionalComponentKind, LoadedNotesOptionalComponent>
  >>>({});
  const selectedProject = $derived(projects.selectedProject);
  const selectedGroup = $derived(projects.selectedGroup);
  const selectedProjectId = $derived(selectedProject?.id ?? null);
  const creationFolderId = $derived.by(() => {
    if (creationFolderOverride !== undefined) return creationFolderOverride;
    return notesPageContainingFolderId(
      notes.selectedPageId,
      [...new Map(
        [...notes.allPages, ...notes.linkResolutionPages].map((page) => [page.id, page]),
      ).values()],
    );
  });
  const topBarSelectedPage = $derived.by(() => {
    if ((!mobileLayout && notes.pageOpenMode !== "full") || !notes.selectedPageId) return null;
    if (notes.loadedPage?.id === notes.selectedPageId) return notes.loadedPage;
    return notes.allPages.find((page) => page.id === notes.selectedPageId)
      ?? notes.linkResolutionPages.find((page) => page.id === notes.selectedPageId)
      ?? null;
  });
  const hasOpenPage = $derived(
    notes.viewMode === "pages"
      && notes.selectedPageId !== null
      && notes.loadedPage?.id === notes.selectedPageId
      && notes.primaryContentReady,
  );
  const peekPromotesToFullPage = $derived(
    hasOpenPage
      && notes.pageOpenMode !== "full"
      && (
        viewport.width < CENTER_PEEK_FULL_PAGE_MIN_WIDTH_PX
        || viewport.height < CENTER_PEEK_FULL_PAGE_MIN_HEIGHT_PX
      ),
  );
  const showFullPageEditor = $derived(
    hasOpenPage && (notes.pageOpenMode === "full" || peekPromotesToFullPage),
  );
  const showPagePeek = $derived(
    hasOpenPage && notes.pageOpenMode !== "full" && !peekPromotesToFullPage,
  );
  const showCenterPeek = $derived(showPagePeek && notes.pageOpenMode === "center");
  const showSidePeek = $derived(showPagePeek && notes.pageOpenMode === "side");
  const activeSurfaceKind = $derived.by((): ActiveNotesSurfaceKind => {
    if (notes.viewMode === "archive") return "archive";
    if (notes.viewMode === "trash") return "trash";
    if (notes.selectedPageId !== null) return "editor";
    return "home";
  });
  const activeSurfaceLoadState = $derived(
    activeSurfaceKind === "archive" || activeSurfaceKind === "trash"
      ? surfaceLoadStates[activeSurfaceKind] ?? null
      : null,
  );
  const showProjectExplorer = $derived(!mobileLayout || activeSurfaceKind === "home");
  const showPrimaryContent = $derived(!mobileLayout || activeSurfaceKind !== "home");
  const projectHistoryLoadState = $derived(optionalLoadStates["project-history"] ?? null);
  const confirmDialogLoadState = $derived(optionalLoadStates["confirm-dialog"] ?? null);

  function requestNotesSurface(kind: NotesSurfaceKind, retry = false): void {
    const current = surfaceLoadStates[kind] ?? null;
    if (!retry && current?.key === kind) return;
    const loadingState = beginLazyComponentLoad(current, kind);
    surfaceLoadStates = { ...surfaceLoadStates, [kind]: loadingState };
    const request = retry ? retryNotesSurface(kind) : loadNotesSurface(kind);
    void request.then((component) => {
      const latest = surfaceLoadStates[kind];
      if (!latest) return;
      surfaceLoadStates = {
        ...surfaceLoadStates,
        [kind]: resolveLazyComponentLoad(latest, kind, loadingState.requestId, component),
      };
    }).catch((error: unknown) => {
      const latest = surfaceLoadStates[kind];
      if (!latest) return;
      surfaceLoadStates = {
        ...surfaceLoadStates,
        [kind]: rejectLazyComponentLoad(latest, kind, loadingState.requestId, error),
      };
      console.error(`load Notes ${kind} surface failed`, error);
    });
  }

  function requestNotesOptionalComponent(
    kind: NotesOptionalComponentKind,
    retry = false,
  ): void {
    const current = optionalLoadStates[kind] ?? null;
    if (!retry && current?.key === kind) return;
    const loadingState = beginLazyComponentLoad(current, kind);
    optionalLoadStates = { ...optionalLoadStates, [kind]: loadingState };
    const request = retry
      ? retryNotesOptionalComponent(kind)
      : loadNotesOptionalComponent(kind);
    void request.then((component) => {
      const latest = optionalLoadStates[kind];
      if (!latest) return;
      optionalLoadStates = {
        ...optionalLoadStates,
        [kind]: resolveLazyComponentLoad(latest, kind, loadingState.requestId, component),
      };
    }).catch((error: unknown) => {
      const latest = optionalLoadStates[kind];
      if (!latest) return;
      optionalLoadStates = {
        ...optionalLoadStates,
        [kind]: rejectLazyComponentLoad(latest, kind, loadingState.requestId, error),
      };
      console.error(`load optional Notes ${kind} component failed`, error);
    });
  }

  $effect(() => {
    if (!mobileLayout || notes.selectedPageId === null) return;
    return mobileBackStack.activate({
      handle: () => {
        if (!beforeDocumentNavigation()) return;
        void notes.closeContextualPage();
        clearMobileNotesHash();
      },
    });
  });

  $effect(() => {
    if (!mobileLayout || notes.viewMode !== "archive") return;
    return mobileBackStack.activate({
      handle: () => {
        notes.closeArchive();
      },
    });
  });

  $effect(() => {
    if (!mobileLayout || notes.viewMode !== "trash") return;
    return mobileBackStack.activate({
      handle: () => {
        notes.closeTrash();
      },
    });
  });

  onMount(() => {
    async function openHashTarget(): Promise<void> {
      const target = parseNotesLinkHash(window.location.hash);
      if (!target) {
        return;
      }
      const opened = await notes.openNotesLink(target);
      if (!opened) console.warn("notes link target was not found");
    }

    void notes.ensureLoaded()
      .then(openHashTarget)
      .catch((error) => {
        console.error("load notes failed", error);
      })
      ;
    void projects.ensureLoaded().catch((error) => {
      console.error("load projects failed", error);
    });
    const onHashChange = () => {
      void openHashTarget().catch((error) => {
        console.error("open notes block link failed", error);
      });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  });

  $effect(() => {
    const projectId = selectedProjectId;
    const pageId = notes.selectedPageId;
    if (projectId === creationContextProjectId && pageId === creationContextPageId) return;
    creationContextProjectId = projectId;
    creationContextPageId = pageId;
    creationFolderOverride = undefined;
  });

  $effect(() => {
    if (activeSurfaceKind === "archive" || activeSurfaceKind === "trash") {
      requestNotesSurface(activeSurfaceKind);
    }
  });

  $effect(() => {
  });

  $effect(() => {
    if (!mobileLayout && projectVersionHistoryOpen) {
      requestNotesOptionalComponent("project-history");
    }
  });

  $effect(() => {
    if (!mobileLayout && projectSettingsDiscardConfirmOpen) {
      requestNotesOptionalComponent("confirm-dialog");
    }
  });

  function showProjectHome(): void {
    if (!beforeDocumentNavigation()) return;
    if (notes.viewMode === "archive") notes.closeArchive();
    if (notes.viewMode === "trash") notes.closeTrash();
    void notes.selectPage(null);
  }

  function handleProjectSelected(): void {
    if (!beforeDocumentNavigation()) {
      if (workingMarkdownProjectId) projects.selectedProjectId = workingMarkdownProjectId;
      return;
    }
    pendingProjectSettingsAction = null;
    projectSettingsOpen = false;
    projectSettingsDirty = false;
    projectSettingsDiscardConfirmOpen = false;
    projectVersionHistoryOpen = false;
    showProjectHome();
    void notes.load().catch((error) => {
      console.error("load selected Notes project failed", error);
    });
  }

  function beforeDocumentNavigation(): boolean {
    if (!workingMarkdownDirty) {
      selectedWorkingMarkdownFile = null;
      workingMarkdownProjectId = null;
      return true;
    }
    if (!window.confirm(t("notes.workingMarkdown.discardConfirm"))) return false;
    workingMarkdownDirty = false;
    selectedWorkingMarkdownFile = null;
    workingMarkdownProjectId = null;
    return true;
  }

  function selectWorkingMarkdownFile(file: NotesWorkingMarkdownFileRef): void {
    if (mobileLayout) return;
    const unchanged = selectedWorkingMarkdownFile?.workingFolderId === file.workingFolderId
      && selectedWorkingMarkdownFile.relativePath === file.relativePath;
    if (unchanged) return;
    if (!beforeDocumentNavigation()) return;
    if (notes.viewMode === "archive") notes.closeArchive();
    if (notes.viewMode === "trash") notes.closeTrash();
    void notes.selectPage(null);
    selectedWorkingMarkdownFile = file;
    workingMarkdownProjectId = selectedProjectId;
  }

  function closeProjectSettingsImmediately(): void {
    pendingProjectSettingsAction = null;
    projectSettingsDiscardConfirmOpen = false;
    projectSettingsOpen = false;
    projectSettingsDirty = false;
  }

  function runAfterProjectSettingsClose(action: () => void): void {
    if (projectSettingsDirty) {
      pendingProjectSettingsAction = action;
      projectSettingsDiscardConfirmOpen = true;
      return;
    }
    action();
  }

  function requestProjectSettingsClose(): void {
    runAfterProjectSettingsClose(closeProjectSettingsImmediately);
  }

  function confirmDiscardProjectSettings(): void {
    const action = pendingProjectSettingsAction;
    pendingProjectSettingsAction = null;
    projectSettingsDiscardConfirmOpen = false;
    projectSettingsDirty = false;
    action?.();
  }

  function cancelDiscardProjectSettings(): void {
    pendingProjectSettingsAction = null;
    projectSettingsDiscardConfirmOpen = false;
  }

  function openArchiveFromProjectSettings(): void {
    runAfterProjectSettingsClose(() => {
      closeProjectSettingsImmediately();
      void notes.openArchive();
    });
  }

  function openTrashFromProjectSettings(): void {
    runAfterProjectSettingsClose(() => {
      closeProjectSettingsImmediately();
      void notes.openTrash();
    });
  }

  function openVersionHistoryFromProjectSettings(): void {
    runAfterProjectSettingsClose(() => {
      closeProjectSettingsImmediately();
      projectVersionHistoryOpen = true;
    });
  }

  function toggleProjectSettings(): void {
    if (projectSettingsOpen) {
      requestProjectSettingsClose();
      return;
    }
    projectSettingsOpen = true;
  }

  function createPage(): void {
    void notes.createPage("", {
      projectId: selectedProjectId,
      folderId: creationFolderId,
      openMode: "full",
    });
  }

  function closePagePeek(): void {
    void notes.closeContextualPage();
    if (mobileLayout) clearMobileNotesHash();
  }

  function clearMobileNotesHash(): void {
    if (!window.location.hash) return;
    const previousUrl = window.location.href;
    const nextUrl = new URL(previousUrl);
    nextUrl.hash = "";
    window.history.replaceState(window.history.state, "", nextUrl);
    window.dispatchEvent(new HashChangeEvent("hashchange", {
      oldURL: previousUrl,
      newURL: nextUrl.href,
    }));
  }

  function showSelectedPageAs(openMode: NotesPageOpenMode): void {
    notes.showSelectedPageAs(openMode);
  }

  function handleCenterPeekBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) closePagePeek();
  }

  function notesShortcutTargetBlocked(target: EventTarget | Element | null): boolean {
    if (!(target instanceof Element)) return false;
    return (
      isAppShortcutBlockedTarget(target)
      || target.closest("[role='dialog']:not([data-notes-page-peek])") !== null
    );
  }

  function notesBlockEditorContainsTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element) || !notesRootElement?.contains(target)) return false;
    return target.closest("[data-notes-selectable-block-id]") !== null;
  }

  function notesHistoryShortcutTargetBlocked(target: EventTarget | null): boolean {
    return target instanceof Element
      && target.closest("[role='dialog']:not([data-notes-page-peek])") !== null;
  }

  function runNotesHistoryShortcut(action: "undo" | "redo"): void {
    void (action === "undo" ? notes.undoNotesEdit() : notes.redoNotesEdit());
  }

  function handleNotesWindowKeydown(event: KeyboardEvent): void {
    const historyAction = notesUndoShortcutAction(event);
    if (historyAction) {
      if (
        isEditableKeyboardTarget(event.target)
        || isEditableKeyboardTarget(document.activeElement)
      ) {
        return;
      }
      const fromBlockEditor = notesBlockEditorContainsTarget(event.target);
      const continuesInterruptedRepeat = event.repeat
        && activeNotesHistoryShortcut === historyAction;
      if (!fromBlockEditor && !continuesInterruptedRepeat) return;
      if (
        notesHistoryShortcutTargetBlocked(event.target)
        || notesRootElement?.querySelector("[role='dialog']:not([data-notes-page-peek])") !== null
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      activeNotesHistoryShortcut = historyAction;
      runNotesHistoryShortcut(historyAction);
      return;
    }
    if (event.defaultPrevented) return;
    if (event.key.toLowerCase() !== "n" || !hasOnlyShortcutModifier(event)) return;
    if (
      notesShortcutTargetBlocked(event.target)
      || notesShortcutTargetBlocked(document.activeElement)
      || notesRootElement?.querySelector("[role='dialog']:not([data-notes-page-peek])") !== null
    ) {
      return;
    }
    event.preventDefault();
    createPage();
  }

  function handleNotesWindowKeyup(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y" || (!event.ctrlKey && !event.metaKey)) {
      activeNotesHistoryShortcut = null;
    }
  }
</script>

<svelte:window
  onkeydowncapture={handleNotesWindowKeydown}
  onkeyup={handleNotesWindowKeyup}
  onblur={() => {
    activeNotesHistoryShortcut = null;
  }}
/>

<div
  bind:this={notesRootElement}
  class="notes-view-root flex h-full min-h-0 flex-col overflow-hidden text-foreground"
  class:notes-view-mobile={mobileLayout}
  style="background-color: var(--cal-bg);"
  data-first-use-shell="notes"
>
  <NotesWorkspaceHeader
    {mobileLayout}
    {selectedProject}
    {selectedGroup}
    {selectedProjectId}
    selectedPage={topBarSelectedPage}
    explorerCollapsed={notes.explorerCollapsed}
    {creationFolderId}
    {showInactiveProjects}
    onShowInactiveProjectsChange={(value) => {
      showInactiveProjects = value;
    }}
    onProjectSelected={handleProjectSelected}
    onShowHome={showProjectHome}
    {projectSettingsOpen}
    onToggleProjectSettings={toggleProjectSettings}
    bind:pageActionsTarget
  />
  {#if !mobileLayout && projectSettingsOpen && selectedProjectId}
    <NotesProjectSettingsPanel
        projectId={selectedProjectId}
        popoverBoundaryElement={notesRootElement}
        onRequestClose={requestProjectSettingsClose}
        onDirtyChange={(dirty) => {
          projectSettingsDirty = dirty;
        }}
        onOpenVersionHistory={openVersionHistoryFromProjectSettings}
        onOpenArchive={openArchiveFromProjectSettings}
        onOpenTrash={openTrashFromProjectSettings}
    />
  {/if}
  {#if !mobileLayout && projectVersionHistoryOpen && selectedProject}
    {#if projectHistoryLoadState?.status === "ready" && projectHistoryLoadState.component.kind === "project-history"}
      {@const NotesProjectVersionHistoryModal = projectHistoryLoadState.component.component}
      <NotesProjectVersionHistoryModal
        projectId={selectedProject.id}
        onClose={() => {
          projectVersionHistoryOpen = false;
        }}
        onRestored={() => {
          void notes.load().catch((error) => {
            console.error("reload notes after project history restore failed", error);
          });
        }}
      />
    {:else}
      <div class="fixed inset-0 z-90 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-busy={projectHistoryLoadState?.status !== "failed"}>
        <div class="rounded-md border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
          {#if projectHistoryLoadState?.status === "failed"}
            <p role="alert">{t("common.viewLoadFailed", t("notes.projectSettingsVersionHistory"))}</p>
            <div class="mt-3 flex gap-2">
              <button class="min-h-8 rounded-md border border-border px-2 hover:bg-accent" type="button" onclick={() => requestNotesOptionalComponent("project-history", true)}>{t("common.retry")}</button>
              <button class="min-h-8 rounded-md border border-border px-2 hover:bg-accent" type="button" onclick={() => { projectVersionHistoryOpen = false; }}>{t("common.close")}</button>
            </div>
          {:else}
            {t("common.loading")}
          {/if}
        </div>
      </div>
    {/if}
  {/if}
  {#if !mobileLayout && projectSettingsDiscardConfirmOpen}
    {#if confirmDialogLoadState?.status === "ready" && confirmDialogLoadState.component.kind === "confirm-dialog"}
      {@const ConfirmDialog = confirmDialogLoadState.component.component}
      <ConfirmDialog
        title={t("calendar.view.discardUnsavedTitle")}
        message={t("calendar.view.changesLost")}
        confirmLabel={t("calendar.view.discard")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirmDiscardProjectSettings}
        onCancel={cancelDiscardProjectSettings}
      />
    {:else if confirmDialogLoadState?.status === "failed"}
      <div class="fixed inset-0 z-100 flex items-center justify-center bg-black/45 p-4" role="alert">
        <div class="rounded-md border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
          <p>{t("common.viewLoadFailed", t("calendar.view.discard"))}</p>
          <div class="mt-3 flex gap-2">
            <button class="min-h-8 rounded-md border border-border px-2 hover:bg-accent" type="button" onclick={() => requestNotesOptionalComponent("confirm-dialog", true)}>{t("common.retry")}</button>
            <button class="min-h-8 rounded-md border border-border px-2 hover:bg-accent" type="button" onclick={cancelDiscardProjectSettings}>{t("common.cancel")}</button>
          </div>
        </div>
      </div>
    {:else}
      <div class="fixed inset-0 z-100 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-busy="true">
        <div class="rounded-md border border-border bg-popover px-4 py-3 text-sm text-muted-foreground shadow-lg">{t("common.loading")}</div>
      </div>
    {/if}
  {/if}
  <div class="notes-view-layout relative flex min-h-0 flex-1 overflow-hidden">
    {#if showProjectExplorer}
      <NotesProjectHome
        {mobileLayout}
        projectId={selectedProjectId}
        bind:explorerCollapsed={notes.explorerCollapsed}
        {creationFolderId}
        {selectedWorkingMarkdownFile}
        onSelectWorkingMarkdownFile={selectWorkingMarkdownFile}
        onBeforeDocumentNavigation={beforeDocumentNavigation}
        onCreationFolderChange={(folderId) => {
          creationFolderOverride = folderId;
        }}
      />
    {/if}
    {#if showPrimaryContent}
      <div class={showSidePeek ? "flex min-w-0 basis-1/2 overflow-hidden" : "flex min-w-0 flex-1 overflow-hidden"}>
        {#if !notes.loaded && notes.loadError}
          <div class="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center" role="alert" data-notes-first-use-state>
            <p class="text-sm text-destructive">{t("notes.loadFailed", notes.loadError)}</p>
            <button
              type="button"
              class="rounded-md border border-border px-3 text-sm hover:bg-accent {mobileLayout ? 'min-h-12' : 'min-h-9'}"
              onclick={() => {
                void notes.load().catch((error) => {
                  console.error("retry Notes load failed", error);
                });
              }}
            >
              {t("common.retry")}
            </button>
          </div>
        {:else if !mobileLayout && selectedWorkingMarkdownFile}
          <NotesWorkingMarkdownEditor
            file={selectedWorkingMarkdownFile}
            onDirtyChange={(dirty) => { workingMarkdownDirty = dirty; }}
          />
        {:else if activeSurfaceKind === "archive" || activeSurfaceKind === "trash"}
          {#if activeSurfaceLoadState?.status === "ready" && activeSurfaceLoadState.component.kind === activeSurfaceKind}
            {@const ActiveNotesSurface = activeSurfaceLoadState.component.component}
            <ActiveNotesSurface />
          {:else if activeSurfaceLoadState?.status === "failed"}
            <div class="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center" role="alert">
              <p class="text-sm text-destructive">{t("common.viewLoadFailed", activeSurfaceKind === "archive" ? t("notes.archive") : t("notes.trash"))}</p>
              <button type="button" class="rounded-md border border-border px-3 text-sm hover:bg-accent {mobileLayout ? 'min-h-12' : 'min-h-9'}" onclick={() => requestNotesSurface(activeSurfaceKind, true)}>{t("common.retry")}</button>
            </div>
          {:else}
            <div class="flex min-w-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground" aria-busy="true">{t("common.loading")}</div>
          {/if}
        {:else if showFullPageEditor}
          <NotesEditor
            projectId={selectedProjectId}
            openMode="full"
            {pageActionsTarget}
            onClose={closePagePeek}
            onOpenModeChange={showSelectedPageAs}
            {musicMentionContext}
          />
        {:else if mobileLayout && activeSurfaceKind === "editor"}
          <div class="flex min-w-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground" aria-busy="true">
            {t("common.loading")}
          </div>
        {:else}
          <div class="min-w-0 flex-1"></div>
        {/if}
      </div>
    {/if}

    {#if showSidePeek}
      <div
        class="flex min-w-0 basis-1/2 overflow-hidden border-l border-border"
        role="dialog"
        aria-modal="false"
        data-notes-page-peek
      >
        <NotesEditor
          projectId={selectedProjectId}
          openMode="side"
          {pageActionsTarget}
          onClose={closePagePeek}
          onOpenModeChange={showSelectedPageAs}
          {musicMentionContext}
        />
      </div>
    {/if}

    {#if showCenterPeek}
      <div
        class="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center bg-black/45 px-3 py-4 sm:px-6 sm:py-8"
        style="top: calc(var(--titlebar-h) + var(--cal-header-row-h));"
        role="presentation"
        onclick={handleCenterPeekBackdropClick}
      >
        <div
          class="notes-center-peek-panel flex min-w-0 overflow-hidden rounded-lg border border-border"
          style="background-color: var(--cal-bg);"
          role="dialog"
          aria-modal="true"
          data-notes-page-peek
        >
          <NotesEditor
            projectId={selectedProjectId}
            openMode="center"
            {pageActionsTarget}
            onClose={closePagePeek}
            onOpenModeChange={showSelectedPageAs}
            {musicMentionContext}
          />
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .notes-view-root {
    container: notes-view / inline-size;
  }

  .notes-center-peek-panel {
    width: clamp(560px, calc(100vw - 214px), 960px);
    height: min(667px, calc(100dvh - 214px));
  }

  @container notes-view (max-width: 34rem) {
    .notes-view-root:not(.notes-view-mobile) :global(.notes-project-explorer) {
      display: none;
    }
  }
</style>
