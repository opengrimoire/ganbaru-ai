use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, Runtime, State,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MediaKind {
    Audio,
    Video,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PlayerStatus {
    Idle,
    Ready,
    Playing,
    Paused,
    Ended,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalMediaSource {
    pub kind: String,
    pub path: String,
    pub identity: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadRequest {
    pub source: LocalMediaSource,
    pub start_ms: Option<u64>,
    pub volume: Option<f64>,
    pub rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub path: String,
    pub title: String,
    pub file_size_bytes: u64,
    pub extension: Option<String>,
    pub media_kind: MediaKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub status: PlayerStatus,
    pub source_identity: Option<String>,
    pub title: Option<String>,
    pub position_ms: u64,
    pub duration_ms: Option<u64>,
    pub volume: f64,
    pub rate: f64,
    pub has_video: bool,
    pub error: Option<String>,
}

impl Default for PlayerSnapshot {
    fn default() -> Self {
        Self {
            status: PlayerStatus::Idle,
            source_identity: None,
            title: None,
            position_ms: 0,
            duration_ms: None,
            volume: 0.8,
            rate: 1.0,
            has_video: false,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MediaPlayerError {
    pub code: String,
    pub message: String,
}

impl MediaPlayerError {
    fn invalid_source(message: impl Into<String>) -> Self {
        Self {
            code: "invalidSource".to_string(),
            message: message.into(),
        }
    }

    fn backend_unavailable() -> Self {
        Self {
            code: "backendUnavailable".to_string(),
            message: "Native local playback is not enabled in this build. Install GStreamer development libraries and enable the media backend before using local audio or video playback.".to_string(),
        }
    }

    fn state_lock() -> Self {
        Self {
            code: "stateLock".to_string(),
            message: "Media player state is temporarily unavailable.".to_string(),
        }
    }
}

#[derive(Debug, Default)]
struct PlayerInner {
    loaded: bool,
    snapshot: PlayerSnapshot,
    surface_rect: Option<SurfaceRect>,
}

#[derive(Debug, Default)]
struct MediaPlayerState {
    inner: Mutex<PlayerInner>,
}

#[tauri::command]
fn probe(path: String) -> Result<MediaProbe, MediaPlayerError> {
    probe_local_file(&path)
}

#[tauri::command]
fn load(
    state: State<'_, MediaPlayerState>,
    request: LoadRequest,
) -> Result<PlayerSnapshot, MediaPlayerError> {
    validate_load_request(&request)?;
    let probe = probe_local_file(&request.source.path)?;
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| MediaPlayerError::state_lock())?;
    let volume = request
        .volume
        .map(clamp_volume)
        .unwrap_or(inner.snapshot.volume);
    let rate = request.rate.map(clamp_rate).unwrap_or(inner.snapshot.rate);
    let title = request
        .source
        .title
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| probe.title.clone());
    inner.loaded = true;
    inner.snapshot = PlayerSnapshot {
        status: PlayerStatus::Ready,
        source_identity: Some(request.source.identity),
        title: Some(title),
        position_ms: request.start_ms.unwrap_or(0),
        duration_ms: None,
        volume,
        rate,
        has_video: probe.media_kind == MediaKind::Video,
        error: None,
    };
    Ok(inner.snapshot.clone())
}

#[tauri::command]
fn play(state: State<'_, MediaPlayerState>) -> Result<PlayerSnapshot, MediaPlayerError> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| MediaPlayerError::state_lock())?;
    if !inner.loaded {
        inner.snapshot.status = PlayerStatus::Error;
        inner.snapshot.error = Some("Load a local media file before playing.".to_string());
        return Err(MediaPlayerError::invalid_source(
            "Load a local media file before playing.",
        ));
    }
    inner.snapshot.status = PlayerStatus::Error;
    inner.snapshot.error = Some(MediaPlayerError::backend_unavailable().message);
    Err(MediaPlayerError::backend_unavailable())
}

#[tauri::command]
fn pause(state: State<'_, MediaPlayerState>) -> Result<PlayerSnapshot, MediaPlayerError> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| MediaPlayerError::state_lock())?;
    if inner.loaded {
        inner.snapshot.status = PlayerStatus::Paused;
    }
    Ok(inner.snapshot.clone())
}

#[tauri::command]
fn stop(state: State<'_, MediaPlayerState>) -> Result<PlayerSnapshot, MediaPlayerError> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| MediaPlayerError::state_lock())?;
    inner.snapshot.status = PlayerStatus::Idle;
    inner.snapshot.position_ms = 0;
    inner.loaded = false;
    Ok(inner.snapshot.clone())
}

#[tauri::command]
fn seek(
    state: State<'_, MediaPlayerState>,
    position_ms: u64,
) -> Result<PlayerSnapshot, MediaPlayerError> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| MediaPlayerError::state_lock())?;
    inner.snapshot.position_ms = position_ms;
    Ok(inner.snapshot.clone())
}

#[tauri::command]
fn set_volume(
    state: State<'_, MediaPlayerState>,
    volume: f64,
) -> Result<PlayerSnapshot, MediaPlayerError> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| MediaPlayerError::state_lock())?;
    inner.snapshot.volume = clamp_volume(volume);
    Ok(inner.snapshot.clone())
}

#[tauri::command]
fn set_rate(
    state: State<'_, MediaPlayerState>,
    rate: f64,
) -> Result<PlayerSnapshot, MediaPlayerError> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| MediaPlayerError::state_lock())?;
    inner.snapshot.rate = clamp_rate(rate);
    Ok(inner.snapshot.clone())
}

#[tauri::command]
fn set_surface_rect(
    state: State<'_, MediaPlayerState>,
    rect: SurfaceRect,
) -> Result<PlayerSnapshot, MediaPlayerError> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| MediaPlayerError::state_lock())?;
    inner.surface_rect = Some(rect);
    Ok(inner.snapshot.clone())
}

#[tauri::command]
fn clear_surface(state: State<'_, MediaPlayerState>) -> Result<PlayerSnapshot, MediaPlayerError> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| MediaPlayerError::state_lock())?;
    let _had_surface = inner.surface_rect.is_some();
    inner.surface_rect = None;
    Ok(inner.snapshot.clone())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("media-player")
        .invoke_handler(tauri::generate_handler![
            probe,
            load,
            play,
            pause,
            stop,
            seek,
            set_volume,
            set_rate,
            set_surface_rect,
            clear_surface,
        ])
        .setup(|app, _api| {
            app.manage(MediaPlayerState::default());
            Ok(())
        })
        .build()
}

fn validate_load_request(request: &LoadRequest) -> Result<(), MediaPlayerError> {
    if request.source.kind != "local-file" {
        return Err(MediaPlayerError::invalid_source(
            "The native media plugin only accepts local-file sources.",
        ));
    }
    if request.source.identity.trim().is_empty() {
        return Err(MediaPlayerError::invalid_source(
            "Local media sources require a stable identity.",
        ));
    }
    Ok(())
}

fn probe_local_file(path: &str) -> Result<MediaProbe, MediaPlayerError> {
    let path = PathBuf::from(path);
    validate_local_file_path(&path)?;
    let metadata = std::fs::metadata(&path).map_err(|e| {
        MediaPlayerError::invalid_source(format!("Failed to inspect local media file: {e}"))
    })?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    Ok(MediaProbe {
        path: path.to_string_lossy().to_string(),
        title: media_title_from_path(&path),
        file_size_bytes: metadata.len(),
        media_kind: extension
            .as_deref()
            .map(media_kind_from_extension)
            .unwrap_or(MediaKind::Unknown),
        extension,
    })
}

fn validate_local_file_path(path: &Path) -> Result<(), MediaPlayerError> {
    if !path.is_absolute() {
        return Err(MediaPlayerError::invalid_source(
            "Local media paths must be absolute.",
        ));
    }
    let metadata = std::fs::metadata(path).map_err(|e| {
        MediaPlayerError::invalid_source(format!("Local media file is not readable: {e}"))
    })?;
    if !metadata.is_file() {
        return Err(MediaPlayerError::invalid_source(
            "Local media path must point to a file.",
        ));
    }
    Ok(())
}

fn media_title_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled media")
        .to_string()
}

fn media_kind_from_extension(extension: &str) -> MediaKind {
    match extension {
        "aac" | "aif" | "aiff" | "alac" | "ape" | "flac" | "m4a" | "mp3" | "ogg" | "opus"
        | "wav" | "wma" => MediaKind::Audio,
        "avi" | "flv" | "m4v" | "mkv" | "mov" | "mp4" | "mpeg" | "mpg" | "ogv" | "webm" | "wmv" => {
            MediaKind::Video
        }
        _ => MediaKind::Unknown,
    }
}

fn clamp_volume(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        PlayerSnapshot::default().volume
    }
}

fn clamp_rate(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.25, 2.0)
    } else {
        PlayerSnapshot::default().rate
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_kind_uses_extension_groups() {
        assert_eq!(media_kind_from_extension("flac"), MediaKind::Audio);
        assert_eq!(media_kind_from_extension("mkv"), MediaKind::Video);
        assert_eq!(media_kind_from_extension("txt"), MediaKind::Unknown);
    }

    #[test]
    fn clamp_helpers_bound_user_values() {
        assert_eq!(clamp_volume(-1.0), 0.0);
        assert_eq!(clamp_volume(2.0), 1.0);
        assert_eq!(clamp_rate(0.1), 0.25);
        assert_eq!(clamp_rate(4.0), 2.0);
    }

    #[test]
    fn local_file_validation_rejects_relative_paths() {
        let err = validate_local_file_path(Path::new("song.mp3")).unwrap_err();
        assert_eq!(err.code, "invalidSource");
    }
}
