use super::{
    block_event_decision, block_event_phase, block_event_rule_kind, decide_url, host_from_url,
    host_matches_rule, record_block_event_in_database, runtime_status_at, should_enforce,
    DoomscrollingConfig, DoomscrollingMode, NativeResponse, RuntimeState, StateSnapshot,
    UsageLimitsConfig,
};
use chrono::{DateTime, SecondsFormat, Utc};
use sqlx::Row;

fn config() -> DoomscrollingConfig {
    DoomscrollingConfig {
        mode: DoomscrollingMode::Blacklist,
        enabled: true,
        block_during_focus: true,
        block_during_short_breaks: true,
        block_during_long_breaks: true,
        pause_during_focus_pause: true,
        blocked_category_ids: Vec::new(),
        custom_category_stacks: Vec::new(),
        blocked_hosts: vec!["reddit.com".to_string(), "youtube.com".to_string()],
        exception_hosts: vec!["music.youtube.com".to_string()],
        allowed_hosts: vec!["github.com".to_string()],
        limits: UsageLimitsConfig {
            enabled: true,
            items: Vec::new(),
        },
    }
}

fn response_for_phase(phase: &str) -> NativeResponse {
    NativeResponse {
        message_type: "decision",
        host_name: super::HOST_NAME.to_string(),
        connected: true,
        active: true,
        paused: false,
        pause_reason: None,
        phase: phase.to_string(),
        remaining_seconds: Some(60),
        rules_fingerprint: "test".to_string(),
        blocked: false,
        host: None,
        matched_rule_name: None,
        reason: None,
        environment_name: "Ganbaru AI",
    }
}

fn runtime_for_phase(phase: &str, paused: bool) -> RuntimeState {
    runtime_for_phase_updated_at(
        phase,
        paused,
        super::now_utc().to_rfc3339_opts(SecondsFormat::Millis, true),
    )
}

fn runtime_for_phase_updated_at(phase: &str, paused: bool, updated_at: String) -> RuntimeState {
    RuntimeState {
        active: true,
        paused,
        pause_reason: paused.then(|| "manual".to_string()),
        active_run_id: Some("run-1".to_string()),
        phase: phase.to_string(),
        remaining_seconds: Some(60),
        updated_at,
    }
}

#[test]
fn maps_block_event_metadata() {
    let focus = runtime_for_phase("focus", false);
    let idle_pause = RuntimeState {
        paused: true,
        pause_reason: Some("idle".to_string()),
        ..runtime_for_phase("focus", false)
    };

    assert_eq!(block_event_phase(Some(&focus)).as_deref(), Some("focus"));
    assert_eq!(
        block_event_phase(Some(&idle_pause)).as_deref(),
        Some("idle_pause")
    );
    assert_eq!(
        block_event_decision(Some("daily limit: YouTube")),
        "limit_exhausted"
    );
    assert_eq!(
        block_event_rule_kind(Some("custom stack: Research traps")),
        Some("custom_category")
    );
    assert_eq!(
        block_event_rule_kind(Some("blocked host: youtube.com")),
        Some("domain")
    );
}

#[test]
fn records_block_event_to_sqlite_without_full_url() {
    let vault_path = std::env::temp_dir().join(format!(
        "ganbaru-ai-native-block-event-{}-{}",
        std::process::id(),
        super::now_epoch_ms()
    ));
    let _ = std::fs::remove_dir_all(&vault_path);
    std::fs::create_dir_all(&vault_path).unwrap();
    let db_path = vault_path.join("ganbaru-ai.sqlite");
    std::fs::File::create(&db_path).unwrap();
    let db_url = format!("sqlite:{}", db_path.to_string_lossy());
    tauri::async_runtime::block_on(async {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&db_url)
            .await
            .unwrap();
        sqlx::raw_sql(
            "CREATE TABLE pomodoro_runs (id TEXT PRIMARY KEY);
                 CREATE TABLE pomodoro_segments (id TEXT PRIMARY KEY);",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool.close().await;
    });

    let mut runtime = runtime_for_phase("focus", false);
    runtime.active_run_id = None;
    let snapshot = StateSnapshot {
        config_dir: None,
        vault_path: Some(vault_path.clone()),
        config: config(),
        runtime: Some(runtime),
        limit_state: None,
    };

    let rejected = record_block_event_in_database(
        &snapshot,
        "2026-06-10T10:00:00.000Z",
        "https://youtube.com/watch",
        Some("blocked host: youtube.com"),
    );
    assert!(rejected.is_err());

    record_block_event_in_database(
        &snapshot,
        "2026-06-10T10:00:00.000Z",
        "youtube.com",
        Some("blocked host: youtube.com"),
    )
    .unwrap();

    tauri::async_runtime::block_on(async {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&db_url)
            .await
            .unwrap();
        let row = sqlx::query(
            "SELECT e.source_key, e.decision, e.phase, s.rule_kind, s.blocker_mode
                 FROM doomscrolling_block_events e
                 JOIN doomscrolling_block_event_rule_snapshots s ON s.block_event_id = e.id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let source_key: String = row.try_get("source_key").unwrap();
        let decision: String = row.try_get("decision").unwrap();
        let phase: String = row.try_get("phase").unwrap();
        let rule_kind: String = row.try_get("rule_kind").unwrap();
        let blocker_mode: String = row.try_get("blocker_mode").unwrap();
        assert_eq!(source_key, "youtube.com");
        assert_eq!(decision, "blocked");
        assert_eq!(phase, "focus");
        assert_eq!(rule_kind, "domain");
        assert_eq!(blocker_mode, "blacklist");

        pool.close().await;
    });
    let _ = std::fs::remove_dir_all(&vault_path);
}

#[test]
fn active_runtime_state_remains_fresh_inside_heartbeat_window() {
    let snapshot = StateSnapshot {
        config_dir: None,
        vault_path: None,
        config: config(),
        runtime: Some(runtime_for_phase_updated_at(
            "focus",
            false,
            "2026-05-26T00:00:00.000Z".to_string(),
        )),
        limit_state: None,
    };
    let checked_at = DateTime::parse_from_rfc3339("2026-05-26T00:00:44.000Z")
        .unwrap()
        .with_timezone(&Utc);

    let (active, phase, remaining_seconds, reason) = runtime_status_at(&snapshot, checked_at);

    assert!(active);
    assert_eq!(phase, "focus");
    assert_eq!(remaining_seconds, Some(16));
    assert!(reason.is_none());
}

#[test]
fn active_runtime_state_fails_open_after_missed_heartbeat() {
    let snapshot = StateSnapshot {
        config_dir: None,
        vault_path: None,
        config: config(),
        runtime: Some(runtime_for_phase_updated_at(
            "focus",
            false,
            "2026-05-26T00:00:00.000Z".to_string(),
        )),
        limit_state: None,
    };
    let checked_at = DateTime::parse_from_rfc3339("2026-05-26T00:00:46.000Z")
        .unwrap()
        .with_timezone(&Utc);

    let (active, phase, remaining_seconds, reason) = runtime_status_at(&snapshot, checked_at);

    assert!(!active);
    assert_eq!(phase, "inactive");
    assert_eq!(remaining_seconds, None);
    assert_eq!(reason.as_deref(), Some("runtime state is stale"));
}

#[test]
fn extracts_host_from_url() {
    assert_eq!(
        host_from_url("https://old.reddit.com/r/all?x=1").as_deref(),
        Some("old.reddit.com")
    );
}

#[test]
fn matches_subdomains_only_on_boundaries() {
    assert!(host_matches_rule("old.reddit.com", "reddit.com"));
    assert!(!host_matches_rule("badreddit.com", "reddit.com"));
}

#[test]
fn reads_enabled_host_rules() {
    let value = serde_json::json!([
        "Reddit.com",
        { "host": "youtube.com", "enabled": false },
        { "host": "Docs.GitHub.com" },
        { "host": "reddit.com" }
    ]);
    assert_eq!(
        super::read_host_array(Some(&value)),
        vec!["reddit.com".to_string(), "docs.github.com".to_string()]
    );
}

#[test]
fn reads_only_enabled_built_in_categories() {
    let value = serde_json::json!([
        "social-media",
        { "id": "streaming", "enabled": false },
        { "id": "news", "enabled": true },
        { "id": "unknown", "enabled": true }
    ]);
    assert_eq!(
        super::read_category_array(Some(&value)),
        vec!["social-media".to_string(), "news".to_string()]
    );
}

#[test]
fn reads_default_built_in_categories_without_news() {
    let categories = super::read_category_array(None);
    assert!(!categories.contains(&"news".to_string()));
    assert!(categories.contains(&"social-media".to_string()));
    assert!(categories.contains(&"streaming".to_string()));
}

#[test]
fn reads_enabled_custom_category_stacks() {
    let value = serde_json::json!([
        {
            "id": "research-traps",
            "name": "  Research traps  ",
            "hosts": ["news.ycombinator.com", { "host": "reddit.com", "enabled": false }]
        },
        {
            "id": "disabled",
            "name": "Disabled",
            "enabled": false,
            "hosts": ["example.com"]
        }
    ]);
    let stacks = super::read_custom_category_stacks(Some(&value));
    assert_eq!(stacks.len(), 1);
    assert_eq!(stacks[0].id, "research-traps");
    assert_eq!(stacks[0].name, "Research traps");
    assert_eq!(stacks[0].hosts, vec!["news.ycombinator.com".to_string()]);
}

#[test]
fn lets_exceptions_override_blocked_parent_domains() {
    let decision = decide_url("music.youtube.com", None, &config());
    assert!(!decision.blocked);
    assert_eq!(
        decision.matched_rule_name.as_deref(),
        Some("exception: music.youtube.com")
    );
}

#[test]
fn blocks_matching_parent_domain() {
    let decision = decide_url("old.reddit.com", None, &config());
    assert!(decision.blocked);
    assert_eq!(
        decision.matched_rule_name.as_deref(),
        Some("blocked host: reddit.com")
    );
}

#[test]
fn blocks_exhausted_daily_website_limits_without_active_pomodoro_rules() {
    let mut config = config();
    config.blocked_hosts.clear();
    config.limits.items = vec![super::UsageLimit {
        id: "youtube".to_string(),
        name: "YouTube".to_string(),
        enabled: true,
        minutes_per_day: Some(10),
        minutes_per_week: None,
        entries: vec![super::UsageLimitEntry {
            id: "youtube-website".to_string(),
            name: None,
            website_host: Some("youtube.com".to_string()),
            mobile_app_name: None,
            desktop_app_name: None,
        }],
    }];
    let limit_state = super::LimitState {
        local_date: "2026-05-28".to_string(),
        week_start_local_date: Some("2026-05-25".to_string()),
        updated_at: super::now_utc().to_rfc3339_opts(SecondsFormat::Millis, true),
        database_path: Some("/tmp/ganbaru-ai-vault/ganbaru-ai.sqlite".to_string()),
        limits: vec![super::LimitStateItem {
            id: "youtube".to_string(),
            period: Some("day".to_string()),
            window_start_local_date: Some("2026-05-28".to_string()),
            window_end_local_date: Some("2026-05-28".to_string()),
            used_seconds: 600,
            limit_seconds: 600,
            remaining_seconds: 0,
            exhausted: true,
        }],
    };

    let decision = super::decide_url_with_limits(
        "music.youtube.com",
        None,
        &config,
        Some(&limit_state),
        false,
    );

    assert!(decision.blocked);
    assert_eq!(
        decision.matched_rule_name.as_deref(),
        Some("daily limit: YouTube")
    );
}

#[test]
fn active_focus_rules_win_over_limit_blocks() {
    let mut config = config();
    config.limits.items = vec![super::UsageLimit {
        id: "reddit".to_string(),
        name: "Reddit limit".to_string(),
        enabled: true,
        minutes_per_day: Some(10),
        minutes_per_week: None,
        entries: vec![super::UsageLimitEntry {
            id: "reddit-website".to_string(),
            name: None,
            website_host: Some("reddit.com".to_string()),
            mobile_app_name: None,
            desktop_app_name: None,
        }],
    }];
    let limit_state = super::LimitState {
        local_date: "2026-05-28".to_string(),
        week_start_local_date: Some("2026-05-25".to_string()),
        updated_at: super::now_utc().to_rfc3339_opts(SecondsFormat::Millis, true),
        database_path: Some("/tmp/ganbaru-ai-vault/ganbaru-ai.sqlite".to_string()),
        limits: vec![super::LimitStateItem {
            id: "reddit".to_string(),
            period: Some("day".to_string()),
            window_start_local_date: Some("2026-05-28".to_string()),
            window_end_local_date: Some("2026-05-28".to_string()),
            used_seconds: 600,
            limit_seconds: 600,
            remaining_seconds: 0,
            exhausted: true,
        }],
    };

    let decision =
        super::decide_url_with_limits("old.reddit.com", None, &config, Some(&limit_state), true);

    assert!(decision.blocked);
    assert_eq!(
        decision.matched_rule_name.as_deref(),
        Some("blocked host: reddit.com")
    );
}

#[test]
fn uses_limit_state_database_path_for_usage_samples() {
    let vault_path = std::path::Path::new("/tmp/ganbaru-ai-vault");
    let limit_state = super::LimitState {
        local_date: "2026-05-28".to_string(),
        week_start_local_date: Some("2026-05-25".to_string()),
        updated_at: super::now_utc().to_rfc3339_opts(SecondsFormat::Millis, true),
        database_path: Some("/tmp/ganbaru-ai-vault/ganbaru-ai.sqlite".to_string()),
        limits: Vec::new(),
    };

    assert_eq!(
        super::usage_db_path(vault_path, Some(&limit_state)),
        vault_path.join("ganbaru-ai.sqlite")
    );
}

#[test]
fn falls_back_to_vault_database_path_without_limit_state_path() {
    let vault_path = std::path::Path::new("/tmp/ganbaru-ai-vault");

    assert_eq!(
        super::usage_db_path(vault_path, None),
        vault_path.join("ganbaru-ai.sqlite")
    );
}

#[test]
fn blocks_enabled_built_in_categories() {
    let mut config = config();
    config.blocked_hosts.clear();
    config.blocked_category_ids = vec!["social-media".to_string()];
    let decision = decide_url("old.reddit.com", None, &config);
    assert!(decision.blocked);
    assert_eq!(
        decision.matched_rule_name.as_deref(),
        Some("category: Social media")
    );
}

#[test]
fn blocks_streaming_category_keyword_matches_in_domains() {
    let mut config = config();
    config.blocked_hosts.clear();
    config.blocked_category_ids = vec!["streaming".to_string()];
    let decision = decide_url(
        "watch-anime.example",
        Some("https://watch-anime.example/episode/1"),
        &config,
    );
    assert!(decision.blocked);
    assert_eq!(
        decision.matched_rule_name.as_deref(),
        Some("category: Streaming")
    );
}

#[test]
fn blocks_built_in_category_keyword_matches_in_domains() {
    let cases = [
        (
            "local-news.example",
            "https://local-news.example/story",
            "news",
            "category: News",
        ),
        (
            "live-scores.example",
            "https://live-scores.example/game",
            "sports",
            "category: Sports",
        ),
        (
            "online-casino.example",
            "https://online-casino.example/table",
            "gambling",
            "category: Gambling",
        ),
        (
            "mini-game.example",
            "https://mini-game.example/play",
            "gaming",
            "category: Gaming",
        ),
        (
            "shopee.example",
            "https://shopee.example/deals",
            "shopping",
            "category: Shopping",
        ),
        (
            "best-hookup.example",
            "https://best-hookup.example/profile",
            "dating",
            "category: Dating",
        ),
        (
            "crypto-watch.example",
            "https://crypto-watch.example/chart",
            "trading",
            "category: Trading",
        ),
    ];
    for (host, url, category_id, matched_rule_name) in cases {
        let mut config = config();
        config.blocked_hosts.clear();
        config.blocked_category_ids = vec![category_id.to_string()];
        let decision = decide_url(host, Some(url), &config);
        assert!(decision.blocked);
        assert_eq!(
            decision.matched_rule_name.as_deref(),
            Some(matched_rule_name)
        );
    }
}

#[test]
fn blocks_porn_category_keyword_matches_in_domains() {
    let mut config = config();
    config.blocked_hosts.clear();
    config.blocked_category_ids = vec!["porn".to_string()];
    let decision = decide_url(
        "example-porn-site.test",
        Some("https://example-porn-site.test/watch"),
        &config,
    );
    assert!(decision.blocked);
    assert_eq!(
        decision.matched_rule_name.as_deref(),
        Some("category: Porn")
    );
}

#[test]
fn blocks_porn_category_keyword_matches_in_reddit_subreddits() {
    let mut config = config();
    config.blocked_hosts.clear();
    config.blocked_category_ids = vec!["porn".to_string()];
    let decision = decide_url(
        "old.reddit.com",
        Some("https://old.reddit.com/r/gwstories/comments/123/title"),
        &config,
    );
    assert!(decision.blocked);
    assert_eq!(
        decision.matched_rule_name.as_deref(),
        Some("category: Porn")
    );
}

#[test]
fn ignores_reddit_post_titles_for_porn_category_keyword_matching() {
    let mut config = config();
    config.blocked_hosts.clear();
    config.blocked_category_ids = vec!["porn".to_string()];
    let decision = decide_url(
        "reddit.com",
        Some("https://reddit.com/r/productivity/comments/123/nsfw_post_title"),
        &config,
    );
    assert!(!decision.blocked);
    assert_eq!(decision.matched_rule_name, None);
}

#[test]
fn blocks_enabled_custom_category_stacks() {
    let mut config = config();
    config.blocked_hosts.clear();
    config.custom_category_stacks = vec![super::CustomCategoryStack {
        id: "research-traps".to_string(),
        name: "Research traps".to_string(),
        hosts: vec!["news.ycombinator.com".to_string()],
    }];
    let decision = decide_url("news.ycombinator.com", None, &config);
    assert!(decision.blocked);
    assert_eq!(
        decision.matched_rule_name.as_deref(),
        Some("custom stack: Research traps")
    );
}

#[test]
fn enforces_short_and_long_break_settings_independently() {
    let mut config = config();
    config.block_during_short_breaks = true;
    config.block_during_long_breaks = false;
    let snapshot = StateSnapshot {
        config_dir: None,
        vault_path: None,
        config,
        runtime: None,
        limit_state: None,
    };
    let mut short_break = response_for_phase("short_break");
    let mut long_break = response_for_phase("long_break");

    assert!(should_enforce(&snapshot, &mut short_break));
    assert!(!should_enforce(&snapshot, &mut long_break));
}

#[test]
fn enforces_focus_independently_from_break_toggles() {
    let mut config = config();
    config.block_during_focus = false;
    config.block_during_short_breaks = true;
    let snapshot = StateSnapshot {
        config_dir: None,
        vault_path: None,
        config,
        runtime: None,
        limit_state: None,
    };
    let mut focus = response_for_phase("focus");
    let mut short_break = response_for_phase("short_break");

    assert!(!should_enforce(&snapshot, &mut focus));
    assert!(should_enforce(&snapshot, &mut short_break));
}

#[test]
fn skips_paused_focus_when_pause_setting_enabled() {
    let snapshot = StateSnapshot {
        config_dir: None,
        vault_path: None,
        config: config(),
        runtime: Some(runtime_for_phase("focus", true)),
        limit_state: None,
    };
    let mut focus = response_for_phase("focus");

    assert!(!should_enforce(&snapshot, &mut focus));
}

#[test]
fn keeps_enforcing_idle_paused_focus() {
    let mut runtime = runtime_for_phase("focus", true);
    runtime.pause_reason = Some("idle".to_string());
    let snapshot = StateSnapshot {
        config_dir: None,
        vault_path: None,
        config: config(),
        runtime: Some(runtime),
        limit_state: None,
    };
    let mut focus = response_for_phase("focus");

    assert!(should_enforce(&snapshot, &mut focus));
}

#[test]
fn keeps_enforcing_suspend_paused_focus() {
    let mut runtime = runtime_for_phase("focus", true);
    runtime.pause_reason = Some("suspend".to_string());
    let snapshot = StateSnapshot {
        config_dir: None,
        vault_path: None,
        config: config(),
        runtime: Some(runtime),
        limit_state: None,
    };
    let mut focus = response_for_phase("focus");

    assert!(should_enforce(&snapshot, &mut focus));
}

#[test]
fn treats_missing_pause_reason_as_regular_pause() {
    let mut runtime = runtime_for_phase("focus", true);
    runtime.pause_reason = None;
    let snapshot = StateSnapshot {
        config_dir: None,
        vault_path: None,
        config: config(),
        runtime: Some(runtime),
        limit_state: None,
    };
    let mut focus = response_for_phase("focus");

    assert!(!should_enforce(&snapshot, &mut focus));
}

#[test]
fn enforces_paused_focus_when_pause_setting_disabled() {
    let mut config = config();
    config.pause_during_focus_pause = false;
    let snapshot = StateSnapshot {
        config_dir: None,
        vault_path: None,
        config,
        runtime: Some(runtime_for_phase("focus", true)),
        limit_state: None,
    };
    let mut focus = response_for_phase("focus");

    assert!(should_enforce(&snapshot, &mut focus));
}

#[test]
fn blocks_hosts_outside_whitelist_mode() {
    let mut config = config();
    config.mode = DoomscrollingMode::Whitelist;
    let decision = decide_url("reddit.com", None, &config);
    assert!(decision.blocked);
    assert_eq!(
        decision.matched_rule_name.as_deref(),
        Some("not in whitelist")
    );
}

#[test]
fn allows_hosts_inside_whitelist_mode() {
    let mut config = config();
    config.mode = DoomscrollingMode::Whitelist;
    let decision = decide_url("docs.github.com", None, &config);
    assert!(!decision.blocked);
    assert_eq!(
        decision.matched_rule_name.as_deref(),
        Some("whitelist: github.com")
    );
}

#[test]
fn rules_fingerprint_changes_when_mode_or_rules_change() {
    let mut changed_config = config();
    let base = super::rules_fingerprint(&changed_config, None);

    changed_config.mode = DoomscrollingMode::Whitelist;
    assert_ne!(super::rules_fingerprint(&changed_config, None), base);

    changed_config.mode = DoomscrollingMode::Blacklist;
    changed_config
        .blocked_hosts
        .push("news.ycombinator.com".to_string());
    assert_ne!(super::rules_fingerprint(&changed_config, None), base);

    let mut category_config = config();
    category_config
        .blocked_category_ids
        .push("news".to_string());
    assert_ne!(super::rules_fingerprint(&category_config, None), base);
}
