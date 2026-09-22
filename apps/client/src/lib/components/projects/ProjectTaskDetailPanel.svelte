<script lang="ts">
  import { Temporal } from "@js-temporal/polyfill";
  import CalendarScrollbar from "$lib/components/calendar/CalendarScrollbar.svelte";
  import ConfirmDialog from "$lib/components/ui/ConfirmDialog.svelte";
  import {
    selectDateRangeEnd,
    selectDateRangeStart,
  } from "$lib/calendar/date-range-selection";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { activateModalFocus } from "$lib/modal-focus";
  import { BUILD_PLATFORM_PROFILE, platformHasCapability } from "$lib/platform";
  import type {
    ProjectChecklistItem,
    ProjectCustomField,
    ProjectCustomFieldOption,
    ProjectTag,
    ProjectLinkableEvent,
    ProjectPriority,
    ProjectStatus,
    ProjectTask,
    ProjectTaskType,
  } from "$lib/projects/types";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getProjects } from "$lib/stores/projects.svelte";
  import { getMobileBackStack } from "$lib/stores/mobile-back-stack.svelte";
  import { getTheme } from "$lib/stores/theme.svelte";
  import { cn } from "$lib/utils";
  import type { ProjectTaskModalLayout } from "$lib/projects/project-toolbar";
  import {
    canCreateTag as canCreateTaskTag,
    dependencyCandidateTasks as buildDependencyCandidateTasks,
    parentTaskCandidateTasks as buildParentTaskCandidateTasks,
    projectTaskDetailCustomFieldDirty,
    projectTaskDetailCustomFieldDrafts,
    projectTaskDetailMergeSavedCustomFieldDraft,
    projectTaskDetailCustomFieldRawDraft,
    projectTaskDetailCustomFieldSaveDraft,
    projectTaskDetailDraftDirty,
    projectTaskDetailDraftFromTask,
    projectTaskDetailDraftPatch,
    tagCandidateTags as buildTagCandidateTags,
    type ProjectTaskDetailDraft,
    type ProjectTaskDetailCustomFieldDrafts,
  } from "$lib/projects/project-task-detail";
  import ProjectTaskDetailChecklistSection from "./ProjectTaskDetailChecklistSection.svelte";
  import ProjectTaskDetailCustomFieldsSection from "./ProjectTaskDetailCustomFieldsSection.svelte";
  import ProjectTaskDetailDescriptionSection from "./ProjectTaskDetailDescriptionSection.svelte";
  import ProjectTaskDetailDependenciesSection from "./ProjectTaskDetailDependenciesSection.svelte";
  import ProjectTaskDetailFooter from "./ProjectTaskDetailFooter.svelte";
  import ProjectTaskDetailHeader from "./ProjectTaskDetailHeader.svelte";
  import ProjectTaskDetailHistorySection from "./ProjectTaskDetailHistorySection.svelte";
  import ProjectTaskDetailParentSection from "./ProjectTaskDetailParentSection.svelte";
  import ProjectTaskDetailPlanningSection from "./ProjectTaskDetailPlanningSection.svelte";
  import ProjectTaskDetailPropertiesSection from "./ProjectTaskDetailPropertiesSection.svelte";
  import ProjectTaskDetailScheduledBlocksController from "./ProjectTaskDetailScheduledBlocksController.svelte";
  import ProjectTaskDetailSubtasksSection from "./ProjectTaskDetailSubtasksSection.svelte";
  import ProjectTaskDetailTagsSection from "./ProjectTaskDetailTagsSection.svelte";

  let {
    taskId,
    layout = "modal",
    showArchivedTasks,
    showInactiveSections,
    onClose,
    onOpenTask,
    onShowArchivedTasks,
  }: {
    taskId: string;
    layout?: ProjectTaskModalLayout;
    showArchivedTasks: boolean;
    showInactiveSections: boolean;
    onClose: () => void;
    onOpenTask: (taskId: string) => void;
    onShowArchivedTasks: () => void;
  } = $props();

  const projects = getProjects();
  const calendar = getCalendar();
  const theme = getTheme();
  const { t } = getLocalization();
  const mobileBackStack = getMobileBackStack();
  const androidSystemBackAvailable = platformHasCapability(
    BUILD_PLATFORM_PROFILE,
    "system.android-back",
  );

  let detailDraftTaskId = $state<string | null>(null);
  let detailDialog = $state<HTMLDivElement | null>(null);
  let detailDraftUpdatedAt = $state<string | null>(null);
  let detailTitle = $state("");
  let detailDescription = $state("");
  let detailSectionId = $state("");
  let detailStatusId = $state("");
  let detailPriority = $state<ProjectPriority>("normal");
  let detailTaskType = $state<ProjectTaskType>("task");
  let detailEstimateMinutes = $state("");
  let detailStartDate = $state("");
  let detailDueDate = $state("");
  let detailTargetEndDate = $state("");
  let detailBlockerReason = $state("");
  let detailChangeReason = $state("");
  let detailMilestone = $state(false);
  let detailSaving = $state(false);
  let detailError = $state<string | null>(null);
  let detailScrollContainer: HTMLDivElement | undefined = $state();
  let discardCloseConfirmOpen = $state(false);
  let datePickerTarget: DetailDateTarget | null = $state(null);
  let customFieldDatePickerTarget = $state<string | null>(null);
  let pendingTaskOpenId = $state<string | null>(null);
  let subtaskDraft = $state("");
  let checklistDraft = $state("");
  let tagDraft = $state("");
  let checklistTitleDrafts = $state<Record<string, string>>({});
  let customFieldTextDrafts = $state<Record<string, string>>({});
  let customFieldNumberDrafts = $state<Record<string, string>>({});
  let customFieldDateDrafts = $state<Record<string, string>>({});
  let customFieldCheckboxDrafts = $state<Record<string, boolean>>({});
  let customFieldSelectDrafts = $state<Record<string, string>>({});
  let customFieldMultiDrafts = $state<Record<string, string[]>>({});
  const customFieldSaveGenerations = new Map<string, number>();
  const customFieldSaveQueues = new Map<string, Promise<void>>();
  let dependencySearch = $state("");
  let parentTaskSearch = $state("");

  type DetailDateTarget = "start" | "due" | "target";

  const selectedTask = $derived(projects.taskById(taskId));
  const selectedProjectId = $derived(selectedTask?.projectId ?? null);
  const allProjectSections = $derived(projects.sectionsForProjectIncludingInactive(selectedProjectId));
  const sections = $derived.by(() =>
    showInactiveSections ? allProjectSections : projects.sectionsForProject(selectedProjectId)
  );
  const visibleSectionIds = $derived.by(() => new Set(sections.map((section) => section.id)));
  const statuses = $derived(projects.statusesForProject(selectedProjectId));
  const priorities = $derived(projects.prioritiesForProject(selectedProjectId));
  const activeProjectTasks = $derived.by(() =>
    projects.tasksForProject(selectedProjectId).filter((task) => visibleSectionIds.has(task.sectionId))
  );
  const allProjectTasksWithArchived = $derived.by(() =>
    projects.tasksForProjectIncludingArchived(selectedProjectId)
      .filter((task) => visibleSectionIds.has(task.sectionId))
  );
  const allProjectTasks = $derived(showArchivedTasks ? allProjectTasksWithArchived : activeProjectTasks);
  const projectCustomFields = $derived(projects.customFieldsForProject(selectedProjectId));
  const allProjectEvents = $derived.by(() => {
    if (!selectedProjectId) return [];
    return calendar.rawBlocks
      .filter((event) => event.projectId === selectedProjectId)
      .sort((a, b) => a.start.localeCompare(b.start));
  });
  const detailDirty = $derived.by(() => {
    if (!selectedTask) return false;
    return projectTaskDetailDraftDirty(selectedTask, currentDetailDraft());
  });
  const detailHasUnsavedEdits = $derived.by(() => {
    if (!selectedTask) return false;
    return detailDirty
      || projectCustomFields.some((field) => customFieldValueDirty(selectedTask, field))
      || projects.checklistItemsForTask(selectedTask.id).some(
        (item) => (checklistTitleDrafts[item.id] ?? item.title) !== item.title,
      );
  });
  const todayDate = $derived(Temporal.Now.plainDateISO().toString());

  $effect(() => {
    if (!selectedTask) return;
    if (
      detailDraftTaskId !== selectedTask.id
      || (!detailHasUnsavedEdits && detailDraftUpdatedAt !== selectedTask.updatedAt)
    ) {
      loadTaskDetailDraft(selectedTask);
    }
  });

  function statusForTask(task: ProjectTask): ProjectStatus | undefined {
    return projects.statusById(task.statusId);
  }

  function taskById(taskId: string): ProjectTask | undefined {
    return allProjectTasks.find((task) => task.id === taskId);
  }

  function blockedByDependencies(task: ProjectTask) {
    return projects.dependenciesBlockingTask(task.id);
  }

  function blocksDependencies(task: ProjectTask) {
    return projects.dependenciesBlockedByTask(task.id);
  }

  function dependencyCandidateTasks(task: ProjectTask): ProjectTask[] {
    return buildDependencyCandidateTasks({
      task,
      allProjectTasks,
      blockedByDependencies: blockedByDependencies(task),
      dependencySearch,
    });
  }

  function taskHasAnySubtasks(task: ProjectTask): boolean {
    return projects.subtasksForTaskIncludingArchived(task.id).length > 0;
  }

  function parentTaskCandidateTasks(task: ProjectTask): ProjectTask[] {
    return buildParentTaskCandidateTasks({
      task,
      activeProjectTasks,
      parentTaskSearch,
    });
  }

  function tagsForTask(task: ProjectTask): ProjectTag[] {
    return projects.tagsForTask(task.id);
  }

  function tagCandidateTags(task: ProjectTask): ProjectTag[] {
    return buildTagCandidateTags({
      tags: projects.unlinkedTagsForTask(task),
      tagDraft,
    });
  }

  function canCreateTag(task: ProjectTask): boolean {
    return canCreateTaskTag({
      projectTags: projects.tagsForProject(task.projectId),
      tagDraft,
    });
  }

  function customFieldOptions(field: ProjectCustomField): ProjectCustomFieldOption[] {
    return projects.customFieldOptionsForField(field.id);
  }

  function currentDetailDraft(): ProjectTaskDetailDraft {
    return {
      title: detailTitle,
      description: detailDescription,
      sectionId: detailSectionId,
      statusId: detailStatusId,
      priority: detailPriority,
      taskType: detailTaskType,
      estimateMinutes: detailEstimateMinutes,
      startDate: detailStartDate,
      dueDate: detailDueDate,
      targetEndDate: detailTargetEndDate,
      blockerReason: detailBlockerReason,
      changeReason: detailChangeReason,
      milestone: detailMilestone,
    };
  }

  function currentCustomFieldDrafts(): ProjectTaskDetailCustomFieldDrafts {
    return {
      textDrafts: customFieldTextDrafts,
      numberDrafts: customFieldNumberDrafts,
      dateDrafts: customFieldDateDrafts,
      checkboxDrafts: customFieldCheckboxDrafts,
      selectDrafts: customFieldSelectDrafts,
      multiDrafts: customFieldMultiDrafts,
    };
  }

  function customFieldValueDirty(task: ProjectTask, field: ProjectCustomField): boolean {
    return projectTaskDetailCustomFieldDirty({
      field,
      drafts: currentCustomFieldDrafts(),
      value: projects.customFieldValueForTask(task.id, field.id),
      optionValues: projects.customFieldOptionValuesForTask(task.id, field.id),
    });
  }

  function subtasksForTask(parent: ProjectTask): ProjectTask[] {
    return showArchivedTasks
      ? projects.subtasksForTaskIncludingArchived(parent.id)
      : projects.subtasksForTask(parent.id);
  }

  function loadTaskDetailDraft(task: ProjectTask): void {
    detailDraftTaskId = task.id;
    detailDraftUpdatedAt = task.updatedAt;
    const detailDraft = projectTaskDetailDraftFromTask(task);
    detailTitle = detailDraft.title;
    detailDescription = detailDraft.description;
    detailSectionId = detailDraft.sectionId;
    detailStatusId = detailDraft.statusId;
    detailPriority = detailDraft.priority;
    detailTaskType = detailDraft.taskType;
    detailEstimateMinutes = detailDraft.estimateMinutes;
    detailStartDate = detailDraft.startDate;
    detailDueDate = detailDraft.dueDate;
    detailTargetEndDate = detailDraft.targetEndDate;
    detailBlockerReason = detailDraft.blockerReason;
    detailChangeReason = detailDraft.changeReason;
    detailMilestone = detailDraft.milestone;
    detailError = null;
    subtaskDraft = "";
    checklistDraft = "";
    tagDraft = "";
    checklistTitleDrafts = Object.fromEntries(
      projects.checklistItemsForTask(task.id).map((item) => [item.id, item.title]),
    );
    const customFieldDrafts = projectTaskDetailCustomFieldDrafts({
      fields: projects.customFieldsForProject(task.projectId),
      valueForField: (field) => projects.customFieldValueForTask(task.id, field.id),
      optionValuesForField: (field) => projects.customFieldOptionValuesForTask(task.id, field.id),
    });
    customFieldTextDrafts = customFieldDrafts.textDrafts;
    customFieldNumberDrafts = customFieldDrafts.numberDrafts;
    customFieldDateDrafts = customFieldDrafts.dateDrafts;
    customFieldCheckboxDrafts = customFieldDrafts.checkboxDrafts;
    customFieldSelectDrafts = customFieldDrafts.selectDrafts;
    customFieldMultiDrafts = customFieldDrafts.multiDrafts;
    dependencySearch = "";
    parentTaskSearch = "";
    datePickerTarget = null;
    customFieldDatePickerTarget = null;
  }

  function closeTaskDetailImmediately(): void {
    if (selectedTask) loadTaskDetailDraft(selectedTask);
    onClose();
  }

  function requestTaskDetailClose(): void {
    if (detailHasUnsavedEdits) {
      pendingTaskOpenId = null;
      discardCloseConfirmOpen = true;
      return;
    }
    closeTaskDetailImmediately();
  }

  $effect(() => {
    if (!androidSystemBackAvailable) return;
    return mobileBackStack.activate({
      handle: requestTaskDetailClose,
    });
  });

  $effect(() => {
    if (!androidSystemBackAvailable || !datePickerTarget) return;
    return mobileBackStack.activate({
      handle: () => {
        datePickerTarget = null;
      },
    });
  });

  $effect(() => {
    if (!androidSystemBackAvailable || !customFieldDatePickerTarget) return;
    return mobileBackStack.activate({
      handle: () => {
        customFieldDatePickerTarget = null;
      },
    });
  });

  $effect(() => {
    if (!selectedTask || !detailDialog || discardCloseConfirmOpen) return;
    return activateModalFocus(detailDialog);
  });

  function confirmDiscardTaskDetail(): void {
    discardCloseConfirmOpen = false;
    const nextTaskId = pendingTaskOpenId;
    pendingTaskOpenId = null;
    if (selectedTask) loadTaskDetailDraft(selectedTask);
    if (nextTaskId) {
      onOpenTask(nextTaskId);
      return;
    }
    onClose();
  }

  function cancelDiscardTaskDetail(): void {
    discardCloseConfirmOpen = false;
    pendingTaskOpenId = null;
  }

  function openTaskDetail(task: ProjectTask): void {
    if (detailHasUnsavedEdits) {
      pendingTaskOpenId = task.id;
      discardCloseConfirmOpen = true;
      return;
    }
    onOpenTask(task.id);
  }

  function handleTaskDetailKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented || discardCloseConfirmOpen) return;
    if (detailDialog?.querySelector("[data-app-floating-surface]")) return;
    event.preventDefault();
    event.stopPropagation();
    requestTaskDetailClose();
  }

  function setDetailDateValue(target: DetailDateTarget, value: string): void {
    if (target === "start") {
      detailStartDate = value;
      return;
    }
    if (target === "due") {
      detailDueDate = value;
      return;
    }
    if (target === "target") {
      detailTargetEndDate = value;
      return;
    }
  }

  function toggleDetailDatePicker(target: DetailDateTarget): void {
    datePickerTarget = datePickerTarget === target ? null : target;
    customFieldDatePickerTarget = null;
  }

  function selectDetailDate(dateStr: string): void {
    if (!datePickerTarget) return;
    if (datePickerTarget === "start") {
      const nextRange = selectDateRangeStart({
        selectedDate: dateStr,
        startDate: detailStartDate || undefined,
        endDate: detailDueDate || undefined,
      });
      detailStartDate = nextRange.startDate ?? "";
      detailDueDate = nextRange.endDate ?? "";
      datePickerTarget = null;
      return;
    }
    if (datePickerTarget === "due") {
      const nextRange = selectDateRangeEnd({
        selectedDate: dateStr,
        startDate: detailStartDate || undefined,
        endDate: detailDueDate || undefined,
      });
      detailStartDate = nextRange.startDate ?? "";
      detailDueDate = nextRange.endDate ?? "";
      datePickerTarget = null;
      return;
    }
    setDetailDateValue(datePickerTarget, dateStr);
    datePickerTarget = null;
  }

  function clearDetailDate(target: DetailDateTarget): void {
    setDetailDateValue(target, "");
    if (datePickerTarget === target) datePickerTarget = null;
  }

  function selectCustomFieldDate(dateStr: string): void {
    if (!customFieldDatePickerTarget) return;
    customFieldDateDrafts = {
      ...customFieldDateDrafts,
      [customFieldDatePickerTarget]: dateStr,
    };
    customFieldDatePickerTarget = null;
  }

  function clearCustomFieldDate(fieldId: string): void {
    customFieldDateDrafts = {
      ...customFieldDateDrafts,
      [fieldId]: "",
    };
    if (customFieldDatePickerTarget === fieldId) customFieldDatePickerTarget = null;
  }

  function toggleCustomFieldMultiOption(field: ProjectCustomField, option: ProjectCustomFieldOption): void {
    const current = customFieldMultiDrafts[field.id] ?? [];
    customFieldMultiDrafts = {
      ...customFieldMultiDrafts,
      [field.id]: current.includes(option.id)
        ? current.filter((optionId) => optionId !== option.id)
        : [...current, option.id],
    };
  }

  async function saveTaskCustomField(task: ProjectTask, field: ProjectCustomField): Promise<void> {
    detailError = null;
    const requestKey = `${task.id}:${field.id}`;
    const requestGeneration = (customFieldSaveGenerations.get(requestKey) ?? 0) + 1;
    customFieldSaveGenerations.set(requestKey, requestGeneration);
    const submittedDrafts = currentCustomFieldDrafts();
    const submittedRawDraft = projectTaskDetailCustomFieldRawDraft({
      field,
      drafts: submittedDrafts,
    });
    let saveRequest: Promise<void> | null = null;
    try {
      const draft = projectTaskDetailCustomFieldSaveDraft({
        field,
        drafts: submittedDrafts,
      });
      if (!draft.ok) {
        detailError = draft.reason === "invalid-number"
          ? t("projects.customFields.invalidNumber")
          : t("projects.detail.invalidDate");
        return;
      }
      const previousSave = customFieldSaveQueues.get(requestKey) ?? Promise.resolve();
      saveRequest = previousSave
        .catch(() => undefined)
        .then(() => projects.saveCustomFieldValue({
          taskId: task.id,
          fieldId: field.id,
          ...draft.value,
        }));
      customFieldSaveQueues.set(requestKey, saveRequest);
      await saveRequest;
      if (selectedTask?.id !== task.id) return;
      const mergedDrafts = projectTaskDetailMergeSavedCustomFieldDraft({
        field,
        drafts: currentCustomFieldDrafts(),
        saved: draft.value,
        submittedRawDraft,
        requestGeneration,
        latestRequestGeneration: customFieldSaveGenerations.get(requestKey) ?? 0,
      });
      customFieldTextDrafts = mergedDrafts.textDrafts;
      customFieldNumberDrafts = mergedDrafts.numberDrafts;
      customFieldDateDrafts = mergedDrafts.dateDrafts;
      customFieldCheckboxDrafts = mergedDrafts.checkboxDrafts;
      customFieldSelectDrafts = mergedDrafts.selectDrafts;
      customFieldMultiDrafts = mergedDrafts.multiDrafts;
    } catch (error) {
      if (
        customFieldSaveGenerations.get(requestKey) !== requestGeneration
        || selectedTask?.id !== task.id
      ) return;
      detailError = t(
        "projects.customFields.valueSaveFailed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (saveRequest && customFieldSaveQueues.get(requestKey) === saveRequest) {
        customFieldSaveQueues.delete(requestKey);
      }
    }
  }

  async function submitSubtask(parent: ProjectTask): Promise<void> {
    const statusId = projects.defaultStatus(parent.projectId)?.id ?? parent.statusId;
    await projects.addTask(parent.projectId, subtaskDraft, parent.sectionId, statusId, parent.id);
    subtaskDraft = "";
  }

  async function submitChecklistItem(task: ProjectTask): Promise<void> {
    await projects.addChecklistItem(task.id, checklistDraft);
    checklistDraft = "";
  }

  async function saveChecklistItem(item: ProjectChecklistItem): Promise<void> {
    const title = (checklistTitleDrafts[item.id] ?? item.title).trim();
    if (!title) {
      detailError = t("projects.detail.checklistItemTitleRequired");
      return;
    }
    detailError = null;
    await projects.updateChecklistItem(item, { title });
    checklistTitleDrafts = { ...checklistTitleDrafts, [item.id]: title };
  }

  async function attachExistingTag(task: ProjectTask, tag: ProjectTag): Promise<void> {
    detailError = null;
    try {
      await projects.linkTaskTag(task.id, tag.id);
      tagDraft = "";
    } catch (error) {
      detailError = t(
        "projects.detail.tagSaveFailed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function submitTaskTag(task: ProjectTask): Promise<void> {
    const name = tagDraft.trim();
    if (!name) {
      detailError = t("projects.detail.tagNameRequired");
      return;
    }
    detailError = null;
    try {
      await projects.addAndLinkTaskTag(task, name);
      tagDraft = "";
    } catch (error) {
      detailError = t(
        "projects.detail.tagSaveFailed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function detachTaskTag(task: ProjectTask, tag: ProjectTag): Promise<void> {
    detailError = null;
    try {
      await projects.unlinkTaskTag(task.id, tag.id);
    } catch (error) {
      detailError = t(
        "projects.detail.tagSaveFailed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function moveChecklistItemInDetail(item: ProjectChecklistItem, direction: -1 | 1): Promise<void> {
    detailError = null;
    await projects.moveChecklistItem(item, direction);
  }

  async function moveSubtaskInDetail(task: ProjectTask, direction: -1 | 1): Promise<void> {
    detailError = null;
    await projects.moveSubtask(task, direction);
  }

  async function promoteSubtaskFromDetail(task: ProjectTask): Promise<void> {
    detailError = null;
    try {
      await projects.promoteSubtask(task);
    } catch (error) {
      detailError = t(
        "projects.detail.promoteFailed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function demoteTaskFromDetail(task: ProjectTask, parentTask: ProjectTask): Promise<void> {
    detailError = null;
    try {
      await projects.demoteTaskToSubtask(task, parentTask);
      parentTaskSearch = "";
    } catch (error) {
      detailError = t(
        "projects.detail.demoteFailed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function addBlockingDependency(blockingTask: ProjectTask, blockedTask: ProjectTask): Promise<void> {
    detailError = null;
    try {
      await projects.addTaskDependency(blockingTask.id, blockedTask.id);
      dependencySearch = "";
    } catch (error) {
      detailError = t(
        "projects.detail.dependencySaveFailed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function removeDependency(dependencyId: string): Promise<void> {
    detailError = null;
    try {
      await projects.removeTaskDependency(dependencyId);
    } catch (error) {
      detailError = t(
        "projects.detail.dependencySaveFailed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function linkExistingEvent(task: ProjectTask, event: ProjectLinkableEvent): Promise<boolean> {
    detailError = null;
    try {
      await projects.linkTaskEvent(task.id, event.id, "scheduled");
      return true;
    } catch (error) {
      detailError = t(
        "projects.detail.eventLinkSaveFailed",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  async function unlinkExistingEvent(task: ProjectTask, event: ProjectLinkableEvent): Promise<void> {
    detailError = null;
    try {
      await projects.unlinkTaskEvent(task.id, event.id);
    } catch (error) {
      detailError = t(
        "projects.detail.eventLinkSaveFailed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function archiveTaskFromDetail(task: ProjectTask): Promise<void> {
    detailError = null;
    detailSaving = true;
    try {
      await projects.archiveTasks([task]);
    } catch (error) {
      detailError = t("projects.detail.archiveFailed", error instanceof Error ? error.message : String(error));
    } finally {
      detailSaving = false;
    }
  }

  async function restoreTaskFromDetail(task: ProjectTask): Promise<void> {
    detailError = null;
    detailSaving = true;
    onShowArchivedTasks();
    try {
      await projects.restoreTasks([task]);
    } catch (error) {
      detailError = t("projects.detail.restoreFailed", error instanceof Error ? error.message : String(error));
    } finally {
      detailSaving = false;
    }
  }

  async function saveTaskDetail(): Promise<void> {
    if (!selectedTask) return;
    const patch = projectTaskDetailDraftPatch(currentDetailDraft());
    if (!patch.ok) {
      if (patch.reason === "title-required") {
        detailError = t("projects.detail.titleRequired");
      } else if (patch.reason === "invalid-estimate") {
        detailError = t("projects.detail.invalidEstimate");
      } else if (patch.reason === "invalid-date") {
        detailError = t("projects.detail.invalidDate");
      }
      return;
    }
    detailSaving = true;
    detailError = null;
    try {
      await projects.updateTask(selectedTask, patch.patch);
      detailChangeReason = "";
      detailDraftUpdatedAt = selectedTask.updatedAt;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      detailError = message === t("projects.detail.invalidEstimate")
        || message === t("projects.detail.invalidDate")
        ? message
        : t("projects.detail.saveFailed", message);
    } finally {
      detailSaving = false;
    }
  }
</script>

<svelte:window onkeydown={handleTaskDetailKeydown} />

{#if selectedTask}
    {@const selectedTaskHistory = projects.taskChangeEventsForTask(selectedTask.id).slice(0, 8)}
    {@const selectedTaskChecklist = projects.checklistItemsForTask(selectedTask.id)}
    {@const selectedTaskTags = tagsForTask(selectedTask)}
    {@const selectedTaskTagCandidates = tagCandidateTags(selectedTask)}
    {@const selectedTaskSubtasks = subtasksForTask(selectedTask)}
    {@const selectedTaskBlockedBy = blockedByDependencies(selectedTask)}
    {@const selectedTaskBlocks = blocksDependencies(selectedTask)}
    {@const selectedTaskParent = selectedTask.parentTaskId ? taskById(selectedTask.parentTaskId) : undefined}
    {@const selectedTaskDependencyCandidates = dependencyCandidateTasks(selectedTask)}
    {@const selectedTaskEventIds = projects.eventLinksForTask(selectedTask.id).map((link) => link.eventId)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-70 flex items-center justify-center bg-black/35 p-3"
      style={androidSystemBackAvailable
        ? "padding: calc(var(--safe-area-top) + 0.75rem) calc(var(--safe-area-right) + 0.75rem) calc(var(--safe-area-bottom) + 0.75rem) calc(var(--safe-area-left) + 0.75rem)"
        : undefined}
      onclick={requestTaskDetailClose}
    >
    <div
      bind:this={detailDialog}
      class={cn(
        "task-detail-dialog",
        "flex max-h-full max-w-full min-h-0 flex-col overflow-hidden border border-border bg-card text-card-foreground shadow-2xl",
        layout === "fullscreen" && androidSystemBackAvailable && "h-full w-full rounded-md",
        layout === "fullscreen" && !androidSystemBackAvailable && "h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] rounded-md",
        layout === "sheet" && "h-[min(88dvh,48rem)] w-[calc(100vw-1rem)] max-w-6xl rounded-xl",
        layout === "modal" && "h-[min(92dvh,62rem)] w-[min(78rem,calc(100vw-2rem))] rounded-xl",
      )}
      data-floating-root
      role="dialog"
      data-mobile={androidSystemBackAvailable || undefined}
      aria-modal="true"
      aria-label={t("projects.detail.title")}
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
    >
      <ProjectTaskDetailHeader
        task={selectedTask}
        projectName={projects.projectById(selectedTask.projectId)?.name ?? ""}
        title={detailTitle}
        onTitleChange={(value) => { detailTitle = value; }}
        onClose={requestTaskDetailClose}
      />

      <form class="flex min-h-0 flex-1 flex-col" onsubmit={(event) => { event.preventDefault(); void saveTaskDetail(); }}>
        <div class="relative min-h-0 flex-1">
          <div bind:this={detailScrollContainer} class="task-detail-scroll hide-scrollbar h-full overflow-y-auto overscroll-contain">
            {#key selectedTask.id}
              <div class="task-detail-workspace">
                <div class="task-detail-content">
                  <ProjectTaskDetailDescriptionSection
                    value={detailDescription}
                    onChange={(value) => { detailDescription = value; }}
                  />

                  <ProjectTaskDetailChecklistSection
                    task={selectedTask}
                    items={selectedTaskChecklist}
                    titleDrafts={checklistTitleDrafts}
                    draft={checklistDraft}
                    onTitleDraftChange={(itemId, value) => {
                      checklistTitleDrafts = {
                        ...checklistTitleDrafts,
                        [itemId]: value,
                      };
                    }}
                    onDraftChange={(value) => { checklistDraft = value; }}
                    onToggleCompleted={(item, completed) => projects.setChecklistItemCompleted(item, completed)}
                    onSaveItem={saveChecklistItem}
                    onMoveItem={moveChecklistItemInDetail}
                    onDeleteItem={(item) => projects.removeChecklistItem(item.id)}
                    onSubmitItem={submitChecklistItem}
                  />

                  <ProjectTaskDetailSubtasksSection
                    task={selectedTask}
                    subtasks={selectedTaskSubtasks}
                    theme={theme.current}
                    draft={subtaskDraft}
                    {statusForTask}
                    onDraftChange={(value) => { subtaskDraft = value; }}
                    onSubmitSubtask={submitSubtask}
                    onToggleComplete={(subtask) => projects.toggleTaskDone(subtask)}
                    onOpenTask={openTaskDetail}
                    onPromoteSubtask={promoteSubtaskFromDetail}
                    onMoveSubtask={moveSubtaskInDetail}
                  />

                  <ProjectTaskDetailDependenciesSection
                    task={selectedTask}
                    blockedByDependencies={selectedTaskBlockedBy}
                    blocksDependencies={selectedTaskBlocks}
                    dependencyCandidates={selectedTaskDependencyCandidates}
                    dependencySearch={dependencySearch}
                    {taskById}
                    onDependencySearchChange={(value) => { dependencySearch = value; }}
                    onAddBlockingDependency={addBlockingDependency}
                    onRemoveDependency={removeDependency}
                  />

                  <ProjectTaskDetailScheduledBlocksController
                    task={selectedTask}
                    taskEventIds={selectedTaskEventIds}
                    {allProjectEvents}
                    {todayDate}
                    searchLinkableEvents={projects.searchLinkableEvents}
                    onLinkEvent={linkExistingEvent}
                    onUnlinkEvent={unlinkExistingEvent}
                  />

                  <ProjectTaskDetailHistorySection events={selectedTaskHistory} />

                </div>
                <aside class="task-detail-properties" aria-label={t("projects.detail.properties")}>
                  <h2 class="text-[0.866667rem] font-semibold">{t("projects.detail.properties")}</h2>
                  <ProjectTaskDetailPropertiesSection
                    {statuses}
                    {sections}
                    {priorities}
                    theme={theme.current}
                    statusId={detailStatusId}
                    sectionId={detailSectionId}
                    priority={detailPriority}
                    taskType={detailTaskType}
                    onStatusChange={(value) => { detailStatusId = value; }}
                    onSectionChange={(value) => { detailSectionId = value; }}
                    onPriorityChange={(value) => { detailPriority = value; }}
                    onTaskTypeChange={(value) => { detailTaskType = value; }}
                  />

                  <ProjectTaskDetailPlanningSection
                    milestone={detailMilestone}
                    onMilestoneChange={(value) => { detailMilestone = value; }}
                    estimateMinutes={detailEstimateMinutes}
                    startDate={detailStartDate}
                    dueDate={detailDueDate}
                    targetEndDate={detailTargetEndDate}
                    blockerReason={detailBlockerReason}
                    changeReason={detailChangeReason}
                    {todayDate}
                    startPickerOpen={datePickerTarget === "start"}
                    duePickerOpen={datePickerTarget === "due"}
                    targetPickerOpen={datePickerTarget === "target"}
                    onEstimateMinutesChange={(value) => { detailEstimateMinutes = value; }}
                    onBlockerReasonChange={(value) => { detailBlockerReason = value; }}
                    onChangeReasonChange={(value) => { detailChangeReason = value; }}
                    onToggleStartPicker={() => toggleDetailDatePicker("start")}
                    onToggleDuePicker={() => toggleDetailDatePicker("due")}
                    onToggleTargetPicker={() => toggleDetailDatePicker("target")}
                    onClearStartDate={() => clearDetailDate("start")}
                    onClearDueDate={() => clearDetailDate("due")}
                    onClearTargetEndDate={() => clearDetailDate("target")}
                    onSelectDate={selectDetailDate}
                    onCancelDatePicker={() => { datePickerTarget = null; }}
                  />

                  <ProjectTaskDetailParentSection
                    task={selectedTask}
                    parentTask={selectedTaskParent}
                    parentCandidates={parentTaskCandidateTasks(selectedTask)}
                    parentSearch={parentTaskSearch}
                    hasSubtasks={taskHasAnySubtasks(selectedTask)}
                    onParentSearchChange={(value) => { parentTaskSearch = value; }}
                    onPromoteSubtask={promoteSubtaskFromDetail}
                    onDemoteTask={demoteTaskFromDetail}
                  />

                  <ProjectTaskDetailTagsSection
                    task={selectedTask}
                    tags={selectedTaskTags}
                    candidates={selectedTaskTagCandidates}
                    draft={tagDraft}
                    canCreate={canCreateTag(selectedTask)}
                    theme={theme.current}
                    onDraftChange={(value) => { tagDraft = value; }}
                    onAttachTag={attachExistingTag}
                    onSubmitTag={submitTaskTag}
                    onDetachTag={detachTaskTag}
                  />

                  {#if projectCustomFields.length > 0}
                    <ProjectTaskDetailCustomFieldsSection
                      task={selectedTask}
                      fields={projectCustomFields}
                      textDrafts={customFieldTextDrafts}
                      numberDrafts={customFieldNumberDrafts}
                      dateDrafts={customFieldDateDrafts}
                      checkboxDrafts={customFieldCheckboxDrafts}
                      selectDrafts={customFieldSelectDrafts}
                      multiDrafts={customFieldMultiDrafts}
                      datePickerTarget={customFieldDatePickerTarget}
                      {todayDate}
                      {customFieldOptions}
                      {customFieldValueDirty}
                      onTextDraftChange={(fieldId, value) => {
                        customFieldTextDrafts = {
                          ...customFieldTextDrafts,
                          [fieldId]: value,
                        };
                      }}
                      onNumberDraftChange={(fieldId, value) => {
                        customFieldNumberDrafts = {
                          ...customFieldNumberDrafts,
                          [fieldId]: value,
                        };
                      }}
                      onCheckboxDraftChange={(fieldId, value) => {
                        customFieldCheckboxDrafts = {
                          ...customFieldCheckboxDrafts,
                          [fieldId]: value,
                        };
                      }}
                      onSelectDraftChange={(fieldId, value) => {
                        customFieldSelectDrafts = {
                          ...customFieldSelectDrafts,
                          [fieldId]: value,
                        };
                      }}
                      onToggleMultiOption={toggleCustomFieldMultiOption}
                      onSaveField={saveTaskCustomField}
                      onToggleDatePicker={(fieldId) => {
                        customFieldDatePickerTarget = customFieldDatePickerTarget === fieldId ? null : fieldId;
                        datePickerTarget = null;
                      }}
                      onClearDate={clearCustomFieldDate}
                      onSelectDate={selectCustomFieldDate}
                      onCancelDatePicker={() => { customFieldDatePickerTarget = null; }}
                    />
                  {/if}
                </aside>
              </div>
            {/key}
          </div>
          <CalendarScrollbar
            scrollContainer={detailScrollContainer}
            stickyTop={8}
            stickyBottom={8}
            wheelPassthrough
          />
        </div>

        {#if detailError}
          <div role="alert" class="shrink-0 border-t border-destructive/20 bg-destructive/10 px-5 py-2 text-[0.8rem] text-destructive">
            {detailError}
          </div>
        {/if}

        <ProjectTaskDetailFooter
          task={selectedTask}
          saving={detailSaving}
          dirty={detailDirty}
          onArchive={archiveTaskFromDetail}
          onRestore={restoreTaskFromDetail}
        />
      </form>
    </div>
    </div>
    {#if discardCloseConfirmOpen}
      <ConfirmDialog
        title={t("calendar.view.discardUnsavedTitle")}
        message={t("calendar.view.changesLost")}
        confirmLabel={t("calendar.view.discard")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirmDiscardTaskDetail}
        onCancel={cancelDiscardTaskDetail}
      />
    {/if}
{/if}

<style>
  .task-detail-scroll {
    container: task-detail / inline-size;
  }

  .task-detail-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 0.65fr);
    min-height: 100%;
    align-items: start;
  }

  .task-detail-content {
    display: grid;
    min-width: 0;
    align-content: start;
    gap: 1.75rem;
    padding: 1.5rem 2rem 2rem;
  }

  .task-detail-properties {
    display: grid;
    min-width: 0;
    align-content: start;
    gap: 1rem;
    align-self: stretch;
    padding: 1.5rem;
    border-left: 1px solid var(--border);
    background: color-mix(in oklab, var(--muted) 20%, var(--card));
  }

  .task-detail-dialog :global(.task-property-row) {
    display: grid;
    grid-template-columns: minmax(6.5rem, 0.85fr) minmax(0, 1.15fr);
    gap: 0.75rem;
    align-items: center;
    min-height: 2rem;
    font-size: calc(0.8rem * var(--type-scale, 1));
    color: var(--muted-foreground);
  }

  .task-detail-dialog :global(:is(input, textarea, button, select):focus) {
    outline: none !important;
    box-shadow: none !important;
  }

  .task-detail-dialog :global(:is(input, textarea):focus),
  .task-detail-dialog :global(button:focus-visible) {
    background-color: var(--accent);
  }

  .task-detail-dialog :global(button:focus-visible) {
    color: var(--accent-foreground);
  }

  .task-detail-dialog :global(label:has(> input[type="checkbox"]:focus-visible)) {
    background-color: var(--accent);
    border-radius: 0.375rem;
  }

  .task-detail-content :global(.task-detail-section + .task-detail-section) {
    border-top: 1px solid color-mix(in oklab, var(--border) 65%, transparent);
    padding-top: 1.25rem;
  }

  @container task-detail (max-width: 54rem) {
    .task-detail-workspace {
      grid-template-columns: minmax(0, 1fr);
    }
    .task-detail-content {
      display: contents;
    }
    .task-detail-workspace {
      gap: 1.5rem;
      padding: 1.25rem;
    }
    .task-detail-properties {
      grid-row: 2;
      border-left: 0;
      border-bottom: 1px solid var(--border);
    }
  }

  .task-detail-dialog[data-mobile="true"] :global(button),
  .task-detail-dialog[data-mobile="true"] :global(input:not([type="checkbox"])),
  .task-detail-dialog[data-mobile="true"] :global(select),
  .task-detail-dialog[data-mobile="true"] :global(textarea) {
    min-height: 3rem;
  }
</style>
