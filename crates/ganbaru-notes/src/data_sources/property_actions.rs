//! Atomic contextual property creation and placement within one requesting table.

use crate::models::{
    NoteDataSourcePropertyAction, NoteDataSourcePropertyInsertionSide, NoteDataSourceSchemaDto,
    NoteDataSourceSchemaUpdate,
};
use crate::validation::require_uuid;
use crate::{data_sources, page_history};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::{Sqlite, SqlitePool, Transaction};
use std::collections::HashMap;

#[derive(Serialize)]
pub struct NoteDataSourcePropertyActionDto {
    pub property_id: String,
    pub schema: NoteDataSourceSchemaDto,
}

/// Add one property and its requesting view position without exposing an intermediate state.
pub async fn apply_property_action(
    pool: &SqlitePool,
    data_source_id: &str,
    database_id: &str,
    view_id: &str,
    action: NoteDataSourcePropertyAction,
) -> Result<NoteDataSourcePropertyActionDto, String> {
    data_sources::views::validate_view_scope(data_source_id, Some(database_id), Some(view_id))?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("begin database property action: {error}"))?;
    let view = data_sources::views::load_scoped_view_row_tx(
        &mut tx,
        data_source_id,
        "table",
        Some(database_id),
        Some(view_id),
    )
    .await?
    .ok_or_else(|| "requesting table view not found".to_string())?;
    data_sources::views::prepare_view_mutation_tx(&mut tx, &view, "Database property").await?;
    let source: String = sqlx::query_scalar(
        "SELECT properties FROM notes_data_sources WHERE id = ? AND in_trash = 0",
    )
    .bind(data_source_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| format!("load property action source: {error}"))?
    .ok_or_else(|| "data source not found".to_string())?;
    let mut properties: Value = serde_json::from_str(&source)
        .map_err(|error| format!("read property action schema: {error}"))?;
    let object = properties
        .as_object_mut()
        .ok_or_else(|| "data source properties must be an object".to_string())?;
    let target_id = match &action {
        NoteDataSourcePropertyAction::Insert { property_id, .. }
        | NoteDataSourcePropertyAction::Duplicate { property_id, .. } => property_id.clone(),
    };
    let target = object
        .values()
        .find(|property| property.get("id").and_then(Value::as_str) == Some(target_id.as_str()))
        .cloned()
        .ok_or_else(|| "property action target not found".to_string())?;
    let target_is_title = target.get("type").and_then(Value::as_str) == Some("title");
    let (property, side) = match action {
        NoteDataSourcePropertyAction::Insert { property, side, .. } => {
            if target_is_title && matches!(side, NoteDataSourcePropertyInsertionSide::Left) {
                return Err("the required title must remain first".to_string());
            }
            (property, side)
        }
        NoteDataSourcePropertyAction::Duplicate { name, .. } => {
            if target_is_title {
                return Err("the required title cannot be duplicated".to_string());
            }
            (
                duplicate_property_tx(&mut tx, target, &name).await?,
                NoteDataSourcePropertyInsertionSide::Right,
            )
        }
    };
    if property.get("type").and_then(Value::as_str) == Some("title") {
        return Err("a source has exactly one title property".to_string());
    }
    let new_id = property
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "new property id is required".to_string())?
        .to_string();
    if object
        .values()
        .any(|existing| existing.get("id").and_then(Value::as_str) == Some(&new_id))
    {
        return Err("new property id must be unique".to_string());
    }
    let name = property
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "new property name is required".to_string())?
        .to_string();
    if object.contains_key(&name) {
        return Err("new property name must be unique".to_string());
    }
    object.insert(name, property);
    let prepared =
        data_sources::schema::prepare_schema_update(&NoteDataSourceSchemaUpdate { properties })?;
    let page_id: String =
        sqlx::query_scalar("SELECT page_id FROM notes_blocks WHERE id = ? AND in_trash = 0")
            .bind(database_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| format!("load property action parent page: {error}"))?;
    page_history::record_page_snapshot_tx(&mut tx, &page_id, "data_source_property_action").await?;
    data_sources::schema::update_data_source_schema_tx(
        &mut tx,
        data_source_id,
        Some(database_id),
        Some(&view.id),
        prepared,
    )
    .await?;
    place_property_tx(&mut tx, &view.id, &target_id, &new_id, side).await?;
    let schema = data_sources::schema::load_data_source_schema_tx(
        &mut tx,
        data_source_id,
        Some(database_id),
        Some(&view.id),
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| format!("commit database property action: {error}"))?;
    Ok(NoteDataSourcePropertyActionDto {
        property_id: new_id,
        schema,
    })
}

async fn duplicate_property_tx(
    tx: &mut Transaction<'_, Sqlite>,
    mut property: Value,
    name: &str,
) -> Result<Value, String> {
    property["id"] = Value::String(
        data_sources::views::generate_uuid_tx(tx, "generate duplicated property id", "property_id")
            .await?,
    );
    property["name"] = Value::String(name.to_string());
    let property_type = property
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "property type is missing".to_string())?
        .to_string();
    let configuration = property
        .get_mut(&property_type)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "property configuration is missing".to_string())?;
    if property_type == "relation" {
        configuration.insert("type".to_string(), json!("single_property"));
        configuration.remove("dual_property");
    }
    let mut replacements = HashMap::new();
    if let Some(options) = configuration
        .get_mut("options")
        .and_then(Value::as_array_mut)
    {
        for option in options {
            let old = option
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "property option id is missing".to_string())?
                .to_string();
            let id = data_sources::views::generate_uuid_tx(
                tx,
                "generate duplicated option id",
                "option_id",
            )
            .await?;
            option["id"] = json!(id);
            replacements.insert(old, id);
        }
    }
    if let Some(groups) = configuration
        .get_mut("groups")
        .and_then(Value::as_array_mut)
    {
        for group in groups {
            if let Some(ids) = group.get_mut("option_ids").and_then(Value::as_array_mut) {
                for id in ids {
                    if let Some(next) = id.as_str().and_then(|old| replacements.get(old)) {
                        *id = json!(next);
                    }
                }
            }
        }
    }
    Ok(property)
}

async fn place_property_tx(
    tx: &mut Transaction<'_, Sqlite>,
    view_id: &str,
    target_id: &str,
    new_id: &str,
    side: NoteDataSourcePropertyInsertionSide,
) -> Result<(), String> {
    require_uuid(view_id, "view_id")?;
    let raw: String =
        sqlx::query_scalar("SELECT configuration FROM notes_database_views WHERE id = ?")
            .bind(view_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|error| format!("read requesting table position: {error}"))?;
    let mut configuration: Value = serde_json::from_str(&raw)
        .map_err(|error| format!("parse requesting table configuration: {error}"))?;
    let order = configuration
        .get_mut("table")
        .and_then(|table| table.get_mut("property_order"))
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "requesting table property order is missing".to_string())?;
    order.retain(|id| id.as_str() != Some(new_id));
    let index = order
        .iter()
        .position(|id| id.as_str() == Some(target_id))
        .ok_or_else(|| "target property is absent from table order".to_string())?;
    order.insert(
        index + usize::from(matches!(side, NoteDataSourcePropertyInsertionSide::Right)),
        json!(new_id),
    );
    sqlx::query("UPDATE notes_database_views SET configuration = ?, last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
        .bind(configuration.to_string()).bind(view_id).execute(&mut **tx).await.map_err(|error| format!("save contextual property position: {error}"))?;
    Ok(())
}
