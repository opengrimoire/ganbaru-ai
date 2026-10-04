CREATE TABLE music_transfer_receipts (
    action_id TEXT PRIMARY KEY NOT NULL,
    request_hash TEXT NOT NULL,
    result_json TEXT NOT NULL,
    committed_at INTEGER NOT NULL
);
