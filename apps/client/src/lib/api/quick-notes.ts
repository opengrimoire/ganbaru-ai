import { invoke } from "@tauri-apps/api/core";
import { ensureDbUrl } from "$lib/api/db";
import { normalizeEventColor } from "$lib/components/calendar/utils";
import type {
  QuickNote,
  QuickNoteCreate,
  QuickNoteRevisionRequest,
  QuickNoteReorderRequest,
  QuickNotesCollection,
  QuickNotesWindow,
  QuickNoteTextRun,
  QuickNoteTag,
  QuickNoteUpdate,
} from "$lib/quick-notes/types";
import {
  QUICK_NOTE_TAG_LIMIT,
  QUICK_NOTE_TAG_NAME_MAX_CHARS,
} from "$lib/quick-notes/types";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value;
}

function mapRun(value: unknown, label: string): QuickNoteTextRun {
  const row = record(value, label);
  return {
    content: string(row.content, `${label}.content`),
    bold: boolean(row.bold, `${label}.bold`),
    italic: boolean(row.italic, `${label}.italic`),
    underline: boolean(row.underline, `${label}.underline`),
  };
}

export function mapQuickNote(value: unknown): QuickNote {
  const row = record(value, "quick note");
  if (!Array.isArray(row.runs)) throw new Error("quick note.runs must be an array");
  const color = normalizeEventColor(row.color);
  if (color === undefined) throw new Error("quick note.color is invalid");
  return {
    id: string(row.id, "quick note.id"),
    title: string(row.title, "quick note.title"),
    bodyPlainText: string(row.bodyPlainText, "quick note.bodyPlainText"),
    runs: row.runs.map((run, index) => mapRun(run, `quick note.runs[${index}]`)),
    previewTruncated: boolean(row.previewTruncated, "quick note.previewTruncated"),
    color,
    tagId: nullableString(row.tagId, "quick note.tagId"),
    pinned: boolean(row.pinned, "quick note.pinned"),
    archived: boolean(row.archived, "quick note.archived"),
    trashedAt: nullableString(row.trashedAt, "quick note.trashedAt"),
    revision: integer(row.revision, "quick note.revision"),
    createdAt: string(row.createdAt, "quick note.createdAt"),
    updatedAt: string(row.updatedAt, "quick note.updatedAt"),
  };
}

export async function listQuickNotes(
  collection: QuickNotesCollection,
  query: string,
  tagId: string | null = null,
  cursor: string | null = null,
): Promise<QuickNotesWindow> {
  const value = await invoke<unknown>("quick_notes_list", {
    dbUrl: await ensureDbUrl(),
    request: { collection, query: query || null, tagId, cursor, pageSize: 60 },
  });
  const result = record(value, "quick notes window");
  if (!Array.isArray(result.notes)) throw new Error("quick notes window.notes must be an array");
  return {
    notes: result.notes.map(mapQuickNote),
    nextCursor: nullableString(result.nextCursor, "quick notes window.nextCursor"),
  };
}

/** A native note write failure with a stable recovery code. */
export class QuickNoteWriteError extends Error {
  constructor(readonly code: "revision_conflict" | "failed", message: string) {
    super(message);
    this.name = "QuickNoteWriteError";
  }
}

async function invokeNote(command: string, args: Record<string, unknown>): Promise<QuickNote> {
  try {
    return mapQuickNote(await invoke<unknown>(command, { dbUrl: await ensureDbUrl(), ...args }));
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && "message" in error
      && (error.code === "revision_conflict" || error.code === "failed") && typeof error.message === "string") {
      throw new QuickNoteWriteError(error.code, error.message);
    }
    throw error;
  }
}

export function getQuickNote(id: string): Promise<QuickNote> {
  return invokeNote("quick_notes_get", { id });
}

export function createQuickNote(note: QuickNoteCreate): Promise<QuickNote> {
  return invokeNote("quick_notes_create", { note });
}

export function updateQuickNote(note: QuickNoteUpdate): Promise<QuickNote> {
  return invokeNote("quick_notes_update", { note });
}

export function setQuickNotePinned(request: QuickNoteRevisionRequest, pinned: boolean): Promise<QuickNote> {
  return invokeNote("quick_notes_set_pinned", { request: { ...request, pinned } });
}

export async function reorderQuickNote(request: QuickNoteReorderRequest): Promise<void> {
  await invoke("quick_notes_reorder", { dbUrl: await ensureDbUrl(), request });
}

export function archiveQuickNote(request: QuickNoteRevisionRequest): Promise<QuickNote> {
  return invokeNote("quick_notes_archive", { request });
}

export function unarchiveQuickNote(request: QuickNoteRevisionRequest): Promise<QuickNote> {
  return invokeNote("quick_notes_unarchive", { request });
}

export function trashQuickNote(request: QuickNoteRevisionRequest): Promise<QuickNote> {
  return invokeNote("quick_notes_trash", { request });
}

export function restoreQuickNote(request: QuickNoteRevisionRequest): Promise<QuickNote> {
  return invokeNote("quick_notes_restore", { request });
}

export async function deleteQuickNotePermanently(id: string): Promise<void> {
  await invoke("quick_notes_delete_permanently", { dbUrl: await ensureDbUrl(), id });
}

export async function emptyQuickNotesTrash(): Promise<number> {
  return invoke<number>("quick_notes_empty_trash", { dbUrl: await ensureDbUrl() });
}

export function mapQuickNoteTag(value: unknown): QuickNoteTag {
  const row = record(value, "quick note tag");
  const id = string(row.id, "quick note tag.id");
  const name = string(row.name, "quick note tag.name");
  const sortOrder = integer(row.sortOrder, "quick note tag.sortOrder");
  if (id.length === 0 || id.length > 128) throw new Error("quick note tag.id is invalid");
  if (name !== name.trim() || name.length === 0 || [...name].length > QUICK_NOTE_TAG_NAME_MAX_CHARS) {
    throw new Error("quick note tag.name is invalid");
  }
  if (sortOrder < 0 || sortOrder >= QUICK_NOTE_TAG_LIMIT) {
    throw new Error("quick note tag.sortOrder is invalid");
  }
  return {
    id,
    name,
    sortOrder,
    createdAt: string(row.createdAt, "quick note tag.createdAt"),
    updatedAt: string(row.updatedAt, "quick note tag.updatedAt"),
  };
}

export async function listQuickNoteTags(): Promise<QuickNoteTag[]> {
  const value = await invoke<unknown>("quick_note_tags_list", { dbUrl: await ensureDbUrl() });
  if (!Array.isArray(value)) throw new Error("quick note tags must be an array");
  return value.map(mapQuickNoteTag);
}

export async function createQuickNoteTag(id: string, name: string): Promise<QuickNoteTag> {
  return mapQuickNoteTag(await invoke<unknown>("quick_note_tags_create", {
    dbUrl: await ensureDbUrl(),
    tag: { id, name },
  }));
}

export async function deleteQuickNoteTag(id: string): Promise<void> {
  await invoke("quick_note_tags_delete", { dbUrl: await ensureDbUrl(), id });
}
