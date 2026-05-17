use serde::Deserialize;
use std::sync::{LazyLock, Mutex};
use tauri::{
    image::Image,
    menu::{Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter,
};

const ICON_SIZE: u32 = 32;
const RING_WIDTH: f64 = 3.5;

#[derive(Debug, Clone)]
struct PomodoroTrayState {
    phase: String,
    remaining_seconds: u32,
    total_seconds: u32,
    is_running: bool,
}

#[derive(Debug, Clone)]
struct MusicTrayState {
    status: String,
    can_play_pause: bool,
    can_previous: bool,
    can_next: bool,
    shuffle_enabled: bool,
    has_queue: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrayUpdate {
    status: String,
    can_play_pause: bool,
    can_previous: bool,
    can_next: bool,
    shuffle_enabled: bool,
    has_queue: bool,
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
    music_status: String,
    music_can_play_pause: bool,
    music_can_previous: bool,
    music_can_next: bool,
    music_shuffle_enabled: bool,
    music_has_queue: bool,
}

static TRAY_STATE: LazyLock<Mutex<TrayState>> = LazyLock::new(|| {
    Mutex::new(TrayState {
        pomodoro: PomodoroTrayState {
            phase: "idle".to_string(),
            remaining_seconds: 0,
            total_seconds: 0,
            is_running: false,
        },
        music: MusicTrayState {
            status: "idle".to_string(),
            can_play_pause: false,
            can_previous: false,
            can_next: false,
            shuffle_enabled: false,
            has_queue: false,
        },
    })
});

/// Track last icon state to avoid unnecessary set_icon calls.
static LAST_ICON_STEP: Mutex<(u8, bool)> = Mutex::new((255, true));
static LAST_MENU_SHAPE: LazyLock<Mutex<Option<MenuShape>>> = LazyLock::new(|| Mutex::new(None));
static POMODORO_STATUS_ITEM: Mutex<Option<MenuItem<tauri::Wry>>> = Mutex::new(None);
static MUSIC_STATUS_ITEM: Mutex<Option<MenuItem<tauri::Wry>>> = Mutex::new(None);

/// Render a progress ring icon as raw RGBA pixels.
fn render_progress_icon(progress: f64, active: bool) -> Vec<u8> {
    let size = ICON_SIZE as usize;
    let mut pixels = vec![0u8; size * size * 4];
    let center = size as f64 / 2.0;
    let outer_r = center - 0.5;
    let inner_r = outer_r - RING_WIDTH;

    let gray: (u8, u8, u8) = (110, 110, 110);
    let white: (u8, u8, u8) = (240, 240, 240);

    for y in 0..size {
        for x in 0..size {
            let dx = x as f64 - center;
            let dy = y as f64 - center;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist >= inner_r - 0.5 && dist <= outer_r + 0.5 {
                let aa_outer = (outer_r + 0.5 - dist).clamp(0.0, 1.0);
                let aa_inner = (dist - (inner_r - 0.5)).clamp(0.0, 1.0);
                let alpha = (aa_outer * aa_inner * 255.0) as u8;

                let (r, g, b) = if !active {
                    gray
                } else {
                    let angle = (-dx).atan2(-dy);
                    let normalized = (angle + std::f64::consts::PI) / (2.0 * std::f64::consts::PI);
                    let normalized = (normalized + 0.5) % 1.0;

                    if normalized <= progress {
                        gray
                    } else {
                        white
                    }
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
    state.is_running || state.remaining_seconds < state.total_seconds
}

fn pomodoro_progress(state: &PomodoroTrayState) -> f64 {
    if state.total_seconds > 0 {
        1.0 - (state.remaining_seconds as f64 / state.total_seconds as f64)
    } else {
        0.0
    }
}

fn pomodoro_status_text(state: &PomodoroTrayState) -> String {
    if pomodoro_active(state) {
        format!(
            "Pomodoro: {} left",
            format_tray_time(state.remaining_seconds)
        )
    } else {
        "Pomodoro: no active session".to_string()
    }
}

fn music_status_text(state: &MusicTrayState) -> String {
    if state.can_play_pause || state.status != "idle" {
        format!("Music: {}", music_status_label(&state.status))
    } else {
        "Music: no music loaded".to_string()
    }
}

fn tray_tooltip(state: &TrayState) -> String {
    let pomodoro = if pomodoro_active(&state.pomodoro) {
        format!(
            "Pomodoro: {} {}",
            phase_label(&state.pomodoro.phase),
            format_tray_time(state.pomodoro.remaining_seconds)
        )
    } else {
        "Pomodoro: no active session".to_string()
    };
    let music = if state.music.can_play_pause || state.music.status != "idle" {
        format!("Music: {}", music_status_label(&state.music.status))
    } else {
        "Music: no music loaded".to_string()
    };
    format!("GanbaruAI\n{pomodoro}\n{music}")
}

fn menu_shape(state: &TrayState) -> MenuShape {
    MenuShape {
        pomodoro_active: pomodoro_active(&state.pomodoro),
        pomodoro_phase_id: phase_id(&state.pomodoro.phase),
        pomodoro_running: state.pomodoro.is_running,
        music_status: state.music.status.clone(),
        music_can_play_pause: state.music.can_play_pause,
        music_can_previous: state.music.can_previous,
        music_can_next: state.music.can_next,
        music_shuffle_enabled: state.music.shuffle_enabled,
        music_has_queue: state.music.has_queue,
    }
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

    let music_status = MenuItemBuilder::with_id("music_status", music_status_text(&state.music))
        .enabled(false)
        .build(app)
        .map_err(|e| e.to_string())?;
    {
        let mut stored = MUSIC_STATUS_ITEM.lock().unwrap();
        *stored = Some(music_status.clone());
    }

    let mut builder = MenuBuilder::new(app).item(&pomodoro_status);
    if pomodoro_active(&state.pomodoro) {
        let pause_resume_label = if state.pomodoro.is_running {
            "Pause pomodoro"
        } else {
            "Resume pomodoro"
        };
        let pause_resume_item = MenuItemBuilder::with_id("pause_resume", pause_resume_label)
            .build(app)
            .map_err(|e| e.to_string())?;
        let skip_item = MenuItemBuilder::with_id("skip", "Skip pomodoro")
            .build(app)
            .map_err(|e| e.to_string())?;
        builder = builder.item(&pause_resume_item).item(&skip_item);
    }

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
    let shuffle_label = if state.music.shuffle_enabled {
        "Shuffle music off"
    } else {
        "Shuffle music on"
    };
    let shuffle_item = MenuItemBuilder::with_id("music_shuffle", shuffle_label)
        .enabled(state.music.has_queue)
        .build(app)
        .map_err(|e| e.to_string())?;
    let open_music_item = MenuItemBuilder::with_id("music_open", "Open Music")
        .build(app)
        .map_err(|e| e.to_string())?;

    builder
        .item(&separator)
        .item(&music_status)
        .item(&play_pause_item)
        .item(&previous_item)
        .item(&next_item)
        .item(&shuffle_item)
        .item(&open_music_item)
        .build()
        .map_err(|e| e.to_string())
}

fn apply_tray_state(app: &AppHandle, state: &TrayState) -> Result<(), String> {
    let tray = app.tray_by_id("main").ok_or("No tray icon found")?;

    let progress = pomodoro_progress(&state.pomodoro);
    let progress_step = (progress * 100.0) as u8;
    let active = pomodoro_active(&state.pomodoro);
    {
        let mut last = LAST_ICON_STEP.lock().unwrap();
        if last.0 != progress_step || last.1 != active {
            *last = (progress_step, active);
            let pixels = render_progress_icon(progress, active);
            let icon = Image::new_owned(pixels, ICON_SIZE, ICON_SIZE);
            tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
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
            let _ = status_item.set_text(music_status_text(&state.music));
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

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("GanbaruAI")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "pause_resume" => {
                let _ = app.emit("tray-pause-resume", ());
            }
            "skip" => {
                let _ = app.emit("tray-skip", ());
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
            "music_shuffle" => {
                let _ = app.emit("tray-music-shuffle", ());
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
pub fn update_tray(
    app: AppHandle,
    phase: &str,
    remaining_seconds: u32,
    total_seconds: u32,
    is_running: bool,
) -> Result<(), String> {
    let state = {
        let mut state = TRAY_STATE.lock().unwrap();
        state.pomodoro = PomodoroTrayState {
            phase: phase.to_string(),
            remaining_seconds,
            total_seconds,
            is_running,
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
            can_play_pause: update.can_play_pause,
            can_previous: update.can_previous,
            can_next: update.can_next,
            shuffle_enabled: update.shuffle_enabled,
            has_queue: update.has_queue,
        };
        state.clone()
    };
    apply_tray_state(&app, &state)
}
