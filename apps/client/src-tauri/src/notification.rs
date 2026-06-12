use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{window::Color, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

use crate::pomodoro_enforcement::{
    reinforce_overlay_windows, start_overlay_enforcement, OverlayEnforcementGuard,
    OverlayReconcileGuard,
};

pub(crate) mod commands;
pub(crate) mod idle;
pub(crate) mod shortcuts;
mod sounds;

pub(crate) use shortcuts::restore_stale_shortcuts;
pub(crate) use sounds::{AppSound, AppSoundState};

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

#[cfg(any(target_os = "linux", target_os = "macos"))]
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
#[cfg(target_os = "linux")]
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
        extension_limit: Option<u32>,
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

#[cfg(target_os = "linux")]
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
                red: 0xEE,
                green: 0xBA,
                blue: 0x04,
            },
            Self::EventFinished => OverlayColor {
                red: 0x0E,
                green: 0x74,
                blue: 0x90,
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
        match shortcuts::disable_overlay_shortcuts(app) {
            Ok(cleanup) => {
                enforcement.push_cleanup(move || {
                    cleanup.restore();
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
            extension_limit,
        } => {
            let end_esc_presses = end_esc_presses
                .map(|presses| presses.to_string())
                .unwrap_or_else(|| "disabled".to_string());
            let extension_limit = extension_limit
                .map(|limit| limit.to_string())
                .unwrap_or_else(|| "disabled".to_string());
            format!(
                "index.html?ganbaruWindow=pomodoroOverlay&overlayKind=break&breakEndsAtMs={ends_at_ms}&breakEndEscPresses={end_esc_presses}&breakExtensionLimit={extension_limit}"
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
    } else {
        #[cfg(target_os = "linux")]
        {
            build_svelte_overlay_window(
                app,
                POMODORO_OVERLAY_MAIN_LABEL,
                overlay_url(kind),
                "Ganbaru AI pomodoro",
                primary_monitor,
                background_color,
                true,
            )?;
        }

        #[cfg(not(target_os = "linux"))]
        {
            build_svelte_overlay_window(
                app,
                POMODORO_OVERLAY_MAIN_LABEL,
                overlay_url(kind),
                "Ganbaru AI pomodoro",
                primary_monitor,
                background_color,
                true,
            )
            .map_err(|err| {
                for label in created_labels {
                    destroy_existing_window(app, &label);
                }
                err
            })?;
        }
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
    break_extension_limit: Option<u32>,
) -> Result<(), String> {
    show_pomodoro_overlay(
        app,
        PomodoroOverlayKind::Break {
            ends_at_ms: break_ends_at_ms,
            end_esc_presses: normalize_break_end_esc_presses(break_end_esc_presses),
            extension_limit: normalize_break_extension_limit(break_extension_limit),
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

fn normalize_break_extension_limit(value: Option<u32>) -> Option<u32> {
    match value {
        Some(1 | 3 | 5 | 10 | 15) => value,
        Some(_) => Some(3),
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

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::shortcuts::{
        is_allowed_gsettings_restore_target, read_saved_shortcuts_file_or_clear,
        validate_saved_shortcuts, validate_saved_shortcuts_or_clear, SavedShortcuts,
        SHORTCUT_RESTORE_VALUE_MAX_BYTES,
    };
    use super::*;
    use std::collections::{HashMap, HashSet};
    use std::path::PathBuf;

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
                red: 0xEE,
                green: 0xBA,
                blue: 0x04,
            }
        );
        assert_eq!(
            PomodoroOverlayVisualState::from_id("event_finished")
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

    #[test]
    fn break_extension_limit_accepts_supported_values_and_disabled() {
        assert_eq!(normalize_break_extension_limit(None), None);
        assert_eq!(normalize_break_extension_limit(Some(1)), Some(1));
        assert_eq!(normalize_break_extension_limit(Some(3)), Some(3));
        assert_eq!(normalize_break_extension_limit(Some(5)), Some(5));
        assert_eq!(normalize_break_extension_limit(Some(10)), Some(10));
        assert_eq!(normalize_break_extension_limit(Some(15)), Some(15));
        assert_eq!(normalize_break_extension_limit(Some(2)), Some(3));
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
