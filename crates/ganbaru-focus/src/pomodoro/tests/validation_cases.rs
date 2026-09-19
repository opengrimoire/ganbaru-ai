use super::super::*;

#[test]
fn validates_segment_enums() {
    assert!(validate_phase("focus").is_ok());
    assert!(validate_phase("short_break").is_ok());
    assert!(validate_phase("wrong").is_err());
    assert!(validate_status("active").is_ok());
    assert!(validate_status("interrupted").is_ok());
    assert!(validate_status("planned").is_err());
    assert!(validate_status("wrong").is_err());
}

#[test]
fn normalizes_inverted_segment_update_intervals() {
    let normalized = normalize_segment_update(PomodoroSegmentUpdate {
        id: "segment-1".to_string(),
        status: "interrupted".to_string(),
        planned_end: "2026-05-29T10:40:00Z".to_string(),
        actual_start: Some("2026-05-29T10:05:00Z".to_string()),
        actual_end: Some("2026-05-29T10:00:00Z".to_string()),
        end_reason: Some("stopped".to_string()),
        occurred_at: Some("2026-05-29T10:00:00Z".to_string()),
        pauses: vec![PomodoroPauseWrite {
            started_at: "2026-05-29T10:05:00Z".to_string(),
            ended_at: Some("2026-05-29T10:04:00Z".to_string()),
            reason: "idle".to_string(),
        }],
    });

    assert_eq!(
        normalized.actual_end,
        Some("2026-05-29T10:05:00Z".to_string())
    );
    assert_eq!(
        normalized.pauses[0].ended_at,
        Some("2026-05-29T10:05:00Z".to_string())
    );
}

#[test]
fn validates_pause_reason() {
    assert!(validate_pause_reason("idle").is_ok());
    assert!(validate_pause_reason("manual").is_ok());
    assert!(validate_pause_reason("suspend").is_ok());
    assert!(validate_pause_reason("unknown").is_err());
}

#[test]
fn validates_run_and_segment_end_reasons() {
    assert!(validate_run_end_reason("completed").is_ok());
    assert!(validate_run_end_reason("crash_recovery").is_err());
    assert!(validate_segment_end_reason("crash_recovery").is_ok());
    assert!(validate_segment_end_reason("focus_failed").is_ok());
    assert!(validate_segment_end_reason("unknown").is_err());
}

#[test]
fn validates_runtime_rhythm_limits() {
    assert!(
        validate_run_rhythm(&PomodoroRunRhythm::Count {
            focus_duration_minutes: 120,
            short_break_minutes: 30,
            long_break_minutes: 60,
            long_break_after_focus_count: 12,
        })
        .is_ok()
    );
    assert!(
        validate_run_rhythm(&PomodoroRunRhythm::Count {
            focus_duration_minutes: 121,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        })
        .is_err()
    );
    assert!(
        validate_run_rhythm(&PomodoroRunRhythm::Sequence {
            steps: vec![PomodoroRunSequenceStep {
                focus_duration_minutes: 25,
                break_phase: "short_break".to_string(),
                break_duration_minutes: 31,
            }],
        })
        .is_err()
    );
}

#[test]
fn validates_run_window_update() {
    assert!(
        validate_run_window_update(&PomodoroRunWindowUpdate {
            run_id: "run-1".to_string(),
            planned_end: "2026-05-23T15:00:00Z".to_string(),
        })
        .is_ok()
    );
    assert!(
        validate_run_window_update(&PomodoroRunWindowUpdate {
            run_id: String::new(),
            planned_end: "2026-05-23T15:00:00Z".to_string(),
        })
        .is_err()
    );
}

#[test]
fn validates_run_event_types() {
    assert!(validate_event_type("skip_break").is_ok());
    assert!(validate_event_type("extend_focus").is_ok());
    assert!(validate_event_type("go_to_break_now").is_ok());
    assert!(validate_event_type("start_focus_now").is_ok());
    assert!(validate_event_type("focus_failed").is_ok());
    assert!(validate_event_type("unknown").is_err());
}

#[test]
fn canonicalizes_recurring_instance_ids() {
    assert_eq!(canonical_event_id("event-1").unwrap(), "event-1");
    assert_eq!(
        canonical_event_id("event-1::2026-05-09").unwrap(),
        "event-1"
    );
    assert!(canonical_event_id("::2026-05-09").is_err());
}
