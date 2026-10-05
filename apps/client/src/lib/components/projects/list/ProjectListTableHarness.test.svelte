<script lang="ts">
  import type { ProjectTaskQueryController } from "$lib/components/projects/task-query-controller.svelte";
  import ProjectListColumnHeaders from "./ProjectListColumnHeaders.svelte";
  import ProjectListCalculationFooter from "./ProjectListCalculationFooter.svelte";
  import { setProjectListTableContext } from "./table-context";

  let { query }: { query: ProjectTaskQueryController } = $props();
  setProjectListTableContext({ get query() { return query; }, cellClass: () => "", cellStyle: () => "", rowStyle: () => "" });
</script>

<div data-floating-root>
  <ProjectListColumnHeaders mode="group" gridTemplate="1.5rem 1.75rem 24rem 8rem 8rem 2.25rem" gridMinWidth="45.5rem"
    taskListColumns={query.listColumns} taskListColumnLabel={(column) => query.columnLabel(column)} onResizePointerDown={() => undefined} onResizeDoubleClick={() => undefined} onResizeKeydown={() => undefined} />
  <ProjectListCalculationFooter {query} gridTemplate="1.5rem 1.75rem 24rem 8rem 8rem 2.25rem" gridMinWidth="45.5rem" columns={query.listColumns} columnLabel={(column) => query.columnLabel(column)} />
  {#if query.presentationError}<p role="alert">{query.presentationError}</p>{/if}
  {#if query.listColumnsError}<p role="alert">{query.listColumnsError}</p>{/if}
</div>
