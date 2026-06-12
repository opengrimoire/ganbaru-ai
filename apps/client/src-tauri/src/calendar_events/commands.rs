use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

use super::archive::{
    apply_delete_archive_operations_tx, archive_calendar_event_tx,
    archive_or_delete_calendar_events_for_calendar, delete_calendar_event_tx,
};
use super::children::{
    insert_calendar_event_row, insert_pomodoro_config, parse_i64_list, parse_organizer,
    parse_string_list, parse_string_map, replace_extended_properties, replace_i64_list,
    replace_organizer, replace_string_list,
};
use super::restore::restore_archived_calendar_event_tx;
use super::types::{
    CalendarDeleteArchiveOperation, CalendarDetachInstance, CalendarEventCreate,
    CalendarEventMutationTarget, CalendarEventUpdate, CalendarEventUpdateField,
    CalendarRecurrenceCommitOperation, CalendarSplitSeries,
};
use super::validation::{
    validate_delete_archive_operation, validate_detach_instance, validate_event_create,
    validate_event_update, validate_mutation_target, validate_recurrence_commit_operation,
    validate_split_series,
};
use super::writes::{
    apply_recurrence_commit_operations_tx, detach_calendar_instance_tx, split_calendar_series_tx,
    update_calendar_event_tx,
};

#[tauri::command]
pub async fn calendar_add_event<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    event: CalendarEventCreate,
) -> Result<(), String> {
    validate_event_create(&event)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;

    insert_calendar_event_row(&mut tx, &event).await?;
    replace_i64_list(
        &mut tx,
        &event.id,
        "calendar_event_notifications",
        "offset_minutes",
        parse_i64_list(&event.notifications, "notifications")?,
    )
    .await?;
    replace_string_list(
        &mut tx,
        &event.id,
        "calendar_event_exdates",
        "occurrence_date",
        parse_string_list(&event.exceptions, "exceptions")?,
    )
    .await?;
    replace_string_list(
        &mut tx,
        &event.id,
        "calendar_event_rdates",
        "occurrence_start",
        parse_string_list(&event.rdate, "rdate")?,
    )
    .await?;
    replace_string_list(
        &mut tx,
        &event.id,
        "calendar_event_categories",
        "category",
        parse_string_list(&event.categories, "categories")?,
    )
    .await?;
    replace_extended_properties(
        &mut tx,
        &event.id,
        "calendar_event_extended_properties",
        "event_id",
        parse_string_map(&event.extended_properties, "extended_properties")?,
    )
    .await?;
    replace_organizer(&mut tx, &event.id, parse_organizer(&event.organizer)?).await?;

    if let Some(config) = &event.pomodoro_config {
        insert_pomodoro_config(&mut tx, &event.id, config).await?;
    }

    for (sort_order, attendee) in event.attendees.iter().enumerate() {
        sqlx::query(
            "INSERT INTO calendar_event_attendees
               (id, event_id, name, email, role, status, rsvp, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&attendee.id)
        .bind(&event.id)
        .bind(&attendee.name)
        .bind(&attendee.email)
        .bind(&attendee.role)
        .bind(&attendee.status)
        .bind(if attendee.rsvp { 1_i64 } else { 0_i64 })
        .bind(sort_order as i64)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert calendar attendee: {e}"))?;
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn calendar_delete_event<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    target: CalendarEventMutationTarget,
) -> Result<(), String> {
    validate_mutation_target(&target)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    delete_calendar_event_tx(&mut tx, &target).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn calendar_archive_event<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    target: CalendarEventMutationTarget,
) -> Result<(), String> {
    validate_mutation_target(&target)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    archive_calendar_event_tx(&mut tx, &target).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn calendar_apply_delete_archive_plan<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    operations: Vec<CalendarDeleteArchiveOperation>,
) -> Result<(), String> {
    for operation in &operations {
        validate_delete_archive_operation(operation)?;
    }

    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    apply_delete_archive_operations_tx(&mut tx, operations).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn calendar_apply_recurrence_commit_plan<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    operations: Vec<CalendarRecurrenceCommitOperation>,
) -> Result<(), String> {
    for operation in &operations {
        validate_recurrence_commit_operation(operation)?;
    }

    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    apply_recurrence_commit_operations_tx(&mut tx, operations).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn calendar_restore_archived_event<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    target: CalendarEventMutationTarget,
) -> Result<(), String> {
    validate_mutation_target(&target)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    restore_archived_calendar_event_tx(&mut tx, &target).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn calendar_clear_events<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<(), String> {
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    archive_or_delete_calendar_events_for_calendar(&mut tx, None).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn calendar_update_event<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    patch: CalendarEventUpdate,
) -> Result<(), String> {
    validate_event_update(&patch)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    if let Err(err) = update_calendar_event_tx(&mut tx, &patch).await {
        let field_names = patch
            .fields
            .iter()
            .map(CalendarEventUpdateField::field_name)
            .collect::<Vec<_>>()
            .join(",");
        eprintln!(
            "[calendar_update_event] failed id={} fields=[{}] attendees={} alarms={} pomodoro_config={} error={}",
            patch.id,
            field_names,
            patch.attendees.is_some(),
            patch.alarms.is_some(),
            patch.pomodoro_config.is_some(),
            err,
        );
        return Err(err);
    }
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn calendar_detach_instance<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    input: CalendarDetachInstance,
) -> Result<(), String> {
    validate_detach_instance(&input)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    detach_calendar_instance_tx(&mut tx, &input).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn calendar_split_series<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    input: CalendarSplitSeries,
) -> Result<(), String> {
    validate_split_series(&input)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    split_calendar_series_tx(&mut tx, &input).await?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}
