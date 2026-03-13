use notify_rust::{Hint, Notification};
use serde::Serialize;
use tauri::Emitter;

#[derive(Clone, Serialize)]
struct AddTimePayload {
    seconds: u32,
}

#[cfg(target_os = "linux")]
fn gsettings_get(schema: &str, key: &str) -> Option<String> {
    std::process::Command::new("gsettings")
        .args(["get", schema, key])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

#[cfg(target_os = "linux")]
fn gsettings_set(schema: &str, key: &str, value: &str) {
    match std::process::Command::new("gsettings")
        .args(["set", schema, key, value])
        .output()
    {
        Ok(output) => {
            if !output.status.success() {
                eprintln!(
                    "gsettings set {schema} {key} failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
            }
        }
        Err(e) => eprintln!("gsettings command failed: {e}"),
    }
}

#[cfg(target_os = "linux")]
struct SavedShortcuts {
    overlay_key: String,
    dock_hotkeys: String,
    /// (schema, key, original_value) for every keybinding that was disabled
    disabled: Vec<(String, String, String)>,
}

#[cfg(target_os = "linux")]
fn gsettings_list_recursively(schema: &str) -> Vec<(String, String)> {
    let output = match std::process::Command::new("gsettings")
        .args(["list-recursively", schema])
        .output()
    {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
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
    result
}

#[cfg(target_os = "linux")]
impl SavedShortcuts {
    fn save_and_disable() -> Self {
        let mut disabled = Vec::new();

        // Scan all keybinding schemas for any binding using Super or Alt
        let schemas = [
            "org.gnome.desktop.wm.keybindings",
            "org.gnome.shell.keybindings",
            "org.gnome.mutter.keybindings",
            "org.gnome.settings-daemon.plugins.media-keys",
        ];
        for schema in &schemas {
            for (key, value) in gsettings_list_recursively(schema) {
                if value.contains("Super") || value.contains("<Alt>") {
                    disabled.push((schema.to_string(), key.clone(), value));
                    gsettings_set(schema, &key, "['']");
                }
            }
        }

        // Mutter overlay-key (Super alone)
        let overlay_key = gsettings_get("org.gnome.mutter", "overlay-key")
            .unwrap_or_else(|| "'Super_L'".into());
        gsettings_set("org.gnome.mutter", "overlay-key", "");

        // Ubuntu Dock / Dash to Dock Super+N
        let dock_hotkeys = gsettings_get(
            "org.gnome.shell.extensions.dash-to-dock",
            "hot-keys",
        )
        .unwrap_or_else(|| "true".into());
        gsettings_set(
            "org.gnome.shell.extensions.dash-to-dock",
            "hot-keys",
            "false",
        );

        Self {
            overlay_key,
            dock_hotkeys,
            disabled,
        }
    }

    fn restore(&self) {
        gsettings_set("org.gnome.mutter", "overlay-key", &self.overlay_key);
        gsettings_set(
            "org.gnome.shell.extensions.dash-to-dock",
            "hot-keys",
            &self.dock_hotkeys,
        );
        for (schema, key, val) in &self.disabled {
            gsettings_set(schema, key, val);
        }
    }
}

/// Inhibit screensaver/idle via D-Bus, returns cookie for uninhibit
#[cfg(target_os = "linux")]
fn screensaver_inhibit() -> Option<u32> {
    let output = std::process::Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.freedesktop.ScreenSaver",
            "--object-path",
            "/org/freedesktop/ScreenSaver",
            "--method",
            "org.freedesktop.ScreenSaver.Inhibit",
            "GanbaruAI",
            "Break timer active",
        ])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
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
    let _ = std::process::Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.freedesktop.ScreenSaver",
            "--object-path",
            "/org/freedesktop/ScreenSaver",
            "--method",
            "org.freedesktop.ScreenSaver.UnInhibit",
            &cookie.to_string(),
        ])
        .output();
}

#[cfg(target_os = "linux")]
fn format_remaining(secs: u64) -> String {
    if secs >= 60 {
        format!("{}:{:02}", secs / 60, secs % 60)
    } else {
        secs.to_string()
    }
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn show_break_overlay(app: tauri::AppHandle, break_seconds: u32) -> Result<(), String> {
    app.clone().run_on_main_thread(move || {
        use gtk::prelude::*;
        use std::time::{Duration, SystemTime};

        let saved = std::rc::Rc::new(SavedShortcuts::save_and_disable());
        let inhibit_cookie = std::rc::Rc::new(std::cell::Cell::new(screensaver_inhibit()));
        let end_time = SystemTime::now() + Duration::from_secs(break_seconds as u64);
        let end_time = std::rc::Rc::new(std::cell::Cell::new(end_time));

        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_decorated(false);
        window.set_keep_above(true);
        window.set_app_paintable(true);

        window.connect_draw(|_, cr| {
            cr.set_source_rgb(0.0, 0.0, 0.0);
            cr.paint().unwrap();
            gtk::glib::Propagation::Proceed
        });

        let display = format_remaining(break_seconds as u64);
        let timer_label = gtk::Label::new(None);
        timer_label.set_markup(&format!(
            "<span font='80' foreground='#FFFFFF'>{display}</span>"
        ));

        let hint_label = gtk::Label::new(None);
        hint_label.set_markup(
            "<span font='14' foreground='#AAAAAA'>Space x3: temporarily dismiss  |  Esc x3: skip break</span>",
        );

        let vbox = gtk::Box::new(gtk::Orientation::Vertical, 16);
        vbox.set_valign(gtk::Align::Center);
        vbox.set_halign(gtk::Align::Center);
        vbox.add(&timer_label);
        vbox.add(&hint_label);
        window.add(&vbox);

        window.fullscreen();

        let is_hidden = std::rc::Rc::new(std::cell::Cell::new(false));
        let space_count = std::rc::Rc::new(std::cell::Cell::new(0u32));
        let esc_count = std::rc::Rc::new(std::cell::Cell::new(0u32));

        // Restore shortcuts and uninhibit screensaver when window is destroyed
        {
            let saved = saved.clone();
            let cookie = inhibit_cookie.clone();
            window.connect_destroy(move |_| {
                saved.restore();
                if let Some(c) = cookie.get() {
                    screensaver_uninhibit(c);
                }
            });
        }

        // Space x3: temporarily dismiss (break continues, shortcuts restored)
        // Escape x3: skip break entirely (emit event, close overlay)
        {
            let space_count = space_count.clone();
            let esc_count = esc_count.clone();
            let is_hidden = is_hidden.clone();
            let saved = saved.clone();
            let cookie = inhibit_cookie.clone();
            let w = window.clone();
            let app = app.clone();
            window.connect_key_press_event(move |_, event| {
                let key = event.keyval();
                if key == gdk::keys::constants::space {
                    esc_count.set(0);
                    let count = space_count.get() + 1;
                    space_count.set(count);
                    if count >= 3 {
                        space_count.set(0);
                        is_hidden.set(true);
                        saved.restore();
                        if let Some(c) = cookie.get() {
                            screensaver_uninhibit(c);
                            cookie.set(None);
                        }
                        w.hide();
                    }
                } else if key == gdk::keys::constants::Escape {
                    space_count.set(0);
                    let count = esc_count.get() + 1;
                    esc_count.set(count);
                    if count >= 3 {
                        let _ = app.emit("pomodoro-skip-break", ());
                        w.close();
                    }
                } else {
                    space_count.set(0);
                    esc_count.set(0);
                }
                gtk::glib::Propagation::Stop
            });
        }

        // Countdown using wall clock time (survives suspend)
        {
            let end_time = end_time.clone();
            let is_hidden = is_hidden.clone();
            let w = window.clone();
            let timer_label = timer_label.clone();
            gtk::glib::timeout_add_seconds_local(1, move || {
                let now = SystemTime::now();
                let et = end_time.get();
                let remaining = et.duration_since(now).unwrap_or(Duration::ZERO);
                let secs = remaining.as_secs();

                if secs == 0 {
                    w.close();
                    return gtk::glib::ControlFlow::Break;
                }
                if !is_hidden.get() {
                    let display = format_remaining(secs);
                    timer_label.set_markup(&format!(
                        "<span font='80' foreground='#FFFFFF'>{display}</span>"
                    ));
                }
                gtk::glib::ControlFlow::Continue
            });
        }

        // Re-show overlay after 30s of system inactivity when hidden
        {
            let end_time = end_time.clone();
            let is_hidden = is_hidden.clone();
            let inhibit_cookie = inhibit_cookie.clone();
            let w = window.clone();
            let timer_label = timer_label.clone();
            gtk::glib::timeout_add_seconds_local(5, move || {
                let now = SystemTime::now();
                let et = end_time.get();
                if now >= et {
                    return gtk::glib::ControlFlow::Break;
                }
                if !is_hidden.get() {
                    return gtk::glib::ControlFlow::Continue;
                }

                let idle_ms = get_idle_time_ms().unwrap_or(0);
                if idle_ms >= 30_000 {
                    is_hidden.set(false);
                    let _ = SavedShortcuts::save_and_disable();
                    inhibit_cookie.set(screensaver_inhibit());

                    let remaining = et.duration_since(now).unwrap_or(Duration::ZERO);
                    let display = format_remaining(remaining.as_secs());
                    timer_label.set_markup(&format!(
                        "<span font='80' foreground='#FFFFFF'>{display}</span>"
                    ));
                    w.show_all();
                    w.fullscreen();
                    w.present();
                }

                gtk::glib::ControlFlow::Continue
            });
        }

        window.show_all();
    })
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(target_os = "linux")]
fn get_idle_time_ms() -> Option<u64> {
    let output = std::process::Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.gnome.Mutter.IdleMonitor",
            "--object-path",
            "/org/gnome/Mutter/IdleMonitor/Core",
            "--method",
            "org.gnome.Mutter.IdleMonitor.GetIdletime",
        ])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Output format: "(uint64 12345,)"
    stdout
        .trim()
        .strip_prefix("(uint64 ")?
        .strip_suffix(",)")?
        .parse::<u64>()
        .ok()
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn show_break_overlay(_app: tauri::AppHandle, _break_seconds: u32) -> Result<(), String> {
    Err("Break overlay not yet implemented for this platform".into())
}

#[tauri::command]
pub fn show_pomodoro_notification(app: tauri::AppHandle, remaining_seconds: u32) {
    let timeout_ms = remaining_seconds * 1000;

    std::thread::spawn(move || {
        let result = Notification::new()
            .summary("Focus ending soon")
            .body(&format!("{remaining_seconds} seconds remaining"))
            .action("skip_break", "Skip break")
            .action("add_time", "Add 10 seconds")
            .timeout(timeout_ms as i32)
            .id(9001)
            .hint(Hint::Transient(true))
            .hint(Hint::SoundName("message-new-instant".into()))
            .show();

        match result {
            Ok(handle) => {
                handle.wait_for_action(|action| match action {
                    "skip_break" => {
                        let _ = app.emit("pomodoro-skip-break", ());
                    }
                    "add_time" => {
                        let _ = app.emit("pomodoro-add-time", AddTimePayload { seconds: 10 });
                    }
                    _ => {}
                });
            }
            Err(e) => {
                eprintln!("Failed to show notification: {e}");
            }
        }
    });
}
