use super::{
    clear_enforcement_state_files, extension_status_from_file_contents,
    normalize_app_candidate_name, sort_and_deduplicate_candidates, validate_state,
    DoomscrollingDesktopAppCandidate, DoomscrollingDesktopAppRuleInput, DoomscrollingLimitState,
    DoomscrollingLimitStateItem, DoomscrollingRuntimeState, DoomscrollingUsageSampleInput,
};
use chrono::{DateTime, Utc};
use sqlx::Row;
use std::time::{SystemTime, UNIX_EPOCH};

fn state(phase: &str) -> DoomscrollingRuntimeState {
    DoomscrollingRuntimeState {
        active: phase != "inactive",
        paused: false,
        pause_reason: None,
        phase: phase.to_string(),
        active_run_id: None,
        active_block_id: None,
        remaining_seconds: Some(30),
        updated_at: "2026-05-26T00:00:00.000Z".to_string(),
    }
}

#[test]
fn accepts_supported_phases() {
    for phase in ["inactive", "focus", "short_break", "long_break"] {
        assert!(validate_state(&state(phase)).is_ok());
    }
}

#[test]
fn rejects_unknown_phase() {
    assert!(validate_state(&state("planning")).is_err());
}

#[test]
fn rejects_negative_remaining_seconds() {
    let mut state = state("focus");
    state.remaining_seconds = Some(-1);
    assert!(validate_state(&state).is_err());
}

#[test]
fn accepts_supported_pause_reasons() {
    for pause_reason in [None, Some("manual"), Some("idle"), Some("suspend")] {
        let mut state = state("focus");
        state.paused = pause_reason.is_some();
        state.pause_reason = pause_reason.map(ToOwned::to_owned);
        assert!(validate_state(&state).is_ok());
    }
}

#[test]
fn rejects_unknown_pause_reason() {
    let mut state = state("focus");
    state.paused = true;
    state.pause_reason = Some("network".to_string());
    assert!(validate_state(&state).is_err());
}

#[test]
fn clears_shutdown_enforcement_state_files() {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "ganbaru-ai-doomscrolling-cleanup-{}-{suffix}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let state_path = dir.join("doomscrolling-state.json");
    let limit_state_path = dir.join("doomscrolling-limit-state.json");
    std::fs::write(&state_path, "{}").unwrap();
    std::fs::write(&limit_state_path, "{}").unwrap();

    clear_enforcement_state_files(&state_path, &limit_state_path).unwrap();

    assert!(!state_path.exists());
    assert!(!limit_state_path.exists());
    clear_enforcement_state_files(&state_path, &limit_state_path).unwrap();
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn recent_extension_status_is_connected() {
    let checked_at = DateTime::parse_from_rfc3339("2026-05-26T00:01:00.000Z")
        .unwrap()
        .with_timezone(&Utc);
    let status = extension_status_from_file_contents(
        r#"{"lastSeenAt":"2026-05-26T00:00:05.000Z","lastMessageType":"get_state"}"#,
        checked_at,
        None,
    );

    assert!(status.connected);
    assert_eq!(status.last_message_type.as_deref(), Some("get_state"));
    assert_eq!(
        status.last_seen_at.as_deref(),
        Some("2026-05-26T00:00:05.000Z")
    );
    assert!(status.reason.is_none());
}

#[test]
fn stale_extension_status_is_disconnected() {
    let checked_at = DateTime::parse_from_rfc3339("2026-05-26T00:03:00.000Z")
        .unwrap()
        .with_timezone(&Utc);
    let status = extension_status_from_file_contents(
        r#"{"lastSeenAt":"2026-05-26T00:00:00.000Z","lastMessageType":"get_state"}"#,
        checked_at,
        None,
    );

    assert!(!status.connected);
    assert_eq!(status.reason.as_deref(), Some("connection status is stale"));
}

#[test]
fn previous_app_session_extension_status_is_disconnected() {
    let checked_at = DateTime::parse_from_rfc3339("2026-05-26T00:01:00.000Z")
        .unwrap()
        .with_timezone(&Utc);
    let fresh_after = DateTime::parse_from_rfc3339("2026-05-26T00:00:30.000Z")
        .unwrap()
        .with_timezone(&Utc);
    let status = extension_status_from_file_contents(
        r#"{"lastSeenAt":"2026-05-26T00:00:05.000Z","lastMessageType":"get_state"}"#,
        checked_at,
        Some(fresh_after),
    );

    assert!(!status.connected);
    assert_eq!(
        status.reason.as_deref(),
        Some("connection is from an older app session")
    );
}

#[test]
fn normalizes_desktop_app_candidate_names() {
    assert_eq!(
        normalize_app_candidate_name("  Visual   Studio Code  ").as_deref(),
        Some("Visual Studio Code")
    );
    assert!(normalize_app_candidate_name("   ").is_none());
}

#[test]
fn recognizes_protected_desktop_app_and_process_names() {
    assert!(super::is_protected_desktop_app_name("Ganbaru AI"));
    assert!(super::is_protected_desktop_app_name("Terminal"));
    assert!(super::is_protected_desktop_app_name("gnome-shell"));
    assert!(super::is_protected_desktop_app_name("python3.12"));
    assert!(super::is_protected_desktop_app_name("explorer.exe"));
    assert!(!super::is_protected_desktop_app_name("Steam"));
}

#[test]
fn foreground_app_detection_reports_unavailable_without_guessing() {
    let status = super::foreground_desktop_app_status();
    assert!(!status.available);
    assert!(status.app_name.is_none());
    assert!(status.process_name.is_none());
    assert!(status.process_id.is_none());
}

#[test]
fn usage_samples_reject_protected_desktop_apps() {
    let sample = DoomscrollingUsageSampleInput {
        id: Some("sample-1".to_string()),
        source_type: "desktop-app".to_string(),
        source_key: "Terminal".to_string(),
        display_name: Some("Terminal".to_string()),
        started_at: 1_779_923_600_000,
        elapsed_seconds: 30,
        local_date: "2026-05-28".to_string(),
    };

    assert!(super::normalize_usage_sample(sample, "test").is_err());
}

#[test]
fn desktop_block_events_reject_protected_apps() {
    let event = super::DoomscrollingDesktopBlockEventInput {
        app_name: "Terminal".to_string(),
        process_name: Some("gnome-terminal".to_string()),
        process_id: Some(123),
    };

    assert!(super::normalize_desktop_block_event(event).is_err());
}

#[test]
fn records_desktop_block_event_to_sqlite_without_process_id() {
    tauri::async_runtime::block_on(async {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql("PRAGMA foreign_keys=ON")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(
                "CREATE TABLE pomodoro_runs (id TEXT PRIMARY KEY);
                 CREATE TABLE pomodoro_segments (
                   id TEXT PRIMARY KEY,
                   run_id TEXT REFERENCES pomodoro_runs(id) ON DELETE CASCADE
                 );
                 CREATE TABLE doomscrolling_block_events (
                   id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
                   run_id TEXT REFERENCES pomodoro_runs(id) ON DELETE SET NULL,
                   segment_id TEXT REFERENCES pomodoro_segments(id) ON DELETE SET NULL,
                   occurred_at TEXT NOT NULL CHECK (trim(occurred_at) <> ''),
                   source_type TEXT NOT NULL CHECK (source_type IN ('browser', 'desktop_app', 'mobile_app')),
                   source_key TEXT NOT NULL CHECK (trim(source_key) <> '' AND instr(source_key, '://') = 0),
                   display_name TEXT,
                   phase TEXT CHECK (
                     phase IS NULL OR
                     phase IN ('focus', 'short_break', 'long_break', 'manual_pause', 'idle_pause', 'suspend_pause')
                   ),
                   decision TEXT NOT NULL CHECK (
                     decision IN ('blocked', 'temporary_allowed', 'false_positive_reported', 'limit_exhausted')
                   ),
                   rule_id TEXT,
                   category_id TEXT,
                   created_at TEXT NOT NULL DEFAULT (datetime('now'))
                 );
                 CREATE TABLE doomscrolling_block_event_rule_snapshots (
                   block_event_id TEXT PRIMARY KEY REFERENCES doomscrolling_block_events(id) ON DELETE CASCADE,
                   rule_id TEXT,
                   rule_kind TEXT CHECK (
                     rule_kind IS NULL OR
                     rule_kind IN ('domain', 'url_pattern', 'category', 'custom_category', 'usage_limit', 'desktop_app')
                   ),
                   rule_label TEXT,
                   environment_id TEXT,
                   blocker_mode TEXT CHECK (
                     blocker_mode IS NULL OR
                     blocker_mode IN ('blacklist', 'whitelist', 'limit')
                   )
                 );",
            )
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO pomodoro_runs (id) VALUES ('run-1')")
            .execute(&pool)
            .await
            .unwrap();
        let mut runtime = state("focus");
        runtime.active_run_id = Some("run-1".to_string());
        let event =
            super::normalize_desktop_block_event(super::DoomscrollingDesktopBlockEventInput {
                app_name: "Steam".to_string(),
                process_name: Some("steam".to_string()),
                process_id: Some(42),
            })
            .unwrap();

        super::insert_desktop_block_event(&pool, event, Some(&runtime), "2026-06-10T12:00:00.000Z")
            .await
            .unwrap();

        let row = sqlx::query(
            "SELECT run_id, source_type, source_key, display_name, phase, decision
                 FROM doomscrolling_block_events",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let source_key: String = row.try_get("source_key").unwrap();
        assert_eq!(row.try_get::<String, _>("run_id").unwrap(), "run-1");
        assert_eq!(
            row.try_get::<String, _>("source_type").unwrap(),
            "desktop_app"
        );
        assert_eq!(source_key, "steam");
        assert!(!source_key.contains("://"));
        assert_eq!(row.try_get::<String, _>("display_name").unwrap(), "Steam");
        assert_eq!(row.try_get::<String, _>("phase").unwrap(), "focus");
        assert_eq!(row.try_get::<String, _>("decision").unwrap(), "blocked");

        let snapshot = sqlx::query(
            "SELECT rule_kind, rule_label, blocker_mode
                 FROM doomscrolling_block_event_rule_snapshots",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            snapshot.try_get::<String, _>("rule_kind").unwrap(),
            "desktop_app"
        );
        assert_eq!(
            snapshot.try_get::<String, _>("rule_label").unwrap(),
            "Steam"
        );
        assert_eq!(
            snapshot.try_get::<String, _>("blocker_mode").unwrap(),
            "blacklist"
        );
    });
}

#[test]
fn usage_samples_normalize_website_hosts() {
    let sample = DoomscrollingUsageSampleInput {
        id: Some("sample-1".to_string()),
        source_type: "website".to_string(),
        source_key: "YouTube.com.".to_string(),
        display_name: Some("YouTube".to_string()),
        started_at: 1_779_923_600_000,
        elapsed_seconds: 30,
        local_date: "2026-05-28".to_string(),
    };

    let normalized = super::normalize_usage_sample(sample, "test").unwrap();
    assert_eq!(normalized.source_key, "youtube.com");
    assert_eq!(normalized.elapsed_seconds, 30);
}

#[test]
fn limit_state_requires_a_local_date() {
    let state = DoomscrollingLimitState {
        local_date: "today".to_string(),
        week_start_local_date: "2026-05-25".to_string(),
        updated_at: "2026-05-28T00:00:00.000Z".to_string(),
        database_path: Some("/tmp/ganbaru-ai-vault/ganbaru-ai.sqlite".to_string()),
        limits: vec![DoomscrollingLimitStateItem {
            id: "youtube".to_string(),
            period: "day".to_string(),
            window_start_local_date: "2026-05-28".to_string(),
            window_end_local_date: "2026-05-28".to_string(),
            used_seconds: 60,
            limit_seconds: 600,
            remaining_seconds: 540,
            exhausted: false,
        }],
    };

    assert!(super::validate_limit_state(&state).is_err());
}

#[test]
fn sorts_and_deduplicates_desktop_app_candidates() {
    let apps = sort_and_deduplicate_candidates(vec![
        DoomscrollingDesktopAppCandidate {
            name: "Terminal".to_string(),
            source: "Installed app".to_string(),
            detail: Some("terminal.desktop".to_string()),
            process_names: vec!["gnome-terminal".to_string()],
        },
        DoomscrollingDesktopAppCandidate {
            name: "Steam".to_string(),
            source: "Installed app".to_string(),
            detail: Some("steam.desktop".to_string()),
            process_names: vec!["Steam".to_string(), "steam".to_string()],
        },
        DoomscrollingDesktopAppCandidate {
            name: "steam".to_string(),
            source: "Installed app".to_string(),
            detail: Some("duplicate.desktop".to_string()),
            process_names: vec!["steam".to_string()],
        },
        DoomscrollingDesktopAppCandidate {
            name: "Discord".to_string(),
            source: "Installed app".to_string(),
            detail: None,
            process_names: vec!["Discord".to_string()],
        },
    ]);

    assert_eq!(
        apps.iter().map(|app| app.name.as_str()).collect::<Vec<_>>(),
        vec!["Discord", "Steam"]
    );
}

#[test]
fn desktop_rule_matchers_skip_protected_process_names() {
    let matchers = super::desktop_rule_matchers(vec![
        DoomscrollingDesktopAppRuleInput {
            name: "Terminal".to_string(),
            match_names: vec!["gnome-terminal".to_string()],
        },
        DoomscrollingDesktopAppRuleInput {
            name: "Steam".to_string(),
            match_names: vec!["sh".to_string(), "steam".to_string()],
        },
    ]);

    assert!(!matchers.contains_key("terminal"));
    assert!(!matchers.contains_key("gnome-terminal"));
    assert!(!matchers.contains_key("sh"));
    assert_eq!(matchers.get("steam").map(String::as_str), Some("Steam"));
}

#[cfg(target_os = "linux")]
#[test]
fn parses_visible_linux_desktop_entries() {
    let app = super::parse_desktop_entry(
        r#"
[Desktop Entry]
Type=Application
Name=Visual\sStudio\sCode
Exec=code
"#,
        "code.desktop".to_string(),
    )
    .unwrap();

    assert_eq!(app.name, "Visual Studio Code");
    assert_eq!(app.source, "Installed app");
    assert_eq!(
        app.process_names,
        vec!["Visual Studio Code", "code", "code.desktop"]
    );
}

#[cfg(target_os = "linux")]
#[test]
fn extracts_linux_process_name_from_exec() {
    assert_eq!(
        super::process_name_from_exec(r#""/usr/bin/gnome-calculator" %U"#).as_deref(),
        Some("gnome-calculator")
    );
}

#[cfg(target_os = "linux")]
#[test]
fn skips_hidden_linux_desktop_entries() {
    assert!(super::parse_desktop_entry(
        r#"
[Desktop Entry]
Type=Application
Name=Hidden app
NoDisplay=true
"#,
        "hidden.desktop".to_string(),
    )
    .is_none());
}

#[cfg(target_os = "linux")]
#[test]
fn skips_linux_system_utility_desktop_entries() {
    assert!(super::parse_desktop_entry(
        r#"
[Desktop Entry]
Type=Application
Name=Settings
Categories=GNOME;GTK;Settings;
Exec=gnome-control-center
"#,
        "org.gnome.Settings.desktop".to_string(),
    )
    .is_none());
    assert!(super::parse_desktop_entry(
        r#"
[Desktop Entry]
Type=Application
Name=System Monitor
Categories=GNOME;GTK;System;Monitor;
Exec=gnome-system-monitor
"#,
        "org.gnome.SystemMonitor.desktop".to_string(),
    )
    .is_none());
}
