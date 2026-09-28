import {
  archiveNotesPage,
  createNotesChildPageFromBlock,
  createNotesPage,
  duplicateNotesPage,
  moveNotesPage,
  permanentlyDeleteNotesPage,
  trashNotesPage,
  updateNotesPage,
} from "$lib/api/notes";
import { invalidateNotesPageCoverAssetUrl } from "$lib/api/notes-page-covers";
import { invalidateNotesPageIconAssetUrl } from "$lib/api/notes-page-icons";
import { blockPlainText } from "$lib/notes/block-factory";
import { planNotesInsertedBlockFocus, planNotesPageLoadFocus } from "$lib/notes/editor-focus";
import { nextSelectedNotesPageId } from "$lib/notes/page-selection";
import { notesPageCoverAssetPath } from "$lib/notes/page-cover";
import { notesPageIconAssetPath } from "$lib/notes/page-icon";
import { createProvisionalNotesPage } from "$lib/notes/page-creation";
import type { NotesPageOpenMode } from "$lib/notes/page-open-mode";
import {
  normalizeNotesProjectId,
  notesPageProjectId,
  notesPageProjectProperties,
  type NotesCreatePageOptions,
} from "$lib/notes/project-membership";
import type { NotesPostMutationResult, NotesSidebarMetadataImpact } from "$lib/notes/post-mutation";
import type {
  NotesBlock,
  NotesFolder,
  NotesLoadedPage,
  NotesPage,
  NotesPageCover,
  NotesPageIcon,
  NotesParent,
} from "$lib/notes/types";
import type { NotesTextSelection } from "$lib/notes/editor-selection";

const START_OF_NOTES_BLOCK_SELECTION: NotesTextSelection = { start: 0, end: 0 };

export interface NotesMovePageOptions {
  preserveSelection?: boolean;
}

interface NotesPageActionsContext {
  readSelectedPageId: () => string | null;
  readPages: () => NotesPage[];
  readAllPages: () => NotesPage[];
  readLoadedPage: () => NotesPage | null;
  readFolders: () => NotesFolder[];
  readBlocksById: () => Record<string, NotesBlock>;
  defaultOpenMode: (projectId: string | null) => NotesPageOpenMode;
  activateReturnedPage: (
    loaded: NotesLoadedPage,
    impact: Exclude<NotesSidebarMetadataImpact, "none">,
    openMode?: NotesPageOpenMode,
  ) => Promise<void>;
  activateProvisionalPage: (loaded: NotesLoadedPage, openMode: NotesPageOpenMode) => void;
  beginPageCreation: (request: Parameters<typeof createNotesPage>[0]) => void;
  awaitPageReady: (pageId: string | null) => Promise<void>;
  activateRestoredPage: (page: NotesPage) => Promise<void>;
  applyPostMutation: (result: NotesPostMutationResult) => void;
  selectPage: (pageId: string | null) => Promise<void>;
  reloadPageBreadcrumb: (pageId: string) => Promise<void>;
  flushBlockSave: (blockId: string) => Promise<void>;
  flushPendingBlockSaves: () => Promise<void>;
  requestBlockFocus: (blockId: string | null, selection?: NotesTextSelection | null) => void;
  requestTitleFocus: (pageId: string) => void;
  requestPageLoadFocus: () => void;
  queueDescendantHydration: () => void;
  setFolderCollapsed: (folderId: string, collapsed: boolean) => void;
  setSidebarPageCollapsed: (pageId: string, collapsed: boolean) => void;
  prependArchivedPage: (page: NotesPage) => void;
  prependTrashedPage: (page: NotesPage) => void;
  removeArchivedPages: (pageIds: ReadonlySet<string>) => void;
  removeTrashedPages: (pageIds: ReadonlySet<string>) => void;
  removePagesFromActiveCollections: (pageIds: ReadonlySet<string>) => void;
  removeSidebarPageIds: (pageIds: ReadonlySet<string>) => void;
  scheduleHierarchyRefresh: () => void;
}

/** Create Notes page lifecycle operations over the facade-owned reactive state. */
export function createNotesPageActions(context: NotesPageActionsContext) {
  function projectIdForParent(
    parent: NotesParent,
    options: NotesCreatePageOptions,
  ): string | null {
    if ("projectId" in options) return normalizeNotesProjectId(options.projectId);
    const folderId = options.folderId?.trim();
    if (parent.type === "workspace" && folderId) {
      return normalizeNotesProjectId(
        context.readFolders().find((folder) => folder.id === folderId)?.project_id,
      );
    }
    if (parent.type !== "page_id") return null;
    const parentPage = context.readAllPages().find((page) => page.id === parent.page_id)
      ?? (context.readLoadedPage()?.id === parent.page_id ? context.readLoadedPage() : null);
    return parentPage ? notesPageProjectId(parentPage) : null;
  }

  async function createPageWithParent(
    title: string,
    parent: NotesParent,
    options: NotesCreatePageOptions,
  ): Promise<void> {
    const pageId = crypto.randomUUID();
    const firstBlockId = crypto.randomUUID();
    const projectId = projectIdForParent(parent, options);
    const folderId = parent.type === "workspace" ? options.folderId?.trim() || null : null;
    const request = {
      id: pageId,
      title,
      parent,
      folder_id: folderId,
      first_block_id: firstBlockId,
      after_block_id: null,
      properties: notesPageProjectProperties(projectId),
    };
    const provisional = createProvisionalNotesPage(request);
    if (provisional.page.folder_id) context.setFolderCollapsed(provisional.page.folder_id, false);
    context.activateProvisionalPage(
      provisional,
      options.openMode ?? context.defaultOpenMode(projectId),
    );
    context.requestBlockFocus(null);
    context.requestTitleFocus(provisional.page.id);
    context.beginPageCreation(request);
  }

  async function createPage(title: string, options: NotesCreatePageOptions = {}): Promise<void> {
    await createPageWithParent(title, { type: "workspace", workspace: true }, options);
  }

  async function createSubpage(
    parentPageId: string,
    title: string,
    options: NotesCreatePageOptions = {},
  ): Promise<void> {
    context.setSidebarPageCollapsed(parentPageId, false);
    await createPageWithParent(title, { type: "page_id", page_id: parentPageId }, options);
  }

  async function createChildPageFromBlock(blockId: string): Promise<void> {
    await context.awaitPageReady(context.readSelectedPageId());
    const block = context.readBlocksById()[blockId];
    if (!block || block.type === "child_page") return;
    await context.flushBlockSave(blockId);
    const firstBlockId = crypto.randomUUID();
    const page = context.readLoadedPage();
    const loaded = await createNotesChildPageFromBlock(blockId, {
      first_block_id: firstBlockId,
      title: blockPlainText(block).trim(),
      properties: notesPageProjectProperties(page ? notesPageProjectId(page) : null),
    });
    await context.activateReturnedPage(loaded, "hierarchy");
    context.requestBlockFocus(
      planNotesInsertedBlockFocus([loaded.blocks.results[0]?.id, firstBlockId]),
      START_OF_NOTES_BLOCK_SELECTION,
    );
  }

  async function createChildPageAfterBlock(blockId: string): Promise<void> {
    await context.awaitPageReady(context.readSelectedPageId());
    const block = context.readBlocksById()[blockId];
    if (!block) return;
    await context.flushBlockSave(blockId);
    const pageId = crypto.randomUUID();
    const firstBlockId = crypto.randomUUID();
    const page = context.readLoadedPage();
    const loaded = await createNotesPage({
      id: pageId,
      title: "",
      parent: block.parent,
      folder_id: null,
      first_block_id: firstBlockId,
      after_block_id: blockId,
      properties: notesPageProjectProperties(page ? notesPageProjectId(page) : null),
    });
    if (block.parent.type === "page_id") {
      context.setSidebarPageCollapsed(block.parent.page_id, false);
    }
    await context.activateReturnedPage(loaded, "hierarchy");
    context.requestBlockFocus(
      planNotesInsertedBlockFocus([loaded.blocks.results[0]?.id, firstBlockId]),
      START_OF_NOTES_BLOCK_SELECTION,
    );
  }

  async function renamePage(pageId: string, title: string): Promise<void> {
    await context.awaitPageReady(pageId);
    const page = await updateNotesPage(pageId, { title: title.trim() });
    context.applyPostMutation({ pages: [page] });
    if (context.readSelectedPageId() === page.id) await context.reloadPageBreadcrumb(page.id);
  }

  async function duplicatePage(pageId: string, title: string): Promise<void> {
    await context.flushPendingBlockSaves();
    const loaded = await duplicateNotesPage(pageId, { title });
    if (loaded.page.parent.type === "page_id") {
      context.setSidebarPageCollapsed(loaded.page.parent.page_id, false);
    }
    if (loaded.page.folder_id) context.setFolderCollapsed(loaded.page.folder_id, false);
    await context.activateReturnedPage(loaded, "hierarchy");
    context.requestBlockFocus(planNotesPageLoadFocus(loaded.blocks.results.map((block) => block.id)));
  }

  async function movePageWithPlacement(
    pageId: string,
    parent: NotesParent,
    folderId: string | null,
    options: NotesMovePageOptions = {},
  ): Promise<void> {
    await context.flushPendingBlockSaves();
    const loaded = await moveNotesPage(pageId, { parent, folder_id: folderId });
    if (loaded.page.parent.type === "page_id") {
      context.setSidebarPageCollapsed(loaded.page.parent.page_id, false);
    }
    if (loaded.page.folder_id) context.setFolderCollapsed(loaded.page.folder_id, false);
    if (options.preserveSelection) {
      context.applyPostMutation({ pages: [loaded.page], sidebarImpact: "hierarchy" });
      const selectedPageId = context.readSelectedPageId();
      if (selectedPageId) await context.reloadPageBreadcrumb(selectedPageId);
    } else {
      await context.activateReturnedPage(loaded, "hierarchy");
      context.requestPageLoadFocus();
    }
    context.queueDescendantHydration();
  }

  async function updatePageIcon(pageId: string, icon: NotesPageIcon | null): Promise<void> {
    const previous = context.readLoadedPage()?.id === pageId
      ? context.readLoadedPage()
      : context.readAllPages().find((page) => page.id === pageId);
    const previousPath = notesPageIconAssetPath(previous?.icon ?? null);
    const page = await updateNotesPage(pageId, { icon });
    const nextPath = notesPageIconAssetPath(page.icon);
    if (previousPath && previousPath !== nextPath) invalidateNotesPageIconAssetUrl(previousPath);
    context.applyPostMutation({ pages: [page] });
  }

  async function updatePageCover(pageId: string, cover: NotesPageCover | null): Promise<void> {
    const previous = context.readLoadedPage()?.id === pageId
      ? context.readLoadedPage()
      : context.readAllPages().find((page) => page.id === pageId);
    const previousPath = notesPageCoverAssetPath(previous?.cover ?? null);
    const page = await updateNotesPage(pageId, { cover });
    const nextPath = notesPageCoverAssetPath(page.cover);
    if (previousPath && previousPath !== nextPath) invalidateNotesPageCoverAssetUrl(previousPath);
    context.applyPostMutation({ pages: [page] });
  }

  async function trashPage(pageId: string): Promise<void> {
    const trashed = await trashNotesPage(pageId, true);
    const preferred = nextSelectedNotesPageId(context.readPages(), pageId);
    context.prependTrashedPage(trashed);
    context.removeArchivedPages(new Set([pageId]));
    context.applyPostMutation({ removedPageIds: [pageId], sidebarImpact: "hierarchy" });
    const pages = context.readPages();
    const next = preferred && pages.some((page) => page.id === preferred)
      ? preferred
      : pages[0]?.id ?? null;
    await context.selectPage(next);
  }

  async function archivePage(pageId: string): Promise<void> {
    const archived = await archiveNotesPage(pageId, true);
    context.prependArchivedPage(archived);
    const next = nextSelectedNotesPageId(context.readPages(), pageId);
    context.applyPostMutation({ removedPageIds: [pageId], sidebarImpact: "hierarchy" });
    await context.selectPage(next);
  }

  async function unarchivePage(pageId: string): Promise<void> {
    const page = await archiveNotesPage(pageId, false);
    context.removeArchivedPages(new Set([pageId]));
    await context.activateRestoredPage(page);
  }

  async function restorePage(pageId: string): Promise<void> {
    const page = await trashNotesPage(pageId, false);
    context.removeTrashedPages(new Set([pageId]));
    await context.activateRestoredPage(page);
  }

  async function permanentlyDeletePage(pageId: string): Promise<void> {
    await context.flushPendingBlockSaves();
    const deletedIds = new Set(await permanentlyDeleteNotesPage(pageId));
    context.removePagesFromActiveCollections(deletedIds);
    context.removeArchivedPages(deletedIds);
    context.removeTrashedPages(deletedIds);
    context.removeSidebarPageIds(deletedIds);
    context.scheduleHierarchyRefresh();
    const selectedPageId = context.readSelectedPageId();
    if (selectedPageId && deletedIds.has(selectedPageId)) {
      await context.selectPage(context.readPages()[0]?.id ?? null);
    }
  }

  return {
    createPage,
    createSubpage,
    createChildPageFromBlock,
    createChildPageAfterBlock,
    renamePage,
    duplicatePage,
    movePage: (pageId: string, parent: NotesParent, options?: NotesMovePageOptions) => (
      movePageWithPlacement(pageId, parent, null, options)
    ),
    movePageToFolder: (
      pageId: string,
      folderId: string | null,
      options?: NotesMovePageOptions,
    ) => movePageWithPlacement(
      pageId,
      { type: "workspace", workspace: true },
      folderId?.trim() || null,
      options,
    ),
    updatePageIcon,
    updatePageCover,
    trashPage,
    archivePage,
    unarchivePage,
    restorePage,
    permanentlyDeletePage,
  };
}
