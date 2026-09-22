use super::data_source_table::{
    TableProperty, row_property_checked, row_property_number, row_property_plain_text,
};
use super::data_source_views::ViewProperty as BoardProperty;
use super::models::{
    NoteDataSourceRowWindow, NoteDataSourceTableFilter, NoteDataSourceTableSort,
    NoteDataSourceViewWindowRequest, NotePageRow,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{QueryBuilder, Sqlite, Transaction};
use std::collections::HashMap;

const DEFAULT_WINDOW_SIZE: i64 = 80;
const MAX_WINDOW_SIZE: i64 = 200;

pub(super) struct RowWindowQuery<'a> {
    pub schema: &'a [TableProperty],
    pub filters: &'a [NoteDataSourceTableFilter],
    pub sorts: &'a [NoteDataSourceTableSort],
    pub request: &'a NoteDataSourceViewWindowRequest,
    pub date_property: Option<&'a TableProperty>,
    pub group_property: Option<&'a TableProperty>,
}

pub(super) fn table_properties_from_board(schema: &[BoardProperty]) -> Vec<TableProperty> {
    schema
        .iter()
        .map(|property| TableProperty {
            key: property.key.clone(),
            id: property.id.clone(),
            name: property.id.clone(),
            property_type: property.property_type.clone(),
            schema: property.schema.clone(),
        })
        .collect()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", content = "value")]
enum CursorValue {
    Null,
    Number(f64),
    Boolean(bool),
    Text(String),
}

#[derive(Deserialize, Serialize)]
struct RowCursor {
    values: Vec<CursorValue>,
    title: String,
    id: String,
}

struct SortExpression<'a> {
    sql: String,
    property: &'a TableProperty,
    descending: bool,
}

pub(super) async fn load_row_window_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
    query_options: RowWindowQuery<'_>,
) -> Result<NoteDataSourceRowWindow, String> {
    let RowWindowQuery {
        schema,
        filters,
        sorts,
        request,
        date_property,
        group_property,
    } = query_options;
    let page_size = request.page_size.unwrap_or(DEFAULT_WINDOW_SIZE);
    if !(1..=MAX_WINDOW_SIZE).contains(&page_size) {
        return Err(format!(
            "database view page_size must be between 1 and {MAX_WINDOW_SIZE}"
        ));
    }
    let cursor = request
        .start_cursor
        .as_deref()
        .map(|value| {
            serde_json::from_str::<RowCursor>(value)
                .map_err(|e| format!("parse database view cursor: {e}"))
        })
        .transpose()?;
    let sort_expressions = sort_expressions(schema, sorts);
    if let Some(cursor) = &cursor {
        if cursor.values.len() != sort_expressions.len() {
            return Err("database view cursor does not match the active sort".to_string());
        }
    }

    let mut count_query = QueryBuilder::<Sqlite>::new(
        "SELECT COUNT(*) FROM notes_pages AS page \
         WHERE page.parent_type = 'data_source_id' AND page.parent_data_source_id = ",
    );
    count_query.push_bind(data_source_id);
    count_query.push(" AND page.in_trash = 0 AND page.archived = 0");
    push_filters(&mut count_query, schema, filters);
    push_date_range(&mut count_query, request, date_property);
    let total_row_count: i64 = count_query
        .build_query_scalar()
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| format!("count notes database view rows: {e}"))?;

    let mut query = QueryBuilder::<Sqlite>::new(
        "SELECT page.* FROM notes_pages AS page \
         WHERE page.parent_type = 'data_source_id' AND page.parent_data_source_id = ",
    );
    query.push_bind(data_source_id);
    query.push(" AND page.in_trash = 0 AND page.archived = 0");
    push_filters(&mut query, schema, filters);
    push_date_range(&mut query, request, date_property);
    if let Some(cursor) = &cursor {
        push_cursor_condition(&mut query, &sort_expressions, cursor);
    }
    query.push(" ORDER BY ");
    for (index, sort) in sort_expressions.iter().enumerate() {
        if index > 0 {
            query.push(", ");
        }
        query.push("(").push(&sort.sql).push(") IS NULL ");
        query.push(if sort.descending { "DESC" } else { "ASC" });
        query
            .push(", ")
            .push(&sort.sql)
            .push(if sort.descending { " DESC" } else { " ASC" });
    }
    if !sort_expressions.is_empty() {
        query.push(", ");
    }
    query.push("page.title COLLATE NOCASE ASC, page.id ASC LIMIT ");
    query.push_bind(page_size + 1);
    let built_query = query.build_query_as::<NotePageRow>();
    let query_sql = sqlx::Execute::sql(&built_query).to_string();
    let mut rows = built_query
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| format!("load notes database view row window: {e}; query: {query_sql}"))?;
    let has_more = rows.len() > page_size as usize;
    if has_more {
        rows.truncate(page_size as usize);
    }
    let next_cursor = if has_more {
        rows.last()
            .map(|row| row_cursor(row, &sort_expressions))
            .transpose()?
            .map(|cursor| {
                serde_json::to_string(&cursor)
                    .map_err(|e| format!("serialize database view cursor: {e}"))
            })
            .transpose()?
    } else {
        None
    };
    let group_counts =
        load_group_counts_tx(tx, data_source_id, schema, filters, group_property).await?;
    Ok(NoteDataSourceRowWindow {
        rows,
        total_row_count,
        next_cursor,
        has_more,
        group_counts,
    })
}

async fn load_group_counts_tx(
    tx: &mut Transaction<'_, Sqlite>,
    data_source_id: &str,
    schema: &[TableProperty],
    filters: &[NoteDataSourceTableFilter],
    property: Option<&TableProperty>,
) -> Result<HashMap<String, i64>, String> {
    let Some(property) = property else {
        return Ok(HashMap::new());
    };
    let payload = property_value_expression(property);
    let mut query = QueryBuilder::<Sqlite>::new("SELECT ");
    if matches!(
        property.property_type.as_str(),
        "multi_select" | "people" | "relation"
    ) {
        query.push("COALESCE(json_extract(item.value, '$.id'), '__empty__') AS group_id, COUNT(*) AS row_count ");
        query
            .push("FROM notes_pages AS page LEFT JOIN json_each(")
            .push(&payload)
            .push(") AS item ");
    } else {
        let group_expression = match property.property_type.as_str() {
            "select" | "status" => {
                format!("COALESCE(json_extract({payload}, '$.id'), '__empty__')")
            }
            "checkbox" => format!("CASE WHEN {payload} = 1 THEN 'true' ELSE 'false' END"),
            "date" => format!("COALESCE(json_extract({payload}, '$.start'), '__empty__')"),
            _ => "'__ungrouped__'".to_string(),
        };
        query
            .push(&group_expression)
            .push(" AS group_id, COUNT(*) AS row_count FROM notes_pages AS page ");
    }
    query.push("WHERE page.parent_type = 'data_source_id' AND page.parent_data_source_id = ");
    query.push_bind(data_source_id);
    query.push(" AND page.in_trash = 0 AND page.archived = 0");
    push_filters(&mut query, schema, filters);
    query.push(" GROUP BY group_id");
    let rows = query
        .build()
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| format!("group notes database view rows: {e}"))?;
    use sqlx::Row;
    rows.into_iter()
        .map(|row| {
            Ok((
                row.try_get::<String, _>("group_id")?,
                row.try_get::<i64, _>("row_count")?,
            ))
        })
        .collect::<Result<HashMap<_, _>, sqlx::Error>>()
        .map_err(|e| format!("read notes database view group counts: {e}"))
}

fn push_date_range(
    query: &mut QueryBuilder<'_, Sqlite>,
    request: &NoteDataSourceViewWindowRequest,
    date_property: Option<&TableProperty>,
) {
    let (Some(property), Some(range_start), Some(range_end)) = (
        date_property,
        request.range_start.as_deref(),
        request.range_end.as_deref(),
    ) else {
        return;
    };
    let payload = property_value_expression(property);
    query
        .push(" AND json_extract(")
        .push(&payload)
        .push(", '$.start') <= ");
    query.push_bind(range_end.to_string());
    query
        .push(" AND COALESCE(json_extract(")
        .push(&payload)
        .push(", '$.end'), json_extract(");
    query.push(&payload).push(", '$.start')) >= ");
    query.push_bind(range_start.to_string());
}

fn sort_expressions<'a>(
    schema: &'a [TableProperty],
    sorts: &[NoteDataSourceTableSort],
) -> Vec<SortExpression<'a>> {
    sorts
        .iter()
        .filter_map(|sort| {
            let property = schema
                .iter()
                .find(|property| property.id == sort.property_id)?;
            Some(SortExpression {
                sql: property_sort_expression(property),
                property,
                descending: sort.direction == "descending",
            })
        })
        .collect()
}

fn push_filters(
    query: &mut QueryBuilder<'_, Sqlite>,
    schema: &[TableProperty],
    filters: &[NoteDataSourceTableFilter],
) {
    for filter in filters {
        let Some(property) = schema
            .iter()
            .find(|property| property.id == filter.property_id)
        else {
            continue;
        };
        let expression = property_text_expression(property);
        match filter.condition.as_str() {
            "contains" => {
                if let Some(value) = filter.value.as_ref().and_then(Value::as_str) {
                    query
                        .push(" AND instr(lower(")
                        .push(&expression)
                        .push("), lower(");
                    query.push_bind(value.to_string());
                    query.push(")) > 0");
                }
            }
            "equals" => {
                let value = filter
                    .value
                    .as_ref()
                    .map(scalar_filter_text)
                    .unwrap_or_default();
                query
                    .push(" AND lower(")
                    .push(&expression)
                    .push(") = lower(");
                query.push_bind(value);
                query.push(")");
            }
            "is_empty" => {
                query.push(" AND trim(").push(&expression).push(") = ''");
            }
            "is_not_empty" => {
                query.push(" AND trim(").push(&expression).push(") <> ''");
            }
            "checked" | "unchecked" => {
                query
                    .push(" AND ")
                    .push(property_value_expression(property));
                query.push(" = ").push_bind(filter.condition == "checked");
            }
            _ => {}
        }
    }
}

fn push_cursor_condition(
    query: &mut QueryBuilder<'_, Sqlite>,
    sorts: &[SortExpression<'_>],
    cursor: &RowCursor,
) {
    query.push(" AND (");
    let mut prior_equalities: Vec<(String, CursorValue)> = Vec::new();
    for (sort, value) in sorts.iter().zip(&cursor.values) {
        push_cursor_branch(query, &prior_equalities, &sort.sql, sort.descending, value);
        query.push(" OR ");
        prior_equalities.push((sort.sql.clone(), value.clone()));
    }
    push_prior_equalities(query, &prior_equalities);
    if !prior_equalities.is_empty() {
        query.push(" AND ");
    }
    query
        .push("(lower(page.title) > lower(")
        .push_bind(cursor.title.clone())
        .push(") OR (lower(page.title) = lower(");
    query.push_bind(cursor.title.clone());
    query
        .push(") AND page.id > ")
        .push_bind(cursor.id.clone())
        .push("))");
    query.push(")");
}

fn push_cursor_branch(
    query: &mut QueryBuilder<'_, Sqlite>,
    prior: &[(String, CursorValue)],
    expression: &str,
    descending: bool,
    value: &CursorValue,
) {
    query.push("(");
    push_prior_equalities(query, prior);
    if !prior.is_empty() {
        query.push(" AND ");
    }
    let null_flag = matches!(value, CursorValue::Null);
    query.push("(").push(expression).push(") IS NULL ");
    query
        .push(if descending { "< " } else { "> " })
        .push_bind(null_flag);
    query
        .push(" OR ((")
        .push(expression)
        .push(") IS NULL = ")
        .push_bind(null_flag);
    query
        .push(" AND ")
        .push(expression)
        .push(if descending { " < " } else { " > " });
    push_cursor_value(query, value);
    query.push(")");
    query.push(")");
}

fn push_prior_equalities(query: &mut QueryBuilder<'_, Sqlite>, prior: &[(String, CursorValue)]) {
    for (index, (expression, value)) in prior.iter().enumerate() {
        if index > 0 {
            query.push(" AND ");
        }
        if matches!(value, CursorValue::Null) {
            query.push("(").push(expression).push(") IS NULL");
        } else {
            query.push("(").push(expression).push(") = ");
            push_cursor_value(query, value);
        }
    }
}

fn push_cursor_value(query: &mut QueryBuilder<'_, Sqlite>, value: &CursorValue) {
    match value {
        CursorValue::Null => {
            query.push("NULL");
        }
        CursorValue::Number(value) => {
            query.push_bind(*value);
        }
        CursorValue::Boolean(value) => {
            query.push_bind(*value);
        }
        CursorValue::Text(value) => {
            query.push_bind(value.clone());
        }
    }
}

fn row_cursor(row: &NotePageRow, sorts: &[SortExpression<'_>]) -> Result<RowCursor, String> {
    Ok(RowCursor {
        values: sorts
            .iter()
            .map(|sort| cursor_value(row, sort.property))
            .collect(),
        title: row.title.clone(),
        id: row.id.clone(),
    })
}

fn cursor_value(row: &NotePageRow, property: &TableProperty) -> CursorValue {
    match property.property_type.as_str() {
        "number" | "rollup" | "formula" => row_property_number(row, property)
            .map(CursorValue::Number)
            .unwrap_or(CursorValue::Null),
        "checkbox" => row_property_checked(row, property)
            .map(CursorValue::Boolean)
            .unwrap_or(CursorValue::Null),
        _ => {
            let text = row_property_plain_text(row, property).to_lowercase();
            if text.is_empty() {
                CursorValue::Null
            } else {
                CursorValue::Text(text)
            }
        }
    }
}

fn property_sort_expression(property: &TableProperty) -> String {
    match property.property_type.as_str() {
        "number" => format!("CAST({} AS REAL)", property_value_expression(property)),
        "checkbox" => format!("CAST({} AS INTEGER)", property_value_expression(property)),
        _ => format!("lower({})", property_text_expression(property)),
    }
}

fn property_text_expression(property: &TableProperty) -> String {
    let payload = property_value_expression(property);
    match property.property_type.as_str() {
        "title" => "COALESCE(page.title, '')".to_string(),
        "rich_text" => format!(
            "COALESCE((SELECT group_concat(COALESCE(json_extract(item.value, '$.plain_text'), json_extract(item.value, '$.text.content'), ''), '') FROM json_each({payload}) AS item), '')"
        ),
        "number" | "checkbox" | "url" | "email" | "phone_number" => {
            format!("COALESCE(CAST({payload} AS TEXT), '')")
        }
        "select" | "status" | "place" => format!("COALESCE(json_extract({payload}, '$.name'), '')"),
        "multi_select" | "people" => format!(
            "COALESCE((SELECT group_concat(COALESCE(json_extract(item.value, '$.name'), ''), ', ') FROM json_each({payload}) AS item), '')"
        ),
        "relation" => format!(
            "COALESCE((SELECT group_concat(target.title, ', ') \
              FROM notes_data_source_relation_links AS relation \
              JOIN notes_pages AS target ON target.id = relation.target_page_id \
              WHERE relation.source_page_id = page.id \
                AND relation.source_property_id = '{}'), '')",
            sql_string(&property.id),
        ),
        "rollup" => format!(
            "COALESCE((SELECT CAST(cache.value AS TEXT) \
              FROM notes_data_source_rollup_cache AS cache \
              WHERE cache.source_page_id = page.id \
                AND cache.source_property_id = '{}'), '')",
            sql_string(&property.id),
        ),
        "date" => format!("COALESCE(json_extract({payload}, '$.start'), '')"),
        "created_time" => "page.created_time".to_string(),
        "last_edited_time" => "page.last_edited_time".to_string(),
        _ => format!("COALESCE(CAST({payload} AS TEXT), '')"),
    }
}

fn sql_string(value: &str) -> String {
    value.replace('\'', "''")
}

fn property_value_expression(property: &TableProperty) -> String {
    format!(
        "json_extract(page.properties, '{}')",
        json_path(&property.key, &property.property_type),
    )
}

fn json_path(key: &str, property_type: &str) -> String {
    let escaped_key = key.replace('\\', "\\\\").replace('"', "\\\"");
    let escaped_type = property_type.replace('\\', "\\\\").replace('"', "\\\"");
    format!("$.\"{escaped_key}\".\"{escaped_type}\"")
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
