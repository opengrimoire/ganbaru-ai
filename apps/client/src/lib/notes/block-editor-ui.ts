import type { NotesBlockType } from "./types";

/**
 * Return the base classes used by editable Notes text blocks.
 */
export function notesTextareaClass(type: NotesBlockType): string {
  const base =
    "min-h-8 w-full resize-none overflow-hidden bg-transparent pr-1 py-1 outline-none placeholder:text-muted-foreground";
  if (type === "heading_1") return `${base} text-[1.875rem] font-semibold leading-[1.3]`;
  if (type === "heading_2") return `${base} text-[1.5rem] font-semibold leading-[1.3]`;
  if (type === "heading_3") return `${base} text-[1.25rem] font-semibold leading-[1.3]`;
  if (type === "heading_4") return `${base} text-[1.125rem] font-semibold leading-[1.3]`;
  if (type === "code") return `${base} rounded-md bg-muted/60 pl-1 font-mono text-[0.82rem] leading-relaxed`;
  if (type === "callout") return `${base} notes-editor-body-text leading-normal`;
  if (type === "quote") return `${base} border-l-2 border-border pl-3 notes-editor-body-text leading-normal italic`;
  return `${base} notes-editor-body-text leading-normal`;
}

/**
 * Return the classes used by editable rich text Notes blocks.
 */
export function notesRichTextEditorClass(type: NotesBlockType): string {
  return `${notesTextareaClass(type)} notes-rich-text-editor block cursor-text whitespace-pre-wrap break-words`;
}

/**
 * Return the preview classes used when saved rich text is visible outside editing.
 */
export function notesRichTextPreviewClass(type: NotesBlockType): string {
  return `${notesRichTextEditorClass(type)} text-left`;
}

/**
 * Return the visible marker shown before list-like Notes blocks.
 */
export function notesBlockMarker(type: NotesBlockType): string {
  if (type === "bulleted_list_item") return "•";
  if (type === "numbered_list_item") return "1.";
  if (type === "quote") return "";
  return "";
}
