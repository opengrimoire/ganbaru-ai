//! Public lifecycle commands for private organizational scratch storage.

use super::channel_commands::{
    chat_pool, i64_value, identifier_error, now_timestamp, persistence_error, timestamp, u64_value,
};
use super::coordination::contracts::*;
use super::device_state::update_active_device_scope;
use super::models::*;
use super::repository::attachments::{self, AttachmentBytesImport, ChatAttachmentKind};
use super::scratch;
use super::workspace::WorkingFolderAuthorizationOperation;
use crate::vault;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::path::{Component, Path};

const LOCAL_PARTICIPANT_ID: &str = "participant:local-owner";
const MAX_RELATIVE_PATH_BYTES: usize = 4_096;
const DEFAULT_DIRECTORY_PAGE_SIZE: u32 = 20;
const MAX_DIRECTORY_PAGE_SIZE: u32 = 50;
const MAX_PROMOTION_BYTES: u64 = 50 * 1024 * 1024;
const MAX_PAGE_REVISION_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SIZE_ENTRIES: u64 = 10_000;
const MAX_SIZE_BYTES: u64 = 1024 * 1024 * 1024;

struct ScratchIdentity {
    scope_id: ChatScratchScopeId,
    scope_revision: u64,
    scope_lifecycle: ChatScratchScopeLifecycleState,
    conversation_id: ChatConversationId,
    teammate_id: ChatParticipantId,
    generation_id: ChatScratchGenerationId,
    generation_lifecycle: ChatScratchGenerationLifecycleState,
    execution_environment_id: ChatExecutionEnvironmentId,
}

struct ScratchFile {
    bytes: Vec<u8>,
    content_revision: String,
    sha256: String,
}

#[tauri::command]
pub async fn chat_list_scratch_scopes(
    app: tauri::AppHandle,
    db_url: String,
    teammate_id: Option<ChatParticipantId>,
    reply_thread_id: Option<ChatReplyThreadId>,
) -> ChatResult<Vec<ChatScratchScopeRead>> {
    let pool = chat_pool(app.clone(), db_url).await?;
    require_local_owner(&pool).await?;
    let rows = sqlx::query(
        "SELECT scope.id, scope.reply_thread_id, scope.teammate_id,
                teammate.display_name AS teammate_name,
                channel.id AS channel_id, channel.name AS channel_name,
                project.id AS project_id, project.name AS project_name,
                project_group.id AS group_id, project_group.name AS group_name,
                scope.lifecycle_state, scope.revision, scope.created_at, scope.updated_at
         FROM chat_scratch_scopes scope
         JOIN chat_participants teammate ON teammate.id = scope.teammate_id
         JOIN chat_reply_threads thread ON thread.id = scope.reply_thread_id
         JOIN chat_channels channel ON channel.conversation_id = thread.conversation_id
         JOIN projects project ON project.id = channel.project_id
         JOIN project_groups project_group ON project_group.id = project.group_id
         WHERE scope.removed_at IS NULL
           AND (? IS NULL OR scope.teammate_id = ?)
           AND (? IS NULL OR scope.reply_thread_id = ?)
         ORDER BY scope.updated_at DESC, scope.id",
    )
    .bind(teammate_id.as_ref().map(ChatParticipantId::as_str))
    .bind(teammate_id.as_ref().map(ChatParticipantId::as_str))
    .bind(reply_thread_id.as_ref().map(ChatReplyThreadId::as_str))
    .bind(reply_thread_id.as_ref().map(ChatReplyThreadId::as_str))
    .fetch_all(&pool)
    .await
    .map_err(persistence_error)?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let scope_id =
            parse_id::<ChatScratchScopeId>(row.try_get("id").map_err(persistence_error)?)?;
        result.push(ChatScratchScopeRead {
            generations: read_scope_generations(&app, &pool, &scope_id).await?,
            id: scope_id,
            reply_thread_id: parse_id(row.try_get("reply_thread_id").map_err(persistence_error)?)?,
            teammate_id: parse_id(row.try_get("teammate_id").map_err(persistence_error)?)?,
            teammate_name: row.try_get("teammate_name").map_err(persistence_error)?,
            channel_id: parse_id(row.try_get("channel_id").map_err(persistence_error)?)?,
            channel_name: row.try_get("channel_name").map_err(persistence_error)?,
            project_id: row.try_get("project_id").map_err(persistence_error)?,
            project_name: row.try_get("project_name").map_err(persistence_error)?,
            group_id: row.try_get("group_id").map_err(persistence_error)?,
            group_name: row.try_get("group_name").map_err(persistence_error)?,
            lifecycle_state: parse_scope_lifecycle(
                &row.try_get::<String, _>("lifecycle_state")
                    .map_err(persistence_error)?,
            )?,
            revision: u64_value(row.try_get("revision").map_err(persistence_error)?)?,
            created_at: timestamp(row.try_get("created_at").map_err(persistence_error)?)?,
            updated_at: timestamp(row.try_get("updated_at").map_err(persistence_error)?)?,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn chat_browse_scratch_generation(
    app: tauri::AppHandle,
    db_url: String,
    request: BrowseChatScratchGenerationCommand,
) -> ChatResult<ChatScratchDirectoryPageRead> {
    validate_optional_relative_path(&request.relative_path)?;
    let pool = chat_pool(app.clone(), db_url).await?;
    require_local_owner(&pool).await?;
    let identity = read_scratch_identity(&pool, &request.scratch_generation_id).await?;
    require_scratch_inspection_authority(&pool, &identity, request.allow_restricted_inspection)
        .await?;
    let root = scratch::resolve_managed_scratch_path_for_inspection(
        &app,
        &pool,
        identity.generation_id.as_str(),
        identity.execution_environment_id.as_str(),
    )
    .await?;
    let mut entries = read_directory_entries(&root, &request.relative_path)?;
    entries.sort_by(|left, right| {
        entry_kind_rank(left.kind)
            .cmp(&entry_kind_rank(right.kind))
            .then_with(|| {
                left.display_name
                    .to_lowercase()
                    .cmp(&right.display_name.to_lowercase())
            })
            .then_with(|| left.display_name.cmp(&right.display_name))
    });
    let start = cursor_start(&entries, request.cursor.as_deref())?;
    let requested_limit = if request.limit == 0 {
        DEFAULT_DIRECTORY_PAGE_SIZE
    } else {
        request.limit.min(MAX_DIRECTORY_PAGE_SIZE)
    };
    let limit = usize::try_from(requested_limit).unwrap_or(DEFAULT_DIRECTORY_PAGE_SIZE as usize);
    let end = start.saturating_add(limit).min(entries.len());
    let next_cursor =
        (end < entries.len()).then(|| directory_cursor(&entries[end - 1].relative_path));
    let mut page_entries: Vec<_> = entries.drain(start..end).collect();
    add_page_content_revisions(&root, &mut page_entries)?;
    Ok(ChatScratchDirectoryPageRead {
        scratch_generation_id: request.scratch_generation_id,
        relative_path: request.relative_path,
        entries: page_entries,
        next_cursor,
    })
}

#[tauri::command]
pub async fn chat_promote_scratch_file(
    app: tauri::AppHandle,
    db_url: String,
    request: PromoteChatScratchFileCommand,
) -> ChatResult<ChatScratchPromotionResultRead> {
    validate_required_relative_path(&request.source_relative_path)?;
    validate_content_revision(&request.expected_content_revision)?;
    let pool = chat_pool(app.clone(), db_url).await?;
    require_local_owner(&pool).await?;
    let identity = read_scratch_identity(&pool, &request.scratch_generation_id).await?;
    if identity.generation_lifecycle != ChatScratchGenerationLifecycleState::Active {
        return Err(ChatError::new(
            ChatErrorCode::Permission,
            "Only an active scratch generation can promote artifacts",
            false,
        ));
    }
    require_current_scratch_authority(&pool, &identity).await?;
    let channel_id = match &request.destination {
        ChatScratchPromotionDestinationInput::WorkingFolder { channel_id, .. }
        | ChatScratchPromotionDestinationInput::ManagedAttachment { channel_id, .. } => channel_id,
    };
    let attachment_storage_folder =
        require_destination_channel(&pool, &identity, channel_id).await?;
    let (audited_working_folder_id, destination_kind, destination_path, attachment_id) =
        match &request.destination {
            ChatScratchPromotionDestinationInput::WorkingFolder {
                working_folder_id,
                relative_path,
                ..
            } => {
                validate_required_relative_path(relative_path)?;
                require_edit_folder_grant(&pool, &identity, channel_id, working_folder_id).await?;
                (
                    Some(working_folder_id),
                    "working_folder",
                    Some(relative_path.as_str()),
                    None,
                )
            }
            ChatScratchPromotionDestinationInput::ManagedAttachment {
                attachment_id,
                display_name,
                ..
            } => {
                validate_attachment_display_name(display_name)?;
                (
                    None,
                    "managed_attachment",
                    None,
                    Some(attachment_id.as_str()),
                )
            }
        };
    let request_digest = scratch_promotion_request_digest(&request);
    if scratch_promotion_exists(&pool, &request.promotion_id).await? {
        return read_idempotent_promotion(&pool, &request.promotion_id, &request_digest).await;
    }
    let root = scratch::resolve_managed_scratch_path_for_inspection(
        &app,
        &pool,
        identity.generation_id.as_str(),
        identity.execution_environment_id.as_str(),
    )
    .await?;
    let source = read_scratch_file(
        &root,
        &request.source_relative_path,
        Some(&request.expected_content_revision),
    )?;
    let attachment_kind = match &request.destination {
        ChatScratchPromotionDestinationInput::ManagedAttachment { .. } => {
            Some(supported_attachment_kind(&source.bytes)?)
        }
        ChatScratchPromotionDestinationInput::WorkingFolder { .. } => None,
    };
    let authorized = match &request.destination {
        ChatScratchPromotionDestinationInput::WorkingFolder {
            working_folder_id, ..
        } => Some(
            super::workspace_commands::authorize_working_folder(
                &app,
                &pool,
                working_folder_id,
                WorkingFolderAuthorizationOperation::FileWrite,
            )
            .await?,
        ),
        ChatScratchPromotionDestinationInput::ManagedAttachment { .. } => None,
    };
    let now = now_timestamp()?;
    let inserted = sqlx::query(
        "INSERT INTO chat_scratch_promotions
            (id, scratch_generation_id, source_relative_path, source_content_revision,
             request_digest, destination_kind, destination_channel_id,
             destination_working_folder_id, destination_relative_path, attachment_id,
             state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(id) DO NOTHING",
    )
    .bind(request.promotion_id.as_str())
    .bind(identity.generation_id.as_str())
    .bind(&request.source_relative_path)
    .bind(&source.content_revision)
    .bind(&request_digest)
    .bind(destination_kind)
    .bind(channel_id.as_str())
    .bind(
        audited_working_folder_id
            .as_ref()
            .map(|working_folder_id| working_folder_id.as_str()),
    )
    .bind(destination_path)
    .bind(attachment_id)
    .bind(now.as_str())
    .bind(now.as_str())
    .execute(&pool)
    .await
    .map_err(persistence_error)?;
    if inserted.rows_affected() == 0 {
        return read_idempotent_promotion(&pool, &request.promotion_id, &request_digest).await;
    }
    if let Err(error) = require_current_scratch_authority(&pool, &identity).await {
        mark_promotion_failed(&pool, &request.promotion_id, "authorization", &now).await?;
        return Err(error);
    }
    if let Err(error) = require_destination_channel(&pool, &identity, channel_id).await {
        mark_promotion_failed(&pool, &request.promotion_id, "authorization", &now).await?;
        return Err(error);
    }
    let destination = match &request.destination {
        ChatScratchPromotionDestinationInput::WorkingFolder {
            working_folder_id,
            relative_path,
            ..
        } => {
            if let Err(error) =
                require_edit_folder_grant(&pool, &identity, channel_id, working_folder_id).await
            {
                mark_promotion_failed(&pool, &request.promotion_id, "authorization", &now).await?;
                return Err(error);
            }
            let authorized = authorized.as_ref().ok_or_else(|| {
                ChatError::new(
                    ChatErrorCode::Internal,
                    "Scratch folder promotion lost its authorized destination",
                    false,
                )
            })?;
            if let Err(error) = super::workspace_files::create_workspace_artifact(
                authorized,
                relative_path,
                &source.bytes,
            ) {
                mark_promotion_failed(&pool, &request.promotion_id, "destination_write", &now)
                    .await?;
                return Err(error);
            }
            ChatScratchPromotionDestinationRead::WorkingFolder {
                working_folder_id: working_folder_id.clone(),
                relative_path: relative_path.clone(),
            }
        }
        ChatScratchPromotionDestinationInput::ManagedAttachment {
            attachment_id,
            display_name,
            ..
        } => {
            let kind = attachment_kind.ok_or_else(|| {
                ChatError::new(
                    ChatErrorCode::Internal,
                    "Scratch attachment promotion lost its validated artifact kind",
                    false,
                )
            })?;
            let vault_root = vault::active_writable_vault_path(&app).map_err(vault_error)?;
            if let Err(error) = attachments::import_attachment_bytes(
                &pool,
                &vault_root,
                AttachmentBytesImport {
                    working_folder_id: &attachment_storage_folder,
                    attachment_id: attachment_id.clone(),
                    display_name: display_name.clone(),
                    bytes: &source.bytes,
                    requested_kind: kind,
                    now: &now,
                },
            )
            .await
            {
                mark_promotion_failed(&pool, &request.promotion_id, "destination_write", &now)
                    .await?;
                return Err(error);
            }
            ChatScratchPromotionDestinationRead::ManagedAttachment {
                channel_id: channel_id.clone(),
                attachment_id: attachment_id.clone(),
            }
        }
    };
    let completed = now_timestamp()?;
    let completion = sqlx::query(
        "UPDATE chat_scratch_promotions
         SET source_sha256 = ?, state = 'completed', last_error_code = NULL,
             updated_at = ?, completed_at = ?
         WHERE id = ? AND state = 'pending'",
    )
    .bind(&source.sha256)
    .bind(completed.as_str())
    .bind(completed.as_str())
    .bind(request.promotion_id.as_str())
    .execute(&pool)
    .await
    .map_err(persistence_error)?;
    if completion.rows_affected() != 1 {
        return Err(ChatError::new(
            ChatErrorCode::Conflict,
            "Scratch promotion state changed before completion",
            true,
        ));
    }
    Ok(ChatScratchPromotionResultRead {
        id: request.promotion_id,
        scratch_generation_id: request.scratch_generation_id,
        source_relative_path: request.source_relative_path,
        source_sha256: source.sha256,
        destination,
        created_at: now,
    })
}

#[tauri::command]
pub async fn chat_preview_scratch_cleanup(
    app: tauri::AppHandle,
    db_url: String,
    request: PreviewChatScratchCleanupCommand,
) -> ChatResult<ChatScratchCleanupPreviewRead> {
    let pool = chat_pool(app.clone(), db_url).await?;
    require_local_owner(&pool).await?;
    let identity = read_scratch_identity(&pool, &request.scratch_generation_id).await?;
    let (device_availability, size) = read_generation_size(&app, &pool, &identity).await?;
    let active_run_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM chat_agent_runs
         WHERE scratch_generation_id = ?
           AND state IN ('queued', 'starting', 'working', 'waiting')",
    )
    .bind(identity.generation_id.as_str())
    .fetch_one(&pool)
    .await
    .map_err(persistence_error)?;
    let other_generation_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM chat_scratch_generations
         WHERE scratch_scope_id = ? AND id != ?
           AND removed_at IS NULL AND lifecycle_state != 'removed'",
    )
    .bind(identity.scope_id.as_str())
    .bind(identity.generation_id.as_str())
    .fetch_one(&pool)
    .await
    .map_err(persistence_error)?;
    Ok(ChatScratchCleanupPreviewRead {
        scratch_scope_id: identity.scope_id,
        scratch_generation_id: identity.generation_id,
        expected_scope_revision: identity.scope_revision,
        lifecycle_state: identity.generation_lifecycle,
        byte_size: size.bytes,
        entry_count: size.entries,
        size_truncated: size.truncated,
        device_availability,
        active_run_count: u64_value(active_run_count)?,
        will_remove_scope: other_generation_count == 0,
    })
}

#[tauri::command]
pub async fn chat_cleanup_scratch(
    app: tauri::AppHandle,
    db_url: String,
    request: CleanupChatScratchCommand,
) -> ChatResult<ChatScratchCleanupResultRead> {
    if !request.confirmed {
        return Err(ChatError::new(
            ChatErrorCode::Permission,
            "Private scratch cleanup requires explicit confirmation",
            true,
        ));
    }
    let pool = chat_pool(app.clone(), db_url).await?;
    require_local_owner(&pool).await?;
    let identity = read_scratch_identity(&pool, &request.scratch_generation_id).await?;
    if identity.scope_revision != request.expected_scope_revision {
        return Err(ChatError::new(
            ChatErrorCode::StaleRevision,
            "Private scratch changed before cleanup",
            true,
        ));
    }
    if !matches!(
        identity.scope_lifecycle,
        ChatScratchScopeLifecycleState::Active
            | ChatScratchScopeLifecycleState::Archived
            | ChatScratchScopeLifecycleState::CleanupFailed
    ) || !matches!(
        identity.generation_lifecycle,
        ChatScratchGenerationLifecycleState::Active
            | ChatScratchGenerationLifecycleState::Quarantined
            | ChatScratchGenerationLifecycleState::CleanupFailed
    ) {
        return Err(ChatError::new(
            ChatErrorCode::Conflict,
            "Private scratch is already being cleaned",
            true,
        ));
    }
    let active_run_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM chat_agent_runs
         WHERE scratch_generation_id = ?
           AND state IN ('queued', 'starting', 'working', 'waiting')",
    )
    .bind(identity.generation_id.as_str())
    .fetch_one(&pool)
    .await
    .map_err(persistence_error)?;
    if active_run_count != 0 {
        return Err(ChatError::new(
            ChatErrorCode::Conflict,
            "Active work must stop before private scratch can be cleaned",
            true,
        ));
    }
    let existing_job_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM chat_scratch_cleanup_jobs WHERE scratch_generation_id = ?",
    )
    .bind(identity.generation_id.as_str())
    .fetch_optional(&pool)
    .await
    .map_err(persistence_error)?;
    let job_id = match existing_job_id {
        Some(value) => ChatScratchCleanupJobId::new(value).map_err(identifier_error)?,
        None => {
            ChatScratchCleanupJobId::new(new_id("scratch-cleanup")).map_err(identifier_error)?
        }
    };
    let now = now_timestamp()?;
    let path = scratch::resolve_managed_scratch_path_for_inspection(
        &app,
        &pool,
        identity.generation_id.as_str(),
        identity.execution_environment_id.as_str(),
    )
    .await;
    let path = match path {
        Ok(path) => path,
        Err(_) => {
            persist_unavailable_cleanup_job(&pool, &identity, &job_id, &now).await?;
            return Ok(ChatScratchCleanupResultRead {
                job_id,
                scratch_scope_id: identity.scope_id,
                scratch_generation_id: identity.generation_id,
                scope_revision: identity.scope_revision,
                state: ChatScratchCleanupJobState::UnavailableOnThisDevice,
                removed_bytes: 0,
                device_availability: ChatScratchDeviceAvailability::UnavailableOnThisDevice,
                completed_at: None,
            });
        }
    };
    let other_generation_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM chat_scratch_generations
         WHERE scratch_scope_id = ? AND id != ?
           AND removed_at IS NULL AND lifecycle_state != 'removed'",
    )
    .bind(identity.scope_id.as_str())
    .bind(identity.generation_id.as_str())
    .fetch_one(&pool)
    .await
    .map_err(persistence_error)?;
    let next_scope_revision = identity.scope_revision.saturating_add(1);
    let mut transaction = pool.begin().await.map_err(persistence_error)?;
    sqlx::query(
        "INSERT INTO chat_scratch_cleanup_jobs
            (id, scratch_scope_id, scratch_generation_id, expected_scope_revision,
             state, attempt_count, confirmed_at, available_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
         ON CONFLICT(scratch_generation_id) DO UPDATE SET
             expected_scope_revision = excluded.expected_scope_revision,
             state = 'pending', last_error_code = NULL,
             confirmed_at = excluded.confirmed_at,
             available_at = excluded.available_at,
             updated_at = excluded.updated_at",
    )
    .bind(job_id.as_str())
    .bind(identity.scope_id.as_str())
    .bind(identity.generation_id.as_str())
    .bind(i64_value(identity.scope_revision)?)
    .bind(now.as_str())
    .bind(now.as_str())
    .bind(now.as_str())
    .bind(now.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    let scope_updated = sqlx::query(
        "UPDATE chat_scratch_scopes
         SET lifecycle_state = CASE WHEN ? = 0 THEN 'cleanup_pending' ELSE lifecycle_state END,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND removed_at IS NULL",
    )
    .bind(other_generation_count)
    .bind(now.as_str())
    .bind(identity.scope_id.as_str())
    .bind(i64_value(identity.scope_revision)?)
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    if scope_updated.rows_affected() != 1 {
        return Err(ChatError::new(
            ChatErrorCode::StaleRevision,
            "Private scratch changed before cleanup",
            true,
        ));
    }
    sqlx::query(
        "UPDATE chat_scratch_generations
         SET lifecycle_state = 'cleanup_pending', updated_at = ? WHERE id = ?",
    )
    .bind(now.as_str())
    .bind(identity.generation_id.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    sqlx::query(
        "UPDATE chat_execution_environments
         SET lifecycle_state = 'cleanup_pending', updated_at = ?
         WHERE id = ? AND scratch_generation_id = ?",
    )
    .bind(now.as_str())
    .bind(identity.execution_environment_id.as_str())
    .bind(identity.generation_id.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    sqlx::query(
        "UPDATE chat_scratch_cleanup_jobs
         SET state = 'running', attempt_count = attempt_count + 1, updated_at = ?
         WHERE id = ? AND state = 'pending'",
    )
    .bind(now.as_str())
    .bind(job_id.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    transaction.commit().await.map_err(persistence_error)?;

    let removed_bytes = match scratch::remove_managed_scratch_generation(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            let failed_at = now_timestamp()?;
            mark_cleanup_failed(
                &pool,
                &identity,
                &job_id,
                other_generation_count == 0,
                &failed_at,
            )
            .await?;
            return Err(error);
        }
    };
    update_active_device_scope(&app, |scope| {
        scope
            .execution_environment_paths
            .remove(identity.execution_environment_id.as_str());
        Ok(())
    })
    .map_err(device_state_error)?;
    let completed = now_timestamp()?;
    let mut transaction = pool.begin().await.map_err(persistence_error)?;
    sqlx::query(
        "UPDATE chat_scratch_generations
         SET lifecycle_state = 'removed', byte_size = 0,
             updated_at = ?, removed_at = ? WHERE id = ?",
    )
    .bind(completed.as_str())
    .bind(completed.as_str())
    .bind(identity.generation_id.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    sqlx::query(
        "UPDATE chat_execution_environments
         SET lifecycle_state = 'removed', updated_at = ?, archived_at = ?
         WHERE id = ? AND scratch_generation_id = ?",
    )
    .bind(completed.as_str())
    .bind(completed.as_str())
    .bind(identity.execution_environment_id.as_str())
    .bind(identity.generation_id.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    if other_generation_count == 0 {
        sqlx::query(
            "UPDATE chat_scratch_scopes
             SET lifecycle_state = 'removed', updated_at = ?, removed_at = ? WHERE id = ?",
        )
        .bind(completed.as_str())
        .bind(completed.as_str())
        .bind(identity.scope_id.as_str())
        .execute(&mut *transaction)
        .await
        .map_err(persistence_error)?;
    }
    sqlx::query(
        "UPDATE chat_scratch_cleanup_jobs
         SET state = 'completed', removed_bytes = ?, last_error_code = NULL,
             updated_at = ?, completed_at = ? WHERE id = ?",
    )
    .bind(i64::try_from(removed_bytes).unwrap_or(i64::MAX))
    .bind(completed.as_str())
    .bind(completed.as_str())
    .bind(job_id.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    transaction.commit().await.map_err(persistence_error)?;
    Ok(ChatScratchCleanupResultRead {
        job_id,
        scratch_scope_id: identity.scope_id,
        scratch_generation_id: identity.generation_id,
        scope_revision: next_scope_revision,
        state: ChatScratchCleanupJobState::Completed,
        removed_bytes,
        device_availability: ChatScratchDeviceAvailability::UnavailableOnThisDevice,
        completed_at: Some(completed),
    })
}

async fn read_scope_generations(
    app: &tauri::AppHandle,
    pool: &SqlitePool,
    scope_id: &ChatScratchScopeId,
) -> ChatResult<Vec<ChatScratchGenerationRead>> {
    let rows = sqlx::query(
        "SELECT generation.id, generation.generation, generation.lifecycle_state,
                generation.byte_size, generation.created_at, generation.updated_at,
                environment.id AS execution_environment_id
         FROM chat_scratch_generations generation
         JOIN chat_execution_environments environment
           ON environment.scratch_generation_id = generation.id
          AND environment.kind = 'scratch'
         WHERE generation.scratch_scope_id = ? AND generation.removed_at IS NULL
         ORDER BY generation.generation DESC",
    )
    .bind(scope_id.as_str())
    .fetch_all(pool)
    .await
    .map_err(persistence_error)?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let generation_id: ChatScratchGenerationId =
            parse_id(row.try_get("id").map_err(persistence_error)?)?;
        let execution_environment_id: ChatExecutionEnvironmentId = parse_id(
            row.try_get("execution_environment_id")
                .map_err(persistence_error)?,
        )?;
        let stored_bytes = u64_value(row.try_get("byte_size").map_err(persistence_error)?)?;
        let stored_size = scratch::BoundedScratchSize {
            bytes: stored_bytes.min(MAX_SIZE_BYTES),
            entries: 0,
            truncated: stored_bytes > MAX_SIZE_BYTES,
        };
        let lifecycle_state = parse_generation_lifecycle(
            &row.try_get::<String, _>("lifecycle_state")
                .map_err(persistence_error)?,
        )?;
        let (device_availability, size) = if matches!(
            lifecycle_state,
            ChatScratchGenerationLifecycleState::Active
                | ChatScratchGenerationLifecycleState::Quarantined
                | ChatScratchGenerationLifecycleState::CleanupFailed
        ) {
            match scratch::resolve_managed_scratch_path_for_inspection(
                app,
                pool,
                generation_id.as_str(),
                execution_environment_id.as_str(),
            )
            .await
            {
                Ok(path) => {
                    match scratch::bounded_scratch_size(&path, MAX_SIZE_ENTRIES, MAX_SIZE_BYTES) {
                        Ok(size) => (ChatScratchDeviceAvailability::Available, size),
                        Err(_) => (
                            ChatScratchDeviceAvailability::UnavailableOnThisDevice,
                            stored_size,
                        ),
                    }
                }
                Err(_) => (
                    ChatScratchDeviceAvailability::UnavailableOnThisDevice,
                    stored_size,
                ),
            }
        } else {
            (
                ChatScratchDeviceAvailability::UnavailableOnThisDevice,
                stored_size,
            )
        };
        result.push(ChatScratchGenerationRead {
            id: generation_id.clone(),
            execution_environment_id,
            generation: u64_value(row.try_get("generation").map_err(persistence_error)?)?,
            lifecycle_state,
            byte_size: size.bytes,
            entry_count: size.entries,
            size_truncated: size.truncated,
            device_availability,
            retained_sources: read_generation_sources(pool, &generation_id).await?,
            created_at: timestamp(row.try_get("created_at").map_err(persistence_error)?)?,
            updated_at: timestamp(row.try_get("updated_at").map_err(persistence_error)?)?,
        });
    }
    Ok(result)
}

async fn read_generation_sources(
    pool: &SqlitePool,
    generation_id: &ChatScratchGenerationId,
) -> ChatResult<Vec<ChatScratchSourceSummaryRead>> {
    let rows = sqlx::query(
        "SELECT channel.id AS channel_id, channel.name AS channel_name,
                source.lower_ordinal, source.high_ordinal, source.audience_revision
         FROM chat_scratch_generation_sources source
         JOIN chat_channels channel ON channel.conversation_id = source.conversation_id
         WHERE source.scratch_generation_id = ?
         ORDER BY channel.name COLLATE NOCASE, channel.id",
    )
    .bind(generation_id.as_str())
    .fetch_all(pool)
    .await
    .map_err(persistence_error)?;
    rows.into_iter()
        .map(|row| {
            Ok(ChatScratchSourceSummaryRead {
                channel_id: parse_id(row.try_get("channel_id").map_err(persistence_error)?)?,
                channel_name: row.try_get("channel_name").map_err(persistence_error)?,
                lower_ordinal: u64_value(row.try_get("lower_ordinal").map_err(persistence_error)?)?,
                high_ordinal: u64_value(row.try_get("high_ordinal").map_err(persistence_error)?)?,
                audience_revision: u64_value(
                    row.try_get("audience_revision")
                        .map_err(persistence_error)?,
                )?,
            })
        })
        .collect()
}

async fn read_scratch_identity(
    pool: &SqlitePool,
    generation_id: &ChatScratchGenerationId,
) -> ChatResult<ScratchIdentity> {
    let row = sqlx::query(
        "SELECT scope.id AS scope_id, scope.revision AS scope_revision,
                scope.lifecycle_state AS scope_lifecycle, scope.reply_thread_id,
                scope.teammate_id, thread.conversation_id,
                generation.id AS generation_id,
                generation.lifecycle_state AS generation_lifecycle,
                environment.id AS execution_environment_id
         FROM chat_scratch_generations generation
         JOIN chat_scratch_scopes scope ON scope.id = generation.scratch_scope_id
         JOIN chat_reply_threads thread ON thread.id = scope.reply_thread_id
         JOIN chat_execution_environments environment
           ON environment.scratch_generation_id = generation.id
          AND environment.kind = 'scratch'
         WHERE generation.id = ? AND generation.removed_at IS NULL
           AND scope.removed_at IS NULL",
    )
    .bind(generation_id.as_str())
    .fetch_optional(pool)
    .await
    .map_err(persistence_error)?
    .ok_or_else(scratch_not_found)?;
    Ok(ScratchIdentity {
        scope_id: parse_id(row.try_get("scope_id").map_err(persistence_error)?)?,
        scope_revision: u64_value(row.try_get("scope_revision").map_err(persistence_error)?)?,
        scope_lifecycle: parse_scope_lifecycle(
            &row.try_get::<String, _>("scope_lifecycle")
                .map_err(persistence_error)?,
        )?,
        conversation_id: parse_id(row.try_get("conversation_id").map_err(persistence_error)?)?,
        teammate_id: parse_id(row.try_get("teammate_id").map_err(persistence_error)?)?,
        generation_id: parse_id(row.try_get("generation_id").map_err(persistence_error)?)?,
        generation_lifecycle: parse_generation_lifecycle(
            &row.try_get::<String, _>("generation_lifecycle")
                .map_err(persistence_error)?,
        )?,
        execution_environment_id: parse_id(
            row.try_get("execution_environment_id")
                .map_err(persistence_error)?,
        )?,
    })
}

async fn require_scratch_inspection_authority(
    pool: &SqlitePool,
    identity: &ScratchIdentity,
    allow_restricted: bool,
) -> ChatResult<()> {
    if !matches!(
        identity.scope_lifecycle,
        ChatScratchScopeLifecycleState::Active
            | ChatScratchScopeLifecycleState::Archived
            | ChatScratchScopeLifecycleState::CleanupFailed
    ) {
        return Err(scratch_not_found());
    }
    match identity.generation_lifecycle {
        ChatScratchGenerationLifecycleState::Active => {
            require_current_scratch_authority(pool, identity).await
        }
        ChatScratchGenerationLifecycleState::Quarantined
        | ChatScratchGenerationLifecycleState::CleanupFailed
            if allow_restricted =>
        {
            require_local_owner_destination_membership(pool, &identity.conversation_id).await?;
            if scratch::generation_sources_readable_by(
                pool,
                identity.generation_id.as_str(),
                LOCAL_PARTICIPANT_ID,
            )
            .await?
            {
                Ok(())
            } else {
                Err(ChatError::new(
                    ChatErrorCode::Permission,
                    "Private scratch sources are no longer readable by the local owner",
                    false,
                ))
            }
        }
        ChatScratchGenerationLifecycleState::Quarantined
        | ChatScratchGenerationLifecycleState::CleanupFailed => Err(ChatError::new(
            ChatErrorCode::Permission,
            "Restricted scratch requires explicit owner inspection",
            false,
        )),
        _ => Err(scratch_not_found()),
    }
}

async fn require_current_scratch_authority(
    pool: &SqlitePool,
    identity: &ScratchIdentity,
) -> ChatResult<()> {
    require_local_owner_destination_membership(pool, &identity.conversation_id).await?;
    let can_participate: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1
           FROM chat_conversation_memberships membership
           JOIN chat_ai_channel_memberships access
             ON access.conversation_id = membership.conversation_id
            AND access.teammate_id = membership.participant_id
           JOIN chat_access_profiles profile ON profile.id = access.access_profile_id
           JOIN chat_access_profile_revisions revision
             ON revision.access_profile_id = profile.id
            AND revision.revision = profile.latest_revision
           WHERE membership.conversation_id = ? AND membership.participant_id = ?
             AND membership.removed_at IS NULL
             AND CASE
                   WHEN access.participate_inherits_profile = 1 THEN revision.default_participate
                   ELSE access.participate AND revision.default_participate
                 END = 1
         )",
    )
    .bind(identity.conversation_id.as_str())
    .bind(identity.teammate_id.as_str())
    .fetch_one(pool)
    .await
    .map_err(persistence_error)?;
    if !can_participate
        || !scratch::generation_constraints_hold(
            pool,
            identity.generation_id.as_str(),
            identity.conversation_id.as_str(),
            identity.teammate_id.as_str(),
            LOCAL_PARTICIPANT_ID,
        )
        .await?
    {
        return Err(ChatError::new(
            ChatErrorCode::Permission,
            "Private scratch authorization is no longer active",
            false,
        ));
    }
    Ok(())
}

/// Resolves the destination channel and its project-managed attachment index.
///
/// The returned working folder is only a storage association for the existing
/// attachment table. It is not a folder grant and must never be used to
/// authorize project file access.
async fn require_destination_channel(
    pool: &SqlitePool,
    identity: &ScratchIdentity,
    channel_id: &ChatChannelId,
) -> ChatResult<ProjectWorkingFolderId> {
    let storage_folder_id: String = sqlx::query_scalar(
        "SELECT folder.id
         FROM chat_channels channel
         JOIN project_working_folders folder
           ON folder.project_id = channel.project_id
          AND folder.kind = 'managed'
          AND folder.archived_at IS NULL
         WHERE channel.id = ? AND channel.conversation_id = ?
           AND channel.archived_at IS NULL",
    )
    .bind(channel_id.as_str())
    .bind(identity.conversation_id.as_str())
    .fetch_optional(pool)
    .await
    .map_err(persistence_error)?
    .ok_or_else(|| {
        ChatError::new(
            ChatErrorCode::Permission,
            "The scratch destination channel is no longer available",
            false,
        )
    })?;
    parse_id(storage_folder_id)
}

async fn require_edit_folder_grant(
    pool: &SqlitePool,
    identity: &ScratchIdentity,
    channel_id: &ChatChannelId,
    working_folder_id: &ProjectWorkingFolderId,
) -> ChatResult<()> {
    let row = sqlx::query(
        "SELECT grant_row.capability, revision.maximum_folder_capability,
                grant_row.capability_inherits_profile
         FROM chat_channels channel
         JOIN chat_conversation_memberships membership
           ON membership.conversation_id = channel.conversation_id
          AND membership.participant_id = ?
         JOIN chat_ai_channel_memberships access
           ON access.conversation_id = membership.conversation_id
          AND access.teammate_id = membership.participant_id
         JOIN chat_access_profiles profile ON profile.id = access.access_profile_id
         JOIN chat_access_profile_revisions revision
           ON revision.access_profile_id = profile.id
          AND revision.revision = profile.latest_revision
         JOIN chat_teammate_working_folder_grants grant_row
           ON grant_row.conversation_id = membership.conversation_id
          AND grant_row.teammate_id = membership.participant_id
          AND grant_row.working_folder_id = ?
         JOIN project_working_folders folder ON folder.id = grant_row.working_folder_id
         WHERE channel.id = ? AND channel.conversation_id = ?
           AND channel.archived_at IS NULL AND membership.removed_at IS NULL
           AND grant_row.revoked_at IS NULL AND folder.archived_at IS NULL
           AND folder.project_id = channel.project_id",
    )
    .bind(identity.teammate_id.as_str())
    .bind(working_folder_id.as_str())
    .bind(channel_id.as_str())
    .bind(identity.conversation_id.as_str())
    .fetch_optional(pool)
    .await
    .map_err(persistence_error)?
    .ok_or_else(|| {
        ChatError::new(
            ChatErrorCode::Permission,
            "The destination folder is not granted in this channel",
            false,
        )
    })?;
    let grant_rank = folder_capability_rank(
        &row.try_get::<String, _>("capability")
            .map_err(persistence_error)?,
    )?;
    let profile_rank = folder_capability_rank(
        &row.try_get::<String, _>("maximum_folder_capability")
            .map_err(persistence_error)?,
    )?;
    let effective_rank = if row
        .try_get::<i64, _>("capability_inherits_profile")
        .map_err(persistence_error)?
        != 0
    {
        profile_rank
    } else {
        grant_rank.min(profile_rank)
    };
    if effective_rank < 2 {
        return Err(ChatError::new(
            ChatErrorCode::Permission,
            "Scratch promotion requires current edit access to the destination folder",
            false,
        ));
    }
    Ok(())
}

async fn require_local_owner(pool: &SqlitePool) -> ChatResult<()> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1 FROM chat_participants
           WHERE id = ? AND participant_kind = 'local_user' AND archived_at IS NULL
         )",
    )
    .bind(LOCAL_PARTICIPANT_ID)
    .fetch_one(pool)
    .await
    .map_err(persistence_error)?;
    if exists {
        Ok(())
    } else {
        Err(ChatError::new(
            ChatErrorCode::Permission,
            "Private scratch management is unavailable",
            false,
        ))
    }
}

async fn require_local_owner_destination_membership(
    pool: &SqlitePool,
    conversation_id: &ChatConversationId,
) -> ChatResult<()> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1 FROM chat_conversation_memberships
           WHERE conversation_id = ? AND participant_id = ? AND removed_at IS NULL
         )",
    )
    .bind(conversation_id.as_str())
    .bind(LOCAL_PARTICIPANT_ID)
    .fetch_one(pool)
    .await
    .map_err(persistence_error)?;
    if exists {
        Ok(())
    } else {
        Err(ChatError::new(
            ChatErrorCode::Permission,
            "The local owner cannot inspect this reply thread",
            false,
        ))
    }
}

fn read_directory_entries(
    root: &Path,
    relative_path: &str,
) -> ChatResult<Vec<ChatScratchDirectoryEntryRead>> {
    let (items, truncated) =
        super::workspace_files::list_managed_artifact_directory(root, relative_path)?;
    if truncated {
        return Err(ChatError::validation(
            "relativePath",
            "Scratch directory is too large to browse safely",
        ));
    }
    let mut entries = Vec::with_capacity(items.len());
    for item in items {
        let display_name = item.display_name;
        if display_name.is_empty() || display_name.chars().any(char::is_control) {
            return Err(scratch_path_error());
        }
        let child_relative = if relative_path.is_empty() {
            display_name.clone()
        } else {
            format!("{relative_path}/{display_name}")
        };
        validate_required_relative_path(&child_relative)?;
        if item.directory {
            entries.push(ChatScratchDirectoryEntryRead {
                relative_path: child_relative,
                display_name,
                kind: ChatScratchDirectoryEntryKind::Directory,
                byte_size: None,
                content_revision: None,
                promotable: false,
            });
        } else if let Some(byte_size) = item.byte_size {
            entries.push(ChatScratchDirectoryEntryRead {
                relative_path: child_relative,
                display_name,
                kind: ChatScratchDirectoryEntryKind::File,
                byte_size: Some(byte_size),
                promotable: false,
                content_revision: None,
            });
        }
    }
    Ok(entries)
}

fn add_page_content_revisions(
    root: &Path,
    entries: &mut [ChatScratchDirectoryEntryRead],
) -> ChatResult<()> {
    let mut revision_budget = MAX_PAGE_REVISION_BYTES;
    for entry in entries {
        if entry.kind != ChatScratchDirectoryEntryKind::File {
            continue;
        }
        let byte_size = entry.byte_size.unwrap_or(u64::MAX);
        if byte_size > MAX_PROMOTION_BYTES || byte_size > revision_budget {
            continue;
        }
        let file = read_scratch_file(root, &entry.relative_path, None)?;
        revision_budget = revision_budget.saturating_sub(byte_size);
        entry.content_revision = Some(file.content_revision);
        entry.promotable = true;
    }
    Ok(())
}

fn read_scratch_file(
    root: &Path,
    relative_path: &str,
    expected_revision: Option<&str>,
) -> ChatResult<ScratchFile> {
    validate_required_relative_path(relative_path)?;
    let bytes = super::workspace_files::read_managed_artifact_bytes(root, relative_path)?;
    let content_revision = scratch_file_revision(relative_path, &bytes);
    if expected_revision.is_some_and(|expected| expected != content_revision) {
        return Err(ChatError::new(
            ChatErrorCode::Conflict,
            "Scratch artifact changed before promotion",
            true,
        ));
    }
    Ok(ScratchFile {
        sha256: format!("{:x}", Sha256::digest(&bytes)),
        content_revision,
        bytes,
    })
}

fn cursor_start(
    entries: &[ChatScratchDirectoryEntryRead],
    cursor: Option<&str>,
) -> ChatResult<usize> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    entries
        .iter()
        .position(|entry| directory_cursor(&entry.relative_path) == cursor)
        .map(|index| index + 1)
        .ok_or_else(|| {
            ChatError::new(
                ChatErrorCode::StaleRevision,
                "Scratch directory changed before the next page was read",
                true,
            )
        })
}

async fn read_generation_size(
    app: &tauri::AppHandle,
    pool: &SqlitePool,
    identity: &ScratchIdentity,
) -> ChatResult<(ChatScratchDeviceAvailability, scratch::BoundedScratchSize)> {
    let stored_bytes = u64_value(
        sqlx::query_scalar("SELECT byte_size FROM chat_scratch_generations WHERE id = ?")
            .bind(identity.generation_id.as_str())
            .fetch_one(pool)
            .await
            .map_err(persistence_error)?,
    )?;
    let unavailable = || {
        (
            ChatScratchDeviceAvailability::UnavailableOnThisDevice,
            scratch::BoundedScratchSize {
                bytes: stored_bytes.min(MAX_SIZE_BYTES),
                entries: 0,
                truncated: stored_bytes > MAX_SIZE_BYTES,
            },
        )
    };
    let Ok(path) = scratch::resolve_managed_scratch_path_for_inspection(
        app,
        pool,
        identity.generation_id.as_str(),
        identity.execution_environment_id.as_str(),
    )
    .await
    else {
        return Ok(unavailable());
    };
    Ok(
        match scratch::bounded_scratch_size(&path, MAX_SIZE_ENTRIES, MAX_SIZE_BYTES) {
            Ok(size) => (ChatScratchDeviceAvailability::Available, size),
            Err(_) => unavailable(),
        },
    )
}

async fn persist_unavailable_cleanup_job(
    pool: &SqlitePool,
    identity: &ScratchIdentity,
    job_id: &ChatScratchCleanupJobId,
    now: &UtcTimestamp,
) -> ChatResult<()> {
    sqlx::query(
        "INSERT INTO chat_scratch_cleanup_jobs
            (id, scratch_scope_id, scratch_generation_id, expected_scope_revision,
             state, attempt_count, last_error_code, confirmed_at, available_at,
             created_at, updated_at)
         VALUES (?, ?, ?, ?, 'unavailable_on_device', 1, 'missing_on_device', ?, ?, ?, ?)
         ON CONFLICT(scratch_generation_id) DO UPDATE SET
             expected_scope_revision = excluded.expected_scope_revision,
             state = 'unavailable_on_device', attempt_count = attempt_count + 1,
             last_error_code = 'missing_on_device', confirmed_at = excluded.confirmed_at,
             available_at = excluded.available_at, updated_at = excluded.updated_at",
    )
    .bind(job_id.as_str())
    .bind(identity.scope_id.as_str())
    .bind(identity.generation_id.as_str())
    .bind(i64_value(identity.scope_revision)?)
    .bind(now.as_str())
    .bind(now.as_str())
    .bind(now.as_str())
    .bind(now.as_str())
    .execute(pool)
    .await
    .map_err(persistence_error)?;
    Ok(())
}

async fn mark_cleanup_failed(
    pool: &SqlitePool,
    identity: &ScratchIdentity,
    job_id: &ChatScratchCleanupJobId,
    scope_was_pending: bool,
    now: &UtcTimestamp,
) -> ChatResult<()> {
    let mut transaction = pool.begin().await.map_err(persistence_error)?;
    sqlx::query(
        "UPDATE chat_scratch_cleanup_jobs
         SET state = 'failed', last_error_code = 'io', updated_at = ?, available_at = ?
         WHERE id = ?",
    )
    .bind(now.as_str())
    .bind(now.as_str())
    .bind(job_id.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    sqlx::query(
        "UPDATE chat_scratch_generations
         SET lifecycle_state = 'cleanup_failed', updated_at = ? WHERE id = ?",
    )
    .bind(now.as_str())
    .bind(identity.generation_id.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    sqlx::query(
        "UPDATE chat_execution_environments
         SET lifecycle_state = 'cleanup_failed', updated_at = ? WHERE id = ?",
    )
    .bind(now.as_str())
    .bind(identity.execution_environment_id.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    if scope_was_pending {
        sqlx::query(
            "UPDATE chat_scratch_scopes
             SET lifecycle_state = 'cleanup_failed', updated_at = ? WHERE id = ?",
        )
        .bind(now.as_str())
        .bind(identity.scope_id.as_str())
        .execute(&mut *transaction)
        .await
        .map_err(persistence_error)?;
    }
    transaction.commit().await.map_err(persistence_error)
}

async fn mark_promotion_failed(
    pool: &SqlitePool,
    promotion_id: &ChatScratchPromotionId,
    error_code: &str,
    now: &UtcTimestamp,
) -> ChatResult<()> {
    sqlx::query(
        "UPDATE chat_scratch_promotions
         SET state = 'failed', last_error_code = ?, updated_at = ?
         WHERE id = ? AND state = 'pending'",
    )
    .bind(error_code)
    .bind(now.as_str())
    .bind(promotion_id.as_str())
    .execute(pool)
    .await
    .map_err(persistence_error)?;
    Ok(())
}

async fn read_idempotent_promotion(
    pool: &SqlitePool,
    promotion_id: &ChatScratchPromotionId,
    request_digest: &str,
) -> ChatResult<ChatScratchPromotionResultRead> {
    let row = sqlx::query(
        "SELECT scratch_generation_id, source_relative_path, source_sha256,
                request_digest, destination_kind, destination_channel_id,
                destination_working_folder_id, destination_relative_path,
                attachment_id, state, created_at
         FROM chat_scratch_promotions WHERE id = ?",
    )
    .bind(promotion_id.as_str())
    .fetch_optional(pool)
    .await
    .map_err(persistence_error)?
    .ok_or_else(corrupt_scratch)?;
    let stored_digest: Option<String> = row.try_get("request_digest").map_err(persistence_error)?;
    if stored_digest.as_deref() != Some(request_digest) {
        return Err(ChatError::new(
            ChatErrorCode::Conflict,
            "Scratch promotion ID is already bound to another request",
            false,
        ));
    }
    let state: String = row.try_get("state").map_err(persistence_error)?;
    if state != "completed" {
        let (message, retryable) = if state == "pending" {
            ("Scratch promotion is still in progress", true)
        } else {
            ("Scratch promotion already failed", false)
        };
        return Err(ChatError::new(ChatErrorCode::Conflict, message, retryable));
    }
    let destination_kind: String = row.try_get("destination_kind").map_err(persistence_error)?;
    let destination = match destination_kind.as_str() {
        "working_folder" => ChatScratchPromotionDestinationRead::WorkingFolder {
            working_folder_id: parse_id(
                row.try_get("destination_working_folder_id")
                    .map_err(persistence_error)?,
            )?,
            relative_path: row
                .try_get("destination_relative_path")
                .map_err(persistence_error)?,
        },
        "managed_attachment" => ChatScratchPromotionDestinationRead::ManagedAttachment {
            channel_id: parse_id(
                row.try_get("destination_channel_id")
                    .map_err(persistence_error)?,
            )?,
            attachment_id: parse_id(row.try_get("attachment_id").map_err(persistence_error)?)?,
        },
        _ => return Err(corrupt_scratch()),
    };
    Ok(ChatScratchPromotionResultRead {
        id: promotion_id.clone(),
        scratch_generation_id: parse_id(
            row.try_get("scratch_generation_id")
                .map_err(persistence_error)?,
        )?,
        source_relative_path: row
            .try_get("source_relative_path")
            .map_err(persistence_error)?,
        source_sha256: row
            .try_get::<Option<String>, _>("source_sha256")
            .map_err(persistence_error)?
            .ok_or_else(corrupt_scratch)?,
        destination,
        created_at: timestamp(row.try_get("created_at").map_err(persistence_error)?)?,
    })
}

async fn scratch_promotion_exists(
    pool: &SqlitePool,
    promotion_id: &ChatScratchPromotionId,
) -> ChatResult<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM chat_scratch_promotions WHERE id = ?)")
        .bind(promotion_id.as_str())
        .fetch_one(pool)
        .await
        .map_err(persistence_error)
}

fn scratch_promotion_request_digest(request: &PromoteChatScratchFileCommand) -> String {
    let mut digest = Sha256::new();
    digest.update(b"scratch-promotion-v1\0");
    update_digest_field(&mut digest, request.scratch_generation_id.as_str());
    update_digest_field(&mut digest, &request.source_relative_path);
    update_digest_field(&mut digest, &request.expected_content_revision);
    match &request.destination {
        ChatScratchPromotionDestinationInput::WorkingFolder {
            channel_id,
            working_folder_id,
            relative_path,
        } => {
            update_digest_field(&mut digest, "working_folder");
            update_digest_field(&mut digest, channel_id.as_str());
            update_digest_field(&mut digest, working_folder_id.as_str());
            update_digest_field(&mut digest, relative_path);
        }
        ChatScratchPromotionDestinationInput::ManagedAttachment {
            channel_id,
            attachment_id,
            display_name,
        } => {
            update_digest_field(&mut digest, "managed_attachment");
            update_digest_field(&mut digest, channel_id.as_str());
            update_digest_field(&mut digest, attachment_id.as_str());
            update_digest_field(&mut digest, display_name.trim());
        }
    }
    format!("{:x}", digest.finalize())
}

fn update_digest_field(digest: &mut Sha256, value: &str) {
    digest.update((value.len() as u64).to_be_bytes());
    digest.update(value.as_bytes());
}

fn supported_attachment_kind(bytes: &[u8]) -> ChatResult<ChatAttachmentKind> {
    if !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok() {
        return Ok(ChatAttachmentKind::TextSnippet);
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || bytes.starts_with(&[0xff, 0xd8, 0xff])
        || bytes.starts_with(b"GIF87a")
        || bytes.starts_with(b"GIF89a")
        || bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
    {
        return Ok(ChatAttachmentKind::Image);
    }
    Err(ChatError::validation(
        "destination",
        "Managed Chat attachments currently accept images and UTF-8 text artifacts",
    ))
}

fn validate_attachment_display_name(value: &str) -> ChatResult<()> {
    let value = value.trim();
    if value.is_empty() || value.len() > 1_000 || value.chars().any(char::is_control) {
        return Err(ChatError::validation(
            "displayName",
            "Attachment display name is invalid",
        ));
    }
    Ok(())
}

fn validate_content_revision(value: &str) -> ChatResult<()> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ChatError::validation(
            "expectedContentRevision",
            "Scratch content revision is invalid",
        ));
    }
    Ok(())
}

fn validate_optional_relative_path(value: &str) -> ChatResult<()> {
    if value.is_empty() {
        Ok(())
    } else {
        validate_required_relative_path(value)
    }
}

fn validate_required_relative_path(value: &str) -> ChatResult<()> {
    let path = Path::new(value);
    if value.is_empty()
        || value.len() > MAX_RELATIVE_PATH_BYTES
        || path.is_absolute()
        || value.contains('\\')
        || value.chars().any(char::is_control)
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(ChatError::validation(
            "relativePath",
            "Scratch paths must be normalized relative paths",
        ));
    }
    Ok(())
}

fn scratch_file_revision(relative_path: &str, bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"scratch-file-v1\0");
    digest.update(relative_path.as_bytes());
    digest.update(b"\0");
    digest.update(bytes);
    format!("{:x}", digest.finalize())
}

fn directory_cursor(relative_path: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"scratch-directory-cursor-v1\0");
    digest.update(relative_path.as_bytes());
    format!("{:x}", digest.finalize())
}

const fn entry_kind_rank(kind: ChatScratchDirectoryEntryKind) -> u8 {
    match kind {
        ChatScratchDirectoryEntryKind::Directory => 0,
        ChatScratchDirectoryEntryKind::File => 1,
    }
}

fn folder_capability_rank(value: &str) -> ChatResult<u8> {
    match value {
        "none" => Ok(0),
        "read" => Ok(1),
        "edit" => Ok(2),
        "execute" => Ok(3),
        "publish" => Ok(4),
        _ => Err(corrupt_scratch()),
    }
}

fn parse_scope_lifecycle(value: &str) -> ChatResult<ChatScratchScopeLifecycleState> {
    match value {
        "active" => Ok(ChatScratchScopeLifecycleState::Active),
        "archived" => Ok(ChatScratchScopeLifecycleState::Archived),
        "cleanup_pending" => Ok(ChatScratchScopeLifecycleState::CleanupPending),
        "cleanup_failed" => Ok(ChatScratchScopeLifecycleState::CleanupFailed),
        "removed" => Ok(ChatScratchScopeLifecycleState::Removed),
        _ => Err(corrupt_scratch()),
    }
}

fn parse_generation_lifecycle(value: &str) -> ChatResult<ChatScratchGenerationLifecycleState> {
    match value {
        "active" => Ok(ChatScratchGenerationLifecycleState::Active),
        "quarantined" => Ok(ChatScratchGenerationLifecycleState::Quarantined),
        "cleanup_pending" => Ok(ChatScratchGenerationLifecycleState::CleanupPending),
        "cleanup_failed" => Ok(ChatScratchGenerationLifecycleState::CleanupFailed),
        "removed" => Ok(ChatScratchGenerationLifecycleState::Removed),
        _ => Err(corrupt_scratch()),
    }
}

fn parse_id<T>(value: String) -> ChatResult<T>
where
    T: TryFrom<String, Error = String>,
{
    T::try_from(value).map_err(identifier_error)
}

fn new_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{prefix}:{:x}:{sequence:x}", nanos)
}

fn scratch_not_found() -> ChatError {
    ChatError::new(
        ChatErrorCode::NotFound,
        "Private scratch generation was not found",
        true,
    )
}

fn scratch_path_error() -> ChatError {
    ChatError::new(
        ChatErrorCode::Permission,
        "Private scratch path is unavailable or symbolic",
        false,
    )
}

fn corrupt_scratch() -> ChatError {
    ChatError::new(
        ChatErrorCode::Persistence,
        "Stored private scratch state is invalid",
        false,
    )
}

fn vault_error<T>(_error: T) -> ChatError {
    ChatError::new(
        ChatErrorCode::Persistence,
        "The active vault path is unavailable",
        true,
    )
}

fn device_state_error<T>(_error: T) -> ChatError {
    ChatError::new(
        ChatErrorCode::Persistence,
        "Private scratch device state could not be updated",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scratch_relative_paths_reject_traversal_and_platform_separators() {
        assert!(validate_required_relative_path("artifacts/report.txt").is_ok());
        assert!(validate_required_relative_path("../outside").is_err());
        assert!(validate_required_relative_path("artifacts/../outside").is_err());
        assert!(validate_required_relative_path("artifacts\\outside").is_err());
        assert!(validate_required_relative_path("/outside").is_err());
    }

    #[test]
    fn revisions_bind_the_relative_path_and_bytes() {
        let first = scratch_file_revision("one.txt", b"same");
        let second = scratch_file_revision("two.txt", b"same");
        let changed = scratch_file_revision("one.txt", b"changed");
        assert_ne!(first, second);
        assert_ne!(first, changed);
        assert_eq!(first.len(), 64);
    }

    #[test]
    fn managed_attachment_detection_is_closed_world() {
        assert!(matches!(
            supported_attachment_kind(b"text"),
            Ok(ChatAttachmentKind::TextSnippet)
        ));
        assert!(matches!(
            supported_attachment_kind(b"\x89PNG\r\n\x1a\nrest"),
            Ok(ChatAttachmentKind::Image)
        ));
        assert!(supported_attachment_kind(&[0, 1, 2, 3]).is_err());
    }

    #[test]
    fn promotion_idempotency_digest_binds_the_channel_and_exact_destination() {
        let request = PromoteChatScratchFileCommand {
            promotion_id: ChatScratchPromotionId::new("promotion:test").unwrap(),
            scratch_generation_id: ChatScratchGenerationId::new("generation:test").unwrap(),
            source_relative_path: "reports/result.md".to_string(),
            expected_content_revision: "a".repeat(64),
            destination: ChatScratchPromotionDestinationInput::ManagedAttachment {
                channel_id: ChatChannelId::new("channel:general").unwrap(),
                attachment_id: ChatAttachmentId::new("attachment:result").unwrap(),
                display_name: "result.md".to_string(),
            },
        };
        let other_channel = PromoteChatScratchFileCommand {
            promotion_id: ChatScratchPromotionId::new("promotion:test").unwrap(),
            scratch_generation_id: ChatScratchGenerationId::new("generation:test").unwrap(),
            source_relative_path: "reports/result.md".to_string(),
            expected_content_revision: "a".repeat(64),
            destination: ChatScratchPromotionDestinationInput::ManagedAttachment {
                channel_id: ChatChannelId::new("channel:private").unwrap(),
                attachment_id: ChatAttachmentId::new("attachment:result").unwrap(),
                display_name: "result.md".to_string(),
            },
        };
        let other_name = PromoteChatScratchFileCommand {
            promotion_id: ChatScratchPromotionId::new("promotion:test").unwrap(),
            scratch_generation_id: ChatScratchGenerationId::new("generation:test").unwrap(),
            source_relative_path: "reports/result.md".to_string(),
            expected_content_revision: "a".repeat(64),
            destination: ChatScratchPromotionDestinationInput::ManagedAttachment {
                channel_id: ChatChannelId::new("channel:general").unwrap(),
                attachment_id: ChatAttachmentId::new("attachment:result").unwrap(),
                display_name: "renamed.md".to_string(),
            },
        };

        let digest = scratch_promotion_request_digest(&request);
        assert_eq!(digest.len(), 64);
        assert_ne!(digest, scratch_promotion_request_digest(&other_channel));
        assert_ne!(digest, scratch_promotion_request_digest(&other_name));
    }
}
