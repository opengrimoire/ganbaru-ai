use super::*;

#[test]
fn project_restore_removes_later_notes_and_keeps_a_safety_version() {
    crate::test_block_on(async {
        let pool = migrated_pool().await;
        seed_project(&pool).await;
        let baseline =
            create_checkpoint(&pool, PROJECT_ID, "baseline", None, None, "Initial version")
                .await
                .unwrap()
                .unwrap();
        insert_project_page(&pool, LATER_PAGE_ID, LATER_BLOCK_ID, "Later note").await;
        restore::restore_version(&pool, PROJECT_ID, &baseline.id)
            .await
            .unwrap();
        let later_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notes_pages WHERE id = ?")
            .bind(LATER_PAGE_ID)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(later_exists, 0);
        let versions: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM notes_project_history_versions WHERE project_id = ?",
        )
        .bind(PROJECT_ID)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(versions >= 3);
    });
}
