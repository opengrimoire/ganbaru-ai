import {
  createWindowSyncEnvelope,
  isForeignWindowSyncEnvelope,
  isWindowSyncEnvelope,
} from "$lib/windows/sync";
import {
  emitWindowSync,
  listenWindowSync,
} from "$lib/windows/sync-transport";
import { invalidateQuickNotesInitialSnapshot } from "$lib/quick-notes/initial-snapshot";

const QUICK_NOTES_SYNC_EVENT = "quick-notes-window-sync";

interface QuickNotesSyncPayload {
  kind: "data-changed";
}

function isPayload(value: unknown): value is QuickNotesSyncPayload {
  return typeof value === "object" && value !== null
    && (value as Record<string, unknown>).kind === "data-changed";
}

export function publishQuickNotesChanged(): void {
  invalidateQuickNotesInitialSnapshot();
  void emitWindowSync(
    QUICK_NOTES_SYNC_EVENT,
    createWindowSyncEnvelope<QuickNotesSyncPayload>({ kind: "data-changed" }),
  ).catch((error: unknown) => console.warn("Quick notes window sync failed", error));
}

export function listenForQuickNotesChanges(onChange: () => void): Promise<() => void> {
  return listenWindowSync<unknown>(QUICK_NOTES_SYNC_EVENT, (event) => {
    const envelope = event.payload;
    if (!isWindowSyncEnvelope(envelope, isPayload) || !isForeignWindowSyncEnvelope(envelope)) return;
    invalidateQuickNotesInitialSnapshot();
    onChange();
  });
}
