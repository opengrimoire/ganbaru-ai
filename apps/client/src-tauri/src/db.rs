use sqlx::SqlitePool;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    MIGRATOR
        .run(pool)
        .await
        .map_err(|e| format!("run database migrations: {e}"))
}

#[cfg(test)]
mod tests;
