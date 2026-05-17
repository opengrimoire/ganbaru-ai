use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
    thread::{self, JoinHandle},
    time::Duration,
};

use rodio::{cpal::BufferSize, Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, Source};
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
    pub muted: bool,
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
            muted: false,
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
            message: "Native audio playback is only available for supported local audio files."
                .to_string(),
        }
    }

    fn audio_device(message: impl Into<String>) -> Self {
        Self {
            code: "audioDevice".to_string(),
            message: message.into(),
        }
    }

    fn decode_failed(message: impl Into<String>) -> Self {
        Self {
            code: "decodeFailed".to_string(),
            message: message.into(),
        }
    }

    fn seek_failed(message: impl Into<String>) -> Self {
        Self {
            code: "seekFailed".to_string(),
            message: message.into(),
        }
    }

    fn backend_thread() -> Self {
        Self {
            code: "backendThread".to_string(),
            message: "The native media player backend is temporarily unavailable.".to_string(),
        }
    }
}

trait LocalAudioBackend: Send {
    fn play(&mut self);
    fn pause(&mut self);
    fn stop(&mut self);
    fn seek(&mut self, position_ms: u64) -> Result<(), MediaPlayerError>;
    fn set_volume(&mut self, volume: f64, muted: bool);
    fn set_rate(&mut self, rate: f64);
    fn position_ms(&self) -> u64;
    fn duration_ms(&self) -> Option<u64>;
    fn is_empty(&self) -> bool;
}

trait LocalAudioFactory: Send {
    fn load(
        &mut self,
        request: &LoadRequest,
        volume: f64,
        muted: bool,
        rate: f64,
    ) -> Result<Box<dyn LocalAudioBackend>, MediaPlayerError>;
}

struct RodioAudioFactory;

impl LocalAudioFactory for RodioAudioFactory {
    fn load(
        &mut self,
        request: &LoadRequest,
        volume: f64,
        muted: bool,
        rate: f64,
    ) -> Result<Box<dyn LocalAudioBackend>, MediaPlayerError> {
        let file = File::open(&request.source.path).map_err(|e| {
            MediaPlayerError::invalid_source(format!("Failed to open local audio file: {e}"))
        })?;
        let decoder = Decoder::try_from(file).map_err(|e| {
            MediaPlayerError::decode_failed(format!("Failed to decode local audio file: {e}"))
        })?;
        let duration_ms = duration_to_ms(decoder.total_duration());
        let mut sink = open_low_latency_sink()?;
        sink.log_on_drop(false);
        let player = Player::connect_new(sink.mixer());
        player.pause();
        player.set_volume(effective_native_volume(volume, muted));
        player.set_speed(clamp_rate(rate) as f32);
        player.append(decoder);
        if let Some(start_ms) = request.start_ms.filter(|value| *value > 0) {
            player
                .try_seek(Duration::from_millis(start_ms))
                .map_err(|e| {
                    MediaPlayerError::seek_failed(format!("Failed to seek local audio file: {e}"))
                })?;
        }
        Ok(Box::new(RodioAudioBackend {
            _sink: sink,
            player,
            duration_ms,
        }))
    }
}

struct RodioAudioBackend {
    _sink: MixerDeviceSink,
    player: Player,
    duration_ms: Option<u64>,
}

impl LocalAudioBackend for RodioAudioBackend {
    fn play(&mut self) {
        self.player.play();
    }

    fn pause(&mut self) {
        self.player.set_volume(0.0);
        self.player.pause();
    }

    fn stop(&mut self) {
        self.player.set_volume(0.0);
        self.player.stop();
    }

    fn seek(&mut self, position_ms: u64) -> Result<(), MediaPlayerError> {
        self.player
            .try_seek(Duration::from_millis(position_ms))
            .map_err(|e| MediaPlayerError::seek_failed(format!("Failed to seek local audio: {e}")))
    }

    fn set_volume(&mut self, volume: f64, muted: bool) {
        self.player
            .set_volume(effective_native_volume(volume, muted));
    }

    fn set_rate(&mut self, rate: f64) {
        self.player.set_speed(clamp_rate(rate) as f32);
    }

    fn position_ms(&self) -> u64 {
        duration_to_ms(Some(self.player.get_pos())).unwrap_or(0)
    }

    fn duration_ms(&self) -> Option<u64> {
        self.duration_ms
    }

    fn is_empty(&self) -> bool {
        self.player.empty()
    }
}

struct PlayerCore {
    audio_factory: Box<dyn LocalAudioFactory>,
    audio: Option<Box<dyn LocalAudioBackend>>,
    loaded: bool,
    snapshot: PlayerSnapshot,
    surface_rect: Option<SurfaceRect>,
}

impl Default for PlayerCore {
    fn default() -> Self {
        Self::with_audio_factory(Box::new(RodioAudioFactory))
    }
}

impl PlayerCore {
    fn with_audio_factory(audio_factory: Box<dyn LocalAudioFactory>) -> Self {
        Self {
            audio_factory,
            audio: None,
            loaded: false,
            snapshot: PlayerSnapshot::default(),
            surface_rect: None,
        }
    }

    fn handle(&mut self, command: BackendCommand) -> Result<PlayerSnapshot, MediaPlayerError> {
        match command {
            BackendCommand::Load { request, probe } => self.load(request, probe),
            BackendCommand::Play => self.play(),
            BackendCommand::Pause => Ok(self.pause()),
            BackendCommand::Stop => Ok(self.stop()),
            BackendCommand::Seek(position_ms) => self.seek(position_ms),
            BackendCommand::SetVolume(volume) => Ok(self.set_volume(volume)),
            BackendCommand::SetMuted(muted) => Ok(self.set_muted(muted)),
            BackendCommand::SetRate(rate) => Ok(self.set_rate(rate)),
            BackendCommand::SetSurfaceRect(rect) => Ok(self.set_surface_rect(rect)),
            BackendCommand::ClearSurface => Ok(self.clear_surface()),
            BackendCommand::Snapshot => Ok(self.current_snapshot()),
        }
    }

    fn load(
        &mut self,
        request: LoadRequest,
        probe: MediaProbe,
    ) -> Result<PlayerSnapshot, MediaPlayerError> {
        self.stop_audio();
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
        let has_video = probe.media_kind == MediaKind::Video;
        let audio = if has_video {
            None
        } else {
            Some(
                self.audio_factory
                    .load(&request, volume, self.snapshot.muted, rate)?,
            )
        };
        let duration_ms = audio.as_ref().and_then(|backend| backend.duration_ms());
        self.loaded = true;
        self.audio = audio;
        self.snapshot = PlayerSnapshot {
            status: PlayerStatus::Ready,
            source_identity: Some(request.source.identity),
            title: Some(title),
            position_ms: request.start_ms.unwrap_or(0),
            duration_ms,
            volume,
            muted: self.snapshot.muted,
            rate,
            has_video,
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
        if self.snapshot.status == PlayerStatus::Ended {
            self.seek(0)?;
        }
        if self.audio.is_none() {
            let err = MediaPlayerError::backend_unavailable();
            self.snapshot.status = PlayerStatus::Error;
            self.snapshot.error = Some(err.message.clone());
            return Err(err);
        }
        let audio = self.audio.as_mut().expect("checked audio backend above");
        audio.set_volume(self.snapshot.volume, self.snapshot.muted);
        audio.play();
        self.snapshot.status = PlayerStatus::Playing;
        self.snapshot.error = None;
        Ok(self.current_snapshot())
    }

    fn pause(&mut self) -> PlayerSnapshot {
        if self.loaded {
            if let Some(audio) = self.audio.as_mut() {
                audio.pause();
            }
            self.snapshot.status = PlayerStatus::Paused;
            self.snapshot.error = None;
        }
        self.current_snapshot()
    }

    fn stop(&mut self) -> PlayerSnapshot {
        let volume = self.snapshot.volume;
        let rate = self.snapshot.rate;
        let muted = self.snapshot.muted;
        self.stop_audio();
        self.loaded = false;
        self.snapshot = PlayerSnapshot {
            volume,
            muted,
            rate,
            ..PlayerSnapshot::default()
        };
        self.snapshot.clone()
    }

    fn seek(&mut self, position_ms: u64) -> Result<PlayerSnapshot, MediaPlayerError> {
        if let Some(audio) = self.audio.as_mut() {
            audio.seek(position_ms)?;
        }
        self.snapshot.position_ms = position_ms;
        Ok(self.current_snapshot())
    }

    fn set_volume(&mut self, volume: f64) -> PlayerSnapshot {
        self.snapshot.volume = clamp_volume(volume);
        if let Some(audio) = self.audio.as_mut() {
            audio.set_volume(self.snapshot.volume, self.snapshot.muted);
        }
        self.current_snapshot()
    }

    fn set_muted(&mut self, muted: bool) -> PlayerSnapshot {
        self.snapshot.muted = muted;
        if let Some(audio) = self.audio.as_mut() {
            audio.set_volume(self.snapshot.volume, self.snapshot.muted);
        }
        self.current_snapshot()
    }

    fn set_rate(&mut self, rate: f64) -> PlayerSnapshot {
        self.snapshot.rate = clamp_rate(rate);
        if let Some(audio) = self.audio.as_mut() {
            audio.set_rate(self.snapshot.rate);
        }
        self.current_snapshot()
    }

    fn set_surface_rect(&mut self, rect: SurfaceRect) -> PlayerSnapshot {
        self.surface_rect = Some(rect);
        self.snapshot.clone()
    }

    fn clear_surface(&mut self) -> PlayerSnapshot {
        self.surface_rect = None;
        self.snapshot.clone()
    }

    fn current_snapshot(&mut self) -> PlayerSnapshot {
        if let Some(audio) = self.audio.as_ref() {
            self.snapshot.position_ms = audio.position_ms();
            self.snapshot.duration_ms = audio.duration_ms();
            if self.snapshot.status == PlayerStatus::Playing && audio.is_empty() {
                self.snapshot.status = PlayerStatus::Ended;
                if let Some(duration_ms) = self.snapshot.duration_ms {
                    self.snapshot.position_ms = duration_ms;
                }
            }
        }
        self.snapshot.clone()
    }

    fn stop_audio(&mut self) {
        if let Some(mut audio) = self.audio.take() {
            audio.stop();
        }
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
    SetMuted(bool),
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
        Self::with_core(PlayerCore::default())
    }

    fn with_core(core: PlayerCore) -> Self {
        let (sender, receiver) = mpsc::channel::<BackendMessage>();
        let worker = thread::Builder::new()
            .name("ganbaruai-media-player".to_string())
            .spawn(move || playback_worker(receiver, core))
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

fn playback_worker(receiver: mpsc::Receiver<BackendMessage>, mut core: PlayerCore) {
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
fn set_muted(
    state: State<'_, MediaPlayerState>,
    muted: bool,
) -> Result<PlayerSnapshot, MediaPlayerError> {
    state.controller.dispatch(BackendCommand::SetMuted(muted))
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
            set_muted,
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

fn open_low_latency_sink() -> Result<MixerDeviceSink, MediaPlayerError> {
    DeviceSinkBuilder::from_default_device()
        .map(|builder| builder.with_buffer_size(BufferSize::Fixed(1024)))
        .and_then(|builder| builder.open_sink_or_fallback())
        .map_err(|e| {
            MediaPlayerError::audio_device(format!("Failed to open local audio output: {e}"))
        })
}

fn effective_native_volume(volume: f64, muted: bool) -> f32 {
    if muted {
        0.0
    } else {
        clamp_volume(volume) as f32
    }
}

fn duration_to_ms(duration: Option<Duration>) -> Option<u64> {
    duration.map(|value| {
        let millis = value.as_millis();
        if millis > u128::from(u64::MAX) {
            u64::MAX
        } else {
            millis as u64
        }
    })
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
    use std::sync::{Arc, Mutex};

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
        let mut core = test_core();
        let snapshot = core
            .handle(BackendCommand::Load {
                request: local_load_request(Some(1_500)),
                probe: audio_probe(),
            })
            .unwrap();

        assert_eq!(snapshot.status, PlayerStatus::Ready);
        assert_eq!(snapshot.position_ms, 1_500);
        assert_eq!(snapshot.volume, 1.25);
        assert!(!snapshot.muted);
        assert_eq!(snapshot.rate, 1.5);
        assert_eq!(snapshot.title.as_deref(), Some("Song title"));
        assert!(!snapshot.has_video);
        assert_eq!(snapshot.duration_ms, Some(120_000));
    }

    #[test]
    fn player_core_pause_is_state_only_and_clears_errors() {
        let mut core = loaded_core();
        let playing = core.handle(BackendCommand::Play).unwrap();
        assert_eq!(playing.status, PlayerStatus::Playing);

        let snapshot = core.handle(BackendCommand::Pause).unwrap();
        assert_eq!(snapshot.status, PlayerStatus::Paused);
        assert_eq!(snapshot.error, None);
    }

    #[test]
    fn player_core_stop_releases_source_state_and_keeps_settings() {
        let mut core = loaded_core();
        core.handle(BackendCommand::SetMuted(true)).unwrap();
        let snapshot = core.handle(BackendCommand::Stop).unwrap();

        assert_eq!(snapshot.status, PlayerStatus::Idle);
        assert_eq!(snapshot.source_identity, None);
        assert_eq!(snapshot.position_ms, 0);
        assert_eq!(snapshot.volume, 1.25);
        assert!(snapshot.muted);
        assert_eq!(snapshot.rate, 1.5);
    }

    #[test]
    fn player_core_reloading_stops_previous_audio_backend() {
        let loaded_backends = Arc::new(Mutex::new(Vec::new()));
        let mut core = PlayerCore::with_audio_factory(Box::new(RecordingAudioFactory {
            loaded_backends: Arc::clone(&loaded_backends),
        }));
        core.handle(BackendCommand::Load {
            request: local_load_request(None),
            probe: audio_probe(),
        })
        .unwrap();
        core.handle(BackendCommand::Load {
            request: local_load_request(Some(5_000)),
            probe: audio_probe(),
        })
        .unwrap();

        let backends = loaded_backends.lock().unwrap();
        assert_eq!(backends.len(), 2);
        assert!(backends[0].lock().unwrap().stopped);
        assert!(!backends[1].lock().unwrap().stopped);
    }

    #[test]
    fn player_core_reports_backend_unavailable_for_video_playback() {
        let mut core = test_core();
        let loaded = core
            .handle(BackendCommand::Load {
                request: local_load_request(None),
                probe: video_probe(),
            })
            .unwrap();
        assert_eq!(loaded.status, PlayerStatus::Ready);
        assert!(loaded.has_video);

        let err = core.handle(BackendCommand::Play).unwrap_err();
        assert_eq!(err.code, "backendUnavailable");
        let snapshot = core.handle(BackendCommand::Snapshot).unwrap();
        assert_eq!(snapshot.status, PlayerStatus::Error);
        assert_eq!(snapshot.error.as_deref(), Some(err.message.as_str()));
    }

    #[test]
    fn player_core_muting_does_not_change_volume() {
        let mut core = loaded_core();
        let muted = core.handle(BackendCommand::SetMuted(true)).unwrap();
        assert!(muted.muted);
        assert_eq!(muted.volume, 1.25);

        let unmuted = core.handle(BackendCommand::SetMuted(false)).unwrap();
        assert!(!unmuted.muted);
        assert_eq!(unmuted.volume, 1.25);
    }

    #[test]
    fn playback_controller_dispatches_on_worker_thread() {
        let controller = PlaybackController::with_core(test_core());
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

    fn test_core() -> PlayerCore {
        PlayerCore::with_audio_factory(Box::new(FakeAudioFactory))
    }

    fn loaded_core() -> PlayerCore {
        let mut core = test_core();
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

    fn video_probe() -> MediaProbe {
        MediaProbe {
            path: "/music/video.mp4".to_string(),
            title: "video".to_string(),
            file_size_bytes: 1024,
            extension: Some("mp4".to_string()),
            media_kind: MediaKind::Video,
        }
    }

    struct FakeAudioFactory;

    impl LocalAudioFactory for FakeAudioFactory {
        fn load(
            &mut self,
            request: &LoadRequest,
            volume: f64,
            muted: bool,
            rate: f64,
        ) -> Result<Box<dyn LocalAudioBackend>, MediaPlayerError> {
            Ok(Box::new(FakeAudioBackend {
                state: Arc::new(Mutex::new(FakeAudioState {
                    position_ms: request.start_ms.unwrap_or(0),
                    duration_ms: Some(120_000),
                    volume,
                    muted,
                    rate,
                    playing: false,
                    stopped: false,
                    empty: false,
                })),
            }))
        }
    }

    struct RecordingAudioFactory {
        loaded_backends: Arc<Mutex<Vec<Arc<Mutex<FakeAudioState>>>>>,
    }

    impl LocalAudioFactory for RecordingAudioFactory {
        fn load(
            &mut self,
            request: &LoadRequest,
            volume: f64,
            muted: bool,
            rate: f64,
        ) -> Result<Box<dyn LocalAudioBackend>, MediaPlayerError> {
            let state = Arc::new(Mutex::new(FakeAudioState {
                position_ms: request.start_ms.unwrap_or(0),
                duration_ms: Some(120_000),
                volume,
                muted,
                rate,
                playing: false,
                stopped: false,
                empty: false,
            }));
            self.loaded_backends
                .lock()
                .unwrap()
                .push(Arc::clone(&state));
            Ok(Box::new(FakeAudioBackend { state }))
        }
    }

    struct FakeAudioBackend {
        state: Arc<Mutex<FakeAudioState>>,
    }

    struct FakeAudioState {
        position_ms: u64,
        duration_ms: Option<u64>,
        volume: f64,
        muted: bool,
        rate: f64,
        playing: bool,
        stopped: bool,
        empty: bool,
    }

    impl LocalAudioBackend for FakeAudioBackend {
        fn play(&mut self) {
            let mut state = self.state.lock().unwrap();
            state.playing = true;
        }

        fn pause(&mut self) {
            let mut state = self.state.lock().unwrap();
            state.playing = false;
        }

        fn stop(&mut self) {
            let mut state = self.state.lock().unwrap();
            state.stopped = true;
            state.playing = false;
        }

        fn seek(&mut self, position_ms: u64) -> Result<(), MediaPlayerError> {
            let mut state = self.state.lock().unwrap();
            state.position_ms = position_ms;
            Ok(())
        }

        fn set_volume(&mut self, volume: f64, muted: bool) {
            let mut state = self.state.lock().unwrap();
            state.volume = volume;
            state.muted = muted;
        }

        fn set_rate(&mut self, rate: f64) {
            let mut state = self.state.lock().unwrap();
            state.rate = rate;
        }

        fn position_ms(&self) -> u64 {
            self.state.lock().unwrap().position_ms
        }

        fn duration_ms(&self) -> Option<u64> {
            self.state.lock().unwrap().duration_ms
        }

        fn is_empty(&self) -> bool {
            self.state.lock().unwrap().empty
        }
    }
}
