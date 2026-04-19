import type { ThemeId } from "./themes";
import { getTheme } from "./theme.svelte";

// One active editor session at a time. The snapshot (when present) is the
// serialized form of the theme at session open, replayed through
// `replaceTheme` on cancel to roll back any per-edit mutations the editor
// wrote to the store along the way. For themes that were minted for this
// session (`createdFresh` = true), cancel deletes the theme entirely so
// clicking Back on a half-made theme leaves no orphan behind.
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
    // Commit the session: every edit was already persisted live, so this is
    // just a state clear. The edited theme stays as the active theme.
    commit(): void {
      session = undefined;
    },
    // Roll the session back. Built-in previews pass no snapshot so there is
    // nothing to replace; user themes get their pre-edit JSON re-applied.
    // Fresh themes are deleted outright, with the previous active theme
    // reinstated first so the delete path does not fall back to the default.
    cancel(): void {
      if (!session) return;
      const themeStore = getTheme();
      const { editingId, snapshot, createdFresh, previousActiveId } = session;
      if (createdFresh) {
        if (themeStore.id === editingId) themeStore.setTheme(previousActiveId);
        themeStore.deleteTheme(editingId);
      } else {
        if (snapshot !== undefined) {
          themeStore.replaceTheme(editingId, snapshot);
        }
        if (themeStore.id !== previousActiveId) {
          themeStore.setTheme(previousActiveId);
        }
      }
      session = undefined;
    },
    // Used by the settings modal effect to force-close without touching the
    // theme store. Reserved for the rare case where the caller already knows
    // the session is defunct (e.g. the theme was deleted elsewhere).
    forgetSession(): void {
      session = undefined;
    },
  };
}
