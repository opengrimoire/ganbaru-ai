use std::path::PathBuf;
use std::process::Stdio;
use tauri::Manager;

extern crate self as sqlx;

pub use sqlx_core::acquire::Acquire;
pub use sqlx_core::connection::{ConnectOptions, Connection};
pub use sqlx_core::database::Database;
pub use sqlx_core::error::{Error, Result};
pub use sqlx_core::executor::{Execute, Executor};
pub use sqlx_core::from_row::FromRow;
pub use sqlx_core::pool::Pool;
pub use sqlx_core::query::query;
pub use sqlx_core::query_as::query_as;
pub use sqlx_core::query_scalar::query_scalar;
pub use sqlx_core::raw_sql::raw_sql;
pub use sqlx_core::row::Row;
pub use sqlx_core::transaction::{Transaction, TransactionManager};
pub use sqlx_core::Either;
pub use sqlx_sqlite::{Sqlite, SqliteConnection, SqliteExecutor, SqlitePool, SqliteTransaction};

pub mod sqlite {
    pub use sqlx_sqlite::*;
}

#[macro_use]
mod sqlite_row;
mod benchmark_seed;
mod calendar_description;
mod calendar_events;
mod calendar_import;
mod calendar_reads;
mod calendars;
mod db;
mod db_path;
mod media_player;
mod music;
mod notification;
mod pomodoro;
mod recurrence;
mod themes;
mod timezone_migration;
mod tray;
mod vault;

static PROCESS_START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
static PLATFORM_LABEL: std::sync::OnceLock<String> = std::sync::OnceLock::new();
const DELAYED_RELAUNCH_MS_ENV: &str = "GANBARUAI_DELAYED_RELAUNCH_MS";
const DELAYED_RELAUNCH_MAX_MS: u64 = 10 * 60 * 1000;

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
async fn reset_database(app: tauri::AppHandle) -> Result<(), String> {
    db_path::close_all_sqlite_pools(&app).await?;
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
    db_path::close_sqlite_pool(&app, "sqlite:ganbaruai-benchmark.db").await?;
    delete_benchmark_db_files(&app)
}

/// Same operation as `prepare_benchmark_db`. Separate command for intent
/// clarity at the call site (run-finished cleanup vs run-starting cleanup).
#[tauri::command]
async fn teardown_benchmark_db(app: tauri::AppHandle) -> Result<(), String> {
    db_path::close_sqlite_pool(&app, "sqlite:ganbaruai-benchmark.db").await?;
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
        use std::mem::size_of;
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        use windows::Win32::System::ProcessStatus::{
            GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
        };
        use windows::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
        };

        let my_pid = std::process::id();

        let snapshot = {
            // SAFETY: This call only asks Windows for a read-only process snapshot.
            match unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) } {
                Ok(snapshot) => snapshot,
                Err(_) => {
                    return MemoryReport {
                        processes: vec![],
                        total_mb: 0.0,
                        platform: platform_label(),
                    };
                }
            }
        };

        let mut proc_list: Vec<(u32, u32, String)> = Vec::new();
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        // SAFETY: `entry` is a valid PROCESSENTRY32W with dwSize initialized as
        // required by Process32FirstW and Process32NextW.
        if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
            loop {
                let end = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let exe = String::from_utf16_lossy(&entry.szExeFile[..end]);
                proc_list.push((entry.th32ProcessID, entry.th32ParentProcessID, exe));

                // SAFETY: The snapshot handle is still open and `entry` remains a
                // valid output buffer for the next process entry.
                if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                    break;
                }
            }
        }

        // SAFETY: `snapshot` is an open handle returned by CreateToolhelp32Snapshot.
        let _ = unsafe { CloseHandle(snapshot) };

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
            // process snapshot. The returned handle is closed before continuing.
            if let Ok(handle) =
                unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid) }
            {
                let mut pmc = PROCESS_MEMORY_COUNTERS {
                    cb: size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
                    ..Default::default()
                };
                // SAFETY: `handle` is an open process handle and `pmc` is a valid
                // output buffer whose cb field matches its struct size.
                if unsafe { GetProcessMemoryInfo(handle, &mut pmc, pmc.cb) }.is_ok() {
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
                // SAFETY: `handle` was returned by OpenProcess above and is not
                // used after this point.
                let _ = unsafe { CloseHandle(handle) };
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
            "/definitely/not/ganbaruai"
        )));
        let current_exe = std::env::current_exe().expect("test executable path should exist");
        assert!(is_valid_relaunch_target(&current_exe));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if run_delayed_relaunch_helper_if_needed() {
        return;
    }
    PROCESS_START.set(std::time::Instant::now()).ok();

    tauri::Builder::default()
        .manage(db_path::DatabaseState::default())
        .manage(media_player::MediaPlayerState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            notification::show_pomodoro_notification,
            notification::show_event_notification,
            notification::show_benchmark_notification,
            notification::show_break_overlay,
            notification::get_idle_status,
            notification::play_alert_sound,
            notification::show_idle_overlay,
            music::music_get_playback_state,
            music::music_pick_media_folder,
            music::music_register_embedded_artwork,
            music::music_register_media_file,
            music::music_save_playback_state,
            music::music_youtube_host_url,
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
            restart_app,
            restart_app_after_delay,
            get_memory_report,
            get_startup_elapsed_ms,
            vault::vault_read_config,
            vault::vault_write_config,
            vault::vault_pick_and_read_ics_import,
            vault::vault_pick_and_write_ics_export,
            vault::vault_pick_and_read_theme_json,
            vault::vault_pick_and_write_theme_json,
            timezone_migration::calendar_load_timezone_hydration_rows,
            timezone_migration::calendar_apply_timezone_hydration,
            calendar_reads::calendar_load_window,
            calendar_reads::calendar_load_panel_event,
            calendar_reads::calendar_load_full_event,
            calendar_reads::calendar_list_event_ids_for_calendar,
            calendar_reads::calendar_load_icalendar_timezones_for_calendar,
            calendar_reads::calendar_load_icalendar_passthrough_components_for_calendar,
            calendar_reads::calendar_load_icalendar_export_metadata_for_calendar,
            recurrence::calendar_expand_render_events,
            calendar_events::calendar_add_event,
            calendar_events::calendar_delete_event,
            calendar_events::calendar_clear_events,
            calendar_events::calendar_update_event,
            calendar_events::calendar_detach_instance,
            calendar_events::calendar_split_series,
            calendar_events::calendar_has_progress_segments,
            calendar_events::calendar_progress_dates_before,
            calendar_import::calendar_bulk_import,
            calendars::calendar_list_calendars,
            calendars::calendar_find_imported_calendar,
            calendars::calendar_count_events,
            calendars::calendar_add_calendar,
            calendars::calendar_set_visibility,
            calendars::calendar_remove_calendar,
            themes::theme_load_all,
            pomodoro::pomodoro_load_segments_for_events,
            pomodoro::pomodoro_insert_segments,
            pomodoro::pomodoro_update_segments,
            pomodoro::pomodoro_cleanup_event_segments,
            pomodoro::pomodoro_cleanup_orphans,
            pomodoro::pomodoro_save_session,
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
            music::setup_youtube_host(app.handle())?;
            if let Err(err) = notification::restore_stale_shortcuts(app.handle()) {
                eprintln!("failed to restore stale Linux shortcuts: {err}");
            }
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
