use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarTimezoneHydration {
    events: Vec<EventTimezoneHydration>,
    overrides: Vec<OverrideTimezoneHydration>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventTimezoneHydration {
    id: String,
    start_time: String,
    end_time: String,
    timezone: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverrideTimezoneHydration {
    id: String,
    recurrence_id: String,
    start_time: Option<String>,
    end_time: Option<String>,
}

#[derive(Serialize)]
pub struct LegacyEventRow {
    id: String,
    start_time: String,
    end_time: String,
    timezone: String,
    all_day: i64,
}
impl_sqlite_from_row!(LegacyEventRow {
    id,
    start_time,
    end_time,
    timezone,
    all_day,
});

#[derive(Serialize)]
pub struct LegacyOverrideRow {
    id: String,
    recurrence_id: String,
    start_time: Option<String>,
    end_time: Option<String>,
    parent_event_id: String,
}
impl_sqlite_from_row!(LegacyOverrideRow {
    id,
    recurrence_id,
    start_time,
    end_time,
    parent_event_id,
});

#[derive(Serialize)]
pub struct ParentZoneRow {
    id: String,
    timezone: String,
    all_day: i64,
}
impl_sqlite_from_row!(ParentZoneRow {
    id,
    timezone,
    all_day,
});

#[derive(Serialize)]
pub struct CalendarTimezoneHydrationRows {
    events: Vec<LegacyEventRow>,
    overrides: Vec<LegacyOverrideRow>,
    parent_zones: Vec<ParentZoneRow>,
}

#[tauri::command]
pub async fn calendar_load_timezone_hydration_rows<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<CalendarTimezoneHydrationRows, String> {
    let pool = connect_sqlite(app, db_url).await?;
    let events = sqlx::query_as::<_, LegacyEventRow>(
        "SELECT id, start_time, end_time, timezone, all_day FROM calendar_events",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load calendar timezone events: {e}"))?;
    let overrides = sqlx::query_as::<_, LegacyOverrideRow>(
        "SELECT id, recurrence_id, start_time, end_time, parent_event_id
         FROM calendar_event_overrides",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load calendar timezone overrides: {e}"))?;
    let parent_zones = if overrides.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, ParentZoneRow>("SELECT id, timezone, all_day FROM calendar_events")
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("load calendar timezone parent zones: {e}"))?
    };

    Ok(CalendarTimezoneHydrationRows {
        events,
        overrides,
        parent_zones,
    })
}

#[tauri::command]
pub async fn calendar_apply_timezone_hydration<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    payload: CalendarTimezoneHydration,
) -> Result<(), String> {
    validate_payload(&payload)?;
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool.begin().await.map_err(|e| format!("begin: {e}"))?;

    for event in payload.events {
        let result = sqlx::query(
            "UPDATE calendar_events
             SET start_time = ?, end_time = ?, timezone = ?
             WHERE id = ?",
        )
        .bind(event.start_time)
        .bind(event.end_time)
        .bind(event.timezone)
        .bind(&event.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("hydrate calendar event timezone: {e}"))?;
        if result.rows_affected() == 0 {
            return Err(format!("calendar event not found: {}", event.id));
        }
    }

    for override_row in payload.overrides {
        let result = sqlx::query(
            "UPDATE calendar_event_overrides
             SET recurrence_id = ?, start_time = ?, end_time = ?
             WHERE id = ?",
        )
        .bind(override_row.recurrence_id)
        .bind(override_row.start_time)
        .bind(override_row.end_time)
        .bind(&override_row.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("hydrate calendar override timezone: {e}"))?;
        if result.rows_affected() == 0 {
            return Err(format!("calendar override not found: {}", override_row.id));
        }
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

fn validate_payload(payload: &CalendarTimezoneHydration) -> Result<(), String> {
    for event in &payload.events {
        require_non_empty(&event.id, "event.id")?;
        require_non_empty(&event.start_time, "event.start_time")?;
        require_non_empty(&event.end_time, "event.end_time")?;
        require_non_empty(&event.timezone, "event.timezone")?;
    }
    for override_row in &payload.overrides {
        require_non_empty(&override_row.id, "override.id")?;
        require_non_empty(&override_row.recurrence_id, "override.recurrence_id")?;
        validate_optional_non_empty(&override_row.start_time, "override.start_time")?;
        validate_optional_non_empty(&override_row.end_time, "override.end_time")?;
    }
    Ok(())
}

fn validate_optional_non_empty(value: &Option<String>, field: &str) -> Result<(), String> {
    if let Some(value) = value {
        require_non_empty(value, field)?;
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
        validate_payload, CalendarTimezoneHydration, EventTimezoneHydration,
        OverrideTimezoneHydration,
    };

    #[test]
    fn validates_timezone_hydration_payload() {
        let payload = CalendarTimezoneHydration {
            events: vec![EventTimezoneHydration {
                id: "event-1".to_string(),
                start_time: "2026-05-09T10:00:00Z".to_string(),
                end_time: "2026-05-09T11:00:00Z".to_string(),
                timezone: "America/Monterrey".to_string(),
            }],
            overrides: vec![OverrideTimezoneHydration {
                id: "override-1".to_string(),
                recurrence_id: "2026-05-09T10:00:00Z".to_string(),
                start_time: None,
                end_time: Some("2026-05-09T11:00:00Z".to_string()),
            }],
        };
        assert!(validate_payload(&payload).is_ok());
    }

    #[test]
    fn rejects_empty_timezone_hydration_fields() {
        let payload = CalendarTimezoneHydration {
            events: vec![EventTimezoneHydration {
                id: String::new(),
                start_time: "2026-05-09T10:00:00Z".to_string(),
                end_time: "2026-05-09T11:00:00Z".to_string(),
                timezone: "America/Monterrey".to_string(),
            }],
            overrides: vec![],
        };
        assert!(validate_payload(&payload).is_err());
    }
}
