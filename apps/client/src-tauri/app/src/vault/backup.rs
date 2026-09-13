//! Portable Android vault backups and transactional restore.
#![cfg_attr(
    not(any(test, target_os = "android")),
    allow(dead_code, unused_imports)
)]

#[cfg(target_os = "android")]
use super::{
    active_vault_path, default_data_folder_path, ensure_vault_skeleton, path_to_string,
    select_vault,
};
#[cfg(any(test, target_os = "android"))]
use super::{database_path, vault_info_from_path};
use super::{VaultInfo, APP_SQLITE_FILE, CONFIG_LOCK};
#[cfg(target_os = "android")]
use crate::db_path;
#[cfg(target_os = "android")]
use chrono::{SecondsFormat, Utc};
#[cfg(target_os = "android")]
use ganbaru_mobile_documents::MobileDocumentsExt;
#[cfg(any(test, target_os = "android"))]
use sqlx::Row;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
#[cfg(target_os = "android")]
use tauri::{Manager, Runtime};
use zip::write::{SimpleFileOptions, ZipWriter};
use zip::{CompressionMethod, ZipArchive};

#[cfg(target_os = "android")]
const BACKUP_EXTENSION: &str = "ganbaru-backup";
#[cfg(target_os = "android")]
const BACKUP_MIME_TYPE: &str = "application/zip";
const BACKUP_MAX_ENTRIES: usize = 100_000;
const BACKUP_MAX_BYTES: u64 = 100 * 1024 * 1024 * 1024;
const BACKUP_MAX_DEPTH: usize = 64;
const COPY_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultBackupOutcome {
    /// Display name assigned by Android in shared Downloads.
    pub file_name: String,
    /// Stable frontend destination identifier.
    pub destination: &'static str,
}

#[cfg(target_os = "android")]
fn unique_transfer_directory<R: Runtime>(
    app: &tauri::AppHandle<R>,
    operation: &str,
) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("find app cache directory: {error}"))?;
    fs::create_dir_all(&root).map_err(|error| format!("create app cache directory: {error}"))?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("create transfer identifier: {error}"))?
        .as_nanos();
    let directory = root.join(format!(
        "vault-{operation}-{}-{nonce:x}",
        std::process::id()
    ));
    fs::create_dir(&directory).map_err(|error| format!("create transfer directory: {error}"))?;
    Ok(directory)
}

#[cfg(target_os = "android")]
fn backup_file_name() -> String {
    let timestamp: chrono::DateTime<Utc> = std::time::SystemTime::now().into();
    let timestamp = timestamp
        .to_rfc3339_opts(SecondsFormat::Secs, true)
        .replace(':', "-");
    format!("ganbaru-ai-backup-{timestamp}.{BACKUP_EXTENSION}")
}

#[cfg(target_os = "android")]
async fn create_database_snapshot<R: Runtime>(
    app: &tauri::AppHandle<R>,
    destination: &Path,
) -> Result<(), String> {
    let pool = db_path::connect_sqlite(app.clone(), format!("sqlite:{APP_SQLITE_FILE}")).await?;
    vacuum_database(&pool, destination).await
}

#[cfg(any(test, target_os = "android"))]
async fn vacuum_database(pool: &sqlx::SqlitePool, destination: &Path) -> Result<(), String> {
    let destination = destination
        .to_str()
        .ok_or_else(|| "database snapshot path contains non-UTF-8 characters".to_string())?;
    sqlx::query("VACUUM INTO ?")
        .bind(destination)
        .execute(pool)
        .await
        .map_err(|error| format!("create consistent database snapshot: {error}"))?;
    Ok(())
}

#[derive(Clone)]
struct ArchiveEntry {
    source: PathBuf,
    relative: PathBuf,
    directory: bool,
}

fn collect_archive_entries(
    root: &Path,
    current: &Path,
    entries: &mut Vec<ArchiveEntry>,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let mut children = fs::read_dir(current)
        .map_err(|error| format!("read backup source '{}': {error}", current.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read backup source entry: {error}"))?;
    children.sort_by_key(fs::DirEntry::file_name);

    for child in children {
        if entries.len() >= BACKUP_MAX_ENTRIES {
            return Err("Ganbaru AI folder contains too many backup entries".to_string());
        }
        let source = child.path();
        let relative = source
            .strip_prefix(root)
            .map_err(|_| "backup entry escaped the Ganbaru AI folder".to_string())?
            .to_path_buf();
        let depth = relative.components().count();
        if depth > BACKUP_MAX_DEPTH {
            return Err("Ganbaru AI folder is nested too deeply to back up".to_string());
        }
        let metadata = fs::symlink_metadata(&source)
            .map_err(|error| format!("inspect backup entry '{}': {error}", source.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "backup does not support symbolic link '{}'",
                relative.display()
            ));
        }
        if metadata.is_dir() {
            entries.push(ArchiveEntry {
                source: source.clone(),
                relative,
                directory: true,
            });
            collect_archive_entries(root, &source, entries, total_bytes)?;
        } else if metadata.is_file() {
            let file_name = relative.file_name().and_then(|value| value.to_str());
            if matches!(
                file_name,
                Some("ganbaru-ai.sqlite-wal" | "ganbaru-ai.sqlite-shm")
            ) {
                continue;
            }
            *total_bytes = total_bytes.saturating_add(metadata.len());
            if *total_bytes > BACKUP_MAX_BYTES {
                return Err("Ganbaru AI folder exceeds the backup size limit".to_string());
            }
            entries.push(ArchiveEntry {
                source,
                relative,
                directory: false,
            });
        } else {
            return Err(format!(
                "backup contains unsupported entry '{}'",
                relative.display()
            ));
        }
    }
    Ok(())
}

fn archive_name(path: &Path, directory: bool) -> Result<String, String> {
    let mut name = path
        .to_str()
        .ok_or_else(|| "backup entry path contains non-UTF-8 characters".to_string())?
        .replace('\\', "/");
    if directory && !name.ends_with('/') {
        name.push('/');
    }
    Ok(name)
}

fn create_backup_archive(
    vault_root: &Path,
    database_snapshot: &Path,
    destination: &Path,
) -> Result<(), String> {
    let _config_guard = CONFIG_LOCK
        .lock()
        .map_err(|_| "vault config lock is unavailable".to_string())?;
    let mut entries = Vec::new();
    let mut total_bytes = 0;
    collect_archive_entries(vault_root, vault_root, &mut entries, &mut total_bytes)?;

    let file =
        fs::File::create(destination).map_err(|error| format!("create backup archive: {error}"))?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600);
    let directory_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .unix_permissions(0o700);
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];

    for entry in entries {
        let name = archive_name(&entry.relative, entry.directory)?;
        if entry.directory {
            writer
                .add_directory(name, directory_options)
                .map_err(|error| format!("write backup directory: {error}"))?;
            continue;
        }
        writer
            .start_file(name, options)
            .map_err(|error| format!("write backup entry: {error}"))?;
        let source = if entry.relative == Path::new(APP_SQLITE_FILE) {
            database_snapshot
        } else {
            &entry.source
        };
        let mut input = fs::File::open(source).map_err(|error| {
            format!("open backup entry '{}': {error}", entry.relative.display())
        })?;
        loop {
            let count = input.read(&mut buffer).map_err(|error| {
                format!("read backup entry '{}': {error}", entry.relative.display())
            })?;
            if count == 0 {
                break;
            }
            writer.write_all(&buffer[..count]).map_err(|error| {
                format!(
                    "compress backup entry '{}': {error}",
                    entry.relative.display()
                )
            })?;
        }
    }
    writer
        .finish()
        .map_err(|error| format!("finish backup archive: {error}"))?
        .sync_all()
        .map_err(|error| format!("sync backup archive: {error}"))?;
    Ok(())
}

fn safe_archive_path(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.components().count() > BACKUP_MAX_DEPTH
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("backup contains an unsafe entry path".to_string());
    }
    Ok(path.to_path_buf())
}

fn extract_backup_archive(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(archive_path).map_err(|error| format!("open backup: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("open backup archive: {error}"))?;
    if archive.len() > BACKUP_MAX_ENTRIES {
        return Err("backup contains too many entries".to_string());
    }
    fs::create_dir(destination)
        .map_err(|error| format!("create restore staging folder: {error}"))?;
    let mut total_bytes = 0_u64;
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("read backup entry {index}: {error}"))?;
        if entry.encrypted() {
            return Err("encrypted backup archives are not supported".to_string());
        }
        if let Some(mode) = entry.unix_mode() {
            let file_type = mode & 0o170000;
            if file_type != 0 && file_type != 0o040000 && file_type != 0o100000 {
                return Err("backup contains an unsupported special file".to_string());
            }
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| "backup contains an unsafe entry path".to_string())?;
        let relative = safe_archive_path(&enclosed)?;
        let output = destination.join(&relative);
        if output.exists() {
            return Err(format!(
                "backup contains duplicate entry '{}'",
                relative.display()
            ));
        }
        if entry.is_dir() {
            fs::create_dir(&output).map_err(|error| {
                format!(
                    "create restored directory '{}': {error}",
                    relative.display()
                )
            })?;
            continue;
        }
        if !entry.is_file() {
            return Err(format!(
                "backup entry '{}' is unsupported",
                relative.display()
            ));
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("create restored parent '{}': {error}", relative.display())
            })?;
        }
        let mut target = fs::File::create(&output)
            .map_err(|error| format!("create restored file '{}': {error}", relative.display()))?;
        loop {
            let count = entry
                .read(&mut buffer)
                .map_err(|error| format!("read backup file '{}': {error}", relative.display()))?;
            if count == 0 {
                break;
            }
            total_bytes = total_bytes.saturating_add(count as u64);
            if total_bytes > BACKUP_MAX_BYTES {
                return Err("backup exceeds the restore size limit".to_string());
            }
            target.write_all(&buffer[..count]).map_err(|error| {
                format!("write restored file '{}': {error}", relative.display())
            })?;
        }
        target
            .sync_all()
            .map_err(|error| format!("sync restored file '{}': {error}", relative.display()))?;
    }
    Ok(())
}

#[cfg(any(test, target_os = "android"))]
async fn validate_restored_vault(path: &Path) -> Result<(), String> {
    vault_info_from_path(path)?;
    let restored_database = database_path(path);
    let metadata = fs::metadata(&restored_database)
        .map_err(|error| format!("backup is missing its database: {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("backup database is empty".to_string());
    }
    let registry = ganbaru_db::DatabasePoolRegistry::default();
    let pool = registry.connect_path(&restored_database).await?;
    let row = sqlx::query("PRAGMA integrity_check")
        .fetch_one(&pool)
        .await
        .map_err(|error| format!("check restored database: {error}"))?;
    let result: String = row
        .try_get(0)
        .map_err(|error| format!("read restored database check: {error}"))?;
    registry.close_all().await?;
    if result != "ok" {
        return Err(format!(
            "restored database failed its integrity check: {result}"
        ));
    }
    Ok(())
}

#[cfg(any(test, target_os = "android"))]
fn replace_vault(staging: &Path, target: &Path, rollback: &Path) -> Result<(), String> {
    recover_interrupted_restore(target, rollback)?;
    let had_target = target.exists();
    if had_target {
        fs::rename(target, rollback)
            .map_err(|error| format!("prepare current data for restore: {error}"))?;
    }
    if let Err(error) = fs::rename(staging, target) {
        if had_target {
            let _ = fs::rename(rollback, target);
        }
        return Err(format!("activate restored data: {error}"));
    }
    if had_target {
        let _ = fs::remove_dir_all(rollback);
    }
    Ok(())
}

fn recover_interrupted_restore(target: &Path, rollback: &Path) -> Result<(), String> {
    if !rollback.exists() {
        return Ok(());
    }
    if target.exists() {
        fs::remove_dir_all(rollback)
            .map_err(|error| format!("remove completed restore rollback: {error}"))
    } else {
        fs::rename(rollback, target)
            .map_err(|error| format!("recover interrupted data restore: {error}"))
    }
}

#[cfg(target_os = "android")]
pub(crate) fn recover_interrupted_restore_for_app(app: &tauri::AppHandle) -> Result<(), String> {
    let target = default_data_folder_path(app)?;
    let parent = target
        .parent()
        .ok_or_else(|| "Ganbaru AI folder has no parent directory".to_string())?;
    recover_interrupted_restore(&target, &parent.join(".ganbaru-ai.rollback"))
}

#[cfg(target_os = "android")]
#[tauri::command]
/// Save a consistent portable copy of the active vault to Android Downloads.
pub async fn vault_backup_to_downloads(
    app: tauri::AppHandle,
) -> Result<VaultBackupOutcome, String> {
    let transfer = unique_transfer_directory(&app, "backup")?;
    let result = async {
        let vault_root = active_vault_path(&app)?;
        let database_snapshot = transfer.join("database.sqlite");
        let archive_path = transfer.join("backup.ganbaru-backup");
        create_database_snapshot(&app, &database_snapshot).await?;
        create_backup_archive(&vault_root, &database_snapshot, &archive_path)?;
        let file_name = backup_file_name();
        let archive_path = path_to_string(&archive_path, "backup archive")?;
        let saved_name = app.mobile_documents().save_file_download(
            &archive_path,
            &file_name,
            BACKUP_MAX_BYTES,
            &[BACKUP_EXTENSION],
            BACKUP_MIME_TYPE,
            "Ganbaru AI backup",
        )?;
        Ok(VaultBackupOutcome {
            file_name: saved_name,
            destination: "downloads",
        })
    }
    .await;
    let _ = fs::remove_dir_all(&transfer);
    result
}

#[cfg(target_os = "android")]
#[tauri::command]
/// Pick, validate, and transactionally restore a portable Android vault backup.
pub async fn vault_pick_and_restore_backup(
    app: tauri::AppHandle,
) -> Result<Option<VaultInfo>, String> {
    let _write_permit = super::active_writable_vault_path(&app)?;
    let transfer = unique_transfer_directory(&app, "restore")?;
    let archive_path = transfer.join("selected.ganbaru-backup");
    let result = async {
        let target = default_data_folder_path(&app)?;
        let parent = target
            .parent()
            .ok_or_else(|| "Ganbaru AI folder has no parent directory".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("create app data directory: {error}"))?;
        let staging = parent.join(".ganbaru-ai.restore");
        let rollback = parent.join(".ganbaru-ai.rollback");
        recover_interrupted_restore(&target, &rollback)?;
        if staging.exists() {
            fs::remove_dir_all(&staging)
                .map_err(|error| format!("remove stale restore staging: {error}"))?;
        }

        let archive_path_string = path_to_string(&archive_path, "selected backup")?;
        let selected = app.mobile_documents().pick_document_to_path(
            &archive_path_string,
            BACKUP_MAX_BYTES,
            &[BACKUP_EXTENSION],
            &[BACKUP_MIME_TYPE, "application/octet-stream"],
            "Ganbaru AI backup",
        )?;
        if selected.is_none() {
            return Ok(None);
        }
        extract_backup_archive(&archive_path, &staging)?;
        validate_restored_vault(&staging).await?;
        ensure_vault_skeleton(&staging)?;
        let restore_guard = db_path::begin_vault_restore().await;
        db_path::close_all_sqlite_pools_for_restore(&app).await?;
        replace_vault(&staging, &target, &rollback)?;
        let info = vault_info_from_path(&target)?;
        select_vault(&app, &info)?;
        drop(restore_guard);
        Ok(Some(info))
    }
    .await;
    if let Ok(target) = default_data_folder_path(&app) {
        if let Some(parent) = target.parent() {
            let staging = parent.join(".ganbaru-ai.restore");
            if staging.exists() {
                let _ = fs::remove_dir_all(staging);
            }
        }
    }
    let _ = fs::remove_dir_all(&transfer);
    result
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
/// Report that portable mobile backup is unavailable outside Android.
pub async fn vault_backup_to_downloads() -> Result<VaultBackupOutcome, String> {
    Err("portable mobile backups are only available on Android".to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
/// Report that portable mobile restore is unavailable outside Android.
pub async fn vault_pick_and_restore_backup() -> Result<Option<VaultInfo>, String> {
    Err("portable mobile backup restore is only available on Android".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_test_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ganbaru-vault-backup-test-{}-{}-{name}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn safe_archive_paths_reject_escape_and_absolute_paths() {
        assert_eq!(
            safe_archive_path(Path::new("notes/page.md")).unwrap(),
            Path::new("notes/page.md")
        );
        assert!(safe_archive_path(Path::new("../vault.json")).is_err());
        assert!(safe_archive_path(Path::new("/vault.json")).is_err());
        assert!(safe_archive_path(Path::new(".")).is_err());
    }

    #[test]
    fn backup_archive_uses_consistent_database_snapshot() {
        let root = unique_test_path("root");
        let snapshot = unique_test_path("snapshot.sqlite");
        let archive_path = unique_test_path("backup.ganbaru-backup");
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::write(root.join("vault.json"), b"vault").unwrap();
        fs::write(root.join(APP_SQLITE_FILE), b"live database").unwrap();
        fs::write(root.join("ganbaru-ai.sqlite-wal"), b"wal").unwrap();
        fs::write(root.join("notes/page.md"), b"note").unwrap();
        fs::write(&snapshot, b"snapshot database").unwrap();

        create_backup_archive(&root, &snapshot, &archive_path).unwrap();
        let file = fs::File::open(&archive_path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let mut database = String::new();
        archive
            .by_name(APP_SQLITE_FILE)
            .unwrap()
            .read_to_string(&mut database)
            .unwrap();
        assert_eq!(database, "snapshot database");
        assert!(archive.by_name("ganbaru-ai.sqlite-wal").is_err());

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_file(snapshot);
        let _ = fs::remove_file(archive_path);
    }

    #[test]
    fn restore_rejects_zip_slip_entries() {
        let archive_path = unique_test_path("unsafe.ganbaru-backup");
        let destination = unique_test_path("destination");
        let file = fs::File::create(&archive_path).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("../outside", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"unsafe").unwrap();
        writer.finish().unwrap();

        assert!(extract_backup_archive(&archive_path, &destination).is_err());
        assert!(!destination.join("../outside").exists());
        let _ = fs::remove_file(archive_path);
        let _ = fs::remove_dir_all(destination);
    }

    #[test]
    fn interrupted_restore_recovers_only_copy() {
        let parent = unique_test_path("interrupted");
        let target = parent.join("Ganbaru AI");
        let rollback = parent.join(".ganbaru-ai.rollback");
        fs::create_dir_all(&rollback).unwrap();
        fs::write(rollback.join("vault.json"), b"current").unwrap();

        recover_interrupted_restore(&target, &rollback).unwrap();

        assert_eq!(fs::read(target.join("vault.json")).unwrap(), b"current");
        assert!(!rollback.exists());
        let _ = fs::remove_dir_all(parent);
    }

    #[test]
    fn completed_restore_discards_old_rollback() {
        let parent = unique_test_path("completed");
        let target = parent.join("Ganbaru AI");
        let rollback = parent.join(".ganbaru-ai.rollback");
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&rollback).unwrap();
        fs::write(target.join("vault.json"), b"restored").unwrap();
        fs::write(rollback.join("vault.json"), b"old").unwrap();

        recover_interrupted_restore(&target, &rollback).unwrap();

        assert_eq!(fs::read(target.join("vault.json")).unwrap(), b"restored");
        assert!(!rollback.exists());
        let _ = fs::remove_dir_all(parent);
    }

    #[tokio::test]
    async fn vacuum_database_creates_a_consistent_readable_snapshot() {
        use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

        let source = unique_test_path("source.sqlite");
        let snapshot = unique_test_path("vacuum.sqlite");
        let options = SqliteConnectOptions::new()
            .filename(&source)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE backup_test (value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO backup_test (value) VALUES ('preserved')")
            .execute(&pool)
            .await
            .unwrap();

        vacuum_database(&pool, &snapshot).await.unwrap();
        pool.close().await;

        let snapshot_options = SqliteConnectOptions::new().filename(&snapshot);
        let snapshot_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(snapshot_options)
            .await
            .unwrap();
        let value: String = sqlx::query_scalar("SELECT value FROM backup_test")
            .fetch_one(&snapshot_pool)
            .await
            .unwrap();
        assert_eq!(value, "preserved");
        snapshot_pool.close().await;

        let _ = fs::remove_file(source);
        let _ = fs::remove_file(snapshot);
    }

    #[tokio::test]
    async fn whole_vault_snapshot_restores_database_and_managed_files() {
        let parent = unique_test_path("whole-vault");
        let source = parent.join("source");
        let staging = parent.join("staging");
        let target = parent.join("receiver");
        let rollback = parent.join("rollback");
        let snapshot = parent.join("snapshot.sqlite");
        let archive_path = parent.join("handoff.ganbaru-backup");
        fs::create_dir_all(&source).unwrap();
        let source_info = super::super::initialize_vault(&source).unwrap();

        let source_registry = ganbaru_db::DatabasePoolRegistry::default();
        let source_pool = source_registry
            .connect_path(database_path(&source))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE handoff_probe (value TEXT NOT NULL)")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO handoff_probe (value) VALUES ('portable row')")
            .execute(&source_pool)
            .await
            .unwrap();
        let managed_asset = source.join("assets/chat/attachments/context.txt");
        fs::create_dir_all(managed_asset.parent().unwrap()).unwrap();
        fs::write(&managed_asset, b"portable managed asset").unwrap();

        let live_wal = source.join(format!("{APP_SQLITE_FILE}-wal"));
        let live_shm = source.join(format!("{APP_SQLITE_FILE}-shm"));
        assert!(live_wal.exists(), "source should have an active WAL");
        assert!(live_shm.exists(), "source should have active shared memory");

        vacuum_database(&source_pool, &snapshot).await.unwrap();
        create_backup_archive(&source, &snapshot, &archive_path).unwrap();

        let file = fs::File::open(&archive_path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        assert!(archive.by_name(&format!("{APP_SQLITE_FILE}-wal")).is_err());
        assert!(archive.by_name(&format!("{APP_SQLITE_FILE}-shm")).is_err());
        drop(archive);

        extract_backup_archive(&archive_path, &staging).unwrap();
        validate_restored_vault(&staging).await.unwrap();
        replace_vault(&staging, &target, &rollback).unwrap();

        let restored_info = vault_info_from_path(&target).unwrap();
        assert_eq!(restored_info.vault_id, source_info.vault_id);
        let restored_registry = ganbaru_db::DatabasePoolRegistry::default();
        let restored_pool = restored_registry
            .connect_path(database_path(&target))
            .await
            .unwrap();
        let value: String = sqlx::query_scalar("SELECT value FROM handoff_probe")
            .fetch_one(&restored_pool)
            .await
            .unwrap();
        assert_eq!(value, "portable row");
        assert_eq!(
            fs::read(target.join("assets/chat/attachments/context.txt")).unwrap(),
            b"portable managed asset"
        );

        restored_registry.close_all().await.unwrap();
        source_registry.close_all().await.unwrap();
        fs::remove_dir_all(parent).unwrap();
    }
}
