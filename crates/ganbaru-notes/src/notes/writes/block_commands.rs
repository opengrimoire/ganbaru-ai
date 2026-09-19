use super::block_tree::{
    load_block_row_in_tx, load_blocks_by_ids, load_blocks_by_ids_with_trash,
    normalize_selection_root_ids, set_block_subtree_trash,
};
use super::parents::{
    ParentTarget, insert_block, parent_target_from_block_row, refresh_parent_has_children,
    resolve_block_parent, touch_page, validate_block_update_children, validate_block_update_parent,
    validate_children_for_parent,
};
use super::payloads::page_title_properties;
use super::sort::next_sort_orders;
use crate::notes::models::{
    NoteAppendBlockChildren, NoteBlockDto, NoteBlockUpdate, NotePaginatedBlockList, NoteTrashBlocks,
};
use crate::notes::validation::{
    plain_text_from_payload, require_uuid, validate_block_update, validate_block_write,
    validate_children_count, validate_parent,
};
use crate::notes::{assets, history, mention_notifications, project_history, reads};
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::HashSet;

pub async fn append_block_children(
    pool: &SqlitePool,
    request: NoteAppendBlockChildren,
) -> Result<NotePaginatedBlockList, String> {
    validate_parent(&request.parent)?;
    validate_children_count(request.children.len())?;
    for child in &request.children {
        validate_block_write(child)?;
    }
    project_history::ensure_parent_baseline_for_mutation(pool, &request.parent).await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin append notes blocks: {e}"))?;
    let parent = resolve_block_parent(&mut tx, &request.parent).await?;
    validate_children_for_parent(&parent, &request.children)?;
    let sort_orders = next_sort_orders(
        &mut tx,
        &parent,
        request.after.as_deref(),
        request.children.len(),
    )
    .await?;
    history::record_page_snapshot_tx(&mut tx, &parent.page_id, "append_block_children").await?;
    let mut inserted_ids = Vec::with_capacity(request.children.len());
    for (child, sort_order) in request.children.iter().zip(sort_orders) {
        insert_block(&mut tx, &parent, child, sort_order).await?;
        inserted_ids.push(child.id.trim().to_string());
    }
    refresh_parent_has_children(&mut tx, &parent).await?;
    touch_page(&mut tx, &parent.page_id).await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit append notes blocks: {e}"))?;
    load_blocks_by_ids(pool, inserted_ids).await
}

pub async fn update_block(
    pool: &SqlitePool,
    block_id: &str,
    update: NoteBlockUpdate,
) -> Result<NoteBlockDto, String> {
    let block_id = block_id.trim();
    require_uuid(block_id, "block_id")?;
    let current = reads::get_block_row(pool, block_id, false).await?;
    project_history::ensure_page_baseline_for_mutation(pool, &current.page_id).await?;
    let (block_type, payload) = validate_block_update(&current.block_type, &update)?;
    validate_block_update_parent(pool, &current, &block_type, &payload).await?;
    validate_block_update_children(pool, block_id, &current.block_type, &block_type, &payload)
        .await?;
    let plain_text = plain_text_from_payload(&block_type, &payload);
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin update notes block: {e}"))?;
    history::record_page_snapshot_tx(&mut tx, &current.page_id, "update_block").await?;
    let result = sqlx::query(
        "UPDATE notes_blocks
         SET type = ?,
             payload = ?,
             plain_text = ?,
             last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND in_trash = 0",
    )
    .bind(&block_type)
    .bind(payload.to_string())
    .bind(&plain_text)
    .bind(block_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("update notes block: {e}"))?;
    if result.rows_affected() == 0 {
        return Err("notes block not found".to_string());
    }
    if block_type == "child_page" {
        let title = payload
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default();
        sqlx::query(
            "UPDATE notes_pages
             SET title = ?,
                 properties = ?,
                 last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?",
        )
        .bind(title)
        .bind(page_title_properties(title).to_string())
        .bind(block_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("update child page title from block: {e}"))?;
    }
    mention_notifications::sync_block_tx(
        &mut tx,
        block_id,
        &current.page_id,
        &block_type,
        &payload,
        &plain_text,
    )
    .await?;
    assets::sync_block_asset_reference_tx(
        &mut tx,
        block_id,
        &current.page_id,
        &block_type,
        &payload,
    )
    .await?;
    touch_page(&mut tx, &current.page_id).await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit update notes block: {e}"))?;
    reads::get_block(pool, block_id, false).await
}

pub async fn trash_block(
    pool: &SqlitePool,
    block_id: &str,
    in_trash: bool,
) -> Result<NoteBlockDto, String> {
    let block_id = block_id.trim();
    require_uuid(block_id, "block_id")?;
    let current = reads::get_block_row(pool, block_id, true).await?;
    project_history::ensure_page_baseline_for_mutation(pool, &current.page_id).await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin trash notes block: {e}"))?;
    history::record_page_snapshot_tx(&mut tx, &current.page_id, "trash_block").await?;
    set_block_subtree_trash(&mut tx, block_id, in_trash).await?;
    let parent = ParentTarget {
        parent_type: if current.parent_type == "page_id" {
            "page_id"
        } else {
            "block_id"
        },
        parent_page_id: current.parent_page_id.clone(),
        parent_block_id: current.parent_block_id.clone(),
        parent_block_type: None,
        page_id: current.page_id.clone(),
    };
    refresh_parent_has_children(&mut tx, &parent).await?;
    touch_page(&mut tx, &current.page_id).await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit trash notes block: {e}"))?;
    reads::get_block(pool, block_id, true).await
}

pub async fn trash_blocks(
    pool: &SqlitePool,
    request: NoteTrashBlocks,
) -> Result<NotePaginatedBlockList, String> {
    project_history::ensure_blocks_baseline_for_mutation(pool, &request.block_ids).await?;
    let in_trash = request.in_trash.unwrap_or(true);
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin trash notes blocks: {e}"))?;
    let root_ids = normalize_selection_root_ids(&mut tx, &request.block_ids, true).await?;
    let mut root_rows = Vec::with_capacity(root_ids.len());
    let mut parents = Vec::with_capacity(root_ids.len());
    let mut touched_pages = HashSet::new();
    for block_id in &root_ids {
        let row = load_block_row_in_tx(&mut tx, block_id, true).await?;
        parents.push(parent_target_from_block_row(&row));
        touched_pages.insert(row.page_id.clone());
        root_rows.push(row);
    }
    for page_id in &touched_pages {
        history::record_page_snapshot_tx(&mut tx, page_id, "trash_blocks").await?;
    }
    for block_id in &root_ids {
        set_block_subtree_trash(&mut tx, block_id, in_trash).await?;
    }
    for parent in &parents {
        refresh_parent_has_children(&mut tx, parent).await?;
    }
    for page_id in &touched_pages {
        touch_page(&mut tx, page_id).await?;
    }
    tx.commit()
        .await
        .map_err(|e| format!("commit trash notes blocks: {e}"))?;
    load_blocks_by_ids_with_trash(
        pool,
        root_rows.into_iter().map(|row| row.id).collect(),
        true,
    )
    .await
}
