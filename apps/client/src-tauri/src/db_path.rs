use sqlx::{Connection, Executor, SqliteConnection};
use tauri::{AppHandle, Manager, Runtime};

const ALLOWED_SQLITE_FILES: &[&str] =
    &["ganbaruai.db", "ganbaruai-dev.db", "ganbaruai-benchmark.db"];

pub fn resolve_sqlite_url<R: Runtime>(app: &AppHandle<R>, db_url: &str) -> Result<String, String> {
    let file_name = db_url
        .strip_prefix("sqlite:")
        .ok_or_else(|| format!("invalid db url '{db_url}', expected 'sqlite:<file>'"))?;

    if !ALLOWED_SQLITE_FILES.contains(&file_name) {
        return Err(format!("unsupported sqlite file '{file_name}'"));
    }

    let mut path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    path.push(file_name);
    let path = path
        .to_str()
        .ok_or_else(|| "db path contains non-utf8 characters".to_string())?;
    Ok(format!("sqlite:{path}"))
}

pub async fn connect_sqlite<R: Runtime>(
    app: &AppHandle<R>,
    db_url: &str,
) -> Result<SqliteConnection, String> {
    let conn_url = resolve_sqlite_url(app, db_url)?;
    let mut conn = SqliteConnection::connect(&conn_url)
        .await
        .map_err(|e| format!("connect: {e}"))?;
    conn.execute("PRAGMA foreign_keys=ON")
        .await
        .map_err(|e| format!("pragma foreign_keys: {e}"))?;
    Ok(conn)
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
