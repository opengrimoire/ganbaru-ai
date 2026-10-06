<script lang="ts">
  import { untrack } from "svelte";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Pin from "@lucide/svelte/icons/pin";
  import Plus from "@lucide/svelte/icons/plus";
  import WrapText from "@lucide/svelte/icons/wrap-text";
  import CollectionMenu from "$lib/components/collections/CollectionMenu.svelte";
  import Select from "$lib/components/ui/Select.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { formatNumber } from "$lib/i18n/formatters";
  import { projectCustomFieldTypeLabel } from "$lib/projects/display";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { customFieldIdFromTaskListColumn } from "$lib/projects/tasks/list-columns";
  import { projectColumnCalculationOptions, projectListColumnSortMode, PROJECT_COLUMN_DATE_FORMATS, PROJECT_COLUMN_TIME_FORMATS, PROJECT_COLUMN_NUMBER_FORMATS } from "$lib/projects/list/presentation";
  import { PROJECT_CUSTOM_FIELD_TYPES, type ProjectCustomFieldType } from "$lib/projects/types";
  import type { ProjectTaskListResizableColumn } from "$lib/projects/list/view";
  import { getProjectListTableContext } from "./table-context";
  import ProjectListColumnFilters from "./ProjectListColumnFilters.svelte";

  let { column, label, addOnly = false }: { column: ProjectTaskListResizableColumn; label: string; addOnly?: boolean } = $props();
  const context = getProjectListTableContext();
  const query = context?.query;
  const projects = getProjects();
  const localization = getLocalization();
  const { t } = localization;
  const field = $derived(column === "name" ? undefined : query?.customFields.find((candidate) => candidate.id === customFieldIdFromTaskListColumn(column)));
  const pending = $derived(Boolean(query?.propertySaving || query?.presentationSaving || query?.listColumnsSaving));
  const sortMode = $derived(projectListColumnSortMode(column));
  const wrapped = $derived(query?.listPresentation.wrappedColumns.includes(column) ?? false);
  const frozen = $derived(query?.listPresentation.frozenThrough === column);
  const index = $derived(column === "name" ? -1 : query?.listColumns.indexOf(column) ?? -1);
  let newName = $state("");
  let newType = $state<ProjectCustomFieldType>("text");
  let nameDraft = $state(untrack(() => field?.name ?? ""));
  let draftFieldId = $state(untrack(() => field?.id ?? null));
  let draftCanonicalName = $state(untrack(() => field?.name ?? ""));
  let nameEditing = $state(false);
  let optionDraft = $state("");
  let editSaving = $state(false);
  let editError = $state<string | null>(null);
  let editWriteGeneration = 0;

  $effect(() => {
    const currentField = field;
    const editing = nameEditing;
    const saving = editSaving;
    const error = editError;
    if (!currentField) return;
    const canonicalName = currentField.name;
    untrack(() => {
      if (currentField.id !== draftFieldId) {
        editWriteGeneration += 1;
        draftFieldId = currentField.id;
        draftCanonicalName = canonicalName;
        nameDraft = canonicalName;
        nameEditing = false;
        optionDraft = "";
        editSaving = false;
        editError = null;
      } else if (!editing && !saving && error === null && nameDraft === draftCanonicalName) {
        nameDraft = canonicalName;
        draftCanonicalName = canonicalName;
      }
    });
  });

  /** Toggle text wrapping for this column in the saved list presentation. */
  function toggleWrap(): void {
    if (!query) return;
    void query.savePresentation({ ...query.listPresentation, wrappedColumns: wrapped
      ? query.listPresentation.wrappedColumns.filter((entry) => entry !== column)
      : [...query.listPresentation.wrappedColumns, column] });
  }

  /** Change the canonical query so sorting stays shared with toolbar controls and saved views. */
  function sort(direction: "asc" | "desc"): void {
    if (!query || !sortMode) return;
    query.sortMode = sortMode;
    query.sortDirection = direction;
  }

  /** Rename the property, keeping the name draft when validation or the native write fails. */
  async function saveName(): Promise<void> {
    if (!field || editSaving) return;
    const target = field;
    const name = nameDraft.trim();
    const generation = ++editWriteGeneration;
    editSaving = true;
    editError = null;
    try {
      if (!name) throw new Error(t("projects.columns.nameRequired"));
      if (query?.customFields.some((candidate) => candidate.id !== target.id && candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(t("projects.columns.nameExists"));
      await projects.updateCustomField(target, { name });
      if (generation === editWriteGeneration) {
        nameDraft = name;
        draftCanonicalName = name;
      }
    } catch (error: unknown) {
      if (generation === editWriteGeneration) editError = t("projects.columns.propertyFailed", error instanceof Error ? error.message : String(error));
    } finally { if (generation === editWriteGeneration) editSaving = false; }
  }

  /** Add an option without modifying any existing task value. */
  async function addOption(): Promise<void> {
    if (!field || editSaving || !optionDraft.trim()) return;
    const target = field;
    const name = optionDraft;
    const generation = ++editWriteGeneration;
    editSaving = true;
    editError = null;
    try {
      if (projects.customFieldOptionsForField(target.id).some((candidate) => candidate.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())) throw new Error(t("projects.customFields.optionNameExists"));
      await projects.addCustomFieldOption(target.id, name);
      if (generation === editWriteGeneration) optionDraft = "";
    }
    catch (error: unknown) {
      if (generation === editWriteGeneration) editError = t("projects.columns.propertyFailed", error instanceof Error ? error.message : String(error));
    } finally { if (generation === editWriteGeneration) editSaving = false; }
  }

  /** Use a unique copy name while keeping the source property's values independent. */
  function duplicate(): void {
    if (!query || !field) return;
    const base = t("projects.columns.copyName", field.name);
    let name = base;
    let suffix = 2;
    while (query.customFields.some((candidate) => candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${base} (${formatNumber(localization.locale, suffix++)})`;
    void query.addColumnProperty(name, field.fieldType, column, field);
  }
</script>

{#if query}
  <CollectionMenu label={label} kind={addOnly ? "new" : "property"} fullWidth={!addOnly} showHeader={false} dismissOnAction={!addOnly}
    iconOnly={addOnly}
    disabled={pending} triggerClass={addOnly ? "size-9 justify-center px-0" : "h-auto justify-start rounded-none px-2 font-normal"}
    triggerAttributes={addOnly ? { "data-collection-hover-target": "" } : { "data-collection-cell-primary": "" }}>
    <div class="grid gap-0.5">
      {#if !addOnly}
        {#if field}
          <CollectionMenu label={t("projects.columns.editProperty")} kind="properties" fullWidth>
            <form class="grid gap-2" onsubmit={(event) => { event.preventDefault(); void saveName(); }}>
              <input class="h-8 min-w-0 rounded border border-input bg-transparent px-2" aria-label={t("projects.columns.propertyName")} bind:value={nameDraft} disabled={editSaving} onfocus={() => { nameEditing = true; }} onblur={() => { nameEditing = false; }} />
              <p class="text-muted-foreground">{projectCustomFieldTypeLabel(field.fieldType, t)}</p>
              <button type="submit" class="min-h-8 rounded px-2 text-left hover:bg-accent" disabled={editSaving}>{t("common.save")}</button>
            </form>
            {#if field.fieldType === "select" || field.fieldType === "multi_select" || field.fieldType === "status"}
              <div class="mt-2 grid gap-1">
                {#each projects.customFieldOptionsForField(field.id) as option (option.id)}<span class="px-2 py-1">{option.name}</span>{/each}
                <form class="flex min-w-0 gap-1" onsubmit={(event) => { event.preventDefault(); void addOption(); }}>
                  <input class="h-8 min-w-0 flex-1 rounded border border-input px-2" aria-label={t("projects.customFields.optionName")} bind:value={optionDraft} disabled={editSaving} />
                  <button type="submit" class="size-8 rounded hover:bg-accent" aria-label={t("projects.columns.addOption")} disabled={editSaving || !optionDraft.trim()}><Plus class="size-3.5" /></button>
                </form>
              </div>
            {/if}
            {#if editError}<p role="alert" class="py-1 text-destructive">{editError}</p>{/if}
          </CollectionMenu>
        {/if}
        {#if sortMode}
          <button class="property-action" type="button" onclick={() => sort("asc")}><ArrowUp class="size-3.5" />{t("projects.columns.sortAscending")}{#if query.sortMode === sortMode && query.sortDirection === "asc"}<Check class="ml-auto size-3.5" />{/if}</button>
          <button class="property-action" type="button" onclick={() => sort("desc")}><ArrowDown class="size-3.5" />{t("projects.columns.sortDescending")}{#if query.sortMode === sortMode && query.sortDirection === "desc"}<Check class="ml-auto size-3.5" />{/if}</button>
        {/if}
        <ProjectListColumnFilters {query} {column} />
        <button class="property-action" type="button" disabled={pending} onclick={toggleWrap}><WrapText class="size-3.5" />{t("projects.columns.wrap")}{#if wrapped}<Check class="ml-auto size-3.5" />{/if}</button>
        <button class="property-action" type="button" disabled={pending} onclick={() => void query.savePresentation({ ...query.listPresentation, frozenThrough: frozen ? null : column })}><Pin class="size-3.5" />{t(frozen ? "projects.columns.unfreeze" : "projects.columns.freezeThrough")}</button>
        {#if column === "start" || column === "due" || field?.fieldType === "date"}
          <CollectionMenu label={t("projects.columns.dateFormat")} kind="properties" fullWidth>
            {#each PROJECT_COLUMN_DATE_FORMATS as format}
              <button class="property-action" disabled={pending} aria-pressed={(query.listPresentation.dateFormats[column] ?? "locale") === format} onclick={() => void query.savePresentation({ ...query.listPresentation, dateFormats: { ...query.listPresentation.dateFormats, [column]: format } })}>{t("projects.columns.dateFormatLabel", format)}</button>
            {/each}
          </CollectionMenu>
        {/if}
        {#if column === "start" || column === "due"}
          <CollectionMenu label={t("projects.columns.timeFormat")} kind="properties" fullWidth>
            {#each PROJECT_COLUMN_TIME_FORMATS as format}
              <button class="property-action" disabled={pending} aria-pressed={(query.listPresentation.timeFormats[column] ?? "locale") === format} onclick={() => void query.savePresentation({ ...query.listPresentation, timeFormats: { ...query.listPresentation.timeFormats, [column]: format } })}>{t("projects.columns.timeFormatLabel", format)}</button>
            {/each}
          </CollectionMenu>
        {/if}
        {#if field?.fieldType === "number"}
          <CollectionMenu label={t("projects.columns.numberFormat")} kind="properties" fullWidth>
            {#each PROJECT_COLUMN_NUMBER_FORMATS as format}
              <button class="property-action" disabled={pending} aria-pressed={(query.listPresentation.numberFormats[column] ?? "number") === format} onclick={() => void query.savePresentation({ ...query.listPresentation, numberFormats: { ...query.listPresentation.numberFormats, [column]: format } })}>{t("projects.columns.numberFormatLabel", format)}</button>
            {/each}
          </CollectionMenu>
        {/if}
        <CollectionMenu label={t("projects.columns.calculate")} kind="properties" fullWidth>
          {#each projectColumnCalculationOptions(column, query.customFields) as calculation}
            <button class="property-action" type="button" disabled={pending} aria-pressed={(query.listPresentation.calculations[column] ?? "none") === calculation}
              onclick={() => void query.savePresentation({ ...query.listPresentation, calculations: { ...query.listPresentation.calculations, [column]: calculation } })}>
              {t("projects.columns.calculation", calculation)}{#if (query.listPresentation.calculations[column] ?? "none") === calculation}<Check class="ml-auto size-3.5" />{/if}
            </button>
          {/each}
        </CollectionMenu>
        {#if column !== "name"}
          <button class="property-action" type="button" disabled={pending || index <= 0} onclick={() => void query.moveColumn(column, -1)}><ArrowLeft class="size-3.5" />{t("projects.columns.moveLeft")}</button>
          <button class="property-action" type="button" disabled={pending || index < 0 || index >= query.listColumns.length - 1} onclick={() => void query.moveColumn(column, 1)}><ArrowRight class="size-3.5" />{t("projects.columns.moveRight")}</button>
          <button class="property-action" type="button" disabled={pending} onclick={() => void query.toggleColumn(column)}><EyeOff class="size-3.5" />{t("projects.columns.hide")}</button>
        {/if}
        {#if field}<button class="property-action" type="button" disabled={pending} onclick={duplicate}><Copy class="size-3.5" />{t("projects.columns.duplicateEmpty")}</button>{/if}
      {/if}
      <CollectionMenu label={t("projects.columns.insertProperty")} kind="new" fullWidth showHeader={!addOnly}>
        <form class="grid gap-2" onsubmit={(event) => { event.preventDefault(); void query.addColumnProperty(newName, newType, column); }}>
          <input class="h-8 rounded border border-input bg-transparent px-2" aria-label={t("projects.columns.propertyName")} placeholder={t("projects.columns.propertyName")} bind:value={newName} disabled={pending} />
          <Select inline appearance="quiet" ariaLabel={t("projects.columns.propertyType")} value={newType} disabled={pending}
            options={PROJECT_CUSTOM_FIELD_TYPES.map((type) => ({ value: type, label: projectCustomFieldTypeLabel(type, t) }))}
            onChange={(value) => { const type = PROJECT_CUSTOM_FIELD_TYPES.find((candidate) => candidate === value); if (type) newType = type; }} />
          <button class="property-action" type="submit" disabled={pending || !newName.trim()}><Plus class="size-3.5" />{t("projects.columns.insertProperty")}</button>
        </form>
        {#if query.propertyError}<p role="alert" class="py-1 text-destructive">{query.propertyError}</p>{/if}
        {#if query.listColumnsError}<p role="alert" class="py-1 text-destructive">{query.listColumnsError}</p>{/if}
      </CollectionMenu>
    </div>
  </CollectionMenu>
{:else}
  <span class="truncate">{label}</span>
{/if}

<style>
  .property-action { display: flex; min-height: 2rem; align-items: center; gap: 0.5rem; border-radius: 0.25rem; padding: 0.375rem 0.5rem; text-align: left; }
  .property-action:hover { background: var(--accent); }
  .property-action:disabled { cursor: not-allowed; color: var(--muted-foreground); }
</style>
