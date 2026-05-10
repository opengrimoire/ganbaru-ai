use serde::Deserialize;
use sqlx::Connection;
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

#[tauri::command]
pub async fn calendar_add_event<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    event: CalendarEventCreate,
) -> Result<(), String> {
    validate_event_create(&event)?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

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
    let mut conn = connect_sqlite(&app, &db_url).await?;
    sqlx::query("DELETE FROM calendar_events WHERE id = ?")
        .bind(id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("delete calendar event: {e}"))?;
    Ok(())
}

fn validate_event_create(event: &CalendarEventCreate) -> Result<(), String> {
    require_non_empty(&event.id, "id")?;
    require_non_empty(&event.title, "title")?;
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

fn require_non_empty(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} cannot be empty"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_color, validate_non_negative, validate_positive, validate_priority};

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
}
