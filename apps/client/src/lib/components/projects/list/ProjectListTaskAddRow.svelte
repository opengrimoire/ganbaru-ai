<script lang="ts">
  import type { MaybePromise } from "$lib/utils";
  import CollectionRow from "$lib/components/collections/CollectionRow.svelte";
  import CollectionQuickAdd from "$lib/components/collections/CollectionQuickAdd.svelte";

  type TaskAddMode = "section" | "group";

  let {
    mode,
    rowId,
    gridTemplate,
    gridMinWidth,
    label,
    draft,
    active,
    pending,
    error = null,
    onDraftChange,
    onActiveChange,
    onSubmit,
  }: {
    mode: TaskAddMode;
    rowId: string;
    gridTemplate: string;
    gridMinWidth: string;
    label: string;
    draft: string;
    active: boolean;
    pending: boolean;
    error?: string | null;
    onDraftChange: (value: string) => void;
    onActiveChange: (active: boolean) => void;
    onSubmit: () => MaybePromise;
  } = $props();

</script>

<CollectionRow template={gridTemplate} minWidth={gridMinWidth} divider={false} class="project-list-divider"
  data-section-task-add-row={mode === "section" ? rowId : undefined}
  data-group-task-add-row={mode === "group" ? rowId : undefined}>
  <div class="col-span-2"></div>
  <div style="grid-column: 3 / -1;">
    <CollectionQuickAdd {label} {draft} {active} disabled={pending} {onDraftChange} {onActiveChange}
      inputAttributes={{ "data-section-task-input": mode === "section" ? rowId : undefined, "data-group-task-input": mode === "group" ? rowId : undefined }}
      onSubmit={async () => { await onSubmit(); return !error; }} />
  </div>
  {#if error}<p class="col-span-full px-2 py-1 text-[0.8rem] text-destructive" role="alert">{error}</p>{/if}
</CollectionRow>
