use super::block_comments::duplicate_block_comment_threads;
use super::block_tree::{
    load_block_subtree_rows, load_block_subtree_rows_with_trash, load_blocks_by_ids,
    normalize_selection_root_ids, refresh_duplicated_has_children,
};
use super::parents::{
    ParentTarget, refresh_parent_has_children, resolve_block_parent, touch_page,
    validate_block_for_parent,
};
use super::sort::{next_sort_orders, sort_orders_before};
use crate::notes::models::{
    NoteBlockDto, NoteDuplicateBlock, NoteDuplicateBlocks, NoteDuplicatedBlockId,
    NotePaginatedBlockList,
};
use crate::notes::validation::{
    require_uuid, validate_duplicate_block_count, validate_parent, validate_sort_order,
};
use crate::notes::{history, project_history, reads};
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};

pub async fn duplicate_block(
    pool: &SqlitePool,
    block_id: &str,
    request: NoteDuplicateBlock,
) -> Result<NoteBlockDto, String> {
    let block_id = block_id.trim();
    require_uuid(block_id, "block_id")?;
    let source = reads::get_block_row(pool, block_id, false).await?;
    project_history::ensure_page_baseline_for_mutation(pool, &source.page_id).await?;
    validate_duplicate_block_count(request.duplicated_block_ids.len())?;
    let mut duplicate_ids = HashMap::with_capacity(request.duplicated_block_ids.len());
    let mut seen_duplicate_ids = HashSet::with_capacity(request.duplicated_block_ids.len());
    for pair in request.duplicated_block_ids {
        let source_id = pair.source_id.trim().to_string();
        let duplicate_id = pair.duplicate_id.trim().to_string();
        require_uuid(&source_id, "source_id")?;
        require_uuid(&duplicate_id, "duplicate_id")?;
        if !seen_duplicate_ids.insert(duplicate_id.clone()) {
            return Err("duplicate_id values must be unique".to_string());
        }
        if duplicate_ids.insert(source_id, duplicate_id).is_some() {
            return Err("source_id values must be unique".to_string());
        }
    }
    let duplicate_root_id = duplicate_ids
        .get(block_id)
        .cloned()
        .ok_or_else(|| "duplicated_block_ids must include the source block".to_string())?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin duplicate notes block: {e}"))?;
    let source_rows = load_block_subtree_rows(&mut tx, block_id).await?;
    if source_rows.is_empty() {
        return Err("notes block not found".to_string());
    }
    if source_rows
        .first()
        .map(|row| row.block_type.as_str())
        .is_some_and(|block_type| block_type == "child_page")
    {
        return Err("child_page blocks must be duplicated through page duplication".to_string());
    }
    if source_rows.len() != duplicate_ids.len() {
        return Err("duplicated_block_ids must match the source block subtree".to_string());
    }
    let source_id_set = source_rows
        .iter()
        .map(|row| row.id.as_str())
        .collect::<HashSet<_>>();
    for source_id in duplicate_ids.keys() {
        if !source_id_set.contains(source_id.as_str()) {
            return Err("duplicated_block_ids must match the source block subtree".to_string());
        }
    }
    for duplicate_id in &seen_duplicate_ids {
        if source_id_set.contains(duplicate_id.as_str()) {
            return Err("duplicate_id values must not match source_id values".to_string());
        }
    }
    let source_root = source_rows
        .first()
        .ok_or_else(|| "notes block not found".to_string())?;
    let root_parent = ParentTarget {
        parent_type: if source_root.parent_type == "page_id" {
            "page_id"
        } else {
            "block_id"
        },
        parent_page_id: source_root.parent_page_id.clone(),
        parent_block_id: source_root.parent_block_id.clone(),
        parent_block_type: None,
        page_id: source_root.page_id.clone(),
    };
    let root_sort_order =
        next_sort_orders(&mut tx, &root_parent, Some(source_root.id.as_str()), 1).await?[0];
    history::record_page_snapshot_tx(&mut tx, &source_root.page_id, "duplicate_block").await?;
    for row in &source_rows {
        let duplicate_id = duplicate_ids.get(&row.id).ok_or_else(|| {
            "duplicated_block_ids must match the source block subtree".to_string()
        })?;
        let (parent_type, parent_page_id, parent_block_id, sort_order) =
            if row.id == source_root.id {
                (
                    root_parent.parent_type,
                    root_parent.parent_page_id.clone(),
                    root_parent.parent_block_id.clone(),
                    root_sort_order,
                )
            } else {
                let source_parent_id = row.parent_block_id.as_ref().ok_or_else(|| {
                    "duplicated descendant block is missing its parent".to_string()
                })?;
                let duplicate_parent_id = duplicate_ids.get(source_parent_id).ok_or_else(|| {
                    "duplicated_block_ids must include every descendant parent".to_string()
                })?;
                (
                    "block_id",
                    None,
                    Some(duplicate_parent_id.clone()),
                    row.sort_order,
                )
            };
        validate_sort_order(sort_order)?;
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
        .bind(&source_root.page_id)
        .bind(parent_type)
        .bind(parent_page_id)
        .bind(parent_block_id)
        .bind(row.has_children)
        .bind(&row.block_type)
        .bind(&row.payload)
        .bind(&row.plain_text)
        .bind(sort_order)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("duplicate notes block: {e}"))?;
    }
    refresh_duplicated_has_children(&mut tx, &seen_duplicate_ids).await?;
    duplicate_block_comment_threads(&mut tx, &duplicate_ids, &source_root.page_id).await?;
    touch_page(&mut tx, &source_root.page_id).await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit duplicate notes block: {e}"))?;
    reads::get_block(pool, &duplicate_root_id, false).await
}

pub async fn duplicate_blocks(
    pool: &SqlitePool,
    request: NoteDuplicateBlocks,
) -> Result<NotePaginatedBlockList, String> {
    validate_parent(&request.parent)?;
    project_history::ensure_blocks_baseline_for_mutation(pool, &request.block_ids).await?;
    project_history::ensure_parent_baseline_for_mutation(pool, &request.parent).await?;
    if request.after.is_some() && request.before.is_some() {
        return Err("duplicate request cannot include both after and before".to_string());
    }
    validate_duplicate_block_count(request.duplicated_block_ids.len())?;
    let (duplicate_ids, seen_duplicate_ids) = duplicate_block_id_map(request.duplicated_block_ids)?;
    let include_trashed_sources = request.include_trashed_sources.unwrap_or(false);
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin duplicate notes blocks: {e}"))?;
    let root_ids =
        normalize_selection_root_ids(&mut tx, &request.block_ids, include_trashed_sources).await?;
    let destination_parent = resolve_block_parent(&mut tx, &request.parent).await?;
    let mut source_rows = Vec::new();
    let mut root_rows = Vec::with_capacity(root_ids.len());
    for block_id in &root_ids {
        let subtree_rows =
            load_block_subtree_rows_with_trash(&mut tx, block_id, include_trashed_sources).await?;
        let source_root = subtree_rows
            .first()
            .ok_or_else(|| "notes block not found".to_string())?;
        if source_root.block_type == "child_page" {
            return Err(
                "child_page blocks must be duplicated through page duplication".to_string(),
            );
        }
        let payload: Value = serde_json::from_str(&source_root.payload)
            .map_err(|e| format!("parse duplicated block payload: {e}"))?;
        validate_block_for_parent(&destination_parent, &source_root.block_type, &payload)?;
        root_rows.push(source_root.clone());
        source_rows.extend(subtree_rows);
    }
    if source_rows.len() != duplicate_ids.len() {
        return Err("duplicated_block_ids must match the source block subtrees".to_string());
    }
    let source_id_set = source_rows
        .iter()
        .map(|row| row.id.as_str())
        .collect::<HashSet<_>>();
    for source_id in duplicate_ids.keys() {
        if !source_id_set.contains(source_id.as_str()) {
            return Err("duplicated_block_ids must match the source block subtrees".to_string());
        }
    }
    for duplicate_id in &seen_duplicate_ids {
        if source_id_set.contains(duplicate_id.as_str()) {
            return Err("duplicate_id values must not match source_id values".to_string());
        }
    }
    let root_id_set = root_ids.iter().map(String::as_str).collect::<HashSet<_>>();
    let root_sort_orders = if let Some(before) = request.before.as_deref() {
        sort_orders_before(&mut tx, &destination_parent, before, root_rows.len()).await?
    } else {
        next_sort_orders(
            &mut tx,
            &destination_parent,
            request.after.as_deref(),
            root_rows.len(),
        )
        .await?
    };
    let root_sort_order_by_source = root_rows
        .iter()
        .zip(root_sort_orders)
        .map(|(row, sort_order)| (row.id.as_str(), sort_order))
        .collect::<HashMap<_, _>>();
    history::record_page_snapshot_tx(&mut tx, &destination_parent.page_id, "duplicate_blocks")
        .await?;
    for row in &source_rows {
        let duplicate_id = duplicate_ids.get(&row.id).ok_or_else(|| {
            "duplicated_block_ids must match the source block subtrees".to_string()
        })?;
        let (parent_type, parent_page_id, parent_block_id, sort_order) =
            if root_id_set.contains(row.id.as_str()) {
                (
                    destination_parent.parent_type,
                    destination_parent.parent_page_id.clone(),
                    destination_parent.parent_block_id.clone(),
                    *root_sort_order_by_source
                        .get(row.id.as_str())
                        .ok_or_else(|| "duplicated root sort order is missing".to_string())?,
                )
            } else {
                let source_parent_id = row.parent_block_id.as_ref().ok_or_else(|| {
                    "duplicated descendant block is missing its parent".to_string()
                })?;
                let duplicate_parent_id = duplicate_ids.get(source_parent_id).ok_or_else(|| {
                    "duplicated_block_ids must include every descendant parent".to_string()
                })?;
                (
                    "block_id",
                    None,
                    Some(duplicate_parent_id.clone()),
                    row.sort_order,
                )
            };
        validate_sort_order(sort_order)?;
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
        .bind(&destination_parent.page_id)
        .bind(parent_type)
        .bind(parent_page_id)
        .bind(parent_block_id)
        .bind(row.has_children)
        .bind(&row.block_type)
        .bind(&row.payload)
        .bind(&row.plain_text)
        .bind(sort_order)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("duplicate notes block: {e}"))?;
    }
    refresh_duplicated_has_children(&mut tx, &seen_duplicate_ids).await?;
    duplicate_block_comment_threads(&mut tx, &duplicate_ids, &destination_parent.page_id).await?;
    refresh_parent_has_children(&mut tx, &destination_parent).await?;
    touch_page(&mut tx, &destination_parent.page_id).await?;
    tx.commit()
        .await
        .map_err(|e| format!("commit duplicate notes blocks: {e}"))?;
    let all_duplicate_ids = source_rows
        .iter()
        .map(|row| {
            duplicate_ids
                .get(&row.id)
                .cloned()
                .ok_or_else(|| "duplicated block id is missing".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    load_blocks_by_ids(pool, all_duplicate_ids).await
}

pub(super) fn duplicate_block_id_map(
    pairs: Vec<NoteDuplicatedBlockId>,
) -> Result<(HashMap<String, String>, HashSet<String>), String> {
    let mut duplicate_ids = HashMap::with_capacity(pairs.len());
    let mut seen_duplicate_ids = HashSet::with_capacity(pairs.len());
    for pair in pairs {
        let source_id = pair.source_id.trim().to_string();
        let duplicate_id = pair.duplicate_id.trim().to_string();
        require_uuid(&source_id, "source_id")?;
        require_uuid(&duplicate_id, "duplicate_id")?;
        if !seen_duplicate_ids.insert(duplicate_id.clone()) {
            return Err("duplicate_id values must be unique".to_string());
        }
        if duplicate_ids.insert(source_id, duplicate_id).is_some() {
            return Err("source_id values must be unique".to_string());
        }
    }
    Ok((duplicate_ids, seen_duplicate_ids))
}
