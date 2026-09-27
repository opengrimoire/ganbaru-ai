<script lang="ts">
  import Archive from "@lucide/svelte/icons/archive";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ArrowUpDown from "@lucide/svelte/icons/arrow-up-down";
  import CalendarRange from "@lucide/svelte/icons/calendar-range";
  import Check from "@lucide/svelte/icons/check";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import CircleDot from "@lucide/svelte/icons/circle-dot";
  import Columns3 from "@lucide/svelte/icons/columns-3";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Flag from "@lucide/svelte/icons/flag";
  import Link2 from "@lucide/svelte/icons/link-2";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Save from "@lucide/svelte/icons/save";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import Tags from "@lucide/svelte/icons/tags";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import type { Component } from "svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import {
    projectTagColorDotStyle,
    projectTagColorSwatchClass,
    projectPriorityDisplayLabel,
  } from "$lib/projects/project-display";
  import {
    PROJECT_SETTINGS_PANEL_MAX_HEIGHT,
    projectToolbarPanelGeometry,
    type ProjectListColumnControl,
    type ProjectToolbarPanel,
  } from "$lib/projects/project-toolbar";
  import {
    customFieldIdFromCustomFieldReference,
    customFieldReference,
  } from "$lib/projects/task-list-columns";
  import { projectCustomFieldUsesOptions } from "$lib/projects/custom-fields";
  import {
    PROJECT_TASK_GROUP_MODES,
    PROJECT_TASK_SORT_MODES,
    type ProjectCustomField,
    type ProjectCustomFieldFilter,
    type ProjectTag,
    type ProjectPriority,
    type ProjectPriorityConfig,
    type ProjectSavedTaskView,
    type ProjectSection,
    type ProjectTaskDependencyFilter,
    type ProjectTaskDueFilter,
    type ProjectTaskGroupMode,
    type ProjectTaskTagFilter,
    type ProjectTaskListColumn,
    type ProjectTaskScheduleFilter,
    type ProjectTaskSortDirection,
    type ProjectTaskSortMode,
    type ProjectTaskStatusFilter,
  } from "$lib/projects/types";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { getViewport } from "$lib/stores/viewport.svelte";
  import {
    APP_FLOATING_SURFACE_SELECTOR,
    cn,
    isAppFloatingSurfaceTarget,
  } from "$lib/utils";
  import PriorityFlagIcon from "./PriorityFlagIcon.svelte";
  import ProjectSettingsPanel from "./ProjectSettingsPanel.svelte";

  const TASK_STATUS_FILTERS: ProjectTaskStatusFilter[] = ["all", "open", "blocked", "done"];
  const TASK_DUE_FILTERS: ProjectTaskDueFilter[] = ["all", "overdue", "today", "week", "none", "range"];
  const TASK_SCHEDULE_FILTERS: ProjectTaskScheduleFilter[] = ["all", "scheduled", "unscheduled"];
  const TASK_DEPENDENCY_FILTERS: ProjectTaskDependencyFilter[] = ["all", "linked", "blocked_by", "blocking", "none"];
  const TASK_SORT_MODES: ProjectTaskSortMode[] = [...PROJECT_TASK_SORT_MODES];
  type ProjectToolbarSubpanel =
    | "filter-status"
    | "filter-section"
    | "filter-priority"
    | "filter-due"
    | "filter-schedule"
    | "filter-dependency"
    | "filter-tag"
    | `filter-custom:${string}`
    | "sort"
    | "visibility"
    | "saved-views"
    | "columns";

  let {
    panel,
    projectId,
    sections,
    priorities,
    projectTags,
    projectCustomFields,
    savedTaskViews,
    taskListColumnControls,
    archivedProjectTaskCount,
    inactiveSectionCount,
    taskFiltersActive,
    savedViewSaving,
    savedViewError,
    taskStatusFilter = $bindable<ProjectTaskStatusFilter>(),
    taskSectionFilter = $bindable<string | "all">(),
    taskPriorityFilter = $bindable<ProjectPriority | "all">(),
    taskDueFilter = $bindable<ProjectTaskDueFilter>(),
    taskDueRangeStart = $bindable<string>(),
    taskDueRangeEnd = $bindable<string>(),
    taskScheduleFilter = $bindable<ProjectTaskScheduleFilter>(),
    taskDependencyFilter = $bindable<ProjectTaskDependencyFilter>(),
    taskTagFilter = $bindable<ProjectTaskTagFilter>(),
    taskCustomFieldFilters = $bindable<ProjectCustomFieldFilter[]>(),
    taskGroupBy = $bindable<ProjectTaskGroupMode>(),
    taskSortMode = $bindable<ProjectTaskSortMode>(),
    taskSortDirection = $bindable<ProjectTaskSortDirection>(),
    showArchivedTasks = $bindable<boolean>(),
    showInactiveSections = $bindable<boolean>(),
    savedViewNameDraft = $bindable<string>(),
    onClose,
    onRevealInactive,
    onProjectSettingsDirtyChange,
    onClearTaskFilters,
    onSaveCurrentTaskView,
    onApplyTaskView,
    onDeleteSavedTaskView,
    onToggleTaskListColumn,
    mobileLayout = false,
  }: {
    panel: ProjectToolbarPanel | null;
    projectId: string | null;
    sections: ProjectSection[];
    priorities: ProjectPriorityConfig[];
    projectTags: ProjectTag[];
    projectCustomFields: ProjectCustomField[];
    savedTaskViews: ProjectSavedTaskView[];
    taskListColumnControls: ProjectListColumnControl[];
    archivedProjectTaskCount: number;
    inactiveSectionCount: number;
    taskFiltersActive: boolean;
    savedViewSaving: boolean;
    savedViewError: string | null;
    taskStatusFilter: ProjectTaskStatusFilter;
    taskSectionFilter: string | "all";
    taskPriorityFilter: ProjectPriority | "all";
    taskDueFilter: ProjectTaskDueFilter;
    taskDueRangeStart: string;
    taskDueRangeEnd: string;
    taskScheduleFilter: ProjectTaskScheduleFilter;
    taskDependencyFilter: ProjectTaskDependencyFilter;
    taskTagFilter: ProjectTaskTagFilter;
    taskCustomFieldFilters: ProjectCustomFieldFilter[];
    taskGroupBy: ProjectTaskGroupMode;
    taskSortMode: ProjectTaskSortMode;
    taskSortDirection: ProjectTaskSortDirection;
    showArchivedTasks: boolean;
    showInactiveSections: boolean;
    savedViewNameDraft: string;
    onClose: () => void;
    onRevealInactive: () => void;
    onProjectSettingsDirtyChange: (dirty: boolean) => void;
    onClearTaskFilters: () => void;
    onSaveCurrentTaskView: () => void | Promise<void>;
    onApplyTaskView: (view: ProjectSavedTaskView) => void | Promise<void>;
    onDeleteSavedTaskView: (view: ProjectSavedTaskView) => void | Promise<void>;
    onToggleTaskListColumn: (column: ProjectTaskListColumn) => void | Promise<void>;
    mobileLayout?: boolean;
  } = $props();

  const projects = getProjects();
  const theme = getTheme();
  const viewport = getViewport();
  const { t } = getLocalization();

  let panelElement = $state<HTMLDivElement | null>(null);
  let subpanelElement = $state<HTMLDivElement | null>(null);
  let subpanelScrollElement = $state<HTMLDivElement | null>(null);
  let subpanelAnchorElement = $state<HTMLElement | null>(null);
  let panelStyle = $state("");
  let subpanelStyle = $state("");
  let subpanelScrollable = $state(false);
  let subpanelCanScrollUp = $state(false);
  let subpanelCanScrollDown = $state(false);
  let activeSubpanel = $state<ProjectToolbarSubpanel | null>(null);
  let lastPanel = $state<ProjectToolbarPanel | null>(null);
  let panelGeometryFrame: number | null = null;
  let subpanelGeometryFrame: number | null = null;
  let subpanelScrollStateFrame: number | null = null;
  function panelPreferredWidth(currentPanel: ProjectToolbarPanel): number {
    if (currentPanel === "settings") return 430;
    if (currentPanel === "group") return 240;
    return 300;
  }

  function panelPreferredHeight(currentPanel: ProjectToolbarPanel): number {
    if (currentPanel === "settings") return PROJECT_SETTINGS_PANEL_MAX_HEIGHT;
    if (currentPanel === "customize") return 360;
    if (currentPanel === "group") return 240;
    return 440;
  }

  function panelTitle(currentPanel: ProjectToolbarPanel): string {
    if (currentPanel === "settings") return t("projects.settings.title");
    if (currentPanel === "group") return t("projects.toolbar.group");
    if (currentPanel === "sort") return t("projects.toolbar.sort");
    if (currentPanel === "customize") return t("projects.toolbar.customize");
    return t("projects.filters.title");
  }

  function panelTriggerElement(currentPanel: ProjectToolbarPanel | null): HTMLElement | null {
    if (!currentPanel) return null;
    return document.querySelector<HTMLElement>(`[data-project-toolbar-trigger="${currentPanel}"]`);
  }

  function refreshPanelGeometry(): void {
    panelGeometryFrame = null;
    if (!panel) return;
    if (mobileLayout) {
      panelStyle = [
        "left: calc(var(--safe-area-left) + 0.5rem)",
        "right: calc(var(--safe-area-right) + 0.5rem)",
        "top: calc(var(--safe-area-top) + var(--mobile-topbar-h) + 0.5rem)",
        "bottom: calc(var(--safe-area-bottom) + 0.5rem)",
        "width: auto",
        "max-height: none",
      ].join("; ");
      return;
    }
    const trigger = panelTriggerElement(panel);
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const geometry = projectToolbarPanelGeometry({
      anchorLeft: rect.left,
      anchorRight: rect.right,
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      preferredWidth: panelPreferredWidth(panel),
      preferredHeight: panelPreferredHeight(panel),
    });
    const styleParts = [
      `left: ${Math.round(geometry.left)}px`,
      `top: ${Math.round(geometry.top)}px`,
      `width: ${Math.round(geometry.width)}px`,
      `max-height: ${Math.round(geometry.maxHeight)}px`,
    ];
    if (panel === "settings") {
      styleParts.push(`height: ${Math.round(geometry.maxHeight)}px`);
    }
    panelStyle = styleParts.join("; ");
    requestSubpanelGeometryRefresh();
  }

  function refreshSubpanelGeometry(): void {
    subpanelGeometryFrame = null;
    if (!activeSubpanel || !subpanelAnchorElement) return;
    if (mobileLayout) {
      subpanelStyle = [
        "left: calc(var(--safe-area-left) + 0.5rem)",
        "right: calc(var(--safe-area-right) + 0.5rem)",
        "top: calc(var(--safe-area-top) + var(--mobile-topbar-h) + 3.5rem)",
        "bottom: calc(var(--safe-area-bottom) + 0.5rem)",
        "width: auto",
        "max-height: none",
      ].join("; ");
      requestSubpanelScrollStateRefresh();
      return;
    }
    const rect = subpanelAnchorElement.getBoundingClientRect();
    const edge = 8;
    const gap = 4;
    const width = Math.min(Math.max(rect.width, 220), Math.max(0, viewport.width - edge * 2));
    const left = Math.min(
      Math.max(edge, rect.left),
      Math.max(edge, viewport.width - edge - width),
    );
    const preferredMaxHeight = 320;
    const spaceBelow = viewport.height - rect.bottom - gap - edge;
    const spaceAbove = rect.top - gap - edge;
    const opensBelow = spaceBelow >= Math.min(preferredMaxHeight, spaceAbove);
    const maxHeight = Math.max(
      96,
      Math.min(preferredMaxHeight, opensBelow ? spaceBelow : spaceAbove, viewport.height - edge * 2),
    );
    const top = opensBelow
      ? rect.bottom + gap
      : rect.top - gap - maxHeight;
    subpanelStyle = [
      `left: ${Math.round(left)}px`,
      `top: ${Math.round(top)}px`,
      `width: ${Math.round(width)}px`,
      `max-height: ${Math.round(maxHeight)}px`,
    ].join("; ");
    requestSubpanelScrollStateRefresh();
  }

  function requestPanelGeometryRefresh(): void {
    if (panelGeometryFrame !== null) cancelAnimationFrame(panelGeometryFrame);
    panelGeometryFrame = requestAnimationFrame(refreshPanelGeometry);
  }

  function requestSubpanelGeometryRefresh(): void {
    if (subpanelGeometryFrame !== null) cancelAnimationFrame(subpanelGeometryFrame);
    subpanelGeometryFrame = requestAnimationFrame(refreshSubpanelGeometry);
  }

  function refreshSubpanelScrollState(): void {
    subpanelScrollStateFrame = null;
    const element = subpanelScrollElement;
    if (!element) {
      subpanelScrollable = false;
      subpanelCanScrollUp = false;
      subpanelCanScrollDown = false;
      return;
    }
    const maxScrollTop = element.scrollHeight - element.clientHeight;
    subpanelScrollable = maxScrollTop > 1;
    subpanelCanScrollUp = element.scrollTop > 1;
    subpanelCanScrollDown = element.scrollTop < maxScrollTop - 1;
  }

  function requestSubpanelScrollStateRefresh(): void {
    if (subpanelScrollStateFrame !== null) cancelAnimationFrame(subpanelScrollStateFrame);
    subpanelScrollStateFrame = requestAnimationFrame(refreshSubpanelScrollState);
  }

  function handlePanelPointerDown(event: PointerEvent): void {
    if (!panel) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (target instanceof Element && target.closest("[role='dialog'][aria-modal='true']")) return;
    const trigger = panelTriggerElement(panel);
    if (isAppFloatingSurfaceTarget(target)) return;
    if (trigger?.contains(target) || subpanelElement?.contains(target)) return;
    if (panelElement?.contains(target)) {
      const element = target instanceof Element ? target : target.parentElement;
      if (!element?.closest("[data-project-toolbar-subpanel-trigger]")) {
        closeSubpanel();
      }
      return;
    }
    onClose();
  }

  function handlePanelKeydown(event: KeyboardEvent): void {
    if (!panel || event.key !== "Escape") return;
    if (isAppFloatingSurfaceTarget(event.target) || document.querySelector(APP_FLOATING_SURFACE_SELECTOR)) return;
    event.preventDefault();
    if (activeSubpanel) {
      closeSubpanel();
      return;
    }
    onClose();
  }

  function panelOptionClass(active: boolean): string {
    return cn(
      "flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 text-left font-medium transition-colors",
      mobileLayout ? "min-h-12 text-sm" : "min-h-8 text-[0.8rem]",
      active
        ? "bg-accent text-foreground"
        : "text-muted-foreground",
    );
  }

  function panelToggleClass(active: boolean): string {
    return cn(
      "flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-left font-medium transition-colors",
      mobileLayout ? "min-h-12 text-sm" : "min-h-8 text-[0.8rem]",
      active
        ? "bg-accent text-foreground"
        : "text-muted-foreground",
    );
  }

  function panelHeaderButtonClass(): string {
    return cn(
      "flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
      mobileLayout ? "h-12 w-12" : "h-7 w-7",
    );
  }

  function refreshActiveSubpanelAfterSelection(): void {
    requestSubpanelGeometryRefresh();
    requestSubpanelScrollStateRefresh();
  }

  function closeSubpanel(): void {
    activeSubpanel = null;
    subpanelAnchorElement = null;
    subpanelScrollable = false;
    subpanelCanScrollUp = false;
    subpanelCanScrollDown = false;
  }

  function toggleSubpanel(subpanel: ProjectToolbarSubpanel, target: EventTarget | null): void {
    if (activeSubpanel === subpanel) {
      closeSubpanel();
      return;
    }
    activeSubpanel = subpanel;
    subpanelAnchorElement = target instanceof HTMLElement ? target : null;
    requestSubpanelGeometryRefresh();
  }

  $effect(() => {
    if (!panel) return;
    const viewportWidth = viewport.width;
    const viewportHeight = viewport.height;
    void viewportWidth;
    void viewportHeight;
    requestPanelGeometryRefresh();
  });

  $effect(() => {
    if (panel === lastPanel) return;
    lastPanel = panel;
    closeSubpanel();
  });

  $effect(() => {
    if (!panel) return;
    requestPanelGeometryRefresh();
    window.addEventListener("scroll", requestPanelGeometryRefresh, true);
    window.addEventListener("resize", requestPanelGeometryRefresh);
    return () => {
      window.removeEventListener("scroll", requestPanelGeometryRefresh, true);
      window.removeEventListener("resize", requestPanelGeometryRefresh);
      if (panelGeometryFrame !== null) {
        cancelAnimationFrame(panelGeometryFrame);
        panelGeometryFrame = null;
      }
      if (subpanelGeometryFrame !== null) {
        cancelAnimationFrame(subpanelGeometryFrame);
        subpanelGeometryFrame = null;
      }
      if (subpanelScrollStateFrame !== null) {
        cancelAnimationFrame(subpanelScrollStateFrame);
        subpanelScrollStateFrame = null;
      }
    };
  });

  $effect(() => {
    if (!activeSubpanel) return;
    const viewportWidth = viewport.width;
    const viewportHeight = viewport.height;
    void viewportWidth;
    void viewportHeight;
    requestSubpanelGeometryRefresh();
    requestSubpanelScrollStateRefresh();
  });

  function taskStatusFilterLabel(filter: ProjectTaskStatusFilter): string {
    if (filter === "open") return t("projects.filters.open");
    if (filter === "blocked") return t("projects.filters.blocked");
    if (filter === "done") return t("projects.filters.done");
    return t("projects.filters.allStatuses");
  }

  function taskDueFilterLabel(filter: ProjectTaskDueFilter): string {
    if (filter === "overdue") return t("projects.filters.overdue");
    if (filter === "today") return t("projects.filters.today");
    if (filter === "week") return t("projects.filters.thisWeek");
    if (filter === "none") return t("projects.filters.noDueDate");
    if (filter === "range") return t("projects.filters.dueRange");
    return t("projects.filters.allDueDates");
  }

  function taskScheduleFilterLabel(filter: ProjectTaskScheduleFilter): string {
    if (filter === "scheduled") return t("projects.filters.scheduled");
    if (filter === "unscheduled") return t("projects.filters.unscheduled");
    return t("projects.filters.allSchedule");
  }

  function taskDependencyFilterLabel(filter: ProjectTaskDependencyFilter): string {
    if (filter === "linked") return t("projects.filters.hasDependencies");
    if (filter === "blocked_by") return t("projects.filters.blockedByDependencies");
    if (filter === "blocking") return t("projects.filters.blockingDependencies");
    if (filter === "none") return t("projects.filters.noDependencies");
    return t("projects.filters.allDependencies");
  }

  function taskTagFilterLabel(filter: ProjectTaskTagFilter): string {
    if (filter === "all") return t("projects.filters.allTags");
    if (filter === "none") return t("projects.filters.noTags");
    return projectTags.find((tag) => tag.id === filter)?.name ?? t("projects.filters.allTags");
  }

  function taskSectionFilterLabel(): string {
    if (taskSectionFilter === "all") return t("projects.filters.allSections");
    return sections.find((section) => section.id === taskSectionFilter)?.name ?? t("projects.filters.allSections");
  }

  function taskPriorityFilterLabel(): string {
    return taskPriorityFilter === "all"
      ? t("projects.filters.allPriorities")
      : projectPriorityDisplayLabel(taskPriorityFilter, priorities, t);
  }

  function customFieldFilterLabel(field: ProjectCustomField): string {
    const filter = customFieldFilterFor(field.id);
    if (!filter) return t("projects.filters.allValues");
    if (filter.mode === "empty") return t("projects.filters.empty");
    if (filter.mode === "filled") return t("projects.filters.filled");
    if (filter.mode === "checkbox") {
      return filter.checked ? t("projects.customFields.checked") : t("projects.customFields.unchecked");
    }
    if (filter.mode !== "option") return t("projects.filters.allValues");
    return projects.customFieldOptionsForField(field.id).find((option) => option.id === filter.optionId)?.name
      ?? t("projects.filters.allValues");
  }

  function sortSummary(): string {
    return `${taskSortModeLabel(taskSortMode)}, ${taskSortDirectionLabel(taskSortDirection)}`;
  }

  function visibilitySummary(): string {
    const visibleOptions = Number(showArchivedTasks) + Number(showInactiveSections);
    return visibleOptions === 0 ? t("projects.toolbar.default") : String(visibleOptions);
  }

  function columnsSummary(): string {
    return String(taskListColumnControls.filter((control) => control.visible).length);
  }

  function savedViewsSummary(): string {
    return savedTaskViews.length > 0 ? String(savedTaskViews.length) : t("projects.toolbar.none");
  }

  function customFieldFromSubpanel(subpanel: ProjectToolbarSubpanel | null): ProjectCustomField | undefined {
    if (!subpanel?.startsWith("filter-custom:")) return undefined;
    const fieldId = subpanel.slice("filter-custom:".length);
    return projectCustomFields.find((field) => field.id === fieldId);
  }

  function subpanelTitle(subpanel: ProjectToolbarSubpanel): string {
    const customField = customFieldFromSubpanel(subpanel);
    if (customField) return customField.name;
    if (subpanel === "filter-status") return t("projects.columns.status");
    if (subpanel === "filter-section") return t("projects.sort.section");
    if (subpanel === "filter-priority") return t("projects.columns.priority");
    if (subpanel === "filter-due") return t("projects.columns.due");
    if (subpanel === "filter-schedule") return t("projects.columns.scheduled");
    if (subpanel === "filter-dependency") return t("projects.columns.dependencies");
    if (subpanel === "filter-tag") return t("projects.settings.tags");
    if (subpanel === "sort") return t("projects.toolbar.sort");
    if (subpanel === "visibility") return t("projects.toolbar.visibility");
    if (subpanel === "saved-views") return t("projects.savedViews.title");
    return t("projects.columns.title");
  }

  function taskGroupModeLabel(mode: ProjectTaskGroupMode): string {
    if (mode === "status") return t("projects.grouping.status");
    if (mode === "priority") return t("projects.grouping.priority");
    if (mode === "due") return t("projects.grouping.due");
    if (mode === "scheduled") return t("projects.grouping.scheduled");
    return t("projects.grouping.section");
  }

  function taskSortModeLabel(mode: ProjectTaskSortMode): string {
    const customFieldId = customFieldIdFromCustomFieldReference(mode);
    if (customFieldId) {
      return projectCustomFields.find((field) => field.id === customFieldId)?.name
        ?? t("projects.columns.customField");
    }
    if (mode === "status") return t("projects.sort.status");
    if (mode === "section") return t("projects.sort.section");
    if (mode === "priority") return t("projects.sort.priority");
    if (mode === "due") return t("projects.sort.due");
    if (mode === "scheduled") return t("projects.sort.scheduled");
    if (mode === "created") return t("projects.sort.created");
    if (mode === "updated") return t("projects.sort.updated");
    if (mode === "estimate") return t("projects.sort.estimate");
    return t("projects.sort.manual");
  }

  function taskSortDirectionLabel(direction: ProjectTaskSortDirection): string {
    return direction === "asc" ? t("projects.sort.ascending") : t("projects.sort.descending");
  }

  function customFieldFilterFor(fieldId: string): ProjectCustomFieldFilter | undefined {
    return taskCustomFieldFilters.find((filter) => filter.fieldId === fieldId);
  }

  function setTaskCustomFieldFilter(filter: ProjectCustomFieldFilter): void {
    taskCustomFieldFilters = [
      ...taskCustomFieldFilters.filter((entry) => entry.fieldId !== filter.fieldId),
      filter,
    ];
  }

  function clearTaskCustomFieldFilter(fieldId: string): void {
    taskCustomFieldFilters = taskCustomFieldFilters.filter((filter) => filter.fieldId !== fieldId);
  }

  function customFieldSortMode(field: ProjectCustomField): ProjectTaskSortMode {
    return customFieldReference(field.id);
  }
</script>

<svelte:window onpointerdown={handlePanelPointerDown} onkeydown={handlePanelKeydown} />


{#snippet menuRow(label: string, value: string, Icon: Component, subpanel: ProjectToolbarSubpanel)}
  <button
    type="button"
    data-project-toolbar-subpanel-trigger
    class={cn(
      "grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto_1rem] items-center gap-2 rounded-md px-2 text-left transition-colors",
      mobileLayout ? "min-h-12" : "min-h-9",
      activeSubpanel === subpanel
        ? "bg-accent text-foreground"
        : "text-foreground hover:bg-accent/70",
    )}
    onclick={(event) => toggleSubpanel(subpanel, event.currentTarget)}
  >
    <Icon size={16} strokeWidth={1.75} class="text-muted-foreground" />
    <span class="truncate text-[0.9rem] font-medium">{label}</span>
    <span class="truncate text-[0.85rem] text-muted-foreground">{value}</span>
    <ChevronRight
      size={15}
      strokeWidth={1.75}
      class={cn(
        "text-muted-foreground transition-transform duration-150",
        activeSubpanel === subpanel && "rotate-90",
      )}
    />
  </button>
{/snippet}

{#snippet optionRow(label: string, active: boolean, onSelect: () => void)}
  <button
    type="button"
    class={panelOptionClass(active)}
    onclick={() => {
      onSelect();
      refreshActiveSubpanelAfterSelection();
    }}
  >
    <span class="truncate">{label}</span>
    {#if active}
      <Check size={13} strokeWidth={1.75} class="shrink-0" />
    {/if}
  </button>
{/snippet}

{#snippet priorityOptionRow(priority: ProjectPriorityConfig)}
  <button
    type="button"
    class={panelOptionClass(taskPriorityFilter === priority.id)}
    onclick={() => {
      taskPriorityFilter = priority.id;
      refreshActiveSubpanelAfterSelection();
    }}
  >
    <span class="flex min-w-0 items-center gap-1.5">
      <PriorityFlagIcon color={priority.color} theme={theme.current} size={13} class="shrink-0" />
      <span class="min-w-0 truncate">{priority.name}</span>
    </span>
    {#if taskPriorityFilter === priority.id}
      <Check size={13} strokeWidth={1.75} class="shrink-0" />
    {/if}
  </button>
{/snippet}

{#snippet toggleRow(label: string, active: boolean, Icon: Component, onSelect: () => void)}
  <button
    type="button"
    class={panelToggleClass(active)}
    onclick={() => {
      onSelect();
      refreshActiveSubpanelAfterSelection();
    }}
  >
    <Icon size={14} strokeWidth={1.75} class="shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 truncate">{label}</span>
    {#if active}
      <Check size={13} strokeWidth={1.75} class="shrink-0" />
    {/if}
  </button>
{/snippet}

{#if panel}
  <div
    bind:this={panelElement}
    class="fixed z-80 flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-[0.8rem] text-foreground shadow-xl"
    style={panelStyle}
    role="dialog"
    tabindex="-1"
    aria-label={panelTitle(panel)}
    data-app-shortcuts="ignore"
  >
    {#if panel === "settings" && projectId}
      <ProjectSettingsPanel
        {projectId}
        presentation="popover"
        onClose={onClose}
        onRevealInactive={onRevealInactive}
        onDirtyChange={onProjectSettingsDirtyChange}
      />
    {:else if panel === "group"}
      <header class="sticky top-0 z-10 flex shrink-0 items-center gap-2 bg-card px-3 pb-1 pt-2">
        <div class="min-w-0 flex-1 truncate text-[0.9rem] font-semibold">{panelTitle(panel)}</div>
        <button
          type="button"
          class={panelHeaderButtonClass()}
          aria-label={t("common.close")}
          title={t("common.close")}
          onclick={onClose}
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-0.5">
        <div class="grid">
          {#each PROJECT_TASK_GROUP_MODES as mode}
            {@render optionRow(taskGroupModeLabel(mode), taskGroupBy === mode, () => { taskGroupBy = mode; })}
          {/each}
        </div>
      </div>
    {:else if panel === "sort"}
      <header class="sticky top-0 z-10 flex shrink-0 items-center gap-2 bg-card px-3 pb-1 pt-2">
        <div class="min-w-0 flex-1 truncate text-[0.9rem] font-semibold">{panelTitle(panel)}</div>
        <button
          type="button"
          class={panelHeaderButtonClass()}
          aria-label={t("common.close")}
          title={t("common.close")}
          onclick={onClose}
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-0.5">
        <div class="grid">
          {#each TASK_SORT_MODES as mode}
            {@render optionRow(taskSortModeLabel(mode), taskSortMode === mode, () => { taskSortMode = mode; })}
          {/each}
          {#each projectCustomFields as field (field.id)}
            {@const mode = customFieldSortMode(field)}
            {@render optionRow(field.name, taskSortMode === mode, () => { taskSortMode = mode; })}
          {/each}
          <div class="my-1 border-t border-border"></div>
          {@render toggleRow(taskSortDirectionLabel(taskSortDirection), true, taskSortDirection === "asc" ? ArrowUp : ArrowDown, () => { taskSortDirection = taskSortDirection === "asc" ? "desc" : "asc"; })}
        </div>
      </div>
    {:else if panel === "filters"}
      <header class="sticky top-0 z-10 flex shrink-0 items-center gap-2 bg-card px-3 pb-1 pt-2">
        <div class="min-w-0 flex-1 truncate text-[0.9rem] font-semibold">{panelTitle(panel)}</div>
        <button
          type="button"
          class={cn(panelHeaderButtonClass(), "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground")}
          aria-label={t("projects.filters.reset")}
          title={t("projects.filters.reset")}
          disabled={!taskFiltersActive}
          onclick={onClearTaskFilters}
        >
          <RotateCcw size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          class={panelHeaderButtonClass()}
          aria-label={t("common.close")}
          title={t("common.close")}
          onclick={onClose}
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-0.5">
        <div class="grid">
          {@render menuRow(t("projects.columns.status"), taskStatusFilterLabel(taskStatusFilter), CircleDot, "filter-status")}
          {@render menuRow(t("projects.sort.section"), taskSectionFilterLabel(), ListTree, "filter-section")}
          {@render menuRow(t("projects.columns.priority"), taskPriorityFilterLabel(), Flag, "filter-priority")}
          {@render menuRow(t("projects.columns.due"), taskDueFilterLabel(taskDueFilter), CalendarRange, "filter-due")}
          {@render menuRow(t("projects.columns.scheduled"), taskScheduleFilterLabel(taskScheduleFilter), CalendarRange, "filter-schedule")}
          {@render menuRow(t("projects.columns.dependencies"), taskDependencyFilterLabel(taskDependencyFilter), Link2, "filter-dependency")}
          {@render menuRow(t("projects.settings.tags"), taskTagFilterLabel(taskTagFilter), Tags, "filter-tag")}
          {#each projectCustomFields as field (field.id)}
            {@render menuRow(field.name, customFieldFilterLabel(field), SlidersHorizontal, `filter-custom:${field.id}`)}
          {/each}

          <div class="my-1 border-t border-border"></div>

          {@render menuRow(t("projects.toolbar.sort"), sortSummary(), ArrowUpDown, "sort")}
          {@render menuRow(t("projects.toolbar.visibility"), visibilitySummary(), Eye, "visibility")}
        </div>
      </div>
    {:else if panel === "customize"}
      <header class="sticky top-0 z-10 flex shrink-0 items-center gap-2 bg-card px-3 pb-1 pt-2">
        <div class="min-w-0 flex-1 truncate text-[0.9rem] font-semibold">{panelTitle(panel)}</div>
        <button
          type="button"
          class={panelHeaderButtonClass()}
          aria-label={t("common.close")}
          title={t("common.close")}
          onclick={onClose}
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-0.5">
        <div class="grid">
          {@render menuRow(t("projects.savedViews.title"), savedViewsSummary(), Save, "saved-views")}
          {@render menuRow(t("projects.columns.title"), columnsSummary(), Columns3, "columns")}
        </div>
      </div>
      {#if savedViewError}
        <div class="shrink-0 border-t border-border px-3 py-2">
          <div class="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[0.766667rem] text-destructive">
            {savedViewError}
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/if}

{#if activeSubpanel}
  <div
    bind:this={subpanelElement}
    class="fixed z-80 flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-[0.8rem] text-foreground shadow-xl"
    style={subpanelStyle}
    role="dialog"
    tabindex="-1"
    aria-label={subpanelTitle(activeSubpanel)}
    data-app-shortcuts="ignore"
  >
    {#if mobileLayout}
      <header class="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-2">
        <button
          type="button"
          class="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          aria-label={t("common.close")}
          onclick={closeSubpanel}
        >
          <ChevronLeft size={18} strokeWidth={1.75} />
        </button>
        <div class="min-w-0 flex-1 truncate text-sm font-semibold">{subpanelTitle(activeSubpanel)}</div>
      </header>
    {/if}
    <div
      bind:this={subpanelScrollElement}
      onscroll={refreshSubpanelScrollState}
      class={cn(
        "project-toolbar-subpanel-scroll-area min-h-0 flex-1 p-1",
        subpanelScrollable
          && subpanelCanScrollUp
          && subpanelCanScrollDown
          && "project-toolbar-subpanel-scroll-both",
        subpanelScrollable
          && subpanelCanScrollUp
          && !subpanelCanScrollDown
          && "project-toolbar-subpanel-scroll-top",
        subpanelScrollable
          && !subpanelCanScrollUp
          && subpanelCanScrollDown
          && "project-toolbar-subpanel-scroll-bottom",
      )}
    >
      <div class="grid">
        {#if activeSubpanel === "filter-status"}
          {#each TASK_STATUS_FILTERS as filter}
            {@render optionRow(taskStatusFilterLabel(filter), taskStatusFilter === filter, () => { taskStatusFilter = filter; })}
          {/each}
        {:else if activeSubpanel === "filter-section"}
          {@render optionRow(t("projects.filters.allSections"), taskSectionFilter === "all", () => { taskSectionFilter = "all"; })}
          {#each sections as section (section.id)}
            {@render optionRow(section.name, taskSectionFilter === section.id, () => { taskSectionFilter = section.id; })}
          {/each}
        {:else if activeSubpanel === "filter-priority"}
          {@render optionRow(t("projects.filters.allPriorities"), taskPriorityFilter === "all", () => { taskPriorityFilter = "all"; })}
          {#each priorities as priority (priority.id)}
            {@render priorityOptionRow(priority)}
          {/each}
        {:else if activeSubpanel === "filter-due"}
          {#each TASK_DUE_FILTERS as filter}
            {@render optionRow(taskDueFilterLabel(filter), taskDueFilter === filter, () => { taskDueFilter = filter; })}
          {/each}
          {#if taskDueFilter === "range"}
            <div class="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1 rounded-md border border-border bg-background p-1">
              <input
                bind:value={taskDueRangeStart}
                placeholder={t("projects.filters.dueRangeStart")}
                aria-label={t("projects.filters.dueRangeStart")}
                class="h-8 min-w-0 rounded bg-transparent px-2 text-[0.8rem] text-foreground placeholder:text-muted-foreground"
              />
              <span class="text-[0.733333rem] text-muted-foreground">{t("projects.filters.dueRangeTo")}</span>
              <input
                bind:value={taskDueRangeEnd}
                placeholder={t("projects.filters.dueRangeEnd")}
                aria-label={t("projects.filters.dueRangeEnd")}
                class="h-8 min-w-0 rounded bg-transparent px-2 text-[0.8rem] text-foreground placeholder:text-muted-foreground"
              />
            </div>
          {/if}
        {:else if activeSubpanel === "filter-schedule"}
          {#each TASK_SCHEDULE_FILTERS as filter}
            {@render optionRow(taskScheduleFilterLabel(filter), taskScheduleFilter === filter, () => { taskScheduleFilter = filter; })}
          {/each}
        {:else if activeSubpanel === "filter-dependency"}
          {#each TASK_DEPENDENCY_FILTERS as filter}
            {@render optionRow(taskDependencyFilterLabel(filter), taskDependencyFilter === filter, () => { taskDependencyFilter = filter; })}
          {/each}
        {:else if activeSubpanel === "filter-tag"}
          {@render optionRow(taskTagFilterLabel("all"), taskTagFilter === "all", () => { taskTagFilter = "all"; })}
          {@render optionRow(taskTagFilterLabel("none"), taskTagFilter === "none", () => { taskTagFilter = "none"; })}
          {#each projectTags as tag (tag.id)}
            <button
              type="button"
              class={panelOptionClass(taskTagFilter === tag.id)}
              onclick={() => {
                taskTagFilter = tag.id;
                refreshActiveSubpanelAfterSelection();
              }}
            >
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class={cn("h-2 w-2 shrink-0 rounded-full border", projectTagColorSwatchClass(tag.color))}
                  style={projectTagColorDotStyle(tag.color, theme.current)}
                ></span>
                <span class="truncate">{tag.name}</span>
              </span>
              {#if taskTagFilter === tag.id}
                <Check size={13} strokeWidth={1.75} class="shrink-0" />
              {/if}
            </button>
          {/each}
        {:else if activeSubpanel === "sort"}
          {#each TASK_SORT_MODES as mode}
            {@render optionRow(taskSortModeLabel(mode), taskSortMode === mode, () => { taskSortMode = mode; })}
          {/each}
          {#each projectCustomFields as field (field.id)}
            {@const mode = customFieldSortMode(field)}
            {@render optionRow(field.name, taskSortMode === mode, () => { taskSortMode = mode; })}
          {/each}
          <div class="my-1 border-t border-border"></div>
          {@render toggleRow(taskSortDirectionLabel(taskSortDirection), true, taskSortDirection === "asc" ? ArrowUp : ArrowDown, () => { taskSortDirection = taskSortDirection === "asc" ? "desc" : "asc"; })}
        {:else if activeSubpanel === "visibility"}
          {@render toggleRow(showArchivedTasks ? t("projects.filters.hideArchived") : t("projects.filters.showArchived", archivedProjectTaskCount), showArchivedTasks, Archive, () => { showArchivedTasks = !showArchivedTasks; })}
          {#if inactiveSectionCount > 0}
            {@render toggleRow(showInactiveSections ? t("projects.filters.hideInactiveSectionsShort") : t("projects.filters.showInactiveSectionsShort", inactiveSectionCount), showInactiveSections, showInactiveSections ? EyeOff : Eye, () => { showInactiveSections = !showInactiveSections; })}
          {/if}
        {:else if activeSubpanel === "saved-views"}
          <form
            class="mb-1 flex gap-1 rounded-md border border-border bg-background p-1"
            onsubmit={(event) => { event.preventDefault(); void onSaveCurrentTaskView(); }}
          >
            <input
              bind:value={savedViewNameDraft}
              placeholder={t("projects.savedViews.namePlaceholder")}
              class="min-h-8 min-w-0 flex-1 rounded bg-transparent px-2 text-[0.8rem] placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              class="flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[0.8rem] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed"
              disabled={savedViewSaving}
            >
              <Save size={13} strokeWidth={1.75} />
              <span>{t("projects.savedViews.save")}</span>
            </button>
          </form>
          {#each savedTaskViews as view (view.id)}
            <div class="grid grid-cols-[minmax(0,1fr)_2rem] overflow-hidden rounded-md border border-border bg-background">
              <button
                type="button"
                class="flex min-h-8 min-w-0 items-center px-2 text-left font-medium text-muted-foreground"
                title={view.name}
                onclick={() => {
                  void onApplyTaskView(view);
                  refreshActiveSubpanelAfterSelection();
                }}
              >
                <span class="truncate">{view.name}</span>
              </button>
              <button
                type="button"
                class="flex min-h-8 items-center justify-center border-l border-border text-muted-foreground disabled:cursor-not-allowed"
                disabled={savedViewSaving}
                aria-label={t("projects.savedViews.delete", view.name)}
                title={t("projects.savedViews.delete", view.name)}
                onclick={() => {
                  void onDeleteSavedTaskView(view);
                  refreshActiveSubpanelAfterSelection();
                }}
              >
                <Trash2 size={12} strokeWidth={1.75} />
              </button>
            </div>
          {/each}
        {:else if activeSubpanel === "columns"}
          {#each taskListColumnControls as control (control.column)}
            {@render optionRow(control.label, control.visible, () => { void onToggleTaskListColumn(control.column); })}
          {/each}
        {:else}
          {@const field = customFieldFromSubpanel(activeSubpanel)}
          {#if field}
            {@const currentCustomFieldFilter = customFieldFilterFor(field.id)}
            {@render optionRow(t("projects.filters.allValues"), currentCustomFieldFilter === undefined, () => clearTaskCustomFieldFilter(field.id))}
            {#if projectCustomFieldUsesOptions(field.fieldType)}
              {@render optionRow(t("projects.filters.empty"), currentCustomFieldFilter?.mode === "empty", () => setTaskCustomFieldFilter({ fieldId: field.id, mode: "empty" }))}
              {#each projects.customFieldOptionsForField(field.id) as option (option.id)}
                {@render optionRow(option.name, currentCustomFieldFilter?.mode === "option" && currentCustomFieldFilter.optionId === option.id, () => setTaskCustomFieldFilter({ fieldId: field.id, mode: "option", optionId: option.id }))}
              {/each}
            {:else if field.fieldType === "checkbox"}
              {@render optionRow(t("projects.customFields.checked"), currentCustomFieldFilter?.mode === "checkbox" && currentCustomFieldFilter.checked, () => setTaskCustomFieldFilter({ fieldId: field.id, mode: "checkbox", checked: true }))}
              {@render optionRow(t("projects.customFields.unchecked"), currentCustomFieldFilter?.mode === "checkbox" && !currentCustomFieldFilter.checked, () => setTaskCustomFieldFilter({ fieldId: field.id, mode: "checkbox", checked: false }))}
              {@render optionRow(t("projects.filters.empty"), currentCustomFieldFilter?.mode === "empty", () => setTaskCustomFieldFilter({ fieldId: field.id, mode: "empty" }))}
            {:else}
              {@render optionRow(t("projects.filters.filled"), currentCustomFieldFilter?.mode === "filled", () => setTaskCustomFieldFilter({ fieldId: field.id, mode: "filled" }))}
              {@render optionRow(t("projects.filters.empty"), currentCustomFieldFilter?.mode === "empty", () => setTaskCustomFieldFilter({ fieldId: field.id, mode: "empty" }))}
            {/if}
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .project-toolbar-subpanel-scroll-area {
    max-height: inherit;
    overflow-y: auto;
  }

  .project-toolbar-subpanel-scroll-top {
    -webkit-mask-image: linear-gradient(to bottom, transparent, black 20px, black);
    mask-image: linear-gradient(to bottom, transparent, black 20px, black);
  }

  .project-toolbar-subpanel-scroll-bottom {
    -webkit-mask-image: linear-gradient(to bottom, black, black calc(100% - 20px), transparent);
    mask-image: linear-gradient(to bottom, black, black calc(100% - 20px), transparent);
  }

  .project-toolbar-subpanel-scroll-both {
    -webkit-mask-image: linear-gradient(to bottom, transparent, black 20px, black calc(100% - 20px), transparent);
    mask-image: linear-gradient(to bottom, transparent, black 20px, black calc(100% - 20px), transparent);
  }
</style>
