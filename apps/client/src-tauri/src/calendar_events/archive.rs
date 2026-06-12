use sqlx::Row;

use super::ids::{date_part, split_synthetic_id};
use super::time::current_utc_iso;
use super::types::{
    CalendarDeleteArchiveOperation, CalendarEventMutationContext, CalendarEventMutationTarget,
};
use super::validation::{require_non_empty_option, validate_delete_archive_operation};
use super::writes::cap_calendar_series_tx;

pub async fn archive_or_delete_calendar_events_for_calendar(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    calendar_id: Option<&str>,
) -> Result<(), String> {
    ensure_no_open_runs_for_scope(tx, calendar_id).await?;
    let now = current_utc_iso(tx).await?;
    let event_ids = load_event_ids_for_scope(tx, calendar_id).await?;
    for id in event_ids {
        let target = CalendarEventMutationTarget {
            id,
            occurrence_start: None,
            occurrence_end: None,
        };
        let context = load_mutation_context(tx, &target).await?;
        if is_protected_event(tx, &context, &now).await? {
            archive_loaded_event(tx, &context, &now).await?;
        } else {
            hard_delete_loaded_event(tx, &context, &now).await?;
        }
    }
    Ok(())
}
pub(super) async fn delete_calendar_event_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    target: &CalendarEventMutationTarget,
) -> Result<(), String> {
    let now = current_utc_iso(tx).await?;
    let context = load_mutation_context(tx, target).await?;
    ensure_no_open_runs_for_event(tx, &context).await?;
    if is_protected_event(tx, &context, &now).await? {
        return Err(format!(
            "calendar event '{}' is protected; archive it instead",
            context.id
        ));
    }
    hard_delete_loaded_event(tx, &context, &now).await
}
pub(super) async fn archive_calendar_event_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    target: &CalendarEventMutationTarget,
) -> Result<(), String> {
    let now = current_utc_iso(tx).await?;
    let context = load_mutation_context(tx, target).await?;
    ensure_no_open_runs_for_event(tx, &context).await?;
    archive_loaded_event(tx, &context, &now).await
}
pub(super) async fn apply_delete_archive_operations_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    operations: Vec<CalendarDeleteArchiveOperation>,
) -> Result<(), String> {
    for operation in &operations {
        validate_delete_archive_operation(operation)?;
    }
    for operation in operations {
        match operation {
            CalendarDeleteArchiveOperation::DeleteEvent { target } => {
                delete_calendar_event_tx(tx, &target).await?;
            }
            CalendarDeleteArchiveOperation::ArchiveEvent { target } => {
                archive_calendar_event_tx(tx, &target).await?;
            }
            CalendarDeleteArchiveOperation::CapSeries {
                event_id,
                repeat_until,
                rrule,
            } => {
                cap_calendar_series_tx(tx, &event_id, &repeat_until, &rrule).await?;
            }
        }
    }
    Ok(())
}
pub(super) async fn hard_delete_loaded_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    context: &CalendarEventMutationContext,
    now: &str,
) -> Result<(), String> {
    if context.synthetic {
        let occurrence_date = context
            .occurrence_date
            .as_deref()
            .ok_or_else(|| "synthetic occurrence date is required".to_string())?;
        add_exdate(tx, &context.source_event_id, occurrence_date, now).await?;
        return Ok(());
    }

    sqlx::query("DELETE FROM calendar_events WHERE id = ?")
        .bind(&context.source_event_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("delete calendar event: {e}"))?;
    Ok(())
}
pub(super) async fn archive_loaded_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    context: &CalendarEventMutationContext,
    archived_at: &str,
) -> Result<(), String> {
    archive_event_snapshot(tx, context, archived_at).await?;
    if context.synthetic {
        let occurrence_date = context
            .occurrence_date
            .as_deref()
            .ok_or_else(|| "synthetic occurrence date is required".to_string())?;
        add_exdate(tx, &context.source_event_id, occurrence_date, archived_at).await?;
        null_pomodoro_live_refs_for_synthetic(
            tx,
            &context.source_event_id,
            &context.id,
            occurrence_date,
        )
        .await?;
        return Ok(());
    }

    null_pomodoro_live_refs_for_event(tx, &context.source_event_id).await?;
    sqlx::query("DELETE FROM calendar_events WHERE id = ?")
        .bind(&context.source_event_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("delete archived calendar event: {e}"))?;
    Ok(())
}
pub(super) async fn load_mutation_context(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    target: &CalendarEventMutationTarget,
) -> Result<CalendarEventMutationContext, String> {
    let (source_event_id, synthetic_date) = split_synthetic_id(&target.id);
    let synthetic = synthetic_date.is_some();
    if synthetic {
        require_non_empty_option(&target.occurrence_start, "occurrence_start")?;
        require_non_empty_option(&target.occurrence_end, "occurrence_end")?;
    }
    let row = sqlx::query(
        "SELECT id, start_time, end_time, rrule, repeat_until
         FROM calendar_events
         WHERE id = ?",
    )
    .bind(source_event_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load calendar event for mutation: {e}"))?;
    let Some(row) = row else {
        return Err(format!("calendar event '{}' not found", source_event_id));
    };

    let stored_start: String = row
        .try_get("start_time")
        .map_err(|e| format!("read event start_time: {e}"))?;
    let stored_end: String = row
        .try_get("end_time")
        .map_err(|e| format!("read event end_time: {e}"))?;
    let rrule: Option<String> = row
        .try_get("rrule")
        .map_err(|e| format!("read event rrule: {e}"))?;
    let repeat_until: Option<String> = row
        .try_get("repeat_until")
        .map_err(|e| format!("read event repeat_until: {e}"))?;
    // Synthetic ids carry the local recurrence date. The occurrence start is
    // UTC and can fall on a different calendar date near midnight.
    let occurrence_date = synthetic_date
        .map(str::to_string)
        .or_else(|| target.occurrence_start.as_deref().and_then(date_part));

    Ok(CalendarEventMutationContext {
        id: target.id.clone(),
        source_event_id: source_event_id.to_string(),
        occurrence_date,
        start_time: target.occurrence_start.clone().unwrap_or(stored_start),
        end_time: target.occurrence_end.clone().unwrap_or(stored_end),
        rrule,
        repeat_until,
        synthetic,
    })
}
pub(super) async fn is_protected_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    context: &CalendarEventMutationContext,
    now: &str,
) -> Result<bool, String> {
    if context.start_time.as_str() <= now {
        return Ok(true);
    }
    event_has_pomodoro_history(tx, context).await
}
pub(super) async fn event_has_pomodoro_history(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    context: &CalendarEventMutationContext,
) -> Result<bool, String> {
    let count: i64 = if context.synthetic {
        let occurrence_date = context
            .occurrence_date
            .as_deref()
            .ok_or_else(|| "synthetic occurrence date is required".to_string())?;
        sqlx::query_scalar(
            "SELECT
                (SELECT COUNT(*)
                 FROM pomodoro_runs
                 WHERE event_id = ?
                   AND (original_event_id = ? OR event_date = ?))
              + (SELECT COUNT(*)
                 FROM pomodoro_segments
                 WHERE event_id = ? AND event_date = ?)",
        )
        .bind(&context.source_event_id)
        .bind(&context.id)
        .bind(occurrence_date)
        .bind(&context.source_event_id)
        .bind(occurrence_date)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("count synthetic pomodoro history: {e}"))?
    } else {
        sqlx::query_scalar(
            "SELECT
                (SELECT COUNT(*)
                 FROM pomodoro_runs
                 WHERE event_id = ? OR original_event_id = ?)
              + (SELECT COUNT(*)
                 FROM pomodoro_segments
                 WHERE event_id = ?)",
        )
        .bind(&context.source_event_id)
        .bind(&context.id)
        .bind(&context.source_event_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("count event pomodoro history: {e}"))?
    };
    Ok(count > 0)
}
pub(super) async fn ensure_no_open_runs_for_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    context: &CalendarEventMutationContext,
) -> Result<(), String> {
    if event_has_open_pomodoro_run(tx, context).await? {
        return Err(format!(
            "calendar event '{}' has an active pomodoro run; stop it before deleting or archiving",
            context.id
        ));
    }
    Ok(())
}
pub(super) async fn event_has_open_pomodoro_run(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    context: &CalendarEventMutationContext,
) -> Result<bool, String> {
    let count: i64 = if context.synthetic {
        let occurrence_date = context
            .occurrence_date
            .as_deref()
            .ok_or_else(|| "synthetic occurrence date is required".to_string())?;
        sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM pomodoro_runs
             WHERE ended_at IS NULL
               AND event_id = ?
               AND (original_event_id = ? OR event_date = ?)",
        )
        .bind(&context.source_event_id)
        .bind(&context.id)
        .bind(occurrence_date)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("count active synthetic pomodoro runs: {e}"))?
    } else {
        sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM pomodoro_runs
             WHERE ended_at IS NULL
               AND (event_id = ? OR original_event_id = ?)",
        )
        .bind(&context.source_event_id)
        .bind(&context.id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("count active pomodoro runs: {e}"))?
    };
    Ok(count > 0)
}
pub(super) async fn ensure_no_open_runs_for_scope(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    calendar_id: Option<&str>,
) -> Result<(), String> {
    let count: i64 = if let Some(calendar_id) = calendar_id {
        sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM pomodoro_runs
             WHERE ended_at IS NULL
               AND event_id IN (
                    SELECT id FROM calendar_events WHERE calendar_id = ?
               )",
        )
        .bind(calendar_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("count active pomodoro runs for calendar: {e}"))?
    } else {
        sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_runs WHERE ended_at IS NULL")
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| format!("count active pomodoro runs: {e}"))?
    };
    if count > 0 {
        return Err(
            "active pomodoro runs must be stopped before clearing or removing calendar events"
                .to_string(),
        );
    }
    Ok(())
}
pub(super) async fn load_event_ids_for_scope(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    calendar_id: Option<&str>,
) -> Result<Vec<String>, String> {
    if let Some(calendar_id) = calendar_id {
        sqlx::query_scalar(
            "SELECT id FROM calendar_events WHERE calendar_id = ? ORDER BY start_time ASC",
        )
        .bind(calendar_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| format!("load calendar event ids: {e}"))
    } else {
        sqlx::query_scalar("SELECT id FROM calendar_events ORDER BY start_time ASC")
            .fetch_all(&mut **tx)
            .await
            .map_err(|e| format!("load calendar event ids: {e}"))
    }
}
pub(super) async fn archive_event_snapshot(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    context: &CalendarEventMutationContext,
    archived_at: &str,
) -> Result<(), String> {
    clear_archive_children(tx, &context.id).await?;
    sqlx::query(
        "INSERT OR REPLACE INTO calendar_events_archive (
            id, source_event_id, archived_at, title, start_time, end_time, timezone,
            calendar_id, color, description, rrule, repeat_until, environment_id,
            playlist_id, all_day, location, url, transparency, status, source_uid,
            visibility, priority, geo_lat, geo_lng, sequence, guest_can_modify,
            guest_can_invite_others, guest_can_see_other_guests, created_at, updated_at,
            icalendar_component_id, local_rsvp_status, meeting_enabled
         )
         SELECT
            ?, ?, ?, title, ?, ?, timezone,
            calendar_id, color, description,
            CASE WHEN ? = 1 THEN NULL ELSE rrule END,
            CASE WHEN ? = 1 THEN NULL ELSE repeat_until END,
            environment_id, playlist_id, all_day, location, url, transparency, status,
            source_uid, visibility, priority, geo_lat, geo_lng, sequence,
            guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
            created_at, updated_at, icalendar_component_id, local_rsvp_status,
            meeting_enabled
         FROM calendar_events
         WHERE id = ?",
    )
    .bind(&context.id)
    .bind(&context.source_event_id)
    .bind(archived_at)
    .bind(&context.start_time)
    .bind(&context.end_time)
    .bind(if context.synthetic { 1_i64 } else { 0_i64 })
    .bind(if context.synthetic { 1_i64 } else { 0_i64 })
    .bind(&context.source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("archive calendar event: {e}"))?;

    copy_archive_children(tx, &context.id, &context.source_event_id).await
}
pub(super) async fn clear_archive_children(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    archive_event_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "DELETE FROM calendar_event_archive_override_extended_properties
         WHERE archive_override_id IN (
            SELECT id FROM calendar_event_archive_overrides WHERE archive_event_id = ?
         )",
    )
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("clear archived override properties: {e}"))?;
    for table in [
        "calendar_event_archive_overrides",
        "calendar_event_archive_alarms",
        "calendar_event_archive_attendees",
        "calendar_event_archive_organizers",
        "calendar_event_archive_extended_properties",
        "calendar_event_archive_categories",
        "calendar_event_archive_rdates",
        "calendar_event_archive_exdates",
        "calendar_event_archive_notifications",
        "calendar_event_archive_pomodoro_config_sequence_steps",
        "calendar_event_archive_pomodoro_config_count_rhythms",
        "calendar_event_archive_pomodoro_configs",
    ] {
        let query = format!("DELETE FROM {table} WHERE archive_event_id = ?");
        sqlx::query(&query)
            .bind(archive_event_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("clear archived {table}: {e}"))?;
    }
    Ok(())
}
pub(super) async fn copy_archive_children(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    archive_event_id: &str,
    source_event_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO calendar_event_archive_pomodoro_configs
            (archive_event_id, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes)
         SELECT ?, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes
         FROM pomodoro_configs
         WHERE event_id = ?",
    )
    .bind(archive_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("archive pomodoro config: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_archive_pomodoro_config_count_rhythms
            (archive_event_id, focus_duration_minutes, short_break_minutes, long_break_minutes,
             long_break_after_focus_count)
         SELECT ?, focus_duration_minutes, short_break_minutes, long_break_minutes,
                long_break_after_focus_count
         FROM pomodoro_config_count_rhythms
         WHERE event_id = ?",
    )
    .bind(archive_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("archive count pomodoro rhythm: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_archive_pomodoro_config_sequence_steps
            (archive_event_id, step_index, focus_duration_minutes, break_phase, break_duration_minutes)
         SELECT ?, step_index, focus_duration_minutes, break_phase, break_duration_minutes
         FROM pomodoro_config_sequence_steps
         WHERE event_id = ?
         ORDER BY step_index ASC",
    )
    .bind(archive_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("archive sequence pomodoro rhythm: {e}"))?;

    for (source_table, archive_table, column) in [
        (
            "calendar_event_notifications",
            "calendar_event_archive_notifications",
            "offset_minutes",
        ),
        (
            "calendar_event_exdates",
            "calendar_event_archive_exdates",
            "occurrence_date",
        ),
        (
            "calendar_event_rdates",
            "calendar_event_archive_rdates",
            "occurrence_start",
        ),
        (
            "calendar_event_categories",
            "calendar_event_archive_categories",
            "category",
        ),
    ] {
        let query = format!(
            "INSERT INTO {archive_table} (id, archive_event_id, {column}, sort_order)
             SELECT lower(hex(randomblob(16))), ?, {column}, sort_order
             FROM {source_table}
             WHERE event_id = ?"
        );
        sqlx::query(&query)
            .bind(archive_event_id)
            .bind(source_event_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("archive {source_table}: {e}"))?;
    }

    sqlx::query(
        "INSERT INTO calendar_event_archive_extended_properties
            (id, archive_event_id, property_key, property_value, sort_order)
         SELECT lower(hex(randomblob(16))), ?, property_key, property_value, sort_order
         FROM calendar_event_extended_properties
         WHERE event_id = ?",
    )
    .bind(archive_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("archive extended properties: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_archive_organizers (archive_event_id, name, email)
         SELECT ?, name, email
         FROM calendar_event_organizers
         WHERE event_id = ?",
    )
    .bind(archive_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("archive organizer: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_archive_attendees
            (id, archive_event_id, source_attendee_id, name, email, role, status,
             rsvp, sort_order, icalendar_component_id, icalendar_property_index)
         SELECT lower(hex(randomblob(16))), ?, id, name, email, role, status,
                rsvp, sort_order, icalendar_component_id, icalendar_property_index
         FROM calendar_event_attendees
         WHERE event_id = ?",
    )
    .bind(archive_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("archive attendees: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_archive_alarms
            (id, archive_event_id, source_alarm_id, action, trigger_type,
             trigger_value, description, sort_order, icalendar_component_id)
         SELECT lower(hex(randomblob(16))), ?, id, action, trigger_type,
                trigger_value, description, sort_order, icalendar_component_id
         FROM calendar_event_alarms
         WHERE event_id = ?",
    )
    .bind(archive_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("archive alarms: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_archive_overrides
            (id, archive_event_id, source_override_id, recurrence_id, title,
             start_time, end_time, description, location, url, color, status,
             transparency, visibility, created_at, updated_at, icalendar_component_id,
             recurrence_range)
         SELECT lower(hex(randomblob(16))), ?, id, recurrence_id, title,
                start_time, end_time, description, location, url, color, status,
                transparency, visibility, created_at, updated_at, icalendar_component_id,
                recurrence_range
         FROM calendar_event_overrides
         WHERE parent_event_id = ?",
    )
    .bind(archive_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("archive overrides: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_archive_override_extended_properties
            (id, archive_override_id, property_key, property_value, sort_order)
         SELECT lower(hex(randomblob(16))), archive_override.id, source.property_key,
                source.property_value, source.sort_order
         FROM calendar_event_override_extended_properties source
         JOIN calendar_event_archive_overrides archive_override
           ON archive_override.archive_event_id = ?
          AND archive_override.source_override_id = source.override_id",
    )
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("archive override extended properties: {e}"))?;

    Ok(())
}
pub(super) async fn add_exdate(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
    occurrence_date: &str,
    updated_at: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT OR IGNORE INTO calendar_event_exdates
            (id, event_id, occurrence_date, sort_order)
         SELECT lower(hex(randomblob(16))), ?, ?, COALESCE(MAX(sort_order) + 1, 0)
         FROM calendar_event_exdates
         WHERE event_id = ?",
    )
    .bind(event_id)
    .bind(occurrence_date)
    .bind(event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("add recurring exception date: {e}"))?;

    sqlx::query("UPDATE calendar_events SET updated_at = ? WHERE id = ?")
        .bind(updated_at)
        .bind(event_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("touch recurring parent: {e}"))?;
    Ok(())
}
pub(super) async fn null_pomodoro_live_refs_for_synthetic(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source_event_id: &str,
    exact_event_id: &str,
    occurrence_date: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE pomodoro_runs
         SET event_id = NULL
         WHERE event_id = ?
           AND (original_event_id = ? OR event_date = ?)",
    )
    .bind(source_event_id)
    .bind(exact_event_id)
    .bind(occurrence_date)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("clear archived synthetic run references: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET event_id = NULL
         WHERE event_id = ? AND event_date = ?",
    )
    .bind(source_event_id)
    .bind(occurrence_date)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("clear archived synthetic segment references: {e}"))?;
    Ok(())
}
pub(super) async fn null_pomodoro_live_refs_for_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
) -> Result<(), String> {
    sqlx::query("UPDATE pomodoro_runs SET event_id = NULL WHERE event_id = ?")
        .bind(event_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("clear archived run references: {e}"))?;
    sqlx::query("UPDATE pomodoro_segments SET event_id = NULL WHERE event_id = ?")
        .bind(event_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("clear archived segment references: {e}"))?;
    Ok(())
}
