mod db;
mod notification;
mod tray;

#[tauri::command]
fn force_quit(app: tauri::AppHandle) {
    app.exit(0);
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
        ])
        .setup(|app| {
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
