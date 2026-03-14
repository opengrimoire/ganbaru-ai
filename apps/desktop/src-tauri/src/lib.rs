mod db;
mod notification;
mod tray;

#[tauri::command]
fn force_quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_memory_usage_mb() -> f64 {
    #[cfg(target_os = "linux")]
    {
        if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
            for line in status.lines() {
                if let Some(val) = line.strip_prefix("VmRSS:") {
                    let kb: f64 = val.trim().trim_end_matches(" kB").trim().parse().unwrap_or(0.0);
                    return kb / 1024.0;
                }
            }
        }
        0.0
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
            notification::show_break_overlay,
            tray::update_tray,
            force_quit,
            get_memory_usage_mb,
        ])
        .setup(|app| {
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
