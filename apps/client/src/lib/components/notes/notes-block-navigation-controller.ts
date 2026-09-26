import { blockPlainText, isTextEditableBlock } from "$lib/notes/block-factory";
import {
  notesAdjacentRenderedBlockId,
  notesBoundaryRenderedBlockId,
  notesCollapsedNavigationSelection,
  type NotesBlockNavigationBoundary,
  type NotesBlockNavigationDirection,
} from "$lib/notes/block-navigation";
import {
  notesEditableOffsetFromDomPoint,
  notesPlainTextFromEditableRoot,
  notesTextSelectionFromEditableRoot,
  restoreNotesEditableSelection,
  type NotesTextSelection,
} from "$lib/notes/editor-selection";
import type { NotesBlock } from "$lib/notes/types";

interface NotesEditableVisualLine {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface DocumentWithCaretPositionFromPoint {
  caretPositionFromPoint?: (
    x: number,
    y: number,
    options?: CaretPositionFromPointOptions,
  ) => CaretPosition | null;
}

interface DocumentWithCaretRangeFromPoint {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

export interface NotesBlockNavigationOptions {
  readListElement: () => HTMLDivElement | null;
  readRenderedBlockIds: () => readonly string[];
  readBlock: (blockId: string) => NotesBlock | undefined;
  requestFocus: (blockId: string, selection: NotesTextSelection | null) => void;
}

/** Coordinate DOM-aware keyboard navigation and focus across rendered Notes blocks. */
export function createNotesBlockNavigationController(options: NotesBlockNavigationOptions) {
  function rowFromEvent(event: Event): HTMLElement | null {
    const target = event.target;
    const list = options.readListElement();
    if (!(target instanceof Element) || !list) return null;
    const row = target.closest<HTMLElement>("[data-notes-selectable-block-id]");
    return row && list.contains(row) ? row : null;
  }

  function blockIdFromEvent(event: Event): string | null {
    return rowFromEvent(event)?.dataset.notesSelectableBlockId ?? null;
  }

  function rowForBlock(blockId: string): HTMLElement | null {
    const list = options.readListElement();
    if (!list) return null;
    return Array.from(list.querySelectorAll<HTMLElement>("[data-notes-selectable-block-id]"))
      .find((element) => element.dataset.notesSelectableBlockId === blockId) ?? null;
  }

  function textEditorForBlock(blockId: string): HTMLElement | null {
    return Array.from(
      rowForBlock(blockId)?.querySelectorAll<HTMLElement>(
        "[contenteditable='true'][role='textbox'][data-notes-block-id]",
      ) ?? [],
    ).find((editor) => editor.dataset.notesBlockId === blockId) ?? null;
  }

  function focusTextEditorAtEnd(blockId: string): boolean {
    const block = options.readBlock(blockId);
    if (!block || !isTextEditableBlock(block.type)) return false;
    const editor = textEditorForBlock(blockId);
    if (!editor) return false;
    editor.focus({ preventScroll: true });
    const textLength = notesPlainTextFromEditableRoot(editor).length;
    restoreNotesEditableSelection(editor, { start: textLength, end: textLength });
    return true;
  }

  function focusRow(blockId: string, preventScroll = true): void {
    queueMicrotask(() => rowForBlock(blockId)?.focus({ preventScroll }));
  }

  function editorFromEvent(event: Event, blockId: string): HTMLElement | null {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const editor = target.closest<HTMLElement>(
      "[contenteditable='true'][role='textbox'][data-notes-block-id]",
    );
    return editor?.dataset.notesBlockId === blockId ? editor : null;
  }

  function editableVisualLines(editor: HTMLElement): NotesEditableVisualLine[] {
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    const lines: NotesEditableVisualLine[] = [];
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 && rect.height <= 0) continue;
      const existing = lines.find((line) => Math.abs(line.top - rect.top) < 2);
      if (existing) {
        existing.top = Math.min(existing.top, rect.top);
        existing.right = Math.max(existing.right, rect.right);
        existing.bottom = Math.max(existing.bottom, rect.bottom);
        existing.left = Math.min(existing.left, rect.left);
      } else {
        lines.push({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left });
      }
    }
    return lines.sort((left, right) => left.top - right.top);
  }

  function collapsedSelectionRect(editor: HTMLElement): DOMRect | null {
    const selection = editor.ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
    if (!selection.focusNode || !editor.contains(selection.focusNode)) return null;
    const range = selection.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
    return Array.from(range.getClientRects())
      .find((candidate) => candidate.width > 0 || candidate.height > 0) ?? null;
  }

  function caretIsOnBoundaryLine(editor: HTMLElement, direction: NotesBlockNavigationDirection): boolean {
    const selection = notesTextSelectionFromEditableRoot(editor);
    const textLength = notesPlainTextFromEditableRoot(editor).length;
    if (selection && selection.start === selection.end) {
      if (direction === "previous" && selection.start === 0) return true;
      if (direction === "next" && selection.start === textLength) return true;
    }
    const lineTops = editableVisualLines(editor).map((line) => line.top);
    if (lineTops.length <= 1) return true;
    const caretRect = collapsedSelectionRect(editor);
    if (!caretRect) return false;
    const boundaryTop = direction === "previous" ? lineTops[0] : lineTops.at(-1);
    return boundaryTop !== undefined && Math.abs(caretRect.top - boundaryTop) < 2;
  }

  function caretOffsetFromPoint(editor: HTMLElement, x: number, y: number): number | null {
    const caretDocument = editor.ownerDocument as DocumentWithCaretPositionFromPoint;
    const position = caretDocument.caretPositionFromPoint?.(x, y) ?? null;
    if (position && editor.contains(position.offsetNode)) {
      return notesEditableOffsetFromDomPoint(editor, position.offsetNode, position.offset);
    }
    const rangeDocument = editor.ownerDocument as DocumentWithCaretRangeFromPoint;
    const range = rangeDocument.caretRangeFromPoint?.(x, y) ?? null;
    if (!range || !editor.contains(range.startContainer)) return null;
    return notesEditableOffsetFromDomPoint(editor, range.startContainer, range.startOffset);
  }

  function targetLineOffset(editor: HTMLElement, direction: NotesBlockNavigationDirection, x: number): number | null {
    const lines = editableVisualLines(editor);
    const line = direction === "previous" ? lines.at(-1) : lines[0];
    if (!line) return null;
    const rect = editor.getBoundingClientRect();
    const left = rect.left + 1;
    const right = rect.right - 1;
    const safeX = right <= left ? rect.left : Math.min(Math.max(x, left), right);
    return caretOffsetFromPoint(editor, safeX, line.top + Math.max(1, (line.bottom - line.top) / 2));
  }

  function clampedSelection(blockId: string, selection: NotesTextSelection | null): NotesTextSelection | null {
    const block = options.readBlock(blockId);
    if (!block || !isTextEditableBlock(block.type) || !selection) return null;
    const length = blockPlainText(block).length;
    const start = Math.min(Math.max(0, selection.start), length);
    const end = Math.min(Math.max(0, selection.end), length);
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  function selectionAt(blockId: string, offset: number): NotesTextSelection | null {
    return clampedSelection(blockId, notesCollapsedNavigationSelection(offset));
  }

  function focusAdjacent(currentId: string, direction: NotesBlockNavigationDirection, x: number | null): boolean {
    const targetId = notesAdjacentRenderedBlockId(options.readRenderedBlockIds(), currentId, direction);
    if (!targetId) return false;
    const block = options.readBlock(targetId);
    const fallback = direction === "next" ? 0 : block && isTextEditableBlock(block.type) ? blockPlainText(block).length : 0;
    const editor = x === null ? null : textEditorForBlock(targetId);
    const offset = editor && x !== null ? targetLineOffset(editor, direction, x) : null;
    options.requestFocus(targetId, selectionAt(targetId, offset ?? fallback));
    return true;
  }

  function focusBoundary(boundary: NotesBlockNavigationBoundary): boolean {
    const targetId = notesBoundaryRenderedBlockId(options.readRenderedBlockIds(), boundary);
    if (!targetId) return false;
    const block = options.readBlock(targetId);
    const offset = boundary === "first" ? 0 : block && isTextEditableBlock(block.type) ? blockPlainText(block).length : 0;
    options.requestFocus(targetId, selectionAt(targetId, offset));
    return true;
  }

  function handleKeydown(event: KeyboardEvent, blockId: string): boolean {
    if (event.altKey || event.shiftKey) return false;
    if (event.ctrlKey || event.metaKey) {
      if (event.key === "Home" || (event.metaKey && event.key === "ArrowUp")) {
        event.preventDefault();
        return focusBoundary("first");
      }
      if (event.key === "End" || (event.metaKey && event.key === "ArrowDown")) {
        event.preventDefault();
        return focusBoundary("last");
      }
      return false;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
    const direction: NotesBlockNavigationDirection = event.key === "ArrowUp" ? "previous" : "next";
    const editor = editorFromEvent(event, blockId);
    if (editor) {
      const selection = notesTextSelectionFromEditableRoot(editor);
      if (!selection || selection.start !== selection.end || !caretIsOnBoundaryLine(editor, direction)) return false;
      if (!focusAdjacent(blockId, direction, collapsedSelectionRect(editor)?.left ?? null)) return false;
      event.preventDefault();
      return true;
    }
    if (targetIsEditable(event.target) || !focusAdjacent(blockId, direction, null)) return false;
    event.preventDefault();
    return true;
  }

  function targetIsEditable(target: EventTarget | null): boolean {
    return target instanceof Element
      && target.closest("input, textarea, select, button, a, [contenteditable='true'], [role='textbox']") !== null;
  }

  /** Only an explicit zone in the target row can begin whole-block selection. */
  function targetIsSelectionZone(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    const zone = target.closest("[data-notes-block-selection-zone]");
    const row = target.closest("[data-notes-selectable-block-id]");
    return !!zone && !!row && zone.closest("[data-notes-selectable-block-id]") === row;
  }

  return {
    rowFromEvent,
    blockIdFromEvent,
    rowForBlock,
    textEditorForBlock,
    focusTextEditorAtEnd,
    focusRow,
    handleKeydown,
    targetIsEditable,
    targetIsSelectionZone,
  };
}
