<script lang="ts">
  import type { Task, TaskStatus } from "@ganbaruai/shared-types";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { cn } from "$lib/utils";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";

  interface Props {
    status: TaskStatus;
    label: string;
    tasks: Task[];
    onAddTask: (title: string) => void;
    onMoveTask: (taskId: string, newStatus: TaskStatus) => void;
    onDeleteTask: (taskId: string) => void;
  }

  let { status, label, tasks, onAddTask, onMoveTask, onDeleteTask }: Props =
    $props();

  let isAdding = $state(false);
  let newTitle = $state("");

  const statusOrder: TaskStatus[] = ["backlog", "todo", "in_progress", "done"];
  const nextStatus = $derived(() => {
    const idx = statusOrder.indexOf(status);
    return idx < statusOrder.length - 1 ? statusOrder[idx + 1] : null;
  });

  const priorityColors: Record<string, string> = {
    easy: "bg-green-500/20 text-green-400",
    medium: "bg-yellow-500/20 text-yellow-400",
    hard: "bg-orange-500/20 text-orange-400",
    epic: "bg-purple-500/20 text-purple-400",
  };

  function handleAdd() {
    if (newTitle.trim()) {
      onAddTask(newTitle.trim());
      newTitle = "";
      isAdding = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") handleAdd();
    if (e.key === "Escape") {
      isAdding = false;
      newTitle = "";
    }
  }
</script>

<div class="flex w-72 flex-shrink-0 flex-col rounded-lg bg-card/50">
  <div class="flex items-center justify-between p-3">
    <div class="flex items-center gap-2">
      <h2 class="text-sm font-semibold">{label}</h2>
      <Badge variant="secondary" class="text-xs">{tasks.length}</Badge>
    </div>
    <Button
      variant="ghost"
      size="sm"
      class="h-6 w-6 p-0"
      onclick={() => (isAdding = true)}
    >
      <Plus size={14} />
    </Button>
  </div>

  <div class="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
    {#if isAdding}
      <div class="rounded-md border border-border bg-card p-2">
        <input
          type="text"
          bind:value={newTitle}
          onkeydown={handleKeydown}
          placeholder="Task title..."
          class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autofocus
        />
        <div class="mt-2 flex gap-1">
          <Button size="sm" class="h-6 text-xs" onclick={handleAdd}>Add</Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-6 text-xs"
            onclick={() => {
              isAdding = false;
              newTitle = "";
            }}>Cancel</Button
          >
        </div>
      </div>
    {/if}

    {#each tasks as task (task.id)}
      <div class="group rounded-md border border-border bg-card p-3 transition-colors hover:bg-accent/50">
        <div class="flex items-start justify-between">
          <span class="text-sm">{task.title}</span>
          <div class="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {#if nextStatus()}
              <button
                class="rounded p-0.5 text-muted-foreground hover:text-foreground"
                onclick={() => onMoveTask(task.id, nextStatus()!)}
                title="Move to {nextStatus()}"
              >
                <ArrowRight size={12} />
              </button>
            {/if}
            <button
              class="rounded p-0.5 text-muted-foreground hover:text-destructive"
              onclick={() => onDeleteTask(task.id)}
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <span class={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", priorityColors[task.priority])}>
            {task.priority}
          </span>
          {#if task.estimatedPomodoros > 0}
            <span class="text-[10px] text-muted-foreground">
              {task.actualPomodoros}/{task.estimatedPomodoros} pom
            </span>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
