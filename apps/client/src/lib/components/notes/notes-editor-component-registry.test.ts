import { describe, expect, it } from "vitest";
import { createLazyComponentLoader } from "$lib/lazy-component-loader";
import {
  loadNotesAdvancedBlock,
  loadNotesDatabaseView,
  loadNotesEditorPanel,
  loadNotesTextControl,
  notesAdvancedBlockHasLoaded,
  notesDatabaseViewHasLoaded,
  notesEditorPanelHasLoaded,
  notesTextControlHasLoaded,
  notesBlockRenderFamily,
  retryNotesAdvancedBlock,
  type NotesAdvancedBlockFamily,
  type NotesEditorPanelKind,
  type NotesTextControlKind,
} from "./notes-editor-component-registry";
import type { NotesDatabaseViewKind } from "$lib/notes/database-view-kind";
import { NOTES_BLOCK_TYPES } from "$lib/notes/types";

const BLOCK_FAMILIES = [
  "media",
  "child-database",
  "table",
  "card",
  "unsupported",
  "column-list",
  "tab",
] as const satisfies readonly NotesAdvancedBlockFamily[];

const DATABASE_VIEWS = [
  "table",
  "board",
  "gallery",
  "list",
  "calendar",
  "timeline",
] as const satisfies readonly NotesDatabaseViewKind[];

const EDITOR_PANELS = [
  "icon-picker",
  "backlinks",
  "page-links",
  "comments",
  "suggestions",
  "destination-picker",
  "page-cover",
  "cover-menu",
  "html-export",
  "agent-export",
  "database-csv-import",
  "database-csv-export",
  "page-history",
  "confirm-dialog",
] as const satisfies readonly NotesEditorPanelKind[];

const TEXT_CONTROLS = [
  "text-context-menu",
  "link-editor",
  "mention-menu",
  "slash-menu",
  "template-controls",
  "button-controls",
] as const satisfies readonly NotesTextControlKind[];

describe("Notes editor component registry", () => {
  it("has a loadable typed entry for every advanced block family", async () => {
    for (const kind of BLOCK_FAMILIES) {
      await expect(loadNotesAdvancedBlock(kind)).resolves.toMatchObject({ kind });
      expect(notesAdvancedBlockHasLoaded(kind)).toBe(true);
    }
  }, 15_000);

  it("registers every persisted block type in an eager or lazy render family", () => {
    const families = NOTES_BLOCK_TYPES.map((type) => notesBlockRenderFamily(type));
    expect(families).toHaveLength(NOTES_BLOCK_TYPES.length);
    expect(new Set(families)).toEqual(new Set(["eager", ...BLOCK_FAMILIES]));
  });

  it("has a separate loadable entry for every database view", async () => {
    for (const kind of DATABASE_VIEWS) {
      await expect(loadNotesDatabaseView(kind)).resolves.toMatchObject({ kind });
      expect(notesDatabaseViewHasLoaded(kind)).toBe(true);
    }
  });

  it("has a loadable entry for every trigger-owned panel and control", async () => {
    for (const kind of EDITOR_PANELS) {
      await expect(loadNotesEditorPanel(kind)).resolves.toMatchObject({ kind });
      expect(notesEditorPanelHasLoaded(kind)).toBe(true);
    }
    for (const kind of TEXT_CONTROLS) {
      await expect(loadNotesTextControl(kind)).resolves.toMatchObject({ kind });
      expect(notesTextControlHasLoaded(kind)).toBe(true);
    }
  });

  it("does not cache a rejected import and retries successfully", async () => {
    let attempts = 0;
    const loader = createLazyComponentLoader({
      media: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary chunk failure");
        return { default: "loaded" };
      },
    });

    await expect(loader.load("media")).rejects.toThrow("temporary chunk failure");
    await expect(loader.retry("media")).resolves.toBe("loaded");
    expect(attempts).toBe(2);
  });

  it("keeps retry entry points type-safe after a loaded block", async () => {
    await expect(retryNotesAdvancedBlock("media")).resolves.toMatchObject({ kind: "media" });
  });
});
