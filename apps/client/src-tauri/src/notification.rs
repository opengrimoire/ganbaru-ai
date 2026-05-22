use notify_rust::{Hint, Notification};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "linux")]
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
struct AddTimePayload {
    seconds: u32,
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

#[cfg(target_os = "linux")]
fn run_main_thread_setup<F>(app: &tauri::AppHandle, setup: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
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
            "GanbaruAI",
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

#[cfg(target_os = "linux")]
fn format_remaining(secs: u64) -> String {
    format!("{:02}:{:02}", secs / 60, secs % 60)
}

#[cfg(target_os = "linux")]
fn set_markup_text(label: &gtk::Label, font: &str, color: &str, text: &str) {
    use gtk::prelude::LabelExt;

    let escaped = gtk::glib::markup_escape_text(text);
    label.set_markup(&format!(
        "<span font='{font}' foreground='{color}'>{escaped}</span>"
    ));
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn show_break_overlay(app: tauri::AppHandle, break_seconds: u32) -> Result<(), String> {
    let app_for_setup = app.clone();
    run_main_thread_setup(&app, move || {
        use gtk::prelude::*;
        use std::time::{Duration, SystemTime};

        let app = app_for_setup;
        let inhibit_cookie = std::rc::Rc::new(std::cell::Cell::new(screensaver_inhibit()));
        let end_time = SystemTime::now() + Duration::from_secs(break_seconds as u64);
        let end_time = std::rc::Rc::new(std::cell::Cell::new(end_time));
        let display = gdk::Display::default()
            .ok_or_else(|| "no GDK display is available for the break overlay".to_string())?;
        let saved = std::rc::Rc::new(SavedShortcuts::save_and_disable(&app)?);
        let restore_path = std::rc::Rc::new(shortcut_restore_path(&app)?);
        let screen = display.default_screen();
        let n_monitors = display.n_monitors();
        let primary_idx = match display.primary_monitor() {
            Some(primary) => (0..n_monitors)
                .find(|&i| display.monitor(i).as_ref() == Some(&primary))
                .unwrap_or(0),
            None => 0,
        };
        let ui_margin = {
            let geom = display
                .monitor(primary_idx)
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
        set_markup_text(&timer_label, "Sans Light 72", "#FFFFFF", &display_str);

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
        finished_title
            .set_markup("<span font='Sans Light 48' foreground='#FFFFFF'>Break complete</span>");
        let finished_subtitle = gtk::Label::new(None);
        finished_subtitle.set_markup(
            "<span font='Sans 14' foreground='#9CA3AF'>press any key or click to continue</span>",
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
                if i == primary_idx {
                    continue;
                }
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
            let restore_path = restore_path.clone();
            let cookie = inhibit_cookie.clone();
            let sec = secondary_windows.clone();
            window.connect_destroy(move |_| {
                for (_, sw) in sec.iter() {
                    sw.hide();
                    sw.close();
                }
                let saved = (*saved).clone();
                let restore_path = (*restore_path).clone();
                let cookie_val = cookie.get();
                std::thread::spawn(move || {
                    restore_shortcuts(&saved);
                    if let Some(c) = cookie_val {
                        screensaver_uninhibit(c);
                    }
                    clear_shortcut_restore(&restore_path);
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
                            set_markup_text(
                                &exh,
                                "Sans 11",
                                "#9CA3AF",
                                &format!(
                                    "Break extended by {total} min, press Ctrl+Shift+Space to add more ({remain} left, not recommended)"
                                ),
                            );
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
                    set_markup_text(
                        &eh,
                        "Sans 11",
                        "#9CA3AF",
                        &format!(
                            "Press {remaining}x Esc to skip the break entirely (not recommended)"
                        ),
                    );
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
                    for (_, sw) in sec.iter() {
                        sw.hide();
                        sw.close();
                    }
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
                        set_markup_text(
                            &eh,
                            "Sans 11",
                            "#9CA3AF",
                            &format!(
                                "Press {remaining}x Esc to skip the break entirely (not recommended)"
                            ),
                        );
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
                        for (_, s) in sec.iter() {
                            s.hide();
                            s.close();
                        }
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
                    set_markup_text(&timer_label, "Sans Light 72", "#FFFFFF", &display_str);
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
                    inhibit_cookie.set(screensaver_inhibit());

                    let remaining = et.duration_since(now).unwrap_or(Duration::ZERO);
                    let display_str = format_remaining(remaining.as_secs());
                    set_markup_text(&timer_label, "Sans Light 72", "#FFFFFF", &display_str);
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
        Ok(())
    })
}

// ── Idle overlay (Linux) ──────────────────────────────────────────

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn show_idle_overlay(app: tauri::AppHandle, idle_seconds: u32) -> Result<bool, String> {
    let app_for_setup = app.clone();
    run_main_thread_setup(&app, move || {
        use gtk::prelude::*;

        let app = app_for_setup;
        let inhibit_cookie = std::rc::Rc::new(std::cell::Cell::new(screensaver_inhibit()));
        let dismissed = std::rc::Rc::new(std::cell::Cell::new(false));
        let display = gdk::Display::default()
            .ok_or_else(|| "no GDK display is available for the idle overlay".to_string())?;
        let saved = std::rc::Rc::new(SavedShortcuts::save_and_disable(&app)?);
        let restore_path = std::rc::Rc::new(shortcut_restore_path(&app)?);
        let screen = display.default_screen();
        let n_monitors = display.n_monitors();
        let primary_idx = match display.primary_monitor() {
            Some(primary) => (0..n_monitors)
                .find(|&i| display.monitor(i).as_ref() == Some(&primary))
                .unwrap_or(0),
            None => 0,
        };
        let ui_margin = {
            let geom = display
                .monitor(primary_idx)
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
        title_label
            .set_markup("<span font='Sans 13' foreground='#9CA3AF'>FOCUS SESSION PAUSED</span>");

        // Timer (counts up from idle_seconds)
        let timer_label = gtk::Label::new(None);
        let elapsed = std::rc::Rc::new(std::cell::Cell::new(idle_seconds as u64));
        let display_str = format_remaining(idle_seconds as u64);
        set_markup_text(&timer_label, "Sans Light 72", "#FFFFFF", &display_str);

        let idle_label = gtk::Label::new(None);
        idle_label.set_markup("<span font='Sans 14' foreground='#9CA3AF'>idle</span>");

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
                if i == primary_idx {
                    continue;
                }
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
            let restore_path = restore_path.clone();
            let cookie = inhibit_cookie.clone();
            let sec = secondary_windows.clone();
            window.connect_destroy(move |_| {
                for (_, sw) in sec.iter() {
                    sw.hide();
                    sw.close();
                }
                let saved = (*saved).clone();
                let restore_path = (*restore_path).clone();
                let cookie_val = cookie.get();
                std::thread::spawn(move || {
                    restore_shortcuts(&saved);
                    if let Some(c) = cookie_val {
                        screensaver_uninhibit(c);
                    }
                    clear_shortcut_restore(&restore_path);
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
                    for (_, sw) in sec.iter() {
                        sw.hide();
                        sw.close();
                    }
                    w.hide();
                    w.close();
                } else if key == gdk::keys::constants::Escape {
                    dismissed.set(true);
                    let _ = app.emit("idle-overlay-stop", ());
                    for (_, sw) in sec.iter() {
                        sw.hide();
                        sw.close();
                    }
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
                    for (_, s) in sec.iter() {
                        s.hide();
                        s.close();
                    }
                    w.hide();
                    w.close();
                } else if key == gdk::keys::constants::Escape {
                    dismissed.set(true);
                    let _ = app.emit("idle-overlay-stop", ());
                    for (_, s) in sec.iter() {
                        s.hide();
                        s.close();
                    }
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
                set_markup_text(&timer_label, "Sans Light 72", "#FFFFFF", &display_str);
                // Play alert every 15 seconds
                if e.is_multiple_of(15) {
                    std::thread::spawn(|| {
                        let ok = fixed_command_status("canberra-gtk-play", &["--id", "bell"]);
                        if !ok {
                            let _ = fixed_command_status(
                                "paplay",
                                &["/usr/share/sounds/freedesktop/stereo/bell.oga"],
                            );
                        }
                    });
                }
                gtk::glib::ControlFlow::Continue
            });
        }

        // Play alert sound immediately
        std::thread::spawn(|| {
            let ok = fixed_command_status("canberra-gtk-play", &["--id", "bell"]);
            if !ok {
                let _ = fixed_command_status(
                    "paplay",
                    &["/usr/share/sounds/freedesktop/stereo/bell.oga"],
                );
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
        Ok(())
    })?;

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
            let ok = fixed_command_status("canberra-gtk-play", &["--id", "bell"]);
            if !ok {
                let _ = fixed_command_status(
                    "paplay",
                    &["/usr/share/sounds/freedesktop/stereo/bell.oga"],
                );
            }
        }
        #[cfg(target_os = "windows")]
        {
            let _ = fixed_command_status(
                "powershell",
                &[
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "[System.Media.SystemSounds]::Exclamation.Play()",
                ],
            );
        }
        #[cfg(target_os = "macos")]
        {
            let _ = fixed_command_status("afplay", &["/System/Library/Sounds/Glass.aiff"]);
        }
    });
}

#[tauri::command]
pub fn show_event_notification(app: tauri::AppHandle, title: String, body: String) {
    std::thread::spawn(move || {
        let summary = notification_summary(&title);
        let body = escape_notification_markup(&body);
        let result = Notification::new()
            .appname("GanbaruAI")
            .summary(&summary)
            .body(&body)
            .action("open_calendar", "Open calendar")
            .timeout(15_000)
            .hint(Hint::Category("calendar".into()))
            .hint(Hint::DesktopEntry("ganbaruai".into()))
            .hint(Hint::SoundName("message-new-instant".into()))
            .show();

        match result {
            Ok(handle) => {
                handle.wait_for_action(|action| {
                    if action == "open_calendar" || action == "default" {
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

    fn unique_restore_file(name: &str) -> PathBuf {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is before Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "ganbaruai-{name}-{}-{now}.json",
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
            if let Err(e) = window.unminimize() {
                eprintln!("Failed to unminimize main window from notification: {e}");
            }
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
