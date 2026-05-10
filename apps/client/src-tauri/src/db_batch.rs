//! Transactional batch executor.
//!
//! `tauri-plugin-sql` exposes only single-statement `execute` and `select`
//! over a connection pool, so JS-level `BEGIN` / `COMMIT` cannot reliably
//! span multiple `execute` calls (each call may acquire a different
//! connection from the pool). For bulk operations such as ICS import,
//! per-statement auto-commit triggers an fsync per statement, turning
//! a few-thousand-row import into a multi-minute exercise.
//!
//! This command opens a fresh `sqlx::SqliteConnection` to the same SQLite
//! file the plugin uses, wraps the supplied statements in a single
//! transaction, and commits once at the end. SQLite's WAL mode serializes
//! concurrent writers at the file lock level, so coordination with the
//! plugin's own pool is safe.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::{Connection, Executor};
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

#[derive(Deserialize)]
pub struct DbStatement {
    /// Parameterized SQL using `?` placeholders. Unlike the plugin's
    /// `$1` style, sqlx talks to SQLite directly here, and SQLite treats
    /// `$NAME` as a named parameter rather than a positional one. Stick
    /// to plain `?` and bind values in order.
    pub query: String,
    /// Bound values in order. JSON nulls become SQL NULL; strings become
    /// TEXT; finite numbers become REAL or INTEGER.
    pub binds: Vec<JsonValue>,
}

#[derive(Serialize)]
pub struct DbBatchResult {
    /// `rows_affected` for each statement, in the input order.
    pub rows_affected: Vec<u64>,
}

fn bind_value<'q>(
    q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    value: &'q JsonValue,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    if value.is_null() {
        q.bind(None::<String>)
    } else if let Some(s) = value.as_str() {
        q.bind(s.to_owned())
    } else if let Some(i) = value.as_i64() {
        q.bind(i)
    } else if let Some(f) = value.as_f64() {
        q.bind(f)
    } else if let Some(b) = value.as_bool() {
        q.bind(if b { 1_i64 } else { 0_i64 })
    } else {
        q.bind(value.to_string())
    }
}

/// Run `statements` as a single SQLite transaction. Returns
/// `rows_affected` for each statement on commit; rolls back and surfaces
/// the error on the first failed statement.
///
/// `db_url` mirrors the plugin's connection string (e.g.
/// `sqlite:ganbaruai.db`); the path is resolved against the app's config
/// dir using the same logic as `tauri-plugin-sql`.
#[tauri::command]
pub async fn db_execute_batch<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    statements: Vec<DbStatement>,
) -> Result<DbBatchResult, String> {
    let mut conn = connect_sqlite(&app, &db_url).await?;

    let mut tx = conn.begin().await.map_err(|e| format!("begin: {e}"))?;

    let mut rows_affected = Vec::with_capacity(statements.len());
    for (idx, stmt) in statements.iter().enumerate() {
        let mut q = sqlx::query(&stmt.query);
        for v in &stmt.binds {
            q = bind_value(q, v);
        }
        let result = tx
            .execute(q)
            .await
            .map_err(|e| format!("statement {idx}: {e}"))?;
        rows_affected.push(result.rows_affected());
    }

    tx.commit().await.map_err(|e| format!("commit: {e}"))?;

    Ok(DbBatchResult { rows_affected })
}
