use super::super::*;
use super::helpers::*;
use ganbaru_db::run_migrations;
use sqlx::Row;

#[test]
fn recovery_rejects_oversized_closures_before_loading_or_mutating_execution() {
    super::block_on(async {
        use super::super::read_budget::{MAX_RECOVERY_BYTES, MAX_RECOVERY_RECORDS};
        for domain in ["open runs", "segments", "pauses", "bytes"] {
            let pool = migrated_pool_with_event().await;
            let mut tx = pool.begin().await.unwrap();
            insert_run_tx(
                &mut tx,
                &run_write(PomodoroRunRhythm::Count {
                    focus_duration_minutes: 40,
                    short_break_minutes: 5,
                    long_break_minutes: 10,
                    long_break_after_focus_count: 4,
                }),
                &initial_segment(),
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();
            match domain {
                "open runs" => {
                    sqlx::query("DROP INDEX idx_pomodoro_runs_single_open")
                        .execute(&pool)
                        .await
                        .unwrap();
                    sqlx::query("WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
                        INSERT INTO pomodoro_runs (id, event_id, original_event_id, event_date, planned_start, planned_end,
                            started_at, rhythm_kind, rhythm_source, last_heartbeat, start_trigger)
                        SELECT 'extra-' || n, event_id, original_event_id, event_date, planned_start, planned_end,
                            started_at, rhythm_kind, rhythm_source, last_heartbeat, start_trigger
                        FROM numbers CROSS JOIN pomodoro_runs WHERE id = 'run-1'")
                        .bind(MAX_RECOVERY_RECORDS).execute(&pool).await.unwrap();
                }
                "segments" => {
                    sqlx::query("WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
                        INSERT INTO pomodoro_segments (id, event_id, event_date, run_id, rhythm_position, phase,
                            planned_start, planned_end, actual_start, actual_end, status)
                        SELECT 'extra-segment-' || n, event_id, event_date, run_id, n + 1, phase,
                            planned_start, planned_end, actual_start, planned_end, 'completed'
                        FROM numbers CROSS JOIN pomodoro_segments WHERE id = 'segment-1'")
                        .bind(MAX_RECOVERY_RECORDS).execute(&pool).await.unwrap();
                }
                "pauses" => {
                    sqlx::query("WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
                        INSERT INTO pomodoro_pauses (id, segment_id, started_at, ended_at, reason)
                        SELECT 'pause-' || n, 'segment-1', '2026-05-29T10:01:00Z', '2026-05-29T10:02:00Z', 'manual' FROM numbers")
                        .bind(MAX_RECOVERY_RECORDS).execute(&pool).await.unwrap();
                }
                "bytes" => {
                    sqlx::query(
                        "UPDATE pomodoro_runs SET event_title_snapshot = ? WHERE id = 'run-1'",
                    )
                    .bind("x".repeat(usize::try_from(MAX_RECOVERY_BYTES).unwrap()))
                    .execute(&pool)
                    .await
                    .unwrap();
                }
                _ => unreachable!("the fixture lists its recovery domains"),
            }
            let before: i64 = sqlx::query_scalar("SELECT total_changes()")
                .fetch_one(&pool)
                .await
                .unwrap();
            let error =
                super::super::recovery::recover_mobile_run_from_pool(&pool, "2026-05-29T10:10:00Z")
                    .await
                    .err()
                    .expect("oversized recovery must be rejected");
            assert!(
                error.contains("Focus recovery") && error.contains("budget"),
                "{domain}: {error}"
            );
            let after: i64 = sqlx::query_scalar("SELECT total_changes()")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(
                before, after,
                "{domain} must fail before any recovery write"
            );
            let state: (Option<String>, String) = sqlx::query_as(
                "SELECT r.ended_at, s.status FROM pomodoro_runs r
                JOIN pomodoro_segments s ON s.run_id = r.id WHERE r.id = 'run-1' AND s.id = 'segment-1'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(state, (None, "active".into()));
        }
    });
}

#[test]
fn recovery_admission_ignores_large_closed_history() {
    super::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(
            &mut tx,
            &run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            }),
            &initial_segment(),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        sqlx::raw_sql("INSERT INTO pomodoro_runs
            (id, event_id, original_event_id, event_date, planned_start, planned_end, started_at, ended_at,
             rhythm_kind, rhythm_source, last_heartbeat, start_trigger)
            SELECT 'closed', event_id, original_event_id, event_date, planned_start, planned_end, started_at,
                planned_end, rhythm_kind, rhythm_source, last_heartbeat, start_trigger FROM pomodoro_runs WHERE id = 'run-1';
            INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, rhythm_position, phase, planned_start, planned_end, actual_start, actual_end, status)
                SELECT 'closed-segment', event_id, event_date, 'closed', rhythm_position, phase,
                    planned_start, planned_end, actual_start, planned_end, 'completed'
                FROM pomodoro_segments WHERE id = 'segment-1';")
            .execute(&pool).await.unwrap();
        sqlx::query("WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
            INSERT INTO pomodoro_pauses (id, segment_id, started_at, ended_at, reason)
            SELECT 'closed-pause-' || n, 'closed-segment', '2026-05-29T10:01:00Z', '2026-05-29T10:02:00Z', 'manual' FROM numbers")
            .bind(super::super::read_budget::MAX_RECOVERY_RECORDS + 1).execute(&pool).await.unwrap();
        let result =
            super::super::recovery::recover_mobile_run_from_pool(&pool, "2026-05-29T10:10:00Z")
                .await
                .unwrap();
        assert!(matches!(result, PomodoroMobileRecoveryRead::Resumed { .. }));
    });
}

#[test]
fn close_run_clamps_end_to_the_latest_open_activity_boundary() {
    super::block_on(async {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql("PRAGMA foreign_keys=ON")
            .execute(&pool)
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();

        sqlx::query(
            "INSERT INTO calendar_events (id, title, start_time, end_time)
                 VALUES ('event-1', 'Focus block', '2026-05-29T10:00:00Z', '2026-05-29T11:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     start_trigger)
                 VALUES ('run-1', 'event-1', 'event-1', '2026-05-29',
                         '2026-05-29T10:00:00Z', '2026-05-29T11:00:00Z',
                         '2026-05-29T10:05:00Z', 'count', 'preset', 'adaptive',
                         '2026-05-29T10:05:00Z', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, rhythm_position, phase,
                     planned_start, planned_end, actual_start, status)
                 VALUES ('segment-1', 'event-1', '2026-05-29', 'run-1', 1, 'focus',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:40:00Z',
                         '2026-05-29T10:05:00Z', 'active')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_pauses (id, segment_id, started_at, reason)
                 VALUES ('pause-1', 'segment-1', '2026-05-29T10:07:00Z', 'idle')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        close_run_tx(
            &mut tx,
            &PomodoroRunClosure {
                run_id: "run-1".to_string(),
                ended_at: "2026-05-29T10:00:00Z".to_string(),
                end_reason: "completed".to_string(),
                segment_status: "interrupted".to_string(),
                segment_end_reason: "event_expired".to_string(),
                event_type: "complete".to_string(),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let row = sqlx::query(
            "SELECT r.ended_at AS run_end, s.actual_end AS segment_end, p.ended_at AS pause_end
                 FROM pomodoro_runs r
                 JOIN pomodoro_segments s ON s.run_id = r.id
                 JOIN pomodoro_pauses p ON p.segment_id = s.id
                 WHERE r.id = 'run-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let run_end: String = row.try_get("run_end").unwrap();
        let segment_end: String = row.try_get("segment_end").unwrap();
        let pause_end: String = row.try_get("pause_end").unwrap();
        assert_eq!(run_end, "2026-05-29T10:07:00Z");
        assert_eq!(segment_end, "2026-05-29T10:07:00Z");
        assert_eq!(pause_end, "2026-05-29T10:07:00Z");
    });
}

#[test]
fn crash_recovery_closes_run_and_segment_at_last_heartbeat() {
    super::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut tx = pool.begin().await.unwrap();
        let run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        insert_run_tx(&mut tx, &run, &initial_segment())
            .await
            .unwrap();
        sqlx::query("UPDATE pomodoro_runs SET last_heartbeat = ? WHERE id = ?")
            .bind("2026-05-29T10:10:00Z")
            .bind("run-1")
            .execute(&mut *tx)
            .await
            .unwrap();
        close_run_tx(
            &mut tx,
            &PomodoroRunClosure {
                run_id: "run-1".to_string(),
                ended_at: "2026-05-29T10:10:00Z".to_string(),
                end_reason: "interrupted".to_string(),
                segment_status: "interrupted".to_string(),
                segment_end_reason: "crash_recovery".to_string(),
                event_type: "crash_recovery".to_string(),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let row = sqlx::query(
            "SELECT r.ended_at AS run_end, s.actual_end AS segment_end,
                    s.status AS segment_status, s.end_reason AS segment_end_reason
             FROM pomodoro_runs r
             JOIN pomodoro_segments s ON s.run_id = r.id
             WHERE r.id = 'run-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.get::<String, _>("run_end"), "2026-05-29T10:10:00Z");
        assert_eq!(row.get::<String, _>("segment_end"), "2026-05-29T10:10:00Z");
        assert_eq!(row.get::<String, _>("segment_status"), "interrupted");
        assert_eq!(row.get::<String, _>("segment_end_reason"), "crash_recovery");
    });
}

#[test]
fn mobile_recovery_resumes_a_valid_running_phase_from_persisted_work_time() {
    super::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(
            &mut tx,
            &run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            }),
            &initial_segment(),
        )
        .await
        .unwrap();
        sqlx::query("UPDATE pomodoro_runs SET last_heartbeat = ? WHERE id = ?")
            .bind("2026-05-29T10:09:30Z")
            .bind("run-1")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let result =
            super::super::recovery::recover_mobile_run_from_pool(&pool, "2026-05-29T10:10:00Z")
                .await
                .unwrap();
        let PomodoroMobileRecoveryRead::Resumed { run } = result else {
            panic!("expected resumable mobile pomodoro run");
        };

        assert_eq!(run.run_id, "run-1");
        assert_eq!(run.block_id, "event-1");
        assert_eq!(run.event_title.as_deref(), Some("Focus block"));
        assert_eq!(run.segment.id, "segment-1");
        assert_eq!(run.phase_elapsed_seconds, 600);
        assert_eq!(run.phase_work_duration_seconds, 2_400);
        assert_eq!(run.remaining_seconds, 1_800);
        assert!(run.is_running);
        assert_eq!(run.open_pause_reason, None);
        assert_eq!(run.completed_focus_count, 0);
        assert!(!run.focus_extension_used);

        let ended_at: Option<String> =
            sqlx::query_scalar("SELECT ended_at FROM pomodoro_runs WHERE id = 'run-1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(ended_at, None);
    });
}

#[test]
fn mobile_recovery_preserves_a_paused_phase_without_counting_time_away() {
    super::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(
            &mut tx,
            &run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            }),
            &initial_segment(),
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_pauses (id, segment_id, started_at, ended_at, reason)
             VALUES ('pause-closed', 'segment-1', '2026-05-29T10:04:00Z',
                     '2026-05-29T10:06:00Z', 'manual'),
                    ('pause-open', 'segment-1', '2026-05-29T10:15:00Z', NULL, 'manual')",
        )
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query("UPDATE pomodoro_runs SET last_heartbeat = ? WHERE id = ?")
            .bind("2026-05-29T10:19:30Z")
            .bind("run-1")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let result =
            super::super::recovery::recover_mobile_run_from_pool(&pool, "2026-05-29T10:20:00Z")
                .await
                .unwrap();
        let PomodoroMobileRecoveryRead::Resumed { run } = result else {
            panic!("expected paused mobile pomodoro run");
        };

        assert!(!run.is_running);
        assert_eq!(run.open_pause_reason.as_deref(), Some("manual"));
        assert_eq!(run.phase_elapsed_seconds, 780);
        assert_eq!(run.remaining_seconds, 1_620);
        assert_eq!(run.segment.pause_log.len(), 2);
        assert_eq!(run.segment.pause_log[1].ended_at, None);
    });
}

#[test]
fn mobile_recovery_excludes_closed_suspend_pauses_from_focus_time() {
    super::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(
            &mut tx,
            &run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            }),
            &initial_segment(),
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_pauses (id, segment_id, started_at, ended_at, reason)
             VALUES ('pause-suspend', 'segment-1', '2026-05-29T10:04:00Z',
                     '2026-05-29T10:08:00Z', 'suspend')",
        )
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query("UPDATE pomodoro_runs SET last_heartbeat = ? WHERE id = ?")
            .bind("2026-05-29T10:09:30Z")
            .bind("run-1")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let result =
            super::super::recovery::recover_mobile_run_from_pool(&pool, "2026-05-29T10:10:00Z")
                .await
                .unwrap();
        let PomodoroMobileRecoveryRead::Resumed { run } = result else {
            panic!("expected resumable mobile pomodoro run");
        };

        assert!(run.is_running);
        assert_eq!(run.phase_elapsed_seconds, 360);
        assert_eq!(run.remaining_seconds, 2_040);
        assert_eq!(run.segment.pause_log.len(), 1);
        assert_eq!(
            run.segment.pause_log[0].ended_at.as_deref(),
            Some("2026-05-29T10:08:00Z")
        );
    });
}

#[test]
fn mobile_recovery_closes_an_expired_phase_at_its_proven_deadline() {
    super::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(
            &mut tx,
            &run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            }),
            &initial_segment(),
        )
        .await
        .unwrap();
        sqlx::query("UPDATE pomodoro_runs SET last_heartbeat = ? WHERE id = ?")
            .bind("2026-05-29T10:39:30Z")
            .bind("run-1")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let result =
            super::super::recovery::recover_mobile_run_from_pool(&pool, "2026-05-29T10:45:00Z")
                .await
                .unwrap();
        let PomodoroMobileRecoveryRead::Closed {
            reason,
            closed_run_ids,
        } = result
        else {
            panic!("expected expired phase closure");
        };
        assert_eq!(reason, "phase_expired");
        assert_eq!(closed_run_ids, ["run-1"]);

        let row = sqlx::query(
            "SELECT r.ended_at, r.end_reason AS run_end_reason,
                    s.actual_end, s.end_reason AS segment_end_reason
             FROM pomodoro_runs r
             JOIN pomodoro_segments s ON s.run_id = r.id
             WHERE r.id = 'run-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.get::<String, _>("ended_at"), "2026-05-29T10:40:00.000Z");
        assert_eq!(row.get::<String, _>("run_end_reason"), "interrupted");
        assert_eq!(
            row.get::<String, _>("actual_end"),
            "2026-05-29T10:40:00.000Z"
        );
        assert_eq!(row.get::<String, _>("segment_end_reason"), "crash_recovery");
    });
}

#[test]
fn mobile_recovery_does_not_start_a_run_from_an_eligible_calendar_event() {
    super::block_on(async {
        let pool = migrated_pool_with_event().await;
        for now in [
            "2026-05-29T10:00:00Z",
            "2026-05-29T10:47:00Z",
            "2026-05-29T11:05:00Z",
        ] {
            let result = super::super::recovery::recover_mobile_run_from_pool(&pool, now)
                .await
                .unwrap();
            assert!(matches!(result, PomodoroMobileRecoveryRead::None));
        }
        for table in ["pomodoro_runs", "pomodoro_segments", "pomodoro_run_events"] {
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 0, "calendar eligibility must not write {table}");
        }
    });
}

#[test]
fn mobile_recovery_never_advances_an_accepted_phase_into_later_focus() {
    super::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(
            &mut tx,
            &run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            }),
            &initial_segment(),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let result =
            super::super::recovery::recover_mobile_run_from_pool(&pool, "2026-05-29T11:05:00Z")
                .await
                .unwrap();
        assert!(matches!(result, PomodoroMobileRecoveryRead::Closed { .. }));
        let rows = sqlx::query("SELECT actual_start, actual_end FROM pomodoro_segments")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].get::<String, _>("actual_end"),
            "2026-05-29T10:40:00.000Z"
        );
        let repeated =
            super::super::recovery::recover_mobile_run_from_pool(&pool, "2026-05-29T11:06:00Z")
                .await
                .unwrap();
        assert!(matches!(repeated, PomodoroMobileRecoveryRead::None));
    });
}

#[test]
fn mobile_recovery_closes_a_paused_run_when_its_event_window_expired() {
    super::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(
            &mut tx,
            &run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            }),
            &initial_segment(),
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_pauses (id, segment_id, started_at, reason)
             VALUES ('pause-open', 'segment-1', '2026-05-29T10:10:00Z', 'manual')",
        )
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query("UPDATE pomodoro_runs SET last_heartbeat = ? WHERE id = ?")
            .bind("2026-05-29T10:59:30Z")
            .bind("run-1")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let result =
            super::super::recovery::recover_mobile_run_from_pool(&pool, "2026-05-29T11:05:00Z")
                .await
                .unwrap();
        let PomodoroMobileRecoveryRead::Closed { reason, .. } = result else {
            panic!("expected expired event closure");
        };
        assert_eq!(reason, "run_window_expired");

        let row = sqlx::query("SELECT ended_at, end_reason FROM pomodoro_runs WHERE id = 'run-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.get::<String, _>("ended_at"), "2026-05-29T11:00:00.000Z");
        assert_eq!(row.get::<String, _>("end_reason"), "completed");
    });
}

#[test]
fn mobile_recovery_closes_all_runs_when_the_single_run_invariant_is_broken() {
    super::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("DROP INDEX idx_pomodoro_runs_single_open")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("DROP INDEX idx_pomodoro_segments_single_active")
            .execute(&mut *tx)
            .await
            .unwrap();
        let run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        insert_run_tx(&mut tx, &run, &initial_segment())
            .await
            .unwrap();
        let mut second_run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        second_run.id = "run-2".to_string();
        let mut second_segment = initial_segment();
        second_segment.id = "segment-2".to_string();
        second_segment.run_id = "run-2".to_string();
        insert_run_tx(&mut tx, &second_run, &second_segment)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let result =
            super::super::recovery::recover_mobile_run_from_pool(&pool, "2026-05-29T10:10:00Z")
                .await
                .unwrap();
        let PomodoroMobileRecoveryRead::Closed {
            reason,
            closed_run_ids,
        } = result
        else {
            panic!("expected multiple run recovery closure");
        };
        assert_eq!(reason, "multiple_open_runs");
        assert_eq!(closed_run_ids, ["run-1", "run-2"]);

        let open_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_runs WHERE ended_at IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(open_count, 0);
    });
}

#[test]
fn mobile_recovery_closes_a_rhythm_snapshot_the_frontend_cannot_restore() {
    super::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(
            &mut tx,
            &run_write(PomodoroRunRhythm::Count {
                focus_duration_minutes: 40,
                short_break_minutes: 5,
                long_break_minutes: 10,
                long_break_after_focus_count: 4,
            }),
            &initial_segment(),
        )
        .await
        .unwrap();
        sqlx::query(
            "UPDATE pomodoro_run_count_rhythms
             SET focus_duration_minutes = 121
             WHERE run_id = 'run-1'",
        )
        .execute(&mut *tx)
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let result =
            super::super::recovery::recover_mobile_run_from_pool(&pool, "2026-05-29T10:10:00Z")
                .await
                .unwrap();
        let PomodoroMobileRecoveryRead::Closed { reason, .. } = result else {
            panic!("expected invalid rhythm closure");
        };
        assert_eq!(reason, "invalid_state");
    });
}
