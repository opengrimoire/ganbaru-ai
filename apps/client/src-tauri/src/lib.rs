use std::path::PathBuf;
use std::process::Stdio;
use tauri::Manager;

mod calendar_import;
mod db;
mod db_path;
mod notification;
mod themes;
mod tray;
mod vault;

static PROCESS_START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
static PLATFORM_LABEL: std::sync::OnceLock<String> = std::sync::OnceLock::new();
const DELAYED_RELAUNCH_MS_ENV: &str = "GANBARUAI_DELAYED_RELAUNCH_MS";
const DELAYED_RELAUNCH_TARGET_ENV: &str = "GANBARUAI_DELAYED_RELAUNCH_TARGET";

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

/// Delete database files (main, WAL, SHM) and quit the app.
/// Used to factory reset application state.
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

/// Path to the persisted benchmark state file. Lives in `app_config_dir`,
/// not the user's vault, so a `reset_database` call (which only deletes the
/// SQLite files) does not blow it away mid-run, and the file never pollutes
/// the vault folder users back up. Used by the in-app benchmark harness to
/// hand state across the Phase A -> restart -> Phase B boundary.
fn benchmark_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut p = app.path().app_config_dir().map_err(|e| e.to_string())?;
    p.push("benchmark-state.json");
    Ok(p)
}

/// Path to the isolated SQLite file the benchmark harness uses for both
/// phases. Lives next to the user's real DB but is never opened during
/// normal app operation. The harness deletes it before each run and after
/// the summary is closed.
fn benchmark_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut p = app.path().app_config_dir().map_err(|e| e.to_string())?;
    p.push("ganbaruai-benchmark.db");
    Ok(p)
}

/// Delete the benchmark DB file together with its WAL and SHM sidecars.
/// SQLite on Linux unlinks open files cleanly; on Windows the SQL plugin
/// opens with `FILE_SHARE_DELETE`, so unlinking succeeds even while a
/// connection is held. The space is reclaimed when the process exits.
fn delete_benchmark_db_files(app: &tauri::AppHandle) -> Result<(), String> {
    let base = benchmark_db_path(app)?;
    for suffix in &["", "-wal", "-shm"] {
        let mut path = base.clone();
        let name = format!("{}{}", path.file_name().unwrap().to_string_lossy(), suffix);
        path.set_file_name(name);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Idempotent cleanup of any prior benchmark DB before a new run begins.
/// Called from the runner when the user confirms a benchmark, so a crashed
/// previous run does not feed stale data into Phase A.
#[tauri::command]
fn prepare_benchmark_db(app: tauri::AppHandle) -> Result<(), String> {
    delete_benchmark_db_files(&app)
}

/// Same operation as `prepare_benchmark_db`. Separate command for intent
/// clarity at the call site (run-finished cleanup vs run-starting cleanup).
#[tauri::command]
fn teardown_benchmark_db(app: tauri::AppHandle) -> Result<(), String> {
    delete_benchmark_db_files(&app)
}

#[tauri::command]
fn read_benchmark_state(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = benchmark_state_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(contents))
}

#[tauri::command]
fn write_benchmark_state(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = benchmark_state_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_benchmark_state(app: tauri::AppHandle) -> Result<(), String> {
    let path = benchmark_state_path(&app)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Replace the running process with a fresh launch of the same binary.
/// `app.restart()` returns `!`, so this command never returns to the JS
/// caller. The frontend must fire-and-forget (no `await` on the IPC
/// response).
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

/// Exit this process and let a short-lived helper reopen the app after a
/// fixed delay. The benchmark startup harness uses this so repeated launch
/// samples do not run as instant warm restarts.
#[tauri::command]
fn restart_app_after_delay(app: tauri::AppHandle, delay_ms: u64) -> Result<(), String> {
    spawn_delayed_relaunch_helper(delay_ms)?;
    app.exit(0);
    Ok(())
}

fn spawn_delayed_relaunch_helper(delay_ms: u64) -> Result<(), String> {
    let helper_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let target_exe = relaunch_target_path(&helper_exe);
    std::process::Command::new(helper_exe)
        .env(DELAYED_RELAUNCH_MS_ENV, delay_ms.to_string())
        .env(DELAYED_RELAUNCH_TARGET_ENV, target_exe)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn relaunch_target_path(fallback: &std::path::Path) -> PathBuf {
    #[cfg(target_os = "linux")]
    if let Ok(appimage) = std::env::var("APPIMAGE") {
        if !appimage.trim().is_empty() {
            return PathBuf::from(appimage);
        }
    }
    fallback.to_path_buf()
}

fn run_delayed_relaunch_helper_if_needed() -> bool {
    let Ok(delay_raw) = std::env::var(DELAYED_RELAUNCH_MS_ENV) else {
        return false;
    };
    let Ok(delay_ms) = delay_raw.parse::<u64>() else {
        return false;
    };
    let target = std::env::var(DELAYED_RELAUNCH_TARGET_ENV)
        .map(PathBuf::from)
        .or_else(|_| std::env::current_exe());
    let Ok(target) = target else {
        return true;
    };
    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
    let _ = std::process::Command::new(target)
        .env_remove(DELAYED_RELAUNCH_MS_ENV)
        .env_remove(DELAYED_RELAUNCH_TARGET_ENV)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    true
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

fn platform_label() -> String {
    PLATFORM_LABEL.get_or_init(detect_platform_label).clone()
}

#[cfg(target_os = "linux")]
fn detect_platform_label() -> String {
    if let Ok(content) = std::fs::read_to_string("/etc/os-release") {
        for line in content.lines() {
            if let Some(value) = line.strip_prefix("PRETTY_NAME=") {
                let pretty = value.trim().trim_matches('"');
                if !pretty.is_empty() {
                    return format!("Linux {pretty}");
                }
            }
        }
    }
    "Linux".to_string()
}

#[cfg(target_os = "windows")]
fn detect_platform_label() -> String {
    if let Ok(output) = std::process::Command::new("cmd")
        .args(["/C", "ver"])
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        if let Some(version) = parse_windows_version(&text) {
            let major = windows_marketing_version(&version);
            return format!("{major} ({version})");
        }
    }
    "Windows".to_string()
}

#[cfg(target_os = "windows")]
fn parse_windows_version(text: &str) -> Option<String> {
    let start = text.find("Version ")? + "Version ".len();
    let rest = &text[start..];
    let end = rest
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(rest.len());
    let version = rest[..end].trim();
    if version.is_empty() {
        None
    } else {
        Some(version.to_string())
    }
}

#[cfg(target_os = "windows")]
fn windows_marketing_version(version: &str) -> &'static str {
    let build = version
        .split('.')
        .nth(2)
        .and_then(|part| part.parse::<u32>().ok())
        .unwrap_or(0);
    if build >= 22_000 {
        "Windows 11"
    } else {
        "Windows 10"
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn detect_platform_label() -> String {
    std::env::consts::OS.to_string()
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
                    return "Network".to_string();
                }
                if comm.contains("WebKit") {
                    return "Frontend".to_string();
                }
                return comm.to_string();
            }
            format!("PID {pid}")
        }

        let my_pid = std::process::id();
        let my_pid_str = my_pid.to_string();
        let mut processes = vec![ProcessMemory {
            name: "Backend".to_string(),
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
            platform: platform_label(),
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
                    platform: platform_label(),
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
                            "Backend".to_string()
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
                platform: platform_label(),
            }
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        MemoryReport {
            processes: vec![],
            total_mb: 0.0,
            platform: platform_label(),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if run_delayed_relaunch_helper_if_needed() {
        return;
    }
    PROCESS_START.set(std::time::Instant::now()).ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin({
            let user_db = if cfg!(debug_assertions) {
                "sqlite:ganbaruai-dev.db"
            } else {
                "sqlite:ganbaruai.db"
            };
            // The benchmark DB shares the schema with the user DB so the
            // harness exercises the same code paths. Migrations are keyed
            // per URL by the SQL plugin, so register both up front; whichever
            // file the JS opens first will run them on demand.
            tauri_plugin_sql::Builder::default()
                .add_migrations(user_db, db::migrations())
                .add_migrations("sqlite:ganbaruai-benchmark.db", db::migrations())
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
            read_benchmark_state,
            write_benchmark_state,
            clear_benchmark_state,
            prepare_benchmark_db,
            teardown_benchmark_db,
            restart_app,
            restart_app_after_delay,
            get_memory_report,
            get_startup_elapsed_ms,
            vault::vault_read_config,
            vault::vault_write_config,
            vault::vault_read_text,
            vault::vault_write_text,
            vault::vault_read_ics_zip_entries,
            calendar_import::calendar_bulk_import,
            themes::theme_insert,
            themes::theme_replace_content,
            themes::theme_delete,
            themes::theme_backfill_icon_label,
            themes::theme_record_dismissal,
            themes::theme_load_dismissals,
            themes::theme_rename,
            themes::theme_update_token_value,
            themes::theme_update_token_isolated,
            themes::theme_update_token_value_and_isolated,
            themes::theme_update_source_cascade,
            themes::theme_update_palette_slot,
            themes::theme_update_blend_canvas,
            themes::theme_rebake_non_isolated,
            themes::theme_reset_token_to_seed,
            themes::theme_reset_palette_slot_to_seed,
            themes::theme_reset_to_seed,
        ])
        .setup(|app| {
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
