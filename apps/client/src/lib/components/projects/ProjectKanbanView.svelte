<script lang="ts">
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Check from "@lucide/svelte/icons/check";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    projectKanbanDropSortOrder,
    type ProjectKanbanDropPosition,
  } from "$lib/projects/kanban-drag";
  import {
    projectPriorityDisplayColor,
    projectPriorityDisplayLabel,
    projectTaskArchivedBadgeClass,
  } from "$lib/projects/project-display";
  import { manualStatusCompare } from "$lib/projects/task-view";
  import type {
    ProjectPriorityConfig,
    ProjectStatus,
    ProjectTask,
    ProjectTaskSortDirection,
    ProjectTaskSortMode,
    ProjectTaskColumnCount,
  } from "$lib/projects/types";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { cn } from "$lib/utils";
  import { projectVisibleRange } from "$lib/projects/visible-range";
  import PriorityFlagIcon from "./PriorityFlagIcon.svelte";
  import ProjectStatusBadge from "./ProjectStatusBadge.svelte";

  let {
    tasks,
    statuses,
    priorities,
    selectedTaskIds,
    taskSortMode,
    taskSortDirection,
    onOpenTask,
    onToggleTaskSelection,
    columnCounts,
    onNeedMore,
    mobileLayout = false,
  }: {
    tasks: ProjectTask[];
    statuses: ProjectStatus[];
    priorities: ProjectPriorityConfig[];
    selectedTaskIds: string[];
    taskSortMode: ProjectTaskSortMode;
    taskSortDirection: ProjectTaskSortDirection;
    onOpenTask: (task: ProjectTask) => void;
    onToggleTaskSelection: (task: ProjectTask) => void;
    columnCounts: ProjectTaskColumnCount[];
    onNeedMore: () => void;
    mobileLayout?: boolean;
  } = $props();

  const projects = getProjects();
  const theme = getTheme();
  const { t } = getLocalization();

  const PROJECT_KANBAN_DRAG_MIME = "application/x-ganbaru-project-task";

  let kanbanDraggingTaskId = $state<string | null>(null);
  let kanbanDragOverStatusId = $state<string | null>(null);
  let kanbanDragOverTaskId = $state<string | null>(null);
  let kanbanDragOverPosition = $state<ProjectKanbanDropPosition | "column" | null>(null);
  let kanbanDropPendingTaskId = $state<string | null>(null);
  let columnScrollState = $state<Record<string, { top: number; height: number }>>({});
  const KANBAN_CARD_ESTIMATED_HEIGHT_PX = 180;
  const KANBAN_OVERSCAN_CARDS = 3;

  const selectedTaskIdSet = $derived.by(() => new Set(selectedTaskIds));

  function tasksForStatus(status: ProjectStatus): ProjectTask[] {
    const statusTasks = tasks.filter((task) => task.statusId === status.id && !task.parentTaskId);
    if (taskSortMode !== "manual") return statusTasks;
    return [...statusTasks].sort((a, b) =>
      taskSortDirection === "asc" ? manualStatusCompare(a, b) : manualStatusCompare(b, a)
    );
  }

  function totalTasksForStatus(status: ProjectStatus, loadedCount: number): number {
    return columnCounts.find((column) => column.statusId === status.id)?.count ?? loadedCount;
  }

  function visibleTasksForStatus(status: ProjectStatus): {
    tasks: ProjectTask[];
    beforePx: number;
    afterPx: number;
  } {
    const statusTasks = tasksForStatus(status);
    const scroll = columnScrollState[status.id] ?? { top: 0, height: 720 };
    const range = projectVisibleRange(
      statusTasks.length,
      scroll.top,
      scroll.height,
      KANBAN_CARD_ESTIMATED_HEIGHT_PX,
      KANBAN_OVERSCAN_CARDS,
    );
    return {
      tasks: statusTasks.slice(range.start, range.end),
      beforePx: range.beforePx,
      afterPx: range.afterPx,
    };
  }

  function trackColumnScroll(statusId: string, event: Event): void {
    const target = event.currentTarget as HTMLElement;
    columnScrollState = {
      ...columnScrollState,
      [statusId]: { top: target.scrollTop, height: target.clientHeight },
    };
  }

  function kanbanOrderTasksForStatus(status: ProjectStatus): ProjectTask[] {
    if (taskSortMode === "manual") return tasksForStatus(status);
    return projects.topLevelTasksForStatus(status.projectId, status.id);
  }

  function resetKanbanDragTarget(): void {
    kanbanDragOverStatusId = null;
    kanbanDragOverTaskId = null;
    kanbanDragOverPosition = null;
  }

  function kanbanDragTaskId(event: DragEvent): string | null {
    return event.dataTransfer?.getData(PROJECT_KANBAN_DRAG_MIME) || kanbanDraggingTaskId;
  }

  function taskById(taskId: string): ProjectTask | undefined {
    return tasks.find((task) => task.id === taskId);
  }

  function canDropKanbanTask(task: ProjectTask | undefined, status: ProjectStatus): task is ProjectTask {
    return !!task
      && !task.archivedAt
      && !task.parentTaskId
      && task.projectId === status.projectId;
  }

  function handleKanbanTaskDragStart(event: DragEvent, task: ProjectTask): void {
    if (task.archivedAt || task.parentTaskId) {
      event.preventDefault();
      return;
    }
    kanbanDraggingTaskId = task.id;
    event.dataTransfer?.setData(PROJECT_KANBAN_DRAG_MIME, task.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function handleKanbanTaskDragEnd(): void {
    kanbanDraggingTaskId = null;
    kanbanDropPendingTaskId = null;
    resetKanbanDragTarget();
  }

  function kanbanCardDropPosition(event: DragEvent): ProjectKanbanDropPosition {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientY >= rect.top + rect.height / 2 ? "after" : "before";
  }

  function handleKanbanCardDragOver(event: DragEvent, status: ProjectStatus, task: ProjectTask): void {
    const dragged = taskById(kanbanDragTaskId(event) ?? "");
    if (!canDropKanbanTask(dragged, status) || dragged.id === task.id) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    kanbanDragOverStatusId = status.id;
    kanbanDragOverTaskId = task.id;
    kanbanDragOverPosition = kanbanCardDropPosition(event);
  }

  function handleKanbanColumnDragOver(event: DragEvent, status: ProjectStatus): void {
    const dragged = taskById(kanbanDragTaskId(event) ?? "");
    if (!canDropKanbanTask(dragged, status)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    kanbanDragOverStatusId = status.id;
    kanbanDragOverTaskId = null;
    kanbanDragOverPosition = "column";
  }

  async function dropKanbanTask(
    event: DragEvent,
    status: ProjectStatus,
    targetTask?: ProjectTask,
    position?: ProjectKanbanDropPosition,
  ): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const dragged = taskById(kanbanDragTaskId(event) ?? "");
    if (!canDropKanbanTask(dragged, status) || dragged.id === targetTask?.id) {
      resetKanbanDragTarget();
      return;
    }

    const orderedTasks = kanbanOrderTasksForStatus(status);
    const nextStatusSortOrder = projectKanbanDropSortOrder({
      orderedTasks,
      draggedTaskId: dragged.id,
      overTaskId: targetTask?.id,
      position,
      sortDirection: taskSortDirection,
    });

    if (dragged.statusId === status.id && dragged.statusSortOrder === nextStatusSortOrder) {
      resetKanbanDragTarget();
      return;
    }

    kanbanDropPendingTaskId = dragged.id;
    resetKanbanDragTarget();
    try {
      await projects.updateTask(dragged, {
        statusId: status.id,
        statusSortOrder: nextStatusSortOrder,
      });
    } finally {
      kanbanDropPendingTaskId = null;
      kanbanDraggingTaskId = null;
    }
  }

  function kanbanDropMarkerVisible(
    status: ProjectStatus,
    task: ProjectTask,
    position: ProjectKanbanDropPosition,
  ): boolean {
    return kanbanDragOverStatusId === status.id
      && kanbanDragOverTaskId === task.id
      && kanbanDragOverPosition === position;
  }

  function taskSelected(task: ProjectTask): boolean {
    return selectedTaskIdSet.has(task.id);
  }

  function blockedByDependencies(task: ProjectTask) {
    return projects.dependenciesBlockingTask(task.id);
  }

  function blocksDependencies(task: ProjectTask) {
    return projects.dependenciesBlockedByTask(task.id);
  }

  function adjacentStatus(task: ProjectTask, direction: -1 | 1): ProjectStatus | undefined {
    const index = statuses.findIndex((status) => status.id === task.statusId);
    if (index < 0) return undefined;
    return statuses[index + direction];
  }

  function adjacentTaskInStatus(task: ProjectTask, direction: -1 | 1): ProjectTask | undefined {
    const ordered = projects.topLevelTasksForStatus(task.projectId, task.statusId);
    const index = ordered.findIndex((entry) => entry.id === task.id);
    if (index < 0) return undefined;
    return ordered[index + direction];
  }

  async function moveTaskToStatus(task: ProjectTask, status: ProjectStatus | undefined): Promise<void> {
    if (!status || status.id === task.statusId) return;
    await projects.setTaskStatus(task, status.id);
  }

  async function moveTaskWithinStatus(task: ProjectTask, direction: -1 | 1): Promise<void> {
    if (taskSortMode !== "manual") return;
    await projects.moveTaskInStatus(task, direction);
  }
</script>

<div class={cn("flex h-full min-h-0 overflow-x-auto", mobileLayout ? "snap-x snap-mandatory gap-2 p-2" : "gap-3 p-3")}>
  {#each statuses as status (status.id)}
    {@const statusTasks = tasksForStatus(status)}
    {@const visibleStatusTasks = visibleTasksForStatus(status)}
    <section
      class={cn(
        "flex h-full min-h-0 shrink-0 flex-col gap-2 rounded-lg border border-transparent p-1",
        mobileLayout ? "w-[min(20rem,calc(100vw-1rem))] snap-start" : "w-64",
        kanbanDragOverStatusId === status.id && "border-primary/40 bg-primary/5",
      )}
      role="list"
      aria-label={status.name}
      ondragover={(event) => handleKanbanColumnDragOver(event, status)}
      ondrop={(event) => { void dropKanbanTask(event, status); }}
    >
      <div class="min-w-0 px-1 py-1">
        <ProjectStatusBadge
          {status}
          theme={theme.current}
          label={`${status.name} (${totalTasksForStatus(status, statusTasks.length)})`}
          class="text-[0.8rem]"
        />
      </div>
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-scroll" onscroll={(event) => trackColumnScroll(status.id, event)}>
        {#if visibleStatusTasks.beforePx > 0}
          <div aria-hidden="true" style={`height: ${visibleStatusTasks.beforePx}px`}></div>
        {/if}
        {#each visibleStatusTasks.tasks as task (task.id)}
          {@const previousStatus = adjacentStatus(task, -1)}
          {@const nextStatus = adjacentStatus(task, 1)}
          {@const previousStatusTask = adjacentTaskInStatus(task, -1)}
          {@const nextStatusTask = adjacentTaskInStatus(task, 1)}
          {@const blockedByCount = blockedByDependencies(task).length}
          {@const blocksCount = blocksDependencies(task).length}
          {#if kanbanDropMarkerVisible(status, task, "before")}
            <div class="h-1 rounded-full bg-primary"></div>
          {/if}
          <article
            class={cn(
              "rounded-md border border-border bg-card p-2",
              task.archivedAt && "opacity-70",
              kanbanDraggingTaskId === task.id && "opacity-50",
              kanbanDropPendingTaskId === task.id && "opacity-60",
            )}
            ondragover={(event) => handleKanbanCardDragOver(event, status, task)}
            ondrop={(event) => { void dropKanbanTask(event, status, task, kanbanCardDropPosition(event)); }}
          >
            <div class={cn("grid gap-2", mobileLayout ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-[auto_auto_minmax(0,1fr)]")}>
              {#if !mobileLayout}
              <button
                type="button"
                class="mt-0.5 flex h-5 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                draggable={!task.archivedAt && kanbanDropPendingTaskId === null}
                disabled={Boolean(task.archivedAt) || kanbanDropPendingTaskId !== null}
                aria-label={t("projects.actions.dragTask", task.title)}
                title={t("projects.actions.dragTask", task.title)}
                ondragstart={(event) => handleKanbanTaskDragStart(event, task)}
                ondragend={handleKanbanTaskDragEnd}
              >
                <GripVertical size={13} strokeWidth={1.75} />
              </button>
              {/if}
              <button
                type="button"
                class={cn(
                  "mt-0.5 flex shrink-0 items-center justify-center rounded border",
                  mobileLayout ? "h-12 w-12" : "h-5 w-5",
                  taskSelected(task) ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent",
                )}
                aria-label={taskSelected(task) ? t("projects.actions.unselectTask", task.title) : t("projects.actions.selectTask", task.title)}
                onclick={() => onToggleTaskSelection(task)}
              >
                {#if taskSelected(task)}
                  <Check size={13} strokeWidth={2} />
                {/if}
              </button>
              <button
                type="button"
                class="min-w-0 text-left hover:text-primary"
                onclick={() => onOpenTask(task)}
              >
                <span class="block truncate text-[0.866667rem]">{task.title}</span>
                <span class="mt-1 flex items-center gap-1 text-[0.733333rem] text-muted-foreground">
                  <PriorityFlagIcon
                    color={projectPriorityDisplayColor(task.priority, priorities)}
                    theme={theme.current}
                    size={12}
                    class="shrink-0"
                  />
                  <span>{projectPriorityDisplayLabel(task.priority, priorities, t)}</span>
                  {#if task.dueDate}
                    <span>/</span>
                    <span>{task.dueDate}</span>
                  {/if}
                </span>
                {#if task.archivedAt}
                  <span class={cn("mt-1 inline-flex rounded border px-1.5 py-0.5 text-[0.733333rem]", projectTaskArchivedBadgeClass(task))}>
                    {t("projects.taskLifecycle.archived")}
                  </span>
                {/if}
                {#if blockedByCount > 0 || blocksCount > 0}
                  <span class="mt-1 flex flex-wrap items-center gap-1 text-[0.733333rem]">
                    {#if blockedByCount > 0}
                      <span class="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive">
                        {t("projects.list.blockedBy", blockedByCount)}
                      </span>
                    {/if}
                    {#if blocksCount > 0}
                      <span class="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                        {t("projects.list.blocks", blocksCount)}
                      </span>
                    {/if}
                  </span>
                {/if}
              </button>
            </div>
            <div class="mt-2 grid grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-1 border-t border-border/70 pt-2">
              <button
                type="button"
                class="flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 {mobileLayout ? 'h-12 w-12' : 'h-7 w-7'}"
                disabled={Boolean(task.archivedAt) || !previousStatus}
                aria-label={previousStatus ? t("projects.actions.moveTaskToStatus", task.title, previousStatus.name) : t("projects.actions.noPreviousStatus")}
                title={previousStatus ? t("projects.actions.moveTaskToStatus", task.title, previousStatus.name) : t("projects.actions.noPreviousStatus")}
                onclick={() => { void moveTaskToStatus(task, previousStatus); }}
              >
                <ArrowLeft size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                class="flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 {mobileLayout ? 'h-12 w-12' : 'h-7 w-7'}"
                disabled={Boolean(task.archivedAt) || taskSortMode !== "manual" || !previousStatusTask}
                aria-label={previousStatusTask ? t("projects.actions.moveTaskUp", task.title) : t("projects.actions.noPreviousTask")}
                title={previousStatusTask ? t("projects.actions.moveTaskUp", task.title) : t("projects.actions.noPreviousTask")}
                onclick={() => { void moveTaskWithinStatus(task, -1); }}
              >
                <ArrowUp size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                class="min-w-0 rounded border border-border px-1.5 py-0.5 text-[0.733333rem] text-muted-foreground hover:bg-accent hover:text-foreground {mobileLayout ? 'min-h-12' : ''}"
                onclick={() => onOpenTask(task)}
              >
                <span class="block truncate">{t("projects.kanban.openDetails")}</span>
              </button>
              <button
                type="button"
                class="flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 {mobileLayout ? 'h-12 w-12' : 'h-7 w-7'}"
                disabled={Boolean(task.archivedAt) || taskSortMode !== "manual" || !nextStatusTask}
                aria-label={nextStatusTask ? t("projects.actions.moveTaskDown", task.title) : t("projects.actions.noNextTask")}
                title={nextStatusTask ? t("projects.actions.moveTaskDown", task.title) : t("projects.actions.noNextTask")}
                onclick={() => { void moveTaskWithinStatus(task, 1); }}
              >
                <ArrowDown size={13} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                class="flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 {mobileLayout ? 'h-12 w-12' : 'h-7 w-7'}"
                disabled={Boolean(task.archivedAt) || !nextStatus}
                aria-label={nextStatus ? t("projects.actions.moveTaskToStatus", task.title, nextStatus.name) : t("projects.actions.noNextStatus")}
                title={nextStatus ? t("projects.actions.moveTaskToStatus", task.title, nextStatus.name) : t("projects.actions.noNextStatus")}
                onclick={() => { void moveTaskToStatus(task, nextStatus); }}
              >
                <ArrowRight size={13} strokeWidth={1.75} />
              </button>
            </div>
          </article>
          {#if kanbanDropMarkerVisible(status, task, "after")}
            <div class="h-1 rounded-full bg-primary"></div>
          {/if}
        {/each}
        {#if visibleStatusTasks.afterPx > 0}
          <div aria-hidden="true" style={`height: ${visibleStatusTasks.afterPx}px`}></div>
        {/if}
        {#if kanbanDragOverStatusId === status.id && kanbanDragOverPosition === "column"}
          <div class="h-1 rounded-full bg-primary"></div>
        {/if}
        {#if statusTasks.length === 0}
          <div class="rounded-md border border-dashed border-border px-2 py-3 text-[0.8rem] text-muted-foreground">
            {t("projects.kanban.emptyColumn")}
          </div>
        {/if}
        {#if statusTasks.length < totalTasksForStatus(status, statusTasks.length)}
          <button
            type="button"
            class="rounded-md border border-border px-3 text-[0.8rem] text-muted-foreground hover:bg-accent hover:text-foreground {mobileLayout ? 'min-h-12' : 'min-h-9'}"
            onclick={onNeedMore}
          >
            {t("common.loadMore")}
          </button>
        {/if}
      </div>
    </section>
  {/each}
</div>
