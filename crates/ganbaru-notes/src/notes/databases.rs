use super::models::{
    NoteBlockRow, NoteCreatedDatabaseDto, NoteDataSourceRow, NoteDatabaseCreate, NoteDatabaseRow,
    NoteDatabaseViewRow, NoteLinkedDatabaseCreate,
};
use super::validation::{
    plain_text_from_payload, require_uuid, validate_block_payload, validate_database_create,
    validate_sort_order,
};
use super::{history, project_history, writes};
use serde_json::{Value, json};
use sqlx::{Sqlite, SqlitePool, Transaction};

const DEFAULT_DATABASE_TITLE: &str = "Untitled database";
const DEFAULT_TITLE_PROPERTY_NAME: &str = "Name";
const DEFAULT_TABLE_VIEW_NAME: &str = "Table";

pub async fn create_database(
    pool: &SqlitePool,
    request: NoteDatabaseCreate,
) -> Result<NoteCreatedDatabaseDto, String> {
    validate_database_create(&request)?;
    if let Some(block_id) = request.replace_block_id.as_ref() {
        project_history::ensure_blocks_baseline_for_mutation(pool, std::slice::from_ref(block_id))
            .await?;
    } else if let Some(parent) = request.parent.as_ref() {
        project_history::ensure_parent_baseline_for_mutation(pool, parent).await?;
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin notes database create: {e}"))?;
    let (parent, title) = if let Some(replace_block_id) = &request.replace_block_id {
        let current = load_block_row_tx(&mut tx, replace_block_id).await?;
        validate_replacement_block(&current)?;
        let parent = writes::parent_target_from_block_row(&current);
        let title = database_title(&request.title, Some(&current));
        history::record_page_snapshot_tx(&mut tx, &current.page_id, "create_database_from_block")
            .await?;
        replace_block_with_database(&mut tx, &current, &request, &title).await?;
        (parent, title)
    } else {
        let request_parent = request
            .parent
            .as_ref()
            .ok_or_else(|| "parent is required".to_string())?;
        let parent = writes::resolve_block_parent(&mut tx, request_parent).await?;
        let title = database_title(&request.title, None);
        let sort_order =
            writes::next_sort_orders(&mut tx, &parent, request.after_block_id.as_deref(), 1)
                .await?
                .into_iter()
                .next()
                .ok_or_else(|| "database sort order was not prepared".to_string())?;
        validate_sort_order(sort_order)?;
        history::record_page_snapshot_tx(&mut tx, &parent.page_id, "create_database").await?;
        insert_database_block(&mut tx, &parent, &request, &title, sort_order).await?;
        writes::refresh_parent_has_children(&mut tx, &parent).await?;
        (parent, title)
    };
    insert_database_objects(&mut tx, &parent, &request, &title).await?;
    writes::touch_page(&mut tx, &parent.page_id).await?;
    let created = load_created_database_tx(&mut tx, &request.id).await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit notes database create: {e}"))?;
    Ok(created)
}

pub async fn create_linked_database_view(
    pool: &SqlitePool,
    request: NoteLinkedDatabaseCreate,
) -> Result<NoteCreatedDatabaseDto, String> {
    validate_linked_database_create(&request)?;
    project_history::ensure_blocks_baseline_for_mutation(
        pool,
        std::slice::from_ref(&request.source_block_id),
    )
    .await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin linked notes database create: {e}"))?;
    let source_block = load_block_row_tx(&mut tx, &request.source_block_id).await?;
    if source_block.block_type != "child_database" {
        return Err("linked database source must be a local database block".to_string());
    }
    let (source_data_source_id, source_view_id) = source_database_refs(&source_block)?;
    let source = load_active_data_source_tx(&mut tx, &source_data_source_id).await?;
    let parent = writes::parent_target_from_block_row(&source_block);
    let title = linked_database_title(&request.title, &source_block, &source);
    let sort_order = writes::next_sort_orders(&mut tx, &parent, Some(&source_block.id), 1)
        .await?
        .into_iter()
        .next()
        .ok_or_else(|| "linked database sort order was not prepared".to_string())?;
    validate_sort_order(sort_order)?;
    history::record_page_snapshot_tx(&mut tx, &parent.page_id, "create_linked_database").await?;
    insert_linked_database_block(
        &mut tx,
        &parent,
        &request,
        &title,
        &source_data_source_id,
        sort_order,
    )
    .await?;
    insert_linked_database_objects(
        &mut tx,
        &parent,
        &request,
        &title,
        &source_data_source_id,
        &source_view_id,
    )
    .await?;
    writes::refresh_parent_has_children(&mut tx, &parent).await?;
    writes::touch_page(&mut tx, &parent.page_id).await?;
    let created = load_created_linked_database_tx(
        &mut tx,
        &request.id,
        &source_data_source_id,
        &request.view_id,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit linked notes database create: {e}"))?;
    Ok(created)
}

async fn replace_block_with_database(
    tx: &mut Transaction<'_, Sqlite>,
    current: &NoteBlockRow,
    request: &NoteDatabaseCreate,
    title: &str,
) -> Result<(), String> {
    let payload = child_database_payload(request, title);
    validate_block_payload("child_database", &payload)?;
    let plain_text = plain_text_from_payload("child_database", &payload);
    sqlx::query(
        "UPDATE notes_blocks
         SET type = 'child_database',
             payload = ?,
             plain_text = ?,
             last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND in_trash = 0",
    )
    .bind(payload.to_string())
    .bind(plain_text)
    .bind(&current.id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("convert notes block to database: {e}"))?;
    Ok(())
}

async fn insert_database_block(
    tx: &mut Transaction<'_, Sqlite>,
    parent: &writes::ParentTarget,
    request: &NoteDatabaseCreate,
    title: &str,
    sort_order: f64,
) -> Result<(), String> {
    let payload = child_database_payload(request, title);
    validate_block_payload("child_database", &payload)?;
    let plain_text = plain_text_from_payload("child_database", &payload);
    sqlx::query(
        "INSERT INTO notes_blocks (
            id,
            page_id,
            parent_type,
            parent_page_id,
            parent_block_id,
            type,
            payload,
            plain_text,
            sort_order
         )
         VALUES (?, ?, ?, ?, ?, 'child_database', ?, ?, ?)",
    )
    .bind(request.id.trim())
    .bind(&parent.page_id)
    .bind(parent.parent_type)
    .bind(&parent.parent_page_id)
    .bind(&parent.parent_block_id)
    .bind(payload.to_string())
    .bind(plain_text)
    .bind(sort_order)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert notes database block: {e}"))?;
    Ok(())
}

async fn insert_database_objects(
    tx: &mut Transaction<'_, Sqlite>,
    parent: &writes::ParentTarget,
    request: &NoteDatabaseCreate,
    title: &str,
) -> Result<(), String> {
    let title_rich_text = rich_text_array(title);
    let description = Value::Array(Vec::new());
    let icon = request.icon.as_ref().map(Value::to_string);
    let cover = request.cover.as_ref().map(Value::to_string);
    sqlx::query(
        "INSERT INTO notes_databases (
            id,
            parent_type,
            parent_page_id,
            parent_block_id,
            title,
            title_rich_text,
            description,
            icon,
            cover,
            is_inline
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(request.id.trim())
    .bind(parent.parent_type)
    .bind(&parent.parent_page_id)
    .bind(&parent.parent_block_id)
    .bind(title)
    .bind(title_rich_text.to_string())
    .bind(description.to_string())
    .bind(icon.clone())
    .bind(cover)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert notes database: {e}"))?;

    sqlx::query(
        "INSERT INTO notes_data_sources (
            id,
            database_id,
            title,
            title_rich_text,
            description,
            icon,
            properties
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(request.data_source_id.trim())
    .bind(request.id.trim())
    .bind(title)
    .bind(title_rich_text.to_string())
    .bind(description.to_string())
    .bind(icon)
    .bind(default_data_source_properties().to_string())
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert notes data source: {e}"))?;

    sqlx::query(
        "INSERT INTO notes_database_views (
            id,
            database_id,
            data_source_id,
            name,
            type,
            sorts,
            configuration
         )
         VALUES (?, ?, ?, ?, 'table', ?, ?)",
    )
    .bind(request.view_id.trim())
    .bind(request.id.trim())
    .bind(request.data_source_id.trim())
    .bind(DEFAULT_TABLE_VIEW_NAME)
    .bind(Value::Array(Vec::new()).to_string())
    .bind(default_table_view_configuration().to_string())
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert notes database view: {e}"))?;
    Ok(())
}

async fn load_created_database_tx(
    tx: &mut Transaction<'_, Sqlite>,
    database_id: &str,
) -> Result<NoteCreatedDatabaseDto, String> {
    let database =
        sqlx::query_as::<_, NoteDatabaseRow>("SELECT * FROM notes_databases WHERE id = ?")
            .bind(database_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| format!("load created notes database: {e}"))?;
    let data_source = sqlx::query_as::<_, NoteDataSourceRow>(
        "SELECT *
         FROM notes_data_sources
         WHERE database_id = ?
         ORDER BY created_time ASC, id ASC
         LIMIT 1",
    )
    .bind(database_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("load created notes data source: {e}"))?;
    let view = sqlx::query_as::<_, NoteDatabaseViewRow>(
        "SELECT id,
                database_id,
                data_source_id,
                name,
                type AS view_type,
                filter,
                sorts,
                configuration,
                source_provider,
                source_object_id,
                source_workspace_id,
                source_last_edited_time,
                url,
                created_time,
                last_edited_time
         FROM notes_database_views
         WHERE database_id = ?
         ORDER BY sort_order ASC, created_time ASC, id ASC
         LIMIT 1",
    )
    .bind(database_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("load created notes database view: {e}"))?;
    let block = load_block_row_tx(tx, database_id).await?;
    NoteCreatedDatabaseDto::new(database, data_source, view, block)
}

async fn load_block_row_tx(
    tx: &mut Transaction<'_, Sqlite>,
    block_id: &str,
) -> Result<NoteBlockRow, String> {
    sqlx::query_as::<_, NoteBlockRow>(
        "SELECT id,
                page_id,
                parent_type,
                parent_page_id,
                parent_block_id,
                has_children,
                in_trash,
                type AS block_type,
                payload,
                plain_text,
                sort_order,
                source_provider,
                source_object_id,
                source_last_edited_time,
                created_time,
                last_edited_time
         FROM notes_blocks
         WHERE id = ? AND in_trash = 0",
    )
    .bind(block_id.trim())
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load notes database block: {e}"))?
    .ok_or_else(|| "block not found".to_string())
}

fn validate_replacement_block(current: &NoteBlockRow) -> Result<(), String> {
    if current.block_type == "child_page" {
        return Err("child_page blocks cannot be converted to databases".to_string());
    }
    if matches!(
        current.block_type.as_str(),
        "table" | "table_row" | "column_list" | "column" | "tab"
    ) {
        return Err(format!(
            "{} blocks cannot be converted to databases",
            current.block_type
        ));
    }
    Ok(())
}

fn database_title(request_title: &str, current: Option<&NoteBlockRow>) -> String {
    request_title
        .trim()
        .to_string()
        .or_else_not_empty()
        .or_else(|| current.and_then(|row| row.plain_text.trim().to_string().or_else_not_empty()))
        .unwrap_or_else(|| DEFAULT_DATABASE_TITLE.to_string())
}

fn child_database_payload(request: &NoteDatabaseCreate, title: &str) -> Value {
    json!({
        "title": title,
        "database_id": request.id.trim(),
        "data_source_id": request.data_source_id.trim(),
        "view_id": request.view_id.trim()
    })
}

fn linked_child_database_payload(
    request: &NoteLinkedDatabaseCreate,
    title: &str,
    data_source_id: &str,
) -> Value {
    json!({
        "title": title,
        "database_id": request.id.trim(),
        "data_source_id": data_source_id.trim(),
        "view_id": request.view_id.trim()
    })
}

async fn insert_linked_database_block(
    tx: &mut Transaction<'_, Sqlite>,
    parent: &writes::ParentTarget,
    request: &NoteLinkedDatabaseCreate,
    title: &str,
    data_source_id: &str,
    sort_order: f64,
) -> Result<(), String> {
    let payload = linked_child_database_payload(request, title, data_source_id);
    validate_block_payload("child_database", &payload)?;
    let plain_text = plain_text_from_payload("child_database", &payload);
    sqlx::query(
        "INSERT INTO notes_blocks (
            id,
            page_id,
            parent_type,
            parent_page_id,
            parent_block_id,
            type,
            payload,
            plain_text,
            sort_order
         )
         VALUES (?, ?, ?, ?, ?, 'child_database', ?, ?, ?)",
    )
    .bind(request.id.trim())
    .bind(&parent.page_id)
    .bind(parent.parent_type)
    .bind(&parent.parent_page_id)
    .bind(&parent.parent_block_id)
    .bind(payload.to_string())
    .bind(plain_text)
    .bind(sort_order)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert linked notes database block: {e}"))?;
    Ok(())
}

async fn insert_linked_database_objects(
    tx: &mut Transaction<'_, Sqlite>,
    parent: &writes::ParentTarget,
    request: &NoteLinkedDatabaseCreate,
    title: &str,
    data_source_id: &str,
    source_view_id: &str,
) -> Result<(), String> {
    let title_rich_text = rich_text_array(title);
    let description = Value::Array(Vec::new());
    sqlx::query(
        "INSERT INTO notes_databases (
            id,
            parent_type,
            parent_page_id,
            parent_block_id,
            title,
            title_rich_text,
            description,
            is_inline
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(request.id.trim())
    .bind(parent.parent_type)
    .bind(&parent.parent_page_id)
    .bind(&parent.parent_block_id)
    .bind(title)
    .bind(title_rich_text.to_string())
    .bind(description.to_string())
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert linked notes database: {e}"))?;

    let source_view = load_source_table_view_tx(tx, data_source_id, source_view_id).await?;
    sqlx::query(
        "INSERT INTO notes_database_views (
            id,
            database_id,
            data_source_id,
            name,
            type,
            filter,
            sorts,
            configuration
         )
         VALUES (?, ?, ?, ?, 'table', ?, ?, ?)",
    )
    .bind(request.view_id.trim())
    .bind(request.id.trim())
    .bind(data_source_id.trim())
    .bind(DEFAULT_TABLE_VIEW_NAME)
    .bind(source_view.filter)
    .bind(source_view.sorts)
    .bind(source_view.configuration)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert linked notes database view: {e}"))?;
    Ok(())
}

async fn load_source_table_view_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
    source_view_id: &str,
) -> Result<NoteDatabaseViewRow, String> {
    let exact = sqlx::query_as::<_, NoteDatabaseViewRow>(
        "SELECT id,
                database_id,
                data_source_id,
                name,
                type AS view_type,
                filter,
                sorts,
                configuration,
                source_provider,
                source_object_id,
                source_workspace_id,
                source_last_edited_time,
                url,
                created_time,
                last_edited_time
         FROM notes_database_views
         WHERE id = ? AND data_source_id = ? AND type = 'table'",
    )
    .bind(source_view_id.trim())
    .bind(data_source_id.trim())
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load exact source table view: {e}"))?;
    if let Some(view) = exact {
        return Ok(view);
    }
    sqlx::query_as::<_, NoteDatabaseViewRow>(
        "SELECT id,
                database_id,
                data_source_id,
                name,
                type AS view_type,
                filter,
                sorts,
                configuration,
                source_provider,
                source_object_id,
                source_workspace_id,
                source_last_edited_time,
                url,
                created_time,
                last_edited_time
         FROM notes_database_views
         WHERE data_source_id = ? AND type = 'table'
         ORDER BY sort_order ASC, created_time ASC, id ASC
         LIMIT 1",
    )
    .bind(data_source_id.trim())
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("load source table view: {e}"))
}

async fn load_active_data_source_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
) -> Result<NoteDataSourceRow, String> {
    sqlx::query_as::<_, NoteDataSourceRow>(
        "SELECT data_source.*
         FROM notes_data_sources AS data_source
         JOIN notes_databases AS database ON database.id = data_source.database_id
         WHERE data_source.id = ?
           AND data_source.in_trash = 0
           AND database.in_trash = 0",
    )
    .bind(data_source_id.trim())
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load linked source data source: {e}"))?
    .ok_or_else(|| "linked source data source not found".to_string())
}

async fn load_created_linked_database_tx(
    tx: &mut Transaction<'_, Sqlite>,
    database_id: &str,
    data_source_id: &str,
    view_id: &str,
) -> Result<NoteCreatedDatabaseDto, String> {
    let database =
        sqlx::query_as::<_, NoteDatabaseRow>("SELECT * FROM notes_databases WHERE id = ?")
            .bind(database_id.trim())
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| format!("load created linked notes database: {e}"))?;
    let data_source =
        sqlx::query_as::<_, NoteDataSourceRow>("SELECT * FROM notes_data_sources WHERE id = ?")
            .bind(data_source_id.trim())
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| format!("load linked notes data source: {e}"))?;
    let view = sqlx::query_as::<_, NoteDatabaseViewRow>(
        "SELECT id,
                database_id,
                data_source_id,
                name,
                type AS view_type,
                filter,
                sorts,
                configuration,
                source_provider,
                source_object_id,
                source_workspace_id,
                source_last_edited_time,
                url,
                created_time,
                last_edited_time
         FROM notes_database_views
         WHERE id = ?",
    )
    .bind(view_id.trim())
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("load created linked notes database view: {e}"))?;
    let block = load_block_row_tx(tx, database_id).await?;
    NoteCreatedDatabaseDto::new(database, data_source, view, block)
}

fn validate_linked_database_create(request: &NoteLinkedDatabaseCreate) -> Result<(), String> {
    require_uuid(&request.id, "id")?;
    require_uuid(&request.view_id, "view_id")?;
    require_uuid(&request.source_block_id, "source_block_id")?;
    if request.id == request.view_id {
        return Err("linked database id and view_id must be unique".to_string());
    }
    if request.id == request.source_block_id {
        return Err("linked database id must differ from source block id".to_string());
    }
    Ok(())
}

fn source_database_refs(source_block: &NoteBlockRow) -> Result<(String, String), String> {
    let payload: Value = serde_json::from_str(&source_block.payload)
        .map_err(|e| format!("parse source child_database payload: {e}"))?;
    let data_source_id = payload
        .get("data_source_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "source database block has no data_source_id".to_string())?;
    let view_id = payload
        .get("view_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "source database block has no view_id".to_string())?;
    require_uuid(data_source_id, "source data_source_id")?;
    require_uuid(view_id, "source view_id")?;
    Ok((data_source_id.to_string(), view_id.to_string()))
}

fn linked_database_title(
    request_title: &Option<String>,
    source_block: &NoteBlockRow,
    source: &NoteDataSourceRow,
) -> String {
    request_title
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string()
        .or_else_not_empty()
        .or_else(|| {
            source_block
                .plain_text
                .trim()
                .to_string()
                .or_else_not_empty()
        })
        .or_else(|| source.title.trim().to_string().or_else_not_empty())
        .unwrap_or_else(|| DEFAULT_DATABASE_TITLE.to_string())
}

fn default_data_source_properties() -> Value {
    let mut properties = serde_json::Map::new();
    properties.insert(
        DEFAULT_TITLE_PROPERTY_NAME.to_string(),
        json!({
            "id": "title",
            "name": DEFAULT_TITLE_PROPERTY_NAME,
            "type": "title",
            "title": {}
        }),
    );
    Value::Object(properties)
}

fn default_table_view_configuration() -> Value {
    json!({
        "type": "table",
        "table": {
            "property_order": ["title"],
            "hidden_property_ids": [],
            "column_widths": {},
            "row_open_mode": "full_page"
        }
    })
}

fn rich_text_array(text: &str) -> Value {
    json!([{
        "type": "text",
        "text": {
            "content": text,
            "link": null
        },
        "annotations": {
            "bold": false,
            "italic": false,
            "strikethrough": false,
            "underline": false,
            "code": false,
            "color": "default"
        },
        "plain_text": text,
        "href": null
    }])
}

trait NonEmptyString {
    fn or_else_not_empty(self) -> Option<String>;
}

impl NonEmptyString for String {
    fn or_else_not_empty(self) -> Option<String> {
        if self.is_empty() { None } else { Some(self) }
    }
}
