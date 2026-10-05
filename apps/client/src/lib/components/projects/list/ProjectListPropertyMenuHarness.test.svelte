<script lang="ts">
  import { untrack } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type { ProjectCustomField } from "$lib/projects/types";
  import ProjectListPropertyMenu from "./ProjectListPropertyMenu.svelte";
  import { ProjectTaskQueryController } from "$lib/components/projects/task-query-controller.svelte";
  import { setProjectListTableContext } from "./table-context";

  let { initialField }: { initialField: ProjectCustomField } = $props();
  let field = $state(untrack(() => initialField));
  type Input = ConstructorParameters<typeof ProjectTaskQueryController>[0];
  const query = new ProjectTaskQueryController({
    projects: {
      get selectedProject() { return { id: field.projectId }; },
      activeView: "list",
      customFieldsForProject: () => [field],
      prioritiesForProject: () => [],
    } as unknown as Input["projects"],
    calendar: {rawBlocks: []} as unknown as Input["calendar"],
    translate: getLocalization().t,
  });
  setProjectListTableContext({query, cellClass: () => "", cellStyle: () => "", rowStyle: () => ""});

  /** Apply a canonical schema update while keeping the existing header menu mounted. */
  export function setField(next: ProjectCustomField): void {
    field = next;
  }
</script>

<div data-floating-root>
  <ProjectListPropertyMenu column={`custom:${field.id}`} label={field.name} />
</div>
