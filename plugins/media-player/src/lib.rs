use std::{
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    thread::{self, JoinHandle},
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
            message: "Native local playback is not enabled in this build. Add the approved audio backend dependencies before using native local playback.".to_string(),
        }
    }

    fn backend_thread() -> Self {
        Self {
            code: "backendThread".to_string(),
            message: "The native media player backend is temporarily unavailable.".to_string(),
        }
    }
}

#[derive(Debug, Default)]
struct PlayerCore {
    loaded: bool,
    snapshot: PlayerSnapshot,
    surface_rect: Option<SurfaceRect>,
}

impl PlayerCore {
    fn handle(&mut self, command: BackendCommand) -> Result<PlayerSnapshot, MediaPlayerError> {
        match command {
            BackendCommand::Load { request, probe } => self.load(request, probe),
            BackendCommand::Play => self.play(),
            BackendCommand::Pause => Ok(self.pause()),
            BackendCommand::Stop => Ok(self.stop()),
            BackendCommand::Seek(position_ms) => Ok(self.seek(position_ms)),
            BackendCommand::SetVolume(volume) => Ok(self.set_volume(volume)),
            BackendCommand::SetRate(rate) => Ok(self.set_rate(rate)),
            BackendCommand::SetSurfaceRect(rect) => Ok(self.set_surface_rect(rect)),
            BackendCommand::ClearSurface => Ok(self.clear_surface()),
            BackendCommand::Snapshot => Ok(self.snapshot.clone()),
        }
    }

    fn load(
        &mut self,
        request: LoadRequest,
        probe: MediaProbe,
    ) -> Result<PlayerSnapshot, MediaPlayerError> {
        let volume = request
            .volume
            .map(clamp_volume)
            .unwrap_or(self.snapshot.volume);
        let rate = request.rate.map(clamp_rate).unwrap_or(self.snapshot.rate);
        let title = request
            .source
            .title
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| probe.title.clone());
        self.loaded = true;
        self.snapshot = PlayerSnapshot {
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
        Ok(self.snapshot.clone())
    }

    fn play(&mut self) -> Result<PlayerSnapshot, MediaPlayerError> {
        if !self.loaded {
            self.snapshot.status = PlayerStatus::Error;
            self.snapshot.error = Some("Load a local media file before playing.".to_string());
            return Err(MediaPlayerError::invalid_source(
                "Load a local media file before playing.",
            ));
        }
        let err = MediaPlayerError::backend_unavailable();
        self.snapshot.status = PlayerStatus::Error;
        self.snapshot.error = Some(err.message.clone());
        Err(err)
    }

    fn pause(&mut self) -> PlayerSnapshot {
        if self.loaded {
            self.snapshot.status = PlayerStatus::Paused;
            self.snapshot.error = None;
        }
        self.snapshot.clone()
    }

    fn stop(&mut self) -> PlayerSnapshot {
        let volume = self.snapshot.volume;
        let rate = self.snapshot.rate;
        self.loaded = false;
        self.snapshot = PlayerSnapshot {
            volume,
            rate,
            ..PlayerSnapshot::default()
        };
        self.snapshot.clone()
    }

    fn seek(&mut self, position_ms: u64) -> PlayerSnapshot {
        self.snapshot.position_ms = position_ms;
        self.snapshot.clone()
    }

    fn set_volume(&mut self, volume: f64) -> PlayerSnapshot {
        self.snapshot.volume = clamp_volume(volume);
        self.snapshot.clone()
    }

    fn set_rate(&mut self, rate: f64) -> PlayerSnapshot {
        self.snapshot.rate = clamp_rate(rate);
        self.snapshot.clone()
    }

    fn set_surface_rect(&mut self, rect: SurfaceRect) -> PlayerSnapshot {
        self.surface_rect = Some(rect);
        self.snapshot.clone()
    }

    fn clear_surface(&mut self) -> PlayerSnapshot {
        self.surface_rect = None;
        self.snapshot.clone()
    }
}

#[derive(Debug)]
enum BackendCommand {
    Load {
        request: LoadRequest,
        probe: MediaProbe,
    },
    Play,
    Pause,
    Stop,
    Seek(u64),
    SetVolume(f64),
    SetRate(f64),
    SetSurfaceRect(SurfaceRect),
    ClearSurface,
    Snapshot,
}

enum BackendMessage {
    Command(
        Box<BackendCommand>,
        mpsc::Sender<Result<PlayerSnapshot, MediaPlayerError>>,
    ),
    Shutdown,
}

struct PlaybackController {
    sender: mpsc::Sender<BackendMessage>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl std::fmt::Debug for PlaybackController {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlaybackController").finish_non_exhaustive()
    }
}

impl PlaybackController {
    fn new() -> Self {
        let (sender, receiver) = mpsc::channel::<BackendMessage>();
        let worker = thread::Builder::new()
            .name("ganbaruai-media-player".to_string())
            .spawn(move || playback_worker(receiver))
            .expect("failed to start media player worker thread");
        Self {
            sender,
            worker: Mutex::new(Some(worker)),
        }
    }

    fn dispatch(&self, command: BackendCommand) -> Result<PlayerSnapshot, MediaPlayerError> {
        let (reply_sender, reply_receiver) = mpsc::channel();
        self.sender
            .send(BackendMessage::Command(Box::new(command), reply_sender))
            .map_err(|_| MediaPlayerError::backend_thread())?;
        reply_receiver
            .recv()
            .map_err(|_| MediaPlayerError::backend_thread())?
    }
}

impl Default for PlaybackController {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for PlaybackController {
    fn drop(&mut self) {
        let _ = self.sender.send(BackendMessage::Shutdown);
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}

fn playback_worker(receiver: mpsc::Receiver<BackendMessage>) {
    let mut core = PlayerCore::default();
    while let Ok(message) = receiver.recv() {
        match message {
            BackendMessage::Command(command, reply) => {
                let result = core.handle(*command);
                let _ = reply.send(result);
            }
            BackendMessage::Shutdown => break,
        }
    }
}

#[derive(Debug, Default)]
struct MediaPlayerState {
    controller: PlaybackController,
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
    state
        .controller
        .dispatch(BackendCommand::Load { request, probe })
}

#[tauri::command]
fn play(state: State<'_, MediaPlayerState>) -> Result<PlayerSnapshot, MediaPlayerError> {
    state.controller.dispatch(BackendCommand::Play)
}

#[tauri::command]
fn pause(state: State<'_, MediaPlayerState>) -> Result<PlayerSnapshot, MediaPlayerError> {
    state.controller.dispatch(BackendCommand::Pause)
}

#[tauri::command]
fn stop(state: State<'_, MediaPlayerState>) -> Result<PlayerSnapshot, MediaPlayerError> {
    state.controller.dispatch(BackendCommand::Stop)
}

#[tauri::command]
fn seek(
    state: State<'_, MediaPlayerState>,
    position_ms: u64,
) -> Result<PlayerSnapshot, MediaPlayerError> {
    state.controller.dispatch(BackendCommand::Seek(position_ms))
}

#[tauri::command]
fn set_volume(
    state: State<'_, MediaPlayerState>,
    volume: f64,
) -> Result<PlayerSnapshot, MediaPlayerError> {
    state.controller.dispatch(BackendCommand::SetVolume(volume))
}

#[tauri::command]
fn set_rate(
    state: State<'_, MediaPlayerState>,
    rate: f64,
) -> Result<PlayerSnapshot, MediaPlayerError> {
    state.controller.dispatch(BackendCommand::SetRate(rate))
}

#[tauri::command]
fn set_surface_rect(
    state: State<'_, MediaPlayerState>,
    rect: SurfaceRect,
) -> Result<PlayerSnapshot, MediaPlayerError> {
    state
        .controller
        .dispatch(BackendCommand::SetSurfaceRect(rect))
}

#[tauri::command]
fn clear_surface(state: State<'_, MediaPlayerState>) -> Result<PlayerSnapshot, MediaPlayerError> {
    state.controller.dispatch(BackendCommand::ClearSurface)
}

#[tauri::command]
fn snapshot(state: State<'_, MediaPlayerState>) -> Result<PlayerSnapshot, MediaPlayerError> {
    state.controller.dispatch(BackendCommand::Snapshot)
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
            snapshot,
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
    path.file_stem()
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
        value.clamp(0.0, 1.5)
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
        assert_eq!(clamp_volume(1.25), 1.25);
        assert_eq!(clamp_volume(2.0), 1.5);
        assert_eq!(clamp_rate(0.1), 0.25);
        assert_eq!(clamp_rate(4.0), 2.0);
    }

    #[test]
    fn local_file_validation_rejects_relative_paths() {
        let err = validate_local_file_path(Path::new("song.mp3")).unwrap_err();
        assert_eq!(err.code, "invalidSource");
    }

    #[test]
    fn media_title_omits_file_extension() {
        assert_eq!(
            media_title_from_path(Path::new("/music/01 - Made in Abyss.mp3")),
            "01 - Made in Abyss"
        );
    }

    #[test]
    fn player_core_loads_and_updates_snapshot() {
        let mut core = PlayerCore::default();
        let snapshot = core
            .handle(BackendCommand::Load {
                request: local_load_request(Some(1_500)),
                probe: audio_probe(),
            })
            .unwrap();

        assert_eq!(snapshot.status, PlayerStatus::Ready);
        assert_eq!(snapshot.position_ms, 1_500);
        assert_eq!(snapshot.volume, 1.25);
        assert_eq!(snapshot.rate, 1.5);
        assert_eq!(snapshot.title.as_deref(), Some("Song title"));
        assert!(!snapshot.has_video);
    }

    #[test]
    fn player_core_pause_is_state_only_and_clears_errors() {
        let mut core = loaded_core();
        let play_error = core.handle(BackendCommand::Play).unwrap_err();
        assert_eq!(play_error.code, "backendUnavailable");

        let snapshot = core.handle(BackendCommand::Pause).unwrap();
        assert_eq!(snapshot.status, PlayerStatus::Paused);
        assert_eq!(snapshot.error, None);
    }

    #[test]
    fn player_core_stop_releases_source_state_and_keeps_settings() {
        let mut core = loaded_core();
        let snapshot = core.handle(BackendCommand::Stop).unwrap();

        assert_eq!(snapshot.status, PlayerStatus::Idle);
        assert_eq!(snapshot.source_identity, None);
        assert_eq!(snapshot.position_ms, 0);
        assert_eq!(snapshot.volume, 1.25);
        assert_eq!(snapshot.rate, 1.5);
    }

    #[test]
    fn playback_controller_dispatches_on_worker_thread() {
        let controller = PlaybackController::new();
        let loaded = controller
            .dispatch(BackendCommand::Load {
                request: local_load_request(None),
                probe: audio_probe(),
            })
            .unwrap();
        assert_eq!(loaded.status, PlayerStatus::Ready);

        let seeked = controller.dispatch(BackendCommand::Seek(42_000)).unwrap();
        assert_eq!(seeked.position_ms, 42_000);

        let snapshot = controller.dispatch(BackendCommand::Snapshot).unwrap();
        assert_eq!(snapshot.position_ms, 42_000);
    }

    fn loaded_core() -> PlayerCore {
        let mut core = PlayerCore::default();
        core.handle(BackendCommand::Load {
            request: local_load_request(None),
            probe: audio_probe(),
        })
        .unwrap();
        core
    }

    fn local_load_request(start_ms: Option<u64>) -> LoadRequest {
        LoadRequest {
            source: LocalMediaSource {
                kind: "local-file".to_string(),
                path: "/music/song.mp3".to_string(),
                identity: "local:/music/song.mp3".to_string(),
                title: Some("Song title".to_string()),
            },
            start_ms,
            volume: Some(1.25),
            rate: Some(1.5),
        }
    }

    fn audio_probe() -> MediaProbe {
        MediaProbe {
            path: "/music/song.mp3".to_string(),
            title: "song".to_string(),
            file_size_bytes: 1024,
            extension: Some("mp3".to_string()),
            media_kind: MediaKind::Audio,
        }
    }
}
