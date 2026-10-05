import type { NotesTextSelection } from "$lib/notes/editor/selection";

export interface NotesControlledTextEditInput {
  inputType: string;
  data: string | null;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface NotesControlledTextEdit {
  text: string;
  selection: NotesTextSelection;
}

function clampSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): NotesTextSelection {
  const max = text.length;
  const start = Math.min(Math.max(0, selectionStart), max);
  const end = Math.min(Math.max(0, selectionEnd), max);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function previousTextOffset(text: string, offset: number): number {
  if (offset <= 0) return 0;
  const before = text.slice(0, offset);
  const previous = Array.from(before).at(-1);
  return Math.max(0, offset - (previous?.length ?? 1));
}

function nextTextOffset(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  const next = Array.from(text.slice(offset)).at(0);
  return Math.min(text.length, offset + (next?.length ?? 1));
}

function previousWordOffset(text: string, offset: number): number {
  const before = text.slice(0, offset);
  const withoutTrailingSpace = before.replace(/\s+$/u, "");
  const wordStart = withoutTrailingSpace.search(/[^\s]*$/u);
  return Math.max(0, wordStart);
}

function nextWordOffset(text: string, offset: number): number {
  const after = text.slice(offset);
  const leadingSpaceLength = after.match(/^\s*/u)?.[0].length ?? 0;
  const rest = after.slice(leadingSpaceLength);
  const wordLength = rest.match(/^[^\s]*/u)?.[0].length ?? 0;
  return Math.min(text.length, offset + leadingSpaceLength + wordLength);
}

function replaceRange(
  text: string,
  selection: NotesTextSelection,
  replacement: string,
): NotesControlledTextEdit {
  const nextText = `${text.slice(0, selection.start)}${replacement}${text.slice(selection.end)}`;
  const cursor = selection.start + replacement.length;
  return {
    text: nextText,
    selection: { start: cursor, end: cursor },
  };
}

function deleteRange(
  text: string,
  start: number,
  end: number,
): NotesControlledTextEdit {
  const selection = clampSelection(text, start, end);
  return replaceRange(text, selection, "");
}

/** Plan a browser beforeinput text edit without letting contenteditable mutate unmanaged DOM. */
export function planNotesControlledTextEdit(
  input: NotesControlledTextEditInput,
): NotesControlledTextEdit | null {
  const selection = clampSelection(input.text, input.selectionStart, input.selectionEnd);

  if (input.inputType === "insertText") {
    if (input.data === null) return null;
    return replaceRange(input.text, selection, input.data);
  }

  if (input.inputType === "insertLineBreak" || input.inputType === "insertParagraph") {
    return replaceRange(input.text, selection, "\n");
  }

  if (input.inputType === "deleteContentBackward") {
    if (selection.start !== selection.end) return deleteRange(input.text, selection.start, selection.end);
    return deleteRange(input.text, previousTextOffset(input.text, selection.start), selection.start);
  }

  if (input.inputType === "deleteContentForward") {
    if (selection.start !== selection.end) return deleteRange(input.text, selection.start, selection.end);
    return deleteRange(input.text, selection.start, nextTextOffset(input.text, selection.start));
  }

  if (input.inputType === "deleteWordBackward") {
    if (selection.start !== selection.end) return deleteRange(input.text, selection.start, selection.end);
    return deleteRange(input.text, previousWordOffset(input.text, selection.start), selection.start);
  }

  if (input.inputType === "deleteWordForward") {
    if (selection.start !== selection.end) return deleteRange(input.text, selection.start, selection.end);
    return deleteRange(input.text, selection.start, nextWordOffset(input.text, selection.start));
  }

  if (input.inputType === "deleteByCut" || input.inputType === "deleteContent") {
    if (selection.start === selection.end) return null;
    return deleteRange(input.text, selection.start, selection.end);
  }

  return null;
}
