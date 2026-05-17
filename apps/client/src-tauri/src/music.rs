use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, HashMap, VecDeque},
    fs::{self, File},
    hash::{Hash, Hasher},
    io::{Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::db_path::connect_sqlite;

const VALID_SOURCE_KINDS: &[&str] = &["local-file", "youtube-video", "youtube-playlist"];
const VALID_PLAYBACK_STATUSES: &[&str] = &[
    "idle", "loading", "ready", "playing", "paused", "ended", "error",
];
const MAX_MEDIA_FOLDER_FILES: usize = 5_000;
const MAX_EMBEDDED_ARTWORK_BYTES: usize = 24 * 1024 * 1024;
const MAX_TAG_BYTES: usize = 64 * 1024 * 1024;
const MEDIA_EXTENSIONS: &[&str] = &[
    "aac", "aif", "aiff", "alac", "ape", "avi", "flac", "flv", "m4a", "m4v", "mkv", "mov", "mp3",
    "mp4", "mpeg", "mpg", "ogg", "ogv", "opus", "wav", "webm", "wma", "wmv",
];
const IMAGE_EXTENSIONS: &[&str] = &["avif", "bmp", "gif", "jpeg", "jpg", "png", "webp"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFolderTrack {
    pub path: String,
    pub title: String,
    pub artwork_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFolderSelection {
    pub folder_path: String,
    pub tracks: Vec<MediaFolderTrack>,
    pub truncated: bool,
}

pub struct MusicHostState {
    pub youtube_url: String,
    media_base_url: String,
    token: String,
    media_files: Arc<Mutex<HashMap<String, HostedMedia>>>,
}

struct MusicHostShared {
    token: String,
    media_files: Arc<Mutex<HashMap<String, HostedMedia>>>,
}

#[derive(Clone)]
enum HostedMedia {
    File(PathBuf),
    Bytes {
        content_type: String,
        bytes: Arc<Vec<u8>>,
    },
}

struct EmbeddedArtwork {
    content_type: String,
    bytes: Vec<u8>,
}

type ArtworkScore = (u8, u8, u8, String);
type ArtworkCandidate = (ArtworkScore, PathBuf);

struct HttpRequest {
    method: String,
    path: String,
    range: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStateRead {
    pub source_identity: String,
    pub source_kind: String,
    pub position_ms: i64,
    pub duration_ms: Option<i64>,
    pub status: String,
    pub updated_at: i64,
}

impl_sqlite_from_row!(PlaybackStateRead {
    source_identity,
    source_kind,
    position_ms,
    duration_ms,
    status,
    updated_at
});

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStateWrite {
    pub source_identity: String,
    pub source_kind: String,
    pub position_ms: i64,
    pub duration_ms: Option<i64>,
    pub status: String,
    pub updated_at: i64,
}

#[tauri::command]
pub async fn music_get_playback_state(
    app: tauri::AppHandle,
    db_url: String,
    source_identity: String,
) -> Result<Option<PlaybackStateRead>, String> {
    if source_identity.trim().is_empty() {
        return Err("source identity is required".to_string());
    }
    let pool = connect_sqlite(app, db_url).await?;
    sqlx::query_as::<_, PlaybackStateRead>(
        "SELECT source_identity, source_kind, position_ms, duration_ms, status, updated_at
         FROM music_playback_states
         WHERE source_identity = ?",
    )
    .bind(source_identity)
    .fetch_optional(&pool)
    .await
    .map_err(|e| format!("load music playback state: {e}"))
}

#[tauri::command]
pub async fn music_save_playback_state(
    app: tauri::AppHandle,
    db_url: String,
    state: PlaybackStateWrite,
) -> Result<(), String> {
    validate_playback_state(&state)?;
    let pool = connect_sqlite(app, db_url).await?;
    sqlx::query(
        "INSERT INTO music_playback_states
            (source_identity, source_kind, position_ms, duration_ms, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_identity) DO UPDATE SET
            source_kind = excluded.source_kind,
            position_ms = excluded.position_ms,
            duration_ms = excluded.duration_ms,
            status = excluded.status,
            updated_at = excluded.updated_at",
    )
    .bind(state.source_identity)
    .bind(state.source_kind)
    .bind(state.position_ms)
    .bind(state.duration_ms)
    .bind(state.status)
    .bind(state.updated_at)
    .execute(&pool)
    .await
    .map_err(|e| format!("save music playback state: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn music_pick_media_folder(
    app: tauri::AppHandle,
) -> Result<Option<MediaFolderSelection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title("Select music folder")
            .blocking_pick_folder()
            .map(dialog_path)
            .transpose()?
        else {
            return Ok(None);
        };

        scan_media_folder(&folder).map(Some)
    })
    .await
    .map_err(|e| format!("media folder picker failed: {e}"))?
}

#[tauri::command]
pub fn music_register_media_file(
    state: State<'_, MusicHostState>,
    path: String,
) -> Result<String, String> {
    let path = PathBuf::from(path);
    require_absolute_file(&path)?;
    let id = media_file_id(&path);
    state
        .media_files
        .lock()
        .map_err(|_| "media host registry is temporarily unavailable".to_string())?
        .insert(id.clone(), HostedMedia::File(path));
    Ok(format!(
        "{}/media/{id}?token={}",
        state.media_base_url, state.token
    ))
}

#[tauri::command]
pub fn music_register_embedded_artwork(
    state: State<'_, MusicHostState>,
    path: String,
) -> Result<Option<String>, String> {
    let path = PathBuf::from(path);
    require_absolute_file(&path)?;
    let Some(artwork) = extract_embedded_artwork(&path)? else {
        return Ok(None);
    };
    let id = embedded_artwork_id(&path, &artwork);
    state
        .media_files
        .lock()
        .map_err(|_| "media host registry is temporarily unavailable".to_string())?
        .insert(
            id.clone(),
            HostedMedia::Bytes {
                content_type: artwork.content_type,
                bytes: Arc::new(artwork.bytes),
            },
        );
    Ok(Some(format!(
        "{}/media/{id}?token={}",
        state.media_base_url, state.token
    )))
}

#[tauri::command]
pub fn music_youtube_host_url(state: State<'_, MusicHostState>) -> String {
    state.youtube_url.clone()
}

pub fn setup_youtube_host(app: &tauri::AppHandle) -> Result<(), String> {
    app.manage(spawn_music_host()?);
    Ok(())
}

fn scan_media_folder(folder: &Path) -> Result<MediaFolderSelection, String> {
    require_absolute_directory(folder)?;
    let mut queue = VecDeque::from([folder.to_path_buf()]);
    let mut tracks = Vec::new();
    let mut truncated = false;
    let mut artwork_cache: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();

    while let Some(dir) = queue.pop_front() {
        let entries = fs::read_dir(&dir)
            .map_err(|e| format!("failed to read media folder '{}': {e}", dir.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("failed to read media folder entry: {e}"))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|e| format!("failed to inspect '{}': {e}", path.display()))?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                queue.push_back(path);
                continue;
            }
            if !file_type.is_file() || !is_supported_media_path(&path) {
                continue;
            }
            let artwork_path = find_track_artwork(&path, folder, &mut artwork_cache);
            tracks.push(MediaFolderTrack {
                title: media_title_from_path(&path),
                path: path.to_string_lossy().to_string(),
                artwork_path: artwork_path.map(|path| path.to_string_lossy().to_string()),
            });
            if tracks.len() >= MAX_MEDIA_FOLDER_FILES {
                truncated = true;
                break;
            }
        }
        if truncated {
            break;
        }
    }

    tracks.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(MediaFolderSelection {
        folder_path: folder.to_string_lossy().to_string(),
        tracks,
        truncated,
    })
}

fn dialog_path(path: FilePath) -> Result<PathBuf, String> {
    path.into_path()
        .map_err(|e| format!("selected path is not a local folder: {e}"))
}

fn require_absolute_directory(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("media folder path must be absolute".to_string());
    }
    let metadata =
        fs::metadata(path).map_err(|e| format!("failed to inspect media folder: {e}"))?;
    if metadata.is_dir() {
        Ok(())
    } else {
        Err("selected media path must be a folder".to_string())
    }
}

fn require_absolute_file(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("media file path must be absolute".to_string());
    }
    let metadata = fs::metadata(path).map_err(|e| format!("failed to inspect media file: {e}"))?;
    if metadata.is_file() {
        Ok(())
    } else {
        Err("selected media path must be a file".to_string())
    }
}

fn media_file_id(path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn is_supported_media_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            MEDIA_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn is_supported_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            IMAGE_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn media_title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled media")
        .to_string()
}

fn find_track_artwork(
    track_path: &Path,
    root: &Path,
    artwork_cache: &mut HashMap<PathBuf, Vec<PathBuf>>,
) -> Option<PathBuf> {
    let mut dir = track_path.parent()?;
    let mut distance = 0_u8;
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut best: Option<ArtworkCandidate> = None;
    let track_stem = normalized_artwork_stem(track_path);

    loop {
        consider_artwork_dir(dir, distance, 0, &track_stem, artwork_cache, &mut best);
        for (subdir_distance, name) in [
            "cover", "covers", "artwork", "art", "scans", "scan", "booklet",
        ]
        .iter()
        .enumerate()
        {
            let candidate_dir = dir.join(name);
            if candidate_dir.is_dir() {
                consider_artwork_dir(
                    &candidate_dir,
                    distance,
                    (subdir_distance + 1) as u8,
                    &track_stem,
                    artwork_cache,
                    &mut best,
                );
            }
        }

        let current = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
        if current == root {
            break;
        }
        let Some(parent) = dir.parent() else {
            break;
        };
        dir = parent;
        distance = distance.saturating_add(1);
    }

    best.map(|(_, path)| path)
}

fn consider_artwork_dir(
    dir: &Path,
    distance: u8,
    subdir_distance: u8,
    track_stem: &str,
    artwork_cache: &mut HashMap<PathBuf, Vec<PathBuf>>,
    best: &mut Option<ArtworkCandidate>,
) {
    let candidates = artwork_cache
        .entry(dir.to_path_buf())
        .or_insert_with(|| find_directory_artwork_candidates(dir));
    let Some((score, path)) = candidates
        .iter()
        .map(|path| {
            let (rank, name) = artwork_rank_for_track(path, track_stem);
            ((rank, distance, subdir_distance, name), path)
        })
        .min_by(|(left, _), (right, _)| left.cmp(right))
    else {
        return;
    };
    if best
        .as_ref()
        .is_none_or(|(best_score, _)| score < *best_score)
    {
        *best = Some((score, path.clone()));
    }
}

fn find_directory_artwork_candidates(dir: &Path) -> Vec<PathBuf> {
    let Some(entries) = fs::read_dir(dir).ok() else {
        return Vec::new();
    };
    let mut candidates = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() || !file_type.is_file() || !is_supported_image_path(&path) {
            continue;
        }
        candidates.push(path);
    }
    candidates
}

fn artwork_rank_for_track(path: &Path, track_stem: &str) -> (u8, String) {
    let stem = normalized_artwork_stem(path);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let priority = if !track_stem.is_empty() && stem == track_stem {
        0
    } else if stem == "cover" {
        1
    } else if stem == "folder" {
        2
    } else if stem == "front" {
        3
    } else if stem == "albumart" || stem == "album" {
        4
    } else if !track_stem.is_empty() && stem.contains(track_stem) {
        5
    } else if stem.contains("cover") || stem.contains("folder") || stem.contains("front") {
        6
    } else if stem.contains("albumart") || stem.contains("album") {
        7
    } else {
        8
    };
    (priority, file_name)
}

fn normalized_artwork_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .replace([' ', '_', '-', '.'], "")
}

fn embedded_artwork_id(path: &Path, artwork: &EmbeddedArtwork) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    artwork.content_type.hash(&mut hasher);
    artwork.bytes.len().hash(&mut hasher);
    artwork.bytes.hash(&mut hasher);
    format!("artwork-{:x}", hasher.finish())
}

fn extract_embedded_artwork(path: &Path) -> Result<Option<EmbeddedArtwork>, String> {
    let mut file =
        File::open(path).map_err(|e| format!("failed to open media file for artwork: {e}"))?;
    let mut header = [0_u8; 12];
    let read = file
        .read(&mut header)
        .map_err(|e| format!("failed to read media header for artwork: {e}"))?;
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("failed to seek media file for artwork: {e}"))?;

    if read >= 10 && &header[..3] == b"ID3" {
        return extract_id3_artwork(&mut file);
    }
    if read >= 4 && &header[..4] == b"fLaC" {
        return extract_flac_artwork(&mut file);
    }
    if read >= 8 && &header[4..8] == b"ftyp" {
        return extract_mp4_artwork(&mut file);
    }
    Ok(None)
}

fn extract_id3_artwork(file: &mut File) -> Result<Option<EmbeddedArtwork>, String> {
    let mut header = [0_u8; 10];
    file.read_exact(&mut header)
        .map_err(|e| format!("failed to read ID3 header: {e}"))?;
    if &header[..3] != b"ID3" {
        return Ok(None);
    }
    let version = header[3];
    let tag_size =
        synchsafe_u32(&header[6..10]).ok_or_else(|| "invalid ID3 tag size".to_string())? as usize;
    if tag_size > MAX_TAG_BYTES {
        return Ok(None);
    }
    let mut tag = vec![0_u8; tag_size];
    file.read_exact(&mut tag)
        .map_err(|e| format!("failed to read ID3 tag: {e}"))?;
    if header[5] & 0x80 != 0 {
        tag = remove_id3_unsynchronization(&tag);
    }

    let frame_start = id3_frame_start(version, header[5], &tag);
    parse_id3_frames(version, &tag[frame_start..])
}

fn remove_id3_unsynchronization(bytes: &[u8]) -> Vec<u8> {
    let mut clean = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == 0xff && bytes.get(index + 1) == Some(&0) {
            clean.push(0xff);
            index += 2;
            continue;
        }
        clean.push(bytes[index]);
        index += 1;
    }
    clean
}

fn id3_frame_start(version: u8, flags: u8, tag: &[u8]) -> usize {
    if flags & 0x40 == 0 || tag.len() < 4 {
        return 0;
    }
    if version == 4 {
        let Some(size) = synchsafe_u32(&tag[..4]) else {
            return 0;
        };
        usize::try_from(size).unwrap_or(0).min(tag.len())
    } else {
        let size = u32::from_be_bytes([tag[0], tag[1], tag[2], tag[3]]) as usize;
        size.saturating_add(4).min(tag.len())
    }
}

fn parse_id3_frames(version: u8, frames: &[u8]) -> Result<Option<EmbeddedArtwork>, String> {
    if version == 2 {
        return parse_id3v22_frames(frames);
    }

    let mut offset = 0;
    let mut fallback = None;
    while offset + 10 <= frames.len() {
        let id = &frames[offset..offset + 4];
        if id.iter().all(|byte| *byte == 0) {
            break;
        }
        let size = if version == 4 {
            synchsafe_u32(&frames[offset + 4..offset + 8]).unwrap_or(0)
        } else {
            u32::from_be_bytes([
                frames[offset + 4],
                frames[offset + 5],
                frames[offset + 6],
                frames[offset + 7],
            ])
        } as usize;
        offset += 10;
        if size == 0 || offset + size > frames.len() {
            break;
        }
        if id == b"APIC" {
            let Some((picture_type, artwork)) = parse_apic_frame(&frames[offset..offset + size])
            else {
                offset += size;
                continue;
            };
            if picture_type == 3 {
                return Ok(Some(artwork));
            }
            fallback.get_or_insert(artwork);
        }
        offset += size;
    }
    Ok(fallback)
}

fn parse_id3v22_frames(frames: &[u8]) -> Result<Option<EmbeddedArtwork>, String> {
    let mut offset = 0;
    let mut fallback = None;
    while offset + 6 <= frames.len() {
        let id = &frames[offset..offset + 3];
        if id.iter().all(|byte| *byte == 0) {
            break;
        }
        let size = ((frames[offset + 3] as usize) << 16)
            | ((frames[offset + 4] as usize) << 8)
            | frames[offset + 5] as usize;
        offset += 6;
        if size == 0 || offset + size > frames.len() {
            break;
        }
        if id == b"PIC" {
            let Some((picture_type, artwork)) = parse_pic_frame(&frames[offset..offset + size])
            else {
                offset += size;
                continue;
            };
            if picture_type == 3 {
                return Ok(Some(artwork));
            }
            fallback.get_or_insert(artwork);
        }
        offset += size;
    }
    Ok(fallback)
}

fn parse_apic_frame(frame: &[u8]) -> Option<(u8, EmbeddedArtwork)> {
    if frame.len() < 5 {
        return None;
    }
    let encoding = frame[0];
    let mime_end = frame[1..].iter().position(|byte| *byte == 0)? + 1;
    let mime = std::str::from_utf8(&frame[1..mime_end])
        .ok()?
        .to_ascii_lowercase();
    let picture_type = *frame.get(mime_end + 1)?;
    let description_start = mime_end + 2;
    let data_start =
        description_start + encoded_terminator_offset(encoding, &frame[description_start..])?;
    let content_type = normalize_artwork_content_type(&mime, &frame[data_start..])?;
    let bytes = frame[data_start..].to_vec();
    validate_artwork_bytes(&bytes)?;
    Some((
        picture_type,
        EmbeddedArtwork {
            content_type,
            bytes,
        },
    ))
}

fn parse_pic_frame(frame: &[u8]) -> Option<(u8, EmbeddedArtwork)> {
    if frame.len() < 6 {
        return None;
    }
    let encoding = frame[0];
    let format = std::str::from_utf8(&frame[1..4]).ok()?.to_ascii_lowercase();
    let picture_type = frame[4];
    let description_start = 5;
    let data_start =
        description_start + encoded_terminator_offset(encoding, &frame[description_start..])?;
    let mime = match format.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        _ => format.as_str(),
    };
    let content_type = normalize_artwork_content_type(mime, &frame[data_start..])?;
    let bytes = frame[data_start..].to_vec();
    validate_artwork_bytes(&bytes)?;
    Some((
        picture_type,
        EmbeddedArtwork {
            content_type,
            bytes,
        },
    ))
}

fn encoded_terminator_offset(encoding: u8, value: &[u8]) -> Option<usize> {
    if encoding == 1 || encoding == 2 {
        let position = value
            .windows(2)
            .position(|window| window == [0, 0])
            .map(|index| index + 2)?;
        return Some(position);
    }
    value
        .iter()
        .position(|byte| *byte == 0)
        .map(|index| index + 1)
}

fn extract_flac_artwork(file: &mut File) -> Result<Option<EmbeddedArtwork>, String> {
    let mut signature = [0_u8; 4];
    file.read_exact(&mut signature)
        .map_err(|e| format!("failed to read FLAC signature: {e}"))?;
    if &signature != b"fLaC" {
        return Ok(None);
    }

    let mut fallback = None;
    loop {
        let mut header = [0_u8; 4];
        if file.read_exact(&mut header).is_err() {
            break;
        }
        let is_last = header[0] & 0x80 != 0;
        let block_type = header[0] & 0x7f;
        let size = ((header[1] as usize) << 16) | ((header[2] as usize) << 8) | header[3] as usize;
        if size > MAX_TAG_BYTES {
            return Ok(None);
        }
        if block_type == 6 {
            let mut block = vec![0_u8; size];
            file.read_exact(&mut block)
                .map_err(|e| format!("failed to read FLAC picture block: {e}"))?;
            if let Some((picture_type, artwork)) = parse_flac_picture_block(&block) {
                if picture_type == 3 {
                    return Ok(Some(artwork));
                }
                fallback.get_or_insert(artwork);
            }
        } else {
            file.seek(SeekFrom::Current(size as i64))
                .map_err(|e| format!("failed to skip FLAC metadata block: {e}"))?;
        }
        if is_last {
            break;
        }
    }
    Ok(fallback)
}

fn parse_flac_picture_block(block: &[u8]) -> Option<(u32, EmbeddedArtwork)> {
    let mut offset = 0;
    let picture_type = read_be_u32(block, &mut offset)?;
    let mime_len = read_be_u32(block, &mut offset)? as usize;
    let mime = read_bytes(block, &mut offset, mime_len)?;
    let mime = std::str::from_utf8(mime).ok()?.to_ascii_lowercase();
    let description_len = read_be_u32(block, &mut offset)? as usize;
    read_bytes(block, &mut offset, description_len)?;
    for _ in 0..4 {
        read_be_u32(block, &mut offset)?;
    }
    let data_len = read_be_u32(block, &mut offset)? as usize;
    let data = read_bytes(block, &mut offset, data_len)?;
    let content_type = normalize_artwork_content_type(&mime, data)?;
    let bytes = data.to_vec();
    validate_artwork_bytes(&bytes)?;
    Some((
        picture_type,
        EmbeddedArtwork {
            content_type,
            bytes,
        },
    ))
}

fn extract_mp4_artwork(file: &mut File) -> Result<Option<EmbeddedArtwork>, String> {
    let len = file
        .metadata()
        .map_err(|e| format!("failed to inspect MP4 file for artwork: {e}"))?
        .len();
    parse_mp4_atoms(file, 0, len, 0)
}

fn parse_mp4_atoms(
    file: &mut File,
    start: u64,
    end: u64,
    depth: u8,
) -> Result<Option<EmbeddedArtwork>, String> {
    if depth > 8 {
        return Ok(None);
    }

    let mut offset = start;
    while offset.saturating_add(8) <= end {
        let header = read_file_bytes(file, offset, 8)?;
        let size32 = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
        let atom_type = [header[4], header[5], header[6], header[7]];
        let (atom_size, header_size) = if size32 == 1 {
            let large_size = read_file_bytes(file, offset + 8, 8)?;
            (
                u64::from_be_bytes([
                    large_size[0],
                    large_size[1],
                    large_size[2],
                    large_size[3],
                    large_size[4],
                    large_size[5],
                    large_size[6],
                    large_size[7],
                ]),
                16,
            )
        } else if size32 == 0 {
            (end.saturating_sub(offset), 8)
        } else {
            (u64::from(size32), 8)
        };
        if atom_size < header_size || offset.saturating_add(atom_size) > end {
            break;
        }

        let content_start = offset + header_size;
        let content_end = offset + atom_size;
        match &atom_type {
            b"moov" | b"udta" | b"ilst" => {
                if let Some(artwork) = parse_mp4_atoms(file, content_start, content_end, depth + 1)?
                {
                    return Ok(Some(artwork));
                }
            }
            b"meta" => {
                if content_start.saturating_add(4) <= content_end {
                    if let Some(artwork) =
                        parse_mp4_atoms(file, content_start + 4, content_end, depth + 1)?
                    {
                        return Ok(Some(artwork));
                    }
                }
            }
            b"covr" => {
                if let Some(artwork) = parse_mp4_cover_atom(file, content_start, content_end)? {
                    return Ok(Some(artwork));
                }
            }
            _ => {}
        }

        offset += atom_size;
    }
    Ok(None)
}

fn parse_mp4_cover_atom(
    file: &mut File,
    start: u64,
    end: u64,
) -> Result<Option<EmbeddedArtwork>, String> {
    let mut offset = start;
    while offset.saturating_add(16) <= end {
        let header = read_file_bytes(file, offset, 8)?;
        let atom_size = u64::from(u32::from_be_bytes([
            header[0], header[1], header[2], header[3],
        ]));
        let atom_type = [header[4], header[5], header[6], header[7]];
        if atom_size < 16 || offset.saturating_add(atom_size) > end {
            break;
        }
        if &atom_type == b"data" {
            let data_header = read_file_bytes(file, offset + 8, 8)?;
            let data_type = u32::from_be_bytes([
                data_header[0],
                data_header[1],
                data_header[2],
                data_header[3],
            ]);
            let payload_start = offset + 16;
            let payload_len = atom_size - 16;
            if payload_len > MAX_EMBEDDED_ARTWORK_BYTES as u64 {
                return Ok(None);
            }
            let bytes = read_file_bytes(file, payload_start, payload_len as usize)?;
            if validate_artwork_bytes(&bytes).is_none() {
                return Ok(None);
            }
            let content_type = match data_type {
                13 => "image/jpeg".to_string(),
                14 => "image/png".to_string(),
                _ => sniff_image_content_type(&bytes)
                    .unwrap_or("application/octet-stream")
                    .to_string(),
            };
            if content_type == "application/octet-stream" {
                return Ok(None);
            }
            return Ok(Some(EmbeddedArtwork {
                content_type,
                bytes,
            }));
        }
        offset += atom_size;
    }
    Ok(None)
}

fn read_file_bytes(file: &mut File, offset: u64, len: usize) -> Result<Vec<u8>, String> {
    let mut bytes = vec![0_u8; len];
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("failed to seek metadata bytes: {e}"))?;
    file.read_exact(&mut bytes)
        .map_err(|e| format!("failed to read metadata bytes: {e}"))?;
    Ok(bytes)
}

fn read_be_u32(bytes: &[u8], offset: &mut usize) -> Option<u32> {
    let end = (*offset).checked_add(4)?;
    let value = bytes.get(*offset..end)?;
    *offset = end;
    Some(u32::from_be_bytes([value[0], value[1], value[2], value[3]]))
}

fn read_bytes<'a>(bytes: &'a [u8], offset: &mut usize, len: usize) -> Option<&'a [u8]> {
    let end = (*offset).checked_add(len)?;
    let value = bytes.get(*offset..end)?;
    *offset = end;
    Some(value)
}

fn synchsafe_u32(bytes: &[u8]) -> Option<u32> {
    if bytes.len() != 4 || bytes.iter().any(|byte| byte & 0x80 != 0) {
        return None;
    }
    Some(
        ((bytes[0] as u32) << 21)
            | ((bytes[1] as u32) << 14)
            | ((bytes[2] as u32) << 7)
            | bytes[3] as u32,
    )
}

fn normalize_artwork_content_type(mime: &str, bytes: &[u8]) -> Option<String> {
    let normalized = match mime {
        "image/jpg" | "image/jpeg" => "image/jpeg",
        "image/png" => "image/png",
        "image/webp" => "image/webp",
        "image/gif" => "image/gif",
        "image/bmp" => "image/bmp",
        "image/avif" => "image/avif",
        "" => sniff_image_content_type(bytes)?,
        _ => sniff_image_content_type(bytes)?,
    };
    Some(normalized.to_string())
}

fn sniff_image_content_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Some("image/webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }
    None
}

fn validate_artwork_bytes(bytes: &[u8]) -> Option<()> {
    if bytes.is_empty() || bytes.len() > MAX_EMBEDDED_ARTWORK_BYTES {
        None
    } else {
        Some(())
    }
}

fn spawn_music_host() -> Result<MusicHostState, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("failed to bind music player host: {e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("failed to inspect music player host address: {e}"))?;
    let token = make_music_host_token();
    let media_files = Arc::new(Mutex::new(HashMap::new()));
    let shared = Arc::new(MusicHostShared {
        token: token.clone(),
        media_files: Arc::clone(&media_files),
    });
    let thread_shared = Arc::clone(&shared);
    thread::Builder::new()
        .name("music-player-host".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else {
                    continue;
                };
                handle_music_host_stream(stream, Arc::clone(&thread_shared));
            }
        })
        .map_err(|e| format!("failed to start music player host: {e}"))?;

    let base_url = format!("http://{addr}");
    Ok(MusicHostState {
        youtube_url: format!("{base_url}/youtube-player.html?token={token}"),
        media_base_url: base_url,
        token,
        media_files,
    })
}

fn make_music_host_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{:x}{:x}", std::process::id(), nanos)
}

fn handle_music_host_stream(mut stream: TcpStream, shared: Arc<MusicHostShared>) {
    let Some(request) = read_http_request(&mut stream) else {
        return;
    };
    let authorized = request_token(&request.path).is_some_and(|token| token == shared.token);
    if request.method != "GET" && request.method != "HEAD" {
        write_http_response(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain; charset=utf-8",
            "Method not allowed",
        );
        return;
    }
    if request.path.starts_with("/youtube-player.html") && authorized {
        write_http_response(
            &mut stream,
            "200 OK",
            "text/html; charset=utf-8",
            youtube_host_html(),
        );
    } else if request.path.starts_with("/media/") && authorized {
        match media_from_request(&request, &shared) {
            Ok(media) => {
                if let Err(err) = write_hosted_media_response(&mut stream, &request, &media) {
                    write_http_response(
                        &mut stream,
                        "500 Internal Server Error",
                        "text/plain; charset=utf-8",
                        &format!("Media read failed: {err}"),
                    );
                }
            }
            Err(status) => {
                write_http_response(&mut stream, status, "text/plain; charset=utf-8", status)
            }
        }
    } else {
        write_http_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            "Not found",
        );
    }
}

fn read_http_request(stream: &mut TcpStream) -> Option<HttpRequest> {
    let mut buffer = [0; 8192];
    let size = stream.read(&mut buffer).ok()?;
    let request = String::from_utf8_lossy(&buffer[..size]);
    let mut lines = request.lines();
    let request_line = lines.next()?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next()?.to_string();
    let path = request_parts.next()?.to_string();
    let range = lines.find_map(|line| {
        line.split_once(':').and_then(|(name, value)| {
            if name.eq_ignore_ascii_case("range") {
                Some(value.trim().to_string())
            } else {
                None
            }
        })
    });
    Some(HttpRequest {
        method,
        path,
        range,
    })
}

fn request_token(path: &str) -> Option<&str> {
    let query = path.split_once('?')?.1;
    query.split('&').find_map(|part| {
        let (name, value) = part.split_once('=')?;
        if name == "token" {
            Some(value)
        } else {
            None
        }
    })
}

fn media_from_request(
    request: &HttpRequest,
    shared: &MusicHostShared,
) -> Result<HostedMedia, &'static str> {
    let path_without_query = request.path.split('?').next().unwrap_or_default();
    let id = path_without_query
        .strip_prefix("/media/")
        .filter(|value| !value.is_empty())
        .ok_or("404 Not Found")?;
    shared
        .media_files
        .lock()
        .map_err(|_| "503 Service Unavailable")?
        .get(id)
        .cloned()
        .ok_or("404 Not Found")
}

fn write_media_file_response(
    stream: &mut TcpStream,
    request: &HttpRequest,
    path: &Path,
) -> std::io::Result<()> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let content_type = media_content_type(path);
    let Some(range) = request
        .range
        .as_deref()
        .and_then(|value| parse_byte_range(value, len))
    else {
        write_media_headers(stream, "200 OK", content_type, len, None)?;
        if request.method != "HEAD" {
            copy_limited(&mut file, stream, len)?;
        }
        return Ok(());
    };

    write_media_headers(
        stream,
        "206 Partial Content",
        content_type,
        range.end - range.start + 1,
        Some((range, len)),
    )?;
    if request.method != "HEAD" {
        file.seek(SeekFrom::Start(range.start))?;
        copy_limited(&mut file, stream, range.end - range.start + 1)?;
    }
    Ok(())
}

fn write_hosted_media_response(
    stream: &mut TcpStream,
    request: &HttpRequest,
    media: &HostedMedia,
) -> std::io::Result<()> {
    match media {
        HostedMedia::File(path) => write_media_file_response(stream, request, path),
        HostedMedia::Bytes {
            content_type,
            bytes,
        } => write_media_bytes_response(stream, request, content_type, bytes.as_slice()),
    }
}

fn write_media_bytes_response(
    stream: &mut TcpStream,
    request: &HttpRequest,
    content_type: &str,
    bytes: &[u8],
) -> std::io::Result<()> {
    let len = bytes.len() as u64;
    let Some(range) = request
        .range
        .as_deref()
        .and_then(|value| parse_byte_range(value, len))
    else {
        write_media_headers(stream, "200 OK", content_type, len, None)?;
        if request.method != "HEAD" {
            stream.write_all(bytes)?;
            stream.flush()?;
        }
        return Ok(());
    };

    write_media_headers(
        stream,
        "206 Partial Content",
        content_type,
        range.end - range.start + 1,
        Some((range, len)),
    )?;
    if request.method != "HEAD" {
        let start = range.start as usize;
        let end = range.end as usize + 1;
        stream.write_all(&bytes[start..end])?;
        stream.flush()?;
    }
    Ok(())
}

fn write_media_headers(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    content_length: u64,
    content_range: Option<(ByteRange, u64)>,
) -> std::io::Result<()> {
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {content_length}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n"
    );
    if let Some((range, len)) = content_range {
        response.push_str(&format!(
            "Content-Range: bytes {}-{}/{}\r\n",
            range.start, range.end, len
        ));
    }
    response.push_str("\r\n");
    stream.write_all(response.as_bytes())
}

fn copy_limited(
    file: &mut File,
    stream: &mut TcpStream,
    mut remaining: u64,
) -> std::io::Result<()> {
    let mut buffer = [0_u8; 64 * 1024];
    while remaining > 0 {
        let read_limit =
            usize::try_from(remaining.min(buffer.len() as u64)).unwrap_or(buffer.len());
        let read = file.read(&mut buffer[..read_limit])?;
        if read == 0 {
            break;
        }
        stream.write_all(&buffer[..read])?;
        remaining = remaining.saturating_sub(read as u64);
    }
    stream.flush()
}

fn parse_byte_range(header: &str, len: u64) -> Option<ByteRange> {
    if len == 0 {
        return None;
    }
    let range = header.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = range.split_once('-')?;
    if start.is_empty() {
        let suffix_len = end.parse::<u64>().ok()?.min(len);
        if suffix_len == 0 {
            return None;
        }
        return Some(ByteRange {
            start: len - suffix_len,
            end: len - 1,
        });
    }
    let start = start.parse::<u64>().ok()?;
    if start >= len {
        return None;
    }
    let end = if end.is_empty() {
        len - 1
    } else {
        end.parse::<u64>().ok()?.min(len - 1)
    };
    if end < start {
        return None;
    }
    Some(ByteRange { start, end })
}

fn media_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("aac") => "audio/aac",
        Some("aif") | Some("aiff") => "audio/aiff",
        Some("flac") => "audio/flac",
        Some("m4a") | Some("alac") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("ogg") | Some("opus") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("wma") => "audio/x-ms-wma",
        Some("avi") => "video/x-msvideo",
        Some("flv") => "video/x-flv",
        Some("m4v") | Some("mp4") => "video/mp4",
        Some("mkv") => "video/x-matroska",
        Some("mov") => "video/quicktime",
        Some("mpeg") | Some("mpg") => "video/mpeg",
        Some("ogv") => "video/ogg",
        Some("webm") => "video/webm",
        Some("wmv") => "video/x-ms-wmv",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

fn write_http_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn youtube_host_html() -> &'static str {
    r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GanbaruAI YouTube player</title>
  <style>
    html, body, #player-root, #player { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #000; }
  </style>
</head>
<body>
  <div id="player-root"><div id="player"></div></div>
  <script>
    const params = new URLSearchParams(location.search);
    const token = params.get("token") || "";
    const loadId = params.get("load") || "";
    let player = null;
    let apiReady = false;
    let activeSource = null;
    let playlistSnapshotTimer = null;
    let playlistErrorSent = false;

    function numberParam(name, fallback) {
      const raw = params.get(name);
      if (raw === null || raw === "") return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    }

    function booleanParam(name) {
      return params.get(name) === "true";
    }

    function initialPayloadFromParams() {
      const kind = params.get("sourceKind");
      const videoId = params.get("videoId");
      const playlistId = params.get("playlistId");
      if (kind !== "youtube-video" && kind !== "youtube-playlist") return null;
      if (kind === "youtube-video" && !videoId) return null;
      if (kind === "youtube-playlist" && !playlistId) return null;

      const source = {
        kind,
        videoId,
        playlistId: playlistId || null,
        startMs: numberParam("startMs", null),
        endMs: numberParam("endMs", null)
      };
      return {
        source,
        resumeMs: numberParam("resumeMs", 0),
        volume: numberParam("volume", 0.8),
        rate: numberParam("rate", 1),
        autoplay: booleanParam("autoplay")
      };
    }

    function send(message) {
      parent.postMessage({ token, load: loadId, ...message }, "*");
    }

    function resetPlayerElement() {
      const root = document.getElementById("player-root");
      if (!root) return "player";
      root.replaceChildren();
      const element = document.createElement("div");
      element.id = "player";
      root.appendChild(element);
      return element;
    }

    function playbackStatus(state) {
      if (state === 0) return "ended";
      if (state === 1) return "playing";
      if (state === 2) return "paused";
      if (state === 3) return "loading";
      if (state === 5) return "ready";
      return "ready";
    }

    function snapshot(status) {
      if (!player) return;
      const duration = player.getDuration();
      const metadata = videoMetadata();
      send({
        type: "ganbaruai-youtube-state",
        status: status || playbackStatus(player.getPlayerState()),
        positionMs: Math.max(0, Math.round(player.getCurrentTime() * 1000)),
        durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null,
        videoId: metadata.videoId,
        title: metadata.title
      });
    }

    function currentPlaylistIds() {
      if (!player || typeof player.getPlaylist !== "function") return [];
      const playlist = player.getPlaylist();
      if (!Array.isArray(playlist)) return [];
      return playlist.filter((videoId) => typeof videoId === "string" && videoId.length > 0);
    }

    function currentPlaylistIndex() {
      if (!player || typeof player.getPlaylistIndex !== "function") return null;
      const index = player.getPlaylistIndex();
      return Number.isFinite(index) && index >= 0 ? index : null;
    }

    function sendPlaylistSnapshot(retries) {
      if (!activeSource || activeSource.kind !== "youtube-playlist" || !activeSource.playlistId) return;
      const videoIds = currentPlaylistIds();
      if (videoIds.length > 0) {
        send({
          type: "ganbaruai-youtube-playlist",
          playlistId: activeSource.playlistId,
          videoIds,
          index: currentPlaylistIndex()
        });
        return;
      }
      if (retries <= 0) {
        sendPlaylistResolutionError();
        return;
      }
      if (playlistSnapshotTimer) clearTimeout(playlistSnapshotTimer);
      playlistSnapshotTimer = setTimeout(() => {
        playlistSnapshotTimer = null;
        sendPlaylistSnapshot(retries - 1);
      }, 500);
    }

    function sendPlaylistResolutionError() {
      if (!activeSource || !activeSource.playlistId || playlistErrorSent) return;
      playlistErrorSent = true;
      send({
        type: "ganbaruai-youtube-playlist-error",
        playlistId: activeSource.playlistId
      });
    }

    function playlistRequest(source, payload) {
      const request = {
        listType: "playlist",
        list: source.playlistId,
        index: 0
      };
      const startSeconds = payload.resumeMs > 0
        ? payload.resumeMs / 1000
        : (source.startMs !== null ? Math.floor(source.startMs / 1000) : null);
      if (startSeconds !== null) request.startSeconds = startSeconds;
      return request;
    }

    function videoMetadata() {
      if (!player || typeof player.getVideoData !== "function") {
        return { videoId: null, title: null };
      }
      const data = player.getVideoData();
      if (!data || typeof data !== "object") {
        return { videoId: null, title: null };
      }
      const videoId = typeof data.video_id === "string" && data.video_id.trim()
        ? data.video_id.trim()
        : null;
      const title = typeof data.title === "string" && data.title.trim()
        ? data.title.trim()
        : null;
      return { videoId, title };
    }

    function applyVolume(value) {
      if (!player || typeof value !== "number" || !Number.isFinite(value)) return;
      const volume = Math.max(0, Math.min(100, Math.round(value * 100)));
      player.setVolume(volume);
      if (volume > 0 && typeof player.unMute === "function") {
        player.unMute();
      } else if (volume === 0 && typeof player.mute === "function") {
        player.mute();
      }
    }

    function playerVars(source) {
      const vars = {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        playsinline: 1,
        rel: 0,
        origin: location.origin,
        widget_referrer: location.href
      };
      if (source.kind === "youtube-playlist") {
        vars.listType = "playlist";
        vars.list = source.playlistId;
      }
      if (source.startMs !== null) vars.start = Math.floor(source.startMs / 1000);
      if (source.endMs !== null) vars.end = Math.floor(source.endMs / 1000);
      return vars;
    }

    function loadSource(payload) {
      if (!apiReady) return;
      if (player) {
        player.destroy();
        player = null;
      }
      const playerElement = resetPlayerElement();
      const source = payload.source;
      activeSource = source;
      playlistErrorSent = false;
      if (playlistSnapshotTimer) {
        clearTimeout(playlistSnapshotTimer);
        playlistSnapshotTimer = null;
      }
      const options = {
        host: "https://www.youtube.com",
        width: "100%",
        height: "100%",
        playerVars: playerVars(source),
        events: {
          onReady(event) {
            event.target.getIframe().setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
            applyVolume(payload.volume);
            event.target.setPlaybackRate(payload.rate);
            if (source.kind === "youtube-playlist" && !source.videoId) {
              const request = playlistRequest(source, payload);
              if (payload.autoplay === true) {
                event.target.loadPlaylist(request);
              } else {
                event.target.cuePlaylist(request);
              }
            } else if (payload.resumeMs > 0) {
              event.target.seekTo(payload.resumeMs / 1000, true);
            }
            if (payload.autoplay === true) {
              event.target.playVideo();
            }
            snapshot("ready");
            sendPlaylistSnapshot(30);
          },
          onStateChange(event) {
            snapshot(playbackStatus(event.data));
            sendPlaylistSnapshot(30);
          },
          onError(event) {
            send({ type: "ganbaruai-youtube-error", code: event.data });
          }
        }
      };
      if (source.kind === "youtube-video" || source.videoId) {
        options.videoId = source.kind === "youtube-video" ? source.videoId : source.videoId;
      }
      player = new YT.Player(playerElement, options);
    }

    function handleCommand(data) {
      if (!player) return;
      if (data.action === "snapshot") {
        snapshot();
        return;
      }
      if (data.action === "play") {
        const volume = typeof data.volume === "number" ? data.volume : null;
        applyVolume(volume);
        player.playVideo();
        if (volume !== null) {
          setTimeout(() => applyVolume(volume), 0);
          setTimeout(() => applyVolume(volume), 150);
        }
        snapshot("playing");
        return;
      }
      if (data.action === "pause") {
        applyVolume(data.volume);
        player.pauseVideo();
        snapshot("paused");
        return;
      }
      if (data.action === "stop") player.stopVideo();
      if (data.action === "seek") player.seekTo(data.positionMs / 1000, true);
      if (data.action === "volume") applyVolume(data.volume);
      if (data.action === "rate") player.setPlaybackRate(data.rate);
      snapshot();
    }

    window.onYouTubeIframeAPIReady = () => {
      apiReady = true;
      send({ type: "ganbaruai-youtube-ready" });
      const initialLoad = initialPayloadFromParams();
      if (initialLoad) {
        loadSource(initialLoad);
      }
    };

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.token !== token || data.type !== "ganbaruai-youtube-command") return;
      handleCommand(data);
    });

    window.setInterval(() => {
      if (player) snapshot();
    }, 1000);
  </script>
  <script src="https://www.youtube.com/iframe_api"></script>
</body>
</html>"#
}

fn validate_playback_state(state: &PlaybackStateWrite) -> Result<(), String> {
    if state.source_identity.trim().is_empty() {
        return Err("source identity is required".to_string());
    }
    if !VALID_SOURCE_KINDS.contains(&state.source_kind.as_str()) {
        return Err(format!(
            "unsupported music source kind '{}'",
            state.source_kind
        ));
    }
    if state.position_ms < 0 {
        return Err("position must be zero or greater".to_string());
    }
    if state.duration_ms.is_some_and(|duration| duration < 0) {
        return Err("duration must be zero or greater".to_string());
    }
    if !VALID_PLAYBACK_STATUSES.contains(&state.status.as_str()) {
        return Err(format!("unsupported playback status '{}'", state.status));
    }
    if state.updated_at <= 0 {
        return Err("updated_at must be a positive Unix epoch millisecond value".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_state() -> PlaybackStateWrite {
        PlaybackStateWrite {
            source_identity: "youtube:video:dQw4w9WgXcQ".to_string(),
            source_kind: "youtube-video".to_string(),
            position_ms: 1_000,
            duration_ms: Some(120_000),
            status: "playing".to_string(),
            updated_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn playback_state_validation_accepts_known_shapes() {
        validate_playback_state(&valid_state()).unwrap();
    }

    #[test]
    fn playback_state_validation_rejects_unknown_status() {
        let mut state = valid_state();
        state.status = "buffering-hard".to_string();

        assert!(validate_playback_state(&state).is_err());
    }

    #[test]
    fn youtube_host_uses_supported_minimal_chrome_parameters() {
        let host = youtube_host_html();

        assert!(host.contains("controls: 0"));
        assert!(host.contains("disablekb: 1"));
        assert!(host.contains("fs: 0"));
        assert!(host.contains("iv_load_policy: 3"));
        assert!(host.contains("rel: 0"));
        assert!(host.contains("function videoMetadata"));
        assert!(host.contains("data.title"));
        assert!(host.contains("function applyVolume"));
        assert!(host.contains("player.unMute()"));
        assert!(host.contains("function resetPlayerElement"));
        assert!(host.contains("root.replaceChildren()"));
        assert!(host.contains("function initialPayloadFromParams"));
        assert!(host.contains("params.get(\"sourceKind\")"));
        assert!(host.contains("params.get(\"videoId\")"));
        assert!(host.contains("params.get(\"playlistId\")"));
        assert!(host.contains("const initialLoad = initialPayloadFromParams()"));
        assert!(host.contains("load: loadId"));
        assert!(host.contains("ganbaruai-youtube-playlist-error"));
        assert!(host.contains("activeSource.kind !== \"youtube-playlist\""));
        assert!(host.contains("if (source.kind === \"youtube-video\" || source.videoId)"));
        assert!(!host.contains("videoId: source.kind"));
        assert!(!host.contains("modestbranding"));
        assert!(!host.contains("showinfo"));
        assert!(!host.contains("autohide"));
        assert!(!host.contains("theme"));
    }

    #[test]
    fn media_path_support_accepts_audio_and_video_extensions() {
        assert!(is_supported_media_path(Path::new("/music/focus.flac")));
        assert!(is_supported_media_path(Path::new("/video/reference.mkv")));
        assert!(!is_supported_media_path(Path::new("/notes/readme.txt")));
    }

    #[test]
    fn byte_range_parser_accepts_open_and_suffix_ranges() {
        assert_eq!(
            parse_byte_range("bytes=10-", 100),
            Some(ByteRange { start: 10, end: 99 })
        );
        assert_eq!(
            parse_byte_range("bytes=10-20", 100),
            Some(ByteRange { start: 10, end: 20 })
        );
        assert_eq!(
            parse_byte_range("bytes=-25", 100),
            Some(ByteRange { start: 75, end: 99 })
        );
    }

    #[test]
    fn byte_range_parser_rejects_unsatisfiable_ranges() {
        assert_eq!(parse_byte_range("bytes=100-200", 100), None);
        assert_eq!(parse_byte_range("bytes=20-10", 100), None);
        assert_eq!(parse_byte_range("items=0-10", 100), None);
    }

    #[test]
    fn media_content_type_maps_common_audio_formats() {
        assert_eq!(
            media_content_type(Path::new("/music/focus.mp3")),
            "audio/mpeg"
        );
        assert_eq!(
            media_content_type(Path::new("/music/focus.flac")),
            "audio/flac"
        );
    }

    #[test]
    fn media_title_omits_file_extension() {
        assert_eq!(
            media_title_from_path(Path::new("/music/focus.flac")),
            "focus"
        );
    }

    #[test]
    fn artwork_rank_prefers_common_cover_names() {
        assert!(
            artwork_rank_for_track(Path::new("/music/cover.jpg"), "")
                < artwork_rank_for_track(Path::new("/music/random.png"), "")
        );
        assert!(
            artwork_rank_for_track(Path::new("/music/folder.png"), "")
                < artwork_rank_for_track(Path::new("/music/front.png"), "")
        );
    }

    #[test]
    fn media_content_type_maps_common_image_formats() {
        assert_eq!(
            media_content_type(Path::new("/music/cover.jpg")),
            "image/jpeg"
        );
        assert_eq!(
            media_content_type(Path::new("/music/folder.webp")),
            "image/webp"
        );
    }

    #[test]
    fn artwork_lookup_uses_parent_album_front_image() {
        let root = unique_temp_dir("ganbaruai-artwork-parent");
        let album_dir = root.join("Anime/Made in Abyss/2017 - Made in Abyss OST");
        let disc_dir = album_dir.join("CD 1");
        fs::create_dir_all(&disc_dir).unwrap();
        let track = disc_dir.join("01 - Made in Abyss.mp3");
        let artwork = album_dir.join("01-MIA-FRONT.jpg");
        fs::write(&track, []).unwrap();
        fs::write(disc_dir.join("booklet-page.jpg"), []).unwrap();
        fs::write(&artwork, []).unwrap();

        let mut cache = HashMap::new();
        assert_eq!(find_track_artwork(&track, &root, &mut cache), Some(artwork));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn artwork_lookup_prefers_matching_sidecar_image() {
        let root = unique_temp_dir("ganbaruai-artwork-sidecar");
        fs::create_dir_all(&root).unwrap();
        let track = root.join("02 - Focus.mp3");
        let sidecar = root.join("02 - Focus.jpg");
        fs::write(&track, []).unwrap();
        fs::write(root.join("01 - Intro.jpg"), []).unwrap();
        fs::write(&sidecar, []).unwrap();

        let mut cache = HashMap::new();
        assert_eq!(find_track_artwork(&track, &root, &mut cache), Some(sidecar));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn apic_frame_parser_extracts_front_cover() {
        let mut frame = Vec::new();
        frame.push(0);
        frame.extend_from_slice(b"image/jpeg\0");
        frame.push(3);
        frame.push(0);
        frame.extend_from_slice(&[0xff, 0xd8, 0xff, 0xdb]);

        let Some((picture_type, artwork)) = parse_apic_frame(&frame) else {
            panic!("expected APIC artwork");
        };

        assert_eq!(picture_type, 3);
        assert_eq!(artwork.content_type, "image/jpeg");
        assert_eq!(artwork.bytes, vec![0xff, 0xd8, 0xff, 0xdb]);
    }

    #[test]
    fn id3_unsynchronization_removes_inserted_zero_bytes() {
        assert_eq!(
            remove_id3_unsynchronization(&[0xff, 0x00, 0xe0, 0x11]),
            vec![0xff, 0xe0, 0x11]
        );
    }

    #[test]
    fn flac_picture_block_parser_extracts_front_cover() {
        let mut block = Vec::new();
        push_be_u32(&mut block, 3);
        push_be_u32(&mut block, 10);
        block.extend_from_slice(b"image/jpeg");
        push_be_u32(&mut block, 0);
        push_be_u32(&mut block, 1);
        push_be_u32(&mut block, 1);
        push_be_u32(&mut block, 24);
        push_be_u32(&mut block, 0);
        push_be_u32(&mut block, 4);
        block.extend_from_slice(&[0xff, 0xd8, 0xff, 0xdb]);

        let Some((picture_type, artwork)) = parse_flac_picture_block(&block) else {
            panic!("expected FLAC artwork");
        };

        assert_eq!(picture_type, 3);
        assert_eq!(artwork.content_type, "image/jpeg");
        assert_eq!(artwork.bytes, vec![0xff, 0xd8, 0xff, 0xdb]);
    }

    #[test]
    fn mp4_cover_atom_parser_extracts_cover_art() {
        let root = unique_temp_dir("ganbaruai-artwork-mp4");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("theme.m4a");
        let mut data_content = Vec::new();
        push_be_u32(&mut data_content, 13);
        push_be_u32(&mut data_content, 0);
        data_content.extend_from_slice(&[0xff, 0xd8, 0xff, 0xdb]);
        let data = mp4_atom(*b"data", &data_content);
        let covr = mp4_atom(*b"covr", &data);
        let ilst = mp4_atom(*b"ilst", &covr);
        let mut meta_content = vec![0, 0, 0, 0];
        meta_content.extend_from_slice(&ilst);
        let meta = mp4_atom(*b"meta", &meta_content);
        let udta = mp4_atom(*b"udta", &meta);
        let moov = mp4_atom(*b"moov", &udta);
        let ftyp = mp4_atom(*b"ftyp", b"M4A \0\0\0\0M4A ");
        let mut file = ftyp;
        file.extend_from_slice(&moov);
        fs::write(&path, file).unwrap();

        let artwork = extract_embedded_artwork(&path).unwrap().unwrap();

        assert_eq!(artwork.content_type, "image/jpeg");
        assert_eq!(artwork.bytes, vec![0xff, 0xd8, 0xff, 0xdb]);
        fs::remove_dir_all(root).unwrap();
    }

    fn push_be_u32(bytes: &mut Vec<u8>, value: u32) {
        bytes.extend_from_slice(&value.to_be_bytes());
    }

    fn mp4_atom(name: [u8; 4], content: &[u8]) -> Vec<u8> {
        let size = u32::try_from(content.len() + 8).unwrap();
        let mut atom = size.to_be_bytes().to_vec();
        atom.extend_from_slice(&name);
        atom.extend_from_slice(content);
        atom
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("{name}-{nanos}"))
    }
}
