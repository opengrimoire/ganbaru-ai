import { getContext, setContext } from "svelte";
import type { ProjectTask } from "$lib/projects/types";
import type { ProjectTaskListResizableColumn } from "$lib/projects/project-list-view";
import type { ProjectTaskQueryController } from "./project-task-query-controller.svelte";

export interface ProjectListTableContext {
  query: ProjectTaskQueryController;
  cellClass: (column: ProjectTaskListResizableColumn | "selection" | "open") => string;
  cellStyle: (column: ProjectTaskListResizableColumn | "selection" | "open") => string;
  rowStyle: (task: ProjectTask, selected: boolean) => string;
}
const PROJECT_LIST_TABLE_CONTEXT = Symbol("project-list-table");

/** Share table presentation without coupling task editing or section composition to it. */
export function setProjectListTableContext(context: ProjectListTableContext): void {
  setContext(PROJECT_LIST_TABLE_CONTEXT, context);
}

/** Resolve presentation only when a component belongs to a configured Projects table. */
export function getProjectListTableContext(): ProjectListTableContext | undefined {
  return getContext<ProjectListTableContext | undefined>(PROJECT_LIST_TABLE_CONTEXT);
}
