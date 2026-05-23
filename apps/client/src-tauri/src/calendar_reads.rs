use crate::calendar_description::sanitize_calendar_description_html;
use crate::db_path::connect_sqlite;
use serde::Serialize;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::collections::{BTreeMap, BTreeSet};
use tauri::{AppHandle, Runtime};

#[derive(Serialize)]
pub struct DbCalendarEventRow {
    id: String,
    title: String,
    start_time: String,
    end_time: String,
    timezone: String,
    calendar_id: String,
    color: Option<i64>,
    rrule: Option<String>,
    notifications: Option<String>,
    exceptions: Option<String>,
    repeat_until: Option<String>,
    all_day: i64,
    location: String,
    has_call_link: i64,
    meeting_enabled: i64,
    transparency: String,
    status: String,
    local_rsvp_status: Option<String>,
    rdate: Option<String>,
    focus_duration_minutes: Option<i64>,
    short_break_minutes: Option<i64>,
    long_break_minutes: Option<i64>,
    pomodoro_count: Option<i64>,
    idle_timeout_minutes: Option<i64>,
}
impl_sqlite_from_row!(DbCalendarEventRow {
    id,
    title,
    start_time,
    end_time,
    timezone,
    calendar_id,
    color,
    rrule,
    notifications,
    exceptions,
    repeat_until,
    all_day,
    location,
    has_call_link,
    meeting_enabled,
    transparency,
    status,
    local_rsvp_status,
    rdate,
    focus_duration_minutes,
    short_break_minutes,
    long_break_minutes,
    pomodoro_count,
    idle_timeout_minutes,
});

#[derive(Serialize)]
pub struct DbOverrideRow {
    id: String,
    parent_event_id: String,
    recurrence_id: String,
    recurrence_range: Option<String>,
    title: Option<String>,
    start_time: Option<String>,
    end_time: Option<String>,
    color: Option<i64>,
    status: Option<String>,
    transparency: Option<String>,
}
impl_sqlite_from_row!(DbOverrideRow {
    id,
    parent_event_id,
    recurrence_id,
    recurrence_range,
    title,
    start_time,
    end_time,
    color,
    status,
    transparency,
});

#[derive(Serialize)]
pub struct DbAttendeeRow {
    id: String,
    event_id: String,
    icalendar_component_id: Option<String>,
    icalendar_property_index: Option<i64>,
    name: Option<String>,
    email: String,
    role: String,
    status: String,
    rsvp: i64,
    sort_order: i64,
}
impl_sqlite_from_row!(DbAttendeeRow {
    id,
    event_id,
    icalendar_component_id,
    icalendar_property_index,
    name,
    email,
    role,
    status,
    rsvp,
    sort_order,
});

#[derive(Serialize)]
pub struct DbWindowAttendeeRow {
    event_id: String,
    email: String,
    status: String,
}
impl_sqlite_from_row!(DbWindowAttendeeRow {
    event_id,
    email,
    status,
});

#[derive(Serialize)]
pub struct DbAlarmRow {
    id: String,
    event_id: String,
    icalendar_component_id: Option<String>,
    action: String,
    trigger_type: String,
    trigger_value: String,
    description: Option<String>,
    sort_order: i64,
}
impl_sqlite_from_row!(DbAlarmRow {
    id,
    event_id,
    icalendar_component_id,
    action,
    trigger_type,
    trigger_value,
    description,
    sort_order,
});

#[derive(Serialize)]
pub struct DbFullEventRow {
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
    all_day: i64,
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
    meeting_enabled: i64,
    guest_can_modify: i64,
    guest_can_invite_others: i64,
    guest_can_see_other_guests: i64,
    local_rsvp_status: Option<String>,
    icalendar_component_id: Option<String>,
    icalendar_preservation_status: Option<String>,
    icalendar_projection_warnings: Option<String>,
    icalendar_raw_jcal: Option<String>,
    focus_duration_minutes: Option<i64>,
    short_break_minutes: Option<i64>,
    long_break_minutes: Option<i64>,
    pomodoro_count: Option<i64>,
    idle_timeout_minutes: Option<i64>,
}
impl_sqlite_from_row!(DbFullEventRow {
    id,
    title,
    start_time,
    end_time,
    timezone,
    calendar_id,
    color,
    description,
    rrule,
    notifications,
    exceptions,
    repeat_until,
    all_day,
    location,
    url,
    transparency,
    status,
    source_uid,
    visibility,
    priority,
    categories,
    geo,
    sequence,
    rdate,
    extended_properties,
    organizer,
    meeting_enabled,
    guest_can_modify,
    guest_can_invite_others,
    guest_can_see_other_guests,
    local_rsvp_status,
    icalendar_component_id,
    icalendar_preservation_status,
    icalendar_projection_warnings,
    icalendar_raw_jcal,
    focus_duration_minutes,
    short_break_minutes,
    long_break_minutes,
    pomodoro_count,
    idle_timeout_minutes,
});

#[derive(Serialize)]
pub struct DbFullOverrideRow {
    id: String,
    parent_event_id: String,
    recurrence_id: String,
    recurrence_range: Option<String>,
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
    icalendar_component_id: Option<String>,
    icalendar_raw_jcal: Option<String>,
}
impl_sqlite_from_row!(DbFullOverrideRow {
    id,
    parent_event_id,
    recurrence_id,
    recurrence_range,
    title,
    start_time,
    end_time,
    description,
    location,
    url,
    color,
    status,
    transparency,
    visibility,
    extended_properties,
    icalendar_component_id,
    icalendar_raw_jcal,
});

#[derive(Serialize)]
pub struct CalendarWindowRows {
    events: Vec<DbCalendarEventRow>,
    overrides: Vec<DbOverrideRow>,
    attendees: Vec<DbWindowAttendeeRow>,
    total_event_count: i64,
}

#[derive(Serialize)]
pub struct CalendarPanelEventRows {
    event: Option<DbFullEventRow>,
    attendees: Vec<DbAttendeeRow>,
}

#[derive(Serialize)]
pub struct CalendarFullEventRows {
    event: Option<DbFullEventRow>,
    attendees: Vec<DbAttendeeRow>,
    alarms: Vec<DbAlarmRow>,
    overrides: Vec<DbFullOverrideRow>,
}

#[derive(Serialize)]
pub struct CalendarIcalendarExportMetadata {
    method: Option<String>,
    mixed_methods: bool,
}

const WINDOW_EVENTS_SQL: &str = r#"
    SELECT ce.id, ce.title, ce.start_time, ce.end_time, ce.timezone,
           ce.calendar_id, ce.color, ce.rrule,
           NULL AS notifications, NULL AS exceptions, ce.repeat_until,
           ce.all_day, ce.location, ce.transparency, ce.status,
           CASE WHEN ce.url <> '' THEN 1 ELSE 0 END AS has_call_link,
           ce.meeting_enabled, ce.local_rsvp_status,
           NULL AS rdate,
           pc.focus_duration_minutes, pc.short_break_minutes,
           pc.long_break_minutes, pc.pomodoro_count,
           pc.idle_timeout_minutes
    FROM calendar_events ce
    LEFT JOIN pomodoro_configs pc ON pc.event_id = ce.id
    WHERE
      (ce.rrule IS NOT NULL AND ce.rrule <> '')
      OR EXISTS (SELECT 1 FROM calendar_event_rdates r WHERE r.event_id = ce.id)
      OR (
        (ce.rrule IS NULL OR ce.rrule = '')
        AND NOT EXISTS (SELECT 1 FROM calendar_event_rdates r WHERE r.event_id = ce.id)
        AND (
          (ce.all_day = 1 AND substr(ce.end_time, 1, 10) >= ? AND substr(ce.start_time, 1, 10) <= ?)
          OR (ce.all_day <> 1 AND ce.end_time >= ? AND ce.start_time < ?)
        )
      )
    ORDER BY ce.start_time ASC
"#;

const WINDOW_OVERRIDES_SQL: &str = r#"
    SELECT o.id, o.parent_event_id, o.recurrence_id, o.recurrence_range, o.title, o.start_time,
           o.end_time, o.color, o.status, o.transparency
    FROM calendar_event_overrides o
    JOIN calendar_events ce ON ce.id = o.parent_event_id
    WHERE
      (ce.rrule IS NOT NULL AND ce.rrule <> '')
      OR EXISTS (SELECT 1 FROM calendar_event_rdates r WHERE r.event_id = ce.id)
      OR (
        (ce.rrule IS NULL OR ce.rrule = '')
        AND NOT EXISTS (SELECT 1 FROM calendar_event_rdates r WHERE r.event_id = ce.id)
        AND (
          (ce.all_day = 1 AND substr(ce.end_time, 1, 10) >= ? AND substr(ce.start_time, 1, 10) <= ?)
          OR (ce.all_day <> 1 AND ce.end_time >= ? AND ce.start_time < ?)
        )
      )
"#;

const WINDOW_ATTENDEES_SQL: &str = r#"
    SELECT a.event_id, a.email, a.status
    FROM calendar_event_attendees a
    JOIN calendar_events ce ON ce.id = a.event_id
    WHERE
      (ce.rrule IS NOT NULL AND ce.rrule <> '')
      OR EXISTS (SELECT 1 FROM calendar_event_rdates r WHERE r.event_id = ce.id)
      OR (
        (ce.rrule IS NULL OR ce.rrule = '')
        AND NOT EXISTS (SELECT 1 FROM calendar_event_rdates r WHERE r.event_id = ce.id)
        AND (
          (ce.all_day = 1 AND substr(ce.end_time, 1, 10) >= ? AND substr(ce.start_time, 1, 10) <= ?)
          OR (ce.all_day <> 1 AND ce.end_time >= ? AND ce.start_time < ?)
        )
      )
    ORDER BY a.event_id ASC, a.sort_order ASC
"#;

const FULL_EVENT_SQL: &str = r#"
    SELECT ce.id, ce.title, ce.start_time, ce.end_time, ce.timezone, ce.calendar_id,
           ce.color, ce.description, ce.rrule,
           NULL AS notifications, NULL AS exceptions, ce.repeat_until,
           ce.all_day, ce.location, ce.url, ce.transparency, ce.status,
           ce.source_uid, ce.visibility, ce.priority,
           NULL AS categories,
           CASE
             WHEN ce.geo_lat IS NULL OR ce.geo_lng IS NULL THEN NULL
             ELSE NULL
           END AS geo,
           ce.sequence,
           NULL AS rdate,
           NULL AS extended_properties,
           NULL AS organizer,
           ce.meeting_enabled, ce.guest_can_modify, ce.guest_can_invite_others,
           ce.guest_can_see_other_guests, ce.local_rsvp_status, ce.icalendar_component_id,
           ic.preservation_status AS icalendar_preservation_status,
           NULL AS icalendar_projection_warnings,
           NULL AS icalendar_raw_jcal,
           pc.focus_duration_minutes, pc.short_break_minutes,
           pc.long_break_minutes, pc.pomodoro_count,
           pc.idle_timeout_minutes
    FROM calendar_events ce
    LEFT JOIN icalendar_components ic ON ic.id = ce.icalendar_component_id
    LEFT JOIN pomodoro_configs pc ON pc.event_id = ce.id
    WHERE ce.id = ?
"#;

#[tauri::command]
pub async fn calendar_load_window<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    window_start_date: String,
    window_end_date: String,
    window_start_utc: String,
    window_end_exclusive_utc: String,
) -> Result<CalendarWindowRows, String> {
    let pool = connect_sqlite(app, db_url).await?;
    let mut events = sqlx::query_as::<_, DbCalendarEventRow>(WINDOW_EVENTS_SQL)
        .bind(&window_start_date)
        .bind(&window_end_date)
        .bind(&window_start_utc)
        .bind(&window_end_exclusive_utc)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("load calendar window events: {e}"))?;
    hydrate_window_event_rows(&pool, &mut events).await?;
    let overrides = if events.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, DbOverrideRow>(WINDOW_OVERRIDES_SQL)
            .bind(&window_start_date)
            .bind(&window_end_date)
            .bind(&window_start_utc)
            .bind(&window_end_exclusive_utc)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("load calendar window overrides: {e}"))?
    };
    let attendees = if events.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, DbWindowAttendeeRow>(WINDOW_ATTENDEES_SQL)
            .bind(&window_start_date)
            .bind(&window_end_date)
            .bind(&window_start_utc)
            .bind(&window_end_exclusive_utc)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("load calendar window attendees: {e}"))?
    };
    let total_event_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM calendar_events")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("count calendar events: {e}"))?;

    Ok(CalendarWindowRows {
        events,
        overrides,
        attendees,
        total_event_count,
    })
}

#[tauri::command]
pub async fn calendar_list_event_ids_for_calendar<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    calendar_id: String,
) -> Result<Vec<String>, String> {
    let pool = connect_sqlite(app, db_url).await?;
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM calendar_events WHERE calendar_id = ? ORDER BY start_time ASC",
    )
    .bind(&calendar_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("list calendar event ids: {e}"))
}

#[tauri::command]
pub async fn calendar_load_icalendar_timezones_for_calendar<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    calendar_id: String,
) -> Result<Vec<String>, String> {
    let pool = connect_sqlite(app, db_url).await?;
    let ids = sqlx::query_scalar::<_, String>(
        "SELECT id
         FROM icalendar_components
         WHERE calendar_id = ? AND component_type = 'vtimezone'
         ORDER BY object_id, sort_order",
    )
    .bind(&calendar_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load iCalendar timezone components: {e}"))?;
    load_component_jcals(&pool, ids).await
}

#[tauri::command]
pub async fn calendar_load_icalendar_passthrough_components_for_calendar<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    calendar_id: String,
) -> Result<Vec<String>, String> {
    let pool = connect_sqlite(app, db_url).await?;
    let ids = sqlx::query_scalar::<_, String>(
        "SELECT child.id
         FROM icalendar_components child
         JOIN icalendar_components parent ON parent.id = child.parent_component_id
         WHERE child.calendar_id = ?
           AND parent.component_type = 'vcalendar'
           AND child.component_type NOT IN ('vevent', 'vtimezone')
         ORDER BY child.object_id, child.sort_order",
    )
    .bind(&calendar_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load iCalendar passthrough components: {e}"))?;
    load_component_jcals(&pool, ids).await
}

#[tauri::command]
pub async fn calendar_load_icalendar_export_metadata_for_calendar<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    calendar_id: String,
) -> Result<CalendarIcalendarExportMetadata, String> {
    let pool = connect_sqlite(app, db_url).await?;
    let methods = sqlx::query_scalar::<_, String>(
        "SELECT method
         FROM icalendar_objects
         WHERE calendar_id = ?
           AND method IS NOT NULL
           AND trim(method) <> ''",
    )
    .bind(&calendar_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load iCalendar export metadata: {e}"))?;

    Ok(calendar_icalendar_export_metadata(methods))
}

#[tauri::command]
pub async fn calendar_load_panel_event<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
) -> Result<CalendarPanelEventRows, String> {
    let pool = connect_sqlite(app, db_url).await?;
    let mut event = sqlx::query_as::<_, DbFullEventRow>(FULL_EVENT_SQL)
        .bind(&id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("load panel calendar event: {e}"))?;
    hydrate_full_event_row(&pool, &mut event).await?;
    sanitize_full_event_row(&mut event);
    let attendees = sqlx::query_as::<_, DbAttendeeRow>(
        "SELECT * FROM calendar_event_attendees WHERE event_id = ? ORDER BY sort_order ASC",
    )
    .bind(&id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load panel calendar attendees: {e}"))?;

    Ok(CalendarPanelEventRows { event, attendees })
}

#[tauri::command]
pub async fn calendar_load_full_event<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
) -> Result<CalendarFullEventRows, String> {
    let pool = connect_sqlite(app, db_url).await?;
    let mut event = sqlx::query_as::<_, DbFullEventRow>(FULL_EVENT_SQL)
        .bind(&id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("load full calendar event: {e}"))?;
    hydrate_full_event_row(&pool, &mut event).await?;
    let attendees = sqlx::query_as::<_, DbAttendeeRow>(
        "SELECT * FROM calendar_event_attendees WHERE event_id = ? ORDER BY sort_order ASC",
    )
    .bind(&id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load full calendar attendees: {e}"))?;
    let alarms = sqlx::query_as::<_, DbAlarmRow>(
        "SELECT * FROM calendar_event_alarms WHERE event_id = ? ORDER BY sort_order ASC",
    )
    .bind(&id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load full calendar alarms: {e}"))?;
    let mut overrides = sqlx::query_as::<_, DbFullOverrideRow>(
        "SELECT o.id, o.parent_event_id, o.recurrence_id, o.recurrence_range,
                o.title, o.start_time, o.end_time, o.description, o.location,
                o.url, o.color, o.status, o.transparency, o.visibility,
                NULL AS extended_properties, o.icalendar_component_id,
                NULL AS icalendar_raw_jcal
         FROM calendar_event_overrides o
         WHERE o.parent_event_id = ?",
    )
    .bind(&id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load full calendar overrides: {e}"))?;
    hydrate_full_override_rows(&pool, &mut overrides).await?;
    sanitize_full_event_row(&mut event);
    sanitize_full_override_rows(&mut overrides);

    Ok(CalendarFullEventRows {
        event,
        attendees,
        alarms,
        overrides,
    })
}

async fn hydrate_window_event_rows(
    pool: &SqlitePool,
    rows: &mut [DbCalendarEventRow],
) -> Result<(), String> {
    let ids = rows.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(());
    }
    let notifications =
        load_i64_list_map(pool, "calendar_event_notifications", "offset_minutes", &ids).await?;
    let exceptions =
        load_string_list_map(pool, "calendar_event_exdates", "occurrence_date", &ids).await?;
    let rdates =
        load_string_list_map(pool, "calendar_event_rdates", "occurrence_start", &ids).await?;
    for row in rows {
        row.notifications = notifications.get(&row.id).cloned();
        row.exceptions = exceptions.get(&row.id).cloned();
        row.rdate = rdates.get(&row.id).cloned();
    }
    Ok(())
}

async fn hydrate_full_event_row(
    pool: &SqlitePool,
    row: &mut Option<DbFullEventRow>,
) -> Result<(), String> {
    let Some(event) = row else {
        return Ok(());
    };
    let ids = [event.id.clone()];
    event.notifications =
        load_i64_list_map(pool, "calendar_event_notifications", "offset_minutes", &ids)
            .await?
            .remove(&event.id);
    event.exceptions =
        load_string_list_map(pool, "calendar_event_exdates", "occurrence_date", &ids)
            .await?
            .remove(&event.id);
    event.rdate = load_string_list_map(pool, "calendar_event_rdates", "occurrence_start", &ids)
        .await?
        .remove(&event.id);
    event.categories = load_string_list_map(pool, "calendar_event_categories", "category", &ids)
        .await?
        .remove(&event.id);
    event.extended_properties =
        load_property_map(pool, "calendar_event_extended_properties", "event_id", &ids)
            .await?
            .remove(&event.id);
    event.organizer = load_organizer(pool, &event.id).await?;
    event.geo = load_geo(pool, &event.id).await?;
    event.icalendar_projection_warnings =
        load_component_warnings(pool, event.icalendar_component_id.as_deref()).await?;
    event.icalendar_raw_jcal =
        load_component_jcal(pool, event.icalendar_component_id.as_deref()).await?;
    Ok(())
}

async fn hydrate_full_override_rows(
    pool: &SqlitePool,
    rows: &mut [DbFullOverrideRow],
) -> Result<(), String> {
    let ids = rows.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(());
    }
    let properties = load_property_map(
        pool,
        "calendar_event_override_extended_properties",
        "override_id",
        &ids,
    )
    .await?;
    for row in rows {
        row.extended_properties = properties.get(&row.id).cloned();
        row.icalendar_raw_jcal =
            load_component_jcal(pool, row.icalendar_component_id.as_deref()).await?;
    }
    Ok(())
}

async fn load_i64_list_map(
    pool: &SqlitePool,
    table: &'static str,
    column: &'static str,
    ids: &[String],
) -> Result<BTreeMap<String, String>, String> {
    if ids.is_empty() {
        return Ok(BTreeMap::new());
    }
    let placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT event_id, {column} AS value FROM {table}
         WHERE event_id IN ({placeholders})
         ORDER BY event_id ASC, sort_order ASC"
    );
    let mut q = sqlx::query(&query);
    for id in ids {
        q = q.bind(id);
    }
    let rows = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("load {table}: {e}"))?;
    let mut grouped: BTreeMap<String, Vec<i64>> = BTreeMap::new();
    for row in rows {
        let event_id: String = row
            .try_get("event_id")
            .map_err(|e| format!("read {table}.event_id: {e}"))?;
        let value: i64 = row
            .try_get("value")
            .map_err(|e| format!("read {table}.{column}: {e}"))?;
        grouped.entry(event_id).or_default().push(value);
    }
    grouped
        .into_iter()
        .map(|(id, values)| {
            serde_json::to_string(&values)
                .map(|json| (id, json))
                .map_err(|e| format!("serialize {table}: {e}"))
        })
        .collect()
}

async fn load_string_list_map(
    pool: &SqlitePool,
    table: &'static str,
    column: &'static str,
    ids: &[String],
) -> Result<BTreeMap<String, String>, String> {
    let rows = load_ordered_values(pool, table, column, ids).await?;
    let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (event_id, value) in rows {
        grouped.entry(event_id).or_default().push(value);
    }
    grouped
        .into_iter()
        .map(|(id, values)| {
            serde_json::to_string(&values)
                .map(|json| (id, json))
                .map_err(|e| format!("serialize {table}: {e}"))
        })
        .collect()
}

async fn load_ordered_values(
    pool: &SqlitePool,
    table: &'static str,
    column: &'static str,
    ids: &[String],
) -> Result<Vec<(String, String)>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT event_id, {column} AS value FROM {table}
         WHERE event_id IN ({placeholders})
         ORDER BY event_id ASC, sort_order ASC"
    );
    let mut q = sqlx::query(&query);
    for id in ids {
        q = q.bind(id);
    }
    let rows = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("load {table}: {e}"))?;
    rows.into_iter()
        .map(|row| {
            let event_id: String = row
                .try_get("event_id")
                .map_err(|e| format!("read {table}.event_id: {e}"))?;
            let value: String = row
                .try_get("value")
                .map_err(|e| format!("read {table}.{column}: {e}"))?;
            Ok((event_id, value))
        })
        .collect()
}

async fn load_property_map(
    pool: &SqlitePool,
    table: &'static str,
    owner_column: &'static str,
    ids: &[String],
) -> Result<BTreeMap<String, String>, String> {
    if ids.is_empty() {
        return Ok(BTreeMap::new());
    }
    let placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT {owner_column} AS owner_id, property_key, property_value FROM {table}
         WHERE {owner_column} IN ({placeholders})
         ORDER BY {owner_column} ASC, sort_order ASC"
    );
    let mut q = sqlx::query(&query);
    for id in ids {
        q = q.bind(id);
    }
    let rows = q
        .fetch_all(pool)
        .await
        .map_err(|e| format!("load {table}: {e}"))?;
    let mut grouped: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    for row in rows {
        let owner_id: String = row
            .try_get("owner_id")
            .map_err(|e| format!("read {table}.{owner_column}: {e}"))?;
        let key: String = row
            .try_get("property_key")
            .map_err(|e| format!("read {table}.property_key: {e}"))?;
        let value: String = row
            .try_get("property_value")
            .map_err(|e| format!("read {table}.property_value: {e}"))?;
        grouped.entry(owner_id).or_default().insert(key, value);
    }
    grouped
        .into_iter()
        .map(|(id, values)| {
            serde_json::to_string(&values)
                .map(|json| (id, json))
                .map_err(|e| format!("serialize {table}: {e}"))
        })
        .collect()
}

async fn load_organizer(pool: &SqlitePool, event_id: &str) -> Result<Option<String>, String> {
    let row = sqlx::query("SELECT name, email FROM calendar_event_organizers WHERE event_id = ?")
        .bind(event_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("load organizer: {e}"))?;
    let Some(row) = row else {
        return Ok(None);
    };
    let name: Option<String> = row
        .try_get("name")
        .map_err(|e| format!("read organizer name: {e}"))?;
    let email: String = row
        .try_get("email")
        .map_err(|e| format!("read organizer email: {e}"))?;
    serde_json::to_string(&serde_json::json!({ "name": name, "email": email }))
        .map(Some)
        .map_err(|e| format!("serialize organizer: {e}"))
}

async fn load_geo(pool: &SqlitePool, event_id: &str) -> Result<Option<String>, String> {
    let row = sqlx::query("SELECT geo_lat, geo_lng FROM calendar_events WHERE id = ?")
        .bind(event_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("load geo: {e}"))?;
    let Some(row) = row else {
        return Ok(None);
    };
    let lat: Option<f64> = row
        .try_get("geo_lat")
        .map_err(|e| format!("read geo_lat: {e}"))?;
    let lng: Option<f64> = row
        .try_get("geo_lng")
        .map_err(|e| format!("read geo_lng: {e}"))?;
    match (lat, lng) {
        (Some(lat), Some(lng)) => {
            serde_json::to_string(&serde_json::json!({ "lat": lat, "lng": lng }))
                .map(Some)
                .map_err(|e| format!("serialize geo: {e}"))
        }
        _ => Ok(None),
    }
}

async fn load_component_warnings(
    pool: &SqlitePool,
    component_id: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(component_id) = component_id else {
        return Ok(None);
    };
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT message FROM icalendar_component_projection_warnings
         WHERE component_id = ?
         ORDER BY sort_order ASC",
    )
    .bind(component_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load component warnings: {e}"))?;
    if rows.is_empty() {
        return Ok(None);
    }
    serde_json::to_string(&rows)
        .map(Some)
        .map_err(|e| format!("serialize component warnings: {e}"))
}

async fn load_component_jcal(
    pool: &SqlitePool,
    component_id: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(component_id) = component_id else {
        return Ok(None);
    };
    let value = load_component_value(pool, component_id).await?;
    serde_json::to_string(&value)
        .map(Some)
        .map_err(|e| format!("serialize iCalendar component: {e}"))
}

async fn load_component_jcals(pool: &SqlitePool, ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut values = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(value) = load_component_jcal(pool, Some(&id)).await? {
            values.push(value);
        }
    }
    Ok(values)
}

fn load_component_value<'a>(
    pool: &'a SqlitePool,
    component_id: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, String>> + Send + 'a>> {
    Box::pin(async move {
        let row = sqlx::query("SELECT component_type FROM icalendar_components WHERE id = ?")
            .bind(component_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("load iCalendar component: {e}"))?
            .ok_or_else(|| format!("iCalendar component not found: {component_id}"))?;
        let component_type: String = row
            .try_get("component_type")
            .map_err(|e| format!("read component_type: {e}"))?;

        let property_rows = sqlx::query(
            "SELECT id, name, value_type
         FROM icalendar_component_properties
         WHERE component_id = ?
         ORDER BY sort_order ASC",
        )
        .bind(component_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("load iCalendar properties: {e}"))?;

        let mut properties = Vec::with_capacity(property_rows.len());
        for property_row in property_rows {
            let property_id: String = property_row
                .try_get("id")
                .map_err(|e| format!("read property id: {e}"))?;
            let name: String = property_row
                .try_get("name")
                .map_err(|e| format!("read property name: {e}"))?;
            let value_type: String = property_row
                .try_get("value_type")
                .map_err(|e| format!("read property value_type: {e}"))?;
            let params = load_property_params(pool, &property_id).await?;
            let mut property = vec![Value::String(name), params, Value::String(value_type)];
            property.extend(load_property_values(pool, &property_id).await?);
            properties.push(Value::Array(property));
        }

        let child_ids = sqlx::query_scalar::<_, String>(
            "SELECT id FROM icalendar_components
         WHERE parent_component_id = ?
         ORDER BY sort_order ASC",
        )
        .bind(component_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("load child iCalendar components: {e}"))?;
        let mut children = Vec::with_capacity(child_ids.len());
        for child_id in child_ids {
            children.push(load_component_value(pool, &child_id).await?);
        }

        Ok(Value::Array(vec![
            Value::String(component_type),
            Value::Array(properties),
            Value::Array(children),
        ]))
    })
}

async fn load_property_params(pool: &SqlitePool, property_id: &str) -> Result<Value, String> {
    let rows = sqlx::query(
        "SELECT id, name FROM icalendar_property_parameters
         WHERE property_id = ?
         ORDER BY sort_order ASC",
    )
    .bind(property_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("load iCalendar parameters: {e}"))?;
    let mut params = serde_json::Map::new();
    for row in rows {
        let parameter_id: String = row
            .try_get("id")
            .map_err(|e| format!("read parameter id: {e}"))?;
        let name: String = row
            .try_get("name")
            .map_err(|e| format!("read parameter name: {e}"))?;
        let values = load_parameter_values(pool, &parameter_id).await?;
        let value = if values.len() == 1 {
            values.into_iter().next().unwrap_or(Value::Null)
        } else {
            Value::Array(values)
        };
        params.insert(name, value);
    }
    Ok(Value::Object(params))
}

async fn load_property_values(pool: &SqlitePool, property_id: &str) -> Result<Vec<Value>, String> {
    load_root_values(pool, Some(property_id), None).await
}

async fn load_parameter_values(
    pool: &SqlitePool,
    parameter_id: &str,
) -> Result<Vec<Value>, String> {
    load_root_values(pool, None, Some(parameter_id)).await
}

async fn load_root_values(
    pool: &SqlitePool,
    property_id: Option<&str>,
    parameter_id: Option<&str>,
) -> Result<Vec<Value>, String> {
    let (query, bind_value) = if let Some(property_id) = property_id {
        (
            "SELECT id FROM icalendar_value_nodes
             WHERE property_id = ? AND parent_node_id IS NULL
             ORDER BY sort_order ASC",
            property_id,
        )
    } else if let Some(parameter_id) = parameter_id {
        (
            "SELECT id FROM icalendar_value_nodes
             WHERE parameter_id = ? AND parent_node_id IS NULL
             ORDER BY sort_order ASC",
            parameter_id,
        )
    } else {
        return Ok(Vec::new());
    };
    let ids = sqlx::query_scalar::<_, String>(query)
        .bind(bind_value)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("load iCalendar value roots: {e}"))?;
    let mut values = Vec::with_capacity(ids.len());
    for id in ids {
        values.push(load_value_node(pool, &id).await?);
    }
    Ok(values)
}

fn load_value_node<'a>(
    pool: &'a SqlitePool,
    node_id: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, String>> + Send + 'a>> {
    Box::pin(async move {
        let row = sqlx::query(
            "SELECT value_kind, text_value, number_value, boolean_value
         FROM icalendar_value_nodes
         WHERE id = ?",
        )
        .bind(node_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("load iCalendar value node: {e}"))?;
        let value_kind: String = row
            .try_get("value_kind")
            .map_err(|e| format!("read value_kind: {e}"))?;
        match value_kind.as_str() {
            "array" => {
                let child_ids = sqlx::query_scalar::<_, String>(
                    "SELECT id FROM icalendar_value_nodes
                 WHERE parent_node_id = ?
                 ORDER BY sort_order ASC",
                )
                .bind(node_id)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("load iCalendar value children: {e}"))?;
                let mut children = Vec::with_capacity(child_ids.len());
                for child_id in child_ids {
                    children.push(load_value_node(pool, &child_id).await?);
                }
                Ok(Value::Array(children))
            }
            "text" => {
                let value: Option<String> = row
                    .try_get("text_value")
                    .map_err(|e| format!("read text_value: {e}"))?;
                Ok(Value::String(value.unwrap_or_default()))
            }
            "number" => {
                let value: Option<f64> = row
                    .try_get("number_value")
                    .map_err(|e| format!("read number_value: {e}"))?;
                Ok(serde_json::Number::from_f64(value.unwrap_or(0.0))
                    .map(Value::Number)
                    .unwrap_or(Value::Null))
            }
            "boolean" => {
                let value: Option<i64> = row
                    .try_get("boolean_value")
                    .map_err(|e| format!("read boolean_value: {e}"))?;
                Ok(Value::Bool(value.unwrap_or(0) != 0))
            }
            "null" => Ok(Value::Null),
            _ => Err(format!("unsupported iCalendar value kind: {value_kind}")),
        }
    })
}

fn sanitize_full_event_row(row: &mut Option<DbFullEventRow>) {
    if let Some(event) = row {
        event.description = sanitize_calendar_description_html(&event.description);
    }
}

fn sanitize_full_override_rows(rows: &mut [DbFullOverrideRow]) {
    for row in rows {
        if let Some(description) = &row.description {
            row.description = Some(sanitize_calendar_description_html(description));
        }
    }
}

fn calendar_icalendar_export_metadata(methods: Vec<String>) -> CalendarIcalendarExportMetadata {
    let distinct_methods = methods
        .into_iter()
        .map(|method| method.trim().to_ascii_uppercase())
        .filter(|method| !method.is_empty())
        .collect::<BTreeSet<_>>();
    CalendarIcalendarExportMetadata {
        method: if distinct_methods.len() == 1 {
            distinct_methods.iter().next().cloned()
        } else {
            None
        },
        mixed_methods: distinct_methods.len() > 1,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        calendar_icalendar_export_metadata, sanitize_full_event_row, sanitize_full_override_rows,
        DbFullEventRow, DbFullOverrideRow,
    };

    #[test]
    fn sanitizes_full_event_description_before_returning_rows() {
        let mut row = Some(full_event_row(
            "<p onclick=\"alert(1)\">Safe <a href=\"javascript:alert(1)\">bad</a></p>",
        ));

        sanitize_full_event_row(&mut row);

        assert_eq!(row.unwrap().description, "<p>Safe <a>bad</a></p>");
    }

    #[test]
    fn sanitizes_full_override_description_before_returning_rows() {
        let mut rows = vec![DbFullOverrideRow {
            id: "override-1".to_string(),
            parent_event_id: "event-1".to_string(),
            recurrence_id: "2026-05-10".to_string(),
            recurrence_range: None,
            title: None,
            start_time: None,
            end_time: None,
            description: Some("<div><img src=\"x\"><strong>Safe</strong></div>".to_string()),
            location: None,
            url: None,
            color: None,
            status: None,
            transparency: None,
            visibility: None,
            extended_properties: None,
            icalendar_component_id: None,
            icalendar_raw_jcal: None,
        }];

        sanitize_full_override_rows(&mut rows);

        assert_eq!(
            rows[0].description.as_deref(),
            Some("<div><strong>Safe</strong></div>")
        );
    }

    #[test]
    fn uses_single_preserved_method_for_export_metadata() {
        let metadata = calendar_icalendar_export_metadata(vec![
            " request ".to_string(),
            "REQUEST".to_string(),
        ]);

        assert_eq!(metadata.method.as_deref(), Some("REQUEST"));
        assert!(!metadata.mixed_methods);
    }

    #[test]
    fn drops_mixed_preserved_methods_for_export_metadata() {
        let metadata =
            calendar_icalendar_export_metadata(vec!["REQUEST".to_string(), "CANCEL".to_string()]);

        assert_eq!(metadata.method, None);
        assert!(metadata.mixed_methods);
    }

    #[test]
    fn window_queries_do_not_load_icalendar_preservation_json() {
        for sql in [super::WINDOW_EVENTS_SQL, super::WINDOW_OVERRIDES_SQL] {
            let lower = sql.to_ascii_lowercase();
            assert!(!lower.contains("icalendar_components"));
            assert!(!lower.contains("raw_jcal"));
            assert!(!lower.contains("projection_warnings"));
        }
    }

    fn full_event_row(description: &str) -> DbFullEventRow {
        DbFullEventRow {
            id: "event-1".to_string(),
            title: "Focus".to_string(),
            start_time: "2026-05-09T10:00:00Z".to_string(),
            end_time: "2026-05-09T11:00:00Z".to_string(),
            timezone: "America/Monterrey".to_string(),
            calendar_id: "local".to_string(),
            color: None,
            description: description.to_string(),
            rrule: None,
            notifications: None,
            exceptions: None,
            repeat_until: None,
            all_day: 0,
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
            meeting_enabled: 0,
            guest_can_modify: 0,
            guest_can_invite_others: 1,
            guest_can_see_other_guests: 1,
            local_rsvp_status: None,
            icalendar_component_id: None,
            icalendar_preservation_status: None,
            icalendar_projection_warnings: None,
            icalendar_raw_jcal: None,
            focus_duration_minutes: None,
            short_break_minutes: None,
            long_break_minutes: None,
            pomodoro_count: None,
            idle_timeout_minutes: None,
        }
    }
}
