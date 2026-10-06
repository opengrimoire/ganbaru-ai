<script lang="ts">
  import Select from "$lib/components/ui/Select.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type {
    NotesDataSourceRollupTargetOption,
    NotesDataSourceSchemaPropertyDraft,
  } from "$lib/notes/database/data-source-schema";
  import {
    NOTES_DATA_SOURCE_ROLLUP_FUNCTIONS,
    type NotesDataSourceRollupFunction,
  } from "$lib/notes/types";

  let {
    property,
    relations,
    targets,
    saving,
    onRelationChange,
    onTargetChange,
    onFunctionChange,
  }: {
    property: NotesDataSourceSchemaPropertyDraft;
    relations: readonly NotesDataSourceSchemaPropertyDraft[];
    targets: readonly NotesDataSourceRollupTargetOption[];
    saving: boolean;
    onRelationChange: (relationId: string) => void;
    onTargetChange: (targetId: string) => void;
    onFunctionChange: (rollupFunction: NotesDataSourceRollupFunction) => void;
  } = $props();

  const { t } = getLocalization();
</script>

<div class="space-y-2">
  <div class="grid min-w-0 gap-2 @lg:grid-cols-3">
    <div class="min-w-0 text-[0.733333rem] text-muted-foreground">
      <span class="mb-1 block">{t("notes.databaseSchemaRollupRelation")}</span>
      <Select textSize="paragraph"
        inline
        appearance="quiet"
        contentAlign="start"
        class="w-full min-w-0"
        ariaLabel={t("notes.databaseSchemaRollupRelation")}
        value={String(property.rollupRelationPropertyId ?? "")}
        disabled={saving || relations.length === 0}
        options={[...(property.rollupRelationPropertyId && !relations.some((relation) => relation.id === property.rollupRelationPropertyId) ? [{ value: String(property.rollupRelationPropertyId), label: String(property.rollupRelationPropertyName || property.rollupRelationPropertyId) }] : []),
          ...(relations).map((relation) => ({ value: String(relation.id), label: String(relation.name) }))]}
        onChange={(nextValue) => {
          onRelationChange(nextValue);
        }}
      />
    </div>
    <div class="min-w-0 text-[0.733333rem] text-muted-foreground">
      <span class="mb-1 block">{t("notes.databaseSchemaRollupTargetProperty")}</span>
      <Select textSize="paragraph"
        inline
        appearance="quiet"
        contentAlign="start"
        class="w-full min-w-0"
        ariaLabel={t("notes.databaseSchemaRollupTargetProperty")}
        value={String(property.rollupPropertyId ?? "")}
        disabled={saving || targets.length === 0}
        options={[...(property.rollupPropertyId && !targets.some((target) => target.id === property.rollupPropertyId) ? [{ value: String(property.rollupPropertyId), label: String(property.rollupPropertyName || property.rollupPropertyId) }] : []),
          ...(targets).map((target) => ({ value: String(target.id), label: String(target.name) }))]}
        onChange={(nextValue) => {
          onTargetChange(nextValue);
        }}
      />
    </div>
    <div class="min-w-0 text-[0.733333rem] text-muted-foreground">
      <span class="mb-1 block">{t("notes.databaseSchemaRollupFunction")}</span>
      <Select textSize="paragraph"
        inline
        appearance="quiet"
        contentAlign="start"
        class="w-full min-w-0"
        ariaLabel={t("notes.databaseSchemaRollupFunction")}
        value={String(property.rollupFunction ?? "")}
        disabled={saving}
        options={[...(NOTES_DATA_SOURCE_ROLLUP_FUNCTIONS).map((rollupFunction) => ({ value: String(rollupFunction), label: t("notes.databaseSchemaRollupFunctionLabel", rollupFunction) }))]}
        onChange={(nextValue) => {
          onFunctionChange(nextValue as NotesDataSourceRollupFunction);
        }}
      />
    </div>
  </div>
  {#if relations.length === 0}
    <p class="text-[0.8rem] text-muted-foreground">
      {t("notes.databaseSchemaRollupNoRelations")}
    </p>
  {/if}
</div>
