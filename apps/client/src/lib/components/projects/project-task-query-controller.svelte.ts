import { Temporal } from "@js-temporal/polyfill";
import { untrack } from "svelte";
import { formatCalendarDate } from "$lib/components/calendar/utils";
import type { CalendarEvent } from "$lib/components/calendar/types";
import type { getCalendar } from "$lib/stores/calendar.svelte";
import type { getProjects } from "$lib/stores/projects.svelte";
import {
  PROJECT_TASK_FILTER_DEFAULTS,
  projectTaskDataFiltersActive,
  taskListColumnWidthsForProject,
  type ProjectTaskFilterState,
  type ProjectTaskListColumnWidths,
} from "$lib/projects/project-list-view";
import {
  createProjectSavedTaskViewSnapshot,
  projectCustomFieldFilterStillExists,
  projectTaskFilterStateFromSavedTaskView,
} from "$lib/projects/saved-task-views";
import {
  customFieldIdFromCustomFieldReference,
  customFieldIdFromTaskListColumn,
  customTaskListColumn,
  DEFAULT_TASK_LIST_COLUMNS,
  taskListColumnsForProject,
  taskListColumnsMatch,
} from "$lib/projects/task-list-columns";
import {
  buildProjectTaskListGroups,
  buildProjectTaskView,
  projectTaskCustomFieldKey,
} from "$lib/projects/task-view";
import { deriveProjectListColumnControls, toggleProjectListColumn } from "$lib/projects/project-toolbar";
import {
  PROJECT_TASK_LIST_COLUMNS,
  type ProjectCustomFieldFilter,
  type ProjectPriority,
  type ProjectSavedTaskView,
  type ProjectTask,
  type ProjectTaskDependencyFilter,
  type ProjectTaskDueFilter,
  type ProjectTaskGroupMode,
  type ProjectTaskListColumn,
  type ProjectTaskScheduleFilter,
  type ProjectTaskSortDirection,
  type ProjectTaskSortMode,
  type ProjectTaskStatusFilter,
  type ProjectTaskTagFilter,
  type ProjectTaskViewRequest,
} from "$lib/projects/types";
import { projectCalendarEventRootId } from "$lib/projects/project-scheduling";
import type { Translate } from "$lib/i18n/translator.svelte";
import type { ProjectCustomFieldValue } from "$lib/projects/types";

type ProjectsStore = ReturnType<typeof getProjects>;
type CalendarStore = ReturnType<typeof getCalendar>;

export interface ProjectTaskQueryControllerInput {
  projects: ProjectsStore;
  calendar: CalendarStore;
  translate: Translate;
}

/** Owns the canonical Projects task query and both backend and local projections. */
export class ProjectTaskQueryController {
  readonly #projects: ProjectsStore;
  readonly #calendar: CalendarStore;
  readonly #translate: ProjectTaskQueryControllerInput["translate"];

  showInactiveSections = $state(false);
  showArchivedTasks = $state(false);
  search = $state("");
  statusFilter = $state<ProjectTaskStatusFilter>("all");
  sectionFilter = $state<string | "all">("all");
  priorityFilter = $state<ProjectPriority | "all">("all");
  dueFilter = $state<ProjectTaskDueFilter>("all");
  dueRangeStart = $state("");
  dueRangeEnd = $state("");
  scheduleFilter = $state<ProjectTaskScheduleFilter>("all");
  dependencyFilter = $state<ProjectTaskDependencyFilter>("all");
  tagFilter = $state<ProjectTaskTagFilter>("all");
  customFieldFilters = $state<ProjectCustomFieldFilter[]>([]);
  groupBy = $state<ProjectTaskGroupMode>("section");
  sortMode = $state<ProjectTaskSortMode>("manual");
  sortDirection = $state<ProjectTaskSortDirection>("asc");
  listColumns = $state<ProjectTaskListColumn[]>([...DEFAULT_TASK_LIST_COLUMNS]);
  listColumnWidths = $state<ProjectTaskListColumnWidths>({});
  savedViewNameDraft = $state("");
  savedViewSaving = $state(false);
  savedViewError = $state<string | null>(null);
  readonly today = Temporal.Now.plainDateISO().toString();

  constructor(input: ProjectTaskQueryControllerInput) {
    this.#projects = input.projects;
    this.#calendar = input.calendar;
    this.#translate = input.translate;
  }

  get projectId(): string | null {
    return this.#projects.selectedProject?.id ?? null;
  }

  get allSections() {
    return this.#projects.sectionsForProjectIncludingInactive(this.projectId);
  }

  get sections() {
    return this.showInactiveSections
      ? this.allSections
      : this.#projects.sectionsForProject(this.projectId);
  }

  get inactiveSectionCount(): number {
    return this.allSections.filter((section) => Boolean(section.hiddenAt || section.archivedAt)).length;
  }

  get statuses() {
    return this.#projects.statusesForProject(this.projectId);
  }

  get priorities() {
    return this.#projects.prioritiesForProject(this.projectId);
  }

  get projectTags() {
    return this.#projects.tagsForProject(this.projectId);
  }

  get customFields() {
    return this.#projects.customFieldsForProject(this.projectId);
  }

  get activeTasks(): ProjectTask[] {
    const sectionIds = new Set(this.sections.map((section) => section.id));
    return this.#projects.tasksForProject(this.projectId)
      .filter((task) => sectionIds.has(task.sectionId));
  }

  get tasksIncludingArchived(): ProjectTask[] {
    const sectionIds = new Set(this.sections.map((section) => section.id));
    return this.#projects.tasksForProjectIncludingArchived(this.projectId)
      .filter((task) => sectionIds.has(task.sectionId));
  }

  get allTasks(): ProjectTask[] {
    return this.showArchivedTasks ? this.tasksIncludingArchived : this.activeTasks;
  }

  get archivedTaskCount(): number {
    return this.#projects.taskViewPage?.archivedCount
      ?? this.tasksIncludingArchived.filter((task) => Boolean(task.archivedAt)).length;
  }

  get taskIds(): Set<string> {
    return new Set(this.allTasks.map((task) => task.id));
  }

  get filterState(): ProjectTaskFilterState {
    return {
      search: this.search,
      statusFilter: this.statusFilter,
      sectionFilter: this.sectionFilter,
      priorityFilter: this.priorityFilter,
      dueFilter: this.dueFilter,
      dueRangeStart: normalizeProjectFilterDate(this.dueRangeStart) ?? "",
      dueRangeEnd: normalizeProjectFilterDate(this.dueRangeEnd) ?? "",
      scheduleFilter: this.scheduleFilter,
      dependencyFilter: this.dependencyFilter,
      tagFilter: this.tagFilter,
      customFieldFilters: this.customFieldFilters,
      groupBy: this.groupBy,
      sortMode: this.sortMode,
      sortDirection: this.sortDirection,
    };
  }

  get weekEnd(): string {
    return Temporal.PlainDate.from(this.today).add({ days: 7 }).toString();
  }

  get allEvents(): CalendarEvent[] {
    const projectId = this.projectId;
    if (!projectId) return [];
    return this.#calendar.rawBlocks
      .filter((event) => event.projectId === projectId)
      .sort((first, second) => first.start.localeCompare(second.start));
  }

  get scheduledTaskIds(): Set<string> {
    return new Set(this.#projects.eventLinks
      .filter((link) => link.linkKind === "scheduled")
      .map((link) => link.taskId));
  }

  get nextScheduledStartByTaskId(): Map<string, string> {
    const eventsById = new Map(this.allEvents.map((event) => [event.id, event]));
    const now = formatCalendarDate(new Date());
    const startsByTaskId = new Map<string, string[]>();
    for (const link of this.#projects.eventLinks) {
      if (link.linkKind !== "scheduled" || !this.taskIds.has(link.taskId)) continue;
      const start = eventsById.get(link.eventId)?.start;
      if (!start) continue;
      const starts = startsByTaskId.get(link.taskId) ?? [];
      starts.push(start);
      startsByTaskId.set(link.taskId, starts);
    }
    const result = new Map<string, string>();
    for (const [taskId, starts] of startsByTaskId) {
      starts.sort((first, second) => first.localeCompare(second));
      result.set(taskId, starts.find((start) => start >= now) ?? starts[0]);
    }
    return result;
  }

  readonly localView = $derived.by(() => {
    const taskIds = this.taskIds;
    const valueByTaskField = new Map<string, ProjectCustomFieldValue>();
    for (const value of this.#projects.customFieldValues) {
      if (taskIds.has(value.taskId)) {
        valueByTaskField.set(projectTaskCustomFieldKey(value.taskId, value.fieldId), value);
      }
    }
    const optionIdsByTaskField = new Map<string, Set<string>>();
    for (const value of this.#projects.customFieldOptionValues) {
      if (!taskIds.has(value.taskId)) continue;
      const key = projectTaskCustomFieldKey(value.taskId, value.fieldId);
      const optionIds = optionIdsByTaskField.get(key) ?? new Set<string>();
      optionIds.add(value.optionId);
      optionIdsByTaskField.set(key, optionIds);
    }
    const tagIdsByTaskId = new Map<string, Set<string>>();
    for (const link of this.#projects.taskTagLinks) {
      if (!taskIds.has(link.taskId)) continue;
      const tagIds = tagIdsByTaskId.get(link.taskId) ?? new Set<string>();
      tagIds.add(link.tagId);
      tagIdsByTaskId.set(link.taskId, tagIds);
    }
    const blocked = new Set(this.#projects.dependencies
      .filter((dependency) => taskIds.has(dependency.blockedTaskId))
      .map((dependency) => dependency.blockedTaskId));
    const blocking = new Set(this.#projects.dependencies
      .filter((dependency) => taskIds.has(dependency.blockingTaskId))
      .map((dependency) => dependency.blockingTaskId));
    return buildProjectTaskView({
      tasks: this.allTasks,
      statuses: this.statuses,
      priorities: this.priorities,
      scheduledTaskIds: this.scheduledTaskIds,
      nextScheduledStartByTaskId: this.nextScheduledStartByTaskId,
      taskTagIdsByTaskId: tagIdsByTaskId,
      dependencyBlockedTaskIds: blocked,
      dependencyBlockingTaskIds: blocking,
      today: this.today,
      weekEnd: this.weekEnd,
      ...this.filterState,
      customFieldFilters: [...this.customFieldFilters],
      filtersApplied: true,
      customFields: this.customFields,
      customFieldOptions: this.#projects.customFieldOptions,
      customFieldValuesByTaskField: valueByTaskField,
      customFieldOptionIdsByTaskField: optionIdsByTaskField,
    });
  });

  get tasks(): ProjectTask[] {
    return this.localView.tasks;
  }

  get listGroups() {
    if (this.groupBy === "section") return [];
    return buildProjectTaskListGroups({
      tasks: this.tasks,
      statuses: this.statuses,
      priorities: this.priorities,
      scheduledTaskIds: this.scheduledTaskIds,
      today: this.today,
      weekEnd: this.weekEnd,
      groupBy: this.groupBy,
    });
  }

  get matchingTaskCount(): number {
    return this.#projects.taskViewPage?.matchedCount ?? this.localView.matchedTaskIds.size;
  }

  get activeFilterCount(): number {
    return this.localView.activeFilterCount;
  }

  get filtersActive(): boolean {
    return this.activeFilterCount > 0;
  }

  get filterControlsActive(): boolean {
    return this.filtersActive || this.showArchivedTasks || this.showInactiveSections;
  }

  get groupingActive(): boolean {
    return this.groupBy !== "section";
  }

  get customizeActive(): boolean {
    return !taskListColumnsMatch(this.listColumns, DEFAULT_TASK_LIST_COLUMNS);
  }

  get dataFiltersActive(): boolean {
    return projectTaskDataFiltersActive(this.filterState);
  }

  get savedViews(): ProjectSavedTaskView[] {
    return this.#projects.savedTaskViewsForProject(this.projectId);
  }

  get matchedEventIds(): Set<string> {
    return new Set(this.#projects.activeView === "calendar"
      ? this.#projects.taskViewPage?.matchedEventIds ?? []
      : this.#projects.eventLinks
        .filter((link) => this.localView.matchedTaskIds.has(link.taskId))
        .map((link) => link.eventId));
  }

  eventMatches(event: CalendarEvent): boolean {
    if (!this.projectId || event.projectId !== this.projectId) return false;
    if (!this.dataFiltersActive) return true;
    return this.matchedEventIds.has(event.id)
      || this.matchedEventIds.has(projectCalendarEventRootId(event));
  }

  get columnControls() {
    const available = [
      ...PROJECT_TASK_LIST_COLUMNS,
      ...this.customFields.map((field) => customTaskListColumn(field.id)),
    ];
    return deriveProjectListColumnControls(available, this.listColumns, (column) => this.columnLabel(column));
  }

  columnLabel(column: ProjectTaskListColumn): string {
    const customFieldId = customFieldIdFromTaskListColumn(column);
    if (customFieldId) {
      return this.customFields.find((field) => field.id === customFieldId)?.name
        ?? this.#translate("projects.columns.customField");
    }
    if (column === "priority") return this.#translate("projects.columns.priority");
    if (column === "estimate") return this.#translate("projects.columns.estimate");
    if (column === "start") return this.#translate("projects.columns.start");
    if (column === "due") return this.#translate("projects.columns.due");
    if (column === "scheduled") return this.#translate("projects.columns.scheduled");
    if (column === "dependencies") return this.#translate("projects.columns.dependencies");
    if (column === "assignee") return this.#translate("projects.columns.assignee");
    if (column === "reviewer") return this.#translate("projects.columns.reviewer");
    return this.#translate("projects.columns.status");
  }

  request(): ProjectTaskViewRequest | null {
    const projectId = this.projectId;
    const view = this.#projects.activeView;
    if (!projectId) return null;
    return {
      projectId,
      view,
      pageSize: view === "kanban" ? 50 : view === "gantt" ? 10_000 : 100,
      columnCursors: {},
      showArchived: this.showArchivedTasks,
      visibleSectionIds: this.sections.map((section) => section.id),
      search: this.search,
      statusFilter: this.statusFilter,
      sectionFilter: this.sectionFilter,
      priorityFilter: this.priorityFilter,
      dueFilter: this.dueFilter,
      dueRangeStart: normalizeProjectFilterDate(this.dueRangeStart) ?? "",
      dueRangeEnd: normalizeProjectFilterDate(this.dueRangeEnd) ?? "",
      scheduleFilter: this.scheduleFilter,
      dependencyFilter: this.dependencyFilter,
      tagFilter: this.tagFilter,
      customFieldFilters: [...this.customFieldFilters],
      sortMode: this.sortMode,
      sortDirection: this.sortDirection,
      today: this.today,
      weekEnd: this.weekEnd,
      candidateEventIds: view === "calendar" ? this.allEvents.map((event) => event.id) : [],
    };
  }

  loadCurrent(selectedTaskIds: readonly string[], selectedTaskId: string | null): void {
    const request = this.request();
    if (!request || !this.#projects.projectDataLoaded(request.projectId)) return;
    const retained = selectedTaskId ? [...selectedTaskIds, selectedTaskId] : [...selectedTaskIds];
    void this.#projects.loadTaskView(request, false, retained).catch((error) => {
      console.error(`load Project ${request.view} task window failed`, error);
    });
  }

  loadNextList(selectedTaskIds: readonly string[]): void {
    const request = this.request();
    const cursor = this.#projects.taskViewPage?.nextCursor;
    if (!request || request.view !== "list" || !cursor || this.#projects.taskViewLoading) return;
    void this.#projects.loadTaskView({ ...request, cursor }, true, [...selectedTaskIds]).catch((error) => {
      console.error("load next Project list task page failed", error);
    });
  }

  loadNextKanban(selectedTaskIds: readonly string[]): void {
    const request = this.request();
    const page = this.#projects.taskViewPage;
    if (!request || request.view !== "kanban" || !page || this.#projects.taskViewLoading) return;
    const columnCursors = Object.fromEntries(page.columnCounts
      .filter((column) => column.nextCursor)
      .map((column) => [column.statusId, column.nextCursor as string]));
    if (Object.keys(columnCursors).length === 0) return;
    void this.#projects.loadTaskView({ ...request, columnCursors }, true, [...selectedTaskIds]).catch((error) => {
      console.error("load next Project Kanban task page failed", error);
    });
  }

  repairDisappearingFields(): void {
    const fieldIds = new Set(this.customFields.map((field) => field.id));
    const optionIds = new Set(this.customFields.flatMap((field) =>
      this.#projects.customFieldOptionsForField(field.id).map((option) => option.id)));
    const repaired = repairProjectTaskQueryReferences({
      sectionFilter: this.sectionFilter,
      tagFilter: this.tagFilter,
      customFieldFilters: this.customFieldFilters,
      sortMode: this.sortMode,
      sortDirection: this.sortDirection,
      sectionIds: new Set(this.sections.map((section) => section.id)),
      tagIds: new Set(this.projectTags.map((tag) => tag.id)),
      fieldIds,
      optionIds,
    });
    if (this.sectionFilter !== repaired.sectionFilter) this.sectionFilter = repaired.sectionFilter;
    if (this.tagFilter !== repaired.tagFilter) this.tagFilter = repaired.tagFilter;
    if (!projectCustomFieldFiltersMatch(this.customFieldFilters, repaired.customFieldFilters)) {
      this.customFieldFilters = [...repaired.customFieldFilters];
    }
    if (this.sortMode !== repaired.sortMode) this.sortMode = repaired.sortMode;
    if (this.sortDirection !== repaired.sortDirection) this.sortDirection = repaired.sortDirection;
  }

  syncListPreferences(): void {
    const fieldIds = new Set(this.customFields.map((field) => field.id));
    const columns = taskListColumnsForProject(this.#projects.viewPreferences, this.projectId, fieldIds);
    const widths = taskListColumnWidthsForProject(
      this.#projects.viewPreferences,
      this.projectId,
      fieldIds,
    );
    const current = untrack(() => ({
      columns: this.listColumns,
      widths: this.listColumnWidths,
    }));
    if (!taskListColumnsMatch(current.columns, columns)) this.listColumns = columns;
    if (!projectColumnWidthsMatch(current.widths, widths)) this.listColumnWidths = widths;
  }

  applyFilterState(state: ProjectTaskFilterState): void {
    this.search = state.search;
    this.statusFilter = state.statusFilter;
    this.sectionFilter = state.sectionFilter;
    this.priorityFilter = state.priorityFilter;
    this.dueFilter = state.dueFilter;
    this.dueRangeStart = state.dueRangeStart;
    this.dueRangeEnd = state.dueRangeEnd;
    this.scheduleFilter = state.scheduleFilter;
    this.dependencyFilter = state.dependencyFilter;
    this.tagFilter = state.tagFilter;
    this.customFieldFilters = [...state.customFieldFilters];
    this.groupBy = state.groupBy;
    this.sortMode = state.sortMode;
    this.sortDirection = state.sortDirection;
  }

  reset(): void {
    this.applyFilterState(PROJECT_TASK_FILTER_DEFAULTS);
  }

  clearCustomFieldFilter(fieldId: string): void {
    this.customFieldFilters = this.customFieldFilters.filter((filter) => filter.fieldId !== fieldId);
  }

  async toggleColumn(column: ProjectTaskListColumn): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) return;
    this.listColumns = toggleProjectListColumn(this.listColumns, column);
    await this.#projects.saveTaskListColumns(projectId, this.listColumns);
  }

  async updateColumnWidths(
    widths: ProjectTaskListColumnWidths,
    options: { persist?: boolean } = {},
  ): Promise<void> {
    if (options.persist && this.projectId) {
      await this.#projects.saveTaskListColumnWidths(this.projectId, widths);
    } else {
      this.listColumnWidths = widths;
    }
  }

  async saveCurrentView(): Promise<void> {
    const name = this.savedViewNameDraft.trim();
    if (!name) {
      this.savedViewError = this.#translate("projects.savedViews.nameRequired");
      return;
    }
    const existing = this.savedViews.find((view) => view.name.toLowerCase() === name.toLowerCase());
    const view = this.snapshot(name, existing?.id ?? crypto.randomUUID());
    if (!view) return;
    this.savedViewSaving = true;
    this.savedViewError = null;
    try {
      await this.#projects.saveTaskView(view);
      this.savedViewNameDraft = "";
    } catch (error) {
      this.savedViewError = this.#translate(
        "projects.savedViews.saveFailed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.savedViewSaving = false;
    }
  }

  async applySavedView(view: ProjectSavedTaskView): Promise<void> {
    this.#projects.activeView = view.viewId;
    this.applyFilterState(projectTaskFilterStateFromSavedTaskView(view));
    this.showArchivedTasks = view.showArchivedTasks;
    this.listColumns = [...view.visibleColumns];
    if (this.projectId) void this.#projects.saveTaskListColumns(this.projectId, view.visibleColumns);
    this.savedViewError = null;
    try {
      if (view.groupBy === "section") {
        await this.#projects.applySectionCollapseState(view.projectId, view.collapsedSectionIds);
      }
    } catch (error) {
      this.savedViewError = this.#translate(
        "projects.savedViews.applyFailed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async deleteSavedView(view: ProjectSavedTaskView): Promise<void> {
    this.savedViewSaving = true;
    this.savedViewError = null;
    try {
      await this.#projects.deleteTaskView(view);
    } catch (error) {
      this.savedViewError = this.#translate(
        "projects.savedViews.deleteFailed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.savedViewSaving = false;
    }
  }

  snapshot(name: string, id: string): ProjectSavedTaskView | undefined {
    const projectId = this.projectId;
    if (!projectId) return undefined;
    return createProjectSavedTaskViewSnapshot({
      ...this.filterState,
      projectId,
      id,
      name,
      viewId: this.#projects.activeView,
      collapsedSectionIds: this.sections.filter((section) => section.collapsed).map((section) => section.id),
      showArchivedTasks: this.showArchivedTasks,
      visibleColumns: this.listColumns,
    });
  }
}

export function normalizeProjectFilterDate(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return Temporal.PlainDate.from(trimmed).toString();
  } catch {
    return undefined;
  }
}

export interface ProjectTaskQueryReferenceInput {
  sectionFilter: string | "all";
  tagFilter: ProjectTaskTagFilter;
  customFieldFilters: readonly ProjectCustomFieldFilter[];
  sortMode: ProjectTaskSortMode;
  sortDirection: ProjectTaskSortDirection;
  sectionIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
  fieldIds: ReadonlySet<string>;
  optionIds: ReadonlySet<string>;
}

/** Repairs query references after project fields or collections disappear. */
export function repairProjectTaskQueryReferences(
  input: ProjectTaskQueryReferenceInput,
): Pick<ProjectTaskFilterState,
  "sectionFilter" | "tagFilter" | "customFieldFilters" | "sortMode" | "sortDirection"> {
  const sectionFilter = input.sectionFilter !== "all" && !input.sectionIds.has(input.sectionFilter)
    ? "all"
    : input.sectionFilter;
  const tagFilter = input.tagFilter !== "all" && input.tagFilter !== "none"
    && !input.tagIds.has(input.tagFilter)
    ? "all"
    : input.tagFilter;
  const customFieldFilters = input.customFieldFilters.filter((filter) =>
    projectCustomFieldFilterStillExists(filter, input.fieldIds, input.optionIds));
  const sortFieldId = customFieldIdFromCustomFieldReference(input.sortMode);
  return sortFieldId && !input.fieldIds.has(sortFieldId)
    ? { sectionFilter, tagFilter, customFieldFilters, sortMode: "manual", sortDirection: "asc" }
    : {
      sectionFilter,
      tagFilter,
      customFieldFilters,
      sortMode: input.sortMode,
      sortDirection: input.sortDirection,
    };
}

function projectCustomFieldFiltersMatch(
  first: readonly ProjectCustomFieldFilter[],
  second: readonly ProjectCustomFieldFilter[],
): boolean {
  return first.length === second.length
    && first.every((filter, index) => JSON.stringify(filter) === JSON.stringify(second[index]));
}

function projectColumnWidthsMatch(
  first: ProjectTaskListColumnWidths,
  second: ProjectTaskListColumnWidths,
): boolean {
  const firstEntries = Object.entries(first);
  const secondEntries = Object.entries(second);
  return firstEntries.length === secondEntries.length
    && firstEntries.every(([key, value]) => second[key as keyof ProjectTaskListColumnWidths] === value);
}
