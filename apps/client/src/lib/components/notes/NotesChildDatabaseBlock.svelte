<script lang="ts">
  import CollectionSaveIndicator from "$lib/components/collections/CollectionSaveIndicator.svelte";
  import CollectionMenu from "$lib/components/collections/CollectionMenu.svelte";
  import CustomSelect from "$lib/components/settings/CustomSelect.svelte";
  import { tick, untrack } from "svelte";
  import { portal } from "$lib/utils/portal";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    getNotesDataSourceSchema,
    getNotesDatabaseReference,
    listNotesDatabaseViews,
    listNotesDataSources,
    renameNotesDatabase,
    updateNotesDataSourceSchema,
  } from "$lib/api/notes";
  import NotesDatabaseRollupSchemaControls from "./NotesDatabaseRollupSchemaControls.svelte";
  import NotesDatabaseViewSurface from "./NotesDatabaseViewSurface.svelte";
  import {
    createNotesDataSourcePropertyDraft,
    defaultNotesDataSourcePropertyName,
    notesDataSourceButtonTargetOptions,
    notesDataSourceDefaultButtonPatch,
    notesDataSourceDefaultRollupPatch,
    notesDataSourceRollupRelationOptions,
    notesDataSourceRollupTargetOptions,
    notesDataSourceRollupTargetOptionsForRelation,
    notesDataSourceSchemaDraftFromDto,
    notesDataSourceSchemaUpdateFromDraft,
    notesDataSourceSyncPropertyReferences,
    type NotesDataSourceSchemaOptionDraft,
    type NotesDataSourceSchemaPropertyDraft,
  } from "$lib/notes/data-source-schema";
  import {
    NOTES_DATA_SOURCE_NUMBER_FORMATS,
    NOTES_DATA_SOURCE_PROPERTY_TYPES,
    NOTES_DATA_SOURCE_SELECT_COLORS,
    NOTES_DATA_SOURCE_STATUS_GROUPS,
    type NotesChildDatabaseBlock,
    type NotesDataSource,
    type NotesDataSourceNumberFormat,
    type NotesDataSourcePropertyType,
    type NotesDataSourceSchema,
    type NotesDataSourceSelectColor,
    type NotesDataSourceStatusGroup,
    type NotesDatabaseReference,
  } from "$lib/notes/types";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Database from "@lucide/svelte/icons/database";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Save from "@lucide/svelte/icons/save";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import Copy from "@lucide/svelte/icons/copy";
  import { buildNotesBlockLink } from "$lib/notes/block-link";

  let {
    block,
    focusBlockId,
    focusRequestId,
    onFocusBlock,
    onKeydown,
    onSelectPage,
    onCreateLinkedDatabaseView,
    onReady = () => {},
    onTitleSaved = () => {},
    onOpenDatabase,
    onDeleteDatabase,
  }: {
    block: NotesChildDatabaseBlock;
    focusBlockId: string | null;
    focusRequestId: number;
    onFocusBlock: (blockId: string) => void;
    onKeydown: (event: KeyboardEvent) => void;
    onSelectPage: (pageId: string) => void;
    onCreateLinkedDatabaseView: (blockId: string) => Promise<void> | void;
    onReady?: () => void;
    onTitleSaved?: (databaseId: string, title: string) => void;
    onOpenDatabase?: (blockId: string) => Promise<void | boolean> | void;
    onDeleteDatabase?: (blockId: string) => Promise<void | boolean> | void;
  } = $props();

  const localization = getLocalization();
  const { t } = localization;

  let titleInput: HTMLInputElement | null = $state(null);
  let expanded = $state(false);
  let titleDraft = $state(untrack(() => block.child_database.title));
  let savedTitle = $state(untrack(() => block.child_database.title));
  let titleSaving = $state(false);
  let viewSaving = $state(false);
  let contentReady = $state(false);
  let titleError = $state<string | null>(null);
  let reference = $state<NotesDatabaseReference | null>(null);
  let selectedPropertyId = $state<string | null>(null);
  let loading = $state(false);
  let saving = $state(false);
  let linking = $state(false);
  let error = $state<string | null>(null);
  let linkedViewError = $state<string | null>(null);
  let saved = $state(false);
  let dirty = $state(false);
  let schema = $state<NotesDataSourceSchema | null>(null);
  let schemaViewId = $state<string | null>(null);
  let schemaLoadPromise: Promise<void> | null = null;
  let availableDataSources = $state<NotesDataSource[]>([]);
  let properties = $state<NotesDataSourceSchemaPropertyDraft[]>([]);
  let newPropertyType = $state<NotesDataSourcePropertyType>("rich_text");
  let tableReloadKey = $state(0);
  let boardReloadKey = $state(0);
  let galleryReloadKey = $state(0);
  let listReloadKey = $state(0);
  let calendarReloadKey = $state(0);
  let timelineReloadKey = $state(0);

  const title = $derived(titleDraft.trim());
  const dataSourceId = $derived(block.child_database.data_source_id ?? null);
  const databaseId = $derived(block.child_database.database_id ?? null);
  const viewId = $derived(block.child_database.view_id ?? null);
  const localDatabase = $derived(
    block.child_database.database_id !== undefined
      && block.child_database.data_source_id !== undefined
      && block.child_database.view_id !== undefined,
  );
  const propertyCount = $derived(properties.length);

  /** Reveal this database and defer requested title focus until its surface can receive input. */
  function reportReady(): void {
    contentReady = true;
    onReady();
  }

  $effect(() => { if (!localDatabase || !dataSourceId) reportReady(); });

  $effect(() => {
    const incoming = block.child_database.title;
    if (titleSaving || incoming === savedTitle
      || (titleInput === document.activeElement && titleDraft.trim() !== savedTitle)) return;
    savedTitle = incoming;
    titleDraft = incoming;
  });

  $effect(() => {
    const id = block.id;
    if (!localDatabase) return;
    let cancelled = false;
    void getNotesDatabaseReference(id).then((value) => { if (!cancelled) reference = value; })
      .catch((caught: unknown) => { if (!cancelled) console.warn("Load database source reference failed", caught); });
    return () => { cancelled = true; };
  });

  async function openDatabase(id: string): Promise<void> {
    try { await onOpenDatabase?.(id); }
    catch (caught: unknown) { titleError = caught instanceof Error ? caught.message : String(caught); }
  }

  async function deleteDatabase(): Promise<void> {
    try { await onDeleteDatabase?.(block.id); }
    catch (caught: unknown) { titleError = caught instanceof Error ? caught.message : String(caught); }
  }

  async function copyDatabaseLink(): Promise<void> {
    try {
      const destination = reference ?? await getNotesDatabaseReference(block.id);
      await navigator.clipboard.writeText(buildNotesBlockLink(window.location.href, { pageId: destination.page_id, blockId: destination.block_id }));
    } catch (caught: unknown) { titleError = caught instanceof Error ? caught.message : String(caught); }
  }

  $effect(() => {
    const _focusRequestId = focusRequestId;
    if (!contentReady || focusBlockId !== block.id) return;
    void tick().then(() => {
      if (focusBlockId === block.id && _focusRequestId === focusRequestId
        && !titleInput?.closest("[inert], [hidden]")) titleInput?.focus({ preventScroll: true });
    });
  });

  function loadSchema(): Promise<void> {
    if (schemaLoadPromise) return schemaLoadPromise;
    schemaLoadPromise = performLoadSchema().finally(() => { schemaLoadPromise = null; });
    return schemaLoadPromise;
  }

  async function performLoadSchema(): Promise<void> {
    if (!dataSourceId) return;
    loading = true;
    error = null;
    try {
      const [views, dataSources] = await Promise.all([
        databaseId ? listNotesDatabaseViews(databaseId) : Promise.resolve([]),
        listNotesDataSources(),
      ]);
      const tableViewId = views.find((view) => view.type === "table")?.id ?? null;
      const loaded = await getNotesDataSourceSchema(dataSourceId, { databaseId, viewId: tableViewId });
      schema = loaded;
      schemaViewId = tableViewId;
      availableDataSources = dataSources;
      properties = notesDataSourceSchemaDraftFromDto(loaded.data_source, loaded.view);
      selectedPropertyId = properties[0]?.id ?? null;
      dirty = false;
      saved = false;
      tableReloadKey += 1;
      boardReloadKey += 1;
      galleryReloadKey += 1;
      listReloadKey += 1;
      calendarReloadKey += 1;
      timelineReloadKey += 1;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      loading = false;
    }
  }

  async function saveSchema(nextProperties: NotesDataSourceSchemaPropertyDraft[] = properties): Promise<boolean> {
    if (!dataSourceId) return false;
    saving = true;
    error = null;
    try {
      const update = notesDataSourceSchemaUpdateFromDraft(nextProperties);
      const updated = await updateNotesDataSourceSchema(dataSourceId, update, { databaseId, viewId: schemaViewId });
      schema = updated;
      properties = notesDataSourceSchemaDraftFromDto(updated.data_source, updated.view);
      dirty = false;
      saved = true;
      tableReloadKey += 1;
      boardReloadKey += 1;
      galleryReloadKey += 1;
      listReloadKey += 1;
      calendarReloadKey += 1;
      timelineReloadKey += 1;
      return true;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      return false;
    } finally {
      saving = false;
    }
  }

  async function saveTitle(): Promise<void> {
    const renamedDatabaseId = databaseId;
    const acknowledgeTitle = onTitleSaved;
    if (!renamedDatabaseId || titleSaving) return;
    const nextTitle = titleDraft.trim();
    if (nextTitle === savedTitle) return;
    titleSaving = true;
    titleError = null;
    try {
      titleDraft = await renameNotesDatabase(renamedDatabaseId, nextTitle);
      savedTitle = titleDraft;
      acknowledgeTitle(renamedDatabaseId, savedTitle);
    } catch (caught) {
      titleDraft = savedTitle;
      titleError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      titleSaving = false;
    }
  }

  async function createLinkedView(): Promise<void> {
    if (linking) return;
    linking = true;
    linkedViewError = null;
    try {
      await onCreateLinkedDatabaseView(block.id);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      linkedViewError = t("notes.databaseLinkedViewCreateFailed", message);
    } finally {
      linking = false;
    }
  }

  function markDirty(next: NotesDataSourceSchemaPropertyDraft[]): void {
    properties = next;
    dirty = true;
    saved = false;
  }

  function updateProperty(
    propertyId: string,
    patch: Partial<NotesDataSourceSchemaPropertyDraft>,
  ): void {
    const nextProperties = properties.map((property) => {
      if (property.id !== propertyId) return property;
      const nextType = patch.type ?? property.type;
      const next: NotesDataSourceSchemaPropertyDraft = {
        ...property,
        ...patch,
        type: nextType,
      };
      if (nextType === "status" && next.options.length === 0) {
        next.options = createNotesDataSourcePropertyDraft("status", "Status").options;
      }
      if (nextType !== "select" && nextType !== "multi_select" && nextType !== "status") {
        next.options = [];
      }
      if (nextType === "relation" && !next.relationDataSourceId) {
        next.relationDataSourceId = dataSourceId ?? "";
      }
      if (nextType !== "relation") {
        next.relationDataSourceId = "";
        next.relationSyncedPropertyId = "";
        next.relationSyncedPropertyName = "";
      }
      if (nextType === "rollup" && !next.rollupRelationPropertyId) {
        Object.assign(next, notesDataSourceDefaultRollupPatch(
          properties,
          property.id,
          dataSourceId,
          rollupDataSources(),
        ));
      }
      if (nextType === "formula" && !next.formulaExpression.trim()) {
        next.formulaExpression = defaultFormulaExpression(property.id);
      }
      if (nextType === "button") {
        if (!next.buttonLabel.trim()) next.buttonLabel = next.name || t("notes.databaseSchemaButtonDefaultLabel");
        if (!next.buttonActionPropertyId) {
          Object.assign(next, notesDataSourceDefaultButtonPatch(properties, property.id));
        }
      }
      if (nextType !== "rollup") {
        next.rollupRelationPropertyId = "";
        next.rollupRelationPropertyName = "";
        next.rollupPropertyId = "";
        next.rollupPropertyName = "";
        next.rollupFunction = "count";
      }
      if (nextType !== "formula") {
        next.formulaExpression = "";
      }
      if (nextType !== "button") {
        next.buttonLabel = "";
        next.buttonRequiresConfirmation = false;
        next.buttonActionPropertyId = "";
        next.buttonActionPropertyName = "";
        next.buttonActionPropertyType = "checkbox";
        next.buttonActionValue = true;
      }
      if (nextType === "title") next.hidden = false;
      return next;
    });
    markDirty(notesDataSourceSyncPropertyReferences(nextProperties, dataSourceId, rollupDataSources()));
  }

  function addProperty(): void {
    const name = defaultNotesDataSourcePropertyName(newPropertyType, properties);
    const property = createNotesDataSourcePropertyDraft(newPropertyType, name);
    if (newPropertyType === "relation") {
      property.relationDataSourceId = dataSourceId ?? "";
    }
    if (newPropertyType === "rollup") {
      Object.assign(property, notesDataSourceDefaultRollupPatch(
        properties,
        property.id,
        dataSourceId,
        rollupDataSources(),
      ));
    }
    if (newPropertyType === "formula") {
      property.formulaExpression = defaultFormulaExpression(property.id);
    }
    if (newPropertyType === "button") {
      Object.assign(property, notesDataSourceDefaultButtonPatch(properties, property.id));
    }
    markDirty([...properties, property]);
    selectedPropertyId = property.id;
  }

  async function addPropertyFromView(type: NotesDataSourcePropertyType, rawName: string): Promise<void> {
    if (schemaLoadPromise) await schemaLoadPromise;
    if (!schema) await loadSchema();
    if (!schema) throw new Error(error ?? t("notes.databaseSchemaLoadFailed", ""));
    const previous = properties;
    const wasDirty = dirty;
    const name = rawName.trim() || defaultNotesDataSourcePropertyName(type, properties);
    const property = createNotesDataSourcePropertyDraft(type, name);
    if (type === "relation") property.relationDataSourceId = dataSourceId ?? "";
    if (type === "rollup") Object.assign(property, notesDataSourceDefaultRollupPatch(properties, property.id, dataSourceId, rollupDataSources()));
    if (type === "formula") property.formulaExpression = defaultFormulaExpression(property.id);
    if (type === "button") Object.assign(property, notesDataSourceDefaultButtonPatch(properties, property.id));
    const next = [...properties, property];
    markDirty(next);
    if (!(await saveSchema(next))) {
      properties = previous;
      dirty = wasDirty;
      throw new Error(error ?? t("notes.databaseSchemaSaveFailed", ""));
    }
  }

  function deleteProperty(propertyId: string): void {
    const next = properties.filter((property) => property.id !== propertyId || property.type === "title");
    markDirty(next);
    if (selectedPropertyId === propertyId) selectedPropertyId = next[0]?.id ?? null;
  }

  function moveProperty(propertyId: string, direction: -1 | 1): void {
    const index = properties.findIndex((property) => property.id === propertyId);
    if (index < 0) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= properties.length) return;
    const next = [...properties];
    const [property] = next.splice(index, 1);
    if (!property) return;
    next.splice(nextIndex, 0, property);
    markDirty(next);
  }

  function addOption(propertyId: string): void {
    const property = properties.find((item) => item.id === propertyId);
    if (!property) return;
    const option: NotesDataSourceSchemaOptionDraft = {
      id: crypto.randomUUID(),
      name: `Option ${property.options.length + 1}`,
      color: "default",
      group: "To-do",
    };
    updateProperty(propertyId, { options: [...property.options, option] });
  }

  function updateOption(
    propertyId: string,
    optionId: string,
    patch: Partial<NotesDataSourceSchemaOptionDraft>,
  ): void {
    const property = properties.find((item) => item.id === propertyId);
    if (!property) return;
    updateProperty(propertyId, {
      options: property.options.map((option) =>
        option.id === optionId ? { ...option, ...patch } : option,
      ),
    });
  }

  function deleteOption(propertyId: string, optionId: string): void {
    const property = properties.find((item) => item.id === propertyId);
    if (!property) return;
    updateProperty(propertyId, {
      options: property.options.filter((option) => option.id !== optionId),
    });
  }

  function propertyTypeLabel(type: NotesDataSourcePropertyType): string {
    switch (type) {
      case "title":
        return t("notes.databaseSchemaPropertyType.title");
      case "rich_text":
        return t("notes.databaseSchemaPropertyType.richText");
      case "number":
        return t("notes.databaseSchemaPropertyType.number");
      case "select":
        return t("notes.databaseSchemaPropertyType.select");
      case "multi_select":
        return t("notes.databaseSchemaPropertyType.multiSelect");
      case "status":
        return t("notes.databaseSchemaPropertyType.status");
      case "date":
        return t("notes.databaseSchemaPropertyType.date");
      case "checkbox":
        return t("notes.databaseSchemaPropertyType.checkbox");
      case "url":
        return t("notes.databaseSchemaPropertyType.url");
      case "email":
        return t("notes.databaseSchemaPropertyType.email");
      case "phone_number":
        return t("notes.databaseSchemaPropertyType.phoneNumber");
      case "files":
        return t("notes.databaseSchemaPropertyType.files");
      case "people":
        return t("notes.databaseSchemaPropertyType.people");
      case "created_time":
        return t("notes.databaseSchemaPropertyType.createdTime");
      case "created_by":
        return t("notes.databaseSchemaPropertyType.createdBy");
      case "last_edited_time":
        return t("notes.databaseSchemaPropertyType.lastEditedTime");
      case "last_edited_by":
        return t("notes.databaseSchemaPropertyType.lastEditedBy");
      case "unique_id":
        return t("notes.databaseSchemaPropertyType.uniqueId");
      case "place":
        return t("notes.databaseSchemaPropertyType.place");
      case "relation":
        return t("notes.databaseSchemaPropertyType.relation");
      case "rollup":
        return t("notes.databaseSchemaPropertyType.rollup");
      case "formula":
        return t("notes.databaseSchemaPropertyType.formula");
      case "button":
        return t("notes.databaseSchemaPropertyType.button");
    }
  }

  function updateButtonTarget(
    property: NotesDataSourceSchemaPropertyDraft,
    targetId: string,
  ): void {
    const target = notesDataSourceButtonTargetOptions(properties, property.id)
      .find((candidate) => candidate.id === targetId) ?? null;
    updateProperty(property.id, {
      buttonActionPropertyId: target?.id ?? "",
      buttonActionPropertyName: target?.name ?? "",
      buttonActionPropertyType: target?.type ?? "checkbox",
      buttonActionValue: target ? defaultButtonValue(target.type) : true,
    });
  }

  function updateButtonValue(
    property: NotesDataSourceSchemaPropertyDraft,
    value: string | boolean,
  ): void {
    updateProperty(property.id, { buttonActionValue: value });
  }

  function defaultButtonValue(type: NotesDataSourcePropertyType): string | boolean {
    return type === "checkbox" ? true : "";
  }

  function buttonActionValueText(value: unknown): string {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  }

  function defaultFormulaExpression(excludePropertyId: string): string {
    const target = properties.find((property) =>
      property.id !== excludePropertyId
      && property.type !== "formula"
      && property.type !== "rollup"
    );
    return target ? `prop("${escapeFormulaPropertyName(target.name)}")` : "\"\"";
  }

  function escapeFormulaPropertyName(name: string): string {
    return name.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  function dataSourceTitle(source: NotesDataSource): string {
    return source.title.trim() || t("notes.untitled");
  }

  function rollupDataSources(): NotesDataSource[] {
    const currentSchema = schema;
    if (!currentSchema) return availableDataSources;
    return [
      currentSchema.data_source,
      ...availableDataSources.filter((source) => source.id !== currentSchema.data_source.id),
    ];
  }

  function updateRollupRelation(property: NotesDataSourceSchemaPropertyDraft, relationId: string): void {
    const relation = properties.find((candidate) =>
      candidate.id === relationId && candidate.type === "relation"
    ) ?? null;
    const target = relation
      ? notesDataSourceRollupTargetOptionsForRelation(
          relation,
          properties,
          dataSourceId,
          rollupDataSources(),
        )[0] ?? null
      : null;
    updateProperty(property.id, {
      rollupRelationPropertyId: relation?.id ?? "",
      rollupRelationPropertyName: relation?.name ?? "",
      rollupPropertyId: target?.id ?? "",
      rollupPropertyName: target?.name ?? "",
    });
  }

  function updateRollupTarget(property: NotesDataSourceSchemaPropertyDraft, targetId: string): void {
    const target = notesDataSourceRollupTargetOptions(
      property,
      properties,
      dataSourceId,
      rollupDataSources(),
    ).find((option) => option.id === targetId) ?? null;
    updateProperty(property.id, {
      rollupPropertyId: target?.id ?? "",
      rollupPropertyName: target?.name ?? "",
    });
  }

  function statusMessage(): string {
    if (loading) return t("notes.databaseSchemaLoading");
    if (saving) return t("notes.databaseSchemaSave");
    if (dirty) return t("notes.databaseSchemaUnsaved");
    if (saved) return t("notes.databaseSchemaSaved");
    return t("notes.databaseSchemaPropertyCount", propertyCount);
  }
</script>

<section
  class="my-5 min-w-0 space-y-1"
  aria-label={t("notes.blockType.childDatabase")}
>
  <div class="flex min-w-0 items-center gap-2 px-1">
    {#if reference?.is_linked && onOpenDatabase}
      <button type="button" class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t("notes.databaseOpenSource")} title={t("notes.databaseOpenSource")} onclick={() => void openDatabase(reference!.source_block_id)}>
        <ArrowUpRight class="size-5" strokeWidth={1.75} aria-hidden="true" />
      </button>
    {/if}
    {#if localDatabase}
      <input
        bind:this={titleInput}
        data-notes-database-title
        class="min-h-10 min-w-0 flex-1 border-0 bg-transparent px-0 text-[1.4rem] font-semibold leading-tight text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-0"
        aria-label={t("notes.databaseTitle")}
        placeholder={t("notes.databaseNewTitle")}
        bind:value={titleDraft}
        disabled={titleSaving}
        onfocus={() => onFocusBlock(block.id)}
        onblur={() => { void saveTitle(); }}
        onkeydown={(event) => {
          if (!event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
            && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;
          event.stopPropagation();
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        }}
      />
    {:else}
      <Database class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <button type="button" class="min-h-9 min-w-0 flex-1 truncate text-left text-base font-semibold" onkeydown={onKeydown} onclick={() => onFocusBlock(block.id)}>{title || t("notes.untitled")}</button>
      <span class="text-[0.8rem] text-muted-foreground">{t("notes.childDatabasePreserved")}</span>
    {/if}
    {#if localDatabase}
      <CollectionSaveIndicator pending={saving || titleSaving || linking || viewSaving} label={t("notes.databaseSaving")} />
      <CollectionMenu label={t("notes.databaseMore")} kind="actions" iconOnly showHeader={false}>
        {#if onOpenDatabase}
          <button type="button" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent" onclick={() => void openDatabase(block.id)}>
            <ArrowUpRight class="size-4" aria-hidden="true" />{t("notes.databaseOpen")}
          </button>
        {/if}
        <button type="button" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent" onclick={() => void copyDatabaseLink()}>
          <Copy class="size-4" aria-hidden="true" />{t("notes.databaseCopyLink")}
        </button>
        {#if onDeleteDatabase}
          <div class="mx-2 my-1 border-t border-border"></div>
          <button type="button" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-destructive hover:bg-accent" onclick={() => void deleteDatabase()}>
            <Trash2 class="size-4" aria-hidden="true" />{t("notes.databaseMoveToTrash")}
          </button>
        {/if}
      </CollectionMenu>
    {/if}
  </div>
  {#if titleError}
    <p class="px-1 text-[0.8rem] text-destructive" role="alert">{titleError}</p>
  {/if}
  {#if linkedViewError}
    <p class="mt-2 text-[0.8rem] text-destructive">{linkedViewError}</p>
  {/if}

  {#if localDatabase && dataSourceId}
    <NotesDatabaseViewSurface
      onReady={reportReady}
      onSavingChange={(pending) => { viewSaving = pending; }}
      {dataSourceId}
      {databaseId}
      initialViewId={viewId}
      {onSelectPage}
      onEditProperties={() => { expanded = true; if (!schema) void loadSchema(); }}
      onCreateLinkedDatabaseView={() => { void createLinkedView(); }}
      onAddProperty={addPropertyFromView}
      reloadKeys={{
        table: tableReloadKey,
        board: boardReloadKey,
        gallery: galleryReloadKey,
        list: listReloadKey,
        calendar: calendarReloadKey,
        timeline: timelineReloadKey,
      }}
    />
  {/if}
</section>

{#if localDatabase && expanded}
  <div use:portal class="fixed inset-0 z-80 flex justify-end" data-app-floating-surface>
    <button type="button" class="absolute inset-0" aria-label={t("common.close")} onclick={() => { expanded = false; }}></button>
    <div role="dialog" aria-modal="true" aria-label={t("notes.databaseViewEditProperties")} tabindex="-1" data-floating-root class="relative flex h-full w-full max-w-100 flex-col border-l border-border bg-background shadow-2xl" onkeydown={(event) => { if (event.key === "Escape") { event.stopPropagation(); expanded = false; } }}>
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 class="text-sm font-semibold">{t("notes.databaseViewEditProperties")}</h3>
        <button type="button" class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={t("common.close")} onclick={() => { expanded = false; }}><X class="size-4" /></button>
      </div>
      <div class="min-h-0 space-y-3 overflow-y-auto p-4">
      <div class="flex min-w-0 flex-wrap items-center gap-2 text-[0.8rem] text-muted-foreground">
        <span class="min-w-0 flex-1 truncate" role="status">
          {#if error}
            {schema
              ? t("notes.databaseSchemaSaveFailed", error)
              : t("notes.databaseSchemaLoadFailed", error)}
          {:else}
            {statusMessage()}
          {/if}
        </span>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-accent disabled:pointer-events-none"
          disabled={loading || saving}
          aria-label={t("notes.databaseSchemaReload")}
          title={t("notes.databaseSchemaReload")}
          onclick={() => {
            void loadSchema();
          }}
        >
          <RefreshCw class="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2 text-primary-foreground disabled:pointer-events-none"
          disabled={loading || saving || !dirty}
          onclick={() => {
            void saveSchema();
          }}
        >
          <Save class="size-3.5" aria-hidden="true" />
          <span>{t("notes.databaseSchemaSave")}</span>
        </button>
      </div>

      <div class="flex flex-wrap gap-1 border-b border-border pb-3">
        {#each properties as property (property.id)}
          <button type="button" class="min-h-8 rounded-md px-2 text-left text-[0.8rem] hover:bg-accent" class:bg-accent={selectedPropertyId === property.id} class:text-foreground={selectedPropertyId === property.id} class:text-muted-foreground={selectedPropertyId !== property.id} onclick={() => { selectedPropertyId = property.id; }}>
            {property.name || t("notes.databaseSchemaName")}
          </button>
        {/each}
      </div>
      <div class="space-y-2">
        {#each properties.filter((property) => property.id === selectedPropertyId) as property (property.id)}
          {@const index = properties.findIndex((candidate) => candidate.id === property.id)}
          <div class="grid min-w-0 gap-3 @container">
            <div class="grid min-w-0 gap-2 @lg:grid-cols-[minmax(7rem,1fr)_minmax(7rem,12rem)_auto]">
              <label class="min-w-0 text-[0.733333rem] text-muted-foreground">
                <span class="mb-1 block">{t("notes.databaseSchemaName")}</span>
                <input
                  class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus:border-ring"
                  value={property.name}
                  disabled={saving}
                  oninput={(event) => {
                    updateProperty(property.id, {
                      name: event.currentTarget.value,
                    });
                  }}
                />
              </label>
              <div class="min-w-0 text-[0.733333rem] text-muted-foreground">
                <span class="mb-1 block">{t("notes.databaseSchemaType")}</span>
                <CustomSelect
                  inline
                  appearance="quiet"
                  contentAlign="start"
                  class="w-full min-w-0"
                  ariaLabel={t("notes.databaseSchemaType")}
                  value={String(property.type ?? "")}
                  disabled={saving || property.type === "title"}
                  options={[...(NOTES_DATA_SOURCE_PROPERTY_TYPES).map((type) => ({ value: String(type), label: String(propertyTypeLabel(type)) }))]}
                  onChange={(nextValue) => {
                    updateProperty(property.id, {
                        type: nextValue as NotesDataSourcePropertyType,
                    });
                  }}
                />
              </div>
              <div class="flex min-w-0 items-end justify-end gap-1">
                <button
                  type="button"
                  class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none"
                  disabled={saving || index === 0}
                  aria-label={t("notes.databaseSchemaMoveUp")}
                  title={t("notes.databaseSchemaMoveUp")}
                  onclick={() => moveProperty(property.id, -1)}
                >
                  <ArrowUp class="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none"
                  disabled={saving || index === properties.length - 1}
                  aria-label={t("notes.databaseSchemaMoveDown")}
                  title={t("notes.databaseSchemaMoveDown")}
                  onclick={() => moveProperty(property.id, 1)}
                >
                  <ArrowDown class="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none"
                  disabled={saving || property.type === "title"}
                  aria-label={property.hidden ? t("notes.databaseSchemaShow") : t("notes.databaseSchemaHide")}
                  title={property.hidden ? t("notes.databaseSchemaShow") : t("notes.databaseSchemaHide")}
                  onclick={() => updateProperty(property.id, { hidden: !property.hidden })}
                >
                  {#if property.hidden}
                    <EyeOff class="size-3.5" aria-hidden="true" />
                  {:else}
                    <Eye class="size-3.5" aria-hidden="true" />
                  {/if}
                </button>
                <button
                  type="button"
                  class="inline-flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:pointer-events-none"
                  disabled={saving || property.type === "title"}
                  aria-label={t("notes.databaseSchemaDelete")}
                  title={t("notes.databaseSchemaDelete")}
                  onclick={() => deleteProperty(property.id)}
                >
                  <Trash2 class="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <label class="min-w-0 text-[0.733333rem] text-muted-foreground">
              <span class="mb-1 block">{t("notes.databaseSchemaDescription")}</span>
              <input
                class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus:border-ring"
                value={property.description}
                placeholder={t("notes.databaseSchemaDescriptionPlaceholder")}
                disabled={saving}
                oninput={(event) => {
                  updateProperty(property.id, {
                    description: event.currentTarget.value,
                  });
                }}
              />
            </label>

            {#if property.type === "number"}
              <div class="min-w-0 text-[0.733333rem] text-muted-foreground">
                <span class="mb-1 block">{t("notes.databaseSchemaNumberFormat")}</span>
                <CustomSelect
                  inline
                  appearance="quiet"
                  contentAlign="start"
                  class="w-full min-w-0"
                  ariaLabel={t("notes.databaseSchemaNumberFormat")}
                  value={String(property.numberFormat ?? "")}
                  options={[...(NOTES_DATA_SOURCE_NUMBER_FORMATS).map((format) => ({ value: String(format), label: String(format) }))]}
                  onChange={(nextValue) => {
                    updateProperty(property.id, {
                        numberFormat: nextValue as NotesDataSourceNumberFormat,
                    });
                  }}
                />
              </div>
            {:else if property.type === "unique_id"}
              <label class="min-w-0 text-[0.733333rem] text-muted-foreground">
                <span class="mb-1 block">{t("notes.databaseSchemaUniquePrefix")}</span>
                <input
                  class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus:border-ring"
                  value={property.uniquePrefix}
                  placeholder={t("notes.databaseSchemaUniquePrefixPlaceholder")}
                  oninput={(event) => {
                    updateProperty(property.id, {
                      uniquePrefix: event.currentTarget.value,
                    });
                  }}
                />
              </label>
            {:else if property.type === "relation"}
              <div class="grid min-w-0 gap-2 @lg:grid-cols-3">
                <div class="min-w-0 text-[0.733333rem] text-muted-foreground">
                  <span class="mb-1 block">{t("notes.databaseSchemaRelationTarget")}</span>
                  <CustomSelect
                    inline
                    appearance="quiet"
                    contentAlign="start"
                    class="w-full min-w-0"
                    ariaLabel={t("notes.databaseSchemaRelationTarget")}
                    value={String(property.relationDataSourceId ?? "")}
                    options={[...(property.relationDataSourceId && !availableDataSources.some((source) => source.id === property.relationDataSourceId) ? [{ value: String(property.relationDataSourceId), label: String(property.relationDataSourceId) }] : []),
                      ...(availableDataSources).map((source) => ({ value: String(source.id), label: String(dataSourceTitle(source)) }))]}
                    onChange={(nextValue) => {
                      updateProperty(property.id, {
                          relationDataSourceId: nextValue,
                      });
                    }}
                  />
                </div>
                <label class="min-w-0 text-[0.733333rem] text-muted-foreground">
                  <span class="mb-1 block">{t("notes.databaseSchemaRelationSyncedPropertyId")}</span>
                  <input
                    class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus:border-ring"
                    value={property.relationSyncedPropertyId}
                    placeholder={t("notes.databaseSchemaRelationSyncedPropertyIdPlaceholder")}
                    oninput={(event) => {
                      updateProperty(property.id, {
                        relationSyncedPropertyId: event.currentTarget.value,
                      });
                    }}
                  />
                </label>
                <label class="min-w-0 text-[0.733333rem] text-muted-foreground">
                  <span class="mb-1 block">{t("notes.databaseSchemaRelationSyncedPropertyName")}</span>
                  <input
                    class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus:border-ring"
                    value={property.relationSyncedPropertyName}
                    placeholder={t("notes.databaseSchemaRelationSyncedPropertyNamePlaceholder")}
                    oninput={(event) => {
                      updateProperty(property.id, {
                        relationSyncedPropertyName: event.currentTarget.value,
                      });
                    }}
                  />
                </label>
              </div>
            {:else if property.type === "rollup"}
              <NotesDatabaseRollupSchemaControls
                {property}
                relations={notesDataSourceRollupRelationOptions(properties, property.id)}
                targets={notesDataSourceRollupTargetOptions(
                  property,
                  properties,
                  dataSourceId,
                  rollupDataSources(),
                )}
                {saving}
                onRelationChange={(relationId) => updateRollupRelation(property, relationId)}
                onTargetChange={(targetId) => updateRollupTarget(property, targetId)}
                onFunctionChange={(rollupFunction) => updateProperty(property.id, { rollupFunction })}
              />
            {:else if property.type === "formula"}
              <label class="min-w-0 text-[0.733333rem] text-muted-foreground">
                <span class="mb-1 block">{t("notes.databaseSchemaFormulaExpression")}</span>
                <textarea
                  class="min-h-20 w-full min-w-0 resize-y rounded-md border border-input bg-background px-2 py-1.5 font-mono text-[0.8rem] text-foreground outline-none focus:border-ring"
                  value={property.formulaExpression}
                  placeholder={t("notes.databaseSchemaFormulaExpressionPlaceholder")}
                  disabled={saving}
                  oninput={(event) => {
                    updateProperty(property.id, {
                      formulaExpression: event.currentTarget.value,
                    });
                  }}
                ></textarea>
              </label>
            {:else if property.type === "button"}
              <div class="grid min-w-0 gap-2 @lg:grid-cols-3">
                <label class="min-w-0 text-[0.733333rem] text-muted-foreground">
                  <span class="mb-1 block">{t("notes.databaseSchemaButtonLabel")}</span>
                  <input
                    class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus:border-ring"
                    value={property.buttonLabel}
                    placeholder={t("notes.databaseSchemaButtonDefaultLabel")}
                    oninput={(event) => {
                      updateProperty(property.id, {
                        buttonLabel: event.currentTarget.value,
                      });
                    }}
                  />
                </label>
                <div class="min-w-0 text-[0.733333rem] text-muted-foreground">
                  <span class="mb-1 block">{t("notes.databaseSchemaButtonTarget")}</span>
                  <CustomSelect
                    inline
                    appearance="quiet"
                    contentAlign="start"
                    class="w-full min-w-0"
                    ariaLabel={t("notes.databaseSchemaButtonTarget")}
                    value={String(property.buttonActionPropertyId ?? "")}
                    options={[{ value: "", label: t("notes.databaseSchemaButtonNoAction") },
                      ...(notesDataSourceButtonTargetOptions(properties, property.id)).map((target) => ({ value: String(target.id), label: String(target.name) }))]}
                    onChange={(nextValue) => updateButtonTarget(property, nextValue)}
                  />
                </div>
                <label class="flex min-w-0 items-end gap-2 text-[0.733333rem] text-muted-foreground">
                  <input
                    class="mb-2"
                    type="checkbox"
                    checked={property.buttonRequiresConfirmation}
                    onchange={(event) => {
                      updateProperty(property.id, {
                        buttonRequiresConfirmation: event.currentTarget.checked,
                      });
                    }}
                  />
                  <span class="pb-1">{t("notes.databaseSchemaButtonConfirm")}</span>
                </label>
                {#if property.buttonActionPropertyId}
                  {#if property.buttonActionPropertyType === "checkbox"}
                    <div class="min-w-0 text-[0.733333rem] text-muted-foreground">
                      <span class="mb-1 block">{t("notes.databaseSchemaButtonValue")}</span>
                      <CustomSelect
                        inline
                        appearance="quiet"
                        contentAlign="start"
                        class="w-full min-w-0"
                        ariaLabel={t("notes.databaseSchemaButtonValue")}
                        value={String(property.buttonActionValue === false ? "false" : "true")}
                        options={[{ value: "true", label: t("notes.databaseSchemaButtonValueChecked") },
                          { value: "false", label: t("notes.databaseSchemaButtonValueUnchecked") }]}
                        onChange={(nextValue) => updateButtonValue(property, nextValue === "true")}
                      />
                    </div>
                  {:else}
                    <label class="min-w-0 text-[0.733333rem] text-muted-foreground @lg:col-span-2">
                      <span class="mb-1 block">{t("notes.databaseSchemaButtonValue")}</span>
                      <input
                        class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus:border-ring"
                        value={buttonActionValueText(property.buttonActionValue)}
                        placeholder={t("notes.databaseSchemaButtonValuePlaceholder")}
                        oninput={(event) => updateButtonValue(property, event.currentTarget.value)}
                      />
                    </label>
                  {/if}
                {/if}
              </div>
            {:else if property.type === "select" || property.type === "multi_select" || property.type === "status"}
              <div class="space-y-2">
                {#each property.options as option (option.id)}
                  <div class="grid min-w-0 gap-2 @lg:grid-cols-[minmax(7rem,1fr)_minmax(7rem,10rem)_minmax(7rem,10rem)_auto]">
                    <label class="min-w-0 text-[0.733333rem] text-muted-foreground">
                      <span class="mb-1 block">{t("notes.databaseSchemaOptionName")}</span>
                      <input
                        class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus:border-ring"
                        value={option.name}
                        oninput={(event) => {
                          updateOption(property.id, option.id, {
                            name: event.currentTarget.value,
                          });
                        }}
                      />
                    </label>
                    <div class="min-w-0 text-[0.733333rem] text-muted-foreground">
                      <span class="mb-1 block">{t("notes.databaseSchemaOptionColor")}</span>
                      <CustomSelect
                        inline
                        appearance="quiet"
                        contentAlign="start"
                        class="w-full min-w-0"
                        ariaLabel={t("notes.databaseSchemaOptionColor")}
                        value={String(option.color ?? "")}
                        options={[...(NOTES_DATA_SOURCE_SELECT_COLORS).map((color) => ({ value: String(color), label: String(color) }))]}
                        onChange={(nextValue) => {
                          updateOption(property.id, option.id, {
                              color: nextValue as NotesDataSourceSelectColor,
                          });
                        }}
                      />
                    </div>
                    {#if property.type === "status"}
                      <div class="min-w-0 text-[0.733333rem] text-muted-foreground">
                        <span class="mb-1 block">{t("notes.databaseSchemaOptionGroup")}</span>
                        <CustomSelect
                          inline
                          appearance="quiet"
                          contentAlign="start"
                          class="w-full min-w-0"
                          ariaLabel={t("notes.databaseSchemaOptionGroup")}
                          value={String(option.group ?? "")}
                          options={[...(NOTES_DATA_SOURCE_STATUS_GROUPS).map((group) => ({ value: String(group), label: String(group) }))]}
                          onChange={(nextValue) => {
                            updateOption(property.id, option.id, {
                                group: nextValue as NotesDataSourceStatusGroup,
                            });
                          }}
                        />
                      </div>
                    {/if}
                    <div class="flex items-end justify-end">
                      <button
                        type="button"
                        class="inline-flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                        aria-label={t("notes.databaseSchemaDeleteOption")}
                        title={t("notes.databaseSchemaDeleteOption")}
                        onclick={() => deleteOption(property.id, option.id)}
                      >
                        <Trash2 class="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                {/each}
                <button
                  type="button"
                  class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[0.8rem] hover:bg-accent"
                  onclick={() => addOption(property.id)}
                >
                  <Plus class="size-3.5" aria-hidden="true" />
                  <span>{t("notes.databaseSchemaAddOption")}</span>
                </button>
              </div>
            {:else if property.type === "title"}
              <p class="text-[0.8rem] text-muted-foreground">{t("notes.databaseSchemaReadOnlyTitle")}</p>
            {:else}
              <p class="text-[0.8rem] text-muted-foreground">
                {t("notes.databaseSchemaReadonlyPlaceholder")}
              </p>
            {/if}
          </div>
        {/each}
      </div>

      <div class="flex min-w-0 flex-wrap items-center gap-2 border-t border-border pt-3">
        <CustomSelect
          inline
          appearance="quiet"
          contentAlign="start"
          class="w-full min-w-0"
          ariaLabel={t("notes.databaseSchemaType")}
          value={String(newPropertyType ?? "")}
          options={[...(NOTES_DATA_SOURCE_PROPERTY_TYPES.filter((type) => type !== "title")).map((type) => ({ value: String(type), label: String(propertyTypeLabel(type)) }))]}
          onChange={(nextValue) => {
            newPropertyType = nextValue as NotesDataSourcePropertyType;
          }}
        />
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[0.8rem] hover:bg-accent"
          onclick={addProperty}
        >
          <Plus class="size-3.5" aria-hidden="true" />
          <span>{t("notes.databaseSchemaAddProperty")}</span>
        </button>
      </div>

      </div>
    </div>
  </div>
{/if}
