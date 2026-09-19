use super::*;
use rodio::Decoder;
use sqlx::SqlitePool;
use std::fs::File;
use std::path::Path;

type DefinitionRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    String,
    Option<String>,
    i64,
    i64,
    i64,
);

pub(crate) async fn definitions(
    pool: &SqlitePool,
    device_id: &str,
) -> MusicLibraryResult<Vec<MusicSoundscapeDefinition>> {
    validate_id(device_id, "deviceId")?;
    let rows = sqlx::query_as::<_, DefinitionRow>(
        "SELECT s.id, s.source_kind, s.generated_kind, s.bundled_identity, s.name,
                CASE WHEN s.source_kind = 'local-loop'
                     THEN COALESCE(l.availability, 'missing') ELSE s.availability END,
                l.absolute_path, s.created_at, s.updated_at, s.version
         FROM music_soundscapes s
         LEFT JOIN music_soundscape_locations l
           ON l.soundscape_id = s.id AND l.device_id = ?
         ORDER BY CASE s.generated_kind
                    WHEN 'white' THEN 0 WHEN 'pink' THEN 1 WHEN 'brown' THEN 2 ELSE 3 END,
                  lower(s.name), s.id",
    )
    .bind(device_id)
    .fetch_all(pool)
    .await
    .map_err(|error| MusicLibraryError::database("load soundscapes", error))?;
    let mut definitions = rows
        .into_iter()
        .map(decode_definition)
        .collect::<MusicLibraryResult<Vec<_>>>()?;
    for definition in &mut definitions {
        if definition.source_kind != MusicSoundscapeSourceKind::LocalLoop {
            continue;
        }
        let availability = local_path_availability(definition.local_path.as_deref());
        if availability != definition.availability {
            sqlx::query(
                "UPDATE music_soundscape_locations
                 SET availability = ?, updated_at = MAX(updated_at + 1, ?)
                 WHERE soundscape_id = ? AND device_id = ?",
            )
            .bind(availability.as_ref())
            .bind(definition.updated_at)
            .bind(&definition.id)
            .bind(device_id)
            .execute(pool)
            .await
            .map_err(|error| {
                MusicLibraryError::database("refresh soundscape availability", error)
            })?;
            definition.availability = availability;
        }
    }
    Ok(definitions)
}

pub(crate) async fn upsert(
    pool: &SqlitePool,
    request: MusicSoundscapeWrite,
) -> MusicLibraryResult<MusicSoundscapeDefinition> {
    validate_write(&request)?;
    let availability = if request.source_kind == MusicSoundscapeSourceKind::LocalLoop {
        validate_local_audio_path(
            request
                .local_path
                .as_deref()
                .expect("validated local soundscape path should exist"),
        )?;
        MusicSoundscapeAvailability::Available
    } else {
        MusicSoundscapeAvailability::Available
    };
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin soundscape update", error))?;
    let existing = sqlx::query_as::<_, (i64, i64)>(
        "SELECT created_at, version FROM music_soundscapes WHERE id = ?",
    )
    .bind(&request.id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|error| MusicLibraryError::database("load soundscape version", error))?;
    if let Some((_, version)) = existing {
        if request.expected_version != Some(version) {
            return Err(MusicLibraryError::conflict(
                "the soundscape changed before this update",
            ));
        }
    } else if request.expected_version.is_some() {
        return Err(MusicLibraryError::not_found("soundscape", &request.id));
    }
    let created_at = existing.map(|row| row.0).unwrap_or(request.updated_at);
    let version = existing.map(|row| row.1 + 1).unwrap_or(1);
    sqlx::query(
        "INSERT INTO music_soundscapes
            (id, source_kind, generated_kind, bundled_identity, name, availability,
             created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            source_kind = excluded.source_kind,
            generated_kind = excluded.generated_kind,
            bundled_identity = excluded.bundled_identity,
            name = excluded.name,
            availability = excluded.availability,
            updated_at = excluded.updated_at,
            version = excluded.version",
    )
    .bind(&request.id)
    .bind(request.source_kind.as_ref())
    .bind(
        request
            .generated_kind
            .map(|value| value.as_ref().to_string()),
    )
    .bind(&request.bundled_identity)
    .bind(request.name.trim())
    .bind(availability.as_ref())
    .bind(created_at)
    .bind(request.updated_at)
    .bind(version)
    .execute(&mut *transaction)
    .await
    .map_err(|error| MusicLibraryError::database("save soundscape", error))?;
    if request.source_kind == MusicSoundscapeSourceKind::LocalLoop {
        let path = request
            .local_path
            .as_deref()
            .expect("validated local soundscape path should exist");
        let metadata = std::fs::metadata(path)
            .map_err(|error| MusicLibraryError::runtime("inspect local soundscape", error))?;
        let modified_at_ms = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|value| i64::try_from(value.as_millis()).ok());
        sqlx::query(
            "INSERT INTO music_soundscape_locations
                (soundscape_id, device_id, absolute_path, availability,
                 file_size_bytes, modified_at_ms, updated_at)
             VALUES (?, ?, ?, 'available', ?, ?, ?)
             ON CONFLICT(soundscape_id, device_id) DO UPDATE SET
                absolute_path = excluded.absolute_path,
                availability = excluded.availability,
                file_size_bytes = excluded.file_size_bytes,
                modified_at_ms = excluded.modified_at_ms,
                updated_at = excluded.updated_at",
        )
        .bind(&request.id)
        .bind(&request.device_id)
        .bind(path)
        .bind(i64::try_from(metadata.len()).unwrap_or(i64::MAX))
        .bind(modified_at_ms)
        .bind(request.updated_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| MusicLibraryError::database("save soundscape location", error))?;
    }
    super::writes::commit(transaction, "commit soundscape update").await?;
    definition(pool, &request.device_id, &request.id).await
}

pub(crate) async fn remove(
    pool: &SqlitePool,
    soundscape_id: &str,
    expected_version: i64,
) -> MusicLibraryResult<()> {
    validate_id(soundscape_id, "soundscapeId")?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| MusicLibraryError::database("begin soundscape removal", error))?;
    sqlx::query(
        "UPDATE music_soundscape_state
         SET desired_playing = 0, updated_at = updated_at + 1, version = version + 1
         WHERE singleton_id = 1 AND active_soundscape_id = ?",
    )
    .bind(soundscape_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| MusicLibraryError::database("stop removed soundscape", error))?;
    let result = sqlx::query(
        "DELETE FROM music_soundscapes
         WHERE id = ? AND source_kind = 'local-loop' AND version = ?",
    )
    .bind(soundscape_id)
    .bind(expected_version)
    .execute(&mut *transaction)
    .await
    .map_err(|error| MusicLibraryError::database("remove soundscape", error))?;
    if result.rows_affected() == 0 {
        return Err(MusicLibraryError::conflict(
            "the soundscape changed or cannot be removed",
        ));
    }
    super::writes::commit(transaction, "commit soundscape removal").await
}

pub(crate) async fn state(pool: &SqlitePool) -> MusicLibraryResult<MusicSoundscapeState> {
    let row = sqlx::query_as::<_, (Option<String>, bool, f64, i64, i64)>(
        "SELECT active_soundscape_id, desired_playing, volume, updated_at, version
         FROM music_soundscape_state WHERE singleton_id = 1",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| MusicLibraryError::database("load soundscape state", error))?;
    Ok(MusicSoundscapeState {
        active_soundscape_id: row.0,
        desired_playing: row.1,
        volume: row.2,
        updated_at: row.3,
        version: row.4,
    })
}

pub(crate) async fn update_state(
    pool: &SqlitePool,
    request: MusicSoundscapeStateWrite,
) -> MusicLibraryResult<MusicSoundscapeState> {
    if !request.volume.is_finite() || !(0.0..=1.0).contains(&request.volume) {
        return Err(MusicLibraryError::validation(
            "volume",
            "must be a finite value between zero and one",
        ));
    }
    if request.updated_at <= 0 {
        return Err(MusicLibraryError::validation(
            "updatedAt",
            "must be positive",
        ));
    }
    if let Some(id) = &request.active_soundscape_id {
        validate_id(id, "activeSoundscapeId")?;
        let exists: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM music_soundscapes WHERE id = ?")
                .bind(id)
                .fetch_optional(pool)
                .await
                .map_err(|error| {
                    MusicLibraryError::database("validate active soundscape", error)
                })?;
        if exists.is_none() {
            return Err(MusicLibraryError::not_found("soundscape", id));
        }
    } else if request.desired_playing {
        return Err(MusicLibraryError::validation(
            "desiredPlaying",
            "cannot be enabled without an active soundscape",
        ));
    }
    let result = sqlx::query(
        "UPDATE music_soundscape_state
         SET active_soundscape_id = ?, desired_playing = ?, volume = ?,
             updated_at = ?, version = version + 1
         WHERE singleton_id = 1 AND version = ?",
    )
    .bind(request.active_soundscape_id)
    .bind(request.desired_playing)
    .bind(request.volume)
    .bind(request.updated_at)
    .bind(request.expected_version)
    .execute(pool)
    .await
    .map_err(|error| MusicLibraryError::database("update soundscape state", error))?;
    if result.rows_affected() == 0 {
        return Err(MusicLibraryError::conflict(
            "the soundscape state changed before this update",
        ));
    }
    state(pool).await
}

async fn definition(
    pool: &SqlitePool,
    device_id: &str,
    soundscape_id: &str,
) -> MusicLibraryResult<MusicSoundscapeDefinition> {
    definitions(pool, device_id)
        .await?
        .into_iter()
        .find(|definition| definition.id == soundscape_id)
        .ok_or_else(|| MusicLibraryError::not_found("soundscape", soundscape_id))
}

fn validate_write(request: &MusicSoundscapeWrite) -> MusicLibraryResult<()> {
    validate_id(&request.id, "id")?;
    validate_id(&request.device_id, "deviceId")?;
    if request.name.trim().is_empty() || request.name.chars().count() > 200 {
        return Err(MusicLibraryError::validation(
            "name",
            "must contain between one and 200 characters",
        ));
    }
    if request.updated_at <= 0 {
        return Err(MusicLibraryError::validation(
            "updatedAt",
            "must be positive",
        ));
    }
    match request.source_kind {
        MusicSoundscapeSourceKind::GeneratedNoise
            if request.generated_kind.is_none()
                || request.bundled_identity.is_some()
                || request.local_path.is_some() =>
        {
            Err(MusicLibraryError::validation(
                "sourceKind",
                "generated noise requires only a generated kind",
            ))
        }
        MusicSoundscapeSourceKind::LocalLoop
            if request.generated_kind.is_some()
                || request.bundled_identity.is_some()
                || request.local_path.as_deref().is_none_or(str::is_empty) =>
        {
            Err(MusicLibraryError::validation(
                "localPath",
                "a local loop requires only an absolute audio path",
            ))
        }
        MusicSoundscapeSourceKind::BundledLoop
            if request.generated_kind.is_some()
                || request.local_path.is_some()
                || request
                    .bundled_identity
                    .as_deref()
                    .is_none_or(str::is_empty) =>
        {
            Err(MusicLibraryError::validation(
                "bundledIdentity",
                "a bundled loop requires only a stable bundled identity",
            ))
        }
        _ => Ok(()),
    }
}

fn validate_local_audio_path(value: &str) -> MusicLibraryResult<()> {
    if value.contains('\0') || !Path::new(value).is_absolute() {
        return Err(MusicLibraryError::validation(
            "localPath",
            "must be an absolute path without null bytes",
        ));
    }
    let extension = Path::new(value)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !matches!(
        extension.as_str(),
        "mp3" | "flac" | "m4a" | "mp4" | "ogg" | "oga" | "wav"
    ) {
        return Err(MusicLibraryError::validation(
            "localPath",
            "must use a supported audio extension",
        ));
    }
    if matches!(extension.as_str(), "m4v" | "mov" | "mkv" | "webm") {
        return Err(MusicLibraryError::validation(
            "localPath",
            "video files cannot be used as soundscape loops",
        ));
    }
    let file = File::open(value).map_err(|error| {
        MusicLibraryError::validation("localPath", format!("cannot open the audio file: {error}"))
    })?;
    Decoder::try_from(file).map_err(|error| {
        MusicLibraryError::validation(
            "localPath",
            format!("cannot decode the audio file: {error}"),
        )
    })?;
    Ok(())
}

fn local_path_availability(value: Option<&str>) -> MusicSoundscapeAvailability {
    let Some(value) = value else {
        return MusicSoundscapeAvailability::Missing;
    };
    if !Path::new(value).is_file() {
        return MusicSoundscapeAvailability::Missing;
    }
    if validate_local_audio_path(value).is_ok() {
        MusicSoundscapeAvailability::Available
    } else {
        MusicSoundscapeAvailability::Unsupported
    }
}

fn decode_definition(row: DefinitionRow) -> MusicLibraryResult<MusicSoundscapeDefinition> {
    Ok(MusicSoundscapeDefinition {
        id: row.0,
        source_kind: MusicSoundscapeSourceKind::try_from(row.1.as_str())
            .map_err(|message| MusicLibraryError::runtime("decode soundscape source", message))?,
        generated_kind: row
            .2
            .as_deref()
            .map(MusicGeneratedNoiseKind::try_from)
            .transpose()
            .map_err(|message| MusicLibraryError::runtime("decode generated noise", message))?,
        bundled_identity: row.3,
        name: row.4,
        availability: MusicSoundscapeAvailability::try_from(row.5.as_str()).map_err(|message| {
            MusicLibraryError::runtime("decode soundscape availability", message)
        })?,
        local_path: row.6,
        created_at: row.7,
        updated_at: row.8,
        version: row.9,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::music::library::tests::pool;

    #[test]
    fn local_loop_validation_rejects_non_audio_and_relative_paths() {
        assert!(validate_local_audio_path("relative/rain.mp3").is_err());
        assert!(validate_local_audio_path("/tmp/rain.webm").is_err());
        assert!(validate_local_audio_path("https://youtube.com/watch?v=abc").is_err());
    }

    #[test]
    fn soundscape_crud_and_singleton_state_are_versioned() {
        tauri::async_runtime::block_on(async {
            let pool = pool().await;
            let generated = definitions(&pool, "device-a").await.unwrap();
            assert_eq!(generated.len(), 3);
            assert!(
                generated
                    .iter()
                    .all(|entry| entry.availability == MusicSoundscapeAvailability::Available)
            );

            let path = std::env::temp_dir().join(format!(
                "ganbaru-soundscape-{}-{}.wav",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
            ));
            let mut wav = Vec::from(*b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\xbb\x00\x00\x00\x77\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00");
            std::fs::write(&path, &mut wav).unwrap();
            let saved = upsert(
                &pool,
                MusicSoundscapeWrite {
                    id: "local-rain".into(),
                    source_kind: MusicSoundscapeSourceKind::LocalLoop,
                    generated_kind: None,
                    bundled_identity: None,
                    name: "Rain".into(),
                    device_id: "device-a".into(),
                    local_path: Some(path.to_string_lossy().into_owned()),
                    expected_version: None,
                    updated_at: 1_700_000_000_000,
                },
            )
            .await
            .unwrap();
            assert_eq!(saved.local_path.as_deref(), path.to_str());

            let copied_device = definitions(&pool, "device-b")
                .await
                .unwrap()
                .into_iter()
                .find(|entry| entry.id == saved.id)
                .unwrap();
            assert_eq!(copied_device.name, "Rain");
            assert_eq!(copied_device.local_path, None);
            assert_eq!(
                copied_device.availability,
                MusicSoundscapeAvailability::Missing
            );

            let initial = state(&pool).await.unwrap();
            let playing = update_state(
                &pool,
                MusicSoundscapeStateWrite {
                    active_soundscape_id: Some(saved.id.clone()),
                    desired_playing: true,
                    volume: 0.42,
                    expected_version: initial.version,
                    updated_at: 1_700_000_000_001,
                },
            )
            .await
            .unwrap();
            assert_eq!(playing.active_soundscape_id.as_deref(), Some("local-rain"));
            assert_eq!(playing.volume, 0.42);
            assert!(
                update_state(
                    &pool,
                    MusicSoundscapeStateWrite {
                        active_soundscape_id: None,
                        desired_playing: true,
                        volume: 0.5,
                        expected_version: playing.version,
                        updated_at: 1_700_000_000_002,
                    }
                )
                .await
                .is_err()
            );

            std::fs::remove_file(&path).unwrap();
            let missing = definitions(&pool, "device-a")
                .await
                .unwrap()
                .into_iter()
                .find(|entry| entry.id == saved.id)
                .unwrap();
            assert_eq!(missing.availability, MusicSoundscapeAvailability::Missing);
            remove(&pool, &saved.id, saved.version).await.unwrap();
            assert!(
                definitions(&pool, "device-a")
                    .await
                    .unwrap()
                    .iter()
                    .all(|entry| entry.id != saved.id)
            );
        });
    }
}
