use super::*;
use crate::db::run_migrations;
use sqlx::sqlite::SqlitePoolOptions;

async fn pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    run_migrations(&pool).await.unwrap();
    pool
}

fn runs(content: &str) -> Vec<QuickNoteTextRun> {
    vec![QuickNoteTextRun {
        content: content.to_string(),
        bold: false,
        italic: false,
        underline: false,
    }]
}

async fn create(pool: &SqlitePool, id: &str, title: &str, body: &str) {
    let normalized = runs(body);
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO quick_notes (id, title, body_plain_text) VALUES (?, ?, ?)")
        .bind(id)
        .bind(title)
        .bind(body)
        .execute(&mut *tx)
        .await
        .unwrap();
    replace_runs(&mut tx, id, &normalized).await.unwrap();
    tx.commit().await.unwrap();
}

#[test]
fn normalizes_adjacent_runs_and_enforces_limits() {
    let merged = normalized_runs(&[
        QuickNoteTextRun {
            content: "one".into(),
            bold: true,
            italic: false,
            underline: false,
        },
        QuickNoteTextRun {
            content: String::new(),
            bold: false,
            italic: false,
            underline: false,
        },
        QuickNoteTextRun {
            content: " two".into(),
            bold: true,
            italic: false,
            underline: false,
        },
    ])
    .unwrap();
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].content, "one two");
    assert!(validate_content("id", &"x".repeat(201), &[], 30).is_err());
    assert!(validate_content("id", "title", &runs("body"), 32).is_err());
}

#[test]
fn crud_search_lifecycle_and_revision_conflicts_are_consistent() {
    tauri::async_runtime::block_on(async {
        let pool = pool().await;
        create(&pool, "one", "First", "alpha body").await;
        create(&pool, "two", "Second", "beta body").await;

        let active = list_window_from_pool(
            &pool,
            QuickNotesListRequest {
                collection: QuickNotesCollection::Active,
                query: Some("alpha".into()),
                tag_id: None,
                cursor: None,
                page_size: Some(60),
            },
        )
        .await
        .unwrap();
        assert_eq!(active.notes.len(), 1);
        assert_eq!(active.notes[0].id, "one");

        let archived = revision_mutation(
            &pool,
            &QuickNoteRevisionRequest { id: "one".into(), expected_revision: 1 },
            "UPDATE quick_notes SET archived = 1, pinned = 0, revision = revision + 1 WHERE id = ? AND revision = ?",
            "archive",
        ).await.unwrap();
        assert!(archived.archived);
        let conflict = revision_mutation(
            &pool,
            &QuickNoteRevisionRequest { id: "one".into(), expected_revision: 1 },
            "UPDATE quick_notes SET archived = 0, revision = revision + 1 WHERE id = ? AND revision = ?",
            "conflict",
        ).await.unwrap_err();
        assert_eq!(
            serde_json::to_value(conflict).unwrap()["code"],
            "revision_conflict"
        );

        let trashed = revision_mutation(
            &pool,
            &QuickNoteRevisionRequest { id: "one".into(), expected_revision: 2 },
            "UPDATE quick_notes SET trashed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revision = revision + 1 WHERE id = ? AND revision = ?",
            "trash",
        ).await.unwrap();
        assert!(trashed.trashed_at.is_some());
        let restored = revision_mutation(
            &pool,
            &QuickNoteRevisionRequest { id: "one".into(), expected_revision: 3 },
            "UPDATE quick_notes SET trashed_at = NULL, revision = revision + 1 WHERE id = ? AND revision = ?",
            "restore",
        ).await.unwrap();
        assert!(restored.archived);
        assert!(restored.trashed_at.is_none());
    });
}

#[test]
fn list_cursor_preserves_pinned_then_manual_order() {
    tauri::async_runtime::block_on(async {
        let pool = pool().await;
        for id in ["a", "b", "c"] {
            create(&pool, id, id, id).await;
        }
        sqlx::query("UPDATE quick_notes SET pinned = 1 WHERE id = 'b'")
            .execute(&pool)
            .await
            .unwrap();
        let first = list_window_from_pool(
            &pool,
            QuickNotesListRequest {
                collection: QuickNotesCollection::Active,
                query: None,
                tag_id: None,
                cursor: None,
                page_size: Some(2),
            },
        )
        .await
        .unwrap();
        assert_eq!(first.notes[0].id, "b");
        assert!(first.next_cursor.is_some());
        let second = list_window_from_pool(
            &pool,
            QuickNotesListRequest {
                collection: QuickNotesCollection::Active,
                query: None,
                tag_id: None,
                cursor: first.next_cursor,
                page_size: Some(2),
            },
        )
        .await
        .unwrap();
        assert_eq!(second.notes.len(), 1);
        assert!(!first.notes.iter().any(|note| note.id == second.notes[0].id));
    });
}

#[test]
fn reorder_persists_between_adjacent_visible_anchors() {
    tauri::async_runtime::block_on(async {
        let pool = pool().await;
        for (index, id) in ["a", "hidden", "b", "c"].iter().enumerate() {
            create(&pool, id, id, id).await;
            sqlx::query("UPDATE quick_notes SET manual_order = ? WHERE id = ?")
                .bind(index as f64 * 1024.0)
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }
        sqlx::query(
            "INSERT INTO quick_note_tags (id, name, sort_order) VALUES ('tag-1', 'Work', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE quick_notes SET tag_id = 'tag-1' WHERE id IN ('a', 'b', 'c')")
            .execute(&pool)
            .await
            .unwrap();

        reorder_from_pool(
            &pool,
            QuickNoteReorderRequest {
                id: "c".into(),
                previous_id: Some("a".into()),
                next_id: Some("b".into()),
                tag_id: Some("tag-1".into()),
            },
        )
        .await
        .unwrap();

        let tagged = list_window_from_pool(
            &pool,
            QuickNotesListRequest {
                collection: QuickNotesCollection::Active,
                query: None,
                tag_id: Some("tag-1".into()),
                cursor: None,
                page_size: Some(60),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            tagged
                .notes
                .iter()
                .map(|note| note.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "c", "b"]
        );
        assert_eq!(load_note_from_pool(&pool, "c").await.unwrap().revision, 1);
    });
}

#[test]
fn reorder_rejects_nonadjacent_filtered_anchors() {
    tauri::async_runtime::block_on(async {
        let pool = pool().await;
        for (index, id) in ["a", "b", "c", "d"].iter().enumerate() {
            create(&pool, id, id, id).await;
            sqlx::query("UPDATE quick_notes SET manual_order = ? WHERE id = ?")
                .bind(index as f64 * 1024.0)
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }
        let result = reorder_from_pool(
            &pool,
            QuickNoteReorderRequest {
                id: "d".into(),
                previous_id: Some("a".into()),
                next_id: Some("c".into()),
                tag_id: None,
            },
        )
        .await;
        assert!(result.is_err());
    });
}

#[test]
fn expired_trash_is_deleted_with_its_runs_and_search_projection() {
    tauri::async_runtime::block_on(async {
        let pool = pool().await;
        create(&pool, "expired", "Expired", "old body").await;
        sqlx::query("UPDATE quick_notes SET trashed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days') WHERE id = 'expired'")
            .execute(&pool).await.unwrap();
        assert_eq!(cleanup_expired_trash(&pool).await.unwrap(), 1);
        let runs: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM quick_note_text_runs WHERE note_id = 'expired'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let search: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM quick_notes_search_fts WHERE note_id = 'expired'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(runs, 0);
        assert_eq!(search, 0);
    });
}

#[test]
fn tag_filtering_and_deletion_preserve_revision_safety() {
    tauri::async_runtime::block_on(async {
        let pool = pool().await;
        create(&pool, "tagged", "Tagged", "tagged body").await;
        create(&pool, "plain", "Plain", "plain body").await;
        sqlx::query(
            "INSERT INTO quick_note_tags (id, name, sort_order) VALUES ('tag-1', 'Work', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE quick_notes SET tag_id = 'tag-1' WHERE id = 'tagged'")
            .execute(&pool)
            .await
            .unwrap();

        let tagged = list_window_from_pool(
            &pool,
            QuickNotesListRequest {
                collection: QuickNotesCollection::Active,
                query: None,
                tag_id: Some("tag-1".into()),
                cursor: None,
                page_size: Some(60),
            },
        )
        .await
        .unwrap();
        assert_eq!(tagged.notes.len(), 1);
        assert_eq!(tagged.notes[0].id, "tagged");

        delete_tag_from_pool(&pool, "tag-1").await.unwrap();
        let note = load_note_from_pool(&pool, "tagged").await.unwrap();
        assert_eq!(note.tag_id, None);
        assert_eq!(note.revision, 2);
        assert!(delete_tag_from_pool(&pool, "tag-1").await.is_err());
    });
}
