use super::fixtures::*;

#[test]
fn detached_recurrence_preserves_scoped_music_assignments() {
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
        sqlx::query(
            "INSERT INTO music_playlists (id, name, created_at, updated_at)
             VALUES ('focus-playlist', 'Focus', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let snapshot = crate::music_context::MusicContextAssignmentDraft {
            phase: crate::music_context::MusicActivityPhase::Focus,
            behavior: crate::music_context::MusicAssignmentBehavior::PlayAutomatically,
            playlist_id: Some("focus-playlist".to_string()),
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
        super::super::writes::detach_calendar_instance_tx(
            &mut tx,
            &CalendarDetachInstance {
                parent_id: "series-1".to_string(),
                instance_date: "2099-05-10".to_string(),
                exceptions: "[\"2099-05-10\"]".to_string(),
                new_id: "detached-1".to_string(),
                title: "Detached focus".to_string(),
                start_time: "2099-05-10T10:00:00Z".to_string(),
                end_time: "2099-05-10T11:00:00Z".to_string(),
                timezone: "America/Monterrey".to_string(),
                calendar_id: "local".to_string(),
                project_id: None,
                environment_id: None,
                playlist_id: None,
                color: None,
                notifications: None,
                all_day: false,
                location: String::new(),
                transparency: "opaque".to_string(),
                status: "confirmed".to_string(),
                now: "2026-07-15T10:00:00Z".to_string(),
                music_snapshot_assignments: vec![snapshot],
                music_override_assignments: vec![override_assignment],
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let assignments: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT owner_kind, phase, behavior, playlist_id
             FROM music_context_assignments
             WHERE owner_id = 'detached-1'
             ORDER BY owner_kind, phase",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            assignments,
            vec![
                (
                    "event-override".to_string(),
                    "short-break".to_string(),
                    "pause-music".to_string(),
                    None,
                ),
                (
                    "event-snapshot".to_string(),
                    "focus".to_string(),
                    "play-automatically".to_string(),
                    Some("focus-playlist".to_string()),
                ),
            ]
        );
        let parent_assignment_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM music_context_assignments WHERE owner_id = 'series-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(parent_assignment_count, 0);
    });
}

#[test]
fn hard_delete_rejects_protected_rows() {
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
    });
}

#[test]
fn archive_rejects_active_pomodoro_rows() {
    tauri::async_runtime::block_on(async {
        let pool = in_memory_pool().await;
        insert_test_event(&pool, "event-1", "").await;
        insert_test_open_pomodoro_run(&pool).await;
        insert_test_active_pomodoro_segment(&pool).await;

        let mut tx = pool.begin().await.unwrap();
        let err = archive_calendar_event_tx(
            &mut tx,
            &CalendarEventMutationTarget {
                id: "event-1".to_string(),
            },
        )
        .await
        .unwrap_err();
        tx.rollback().await.unwrap();
        assert!(err.contains("active pomodoro run"));
    });
}

#[test]
fn scoped_archive_preserves_original_event_id() {
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
        archive_calendar_event_tx(
            &mut tx,
            &CalendarEventMutationTarget {
                id: "event-1::2000-05-10".to_string(),
            },
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
