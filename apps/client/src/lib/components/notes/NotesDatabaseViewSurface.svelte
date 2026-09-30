<script lang="ts">
  import CollectionViewButton from "$lib/components/collections/CollectionViewButton.svelte";
  import { tick, untrack } from "svelte";
  import { databaseResource, notesDatabaseSession } from "$lib/notes/database-session.svelte";
  import Table2 from "@lucide/svelte/icons/table-2";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import ChartGantt from "@lucide/svelte/icons/chart-gantt";
  import Copy from "@lucide/svelte/icons/copy";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import {
    deleteNotesDatabaseView,
    duplicateNotesDatabaseView,
    applyNotesDataSourceTemplate,
    createNotesDataSourceRowPage,
    getNotesDataSourceBoardView,
    getNotesDataSourceCalendarView,
    getNotesDataSourceGalleryView,
    getNotesDataSourceListView,
    getNotesDataSourceTableView,
    getNotesDataSourceTimelineView,
    listNotesDatabaseViews,
    listNotesDataSourceTemplates,
    renameNotesDatabaseView,
  } from "$lib/api/notes";
  import {
    NOTES_DATABASE_VIEW_KINDS,
    type NotesDatabaseView,
    type NotesDatabaseViewKind,
    type NotesDataSourceTemplate,
    type NotesDataSourcePropertyType,
  } from "$lib/notes/types";
  import {
    beginLazyComponentLoad,
    rejectLazyComponentLoad,
    resolveLazyComponentLoad,
    type LazyComponentLoadState,
  } from "$lib/lazy-component-loader";
  import CollectionMenu from "$lib/components/collections/CollectionMenu.svelte";
  import {
    loadNotesDatabaseView,
    retryNotesDatabaseView,
    readNotesDatabaseView,
    type LoadedNotesDatabaseView,
  } from "./notes-editor-component-registry";

  let {
    dataSourceId,
    databaseId,
    initialViewId,
    reloadKeys,
    onSelectPage,
    onEditProperties,
    onCreateLinkedDatabaseView,
    onAddProperty,
    onSavingChange = () => {},
  }: {
    dataSourceId: string;
    databaseId: string | null;
    initialViewId: string | null;
    reloadKeys: Record<NotesDatabaseViewKind, number>;
    onSelectPage: (pageId: string) => void;
    onEditProperties: () => void;
    onCreateLinkedDatabaseView: () => void;
    onAddProperty: (type: NotesDataSourcePropertyType, name: string) => Promise<void>;
    onSavingChange?: (saving: boolean) => void;
  } = $props();

  const { t } = getLocalization();
  const MAX_VISIBLE_VIEWS = 3;
  const viewIcons = {
    table: Table2,
    board: Columns3,
    gallery: LayoutGrid,
    list: List,
    calendar: CalendarDays,
    timeline: ChartGantt,
  };
  let views = $state<NotesDatabaseView[]>(untrack(() => notesDatabaseSession.read(databaseResource("views", dataSourceId, { databaseId })) ?? []));
  let selectedViewId = $state<string | null>(untrack(() => notesDatabaseSession.recall(databaseId ?? dataSourceId)?.viewId ?? initialViewId));
  let viewError = $state<string | null>(null);
  let busy = $state(false);
  let layoutSaving = $state(false);

  $effect(() => {
    onSavingChange(busy || layoutSaving);
    return () => onSavingChange(false);
  });
  let editingName = $state(false);
  let nameInput: HTMLInputElement | null = $state(null);
  let nameDraft = $state("");
  let viewSearch = $state("");
  let viewSettingsOpen = $state(false);
  let newRowRequest = $state(0);
  let templates = $state<NotesDataSourceTemplate[]>(untrack(() => notesDatabaseSession.read(databaseResource("templates", dataSourceId)) ?? []));
  let templateError = $state<string | null>(null);
  let pendingDeleteView = $state<NotesDatabaseView | null>(null);
  let lastDatabaseId = $state<string | null>(null);
  let metadataRequest = 0;
  let viewLoadState = $state<LazyComponentLoadState<NotesDatabaseViewKind, LoadedNotesDatabaseView> | null>(untrack(() => {
    const kind = (views.find((view) => view.id === selectedViewId) ?? views[0])?.type ?? "table";
    if (!NOTES_DATABASE_VIEW_KINDS.includes(kind as NotesDatabaseViewKind)) return null;
    const component = readNotesDatabaseView(kind as NotesDatabaseViewKind);
    return component ? { key: component.kind, status: "ready", requestId: 0, component } : null;
  }));

  const supportedViews = $derived(views.filter((view) => NOTES_DATABASE_VIEW_KINDS.includes(view.type as NotesDatabaseViewKind)));
  const selectedView = $derived(supportedViews.find((view) => view.id === selectedViewId) ?? supportedViews[0] ?? null);
  const activeView = $derived((selectedView?.type ?? "table") as NotesDatabaseViewKind);
  const activeViewId = $derived(selectedView?.id ?? null);
  const shownViews = $derived.by(() => {
    if (supportedViews.length <= MAX_VISIBLE_VIEWS) return supportedViews;
    const firstTwo = supportedViews.slice(0, 2);
    return selectedView && !firstTwo.some((view) => view.id === selectedView.id)
      ? [...firstTwo, selectedView]
      : supportedViews.slice(0, MAX_VISIBLE_VIEWS);
  });
  const overflowCount = $derived(Math.max(0, supportedViews.length - shownViews.length));
  const searchableViews = $derived(supportedViews.filter((view) => view.name.toLocaleLowerCase().includes(viewSearch.toLocaleLowerCase())));

  $effect(() => {
    const revision = notesDatabaseSession.revision;
    if (!databaseId || busy) return;
    const signature = `${dataSourceId}:${databaseId}:${revision}`;
    if (signature === lastDatabaseId) return;
    lastDatabaseId = signature;
    void reloadViews(selectedViewId ?? initialViewId, false);
  });

  $effect(() => {
    const id = selectedViewId;
    if (!id) return;
    untrack(() => {
      const key = databaseId ?? dataSourceId;
      notesDatabaseSession.remember(key, { viewId: id, scrollLeft: notesDatabaseSession.recall(key)?.scrollLeft ?? 0 });
    });
  });

  $effect(() => {
    activeView;
    requestActiveView();
  });

  $effect(() => {
    notesDatabaseSession.revision;
    if (busy) return;
    if (viewSettingsOpen) return;
    void loadTemplates(false);
  });

  async function loadTemplates(force = true): Promise<void> {
    const sourceId = dataSourceId;
    try {
      const loaded = await notesDatabaseSession.load(databaseResource("templates", sourceId), () => listNotesDataSourceTemplates(sourceId), force);
      if (sourceId !== dataSourceId) return;
      templates = loaded;
      templateError = null;
    } catch (caught) {
      templateError = caught instanceof Error ? caught.message : String(caught);
    }
  }

  async function reloadViews(preferredId: string | null, force = true): Promise<void> {
    if (!databaseId) return;
    const request = ++metadataRequest;
    const sourceId = dataSourceId;
    const shellId = databaseId;
    const previousSelection = selectedViewId;
    try {
      const loaded = await notesDatabaseSession.load(databaseResource("views", sourceId, { databaseId: shellId }), () => listNotesDatabaseViews(shellId), force);
      if (request !== metadataRequest) return;
      views = loaded;
      const preferred = selectedViewId !== previousSelection ? selectedViewId : preferredId;
      selectedViewId = loaded.some((view) => view.id === preferred)
        ? preferred
        : loaded.some((view) => view.id === selectedViewId)
          ? selectedViewId
          : loaded[0]?.id ?? null;
      viewError = null;
    } catch (caught) {
      if (request !== metadataRequest) return;
      viewError = caught instanceof Error ? caught.message : String(caught);
    }
  }

  function requestActiveView(retry = false): void {
    if (!retry && viewLoadState?.key === activeView) return;
    const kind = activeView;
    const component = readNotesDatabaseView(kind);
    if (component) {
      viewLoadState = { key: kind, status: "ready", requestId: (viewLoadState?.requestId ?? 0) + 1, component };
      return;
    }
    const loadingState = beginLazyComponentLoad(viewLoadState, kind);
    viewLoadState = loadingState;
    const request = retry ? retryNotesDatabaseView(kind) : loadNotesDatabaseView(kind);
    void request.then((component) => {
      if (!viewLoadState) return;
      viewLoadState = resolveLazyComponentLoad(viewLoadState, kind, loadingState.requestId, component);
    }).catch((error: unknown) => {
      if (!viewLoadState) return;
      viewLoadState = rejectLazyComponentLoad(viewLoadState, kind, loadingState.requestId, error);
      console.error(`load Notes ${kind} database view failed`, error);
    });
  }

  function viewLabel(view: NotesDatabaseViewKind): string {
    if (view === "table") return t("notes.databaseViewTable");
    if (view === "board") return t("notes.databaseViewBoard");
    if (view === "gallery") return t("notes.databaseViewGallery");
    if (view === "list") return t("notes.databaseViewList");
    if (view === "calendar") return t("notes.databaseViewCalendar");
    return t("notes.databaseViewTimeline");
  }

  async function seedView(kind: NotesDatabaseViewKind): Promise<NotesDatabaseView> {
    const scope = { databaseId, viewId: null };
    if (kind === "table") return (await getNotesDataSourceTableView(dataSourceId, scope)).view;
    if (kind === "board") return (await getNotesDataSourceBoardView(dataSourceId, scope)).view;
    if (kind === "gallery") return (await getNotesDataSourceGalleryView(dataSourceId, scope)).view;
    if (kind === "list") return (await getNotesDataSourceListView(dataSourceId, scope)).view;
    if (kind === "calendar") return (await getNotesDataSourceCalendarView(dataSourceId, scope)).view;
    return (await getNotesDataSourceTimelineView(dataSourceId, scope)).view;
  }

  async function addView(kind: NotesDatabaseViewKind): Promise<void> {
    if (!databaseId || busy) return;
    busy = true;
    viewError = null;
    try {
      const existing = supportedViews.find((view) => view.type === kind);
      const created = existing
        ? await duplicateNotesDatabaseView({ id: crypto.randomUUID(), database_id: databaseId, source_view_id: existing.id, name: t("notes.databaseViewCopyName", existing.name) })
        : await seedView(kind);
      await reloadViews(created.id);
    } catch (caught) {
      viewError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }

  async function duplicateView(): Promise<void> {
    const current = selectedView;
    if (!databaseId || !current || busy) return;
    busy = true;
    viewError = null;
    try {
      const duplicate = await duplicateNotesDatabaseView({
        id: crypto.randomUUID(), database_id: databaseId, source_view_id: current.id,
        name: t("notes.databaseViewCopyName", current.name),
      });
      await reloadViews(duplicate.id);
    } catch (caught) {
      viewError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }

  async function saveName(): Promise<void> {
    const current = selectedView;
    const name = nameDraft.trim();
    editingName = false;
    if (!databaseId || !current || busy) return;
    if (!name || name === current.name) {
      nameDraft = current.name;
      return;
    }
    busy = true;
    viewError = null;
    try {
      await renameNotesDatabaseView(databaseId, current.id, name);
      await reloadViews(current.id);
    } catch (caught) {
      viewError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }

  async function deleteView(): Promise<void> {
    const current = pendingDeleteView;
    pendingDeleteView = null;
    if (!databaseId || !current || busy || supportedViews.length < 2) return;
    busy = true;
    viewError = null;
    try {
      await deleteNotesDatabaseView(databaseId, current.id);
      await reloadViews(null);
    } catch (caught) {
      viewError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }

  function beginRename(): void {
    nameDraft = selectedView?.name ?? "";
    editingName = true;
    void tick().then(() => nameInput?.focus());
  }

  async function createNewRow(): Promise<void> {
    if (activeView === "table") {
      newRowRequest += 1;
      return;
    }
    if (busy) return;
    busy = true;
    viewError = null;
    try {
      const created = await createNotesDataSourceRowPage(dataSourceId, {
        id: crypto.randomUUID(),
        first_block_id: crypto.randomUUID(),
        title: t("notes.untitled"),
      });
      onSelectPage(created.page.id);
    } catch (caught) {
      viewError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }

  async function createFromTemplate(templateId: string): Promise<void> {
    if (busy) return;
    busy = true;
    viewError = null;
    try {
      const created = await applyNotesDataSourceTemplate(dataSourceId, templateId, { title: t("notes.untitled") });
      onSelectPage(created.page.id);
    } catch (caught) {
      viewError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }

  function openTemplateSettings(): void {
    const tableView = supportedViews.find((view) => view.type === "table");
    if (!tableView) return;
    selectedViewId = tableView.id;
    viewSettingsOpen = true;
  }
</script>

<div class="flex min-w-0 flex-wrap items-center gap-1 py-1">
  <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
    {#each shownViews as view (view.id)}
      {@const Icon = viewIcons[view.type as NotesDatabaseViewKind]}
      <CollectionViewButton label={view.name} active={activeViewId === view.id} onclick={() => { selectedViewId = view.id; viewSettingsOpen = false; }}>
        <Icon class="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      </CollectionViewButton>
    {/each}
    {#if overflowCount > 0}
      <CollectionMenu label={t("notes.databaseMoreViews", overflowCount)} kind="actions" showHeader={false} dismissOnAction>
        <input class="mb-2 h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring" aria-label={t("notes.databaseSearchViews")} placeholder={t("notes.databaseSearchViews")} bind:value={viewSearch} />
        <div class="grid gap-0.5">
          {#each searchableViews as view (view.id)}
            {@const Icon = viewIcons[view.type as NotesDatabaseViewKind]}
            <button type="button" class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left hover:bg-accent" onclick={() => { selectedViewId = view.id; viewSettingsOpen = false; }}>
              <Icon class="size-4 shrink-0" aria-hidden="true" /><span class="min-w-0 flex-1 truncate">{view.name}</span>
            </button>
          {/each}
        </div>
      </CollectionMenu>
    {/if}
    <CollectionMenu label={t("notes.databaseAddView")} kind="new" iconOnly showHeader={false} dismissOnAction>
      <p class="mb-2 text-muted-foreground">{t("notes.databaseAddView")}</p>
      <div class="grid grid-cols-2 gap-1">
        {#each NOTES_DATABASE_VIEW_KINDS as kind}
          {@const Icon = viewIcons[kind]}
          <button type="button" class="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg text-foreground hover:bg-accent" disabled={busy} onclick={() => { void addView(kind); }}>
            <Icon class="size-5" strokeWidth={1.75} aria-hidden="true" /><span>{viewLabel(kind)}</span>
          </button>
        {/each}
      </div>
      <div class="mt-3 border-t border-border pt-2">
        <button type="button" class="flex min-h-9 w-full items-center rounded-md px-2 text-left hover:bg-accent" onclick={onCreateLinkedDatabaseView}>{t("notes.databaseLinkedViewCreate")}</button>
      </div>
    </CollectionMenu>
    {#if selectedView}
      <CollectionMenu label={t("notes.databaseViewActions")} kind="actions" iconOnly showHeader={false}>
        {#if editingName}
          <input bind:this={nameInput} class="h-9 w-full rounded-md border border-border bg-background px-2 outline-none focus:border-ring" aria-label={t("notes.databaseViewName")} bind:value={nameDraft} onkeydown={(event) => { event.stopPropagation(); if (event.key === "Enter") void saveName(); if (event.key === "Escape") { nameDraft = selectedView?.name ?? ""; editingName = false; } }} onblur={() => { if (editingName) void saveName(); }} />
        {:else}
          <div class="grid gap-0.5">
            <button data-collection-menu-keep-open type="button" class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left hover:bg-accent" onclick={beginRename}><Pencil class="size-4" />{t("notes.databaseViewRename")}</button>
            <button type="button" class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left hover:bg-accent" onclick={() => { void duplicateView(); }}><Copy class="size-4" />{t("notes.databaseViewDuplicate")}</button>
            <button type="button" class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-destructive hover:bg-destructive/10" disabled={supportedViews.length < 2 || (selectedView.type === "table" && supportedViews.filter((view) => view.type === "table").length < 2)} onclick={() => { pendingDeleteView = selectedView; }}><Trash2 class="size-4" />{t("notes.databaseViewDelete")}</button>
          </div>
        {/if}
      </CollectionMenu>
    {/if}
  </div>
  <button type="button" class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={t("notes.databaseViewSettings")} title={t("notes.databaseViewSettings")} onclick={() => { if (activeView === "timeline") onEditProperties(); else viewSettingsOpen = true; }}><SlidersHorizontal class="size-4" aria-hidden="true" /></button>
  <div class="inline-flex shrink-0 items-center rounded-md bg-primary">
    <button type="button" class="min-h-8 rounded-l-md px-3 text-[0.866667rem] font-medium text-primary-foreground hover:bg-primary/90" disabled={busy} onclick={() => { void createNewRow(); }}>{t("notes.databaseNew")}</button>
    <span class="h-5 w-px bg-primary-foreground/25" aria-hidden="true"></span>
    <CollectionMenu label={t("notes.databaseNewOptions")} kind="new-options" iconOnly primary showHeader={false} dismissOnAction>
      <p class="mb-2 text-[0.8rem] font-medium text-muted-foreground">{t("notes.databaseTemplatesTitle")}</p>
      {#if templateError}<p class="mb-2 text-[0.8rem] text-destructive" role="alert">{templateError}</p>{/if}
      {#if templates.length === 0}
        <p class="mb-2 text-[0.8rem] text-muted-foreground">{t("notes.databaseTemplatesEmpty")}</p>
      {:else}
        <div class="grid gap-0.5">
          {#each templates as template (template.id)}
            <button type="button" class="min-h-9 rounded-md px-2 text-left hover:bg-accent" disabled={busy} onclick={() => { void createFromTemplate(template.id); }}>{template.name}</button>
          {/each}
        </div>
      {/if}
      <div class="mt-2 border-t border-border pt-2">
        <button type="button" class="min-h-9 w-full rounded-md px-2 text-left hover:bg-accent" onclick={openTemplateSettings}>{t("notes.databaseTemplatesManage")}</button>
      </div>
    </CollectionMenu>
  </div>
</div>

{#if pendingDeleteView}
  <ConfirmDialog
    message={t("notes.databaseViewDeleteConfirm", pendingDeleteView.name)}
    confirmLabel={t("notes.databaseViewDelete")}
    cancelLabel={t("common.cancel")}
    onConfirm={() => { void deleteView(); }}
    onCancel={() => { pendingDeleteView = null; }}
  />
{/if}

{#if viewError}
  <div class="my-2 flex items-center gap-2 text-[0.8rem] text-destructive" role="alert">
    <span>{viewError}</span>
    {#if !selectedView}
      <button type="button" class="rounded-md px-2 py-1 hover:bg-destructive/10" onclick={() => { void reloadViews(initialViewId); }}>{t("common.retry")}</button>
    {/if}
  </div>
{/if}

{#if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "table"}
  {@const NotesDatabaseTableView = viewLoadState.component.component}
  <NotesDatabaseTableView onSavingChange={(saving) => { layoutSaving = saving; }} {dataSourceId} {databaseId} viewId={activeViewId} {onSelectPage} {onAddProperty} {newRowRequest} settingsOpen={viewSettingsOpen} onCloseSettings={() => { viewSettingsOpen = false; }} {onEditProperties} reloadKey={reloadKeys.table} />
{:else if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "board"}
  {@const NotesDatabaseBoardView = viewLoadState.component.component}
  <NotesDatabaseBoardView onSavingChange={(saving) => { layoutSaving = saving; }} settingsOpen={viewSettingsOpen} onCloseSettings={() => { viewSettingsOpen = false; }} {onEditProperties} {dataSourceId} {databaseId} viewId={activeViewId} {onSelectPage} reloadKey={reloadKeys.board} />
{:else if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "gallery"}
  {@const NotesDatabaseGalleryView = viewLoadState.component.component}
  <NotesDatabaseGalleryView onSavingChange={(saving) => { layoutSaving = saving; }} settingsOpen={viewSettingsOpen} onCloseSettings={() => { viewSettingsOpen = false; }} {onEditProperties} {dataSourceId} {databaseId} viewId={activeViewId} {onSelectPage} reloadKey={reloadKeys.gallery} />
{:else if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "list"}
  {@const NotesDatabaseListView = viewLoadState.component.component}
  <NotesDatabaseListView onSavingChange={(saving) => { layoutSaving = saving; }} settingsOpen={viewSettingsOpen} onCloseSettings={() => { viewSettingsOpen = false; }} {onEditProperties} {dataSourceId} {databaseId} viewId={activeViewId} {onSelectPage} reloadKey={reloadKeys.list} />
{:else if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "calendar"}
  {@const NotesDatabaseCalendarView = viewLoadState.component.component}
  <NotesDatabaseCalendarView onSavingChange={(saving) => { layoutSaving = saving; }} settingsOpen={viewSettingsOpen} onCloseSettings={() => { viewSettingsOpen = false; }} {onEditProperties} {dataSourceId} {databaseId} viewId={activeViewId} {onSelectPage} reloadKey={reloadKeys.calendar} />
{:else if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "timeline"}
  {@const NotesDatabaseTimelineView = viewLoadState.component.component}
  <NotesDatabaseTimelineView onSavingChange={(saving) => { layoutSaving = saving; }} {dataSourceId} {databaseId} viewId={activeViewId} {onSelectPage} reloadKey={reloadKeys.timeline} />
{:else if viewLoadState?.status === "failed" && viewLoadState.key === activeView}
  <div class="my-3 rounded-md border border-destructive/40 p-3 text-[0.8rem] text-destructive" role="alert"><p>{t("common.viewLoadFailed", viewLabel(activeView))}</p><button class="mt-2 min-h-8 rounded-md border border-border px-2 text-foreground hover:bg-accent" type="button" onclick={() => requestActiveView(true)}>{t("common.retry")}</button></div>
{:else}
  <div class="my-3 text-[0.8rem] text-muted-foreground" aria-busy="true">{t("common.loading")}</div>
{/if}
