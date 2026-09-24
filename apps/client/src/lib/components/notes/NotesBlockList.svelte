<script lang="ts">
  import { tick } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getNotes } from "$lib/stores/notes.svelte";
  import { getPomodoro } from "$lib/stores/pomodoro.svelte";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { buildNotesBlockLink, buildNotesPageLink } from "$lib/notes/block-link";
  import {
    notesBlockSelectionAfterClick,
    notesBlockSelectionAfterKeyboard,
    notesBlockSelectionContains,
    notesBlockSelectionForBlock,
    notesBlockSelectionPrunedToVisible,
    notesBlockSelectionRange,
    normalizeNotesSelectableBlockIds,
  } from "$lib/notes/block-selection";
  import type { NotesBlockSelectionState } from "$lib/notes/block-selection";
  import {
    notesSelectionPlainText,
    notesSelectionRootBlockIds,
    notesSelectionSubtreeIds,
    planNotesSelectionMoveWithinSiblings,
  } from "$lib/notes/block-selection-operations";
  import { notesTemplateBlockStatus } from "$lib/notes/template-block";
  import { notesButtonBlockStatus } from "$lib/notes/button-block";
  import type { NotesUnsupportedConversionTarget } from "$lib/notes/unsupported";
  import {
    blockPlainText,
    isTextEditableBlock,
    type NotesHeadingBlockType,
  } from "$lib/notes/block-factory";
  import type { NotesBlockInsertRequest } from "$lib/notes/block-insertion";
  import {
    type NotesTextSelection,
  } from "$lib/notes/editor-selection";
  import type {
    NotesDateMentionTarget,
    NotesNamedMentionTarget,
    NotesObjectMentionTarget,
    NotesPageMentionTarget,
    NotesRichTextAnnotationPatch,
  } from "$lib/notes/rich-text";
  import type { NotesKeyboardAction } from "$lib/notes/block-keyboard";
  import {
    notesMoveToPageTargets,
    type NotesMoveToPageTarget,
  } from "$lib/notes/block-move";
  import type {
    NotesBlock,
    NotesBlockTreeItem,
    NotesBlockType,
    NotesButtonInsertPosition,
    NotesIcon,
    NotesPageBreadcrumbItem,
    NotesRichText,
    NotesTableOfContentsItem,
  } from "$lib/notes/types";
  import NotesBlockRow from "./NotesBlockRow.svelte";
  import NotesBlockSelectionToolbar from "./NotesBlockSelectionToolbar.svelte";
  import NotesVirtualBlock from "./NotesVirtualBlock.svelte";
  import NotesVisibleBlockRenderer from "./NotesVisibleBlockRenderer.svelte";
  import { createNotesBlockDragController } from "./notes-block-drag-controller.svelte";
  import { createNotesBlockHandleController } from "./notes-block-handle-controller.svelte";
  import { createNotesBlockVirtualizer } from "./notes-block-virtualizer.svelte";
  import { createNotesBlockNavigationController } from "./notes-block-navigation-controller";
  import {
    createNotesBlockSelectionController,
    type NotesBlockSelectionDelegates,
  } from "./notes-block-selection-controller.svelte";
  import type {
    NotesBlockDragBindings,
    NotesBlockRenderActions,
    NotesBlockRenderLookups,
    NotesBlockRenderState,
    NotesColumnRenderActions,
    NotesTabRenderActions,
  } from "./notes-block-render-contract";
  import { createNotesStructuralBlockLoader } from "./notes-structural-block-loader.svelte";
  import {
    buildNotesMentionTargets,
    EMPTY_NOTES_MUSIC_MENTION_CONTEXT,
    type NotesMusicMentionContext,
  } from "./notes-block-mention-targets";
  import { createNotesMentionDataController } from "./notes-mention-data-controller.svelte";

  let {
    items,
    pageId,
    breadcrumbItems,
    tableOfContentsItems,
    onSelectPage,
    onFocusBlock,
    scrollViewport,
    musicMentionContext = EMPTY_NOTES_MUSIC_MENTION_CONTEXT,
  }: {
    items: NotesBlockTreeItem[];
    pageId: string;
    breadcrumbItems: NotesPageBreadcrumbItem[];
    tableOfContentsItems: NotesTableOfContentsItem[];
    onSelectPage: (pageId: string) => void;
    onFocusBlock: (blockId: string) => void;
    scrollViewport: HTMLDivElement | null;
    musicMentionContext?: NotesMusicMentionContext;
  } = $props();

  const notes = getNotes();
  const calendar = getCalendar();
  const pomodoro = getPomodoro();
  const projects = getProjects();
  const { t } = getLocalization();
  let blockListElement: HTMLDivElement | null = $state(null);
  const mentionDataController = createNotesMentionDataController();
  const mentionDataSources = $derived(mentionDataController.dataSources);
  const mentionDataSourceRowPages = $derived(mentionDataController.rowPages);
  const blockHandle = createNotesBlockHandleController();
  const blockSelectionController = createNotesBlockSelectionController({
    readPageId: () => pageId,
    readListElement: () => blockListElement,
    readRenderedBlockIds: renderedSelectableBlockIds,
    readTreeState: currentTreeState,
    blockIdFromEvent: (event) => navigation.blockIdFromEvent(event),
    targetIsEditable: (target) => navigation.targetIsEditable(target),
    targetIsSelectionZone: (target) => target instanceof Element && target.closest("[data-notes-block-selection-zone]") !== null,
    focusTextEditorAtEnd: (id) => navigation.focusTextEditorAtEnd(id),
    focusRow: (id, preventScroll) => navigation.focusRow(id, preventScroll),
    handleNavigationKeydown: (event, id) => navigation.handleKeydown(event, id),
    pasteBlocks: notes.pasteBlockSelection,
    duplicateBlocks: notes.duplicateBlockSelection,
    moveBlocks: notes.moveBlockSelection,
    deleteBlocks: notes.deleteBlockSelection,
  });
  const blockSelection = $derived(blockSelectionController.selection);
  const selectionDragAnchorBlockId = $derived(blockSelectionController.dragAnchorBlockId);
  const selectionDragPointerId = $derived(blockSelectionController.dragPointerId);
  const selectionClipboard = $derived(blockSelectionController.clipboard);
  const selectionBusy = $derived(blockSelectionController.busy);
  const selectionActionError = $derived(blockSelectionController.error);
  const selectedBlockCount = $derived(blockSelection?.selectedBlockIds.length ?? 0);
  const selectedRootBlockIds = $derived(blockSelectionController.selectedRootBlockIds);
  const canMoveSelectionUp = $derived(blockSelectionController.canMoveUp);
  const canMoveSelectionDown = $derived(blockSelectionController.canMoveDown);
  const mentionTargets: NotesNamedMentionTarget[] = $derived(buildMentionTargets());
  const renderState: NotesBlockRenderState = $derived({
    breadcrumbItems,
    tableOfContentsItems,
    focusBlockId: notes.focusBlockId,
    focusRequestId: notes.focusRequestId,
    focusSelection: notes.focusSelection,
    mentionTargets,
  });
  const structuralBlockLoader = createNotesStructuralBlockLoader();
  const columnListLoadState = $derived(structuralBlockLoader.stateFor("column-list"));
  const tabLoadState = $derived(structuralBlockLoader.stateFor("tab"));
  const blockDrag = createNotesBlockDragController({
    readTreeState: currentTreeState,
    dropBlock: (sourceBlockId, targetBlockId, intent) => (
      notes.dropBlockOnBlock(sourceBlockId, targetBlockId, intent)
    ),
  });
  const virtualizer = createNotesBlockVirtualizer({
    readScrollViewport: () => scrollViewport,
    readListElement: () => blockListElement,
    readOutlines: () => notes.flatBlockOutlines,
    readItems: () => items,
    readPinnedBlockIds: () => [
      blockDrag.draggingBlockId,
      blockHandle.openMenuBlockId,
      notes.focusBlockId,
      ...(blockSelection?.selectedBlockIds ?? []),
    ].filter((blockId): blockId is string => blockId !== null),
    readFocusRequest: () => ({
      blockId: notes.focusBlockId,
      requestId: notes.focusRequestId,
    }),
    hydrateBlockRange: notes.hydrateBlockRange,
  });
  const visibleRange = $derived(virtualizer.visibleRange);
  const visibleOutlines = $derived(virtualizer.visibleOutlines);
  const hydratedItemsById = $derived(virtualizer.hydratedItemsById);
  const measureVirtualBlock = virtualizer.measureBlock;

  $effect(() => {
    if (items.some((item) => item.block.type === "column_list")) {
      structuralBlockLoader.request("column-list");
    }
    if (items.some((item) => item.block.type === "tab")) structuralBlockLoader.request("tab");
  });

  $effect(() => {
    void mentionDataController.reload();
  });

  $effect(() => {
    if (!projects.loaded && !projects.loading) {
      void projects.ensureLoaded()
        .then(() => {
          if (projects.selectedProjectId) {
            return projects.ensureProjectData(projects.selectedProjectId);
          }
          return undefined;
        })
        .catch((error) => console.warn("notes mention project targets failed", error));
    }
  });

  $effect(() => {
    if (!calendar.loaded && !calendar.windowLoadBusy) {
      void calendar.load()
        .catch((error) => console.warn("notes mention calendar targets failed", error));
    }
  });

  function buildMentionTargets(): NotesNamedMentionTarget[] {
    return buildNotesMentionTargets({
      pages: notes.allPages,
      localUser: notes.localUser,
      dataSources: mentionDataSources,
      dataSourceRowPages: mentionDataSourceRowPages,
      projects: projects.projects,
      tasks: projects.tasks,
      calendarEvents: calendar.rawBlocks,
      activePomodoroRunId: pomodoro.activeRunId,
      pomodoroTime: pomodoro.formattedTime,
      currentMusicSource: musicMentionContext.currentMusicSource,
      musicQueue: musicMentionContext.musicQueue,
      translate: t,
    });
  }

  $effect(() => {
    const _pageId = pageId;
    const _itemCount = items.length;
    const _selection = blockSelection;
    void tick().then(() => {
      blockSelectionController.pruneToRendered();
    });
  });

  function renderedSelectableBlockIds(): string[] {
    if (!blockListElement) return items.map((item) => item.block.id);
    return normalizeNotesSelectableBlockIds(
      Array.from(blockListElement.querySelectorAll<HTMLElement>("[data-notes-selectable-block-id]"))
        .map((element) => element.dataset.notesSelectableBlockId ?? ""),
    );
  }

  function currentTreeState() {
    return {
      blocksById: notes.blocksById,
      childIdsByParentId: notes.childIdsByParentId,
    };
  }

  function templateStatusForBlock(blockId: string) {
    return notesTemplateBlockStatus(currentTreeState(), blockId);
  }

  function buttonStatusForBlock(blockId: string) {
    return notesButtonBlockStatus(currentTreeState(), blockId);
  }

  const navigation = createNotesBlockNavigationController({
    readListElement: () => blockListElement,
    readRenderedBlockIds: renderedSelectableBlockIds,
    readBlock: notes.blockById,
    requestFocus: notes.focusBlock,
  });

  const selectableBlockIdFromEvent = navigation.blockIdFromEvent;
  const eventTargetIsEditable = navigation.targetIsEditable;
  const focusSelectedBlockRow = navigation.focusRow;
  const focusTextEditorForBlock = navigation.focusTextEditorAtEnd;
  const handleDocumentNavigationKeydown = navigation.handleKeydown;

  function updateBlockHandleMenuOpen(blockId: string, open: boolean): void {
    blockHandle.setMenuOpen(blockId, open);
  }

  const blockSelectionDelegation = blockSelectionController.delegation;
  function handleKeyboardAction(blockId: string, action: NotesKeyboardAction): void {
    if (action.type === "create_sibling") {
      void notes.createSiblingAfter(blockId);
      return;
    }
    if (action.type === "split_text_block") {
      void splitTextBlockFromKeyboardAction(blockId, action);
      return;
    }
    if (action.type === "convert_to_paragraph") {
      void notes.convertBlock(blockId, "paragraph", true);
      return;
    }
    if (action.type === "apply_text_shortcut") {
      void notes.convertBlock(blockId, action.blockType, true);
      return;
    }
    if (action.type === "toggle_block_open") {
      const block = notes.blockById(blockId);
      if (block?.type === "toggle") {
        void notes.updateToggleOpen(blockId, block.toggle.ganbaru_open === false);
      }
      return;
    }
    if (action.type === "delete_block") {
      void notes.deleteBlock(blockId);
      return;
    }
    if (action.type === "merge_with_previous") {
      void notes.mergeBlockWithPrevious(blockId);
      return;
    }
    if (action.type === "nest") {
      void notes.nestBlock(blockId);
      return;
    }
    if (action.type === "outdent") {
      void notes.outdentBlock(blockId);
      return;
    }
    if (action.type === "move_up") {
      void notes.moveBlockUp(blockId);
      return;
    }
    if (action.type === "move_down") {
      void notes.moveBlockDown(blockId);
    }
  }

  async function splitTextBlockFromKeyboardAction(
    blockId: string,
    action: Extract<NotesKeyboardAction, { type: "split_text_block" }>,
  ): Promise<void> {
    await notes.updateBlockText(blockId, action.text);
    await notes.splitTextBlockAtSelection(blockId, action.selectionStart, action.selectionEnd);
  }

  function handleConvert(blockId: string, type: NotesBlockType, clearText = false): void {
    void notes.convertBlock(blockId, type, clearText);
  }

  function convertToToggleHeading(blockId: string, type: NotesHeadingBlockType, clearText = false): void {
    void notes.convertBlockToToggleHeading(blockId, type, clearText);
  }

  function moveTargetsForBlock(block: NotesBlock): NotesMoveToPageTarget[] {
    return notesMoveToPageTargets(notes.allPages, block, pageId, t("notes.untitled"), {
      recentPageIds: notes.recentPageIds,
      excludedPageIds: loadedChildPageIdsInSubtree(block.id),
    });
  }

  function moveTargetsForBlockId(blockId: string): NotesMoveToPageTarget[] {
    const block = notes.blockById(blockId);
    return block ? moveTargetsForBlock(block) : [];
  }

  function loadedChildPageIdsInSubtree(blockId: string): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const queue = [blockId];
    while (queue.length > 0) {
      const currentBlockId = queue.shift();
      if (!currentBlockId || seen.has(currentBlockId)) continue;
      seen.add(currentBlockId);
      const block = notes.blockById(currentBlockId);
      if (block?.type === "child_page") result.push(block.id);
      queue.push(...(notes.childIdsByParentId[currentBlockId] ?? []));
    }
    return result;
  }

  async function copyBlockLink(blockId: string): Promise<void> {
    const link = buildNotesBlockLink(window.location.href, { pageId, blockId });
    await navigator.clipboard.writeText(link);
  }

  async function insertPageMention(
    blockId: string,
    start: number,
    end: number,
    target: NotesPageMentionTarget,
  ): Promise<void> {
    await notes.insertPageMention(
      blockId,
      start,
      end,
      target.id,
      target.title,
      buildNotesPageLink(window.location.href, { pageId: target.id }),
    );
  }

  async function insertDateMention(
    blockId: string,
    start: number,
    end: number,
    target: NotesDateMentionTarget,
  ): Promise<void> {
    await notes.insertDateMention(blockId, start, end, target.date, target.title);
  }

  async function insertObjectMention(
    blockId: string,
    start: number,
    end: number,
    target: NotesObjectMentionTarget,
  ): Promise<void> {
    await notes.insertObjectMention(blockId, start, end, target);
  }

  async function applyTextAnnotations(
    blockId: string,
    start: number,
    end: number,
    patch: NotesRichTextAnnotationPatch,
  ): Promise<void> {
    await notes.updateBlockTextAnnotations(blockId, start, end, patch);
  }

  async function applyTextLink(
    blockId: string,
    start: number,
    end: number,
    url: string | null,
  ): Promise<void> {
    await notes.updateBlockTextLink(blockId, start, end, url);
  }

  async function insertInlineEquation(
    blockId: string,
    start: number,
    end: number,
    expression: string,
  ): Promise<void> {
    await notes.insertInlineEquation(blockId, start, end, expression);
  }

  function pastePlainText(
    blockId: string,
    start: number,
    end: number,
    plainText: string,
  ): Promise<boolean> {
    return notes.pastePlainTextIntoBlock(blockId, start, end, plainText);
  }

  function pasteRichHtml(
    blockId: string,
    start: number,
    end: number,
    html: string,
  ): Promise<boolean> {
    return notes.pasteRichHtmlIntoBlock(blockId, start, end, html);
  }

  function replaceBlockRichText(
    blockId: string,
    richText: readonly NotesRichText[],
  ): void {
    void notes.updateBlockRichText(blockId, richText);
  }

  function replaceTableCellRichText(
    rowBlockId: string,
    columnIndex: number,
    richText: readonly NotesRichText[],
  ): void {
    void notes.updateTableCellRichText(rowBlockId, columnIndex, richText);
  }

  function addTableRow(tableBlockId: string, afterRowIndex: number): Promise<void> {
    return notes.addTableRow(tableBlockId, afterRowIndex);
  }

  function removeTableRow(tableBlockId: string, rowBlockId: string): Promise<void> {
    return notes.removeTableRow(tableBlockId, rowBlockId);
  }

  function addTableColumn(tableBlockId: string, afterColumnIndex: number): Promise<void> {
    return notes.addTableColumn(tableBlockId, afterColumnIndex);
  }

  function removeTableColumn(tableBlockId: string, columnIndex: number): Promise<void> {
    return notes.removeTableColumn(tableBlockId, columnIndex);
  }

  function addColumn(columnListBlockId: string, afterColumnIndex: number): Promise<void> {
    return notes.addColumn(columnListBlockId, afterColumnIndex);
  }

  function removeColumn(columnListBlockId: string, columnBlockId: string): Promise<void> {
    return notes.removeColumn(columnListBlockId, columnBlockId);
  }

  function moveColumn(
    columnListBlockId: string,
    columnBlockId: string,
    direction: "left" | "right",
  ): Promise<void> {
    return notes.moveColumn(columnListBlockId, columnBlockId, direction);
  }

  function resizeColumn(
    columnListBlockId: string,
    columnBlockId: string,
    widthRatio: number,
  ): Promise<void> {
    return notes.resizeColumn(columnListBlockId, columnBlockId, widthRatio);
  }

  function moveBlockToColumn(blockId: string, columnBlockId: string): Promise<void> {
    return notes.moveBlockToColumn(blockId, columnBlockId);
  }

  function updateTabLabel(labelBlockId: string, label: string): Promise<void> {
    return notes.updateTabLabel(labelBlockId, label);
  }

  function updateTabIcon(labelBlockId: string, icon: NotesIcon | null): Promise<void> {
    return notes.updateTabIcon(labelBlockId, icon);
  }

  function addTab(tabBlockId: string, afterTabIndex: number): Promise<void> {
    return notes.addTab(tabBlockId, afterTabIndex);
  }

  function removeTab(tabBlockId: string, labelBlockId: string): Promise<void> {
    return notes.removeTab(tabBlockId, labelBlockId);
  }

  function moveTab(
    tabBlockId: string,
    labelBlockId: string,
    direction: "left" | "right",
  ): Promise<void> {
    return notes.moveTab(tabBlockId, labelBlockId, direction);
  }

  function moveBlockToTab(blockId: string, labelBlockId: string): Promise<void> {
    return notes.moveBlockToTab(blockId, labelBlockId);
  }

  function undoNotesEdit(): void {
    void notes.undoNotesEdit();
  }

  function redoNotesEdit(): void {
    void notes.redoNotesEdit();
  }

  const draggingBlockId = $derived(blockDrag.draggingBlockId);
  const handleBlockDragStart = blockDrag.start;
  const handleBlockDragEnd = blockDrag.end;
  const handleBlockDragOver = blockDrag.over;
  const handleBlockDragLeave = blockDrag.leave;
  const handleBlockDrop = blockDrag.drop;
  const dropPositionForBlock = blockDrag.dropPositionForBlock;
  const renderActions: NotesBlockRenderActions = {
    onTextInput: (id, text, selection) => void notes.updateBlockText(id, text, selection),
    onReplaceRichText: replaceBlockRichText,
    onInsertPageMention: insertPageMention, onInsertDateMention: insertDateMention,
    onInsertObjectMention: insertObjectMention, onApplyTextLink: applyTextLink,
    onInsertInlineEquation: insertInlineEquation, onPastePlainText: pastePlainText,
    onPasteRichHtml: pasteRichHtml, onApplyTextAnnotations: applyTextAnnotations,
    onCreateInlineComment: notes.startInlineComment, onCreateInlineSuggestion: notes.startInlineSuggestion,
    onKeyboardAction: handleKeyboardAction, onUndo: undoNotesEdit, onRedo: redoNotesEdit,
    onAddBelow: (id, request) => void notes.createSiblingAfter(id, request), onConvert: handleConvert,
    onConvertToToggleHeading: convertToToggleHeading, onColorChange: (id, color) => void notes.updateBlockColor(id, color),
    onCopyLink: copyBlockLink, onDuplicate: (id) => void notes.duplicateBlock(id),
    onUseTemplate: (id) => void notes.useTemplateBlock(id), onAddTemplateChild: (id) => void notes.addTemplateChild(id),
    onUseButton: (id) => void notes.useButtonBlock(id), onAddButtonChild: (id) => void notes.addButtonChild(id),
    onButtonIconChange: (id, icon) => void notes.updateButtonIcon(id, icon),
    onButtonInsertPositionChange: (id, position) => void notes.updateButtonInsertPosition(id, position),
    onCreateLinkedDatabaseView: notes.createLinkedDatabaseViewAfter, onConvertUnsupported: notes.convertUnsupportedBlock,
    onComment: (id) => void notes.startBlockComment(id), onMoveUp: (id) => void notes.moveBlockUp(id),
    onMoveDown: (id) => void notes.moveBlockDown(id), onMoveToPage: (id, page) => void notes.moveBlockToPage(id, page),
    onDelete: (id) => void notes.deleteBlock(id), onToggleTodo: (id, checked) => void notes.toggleTodo(id, checked),
    onToggleOpen: (id, open) => void notes.updateToggleOpen(id, open),
    onCodeLanguageChange: (id, language) => void notes.updateCodeLanguage(id, language),
    onBookmarkChange: (id, url, caption) => void notes.updateBookmark(id, url, caption),
    onLinkPreviewUrlChange: (id, url) => void notes.updateLinkPreviewUrl(id, url),
    onEmbedUrlChange: (id, url) => void notes.updateEmbedUrl(id, url),
    onEquationExpressionChange: (id, expression) => void notes.updateEquationExpression(id, expression),
    onMediaChange: (id, url, caption, name, change) => void notes.updateMedia(id, url, caption, name, change),
    onTableCellRichTextChange: replaceTableCellRichText,
    onAddTableRow: addTableRow, onRemoveTableRow: removeTableRow,
    onAddTableColumn: addTableColumn, onRemoveTableColumn: removeTableColumn,
    onSelectPage: (id) => onSelectPage(id), onFocusBlock: (id) => onFocusBlock(id),
    onHandleMenuOpenChange: updateBlockHandleMenuOpen,
  };
  const renderLookups: NotesBlockRenderLookups = {
    tableRowsForBlock: notes.tableRowsForBlock, previousBlockTypeForBlock: notes.previousBlockType,
    isOnlyBlockForBlock: notes.isOnlyBlock, moveTargetsForBlock: moveTargetsForBlockId,
    templateStatusForBlock, buttonStatusForBlock,
  };
  const columnRenderActions: NotesColumnRenderActions = { onAddColumn: addColumn, onRemoveColumn: removeColumn, onMoveColumn: moveColumn, onResizeColumn: resizeColumn, onMoveBlockToColumn: moveBlockToColumn };
  const tabRenderActions: NotesTabRenderActions = { onUpdateTabLabel: updateTabLabel, onUpdateTabIcon: updateTabIcon, onAddTab: addTab, onRemoveTab: removeTab, onMoveTab: moveTab, onMoveBlockToTab: moveBlockToTab };
  const dragBindings: NotesBlockDragBindings = $derived({ draggingBlockId, dropPositionForBlock, onDragStart: handleBlockDragStart, onDragEnd: handleBlockDragEnd, onDragOver: handleBlockDragOver, onDragLeave: handleBlockDragLeave, onDrop: handleBlockDrop });
</script>

<div
  use:blockSelectionDelegation
  bind:this={blockListElement}
  class="notes-block-list flex min-w-0 flex-col gap-0.5 pb-8"
  role="group"
  aria-label={t("notes.blockList")}
>
  {#if blockSelection}
    <NotesBlockSelectionToolbar
      selectedCount={selectedBlockCount}
      hasSelectedRoots={selectedRootBlockIds.length > 0}
      clipboardAvailable={selectionClipboard !== null}
      canMoveUp={canMoveSelectionUp}
      canMoveDown={canMoveSelectionDown}
      busy={selectionBusy}
      error={selectionActionError}
      onCopy={() => void blockSelectionController.run(() => blockSelectionController.copy("copy"))}
      onCut={() => void blockSelectionController.run(() => blockSelectionController.copy("cut"))}
      onPaste={() => void blockSelectionController.run(() => blockSelectionController.paste(blockSelection?.focusBlockId ?? notes.focusBlockId))}
      onDuplicate={() => void blockSelectionController.run(blockSelectionController.duplicate)}
      onMoveUp={() => void blockSelectionController.run(() => blockSelectionController.move("up"))}
      onMoveDown={() => void blockSelectionController.run(() => blockSelectionController.move("down"))}
      onDelete={() => void blockSelectionController.run(blockSelectionController.remove)}
    />
  {/if}
  {#if visibleRange.topHeight > 0}
    <div aria-hidden="true" style:height={`${visibleRange.topHeight}px`}></div>
  {/if}
  {#each visibleOutlines as outlineItem (outlineItem.outline.id)}
    {@const item = hydratedItemsById.get(outlineItem.outline.id)}
    <NotesVirtualBlock
      {item}
      blockId={outlineItem.outline.id}
      retainedHeight={outlineItem.outline.retained_height}
      measure={measureVirtualBlock}
    >
      {#snippet children(item)}
      <NotesVisibleBlockRenderer
        {item}
        state={renderState}
        actions={renderActions}
        drag={dragBindings}
        lookups={renderLookups}
        columnActions={columnRenderActions}
        tabActions={tabRenderActions}
        columnItems={notes.columnItemsForBlock(item.block.id)}
        tabItems={notes.tabItemsForBlock(item.block.id)}
        tableRows={notes.tableRowsForBlock(item.block.id)}
        previousBlockType={notes.previousBlockType(item.block.id)}
        isOnlyBlock={notes.isOnlyBlock(item.block.id)}
        moveTargets={moveTargetsForBlock(item.block)}
        templateStatus={templateStatusForBlock(item.block.id)}
        buttonStatus={buttonStatusForBlock(item.block.id)}
        columnComponent={columnListLoadState?.status === "ready" && columnListLoadState.component.kind === "column-list" ? columnListLoadState.component.component : null}
        tabComponent={tabLoadState?.status === "ready" && tabLoadState.component.kind === "tab" ? tabLoadState.component.component : null}
        columnFailed={columnListLoadState?.status === "failed"}
        tabFailed={tabLoadState?.status === "failed"}
        retryStructural={(kind) => structuralBlockLoader.request(kind, true)}
      />
      {/snippet}
    </NotesVirtualBlock>
  {/each}
  {#if visibleRange.bottomHeight > 0}
    <div aria-hidden="true" style:height={`${visibleRange.bottomHeight}px`}></div>
  {/if}
</div>

<style>
  :global(.notes-block-row[data-notes-block-selected="true"] > .notes-block-surface) {
    background: hsl(var(--primary) / 0.12);
    box-shadow: inset 0 0 0 1px hsl(var(--primary) / 0.42);
  }

  :global(.notes-block-row[data-notes-block-selected="true"]:focus-visible > .notes-block-surface) {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 1px;
  }

</style>
