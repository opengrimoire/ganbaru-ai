mod calendar;
mod chat;
mod core;
mod doomscrolling;
mod helpers;
mod music;
mod notes;
mod pomodoro;
mod projects;
mod query_plans;
mod quick_notes;

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("database test runtime should initialize")
        .block_on(future)
}

#[test]
fn migration_set_identity_is_stable_and_nonempty() {
    let first = crate::migration_set_identity_material();
    assert!(!first.is_empty());
    assert_eq!(first, crate::migration_set_identity_material());
}

#[test]
fn pool_registry_reuses_and_closes_authorized_path() {
    block_on(async {
        let directory = std::env::temp_dir().join(format!(
            "ganbaru-db-registry-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("ganbaru-ai.sqlite");
        let registry = crate::DatabasePoolRegistry::default();

        let first = registry.connect_path(&path).await.unwrap();
        for (pragma, expected) in [
            ("synchronous", 2_i64),
            ("foreign_keys", 1),
            ("busy_timeout", 5_000),
        ] {
            let value: i64 = sqlx::query_scalar(&format!("PRAGMA {pragma}"))
                .fetch_one(&first)
                .await
                .unwrap();
            assert_eq!(
                value, expected,
                "authoritative connection must configure {pragma}"
            );
        }
        let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&first)
            .await
            .unwrap();
        assert_eq!(mode, "wal");
        // Evict the connection to verify that pool replacement retains the durable options.
        first.acquire().await.unwrap().close().await.unwrap();
        let synchronous: i64 = sqlx::query_scalar("PRAGMA synchronous")
            .fetch_one(&first)
            .await
            .unwrap();
        assert_eq!(synchronous, 2);
        sqlx::query("CREATE TABLE registry_test (value TEXT NOT NULL)")
            .execute(&first)
            .await
            .unwrap();
        let second = registry.connect_path(&path).await.unwrap();
        let table_exists: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'registry_test')",
        )
        .fetch_one(&second)
        .await
        .unwrap();
        assert_eq!(table_exists, 1);

        registry.close_path(&path).await.unwrap();
        assert!(first.is_closed());
        assert!(second.is_closed());
        registry.close_all().await.unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    });
}

#[test]
fn read_only_pool_rejects_writes_and_mode_reuse() {
    block_on(async {
        let directory = std::env::temp_dir().join(format!(
            "ganbaru-db-read-only-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("ganbaru-ai.sqlite");
        let registry = crate::DatabasePoolRegistry::default();
        let writable = registry.connect_path(&path).await.unwrap();
        sqlx::query("CREATE TABLE access_test (value TEXT NOT NULL)")
            .execute(&writable)
            .await
            .unwrap();
        registry.close_all().await.unwrap();

        let read_only = registry.connect_path_read_only(&path).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM access_test")
            .fetch_one(&read_only)
            .await
            .unwrap();
        assert_eq!(count, 0);
        assert!(
            sqlx::query("INSERT INTO access_test (value) VALUES ('blocked')")
                .execute(&read_only)
                .await
                .is_err()
        );
        assert!(registry.connect_path(&path).await.is_err());

        registry.close_all().await.unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    });
}

#[test]
fn current_schema_validation_rejects_changed_migration_history() {
    block_on(async {
        let directory = std::env::temp_dir().join(format!(
            "ganbaru-db-schema-validation-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("ganbaru-ai.sqlite");
        let registry = crate::DatabasePoolRegistry::default();
        let pool = registry.connect_path(&path).await.unwrap();
        crate::validate_current_schema(&pool).await.unwrap();

        sqlx::query(
            "UPDATE _sqlx_migrations SET checksum = X'00'
             WHERE version = (SELECT MAX(version) FROM _sqlx_migrations)",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            crate::validate_current_schema(&pool)
                .await
                .unwrap_err()
                .contains("incompatible")
        );

        registry.close_all().await.unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    });
}
