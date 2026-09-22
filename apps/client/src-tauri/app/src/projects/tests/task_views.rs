use super::*;
use std::collections::{HashMap, HashSet};

#[test]
fn sql_like_contains_pattern_escapes_wildcards() {
    assert_eq!(sql_like_contains_pattern("100% done"), "%100\\% done%");
    assert_eq!(sql_like_contains_pattern("task_1"), "%task\\_1%");
    assert_eq!(sql_like_contains_pattern(r"c:\work"), r"%c:\\work%");
}

#[test]
fn normalize_optional_date_filter_accepts_blank_and_iso_dates() {
    assert_eq!(normalize_optional_date_filter(None, "start_date"), Ok(None));
    assert_eq!(
        normalize_optional_date_filter(Some(" ".to_string()), "start_date"),
        Ok(None)
    );
    assert_eq!(
        normalize_optional_date_filter(Some("2026-06-12".to_string()), "start_date"),
        Ok(Some("2026-06-12".to_string()))
    );
}

#[test]
fn normalize_optional_date_filter_rejects_malformed_dates() {
    assert_eq!(
        normalize_optional_date_filter(Some("2026-6-12".to_string()), "start_date"),
        Err("start_date must use YYYY-MM-DD".to_string())
    );
    assert_eq!(
        normalize_optional_date_filter(Some("2026/06/12".to_string()), "end_date"),
        Err("end_date must use YYYY-MM-DD".to_string())
    );
}

fn list_task_view_request(page_size: i64) -> ProjectTaskViewRequest {
    ProjectTaskViewRequest {
        project_id: "project-a".to_string(),
        view: ProjectViewId::List,
        page_size,
        cursor: None,
        column_cursors: HashMap::new(),
        show_archived: false,
        visible_section_ids: vec!["section-a".to_string()],
        search: String::new(),
        status_filter: "all".to_string(),
        section_filter: "all".to_string(),
        priority_filter: "all".to_string(),
        due_filter: "all".to_string(),
        due_range_start: String::new(),
        due_range_end: String::new(),
        today: "2026-07-11".to_string(),
        week_end: "2026-07-18".to_string(),
        schedule_filter: "all".to_string(),
        dependency_filter: "all".to_string(),
        tag_filter: "all".to_string(),
        custom_field_filters: Vec::new(),
        sort_mode: "manual".to_string(),
        sort_direction: "asc".to_string(),
        candidate_event_ids: Vec::new(),
    }
}

#[test]
fn task_view_list_is_keyset_paginated_and_body_bounded() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_project_graph_fixture(&pool).await;
        sqlx::query("DELETE FROM project_tasks")
            .execute(&pool)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        for index in 0..10_000 {
            sqlx::query(
                "INSERT INTO project_tasks
                 (id, project_id, section_id, status_id, title, description, section_sort_order)
                 VALUES (?, 'project-a', 'section-a', 'status-a', ?, ?, ?)",
            )
            .bind(format!("task-{index:05}"))
            .bind(format!("Task {index:05}"))
            .bind("body".repeat(1_000))
            .bind(index as f64)
            .execute(&mut *tx)
            .await
            .unwrap();
        }
        tx.commit().await.unwrap();

        let first = load_task_view(&pool, list_task_view_request(10_000))
            .await
            .unwrap();
        assert_eq!(first.total_count, 10_000);
        assert_eq!(first.matched_count, 10_000);
        assert_eq!(
            first.tasks.len(),
            crate::projects::task_views::LIST_RESPONSE_TASK_CAP as usize
        );
        assert!(serde_json::to_vec(&first).unwrap().len() < 100_000);
        let first_ids: HashSet<_> = first.tasks.iter().map(|task| task.id.as_str()).collect();

        let mut next_request = list_task_view_request(100);
        next_request.cursor = first.next_cursor.clone();
        let second = load_task_view(&pool, next_request).await.unwrap();
        assert_eq!(second.tasks.len(), 100);
        assert!(
            second
                .tasks
                .iter()
                .all(|task| !first_ids.contains(task.id.as_str()))
        );

        let mut stale_request = list_task_view_request(100);
        stale_request.cursor = Some("removed-task".to_string());
        let error = match load_task_view(&pool, stale_request).await {
            Ok(_) => panic!("stale cursor should fail"),
            Err(error) => error,
        };
        assert_eq!(error, "project task cursor is stale");
    });
}

#[test]
fn task_view_handles_empty_single_and_exact_page_sizes() {
    tauri::async_runtime::block_on(async {
        for count in [0, 1, 100] {
            let pool = migrated_memory_pool().await;
            insert_project_graph_fixture(&pool).await;
            sqlx::query("DELETE FROM project_tasks")
                .execute(&pool)
                .await
                .unwrap();
            for index in 0..count {
                sqlx::query(
                    "INSERT INTO project_tasks
                     (id, project_id, section_id, status_id, title, section_sort_order)
                     VALUES (?, 'project-a', 'section-a', 'status-a', ?, ?)",
                )
                .bind(format!("task-{index}"))
                .bind(format!("Task {index}"))
                .bind(index as f64)
                .execute(&pool)
                .await
                .unwrap();
            }
            let page = load_task_view(&pool, list_task_view_request(100))
                .await
                .unwrap();
            assert_eq!(page.tasks.len(), count);
            assert_eq!(page.matched_count, count as i64);
            assert!(page.next_cursor.is_none());
        }
    });
}

#[test]
fn task_view_filters_bodies_without_returning_them_and_detail_hydrates_one_task() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_project_graph_fixture(&pool).await;
        sqlx::query(
            "UPDATE project_tasks SET description = 'private needle', blocker_reason = 'secret',
             due_date = '2026-07-10', estimate_minutes = 25 WHERE id = 'task-b'",
        )
        .execute(&pool)
        .await
        .unwrap();
        let mut request = list_task_view_request(100);
        request.search = "needle".to_string();
        request.sort_mode = "due".to_string();
        let page = load_task_view(&pool, request).await.unwrap();
        assert_eq!(page.matched_count, 1);
        assert_eq!(page.tasks[0].id, "task-b");
        let summary_json = serde_json::to_value(&page.tasks[0]).unwrap();
        assert!(summary_json.get("description").is_none());
        assert!(summary_json.get("blocker_reason").is_none());
        assert_eq!(summary_json["blocker_reason_present"], 1);

        let detail = load_task_detail(&pool, "task-b").await.unwrap();
        assert_eq!(detail.task.description, "private needle");
        assert_eq!(detail.task.blocker_reason.as_deref(), Some("secret"));
        assert!(detail.related_tasks.len() <= 200);
    });
}

#[test]
fn kanban_and_dashboard_return_counts_with_bounded_samples() {
    tauri::async_runtime::block_on(async {
        let pool = migrated_memory_pool().await;
        insert_project_graph_fixture(&pool).await;
        let mut kanban = list_task_view_request(100);
        kanban.view = ProjectViewId::Kanban;
        let kanban_page = load_task_view(&pool, kanban).await.unwrap();
        assert_eq!(kanban_page.column_counts.len(), 1);
        assert_eq!(kanban_page.column_counts[0].count, 3);

        let mut dashboard = list_task_view_request(100);
        dashboard.view = ProjectViewId::Dashboard;
        let dashboard_page = load_task_view(&pool, dashboard).await.unwrap();
        assert_eq!(dashboard_page.tasks.len(), 3);
        assert_eq!(dashboard_page.aggregates.unwrap().total, 3);
    });
}
