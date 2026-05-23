use serde::Deserialize;
use tauri::{AppHandle, Runtime};

use crate::calendar_description::{
    sanitize_calendar_description_html, sanitize_optional_calendar_description,
};
use crate::db_path::connect_sqlite;

const PALETTE_SIZE: i64 = 32;

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
    #[serde(rename = "meetingEnabled")]
    MeetingEnabled(bool),
    #[serde(rename = "localRsvpStatus")]
    LocalRsvpStatus(Option<String>),
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
    rrule: Option<String>,
    all_day: bool,
    location: String,
    transparency: String,
    status: String,
    description_patch: Option<String>,
    url_patch: Option<String>,
    local_rsvp_status: Option<String>,
    meeting_enabled: bool,
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
    id: String,
) -> Result<(), String> {
    require_non_empty(&id, "id")?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    close_open_pomodoro_runs_for_deleted_event(&mut tx, Some(&id)).await?;
    sqlx::query("DELETE FROM calendar_events WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("delete calendar event: {e}"))?;
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
    close_open_pomodoro_runs_for_deleted_event(&mut tx, None).await?;
    sqlx::query("DELETE FROM calendar_events")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("clear calendar events: {e}"))?;
    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

async fn close_open_pomodoro_runs_for_deleted_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    event_id: Option<&str>,
) -> Result<(), String> {
    let stopped_at: String = sqlx::query_scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("read current time: {e}"))?;

    let run_ids: Vec<String> = if let Some(event_id) = event_id {
        sqlx::query_scalar(
            "SELECT id
             FROM pomodoro_runs
             WHERE ended_at IS NULL
               AND (event_id = ? OR original_event_id = ?)",
        )
        .bind(event_id)
        .bind(event_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| format!("load open pomodoro runs for deleted event: {e}"))?
    } else {
        sqlx::query_scalar(
            "SELECT id
             FROM pomodoro_runs
             WHERE ended_at IS NULL",
        )
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| format!("load open pomodoro runs for clear: {e}"))?
    };

    for run_id in run_ids {
        sqlx::query(
            "UPDATE pomodoro_pauses
             SET ended_at = ?
             WHERE ended_at IS NULL
               AND segment_id IN (
                 SELECT id FROM pomodoro_segments WHERE run_id = ?
               )",
        )
        .bind(&stopped_at)
        .bind(&run_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("close pomodoro pauses before deleting event: {e}"))?;

        sqlx::query(
            "UPDATE pomodoro_segments
             SET status = 'interrupted',
                 actual_end = COALESCE(actual_end, ?),
                 end_reason = COALESCE(end_reason, 'stopped')
             WHERE run_id = ? AND status = 'active'",
        )
        .bind(&stopped_at)
        .bind(&run_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("close pomodoro segments before deleting event: {e}"))?;

        sqlx::query(
            "INSERT OR IGNORE INTO pomodoro_run_events
                (id, run_id, segment_id, event_type, occurred_at, phase, reason, duration_seconds)
             VALUES (?, ?, NULL, 'stop', ?, NULL, 'stopped', NULL)",
        )
        .bind(format!("{run_id}:calendar-delete-stop"))
        .bind(&run_id)
        .bind(&stopped_at)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("record pomodoro stop before deleting event: {e}"))?;

        sqlx::query(
            "UPDATE pomodoro_runs
             SET ended_at = ?, end_reason = 'stopped', last_heartbeat = ?
             WHERE id = ? AND ended_at IS NULL",
        )
        .bind(&stopped_at)
        .bind(&stopped_at)
        .bind(&run_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("close pomodoro run before deleting event: {e}"))?;
    }

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

    replace_string_list(
        &mut tx,
        &input.parent_id,
        "calendar_event_exdates",
        "occurrence_date",
        parse_string_list(&Some(input.exceptions.clone()), "exceptions")?,
    )
    .await?;
    let result = sqlx::query("UPDATE calendar_events SET updated_at = ? WHERE id = ?")
        .bind(&input.now)
        .bind(&input.parent_id)
        .execute(&mut *tx)
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
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("insert detached event: {e}"))?;
    sanitize_stored_event_description(&mut tx, &input.new_id).await?;
    replace_i64_list(
        &mut tx,
        &input.new_id,
        "calendar_event_notifications",
        "offset_minutes",
        parse_i64_list(&input.notifications, "notifications")?,
    )
    .await?;
    copy_calendar_metadata(&mut tx, &input.parent_id, &input.new_id).await?;

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
    let description_patch = sanitize_optional_calendar_description(&input.description_patch);
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
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("insert split series event: {e}"))?;
    sanitize_stored_event_description(&mut tx, &input.new_id).await?;
    replace_i64_list(
        &mut tx,
        &input.new_id,
        "calendar_event_notifications",
        "offset_minutes",
        parse_i64_list(&input.notifications, "notifications")?,
    )
    .await?;
    copy_calendar_metadata(&mut tx, &input.parent_id, &input.new_id).await?;

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
    validate_json_option(&event.categories, "categories")?;
    validate_json_option(&event.geo, "geo")?;
    validate_json_option(&event.rdate, "rdate")?;
    validate_json_option(&event.extended_properties, "extended_properties")?;
    validate_json_option(&event.organizer, "organizer")?;
    validate_optional_attendee_status(&event.local_rsvp_status, "local_rsvp_status")?;
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
        apply_update_field, close_open_pomodoro_runs_for_deleted_event, filter_excluded_dates,
        insert_calendar_event_row, sanitize_stored_event_description, validate_color,
        validate_event_create, validate_non_negative, validate_positive, validate_priority,
        validate_update_field, CalendarEventCreate, CalendarEventUpdateField,
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
    fn deleting_event_closes_open_pomodoro_run_before_delete() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            insert_test_event(&pool, "event-1", "").await;
            insert_test_open_pomodoro_run(&pool).await;
            insert_test_active_pomodoro_segment(&pool).await;

            let mut tx = pool.begin().await.unwrap();
            close_open_pomodoro_runs_for_deleted_event(&mut tx, Some("event-1"))
                .await
                .unwrap();
            sqlx::query("DELETE FROM calendar_events WHERE id = 'event-1'")
                .execute(&mut *tx)
                .await
                .unwrap();
            tx.commit().await.unwrap();

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
            let stop_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)
                 FROM pomodoro_run_events
                 WHERE run_id = 'run-1' AND event_type = 'stop'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert!(run.0.is_some());
            assert_eq!(run.1, None);
            assert_eq!(segment.0, "interrupted");
            assert_eq!(segment.1, None);
            assert_eq!(stop_count, 1);
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
        sqlx::query(
            "INSERT INTO calendar_events
               (id, title, start_time, end_time, timezone, calendar_id,
                color, description, rrule, repeat_until, all_day, location, url,
                transparency, status, source_uid, visibility, priority, geo_lat, geo_lng,
                sequence,
                guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
                created_at, updated_at)
             VALUES (?, '', '2026-05-09T10:00:00Z', '2026-05-09T11:00:00Z',
                'America/Monterrey', 'local', NULL, ?, NULL, NULL,
                0, '', '', 'opaque', 'confirmed',
                NULL, 'public', NULL, NULL, NULL, 0,
                0, 1, 1, '2026-05-09 10:00:00', '2026-05-09 10:00:00')",
        )
        .bind(id)
        .bind(description)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_test_open_pomodoro_run(pool: &sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO pomodoro_runs
                (id, event_id, original_event_id, event_date, planned_start, planned_end,
                 started_at, focus_duration_minutes, short_break_minutes, long_break_minutes,
                 pomodoro_count, last_heartbeat, start_trigger)
             VALUES ('run-1', 'event-1', 'event-1', '2026-05-09',
                     '2026-05-09T10:00:00Z', '2026-05-09T11:00:00Z',
                     '2026-05-09T10:00:00Z', 40, 5, 10, 4,
                     '2026-05-09T10:05:00Z', 'manual')",
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_test_active_pomodoro_segment(pool: &sqlx::SqlitePool) {
        sqlx::query(
            "INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, cycle_number, phase,
                 planned_start, planned_end, actual_start, status)
             VALUES ('segment-1', 'event-1', '2026-05-09', 'run-1', 1, 'focus',
                     '2026-05-09T10:00:00Z', '2026-05-09T10:40:00Z',
                     '2026-05-09T10:00:00Z', 'active')",
        )
        .execute(pool)
        .await
        .unwrap();
    }
}
