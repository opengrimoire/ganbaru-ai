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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod db;
