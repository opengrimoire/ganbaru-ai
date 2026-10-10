use super::*;
use crate::db::connect_sqlite;

fn connection_error(error: String) -> MusicLibraryError {
    MusicLibraryError::runtime("open music library", error)
}

#[tauri::command]
pub async fn music_library_start_local_refresh(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicLocalRefreshRequest,
) -> MusicLibraryResult<MusicRefreshJobProgress> {
    let pool = connect_sqlite(app.clone(), db_url)
        .await
        .map_err(connection_error)?;
    #[cfg(target_os = "android")]
    return super::mobile_refresh::start(&app, &pool, request).await;
    #[cfg(desktop)]
    {
        let progress = super::local_refresh::prepare(&pool, &request).await?;
        let refresh_pool = pool.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = tauri::async_runtime::block_on(super::local_refresh::run_prepared(
                &refresh_pool,
                request,
            ));
        });
        Ok(progress)
    }
}

#[tauri::command]
pub async fn music_library_refresh_progress(
    app: tauri::AppHandle,
    db_url: String,
    job_id: String,
) -> MusicLibraryResult<MusicRefreshJobProgress> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    #[cfg(target_os = "android")]
    return super::mobile_refresh::progress(&pool, &job_id).await;
    #[cfg(desktop)]
    super::local_refresh::progress(&pool, &job_id).await
}

#[tauri::command]
pub async fn music_library_cancel_refresh(
    app: tauri::AppHandle,
    db_url: String,
    job_id: String,
    cancelled_at: i64,
) -> MusicLibraryResult<MusicRefreshJobProgress> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    #[cfg(target_os = "android")]
    return super::mobile_refresh::cancel(&pool, &job_id, cancelled_at).await;
    #[cfg(desktop)]
    super::local_refresh::cancel(&pool, &job_id, cancelled_at).await
}

#[tauri::command]
pub async fn music_library_upsert_youtube_video(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicYouTubeVideoWrite,
) -> MusicLibraryResult<MusicWriteReceipt> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::youtube::upsert_video(&pool, request).await
}

#[tauri::command]
pub async fn music_library_youtube_duplicate_count(
    app: tauri::AppHandle,
    db_url: String,
    video_ids: Vec<String>,
) -> MusicLibraryResult<i64> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::youtube::duplicate_video_count(&pool, video_ids).await
}

#[tauri::command]
pub async fn music_library_apply_youtube_playlist_snapshot(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicYouTubePlaylistSnapshotWrite,
) -> MusicLibraryResult<MusicYouTubeSnapshotResult> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::youtube::apply_playlist_snapshot(&pool, request).await
}

#[tauri::command]
pub async fn music_library_report_youtube_source_failure(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicYouTubeSourceFailureWrite,
) -> MusicLibraryResult<()> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::youtube::report_source_failure(&pool, request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_create_relink_plan(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicRelinkPlanRequest,
) -> MusicLibraryResult<MusicRelinkPlanSummary> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::relink::create_plan(&pool, request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_relink_plan_entries(
    app: tauri::AppHandle,
    db_url: String,
    plan_id: String,
    offset: i64,
    limit: i64,
) -> MusicLibraryResult<MusicRelinkPlanWindow> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::relink::plan_entries(&pool, &plan_id, offset, limit).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_apply_relink_plan(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicRelinkApplyRequest,
) -> MusicLibraryResult<MusicRelinkPlanSummary> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::relink::apply_plan(&pool, request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_cancel_relink_plan(
    app: tauri::AppHandle,
    db_url: String,
    plan_id: String,
    cancelled_at: i64,
) -> MusicLibraryResult<MusicRelinkPlanSummary> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::relink::cancel_plan(&pool, &plan_id, cancelled_at).await
}

#[tauri::command]
pub async fn music_library_source_removal_impact(
    app: tauri::AppHandle,
    db_url: String,
    collection_id: String,
) -> MusicLibraryResult<MusicSourceRemovalImpact> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::source_lifecycle::removal_impact(&pool, &collection_id).await
}

#[tauri::command]
pub async fn music_library_remove_source(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicSourceRemovalRequest,
) -> MusicLibraryResult<MusicSourceRemovalImpact> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::source_lifecycle::remove_source(&pool, request).await
}

#[tauri::command]
pub async fn music_library_create_playlist(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicPlaylistCreate,
) -> MusicLibraryResult<MusicWriteReceipt> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::create_playlist(&pool, request).await
}

#[tauri::command]
pub async fn music_library_update_playlist(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicPlaylistUpdate,
) -> MusicLibraryResult<MusicWriteReceipt> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::update_playlist(&pool, request).await
}

#[tauri::command]
pub async fn music_library_reorder_playlists(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicPlaylistsReorder,
) -> MusicLibraryResult<Vec<MusicWriteReceipt>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::playlist_edits::reorder_playlists(&pool, request).await
}

#[tauri::command]
pub async fn music_library_duplicate_playlist(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicPlaylistDuplicate,
) -> MusicLibraryResult<MusicWriteReceipt> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::duplicate_playlist(&pool, request).await
}

#[tauri::command]
pub async fn music_library_playlist_delete_impact(
    app: tauri::AppHandle,
    db_url: String,
    playlist_id: String,
) -> MusicLibraryResult<MusicPlaylistDeleteImpact> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::playlist_delete_impact(&pool, &playlist_id).await
}

#[tauri::command]
pub async fn music_library_delete_playlist(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicPlaylistDelete,
) -> MusicLibraryResult<MusicPlaylistDeleteImpact> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::delete_playlist(&pool, request).await
}

#[tauri::command]
pub async fn music_library_set_review_state(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicReviewWrite,
) -> MusicLibraryResult<MusicWriteReceipt> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::set_review_state(&pool, request).await
}

#[tauri::command]
pub async fn music_library_set_metadata_overrides(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicMetadataOverrideWrite,
) -> MusicLibraryResult<MusicWriteReceipt> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::set_metadata_overrides(&pool, request).await
}

#[tauri::command]
pub async fn music_library_set_item_signals(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicItemSignalsWrite,
) -> MusicLibraryResult<Vec<MusicWriteReceipt>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::set_item_signals(&pool, request).await
}

#[tauri::command]
pub async fn music_library_upsert_memberships(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicBulkMembershipWrite,
) -> MusicLibraryResult<Vec<MusicWriteReceipt>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::upsert_memberships(&pool, request).await
}

#[tauri::command]
pub async fn music_library_bulk_edit_memberships(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicBulkMembershipEdit,
) -> MusicLibraryResult<MusicBulkMembershipResult> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::playlist_edits::bulk_edit_memberships(&pool, request).await
}

#[tauri::command]
pub async fn music_library_membership_matrix(
    app: tauri::AppHandle,
    db_url: String,
    item_ids: Vec<String>,
) -> MusicLibraryResult<Vec<MusicMembershipMatrixEntry>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::queries::membership_matrix(&pool, item_ids).await
}

#[tauri::command]
pub async fn music_library_reorder_playlist(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicPlaylistReorder,
) -> MusicLibraryResult<MusicPlaylistReorderResult> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::playlist_edits::reorder_playlist(&pool, request).await
}

#[tauri::command]
pub async fn music_library_playlist_playback_entries(
    app: tauri::AppHandle,
    db_url: String,
    playlist_id: String,
    now_ms: i64,
) -> MusicLibraryResult<Vec<MusicPlaylistPlaybackEntry>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::queries::playlist_playback_entries(&pool, &playlist_id, now_ms).await
}

#[tauri::command]
pub async fn music_library_context_assignments(
    app: tauri::AppHandle,
    db_url: String,
    owner_kind: MusicAssignmentOwnerKind,
    owner_id: String,
) -> MusicLibraryResult<Vec<MusicContextAssignment>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    ganbaru_music::assignments::load_assignments(&pool, owner_kind, &owner_id).await
}

#[tauri::command]
pub async fn music_library_bulk_set_review_state(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicBulkReviewWrite,
) -> MusicLibraryResult<MusicBulkMembershipResult> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::playlist_edits::bulk_set_review_state(&pool, request).await
}

#[tauri::command]
pub async fn music_library_apply_review_selection(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicReviewSelectionWrite,
) -> MusicLibraryResult<MusicReviewSelectionResult> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::playlist_edits::apply_review_selection(&pool, request).await
}

#[tauri::command]
pub async fn music_library_bulk_snooze(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicBulkSnoozeWrite,
) -> MusicLibraryResult<MusicBulkMembershipResult> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::playlist_edits::bulk_snooze(&pool, request).await
}

#[tauri::command]
pub async fn music_library_save_advanced_membership(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicAdvancedMembershipWrite,
) -> MusicLibraryResult<MusicWriteReceipt> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::save_advanced_membership(&pool, request).await
}

#[tauri::command]
pub async fn music_library_remove_memberships(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicMembershipRemove,
) -> MusicLibraryResult<()> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::remove_memberships(&pool, request).await
}

#[tauri::command]
pub async fn music_library_remove_snooze(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicSnoozeRemove,
) -> MusicLibraryResult<()> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::remove_snooze(&pool, request).await
}

/// Parsing and serialization run on one bounded native worker, never on a WebView thread.
static MUSIC_TRANSFER_WORKERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

fn ensure_active_vault(app: &tauri::AppHandle, expected_id: &str) -> MusicLibraryResult<()> {
    let active_vault_id = crate::vault::active_vault_id(app).map_err(connection_error)?;
    if active_vault_id != expected_id {
        return Err(MusicLibraryError::conflict(
            "The active vault changed during Music transfer",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn music_library_preview_transfer(
    app: tauri::AppHandle,
    db_url: String,
    vault_id: String,
    source: MusicTransferSource,
) -> MusicLibraryResult<MusicTransferPreview> {
    let permit = MUSIC_TRANSFER_WORKERS
        .try_acquire()
        .map_err(|_| MusicLibraryError::conflict("Another Music transfer is being prepared"))?;
    ensure_active_vault(&app, &vault_id)?;
    let pool = connect_sqlite(app.clone(), db_url)
        .await
        .map_err(connection_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        ensure_active_vault(&app, &vault_id)?;
        let bindings = super::transfer::bindings(&app)?;
        tauri::async_runtime::block_on(super::transfer::preview(&pool, &source, &bindings))
    })
    .await
    .map_err(|error| MusicLibraryError::runtime("prepare Music transfer", error))?
}

#[tauri::command]
pub async fn music_library_commit_transfer(
    app: tauri::AppHandle,
    db_url: String,
    vault_id: String,
    request: MusicTransferCommit,
) -> MusicLibraryResult<MusicInterchangeImportResult> {
    let permit = MUSIC_TRANSFER_WORKERS
        .try_acquire()
        .map_err(|_| MusicLibraryError::conflict("Another Music transfer is being prepared"))?;
    ensure_active_vault(&app, &vault_id)?;
    let pool = connect_sqlite(app.clone(), db_url)
        .await
        .map_err(connection_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        ensure_active_vault(&app, &vault_id)?;
        let bindings = super::transfer::bindings(&app)?;
        tauri::async_runtime::block_on(super::transfer::commit(&pool, request, &bindings))
    })
    .await
    .map_err(|error| MusicLibraryError::runtime("commit Music transfer", error))?
}

#[tauri::command]
pub async fn music_library_export_transfer(
    app: tauri::AppHandle,
    db_url: String,
    vault_id: String,
    request: MusicTransferExport,
) -> MusicLibraryResult<bool> {
    let permit = MUSIC_TRANSFER_WORKERS
        .try_acquire()
        .map_err(|_| MusicLibraryError::conflict("Another Music transfer is being prepared"))?;
    ensure_active_vault(&app, &vault_id)?;
    let pool = connect_sqlite(app.clone(), db_url)
        .await
        .map_err(connection_error)?;
    let format = request.format;
    let worker_app = app.clone();
    let contents = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        ensure_active_vault(&worker_app, &vault_id)?;
        let bindings = super::transfer::bindings(&worker_app)?;
        tauri::async_runtime::block_on(super::transfer::export(&pool, &request, &bindings))
    })
    .await
    .map_err(|error| MusicLibraryError::runtime("prepare Music export", error))??;
    let extension = match format {
        MusicTransferFormat::Json => "json",
        MusicTransferFormat::M3u8 => "m3u8",
    };
    crate::music::music_pick_and_write_interchange_file(
        app,
        "ganbaru-music-playlists".to_string(),
        contents,
        extension.to_string(),
    )
    .await
    .map_err(|error| MusicLibraryError::runtime("save Music export", error))
}

#[tauri::command]
pub async fn music_library_item_window(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicItemWindowRequest,
) -> MusicLibraryResult<MusicItemWindow> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::queries::item_window(&pool, request).await
}

#[tauri::command]
pub async fn music_library_playlist_summaries(
    app: tauri::AppHandle,
    db_url: String,
    now_ms: i64,
    offset: i64,
    limit: i64,
) -> MusicLibraryResult<Vec<MusicPlaylistSummary>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::queries::playlist_summaries(&pool, now_ms, offset, limit).await
}

#[tauri::command]
pub async fn music_library_source_summaries(
    app: tauri::AppHandle,
    db_url: String,
    now_ms: i64,
    offset: i64,
    limit: i64,
) -> MusicLibraryResult<Vec<MusicSourceSummary>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::queries::source_summaries(&pool, now_ms, offset, limit).await
}

#[tauri::command]
pub async fn music_library_issues(
    app: tauri::AppHandle,
    db_url: String,
    offset: i64,
    limit: i64,
) -> MusicLibraryResult<Vec<MusicIssue>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::queries::issues(&pool, offset, limit).await
}

#[tauri::command]
pub async fn music_library_inspector_detail(
    app: tauri::AppHandle,
    db_url: String,
    item_id: String,
) -> MusicLibraryResult<MusicInspectorDetail> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::queries::inspector_detail(&pool, &item_id).await
}

#[tauri::command]
pub async fn music_library_local_roots(
    app: tauri::AppHandle,
    db_url: String,
    offset: i64,
    limit: i64,
) -> MusicLibraryResult<Vec<MusicLocalRoot>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::queries::local_roots(&pool, offset, limit).await
}

#[tauri::command]
pub async fn music_library_create_local_root(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicLocalRootCreate,
) -> MusicLibraryResult<MusicWriteReceipt> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::create_local_root(&pool, request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_preview_item_repair(
    app: tauri::AppHandle,
    db_url: String,
    item_id: String,
    file_path: String,
) -> MusicLibraryResult<MusicItemRepairPreview> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::item_repair::preview(&pool, &item_id, &file_path).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_apply_item_repair(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicItemRepairApply,
) -> MusicLibraryResult<MusicWriteReceipt> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::item_repair::apply(&pool, request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_undo_item_repair(
    app: tauri::AppHandle,
    db_url: String,
    location_id: String,
    root_id: String,
) -> MusicLibraryResult<()> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::item_repair::undo(&pool, &location_id, &root_id).await
}

#[tauri::command]
pub async fn music_library_source_collections(
    app: tauri::AppHandle,
    db_url: String,
    offset: i64,
    limit: i64,
) -> MusicLibraryResult<Vec<MusicSourceCollection>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::queries::source_collections(&pool, offset, limit).await
}

#[tauri::command]
pub async fn music_library_playlist_detail(
    app: tauri::AppHandle,
    db_url: String,
    playlist_id: String,
) -> MusicLibraryResult<MusicPlaylist> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::queries::playlist_detail(&pool, &playlist_id).await
}

#[tauri::command]
pub async fn music_library_upsert_source_collection(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicCollectionWrite,
) -> MusicLibraryResult<MusicWriteReceipt> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::writes::upsert_source_collection(&pool, request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_soundscapes(
    app: tauri::AppHandle,
    db_url: String,
    device_id: String,
) -> MusicLibraryResult<Vec<MusicSoundscapeDefinition>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::soundscapes::definitions(&pool, &device_id).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_soundscape_groups(
    app: tauri::AppHandle,
    db_url: String,
) -> MusicLibraryResult<Vec<MusicSoundscapeGroup>> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::soundscape_groups::groups(&pool).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_upsert_soundscape_group(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicSoundscapeGroupWrite,
) -> MusicLibraryResult<MusicSoundscapeGroup> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::soundscape_groups::upsert(&pool, request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_remove_soundscape_group(
    app: tauri::AppHandle,
    db_url: String,
    group_id: String,
    expected_version: i64,
) -> MusicLibraryResult<()> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::soundscape_groups::remove(&pool, &group_id, expected_version).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_upsert_soundscape(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicSoundscapeWrite,
) -> MusicLibraryResult<MusicSoundscapeDefinition> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::soundscapes::upsert(&pool, request).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_remove_soundscape(
    app: tauri::AppHandle,
    db_url: String,
    soundscape_id: String,
    expected_version: i64,
) -> MusicLibraryResult<()> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::soundscapes::remove(&pool, &soundscape_id, expected_version).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_soundscape_state(
    app: tauri::AppHandle,
    db_url: String,
) -> MusicLibraryResult<MusicSoundscapeState> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::soundscapes::state(&pool).await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn music_library_update_soundscape_state(
    app: tauri::AppHandle,
    db_url: String,
    request: MusicSoundscapeStateWrite,
) -> MusicLibraryResult<MusicSoundscapeState> {
    let pool = connect_sqlite(app, db_url)
        .await
        .map_err(connection_error)?;
    super::soundscapes::update_state(&pool, request).await
}
