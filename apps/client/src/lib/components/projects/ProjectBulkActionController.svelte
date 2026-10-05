<script lang="ts">
  import { Temporal } from "@js-temporal/polyfill";
  import { projectDefaultScheduleStart } from "$lib/projects/scheduling/schedule";
  import { getProjectSchedulingController } from "$lib/projects/scheduling/controller";
  import { localTimezone } from "$lib/stores/calendar/event-payloads";
  import { requireActiveVaultIdentity } from "$lib/vault/active-vault";
  import { PROJECT_MAX_DURATION_MINUTES, projectEffectiveDurationMinutes } from "$lib/projects/settings/duration";
  import type {
    Project,
    ProjectPriority,
    ProjectPriorityConfig,
    ProjectStatus,
    ProjectTask,
  } from "$lib/projects/types";
  import { getLocalization } from "$lib/i18n/translator.svelte";
  import { getCalendar } from "$lib/stores/calendar.svelte";
  import { getPreferences } from "$lib/stores/preferences.svelte";
  import { getProjects } from "$lib/stores/projects.svelte";
  import ProjectBulkActionBar from "./ProjectBulkActionBar.svelte";

  let {
    selectedProject,
    priorities,
    selectedTasks,
    selectableTasks,
    selectedActiveTaskCount,
    selectedArchivedTaskCount,
    terminalStatus,
    firstOpenStatus,
    selectedTaskIds = $bindable<string[]>(),
    showArchivedTasks = $bindable<boolean>(),
  }: {
    selectedProject: Project;
    priorities: ProjectPriorityConfig[];
    selectedTasks: ProjectTask[];
    selectableTasks: ProjectTask[];
    selectedActiveTaskCount: number;
    selectedArchivedTaskCount: number;
    terminalStatus: ProjectStatus | undefined;
    firstOpenStatus: ProjectStatus | undefined;
    selectedTaskIds: string[];
    showArchivedTasks: boolean;
  } = $props();

  const projects = getProjects();
  const calendar = getCalendar();
  const preferences = getPreferences();
  const scheduling = getProjectSchedulingController();
  const { t } = getLocalization();

  let bulkTaskActionPending = $state(false);
  let bulkTaskError = $state<string | null>(null);
  let bulkScheduleOpen = $state(false);
  let bulkScheduleDate = $state("");
  let bulkScheduleStartTime = $state("");
  let bulkScheduleDurationMinutes = $state(60);
  let scheduleRecovery = $state(scheduling.recoverable);

  const selectedSchedulableTasks = $derived(selectedTasks.filter((task) => !task.archivedAt));

  function selectFilteredTasks(): void {
    const nextIds = new Set(selectedTaskIds);
    for (const task of selectableTasks) {
      nextIds.add(task.id);
    }
    selectedTaskIds = Array.from(nextIds);
  }

  function clearTaskSelection(): void {
    selectedTaskIds = [];
    bulkTaskError = null;
    bulkScheduleOpen = false;
  }

  async function runBulkTaskAction(action: () => Promise<void>): Promise<void> {
    if (selectedTasks.length === 0) return;
    bulkTaskActionPending = true;
    bulkTaskError = null;
    try {
      await action();
      selectedTaskIds = [];
    } catch (error) {
      bulkTaskError = t(
        "projects.bulk.actionFailed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      bulkTaskActionPending = false;
    }
  }

  async function bulkSetSelectedStatus(status: ProjectStatus | undefined): Promise<void> {
    if (!status) return;
    await runBulkTaskAction(() => projects.setTasksStatus(selectedTasks, status.id));
  }

  async function bulkSetSelectedPriority(priority: ProjectPriority): Promise<void> {
    await runBulkTaskAction(() => projects.setTasksPriority(selectedTasks, priority));
  }

  async function bulkArchiveSelectedTasks(): Promise<void> {
    await runBulkTaskAction(() => projects.archiveTasks(selectedTasks));
  }

  async function bulkRestoreSelectedTasks(): Promise<void> {
    showArchivedTasks = true;
    await runBulkTaskAction(() => projects.restoreTasks(selectedTasks));
  }

  function openBulkScheduleForm(): void {
    const start = projectDefaultScheduleStart();
    bulkScheduleOpen = true;
    bulkScheduleDate = start.date;
    bulkScheduleStartTime = start.time;
    bulkScheduleDurationMinutes = projectEffectiveDurationMinutes(selectedProject.defaultEventDurationMinutes);
    bulkTaskError = null;
  }

  function closeBulkScheduleForm(): void {
    bulkScheduleOpen = false;
    bulkTaskError = null;
  }

  /** Reconcile both projections before acknowledging an accepted scheduling receipt. */
  async function refreshScheduledTasks(vaultId: string, commandId: string): Promise<void> {
    if (requireActiveVaultIdentity() !== vaultId) throw new Error("Scheduling vault changed before refresh");
    calendar.acceptNativeEdit();
    await projects.load();
    if (projects.loadError) throw new Error(projects.loadError);
    if (requireActiveVaultIdentity() !== vaultId) throw new Error("Scheduling vault changed during refresh");
    await calendar.refreshCurrentWindow();
    if (requireActiveVaultIdentity() !== vaultId) throw new Error("Scheduling vault changed during refresh");
    scheduling.acknowledge(commandId);
    scheduleRecovery = false;
    clearTaskSelection();
    projects.activeView = "calendar";
  }

  /** Resolve the retained batch even after its original selection or view disappeared. */
  async function retryScheduledTasks(): Promise<void> {
    if (bulkTaskActionPending) return;
    bulkTaskActionPending = true;
    bulkTaskError = null;
    try {
      const vaultId = requireActiveVaultIdentity();
      const receipt = await scheduling.retry();
      await refreshScheduledTasks(vaultId, receipt.commandId);
    } catch (error) {
      bulkTaskError = t("projects.bulk.actionFailed", error instanceof Error ? error.message : String(error));
    } finally {
      scheduleRecovery = scheduling.recoverable;
      bulkTaskActionPending = false;
    }
  }

  /** Submit semantic selection and authored timing through the shared native owner. */
  async function bulkScheduleSelectedTasks(): Promise<void> {
    const duration = Math.round(Number(bulkScheduleDurationMinutes));
    if (selectedSchedulableTasks.length === 0 || !Number.isSafeInteger(duration) || duration <= 0
      || duration > PROJECT_MAX_DURATION_MINUTES || !bulkScheduleDate || !bulkScheduleStartTime) {
      bulkTaskError = t("projects.schedule.invalid");
      return;
    }
    if (bulkTaskActionPending || scheduling.recoverable) return;
    let start: Temporal.PlainDateTime;
    try {
      start = Temporal.PlainDateTime.from(`${bulkScheduleDate}T${bulkScheduleStartTime}`);
    } catch {
      bulkTaskError = t("projects.schedule.invalid");
      return;
    }

    bulkTaskActionPending = true;
    bulkTaskError = null;
    try {
      const vaultId = requireActiveVaultIdentity();
      const timezone = localTimezone();
      const receipt = await scheduling.schedule({
        kind: "schedule_tasks", projectId: selectedProject.id,
        tasks: selectedSchedulableTasks.map((task) => {
          if (task.revision === undefined) throw new Error("Refresh the task selection before scheduling");
          return { id: task.id, revision: task.revision };
        }),
        startTime: start.toString(), timezone, durationMinutes: duration,
        globalIdleTimeoutMinutes: preferences.focusIdlePauseOnEventCreate ? preferences.focusIdleThresholdMinutes : null,
      }, { windowStartDate: bulkScheduleDate, windowEndDate: bulkScheduleDate, renderZone: timezone, includeTotalEventCount: false });
      await refreshScheduledTasks(vaultId, receipt.commandId);
    } catch (error) {
      bulkTaskError = t("projects.bulk.actionFailed", error instanceof Error ? error.message : String(error));
    } finally {
      bulkTaskActionPending = false;
      scheduleRecovery = scheduling.recoverable;
    }
  }
</script>

{#if scheduleRecovery}
  <div class="mx-3 my-2 flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1">
    <span class="text-sm">{t("projects.bulk.schedule")}</span>
    <button type="button" class="min-h-8 rounded px-2 text-primary hover:bg-accent" disabled={bulkTaskActionPending} onclick={() => { void retryScheduledTasks(); }}>{t("common.retry")}</button>
    {#if bulkTaskError}<span class="text-sm text-destructive">{bulkTaskError}</span>{/if}
  </div>
{/if}

{#if selectedTasks.length > 0}
  <ProjectBulkActionBar
    selectedTaskCount={selectedTasks.length}
    selectableTaskCount={selectableTasks.length}
    {selectedActiveTaskCount}
    {selectedArchivedTaskCount}
    bulkSchedulableCount={selectedSchedulableTasks.length}
    bulkTaskActionPending={bulkTaskActionPending || scheduleRecovery}
    {bulkScheduleOpen}
    {bulkScheduleDate}
    {bulkScheduleStartTime}
    {bulkScheduleDurationMinutes}
    {bulkTaskError}
    {priorities}
    canMarkDone={Boolean(terminalStatus)}
    canReopen={Boolean(firstOpenStatus)}
    onSelectFiltered={selectFilteredTasks}
    onMarkDone={() => { void bulkSetSelectedStatus(terminalStatus); }}
    onReopen={() => { void bulkSetSelectedStatus(firstOpenStatus); }}
    onToggleBulkSchedule={() => {
      if (bulkScheduleOpen) {
        closeBulkScheduleForm();
      } else {
        openBulkScheduleForm();
      }
    }}
    onSetPriority={(priority) => { void bulkSetSelectedPriority(priority); }}
    onArchive={() => { void bulkArchiveSelectedTasks(); }}
    onRestore={() => { void bulkRestoreSelectedTasks(); }}
    onClear={clearTaskSelection}
    onBulkScheduleDateChange={(value) => {
      bulkScheduleDate = value;
    }}
    onBulkScheduleStartTimeChange={(value) => {
      bulkScheduleStartTime = value;
    }}
    onBulkScheduleDurationMinutesChange={(value) => {
      if (Number.isFinite(value)) bulkScheduleDurationMinutes = value;
    }}
    onBulkScheduleSubmit={() => { void bulkScheduleSelectedTasks(); }}
    onCloseBulkSchedule={closeBulkScheduleForm}
  />
{/if}
