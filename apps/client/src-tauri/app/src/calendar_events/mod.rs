mod archive;
mod children;
pub(crate) mod commit;
mod create;
pub(crate) mod deletion;
pub(crate) mod edit;
mod ids;
mod metadata;
mod occurrence;
pub(crate) use occurrence::ReadBudget;
pub(crate) mod preview;
pub(crate) mod progress;
mod restore;
pub(crate) mod scope;
mod task_schedule;
#[cfg(test)]
mod tests;
mod time;
mod types;
mod validation;
// Primitive mutation fixtures remain available to protection regressions only.
// Production writes use reviewed semantic operations in the Focus owner.
#[cfg(test)]
mod writes;

pub(crate) use archive::archive_or_delete_calendar_events_for_calendar;

#[cfg(test)]
use archive::{archive_calendar_event_tx, delete_calendar_event_tx};
#[cfg(test)]
use children::{
    apply_update_field, insert_calendar_event_row, insert_pomodoro_config, replace_pomodoro_config,
    sanitize_stored_event_description,
};
#[cfg(test)]
use progress::filter_excluded_dates;
#[cfg(test)]
use restore::restore_archived_calendar_event_tx;
#[cfg(test)]
use types::{
    CalendarDetachInstance, CalendarEventCreate, CalendarEventMutationContext,
    CalendarEventMutationTarget, CalendarEventUpdate, CalendarEventUpdateField,
    CalendarGuestPermissions, CalendarPomodoroConfig, CalendarPomodoroConfigPatch,
    CalendarPomodoroRhythm, CalendarPomodoroSequenceStep, CalendarSplitSeries,
};
#[cfg(test)]
use validation::{
    validate_color, validate_event_create, validate_non_negative, validate_positive,
    validate_priority, validate_update_field,
};
#[cfg(test)]
use writes::{
    protected_active_event_end_update_allowed, split_calendar_series_tx, update_calendar_event_tx,
};
