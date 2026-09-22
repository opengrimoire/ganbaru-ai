use super::*;

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
fn stale_limit_state_is_not_authoritative() {
    let dir = std::env::temp_dir().join(format!(
        "ganbaru-ai-doomscrolling-stale-limit-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("doomscrolling-limit-state.json");
    let database_path = dir.join("ganbaru-ai.sqlite");
    let value = serde_json::json!({
        "localDate": "2026-05-26",
        "weekStartLocalDate": "2026-05-25",
        "updatedAt": "2026-05-26T00:00:00.000Z",
        "databasePath": database_path,
        "limits": []
    });
    std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    let checked_at = DateTime::parse_from_rfc3339("2026-05-26T00:00:21.000Z")
        .unwrap()
        .with_timezone(&Utc);

    assert!(read_fresh_limit_state(&path, checked_at, &database_path).is_none());
    std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn atomic_state_write_does_not_follow_predictable_temp_symlinks() {
    use std::os::unix::fs::symlink;

    let dir = std::env::temp_dir().join(format!(
        "ganbaru-ai-doomscrolling-atomic-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("doomscrolling-state.json");
    let target = dir.join("protected.txt");
    let predictable_temp = dir.join("doomscrolling-state.json.tmp");
    std::fs::write(&target, "protected").unwrap();
    symlink(&target, &predictable_temp).unwrap();

    write_text_file_atomically(&path, "new state").unwrap();

    assert_eq!(std::fs::read_to_string(&target).unwrap(), "protected");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "new state");
    assert!(
        std::fs::symlink_metadata(&predictable_temp)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn oversized_authorization_config_is_rejected() {
    let path = std::env::temp_dir().join(format!(
        "ganbaru-ai-doomscrolling-oversized-{}.json",
        std::process::id()
    ));
    std::fs::write(
        &path,
        vec![b' '; MAX_AUTHORIZATION_CONFIG_BYTES as usize + 1],
    )
    .unwrap();

    assert_eq!(
        read_bounded_authorization_config(&path)
            .unwrap_err()
            .to_string(),
        "persisted doomscrolling configuration is too large"
    );
    std::fs::remove_file(path).unwrap();
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
