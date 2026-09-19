use super::models::{
    NoteDataSourceRow, NoteDataSourceRowPropertyUpdate, NoteDataSourceTableConfigurationUpdate,
    NoteDataSourceTableFilter, NoteDataSourceTableSort, NoteDataSourceTableViewDto,
    NoteDataSourceTableViewUpdate, NoteDataSourceViewWindowRequest, NoteDatabaseViewRow,
    NotePageDto, NotePageRow,
};
use super::validation::require_uuid;
use super::{
    data_source_buttons, data_source_formulas, data_source_relations, data_source_rollups,
    data_source_views::{
        self, canonical_filter, canonical_sorts, load_active_data_source_and_database_tx,
        parse_json, read_string_field, rich_text_plain_text, stored_filters, stored_sorts,
        title_from_property_value,
    },
    data_source_window, history, writes,
};
use serde_json::{Map, Value, json};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::cmp::Ordering;
use std::collections::HashSet;

const MAX_PROPERTY_TEXT_CHARS: usize = 2_000;
const MIN_COLUMN_WIDTH: i64 = 96;
const MAX_COLUMN_WIDTH: i64 = 480;
const MAX_TABLE_CONFIGURATION_BYTES: usize = 50 * 1024;
const ROW_OPEN_MODES: &[&str] = &["full_page", "side_panel"];

#[cfg(test)]
pub async fn get_data_source_table_view(
    pool: &SqlitePool,
    data_source_id: &str,
    database_id: Option<&str>,
    view_id: Option<&str>,
) -> Result<NoteDataSourceTableViewDto, String> {
    get_data_source_table_view_window(
        pool,
        data_source_id,
        database_id,
        view_id,
        NoteDataSourceViewWindowRequest::default(),
    )
    .await
}

pub async fn get_data_source_table_view_window(
    pool: &SqlitePool,
    data_source_id: &str,
    database_id: Option<&str>,
    view_id: Option<&str>,
    window: NoteDataSourceViewWindowRequest,
) -> Result<NoteDataSourceTableViewDto, String> {
    data_source_views::validate_view_scope(data_source_id, database_id, view_id)?;
    crate::notes::project_history::ensure_data_source_baseline_for_mutation(pool, data_source_id)
        .await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin notes data source table read: {e}"))?;
    let dto = load_table_view_tx(&mut tx, data_source_id, database_id, view_id, &window).await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit notes data source table read: {e}"))?;
    Ok(dto)
}

pub async fn update_data_source_table_view(
    pool: &SqlitePool,
    data_source_id: &str,
    database_id: Option<&str>,
    view_id: Option<&str>,
    update: NoteDataSourceTableViewUpdate,
) -> Result<NoteDataSourceTableViewDto, String> {
    data_source_views::validate_view_scope(data_source_id, database_id, view_id)?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin notes data source table view update: {e}"))?;
    crate::notes::project_history::mark_data_source_dirty_tx(
        &mut tx,
        data_source_id,
        "Table view",
        false,
    )
    .await?;
    let (data_source, _database) =
        load_active_data_source_and_database_tx(&mut tx, data_source_id, "table").await?;
    let schema = table_schema(&parse_json(
        &data_source.properties,
        "data source properties",
    )?)?;
    let property_ids: HashSet<String> = schema.iter().map(|property| property.id.clone()).collect();
    let filter = canonical_filter(&update.filter, &property_ids, "table")?;
    let sorts = canonical_sorts(&update.sorts, &property_ids, "table")?;
    let configuration = canonical_table_configuration(&update.configuration, &property_ids)?;
    let view = ensure_table_view_row_tx(&mut tx, &data_source, database_id, view_id).await?;
    sqlx::query(
        "UPDATE notes_database_views
         SET filter = ?,
             sorts = ?,
             configuration = ?,
             last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?",
    )
    .bind(filter.map(|value| value.to_string()))
    .bind(sorts.to_string())
    .bind(configuration.to_string())
    .bind(&view.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("update notes data source table view: {e}"))?;
    let dto = load_table_view_tx(
        &mut tx,
        data_source_id,
        database_id,
        Some(&view.id),
        &NoteDataSourceViewWindowRequest::default(),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit notes data source table view update: {e}"))?;
    Ok(dto)
}

pub async fn update_data_source_row_property(
    pool: &SqlitePool,
    data_source_id: &str,
    page_id: &str,
    update: NoteDataSourceRowPropertyUpdate,
) -> Result<NotePageDto, String> {
    require_uuid(data_source_id, "data_source_id")?;
    require_uuid(page_id, "page_id")?;
    crate::notes::project_history::ensure_data_source_baseline_for_mutation(pool, data_source_id)
        .await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin notes data source row property update: {e}"))?;
    let (data_source, database) =
        load_active_data_source_and_database_tx(&mut tx, data_source_id, "table").await?;
    let schema = table_schema(&parse_json(
        &data_source.properties,
        "data source properties",
    )?)?;
    let property = schema
        .iter()
        .find(|property| property.id == update.property_id.trim())
        .ok_or_else(|| "row property update references an unknown property".to_string())?;
    let row = load_active_row_page_tx(&mut tx, data_source_id, page_id).await?;
    history::record_page_snapshot_tx(&mut tx, page_id, "update_database_row_property").await?;
    let current_properties = parse_json(&row.properties, "row page properties")?;
    let (mut title, mut properties) =
        normalized_row_properties(&schema, &current_properties, &row.title)?;
    let next_value = property_value_from_edit(property, &update.value)?;
    if property.property_type == "title" {
        title = title_from_property_value(&next_value).unwrap_or_default();
    }
    properties[property.key.as_str()] = next_value;
    let relation_value = if property.property_type == "relation" {
        Some(
            properties
                .get(&property.key)
                .cloned()
                .ok_or_else(|| "relation property value was not stored".to_string())?,
        )
    } else {
        None
    };
    sqlx::query(
        "UPDATE notes_pages
         SET title = ?,
             properties = ?,
             last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND parent_type = 'data_source_id' AND parent_data_source_id = ?",
    )
    .bind(&title)
    .bind(properties.to_string())
    .bind(page_id.trim())
    .bind(data_source_id.trim())
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("update notes data source row property: {e}"))?;
    if let Some(relation_value) = relation_value {
        data_source_relations::replace_relation_property_links_tx(
            &mut tx,
            data_source_id.trim(),
            page_id.trim(),
            &property.schema,
            &relation_value,
            true,
        )
        .await?;
    }
    data_source_rollups::invalidate_rollup_cache_for_data_source_tx(&mut tx, data_source_id.trim())
        .await?;
    touch_data_source_and_database_tx(&mut tx, data_source_id, &database.id).await?;
    let updated = load_active_row_page_tx(&mut tx, data_source_id, page_id).await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit notes data source row property update: {e}"))?;
    NotePageDto::new(updated)
}

async fn load_table_view_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
    database_id: Option<&str>,
    view_id: Option<&str>,
    window_request: &NoteDataSourceViewWindowRequest,
) -> Result<NoteDataSourceTableViewDto, String> {
    let (data_source, database) =
        load_active_data_source_and_database_tx(tx, data_source_id, "table").await?;
    let view = ensure_table_view_row_tx(tx, &data_source, database_id, view_id).await?;
    let schema_properties = parse_json(&data_source.properties, "data source properties")?;
    let schema = table_schema(&schema_properties)?;
    let filters = stored_filters(view.filter.as_deref(), "database view filter", "table")?;
    let sorts = stored_sorts(&view.sorts, "database view sorts", "table")?;
    let mut window = data_source_window::load_row_window_tx(
        tx,
        data_source_id,
        data_source_window::RowWindowQuery {
            schema: &schema,
            filters: &filters,
            sorts: &sorts,
            request: window_request,
            date_property: None,
            group_property: None,
        },
    )
    .await?;
    window.rows = window
        .rows
        .into_iter()
        .map(|row| normalized_row_for_schema(row, &schema))
        .collect::<Result<Vec<_>, _>>()?;
    data_source_relations::hydrate_relation_titles_tx(tx, &mut window.rows).await?;
    data_source_rollups::hydrate_rollups_tx(
        tx,
        data_source_id,
        &schema_properties,
        &mut window.rows,
    )
    .await?;
    data_source_formulas::hydrate_formulas(&schema_properties, &mut window.rows)?;
    data_source_buttons::hydrate_buttons(&schema_properties, &mut window.rows)?;
    NoteDataSourceTableViewDto::new(data_source, database, view, window)
}

pub(super) async fn ensure_table_view_row_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source: &NoteDataSourceRow,
    database_id: Option<&str>,
    view_id: Option<&str>,
) -> Result<NoteDatabaseViewRow, String> {
    if let Some(view) = data_source_views::load_scoped_view_row_tx(
        tx,
        &data_source.id,
        "table",
        database_id,
        view_id,
    )
    .await?
    {
        return Ok(view);
    }
    let database_id = data_source_views::scoped_database_id(data_source, database_id);
    let id = data_source_views::generated_uuid_tx(
        tx,
        "generate database view id",
        "generated_database_view_id",
    )
    .await?;
    let sort_order = data_source_views::next_view_sort_order_tx(tx, database_id).await?;
    sqlx::query(
        "INSERT INTO notes_database_views (
            id,
            database_id,
            data_source_id,
            name,
            type,
            sorts,
            configuration,
            sort_order
         )
         VALUES (?, ?, ?, 'Table', 'table', '[]', ?, ?)",
    )
    .bind(&id)
    .bind(database_id)
    .bind(&data_source.id)
    .bind(default_table_configuration(&parse_json(
        &data_source.properties,
        "data source properties",
    )?)?)
    .bind(sort_order)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("insert notes table view: {e}"))?;
    data_source_views::load_scoped_view_row_tx(
        tx,
        &data_source.id,
        "table",
        Some(database_id),
        Some(&id),
    )
    .await?
    .ok_or_else(|| "inserted table view was not found".to_string())
}

pub(super) async fn load_active_row_pages_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
) -> Result<Vec<NotePageRow>, String> {
    sqlx::query_as::<_, NotePageRow>(
        "SELECT page.*
         FROM notes_pages AS page
         WHERE page.parent_type = 'data_source_id'
           AND page.parent_data_source_id = ?
           AND page.in_trash = 0
           AND page.archived = 0
         ORDER BY page.last_edited_time DESC, page.title COLLATE NOCASE ASC, page.id ASC",
    )
    .bind(data_source_id.trim())
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| format!("load notes data source table rows: {e}"))
}

async fn load_active_row_page_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
    page_id: &str,
) -> Result<NotePageRow, String> {
    sqlx::query_as::<_, NotePageRow>(
        "SELECT page.*
         FROM notes_pages AS page
         WHERE page.id = ?
           AND page.parent_type = 'data_source_id'
           AND page.parent_data_source_id = ?
           AND page.in_trash = 0
           AND page.archived = 0",
    )
    .bind(page_id.trim())
    .bind(data_source_id.trim())
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load notes data source table row: {e}"))?
    .ok_or_else(|| "row page not found".to_string())
}

async fn touch_data_source_and_database_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
    database_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE notes_data_sources
         SET last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?",
    )
    .bind(data_source_id.trim())
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("touch notes table data source: {e}"))?;
    sqlx::query(
        "UPDATE notes_databases
         SET last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?",
    )
    .bind(database_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("touch notes table database: {e}"))?;
    Ok(())
}

#[derive(Clone)]
pub(super) struct TableProperty {
    pub(super) key: String,
    pub(super) id: String,
    pub(super) name: String,
    pub(super) property_type: String,
    pub(super) schema: Value,
}

pub(super) fn table_schema(properties: &Value) -> Result<Vec<TableProperty>, String> {
    let object = properties
        .as_object()
        .ok_or_else(|| "data source properties must be an object".to_string())?;
    let mut schema = Vec::with_capacity(object.len());
    for (key, value) in object {
        let property = value
            .as_object()
            .ok_or_else(|| "data source property must be an object".to_string())?;
        schema.push(TableProperty {
            key: key.clone(),
            id: read_string_field(property, "id", "property.id")?.to_string(),
            name: read_string_field(property, "name", "property.name")?.to_string(),
            property_type: read_string_field(property, "type", "property.type")?.to_string(),
            schema: value.clone(),
        });
    }
    Ok(schema)
}

fn canonical_table_configuration(
    update: &NoteDataSourceTableConfigurationUpdate,
    property_ids: &HashSet<String>,
) -> Result<Value, String> {
    let property_order = canonical_property_order(&update.property_order, property_ids)?;
    let hidden_property_ids =
        canonical_hidden_property_ids(&update.hidden_property_ids, property_ids)?;
    let column_widths = canonical_column_widths(&update.column_widths, property_ids)?;
    let row_open_mode = update.row_open_mode.trim();
    if !ROW_OPEN_MODES.contains(&row_open_mode) {
        return Err("row_open_mode is not supported".to_string());
    }
    let value = json!({
        "type": "table",
        "table": {
            "property_order": property_order,
            "hidden_property_ids": hidden_property_ids,
            "column_widths": column_widths,
            "row_open_mode": row_open_mode
        }
    });
    if value.to_string().len() > MAX_TABLE_CONFIGURATION_BYTES {
        return Err("table configuration must not exceed 50KB".to_string());
    }
    Ok(value)
}

fn default_table_configuration(properties: &Value) -> Result<Value, String> {
    let schema = table_schema(properties)?;
    let property_ids: HashSet<String> = schema.iter().map(|property| property.id.clone()).collect();
    let property_order = canonical_property_order(&[], &property_ids)?;
    Ok(json!({
        "type": "table",
        "table": {
            "property_order": property_order,
            "hidden_property_ids": [],
            "column_widths": {},
            "row_open_mode": "full_page"
        }
    }))
}

fn canonical_property_order(
    requested: &[String],
    property_ids: &HashSet<String>,
) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut order = Vec::new();
    for id in requested {
        let id = id.trim();
        if id.is_empty() {
            continue;
        }
        if !property_ids.contains(id) {
            return Err("table property order references an unknown property".to_string());
        }
        if seen.insert(id.to_string()) {
            order.push(id.to_string());
        }
    }
    if !seen.contains("title") && property_ids.contains("title") {
        order.insert(0, "title".to_string());
        seen.insert("title".to_string());
    }
    let mut remaining: Vec<String> = property_ids
        .iter()
        .filter(|id| !seen.contains(*id))
        .cloned()
        .collect();
    remaining.sort();
    order.extend(remaining);
    Ok(order)
}

fn canonical_hidden_property_ids(
    requested: &[String],
    property_ids: &HashSet<String>,
) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut hidden = Vec::new();
    for id in requested {
        let id = id.trim();
        if id.is_empty() {
            continue;
        }
        if id == "title" {
            return Err("title property cannot be hidden".to_string());
        }
        if !property_ids.contains(id) {
            return Err("hidden table property references an unknown property".to_string());
        }
        if seen.insert(id.to_string()) {
            hidden.push(id.to_string());
        }
    }
    Ok(hidden)
}

fn canonical_column_widths(value: &Value, property_ids: &HashSet<String>) -> Result<Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "column_widths must be an object".to_string())?;
    let mut widths = Map::new();
    for (property_id, width) in object {
        if !property_ids.contains(property_id) {
            return Err("column_widths contains an unknown property".to_string());
        }
        let width = width
            .as_i64()
            .ok_or_else(|| "column width must be an integer".to_string())?;
        if !(MIN_COLUMN_WIDTH..=MAX_COLUMN_WIDTH).contains(&width) {
            return Err("column width is out of range".to_string());
        }
        widths.insert(property_id.clone(), Value::Number(width.into()));
    }
    Ok(Value::Object(widths))
}

pub(super) fn normalized_row_for_schema(
    mut row: NotePageRow,
    schema: &[TableProperty],
) -> Result<NotePageRow, String> {
    let current = parse_json(&row.properties, "row page properties")?;
    let (title, properties) = normalized_row_properties(schema, &current, &row.title)?;
    row.title = title;
    row.properties = properties.to_string();
    Ok(row)
}

fn normalized_row_properties(
    schema: &[TableProperty],
    current: &Value,
    fallback_title: &str,
) -> Result<(String, Value), String> {
    let current_object = current
        .as_object()
        .ok_or_else(|| "row page properties must be an object".to_string())?;
    let mut title = fallback_title.to_string();
    let mut next = Map::new();
    for property in schema {
        if matches!(
            property.property_type.as_str(),
            "rollup" | "formula" | "button"
        ) {
            continue;
        }
        let value = existing_property_value(current_object, property)
            .and_then(|value| canonical_stored_property_value(property, value).ok())
            .unwrap_or_else(|| default_property_value(property, fallback_title));
        if property.property_type == "title" {
            title = title_from_property_value(&value).unwrap_or_else(|| fallback_title.to_string());
        }
        next.insert(property.key.clone(), value);
    }
    Ok((title, Value::Object(next)))
}

fn existing_property_value<'a>(
    current: &'a Map<String, Value>,
    property: &TableProperty,
) -> Option<&'a Value> {
    current
        .get(&property.key)
        .filter(|value| property_value_matches_schema(property, value))
        .or_else(|| {
            current
                .values()
                .find(|value| property_value_matches_schema(property, value))
        })
}

fn property_value_matches_schema(property: &TableProperty, value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("id").and_then(Value::as_str) == Some(property.id.as_str())
        && object.get("type").and_then(Value::as_str) == Some(property.property_type.as_str())
}

fn canonical_stored_property_value(
    property: &TableProperty,
    value: &Value,
) -> Result<Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "row property value must be an object".to_string())?;
    if object.get("id").and_then(Value::as_str) != Some(property.id.as_str()) {
        return Err("row property id does not match schema".to_string());
    }
    if object.get("type").and_then(Value::as_str) != Some(property.property_type.as_str()) {
        return Err("row property type does not match schema".to_string());
    }
    let payload = object
        .get(&property.property_type)
        .ok_or_else(|| "row property is missing its typed value".to_string())?;
    let payload = canonical_property_payload(&property.property_type, payload)?;
    if property.property_type == "relation" {
        return Ok(data_source_relations::relation_property_value(
            &property.id,
            payload,
        ));
    }
    Ok(json!({
        "id": property.id,
        "type": property.property_type,
        property.property_type.clone(): payload
    }))
}

fn default_property_value(property: &TableProperty, title: &str) -> Value {
    let payload = match property.property_type.as_str() {
        "title" => Value::Array(vec![writes::rich_text(title)]),
        "rich_text" | "multi_select" | "files" | "people" | "relation" => Value::Array(Vec::new()),
        "number" | "select" | "status" | "date" | "url" | "email" | "phone_number"
        | "created_time" | "created_by" | "last_edited_time" | "last_edited_by" | "place" => {
            Value::Null
        }
        "checkbox" => Value::Bool(false),
        "unique_id" => json!({
            "number": null,
            "prefix": property
                .schema
                .get("unique_id")
                .and_then(|config| config.get("prefix"))
                .cloned()
                .unwrap_or(Value::Null)
        }),
        _ => Value::Null,
    };
    if property.property_type == "relation" {
        return data_source_relations::relation_property_value(&property.id, payload);
    }
    json!({
        "id": property.id,
        "type": property.property_type,
        property.property_type.clone(): payload
    })
}

fn property_value_from_edit(property: &TableProperty, value: &Value) -> Result<Value, String> {
    let payload = match property.property_type.as_str() {
        "title" | "rich_text" => {
            let text = scalar_text(value, &property.name, MAX_PROPERTY_TEXT_CHARS)?;
            Value::Array(vec![writes::rich_text(&text)])
        }
        "number" => edit_number_payload(value)?,
        "checkbox" => Value::Bool(
            value
                .as_bool()
                .ok_or_else(|| "checkbox cell value must be boolean".to_string())?,
        ),
        "select" | "status" => edit_single_option_payload(property, value)?,
        "multi_select" => edit_multi_option_payload(property, value)?,
        "relation" => data_source_relations::canonical_relation_payload(value)?,
        "date" => edit_date_payload(value)?,
        "url" | "email" | "phone_number" => edit_nullable_text_payload(value, &property.name)?,
        "place" => edit_place_payload(value)?,
        "files" | "people" | "created_time" | "created_by" | "last_edited_time"
        | "last_edited_by" | "unique_id" | "rollup" | "formula" | "button" => {
            return Err("this property is read-only in the table view".to_string());
        }
        other => return Err(format!("unsupported row property type: {other}")),
    };
    if property.property_type == "relation" {
        return Ok(data_source_relations::relation_property_value(
            &property.id,
            payload,
        ));
    }
    Ok(json!({
        "id": property.id,
        "type": property.property_type,
        property.property_type.clone(): payload
    }))
}

fn canonical_property_payload(property_type: &str, value: &Value) -> Result<Value, String> {
    match property_type {
        "title" | "rich_text" => {
            if value.is_array() {
                Ok(value.clone())
            } else {
                Err("rich text property must be an array".to_string())
            }
        }
        "number" => {
            if value.is_null() || value.is_number() {
                Ok(value.clone())
            } else {
                Err("number property must be a number or null".to_string())
            }
        }
        "select" | "status" | "date" | "created_by" | "last_edited_by" | "unique_id" | "place" => {
            if value.is_null() || value.is_object() {
                Ok(value.clone())
            } else {
                Err(format!(
                    "{property_type} property must be an object or null"
                ))
            }
        }
        "multi_select" | "files" | "people" => {
            if value.is_array() {
                Ok(value.clone())
            } else {
                Err(format!("{property_type} property must be an array"))
            }
        }
        "relation" => data_source_relations::canonical_relation_payload(value),
        "checkbox" => value
            .as_bool()
            .map(Value::Bool)
            .ok_or_else(|| "checkbox property must be boolean".to_string()),
        "url" | "email" | "phone_number" | "created_time" | "last_edited_time" => {
            if value.is_null() {
                return Ok(Value::Null);
            }
            Ok(Value::String(validate_text(
                value
                    .as_str()
                    .ok_or_else(|| format!("{property_type} property must be text or null"))?,
                property_type,
                MAX_PROPERTY_TEXT_CHARS,
            )?))
        }
        other => Err(format!("unsupported row property type: {other}")),
    }
}

fn edit_number_payload(value: &Value) -> Result<Value, String> {
    if value.is_null() || value.is_number() {
        return Ok(value.clone());
    }
    let text = value
        .as_str()
        .ok_or_else(|| "number cell value must be a number or empty text".to_string())?
        .trim();
    if text.is_empty() {
        return Ok(Value::Null);
    }
    let number = text
        .parse::<f64>()
        .map_err(|_| "number cell value must be a valid number".to_string())?;
    if !number.is_finite() {
        return Err("number cell value must be finite".to_string());
    }
    Ok(json!(number))
}

fn edit_nullable_text_payload(value: &Value, label: &str) -> Result<Value, String> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    let text = scalar_text(value, label, MAX_PROPERTY_TEXT_CHARS)?;
    if text.trim().is_empty() {
        Ok(Value::Null)
    } else {
        Ok(Value::String(text))
    }
}

fn edit_date_payload(value: &Value) -> Result<Value, String> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    if value.is_object() {
        return canonical_property_payload("date", value);
    }
    let text = scalar_text(value, "date", 64)?;
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    if !looks_like_date_or_datetime(&text) {
        return Err("date cell value must be an ISO date or datetime".to_string());
    }
    Ok(json!({
        "start": text,
        "end": null,
        "time_zone": null
    }))
}

fn edit_place_payload(value: &Value) -> Result<Value, String> {
    if value.is_null() || value.is_object() {
        return canonical_property_payload("place", value);
    }
    let text = scalar_text(value, "place", MAX_PROPERTY_TEXT_CHARS)?;
    if text.trim().is_empty() {
        Ok(Value::Null)
    } else {
        Ok(json!({ "name": text }))
    }
}

fn edit_single_option_payload(property: &TableProperty, value: &Value) -> Result<Value, String> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    if let Some(text) = value.as_str() {
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        return option_from_schema(property, text).map(Value::Object);
    }
    if let Some(object) = value.as_object() {
        let candidate = object
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| object.get("name").and_then(Value::as_str))
            .ok_or_else(|| "option cell value must include an id or name".to_string())?;
        return option_from_schema(property, candidate).map(Value::Object);
    }
    Err("option cell value must be text, object, or null".to_string())
}

fn edit_multi_option_payload(property: &TableProperty, value: &Value) -> Result<Value, String> {
    let items: Vec<String> = if let Some(text) = value.as_str() {
        text.split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect()
    } else if let Some(values) = value.as_array() {
        values
            .iter()
            .filter_map(|item| {
                item.as_str()
                    .map(str::to_string)
                    .or_else(|| item.get("id").and_then(Value::as_str).map(str::to_string))
                    .or_else(|| item.get("name").and_then(Value::as_str).map(str::to_string))
            })
            .collect()
    } else {
        return Err("multi-select cell value must be text or an array".to_string());
    };
    let mut seen = HashSet::new();
    let mut options = Vec::new();
    for item in items {
        let option = option_from_schema(property, &item)?;
        let id = option
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if seen.insert(id) {
            options.push(Value::Object(option));
        }
    }
    Ok(Value::Array(options))
}

fn option_from_schema(
    property: &TableProperty,
    candidate: &str,
) -> Result<Map<String, Value>, String> {
    let candidate_key = candidate.trim().to_lowercase();
    let options = property
        .schema
        .get(&property.property_type)
        .and_then(|config| config.get("options"))
        .and_then(Value::as_array)
        .ok_or_else(|| "property has no options".to_string())?;
    for option in options {
        let Some(object) = option.as_object() else {
            continue;
        };
        let id = object.get("id").and_then(Value::as_str).unwrap_or_default();
        let name = object
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if id.to_lowercase() == candidate_key || name.to_lowercase() == candidate_key {
            let mut result = Map::new();
            result.insert("id".to_string(), Value::String(id.to_string()));
            result.insert("name".to_string(), Value::String(name.to_string()));
            result.insert(
                "color".to_string(),
                Value::String(
                    object
                        .get("color")
                        .and_then(Value::as_str)
                        .unwrap_or("default")
                        .to_string(),
                ),
            );
            return Ok(result);
        }
    }
    Err("option value must match an existing option".to_string())
}

pub(super) fn row_matches_filters(
    row: &NotePageRow,
    schema: &[TableProperty],
    filters: &[NoteDataSourceTableFilter],
) -> bool {
    filters.iter().all(|filter| {
        let Some(property) = schema
            .iter()
            .find(|property| property.id == filter.property_id)
        else {
            return true;
        };
        let text = row_property_plain_text(row, property);
        match filter.condition.as_str() {
            "contains" => filter
                .value
                .as_ref()
                .and_then(Value::as_str)
                .map(|value| text.to_lowercase().contains(&value.to_lowercase()))
                .unwrap_or(true),
            "equals" => filter
                .value
                .as_ref()
                .map(|value| scalar_filter_text(value).to_lowercase() == text.to_lowercase())
                .unwrap_or_else(|| text.is_empty()),
            "is_empty" => text.trim().is_empty(),
            "is_not_empty" => !text.trim().is_empty(),
            "checked" => row_property_checked(row, property) == Some(true),
            "unchecked" => row_property_checked(row, property) == Some(false),
            _ => true,
        }
    })
}

pub(super) fn sort_rows(
    rows: &mut [NotePageRow],
    schema: &[TableProperty],
    sorts: &[NoteDataSourceTableSort],
) {
    rows.sort_by(|left, right| {
        for sort in sorts {
            let Some(property) = schema
                .iter()
                .find(|property| property.id == sort.property_id)
            else {
                continue;
            };
            let ordering = compare_row_property(left, right, property);
            if ordering != Ordering::Equal {
                return if sort.direction == "descending" {
                    ordering.reverse()
                } else {
                    ordering
                };
            }
        }
        left.title
            .to_lowercase()
            .cmp(&right.title.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
}

fn compare_row_property(
    left: &NotePageRow,
    right: &NotePageRow,
    property: &TableProperty,
) -> Ordering {
    match property.property_type.as_str() {
        "number" => compare_optional_f64(
            row_property_number(left, property),
            row_property_number(right, property),
        ),
        "rollup" | "formula" => match (
            row_property_number(left, property),
            row_property_number(right, property),
        ) {
            (Some(left_number), Some(right_number)) => {
                compare_optional_f64(Some(left_number), Some(right_number))
            }
            _ => row_property_plain_text(left, property)
                .to_lowercase()
                .cmp(&row_property_plain_text(right, property).to_lowercase()),
        },
        "checkbox" => compare_optional_bool(
            row_property_checked(left, property),
            row_property_checked(right, property),
        ),
        _ => row_property_plain_text(left, property)
            .to_lowercase()
            .cmp(&row_property_plain_text(right, property).to_lowercase()),
    }
}

fn compare_optional_f64(left: Option<f64>, right: Option<f64>) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => left.partial_cmp(&right).unwrap_or(Ordering::Equal),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

fn compare_optional_bool(left: Option<bool>, right: Option<bool>) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => left.cmp(&right),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

fn row_property_value(row: &NotePageRow, property: &TableProperty) -> Option<Value> {
    let properties = parse_json(&row.properties, "row page properties").ok()?;
    properties.get(&property.key).cloned()
}

fn row_property_payload(row: &NotePageRow, property: &TableProperty) -> Option<Value> {
    row_property_value(row, property)?
        .get(&property.property_type)
        .cloned()
}

pub(super) fn row_property_plain_text(row: &NotePageRow, property: &TableProperty) -> String {
    match property.property_type.as_str() {
        "title" | "rich_text" => row_property_payload(row, property)
            .and_then(|payload| payload.as_array().cloned())
            .map(|items| rich_text_plain_text(&items))
            .unwrap_or_default(),
        "number" => row_property_number(row, property)
            .map(|number| number.to_string())
            .unwrap_or_default(),
        "checkbox" => row_property_checked(row, property)
            .map(|checked| checked.to_string())
            .unwrap_or_default(),
        "select" | "status" => row_property_payload(row, property)
            .and_then(|payload| {
                payload
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_default(),
        "multi_select" => row_property_payload(row, property)
            .and_then(|payload| payload.as_array().cloned())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.get("name").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default(),
        "relation" => row_property_payload(row, property)
            .and_then(|payload| payload.as_array().cloned())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        item.get("title")
                            .and_then(Value::as_str)
                            .or_else(|| item.get("id").and_then(Value::as_str))
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default(),
        "rollup" => row_property_payload(row, property)
            .map(|payload| data_source_rollups::rollup_plain_text(&payload))
            .unwrap_or_default(),
        "formula" => row_property_payload(row, property)
            .map(|payload| data_source_formulas::formula_plain_text(&payload))
            .unwrap_or_default(),
        "button" => row_property_payload(row, property)
            .map(|payload| data_source_buttons::button_plain_text(&payload))
            .unwrap_or_default(),
        "date" => row_property_payload(row, property)
            .and_then(|payload| {
                payload
                    .get("start")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_default(),
        "url" | "email" | "phone_number" => row_property_payload(row, property)
            .and_then(|payload| payload.as_str().map(str::to_string))
            .unwrap_or_default(),
        "created_time" => row.created_time.clone(),
        "last_edited_time" => row.last_edited_time.clone(),
        "unique_id" => row_property_payload(row, property)
            .map(|payload| {
                let prefix = payload.get("prefix").and_then(Value::as_str).unwrap_or("");
                let number = payload
                    .get("number")
                    .and_then(Value::as_i64)
                    .map(|value| value.to_string())
                    .unwrap_or_default();
                format!("{prefix}{number}")
            })
            .unwrap_or_default(),
        "place" => row_property_payload(row, property)
            .and_then(|payload| {
                payload
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_default(),
        _ => String::new(),
    }
}

pub(super) fn row_property_number(row: &NotePageRow, property: &TableProperty) -> Option<f64> {
    let payload = row_property_payload(row, property)?;
    if property.property_type == "rollup" {
        return data_source_rollups::rollup_number(&payload);
    }
    if property.property_type == "formula" {
        return data_source_formulas::formula_number(&payload);
    }
    payload.as_f64()
}

pub(super) fn row_property_checked(row: &NotePageRow, property: &TableProperty) -> Option<bool> {
    let payload = row_property_payload(row, property)?;
    if property.property_type == "formula" {
        return data_source_formulas::formula_checked(&payload);
    }
    payload.as_bool()
}

fn scalar_text(value: &Value, label: &str, max_chars: usize) -> Result<String, String> {
    let text = match value {
        Value::String(text) => text,
        _ => return Err(format!("{label} cell value must be text")),
    };
    validate_text(text, label, max_chars)
}

fn scalar_filter_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        _ => String::new(),
    }
}

fn looks_like_date_or_datetime(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .take(10)
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn validate_text(value: &str, label: &str, max_chars: usize) -> Result<String, String> {
    if value.chars().any(char::is_control) {
        return Err(format!("{label} must not contain control characters"));
    }
    if value.chars().count() > max_chars {
        return Err(format!("{label} is too long"));
    }
    Ok(value.to_string())
}
