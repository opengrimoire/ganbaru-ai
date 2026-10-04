use sqlx::Row;

use crate::calendar_description::sanitize_optional_calendar_description;

use super::archive::{event_has_open_pomodoro_run, is_protected_event, load_mutation_context};
use super::children::{
    apply_update_field, copy_calendar_metadata, copy_pomodoro_config, insert_pomodoro_config,
    parse_i64_list, parse_string_list, replace_i64_list, replace_pomodoro_config,
    replace_string_list, sanitize_stored_event_description,
};
use super::time::{calendar_timestamp_millis, calendar_timestamps_match, current_utc_iso};
use super::types::{
    CalendarDetachInstance, CalendarEventMutationContext, CalendarEventMutationTarget,
    CalendarEventUpdate, CalendarEventUpdateField, CalendarPomodoroConfigPatch,
    CalendarSplitSeries,
};
use super::validation::{validate_detach_instance, validate_event_update, validate_split_series};

pub(super) async fn update_calendar_event_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    patch: &CalendarEventUpdate,
) -> Result<(), String> {
    ensure_calendar_event_update_allowed(tx, patch).await?;
    update_calendar_event_unchecked_tx(tx, patch).await
}
pub(super) async fn update_calendar_event_unchecked_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    patch: &CalendarEventUpdate,
) -> Result<(), String> {
    validate_event_update(patch)?;
    ensure_update_pomodoro_matches_all_day(tx, patch).await?;
    let music_updated_at = calendar_timestamp_millis(&patch.updated_at)
        .ok_or_else(|| "updated_at must be a valid calendar timestamp".to_string())?;
    for field in &patch.fields {
        match field {
            CalendarEventUpdateField::MusicSnapshotAssignments(assignments) => {
                crate::music_context::replace_assignments_in_transaction(
                    tx,
                    crate::music_context::MusicAssignmentOwnerKind::EventSnapshot,
                    &patch.id,
                    assignments.clone(),
                    music_updated_at,
                )
                .await
                .map_err(|error| error.to_string())?;
            }
            CalendarEventUpdateField::MusicOverrideAssignments(assignments) => {
                crate::music_context::replace_assignments_in_transaction(
                    tx,
                    crate::music_context::MusicAssignmentOwnerKind::EventOverride,
                    &patch.id,
                    assignments.clone(),
                    music_updated_at,
                )
                .await
                .map_err(|error| error.to_string())?;
            }
            _ => apply_update_field(tx, &patch.id, field).await?,
        }
    }

    if let Some(attendees) = &patch.attendees {
        sqlx::query("DELETE FROM calendar_event_attendees WHERE event_id = ?")
            .bind(&patch.id)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("delete calendar attendees: {e}"))?;
        for (sort_order, attendee) in attendees.iter().enumerate() {
            sqlx::query(
                "INSERT INTO calendar_event_attendees
                   (id, event_id, name, email, role, status, rsvp, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&attendee.id)
            .bind(&patch.id)
            .bind(&attendee.name)
            .bind(&attendee.email)
            .bind(&attendee.role)
            .bind(&attendee.status)
            .bind(if attendee.rsvp { 1_i64 } else { 0_i64 })
            .bind(sort_order as i64)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("insert calendar attendee: {e}"))?;
        }
    }

    if let Some(alarms) = &patch.alarms {
        sqlx::query("DELETE FROM calendar_event_alarms WHERE event_id = ?")
            .bind(&patch.id)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("delete calendar alarms: {e}"))?;
        for (sort_order, alarm) in alarms.iter().enumerate() {
            sqlx::query(
                "INSERT INTO calendar_event_alarms
                   (id, event_id, action, trigger_type, trigger_value, description, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&alarm.id)
            .bind(&patch.id)
            .bind(&alarm.action)
            .bind(&alarm.trigger_type)
            .bind(&alarm.trigger_value)
            .bind(&alarm.description)
            .bind(sort_order as i64)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("insert calendar alarm: {e}"))?;
        }
    }

    if let Some(config_patch) = &patch.pomodoro_config {
        match config_patch {
            CalendarPomodoroConfigPatch::Set(config) => {
                replace_pomodoro_config(tx, &patch.id, config).await?;
            }
            CalendarPomodoroConfigPatch::Clear => {
                sqlx::query("DELETE FROM pomodoro_configs WHERE event_id = ?")
                    .bind(&patch.id)
                    .execute(&mut **tx)
                    .await
                    .map_err(|e| format!("delete calendar pomodoro config: {e}"))?;
            }
        }
    }

    let result = sqlx::query("UPDATE calendar_events SET updated_at = ? WHERE id = ?")
        .bind(&patch.updated_at)
        .bind(&patch.id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("touch calendar event: {e}"))?;
    if result.rows_affected() == 0 {
        return Err(format!("calendar event '{}' not found", patch.id));
    }
    Ok(())
}
pub(super) async fn ensure_update_pomodoro_matches_all_day(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    patch: &CalendarEventUpdate,
) -> Result<(), String> {
    let row = sqlx::query(
        "SELECT all_day,
                EXISTS(SELECT 1 FROM pomodoro_configs WHERE event_id = calendar_events.id) AS has_pomodoro_config
         FROM calendar_events
         WHERE id = ?",
    )
    .bind(&patch.id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load calendar event for invariant check: {e}"))?;
    let Some(row) = row else {
        return Err(format!("calendar event '{}' not found", patch.id));
    };

    let existing_all_day: i64 = row
        .try_get("all_day")
        .map_err(|e| format!("read all_day for invariant check: {e}"))?;
    let existing_has_pomodoro: i64 = row
        .try_get("has_pomodoro_config")
        .map_err(|e| format!("read pomodoro config state for invariant check: {e}"))?;

    let final_all_day = patch_all_day_value(&patch.fields).unwrap_or(existing_all_day != 0);
    let final_has_pomodoro = match &patch.pomodoro_config {
        Some(CalendarPomodoroConfigPatch::Set(_)) => true,
        Some(CalendarPomodoroConfigPatch::Clear) => false,
        None => existing_has_pomodoro != 0,
    };

    if final_all_day && final_has_pomodoro {
        return Err("all-day events cannot have a pomodoro config".to_string());
    }
    Ok(())
}

async fn replace_event_music_assignments(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
    snapshots: Vec<crate::music_context::MusicContextAssignmentDraft>,
    overrides: Vec<crate::music_context::MusicContextAssignmentDraft>,
    updated_at: &str,
) -> Result<(), String> {
    let updated_at = calendar_timestamp_millis(updated_at)
        .ok_or_else(|| "music assignment timestamp is invalid".to_string())?;
    crate::music_context::replace_assignments_in_transaction(
        tx,
        crate::music_context::MusicAssignmentOwnerKind::EventSnapshot,
        event_id,
        snapshots,
        updated_at,
    )
    .await
    .map_err(|error| error.to_string())?;
    crate::music_context::replace_assignments_in_transaction(
        tx,
        crate::music_context::MusicAssignmentOwnerKind::EventOverride,
        event_id,
        overrides,
        updated_at,
    )
    .await
    .map_err(|error| error.to_string())
}
pub(super) fn patch_all_day_value(fields: &[CalendarEventUpdateField]) -> Option<bool> {
    fields.iter().rev().find_map(|field| match field {
        CalendarEventUpdateField::AllDay(value) => Some(*value),
        _ => None,
    })
}
pub(super) async fn ensure_calendar_event_update_allowed(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    patch: &CalendarEventUpdate,
) -> Result<(), String> {
    let target = CalendarEventMutationTarget {
        id: patch.id.clone(),
    };
    let now = current_utc_iso(tx).await?;
    let context = load_mutation_context(tx, &target).await?;
    if !is_protected_event(tx, &context, &now).await? {
        return Ok(());
    }
    if event_has_open_pomodoro_run(tx, &context).await? {
        return Ok(());
    }
    if protected_active_event_pomodoro_enable_allowed(patch, &context, &now) {
        return Ok(());
    }
    if protected_active_event_end_update_allowed(patch, &context, &now) {
        return Ok(());
    }
    if protected_active_event_update_allowed(tx, patch, &context, &now).await? {
        return Ok(());
    }
    Err(format!(
        "calendar event '{}' is protected; archive it instead",
        context.id
    ))
}
pub(super) fn protected_active_event_pomodoro_enable_allowed(
    patch: &CalendarEventUpdate,
    context: &CalendarEventMutationContext,
    now: &str,
) -> bool {
    if !protected_event_is_active_at(context, now) {
        return false;
    }
    patch.fields.is_empty()
        && patch.attendees.is_none()
        && patch.alarms.is_none()
        && matches!(
            patch.pomodoro_config,
            Some(CalendarPomodoroConfigPatch::Set(_))
        )
}
pub(super) fn protected_active_event_end_update_allowed(
    patch: &CalendarEventUpdate,
    context: &CalendarEventMutationContext,
    now: &str,
) -> bool {
    if !protected_event_is_active_at(context, now) {
        return false;
    }
    if patch.attendees.is_some() || patch.alarms.is_some() || patch.pomodoro_config.is_some() {
        return false;
    }
    let [CalendarEventUpdateField::EndTime(end_time)] = patch.fields.as_slice() else {
        return false;
    };
    let Some(start_ms) = calendar_timestamp_millis(&context.start_time) else {
        return false;
    };
    let Some(now_ms) = calendar_timestamp_millis(now) else {
        return false;
    };
    let Some(new_end_ms) = calendar_timestamp_millis(end_time) else {
        return false;
    };
    start_ms <= new_end_ms && new_end_ms <= now_ms
}
pub(super) async fn protected_active_event_update_allowed(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    patch: &CalendarEventUpdate,
    context: &CalendarEventMutationContext,
    now: &str,
) -> Result<bool, String> {
    if context.synthetic || !protected_event_is_active_at(context, now) {
        return Ok(false);
    }
    active_event_update_fields_allowed(tx, patch, context).await
}
pub(super) async fn active_event_update_fields_allowed(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    patch: &CalendarEventUpdate,
    context: &CalendarEventMutationContext,
) -> Result<bool, String> {
    for field in &patch.fields {
        if !active_event_update_field_allowed(tx, field, context).await? {
            return Ok(false);
        }
    }
    Ok(true)
}
pub(super) async fn active_event_update_field_allowed(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    field: &CalendarEventUpdateField,
    context: &CalendarEventMutationContext,
) -> Result<bool, String> {
    match field {
        CalendarEventUpdateField::StartTime(value) => {
            Ok(calendar_timestamps_match(value, &context.start_time))
        }
        CalendarEventUpdateField::AllDay(value) => Ok(!*value),
        CalendarEventUpdateField::EndTime(value) => {
            let Some(start_ms) = calendar_timestamp_millis(&context.start_time) else {
                return Ok(false);
            };
            let Some(end_ms) = calendar_timestamp_millis(value) else {
                return Ok(false);
            };
            Ok(start_ms <= end_ms)
        }
        CalendarEventUpdateField::Rrule(value) => Ok(value == &context.rrule),
        CalendarEventUpdateField::RepeatUntil(value) => Ok(value == &context.repeat_until),
        CalendarEventUpdateField::Exceptions(value) => {
            stored_string_list_matches(
                tx,
                &context.source_event_id,
                "calendar_event_exdates",
                "occurrence_date",
                value,
                "exceptions",
            )
            .await
        }
        CalendarEventUpdateField::Rdate(value) => {
            stored_string_list_matches(
                tx,
                &context.source_event_id,
                "calendar_event_rdates",
                "occurrence_start",
                value,
                "rdate",
            )
            .await
        }
        _ => Ok(true),
    }
}
pub(super) async fn stored_string_list_matches(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
    table: &'static str,
    column: &'static str,
    value: &Option<String>,
    field: &str,
) -> Result<bool, String> {
    let incoming = parse_string_list(value, field)?;
    let query = format!("SELECT {column} FROM {table} WHERE event_id = ? ORDER BY sort_order ASC");
    let stored = sqlx::query_scalar::<_, String>(&query)
        .bind(event_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| format!("load calendar {table}: {e}"))?;
    Ok(incoming == stored)
}
pub(super) fn protected_event_is_active_at(
    context: &CalendarEventMutationContext,
    now: &str,
) -> bool {
    let Some(start_ms) = calendar_timestamp_millis(&context.start_time) else {
        return false;
    };
    let Some(current_end_ms) = calendar_timestamp_millis(&context.end_time) else {
        return false;
    };
    let Some(now_ms) = calendar_timestamp_millis(now) else {
        return false;
    };
    if !(start_ms <= now_ms && now_ms < current_end_ms) {
        return false;
    }
    true
}
pub(super) async fn detach_calendar_instance_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    input: &CalendarDetachInstance,
) -> Result<(), String> {
    validate_detach_instance(input)?;
    replace_string_list(
        tx,
        &input.parent_id,
        "calendar_event_exdates",
        "occurrence_date",
        parse_string_list(&Some(input.exceptions.clone()), "exceptions")?,
    )
    .await?;
    let result = sqlx::query("UPDATE calendar_events SET updated_at = ? WHERE id = ?")
        .bind(&input.now)
        .bind(&input.parent_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("touch detached parent: {e}"))?;
    if result.rows_affected() == 0 {
        return Err(format!("calendar event '{}' not found", input.parent_id));
    }

    sqlx::query(
        "INSERT INTO calendar_events (
           id, title, start_time, end_time, timezone, calendar_id,
           project_id, environment_id, playlist_id, color, rrule, repeat_until,
           all_day, location, transparency, status,
           source_uid,
           description, url, visibility, priority, geo_lat, geo_lng,
           sequence,
           meeting_enabled, local_rsvp_status,
           guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
           created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, NULL, NULL,
                ?, ?, ?, ?,
                NULL,
                description, url, visibility, priority, geo_lat, geo_lng,
                sequence,
                meeting_enabled, local_rsvp_status,
                guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
                ?, ?
         FROM calendar_events WHERE id = ?",
    )
    .bind(&input.new_id)
    .bind(&input.title)
    .bind(&input.start_time)
    .bind(&input.end_time)
    .bind(&input.timezone)
    .bind(&input.calendar_id)
    .bind(&input.project_id)
    .bind(&input.environment_id)
    .bind(&input.playlist_id)
    .bind(input.color)
    .bind(if input.all_day { 1_i64 } else { 0_i64 })
    .bind(&input.location)
    .bind(&input.transparency)
    .bind(&input.status)
    .bind(&input.now)
    .bind(&input.now)
    .bind(&input.parent_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert detached event: {e}"))?;
    sanitize_stored_event_description(tx, &input.new_id).await?;
    replace_i64_list(
        tx,
        &input.new_id,
        "calendar_event_notifications",
        "offset_minutes",
        parse_i64_list(&input.notifications, "notifications")?,
    )
    .await?;
    copy_calendar_metadata(tx, &input.parent_id, &input.new_id).await?;

    if !input.all_day {
        copy_pomodoro_config(tx, &input.parent_id, &input.new_id).await?;
    }
    replace_event_music_assignments(
        tx,
        &input.new_id,
        input.music_snapshot_assignments.clone(),
        input.music_override_assignments.clone(),
        &input.now,
    )
    .await?;

    let original_occurrence_id = format!("{}::{}", input.parent_id, input.instance_date);
    sqlx::query(
        "UPDATE pomodoro_runs
         SET event_id = ?, original_event_id = ?
         WHERE event_id = ?
           AND (original_event_id = ? OR event_date = ?)",
    )
    .bind(&input.new_id)
    .bind(&input.new_id)
    .bind(&input.parent_id)
    .bind(&original_occurrence_id)
    .bind(&input.instance_date)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("move detached pomodoro runs: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments SET event_id = ?
         WHERE event_id = ? AND event_date = ?",
    )
    .bind(&input.new_id)
    .bind(&input.parent_id)
    .bind(&input.instance_date)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("move detached pomodoro segments: {e}"))?;
    Ok(())
}
pub(super) async fn split_calendar_series_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    input: &CalendarSplitSeries,
) -> Result<(), String> {
    validate_split_series(input)?;
    let description_patch = sanitize_optional_calendar_description(&input.description_patch);
    let result = sqlx::query(
        "UPDATE calendar_events SET repeat_until = ?, rrule = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&input.day_before)
    .bind(&input.capped_rrule)
    .bind(&input.now)
    .bind(&input.parent_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("cap split parent series: {e}"))?;
    if result.rows_affected() == 0 {
        return Err(format!("calendar event '{}' not found", input.parent_id));
    }

    sqlx::query(
        "INSERT INTO calendar_events (
           id, title, start_time, end_time, timezone, calendar_id,
           project_id, environment_id, playlist_id, color, rrule, repeat_until,
           all_day, location, transparency, status,
           source_uid,
           description, url, visibility, priority, geo_lat, geo_lng,
           sequence,
           meeting_enabled, local_rsvp_status,
           guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
           created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, NULL,
                ?, ?, ?, ?,
                NULL,
                COALESCE(?, description),
                COALESCE(?, url),
                visibility, priority, geo_lat, geo_lng,
                sequence,
                ?,
                ?,
                guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
                ?, ?
         FROM calendar_events WHERE id = ?",
    )
    .bind(&input.new_id)
    .bind(&input.title)
    .bind(&input.start_time)
    .bind(&input.end_time)
    .bind(&input.timezone)
    .bind(&input.calendar_id)
    .bind(&input.project_id)
    .bind(&input.environment_id)
    .bind(&input.playlist_id)
    .bind(input.color)
    .bind(&input.rrule)
    .bind(if input.all_day { 1_i64 } else { 0_i64 })
    .bind(&input.location)
    .bind(&input.transparency)
    .bind(&input.status)
    .bind(&description_patch)
    .bind(&input.url_patch)
    .bind(if input.meeting_enabled { 1_i64 } else { 0_i64 })
    .bind(&input.local_rsvp_status)
    .bind(&input.now)
    .bind(&input.now)
    .bind(&input.parent_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert split series event: {e}"))?;
    sanitize_stored_event_description(tx, &input.new_id).await?;
    replace_event_music_assignments(
        tx,
        &input.new_id,
        input.music_snapshot_assignments.clone(),
        input.music_override_assignments.clone(),
        &input.now,
    )
    .await?;
    replace_i64_list(
        tx,
        &input.new_id,
        "calendar_event_notifications",
        "offset_minutes",
        parse_i64_list(&input.notifications, "notifications")?,
    )
    .await?;
    replace_string_list(
        tx,
        &input.new_id,
        "calendar_event_exdates",
        "occurrence_date",
        parse_string_list(&input.exceptions, "exceptions")?,
    )
    .await?;
    copy_calendar_metadata(tx, &input.parent_id, &input.new_id).await?;

    if let Some(config) = &input.pomodoro_config {
        insert_pomodoro_config(tx, &input.new_id, config).await?;
    } else if input.copy_pomodoro_config {
        copy_pomodoro_config(tx, &input.parent_id, &input.new_id).await?;
    }
    Ok(())
}
