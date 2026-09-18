use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    Row, SqlitePool,
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../../apps/client/src-tauri/migrations");
const WRITE_CONTENTION_TIMEOUT: Duration = Duration::from_secs(5);

/// Native access mode applied when opening a vault database pool.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DatabaseAccessMode {
    ReadOnly,
    ReadWrite,
}

struct RegisteredPool {
    access: DatabaseAccessMode,
    pool: SqlitePool,
}

/// Shared registry for SQLite pools keyed by their authorized filesystem path.
#[derive(Clone, Default)]
pub struct DatabasePoolRegistry {
    pools: Arc<Mutex<HashMap<PathBuf, RegisteredPool>>>,
}

impl DatabasePoolRegistry {
    /// Connects to an authorized SQLite path or returns its existing pool.
    pub async fn connect_path(&self, path: impl AsRef<Path>) -> Result<SqlitePool, String> {
        self.connect_path_with_access(path, DatabaseAccessMode::ReadWrite)
            .await
    }

    /// Connects to an existing authorized SQLite path without write access.
    pub async fn connect_path_read_only(
        &self,
        path: impl AsRef<Path>,
    ) -> Result<SqlitePool, String> {
        self.connect_path_with_access(path, DatabaseAccessMode::ReadOnly)
            .await
    }

    async fn connect_path_with_access(
        &self,
        path: impl AsRef<Path>,
        access: DatabaseAccessMode,
    ) -> Result<SqlitePool, String> {
        let path = path.as_ref().to_path_buf();
        if let Some(registered) = self
            .pools
            .lock()
            .map_err(|_| "database pool lock poisoned".to_string())?
            .get(&path)
        {
            if registered.access != access {
                return Err("database access changed; close the existing pool first".to_string());
            }
            return Ok(registered.pool.clone());
        }

        let mut options = SqliteConnectOptions::new()
            .filename(&path)
            .foreign_keys(true)
            .busy_timeout(WRITE_CONTENTION_TIMEOUT);
        options = match access {
            DatabaseAccessMode::ReadOnly => options.read_only(true),
            DatabaseAccessMode::ReadWrite => options
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Full),
        };
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(|error| format!("connect: {error}"))?;
        if access == DatabaseAccessMode::ReadWrite {
            run_migrations(&pool).await?;
            sqlx::raw_sql("PRAGMA optimize")
                .execute(&pool)
                .await
                .map_err(|error| format!("pragma optimize: {error}"))?;
        } else {
            sqlx::raw_sql("PRAGMA query_only = ON")
                .execute(&pool)
                .await
                .map_err(|error| format!("enable query-only database access: {error}"))?;
        }

        let existing = {
            let mut pools = self
                .pools
                .lock()
                .map_err(|_| "database pool lock poisoned".to_string())?;
            if let Some(existing) = pools.get(&path) {
                if existing.access != access {
                    return Err(
                        "database access changed while opening; close the existing pool first"
                            .to_string(),
                    );
                }
                Some(existing.pool.clone())
            } else {
                pools.insert(
                    path,
                    RegisteredPool {
                        access,
                        pool: pool.clone(),
                    },
                );
                None
            }
        };
        if let Some(existing) = existing {
            pool.close().await;
            return Ok(existing);
        }
        Ok(pool)
    }

    /// Closes and removes the pool registered for a filesystem path.
    pub async fn close_path(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let pool = self
            .pools
            .lock()
            .map_err(|_| "database pool lock poisoned".to_string())?
            .remove(path.as_ref());
        if let Some(registered) = pool {
            registered.pool.close().await;
        }
        Ok(())
    }

    /// Closes every pool currently held by the registry.
    pub async fn close_all(&self) -> Result<(), String> {
        let pools = std::mem::take(
            &mut *self
                .pools
                .lock()
                .map_err(|_| "database pool lock poisoned".to_string())?,
        );
        for registered in pools.into_values() {
            registered.pool.close().await;
        }
        Ok(())
    }
}

/// Applies the embedded Ganbaru AI migration chain to a SQLite pool.
pub async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    MIGRATOR
        .run(pool)
        .await
        .map_err(|error| format!("run database migrations: {error}"))
}

/// Returns deterministic bytes identifying the complete embedded up-migration set.
///
/// Callers can hash this bounded material when negotiating database compatibility
/// without exposing migration contents over an external protocol.
pub fn migration_set_identity_material() -> Vec<u8> {
    let mut identity = Vec::new();
    for migration in MIGRATOR
        .iter()
        .filter(|migration| !migration.migration_type.is_down_migration())
    {
        identity.extend_from_slice(&migration.version.to_be_bytes());
        identity.extend_from_slice(&(migration.checksum.len() as u64).to_be_bytes());
        identity.extend_from_slice(migration.checksum.as_ref());
    }
    identity
}

/// Validates that a read-only database has the complete embedded migration history.
pub async fn validate_current_schema(pool: &SqlitePool) -> Result<(), String> {
    let rows =
        sqlx::query("SELECT version, checksum, success FROM _sqlx_migrations ORDER BY version ASC")
            .fetch_all(pool)
            .await
            .map_err(|error| format!("read database migration history: {error}"))?;
    let expected = MIGRATOR
        .iter()
        .filter(|migration| !migration.migration_type.is_down_migration())
        .collect::<Vec<_>>();
    if rows.len() != expected.len() {
        return Err("database schema does not match the current migration set".to_string());
    }
    for (row, migration) in rows.iter().zip(expected) {
        let version: i64 = row
            .try_get("version")
            .map_err(|error| format!("read migration version: {error}"))?;
        let checksum: Vec<u8> = row
            .try_get("checksum")
            .map_err(|error| format!("read migration checksum: {error}"))?;
        let success: bool = row
            .try_get("success")
            .map_err(|error| format!("read migration status: {error}"))?;
        if version != migration.version || checksum != migration.checksum.as_ref() || !success {
            return Err("database migration history is incompatible".to_string());
        }
    }
    Ok(())
}

#[doc(hidden)]
pub mod __private {
    pub use sqlx;
}

/// Implements `sqlx::FromRow` by reading fields with their Rust names.
#[macro_export]
macro_rules! impl_sqlite_from_row {
    ($type:ty { $($field:ident),+ $(,)? }) => {
        impl<'r> $crate::__private::sqlx::FromRow<'r, $crate::__private::sqlx::sqlite::SqliteRow>
            for $type
        {
            fn from_row(
                row: &'r $crate::__private::sqlx::sqlite::SqliteRow,
            ) -> Result<Self, $crate::__private::sqlx::Error> {
                use $crate::__private::sqlx::Row as _;
                Ok(Self {
                    $($field: row.try_get(stringify!($field))?,)+
                })
            }
        }
    };
}

#[cfg(test)]
mod tests;
