use super::*;

#[test]
fn shell_search_timeline_and_archive_reads_stay_lightweight() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_thread().await;
        append_canonical_event(&pool, content_event("event-shell", "Searchable response"))
            .await
            .unwrap();
        let projects = read_project_shells(&pool).await.unwrap();
        let project = projects
            .iter()
            .find(|project| project.project_id == "project-chat")
            .expect("Chat project shell");
        assert_eq!(project.active_thread_count, 1);
        let shells = read_thread_shells(&pool, None, false).await.unwrap();
        assert_eq!(shells.len(), 1);
        assert_eq!(shells[0].message_count, 1);
        let search = search_thread_titles(&pool, "cha", Some(false), 20)
            .await
            .unwrap();
        assert_eq!(search.len(), 1);
        let page = read_timeline_page(&pool, &ChatThreadId::new("thread-1").unwrap(), None, 20)
            .await
            .unwrap();
        assert_eq!(page.items.len(), 1);

        let revision = set_thread_read(
            &pool,
            &ChatThreadId::new("thread-1").unwrap(),
            false,
            2,
            &UtcTimestamp::new(NOW).unwrap(),
        )
        .await
        .unwrap();
        let revision = set_thread_archived(
            &pool,
            &ChatThreadId::new("thread-1").unwrap(),
            true,
            revision,
            &UtcTimestamp::new(NOW).unwrap(),
        )
        .await
        .unwrap();
        assert!(
            read_thread_shells(&pool, None, false)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            read_thread_shells(&pool, None, true).await.unwrap().len(),
            1
        );
        set_thread_archived(
            &pool,
            &ChatThreadId::new("thread-1").unwrap(),
            false,
            revision,
            &UtcTimestamp::new(NOW).unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(
            read_thread_shells(&pool, None, false).await.unwrap().len(),
            1
        );
    });
}

#[test]
fn thread_shell_window_limits_recent_navigation_rows() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_thread().await;
        sqlx::query(
            "INSERT INTO chat_threads
                (id, project_id, working_folder_id, title, provider_family_id,
                 provider_instance_id, continuation_group_id, safety_mode, interaction_mode, state,
                 last_activity_at, created_at, updated_at)
             VALUES ('thread-recent', 'project-chat', 'workspace-1', 'Recent', 'codex',
                     'codex-personal', 'continuation-1', 'ask_for_approval', 'build', 'idle',
                     '2026-07-21T00:00:00.000Z', ?, ?)",
        )
        .bind(NOW)
        .bind(NOW)
        .execute(&pool)
        .await
        .unwrap();

        let threads = read_thread_shell_window(&pool, None, false, 1)
            .await
            .unwrap();
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].id.as_str(), "thread-recent");
    });
}

#[test]
fn scratch_thread_shells_are_exactly_readable_but_hidden_from_direct_navigation() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_thread().await;
        sqlx::raw_sql("PRAGMA foreign_keys=OFF")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO chat_scratch_generations
                (id, scratch_scope_id, generation, created_at, updated_at)
             VALUES ('scratch-generation:shell', 'scratch-scope:shell', 1, ?, ?)",
        )
        .bind(NOW)
        .bind(NOW)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO chat_execution_environments
                (id, scratch_generation_id, kind, display_name,
                 lifecycle_state, created_at, updated_at)
             VALUES ('scratch-environment:shell', 'scratch-generation:shell',
                     'scratch', 'Private scratch', 'available', ?, ?)",
        )
        .bind(NOW)
        .bind(NOW)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO chat_threads
                (id, project_id, execution_environment_id, scratch_generation_id,
                 title, provider_family_id, provider_instance_id,
                 continuation_group_id, safety_mode, interaction_mode, state,
                 last_activity_at, created_at, updated_at)
             VALUES ('thread-scratch', 'project-chat', 'scratch-environment:shell',
                     'scratch-generation:shell', 'Private scratch execution',
                     'codex', 'codex-personal', 'continuation-scratch',
                     'ask_for_approval', 'build', 'idle', ?, ?, ?)",
        )
        .bind(NOW)
        .bind(NOW)
        .bind(NOW)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql("PRAGMA foreign_keys=ON")
            .execute(&pool)
            .await
            .unwrap();

        let scratch = read_thread_shell(&pool, &ChatThreadId::new("thread-scratch").unwrap())
            .await
            .unwrap();
        assert!(scratch.working_folder_id.is_none());
        assert_eq!(
            scratch.execution_environment_id.as_str(),
            "scratch-environment:shell"
        );
        assert_eq!(
            scratch.scratch_generation_id.as_ref().map(|id| id.as_str()),
            Some("scratch-generation:shell")
        );

        let listed = read_thread_shells(&pool, None, false).await.unwrap();
        assert!(
            listed
                .iter()
                .all(|thread| thread.id.as_str() != "thread-scratch")
        );
        let searched = search_thread_titles(&pool, "scratch", Some(false), 20)
            .await
            .unwrap();
        assert!(searched.is_empty());
    });
}

#[test]
fn timeline_cursor_does_not_skip_rows_that_share_a_sequence() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_thread().await;
        append_canonical_event(&pool, content_event("event-page", "Answer"))
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO chat_activities
                (id, thread_id, sequence_anchor, item_kind, status, title,
                 source_event_type, created_at, updated_at)
             VALUES ('activity-same-sequence', 'thread-1', 1, 'web_search',
                     'completed', 'Search', 'item_completed', ?, ?)",
        )
        .bind(NOW)
        .bind(NOW)
        .execute(&pool)
        .await
        .unwrap();

        let thread_id = ChatThreadId::new("thread-1").unwrap();
        let newest = read_timeline_page(&pool, &thread_id, None, 1)
            .await
            .unwrap();
        let cursor = parse_timeline_cursor(newest.previous_cursor.as_deref().unwrap()).unwrap();
        let older = read_timeline_page(&pool, &thread_id, Some(&cursor), 1)
            .await
            .unwrap();

        let ids = [
            newest.items[0].activity_id.as_str(),
            older.items[0].activity_id.as_str(),
        ]
        .into_iter()
        .collect::<HashSet<_>>();
        assert_eq!(ids.len(), 2);
        assert!(older.previous_cursor.is_none());
    });
}

#[test]
fn exact_turn_timeline_read_does_not_depend_on_the_latest_thread_page() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_thread().await;
        for (suffix, answer) in [("older", "Older answer"), ("newer", "Newer answer")] {
            let turn_id = format!("turn-{suffix}");
            append_canonical_event(
                &pool,
                canonical_request(
                    &format!("event-{suffix}-start"),
                    Some(&turn_id),
                    CanonicalEvent::TurnStarted(TurnStartedEvent {
                        provider_turn_id: None,
                        state: ChatTurnState::Active,
                        modes: TurnModeSnapshot {
                            safety_mode: SafetyMode::AskForApproval,
                            interaction_mode: InteractionMode::Build,
                        },
                        model_id: None,
                        model_options: Vec::new(),
                    }),
                ),
            )
            .await
            .unwrap();
            append_canonical_event(
                &pool,
                canonical_request(
                    &format!("event-{suffix}-answer"),
                    Some(&turn_id),
                    CanonicalEvent::ItemCompleted(ItemLifecycleEvent {
                        item_id: format!("answer-{suffix}"),
                        kind: CanonicalItemKind::AssistantMessage,
                        status: ActivityStatus::Completed,
                        title: Some("Assistant message".to_string()),
                        detail: Some(answer.to_string()),
                        safe_metadata: Some(VersionedJson {
                            schema_version: 1,
                            value: serde_json::json!({ "phase": "final_answer" }),
                        }),
                    }),
                ),
            )
            .await
            .unwrap();
            append_canonical_event(
                &pool,
                canonical_request(
                    &format!("event-{suffix}-complete"),
                    Some(&turn_id),
                    CanonicalEvent::TurnCompleted(TurnCompletedEvent {
                        state: ChatTurnState::Completed,
                        stop_reason: None,
                        usage: None,
                        changed_files: Vec::new(),
                    }),
                ),
            )
            .await
            .unwrap();
        }

        let thread_id = ChatThreadId::new("thread-1").unwrap();
        let turn_id = ChatTurnId::new("turn-older").unwrap();
        let page = read_timeline_turn(&pool, &thread_id, &turn_id)
            .await
            .unwrap();

        assert_eq!(page.thread_id, thread_id);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].activity_id.as_str(), "answer-older");
        assert_eq!(page.items[0].source_thread_id.as_ref(), Some(&thread_id));
        assert_eq!(page.turns.len(), 1);
        assert_eq!(page.turns[0].turn_id, turn_id);
        assert!(page.previous_cursor.is_none());
        assert!(page.next_cursor.is_none());
    });
}
