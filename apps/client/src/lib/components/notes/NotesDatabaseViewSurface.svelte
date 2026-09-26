<script lang="ts">
  import Table2 from "@lucide/svelte/icons/table-2";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import ChartGantt from "@lucide/svelte/icons/chart-gantt";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    NOTES_DATABASE_VIEW_KINDS,
    type NotesDatabaseViewKind,
  } from "$lib/notes/contracts/database/base";
  import {
    beginLazyComponentLoad,
    rejectLazyComponentLoad,
    resolveLazyComponentLoad,
    type LazyComponentLoadState,
  } from "$lib/lazy-component-loader";
  import {
    loadNotesDatabaseView,
    retryNotesDatabaseView,
    type LoadedNotesDatabaseView,
  } from "./notes-editor-component-registry";

  let {
    activeView,
    dataSourceId,
    databaseId,
    viewId,
    reloadKeys,
    onSelectPage,
    onActiveViewChange,
  }: {
    activeView: NotesDatabaseViewKind;
    dataSourceId: string;
    databaseId: string | null;
    viewId: string | null;
    reloadKeys: Record<NotesDatabaseViewKind, number>;
    onSelectPage: (pageId: string) => void;
    onActiveViewChange: (view: NotesDatabaseViewKind) => void;
  } = $props();

  const { t } = getLocalization();
  let viewLoadState = $state<LazyComponentLoadState<
    NotesDatabaseViewKind,
    LoadedNotesDatabaseView
  > | null>(null);

  function requestActiveView(retry = false): void {
    if (!retry && viewLoadState?.key === activeView) return;
    const kind = activeView;
    const loadingState = beginLazyComponentLoad(viewLoadState, kind);
    viewLoadState = loadingState;
    const request = retry ? retryNotesDatabaseView(kind) : loadNotesDatabaseView(kind);
    void request.then((component) => {
      if (!viewLoadState) return;
      viewLoadState = resolveLazyComponentLoad(
        viewLoadState,
        kind,
        loadingState.requestId,
        component,
      );
    }).catch((error: unknown) => {
      if (!viewLoadState) return;
      viewLoadState = rejectLazyComponentLoad(
        viewLoadState,
        kind,
        loadingState.requestId,
        error,
      );
      console.error(`load Notes ${kind} database view failed`, error);
    });
  }

  $effect(() => {
    activeView;
    requestActiveView();
  });

  function viewLabel(view: NotesDatabaseViewKind): string {
    if (view === "table") return t("notes.databaseViewTable");
    if (view === "board") return t("notes.databaseViewBoard");
    if (view === "gallery") return t("notes.databaseViewGallery");
    if (view === "list") return t("notes.databaseViewList");
    if (view === "calendar") return t("notes.databaseViewCalendar");
    return t("notes.databaseViewTimeline");
  }

  function viewTabClass(view: NotesDatabaseViewKind): string {
    const base = "inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[0.8rem] font-medium transition-colors";
    return activeView === view
      ? `${base} border-foreground text-foreground`
      : `${base} border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground`;
  }
</script>

<div class="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border">
  {#each NOTES_DATABASE_VIEW_KINDS as view}
    {@const Icon = view === "table" ? Table2 : view === "board" ? Columns3 : view === "gallery" ? LayoutGrid : view === "list" ? List : view === "calendar" ? CalendarDays : ChartGantt}
    <button
      type="button"
      class={viewTabClass(view)}
      aria-pressed={activeView === view}
      onclick={() => {
        onActiveViewChange(view);
      }}
    >
      <Icon class="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      {viewLabel(view)}
    </button>
  {/each}
</div>

{#if viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "table"}
  {@const NotesDatabaseTableView = viewLoadState.component.component}
  <NotesDatabaseTableView
    {dataSourceId}
    {databaseId}
    {viewId}
    {onSelectPage}
    reloadKey={reloadKeys.table}
  />
{:else if viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "board"}
  {@const NotesDatabaseBoardView = viewLoadState.component.component}
  <NotesDatabaseBoardView
    {dataSourceId}
    {databaseId}
    {viewId}
    {onSelectPage}
    reloadKey={reloadKeys.board}
  />
{:else if viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "gallery"}
  {@const NotesDatabaseGalleryView = viewLoadState.component.component}
  <NotesDatabaseGalleryView
    {dataSourceId}
    {databaseId}
    {viewId}
    {onSelectPage}
    reloadKey={reloadKeys.gallery}
  />
{:else if viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "list"}
  {@const NotesDatabaseListView = viewLoadState.component.component}
  <NotesDatabaseListView
    {dataSourceId}
    {databaseId}
    {viewId}
    {onSelectPage}
    reloadKey={reloadKeys.list}
  />
{:else if viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "calendar"}
  {@const NotesDatabaseCalendarView = viewLoadState.component.component}
  <NotesDatabaseCalendarView
    {dataSourceId}
    {databaseId}
    {viewId}
    {onSelectPage}
    reloadKey={reloadKeys.calendar}
  />
{:else if viewLoadState?.status === "ready" && viewLoadState.key === activeView && viewLoadState.component.kind === "timeline"}
  {@const NotesDatabaseTimelineView = viewLoadState.component.component}
  <NotesDatabaseTimelineView
    {dataSourceId}
    {databaseId}
    {viewId}
    {onSelectPage}
    reloadKey={reloadKeys.timeline}
  />
{:else if viewLoadState?.status === "failed" && viewLoadState.key === activeView}
  <div class="my-3 rounded-md border border-destructive/40 p-3 text-[0.8rem] text-destructive" role="alert">
    <p>{t("common.viewLoadFailed", viewLabel(activeView))}</p>
    <button
      class="mt-2 min-h-8 rounded-md border border-border px-2 text-foreground hover:bg-accent"
      type="button"
      onclick={() => requestActiveView(true)}
    >
      {t("common.retry")}
    </button>
  </div>
{:else}
  <div class="my-3 text-[0.8rem] text-muted-foreground" aria-busy="true">
    {t("common.loading")}
  </div>
{/if}
