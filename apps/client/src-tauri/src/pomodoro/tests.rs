use crate::db::run_migrations;

use super::{
    canonical_event_id, close_run_tx, insert_adaptive_decision_envelope_tx, insert_run_event_tx,
    insert_run_tx, insert_segment_tx, load_adaptive_history_from_pool,
    load_adaptive_replay_dataset_from_pool, normalize_segment_update,
    record_matured_adaptive_day_outcomes_tx, record_matured_adaptive_next_day_outcomes_tx,
    validate_adaptive_decision_envelope_for_segment, validate_event_type, validate_pause_reason,
    validate_phase, validate_run_end_reason, validate_run_window_update,
    validate_segment_end_reason, validate_status, PomodoroAdaptiveAssignmentWrite,
    PomodoroAdaptiveContextSnapshotWrite, PomodoroAdaptiveDecisionEnvelopeWrite,
    PomodoroAdaptiveDecisionValueWrite, PomodoroAdaptiveDecisionWrite,
    PomodoroAdaptiveExperimentAssignmentWrite, PomodoroAdaptiveExperimentVariantWrite,
    PomodoroAdaptiveExperimentWrite, PomodoroAdaptiveFeatureWrite,
    PomodoroAdaptivePlannedBlockWrite, PomodoroAdaptiveStateScoresWrite, PomodoroPauseWrite,
    PomodoroRunAdaptiveSnapshotWrite, PomodoroRunClosure, PomodoroRunRhythm,
    PomodoroRunSequenceStep, PomodoroRunWindowUpdate, PomodoroRunWrite, PomodoroSegmentUpdate,
    PomodoroSegmentWrite, RunEventInsert,
};
use sqlx::Row;

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

async fn migrated_pool_with_event() -> sqlx::SqlitePool {
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
    pool
}

fn run_write(rhythm: PomodoroRunRhythm) -> PomodoroRunWrite {
    PomodoroRunWrite {
        id: "run-1".to_string(),
        event_id: "event-1".to_string(),
        event_date: "2026-05-29".to_string(),
        planned_start: "2026-05-29T10:00:00Z".to_string(),
        planned_end: "2026-05-29T11:00:00Z".to_string(),
        started_at: "2026-05-29T10:00:00Z".to_string(),
        rhythm,
        rhythm_source: "custom".to_string(),
        preset_key: None,
        idle_timeout_minutes: Some(3),
        event_title_snapshot: Some("Focus block".to_string()),
        inherited_focus_minutes: 0,
        inherited_rhythm_position: 1,
        inherited_from_run_id: None,
        start_trigger: "manual".to_string(),
        adaptive_snapshot: None,
    }
}

fn initial_segment() -> PomodoroSegmentWrite {
    PomodoroSegmentWrite {
        id: "segment-1".to_string(),
        event_id: "event-1".to_string(),
        event_date: "2026-05-29".to_string(),
        run_id: "run-1".to_string(),
        rhythm_position: 1,
        phase: "focus".to_string(),
        planned_start: "2026-05-29T10:00:00Z".to_string(),
        planned_end: "2026-05-29T10:40:00Z".to_string(),
        actual_start: Some("2026-05-29T10:00:00Z".to_string()),
        actual_end: None,
        pauses: Vec::new(),
        status: "active".to_string(),
        end_reason: None,
    }
}

fn adaptive_snapshot() -> PomodoroRunAdaptiveSnapshotWrite {
    PomodoroRunAdaptiveSnapshotWrite {
        policy_id: "local-adaptive-policy-v1".to_string(),
        policy_version: 1,
        model_version: 1,
        context_snapshot: PomodoroAdaptiveContextSnapshotWrite {
            id: "context-1".to_string(),
            run_id: "run-1".to_string(),
            segment_id: Some("segment-1".to_string()),
            local_started_at: "2026-05-29T10:00:00Z".to_string(),
            time_of_day: "morning".to_string(),
            session_position: "first".to_string(),
            event_length: "medium".to_string(),
            workload: "low".to_string(),
            energy: "unknown".to_string(),
            environment_id: None,
            features: vec![PomodoroAdaptiveFeatureWrite {
                feature_key: "comparable_opportunity_count".to_string(),
                numeric_value: Some(0.0),
                categorical_value: None,
                boolean_value: None,
                missing: false,
                source_kind: "pomodoro".to_string(),
            }],
            data_quality_flags: vec!["diary_missing".to_string()],
        },
        decision: PomodoroAdaptiveDecisionWrite {
            id: "decision-1".to_string(),
            policy_id: "local-adaptive-policy-v1".to_string(),
            run_id: "run-1".to_string(),
            segment_id: Some("segment-1".to_string()),
            context_snapshot_id: "context-1".to_string(),
            opportunity_kind: "run_start".to_string(),
            candidate_id: None,
            decision_mode: "fallback".to_string(),
            policy_version: 1,
            model_version: 1,
            occurred_at: "2026-05-29T10:00:00Z".to_string(),
            values: vec![
                adaptive_value("focus_duration_minutes", 40.0, "minutes"),
                adaptive_value("short_break_minutes", 5.0, "minutes"),
                adaptive_value("long_break_minutes", 10.0, "minutes"),
                adaptive_value("long_break_after_focus_count", 4.0, "count"),
            ],
            reason_codes: vec!["no_history".to_string(), "missing_diary_data".to_string()],
            state_scores: PomodoroAdaptiveStateScoresWrite {
                readiness: 0.0,
                strain: 0.0,
                recovery_debt: 0.0,
                avoidance_pressure: 0.0,
                momentum: 0.0,
                confidence: 0.0,
            },
        },
        planned_blocks: Vec::new(),
        experiment_updates: Vec::new(),
        experiment_assignments: Vec::new(),
    }
}

fn adaptive_boundary_envelope(
    segment: &PomodoroSegmentWrite,
) -> PomodoroAdaptiveDecisionEnvelopeWrite {
    PomodoroAdaptiveDecisionEnvelopeWrite {
        policy_id: "local-adaptive-policy-v1".to_string(),
        policy_version: 1,
        model_version: 1,
        context_snapshot: PomodoroAdaptiveContextSnapshotWrite {
            id: "context-boundary-1".to_string(),
            run_id: segment.run_id.clone(),
            segment_id: Some(segment.id.clone()),
            local_started_at: "2026-05-29T10:40:00Z".to_string(),
            time_of_day: "morning".to_string(),
            session_position: "first".to_string(),
            event_length: "medium".to_string(),
            workload: "low".to_string(),
            energy: "unknown".to_string(),
            environment_id: None,
            features: vec![PomodoroAdaptiveFeatureWrite {
                feature_key: "comparable_opportunity_count".to_string(),
                numeric_value: Some(4.0),
                categorical_value: None,
                boolean_value: None,
                missing: false,
                source_kind: "pomodoro".to_string(),
            }],
            data_quality_flags: vec!["diary_missing".to_string()],
        },
        decision: PomodoroAdaptiveDecisionWrite {
            id: "decision-boundary-1".to_string(),
            policy_id: "local-adaptive-policy-v1".to_string(),
            run_id: segment.run_id.clone(),
            segment_id: Some(segment.id.clone()),
            context_snapshot_id: "context-boundary-1".to_string(),
            opportunity_kind: "break_start".to_string(),
            candidate_id: None,
            decision_mode: "hold".to_string(),
            policy_version: 1,
            model_version: 1,
            occurred_at: "2026-05-29T10:40:00Z".to_string(),
            values: vec![
                adaptive_value("focus_duration_minutes", 40.0, "minutes"),
                adaptive_value("short_break_minutes", 5.0, "minutes"),
                adaptive_value("long_break_minutes", 10.0, "minutes"),
                adaptive_value("long_break_after_focus_count", 4.0, "count"),
            ],
            reason_codes: vec!["hold_current_rhythm".to_string()],
            state_scores: PomodoroAdaptiveStateScoresWrite {
                readiness: 0.5,
                strain: 0.1,
                recovery_debt: 0.1,
                avoidance_pressure: 0.1,
                momentum: 0.6,
                confidence: 0.5,
            },
        },
        experiment_updates: Vec::new(),
        experiment_assignments: Vec::new(),
    }
}

fn adaptive_snapshot_with_assignment() -> PomodoroRunAdaptiveSnapshotWrite {
    let mut snapshot = adaptive_snapshot();
    snapshot.decision.decision_mode = "explore".to_string();
    snapshot
        .decision
        .reason_codes
        .push("experiment_assignment".to_string());
    snapshot.decision.values[0].selected_numeric_value = 45.0;
    snapshot.experiment_assignments = vec![PomodoroAdaptiveExperimentAssignmentWrite {
        experiment: adaptive_experiment("active"),
        assignment: PomodoroAdaptiveAssignmentWrite {
            id: "assignment-1".to_string(),
            experiment_id: "run-focus-duration-40-vs-45-v1".to_string(),
            variant_key: "focus_45".to_string(),
            run_id: "run-1".to_string(),
            segment_id: Some("segment-1".to_string()),
            context_snapshot_id: "context-1".to_string(),
            assignment_seed: "seed-1".to_string(),
            assigned_at: "2026-05-29T10:00:00Z".to_string(),
        },
    }];
    snapshot
}

fn adaptive_experiment(status: &str) -> PomodoroAdaptiveExperimentWrite {
    PomodoroAdaptiveExperimentWrite {
        id: "run-focus-duration-40-vs-45-v1".to_string(),
        policy_id: "local-adaptive-policy-v1".to_string(),
        parameter_key: "focus_duration_minutes".to_string(),
        assignment_unit: "run".to_string(),
        status: status.to_string(),
        started_at: Some("2026-05-29T10:00:00Z".to_string()),
        ended_at: if status == "completed" || status == "abandoned" {
            Some("2026-05-29T10:00:00Z".to_string())
        } else {
            None
        },
        variants: vec![
            PomodoroAdaptiveExperimentVariantWrite {
                variant_key: "control_40".to_string(),
                numeric_value: 40.0,
                is_control: true,
            },
            PomodoroAdaptiveExperimentVariantWrite {
                variant_key: "focus_45".to_string(),
                numeric_value: 45.0,
                is_control: false,
            },
        ],
    }
}

fn adaptive_bundle_experiment(status: &str) -> PomodoroAdaptiveExperimentWrite {
    PomodoroAdaptiveExperimentWrite {
        id: "run-focus-short-break-support-40-5-vs-45-7-v1".to_string(),
        policy_id: "local-adaptive-policy-v1".to_string(),
        parameter_key: "rhythm_bundle".to_string(),
        assignment_unit: "run".to_string(),
        status: status.to_string(),
        started_at: Some("2026-05-29T10:00:00Z".to_string()),
        ended_at: if status == "completed" || status == "abandoned" {
            Some("2026-05-29T10:00:00Z".to_string())
        } else {
            None
        },
        variants: vec![
            PomodoroAdaptiveExperimentVariantWrite {
                variant_key: "control_40_5".to_string(),
                numeric_value: 0.0,
                is_control: true,
            },
            PomodoroAdaptiveExperimentVariantWrite {
                variant_key: "focus_45_short_break_7".to_string(),
                numeric_value: 1.0,
                is_control: false,
            },
        ],
    }
}

fn adaptive_value(
    value_key: &str,
    selected_numeric_value: f64,
    value_unit: &str,
) -> PomodoroAdaptiveDecisionValueWrite {
    PomodoroAdaptiveDecisionValueWrite {
        value_key: value_key.to_string(),
        previous_numeric_value: Some(selected_numeric_value),
        selected_numeric_value,
        value_unit: value_unit.to_string(),
    }
}

fn adaptive_planned_block() -> PomodoroAdaptivePlannedBlockWrite {
    PomodoroAdaptivePlannedBlockWrite {
        event_date: "2026-05-29".to_string(),
        event_id: Some("event-1::2026-05-29".to_string()),
        original_event_id: "event-1".to_string(),
        planned_start: "2026-05-29T10:00:00Z".to_string(),
        planned_end: "2026-05-29T11:00:00Z".to_string(),
        source_kind: "scheduler_snapshot".to_string(),
    }
}

#[test]
fn insert_run_snapshots_count_rhythm() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        tx.commit().await.unwrap();

        let saved: (String, i64, i64) = sqlx::query_as(
            "SELECT r.rhythm_kind, c.focus_duration_minutes, c.long_break_after_focus_count
                 FROM pomodoro_runs r
                 JOIN pomodoro_run_count_rhythms c ON c.run_id = r.id
                 WHERE r.id = 'run-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(saved, ("count".to_string(), 40, 4));
    });
}

#[test]
fn insert_run_records_adaptive_experiment_assignment() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 45,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        run.rhythm_source = "preset".to_string();
        run.preset_key = Some("adaptive".to_string());
        run.adaptive_snapshot = Some(adaptive_snapshot_with_assignment());
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        tx.commit().await.unwrap();

        let assignment: (String, String, String) = sqlx::query_as(
            "SELECT experiment_id, variant_key, assignment_seed
                 FROM pomodoro_adaptive_assignments
                 WHERE id = 'assignment-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            assignment,
            (
                "run-focus-duration-40-vs-45-v1".to_string(),
                "focus_45".to_string(),
                "seed-1".to_string()
            )
        );

        let variant_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)
                 FROM pomodoro_adaptive_experiment_variants
                 WHERE experiment_id = 'run-focus-duration-40-vs-45-v1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(variant_count, 2);

        let selected_focus: f64 = sqlx::query_scalar(
            "SELECT selected_numeric_value
                 FROM pomodoro_adaptive_decision_values
                 WHERE decision_id = 'decision-1'
                   AND value_key = 'focus_duration_minutes'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(selected_focus, 45.0);
    });
}

#[test]
fn insert_run_records_adaptive_bundle_experiment_assignment() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 45,
            short_break_minutes: 7,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        run.rhythm_source = "preset".to_string();
        run.preset_key = Some("adaptive".to_string());
        let mut snapshot = adaptive_snapshot();
        snapshot.decision.decision_mode = "explore".to_string();
        snapshot
            .decision
            .reason_codes
            .push("experiment_assignment".to_string());
        snapshot.decision.values[0].selected_numeric_value = 45.0;
        snapshot.decision.values[1].selected_numeric_value = 7.0;
        snapshot.experiment_assignments = vec![PomodoroAdaptiveExperimentAssignmentWrite {
            experiment: adaptive_bundle_experiment("active"),
            assignment: PomodoroAdaptiveAssignmentWrite {
                id: "assignment-bundle".to_string(),
                experiment_id: "run-focus-short-break-support-40-5-vs-45-7-v1".to_string(),
                variant_key: "focus_45_short_break_7".to_string(),
                run_id: "run-1".to_string(),
                segment_id: Some("segment-1".to_string()),
                context_snapshot_id: "context-1".to_string(),
                assignment_seed: "seed-bundle".to_string(),
                assigned_at: "2026-05-29T10:00:00Z".to_string(),
            },
        }];
        run.adaptive_snapshot = Some(snapshot);
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        tx.commit().await.unwrap();

        let experiment: (String, String) = sqlx::query_as(
            "SELECT parameter_key, status
                 FROM pomodoro_adaptive_experiments
                 WHERE id = 'run-focus-short-break-support-40-5-vs-45-7-v1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            experiment,
            ("rhythm_bundle".to_string(), "active".to_string())
        );

        let assignment_variant: String = sqlx::query_scalar(
            "SELECT variant_key
                 FROM pomodoro_adaptive_assignments
                 WHERE id = 'assignment-bundle'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(assignment_variant, "focus_45_short_break_7");

        let selected_short_break: f64 = sqlx::query_scalar(
            "SELECT selected_numeric_value
                 FROM pomodoro_adaptive_decision_values
                 WHERE decision_id = 'decision-1'
                   AND value_key = 'short_break_minutes'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(selected_short_break, 7.0);
    });
}

#[test]
fn insert_run_records_adaptive_experiment_status_update_without_assignment() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 45,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        run.rhythm_source = "preset".to_string();
        run.preset_key = Some("adaptive".to_string());
        let mut snapshot = adaptive_snapshot();
        snapshot.experiment_updates = vec![adaptive_experiment("completed")];
        run.adaptive_snapshot = Some(snapshot);
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        tx.commit().await.unwrap();

        let lifecycle: (String, String) = sqlx::query_as(
            "SELECT status, ended_at
                 FROM pomodoro_adaptive_experiments
                 WHERE id = 'run-focus-duration-40-vs-45-v1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let assignment_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)
                 FROM pomodoro_adaptive_assignments
                 WHERE experiment_id = 'run-focus-duration-40-vs-45-v1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(
            lifecycle,
            ("completed".to_string(), "2026-05-29T10:00:00Z".to_string())
        );
        assert_eq!(assignment_count, 0);
    });
}

#[test]
fn insert_run_snapshots_sequence_rhythm() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let run = run_write(PomodoroRunRhythm::Sequence {
            steps: vec![
                PomodoroRunSequenceStep {
                    focus_duration_minutes: 25,
                    break_phase: "short_break".to_string(),
                    break_duration_minutes: 5,
                },
                PomodoroRunSequenceStep {
                    focus_duration_minutes: 35,
                    break_phase: "long_break".to_string(),
                    break_duration_minutes: 12,
                },
            ],
        });
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        tx.commit().await.unwrap();

        let steps: Vec<(i64, i64, String, i64)> = sqlx::query_as(
            "SELECT step_index, focus_duration_minutes, break_phase, break_duration_minutes
                 FROM pomodoro_run_sequence_steps
                 WHERE run_id = 'run-1'
                 ORDER BY step_index",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            steps,
            vec![
                (0, 25, "short_break".to_string(), 5),
                (1, 35, "long_break".to_string(), 12),
            ],
        );
    });
}

#[test]
fn insert_run_snapshots_adaptive_decision() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        run.rhythm_source = "preset".to_string();
        run.preset_key = Some("adaptive".to_string());
        run.adaptive_snapshot = Some(adaptive_snapshot());
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        tx.commit().await.unwrap();

        let row = sqlx::query(
            "SELECT rs.policy_version, cs.time_of_day, d.decision_mode,
                        v.selected_numeric_value, ss.confidence
                 FROM pomodoro_run_adaptive_snapshots rs
                 JOIN pomodoro_adaptive_context_snapshots cs ON cs.id = rs.context_snapshot_id
                 JOIN pomodoro_adaptive_decisions d ON d.id = rs.decision_id
                 JOIN pomodoro_adaptive_decision_values v ON v.decision_id = d.id
                 JOIN pomodoro_adaptive_decision_state_scores ss ON ss.decision_id = d.id
                 WHERE rs.run_id = 'run-1' AND v.value_key = 'focus_duration_minutes'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let policy_version: i64 = row.try_get("policy_version").unwrap();
        let time_of_day: String = row.try_get("time_of_day").unwrap();
        let decision_mode: String = row.try_get("decision_mode").unwrap();
        let selected_focus: f64 = row.try_get("selected_numeric_value").unwrap();
        let confidence: f64 = row.try_get("confidence").unwrap();
        assert_eq!(policy_version, 1);
        assert_eq!(time_of_day, "morning");
        assert_eq!(decision_mode, "fallback");
        assert_eq!(selected_focus, 40.0);
        assert_eq!(confidence, 0.0);

        let counts: (i64, i64, i64, i64) = sqlx::query_as(
            "SELECT
                    (SELECT COUNT(*) FROM pomodoro_adaptive_policy_bounds),
                    (SELECT COUNT(*) FROM pomodoro_adaptive_context_snapshot_features),
                    (SELECT COUNT(*) FROM pomodoro_adaptive_data_quality_flags),
                    (SELECT COUNT(*) FROM pomodoro_adaptive_decision_reasons)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(counts, (4, 1, 1, 2));
    });
}

#[test]
fn insert_run_snapshots_records_adaptive_candidate_id() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        run.rhythm_source = "preset".to_string();
        run.preset_key = Some("adaptive".to_string());
        let mut snapshot = adaptive_snapshot();
        snapshot.decision.candidate_id = Some("focus-growth-with-short-break-support".to_string());
        snapshot.decision.decision_mode = "explore".to_string();
        snapshot.decision.reason_codes = vec!["replay_candidate".to_string()];
        snapshot.decision.values[0].selected_numeric_value = 45.0;
        run.adaptive_snapshot = Some(snapshot);
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        tx.commit().await.unwrap();

        let row = sqlx::query(
            "SELECT candidate_id, decision_mode
                 FROM pomodoro_adaptive_decisions
                 WHERE id = 'decision-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            row.try_get::<String, _>("candidate_id").unwrap(),
            "focus-growth-with-short-break-support"
        );
        assert_eq!(
            row.try_get::<String, _>("decision_mode").unwrap(),
            "explore"
        );

        let reason_count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*)
                 FROM pomodoro_adaptive_decision_reasons
                 WHERE decision_id = 'decision-1' AND reason_code = 'replay_candidate'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reason_count.0, 1);
    });
}

#[test]
fn insert_segment_with_adaptive_decision_records_boundary_decision() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut tx = pool.begin().await.unwrap();
        let run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        let initial_segment = initial_segment();
        insert_run_tx(&mut tx, &run, &initial_segment)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let break_segment = PomodoroSegmentWrite {
            id: "segment-2".to_string(),
            event_id: "event-1".to_string(),
            event_date: "2026-05-29".to_string(),
            run_id: "run-1".to_string(),
            rhythm_position: 1,
            phase: "short_break".to_string(),
            planned_start: "2026-05-29T10:40:00Z".to_string(),
            planned_end: "2026-05-29T10:45:00Z".to_string(),
            actual_start: Some("2026-05-29T10:40:00Z".to_string()),
            actual_end: None,
            pauses: Vec::new(),
            status: "active".to_string(),
            end_reason: None,
        };
        let envelope = adaptive_boundary_envelope(&break_segment);
        let mut tx = pool.begin().await.unwrap();
        validate_adaptive_decision_envelope_for_segment(&envelope, &break_segment).unwrap();
        insert_segment_tx(&mut tx, &break_segment).await.unwrap();
        insert_adaptive_decision_envelope_tx(&mut tx, &envelope)
            .await
            .unwrap();
        insert_run_event_tx(
            &mut tx,
            RunEventInsert {
                run_id: "run-1",
                segment_id: Some("segment-2"),
                event_type: "phase_start",
                occurred_at: "2026-05-29T10:40:00Z",
                phase: Some("short_break"),
                reason: None,
                duration_seconds: None,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let row = sqlx::query(
            "SELECT d.opportunity_kind, d.segment_id, v.value_key, v.selected_numeric_value
                 FROM pomodoro_adaptive_decisions d
                 JOIN pomodoro_adaptive_decision_values v ON v.decision_id = d.id
                 WHERE d.id = 'decision-boundary-1'
                   AND v.value_key = 'short_break_minutes'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            row.try_get::<String, _>("opportunity_kind").unwrap(),
            "break_start"
        );
        assert_eq!(row.try_get::<String, _>("segment_id").unwrap(), "segment-2");
        assert_eq!(
            row.try_get::<String, _>("value_key").unwrap(),
            "short_break_minutes"
        );
        assert_eq!(
            row.try_get::<f64, _>("selected_numeric_value").unwrap(),
            5.0
        );

        let event_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pomodoro_run_events
                 WHERE run_id = 'run-1'
                   AND segment_id = 'segment-2'
                   AND event_type = 'phase_start'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(event_count, 1);
    });
}

#[test]
fn reject_invalid_adaptive_snapshot_before_insert() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        let mut snapshot = adaptive_snapshot();
        snapshot.decision.state_scores.confidence = 1.5;
        run.adaptive_snapshot = Some(snapshot);
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        let result = insert_run_tx(&mut tx, &run, &segment).await;
        assert!(result.is_err());
        tx.rollback().await.unwrap();

        let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_runs")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(run_count, 0);
    });
}

#[test]
fn insert_run_persists_provided_adaptive_planned_blocks() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        let mut snapshot = adaptive_snapshot();
        snapshot.planned_blocks = vec![adaptive_planned_block()];
        run.adaptive_snapshot = Some(snapshot);
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        tx.commit().await.unwrap();

        let saved: (String, String, String) = sqlx::query_as(
            "SELECT event_id, original_event_id, source_kind
                 FROM pomodoro_adaptive_planned_blocks
                 WHERE event_date = '2026-05-29'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            saved,
            (
                "event-1::2026-05-29".to_string(),
                "event-1".to_string(),
                "scheduler_snapshot".to_string(),
            ),
        );
    });
}

#[test]
fn reject_invalid_adaptive_planned_block_before_insert() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        let mut snapshot = adaptive_snapshot();
        let mut block = adaptive_planned_block();
        block.event_date = "2026-05-30".to_string();
        snapshot.planned_blocks = vec![block];
        run.adaptive_snapshot = Some(snapshot);
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        let result = insert_run_tx(&mut tx, &run, &segment).await;
        assert!(result.is_err());
        tx.rollback().await.unwrap();

        let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pomodoro_runs")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(run_count, 0);
    });
}

#[test]
fn close_run_records_adaptive_outcomes_and_context_state() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        run.rhythm_source = "preset".to_string();
        run.preset_key = Some("adaptive".to_string());
        run.adaptive_snapshot = Some(adaptive_snapshot());
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        tx.commit().await.unwrap();

        sqlx::query(
            "INSERT INTO doomscrolling_block_events
                    (id, run_id, segment_id, occurred_at, source_type, source_key,
                     phase, decision)
                 VALUES ('block-1', 'run-1', 'segment-1', '2026-05-29T10:10:00Z',
                         'browser', 'youtube.com', 'focus', 'blocked')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        close_run_tx(
            &mut tx,
            &PomodoroRunClosure {
                run_id: "run-1".to_string(),
                ended_at: "2026-05-29T10:40:00Z".to_string(),
                end_reason: "completed".to_string(),
                segment_status: "completed".to_string(),
                segment_end_reason: "completed".to_string(),
                event_type: "complete".to_string(),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let clean_focus: f64 = sqlx::query_scalar(
            "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'run'
                   AND outcome_key = 'clean_focus_seconds'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let blocked_attempts: f64 = sqlx::query_scalar(
            "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'run'
                   AND outcome_key = 'blocked_attempt_count'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let run_completed: i64 = sqlx::query_scalar(
            "SELECT boolean_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'run'
                   AND outcome_key = 'run_completed'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let run_end_reason: String = sqlx::query_scalar(
            "SELECT categorical_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'run'
                   AND outcome_key = 'run_end_reason'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let phase_clean_focus: f64 = sqlx::query_scalar(
            "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_clean_focus_seconds'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let phase_kind: String = sqlx::query_scalar(
            "SELECT categorical_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_kind'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(clean_focus, 40.0 * 60.0);
        assert_eq!(blocked_attempts, 1.0);
        assert_eq!(run_completed, 1);
        assert_eq!(run_end_reason, "completed");
        assert_eq!(phase_clean_focus, 40.0 * 60.0);
        assert_eq!(phase_kind, "focus");

        let state = sqlx::query(
            "SELECT context_key, readiness, avoidance_pressure, confidence
                 FROM pomodoro_adaptive_context_states
                 WHERE policy_id = 'local-adaptive-policy-v1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let context_key: String = state.try_get("context_key").unwrap();
        let readiness: f64 = state.try_get("readiness").unwrap();
        let avoidance_pressure: f64 = state.try_get("avoidance_pressure").unwrap();
        let confidence: f64 = state.try_get("confidence").unwrap();
        assert_eq!(context_key, "morning:first:medium:low:unknown:none");
        assert!(readiness > 0.0);
        assert!(avoidance_pressure > 0.0);
        assert!(confidence > 0.0);

        let history_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pomodoro_adaptive_context_state_history
                 WHERE policy_id = 'local-adaptive-policy-v1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(history_count, 1);
    });
}

#[test]
fn close_run_links_adaptive_outcomes_to_assignment() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 45,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        run.rhythm_source = "preset".to_string();
        run.preset_key = Some("adaptive".to_string());
        run.adaptive_snapshot = Some(adaptive_snapshot_with_assignment());
        let mut segment = initial_segment();
        segment.planned_end = "2026-05-29T10:45:00Z".to_string();

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        close_run_tx(
            &mut tx,
            &PomodoroRunClosure {
                run_id: "run-1".to_string(),
                ended_at: "2026-05-29T10:45:00Z".to_string(),
                end_reason: "completed".to_string(),
                segment_status: "completed".to_string(),
                segment_end_reason: "completed".to_string(),
                event_type: "complete".to_string(),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let assignment_id: String = sqlx::query_scalar(
            "SELECT assignment_id
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'run'
                   AND outcome_key = 'clean_focus_seconds'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let phase_assignment_id: String = sqlx::query_scalar(
            "SELECT assignment_id
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_clean_focus_seconds'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(assignment_id, "assignment-1");
        assert_eq!(phase_assignment_id, "assignment-1");
    });
}

#[test]
fn close_run_records_boundary_phase_outcomes() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        run.rhythm_source = "preset".to_string();
        run.preset_key = Some("adaptive".to_string());
        run.adaptive_snapshot = Some(adaptive_snapshot());
        let initial_segment = initial_segment();
        let break_segment = PomodoroSegmentWrite {
            id: "segment-2".to_string(),
            event_id: "event-1".to_string(),
            event_date: "2026-05-29".to_string(),
            run_id: "run-1".to_string(),
            rhythm_position: 1,
            phase: "short_break".to_string(),
            planned_start: "2026-05-29T10:40:00Z".to_string(),
            planned_end: "2026-05-29T10:45:00Z".to_string(),
            actual_start: Some("2026-05-29T10:40:00Z".to_string()),
            actual_end: None,
            pauses: Vec::new(),
            status: "active".to_string(),
            end_reason: None,
        };
        let envelope = adaptive_boundary_envelope(&break_segment);

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &initial_segment)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        sqlx::query(
            "UPDATE pomodoro_segments
                 SET status = 'completed',
                     actual_end = '2026-05-29T10:40:00Z',
                     end_reason = 'completed'
                 WHERE id = 'segment-1'",
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        insert_segment_tx(&mut tx, &break_segment).await.unwrap();
        insert_adaptive_decision_envelope_tx(&mut tx, &envelope)
            .await
            .unwrap();
        insert_run_event_tx(
            &mut tx,
            RunEventInsert {
                run_id: "run-1",
                segment_id: Some("segment-2"),
                event_type: "phase_start",
                occurred_at: "2026-05-29T10:40:00Z",
                phase: Some("short_break"),
                reason: None,
                duration_seconds: None,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        sqlx::query(
            "INSERT INTO doomscrolling_block_events
                    (id, run_id, segment_id, occurred_at, source_type, source_key,
                     phase, decision)
                 VALUES ('block-break-1', 'run-1', 'segment-2', '2026-05-29T10:46:00Z',
                         'browser', 'youtube.com', 'short_break', 'blocked')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        close_run_tx(
            &mut tx,
            &PomodoroRunClosure {
                run_id: "run-1".to_string(),
                ended_at: "2026-05-29T10:47:00Z".to_string(),
                end_reason: "completed".to_string(),
                segment_status: "completed".to_string(),
                segment_end_reason: "completed".to_string(),
                event_type: "complete".to_string(),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let phase_kind: String = sqlx::query_scalar(
            "SELECT categorical_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-boundary-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_kind'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let break_overtime: f64 = sqlx::query_scalar(
            "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-boundary-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_break_overtime_seconds'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let blocked_attempts: f64 = sqlx::query_scalar(
            "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-boundary-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'phase_blocked_attempt_count'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let next_focus_observed: i64 = sqlx::query_scalar(
            "SELECT boolean_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-boundary-1'
                   AND outcome_window = 'phase'
                   AND outcome_key = 'post_break_next_focus_observed'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(phase_kind, "short_break");
        assert_eq!(break_overtime, 120.0);
        assert_eq!(blocked_attempts, 1.0);
        assert_eq!(next_focus_observed, 0);
    });
}

#[test]
fn records_matured_day_outcomes_for_run_start_decisions() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        run.rhythm_source = "preset".to_string();
        run.preset_key = Some("adaptive".to_string());
        run.adaptive_snapshot = Some(adaptive_snapshot());
        let segment = initial_segment();

        sqlx::query(
            "INSERT INTO calendar_events (id, title, start_time, end_time)
                 VALUES ('event-2', 'Missed focus block',
                         '2026-05-29T13:00:00Z', '2026-05-29T14:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_configs
                    (event_id, rhythm_kind, rhythm_source, preset_key, idle_timeout_minutes)
                 VALUES ('event-1', 'count', 'preset', 'adaptive', NULL),
                        ('event-2', 'count', 'preset', 'adaptive', NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        close_run_tx(
            &mut tx,
            &PomodoroRunClosure {
                run_id: "run-1".to_string(),
                ended_at: "2026-05-29T10:40:00Z".to_string(),
                end_reason: "completed".to_string(),
                segment_status: "completed".to_string(),
                segment_end_reason: "completed".to_string(),
                event_type: "complete".to_string(),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        sqlx::query("DELETE FROM calendar_events WHERE id = 'event-2'")
            .execute(&pool)
            .await
            .unwrap();
        let captured_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)
                 FROM pomodoro_adaptive_planned_blocks
                 WHERE event_date = '2026-05-29'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(captured_count, 2);
        sqlx::query(
            "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-current', 'event-1', 'event-1', '2026-05-30',
                         '2026-05-30T10:00:00Z', '2026-05-30T10:10:00Z',
                         '2026-05-30T10:00:00Z', '2026-05-30T10:10:00Z',
                         'count', 'preset', 'adaptive', '2026-05-30T10:10:00Z',
                         'completed', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        record_matured_adaptive_day_outcomes_tx(&mut tx, "run-current", "2026-05-30T10:10:00Z")
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let observed: i64 = sqlx::query_scalar(
            "SELECT boolean_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'day'
                   AND outcome_key = 'day_observed'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let clean_focus: f64 = sqlx::query_scalar(
            "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'day'
                   AND outcome_key = 'day_clean_focus_seconds'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let planned_count: f64 = sqlx::query_scalar(
            "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'day'
                   AND outcome_key = 'day_planned_pomodoro_event_count'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let missed_count: f64 = sqlx::query_scalar(
            "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'day'
                   AND outcome_key = 'day_missed_planned_pomodoro_event_count'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(observed, 1);
        assert_eq!(clean_focus, 40.0 * 60.0);
        assert_eq!(planned_count, 2.0);
        assert_eq!(missed_count, 1.0);
    });
}

#[test]
fn records_matured_next_day_outcomes_for_run_start_decisions() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        let mut run = run_write(PomodoroRunRhythm::Count {
            focus_duration_minutes: 40,
            short_break_minutes: 5,
            long_break_minutes: 10,
            long_break_after_focus_count: 4,
        });
        run.rhythm_source = "preset".to_string();
        run.preset_key = Some("adaptive".to_string());
        run.adaptive_snapshot = Some(adaptive_snapshot());
        let segment = initial_segment();

        let mut tx = pool.begin().await.unwrap();
        insert_run_tx(&mut tx, &run, &segment).await.unwrap();
        close_run_tx(
            &mut tx,
            &PomodoroRunClosure {
                run_id: "run-1".to_string(),
                ended_at: "2026-05-29T10:40:00Z".to_string(),
                end_reason: "completed".to_string(),
                segment_status: "completed".to_string(),
                segment_end_reason: "completed".to_string(),
                event_type: "complete".to_string(),
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        sqlx::query(
            "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-next-day', 'event-1', 'event-1', '2026-05-30',
                         '2026-05-30T10:00:00Z', '2026-05-30T11:00:00Z',
                         '2026-05-30T10:00:00Z', '2026-05-30T10:30:00Z',
                         'count', 'preset', 'adaptive', '2026-05-30T10:30:00Z',
                         'completed', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, rhythm_position, phase,
                     planned_start, planned_end, actual_start, actual_end, status, end_reason)
                 VALUES ('segment-next-day', 'event-1', '2026-05-30', 'run-next-day',
                         1, 'focus', '2026-05-30T10:00:00Z',
                         '2026-05-30T10:30:00Z', '2026-05-30T10:00:00Z',
                         '2026-05-30T10:30:00Z', 'completed', 'completed')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-current', 'event-1', 'event-1', '2026-05-31',
                         '2026-05-31T10:00:00Z', '2026-05-31T10:10:00Z',
                         '2026-05-31T10:00:00Z', '2026-05-31T10:10:00Z',
                         'count', 'preset', 'adaptive', '2026-05-31T10:10:00Z',
                         'completed', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        record_matured_adaptive_next_day_outcomes_tx(
            &mut tx,
            "run-current",
            "2026-05-31T10:10:00Z",
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let observed: i64 = sqlx::query_scalar(
            "SELECT boolean_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'next_day'
                   AND outcome_key = 'next_day_observed'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let clean_focus: f64 = sqlx::query_scalar(
            "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'next_day'
                   AND outcome_key = 'next_day_clean_focus_seconds'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let run_count: f64 = sqlx::query_scalar(
            "SELECT numeric_value
                 FROM pomodoro_adaptive_outcomes
                 WHERE decision_id = 'decision-1'
                   AND outcome_window = 'next_day'
                   AND outcome_key = 'next_day_run_count'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(observed, 1);
        assert_eq!(clean_focus, 30.0 * 60.0);
        assert_eq!(run_count, 1.0);
    });
}

#[test]
fn load_adaptive_history_reads_recent_signals() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        sqlx::query(
            "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-1', 'event-1', 'event-1', '2026-05-29',
                         '2026-05-29T10:00:00Z', '2026-05-29T11:00:00Z',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:20:00Z',
                         'count', 'preset', 'adaptive', '2026-05-29T10:20:00Z',
                         'stopped', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, rhythm_position, phase,
                     planned_start, planned_end, actual_start, actual_end, status, end_reason)
                 VALUES ('segment-1', 'event-1', '2026-05-29', 'run-1', 1, 'focus',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:40:00Z',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:20:00Z',
                         'interrupted', 'focus_failed')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_pauses (id, segment_id, started_at, ended_at, reason)
                 VALUES ('pause-1', 'segment-1', '2026-05-29T10:10:00Z',
                         '2026-05-29T10:14:00Z', 'idle')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
                "INSERT INTO pomodoro_run_events
                    (id, run_id, segment_id, event_type, occurred_at, phase, reason, duration_seconds)
                 VALUES ('run-event-1', 'run-1', 'segment-1', 'focus_failed',
                         '2026-05-29T10:20:00Z', 'focus', 'long_idle', 300)",
            )
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_policies
                    (id, status, policy_version, model_version)
                 VALUES ('local-adaptive-policy-v1', 'active', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_context_states
                    (policy_id, context_key, readiness, strain, recovery_debt,
                     avoidance_pressure, momentum, confidence, updated_at)
                 VALUES ('local-adaptive-policy-v1', 'morning:first', 0.2, 0.7, 0.6,
                         0.4, 0.1, 0.8, '2026-05-29T10:30:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO doomscrolling_block_events
                    (id, run_id, segment_id, occurred_at, source_type, source_key,
                     phase, decision)
                 VALUES ('block-1', 'run-1', 'segment-1', '2026-05-29T10:05:00Z',
                         'browser', 'youtube.com', 'focus', 'blocked')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let history = load_adaptive_history_from_pool(
            &pool,
            "2026-05-29T11:00:00Z",
            "local-adaptive-policy-v1",
            20,
        )
        .await
        .unwrap();

        assert_eq!(history.segments.len(), 1);
        assert_eq!(history.segments[0].run_id, "run-1");
        assert_eq!(history.segments[0].rhythm_position, 1);
        assert_eq!(
            history.segments[0].end_reason.as_deref(),
            Some("focus_failed")
        );
        assert_eq!(history.segments[0].pause_log.len(), 1);
        assert_eq!(history.run_events.len(), 1);
        assert_eq!(history.run_events[0].event_type, "focus_failed");
        assert_eq!(history.block_events.len(), 1);
        assert_eq!(history.block_events[0].source_key, "youtube.com");
        assert_eq!(history.previous_states.len(), 1);
        assert_eq!(history.previous_states[0].context_key, "morning:first");
        assert_eq!(history.previous_states[0].confidence, 0.8);
        assert!(history.experiment_states.is_empty());
        assert!(history.experiment_outcomes.is_empty());
        assert!(history.experiment_assignments.is_empty());
    });
}

#[test]
fn load_adaptive_history_reads_experiment_outcome_summaries() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        sqlx::query(
            "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-1', 'event-1', 'event-1', '2026-05-29',
                         '2026-05-29T10:00:00Z', '2026-05-29T11:00:00Z',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:45:00Z',
                         'count', 'preset', 'adaptive', '2026-05-29T10:45:00Z',
                         'completed', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_policies
                    (id, status, policy_version, model_version)
                 VALUES ('local-adaptive-policy-v1', 'active', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_context_snapshots
                    (id, run_id, local_started_at, time_of_day, session_position,
                     event_length, workload, energy)
                 VALUES ('context-control', 'run-1', '2026-05-29T10:00:00Z',
                         'morning', 'first', 'medium', 'low', 'unknown'),
                        ('context-treatment', 'run-1', '2026-05-29T11:00:00Z',
                         'morning', 'first', 'medium', 'low', 'unknown')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_experiments
                    (id, policy_id, parameter_key, assignment_unit, status, started_at)
                 VALUES ('run-focus-duration-40-vs-45-v1', 'local-adaptive-policy-v1',
                         'focus_duration_minutes', 'run', 'active', '2026-05-29T10:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_experiment_variants
                    (experiment_id, variant_key, numeric_value, is_control)
                 VALUES ('run-focus-duration-40-vs-45-v1', 'control_40', 40, 1),
                        ('run-focus-duration-40-vs-45-v1', 'focus_45', 45, 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_assignments
                    (id, experiment_id, variant_key, run_id, context_snapshot_id,
                     assignment_seed, assigned_at)
                 VALUES ('assignment-control', 'run-focus-duration-40-vs-45-v1',
                         'control_40', 'run-1', 'context-control', 'seed-control',
                         '2026-05-29T10:00:00Z'),
                        ('assignment-treatment', 'run-focus-duration-40-vs-45-v1',
                         'focus_45', 'run-1', 'context-treatment', 'seed-treatment',
                         '2026-05-29T11:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_outcomes
                    (id, assignment_id, outcome_window, outcome_key, numeric_value,
                     boolean_value, measured_at)
                 VALUES
                    ('outcome-control-completed', 'assignment-control', 'run',
                     'run_completed', NULL, 1, '2026-05-29T10:40:00Z'),
                    ('outcome-control-clean', 'assignment-control', 'run',
                     'clean_focus_seconds', 2400, NULL, '2026-05-29T10:40:00Z'),
                    ('outcome-control-blocked', 'assignment-control', 'run',
                     'blocked_attempt_count', 1, NULL, '2026-05-29T10:40:00Z'),
                    ('outcome-control-short-break-overtime', 'assignment-control', 'run',
                     'short_break_overtime_seconds', 90, NULL, '2026-05-29T10:40:00Z'),
                    ('outcome-control-day', 'assignment-control', 'day',
                     'day_observed', NULL, 1, '2026-05-30T09:00:00Z'),
                    ('outcome-control-day-started', 'assignment-control', 'day',
                     'day_started_planned_pomodoro_event_count', 2, NULL,
                     '2026-05-30T09:00:00Z'),
                    ('outcome-control-day-missed', 'assignment-control', 'day',
                     'day_missed_planned_pomodoro_event_count', 0, NULL,
                     '2026-05-30T09:00:00Z'),
                    ('outcome-control-day-clean', 'assignment-control', 'day',
                     'day_clean_focus_seconds', 4800, NULL, '2026-05-30T09:00:00Z'),
                    ('outcome-treatment-completed', 'assignment-treatment', 'run',
                     'run_completed', NULL, 0, '2026-05-29T11:45:00Z'),
                    ('outcome-treatment-stopped', 'assignment-treatment', 'run',
                     'run_stopped', NULL, 1, '2026-05-29T11:45:00Z'),
                    ('outcome-treatment-clean', 'assignment-treatment', 'run',
                     'clean_focus_seconds', 1800, NULL, '2026-05-29T11:45:00Z'),
                    ('outcome-treatment-short-break-overtime', 'assignment-treatment', 'run',
                     'short_break_overtime_seconds', 30, NULL, '2026-05-29T11:45:00Z'),
                    ('outcome-treatment-day', 'assignment-treatment', 'day',
                     'day_observed', NULL, 1, '2026-05-30T09:00:00Z'),
                    ('outcome-treatment-day-started', 'assignment-treatment', 'day',
                     'day_started_planned_pomodoro_event_count', 1, NULL,
                     '2026-05-30T09:00:00Z'),
                    ('outcome-treatment-day-missed', 'assignment-treatment', 'day',
                     'day_missed_planned_pomodoro_event_count', 1, NULL,
                     '2026-05-30T09:00:00Z'),
                    ('outcome-treatment-day-blocked', 'assignment-treatment', 'day',
                     'day_blocked_attempt_count', 4, NULL, '2026-05-30T09:00:00Z'),
                    ('outcome-treatment-next-day', 'assignment-treatment', 'next_day',
                     'next_day_observed', NULL, 1, '2026-05-31T09:00:00Z'),
                    ('outcome-treatment-next-day-started', 'assignment-treatment', 'next_day',
                     'next_day_started_run', NULL, 0, '2026-05-31T09:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let history = load_adaptive_history_from_pool(
            &pool,
            "2026-06-01T00:00:00Z",
            "local-adaptive-policy-v1",
            20,
        )
        .await
        .unwrap();

        assert_eq!(history.experiment_states.len(), 1);
        assert_eq!(
            history.experiment_states[0].experiment_id,
            "run-focus-duration-40-vs-45-v1"
        );
        assert_eq!(history.experiment_states[0].status, "active");
        assert_eq!(history.experiment_assignments.len(), 2);
        assert_eq!(
            history.experiment_assignments[0].experiment_id,
            "run-focus-duration-40-vs-45-v1"
        );
        assert_eq!(history.experiment_assignments[0].variant_key, "focus_45");
        assert_eq!(
            history.experiment_assignments[0].context_key,
            "morning:first:medium:low:unknown:none"
        );
        assert_eq!(
            history.experiment_assignments[0].assigned_at,
            "2026-05-29T11:00:00Z"
        );
        assert_eq!(history.experiment_outcomes.len(), 2);
        let control = history
            .experiment_outcomes
            .iter()
            .find(|outcome| outcome.variant_key == "control_40")
            .unwrap();
        let treatment = history
            .experiment_outcomes
            .iter()
            .find(|outcome| outcome.variant_key == "focus_45")
            .unwrap();
        assert_eq!(control.assignment_count, 1);
        assert_eq!(control.context_key, "morning:first:medium:low:unknown:none");
        assert_eq!(control.run_observed_count, 1);
        assert_eq!(control.run_completed_count, 1);
        assert_eq!(control.clean_focus_seconds_sum, 2400.0);
        assert_eq!(control.clean_focus_seconds_square_sum, 5_760_000.0);
        assert_eq!(control.blocked_attempt_count_sum, 1.0);
        assert_eq!(control.blocked_attempt_count_square_sum, 1.0);
        assert_eq!(control.short_break_overtime_seconds_sum, 90.0);
        assert_eq!(control.short_break_overtime_seconds_square_sum, 8_100.0);
        assert_eq!(control.day_observed_count, 1);
        assert_eq!(control.day_started_planned_pomodoro_count_sum, 2.0);
        assert_eq!(control.day_missed_planned_pomodoro_count_sum, 0.0);
        assert_eq!(control.day_missed_planned_pomodoro_count_square_sum, 0.0);
        assert_eq!(control.day_clean_focus_seconds_sum, 4800.0);
        assert_eq!(treatment.assignment_count, 1);
        assert_eq!(treatment.run_observed_count, 1);
        assert_eq!(treatment.run_completed_count, 0);
        assert_eq!(treatment.run_stopped_count, 1);
        assert_eq!(treatment.short_break_overtime_seconds_sum, 30.0);
        assert_eq!(treatment.short_break_overtime_seconds_square_sum, 900.0);
        assert_eq!(treatment.day_observed_count, 1);
        assert_eq!(treatment.day_missed_planned_pomodoro_count_sum, 1.0);
        assert_eq!(treatment.day_missed_planned_pomodoro_count_square_sum, 1.0);
        assert_eq!(treatment.day_blocked_attempt_count_sum, 4.0);
        assert_eq!(treatment.day_blocked_attempt_count_square_sum, 16.0);
        assert_eq!(treatment.next_day_observed_count, 1);
        assert_eq!(treatment.next_day_started_run_count, 0);
    });
}

#[test]
fn load_adaptive_replay_dataset_reads_run_start_decisions_and_outcomes() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_pool_with_event().await;
        sqlx::query(
            "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-1', 'event-1', 'event-1', '2026-05-29',
                         '2026-05-29T10:00:00Z', '2026-05-29T11:00:00Z',
                         '2026-05-29T10:00:00Z', '2026-05-29T10:45:00Z',
                         'count', 'preset', 'adaptive', '2026-05-29T10:45:00Z',
                         'completed', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_policies
                    (id, status, policy_version, model_version)
                 VALUES ('local-adaptive-policy-v1', 'active', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_runs
                    (id, event_id, original_event_id, event_date, planned_start, planned_end,
                     started_at, ended_at, rhythm_kind, rhythm_source, preset_key, last_heartbeat,
                     end_reason, start_trigger)
                 VALUES ('run-prior', 'event-1', 'event-1', '2026-05-28',
                         '2026-05-28T09:00:00Z', '2026-05-28T10:00:00Z',
                         '2026-05-28T09:00:00Z', '2026-05-28T09:40:00Z',
                         'count', 'preset', 'adaptive', '2026-05-28T09:40:00Z',
                         'completed', 'manual')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_segments
                    (id, event_id, event_date, run_id, rhythm_position, phase,
                     planned_start, planned_end, actual_start, actual_end, status, end_reason)
                 VALUES ('segment-prior', 'event-1', '2026-05-28', 'run-prior', 1,
                         'focus', '2026-05-28T09:00:00Z', '2026-05-28T09:40:00Z',
                         '2026-05-28T09:00:00Z', '2026-05-28T09:40:00Z',
                         'completed', 'completed')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_context_state_history
                    (id, policy_id, context_key, observed_at, readiness, strain,
                     recovery_debt, avoidance_pressure, momentum, confidence)
                 VALUES ('state-before', 'local-adaptive-policy-v1',
                         'morning:first:medium:low:unknown:none',
                         '2026-05-28T10:00:00Z', 0.5, 0.2, 0.2, 0.1, 0.6, 0.7),
                        ('state-after', 'local-adaptive-policy-v1',
                         'morning:first:medium:low:unknown:none',
                         '2026-05-29T11:00:00Z', 0.9, 0.1, 0.1, 0.0, 0.9, 0.95)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_context_snapshots
                    (id, run_id, local_started_at, time_of_day, session_position,
                     event_length, workload, energy)
                 VALUES ('context-1', 'run-1', '2026-05-29T10:00:00Z',
                         'morning', 'first', 'medium', 'low', 'unknown')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_decisions
                    (id, policy_id, run_id, context_snapshot_id, opportunity_kind,
                     candidate_id, decision_mode, policy_version, model_version, occurred_at)
                 VALUES ('decision-1', 'local-adaptive-policy-v1', 'run-1',
                         'context-1', 'run_start',
                         'focus-growth-with-short-break-support',
                         'explore', 1, 1,
                         '2026-05-29T10:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_decision_values
                    (decision_id, value_key, previous_numeric_value, selected_numeric_value,
                     value_unit)
                 VALUES
                    ('decision-1', 'focus_duration_minutes', 40, 45, 'minutes'),
                    ('decision-1', 'short_break_minutes', 5, 5, 'minutes'),
                    ('decision-1', 'long_break_minutes', 10, 10, 'minutes'),
                    ('decision-1', 'long_break_after_focus_count', 4, 4, 'count')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO pomodoro_adaptive_outcomes
                    (id, decision_id, outcome_window, outcome_key, numeric_value,
                     boolean_value, measured_at)
                 VALUES
                    ('outcome-clean', 'decision-1', 'run', 'clean_focus_seconds',
                     2700, NULL, '2026-05-29T10:45:00Z'),
                    ('outcome-completed', 'decision-1', 'run', 'run_completed',
                     NULL, 1, '2026-05-29T10:45:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let prior_segment_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)
                 FROM pomodoro_segments
                 WHERE planned_start < '2026-05-29T10:00:00Z'
                   AND status IN ('completed', 'interrupted')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(prior_segment_count, 1);

        let dataset = load_adaptive_replay_dataset_from_pool(
            &pool,
            "2026-05-30T00:00:00Z",
            "local-adaptive-policy-v1",
            20,
            20,
        )
        .await
        .unwrap();

        assert_eq!(dataset.opportunities.len(), 1);
        let opportunity = &dataset.opportunities[0];
        assert_eq!(opportunity.id, "decision-1");
        assert_eq!(opportunity.run_id, "run-1");
        assert_eq!(opportunity.started_at, "2026-05-29T10:00:00Z");
        assert_eq!(
            opportunity.candidate_id.as_deref(),
            Some("focus-growth-with-short-break-support")
        );
        match &opportunity.current_rhythm {
            PomodoroRunRhythm::Count {
                focus_duration_minutes,
                short_break_minutes,
                long_break_minutes,
                long_break_after_focus_count,
            } => {
                assert_eq!(*focus_duration_minutes, 40);
                assert_eq!(*short_break_minutes, 5);
                assert_eq!(*long_break_minutes, 10);
                assert_eq!(*long_break_after_focus_count, 4);
            }
            PomodoroRunRhythm::Sequence { .. } => panic!("expected count rhythm"),
        }
        match &opportunity.selected_rhythm {
            PomodoroRunRhythm::Count {
                focus_duration_minutes,
                ..
            } => assert_eq!(*focus_duration_minutes, 45),
            PomodoroRunRhythm::Sequence { .. } => panic!("expected count rhythm"),
        }
        assert_eq!(dataset.outcomes.len(), 2);
        let completed = dataset
            .outcomes
            .iter()
            .find(|outcome| outcome.outcome_key == "run_completed")
            .unwrap();
        assert_eq!(completed.boolean_value, Some(true));
        assert_eq!(dataset.histories.len(), 1);
        assert_eq!(dataset.histories[0].opportunity_id, "decision-1");
        assert_eq!(dataset.histories[0].history.segments.len(), 1);
        assert_eq!(dataset.histories[0].history.segments[0].run_id, "run-prior");
        assert_eq!(dataset.histories[0].history.previous_states.len(), 1);
        assert_eq!(
            dataset.histories[0].history.previous_states[0].confidence,
            0.7
        );
    });
}

#[test]
fn close_run_clamps_end_to_active_segment_start() {
    tauri::async_runtime::block_on(async {
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
                 VALUES ('pause-1', 'segment-1', '2026-05-29T10:05:00Z', 'idle')",
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
        assert_eq!(run_end, "2026-05-29T10:05:00Z");
        assert_eq!(segment_end, "2026-05-29T10:05:00Z");
        assert_eq!(pause_end, "2026-05-29T10:05:00Z");
    });
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
fn validates_run_window_update() {
    assert!(validate_run_window_update(&PomodoroRunWindowUpdate {
        run_id: "run-1".to_string(),
        planned_end: "2026-05-23T15:00:00Z".to_string(),
    })
    .is_ok());
    assert!(validate_run_window_update(&PomodoroRunWindowUpdate {
        run_id: String::new(),
        planned_end: "2026-05-23T15:00:00Z".to_string(),
    })
    .is_err());
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
