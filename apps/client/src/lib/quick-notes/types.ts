import type { EventColor } from "$lib/components/calendar/types";

export const QUICK_NOTE_TITLE_MAX_CHARS = 200;
export const QUICK_NOTE_BODY_MAX_CHARS = 65_536;
export const QUICK_NOTE_TAG_LIMIT = 9;
export const QUICK_NOTE_TAG_NAME_MAX_CHARS = 40;

export interface QuickNoteTextRun {
  content: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface QuickNote {
  id: string;
  title: string;
  bodyPlainText: string;
  runs: QuickNoteTextRun[];
  previewTruncated: boolean;
  color: EventColor;
  tagId: string | null;
  pinned: boolean;
  archived: boolean;
  trashedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type QuickNotesCollection = "active" | "archive" | "trash";

export interface QuickNotesWindow {
  notes: QuickNote[];
  nextCursor: string | null;
}

export interface QuickNoteCreate {
  id: string;
  title: string;
  runs: QuickNoteTextRun[];
  color: EventColor;
  tagId: string | null;
  pinned: boolean;
}

export interface QuickNoteTag {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuickNoteUpdate extends QuickNoteCreate {
  expectedRevision: number;
}

export interface QuickNoteRevisionRequest {
  id: string;
  expectedRevision: number;
}

export interface QuickNoteReorderRequest {
  id: string;
  previousId: string | null;
  nextId: string | null;
  tagId: string | null;
}

export interface QuickNoteFormatting {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export type QuickNoteFormattingName = keyof QuickNoteFormatting;

export const EMPTY_QUICK_NOTE_FORMATTING: QuickNoteFormatting = Object.freeze({
  bold: false,
  italic: false,
  underline: false,
});
