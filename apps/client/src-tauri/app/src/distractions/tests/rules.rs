use super::*;

#[test]
fn foreground_close_rejects_reused_processes_changed_apps_and_protected_aliases() {
    let mut status =
        foreground_status_from_parts("Game", Some("game".into()), Some(42), vec!["game".into()]);
    status.process_identity = Some("process-start-1".into());
    let expected = DistractionsForegroundDesktopAppExpectation {
        app_name: status.app_name.clone(),
        process_name: status.process_name.clone(),
        process_id: status.process_id,
        process_identity: status.process_identity.clone(),
        match_names: status.match_names.clone(),
    };
    assert!(foreground_expectation_matches(&status, &expected));
    status.process_identity = Some("process-start-2".into());
    assert!(!foreground_expectation_matches(&status, &expected));
    status.process_identity = expected.process_identity.clone();
    status.app_name = Some("Other game".into());
    assert!(!foreground_expectation_matches(&status, &expected));
    status.app_name = expected.app_name.clone();
    status.match_names.push("bash".into());
    assert!(validate_foreground_status_is_closeable(&status).is_err());
    let protected =
        foreground_status_from_parts("Game", Some("bash".into()), Some(42), vec!["game".into()]);
    assert!(validate_foreground_status_is_closeable(&protected).is_err());
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
    assert!(super::is_protected_desktop_app_name(
        "org.opengrimoire.ganbaruai"
    ));
    assert!(super::is_protected_desktop_app_name(
        "org.opengrimoire.ganbaruai.dev"
    ));
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
fn limit_state_requires_a_local_date() {
    let state = DistractionsLimitState {
        local_date: "today".to_string(),
        week_start_local_date: "2026-05-25".to_string(),
        updated_at: "2026-05-28T00:00:00.000Z".to_string(),
        database_path: Some("/tmp/ganbaru-ai-vault/ganbaru-ai.sqlite".to_string()),
        configuration_digest: None,
        limits: vec![DistractionsLimitStateItem {
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
        DistractionsDesktopAppCandidate {
            name: "Terminal".to_string(),
            source: "Installed app".to_string(),
            detail: Some("terminal.desktop".to_string()),
            process_names: vec!["gnome-terminal".to_string()],
        },
        DistractionsDesktopAppCandidate {
            name: "Steam".to_string(),
            source: "Installed app".to_string(),
            detail: Some("steam.desktop".to_string()),
            process_names: vec!["Steam".to_string(), "steam".to_string()],
        },
        DistractionsDesktopAppCandidate {
            name: "steam".to_string(),
            source: "Installed app".to_string(),
            detail: Some("duplicate.desktop".to_string()),
            process_names: vec!["steam".to_string()],
        },
        DistractionsDesktopAppCandidate {
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
        DistractionsDesktopAppRuleInput {
            rule_identity: super::DistractionsDesktopRuleIdentity::DesktopApp {
                rule_id: "Terminal".to_string(),
            },
            name: "Terminal".to_string(),
            match_names: vec!["gnome-terminal".to_string()],
        },
        DistractionsDesktopAppRuleInput {
            rule_identity: super::DistractionsDesktopRuleIdentity::DesktopApp {
                rule_id: "Steam".to_string(),
            },
            name: "Steam".to_string(),
            match_names: vec!["sh".to_string(), "steam".to_string()],
        },
    ]);

    assert!(!matchers.contains_key("terminal"));
    assert!(!matchers.contains_key("gnome-terminal"));
    assert!(!matchers.contains_key("sh"));
    assert_eq!(
        matchers
            .get("steam")
            .map(|matcher| matcher.app_name.as_str()),
        Some("Steam")
    );
}

#[cfg(target_os = "linux")]
#[test]
fn process_scan_cancellation_discards_partial_matches() {
    let apps = vec![DistractionsDesktopAppRuleInput {
        rule_identity: super::DistractionsDesktopRuleIdentity::DesktopApp {
            rule_id: "Steam".to_string(),
        },
        name: "Steam".to_string(),
        match_names: vec!["steam".to_string()],
    }];
    let matches = super::list_blocked_desktop_app_matches(apps, || true);
    assert!(matches.is_empty());
}
