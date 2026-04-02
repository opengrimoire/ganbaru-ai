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
    let db_file = if cfg!(debug_assertions) {
        "ganbaruai-dev.db"
    } else {
        "ganbaruai.db"
    };
    db_path.push(db_file);

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
        fn read_pss_kb(pid: &str) -> f64 {
            // smaps_rollup gives PSS (Proportional Set Size): private memory
            // plus a fair share of shared memory. Avoids double-counting shared
            // libraries across processes.
            let path = format!("/proc/{pid}/smaps_rollup");
            if let Ok(content) = std::fs::read_to_string(&path) {
                for line in content.lines() {
                    if let Some(val) = line.strip_prefix("Pss:") {
                        return val
                            .trim()
                            .trim_end_matches(" kB")
                            .trim()
                            .parse::<f64>()
                            .unwrap_or(0.0);
                    }
                }
            }
            // Fallback to VmRSS if smaps_rollup is unavailable
            let path = format!("/proc/{pid}/status");
            if let Ok(content) = std::fs::read_to_string(path) {
                for line in content.lines() {
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
        let mut total_kb = read_pss_kb(&my_pid.to_string());

        // Walk /proc to find child processes (WebKitWebProcess, WebKitNetworkProcess, etc.)
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
                                total_kb += read_pss_kb(&name_str);
                            }
                        }
                    }
                }
            }
        }

        total_kb / 1024.0
    }
    #[cfg(target_os = "windows")]
    {
        use std::mem;
        use winapi::um::handleapi::CloseHandle;
        use winapi::um::processthreadsapi::OpenProcess;
        use winapi::um::psapi::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
        use winapi::um::tlhelp32::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        use winapi::um::winnt::{PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};

        unsafe {
            let my_pid = std::process::id();

            // Snapshot all processes to build the tree
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot.is_null() {
                return 0.0;
            }

            let mut processes: Vec<(u32, u32)> = Vec::new();
            let mut entry: PROCESSENTRY32W = mem::zeroed();
            entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;

            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    processes.push((entry.th32ProcessID, entry.th32ParentProcessID));
                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);

            // Recursively collect all descendant PIDs (handles WebView2 grandchildren)
            let mut pids = vec![my_pid];
            let mut i = 0;
            while i < pids.len() {
                let parent = pids[i];
                for &(pid, ppid) in &processes {
                    if ppid == parent && !pids.contains(&pid) {
                        pids.push(pid);
                    }
                }
                i += 1;
            }

            // Sum WorkingSetSize for all collected PIDs
            let mut total_bytes: usize = 0;
            for &pid in &pids {
                let handle =
                    OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
                if !handle.is_null() {
                    let mut pmc: PROCESS_MEMORY_COUNTERS = mem::zeroed();
                    pmc.cb = mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                    if GetProcessMemoryInfo(handle, &mut pmc, pmc.cb) != 0 {
                        total_bytes += pmc.WorkingSetSize;
                    }
                    CloseHandle(handle);
                }
            }

            total_bytes as f64 / (1024.0 * 1024.0)
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        0.0
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin({
            let db_name = if cfg!(debug_assertions) {
                "sqlite:ganbaruai-dev.db"
            } else {
                "sqlite:ganbaruai.db"
            };
            tauri_plugin_sql::Builder::default()
                .add_migrations(db_name, db::migrations())
                .build()
        })
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
