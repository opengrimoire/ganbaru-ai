use super::*;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::Manager;

static PROCESS_START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
static PLATFORM_LABEL: std::sync::OnceLock<String> = std::sync::OnceLock::new();
static MAIN_WINDOW_FRONTEND_READY: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
const DELAYED_RELAUNCH_MS_ENV: &str = "GANBARU_AI_DELAYED_RELAUNCH_MS";
const DELAYED_RELAUNCH_MAX_MS: u64 = 10 * 60 * 1000;
const MAIN_WINDOW_REVEAL_FALLBACK_MS: u64 = 15_000;
const EXIT_CLEANUP_IDLE: u8 = 0;
const EXIT_CLEANUP_RUNNING: u8 = 1;
const EXIT_CLEANUP_COMPLETE: u8 = 2;

struct DeferredExitCompletion {
    app: tauri::AppHandle,
    state: std::sync::Arc<std::sync::atomic::AtomicU8>,
    exit_code: i32,
}

impl Drop for DeferredExitCompletion {
    fn drop(&mut self) {
        self.state
            .store(EXIT_CLEANUP_COMPLETE, std::sync::atomic::Ordering::Release);
        self.app.exit(self.exit_code);
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", windows))]
fn focus_main_window_for_second_launch(app: &tauri::AppHandle) {
    if !MAIN_WINDOW_FRONTEND_READY.load(std::sync::atomic::Ordering::Acquire) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn reveal_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    MAIN_WINDOW_FRONTEND_READY.store(true, std::sync::atomic::Ordering::Release);
    window.set_focus().map_err(|error| error.to_string())
}

fn schedule_main_window_reveal_fallback(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(
            MAIN_WINDOW_REVEAL_FALLBACK_MS,
        ));
        if MAIN_WINDOW_FRONTEND_READY.load(std::sync::atomic::Ordering::Acquire) {
            return;
        }
        eprintln!("frontend readiness timed out; revealing the main window");
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}

#[tauri::command]
fn get_startup_elapsed_ms() -> u64 {
    PROCESS_START
        .get()
        .map(|start| start.elapsed().as_millis() as u64)
        .unwrap_or(0)
}

fn clear_doomscrolling_enforcement_state_best_effort(app: &tauri::AppHandle, context: &str) {
    if let Err(error) = doomscrolling::clear_doomscrolling_enforcement_state(app) {
        eprintln!("failed to clear doomscrolling enforcement state {context}: {error}");
    }
}

#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) -> Result<bool, String> {
    #[cfg(debug_assertions)]
    {
        if window.is_devtools_open() {
            window.close_devtools();
            Ok(false)
        } else {
            window.open_devtools();
            Ok(true)
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = window;
        Err("DevTools are only available in development builds".to_string())
    }
}

#[tauri::command]
fn force_quit(
    app: tauri::AppHandle,
    overlays: tauri::State<'_, notification::PomodoroOverlayState>,
) {
    if overlays.is_active() {
        overlays.focus(&app);
        return;
    }
    clear_doomscrolling_enforcement_state_best_effort(&app, "before force quit");
    app.exit(0);
}

/// Delete database files (main, WAL, SHM) and quit the app.
/// Used to reset structured data without deleting the Ganbaru AI folder.
#[tauri::command]
async fn reset_database(app: tauri::AppHandle) -> Result<(), String> {
    let writable_vault = vault::active_writable_vault_path(&app)?;
    doomscrolling::clear_doomscrolling_enforcement_state(&app)?;
    db_path::close_all_sqlite_pools(&app).await?;
    let db_path = writable_vault.as_ref().join(vault::APP_SQLITE_FILE);

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
/// not the user's Ganbaru AI folder, so a `reset_database` call (which only deletes the
/// SQLite files) does not blow it away mid-run, and the file never pollutes
/// the folder users back up. Used by the in-app benchmark harness to
/// hand state across the Phase A -> restart -> Phase B boundary.
fn benchmark_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut p = app.path().app_config_dir().map_err(|e| e.to_string())?;
    p.push("benchmark-state.json");
    Ok(p)
}

/// Path to the isolated SQLite file the benchmark harness uses for both
/// phases. Lives in app config and is never opened during normal app
/// operation. The harness deletes it before each run and after the summary
/// is closed.
fn benchmark_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut p = app.path().app_config_dir().map_err(|e| e.to_string())?;
    p.push("benchmark.sqlite");
    Ok(p)
}

/// Delete the benchmark DB file together with its WAL and SHM sidecars.
/// SQLite on Linux unlinks open files cleanly. The benchmark commands close
/// the managed pool before deleting files so Windows can release handles too.
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
async fn prepare_benchmark_db(app: tauri::AppHandle) -> Result<(), String> {
    db_path::close_sqlite_pool(&app, db_path::BENCHMARK_SQLITE_URL).await?;
    delete_benchmark_db_files(&app)
}

/// Same operation as `prepare_benchmark_db`. Separate command for intent
/// clarity at the call site (run-finished cleanup vs run-starting cleanup).
#[tauri::command]
async fn teardown_benchmark_db(app: tauri::AppHandle) -> Result<(), String> {
    db_path::close_sqlite_pool(&app, db_path::BENCHMARK_SQLITE_URL).await?;
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

/// Request a fresh launch after completing native overlay cleanup.
#[tauri::command(async)]
fn restart_app(
    app: tauri::AppHandle,
    overlays: tauri::State<'_, notification::PomodoroOverlayState>,
) {
    overlays.shutdown(&app);
    clear_doomscrolling_enforcement_state_best_effort(&app, "before restart");
    app.request_restart();
}

/// Exit this process and let a short-lived helper reopen the app after a
/// fixed delay. The benchmark startup harness uses this so repeated launch
/// samples do not run as instant warm restarts.
#[tauri::command]
fn restart_app_after_delay(app: tauri::AppHandle, delay_ms: u64) -> Result<(), String> {
    spawn_delayed_relaunch_helper(delay_ms)?;
    clear_doomscrolling_enforcement_state_best_effort(&app, "before delayed restart");
    app.exit(0);
    Ok(())
}

fn spawn_delayed_relaunch_helper(delay_ms: u64) -> Result<(), String> {
    let helper_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(helper_exe)
        .env(
            DELAYED_RELAUNCH_MS_ENV,
            delay_ms.min(DELAYED_RELAUNCH_MAX_MS).to_string(),
        )
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
        let candidate = PathBuf::from(appimage);
        if is_valid_relaunch_target(&candidate) {
            return candidate;
        }
    }
    fallback.to_path_buf()
}

fn is_valid_relaunch_target(path: &std::path::Path) -> bool {
    path.is_absolute() && path.file_name().is_some() && path.exists()
}

fn parse_delayed_relaunch_ms(raw: &str) -> Option<u64> {
    raw.parse::<u64>()
        .ok()
        .map(|delay_ms| delay_ms.min(DELAYED_RELAUNCH_MAX_MS))
}

fn run_delayed_relaunch_helper_if_needed() -> bool {
    let Ok(delay_raw) = std::env::var(DELAYED_RELAUNCH_MS_ENV) else {
        return false;
    };
    let Some(delay_ms) = parse_delayed_relaunch_ms(&delay_raw) else {
        return false;
    };
    let Ok(helper_exe) = std::env::current_exe() else {
        return true;
    };
    let target = relaunch_target_path(&helper_exe);
    if !is_valid_relaunch_target(&target) {
        return true;
    }
    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
    let _ = std::process::Command::new(target)
        .env_remove(DELAYED_RELAUNCH_MS_ENV)
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

#[derive(serde::Serialize, Clone)]
struct MemoryMetric {
    name: String,
    slug: String,
    description: String,
}

#[derive(serde::Serialize)]
struct MemoryReport {
    processes: Vec<ProcessMemory>,
    total_mb: f64,
    platform: String,
    metric: MemoryMetric,
}

fn platform_label() -> String {
    PLATFORM_LABEL.get_or_init(detect_platform_label).clone()
}

fn memory_metric(name: &str, slug: &str, description: &str) -> MemoryMetric {
    MemoryMetric {
        name: name.to_string(),
        slug: slug.to_string(),
        description: description.to_string(),
    }
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
        struct LinuxMemoryReading {
            kb: f64,
            is_pss: bool,
        }

        fn read_linux_memory_kb(pid: &str) -> LinuxMemoryReading {
            // smaps_rollup gives PSS (Proportional Set Size): private memory
            // plus a fair share of shared memory. Avoids double-counting shared
            // libraries across processes.
            let path = format!("/proc/{pid}/smaps_rollup");
            if let Ok(content) = std::fs::read_to_string(&path) {
                for line in content.lines() {
                    if let Some(val) = line.strip_prefix("Pss:") {
                        return LinuxMemoryReading {
                            kb: val
                                .trim()
                                .trim_end_matches(" kB")
                                .trim()
                                .parse::<f64>()
                                .unwrap_or(0.0),
                            is_pss: true,
                        };
                    }
                }
            }
            // Fallback to VmRSS if smaps_rollup is unavailable.
            let path = format!("/proc/{pid}/status");
            if let Ok(content) = std::fs::read_to_string(path) {
                for line in content.lines() {
                    if let Some(val) = line.strip_prefix("VmRSS:") {
                        return LinuxMemoryReading {
                            kb: val
                                .trim()
                                .trim_end_matches(" kB")
                                .trim()
                                .parse::<f64>()
                                .unwrap_or(0.0),
                            is_pss: false,
                        };
                    }
                }
            }
            LinuxMemoryReading {
                kb: 0.0,
                is_pss: false,
            }
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

        fn process_memory(name: String, pid: &str, all_pss: &mut bool) -> ProcessMemory {
            let reading = read_linux_memory_kb(pid);
            if !reading.is_pss {
                *all_pss = false;
            }
            ProcessMemory {
                name,
                mb: reading.kb / 1024.0,
            }
        }

        let my_pid = std::process::id();
        let my_pid_str = my_pid.to_string();
        let mut all_pss = true;
        let mut processes = vec![process_memory(
            "Backend".to_string(),
            &my_pid_str,
            &mut all_pss,
        )];

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
                                processes.push(process_memory(
                                    process_label(&fname_str),
                                    &fname_str,
                                    &mut all_pss,
                                ));
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
            metric: if all_pss {
                memory_metric(
                    "PSS",
                    "pss",
                    "Proportional Set Size, private memory plus a fair share of shared memory.",
                )
            } else {
                memory_metric(
                    "PSS/RSS",
                    "pss_rss",
                    "PSS where available, with RSS fallback for processes that cannot report PSS.",
                )
            },
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::mem::size_of;
        use windows::Win32::Foundation::ERROR_NO_MORE_FILES;
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
            TH32CS_SNAPPROCESS,
        };
        use windows::Win32::System::ProcessStatus::{
            GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
        };
        use windows::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
        };
        use windows::core::{HRESULT, Owned};

        let my_pid = std::process::id();

        let snapshot = {
            // SAFETY: The flags request a system-wide process snapshot and do
            // not require any caller-provided pointers. Windows returns a fresh
            // owning handle on success.
            let snapshot = match unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) } {
                Ok(snapshot) => snapshot,
                Err(_) => {
                    return MemoryReport {
                        processes: vec![],
                        total_mb: 0.0,
                        platform: platform_label(),
                        metric: memory_metric(
                            "Working Set",
                            "working_set",
                            "Resident pages currently in physical memory. Shared pages may be counted per process.",
                        ),
                    };
                }
            };
            // SAFETY: The successful call above returned a fresh owning handle.
            // Ownership is transferred exactly once and released on drop.
            unsafe { Owned::new(snapshot) }
        };

        let mut proc_list: Vec<(u32, u32, String)> = Vec::new();
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        // SAFETY: `entry` is a valid PROCESSENTRY32W with dwSize initialized as
        // required by Process32FirstW and Process32NextW. `snapshot` owns a live
        // process snapshot for the duration of enumeration.
        match unsafe { Process32FirstW(*snapshot, &mut entry) } {
            Ok(()) => loop {
                let end = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let exe = String::from_utf16_lossy(&entry.szExeFile[..end]);
                proc_list.push((entry.th32ProcessID, entry.th32ParentProcessID, exe));

                // SAFETY: The snapshot handle is still open and `entry` remains a
                // valid output buffer for the next process entry.
                entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
                match unsafe { Process32NextW(*snapshot, &mut entry) } {
                    Ok(()) => {}
                    Err(error) if error.code() == HRESULT::from_win32(ERROR_NO_MORE_FILES.0) => {
                        break;
                    }
                    Err(error) => {
                        eprintln!("Windows process snapshot enumeration failed: {error}");
                        break;
                    }
                }
            },
            Err(error) if error.code() == HRESULT::from_win32(ERROR_NO_MORE_FILES.0) => {}
            Err(error) => eprintln!("Windows process snapshot initialization failed: {error}"),
        }

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
            // SAFETY: The process ID comes from the current process or the Windows
            // process snapshot. No pointers are passed, handle inheritance is
            // disabled, and Windows returns a fresh owning handle on success.
            if let Ok(handle) =
                unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid) }
            {
                // SAFETY: `OpenProcess` returned a fresh owning handle above.
                // Ownership is transferred exactly once and released on drop.
                let handle = unsafe { Owned::new(handle) };
                let mut pmc = PROCESS_MEMORY_COUNTERS {
                    cb: size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
                    ..Default::default()
                };
                // SAFETY: `handle` is an open process handle and `pmc` is a valid
                // writable output buffer whose cb field matches its struct size.
                // Windows does not retain the handle or output pointer.
                if unsafe { GetProcessMemoryInfo(*handle, &mut pmc, pmc.cb) }.is_ok() {
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
            }
        }

        let total_mb = processes.iter().map(|p| p.mb).sum();
        if processes.len() > 1 {
            processes[1..]
                .sort_by(|a, b| b.mb.partial_cmp(&a.mb).unwrap_or(std::cmp::Ordering::Equal));
        }

        MemoryReport {
            processes,
            total_mb,
            platform: platform_label(),
            metric: memory_metric(
                "Working Set",
                "working_set",
                "Resident pages currently in physical memory. Shared pages may be counted per process.",
            ),
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        MemoryReport {
            processes: vec![],
            total_mb: 0.0,
            platform: platform_label(),
            metric: memory_metric(
                "Unavailable",
                "unavailable",
                "Memory reporting is not implemented for this platform yet.",
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delayed_relaunch_delay_is_bounded() {
        assert_eq!(parse_delayed_relaunch_ms("250"), Some(250));
        assert_eq!(
            parse_delayed_relaunch_ms(&(DELAYED_RELAUNCH_MAX_MS + 1).to_string()),
            Some(DELAYED_RELAUNCH_MAX_MS)
        );
        assert_eq!(parse_delayed_relaunch_ms("not-a-number"), None);
    }

    #[test]
    fn relaunch_target_validation_requires_existing_absolute_path() {
        assert!(!is_valid_relaunch_target(std::path::Path::new(
            "relative-binary"
        )));
        assert!(!is_valid_relaunch_target(std::path::Path::new(
            "/definitely/not/ganbaru-ai"
        )));
        let current_exe = std::env::current_exe().expect("test executable path should exist");
        assert!(is_valid_relaunch_target(&current_exe));
    }

    #[test]
    fn project_history_commands_are_registered_at_defining_modules() {
        let handlers = include_str!("desktop_runtime.rs");
        for command in [
            "notes::project_history::schedule::notes_initialize_project_history",
            "notes::project_history::schedule::notes_flush_due_project_history",
            "notes::project_history::reads::notes_list_project_history_versions",
            "notes::project_history::reads::notes_load_project_history_tree",
            "notes::project_history::reads::notes_load_project_history_page",
            "notes::project_history::retention::notes_get_history_retention_impact",
            "notes::project_history::retention::notes_prune_project_history",
            "notes::project_history::commands::notes_preview_project_history_restore",
            "notes::project_history::commands::notes_restore_project_history_version",
        ] {
            assert!(handlers.contains(command), "missing handler {command}");
        }
    }
}

pub fn run(context: tauri::Context<tauri::Wry>) {
    crate::install_default_tls_crypto_provider();

    if run_delayed_relaunch_helper_if_needed() {
        return;
    }
    PROCESS_START.set(std::time::Instant::now()).ok();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window_for_second_launch(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(db_path::DatabaseState::default())
        .manage(vault::ownership::VaultOwnershipManager::default())
        .manage(vault::handoff::state::PairingManager::default())
        .manage(vault::handoff::CoordinatorLifecycle::default())
        .manage(vault::handoff::receiver::ReceiverLifecycle::default())
        .manage(vault::handoff::source::SourceLifecycle::default())
        .manage(notification::AppSoundState::default())
        .manage(notification::PomodoroOverlayState::default())
        .manage(media_player::MediaPlayerState::default())
        .manage(soundscape::SoundscapeEngineState::default())
        .manage(chat::settings_commands::ChatSettingsState::default())
        .manage(chat::provider_files::ProviderFileState::default())
        .manage(chat::internal_mcp::InternalMcpRegistry::default())
        .manage(chat::preview::ChatPreviewManager::default())
        .manage(chat::runtime::ChatRuntimeRegistry::default())
        .manage(chat::review_engine::ChatReviewRegistry::default())
        .manage(chat::terminal::ChatTerminalRegistry::default())
        .manage(chat::workspace_mutation::ChatWorkspaceMutationRegistry::default())
        .manage(chat::workspace_observer::ChatWorkspaceObserverRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let overlays = window.state::<notification::PomodoroOverlayState>();
                if overlays.is_active() {
                    api.prevent_close();
                    overlays.focus(window);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            chat::workspace_commands::projects_list_working_folders,
            chat::workspace_commands::projects_list_working_folders_cached,
            chat::workspace_commands::projects_add_external_working_folder,
            chat::workspace_commands::projects_rename_working_folder,
            chat::workspace_commands::projects_locate_working_folder,
            chat::workspace_commands::projects_rebind_working_folder,
            chat::workspace_commands::projects_unbind_working_folder,
            chat::workspace_commands::projects_archive_working_folder,
            chat::workspace_commands::projects_restore_working_folder,
            chat::workspace_commands::projects_open_working_folder,
            chat::workspace_commands::projects_remove_working_folder,
            chat::workspace_commands::projects_recreate_managed_working_folder,
            chat::workspace_commands::projects_remember_working_folder,
            chat::workspace_commands::projects_last_working_folder,
            chat::workspace_files::project_list_working_folder_directory,
            chat::workspace_files::project_preview_working_folder_file,
            chat::workspace_files::project_save_working_folder_file,
            chat::workspace_files::project_save_working_folder_file_copy,
            chat::workspace_files::project_recreate_working_folder_file,
            chat::workspace_files::project_open_working_folder_file,
            chat::workspace_observer::chat_watch_workspace,
            chat::workspace_observer::chat_unwatch_workspace,
            chat::execution_environment::chat_list_execution_environments,
            chat::execution_environment::chat_create_worktree_environment,
            chat::execution_environment::chat_select_thread_execution_environment,
            chat::execution_environment::chat_read_thread_execution_environment,
            chat::execution_environment::chat_remove_worktree_environment,
            chat::resource_commands::chat_resource_list,
            chat::resource_commands::chat_resource_read,
            chat::review_commands::chat_list_review_comments,
            chat::review_commands::chat_create_review_comment,
            chat::review_commands::chat_set_review_comment_resolved,
            chat::review_commands::chat_attach_review_comment,
            chat::review_engine::chat_open_review,
            chat::review_engine::chat_read_review_patches,
            chat::review_engine::chat_apply_review_action,
            chat::terminal_commands::chat_list_terminals,
            chat::terminal_commands::chat_read_terminal_layout,
            chat::terminal_commands::chat_save_terminal_panel_layout,
            chat::terminal_commands::chat_terminal_create,
            chat::terminal_commands::chat_terminal_snapshot,
            chat::terminal_commands::chat_terminal_input,
            chat::terminal_commands::chat_terminal_resize,
            chat::terminal_commands::chat_terminal_close,
            chat::terminal_commands::chat_terminal_import_context,
            chat::checkpoint_commands::chat_run_checkpoint_cleanup,
            chat::diagnostics_commands::chat_read_diagnostics,
            chat::diagnostics_commands::chat_update_diagnostic_preferences,
            chat::diagnostics_commands::chat_delete_diagnostics,
            chat::diagnostics_commands::chat_export_redacted_diagnostics,
            chat::diagnostics_commands::chat_stop_all_processes,
            chat::diagnostics_commands::chat_rebuild_projections,
            chat::restore_commands::chat_preview_checkpoint_restore,
            chat::restore_commands::chat_execute_checkpoint_restore,
            chat::settings_commands::chat_read_settings,
            chat::settings_commands::chat_discover_default_providers,
            chat::settings_commands::chat_set_last_selected_thread,
            chat::settings_commands::chat_save_provider,
            chat::settings_commands::chat_set_provider_enabled,
            chat::settings_commands::chat_remove_provider,
            chat::settings_commands::chat_test_provider,
            chat::settings_commands::chat_probe_provider,
            chat::settings_commands::chat_refresh_all_providers,
            chat::settings_commands::chat_refresh_provider_models,
            chat::settings_commands::chat_update_provider_models,
            chat::settings_commands::chat_update_behavior,
            chat::settings_commands::chat_update_panels,
            chat::settings_commands::chat_set_working_folder_provider_preference,
            chat::settings_commands::chat_remember_composer_selection,
            chat::settings_commands::chat_replace_credential,
            chat::settings_commands::chat_remove_credential,
            chat::settings_commands::chat_pick_provider_executable,
            chat::settings_commands::chat_pick_provider_home,
            chat::provider_files::chat_read_provider_files,
            chat::provider_files::chat_save_provider_file,
            chat::channel_commands::chat_list_channels,
            chat::channel_commands::chat_list_navigation_channels,
            chat::channel_commands::chat_search_channels,
            chat::channel_commands::chat_read_channel,
            chat::channel_commands::chat_create_channel,
            chat::channel_commands::chat_update_channel_details,
            chat::channel_commands::chat_archive_channel,
            chat::channel_commands::chat_restore_channel,
            chat::channel_commands::chat_set_channel_read,
            chat::coordination_commands::chat_list_teammates,
            chat::coordination_commands::chat_read_teammate,
            chat::coordination_commands::chat_create_teammate,
            chat::coordination_commands::chat_archive_teammate,
            chat::coordination_commands::chat_delete_unused_teammate,
            chat::coordination_commands::access::chat_list_access_profiles,
            chat::coordination_commands::access::chat_create_access_profile,
            chat::coordination_commands::access::chat_duplicate_access_profile,
            chat::coordination_commands::access::chat_preview_access_profile_revision,
            chat::coordination_commands::access::chat_publish_access_profile_revision,
            chat::coordination_commands::access::chat_archive_access_profile,
            chat::coordination_commands::access::chat_read_teammate_access,
            chat::coordination_commands::access::chat_read_channel_roster,
            chat::coordination_commands::access::chat_list_assignment_targets,
            chat::coordination_commands::access::chat_preview_channel_membership_removal,
            chat::coordination_commands::access::chat_preview_teammate_access,
            chat::coordination_commands::access::chat_replace_teammate_access,
            chat::scratch_commands::chat_list_scratch_scopes,
            chat::scratch_commands::chat_browse_scratch_generation,
            chat::scratch_commands::chat_promote_scratch_file,
            chat::scratch_commands::chat_preview_scratch_cleanup,
            chat::scratch_commands::chat_cleanup_scratch,
            chat::coordination_commands::chat_list_channel_memberships,
            chat::coordination_commands::chat_read_project_primary_working_folder,
            chat::coordination_commands::chat_set_project_primary_working_folder,
            chat::coordination_commands::chat_post_message,
            chat::coordination_commands::chat_schedule_message,
            chat::coordination_commands::chat_list_scheduled_messages,
            chat::coordination_commands::chat_cancel_scheduled_message,
            chat::coordination_commands::chat_retry_scheduled_message,
            chat::coordination_commands::chat_send_scheduled_message_now,
            chat::coordination_commands::chat_dispatch_due_scheduled_messages,
            chat::coordination_commands::chat_read_channel_page,
            chat::coordination_commands::chat_read_reply_thread_page,
            chat::coordination_commands::chat_search_messages,
            chat::coordination_commands::chat_cancel_assignment,
            chat::coordination_commands::chat_retry_assignment,
            chat::coordination_commands::chat_recover_assignment_dispatch_jobs,
            chat::thread_commands::chat_list_project_shells,
            chat::thread_commands::chat_list_threads,
            chat::thread_commands::chat_list_thread_window,
            chat::thread_commands::chat_read_thread_shell,
            chat::thread_commands::chat_search_thread_titles,
            chat::thread_commands::chat_read_timeline_page,
            chat::thread_commands::chat_read_timeline_turn,
            chat::thread_commands::chat_fork_thread,
            chat::thread_commands::chat_open_external_url,
            chat::thread_commands::chat_rename_thread,
            chat::thread_commands::chat_set_thread_read,
            chat::thread_commands::chat_archive_thread,
            chat::thread_commands::chat_restore_thread,
            chat::thread_commands::chat_delete_thread_permanently,
            chat::thread_commands::chat_list_provider_cleanup_jobs,
            chat::git_commands::chat_git_status,
            chat::git_commands::chat_git_diff,
            chat::git_commands::chat_git_stage,
            chat::git_commands::chat_git_unstage,
            chat::git_commands::chat_git_commit,
            chat::git_commands::chat_git_fetch,
            chat::git_commands::chat_git_pull,
            chat::git_commands::chat_git_push,
            chat::git_commands::chat_git_remotes,
            chat::git_commands::chat_git_branches,
            chat::git_commands::chat_git_worktrees,
            chat::git_commands::chat_git_initialize,
            chat::git_commands::chat_git_clone,
            chat::git_commands::chat_git_discard,
            chat::git_commands::chat_git_delete_branch,
            chat::source_control::chat_discover_source_control,
            chat::source_control::chat_list_hosted_change_requests,
            chat::source_control::chat_create_hosted_change_request,
            chat::source_control::chat_checkout_hosted_change_request,
            chat::source_control::chat_configure_bitbucket_credential,
            chat::source_control::chat_remove_bitbucket_credential,
            chat::preview::chat_preview_status,
            chat::preview::chat_preview_discover_servers,
            chat::preview::chat_preview_open,
            chat::preview::chat_preview_navigate,
            chat::preview::chat_preview_resize,
            chat::preview::chat_preview_set_visible,
            chat::preview::chat_preview_back,
            chat::preview::chat_preview_forward,
            chat::preview::chat_preview_refresh,
            chat::preview::chat_preview_snapshot,
            chat::preview::chat_preview_screenshot,
            chat::preview::chat_preview_recording_start,
            chat::preview::chat_preview_recording_stop,
            chat::preview::chat_preview_evaluate,
            chat::preview::chat_preview_click,
            chat::preview::chat_preview_type,
            chat::preview::chat_preview_press,
            chat::preview::chat_preview_scroll,
            chat::preview::chat_preview_close,
            chat::draft_commands::chat_save_draft,
            chat::draft_commands::chat_read_draft,
            chat::draft_commands::chat_delete_draft,
            chat::interaction_commands::chat_import_image,
            chat::interaction_commands::chat_pick_images,
            chat::interaction_commands::chat_attachment_data_url,
            chat::interaction_commands::chat_read_attachments,
            chat::interaction_commands::chat_import_text_snippet,
            chat::interaction_commands::chat_search_working_folder_paths,
            chat::interaction_commands::chat_validate_working_folder_mentions,
            chat::interaction_commands::chat_list_prompt_catalog,
            chat::interaction_commands::chat_recover_interrupted_turns,
            chat::interaction_commands::chat_read_interaction_state,
            chat::interaction_commands::chat_compact_context,
            chat::interaction_commands::chat_read_mcp_status,
            chat::interaction_commands::chat_set_full_access_trust,
            chat::interaction_commands::chat_has_full_access_trust,
            chat::interaction_commands::chat_save_queued_followup,
            chat::interaction_commands::chat_cancel_queued_followup,
            chat::interaction_commands::chat_mark_queued_followup_dispatched,
            chat::interaction_commands::chat_read_user_input_draft,
            chat::interaction_commands::chat_save_user_input_draft,
            chat::interaction_commands::chat_stop_session,
            chat::send_commands::chat_send_turn,
            chat::send_commands::chat_steer_turn,
            chat::send_commands::chat_resolve_approval,
            chat::send_commands::chat_resolve_user_input,
            notification::commands::show_pomodoro_notification,
            notification::commands::show_paused_focus_notification,
            notification::commands::show_event_notification,
            notification::commands::show_notes_notification,
            notification::commands::show_benchmark_notification,
            notification::commands::show_doomscrolling_desktop_block_notification,
            notification::commands::show_doomscrolling_desktop_limit_notification,
            notification::show_break_overlay,
            notification::close_pomodoro_overlay,
            notification::set_pomodoro_overlay_state,
            notification::idle::get_idle_status,
            pomodoro::pomodoro_can_start_automatically,
            notification::commands::play_app_sound,
            notification::commands::play_alert_sound,
            notification::show_idle_overlay,
            notification::show_pomodoro_completion_overlay,
            music::music_get_playback_state,
            music::music_pick_artwork_file,
            music::music_pick_and_read_interchange_file,
            music::music_pick_and_write_interchange_file,
            music::music_artwork_data_url,
            music::music_embedded_artwork_data_url,
            music::library::commands::music_library_upsert_item,
            music::library::commands::music_library_upsert_local_location,
            music::library::commands::music_library_start_local_refresh,
            music::library::commands::music_library_refresh_progress,
            music::library::commands::music_library_cancel_refresh,
            music::library::commands::music_library_upsert_youtube_video,
            music::library::commands::music_library_youtube_duplicate_count,
            music::library::commands::music_library_apply_youtube_playlist_snapshot,
            music::library::commands::music_library_report_youtube_source_failure,
            music::library::commands::music_library_create_relink_plan,
            music::library::commands::music_library_relink_plan_entries,
            music::library::commands::music_library_apply_relink_plan,
            music::library::commands::music_library_cancel_relink_plan,
            music::library::commands::music_library_source_removal_impact,
            music::library::commands::music_library_remove_source,
            music::library::commands::music_library_restore_source,
            music::library::commands::music_library_create_playlist,
            music::library::commands::music_library_update_playlist,
            music::library::commands::music_library_reorder_playlists,
            music::library::commands::music_library_duplicate_playlist,
            music::library::commands::music_library_playlist_delete_impact,
            music::library::commands::music_library_delete_playlist,
            music::library::commands::music_library_set_review_state,
            music::library::commands::music_library_set_metadata_overrides,
            music::library::commands::music_library_set_item_signals,
            music::library::commands::music_library_upsert_memberships,
            music::library::commands::music_library_bulk_edit_memberships,
            music::library::commands::music_library_membership_matrix,
            music::library::commands::music_library_reorder_playlist,
            music::library::commands::music_library_playlist_playback_entries,
            music::library::commands::music_library_record_listening,
            music::library::commands::music_library_recent_selections,
            music::library::commands::music_library_context_assignments,
            music::library::commands::music_library_context_assignments_for_playlists,
            music::library::commands::music_library_replace_context_assignments,
            music::library::commands::music_library_bulk_set_review_state,
            music::library::commands::music_library_apply_review_selection,
            music::library::commands::music_library_bulk_snooze,
            music::library::commands::music_library_save_advanced_membership,
            music::library::commands::music_library_remove_memberships,
            music::library::commands::music_library_upsert_snooze,
            music::library::commands::music_library_remove_snooze,
            music::library::commands::music_library_reset_statistics,
            music::library::commands::music_library_import_interchange,
            music::library::commands::music_library_item_window,
            music::library::commands::music_library_playlist_summaries,
            music::library::commands::music_library_source_summaries,
            music::library::commands::music_library_issues,
            music::library::commands::music_library_inspector_detail,
            music::library::commands::music_library_rebuild_search_index,
            music::library::commands::music_library_local_roots,
            music::library::commands::music_library_create_local_root,
            music::library::commands::music_library_preview_item_repair,
            music::library::commands::music_library_apply_item_repair,
            music::library::commands::music_library_undo_item_repair,
            music::library::commands::music_library_source_collections,
            music::library::commands::music_library_playlist_detail,
            music::library::commands::music_library_upsert_source_collection,
            music::library::commands::music_library_soundscapes,
            music::library::commands::music_library_soundscape_groups,
            music::library::commands::music_library_upsert_soundscape_group,
            music::library::commands::music_library_remove_soundscape_group,
            music::library::commands::music_library_upsert_soundscape,
            music::library::commands::music_library_remove_soundscape,
            music::library::commands::music_library_soundscape_state,
            music::library::commands::music_library_update_soundscape_state,
            music::root_bindings::music_get_local_root_bindings,
            music::root_bindings::music_set_local_root_binding,
            music::root_bindings::music_clear_local_root_binding,
            music::music_pick_media_folder,
            music::music_detect_default_folder,
            music::music_pick_root_binding_folder,
            music::music_pick_media_file,
            music::music_pick_soundscape_file,
            music::host::music_register_embedded_artwork,
            music::host::music_register_media_file,
            music::host::music_retain_hosted_media,
            music::host::music_unregister_hosted_media,
            music::music_reveal_local_file,
            music::music_save_playback_state,
            music::host::music_youtube_host_url,
            music::youtube_metadata::music_youtube_metadata,
            music::youtube_thumbnail::music_youtube_thumbnail,
            media_controls::update_media_controls,
            media_player::media_player_probe,
            media_player::media_player_load,
            media_player::media_player_play,
            media_player::media_player_pause,
            media_player::media_player_stop,
            media_player::media_player_seek,
            media_player::media_player_set_volume,
            media_player::media_player_set_muted,
            media_player::media_player_set_rate,
            media_player::media_player_snapshot,
            soundscape::soundscape_start,
            soundscape::soundscape_pause,
            soundscape::soundscape_resume,
            soundscape::soundscape_stop,
            soundscape::soundscape_set_volume,
            soundscape::soundscape_set_levels,
            soundscape::soundscape_recover,
            soundscape::soundscape_snapshot,
            tray::update_music_tray,
            tray::update_tray,
            force_quit,
            reset_database,
            read_benchmark_state,
            write_benchmark_state,
            clear_benchmark_state,
            prepare_benchmark_db,
            teardown_benchmark_db,
            benchmark_seed::benchmark_seed_pomodoro_history,
            benchmark_seed::benchmark_seed_dense_music_library,
            restart_app,
            updates::updater_install_context,
            restart_app_after_delay,
            toggle_devtools,
            get_memory_report,
            get_startup_elapsed_ms,
            reveal_main_window,
            vault::vault_read_app_state,
            vault::vault_device_id,
            vault::vault_default_location,
            vault::vault_use_default_folder,
            vault::vault_active_info,
            vault::ownership::vault_ownership_status,
            vault::handoff::handoff_create_pairing_invitation,
            #[cfg(target_os = "linux")]
            vault::handoff::handoff_grant_network_access,
            #[cfg(target_os = "linux")]
            vault::handoff::handoff_revoke_network_access,
            vault::handoff::handoff_decode_pairing_qr,
            vault::handoff::handoff_enroll,
            vault::handoff::handoff_suggested_device_label,
            vault::handoff::handoff_pairing_status,
            vault::handoff::handoff_unlink,
            vault::handoff::handoff_recover_local_copy,
            vault::handoff::handoff_request_owner_bundle,
            vault::handoff::receiver::handoff_receive_desktop_bundle,
            vault::handoff::receiver::handoff_cancel_receive,
            vault::vault_pick_create,
            vault::vault_pick_open,
            vault::vault_select_recent,
            vault::vault_reveal_active,
            vault::vault_read_config,
            vault::vault_patch_config,
            vault::vault_pick_and_read_ics_import,
            vault::vault_pick_and_write_ics_export,
            vault::vault_pick_and_read_theme_json,
            vault::vault_pick_and_write_theme_json,
            calendar_reads::calendar_load_window,
            calendar_reads::calendar_load_pomodoro_scheduler_window,
            calendar_reads::calendar_load_panel_event,
            calendar_reads::calendar_load_full_event,
            calendar_reads::calendar_list_event_ids_for_calendar,
            calendar_reads::calendar_load_icalendar_timezones_for_calendar,
            calendar_reads::calendar_load_icalendar_passthrough_components_for_calendar,
            calendar_reads::calendar_load_icalendar_export_metadata_for_calendar,
            recurrence::calendar_expand_render_events,
            calendar_events::commands::calendar_add_event,
            calendar_events::commands::calendar_delete_event,
            calendar_events::commands::calendar_archive_event,
            calendar_events::commands::calendar_apply_delete_archive_plan,
            calendar_events::commands::calendar_apply_recurrence_commit_plan,
            calendar_events::commands::calendar_restore_archived_event,
            calendar_events::commands::calendar_clear_events,
            calendar_events::commands::calendar_update_event,
            calendar_events::commands::calendar_detach_instance,
            calendar_events::commands::calendar_split_series,
            calendar_events::progress::calendar_has_progress_segments,
            calendar_events::progress::calendar_progress_dates_before,
            calendar_import::calendar_bulk_import,
            calendars::calendar_list_calendars,
            calendars::calendar_find_imported_calendar,
            calendars::calendar_count_events,
            calendars::calendar_add_calendar,
            calendars::calendar_set_visibility,
            calendars::calendar_remove_calendar,
            themes::theme_load_all,
            pomodoro::pomodoro_load_segments_for_events,
            pomodoro::pomodoro_load_adaptive_history,
            pomodoro::pomodoro_load_adaptive_replay_dataset,
            pomodoro::pomodoro_start_run,
            pomodoro::pomodoro_transition_run,
            pomodoro::pomodoro_insert_segment_with_adaptive_decision,
            pomodoro::pomodoro_insert_segments,
            pomodoro::pomodoro_update_segments,
            pomodoro::pomodoro_close_run,
            pomodoro::pomodoro_update_run_window,
            pomodoro::pomodoro_transfer_active_event_reference,
            pomodoro::pomodoro_heartbeat,
            pomodoro::pomodoro_record_run_event,
            pomodoro::pomodoro_recover_open_runs,
            projects::workspace::projects_load_workspace,
            projects::workspace::projects_refresh_workspace,
            projects::workspace::projects_load_task_view,
            projects::workspace::projects_load_task_detail,
            projects::workspace::projects_load_optional_data,
            projects::structure_commands::projects_create_group,
            projects::structure_commands::projects_update_group,
            projects::structure_commands::projects_delete_group,
            projects::structure_commands::projects_set_group_collapsed,
            projects::project_commands::projects_create_project,
            projects::project_commands::projects_update_project,
            projects::project_commands::projects_update_notes_settings,
            projects::structure_commands::projects_create_section,
            projects::structure_commands::projects_update_section,
            projects::structure_commands::projects_create_status,
            projects::structure_commands::projects_update_status,
            projects::structure_commands::projects_delete_status,
            projects::structure_commands::projects_create_priority,
            projects::structure_commands::projects_update_priority,
            projects::structure_commands::projects_delete_priority,
            projects::task_commands::projects_create_task,
            projects::task_commands::projects_create_checklist_item,
            projects::task_commands::projects_update_checklist_item,
            projects::task_commands::projects_delete_checklist_item,
            projects::structure_commands::projects_create_tag,
            projects::structure_commands::projects_update_tag,
            projects::structure_commands::projects_delete_tag,
            projects::relationship_commands::projects_link_task_tag,
            projects::relationship_commands::projects_unlink_task_tag,
            projects::custom_fields::projects_create_custom_field,
            projects::custom_fields::projects_update_custom_field,
            projects::custom_fields::projects_delete_custom_field,
            projects::custom_fields::projects_create_custom_field_option,
            projects::custom_fields::projects_update_custom_field_option,
            projects::custom_fields::projects_delete_custom_field_option,
            projects::custom_fields::projects_update_custom_field_value,
            projects::relationship_commands::projects_link_task_event,
            projects::relationship_commands::projects_unlink_task_event,
            projects::relationship_commands::projects_search_linkable_events,
            projects::relationship_commands::projects_create_task_dependency,
            projects::relationship_commands::projects_delete_task_dependency,
            projects::task_commands::projects_update_task,
            projects::preferences::projects_upsert_view_preference,
            projects::preferences::projects_delete_view_preference,
            projects::emojis::projects_create_custom_emoji,
            projects::emojis::projects_delete_custom_emoji,
            notes::notes_load_workspace_shell,
            notes::notes_list_trashed_pages,
            notes::notes_list_archived_pages,
            notes::notes_list_sidebar_pages,
            notes::notes_list_folders,
            notes::working_markdown::notes_list_working_markdown,
            notes::working_markdown::notes_read_working_markdown,
            notes::working_markdown::notes_save_working_markdown,
            notes::working_markdown::notes_open_working_markdown,
            notes::notes_create_folder,
            notes::notes_update_folder,
            notes::notes_delete_folder,
            notes::notes_list_backlinks,
            notes::notes_get_page_breadcrumb,
            notes::notes_search,
            notes::notes_rebuild_search_index,
            notes::notes_rebuild_backlink_index,
            notes::notes_rebuild_link_facts,
            notes::notes_list_page_aliases,
            notes::notes_add_page_alias,
            notes::notes_delete_page_alias,
            notes::notes_list_unresolved_links,
            notes::notes_resolve_unresolved_link,
            notes::notes_import_markdown_page,
            notes::notes_import_html_page,
            notes::notes_import_notion_api,
            notes::notes_import_notion_export_folder,
            notes::notes_export_markdown_page,
            notes::notes_export_html_page,
            notes::notes_pick_and_write_html_archive,
            notes::notes_export_json_graph,
            notes::notes_pick_and_write_json_graph,
            notes::notes_export_agent_bridge,
            notes::notes_pick_and_write_agent_bridge,
            notes::notes_get_local_user,
            notes::notes_update_local_user,
            notes::notes_list_page_templates,
            notes::notes_create_page_template_from_page,
            notes::notes_apply_page_template,
            notes::notes_update_page_template,
            notes::notes_duplicate_page_template,
            notes::notes_delete_page_template,
            notes::notes_get_page_history_settings,
            notes::notes_update_page_history_settings,
            notes::notes_list_page_history_snapshots,
            notes::notes_load_page_history_snapshot,
            notes::notes_restore_page_history_snapshot,
            notes::notes_copy_page_history_blocks,
            notes::project_history::schedule::notes_initialize_project_history,
            notes::project_history::schedule::notes_flush_due_project_history,
            notes::project_history::reads::notes_list_project_history_versions,
            notes::project_history::reads::notes_load_project_history_tree,
            notes::project_history::reads::notes_load_project_history_page,
            notes::project_history::retention::notes_get_history_retention_impact,
            notes::project_history::retention::notes_prune_project_history,
            notes::project_history::commands::notes_preview_project_history_restore,
            notes::project_history::commands::notes_restore_project_history_version,
            notes::notes_list_comments,
            notes::notes_mark_comment_threads_read,
            notes::notes_create_comment,
            notes::notes_update_comment,
            notes::notes_delete_comment,
            notes::notes_resolve_comment_thread,
            notes::notes_list_suggestions,
            notes::notes_create_suggestion,
            notes::notes_accept_suggestion,
            notes::notes_reject_suggestion,
            notes::notes_refresh_mention_notifications,
            notes::notes_list_pending_mention_notifications,
            notes::notes_mark_mention_notifications_delivered,
            notes::notes_create_page,
            notes::notes_create_child_page_from_block,
            notes::notes_create_database,
            notes::notes_create_linked_database_view,
            notes::notes_list_data_sources,
            notes::notes_get_data_source_schema,
            notes::notes_update_data_source_schema,
            notes::notes_list_data_source_row_pages,
            notes::notes_create_data_source_row_page,
            notes::notes_import_data_source_csv,
            notes::notes_export_data_source_csv,
            notes::notes_pick_and_write_data_source_csv,
            notes::notes_list_data_source_templates,
            notes::notes_create_data_source_template_from_row,
            notes::notes_apply_data_source_template,
            notes::notes_update_data_source_template,
            notes::notes_duplicate_data_source_template,
            notes::notes_delete_data_source_template,
            notes::notes_get_data_source_table_view,
            notes::notes_update_data_source_table_view,
            notes::notes_update_data_source_row_property,
            notes::notes_click_data_source_button,
            notes::notes_get_data_source_board_view,
            notes::notes_update_data_source_board_view,
            notes::notes_move_data_source_board_row,
            notes::notes_get_data_source_gallery_view,
            notes::notes_update_data_source_gallery_view,
            notes::notes_get_data_source_list_view,
            notes::notes_update_data_source_list_view,
            notes::notes_get_data_source_calendar_view,
            notes::notes_update_data_source_calendar_view,
            notes::notes_get_data_source_timeline_view,
            notes::notes_update_data_source_timeline_view,
            notes::notes_duplicate_page,
            notes::notes_move_page,
            notes::notes_update_page,
            notes::notes_pick_page_cover_file,
            notes::notes_save_page_cover_data_url,
            notes::notes_page_cover_asset_data_url,
            notes::notes_pick_file_asset,
            notes::notes_prepare_import_file_reference,
            notes::notes_file_asset_data_url,
            notes::notes_pick_page_icon_file,
            notes::notes_save_page_icon_data_url,
            notes::notes_page_icon_asset_data_url,
            notes::notes_trash_page,
            notes::notes_archive_page,
            notes::notes_permanently_delete_page,
            notes::notes_load_page,
            notes::notes_open_page,
            notes::notes_get_block_frontier,
            notes::notes_get_block_outline_frontier,
            notes::notes_hydrate_blocks,
            notes::notes_get_block_children,
            notes::notes_append_block_children,
            notes::notes_update_block,
            notes::notes_trash_block,
            notes::notes_trash_blocks,
            notes::notes_move_block,
            notes::notes_move_blocks,
            notes::notes_duplicate_block,
            notes::notes_duplicate_blocks,
            notes::notes_load_undo_state,
            notes::notes_save_undo_state,
            notes::notes_clear_undo_state,
            quick_notes::quick_notes_list,
            quick_notes::quick_notes_get,
            quick_notes::quick_notes_create,
            quick_notes::quick_notes_update,
            quick_notes::quick_notes_set_pinned,
            quick_notes::quick_notes_reorder,
            quick_notes::quick_notes_archive,
            quick_notes::quick_notes_unarchive,
            quick_notes::quick_notes_trash,
            quick_notes::quick_notes_restore,
            quick_notes::quick_notes_delete_permanently,
            quick_notes::quick_notes_empty_trash,
            quick_notes::quick_note_tags_list,
            quick_notes::quick_note_tags_create,
            quick_notes::quick_note_tags_delete,
            profile_images::profile_image_pick_file,
            profile_images::profile_image_save_data_url,
            profile_images::profile_image_asset_data_url,
            profile_images::profile_image_delete_file,
            project_icons::project_icon_pick_image_file,
            project_icons::project_icon_save_image_data_url,
            project_icons::project_icon_download_image_url,
            project_icons::project_icon_asset_path,
            project_icons::project_icon_asset_data_url,
            project_icons::project_icon_delete_assets_if_unreferenced,
            doomscrolling::commands::doomscrolling_close_desktop_app,
            doomscrolling::commands::doomscrolling_close_current_foreground_desktop_app,
            doomscrolling::commands::doomscrolling_get_foreground_desktop_app,
            doomscrolling::state::doomscrolling_get_extension_status,
            doomscrolling::usage::doomscrolling_list_usage_samples,
            doomscrolling::catalog::doomscrolling_list_desktop_apps,
            doomscrolling::commands::doomscrolling_list_blocked_desktop_app_matches,
            doomscrolling::commands::doomscrolling_open_extension_install_docs,
            doomscrolling::usage::doomscrolling_record_desktop_block_event,
            doomscrolling::usage::doomscrolling_record_usage_sample,
            doomscrolling::usage::doomscrolling_record_usage_samples,
            doomscrolling::state::doomscrolling_write_limit_state,
            doomscrolling::state::doomscrolling_write_state,
            themes::theme_insert,
            themes::theme_replace_content,
            themes::theme_delete,
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
            vault::ownership::initialize(app.handle())?;
            vault::handoff::initialize(app.handle())?;
            if let Err(error) = vault::handoff::start_desktop(app.handle()) {
                eprintln!("vault handoff coordinator is unavailable: {error}");
            }
            clear_doomscrolling_enforcement_state_best_effort(app.handle(), "during startup");
            schedule_main_window_reveal_fallback(app.handle());
            chat::revocation::start_startup_recovery(app.handle());
            music::setup_youtube_host(app.handle())?;
            media_controls::setup_media_controls(app.handle())?;
            if let Err(err) = notification::restore_stale_shortcuts(app.handle()) {
                eprintln!("failed to restore stale Linux shortcuts: {err}");
            }
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application");

    let exit_cleanup_state =
        std::sync::Arc::new(std::sync::atomic::AtomicU8::new(EXIT_CLEANUP_IDLE));
    app.run(move |app_handle, event| {
        if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
            let cleanup_state = exit_cleanup_state.load(std::sync::atomic::Ordering::Acquire);
            if code != Some(tauri::RESTART_EXIT_CODE) && cleanup_state != EXIT_CLEANUP_COMPLETE {
                api.prevent_exit();
                if exit_cleanup_state
                    .compare_exchange(
                        EXIT_CLEANUP_IDLE,
                        EXIT_CLEANUP_RUNNING,
                        std::sync::atomic::Ordering::AcqRel,
                        std::sync::atomic::Ordering::Acquire,
                    )
                    .is_ok()
                {
                    let app = app_handle.clone();
                    let state = std::sync::Arc::clone(&exit_cleanup_state);
                    // Detach cleanup so this callback returns to the event loop,
                    // which must process the main-thread work cleanup requests.
                    std::mem::drop(tauri::async_runtime::spawn_blocking(move || {
                        let _completion = DeferredExitCompletion {
                            app: app.clone(),
                            state,
                            exit_code: code.unwrap_or(0),
                        };
                        app.state::<notification::PomodoroOverlayState>()
                            .shutdown(&app);
                    }));
                }
                return;
            }

            let overlays = app_handle.state::<notification::PomodoroOverlayState>();
            if overlays.is_active() {
                eprintln!(
                    "Pomodoro overlay remained active during an exit request that cannot be delayed"
                );
            }
            let terminals = app_handle.state::<chat::terminal::ChatTerminalRegistry>();
            if let Err(error) = terminals.shutdown_all() {
                eprintln!("Chat terminal shutdown failed with code {:?}", error.code);
            }
            let runtime = app_handle.state::<chat::runtime::ChatRuntimeRegistry>();
            let mutations =
                app_handle.state::<chat::workspace_mutation::ChatWorkspaceMutationRegistry>();
            if let Err(error) = tauri::async_runtime::block_on(
                runtime.shutdown_and_wait(std::time::Duration::from_secs(4), &mutations),
            ) {
                eprintln!("Chat runtime shutdown failed with code {:?}", error.code);
            }
            app_handle
                .state::<chat::preview::ChatPreviewManager>()
                .close_all(app_handle);
            app_handle
                .state::<vault::handoff::CoordinatorLifecycle>()
                .stop();
            clear_doomscrolling_enforcement_state_best_effort(app_handle, "before app exit");
        }
    });
}
