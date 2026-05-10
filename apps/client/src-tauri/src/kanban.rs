use serde::Deserialize;
use tauri::{AppHandle, Runtime};

use crate::db_path::connect_sqlite;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanTaskCreate {
    id: String,
    title: String,
    status: String,
    priority: String,
    sort_order: i64,
    created_at: String,
    updated_at: String,
}

#[tauri::command]
pub async fn kanban_add_task<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    task: KanbanTaskCreate,
) -> Result<(), String> {
    validate_task_create(&task)?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    sqlx::query(
        "INSERT INTO tasks (id, title, status, priority, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(task.id)
    .bind(task.title)
    .bind(task.status)
    .bind(task.priority)
    .bind(task.sort_order)
    .bind(task.created_at)
    .bind(task.updated_at)
    .execute(&mut conn)
    .await
    .map_err(|e| format!("insert kanban task: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn kanban_update_task_status<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    task_id: String,
    status: String,
    updated_at: String,
) -> Result<(), String> {
    require_non_empty(&task_id, "task_id")?;
    validate_status(&status)?;
    require_non_empty(&updated_at, "updated_at")?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    let result = sqlx::query("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status)
        .bind(updated_at)
        .bind(task_id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("update kanban task status: {e}"))?;
    if result.rows_affected() == 0 {
        return Err("kanban task not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn kanban_delete_task<R: Runtime>(
    app: AppHandle<R>,
    db_url: String,
    task_id: String,
) -> Result<(), String> {
    require_non_empty(&task_id, "task_id")?;
    let mut conn = connect_sqlite(&app, &db_url).await?;
    sqlx::query("DELETE FROM tasks WHERE id = ?")
        .bind(task_id)
        .execute(&mut conn)
        .await
        .map_err(|e| format!("delete kanban task: {e}"))?;
    Ok(())
}

fn validate_task_create(task: &KanbanTaskCreate) -> Result<(), String> {
    require_non_empty(&task.id, "id")?;
    require_non_empty(&task.title, "title")?;
    validate_status(&task.status)?;
    validate_priority(&task.priority)?;
    if task.sort_order < 0 {
        return Err("sort_order cannot be negative".to_string());
    }
    require_non_empty(&task.created_at, "created_at")?;
    require_non_empty(&task.updated_at, "updated_at")
}

fn validate_status(status: &str) -> Result<(), String> {
    match status {
        "backlog" | "todo" | "in_progress" | "done" => Ok(()),
        _ => Err(format!("invalid kanban task status: {status}")),
    }
}

fn validate_priority(priority: &str) -> Result<(), String> {
    match priority {
        "easy" | "medium" | "hard" | "epic" => Ok(()),
        _ => Err(format!("invalid kanban task priority: {priority}")),
    }
}

fn require_non_empty(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} cannot be empty"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_priority, validate_status, validate_task_create, KanbanTaskCreate};

    fn task() -> KanbanTaskCreate {
        KanbanTaskCreate {
            id: "task-1".to_string(),
            title: "Task".to_string(),
            status: "backlog".to_string(),
            priority: "medium".to_string(),
            sort_order: 0,
            created_at: "2026-05-09T10:00:00Z".to_string(),
            updated_at: "2026-05-09T10:00:00Z".to_string(),
        }
    }

    #[test]
    fn validates_task_status_and_priority() {
        assert!(validate_status("backlog").is_ok());
        assert!(validate_status("todo").is_ok());
        assert!(validate_status("wrong").is_err());
        assert!(validate_priority("medium").is_ok());
        assert!(validate_priority("wrong").is_err());
    }

    #[test]
    fn validates_task_identity() {
        assert!(validate_task_create(&task()).is_ok());
        let mut invalid = task();
        invalid.title = String::new();
        assert!(validate_task_create(&invalid).is_err());
        let mut invalid = task();
        invalid.sort_order = -1;
        assert!(validate_task_create(&invalid).is_err());
    }
}
