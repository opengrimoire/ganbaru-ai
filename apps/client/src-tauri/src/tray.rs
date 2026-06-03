use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, Mutex};
use tauri::{
    image::Image,
    menu::{Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

const ICON_SIZE: u32 = 32;
const RING_WIDTH: f64 = 3.5;
const RING_REMAINING_COLOR: (u8, u8, u8) = (240, 240, 240);
const RING_EMPTY_COLOR: (u8, u8, u8) = (90, 90, 90);
const PAUSED_PULSE_FRAME_COUNT: u8 = 22;
const PAUSED_PULSE_AMOUNTS: [f64; 22] = [
    0.0, 0.0, 0.0, 0.0, 0.0, 0.067, 0.25, 0.5, 0.75, 0.933, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.933,
    0.75, 0.5, 0.25, 0.067, 0.0,
];
const MUSIC_TRAY_STATUS_MAX_CHARS: usize = 25;
#[cfg(target_os = "linux")]
const LINUX_TRAY_ICON_VERSION: u8 = 6;

#[derive(Debug, Clone)]
struct PomodoroTrayState {
    phase: String,
    remaining_seconds: u32,
    total_seconds: u32,
    is_running: bool,
    is_active: bool,
    can_pause_resume: bool,
    can_add_focus_time: bool,
    paused_pulse_frame: Option<u8>,
}

#[derive(Debug, Clone)]
struct MusicTrayState {
    status: String,
    title: Option<String>,
    can_play_pause: bool,
    can_previous: bool,
    can_next: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroTrayUpdate {
    phase: String,
    remaining_seconds: u32,
    total_seconds: u32,
    is_running: bool,
    is_active: bool,
    can_pause_resume: bool,
    can_add_focus_time: bool,
    paused_pulse_frame: Option<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrayUpdate {
    status: String,
    title: Option<String>,
    can_play_pause: bool,
    can_previous: bool,
    can_next: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AddFocusTimePayload {
    seconds: u32,
}

#[derive(Debug, Clone)]
struct TrayState {
    pomodoro: PomodoroTrayState,
    music: MusicTrayState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MenuShape {
    pomodoro_active: bool,
    pomodoro_phase_id: u8,
    pomodoro_running: bool,
    pomodoro_can_pause_resume: bool,
    pomodoro_can_add_focus_time: bool,
    music_status: String,
    music_title: Option<String>,
    music_can_play_pause: bool,
    music_can_previous: bool,
    music_can_next: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayIconKey {
    Empty,
    Progress(u8),
    PausedProgress { step: u8, frame: u8 },
}

static TRAY_STATE: LazyLock<Mutex<TrayState>> = LazyLock::new(|| {
    Mutex::new(TrayState {
        pomodoro: PomodoroTrayState {
            phase: "idle".to_string(),
            remaining_seconds: 0,
            total_seconds: 0,
            is_running: false,
            is_active: false,
            can_pause_resume: false,
            can_add_focus_time: false,
            paused_pulse_frame: None,
        },
        music: MusicTrayState {
            status: "idle".to_string(),
            title: None,
            can_play_pause: false,
            can_previous: false,
            can_next: false,
        },
    })
});

/// Track last icon state to avoid unnecessary set_icon calls.
static LAST_ICON_KEY: Mutex<TrayIconKey> = Mutex::new(TrayIconKey::Empty);
static LAST_MENU_SHAPE: LazyLock<Mutex<Option<MenuShape>>> = LazyLock::new(|| Mutex::new(None));
static POMODORO_STATUS_ITEM: Mutex<Option<MenuItem<tauri::Wry>>> = Mutex::new(None);
static MUSIC_STATUS_ITEM: Mutex<Option<MenuItem<tauri::Wry>>> = Mutex::new(None);

fn ring_progress_color(paused_pulse_frame: Option<u8>) -> (u8, u8, u8) {
    let Some(frame) = paused_pulse_frame else {
        return RING_REMAINING_COLOR;
    };
    let amount = PAUSED_PULSE_AMOUNTS[(frame % PAUSED_PULSE_FRAME_COUNT) as usize];
    let mix = |from: u8, to: u8| -> u8 {
        (from as f64 + (to as f64 - from as f64) * amount)
            .round()
            .clamp(0.0, 255.0) as u8
    };
    (
        mix(RING_REMAINING_COLOR.0, RING_EMPTY_COLOR.0),
        mix(RING_REMAINING_COLOR.1, RING_EMPTY_COLOR.1),
        mix(RING_REMAINING_COLOR.2, RING_EMPTY_COLOR.2),
    )
}

fn normalized_paused_pulse_frame(frame: Option<u8>) -> Option<u8> {
    frame.map(|value| value % PAUSED_PULSE_FRAME_COUNT)
}

/// Render a progress ring icon as raw RGBA pixels.
fn render_progress_icon(progress: f64, active: bool) -> Vec<u8> {
    render_progress_icon_with_pause(progress, active, None)
}

fn render_progress_icon_with_pause(
    progress: f64,
    active: bool,
    paused_pulse_frame: Option<u8>,
) -> Vec<u8> {
    let size = ICON_SIZE as usize;
    let mut pixels = vec![0u8; size * size * 4];
    let center = size as f64 / 2.0;
    let outer_r = center - 0.5;
    let inner_r = outer_r - RING_WIDTH;

    let progress_color = ring_progress_color(paused_pulse_frame);
    let progress = normalize_progress(progress);

    for y in 0..size {
        for x in 0..size {
            let dx = x as f64 - center;
            let dy = y as f64 - center;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist >= inner_r - 0.5 && dist <= outer_r + 0.5 {
                let aa_outer = (outer_r + 0.5 - dist).clamp(0.0, 1.0);
                let aa_inner = (dist - (inner_r - 0.5)).clamp(0.0, 1.0);
                let alpha = (aa_outer * aa_inner * 255.0) as u8;

                let (r, g, b) = if active {
                    let angle = (-dx).atan2(-dy);
                    let normalized = (angle + std::f64::consts::PI) / (2.0 * std::f64::consts::PI);
                    let normalized = (normalized + 0.5) % 1.0;

                    if normalized <= progress {
                        RING_EMPTY_COLOR
                    } else {
                        progress_color
                    }
                } else {
                    RING_EMPTY_COLOR
                };

                let idx = (y * size + x) * 4;
                pixels[idx] = r;
                pixels[idx + 1] = g;
                pixels[idx + 2] = b;
                pixels[idx + 3] = alpha;
            }
        }
    }
    pixels
}

fn normalize_progress(progress: f64) -> f64 {
    if progress.is_finite() {
        progress.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

fn format_tray_time(secs: u32) -> String {
    let mins = secs / 60;
    let s = secs % 60;
    format!("{mins}:{s:02}")
}

fn phase_id(phase: &str) -> u8 {
    match phase {
        "focus" => 0,
        "short_break" => 1,
        "long_break" => 2,
        _ => 3,
    }
}

fn phase_label(phase: &str) -> &'static str {
    match phase {
        "focus" => "Focus",
        "short_break" => "Short break",
        "long_break" => "Long break",
        _ => "Idle",
    }
}

fn phase_advance_label(phase: &str) -> &'static str {
    match phase {
        "focus" => "Go to break now",
        "short_break" | "long_break" => "Start focus now",
        _ => "Go to break now",
    }
}

fn music_status_label(status: &str) -> &'static str {
    match status {
        "playing" => "Playing",
        "paused" => "Paused",
        "loading" => "Loading",
        "ready" => "Ready",
        "ended" => "Ended",
        "error" => "Error",
        _ => "Idle",
    }
}

fn pomodoro_active(state: &PomodoroTrayState) -> bool {
    state.is_active
}

fn pomodoro_progress(state: &PomodoroTrayState) -> f64 {
    if state.total_seconds > 0 {
        1.0 - (state.remaining_seconds as f64 / state.total_seconds as f64)
    } else {
        0.0
    }
}

fn tray_icon_key(progress: f64, active: bool, paused_pulse_frame: Option<u8>) -> TrayIconKey {
    let progress = normalize_progress(progress);
    if !active || progress >= 1.0 {
        return TrayIconKey::Empty;
    }

    let step = (progress * 100.0) as u8;
    if let Some(frame) = normalized_paused_pulse_frame(paused_pulse_frame) {
        TrayIconKey::PausedProgress { step, frame }
    } else {
        TrayIconKey::Progress(step)
    }
}

fn pomodoro_status_text(state: &PomodoroTrayState) -> String {
    if pomodoro_active(state) {
        format!("{} left", format_tray_time(state.remaining_seconds))
    } else {
        "No active session".to_string()
    }
}

fn music_status_text(state: &MusicTrayState) -> String {
    let title = state
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty());
    if let Some(title) = title {
        return title.to_string();
    }
    if state.can_play_pause || state.status != "idle" {
        music_status_label(&state.status).to_string()
    } else {
        "No music loaded".to_string()
    }
}

fn truncate_tray_menu_label(value: &str, max_chars: usize) -> String {
    let char_count = value.chars().count();
    if char_count <= max_chars {
        return value.to_string();
    }

    let prefix_chars = max_chars.saturating_sub(3);
    let mut label = value.chars().take(prefix_chars).collect::<String>();
    label = label.trim_end().to_string();
    label.push_str("...");
    label
}

fn music_menu_status_text(state: &MusicTrayState) -> String {
    truncate_tray_menu_label(&music_status_text(state), MUSIC_TRAY_STATUS_MAX_CHARS)
}

fn tray_tooltip(state: &TrayState) -> String {
    let pomodoro = if pomodoro_active(&state.pomodoro) {
        format!(
            "{} {}",
            phase_label(&state.pomodoro.phase),
            format_tray_time(state.pomodoro.remaining_seconds)
        )
    } else {
        "No active session".to_string()
    };
    let music = music_status_text(&state.music);
    format!("Ganbaru AI\n{pomodoro}\n{music}")
}

fn menu_shape(state: &TrayState) -> MenuShape {
    MenuShape {
        pomodoro_active: pomodoro_active(&state.pomodoro),
        pomodoro_phase_id: phase_id(&state.pomodoro.phase),
        pomodoro_running: state.pomodoro.is_running,
        pomodoro_can_pause_resume: state.pomodoro.can_pause_resume,
        pomodoro_can_add_focus_time: state.pomodoro.can_add_focus_time,
        music_status: state.music.status.clone(),
        music_title: state.music.title.clone(),
        music_can_play_pause: state.music.can_play_pause,
        music_can_previous: state.music.can_previous,
        music_can_next: state.music.can_next,
    }
}

fn pomodoro_paused_pulse_frame(state: &PomodoroTrayState) -> Option<u8> {
    if state.phase != "focus" || !state.is_active || state.is_running {
        return None;
    }
    normalized_paused_pulse_frame(state.paused_pulse_frame)
}

fn build_menu(app: &AppHandle, state: &TrayState) -> Result<Menu<tauri::Wry>, String> {
    let pomodoro_status = MenuItemBuilder::with_id("status", pomodoro_status_text(&state.pomodoro))
        .enabled(false)
        .build(app)
        .map_err(|e| e.to_string())?;
    {
        let mut stored = POMODORO_STATUS_ITEM.lock().unwrap();
        *stored = Some(pomodoro_status.clone());
    }

    let music_status =
        MenuItemBuilder::with_id("music_status", music_menu_status_text(&state.music))
            .enabled(false)
            .build(app)
            .map_err(|e| e.to_string())?;
    {
        let mut stored = MUSIC_STATUS_ITEM.lock().unwrap();
        *stored = Some(music_status.clone());
    }

    let pomodoro_active = pomodoro_active(&state.pomodoro);
    let pause_resume_label = if state.pomodoro.is_running {
        "Pause focus"
    } else {
        "Resume focus"
    };
    let pause_resume_item = MenuItemBuilder::with_id("pause_resume", pause_resume_label)
        .enabled(state.pomodoro.can_pause_resume)
        .build(app)
        .map_err(|e| e.to_string())?;
    let add_focus_time_item = MenuItemBuilder::with_id("add_focus_time", "Extend focus 3 minutes")
        .enabled(state.pomodoro.can_add_focus_time)
        .build(app)
        .map_err(|e| e.to_string())?;
    let skip_item = MenuItemBuilder::with_id("skip", phase_advance_label(&state.pomodoro.phase))
        .enabled(pomodoro_active)
        .build(app)
        .map_err(|e| e.to_string())?;

    let separator = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let play_pause_label = if state.music.status == "playing" {
        "Pause music"
    } else {
        "Play music"
    };
    let play_pause_item = MenuItemBuilder::with_id("music_play_pause", play_pause_label)
        .enabled(state.music.can_play_pause)
        .build(app)
        .map_err(|e| e.to_string())?;
    let previous_item = MenuItemBuilder::with_id("music_previous", "Previous music")
        .enabled(state.music.can_previous)
        .build(app)
        .map_err(|e| e.to_string())?;
    let next_item = MenuItemBuilder::with_id("music_next", "Next music")
        .enabled(state.music.can_next)
        .build(app)
        .map_err(|e| e.to_string())?;
    let open_music_item = MenuItemBuilder::with_id("music_open", "Open music")
        .build(app)
        .map_err(|e| e.to_string())?;

    MenuBuilder::new(app)
        .item(&pomodoro_status)
        .item(&pause_resume_item)
        .item(&add_focus_time_item)
        .item(&skip_item)
        .item(&separator)
        .item(&music_status)
        .item(&play_pause_item)
        .item(&previous_item)
        .item(&next_item)
        .item(&open_music_item)
        .build()
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn linux_tray_icon_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let mut path = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    path.push("tray-icons");
    std::fs::create_dir_all(&path).map_err(|e| format!("create tray icon cache: {e}"))?;
    Ok(path)
}

#[cfg(target_os = "linux")]
fn linux_tray_icon_name(icon_key: TrayIconKey) -> String {
    match icon_key {
        TrayIconKey::Empty => format!("ganbaru-ai-tray-v{LINUX_TRAY_ICON_VERSION}-empty.png"),
        TrayIconKey::Progress(step) => {
            format!("ganbaru-ai-tray-v{LINUX_TRAY_ICON_VERSION}-progress-{step:03}.png")
        }
        TrayIconKey::PausedProgress { step, frame } => {
            format!(
                "ganbaru-ai-tray-v{LINUX_TRAY_ICON_VERSION}-progress-{step:03}-pause-{frame}.png"
            )
        }
    }
}

#[cfg(target_os = "linux")]
fn write_linux_tray_icon(path: &std::path::Path, pixels: Vec<u8>) -> Result<(), String> {
    use gtk::gdk_pixbuf::{Colorspace, Pixbuf};

    if path.exists() {
        return Ok(());
    }

    let pixbuf = Pixbuf::from_mut_slice(
        pixels,
        Colorspace::Rgb,
        true,
        8,
        ICON_SIZE as i32,
        ICON_SIZE as i32,
        (ICON_SIZE * 4) as i32,
    );
    pixbuf
        .savev(path, "png", &[])
        .map_err(|e| format!("write tray icon png: {e}"))
}

#[cfg(target_os = "linux")]
fn set_tray_icon(
    app: &AppHandle,
    tray: &tauri::tray::TrayIcon<tauri::Wry>,
    icon_key: TrayIconKey,
    pixels: Vec<u8>,
) -> Result<(), String> {
    let dir = linux_tray_icon_dir(app)?;
    let path = dir.join(linux_tray_icon_name(icon_key));
    write_linux_tray_icon(&path, pixels)?;

    let parent_path = dir.to_string_lossy().into_owned();
    let icon_path = path.to_string_lossy().into_owned();
    tray.with_inner_tray_icon(move |inner| {
        // Tauri's Linux set_icon path removes the current PNG before
        // publishing the next one. Updating AppIndicator after the next PNG
        // exists avoids Ubuntu showing its missing-icon placeholder.
        unsafe {
            let indicator = &mut *inner.app_indicator().cast_mut();
            indicator.set_icon_theme_path(&parent_path);
            indicator.set_icon_full(&icon_path, "tray icon");
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "linux"))]
fn set_tray_icon(
    _app: &AppHandle,
    tray: &tauri::tray::TrayIcon<tauri::Wry>,
    _icon_key: TrayIconKey,
    pixels: Vec<u8>,
) -> Result<(), String> {
    let icon = Image::new_owned(pixels, ICON_SIZE, ICON_SIZE);
    tray.set_icon(Some(icon)).map_err(|e| e.to_string())
}

fn apply_tray_state(app: &AppHandle, state: &TrayState) -> Result<(), String> {
    let tray = app.tray_by_id("main").ok_or("No tray icon found")?;

    let progress = pomodoro_progress(&state.pomodoro);
    let active = pomodoro_active(&state.pomodoro);
    let paused_pulse_frame = pomodoro_paused_pulse_frame(&state.pomodoro);
    let icon_key = tray_icon_key(progress, active, paused_pulse_frame);
    {
        let mut last = LAST_ICON_KEY.lock().unwrap();
        if *last != icon_key {
            *last = icon_key;
            let pixels = render_progress_icon_with_pause(progress, active, paused_pulse_frame);
            set_tray_icon(app, &tray, icon_key, pixels)?;
        }
    }

    tray.set_tooltip(Some(&tray_tooltip(state)))
        .map_err(|e| e.to_string())?;

    {
        let item = POMODORO_STATUS_ITEM.lock().unwrap();
        if let Some(ref status_item) = *item {
            let _ = status_item.set_text(pomodoro_status_text(&state.pomodoro));
        }
    }
    {
        let item = MUSIC_STATUS_ITEM.lock().unwrap();
        if let Some(ref status_item) = *item {
            let _ = status_item.set_text(music_menu_status_text(&state.music));
        }
    }

    let shape = menu_shape(state);
    let should_rebuild = {
        let mut last = LAST_MENU_SHAPE.lock().unwrap();
        if last.as_ref() == Some(&shape) {
            false
        } else {
            *last = Some(shape);
            true
        }
    };
    if should_rebuild {
        let menu = build_menu(app, state)?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Initialize the system tray with a combined Pomodoro and Music menu.
pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let idle_icon = render_progress_icon(0.0, false);
    let icon = Image::new_owned(idle_icon, ICON_SIZE, ICON_SIZE);
    let state = TRAY_STATE.lock().unwrap().clone();
    let menu = build_menu(app, &state).map_err(std::io::Error::other)?;
    {
        let mut last = LAST_ICON_KEY.lock().unwrap();
        *last = TrayIconKey::Empty;
    }

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Ganbaru AI")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "pause_resume" => {
                if TRAY_STATE.lock().unwrap().pomodoro.can_pause_resume {
                    let _ = app.emit("tray-pause-resume", ());
                }
            }
            "skip" => {
                let _ = app.emit("tray-skip", ());
            }
            "add_focus_time" => {
                let _ = app.emit("pomodoro-add-time", AddFocusTimePayload { seconds: 180 });
            }
            "music_play_pause" => {
                let _ = app.emit("tray-music-play-pause", ());
            }
            "music_previous" => {
                let _ = app.emit("tray-music-previous", ());
            }
            "music_next" => {
                let _ = app.emit("tray-music-next", ());
            }
            "music_open" => {
                let _ = app.emit("tray-music-open", ());
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Update tray icon progress ring, tooltip, and Pomodoro menu state.
#[tauri::command]
pub fn update_tray(app: AppHandle, update: PomodoroTrayUpdate) -> Result<(), String> {
    let state = {
        let mut state = TRAY_STATE.lock().unwrap();
        state.pomodoro = PomodoroTrayState {
            phase: update.phase,
            remaining_seconds: update.remaining_seconds,
            total_seconds: update.total_seconds,
            is_running: update.is_running,
            is_active: update.is_active,
            can_pause_resume: update.can_pause_resume,
            can_add_focus_time: update.can_add_focus_time,
            paused_pulse_frame: update.paused_pulse_frame,
        };
        state.clone()
    };
    apply_tray_state(&app, &state)
}

/// Update the Music section of the shared tray menu.
#[tauri::command]
pub fn update_music_tray(app: AppHandle, update: MusicTrayUpdate) -> Result<(), String> {
    let state = {
        let mut state = TRAY_STATE.lock().unwrap();
        state.music = MusicTrayState {
            status: update.status,
            title: update.title,
            can_play_pause: update.can_play_pause,
            can_previous: update.can_previous,
            can_next: update.can_next,
        };
        state.clone()
    };
    apply_tray_state(&app, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tray_state_with_pause_resume(can_pause_resume: bool) -> TrayState {
        TrayState {
            pomodoro: PomodoroTrayState {
                phase: "focus".to_string(),
                remaining_seconds: 1200,
                total_seconds: 2400,
                is_running: true,
                is_active: true,
                can_pause_resume,
                can_add_focus_time: false,
                paused_pulse_frame: None,
            },
            music: MusicTrayState {
                status: "idle".to_string(),
                title: None,
                can_play_pause: false,
                can_previous: false,
                can_next: false,
            },
        }
    }

    fn has_ring_pixel_with_color(pixels: &[u8], color: (u8, u8, u8)) -> bool {
        pixels.chunks_exact(4).any(|pixel| {
            pixel[3] > 0 && pixel[0] == color.0 && pixel[1] == color.1 && pixel[2] == color.2
        })
    }

    #[test]
    fn active_zero_progress_renders_remaining_ring() {
        let pixels = render_progress_icon(0.0, true);

        assert!(has_ring_pixel_with_color(&pixels, RING_REMAINING_COLOR));
    }

    #[test]
    fn inactive_zero_progress_renders_empty_ring() {
        let pixels = render_progress_icon(0.0, false);

        assert!(has_ring_pixel_with_color(&pixels, RING_EMPTY_COLOR));
        assert!(!has_ring_pixel_with_color(&pixels, RING_REMAINING_COLOR));
    }

    #[test]
    fn active_negative_progress_renders_remaining_ring() {
        assert_eq!(
            render_progress_icon(-0.25, true),
            render_progress_icon(0.0, true)
        );
    }

    #[test]
    fn active_positive_progress_renders_progress_arc() {
        let pixels = render_progress_icon(0.5, true);

        assert!(has_ring_pixel_with_color(&pixels, RING_REMAINING_COLOR));
        assert!(has_ring_pixel_with_color(&pixels, RING_EMPTY_COLOR));
    }

    #[test]
    fn active_progress_reduces_remaining_arc_from_top() {
        let pixels = render_progress_icon(0.25, true);
        let top_idx = ((2 * ICON_SIZE as usize) + (ICON_SIZE as usize / 2)) * 4;
        let bottom_idx =
            (((ICON_SIZE as usize - 3) * ICON_SIZE as usize) + (ICON_SIZE as usize / 2)) * 4;

        assert_eq!(
            &pixels[top_idx..top_idx + 3],
            &[RING_EMPTY_COLOR.0, RING_EMPTY_COLOR.1, RING_EMPTY_COLOR.2,]
        );
        assert_eq!(
            &pixels[bottom_idx..bottom_idx + 3],
            &[
                RING_REMAINING_COLOR.0,
                RING_REMAINING_COLOR.1,
                RING_REMAINING_COLOR.2,
            ]
        );
    }

    #[test]
    fn active_zero_progress_uses_progress_icon_key() {
        assert_eq!(tray_icon_key(0.0, true, None), TrayIconKey::Progress(0));
    }

    #[test]
    fn inactive_zero_progress_uses_empty_icon_key() {
        assert_eq!(tray_icon_key(0.0, false, None), TrayIconKey::Empty);
    }

    #[test]
    fn active_negative_progress_uses_zero_progress_icon_key() {
        assert_eq!(tray_icon_key(-0.25, true, None), TrayIconKey::Progress(0));
    }

    #[test]
    fn complete_progress_uses_empty_icon_key() {
        assert_eq!(tray_icon_key(1.0, true, None), TrayIconKey::Empty);
    }

    #[test]
    fn positive_progress_uses_progress_icon_key() {
        assert_eq!(tray_icon_key(0.5, true, None), TrayIconKey::Progress(50));
    }

    #[test]
    fn paused_progress_uses_paused_icon_key() {
        assert_eq!(
            tray_icon_key(0.5, true, Some(23)),
            TrayIconKey::PausedProgress { step: 50, frame: 1 }
        );
    }

    #[test]
    fn paused_progress_peak_renders_empty_gray_remaining_ring() {
        let pixels = render_progress_icon_with_pause(0.0, true, Some(12));

        assert!(has_ring_pixel_with_color(&pixels, RING_EMPTY_COLOR));
    }

    #[test]
    fn menu_shape_tracks_pause_resume_availability() {
        let disabled = menu_shape(&tray_state_with_pause_resume(false));
        let enabled = menu_shape(&tray_state_with_pause_resume(true));

        assert!(!disabled.pomodoro_can_pause_resume);
        assert!(enabled.pomodoro_can_pause_resume);
        assert_ne!(disabled, enabled);
    }

    #[test]
    fn long_music_menu_status_is_truncated() {
        let full_title =
            "Christopher Larkin - Hollow Knight (Original Soundtrack) - 09 City of Tears";
        let state = MusicTrayState {
            status: "playing".to_string(),
            title: Some(full_title.to_string()),
            can_play_pause: true,
            can_previous: true,
            can_next: true,
        };

        let label = music_menu_status_text(&state);

        assert!(label.chars().count() <= MUSIC_TRAY_STATUS_MAX_CHARS);
        assert!(label.starts_with("Christopher Larkin"));
        assert!(label.ends_with("..."));
        assert_ne!(label, full_title);
    }

    #[test]
    fn full_music_status_stays_available_for_tooltip() {
        let state = MusicTrayState {
            status: "playing".to_string(),
            title: Some(
                "Christopher Larkin - Hollow Knight (Original Soundtrack) - 09 City of Tears"
                    .to_string(),
            ),
            can_play_pause: true,
            can_previous: true,
            can_next: true,
        };

        assert_eq!(
            music_status_text(&state),
            "Christopher Larkin - Hollow Knight (Original Soundtrack) - 09 City of Tears"
        );
    }
}
