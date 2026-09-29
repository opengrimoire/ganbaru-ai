<script lang="ts">
  import NotesDatabaseMenu from "./NotesDatabaseMenu.svelte";
  import CustomSelect from "$lib/components/settings/CustomSelect.svelte";
  import { tick } from "svelte";
  import { portal } from "$lib/utils/portal";
  import {
    beginLazyComponentLoad,
    rejectLazyComponentLoad,
    resolveLazyComponentLoad,
    type LazyComponentLoadState,
  } from "$lib/lazy-component-loader";
  import {
    applyNotesDataSourceTemplate,
    clickNotesDataSourceButton,
    createNotesDataSourceRowPage,
    createNotesDataSourceTemplateFromRow,
    deleteNotesDataSourceTemplate,
    duplicateNotesPage,
    getNotesDataSourceTableView,
    listNotesDataSourceTemplates,
    trashNotesPage,
    updateNotesDataSourceRowProperty,
    updateNotesDataSourceTableView,
  } from "$lib/api/notes";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { BUILD_PLATFORM_PROFILE, platformHasCapability } from "$lib/platform";
  import {
    notesDatabaseTableEditValuesEqual,
    notesDatabaseTableCellEditValue,
    notesDatabaseTableCellText,
    notesDatabaseTableColumnCanEdit,
    notesDatabaseTableColumns,
    notesDatabaseTableColumnWidth,
    notesDatabaseTableConfigurationFromView,
    notesDatabaseTableFiltersFromView,
    notesDatabaseTableSortsFromView,
    notesDatabaseTableUpdate,
    notesDatabaseTableVisibleColumns,
    type NotesDatabaseTableEditValue,
    type NotesDatabaseTableColumn,
  } from "$lib/notes/database-table";
  import NotesDatabaseRelationCell from "./NotesDatabaseRelationCell.svelte";
  import {
    loadNotesEditorPanel,
    retryNotesEditorPanel,
    type LoadedNotesEditorPanel,
  } from "./notes-editor-component-registry";
  import { NOTES_DATA_SOURCE_PROPERTY_TYPES } from "$lib/notes/types";
  import type {
    NotesDatabaseTableFilter,
    NotesDatabaseTableFilterCondition,
    NotesDatabaseTableRowOpenMode,
    NotesDatabaseTableSort,
    NotesDatabaseViewScope,
    NotesDataSourceTemplate,
    NotesDataSourceTableView,
    NotesDataSourcePropertyType,
    NotesPage,
  } from "$lib/notes/types";
  import Check from "@lucide/svelte/icons/check";
  import AlignLeft from "@lucide/svelte/icons/align-left";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import AtSign from "@lucide/svelte/icons/at-sign";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import ChevronsLeftRight from "@lucide/svelte/icons/chevrons-left-right";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import FileText from "@lucide/svelte/icons/file-text";
  import Fingerprint from "@lucide/svelte/icons/fingerprint";
  import Hash from "@lucide/svelte/icons/hash";
  import Link from "@lucide/svelte/icons/link";
  import List from "@lucide/svelte/icons/list";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Minus from "@lucide/svelte/icons/minus";
  import MousePointerClick from "@lucide/svelte/icons/mouse-pointer-click";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import Phone from "@lucide/svelte/icons/phone";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Sigma from "@lucide/svelte/icons/sigma";
  import SquareCheck from "@lucide/svelte/icons/square-check";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Users from "@lucide/svelte/icons/users";
  import X from "@lucide/svelte/icons/x";

  let {
    dataSourceId,
    databaseId = null,
    viewId = null,
    onSelectPage,
    onAddProperty,
    onEditProperties,
    newRowRequest = 0,
    settingsOpen = false,
    onCloseSettings,
    reloadKey = 0,
  }: {
    dataSourceId: string;
    databaseId?: string | null;
    viewId?: string | null;
    onSelectPage: (pageId: string) => void;
    onAddProperty: (type: NotesDataSourcePropertyType, name: string) => Promise<void>;
    onEditProperties: () => void;
    newRowRequest?: number;
    settingsOpen?: boolean;
    onCloseSettings: () => void;
    reloadKey?: number;
  } = $props();

  const { t } = getLocalization();
  const fileExportAvailable = platformHasCapability(
    BUILD_PLATFORM_PROFILE,
    "notes.file-export",
  );
  const FILTER_CONDITIONS: NotesDatabaseTableFilterCondition[] = [
    "contains",
    "equals",
    "is_empty",
    "is_not_empty",
    "checked",
    "unchecked",
  ];
  const propertyIcons = {
    title: AlignLeft,
    rich_text: AlignLeft,
    number: Hash,
    select: List,
    multi_select: List,
    status: List,
    date: CalendarDays,
    checkbox: SquareCheck,
    url: Link,
    email: AtSign,
    phone_number: Phone,
    files: Paperclip,
    people: Users,
    created_time: CalendarDays,
    created_by: Users,
    last_edited_time: CalendarDays,
    last_edited_by: Users,
    unique_id: Fingerprint,
    place: MapPin,
    relation: ArrowUpRight,
    rollup: Search,
    formula: Sigma,
    button: MousePointerClick,
  } satisfies Record<NotesDataSourcePropertyType, typeof AlignLeft>;

  let tableRoot: HTMLDivElement | null = $state(null);
  let table = $state<NotesDataSourceTableView | null>(null);
  let templates = $state<NotesDataSourceTemplate[]>([]);
  let loading = $state(false);
  let loadingMore = $state(false);
  let loadMoreSentinel: HTMLDivElement | null = $state(null);
  let tableRequestId = 0;
  let mutating = $state(false);
  let error = $state<string | null>(null);
  let draftTitle = $state("");
  let addingRow = $state(false);
  let newRowInput: HTMLInputElement | null = $state(null);
  let propertyName = $state("");
  let propertySearch = $state("");
  let handledNewRowRequest = $state(0);
  let templateName = $state("");
  let templateSourceRowId = $state("");
  let selectedTemplateId = $state("");
  let createTemplateAsDefault = $state(false);
  let selectedPanelRowId = $state<string | null>(null);
  let lastLoadSignature = $state("");
  let pendingFocusRowId = $state<string | null>(null);
  let csvPanelOpen = $state<"database-csv-import" | "database-csv-export" | null>(null);
  let csvPanelLoadState = $state<LazyComponentLoadState<
    "database-csv-import" | "database-csv-export",
    LoadedNotesEditorPanel
  > | null>(null);

  function requestCsvPanel(
    kind: "database-csv-import" | "database-csv-export",
    retry = false,
  ): void {
    csvPanelOpen = kind;
    if (!retry && csvPanelLoadState?.key === kind) return;
    const loadingState = beginLazyComponentLoad(csvPanelLoadState, kind);
    csvPanelLoadState = loadingState;
    const request = retry ? retryNotesEditorPanel(kind) : loadNotesEditorPanel(kind);
    void request.then((component) => {
      if (!csvPanelLoadState) return;
      csvPanelLoadState = resolveLazyComponentLoad(
        csvPanelLoadState,
        kind,
        loadingState.requestId,
        component,
      );
    }).catch((error: unknown) => {
      if (!csvPanelLoadState) return;
      csvPanelLoadState = rejectLazyComponentLoad(
        csvPanelLoadState,
        kind,
        loadingState.requestId,
        error,
      );
      console.error(`load Notes ${kind} panel failed`, error);
    });
  }

  function retryCsvPanel(): void {
    const kind = csvPanelLoadState?.key;
    if (kind) requestCsvPanel(kind, true);
  }

  const columns = $derived(table ? notesDatabaseTableColumns(table.data_source, table.view) : []);
  const visibleColumns = $derived(notesDatabaseTableVisibleColumns(columns));
  const filters = $derived(table ? notesDatabaseTableFiltersFromView(table.view) : []);
  const sorts = $derived(table ? notesDatabaseTableSortsFromView(table.view) : []);
  const rowOpenMode = $derived(
    table ? notesDatabaseTableConfigurationFromView(table.view).row_open_mode : "full_page",
  );
  const selectedPanelRow = $derived(
    table?.rows.find((row) => row.id === selectedPanelRowId) ?? null,
  );
  const propertyTypes = $derived(NOTES_DATA_SOURCE_PROPERTY_TYPES.filter((type) =>
    type !== "title" && propertyTypeLabel(type).toLocaleLowerCase().includes(propertySearch.toLocaleLowerCase()),
  ));

  function propertyTypeLabel(type: NotesDataSourcePropertyType): string {
    const keys = {
      title: "notes.databaseSchemaPropertyType.title",
      rich_text: "notes.databaseSchemaPropertyType.richText",
      number: "notes.databaseSchemaPropertyType.number",
      select: "notes.databaseSchemaPropertyType.select",
      multi_select: "notes.databaseSchemaPropertyType.multiSelect",
      status: "notes.databaseSchemaPropertyType.status",
      date: "notes.databaseSchemaPropertyType.date",
      checkbox: "notes.databaseSchemaPropertyType.checkbox",
      url: "notes.databaseSchemaPropertyType.url",
      email: "notes.databaseSchemaPropertyType.email",
      phone_number: "notes.databaseSchemaPropertyType.phoneNumber",
      files: "notes.databaseSchemaPropertyType.files",
      people: "notes.databaseSchemaPropertyType.people",
      created_time: "notes.databaseSchemaPropertyType.createdTime",
      created_by: "notes.databaseSchemaPropertyType.createdBy",
      last_edited_time: "notes.databaseSchemaPropertyType.lastEditedTime",
      last_edited_by: "notes.databaseSchemaPropertyType.lastEditedBy",
      unique_id: "notes.databaseSchemaPropertyType.uniqueId",
      place: "notes.databaseSchemaPropertyType.place",
      relation: "notes.databaseSchemaPropertyType.relation",
      rollup: "notes.databaseSchemaPropertyType.rollup",
      formula: "notes.databaseSchemaPropertyType.formula",
      button: "notes.databaseSchemaPropertyType.button",
    } as const;
    return t(keys[type]);
  }

  function beginRow(): void {
    addingRow = true;
    void tick().then(() => newRowInput?.focus());
  }

  $effect(() => {
    if (newRowRequest <= handledNewRowRequest) return;
    if (loading || mutating || !table) return;
    handledNewRowRequest = newRowRequest;
    void createRow();
  });

  async function addNewProperty(type: NotesDataSourcePropertyType): Promise<void> {
    if (mutating) return;
    mutating = true;
    error = null;
    try {
      await onAddProperty(type, propertyName);
      propertyName = "";
      propertySearch = "";
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  $effect(() => {
    const signature = `${dataSourceId}:${databaseId ?? ""}:${viewId ?? ""}:${reloadKey}`;
    if (signature === lastLoadSignature) return;
    lastLoadSignature = signature;
    void loadTable();
  });

  function viewScope(): NotesDatabaseViewScope {
    return { databaseId, viewId };
  }

  async function loadTable(): Promise<NotesDataSourceTableView | null> {
    const requestId = ++tableRequestId;
    loading = true;
    loadingMore = false;
    error = null;
    try {
      const [loaded, loadedTemplates] = await Promise.all([
        getNotesDataSourceTableView(dataSourceId, viewScope()),
        listNotesDataSourceTemplates(dataSourceId),
      ]);
      if (requestId !== tableRequestId) return null;
      table = loaded;
      templates = loadedTemplates;
      if (selectedPanelRowId && !loaded.rows.some((row) => row.id === selectedPanelRowId)) {
        selectedPanelRowId = null;
      }
      if (templateSourceRowId && !loaded.rows.some((row) => row.id === templateSourceRowId)) {
        templateSourceRowId = "";
      }
      if (selectedTemplateId && !loadedTemplates.some((template) => template.id === selectedTemplateId)) {
        selectedTemplateId = "";
      }
      if (!selectedTemplateId) {
        selectedTemplateId = loadedTemplates.find((template) => template.is_default)?.id ?? "";
      }
      await focusPendingRow(loaded);
      return loaded;
    } catch (caught) {
      if (requestId !== tableRequestId) return null;
      error = caught instanceof Error ? caught.message : String(caught);
      return null;
    } finally {
      if (requestId === tableRequestId) loading = false;
    }
  }

  async function loadMoreTableRows(): Promise<void> {
    const current = table;
    if (!current?.has_more || !current.next_cursor || loadingMore) return;
    const requestId = tableRequestId;
    loadingMore = true;
    try {
      const loaded = await getNotesDataSourceTableView(dataSourceId, viewScope(), {
        start_cursor: current.next_cursor,
      });
      if (requestId !== tableRequestId || table !== current) return;
      const rows = new Map(current.rows.map((row) => [row.id, row]));
      for (const row of loaded.rows) rows.set(row.id, row);
      table = { ...loaded, rows: [...rows.values()] };
    } catch (caught) {
      if (requestId === tableRequestId) error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (requestId === tableRequestId) loadingMore = false;
    }
  }

  $effect(() => {
    const sentinel = loadMoreSentinel;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreTableRows();
    }, { root: sentinel.closest("[data-notes-editor-scroll]") });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  async function focusPendingRow(loaded: NotesDataSourceTableView): Promise<void> {
    const rowId = pendingFocusRowId;
    pendingFocusRowId = null;
    if (!rowId) return;
    const rowIndex = loaded.rows.findIndex((row) => row.id === rowId);
    if (rowIndex < 0) return;
    await tick();
    focusCell(rowIndex, 0);
  }

  async function persistTable(
    nextColumns: NotesDatabaseTableColumn[],
    nextRowOpenMode: NotesDatabaseTableRowOpenMode,
    nextFilters: NotesDatabaseTableFilter[],
    nextSorts: NotesDatabaseTableSort[],
  ): Promise<void> {
    mutating = true;
    error = null;
    try {
      table = await updateNotesDataSourceTableView(
        dataSourceId,
        notesDatabaseTableUpdate(nextColumns, nextRowOpenMode, nextFilters, nextSorts),
        viewScope(),
      );
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function createRow(): Promise<void> {
    if (mutating || loading) return;
    const title = draftTitle.trim() || t("notes.untitled");
    mutating = true;
    error = null;
    try {
      const loaded = selectedTemplateId
        ? await applyNotesDataSourceTemplate(dataSourceId, selectedTemplateId, { title })
        : await createNotesDataSourceRowPage(dataSourceId, {
            id: crypto.randomUUID(),
            first_block_id: crypto.randomUUID(),
            title,
          });
      draftTitle = "";
      addingRow = false;
      pendingFocusRowId = loaded.page.id;
      await loadTable();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function createTemplateFromRow(): Promise<void> {
    const sourceRowId = templateSourceRowId || table?.rows[0]?.id || "";
    const name = templateName.trim();
    if (!sourceRowId || !name) return;
    mutating = true;
    error = null;
    try {
      const template = await createNotesDataSourceTemplateFromRow(dataSourceId, {
        id: crypto.randomUUID(),
        source_page_id: sourceRowId,
        name,
        is_default: createTemplateAsDefault,
      });
      templateName = "";
      templateSourceRowId = "";
      createTemplateAsDefault = false;
      selectedTemplateId = template.id;
      templates = await listNotesDataSourceTemplates(dataSourceId);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function deleteSelectedTemplate(): Promise<void> {
    const templateId = selectedTemplateId;
    if (!templateId) return;
    mutating = true;
    error = null;
    try {
      await deleteNotesDataSourceTemplate(dataSourceId, templateId);
      selectedTemplateId = "";
      templates = await listNotesDataSourceTemplates(dataSourceId);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function runButton(row: NotesPage, column: NotesDatabaseTableColumn): Promise<void> {
    const title = rowTitle(row);
    const confirmed = column.buttonRequiresConfirmation
      ? window.confirm(t("notes.databaseButtonConfirm", column.name, title))
      : false;
    if (column.buttonRequiresConfirmation && !confirmed) return;
    mutating = true;
    error = null;
    try {
      pendingFocusRowId = row.id;
      await clickNotesDataSourceButton(dataSourceId, row.id, {
        property_id: column.id,
        confirmed,
      });
      await loadTable();
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
      pendingFocusRowId = loaded.page.id;
      await loadTable();
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
      await loadTable();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  async function saveCell(
    row: NotesPage,
    column: NotesDatabaseTableColumn,
    value: NotesDatabaseTableEditValue,
  ): Promise<void> {
    const current = notesDatabaseTableCellEditValue(row, column);
    if (notesDatabaseTableEditValuesEqual(current, value)) return;
    mutating = true;
    error = null;
    try {
      pendingFocusRowId = row.id;
      await updateNotesDataSourceRowProperty(dataSourceId, row.id, {
        property_id: column.id,
        value,
      });
      await loadTable();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      mutating = false;
    }
  }

  function updateColumnVisibility(columnId: string, hidden: boolean): void {
    const nextColumns = columns.map((column) =>
      column.id === columnId ? { ...column, hidden } : { ...column },
    );
    void persistTable(nextColumns, rowOpenMode, filters, sorts);
  }

  function updateColumnWidth(columnId: string, delta: number): void {
    const nextColumns = columns.map((column) =>
      column.id === columnId
        ? { ...column, width: notesDatabaseTableColumnWidth(column, delta) }
        : { ...column },
    );
    void persistTable(nextColumns, rowOpenMode, filters, sorts);
  }

  function updateRowOpenMode(mode: NotesDatabaseTableRowOpenMode): void {
    void persistTable(columns.map((column) => ({ ...column })), mode, filters, sorts);
  }

  function addSort(): void {
    const firstColumn = columns[0];
    if (!firstColumn) return;
    const nextSorts = [
      ...sorts,
      { property_id: firstColumn.id, direction: "ascending" as const },
    ];
    void persistTable(columns.map((column) => ({ ...column })), rowOpenMode, filters, nextSorts);
  }

  function updateSort(index: number, patch: Partial<NotesDatabaseTableSort>): void {
    const nextSorts = sorts.map((sort, sortIndex) =>
      sortIndex === index ? { ...sort, ...patch } : sort,
    );
    void persistTable(columns.map((column) => ({ ...column })), rowOpenMode, filters, nextSorts);
  }

  function removeSort(index: number): void {
    const nextSorts = sorts.filter((_, sortIndex) => sortIndex !== index);
    void persistTable(columns.map((column) => ({ ...column })), rowOpenMode, filters, nextSorts);
  }

  function addFilter(): void {
    const firstColumn = columns[0];
    if (!firstColumn) return;
    const nextFilters = [
      ...filters,
      { property_id: firstColumn.id, condition: "contains" as const, value: "" },
    ];
    void persistTable(columns.map((column) => ({ ...column })), rowOpenMode, nextFilters, sorts);
  }

  function updateFilter(index: number, patch: Partial<NotesDatabaseTableFilter>): void {
    const nextFilters = filters.map((filter, filterIndex) => {
      if (filterIndex !== index) return filter;
      const next = { ...filter, ...patch };
      if (!filterConditionNeedsValue(next.condition)) next.value = null;
      return next;
    });
    void persistTable(columns.map((column) => ({ ...column })), rowOpenMode, nextFilters, sorts);
  }

  function removeFilter(index: number): void {
    const nextFilters = filters.filter((_, filterIndex) => filterIndex !== index);
    void persistTable(columns.map((column) => ({ ...column })), rowOpenMode, nextFilters, sorts);
  }

  function openRow(row: NotesPage): void {
    if (rowOpenMode === "side_panel") {
      selectedPanelRowId = row.id;
      return;
    }
    onSelectPage(row.id);
  }

  function rowTitle(row: NotesPage): string {
    const titleColumn = columns.find((column) => column.type === "title");
    const title = titleColumn ? notesDatabaseTableCellText(row, titleColumn).trim() : "";
    return title || t("notes.untitled");
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

  function rowOpenModeLabel(mode: NotesDatabaseTableRowOpenMode): string {
    return mode === "side_panel"
      ? t("notes.databaseTableOpenSidePanel")
      : t("notes.databaseTableOpenFullPage");
  }

  function handleCellKeydown(
    event: KeyboardEvent,
    rowIndex: number,
    columnIndex: number,
  ): void {
    event.stopPropagation();
    if (shouldKeepInputArrow(event)) return;
    if (event.defaultPrevented || (event.currentTarget instanceof HTMLElement && event.currentTarget.hasAttribute("aria-haspopup"))) return;
    const maxRowIndex = Math.max(0, (table?.rows.length ?? 1) - 1);
    const maxColumnIndex = Math.max(0, visibleColumns.length - 1);
    let nextRowIndex = rowIndex;
    let nextColumnIndex = columnIndex;
    if (event.key === "ArrowRight") nextColumnIndex = Math.min(maxColumnIndex, columnIndex + 1);
    else if (event.key === "ArrowLeft") nextColumnIndex = Math.max(0, columnIndex - 1);
    else if (event.key === "ArrowDown") nextRowIndex = Math.min(maxRowIndex, rowIndex + 1);
    else if (event.key === "ArrowUp") nextRowIndex = Math.max(0, rowIndex - 1);
    else if (event.key === "Enter") nextRowIndex = Math.min(maxRowIndex, rowIndex + 1);
    else return;
    event.preventDefault();
    focusCell(nextRowIndex, nextColumnIndex);
  }

  function shouldKeepInputArrow(event: KeyboardEvent): boolean {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement) || target.type === "checkbox") return false;
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? start;
    if (event.key === "ArrowLeft") return start > 0 || end > 0;
    if (event.key === "ArrowRight") return start < target.value.length || end < target.value.length;
    return false;
  }

  function focusCell(rowIndex: number, columnIndex: number): void {
    const selector = `[data-table-cell="true"][data-row-index="${rowIndex}"][data-column-index="${columnIndex}"]`;
    const target = tableRoot?.querySelector(selector);
    if (target instanceof HTMLElement) target.focus();
  }
</script>

<section class="space-y-3 pt-2" aria-label={t("notes.databaseTableTitle")}>
  <span class="sr-only" role="status">
    {#if loading}
      {t("notes.databaseTableLoading")}
    {:else}
      {t("notes.databaseRowsCount", table?.rows.length ?? 0)}
    {/if}
  </span>

  {#if error}
    <div class="flex items-center gap-2 text-[0.8rem] text-destructive" role="alert">
      <span>{error}</span>
      {#if !table}
        <button type="button" class="rounded-md px-2 py-1 hover:bg-destructive/10" onclick={() => { void loadTable(); }}>{t("common.retry")}</button>
      {/if}
    </div>
  {/if}

  {#if table}
    <div class="grid gap-2 @container">
      {#if settingsOpen}
        <div use:portal class="fixed inset-0 z-80 flex justify-end" data-app-floating-surface>
          <button type="button" class="absolute inset-0" aria-label={t("common.close")} onclick={onCloseSettings}></button>
          <div role="dialog" aria-modal="true" aria-label={t("notes.databaseViewSettings")} tabindex="-1" data-floating-root class="relative flex h-full w-full max-w-100 flex-col border-l border-border bg-background shadow-2xl" onkeydown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onCloseSettings(); } }}>
            <div class="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 class="text-sm font-semibold">{t("notes.databaseViewSettings")}</h3>
              <button type="button" class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent" aria-label={t("common.close")} onclick={onCloseSettings}><X class="size-4" /></button>
            </div>
            <div class="min-h-0 space-y-3 overflow-y-auto p-4">
              <div class="flex flex-col items-stretch gap-0.5">
              <NotesDatabaseMenu label={t("notes.databaseLayout")} fullWidth>
                <div class="grid gap-2">
                  <span>{t("notes.databaseTableOpenMode")}</span>
                  <CustomSelect inline appearance="quiet" contentAlign="start" class="w-full min-w-0" ariaLabel={t("notes.databaseTableOpenMode")} value={String(rowOpenMode ?? "")} disabled={loading || mutating || !table} options={[{ value: "full_page", label: String(rowOpenModeLabel("full_page")) }, { value: "side_panel", label: String(rowOpenModeLabel("side_panel")) }]} onChange={(nextValue) => updateRowOpenMode(nextValue as NotesDatabaseTableRowOpenMode)} triggerProps={{ "onkeydown": (event) => event.stopPropagation() }} />
                </div>
              </NotesDatabaseMenu>
                <NotesDatabaseMenu label={t("notes.databaseTableColumns")} kind="properties" fullWidth>

          <div class="mt-2 grid gap-1">
            {#each columns as column (column.id)}
              <label class="flex min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-accent/60">
                <input
                  type="checkbox"
                  checked={!column.hidden}
                  disabled={mutating || column.type === "title"}
                  onchange={(event) => updateColumnVisibility(column.id, !event.currentTarget.checked)}
                  onkeydown={(event) => event.stopPropagation()}
                />
                <span class="min-w-0 flex-1 truncate">{column.name}</span>
                {#if column.hidden}
                  <EyeOff class="size-3.5 text-muted-foreground" aria-hidden="true" />
                {:else}
                  <Eye class="size-3.5 text-muted-foreground" aria-hidden="true" />
                {/if}
              </label>
            {/each}
          </div>
        </NotesDatabaseMenu>

        <NotesDatabaseMenu label={t("notes.databaseTableSorts")} kind="sort" activeCount={sorts.length} fullWidth>

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

        <NotesDatabaseMenu label={t("notes.databaseTableFilters")} kind="filter" activeCount={filters.length} fullWidth>

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
        <NotesDatabaseMenu label={t("notes.databaseTemplatesTitle")} kind="layout" fullWidth>

          <div class="mt-2 grid min-w-0 gap-2 @lg:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_auto]">
            <div class="min-w-0 text-muted-foreground">
              <span class="mb-1 block">{t("notes.databaseTemplatesUse")}</span>
              <CustomSelect
                inline
                appearance="quiet"
                contentAlign="start"
                class="w-full min-w-0"
                ariaLabel={t("notes.databaseTemplatesUse")}
                value={String(selectedTemplateId ?? "")}
                disabled={mutating}
                options={[{ value: "", label: t("notes.databaseTemplatesNone") },
                  ...(templates).map((template) => ({ value: String(template.id), label: String(template.is_default ? t("notes.databaseTemplatesDefaultOption", template.name) : template.name) }))]}
                onChange={(nextValue) => {
                  selectedTemplateId = nextValue;
                }}
                triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
              />
            </div>
            <label class="min-w-0 text-muted-foreground">
              <span class="mb-1 block">{t("notes.databaseTemplatesName")}</span>
              <input
                class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                value={templateName}
                placeholder={t("notes.databaseTemplatesNamePlaceholder")}
                disabled={mutating}
                oninput={(event) => {
                  templateName = event.currentTarget.value;
                }}
                onkeydown={(event) => event.stopPropagation()}
              />
            </label>
            <div class="min-w-0 text-muted-foreground">
              <span class="mb-1 block">{t("notes.databaseTemplatesSourceRow")}</span>
              <CustomSelect
                inline
                appearance="quiet"
                contentAlign="start"
                class="w-full min-w-0"
                ariaLabel={t("notes.databaseTemplatesSourceRow")}
                value={String(templateSourceRowId ?? "")}
                disabled={mutating || table.rows.length === 0}
                options={[{ value: "", label: t("notes.databaseTemplatesFirstRow") },
                  ...(table.rows).map((row) => ({ value: String(row.id), label: String(rowTitle(row)) }))]}
                onChange={(nextValue) => {
                  templateSourceRowId = nextValue;
                }}
                triggerProps={{ "onkeydown": (event) => event.stopPropagation() }}
              />
            </div>
            <label class="flex min-w-0 items-center gap-2 text-muted-foreground">
              <input
                type="checkbox"
                checked={createTemplateAsDefault}
                disabled={mutating}
                onchange={(event) => {
                  createTemplateAsDefault = event.currentTarget.checked;
                }}
                onkeydown={(event) => event.stopPropagation()}
              />
              <span>{t("notes.databaseTemplatesMakeDefault")}</span>
            </label>
            <div class="flex min-w-0 flex-wrap items-center gap-1 @lg:col-span-2">
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                disabled={mutating || !templateName.trim() || table.rows.length === 0}
                onclick={() => {
                  void createTemplateFromRow();
                }}
              >
                <Plus class="size-3.5" aria-hidden="true" />
                <span>{t("notes.databaseTemplatesCreate")}</span>
              </button>
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-md text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
                disabled={mutating || !selectedTemplateId}
                onclick={() => {
                  void deleteSelectedTemplate();
                }}
              >
                <Trash2 class="size-3.5" aria-hidden="true" />
                <span>{t("notes.databaseTemplatesDelete")}</span>
              </button>
            </div>
          </div>
        </NotesDatabaseMenu>

        <div class="my-2 border-t border-border"></div>
        <button type="button" class="min-h-9 w-full rounded-md px-2 text-left text-[0.8rem] text-muted-foreground hover:bg-accent hover:text-foreground" onclick={() => { onCloseSettings(); onEditProperties(); }}>{t("notes.databaseViewEditProperties")}</button>
        <NotesDatabaseMenu label={t("notes.databaseMore")} kind="actions" fullWidth>
          <div class="grid gap-1">
            <button class="min-h-8 rounded-md px-2 text-left text-[0.8rem] hover:bg-accent" type="button" onclick={() => requestCsvPanel("database-csv-import")}>{t("notes.databaseCsvImportTitle")}</button>
            {#if fileExportAvailable}
              <button class="min-h-8 rounded-md px-2 text-left text-[0.8rem] hover:bg-accent" type="button" onclick={() => requestCsvPanel("database-csv-export")}>{t("notes.databaseCsvExportTitle")}</button>
            {/if}
          </div>
        </NotesDatabaseMenu>
              </div>
              <button type="button" class="min-h-9 w-full rounded-md px-2 text-left hover:bg-accent disabled:opacity-50" disabled={loading || mutating} onclick={() => { void loadTable(); }}>{t("notes.databaseTableReload")}</button>
            </div>
          </div>
        </div>
      {/if}

      {#if csvPanelOpen === "database-csv-import" && csvPanelLoadState?.status === "ready" && csvPanelLoadState.component.kind === "database-csv-import"}
        {@const NotesDatabaseCsvImportPanel = csvPanelLoadState.component.component}
        <NotesDatabaseCsvImportPanel
          {dataSourceId}
          disabled={mutating || loading}
          onImported={async () => {
            await loadTable();
          }}
        />
      {:else if fileExportAvailable && csvPanelOpen === "database-csv-export" && csvPanelLoadState?.status === "ready" && csvPanelLoadState.component.kind === "database-csv-export"}
        {@const NotesDatabaseCsvExportPanel = csvPanelLoadState.component.component}
        <NotesDatabaseCsvExportPanel
          {dataSourceId}
          {databaseId}
          {viewId}
          disabled={mutating || loading}
        />
      {:else if csvPanelOpen && csvPanelLoadState?.status === "failed"}
        <button class="min-h-8 rounded-md border border-border px-2 text-[0.8rem] hover:bg-accent" type="button" onclick={retryCsvPanel}>{t("common.retry")}</button>
      {/if}

      <div bind:this={tableRoot} class="min-w-0 overflow-x-auto border-y border-border/60">
        <table class="min-w-full border-collapse text-[0.866667rem]">
          <thead class="text-left text-[0.8rem] text-muted-foreground">
            <tr>
              <th class="w-8 border-b border-border px-1 py-1 font-medium">
                <span class="sr-only">{t("notes.databaseTableRowActions")}</span>
              </th>
              {#each visibleColumns as column (column.id)}
                <th
                  class="group/column border-b border-l border-border/60 px-2 py-1 font-medium"
                  style={`width: ${column.width}px; min-width: ${column.width}px;`}
                >
                  <div class="flex min-w-0 items-center gap-1">
                    {#if column.type === "title"}<span class="text-base font-semibold" aria-hidden="true">Aa</span>{/if}
                    <span class="min-w-0 flex-1 truncate">{column.name}</span>
                    <div class="flex items-center opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/column:opacity-100 [@media(hover:hover)]:group-focus-within/column:opacity-100">
                      <ChevronsLeftRight class="size-3.5 shrink-0" aria-hidden="true" />
                      <button
                        type="button"
                        class="inline-flex size-6 items-center justify-center rounded-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                        disabled={mutating}
                        aria-label={t("notes.databaseTableNarrowColumn", column.name)}
                        title={t("notes.databaseTableNarrowColumn", column.name)}
                        onclick={() => updateColumnWidth(column.id, -32)}
                      >
                        <Minus class="size-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="inline-flex size-6 items-center justify-center rounded-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                        disabled={mutating}
                        aria-label={t("notes.databaseTableWidenColumn", column.name)}
                        title={t("notes.databaseTableWidenColumn", column.name)}
                        onclick={() => updateColumnWidth(column.id, 32)}
                      >
                        <Plus class="size-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </th>
              {/each}
              <th class="min-w-40 border-b border-l border-border/60 px-1 py-1 font-normal">
                <NotesDatabaseMenu label={t("notes.databaseSchemaAddProperty")} kind="new" showHeader={false} dismissOnAction>
                  <input class="mb-2 h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring" aria-label={t("notes.databaseSchemaName")} placeholder={t("notes.databasePropertyNamePlaceholder")} bind:value={propertyName} onkeydown={(event) => event.stopPropagation()} />
                  <input class="mb-2 h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring" aria-label={t("notes.databasePropertySearchType")} placeholder={t("notes.databasePropertySearchType")} bind:value={propertySearch} onkeydown={(event) => event.stopPropagation()} />
                  <div class="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto">
                    {#each propertyTypes as type}
                      {@const Icon = propertyIcons[type]}
                      <button type="button" class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-accent" onclick={() => { void addNewProperty(type); }}><Icon class="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />{propertyTypeLabel(type)}</button>
                    {/each}
                  </div>
                </NotesDatabaseMenu>
              </th>
            </tr>
          </thead>
          <tbody>
            {#each table.rows as row, rowIndex (row.id)}
              {@const title = rowTitle(row)}
              <tr class="group/row h-11 border-b border-border/50 transition-colors last:border-b-0 hover:bg-accent/20">
                <td class="w-8 px-1 py-1 align-middle">
                  <NotesDatabaseMenu iconOnly kind="actions" label={t("notes.databaseTableRowActions")}>
                    <div class="grid gap-1">
                      <button
                        type="button"
                        class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                        aria-label={t("notes.databaseRowsOpen", title)}
                        title={t("notes.databaseRowsOpen", title)}
                        onclick={() => openRow(row)}
                      >
                        <FileText class="size-3.5" aria-hidden="true" />
                        <span class="truncate">{t("notes.databaseRowsOpen", title)}</span>
                      </button>
                      <button
                        type="button"
                        class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
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
                        class="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
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
                  </NotesDatabaseMenu>
                </td>
                {#each visibleColumns as column, columnIndex (column.id)}
                  {@const editValue = notesDatabaseTableCellEditValue(row, column)}
                  <td
                    class="border-l border-border/40 px-2 py-1 align-middle"
                    style={`width: ${column.width}px; min-width: ${column.width}px;`}
                  >
                    {#if column.type === "checkbox"}
                      <label class="flex h-8 items-center justify-center">
                        <input
                          data-table-cell="true"
                          data-row-index={rowIndex}
                          data-column-index={columnIndex}
                          type="checkbox"
                          checked={editValue === true}
                          disabled={mutating || !notesDatabaseTableColumnCanEdit(column)}
                          aria-label={column.name}
                          onchange={(event) => {
                            void saveCell(row, column, event.currentTarget.checked);
                          }}
                          onkeydown={(event) => handleCellKeydown(event, rowIndex, columnIndex)}
                        />
                      </label>
                    {:else if column.type === "select" || column.type === "status"}
                      <CustomSelect
                        inline
                        appearance="quiet"
                        contentAlign="start"
                        class="w-full min-w-0"
                        ariaLabel={column.name}
                        value={String(editValue)}
                        disabled={mutating || !notesDatabaseTableColumnCanEdit(column)}
                        options={[{ value: "", label: t("notes.databaseTableEmptyCell") },
                          ...(column.options).map((option) => ({ value: String(option.name), label: String(option.name) }))]}
                        onChange={(nextValue) => {
                          void saveCell(row, column, nextValue || null);
                        }}
                        triggerProps={{ "data-table-cell": "true", "data-row-index": rowIndex, "data-column-index": columnIndex, "onkeydown": (event) => handleCellKeydown(event, rowIndex, columnIndex) }}
                      />
                    {:else if column.type === "relation"}
                      <NotesDatabaseRelationCell
                        {row}
                        {column}
                        {rowIndex}
                        {columnIndex}
                        {mutating}
                        onSave={(value) => saveCell(row, column, value)}
                        onNavigate={handleCellKeydown}
                      />
                    {:else if column.type === "button"}
                      <button
                        data-table-cell="true"
                        data-row-index={rowIndex}
                        data-column-index={columnIndex}
                        type="button"
                        class="inline-flex h-8 w-full min-w-0 items-center justify-center gap-1 rounded-sm border border-input bg-background px-2 text-[0.8rem] text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                        disabled={mutating}
                        title={notesDatabaseTableCellText(row, column)}
                        onclick={() => {
                          void runButton(row, column);
                        }}
                        onkeydown={(event) => {
                          if (event.key === "Enter" || event.key === " ") return;
                          handleCellKeydown(event, rowIndex, columnIndex);
                        }}
                      >
                        <Check class="size-3.5 shrink-0" aria-hidden="true" />
                        <span class="min-w-0 truncate">
                          {notesDatabaseTableCellText(row, column) || column.buttonLabel || column.name}
                        </span>
                      </button>
                    {:else if notesDatabaseTableColumnCanEdit(column)}
                      <input
                        data-table-cell="true"
                        data-row-index={rowIndex}
                        data-column-index={columnIndex}
                        class="h-8 w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1 text-foreground outline-none hover:bg-accent/20 focus:bg-accent/20 focus:border-transparent focus-visible:ring-0 disabled:opacity-60"
                        value={String(editValue)}
                        inputmode={column.type === "number" ? "decimal" : "text"}
                        aria-label={column.name}
                        disabled={mutating}
                        onblur={(event) => {
                          void saveCell(row, column, event.currentTarget.value);
                        }}
                        onkeydown={(event) => handleCellKeydown(event, rowIndex, columnIndex)}
                      />
                    {:else}
                      <button
                        data-table-cell="true"
                        data-row-index={rowIndex}
                        data-column-index={columnIndex}
                        type="button"
                        class="flex h-8 w-full min-w-0 items-center rounded-sm px-1 text-left text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={t("notes.databaseTableReadonly")}
                        onkeydown={(event) => handleCellKeydown(event, rowIndex, columnIndex)}
                      >
                        <span class="min-w-0 truncate">
                          {notesDatabaseTableCellText(row, column) || t("notes.databaseTableEmptyCell")}
                        </span>
                      </button>
                    {/if}
                  </td>
                {/each}
                <td class="border-l border-border/40"></td>
              </tr>
            {/each}
            <tr class="h-11 border-b border-border/50 text-muted-foreground">
              <td></td>
              <td colspan={visibleColumns.length + 1} class="px-2">
                {#if addingRow}
                  <input bind:this={newRowInput} class="h-9 w-full bg-transparent px-1 text-foreground outline-none placeholder:text-muted-foreground" aria-label={t("notes.databaseRowsNewPlaceholder")} placeholder={t("notes.databaseRowsNewPlaceholder")} bind:value={draftTitle} onkeydown={(event) => { event.stopPropagation(); if (event.key === "Enter") { event.preventDefault(); void createRow(); } if (event.key === "Escape") { addingRow = false; draftTitle = ""; } }} />
                {:else}
                  <button type="button" class="flex min-h-9 w-full items-center gap-2 text-left hover:text-foreground" onclick={beginRow}><Plus class="size-4" aria-hidden="true" />{t("notes.databaseNewPage")}</button>
                {/if}
              </td>
            </tr>
            {#if table.rows.length === 0}
              {#each [0, 1] as placeholder}
                <tr class="h-11 border-b border-border/40" aria-hidden="true">
                  <td></td>
                  {#each visibleColumns as column (column.id)}<td class="border-l border-border/30"></td>{/each}
                  <td class="border-l border-border/30"></td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

      {#if table.has_more}
        <div bind:this={loadMoreSentinel} class="h-px" aria-hidden="true"></div>
        {#if loadingMore}
          <div class="py-2 text-center text-[0.8rem] text-muted-foreground" aria-busy="true">{t("common.loading")}</div>
        {/if}
      {/if}

      {#if visibleColumns.length === 0}
        <p class="text-[0.8rem] text-muted-foreground">{t("notes.databaseTableNoVisibleColumns")}</p>
      {/if}

      {#if rowOpenMode === "side_panel" && selectedPanelRow}
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
                    {notesDatabaseTableCellText(selectedPanelRow, column) || t("notes.databaseTableEmptyCell")}
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
      <span>{t("notes.databaseTableSaving")}</span>
    </p>
  {/if}
</section>
