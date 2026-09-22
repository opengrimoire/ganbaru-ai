//! Source-side write exclusion and blocker checks for vault handoff.

use super::ownership::VaultOwnershipManager;
use crate::db_path;
#[cfg(not(target_os = "ios"))]
use crate::media_player;
use tauri::{Manager, Runtime};

/// Holds the SQLite connection gate while a source vault is frozen.
pub(crate) struct SourceQuiescence {
    _database_guard: db_path::VaultExclusiveGuard,
    _managed_write_fence: super::ownership::ManagedVaultWriteFence,
    vault_id: String,
    transfer_id: String,
}

/// Holds the central write boundaries while creating an ownership-neutral snapshot.
pub(crate) struct SnapshotQuiescence {
    _database_guard: db_path::VaultExclusiveGuard,
    _managed_write_fence: super::ownership::ManagedVaultWriteFence,
}

impl SourceQuiescence {
    /// Resume an unchanged source after failure before generation commit.
    pub(crate) fn abort<R: Runtime>(self, app: &tauri::AppHandle<R>) -> Result<(), String> {
        app.state::<VaultOwnershipManager>()
            .abort_outgoing(&self.vault_id, &self.transfer_id)
    }
}

/// Check blockers, stop playback, fence new connections, and drain SQLite work.
pub(crate) async fn begin_source_quiescence<R: Runtime>(
    app: &tauri::AppHandle<R>,
    expected_generation: u64,
    transfer_id: String,
    receiver_device_id: String,
) -> Result<SourceQuiescence, String> {
    let vault_id = super::active_vault_id(app)?;
    check_pomodoro_blocker(app).await?;
    check_chat_blocker(app)?;

    let ownership = app.state::<VaultOwnershipManager>();
    let managed_write_fence = ownership.fence_managed_writes()?;
    ownership.begin_outgoing(
        &vault_id,
        expected_generation,
        transfer_id.clone(),
        receiver_device_id,
    )?;
    let database_guard = db_path::begin_vault_exclusive().await;

    let result = async {
        check_chat_blocker(app)?;
        stop_playback(app).await?;
        db_path::close_all_sqlite_pools_for_restore(app).await?;
        check_drained_pomodoro_blocker(app).await?;
        check_chat_blocker(app)
    }
    .await;
    if let Err(error) = result {
        let _ = app
            .state::<VaultOwnershipManager>()
            .abort_outgoing(&vault_id, &transfer_id);
        return Err(error);
    }

    Ok(SourceQuiescence {
        _database_guard: database_guard,
        _managed_write_fence: managed_write_fence,
        vault_id,
        transfer_id,
    })
}

/// Briefly excludes central writers while a read-only replica snapshot is created.
pub(crate) async fn begin_snapshot_quiescence<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<SnapshotQuiescence, String> {
    let managed_write_fence = app
        .state::<VaultOwnershipManager>()
        .fence_managed_writes()?;
    let database_guard = db_path::begin_vault_exclusive().await;
    db_path::close_all_sqlite_pools_for_restore(app).await?;
    Ok(SnapshotQuiescence {
        _database_guard: database_guard,
        _managed_write_fence: managed_write_fence,
    })
}

async fn check_drained_pomodoro_blocker<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let database_path = super::active_vault_path(app)?.join(super::APP_SQLITE_FILE);
    let registry = ganbaru_db::DatabasePoolRegistry::default();
    let pool = registry.connect_path_read_only(database_path).await?;
    let result = require_no_active_pomodoro(&pool).await;
    registry.close_all().await?;
    result
}

async fn check_pomodoro_blocker<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let pool =
        db_path::connect_sqlite(app.clone(), format!("sqlite:{}", super::APP_SQLITE_FILE)).await?;
    require_no_active_pomodoro(&pool).await
}

async fn require_no_active_pomodoro(pool: &sqlx::SqlitePool) -> Result<(), String> {
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pomodoro_runs WHERE ended_at IS NULL LIMIT 1)",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| format!("check active Pomodoro session: {error}"))?;
    if active {
        Err("Finish or stop the active Pomodoro session before moving this vault".to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn check_chat_blocker<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let (_, active_turns) = app
        .state::<crate::chat::runtime::ChatRuntimeRegistry>()
        .process_counts()
        .map_err(|error| format!("check active Chat work: {}", error.message))?;
    if active_turns > 0 {
        Err("Wait for active Chat work to finish before moving this vault".to_string())
    } else {
        Ok(())
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn check_chat_blocker<R: Runtime>(_app: &tauri::AppHandle<R>) -> Result<(), String> {
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn stop_playback<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    media_player::stop_for_vault_handoff(app.state::<media_player::MediaPlayerState>().inner())
        .map_err(|error| format!("stop local music playback: {}", error.message))
}

#[cfg(target_os = "android")]
async fn stop_playback<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    media_player::stop_for_vault_handoff(app).await
}

#[cfg(target_os = "ios")]
async fn stop_playback<R: Runtime>(_app: &tauri::AppHandle<R>) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::require_no_active_pomodoro;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn pomodoro_blocker_tracks_only_open_runs() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE pomodoro_runs (ended_at TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        require_no_active_pomodoro(&pool).await.unwrap();

        sqlx::query("INSERT INTO pomodoro_runs (ended_at) VALUES (NULL)")
            .execute(&pool)
            .await
            .unwrap();
        assert!(require_no_active_pomodoro(&pool).await.is_err());

        sqlx::query("UPDATE pomodoro_runs SET ended_at = '2026-09-13T00:00:00Z'")
            .execute(&pool)
            .await
            .unwrap();
        require_no_active_pomodoro(&pool).await.unwrap();
        pool.close().await;
    }
}
