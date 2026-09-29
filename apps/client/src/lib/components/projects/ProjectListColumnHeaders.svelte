<script lang="ts">
  import CirclePlus from "@lucide/svelte/icons/circle-plus";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type {
    ProjectTaskListColumn,
  } from "$lib/projects/types";
  import type { ProjectTaskListResizableColumn } from "$lib/projects/project-list-view";
  import CollectionRow from "$lib/components/collections/CollectionRow.svelte";
  import CollectionColumnHeader from "$lib/components/collections/CollectionColumnHeader.svelte";

  type HeaderMode = "section" | "group";

  let {
    mode,
    gridTemplate,
    gridMinWidth,
    taskListColumns,
    taskListColumnLabel,
    onResizePointerDown,
    onResizeDoubleClick,
    onResizeKeydown,
  }: {
    mode: HeaderMode;
    gridTemplate: string;
    gridMinWidth: string;
    taskListColumns: ProjectTaskListColumn[];
    taskListColumnLabel: (column: ProjectTaskListColumn) => string;
    onResizePointerDown: (event: PointerEvent, column: ProjectTaskListResizableColumn) => void;
    onResizeDoubleClick: (event: MouseEvent, column: ProjectTaskListResizableColumn) => void;
    onResizeKeydown: (event: KeyboardEvent, column: ProjectTaskListResizableColumn) => void;
  } = $props();

  const { t } = getLocalization();
</script>

{#snippet columnHeaderCell(label: string, column: ProjectTaskListResizableColumn)}
  <CollectionColumnHeader {label} resizeLabel={t("projects.columns.resizeColumn", label)}
    onpointerdown={(event) => onResizePointerDown(event, column)}
    ondblclick={(event) => onResizeDoubleClick(event, column)}
    onkeydown={(event) => onResizeKeydown(event, column)} />
{/snippet}

<CollectionRow template={gridTemplate} minWidth={gridMinWidth} header divider={false} role="row"
  class={mode === "section" ? "project-list-divider group/column-header" : "project-list-divider group/list-column-header"}>
  <div></div>
  <div></div>
  {@render columnHeaderCell(t("projects.list.name"), "name")}
  {#each taskListColumns as column (column)}
    {@render columnHeaderCell(taskListColumnLabel(column), column)}
  {/each}
  <div
    class="flex min-h-11 min-w-0 items-center justify-center self-stretch rounded-md text-muted-foreground"
    aria-hidden="true"
  >
    <CirclePlus size={15} strokeWidth={1.75} />
  </div>
</CollectionRow>
