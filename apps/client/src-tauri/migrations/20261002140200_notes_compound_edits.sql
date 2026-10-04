CREATE TABLE notes_edit_receipts (
    operation_id TEXT PRIMARY KEY NOT NULL,
    page_id TEXT NOT NULL REFERENCES notes_pages(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX notes_edit_receipts_page ON notes_edit_receipts(page_id, created_at);
