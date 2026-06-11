use super::run_migrations;
use sqlx::{Row, SqlitePool};

async fn migrated_memory_pool() -> SqlitePool {
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
    pool
}

async fn insert_event(pool: &SqlitePool) {
    sqlx::query(
        "INSERT INTO calendar_events (id, title, start_time, end_time)
         VALUES ('event-1', 'Focus block', '2026-05-23T09:00:00Z', '2026-05-23T10:00:00Z')",
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_open_run(
    pool: &SqlitePool,
    id: &str,
) -> Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error> {
    sqlx::query(
        "INSERT INTO pomodoro_runs
            (id, event_id, original_event_id, event_date, planned_start, planned_end,
             started_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat, start_trigger)
         VALUES (?, 'event-1', 'event-1', '2026-05-23',
                 '2026-05-23T09:00:00Z', '2026-05-23T10:00:00Z',
                 '2026-05-23T09:00:00Z', 'count', 'preset', 'adaptive',
                 '2026-05-23T09:00:00Z', 'manual')",
    )
    .bind(id)
    .execute(pool)
    .await
}

#[test]
fn schema_does_not_create_json_storage_columns() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;

        let rows = sqlx::query(
            "SELECT m.name AS table_name, p.name AS column_name
             FROM sqlite_schema AS m, pragma_table_info(m.name) AS p
             WHERE m.type = 'table'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        let forbidden = [
            "pause_log",
            "raw_jcal",
            "skip_ranges_json",
            "break_source_json",
            "notifications",
            "exceptions",
            "categories",
            "geo",
            "rdate",
            "extended_properties",
            "organizer",
        ];
        let forbidden_tables = ["pomodoro_sessions"];
        for row in rows {
            let table_name: String = row.try_get("table_name").unwrap();
            let column_name: String = row.try_get("column_name").unwrap();
            assert!(
                !forbidden_tables.contains(&table_name.as_str()),
                "{table_name} should not be created as persisted storage",
            );
            assert!(
                !forbidden.contains(&column_name.as_str()) && !column_name.ends_with("_json"),
                "{table_name}.{column_name} should be normalized, not JSON storage",
            );
        }
    });
}

#[test]
fn schema_creates_normalized_calendar_archive_tables() {
    tauri::async_runtime::block_on(async {
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
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;

        assert!(sqlx::query(
            "INSERT INTO calendars (id, name, source, created_at, updated_at)
             VALUES ('bad-source', 'Bad', 'web', '2026-05-23T00:00:00Z', '2026-05-23T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .is_err());

        assert!(sqlx::query(
            "INSERT INTO calendar_events
                (id, title, start_time, end_time, timezone, calendar_id, all_day)
             VALUES ('bad-bool', 'Bad', '2026-05-23T09:00:00Z',
                     '2026-05-23T10:00:00Z', 'UTC', 'local', 2)",
        )
        .execute(&pool)
        .await
        .is_err());

        assert!(sqlx::query(
            "INSERT INTO calendar_events
                (id, title, start_time, end_time, timezone, calendar_id, color)
             VALUES ('bad-color', 'Bad', '2026-05-23T09:00:00Z',
                     '2026-05-23T10:00:00Z', 'UTC', 'local', 32)",
        )
        .execute(&pool)
        .await
        .is_err());

        assert!(sqlx::query(
            "INSERT INTO calendar_events
                (id, title, start_time, end_time, timezone, calendar_id, priority)
             VALUES ('bad-priority', 'Bad', '2026-05-23T09:00:00Z',
                     '2026-05-23T10:00:00Z', 'UTC', 'local', 10)",
        )
        .execute(&pool)
        .await
        .is_err());

        assert!(sqlx::query(
            "INSERT INTO calendar_events
                (id, title, start_time, end_time, timezone, calendar_id, geo_lat)
             VALUES ('bad-geo', 'Bad', '2026-05-23T09:00:00Z',
                     '2026-05-23T10:00:00Z', 'UTC', 'local', 25.0)",
        )
        .execute(&pool)
        .await
        .is_err());

        assert!(sqlx::query(
            "INSERT INTO calendar_events
                (id, title, start_time, end_time, timezone, calendar_id)
             VALUES ('bad-fk', 'Bad', '2026-05-23T09:00:00Z',
                     '2026-05-23T10:00:00Z', 'UTC', 'missing')",
        )
        .execute(&pool)
        .await
        .is_err());
    });
}

#[test]
fn schema_accepts_current_pomodoro_preset_keys() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_event(&pool).await;

        sqlx::query(
            "INSERT INTO pomodoro_configs
                (event_id, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes)
             VALUES ('event-1', 'count', 'preset', 'adaptive', 3)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "UPDATE pomodoro_configs SET preset_key = 'balanced' WHERE event_id = 'event-1'",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_runs
                (id, event_id, original_event_id, event_date, planned_start, planned_end,
                 started_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat, start_trigger)
             VALUES ('run-balanced', 'event-1', 'event-1', '2026-05-23',
                     '2026-05-23T09:00:00Z', '2026-05-23T10:00:00Z',
                     '2026-05-23T09:00:00Z', 'count', 'preset', 'balanced',
                     '2026-05-23T09:00:00Z', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO calendar_events_archive
                (id, source_event_id, archived_at, title, start_time, end_time,
                 calendar_id, created_at, updated_at)
             VALUES ('archive-1', 'event-1', '2026-05-23T11:00:00Z', 'Focus block',
                     '2026-05-23T09:00:00Z', '2026-05-23T10:00:00Z',
                     'local', '2026-05-23T08:00:00Z', '2026-05-23T08:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO calendar_event_archive_pomodoro_configs
                (archive_event_id, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes)
             VALUES ('archive-1', 'count', 'preset', 'adaptive', 3)",
        )
        .execute(&pool)
        .await
        .unwrap();
    });
}

#[test]
fn schema_keeps_pomodoro_foreign_key_targets() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        let references = [
            ("pomodoro_config_count_rhythms", "pomodoro_configs"),
            ("pomodoro_config_sequence_steps", "pomodoro_configs"),
            ("pomodoro_runs", "pomodoro_runs"),
            ("pomodoro_run_count_rhythms", "pomodoro_runs"),
            ("pomodoro_run_sequence_steps", "pomodoro_runs"),
            ("pomodoro_segments", "pomodoro_runs"),
            ("pomodoro_run_events", "pomodoro_runs"),
            (
                "calendar_event_archive_pomodoro_config_count_rhythms",
                "calendar_event_archive_pomodoro_configs",
            ),
            (
                "calendar_event_archive_pomodoro_config_sequence_steps",
                "calendar_event_archive_pomodoro_configs",
            ),
            ("pomodoro_run_adaptive_snapshots", "pomodoro_runs"),
            ("pomodoro_adaptive_context_snapshots", "pomodoro_runs"),
            ("pomodoro_adaptive_decisions", "pomodoro_runs"),
            ("pomodoro_adaptive_planned_blocks", "pomodoro_runs"),
            ("pomodoro_adaptive_assignments", "pomodoro_runs"),
            ("doomscrolling_block_events", "pomodoro_runs"),
        ];

        for (child_table, target_table) in references {
            let query = format!(
                "SELECT COUNT(*) AS count
                 FROM pragma_foreign_key_list('{child_table}')
                 WHERE \"table\" = '{target_table}'",
            );
            let count: i64 = sqlx::query_scalar(&query).fetch_one(&pool).await.unwrap();
            assert!(count > 0, "{child_table} should reference {target_table}",);
        }
    });
}

#[test]
fn schema_allows_only_one_open_pomodoro_run() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_event(&pool).await;

        insert_open_run(&pool, "run-1").await.unwrap();
        assert!(insert_open_run(&pool, "run-2").await.is_err());

        sqlx::query(
            "UPDATE pomodoro_runs
             SET ended_at = '2026-05-23T09:30:00Z', end_reason = 'stopped'
             WHERE id = 'run-1'",
        )
        .execute(&pool)
        .await
        .unwrap();

        insert_open_run(&pool, "run-2").await.unwrap();
    });
}

#[test]
fn schema_allows_only_one_active_pomodoro_segment() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_event(&pool).await;
        insert_open_run(&pool, "run-1").await.unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, rhythm_position, phase,
                 planned_start, planned_end, actual_start, status)
             VALUES ('segment-1', 'event-1', '2026-05-23', 'run-1', 1, 'focus',
                     '2026-05-23T09:00:00Z', '2026-05-23T09:40:00Z',
                     '2026-05-23T09:00:00Z', 'active')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let second_active = sqlx::query(
            "INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, rhythm_position, phase,
                 planned_start, planned_end, actual_start, status)
             VALUES ('segment-2', 'event-1', '2026-05-23', 'run-1', 1, 'short_break',
                     '2026-05-23T09:40:00Z', '2026-05-23T09:45:00Z',
                     '2026-05-23T09:40:00Z', 'active')",
        )
        .execute(&pool)
        .await;

        assert!(second_active.is_err());
    });
}

#[test]
fn schema_accepts_focus_failed_pomodoro_history() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_event(&pool).await;
        insert_open_run(&pool, "run-1").await.unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, rhythm_position, phase,
                 planned_start, planned_end, actual_start, actual_end, status, end_reason)
             VALUES ('segment-1', 'event-1', '2026-05-23', 'run-1', 1, 'focus',
                     '2026-05-23T09:00:00Z', '2026-05-23T09:40:00Z',
                     '2026-05-23T09:00:00Z', '2026-05-23T09:10:00Z',
                     'interrupted', 'focus_failed')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_run_events
                (id, run_id, segment_id, event_type, occurred_at, phase, reason, duration_seconds)
             VALUES ('event-1', 'run-1', 'segment-1', 'focus_failed',
                     '2026-05-23T09:11:00Z', 'focus', 'long_idle', 60)",
        )
        .execute(&pool)
        .await
        .unwrap();
    });
}

#[test]
fn deleting_calendar_event_preserves_pomodoro_segments() {
    tauri::async_runtime::block_on(async {
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

#[test]
fn schema_allows_only_one_open_pause_per_segment() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_event(&pool).await;
        insert_open_run(&pool, "run-1").await.unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, rhythm_position, phase,
                 planned_start, planned_end, actual_start, status)
             VALUES ('segment-1', 'event-1', '2026-05-23', 'run-1', 1, 'focus',
                     '2026-05-23T09:00:00Z', '2026-05-23T09:40:00Z',
                     '2026-05-23T09:00:00Z', 'active')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_pauses (id, segment_id, started_at, reason)
             VALUES ('pause-1', 'segment-1', '2026-05-23T09:10:00Z', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let second_open_pause = sqlx::query(
            "INSERT INTO pomodoro_pauses (id, segment_id, started_at, reason)
             VALUES ('pause-2', 'segment-1', '2026-05-23T09:15:00Z', 'idle')",
        )
        .execute(&pool)
        .await;

        assert!(second_open_pause.is_err());
    });
}

#[test]
fn schema_creates_doomscrolling_usage_samples() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;

        sqlx::query(
            "INSERT INTO doomscrolling_usage_samples
                (id, source_type, source_key, display_name, started_at, elapsed_seconds, local_date, created_at)
             VALUES ('sample-1', 'website', 'youtube.com', 'youtube.com', 1779923600000, 30, '2026-05-28', 1779923630000)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let invalid = sqlx::query(
            "INSERT INTO doomscrolling_usage_samples
                (id, source_type, source_key, started_at, elapsed_seconds, local_date, created_at)
             VALUES ('sample-2', 'website', 'youtube.com', 1779923600000, 0, '2026-05-28', 1779923630000)",
        )
        .execute(&pool)
        .await;

        assert!(invalid.is_err());
    });
}

#[test]
fn schema_creates_pomodoro_adaptive_tables() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        let adaptive_tables = [
            "pomodoro_adaptive_policies",
            "pomodoro_adaptive_policy_bounds",
            "pomodoro_adaptive_context_states",
            "pomodoro_adaptive_context_state_history",
            "pomodoro_adaptive_context_snapshots",
            "pomodoro_adaptive_context_snapshot_features",
            "pomodoro_adaptive_data_quality_flags",
            "pomodoro_adaptive_decisions",
            "pomodoro_adaptive_decision_values",
            "pomodoro_adaptive_decision_reasons",
            "pomodoro_adaptive_decision_state_scores",
            "pomodoro_run_adaptive_snapshots",
            "pomodoro_adaptive_planned_blocks",
            "pomodoro_adaptive_experiments",
            "pomodoro_adaptive_experiment_variants",
            "pomodoro_adaptive_assignments",
            "pomodoro_adaptive_outcomes",
            "doomscrolling_block_events",
            "doomscrolling_block_event_rule_snapshots",
        ];

        for table in adaptive_tables {
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
fn schema_enforces_adaptive_policy_and_decision_integrity() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_event(&pool).await;
        insert_open_run(&pool, "run-1").await.unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_policies
                (id, status, policy_version, model_version)
             VALUES ('policy-1', 'active', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let second_active_policy = sqlx::query(
            "INSERT INTO pomodoro_adaptive_policies
                (id, status, policy_version, model_version)
             VALUES ('policy-2', 'active', 1, 1)",
        )
        .execute(&pool)
        .await;
        assert!(second_active_policy.is_err());

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_policy_bounds
                (policy_id, parameter_key, min_value, max_value)
             VALUES ('policy-1', 'focus_duration_minutes', 15, 60)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let invalid_bounds = sqlx::query(
            "INSERT INTO pomodoro_adaptive_policy_bounds
                (policy_id, parameter_key, min_value, max_value)
             VALUES ('policy-1', 'short_break_minutes', 12, 3)",
        )
        .execute(&pool)
        .await;
        assert!(invalid_bounds.is_err());

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_context_snapshots
                (id, run_id, local_started_at, time_of_day, session_position,
                 event_length, workload, energy)
             VALUES ('snapshot-1', 'run-1', '2026-05-23T09:00:00Z',
                     'morning', 'first', 'medium', 'low', 'unknown')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_context_snapshot_features
                (snapshot_id, feature_key, numeric_value, source_kind)
             VALUES ('snapshot-1', 'clean_focus_seconds', 2400, 'pomodoro')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_data_quality_flags (snapshot_id, flag)
             VALUES ('snapshot-1', 'diary_missing')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_decisions
                (id, policy_id, run_id, context_snapshot_id, opportunity_kind,
                 decision_mode, policy_version, model_version, occurred_at)
             VALUES ('decision-1', 'policy-1', 'run-1', 'snapshot-1',
                     'run_start', 'fallback', 1, 1, '2026-05-23T09:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_decision_values
                (decision_id, value_key, previous_numeric_value, selected_numeric_value, value_unit)
             VALUES ('decision-1', 'focus_duration_minutes', 40, 40, 'minutes')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let invalid_bundle_value = sqlx::query(
            "INSERT INTO pomodoro_adaptive_decision_values
                (decision_id, value_key, previous_numeric_value, selected_numeric_value, value_unit)
             VALUES ('decision-1', 'rhythm_bundle', 0, 1, 'count')",
        )
        .execute(&pool)
        .await;
        assert!(invalid_bundle_value.is_err());

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_decision_reasons (decision_id, reason_code)
             VALUES ('decision-1', 'no_history')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let invalid_reason = sqlx::query(
            "INSERT INTO pomodoro_adaptive_decision_reasons (decision_id, reason_code)
             VALUES ('decision-1', 'raw_anxiety_label')",
        )
        .execute(&pool)
        .await;
        assert!(invalid_reason.is_err());

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_decision_state_scores
                (decision_id, readiness, strain, recovery_debt,
                 avoidance_pressure, momentum, confidence)
             VALUES ('decision-1', 0.2, 0.1, 0.1, 0.0, 0.2, 0.1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let invalid_score = sqlx::query(
            "INSERT INTO pomodoro_adaptive_decision_state_scores
                (decision_id, readiness, strain, recovery_debt,
                 avoidance_pressure, momentum, confidence)
             VALUES ('decision-bad', 1.2, 0.1, 0.1, 0.0, 0.2, 0.1)",
        )
        .execute(&pool)
        .await;
        assert!(invalid_score.is_err());

        sqlx::query(
            "INSERT INTO pomodoro_run_adaptive_snapshots
                (run_id, policy_id, policy_version, model_version,
                 context_snapshot_id, decision_id)
             VALUES ('run-1', 'policy-1', 1, 1, 'snapshot-1', 'decision-1')",
        )
        .execute(&pool)
        .await
        .unwrap();
    });
}

#[test]
fn schema_records_adaptive_experiments_and_outcomes() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_event(&pool).await;
        insert_open_run(&pool, "run-1").await.unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_policies
                (id, status, policy_version, model_version)
             VALUES ('policy-1', 'active', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_context_snapshots
                (id, run_id, local_started_at, time_of_day, session_position,
                 event_length, workload, energy)
             VALUES ('snapshot-1', 'run-1', '2026-05-23T09:00:00Z',
                     'morning', 'first', 'medium', 'low', 'unknown')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_experiments
                (id, policy_id, parameter_key, assignment_unit, status, started_at)
             VALUES ('experiment-1', 'policy-1', 'focus_duration_minutes',
                     'run', 'active', '2026-05-23T09:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_experiments
                (id, policy_id, parameter_key, assignment_unit, status, started_at)
             VALUES ('experiment-bundle', 'policy-1', 'rhythm_bundle',
                     'run', 'active', '2026-05-23T09:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let invalid_bundle_bound = sqlx::query(
            "INSERT INTO pomodoro_adaptive_policy_bounds
                (policy_id, parameter_key, min_value, max_value)
             VALUES ('policy-1', 'rhythm_bundle', 0, 1)",
        )
        .execute(&pool)
        .await;
        assert!(invalid_bundle_bound.is_err());

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_experiment_variants
                (experiment_id, variant_key, numeric_value, is_control)
             VALUES ('experiment-1', 'control', 40, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_experiment_variants
                (experiment_id, variant_key, numeric_value, is_control)
             VALUES ('experiment-1', 'shorter', 35, 0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let second_control = sqlx::query(
            "INSERT INTO pomodoro_adaptive_experiment_variants
                (experiment_id, variant_key, numeric_value, is_control)
             VALUES ('experiment-1', 'other-control', 45, 1)",
        )
        .execute(&pool)
        .await;
        assert!(second_control.is_err());

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_assignments
                (id, experiment_id, variant_key, run_id,
                 context_snapshot_id, assignment_seed, assigned_at)
             VALUES ('assignment-1', 'experiment-1', 'shorter', 'run-1',
                     'snapshot-1', 'seed-1', '2026-05-23T09:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let invalid_assignment = sqlx::query(
            "INSERT INTO pomodoro_adaptive_assignments
                (id, experiment_id, variant_key, assignment_seed, assigned_at)
             VALUES ('assignment-bad', 'experiment-1', 'missing',
                     'seed-2', '2026-05-23T09:00:00Z')",
        )
        .execute(&pool)
        .await;
        assert!(invalid_assignment.is_err());

        sqlx::query(
            "INSERT INTO pomodoro_adaptive_outcomes
                (id, assignment_id, outcome_window, outcome_key,
                 boolean_value, measured_at)
             VALUES ('outcome-1', 'assignment-1', 'run',
                     'clean_focus_completed', 1, '2026-05-23T10:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
    });
}

#[test]
fn schema_records_redacted_doomscrolling_block_events() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_event(&pool).await;
        insert_open_run(&pool, "run-1").await.unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_segments
                (id, event_id, event_date, run_id, rhythm_position, phase,
                 planned_start, planned_end, actual_start, status)
             VALUES ('segment-1', 'event-1', '2026-05-23', 'run-1', 1, 'focus',
                     '2026-05-23T09:00:00Z', '2026-05-23T09:40:00Z',
                     '2026-05-23T09:00:00Z', 'active')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO doomscrolling_block_events
                (id, run_id, segment_id, occurred_at, source_type,
                 source_key, display_name, phase, decision, rule_id, category_id)
             VALUES ('block-1', 'run-1', 'segment-1', '2026-05-23T09:10:00Z',
                     'browser', 'reddit.com', 'reddit.com', 'focus',
                     'blocked', 'rule-1', 'social')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO doomscrolling_block_event_rule_snapshots
                (block_event_id, rule_id, rule_kind, rule_label,
                 environment_id, blocker_mode)
             VALUES ('block-1', 'rule-1', 'category', 'Social',
                     'env-1', 'blacklist')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let full_url = sqlx::query(
            "INSERT INTO doomscrolling_block_events
                (id, occurred_at, source_type, source_key, phase, decision)
             VALUES ('block-bad', '2026-05-23T09:11:00Z',
                     'browser', 'https://reddit.com/r/all', 'focus', 'blocked')",
        )
        .execute(&pool)
        .await;
        assert!(full_url.is_err());
    });
}
