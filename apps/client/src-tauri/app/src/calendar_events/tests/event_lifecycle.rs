use super::fixtures::*;

#[test]
fn calendar_event_create_row_matches_current_schema() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        let mut event = event_create();
        event.environment_id = Some("environment-a".to_string());
        event.playlist_id = Some("playlist-a".to_string());
        let mut tx = pool.begin().await.unwrap();
        insert_calendar_event_row(&mut tx, &event).await.unwrap();
        tx.commit().await.unwrap();

        let saved: (String, Option<String>, Option<String>, i64, Option<String>) = sqlx::query_as(
            "SELECT title, environment_id, playlist_id, meeting_enabled, local_rsvp_status
             FROM calendar_events
             WHERE id = 'event-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(saved.0, "Focus");
        assert_eq!(saved.1, Some("environment-a".to_string()));
        assert_eq!(saved.2, Some("playlist-a".to_string()));
        assert_eq!(saved.3, 0);
        assert_eq!(saved.4, None);
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
                project_id: None,
                environment_id: None,
                playlist_id: None,
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
                music_snapshot_assignments: Vec::new(),
                music_override_assignments: Vec::new(),
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
fn event_music_assignments_share_the_calendar_update_transaction() {
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
        let snapshot = crate::music_context::MusicContextAssignmentDraft {
            phase: crate::music_context::MusicActivityPhase::Focus,
            behavior: crate::music_context::MusicAssignmentBehavior::PlayAutomatically,
            playlist_id: Some("playlist-1".to_string()),
            soundscape_id: None,
            soundscape_behavior: crate::music_context::MusicSoundscapeBehavior::Inherit,
            provenance_kind: crate::music_context::MusicAssignmentProvenanceKind::CopiedProject,
            provenance_id: Some("project-1".to_string()),
        };
        let override_assignment = crate::music_context::MusicContextAssignmentDraft {
            phase: crate::music_context::MusicActivityPhase::ShortBreak,
            behavior: crate::music_context::MusicAssignmentBehavior::PauseMusic,
            playlist_id: None,
            soundscape_id: None,
            soundscape_behavior: crate::music_context::MusicSoundscapeBehavior::Inherit,
            provenance_kind: crate::music_context::MusicAssignmentProvenanceKind::Explicit,
            provenance_id: None,
        };
        let mut tx = pool.begin().await.unwrap();
        update_calendar_event_tx(
            &mut tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:30:00Z".to_string(),
                fields: vec![
                    CalendarEventUpdateField::Title("Soundtracked focus".to_string()),
                    CalendarEventUpdateField::MusicSnapshotAssignments(vec![snapshot.clone()]),
                    CalendarEventUpdateField::MusicOverrideAssignments(vec![override_assignment]),
                ],
                attendees: None,
                alarms: None,
                pomodoro_config: None,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let rows: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT owner_kind, phase, behavior FROM music_context_assignments
             WHERE owner_id = 'event-1' ORDER BY owner_kind, phase",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            rows,
            vec![
                (
                    "event-override".to_string(),
                    "short-break".to_string(),
                    "pause-music".to_string(),
                ),
                (
                    "event-snapshot".to_string(),
                    "focus".to_string(),
                    "play-automatically".to_string(),
                ),
            ]
        );

        let mut invalid_tx = pool.begin().await.unwrap();
        let error = update_calendar_event_tx(
            &mut invalid_tx,
            &CalendarEventUpdate {
                id: "event-1".to_string(),
                updated_at: "2026-05-09T10:31:00Z".to_string(),
                fields: vec![
                    CalendarEventUpdateField::Title("Must roll back".to_string()),
                    CalendarEventUpdateField::MusicSnapshotAssignments(vec![
                        snapshot.clone(),
                        snapshot,
                    ]),
                ],
                attendees: None,
                alarms: None,
                pomodoro_config: None,
            },
        )
        .await
        .unwrap_err();
        invalid_tx.rollback().await.unwrap();
        assert!(error.contains("phase more than once"));
        let title: String =
            sqlx::query_scalar("SELECT title FROM calendar_events WHERE id = 'event-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title, "Soundtracked focus");
    });
}
