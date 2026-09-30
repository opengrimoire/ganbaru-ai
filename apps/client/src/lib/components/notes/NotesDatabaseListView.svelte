<script lang="ts">
  import NotesLoadingSkeleton from "./NotesLoadingSkeleton.svelte";
  import { untrack } from "svelte";
  import { databaseResource, notesDatabaseSession } from "$lib/notes/database-session.svelte";
  import NotesDatabasePropertyValue from "./NotesDatabasePropertyValue.svelte";
  import CollectionSettings from "$lib/components/collections/CollectionSettings.svelte";
  import CollectionRow from "$lib/components/collections/CollectionRow.svelte";
  import CollectionCell from "$lib/components/collections/CollectionCell.svelte";
  import CollectionMenu from "$lib/components/collections/CollectionMenu.svelte";
  import CustomSelect from "$lib/components/settings/CustomSelect.svelte";
  import {
    createNotesDataSourceRowPage,
    duplicateNotesPage,
    getNotesDataSourceListView,
    trashNotesPage,
    updateNotesDataSourceListView,
  } from "$lib/api/notes";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    notesDatabaseListColumns,
    notesDatabaseListConfigurationFromView,
    notesDatabaseListFiltersFromView,
    notesDatabaseListGroupableColumns,
    notesDatabaseListGroups,
    notesDatabaseListRowText,
    notesDatabaseListRowTitle,
    notesDatabaseListSortsFromView,
    notesDatabaseListUpdate,
    notesDatabaseListVisibleColumns,
  } from "$lib/notes/database-list";
  import type { NotesDatabaseTableColumn } from "$lib/notes/database-table";
  import { mergeNotesDatabaseRows } from "$lib/notes/database-view-window";
  import NotesDatabaseWindowSentinel from "./NotesDatabaseWindowSentinel.svelte";
  import type {
    NotesDatabaseListConfiguration,
    NotesDatabaseListRowOpenMode,
    NotesDatabaseTableFilter,
    NotesDatabaseTableFilterCondition,
    NotesDatabaseTableSort,
    NotesDatabaseViewScope,
    NotesDataSourceListGroup,
    NotesDataSourceListView,
    NotesPage,
  } from "$lib/notes/types";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import FileText from "@lucide/svelte/icons/file-text";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  let {
    dataSourceId,
    databaseId = null,
    viewId = null,
    onSelectPage,
    onSavingChange = () => {},
    onReady = () => {},
    reloadKey = 0,
    settingsOpen = false,
    onCloseSettings,
    onEditProperties,
  }: {
    dataSourceId: string;
    databaseId?: string | null;
    viewId?: string | null;
    onSelectPage: (pageId: string) => void;
    onSavingChange?: (saving: boolean) => void;
    onReady?: () => void;
    reloadKey?: number;
    settingsOpen?: boolean;
    onCloseSettings: () => void;
    onEditProperties: () => void;
  } = $props();

  const { t } = getLocalization();
  const FILTER_CONDITIONS: NotesDatabaseTableFilterCondition[] = [
    "contains",
    "equals",
    "is_empty",
    "is_not_empty",
    "checked",
    "unchecked",
  ];

  let list = $state<NotesDataSourceListView | null>(untrack(() => notesDatabaseSession.read(databaseResource("list", dataSourceId, viewScope()))));
  let loading = $state(false);
  let loadingMore = $state(false);
  let requestId = 0;
  let mutating = $state(false);

  $effect(() => {
    onSavingChange(mutating);
    return () => onSavingChange(false);
  });
  let error = $state<string | null>(null);
  let draftTitle = $state("");
  let selectedPanelRowId = $state<string | null>(null);
  let lastLoadSignature = $state("");
  let lastReloadKey = untrack(() => reloadKey);

  const columns = $derived(list ? notesDatabaseListColumns(list.data_source, list.view) : []);
  const configuration = $derived(
    list ? notesDatabaseListConfigurationFromView(list.view) : defaultConfiguration(),
  );
  const groupableColumns = $derived(notesDatabaseListGroupableColumns(columns));
  const groupColumn = $derived(
    configuration.group_property_id
      ? groupableColumns.find((column) => column.id === configuration.group_property_id) ?? null
      : null,
  );
  const visibleColumns = $derived(notesDatabaseListVisibleColumns(columns, configuration));
  const filters = $derived(list ? notesDatabaseListFiltersFromView(list.view) : []);
  const sorts = $derived(list ? notesDatabaseListSortsFromView(list.view) : []);
  const groups = $derived(list ? notesDatabaseListGroups(list.rows, columns, configuration) : []);
  const visibleGroups = $derived(groups.filter((group) => !group.hidden));
  const hiddenGroups = $derived(groups.filter((group) => group.hidden));
  const selectedPanelRow = $derived(list?.rows.find((row) => row.id === selectedPanelRowId) ?? null);

  $effect(() => {
    const revision = notesDatabaseSession.revision;
    if (mutating) return;
    const signature = `${dataSourceId}:${databaseId ?? ""}:${viewId ?? ""}:${reloadKey}:${revision}`;
    if (signature === lastLoadSignature) return;
    const force = reloadKey !== lastReloadKey;
    lastReloadKey = reloadKey;
    lastLoadSignature = signature;
    void loadList(force);
  });

  function viewScope(): NotesDatabaseViewScope {
    return { databaseId, viewId };
  }

  $effect(() => { if (list || error) onReady(); });

  async function loadList(force = true): Promise<NotesDataSourceListView | null> {
    const currentRequest = ++requestId;
    loading = !list;
    loadingMore = false;
    error = null;
    try {
      const sourceId = dataSourceId;
      const scope = viewScope();
      const resource = databaseResource("list", sourceId, scope);
      const loaded = await notesDatabaseSession.load(resource, () => getNotesDataSourceListView(sourceId, scope), force);
      if (currentRequest !== requestId) return null;
      list = loaded;
      if (selectedPanelRowId && !loaded.rows.some((row) => row.id === selectedPanelRowId)) {
        selectedPanelRowId = null;
      }
      return loaded;
    } catch (caught) {
      if (currentRequest !== requestId) return null;
      error = caught instanceof Error ? caught.message : String(caught);
      return null;
    } finally {
      if (currentRequest === requestId) loading = false;
    }
  }

  async function loadMoreList(): Promise<void> {
    const current = list;
    if (!current?.has_more || !current.next_cursor || loadingMore) return;
    const currentRequest = requestId;
    const revision = notesDatabaseSession.revision;
    loadingMore = true;
    try {
      const loaded = await getNotesDataSourceListView(dataSourceId, viewScope(), {
        start_cursor: current.next_cursor,
      });
      if (currentRequest !== requestId || list !== current || revision !== notesDatabaseSession.revision) return;
      list = { ...loaded, rows: mergeNotesDatabaseRows(current.rows, loaded.rows) };
      notesDatabaseSession.write(databaseResource("list", dataSourceId, viewScope()), list);
    } catch (caught) {
      if (currentRequest === requestId) error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (currentRequest === requestId) loadingMore = false;
    }
  }

  async function persistList(
    nextConfiguration: NotesDatabaseListConfiguration,
    nextVisibleColumns = visibleColumns,
    nextFilters = filters,
    nextSorts = sorts,
  ): Promise<void> {
    if (!list) return;
    const resource = databaseResource("list", dataSourceId, viewScope());
    const epoch = notesDatabaseSession.epoch;
    mutating = true;
    error = null;
    try {
      list = await updateNotesDataSourceListView(
        dataSourceId,
        notesDatabaseListUpdate(nextConfiguration, nextVisibleColumns, nextFilters, nextSorts),
        viewScope(),
      );
      notesDatabaseSession.write(resource, list, epoch);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function createRow(): Promise<void> {
    const title = draftTitle.trim() || t("notes.untitled");
    mutating = true;
    error = null;
    try {
      const loaded = await createNotesDataSourceRowPage(dataSourceId, {
        id: crypto.randomUUID(),
        first_block_id: crypto.randomUUID(),
        title,
      });
      draftTitle = "";
      selectedPanelRowId = loaded.page.id;
      await loadList();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function duplicateRow(row: NotesPage): Promise<void> {
    mutating = true;
    error = null;
    try {
      const loaded = await duplicateNotesPage(row.id, {});
      selectedPanelRowId = loaded.page.id;
      await loadList();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function trashRow(row: NotesPage): Promise<void> {
    mutating = true;
    error = null;
    try {
      await trashNotesPage(row.id, true);
      if (selectedPanelRowId === row.id) selectedPanelRowId = null;
      await loadList();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  function updateGroupProperty(propertyId: string): void {
    const groupPropertyId = propertyId || null;
    const nextConfiguration: NotesDatabaseListConfiguration = {
      ...configuration,
      group_property_id: groupPropertyId,
      group_order: [],
      hidden_group_ids: [],
      visible_property_ids: configuration.visible_property_ids.filter((id) => id !== groupPropertyId),
    };
    const nextVisibleColumns = visibleColumns.filter((column) => column.id !== groupPropertyId);
    void persistList(nextConfiguration, nextVisibleColumns);
  }

  function updateRowOpenMode(mode: NotesDatabaseListRowOpenMode): void {
    void persistList({ ...configuration, row_open_mode: mode });
  }

  function updateRowProperty(columnId: string, visible: boolean): void {
    const byId = new Map(columns.map((column) => [column.id, column]));
    const nextIds = visible
      ? [...configuration.visible_property_ids, columnId]
      : configuration.visible_property_ids.filter((id) => id !== columnId);
    const nextVisibleColumns = nextIds
      .map((id) => byId.get(id))
      .filter((column): column is NotesDatabaseTableColumn =>
        column !== undefined && column.type !== "title" && column.id !== configuration.group_property_id
      );
    void persistList({ ...configuration, visible_property_ids: nextIds }, nextVisibleColumns);
  }

  function setGroupHidden(groupId: string, hidden: boolean): void {
    const hiddenGroupIds = hidden
      ? [...configuration.hidden_group_ids, groupId]
      : configuration.hidden_group_ids.filter((id) => id !== groupId);
    void persistList({ ...configuration, hidden_group_ids: uniqueStrings(hiddenGroupIds) });
  }

  function addSort(): void {
    const firstColumn = columns[0];
    if (!firstColumn) return;
    void persistList(configuration, visibleColumns, filters, [
      ...sorts,
      { property_id: firstColumn.id, direction: "ascending" },
    ]);
  }

  function updateSort(index: number, patch: Partial<NotesDatabaseTableSort>): void {
    const nextSorts = sorts.map((sort, sortIndex) =>
      sortIndex === index ? { ...sort, ...patch } : sort,
    );
    void persistList(configuration, visibleColumns, filters, nextSorts);
  }

  function removeSort(index: number): void {
    void persistList(
      configuration,
      visibleColumns,
      filters,
      sorts.filter((_, sortIndex) => sortIndex !== index),
    );
  }

  function addFilter(): void {
    const firstColumn = columns[0];
    if (!firstColumn) return;
    void persistList(configuration, visibleColumns, [
      ...filters,
      { property_id: firstColumn.id, condition: "contains", value: "" },
    ], sorts);
  }

  function updateFilter(index: number, patch: Partial<NotesDatabaseTableFilter>): void {
    const nextFilters = filters.map((filter, filterIndex) => {
      if (filterIndex !== index) return filter;
      const next = { ...filter, ...patch };
      if (!filterConditionNeedsValue(next.condition)) next.value = null;
      return next;
    });
    void persistList(configuration, visibleColumns, nextFilters, sorts);
  }

  function removeFilter(index: number): void {
    void persistList(
      configuration,
      visibleColumns,
      filters.filter((_, filterIndex) => filterIndex !== index),
      sorts,
    );
  }

  function openRow(row: NotesPage): void {
    if (configuration.row_open_mode === "side_panel") {
      selectedPanelRowId = row.id;
      return;
    }
    onSelectPage(row.id);
  }

  function rowTitle(row: NotesPage): string {
    return notesDatabaseListRowTitle(row, columns, t("notes.untitled"));
  }

  function filterConditionNeedsValue(condition: NotesDatabaseTableFilterCondition): boolean {
    return condition === "contains" || condition === "equals";
  }

  function filterConditionLabel(condition: NotesDatabaseTableFilterCondition): string {
    switch (condition) {
      case "contains":
        return t("notes.databaseTableFilterCondition.contains");
      case "equals":
        return t("notes.databaseTableFilterCondition.equals");
      case "is_empty":
        return t("notes.databaseTableFilterCondition.isEmpty");
      case "is_not_empty":
        return t("notes.databaseTableFilterCondition.isNotEmpty");
      case "checked":
        return t("notes.databaseTableFilterCondition.checked");
      case "unchecked":
        return t("notes.databaseTableFilterCondition.unchecked");
    }
  }

  function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function defaultConfiguration(): NotesDatabaseListConfiguration {
    return {
      group_property_id: null,
      group_order: [],
      hidden_group_ids: [],
      visible_property_ids: [],
      row_open_mode: "side_panel",
    };
  }
  const listTemplate = $derived(`minmax(12rem, 1fr) ${visibleColumns.map(() => "minmax(0, 1fr)").join(" ")} 2rem`);
</script>
{#snippet viewControls()}
  <div class="flex min-w-0 flex-col items-stretch gap-1 text-[0.8rem]">
    <span class="min-w-0 flex-1 truncate" role="status">
      {#if loading}
        {t("notes.databaseListLoading")}
      {:else if error}
        {t("notes.databaseListFailed", error)}
      {:else}
        {t("notes.databaseListRowsCount", list?.rows.length ?? 0)}
      {/if}
    </span>
    <CollectionMenu fullWidth label={t("notes.databaseLayout")}>
      <div class="grid gap-3">
        <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)] items-center gap-3">
          <span>{t("notes.databaseListGroupBy")}</span>
          <CustomSelect
            inline
            appearance="quiet"
            contentAlign="start"
            class="w-full min-w-0"
            ariaLabel={t("notes.databaseListGroupBy")}
            value={String(configuration.group_property_id ?? "")}
            disabled={loading || mutating || !list}
            options={[{ value: "", label: t("notes.databaseListNoGroupProperty") },
              ...(groupableColumns).map((column) => ({ value: String(column.id), label: String(column.name) }))]}
            onChange={(nextValue) => updateGroupProperty(nextValue)}
            triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
          />
        </div>
        <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)] items-center gap-3">
          <span>{t("notes.databaseTableOpenMode")}</span>
          <CustomSelect
            inline
            appearance="quiet"
            contentAlign="start"
            class="w-full min-w-0"
            ariaLabel={t("notes.databaseTableOpenMode")}
            value={String(configuration.row_open_mode ?? "")}
            disabled={loading || mutating || !list}
            options={[{ value: "side_panel", label: t("notes.databaseTableOpenSidePanel") },
              { value: "full_page", label: t("notes.databaseTableOpenFullPage") }]}
            onChange={(nextValue) => updateRowOpenMode(nextValue as NotesDatabaseListRowOpenMode)}
            triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
          />
        </div>
      </div>
    </CollectionMenu>
    <CollectionMenu fullWidth label={t("notes.databaseNew")} kind="new">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <input
          class="h-8 min-w-40 flex-1 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={draftTitle}
          placeholder={t("notes.databaseRowsNewPlaceholder")}
          disabled={loading || mutating}
          oninput={(event) => {
            draftTitle = event.currentTarget.value;
          }}
          onkeydown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              void createRow();
            }
          }}
        />
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2 text-[0.8rem] text-primary-foreground disabled:pointer-events-none"
          disabled={loading || mutating}
          onclick={() => {
            void createRow();
          }}
        >
          <Plus class="size-3.5" aria-hidden="true" />
          <span>{t("notes.databaseListAddRow")}</span>
        </button>
      </div>
    </CollectionMenu>
    <button
      type="button"
      class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none"
      disabled={loading || mutating}
      aria-label={t("notes.databaseListReload")}
      title={t("notes.databaseListReload")}
      onclick={() => {
        void loadList();
      }}
    >
      <RefreshCw class="size-3.5" aria-hidden="true" />
    </button>
  </div>
{/snippet}

{#snippet propertyControls()}
      <div class="flex flex-col items-stretch gap-1">
        <CollectionMenu fullWidth label={t("notes.databaseListRowProperties")} kind="properties">

          <div class="mt-2 grid gap-1">
            {#each columns.filter((column) =>
              column.type !== "title" && column.id !== configuration.group_property_id
            ) as column (column.id)}
              <label class="flex min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-accent/60">
                <input
                  type="checkbox"
                  checked={visibleColumns.some((visibleColumn) => visibleColumn.id === column.id)}
                  disabled={mutating}
                  onchange={(event) => updateRowProperty(column.id, event.currentTarget.checked)}
                  onkeydown={(event) => event.stopPropagation()}
                />
                <span class="min-w-0 flex-1 truncate">{column.name}</span>
              </label>
            {/each}
          </div>
        </CollectionMenu>

        {#if groupColumn}
          <CollectionMenu fullWidth label={t("notes.databaseListHiddenGroups")} kind="layout">

            <div class="mt-2 grid gap-1">
              {#each visibleGroups as group (group.id)}
                <button
                  type="button"
                  class="flex min-w-0 items-center gap-2 rounded-sm px-1 py-1 text-left hover:bg-accent/60 disabled:pointer-events-none"
                  disabled={mutating}
                  aria-label={t("notes.databaseListHideGroup", group.name)}
                  onclick={() => setGroupHidden(group.id, true)}
                >
                  <EyeOff class="size-3.5 shrink-0" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate">{group.name}</span>
                </button>
              {/each}
              {#each hiddenGroups as group (group.id)}
                <button
                  type="button"
                  class="flex min-w-0 items-center gap-2 rounded-sm px-1 py-1 text-left hover:bg-accent/60 disabled:pointer-events-none"
                  disabled={mutating}
                  aria-label={t("notes.databaseListShowGroup", group.name)}
                  onclick={() => setGroupHidden(group.id, false)}
                >
                  <Eye class="size-3.5 shrink-0" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate">{group.name}</span>
                </button>
              {/each}
            </div>
          </CollectionMenu>
        {/if}

        <CollectionMenu fullWidth label={t("notes.databaseTableSorts")} kind="sort" activeCount={sorts.length}>

          <div class="mt-2 grid gap-2">
            {#each sorts as sort, index}
              <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1">
                <CustomSelect
                  inline
                  appearance="quiet"
                  contentAlign="start"
                  class="w-full min-w-0"
                  ariaLabel={t("notes.databaseTableSortProperty")}
                  value={String(sort.property_id ?? "")}
                  disabled={mutating}
                  options={[...(columns).map((column) => ({ value: String(column.id), label: String(column.name) }))]}
                  onChange={(nextValue) => updateSort(index, { property_id: nextValue })}
                  triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
                />
                <CustomSelect
                  inline
                  appearance="quiet"
                  contentAlign="start"
                  class="w-full min-w-0"
                  ariaLabel={t("notes.databaseTableSortDirection")}
                  value={String(sort.direction ?? "")}
                  disabled={mutating}
                  options={[{ value: "ascending", label: t("notes.databaseTableSortAscending") },
                    { value: "descending", label: t("notes.databaseTableSortDescending") }]}
                  onChange={(nextValue) => updateSort(index, {
                    direction: nextValue === "descending" ? "descending" : "ascending",
                  })}
                  triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
                />
                <button
                  type="button"
                  class="inline-flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:pointer-events-none"
                  disabled={mutating}
                  aria-label={t("notes.databaseTableRemoveSort")}
                  title={t("notes.databaseTableRemoveSort")}
                  onclick={() => removeSort(index)}
                >
                  <Trash2 class="size-3.5" aria-hidden="true" />
                </button>
              </div>
            {/each}
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-accent disabled:pointer-events-none"
              disabled={mutating || columns.length === 0}
              onclick={addSort}
            >
              <Plus class="size-3.5" aria-hidden="true" />
              <span>{t("notes.databaseTableAddSort")}</span>
            </button>
          </div>
        </CollectionMenu>

        <CollectionMenu fullWidth label={t("notes.databaseTableFilters")} kind="filter" activeCount={filters.length}>

          <div class="mt-2 grid gap-2">
            {#each filters as filter, index}
              <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-1">
                <CustomSelect
                  inline
                  appearance="quiet"
                  contentAlign="start"
                  class="w-full min-w-0"
                  ariaLabel={t("notes.databaseTableFilterProperty")}
                  value={String(filter.property_id ?? "")}
                  disabled={mutating}
                  options={[...(columns).map((column) => ({ value: String(column.id), label: String(column.name) }))]}
                  onChange={(nextValue) => updateFilter(index, { property_id: nextValue })}
                  triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
                />
                <CustomSelect
                  inline
                  appearance="quiet"
                  contentAlign="start"
                  class="w-full min-w-0"
                  ariaLabel={t("notes.databaseTableFilterConditionLabel")}
                  value={String(filter.condition ?? "")}
                  disabled={mutating}
                  options={[...(FILTER_CONDITIONS).map((condition) => ({ value: String(condition), label: String(filterConditionLabel(condition)) }))]}
                  onChange={(nextValue) => updateFilter(index, {
                    condition: nextValue as NotesDatabaseTableFilterCondition,
                  })}
                  triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
                />
                <input
                  class="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={String(filter.value ?? "")}
                  disabled={mutating || !filterConditionNeedsValue(filter.condition)}
                  aria-label={t("notes.databaseTableFilterValue")}
                  onblur={(event) => updateFilter(index, { value: event.currentTarget.value })}
                  onkeydown={(event) => event.stopPropagation()}
                />
                <button
                  type="button"
                  class="inline-flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:pointer-events-none"
                  disabled={mutating}
                  aria-label={t("notes.databaseTableRemoveFilter")}
                  title={t("notes.databaseTableRemoveFilter")}
                  onclick={() => removeFilter(index)}
                >
                  <Trash2 class="size-3.5" aria-hidden="true" />
                </button>
              </div>
            {/each}
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-accent disabled:pointer-events-none"
              disabled={mutating || columns.length === 0}
              onclick={addFilter}
            >
              <Plus class="size-3.5" aria-hidden="true" />
              <span>{t("notes.databaseTableAddFilter")}</span>
            </button>
          </div>
        </CollectionMenu>
      </div>



{/snippet}


<section class="space-y-3 pt-2" aria-label={t("notes.databaseListTitle")}>
  {#if error}<p class="text-[0.8rem] text-destructive" role="alert">{error}</p>{/if}
  {#if settingsOpen}
    <CollectionSettings label={t("notes.databaseViewSettings")} onclose={onCloseSettings}>
      {@render viewControls()}
      {#if list}{@render propertyControls()}{/if}
      <button type="button" class="mt-2 min-h-9 w-full rounded-md px-2 text-left text-sm hover:bg-accent" onclick={() => { onCloseSettings(); onEditProperties(); }}>{t("notes.databaseViewEditProperties")}</button>
    </CollectionSettings>
  {/if}


  {#if !list && !error}<NotesLoadingSkeleton kind="list" />{/if}
  {#if list}
    <div class="grid gap-2 @container">
      <CollectionRow template={listTemplate} compactTemplate="minmax(0, 1fr) 2rem" header>
        <CollectionCell>{t("notes.databaseSchemaName")}</CollectionCell>
        {#each visibleColumns as column (column.id)}<CollectionCell data-collection-secondary>{column.name}</CollectionCell>{/each}
        <div></div>
      </CollectionRow>
      <div class="grid min-w-0 gap-3">
        {#each visibleGroups as group (group.id)}
          <section class="min-w-0">
            {#if groupColumn}
              <div class="mb-1 flex min-h-11 min-w-0 items-center gap-2 border-b border-border/60 px-2">
                <span class="inline-flex size-2 rounded-full bg-muted-foreground" aria-hidden="true"></span>
                <h3 class="min-w-0 flex-1 truncate text-[0.8rem] font-medium text-muted-foreground">
                  {group.name}
                </h3>
                <span class="text-[0.733333rem] text-muted-foreground">
                  {t("notes.databaseListRowsCount", group.rows.length)}
                </span>
              </div>
            {/if}

            <div class="grid min-w-0">
              {#each group.rows as row (row.id)}
                {@const title = rowTitle(row)}
                <CollectionRow template={listTemplate} compactTemplate="minmax(0, 1fr) 2rem">
                  <CollectionCell>
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onclick={() => openRow(row)}
                  >
                    <FileText class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate text-[0.866667rem] text-foreground">
                      {title}
                    </span>
                  </button>
                  </CollectionCell>
                  {#each visibleColumns as column (column.id)}
                    <CollectionCell data-collection-secondary><NotesDatabasePropertyValue {row} {column} /></CollectionCell>
                  {/each}
                  <CollectionMenu iconOnly kind="actions" label={t("notes.databaseTableRowActions")}>
                    <div class="grid gap-1">
                      <button
                        type="button"
                        class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={t("notes.databaseRowsOpen", title)}
                        title={t("notes.databaseRowsOpen", title)}
                        onclick={() => openRow(row)}
                      >
                        <ExternalLink class="size-3.5" aria-hidden="true" />
                        <span class="truncate">{t("notes.databaseRowsOpen", title)}</span>
                      </button>
                      <button
                        type="button"
                        class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                        disabled={mutating}
                        aria-label={t("notes.databaseRowsDuplicate", title)}
                        title={t("notes.databaseRowsDuplicate", title)}
                        onclick={() => {
                          void duplicateRow(row);
                        }}
                      >
                        <Copy class="size-3.5" aria-hidden="true" />
                        <span class="truncate">{t("notes.databaseRowsDuplicate", title)}</span>
                      </button>
                      <button
                        type="button"
                        class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                        disabled={mutating}
                        aria-label={t("notes.databaseRowsTrash", title)}
                        title={t("notes.databaseRowsTrash", title)}
                        onclick={() => {
                          void trashRow(row);
                        }}
                      >
                        <Trash2 class="size-3.5" aria-hidden="true" />
                        <span class="truncate">{t("notes.databaseRowsTrash", title)}</span>
                      </button>
                    </div>
                  </CollectionMenu>
                </CollectionRow>
              {/each}
              {#if group.rows.length === 0}
                <p class="px-2 py-2 text-[0.8rem] text-muted-foreground">{t("notes.databaseRowsEmpty")}</p>
              {/if}
            </div>
          </section>
        {/each}
      </div>

      {#if list.rows.length === 0 && !loading && !error}
        <p class="text-[0.8rem] text-muted-foreground">{t("notes.databaseRowsEmpty")}</p>
      {/if}

      <NotesDatabaseWindowSentinel hasMore={list.has_more} loading={loadingMore} onLoad={loadMoreList} />

      {#if configuration.row_open_mode === "side_panel" && selectedPanelRow}
        <aside class="rounded-md border border-border p-3" aria-label={t("notes.databaseTableSidePanelTitle")}>
          {#if selectedPanelRow}
            {@const title = rowTitle(selectedPanelRow)}
            <div class="flex min-w-0 items-start gap-2">
              <div class="min-w-0 flex-1">
                <h3 class="truncate text-[0.933333rem] font-medium text-foreground">{title}</h3>
                <p class="text-[0.8rem] text-muted-foreground">{t("notes.databaseTableSidePanelSubtitle")}</p>
              </div>
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[0.8rem] hover:bg-accent"
                onclick={() => onSelectPage(selectedPanelRow.id)}
              >
                <ExternalLink class="size-3.5" aria-hidden="true" />
                <span>{t("notes.databaseTableOpenFullPage")}</span>
              </button>
            </div>
            <dl class="mt-3 grid gap-2 @lg:grid-cols-2">
              {#each columns as column (column.id)}
                <div class="min-w-0 rounded-sm bg-muted/40 p-2">
                  <dt class="truncate text-[0.733333rem] text-muted-foreground">{column.name}</dt>
                  <dd class="mt-0.5 min-w-0 truncate text-[0.866667rem] text-foreground">
                    {notesDatabaseListRowText(selectedPanelRow, column) || t("notes.databaseTableEmptyCell")}
                  </dd>
                </div>
              {/each}
            </dl>
          {:else}
            <p class="text-[0.8rem] text-muted-foreground">{t("notes.databaseTableSidePanelEmpty")}</p>
          {/if}
        </aside>
      {/if}
    </div>
  {/if}

</section>
