CREATE TABLE project_task_bulk_receipts (
    operation_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_json TEXT NOT NULL,
    response_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX project_task_bulk_receipts_project ON project_task_bulk_receipts(project_id);
