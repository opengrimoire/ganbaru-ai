use super::helpers::{insert_event, insert_open_run, migrated_memory_pool};

#[test]
fn schema_creates_normalized_calendar_archive_tables() {
    super::block_on(async {
        let pool = migrated_memory_pool().await;
        let archive_tables = [
            "calendar_events_archive",
            "calendar_event_archive_pomodoro_configs",
            "calendar_event_archive_pomodoro_config_count_rhythms",
            "calendar_event_archive_pomodoro_config_sequence_steps",
            "calendar_event_archive_notifications",
            "calendar_event_archive_exdates",
            "calendar_event_archive_rdates",
            "calendar_event_archive_categories",
            "calendar_event_archive_extended_properties",
            "calendar_event_archive_organizers",
            "calendar_event_archive_attendees",
            "calendar_event_archive_alarms",
            "calendar_event_archive_overrides",
            "calendar_event_archive_override_extended_properties",
        ];
        for table in archive_tables {
            let exists: Option<i64> =
                sqlx::query_scalar("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
                    .bind(table)
                    .fetch_optional(&pool)
                    .await
                    .unwrap();
            assert_eq!(exists, Some(1), "{table} should exist");
        }
    });
}

#[test]
fn schema_rejects_invalid_calendar_values() {
    super::block_on(async {
        let pool = migrated_memory_pool().await;

        assert!(
            sqlx::query(
                "INSERT INTO calendars (id, name, source, created_at, updated_at)
             VALUES ('bad-source', 'Bad', 'web', '2026-05-23T00:00:00Z', '2026-05-23T00:00:00Z')",
            )
            .execute(&pool)
            .await
            .is_err()
        );

        assert!(
            sqlx::query(
                "INSERT INTO calendar_events
                (id, title, start_time, end_time, timezone, calendar_id, all_day)
             VALUES ('bad-bool', 'Bad', '2026-05-23T09:00:00Z',
                     '2026-05-23T10:00:00Z', 'UTC', 'local', 2)",
            )
            .execute(&pool)
            .await
            .is_err()
        );

        assert!(
            sqlx::query(
                "INSERT INTO calendar_events
                (id, title, start_time, end_time, timezone, calendar_id, color)
             VALUES ('bad-color', 'Bad', '2026-05-23T09:00:00Z',
                     '2026-05-23T10:00:00Z', 'UTC', 'local', 32)",
            )
            .execute(&pool)
            .await
            .is_err()
        );

        assert!(
            sqlx::query(
                "INSERT INTO calendar_events
                (id, title, start_time, end_time, timezone, calendar_id, priority)
             VALUES ('bad-priority', 'Bad', '2026-05-23T09:00:00Z',
                     '2026-05-23T10:00:00Z', 'UTC', 'local', 10)",
            )
            .execute(&pool)
            .await
            .is_err()
        );

        assert!(
            sqlx::query(
                "INSERT INTO calendar_events
                (id, title, start_time, end_time, timezone, calendar_id, geo_lat)
             VALUES ('bad-geo', 'Bad', '2026-05-23T09:00:00Z',
                     '2026-05-23T10:00:00Z', 'UTC', 'local', 25.0)",
            )
            .execute(&pool)
            .await
            .is_err()
        );

        assert!(
            sqlx::query(
                "INSERT INTO calendar_events
                (id, title, start_time, end_time, timezone, calendar_id)
             VALUES ('bad-fk', 'Bad', '2026-05-23T09:00:00Z',
                     '2026-05-23T10:00:00Z', 'UTC', 'missing')",
            )
            .execute(&pool)
            .await
            .is_err()
        );
    });
}

#[test]
fn deleting_calendar_event_preserves_pomodoro_segments() {
    super::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_event(&pool).await;
        insert_open_run(&pool, "run-1").await.unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, rhythm_position, phase,
                 planned_start, planned_end, actual_start, actual_end, status, end_reason)
             VALUES ('segment-1', 'event-1', '2026-05-23', 'run-1', 1, 'focus',
                     '2026-05-23T09:00:00Z', '2026-05-23T09:40:00Z',
                     '2026-05-23T09:00:00Z', '2026-05-23T09:20:00Z',
                     'interrupted', 'stopped')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("DELETE FROM calendar_events WHERE id = 'event-1'")
            .execute(&pool)
            .await
            .unwrap();

        let segment_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_segments WHERE id = 'segment-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let event_id: Option<String> =
            sqlx::query_scalar("SELECT event_id FROM pomodoro_segments WHERE id = 'segment-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(segment_count, 1);
        assert_eq!(event_id, None);
    });
}
