use crate::models::{
    NoteMentionNotificationDeliveryUpdate, NoteMentionNotificationDto, NoteMentionNotificationRow,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{QueryBuilder, Sqlite, SqlitePool, Transaction};

const MAX_NOTIFICATION_BATCH: usize = 200;
const MAX_PLAIN_TEXT_LENGTH: usize = 500;
const MAX_SOURCE_TEXT_LENGTH: usize = 2000;

struct MentionNotificationCandidate {
    kind: &'static str,
    target_type: &'static str,
    target_id: Option<String>,
    trigger_at: Option<String>,
    plain_text: String,
    fingerprint: String,
}

pub async fn list_pending(pool: &SqlitePool) -> Result<Vec<NoteMentionNotificationDto>, String> {
    let rows = active_pending_notification_rows(pool)
        .await?
        .into_iter()
        .map(NoteMentionNotificationDto::new)
        .collect();
    Ok(rows)
}

pub async fn mark_delivered(
    pool: &SqlitePool,
    request: NoteMentionNotificationDeliveryUpdate,
) -> Result<Vec<NoteMentionNotificationDto>, String> {
    if request.ids.len() > MAX_NOTIFICATION_BATCH {
        return Err("too many mention notifications to mark delivered at once".to_string());
    }
    let mut ids = Vec::with_capacity(request.ids.len());
    for id in request.ids {
        let id = id.trim().to_string();
        if id.is_empty() || id.len() > 128 || contains_control_characters(&id) {
            return Err("mention notification id is invalid".to_string());
        }
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    if ids.is_empty() {
        return list_pending(pool).await;
    }

    let mut query = QueryBuilder::<Sqlite>::new(
        "UPDATE notes_mention_notifications
         SET status = 'delivered',
             delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE status = 'pending'
           AND suppressed_by_history_restore = 0
           AND id IN (",
    );
    let mut separated = query.separated(", ");
    for id in &ids {
        separated.push_bind(id);
    }
    query.push(")");
    query
        .build()
        .execute(pool)
        .await
        .map_err(|e| format!("mark notes mention notifications delivered: {e}"))?;

    list_pending(pool).await
}

pub async fn refresh_all(pool: &SqlitePool) -> Result<i64, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("begin notes mention notification refresh: {e}"))?;
    let deleted = sqlx::query(
        "DELETE FROM notes_mention_notifications
         WHERE status = 'pending'
           AND suppressed_by_history_restore = 0",
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("clear pending notes mention notifications: {e}"))?
    .rows_affected() as i64;

    let block_rows = sqlx::query_as::<_, (String, String, String, String, String)>(
        "SELECT block.id, block.page_id, block.type, block.payload, block.plain_text
         FROM notes_blocks AS block
         JOIN notes_pages AS page ON page.id = block.page_id
         WHERE block.in_trash = 0
           AND page.in_trash = 0
           AND page.archived = 0",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| format!("load notes blocks for mention notification refresh: {e}"))?;
    for (block_id, page_id, block_type, payload, plain_text) in block_rows {
        let payload = serde_json::from_str::<Value>(&payload)
            .map_err(|e| format!("parse notes block payload for notification refresh: {e}"))?;
        sync_block_tx(
            &mut tx,
            &block_id,
            &page_id,
            &block_type,
            &payload,
            &plain_text,
        )
        .await?;
    }

    let comment_rows = sqlx::query_as::<_, (String, String, String, String, Option<String>)>(
        "SELECT comment.id,
                thread.page_id,
                comment.rich_text,
                comment.plain_text,
                thread.parent_block_id
         FROM notes_comments AS comment
         JOIN notes_comment_threads AS thread ON thread.id = comment.thread_id
         JOIN notes_pages AS page ON page.id = thread.page_id
         WHERE comment.deleted_at IS NULL
           AND thread.status = 'open'
           AND page.in_trash = 0
           AND page.archived = 0
           AND (
               thread.parent_type = 'page_id'
               OR EXISTS (
                   SELECT 1
                   FROM notes_blocks AS block
                   WHERE block.id = thread.parent_block_id
                     AND block.in_trash = 0
               )
           )",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| format!("load notes comments for mention notification refresh: {e}"))?;
    for (comment_id, page_id, rich_text, plain_text, block_id) in comment_rows {
        let rich_text = serde_json::from_str::<Vec<Value>>(&rich_text)
            .map_err(|e| format!("parse notes comment rich text for notification refresh: {e}"))?;
        sync_comment_tx(
            &mut tx,
            &comment_id,
            &page_id,
            block_id.as_deref(),
            &rich_text,
            &plain_text,
        )
        .await?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("commit notes mention notification refresh: {e}"))?;
    Ok(deleted)
}

pub async fn sync_block_tx(
    tx: &mut Transaction<'_, Sqlite>,
    block_id: &str,
    page_id: &str,
    _block_type: &str,
    payload: &Value,
    source_plain_text: &str,
) -> Result<(), String> {
    let mut rich_text_arrays = Vec::new();
    collect_rich_text_arrays(payload, &mut rich_text_arrays);
    let candidates = candidates_from_rich_text_arrays(rich_text_arrays, source_plain_text);
    replace_source_candidates(
        tx,
        SourceTarget {
            source_type: "block",
            source_id: block_id,
            page_id,
            block_id: Some(block_id),
            comment_id: None,
            source_plain_text,
        },
        candidates,
    )
    .await
}

pub async fn sync_comment_tx(
    tx: &mut Transaction<'_, Sqlite>,
    comment_id: &str,
    page_id: &str,
    block_id: Option<&str>,
    rich_text: &[Value],
    source_plain_text: &str,
) -> Result<(), String> {
    let candidates = candidates_from_rich_text_arrays(vec![rich_text], source_plain_text);
    replace_source_candidates(
        tx,
        SourceTarget {
            source_type: "comment",
            source_id: comment_id,
            page_id,
            block_id,
            comment_id: Some(comment_id),
            source_plain_text,
        },
        candidates,
    )
    .await
}

pub async fn clear_source_tx(
    tx: &mut Transaction<'_, Sqlite>,
    source_type: &str,
    source_id: &str,
) -> Result<(), String> {
    sqlx::query(
        "DELETE FROM notes_mention_notifications
         WHERE source_type = ?
           AND source_id = ?
           AND status = 'pending'
           AND suppressed_by_history_restore = 0",
    )
    .bind(source_type)
    .bind(source_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("clear notes mention notifications for source: {e}"))?;
    Ok(())
}

struct SourceTarget<'a> {
    source_type: &'a str,
    source_id: &'a str,
    page_id: &'a str,
    block_id: Option<&'a str>,
    comment_id: Option<&'a str>,
    source_plain_text: &'a str,
}

async fn replace_source_candidates(
    tx: &mut Transaction<'_, Sqlite>,
    source: SourceTarget<'_>,
    candidates: Vec<MentionNotificationCandidate>,
) -> Result<(), String> {
    clear_source_tx(tx, source.source_type, source.source_id).await?;
    let source_plain_text = truncate_chars(source.source_plain_text, MAX_SOURCE_TEXT_LENGTH);
    for candidate in candidates {
        let id = notification_id(source.source_type, source.source_id, &candidate.fingerprint);
        sqlx::query(
            "INSERT INTO notes_mention_notifications (
                id,
                source_type,
                source_id,
                page_id,
                block_id,
                comment_id,
                kind,
                target_type,
                target_id,
                trigger_at,
                plain_text,
                source_plain_text,
                fingerprint
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(source_type, source_id, fingerprint)
             DO UPDATE SET
                page_id = excluded.page_id,
                block_id = excluded.block_id,
                comment_id = excluded.comment_id,
                target_id = excluded.target_id,
                trigger_at = excluded.trigger_at,
                plain_text = excluded.plain_text,
                source_plain_text = excluded.source_plain_text,
                last_edited_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        )
        .bind(id)
        .bind(source.source_type)
        .bind(source.source_id)
        .bind(source.page_id)
        .bind(source.block_id)
        .bind(source.comment_id)
        .bind(candidate.kind)
        .bind(candidate.target_type)
        .bind(candidate.target_id)
        .bind(candidate.trigger_at)
        .bind(candidate.plain_text)
        .bind(&source_plain_text)
        .bind(candidate.fingerprint)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("upsert notes mention notification: {e}"))?;
    }
    Ok(())
}

async fn active_pending_notification_rows(
    pool: &SqlitePool,
) -> Result<Vec<NoteMentionNotificationRow>, String> {
    sqlx::query_as::<_, NoteMentionNotificationRow>(
        "SELECT notification.*,
                page.title AS page_title
         FROM notes_mention_notifications AS notification
         JOIN notes_pages AS page ON page.id = notification.page_id
         WHERE notification.status = 'pending'
           AND notification.suppressed_by_history_restore = 0
           AND page.in_trash = 0
           AND page.archived = 0
           AND (
               (
                   notification.source_type = 'block'
                   AND EXISTS (
                       SELECT 1
                       FROM notes_blocks AS block
                       WHERE block.id = notification.block_id
                         AND block.in_trash = 0
                   )
               )
               OR (
                   notification.source_type = 'comment'
                   AND EXISTS (
                       SELECT 1
                       FROM notes_comments AS comment
                       JOIN notes_comment_threads AS thread
                         ON thread.id = comment.thread_id
                       WHERE comment.id = notification.comment_id
                         AND comment.deleted_at IS NULL
                         AND thread.status = 'open'
                         AND (
                             thread.parent_type = 'page_id'
                             OR EXISTS (
                                 SELECT 1
                                 FROM notes_blocks AS block
                                 WHERE block.id = thread.parent_block_id
                                   AND block.in_trash = 0
                             )
                         )
                   )
               )
           )
         ORDER BY notification.trigger_at IS NULL DESC,
                  notification.trigger_at ASC,
                  notification.created_time ASC,
                  notification.id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("list pending notes mention notifications: {e}"))
}

fn collect_rich_text_arrays<'a>(value: &'a Value, arrays: &mut Vec<&'a [Value]>) {
    match value {
        Value::Object(record) => {
            if let Some(Value::Array(items)) = record.get("rich_text") {
                arrays.push(items);
            }
            for child in record.values() {
                collect_rich_text_arrays(child, arrays);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_rich_text_arrays(child, arrays);
            }
        }
        _ => {}
    }
}

fn candidates_from_rich_text_arrays(
    arrays: Vec<&[Value]>,
    source_plain_text: &str,
) -> Vec<MentionNotificationCandidate> {
    let mut candidates = Vec::new();
    let mut mention_index = 0_usize;
    for items in arrays {
        for item in items {
            let Some(candidate) = candidate_from_rich_text_item(item, mention_index) else {
                continue;
            };
            mention_index += 1;
            if !source_plain_text.trim().is_empty() || candidate.kind == "reminder" {
                candidates.push(candidate);
            }
        }
    }
    candidates
}

fn candidate_from_rich_text_item(
    item: &Value,
    index: usize,
) -> Option<MentionNotificationCandidate> {
    let mention = item.get("mention")?.as_object()?;
    let mention_type = mention.get("type")?.as_str()?;
    let plain_text = truncate_chars(
        item.get("plain_text").and_then(Value::as_str).unwrap_or(""),
        MAX_PLAIN_TEXT_LENGTH,
    );
    match mention_type {
        "date" => {
            let date = mention.get("date")?.as_object()?;
            let reminder_enabled = date
                .get("ganbaru_reminder")
                .and_then(Value::as_object)
                .and_then(|reminder| reminder.get("enabled"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !reminder_enabled {
                return None;
            }
            let start = date.get("start")?.as_str()?.trim();
            if start.is_empty() {
                return None;
            }
            Some(MentionNotificationCandidate {
                kind: "reminder",
                target_type: "date",
                target_id: None,
                trigger_at: Some(start.to_string()),
                plain_text,
                fingerprint: format!("reminder:{index}:{start}"),
            })
        }
        "user" => {
            let id = mention
                .get("user")?
                .as_object()?
                .get("id")?
                .as_str()?
                .trim()
                .to_string();
            if id.is_empty() {
                return None;
            }
            Some(MentionNotificationCandidate {
                kind: "user_mention",
                target_type: "user",
                target_id: Some(id.clone()),
                trigger_at: None,
                plain_text,
                fingerprint: format!("user:{index}:{id}"),
            })
        }
        "ganbaru_object" => {
            let object = mention.get("ganbaru_object")?.as_object()?;
            if object.get("type")?.as_str()? != "project_task" {
                return None;
            }
            let id = object.get("id")?.as_str()?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            Some(MentionNotificationCandidate {
                kind: "task_mention",
                target_type: "project_task",
                target_id: Some(id.clone()),
                trigger_at: None,
                plain_text,
                fingerprint: format!("project_task:{index}:{id}"),
            })
        }
        _ => None,
    }
}

fn notification_id(source_type: &str, source_id: &str, fingerprint: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"notes-mention-notification\0");
    hasher.update(source_type.as_bytes());
    hasher.update(b"\0");
    hasher.update(source_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(fingerprint.as_bytes());
    hex_hash(&hasher.finalize())
}

fn hex_hash(bytes: &[u8]) -> String {
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push_str(&format!("{byte:02x}"));
    }
    value
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn contains_control_characters(value: &str) -> bool {
    value.chars().any(|character| {
        let code_point = character as u32;
        code_point < 32
    })
}
