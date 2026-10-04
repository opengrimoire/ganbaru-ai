import { invoke } from "@tauri-apps/api/core";
import { ensureDbUrl } from "$lib/api/db";
import { invalidateNotesNotificationSchedule } from "$lib/notes/notification-schedule.svelte";
import {
  mapNotesCommentThreadDto,
  mapNotesLocalUserDto,
  mapNotesMentionNotificationDto,
  mapNotesSuggestionDto,
} from "$lib/notes/notion-mappers";
import type {
  NotesCommentCreate,
  NotesCommentThread,
  NotesCommentThreadReadUpdate,
  NotesCommentUpdate,
  NotesLocalUser,
  NotesLocalUserUpdate,
  NotesMentionNotification,
  NotesMentionNotificationDeliveryUpdate,
  NotesSuggestion,
  NotesSuggestionCreate,
} from "$lib/notes/types";
import { invokeNotesMutation } from "./mutation";

export async function getNotesLocalUser(): Promise<NotesLocalUser> {
  const dbUrl = await ensureDbUrl();
  return mapNotesLocalUserDto(await invoke<unknown>("notes_get_local_user", { dbUrl }));
}

export async function updateNotesLocalUser(
  update: NotesLocalUserUpdate,
): Promise<NotesLocalUser> {
  const dbUrl = await ensureDbUrl();
  return mapNotesLocalUserDto(
    await invoke<unknown>("notes_update_local_user", { dbUrl, update }),
  );
}

export async function listPendingNotesMentionNotifications():
  Promise<NotesMentionNotification[]> {
  const dbUrl = await ensureDbUrl();
  const rows = await invoke<unknown>("notes_list_pending_mention_notifications", { dbUrl });
  if (!Array.isArray(rows)) {
    throw new Error("notes_list_pending_mention_notifications returned a non-array payload");
  }
  return rows.map(mapNotesMentionNotificationDto);
}

export async function markNotesMentionNotificationsDelivered(
  request: NotesMentionNotificationDeliveryUpdate,
): Promise<NotesMentionNotification[]> {
  const dbUrl = await ensureDbUrl();
  const rows = await invoke<unknown>("notes_mark_mention_notifications_delivered", {
    dbUrl,
    request,
  });
  if (!Array.isArray(rows)) {
    throw new Error("notes_mark_mention_notifications_delivered returned a non-array payload");
  }
  return rows.map(mapNotesMentionNotificationDto);
}

export async function listNotesComments(
  pageId: string,
  includeResolved = false,
  blockIds?: readonly string[],
): Promise<NotesCommentThread[]> {
  const dbUrl = await ensureDbUrl();
  const rows = await invoke<unknown>("notes_list_comments", {
    dbUrl,
    pageId,
    includeResolved,
    blockIds: blockIds ? [...blockIds] : null,
  });
  if (!Array.isArray(rows)) throw new Error("notes_list_comments returned a non-array payload");
  return rows.map(mapNotesCommentThreadDto);
}

export async function markNotesCommentThreadsRead(
  request: NotesCommentThreadReadUpdate,
): Promise<NotesCommentThread[]> {
  const dbUrl = await ensureDbUrl();
  const rows = await invoke<unknown>("notes_mark_comment_threads_read", { dbUrl, request });
  if (!Array.isArray(rows)) {
    throw new Error("notes_mark_comment_threads_read returned a non-array payload");
  }
  return rows.map(mapNotesCommentThreadDto);
}

export async function createNotesComment(
  request: NotesCommentCreate,
): Promise<NotesCommentThread> {
  const dbUrl = await ensureDbUrl();
  const thread = mapNotesCommentThreadDto(
    await invokeNotesMutation("notes_create_comment", { dbUrl, request }),
  );
  invalidateNotesNotificationSchedule();
  return thread;
}

export async function updateNotesComment(
  commentId: string,
  update: NotesCommentUpdate,
): Promise<NotesCommentThread> {
  const dbUrl = await ensureDbUrl();
  const thread = mapNotesCommentThreadDto(
    await invokeNotesMutation("notes_update_comment", { dbUrl, commentId, update }),
  );
  invalidateNotesNotificationSchedule();
  return thread;
}

export async function deleteNotesComment(commentId: string): Promise<NotesCommentThread> {
  const dbUrl = await ensureDbUrl();
  const thread = mapNotesCommentThreadDto(
    await invokeNotesMutation("notes_delete_comment", { dbUrl, commentId }),
  );
  invalidateNotesNotificationSchedule();
  return thread;
}

export async function resolveNotesCommentThread(
  discussionId: string,
  resolved = true,
): Promise<NotesCommentThread> {
  const dbUrl = await ensureDbUrl();
  const thread = mapNotesCommentThreadDto(
    await invokeNotesMutation("notes_resolve_comment_thread", { dbUrl, discussionId, resolved }),
  );
  invalidateNotesNotificationSchedule();
  return thread;
}

export async function listNotesSuggestions(
  pageId: string,
  includeDecided = false,
): Promise<NotesSuggestion[]> {
  const dbUrl = await ensureDbUrl();
  const rows = await invoke<unknown>("notes_list_suggestions", { dbUrl, pageId, includeDecided });
  if (!Array.isArray(rows)) throw new Error("notes_list_suggestions returned a non-array payload");
  return rows.map(mapNotesSuggestionDto);
}

export async function createNotesSuggestion(
  request: NotesSuggestionCreate,
): Promise<NotesSuggestion> {
  const dbUrl = await ensureDbUrl();
  return mapNotesSuggestionDto(
    await invokeNotesMutation("notes_create_suggestion", { dbUrl, request }),
  );
}

export async function acceptNotesSuggestion(suggestionId: string): Promise<NotesSuggestion> {
  const dbUrl = await ensureDbUrl();
  return mapNotesSuggestionDto(
    await invokeNotesMutation("notes_accept_suggestion", { dbUrl, suggestionId }),
  );
}

export async function rejectNotesSuggestion(suggestionId: string): Promise<NotesSuggestion> {
  const dbUrl = await ensureDbUrl();
  return mapNotesSuggestionDto(
    await invokeNotesMutation("notes_reject_suggestion", { dbUrl, suggestionId }),
  );
}
