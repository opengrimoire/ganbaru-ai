use super::ids::split_synthetic_id;
use super::types::{
    CalendarActiveEventReferenceTransfer, CalendarDeleteArchiveOperation, CalendarDetachInstance,
    CalendarEventAlarm, CalendarEventAttendee, CalendarEventCreate, CalendarEventMutationTarget,
    CalendarEventUpdate, CalendarEventUpdateField, CalendarPomodoroConfig,
    CalendarPomodoroConfigPatch, CalendarPomodoroRhythm, CalendarRecurrenceCommitOperation,
    CalendarSplitSeries,
};

const PALETTE_SIZE: i64 = 32;

pub(super) fn validate_mutation_target(target: &CalendarEventMutationTarget) -> Result<(), String> {
    require_non_empty(&target.id, "id")?;
    if let Some(value) = &target.occurrence_start {
        require_non_empty(value, "occurrence_start")?;
    }
    if let Some(value) = &target.occurrence_end {
        require_non_empty(value, "occurrence_end")?;
    }
    Ok(())
}
pub(super) fn validate_delete_archive_operation(
    operation: &CalendarDeleteArchiveOperation,
) -> Result<(), String> {
    match operation {
        CalendarDeleteArchiveOperation::DeleteEvent { target }
        | CalendarDeleteArchiveOperation::ArchiveEvent { target } => {
            validate_mutation_target(target)
        }
        CalendarDeleteArchiveOperation::CapSeries {
            event_id,
            repeat_until,
            rrule,
        } => {
            require_non_empty(event_id, "event_id")?;
            require_non_empty(repeat_until, "repeat_until")?;
            require_non_empty(rrule, "rrule")
        }
    }
}
pub(super) fn validate_active_event_reference_transfer(
    transfer: &CalendarActiveEventReferenceTransfer,
) -> Result<(), String> {
    canonical_event_id(&transfer.new_event_id)?;
    if let Some(date) = &transfer.new_event_date {
        require_non_empty(date, "transfer.new_event_date")?;
    }
    if let Some(planned_end) = &transfer.planned_end {
        require_non_empty(planned_end, "transfer.planned_end")?;
    }
    Ok(())
}
pub(super) fn validate_recurrence_commit_operation(
    operation: &CalendarRecurrenceCommitOperation,
) -> Result<(), String> {
    match operation {
        CalendarRecurrenceCommitOperation::UpdateEvent { patch } => validate_event_update(patch),
        CalendarRecurrenceCommitOperation::DetachInstance { input } => {
            validate_detach_instance(input)
        }
        CalendarRecurrenceCommitOperation::SplitSeries { input } => validate_split_series(input),
        CalendarRecurrenceCommitOperation::TransferActiveEventReference { transfer } => {
            validate_active_event_reference_transfer(transfer)
        }
    }
}
pub(super) fn canonical_event_id(value: &str) -> Result<&str, String> {
    let (event_id, _) = split_synthetic_id(value);
    require_non_empty(event_id, "event_id")?;
    Ok(event_id)
}
pub(super) fn require_non_empty_option(value: &Option<String>, field: &str) -> Result<(), String> {
    match value {
        Some(value) => require_non_empty(value, field),
        None => Err(format!("{field} cannot be empty")),
    }
}
pub(super) fn validate_event_create(event: &CalendarEventCreate) -> Result<(), String> {
    require_non_empty(&event.id, "id")?;
    require_non_empty(&event.start_time, "start_time")?;
    require_non_empty(&event.end_time, "end_time")?;
    require_non_empty(&event.timezone, "timezone")?;
    require_non_empty(&event.calendar_id, "calendar_id")?;
    require_non_empty(&event.created_at, "created_at")?;
    require_non_empty(&event.updated_at, "updated_at")?;
    validate_color(event.color, "color")?;
    validate_enum(
        &event.transparency,
        "transparency",
        &["opaque", "transparent"],
    )?;
    validate_enum(
        &event.status,
        "status",
        &["confirmed", "tentative", "cancelled"],
    )?;
    validate_enum(&event.visibility, "visibility", &["public", "private"])?;
    validate_priority(event.priority)?;
    validate_non_negative(event.sequence, "sequence")?;
    validate_json_option(&event.notifications, "notifications")?;
    validate_json_option(&event.exceptions, "exceptions")?;
    validate_json_option(&event.categories, "categories")?;
    validate_json_option(&event.geo, "geo")?;
    validate_json_option(&event.rdate, "rdate")?;
    validate_json_option(&event.extended_properties, "extended_properties")?;
    validate_json_option(&event.organizer, "organizer")?;
    validate_optional_attendee_status(&event.local_rsvp_status, "local_rsvp_status")?;
    if event.all_day && event.pomodoro_config.is_some() {
        return Err("all-day events cannot have a pomodoro config".to_string());
    }
    if let Some(config) = &event.pomodoro_config {
        validate_pomodoro_config(config)?;
    }
    for attendee in &event.attendees {
        validate_attendee(attendee)?;
    }
    Ok(())
}
pub(super) fn validate_event_update(patch: &CalendarEventUpdate) -> Result<(), String> {
    require_non_empty(&patch.id, "id")?;
    require_non_empty(&patch.updated_at, "updated_at")?;
    for field in &patch.fields {
        validate_update_field(field)?;
    }
    if let Some(attendees) = &patch.attendees {
        for attendee in attendees {
            validate_attendee(attendee)?;
        }
    }
    if let Some(alarms) = &patch.alarms {
        for alarm in alarms {
            validate_alarm(alarm)?;
        }
    }
    if let Some(CalendarPomodoroConfigPatch::Set(config)) = &patch.pomodoro_config {
        validate_pomodoro_config(config)?;
    }
    Ok(())
}
pub(super) fn validate_detach_instance(input: &CalendarDetachInstance) -> Result<(), String> {
    require_non_empty(&input.parent_id, "parent_id")?;
    require_non_empty(&input.instance_date, "instance_date")?;
    require_non_empty(&input.new_id, "new_id")?;
    require_non_empty(&input.start_time, "start_time")?;
    require_non_empty(&input.end_time, "end_time")?;
    require_non_empty(&input.timezone, "timezone")?;
    require_non_empty(&input.calendar_id, "calendar_id")?;
    require_non_empty(&input.now, "now")?;
    validate_json_option(&Some(input.exceptions.clone()), "exceptions")?;
    validate_color(input.color, "color")?;
    validate_json_option(&input.notifications, "notifications")?;
    validate_enum(
        &input.transparency,
        "transparency",
        &["opaque", "transparent"],
    )?;
    validate_enum(
        &input.status,
        "status",
        &["confirmed", "tentative", "cancelled"],
    )
}
pub(super) fn validate_split_series(input: &CalendarSplitSeries) -> Result<(), String> {
    require_non_empty(&input.parent_id, "parent_id")?;
    require_non_empty(&input.day_before, "day_before")?;
    require_non_empty(&input.new_id, "new_id")?;
    require_non_empty(&input.start_time, "start_time")?;
    require_non_empty(&input.end_time, "end_time")?;
    require_non_empty(&input.timezone, "timezone")?;
    require_non_empty(&input.calendar_id, "calendar_id")?;
    require_non_empty(&input.now, "now")?;
    validate_color(input.color, "color")?;
    validate_json_option(&input.notifications, "notifications")?;
    validate_json_option(&input.exceptions, "exceptions")?;
    if input.all_day && (input.copy_pomodoro_config || input.pomodoro_config.is_some()) {
        return Err("all-day events cannot have a pomodoro config".to_string());
    }
    if let Some(config) = &input.pomodoro_config {
        validate_pomodoro_config(config)?;
    }
    validate_optional_attendee_status(&input.local_rsvp_status, "local_rsvp_status")?;
    validate_enum(
        &input.transparency,
        "transparency",
        &["opaque", "transparent"],
    )?;
    validate_enum(
        &input.status,
        "status",
        &["confirmed", "tentative", "cancelled"],
    )
}
pub(super) fn validate_update_field(field: &CalendarEventUpdateField) -> Result<(), String> {
    match field {
        CalendarEventUpdateField::Title(_) => Ok(()),
        CalendarEventUpdateField::StartTime(value) => require_non_empty(value, "start_time"),
        CalendarEventUpdateField::EndTime(value) => require_non_empty(value, "end_time"),
        CalendarEventUpdateField::Timezone(value) => require_non_empty(value, "timezone"),
        CalendarEventUpdateField::CalendarId(value) => require_non_empty(value, "calendar_id"),
        CalendarEventUpdateField::Color(value) => validate_color(*value, "color"),
        CalendarEventUpdateField::Description(_) => Ok(()),
        CalendarEventUpdateField::Rrule(_) => Ok(()),
        CalendarEventUpdateField::RepeatUntil(_) => Ok(()),
        CalendarEventUpdateField::Notifications(value) => {
            validate_json_option(value, "notifications")
        }
        CalendarEventUpdateField::Exceptions(value) => validate_json_option(value, "exceptions"),
        CalendarEventUpdateField::AllDay(_) => Ok(()),
        CalendarEventUpdateField::Location(_) => Ok(()),
        CalendarEventUpdateField::Url(_) => Ok(()),
        CalendarEventUpdateField::Transparency(value) => {
            validate_enum(value, "transparency", &["opaque", "transparent"])
        }
        CalendarEventUpdateField::Status(value) => {
            validate_enum(value, "status", &["confirmed", "tentative", "cancelled"])
        }
        CalendarEventUpdateField::SourceUid(_) => Ok(()),
        CalendarEventUpdateField::Visibility(value) => {
            validate_enum(value, "visibility", &["public", "private"])
        }
        CalendarEventUpdateField::Priority(value) => validate_priority(*value),
        CalendarEventUpdateField::Categories(value) => validate_json_option(value, "categories"),
        CalendarEventUpdateField::Geo(value) => validate_json_option(value, "geo"),
        CalendarEventUpdateField::Sequence(value) => validate_non_negative(*value, "sequence"),
        CalendarEventUpdateField::Rdate(value) => validate_json_option(value, "rdate"),
        CalendarEventUpdateField::ExtendedProperties(value) => {
            validate_json_option(value, "extended_properties")
        }
        CalendarEventUpdateField::Organizer(value) => validate_json_option(value, "organizer"),
        CalendarEventUpdateField::MeetingEnabled(_) => Ok(()),
        CalendarEventUpdateField::LocalRsvpStatus(value) => {
            validate_optional_attendee_status(value, "local_rsvp_status")
        }
        CalendarEventUpdateField::GuestPermissions(_) => Ok(()),
    }
}
pub(super) fn validate_optional_attendee_status(
    value: &Option<String>,
    field: &str,
) -> Result<(), String> {
    if let Some(status) = value {
        validate_enum(
            status,
            field,
            &[
                "needs-action",
                "accepted",
                "declined",
                "tentative",
                "delegated",
            ],
        )?;
    }
    Ok(())
}
pub(super) fn validate_pomodoro_config(config: &CalendarPomodoroConfig) -> Result<(), String> {
    validate_rhythm_source(&config.rhythm_source, config.preset_key.as_deref())?;
    match &config.rhythm {
        CalendarPomodoroRhythm::Count {
            focus_duration_minutes,
            short_break_minutes,
            long_break_minutes,
            long_break_after_focus_count,
        } => {
            validate_positive(*focus_duration_minutes, "focus_duration_minutes")?;
            validate_positive(*short_break_minutes, "short_break_minutes")?;
            validate_positive(*long_break_minutes, "long_break_minutes")?;
            validate_rhythm_position_count(
                *long_break_after_focus_count,
                "long_break_after_focus_count",
            )?;
        }
        CalendarPomodoroRhythm::Sequence { steps } => {
            if steps.is_empty() {
                return Err("sequence rhythm must include at least one step".to_string());
            }
            validate_rhythm_position_count(steps.len() as i64, "sequence step count")?;
            for (index, step) in steps.iter().enumerate() {
                validate_positive(
                    step.focus_duration_minutes,
                    &format!("sequence step {index} focus_duration_minutes"),
                )?;
                validate_enum(
                    &step.break_phase,
                    &format!("sequence step {index} break_phase"),
                    &["short_break", "long_break"],
                )?;
                validate_positive(
                    step.break_duration_minutes,
                    &format!("sequence step {index} break_duration_minutes"),
                )?;
            }
        }
    }
    if let Some(idle) = config.idle_timeout_minutes {
        validate_non_negative(idle, "idle_timeout_minutes")?;
    }
    Ok(())
}
pub(super) fn validate_rhythm_source(source: &str, preset_key: Option<&str>) -> Result<(), String> {
    match source {
        "preset" => {
            let Some(key) = preset_key else {
                return Err("preset rhythm_source requires preset_key".to_string());
            };
            validate_enum(
                key,
                "preset_key",
                &["adaptive", "creative", "balanced", "deep", "extended"],
            )
        }
        "custom" => {
            if preset_key.is_some() {
                return Err("custom rhythm_source cannot include preset_key".to_string());
            }
            Ok(())
        }
        _ => Err(format!("invalid rhythm_source: {source}")),
    }
}
pub(super) fn validate_rhythm_position_count(value: i64, field: &str) -> Result<(), String> {
    if !(1..=12).contains(&value) {
        Err(format!("{field} must be between 1 and 12"))
    } else {
        Ok(())
    }
}
pub(super) fn validate_alarm(alarm: &CalendarEventAlarm) -> Result<(), String> {
    require_non_empty(&alarm.id, "alarm.id")?;
    require_non_empty(&alarm.trigger_value, "alarm.trigger_value")?;
    validate_enum(
        &alarm.action,
        "alarm.action",
        &["display", "audio", "email"],
    )?;
    validate_enum(
        &alarm.trigger_type,
        "alarm.trigger_type",
        &["relative", "absolute"],
    )
}
pub(super) fn validate_attendee(attendee: &CalendarEventAttendee) -> Result<(), String> {
    require_non_empty(&attendee.id, "attendee.id")?;
    require_non_empty(&attendee.email, "attendee.email")?;
    validate_enum(
        &attendee.role,
        "attendee.role",
        &[
            "chair",
            "req-participant",
            "opt-participant",
            "non-participant",
        ],
    )?;
    validate_enum(
        &attendee.status,
        "attendee.status",
        &[
            "needs-action",
            "accepted",
            "declined",
            "tentative",
            "delegated",
        ],
    )
}
pub(super) fn validate_enum(value: &str, field: &str, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("{field} has unsupported value '{value}'"))
    }
}
pub(super) fn validate_color(value: Option<i64>, field: &str) -> Result<(), String> {
    if let Some(color) = value {
        if !(0..PALETTE_SIZE).contains(&color) {
            return Err(format!("{field} is outside the event palette range"));
        }
    }
    Ok(())
}
pub(super) fn validate_priority(value: Option<i64>) -> Result<(), String> {
    if let Some(priority) = value {
        if !(0..=9).contains(&priority) {
            return Err("priority must be between 0 and 9".to_string());
        }
    }
    Ok(())
}
pub(super) fn validate_positive(value: i64, field: &str) -> Result<(), String> {
    if value <= 0 {
        Err(format!("{field} must be positive"))
    } else {
        Ok(())
    }
}
pub(super) fn validate_non_negative(value: i64, field: &str) -> Result<(), String> {
    if value < 0 {
        Err(format!("{field} cannot be negative"))
    } else {
        Ok(())
    }
}
pub(super) fn validate_json_option(value: &Option<String>, field: &str) -> Result<(), String> {
    if let Some(json) = value {
        serde_json::from_str::<serde_json::Value>(json)
            .map_err(|e| format!("{field} is not valid JSON: {e}"))?;
    }
    Ok(())
}
pub(super) fn require_non_empty(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} cannot be empty"))
    } else {
        Ok(())
    }
}
