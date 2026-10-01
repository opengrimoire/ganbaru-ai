use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Default, Serialize)]
pub struct ProjectsMutationRows {
    pub(in crate::projects) groups: Vec<ProjectGroupRow>,
    pub(in crate::projects) projects: Vec<ProjectRow>,
    pub(in crate::projects) sections: Vec<ProjectSectionRow>,
    pub(in crate::projects) statuses: Vec<ProjectStatusRow>,
    pub(in crate::projects) priorities: Vec<ProjectPriorityRow>,
    pub(in crate::projects) tasks: Vec<ProjectTaskRow>,
    pub(in crate::projects) checklist_items: Vec<ProjectChecklistItemRow>,
    pub(in crate::projects) tags: Vec<ProjectTagRow>,
    pub(in crate::projects) task_tag_links: Vec<ProjectTaskTagLinkRow>,
    pub(in crate::projects) custom_fields: Vec<ProjectCustomFieldRow>,
    pub(in crate::projects) custom_field_options: Vec<ProjectCustomFieldOptionRow>,
    pub(in crate::projects) custom_field_values: Vec<ProjectCustomFieldValueRow>,
    pub(in crate::projects) custom_field_option_values: Vec<ProjectCustomFieldOptionValueRow>,
    pub(in crate::projects) dependencies: Vec<ProjectTaskDependencyRow>,
    pub(in crate::projects) event_links: Vec<ProjectTaskEventLinkRow>,
    pub(in crate::projects) task_change_events: Vec<ProjectTaskChangeEventRow>,
    pub(in crate::projects) view_preferences: Vec<ProjectViewPreferenceRow>,
    pub(in crate::projects) custom_emojis: Vec<ProjectCustomEmojiRow>,
    pub(in crate::projects) removals: Vec<ProjectMutationRemoval>,
    pub(in crate::projects) calendar_event_project_assignments: Vec<CalendarEventProjectAssignment>,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectMutationRemoval {
    Group {
        id: String,
    },
    Project {
        id: String,
    },
    Status {
        id: String,
    },
    Priority {
        id: String,
    },
    ChecklistItem {
        id: String,
    },
    Tag {
        id: String,
    },
    TaskTagLink {
        task_id: String,
        tag_id: String,
    },
    CustomField {
        id: String,
    },
    CustomFieldOption {
        id: String,
    },
    CustomFieldValue {
        task_id: String,
        field_id: String,
    },
    Dependency {
        id: String,
    },
    EventLink {
        task_id: String,
        event_id: String,
    },
    ViewPreference {
        project_id: String,
        view_id: String,
        preference_key: String,
    },
    CustomEmoji {
        id: String,
    },
}

#[derive(Serialize)]
pub struct CalendarEventProjectAssignment {
    pub(in crate::projects) event_id: String,
    pub(in crate::projects) project_id: String,
}

#[derive(Serialize)]
pub struct ProjectGroupRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) icon: String,
    pub(in crate::projects) color: Option<i64>,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) collapsed: i64,
    pub(in crate::projects) hidden_at: Option<String>,
    pub(in crate::projects) archived_at: Option<String>,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectGroupRow {
    id,
    name,
    icon,
    color,
    sort_order,
    collapsed,
    hidden_at,
    archived_at,
    created_at,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) group_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) icon: String,
    pub(in crate::projects) color: Option<i64>,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) status: String,
    pub(in crate::projects) default_event_name: Option<String>,
    pub(in crate::projects) default_event_time_mode: String,
    pub(in crate::projects) default_event_duration_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_mode: String,
    pub(in crate::projects) default_pomodoro_preset_key: Option<String>,
    pub(in crate::projects) default_pomodoro_focus_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_short_break_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_long_break_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_long_break_after_focus_count: Option<i64>,
    pub(in crate::projects) default_idle_settings_source: String,
    pub(in crate::projects) default_idle_pause_enabled: i64,
    pub(in crate::projects) default_idle_threshold_minutes: i64,
    pub(in crate::projects) focus_playlist_id: Option<String>,
    pub(in crate::projects) break_playlist_id: Option<String>,
    pub(in crate::projects) work_environment_id: Option<String>,
    pub(in crate::projects) blocker_ruleset_id: Option<String>,
    pub(in crate::projects) notes_default_open_mode: Option<String>,
    pub(in crate::projects) notes_history_retention_days: Option<i64>,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectRow {
    id,
    group_id,
    name,
    icon,
    color,
    sort_order,
    status,
    default_event_name,
    default_event_time_mode,
    default_event_duration_minutes,
    default_pomodoro_mode,
    default_pomodoro_preset_key,
    default_pomodoro_focus_minutes,
    default_pomodoro_short_break_minutes,
    default_pomodoro_long_break_minutes,
    default_pomodoro_long_break_after_focus_count,
    default_idle_settings_source,
    default_idle_pause_enabled,
    default_idle_threshold_minutes,
    focus_playlist_id,
    break_playlist_id,
    work_environment_id,
    blocker_ruleset_id,
    notes_default_open_mode,
    notes_history_retention_days,
    created_at,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectSectionRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) collapsed: i64,
    pub(in crate::projects) hidden_at: Option<String>,
    pub(in crate::projects) archived_at: Option<String>,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectSectionRow {
    id,
    project_id,
    name,
    sort_order,
    collapsed,
    hidden_at,
    archived_at,
    created_at,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectStatusRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) category: String,
    pub(in crate::projects) color: i64,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) terminal: i64,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectStatusRow {
    id,
    project_id,
    name,
    category,
    color,
    sort_order,
    terminal,
    created_at,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectPriorityRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) color: i64,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectPriorityRow {
    id,
    project_id,
    name,
    color,
    sort_order,
    created_at,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectTaskRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) section_id: String,
    pub(in crate::projects) status_id: String,
    pub(in crate::projects) parent_task_id: Option<String>,
    pub(in crate::projects) title: String,
    pub(in crate::projects) description: String,
    pub(in crate::projects) priority: String,
    pub(in crate::projects) task_type: String,
    pub(in crate::projects) section_sort_order: f64,
    pub(in crate::projects) status_sort_order: f64,
    pub(in crate::projects) estimate_minutes: Option<i64>,
    pub(in crate::projects) due_date: Option<String>,
    pub(in crate::projects) due_time: Option<String>,
    pub(in crate::projects) start_date: Option<String>,
    pub(in crate::projects) start_time: Option<String>,
    pub(in crate::projects) target_end_date: Option<String>,
    pub(in crate::projects) completed_at: Option<String>,
    pub(in crate::projects) archived_at: Option<String>,
    pub(in crate::projects) blocker_reason: Option<String>,
    pub(in crate::projects) milestone: i64,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}

#[derive(Serialize)]
pub struct ProjectTaskSummaryRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) section_id: String,
    pub(in crate::projects) status_id: String,
    pub(in crate::projects) parent_task_id: Option<String>,
    pub(in crate::projects) title: String,
    pub(in crate::projects) priority: String,
    pub(in crate::projects) task_type: String,
    pub(in crate::projects) section_sort_order: f64,
    pub(in crate::projects) status_sort_order: f64,
    pub(in crate::projects) estimate_minutes: Option<i64>,
    pub(in crate::projects) due_date: Option<String>,
    pub(in crate::projects) due_time: Option<String>,
    pub(in crate::projects) start_date: Option<String>,
    pub(in crate::projects) start_time: Option<String>,
    pub(in crate::projects) target_end_date: Option<String>,
    pub(in crate::projects) completed_at: Option<String>,
    pub(in crate::projects) archived_at: Option<String>,
    pub(in crate::projects) blocker_reason_present: i64,
    pub(in crate::projects) milestone: i64,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectTaskSummaryRow {
    id,
    project_id,
    section_id,
    status_id,
    parent_task_id,
    title,
    priority,
    task_type,
    section_sort_order,
    status_sort_order,
    estimate_minutes,
    due_date,
    due_time,
    start_date,
    start_time,
    target_end_date,
    completed_at,
    archived_at,
    blocker_reason_present,
    milestone,
    created_at,
    updated_at,
});
impl_sqlite_from_row!(ProjectTaskRow {
    id,
    project_id,
    section_id,
    status_id,
    parent_task_id,
    title,
    description,
    priority,
    task_type,
    section_sort_order,
    status_sort_order,
    estimate_minutes,
    due_date,
    due_time,
    start_date,
    start_time,
    target_end_date,
    completed_at,
    archived_at,
    blocker_reason,
    milestone,
    created_at,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectChecklistItemRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) title: String,
    pub(in crate::projects) completed_at: Option<String>,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectChecklistItemRow {
    id,
    task_id,
    title,
    completed_at,
    sort_order,
    created_at,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectTagRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) color: Option<i64>,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectTagRow {
    id,
    project_id,
    name,
    color,
    sort_order,
    created_at,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectTaskTagLinkRow {
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) tag_id: String,
    pub(in crate::projects) created_at: String,
}
impl_sqlite_from_row!(ProjectTaskTagLinkRow {
    task_id,
    tag_id,
    created_at,
});

#[derive(Serialize)]
pub struct ProjectCustomFieldRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) field_type: String,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectCustomFieldRow {
    id,
    project_id,
    name,
    field_type,
    sort_order,
    created_at,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectCustomFieldOptionRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) field_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectCustomFieldOptionRow {
    id,
    field_id,
    name,
    sort_order,
    created_at,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectCustomFieldValueRow {
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) field_id: String,
    pub(in crate::projects) text_value: Option<String>,
    pub(in crate::projects) number_value: Option<f64>,
    pub(in crate::projects) date_value: Option<String>,
    pub(in crate::projects) checkbox_value: Option<i64>,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectCustomFieldValueRow {
    task_id,
    field_id,
    text_value,
    number_value,
    date_value,
    checkbox_value,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectCustomFieldOptionValueRow {
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) field_id: String,
    pub(in crate::projects) option_id: String,
    pub(in crate::projects) created_at: String,
}
impl_sqlite_from_row!(ProjectCustomFieldOptionValueRow {
    task_id,
    field_id,
    option_id,
    created_at,
});

#[derive(Serialize)]
pub struct ProjectTaskDependencyRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) blocking_task_id: String,
    pub(in crate::projects) blocked_task_id: String,
    pub(in crate::projects) dependency_type: String,
    pub(in crate::projects) created_at: String,
}
impl_sqlite_from_row!(ProjectTaskDependencyRow {
    id,
    blocking_task_id,
    blocked_task_id,
    dependency_type,
    created_at,
});

#[derive(Serialize)]
pub struct ProjectTaskEventLinkRow {
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) event_id: String,
    pub(in crate::projects) link_kind: String,
    pub(in crate::projects) created_at: String,
}
impl_sqlite_from_row!(ProjectTaskEventLinkRow {
    task_id,
    event_id,
    link_kind,
    created_at,
});

#[derive(Serialize)]
pub struct ProjectTaskChangeEventRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) event_type: String,
    pub(in crate::projects) field_name: Option<String>,
    pub(in crate::projects) old_value: Option<String>,
    pub(in crate::projects) new_value: Option<String>,
    pub(in crate::projects) reason: Option<String>,
    pub(in crate::projects) occurred_at: String,
}
impl_sqlite_from_row!(ProjectTaskChangeEventRow {
    id,
    task_id,
    event_type,
    field_name,
    old_value,
    new_value,
    reason,
    occurred_at,
});

#[derive(Serialize)]
pub struct ProjectViewPreferenceRow {
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) view_id: String,
    pub(in crate::projects) preference_key: String,
    pub(in crate::projects) preference_value: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectViewPreferenceRow {
    project_id,
    view_id,
    preference_key,
    preference_value,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectCustomEmojiRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) asset_path: String,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) created_at: String,
    pub(in crate::projects) updated_at: String,
}
impl_sqlite_from_row!(ProjectCustomEmojiRow {
    id,
    name,
    asset_path,
    sort_order,
    created_at,
    updated_at,
});

#[derive(Serialize)]
pub struct ProjectLinkableEventTask {
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) title: String,
    pub(in crate::projects) archived_at: Option<String>,
}

#[derive(Serialize)]
pub struct ProjectLinkableEvent {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) title: String,
    pub(in crate::projects) start_time: String,
    pub(in crate::projects) end_time: String,
    pub(in crate::projects) timezone: String,
    pub(in crate::projects) calendar_id: String,
    pub(in crate::projects) color: Option<i64>,
    pub(in crate::projects) all_day: i64,
    pub(in crate::projects) status: String,
    pub(in crate::projects) linked_tasks: Vec<ProjectLinkableEventTask>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLinkableEventSearch {
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) task_id: Option<String>,
    pub(in crate::projects) query: Option<String>,
    pub(in crate::projects) start_date: Option<String>,
    pub(in crate::projects) end_date: Option<String>,
    pub(in crate::projects) limit: Option<i64>,
}

#[derive(Serialize)]
pub(in crate::projects) struct ProjectLinkableEventRow {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) title: String,
    pub(in crate::projects) start_time: String,
    pub(in crate::projects) end_time: String,
    pub(in crate::projects) timezone: String,
    pub(in crate::projects) calendar_id: String,
    pub(in crate::projects) color: Option<i64>,
    pub(in crate::projects) all_day: i64,
    pub(in crate::projects) status: String,
}
impl_sqlite_from_row!(ProjectLinkableEventRow {
    id,
    project_id,
    title,
    start_time,
    end_time,
    timezone,
    calendar_id,
    color,
    all_day,
    status,
});

pub(in crate::projects) struct ProjectLinkableEventTaskRow {
    pub(in crate::projects) event_id: String,
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) title: String,
    pub(in crate::projects) archived_at: Option<String>,
}
impl_sqlite_from_row!(ProjectLinkableEventTaskRow {
    event_id,
    task_id,
    title,
    archived_at,
});

#[derive(Serialize)]
pub struct ProjectsSnapshot {
    pub(in crate::projects) groups: Vec<ProjectGroupRow>,
    pub(in crate::projects) projects: Vec<ProjectRow>,
    pub(in crate::projects) sections: Vec<ProjectSectionRow>,
    pub(in crate::projects) statuses: Vec<ProjectStatusRow>,
    pub(in crate::projects) priorities: Vec<ProjectPriorityRow>,
    pub(in crate::projects) tasks: Vec<ProjectTaskRow>,
    pub(in crate::projects) checklist_items: Vec<ProjectChecklistItemRow>,
    pub(in crate::projects) tags: Vec<ProjectTagRow>,
    pub(in crate::projects) task_tag_links: Vec<ProjectTaskTagLinkRow>,
    pub(in crate::projects) custom_fields: Vec<ProjectCustomFieldRow>,
    pub(in crate::projects) custom_field_options: Vec<ProjectCustomFieldOptionRow>,
    pub(in crate::projects) custom_field_values: Vec<ProjectCustomFieldValueRow>,
    pub(in crate::projects) custom_field_option_values: Vec<ProjectCustomFieldOptionValueRow>,
    pub(in crate::projects) dependencies: Vec<ProjectTaskDependencyRow>,
    pub(in crate::projects) event_links: Vec<ProjectTaskEventLinkRow>,
    pub(in crate::projects) task_change_events: Vec<ProjectTaskChangeEventRow>,
    pub(in crate::projects) view_preferences: Vec<ProjectViewPreferenceRow>,
    pub(in crate::projects) custom_emojis: Vec<ProjectCustomEmojiRow>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectViewId {
    List,
    Kanban,
    Calendar,
    Gantt,
    Dashboard,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskCustomFieldFilterRequest {
    pub(in crate::projects) field_id: String,
    pub(in crate::projects) mode: String,
    pub(in crate::projects) checked: Option<bool>,
    pub(in crate::projects) option_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskViewRequest {
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) view: ProjectViewId,
    pub(in crate::projects) page_size: i64,
    pub(in crate::projects) cursor: Option<String>,
    pub(in crate::projects) column_cursors: HashMap<String, String>,
    pub(in crate::projects) show_archived: bool,
    pub(in crate::projects) visible_section_ids: Vec<String>,
    pub(in crate::projects) search: String,
    pub(in crate::projects) status_filter: String,
    pub(in crate::projects) section_filter: String,
    pub(in crate::projects) priority_filter: String,
    pub(in crate::projects) due_filter: String,
    pub(in crate::projects) due_range_start: String,
    pub(in crate::projects) due_range_end: String,
    pub(in crate::projects) today: String,
    pub(in crate::projects) week_end: String,
    pub(in crate::projects) schedule_filter: String,
    pub(in crate::projects) dependency_filter: String,
    pub(in crate::projects) tag_filter: String,
    pub(in crate::projects) custom_field_filters: Vec<ProjectTaskCustomFieldFilterRequest>,
    pub(in crate::projects) sort_mode: String,
    pub(in crate::projects) sort_direction: String,
    pub(in crate::projects) candidate_event_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct ProjectTaskColumnCount {
    pub(in crate::projects) status_id: String,
    pub(in crate::projects) count: i64,
    pub(in crate::projects) next_cursor: Option<String>,
}

#[derive(Default, Serialize)]
pub struct ProjectDashboardTaskAggregates {
    pub(in crate::projects) total: i64,
    pub(in crate::projects) completed: i64,
    pub(in crate::projects) open_estimate_minutes: i64,
    pub(in crate::projects) blocked: i64,
    pub(in crate::projects) overdue: i64,
    pub(in crate::projects) unscheduled_due: i64,
    pub(in crate::projects) missing_estimate: i64,
    pub(in crate::projects) status_counts: HashMap<String, i64>,
}

#[derive(Serialize)]
pub struct ProjectTaskViewPage {
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) view: ProjectViewId,
    pub(in crate::projects) tasks: Vec<ProjectTaskSummaryRow>,
    pub(in crate::projects) total_count: i64,
    pub(in crate::projects) matched_count: i64,
    pub(in crate::projects) archived_count: i64,
    pub(in crate::projects) next_cursor: Option<String>,
    pub(in crate::projects) column_counts: Vec<ProjectTaskColumnCount>,
    pub(in crate::projects) aggregates: Option<ProjectDashboardTaskAggregates>,
    pub(in crate::projects) column_calculations: Vec<ProjectTaskColumnCalculations>,
    pub(in crate::projects) matched_event_ids: Vec<String>,
    pub(in crate::projects) task_tag_links: Vec<ProjectTaskTagLinkRow>,
    pub(in crate::projects) custom_field_values: Vec<ProjectCustomFieldValueRow>,
    pub(in crate::projects) custom_field_option_values: Vec<ProjectCustomFieldOptionValueRow>,
    pub(in crate::projects) dependencies: Vec<ProjectTaskDependencyRow>,
    pub(in crate::projects) event_links: Vec<ProjectTaskEventLinkRow>,
    pub(in crate::projects) tags: Vec<ProjectTagRow>,
    pub(in crate::projects) custom_fields: Vec<ProjectCustomFieldRow>,
    pub(in crate::projects) custom_field_options: Vec<ProjectCustomFieldOptionRow>,
}

/// Property reductions over the complete matched task set, excluding pagination and parent context.
#[derive(Serialize)]
pub struct ProjectTaskColumnCalculations {
    pub(in crate::projects) column: String,
    pub(in crate::projects) total: i64,
    pub(in crate::projects) filled: i64,
    pub(in crate::projects) sum: Option<f64>,
    pub(in crate::projects) average: Option<f64>,
    pub(in crate::projects) minimum: Option<f64>,
    pub(in crate::projects) maximum: Option<f64>,
}

#[derive(Serialize)]
pub struct ProjectTaskDetailData {
    pub(in crate::projects) task: ProjectTaskRow,
    pub(in crate::projects) related_tasks: Vec<ProjectTaskSummaryRow>,
    pub(in crate::projects) checklist_items: Vec<ProjectChecklistItemRow>,
    pub(in crate::projects) tags: Vec<ProjectTagRow>,
    pub(in crate::projects) task_tag_links: Vec<ProjectTaskTagLinkRow>,
    pub(in crate::projects) custom_fields: Vec<ProjectCustomFieldRow>,
    pub(in crate::projects) custom_field_options: Vec<ProjectCustomFieldOptionRow>,
    pub(in crate::projects) custom_field_values: Vec<ProjectCustomFieldValueRow>,
    pub(in crate::projects) custom_field_option_values: Vec<ProjectCustomFieldOptionValueRow>,
    pub(in crate::projects) dependencies: Vec<ProjectTaskDependencyRow>,
    pub(in crate::projects) event_links: Vec<ProjectTaskEventLinkRow>,
    pub(in crate::projects) task_change_events: Vec<ProjectTaskChangeEventRow>,
}

#[derive(Serialize)]
pub struct ProjectsWorkspaceSnapshot {
    pub(in crate::projects) resolved_project_id: Option<String>,
    pub(in crate::projects) active_view: ProjectViewId,
    pub(in crate::projects) snapshot: ProjectsSnapshot,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectOptionalDataKind {
    Relationships,
    CustomFields,
    History,
    Checklist,
    SavedViews,
    CustomEmojis,
}

#[derive(Serialize)]
pub struct ProjectsOptionalData {
    pub(in crate::projects) kind: ProjectOptionalDataKind,
    pub(in crate::projects) project_id: Option<String>,
    pub(in crate::projects) checklist_items: Vec<ProjectChecklistItemRow>,
    pub(in crate::projects) tags: Vec<ProjectTagRow>,
    pub(in crate::projects) task_tag_links: Vec<ProjectTaskTagLinkRow>,
    pub(in crate::projects) custom_fields: Vec<ProjectCustomFieldRow>,
    pub(in crate::projects) custom_field_options: Vec<ProjectCustomFieldOptionRow>,
    pub(in crate::projects) custom_field_values: Vec<ProjectCustomFieldValueRow>,
    pub(in crate::projects) custom_field_option_values: Vec<ProjectCustomFieldOptionValueRow>,
    pub(in crate::projects) dependencies: Vec<ProjectTaskDependencyRow>,
    pub(in crate::projects) event_links: Vec<ProjectTaskEventLinkRow>,
    pub(in crate::projects) task_change_events: Vec<ProjectTaskChangeEventRow>,
    pub(in crate::projects) view_preferences: Vec<ProjectViewPreferenceRow>,
    pub(in crate::projects) custom_emojis: Vec<ProjectCustomEmojiRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGroupCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) icon: String,
    pub(in crate::projects) color: Option<i64>,
    pub(in crate::projects) sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGroupUpdate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) icon: String,
    pub(in crate::projects) color: Option<i64>,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) collapsed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) group_id: String,
    pub(in crate::projects) template_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) icon: String,
    pub(in crate::projects) color: Option<i64>,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) default_event_name: Option<String>,
    pub(in crate::projects) default_event_time_mode: String,
    pub(in crate::projects) default_event_duration_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_mode: String,
    pub(in crate::projects) default_pomodoro_preset_key: Option<String>,
    pub(in crate::projects) default_pomodoro_focus_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_short_break_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_long_break_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_long_break_after_focus_count: Option<i64>,
    pub(in crate::projects) default_idle_settings_source: String,
    pub(in crate::projects) default_idle_pause_enabled: bool,
    pub(in crate::projects) default_idle_threshold_minutes: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUpdate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) group_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) icon: String,
    pub(in crate::projects) color: Option<i64>,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) status: String,
    pub(in crate::projects) default_event_name: Option<String>,
    pub(in crate::projects) default_event_time_mode: String,
    pub(in crate::projects) default_event_duration_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_mode: String,
    pub(in crate::projects) default_pomodoro_preset_key: Option<String>,
    pub(in crate::projects) default_pomodoro_focus_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_short_break_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_long_break_minutes: Option<i64>,
    pub(in crate::projects) default_pomodoro_long_break_after_focus_count: Option<i64>,
    pub(in crate::projects) default_idle_settings_source: String,
    pub(in crate::projects) default_idle_pause_enabled: bool,
    pub(in crate::projects) default_idle_threshold_minutes: i64,
    pub(in crate::projects) focus_playlist_id: Option<String>,
    pub(in crate::projects) break_playlist_id: Option<String>,
    pub(in crate::projects) work_environment_id: Option<String>,
    pub(in crate::projects) blocker_ruleset_id: Option<String>,
    pub(in crate::projects) music_assignments:
        Option<Vec<crate::music_context::MusicContextAssignmentDraft>>,
    pub(in crate::projects) music_assignments_updated_at: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSectionCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSectionUpdate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) collapsed: bool,
    pub(in crate::projects) hidden_at: Option<String>,
    pub(in crate::projects) archived_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatusCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) category: String,
    pub(in crate::projects) color: i64,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) terminal: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatusUpdate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) category: String,
    pub(in crate::projects) color: i64,
    pub(in crate::projects) sort_order: i64,
    pub(in crate::projects) terminal: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPriorityCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) color: i64,
    pub(in crate::projects) sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPriorityUpdate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) color: i64,
    pub(in crate::projects) sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) section_id: String,
    pub(in crate::projects) status_id: String,
    pub(in crate::projects) parent_task_id: Option<String>,
    pub(in crate::projects) title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskUpdate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) section_id: String,
    pub(in crate::projects) status_id: String,
    pub(in crate::projects) parent_task_id: Option<String>,
    pub(in crate::projects) title: String,
    pub(in crate::projects) description: String,
    pub(in crate::projects) priority: String,
    pub(in crate::projects) task_type: String,
    pub(in crate::projects) section_sort_order: f64,
    pub(in crate::projects) status_sort_order: f64,
    pub(in crate::projects) estimate_minutes: Option<i64>,
    pub(in crate::projects) due_date: Option<String>,
    pub(in crate::projects) due_time: Option<String>,
    pub(in crate::projects) start_date: Option<String>,
    pub(in crate::projects) start_time: Option<String>,
    pub(in crate::projects) target_end_date: Option<String>,
    pub(in crate::projects) archived_at: Option<String>,
    pub(in crate::projects) blocker_reason: Option<String>,
    pub(in crate::projects) milestone: bool,
    pub(in crate::projects) change_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskDependencyCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) blocking_task_id: String,
    pub(in crate::projects) blocked_task_id: String,
    pub(in crate::projects) dependency_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChecklistItemCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) title: String,
    pub(in crate::projects) sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChecklistItemUpdate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) title: String,
    pub(in crate::projects) completed: bool,
    pub(in crate::projects) sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTagCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) color: Option<i64>,
    pub(in crate::projects) sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTagUpdate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) color: Option<i64>,
    pub(in crate::projects) sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskTagLinkCreate {
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) tag_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCustomFieldCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) field_type: String,
    pub(in crate::projects) sort_order: i64,
    #[serde(default)]
    pub(in crate::projects) duplicate_source_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCustomFieldUpdate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCustomFieldOptionCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) field_id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCustomFieldOptionUpdate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) sort_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCustomFieldValueUpdate {
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) field_id: String,
    pub(in crate::projects) text_value: Option<String>,
    pub(in crate::projects) number_value: Option<f64>,
    pub(in crate::projects) date_value: Option<String>,
    pub(in crate::projects) checkbox_value: Option<bool>,
    pub(in crate::projects) option_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskEventLinkCreate {
    pub(in crate::projects) task_id: String,
    pub(in crate::projects) event_id: String,
    pub(in crate::projects) link_kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectViewPreferenceUpsert {
    pub(in crate::projects) project_id: String,
    pub(in crate::projects) view_id: String,
    pub(in crate::projects) preference_key: String,
    pub(in crate::projects) preference_value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCustomEmojiCreate {
    pub(in crate::projects) id: String,
    pub(in crate::projects) name: String,
    pub(in crate::projects) asset_path: String,
    pub(in crate::projects) sort_order: i64,
}
