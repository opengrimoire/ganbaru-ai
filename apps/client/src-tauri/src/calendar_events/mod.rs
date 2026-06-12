mod archive;
mod children;
pub(crate) mod commands;
mod ids;
pub(crate) mod progress;
mod restore;
#[cfg(test)]
mod tests;
mod time;
mod types;
mod validation;
mod writes;

pub use archive::archive_or_delete_calendar_events_for_calendar;

#[cfg(test)]
use archive::{
    apply_delete_archive_operations_tx, archive_calendar_event_tx, delete_calendar_event_tx,
};
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
    CalendarActiveEventReferenceTransfer, CalendarDeleteArchiveOperation, CalendarDetachInstance,
    CalendarEventCreate, CalendarEventMutationContext, CalendarEventMutationTarget,
    CalendarEventUpdate, CalendarEventUpdateField, CalendarGuestPermissions,
    CalendarPomodoroConfig, CalendarPomodoroConfigPatch, CalendarPomodoroRhythm,
    CalendarPomodoroSequenceStep, CalendarRecurrenceCommitOperation, CalendarSplitSeries,
};
#[cfg(test)]
use validation::{
    validate_color, validate_event_create, validate_non_negative, validate_positive,
    validate_priority, validate_update_field,
};
#[cfg(test)]
use writes::{
    apply_recurrence_commit_operations_tx, cap_calendar_series_tx,
    protected_active_event_end_update_allowed, split_calendar_series_tx, update_calendar_event_tx,
};
