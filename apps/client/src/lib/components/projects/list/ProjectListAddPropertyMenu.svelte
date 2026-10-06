<script lang="ts">
  import ArrowLeftToLine from "@lucide/svelte/icons/arrow-left-to-line";
  import ArrowRightToLine from "@lucide/svelte/icons/arrow-right-to-line";
  import CollectionMenu from "$lib/components/collections/CollectionMenu.svelte";
  import CollectionPropertyCreator from "$lib/components/collections/CollectionPropertyCreator.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { uniqueProjectCustomFieldName } from "$lib/projects/custom-fields";
  import { projectCustomFieldTypeLabel } from "$lib/projects/display";
  import type { ProjectTaskListResizableColumn } from "$lib/projects/list/view";
  import type { ProjectCustomFieldType } from "$lib/projects/types";
  import type { ProjectTaskQueryController } from "$lib/components/projects/task-query-controller.svelte";
  import { projectCustomFieldTypeOptions } from "./property-kinds";

  /**
   * Creates a custom field from the task table and shows it beside `anchor`.
   * The `button` variant is the square add control after the last column; `row` is an insert action inside a column menu.
   */
  let { query, anchor, side = "right", label, variant }: {
    query: ProjectTaskQueryController;
    anchor: ProjectTaskListResizableColumn;
    side?: "left" | "right";
    label: string;
    variant: "button" | "row";
  } = $props();

  const localization = getLocalization();
  const { t } = localization;
  const pending = $derived(query.propertySaving || query.presentationSaving || query.listColumnsSaving);
  const types = $derived(projectCustomFieldTypeOptions(t));
  let name = $state("");

  /** Create the field, naming it after its type when the name was left blank, and keep the draft until it is created. */
  async function create(type: ProjectCustomFieldType, draft: string): Promise<void> {
    const fieldName = draft.trim() || uniqueProjectCustomFieldName(projectCustomFieldTypeLabel(type, t), query.customFields, localization.locale);
    if (await query.addColumnProperty(fieldName, type, anchor, side)) name = "";
  }
</script>

<CollectionMenu {label} kind="new" showHeader={false} dismissOnAction disabled={pending}
  iconOnly={variant === "button"} fullWidth={variant === "row"} icon={variant === "row" ? side === "left" ? ArrowLeftToLine : ArrowRightToLine : undefined}
  triggerClass={variant === "button" ? "size-9 justify-center px-0" : undefined}
  triggerAttributes={variant === "button" ? { "data-collection-hover-target": "" } : undefined}>
  <CollectionPropertyCreator {types} bind:name {pending} onCreate={(type, draft) => { void create(type, draft); }} />
</CollectionMenu>
