<script lang="ts">
  import NotesDatabaseMenu from "./NotesDatabaseMenu.svelte";
  import CustomSelect from "$lib/components/settings/CustomSelect.svelte";
  import {
    createNotesDataSourceRowPage,
    duplicateNotesPage,
    getNotesDataSourceCalendarView,
    trashNotesPage,
    updateNotesDataSourceCalendarView,
  } from "$lib/api/notes";
  import { formatDateTime } from "$lib/i18n/formatters";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    notesDatabaseCalendarColumns,
    notesDatabaseCalendarConfigurationFromView,
    notesDatabaseCalendarDateColumns,
    notesDatabaseCalendarDays,
    notesDatabaseCalendarFiltersFromView,
    notesDatabaseCalendarRowCreateProperties,
    notesDatabaseCalendarRowText,
    notesDatabaseCalendarRowTitle,
    notesDatabaseCalendarShiftMonth,
    notesDatabaseCalendarSortsFromView,
    notesDatabaseCalendarUpdate,
    notesDatabaseCalendarVisibleColumns,
    notesDatabaseCalendarMonthRange,
  } from "$lib/notes/database-calendar";
  import type { NotesDatabaseTableColumn } from "$lib/notes/database-table";
  import { mergeNotesDatabaseRows } from "$lib/notes/database-view-window";
  import NotesDatabaseWindowSentinel from "./NotesDatabaseWindowSentinel.svelte";
  import type {
    NotesDatabaseCalendarConfiguration,
    NotesDatabaseCalendarRowOpenMode,
    NotesDatabaseTableFilter,
    NotesDatabaseTableFilterCondition,
    NotesDatabaseTableSort,
    NotesDatabaseViewScope,
    NotesDataSourceCalendarView,
    NotesPage,
  } from "$lib/notes/types";
  import { Temporal } from "@js-temporal/polyfill";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import FileText from "@lucide/svelte/icons/file-text";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Trash2 from "@lucide/svelte/icons/trash-2";

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

  const localization = getLocalization();
  const { t } = localization;
  const FILTER_CONDITIONS: NotesDatabaseTableFilterCondition[] = [
    "contains",
    "equals",
    "is_empty",
    "is_not_empty",
    "checked",
    "unchecked",
  ];

  let calendar = $state<NotesDataSourceCalendarView | null>(null);
  let loading = $state(false);
  let loadingMore = $state(false);
  let requestId = 0;
  let mutating = $state(false);
  let error = $state<string | null>(null);
  let draftTitleByDate = $state<Record<string, string>>({});
  let selectedPanelRowId = $state<string | null>(null);
  let lastLoadSignature = $state("");

  const columns = $derived(calendar ? notesDatabaseCalendarColumns(calendar.data_source, calendar.view) : []);
  const configuration = $derived(
    calendar ? notesDatabaseCalendarConfigurationFromView(calendar.view) : defaultConfiguration(),
  );
  const dateColumns = $derived(notesDatabaseCalendarDateColumns(columns));
  const dateColumn = $derived(
    configuration.date_property_id
      ? dateColumns.find((column) => column.id === configuration.date_property_id) ?? null
      : null,
  );
  const visibleColumns = $derived(notesDatabaseCalendarVisibleColumns(columns, configuration));
  const filters = $derived(calendar ? notesDatabaseCalendarFiltersFromView(calendar.view) : []);
  const sorts = $derived(calendar ? notesDatabaseCalendarSortsFromView(calendar.view) : []);
  const days = $derived(calendar ? notesDatabaseCalendarDays(calendar.rows, dateColumn, configuration) : []);
  const selectedPanelRow = $derived(calendar?.rows.find((row) => row.id === selectedPanelRowId) ?? null);

  $effect(() => {
    const signature = `${dataSourceId}:${databaseId ?? ""}:${viewId ?? ""}:${reloadKey}`;
    if (signature === lastLoadSignature) return;
    lastLoadSignature = signature;
    void loadCalendar();
  });

  function viewScope(): NotesDatabaseViewScope {
    return { databaseId, viewId };
  }

  async function loadCalendar(): Promise<NotesDataSourceCalendarView | null> {
    const currentRequest = ++requestId;
    loading = true;
    error = null;
    try {
      const loaded = await getNotesDataSourceCalendarView(dataSourceId, viewScope());
      if (currentRequest !== requestId) return null;
      calendar = loaded;
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

  async function loadMoreCalendar(): Promise<void> {
    const current = calendar;
    if (!current?.has_more || !current.next_cursor || loadingMore) return;
    const currentRequest = requestId;
    loadingMore = true;
    try {
      const loaded = await getNotesDataSourceCalendarView(dataSourceId, viewScope(), {
        start_cursor: current.next_cursor,
        range_start: configuration.range_start,
        range_end: configuration.range_end,
      });
      if (currentRequest !== requestId || calendar !== current) return;
      calendar = { ...loaded, rows: mergeNotesDatabaseRows(current.rows, loaded.rows) };
    } catch (caught) {
      if (currentRequest === requestId) error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (currentRequest === requestId) loadingMore = false;
    }
  }

  async function persistCalendar(
    nextConfiguration: NotesDatabaseCalendarConfiguration,
    nextVisibleColumns = visibleColumns,
    nextFilters = filters,
    nextSorts = sorts,
  ): Promise<void> {
    if (!calendar) return;
    mutating = true;
    error = null;
    try {
      calendar = await updateNotesDataSourceCalendarView(
        dataSourceId,
        notesDatabaseCalendarUpdate(nextConfiguration, nextVisibleColumns, nextFilters, nextSorts),
        viewScope(),
      );
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function createRow(date: string): Promise<void> {
    if (!calendar || !configuration.date_property_id) return;
    const title = (draftTitleByDate[date] ?? "").trim() || t("notes.untitled");
    mutating = true;
    error = null;
    try {
      const loaded = await createNotesDataSourceRowPage(dataSourceId, {
        id: crypto.randomUUID(),
        first_block_id: crypto.randomUUID(),
        title,
        properties: notesDatabaseCalendarRowCreateProperties(
          calendar.data_source,
          configuration.date_property_id,
          date,
        ),
      });
      draftTitleByDate = { ...draftTitleByDate, [date]: "" };
      selectedPanelRowId = loaded.page.id;
      await loadCalendar();
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
      await loadCalendar();
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
      await loadCalendar();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  function updateDateProperty(propertyId: string): void {
    const datePropertyId = propertyId || null;
    const nextConfiguration: NotesDatabaseCalendarConfiguration = {
      ...configuration,
      date_property_id: datePropertyId,
      visible_property_ids: configuration.visible_property_ids.filter((id) => id !== datePropertyId),
    };
    const nextVisibleColumns = visibleColumns.filter((column) => column.id !== datePropertyId);
    void persistCalendar(nextConfiguration, nextVisibleColumns);
  }

  function updateRowOpenMode(mode: NotesDatabaseCalendarRowOpenMode): void {
    void persistCalendar({ ...configuration, row_open_mode: mode });
  }

  function shiftMonth(months: number): void {
    void persistCalendar(notesDatabaseCalendarShiftMonth(configuration, months));
  }

  function goToday(): void {
    void persistCalendar({
      ...configuration,
      ...notesDatabaseCalendarMonthRange(Temporal.Now.plainDateISO().toString()),
    });
  }

  function updateRowProperty(columnId: string, visible: boolean): void {
    const byId = new Map(columns.map((column) => [column.id, column]));
    const nextIds = visible
      ? [...configuration.visible_property_ids, columnId]
      : configuration.visible_property_ids.filter((id) => id !== columnId);
    const nextVisibleColumns = nextIds
      .map((id) => byId.get(id))
      .filter((column): column is NotesDatabaseTableColumn =>
        column !== undefined && column.type !== "title" && column.id !== configuration.date_property_id
      );
    void persistCalendar({ ...configuration, visible_property_ids: nextIds }, nextVisibleColumns);
  }

  function addSort(): void {
    const firstColumn = columns[0];
    if (!firstColumn) return;
    void persistCalendar(configuration, visibleColumns, filters, [
      ...sorts,
      { property_id: firstColumn.id, direction: "ascending" },
    ]);
  }

  function updateSort(index: number, patch: Partial<NotesDatabaseTableSort>): void {
    const nextSorts = sorts.map((sort, sortIndex) =>
      sortIndex === index ? { ...sort, ...patch } : sort,
    );
    void persistCalendar(configuration, visibleColumns, filters, nextSorts);
  }

  function removeSort(index: number): void {
    void persistCalendar(
      configuration,
      visibleColumns,
      filters,
      sorts.filter((_, sortIndex) => sortIndex !== index),
    );
  }

  function addFilter(): void {
    const firstColumn = columns[0];
    if (!firstColumn) return;
    void persistCalendar(configuration, visibleColumns, [
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
    void persistCalendar(configuration, visibleColumns, nextFilters, sorts);
  }

  function removeFilter(index: number): void {
    void persistCalendar(
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
    return notesDatabaseCalendarRowTitle(row, columns, t("notes.untitled"));
  }

  function updateDraftTitle(date: string, value: string): void {
    draftTitleByDate = { ...draftTitleByDate, [date]: value };
  }

  function monthLabel(): string {
    return formatDateTime(
      localization.locale,
      new Date(`${configuration.range_start}T00:00:00Z`),
      { month: "long", year: "numeric", timeZone: "UTC" },
    );
  }

  function dayNumber(date: string): string {
    return String(Number.parseInt(date.slice(8, 10), 10));
  }

  function weekdayLabels(): string[] {
    return ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"]
      .map((date) => formatDateTime(
        localization.locale,
        new Date(`${date}T00:00:00Z`),
        { weekday: "short", timeZone: "UTC" },
      ));
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

  function defaultConfiguration(): NotesDatabaseCalendarConfiguration {
    return {
      date_property_id: null,
      ...notesDatabaseCalendarMonthRange(Temporal.Now.plainDateISO().toString()),
      visible_property_ids: [],
      row_open_mode: "side_panel",
    };
  }
</script>

<section class="space-y-3 pt-2" aria-label={t("notes.databaseCalendarTitle")}>
  <div class="flex min-w-0 flex-wrap items-center gap-2 text-[0.8rem] text-muted-foreground">
    <span class="min-w-0 flex-1 truncate" role="status">
      {#if loading}
        {t("notes.databaseCalendarLoading")}
      {:else if error}
        {t("notes.databaseCalendarFailed", error)}
      {:else}
        {t("notes.databaseCalendarRowsCount", calendar?.rows.length ?? 0)}
      {/if}
    </span>
    <NotesDatabaseMenu label={t("notes.databaseLayout")}>
      <div class="grid gap-3">
        <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)] items-center gap-3">
          <span>{t("notes.databaseCalendarDateProperty")}</span>
          <CustomSelect
            inline
            appearance="quiet"
            contentAlign="start"
            class="w-full min-w-0"
            ariaLabel={t("notes.databaseCalendarDateProperty")}
            value={String(configuration.date_property_id ?? "")}
            disabled={loading || mutating || !calendar}
            options={[{ value: "", label: t("notes.databaseCalendarNoDateProperty") },
              ...(dateColumns).map((column) => ({ value: String(column.id), label: String(column.name) }))]}
            onChange={(nextValue) => updateDateProperty(nextValue)}
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
            disabled={loading || mutating || !calendar}
            options={[{ value: "side_panel", label: t("notes.databaseTableOpenSidePanel") },
              { value: "full_page", label: t("notes.databaseTableOpenFullPage") }]}
            onChange={(nextValue) => updateRowOpenMode(nextValue as NotesDatabaseCalendarRowOpenMode)}
            triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
          />
        </div>
      </div>
    </NotesDatabaseMenu>

    <button
      type="button"
      class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      disabled={loading || mutating}
      aria-label={t("notes.databaseCalendarReload")}
      title={t("notes.databaseCalendarReload")}
      onclick={() => {
        void loadCalendar();
      }}
    >
      <RefreshCw class="size-3.5" aria-hidden="true" />
    </button>
  </div>

  <div class="flex min-w-0 flex-wrap items-center gap-2">
    <button
      type="button"
      class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      disabled={loading || mutating || !calendar}
      aria-label={t("notes.databaseCalendarPreviousMonth")}
      title={t("notes.databaseCalendarPreviousMonth")}
      onclick={() => shiftMonth(-1)}
    >
      <ChevronLeft class="size-3.5" aria-hidden="true" />
    </button>
    <div class="min-w-36 text-[0.933333rem] font-medium text-foreground">{monthLabel()}</div>
    <button
      type="button"
      class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      disabled={loading || mutating || !calendar}
      aria-label={t("notes.databaseCalendarNextMonth")}
      title={t("notes.databaseCalendarNextMonth")}
      onclick={() => shiftMonth(1)}
    >
      <ChevronRight class="size-3.5" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="inline-flex h-8 items-center rounded-md px-2 text-[0.8rem] hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      disabled={loading || mutating || !calendar}
      onclick={goToday}
    >
      {t("notes.databaseCalendarToday")}
    </button>
  </div>

  {#if calendar}
    {#if dateColumns.length === 0}
      <div class="rounded-md border border-border p-3 text-[0.866667rem] text-muted-foreground">
        {t("notes.databaseCalendarNoDateProperties")}
      </div>
    {:else}
      <div class="grid gap-2 @container">
        <div class="flex flex-wrap items-center gap-1">
          <NotesDatabaseMenu label={t("notes.databaseCalendarRowProperties")} kind="properties">

            <div class="mt-2 grid gap-1">
              {#each columns.filter((column) =>
                column.type !== "title" && column.id !== configuration.date_property_id
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
                  {#if filterConditionNeedsValue(filter.condition)}
                    <input
                      class="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={String(filter.value ?? "")}
                      disabled={mutating}
                      aria-label={t("notes.databaseTableFilterValue")}
                      oninput={(event) => updateFilter(index, { value: event.currentTarget.value })}
                      onkeydown={(event) => event.stopPropagation()}
                    />
                  {:else}
                    <div></div>
                  {/if}
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

        <div class="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-[0.8rem]">
          {#each weekdayLabels() as weekday}
            <div class="bg-muted px-2 py-1 text-center font-medium text-muted-foreground">{weekday}</div>
          {/each}
          {#each days as day (day.date)}
            <div class={`min-h-32 min-w-0 bg-background p-1 ${day.in_month ? "" : "opacity-45"}`}>
              <div class="mb-1 flex min-w-0 items-center justify-between gap-1">
                <span class="text-[0.8rem] font-medium text-muted-foreground">{dayNumber(day.date)}</span>
                {#if day.in_month && configuration.date_property_id}
                  <button
                    type="button"
                    class="inline-flex size-6 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                    disabled={loading || mutating}
                    aria-label={t("notes.databaseCalendarCreateOnDate", day.date)}
                    title={t("notes.databaseCalendarCreateOnDate", day.date)}
                    onclick={() => createRow(day.date)}
                  >
                    <Plus class="size-3" aria-hidden="true" />
                  </button>
                {/if}
              </div>
              {#if day.in_month && configuration.date_property_id}
                <input
                  class="mb-1 h-7 w-full rounded-sm border border-transparent bg-muted/40 px-1 text-[0.733333rem] text-foreground outline-none focus-visible:border-input focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
                  value={draftTitleByDate[day.date] ?? ""}
                  placeholder={t("notes.databaseRowsNewPlaceholder")}
                  disabled={loading || mutating}
                  oninput={(event) => updateDraftTitle(day.date, event.currentTarget.value)}
                  onkeydown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void createRow(day.date);
                    }
                  }}
                />
              {/if}
              <div class="grid gap-1">
                {#each day.rows as row (row.id)}
                  <div class="group grid min-w-0 gap-1 rounded-sm border border-border bg-muted/30 p-1">
                    <button
                      type="button"
                      class="min-w-0 truncate text-left text-[0.8rem] font-medium text-foreground hover:underline"
                      onclick={() => openRow(row)}
                    >
                      {rowTitle(row)}
                    </button>
                    {#if visibleColumns.length > 0}
                      <div class="grid gap-0.5">
                        {#each visibleColumns as column (column.id)}
                          {@const value = notesDatabaseCalendarRowText(row, column)}
                          {#if value}
                            <div class="min-w-0 truncate text-[0.733333rem] text-muted-foreground">
                              {column.name}: {value}
                            </div>
                          {/if}
                        {/each}
                      </div>
                    {/if}
                    <div class="flex min-w-0 items-center gap-1 opacity-100 @lg:opacity-0 @lg:group-focus-within:opacity-100 @lg:group-hover:opacity-100">
                      <button
                        type="button"
                        class="inline-flex size-6 items-center justify-center rounded-md hover:bg-accent"
                        aria-label={t("notes.databaseRowsOpen", rowTitle(row))}
                        title={t("notes.databaseRowsOpen", rowTitle(row))}
                        onclick={() => onSelectPage(row.id)}
                      >
                        <ExternalLink class="size-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="inline-flex size-6 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                        disabled={mutating}
                        aria-label={t("notes.duplicatePage")}
                        title={t("notes.duplicatePage")}
                        onclick={() => duplicateRow(row)}
                      >
                        <Copy class="size-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="inline-flex size-6 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
                        disabled={mutating}
                        aria-label={t("notes.databaseRowsTrash", rowTitle(row))}
                        title={t("notes.databaseRowsTrash", rowTitle(row))}
                        onclick={() => trashRow(row)}
                      >
                        <Trash2 class="size-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}

  {#if calendar}
    <NotesDatabaseWindowSentinel hasMore={calendar.has_more} loading={loadingMore} onLoad={loadMoreCalendar} />
  {/if}

  {#if selectedPanelRow}
    <aside class="rounded-md border border-border bg-background p-3 shadow-sm">
      <div class="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <FileText class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div class="min-w-0 truncate text-[0.933333rem] font-medium">{rowTitle(selectedPanelRow)}</div>
        </div>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-[0.8rem] hover:bg-accent"
          onclick={() => {
            selectedPanelRowId = null;
          }}
        >
          {t("common.close")}
        </button>
      </div>
      <div class="grid gap-1 text-[0.8rem] text-muted-foreground">
        {#each columns.filter((column) => column.type !== "title") as column (column.id)}
          {@const value = notesDatabaseCalendarRowText(selectedPanelRow, column)}
          {#if value}
            <div class="grid grid-cols-[8rem_minmax(0,1fr)] gap-2">
              <span class="truncate">{column.name}</span>
              <span class="min-w-0 truncate text-foreground">{value}</span>
            </div>
          {/if}
        {/each}
      </div>
      <button
        type="button"
        class="mt-3 inline-flex h-8 items-center gap-1 rounded-md px-2 text-[0.8rem] hover:bg-accent"
        onclick={() => onSelectPage(selectedPanelRow.id)}
      >
        <ExternalLink class="size-3.5" aria-hidden="true" />
        <span>{t("notes.databaseRowsOpen", rowTitle(selectedPanelRow))}</span>
      </button>
    </aside>
  {/if}
</section>
