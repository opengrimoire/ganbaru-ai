use super::fixtures::*;

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
        canonical_id: "event-1".to_string(),
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
