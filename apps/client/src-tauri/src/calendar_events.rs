use chrono::{DateTime, NaiveDateTime};
use serde::Deserialize;
use sqlx::Row;
use tauri::{AppHandle, Runtime};

use crate::calendar_description::{
    sanitize_calendar_description_html, sanitize_optional_calendar_description,
};
use crate::db_path::connect_sqlite;

const PALETTE_SIZE: i64 = 32;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventMutationTarget {
    id: String,
    occurrence_start: Option<String>,
    occurrence_end: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum CalendarDeleteArchiveOperation {
    #[serde(rename = "delete_event")]
    DeleteEvent { target: CalendarEventMutationTarget },
    #[serde(rename = "archive_event")]
    ArchiveEvent { target: CalendarEventMutationTarget },
    #[serde(rename = "cap_series")]
    CapSeries {
        #[serde(rename = "eventId")]
        event_id: String,
        #[serde(rename = "repeatUntil")]
        repeat_until: String,
        rrule: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarActiveEventReferenceTransfer {
    new_event_id: String,
    new_event_date: Option<String>,
    planned_end: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum CalendarRecurrenceCommitOperation {
    #[serde(rename = "update_event")]
    UpdateEvent { patch: Box<CalendarEventUpdate> },
    #[serde(rename = "detach_instance")]
    DetachInstance { input: Box<CalendarDetachInstance> },
    #[serde(rename = "split_series")]
    SplitSeries { input: Box<CalendarSplitSeries> },
    #[serde(rename = "transfer_active_event_reference")]
    TransferActiveEventReference {
        transfer: CalendarActiveEventReferenceTransfer,
    },
}

struct CalendarEventMutationContext {
    id: String,
    source_event_id: String,
    occurrence_date: Option<String>,
    start_time: String,
    end_time: String,
    rrule: Option<String>,
    repeat_until: Option<String>,
    synthetic: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventCreate {
    id: String,
    title: String,
    start_time: String,
    end_time: String,
    timezone: String,
    calendar_id: String,
    color: Option<i64>,
    description: String,
    rrule: Option<String>,
    notifications: Option<String>,
    exceptions: Option<String>,
    repeat_until: Option<String>,
    all_day: bool,
    location: String,
    url: String,
    transparency: String,
    status: String,
    source_uid: Option<String>,
    visibility: String,
    priority: Option<i64>,
    categories: Option<String>,
    geo: Option<String>,
    sequence: i64,
    rdate: Option<String>,
    extended_properties: Option<String>,
    organizer: Option<String>,
    meeting_enabled: bool,
    local_rsvp_status: Option<String>,
    guest_can_modify: bool,
    guest_can_invite_others: bool,
    guest_can_see_other_guests: bool,
    created_at: String,
    updated_at: String,
    pomodoro_config: Option<CalendarPomodoroConfig>,
    attendees: Vec<CalendarEventAttendee>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarPomodoroConfig {
    rhythm: CalendarPomodoroRhythm,
    rhythm_source: String,
    preset_key: Option<String>,
    idle_timeout_minutes: Option<i64>,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum CalendarPomodoroRhythm {
    Count {
        focus_duration_minutes: i64,
        short_break_minutes: i64,
        long_break_minutes: i64,
        long_break_after_focus_count: i64,
    },
    Sequence {
        steps: Vec<CalendarPomodoroSequenceStep>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarPomodoroSequenceStep {
    focus_duration_minutes: i64,
    break_phase: String,
    break_duration_minutes: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarEventAttendee {
    id: String,
    name: Option<String>,
    email: String,
    role: String,
    status: String,
    rsvp: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarEventAlarm {
    id: String,
    action: String,
    trigger_type: String,
    trigger_value: String,
    description: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventUpdate {
    id: String,
    updated_at: String,
    fields: Vec<CalendarEventUpdateField>,
    attendees: Option<Vec<CalendarEventAttendee>>,
    alarms: Option<Vec<CalendarEventAlarm>>,
    pomodoro_config: Option<CalendarPomodoroConfigPatch>,
}

#[derive(Deserialize)]
#[serde(tag = "field", content = "value")]
enum CalendarEventUpdateField {
    #[serde(rename = "title")]
    Title(String),
    #[serde(rename = "startTime")]
    StartTime(String),
    #[serde(rename = "endTime")]
    EndTime(String),
    #[serde(rename = "timezone")]
    Timezone(String),
    #[serde(rename = "calendarId")]
    CalendarId(String),
    #[serde(rename = "color")]
    Color(Option<i64>),
    #[serde(rename = "description")]
    Description(String),
    #[serde(rename = "rrule")]
    Rrule(Option<String>),
    #[serde(rename = "repeatUntil")]
    RepeatUntil(Option<String>),
    #[serde(rename = "notifications")]
    Notifications(Option<String>),
    #[serde(rename = "exceptions")]
    Exceptions(Option<String>),
    #[serde(rename = "allDay")]
    AllDay(bool),
    #[serde(rename = "location")]
    Location(String),
    #[serde(rename = "url")]
    Url(String),
    #[serde(rename = "transparency")]
    Transparency(String),
    #[serde(rename = "status")]
    Status(String),
    #[serde(rename = "sourceUid")]
    SourceUid(Option<String>),
    #[serde(rename = "visibility")]
    Visibility(String),
    #[serde(rename = "priority")]
    Priority(Option<i64>),
    #[serde(rename = "categories")]
    Categories(Option<String>),
    #[serde(rename = "geo")]
    Geo(Option<String>),
    #[serde(rename = "sequence")]
    Sequence(i64),
    #[serde(rename = "rdate")]
    Rdate(Option<String>),
    #[serde(rename = "extendedProperties")]
    ExtendedProperties(Option<String>),
    #[serde(rename = "organizer")]
    Organizer(Option<String>),
    #[serde(rename = "meetingEnabled")]
    MeetingEnabled(bool),
    #[serde(rename = "localRsvpStatus")]
    LocalRsvpStatus(Option<String>),
    #[serde(rename = "guestPermissions")]
    GuestPermissions(CalendarGuestPermissions),
}

impl CalendarEventUpdateField {
    fn field_name(&self) -> &'static str {
        match self {
            CalendarEventUpdateField::Title(_) => "title",
            CalendarEventUpdateField::StartTime(_) => "startTime",
            CalendarEventUpdateField::EndTime(_) => "endTime",
            CalendarEventUpdateField::Timezone(_) => "timezone",
            CalendarEventUpdateField::CalendarId(_) => "calendarId",
            CalendarEventUpdateField::Color(_) => "color",
            CalendarEventUpdateField::Description(_) => "description",
            CalendarEventUpdateField::Rrule(_) => "rrule",
            CalendarEventUpdateField::RepeatUntil(_) => "repeatUntil",
            CalendarEventUpdateField::Notifications(_) => "notifications",
            CalendarEventUpdateField::Exceptions(_) => "exceptions",
            CalendarEventUpdateField::AllDay(_) => "allDay",
            CalendarEventUpdateField::Location(_) => "location",
            CalendarEventUpdateField::Url(_) => "url",
            CalendarEventUpdateField::Transparency(_) => "transparency",
            CalendarEventUpdateField::Status(_) => "status",
            CalendarEventUpdateField::SourceUid(_) => "sourceUid",
            CalendarEventUpdateField::Visibility(_) => "visibility",
            CalendarEventUpdateField::Priority(_) => "priority",
            CalendarEventUpdateField::Categories(_) => "categories",
            CalendarEventUpdateField::Geo(_) => "geo",
            CalendarEventUpdateField::Sequence(_) => "sequence",
            CalendarEventUpdateField::Rdate(_) => "rdate",
            CalendarEventUpdateField::ExtendedProperties(_) => "extendedProperties",
            CalendarEventUpdateField::Organizer(_) => "organizer",
            CalendarEventUpdateField::MeetingEnabled(_) => "meetingEnabled",
            CalendarEventUpdateField::LocalRsvpStatus(_) => "localRsvpStatus",
            CalendarEventUpdateField::GuestPermissions(_) => "guestPermissions",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarGuestPermissions {
    guest_can_modify: bool,
    guest_can_invite_others: bool,
    guest_can_see_other_guests: bool,
}

#[derive(Deserialize)]
struct CalendarGeoPayload {
    lat: f64,
    lng: f64,
}

#[derive(Deserialize)]
struct CalendarOrganizerPayload {
    name: Option<String>,
    email: String,
}

#[derive(Deserialize)]
#[serde(tag = "action", content = "value")]
enum CalendarPomodoroConfigPatch {
    #[serde(rename = "set")]
    Set(CalendarPomodoroConfig),
    #[serde(rename = "clear")]
    Clear,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDetachInstance {
    parent_id: String,
    instance_date: String,
    exceptions: String,
    new_id: String,
    title: String,
    start_time: String,
    end_time: String,
    timezone: String,
    calendar_id: String,
    color: Option<i64>,
    notifications: Option<String>,
    all_day: bool,
    location: String,
    transparency: String,
    status: String,
    now: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSplitSeries {
    parent_id: String,
    day_before: String,
    capped_rrule: Option<String>,
    new_id: String,
    title: String,
    start_time: String,
    end_time: String,
    timezone: String,
    calendar_id: String,
    color: Option<i64>,
    notifications: Option<String>,
    exceptions: Option<String>,
    rrule: Option<String>,
    all_day: bool,
    location: String,
    transparency: String,
    status: String,
    description_patch: Option<String>,
    url_patch: Option<String>,
    local_rsvp_status: Option<String>,
    meeting_enabled: bool,
    copy_pomodoro_config: bool,
    pomodoro_config: Option<CalendarPomodoroConfig>,
    now: String,
}

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

async fn insert_calendar_event_row(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event: &CalendarEventCreate,
) -> Result<(), String> {
    let description = sanitize_calendar_description_html(&event.description);
    let geo = parse_geo(&event.geo)?;
    sqlx::query(
        "INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, rrule, repeat_until,
            all_day, location, url, transparency, status,
            source_uid, visibility, priority, geo_lat, geo_lng,
            sequence,
            meeting_enabled, local_rsvp_status,
            guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&event.id)
    .bind(&event.title)
    .bind(&event.start_time)
    .bind(&event.end_time)
    .bind(&event.timezone)
    .bind(&event.calendar_id)
    .bind(event.color)
    .bind(&description)
    .bind(&event.rrule)
    .bind(&event.repeat_until)
    .bind(if event.all_day { 1_i64 } else { 0_i64 })
    .bind(&event.location)
    .bind(&event.url)
    .bind(&event.transparency)
    .bind(&event.status)
    .bind(&event.source_uid)
    .bind(&event.visibility)
    .bind(event.priority)
    .bind(geo.map(|value| value.0))
    .bind(geo.map(|value| value.1))
    .bind(event.sequence)
    .bind(if event.meeting_enabled { 1_i64 } else { 0_i64 })
    .bind(&event.local_rsvp_status)
    .bind(if event.guest_can_modify { 1_i64 } else { 0_i64 })
    .bind(if event.guest_can_invite_others {
        1_i64
    } else {
        0_i64
    })
    .bind(if event.guest_can_see_other_guests {
        1_i64
    } else {
        0_i64
    })
    .bind(&event.created_at)
    .bind(&event.updated_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert calendar event: {e}"))?;
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

async fn delete_calendar_event_tx(
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

async fn archive_calendar_event_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    target: &CalendarEventMutationTarget,
) -> Result<(), String> {
    let now = current_utc_iso(tx).await?;
    let context = load_mutation_context(tx, target).await?;
    ensure_no_open_runs_for_event(tx, &context).await?;
    archive_loaded_event(tx, &context, &now).await
}

async fn apply_delete_archive_operations_tx(
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

async fn apply_recurrence_commit_operations_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    operations: Vec<CalendarRecurrenceCommitOperation>,
) -> Result<(), String> {
    for operation in &operations {
        validate_recurrence_commit_operation(operation)?;
    }
    for operation in operations {
        match operation {
            CalendarRecurrenceCommitOperation::UpdateEvent { patch } => {
                update_calendar_event_unchecked_tx(tx, &patch).await?;
            }
            CalendarRecurrenceCommitOperation::DetachInstance { input } => {
                detach_calendar_instance_tx(tx, &input).await?;
            }
            CalendarRecurrenceCommitOperation::SplitSeries { input } => {
                split_calendar_series_tx(tx, &input).await?;
            }
            CalendarRecurrenceCommitOperation::TransferActiveEventReference { transfer } => {
                transfer_active_event_reference_tx(tx, &transfer).await?;
            }
        }
    }
    Ok(())
}

async fn restore_archived_calendar_event_tx(
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

async fn restore_archived_event_row(
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

async fn restore_archived_event_children(
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

async fn restore_archived_synthetic_occurrence(
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

async fn relink_pomodoro_refs_for_restored_event(
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

async fn relink_pomodoro_refs_for_restored_synthetic(
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

async fn hard_delete_loaded_event(
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

async fn archive_loaded_event(
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

async fn load_mutation_context(
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

async fn is_protected_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    context: &CalendarEventMutationContext,
    now: &str,
) -> Result<bool, String> {
    if context.start_time.as_str() <= now {
        return Ok(true);
    }
    event_has_pomodoro_history(tx, context).await
}

async fn event_has_pomodoro_history(
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

async fn ensure_no_open_runs_for_event(
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

async fn event_has_open_pomodoro_run(
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

async fn ensure_no_open_runs_for_scope(
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

async fn load_event_ids_for_scope(
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

async fn archive_event_snapshot(
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

async fn clear_archive_children(
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

async fn copy_archive_children(
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

async fn add_exdate(
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

async fn null_pomodoro_live_refs_for_synthetic(
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

async fn null_pomodoro_live_refs_for_event(
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

async fn current_utc_iso(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>) -> Result<String, String> {
    sqlx::query_scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("read current time: {e}"))
}

fn split_synthetic_id(id: &str) -> (&str, Option<&str>) {
    id.split_once("::")
        .map_or((id, None), |(parent, date)| (parent, Some(date)))
}

fn date_part(value: &str) -> Option<String> {
    let date = value.get(0..10)?;
    if date.len() == 10 {
        Some(date.to_string())
    } else {
        None
    }
}

fn validate_mutation_target(target: &CalendarEventMutationTarget) -> Result<(), String> {
    require_non_empty(&target.id, "id")?;
    if let Some(value) = &target.occurrence_start {
        require_non_empty(value, "occurrence_start")?;
    }
    if let Some(value) = &target.occurrence_end {
        require_non_empty(value, "occurrence_end")?;
    }
    Ok(())
}

fn validate_delete_archive_operation(
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

fn validate_active_event_reference_transfer(
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

fn validate_recurrence_commit_operation(
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

fn canonical_event_id(value: &str) -> Result<&str, String> {
    let (event_id, _) = split_synthetic_id(value);
    require_non_empty(event_id, "event_id")?;
    Ok(event_id)
}

async fn cap_calendar_series_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
    repeat_until: &str,
    rrule: &str,
) -> Result<(), String> {
    let now = current_utc_iso(tx).await?;
    let result = sqlx::query(
        "UPDATE calendar_events SET repeat_until = ?, rrule = ?, updated_at = ? WHERE id = ?",
    )
    .bind(repeat_until)
    .bind(rrule)
    .bind(&now)
    .bind(event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("cap calendar series: {e}"))?;
    if result.rows_affected() == 0 {
        return Err(format!("calendar event '{event_id}' not found"));
    }
    Ok(())
}

async fn transfer_active_event_reference_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    transfer: &CalendarActiveEventReferenceTransfer,
) -> Result<(), String> {
    validate_active_event_reference_transfer(transfer)?;
    let canonical_event_id = canonical_event_id(&transfer.new_event_id)?.to_string();
    let synthetic_date = split_synthetic_id(&transfer.new_event_id)
        .1
        .map(str::to_string);
    let event_date = transfer.new_event_date.clone().or(synthetic_date);

    let run_id: Option<String> =
        sqlx::query_scalar("SELECT id FROM pomodoro_runs WHERE ended_at IS NULL LIMIT 1")
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| format!("load active pomodoro run: {e}"))?;
    let Some(run_id) = run_id else {
        return Ok(());
    };

    sqlx::query(
        "UPDATE pomodoro_runs
         SET event_id = ?,
             original_event_id = ?,
             event_date = COALESCE(?, event_date),
             planned_end = COALESCE(?, planned_end)
         WHERE id = ? AND ended_at IS NULL",
    )
    .bind(&canonical_event_id)
    .bind(&transfer.new_event_id)
    .bind(&event_date)
    .bind(&transfer.planned_end)
    .bind(&run_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("transfer active pomodoro run reference: {e}"))?;

    sqlx::query(
        "UPDATE pomodoro_segments
         SET event_id = ?,
             event_date = COALESCE(?, event_date)
         WHERE run_id = ?",
    )
    .bind(&canonical_event_id)
    .bind(&event_date)
    .bind(&run_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("transfer active pomodoro segment references: {e}"))?;

    Ok(())
}

fn require_non_empty_option(value: &Option<String>, field: &str) -> Result<(), String> {
    match value {
        Some(value) => require_non_empty(value, field),
        None => Err(format!("{field} cannot be empty")),
    }
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

async fn update_calendar_event_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    patch: &CalendarEventUpdate,
) -> Result<(), String> {
    ensure_calendar_event_update_allowed(tx, patch).await?;
    update_calendar_event_unchecked_tx(tx, patch).await
}

async fn update_calendar_event_unchecked_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    patch: &CalendarEventUpdate,
) -> Result<(), String> {
    validate_event_update(patch)?;
    ensure_update_pomodoro_matches_all_day(tx, patch).await?;
    for field in &patch.fields {
        apply_update_field(tx, &patch.id, field).await?;
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

async fn ensure_update_pomodoro_matches_all_day(
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

fn patch_all_day_value(fields: &[CalendarEventUpdateField]) -> Option<bool> {
    fields.iter().rev().find_map(|field| match field {
        CalendarEventUpdateField::AllDay(value) => Some(*value),
        _ => None,
    })
}

async fn ensure_calendar_event_update_allowed(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    patch: &CalendarEventUpdate,
) -> Result<(), String> {
    let target = CalendarEventMutationTarget {
        id: patch.id.clone(),
        occurrence_start: None,
        occurrence_end: None,
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

fn protected_active_event_pomodoro_enable_allowed(
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

fn protected_active_event_end_update_allowed(
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

async fn protected_active_event_update_allowed(
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

async fn active_event_update_fields_allowed(
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

async fn active_event_update_field_allowed(
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

async fn stored_string_list_matches(
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

fn protected_event_is_active_at(context: &CalendarEventMutationContext, now: &str) -> bool {
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

fn calendar_timestamps_match(left: &str, right: &str) -> bool {
    match (
        calendar_timestamp_millis(left),
        calendar_timestamp_millis(right),
    ) {
        (Some(left_ms), Some(right_ms)) => left_ms == right_ms,
        _ => left == right,
    }
}

fn calendar_timestamp_millis(value: &str) -> Option<i64> {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        return Some(parsed.timestamp_millis());
    }
    for format in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(parsed) = NaiveDateTime::parse_from_str(value, format) {
            return Some(parsed.and_utc().timestamp_millis());
        }
    }
    None
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

async fn detach_calendar_instance_tx(
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
           color, rrule, repeat_until,
           all_day, location, transparency, status,
           source_uid,
           description, url, visibility, priority, geo_lat, geo_lng,
           sequence,
           meeting_enabled, local_rsvp_status,
           guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
           created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?,
                ?, NULL, NULL,
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
    copy_attendees(tx, &input.parent_id, &input.new_id).await?;

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

async fn split_calendar_series_tx(
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
           color, rrule, repeat_until,
           all_day, location, transparency, status,
           source_uid,
           description, url, visibility, priority, geo_lat, geo_lng,
           sequence,
           meeting_enabled, local_rsvp_status,
           guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
           created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?,
                ?, ?, NULL,
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
    copy_attendees(tx, &input.parent_id, &input.new_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn calendar_has_progress_segments<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    template_id: String,
    date: String,
) -> Result<bool, String> {
    require_non_empty(&template_id, "template_id")?;
    require_non_empty(&date, "date")?;
    let pool = connect_sqlite(app, db_url).await?;
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM pomodoro_segments
         WHERE event_id IN (?, ? || '::' || ?) AND event_date = ?
           AND status IN ('completed', 'interrupted')
           AND actual_start IS NOT NULL",
    )
    .bind(&template_id)
    .bind(&template_id)
    .bind(&date)
    .bind(&date)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("count progress segments: {e}"))?;
    Ok(count > 0)
}

#[tauri::command]
pub async fn calendar_progress_dates_before<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    template_id: String,
    cutoff_date: String,
    exclude_date: Option<String>,
) -> Result<Vec<String>, String> {
    require_non_empty(&template_id, "template_id")?;
    require_non_empty(&cutoff_date, "cutoff_date")?;
    if let Some(date) = &exclude_date {
        require_non_empty(date, "exclude_date")?;
    }
    let pool = connect_sqlite(app, db_url).await?;
    let dates = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT event_date
         FROM pomodoro_segments
         WHERE (event_id = ? OR event_id = ? || '::' || event_date)
           AND event_date < ?
           AND status IN ('completed', 'interrupted')
           AND actual_start IS NOT NULL
         ORDER BY event_date ASC",
    )
    .bind(&template_id)
    .bind(&template_id)
    .bind(&cutoff_date)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load progress dates: {e}"))?;
    Ok(filter_excluded_dates(dates, exclude_date.as_deref()))
}

async fn copy_pomodoro_config(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source_event_id: &str,
    target_event_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pomodoro_configs
           (event_id, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes)
         SELECT ?, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes
         FROM pomodoro_configs WHERE event_id = ?",
    )
    .bind(target_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("copy pomodoro config: {e}"))?;

    sqlx::query(
        "INSERT INTO pomodoro_config_count_rhythms
           (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes,
            long_break_after_focus_count)
         SELECT ?, focus_duration_minutes, short_break_minutes, long_break_minutes,
                long_break_after_focus_count
         FROM pomodoro_config_count_rhythms WHERE event_id = ?",
    )
    .bind(target_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("copy count pomodoro rhythm: {e}"))?;

    sqlx::query(
        "INSERT INTO pomodoro_config_sequence_steps
           (event_id, step_index, focus_duration_minutes, break_phase, break_duration_minutes)
         SELECT ?, step_index, focus_duration_minutes, break_phase, break_duration_minutes
         FROM pomodoro_config_sequence_steps WHERE event_id = ?
         ORDER BY step_index ASC",
    )
    .bind(target_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("copy sequence pomodoro rhythm: {e}"))?;
    Ok(())
}

async fn replace_pomodoro_config(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
    config: &CalendarPomodoroConfig,
) -> Result<(), String> {
    validate_pomodoro_config(config)?;
    sqlx::query("DELETE FROM pomodoro_configs WHERE event_id = ?")
        .bind(event_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("delete previous pomodoro config: {e}"))?;
    insert_pomodoro_config(tx, event_id, config).await
}

async fn insert_pomodoro_config(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
    config: &CalendarPomodoroConfig,
) -> Result<(), String> {
    validate_pomodoro_config(config)?;
    let rhythm_kind = match &config.rhythm {
        CalendarPomodoroRhythm::Count { .. } => "count",
        CalendarPomodoroRhythm::Sequence { .. } => "sequence",
    };
    sqlx::query(
        "INSERT INTO pomodoro_configs
           (event_id, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(event_id)
    .bind(rhythm_kind)
    .bind(&config.rhythm_source)
    .bind(&config.preset_key)
    .bind(config.idle_timeout_minutes)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert pomodoro config: {e}"))?;

    match &config.rhythm {
        CalendarPomodoroRhythm::Count {
            focus_duration_minutes,
            short_break_minutes,
            long_break_minutes,
            long_break_after_focus_count,
        } => {
            sqlx::query(
                "INSERT INTO pomodoro_config_count_rhythms
                   (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes,
                    long_break_after_focus_count)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(event_id)
            .bind(focus_duration_minutes)
            .bind(short_break_minutes)
            .bind(long_break_minutes)
            .bind(long_break_after_focus_count)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("insert count pomodoro rhythm: {e}"))?;
        }
        CalendarPomodoroRhythm::Sequence { steps } => {
            for (step_index, step) in steps.iter().enumerate() {
                sqlx::query(
                    "INSERT INTO pomodoro_config_sequence_steps
                       (event_id, step_index, focus_duration_minutes, break_phase, break_duration_minutes)
                     VALUES (?, ?, ?, ?, ?)",
                )
                .bind(event_id)
                .bind(step_index as i64)
                .bind(step.focus_duration_minutes)
                .bind(&step.break_phase)
                .bind(step.break_duration_minutes)
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("insert sequence pomodoro rhythm step: {e}"))?;
            }
        }
    }
    Ok(())
}

async fn copy_attendees(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source_event_id: &str,
    target_event_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO calendar_event_attendees
           (id, event_id, name, email, role, status, rsvp, sort_order)
         SELECT lower(hex(randomblob(16))), ?, name, email, role, status, rsvp, sort_order
         FROM calendar_event_attendees WHERE event_id = ?",
    )
    .bind(target_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("copy attendees: {e}"))?;
    Ok(())
}

async fn copy_calendar_metadata(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    source_event_id: &str,
    target_event_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO calendar_event_categories (id, event_id, category, sort_order)
         SELECT lower(hex(randomblob(16))), ?, category, sort_order
         FROM calendar_event_categories WHERE event_id = ?",
    )
    .bind(target_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("copy calendar categories: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_extended_properties
            (id, event_id, property_key, property_value, sort_order)
         SELECT lower(hex(randomblob(16))), ?, property_key, property_value, sort_order
         FROM calendar_event_extended_properties WHERE event_id = ?",
    )
    .bind(target_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("copy calendar extended properties: {e}"))?;

    sqlx::query(
        "INSERT INTO calendar_event_organizers (event_id, name, email)
         SELECT ?, name, email FROM calendar_event_organizers WHERE event_id = ?",
    )
    .bind(target_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("copy calendar organizer: {e}"))?;
    Ok(())
}

async fn apply_update_field(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    field: &CalendarEventUpdateField,
) -> Result<(), String> {
    match field {
        CalendarEventUpdateField::Title(value) => update_text(tx, id, "title", value).await,
        CalendarEventUpdateField::StartTime(value) => {
            update_text(tx, id, "start_time", value).await
        }
        CalendarEventUpdateField::EndTime(value) => update_text(tx, id, "end_time", value).await,
        CalendarEventUpdateField::Timezone(value) => update_text(tx, id, "timezone", value).await,
        CalendarEventUpdateField::CalendarId(value) => {
            update_text(tx, id, "calendar_id", value).await
        }
        CalendarEventUpdateField::Color(value) => {
            update_optional_i64(tx, id, "color", *value).await
        }
        CalendarEventUpdateField::Description(value) => {
            let description = sanitize_calendar_description_html(value);
            update_text(tx, id, "description", &description).await
        }
        CalendarEventUpdateField::Rrule(value) => {
            update_optional_text(tx, id, "rrule", value.as_deref()).await
        }
        CalendarEventUpdateField::RepeatUntil(value) => {
            update_optional_text(tx, id, "repeat_until", value.as_deref()).await
        }
        CalendarEventUpdateField::Notifications(value) => {
            replace_i64_list(
                tx,
                id,
                "calendar_event_notifications",
                "offset_minutes",
                parse_i64_list(value, "notifications")?,
            )
            .await
        }
        CalendarEventUpdateField::Exceptions(value) => {
            replace_string_list(
                tx,
                id,
                "calendar_event_exdates",
                "occurrence_date",
                parse_string_list(value, "exceptions")?,
            )
            .await
        }
        CalendarEventUpdateField::AllDay(value) => {
            update_i64(tx, id, "all_day", if *value { 1 } else { 0 }).await
        }
        CalendarEventUpdateField::Location(value) => update_text(tx, id, "location", value).await,
        CalendarEventUpdateField::Url(value) => update_text(tx, id, "url", value).await,
        CalendarEventUpdateField::Transparency(value) => {
            update_text(tx, id, "transparency", value).await
        }
        CalendarEventUpdateField::Status(value) => update_text(tx, id, "status", value).await,
        CalendarEventUpdateField::SourceUid(value) => {
            update_optional_text(tx, id, "source_uid", value.as_deref()).await
        }
        CalendarEventUpdateField::Visibility(value) => {
            update_text(tx, id, "visibility", value).await
        }
        CalendarEventUpdateField::Priority(value) => {
            update_optional_i64(tx, id, "priority", *value).await
        }
        CalendarEventUpdateField::Categories(value) => {
            replace_string_list(
                tx,
                id,
                "calendar_event_categories",
                "category",
                parse_string_list(value, "categories")?,
            )
            .await
        }
        CalendarEventUpdateField::Geo(value) => {
            let geo = parse_geo(value)?;
            sqlx::query("UPDATE calendar_events SET geo_lat = ?, geo_lng = ? WHERE id = ?")
                .bind(geo.map(|value| value.0))
                .bind(geo.map(|value| value.1))
                .bind(id)
                .execute(&mut **tx)
                .await
                .map_err(|e| format!("update calendar geo: {e}"))?;
            Ok(())
        }
        CalendarEventUpdateField::Sequence(value) => update_i64(tx, id, "sequence", *value).await,
        CalendarEventUpdateField::Rdate(value) => {
            replace_string_list(
                tx,
                id,
                "calendar_event_rdates",
                "occurrence_start",
                parse_string_list(value, "rdate")?,
            )
            .await
        }
        CalendarEventUpdateField::ExtendedProperties(value) => {
            replace_extended_properties(
                tx,
                id,
                "calendar_event_extended_properties",
                "event_id",
                parse_string_map(value, "extended_properties")?,
            )
            .await
        }
        CalendarEventUpdateField::Organizer(value) => {
            replace_organizer(tx, id, parse_organizer(value)?).await
        }
        CalendarEventUpdateField::MeetingEnabled(value) => {
            update_i64(tx, id, "meeting_enabled", if *value { 1 } else { 0 }).await
        }
        CalendarEventUpdateField::LocalRsvpStatus(value) => {
            update_optional_text(tx, id, "local_rsvp_status", value.as_deref()).await
        }
        CalendarEventUpdateField::GuestPermissions(value) => {
            sqlx::query(
                "UPDATE calendar_events
                    SET guest_can_modify = ?,
                        guest_can_invite_others = ?,
                        guest_can_see_other_guests = ?
                  WHERE id = ?",
            )
            .bind(if value.guest_can_modify { 1_i64 } else { 0_i64 })
            .bind(if value.guest_can_invite_others {
                1_i64
            } else {
                0_i64
            })
            .bind(if value.guest_can_see_other_guests {
                1_i64
            } else {
                0_i64
            })
            .bind(id)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("update calendar guest permissions: {e}"))?;
            Ok(())
        }
    }
}

fn parse_i64_list(value: &Option<String>, field: &str) -> Result<Vec<i64>, String> {
    match value {
        Some(json) => serde_json::from_str::<Vec<i64>>(json)
            .map_err(|e| format!("{field} is not a valid integer list: {e}")),
        None => Ok(Vec::new()),
    }
}

fn parse_string_list(value: &Option<String>, field: &str) -> Result<Vec<String>, String> {
    match value {
        Some(json) => serde_json::from_str::<Vec<String>>(json)
            .map_err(|e| format!("{field} is not a valid string list: {e}")),
        None => Ok(Vec::new()),
    }
}

fn parse_string_map(value: &Option<String>, field: &str) -> Result<Vec<(String, String)>, String> {
    let Some(json) = value else {
        return Ok(Vec::new());
    };
    let map = serde_json::from_str::<std::collections::BTreeMap<String, String>>(json)
        .map_err(|e| format!("{field} is not a valid string map: {e}"))?;
    Ok(map.into_iter().collect())
}

fn parse_geo(value: &Option<String>) -> Result<Option<(f64, f64)>, String> {
    let Some(json) = value else {
        return Ok(None);
    };
    let geo = serde_json::from_str::<CalendarGeoPayload>(json)
        .map_err(|e| format!("geo is not valid coordinates: {e}"))?;
    if !geo.lat.is_finite() || !geo.lng.is_finite() {
        return Err("geo coordinates must be finite".to_string());
    }
    Ok(Some((geo.lat, geo.lng)))
}

fn parse_organizer(value: &Option<String>) -> Result<Option<CalendarOrganizerPayload>, String> {
    let Some(json) = value else {
        return Ok(None);
    };
    let organizer = serde_json::from_str::<CalendarOrganizerPayload>(json)
        .map_err(|e| format!("organizer is not valid: {e}"))?;
    require_non_empty(&organizer.email, "organizer.email")?;
    Ok(Some(organizer))
}

async fn replace_i64_list(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
    table: &'static str,
    column: &'static str,
    values: Vec<i64>,
) -> Result<(), String> {
    let delete = format!("DELETE FROM {table} WHERE event_id = ?");
    sqlx::query(&delete)
        .bind(event_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("clear calendar {table}: {e}"))?;
    let insert = format!(
        "INSERT INTO {table} (id, event_id, {column}, sort_order)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?)"
    );
    for (sort_order, value) in values.into_iter().enumerate() {
        sqlx::query(&insert)
            .bind(event_id)
            .bind(value)
            .bind(sort_order as i64)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("insert calendar {table}: {e}"))?;
    }
    Ok(())
}

async fn replace_string_list(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
    table: &'static str,
    column: &'static str,
    values: Vec<String>,
) -> Result<(), String> {
    let delete = format!("DELETE FROM {table} WHERE event_id = ?");
    sqlx::query(&delete)
        .bind(event_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("clear calendar {table}: {e}"))?;
    let insert = format!(
        "INSERT INTO {table} (id, event_id, {column}, sort_order)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?)"
    );
    for (sort_order, value) in values.into_iter().enumerate() {
        sqlx::query(&insert)
            .bind(event_id)
            .bind(value)
            .bind(sort_order as i64)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("insert calendar {table}: {e}"))?;
    }
    Ok(())
}

async fn replace_extended_properties(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    owner_id: &str,
    table: &'static str,
    owner_column: &'static str,
    values: Vec<(String, String)>,
) -> Result<(), String> {
    let delete = format!("DELETE FROM {table} WHERE {owner_column} = ?");
    sqlx::query(&delete)
        .bind(owner_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("clear calendar {table}: {e}"))?;
    let insert = format!(
        "INSERT INTO {table} (id, {owner_column}, property_key, property_value, sort_order)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)"
    );
    for (sort_order, (key, value)) in values.into_iter().enumerate() {
        sqlx::query(&insert)
            .bind(owner_id)
            .bind(key)
            .bind(value)
            .bind(sort_order as i64)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("insert calendar {table}: {e}"))?;
    }
    Ok(())
}

async fn replace_organizer(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
    organizer: Option<CalendarOrganizerPayload>,
) -> Result<(), String> {
    sqlx::query("DELETE FROM calendar_event_organizers WHERE event_id = ?")
        .bind(event_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("clear calendar organizer: {e}"))?;
    if let Some(organizer) = organizer {
        sqlx::query(
            "INSERT INTO calendar_event_organizers (event_id, name, email)
             VALUES (?, ?, ?)",
        )
        .bind(event_id)
        .bind(organizer.name)
        .bind(organizer.email)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("insert calendar organizer: {e}"))?;
    }
    Ok(())
}

async fn update_text(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    column: &'static str,
    value: &str,
) -> Result<(), String> {
    let query = format!("UPDATE calendar_events SET {column} = ? WHERE id = ?");
    sqlx::query(&query)
        .bind(value)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("update calendar column {column}: {e}"))?;
    Ok(())
}

async fn update_optional_text(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    column: &'static str,
    value: Option<&str>,
) -> Result<(), String> {
    let query = format!("UPDATE calendar_events SET {column} = ? WHERE id = ?");
    sqlx::query(&query)
        .bind(value)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("update calendar column {column}: {e}"))?;
    Ok(())
}

async fn update_i64(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    column: &'static str,
    value: i64,
) -> Result<(), String> {
    let query = format!("UPDATE calendar_events SET {column} = ? WHERE id = ?");
    sqlx::query(&query)
        .bind(value)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("update calendar column {column}: {e}"))?;
    Ok(())
}

async fn update_optional_i64(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    column: &'static str,
    value: Option<i64>,
) -> Result<(), String> {
    let query = format!("UPDATE calendar_events SET {column} = ? WHERE id = ?");
    sqlx::query(&query)
        .bind(value)
        .bind(id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("update calendar column {column}: {e}"))?;
    Ok(())
}

async fn sanitize_stored_event_description(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
) -> Result<(), String> {
    let description =
        sqlx::query_scalar::<_, String>("SELECT description FROM calendar_events WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|e| format!("load copied calendar description: {e}"))?;
    let Some(description) = description else {
        return Ok(());
    };
    let sanitized = sanitize_calendar_description_html(&description);
    if sanitized != description {
        update_text(tx, id, "description", &sanitized).await?;
    }
    Ok(())
}

fn validate_event_create(event: &CalendarEventCreate) -> Result<(), String> {
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

fn validate_event_update(patch: &CalendarEventUpdate) -> Result<(), String> {
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

fn validate_detach_instance(input: &CalendarDetachInstance) -> Result<(), String> {
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

fn validate_split_series(input: &CalendarSplitSeries) -> Result<(), String> {
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

fn validate_update_field(field: &CalendarEventUpdateField) -> Result<(), String> {
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

fn validate_optional_attendee_status(value: &Option<String>, field: &str) -> Result<(), String> {
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

fn validate_pomodoro_config(config: &CalendarPomodoroConfig) -> Result<(), String> {
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

fn validate_rhythm_source(source: &str, preset_key: Option<&str>) -> Result<(), String> {
    match source {
        "preset" => {
            let Some(key) = preset_key else {
                return Err("preset rhythm_source requires preset_key".to_string());
            };
            validate_enum(key, "preset_key", &["auto", "deep", "creative", "extended"])
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

fn validate_rhythm_position_count(value: i64, field: &str) -> Result<(), String> {
    if !(1..=12).contains(&value) {
        Err(format!("{field} must be between 1 and 12"))
    } else {
        Ok(())
    }
}

fn validate_alarm(alarm: &CalendarEventAlarm) -> Result<(), String> {
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

fn validate_attendee(attendee: &CalendarEventAttendee) -> Result<(), String> {
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

fn validate_enum(value: &str, field: &str, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("{field} has unsupported value '{value}'"))
    }
}

fn validate_color(value: Option<i64>, field: &str) -> Result<(), String> {
    if let Some(color) = value {
        if !(0..PALETTE_SIZE).contains(&color) {
            return Err(format!("{field} is outside the event palette range"));
        }
    }
    Ok(())
}

fn validate_priority(value: Option<i64>) -> Result<(), String> {
    if let Some(priority) = value {
        if !(0..=9).contains(&priority) {
            return Err("priority must be between 0 and 9".to_string());
        }
    }
    Ok(())
}

fn validate_positive(value: i64, field: &str) -> Result<(), String> {
    if value <= 0 {
        Err(format!("{field} must be positive"))
    } else {
        Ok(())
    }
}

fn validate_non_negative(value: i64, field: &str) -> Result<(), String> {
    if value < 0 {
        Err(format!("{field} cannot be negative"))
    } else {
        Ok(())
    }
}

fn validate_json_option(value: &Option<String>, field: &str) -> Result<(), String> {
    if let Some(json) = value {
        serde_json::from_str::<serde_json::Value>(json)
            .map_err(|e| format!("{field} is not valid JSON: {e}"))?;
    }
    Ok(())
}

fn filter_excluded_dates(dates: Vec<String>, exclude_date: Option<&str>) -> Vec<String> {
    match exclude_date {
        Some(exclude) => dates.into_iter().filter(|date| date != exclude).collect(),
        None => dates,
    }
}

fn require_non_empty(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} cannot be empty"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_delete_archive_operations_tx, apply_recurrence_commit_operations_tx,
        apply_update_field, archive_calendar_event_tx, cap_calendar_series_tx,
        delete_calendar_event_tx, filter_excluded_dates, insert_calendar_event_row,
        insert_pomodoro_config, protected_active_event_end_update_allowed, replace_pomodoro_config,
        restore_archived_calendar_event_tx, sanitize_stored_event_description,
        split_calendar_series_tx, update_calendar_event_tx, validate_color, validate_event_create,
        validate_non_negative, validate_positive, validate_priority, validate_update_field,
        CalendarActiveEventReferenceTransfer, CalendarDeleteArchiveOperation,
        CalendarDetachInstance, CalendarEventCreate, CalendarEventMutationContext,
        CalendarEventMutationTarget, CalendarEventUpdate, CalendarEventUpdateField,
        CalendarGuestPermissions, CalendarPomodoroConfig, CalendarPomodoroConfigPatch,
        CalendarPomodoroRhythm, CalendarPomodoroSequenceStep, CalendarRecurrenceCommitOperation,
        CalendarSplitSeries,
    };

    fn event_create() -> CalendarEventCreate {
        CalendarEventCreate {
            id: "event-1".to_string(),
            title: "Focus".to_string(),
            start_time: "2026-05-09T10:00:00Z".to_string(),
            end_time: "2026-05-09T11:00:00Z".to_string(),
            timezone: "America/Monterrey".to_string(),
            calendar_id: "local".to_string(),
            color: None,
            description: String::new(),
            rrule: None,
            notifications: None,
            exceptions: None,
            repeat_until: None,
            all_day: false,
            location: String::new(),
            url: String::new(),
            transparency: "opaque".to_string(),
            status: "confirmed".to_string(),
            source_uid: None,
            visibility: "public".to_string(),
            priority: None,
            categories: None,
            geo: None,
            sequence: 0,
            rdate: None,
            extended_properties: None,
            organizer: None,
            meeting_enabled: false,
            local_rsvp_status: None,
            guest_can_modify: false,
            guest_can_invite_others: true,
            guest_can_see_other_guests: true,
            created_at: "2026-05-09 10:00:00".to_string(),
            updated_at: "2026-05-09 10:00:00".to_string(),
            pomodoro_config: None,
            attendees: Vec::new(),
        }
    }

    fn pomodoro_config() -> CalendarPomodoroConfig {
        CalendarPomodoroConfig {
            rhythm: CalendarPomodoroRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            },
            rhythm_source: "preset".to_string(),
            preset_key: Some("auto".to_string()),
            idle_timeout_minutes: Some(3),
        }
    }

    fn sequence_pomodoro_config() -> CalendarPomodoroConfig {
        CalendarPomodoroConfig {
            rhythm: CalendarPomodoroRhythm::Sequence {
                steps: vec![
                    CalendarPomodoroSequenceStep {
                        focus_duration_minutes: 25,
                        break_phase: "short_break".to_string(),
                        break_duration_minutes: 5,
                    },
                    CalendarPomodoroSequenceStep {
                        focus_duration_minutes: 35,
                        break_phase: "long_break".to_string(),
                        break_duration_minutes: 12,
                    },
                ],
            },
            rhythm_source: "custom".to_string(),
            preset_key: None,
            idle_timeout_minutes: None,
        }
    }

    fn invalid_sequence_pomodoro_config() -> CalendarPomodoroConfig {
        CalendarPomodoroConfig {
            rhythm: CalendarPomodoroRhythm::Sequence { steps: Vec::new() },
            rhythm_source: "custom".to_string(),
            preset_key: None,
            idle_timeout_minutes: None,
        }
    }

    #[test]
    fn validates_event_color_and_priority_ranges() {
        assert!(validate_color(Some(0), "color").is_ok());
        assert!(validate_color(Some(31), "color").is_ok());
        assert!(validate_color(Some(32), "color").is_err());
        assert!(validate_priority(Some(9)).is_ok());
        assert!(validate_priority(Some(10)).is_err());
    }

    #[test]
    fn validates_duration_ranges() {
        assert!(validate_positive(1, "focus_duration_minutes").is_ok());
        assert!(validate_positive(0, "focus_duration_minutes").is_err());
        assert!(validate_non_negative(0, "idle_timeout_minutes").is_ok());
        assert!(validate_non_negative(-1, "idle_timeout_minutes").is_err());
    }

    #[test]
    fn accepts_empty_event_titles() {
        let mut event = event_create();
        event.title = String::new();
        assert!(validate_event_create(&event).is_ok());
        assert!(validate_update_field(&CalendarEventUpdateField::Title(String::new())).is_ok());
    }

    #[test]
    fn all_day_event_create_rejects_pomodoro_config() {
        let mut event = event_create();
        event.all_day = true;
        event.pomodoro_config = Some(pomodoro_config());
        assert!(validate_event_create(&event).is_err());
    }

    #[test]
    fn calendar_event_create_row_matches_current_schema() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            let event = event_create();
            let mut tx = pool.begin().await.unwrap();
            insert_calendar_event_row(&mut tx, &event).await.unwrap();
            tx.commit().await.unwrap();

            let saved: (String, i64, Option<String>) = sqlx::query_as(
                "SELECT title, meeting_enabled, local_rsvp_status
                 FROM calendar_events
                 WHERE id = 'event-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(saved.0, "Focus");
            assert_eq!(saved.1, 0);
            assert_eq!(saved.2, None);
        });
    }

    #[test]
    fn deleting_event_rejects_active_pomodoro_run() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event(&pool, "event-1", "").await;
            insert_test_open_pomodoro_run(&pool).await;
            insert_test_active_pomodoro_segment(&pool).await;

            let mut tx = pool.begin().await.unwrap();
            let err = delete_calendar_event_tx(
                &mut tx,
                &CalendarEventMutationTarget {
                    id: "event-1".to_string(),
                    occurrence_start: None,
                    occurrence_end: None,
                },
            )
            .await
            .unwrap_err();
            tx.rollback().await.unwrap();
            assert!(err.contains("active pomodoro run"));

            let run: (Option<String>, Option<String>) = sqlx::query_as(
                "SELECT ended_at, event_id
                 FROM pomodoro_runs
                 WHERE id = 'run-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let segment: (String, Option<String>) = sqlx::query_as(
                "SELECT status, event_id
                 FROM pomodoro_segments
                 WHERE id = 'segment-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert!(run.0.is_none());
            assert_eq!(run.1, Some("event-1".to_string()));
            assert_eq!(segment.0, "active");
            assert_eq!(segment.1, Some("event-1".to_string()));
        });
    }

    #[test]
    fn future_untracked_event_hard_deletes() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2099-05-09T10:00:00Z",
                "2099-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            delete_calendar_event_tx(
                &mut tx,
                &CalendarEventMutationTarget {
                    id: "event-1".to_string(),
                    occurrence_start: None,
                    occurrence_end: None,
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let live_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let archive_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'event-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(live_count, 0);
            assert_eq!(archive_count, 0);
        });
    }

    #[test]
    fn past_event_delete_rejects_and_archive_succeeds() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event(&pool, "event-1", "").await;

            let mut tx = pool.begin().await.unwrap();
            let err = delete_calendar_event_tx(
                &mut tx,
                &CalendarEventMutationTarget {
                    id: "event-1".to_string(),
                    occurrence_start: None,
                    occurrence_end: None,
                },
            )
            .await
            .unwrap_err();
            tx.rollback().await.unwrap();
            assert!(err.contains("archive it instead"));

            let mut tx = pool.begin().await.unwrap();
            archive_calendar_event_tx(
                &mut tx,
                &CalendarEventMutationTarget {
                    id: "event-1".to_string(),
                    occurrence_start: None,
                    occurrence_end: None,
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let live_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let archived_title: String = sqlx::query_scalar(
                "SELECT title FROM calendar_events_archive WHERE id = 'event-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(live_count, 0);
            assert_eq!(archived_title, "");
        });
    }

    #[test]
    fn protected_event_update_rejects_without_open_run() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2000-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            let err = update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![
                        CalendarEventUpdateField::Title("Changed".to_string()),
                        CalendarEventUpdateField::StartTime("2000-05-09T10:00:00Z".to_string()),
                        CalendarEventUpdateField::EndTime("2999-05-09T11:00:00Z".to_string()),
                        CalendarEventUpdateField::AllDay(false),
                    ],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: None,
                },
            )
            .await
            .unwrap_err();
            tx.rollback().await.unwrap();

            assert!(err.contains("protected"));
            let title: String =
                sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title, "");
        });
    }

    #[test]
    fn active_non_pomodoro_title_update_succeeds_without_open_run() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![CalendarEventUpdateField::Title("Changed".to_string())],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: None,
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let title: String =
                sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title, "Changed");
        });
    }

    #[test]
    fn active_non_pomodoro_full_panel_update_succeeds_without_open_run() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![
                        CalendarEventUpdateField::Title("Changed".to_string()),
                        CalendarEventUpdateField::StartTime("2000-05-09T10:00:00Z".to_string()),
                        CalendarEventUpdateField::EndTime("2999-05-09T11:00:00Z".to_string()),
                        CalendarEventUpdateField::Timezone("America/Monterrey".to_string()),
                        CalendarEventUpdateField::CalendarId("local".to_string()),
                        CalendarEventUpdateField::Color(None),
                        CalendarEventUpdateField::Description(String::new()),
                        CalendarEventUpdateField::Rrule(None),
                        CalendarEventUpdateField::RepeatUntil(None),
                        CalendarEventUpdateField::Notifications(None),
                        CalendarEventUpdateField::Exceptions(None),
                        CalendarEventUpdateField::AllDay(false),
                        CalendarEventUpdateField::Location(String::new()),
                        CalendarEventUpdateField::Url(String::new()),
                        CalendarEventUpdateField::Transparency("opaque".to_string()),
                        CalendarEventUpdateField::Status("confirmed".to_string()),
                        CalendarEventUpdateField::SourceUid(None),
                        CalendarEventUpdateField::Visibility("public".to_string()),
                        CalendarEventUpdateField::Priority(None),
                        CalendarEventUpdateField::Categories(None),
                        CalendarEventUpdateField::Geo(None),
                        CalendarEventUpdateField::Sequence(0),
                        CalendarEventUpdateField::Rdate(None),
                        CalendarEventUpdateField::ExtendedProperties(None),
                        CalendarEventUpdateField::Organizer(None),
                        CalendarEventUpdateField::MeetingEnabled(false),
                        CalendarEventUpdateField::LocalRsvpStatus(None),
                        CalendarEventUpdateField::GuestPermissions(CalendarGuestPermissions {
                            guest_can_modify: false,
                            guest_can_invite_others: true,
                            guest_can_see_other_guests: true,
                        }),
                    ],
                    attendees: Some(Vec::new()),
                    alarms: Some(Vec::new()),
                    pomodoro_config: Some(CalendarPomodoroConfigPatch::Clear),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let title: String =
                sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title, "Changed");
        });
    }

    #[test]
    fn active_event_with_completed_pomodoro_history_update_succeeds_without_open_run() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                None,
            )
            .await;
            insert_test_completed_pomodoro_history(&pool, "event-1", "event-1", "2000-05-09").await;

            let mut tx = pool.begin().await.unwrap();
            update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![
                        CalendarEventUpdateField::Title("Changed".to_string()),
                        CalendarEventUpdateField::StartTime("2000-05-09T10:00:00Z".to_string()),
                        CalendarEventUpdateField::EndTime("2999-05-09T11:00:00Z".to_string()),
                        CalendarEventUpdateField::Rrule(None),
                        CalendarEventUpdateField::RepeatUntil(None),
                        CalendarEventUpdateField::Exceptions(None),
                        CalendarEventUpdateField::AllDay(false),
                        CalendarEventUpdateField::Rdate(None),
                    ],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: Some(CalendarPomodoroConfigPatch::Clear),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let title: String =
                sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title, "Changed");
        });
    }

    #[test]
    fn active_non_pomodoro_start_update_rejects_without_open_run() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            let err = update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![CalendarEventUpdateField::StartTime(
                        "2000-05-09T10:15:00Z".to_string(),
                    )],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: None,
                },
            )
            .await
            .unwrap_err();
            tx.rollback().await.unwrap();

            assert!(err.contains("protected"));
        });
    }

    #[test]
    fn active_non_pomodoro_recurrence_update_rejects_without_open_run() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            let err = update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![CalendarEventUpdateField::Rrule(Some(
                        "FREQ=DAILY".to_string(),
                    ))],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: None,
                },
            )
            .await
            .unwrap_err();
            tx.rollback().await.unwrap();

            assert!(err.contains("protected"));
        });
    }

    #[test]
    fn active_non_pomodoro_end_update_succeeds_without_open_run() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![CalendarEventUpdateField::EndTime(
                        "2001-05-09T10:30:00Z".to_string(),
                    )],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: None,
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let end_time: String =
                sqlx::query_scalar("SELECT end_time FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(end_time, "2001-05-09T10:30:00Z");
        });
    }

    #[test]
    fn active_non_pomodoro_config_set_succeeds_without_open_run() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: Some(CalendarPomodoroConfigPatch::Set(pomodoro_config())),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pomodoro_configs WHERE event_id = 'event-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, 1);
        });
    }

    #[test]
    fn invalid_config_replacement_preserves_existing_child_rows() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            insert_pomodoro_config(&mut tx, "event-1", &sequence_pomodoro_config())
                .await
                .unwrap();
            tx.commit().await.unwrap();

            let mut tx = pool.begin().await.unwrap();
            let result =
                replace_pomodoro_config(&mut tx, "event-1", &invalid_sequence_pomodoro_config())
                    .await;
            assert!(result.is_err());
            tx.rollback().await.unwrap();

            let saved: (String, i64) = sqlx::query_as(
                "SELECT pc.rhythm_kind, COUNT(pcss.step_index)
                 FROM pomodoro_configs pc
                 JOIN pomodoro_config_sequence_steps pcss ON pcss.event_id = pc.event_id
                 WHERE pc.event_id = 'event-1'
                 GROUP BY pc.rhythm_kind",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(saved, ("sequence".to_string(), 2));
        });
    }

    #[test]
    fn active_non_pomodoro_end_permission_accepts_same_second_cut() {
        let patch = CalendarEventUpdate {
            id: "event-1".to_string(),
            updated_at: "2026-05-09T10:30:00Z".to_string(),
            fields: vec![CalendarEventUpdateField::EndTime(
                "2026-05-09T10:30:00Z".to_string(),
            )],
            attendees: None,
            alarms: None,
            pomodoro_config: None,
        };
        let context = CalendarEventMutationContext {
            id: "event-1".to_string(),
            source_event_id: "event-1".to_string(),
            occurrence_date: None,
            start_time: "2026-05-09T10:00:00Z".to_string(),
            end_time: "2026-05-09T11:00:00Z".to_string(),
            rrule: None,
            repeat_until: None,
            synthetic: false,
        };

        assert!(protected_active_event_end_update_allowed(
            &patch,
            &context,
            "2026-05-09T10:30:00.500Z",
        ));
    }

    #[test]
    fn all_day_update_rejects_existing_pomodoro_config_without_clear() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2999-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                None,
            )
            .await;
            insert_test_pomodoro_config(&pool, "event-1").await;

            let mut tx = pool.begin().await.unwrap();
            let err = update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![CalendarEventUpdateField::AllDay(true)],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: None,
                },
            )
            .await
            .unwrap_err();
            tx.rollback().await.unwrap();
            assert!(err.contains("all-day events cannot have a pomodoro config"));
        });
    }

    #[test]
    fn all_day_update_can_clear_existing_pomodoro_config() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2999-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                None,
            )
            .await;
            insert_test_pomodoro_config(&pool, "event-1").await;

            let mut tx = pool.begin().await.unwrap();
            update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![CalendarEventUpdateField::AllDay(true)],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: Some(CalendarPomodoroConfigPatch::Clear),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let row: (i64, i64) = sqlx::query_as(
                "SELECT all_day,
                        (SELECT COUNT(*) FROM pomodoro_configs WHERE event_id = 'event-1')
                 FROM calendar_events WHERE id = 'event-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(row, (1, 0));
        });
    }

    #[test]
    fn existing_all_day_event_update_rejects_pomodoro_set() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2999-05-09T00:00:00Z",
                "2999-05-09T00:00:00Z",
                None,
            )
            .await;
            sqlx::query("UPDATE calendar_events SET all_day = 1 WHERE id = 'event-1'")
                .execute(&pool)
                .await
                .unwrap();

            let mut tx = pool.begin().await.unwrap();
            let err = update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: Some(CalendarPomodoroConfigPatch::Set(pomodoro_config())),
                },
            )
            .await
            .unwrap_err();
            tx.rollback().await.unwrap();
            assert!(err.contains("all-day events cannot have a pomodoro config"));
        });
    }

    #[test]
    fn all_day_split_does_not_copy_parent_pomodoro_config() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2999-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                Some("FREQ=DAILY"),
            )
            .await;
            insert_test_pomodoro_config(&pool, "event-1").await;

            let mut tx = pool.begin().await.unwrap();
            split_calendar_series_tx(
                &mut tx,
                &CalendarSplitSeries {
                    parent_id: "event-1".to_string(),
                    day_before: "2999-05-09".to_string(),
                    capped_rrule: Some("FREQ=DAILY;UNTIL=29990509T235959Z".to_string()),
                    new_id: "event-2".to_string(),
                    title: "All day split".to_string(),
                    start_time: "2999-05-10T00:00:00Z".to_string(),
                    end_time: "2999-05-10T00:00:00Z".to_string(),
                    timezone: "America/Monterrey".to_string(),
                    calendar_id: "local".to_string(),
                    color: None,
                    notifications: None,
                    exceptions: None,
                    rrule: Some("FREQ=DAILY".to_string()),
                    all_day: true,
                    location: String::new(),
                    transparency: "opaque".to_string(),
                    status: "confirmed".to_string(),
                    description_patch: None,
                    url_patch: None,
                    local_rsvp_status: None,
                    meeting_enabled: false,
                    copy_pomodoro_config: false,
                    pomodoro_config: None,
                    now: "2026-05-09T10:30:00Z".to_string(),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pomodoro_configs WHERE event_id = 'event-2'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, 0);
        });
    }

    #[test]
    fn future_event_update_succeeds() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2999-05-09T10:00:00Z",
                "2999-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![CalendarEventUpdateField::Title("Changed".to_string())],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: None,
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let title: String =
                sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title, "Changed");
        });
    }

    #[test]
    fn active_pomodoro_event_update_succeeds() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event(&pool, "event-1", "").await;
            insert_test_open_pomodoro_run(&pool).await;

            let mut tx = pool.begin().await.unwrap();
            update_calendar_event_tx(
                &mut tx,
                &CalendarEventUpdate {
                    id: "event-1".to_string(),
                    updated_at: "2026-05-09T10:30:00Z".to_string(),
                    fields: vec![CalendarEventUpdateField::Title("Changed".to_string())],
                    attendees: None,
                    alarms: None,
                    pomodoro_config: None,
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let title: String =
                sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title, "Changed");
        });
    }

    #[test]
    fn archived_event_restore_relinks_pomodoro_history() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2000-05-09T11:00:00Z",
                None,
            )
            .await;
            insert_test_completed_pomodoro_history(&pool, "event-1", "event-1", "2000-05-09").await;

            let target = CalendarEventMutationTarget {
                id: "event-1".to_string(),
                occurrence_start: None,
                occurrence_end: None,
            };
            let mut tx = pool.begin().await.unwrap();
            archive_calendar_event_tx(&mut tx, &target).await.unwrap();
            tx.commit().await.unwrap();

            let live_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let archive_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'event-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let run_event_id: Option<String> =
                sqlx::query_scalar("SELECT event_id FROM pomodoro_runs WHERE id = 'run-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let segment_event_id: Option<String> =
                sqlx::query_scalar("SELECT event_id FROM pomodoro_segments WHERE id = 'segment-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(live_count, 0);
            assert_eq!(archive_count, 1);
            assert_eq!(run_event_id, None);
            assert_eq!(segment_event_id, None);

            let mut tx = pool.begin().await.unwrap();
            restore_archived_calendar_event_tx(&mut tx, &target)
                .await
                .unwrap();
            tx.commit().await.unwrap();

            let live_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let archive_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'event-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let run: (Option<String>, String) = sqlx::query_as(
                "SELECT event_id, original_event_id FROM pomodoro_runs WHERE id = 'run-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let segment_event_id: Option<String> =
                sqlx::query_scalar("SELECT event_id FROM pomodoro_segments WHERE id = 'segment-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(live_count, 1);
            assert_eq!(archive_count, 0);
            assert_eq!(run.0, Some("event-1".to_string()));
            assert_eq!(run.1, "event-1");
            assert_eq!(segment_event_id, Some("event-1".to_string()));
        });
    }

    #[test]
    fn archived_synthetic_restore_removes_exception_and_relinks_history() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2000-05-09T11:00:00Z",
                Some("FREQ=DAILY"),
            )
            .await;
            insert_test_completed_pomodoro_history(
                &pool,
                "event-1",
                "event-1::2000-05-10",
                "2000-05-10",
            )
            .await;

            let target = CalendarEventMutationTarget {
                id: "event-1::2000-05-10".to_string(),
                occurrence_start: Some("2000-05-10T10:00:00Z".to_string()),
                occurrence_end: Some("2000-05-10T11:00:00Z".to_string()),
            };
            let mut tx = pool.begin().await.unwrap();
            archive_calendar_event_tx(&mut tx, &target).await.unwrap();
            tx.commit().await.unwrap();

            let parent_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let archive_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'event-1::2000-05-10'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let exdate_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_event_exdates
                 WHERE event_id = 'event-1' AND occurrence_date = '2000-05-10'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let run_event_id: Option<String> =
                sqlx::query_scalar("SELECT event_id FROM pomodoro_runs WHERE id = 'run-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(parent_count, 1);
            assert_eq!(archive_count, 1);
            assert_eq!(exdate_count, 1);
            assert_eq!(run_event_id, None);

            let mut tx = pool.begin().await.unwrap();
            restore_archived_calendar_event_tx(&mut tx, &target)
                .await
                .unwrap();
            tx.commit().await.unwrap();

            let archive_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'event-1::2000-05-10'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let exdate_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_event_exdates
                 WHERE event_id = 'event-1' AND occurrence_date = '2000-05-10'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let run: (Option<String>, String) = sqlx::query_as(
                "SELECT event_id, original_event_id FROM pomodoro_runs WHERE id = 'run-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let segment_event_id: Option<String> =
                sqlx::query_scalar("SELECT event_id FROM pomodoro_segments WHERE id = 'segment-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(archive_count, 0);
            assert_eq!(exdate_count, 0);
            assert_eq!(run.0, Some("event-1".to_string()));
            assert_eq!(run.1, "event-1::2000-05-10");
            assert_eq!(segment_event_id, Some("event-1".to_string()));
        });
    }

    #[test]
    fn synthetic_future_delete_adds_exception_without_deleting_parent() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2099-05-09T10:00:00Z",
                "2099-05-09T11:00:00Z",
                Some("FREQ=DAILY"),
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            delete_calendar_event_tx(
                &mut tx,
                &CalendarEventMutationTarget {
                    id: "event-1::2099-05-10".to_string(),
                    occurrence_start: Some("2099-05-10T10:00:00Z".to_string()),
                    occurrence_end: Some("2099-05-10T11:00:00Z".to_string()),
                },
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let live_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let exdate_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_event_exdates
                 WHERE event_id = 'event-1' AND occurrence_date = '2099-05-10'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(live_count, 1);
            assert_eq!(exdate_count, 1);
        });
    }

    #[test]
    fn synthetic_archive_uses_id_date_when_utc_start_is_next_day() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2099-05-09T02:00:00Z",
                "2099-05-09T03:00:00Z",
                Some("FREQ=DAILY"),
            )
            .await;

            let target = CalendarEventMutationTarget {
                id: "event-1::2099-05-10".to_string(),
                occurrence_start: Some("2099-05-11T02:00:00Z".to_string()),
                occurrence_end: Some("2099-05-11T03:00:00Z".to_string()),
            };
            let mut tx = pool.begin().await.unwrap();
            archive_calendar_event_tx(&mut tx, &target).await.unwrap();
            tx.commit().await.unwrap();

            let local_date_exdates: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_event_exdates
                 WHERE event_id = 'event-1' AND occurrence_date = '2099-05-10'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let utc_date_exdates: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_event_exdates
                 WHERE event_id = 'event-1' AND occurrence_date = '2099-05-11'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(local_date_exdates, 1);
            assert_eq!(utc_date_exdates, 0);

            let mut tx = pool.begin().await.unwrap();
            restore_archived_calendar_event_tx(&mut tx, &target)
                .await
                .unwrap();
            tx.commit().await.unwrap();

            let remaining_exdates: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_event_exdates WHERE event_id = 'event-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(remaining_exdates, 0);
        });
    }

    #[test]
    fn batch_delete_archive_and_cap_executes_in_one_transaction() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "delete-me",
                "2099-05-09T10:00:00Z",
                "2099-05-09T11:00:00Z",
                None,
            )
            .await;
            insert_test_event_at(
                &pool,
                "archive-me",
                "2000-05-09T10:00:00Z",
                "2000-05-09T11:00:00Z",
                None,
            )
            .await;
            insert_test_event_at(
                &pool,
                "series-1",
                "2099-05-09T10:00:00Z",
                "2099-05-09T11:00:00Z",
                Some("FREQ=DAILY"),
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            apply_delete_archive_operations_tx(
                &mut tx,
                vec![
                    CalendarDeleteArchiveOperation::DeleteEvent {
                        target: CalendarEventMutationTarget {
                            id: "delete-me".to_string(),
                            occurrence_start: None,
                            occurrence_end: None,
                        },
                    },
                    CalendarDeleteArchiveOperation::ArchiveEvent {
                        target: CalendarEventMutationTarget {
                            id: "archive-me".to_string(),
                            occurrence_start: None,
                            occurrence_end: None,
                        },
                    },
                    CalendarDeleteArchiveOperation::CapSeries {
                        event_id: "series-1".to_string(),
                        repeat_until: "2099-05-08".to_string(),
                        rrule: "FREQ=DAILY;UNTIL=20990508T235959Z".to_string(),
                    },
                ],
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let delete_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'delete-me'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let archived_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'archive-me'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let series: (Option<String>, Option<String>) = sqlx::query_as(
                "SELECT repeat_until, rrule FROM calendar_events WHERE id = 'series-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(delete_count, 0);
            assert_eq!(archived_count, 1);
            assert_eq!(series.0, Some("2099-05-08".to_string()));
            assert_eq!(
                series.1,
                Some("FREQ=DAILY;UNTIL=20990508T235959Z".to_string())
            );
        });
    }

    #[test]
    fn batch_rolls_back_when_later_operation_fails() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "delete-me",
                "2099-05-09T10:00:00Z",
                "2099-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            let err = apply_delete_archive_operations_tx(
                &mut tx,
                vec![
                    CalendarDeleteArchiveOperation::DeleteEvent {
                        target: CalendarEventMutationTarget {
                            id: "delete-me".to_string(),
                            occurrence_start: None,
                            occurrence_end: None,
                        },
                    },
                    CalendarDeleteArchiveOperation::CapSeries {
                        event_id: "missing-series".to_string(),
                        repeat_until: "2099-05-08".to_string(),
                        rrule: "FREQ=DAILY;UNTIL=20990508T235959Z".to_string(),
                    },
                ],
            )
            .await
            .unwrap_err();
            tx.rollback().await.unwrap();
            assert!(err.contains("missing-series"));

            let live_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'delete-me'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(live_count, 1);
        });
    }

    #[test]
    fn recurrence_commit_batch_updates_event_and_active_run_in_one_transaction() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event(&pool, "event-1", "").await;
            insert_test_event_at(
                &pool,
                "event-2",
                "2026-05-10T10:00:00Z",
                "2026-05-10T11:00:00Z",
                None,
            )
            .await;
            insert_test_open_pomodoro_run(&pool).await;
            insert_test_active_pomodoro_segment(&pool).await;

            let mut tx = pool.begin().await.unwrap();
            apply_recurrence_commit_operations_tx(
                &mut tx,
                vec![
                    CalendarRecurrenceCommitOperation::UpdateEvent {
                        patch: Box::new(CalendarEventUpdate {
                            id: "event-1".to_string(),
                            updated_at: "2026-05-09T10:30:00Z".to_string(),
                            fields: vec![CalendarEventUpdateField::Title("Changed".to_string())],
                            attendees: None,
                            alarms: None,
                            pomodoro_config: None,
                        }),
                    },
                    CalendarRecurrenceCommitOperation::TransferActiveEventReference {
                        transfer: CalendarActiveEventReferenceTransfer {
                            new_event_id: "event-2".to_string(),
                            new_event_date: Some("2026-05-10".to_string()),
                            planned_end: Some("2026-05-10T11:00:00Z".to_string()),
                        },
                    },
                ],
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let title: String =
                sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let run: (String, String, String) =
                sqlx::query_as("SELECT event_id, original_event_id, event_date FROM pomodoro_runs WHERE id = 'run-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let segment: (String, String) = sqlx::query_as(
                "SELECT event_id, event_date FROM pomodoro_segments WHERE id = 'segment-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(title, "Changed");
            assert_eq!(
                run,
                (
                    "event-2".to_string(),
                    "event-2".to_string(),
                    "2026-05-10".to_string()
                )
            );
            assert_eq!(segment, ("event-2".to_string(), "2026-05-10".to_string()));
        });
    }

    #[test]
    fn recurrence_commit_batch_rolls_back_when_later_operation_fails() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event(&pool, "event-1", "").await;

            let mut tx = pool.begin().await.unwrap();
            let err = apply_recurrence_commit_operations_tx(
                &mut tx,
                vec![
                    CalendarRecurrenceCommitOperation::UpdateEvent {
                        patch: Box::new(CalendarEventUpdate {
                            id: "event-1".to_string(),
                            updated_at: "2026-05-09T10:30:00Z".to_string(),
                            fields: vec![CalendarEventUpdateField::Title("Changed".to_string())],
                            attendees: None,
                            alarms: None,
                            pomodoro_config: None,
                        }),
                    },
                    CalendarRecurrenceCommitOperation::DetachInstance {
                        input: Box::new(CalendarDetachInstance {
                            parent_id: "missing-parent".to_string(),
                            instance_date: "2026-05-10".to_string(),
                            exceptions: "[\"2026-05-10\"]".to_string(),
                            new_id: "detached-1".to_string(),
                            title: "Detached".to_string(),
                            start_time: "2026-05-10T10:00:00Z".to_string(),
                            end_time: "2026-05-10T11:00:00Z".to_string(),
                            timezone: "America/Monterrey".to_string(),
                            calendar_id: "local".to_string(),
                            color: None,
                            notifications: None,
                            all_day: false,
                            location: String::new(),
                            transparency: "opaque".to_string(),
                            status: "confirmed".to_string(),
                            now: "2026-05-09T10:30:00Z".to_string(),
                        }),
                    },
                ],
            )
            .await
            .unwrap_err();
            tx.rollback().await.unwrap();
            assert!(!err.is_empty());

            let title: String =
                sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title, "");
        });
    }

    #[test]
    fn batch_hard_delete_rejects_protected_rows() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2000-05-09T11:00:00Z",
                None,
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            let err = apply_delete_archive_operations_tx(
                &mut tx,
                vec![CalendarDeleteArchiveOperation::DeleteEvent {
                    target: CalendarEventMutationTarget {
                        id: "event-1".to_string(),
                        occurrence_start: None,
                        occurrence_end: None,
                    },
                }],
            )
            .await
            .unwrap_err();
            tx.rollback().await.unwrap();
            assert!(err.contains("archive it instead"));
        });
    }

    #[test]
    fn batch_archive_rejects_active_pomodoro_rows() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event(&pool, "event-1", "").await;
            insert_test_open_pomodoro_run(&pool).await;
            insert_test_active_pomodoro_segment(&pool).await;

            let mut tx = pool.begin().await.unwrap();
            let err = apply_delete_archive_operations_tx(
                &mut tx,
                vec![CalendarDeleteArchiveOperation::ArchiveEvent {
                    target: CalendarEventMutationTarget {
                        id: "event-1".to_string(),
                        occurrence_start: None,
                        occurrence_end: None,
                    },
                }],
            )
            .await
            .unwrap_err();
            tx.rollback().await.unwrap();
            assert!(err.contains("active pomodoro run"));
        });
    }

    #[test]
    fn batch_synthetic_archive_preserves_original_event_id() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "event-1",
                "2000-05-09T10:00:00Z",
                "2000-05-09T11:00:00Z",
                Some("FREQ=DAILY"),
            )
            .await;
            insert_test_completed_pomodoro_history(
                &pool,
                "event-1",
                "event-1::2000-05-10",
                "2000-05-10",
            )
            .await;

            let mut tx = pool.begin().await.unwrap();
            apply_delete_archive_operations_tx(
                &mut tx,
                vec![CalendarDeleteArchiveOperation::ArchiveEvent {
                    target: CalendarEventMutationTarget {
                        id: "event-1::2000-05-10".to_string(),
                        occurrence_start: Some("2000-05-10T10:00:00Z".to_string()),
                        occurrence_end: Some("2000-05-10T11:00:00Z".to_string()),
                    },
                }],
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let archived_source: String = sqlx::query_scalar(
                "SELECT source_event_id FROM calendar_events_archive WHERE id = 'event-1::2000-05-10'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let exdate_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM calendar_event_exdates
                 WHERE event_id = 'event-1' AND occurrence_date = '2000-05-10'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let run: (Option<String>, String) = sqlx::query_as(
                "SELECT event_id, original_event_id FROM pomodoro_runs WHERE id = 'run-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(archived_source, "event-1");
            assert_eq!(exdate_count, 1);
            assert_eq!(run.0, None);
            assert_eq!(run.1, "event-1::2000-05-10");
        });
    }

    #[test]
    fn batch_cap_updates_repeat_rule_and_timestamp() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event_at(
                &pool,
                "series-1",
                "2099-05-09T10:00:00Z",
                "2099-05-09T11:00:00Z",
                Some("FREQ=DAILY"),
            )
            .await;

            let before: String =
                sqlx::query_scalar("SELECT updated_at FROM calendar_events WHERE id = 'series-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();

            let mut tx = pool.begin().await.unwrap();
            cap_calendar_series_tx(
                &mut tx,
                "series-1",
                "2099-05-08",
                "FREQ=DAILY;UNTIL=20990508T235959Z",
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let row: (Option<String>, Option<String>, String) = sqlx::query_as(
                "SELECT repeat_until, rrule, updated_at FROM calendar_events WHERE id = 'series-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(row.0, Some("2099-05-08".to_string()));
            assert_eq!(row.1, Some("FREQ=DAILY;UNTIL=20990508T235959Z".to_string()));
            assert_ne!(row.2, before);
        });
    }

    #[test]
    fn rejects_confidential_event_visibility() {
        let mut event = event_create();
        event.visibility = "confidential".to_string();
        assert!(validate_event_create(&event).is_err());
        assert!(validate_update_field(&CalendarEventUpdateField::Visibility(
            "confidential".to_string()
        ))
        .is_err());
    }

    #[test]
    fn filters_excluded_progress_dates() {
        let dates = vec![
            "2026-05-07".to_string(),
            "2026-05-08".to_string(),
            "2026-05-09".to_string(),
        ];
        assert_eq!(
            filter_excluded_dates(dates, Some("2026-05-08")),
            vec!["2026-05-07".to_string(), "2026-05-09".to_string()]
        );
    }

    #[test]
    fn update_description_field_sanitizes_before_persistence() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event(&pool, "event-1", "").await;
            let mut tx = pool.begin().await.unwrap();

            apply_update_field(
                &mut tx,
                "event-1",
                &CalendarEventUpdateField::Description(
                    "<p onclick=\"alert(1)\">Safe <a href=\"javascript:alert(1)\">bad</a></p>"
                        .to_string(),
                ),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            let description: String =
                sqlx::query_scalar("SELECT description FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(description, "<p>Safe <a>bad</a></p>");
        });
    }

    #[test]
    fn copied_event_description_is_sanitized_after_split_or_detach_insert() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event(
                &pool,
                "event-1",
                "<div><img src=\"x\"><strong>Safe</strong></div>",
            )
            .await;
            let mut tx = pool.begin().await.unwrap();

            sanitize_stored_event_description(&mut tx, "event-1")
                .await
                .unwrap();
            tx.commit().await.unwrap();

            let description: String =
                sqlx::query_scalar("SELECT description FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(description, "<div><strong>Safe</strong></div>");
        });
    }

    async fn in_memory_pool() -> sqlx::SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::db::run_migrations(&pool).await.unwrap();
        pool
    }

    async fn insert_test_event(pool: &sqlx::SqlitePool, id: &str, description: &str) {
        insert_test_event_at(
            pool,
            id,
            "2026-05-09T10:00:00Z",
            "2026-05-09T11:00:00Z",
            None,
        )
        .await;
        sqlx::query("UPDATE calendar_events SET description = ? WHERE id = ?")
            .bind(description)
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn insert_test_event_at(
        pool: &sqlx::SqlitePool,
        id: &str,
        start_time: &str,
        end_time: &str,
        rrule: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO calendar_events
               (id, title, start_time, end_time, timezone, calendar_id,
                color, description, rrule, repeat_until, all_day, location, url,
                transparency, status, source_uid, visibility, priority, geo_lat, geo_lng,
                sequence,
                guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
                created_at, updated_at)
             VALUES (?, '', ?, ?,
                'America/Monterrey', 'local', NULL, '', ?, NULL,
                0, '', '', 'opaque', 'confirmed',
                NULL, 'public', NULL, NULL, NULL, 0,
                0, 1, 1, '2026-05-09 10:00:00', '2026-05-09 10:00:00')",
        )
        .bind(id)
        .bind(start_time)
        .bind(end_time)
        .bind(rrule)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_test_open_pomodoro_run(pool: &sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO pomodoro_runs
                (id, event_id, original_event_id, event_date, planned_start, planned_end,
                 started_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                 start_trigger)
             VALUES ('run-1', 'event-1', 'event-1', '2026-05-09',
                     '2026-05-09T10:00:00Z', '2026-05-09T11:00:00Z',
                     '2026-05-09T10:00:00Z', 'count', 'preset', 'auto',
                     '2026-05-09T10:05:00Z', 'manual')",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_test_active_pomodoro_segment(pool: &sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, rhythm_position, phase,
                 planned_start, planned_end, actual_start, status)
             VALUES ('segment-1', 'event-1', '2026-05-09', 'run-1', 1, 'focus',
                     '2026-05-09T10:00:00Z', '2026-05-09T10:40:00Z',
                     '2026-05-09T10:00:00Z', 'active')",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_test_pomodoro_config(pool: &sqlx::SqlitePool, event_id: &str) {
        sqlx::query(
            "INSERT INTO pomodoro_configs
                (event_id, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes)
             VALUES (?, 'count', 'preset', 'auto', 3)",
        )
        .bind(event_id)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_config_count_rhythms
                (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes,
                 long_break_after_focus_count)
             VALUES (?, 40, 5, 10, 4)",
        )
        .bind(event_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_test_completed_pomodoro_history(
        pool: &sqlx::SqlitePool,
        event_id: &str,
        original_event_id: &str,
        event_date: &str,
    ) {
        let planned_start = format!("{event_date}T10:00:00Z");
        let segment_end = format!("{event_date}T10:40:00Z");
        let planned_end = format!("{event_date}T11:00:00Z");
        sqlx::query(
            "INSERT INTO pomodoro_runs
                (id, event_id, original_event_id, event_date, planned_start, planned_end,
                 started_at, ended_at, end_reason, rhythm_kind, rhythm_source, preset_key,
                 last_heartbeat,
                 start_trigger)
             VALUES ('run-1', ?, ?, ?, ?, ?, ?, ?, 'completed',
                     'count', 'preset', 'auto', ?, 'manual')",
        )
        .bind(event_id)
        .bind(original_event_id)
        .bind(event_date)
        .bind(&planned_start)
        .bind(&planned_end)
        .bind(&planned_start)
        .bind(&segment_end)
        .bind(&segment_end)
        .execute(pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, rhythm_position, phase,
                 planned_start, planned_end, actual_start, actual_end, status, end_reason)
             VALUES ('segment-1', ?, ?, 'run-1', 1, 'focus',
                     ?, ?, ?, ?, 'completed', 'completed')",
        )
        .bind(event_id)
        .bind(event_date)
        .bind(&planned_start)
        .bind(&segment_end)
        .bind(&planned_start)
        .bind(&segment_end)
        .execute(pool)
        .await
        .unwrap();
    }
}
