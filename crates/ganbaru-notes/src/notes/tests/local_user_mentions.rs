use super::helpers::*;

#[test]
fn local_user_identity_drives_notes_comments() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        create_page(&pool, PAGE_A, BLOCK_A).await;

        let local_user_json =
            serde_json::to_value(local_user::get_local_user(&pool).await.unwrap()).unwrap();
        let local_user_id = local_user_json["id"].as_str().unwrap().to_string();
        assert_ne!(local_user_id, "local-user");
        assert_eq!(local_user_json["display_name"], "You");

        let thread = comments::create_comment(
            &pool,
            NoteCommentCreate {
                id: COMMENT_A.to_string(),
                parent: Some(page_parent(PAGE_A)),
                discussion_id: None,
                anchor: None,
                rich_text: vec![rich_text("Page note")],
                attachments: None,
            },
        )
        .await
        .unwrap();
        let thread_value = serde_json::to_value(thread).unwrap();
        let thread_id = thread_value["id"].as_str().unwrap().to_string();
        assert_eq!(
            thread_value["comments"][0]["created_by"]["id"],
            local_user_id
        );
        assert_eq!(
            thread_value["comments"][0]["display_name"]["resolved_name"],
            "You"
        );

        let updated_user = local_user::update_local_user(
            &pool,
            NoteLocalUserUpdate {
                display_name: "Victor".to_string(),
            },
        )
        .await
        .unwrap();
        let updated_user_json = serde_json::to_value(updated_user).unwrap();
        assert_eq!(updated_user_json["id"], local_user_id);
        assert_eq!(updated_user_json["display_name"], "Victor");

        let listed = comments::list_comments(&pool, PAGE_A, false).await.unwrap();
        let listed_json = serde_json::to_value(listed).unwrap();
        assert_eq!(
            listed_json[0]["comments"][0]["display_name"]["resolved_name"],
            "Victor"
        );

        let replied = comments::create_comment(
            &pool,
            NoteCommentCreate {
                id: COMMENT_B.to_string(),
                parent: None,
                discussion_id: Some(thread_id.clone()),
                anchor: None,
                rich_text: vec![rich_text("Reply")],
                attachments: None,
            },
        )
        .await
        .unwrap();
        let replied_value = serde_json::to_value(replied).unwrap();
        assert_eq!(
            replied_value["comments"][1]["display_name"]["resolved_name"],
            "Victor"
        );

        let resolved = comments::resolve_comment_thread(&pool, &thread_id, true)
            .await
            .unwrap();
        let resolved_value = serde_json::to_value(resolved).unwrap();
        assert_eq!(resolved_value["resolved_by"]["id"], local_user_id);

        assert_eq!(
            local_user::update_local_user(
                &pool,
                NoteLocalUserUpdate {
                    display_name: " ".to_string(),
                },
            )
            .await
            .err()
            .as_deref(),
            Some("display_name is required")
        );
    });
}

#[test]
fn mention_notifications_sync_blocks_comments_and_delivery_state() {
    crate::test_block_on(async {
        let pool = migrated_memory_pool().await;
        create_page(&pool, PAGE_A, BLOCK_A).await;

        let local_user_json =
            serde_json::to_value(local_user::get_local_user(&pool).await.unwrap()).unwrap();
        let local_user_id = local_user_json["id"].as_str().unwrap().to_string();

        writes::update_block(
            &pool,
            BLOCK_A,
            block_update(
                "paragraph",
                json!({
                    "rich_text": [
                        rich_text("Plan "),
                        date_mention("2026-07-05", "Sunday", true),
                        rich_text(" with "),
                        user_mention(&local_user_id, "Victor"),
                        rich_text(" on "),
                        project_task_mention(BLOCK_B, "Task")
                    ],
                    "color": "default"
                }),
            ),
        )
        .await
        .unwrap();
        comments::create_comment(
            &pool,
            NoteCommentCreate {
                id: COMMENT_A.to_string(),
                parent: Some(page_parent(PAGE_A)),
                discussion_id: None,
                anchor: None,
                rich_text: vec![rich_text("Ping "), user_mention(&local_user_id, "Victor")],
                attachments: None,
            },
        )
        .await
        .unwrap();

        let pending = mention_notifications::list_pending(&pool).await.unwrap();
        let pending_json = serde_json::to_value(&pending).unwrap();
        let mut kinds = pending_json
            .as_array()
            .unwrap()
            .iter()
            .map(|notification| notification["kind"].as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        kinds.sort();
        assert_eq!(
            kinds,
            vec![
                "reminder".to_string(),
                "task_mention".to_string(),
                "user_mention".to_string(),
                "user_mention".to_string(),
            ]
        );
        assert!(pending_json.as_array().unwrap().iter().any(|notification| {
            notification["source_type"] == "comment"
                && notification["comment_id"] == COMMENT_A
                && notification["page_title"] == "First page"
        }));

        let reminder_id = pending_json
            .as_array()
            .unwrap()
            .iter()
            .find(|notification| notification["kind"] == "reminder")
            .and_then(|notification| notification["id"].as_str())
            .unwrap()
            .to_string();
        let after_delivery = mention_notifications::mark_delivered(
            &pool,
            NoteMentionNotificationDeliveryUpdate {
                ids: vec![reminder_id.clone()],
            },
        )
        .await
        .unwrap();
        let after_delivery_json = serde_json::to_value(&after_delivery).unwrap();
        assert!(
            !after_delivery_json
                .as_array()
                .unwrap()
                .iter()
                .any(|notification| notification["id"] == reminder_id)
        );

        writes::update_block(
            &pool,
            BLOCK_A,
            block_update("paragraph", paragraph_payload("No mentions")),
        )
        .await
        .unwrap();
        let after_block_clear =
            serde_json::to_value(mention_notifications::list_pending(&pool).await.unwrap())
                .unwrap();
        assert_eq!(after_block_clear.as_array().unwrap().len(), 1);
        assert_eq!(after_block_clear[0]["source_type"], "comment");
    });
}
