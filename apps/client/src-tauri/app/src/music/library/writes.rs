use super::*;
use sqlx::{Sqlite, SqlitePool, Transaction};

pub(super) fn map_database_error(context: &str, error: sqlx::Error) -> MusicLibraryError {
    if error
        .as_database_error()
        .is_some_and(|database| database.is_unique_violation())
    {
        MusicLibraryError::conflict(format!("{context}: the record already exists"))
    } else {
        MusicLibraryError::database(context, error)
    }
}

pub(super) async fn commit(
    transaction: Transaction<'_, Sqlite>,
    context: &str,
) -> MusicLibraryResult<()> {
    transaction
        .commit()
        .await
        .map_err(|error| MusicLibraryError::database(context, error))
}

async fn playlist_exists(
    transaction: &mut Transaction<'_, Sqlite>,
    playlist_id: &str,
) -> MusicLibraryResult<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM music_playlists WHERE id = ?)")
        .bind(playlist_id)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| MusicLibraryError::database("check music playlist", error))
}

async fn item_exists(
    transaction: &mut Transaction<'_, Sqlite>,
    item_id: &str,
) -> MusicLibraryResult<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM music_library_items WHERE id = ?)")
        .bind(item_id)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| MusicLibraryError::database("check music library item", error))
}

pub(crate) async fn upsert_library_item(
    pool: &SqlitePool,
    request: MusicLibraryItemWrite,
) -> MusicLibraryResult<MusicWriteReceipt> {
    validate_library_item_write(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin save music library item", error))?;
    let existing_identity: Option<(String, String)> =
        sqlx::query_as("SELECT identity_key, source_kind FROM music_library_items WHERE id = ?")
            .bind(&request.id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| {
                MusicLibraryError::database("load music library item identity", error)
            })?;
    if existing_identity.as_ref().is_some_and(|(identity, kind)| {
        identity != &request.identity_key || kind != request.source_kind.as_ref()
    }) {
        return Err(MusicLibraryError::conflict(
            "a canonical music item cannot change its source identity",
        ));
    }
    sqlx::query(
        "INSERT INTO music_library_items
            (id, identity_key, source_kind, media_kind, youtube_video_id,
             original_title, original_artist, original_album, original_track_number,
             original_artwork_identity, youtube_resolution_state, duration_ms,
             availability, discovered_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET
            media_kind = excluded.media_kind,
            youtube_video_id = excluded.youtube_video_id,
            original_title = excluded.original_title,
            original_artist = excluded.original_artist,
            original_album = excluded.original_album,
            original_track_number = excluded.original_track_number,
            original_artwork_identity = excluded.original_artwork_identity,
            youtube_resolution_state = excluded.youtube_resolution_state,
            duration_ms = excluded.duration_ms,
            availability = excluded.availability,
            updated_at = excluded.updated_at,
            version = music_library_items.version + 1",
    )
    .bind(&request.id)
    .bind(&request.identity_key)
    .bind(request.source_kind.as_ref())
    .bind(request.media_kind.as_ref())
    .bind(&request.youtube_video_id)
    .bind(request.original_title.trim())
    .bind(request.original_artist.trim())
    .bind(request.original_album.trim())
    .bind(request.original_track_number)
    .bind(&request.original_artwork_identity)
    .bind(
        request
            .youtube_resolution_state
            .map(|state| state.as_ref().to_string()),
    )
    .bind(request.duration_ms)
    .bind(request.availability.as_ref())
    .bind(request.discovered_at)
    .bind(request.updated_at)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_database_error("save music library item", error))?;
    super::search::refresh_item(&mut transaction, &request.id).await?;
    let version: i64 = sqlx::query_scalar("SELECT version FROM music_library_items WHERE id = ?")
        .bind(&request.id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| MusicLibraryError::database("load saved music item", error))?;
    commit(transaction, "commit saved music library item").await?;
    Ok(MusicWriteReceipt {
        id: request.id,
        version,
    })
}

pub(crate) async fn upsert_local_location(
    pool: &SqlitePool,
    request: MusicLocalLocationWrite,
) -> MusicLibraryResult<()> {
    validate_local_location_write(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin save local music location", error))?;
    sqlx::query(
        "INSERT INTO music_local_locations
            (id, item_id, root_id, relative_path, file_size_bytes, modified_at_ms,
             lightweight_fingerprint, strong_fingerprint, availability,
             last_seen_generation, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            item_id = excluded.item_id,
            root_id = excluded.root_id,
            relative_path = excluded.relative_path,
            file_size_bytes = excluded.file_size_bytes,
            modified_at_ms = excluded.modified_at_ms,
            lightweight_fingerprint = excluded.lightweight_fingerprint,
            strong_fingerprint = excluded.strong_fingerprint,
            availability = excluded.availability,
            last_seen_generation = excluded.last_seen_generation,
            updated_at = excluded.updated_at",
    )
    .bind(&request.id)
    .bind(&request.item_id)
    .bind(&request.root_id)
    .bind(&request.relative_path)
    .bind(request.file_size_bytes)
    .bind(request.modified_at_ms)
    .bind(&request.lightweight_fingerprint)
    .bind(&request.strong_fingerprint)
    .bind(request.availability.as_ref())
    .bind(request.last_seen_generation)
    .bind(request.first_seen_at)
    .bind(request.updated_at)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_database_error("save local music location", error))?;
    super::search::refresh_item(&mut transaction, &request.item_id).await?;
    commit(transaction, "commit saved local music location").await
}

pub(crate) async fn create_playlist(
    pool: &SqlitePool,
    request: MusicPlaylistCreate,
) -> MusicLibraryResult<MusicWriteReceipt> {
    validate_playlist_create(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin create music playlist", error))?;
    sqlx::query(
        "INSERT INTO music_playlists
            (id, name, icon, shuffle_enabled, mix_enabled, repeat_mode, sort_order, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM music_playlists), ?, ?, 1)",
    )
    .bind(&request.id)
    .bind(request.name.trim())
    .bind(request.icon.trim())
    .bind(request.shuffle_enabled)
    .bind(request.mix_enabled)
    .bind(request.repeat_mode.as_ref())
    .bind(request.created_at)
    .bind(request.created_at)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_database_error("create music playlist", error))?;
    for intended_use in request.intended_uses {
        sqlx::query(
            "INSERT INTO music_playlist_intended_uses (playlist_id, intended_use) VALUES (?, ?)",
        )
        .bind(&request.id)
        .bind(intended_use.as_ref())
        .execute(&mut *transaction)
        .await
        .map_err(|error| map_database_error("save music playlist intended use", error))?;
    }
    commit(transaction, "commit create music playlist").await?;
    Ok(MusicWriteReceipt {
        id: request.id,
        version: 1,
    })
}

pub(crate) async fn update_playlist(
    pool: &SqlitePool,
    request: MusicPlaylistUpdate,
) -> MusicLibraryResult<MusicWriteReceipt> {
    validate_playlist_update(&request)?;
    let protected_identity = super::defaults::built_in_music_playlist(&request.id);
    let protected_name = protected_identity
        .map(|playlist| playlist.name)
        .unwrap_or(request.name.trim());
    let protected_icon = protected_identity
        .map(|playlist| playlist.icon)
        .unwrap_or(request.icon.trim());
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin update music playlist", error))?;
    let result = sqlx::query(
        "UPDATE music_playlists
         SET name = ?, icon = ?, shuffle_enabled = ?, mix_enabled = ?, repeat_mode = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND version = ?",
    )
    .bind(protected_name)
    .bind(protected_icon)
    .bind(request.shuffle_enabled)
    .bind(request.mix_enabled)
    .bind(request.repeat_mode.as_ref())
    .bind(request.updated_at)
    .bind(&request.id)
    .bind(request.expected_version)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_database_error("update music playlist", error))?;
    if result.rows_affected() == 0 {
        return Err(if playlist_exists(&mut transaction, &request.id).await? {
            MusicLibraryError::stale("music playlist", &request.id)
        } else {
            MusicLibraryError::not_found("music playlist", &request.id)
        });
    }
    sqlx::query("DELETE FROM music_playlist_intended_uses WHERE playlist_id = ?")
        .bind(&request.id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| MusicLibraryError::database("replace playlist intended uses", error))?;
    for intended_use in request.intended_uses {
        sqlx::query(
            "INSERT INTO music_playlist_intended_uses (playlist_id, intended_use) VALUES (?, ?)",
        )
        .bind(&request.id)
        .bind(intended_use.as_ref())
        .execute(&mut *transaction)
        .await
        .map_err(|error| map_database_error("save music playlist intended use", error))?;
    }
    super::search::refresh_playlist(&mut transaction, &request.id).await?;
    commit(transaction, "commit update music playlist").await?;
    Ok(MusicWriteReceipt {
        id: request.id,
        version: request.expected_version + 1,
    })
}

pub(crate) async fn duplicate_playlist(
    pool: &SqlitePool,
    request: MusicPlaylistDuplicate,
) -> MusicLibraryResult<MusicWriteReceipt> {
    validate_playlist_duplicate(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin duplicate music playlist", error))?;
    let source: Option<(String, i64, i64, String)> = sqlx::query_as(
        "SELECT icon, shuffle_enabled, mix_enabled, repeat_mode FROM music_playlists WHERE id = ?",
    )
    .bind(&request.source_playlist_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| MusicLibraryError::database("load source music playlist", error))?;
    let Some((icon, shuffle_enabled, mix_enabled, repeat_mode)) = source else {
        return Err(MusicLibraryError::not_found(
            "music playlist",
            &request.source_playlist_id,
        ));
    };
    sqlx::query(
        "INSERT INTO music_playlists
            (id, name, icon, shuffle_enabled, mix_enabled, repeat_mode, sort_order, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM music_playlists), ?, ?, 1)",
    )
    .bind(&request.new_playlist_id)
    .bind(request.name.trim())
    .bind(icon)
    .bind(shuffle_enabled)
    .bind(mix_enabled)
    .bind(repeat_mode)
    .bind(request.created_at)
    .bind(request.created_at)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_database_error("duplicate music playlist", error))?;
    sqlx::query(
        "INSERT INTO music_playlist_intended_uses (playlist_id, intended_use)
         SELECT ?, intended_use FROM music_playlist_intended_uses WHERE playlist_id = ?",
    )
    .bind(&request.new_playlist_id)
    .bind(&request.source_playlist_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| MusicLibraryError::database("duplicate playlist intended uses", error))?;
    sqlx::query(
        "INSERT INTO music_playlist_memberships
            (id, playlist_id, item_id, position, weight, enabled,
             start_ms, end_ms, volume, rate, created_at, updated_at, version)
         SELECT 'duplicate-membership:' || ? || ':' || id, ?, item_id, position, weight, enabled,
                start_ms, end_ms, volume, rate, ?, ?, 1
         FROM music_playlist_memberships WHERE playlist_id = ?",
    )
    .bind(&request.new_playlist_id)
    .bind(&request.new_playlist_id)
    .bind(request.created_at)
    .bind(request.created_at)
    .bind(&request.source_playlist_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| MusicLibraryError::database("duplicate playlist memberships", error))?;
    sqlx::query(
        "INSERT INTO music_membership_skip_ranges
            (id, membership_id, start_ms, end_ms, sort_order)
         SELECT 'duplicate-skip:' || ? || ':' || skip.id,
                'duplicate-membership:' || ? || ':' || membership.id,
                skip.start_ms, skip.end_ms, skip.sort_order
         FROM music_membership_skip_ranges AS skip
         JOIN music_playlist_memberships AS membership ON membership.id = skip.membership_id
         WHERE membership.playlist_id = ?",
    )
    .bind(&request.new_playlist_id)
    .bind(&request.new_playlist_id)
    .bind(&request.source_playlist_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| MusicLibraryError::database("duplicate membership skip ranges", error))?;
    sqlx::query(
        "INSERT INTO music_membership_break_items
            (membership_id, item_id, start_ms, end_ms, volume, rate)
         SELECT 'duplicate-membership:' || ? || ':' || membership.id,
                break_item.item_id, break_item.start_ms, break_item.end_ms,
                break_item.volume, break_item.rate
         FROM music_membership_break_items AS break_item
         JOIN music_playlist_memberships AS membership ON membership.id = break_item.membership_id
         WHERE membership.playlist_id = ?",
    )
    .bind(&request.new_playlist_id)
    .bind(&request.source_playlist_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| MusicLibraryError::database("duplicate membership break items", error))?;
    super::search::refresh_playlist(&mut transaction, &request.new_playlist_id).await?;
    commit(transaction, "commit duplicate music playlist").await?;
    Ok(MusicWriteReceipt {
        id: request.new_playlist_id,
        version: 1,
    })
}

async fn delete_impact_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    playlist_id: &str,
) -> MusicLibraryResult<MusicPlaylistDeleteImpact> {
    super::defaults::reject_built_in_playlist_delete(playlist_id)?;
    if !playlist_exists(transaction, playlist_id).await? {
        return Err(MusicLibraryError::not_found("music playlist", playlist_id));
    }
    let counts: (i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT
            (SELECT COUNT(*) FROM music_playlist_memberships WHERE playlist_id = ?),
            (SELECT COUNT(*) FROM projects p WHERE focus_playlist_id = ?
             AND NOT EXISTS (SELECT 1 FROM music_context_assignments a
                 WHERE a.owner_kind = 'project-default' AND a.owner_id = p.id
                   AND a.phase = 'focus' AND a.playlist_id = ?)),
            (SELECT COUNT(*) FROM projects p WHERE break_playlist_id = ?
             AND NOT EXISTS (SELECT 1 FROM music_context_assignments a
                 WHERE a.owner_kind = 'project-default' AND a.owner_id = p.id
                   AND a.phase IN ('short-break', 'long-break') AND a.playlist_id = ?)),
            (SELECT COUNT(*) FROM calendar_events e WHERE playlist_id = ?
             AND NOT EXISTS (SELECT 1 FROM music_context_assignments a
                 WHERE a.owner_kind = 'event-override' AND a.owner_id = e.id
                   AND a.phase = 'focus' AND a.playlist_id = ?)),
            (SELECT COUNT(*) FROM music_context_assignments WHERE playlist_id = ?)",
    )
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| MusicLibraryError::database("load playlist delete impact", error))?;
    let assignment_rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT 'project-focus', p.id, p.name FROM projects p WHERE focus_playlist_id = ?
           AND NOT EXISTS (SELECT 1 FROM music_context_assignments a
             WHERE a.owner_kind = 'project-default' AND a.owner_id = p.id
               AND a.phase = 'focus' AND a.playlist_id = ?)
         UNION ALL SELECT 'project-break', p.id, p.name FROM projects p WHERE break_playlist_id = ?
           AND NOT EXISTS (SELECT 1 FROM music_context_assignments a
             WHERE a.owner_kind = 'project-default' AND a.owner_id = p.id
               AND a.phase IN ('short-break', 'long-break') AND a.playlist_id = ?)
         UNION ALL SELECT 'calendar-event', e.id, e.title FROM calendar_events e WHERE playlist_id = ?
           AND NOT EXISTS (SELECT 1 FROM music_context_assignments a
             WHERE a.owner_kind = 'event-override' AND a.owner_id = e.id
               AND a.phase = 'focus' AND a.playlist_id = ?)
         UNION ALL SELECT 'context-assignment',
           a.owner_kind || ':' || a.owner_id || ':' || a.phase,
           COALESCE(p.name, e.title, a.owner_id) || ' · ' || a.phase
           FROM music_context_assignments a
           LEFT JOIN projects p ON a.owner_kind = 'project-default' AND p.id = a.owner_id
           LEFT JOIN calendar_events e ON a.owner_kind IN ('event-snapshot', 'event-override') AND e.id = a.owner_id
           WHERE a.playlist_id = ?
         ORDER BY 1, 3, 2",
    )
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .bind(playlist_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|error| MusicLibraryError::database("load playlist assignment references", error))?;
    let assignments = assignment_rows
        .into_iter()
        .map(|(kind, id, label)| {
            Ok(MusicPlaylistAssignmentReference {
                kind: MusicPlaylistAssignmentKind::try_from(kind.as_str()).map_err(|message| {
                    MusicLibraryError::runtime("decode playlist assignment kind", message)
                })?,
                id,
                label,
            })
        })
        .collect::<MusicLibraryResult<Vec<_>>>()?;
    Ok(MusicPlaylistDeleteImpact {
        membership_count: counts.0,
        project_focus_assignment_count: counts.1,
        project_break_assignment_count: counts.2,
        calendar_assignment_count: counts.3,
        context_assignment_count: counts.4,
        assignments,
    })
}

pub(crate) async fn playlist_delete_impact(
    pool: &SqlitePool,
    playlist_id: &str,
) -> MusicLibraryResult<MusicPlaylistDeleteImpact> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin playlist impact read", error))?;
    let impact = delete_impact_in_transaction(&mut transaction, playlist_id).await?;
    commit(transaction, "commit playlist impact read").await?;
    Ok(impact)
}

pub(crate) async fn delete_playlist(
    pool: &SqlitePool,
    request: MusicPlaylistDelete,
) -> MusicLibraryResult<MusicPlaylistDeleteImpact> {
    validate_playlist_delete(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin delete music playlist", error))?;
    let actual_impact =
        delete_impact_in_transaction(&mut transaction, &request.playlist_id).await?;
    if actual_impact != request.expected_impact {
        return Err(MusicLibraryError::conflict(
            "playlist assignments changed after the delete confirmation was shown",
        ));
    }
    if let Some(replacement_id) = &request.replacement_playlist_id {
        if !playlist_exists(&mut transaction, replacement_id).await? {
            return Err(MusicLibraryError::not_found(
                "replacement music playlist",
                replacement_id,
            ));
        }
    }
    let affected_item_ids: Vec<String> = sqlx::query_scalar(
        "SELECT item_id FROM music_playlist_memberships WHERE playlist_id = ? ORDER BY item_id",
    )
    .bind(&request.playlist_id)
    .fetch_all(&mut *transaction)
    .await
    .map_err(|error| MusicLibraryError::database("load deleted playlist search items", error))?;
    sqlx::query("UPDATE projects SET focus_playlist_id = ? WHERE focus_playlist_id = ?")
        .bind(&request.replacement_playlist_id)
        .bind(&request.playlist_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| MusicLibraryError::database("clear project focus assignments", error))?;
    sqlx::query("UPDATE projects SET break_playlist_id = ? WHERE break_playlist_id = ?")
        .bind(&request.replacement_playlist_id)
        .bind(&request.playlist_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| MusicLibraryError::database("clear project break assignments", error))?;
    sqlx::query("UPDATE calendar_events SET playlist_id = ? WHERE playlist_id = ?")
        .bind(&request.replacement_playlist_id)
        .bind(&request.playlist_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            MusicLibraryError::database("clear calendar playlist assignments", error)
        })?;
    sqlx::query(
        "UPDATE music_context_assignments
         SET playlist_id = ?, version = version + 1
         WHERE playlist_id = ?",
    )
    .bind(&request.replacement_playlist_id)
    .bind(&request.playlist_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| {
        MusicLibraryError::database("repair contextual playlist assignments", error)
    })?;
    let deleted = sqlx::query("DELETE FROM music_playlists WHERE id = ? AND version = ?")
        .bind(&request.playlist_id)
        .bind(request.expected_version)
        .execute(&mut *transaction)
        .await
        .map_err(|error| MusicLibraryError::database("delete music playlist", error))?;
    if deleted.rows_affected() == 0 {
        return Err(MusicLibraryError::stale(
            "music playlist",
            &request.playlist_id,
        ));
    }
    for item_id in affected_item_ids {
        super::search::refresh_item(&mut transaction, &item_id).await?;
    }
    commit(transaction, "commit delete music playlist").await?;
    Ok(actual_impact)
}

pub(crate) async fn set_review_state(
    pool: &SqlitePool,
    request: MusicReviewWrite,
) -> MusicLibraryResult<MusicWriteReceipt> {
    validate_review_write(&request)?;
    let result = sqlx::query(
        "UPDATE music_library_items
         SET review_state = ?, review_changed_at = ?, review_deferred_until = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND version = ?",
    )
    .bind(request.review_state.as_ref())
    .bind(request.updated_at)
    .bind(request.deferred_until)
    .bind(request.updated_at)
    .bind(&request.item_id)
    .bind(request.expected_version)
    .execute(pool)
    .await
    .map_err(|error| MusicLibraryError::database("update music review state", error))?;
    if result.rows_affected() == 0 {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM music_library_items WHERE id = ?)")
                .bind(&request.item_id)
                .fetch_one(pool)
                .await
                .map_err(|error| MusicLibraryError::database("check music library item", error))?;
        return Err(if exists {
            MusicLibraryError::stale("music library item", &request.item_id)
        } else {
            MusicLibraryError::not_found("music library item", &request.item_id)
        });
    }
    Ok(MusicWriteReceipt {
        id: request.item_id,
        version: request.expected_version + 1,
    })
}

pub(crate) async fn set_metadata_overrides(
    pool: &SqlitePool,
    request: MusicMetadataOverrideWrite,
) -> MusicLibraryResult<MusicWriteReceipt> {
    validate_metadata_override_write(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin metadata override update", error))?;
    let result = sqlx::query(
        "UPDATE music_library_items
         SET title_override = ?, artist_override = ?, album_override = ?, artwork_override = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND version = ?",
    )
    .bind(request.title_override.as_deref().map(str::trim))
    .bind(request.artist_override.as_deref().map(str::trim))
    .bind(request.album_override.as_deref().map(str::trim))
    .bind(request.artwork_override.as_deref().map(str::trim))
    .bind(request.updated_at)
    .bind(&request.item_id)
    .bind(request.expected_version)
    .execute(&mut *transaction)
    .await
    .map_err(|error| MusicLibraryError::database("update music metadata overrides", error))?;
    if result.rows_affected() == 0 {
        return Err(MusicLibraryError::stale(
            "music library item",
            &request.item_id,
        ));
    }
    super::search::refresh_item(&mut transaction, &request.item_id).await?;
    commit(transaction, "commit metadata override update").await?;
    Ok(MusicWriteReceipt {
        id: request.item_id,
        version: request.expected_version + 1,
    })
}

pub(crate) async fn set_item_signals(
    pool: &SqlitePool,
    request: MusicItemSignalsWrite,
) -> MusicLibraryResult<Vec<MusicWriteReceipt>> {
    validate_item_signals_write(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin music signal update", error))?;
    let mut receipts = Vec::with_capacity(request.item_ids.len());
    for item_id in &request.item_ids {
        let version: Option<i64> =
            sqlx::query_scalar("SELECT version FROM music_library_items WHERE id = ?")
                .bind(item_id)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(|error| {
                    MusicLibraryError::database("load music item for signal update", error)
                })?;
        let Some(version) = version else {
            return Err(MusicLibraryError::not_found("music library item", item_id));
        };
        sqlx::query("DELETE FROM music_item_signals WHERE item_id = ?")
            .bind(item_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| MusicLibraryError::database("replace music item signals", error))?;
        for signal in &request.signals {
            sqlx::query(
                "INSERT INTO music_item_signals (item_id, signal, created_at) VALUES (?, ?, ?)",
            )
            .bind(item_id)
            .bind(signal.as_ref())
            .bind(request.updated_at)
            .execute(&mut *transaction)
            .await
            .map_err(|error| MusicLibraryError::database("save music item signal", error))?;
        }
        sqlx::query(
            "UPDATE music_library_items SET updated_at = ?, version = version + 1 WHERE id = ?",
        )
        .bind(request.updated_at)
        .bind(item_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| MusicLibraryError::database("version music signal update", error))?;
        super::search::refresh_item(&mut transaction, item_id).await?;
        receipts.push(MusicWriteReceipt {
            id: item_id.clone(),
            version: version + 1,
        });
    }
    commit(transaction, "commit music signal update").await?;
    Ok(receipts)
}

async fn upsert_membership_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    membership: &MusicMembershipWrite,
) -> MusicLibraryResult<MusicWriteReceipt> {
    if let Some(expected_version) = membership.expected_version {
        let updated = sqlx::query(
            "UPDATE music_playlist_memberships
             SET position = ?, weight = ?, enabled = ?, start_ms = ?, end_ms = ?,
                 volume = ?, rate = ?, updated_at = ?, version = version + 1
             WHERE id = ? AND playlist_id = ? AND item_id = ? AND version = ?",
        )
        .bind(membership.position)
        .bind(membership.weight.as_ref())
        .bind(membership.enabled)
        .bind(membership.start_ms)
        .bind(membership.end_ms)
        .bind(membership.volume)
        .bind(membership.rate)
        .bind(membership.updated_at)
        .bind(&membership.id)
        .bind(&membership.playlist_id)
        .bind(&membership.item_id)
        .bind(expected_version)
        .execute(&mut **transaction)
        .await
        .map_err(|error| map_database_error("update playlist membership", error))?;
        if updated.rows_affected() == 0 {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM music_playlist_memberships WHERE id = ?)",
            )
            .bind(&membership.id)
            .fetch_one(&mut **transaction)
            .await
            .map_err(|error| MusicLibraryError::database("check playlist membership", error))?;
            return Err(if exists {
                MusicLibraryError::stale("playlist membership", &membership.id)
            } else {
                MusicLibraryError::not_found("playlist membership", &membership.id)
            });
        }
        return Ok(MusicWriteReceipt {
            id: membership.id.clone(),
            version: expected_version + 1,
        });
    }
    sqlx::query(
        "INSERT INTO music_playlist_memberships
            (id, playlist_id, item_id, position, weight, enabled,
             start_ms, end_ms, volume, rate, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(playlist_id, item_id) DO UPDATE SET
            position = excluded.position,
            weight = excluded.weight,
            enabled = excluded.enabled,
            start_ms = excluded.start_ms,
            end_ms = excluded.end_ms,
            volume = excluded.volume,
            rate = excluded.rate,
            updated_at = excluded.updated_at,
            version = music_playlist_memberships.version + 1",
    )
    .bind(&membership.id)
    .bind(&membership.playlist_id)
    .bind(&membership.item_id)
    .bind(membership.position)
    .bind(membership.weight.as_ref())
    .bind(membership.enabled)
    .bind(membership.start_ms)
    .bind(membership.end_ms)
    .bind(membership.volume)
    .bind(membership.rate)
    .bind(membership.updated_at)
    .bind(membership.updated_at)
    .execute(&mut **transaction)
    .await
    .map_err(|error| map_database_error("save playlist membership", error))?;
    let receipt: (String, i64) = sqlx::query_as(
        "SELECT id, version FROM music_playlist_memberships WHERE playlist_id = ? AND item_id = ?",
    )
    .bind(&membership.playlist_id)
    .bind(&membership.item_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| MusicLibraryError::database("load saved playlist membership", error))?;
    super::search::refresh_item(transaction, &membership.item_id).await?;
    Ok(MusicWriteReceipt {
        id: receipt.0,
        version: receipt.1,
    })
}

pub(crate) async fn upsert_memberships(
    pool: &SqlitePool,
    request: MusicBulkMembershipWrite,
) -> MusicLibraryResult<Vec<MusicWriteReceipt>> {
    validate_bulk_membership_write(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin save playlist memberships", error))?;
    let mut receipts = Vec::with_capacity(request.memberships.len());
    for membership in &request.memberships {
        receipts.push(upsert_membership_in_transaction(&mut transaction, membership).await?);
    }
    commit(transaction, "commit save playlist memberships").await?;
    Ok(receipts)
}

pub(crate) async fn save_advanced_membership(
    pool: &SqlitePool,
    request: MusicAdvancedMembershipWrite,
) -> MusicLibraryResult<MusicWriteReceipt> {
    validate_advanced_membership_write(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin advanced membership update", error))?;
    let receipt = upsert_membership_in_transaction(&mut transaction, &request.membership).await?;
    sqlx::query("DELETE FROM music_membership_skip_ranges WHERE membership_id = ?")
        .bind(&receipt.id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| MusicLibraryError::database("replace membership skip ranges", error))?;
    for range in request.skip_ranges {
        sqlx::query(
            "INSERT INTO music_membership_skip_ranges
                (id, membership_id, start_ms, end_ms, sort_order)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(range.id)
        .bind(&receipt.id)
        .bind(range.start_ms)
        .bind(range.end_ms)
        .bind(range.sort_order)
        .execute(&mut *transaction)
        .await
        .map_err(|error| MusicLibraryError::database("save membership skip range", error))?;
    }
    commit(transaction, "commit advanced membership update").await?;
    Ok(receipt)
}

pub(crate) async fn remove_memberships(
    pool: &SqlitePool,
    request: MusicMembershipRemove,
) -> MusicLibraryResult<()> {
    validate_membership_remove(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin remove playlist memberships", error))?;
    for membership_id in &request.membership_ids {
        let item_id: Option<String> =
            sqlx::query_scalar("SELECT item_id FROM music_playlist_memberships WHERE id = ?")
                .bind(membership_id)
                .fetch_optional(&mut *transaction)
                .await
                .map_err(|error| {
                    MusicLibraryError::database("load removed membership item", error)
                })?;
        let Some(item_id) = item_id else {
            return Err(MusicLibraryError::not_found(
                "playlist membership",
                membership_id,
            ));
        };
        let deleted = sqlx::query("DELETE FROM music_playlist_memberships WHERE id = ?")
            .bind(membership_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| MusicLibraryError::database("remove playlist membership", error))?;
        debug_assert_eq!(deleted.rows_affected(), 1);
        super::search::refresh_item(&mut transaction, &item_id).await?;
    }
    commit(transaction, "commit remove playlist memberships").await
}

pub(crate) async fn upsert_snooze(
    pool: &SqlitePool,
    request: MusicSnoozeWrite,
) -> MusicLibraryResult<()> {
    validate_snooze_write(&request)?;
    sqlx::query(
        "INSERT INTO music_snoozes
            (id, item_id, scope, playlist_id, starts_at, ends_at, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            item_id = excluded.item_id,
            scope = excluded.scope,
            playlist_id = excluded.playlist_id,
            starts_at = excluded.starts_at,
            ends_at = excluded.ends_at,
            reason = excluded.reason",
    )
    .bind(&request.id)
    .bind(&request.item_id)
    .bind(request.scope.as_ref())
    .bind(&request.playlist_id)
    .bind(request.starts_at)
    .bind(request.ends_at)
    .bind(request.reason.trim())
    .bind(request.created_at)
    .execute(pool)
    .await
    .map_err(|error| map_database_error("save music snooze", error))?;
    Ok(())
}

pub(crate) async fn remove_snooze(
    pool: &SqlitePool,
    request: MusicSnoozeRemove,
) -> MusicLibraryResult<()> {
    validate_snooze_remove(&request)?;
    let result = sqlx::query("DELETE FROM music_snoozes WHERE id = ?")
        .bind(&request.snooze_id)
        .execute(pool)
        .await
        .map_err(|error| MusicLibraryError::database("remove music snooze", error))?;
    if result.rows_affected() == 0 {
        return Err(MusicLibraryError::not_found(
            "music snooze",
            &request.snooze_id,
        ));
    }
    Ok(())
}

pub(crate) async fn reset_statistics(
    pool: &SqlitePool,
    request: MusicStatisticsReset,
) -> MusicLibraryResult<()> {
    validate_statistics_reset(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin reset listening statistics", error))?;
    for item_id in &request.item_ids {
        if !item_exists(&mut transaction, item_id).await? {
            return Err(MusicLibraryError::not_found("music library item", item_id));
        }
        if request.reset_aggregates {
            sqlx::query("DELETE FROM music_listening_statistics WHERE item_id = ?")
                .bind(item_id)
                .execute(&mut *transaction)
                .await
                .map_err(|error| {
                    MusicLibraryError::database("reset listening statistics", error)
                })?;
        }
        if request.reset_recent_selections {
            sqlx::query("DELETE FROM music_recent_selections WHERE item_id = ?")
                .bind(item_id)
                .execute(&mut *transaction)
                .await
                .map_err(|error| MusicLibraryError::database("clear recent selections", error))?;
        }
    }
    commit(transaction, "commit reset listening statistics").await
}

pub(crate) async fn upsert_source_collection(
    pool: &SqlitePool,
    request: MusicCollectionWrite,
) -> MusicLibraryResult<MusicWriteReceipt> {
    validate_collection_write(&request)?;
    sqlx::query(
        "INSERT INTO music_source_collections
            (id, kind, identity_key, name, local_root_id, youtube_playlist_id,
             created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            identity_key = excluded.identity_key,
            name = excluded.name,
            local_root_id = excluded.local_root_id,
            youtube_playlist_id = excluded.youtube_playlist_id,
            updated_at = excluded.updated_at,
            version = music_source_collections.version + 1",
    )
    .bind(&request.id)
    .bind(request.kind.as_ref())
    .bind(&request.identity_key)
    .bind(request.name.trim())
    .bind(&request.local_root_id)
    .bind(&request.youtube_playlist_id)
    .bind(request.updated_at)
    .bind(request.updated_at)
    .execute(pool)
    .await
    .map_err(|error| map_database_error("save music source collection", error))?;
    let version: i64 =
        sqlx::query_scalar("SELECT version FROM music_source_collections WHERE id = ?")
            .bind(&request.id)
            .fetch_one(pool)
            .await
            .map_err(|error| MusicLibraryError::database("load saved source collection", error))?;
    Ok(MusicWriteReceipt {
        id: request.id,
        version,
    })
}

pub(crate) async fn create_local_root(
    pool: &SqlitePool,
    request: MusicLocalRootCreate,
) -> MusicLibraryResult<MusicWriteReceipt> {
    validate_local_root_create(&request)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin local music root creation", error))?;
    sqlx::query(
        "INSERT INTO music_local_roots (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind(&request.root_id)
    .bind(request.name.trim())
    .bind(request.created_at)
    .bind(request.created_at)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_database_error("create local music root", error))?;
    sqlx::query(
        "INSERT INTO music_source_collections
            (id, kind, identity_key, name, local_root_id, created_at, updated_at)
         VALUES (?, 'local-root', ?, ?, ?, ?, ?)",
    )
    .bind(&request.collection_id)
    .bind(&request.identity_key)
    .bind(request.name.trim())
    .bind(&request.root_id)
    .bind(request.created_at)
    .bind(request.created_at)
    .execute(&mut *transaction)
    .await
    .map_err(|error| map_database_error("create local music source", error))?;
    commit(transaction, "commit local music root creation").await?;
    Ok(MusicWriteReceipt {
        id: request.collection_id,
        version: 1,
    })
}
