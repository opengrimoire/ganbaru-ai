<script lang="ts">
  import { getContext, tick, untrack } from "svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import FileText from "@lucide/svelte/icons/file-text";
  import Folder from "@lucide/svelte/icons/folder";
  import FolderPlus from "@lucide/svelte/icons/folder-plus";
  import Search from "@lucide/svelte/icons/search";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import X from "@lucide/svelte/icons/x";
  import CalendarScrollbar from "$lib/components/calendar/CalendarScrollbar.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    notesHierarchyChildren,
    type NotesHierarchyNode,
    type NotesHierarchyParent,
  } from "$lib/notes/hierarchy-navigation";
  import { NOTES_PAGE_CHROME_EMOJI_SCALE } from "$lib/notes/page-icon";
  import { notesPageTitle } from "$lib/notes/page-title";
  import { notesFoldersForProject } from "$lib/notes/navigation-tree";
  import { notesPagesForProject } from "$lib/notes/project-membership";
  import {
    projectPickerBridgeFrameStyle,
    projectPickerPanelFrameStyle,
    projectPickerSubpanelGeometry,
  } from "$lib/projects/project-picker-panels";
  import { getNotesEditor } from "./notes-editor-context";
  import { cn } from "$lib/utils";
  import NotesHierarchyPickerPanel from "./NotesHierarchyPickerPanel.svelte";
  import NotesPageIcon from "./NotesPageIcon.svelte";

  type MaybePromise<T> = T | Promise<T>;

  interface NotesMobileHierarchyLevel {
    parent: NotesHierarchyParent;
    title: string;
  }

  let {
    projectId,
    parent = { kind: "root" },
    frameStyle,
    className = "fixed",
    zIndexClass = "z-81",
    rootElement = $bindable<HTMLDivElement | undefined>(),
    onPageSelected,
    onLayoutChange = undefined,
    onPointerLeave = undefined,
    mobileLayout = false,
    title = undefined,
    initialMobileAncestors = [],
    onBack = undefined,
    onClose = undefined,
  }: {
    projectId: string | null;
    parent?: NotesHierarchyParent;
    frameStyle: string;
    className?: string;
    zIndexClass?: string;
    rootElement?: HTMLDivElement | undefined;
    onPageSelected: () => MaybePromise<void>;
    onLayoutChange?: () => void;
    onPointerLeave?: (event: PointerEvent) => void;
    mobileLayout?: boolean;
    title?: string;
    initialMobileAncestors?: NotesMobileHierarchyLevel[];
    onBack?: () => void;
    onClose?: () => void;
  } = $props();

  const notes = getNotesEditor();
  const { t } = getLocalization();
  const activateNestedMobileBack = getContext<((handle: () => void) => () => void) | undefined>(
    "ganbaru-mobile-nested-back",
  );
  const iconSize = $derived(mobileLayout ? 18 : 13);
  const iconStrokeWidth = 1.6;
  const panelGap = 4;
  const panelListPadding = 8;
  const panelRowHeight = 32;
  const panelChromeHeight = 84;

  let search = $state("");
  let creatingFolder = $state(false);
  let folderDraft = $state("");
  let folderCreationError = $state<string | null>(null);
  let folderInput = $state<HTMLInputElement | null>(null);
  let activeNodeKey = $state<string | null>(null);
  let activeNodeAnchor = $state<HTMLElement | null>(null);
  let childPanelElement = $state<HTMLDivElement | undefined>();
  let childBridgeElement = $state<HTMLDivElement | undefined>();
  let childPanelStyle = $state("");
  let childBridgeStyle = $state("");
  let scrollElement = $state<HTMLElement | undefined>();
  let mobileParent = $state<NotesHierarchyParent>(untrack(() => parent));
  let mobileTitle = $state(untrack(() => title ?? t("notes.noteNavigatorLabel")));
  let mobileAncestors = $state<NotesMobileHierarchyLevel[]>(untrack(() => [...initialMobileAncestors]));
  const requestedPageIds = new Set<string>();

  const effectiveParent = $derived(mobileLayout ? mobileParent : parent);

  const projectPages = $derived.by(() => notesPagesForProject(notes.allPages, projectId));
  const projectFolders = $derived.by(() => notesFoldersForProject(notes.folders, projectId));
  const normalizedSearch = $derived(search.trim().toLocaleLowerCase());
  const allItems = $derived(notesHierarchyChildren(
    projectPages,
    projectFolders,
    effectiveParent,
    t("notes.untitled"),
    notes.sidebarPageIdsWithChildren,
  ));
  const items = $derived(allItems.filter((item) => {
    if (!normalizedSearch) return true;
    const title = item.kind === "folder"
      ? item.folder.name
      : notesPageTitle(item.page, t("notes.untitled"));
    return title.toLocaleLowerCase().includes(normalizedSearch);
  }));
  const activeNode = $derived(items.find((item) => item.key === activeNodeKey) ?? null);
  const childParent = $derived.by((): NotesHierarchyParent | null => {
    if (!activeNode?.hasChildren) return null;
    return activeNode.kind === "folder"
      ? { kind: "folder", id: activeNode.folder.id }
      : { kind: "page", id: activeNode.page.id };
  });
  const childItemCount = $derived(childParent
    ? notesHierarchyChildren(
        projectPages,
        projectFolders,
        childParent,
        t("notes.untitled"),
        notes.sidebarPageIdsWithChildren,
      ).length
    : 0);

  function currentBounds() {
    const margin = 8;
    const viewportBounds = {
      left: margin,
      right: window.innerWidth - margin,
      top: margin,
      bottom: window.innerHeight - margin,
    };
    const bounds = rootElement?.closest(".notes-view-root")?.getBoundingClientRect();
    if (!bounds) return viewportBounds;
    return {
      left: Math.max(bounds.left, viewportBounds.left),
      right: Math.min(bounds.right, viewportBounds.right),
      top: Math.max(bounds.top, viewportBounds.top),
      bottom: Math.min(bounds.bottom, viewportBounds.bottom),
    };
  }

  function updateChildGeometry(): void {
    if (!activeNodeAnchor || !rootElement || !childParent) return;
    const geometry = projectPickerSubpanelGeometry({
      anchorRect: activeNodeAnchor.getBoundingClientRect(),
      panelRect: rootElement.getBoundingClientRect(),
      bounds: currentBounds(),
      gap: panelGap,
      footerHeight: panelChromeHeight,
      projectCount: Math.max(1, childItemCount),
      visibleRows: null,
      listPadding: panelListPadding,
      rowHeight: panelRowHeight,
    });
    childPanelStyle = projectPickerPanelFrameStyle(geometry.panel);
    childBridgeStyle = projectPickerBridgeFrameStyle(geometry.bridge);
  }

  function activateNode(node: NotesHierarchyNode, target: EventTarget | null): void {
    if (!node.hasChildren) {
      activeNodeKey = null;
      activeNodeAnchor = null;
      return;
    }
    activeNodeKey = node.key;
    activeNodeAnchor = target instanceof HTMLElement ? target : null;
    if (node.kind === "page" && !requestedPageIds.has(node.page.id)) {
      requestedPageIds.add(node.page.id);
      void notes.loadNavigationChildren(node.page.id).catch((error: unknown) => {
        requestedPageIds.delete(node.page.id);
        console.error("load Notes hierarchy children failed", error);
      });
    }
    updateChildGeometry();
    void tick().then(updateChildGeometry);
  }

  function nodeParent(node: NotesHierarchyNode): NotesHierarchyParent {
    return node.kind === "folder"
      ? { kind: "folder", id: node.folder.id }
      : { kind: "page", id: node.page.id };
  }

  function nodeTitle(node: NotesHierarchyNode): string {
    return node.kind === "folder"
      ? node.folder.name
      : notesPageTitle(node.page, t("notes.untitled"));
  }

  function openMobileChildren(node: NotesHierarchyNode): void {
    if (!node.hasChildren && node.kind !== "folder") return;
    if (node.kind === "page" && !requestedPageIds.has(node.page.id)) {
      requestedPageIds.add(node.page.id);
      void notes.loadNavigationChildren(node.page.id).catch((error: unknown) => {
        requestedPageIds.delete(node.page.id);
        console.error("load Notes hierarchy children failed", error);
      });
    }
    mobileAncestors = [
      ...mobileAncestors,
      { parent: effectiveParent, title: mobileTitle },
    ];
    mobileParent = nodeParent(node);
    mobileTitle = nodeTitle(node);
    search = "";
  }

  function handleMobileBack(): void {
    if (creatingFolder) {
      creatingFolder = false;
      folderDraft = "";
      folderCreationError = null;
      return;
    }
    if (normalizedSearch) {
      search = "";
      return;
    }
    const previous = mobileAncestors[mobileAncestors.length - 1];
    if (!previous) {
      onBack?.();
      return;
    }
    mobileAncestors = mobileAncestors.slice(0, -1);
    mobileParent = previous.parent;
    mobileTitle = previous.title;
    search = "";
  }

  function boundaryContains(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return Boolean(
      rootElement?.contains(target)
      || activeNodeAnchor?.contains(target)
      || childBridgeElement?.contains(target)
      || childPanelElement?.contains(target),
    );
  }

  function handleBoundaryLeave(event: PointerEvent): void {
    if (boundaryContains(event.relatedTarget)) return;
    activeNodeKey = null;
    activeNodeAnchor = null;
    onPointerLeave?.(event);
  }

  async function selectPage(pageId: string): Promise<void> {
    await notes.selectPage(pageId, { openMode: "full" });
    await onPageSelected();
  }

  async function createPage(): Promise<void> {
    if (effectiveParent.kind === "page") {
      await notes.createSubpage(effectiveParent.id, "", { openMode: "full" });
    } else {
      await notes.createPage("", {
        projectId,
        folderId: effectiveParent.kind === "folder" ? effectiveParent.id : null,
        openMode: "full",
      });
    }
    await onPageSelected();
  }

  function nextFolderName(): string {
    const parentFolderId = effectiveParent.kind === "folder" ? effectiveParent.id : null;
    const baseName = t("notes.defaultFolderName");
    const siblingNames = new Set(
      projectFolders
        .filter((folder) => folder.parent_folder_id === parentFolderId)
        .map((folder) => folder.name.trim().toLocaleLowerCase()),
    );
    if (!siblingNames.has(baseName.toLocaleLowerCase())) return baseName;
    let suffix = 2;
    while (siblingNames.has(`${baseName} ${suffix}`.toLocaleLowerCase())) suffix += 1;
    return `${baseName} ${suffix}`;
  }

  function beginFolderCreation(): void {
    folderDraft = nextFolderName();
    folderCreationError = null;
    creatingFolder = true;
    void tick().then(() => {
      folderInput?.focus();
      folderInput?.select();
    });
  }

  async function createFolder(): Promise<void> {
    if (!projectId || effectiveParent.kind === "page") return;
    const name = folderDraft.trim();
    if (!name) return;
    folderCreationError = null;
    try {
      await notes.createFolder(
        projectId,
        name,
        effectiveParent.kind === "folder" ? effectiveParent.id : null,
      );
      creatingFolder = false;
      folderDraft = "";
    } catch (error) {
      folderCreationError = error instanceof Error ? error.message : String(error);
    }
  }

  $effect(() => {
    if (!normalizedSearch) return;
    activeNodeKey = null;
    activeNodeAnchor = null;
  });

  $effect(() => {
    if (
      !mobileLayout
      || (!onBack && mobileAncestors.length === 0 && !creatingFolder && !normalizedSearch)
    ) return;
    return activateNestedMobileBack?.(handleMobileBack);
  });

  $effect(() => {
    const itemCount = items.length;
    void itemCount;
    requestAnimationFrame(() => {
      onLayoutChange?.();
      updateChildGeometry();
    });
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={rootElement}
  class={cn(
    "project-picker-panel flex min-h-0 flex-col overflow-hidden bg-popover text-popover-foreground shadow-lg ring-1 ring-border/60",
    mobileLayout ? "h-full rounded-2xl" : "rounded-md",
    className,
    zIndexClass,
  )}
  style={frameStyle}
  onpointerleave={handleBoundaryLeave}
>
  <div class={cn("shrink-0", mobileLayout ? "border-b border-border/70 p-2" : "px-1.5 pb-0.5 pt-1.5")}>
    {#if mobileLayout}
      <div class="flex min-h-14 items-center gap-1">
        {#if onBack || mobileAncestors.length > 0}
          <button
            type="button"
            class="flex min-h-12 min-w-12 items-center justify-center rounded-xl active:bg-accent"
            aria-label={mobileAncestors.length > 0 ? t("notes.backToPages") : t("projects.navigator.backToProjects")}
            onclick={handleMobileBack}
          >
            <ChevronLeft size={22} strokeWidth={iconStrokeWidth} aria-hidden="true" />
          </button>
        {/if}
        <h2 class="min-w-0 flex-1 truncate px-2 text-base font-semibold">{mobileTitle}</h2>
        {#if onClose}
          <button
            type="button"
            data-project-picker-initial-focus="true"
            class="flex min-h-12 min-w-12 items-center justify-center rounded-xl active:bg-accent"
            aria-label={t("common.close")}
            onclick={onClose}
          >
            <X size={22} strokeWidth={iconStrokeWidth} aria-hidden="true" />
          </button>
        {/if}
      </div>
    {/if}
    <div class={cn(
      "flex items-center gap-1.5 border border-border/70 bg-muted/20",
      mobileLayout ? "min-h-12 rounded-xl px-3" : "min-h-8 rounded-md pl-2 pr-1",
    )}>
      <Search size={iconSize} strokeWidth={iconStrokeWidth} class="shrink-0 text-popover-foreground/60" />
      <input
        bind:value={search}
        placeholder={t("notes.searchPlaceholder")}
        aria-label={t("notes.searchLabel")}
        class={cn(
          "min-w-0 flex-1 bg-transparent text-popover-foreground placeholder:text-popover-foreground/45",
          mobileLayout ? "h-12 text-base" : "text-[0.8rem]",
        )}
      />
      {#if mobileLayout && normalizedSearch}
        <button
          type="button"
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-popover-foreground/60 active:bg-accent"
          aria-label={t("notes.clearSearch")}
          onclick={() => { search = ""; }}
        >
          <X size={18} strokeWidth={iconStrokeWidth} aria-hidden="true" />
        </button>
      {/if}
    </div>
  </div>
  <div class="relative min-h-0 flex-1">
    <div bind:this={scrollElement} class={cn("hide-scrollbar h-full min-h-0 overflow-y-auto", mobileLayout ? "overscroll-contain px-2 py-2" : "p-1")}>
      {#if notes.loading && projectPages.length === 0 && projectFolders.length === 0}
        <div class="px-3 py-2 text-[0.8rem] text-popover-foreground/60">{t("notes.loading")}</div>
      {:else if notes.loadError}
        <div class="px-3 py-2 text-[0.8rem] text-destructive">{t("notes.loadFailed", notes.loadError)}</div>
      {:else if items.length === 0}
        <div class="px-3 py-2 text-[0.8rem] text-popover-foreground/60">
          {normalizedSearch ? t("notes.noSearchResults") : t("notes.noPages")}
        </div>
      {:else}
        <div class="grid">
          {#each items as item (item.key)}
            {@const title = item.kind === "folder" ? item.folder.name : notesPageTitle(item.page, t("notes.untitled"))}
            {#if mobileLayout}
              <div class={cn("flex min-h-12 items-stretch rounded-md", activeNodeKey === item.key && "bg-accent text-accent-foreground")}>
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-left text-sm text-popover-foreground active:bg-accent"
                  aria-label={title}
                  onclick={() => {
                    if (item.kind === "page") void selectPage(item.page.id);
                    else openMobileChildren(item);
                  }}
                >
                  {#if item.kind === "folder"}
                    <Folder size={iconSize} strokeWidth={iconStrokeWidth} class="shrink-0" />
                  {:else if item.page.icon}
                    <NotesPageIcon
                      icon={item.page.icon}
                      size={iconSize}
                      strokeWidth={iconStrokeWidth}
                      emojiScale={NOTES_PAGE_CHROME_EMOJI_SCALE}
                      class="shrink-0"
                    />
                  {:else}
                    <FileText size={iconSize} strokeWidth={iconStrokeWidth} class="shrink-0" />
                  {/if}
                  <span class="min-w-0 flex-1 truncate">{title}</span>
                  {#if item.kind === "folder"}
                    <ChevronRight size={iconSize} strokeWidth={iconStrokeWidth} class="shrink-0 text-popover-foreground/45" />
                  {/if}
                </button>
                {#if item.kind === "page" && item.hasChildren}
                  <button
                    type="button"
                    class="flex w-12 shrink-0 items-center justify-center rounded-md text-popover-foreground/60 active:bg-accent"
                    aria-label={title}
                    onclick={() => openMobileChildren(item)}
                  >
                    <ChevronRight size={iconSize} strokeWidth={iconStrokeWidth} aria-hidden="true" />
                  </button>
                {/if}
              </div>
            {:else}
              <button
                type="button"
                class={cn(
                  "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[0.8rem] text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  activeNodeKey === item.key && "bg-accent text-accent-foreground",
                )}
                aria-label={title}
                onpointerenter={(event) => activateNode(item, event.currentTarget)}
                onfocus={(event) => activateNode(item, event.currentTarget)}
                onclick={(event) => {
                  if (item.kind === "page") void selectPage(item.page.id);
                  else activateNode(item, event.currentTarget);
                }}
              >
                {#if item.kind === "folder"}
                  <Folder size={iconSize} strokeWidth={iconStrokeWidth} class="shrink-0" />
                {:else if item.page.icon}
                  <NotesPageIcon
                    icon={item.page.icon}
                    size={iconSize}
                    strokeWidth={iconStrokeWidth}
                    emojiScale={NOTES_PAGE_CHROME_EMOJI_SCALE}
                    class="shrink-0"
                  />
                {:else}
                  <FileText size={iconSize} strokeWidth={iconStrokeWidth} class="shrink-0" />
                {/if}
                <span class="min-w-0 flex-1 truncate">{title}</span>
                {#if item.hasChildren}
                  <ChevronRight size={iconSize} strokeWidth={iconStrokeWidth} class="shrink-0 text-popover-foreground/45" />
                {/if}
              </button>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
    {#if !mobileLayout}
      <CalendarScrollbar
        scrollContainer={scrollElement}
        stickyTop={4}
        stickyBottom={4}
        wheelPassthrough
      />
    {/if}
  </div>

  <div class={cn("relative z-10 shrink-0 bg-popover", mobileLayout ? "p-2" : "p-1.5")}>
    <div class="pointer-events-none absolute left-1.5 right-1.5 top-0 border-t border-border/70"></div>
    {#if creatingFolder && effectiveParent.kind !== "page"}
      <form class={cn("flex", mobileLayout ? "gap-2" : "gap-1")} onsubmit={(event) => { event.preventDefault(); void createFolder(); }}>
        <input
          bind:this={folderInput}
          bind:value={folderDraft}
          placeholder={t("notes.defaultFolderName")}
          aria-label={t("notes.newFolder")}
          class={cn(
            "min-w-0 flex-1 border border-border bg-muted/40 text-popover-foreground placeholder:text-popover-foreground/45",
            mobileLayout ? "min-h-12 rounded-xl px-3 text-base" : "min-h-8 rounded px-2 text-[0.8rem]",
          )}
        />
        <button type="submit" class={cn("bg-primary font-medium text-primary-foreground", mobileLayout ? "min-h-12 rounded-xl px-4 text-sm" : "min-h-8 rounded px-2 text-[0.733333rem]")}>
          {t("common.save")}
        </button>
        {#if mobileLayout}
          <button
            type="button"
            class="flex min-h-12 min-w-12 items-center justify-center rounded-xl active:bg-accent"
            aria-label={t("common.cancel")}
            onclick={() => {
              creatingFolder = false;
              folderDraft = "";
              folderCreationError = null;
            }}
          >
            <X size={18} strokeWidth={iconStrokeWidth} aria-hidden="true" />
          </button>
        {/if}
      </form>
    {:else}
      <div class={cn("flex items-center", mobileLayout ? "min-h-12" : "min-h-8")}>
        {#if effectiveParent.kind !== "page"}
          <button
            type="button"
            class={cn("flex min-w-0 flex-1 items-center justify-center gap-1.5 px-1 text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground", mobileLayout ? "min-h-12 rounded-xl text-sm active:bg-accent" : "min-h-8 rounded-md text-[0.8rem]")}
            onclick={beginFolderCreation}
          >
            <FolderPlus size={iconSize} strokeWidth={iconStrokeWidth} />
            <span class="truncate">{t("notes.newFolder")}</span>
          </button>
          <div class="mx-1 h-5 border-l border-border/70" aria-hidden="true"></div>
        {/if}
        <button
          type="button"
          class={cn("flex min-w-0 flex-1 items-center justify-center gap-1.5 px-1 text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground", mobileLayout ? "min-h-12 rounded-xl text-sm active:bg-accent" : "min-h-8 rounded-md text-[0.8rem]")}
          aria-label={t("notes.newPage")}
          aria-keyshortcuts="Control+N Meta+N"
          onclick={() => { void createPage(); }}
        >
          <SquarePen size={iconSize} strokeWidth={iconStrokeWidth} />
          <span class="truncate">{t("notes.newPage")}</span>
        </button>
      </div>
    {/if}
    {#if folderCreationError}
      <div class="px-1 pt-1 text-[0.733333rem] text-destructive" role="alert">
        {t("notes.folderActionFailed", folderCreationError)}
      </div>
    {/if}
  </div>
</div>

{#if !mobileLayout && childParent && activeNodeAnchor}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={childBridgeElement}
    aria-hidden="true"
    class={cn("fixed bg-transparent", zIndexClass)}
    style={childBridgeStyle}
    onpointerleave={handleBoundaryLeave}
  ></div>
  <NotesHierarchyPickerPanel
    bind:rootElement={childPanelElement}
    {projectId}
    parent={childParent}
    frameStyle={childPanelStyle}
    {zIndexClass}
    {onPageSelected}
    onPointerLeave={handleBoundaryLeave}
  />
{/if}

<style>
  .project-picker-panel {
    --cal-scrollbar-thumb: color-mix(in srgb, var(--popover-foreground) 18%, var(--popover));
    --cal-scrollbar-thumb-hover: color-mix(in srgb, var(--popover-foreground) 36%, var(--popover));
  }
</style>
