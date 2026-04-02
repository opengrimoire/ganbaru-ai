use tauri::Manager;

mod db;
mod notification;
mod tray;

#[tauri::command]
fn force_quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn reset_database(app: tauri::AppHandle) -> Result<(), String> {
    let mut db_path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    db_path.push("ganbaruai.db");

    for suffix in &["", "-wal", "-shm"] {
        let mut path = db_path.clone();
        let name = format!(
            "{}{}",
            path.file_name().unwrap().to_string_lossy(),
            suffix
        );
        path.set_file_name(name);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }

    app.exit(0);
    Ok(())
}

#[tauri::command]
fn get_memory_usage_mb() -> f64 {
    #[cfg(target_os = "linux")]
    {
        fn read_rss_kb(pid: &str) -> f64 {
            let path = format!("/proc/{pid}/status");
            if let Ok(status) = std::fs::read_to_string(path) {
                for line in status.lines() {
                    if let Some(val) = line.strip_prefix("VmRSS:") {
                        return val
                            .trim()
                            .trim_end_matches(" kB")
                            .trim()
                            .parse::<f64>()
                            .unwrap_or(0.0);
                    }
                }
            }
            0.0
        }

        let my_pid = std::process::id();
        let mut total_kb = read_rss_kb(&my_pid.to_string());

        // Sum RSS of all child processes (WebKitWebProcess, WebKitNetworkProcess, etc.)
        let task_dir = format!("/proc/{my_pid}/task");
        if let Ok(tasks) = std::fs::read_dir(&task_dir) {
            // Collect thread IDs to find child processes via /proc/*/stat ppid
            let _ = tasks;
        }
        // Walk /proc to find children by matching ppid
        if let Ok(entries) = std::fs::read_dir("/proc") {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if !name_str.chars().all(|c| c.is_ascii_digit()) {
                    continue;
                }
                if name_str == my_pid.to_string() {
                    continue;
                }
                let stat_path = format!("/proc/{name_str}/stat");
                if let Ok(stat) = std::fs::read_to_string(&stat_path) {
                    // Format: pid (comm) state ppid ...
                    // Find closing ')' to skip comm which may contain spaces
                    if let Some(after_comm) = stat.rfind(')') {
                        let fields: Vec<&str> = stat[after_comm + 2..].split_whitespace().collect();
                        // fields[0] = state, fields[1] = ppid
                        if let Some(ppid) = fields.get(1) {
                            if *ppid == my_pid.to_string() {
                                total_kb += read_rss_kb(&name_str);
                            }
                        }
                    }
                }
            }
        }

        total_kb / 1024.0
    }
    #[cfg(not(target_os = "linux"))]
    {
        0.0
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:ganbaruai.db", db::migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            notification::show_pomodoro_notification,
            notification::show_event_notification,
            notification::show_break_overlay,
            notification::get_idle_status,
            notification::play_alert_sound,
            notification::show_idle_overlay,
            tray::update_tray,
            force_quit,
            reset_database,
            get_memory_usage_mb,
        ])
        .setup(|app| {
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
