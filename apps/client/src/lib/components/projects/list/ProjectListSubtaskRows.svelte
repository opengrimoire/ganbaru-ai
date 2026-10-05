<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    projectTaskArchivedBadgeClass,
  } from "$lib/projects/display";
  import type { ProjectStatus, ProjectTask } from "$lib/projects/types";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { cn } from "$lib/utils";
  import ProjectStatusBadge from "$lib/components/projects/ProjectStatusBadge.svelte";

  let {
    subtasks,
    selectedTaskId,
    statusForTask,
    onToggleDone,
    onOpenTask,
  }: {
    subtasks: ProjectTask[];
    selectedTaskId: string | null;
    statusForTask: (task: ProjectTask) => ProjectStatus | undefined;
    onToggleDone: (task: ProjectTask) => void;
    onOpenTask: (task: ProjectTask) => void;
  } = $props();

  const { t } = getLocalization();
  const theme = getTheme();
</script>

{#if subtasks.length > 0}
  <div class="project-list-inline-divider col-span-full mt-1 grid gap-1 pt-1">
    {#each subtasks as subtask (subtask.id)}
      {@const subtaskStatus = statusForTask(subtask)}
      <div
        class={cn(
          "grid min-h-7 grid-cols-[1.75rem_auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded px-1",
          selectedTaskId === subtask.id ? "bg-accent/80" : "bg-transparent",
          subtask.archivedAt && "opacity-70",
        )}
      >
        <span class="h-px w-4 justify-self-center bg-border"></span>
        <button
          type="button"
          class={cn(
            "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border",
            subtaskStatus?.terminal ? "border-emerald-500 bg-emerald-500 text-white" : "border-border hover:bg-accent",
          )}
          aria-label={t("projects.actions.toggleComplete")}
          onclick={() => onToggleDone(subtask)}
        >
          {#if subtaskStatus?.terminal}
            <Check size={13} strokeWidth={2} />
          {/if}
        </button>
        <button
          type="button"
          class="min-w-0 cursor-pointer text-left"
          aria-label={t("projects.actions.openTaskDetails", subtask.title)}
          onclick={() => onOpenTask(subtask)}
        >
          <span class="block truncate text-[0.8rem]">{subtask.title}</span>
        </button>
        <ProjectStatusBadge
          status={subtaskStatus}
          theme={theme.current}
          label={subtaskStatus?.name ?? t("projects.list.status")}
          class="text-[0.733333rem]"
        />
        {#if subtask.archivedAt}
          <span class={cn("rounded border px-1.5 py-0.5 text-[0.733333rem]", projectTaskArchivedBadgeClass(subtask))}>
            {t("projects.taskLifecycle.archived")}
          </span>
        {/if}
      </div>
    {/each}
  </div>
{/if}
