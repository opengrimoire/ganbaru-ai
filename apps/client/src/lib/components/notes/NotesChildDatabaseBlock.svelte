<script lang="ts">
  import CustomSelect from "$lib/components/settings/CustomSelect.svelte";
  import { onMount, tick } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    getNotesDataSourceSchema,
    listNotesDataSources,
    updateNotesDataSourceSchema,
  } from "$lib/api/notes";
  import { notesChildDatabaseViewScope } from "$lib/notes/database-linked";
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
  import type { NotesDatabaseViewKind } from "$lib/notes/contracts/database/base";
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
  } from "$lib/notes/types";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Database from "@lucide/svelte/icons/database";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Save from "@lucide/svelte/icons/save";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  let {
    block,
    focusBlockId,
    focusRequestId,
    onFocusBlock,
    onKeydown,
    onSelectPage,
    onCreateLinkedDatabaseView,
  }: {
    block: NotesChildDatabaseBlock;
    focusBlockId: string | null;
    focusRequestId: number;
    onFocusBlock: (blockId: string) => void;
    onKeydown: (event: KeyboardEvent) => void;
    onSelectPage: (pageId: string) => void;
    onCreateLinkedDatabaseView: (blockId: string) => Promise<void> | void;
  } = $props();

  const localization = getLocalization();
  const { t } = localization;

  let button: HTMLButtonElement | null = $state(null);
  let expanded = $state(false);
  let loading = $state(false);
  let saving = $state(false);
  let linking = $state(false);
  let error = $state<string | null>(null);
  let linkedViewError = $state<string | null>(null);
  let saved = $state(false);
  let dirty = $state(false);
  let schema = $state<NotesDataSourceSchema | null>(null);
  let availableDataSources = $state<NotesDataSource[]>([]);
  let properties = $state<NotesDataSourceSchemaPropertyDraft[]>([]);
  let newPropertyType = $state<NotesDataSourcePropertyType>("rich_text");
  let activeView = $state<NotesDatabaseViewKind>("table");
  let tableReloadKey = $state(0);
  let boardReloadKey = $state(0);
  let galleryReloadKey = $state(0);
  let listReloadKey = $state(0);
  let calendarReloadKey = $state(0);
  let timelineReloadKey = $state(0);

  const title = $derived(block.child_database.title.trim());
  const dataSourceId = $derived(block.child_database.data_source_id ?? null);
  const databaseId = $derived(block.child_database.database_id ?? null);
  const viewId = $derived(block.child_database.view_id ?? null);
  const localDatabase = $derived(
    block.child_database.database_id !== undefined
      && block.child_database.data_source_id !== undefined
      && block.child_database.view_id !== undefined,
  );
  const viewScope = $derived(notesChildDatabaseViewScope(block));
  const propertyCount = $derived(properties.length);

  onMount(() => {
    if (localDatabase) void loadSchema();
  });

  $effect(() => {
    const _focusRequestId = focusRequestId;
    if (focusBlockId !== block.id) return;
    void tick().then(() => button?.focus());
  });

  async function loadSchema(): Promise<void> {
    if (!dataSourceId) return;
    loading = true;
    error = null;
    try {
      const [loaded, dataSources] = await Promise.all([
        getNotesDataSourceSchema(dataSourceId, viewScope),
        listNotesDataSources(),
      ]);
      schema = loaded;
      availableDataSources = dataSources;
      properties = notesDataSourceSchemaDraftFromDto(loaded.data_source, loaded.view);
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

  async function saveSchema(): Promise<void> {
    if (!dataSourceId) return;
    saving = true;
    error = null;
    try {
      const update = notesDataSourceSchemaUpdateFromDraft(properties);
      const updated = await updateNotesDataSourceSchema(dataSourceId, update, viewScope);
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
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      saving = false;
    }
  }

  async function createLinkedView(): Promise<void> {
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
  }

  function deleteProperty(propertyId: string): void {
    markDirty(properties.filter((property) => property.id !== propertyId || property.type === "title"));
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
  class="my-4 min-w-0 space-y-2"
  aria-label={t("notes.blockType.childDatabase")}
>
  <div class="flex min-w-0 items-center gap-2 px-1">
    <div
      class="flex size-7 shrink-0 items-center justify-center text-muted-foreground"
      aria-hidden="true"
    >
      <Database class="size-4" />
    </div>
    <button
      bind:this={button}
      type="button"
      class="flex min-h-8 min-w-0 flex-1 flex-col gap-0.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onkeydown={onKeydown}
      onclick={() => onFocusBlock(block.id)}
    >
      <span class="min-w-0 truncate text-base font-semibold text-foreground">
        {title || t("notes.untitled")}
      </span>
      {#if !localDatabase}<span class="min-w-0 truncate text-[0.8rem] text-muted-foreground">{t("notes.childDatabasePreserved")}</span>{/if}
    </button>
    {#if localDatabase}
      <button
        type="button"
        class="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[0.8rem] text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        disabled={linking}
        aria-label={t("notes.databaseLinkedViewCreate")}
        title={t("notes.databaseLinkedViewCreate")}
        onclick={() => {
          void createLinkedView();
        }}
      >
        <Link2 class="size-3.5" aria-hidden="true" />
        <span>{linking ? t("notes.databaseLinkedViewCreating") : t("notes.databaseLinkedViewCreate")}</span>
      </button>
      <button
        type="button"
        class="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[0.8rem] text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-expanded={expanded}
        onclick={() => {
          expanded = !expanded;
        }}
      >
        {t("notes.databaseSchemaToggle")}
      </button>
    {/if}
  </div>
  {#if linkedViewError}
    <p class="mt-2 text-[0.8rem] text-destructive">{linkedViewError}</p>
  {/if}

  {#if localDatabase && expanded}
    <div class="mt-3 min-w-0 space-y-3 border-t border-border pt-3">
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
          class="inline-flex h-8 items-center gap-1 rounded-md px-2 hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
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
          class="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2 text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={loading || saving || !dirty}
          onclick={() => {
            void saveSchema();
          }}
        >
          <Save class="size-3.5" aria-hidden="true" />
          <span>{t("notes.databaseSchemaSave")}</span>
        </button>
      </div>

      <div class="space-y-2">
        {#each properties as property, index (property.id)}
          <div class="grid min-w-0 gap-2 rounded-md border border-border p-2 @container">
            <div class="grid min-w-0 gap-2 @lg:grid-cols-[minmax(7rem,1fr)_minmax(7rem,12rem)_auto]">
              <label class="min-w-0 text-[0.733333rem] text-muted-foreground">
                <span class="mb-1 block">{t("notes.databaseSchemaName")}</span>
                <input
                  class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
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
                  class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                  disabled={saving || index === 0}
                  aria-label={t("notes.databaseSchemaMoveUp")}
                  title={t("notes.databaseSchemaMoveUp")}
                  onclick={() => moveProperty(property.id, -1)}
                >
                  <ArrowUp class="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
                  disabled={saving || index === properties.length - 1}
                  aria-label={t("notes.databaseSchemaMoveDown")}
                  title={t("notes.databaseSchemaMoveDown")}
                  onclick={() => moveProperty(property.id, 1)}
                >
                  <ArrowDown class="size-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
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
                  class="inline-flex size-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-40"
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
                class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
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
                  class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  class="min-h-20 w-full min-w-0 resize-y rounded-md border border-input bg-background px-2 py-1.5 font-mono text-[0.8rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                        class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                        class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[0.866667rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      {#if dataSourceId}
        <NotesDatabaseViewSurface
          {activeView}
          {dataSourceId}
          {databaseId}
          {viewId}
          {onSelectPage}
          reloadKeys={{
            table: tableReloadKey,
            board: boardReloadKey,
            gallery: galleryReloadKey,
            list: listReloadKey,
            calendar: calendarReloadKey,
            timeline: timelineReloadKey,
          }}
          onActiveViewChange={(view) => {
            activeView = view;
          }}
        />
      {/if}
    </div>
  {/if}
</section>
