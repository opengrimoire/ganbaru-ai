use super::helpers::*;

#[test]
fn create_child_page_from_block_moves_nested_children_and_syncs_page_state() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        create_page(&pool, PAGE_A, BLOCK_A).await;
        writes::append_block_children(
            &pool,
            NoteAppendBlockChildren {
                parent: page_parent(PAGE_A),
                after: Some(BLOCK_A.to_string()),
                children: vec![block(BLOCK_B, "paragraph", paragraph_payload("Project"))],
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
                    BLOCK_C,
                    "paragraph",
                    paragraph_payload("Nested detail"),
                )],
            },
        )
        .await
        .unwrap();

        writes::create_child_page_from_block(
            &pool,
            BLOCK_B,
            NoteChildPageFromBlockCreate {
                first_block_id: BLOCK_D.to_string(),
                title: None,
                properties: None,
            },
        )
        .await
        .unwrap();

        let parent_block = reads::get_block(&pool, BLOCK_B, false).await.unwrap();
        let parent_json = serde_json::to_value(parent_block).unwrap();
        assert_eq!(parent_json["type"], "child_page");
        assert_eq!(parent_json["child_page"]["title"], "Project");
        assert_eq!(parent_json["has_children"], false);

        let child_page = reads::get_page(&pool, BLOCK_B, false).await.unwrap();
        let child_page_json = serde_json::to_value(child_page).unwrap();
        assert_eq!(child_page_json["parent"]["page_id"], PAGE_A);

        let child_blocks = reads::get_block_children(&pool, BLOCK_B, None, Some(10))
            .await
            .unwrap();
        let child_blocks_json = serde_json::to_value(child_blocks).unwrap();
        assert_eq!(child_blocks_json["results"][0]["id"], BLOCK_C);
        assert_eq!(
            child_blocks_json["results"][0]["paragraph"]["rich_text"][0]["plain_text"],
            "Nested detail"
        );

        writes::update_page(
            &pool,
            BLOCK_B,
            NotePageUpdate {
                title: Some("Renamed child".to_string()),
                parent: None,
                properties: None,
                icon: OptionalJsonValue::Unset,
                cover: OptionalJsonValue::Unset,
            },
        )
        .await
        .unwrap();
        let renamed_block = reads::get_block(&pool, BLOCK_B, false).await.unwrap();
        let renamed_json = serde_json::to_value(renamed_block).unwrap();
        assert_eq!(renamed_json["child_page"]["title"], "Renamed child");

        writes::move_block(
            &pool,
            BLOCK_B,
            NoteMoveBlock {
                parent: block_parent(BLOCK_A),
                after: None,
                before: None,
            },
        )
        .await
        .unwrap();
        let moved_child_page = reads::get_page(&pool, BLOCK_B, false).await.unwrap();
        let moved_child_page_json = serde_json::to_value(moved_child_page).unwrap();
        assert_eq!(moved_child_page_json["parent"]["block_id"], BLOCK_A);

        writes::trash_page(&pool, BLOCK_B, true).await.unwrap();
        assert!(reads::get_block(&pool, BLOCK_B, false).await.is_err());
        writes::trash_page(&pool, BLOCK_B, false).await.unwrap();
        assert_eq!(
            serde_json::to_value(reads::get_block(&pool, BLOCK_B, false).await.unwrap()).unwrap()["type"],
            "child_page"
        );
    });
}

#[test]
fn duplicate_block_rejects_child_page_blocks_until_page_duplication_exists() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        create_page(&pool, PAGE_A, BLOCK_A).await;
        writes::create_page(
            &pool,
            NotePageCreate {
                id: PAGE_B.to_string(),
                title: "Nested page".to_string(),
                parent: page_parent(PAGE_A),
                folder_id: None,
                first_block_id: BLOCK_B.to_string(),
                after_block_id: Some(BLOCK_A.to_string()),
                properties: None,
            },
        )
        .await
        .unwrap();

        let result = writes::duplicate_block(
            &pool,
            PAGE_B,
            NoteDuplicateBlock {
                duplicated_block_ids: vec![NoteDuplicatedBlockId {
                    source_id: PAGE_B.to_string(),
                    duplicate_id: BLOCK_C.to_string(),
                }],
            },
        )
        .await;

        assert_eq!(
            result.err(),
            Some("child_page blocks must be duplicated through page duplication".to_string())
        );
    });
}

#[test]
fn duplicate_blocks_copies_loaded_subtrees_and_block_comments() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        create_page(&pool, PAGE_A, BLOCK_A).await;
        writes::append_block_children(
            &pool,
            NoteAppendBlockChildren {
                parent: page_parent(PAGE_A),
                after: Some(BLOCK_A.to_string()),
                children: vec![block(BLOCK_B, "paragraph", paragraph_payload("Parent"))],
            },
        )
        .await
        .unwrap();
        writes::append_block_children(
            &pool,
            NoteAppendBlockChildren {
                parent: block_parent(BLOCK_B),
                after: None,
                children: vec![block(BLOCK_C, "paragraph", paragraph_payload("Nested"))],
            },
        )
        .await
        .unwrap();
        comments::create_comment(
            &pool,
            NoteCommentCreate {
                id: COMMENT_A.to_string(),
                parent: Some(block_parent(BLOCK_C)),
                discussion_id: None,
                anchor: None,
                rich_text: vec![rich_text("Nested comment")],
                attachments: None,
            },
        )
        .await
        .unwrap();

        let duplicated = writes::duplicate_blocks(
            &pool,
            NoteDuplicateBlocks {
                block_ids: vec![BLOCK_B.to_string()],
                duplicated_block_ids: vec![
                    NoteDuplicatedBlockId {
                        source_id: BLOCK_B.to_string(),
                        duplicate_id: BLOCK_D.to_string(),
                    },
                    NoteDuplicatedBlockId {
                        source_id: BLOCK_C.to_string(),
                        duplicate_id: BLOCK_E.to_string(),
                    },
                ],
                parent: page_parent(PAGE_A),
                after: Some(BLOCK_B.to_string()),
                before: None,
                include_trashed_sources: None,
            },
        )
        .await
        .unwrap();
        let duplicated_json = serde_json::to_value(duplicated).unwrap();
        assert_eq!(duplicated_json["results"][0]["id"], BLOCK_D);
        assert_eq!(duplicated_json["results"][1]["id"], BLOCK_E);

        let duplicated_children = reads::get_block_children(&pool, BLOCK_D, None, Some(10))
            .await
            .unwrap();
        let duplicated_children_json = serde_json::to_value(duplicated_children).unwrap();
        assert_eq!(duplicated_children_json["results"][0]["id"], BLOCK_E);
        assert_eq!(
            duplicated_children_json["results"][0]["paragraph"]["rich_text"][0]["plain_text"],
            "Nested"
        );

        let threads = comments::list_comments(&pool, PAGE_A, false).await.unwrap();
        let threads_json = serde_json::to_value(threads).unwrap();
        assert!(threads_json.as_array().unwrap().iter().any(|thread| {
            thread["parent"]["block_id"] == BLOCK_E
                && thread["comments"][0]["rich_text"][0]["plain_text"] == "Nested comment"
        }));
    });
}

#[test]
fn move_blocks_moves_subtrees_updates_comment_pages_and_rejects_cycles() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        create_page(&pool, PAGE_A, BLOCK_A).await;
        writes::create_page(
            &pool,
            NotePageCreate {
                id: PAGE_B.to_string(),
                title: "Destination".to_string(),
                parent: workspace_parent(),
                folder_id: None,
                first_block_id: BLOCK_F.to_string(),
                after_block_id: None,
                properties: None,
            },
        )
        .await
        .unwrap();
        writes::append_block_children(
            &pool,
            NoteAppendBlockChildren {
                parent: page_parent(PAGE_A),
                after: Some(BLOCK_A.to_string()),
                children: vec![block(BLOCK_B, "paragraph", paragraph_payload("Parent"))],
            },
        )
        .await
        .unwrap();
        writes::append_block_children(
            &pool,
            NoteAppendBlockChildren {
                parent: block_parent(BLOCK_B),
                after: None,
                children: vec![block(BLOCK_C, "paragraph", paragraph_payload("Nested"))],
            },
        )
        .await
        .unwrap();
        comments::create_comment(
            &pool,
            NoteCommentCreate {
                id: COMMENT_A.to_string(),
                parent: Some(block_parent(BLOCK_C)),
                discussion_id: None,
                anchor: None,
                rich_text: vec![rich_text("Move with block")],
                attachments: None,
            },
        )
        .await
        .unwrap();

        let cycle = writes::move_blocks(
            &pool,
            NoteMoveBlocks {
                block_ids: vec![BLOCK_B.to_string()],
                parent: block_parent(BLOCK_C),
                after: None,
                before: None,
            },
        )
        .await;
        assert_eq!(
            cycle.err(),
            Some("block cannot be moved under its descendant".to_string())
        );

        writes::move_blocks(
            &pool,
            NoteMoveBlocks {
                block_ids: vec![BLOCK_B.to_string()],
                parent: page_parent(PAGE_B),
                after: Some(BLOCK_F.to_string()),
                before: None,
            },
        )
        .await
        .unwrap();

        let destination_children = reads::get_block_children(&pool, PAGE_B, None, Some(10))
            .await
            .unwrap();
        let destination_children_json = serde_json::to_value(destination_children).unwrap();
        assert_eq!(destination_children_json["results"][1]["id"], BLOCK_B);
        let moved_nested = reads::get_block(&pool, BLOCK_C, false).await.unwrap();
        let moved_nested_json = serde_json::to_value(moved_nested).unwrap();
        assert_eq!(moved_nested_json["parent"]["block_id"], BLOCK_B);

        let source_threads = comments::list_comments(&pool, PAGE_A, false).await.unwrap();
        assert!(
            serde_json::to_value(source_threads)
                .unwrap()
                .as_array()
                .unwrap()
                .is_empty()
        );
        let destination_threads = comments::list_comments(&pool, PAGE_B, false).await.unwrap();
        let destination_threads_json = serde_json::to_value(destination_threads).unwrap();
        assert_eq!(destination_threads_json[0]["parent"]["block_id"], BLOCK_C);
        assert_eq!(
            destination_threads_json[0]["comments"][0]["rich_text"][0]["plain_text"],
            "Move with block"
        );
    });
}

#[test]
fn trash_blocks_trashes_selected_roots_and_loaded_descendants_once() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        create_page(&pool, PAGE_A, BLOCK_A).await;
        writes::append_block_children(
            &pool,
            NoteAppendBlockChildren {
                parent: page_parent(PAGE_A),
                after: Some(BLOCK_A.to_string()),
                children: vec![block(BLOCK_B, "paragraph", paragraph_payload("Parent"))],
            },
        )
        .await
        .unwrap();
        writes::append_block_children(
            &pool,
            NoteAppendBlockChildren {
                parent: block_parent(BLOCK_B),
                after: None,
                children: vec![block(BLOCK_C, "paragraph", paragraph_payload("Nested"))],
            },
        )
        .await
        .unwrap();

        writes::trash_blocks(
            &pool,
            NoteTrashBlocks {
                block_ids: vec![BLOCK_B.to_string(), BLOCK_C.to_string()],
                in_trash: Some(true),
            },
        )
        .await
        .unwrap();

        assert!(reads::get_block(&pool, BLOCK_B, false).await.is_err());
        assert!(reads::get_block(&pool, BLOCK_C, false).await.is_err());
        let trashed_parent =
            serde_json::to_value(reads::get_block(&pool, BLOCK_B, true).await.unwrap()).unwrap();
        let trashed_child =
            serde_json::to_value(reads::get_block(&pool, BLOCK_C, true).await.unwrap()).unwrap();
        assert_eq!(trashed_parent["in_trash"], true);
        assert_eq!(trashed_child["in_trash"], true);
    });
}
