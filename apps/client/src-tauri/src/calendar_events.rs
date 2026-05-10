use serde::Deserialize;
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

const PALETTE_SIZE: i64 = 24;

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
    focus_duration_minutes: i64,
    short_break_minutes: i64,
    long_break_minutes: i64,
    pomodoro_count: i64,
    idle_timeout_minutes: Option<i64>,
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
    #[serde(rename = "guestPermissions")]
    GuestPermissions(CalendarGuestPermissions),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarGuestPermissions {
    guest_can_modify: bool,
    guest_can_invite_others: bool,
    guest_can_see_other_guests: bool,
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
    rrule: Option<String>,
    all_day: bool,
    location: String,
    transparency: String,
    status: String,
    description_patch: Option<String>,
    url_patch: Option<String>,
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

    sqlx::query(
        "INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, rrule, notifications, repeat_until,
            all_day, location, url, transparency, status,
            source_uid, visibility, priority, categories, geo,
            sequence, rdate, extended_properties, organizer,
            guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&event.id)
    .bind(&event.title)
    .bind(&event.start_time)
    .bind(&event.end_time)
    .bind(&event.timezone)
    .bind(&event.calendar_id)
    .bind(event.color)
    .bind(&event.description)
    .bind(&event.rrule)
    .bind(&event.notifications)
    .bind(&event.repeat_until)
    .bind(if event.all_day { 1_i64 } else { 0_i64 })
    .bind(&event.location)
    .bind(&event.url)
    .bind(&event.transparency)
    .bind(&event.status)
    .bind(&event.source_uid)
    .bind(&event.visibility)
    .bind(event.priority)
    .bind(&event.categories)
    .bind(&event.geo)
    .bind(event.sequence)
    .bind(&event.rdate)
    .bind(&event.extended_properties)
    .bind(&event.organizer)
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
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("insert calendar event: {e}"))?;

    if let Some(config) = &event.pomodoro_config {
        sqlx::query(
            "INSERT INTO pomodoro_configs
               (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count, idle_timeout_minutes)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&event.id)
        .bind(config.focus_duration_minutes)
        .bind(config.short_break_minutes)
        .bind(config.long_break_minutes)
        .bind(config.pomodoro_count)
        .bind(config.idle_timeout_minutes)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("insert calendar pomodoro config: {e}"))?;
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
    id: String,
) -> Result<(), String> {
    require_non_empty(&id, "id")?;
    let pool = connect_sqlite(app, db_url).await?;
    sqlx::query("DELETE FROM calendar_events WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|e| format!("delete calendar event: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn calendar_clear_events<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<(), String> {
    let pool = connect_sqlite(app, db_url).await?;
    sqlx::query("DELETE FROM calendar_events")
        .execute(&pool)
        .await
        .map_err(|e| format!("clear calendar events: {e}"))?;
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

    for field in &patch.fields {
        apply_update_field(&mut tx, &patch.id, field).await?;
    }

    if let Some(attendees) = &patch.attendees {
        sqlx::query("DELETE FROM calendar_event_attendees WHERE event_id = ?")
            .bind(&patch.id)
            .execute(&mut *tx)
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
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("insert calendar attendee: {e}"))?;
        }
    }

    if let Some(alarms) = &patch.alarms {
        sqlx::query("DELETE FROM calendar_event_alarms WHERE event_id = ?")
            .bind(&patch.id)
            .execute(&mut *tx)
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
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("insert calendar alarm: {e}"))?;
        }
    }

    if let Some(config_patch) = &patch.pomodoro_config {
        match config_patch {
            CalendarPomodoroConfigPatch::Set(config) => {
                sqlx::query(
                    "INSERT OR REPLACE INTO pomodoro_configs
                       (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count, idle_timeout_minutes)
                     VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(&patch.id)
                .bind(config.focus_duration_minutes)
                .bind(config.short_break_minutes)
                .bind(config.long_break_minutes)
                .bind(config.pomodoro_count)
                .bind(config.idle_timeout_minutes)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("upsert calendar pomodoro config: {e}"))?;
            }
            CalendarPomodoroConfigPatch::Clear => {
                sqlx::query("DELETE FROM pomodoro_configs WHERE event_id = ?")
                    .bind(&patch.id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| format!("delete calendar pomodoro config: {e}"))?;
            }
        }
    }

    let result = sqlx::query("UPDATE calendar_events SET updated_at = ? WHERE id = ?")
        .bind(&patch.updated_at)
        .bind(&patch.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("touch calendar event: {e}"))?;
    if result.rows_affected() == 0 {
        return Err(format!("calendar event '{}' not found", patch.id));
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

    let result =
        sqlx::query("UPDATE calendar_events SET exceptions = ?, updated_at = ? WHERE id = ?")
            .bind(&input.exceptions)
            .bind(&input.now)
            .bind(&input.parent_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("update detached parent exceptions: {e}"))?;
    if result.rows_affected() == 0 {
        return Err(format!("calendar event '{}' not found", input.parent_id));
    }

    sqlx::query(
        "INSERT INTO calendar_events (
           id, title, start_time, end_time, timezone, calendar_id,
           color, notifications, rrule, repeat_until, exceptions, rdate,
           all_day, location, transparency, status,
           source_uid,
           description, url, visibility, priority, categories, geo,
           sequence, extended_properties, organizer,
           guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
           created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?,
                ?, ?, NULL, NULL, NULL, NULL,
                ?, ?, ?, ?,
                NULL,
                description, url, visibility, priority, categories, geo,
                sequence, extended_properties, organizer,
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
    .bind(&input.notifications)
    .bind(if input.all_day { 1_i64 } else { 0_i64 })
    .bind(&input.location)
    .bind(&input.transparency)
    .bind(&input.status)
    .bind(&input.now)
    .bind(&input.now)
    .bind(&input.parent_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("insert detached event: {e}"))?;

    copy_pomodoro_config(&mut tx, &input.parent_id, &input.new_id).await?;
    copy_attendees(&mut tx, &input.parent_id, &input.new_id).await?;

    sqlx::query(
        "UPDATE pomodoro_segments SET event_id = ?
         WHERE event_id IN (?, ? || '::' || ?) AND event_date = ?",
    )
    .bind(&input.new_id)
    .bind(&input.parent_id)
    .bind(&input.parent_id)
    .bind(&input.instance_date)
    .bind(&input.instance_date)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("move detached pomodoro segments: {e}"))?;

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

    let result = sqlx::query(
        "UPDATE calendar_events SET repeat_until = ?, rrule = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&input.day_before)
    .bind(&input.capped_rrule)
    .bind(&input.now)
    .bind(&input.parent_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("cap split parent series: {e}"))?;
    if result.rows_affected() == 0 {
        return Err(format!("calendar event '{}' not found", input.parent_id));
    }

    sqlx::query(
        "INSERT INTO calendar_events (
           id, title, start_time, end_time, timezone, calendar_id,
           color, notifications, rrule, repeat_until, exceptions, rdate,
           all_day, location, transparency, status,
           source_uid,
           description, url, visibility, priority, categories, geo,
           sequence, extended_properties, organizer,
           guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
           created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?,
                ?, ?, ?, NULL, NULL, NULL,
                ?, ?, ?, ?,
                NULL,
                COALESCE(?, description),
                COALESCE(?, url),
                visibility, priority, categories, geo,
                sequence, extended_properties, organizer,
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
    .bind(&input.notifications)
    .bind(&input.rrule)
    .bind(if input.all_day { 1_i64 } else { 0_i64 })
    .bind(&input.location)
    .bind(&input.transparency)
    .bind(&input.status)
    .bind(&input.description_patch)
    .bind(&input.url_patch)
    .bind(&input.now)
    .bind(&input.now)
    .bind(&input.parent_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("insert split series event: {e}"))?;

    if let Some(config) = &input.pomodoro_config {
        insert_pomodoro_config(&mut tx, &input.new_id, config).await?;
    } else {
        copy_pomodoro_config(&mut tx, &input.parent_id, &input.new_id).await?;
    }
    copy_attendees(&mut tx, &input.parent_id, &input.new_id).await?;

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
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
           AND status IN ('completed', 'interrupted', 'skipped')
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
           AND status IN ('completed', 'interrupted', 'skipped')
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
           (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count, idle_timeout_minutes)
         SELECT ?, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count, idle_timeout_minutes
         FROM pomodoro_configs WHERE event_id = ?",
    )
    .bind(target_event_id)
    .bind(source_event_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("copy pomodoro config: {e}"))?;
    Ok(())
}

async fn insert_pomodoro_config(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: &str,
    config: &CalendarPomodoroConfig,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO pomodoro_configs
           (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes, pomodoro_count, idle_timeout_minutes)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(event_id)
    .bind(config.focus_duration_minutes)
    .bind(config.short_break_minutes)
    .bind(config.long_break_minutes)
    .bind(config.pomodoro_count)
    .bind(config.idle_timeout_minutes)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert pomodoro config: {e}"))?;
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
            update_text(tx, id, "description", value).await
        }
        CalendarEventUpdateField::Rrule(value) => {
            update_optional_text(tx, id, "rrule", value.as_deref()).await
        }
        CalendarEventUpdateField::RepeatUntil(value) => {
            update_optional_text(tx, id, "repeat_until", value.as_deref()).await
        }
        CalendarEventUpdateField::Notifications(value) => {
            update_optional_text(tx, id, "notifications", value.as_deref()).await
        }
        CalendarEventUpdateField::Exceptions(value) => {
            update_optional_text(tx, id, "exceptions", value.as_deref()).await
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
            update_optional_text(tx, id, "categories", value.as_deref()).await
        }
        CalendarEventUpdateField::Geo(value) => {
            update_optional_text(tx, id, "geo", value.as_deref()).await
        }
        CalendarEventUpdateField::Sequence(value) => update_i64(tx, id, "sequence", *value).await,
        CalendarEventUpdateField::Rdate(value) => {
            update_optional_text(tx, id, "rdate", value.as_deref()).await
        }
        CalendarEventUpdateField::ExtendedProperties(value) => {
            update_optional_text(tx, id, "extended_properties", value.as_deref()).await
        }
        CalendarEventUpdateField::Organizer(value) => {
            update_optional_text(tx, id, "organizer", value.as_deref()).await
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
    validate_enum(
        &event.visibility,
        "visibility",
        &["public", "private", "confidential"],
    )?;
    validate_priority(event.priority)?;
    validate_non_negative(event.sequence, "sequence")?;
    validate_json_option(&event.notifications, "notifications")?;
    validate_json_option(&event.categories, "categories")?;
    validate_json_option(&event.geo, "geo")?;
    validate_json_option(&event.rdate, "rdate")?;
    validate_json_option(&event.extended_properties, "extended_properties")?;
    validate_json_option(&event.organizer, "organizer")?;
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
    if let Some(config) = &input.pomodoro_config {
        validate_pomodoro_config(config)?;
    }
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
            validate_enum(value, "visibility", &["public", "private", "confidential"])
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
        CalendarEventUpdateField::GuestPermissions(_) => Ok(()),
    }
}

fn validate_pomodoro_config(config: &CalendarPomodoroConfig) -> Result<(), String> {
    validate_positive(config.focus_duration_minutes, "focus_duration_minutes")?;
    validate_positive(config.short_break_minutes, "short_break_minutes")?;
    validate_positive(config.long_break_minutes, "long_break_minutes")?;
    validate_positive(config.pomodoro_count, "pomodoro_count")?;
    if let Some(idle) = config.idle_timeout_minutes {
        validate_non_negative(idle, "idle_timeout_minutes")?;
    }
    Ok(())
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
        filter_excluded_dates, validate_color, validate_event_create, validate_non_negative,
        validate_positive, validate_priority, validate_update_field, CalendarEventCreate,
        CalendarEventUpdateField,
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
            guest_can_modify: false,
            guest_can_invite_others: true,
            guest_can_see_other_guests: true,
            created_at: "2026-05-09 10:00:00".to_string(),
            updated_at: "2026-05-09 10:00:00".to_string(),
            pomodoro_config: None,
            attendees: Vec::new(),
        }
    }

    #[test]
    fn validates_event_color_and_priority_ranges() {
        assert!(validate_color(Some(0), "color").is_ok());
        assert!(validate_color(Some(23), "color").is_ok());
        assert!(validate_color(Some(24), "color").is_err());
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
}
