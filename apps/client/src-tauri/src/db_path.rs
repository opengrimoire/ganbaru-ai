use crate::db;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use std::{
    collections::HashMap,
    str::FromStr,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, Runtime};

const ALLOWED_SQLITE_FILES: &[&str] =
    &["ganbaruai.db", "ganbaruai-dev.db", "ganbaruai-benchmark.db"];

#[derive(Clone, Default)]
pub struct DatabaseState {
    pools: Arc<Mutex<HashMap<String, SqlitePool>>>,
}

pub fn resolve_sqlite_url<R: Runtime>(app: &AppHandle<R>, db_url: &str) -> Result<String, String> {
    let file_name = db_url
        .strip_prefix("sqlite:")
        .ok_or_else(|| format!("invalid db url '{db_url}', expected 'sqlite:<file>'"))?;

    if !ALLOWED_SQLITE_FILES.contains(&file_name) {
        return Err(format!("unsupported sqlite file '{file_name}'"));
    }

    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&path).map_err(|e| format!("create app config dir: {e}"))?;
    path.push(file_name);
    let path = path
        .to_str()
        .ok_or_else(|| "db path contains non-utf8 characters".to_string())?;
    Ok(format!("sqlite:{path}"))
}

pub async fn connect_sqlite<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
) -> Result<SqlitePool, String> {
    let conn_url = resolve_sqlite_url(&app, &db_url)?;
    let state = app.state::<DatabaseState>().inner().clone();
    drop(app);
    drop(db_url);
    if let Some(pool) = state
        .pools
        .lock()
        .map_err(|_| "database pool lock poisoned".to_string())?
        .get(&conn_url)
        .cloned()
    {
        return Ok(pool);
    }

    let options = SqliteConnectOptions::from_str(&conn_url)
        .map_err(|e| format!("parse sqlite url: {e}"))?
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| format!("connect: {e}"))?;
    sqlx::raw_sql("PRAGMA foreign_keys=ON")
        .execute(&pool)
        .await
        .map_err(|e| format!("pragma foreign_keys: {e}"))?;
    sqlx::raw_sql("PRAGMA journal_mode=WAL")
        .execute(&pool)
        .await
        .map_err(|e| format!("pragma journal_mode: {e}"))?;
    sqlx::raw_sql("PRAGMA busy_timeout=5000")
        .execute(&pool)
        .await
        .map_err(|e| format!("pragma busy_timeout: {e}"))?;
    sqlx::raw_sql("PRAGMA synchronous=NORMAL")
        .execute(&pool)
        .await
        .map_err(|e| format!("pragma synchronous: {e}"))?;
    db::run_migrations(&pool).await?;
    sqlx::raw_sql("PRAGMA optimize")
        .execute(&pool)
        .await
        .map_err(|e| format!("pragma optimize: {e}"))?;

    let mut pools = state
        .pools
        .lock()
        .map_err(|_| "database pool lock poisoned".to_string())?;
    if let Some(existing) = pools.get(&conn_url).cloned() {
        return Ok(existing);
    }
    pools.insert(conn_url, pool.clone());
    Ok(pool)
}

pub async fn close_sqlite_pool<R: Runtime>(app: &AppHandle<R>, db_url: &str) -> Result<(), String> {
    let conn_url = resolve_sqlite_url(app, db_url)?;
    let state = app.state::<DatabaseState>().inner().clone();
    let pool = state
        .pools
        .lock()
        .map_err(|_| "database pool lock poisoned".to_string())?
        .remove(&conn_url);
    if let Some(pool) = pool {
        pool.close().await;
    }
    Ok(())
}

pub async fn close_all_sqlite_pools<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<DatabaseState>().inner().clone();
    let pools = std::mem::take(
        &mut *state
            .pools
            .lock()
            .map_err(|_| "database pool lock poisoned".to_string())?,
    );
    for pool in pools.into_values() {
        pool.close().await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::ALLOWED_SQLITE_FILES;

    #[test]
    fn allowed_sqlite_files_are_plain_file_names() {
        for file_name in ALLOWED_SQLITE_FILES {
            assert!(!file_name.contains('/'));
            assert!(!file_name.contains('\\'));
            assert!(!file_name.contains(".."));
        }
    }
}
