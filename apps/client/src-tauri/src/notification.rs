use notify_rust::{Hint, Notification};
use rodio::{ChannelCount, Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, SampleRate};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "linux")]
use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, SyncSender, TrySendError},
    Arc, Mutex,
};
use std::thread::JoinHandle;
use tauri::{window::Color, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

use crate::pomodoro_enforcement::{
    reinforce_overlay_windows, start_overlay_enforcement, OverlayEnforcementGuard,
    OverlayReconcileGuard,
};

const APP_SOUND_COMMAND_QUEUE_LIMIT: usize = 32;
const APP_SOUND_PLAYER_QUEUE_LIMIT: usize = 8;
const APP_SOUND_OUTPUT_SAMPLE_RATE_HZ: u32 = 48_000;
const APP_SOUND_OUTPUT_CHANNELS: u16 = 2;

#[derive(Clone, Serialize)]
struct AddTimePayload {
    seconds: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AppSound {
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
    fn from_id(id: &str) -> Result<Self, String> {
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
    fn play(&self, sound: AppSound) {
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

fn fixed_command_output(program: &str, args: &[&str], max_bytes: usize) -> Result<String, String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{program} stdout pipe was unavailable"))?;
    let mut bytes = Vec::with_capacity(max_bytes.min(4096) + 1);
    let mut limited = (&mut stdout).take((max_bytes + 1) as u64);
    std::io::Read::read_to_end(&mut limited, &mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > max_bytes {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("{program} output exceeded {max_bytes} bytes"));
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("{program} exited with status {status}"));
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

fn fixed_command_status(program: &str, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn gsettings_get(schema: &str, key: &str) -> Option<String> {
    fixed_command_output("gsettings", &["get", schema, key], 4096)
        .ok()
        .map(|stdout| stdout.trim().to_string())
}

#[cfg(target_os = "linux")]
fn gsettings_set(schema: &str, key: &str, value: &str) -> Result<(), String> {
    if !is_allowed_gsettings_restore_target(schema, key) {
        return Err(format!(
            "refusing to write unknown gsettings key {schema} {key}"
        ));
    }
    if !valid_shortcut_restore_value(value) {
        return Err(format!(
            "refusing to write invalid gsettings value for {schema} {key}"
        ));
    }
    if fixed_command_status("gsettings", &["set", schema, key, value]) {
        Ok(())
    } else {
        Err(format!("gsettings set {schema} {key} failed"))
    }
}

#[cfg(target_os = "linux")]
#[derive(Clone, Serialize, Deserialize)]
struct SavedShortcuts {
    overlay_key: String,
    dock_hotkeys: String,
    /// (schema, key, original_value) for every keybinding that was disabled
    disabled: Vec<(String, String, String)>,
}

#[cfg(target_os = "linux")]
const SHORTCUT_RESTORE_FILE: &str = "gnome-shortcuts-restore.json";
#[cfg(target_os = "linux")]
const SHORTCUT_RESTORE_MAX_BYTES: u64 = 256 * 1024;
#[cfg(target_os = "linux")]
const SHORTCUT_RESTORE_VALUE_MAX_BYTES: usize = 2048;
#[cfg(target_os = "linux")]
const SHORTCUT_RESTORE_DISABLED_MAX_ITEMS: usize = 512;
#[cfg(target_os = "linux")]
const GNOME_KEYBINDING_SCHEMAS: [&str; 4] = [
    "org.gnome.desktop.wm.keybindings",
    "org.gnome.shell.keybindings",
    "org.gnome.mutter.keybindings",
    "org.gnome.settings-daemon.plugins.media-keys",
];
#[cfg(target_os = "linux")]
const GNOME_SPECIAL_RESTORE_KEYS: [(&str, &str); 2] = [
    ("org.gnome.mutter", "overlay-key"),
    ("org.gnome.shell.extensions.dash-to-dock", "hot-keys"),
];

#[cfg(target_os = "linux")]
fn gsettings_list_recursively(schema: &str) -> Result<Vec<(String, String)>, String> {
    if !is_known_keybinding_schema(schema) {
        return Err(format!("unknown gsettings schema {schema}"));
    }
    let stdout = fixed_command_output("gsettings", &["list-recursively", schema], 64 * 1024)?;
    let mut result = Vec::new();
    for line in stdout.lines() {
        // Format: "schema key value..."
        let mut parts = line.splitn(3, ' ');
        let _schema = parts.next();
        let key = match parts.next() {
            Some(k) => k.to_string(),
            None => continue,
        };
        let value = match parts.next() {
            Some(v) => v.to_string(),
            None => continue,
        };
        result.push((key, value));
    }
    Ok(result)
}

#[cfg(target_os = "linux")]
fn is_known_keybinding_schema(schema: &str) -> bool {
    GNOME_KEYBINDING_SCHEMAS.contains(&schema)
}

#[cfg(target_os = "linux")]
fn is_allowed_gsettings_restore_target(schema: &str, key: &str) -> bool {
    GNOME_SPECIAL_RESTORE_KEYS.contains(&(schema, key))
        || (is_known_keybinding_schema(schema) && valid_gsettings_key_name(key))
}

#[cfg(target_os = "linux")]
fn valid_gsettings_key_name(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

#[cfg(target_os = "linux")]
fn valid_shortcut_restore_value(value: &str) -> bool {
    !value.as_bytes().contains(&0) && value.len() <= SHORTCUT_RESTORE_VALUE_MAX_BYTES
}

#[cfg(target_os = "linux")]
fn current_shortcut_schema_keys() -> Result<HashMap<String, HashSet<String>>, String> {
    let mut keys = HashMap::new();
    for schema in GNOME_KEYBINDING_SCHEMAS {
        let schema_keys = gsettings_list_recursively(schema)?
            .into_iter()
            .map(|(key, _)| key)
            .collect::<HashSet<_>>();
        keys.insert(schema.to_string(), schema_keys);
    }
    Ok(keys)
}

#[cfg(target_os = "linux")]
fn validate_saved_shortcuts(
    saved: &SavedShortcuts,
    known_keys: &HashMap<String, HashSet<String>>,
) -> Result<(), String> {
    if !valid_shortcut_restore_value(&saved.overlay_key) {
        return Err("invalid GNOME overlay key restore value".to_string());
    }
    if !valid_shortcut_restore_value(&saved.dock_hotkeys) {
        return Err("invalid GNOME dock hotkeys restore value".to_string());
    }
    if saved.disabled.len() > SHORTCUT_RESTORE_DISABLED_MAX_ITEMS {
        return Err("GNOME shortcut restore file has too many disabled keys".to_string());
    }
    for (schema, key, value) in &saved.disabled {
        if !is_known_keybinding_schema(schema) {
            return Err(format!("unknown GNOME shortcut schema {schema}"));
        }
        if !valid_gsettings_key_name(key) {
            return Err(format!("invalid GNOME shortcut key name {key}"));
        }
        if !known_keys
            .get(schema)
            .is_some_and(|schema_keys| schema_keys.contains(key))
        {
            return Err(format!("unknown GNOME shortcut key {schema} {key}"));
        }
        if !valid_shortcut_restore_value(value) {
            return Err(format!(
                "invalid GNOME shortcut restore value for {schema} {key}"
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn write_owner_only_file(path: &Path, contents: &str) -> Result<(), String> {
    #[cfg(unix)]
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    options.mode(0o600);

    let mut file = options.open(path).map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut file, contents.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;

    #[cfg(unix)]
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(target_os = "linux")]
fn read_saved_shortcuts_file(path: &Path) -> Result<SavedShortcuts, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > SHORTCUT_RESTORE_MAX_BYTES {
        return Err("GNOME shortcut restore file is too large".to_string());
    }
    let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn read_saved_shortcuts_file_or_clear(path: &Path) -> Result<SavedShortcuts, String> {
    match read_saved_shortcuts_file(path) {
        Ok(saved) => Ok(saved),
        Err(err) => {
            clear_shortcut_restore(path);
            Err(err)
        }
    }
}

#[cfg(target_os = "linux")]
fn validate_saved_shortcuts_or_clear(
    path: &Path,
    saved: SavedShortcuts,
    known_keys: &HashMap<String, HashSet<String>>,
) -> Result<SavedShortcuts, String> {
    match validate_saved_shortcuts(&saved, known_keys) {
        Ok(()) => Ok(saved),
        Err(err) => {
            clear_shortcut_restore(path);
            Err(err)
        }
    }
}

#[cfg(target_os = "linux")]
impl SavedShortcuts {
    fn capture() -> Self {
        let mut disabled = Vec::new();

        // Scan keybinding schemas for bindings using Super or Alt.
        for schema in GNOME_KEYBINDING_SCHEMAS {
            let Ok(entries) = gsettings_list_recursively(schema) else {
                continue;
            };
            for (key, value) in entries {
                if value.contains("Super") || value.contains("<Alt>") {
                    disabled.push((schema.to_string(), key.clone(), value));
                }
            }
        }

        // Mutter overlay-key (Super alone)
        let overlay_key =
            gsettings_get("org.gnome.mutter", "overlay-key").unwrap_or_else(|| "'Super_L'".into());

        // Ubuntu Dock / Dash to Dock Super+N
        let dock_hotkeys = gsettings_get("org.gnome.shell.extensions.dash-to-dock", "hot-keys")
            .unwrap_or_else(|| "true".into());

        Self {
            overlay_key,
            dock_hotkeys,
            disabled,
        }
    }

    fn disable(&self) {
        for (schema, key, _) in &self.disabled {
            if let Err(err) = gsettings_set(schema, key, "['']") {
                eprintln!("failed to disable GNOME shortcut {schema} {key}: {err}");
            }
        }
        if let Err(err) = gsettings_set("org.gnome.mutter", "overlay-key", "") {
            eprintln!("failed to disable GNOME overlay key: {err}");
        }
        if let Err(err) = gsettings_set(
            "org.gnome.shell.extensions.dash-to-dock",
            "hot-keys",
            "false",
        ) {
            eprintln!("failed to disable GNOME dock hotkeys: {err}");
        }
    }

    fn save_and_disable(app: &tauri::AppHandle) -> Result<Self, String> {
        let saved = Self::capture();
        let known_keys = current_shortcut_schema_keys()?;
        validate_saved_shortcuts(&saved, &known_keys)?;
        let path = shortcut_restore_path(app)?;
        persist_shortcut_restore(&path, &saved)?;
        saved.disable();
        Ok(saved)
    }
}

#[cfg(target_os = "linux")]
fn shortcut_restore_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    path.push(SHORTCUT_RESTORE_FILE);
    Ok(path)
}

#[cfg(target_os = "linux")]
fn persist_shortcut_restore(path: &Path, saved: &SavedShortcuts) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string(saved).map_err(|e| e.to_string())?;
    write_owner_only_file(&tmp_path, &json)?;
    std::fs::rename(&tmp_path, path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn restore_shortcuts(saved: &SavedShortcuts) {
    if let Err(err) = gsettings_set("org.gnome.mutter", "overlay-key", &saved.overlay_key) {
        eprintln!("failed to restore GNOME overlay key: {err}");
    }
    if let Err(err) = gsettings_set(
        "org.gnome.shell.extensions.dash-to-dock",
        "hot-keys",
        &saved.dock_hotkeys,
    ) {
        eprintln!("failed to restore GNOME dock hotkeys: {err}");
    }
    for (schema, key, val) in &saved.disabled {
        if let Err(err) = gsettings_set(schema, key, val) {
            eprintln!("failed to restore GNOME shortcut {schema} {key}: {err}");
        }
    }
}

#[cfg(target_os = "linux")]
fn clear_shortcut_restore(path: &Path) {
    if path.exists() {
        if let Err(err) = std::fs::remove_file(path) {
            eprintln!("failed to clear GNOME shortcut restore file: {err}");
        }
    }
}

#[cfg(target_os = "linux")]
pub fn restore_stale_shortcuts(app: &tauri::AppHandle) -> Result<(), String> {
    let path = shortcut_restore_path(app)?;
    if !path.exists() {
        return Ok(());
    }
    let saved = read_saved_shortcuts_file_or_clear(&path)?;
    let known_keys = current_shortcut_schema_keys()?;
    let saved = validate_saved_shortcuts_or_clear(&path, saved, &known_keys)?;
    restore_shortcuts(&saved);
    clear_shortcut_restore(&path);
    Ok(())
}

#[cfg(not(target_os = "linux"))]
pub fn restore_stale_shortcuts(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

fn run_main_thread_setup<T, F>(app: &tauri::AppHandle, setup: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(setup());
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

/// Inhibit screensaver/idle via D-Bus, returns cookie for uninhibit
#[cfg(target_os = "linux")]
fn screensaver_inhibit() -> Option<u32> {
    let stdout = fixed_command_output(
        "gdbus",
        &[
            "call",
            "--session",
            "--dest",
            "org.freedesktop.ScreenSaver",
            "--object-path",
            "/org/freedesktop/ScreenSaver",
            "--method",
            "org.freedesktop.ScreenSaver.Inhibit",
            "Ganbaru AI",
            "Break timer active",
        ],
        1024,
    )
    .ok()?;

    // Output format: "(uint32 1234,)"
    stdout
        .trim()
        .strip_prefix("(uint32 ")?
        .strip_suffix(",)")?
        .parse::<u32>()
        .ok()
}

#[cfg(target_os = "linux")]
fn screensaver_uninhibit(cookie: u32) {
    let cookie = cookie.to_string();
    let _ = fixed_command_status(
        "gdbus",
        &[
            "call",
            "--session",
            "--dest",
            "org.freedesktop.ScreenSaver",
            "--object-path",
            "/org/freedesktop/ScreenSaver",
            "--method",
            "org.freedesktop.ScreenSaver.UnInhibit",
            &cookie,
        ],
    );
}

#[cfg(not(target_os = "linux"))]
fn screensaver_inhibit() -> Option<u32> {
    None
}

#[cfg(not(target_os = "linux"))]
fn screensaver_uninhibit(_cookie: u32) {}

const POMODORO_OVERLAY_MAIN_LABEL: &str = "pomodoro-overlay-main";
const POMODORO_OVERLAY_BLOCKER_ACTION_EVENT: &str = "pomodoro-overlay-blocker-action";
const POMODORO_OVERLAY_STATE_CHANGED_EVENT: &str = "pomodoro-overlay-state-changed";
#[cfg(not(target_os = "linux"))]
const POMODORO_OVERLAY_BLOCKER_PREFIX: &str = "pomodoro-overlay-blocker";

#[cfg(target_os = "linux")]
struct LinuxNativeBlocker {
    window: gtk::Window,
    color: std::rc::Rc<std::cell::Cell<OverlayColor>>,
}

#[cfg(target_os = "linux")]
thread_local! {
    static POMODORO_GTK_BLOCKERS: std::cell::RefCell<Vec<LinuxNativeBlocker>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

#[derive(Clone, Copy)]
enum PomodoroOverlayKind {
    Break {
        ends_at_ms: u64,
        end_esc_presses: Option<u32>,
    },
    Idle {
        seconds: u32,
    },
    Completion {
        visual_state: PomodoroOverlayVisualState,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PomodoroOverlayVisualState {
    Idle,
    IdleFailed,
    BreakCountdown,
    BreakFinished,
    EventFinished,
    DayComplete,
    WorkweekComplete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct OverlayColor {
    red: u8,
    green: u8,
    blue: u8,
}

#[derive(Clone, Serialize)]
struct PomodoroOverlayStateChangedPayload {
    state: String,
}

#[derive(Clone, Serialize)]
struct PomodoroOverlayBlockerActionPayload {
    kind: String,
}

impl OverlayColor {
    fn tauri(self) -> Color {
        Color(self.red, self.green, self.blue, 255)
    }

    #[cfg(target_os = "linux")]
    fn gtk_rgb(self) -> (f64, f64, f64) {
        (
            f64::from(self.red) / 255.0,
            f64::from(self.green) / 255.0,
            f64::from(self.blue) / 255.0,
        )
    }
}

impl PomodoroOverlayKind {
    fn initial_visual_state(self) -> PomodoroOverlayVisualState {
        match self {
            Self::Break { .. } => PomodoroOverlayVisualState::BreakCountdown,
            Self::Idle { .. } => PomodoroOverlayVisualState::Idle,
            Self::Completion { visual_state } => visual_state,
        }
    }
}

impl PomodoroOverlayVisualState {
    fn from_id(id: &str) -> Result<Self, String> {
        match id {
            "idle" => Ok(Self::Idle),
            "idle_failed" => Ok(Self::IdleFailed),
            "break_countdown" => Ok(Self::BreakCountdown),
            "break_finished" => Ok(Self::BreakFinished),
            "event_finished" => Ok(Self::EventFinished),
            "day_complete" => Ok(Self::DayComplete),
            "workweek_complete" => Ok(Self::WorkweekComplete),
            _ => Err(format!("unknown pomodoro overlay state: {id}")),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::IdleFailed => "idle_failed",
            Self::BreakCountdown => "break_countdown",
            Self::BreakFinished => "break_finished",
            Self::EventFinished => "event_finished",
            Self::DayComplete => "day_complete",
            Self::WorkweekComplete => "workweek_complete",
        }
    }

    fn background_color(self) -> OverlayColor {
        match self {
            Self::Idle | Self::IdleFailed => OverlayColor {
                red: 0xA3,
                green: 0x37,
                blue: 0x28,
            },
            Self::BreakCountdown => OverlayColor {
                red: 0x03,
                green: 0x5B,
                blue: 0x33,
            },
            Self::BreakFinished => OverlayColor {
                red: 0x0E,
                green: 0x74,
                blue: 0x90,
            },
            Self::EventFinished => OverlayColor {
                red: 0xEE,
                green: 0xBA,
                blue: 0x04,
            },
            Self::DayComplete => OverlayColor {
                red: 0xEE,
                green: 0xBA,
                blue: 0x04,
            },
            Self::WorkweekComplete => OverlayColor {
                red: 0x1D,
                green: 0x4E,
                blue: 0xD8,
            },
        }
    }
}

pub(crate) struct PomodoroOverlayState {
    active: AtomicBool,
    cleanup: Mutex<Option<PomodoroOverlayCleanup>>,
}

impl Default for PomodoroOverlayState {
    fn default() -> Self {
        Self {
            active: AtomicBool::new(false),
            cleanup: Mutex::new(None),
        }
    }
}

struct PomodoroOverlayCleanup {
    labels: Vec<String>,
    kind: PomodoroOverlayKind,
    visual_state: PomodoroOverlayVisualState,
    monitor_signature: Option<MonitorSignature>,
    enforcement: OverlayEnforcementGuard,
    reconcile_guard: Option<OverlayReconcileGuard>,
}

#[derive(Clone)]
struct PomodoroOverlaySnapshot {
    labels: Vec<String>,
    kind: PomodoroOverlayKind,
    visual_state: PomodoroOverlayVisualState,
    monitor_signature: Option<MonitorSignature>,
}

impl PomodoroOverlayState {
    pub(crate) fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    pub(crate) fn focus<R: Runtime, M: Manager<R>>(&self, manager: &M) {
        if let Some(window) = manager.get_webview_window(POMODORO_OVERLAY_MAIN_LABEL) {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_always_on_top(true);
            let _ = window.set_focus();
        }
    }

    fn begin(
        &self,
        app: &tauri::AppHandle,
        kind: PomodoroOverlayKind,
        visual_state: PomodoroOverlayVisualState,
    ) {
        self.close(app);

        let mut enforcement = start_overlay_enforcement(app, &[], POMODORO_OVERLAY_MAIN_LABEL);

        if let Some(cookie) = screensaver_inhibit() {
            enforcement.push_cleanup(move || {
                screensaver_uninhibit(cookie);
                Ok(())
            });
        }

        #[cfg(target_os = "linux")]
        match shortcut_restore_path(app)
            .and_then(|path| SavedShortcuts::save_and_disable(app).map(|saved| (saved, path)))
        {
            Ok((saved, path)) => {
                enforcement.push_cleanup(move || {
                    restore_shortcuts(&saved);
                    clear_shortcut_restore(&path);
                    Ok(())
                });
            }
            Err(err) => {
                eprintln!("failed to disable Linux overlay shortcuts: {err}");
            }
        };

        let cleanup = PomodoroOverlayCleanup {
            labels: Vec::new(),
            kind,
            visual_state,
            monitor_signature: None,
            enforcement,
            reconcile_guard: None,
        };
        *self
            .cleanup
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(cleanup);
        self.active.store(true, Ordering::SeqCst);
    }

    fn set_overlay_session(
        &self,
        app: &tauri::AppHandle,
        labels: Vec<String>,
        monitor_signature: MonitorSignature,
    ) {
        let mut cleanup = self
            .cleanup
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cleanup) = cleanup.as_mut() {
            cleanup
                .enforcement
                .set_window_labels(labels.clone(), POMODORO_OVERLAY_MAIN_LABEL);
            cleanup.labels = labels;
            cleanup.monitor_signature = Some(monitor_signature);
            if cleanup.reconcile_guard.is_none() {
                let app_for_reconcile = app.clone();
                match OverlayReconcileGuard::start(move || {
                    let overlays = app_for_reconcile.state::<PomodoroOverlayState>();
                    if !overlays.is_active() {
                        return false;
                    }
                    overlays.reconcile(&app_for_reconcile);
                    true
                }) {
                    Ok(guard) => cleanup.reconcile_guard = Some(guard),
                    Err(err) => {
                        eprintln!("failed to start Pomodoro overlay monitor reconciler: {err}");
                    }
                }
            }
        }
    }

    fn labels(&self) -> Vec<String> {
        self.cleanup
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(|cleanup| cleanup.labels.clone())
            .unwrap_or_default()
    }

    fn snapshot(&self) -> Option<PomodoroOverlaySnapshot> {
        self.cleanup
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(|cleanup| PomodoroOverlaySnapshot {
                labels: cleanup.labels.clone(),
                kind: cleanup.kind,
                visual_state: cleanup.visual_state,
                monitor_signature: cleanup.monitor_signature.clone(),
            })
    }

    fn set_visual_state(&self, visual_state: PomodoroOverlayVisualState) {
        if let Some(cleanup) = self
            .cleanup
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_mut()
        {
            cleanup.visual_state = visual_state;
        }
    }

    fn reconcile(&self, app: &tauri::AppHandle) {
        let Some(snapshot) = self.snapshot() else {
            return;
        };
        let existing_labels = snapshot.labels.clone();
        let app_for_setup = app.clone();

        let setup_result = run_main_thread_setup(app, move || {
            let monitors = app_for_setup
                .available_monitors()
                .map_err(|e| e.to_string())?;
            if monitors.is_empty() {
                return Ok(None);
            }
            let primary_idx = primary_monitor_index(&app_for_setup, &monitors)?;
            let signature = monitor_signature(&monitors, primary_idx);
            let missing_overlay_window = snapshot
                .labels
                .iter()
                .any(|label| app_for_setup.get_webview_window(label).is_none());
            if snapshot.monitor_signature.as_ref() == Some(&signature) && !missing_overlay_window {
                return Ok(None);
            }
            let labels = reconcile_overlay_windows(
                &app_for_setup,
                snapshot.kind,
                snapshot.visual_state,
                &snapshot.labels,
                &monitors,
                primary_idx,
            )?;
            Ok(Some((labels, signature)))
        });

        match setup_result {
            Ok(Some((labels, signature))) => {
                if !self.is_active() {
                    destroy_overlay_windows(app, &labels);
                    return;
                }
                reinforce_overlay_windows(app, &labels, POMODORO_OVERLAY_MAIN_LABEL);
                self.set_overlay_session(app, labels, signature);
            }
            Ok(None) => {
                if !self.is_active() {
                    return;
                }
                reinforce_overlay_windows(app, &existing_labels, POMODORO_OVERLAY_MAIN_LABEL);
            }
            Err(err) => {
                eprintln!("failed to reconcile Pomodoro overlay monitors: {err}");
            }
        }
    }

    fn close(&self, app: &tauri::AppHandle) {
        self.active.store(false, Ordering::SeqCst);
        let cleanup = self
            .cleanup
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        let Some(mut cleanup) = cleanup else {
            return;
        };

        if let Some(reconcile_guard) = cleanup.reconcile_guard.take() {
            reconcile_guard.stop();
        }
        destroy_overlay_windows(app, &cleanup.labels);
        restore_overlay_cleanup(cleanup);
    }
}

fn destroy_overlay_windows(app: &tauri::AppHandle, labels: &[String]) {
    let labels = labels.to_vec();
    let app_for_setup = app.clone();
    if let Err(err) = run_main_thread_setup(app, move || {
        #[cfg(target_os = "linux")]
        destroy_linux_native_blocker_windows();

        for label in labels {
            if let Some(window) = app_for_setup.get_webview_window(&label) {
                let _ = window.destroy();
            }
        }
        Ok(())
    }) {
        eprintln!("failed to destroy pomodoro overlay windows: {err}");
    }
}

fn restore_overlay_cleanup(mut cleanup: PomodoroOverlayCleanup) {
    std::thread::spawn(move || {
        cleanup.enforcement.stop();
    });
}

fn overlay_url(kind: PomodoroOverlayKind) -> WebviewUrl {
    let query = match kind {
        PomodoroOverlayKind::Break {
            ends_at_ms,
            end_esc_presses,
        } => {
            let end_esc_presses = end_esc_presses
                .map(|presses| presses.to_string())
                .unwrap_or_else(|| "disabled".to_string());
            format!(
                "index.html?ganbaruWindow=pomodoroOverlay&overlayKind=break&breakEndsAtMs={ends_at_ms}&breakEndEscPresses={end_esc_presses}"
            )
        }
        PomodoroOverlayKind::Idle { seconds } => {
            format!(
                "index.html?ganbaruWindow=pomodoroOverlay&overlayKind=idle&idleSeconds={seconds}"
            )
        }
        PomodoroOverlayKind::Completion { visual_state } => {
            format!(
                "index.html?ganbaruWindow=pomodoroOverlay&overlayKind=completion&screenState={}",
                visual_state.id()
            )
        }
    };
    WebviewUrl::App(query.into())
}

#[cfg(not(target_os = "linux"))]
fn blocker_url(state: PomodoroOverlayVisualState) -> WebviewUrl {
    WebviewUrl::App(
        format!(
            "index.html?ganbaruWindow=pomodoroOverlayBlocker&screenState={}",
            state.id()
        )
        .into(),
    )
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct MonitorSignature {
    primary_idx: usize,
    monitors: Vec<MonitorSnapshot>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct MonitorSnapshot {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_bits: u64,
}

fn monitor_matches(a: &tauri::window::Monitor, b: &tauri::window::Monitor) -> bool {
    a.position().x == b.position().x
        && a.position().y == b.position().y
        && a.size().width == b.size().width
        && a.size().height == b.size().height
}

fn primary_monitor_index(
    app: &tauri::AppHandle,
    monitors: &[tauri::window::Monitor],
) -> Result<usize, String> {
    Ok(app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .and_then(|primary| {
            monitors
                .iter()
                .position(|monitor| monitor_matches(monitor, &primary))
        })
        .unwrap_or(0))
}

fn monitor_signature(monitors: &[tauri::window::Monitor], primary_idx: usize) -> MonitorSignature {
    MonitorSignature {
        primary_idx,
        monitors: monitors
            .iter()
            .map(|monitor| MonitorSnapshot {
                x: monitor.position().x,
                y: monitor.position().y,
                width: monitor.size().width,
                height: monitor.size().height,
                scale_bits: monitor.scale_factor().to_bits(),
            })
            .collect(),
    }
}

fn monitor_logical_geometry(monitor: &tauri::window::Monitor) -> (f64, f64, f64, f64) {
    let scale = monitor.scale_factor().max(1.0);
    (
        monitor.position().x as f64 / scale,
        monitor.position().y as f64 / scale,
        monitor.size().width as f64 / scale,
        monitor.size().height as f64 / scale,
    )
}

fn destroy_existing_window(app: &tauri::AppHandle, label: &str) {
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.destroy();
    }
}

fn configure_svelte_overlay_window(
    window: &tauri::WebviewWindow,
    monitor: &tauri::window::Monitor,
    background_color: OverlayColor,
    focused: bool,
) {
    let (x, y, width, height) = monitor_logical_geometry(monitor);
    let _ = window.set_fullscreen(false);
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    let _ = window.set_background_color(Some(background_color.tauri()));
    let _ = window.set_shadow(false);
    let _ = window.set_fullscreen(true);
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    let _ = window.set_fullscreen(true);
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_visible_on_all_workspaces(true);
    if focused {
        let _ = window.set_focus();
    }
}

fn build_svelte_overlay_window(
    app: &tauri::AppHandle,
    label: &str,
    url: WebviewUrl,
    title: &str,
    monitor: &tauri::window::Monitor,
    background_color: OverlayColor,
    focused: bool,
) -> Result<(), String> {
    destroy_existing_window(app, label);

    let (x, y, width, height) = monitor_logical_geometry(monitor);
    let window = WebviewWindowBuilder::new(app, label, url)
        .title(title)
        .position(x, y)
        .inner_size(width, height)
        .decorations(false)
        .transparent(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .always_on_top(false)
        .visible_on_all_workspaces(false)
        .skip_taskbar(false)
        .focused(focused)
        .fullscreen(false)
        .visible(false)
        .background_color(background_color.tauri())
        .build()
        .map_err(|e| format!("create pomodoro overlay window {label}: {e}"))?;

    configure_svelte_overlay_window(&window, monitor, background_color, focused);
    Ok(())
}

#[cfg(target_os = "linux")]
fn destroy_linux_native_blocker_windows() {
    use gtk::prelude::*;

    POMODORO_GTK_BLOCKERS.with(|blockers| {
        for blocker in blockers.borrow_mut().drain(..) {
            blocker.window.hide();
            blocker.window.close();
        }
    });
}

#[cfg(target_os = "linux")]
fn repaint_linux_native_blocker_windows(background_color: OverlayColor) {
    use gtk::prelude::WidgetExt;

    POMODORO_GTK_BLOCKERS.with(|blockers| {
        for blocker in blockers.borrow().iter() {
            blocker.color.set(background_color);
            blocker.window.queue_draw();
        }
    });
}

#[cfg(target_os = "linux")]
fn gdk_monitor_matches_tauri(
    gdk_monitor: &gtk::gdk::Monitor,
    tauri_monitor: &tauri::window::Monitor,
) -> bool {
    use gtk::prelude::MonitorExt;

    let geometry = gdk_monitor.geometry();
    let (x, y, width, height) = monitor_logical_geometry(tauri_monitor);
    let tolerance = 2.0;

    (geometry.x() as f64 - x).abs() <= tolerance
        && (geometry.y() as f64 - y).abs() <= tolerance
        && (geometry.width() as f64 - width).abs() <= tolerance
        && (geometry.height() as f64 - height).abs() <= tolerance
}

#[cfg(target_os = "linux")]
fn linux_primary_monitor_index(
    display: &gtk::gdk::Display,
    tauri_primary: &tauri::window::Monitor,
) -> i32 {
    let n_monitors = display.n_monitors();
    if let Some(index) = (0..n_monitors).find(|&index| {
        display
            .monitor(index)
            .is_some_and(|monitor| gdk_monitor_matches_tauri(&monitor, tauri_primary))
    }) {
        return index;
    }

    match display.primary_monitor() {
        Some(primary) => (0..n_monitors)
            .find(|&index| display.monitor(index).as_ref() == Some(&primary))
            .unwrap_or(0),
        None => 0,
    }
}

#[cfg(target_os = "linux")]
fn build_linux_native_blocker_windows(
    app: &tauri::AppHandle,
    primary_monitor: &tauri::window::Monitor,
    background_color: OverlayColor,
) -> Result<(), String> {
    use gtk::prelude::*;

    destroy_linux_native_blocker_windows();

    let display = gtk::gdk::Display::default()
        .ok_or_else(|| "no GDK display is available for secondary monitor blockers".to_string())?;
    let screen = display.default_screen();
    let n_monitors = display.n_monitors();
    if n_monitors <= 1 {
        return Ok(());
    }

    let primary_idx = linux_primary_monitor_index(&display, primary_monitor);
    let mut windows = Vec::new();

    for index in 0..n_monitors {
        if index == primary_idx {
            continue;
        }

        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_decorated(false);
        window.set_keep_above(true);
        window.set_app_paintable(true);
        window.set_accept_focus(false);
        window.set_focus_on_map(false);
        window.add_events(gtk::gdk::EventMask::BUTTON_PRESS_MASK);
        let color = std::rc::Rc::new(std::cell::Cell::new(background_color));
        let draw_color = std::rc::Rc::clone(&color);
        window.connect_draw(move |_, cr| {
            let color = draw_color.get();
            let (red, green, blue) = color.gtk_rgb();
            cr.set_source_rgb(red, green, blue);
            let _ = cr.paint();
            gtk::glib::Propagation::Proceed
        });
        let click_app = app.clone();
        window.connect_button_press_event(move |_, event| {
            if event.button() == 1 {
                let _ = click_app.emit(
                    POMODORO_OVERLAY_BLOCKER_ACTION_EVENT,
                    PomodoroOverlayBlockerActionPayload {
                        kind: "pointer".to_string(),
                    },
                );
            }
            gtk::glib::Propagation::Stop
        });
        window.fullscreen_on_monitor(&screen, index);
        window.show_all();
        window.fullscreen_on_monitor(&screen, index);
        windows.push(LinuxNativeBlocker { window, color });
    }

    POMODORO_GTK_BLOCKERS.with(|blockers| {
        *blockers.borrow_mut() = windows;
    });

    Ok(())
}

fn reconcile_overlay_windows(
    app: &tauri::AppHandle,
    kind: PomodoroOverlayKind,
    visual_state: PomodoroOverlayVisualState,
    old_labels: &[String],
    monitors: &[tauri::window::Monitor],
    primary_idx: usize,
) -> Result<Vec<String>, String> {
    let background_color = visual_state.background_color();
    let primary_monitor = &monitors[primary_idx];
    let mut labels = Vec::with_capacity(monitors.len());
    #[cfg(not(target_os = "linux"))]
    let mut created_labels = Vec::new();
    #[cfg(target_os = "linux")]
    let _ = old_labels;

    #[cfg(target_os = "linux")]
    if let Err(err) = build_linux_native_blocker_windows(app, primary_monitor, background_color) {
        eprintln!("failed to reconcile Linux secondary monitor blockers: {err}");
    }

    #[cfg(not(target_os = "linux"))]
    {
        let mut desired_blocker_labels = Vec::new();
        for (index, monitor) in monitors.iter().enumerate() {
            if index == primary_idx {
                continue;
            }
            let label = format!("{POMODORO_OVERLAY_BLOCKER_PREFIX}-{index}");
            desired_blocker_labels.push(label.clone());
            if let Some(window) = app.get_webview_window(&label) {
                configure_svelte_overlay_window(&window, monitor, background_color, false);
            } else if let Err(err) = build_svelte_overlay_window(
                app,
                &label,
                blocker_url(visual_state),
                "Ganbaru AI blocker",
                monitor,
                background_color,
                false,
            ) {
                eprintln!("failed to reconcile secondary monitor blocker {label}: {err}");
                continue;
            } else {
                created_labels.push(label.clone());
            }
            labels.push(label);
        }

        for label in old_labels {
            if label.starts_with(POMODORO_OVERLAY_BLOCKER_PREFIX)
                && !desired_blocker_labels
                    .iter()
                    .any(|desired| desired == label)
            {
                destroy_existing_window(app, label);
            }
        }
    }

    if let Some(window) = app.get_webview_window(POMODORO_OVERLAY_MAIN_LABEL) {
        configure_svelte_overlay_window(&window, primary_monitor, background_color, true);
    } else if let Err(err) = build_svelte_overlay_window(
        app,
        POMODORO_OVERLAY_MAIN_LABEL,
        overlay_url(kind),
        "Ganbaru AI pomodoro",
        primary_monitor,
        background_color,
        true,
    ) {
        #[cfg(not(target_os = "linux"))]
        for label in created_labels {
            destroy_existing_window(app, &label);
        }
        return Err(err);
    }

    labels.push(POMODORO_OVERLAY_MAIN_LABEL.to_string());
    Ok(labels)
}

fn show_pomodoro_overlay(app: tauri::AppHandle, kind: PomodoroOverlayKind) -> Result<(), String> {
    let overlay_state = app.state::<PomodoroOverlayState>();
    let visual_state = kind.initial_visual_state();
    overlay_state.begin(&app, kind, visual_state);
    let background_color = visual_state.background_color();

    let app_for_setup = app.clone();
    let setup_result = run_main_thread_setup(&app, move || {
        let monitors = app_for_setup
            .available_monitors()
            .map_err(|e| e.to_string())?;
        if monitors.is_empty() {
            return Err("no monitors are available for the pomodoro overlay".to_string());
        }
        let primary_idx = primary_monitor_index(&app_for_setup, &monitors)?;
        let signature = monitor_signature(&monitors, primary_idx);

        let mut labels = Vec::with_capacity(monitors.len());
        let primary_monitor = &monitors[primary_idx];

        #[cfg(target_os = "linux")]
        if let Err(err) =
            build_linux_native_blocker_windows(&app_for_setup, primary_monitor, background_color)
        {
            eprintln!("failed to create Linux secondary monitor blockers: {err}");
        }

        #[cfg(not(target_os = "linux"))]
        for (index, monitor) in monitors.iter().enumerate() {
            if index == primary_idx {
                continue;
            }
            let label = format!("{POMODORO_OVERLAY_BLOCKER_PREFIX}-{index}");
            if let Err(err) = build_svelte_overlay_window(
                &app_for_setup,
                &label,
                blocker_url(visual_state),
                "Ganbaru AI blocker",
                monitor,
                background_color,
                false,
            ) {
                eprintln!("failed to create secondary monitor blocker {label}: {err}");
                continue;
            }
            labels.push(label);
        }

        if let Err(err) = build_svelte_overlay_window(
            &app_for_setup,
            POMODORO_OVERLAY_MAIN_LABEL,
            overlay_url(kind),
            "Ganbaru AI pomodoro",
            primary_monitor,
            background_color,
            true,
        ) {
            destroy_overlay_windows(&app_for_setup, &labels);
            return Err(err);
        }
        labels.push(POMODORO_OVERLAY_MAIN_LABEL.to_string());
        Ok((labels, signature))
    });

    match setup_result {
        Ok((labels, signature)) => {
            reinforce_overlay_windows(&app, &labels, POMODORO_OVERLAY_MAIN_LABEL);
            app.state::<PomodoroOverlayState>()
                .set_overlay_session(&app, labels, signature);
        }
        Err(err) => {
            app.state::<PomodoroOverlayState>().close(&app);
            return Err(err);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn close_pomodoro_overlay(app: tauri::AppHandle, overlays: State<'_, PomodoroOverlayState>) {
    overlays.close(&app);
}

#[tauri::command]
pub fn set_pomodoro_overlay_state(
    app: tauri::AppHandle,
    overlays: State<'_, PomodoroOverlayState>,
    state: String,
) -> Result<(), String> {
    let visual_state = PomodoroOverlayVisualState::from_id(&state)?;
    overlays.set_visual_state(visual_state);
    let background_color = visual_state.background_color();
    let labels = overlays.labels();
    let labels_for_reinforce = labels.clone();
    let app_for_setup = app.clone();

    if let Err(err) = run_main_thread_setup(&app, move || {
        #[cfg(target_os = "linux")]
        repaint_linux_native_blocker_windows(background_color);

        for label in labels {
            if let Some(window) = app_for_setup.get_webview_window(&label) {
                let _ = window.set_background_color(Some(background_color.tauri()));
            }
        }
        Ok(())
    }) {
        eprintln!("failed to recolor pomodoro overlay windows: {err}");
    }
    reinforce_overlay_windows(&app, &labels_for_reinforce, POMODORO_OVERLAY_MAIN_LABEL);

    app.emit(
        POMODORO_OVERLAY_STATE_CHANGED_EVENT,
        PomodoroOverlayStateChangedPayload {
            state: visual_state.id().to_string(),
        },
    )
    .map_err(|e| format!("emit pomodoro overlay state change: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn show_break_overlay(
    app: tauri::AppHandle,
    break_ends_at_ms: u64,
    break_end_esc_presses: Option<u32>,
) -> Result<(), String> {
    show_pomodoro_overlay(
        app,
        PomodoroOverlayKind::Break {
            ends_at_ms: break_ends_at_ms,
            end_esc_presses: normalize_break_end_esc_presses(break_end_esc_presses),
        },
    )
}

fn normalize_break_end_esc_presses(value: Option<u32>) -> Option<u32> {
    match value {
        Some(1 | 3 | 10 | 20 | 50) => value,
        Some(_) => Some(10),
        None => None,
    }
}

#[tauri::command]
pub fn show_idle_overlay(app: tauri::AppHandle, idle_seconds: u32) -> Result<bool, String> {
    show_pomodoro_overlay(
        app,
        PomodoroOverlayKind::Idle {
            seconds: idle_seconds,
        },
    )?;
    Ok(true)
}

fn completion_visual_state_from_kind(kind: &str) -> Result<PomodoroOverlayVisualState, String> {
    match kind {
        "event" => Ok(PomodoroOverlayVisualState::EventFinished),
        "day" => Ok(PomodoroOverlayVisualState::DayComplete),
        "workweek" => Ok(PomodoroOverlayVisualState::WorkweekComplete),
        _ => Err(format!("unknown pomodoro completion kind: {kind}")),
    }
}

#[tauri::command]
pub fn show_pomodoro_completion_overlay(
    app: tauri::AppHandle,
    kind: String,
) -> Result<bool, String> {
    show_pomodoro_overlay(
        app,
        PomodoroOverlayKind::Completion {
            visual_state: completion_visual_state_from_kind(&kind)?,
        },
    )?;
    Ok(true)
}

#[cfg(target_os = "linux")]
fn get_idle_time_ms() -> Option<u64> {
    let stdout = fixed_command_output(
        "gdbus",
        &[
            "call",
            "--session",
            "--dest",
            "org.gnome.Mutter.IdleMonitor",
            "--object-path",
            "/org/gnome/Mutter/IdleMonitor/Core",
            "--method",
            "org.gnome.Mutter.IdleMonitor.GetIdletime",
        ],
        1024,
    )
    .ok()?;

    // Output format: "(uint64 12345,)"
    stdout
        .trim()
        .strip_prefix("(uint64 ")?
        .strip_suffix(",)")?
        .parse::<u64>()
        .ok()
}

#[derive(Clone, Serialize, Deserialize)]
pub struct IdleStatus {
    pub idle_ms: u64,
    pub webcam_in_use: bool,
}

// ── Linux idle detection ─────────────────────────────────────────

#[cfg(target_os = "linux")]
fn is_webcam_in_use() -> bool {
    // Check if any /dev/video* device is opened by another process
    // by scanning /proc/*/fd/ symlink targets.
    let my_pid = std::process::id();
    let entries = match std::fs::read_dir("/proc") {
        Ok(e) => e,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        if name_str == my_pid.to_string() {
            continue;
        }
        let fd_dir = format!("/proc/{name_str}/fd");
        let fds = match std::fs::read_dir(&fd_dir) {
            Ok(f) => f,
            Err(_) => continue,
        };
        for fd_entry in fds.flatten() {
            if let Ok(target) = std::fs::read_link(fd_entry.path()) {
                if let Some(s) = target.to_str() {
                    if s.starts_with("/dev/video") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

#[cfg(target_os = "linux")]
fn get_idle_time_with_fallback() -> u64 {
    // Try GNOME IdleMonitor first (Mutter/GNOME Shell)
    if let Some(ms) = get_idle_time_ms() {
        return ms;
    }
    // Fallback: xprintidle (works on X11 with any desktop)
    if let Ok(stdout) = fixed_command_output("xprintidle", &[], 128) {
        if let Ok(ms) = stdout.trim().parse::<u64>() {
            return ms;
        }
    }
    0
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn get_idle_status() -> IdleStatus {
    IdleStatus {
        idle_ms: get_idle_time_with_fallback(),
        webcam_in_use: is_webcam_in_use(),
    }
}

// ── Windows idle detection ───────────────────────────────────────

#[cfg(target_os = "windows")]
fn get_idle_time_ms_windows() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut lii = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };

    // SAFETY: `lii` is a valid LASTINPUTINFO output buffer with cbSize set to
    // the struct size required by GetLastInputInfo.
    if unsafe { GetLastInputInfo(&mut lii) }.as_bool() {
        // SAFETY: GetTickCount reads the current Windows uptime tick and does
        // not require any pointer or handle ownership from this process.
        let now = unsafe { GetTickCount() };
        (now.wrapping_sub(lii.dwTime)) as u64
    } else {
        0
    }
}

#[cfg(target_os = "windows")]
fn is_webcam_in_use_windows() -> bool {
    // Check via PowerShell whether any process is using the camera.
    // Windows 10+ tracks camera usage in the registry.
    let output = fixed_command_output(
        "powershell",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            r#"Get-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam\*\*' -Name LastUsedTimeStop -ErrorAction SilentlyContinue | Where-Object { $_.LastUsedTimeStop -eq 0 } | Measure-Object | Select-Object -ExpandProperty Count"#,
        ],
        128,
    );
    output
        .ok()
        .and_then(|stdout| stdout.trim().parse::<u32>().ok())
        .unwrap_or(0)
        > 0
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn get_idle_status() -> IdleStatus {
    IdleStatus {
        idle_ms: get_idle_time_ms_windows(),
        webcam_in_use: is_webcam_in_use_windows(),
    }
}

// ── macOS idle detection ─────────────────────────────────────────

#[cfg(target_os = "macos")]
fn get_idle_time_ms_macos() -> u64 {
    // Read HIDIdleTime from IOKit via ioreg. Returns nanoseconds of idle time.
    let stdout =
        match fixed_command_output("ioreg", &["-c", "IOHIDSystem", "-d", "4", "-S"], 256 * 1024) {
            Ok(stdout) => stdout,
            Err(_) => return 0,
        };
    for line in stdout.lines() {
        if let Some(pos) = line.find("\"HIDIdleTime\"") {
            // Format: "HIDIdleTime" = 1234567890
            if let Some(eq) = line[pos..].find('=') {
                let val_str = line[pos + eq + 1..].trim();
                if let Ok(ns) = val_str.parse::<u64>() {
                    return ns / 1_000_000; // nanoseconds to milliseconds
                }
            }
        }
    }
    0
}

#[cfg(target_os = "macos")]
fn is_webcam_in_use_macos() -> bool {
    // On macOS, VDCAssistant or AppleCameraAssistant runs when the camera is active.
    // On Apple Silicon Macs, the process may be called "appleh13camerad".
    ["VDCAssistant", "AppleCameraAssistant", "appleh13camerad"]
        .iter()
        .any(|process_name| fixed_command_status("pgrep", &["-x", process_name]))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn get_idle_status() -> IdleStatus {
    IdleStatus {
        idle_ms: get_idle_time_ms_macos(),
        webcam_in_use: is_webcam_in_use_macos(),
    }
}

// ── Fallback (mobile / unknown) ──────────────────────────────────

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
#[tauri::command]
pub fn get_idle_status() -> IdleStatus {
    IdleStatus {
        idle_ms: 0,
        webcam_in_use: false,
    }
}

// ── Alert sound ──────────────────────────────────────────────────

#[tauri::command]
pub fn play_app_sound(
    sound_id: String,
    app_sounds: State<'_, AppSoundState>,
) -> Result<(), String> {
    let sound = AppSound::from_id(&sound_id)?;
    app_sounds.play(sound);
    Ok(())
}

#[tauri::command]
pub fn play_alert_sound(app_sounds: State<'_, AppSoundState>) {
    app_sounds.play(AppSound::EventNotification);
}

#[tauri::command]
pub fn show_event_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    open_calendar: Option<bool>,
    play_sound: Option<bool>,
    app_sounds: State<'_, AppSoundState>,
) {
    if play_sound.unwrap_or(true) {
        app_sounds.play(AppSound::EventNotification);
    }
    std::thread::spawn(move || {
        let summary = notification_summary(&title);
        let body = escape_notification_markup(&body);
        let opens_calendar = open_calendar.unwrap_or(false);
        let action_label = if opens_calendar {
            "Open calendar"
        } else {
            "Open Ganbaru AI"
        };
        let result = Notification::new()
            .appname("Ganbaru AI")
            .summary(&summary)
            .body(&body)
            .action("open", action_label)
            .timeout(15_000)
            .hint(Hint::Category("calendar".into()))
            .hint(Hint::DesktopEntry("ganbaru-ai".into()))
            .hint(Hint::Transient(true))
            .show();

        match result {
            Ok(handle) => {
                handle.wait_for_action(|action| {
                    if action == "open" || action == "default" {
                        if opens_calendar {
                            let _ = app.emit("calendar-notification-open", ());
                        }
                        focus_main_window(app.clone());
                    }
                });
            }
            Err(e) => {
                eprintln!("Failed to show event notification: {e}");
            }
        }
    });
}

#[tauri::command]
pub fn show_benchmark_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    app_sounds: State<'_, AppSoundState>,
) {
    app_sounds.play(AppSound::EventNotification);
    std::thread::spawn(move || {
        let result = Notification::new()
            .summary(&title)
            .body(&body)
            .action("show_summary", "Show summary")
            .timeout(10_000)
            .id(9002)
            .hint(Hint::Transient(true))
            .show();

        match result {
            Ok(handle) => {
                handle.wait_for_action(|action| {
                    if action == "show_summary" || action == "default" {
                        focus_main_window(app.clone());
                    }
                });
            }
            Err(e) => {
                eprintln!("Failed to show benchmark notification: {e}");
            }
        }
    });
}

#[tauri::command]
pub fn show_doomscrolling_desktop_block_notification(
    app: tauri::AppHandle,
    app_name: String,
    app_sounds: State<'_, AppSoundState>,
) {
    app_sounds.play(AppSound::EventNotification);
    std::thread::spawn(move || {
        let app_name = app_name
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .chars()
            .take(80)
            .collect::<String>();
        let app_name = if app_name.is_empty() {
            "The blocked app".to_string()
        } else {
            app_name
        };
        let body = escape_notification_markup(&format!(
            "{app_name} was closed because it is blocked by your desktop rules. Change this in Settings > Doomscrolling > Desktop apps (or click this notification)"
        ));
        let result = Notification::new()
            .appname("Ganbaru AI")
            .summary("App closed by Ganbaru AI")
            .body(&body)
            .action("default", "Open desktop apps")
            .timeout(10_000)
            .hint(Hint::Category("device".into()))
            .hint(Hint::DesktopEntry("ganbaru-ai".into()))
            .hint(Hint::Transient(true))
            .show();

        match result {
            Ok(handle) => {
                handle.wait_for_action(|action| {
                    if action == "default" {
                        let _ = app.emit("doomscrolling-open-desktop-settings", ());
                        focus_main_window(app.clone());
                    }
                });
            }
            Err(e) => {
                eprintln!("Failed to show doomscrolling desktop block notification: {e}");
            }
        }
    });
}

#[tauri::command]
pub fn show_doomscrolling_desktop_limit_notification(
    app: tauri::AppHandle,
    app_name: String,
    limit_name: String,
    app_sounds: State<'_, AppSoundState>,
) {
    app_sounds.play(AppSound::EventNotification);
    std::thread::spawn(move || {
        let app_name = app_name
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .chars()
            .take(80)
            .collect::<String>();
        let app_name = if app_name.is_empty() {
            "The app".to_string()
        } else {
            app_name
        };
        let limit_name = limit_name
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .chars()
            .take(80)
            .collect::<String>();
        let limit_name = if limit_name.is_empty() {
            "a usage limit".to_string()
        } else {
            limit_name
        };
        let body = escape_notification_markup(&format!(
            "{app_name} was closed because {limit_name} reached its limit. Change this in Settings > Doomscrolling > Limits (or click this notification)"
        ));
        let result = Notification::new()
            .appname("Ganbaru AI")
            .summary("Usage limit reached")
            .body(&body)
            .action("default", "Open limits")
            .timeout(10_000)
            .hint(Hint::Category("device".into()))
            .hint(Hint::DesktopEntry("ganbaru-ai".into()))
            .hint(Hint::Transient(true))
            .show();

        match result {
            Ok(handle) => {
                handle.wait_for_action(|action| {
                    if action == "default" {
                        let _ = app.emit("doomscrolling-open-limits-settings", ());
                        focus_main_window(app.clone());
                    }
                });
            }
            Err(e) => {
                eprintln!("Failed to show doomscrolling desktop limit notification: {e}");
            }
        }
    });
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn known_keys() -> HashMap<String, HashSet<String>> {
        HashMap::from([(
            "org.gnome.desktop.wm.keybindings".to_string(),
            HashSet::from(["close".to_string(), "switch-applications".to_string()]),
        )])
    }

    fn valid_saved_shortcuts() -> SavedShortcuts {
        SavedShortcuts {
            overlay_key: "'Super_L'".to_string(),
            dock_hotkeys: "true".to_string(),
            disabled: vec![(
                "org.gnome.desktop.wm.keybindings".to_string(),
                "close".to_string(),
                "['<Alt>F4']".to_string(),
            )],
        }
    }

    #[test]
    fn app_sound_ids_cover_wired_sounds() {
        for id in [
            "event-notification",
            "idle-alert",
            "focus-session-failed-long-idle",
            "focus-ending-warning",
            "break-start",
            "break-finished",
            "event-finished",
            "pomodoro-day-complete",
            "pomodoro-workweek-complete",
        ] {
            assert!(AppSound::from_id(id).is_ok(), "{id} should be wired");
        }

        assert!(AppSound::from_id("ai-response-finished").is_err());
    }

    #[test]
    fn pomodoro_overlay_visual_states_have_expected_backgrounds() {
        assert_eq!(
            PomodoroOverlayVisualState::from_id("idle")
                .unwrap()
                .background_color(),
            OverlayColor {
                red: 0xA3,
                green: 0x37,
                blue: 0x28,
            }
        );
        assert_eq!(
            PomodoroOverlayVisualState::from_id("break_countdown")
                .unwrap()
                .background_color(),
            OverlayColor {
                red: 0x03,
                green: 0x5B,
                blue: 0x33,
            }
        );
        assert_eq!(
            PomodoroOverlayVisualState::from_id("break_finished")
                .unwrap()
                .background_color(),
            OverlayColor {
                red: 0x0E,
                green: 0x74,
                blue: 0x90,
            }
        );
        assert_eq!(
            PomodoroOverlayVisualState::from_id("day_complete")
                .unwrap()
                .background_color(),
            OverlayColor {
                red: 0xEE,
                green: 0xBA,
                blue: 0x04,
            }
        );
        assert_eq!(
            PomodoroOverlayVisualState::from_id("workweek_complete")
                .unwrap()
                .background_color(),
            OverlayColor {
                red: 0x1D,
                green: 0x4E,
                blue: 0xD8,
            }
        );
    }

    #[test]
    fn pomodoro_completion_kinds_map_to_visual_states() {
        assert_eq!(
            completion_visual_state_from_kind("event").unwrap(),
            PomodoroOverlayVisualState::EventFinished
        );
        assert_eq!(
            completion_visual_state_from_kind("day").unwrap(),
            PomodoroOverlayVisualState::DayComplete
        );
        assert_eq!(
            completion_visual_state_from_kind("workweek").unwrap(),
            PomodoroOverlayVisualState::WorkweekComplete
        );
        assert!(completion_visual_state_from_kind("unknown").is_err());
    }

    #[test]
    fn break_end_esc_presses_accepts_supported_values_and_disabled() {
        assert_eq!(normalize_break_end_esc_presses(None), None);
        assert_eq!(normalize_break_end_esc_presses(Some(1)), Some(1));
        assert_eq!(normalize_break_end_esc_presses(Some(3)), Some(3));
        assert_eq!(normalize_break_end_esc_presses(Some(10)), Some(10));
        assert_eq!(normalize_break_end_esc_presses(Some(20)), Some(20));
        assert_eq!(normalize_break_end_esc_presses(Some(50)), Some(50));
        assert_eq!(normalize_break_end_esc_presses(Some(2)), Some(10));
    }

    fn unique_restore_file(name: &str) -> PathBuf {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is before Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "ganbaru-ai-{name}-{}-{now}.json",
            std::process::id()
        ))
    }

    #[test]
    fn restore_validation_accepts_known_schema_and_key() {
        assert!(validate_saved_shortcuts(&valid_saved_shortcuts(), &known_keys()).is_ok());
    }

    #[test]
    fn restore_validation_rejects_unknown_schema() {
        let mut saved = valid_saved_shortcuts();
        saved.disabled[0].0 = "org.gnome.unknown.keybindings".to_string();

        assert!(validate_saved_shortcuts(&saved, &known_keys()).is_err());
    }

    #[test]
    fn restore_validation_rejects_unknown_key() {
        let mut saved = valid_saved_shortcuts();
        saved.disabled[0].1 = "launch-terminal".to_string();

        assert!(validate_saved_shortcuts(&saved, &known_keys()).is_err());
    }

    #[test]
    fn restore_validation_rejects_oversized_values() {
        let mut saved = valid_saved_shortcuts();
        saved.disabled[0].2 = "x".repeat(SHORTCUT_RESTORE_VALUE_MAX_BYTES + 1);

        assert!(validate_saved_shortcuts(&saved, &known_keys()).is_err());
    }

    #[test]
    fn restore_validation_rejects_unsafe_command_targets() {
        assert!(is_allowed_gsettings_restore_target(
            "org.gnome.desktop.wm.keybindings",
            "close"
        ));
        assert!(!is_allowed_gsettings_restore_target(
            "org.gnome.desktop.wm.keybindings",
            "Close"
        ));
        assert!(!is_allowed_gsettings_restore_target(
            "org.gnome.unknown.keybindings",
            "close"
        ));
    }

    #[test]
    fn malformed_restore_file_is_deleted_without_validation() {
        let path = unique_restore_file("malformed-shortcuts");
        std::fs::write(&path, "{not valid json").expect("restore fixture should be writable");

        assert!(read_saved_shortcuts_file_or_clear(&path).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn invalid_restore_file_is_deleted_before_apply() {
        let path = unique_restore_file("invalid-shortcuts");
        let mut saved = valid_saved_shortcuts();
        saved.disabled[0].1 = "unknown-key".to_string();
        std::fs::write(
            &path,
            serde_json::to_string(&saved).expect("restore fixture should serialize"),
        )
        .expect("restore fixture should be writable");

        let saved = read_saved_shortcuts_file_or_clear(&path).expect("fixture should parse");
        assert!(validate_saved_shortcuts_or_clear(&path, saved, &known_keys()).is_err());
        assert!(!path.exists());
    }
}

fn focus_main_window(app: tauri::AppHandle) {
    let app_for_lookup = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = app_for_lookup.get_webview_window("main") {
            if let Err(e) = window.show() {
                eprintln!("Failed to show main window from notification: {e}");
            }
            if let Err(e) = window.unminimize() {
                eprintln!("Failed to unminimize main window from notification: {e}");
            }
            if let Err(e) = window.set_always_on_top(true) {
                eprintln!("Failed to raise main window from notification: {e}");
            }
            let reset_app = app_for_lookup.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(250));
                let app_for_reset = reset_app.clone();
                let _ = reset_app.run_on_main_thread(move || {
                    if let Some(window) = app_for_reset.get_webview_window("main") {
                        if let Err(e) = window.set_always_on_top(false) {
                            eprintln!("Failed to restore main window stacking mode: {e}");
                        }
                    }
                });
            });
            if let Err(e) = window.set_focus() {
                eprintln!("Failed to focus main window from notification: {e}");
            }
        }
    });
}

fn escape_notification_markup(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn notification_summary(value: &str) -> String {
    let summary = value.lines().next().unwrap_or("").trim();
    if summary.is_empty() {
        "Calendar event".to_string()
    } else {
        escape_notification_markup(summary)
    }
}

#[tauri::command]
pub fn show_pomodoro_notification(
    app: tauri::AppHandle,
    remaining_seconds: u32,
    allow_add_time: Option<bool>,
    app_sounds: State<'_, AppSoundState>,
) {
    let timeout_ms = remaining_seconds * 1000;

    app_sounds.play(AppSound::FocusEndingWarning);
    std::thread::spawn(move || {
        let mut notification = Notification::new();
        notification.summary("Focus session ending in 1 minute");
        if allow_add_time.unwrap_or(true) {
            notification.action("add_time", "Extend focus 3 minutes");
        }
        let result = notification
            .timeout(timeout_ms as i32)
            .id(9001)
            .hint(Hint::Transient(true))
            .show();

        match result {
            Ok(handle) => {
                handle.wait_for_action(|action| {
                    if action == "add_time" {
                        let _ = app.emit("pomodoro-add-time", AddTimePayload { seconds: 180 });
                    }
                });
            }
            Err(e) => {
                eprintln!("Failed to show notification: {e}");
            }
        }
    });
}

#[tauri::command]
pub fn show_paused_focus_notification(app: tauri::AppHandle, app_sounds: State<'_, AppSoundState>) {
    app_sounds.play(AppSound::EventNotification);
    std::thread::spawn(move || {
        let result = Notification::new()
            .appname("Ganbaru AI")
            .summary("Focus session is paused")
            .body("Your focus session is still paused.")
            .action("resume", "Resume focus")
            .action("stop_asking", "Stop asking")
            .timeout(15_000)
            .id(9003)
            .hint(Hint::Category("reminder".into()))
            .hint(Hint::DesktopEntry("ganbaru-ai".into()))
            .hint(Hint::Transient(true))
            .show();

        match result {
            Ok(handle) => {
                handle.wait_for_action(|action| match action {
                    "resume" => {
                        let _ = app.emit("pomodoro-paused-focus-resume", ());
                    }
                    "stop_asking" => {
                        let _ = app.emit("pomodoro-paused-focus-stop-asking", ());
                    }
                    "default" => {
                        focus_main_window(app.clone());
                    }
                    _ => {}
                });
            }
            Err(e) => {
                eprintln!("Failed to show paused focus notification: {e}");
            }
        }
    });
}
