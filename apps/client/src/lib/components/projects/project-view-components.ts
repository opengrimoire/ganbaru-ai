/** Constructors for the Project views prepared by a platform shell. */
export interface ProjectViewComponents {
  list: typeof import("./ProjectListView.svelte").default;
  kanban: typeof import("./ProjectKanbanView.svelte").default;
  calendar: typeof import("$lib/components/calendar/CalendarView.svelte").default;
  gantt: typeof import("./ProjectGanttView.svelte").default;
  dashboard: typeof import("./ProjectDashboardView.svelte").default;
}
