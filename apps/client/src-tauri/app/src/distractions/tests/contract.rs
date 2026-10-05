use super::*;

#[test]
fn desktop_rule_identity_preserves_tagged_wire_shape() {
    let desktop = DistractionsDesktopRuleIdentity::DesktopApp {
        rule_id: "Steam".to_string(),
    };
    let usage = DistractionsDesktopRuleIdentity::UsageLimit {
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
    let status = DistractionsForegroundDesktopAppStatus {
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
    let handlers = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/runtime/desktop.rs"
    ));
    for command in [
        "distractions::commands::distractions_open_extension_install_docs",
        "distractions::state_files::distractions_get_extension_status",
        "distractions::limits_read::distractions_load_usage_projection",
    ] {
        assert!(handlers.contains(command), "missing handler {command}");
    }
    for removed in [
        "distractions_close_desktop_app",
        "distractions_close_current_foreground_desktop_app",
        "distractions_list_blocked_desktop_app_matches",
        "distractions_record_usage_samples",
        "distractions_record_usage_sample",
        "distractions_list_usage_samples",
        "distractions_record_desktop_block_event",
    ] {
        assert!(
            !handlers.contains(removed),
            "frontend execution handler remains: {removed}"
        );
    }
    assert!(handlers.contains("distractions::runtime::setup(app.handle())"));
}

#[test]
fn platform_foreground_modules_keep_explicit_cfg_boundaries() {
    let module = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/distractions/foreground.rs"
    ));
    assert!(module.contains("target_os = \"linux\""));
    assert!(module.contains("target_os = \"macos\""));
    assert!(module.contains("cfg(windows)"));
}
