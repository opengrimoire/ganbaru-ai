use super::block_tree::{
    load_child_page_block_row, load_page_block_subtree_rows, refresh_duplicated_has_children,
};
use super::ids::new_note_id;
use super::pages::load_page_row;
use super::parents::{parent_target_from_block_row, refresh_parent_has_children, touch_page};
use super::payloads::{child_page_payload, page_row_properties_for_title};
use super::sort::next_sort_orders;
use crate::notes::models::{
    NoteBlockRow, NoteDuplicatePage, NoteLoadedPage, NotePageRow, NoteParent, page_parent_columns,
};
use crate::notes::validation::{
    plain_text_from_payload, require_uuid, validate_parent, validate_sort_order,
};
use crate::notes::{history, project_history, reads};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet, VecDeque};

pub(super) struct DuplicatePagePlan {
    source_page: NotePageRow,
    duplicate_id: String,
    duplicate_title: String,
    parent: NoteParent,
    blocks: Vec<NoteBlockRow>,
    is_root: bool,
}

pub async fn duplicate_page(
    pool: &SqlitePool,
    page_id: &str,
    request: NoteDuplicatePage,
) -> Result<NoteLoadedPage, String> {
    let page_id = page_id.trim();
    require_uuid(page_id, "page_id")?;
    project_history::ensure_page_baseline_for_mutation(pool, page_id).await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin duplicate notes page: {e}"))?;
    let root_page = load_page_row(&mut tx, page_id).await?;
    if matches!(root_page.parent_type.as_str(), "page_id" | "block_id") {
        let source_block = load_child_page_block_row(&mut tx, page_id).await?;
        history::record_page_snapshot_tx(&mut tx, &source_block.page_id, "duplicate_page").await?;
    }
    let root_duplicate_title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or(root_page.title.trim())
        .to_string();
    let mut reserved_ids = HashSet::new();
    let mut block_ids = HashMap::new();
    let root_duplicate_id = new_note_id(&mut tx, &mut reserved_ids).await?;
    let mut plans = Vec::new();
    let mut queue = VecDeque::from([(
        page_id.to_string(),
        root_duplicate_id.clone(),
        root_duplicate_title,
        None::<NoteParent>,
        true,
    )]);
    while let Some((source_page_id, duplicate_id, title_override, parent_override, is_root)) =
        queue.pop_front()
    {
        let source_page = load_page_row(&mut tx, &source_page_id).await?;
        let blocks = load_page_block_subtree_rows(&mut tx, &source_page_id).await?;
        for row in &blocks {
            if row.block_type == "child_page" {
                let child_page = load_page_row(&mut tx, &row.id).await?;
                let child_duplicate_id = new_note_id(&mut tx, &mut reserved_ids).await?;
                block_ids.insert(row.id.clone(), child_duplicate_id.clone());
                let duplicate_parent =
                    duplicate_page_parent_for_child_block(row, &duplicate_id, &block_ids)?;
                queue.push_back((
                    child_page.id,
                    child_duplicate_id,
                    child_page.title,
                    Some(duplicate_parent),
                    false,
                ));
            } else if !block_ids.contains_key(&row.id) {
                let duplicate_block_id = new_note_id(&mut tx, &mut reserved_ids).await?;
                block_ids.insert(row.id.clone(), duplicate_block_id);
            }
        }
        let parent = match parent_override {
            Some(parent) => parent,
            None => page_parent_from_columns(
                &source_page.parent_type,
                source_page.parent_page_id.clone(),
                source_page.parent_block_id.clone(),
                source_page.parent_data_source_id.clone(),
            )?,
        };
        plans.push(DuplicatePagePlan {
            source_page,
            duplicate_id,
            duplicate_title: title_override,
            parent,
            blocks,
            is_root,
        });
    }
    let duplicate_titles = plans
        .iter()
        .map(|plan| (plan.source_page.id.clone(), plan.duplicate_title.clone()))
        .collect::<HashMap<_, _>>();
    let mut inserted_block_ids = HashSet::new();
    for plan in &plans {
        insert_duplicated_page(&mut tx, plan).await?;
        if plan.is_root {
            insert_root_duplicate_child_page_block(&mut tx, plan).await?;
        }
        insert_duplicated_page_blocks(
            &mut tx,
            plan,
            &block_ids,
            &duplicate_titles,
            &mut inserted_block_ids,
        )
        .await?;
    }
    refresh_duplicated_has_children(&mut tx, &inserted_block_ids).await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit duplicate notes page: {e}"))?;
    reads::load_page(pool, &root_duplicate_id).await
}

pub(super) fn page_parent_from_columns(
    parent_type: &str,
    parent_page_id: Option<String>,
    parent_block_id: Option<String>,
    parent_data_source_id: Option<String>,
) -> Result<NoteParent, String> {
    match parent_type {
        "workspace" => Ok(NoteParent::Workspace { workspace: true }),
        "page_id" => parent_page_id
            .map(|page_id| NoteParent::PageId { page_id })
            .ok_or_else(|| "page parent row is missing parent_page_id".to_string()),
        "block_id" => parent_block_id
            .map(|block_id| NoteParent::BlockId { block_id })
            .ok_or_else(|| "page parent row is missing parent_block_id".to_string()),
        "data_source_id" => parent_data_source_id
            .map(|data_source_id| NoteParent::DataSourceId { data_source_id })
            .ok_or_else(|| "page parent row is missing parent_data_source_id".to_string()),
        _ => Err("page parent row has unsupported parent_type".to_string()),
    }
}

pub(super) fn duplicate_page_parent_for_child_block(
    block: &NoteBlockRow,
    duplicate_page_id: &str,
    block_ids: &HashMap<String, String>,
) -> Result<NoteParent, String> {
    match block.parent_type.as_str() {
        "page_id" => Ok(NoteParent::PageId {
            page_id: duplicate_page_id.to_string(),
        }),
        "block_id" => {
            let source_parent_id = block
                .parent_block_id
                .as_ref()
                .ok_or_else(|| "child page block is missing its parent".to_string())?;
            let duplicate_parent_id = block_ids
                .get(source_parent_id)
                .cloned()
                .ok_or_else(|| "child page block parent was not duplicated".to_string())?;
            Ok(NoteParent::BlockId {
                block_id: duplicate_parent_id,
            })
        }
        _ => Err("child page block has unsupported parent_type".to_string()),
    }
}

pub(super) async fn insert_duplicated_page(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    plan: &DuplicatePagePlan,
) -> Result<(), String> {
    validate_parent(&plan.parent)?;
    let (parent_type, parent_page_id, parent_block_id, parent_data_source_id) =
        page_parent_columns(&plan.parent);
    let folder_id = if plan.is_root && parent_type == "workspace" {
        plan.source_page.folder_id.as_deref()
    } else {
        None
    };
    let properties = if plan.duplicate_title == plan.source_page.title {
        plan.source_page.properties.clone()
    } else {
        page_row_properties_for_title(&plan.source_page, &plan.duplicate_title)?
    };
    sqlx::query(
        "INSERT INTO notes_pages (
            id,
            parent_type,
            parent_page_id,
            parent_block_id,
            parent_data_source_id,
            folder_id,
            title,
            properties,
            icon,
            cover
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&plan.duplicate_id)
    .bind(parent_type)
    .bind(parent_page_id)
    .bind(parent_block_id)
    .bind(parent_data_source_id)
    .bind(folder_id)
    .bind(&plan.duplicate_title)
    .bind(properties)
    .bind(&plan.source_page.icon)
    .bind(&plan.source_page.cover)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("duplicate notes page: {e}"))?;
    Ok(())
}

pub(super) async fn insert_root_duplicate_child_page_block(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    plan: &DuplicatePagePlan,
) -> Result<(), String> {
    if plan.source_page.parent_type == "workspace"
        || plan.source_page.parent_type == "data_source_id"
    {
        return Ok(());
    }
    let source_block = load_child_page_block_row(tx, &plan.source_page.id).await?;
    let parent = parent_target_from_block_row(&source_block);
    let sort_order = next_sort_orders(tx, &parent, Some(source_block.id.as_str()), 1).await?[0];
    validate_sort_order(sort_order)?;
    let payload = child_page_payload(&plan.duplicate_title);
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
         VALUES (?, ?, ?, ?, ?, 'child_page', ?, ?, ?)",
    )
    .bind(&plan.duplicate_id)
    .bind(&source_block.page_id)
    .bind(parent.parent_type)
    .bind(&parent.parent_page_id)
    .bind(&parent.parent_block_id)
    .bind(payload.to_string())
    .bind(plain_text_from_payload("child_page", &payload))
    .bind(sort_order)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("duplicate notes child page block: {e}"))?;
    refresh_parent_has_children(tx, &parent).await?;
    touch_page(tx, &source_block.page_id).await?;
    Ok(())
}

pub(super) async fn insert_duplicated_page_blocks(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    plan: &DuplicatePagePlan,
    block_ids: &HashMap<String, String>,
    duplicate_titles: &HashMap<String, String>,
    inserted_block_ids: &mut HashSet<String>,
) -> Result<(), String> {
    for row in &plan.blocks {
        let duplicate_id = block_ids
            .get(&row.id)
            .ok_or_else(|| "duplicated page block id is missing".to_string())?;
        let (parent_type, parent_page_id, parent_block_id) = if row.parent_type == "page_id" {
            ("page_id", Some(plan.duplicate_id.clone()), None)
        } else {
            let source_parent_id = row
                .parent_block_id
                .as_ref()
                .ok_or_else(|| "duplicated block is missing its parent".to_string())?;
            let duplicate_parent_id = block_ids
                .get(source_parent_id)
                .cloned()
                .ok_or_else(|| "duplicated block parent id is missing".to_string())?;
            ("block_id", None, Some(duplicate_parent_id))
        };
        let (payload, plain_text) = if row.block_type == "child_page" {
            let title = duplicate_titles
                .get(&row.id)
                .ok_or_else(|| "duplicated child page title is missing".to_string())?;
            let payload = child_page_payload(title);
            (
                payload.to_string(),
                plain_text_from_payload("child_page", &payload),
            )
        } else {
            (row.payload.clone(), row.plain_text.clone())
        };
        validate_sort_order(row.sort_order)?;
        sqlx::query(
            "INSERT INTO notes_blocks (
                id,
                page_id,
                parent_type,
                parent_page_id,
                parent_block_id,
                has_children,
                type,
                payload,
                plain_text,
                sort_order
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(duplicate_id)
        .bind(&plan.duplicate_id)
        .bind(parent_type)
        .bind(parent_page_id)
        .bind(parent_block_id)
        .bind(row.has_children)
        .bind(&row.block_type)
        .bind(payload)
        .bind(plain_text)
        .bind(row.sort_order)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("duplicate notes page block: {e}"))?;
        inserted_block_ids.insert(duplicate_id.clone());
    }
    Ok(())
}
