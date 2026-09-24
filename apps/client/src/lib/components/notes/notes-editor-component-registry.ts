import {
  createLazyComponentLoader,
  type LazyComponentImporter,
} from "$lib/lazy-component-loader";
import type { NotesDatabaseViewKind } from "$lib/notes/database-view-kind";
import type { NotesBlockType } from "$lib/notes/types";
import {
  importNotesAgentBridgeExportDialog,
  importNotesDatabaseCsvExportPanel,
  importNotesHtmlExportDialog,
} from "$lib/components/notes/notes-editor-platform-importers";

export type LoadedNotesDatabaseView =
  | { kind: "table"; component: typeof import("./NotesDatabaseTableView.svelte").default }
  | { kind: "board"; component: typeof import("./NotesDatabaseBoardView.svelte").default }
  | { kind: "gallery"; component: typeof import("./NotesDatabaseGalleryView.svelte").default }
  | { kind: "list"; component: typeof import("./NotesDatabaseListView.svelte").default }
  | { kind: "calendar"; component: typeof import("./NotesDatabaseCalendarView.svelte").default }
  | { kind: "timeline"; component: typeof import("./NotesDatabaseTimelineView.svelte").default };

export type NotesAdvancedBlockFamily =
  | "media"
  | "child-database"
  | "table"
  | "card"
  | "unsupported"
  | "column-list"
  | "tab";
export type NotesBlockRenderFamily = "eager" | NotesAdvancedBlockFamily;

/** Maps every persisted block type to its eager or lazy renderer family. */
export function notesBlockRenderFamily(type: NotesBlockType): NotesBlockRenderFamily {
  switch (type) {
    case "child_database":
      return "child-database";
    case "table":
      return "table";
    case "image":
    case "video":
    case "audio":
    case "file":
    case "pdf":
      return "media";
    case "bookmark":
    case "link_preview":
    case "embed":
    case "equation":
      return "card";
    case "unsupported":
      return "unsupported";
    case "column_list":
      return "column-list";
    case "tab":
      return "tab";
    case "paragraph":
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "heading_4":
    case "bulleted_list_item":
    case "numbered_list_item":
    case "to_do":
    case "toggle":
    case "callout":
    case "quote":
    case "child_page":
    case "breadcrumb":
    case "table_of_contents":
    case "column":
    case "table_row":
    case "synced_block":
    case "template":
    case "button":
    case "divider":
    case "code":
      return "eager";
  }
}

export type LoadedNotesAdvancedBlock =
  | { kind: "media"; component: typeof import("./NotesMediaBlock.svelte").default }
  | { kind: "child-database"; component: typeof import("./NotesChildDatabaseBlock.svelte").default }
  | { kind: "table"; component: typeof import("./NotesTableBlock.svelte").default }
  | { kind: "card"; component: typeof import("./NotesCardBlock.svelte").default }
  | { kind: "unsupported"; component: typeof import("./NotesUnsupportedBlock.svelte").default }
  | { kind: "column-list"; component: typeof import("./NotesColumnListBlock.svelte").default }
  | { kind: "tab"; component: typeof import("./NotesTabBlock.svelte").default };

export type NotesEditorPanelKind =
  | "icon-picker"
  | "backlinks"
  | "page-links"
  | "comments"
  | "suggestions"
  | "destination-picker"
  | "page-cover"
  | "cover-menu"
  | "html-export"
  | "agent-export"
  | "database-csv-import"
  | "database-csv-export"
  | "page-history"
  | "confirm-dialog";

export type LoadedNotesEditorPanel =
  | { kind: "icon-picker"; component: typeof import("$lib/components/icon-picker/IconPicker.svelte").default }
  | { kind: "backlinks"; component: typeof import("./NotesBacklinks.svelte").default }
  | { kind: "page-links"; component: typeof import("./NotesPageLinks.svelte").default }
  | { kind: "comments"; component: typeof import("./NotesComments.svelte").default }
  | { kind: "suggestions"; component: typeof import("./NotesSuggestions.svelte").default }
  | { kind: "destination-picker"; component: typeof import("./NotesDestinationPickerList.svelte").default }
  | { kind: "page-cover"; component: typeof import("./NotesPageCover.svelte").default }
  | { kind: "cover-menu"; component: typeof import("./NotesPageCoverMenu.svelte").default }
  | { kind: "html-export"; component: typeof import("./NotesHtmlExportDialog.svelte").default }
  | { kind: "agent-export"; component: typeof import("./NotesAgentBridgeExportDialog.svelte").default }
  | { kind: "database-csv-import"; component: typeof import("./NotesDatabaseCsvImportPanel.svelte").default }
  | { kind: "database-csv-export"; component: typeof import("./NotesDatabaseCsvExportPanel.svelte").default }
  | { kind: "page-history"; component: typeof import("./NotesPageVersionHistoryModal.svelte").default }
  | { kind: "confirm-dialog"; component: typeof import("$lib/components/ui/ConfirmDialog.svelte").default };

export type NotesTextControlKind =
  | "text-context-menu"
  | "link-editor"
  | "mention-menu"
  | "slash-menu"
  | "template-controls"
  | "button-controls";

export type LoadedNotesTextControl =
  | { kind: "text-context-menu"; component: typeof import("./NotesTextContextMenu.svelte").default }
  | { kind: "link-editor"; component: typeof import("./NotesLinkEditor.svelte").default }
  | { kind: "mention-menu"; component: typeof import("./NotesMentionMenu.svelte").default }
  | { kind: "slash-menu"; component: typeof import("./NotesSlashMenu.svelte").default }
  | { kind: "template-controls"; component: typeof import("./NotesTemplateBlockControls.svelte").default }
  | { kind: "button-controls"; component: typeof import("./NotesButtonBlockControls.svelte").default };

const DATABASE_VIEW_IMPORTERS = {
  table: () => import("./NotesDatabaseTableView.svelte")
    .then((module) => ({ default: { kind: "table" as const, component: module.default } })),
  board: () => import("./NotesDatabaseBoardView.svelte")
    .then((module) => ({ default: { kind: "board" as const, component: module.default } })),
  gallery: () => import("./NotesDatabaseGalleryView.svelte")
    .then((module) => ({ default: { kind: "gallery" as const, component: module.default } })),
  list: () => import("./NotesDatabaseListView.svelte")
    .then((module) => ({ default: { kind: "list" as const, component: module.default } })),
  calendar: () => import("./NotesDatabaseCalendarView.svelte")
    .then((module) => ({ default: { kind: "calendar" as const, component: module.default } })),
  timeline: () => import("./NotesDatabaseTimelineView.svelte")
    .then((module) => ({ default: { kind: "timeline" as const, component: module.default } })),
} satisfies Readonly<Record<
  NotesDatabaseViewKind,
  LazyComponentImporter<LoadedNotesDatabaseView>
>>;

const ADVANCED_BLOCK_IMPORTERS = {
  media: () => import("./NotesMediaBlock.svelte")
    .then((module) => ({ default: { kind: "media" as const, component: module.default } })),
  "child-database": () => import("./NotesChildDatabaseBlock.svelte")
    .then((module) => ({ default: { kind: "child-database" as const, component: module.default } })),
  table: () => import("./NotesTableBlock.svelte")
    .then((module) => ({ default: { kind: "table" as const, component: module.default } })),
  card: () => import("./NotesCardBlock.svelte")
    .then((module) => ({ default: { kind: "card" as const, component: module.default } })),
  unsupported: () => import("./NotesUnsupportedBlock.svelte")
    .then((module) => ({ default: { kind: "unsupported" as const, component: module.default } })),
  "column-list": () => import("./NotesColumnListBlock.svelte")
    .then((module) => ({ default: { kind: "column-list" as const, component: module.default } })),
  tab: () => import("./NotesTabBlock.svelte")
    .then((module) => ({ default: { kind: "tab" as const, component: module.default } })),
} satisfies Readonly<Record<
  NotesAdvancedBlockFamily,
  LazyComponentImporter<LoadedNotesAdvancedBlock>
>>;

const EDITOR_PANEL_IMPORTERS = {
  "icon-picker": () => import("$lib/components/icon-picker/IconPicker.svelte")
    .then((module) => ({ default: { kind: "icon-picker" as const, component: module.default } })),
  backlinks: () => import("./NotesBacklinks.svelte")
    .then((module) => ({ default: { kind: "backlinks" as const, component: module.default } })),
  "page-links": () => import("./NotesPageLinks.svelte")
    .then((module) => ({ default: { kind: "page-links" as const, component: module.default } })),
  comments: () => import("./NotesComments.svelte")
    .then((module) => ({ default: { kind: "comments" as const, component: module.default } })),
  suggestions: () => import("./NotesSuggestions.svelte")
    .then((module) => ({ default: { kind: "suggestions" as const, component: module.default } })),
  "destination-picker": () => import("./NotesDestinationPickerList.svelte")
    .then((module) => ({ default: { kind: "destination-picker" as const, component: module.default } })),
  "page-cover": () => import("./NotesPageCover.svelte")
    .then((module) => ({ default: { kind: "page-cover" as const, component: module.default } })),
  "cover-menu": () => import("./NotesPageCoverMenu.svelte")
    .then((module) => ({ default: { kind: "cover-menu" as const, component: module.default } })),
  "html-export": () => importNotesHtmlExportDialog()
    .then((module) => ({ default: { kind: "html-export" as const, component: module.default } })),
  "agent-export": () => importNotesAgentBridgeExportDialog()
    .then((module) => ({ default: { kind: "agent-export" as const, component: module.default } })),
  "database-csv-import": () => import("./NotesDatabaseCsvImportPanel.svelte")
    .then((module) => ({ default: { kind: "database-csv-import" as const, component: module.default } })),
  "database-csv-export": () => importNotesDatabaseCsvExportPanel()
    .then((module) => ({ default: { kind: "database-csv-export" as const, component: module.default } })),
  "page-history": () => import("./NotesPageVersionHistoryModal.svelte")
    .then((module) => ({ default: { kind: "page-history" as const, component: module.default } })),
  "confirm-dialog": () => import("$lib/components/ui/ConfirmDialog.svelte")
    .then((module) => ({ default: { kind: "confirm-dialog" as const, component: module.default } })),
} satisfies Readonly<Record<NotesEditorPanelKind, LazyComponentImporter<LoadedNotesEditorPanel>>>;

const TEXT_CONTROL_IMPORTERS = {
  "text-context-menu": () => import("./NotesTextContextMenu.svelte")
    .then((module) => ({ default: { kind: "text-context-menu" as const, component: module.default } })),
  "link-editor": () => import("./NotesLinkEditor.svelte")
    .then((module) => ({ default: { kind: "link-editor" as const, component: module.default } })),
  "mention-menu": () => import("./NotesMentionMenu.svelte")
    .then((module) => ({ default: { kind: "mention-menu" as const, component: module.default } })),
  "slash-menu": () => import("./NotesSlashMenu.svelte")
    .then((module) => ({ default: { kind: "slash-menu" as const, component: module.default } })),
  "template-controls": () => import("./NotesTemplateBlockControls.svelte")
    .then((module) => ({ default: { kind: "template-controls" as const, component: module.default } })),
  "button-controls": () => import("./NotesButtonBlockControls.svelte")
    .then((module) => ({ default: { kind: "button-controls" as const, component: module.default } })),
} satisfies Readonly<Record<NotesTextControlKind, LazyComponentImporter<LoadedNotesTextControl>>>;

const databaseViewLoader = createLazyComponentLoader<
  NotesDatabaseViewKind,
  LoadedNotesDatabaseView
>(DATABASE_VIEW_IMPORTERS);
const advancedBlockLoader = createLazyComponentLoader<
  NotesAdvancedBlockFamily,
  LoadedNotesAdvancedBlock
>(ADVANCED_BLOCK_IMPORTERS);
const editorPanelLoader = createLazyComponentLoader<NotesEditorPanelKind, LoadedNotesEditorPanel>(
  EDITOR_PANEL_IMPORTERS,
);
const textControlLoader = createLazyComponentLoader<NotesTextControlKind, LoadedNotesTextControl>(
  TEXT_CONTROL_IMPORTERS,
);

/** Loads only the active database view implementation. */
export function loadNotesDatabaseView(
  kind: NotesDatabaseViewKind,
): Promise<LoadedNotesDatabaseView> {
  return databaseViewLoader.load(kind);
}

/** Retries an active database view import after a failure. */
export function retryNotesDatabaseView(
  kind: NotesDatabaseViewKind,
): Promise<LoadedNotesDatabaseView> {
  return databaseViewLoader.retry(kind);
}

/** Reports whether a database view implementation has loaded. */
export function notesDatabaseViewHasLoaded(kind: NotesDatabaseViewKind): boolean {
  return databaseViewLoader.hasLoaded(kind);
}

/** Loads only an advanced block family present in the current page. */
export function loadNotesAdvancedBlock(
  kind: NotesAdvancedBlockFamily,
): Promise<LoadedNotesAdvancedBlock> {
  return advancedBlockLoader.load(kind);
}

/** Retries an advanced block family import after a failure. */
export function retryNotesAdvancedBlock(
  kind: NotesAdvancedBlockFamily,
): Promise<LoadedNotesAdvancedBlock> {
  return advancedBlockLoader.retry(kind);
}

/** Reports whether an advanced block family implementation has loaded. */
export function notesAdvancedBlockHasLoaded(kind: NotesAdvancedBlockFamily): boolean {
  return advancedBlockLoader.hasLoaded(kind);
}

/** Loads one editor panel only after its trigger opens it. */
export function loadNotesEditorPanel(kind: NotesEditorPanelKind): Promise<LoadedNotesEditorPanel> {
  return editorPanelLoader.load(kind);
}

/** Retries an editor panel import after a failure. */
export function retryNotesEditorPanel(kind: NotesEditorPanelKind): Promise<LoadedNotesEditorPanel> {
  return editorPanelLoader.retry(kind);
}

/** Reports whether an editor panel implementation has loaded. */
export function notesEditorPanelHasLoaded(kind: NotesEditorPanelKind): boolean {
  return editorPanelLoader.hasLoaded(kind);
}

/** Loads one rich-text control only when its interaction state requires it. */
export function loadNotesTextControl(kind: NotesTextControlKind): Promise<LoadedNotesTextControl> {
  return textControlLoader.load(kind);
}

/** Retries a rich-text control import after a failure. */
export function retryNotesTextControl(kind: NotesTextControlKind): Promise<LoadedNotesTextControl> {
  return textControlLoader.retry(kind);
}

/** Reports whether a rich-text control implementation has loaded. */
export function notesTextControlHasLoaded(kind: NotesTextControlKind): boolean {
  return textControlLoader.hasLoaded(kind);
}
