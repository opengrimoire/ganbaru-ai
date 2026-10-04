-- A successful semantic edit and its retry receipt commit together.
CREATE TABLE calendar_edit_receipts (
    command_id TEXT PRIMARY KEY NOT NULL,
    intent_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
