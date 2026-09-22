<script lang="ts">
  import CustomSelect from "$lib/components/settings/CustomSelect.svelte";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { projectStatusBadgeDotStyle, projectTaskTypeLabel } from "$lib/projects/project-display";
  import { PROJECT_TASK_TYPES } from "$lib/projects/types";
  import type {
    ProjectPriority,
    ProjectPriorityConfig,
    ProjectSection,
    ProjectStatus,
    ProjectTaskType,
  } from "$lib/projects/types";
  import type { Theme } from "$lib/stores/themes";
  import PriorityFlagIcon from "./PriorityFlagIcon.svelte";

  let {
    statuses,
    sections,
    priorities,
    theme,
    statusId,
    sectionId,
    priority,
    taskType,
    onStatusChange,
    onSectionChange,
    onPriorityChange,
    onTaskTypeChange,
  }: {
    statuses: ProjectStatus[];
    sections: ProjectSection[];
    priorities: ProjectPriorityConfig[];
    theme: Theme;
    statusId: string;
    sectionId: string;
    priority: ProjectPriority;
    taskType: ProjectTaskType;
    onStatusChange: (statusId: string) => void;
    onSectionChange: (sectionId: string) => void;
    onPriorityChange: (priority: ProjectPriority) => void;
    onTaskTypeChange: (taskType: ProjectTaskType) => void;
  } = $props();

  const { t } = getLocalization();


</script>

<div class="grid gap-1">
  <div class="task-property-row">
    <span>{t("projects.detail.status")}</span>
    <CustomSelect inline appearance="quiet" contentAlign="start" class="w-full" value={statusId}
      ariaLabel={t("projects.detail.status")}
      options={statuses.map((status) => ({ value: status.id, label: status.name }))}
      onChange={onStatusChange}>
      {#snippet leading(value)}
        {@const status = statuses.find((entry) => entry.id === value)}
        <span class="size-2 shrink-0 rounded-full" style={projectStatusBadgeDotStyle(status, theme)}></span>
      {/snippet}
    </CustomSelect>
  </div>
  <div class="task-property-row">
    <span>{t("projects.detail.priority")}</span>
    <CustomSelect inline appearance="quiet" contentAlign="start" class="w-full" value={priority}
      ariaLabel={t("projects.detail.priority")}
      options={priorities.map((entry) => ({ value: entry.id, label: entry.name }))}
      onChange={(value) => {
        const option = priorities.find((entry) => entry.id === value);
        if (option) onPriorityChange(option.id);
      }}>
      {#snippet leading(value)}
        {@const option = priorities.find((entry) => entry.id === value)}
        {#if option}<PriorityFlagIcon color={option.color} {theme} size={14} />{/if}
      {/snippet}
    </CustomSelect>
  </div>
  <div class="task-property-row">
    <span>{t("projects.detail.section")}</span>
    <CustomSelect inline appearance="quiet" contentAlign="start" class="w-full" value={sectionId}
      ariaLabel={t("projects.detail.section")}
      options={sections.map((section) => ({ value: section.id, label: section.name }))}
      onChange={onSectionChange} />
  </div>
  <div class="task-property-row">
    <span>{t("projects.detail.type")}</span>
    <CustomSelect inline appearance="quiet" contentAlign="start" class="w-full" value={taskType}
      ariaLabel={t("projects.detail.type")}
      options={PROJECT_TASK_TYPES.map((value) => ({ value, label: projectTaskTypeLabel(value, t) }))}
      onChange={(value) => {
        const option = PROJECT_TASK_TYPES.find((entry) => entry === value);
        if (option) onTaskTypeChange(option);
      }} />
  </div>
</div>
