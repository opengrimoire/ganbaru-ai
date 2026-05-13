use crate::db_path::connect_sqlite;
use serde::Serialize;
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
    transparency: String,
    status: String,
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
    transparency,
    status,
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
    name,
    email,
    role,
    status,
    rsvp,
    sort_order,
});

#[derive(Serialize)]
pub struct DbAlarmRow {
    id: String,
    event_id: String,
    action: String,
    trigger_type: String,
    trigger_value: String,
    description: Option<String>,
    sort_order: i64,
}
impl_sqlite_from_row!(DbAlarmRow {
    id,
    event_id,
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
    guest_can_modify: i64,
    guest_can_invite_others: i64,
    guest_can_see_other_guests: i64,
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
    guest_can_modify,
    guest_can_invite_others,
    guest_can_see_other_guests,
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
impl_sqlite_from_row!(DbFullOverrideRow {
    id,
    parent_event_id,
    recurrence_id,
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
});

#[derive(Serialize)]
pub struct CalendarBootstrapRows {
    events: Vec<DbCalendarEventRow>,
    overrides: Vec<DbOverrideRow>,
}

#[derive(Serialize)]
pub struct CalendarWindowRows {
    events: Vec<DbCalendarEventRow>,
    overrides: Vec<DbOverrideRow>,
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

const BOOTSTRAP_EVENTS_SQL: &str = r#"
    SELECT ce.id, ce.title, ce.start_time, ce.end_time, ce.timezone,
           ce.calendar_id, ce.color, ce.rrule,
           ce.notifications, ce.exceptions, ce.repeat_until,
           ce.all_day, ce.location, ce.transparency, ce.status,
           ce.rdate,
           pc.focus_duration_minutes, pc.short_break_minutes,
           pc.long_break_minutes, pc.pomodoro_count,
           pc.idle_timeout_minutes
    FROM calendar_events ce
    LEFT JOIN pomodoro_configs pc ON pc.event_id = ce.id
    ORDER BY ce.start_time ASC
"#;

const SLIM_OVERRIDES_SQL: &str = r#"
    SELECT id, parent_event_id, recurrence_id, title, start_time, end_time,
           color, status, transparency
    FROM calendar_event_overrides
"#;

const WINDOW_EVENTS_SQL: &str = r#"
    SELECT ce.id, ce.title, ce.start_time, ce.end_time, ce.timezone,
           ce.calendar_id, ce.color, ce.rrule,
           ce.notifications, ce.exceptions, ce.repeat_until,
           ce.all_day, ce.location, ce.transparency, ce.status,
           ce.rdate,
           pc.focus_duration_minutes, pc.short_break_minutes,
           pc.long_break_minutes, pc.pomodoro_count,
           pc.idle_timeout_minutes
    FROM calendar_events ce
    LEFT JOIN pomodoro_configs pc ON pc.event_id = ce.id
    WHERE
      (ce.rrule IS NOT NULL AND ce.rrule <> '')
      OR (ce.rdate IS NOT NULL AND ce.rdate <> '' AND ce.rdate <> '[]')
      OR (
        (ce.rrule IS NULL OR ce.rrule = '')
        AND (ce.rdate IS NULL OR ce.rdate = '' OR ce.rdate = '[]')
        AND (
          (ce.all_day = 1 AND substr(ce.end_time, 1, 10) >= ? AND substr(ce.start_time, 1, 10) <= ?)
          OR (ce.all_day <> 1 AND ce.end_time >= ? AND ce.start_time < ?)
        )
      )
    ORDER BY ce.start_time ASC
"#;

const WINDOW_OVERRIDES_SQL: &str = r#"
    SELECT o.id, o.parent_event_id, o.recurrence_id, o.title, o.start_time,
           o.end_time, o.color, o.status, o.transparency
    FROM calendar_event_overrides o
    JOIN calendar_events ce ON ce.id = o.parent_event_id
    WHERE
      (ce.rrule IS NOT NULL AND ce.rrule <> '')
      OR (ce.rdate IS NOT NULL AND ce.rdate <> '' AND ce.rdate <> '[]')
      OR (
        (ce.rrule IS NULL OR ce.rrule = '')
        AND (ce.rdate IS NULL OR ce.rdate = '' OR ce.rdate = '[]')
        AND (
          (ce.all_day = 1 AND substr(ce.end_time, 1, 10) >= ? AND substr(ce.start_time, 1, 10) <= ?)
          OR (ce.all_day <> 1 AND ce.end_time >= ? AND ce.start_time < ?)
        )
      )
"#;

const FULL_EVENT_SQL: &str = r#"
    SELECT ce.*,
           pc.focus_duration_minutes, pc.short_break_minutes,
           pc.long_break_minutes, pc.pomodoro_count,
           pc.idle_timeout_minutes
    FROM calendar_events ce
    LEFT JOIN pomodoro_configs pc ON pc.event_id = ce.id
    WHERE ce.id = ?
"#;

#[tauri::command]
pub async fn calendar_load_bootstrap<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<CalendarBootstrapRows, String> {
    let pool = connect_sqlite(app, db_url).await?;
    let events = sqlx::query_as::<_, DbCalendarEventRow>(BOOTSTRAP_EVENTS_SQL)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("load calendar bootstrap events: {e}"))?;
    let overrides = if events.is_empty() {
        Vec::new()
    } else {
        sqlx::query_as::<_, DbOverrideRow>(SLIM_OVERRIDES_SQL)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("load calendar bootstrap overrides: {e}"))?
    };

    Ok(CalendarBootstrapRows { events, overrides })
}

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
    let events = sqlx::query_as::<_, DbCalendarEventRow>(WINDOW_EVENTS_SQL)
        .bind(&window_start_date)
        .bind(&window_end_date)
        .bind(&window_start_utc)
        .bind(&window_end_exclusive_utc)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("load calendar window events: {e}"))?;
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
    let total_event_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM calendar_events")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("count calendar events: {e}"))?;

    Ok(CalendarWindowRows {
        events,
        overrides,
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
pub async fn calendar_load_panel_event<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
) -> Result<CalendarPanelEventRows, String> {
    let pool = connect_sqlite(app, db_url).await?;
    let event = sqlx::query_as::<_, DbFullEventRow>(FULL_EVENT_SQL)
        .bind(&id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("load panel calendar event: {e}"))?;
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
    let event = sqlx::query_as::<_, DbFullEventRow>(FULL_EVENT_SQL)
        .bind(&id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("load full calendar event: {e}"))?;
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
    let overrides = sqlx::query_as::<_, DbFullOverrideRow>(
        "SELECT * FROM calendar_event_overrides WHERE parent_event_id = ?",
    )
    .bind(&id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("load full calendar overrides: {e}"))?;

    Ok(CalendarFullEventRows {
        event,
        attendees,
        alarms,
        overrides,
    })
}
