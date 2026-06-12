use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
    process::Stdio,
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::db_path::connect_sqlite;

mod artwork;
pub(crate) mod host;
mod youtube_host;

pub(crate) use host::setup_youtube_host;

use artwork::find_track_artwork;

const VALID_SOURCE_KINDS: &[&str] = &["local-file", "youtube-video", "youtube-playlist"];
const VALID_PLAYBACK_STATUSES: &[&str] = &[
    "idle", "loading", "ready", "playing", "paused", "ended", "error",
];
const MAX_MEDIA_FOLDER_FILES: usize = 5_000;
const MEDIA_EXTENSIONS: &[&str] = &[
    "aac", "aif", "aiff", "alac", "ape", "avi", "flac", "flv", "m4a", "m4v", "mkv", "mov", "mp3",
    "mp4", "mpeg", "mpg", "ogg", "ogv", "opus", "wav", "webm", "wma", "wmv",
];

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
        let mut picker = app.dialog().file().set_title("Select music folder");
        if let Some(directory) = music_folder_start_directory(&app) {
            picker = picker.set_directory(directory);
        }

        let Some(folder) = picker.blocking_pick_folder().map(dialog_path).transpose()? else {
            return Ok(None);
        };

        scan_media_folder(&folder).map(Some)
    })
    .await
    .map_err(|e| format!("media folder picker failed: {e}"))?
}

fn music_folder_start_directory(app: &tauri::AppHandle) -> Option<PathBuf> {
    existing_music_start_directory(app.path().audio_dir().ok())
}

fn existing_music_start_directory(candidate: Option<PathBuf>) -> Option<PathBuf> {
    candidate.filter(|path| path.is_dir())
}

#[tauri::command]
pub fn music_reveal_local_file(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    require_absolute_file(&path)?;
    reveal_local_file(&path)
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

#[cfg(target_os = "linux")]
fn reveal_local_file(path: &Path) -> Result<(), String> {
    let folder = path
        .parent()
        .ok_or_else(|| "media file has no containing folder".to_string())?;
    spawn_file_manager_command("xdg-open", [folder.as_os_str()])
}

#[cfg(target_os = "macos")]
fn reveal_local_file(path: &Path) -> Result<(), String> {
    spawn_file_manager_command("open", [std::ffi::OsStr::new("-R"), path.as_os_str()])
}

#[cfg(windows)]
fn reveal_local_file(path: &Path) -> Result<(), String> {
    let selection = format!("/select,{}", path.display());
    spawn_file_manager_command("explorer.exe", [std::ffi::OsStr::new(&selection)])
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn reveal_local_file(_path: &Path) -> Result<(), String> {
    Err("opening media file locations is not implemented for this platform".to_string())
}

fn spawn_file_manager_command<I, S>(program: &str, args: I) -> Result<(), String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    std::process::Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open media file location: {e}"))
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

fn media_title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled media")
        .to_string()
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
    use super::artwork::{
        artwork_rank_for_track, extract_embedded_artwork, find_track_artwork, parse_apic_frame,
        parse_flac_picture_block, remove_id3_unsynchronization,
    };
    use super::host::{media_content_type, parse_byte_range, ByteRange};
    use super::youtube_host::youtube_host_html;
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

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
        assert!(host.contains("ganbaru-ai-youtube-playlist-error"));
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
    fn music_folder_start_directory_uses_only_existing_directories() {
        let root = unique_temp_dir("ganbaru-ai-music-start-dir");
        let music_dir = root.join("localized-audio");
        let file_path = root.join("not-a-directory");
        fs::create_dir_all(&music_dir).unwrap();
        fs::write(&file_path, []).unwrap();

        assert_eq!(
            existing_music_start_directory(Some(music_dir.clone())),
            Some(music_dir)
        );
        assert_eq!(existing_music_start_directory(Some(file_path)), None);
        assert_eq!(existing_music_start_directory(None), None);

        fs::remove_dir_all(root).unwrap();
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
        let root = unique_temp_dir("ganbaru-ai-artwork-parent");
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
        let root = unique_temp_dir("ganbaru-ai-artwork-sidecar");
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
        let root = unique_temp_dir("ganbaru-ai-artwork-mp4");
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
