//! Device-local Doomscrolling usage spool and linked-device accounting cache.

use crate::vault::handoff::protocol::{DoomscrollingSampleMessage, MAX_DOOMSCROLLING_SAMPLES};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};

const SPOOL_FILE: &str = "doomscrolling-device-spool.sqlite";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const MAX_PENDING_SAMPLES: i64 = 4_000;
const EXCHANGE_BATCH_SAMPLES: i64 = 200;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LinkedUsageRow {
    pub id: String,
    pub source_type: String,
    pub source_key: String,
    pub display_name: Option<String>,
    pub started_at: i64,
    pub elapsed_seconds: i64,
    pub local_date: String,
    pub created_at: i64,
}

pub(crate) fn spool_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(SPOOL_FILE))
        .map_err(|error| format!("find Doomscrolling spool directory: {error}"))
}

async fn open_spool(path: &Path) -> Result<SqlitePool, String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("create Doomscrolling spool directory: {error}"))?;
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .busy_timeout(std::time::Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("open Doomscrolling spool: {error}"))?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS pending_usage_samples (
            sample_id TEXT PRIMARY KEY,
            vault_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_key TEXT NOT NULL,
            display_name TEXT,
            started_at INTEGER NOT NULL,
            elapsed_seconds INTEGER NOT NULL,
            local_date TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|error| format!("initialize Doomscrolling spool: {error}"))?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS accepted_usage_samples (
            sample_id TEXT PRIMARY KEY,
            vault_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_key TEXT NOT NULL,
            display_name TEXT,
            started_at INTEGER NOT NULL,
            elapsed_seconds INTEGER NOT NULL,
            local_date TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(&pool)
    .await
    .map_err(|error| format!("initialize accepted Doomscrolling cache: {error}"))?;
    Ok(pool)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) async fn enqueue<R: Runtime>(
    app: &tauri::AppHandle<R>,
    vault_id: &str,
    device_id: &str,
    sample: &LinkedUsageRow,
) -> Result<(), String> {
    enqueue_at(
        &spool_path(app)?,
        vault_id,
        device_id,
        &row_to_message(sample, device_id),
    )
    .await
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn enqueue_at(
    path: &Path,
    vault_id: &str,
    device_id: &str,
    sample: &DoomscrollingSampleMessage,
) -> Result<(), String> {
    let pool = open_spool(path).await?;
    let mut count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pending_usage_samples WHERE vault_id = ? AND device_id = ?",
    )
    .bind(vault_id)
    .bind(device_id)
    .fetch_one(&pool)
    .await
    .map_err(|error| format!("count pending Doomscrolling samples: {error}"))?;
    if count >= MAX_PENDING_SAMPLES {
        compact_pending(&pool, vault_id, device_id).await?;
        count = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pending_usage_samples WHERE vault_id = ? AND device_id = ?",
        )
        .bind(vault_id)
        .bind(device_id)
        .fetch_one(&pool)
        .await
        .map_err(|error| format!("count compacted Doomscrolling samples: {error}"))?;
    }
    if count >= MAX_PENDING_SAMPLES {
        pool.close().await;
        return Err("the linked-device Doomscrolling spool is full".to_string());
    }
    insert_message(&pool, "pending_usage_samples", vault_id, sample).await?;
    pool.close().await;
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn compact_pending(pool: &SqlitePool, vault_id: &str, device_id: &str) -> Result<(), String> {
    let rows = sqlx::query(
        "SELECT source_type, source_key, MAX(display_name) AS display_name,
                MIN(started_at) AS started_at, SUM(elapsed_seconds) AS elapsed_seconds,
                local_date, MAX(created_at) AS created_at
         FROM pending_usage_samples
         WHERE vault_id = ? AND device_id = ?
         GROUP BY source_type, source_key, local_date",
    )
    .bind(vault_id)
    .bind(device_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("compact pending Doomscrolling samples: {error}"))?;
    let mut compacted = Vec::new();
    for row in rows {
        let source_type: String = row.try_get("source_type").map_err(|e| e.to_string())?;
        let source_key: String = row.try_get("source_key").map_err(|e| e.to_string())?;
        let display_name: Option<String> =
            row.try_get("display_name").map_err(|e| e.to_string())?;
        let started_at_unix_ms: i64 = row.try_get("started_at").map_err(|e| e.to_string())?;
        let mut elapsed_seconds: i64 = row.try_get("elapsed_seconds").map_err(|e| e.to_string())?;
        let local_date: String = row.try_get("local_date").map_err(|e| e.to_string())?;
        let created_at_unix_ms: i64 = row.try_get("created_at").map_err(|e| e.to_string())?;
        let identity = format!("{device_id}|{source_type}|{source_key}|{local_date}");
        let mut part = 0_u32;
        while elapsed_seconds > 0 {
            compacted.push(DoomscrollingSampleMessage {
                sample_id: format!("compact-{:x}-{part}", Sha256::digest(identity.as_bytes())),
                device_id: device_id.to_string(),
                source_type: source_type.clone(),
                source_key: source_key.clone(),
                display_name: display_name.clone(),
                started_at_unix_ms,
                elapsed_seconds: elapsed_seconds.min(86_400),
                local_date: local_date.clone(),
                created_at_unix_ms,
            });
            elapsed_seconds -= elapsed_seconds.min(86_400);
            part += 1;
        }
    }
    if compacted.len() as i64 >= MAX_PENDING_SAMPLES {
        return Err("the linked-device Doomscrolling spool cannot be compacted safely".to_string());
    }
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("begin Doomscrolling spool compaction: {error}"))?;
    sqlx::query("DELETE FROM pending_usage_samples WHERE vault_id = ? AND device_id = ?")
        .bind(vault_id)
        .bind(device_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("replace compacted Doomscrolling spool: {error}"))?;
    for sample in &compacted {
        insert_message_executor(&mut transaction, "pending_usage_samples", vault_id, sample)
            .await?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("commit Doomscrolling spool compaction: {error}"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) async fn pending<R: Runtime>(
    app: &tauri::AppHandle<R>,
    vault_id: &str,
    device_id: &str,
) -> Result<Vec<DoomscrollingSampleMessage>, String> {
    pending_at(&spool_path(app)?, vault_id, device_id).await
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) async fn drain_local_spool<R: Runtime>(
    app: &tauri::AppHandle<R>,
    pool: &SqlitePool,
    vault_id: &str,
    device_id: &str,
) -> Result<usize, String> {
    let pending = pending(app, vault_id, device_id).await?;
    if pending.is_empty() {
        return Ok(0);
    }
    let acknowledged = import_linked_samples(pool, &pending).await?;
    acknowledge(app, vault_id, device_id, &acknowledged).await?;
    Ok(acknowledged.len())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn pending_at(
    path: &Path,
    vault_id: &str,
    device_id: &str,
) -> Result<Vec<DoomscrollingSampleMessage>, String> {
    let pool = open_spool(path).await?;
    let samples = read_messages(&pool, "pending_usage_samples", vault_id, Some(device_id)).await?;
    pool.close().await;
    Ok(samples)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) async fn acknowledge<R: Runtime>(
    app: &tauri::AppHandle<R>,
    vault_id: &str,
    device_id: &str,
    sample_ids: &[String],
) -> Result<(), String> {
    acknowledge_at(&spool_path(app)?, vault_id, device_id, sample_ids).await
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn acknowledge_at(
    path: &Path,
    vault_id: &str,
    device_id: &str,
    sample_ids: &[String],
) -> Result<(), String> {
    if sample_ids.len() > MAX_DOOMSCROLLING_SAMPLES {
        return Err("too many Doomscrolling sample acknowledgements".to_string());
    }
    let pool = open_spool(path).await?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("begin Doomscrolling acknowledgement: {error}"))?;
    for sample_id in sample_ids {
        sqlx::query(
            "DELETE FROM pending_usage_samples
             WHERE vault_id = ? AND device_id = ? AND sample_id = ?",
        )
        .bind(vault_id)
        .bind(device_id)
        .bind(sample_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("acknowledge Doomscrolling sample: {error}"))?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("commit Doomscrolling acknowledgement: {error}"))?;
    pool.close().await;
    Ok(())
}

pub(crate) async fn replace_accepted<R: Runtime>(
    app: &tauri::AppHandle<R>,
    vault_id: &str,
    samples: &[DoomscrollingSampleMessage],
) -> Result<(), String> {
    replace_accepted_at(&spool_path(app)?, vault_id, samples).await
}

async fn replace_accepted_at(
    path: &Path,
    vault_id: &str,
    samples: &[DoomscrollingSampleMessage],
) -> Result<(), String> {
    if samples.len() > MAX_DOOMSCROLLING_SAMPLES {
        return Err("too many accepted Doomscrolling samples".to_string());
    }
    let pool = open_spool(path).await?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("begin accepted Doomscrolling replacement: {error}"))?;
    sqlx::query("DELETE FROM accepted_usage_samples WHERE vault_id = ?")
        .bind(vault_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("clear accepted Doomscrolling samples: {error}"))?;
    for sample in samples {
        insert_message_executor(&mut transaction, "accepted_usage_samples", vault_id, sample)
            .await?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("commit accepted Doomscrolling replacement: {error}"))?;
    pool.close().await;
    Ok(())
}

pub(crate) async fn accepted<R: Runtime>(
    app: &tauri::AppHandle<R>,
    vault_id: &str,
) -> Result<Vec<DoomscrollingSampleMessage>, String> {
    let pool = open_spool(&spool_path(app)?).await?;
    let samples = read_messages(&pool, "accepted_usage_samples", vault_id, None).await?;
    pool.close().await;
    Ok(samples)
}

pub(crate) async fn import_linked_samples(
    pool: &SqlitePool,
    samples: &[DoomscrollingSampleMessage],
) -> Result<Vec<String>, String> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("begin linked Doomscrolling import: {error}"))?;
    for sample in samples {
        sqlx::query(
            "INSERT OR IGNORE INTO doomscrolling_usage_samples
                (id, source_type, source_key, display_name, started_at,
                 elapsed_seconds, local_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(canonical_sample_id(&sample.device_id, &sample.sample_id))
        .bind(&sample.source_type)
        .bind(&sample.source_key)
        .bind(&sample.display_name)
        .bind(sample.started_at_unix_ms)
        .bind(sample.elapsed_seconds)
        .bind(&sample.local_date)
        .bind(sample.created_at_unix_ms)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("import linked Doomscrolling sample: {error}"))?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("commit linked Doomscrolling import: {error}"))?;
    Ok(samples
        .iter()
        .map(|sample| sample.sample_id.clone())
        .collect())
}

pub(crate) async fn aggregate_owner_samples(
    pool: &SqlitePool,
) -> Result<Vec<DoomscrollingSampleMessage>, String> {
    let rows = sqlx::query(
        "SELECT source_type, source_key, MAX(display_name) AS display_name,
                MIN(started_at) AS started_at, SUM(elapsed_seconds) AS elapsed_seconds,
                local_date, MAX(created_at) AS created_at
         FROM doomscrolling_usage_samples
         WHERE local_date IN (
             SELECT DISTINCT local_date FROM doomscrolling_usage_samples
             ORDER BY local_date DESC LIMIT 8
         )
         GROUP BY source_type, source_key, local_date
         ORDER BY local_date ASC, source_type ASC, source_key ASC
         LIMIT ?",
    )
    .bind((MAX_DOOMSCROLLING_SAMPLES + 1) as i64)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("aggregate linked Doomscrolling usage: {error}"))?;
    let mut samples = Vec::new();
    for row in rows {
        let source_type: String = row.try_get("source_type").map_err(|e| e.to_string())?;
        let source_key: String = row.try_get("source_key").map_err(|e| e.to_string())?;
        let local_date: String = row.try_get("local_date").map_err(|e| e.to_string())?;
        let mut elapsed_seconds: i64 = row
            .try_get::<i64, _>("elapsed_seconds")
            .map_err(|e| e.to_string())?;
        let identity = format!("{source_type}|{source_key}|{local_date}");
        let display_name: Option<String> =
            row.try_get("display_name").map_err(|e| e.to_string())?;
        let started_at_unix_ms: i64 = row.try_get("started_at").map_err(|e| e.to_string())?;
        let created_at_unix_ms: i64 = row.try_get("created_at").map_err(|e| e.to_string())?;
        let mut part = 0_u32;
        while elapsed_seconds > 0 {
            if samples.len() >= MAX_DOOMSCROLLING_SAMPLES {
                return Err("combined Doomscrolling usage exceeds the exchange limit".to_string());
            }
            let chunk = elapsed_seconds.min(86_400);
            samples.push(DoomscrollingSampleMessage {
                sample_id: format!("combined-{:x}-{part}", Sha256::digest(identity.as_bytes())),
                device_id: "combined-devices".to_string(),
                source_type: source_type.clone(),
                source_key: source_key.clone(),
                display_name: display_name.clone(),
                started_at_unix_ms,
                elapsed_seconds: chunk,
                local_date: local_date.clone(),
                created_at_unix_ms,
            });
            elapsed_seconds -= chunk;
            part += 1;
        }
    }
    Ok(samples)
}

pub(crate) fn message_to_row(sample: DoomscrollingSampleMessage) -> LinkedUsageRow {
    LinkedUsageRow {
        id: sample.sample_id,
        source_type: sample.source_type,
        source_key: sample.source_key,
        display_name: sample.display_name,
        started_at: sample.started_at_unix_ms,
        elapsed_seconds: sample.elapsed_seconds,
        local_date: sample.local_date,
        created_at: sample.created_at_unix_ms,
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn row_to_message(
    sample: &LinkedUsageRow,
    device_id: &str,
) -> DoomscrollingSampleMessage {
    DoomscrollingSampleMessage {
        sample_id: sample.id.clone(),
        device_id: device_id.to_string(),
        source_type: sample.source_type.clone(),
        source_key: sample.source_key.clone(),
        display_name: sample.display_name.clone(),
        started_at_unix_ms: sample.started_at,
        elapsed_seconds: sample.elapsed_seconds,
        local_date: sample.local_date.clone(),
        created_at_unix_ms: sample.created_at,
    }
}

fn canonical_sample_id(device_id: &str, sample_id: &str) -> String {
    format!(
        "linked-{:x}",
        Sha256::digest(format!("{device_id}|{sample_id}").as_bytes())
    )
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn insert_message(
    pool: &SqlitePool,
    table: &str,
    vault_id: &str,
    sample: &DoomscrollingSampleMessage,
) -> Result<(), String> {
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    insert_message_executor(&mut transaction, table, vault_id, sample).await?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

async fn insert_message_executor(
    executor: &mut sqlx::SqliteConnection,
    table: &str,
    vault_id: &str,
    sample: &DoomscrollingSampleMessage,
) -> Result<(), String> {
    if !matches!(table, "pending_usage_samples" | "accepted_usage_samples") {
        return Err("invalid Doomscrolling spool table".to_string());
    }
    let query = format!(
        "INSERT OR IGNORE INTO {table}
            (sample_id, vault_id, device_id, source_type, source_key, display_name,
             started_at, elapsed_seconds, local_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    sqlx::query(&query)
        .bind(&sample.sample_id)
        .bind(vault_id)
        .bind(&sample.device_id)
        .bind(&sample.source_type)
        .bind(&sample.source_key)
        .bind(&sample.display_name)
        .bind(sample.started_at_unix_ms)
        .bind(sample.elapsed_seconds)
        .bind(&sample.local_date)
        .bind(sample.created_at_unix_ms)
        .execute(executor)
        .await
        .map_err(|error| format!("store linked Doomscrolling sample: {error}"))?;
    Ok(())
}

async fn read_messages(
    pool: &SqlitePool,
    table: &str,
    vault_id: &str,
    device_id: Option<&str>,
) -> Result<Vec<DoomscrollingSampleMessage>, String> {
    if !matches!(table, "pending_usage_samples" | "accepted_usage_samples") {
        return Err("invalid Doomscrolling spool table".to_string());
    }
    let query = format!(
        "SELECT sample_id, device_id, source_type, source_key, display_name,
                started_at, elapsed_seconds, local_date, created_at
         FROM {table}
         WHERE vault_id = ? AND (? IS NULL OR device_id = ?)
         ORDER BY created_at ASC, sample_id ASC LIMIT ?"
    );
    let rows = sqlx::query(&query)
        .bind(vault_id)
        .bind(device_id)
        .bind(device_id)
        .bind(EXCHANGE_BATCH_SAMPLES)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("read linked Doomscrolling samples: {error}"))?;
    rows.into_iter()
        .map(|row| {
            Ok(DoomscrollingSampleMessage {
                sample_id: row.try_get("sample_id").map_err(|e| e.to_string())?,
                device_id: row.try_get("device_id").map_err(|e| e.to_string())?,
                source_type: row.try_get("source_type").map_err(|e| e.to_string())?,
                source_key: row.try_get("source_key").map_err(|e| e.to_string())?,
                display_name: row.try_get("display_name").map_err(|e| e.to_string())?,
                started_at_unix_ms: row.try_get("started_at").map_err(|e| e.to_string())?,
                elapsed_seconds: row.try_get("elapsed_seconds").map_err(|e| e.to_string())?,
                local_date: row.try_get("local_date").map_err(|e| e.to_string())?,
                created_at_unix_ms: row.try_get("created_at").map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_spool(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir()
            .join(format!(
                "ganbaru-linked-usage-{name}-{}-{unique}",
                std::process::id()
            ))
            .join(SPOOL_FILE)
    }

    fn sample(id: &str, seconds: i64) -> DoomscrollingSampleMessage {
        DoomscrollingSampleMessage {
            sample_id: id.to_string(),
            device_id: "phone".to_string(),
            source_type: "mobile-app".to_string(),
            source_key: "com.example.video".to_string(),
            display_name: Some("Video".to_string()),
            started_at_unix_ms: 1_700_000_000_000,
            elapsed_seconds: seconds,
            local_date: "2026-09-13".to_string(),
            created_at_unix_ms: 1_700_000_001_000,
        }
    }

    #[tokio::test]
    async fn pending_samples_survive_restart_and_only_acknowledged_ids_are_removed() {
        let path = temp_spool("pending");
        enqueue_at(&path, "vault", "phone", &sample("one", 12))
            .await
            .expect("enqueue first");
        enqueue_at(&path, "vault", "phone", &sample("two", 18))
            .await
            .expect("enqueue second");

        assert_eq!(
            pending_at(&path, "vault", "phone")
                .await
                .expect("read after restart")
                .len(),
            2
        );
        acknowledge_at(&path, "vault", "phone", &["one".to_string()])
            .await
            .expect("acknowledge");
        let remaining = pending_at(&path, "vault", "phone")
            .await
            .expect("read remaining");
        assert_eq!(remaining, vec![sample("two", 18)]);
        std::fs::remove_dir_all(path.parent().expect("spool parent")).expect("remove temp spool");
    }

    #[tokio::test]
    async fn accepted_combined_samples_replace_atomically_without_duplication() {
        let path = temp_spool("accepted");
        replace_accepted_at(&path, "vault", &[sample("combined-one", 30)])
            .await
            .expect("store first snapshot");
        replace_accepted_at(&path, "vault", &[sample("combined-two", 45)])
            .await
            .expect("replace snapshot");

        let pool = open_spool(&path).await.expect("open cache");
        let accepted = read_messages(&pool, "accepted_usage_samples", "vault", None)
            .await
            .expect("read cache");
        assert_eq!(accepted, vec![sample("combined-two", 45)]);
        pool.close().await;
        std::fs::remove_dir_all(path.parent().expect("spool parent")).expect("remove temp spool");
    }

    #[tokio::test]
    async fn retried_device_samples_commit_once_and_aggregate_with_owner_usage() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open usage database");
        sqlx::query(
            "CREATE TABLE doomscrolling_usage_samples (
                id TEXT PRIMARY KEY,
                source_type TEXT NOT NULL,
                source_key TEXT NOT NULL,
                display_name TEXT,
                started_at INTEGER NOT NULL,
                elapsed_seconds INTEGER NOT NULL,
                local_date TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create usage table");
        let remote = sample("retry-stable", 18);
        import_linked_samples(&pool, std::slice::from_ref(&remote))
            .await
            .expect("first import");
        import_linked_samples(&pool, std::slice::from_ref(&remote))
            .await
            .expect("retry import");
        sqlx::query(
            "INSERT INTO doomscrolling_usage_samples
                (id, source_type, source_key, display_name, started_at,
                 elapsed_seconds, local_date, created_at)
             VALUES ('owner', 'mobile-app', 'com.example.video', 'Video', 1, 12,
                     '2026-09-13', 2)",
        )
        .execute(&pool)
        .await
        .expect("insert owner sample");

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM doomscrolling_usage_samples")
            .fetch_one(&pool)
            .await
            .expect("count committed samples");
        assert_eq!(count, 2);
        let combined = aggregate_owner_samples(&pool)
            .await
            .expect("aggregate usage");
        assert_eq!(combined.len(), 1);
        assert_eq!(combined[0].elapsed_seconds, 30);
    }

    #[tokio::test]
    async fn spool_compaction_preserves_the_exact_unacknowledged_total() {
        let path = temp_spool("compaction");
        enqueue_at(&path, "vault", "phone", &sample("one", 12))
            .await
            .expect("enqueue first");
        enqueue_at(&path, "vault", "phone", &sample("two", 18))
            .await
            .expect("enqueue second");
        let pool = open_spool(&path).await.expect("open spool");
        compact_pending(&pool, "vault", "phone")
            .await
            .expect("compact spool");
        pool.close().await;

        let compacted = pending_at(&path, "vault", "phone")
            .await
            .expect("read compacted spool");
        assert_eq!(compacted.len(), 1);
        assert_eq!(compacted[0].elapsed_seconds, 30);
        std::fs::remove_dir_all(path.parent().expect("spool parent")).expect("remove temp spool");
    }
}
