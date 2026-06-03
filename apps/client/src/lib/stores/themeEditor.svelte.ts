import type { ThemeId } from "./themes";
import { getTheme } from "./theme.svelte";

// One active editor session at a time. Edits during the session live in
// the theme store's in-memory `$state` only; SQLite is not touched until
// `commit` calls `persistThemeToDb`. The snapshot (when present) is the
// serialized theme at session open and lets `cancel` roll back the
// in-memory edits without ever writing to disk. For themes minted for
// this session (`createdFresh` = true), cancel discards the in-memory
// row entirely so backing out leaves no orphan behind.
interface EditorSession {
  editingId: ThemeId;
  snapshot: string | undefined;
  createdFresh: boolean;
  previousActiveId: ThemeId;
}

let session = $state<EditorSession | undefined>(undefined);

export interface OpenEditorOptions {
  snapshot?: string;
  createdFresh?: boolean;
  previousActiveId: ThemeId;
}

export function getThemeEditor() {
  return {
    get editingId(): ThemeId | undefined {
      return session?.editingId;
    },
    get isActive(): boolean {
      return session !== undefined;
    },
    open(id: ThemeId, opts: OpenEditorOptions): void {
      session = {
        editingId: id,
        snapshot: opts.snapshot,
        createdFresh: opts.createdFresh ?? false,
        previousActiveId: opts.previousActiveId,
      };
    },
    // Commit the session: flush the in-memory edits to SQLite and clear
    // state. The edited theme stays active.
    async commit(): Promise<void> {
      if (!session) return;
      const { editingId } = session;
      session = undefined;
      await getTheme().persistThemeToDb(editingId);
    },
    // Roll the session back. Built-in previews pass no snapshot so there
    // is nothing to restore. Fresh themes are dropped from memory and the
    // previous active theme is reinstated. Existing themes get their
    // pre-edit JSON snapshot replayed in memory only.
    async cancel(): Promise<void> {
      if (!session) return;
      const themeStore = getTheme();
      const { editingId, snapshot, createdFresh, previousActiveId } = session;
      session = undefined;
      if (createdFresh) {
        if (themeStore.id === editingId) themeStore.setTheme(previousActiveId);
        themeStore.discardFreshTheme(editingId);
      } else {
        if (snapshot !== undefined) {
          themeStore.restoreThemeFromSnapshot(editingId, snapshot);
        }
        if (themeStore.id !== previousActiveId) {
          themeStore.setTheme(previousActiveId);
        }
      }
    },
    // Used by the settings modal effect to force-close without touching the
    // theme store. Reserved for the rare case where the caller already knows
    // the session is defunct (e.g. the theme was deleted elsewhere).
    forgetSession(): void {
      session = undefined;
    },
  };
}
