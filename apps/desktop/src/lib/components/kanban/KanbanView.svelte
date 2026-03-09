<script lang="ts">
  import { getKanban } from "$lib/stores/kanban.svelte";
  import { onMount } from "svelte";
  import KanbanColumn from "./KanbanColumn.svelte";
  import type { TaskStatus } from "@ganbaruai/shared-types";

  const kanban = getKanban();

  const columns: { status: TaskStatus; label: string }[] = [
    { status: "backlog", label: "Backlog" },
    { status: "todo", label: "To do" },
    { status: "in_progress", label: "In progress" },
    { status: "done", label: "Done" },
  ];

  onMount(() => {
    kanban.load();
  });
</script>

<div class="flex h-full flex-col p-6">
  <div class="mb-6">
    <h1 class="text-2xl font-bold">Kanban</h1>
    <p class="text-sm text-muted-foreground">Manage your tasks</p>
  </div>

  <div class="flex flex-1 gap-4 overflow-x-auto">
    {#each columns as column}
      <KanbanColumn
        status={column.status}
        label={column.label}
        tasks={kanban.byStatus(column.status)}
        onAddTask={(title) => kanban.addTask(title, "medium", column.status)}
        onMoveTask={(taskId, newStatus) => kanban.updateTaskStatus(taskId, newStatus)}
        onDeleteTask={(taskId) => kanban.deleteTask(taskId)}
      />
    {/each}
  </div>
</div>
