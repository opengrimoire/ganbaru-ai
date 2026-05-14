use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, Transaction};
use tauri::{AppHandle, Runtime};

use crate::calendar_description::{
    sanitize_calendar_description_html, sanitize_optional_calendar_description,
};
use crate::db_path::connect_sqlite;

const PALETTE_SIZE: i64 = 24;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarBulkImportPayload {
    target_calendar_id: String,
    now: String,
    events: Vec<CalendarImportEvent>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarImportEvent {
    candidate_id: String,
    title: String,
    start_time: String,
    end_time: String,
    timezone: String,
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
    guest_can_modify: bool,
    guest_can_invite_others: bool,
    guest_can_see_other_guests: bool,
    attendees: Vec<CalendarImportAttendee>,
    alarms: Vec<CalendarImportAlarm>,
    overrides: Vec<CalendarImportOverride>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarImportAttendee {
    id: String,
    name: Option<String>,
    email: String,
    role: String,
    status: String,
    rsvp: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarImportAlarm {
    id: String,
    action: String,
    trigger_type: String,
    trigger_value: String,
    description: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarImportOverride {
    id: String,
    recurrence_id: String,
    title: Option<String>,
    start_time: Option<String>,
    end_time: Option<String>,
    description: Option<String>,
    location: Option<String>,
    url: Option<String>,
    color: Option<i64>,
    status: Option<String>,
    transparency: Option<String>,
    visibility: Option<String>,
    extended_properties: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarBulkImportSummary {
    added: usize,
    updated: usize,
    skipped_older: usize,
    warnings: Vec<String>,
    applied: Vec<CalendarImportApplied>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarImportApplied {
    candidate_id: String,
    event_id: String,
    action: CalendarImportAction,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum CalendarImportAction {
    Added,
    Updated,
}

struct ExistingEventRow {
    id: String,
    sequence: i64,
}

#[tauri::command]
pub async fn calendar_bulk_import<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    payload: CalendarBulkImportPayload,
) -> Result<CalendarBulkImportSummary, String> {
    validate_payload(&payload)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;
    let existing = load_existing_events(&mut tx, &payload).await?;
    let mut seen_source_uids = HashSet::new();
    let mut skipped_older = 0;
    let mut warnings = Vec::new();
    let mut applied = Vec::new();

    for event in &payload.events {
        let Some(source_uid) = event
            .source_uid
            .as_deref()
            .filter(|uid| !uid.trim().is_empty())
        else {
            warnings.push("Event without UID skipped.".to_string());
            continue;
        };
        if !seen_source_uids.insert(source_uid.to_string()) {
            warnings.push("Duplicate UID skipped.".to_string());
            continue;
        }

        if let Some(existing_row) = existing.get(source_uid) {
            if event.sequence < existing_row.sequence {
                skipped_older += 1;
                continue;
            }
            update_event(
                &mut tx,
                &payload.target_calendar_id,
                &payload.now,
                event,
                &existing_row.id,
            )
            .await?;
            replace_child_rows(&mut tx, &existing_row.id, event).await?;
            applied.push(CalendarImportApplied {
                candidate_id: event.candidate_id.clone(),
                event_id: existing_row.id.clone(),
                action: CalendarImportAction::Updated,
            });
        } else {
            insert_event(&mut tx, &payload.target_calendar_id, &payload.now, event).await?;
            insert_child_rows(&mut tx, &event.candidate_id, event).await?;
            applied.push(CalendarImportApplied {
                candidate_id: event.candidate_id.clone(),
                event_id: event.candidate_id.clone(),
                action: CalendarImportAction::Added,
            });
        }
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    let added = applied
        .iter()
        .filter(|event| matches!(event.action, CalendarImportAction::Added))
        .count();
    let updated = applied.len() - added;
    Ok(CalendarBulkImportSummary {
        added,
        updated,
        skipped_older,
        warnings,
        applied,
    })
}

async fn load_existing_events(
    tx: &mut Transaction<'_, Sqlite>,
    payload: &CalendarBulkImportPayload,
) -> Result<HashMap<String, ExistingEventRow>, String> {
    let source_uids: Vec<&str> = payload
        .events
        .iter()
        .filter_map(|event| event.source_uid.as_deref())
        .filter(|uid| !uid.trim().is_empty())
        .collect();
    let mut existing = HashMap::new();
    for chunk in source_uids.chunks(500) {
        if chunk.is_empty() {
            continue;
        }
        let placeholders = vec!["?"; chunk.len()].join(", ");
        let query = format!(
            "SELECT id, source_uid, sequence FROM calendar_events
             WHERE calendar_id = ? AND source_uid IN ({placeholders})"
        );
        let mut q = sqlx::query(&query).bind(&payload.target_calendar_id);
        for uid in chunk {
            q = q.bind(*uid);
        }
        let rows = q
            .fetch_all(&mut **tx)
            .await
            .map_err(|e| format!("load existing import rows: {e}"))?;
        for row in rows {
            let source_uid: String = row
                .try_get("source_uid")
                .map_err(|e| format!("read existing source_uid: {e}"))?;
            let sequence: Option<i64> = row
                .try_get("sequence")
                .map_err(|e| format!("read existing sequence: {e}"))?;
            existing.insert(
                source_uid,
                ExistingEventRow {
                    id: row
                        .try_get("id")
                        .map_err(|e| format!("read existing id: {e}"))?,
                    sequence: sequence.unwrap_or(0),
                },
            );
        }
    }
    Ok(existing)
}

async fn insert_event(
    tx: &mut Transaction<'_, Sqlite>,
    target_calendar_id: &str,
    now: &str,
    event: &CalendarImportEvent,
) -> Result<(), String> {
    let description = sanitize_calendar_description_html(&event.description);
    sqlx::query(
        "INSERT INTO calendar_events
            (id, title, start_time, end_time, timezone, calendar_id,
             color, description, rrule, notifications, exceptions, repeat_until,
             all_day, location, url, transparency, status,
             source_uid, visibility, priority, categories, geo,
             sequence, rdate, extended_properties, organizer,
             guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&event.candidate_id)
    .bind(&event.title)
    .bind(&event.start_time)
    .bind(&event.end_time)
    .bind(&event.timezone)
    .bind(target_calendar_id)
    .bind(event.color)
    .bind(&description)
    .bind(&event.rrule)
    .bind(&event.notifications)
    .bind(&event.exceptions)
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
    .bind(now)
    .bind(now)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert imported event: {e}"))?;
    Ok(())
}

async fn update_event(
    tx: &mut Transaction<'_, Sqlite>,
    target_calendar_id: &str,
    now: &str,
    event: &CalendarImportEvent,
    event_id: &str,
) -> Result<(), String> {
    let description = sanitize_calendar_description_html(&event.description);
    let result = sqlx::query(
        "UPDATE calendar_events
            SET title = ?, start_time = ?, end_time = ?, timezone = ?,
                color = ?, description = ?,
                rrule = ?, notifications = ?, exceptions = ?, repeat_until = ?,
                all_day = ?, location = ?, url = ?,
                transparency = ?, status = ?,
                visibility = ?, priority = ?,
                categories = ?, geo = ?,
                sequence = ?, rdate = ?, extended_properties = ?, organizer = ?,
                guest_can_modify = ?, guest_can_invite_others = ?,
                guest_can_see_other_guests = ?,
                updated_at = ?
          WHERE id = ? AND calendar_id = ?",
    )
    .bind(&event.title)
    .bind(&event.start_time)
    .bind(&event.end_time)
    .bind(&event.timezone)
    .bind(event.color)
    .bind(&description)
    .bind(&event.rrule)
    .bind(&event.notifications)
    .bind(&event.exceptions)
    .bind(&event.repeat_until)
    .bind(if event.all_day { 1_i64 } else { 0_i64 })
    .bind(&event.location)
    .bind(&event.url)
    .bind(&event.transparency)
    .bind(&event.status)
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
    .bind(now)
    .bind(event_id)
    .bind(target_calendar_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("update imported event: {e}"))?;
    if result.rows_affected() == 0 {
        return Err(format!("import target event '{event_id}' not found"));
    }
    Ok(())
}

async fn replace_child_rows(
    tx: &mut Transaction<'_, Sqlite>,
    event_id: &str,
    event: &CalendarImportEvent,
) -> Result<(), String> {
    for query in [
        "DELETE FROM calendar_event_attendees WHERE event_id = ?",
        "DELETE FROM calendar_event_alarms WHERE event_id = ?",
        "DELETE FROM calendar_event_overrides WHERE parent_event_id = ?",
    ] {
        sqlx::query(query)
            .bind(event_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("delete imported event children: {e}"))?;
    }
    insert_child_rows(tx, event_id, event).await
}

async fn insert_child_rows(
    tx: &mut Transaction<'_, Sqlite>,
    event_id: &str,
    event: &CalendarImportEvent,
) -> Result<(), String> {
    for (sort_order, attendee) in event.attendees.iter().enumerate() {
        sqlx::query(
            "INSERT INTO calendar_event_attendees
                (id, event_id, name, email, role, status, rsvp, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&attendee.id)
        .bind(event_id)
        .bind(&attendee.name)
        .bind(&attendee.email)
        .bind(&attendee.role)
        .bind(&attendee.status)
        .bind(if attendee.rsvp { 1_i64 } else { 0_i64 })
        .bind(sort_order as i64)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("insert imported attendee: {e}"))?;
    }

    for (sort_order, alarm) in event.alarms.iter().enumerate() {
        sqlx::query(
            "INSERT INTO calendar_event_alarms
                (id, event_id, action, trigger_type, trigger_value, description, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&alarm.id)
        .bind(event_id)
        .bind(&alarm.action)
        .bind(&alarm.trigger_type)
        .bind(&alarm.trigger_value)
        .bind(&alarm.description)
        .bind(sort_order as i64)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("insert imported alarm: {e}"))?;
    }

    for override_row in &event.overrides {
        let description = sanitize_optional_calendar_description(&override_row.description);
        sqlx::query(
            "INSERT INTO calendar_event_overrides
                (id, parent_event_id, recurrence_id, title, start_time, end_time,
                 description, location, url, color, status, transparency, visibility,
                 extended_properties)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&override_row.id)
        .bind(event_id)
        .bind(&override_row.recurrence_id)
        .bind(&override_row.title)
        .bind(&override_row.start_time)
        .bind(&override_row.end_time)
        .bind(&description)
        .bind(&override_row.location)
        .bind(&override_row.url)
        .bind(override_row.color)
        .bind(&override_row.status)
        .bind(&override_row.transparency)
        .bind(&override_row.visibility)
        .bind(&override_row.extended_properties)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("insert imported override: {e}"))?;
    }
    Ok(())
}

fn validate_payload(payload: &CalendarBulkImportPayload) -> Result<(), String> {
    require_non_empty(&payload.target_calendar_id, "target_calendar_id")?;
    require_non_empty(&payload.now, "now")?;
    for event in &payload.events {
        validate_event(event)?;
    }
    Ok(())
}

fn validate_event(event: &CalendarImportEvent) -> Result<(), String> {
    require_non_empty(&event.candidate_id, "candidate_id")?;
    require_non_empty(&event.start_time, "start_time")?;
    require_non_empty(&event.end_time, "end_time")?;
    require_non_empty(&event.timezone, "timezone")?;
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
    validate_json_option(&event.exceptions, "exceptions")?;
    validate_json_option(&event.categories, "categories")?;
    validate_json_option(&event.geo, "geo")?;
    validate_json_option(&event.rdate, "rdate")?;
    validate_json_option(&event.extended_properties, "extended_properties")?;
    validate_json_option(&event.organizer, "organizer")?;
    for attendee in &event.attendees {
        validate_attendee(attendee)?;
    }
    for alarm in &event.alarms {
        validate_alarm(alarm)?;
    }
    for override_row in &event.overrides {
        validate_override(override_row)?;
    }
    Ok(())
}

fn validate_attendee(attendee: &CalendarImportAttendee) -> Result<(), String> {
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

fn validate_alarm(alarm: &CalendarImportAlarm) -> Result<(), String> {
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

fn validate_override(override_row: &CalendarImportOverride) -> Result<(), String> {
    require_non_empty(&override_row.id, "override.id")?;
    require_non_empty(&override_row.recurrence_id, "override.recurrence_id")?;
    validate_color(override_row.color, "override.color")?;
    if let Some(status) = &override_row.status {
        validate_enum(
            status,
            "override.status",
            &["confirmed", "tentative", "cancelled"],
        )?;
    }
    if let Some(transparency) = &override_row.transparency {
        validate_enum(
            transparency,
            "override.transparency",
            &["opaque", "transparent"],
        )?;
    }
    if let Some(visibility) = &override_row.visibility {
        validate_enum(
            visibility,
            "override.visibility",
            &["public", "private", "confidential"],
        )?;
    }
    validate_json_option(
        &override_row.extended_properties,
        "override.extended_properties",
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
    use super::{
        insert_child_rows, insert_event, update_event, validate_color, validate_enum,
        validate_json_option, validate_priority, CalendarImportEvent, CalendarImportOverride,
    };

    #[test]
    fn validates_calendar_import_enums() {
        assert!(validate_enum("confirmed", "status", &["confirmed"]).is_ok());
        assert!(validate_enum("cancelled", "status", &["confirmed"]).is_err());
    }

    #[test]
    fn validates_calendar_import_color_and_priority_ranges() {
        assert!(validate_color(Some(0), "color").is_ok());
        assert!(validate_color(Some(23), "color").is_ok());
        assert!(validate_color(Some(24), "color").is_err());
        assert!(validate_priority(Some(9)).is_ok());
        assert!(validate_priority(Some(10)).is_err());
    }

    #[test]
    fn validates_json_payload_fields() {
        assert!(validate_json_option(&Some(r#"["a"]"#.to_string()), "categories").is_ok());
        assert!(validate_json_option(&Some("not json".to_string()), "categories").is_err());
    }

    #[test]
    fn imported_event_descriptions_are_sanitized_before_persistence() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            let event = import_event(
                "event-1",
                "<p onclick=\"alert(1)\">Safe <strong>text</strong></p>",
            );
            let mut tx = pool.begin().await.unwrap();

            insert_event(&mut tx, "local", "2026-05-09 10:00:00", &event)
                .await
                .unwrap();
            tx.commit().await.unwrap();

            let description: String =
                sqlx::query_scalar("SELECT description FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(description, "<p>Safe <strong>text</strong></p>");
        });
    }

    #[test]
    fn updated_imported_event_descriptions_are_sanitized_before_persistence() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            let initial = import_event("event-1", "Initial");
            let updated = import_event(
                "event-1",
                "<div><img src=\"x\" onerror=\"alert(1)\"><u>Override</u></div>",
            );
            let mut tx = pool.begin().await.unwrap();

            insert_event(&mut tx, "local", "2026-05-09 10:00:00", &initial)
                .await
                .unwrap();
            update_event(&mut tx, "local", "2026-05-09 10:05:00", &updated, "event-1")
                .await
                .unwrap();
            tx.commit().await.unwrap();

            let description: String =
                sqlx::query_scalar("SELECT description FROM calendar_events WHERE id = 'event-1'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(description, "<div><u>Override</u></div>");
        });
    }

    #[test]
    fn imported_override_descriptions_are_sanitized_before_persistence() {
        tauri::async_runtime::block_on(async {
            let pool = in_memory_pool().await;
            let mut event = import_event("event-1", "Parent");
            event.overrides = vec![CalendarImportOverride {
                id: "override-1".to_string(),
                recurrence_id: "2026-05-10".to_string(),
                title: None,
                start_time: None,
                end_time: None,
                description: Some("<p><script>alert(1)</script><u>Safe</u></p>".to_string()),
                location: None,
                url: None,
                color: None,
                status: None,
                transparency: None,
                visibility: None,
                extended_properties: None,
            }];
            let mut tx = pool.begin().await.unwrap();

            insert_event(&mut tx, "local", "2026-05-09 10:00:00", &event)
                .await
                .unwrap();
            insert_child_rows(&mut tx, "event-1", &event).await.unwrap();
            tx.commit().await.unwrap();

            let description: String = sqlx::query_scalar(
                "SELECT description FROM calendar_event_overrides WHERE id = 'override-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(description, "<p><u>Safe</u></p>");
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

    fn import_event(id: &str, description: &str) -> CalendarImportEvent {
        CalendarImportEvent {
            candidate_id: id.to_string(),
            title: "Focus".to_string(),
            start_time: "2026-05-09T10:00:00Z".to_string(),
            end_time: "2026-05-09T11:00:00Z".to_string(),
            timezone: "America/Monterrey".to_string(),
            color: None,
            description: description.to_string(),
            rrule: None,
            notifications: None,
            exceptions: None,
            repeat_until: None,
            all_day: false,
            location: String::new(),
            url: String::new(),
            transparency: "opaque".to_string(),
            status: "confirmed".to_string(),
            source_uid: Some(id.to_string()),
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
            attendees: Vec::new(),
            alarms: Vec::new(),
            overrides: Vec::new(),
        }
    }
}
