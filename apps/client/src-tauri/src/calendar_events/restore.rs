use sqlx::Row;

use super::ids::{date_part, split_synthetic_id};
use super::time::current_utc_iso;
use super::types::CalendarEventMutationTarget;

pub(super) async fn restore_archived_calendar_event_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    target: &CalendarEventMutationTarget,
) -> Result<(), String> {
    let row = sqlx::query(
        "SELECT source_event_id, calendar_id, start_time
         FROM calendar_events_archive
         WHERE id = ?",
    )
    .bind(&target.id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load archived calendar event: {e}"))?;
    let Some(row) = row else {
        return Err(format!("archived calendar event '{}' not found", target.id));
    };

    let source_event_id: String = row
        .try_get("source_event_id")
        .map_err(|e| format!("read archived source_event_id: {e}"))?;
    let calendar_id: String = row
        .try_get("calendar_id")
        .map_err(|e| format!("read archived calendar_id: {e}"))?;
    let start_time: String = row
        .try_get("start_time")
        .map_err(|e| format!("read archived start_time: {e}"))?;

    if target.id == source_event_id {
        restore_archived_event_row(tx, &target.id, &source_event_id, &calendar_id).await?;
        restore_archived_event_children(tx, &target.id, &source_event_id).await?;
        relink_pomodoro_refs_for_restored_event(tx, &source_event_id, &target.id).await?;
    } else {
        restore_archived_synthetic_occurrence(tx, &target.id, &source_event_id, &start_time)
            .await?;
    }

    sqlx::query("DELETE FROM calendar_events_archive WHERE id = ?")
        .bind(&target.id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("delete restored archive row: {e}"))?;
    Ok(())
}
pub(super) async fn restore_archived_event_row(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    archive_event_id: &str,
    source_event_id: &str,
    calendar_id: &str,
) -> Result<(), String> {
    let calendar_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM calendars WHERE id = ?")
        .bind(calendar_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("check archived calendar: {e}"))?;
    if calendar_exists == 0 {
        return Err(format!(
            "calendar '{}' no longer exists; cannot restore archived event",
            calendar_id
        ));
    }

    let live_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = ?")
        .bind(source_event_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("check restored event conflict: {e}"))?;
    if live_exists > 0 {
        return Err(format!(
            "calendar event '{}' already exists; cannot restore archive",
            source_event_id
        ));
    }

    sqlx::query(
        "INSERT INTO calendar_events (
            id, title, start_time, end_time, timezone, calendar_id,
            color, description, rrule, repeat_until, environment_id, playlist_id,
            all_day, location, url, transparency, status, source_uid, visibility,
            priority, geo_lat, geo_lng, sequence, guest_can_modify,
            guest_can_invite_others, guest_can_see_other_guests, created_at, updated_at,
            icalendar_component_id, local_rsvp_status, meeting_enabled
         )
         SELECT
            source_event_id, title, start_time, end_time, timezone, calendar_id,
            color, description, rrule, repeat_until, environment_id, playlist_id,
            all_day, location, url, transparency, status, source_uid, visibility,
            priority, geo_lat, geo_lng, sequence, guest_can_modify,
            guest_can_invite_others, guest_can_see_other_guests, created_at, updated_at,
            icalendar_component_id, local_rsvp_status, meeting_enabled
         FROM calendar_events_archive
         WHERE id = ?",
    )
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived calendar event: {e}"))?;
    Ok(())
}
pub(super) async fn restore_archived_event_children(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    archive_event_id: &str,
    source_event_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pomodoro_configs
            (event_id, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes)
         SELECT ?, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes
         FROM calendar_event_archive_pomodoro_configs
         WHERE archive_event_id = ?",
    )
    .bind(source_event_id)
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived pomodoro config: {e}"))?;

    sqlx::query(
        "INSERT INTO pomodoro_config_count_rhythms
            (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes,
             long_break_after_focus_count)
         SELECT ?, focus_duration_minutes, short_break_minutes, long_break_minutes,
                long_break_after_focus_count
         FROM calendar_event_archive_pomodoro_config_count_rhythms
         WHERE archive_event_id = ?",
    )
    .bind(source_event_id)
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived count pomodoro rhythm: {e}"))?;

    sqlx::query(
        "INSERT INTO pomodoro_config_sequence_steps
            (event_id, step_index, focus_duration_minutes, break_phase, break_duration_minutes)
         SELECT ?, step_index, focus_duration_minutes, break_phase, break_duration_minutes
         FROM calendar_event_archive_pomodoro_config_sequence_steps
         WHERE archive_event_id = ?
         ORDER BY step_index ASC",
    )
    .bind(source_event_id)
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived sequence pomodoro rhythm: {e}"))?;

    for (archive_table, live_table, column) in [
        (
            "calendar_event_archive_notifications",
            "calendar_event_notifications",
            "offset_minutes",
        ),
        (
            "calendar_event_archive_exdates",
            "calendar_event_exdates",
            "occurrence_date",
        ),
        (
            "calendar_event_archive_rdates",
            "calendar_event_rdates",
            "occurrence_start",
        ),
        (
            "calendar_event_archive_categories",
            "calendar_event_categories",
            "category",
        ),
    ] {
        let query = format!(
            "INSERT INTO {live_table} (id, event_id, {column}, sort_order)
             SELECT lower(hex(randomblob(16))), ?, {column}, sort_order
             FROM {archive_table}
             WHERE archive_event_id = ?"
        );
        sqlx::query(&query)
            .bind(source_event_id)
            .bind(archive_event_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("restore archived {live_table}: {e}"))?;
    }

    sqlx::query(
        "INSERT INTO calendar_event_extended_properties
            (id, event_id, property_key, property_value, sort_order)
         SELECT lower(hex(randomblob(16))), ?, property_key, property_value, sort_order
         FROM calendar_event_archive_extended_properties
         WHERE archive_event_id = ?",
    )
    .bind(source_event_id)
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived extended properties: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_organizers (event_id, name, email)
         SELECT ?, name, email
         FROM calendar_event_archive_organizers
         WHERE archive_event_id = ?",
    )
    .bind(source_event_id)
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived organizer: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_attendees
            (id, event_id, name, email, role, status, rsvp, sort_order,
             icalendar_component_id, icalendar_property_index)
         SELECT source_attendee_id, ?, name, email, role, status, rsvp, sort_order,
                icalendar_component_id, icalendar_property_index
         FROM calendar_event_archive_attendees
         WHERE archive_event_id = ?",
    )
    .bind(source_event_id)
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived attendees: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_alarms
            (id, event_id, action, trigger_type, trigger_value, description,
             sort_order, icalendar_component_id)
         SELECT source_alarm_id, ?, action, trigger_type, trigger_value, description,
                sort_order, icalendar_component_id
         FROM calendar_event_archive_alarms
         WHERE archive_event_id = ?",
    )
    .bind(source_event_id)
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived alarms: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_overrides
            (id, parent_event_id, recurrence_id, title, start_time, end_time,
             description, location, url, color, status, transparency, visibility,
             created_at, updated_at, icalendar_component_id, recurrence_range)
         SELECT source_override_id, ?, recurrence_id, title, start_time, end_time,
                description, location, url, color, status, transparency, visibility,
                created_at, updated_at, icalendar_component_id, recurrence_range
         FROM calendar_event_archive_overrides
         WHERE archive_event_id = ?",
    )
    .bind(source_event_id)
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived overrides: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_override_extended_properties
            (id, override_id, property_key, property_value, sort_order)
         SELECT lower(hex(randomblob(16))), archive_override.source_override_id,
                source.property_key, source.property_value, source.sort_order
         FROM calendar_event_archive_override_extended_properties source
         JOIN calendar_event_archive_overrides archive_override
           ON archive_override.id = source.archive_override_id
         WHERE archive_override.archive_event_id = ?",
    )
    .bind(archive_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived override extended properties: {e}"))?;

    Ok(())
}
pub(super) async fn restore_archived_synthetic_occurrence(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    archive_event_id: &str,
    source_event_id: &str,
    start_time: &str,
) -> Result<(), String> {
    let parent_exists: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = ?")
            .bind(source_event_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| format!("check recurring parent: {e}"))?;
    if parent_exists == 0 {
        return Err(format!(
            "calendar event '{}' no longer exists; cannot restore archived occurrence",
            source_event_id
        ));
    }

    let occurrence_date = split_synthetic_id(archive_event_id)
        .1
        .map(str::to_string)
        .or_else(|| date_part(start_time))
        .ok_or_else(|| "archived occurrence date is required".to_string())?;

    sqlx::query(
        "DELETE FROM calendar_event_exdates
         WHERE event_id = ? AND occurrence_date = ?",
    )
    .bind(source_event_id)
    .bind(&occurrence_date)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore recurring exception date: {e}"))?;

    let restored_at = current_utc_iso(tx).await?;
    sqlx::query("UPDATE calendar_events SET updated_at = ? WHERE id = ?")
        .bind(restored_at)
        .bind(source_event_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("touch restored recurring parent: {e}"))?;

    relink_pomodoro_refs_for_restored_synthetic(
        tx,
        source_event_id,
        archive_event_id,
        &occurrence_date,
    )
    .await
}
pub(super) async fn relink_pomodoro_refs_for_restored_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
    original_event_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE pomodoro_runs
         SET event_id = ?
         WHERE event_id IS NULL AND original_event_id = ?",
    )
    .bind(event_id)
    .bind(original_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived run references: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET event_id = ?
         WHERE event_id IS NULL
           AND run_id IN (
                SELECT id FROM pomodoro_runs
                WHERE event_id = ? AND original_event_id = ?
           )",
    )
    .bind(event_id)
    .bind(event_id)
    .bind(original_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived segment references: {e}"))?;
    Ok(())
}
pub(super) async fn relink_pomodoro_refs_for_restored_synthetic(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source_event_id: &str,
    exact_event_id: &str,
    occurrence_date: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE pomodoro_runs
         SET event_id = ?
         WHERE event_id IS NULL
           AND (
                original_event_id = ?
                OR (original_event_id = ? AND event_date = ?)
           )",
    )
    .bind(source_event_id)
    .bind(exact_event_id)
    .bind(source_event_id)
    .bind(occurrence_date)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived synthetic run references: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET event_id = ?
         WHERE event_id IS NULL
           AND run_id IN (
                SELECT id FROM pomodoro_runs
                WHERE event_id = ?
                  AND (
                    original_event_id = ?
                    OR (original_event_id = ? AND event_date = ?)
                  )
           )",
    )
    .bind(source_event_id)
    .bind(source_event_id)
    .bind(exact_event_id)
    .bind(source_event_id)
    .bind(occurrence_date)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("restore archived synthetic segment references: {e}"))?;
    Ok(())
}
