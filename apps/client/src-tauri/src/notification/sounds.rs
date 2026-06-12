use rodio::{ChannelCount, Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, SampleRate};
use std::io::Cursor;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, SyncSender, TrySendError},
    Arc, Mutex,
};
use std::thread::JoinHandle;

const APP_SOUND_COMMAND_QUEUE_LIMIT: usize = 32;
const APP_SOUND_PLAYER_QUEUE_LIMIT: usize = 8;
const APP_SOUND_OUTPUT_SAMPLE_RATE_HZ: u32 = 48_000;
const APP_SOUND_OUTPUT_CHANNELS: u16 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AppSound {
    EventNotification,
    IdleAlert,
    FocusSessionFailedLongIdle,
    FocusEndingWarning,
    BreakStart,
    BreakFinished,
    EventFinished,
    PomodoroDayComplete,
    PomodoroWorkweekComplete,
}

impl AppSound {
    pub(crate) fn from_id(id: &str) -> Result<Self, String> {
        match id {
            "event-notification" => Ok(Self::EventNotification),
            "idle-alert" => Ok(Self::IdleAlert),
            "focus-session-failed-long-idle" => Ok(Self::FocusSessionFailedLongIdle),
            "focus-ending-warning" => Ok(Self::FocusEndingWarning),
            "break-start" => Ok(Self::BreakStart),
            "break-finished" => Ok(Self::BreakFinished),
            "event-finished" => Ok(Self::EventFinished),
            "pomodoro-day-complete" => Ok(Self::PomodoroDayComplete),
            "pomodoro-workweek-complete" => Ok(Self::PomodoroWorkweekComplete),
            _ => Err(format!("unknown app sound: {id}")),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::EventNotification => "event-notification",
            Self::IdleAlert => "idle-alert",
            Self::FocusSessionFailedLongIdle => "focus-session-failed-long-idle",
            Self::FocusEndingWarning => "focus-ending-warning",
            Self::BreakStart => "break-start",
            Self::BreakFinished => "break-finished",
            Self::EventFinished => "event-finished",
            Self::PomodoroDayComplete => "pomodoro-day-complete",
            Self::PomodoroWorkweekComplete => "pomodoro-workweek-complete",
        }
    }

    fn bytes(self) -> &'static [u8] {
        match self {
            Self::EventNotification => include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../static/sfx/event-notification.wav"
            )),
            Self::IdleAlert => include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../static/sfx/idle-alert.wav"
            )),
            Self::FocusSessionFailedLongIdle => include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../static/sfx/focus-session-failed-long-idle.wav"
            )),
            Self::FocusEndingWarning => include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../static/sfx/focus-ending-warning.wav"
            )),
            Self::BreakStart => include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../static/sfx/break-start.wav"
            )),
            Self::BreakFinished => include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../static/sfx/break-finished.wav"
            )),
            Self::EventFinished => include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../static/sfx/event-finished.wav"
            )),
            Self::PomodoroDayComplete => include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../static/sfx/pomodoro-day-complete.wav"
            )),
            Self::PomodoroWorkweekComplete => include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../static/sfx/pomodoro-workweek-complete.wav"
            )),
        }
    }
}

pub(crate) struct AppSoundState {
    controller: Mutex<Option<AppSoundController>>,
}

impl Default for AppSoundState {
    fn default() -> Self {
        Self {
            controller: Mutex::new(None),
        }
    }
}

impl AppSoundState {
    pub(crate) fn play(&self, sound: AppSound) {
        self.handle().play(sound);
    }

    fn handle(&self) -> AppSoundHandle {
        let mut controller = self
            .controller
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if controller.is_none() {
            *controller = Some(AppSoundController::new());
        }
        controller
            .as_ref()
            .expect("app sound controller should exist")
            .handle()
    }
}

impl Drop for AppSoundState {
    fn drop(&mut self) {
        if let Ok(mut controller) = self.controller.lock() {
            controller.take();
        }
    }
}

#[derive(Clone)]
struct AppSoundHandle {
    sender: SyncSender<AppSoundMessage>,
}

impl AppSoundHandle {
    fn play(&self, sound: AppSound) {
        match self.sender.try_send(AppSoundMessage::Play(sound)) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                eprintln!("Dropped app sound {} because the queue is full", sound.id());
            }
            Err(TrySendError::Disconnected(_)) => {
                eprintln!(
                    "Dropped app sound {} because the audio worker stopped",
                    sound.id()
                );
            }
        }
    }
}

struct AppSoundController {
    sender: Option<SyncSender<AppSoundMessage>>,
    worker: Option<JoinHandle<()>>,
}

impl AppSoundController {
    fn new() -> Self {
        let (sender, receiver) = mpsc::sync_channel(APP_SOUND_COMMAND_QUEUE_LIMIT);
        let worker = std::thread::Builder::new()
            .name("ganbaru-ai-app-sounds".to_string())
            .spawn(move || app_sound_worker(receiver))
            .expect("failed to start app sound worker thread");
        Self {
            sender: Some(sender),
            worker: Some(worker),
        }
    }

    fn handle(&self) -> AppSoundHandle {
        AppSoundHandle {
            sender: self
                .sender
                .as_ref()
                .expect("app sound controller sender should exist")
                .clone(),
        }
    }
}

impl Drop for AppSoundController {
    fn drop(&mut self) {
        let shutdown_sent = self
            .sender
            .take()
            .map(|sender| {
                let sent = match sender.try_send(AppSoundMessage::Shutdown) {
                    Ok(()) => true,
                    Err(TrySendError::Full(_)) => false,
                    Err(TrySendError::Disconnected(_)) => true,
                };
                drop(sender);
                sent
            })
            .unwrap_or(true);

        if shutdown_sent {
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
    }
}

enum AppSoundMessage {
    Play(AppSound),
    Shutdown,
}

struct AppSoundOutput {
    _sink: MixerDeviceSink,
    player: Player,
    stream_failed: Arc<AtomicBool>,
}

impl AppSoundOutput {
    fn open() -> Result<Self, String> {
        let stream_failed = Arc::new(AtomicBool::new(false));
        let stream_failed_for_callback = stream_failed.clone();
        let mut sink = DeviceSinkBuilder::from_default_device()
            .map(|builder| {
                builder
                    .with_sample_rate(nonzero_sample_rate(APP_SOUND_OUTPUT_SAMPLE_RATE_HZ))
                    .with_channels(nonzero_channels(APP_SOUND_OUTPUT_CHANNELS))
                    .with_error_callback(move |e| {
                        stream_failed_for_callback.store(true, Ordering::Release);
                        eprintln!("App sound audio output error: {e}");
                    })
            })
            .and_then(|builder| builder.open_sink_or_fallback())
            .map_err(|e| format!("open audio output for app sounds: {e}"))?;
        sink.log_on_drop(false);
        let player = Player::connect_new(sink.mixer());
        Ok(Self {
            _sink: sink,
            player,
            stream_failed,
        })
    }

    fn should_reopen(&self) -> bool {
        self.stream_failed.load(Ordering::Acquire)
    }
}

fn app_sound_worker(receiver: Receiver<AppSoundMessage>) {
    let mut output: Option<AppSoundOutput> = None;
    while let Ok(message) = receiver.recv() {
        match message {
            AppSoundMessage::Play(sound) => {
                if let Err(e) = queue_app_sound(&mut output, sound) {
                    output = None;
                    eprintln!("Failed to play app sound: {e}");
                }
            }
            AppSoundMessage::Shutdown => break,
        }
    }
}

fn queue_app_sound(output: &mut Option<AppSoundOutput>, sound: AppSound) -> Result<(), String> {
    if output.as_ref().is_some_and(AppSoundOutput::should_reopen) {
        *output = None;
    }

    if output.is_none() {
        *output = Some(AppSoundOutput::open()?);
    }

    let output = output
        .as_ref()
        .expect("app sound output should exist after opening");
    if output.player.len() >= APP_SOUND_PLAYER_QUEUE_LIMIT {
        eprintln!(
            "Dropped app sound {} because too many sounds are queued",
            sound.id()
        );
        return Ok(());
    }

    let decoder = Decoder::try_from(Cursor::new(sound.bytes()))
        .map_err(|e| format!("decode app sound {}: {e}", sound.id()))?;
    output.player.append(decoder);
    Ok(())
}

fn nonzero_sample_rate(value: u32) -> SampleRate {
    SampleRate::new(value).expect("sample rate must be greater than zero")
}

fn nonzero_channels(value: u16) -> ChannelCount {
    ChannelCount::new(value).expect("channel count must be greater than zero")
}
