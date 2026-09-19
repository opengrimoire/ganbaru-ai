//! Authorized commands for runtime terminals and explicit terminal context.

use super::models::{
    ChatAttachmentId, ChatError, ChatErrorCode, ChatResult, ChatThreadId, ProjectWorkingFolderId,
    UtcTimestamp,
};
use super::repository::attachments;
use super::terminal::{
    ChatTerminalCloseResult, ChatTerminalCreateInput, ChatTerminalRead, ChatTerminalRegistry,
    ChatTerminalSnapshotRead,
};
use super::workspace::{AuthorizedWorkingFolder, WorkingFolderAuthorizationOperation};
use super::workspace_commands::authorize_working_folder;
use crate::{db_path, vault};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Row, SqlitePool};
use tauri::Manager;

const MAX_CONTEXT_BYTES: usize = 128 * 1024;
const MAX_CONTEXT_PREVIEW_BYTES: usize = 4 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatTerminalRequest {
    pub terminal_id: String,
    pub thread_id: ChatThreadId,
    pub working_folder_id: ProjectWorkingFolderId,
    pub columns: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTerminalInputRequest {
    pub terminal_id: String,
    pub thread_id: ChatThreadId,
    pub working_folder_id: ProjectWorkingFolderId,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTerminalResizeRequest {
    pub terminal_id: String,
    pub thread_id: ChatThreadId,
    pub working_folder_id: ProjectWorkingFolderId,
    pub columns: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportChatTerminalContextRequest {
    pub terminal_id: String,
    pub thread_id: ChatThreadId,
    pub working_folder_id: ProjectWorkingFolderId,
    pub attachment_id: ChatAttachmentId,
    pub source_kind: String,
    pub text: String,
    pub start_output_sequence: Option<u64>,
    pub end_output_sequence: Option<u64>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTerminalContextRead {
    pub attachment_id: ChatAttachmentId,
    pub terminal_id: String,
    pub terminal_name: String,
    pub captured_at: UtcTimestamp,
    pub byte_size: u64,
    pub line_count: u64,
    pub preview: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTerminalPanelLayout {
    pub placement: String,
    pub terminal_names: Vec<String>,
    pub selected_index: Option<u64>,
    pub split_direction: String,
    pub split_sizes: Vec<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTerminalLayoutRead {
    pub thread_id: ChatThreadId,
    pub schema_version: u32,
    pub groups: Vec<ChatTerminalPanelLayout>,
    pub updated_at: Option<UtcTimestamp>,
}

#[tauri::command]
pub async fn chat_list_terminals(
    app: tauri::AppHandle,
    db_url: String,
    thread_id: ChatThreadId,
    working_folder_id: ProjectWorkingFolderId,
) -> ChatResult<Vec<ChatTerminalRead>> {
    let pool = chat_pool(app.clone(), db_url).await?;
    authorize_thread_workspace(&app, &pool, &thread_id, &working_folder_id).await?;
    app.state::<ChatTerminalRegistry>()
        .list(&thread_id, &working_folder_id)
}

#[tauri::command]
pub async fn chat_read_terminal_layout(
    app: tauri::AppHandle,
    db_url: String,
    thread_id: ChatThreadId,
) -> ChatResult<ChatTerminalLayoutRead> {
    let pool = chat_pool(app, db_url).await?;
    let row = sqlx::query(
        "SELECT layout_schema_version, layout_data, updated_at
         FROM chat_terminal_layouts WHERE thread_id = ?",
    )
    .bind(thread_id.as_str())
    .fetch_optional(&pool)
    .await
    .map_err(persistence_error)?;
    let Some(row) = row else {
        return Ok(ChatTerminalLayoutRead {
            thread_id,
            schema_version: 1,
            groups: Vec::new(),
            updated_at: None,
        });
    };
    let schema_version = u32::try_from(
        row.try_get::<i64, _>("layout_schema_version")
            .map_err(persistence_error)?,
    )
    .map_err(|_| persistence_error("invalid terminal layout schema"))?;
    let value: serde_json::Value = serde_json::from_str(
        &row.try_get::<String, _>("layout_data")
            .map_err(persistence_error)?,
    )
    .map_err(persistence_error)?;
    let groups: Vec<ChatTerminalPanelLayout> =
        serde_json::from_value(value.get("groups").cloned().unwrap_or_else(|| json!([])))
            .map_err(persistence_error)?;
    validate_terminal_layout_groups(&groups)?;
    Ok(ChatTerminalLayoutRead {
        thread_id,
        schema_version,
        groups,
        updated_at: Some(
            UtcTimestamp::new(
                row.try_get::<String, _>("updated_at")
                    .map_err(persistence_error)?,
            )
            .map_err(persistence_error)?,
        ),
    })
}

#[tauri::command]
pub async fn chat_save_terminal_panel_layout(
    app: tauri::AppHandle,
    db_url: String,
    thread_id: ChatThreadId,
    panel: ChatTerminalPanelLayout,
) -> ChatResult<ChatTerminalLayoutRead> {
    validate_terminal_layout_groups(std::slice::from_ref(&panel))?;
    let pool = chat_pool(app, db_url).await?;
    let mut transaction = pool.begin().await.map_err(persistence_error)?;
    let existing: Option<String> =
        sqlx::query_scalar("SELECT layout_data FROM chat_terminal_layouts WHERE thread_id = ?")
            .bind(thread_id.as_str())
            .fetch_optional(&mut *transaction)
            .await
            .map_err(persistence_error)?;
    let mut groups = existing
        .map(|data| -> ChatResult<Vec<ChatTerminalPanelLayout>> {
            let value: serde_json::Value =
                serde_json::from_str(&data).map_err(persistence_error)?;
            serde_json::from_value(value.get("groups").cloned().unwrap_or_else(|| json!([])))
                .map_err(persistence_error)
        })
        .transpose()?
        .unwrap_or_default();
    validate_terminal_layout_groups(&groups)?;
    groups.retain(|group| group.placement != panel.placement);
    groups.push(panel);
    groups.sort_by(|left, right| left.placement.cmp(&right.placement));
    let now = now_timestamp()?;
    let data = serde_json::to_string(&json!({ "groups": groups })).map_err(persistence_error)?;
    sqlx::query(
        "INSERT INTO chat_terminal_layouts
            (thread_id, layout_schema_version, layout_data, updated_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
            layout_schema_version = excluded.layout_schema_version,
            layout_data = excluded.layout_data,
            updated_at = excluded.updated_at",
    )
    .bind(thread_id.as_str())
    .bind(data)
    .bind(now.as_str())
    .execute(&mut *transaction)
    .await
    .map_err(persistence_error)?;
    transaction.commit().await.map_err(persistence_error)?;
    Ok(ChatTerminalLayoutRead {
        thread_id,
        schema_version: 1,
        groups,
        updated_at: Some(now),
    })
}

fn validate_terminal_layout_groups(groups: &[ChatTerminalPanelLayout]) -> ChatResult<()> {
    if groups.len() > 2 {
        return Err(ChatError::validation(
            "groups",
            "Terminal layout has too many groups",
        ));
    }
    for group in groups {
        if !matches!(group.placement.as_str(), "inspector" | "bottom")
            || !matches!(group.split_direction.as_str(), "horizontal" | "vertical")
            || group.terminal_names.len() > 8
            || group.terminal_names.iter().any(|name| {
                name.trim().is_empty() || name.len() > 100 || name.chars().any(char::is_control)
            })
            || (!group.split_sizes.is_empty()
                && group.split_sizes.len() != group.terminal_names.len())
            || group
                .split_sizes
                .iter()
                .any(|size| *size == 0 || *size > 10_000)
            || group
                .selected_index
                .is_some_and(|index| index as usize >= group.terminal_names.len())
        {
            return Err(ChatError::validation(
                "layout",
                "Terminal layout is invalid",
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn chat_terminal_create(
    app: tauri::AppHandle,
    db_url: String,
    request: CreateChatTerminalRequest,
) -> ChatResult<ChatTerminalSnapshotRead> {
    let pool = chat_pool(app.clone(), db_url).await?;
    let authorized =
        authorize_thread_workspace(&app, &pool, &request.thread_id, &request.working_folder_id)
            .await?;
    app.state::<ChatTerminalRegistry>().create(
        app.clone(),
        ChatTerminalCreateInput {
            terminal_id: request.terminal_id,
            thread_id: request.thread_id,
            working_folder_id: request.working_folder_id,
            workspace_path: authorized.canonical_path,
            columns: request.columns,
            rows: request.rows,
        },
    )
}

#[tauri::command]
pub async fn chat_terminal_snapshot(
    app: tauri::AppHandle,
    db_url: String,
    terminal_id: String,
    thread_id: ChatThreadId,
    working_folder_id: ProjectWorkingFolderId,
) -> ChatResult<ChatTerminalSnapshotRead> {
    let pool = chat_pool(app.clone(), db_url).await?;
    authorize_thread_workspace(&app, &pool, &thread_id, &working_folder_id).await?;
    let registry = app.state::<ChatTerminalRegistry>();
    registry.require_scope(&terminal_id, &thread_id, &working_folder_id)?;
    registry.snapshot(&terminal_id)
}

#[tauri::command]
pub async fn chat_terminal_input(
    app: tauri::AppHandle,
    db_url: String,
    request: ChatTerminalInputRequest,
) -> ChatResult<()> {
    let pool = chat_pool(app.clone(), db_url).await?;
    authorize_thread_workspace(&app, &pool, &request.thread_id, &request.working_folder_id).await?;
    let registry = app.state::<ChatTerminalRegistry>();
    registry.require_scope(
        &request.terminal_id,
        &request.thread_id,
        &request.working_folder_id,
    )?;
    registry.input(&request.terminal_id, &request.text)
}

#[tauri::command]
pub async fn chat_terminal_resize(
    app: tauri::AppHandle,
    db_url: String,
    request: ChatTerminalResizeRequest,
) -> ChatResult<()> {
    let pool = chat_pool(app.clone(), db_url).await?;
    authorize_thread_workspace(&app, &pool, &request.thread_id, &request.working_folder_id).await?;
    let registry = app.state::<ChatTerminalRegistry>();
    registry.require_scope(
        &request.terminal_id,
        &request.thread_id,
        &request.working_folder_id,
    )?;
    registry.resize(&request.terminal_id, request.columns, request.rows)
}

#[tauri::command]
pub async fn chat_terminal_close(
    app: tauri::AppHandle,
    db_url: String,
    terminal_id: String,
    thread_id: ChatThreadId,
    working_folder_id: ProjectWorkingFolderId,
    confirmed: bool,
) -> ChatResult<ChatTerminalCloseResult> {
    let pool = chat_pool(app.clone(), db_url).await?;
    authorize_thread_workspace(&app, &pool, &thread_id, &working_folder_id).await?;
    let registry = app.state::<ChatTerminalRegistry>();
    registry.require_scope(&terminal_id, &thread_id, &working_folder_id)?;
    registry.close(&terminal_id, confirmed)
}

#[tauri::command]
pub async fn chat_terminal_import_context(
    app: tauri::AppHandle,
    db_url: String,
    request: ImportChatTerminalContextRequest,
) -> ChatResult<ChatTerminalContextRead> {
    validate_context(&request)?;
    let pool = chat_pool(app.clone(), db_url).await?;
    authorize_thread_workspace(&app, &pool, &request.thread_id, &request.working_folder_id).await?;
    let registry = app.state::<ChatTerminalRegistry>();
    registry.require_scope(
        &request.terminal_id,
        &request.thread_id,
        &request.working_folder_id,
    )?;
    let terminal = registry.snapshot(&request.terminal_id)?.terminal;
    let now = now_timestamp()?;
    let line_count = if request.text.is_empty() {
        0
    } else {
        request.text.lines().count() as u64
    };
    let display_name = format!("{} terminal context.txt", terminal.name);
    let attachment = attachments::import_attachment_bytes(
        &pool,
        &vault::active_writable_vault_path(&app).map_err(vault_error)?,
        attachments::AttachmentBytesImport {
            working_folder_id: &request.working_folder_id,
            attachment_id: request.attachment_id.clone(),
            display_name,
            bytes: request.text.as_bytes(),
            requested_kind: attachments::ChatAttachmentKind::TextSnippet,
            now: &now,
        },
    )
    .await?;
    sqlx::query(
        "INSERT INTO chat_terminal_attachment_contexts
            (attachment_id, terminal_runtime_id, terminal_name_snapshot, source_kind,
             start_output_sequence, end_output_sequence, line_count, truncated, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(request.attachment_id.as_str())
    .bind(&request.terminal_id)
    .bind(&terminal.name)
    .bind(&request.source_kind)
    .bind(request.start_output_sequence.map(i64_value).transpose()?)
    .bind(request.end_output_sequence.map(i64_value).transpose()?)
    .bind(i64_value(line_count)?)
    .bind(request.truncated)
    .bind(now.as_str())
    .execute(&pool)
    .await
    .map_err(persistence_error)?;
    Ok(ChatTerminalContextRead {
        attachment_id: attachment.id,
        terminal_id: request.terminal_id,
        terminal_name: terminal.name,
        captured_at: now,
        byte_size: attachment.byte_size,
        line_count,
        preview: bounded_preview(&request.text),
        truncated: request.truncated,
    })
}

async fn authorize_thread_workspace(
    app: &tauri::AppHandle,
    pool: &SqlitePool,
    thread_id: &ChatThreadId,
    working_folder_id: &ProjectWorkingFolderId,
) -> ChatResult<AuthorizedWorkingFolder> {
    let row = sqlx::query(
        "SELECT working_folder_id, state, execution_environment_id
         FROM chat_threads WHERE id = ?",
    )
    .bind(thread_id.as_str())
    .fetch_optional(pool)
    .await
    .map_err(persistence_error)?;
    let stored_scope = row
        .as_ref()
        .map(|row| -> ChatResult<(String, String, Option<String>)> {
            Ok((
                row.try_get::<String, _>("working_folder_id")
                    .map_err(persistence_error)?,
                row.try_get::<String, _>("state")
                    .map_err(persistence_error)?,
                row.try_get::<Option<String>, _>("execution_environment_id")
                    .map_err(persistence_error)?,
            ))
        })
        .transpose()?;
    validate_terminal_thread_scope(stored_scope.as_ref(), working_folder_id)?;
    let authorized = authorize_working_folder(
        app,
        pool,
        working_folder_id,
        WorkingFolderAuthorizationOperation::TerminalStart,
    )
    .await?;
    super::execution_environment::resolve_environment_workspace(
        app,
        pool,
        authorized,
        stored_scope
            .as_ref()
            .and_then(|(_, _, environment_id)| environment_id.as_deref()),
    )
    .await
}

fn validate_terminal_thread_scope(
    stored_scope: Option<&(String, String, Option<String>)>,
    working_folder_id: &ProjectWorkingFolderId,
) -> ChatResult<()> {
    let Some((stored_workspace, state, _)) = stored_scope else {
        return Ok(());
    };
    if state == "closed" {
        return Err(ChatError::new(
            ChatErrorCode::NotFound,
            "Chat thread was not found",
            true,
        ));
    }
    if stored_workspace != working_folder_id.as_str() {
        return Err(ChatError::new(
            ChatErrorCode::Permission,
            "Chat terminal workspace does not match the thread",
            false,
        ));
    }
    Ok(())
}

fn validate_context(request: &ImportChatTerminalContextRequest) -> ChatResult<()> {
    if !matches!(
        request.source_kind.as_str(),
        "selection" | "last_command_output"
    ) || request.text.is_empty()
        || request.text.len() > MAX_CONTEXT_BYTES
        || request.text.contains('\0')
        || request
            .start_output_sequence
            .zip(request.end_output_sequence)
            .is_some_and(|(start, end)| start > end)
    {
        return Err(ChatError::validation(
            "terminalContext",
            "Terminal context selection is invalid",
        ));
    }
    Ok(())
}

fn bounded_preview(text: &str) -> String {
    if text.len() <= MAX_CONTEXT_PREVIEW_BYTES {
        return text.to_string();
    }
    let mut boundary = MAX_CONTEXT_PREVIEW_BYTES;
    while !text.is_char_boundary(boundary) {
        boundary -= 1;
    }
    text[..boundary].to_string()
}

fn now_timestamp() -> ChatResult<UtcTimestamp> {
    let now: chrono::DateTime<Utc> = std::time::SystemTime::now().into();
    UtcTimestamp::new(now.to_rfc3339_opts(SecondsFormat::Millis, true))
        .map_err(|_| ChatError::new(ChatErrorCode::Internal, "create Chat timestamp", false))
}

async fn chat_pool(app: tauri::AppHandle, db_url: String) -> ChatResult<SqlitePool> {
    db_path::connect_sqlite(app, db_url)
        .await
        .map_err(|_| ChatError::new(ChatErrorCode::Persistence, "open Chat database", true))
}

fn i64_value(value: u64) -> ChatResult<i64> {
    i64::try_from(value).map_err(|_| ChatError::validation("number", "Value is too large"))
}

fn vault_error<T>(_error: T) -> ChatError {
    ChatError::new(
        ChatErrorCode::Persistence,
        "Active Ganbaru folder is unavailable",
        true,
    )
}

fn persistence_error<T>(_error: T) -> ChatError {
    ChatError::new(
        ChatErrorCode::Persistence,
        "Chat terminal context persistence failed",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(text: &str) -> ImportChatTerminalContextRequest {
        ImportChatTerminalContextRequest {
            terminal_id: "terminal:test".to_string(),
            thread_id: ChatThreadId::new("thread:test").expect("thread ID should be valid"),
            working_folder_id: ProjectWorkingFolderId::new("workspace:test")
                .expect("workspace ID should be valid"),
            attachment_id: ChatAttachmentId::new("attachment:test")
                .expect("attachment ID should be valid"),
            source_kind: "selection".to_string(),
            text: text.to_string(),
            start_output_sequence: Some(1),
            end_output_sequence: Some(2),
            truncated: false,
        }
    }

    #[test]
    fn terminal_context_requires_bounded_ordered_text_and_known_sources() {
        assert!(validate_context(&request("context")).is_ok());
        assert!(validate_context(&request("")).is_err());
        let mut reversed = request("context");
        reversed.start_output_sequence = Some(3);
        assert!(validate_context(&reversed).is_err());
        let mut unknown = request("context");
        unknown.source_kind = "screen".to_string();
        assert!(validate_context(&unknown).is_err());
    }

    #[test]
    fn context_preview_stops_at_a_utf8_boundary() {
        let text = "é".repeat(MAX_CONTEXT_PREVIEW_BYTES);
        let preview = bounded_preview(&text);
        assert!(preview.is_char_boundary(preview.len()));
        assert!(preview.len() <= MAX_CONTEXT_PREVIEW_BYTES);
    }

    #[test]
    fn terminal_scope_allows_provisional_threads_but_rejects_closed_or_cross_workspace_threads() {
        let workspace =
            ProjectWorkingFolderId::new("workspace:test").expect("workspace ID should be valid");
        assert!(validate_terminal_thread_scope(None, &workspace).is_ok());
        assert!(
            validate_terminal_thread_scope(
                Some(&("workspace:test".to_string(), "active".to_string(), None,)),
                &workspace,
            )
            .is_ok()
        );

        let closed = validate_terminal_thread_scope(
            Some(&("workspace:test".to_string(), "closed".to_string(), None)),
            &workspace,
        )
        .expect_err("closed threads must not authorize terminals");
        assert_eq!(closed.code, ChatErrorCode::NotFound);

        let mismatched = validate_terminal_thread_scope(
            Some(&("workspace:other".to_string(), "active".to_string(), None)),
            &workspace,
        )
        .expect_err("cross-workspace threads must not authorize terminals");
        assert_eq!(mismatched.code, ChatErrorCode::Permission);
    }
}
