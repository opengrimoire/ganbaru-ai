use super::*;

#[test]
fn desktop_rule_identity_preserves_tagged_wire_shape() {
    let desktop = DoomscrollingDesktopRuleIdentity::DesktopApp {
        rule_id: "Steam".to_string(),
    };
    let usage = DoomscrollingDesktopRuleIdentity::UsageLimit {
        rule_id: "games".to_string(),
        entry_id: "steam".to_string(),
    };

    assert_eq!(
        serde_json::to_value(desktop).unwrap(),
        serde_json::json!({"kind": "desktop-app", "ruleId": "Steam"})
    );
    assert_eq!(
        serde_json::to_value(usage).unwrap(),
        serde_json::json!({
            "kind": "usage-limit",
            "ruleId": "games",
            "entryId": "steam"
        })
    );
}

#[test]
fn public_status_preserves_camel_case_wire_shape() {
    let status = DoomscrollingForegroundDesktopAppStatus {
        process_identity: None,
        available: true,
        app_name: Some("Steam".to_string()),
        process_name: Some("steam".to_string()),
        process_id: Some(42),
        match_names: vec!["steam".to_string()],
        reason: None,
    };

    assert_eq!(
        serde_json::to_value(status).unwrap(),
        serde_json::json!({
            "available": true,
            "appName": "Steam",
            "processName": "steam",
            "processId": 42,
            "matchNames": ["steam"],
            "reason": null
        })
    );
}

#[test]
fn command_adapters_are_registered_at_their_defining_modules() {
    let handlers = include_str!("../../desktop_runtime.rs");
    for command in [
        "doomscrolling::commands::doomscrolling_open_extension_install_docs",
        "doomscrolling::state::doomscrolling_get_extension_status",
        "doomscrolling::limits_read::doomscrolling_load_usage_projection",
    ] {
        assert!(handlers.contains(command), "missing handler {command}");
    }
    for removed in [
        "doomscrolling_close_desktop_app",
        "doomscrolling_close_current_foreground_desktop_app",
        "doomscrolling_list_blocked_desktop_app_matches",
        "doomscrolling_record_usage_samples",
        "doomscrolling_record_usage_sample",
        "doomscrolling_list_usage_samples",
        "doomscrolling_record_desktop_block_event",
    ] {
        assert!(
            !handlers.contains(removed),
            "frontend execution handler remains: {removed}"
        );
    }
    assert!(handlers.contains("doomscrolling::runtime::setup(app.handle())"));
}

#[test]
fn platform_foreground_modules_keep_explicit_cfg_boundaries() {
    let module = include_str!("../foreground/mod.rs");
    assert!(module.contains("target_os = \"linux\""));
    assert!(module.contains("target_os = \"macos\""));
    assert!(module.contains("cfg(windows)"));
}
