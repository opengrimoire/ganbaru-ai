import { invalidateReplacedNotesMediaAsset } from "./notes-store-block-media-actions";
import {
  updateNotesBlock,
  createNotesDatabase,
  createNotesLinkedDatabaseView,
} from "$lib/api/notes";
import { blockColor, blockWithColor, canBlockHaveColor } from "$lib/notes/block-color";
import {
  blockConvertedToType,
  blockPlainText,
  blockWithCodeLanguage,
  blockIndent,
  blockUpdateWithIndent,
  blockWithHeadingToggleable,
  blockWithHeadingToggleOpen,
  blockWithTodoChecked,
  blockWithToggleOpen,
  createBlockUpdate,
  createBlockWrite,
  createColumnPayload,
  createEmptyTableRowPayload,
  DEFAULT_TABLE_ROW_COUNT,
  DEFAULT_TABLE_WIDTH,
  type NotesHeadingBlockType,
} from "$lib/notes/block-factory";
import {
  createBlockWriteFromInsertCommand,
  normalizeNotesBlockInsertCommand,
  type NotesBlockInsertRequest,
} from "$lib/notes/block-insertion";
import { createNotesLinkedDatabaseViewRequest } from "$lib/notes/database-linked";
import { planNotesInsertedBlockFocus } from "$lib/notes/editor-focus";
import {
  unsupportedBlockJsonText,
  unsupportedBlockSummaryText,
  type NotesUnsupportedConversionTarget,
} from "$lib/notes/unsupported";
import type {
  NotesAppendBlockChildrenRequest,
  NotesBlock,
  NotesBlockType,
  NotesBlockUpdate,
  NotesBlockWrite,
  NotesColor,
  NotesColumnBlockItems,
  NotesTabBlockItems,
  NotesTableRowBlock,
} from "$lib/notes/types";
import type { NotesTextSelection } from "$lib/notes/editor-selection";
import type { NotesUndoKind, NotesUndoSnapshot } from "$lib/notes/undo-history";
import type { NotesPostMutationResult } from "$lib/notes/post-mutation";

const DEFAULT_DATABASE_TITLE = "Untitled database";
const START_OF_BLOCK_SELECTION: NotesTextSelection = { start: 0, end: 0 };

interface NotesStructuralBlockActionsContext {
  enqueueEditorMutation: (mutation: () => Promise<void>) => Promise<void>;
  localApplyBlockUpdate: (blockId: string, update: NotesBlockUpdate) => void;
  readSelectedPageId: () => string | null;
  readChildIdsByParentId: () => Record<string, string[]>;
  blockById: (blockId: string) => NotesBlock | undefined;
  columnItemsForBlock: (blockId: string) => NotesColumnBlockItems[];
  tabItemsForBlock: (blockId: string) => NotesTabBlockItems[];
  tableRowsForBlock: (blockId: string) => NotesTableRowBlock[];
  createChildPageFromBlock: (blockId: string) => Promise<void>;
  createChildPageAfterBlock: (blockId: string) => Promise<void>;
  requestBlockFocus: (blockId: string | null, selection?: NotesTextSelection | null) => void;
  flushBlockSave: (blockId: string) => Promise<void>;
  applyPostMutation: (result: NotesPostMutationResult) => void;
  replaceBlockWithUpdate: (blockId: string, update: NotesBlockUpdate) => Promise<void>;
  appendAndApply: (request: NotesAppendBlockChildrenRequest) => Promise<NotesBlock[]>;
  undoSnapshot: (focusBlockId: string | null) => NotesUndoSnapshot | null;
  recordUndoAfter: (
    kind: NotesUndoKind,
    before: NotesUndoSnapshot | null,
    focusBlockId: string | null,
  ) => void;
}

export interface NotesStructuralBlockActions {
  convertBlock: (blockId: string, type: NotesBlockType, clearText?: boolean, selection?: NotesTextSelection) => Promise<void>;
  toggleTodo: (blockId: string, checked: boolean) => Promise<void>;
  updateCodeLanguage: (blockId: string, language: string) => Promise<void>;
  updateBlockColor: (blockId: string, color: NotesColor) => Promise<void>;
  updateToggleOpen: (blockId: string, open: boolean) => Promise<void>;
  convertBlockToToggleHeading: (
    blockId: string,
    headingType: NotesHeadingBlockType,
    clearText?: boolean,
  ) => Promise<void>;
  createSiblingAfter: (blockId: string, request?: NotesBlockInsertRequest) => Promise<void>;
  createLinkedDatabaseViewAfter: (blockId: string) => Promise<void>;
  convertUnsupportedBlock: (
    blockId: string,
    target: NotesUnsupportedConversionTarget,
  ) => Promise<void>;
}

/** Create block conversion, insertion, and advanced database actions. */
export function createNotesStructuralBlockActions(
  context: NotesStructuralBlockActionsContext,
): NotesStructuralBlockActions {
  const childIdsByParentId = context.readChildIdsByParentId;
  const {
    appendAndApply,
    recordUndoAfter,
    replaceBlockWithUpdate,
    undoSnapshot,
  } = context;

  function applyEditorUpdate(blockId: string, update: NotesBlockUpdate): void {
    const previous = context.blockById(blockId);
    context.localApplyBlockUpdate(blockId, update);
    void context.enqueueEditorMutation(async () => {
      await updateNotesBlock(blockId, update);
      invalidateReplacedNotesMediaAsset(previous, update);
    })
      .catch((error: unknown) => console.warn("Notes block update persistence failed", error));
  }

  /** Convert a block while optionally retaining a specific caret through the undo snapshot. */
  async function convertBlock(
    blockId: string,
    type: NotesBlockType,
    clearText = false,
    selection?: NotesTextSelection,
  ): Promise<void> {
    const block = context.blockById(blockId);
    if (!block) return;
    if (type === "child_page") {
      await context.createChildPageFromBlock(blockId);
      return;
    }
    if (type === "child_database") {
      await createDatabaseFromBlock(blockId);
      return;
    }
    const before = undoSnapshot(blockId);
    if (type === "table") {
      await createTableFromBlock(blockId);
      recordUndoAfter("convert", before, blockId);
      return;
    }
    if (type === "column_list") {
      await createColumnListFromBlock(blockId);
      recordUndoAfter("convert", before, blockId);
      return;
    }
    if (type === "tab") {
      await createTabFromBlock(blockId);
      recordUndoAfter("convert", before, blockId);
      return;
    }
    if (block.type === "child_page") return;
    if (block.type === "table" || block.type === "table_row") return;
    if (block.type === "column_list" || block.type === "column") return;
    if (block.type === "tab") return;
    const update = blockUpdateWithIndent(clearText ? createBlockUpdate(type, "") : blockConvertedToType(block, type), blockIndent(block));
    applyEditorUpdate(blockId, update);
    context.requestBlockFocus(blockId, selection);
    recordUndoAfter("convert", before, blockId);
  }

  async function convertUnsupportedBlock(
    blockId: string,
    target: NotesUnsupportedConversionTarget,
  ): Promise<void> {
    const block = context.blockById(blockId);
    if (!block || block.type !== "unsupported") return;
    await context.flushBlockSave(blockId);
    const before = undoSnapshot(blockId);
    const text = target === "code"
      ? unsupportedBlockJsonText(block.unsupported)
      : unsupportedBlockSummaryText(block.unsupported);
    const update = createBlockUpdate(target === "code" ? "code" : "paragraph", text);
    await replaceBlockWithUpdate(blockId, update);
    context.requestBlockFocus(blockId);
    recordUndoAfter("convert", before, blockId);
  }

  async function createDatabaseFromBlock(blockId: string): Promise<void> {
    const selectedPageId = context.readSelectedPageId();
    const block = context.blockById(blockId);
    if (!selectedPageId || !block || !canConvertBlockToDatabase(block)) return;
    await context.flushBlockSave(blockId);
    const currentBlock = context.blockById(blockId) ?? block;
    if (!canConvertBlockToDatabase(currentBlock)) return;
    const before = undoSnapshot(blockId);
    const title = blockPlainText(currentBlock).trim() || DEFAULT_DATABASE_TITLE;
    const created = await createNotesDatabase({
      id: blockId,
      data_source_id: crypto.randomUUID(),
      view_id: crypto.randomUUID(),
      title,
      replace_block_id: blockId,
    });
    context.applyPostMutation({ blocks: [created.block] });
    context.requestBlockFocus(created.block.id);
    recordUndoAfter("convert", before, created.block.id);
  }

  function canConvertBlockToDatabase(block: NotesBlock): boolean {
    if (
      block.type === "child_page"
      || block.type === "table"
      || block.type === "table_row"
      || block.type === "column_list"
      || block.type === "column"
      || block.type === "tab"
    ) {
      return false;
    }
    return block.type !== "child_database" || block.child_database.database_id === undefined;
  }

  async function createTableFromBlock(blockId: string): Promise<void> {
    const selectedPageId = context.readSelectedPageId();
    if (!selectedPageId) return;
    const block = context.blockById(blockId);
    if (!block || block.type === "child_page" || block.type === "table_row") return;
    if ((childIdsByParentId()[blockId] ?? []).length > 0 && block.type !== "table") return;
    await replaceBlockWithUpdate(blockId, createBlockUpdate("table", ""));
    if (context.tableRowsForBlock(blockId).length === 0) {
    await appendAndApply({
        parent: { type: "block_id", block_id: blockId },
        after: null,
        children: Array.from({ length: DEFAULT_TABLE_ROW_COUNT }, () => ({
          id: crypto.randomUUID(),
          type: "table_row" as const,
          table_row: createEmptyTableRowPayload(DEFAULT_TABLE_WIDTH),
        })),
      });
    }
    context.requestBlockFocus(blockId);
  }

  async function createColumnListFromBlock(blockId: string): Promise<void> {
    const selectedPageId = context.readSelectedPageId();
    if (!selectedPageId) return;
    const block = context.blockById(blockId);
    if (
      !block
      || block.type === "child_page"
      || block.type === "table_row"
      || block.type === "column"
    ) {
      return;
    }
    if ((childIdsByParentId()[blockId] ?? []).length > 0 && block.type !== "column_list") return;
    await replaceBlockWithUpdate(blockId, createBlockUpdate("column_list", ""));
    if (context.columnItemsForBlock(blockId).length === 0) {
      const leftColumnId = crypto.randomUUID();
      const rightColumnId = crypto.randomUUID();
      const leftBlockId = crypto.randomUUID();
      const rightBlockId = crypto.randomUUID();
      const columns: NotesBlockWrite[] = [
        {
          id: leftColumnId,
          type: "column",
          column: createColumnPayload(0.5),
        },
        {
          id: rightColumnId,
          type: "column",
          column: createColumnPayload(0.5),
        },
      ];
    await appendAndApply({
        parent: { type: "block_id", block_id: blockId },
        after: null,
        children: columns,
      });
    await appendAndApply({
        parent: { type: "block_id", block_id: leftColumnId },
        after: null,
        children: [createBlockWrite(leftBlockId, "paragraph")],
      });
    await appendAndApply({
        parent: { type: "block_id", block_id: rightColumnId },
        after: null,
        children: [createBlockWrite(rightBlockId, "paragraph")],
      });
      context.requestBlockFocus(leftBlockId);
      return;
    }
    context.requestBlockFocus(blockId);
  }

  async function createTabFromBlock(blockId: string): Promise<void> {
    const selectedPageId = context.readSelectedPageId();
    if (!selectedPageId) return;
    const block = context.blockById(blockId);
    if (
      !block
      || block.type === "child_page"
      || block.type === "table_row"
      || block.type === "column"
    ) {
      return;
    }
    if ((childIdsByParentId()[blockId] ?? []).length > 0 && block.type !== "tab") return;
    const firstLabel = blockPlainText(block).trim() || "Tab 1";
    await replaceBlockWithUpdate(blockId, createBlockUpdate("tab", ""));
    if (context.tabItemsForBlock(blockId).length === 0) {
      const firstLabelId = crypto.randomUUID();
      const secondLabelId = crypto.randomUUID();
      const firstContentId = crypto.randomUUID();
      const secondContentId = crypto.randomUUID();
    await appendAndApply({
        parent: { type: "block_id", block_id: blockId },
        after: null,
        children: [
          createBlockWrite(firstLabelId, "paragraph", firstLabel),
          createBlockWrite(secondLabelId, "paragraph", "Tab 2"),
        ],
      });
    await appendAndApply({
        parent: { type: "block_id", block_id: firstLabelId },
        after: null,
        children: [createBlockWrite(firstContentId, "paragraph")],
      });
    await appendAndApply({
        parent: { type: "block_id", block_id: secondLabelId },
        after: null,
        children: [createBlockWrite(secondContentId, "paragraph")],
      });
      context.requestBlockFocus(firstContentId);
      return;
    }
    context.requestBlockFocus(blockId);
  }

  async function toggleTodo(blockId: string, checked: boolean): Promise<void> {
    const block = context.blockById(blockId);
    if (!block) return;
    const before = undoSnapshot(blockId);
    applyEditorUpdate(blockId, blockWithTodoChecked(block, checked));
    recordUndoAfter("update", before, blockId);
  }

  async function updateCodeLanguage(blockId: string, language: string): Promise<void> {
    const block = context.blockById(blockId);
    if (!block) return;
    const before = undoSnapshot(blockId);
    applyEditorUpdate(blockId, blockWithCodeLanguage(block, language));
    recordUndoAfter("update", before, blockId);
  }

  async function updateBlockColor(blockId: string, color: NotesColor): Promise<void> {
    const block = context.blockById(blockId);
    if (!block) return;
    const before = undoSnapshot(blockId);
    applyEditorUpdate(blockId, blockWithColor(block, color));
    recordUndoAfter("formatting", before, blockId);
  }

  async function updateToggleOpen(blockId: string, open: boolean): Promise<void> {
    const block = context.blockById(blockId);
    if (!block) return;
    const before = undoSnapshot(blockId);
    if (block.type === "toggle") {
      applyEditorUpdate(blockId, blockWithToggleOpen(block, open));
      recordUndoAfter("update", before, blockId);
      return;
    }
    if (
      (block.type === "heading_1" && block.heading_1.is_toggleable === true)
      || (block.type === "heading_2" && block.heading_2.is_toggleable === true)
      || (block.type === "heading_3" && block.heading_3.is_toggleable === true)
      || (block.type === "heading_4" && block.heading_4.is_toggleable === true)
    ) {
      applyEditorUpdate(blockId, blockWithHeadingToggleOpen(block, open));
      recordUndoAfter("update", before, blockId);
    }
  }

  async function convertBlockToToggleHeading(
    blockId: string,
    headingType: NotesHeadingBlockType,
    clearText = false,
  ): Promise<void> {
    const block = context.blockById(blockId);
    if (!block) return;
    if (block.type === "child_page") return;
    if (block.type === "table" || block.type === "table_row") return;
    if (block.type === "column_list" || block.type === "column") return;
    const before = undoSnapshot(blockId);
    const update = clearText
      ? createBlockUpdate(
        headingType,
        "",
        canBlockHaveColor(block.type) ? blockColor(block) : "default",
        {
          isToggleable: true,
          open: true,
        },
      )
      : blockWithHeadingToggleable(block, headingType, true);
    applyEditorUpdate(blockId, update);
    context.requestBlockFocus(blockId);
    recordUndoAfter("convert", before, blockId);
  }

  async function createSiblingAfter(
    blockId: string,
    request?: NotesBlockInsertRequest,
  ): Promise<void> {
    const block = context.blockById(blockId);
    const selectedPageId = context.readSelectedPageId();
    if (!block || !selectedPageId) return;
    const command = normalizeNotesBlockInsertCommand(request);
    if (command.kind === "block" && command.blockType === "child_page") {
      await context.createChildPageAfterBlock(blockId);
      return;
    }
    if (command.kind === "block" && command.blockType === "child_database") {
      await createDatabaseAfterBlock(blockId);
      return;
    }
    await context.flushBlockSave(blockId);
    const before = undoSnapshot(blockId);
    const newBlockId = crypto.randomUUID();
    await appendAndApply({
      parent: block.parent,
      after: blockId,
      children: [createBlockWriteFromInsertCommand(newBlockId, command)],
    });
    if (command.kind === "block" && command.blockType === "table") {
    await appendAndApply({
        parent: { type: "block_id", block_id: newBlockId },
        after: null,
        children: Array.from({ length: DEFAULT_TABLE_ROW_COUNT }, () => ({
          id: crypto.randomUUID(),
          type: "table_row" as const,
          table_row: createEmptyTableRowPayload(DEFAULT_TABLE_WIDTH),
        })),
      });
      const focusBlockId = planNotesInsertedBlockFocus([newBlockId], blockId);
      context.requestBlockFocus(focusBlockId, START_OF_BLOCK_SELECTION);
      recordUndoAfter("create", before, focusBlockId);
      return;
    }
    if (command.kind === "block" && command.blockType === "column_list") {
      const leftColumnId = crypto.randomUUID();
      const rightColumnId = crypto.randomUUID();
      const leftBlockId = crypto.randomUUID();
      const rightBlockId = crypto.randomUUID();
    await appendAndApply({
        parent: { type: "block_id", block_id: newBlockId },
        after: null,
        children: [
          {
            id: leftColumnId,
            type: "column",
            column: createColumnPayload(0.5),
          },
          {
            id: rightColumnId,
            type: "column",
            column: createColumnPayload(0.5),
          },
        ],
      });
    await appendAndApply({
        parent: { type: "block_id", block_id: leftColumnId },
        after: null,
        children: [createBlockWrite(leftBlockId, "paragraph")],
      });
    await appendAndApply({
        parent: { type: "block_id", block_id: rightColumnId },
        after: null,
        children: [createBlockWrite(rightBlockId, "paragraph")],
      });
      const focusBlockId = planNotesInsertedBlockFocus([leftBlockId], newBlockId);
      context.requestBlockFocus(focusBlockId, START_OF_BLOCK_SELECTION);
      recordUndoAfter("create", before, focusBlockId);
      return;
    }
    if (command.kind === "block" && command.blockType === "tab") {
      const firstLabelId = crypto.randomUUID();
      const secondLabelId = crypto.randomUUID();
      const firstContentId = crypto.randomUUID();
      const secondContentId = crypto.randomUUID();
    await appendAndApply({
        parent: { type: "block_id", block_id: newBlockId },
        after: null,
        children: [
          createBlockWrite(firstLabelId, "paragraph", "Tab 1"),
          createBlockWrite(secondLabelId, "paragraph", "Tab 2"),
        ],
      });
    await appendAndApply({
        parent: { type: "block_id", block_id: firstLabelId },
        after: null,
        children: [createBlockWrite(firstContentId, "paragraph")],
      });
    await appendAndApply({
        parent: { type: "block_id", block_id: secondLabelId },
        after: null,
        children: [createBlockWrite(secondContentId, "paragraph")],
      });
      const focusBlockId = planNotesInsertedBlockFocus([firstContentId], newBlockId);
      context.requestBlockFocus(focusBlockId, START_OF_BLOCK_SELECTION);
      recordUndoAfter("create", before, focusBlockId);
      return;
    }
    const focusBlockId = planNotesInsertedBlockFocus([newBlockId], blockId) ?? newBlockId;
    context.requestBlockFocus(focusBlockId, START_OF_BLOCK_SELECTION);
    recordUndoAfter("create", before, focusBlockId);
  }

  async function createDatabaseAfterBlock(blockId: string): Promise<void> {
    const block = context.blockById(blockId);
    const selectedPageId = context.readSelectedPageId();
    if (!block || !selectedPageId) return;
    await context.flushBlockSave(blockId);
    const currentBlock = context.blockById(blockId) ?? block;
    const before = undoSnapshot(blockId);
    const created = await createNotesDatabase({
      id: crypto.randomUUID(),
      data_source_id: crypto.randomUUID(),
      view_id: crypto.randomUUID(),
      title: DEFAULT_DATABASE_TITLE,
      parent: currentBlock.parent,
      after_block_id: blockId,
    });
    context.applyPostMutation({
      blocks: [created.block],
      placements: [{
        blockId: created.block.id,
        parent: currentBlock.parent,
        after: blockId,
      }],
    });
    context.requestBlockFocus(created.block.id);
    recordUndoAfter("create", before, created.block.id);
  }

  async function createLinkedDatabaseViewAfter(blockId: string): Promise<void> {
    const block = context.blockById(blockId);
    const selectedPageId = context.readSelectedPageId();
    if (!block || block.type !== "child_database" || !selectedPageId) return;
    await context.flushBlockSave(blockId);
    const currentBlock = context.blockById(blockId) ?? block;
    if (currentBlock.type !== "child_database") return;
    const before = undoSnapshot(blockId);
    const created = await createNotesLinkedDatabaseView(
      createNotesLinkedDatabaseViewRequest(
        currentBlock,
        {
          databaseId: crypto.randomUUID(),
          viewId: crypto.randomUUID(),
        },
        currentBlock.child_database.title || DEFAULT_DATABASE_TITLE,
      ),
    );
    context.applyPostMutation({
      blocks: [created.block],
      placements: [{
        blockId: created.block.id,
        parent: currentBlock.parent,
        after: blockId,
      }],
    });
    context.requestBlockFocus(created.block.id);
    recordUndoAfter("create", before, created.block.id);
  }


  return {
    convertBlock,
    toggleTodo,
    updateCodeLanguage,
    updateBlockColor,
    updateToggleOpen,
    convertBlockToToggleHeading,
    createSiblingAfter,
    createLinkedDatabaseViewAfter,
    convertUnsupportedBlock,
  };
}
