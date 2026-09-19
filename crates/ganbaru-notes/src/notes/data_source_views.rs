use super::models::{
    NoteDataSourceRow, NoteDataSourceTableFilter, NoteDataSourceTableSort, NoteDatabaseRow,
    NoteDatabaseViewRow, NotePageRow,
};
use super::validation::require_uuid;
use super::{data_source_relations, writes};
use serde_json::{Map, Value, json};
use sqlx::{Sqlite, Transaction};
use std::collections::HashSet;

const MAX_FILTERS: usize = 10;
const MAX_SORTS: usize = 5;
const MAX_FILTER_TEXT_CHARS: usize = 200;
const FILTER_CONDITIONS: &[&str] = &[
    "contains",
    "equals",
    "is_empty",
    "is_not_empty",
    "checked",
    "unchecked",
];

#[derive(Clone)]
pub(super) struct ViewProperty {
    pub(super) key: String,
    pub(super) id: String,
    pub(super) property_type: String,
    pub(super) schema: Value,
}

pub(super) fn validate_view_scope(
    data_source_id: &str,
    database_id: Option<&str>,
    view_id: Option<&str>,
) -> Result<(), String> {
    require_uuid(data_source_id, "data_source_id")?;
    if let Some(database_id) = database_id {
        require_uuid(database_id, "database_id")?;
    }
    if let Some(view_id) = view_id {
        require_uuid(view_id, "view_id")?;
    }
    Ok(())
}

pub(super) fn scoped_database_id<'a>(
    data_source: &'a NoteDataSourceRow,
    database_id: Option<&'a str>,
) -> &'a str {
    database_id.unwrap_or(&data_source.database_id)
}

pub(super) async fn next_view_sort_order_tx(
    tx: &mut Transaction<'_, Sqlite>,
    database_id: &str,
) -> Result<f64, String> {
    sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order) + 1, 1)
         FROM notes_database_views
         WHERE database_id = ?",
    )
    .bind(database_id.trim())
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("prepare notes database view order: {e}"))
}

pub(super) async fn generated_uuid_tx(
    tx: &mut Transaction<'_, Sqlite>,
    error_context: &str,
    validation_field: &str,
) -> Result<String, String> {
    let id: String = sqlx::query_scalar(
        "SELECT lower(hex(randomblob(4))) || '-' ||
                lower(hex(randomblob(2))) || '-' ||
                lower(hex(randomblob(2))) || '-' ||
                lower(hex(randomblob(2))) || '-' ||
                lower(hex(randomblob(6)))",
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("{error_context}: {e}"))?;
    require_uuid(&id, validation_field)?;
    Ok(id)
}

pub(super) async fn load_active_data_source_and_database_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
    view_kind: &str,
) -> Result<(NoteDataSourceRow, NoteDatabaseRow), String> {
    let data_source = sqlx::query_as::<_, NoteDataSourceRow>(
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
    .map_err(|e| format!("load notes data source for {view_kind}: {e}"))?
    .ok_or_else(|| "data source not found".to_string())?;
    let database = sqlx::query_as::<_, NoteDatabaseRow>(
        "SELECT * FROM notes_databases WHERE id = ? AND in_trash = 0",
    )
    .bind(&data_source.database_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("load notes database for {view_kind}: {e}"))?;
    Ok((data_source, database))
}

pub(super) fn view_schema(properties: &Value) -> Result<Vec<ViewProperty>, String> {
    let object = properties
        .as_object()
        .ok_or_else(|| "data source properties must be an object".to_string())?;
    let mut schema = Vec::with_capacity(object.len());
    for (key, value) in object {
        let property = value
            .as_object()
            .ok_or_else(|| "data source property must be an object".to_string())?;
        schema.push(ViewProperty {
            key: key.clone(),
            id: read_string_field(property, "id", "property.id")?.to_string(),
            property_type: read_string_field(property, "type", "property.type")?.to_string(),
            schema: value.clone(),
        });
    }
    Ok(schema)
}

pub(super) fn canonical_filter(
    filters: &[NoteDataSourceTableFilter],
    property_ids: &HashSet<String>,
    view_kind: &str,
) -> Result<Option<Value>, String> {
    if filters.len() > MAX_FILTERS {
        return Err(format!("{view_kind} filters are limited to 10"));
    }
    let mut canonical = Vec::new();
    for filter in filters {
        let property_id = filter.property_id.trim();
        if property_id.is_empty() {
            continue;
        }
        if !property_ids.contains(property_id) {
            return Err(format!("{view_kind} filter references an unknown property"));
        }
        let condition = filter.condition.trim();
        if !FILTER_CONDITIONS.contains(&condition) {
            return Err(format!("{view_kind} filter condition is not supported"));
        }
        let value = canonical_filter_value(condition, filter.value.as_ref(), view_kind)?;
        canonical.push(json!({
            "property_id": property_id,
            "condition": condition,
            "value": value
        }));
    }
    if canonical.is_empty() {
        Ok(None)
    } else {
        Ok(Some(json!({
            "type": "and",
            "filters": canonical
        })))
    }
}

fn canonical_filter_value(
    condition: &str,
    value: Option<&Value>,
    view_kind: &str,
) -> Result<Value, String> {
    if matches!(
        condition,
        "is_empty" | "is_not_empty" | "checked" | "unchecked"
    ) {
        return Ok(Value::Null);
    }
    let Some(value) = value else {
        return Ok(Value::Null);
    };
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => Ok(value.clone()),
        Value::String(text) => Ok(Value::String(validate_text(
            text.trim(),
            &format!("{view_kind} filter value"),
            MAX_FILTER_TEXT_CHARS,
        )?)),
        _ => Err(format!("{view_kind} filter value must be a scalar")),
    }
}

pub(super) fn canonical_sorts(
    sorts: &[NoteDataSourceTableSort],
    property_ids: &HashSet<String>,
    view_kind: &str,
) -> Result<Value, String> {
    if sorts.len() > MAX_SORTS {
        return Err(format!("{view_kind} sorts are limited to 5"));
    }
    let mut seen = HashSet::new();
    let mut canonical = Vec::new();
    for sort in sorts {
        let property_id = sort.property_id.trim();
        if property_id.is_empty() {
            continue;
        }
        if !property_ids.contains(property_id) {
            return Err(format!("{view_kind} sort references an unknown property"));
        }
        if !seen.insert(property_id.to_string()) {
            return Err(format!("{view_kind} sorts must not repeat properties"));
        }
        let direction = sort.direction.trim();
        if direction != "ascending" && direction != "descending" {
            return Err(format!("{view_kind} sort direction is not supported"));
        }
        canonical.push(json!({
            "property_id": property_id,
            "direction": direction
        }));
    }
    Ok(Value::Array(canonical))
}

pub(super) fn stored_filters(
    filter: Option<&str>,
    storage_label: &str,
    view_kind: &str,
) -> Result<Vec<NoteDataSourceTableFilter>, String> {
    let Some(filter) = filter else {
        return Ok(Vec::new());
    };
    let value = parse_json(filter, storage_label)?;
    let filters = value
        .get("filters")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    serde_json::from_value(filters).map_err(|e| format!("parse {view_kind} filters: {e}"))
}

pub(super) fn stored_sorts(
    sorts: &str,
    storage_label: &str,
    view_kind: &str,
) -> Result<Vec<NoteDataSourceTableSort>, String> {
    let value = parse_json(sorts, storage_label)?;
    serde_json::from_value(value).map_err(|e| format!("parse {view_kind} sorts: {e}"))
}

pub(super) fn normalized_row_for_schema(
    mut row: NotePageRow,
    schema: &[ViewProperty],
) -> Result<NotePageRow, String> {
    let current = parse_json(&row.properties, "row page properties")?;
    let (title, properties) = normalized_row_properties(schema, &current, &row.title)?;
    row.title = title;
    row.properties = properties.to_string();
    Ok(row)
}

fn normalized_row_properties(
    schema: &[ViewProperty],
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
    property: &ViewProperty,
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

fn property_value_matches_schema(property: &ViewProperty, value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.get("id").and_then(Value::as_str) == Some(property.id.as_str())
        && object.get("type").and_then(Value::as_str) == Some(property.property_type.as_str())
}

fn canonical_stored_property_value(
    property: &ViewProperty,
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

fn default_property_value(property: &ViewProperty, title: &str) -> Value {
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

fn canonical_property_payload(property_type: &str, value: &Value) -> Result<Value, String> {
    match property_type {
        "title" | "rich_text" | "multi_select" | "files" | "people" => {
            if value.is_array() {
                Ok(value.clone())
            } else {
                Err(format!("{property_type} property must be an array"))
            }
        }
        "relation" => data_source_relations::canonical_relation_payload(value),
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
                MAX_FILTER_TEXT_CHARS,
            )?))
        }
        other => Err(format!("unsupported row property type: {other}")),
    }
}

pub(super) fn rich_text_plain_text(items: &[Value]) -> String {
    let mut text = String::new();
    for item in items {
        if let Some(plain_text) = item.get("plain_text").and_then(Value::as_str) {
            text.push_str(plain_text);
        } else if let Some(content) = item
            .get("text")
            .and_then(|value| value.get("content"))
            .and_then(Value::as_str)
        {
            text.push_str(content);
        }
    }
    text
}

pub(super) fn title_from_property_value(value: &Value) -> Option<String> {
    value
        .get("title")?
        .as_array()
        .map(|items| rich_text_plain_text(items))
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

pub(super) fn parse_json(value: &str, label: &str) -> Result<Value, String> {
    serde_json::from_str(value).map_err(|e| format!("parse {label}: {e}"))
}

pub(super) fn read_string_field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<&'a str, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{label} must be a string"))
}

pub(super) async fn load_scoped_view_row_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
    view_type: &str,
    database_id: Option<&str>,
    view_id: Option<&str>,
) -> Result<Option<NoteDatabaseViewRow>, String> {
    let row = if let Some(view_id) = view_id {
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
             WHERE id = ? AND data_source_id = ? AND type = ?",
        )
        .bind(view_id.trim())
        .bind(data_source_id.trim())
        .bind(view_type)
        .fetch_optional(&mut **tx)
        .await
    } else if let Some(database_id) = database_id {
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
             WHERE database_id = ? AND data_source_id = ? AND type = ?
             ORDER BY sort_order ASC, created_time ASC, id ASC
             LIMIT 1",
        )
        .bind(database_id.trim())
        .bind(data_source_id.trim())
        .bind(view_type)
        .fetch_optional(&mut **tx)
        .await
    } else {
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
             WHERE data_source_id = ? AND type = ?
             ORDER BY sort_order ASC, created_time ASC, id ASC
             LIMIT 1",
        )
        .bind(data_source_id.trim())
        .bind(view_type)
        .fetch_optional(&mut **tx)
        .await
    };
    row.map_err(|e| format!("load notes {view_type} view: {e}"))
}
