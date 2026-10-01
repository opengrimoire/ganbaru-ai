<script lang="ts">
  import NotesLoadingSkeleton from "./NotesLoadingSkeleton.svelte";
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
  import Database from "@lucide/svelte/icons/database";
  import Lock from "@lucide/svelte/icons/lock";
  import LockOpen from "@lucide/svelte/icons/lock-open";
  import type { NotesDatabasePropertyActionRequest, NotesDatabaseSourceEditingScope } from "$lib/notes/data-source-schema";
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
    listNotesDataSources,
    createNotesDataSource,
    attachNotesDataSource,
    setNotesDatabaseEditingLock,
  } from "$lib/api/notes";
  import {
    NOTES_DATABASE_VIEW_KINDS,
    type NotesDatabaseView,
    type NotesDatabaseViewKind,
    type NotesDataSourceTemplate,
    type NotesDataSourcePropertyType,
    type NotesDataSource,
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
    onPropertyAction,
    editingLocked = false,
    onEditingLockChange = () => {},
    onSavingChange = () => {},
    onReady = () => {},
  }: {
    dataSourceId: string;
    databaseId: string | null;
    initialViewId: string | null;
    reloadKeys: Record<NotesDatabaseViewKind, number>;
    onSelectPage: (pageId: string) => void;
    onEditProperties: (propertyId?: string, anchor?: HTMLElement | null, scope?: NotesDatabaseSourceEditingScope) => void;
    onCreateLinkedDatabaseView: () => void;
    onAddProperty: (type: NotesDataSourcePropertyType, name: string, scope?: NotesDatabaseSourceEditingScope) => Promise<void>;
    onPropertyAction?: (request: NotesDatabasePropertyActionRequest, scope: NotesDatabaseSourceEditingScope) => Promise<void>;
    editingLocked?: boolean;
    onEditingLockChange?: (locked: boolean) => void;
    onSavingChange?: (saving: boolean) => void;
    onReady?: () => void;
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
  let selectionKey = untrack(() => databaseId ?? dataSourceId);
  let viewError = $state<string | null>(null);
  let busy = $state(false);
  let layoutSavingState = $state<{ reporter: (saving: boolean) => void; saving: boolean } | null>(null);

  $effect(() => {
    onSavingChange(busy || layoutSaving);
    return () => onSavingChange(false);
  });

  $effect(() => { if (viewError || viewLoadState?.status === "failed") onReady(); });
  let editingName = $state(false);
  let nameInput: HTMLInputElement | null = $state(null);
  let nameDraft = $state("");
  let viewSearch = $state("");
  let viewSettingsOpen = $state(false);
  let settingsAnchor: HTMLButtonElement | null = $state(null);
  let newRowRequestState = $state<{ reporter: (saving: boolean) => void; count: number } | null>(null);
  let templates = $state<NotesDataSourceTemplate[]>(untrack(() => notesDatabaseSession.read(databaseResource("templates", dataSourceId)) ?? []));
  let templateSourceId = $state(untrack(() => dataSourceId));
  let templateError = $state<string | null>(null);
  let pendingDeleteView = $state<NotesDatabaseView | null>(null);
  let lastDatabaseId = $state<string | null>(null);
  let metadataRequest = 0;
  let dataSources = $state<NotesDataSource[]>([]);
  let sourcesLoading = $state(false);
  let sourceName = $state("");
  let sourceError = $state<string | null>(null);
  let sourceRequest = 0;
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
  const activeSourceId = $derived(selectedView?.data_source_id ?? dataSourceId);
  const activeSource = $derived(dataSources.find((source) => source.id === activeSourceId));
  const attachedSourceIds = $derived(new Set(views.map((view) => view.data_source_id)));
  const attachedSources = $derived(dataSources.filter((source) => attachedSourceIds.has(source.id)));
  const otherSources = $derived(dataSources.filter((source) => !attachedSourceIds.has(source.id)));
  const layoutInstance = $derived.by(() => {
    const identity = JSON.stringify([activeSourceId, databaseId, activeViewId, activeView]);
    const reportSaving = (saving: boolean): void => {
      if (layoutInstance.reportSaving !== reportSaving) return;
      layoutSavingState = { reporter: reportSaving, saving };
    };
    return { identity, reportSaving };
  });
  const layoutSaving = $derived(layoutSavingState?.reporter === layoutInstance.reportSaving && layoutSavingState.saving);
  const selectionDisabled = $derived(busy || layoutSaving);
  const newRowRequest = $derived(newRowRequestState?.reporter === layoutInstance.reportSaving ? newRowRequestState.count : 0);
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

  /** Follow live preselection while retaining the mounted view if its cached entry expires. */
  $effect(() => {
    const key = databaseId ?? dataSourceId;
    const remembered = notesDatabaseSession.recall(key)?.viewId;
    if (selectionKey !== key) {
      selectionKey = key;
      selectedViewId = remembered ?? initialViewId;
    } else if (remembered && remembered !== selectedViewId) selectedViewId = remembered;
  });

  /** Select a view locally and synchronize other renderers of the same database. */
  function selectView(viewId: string, closeSettings = true): void {
    selectedViewId = viewId;
    notesDatabaseSession.selectView(databaseId ?? dataSourceId, viewId);
    if (closeSettings) viewSettingsOpen = false;
  }

  /** Keep toolbar navigation on the current saved view until its pending write settles. */
  function selectViewFromToolbar(viewId: string): void {
    if (selectionDisabled) return;
    selectView(viewId);
  }

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

  $effect(() => { if (viewSettingsOpen) void loadSources(); });
  $effect(() => {
    if (templateSourceId === activeSourceId) return;
    templateSourceId = activeSourceId;
    templates = notesDatabaseSession.read(databaseResource("templates", activeSourceId)) ?? [];
    templateError = null;
  });

  async function loadSources(): Promise<void> {
    const request = ++sourceRequest;
    sourcesLoading = true;
    try {
      const loaded = await listNotesDataSources();
      if (request !== sourceRequest) return;
      dataSources = loaded;
      sourceError = null;
    } catch (caught: unknown) {
      if (request === sourceRequest) sourceError = caught instanceof Error ? caught.message : String(caught);
    } finally { if (request === sourceRequest) sourcesLoading = false; }
  }

  async function manageSource(sourceId?: string): Promise<void> {
    if (!databaseId || selectionDisabled || editingLocked || (!sourceId && !sourceName.trim())) return;
    busy = true;
    sourceError = null;
    try {
      const result = sourceId
        ? await attachNotesDataSource({ data_source_id: sourceId, database_id: databaseId, view_id: crypto.randomUUID(), view_name: viewLabel("table") })
        : await createNotesDataSource({ id: crypto.randomUUID(), database_id: databaseId, view_id: crypto.randomUUID(), title: sourceName.trim(), view_name: viewLabel("table") });
      await reloadViews(result.view.id);
      sourceName = "";
      await loadSources();
    } catch (caught: unknown) { sourceError = caught instanceof Error ? caught.message : String(caught); }
    finally { busy = false; }
  }

  async function toggleEditingLock(): Promise<void> {
    if (!databaseId || selectionDisabled) return;
    busy = true;
    viewError = null;
    try {
      const reference = await setNotesDatabaseEditingLock(databaseId, !editingLocked);
      onEditingLockChange(reference.editing_locked);
    } catch (caught: unknown) { viewError = caught instanceof Error ? caught.message : String(caught); }
    finally { busy = false; }
  }

  function editingScope(): NotesDatabaseSourceEditingScope {
    return { dataSourceId: activeSourceId, databaseId, viewId: activeViewId };
  }

  async function loadTemplates(force = true): Promise<void> {
    const sourceId = activeSourceId;
    try {
      const loaded = await notesDatabaseSession.load(databaseResource("templates", sourceId), () => listNotesDataSourceTemplates(sourceId), force);
      if (sourceId !== activeSourceId) return;
      templates = loaded;
      templateError = null;
    } catch (caught) {
      if (sourceId !== activeSourceId) return;
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
      const nextViewId = loaded.some((view) => view.id === preferred)
        ? preferred
        : loaded.some((view) => view.id === selectedViewId)
          ? selectedViewId
          : loaded[0]?.id ?? null;
      if (nextViewId) selectView(nextViewId, false);
      viewError = null;
    } catch (caught) {
      if (request !== metadataRequest) return;
      viewError = caught instanceof Error ? caught.message : String(caught);
    }
  }

  function requestActiveView(retry = false): void {
    if (!selectedView) return;
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
    if (kind === "table") return (await getNotesDataSourceTableView(activeSourceId, scope)).view;
    if (kind === "board") return (await getNotesDataSourceBoardView(activeSourceId, scope)).view;
    if (kind === "gallery") return (await getNotesDataSourceGalleryView(activeSourceId, scope)).view;
    if (kind === "list") return (await getNotesDataSourceListView(activeSourceId, scope)).view;
    if (kind === "calendar") return (await getNotesDataSourceCalendarView(activeSourceId, scope)).view;
    return (await getNotesDataSourceTimelineView(activeSourceId, scope)).view;
  }

  async function addView(kind: NotesDatabaseViewKind): Promise<void> {
    if (!databaseId || selectionDisabled || editingLocked) return;
    busy = true;
    viewError = null;
    try {
      const existing = supportedViews.find((view) => view.type === kind && view.data_source_id === activeSourceId);
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
    if (!databaseId || !current || selectionDisabled || editingLocked) return;
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
    if (!databaseId || !current || busy || editingLocked) return;
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
    if (!databaseId || !current || selectionDisabled || editingLocked || supportedViews.length < 2) return;
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
    if (selectionDisabled || editingLocked) return;
    nameDraft = selectedView?.name ?? "";
    editingName = true;
    void tick().then(() => nameInput?.focus());
  }

  async function createNewRow(): Promise<void> {
    if (activeView === "table") {
      newRowRequestState = { reporter: layoutInstance.reportSaving, count: newRowRequest + 1 };
      return;
    }
    if (busy) return;
    busy = true;
    viewError = null;
    try {
      const created = await createNotesDataSourceRowPage(activeSourceId, {
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
      const created = await applyNotesDataSourceTemplate(activeSourceId, templateId, { title: t("notes.untitled") });
      onSelectPage(created.page.id);
    } catch (caught) {
      viewError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }

  function openTemplateSettings(): void {
    if (selectionDisabled) return;
    const tableView = supportedViews.find((view) => view.type === "table" && view.data_source_id === activeSourceId);
    if (!tableView) return;
    selectView(tableView.id);
    viewSettingsOpen = true;
  }

  /** Open source schema editing at the requested property, beside the database toolbar. */
  function editProperties(propertyId?: string): void {
    if (editingLocked) return;
    viewSettingsOpen = false;
    onEditProperties(propertyId, settingsAnchor, editingScope());
  }
</script>

{#snippet settingsHeader()}
  {#if selectedView}
    {@const Icon = viewIcons[selectedView.type as NotesDatabaseViewKind]}
    <div class="mb-1 flex min-w-0 items-center gap-2 rounded-md border border-border/60 px-2">
      <Icon class="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
      <input class="h-8 min-w-0 flex-1 bg-transparent outline-none" aria-label={t("notes.databaseViewName")} value={selectedView.name} disabled={selectionDisabled || editingLocked}
        onblur={(event) => { nameDraft = event.currentTarget.value; void saveName(); }}
        onkeydown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
    </div>
  {/if}
  <CollectionMenu fullWidth label={t("notes.databaseSources")} summary={activeSource?.title ?? ""} kind="properties" icon={Database} disabled={selectionDisabled}>
    <div class="grid gap-2">
      {#if sourceError}<p class="text-destructive" role="alert">{sourceError}</p>{/if}
      {#if sourcesLoading}<p class="text-muted-foreground" role="status">{t("notes.databaseSourcesLoading")}</p>{/if}
      <p class="text-muted-foreground">{t("notes.databaseSourcesAttached")}</p>
      {#each attachedSources as source (source.id)}
        <button type="button" class="flex min-h-8 min-w-0 items-center gap-2 rounded-sm px-2 text-left hover:bg-accent" disabled={selectionDisabled}
          aria-pressed={source.id === activeSourceId} onclick={() => {
            const view = supportedViews.find((candidate) => candidate.data_source_id === source.id && candidate.type === activeView)
              ?? supportedViews.find((candidate) => candidate.data_source_id === source.id);
            if (view) selectViewFromToolbar(view.id);
          }}><Database class="size-3.5 shrink-0 text-muted-foreground" /><span class="min-w-0 flex-1 truncate">{source.title || t("notes.databaseSourcesUnnamed")}</span>
          <span class="shrink-0 text-muted-foreground">{t(source.parent.database_id === databaseId ? "notes.databaseSourceOwned" : "notes.databaseSourceLinked")}</span></button>
      {/each}
      <div class="grid gap-1.5 border-t border-border pt-2">
        <label class="grid gap-1 text-muted-foreground">{t("notes.databaseSourceName")}
          <input class="h-8 min-w-0 rounded-sm border border-input bg-background px-2 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring" aria-label={t("notes.databaseSourceName")} bind:value={sourceName} disabled={selectionDisabled || editingLocked} />
        </label>
        <button type="button" class="min-h-8 rounded-sm px-2 text-left hover:bg-accent" disabled={selectionDisabled || editingLocked || !sourceName.trim()}
          onclick={() => { void manageSource(); }}>{t("notes.databaseSourceCreate")}</button>
      </div>
      <div class="grid gap-1 border-t border-border pt-2">
        <p class="text-muted-foreground">{t("notes.databaseSourceAttach")}</p>
        {#each otherSources as source (source.id)}
          <button type="button" class="min-h-8 truncate rounded-sm px-2 text-left hover:bg-accent" disabled={selectionDisabled || editingLocked}
            onclick={() => { void manageSource(source.id); }}>{source.title || t("notes.databaseSourcesUnnamed")}</button>
        {/each}
        {#if otherSources.length === 0 && !sourcesLoading}<p class="px-2 text-muted-foreground">{t("notes.databaseSourceNoOtherSources")}</p>{/if}
      </div>
      <p class="text-muted-foreground">{t("notes.databaseSourceSharedDescription")}</p>
    </div>
  </CollectionMenu>
  <button type="button" role="switch" aria-checked={editingLocked} aria-label={t("notes.databaseEditingLock")} disabled={selectionDisabled}
    class="flex min-h-8 w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-accent" onclick={() => { void toggleEditingLock(); }}>
    {#if editingLocked}<Lock class="size-3.5 text-muted-foreground" />{:else}<LockOpen class="size-3.5 text-muted-foreground" />{/if}
    <span>{t(editingLocked ? "notes.databaseUnlockLayout" : "notes.databaseLockLayout")}</span>
  </button>
  {#if editingLocked}<p class="px-2 text-muted-foreground">{t("notes.databaseEditingLockDescription")}</p>{/if}
{/snippet}

<div class="flex min-w-0 flex-wrap items-center gap-1 py-1">
  <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
    {#each shownViews as view (view.id)}
      {@const Icon = viewIcons[view.type as NotesDatabaseViewKind]}
      <CollectionViewButton label={view.name} active={activeViewId === view.id} disabled={selectionDisabled} onclick={() => selectViewFromToolbar(view.id)}>
        <Icon class="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      </CollectionViewButton>
    {/each}
    {#if overflowCount > 0}
      <CollectionMenu label={t("notes.databaseMoreViews", overflowCount)} kind="actions" showHeader={false} dismissOnAction disabled={selectionDisabled}>
        <input class="mb-1.5 h-8 w-full rounded border border-border bg-background px-2 text-[length:inherit] outline-none focus:border-ring" aria-label={t("notes.databaseSearchViews")} placeholder={t("notes.databaseSearchViews")} bind:value={viewSearch} />
        <div class="grid gap-0.5">
          {#each searchableViews as view (view.id)}
            {@const Icon = viewIcons[view.type as NotesDatabaseViewKind]}
            <button type="button" class="flex min-h-8 items-center gap-2 rounded px-2 text-left hover:bg-accent" disabled={selectionDisabled} onclick={() => selectViewFromToolbar(view.id)}>
              <Icon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span class="min-w-0 flex-1 truncate">{view.name}</span>
            </button>
          {/each}
        </div>
      </CollectionMenu>
    {/if}
    <CollectionMenu label={t("notes.databaseAddView")} kind="new" iconOnly showHeader={false} dismissOnAction disabled={selectionDisabled || editingLocked}>
      <p class="mb-2 text-muted-foreground">{t("notes.databaseAddView")}</p>
      <div class="grid grid-cols-2 gap-1">
        {#each NOTES_DATABASE_VIEW_KINDS as kind}
          {@const Icon = viewIcons[kind]}
          <button type="button" class="flex min-h-9 items-center gap-2 rounded px-2 text-left text-foreground hover:bg-accent" disabled={selectionDisabled || editingLocked} onclick={() => { void addView(kind); }}>
            <Icon class="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" /><span>{viewLabel(kind)}</span>
          </button>
        {/each}
      </div>
      <div class="mt-3 border-t border-border pt-2">
        <button type="button" class="flex min-h-9 w-full items-center rounded-md px-2 text-left hover:bg-accent" onclick={onCreateLinkedDatabaseView}>{t("notes.databaseLinkedViewCreate")}</button>
      </div>
    </CollectionMenu>
    {#if selectedView}
      <CollectionMenu label={t("notes.databaseViewActions")} kind="actions" iconOnly showHeader={false} disabled={selectionDisabled}>
        {#if editingName}
          <input bind:this={nameInput} class="h-9 w-full rounded-md border border-border bg-background px-2 outline-none focus:border-ring" aria-label={t("notes.databaseViewName")} bind:value={nameDraft} onkeydown={(event) => { event.stopPropagation(); if (event.key === "Enter") void saveName(); if (event.key === "Escape") { nameDraft = selectedView?.name ?? ""; editingName = false; } }} onblur={() => { if (editingName) void saveName(); }} />
        {:else}
          <div class="grid gap-0.5">
            <button data-collection-menu-keep-open type="button" class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left hover:bg-accent" disabled={editingLocked} onclick={beginRename}><Pencil class="size-4" />{t("notes.databaseViewRename")}</button>
            <button type="button" class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left hover:bg-accent" disabled={editingLocked} onclick={() => { void duplicateView(); }}><Copy class="size-4" />{t("notes.databaseViewDuplicate")}</button>
            <button type="button" class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-destructive hover:bg-destructive/10" disabled={editingLocked || supportedViews.length < 2 || (selectedView.type === "table" && supportedViews.filter((view) => view.data_source_id === activeSourceId && view.type === "table").length < 2)} onclick={() => { pendingDeleteView = selectedView; }}><Trash2 class="size-4" />{t("notes.databaseViewDelete")}</button>
          </div>
        {/if}
      </CollectionMenu>
    {/if}
  </div>
  <button bind:this={settingsAnchor} type="button" class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" class:bg-accent={viewSettingsOpen} aria-label={t("notes.databaseViewSettings")} aria-haspopup="dialog" aria-expanded={viewSettingsOpen} title={t("notes.databaseViewSettings")} onclick={() => { viewSettingsOpen = !viewSettingsOpen; }}><SlidersHorizontal class="size-4" aria-hidden="true" /></button>
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
        <button type="button" class="min-h-9 w-full rounded-md px-2 text-left hover:bg-accent" disabled={selectionDisabled} onclick={openTemplateSettings}>{t("notes.databaseTemplatesManage")}</button>
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

{#key layoutInstance.identity}
{@const reportLayoutSaving = untrack(() => layoutInstance.reportSaving)}
{#if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "table"}
  {@const NotesDatabaseTableView = viewLoadState.component.component}
  <NotesDatabaseTableView {onReady} onSavingChange={reportLayoutSaving} dataSourceId={activeSourceId} {databaseId} viewId={activeViewId} {onSelectPage} {editingLocked} onAddProperty={(type, name) => onAddProperty(type, name, editingScope())} onPropertyAction={onPropertyAction ? (request) => onPropertyAction?.(request, editingScope()) ?? Promise.resolve() : undefined} {newRowRequest} settingsOpen={viewSettingsOpen} {settingsAnchor} {settingsHeader} onCloseSettings={() => { viewSettingsOpen = false; }} onEditProperties={editProperties} reloadKey={reloadKeys.table} />
{:else if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "board"}
  {@const NotesDatabaseBoardView = viewLoadState.component.component}
  <NotesDatabaseBoardView {onReady} onSavingChange={reportLayoutSaving} settingsOpen={viewSettingsOpen} {settingsAnchor} {settingsHeader} onCloseSettings={() => { viewSettingsOpen = false; }} onEditProperties={editProperties} dataSourceId={activeSourceId} {databaseId} {editingLocked} viewId={activeViewId} {onSelectPage} reloadKey={reloadKeys.board} />
{:else if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "gallery"}
  {@const NotesDatabaseGalleryView = viewLoadState.component.component}
  <NotesDatabaseGalleryView {onReady} onSavingChange={reportLayoutSaving} settingsOpen={viewSettingsOpen} {settingsAnchor} {settingsHeader} onCloseSettings={() => { viewSettingsOpen = false; }} onEditProperties={editProperties} dataSourceId={activeSourceId} {databaseId} {editingLocked} viewId={activeViewId} {onSelectPage} reloadKey={reloadKeys.gallery} />
{:else if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "list"}
  {@const NotesDatabaseListView = viewLoadState.component.component}
  <NotesDatabaseListView {onReady} onSavingChange={reportLayoutSaving} settingsOpen={viewSettingsOpen} {settingsAnchor} {settingsHeader} onCloseSettings={() => { viewSettingsOpen = false; }} onEditProperties={editProperties} dataSourceId={activeSourceId} {databaseId} {editingLocked} viewId={activeViewId} {onSelectPage} reloadKey={reloadKeys.list} />
{:else if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "calendar"}
  {@const NotesDatabaseCalendarView = viewLoadState.component.component}
  <NotesDatabaseCalendarView {onReady} onSavingChange={reportLayoutSaving} settingsOpen={viewSettingsOpen} {settingsAnchor} {settingsHeader} onCloseSettings={() => { viewSettingsOpen = false; }} onEditProperties={editProperties} dataSourceId={activeSourceId} {databaseId} {editingLocked} viewId={activeViewId} {onSelectPage} reloadKey={reloadKeys.calendar} />
{:else if selectedView && viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "timeline"}
  {@const NotesDatabaseTimelineView = viewLoadState.component.component}
  <NotesDatabaseTimelineView settingsOpen={viewSettingsOpen} {settingsAnchor} {settingsHeader} onCloseSettings={() => { viewSettingsOpen = false; }} onEditProperties={editProperties} {onReady} onSavingChange={reportLayoutSaving} dataSourceId={activeSourceId} {databaseId} {editingLocked} viewId={activeViewId} {onSelectPage} reloadKey={reloadKeys.timeline} />
{:else if viewLoadState?.status === "failed" && viewLoadState.key === activeView}
  <div class="my-3 rounded-md border border-destructive/40 p-3 text-[0.8rem] text-destructive" role="alert"><p>{t("common.viewLoadFailed", viewLabel(activeView))}</p><button class="mt-2 min-h-8 rounded-md border border-border px-2 text-foreground hover:bg-accent" type="button" onclick={() => requestActiveView(true)}>{t("common.retry")}</button></div>
{:else}
  <NotesLoadingSkeleton kind={activeView} />
{/if}
{/key}
