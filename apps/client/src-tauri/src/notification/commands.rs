#[cfg(target_os = "linux")]
use notify_rust::Hint;
use notify_rust::Notification;
use serde::Serialize;
use tauri::{Emitter, Manager, State};

use super::{AppSound, AppSoundState};

#[derive(Clone, Serialize)]
struct AddTimePayload {
    seconds: u32,
}

fn apply_linux_notification_hints(
    notification: &mut Notification,
    category: Option<&str>,
    desktop_entry: bool,
    transient: bool,
) {
    #[cfg(target_os = "linux")]
    {
        if let Some(category) = category {
            notification.hint(Hint::Category(category.to_string()));
        }
        if desktop_entry {
            notification.hint(Hint::DesktopEntry("ganbaru-ai".to_string()));
        }
        if transient {
            notification.hint(Hint::Transient(true));
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = notification;
        let _ = category;
        let _ = desktop_entry;
        let _ = transient;
    }
}

fn show_notification_with_linux_action<F>(
    notification: &Notification,
    error_context: &str,
    on_action: F,
) where
    F: FnOnce(&str),
{
    #[cfg(target_os = "linux")]
    {
        match notification.show() {
            Ok(handle) => {
                handle.wait_for_action(on_action);
            }
            Err(e) => {
                eprintln!("{error_context}: {e}");
            }
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = on_action;
        if let Err(e) = notification.show() {
            eprintln!("{error_context}: {e}");
        }
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
        let mut notification = Notification::new();
        notification
            .appname("Ganbaru AI")
            .summary(&summary)
            .body(&body)
            .action("open", action_label)
            .timeout(15_000);
        apply_linux_notification_hints(&mut notification, Some("calendar"), true, true);
        show_notification_with_linux_action(
            &notification,
            "Failed to show event notification",
            |action| {
                if action == "open" || action == "default" {
                    if opens_calendar {
                        let _ = app.emit("calendar-notification-open", ());
                    }
                    focus_main_window(app.clone());
                }
            },
        );
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
        let mut notification = Notification::new();
        notification
            .summary(&title)
            .body(&body)
            .action("show_summary", "Show summary")
            .timeout(10_000)
            .id(9002);
        apply_linux_notification_hints(&mut notification, None, false, true);
        show_notification_with_linux_action(
            &notification,
            "Failed to show benchmark notification",
            |action| {
                if action == "show_summary" || action == "default" {
                    focus_main_window(app.clone());
                }
            },
        );
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
        let mut notification = Notification::new();
        notification
            .appname("Ganbaru AI")
            .summary("App closed by Ganbaru AI")
            .body(&body)
            .action("default", "Open desktop apps")
            .timeout(10_000);
        apply_linux_notification_hints(&mut notification, Some("device"), true, true);
        show_notification_with_linux_action(
            &notification,
            "Failed to show doomscrolling desktop block notification",
            |action| {
                if action == "default" {
                    let _ = app.emit("doomscrolling-open-desktop-settings", ());
                    focus_main_window(app.clone());
                }
            },
        );
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
        let mut notification = Notification::new();
        notification
            .appname("Ganbaru AI")
            .summary("Usage limit reached")
            .body(&body)
            .action("default", "Open limits")
            .timeout(10_000);
        apply_linux_notification_hints(&mut notification, Some("device"), true, true);
        show_notification_with_linux_action(
            &notification,
            "Failed to show doomscrolling desktop limit notification",
            |action| {
                if action == "default" {
                    let _ = app.emit("doomscrolling-open-limits-settings", ());
                    focus_main_window(app.clone());
                }
            },
        );
    });
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
        notification.timeout(timeout_ms as i32).id(9001);
        apply_linux_notification_hints(&mut notification, None, false, true);
        show_notification_with_linux_action(
            &notification,
            "Failed to show notification",
            |action| {
                if action == "add_time" {
                    let _ = app.emit("pomodoro-add-time", AddTimePayload { seconds: 180 });
                }
            },
        );
    });
}

#[tauri::command]
pub fn show_paused_focus_notification(app: tauri::AppHandle, app_sounds: State<'_, AppSoundState>) {
    app_sounds.play(AppSound::EventNotification);
    std::thread::spawn(move || {
        let mut notification = Notification::new();
        notification
            .appname("Ganbaru AI")
            .summary("Focus session is paused")
            .body("Your focus session is still paused.")
            .action("resume", "Resume focus")
            .action("stop_asking", "Stop asking")
            .timeout(15_000)
            .id(9003);
        apply_linux_notification_hints(&mut notification, Some("reminder"), true, true);
        show_notification_with_linux_action(
            &notification,
            "Failed to show paused focus notification",
            |action| match action {
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
            },
        );
    });
}
