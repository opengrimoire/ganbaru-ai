use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter,
};

const ICON_SIZE: u32 = 32;
const RING_WIDTH: f64 = 3.5;

/// Render a progress ring icon as raw RGBA pixels.
/// - Active session: white circle that fills with gray as time elapses
/// - No active session: solid gray circle
fn render_progress_icon(progress: f64, active: bool) -> Vec<u8> {
    let size = ICON_SIZE as usize;
    let mut pixels = vec![0u8; size * size * 4];
    let center = size as f64 / 2.0;
    let outer_r = center - 0.5;
    let inner_r = outer_r - RING_WIDTH;

    // Gray for inactive/elapsed, white for remaining
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
                    // Angle from top, clockwise (0.0 to 1.0)
                    let angle = (-dx).atan2(-dy);
                    let normalized = (angle + std::f64::consts::PI) / (2.0 * std::f64::consts::PI);
                    let normalized = (normalized + 0.5) % 1.0;

                    // Elapsed portion = gray, remaining = white
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

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let idle_icon = render_progress_icon(0.0, false);
    let icon = Image::new_owned(idle_icon, ICON_SIZE, ICON_SIZE);

    let status_item = MenuItemBuilder::with_id("status", "No active session")
        .enabled(false)
        .build(app)?;
    let menu = MenuBuilder::new(app).item(&status_item).build()?;

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
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Track last icon state to avoid unnecessary set_icon calls (causes flicker on Linux)
/// Initialized to sentinel values so the first update always applies
static LAST_ICON_STEP: std::sync::Mutex<(u8, bool)> = std::sync::Mutex::new((255, true));

static LAST_MENU_STATE: std::sync::Mutex<(bool, u8, bool)> = std::sync::Mutex::new((true, 255, true));
// (is_running, phase_id, active)

/// Stored reference to status menu item for lightweight text updates
static STATUS_ITEM: std::sync::Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>> =
    std::sync::Mutex::new(None);

fn phase_id(phase: &str) -> u8 {
    match phase {
        "focus" => 0,
        "short_break" => 1,
        "long_break" => 2,
        _ => 3,
    }
}

#[tauri::command]
pub fn update_tray(
    app: AppHandle,
    phase: &str,
    remaining_seconds: u32,
    total_seconds: u32,
    is_running: bool,
) -> Result<(), String> {
    let tray = app
        .tray_by_id("main")
        .ok_or("No tray icon found")?;

    let progress = if total_seconds > 0 {
        1.0 - (remaining_seconds as f64 / total_seconds as f64)
    } else {
        0.0
    };
    let progress_step = (progress * 100.0) as u8;
    let active = is_running || remaining_seconds < total_seconds;
    let pid = phase_id(phase);

    // Only update icon when the visual actually changes
    {
        let mut last = LAST_ICON_STEP.lock().unwrap();
        if last.0 != progress_step || last.1 != active {
            *last = (progress_step, active);
            let pixels = render_progress_icon(progress, active);
            let icon = Image::new_owned(pixels, ICON_SIZE, ICON_SIZE);
            tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
        }
    }

    let phase_label = match phase {
        "focus" => "Focus",
        "short_break" => "Short break",
        "long_break" => "Long break",
        _ => "Idle",
    };
    let time_str = format_tray_time(remaining_seconds);
    let status_text = format!("{time_str} left");

    // Tooltip: always update
    tray.set_tooltip(Some(&format!("GanbaruAI - {phase_label} {time_str}")))
        .map_err(|e| e.to_string())?;

    // Update status item text every tick (lightweight string update)
    {
        let item = STATUS_ITEM.lock().unwrap();
        if let Some(ref si) = *item {
            let _ = si.set_text(&status_text);
        }
    }

    // Only rebuild full menu when running state, phase, or active state changes
    {
        let mut last = LAST_MENU_STATE.lock().unwrap();
        if last.0 != is_running || last.1 != pid || last.2 != active {
            *last = (is_running, pid, active);

            let status_item =
                MenuItemBuilder::with_id("status", if active { &status_text } else { "No active session" })
                    .enabled(false)
                    .build(&app)
                    .map_err(|e| e.to_string())?;

            // Store reference for future text-only updates
            {
                let mut stored = STATUS_ITEM.lock().unwrap();
                *stored = Some(status_item.clone());
            }

            let menu = if active {
                let skip_item = MenuItemBuilder::with_id("skip", "Skip")
                    .build(&app)
                    .map_err(|e| e.to_string())?;
                let sep1 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
                let pause_resume_label = if is_running { "Pause" } else { "Resume" };
                let pause_resume_item =
                    MenuItemBuilder::with_id("pause_resume", pause_resume_label)
                        .build(&app)
                        .map_err(|e| e.to_string())?;
                MenuBuilder::new(&app)
                    .item(&status_item)
                    .item(&sep1)
                    .item(&pause_resume_item)
                    .item(&skip_item)
                    .build()
                    .map_err(|e| e.to_string())?
            } else {
                MenuBuilder::new(&app)
                    .item(&status_item)
                    .build()
                    .map_err(|e| e.to_string())?
            };

            tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}
