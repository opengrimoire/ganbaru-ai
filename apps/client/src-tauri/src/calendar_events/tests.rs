use super::{
    apply_delete_archive_operations_tx, apply_recurrence_commit_operations_tx, apply_update_field,
    archive_calendar_event_tx, cap_calendar_series_tx, delete_calendar_event_tx,
    filter_excluded_dates, insert_calendar_event_row, insert_pomodoro_config,
    protected_active_event_end_update_allowed, replace_pomodoro_config,
    restore_archived_calendar_event_tx, sanitize_stored_event_description,
    split_calendar_series_tx, update_calendar_event_tx, validate_color, validate_event_create,
    validate_non_negative, validate_positive, validate_priority, validate_update_field,
    CalendarActiveEventReferenceTransfer, CalendarDeleteArchiveOperation, CalendarDetachInstance,
    CalendarEventCreate, CalendarEventMutationContext, CalendarEventMutationTarget,
    CalendarEventUpdate, CalendarEventUpdateField, CalendarGuestPermissions,
    CalendarPomodoroConfig, CalendarPomodoroConfigPatch, CalendarPomodoroRhythm,
    CalendarPomodoroSequenceStep, CalendarRecurrenceCommitOperation, CalendarSplitSeries,
};

fn event_create() -> CalendarEventCreate {
    CalendarEventCreate {
        id: "event-1".to_string(),
        title: "Focus".to_string(),
        start_time: "2026-05-09T10:00:00Z".to_string(),
        end_time: "2026-05-09T11:00:00Z".to_string(),
        timezone: "America/Monterrey".to_string(),
        calendar_id: "local".to_string(),
        color: None,
        description: String::new(),
        rrule: None,
        notifications: None,
        exceptions: None,
        repeat_until: None,
        all_day: false,
        location: String::new(),
        url: String::new(),
        transparency: "opaque".to_string(),
        status: "confirmed".to_string(),
        source_uid: None,
        visibility: "public".to_string(),
        priority: None,
        categories: None,
        geo: None,
        sequence: 0,
        rdate: None,
        extended_properties: None,
        organizer: None,
        meeting_enabled: false,
        local_rsvp_status: None,
        guest_can_modify: false,
        guest_can_invite_others: true,
        guest_can_see_other_guests: true,
        created_at: "2026-05-09 10:00:00".to_string(),
        updated_at: "2026-05-09 10:00:00".to_string(),
        pomodoro_config: None,
        attendees: Vec::new(),
    }
}

fn pomodoro_config() -> CalendarPomodoroConfig {
    CalendarPomodoroConfig {
        rhythm: CalendarPomodoroRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        },
        rhythm_source: "preset".to_string(),
        preset_key: Some("adaptive".to_string()),
        idle_timeout_minutes: Some(3),
    }
}

fn sequence_pomodoro_config() -> CalendarPomodoroConfig {
    CalendarPomodoroConfig {
        rhythm: CalendarPomodoroRhythm::Sequence {
            steps: vec![
                CalendarPomodoroSequenceStep {
                    focus_duration_minutes: 25,
                    break_phase: "short_break".to_string(),
                    break_duration_minutes: 5,
                },
                CalendarPomodoroSequenceStep {
                    focus_duration_minutes: 35,
                    break_phase: "long_break".to_string(),
                    break_duration_minutes: 12,
                },
            ],
        },
        rhythm_source: "custom".to_string(),
        preset_key: None,
        idle_timeout_minutes: None,
    }
}

fn invalid_sequence_pomodoro_config() -> CalendarPomodoroConfig {
    CalendarPomodoroConfig {
        rhythm: CalendarPomodoroRhythm::Sequence { steps: Vec::new() },
        rhythm_source: "custom".to_string(),
        preset_key: None,
        idle_timeout_minutes: None,
    }
}

#[test]
fn validates_event_color_and_priority_ranges() {
    assert!(validate_color(Some(0), "color").is_ok());
    assert!(validate_color(Some(31), "color").is_ok());
    assert!(validate_color(Some(32), "color").is_err());
    assert!(validate_priority(Some(9)).is_ok());
    assert!(validate_priority(Some(10)).is_err());
}

#[test]
fn validates_duration_ranges() {
    assert!(validate_positive(1, "focus_duration_minutes").is_ok());
    assert!(validate_positive(0, "focus_duration_minutes").is_err());
    assert!(validate_non_negative(0, "idle_timeout_minutes").is_ok());
    assert!(validate_non_negative(-1, "idle_timeout_minutes").is_err());
}

#[test]
fn accepts_empty_event_titles() {
    let mut event = event_create();
    event.title = String::new();
    assert!(validate_event_create(&event).is_ok());
    assert!(validate_update_field(&CalendarEventUpdateField::Title(String::new())).is_ok());
}

#[test]
fn all_day_event_create_rejects_pomodoro_config() {
    let mut event = event_create();
    event.all_day = true;
    event.pomodoro_config = Some(pomodoro_config());
    assert!(validate_event_create(&event).is_err());
}

#[test]
fn calendar_event_create_row_matches_current_schema() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        let event = event_create();
        let mut tx = pool.begin().await.unwrap();
        insert_calendar_event_row(&mut tx, &event).await.unwrap();
        tx.commit().await.unwrap();

        let saved: (String, i64, Option<String>) = sqlx::query_as(
            "SELECT title, meeting_enabled, local_rsvp_status
             FROM calendar_events
             WHERE id = 'event-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(saved.0, "Focus");
        assert_eq!(saved.1, 0);
        assert_eq!(saved.2, None);
    });
}

#[test]
fn deleting_event_rejects_active_pomodoro_run() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event(&pool, "event-1", "").await;
        insert_test_open_pomodoro_run(&pool).await;
        insert_test_active_pomodoro_segment(&pool).await;

        let mut tx = pool.begin().await.unwrap();
        let err = delete_calendar_event_tx(
            &mut tx,
            &CalendarEventMutationTarget {
                id: "event-1".to_string(),
                occurrence_start: None,
                occurrence_end: None,
            },
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();
        assert!(err.contains("active pomodoro run"));

        let run: (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT ended_at, event_id
             FROM pomodoro_runs
             WHERE id = 'run-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let segment: (String, Option<String>) = sqlx::query_as(
            "SELECT status, event_id
             FROM pomodoro_segments
             WHERE id = 'segment-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(run.0.is_none());
        assert_eq!(run.1, Some("event-1".to_string()));
        assert_eq!(segment.0, "active");
        assert_eq!(segment.1, Some("event-1".to_string()));
    });
}

#[test]
fn future_untracked_event_hard_deletes() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2099-05-09T10:00:00Z",
            "2099-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        delete_calendar_event_tx(
            &mut tx,
            &CalendarEventMutationTarget {
                id: "event-1".to_string(),
                occurrence_start: None,
                occurrence_end: None,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let live_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let archive_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(live_count, 0);
        assert_eq!(archive_count, 0);
    });
}

#[test]
fn past_event_delete_rejects_and_archive_succeeds() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event(&pool, "event-1", "").await;

        let mut tx = pool.begin().await.unwrap();
        let err = delete_calendar_event_tx(
            &mut tx,
            &CalendarEventMutationTarget {
                id: "event-1".to_string(),
                occurrence_start: None,
                occurrence_end: None,
            },
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();
        assert!(err.contains("archive it instead"));

        let mut tx = pool.begin().await.unwrap();
        archive_calendar_event_tx(
            &mut tx,
            &CalendarEventMutationTarget {
                id: "event-1".to_string(),
                occurrence_start: None,
                occurrence_end: None,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let live_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let archived_title: String =
            sqlx::query_scalar("SELECT title FROM calendar_events_archive WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(live_count, 0);
        assert_eq!(archived_title, "");
    });
}

#[test]
fn protected_event_update_rejects_without_open_run() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2000-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        let err = update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![
                    CalendarEventUpdateField::Title("Changed".to_string()),
                    CalendarEventUpdateField::StartTime("2000-05-09T10:00:00Z".to_string()),
                    CalendarEventUpdateField::EndTime("2999-05-09T11:00:00Z".to_string()),
                    CalendarEventUpdateField::AllDay(false),
                ],
                attendees: None,
                alarms: None,
                pomodoro_config: None,
            },
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();

        assert!(err.contains("protected"));
        let title: String =
            sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title, "");
    });
}

#[test]
fn active_non_pomodoro_title_update_succeeds_without_open_run() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![CalendarEventUpdateField::Title("Changed".to_string())],
                attendees: None,
                alarms: None,
                pomodoro_config: None,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let title: String =
            sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title, "Changed");
    });
}

#[test]
fn active_non_pomodoro_full_panel_update_succeeds_without_open_run() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![
                    CalendarEventUpdateField::Title("Changed".to_string()),
                    CalendarEventUpdateField::StartTime("2000-05-09T10:00:00Z".to_string()),
                    CalendarEventUpdateField::EndTime("2999-05-09T11:00:00Z".to_string()),
                    CalendarEventUpdateField::Timezone("America/Monterrey".to_string()),
                    CalendarEventUpdateField::CalendarId("local".to_string()),
                    CalendarEventUpdateField::Color(None),
                    CalendarEventUpdateField::Description(String::new()),
                    CalendarEventUpdateField::Rrule(None),
                    CalendarEventUpdateField::RepeatUntil(None),
                    CalendarEventUpdateField::Notifications(None),
                    CalendarEventUpdateField::Exceptions(None),
                    CalendarEventUpdateField::AllDay(false),
                    CalendarEventUpdateField::Location(String::new()),
                    CalendarEventUpdateField::Url(String::new()),
                    CalendarEventUpdateField::Transparency("opaque".to_string()),
                    CalendarEventUpdateField::Status("confirmed".to_string()),
                    CalendarEventUpdateField::SourceUid(None),
                    CalendarEventUpdateField::Visibility("public".to_string()),
                    CalendarEventUpdateField::Priority(None),
                    CalendarEventUpdateField::Categories(None),
                    CalendarEventUpdateField::Geo(None),
                    CalendarEventUpdateField::Sequence(0),
                    CalendarEventUpdateField::Rdate(None),
                    CalendarEventUpdateField::ExtendedProperties(None),
                    CalendarEventUpdateField::Organizer(None),
                    CalendarEventUpdateField::MeetingEnabled(false),
                    CalendarEventUpdateField::LocalRsvpStatus(None),
                    CalendarEventUpdateField::GuestPermissions(CalendarGuestPermissions {
                        guest_can_modify: false,
                        guest_can_invite_others: true,
                        guest_can_see_other_guests: true,
                    }),
                ],
                attendees: Some(Vec::new()),
                alarms: Some(Vec::new()),
                pomodoro_config: Some(CalendarPomodoroConfigPatch::Clear),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let title: String =
            sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title, "Changed");
    });
}

#[test]
fn active_event_with_completed_pomodoro_history_update_succeeds_without_open_run() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            None,
        )
        .await;
        insert_test_completed_pomodoro_history(&pool, "event-1", "event-1", "2000-05-09").await;

        let mut tx = pool.begin().await.unwrap();
        update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![
                    CalendarEventUpdateField::Title("Changed".to_string()),
                    CalendarEventUpdateField::StartTime("2000-05-09T10:00:00Z".to_string()),
                    CalendarEventUpdateField::EndTime("2999-05-09T11:00:00Z".to_string()),
                    CalendarEventUpdateField::Rrule(None),
                    CalendarEventUpdateField::RepeatUntil(None),
                    CalendarEventUpdateField::Exceptions(None),
                    CalendarEventUpdateField::AllDay(false),
                    CalendarEventUpdateField::Rdate(None),
                ],
                attendees: None,
                alarms: None,
                pomodoro_config: Some(CalendarPomodoroConfigPatch::Clear),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let title: String =
            sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title, "Changed");
    });
}

#[test]
fn active_non_pomodoro_start_update_rejects_without_open_run() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        let err = update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![CalendarEventUpdateField::StartTime(
                    "2000-05-09T10:15:00Z".to_string(),
                )],
                attendees: None,
                alarms: None,
                pomodoro_config: None,
            },
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();

        assert!(err.contains("protected"));
    });
}

#[test]
fn active_non_pomodoro_recurrence_update_rejects_without_open_run() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        let err = update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![CalendarEventUpdateField::Rrule(Some(
                    "FREQ=DAILY".to_string(),
                ))],
                attendees: None,
                alarms: None,
                pomodoro_config: None,
            },
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();

        assert!(err.contains("protected"));
    });
}

#[test]
fn active_non_pomodoro_end_update_succeeds_without_open_run() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![CalendarEventUpdateField::EndTime(
                    "2001-05-09T10:30:00Z".to_string(),
                )],
                attendees: None,
                alarms: None,
                pomodoro_config: None,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let end_time: String =
            sqlx::query_scalar("SELECT end_time FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(end_time, "2001-05-09T10:30:00Z");
    });
}

#[test]
fn active_non_pomodoro_config_set_succeeds_without_open_run() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![],
                attendees: None,
                alarms: None,
                pomodoro_config: Some(CalendarPomodoroConfigPatch::Set(pomodoro_config())),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_configs WHERE event_id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1);
    });
}

#[test]
fn invalid_config_replacement_preserves_existing_child_rows() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        insert_pomodoro_config(&mut tx, "event-1", &sequence_pomodoro_config())
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let mut tx = pool.begin().await.unwrap();
        let result =
            replace_pomodoro_config(&mut tx, "event-1", &invalid_sequence_pomodoro_config()).await;
        assert!(result.is_err());
        tx.rollback().await.unwrap();

        let saved: (String, i64) = sqlx::query_as(
            "SELECT pc.rhythm_kind, COUNT(pcss.step_index)
             FROM pomodoro_configs pc
             JOIN pomodoro_config_sequence_steps pcss ON pcss.event_id = pc.event_id
             WHERE pc.event_id = 'event-1'
             GROUP BY pc.rhythm_kind",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(saved, ("sequence".to_string(), 2));
    });
}

#[test]
fn active_non_pomodoro_end_permission_accepts_same_second_cut() {
    let patch = CalendarEventUpdate {
        id: "event-1".to_string(),
        updated_at: "2026-05-09T10:30:00Z".to_string(),
        fields: vec![CalendarEventUpdateField::EndTime(
            "2026-05-09T10:30:00Z".to_string(),
        )],
        attendees: None,
        alarms: None,
        pomodoro_config: None,
    };
    let context = CalendarEventMutationContext {
        id: "event-1".to_string(),
        source_event_id: "event-1".to_string(),
        occurrence_date: None,
        start_time: "2026-05-09T10:00:00Z".to_string(),
        end_time: "2026-05-09T11:00:00Z".to_string(),
        rrule: None,
        repeat_until: None,
        synthetic: false,
    };

    assert!(protected_active_event_end_update_allowed(
        &patch,
        &context,
        "2026-05-09T10:30:00.500Z",
    ));
}

#[test]
fn all_day_update_rejects_existing_pomodoro_config_without_clear() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2999-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            None,
        )
        .await;
        insert_test_pomodoro_config(&pool, "event-1").await;

        let mut tx = pool.begin().await.unwrap();
        let err = update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![CalendarEventUpdateField::AllDay(true)],
                attendees: None,
                alarms: None,
                pomodoro_config: None,
            },
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();
        assert!(err.contains("all-day events cannot have a pomodoro config"));
    });
}

#[test]
fn all_day_update_can_clear_existing_pomodoro_config() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2999-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            None,
        )
        .await;
        insert_test_pomodoro_config(&pool, "event-1").await;

        let mut tx = pool.begin().await.unwrap();
        update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![CalendarEventUpdateField::AllDay(true)],
                attendees: None,
                alarms: None,
                pomodoro_config: Some(CalendarPomodoroConfigPatch::Clear),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let row: (i64, i64) = sqlx::query_as(
            "SELECT all_day,
                    (SELECT COUNT(*) FROM pomodoro_configs WHERE event_id = 'event-1')
             FROM calendar_events WHERE id = 'event-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row, (1, 0));
    });
}

#[test]
fn existing_all_day_event_update_rejects_pomodoro_set() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2999-05-09T00:00:00Z",
            "2999-05-09T00:00:00Z",
            None,
        )
        .await;
        sqlx::query("UPDATE calendar_events SET all_day = 1 WHERE id = 'event-1'")
            .execute(&pool)
            .await
            .unwrap();

        let mut tx = pool.begin().await.unwrap();
        let err = update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![],
                attendees: None,
                alarms: None,
                pomodoro_config: Some(CalendarPomodoroConfigPatch::Set(pomodoro_config())),
            },
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();
        assert!(err.contains("all-day events cannot have a pomodoro config"));
    });
}

#[test]
fn all_day_split_does_not_copy_parent_pomodoro_config() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2999-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            Some("FREQ=DAILY"),
        )
        .await;
        insert_test_pomodoro_config(&pool, "event-1").await;

        let mut tx = pool.begin().await.unwrap();
        split_calendar_series_tx(
            &mut tx,
            &CalendarSplitSeries {
                parent_id: "event-1".to_string(),
                day_before: "2999-05-09".to_string(),
                capped_rrule: Some("FREQ=DAILY;UNTIL=29990509T235959Z".to_string()),
                new_id: "event-2".to_string(),
                title: "All day split".to_string(),
                start_time: "2999-05-10T00:00:00Z".to_string(),
                end_time: "2999-05-10T00:00:00Z".to_string(),
                timezone: "America/Monterrey".to_string(),
                calendar_id: "local".to_string(),
                color: None,
                notifications: None,
                exceptions: None,
                rrule: Some("FREQ=DAILY".to_string()),
                all_day: true,
                location: String::new(),
                transparency: "opaque".to_string(),
                status: "confirmed".to_string(),
                description_patch: None,
                url_patch: None,
                local_rsvp_status: None,
                meeting_enabled: false,
                copy_pomodoro_config: false,
                pomodoro_config: None,
                now: "2026-05-09T10:30:00Z".to_string(),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_configs WHERE event_id = 'event-2'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 0);
    });
}

#[test]
fn future_event_update_succeeds() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2999-05-09T10:00:00Z",
            "2999-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![CalendarEventUpdateField::Title("Changed".to_string())],
                attendees: None,
                alarms: None,
                pomodoro_config: None,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let title: String =
            sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title, "Changed");
    });
}

#[test]
fn active_pomodoro_event_update_succeeds() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event(&pool, "event-1", "").await;
        insert_test_open_pomodoro_run(&pool).await;

        let mut tx = pool.begin().await.unwrap();
        update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![CalendarEventUpdateField::Title("Changed".to_string())],
                attendees: None,
                alarms: None,
                pomodoro_config: None,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let title: String =
            sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title, "Changed");
    });
}

#[test]
fn archived_event_restore_relinks_pomodoro_history() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2000-05-09T11:00:00Z",
            None,
        )
        .await;
        insert_test_completed_pomodoro_history(&pool, "event-1", "event-1", "2000-05-09").await;

        let target = CalendarEventMutationTarget {
            id: "event-1".to_string(),
            occurrence_start: None,
            occurrence_end: None,
        };
        let mut tx = pool.begin().await.unwrap();
        archive_calendar_event_tx(&mut tx, &target).await.unwrap();
        tx.commit().await.unwrap();

        let live_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let archive_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let run_event_id: Option<String> =
            sqlx::query_scalar("SELECT event_id FROM pomodoro_runs WHERE id = 'run-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let segment_event_id: Option<String> =
            sqlx::query_scalar("SELECT event_id FROM pomodoro_segments WHERE id = 'segment-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(live_count, 0);
        assert_eq!(archive_count, 1);
        assert_eq!(run_event_id, None);
        assert_eq!(segment_event_id, None);

        let mut tx = pool.begin().await.unwrap();
        restore_archived_calendar_event_tx(&mut tx, &target)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let live_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let archive_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let run: (Option<String>, String) = sqlx::query_as(
            "SELECT event_id, original_event_id FROM pomodoro_runs WHERE id = 'run-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let segment_event_id: Option<String> =
            sqlx::query_scalar("SELECT event_id FROM pomodoro_segments WHERE id = 'segment-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(live_count, 1);
        assert_eq!(archive_count, 0);
        assert_eq!(run.0, Some("event-1".to_string()));
        assert_eq!(run.1, "event-1");
        assert_eq!(segment_event_id, Some("event-1".to_string()));
    });
}

#[test]
fn archived_synthetic_restore_removes_exception_and_relinks_history() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2000-05-09T11:00:00Z",
            Some("FREQ=DAILY"),
        )
        .await;
        insert_test_completed_pomodoro_history(
            &pool,
            "event-1",
            "event-1::2000-05-10",
            "2000-05-10",
        )
        .await;

        let target = CalendarEventMutationTarget {
            id: "event-1::2000-05-10".to_string(),
            occurrence_start: Some("2000-05-10T10:00:00Z".to_string()),
            occurrence_end: Some("2000-05-10T11:00:00Z".to_string()),
        };
        let mut tx = pool.begin().await.unwrap();
        archive_calendar_event_tx(&mut tx, &target).await.unwrap();
        tx.commit().await.unwrap();

        let parent_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let archive_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'event-1::2000-05-10'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let exdate_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM calendar_event_exdates
             WHERE event_id = 'event-1' AND occurrence_date = '2000-05-10'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let run_event_id: Option<String> =
            sqlx::query_scalar("SELECT event_id FROM pomodoro_runs WHERE id = 'run-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(parent_count, 1);
        assert_eq!(archive_count, 1);
        assert_eq!(exdate_count, 1);
        assert_eq!(run_event_id, None);

        let mut tx = pool.begin().await.unwrap();
        restore_archived_calendar_event_tx(&mut tx, &target)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let archive_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'event-1::2000-05-10'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let exdate_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM calendar_event_exdates
             WHERE event_id = 'event-1' AND occurrence_date = '2000-05-10'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let run: (Option<String>, String) = sqlx::query_as(
            "SELECT event_id, original_event_id FROM pomodoro_runs WHERE id = 'run-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let segment_event_id: Option<String> =
            sqlx::query_scalar("SELECT event_id FROM pomodoro_segments WHERE id = 'segment-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(archive_count, 0);
        assert_eq!(exdate_count, 0);
        assert_eq!(run.0, Some("event-1".to_string()));
        assert_eq!(run.1, "event-1::2000-05-10");
        assert_eq!(segment_event_id, Some("event-1".to_string()));
    });
}

#[test]
fn synthetic_future_delete_adds_exception_without_deleting_parent() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2099-05-09T10:00:00Z",
            "2099-05-09T11:00:00Z",
            Some("FREQ=DAILY"),
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        delete_calendar_event_tx(
            &mut tx,
            &CalendarEventMutationTarget {
                id: "event-1::2099-05-10".to_string(),
                occurrence_start: Some("2099-05-10T10:00:00Z".to_string()),
                occurrence_end: Some("2099-05-10T11:00:00Z".to_string()),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let live_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let exdate_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM calendar_event_exdates
             WHERE event_id = 'event-1' AND occurrence_date = '2099-05-10'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(live_count, 1);
        assert_eq!(exdate_count, 1);
    });
}

#[test]
fn synthetic_archive_uses_id_date_when_utc_start_is_next_day() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2099-05-09T02:00:00Z",
            "2099-05-09T03:00:00Z",
            Some("FREQ=DAILY"),
        )
        .await;

        let target = CalendarEventMutationTarget {
            id: "event-1::2099-05-10".to_string(),
            occurrence_start: Some("2099-05-11T02:00:00Z".to_string()),
            occurrence_end: Some("2099-05-11T03:00:00Z".to_string()),
        };
        let mut tx = pool.begin().await.unwrap();
        archive_calendar_event_tx(&mut tx, &target).await.unwrap();
        tx.commit().await.unwrap();

        let local_date_exdates: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM calendar_event_exdates
             WHERE event_id = 'event-1' AND occurrence_date = '2099-05-10'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let utc_date_exdates: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM calendar_event_exdates
             WHERE event_id = 'event-1' AND occurrence_date = '2099-05-11'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(local_date_exdates, 1);
        assert_eq!(utc_date_exdates, 0);

        let mut tx = pool.begin().await.unwrap();
        restore_archived_calendar_event_tx(&mut tx, &target)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let remaining_exdates: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM calendar_event_exdates WHERE event_id = 'event-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(remaining_exdates, 0);
    });
}

#[test]
fn batch_delete_archive_and_cap_executes_in_one_transaction() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "delete-me",
            "2099-05-09T10:00:00Z",
            "2099-05-09T11:00:00Z",
            None,
        )
        .await;
        insert_test_event_at(
            &pool,
            "archive-me",
            "2000-05-09T10:00:00Z",
            "2000-05-09T11:00:00Z",
            None,
        )
        .await;
        insert_test_event_at(
            &pool,
            "series-1",
            "2099-05-09T10:00:00Z",
            "2099-05-09T11:00:00Z",
            Some("FREQ=DAILY"),
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        apply_delete_archive_operations_tx(
            &mut tx,
            vec![
                CalendarDeleteArchiveOperation::DeleteEvent {
                    target: CalendarEventMutationTarget {
                        id: "delete-me".to_string(),
                        occurrence_start: None,
                        occurrence_end: None,
                    },
                },
                CalendarDeleteArchiveOperation::ArchiveEvent {
                    target: CalendarEventMutationTarget {
                        id: "archive-me".to_string(),
                        occurrence_start: None,
                        occurrence_end: None,
                    },
                },
                CalendarDeleteArchiveOperation::CapSeries {
                    event_id: "series-1".to_string(),
                    repeat_until: "2099-05-08".to_string(),
                    rrule: "FREQ=DAILY;UNTIL=20990508T235959Z".to_string(),
                },
            ],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let delete_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'delete-me'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let archived_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM calendar_events_archive WHERE id = 'archive-me'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let series: (Option<String>, Option<String>) =
            sqlx::query_as("SELECT repeat_until, rrule FROM calendar_events WHERE id = 'series-1'")
                .fetch_one(&pool)
                .await
                .unwrap();

        assert_eq!(delete_count, 0);
        assert_eq!(archived_count, 1);
        assert_eq!(series.0, Some("2099-05-08".to_string()));
        assert_eq!(
            series.1,
            Some("FREQ=DAILY;UNTIL=20990508T235959Z".to_string())
        );
    });
}

#[test]
fn batch_rolls_back_when_later_operation_fails() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "delete-me",
            "2099-05-09T10:00:00Z",
            "2099-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        let err = apply_delete_archive_operations_tx(
            &mut tx,
            vec![
                CalendarDeleteArchiveOperation::DeleteEvent {
                    target: CalendarEventMutationTarget {
                        id: "delete-me".to_string(),
                        occurrence_start: None,
                        occurrence_end: None,
                    },
                },
                CalendarDeleteArchiveOperation::CapSeries {
                    event_id: "missing-series".to_string(),
                    repeat_until: "2099-05-08".to_string(),
                    rrule: "FREQ=DAILY;UNTIL=20990508T235959Z".to_string(),
                },
            ],
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();
        assert!(err.contains("missing-series"));

        let live_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE id = 'delete-me'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(live_count, 1);
    });
}

#[test]
fn recurrence_commit_batch_updates_event_and_active_run_in_one_transaction() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event(&pool, "event-1", "").await;
        insert_test_event_at(
            &pool,
            "event-2",
            "2026-05-10T10:00:00Z",
            "2026-05-10T11:00:00Z",
            None,
        )
        .await;
        insert_test_open_pomodoro_run(&pool).await;
        insert_test_active_pomodoro_segment(&pool).await;

        let mut tx = pool.begin().await.unwrap();
        apply_recurrence_commit_operations_tx(
            &mut tx,
            vec![
                CalendarRecurrenceCommitOperation::UpdateEvent {
                    patch: Box::new(CalendarEventUpdate {
                        id: "event-1".to_string(),
                        updated_at: "2026-05-09T10:30:00Z".to_string(),
                        fields: vec![CalendarEventUpdateField::Title("Changed".to_string())],
                        attendees: None,
                        alarms: None,
                        pomodoro_config: None,
                    }),
                },
                CalendarRecurrenceCommitOperation::TransferActiveEventReference {
                    transfer: CalendarActiveEventReferenceTransfer {
                        new_event_id: "event-2".to_string(),
                        new_event_date: Some("2026-05-10".to_string()),
                        planned_end: Some("2026-05-10T11:00:00Z".to_string()),
                    },
                },
            ],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let title: String =
            sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let run: (String, String, String) = sqlx::query_as(
            "SELECT event_id, original_event_id, event_date FROM pomodoro_runs WHERE id = 'run-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let segment: (String, String) = sqlx::query_as(
            "SELECT event_id, event_date FROM pomodoro_segments WHERE id = 'segment-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(title, "Changed");
        assert_eq!(
            run,
            (
                "event-2".to_string(),
                "event-2".to_string(),
                "2026-05-10".to_string()
            )
        );
        assert_eq!(segment, ("event-2".to_string(), "2026-05-10".to_string()));
    });
}

#[test]
fn recurrence_commit_batch_rolls_back_when_later_operation_fails() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event(&pool, "event-1", "").await;

        let mut tx = pool.begin().await.unwrap();
        let err = apply_recurrence_commit_operations_tx(
            &mut tx,
            vec![
                CalendarRecurrenceCommitOperation::UpdateEvent {
                    patch: Box::new(CalendarEventUpdate {
                        id: "event-1".to_string(),
                        updated_at: "2026-05-09T10:30:00Z".to_string(),
                        fields: vec![CalendarEventUpdateField::Title("Changed".to_string())],
                        attendees: None,
                        alarms: None,
                        pomodoro_config: None,
                    }),
                },
                CalendarRecurrenceCommitOperation::DetachInstance {
                    input: Box::new(CalendarDetachInstance {
                        parent_id: "missing-parent".to_string(),
                        instance_date: "2026-05-10".to_string(),
                        exceptions: "[\"2026-05-10\"]".to_string(),
                        new_id: "detached-1".to_string(),
                        title: "Detached".to_string(),
                        start_time: "2026-05-10T10:00:00Z".to_string(),
                        end_time: "2026-05-10T11:00:00Z".to_string(),
                        timezone: "America/Monterrey".to_string(),
                        calendar_id: "local".to_string(),
                        color: None,
                        notifications: None,
                        all_day: false,
                        location: String::new(),
                        transparency: "opaque".to_string(),
                        status: "confirmed".to_string(),
                        now: "2026-05-09T10:30:00Z".to_string(),
                    }),
                },
            ],
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();
        assert!(!err.is_empty());

        let title: String =
            sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title, "");
    });
}

#[test]
fn batch_hard_delete_rejects_protected_rows() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2000-05-09T11:00:00Z",
            None,
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        let err = apply_delete_archive_operations_tx(
            &mut tx,
            vec![CalendarDeleteArchiveOperation::DeleteEvent {
                target: CalendarEventMutationTarget {
                    id: "event-1".to_string(),
                    occurrence_start: None,
                    occurrence_end: None,
                },
            }],
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();
        assert!(err.contains("archive it instead"));
    });
}

#[test]
fn batch_archive_rejects_active_pomodoro_rows() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event(&pool, "event-1", "").await;
        insert_test_open_pomodoro_run(&pool).await;
        insert_test_active_pomodoro_segment(&pool).await;

        let mut tx = pool.begin().await.unwrap();
        let err = apply_delete_archive_operations_tx(
            &mut tx,
            vec![CalendarDeleteArchiveOperation::ArchiveEvent {
                target: CalendarEventMutationTarget {
                    id: "event-1".to_string(),
                    occurrence_start: None,
                    occurrence_end: None,
                },
            }],
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();
        assert!(err.contains("active pomodoro run"));
    });
}

#[test]
fn batch_synthetic_archive_preserves_original_event_id() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "event-1",
            "2000-05-09T10:00:00Z",
            "2000-05-09T11:00:00Z",
            Some("FREQ=DAILY"),
        )
        .await;
        insert_test_completed_pomodoro_history(
            &pool,
            "event-1",
            "event-1::2000-05-10",
            "2000-05-10",
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        apply_delete_archive_operations_tx(
            &mut tx,
            vec![CalendarDeleteArchiveOperation::ArchiveEvent {
                target: CalendarEventMutationTarget {
                    id: "event-1::2000-05-10".to_string(),
                    occurrence_start: Some("2000-05-10T10:00:00Z".to_string()),
                    occurrence_end: Some("2000-05-10T11:00:00Z".to_string()),
                },
            }],
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let archived_source: String = sqlx::query_scalar(
            "SELECT source_event_id FROM calendar_events_archive WHERE id = 'event-1::2000-05-10'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let exdate_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM calendar_event_exdates
             WHERE event_id = 'event-1' AND occurrence_date = '2000-05-10'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let run: (Option<String>, String) = sqlx::query_as(
            "SELECT event_id, original_event_id FROM pomodoro_runs WHERE id = 'run-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(archived_source, "event-1");
        assert_eq!(exdate_count, 1);
        assert_eq!(run.0, None);
        assert_eq!(run.1, "event-1::2000-05-10");
    });
}

#[test]
fn batch_cap_updates_repeat_rule_and_timestamp() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event_at(
            &pool,
            "series-1",
            "2099-05-09T10:00:00Z",
            "2099-05-09T11:00:00Z",
            Some("FREQ=DAILY"),
        )
        .await;

        let before: String =
            sqlx::query_scalar("SELECT updated_at FROM calendar_events WHERE id = 'series-1'")
                .fetch_one(&pool)
                .await
                .unwrap();

        let mut tx = pool.begin().await.unwrap();
        cap_calendar_series_tx(
            &mut tx,
            "series-1",
            "2099-05-08",
            "FREQ=DAILY;UNTIL=20990508T235959Z",
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let row: (Option<String>, Option<String>, String) = sqlx::query_as(
            "SELECT repeat_until, rrule, updated_at FROM calendar_events WHERE id = 'series-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, Some("2099-05-08".to_string()));
        assert_eq!(row.1, Some("FREQ=DAILY;UNTIL=20990508T235959Z".to_string()));
        assert_ne!(row.2, before);
    });
}

#[test]
fn rejects_confidential_event_visibility() {
    let mut event = event_create();
    event.visibility = "confidential".to_string();
    assert!(validate_event_create(&event).is_err());
    assert!(validate_update_field(&CalendarEventUpdateField::Visibility(
        "confidential".to_string()
    ))
    .is_err());
}

#[test]
fn filters_excluded_progress_dates() {
    let dates = vec![
        "2026-05-07".to_string(),
        "2026-05-08".to_string(),
        "2026-05-09".to_string(),
    ];
    assert_eq!(
        filter_excluded_dates(dates, Some("2026-05-08")),
        vec!["2026-05-07".to_string(), "2026-05-09".to_string()]
    );
}

#[test]
fn update_description_field_sanitizes_before_persistence() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event(&pool, "event-1", "").await;
        let mut tx = pool.begin().await.unwrap();

        apply_update_field(
            &mut tx,
            "event-1",
            &CalendarEventUpdateField::Description(
                "<p onclick=\"alert(1)\">Safe <a href=\"javascript:alert(1)\">bad</a></p>"
                    .to_string(),
            ),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let description: String =
            sqlx::query_scalar("SELECT description FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(description, "<p>Safe <a>bad</a></p>");
    });
}

#[test]
fn copied_event_description_is_sanitized_after_split_or_detach_insert() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event(
            &pool,
            "event-1",
            "<div><img src=\"x\"><strong>Safe</strong></div>",
        )
        .await;
        let mut tx = pool.begin().await.unwrap();

        sanitize_stored_event_description(&mut tx, "event-1")
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let description: String =
            sqlx::query_scalar("SELECT description FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(description, "<div><strong>Safe</strong></div>");
    });
}

async fn in_memory_pool() -> sqlx::SqlitePool {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::db::run_migrations(&pool).await.unwrap();
    pool
}

async fn insert_test_event(pool: &sqlx::SqlitePool, id: &str, description: &str) {
    insert_test_event_at(
        pool,
        id,
        "2026-05-09T10:00:00Z",
        "2026-05-09T11:00:00Z",
        None,
    )
    .await;
    sqlx::query("UPDATE calendar_events SET description = ? WHERE id = ?")
        .bind(description)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

async fn insert_test_event_at(
    pool: &sqlx::SqlitePool,
    id: &str,
    start_time: &str,
    end_time: &str,
    rrule: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO calendar_events
           (id, title, start_time, end_time, timezone, calendar_id,
            color, description, rrule, repeat_until, all_day, location, url,
            transparency, status, source_uid, visibility, priority, geo_lat, geo_lng,
            sequence,
            guest_can_modify, guest_can_invite_others, guest_can_see_other_guests,
            created_at, updated_at)
         VALUES (?, '', ?, ?,
            'America/Monterrey', 'local', NULL, '', ?, NULL,
            0, '', '', 'opaque', 'confirmed',
            NULL, 'public', NULL, NULL, NULL, 0,
            0, 1, 1, '2026-05-09 10:00:00', '2026-05-09 10:00:00')",
    )
    .bind(id)
    .bind(start_time)
    .bind(end_time)
    .bind(rrule)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_test_open_pomodoro_run(pool: &sqlx::SqlitePool) {
    sqlx::query(
        "INSERT INTO pomodoro_runs
            (id, event_id, original_event_id, event_date, planned_start, planned_end,
             started_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
             start_trigger)
         VALUES ('run-1', 'event-1', 'event-1', '2026-05-09',
                 '2026-05-09T10:00:00Z', '2026-05-09T11:00:00Z',
                 '2026-05-09T10:00:00Z', 'count', 'preset', 'adaptive',
                 '2026-05-09T10:05:00Z', 'manual')",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_test_active_pomodoro_segment(pool: &sqlx::SqlitePool) {
    sqlx::query(
        "INSERT INTO pomodoro_segments
            (id, event_id, event_date, run_id, rhythm_position, phase,
             planned_start, planned_end, actual_start, status)
         VALUES ('segment-1', 'event-1', '2026-05-09', 'run-1', 1, 'focus',
                 '2026-05-09T10:00:00Z', '2026-05-09T10:40:00Z',
                 '2026-05-09T10:00:00Z', 'active')",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_test_pomodoro_config(pool: &sqlx::SqlitePool, event_id: &str) {
    sqlx::query(
        "INSERT INTO pomodoro_configs
            (event_id, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes)
         VALUES (?, 'count', 'preset', 'adaptive', 3)",
    )
    .bind(event_id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO pomodoro_config_count_rhythms
            (event_id, focus_duration_minutes, short_break_minutes, long_break_minutes,
             long_break_after_focus_count)
         VALUES (?, 40, 5, 10, 4)",
    )
    .bind(event_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_test_completed_pomodoro_history(
    pool: &sqlx::SqlitePool,
    event_id: &str,
    original_event_id: &str,
    event_date: &str,
) {
    let planned_start = format!("{event_date}T10:00:00Z");
    let segment_end = format!("{event_date}T10:40:00Z");
    let planned_end = format!("{event_date}T11:00:00Z");
    sqlx::query(
        "INSERT INTO pomodoro_runs
            (id, event_id, original_event_id, event_date, planned_start, planned_end,
             started_at, ended_at, end_reason, rhythm_kind, rhythm_source, preset_key,
             last_heartbeat,
             start_trigger)
         VALUES ('run-1', ?, ?, ?, ?, ?, ?, ?, 'completed',
                 'count', 'preset', 'adaptive', ?, 'manual')",
    )
    .bind(event_id)
    .bind(original_event_id)
    .bind(event_date)
    .bind(&planned_start)
    .bind(&planned_end)
    .bind(&planned_start)
    .bind(&segment_end)
    .bind(&segment_end)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO pomodoro_segments
            (id, event_id, event_date, run_id, rhythm_position, phase,
             planned_start, planned_end, actual_start, actual_end, status, end_reason)
         VALUES ('segment-1', ?, ?, 'run-1', 1, 'focus',
                 ?, ?, ?, ?, 'completed', 'completed')",
    )
    .bind(event_id)
    .bind(event_date)
    .bind(&planned_start)
    .bind(&segment_end)
    .bind(&planned_start)
    .bind(&segment_end)
    .execute(pool)
    .await
    .unwrap();
}
