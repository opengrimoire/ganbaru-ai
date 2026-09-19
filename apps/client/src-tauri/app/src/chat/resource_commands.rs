use super::models::{ChatError, ChatErrorCode, ChatResult, ChatThreadId};
use super::repository::resources::{self, ChatResourceKind, ChatResourceRead};
use crate::{db_path, vault};
use base64::{Engine as _, engine::general_purpose};
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResourceContentRead {
    pub resource: ChatResourceRead,
    pub text: Option<String>,
    pub data_base64: Option<String>,
}

#[tauri::command]
pub async fn chat_resource_list(
    app: tauri::AppHandle,
    db_url: String,
    thread_id: ChatThreadId,
) -> ChatResult<Vec<ChatResourceRead>> {
    let pool = chat_pool(app, db_url).await?;
    resources::list_thread_resources(&pool, &thread_id).await
}

#[tauri::command]
pub async fn chat_resource_read(
    app: tauri::AppHandle,
    db_url: String,
    thread_id: ChatThreadId,
    resource_id: String,
) -> ChatResult<ChatResourceContentRead> {
    let pool = chat_pool(app.clone(), db_url).await?;
    let vault_root = vault::active_vault_path(&app).map_err(|_| {
        ChatError::new(
            ChatErrorCode::Persistence,
            "Active Ganbaru folder is unavailable",
            true,
        )
    })?;
    let (resource, bytes) =
        resources::read_thread_resource_bytes(&pool, &vault_root, &thread_id, &resource_id).await?;
    match resource.kind {
        ChatResourceKind::TextSnippet => Ok(ChatResourceContentRead {
            resource,
            text: Some(String::from_utf8(bytes).map_err(|_| {
                ChatError::new(
                    ChatErrorCode::Conflict,
                    "Managed Chat text resource is not valid UTF-8",
                    true,
                )
            })?),
            data_base64: None,
        }),
        ChatResourceKind::Image
        | ChatResourceKind::BrowserScreenshot
        | ChatResourceKind::BrowserRecording => Ok(ChatResourceContentRead {
            resource,
            text: None,
            data_base64: Some(general_purpose::STANDARD.encode(bytes)),
        }),
    }
}

async fn chat_pool(app: tauri::AppHandle, db_url: String) -> ChatResult<SqlitePool> {
    db_path::connect_sqlite(app, db_url)
        .await
        .map_err(|_| ChatError::new(ChatErrorCode::Persistence, "open Chat database", true))
}
