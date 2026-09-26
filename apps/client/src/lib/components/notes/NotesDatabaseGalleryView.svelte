<script lang="ts">
  import NotesDatabaseMenu from "./NotesDatabaseMenu.svelte";
  import CustomSelect from "$lib/components/settings/CustomSelect.svelte";
  import {
    createNotesDataSourceRowPage,
    duplicateNotesPage,
    getNotesDataSourceGalleryView,
    trashNotesPage,
    updateNotesDataSourceGalleryView,
  } from "$lib/api/notes";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    notesDatabaseGalleryCardCover,
    notesDatabaseGalleryCardText,
    notesDatabaseGalleryCardTitle,
    notesDatabaseGalleryColumns,
    notesDatabaseGalleryConfigurationFromView,
    notesDatabaseGalleryCoverColumns,
    notesDatabaseGalleryFiltersFromView,
    notesDatabaseGallerySortsFromView,
    notesDatabaseGalleryUpdate,
    notesDatabaseGalleryVisibleColumns,
  } from "$lib/notes/database-gallery";
  import type { NotesDatabaseTableColumn } from "$lib/notes/database-table";
  import { mergeNotesDatabaseRows } from "$lib/notes/database-view-window";
  import type {
    NotesDatabaseGalleryCardSize,
    NotesDatabaseGalleryConfiguration,
    NotesDatabaseGalleryCoverSource,
    NotesDatabaseGalleryRowOpenMode,
    NotesDatabaseTableFilter,
    NotesDatabaseTableFilterCondition,
    NotesDatabaseTableSort,
    NotesDatabaseViewScope,
    NotesDataSourceGalleryView,
    NotesPage,
  } from "$lib/notes/types";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import FileText from "@lucide/svelte/icons/file-text";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import NotesPageCover from "./NotesPageCover.svelte";
  import NotesDatabaseWindowSentinel from "./NotesDatabaseWindowSentinel.svelte";

  let {
    dataSourceId,
    databaseId = null,
    viewId = null,
    onSelectPage,
    reloadKey = 0,
  }: {
    dataSourceId: string;
    databaseId?: string | null;
    viewId?: string | null;
    onSelectPage: (pageId: string) => void;
    reloadKey?: number;
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

  let gallery = $state<NotesDataSourceGalleryView | null>(null);
  let loading = $state(false);
  let loadingMore = $state(false);
  let requestId = 0;
  let mutating = $state(false);
  let error = $state<string | null>(null);
  let draftTitle = $state("");
  let selectedPanelRowId = $state<string | null>(null);
  let lastLoadSignature = $state("");

  const columns = $derived(gallery ? notesDatabaseGalleryColumns(gallery.data_source, gallery.view) : []);
  const configuration = $derived(
    gallery ? notesDatabaseGalleryConfigurationFromView(gallery.view) : defaultConfiguration(),
  );
  const visibleColumns = $derived(notesDatabaseGalleryVisibleColumns(columns, configuration));
  const coverColumns = $derived(notesDatabaseGalleryCoverColumns(columns));
  const filters = $derived(gallery ? notesDatabaseGalleryFiltersFromView(gallery.view) : []);
  const sorts = $derived(gallery ? notesDatabaseGallerySortsFromView(gallery.view) : []);
  const selectedPanelRow = $derived(
    gallery?.rows.find((row) => row.id === selectedPanelRowId) ?? null,
  );
  const gridStyle = $derived(`grid-template-columns: repeat(auto-fill, minmax(${cardMinWidth()}px, 1fr));`);
  const previewStyle = $derived(`height: ${previewHeight()}px;`);

  $effect(() => {
    const signature = `${dataSourceId}:${databaseId ?? ""}:${viewId ?? ""}:${reloadKey}`;
    if (signature === lastLoadSignature) return;
    lastLoadSignature = signature;
    void loadGallery();
  });

  function viewScope(): NotesDatabaseViewScope {
    return { databaseId, viewId };
  }

  async function loadGallery(): Promise<NotesDataSourceGalleryView | null> {
    const currentRequest = ++requestId;
    loading = true;
    error = null;
    try {
      const loaded = await getNotesDataSourceGalleryView(dataSourceId, viewScope());
      if (currentRequest !== requestId) return null;
      gallery = loaded;
      if (selectedPanelRowId && !loaded.rows.some((row) => row.id === selectedPanelRowId)) {
        selectedPanelRowId = null;
      }
      return loaded;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      return null;
    } finally {
      loading = false;
    }
  }

  async function loadMoreGallery(): Promise<void> {
    const current = gallery;
    if (!current?.has_more || !current.next_cursor || loadingMore) return;
    const currentRequest = requestId;
    loadingMore = true;
    try {
      const loaded = await getNotesDataSourceGalleryView(dataSourceId, viewScope(), {
        start_cursor: current.next_cursor,
      });
      if (currentRequest !== requestId || gallery !== current) return;
      gallery = { ...loaded, rows: mergeNotesDatabaseRows(current.rows, loaded.rows) };
    } catch (caught) {
      if (currentRequest === requestId) error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (currentRequest === requestId) loadingMore = false;
    }
  }

  async function persistGallery(
    nextConfiguration: NotesDatabaseGalleryConfiguration,
    nextVisibleColumns = visibleColumns,
    nextFilters = filters,
    nextSorts = sorts,
  ): Promise<void> {
    if (!gallery) return;
    mutating = true;
    error = null;
    try {
      gallery = await updateNotesDataSourceGalleryView(
        dataSourceId,
        notesDatabaseGalleryUpdate(nextConfiguration, nextVisibleColumns, nextFilters, nextSorts),
        viewScope(),
      );
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function createCard(): Promise<void> {
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
      await loadGallery();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function duplicateCard(row: NotesPage): Promise<void> {
    mutating = true;
    error = null;
    try {
      const loaded = await duplicateNotesPage(row.id, {});
      selectedPanelRowId = loaded.page.id;
      await loadGallery();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function trashCard(row: NotesPage): Promise<void> {
    mutating = true;
    error = null;
    try {
      await trashNotesPage(row.id, true);
      if (selectedPanelRowId === row.id) selectedPanelRowId = null;
      await loadGallery();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  function updateCoverSource(coverSource: NotesDatabaseGalleryCoverSource): void {
    const firstCoverColumn = coverColumns[0];
    void persistGallery({
      ...configuration,
      cover_source: coverSource,
      cover_property_id: coverSource === "files_property" ? firstCoverColumn?.id ?? null : null,
    });
  }

  function updateCoverProperty(propertyId: string): void {
    void persistGallery({ ...configuration, cover_property_id: propertyId || null });
  }

  function updateCardSize(cardSize: NotesDatabaseGalleryCardSize): void {
    void persistGallery({ ...configuration, card_size: cardSize });
  }

  function updateFitImage(fitImage: boolean): void {
    void persistGallery({ ...configuration, fit_image: fitImage });
  }

  function updateRowOpenMode(mode: NotesDatabaseGalleryRowOpenMode): void {
    void persistGallery({ ...configuration, row_open_mode: mode });
  }

  function updateCardProperty(columnId: string, visible: boolean): void {
    const byId = new Map(columns.map((column) => [column.id, column]));
    const nextIds = visible
      ? [...configuration.visible_property_ids, columnId]
      : configuration.visible_property_ids.filter((id) => id !== columnId);
    const nextVisibleColumns = nextIds
      .map((id) => byId.get(id))
      .filter((column): column is NotesDatabaseTableColumn =>
        column !== undefined && column.type !== "title"
      );
    void persistGallery({ ...configuration, visible_property_ids: nextIds }, nextVisibleColumns);
  }

  function addSort(): void {
    const firstColumn = columns[0];
    if (!firstColumn) return;
    void persistGallery(configuration, visibleColumns, filters, [
      ...sorts,
      { property_id: firstColumn.id, direction: "ascending" },
    ]);
  }

  function updateSort(index: number, patch: Partial<NotesDatabaseTableSort>): void {
    const nextSorts = sorts.map((sort, sortIndex) =>
      sortIndex === index ? { ...sort, ...patch } : sort,
    );
    void persistGallery(configuration, visibleColumns, filters, nextSorts);
  }

  function removeSort(index: number): void {
    void persistGallery(
      configuration,
      visibleColumns,
      filters,
      sorts.filter((_, sortIndex) => sortIndex !== index),
    );
  }

  function addFilter(): void {
    const firstColumn = columns[0];
    if (!firstColumn) return;
    void persistGallery(configuration, visibleColumns, [
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
    void persistGallery(configuration, visibleColumns, nextFilters, sorts);
  }

  function removeFilter(index: number): void {
    void persistGallery(
      configuration,
      visibleColumns,
      filters.filter((_, filterIndex) => filterIndex !== index),
      sorts,
    );
  }

  function openCard(row: NotesPage): void {
    if (configuration.row_open_mode === "side_panel") {
      selectedPanelRowId = row.id;
      return;
    }
    onSelectPage(row.id);
  }

  function rowTitle(row: NotesPage): string {
    return notesDatabaseGalleryCardTitle(row, columns, t("notes.untitled"));
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

  function cardMinWidth(): number {
    if (configuration.card_size === "small") return 176;
    if (configuration.card_size === "large") return 304;
    return 240;
  }

  function previewHeight(): number {
    if (configuration.card_size === "small") return 104;
    if (configuration.card_size === "large") return 192;
    return 144;
  }

  function defaultConfiguration(): NotesDatabaseGalleryConfiguration {
    return {
      cover_source: "page_cover",
      cover_property_id: null,
      visible_property_ids: [],
      card_size: "medium",
      fit_image: false,
      row_open_mode: "full_page",
    };
  }
</script>

<section class="space-y-3 pt-2" aria-label={t("notes.databaseGalleryTitle")}>
  <div class="flex min-w-0 flex-wrap items-center gap-2 text-[0.8rem] text-muted-foreground">
    <span class="min-w-0 flex-1 truncate" role="status">
      {#if loading}
        {t("notes.databaseGalleryLoading")}
      {:else if error}
        {t("notes.databaseGalleryFailed", error)}
      {:else}
        {t("notes.databaseGalleryCardsCount", gallery?.rows.length ?? 0)}
      {/if}
    </span>
    <NotesDatabaseMenu label={t("notes.databaseLayout")}>
      <div class="grid gap-3">
        <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)] items-center gap-3">
          <span>{t("notes.databaseGalleryPreview")}</span>
          <CustomSelect
            inline
            appearance="quiet"
            contentAlign="start"
            class="w-full min-w-0"
            ariaLabel={t("notes.databaseGalleryPreview")}
            value={String(configuration.cover_source ?? "")}
            disabled={loading || mutating || !gallery}
            options={[{ value: "page_cover", label: t("notes.databaseGalleryPreviewPageCover") },
              { value: "files_property", label: t("notes.databaseGalleryPreviewFilesProperty") },
              { value: "none", label: t("notes.databaseGalleryPreviewNone") }]}
            onChange={(nextValue) => updateCoverSource(nextValue as NotesDatabaseGalleryCoverSource)}
            triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
          />
        </div>
        {#if configuration.cover_source === "files_property"}
          <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)] items-center gap-3">
            <span>{t("notes.databaseGalleryCoverProperty")}</span>
            <CustomSelect
              inline
              appearance="quiet"
              contentAlign="start"
              class="w-full min-w-0"
              ariaLabel={t("notes.databaseGalleryCoverProperty")}
              value={String(configuration.cover_property_id ?? "")}
              disabled={loading || mutating || !gallery || coverColumns.length === 0}
              options={[{ value: "", label: t("notes.databaseTableEmptyCell") },
                ...(coverColumns).map((column) => ({ value: String(column.id), label: String(column.name) }))]}
              onChange={(nextValue) => updateCoverProperty(nextValue)}
              triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
            />
          </div>
        {/if}
        <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)] items-center gap-3">
          <span>{t("notes.databaseGalleryCardSize")}</span>
          <CustomSelect
            inline
            appearance="quiet"
            contentAlign="start"
            class="w-full min-w-0"
            ariaLabel={t("notes.databaseGalleryCardSize")}
            value={String(configuration.card_size ?? "")}
            disabled={loading || mutating || !gallery}
            options={[{ value: "small", label: t("notes.databaseGalleryCardSizeSmall") },
              { value: "medium", label: t("notes.databaseGalleryCardSizeMedium") },
              { value: "large", label: t("notes.databaseGalleryCardSizeLarge") }]}
            onChange={(nextValue) => updateCardSize(nextValue as NotesDatabaseGalleryCardSize)}
            triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
          />
        </div>
        <label class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)] items-center gap-3">
          <input
            type="checkbox"
            checked={configuration.fit_image}
            disabled={loading || mutating || !gallery || configuration.cover_source === "none"}
            onchange={(event) => updateFitImage(event.currentTarget.checked)}
            onkeydown={(event) => event.stopPropagation()}
          />
          <span>{t("notes.databaseGalleryFitImage")}</span>
        </label>
        <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)] items-center gap-3">
          <span>{t("notes.databaseTableOpenMode")}</span>
          <CustomSelect
            inline
            appearance="quiet"
            contentAlign="start"
            class="w-full min-w-0"
            ariaLabel={t("notes.databaseTableOpenMode")}
            value={String(configuration.row_open_mode ?? "")}
            disabled={loading || mutating || !gallery}
            options={[{ value: "full_page", label: t("notes.databaseTableOpenFullPage") },
              { value: "side_panel", label: t("notes.databaseTableOpenSidePanel") }]}
            onChange={(nextValue) => updateRowOpenMode(nextValue as NotesDatabaseGalleryRowOpenMode)}
            triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
          />
        </div>
      </div>
    </NotesDatabaseMenu>
    <NotesDatabaseMenu label={t("notes.databaseNew")} kind="new">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <input
          class="h-8 min-w-40 flex-1 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
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
              void createCard();
            }
          }}
        />
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2 text-[0.8rem] text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={loading || mutating}
          onclick={() => {
            void createCard();
          }}
        >
          <Plus class="size-3.5" aria-hidden="true" />
          <span>{t("notes.databaseGalleryAddCard")}</span>
        </button>
      </div>
    </NotesDatabaseMenu>
    <button
      type="button"
      class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      disabled={loading || mutating}
      aria-label={t("notes.databaseGalleryReload")}
      title={t("notes.databaseGalleryReload")}
      onclick={() => {
        void loadGallery();
      }}
    >
      <RefreshCw class="size-3.5" aria-hidden="true" />
    </button>
  </div>

  {#if gallery}
    <div class="grid gap-2 @container">
      <div class="flex flex-wrap items-center gap-1">
        <NotesDatabaseMenu label={t("notes.databaseGalleryCardProperties")} kind="properties">

          <div class="mt-2 grid gap-1">
            {#each columns.filter((column) => column.type !== "title") as column (column.id)}
              <label class="flex min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-accent/60">
                <input
                  type="checkbox"
                  checked={visibleColumns.some((visibleColumn) => visibleColumn.id === column.id)}
                  disabled={mutating}
                  onchange={(event) => updateCardProperty(column.id, event.currentTarget.checked)}
                  onkeydown={(event) => event.stopPropagation()}
                />
                <span class="min-w-0 flex-1 truncate">{column.name}</span>
              </label>
            {/each}
          </div>
        </NotesDatabaseMenu>

        <NotesDatabaseMenu label={t("notes.databaseTableSorts")} kind="sort" activeCount={sorts.length}>

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
                  class="inline-flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
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
              class="inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              disabled={mutating || columns.length === 0}
              onclick={addSort}
            >
              <Plus class="size-3.5" aria-hidden="true" />
              <span>{t("notes.databaseTableAddSort")}</span>
            </button>
          </div>
        </NotesDatabaseMenu>

        <NotesDatabaseMenu label={t("notes.databaseTableFilters")} kind="filter" activeCount={filters.length}>

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
                  class="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  value={String(filter.value ?? "")}
                  disabled={mutating || !filterConditionNeedsValue(filter.condition)}
                  aria-label={t("notes.databaseTableFilterValue")}
                  onblur={(event) => updateFilter(index, { value: event.currentTarget.value })}
                  onkeydown={(event) => event.stopPropagation()}
                />
                <button
                  type="button"
                  class="inline-flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
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
              class="inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
              disabled={mutating || columns.length === 0}
              onclick={addFilter}
            >
              <Plus class="size-3.5" aria-hidden="true" />
              <span>{t("notes.databaseTableAddFilter")}</span>
            </button>
          </div>
        </NotesDatabaseMenu>
      </div>

      <div class="grid min-w-0 gap-3" style={gridStyle}>
        {#each gallery.rows as row (row.id)}
          {@const title = rowTitle(row)}
          {@const cover = notesDatabaseGalleryCardCover(row, configuration)}
          <article class="min-w-0 overflow-hidden rounded-md border border-border bg-background shadow-sm">
            {#if configuration.cover_source !== "none"}
              <button
                type="button"
                class="block w-full overflow-hidden border-b border-border bg-muted/40"
                style={previewStyle}
                aria-label={t("notes.databaseRowsOpen", title)}
                onclick={() => openCard(row)}
              >
                <NotesPageCover
                  {cover}
                  unavailableLabel={t("notes.databaseGalleryPreviewUnavailable")}
                  objectFit={configuration.fit_image ? "contain" : "cover"}
                />
              </button>
            {/if}
            <div class="space-y-2 p-2">
              <div class="flex min-w-0 items-start gap-1">
                <button
                  type="button"
                  class="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onclick={() => openCard(row)}
                >
                  <span class="block truncate text-[0.866667rem] font-medium text-foreground">
                    {title}
                  </span>
                </button>
                <button
                  type="button"
                  class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={t("notes.databaseRowsOpen", title)}
                  title={t("notes.databaseRowsOpen", title)}
                  onclick={() => openCard(row)}
                >
                  <FileText class="size-3.5" aria-hidden="true" />
                </button>
              </div>
              {#if visibleColumns.length > 0}
                <dl class="grid gap-1">
                  {#each visibleColumns as column (column.id)}
                    {@const text = notesDatabaseGalleryCardText(row, column)}
                    <div class="min-w-0">
                      <dt class="truncate text-[0.666667rem] text-muted-foreground">{column.name}</dt>
                      <dd class="truncate text-[0.8rem] text-foreground">
                        {text || t("notes.databaseTableEmptyCell")}
                      </dd>
                    </div>
                  {/each}
                </dl>
              {/if}
              <div class="flex justify-end gap-1">
                <button
                  type="button"
                  class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  disabled={mutating}
                  aria-label={t("notes.databaseRowsDuplicate", title)}
                  title={t("notes.databaseRowsDuplicate", title)}
                  onclick={() => {
                    void duplicateCard(row);
                  }}
                >
                  <Copy class="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="inline-flex size-7 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
                  disabled={mutating}
                  aria-label={t("notes.databaseRowsTrash", title)}
                  title={t("notes.databaseRowsTrash", title)}
                  onclick={() => {
                    void trashCard(row);
                  }}
                >
                  <Trash2 class="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </article>
        {/each}
      </div>

      {#if visibleColumns.length === 0}
        <p class="text-[0.8rem] text-muted-foreground">{t("notes.databaseGalleryNoVisibleProperties")}</p>
      {/if}

      {#if gallery.rows.length === 0 && !loading && !error}
        <p class="text-[0.8rem] text-muted-foreground">{t("notes.databaseRowsEmpty")}</p>
      {/if}
      <NotesDatabaseWindowSentinel
        hasMore={gallery.has_more}
        loading={loadingMore}
        onLoad={loadMoreGallery}
      />

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
                    {notesDatabaseGalleryCardText(selectedPanelRow, column) || t("notes.databaseTableEmptyCell")}
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

  {#if mutating}
    <p class="flex items-center gap-1 text-[0.8rem] text-muted-foreground">
      <Check class="size-3.5" aria-hidden="true" />
      <span>{t("notes.databaseGallerySaving")}</span>
    </p>
  {/if}
</section>
