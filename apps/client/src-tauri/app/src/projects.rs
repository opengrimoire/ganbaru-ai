pub(crate) mod custom_fields;
pub(crate) mod dependency_cascade;
mod dependency_cascade_graph;
mod dependency_cascade_plan;
pub(crate) mod emojis;
mod history;
pub(crate) mod icons;
mod models;
mod mutations;
pub(crate) mod preferences;
pub(crate) mod project_commands;
pub(crate) mod relationship_commands;
pub(crate) mod reorder;
mod routine;
pub(crate) mod scheduling;
pub(crate) mod structure_commands;
pub(crate) mod task_bulk;
pub(crate) mod task_commands;
mod task_views;
mod templates;
pub(crate) mod validation;
#[cfg(desktop)]
pub(crate) mod working_folders;
pub(crate) mod workspace;

// Keep the established DTO import surface while command modules use explicit model ownership.
#[allow(unused_imports)]
pub use models::*;
#[cfg(test)]
use routine::BUILT_IN_ROUTINE_PROJECTS;
#[cfg(test)]
use routine::{ROUTINE_GROUP_ID, ensure_built_in_routine_defaults};
#[cfg(test)]
use task_views::{load_task_detail, load_task_view};
#[cfg(test)]
use validation::{
    MAX_TASK_CHANGE_REASON_LENGTH, normalize_optional_date_filter, sql_like_contains_pattern,
    validate_project_update, validate_task_update,
};
#[cfg(test)]
use workspace::load_project_custom_emojis;
#[cfg(test)]
pub(crate) use workspace::{
    load_projects_workspace_for_first_use_contract,
    refresh_projects_workspace_for_first_use_contract,
};

#[cfg(test)]
mod tests;
