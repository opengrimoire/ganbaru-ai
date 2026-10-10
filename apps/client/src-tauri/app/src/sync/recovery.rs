//! Recovery offers: deleted rows that kept edits their deletion did not see. Listing reads the
//! engine directly; restoring and discarding seal with the local writer, so the service runs
//! them inside a pass.

use super::writer::ActiveWriter;
use ganbaru_sync::manifest::vault::quick_notes::{NOTES, NOTES_TABLE};
use ganbaru_sync::{DeviceRef, Engine, SpaceContext, local};
use ganbaru_sync_contracts::TableId;
use serde::{Deserialize, Serialize};
use sqlx::pool::PoolConnection;
use sqlx::{Sqlite, SqlitePool};
use tauri::{AppHandle, Runtime};
use tokio::sync::oneshot;

/// A deleted row with edits the deletion did not see.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryEntryView {
    /// Domain table, by name.
    pub table: String,
    pub row_key: String,
    pub title: String,
    pub preview: String,
    /// Device of the newest unseen edit.
    pub device: DeviceRef,
    /// When that edit was made, in Unix milliseconds.
    pub edited_at_ms: u64,
}

/// What to do with a recovery offer.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RecoveryAction {
    /// Create a new row from the retained values, then close the offer.
    Restore,
    /// Close the offer without restoring.
    Discard,
}

/// A recovery action on one offer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RecoveryChoice {
    pub table: TableId,
    pub row_key: String,
    pub action: RecoveryAction,
}

/// A recovery action waiting for the service, which owns the local writer.
pub(crate) struct RecoveryRequest {
    pub choice: RecoveryChoice,
    /// Receives the id of the restored row, if any.
    pub reply: oneshot::Sender<Result<Option<String>, String>>,
}

/// Table id of a recoverable table name; only Quick notes offer recovery in this version.
pub(crate) fn recoverable_table(name: &str) -> Result<TableId, String> {
    if name == NOTES.name {
        Ok(NOTES_TABLE)
    } else {
        Err(format!("{name} rows cannot be recovered"))
    }
}

/// Recovery offers of the active vault, newest edit first.
pub(crate) async fn list<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<RecoveryEntryView>, String> {
    let Some(pool) = crate::db::connect_active_vault_for_sync(app).await? else {
        return Ok(Vec::new());
    };
    let vault_id = crate::vault::active_vault_id(app)?;
    let engine = Engine::vault();
    let mut conn = pool
        .acquire()
        .await
        .map_err(|error| format!("acquire sync connection: {error}"))?;
    let Some(ctx) = local::space_context(&mut conn, &vault_id)
        .await
        .map_err(|error| format!("read sync space: {error}"))?
    else {
        return Ok(Vec::new());
    };
    let entries = engine
        .recovery_entries(&mut conn, &ctx)
        .await
        .map_err(|error| format!("read recovery offers: {error}"))?;
    drop(conn);
    let devices = super::devices::read(app)?;
    let mut views: Vec<RecoveryEntryView> = entries
        .into_iter()
        .filter_map(|entry| {
            let table = engine.manifest().table(entry.table)?;
            Some(RecoveryEntryView {
                table: table.name.to_string(),
                row_key: entry.row_key,
                title: entry.presentation.title,
                preview: entry.presentation.preview,
                device: devices.describe(&entry.device_id),
                edited_at_ms: entry.clock.physical_ms(),
            })
        })
        .collect();
    views.sort_by(|left, right| {
        right
            .edited_at_ms
            .cmp(&left.edited_at_ms)
            .then_with(|| left.row_key.cmp(&right.row_key))
    });
    Ok(views)
}

/// Restores or discards a recovery offer, then closes it with a tombstone that covers every
/// retained version. Returns the id of the restored row.
pub(super) async fn close(
    engine: &Engine,
    pool: &SqlitePool,
    ctx: &SpaceContext,
    writer: &mut ActiveWriter,
    choice: &RecoveryChoice,
    now_ms: u64,
) -> Result<Option<String>, String> {
    let (table, row_key) = (choice.table, choice.row_key.as_str());
    let restored = match choice.action {
        RecoveryAction::Discard => None,
        RecoveryAction::Restore => {
            let values = {
                let mut conn = acquire(pool).await?;
                engine
                    .recovery_values(&mut conn, table, row_key)
                    .await
                    .map_err(|error| format!("read recovered values: {error}"))?
            }
            .ok_or_else(|| "the recovery offer is closed".to_string())?;
            Some(ganbaru_quick_notes::restore_recovered(pool, &values).await?)
        }
    };
    let report = {
        let mut conn = acquire(pool).await?;
        engine
            .close_recovery(&mut conn, ctx, table, row_key, &mut writer.local(), now_ms)
            .await
            .map_err(|error| format!("close recovery offer: {error}"))?
    };
    if let Some(seq) = report.last_seq {
        writer.committed(seq)?;
    }
    Ok(restored)
}

async fn acquire(pool: &SqlitePool) -> Result<PoolConnection<Sqlite>, String> {
    pool.acquire()
        .await
        .map_err(|error| format!("acquire sync connection: {error}"))
}
