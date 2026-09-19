use super::models::{
    NoteDataSourceDto, NoteDataSourceRow, NoteDataSourceSchemaDto, NoteDataSourceSchemaUpdate,
    NoteDatabaseRow, NoteDatabaseViewRow, block_parent_from_database_row,
};
use super::{
    assets, data_source_buttons, data_source_formulas, data_source_relations, data_source_rollups,
    data_source_views,
};
use serde_json::{Map, Value, json};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::{HashMap, HashSet};

const MAX_SCHEMA_BYTES: usize = 50 * 1024;
const MAX_PROPERTIES: usize = 100;
const MAX_PROPERTY_NAME_LEN: usize = 120;
const MAX_PROPERTY_DESCRIPTION_LEN: usize = 2000;
const MAX_OPTIONS: usize = 100;
const MAX_OPTION_NAME_LEN: usize = 120;
const MAX_UNIQUE_ID_PREFIX_LEN: usize = 32;
const TABLE_ROW_OPEN_MODES: &[&str] = &["full_page", "side_panel"];

const SUPPORTED_PROPERTY_TYPES: &[&str] = &[
    "title",
    "rich_text",
    "number",
    "select",
    "multi_select",
    "status",
    "date",
    "checkbox",
    "url",
    "email",
    "phone_number",
    "files",
    "people",
    "created_time",
    "created_by",
    "last_edited_time",
    "last_edited_by",
    "unique_id",
    "place",
    "relation",
    "rollup",
    "formula",
    "button",
];

const EMPTY_CONFIG_TYPES: &[&str] = &[
    "title",
    "rich_text",
    "date",
    "checkbox",
    "url",
    "email",
    "phone_number",
    "files",
    "people",
    "created_time",
    "created_by",
    "last_edited_time",
    "last_edited_by",
    "place",
];

const SELECT_COLORS: &[&str] = &[
    "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
];

const NUMBER_FORMATS: &[&str] = &[
    "number",
    "number_with_commas",
    "percent",
    "dollar",
    "euro",
    "pound",
    "yen",
    "yuan",
    "won",
    "ruble",
    "rupee",
    "franc",
    "real",
    "lira",
    "krona",
    "ringgit",
];

const STATUS_GROUPS: &[&str] = &["To-do", "In progress", "Complete"];

struct PreparedSchemaUpdate {
    properties: Value,
    property_order: Vec<String>,
    hidden_property_ids: Vec<String>,
}

pub async fn list_data_sources(pool: &SqlitePool) -> Result<Vec<NoteDataSourceDto>, String> {
    let rows = sqlx::query_as::<_, NoteDataSourceRow>(
        "SELECT data_source.*
         FROM notes_data_sources AS data_source
         JOIN notes_databases AS database ON database.id = data_source.database_id
         WHERE data_source.in_trash = 0
           AND database.in_trash = 0
         ORDER BY data_source.title COLLATE NOCASE ASC, data_source.id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("list notes data sources: {e}"))?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let database = sqlx::query_as::<_, NoteDatabaseRow>(
            "SELECT * FROM notes_databases WHERE id = ? AND in_trash = 0",
        )
        .bind(&row.database_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("load notes data source database: {e}"))?;
        let database_parent = block_parent_from_database_row(&database)?;
        result.push(NoteDataSourceDto::new(row, database_parent)?);
    }
    Ok(result)
}

pub async fn get_data_source_schema(
    pool: &SqlitePool,
    data_source_id: &str,
    view_id: Option<&str>,
) -> Result<NoteDataSourceSchemaDto, String> {
    data_source_views::validate_view_scope(data_source_id, None, view_id)?;
    crate::notes::project_history::ensure_data_source_baseline_for_mutation(pool, data_source_id)
        .await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin notes data source schema read: {e}"))?;
    let dto = load_data_source_schema_tx(&mut tx, data_source_id, view_id).await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit notes data source schema read: {e}"))?;
    Ok(dto)
}

pub async fn update_data_source_schema(
    pool: &SqlitePool,
    data_source_id: &str,
    view_id: Option<&str>,
    update: NoteDataSourceSchemaUpdate,
) -> Result<NoteDataSourceSchemaDto, String> {
    data_source_views::validate_view_scope(data_source_id, None, view_id)?;
    let prepared = prepare_schema_update(&update)?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin notes data source schema update: {e}"))?;
    crate::notes::project_history::mark_data_source_dirty_tx(
        &mut tx,
        data_source_id,
        "Database schema",
        false,
    )
    .await?;
    let current = load_data_source_row_tx(&mut tx, data_source_id).await?;
    let current_properties = parse_json(&current.properties, "data source properties")?;
    ensure_title_property_preserved(&current_properties, &prepared.properties)?;
    data_source_relations::ensure_relation_schema_targets_tx(
        &mut tx,
        data_source_id.trim(),
        &prepared.properties,
    )
    .await?;
    data_source_rollups::ensure_rollup_schema_targets_tx(
        &mut tx,
        data_source_id.trim(),
        &prepared.properties,
    )
    .await?;
    data_source_formulas::ensure_formula_schema(&prepared.properties)?;
    data_source_buttons::ensure_button_schema(&prepared.properties)?;
    let target_view = load_table_view_for_schema_tx(&mut tx, data_source_id, view_id).await?;
    let configuration = table_view_configuration(
        &prepared.property_order,
        &prepared.hidden_property_ids,
        target_view.configuration.as_deref(),
    )?;
    sqlx::query(
        "UPDATE notes_data_sources
         SET properties = ?,
             last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND in_trash = 0",
    )
    .bind(prepared.properties.to_string())
    .bind(data_source_id.trim())
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("update notes data source properties: {e}"))?;
    sqlx::query(
        "UPDATE notes_database_views
         SET configuration = ?,
             last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?",
    )
    .bind(configuration.to_string())
    .bind(&target_view.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("update notes table view schema configuration: {e}"))?;
    data_source_relations::rebuild_data_source_relation_links_tx(
        &mut tx,
        data_source_id.trim(),
        &prepared.properties,
    )
    .await?;
    assets::sync_data_source_property_asset_references_tx(
        &mut tx,
        data_source_id.trim(),
        &prepared.properties,
    )
    .await?;
    data_source_rollups::invalidate_rollup_cache_for_data_source_tx(&mut tx, data_source_id.trim())
        .await?;
    let dto = load_data_source_schema_tx(&mut tx, data_source_id, Some(&target_view.id)).await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit notes data source schema update: {e}"))?;
    Ok(dto)
}

fn prepare_schema_update(
    update: &NoteDataSourceSchemaUpdate,
) -> Result<PreparedSchemaUpdate, String> {
    let properties = canonical_properties(&update.properties)?;
    let property_ids = property_ids_by_name(&properties)?;
    let property_order = canonical_property_order(&update.property_order, &property_ids)?;
    let hidden_property_ids =
        canonical_hidden_property_ids(&update.hidden_property_ids, &property_ids)?;
    let schema_bytes = properties.to_string().len();
    if schema_bytes > MAX_SCHEMA_BYTES {
        return Err("data source schema must not exceed 50KB".to_string());
    }
    Ok(PreparedSchemaUpdate {
        properties,
        property_order,
        hidden_property_ids,
    })
}

fn canonical_properties(value: &Value) -> Result<Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "properties must be an object".to_string())?;
    if object.len() > MAX_PROPERTIES {
        return Err("data source schema has too many properties".to_string());
    }
    let mut canonical = Map::new();
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    let mut title_count = 0;
    for (key, property_value) in object {
        let property = canonical_property(key, property_value)?;
        let property_object = property
            .as_object()
            .ok_or_else(|| "property must be an object".to_string())?;
        let id = read_string_field(property_object, "id", "property.id")?.to_string();
        let name = read_string_field(property_object, "name", "property.name")?.to_string();
        let property_type =
            read_string_field(property_object, "type", "property.type")?.to_string();
        let id_key = id.to_lowercase();
        if !ids.insert(id_key) {
            return Err("property ids must be unique".to_string());
        }
        let name_key = name.to_lowercase();
        if !names.insert(name_key) {
            return Err("property names must be unique".to_string());
        }
        if property_type == "title" {
            title_count += 1;
            if id != "title" {
                return Err("title property id must be title".to_string());
            }
        }
        canonical.insert(name, property);
    }
    if title_count != 1 {
        return Err("data source schema must contain exactly one title property".to_string());
    }
    Ok(Value::Object(canonical))
}

fn canonical_property(key: &str, value: &Value) -> Result<Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "property must be an object".to_string())?;
    let property_type = read_string_field(object, "type", "property.type")?;
    if !SUPPORTED_PROPERTY_TYPES.contains(&property_type) {
        return Err(format!(
            "unsupported data source property type: {property_type}"
        ));
    }
    let id = if property_type == "title" {
        "title".to_string()
    } else {
        validate_non_empty_text(
            read_string_field(object, "id", "property.id")?,
            "property.id",
            80,
            false,
        )?
    };
    let fallback_name = if key.trim().is_empty() {
        "Property"
    } else {
        key
    };
    let raw_name = object
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(fallback_name);
    let name = validate_non_empty_text(raw_name, "property.name", MAX_PROPERTY_NAME_LEN, false)?;
    let description = validate_text(
        object
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "property.description",
        MAX_PROPERTY_DESCRIPTION_LEN,
    )?;
    let mut canonical = Map::new();
    canonical.insert("id".to_string(), Value::String(id));
    canonical.insert("name".to_string(), Value::String(name));
    canonical.insert("description".to_string(), Value::String(description));
    canonical.insert("type".to_string(), Value::String(property_type.to_string()));
    canonical.insert(
        property_type.to_string(),
        canonical_type_config(property_type, object.get(property_type))?,
    );
    Ok(Value::Object(canonical))
}

fn canonical_type_config(property_type: &str, value: Option<&Value>) -> Result<Value, String> {
    if EMPTY_CONFIG_TYPES.contains(&property_type) {
        return Ok(json!({}));
    }
    match property_type {
        "number" => canonical_number_config(value),
        "select" | "multi_select" => canonical_options_config(value),
        "status" => canonical_status_config(value),
        "unique_id" => canonical_unique_id_config(value),
        "relation" => data_source_relations::canonical_relation_config(value),
        "rollup" => data_source_rollups::canonical_rollup_config(value),
        "formula" => data_source_formulas::canonical_formula_config(value),
        "button" => data_source_buttons::canonical_button_config(value),
        _ => Err(format!(
            "unsupported data source property type: {property_type}"
        )),
    }
}

fn canonical_number_config(value: Option<&Value>) -> Result<Value, String> {
    let format = value
        .and_then(Value::as_object)
        .and_then(|object| object.get("format"))
        .and_then(Value::as_str)
        .unwrap_or("number");
    if !NUMBER_FORMATS.contains(&format) {
        return Err("number.format must be a supported format".to_string());
    }
    Ok(json!({ "format": format }))
}

fn canonical_options_config(value: Option<&Value>) -> Result<Value, String> {
    let options = value
        .and_then(Value::as_object)
        .and_then(|object| object.get("options"))
        .and_then(Value::as_array)
        .map(|items| canonical_options(items, None))
        .transpose()?
        .unwrap_or_default();
    Ok(json!({ "options": options }))
}

fn canonical_status_config(value: Option<&Value>) -> Result<Value, String> {
    let object = value.and_then(Value::as_object);
    let options = object
        .and_then(|config| config.get("options"))
        .and_then(Value::as_array)
        .map(|items| canonical_options(items, Some("status")))
        .transpose()?
        .unwrap_or_else(default_status_options);
    let groups = canonical_status_groups(object.and_then(|config| config.get("groups")), &options)?;
    let options: Vec<Value> = options
        .into_iter()
        .map(|mut option| {
            if let Some(object) = option.as_object_mut() {
                object.remove("group");
            }
            option
        })
        .collect();
    Ok(json!({
        "options": options,
        "groups": groups
    }))
}

fn canonical_unique_id_config(value: Option<&Value>) -> Result<Value, String> {
    let prefix = value
        .and_then(Value::as_object)
        .and_then(|object| object.get("prefix"));
    let prefix = match prefix {
        Some(Value::Null) | None => Value::Null,
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Value::Null
            } else {
                Value::String(validate_text(
                    trimmed,
                    "unique_id.prefix",
                    MAX_UNIQUE_ID_PREFIX_LEN,
                )?)
            }
        }
        Some(_) => return Err("unique_id.prefix must be a string or null".to_string()),
    };
    Ok(json!({ "prefix": prefix }))
}

fn canonical_options(values: &[Value], status_type: Option<&str>) -> Result<Vec<Value>, String> {
    if values.len() > MAX_OPTIONS {
        return Err("property options are limited to 100".to_string());
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    let mut options = Vec::with_capacity(values.len());
    for (index, value) in values.iter().enumerate() {
        let object = value
            .as_object()
            .ok_or_else(|| "property option must be an object".to_string())?;
        let id = validate_non_empty_text(
            object.get("id").and_then(Value::as_str).unwrap_or_default(),
            "option.id",
            80,
            false,
        )?;
        if !ids.insert(id.to_lowercase()) {
            return Err("option ids must be unique".to_string());
        }
        let name = validate_non_empty_text(
            object
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            "option.name",
            MAX_OPTION_NAME_LEN,
            true,
        )?;
        if !names.insert(name.to_lowercase()) {
            return Err("option names must be unique".to_string());
        }
        let color = object
            .get("color")
            .and_then(Value::as_str)
            .unwrap_or(default_option_color(index));
        if !SELECT_COLORS.contains(&color) {
            return Err("option.color must be a supported color".to_string());
        }
        let mut option = json!({
            "id": id,
            "name": name,
            "color": color
        });
        if status_type.is_some() {
            let group = object
                .get("group")
                .and_then(Value::as_str)
                .unwrap_or("To-do");
            if !STATUS_GROUPS.contains(&group) {
                return Err("status option group must be supported".to_string());
            }
            option["group"] = Value::String(group.to_string());
        }
        options.push(option);
    }
    Ok(options)
}

fn canonical_status_groups(value: Option<&Value>, options: &[Value]) -> Result<Vec<Value>, String> {
    let option_ids: HashSet<String> = options
        .iter()
        .filter_map(|option| option.get("id").and_then(Value::as_str).map(str::to_string))
        .collect();
    let mut grouped: HashMap<String, Vec<String>> = STATUS_GROUPS
        .iter()
        .map(|group| ((*group).to_string(), Vec::new()))
        .collect();
    if let Some(groups) = value.and_then(Value::as_array) {
        for group in groups {
            let object = group
                .as_object()
                .ok_or_else(|| "status group must be an object".to_string())?;
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !STATUS_GROUPS.contains(&name) {
                return Err("status group name must be supported".to_string());
            }
            let ids = object
                .get("option_ids")
                .and_then(Value::as_array)
                .ok_or_else(|| "status group option_ids must be an array".to_string())?;
            for id in ids {
                let id = id
                    .as_str()
                    .ok_or_else(|| "status group option id must be a string".to_string())?;
                if !option_ids.contains(id) {
                    return Err("status group option id must reference an option".to_string());
                }
                grouped
                    .entry(name.to_string())
                    .or_default()
                    .push(id.to_string());
            }
        }
    } else {
        for option in options {
            let group = option
                .get("group")
                .and_then(Value::as_str)
                .filter(|group| STATUS_GROUPS.contains(group))
                .unwrap_or("To-do");
            if let Some(id) = option.get("id").and_then(Value::as_str) {
                grouped
                    .entry(group.to_string())
                    .or_default()
                    .push(id.to_string());
            }
        }
    }
    Ok(STATUS_GROUPS
        .iter()
        .map(|group| {
            json!({
                "id": group,
                "name": group,
                "color": status_group_color(group),
                "option_ids": grouped.remove(*group).unwrap_or_default()
            })
        })
        .collect())
}

fn default_status_options() -> Vec<Value> {
    vec![
        json!({
            "id": "not_started",
            "name": "Not started",
            "color": "default",
            "group": "To-do"
        }),
        json!({
            "id": "in_progress",
            "name": "In progress",
            "color": "blue",
            "group": "In progress"
        }),
        json!({
            "id": "done",
            "name": "Done",
            "color": "green",
            "group": "Complete"
        }),
    ]
}

fn status_group_color(group: &str) -> &'static str {
    match group {
        "In progress" => "blue",
        "Complete" => "green",
        _ => "gray",
    }
}

fn default_option_color(index: usize) -> &'static str {
    SELECT_COLORS
        .get(index % SELECT_COLORS.len())
        .copied()
        .unwrap_or("default")
}

fn property_ids_by_name(properties: &Value) -> Result<HashSet<String>, String> {
    let mut ids = HashSet::new();
    for property in properties
        .as_object()
        .ok_or_else(|| "properties must be an object".to_string())?
        .values()
    {
        let object = property
            .as_object()
            .ok_or_else(|| "property must be an object".to_string())?;
        ids.insert(read_string_field(object, "id", "property.id")?.to_string());
    }
    Ok(ids)
}

fn canonical_property_order(
    requested: &[String],
    property_ids: &HashSet<String>,
) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut order = vec!["title".to_string()];
    seen.insert("title".to_string());
    for id in requested {
        let id = id.trim();
        if id.is_empty() || id == "title" {
            continue;
        }
        if !property_ids.contains(id) {
            return Err("property_order contains an unknown property id".to_string());
        }
        if !seen.insert(id.to_string()) {
            return Err("property_order must not contain duplicates".to_string());
        }
        order.push(id.to_string());
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
            return Err("hidden_property_ids contains an unknown property id".to_string());
        }
        if seen.insert(id.to_string()) {
            hidden.push(id.to_string());
        }
    }
    Ok(hidden)
}

fn ensure_title_property_preserved(current: &Value, next: &Value) -> Result<(), String> {
    let current_title = title_property_name(current)?;
    let next_title = title_property_name(next)?
        .ok_or_else(|| "data source schema must contain exactly one title property".to_string())?;
    if next_title.trim().is_empty() {
        return Err("title property name is required".to_string());
    }
    if current_title.is_none() {
        return Ok(());
    }
    Ok(())
}

fn title_property_name(properties: &Value) -> Result<Option<String>, String> {
    for property in properties
        .as_object()
        .ok_or_else(|| "properties must be an object".to_string())?
        .values()
    {
        let object = property
            .as_object()
            .ok_or_else(|| "property must be an object".to_string())?;
        if object.get("type").and_then(Value::as_str) == Some("title") {
            return Ok(object
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string));
        }
    }
    Ok(None)
}

fn table_view_configuration(
    property_order: &[String],
    hidden_property_ids: &[String],
    current_configuration: Option<&str>,
) -> Result<Value, String> {
    let current_table = current_configuration
        .map(|configuration| parse_json(configuration, "table view configuration"))
        .transpose()?
        .and_then(|configuration| configuration.get("table").cloned())
        .and_then(|table| table.as_object().cloned())
        .unwrap_or_default();
    let property_ids: HashSet<String> = property_order.iter().cloned().collect();
    let column_widths = current_table
        .get("column_widths")
        .and_then(Value::as_object)
        .map(|widths| {
            let mut kept = Map::new();
            for (property_id, width) in widths {
                if property_ids.contains(property_id) && width.as_i64().is_some() {
                    kept.insert(property_id.clone(), width.clone());
                }
            }
            Value::Object(kept)
        })
        .unwrap_or_else(|| json!({}));
    let row_open_mode = current_table
        .get("row_open_mode")
        .and_then(Value::as_str)
        .filter(|mode| TABLE_ROW_OPEN_MODES.contains(mode))
        .unwrap_or("full_page");
    Ok(json!({
        "type": "table",
        "table": {
            "property_order": property_order,
            "hidden_property_ids": hidden_property_ids,
            "column_widths": column_widths,
            "row_open_mode": row_open_mode
        }
    }))
}

async fn load_data_source_schema_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
    view_id: Option<&str>,
) -> Result<NoteDataSourceSchemaDto, String> {
    let data_source = load_data_source_row_tx(tx, data_source_id).await?;
    let database =
        sqlx::query_as::<_, NoteDatabaseRow>("SELECT * FROM notes_databases WHERE id = ?")
            .bind(&data_source.database_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| format!("load notes data source database: {e}"))?;
    let view = load_table_view_for_schema_tx(tx, data_source_id, view_id).await?;
    NoteDataSourceSchemaDto::new(data_source, database, view)
}

async fn load_table_view_for_schema_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
    view_id: Option<&str>,
) -> Result<NoteDatabaseViewRow, String> {
    let view = if let Some(view_id) = view_id {
        data_source_views::load_scoped_view_row_tx(tx, data_source_id, "table", None, Some(view_id))
            .await?
    } else {
        data_source_views::load_scoped_view_row_tx(tx, data_source_id, "table", None, None).await?
    };
    view.ok_or_else(|| "data source table view not found".to_string())
}

async fn load_data_source_row_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
) -> Result<NoteDataSourceRow, String> {
    sqlx::query_as::<_, NoteDataSourceRow>(
        "SELECT *
         FROM notes_data_sources
         WHERE id = ? AND in_trash = 0",
    )
    .bind(data_source_id.trim())
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("load notes data source: {e}"))?
    .ok_or_else(|| "data source not found".to_string())
}

fn parse_json(value: &str, label: &str) -> Result<Value, String> {
    serde_json::from_str(value).map_err(|e| format!("parse {label}: {e}"))
}

fn read_string_field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<&'a str, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{label} must be a string"))
}

fn validate_non_empty_text(
    value: &str,
    label: &str,
    max_len: usize,
    reject_comma: bool,
) -> Result<String, String> {
    let trimmed = validate_text(value.trim(), label, max_len)?;
    if trimmed.is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    if reject_comma && trimmed.contains(',') {
        return Err(format!("{label} must not contain commas"));
    }
    Ok(trimmed)
}

fn validate_text(value: &str, label: &str, max_len: usize) -> Result<String, String> {
    if value.chars().any(char::is_control) {
        return Err(format!("{label} must not contain control characters"));
    }
    if value.chars().count() > max_len {
        return Err(format!("{label} is too long"));
    }
    Ok(value.to_string())
}
