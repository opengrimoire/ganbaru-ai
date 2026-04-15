use tauri::Manager;

mod db;
mod notification;
mod tray;

static PROCESS_START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

#[tauri::command]
fn get_startup_elapsed_ms() -> u64 {
    PROCESS_START
        .get()
        .map(|start| start.elapsed().as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
fn force_quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn reset_database(app: tauri::AppHandle) -> Result<(), String> {
    let mut db_path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let db_file = if cfg!(debug_assertions) {
        "ganbaruai-dev.db"
    } else {
        "ganbaruai.db"
    };
    db_path.push(db_file);

    for suffix in &["", "-wal", "-shm"] {
        let mut path = db_path.clone();
        let name = format!("{}{}", path.file_name().unwrap().to_string_lossy(), suffix);
        path.set_file_name(name);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }

    app.exit(0);
    Ok(())
}

#[derive(serde::Serialize, Clone)]
struct ProcessMemory {
    name: String,
    mb: f64,
}

#[derive(serde::Serialize)]
struct MemoryReport {
    processes: Vec<ProcessMemory>,
    total_mb: f64,
    platform: String,
}

#[tauri::command]
fn get_memory_report() -> MemoryReport {
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

        fn process_label(pid: &str) -> String {
            let comm_path = format!("/proc/{pid}/comm");
            if let Ok(comm) = std::fs::read_to_string(&comm_path) {
                let comm = comm.trim();
                if comm.contains("Network") {
                    return "Network (WebKit)".to_string();
                }
                if comm.contains("WebKit") {
                    return "Frontend (Svelte + WebKit)".to_string();
                }
                return comm.to_string();
            }
            format!("PID {pid}")
        }

        let my_pid = std::process::id();
        let my_pid_str = my_pid.to_string();
        let mut processes = vec![ProcessMemory {
            name: "Backend (Rust)".to_string(),
            mb: read_pss_kb(&my_pid_str) / 1024.0,
        }];

        // Walk /proc to find child processes (WebKitWebProcess, WebKitNetworkProcess, etc.)
        if let Ok(entries) = std::fs::read_dir("/proc") {
            for entry in entries.flatten() {
                let fname = entry.file_name();
                let fname_str = fname.to_string_lossy();
                if !fname_str.chars().all(|c| c.is_ascii_digit()) {
                    continue;
                }
                if *fname_str == *my_pid_str {
                    continue;
                }
                let stat_path = format!("/proc/{fname_str}/stat");
                if let Ok(stat) = std::fs::read_to_string(&stat_path) {
                    // Format: pid (comm) state ppid ...
                    // Find closing ')' to skip comm which may contain spaces
                    if let Some(after_comm) = stat.rfind(')') {
                        let fields: Vec<&str> = stat[after_comm + 2..].split_whitespace().collect();
                        // fields[0] = state, fields[1] = ppid
                        if let Some(ppid) = fields.get(1) {
                            if *ppid == my_pid_str {
                                processes.push(ProcessMemory {
                                    name: process_label(&fname_str),
                                    mb: read_pss_kb(&fname_str) / 1024.0,
                                });
                            }
                        }
                    }
                }
            }
        }

        let total_mb = processes.iter().map(|p| p.mb).sum();
        processes[1..].sort_by(|a, b| b.mb.partial_cmp(&a.mb).unwrap_or(std::cmp::Ordering::Equal));

        MemoryReport {
            processes,
            total_mb,
            platform: "Linux".to_string(),
        }
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

            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot.is_null() {
                return MemoryReport {
                    processes: vec![],
                    total_mb: 0.0,
                    platform: "Windows".to_string(),
                };
            }

            let mut proc_list: Vec<(u32, u32, String)> = Vec::new();
            let mut entry: PROCESSENTRY32W = mem::zeroed();
            entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;

            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    let end = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let exe = String::from_utf16_lossy(&entry.szExeFile[..end]);
                    proc_list.push((entry.th32ProcessID, entry.th32ParentProcessID, exe));
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
                for &(pid, ppid, _) in &proc_list {
                    if ppid == parent && !pids.contains(&pid) {
                        pids.push(pid);
                    }
                }
                i += 1;
            }

            let mut processes = Vec::new();
            let mut webview_idx = 0u32;
            for &pid in &pids {
                let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
                if !handle.is_null() {
                    let mut pmc: PROCESS_MEMORY_COUNTERS = mem::zeroed();
                    pmc.cb = mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                    if GetProcessMemoryInfo(handle, &mut pmc, pmc.cb) != 0 {
                        let mb = pmc.WorkingSetSize as f64 / (1024.0 * 1024.0);
                        let name = if pid == my_pid {
                            "Backend (Rust)".to_string()
                        } else {
                            let exe = proc_list
                                .iter()
                                .find(|(p, _, _)| *p == pid)
                                .map(|(_, _, e)| e.as_str())
                                .unwrap_or("unknown");
                            if exe.contains("msedgewebview2") || exe.contains("WebView") {
                                webview_idx += 1;
                                format!("WebView2 #{webview_idx}")
                            } else {
                                exe.to_string()
                            }
                        };
                        processes.push(ProcessMemory { name, mb });
                    }
                    CloseHandle(handle);
                }
            }

            let total_mb = processes.iter().map(|p| p.mb).sum();
            processes[1..]
                .sort_by(|a, b| b.mb.partial_cmp(&a.mb).unwrap_or(std::cmp::Ordering::Equal));

            MemoryReport {
                processes,
                total_mb,
                platform: "Windows".to_string(),
            }
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        MemoryReport {
            processes: vec![],
            total_mb: 0.0,
            platform: std::env::consts::OS.to_string(),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    PROCESS_START.set(std::time::Instant::now()).ok();

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
            get_memory_report,
            get_startup_elapsed_ms,
        ])
        .setup(|app| {
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
