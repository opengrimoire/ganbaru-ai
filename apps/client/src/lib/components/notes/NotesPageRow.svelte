<script lang="ts">
  import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import { onDestroy, tick } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    COMPACT_IDENTITY_EMOJI_SCALE,
    COMPACT_IDENTITY_ICON_SIZE,
    COMPACT_IDENTITY_ICON_STROKE_WIDTH,
  } from "$lib/icon-sizing";
  import {
    beginLazyComponentLoad,
    rejectLazyComponentLoad,
    resolveLazyComponentLoad,
    type LazyComponentLoadState,
  } from "$lib/lazy-component-loader";
  import { dismissOnOutside } from "$lib/utils/dismiss-on-outside";
  import {
    createInlineRenameHistory,
    inlineRenameHistoryAction,
    inlineRenameInputKind,
    inlineRenameHistoryValue,
    recordInlineRenameValue,
    stepInlineRenameHistory,
  } from "$lib/notes/inline-rename-history";
  import type { NotesDestinationPickerTarget } from "$lib/notes/destination-picker";
  import {
    notesRowContextMenuGeometry,
    notesRowContextMenuStyle,
  } from "$lib/notes/row-context-menu";
  import type { NotesPageMoveTarget } from "$lib/notes/page-move";
  import type { NotesPageParentStatus } from "$lib/notes/page-tree";
  import { notesPageTitle } from "$lib/notes/page-title";
  import type { NotesPage, NotesParent } from "$lib/notes/types";
  import Archive from "@lucide/svelte/icons/archive";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import FilePlus2 from "@lucide/svelte/icons/file-plus-2";
  import FolderInput from "@lucide/svelte/icons/folder-input";
  import FolderTree from "@lucide/svelte/icons/folder-tree";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Star from "@lucide/svelte/icons/star";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import NotesPageIcon from "./NotesPageIcon.svelte";
  import {
    loadNotesOptionalComponent,
    retryNotesOptionalComponent,
    type LoadedNotesOptionalComponent,
  } from "./notes-component-registry";

  let {
    page,
    depth,
    hasChildren,
    collapsed,
    parentStatus,
    favorited,
    selected,
    onSelect,
    onRename,
    onToggleCollapsed,
    onToggleFavorite,
    onCreateChild,
    onDuplicate,
    moveTargets,
    onRequestMoveTargets = undefined,
    onMove,
    folderMoveTargets = undefined,
    onMoveToFolder = undefined,
    onArchive,
    onTrash,
    blockDropActive = false,
    onBlockDragOver,
    onBlockDragLeave,
    onBlockDrop,
    readOnly = false,
    showDisclosure = true,
    highlightRequestId = 0,
    navigationDragging = false,
    navigationDropState = "none",
    onNavigationDragStart = undefined,
    onNavigationDragEnd = undefined,
    onNavigationDragOver = undefined,
    onNavigationDragLeave = undefined,
    onNavigationDrop = undefined,
    displayTitle,
  }: {
    page: NotesPage;
    depth: number;
    hasChildren: boolean;
    collapsed: boolean;
    parentStatus: NotesPageParentStatus | null;
    favorited: boolean;
    selected: boolean;
    onSelect: () => void;
    onRename: (title: string) => boolean | void | Promise<boolean | void>;
    onToggleCollapsed: (collapsed: boolean) => void;
    onToggleFavorite: (favorited: boolean) => void;
    onCreateChild: () => void;
    onDuplicate: () => void;
    moveTargets: NotesPageMoveTarget[];
    onRequestMoveTargets?: () => void | Promise<void>;
    onMove: (parent: NotesParent) => void;
    folderMoveTargets?: (NotesDestinationPickerTarget & { folderId: string | null })[];
    onMoveToFolder?: (folderId: string | null) => void;
    onArchive: () => void;
    onTrash: () => void;
    blockDropActive?: boolean;
    onBlockDragOver?: (pageId: string, event: DragEvent) => void;
    onBlockDragLeave?: (pageId: string, event: DragEvent) => void;
    onBlockDrop?: (pageId: string, event: DragEvent) => void;
    readOnly?: boolean;
    showDisclosure?: boolean;
    highlightRequestId?: number;
    navigationDragging?: boolean;
    navigationDropState?: "none" | "valid" | "invalid";
    onNavigationDragStart?: (event: DragEvent) => void;
    onNavigationDragEnd?: (event: DragEvent) => void;
    onNavigationDragOver?: (event: DragEvent) => void;
    onNavigationDragLeave?: (event: DragEvent) => void;
    onNavigationDrop?: (event: DragEvent) => void;
    displayTitle?: string;
  } = $props();

  const { t } = getLocalization();
  const explorerRowIconSize = COMPACT_IDENTITY_ICON_SIZE;
  const explorerRowIconStrokeWidth = COMPACT_IDENTITY_ICON_STROKE_WIDTH;
  const settledScrollTolerancePx = 0.5;
  const settledScrollFrameCount = 3;
  const maximumScrollObservationFrames = 90;
  let editing = $state(false);
  let menuOpen = $state(false);
  let menuStyle = $state("");
  let moveMenuOpen = $state(false);
  let folderMoveMenuOpen = $state(false);
  let titleDraft = $state("");
  let renameHistory = $state(createInlineRenameHistory(""));
  let pendingTitle = $state<string | null>(null);
  let highlightPulseActive = $state(false);
  let highlightRequestInitialized = false;
  let handledHighlightRequestId = 0;
  let scrollObservationFrame: number | null = null;
  let rowElement = $state<HTMLDivElement | null>(null);
  let renameInput = $state<HTMLInputElement | null>(null);
  let suppressNavigationSelect = false;
  let destinationPickerLoadState = $state<LazyComponentLoadState<
    "destination-picker",
    LoadedNotesOptionalComponent
  > | null>(null);

  function handleNavigationDragStart(event: DragEvent): void {
    suppressNavigationSelect = true;
    onNavigationDragStart?.(event);
  }

  function handleNavigationDragEnd(event: DragEvent): void {
    onNavigationDragEnd?.(event);
    window.setTimeout(() => {
      suppressNavigationSelect = false;
    }, 0);
  }

  function handleSelect(): void {
    if (suppressNavigationSelect) {
      suppressNavigationSelect = false;
      return;
    }
    onSelect();
  }
  const storedTitle = $derived(
    displayTitle === undefined
      ? notesPageTitle(page, t("notes.untitled"))
      : displayTitle.trim() || t("notes.untitled"),
  );
  const editableTitle = $derived(notesPageTitle(page, ""));
  const title = $derived(
    pendingTitle === null ? storedTitle : pendingTitle || t("notes.untitled"),
  );

  $effect(() => {
    if (pendingTitle !== null && editableTitle === pendingTitle) pendingTitle = null;
    if (!editing && pendingTitle === null) titleDraft = editableTitle;
  });

  $effect(() => {
    if (!menuOpen) {
      moveMenuOpen = false;
      folderMoveMenuOpen = false;
    }
  });

  $effect(() => {
    if (!editing) return;
    void tick().then(() => {
      renameInput?.focus();
      renameInput?.select();
    });
  });

  $effect(() => {
    const requestId = highlightRequestId;
    if (!highlightRequestInitialized) {
      highlightRequestInitialized = true;
      handledHighlightRequestId = requestId;
      return;
    }
    if (requestId <= 0 || requestId === handledHighlightRequestId) return;
    handledHighlightRequestId = requestId;
    highlightPulseActive = false;
    void tick().then(() => {
      revealAndHighlightCurrentRow(requestId);
    });
  });

  onDestroy(() => {
    if (scrollObservationFrame !== null) cancelAnimationFrame(scrollObservationFrame);
  });

  $effect(() => {
    if (moveMenuOpen || folderMoveMenuOpen) {
      requestDestinationPicker();
      void onRequestMoveTargets?.();
    }
  });

  function requestDestinationPicker(retry = false): void {
    if (!retry && destinationPickerLoadState?.key === "destination-picker") return;
    const loadingState = beginLazyComponentLoad(destinationPickerLoadState, "destination-picker");
    destinationPickerLoadState = loadingState;
    const request = retry
      ? retryNotesOptionalComponent("destination-picker")
      : loadNotesOptionalComponent("destination-picker");
    void request.then((component) => {
      if (!destinationPickerLoadState) return;
      destinationPickerLoadState = resolveLazyComponentLoad(
        destinationPickerLoadState,
        "destination-picker",
        loadingState.requestId,
        component,
      );
    }).catch((error: unknown) => {
      if (!destinationPickerLoadState) return;
      destinationPickerLoadState = rejectLazyComponentLoad(
        destinationPickerLoadState,
        "destination-picker",
        loadingState.requestId,
        error,
      );
      console.error("load Notes page destination picker failed", error);
    });
  }

  function revealAndHighlightCurrentRow(requestId: number): void {
    const row = rowElement;
    const scrollContainer = row?.closest<HTMLElement>("[data-notes-explorer-scroll]");
    if (!row || !scrollContainer) return;

    if (scrollObservationFrame !== null) cancelAnimationFrame(scrollObservationFrame);
    scrollObservationFrame = null;

    const rowBounds = row.getBoundingClientRect();
    const containerBounds = scrollContainer.getBoundingClientRect();
    const rowIsVisible = rowBounds.bottom > containerBounds.top
      && rowBounds.top < containerBounds.bottom;
    if (rowIsVisible) {
      highlightPulseActive = true;
      return;
    }

    let previousScrollTop = scrollContainer.scrollTop;
    let stableFrames = 0;
    let observedMovement = false;
    let observedFrames = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    row.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
      inline: "nearest",
    });

    const observeScroll = (): void => {
      if (handledHighlightRequestId !== requestId) return;

      const currentScrollTop = scrollContainer.scrollTop;
      const scrollDifference = Math.abs(currentScrollTop - previousScrollTop);
      observedFrames += 1;
      if (scrollDifference <= settledScrollTolerancePx) {
        stableFrames += 1;
      } else {
        observedMovement = true;
        stableFrames = 0;
      }
      previousScrollTop = currentScrollTop;

      if (
        (observedMovement && stableFrames >= settledScrollFrameCount)
        || observedFrames >= maximumScrollObservationFrames
      ) {
        scrollObservationFrame = null;
        highlightPulseActive = true;
        return;
      }
      scrollObservationFrame = requestAnimationFrame(observeScroll);
    };

    scrollObservationFrame = requestAnimationFrame(observeScroll);
  }

  function moveToTarget(targetKey: string): void {
    const target = moveTargets.find((candidate) => candidate.key === targetKey);
    if (!target) return;
    menuOpen = false;
    moveMenuOpen = false;
    onMove(target.parent);
  }

  function moveToFolderTarget(targetKey: string): void {
    const target = folderMoveTargets?.find((candidate) => candidate.key === targetKey);
    if (!target || !onMoveToFolder) return;
    menuOpen = false;
    moveMenuOpen = false;
    folderMoveMenuOpen = false;
    onMoveToFolder(target.folderId);
  }

  function closeMenu(): void {
    menuOpen = false;
    moveMenuOpen = false;
    folderMoveMenuOpen = false;
  }

  /** Open the existing row menu from a keyboard or pointer action button. */
  function openActionMenu(event: MouseEvent): void {
    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLButtonElement)) return;
    openContextMenu(event);
    const rect = trigger.getBoundingClientRect();
    menuStyle = notesRowContextMenuStyle(notesRowContextMenuGeometry({
      clientX: rect.left,
      clientY: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
    void tick().then(() => rowElement?.querySelector<HTMLButtonElement>('[role="menu"] button')?.focus());
  }

  function openContextMenu(event: MouseEvent): void {
    if (readOnly || editing) return;
    if (event.target instanceof Element && event.target.closest("[data-app-floating-surface]")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    menuStyle = notesRowContextMenuStyle(notesRowContextMenuGeometry({
      clientX: event.clientX,
      clientY: event.clientY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    }));
    menuOpen = true;
  }

  function saveRename(): void {
    if (!editing) return;
    const title = titleDraft.trim();
    const previousTitle = editableTitle;
    editing = false;
    menuOpen = false;
    titleDraft = title;
    if (title === editableTitle) return;
    pendingTitle = title;
    void Promise.resolve(onRename(title)).then((renamed) => {
      if (renamed !== false) return;
      pendingTitle = null;
      titleDraft = previousTitle;
    }).catch(() => {
      pendingTitle = null;
      titleDraft = previousTitle;
    });
  }

  function beginRename(): void {
    titleDraft = editableTitle;
    renameHistory = createInlineRenameHistory(titleDraft);
    editing = true;
  }

  function handleRenameInput(event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    titleDraft = input.value;
    const inputType = event instanceof InputEvent ? event.inputType : "";
    renameHistory = recordInlineRenameValue(
      renameHistory,
      titleDraft,
      inlineRenameInputKind(inputType),
      Date.now(),
    );
  }

  function handleRenameKeydown(event: KeyboardEvent): void {
    const historyAction = inlineRenameHistoryAction(event);
    if (historyAction) {
      event.preventDefault();
      event.stopPropagation();
      renameHistory = stepInlineRenameHistory(renameHistory, historyAction);
      titleDraft = inlineRenameHistoryValue(renameHistory);
      if (renameInput) {
        renameInput.value = titleDraft;
        renameInput.setSelectionRange(titleDraft.length, titleDraft.length);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      saveRename();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      editing = false;
      titleDraft = editableTitle;
    }
  }

  function parentStatusLabel(status: NotesPageParentStatus): string {
    return status === "trashed" ? t("notes.parentInTrash") : t("notes.parentMissing");
  }
</script>

<div
  bind:this={rowElement}
  class="notes-page-row group relative"
  class:notes-row-context-menu-open={menuOpen}
  class:notes-page-block-drop-target={blockDropActive}
  class:notes-page-row-current-file-pulse={highlightPulseActive}
  class:notes-navigation-dragging={navigationDragging}
  class:notes-navigation-draggable={Boolean(onNavigationDragStart) && !editing && !readOnly}
  class:notes-navigation-drop-valid={navigationDropState === "valid"}
  class:notes-navigation-drop-invalid={navigationDropState === "invalid"}
  role="group"
  aria-label={title}
  style={`--notes-page-depth: ${Math.min(depth, 10)}`}
  data-app-tooltip={blockDropActive ? t("notes.dropBlockOnPage", title) : undefined}
  ondragover={(event) => {
    onNavigationDragOver?.(event);
    onBlockDragOver?.(page.id, event);
  }}
  ondragleave={(event) => {
    onNavigationDragLeave?.(event);
    onBlockDragLeave?.(page.id, event);
  }}
  ondrop={(event) => {
    onNavigationDrop?.(event);
    onBlockDrop?.(page.id, event);
  }}
  draggable={!editing && !readOnly && Boolean(onNavigationDragStart)}
  ondragstart={handleNavigationDragStart}
  ondragend={handleNavigationDragEnd}
  oncontextmenu={openContextMenu}
  onanimationend={() => {
    highlightPulseActive = false;
  }}
  use:dismissOnOutside={{ enabled: menuOpen, onDismiss: closeMenu }}
>
  {#if editing}
    <div class={`notes-page-row-content explorer-row flex min-w-0 items-center rounded-md bg-accent/50 py-1.5 pr-1 text-foreground ${showDisclosure ? "" : "pl-2"}`}>
      {#if showDisclosure}
        <span class="size-6 shrink-0" aria-hidden="true"></span>
      {/if}
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        {#if page.icon}
          <NotesPageIcon
            icon={page.icon}
            size={explorerRowIconSize}
            strokeWidth={explorerRowIconStrokeWidth}
            emojiScale={COMPACT_IDENTITY_EMOJI_SCALE}
            class="explorer-row-icon"
          />
        {:else}
          <NotesPageIcon
            icon={null}
            size={explorerRowIconSize}
            strokeWidth={explorerRowIconStrokeWidth}
            emojiScale={COMPACT_IDENTITY_EMOJI_SCALE}
            class="explorer-row-icon"
          />
        {/if}
        <input
          bind:this={renameInput}
          class="min-w-0 flex-1 bg-transparent explorer-row-label text-[0.866667rem] text-inherit caret-primary outline-none placeholder:text-muted-foreground"
          data-app-shortcuts="ignore"
          aria-label={t("notes.renamePage")}
          value={titleDraft}
          placeholder={t("notes.titlePlaceholder")}
          oninput={handleRenameInput}
          onkeydown={handleRenameKeydown}
          onblur={saveRename}
        />
      </div>
    </div>
  {:else}
    <div
      class={`notes-page-row-content explorer-row flex min-w-0 items-center rounded-md pr-1 text-foreground hover:bg-accent/50 ${showDisclosure ? "" : "pl-2"}`}
      class:explorer-selected={selected}
    >
      {#if showDisclosure}
        <button
          class="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
          type="button"
          aria-label={collapsed ? t("notes.expandPage") : t("notes.collapsePage")}
          disabled={!hasChildren}
          onclick={(event) => {
            event.stopPropagation();
            onToggleCollapsed(!collapsed);
          }}
        >
          {#if hasChildren && collapsed}
            <ChevronRight class="size-4" strokeWidth={explorerRowIconStrokeWidth} />
          {:else if hasChildren}
            <ChevronDown class="size-4" strokeWidth={explorerRowIconStrokeWidth} />
          {/if}
        </button>
      {/if}
      <button
        class={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1 text-left explorer-row-label text-[0.866667rem] text-inherit ${selected ? "font-medium" : ""}`}
        type="button"
        aria-current={selected ? "page" : undefined}
        onclick={handleSelect}
      >
        {#if page.icon}
          <NotesPageIcon
            icon={page.icon}
            size={explorerRowIconSize}
            strokeWidth={explorerRowIconStrokeWidth}
            emojiScale={COMPACT_IDENTITY_EMOJI_SCALE}
            class="explorer-row-icon"
          />
        {:else}
          <NotesPageIcon
            icon={null}
            size={explorerRowIconSize}
            strokeWidth={explorerRowIconStrokeWidth}
            emojiScale={COMPACT_IDENTITY_EMOJI_SCALE}
            class="explorer-row-icon"
          />
        {/if}
        <span class="min-w-0 flex-1 truncate">{title}</span>
        {#if parentStatus}
          <TriangleAlert
            class="size-3.5 shrink-0 text-destructive"
            aria-label={parentStatusLabel(parentStatus)}
            data-app-tooltip={parentStatusLabel(parentStatus)}
          />
        {/if}
        {#if favorited}
          <Star class="size-3.5 shrink-0 fill-current text-primary" aria-hidden="true" />
        {/if}
      </button>
      {#if !readOnly}
      <button type="button" class="explorer-icon explorer-row-action" aria-label={`${t("notes.pageActions")}: ${title}`} data-app-tooltip={t("notes.pageActions")} aria-haspopup="menu" aria-expanded={menuOpen} onclick={openActionMenu}><EllipsisVertical size={14} /></button>
      {/if}
    </div>
  {/if}

  {#if menuOpen}
    <div
      class="notes-page-action-menu fixed z-50 min-w-36 rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg"
      style={menuStyle}
      role="menu"
      tabindex="-1"
      onkeydown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        closeMenu();
        rowElement?.querySelector<HTMLButtonElement>(".explorer-row-action")?.focus();
      }}
      data-app-floating-surface
    >
      <button
        class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.8rem] hover:bg-accent"
        type="button"
        onclick={() => {
          menuOpen = false;
          onCreateChild();
        }}
      >
        <FilePlus2 class="size-4" />
        <span>{t("notes.newSubpage")}</span>
      </button>
      <button
        class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.8rem] hover:bg-accent"
        type="button"
        onclick={() => {
          onToggleFavorite(!favorited);
          menuOpen = false;
        }}
      >
        <Star class={`size-4 ${favorited ? "fill-current text-primary" : ""}`} />
        <span>{favorited ? t("notes.removeFromFavorites") : t("notes.addToFavorites")}</span>
      </button>
      <button
        class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.8rem] hover:bg-accent"
        type="button"
        onclick={() => {
          beginRename();
          menuOpen = false;
        }}
      >
        <Pencil class="size-4" />
        <span>{t("notes.renamePage")}</span>
      </button>
      <button
        class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.8rem] hover:bg-accent"
        type="button"
        onclick={() => {
          menuOpen = false;
          onDuplicate();
        }}
      >
        <Copy class="size-4" />
        <span>{t("notes.duplicatePage")}</span>
      </button>
      <button
        class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.8rem] hover:bg-accent"
        type="button"
        aria-expanded={moveMenuOpen}
        onclick={() => {
          moveMenuOpen = !moveMenuOpen;
          folderMoveMenuOpen = false;
        }}
      >
        <FolderInput class="size-4" />
        <span>{t("notes.movePageTo")}</span>
      </button>
      {#if moveMenuOpen}
        <div
          class="notes-page-move-menu border-y border-border bg-muted/25 py-1"
          aria-label={t("notes.movePageTo")}
        >
          {#if destinationPickerLoadState?.status === "ready" && destinationPickerLoadState.component.kind === "destination-picker"}
            {@const NotesDestinationPickerList = destinationPickerLoadState.component.component}
            <NotesDestinationPickerList
              targets={moveTargets}
              searchLabel={t("notes.moveDestinationSearch")}
              searchPlaceholder={t("notes.moveDestinationSearchPlaceholder")}
              recentLabel={t("notes.recentDestinations")}
              pagesLabel={t("notes.allPages")}
              emptyLabel={t("notes.noPageMoveTargets")}
              optionLabel={(target) => t("notes.movePageToTarget", target.title)}
              onSelect={moveToTarget}
              onClose={() => {
                moveMenuOpen = false;
              }}
            />
          {:else if destinationPickerLoadState?.status === "failed"}
            <div class="p-2 text-[0.8rem] text-destructive" role="alert">
              <p>{t("common.viewLoadFailed", t("notes.movePageTo"))}</p>
              <button class="mt-2 min-h-8 rounded-md border border-border px-2 text-foreground hover:bg-accent" type="button" onclick={() => requestDestinationPicker(true)}>{t("common.retry")}</button>
            </div>
          {:else}
            <div class="p-2 text-[0.8rem] text-muted-foreground" aria-busy="true">{t("common.loading")}</div>
          {/if}
        </div>
      {/if}
      {#if folderMoveTargets && folderMoveTargets.length > 0 && onMoveToFolder}
        <button
          class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.8rem] hover:bg-accent"
          type="button"
          aria-expanded={folderMoveMenuOpen}
          onclick={() => {
            folderMoveMenuOpen = !folderMoveMenuOpen;
            moveMenuOpen = false;
          }}
        >
          <FolderTree class="size-4" />
          <span>{t("notes.movePageToFolder")}</span>
        </button>
        {#if folderMoveMenuOpen}
          <div
            class="notes-page-move-menu border-y border-border bg-muted/25 py-1"
            aria-label={t("notes.movePageToFolder")}
          >
            {#if destinationPickerLoadState?.status === "ready" && destinationPickerLoadState.component.kind === "destination-picker"}
              {@const NotesDestinationPickerList = destinationPickerLoadState.component.component}
              <NotesDestinationPickerList
                targets={folderMoveTargets}
                searchLabel={t("notes.moveDestinationSearch")}
                searchPlaceholder={t("notes.moveDestinationSearchPlaceholder")}
                recentLabel={t("notes.recentDestinations")}
                pagesLabel={t("notes.folders")}
                emptyLabel={t("notes.noFolderMoveTargets")}
                optionLabel={(target) => t("notes.movePageToFolderTarget", target.title)}
                onSelect={moveToFolderTarget}
                onClose={() => {
                  folderMoveMenuOpen = false;
                }}
              />
            {:else if destinationPickerLoadState?.status === "failed"}
              <div class="p-2 text-[0.8rem] text-destructive" role="alert">
                <p>{t("common.viewLoadFailed", t("notes.movePageToFolder"))}</p>
                <button class="mt-2 min-h-8 rounded-md border border-border px-2 text-foreground hover:bg-accent" type="button" onclick={() => requestDestinationPicker(true)}>{t("common.retry")}</button>
              </div>
            {:else}
              <div class="p-2 text-[0.8rem] text-muted-foreground" aria-busy="true">{t("common.loading")}</div>
            {/if}
          </div>
        {/if}
      {/if}
      <button
        class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.8rem] hover:bg-accent"
        type="button"
        onclick={() => {
          menuOpen = false;
          onArchive();
        }}
      >
        <Archive class="size-4" />
        <span>{t("notes.archivePage")}</span>
      </button>
      <button
        class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.8rem] text-destructive hover:bg-accent"
        type="button"
        onclick={() => {
          menuOpen = false;
          onTrash();
        }}
      >
        <Trash2 class="size-4" />
        <span>{t("notes.moveToTrash")}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .notes-page-row-content {
    margin-left: calc(var(--notes-page-depth) * 0.875rem);
  }

  .notes-row-context-menu-open .notes-page-row-content {
    background: color-mix(in oklab, var(--accent) 50%, transparent);
  }

  .notes-page-block-drop-target .notes-page-row-content {
    background: hsl(var(--primary) / 0.12);
    box-shadow: inset 0 0 0 1px hsl(var(--primary) / 0.55);
  }

  .notes-navigation-dragging .notes-page-row-content {
    opacity: 0.42;
  }

  .notes-navigation-draggable .notes-page-row-content {
    cursor: grab;
  }

  .notes-navigation-dragging .notes-page-row-content {
    cursor: grabbing;
  }

  .notes-navigation-drop-valid .notes-page-row-content {
    background: color-mix(in oklab, var(--accent) 78%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--foreground) 18%, transparent);
  }

  .notes-navigation-drop-invalid .notes-page-row-content {
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--destructive) 42%, transparent);
    cursor: no-drop;
  }

  .notes-page-row-current-file-pulse .notes-page-row-content {
    animation: notes-current-file-highlight 360ms ease-in-out 2;
  }

  @keyframes notes-current-file-highlight {
    0%, 100% {
      background-color: transparent;
    }

    50% {
      background-color: color-mix(in oklab, var(--accent) 55%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .notes-page-row-current-file-pulse .notes-page-row-content {
      animation-duration: 1ms;
      animation-iteration-count: 1;
    }
  }

  .notes-page-action-menu {
    width: min(16rem, calc(100vw - 1rem));
    max-height: min(22rem, calc(100vh - 4rem));
    overflow-y: auto;
  }

  .notes-page-move-menu {
    max-height: 12rem;
    overflow-y: auto;
  }
</style>
