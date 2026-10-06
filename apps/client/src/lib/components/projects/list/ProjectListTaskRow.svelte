<script lang="ts">
  import CollectionRow from "$lib/components/collections/CollectionRow.svelte";
  import CollectionCell from "$lib/components/collections/CollectionCell.svelte";
  import Check from "@lucide/svelte/icons/check";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    projectTagColorDotStyle,
    projectTagColorSwatchClass,
    projectTaskArchivedBadgeClass,
  } from "$lib/projects/display";
  import type {
    ProjectCustomField,
    ProjectCustomFieldOption,
    ProjectCustomFieldValue,
    ProjectCustomFieldValueUpdate,
    ProjectTag,
    ProjectPriority,
    ProjectPriorityConfig,
    ProjectStatus,
    ProjectTask,
    ProjectTaskListColumn,
  } from "$lib/projects/types";
  import type { Theme } from "$lib/themes";
  import { cn } from "$lib/utils";
  import ProjectListColumnCell from "./ProjectListColumnCell.svelte";
  import ProjectListSubtaskRows from "./ProjectListSubtaskRows.svelte";
  import { getProjectListTableContext } from "./table-context";

  let {
    task,
    status,
    statuses,
    priorities,
    subtasks,
    scheduled,
    taskTags,
    hiddenTagCount,
    blockedByCount,
    blocksCount,
    taskListColumns,
    projectCustomFields,
    selectedTaskId,
    taskSelected,
    gridTemplate,
    gridMinWidth,
    sectionName,
    draggable,
    dragging,
    dropPending,
    statusMenuOpen,
    priorityMenuOpen,
    startDateMenuOpen,
    dueDateMenuOpen,
    theme,
    estimateLabel,
    customFieldDisplayValue,
    customFieldOptions,
    customFieldValue,
    customFieldOptionValues,
    statusForTask,
    onSaveCustomFieldValue,
    onToggleTaskSelection,
    onOpenTask,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
    onToggleStatusMenu,
    onSetStatus,
    onTogglePriorityMenu,
    onSetPriority,
    onToggleStartDateMenu,
    onCloseStartDateMenu,
    onSetStartDate,
    onClearStartDate,
    onSetStartTime,
    onClearStartTime,
    onToggleDueDateMenu,
    onCloseDueDateMenu,
    onSetDueDate,
    onClearDueDate,
    onSetDueTime,
    onClearDueTime,
    onToggleSubtaskDone,
  }: {
    task: ProjectTask;
    status: ProjectStatus | undefined;
    statuses: ProjectStatus[];
    priorities: ProjectPriorityConfig[];
    subtasks: ProjectTask[];
    scheduled: string | null;
    taskTags: ProjectTag[];
    hiddenTagCount: number;
    blockedByCount: number;
    blocksCount: number;
    taskListColumns: ProjectTaskListColumn[];
    projectCustomFields: ProjectCustomField[];
    selectedTaskId: string | null;
    taskSelected: boolean;
    gridTemplate: string;
    gridMinWidth: string;
    sectionName?: string;
    draggable: boolean;
    dragging: boolean;
    dropPending: boolean;
    statusMenuOpen: boolean;
    priorityMenuOpen: boolean;
    startDateMenuOpen: boolean;
    dueDateMenuOpen: boolean;
    theme: Theme;
    estimateLabel: (minutes: number) => string;
    customFieldDisplayValue: (task: ProjectTask, field: ProjectCustomField) => string | undefined;
    customFieldOptions: (field: ProjectCustomField) => ProjectCustomFieldOption[];
    customFieldValue: (task: ProjectTask, field: ProjectCustomField) => ProjectCustomFieldValue | undefined;
    customFieldOptionValues: (task: ProjectTask, field: ProjectCustomField) => ProjectCustomFieldOption[];
    statusForTask: (task: ProjectTask) => ProjectStatus | undefined;
    onSaveCustomFieldValue: (
      task: ProjectTask,
      field: ProjectCustomField,
      value: Omit<ProjectCustomFieldValueUpdate, "taskId" | "fieldId">,
    ) => Promise<void>;
    onToggleTaskSelection: (task: ProjectTask) => void;
    onOpenTask: (task: ProjectTask) => void;
    onPointerDown?: (event: PointerEvent) => void;
    onPointerUp?: (event: PointerEvent) => void;
    onPointerCancel?: (event: PointerEvent) => void;
    onDragStart?: (event: DragEvent) => void;
    onDragEnd?: (event: DragEvent) => void;
    onDragOver?: (event: DragEvent) => void;
    onDrop?: (event: DragEvent) => void;
    onToggleStatusMenu: () => void;
    onSetStatus: (status: ProjectStatus) => void;
    onTogglePriorityMenu: () => void;
    onSetPriority: (priority: ProjectPriority) => void;
    onToggleStartDateMenu: () => void;
    onCloseStartDateMenu: () => void;
    onSetStartDate: (startDate: string) => void;
    onClearStartDate: () => void;
    onSetStartTime: (startTime: string) => void;
    onClearStartTime: () => void;
    onToggleDueDateMenu: () => void;
    onCloseDueDateMenu: () => void;
    onSetDueDate: (dueDate: string) => void;
    onClearDueDate: () => void;
    onSetDueTime: (dueTime: string) => void;
    onClearDueTime: () => void;
    onToggleSubtaskDone: (task: ProjectTask) => void;
  } = $props();

  const { t } = getLocalization();
  const context = getProjectListTableContext();
</script>

<div
  role="listitem"
  class={cn(
    "project-list-divider relative",
    task.archivedAt && "opacity-70",
    dragging && "opacity-50",
    dropPending && "opacity-60",
  )}
  style={`min-width: ${gridMinWidth}; ${context?.rowStyle(task, selectedTaskId === task.id) ?? ""}`}
>
  <CollectionRow template={gridTemplate} minWidth={gridMinWidth} divider={false} selected={selectedTaskId === task.id}
    role="group"
    aria-label={task.title}
    {draggable}
    onpointerdown={(event) => onPointerDown?.(event)}
    onpointerup={(event) => onPointerUp?.(event)}
    onpointercancel={(event) => onPointerCancel?.(event)}
    ondragstart={(event) => onDragStart?.(event)}
    ondragend={(event) => onDragEnd?.(event)}
    ondragover={(event) => onDragOver?.(event)}
    ondrop={(event) => onDrop?.(event)}
  >
    <div class={`flex h-full items-center justify-center ${context?.cellClass("selection") ?? ""}`} style={context?.cellStyle("selection")}>
      <button
        type="button"
        class={cn(
          "project-list-selection-control flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border",
          taskSelected
            ? "border-primary bg-primary text-primary-foreground opacity-100"
            : "border-border bg-background opacity-0 hover:bg-accent group-hover/row:opacity-100 group-focus-within/row:opacity-100",
        )}
        aria-label={taskSelected ? t("projects.actions.unselectTask", task.title) : t("projects.actions.selectTask", task.title)}
        onclick={() => onToggleTaskSelection(task)}
      >
        {#if taskSelected}
          <Check size={13} strokeWidth={2} />
        {/if}
      </button>
    </div>
    <div class={`flex h-full items-center justify-center ${context?.cellClass("open") ?? ""}`} style={context?.cellStyle("open")}>
      <button
        type="button"
        class="project-list-open-control flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/row:opacity-100 group-focus-within/row:opacity-100"
        aria-label={t("projects.actions.openTaskDetails", task.title)}
        onclick={() => onOpenTask(task)}
      >
        <ChevronRight size={14} strokeWidth={1.75} />
      </button>
    </div>
    <CollectionCell class={context?.cellClass("name")} style={context?.cellStyle("name")}>
    <button
      type="button"
      data-list-row-drag-source="true" data-collection-cell-primary
      class="flex min-h-9 w-full min-w-0 cursor-pointer flex-col justify-center rounded-sm text-left outline-none focus-visible:bg-accent/40"
      aria-label={t("projects.actions.openTaskDetails", task.title)}
      onclick={() => onOpenTask(task)}
    >
      <div class="truncate">{task.title}</div>
      {#if sectionName || subtasks.length > 0}
        <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 text-[0.733333rem] text-muted-foreground">
          {#if sectionName}
            <span class="truncate">{sectionName}</span>
          {/if}
          {#if subtasks.length > 0}
            <span>{t("projects.list.subtasks", subtasks.length)}</span>
          {/if}
        </div>
      {/if}
      {#if taskTags.length > 0}
        <div class="mt-1 flex min-w-0 flex-wrap gap-1">
          {#each taskTags as tag (tag.id)}
            <span class="inline-flex max-w-full items-center gap-1 rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[0.666667rem] text-muted-foreground">
              <span
                class={cn("h-1.5 w-1.5 shrink-0 rounded-full border", projectTagColorSwatchClass(tag.color))}
                style={projectTagColorDotStyle(tag.color, theme)}
              ></span>
              <span class="truncate">{tag.name}</span>
            </span>
          {/each}
          {#if hiddenTagCount > 0}
            <span class="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[0.666667rem] text-muted-foreground">
              {t("projects.list.moreTags", hiddenTagCount)}
            </span>
          {/if}
        </div>
      {/if}
      {#if task.archivedAt}
        <span class={cn("mt-1 inline-flex w-fit rounded border px-1.5 py-0.5 text-[0.733333rem]", projectTaskArchivedBadgeClass(task))}>
          {t("projects.taskLifecycle.archived")}
        </span>
      {/if}
    </button>
    </CollectionCell>
    {#each taskListColumns as column (column)}
      <ProjectListColumnCell
        {column}
        {task}
        {status}
        {statuses}
        {priorities}
        statusMenuOpen={statusMenuOpen}
        priorityMenuOpen={priorityMenuOpen}
        startDateMenuOpen={startDateMenuOpen}
        dueDateMenuOpen={dueDateMenuOpen}
        {projectCustomFields}
        {scheduled}
        {blockedByCount}
        {blocksCount}
        {estimateLabel}
        {customFieldDisplayValue}
        {customFieldOptions}
        {customFieldValue}
        {customFieldOptionValues}
        onSaveCustomFieldValue={onSaveCustomFieldValue}
        onToggleStatusMenu={onToggleStatusMenu}
        onSetStatus={onSetStatus}
        onTogglePriorityMenu={onTogglePriorityMenu}
        onSetPriority={onSetPriority}
        onToggleStartDateMenu={onToggleStartDateMenu}
        onCloseStartDateMenu={onCloseStartDateMenu}
        onSetStartDate={onSetStartDate}
        onClearStartDate={onClearStartDate}
        onSetStartTime={onSetStartTime}
        onClearStartTime={onClearStartTime}
        onToggleDueDateMenu={onToggleDueDateMenu}
        onCloseDueDateMenu={onCloseDueDateMenu}
        onSetDueDate={onSetDueDate}
        onClearDueDate={onClearDueDate}
        onSetDueTime={onSetDueTime}
        onClearDueTime={onClearDueTime}
      />
    {/each}
    <div class="min-h-11 self-stretch" aria-hidden="true"></div>
  </CollectionRow>
  <ProjectListSubtaskRows
    {subtasks}
    {selectedTaskId}
    {statusForTask}
    onToggleDone={onToggleSubtaskDone}
    onOpenTask={onOpenTask}
  />
</div>

<style>
  @media (hover: none) and (pointer: coarse) {
    .project-list-selection-control,
    .project-list-open-control { opacity: 1; }
  }

</style>
