use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool, Transaction};
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

mod tags;

#[cfg(test)]
use tags::delete_tag_from_pool;
pub use tags::{QuickNoteTagRead, QuickNoteTagWrite};

const DEFAULT_PAGE_SIZE: i64 = 60;
const MAX_PAGE_SIZE: i64 = 60;
const MAX_TITLE_CHARS: usize = 200;
const MAX_BODY_CHARS: usize = 65_536;
const MAX_RUNS: usize = 4_096;
const PREVIEW_CHARS: usize = 4_096;
const TRASH_RETENTION_DAYS: i64 = 7;

/// Stable write outcomes for conflict recovery, independent of diagnostic wording.
#[derive(Debug, Serialize)]
#[serde(tag = "code", content = "message", rename_all = "snake_case")]
pub enum QuickNoteWriteError {
    RevisionConflict(String),
    Failed(String),
}

impl From<String> for QuickNoteWriteError {
    fn from(message: String) -> Self {
        Self::Failed(message)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickNoteTextRun {
    content: String,
    bold: bool,
    italic: bool,
    underline: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNoteWrite {
    id: String,
    title: String,
    runs: Vec<QuickNoteTextRun>,
    color: i64,
    tag_id: Option<String>,
    pinned: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNoteUpdate {
    id: String,
    expected_revision: i64,
    title: String,
    runs: Vec<QuickNoteTextRun>,
    color: i64,
    tag_id: Option<String>,
    pinned: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNoteRevisionRequest {
    id: String,
    expected_revision: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNotePinRequest {
    id: String,
    expected_revision: i64,
    pinned: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuickNotesCollection {
    Active,
    Archive,
    Trash,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNotesListRequest {
    collection: QuickNotesCollection,
    query: Option<String>,
    tag_id: Option<String>,
    cursor: Option<String>,
    page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNoteReorderRequest {
    id: String,
    previous_id: Option<String>,
    next_id: Option<String>,
    tag_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct QuickNotesCursor {
    pinned: i64,
    manual_order: f64,
    sort_time: String,
    id: String,
}

#[derive(Clone, Debug, FromRow)]
struct QuickNoteRow {
    id: String,
    title: String,
    body_plain_text: String,
    color: i64,
    tag_id: Option<String>,
    pinned: i64,
    archived: i64,
    trashed_at: Option<String>,
    revision: i64,
    manual_order: f64,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug, FromRow)]
struct QuickNoteTextRunRow {
    note_id: String,
    content: String,
    bold: i64,
    italic: i64,
    underline: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNoteRead {
    id: String,
    title: String,
    body_plain_text: String,
    runs: Vec<QuickNoteTextRun>,
    preview_truncated: bool,
    color: i64,
    tag_id: Option<String>,
    pinned: bool,
    archived: bool,
    trashed_at: Option<String>,
    revision: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNotesWindow {
    notes: Vec<QuickNoteRead>,
    next_cursor: Option<String>,
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty() || id.len() > 128 {
        return Err("quick note id must be between 1 and 128 bytes".to_string());
    }
    Ok(())
}

fn validate_color(color: i64) -> Result<(), String> {
    if !(0..32).contains(&color) {
        return Err("quick note color must be between 0 and 31".to_string());
    }
    Ok(())
}

fn validate_optional_tag_id(tag_id: Option<&str>) -> Result<(), String> {
    if let Some(id) = tag_id {
        validate_id(id)?;
    }
    Ok(())
}

fn normalized_runs(runs: &[QuickNoteTextRun]) -> Result<Vec<QuickNoteTextRun>, String> {
    if runs.len() > MAX_RUNS {
        return Err(format!(
            "quick note body cannot contain more than {MAX_RUNS} text runs"
        ));
    }
    let mut output: Vec<QuickNoteTextRun> = Vec::new();
    let mut body_chars = 0;
    for run in runs {
        if run.content.is_empty() {
            continue;
        }
        body_chars += run.content.chars().count();
        if body_chars > MAX_BODY_CHARS {
            return Err(format!(
                "quick note body cannot exceed {MAX_BODY_CHARS} characters"
            ));
        }
        if let Some(previous) = output.last_mut() {
            if previous.bold == run.bold
                && previous.italic == run.italic
                && previous.underline == run.underline
            {
                previous.content.push_str(&run.content);
                continue;
            }
        }
        output.push(run.clone());
    }
    Ok(output)
}

fn validate_content(
    id: &str,
    title: &str,
    runs: &[QuickNoteTextRun],
    color: i64,
) -> Result<Vec<QuickNoteTextRun>, String> {
    validate_id(id)?;
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(format!(
            "quick note title cannot exceed {MAX_TITLE_CHARS} characters"
        ));
    }
    validate_color(color)?;
    normalized_runs(runs)
}

fn body_plain_text(runs: &[QuickNoteTextRun]) -> String {
    runs.iter().map(|run| run.content.as_str()).collect()
}

async fn replace_runs(
    tx: &mut Transaction<'_, Sqlite>,
    note_id: &str,
    runs: &[QuickNoteTextRun],
) -> Result<(), String> {
    sqlx::query("DELETE FROM quick_note_text_runs WHERE note_id = ?")
        .bind(note_id)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("clear quick note text runs: {error}"))?;
    for (sort_order, run) in runs.iter().enumerate() {
        sqlx::query(
            "INSERT INTO quick_note_text_runs (
                note_id, sort_order, content, bold, italic, underline
             ) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(note_id)
        .bind(sort_order as i64)
        .bind(&run.content)
        .bind(i64::from(run.bold))
        .bind(i64::from(run.italic))
        .bind(i64::from(run.underline))
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("insert quick note text run: {error}"))?;
    }
    Ok(())
}

async fn load_run_rows(
    pool: &SqlitePool,
    note_ids: &[String],
) -> Result<Vec<QuickNoteTextRunRow>, String> {
    if note_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut query = QueryBuilder::<Sqlite>::new(
        "SELECT note_id, content, bold, italic, underline
         FROM quick_note_text_runs WHERE note_id IN (",
    );
    {
        let mut separated = query.separated(", ");
        for id in note_ids {
            separated.push_bind(id);
        }
    }
    query.push(") ORDER BY note_id, sort_order");
    query
        .build_query_as::<QuickNoteTextRunRow>()
        .fetch_all(pool)
        .await
        .map_err(|error| format!("load quick note text runs: {error}"))
}

fn read_runs(rows: Vec<QuickNoteTextRunRow>) -> HashMap<String, Vec<QuickNoteTextRun>> {
    let mut by_note: HashMap<String, Vec<QuickNoteTextRun>> = HashMap::new();
    for row in rows {
        by_note
            .entry(row.note_id)
            .or_default()
            .push(QuickNoteTextRun {
                content: row.content,
                bold: row.bold != 0,
                italic: row.italic != 0,
                underline: row.underline != 0,
            });
    }
    by_note
}

fn truncate_preview(runs: Vec<QuickNoteTextRun>) -> (Vec<QuickNoteTextRun>, bool) {
    let total = runs
        .iter()
        .map(|run| run.content.chars().count())
        .sum::<usize>();
    if total <= PREVIEW_CHARS {
        return (runs, false);
    }
    let mut remaining = PREVIEW_CHARS;
    let mut preview = Vec::new();
    for mut run in runs {
        if remaining == 0 {
            break;
        }
        let count = run.content.chars().count();
        if count > remaining {
            run.content = run.content.chars().take(remaining).collect();
        }
        remaining = remaining.saturating_sub(count);
        preview.push(run);
    }
    (preview, true)
}

fn read_note(mut row: QuickNoteRow, runs: Vec<QuickNoteTextRun>, preview: bool) -> QuickNoteRead {
    let (runs, preview_truncated) = if preview {
        row.body_plain_text = row.body_plain_text.chars().take(PREVIEW_CHARS).collect();
        truncate_preview(runs)
    } else {
        (runs, false)
    };
    QuickNoteRead {
        id: row.id,
        title: row.title,
        body_plain_text: row.body_plain_text,
        runs,
        preview_truncated,
        color: row.color,
        tag_id: row.tag_id,
        pinned: row.pinned != 0,
        archived: row.archived != 0,
        trashed_at: row.trashed_at,
        revision: row.revision,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

async fn load_note_from_pool(pool: &SqlitePool, id: &str) -> Result<QuickNoteRead, String> {
    validate_id(id)?;
    let row = sqlx::query_as::<_, QuickNoteRow>("SELECT * FROM quick_notes WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("load quick note: {error}"))?
        .ok_or_else(|| "quick note not found".to_string())?;
    let rows = load_run_rows(pool, &[id.to_string()]).await?;
    Ok(read_note(
        row,
        read_runs(rows).remove(id).unwrap_or_default(),
        false,
    ))
}

async fn cleanup_expired_trash(pool: &SqlitePool) -> Result<u64, String> {
    let result = sqlx::query(
        "DELETE FROM quick_notes
         WHERE trashed_at IS NOT NULL
           AND trashed_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)",
    )
    .bind(format!("-{TRASH_RETENTION_DAYS} days"))
    .execute(pool)
    .await
    .map_err(|error| format!("clean expired quick notes trash: {error}"))?;
    Ok(result.rows_affected())
}

fn fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn collection_predicate(collection: QuickNotesCollection) -> &'static str {
    match collection {
        QuickNotesCollection::Active => "q.archived = 0 AND q.trashed_at IS NULL",
        QuickNotesCollection::Archive => "q.archived = 1 AND q.trashed_at IS NULL",
        QuickNotesCollection::Trash => "q.trashed_at IS NOT NULL",
    }
}

fn cursor_pinned(row: &QuickNoteRow, collection: QuickNotesCollection) -> i64 {
    if collection == QuickNotesCollection::Active {
        row.pinned
    } else {
        0
    }
}

fn cursor_sort_time(row: &QuickNoteRow, collection: QuickNotesCollection) -> String {
    if collection == QuickNotesCollection::Trash {
        row.trashed_at
            .clone()
            .unwrap_or_else(|| row.updated_at.clone())
    } else {
        row.updated_at.clone()
    }
}

async fn list_window_from_pool(
    pool: &SqlitePool,
    request: QuickNotesListRequest,
) -> Result<QuickNotesWindow, String> {
    cleanup_expired_trash(pool).await?;
    let page_size = request.page_size.unwrap_or(DEFAULT_PAGE_SIZE);
    if !(1..=MAX_PAGE_SIZE).contains(&page_size) {
        return Err(format!("page size must be between 1 and {MAX_PAGE_SIZE}"));
    }
    let cursor = request
        .cursor
        .map(|value| {
            serde_json::from_str::<QuickNotesCursor>(&value)
                .map_err(|_| "invalid quick notes cursor".to_string())
        })
        .transpose()?;
    let search = request.query.unwrap_or_default().trim().to_string();
    if search.chars().count() > 200 {
        return Err("quick notes search cannot exceed 200 characters".to_string());
    }
    validate_optional_tag_id(request.tag_id.as_deref())?;
    if request.tag_id.is_some() && request.collection != QuickNotesCollection::Active {
        return Err("quick note tag filters are available only in All".to_string());
    }

    let mut sql = QueryBuilder::<Sqlite>::new("SELECT q.* FROM quick_notes q");
    if !search.is_empty() {
        sql.push(" JOIN quick_notes_search_fts ON quick_notes_search_fts.note_id = q.id");
    }
    sql.push(" WHERE ")
        .push(collection_predicate(request.collection));
    if let Some(tag_id) = &request.tag_id {
        sql.push(" AND q.tag_id = ").push_bind(tag_id);
    }
    if !search.is_empty() {
        sql.push(" AND quick_notes_search_fts MATCH ")
            .push_bind(fts_query(&search));
    }
    if let Some(cursor) = &cursor {
        if request.collection == QuickNotesCollection::Active {
            sql.push(" AND (q.pinned < ").push_bind(cursor.pinned);
            sql.push(" OR (q.pinned = ").push_bind(cursor.pinned);
            sql.push(" AND (q.manual_order > ")
                .push_bind(cursor.manual_order);
            sql.push(" OR (q.manual_order = ")
                .push_bind(cursor.manual_order);
            sql.push(" AND q.id > ")
                .push_bind(cursor.id.clone())
                .push("))))");
        } else if request.collection == QuickNotesCollection::Archive {
            sql.push(" AND (q.updated_at < ")
                .push_bind(cursor.sort_time.clone());
            sql.push(" OR (q.updated_at = ")
                .push_bind(cursor.sort_time.clone());
            sql.push(" AND q.id > ")
                .push_bind(cursor.id.clone())
                .push("))");
        } else {
            sql.push(" AND (q.trashed_at < ")
                .push_bind(cursor.sort_time.clone());
            sql.push(" OR (q.trashed_at = ")
                .push_bind(cursor.sort_time.clone());
            sql.push(" AND q.id > ")
                .push_bind(cursor.id.clone())
                .push("))");
        }
    }
    match request.collection {
        QuickNotesCollection::Active => {
            sql.push(" ORDER BY q.pinned DESC, q.manual_order ASC, q.id ASC")
        }
        QuickNotesCollection::Archive => sql.push(" ORDER BY q.updated_at DESC, q.id ASC"),
        QuickNotesCollection::Trash => sql.push(" ORDER BY q.trashed_at DESC, q.id ASC"),
    };
    sql.push(" LIMIT ").push_bind(page_size + 1);
    let mut rows = sql
        .build_query_as::<QuickNoteRow>()
        .fetch_all(pool)
        .await
        .map_err(|error| format!("list quick notes: {error}"))?;
    let has_more = rows.len() > page_size as usize;
    if has_more {
        rows.truncate(page_size as usize);
    }
    let next_cursor = if has_more {
        rows.last()
            .map(|row| QuickNotesCursor {
                pinned: cursor_pinned(row, request.collection),
                manual_order: row.manual_order,
                sort_time: cursor_sort_time(row, request.collection),
                id: row.id.clone(),
            })
            .map(|value| {
                serde_json::to_string(&value)
                    .map_err(|error| format!("serialize quick notes cursor: {error}"))
            })
            .transpose()?
    } else {
        None
    };
    let ids = rows.iter().map(|row| row.id.clone()).collect::<Vec<_>>();
    let mut runs = read_runs(load_run_rows(pool, &ids).await?);
    let notes = rows
        .into_iter()
        .map(|row| {
            let note_runs = runs.remove(&row.id).unwrap_or_default();
            read_note(row, note_runs, true)
        })
        .collect();
    Ok(QuickNotesWindow { notes, next_cursor })
}

#[tauri::command]
pub async fn quick_notes_list<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    request: QuickNotesListRequest,
) -> Result<QuickNotesWindow, String> {
    let pool = connect_sqlite(app, db_url).await?;
    list_window_from_pool(&pool, request).await
}

#[tauri::command]
pub async fn quick_notes_get<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
) -> Result<QuickNoteRead, String> {
    let pool = connect_sqlite(app, db_url).await?;
    cleanup_expired_trash(&pool).await?;
    load_note_from_pool(&pool, &id).await
}

#[tauri::command]
pub async fn quick_notes_create<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    note: QuickNoteWrite,
) -> Result<QuickNoteRead, String> {
    let runs = validate_content(&note.id, &note.title, &note.runs, note.color)?;
    validate_optional_tag_id(note.tag_id.as_deref())?;
    let body = body_plain_text(&runs);
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("begin quick note create: {error}"))?;
    sqlx::query(
        "INSERT INTO quick_notes (
             id, title, body_plain_text, color, tag_id, pinned, manual_order
         ) VALUES (
             ?, ?, ?, ?, ?, ?,
             COALESCE((
                 SELECT MIN(manual_order) - 1024.0
                 FROM quick_notes
                 WHERE pinned = ? AND archived = 0 AND trashed_at IS NULL
             ), 0.0)
         )",
    )
    .bind(&note.id)
    .bind(note.title.trim())
    .bind(body)
    .bind(note.color)
    .bind(note.tag_id)
    .bind(i64::from(note.pinned))
    .bind(i64::from(note.pinned))
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("create quick note: {error}"))?;
    replace_runs(&mut tx, &note.id, &runs).await?;
    tx.commit()
        .await
        .map_err(|error| format!("commit quick note create: {error}"))?;
    load_note_from_pool(&pool, &note.id).await
}

#[tauri::command]
pub async fn quick_notes_update<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    note: QuickNoteUpdate,
) -> Result<QuickNoteRead, QuickNoteWriteError> {
    let runs = validate_content(&note.id, &note.title, &note.runs, note.color)?;
    validate_optional_tag_id(note.tag_id.as_deref())?;
    if note.expected_revision < 1 {
        return Err("quick note revision must be positive".to_string().into());
    }
    let body = body_plain_text(&runs);
    let pool = connect_sqlite(app, db_url).await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("begin quick note update: {error}"))?;
    let result = sqlx::query(
        "UPDATE quick_notes
         SET title = ?, body_plain_text = ?, color = ?, tag_id = ?,
             pinned = CASE WHEN archived = 0 AND trashed_at IS NULL THEN ? ELSE 0 END,
             revision = revision + 1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND revision = ? AND trashed_at IS NULL",
    )
    .bind(note.title.trim())
    .bind(body)
    .bind(note.color)
    .bind(note.tag_id)
    .bind(i64::from(note.pinned))
    .bind(&note.id)
    .bind(note.expected_revision)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("update quick note: {error}"))?;
    if result.rows_affected() != 1 {
        return Err(QuickNoteWriteError::RevisionConflict(
            "quick note revision conflict".to_string(),
        ));
    }
    replace_runs(&mut tx, &note.id, &runs).await?;
    tx.commit()
        .await
        .map_err(|error| format!("commit quick note update: {error}"))?;
    load_note_from_pool(&pool, &note.id)
        .await
        .map_err(Into::into)
}

async fn revision_mutation(
    pool: &SqlitePool,
    request: &QuickNoteRevisionRequest,
    sql: &str,
    context: &str,
) -> Result<QuickNoteRead, QuickNoteWriteError> {
    validate_id(&request.id)?;
    let result = sqlx::query(sql)
        .bind(&request.id)
        .bind(request.expected_revision)
        .execute(pool)
        .await
        .map_err(|error| format!("{context}: {error}"))?;
    if result.rows_affected() != 1 {
        return Err(QuickNoteWriteError::RevisionConflict(
            "quick note revision conflict".to_string(),
        ));
    }
    load_note_from_pool(pool, &request.id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn quick_notes_set_pinned<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    request: QuickNotePinRequest,
) -> Result<QuickNoteRead, QuickNoteWriteError> {
    validate_id(&request.id)?;
    let pool = connect_sqlite(app, db_url).await?;
    let result = sqlx::query(
        "UPDATE quick_notes
         SET manual_order = CASE
                 WHEN pinned <> ? THEN COALESCE((
                     SELECT MIN(candidate.manual_order) - 1024.0
                     FROM quick_notes AS candidate
                     WHERE candidate.pinned = ?
                       AND candidate.archived = 0
                       AND candidate.trashed_at IS NULL
                 ), 0.0)
                 ELSE manual_order
             END,
             pinned = ?, revision = revision + 1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND revision = ? AND archived = 0 AND trashed_at IS NULL",
    )
    .bind(i64::from(request.pinned))
    .bind(i64::from(request.pinned))
    .bind(i64::from(request.pinned))
    .bind(&request.id)
    .bind(request.expected_revision)
    .execute(&pool)
    .await
    .map_err(|error| format!("set quick note pinned state: {error}"))?;
    if result.rows_affected() != 1 {
        return Err(QuickNoteWriteError::RevisionConflict(
            "quick note revision conflict".to_string(),
        ));
    }
    load_note_from_pool(&pool, &request.id)
        .await
        .map_err(Into::into)
}

#[derive(Debug, FromRow)]
struct QuickNoteOrderRow {
    id: String,
    tag_id: Option<String>,
    manual_order: f64,
}

async fn reorder_from_pool(
    pool: &SqlitePool,
    request: QuickNoteReorderRequest,
) -> Result<(), String> {
    validate_id(&request.id)?;
    validate_optional_tag_id(request.previous_id.as_deref())?;
    validate_optional_tag_id(request.next_id.as_deref())?;
    validate_optional_tag_id(request.tag_id.as_deref())?;
    if request.previous_id.as_deref() == Some(request.id.as_str())
        || request.next_id.as_deref() == Some(request.id.as_str())
        || request.previous_id == request.next_id
    {
        return Err("quick note reorder anchors must be distinct".to_string());
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("begin quick note reorder: {error}"))?;
    let pinned = sqlx::query_scalar::<_, i64>(
        "SELECT pinned FROM quick_notes
         WHERE id = ? AND archived = 0 AND trashed_at IS NULL",
    )
    .bind(&request.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| format!("load quick note reorder source: {error}"))?
    .ok_or_else(|| "active quick note not found".to_string())?;

    let mut rows = sqlx::query_as::<_, QuickNoteOrderRow>(
        "SELECT id, tag_id, manual_order
         FROM quick_notes
         WHERE pinned = ? AND archived = 0 AND trashed_at IS NULL
         ORDER BY manual_order ASC, id ASC",
    )
    .bind(pinned)
    .fetch_all(&mut *tx)
    .await
    .map_err(|error| format!("load quick note reorder group: {error}"))?;

    let source = rows
        .iter()
        .find(|row| row.id == request.id)
        .ok_or_else(|| "quick note reorder source is outside its order group".to_string())?;
    if request.tag_id.is_some() && source.tag_id != request.tag_id {
        return Err("quick note reorder source is outside the selected tag".to_string());
    }
    rows.retain(|row| row.id != request.id);

    let is_visible = |row: &&QuickNoteOrderRow| match request.tag_id.as_ref() {
        Some(tag_id) => row.tag_id.as_ref() == Some(tag_id),
        None => true,
    };
    let visible_ids = rows
        .iter()
        .filter(is_visible)
        .map(|row| row.id.as_str())
        .collect::<Vec<_>>();
    let visible_position = |anchor: Option<&str>, label: &str| -> Result<Option<usize>, String> {
        match anchor {
            Some(id) => visible_ids
                .iter()
                .position(|candidate| *candidate == id)
                .map(Some)
                .ok_or_else(|| format!("quick note reorder {label} anchor is invalid")),
            None => Ok(None),
        }
    };
    let previous_visible_index = visible_position(request.previous_id.as_deref(), "previous")?;
    let next_visible_index = visible_position(request.next_id.as_deref(), "next")?;
    if let (Some(previous), Some(next)) = (previous_visible_index, next_visible_index) {
        if previous + 1 != next {
            return Err("quick note reorder anchors are not adjacent".to_string());
        }
    }

    let insertion_index = if let Some(next_id) = request.next_id.as_deref() {
        rows.iter()
            .position(|row| row.id == next_id)
            .ok_or_else(|| "quick note reorder next anchor is unavailable".to_string())?
    } else if let Some(previous_id) = request.previous_id.as_deref() {
        rows.iter()
            .position(|row| row.id == previous_id)
            .map(|index| index + 1)
            .ok_or_else(|| "quick note reorder previous anchor is unavailable".to_string())?
    } else {
        0
    };
    let previous_order = insertion_index
        .checked_sub(1)
        .map(|index| rows[index].manual_order);
    let next_order = rows.get(insertion_index).map(|row| row.manual_order);
    let new_order = match (previous_order, next_order) {
        (Some(previous), Some(next)) if next - previous > 0.000_001 => (previous + next) / 2.0,
        (None, Some(next)) => next - 1024.0,
        (Some(previous), None) => previous + 1024.0,
        (None, None) => 0.0,
        (Some(_), Some(_)) => {
            for (index, row) in rows.iter().enumerate() {
                sqlx::query("UPDATE quick_notes SET manual_order = ? WHERE id = ?")
                    .bind(index as f64 * 1024.0)
                    .bind(&row.id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|error| format!("rebalance quick note order: {error}"))?;
            }
            insertion_index as f64 * 1024.0 - 512.0
        }
    };
    sqlx::query("UPDATE quick_notes SET manual_order = ? WHERE id = ?")
        .bind(new_order)
        .bind(&request.id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("reorder quick note: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("commit quick note reorder: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn quick_notes_reorder<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    request: QuickNoteReorderRequest,
) -> Result<(), String> {
    let pool = connect_sqlite(app, db_url).await?;
    reorder_from_pool(&pool, request).await
}

#[tauri::command]
pub async fn quick_notes_archive<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    request: QuickNoteRevisionRequest,
) -> Result<QuickNoteRead, QuickNoteWriteError> {
    let pool = connect_sqlite(app, db_url).await?;
    revision_mutation(
        &pool,
        &request,
        "UPDATE quick_notes SET archived = 1, pinned = 0, revision = revision + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND revision = ? AND archived = 0 AND trashed_at IS NULL",
        "archive quick note",
    )
    .await
}

#[tauri::command]
pub async fn quick_notes_unarchive<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    request: QuickNoteRevisionRequest,
) -> Result<QuickNoteRead, QuickNoteWriteError> {
    let pool = connect_sqlite(app, db_url).await?;
    revision_mutation(
        &pool,
        &request,
        "UPDATE quick_notes SET archived = 0, pinned = 0,
         manual_order = COALESCE((
             SELECT MIN(candidate.manual_order) - 1024.0
             FROM quick_notes AS candidate
             WHERE candidate.pinned = 0
               AND candidate.archived = 0
               AND candidate.trashed_at IS NULL
         ), 0.0),
         revision = revision + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND revision = ? AND archived = 1 AND trashed_at IS NULL",
        "unarchive quick note",
    )
    .await
}

#[tauri::command]
pub async fn quick_notes_trash<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    request: QuickNoteRevisionRequest,
) -> Result<QuickNoteRead, QuickNoteWriteError> {
    let pool = connect_sqlite(app, db_url).await?;
    revision_mutation(
        &pool,
        &request,
        "UPDATE quick_notes SET trashed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         pinned = 0, revision = revision + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND revision = ? AND trashed_at IS NULL",
        "trash quick note",
    )
    .await
}

#[tauri::command]
pub async fn quick_notes_restore<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    request: QuickNoteRevisionRequest,
) -> Result<QuickNoteRead, QuickNoteWriteError> {
    let pool = connect_sqlite(app, db_url).await?;
    revision_mutation(
        &pool,
        &request,
        "UPDATE quick_notes SET trashed_at = NULL, pinned = 0,
         manual_order = COALESCE((
             SELECT MIN(candidate.manual_order) - 1024.0
             FROM quick_notes AS candidate
             WHERE candidate.pinned = 0
               AND candidate.archived = 0
               AND candidate.trashed_at IS NULL
         ), 0.0),
         revision = revision + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND revision = ? AND trashed_at IS NOT NULL",
        "restore quick note",
    )
    .await
}

#[tauri::command]
pub async fn quick_notes_delete_permanently<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
) -> Result<(), String> {
    validate_id(&id)?;
    let pool = connect_sqlite(app, db_url).await?;
    let result = sqlx::query("DELETE FROM quick_notes WHERE id = ? AND trashed_at IS NOT NULL")
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|error| format!("delete quick note permanently: {error}"))?;
    if result.rows_affected() != 1 {
        return Err("trashed quick note not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn quick_notes_empty_trash<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<u64, String> {
    let pool = connect_sqlite(app, db_url).await?;
    sqlx::query("DELETE FROM quick_notes WHERE trashed_at IS NOT NULL")
        .execute(&pool)
        .await
        .map(|result| result.rows_affected())
        .map_err(|error| format!("empty quick notes trash: {error}"))
}

#[tauri::command]
pub async fn quick_note_tags_list<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<Vec<QuickNoteTagRead>, String> {
    tags::list(app, db_url).await
}

#[tauri::command]
pub async fn quick_note_tags_create<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    tag: QuickNoteTagWrite,
) -> Result<QuickNoteTagRead, String> {
    tags::create(app, db_url, tag).await
}

#[tauri::command]
pub async fn quick_note_tags_delete<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    id: String,
) -> Result<(), String> {
    tags::delete(app, db_url, id).await
}

#[cfg(test)]
mod tests;
