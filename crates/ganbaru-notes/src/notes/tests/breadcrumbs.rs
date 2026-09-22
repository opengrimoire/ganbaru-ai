use super::helpers::*;

#[test]
fn page_open_returns_visible_chrome_and_top_level_blocks_only() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        create_page(&pool, PAGE_A, BLOCK_A).await;
        writes::append_block_children(
            &pool,
            NoteAppendBlockChildren {
                parent: block_parent(BLOCK_A),
                after: None,
                children: vec![block(BLOCK_B, "paragraph", paragraph_payload("Nested"))],
            },
        )
        .await
        .unwrap();

        let opened = serde_json::to_value(reads::open_page(&pool, PAGE_A).await.unwrap()).unwrap();

        assert_eq!(opened["page"]["id"], PAGE_A);
        assert_eq!(opened["breadcrumb"][0]["id"], PAGE_A);
        assert_eq!(opened["blocks"]["results"].as_array().unwrap().len(), 1);
        assert_eq!(opened["blocks"]["results"][0]["id"], BLOCK_A);
        assert_eq!(opened["outlines"][0]["id"], BLOCK_A);
        assert_eq!(opened["outlines"][0]["retained_height"], 36);
        assert!(
            opened["blocks"]["results"]
                .as_array()
                .unwrap()
                .iter()
                .all(|block| block["id"] != BLOCK_B)
        );
    });
}

#[test]
fn block_frontier_batches_children_for_multiple_parents() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        create_page(&pool, PAGE_A, BLOCK_A).await;
        writes::append_block_children(
            &pool,
            NoteAppendBlockChildren {
                parent: page_parent(PAGE_A),
                after: Some(BLOCK_A.to_string()),
                children: vec![block(BLOCK_B, "toggle", paragraph_payload("Second"))],
            },
        )
        .await
        .unwrap();
        writes::append_block_children(
            &pool,
            NoteAppendBlockChildren {
                parent: block_parent(BLOCK_A),
                after: None,
                children: vec![block(
                    BLOCK_C,
                    "paragraph",
                    paragraph_payload("First child"),
                )],
            },
        )
        .await
        .unwrap();
        writes::append_block_children(
            &pool,
            NoteAppendBlockChildren {
                parent: block_parent(BLOCK_B),
                after: None,
                children: vec![block(
                    BLOCK_D,
                    "paragraph",
                    paragraph_payload("Second child"),
                )],
            },
        )
        .await
        .unwrap();

        let frontier =
            reads::get_block_frontier(&pool, &[BLOCK_A.to_string(), BLOCK_B.to_string()])
                .await
                .unwrap();
        let json = serde_json::to_value(frontier).unwrap();
        let ids = json["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|block| block["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec![BLOCK_C, BLOCK_D]);

        let outlines = reads::get_block_outline_frontier(
            &pool,
            PAGE_A,
            &[BLOCK_A.to_string(), BLOCK_B.to_string()],
        )
        .await
        .unwrap();
        let outline_json = serde_json::to_value(outlines).unwrap();
        assert_eq!(outline_json[0]["id"], BLOCK_C);
        assert!(outline_json[0].get("paragraph").is_none());

        let hydrated = reads::hydrate_blocks(
            &pool,
            NoteBlockHydrationRequest {
                page_id: PAGE_A.to_string(),
                block_ids: vec![BLOCK_D.to_string()],
            },
        )
        .await
        .unwrap();
        let hydrated_json = serde_json::to_value(hydrated).unwrap();
        assert_eq!(hydrated_json.as_array().unwrap().len(), 1);
        assert_eq!(hydrated_json[0]["id"], BLOCK_D);
        assert_eq!(
            hydrated_json[0]["paragraph"]["rich_text"][0]["plain_text"],
            "Second child"
        );
    });
}

#[test]
fn page_breadcrumb_resolves_unloaded_ancestor_rows() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        writes::create_page(
            &pool,
            NotePageCreate {
                id: PAGE_A.to_string(),
                title: "Root".to_string(),
                parent: workspace_parent(),
                folder_id: None,
                first_block_id: BLOCK_A.to_string(),
                after_block_id: None,
                properties: None,
            },
        )
        .await
        .unwrap();
        writes::create_page(
            &pool,
            NotePageCreate {
                id: PAGE_B.to_string(),
                title: "Child".to_string(),
                parent: page_parent(PAGE_A),
                folder_id: None,
                first_block_id: BLOCK_B.to_string(),
                after_block_id: None,
                properties: None,
            },
        )
        .await
        .unwrap();
        writes::create_page(
            &pool,
            NotePageCreate {
                id: PAGE_C.to_string(),
                title: "Leaf".to_string(),
                parent: page_parent(PAGE_B),
                folder_id: None,
                first_block_id: BLOCK_C.to_string(),
                after_block_id: None,
                properties: None,
            },
        )
        .await
        .unwrap();

        let breadcrumb = reads::get_page_breadcrumb(&pool, PAGE_C).await.unwrap();
        let breadcrumb_json = serde_json::to_value(breadcrumb).unwrap();
        assert_eq!(breadcrumb_json.as_array().unwrap().len(), 3);
        assert_eq!(breadcrumb_json[0]["id"], PAGE_A);
        assert_eq!(breadcrumb_json[0]["status"], "active");
        assert_eq!(breadcrumb_json[1]["id"], PAGE_B);
        assert_eq!(breadcrumb_json[1]["status"], "active");
        assert_eq!(breadcrumb_json[2]["id"], PAGE_C);
        assert_eq!(breadcrumb_json[2]["current"], true);
    });
}

#[test]
fn page_breadcrumb_marks_unavailable_ancestors() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        writes::create_page(
            &pool,
            NotePageCreate {
                id: PAGE_A.to_string(),
                title: "Archived root".to_string(),
                parent: workspace_parent(),
                folder_id: None,
                first_block_id: BLOCK_A.to_string(),
                after_block_id: None,
                properties: None,
            },
        )
        .await
        .unwrap();
        writes::create_page(
            &pool,
            NotePageCreate {
                id: PAGE_B.to_string(),
                title: "Trashed child".to_string(),
                parent: page_parent(PAGE_A),
                folder_id: None,
                first_block_id: BLOCK_B.to_string(),
                after_block_id: None,
                properties: None,
            },
        )
        .await
        .unwrap();
        writes::create_page(
            &pool,
            NotePageCreate {
                id: PAGE_C.to_string(),
                title: "Leaf".to_string(),
                parent: page_parent(PAGE_B),
                folder_id: None,
                first_block_id: BLOCK_C.to_string(),
                after_block_id: None,
                properties: None,
            },
        )
        .await
        .unwrap();
        sqlx::query("UPDATE notes_pages SET archived = 1 WHERE id = ?")
            .bind(PAGE_A)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE notes_pages SET in_trash = 1 WHERE id = ?")
            .bind(PAGE_B)
            .execute(&pool)
            .await
            .unwrap();

        let breadcrumb = reads::get_page_breadcrumb(&pool, PAGE_C).await.unwrap();
        let breadcrumb_json = serde_json::to_value(breadcrumb).unwrap();
        assert_eq!(breadcrumb_json[0]["id"], PAGE_A);
        assert_eq!(breadcrumb_json[0]["status"], "archived");
        assert_eq!(breadcrumb_json[1]["id"], PAGE_B);
        assert_eq!(breadcrumb_json[1]["status"], "trashed");
        assert_eq!(breadcrumb_json[2]["id"], PAGE_C);
        assert_eq!(breadcrumb_json[2]["status"], "active");
    });
}

#[test]
fn page_breadcrumb_marks_missing_ancestor_rows() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        create_page(&pool, PAGE_A, BLOCK_A).await;
        sqlx::raw_sql("PRAGMA foreign_keys=OFF")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE notes_pages
             SET parent_type = 'page_id', parent_page_id = ?
             WHERE id = ?",
        )
        .bind(PAGE_B)
        .bind(PAGE_A)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql("PRAGMA foreign_keys=ON")
            .execute(&pool)
            .await
            .unwrap();

        let breadcrumb = reads::get_page_breadcrumb(&pool, PAGE_A).await.unwrap();
        let breadcrumb_json = serde_json::to_value(breadcrumb).unwrap();
        assert_eq!(breadcrumb_json.as_array().unwrap().len(), 2);
        assert_eq!(breadcrumb_json[0]["id"], PAGE_B);
        assert_eq!(breadcrumb_json[0]["status"], "missing");
        assert_eq!(breadcrumb_json[1]["id"], PAGE_A);
        assert_eq!(breadcrumb_json[1]["current"], true);
    });
}
