<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Check from "@lucide/svelte/icons/check";
  import Plus from "@lucide/svelte/icons/plus";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import type { ProjectStatus, ProjectTask } from "$lib/projects/types";
  import type { Theme } from "$lib/stores/themes";
  import { cn } from "$lib/utils";
  import ProjectStatusBadge from "./ProjectStatusBadge.svelte";
  import ProjectSettingsSectionHeading from "./ProjectSettingsSectionHeading.svelte";

  type ActionResult = void | Promise<void>;
  type SortDirection = -1 | 1;

  let {
    task,
    subtasks,
    theme,
    draft,
    statusForTask,
    onDraftChange,
    onSubmitSubtask,
    onToggleComplete,
    onOpenTask,
    onPromoteSubtask,
    onMoveSubtask,
  }: {
    task: ProjectTask;
    subtasks: ProjectTask[];
    theme: Theme;
    draft: string;
    statusForTask: (task: ProjectTask) => ProjectStatus | undefined;
    onDraftChange: (value: string) => void;
    onSubmitSubtask: (task: ProjectTask) => ActionResult;
    onToggleComplete: (task: ProjectTask) => ActionResult;
    onOpenTask: (task: ProjectTask) => void;
    onPromoteSubtask: (task: ProjectTask) => ActionResult;
    onMoveSubtask: (task: ProjectTask, direction: SortDirection) => ActionResult;
  } = $props();

  const { t } = getLocalization();

  function adjacentSubtask(subtask: ProjectTask, direction: SortDirection): ProjectTask | undefined {
    const index = subtasks.findIndex((entry) => entry.id === subtask.id);
    if (index < 0) return undefined;
    return subtasks[index + direction];
  }
</script>

<section class="task-detail-section grid min-w-0 content-start gap-3">
  <ProjectSettingsSectionHeading label={t("projects.detail.subtasks")} count={subtasks.length} inlineCount />
  <div class="grid gap-1">
    {#each subtasks as subtask (subtask.id)}
      {@const subtaskStatus = statusForTask(subtask)}
      {@const previousSubtask = adjacentSubtask(subtask, -1)}
      {@const nextSubtask = adjacentSubtask(subtask, 1)}
      <div class="grid min-h-8 grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto] items-center gap-1 rounded-md bg-transparent px-2 hover:bg-muted/40">
        <button
          type="button"
          class={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
            subtaskStatus?.terminal ? "border-emerald-500 bg-emerald-500 text-white" : "border-border hover:bg-accent",
          )}
          aria-label={t("projects.actions.toggleComplete")}
          onclick={() => { void onToggleComplete(subtask); }}
        >
          {#if subtaskStatus?.terminal}
            <Check size={13} strokeWidth={2} />
          {/if}
        </button>
        <button
          type="button"
          class="min-w-0 text-left"
          aria-label={t("projects.actions.openTaskDetails", subtask.title)}
          onclick={() => onOpenTask(subtask)}
        >
          <span class="block truncate text-[0.8rem]">{subtask.title}</span>
        </button>
        <ProjectStatusBadge
          status={subtaskStatus}
          {theme}
          label={subtaskStatus?.name ?? t("projects.list.status")}
          class="text-[0.733333rem]"
        />
        <button
          type="button"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          disabled={Boolean(subtask.archivedAt)}
          aria-label={t("projects.actions.promoteSubtask", subtask.title)}
          title={t("projects.actions.promoteSubtask", subtask.title)}
          onclick={() => { void onPromoteSubtask(subtask); }}
        >
          <ArrowLeft size={13} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!previousSubtask}
          aria-label={previousSubtask ? t("projects.actions.moveSubtaskUp", subtask.title) : t("projects.actions.noPreviousSubtask")}
          title={previousSubtask ? t("projects.actions.moveSubtaskUp", subtask.title) : t("projects.actions.noPreviousSubtask")}
          onclick={() => { void onMoveSubtask(subtask, -1); }}
        >
          <ArrowUp size={13} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!nextSubtask}
          aria-label={nextSubtask ? t("projects.actions.moveSubtaskDown", subtask.title) : t("projects.actions.noNextSubtask")}
          title={nextSubtask ? t("projects.actions.moveSubtaskDown", subtask.title) : t("projects.actions.noNextSubtask")}
          onclick={() => { void onMoveSubtask(subtask, 1); }}
        >
          <ArrowDown size={13} strokeWidth={1.75} />
        </button>
      </div>
    {/each}
  </div>
  <div class="flex gap-1">
    <input
      value={draft}
      aria-label={t("projects.detail.addSubtask")}
      placeholder={t("projects.detail.addSubtaskPlaceholder")}
      class="min-h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 hover:bg-muted/40 text-[0.8rem]"
      oninput={(event) => onDraftChange(event.currentTarget.value)}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void onSubmitSubtask(task);
        }
      }}
    />
    <button
      type="button"
      class="flex min-h-8 items-center justify-center rounded-md bg-transparent px-2 text-[0.8rem] hover:bg-accent"
      aria-label={t("projects.detail.addSubtask")}
      onclick={() => { void onSubmitSubtask(task); }}
    >
      <Plus size={14} strokeWidth={1.75} />
    </button>
  </div>
</section>
