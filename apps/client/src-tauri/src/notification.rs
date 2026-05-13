use notify_rust::{Hint, Notification};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

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
        let overlay_key =
            gsettings_get("org.gnome.mutter", "overlay-key").unwrap_or_else(|| "'Super_L'".into());
        gsettings_set("org.gnome.mutter", "overlay-key", "");

        // Ubuntu Dock / Dash to Dock Super+N
        let dock_hotkeys = gsettings_get("org.gnome.shell.extensions.dash-to-dock", "hot-keys")
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
    format!("{:02}:{:02}", secs / 60, secs % 60)
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
        let display = gdk::Display::default().unwrap();
        let screen = display.default_screen();
        let n_monitors = display.n_monitors();
        let primary_idx = match display.primary_monitor() {
            Some(primary) => (0..n_monitors)
                .find(|&i| display.monitor(i).as_ref() == Some(&primary))
                .unwrap_or(0),
            None => 0,
        };
        let ui_margin = {
            let geom = display.monitor(primary_idx)
                .map(|m| m.geometry())
                .unwrap_or(gdk::Rectangle::new(0, 0, 1920, 1080));
            ((geom.height().min(geom.width()) as f64 * 0.03).max(16.0)) as i32
        };

        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_decorated(false);
        window.set_keep_above(true);
        window.set_app_paintable(true);

        window.connect_draw(move |_, cr| {
                cr.set_source_rgb(0.0, 0.0, 0.0);
                cr.paint().unwrap();
                gtk::glib::Propagation::Proceed
        });

        // Timer (centered)
        let timer_label = gtk::Label::new(None);
        let display_str = format_remaining(break_seconds as u64);
        timer_label.set_markup(&format!(
            "<span font='Sans Light 72' foreground='#FFFFFF'>{display_str}</span>"
        ));

        let timer_container = gtk::Box::new(gtk::Orientation::Vertical, 0);
        timer_container.set_halign(gtk::Align::Center);
        timer_container.set_valign(gtk::Align::Center);
        timer_container.add(&timer_label);

        // Hint lines (bottom center)
        let extend_hint = gtk::Label::new(None);
        extend_hint.set_markup(
            "<span font='Sans 11' foreground='#9CA3AF'>Press Ctrl+Shift+Space to extend the break 1 minute (not recommended)</span>"
        );
        let esc_hint = gtk::Label::new(None);
        esc_hint.set_markup(
            "<span font='Sans 11' foreground='#9CA3AF'>Press 3x Esc to skip the break entirely (not recommended)</span>"
        );

        let keys_container = gtk::Box::new(gtk::Orientation::Vertical, 4);
        keys_container.set_halign(gtk::Align::Center);
        keys_container.set_valign(gtk::Align::End);
        keys_container.set_margin_bottom(ui_margin * 2);
        keys_container.add(&extend_hint);
        keys_container.add(&esc_hint);

        // Finished container (centered, hidden until break ends)
        let finished_container = gtk::Box::new(gtk::Orientation::Vertical, 16);
        finished_container.set_halign(gtk::Align::Center);
        finished_container.set_valign(gtk::Align::Center);
        let finished_title = gtk::Label::new(None);
        finished_title.set_markup(
            "<span font='Sans Light 48' foreground='#FFFFFF'>Break complete</span>"
        );
        let finished_subtitle = gtk::Label::new(None);
        finished_subtitle.set_markup(
            "<span font='Sans 14' foreground='#9CA3AF'>press any key or click to continue</span>"
        );
        finished_container.add(&finished_title);
        finished_container.add(&finished_subtitle);
        finished_container.set_no_show_all(true);

        // Overlay layout
        let overlay = gtk::Overlay::new();
        let base = gtk::Box::new(gtk::Orientation::Vertical, 0);
        overlay.add(&base);
        overlay.add_overlay(&timer_container);
        overlay.add_overlay(&keys_container);
        overlay.add_overlay(&finished_container);
        window.add(&overlay);

        window.fullscreen_on_monitor(&screen, primary_idx);

        let is_hidden = std::rc::Rc::new(std::cell::Cell::new(false));
        let break_finished = std::rc::Rc::new(std::cell::Cell::new(false));
        let esc_press = std::rc::Rc::new(std::cell::Cell::new(0u32));
        let extra_break_mins = std::rc::Rc::new(std::cell::Cell::new(0u32));

        // Black overlay windows for non-primary monitors
        let secondary_windows: std::rc::Rc<Vec<(i32, gtk::Window)>> = {
            let mut wins = Vec::new();
            for i in 0..n_monitors {
                if i == primary_idx { continue; }
                let sw = gtk::Window::new(gtk::WindowType::Toplevel);
                sw.set_decorated(false);
                sw.set_keep_above(true);
                sw.set_app_paintable(true);
                sw.connect_draw(|_, cr| {
                    cr.set_source_rgb(0.0, 0.0, 0.0);
                    cr.paint().unwrap();
                    gtk::glib::Propagation::Proceed
                });
                sw.fullscreen_on_monitor(&screen, i);
                wins.push((i, sw));
            }
            std::rc::Rc::new(wins)
        };

        // Restore shortcuts, uninhibit screensaver, and re-focus main window on destroy
        // gsettings restore runs in a background thread to avoid blocking the UI
        {
            let saved = saved.clone();
            let cookie = inhibit_cookie.clone();
            let sec = secondary_windows.clone();
            window.connect_destroy(move |_| {
                for (_, sw) in sec.iter() {
                    sw.hide();
                    sw.close();
                }
                let overlay_key = saved.overlay_key.clone();
                let dock_hotkeys = saved.dock_hotkeys.clone();
                let disabled = saved.disabled.clone();
                let cookie_val = cookie.get();
                std::thread::spawn(move || {
                    gsettings_set("org.gnome.mutter", "overlay-key", &overlay_key);
                    gsettings_set(
                        "org.gnome.shell.extensions.dash-to-dock",
                        "hot-keys",
                        &dock_hotkeys,
                    );
                    for (schema, key, val) in &disabled {
                        gsettings_set(schema, key, val);
                    }
                    if let Some(c) = cookie_val {
                        screensaver_uninhibit(c);
                    }
                });
            });
        }

        // Key handler: Space x3 = work 3 more min, Esc x3 = skip, Ctrl+Shift+Space = extend break
        {
            let break_finished = break_finished.clone();
            let esc_press = esc_press.clone();
            let extra_break = extra_break_mins.clone();
            let end_time = end_time.clone();
            let w = window.clone();
            let app = app.clone();
            let sec = secondary_windows.clone();
            let exh = extend_hint.clone();
            let eh = esc_hint.clone();
            window.connect_key_press_event(move |_, event| {
                if break_finished.get() {
                    let _ = app.emit("pomodoro-break-acknowledged", ());
                    for (_, sw) in sec.iter() { sw.hide(); sw.close(); }
                    w.hide();
                    w.close();
                    return gtk::glib::Propagation::Stop;
                }

                let key = event.keyval();
                let state = event.state();
                let ctrl = state.contains(gdk::ModifierType::CONTROL_MASK);
                let shift = state.contains(gdk::ModifierType::SHIFT_MASK);

                if key == gdk::keys::constants::space && ctrl && shift {
                    // Ctrl+Shift+Space: extend break by 1 minute (max 5)
                    esc_press.set(0);
                    eh.set_markup(
                        "<span font='Sans 11' foreground='#9CA3AF'>Press 3x Esc to skip the break entirely (not recommended)</span>"
                    );
                    let added = extra_break.get();
                    if added < 5 {
                        extra_break.set(added + 1);
                        let et = end_time.get();
                        end_time.set(et + std::time::Duration::from_secs(60));
                        let total = added + 1;
                        let remain = 5 - total;
                        if remain > 0 {
                            exh.set_markup(&format!(
                                "<span font='Sans 11' foreground='#9CA3AF'>Break extended by {total} min \u{2014} Press Ctrl+Shift+Space to add more ({remain} left, not recommended)</span>"
                            ));
                        } else {
                            exh.set_markup(
                                "<span font='Sans 11' foreground='#9CA3AF'>Break extended by 5 minutes (maximum reached)</span>"
                            );
                        }
                    }
                } else if key == gdk::keys::constants::Escape {
                    let count = esc_press.get() + 1;
                    esc_press.set(count);
                    let remaining = 3 - count;
                    eh.set_markup(&format!(
                        "<span font='Sans 11' foreground='#9CA3AF'>Press {remaining}x Esc to skip the break entirely (not recommended)</span>"
                    ));
                    if count >= 3 {
                        esc_press.set(0);
                        let _ = app.emit("pomodoro-skip-break", ());
                        for (_, sw) in sec.iter() { sw.hide(); sw.close(); }
                        w.hide();
                        w.close();
                    }
                } else {
                    esc_press.set(0);
                    eh.set_markup(
                        "<span font='Sans 11' foreground='#9CA3AF'>Press 3x Esc to skip the break entirely (not recommended)</span>"
                    );
                }
                gtk::glib::Propagation::Stop
            });
        }

        // Click handler: close overlay when break is finished
        {
            let break_finished = break_finished.clone();
            let w = window.clone();
            let app = app.clone();
            let sec = secondary_windows.clone();
            window.add_events(gdk::EventMask::BUTTON_PRESS_MASK);
            window.connect_button_press_event(move |_, _| {
                if break_finished.get() {
                    let _ = app.emit("pomodoro-break-acknowledged", ());
                    for (_, sw) in sec.iter() { sw.hide(); sw.close(); }
                    w.hide();
                    w.close();
                }
                gtk::glib::Propagation::Stop
            });
        }

        // Key and click handlers on secondary monitors
        for (_, sw) in secondary_windows.iter() {
            {
                let break_finished = break_finished.clone();
                let esc_press = esc_press.clone();
                let main = window.clone();
                let app = app.clone();
                let sec = secondary_windows.clone();
                let eh = esc_hint.clone();
                sw.connect_key_press_event(move |_, event| {
                    if break_finished.get() {
                        let _ = app.emit("pomodoro-break-acknowledged", ());
                        for (_, s) in sec.iter() { s.hide(); s.close(); }
                        main.hide();
                        main.close();
                        return gtk::glib::Propagation::Stop;
                    }
                    let key = event.keyval();
                    if key == gdk::keys::constants::Escape {
                        let count = esc_press.get() + 1;
                        esc_press.set(count);
                        let remaining = 3 - count;
                        eh.set_markup(&format!(
                            "<span font='Sans 11' foreground='#9CA3AF'>Press {remaining}x Esc to skip the break entirely (not recommended)</span>"
                        ));
                        if count >= 3 {
                            esc_press.set(0);
                            let _ = app.emit("pomodoro-skip-break", ());
                            for (_, s) in sec.iter() { s.hide(); s.close(); }
                            main.hide();
                            main.close();
                        }
                    } else {
                        esc_press.set(0);
                        eh.set_markup(
                            "<span font='Sans 11' foreground='#9CA3AF'>Press 3x Esc to skip the break entirely (not recommended)</span>"
                        );
                    }
                    gtk::glib::Propagation::Stop
                });
            }
            {
                let break_finished = break_finished.clone();
                let main = window.clone();
                let app = app.clone();
                let sec = secondary_windows.clone();
                sw.add_events(gdk::EventMask::BUTTON_PRESS_MASK);
                sw.connect_button_press_event(move |_, _| {
                    if break_finished.get() {
                        let _ = app.emit("pomodoro-break-acknowledged", ());
                        for (_, s) in sec.iter() { s.hide(); s.close(); }
                        main.hide();
                        main.close();
                    }
                    gtk::glib::Propagation::Stop
                });
            }
        }

        // Countdown using wall clock time (survives suspend)
        {
            let end_time = end_time.clone();
            let is_hidden = is_hidden.clone();
            let break_finished = break_finished.clone();
            let w = window.clone();
            let sec = secondary_windows.clone();
            let screen_ref = screen.clone();
            let timer_label = timer_label.clone();
            let timer_ctr = timer_container.clone();
            let keys_ctr = keys_container.clone();
            let finished_ctr = finished_container.clone();
            gtk::glib::timeout_add_seconds_local(1, move || {
                if break_finished.get() {
                    return gtk::glib::ControlFlow::Break;
                }

                let now = SystemTime::now();
                let et = end_time.get();
                let remaining = et.duration_since(now).unwrap_or(Duration::ZERO);
                let secs = remaining.as_secs();

                if secs == 0 {
                    break_finished.set(true);

                    // Hide timer, show centered finished message
                    timer_ctr.set_no_show_all(true);
                    timer_ctr.hide();
                    keys_ctr.set_no_show_all(true);
                    keys_ctr.hide();
                    finished_ctr.set_no_show_all(false);
                    finished_ctr.show_all();

                    // If hidden (space x3), re-show the overlay
                    if is_hidden.get() {
                        is_hidden.set(false);
                        let _ = SavedShortcuts::save_and_disable();
                        for (idx, sw) in sec.iter() {
                            sw.show_all();
                            sw.fullscreen_on_monitor(&screen_ref, *idx);
                        }
                        w.show();
                        w.fullscreen();
                        w.present();
                    }
                    return gtk::glib::ControlFlow::Break;
                }
                if !is_hidden.get() {
                    let display_str = format_remaining(secs);
                    timer_label.set_markup(&format!(
                        "<span font='Sans Light 72' foreground='#FFFFFF'>{display_str}</span>"
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
            let sec = secondary_windows.clone();
            let screen_ref = screen.clone();
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
                    let display_str = format_remaining(remaining.as_secs());
                    timer_label.set_markup(&format!(
                        "<span font='Sans Light 72' foreground='#FFFFFF'>{display_str}</span>"
                    ));
                    for (idx, sw) in sec.iter() {
                        sw.show_all();
                        sw.fullscreen_on_monitor(&screen_ref, *idx);
                    }
                    w.show();
                    w.fullscreen();
                    w.present();
                }

                gtk::glib::ControlFlow::Continue
            });
        }

        for (_, sw) in secondary_windows.iter() {
            sw.show_all();
        }
        window.show_all();
    })
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Idle overlay (Linux) ──────────────────────────────────────────

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn show_idle_overlay(app: tauri::AppHandle, idle_seconds: u32) -> Result<bool, String> {
    app.clone().run_on_main_thread(move || {
        use gtk::prelude::*;

        let saved = std::rc::Rc::new(SavedShortcuts::save_and_disable());
        let inhibit_cookie = std::rc::Rc::new(std::cell::Cell::new(screensaver_inhibit()));
        let dismissed = std::rc::Rc::new(std::cell::Cell::new(false));
        let display = gdk::Display::default().unwrap();
        let screen = display.default_screen();
        let n_monitors = display.n_monitors();
        let primary_idx = match display.primary_monitor() {
            Some(primary) => (0..n_monitors)
                .find(|&i| display.monitor(i).as_ref() == Some(&primary))
                .unwrap_or(0),
            None => 0,
        };
        let ui_margin = {
            let geom = display.monitor(primary_idx)
                .map(|m| m.geometry())
                .unwrap_or(gdk::Rectangle::new(0, 0, 1920, 1080));
            ((geom.height().min(geom.width()) as f64 * 0.03).max(16.0)) as i32
        };

        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_decorated(false);
        window.set_keep_above(true);
        window.set_app_paintable(true);
        window.connect_draw(|_, cr| {
            cr.set_source_rgb(0.0, 0.0, 0.0);
            cr.paint().unwrap();
            gtk::glib::Propagation::Proceed
        });

        // Title
        let title_label = gtk::Label::new(None);
        title_label.set_markup(
            "<span font='Sans 13' foreground='#9CA3AF'>FOCUS SESSION PAUSED</span>"
        );

        // Timer (counts up from idle_seconds)
        let timer_label = gtk::Label::new(None);
        let elapsed = std::rc::Rc::new(std::cell::Cell::new(idle_seconds as u64));
        let display_str = format_remaining(idle_seconds as u64);
        timer_label.set_markup(&format!(
            "<span font='Sans Light 72' foreground='#FFFFFF'>{display_str}</span>"
        ));

        let idle_label = gtk::Label::new(None);
        idle_label.set_markup(
            "<span font='Sans 14' foreground='#9CA3AF'>idle</span>"
        );

        let timer_container = gtk::Box::new(gtk::Orientation::Vertical, 16);
        timer_container.set_halign(gtk::Align::Center);
        timer_container.set_valign(gtk::Align::Center);
        timer_container.add(&title_label);
        timer_container.add(&timer_label);
        timer_container.add(&idle_label);

        // Hint lines (bottom center)
        let space_hint = gtk::Label::new(None);
        space_hint.set_markup(
            "<span font='Sans 11' foreground='#9CA3AF'>Press <span foreground='#FFFFFF'>Space</span> to resume focus</span>"
        );
        let esc_hint = gtk::Label::new(None);
        esc_hint.set_markup(
            "<span font='Sans 11' foreground='#9CA3AF'>Press <span foreground='#FFFFFF'>Esc</span> to stop session</span>"
        );

        let keys_container = gtk::Box::new(gtk::Orientation::Vertical, 4);
        keys_container.set_halign(gtk::Align::Center);
        keys_container.set_valign(gtk::Align::End);
        keys_container.set_margin_bottom(ui_margin * 2);
        keys_container.add(&space_hint);
        keys_container.add(&esc_hint);

        let overlay = gtk::Overlay::new();
        let base = gtk::Box::new(gtk::Orientation::Vertical, 0);
        overlay.add(&base);
        overlay.add_overlay(&timer_container);
        overlay.add_overlay(&keys_container);
        window.add(&overlay);

        window.fullscreen_on_monitor(&screen, primary_idx);

        // Secondary monitor black windows
        let secondary_windows: std::rc::Rc<Vec<(i32, gtk::Window)>> = {
            let mut wins = Vec::new();
            for i in 0..n_monitors {
                if i == primary_idx { continue; }
                let sw = gtk::Window::new(gtk::WindowType::Toplevel);
                sw.set_decorated(false);
                sw.set_keep_above(true);
                sw.set_app_paintable(true);
                sw.connect_draw(|_, cr| {
                    cr.set_source_rgb(0.0, 0.0, 0.0);
                    cr.paint().unwrap();
                    gtk::glib::Propagation::Proceed
                });
                sw.fullscreen_on_monitor(&screen, i);
                wins.push((i, sw));
            }
            std::rc::Rc::new(wins)
        };

        // Cleanup on destroy
        {
            let saved = saved.clone();
            let cookie = inhibit_cookie.clone();
            let sec = secondary_windows.clone();
            window.connect_destroy(move |_| {
                for (_, sw) in sec.iter() { sw.hide(); sw.close(); }
                let overlay_key = saved.overlay_key.clone();
                let dock_hotkeys = saved.dock_hotkeys.clone();
                let disabled = saved.disabled.clone();
                let cookie_val = cookie.get();
                std::thread::spawn(move || {
                    gsettings_set("org.gnome.mutter", "overlay-key", &overlay_key);
                    gsettings_set("org.gnome.shell.extensions.dash-to-dock", "hot-keys", &dock_hotkeys);
                    for (schema, key, val) in &disabled {
                        gsettings_set(schema, key, val);
                    }
                    if let Some(c) = cookie_val {
                        screensaver_uninhibit(c);
                    }
                });
            });
        }

        // Key handler: Space = resume, Esc = stop
        {
            let w = window.clone();
            let app = app.clone();
            let sec = secondary_windows.clone();
            let dismissed = dismissed.clone();
            window.connect_key_press_event(move |_, event| {
                let key = event.keyval();
                if key == gdk::keys::constants::space {
                    dismissed.set(true);
                    let _ = app.emit("idle-overlay-resume", ());
                    for (_, sw) in sec.iter() { sw.hide(); sw.close(); }
                    w.hide();
                    w.close();
                } else if key == gdk::keys::constants::Escape {
                    dismissed.set(true);
                    let _ = app.emit("idle-overlay-stop", ());
                    for (_, sw) in sec.iter() { sw.hide(); sw.close(); }
                    w.hide();
                    w.close();
                }
                gtk::glib::Propagation::Stop
            });
        }

        // Key handler on secondary monitors
        for (_, sw) in secondary_windows.iter() {
            let w = window.clone();
            let app = app.clone();
            let sec = secondary_windows.clone();
            let dismissed = dismissed.clone();
            sw.connect_key_press_event(move |_, event| {
                let key = event.keyval();
                if key == gdk::keys::constants::space {
                    dismissed.set(true);
                    let _ = app.emit("idle-overlay-resume", ());
                    for (_, s) in sec.iter() { s.hide(); s.close(); }
                    w.hide();
                    w.close();
                } else if key == gdk::keys::constants::Escape {
                    dismissed.set(true);
                    let _ = app.emit("idle-overlay-stop", ());
                    for (_, s) in sec.iter() { s.hide(); s.close(); }
                    w.hide();
                    w.close();
                }
                gtk::glib::Propagation::Stop
            });
        }

        // Count-up timer and periodic alert sound
        {
            let elapsed = elapsed.clone();
            let timer_label = timer_label.clone();
            let dismissed = dismissed.clone();
            gtk::glib::timeout_add_seconds_local(1, move || {
                if dismissed.get() {
                    return gtk::glib::ControlFlow::Break;
                }
                let e = elapsed.get() + 1;
                elapsed.set(e);
                let display_str = format_remaining(e);
                timer_label.set_markup(&format!(
                    "<span font='Sans Light 72' foreground='#FFFFFF'>{display_str}</span>"
                ));
                // Play alert every 15 seconds
                if e.is_multiple_of(15) {
                    std::thread::spawn(|| {
                        let ok = std::process::Command::new("canberra-gtk-play")
                            .args(["--id", "bell"])
                            .status()
                            .map(|s| s.success())
                            .unwrap_or(false);
                        if !ok {
                            let _ = std::process::Command::new("paplay")
                                .arg("/usr/share/sounds/freedesktop/stereo/bell.oga")
                                .status();
                        }
                    });
                }
                gtk::glib::ControlFlow::Continue
            });
        }

        // Play alert sound immediately
        std::thread::spawn(|| {
            let ok = std::process::Command::new("canberra-gtk-play")
                .args(["--id", "bell"])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !ok {
                let _ = std::process::Command::new("paplay")
                    .arg("/usr/share/sounds/freedesktop/stereo/bell.oga")
                    .status();
            }
        });

        // Send notification
        let _ = notify_rust::Notification::new()
            .summary("Focus session paused")
            .body("No activity detected. Return to resume your session.")
            .timeout(10_000)
            .hint(notify_rust::Hint::Transient(true))
            .hint(notify_rust::Hint::SoundName("message-new-instant".into()))
            .show();

        for (_, sw) in secondary_windows.iter() {
            sw.show_all();
        }
        window.show_all();
    })
    .map_err(|e| e.to_string())?;

    Ok(true)
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn show_idle_overlay(_app: tauri::AppHandle, _idle_seconds: u32) -> Result<bool, String> {
    // Non-Linux: handled by the Svelte IdleOverlay component (fullscreen webview)
    Ok(false)
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
    if let Ok(output) = std::process::Command::new("xprintidle").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Ok(ms) = stdout.trim().parse::<u64>() {
                return ms;
            }
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
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile", "-NonInteractive", "-Command",
            r#"Get-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam\*\*' -Name LastUsedTimeStop -ErrorAction SilentlyContinue | Where-Object { $_.LastUsedTimeStop -eq 0 } | Measure-Object | Select-Object -ExpandProperty Count"#,
        ])
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let count = String::from_utf8_lossy(&out.stdout)
                .trim()
                .parse::<u32>()
                .unwrap_or(0);
            count > 0
        }
        _ => false,
    }
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
    let output = match std::process::Command::new("ioreg")
        .args(["-c", "IOHIDSystem", "-d", "4", "-S"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return 0,
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
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
    let output = std::process::Command::new("bash")
        .args([
            "-c",
            "pgrep -x 'VDCAssistant|AppleCameraAssistant|appleh13camerad'",
        ])
        .output();
    match output {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
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

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn show_break_overlay(_app: tauri::AppHandle, _break_seconds: u32) -> Result<(), String> {
    Err("Break overlay not yet implemented for this platform".into())
}

// ── Alert sound ──────────────────────────────────────────────────

#[tauri::command]
pub fn play_alert_sound() {
    std::thread::spawn(|| {
        #[cfg(target_os = "linux")]
        {
            // Try canberra-gtk-play first (most desktop environments), then paplay
            let ok = std::process::Command::new("canberra-gtk-play")
                .args(["--id", "bell"])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !ok {
                let _ = std::process::Command::new("paplay")
                    .arg("/usr/share/sounds/freedesktop/stereo/bell.oga")
                    .status();
            }
        }
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("powershell")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "[System.Media.SystemSounds]::Exclamation.Play()",
                ])
                .status();
        }
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("afplay")
                .arg("/System/Library/Sounds/Glass.aiff")
                .status();
        }
    });
}

#[tauri::command]
pub fn show_event_notification(title: String, body: String) {
    std::thread::spawn(move || {
        let _ = Notification::new()
            .summary(&title)
            .body(&body)
            .timeout(10_000)
            .hint(Hint::Transient(true))
            .hint(Hint::SoundName("message-new-instant".into()))
            .show();
    });
}

#[tauri::command]
pub fn show_benchmark_notification(app: tauri::AppHandle, title: String, body: String) {
    std::thread::spawn(move || {
        let result = Notification::new()
            .summary(&title)
            .body(&body)
            .action("show_summary", "Show summary")
            .timeout(10_000)
            .id(9002)
            .hint(Hint::Transient(true))
            .hint(Hint::SoundName("message-new-instant".into()))
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

fn focus_main_window(app: tauri::AppHandle) {
    let app_for_lookup = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = app_for_lookup.get_webview_window("main") {
            if let Err(e) = window.unminimize() {
                eprintln!("Failed to unminimize main window from notification: {e}");
            }
            if let Err(e) = window.set_focus() {
                eprintln!("Failed to focus main window from notification: {e}");
            }
        }
    });
}

#[tauri::command]
pub fn show_pomodoro_notification(app: tauri::AppHandle, remaining_seconds: u32) {
    let timeout_ms = remaining_seconds * 1000;

    std::thread::spawn(move || {
        let result = Notification::new()
            .summary("Focus session ending in 1 minute")
            .action("add_time", "+3 minutes")
            .timeout(timeout_ms as i32)
            .id(9001)
            .hint(Hint::Transient(true))
            .hint(Hint::SoundName("message-new-instant".into()))
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
